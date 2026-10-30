// Arkanog simulation: pure game rules, no DOM, no clock, no Math.random.
// The same state + the same inputs always give the same next state, so a
// future online mode can run lockstep or rollback by exchanging only inputs.
(function (root) {
  'use strict';

  var C = {
    W: 320, H: 240,
    ARENA: { left: 20, right: 300, top: 44, bottom: 222 },
    TICK: 1 / 120,
    WIN_SCORE: 10,
    PADDLE: { w: 8, h: 34, speed: 150, inset: 10 },
    BALL: { size: 4, speed: 115, maxSpeed: 270, accel: 1.045 },
    // tan(60deg): steepest bounce off a paddle edge.
    MAX_SLOPE: 1.7,
    SERVE_DELAY: 1.0,
    POINT_DELAY: 0.9,
    // The brick field is the Peec logo: two offset slabs, each laid as a
    // running-bond wall of small bricks. The lower slab is two rows taller,
    // as in the logo; the slabs mirror each other left to right.
    BRICK: { w: 11, h: 7, gap: 1 },
    SLAB: { cols: 8, rows: [5, 7], shift: 35, gap: 8 }
  };

  // Mulberry32. The seed lives in the state, so it is part of the snapshot.
  function rand(state) {
    var t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // One slab, rows starting at the top. Odd rows start and end with a half
  // brick to stagger the joints. Edge bricks take 2 hits, inner bricks 1.
  function buildSlab(bricks, slab, x0, y0, rows) {
    var b = C.BRICK, cols = C.SLAB.cols, pitch = b.w + b.gap, half = (b.w - b.gap) / 2;
    var slabW = cols * b.w + (cols - 1) * b.gap;
    for (var r = 0; r < rows; r++) {
      var cells = [], c;
      if (r % 2 === 0) for (c = 0; c < cols; c++) cells.push([c * pitch, b.w]);
      else {
        cells.push([0, half]);
        for (c = 0; c < cols - 1; c++) cells.push([half + b.gap + c * pitch, b.w]);
        cells.push([slabW - half, half]);
      }
      for (var i = 0; i < cells.length; i++) {
        var edge = r === 0 || r === rows - 1 || i === 0 || i === cells.length - 1;
        var hp = edge ? 2 : 1;
        bricks.push({ id: bricks.length, x: x0 + cells[i][0], y: y0 + r * (b.h + b.gap), w: cells[i][1], h: b.h, hp: hp, maxHp: hp, slab: slab });
      }
    }
  }

  function buildBricks() {
    var b = C.BRICK, sl = C.SLAB;
    var slabW = sl.cols * b.w + (sl.cols - 1) * b.gap;
    var heights = sl.rows.map(function (n) { return n * b.h + (n - 1) * b.gap; });
    var cx = C.W / 2, cy = (C.ARENA.top + C.ARENA.bottom) / 2;
    var y0 = Math.round(cy - (heights[0] + sl.gap + heights[1]) / 2);
    var upperX = cx - (slabW + sl.shift) / 2 + sl.shift;
    var bricks = [];
    buildSlab(bricks, 0, upperX, y0, sl.rows[0]);
    // Lower slab: mirrored across the centre line, shifted left.
    buildSlab(bricks, 1, 2 * cx - upperX - slabW, y0 + heights[0] + sl.gap, sl.rows[1]);
    return bricks;
  }

  function makePaddle(side) {
    var p = C.PADDLE;
    return {
      side: side,
      x: side === 0 ? C.ARENA.left + p.inset : C.ARENA.right - p.inset - p.w,
      y: Math.round((C.ARENA.top + C.ARENA.bottom - p.h) / 2),
      w: p.w, h: p.h, vy: 0,
      // Plugins may change this, e.g. to slow a paddle down.
      speedScale: 1
    };
  }

  // opts.seed: integer. opts.mode is informational ('pvai', 'pvp', 'online').
  function create(opts) {
    opts = opts || {};
    var state = {
      version: 1,
      tick: 0,
      rng: (opts.seed | 0) || 1,
      mode: opts.mode || 'pvai',
      phase: 'serve',
      timer: C.SERVE_DELAY,
      server: 0,
      score: [0, 0],
      winner: -1,
      rally: 0,
      paddles: [makePaddle(0), makePaddle(1)],
      ball: { x: 0, y: 0, vx: 0, vy: 0, speed: C.BALL.speed, size: C.BALL.size },
      bricks: buildBricks(),
      // Free space for plugins such as power-ups. Keep it JSON-serialisable.
      ext: {}
    };
    attachBall(state);
    return state;
  }

  function attachBall(state) {
    var p = state.paddles[state.server], b = state.ball;
    b.speed = C.BALL.speed;
    b.vx = 0; b.vy = 0;
    b.x = state.server === 0 ? p.x + p.w + 1 : p.x - b.size - 1;
    b.y = p.y + (p.h - b.size) / 2;
  }

  function launch(state) {
    var b = state.ball;
    var slope = (rand(state) * 2 - 1) * 0.6;
    setDirection(b, state.server === 0 ? 1 : -1, slope);
    state.rally = 0;
  }

  // Direction from a slope, normalised with sqrt only (sqrt is exact in
  // IEEE 754, trig functions are not), so peers on other engines agree.
  function setDirection(b, dirX, slope) {
    var len = Math.sqrt(1 + slope * slope);
    b.vx = dirX * b.speed / len;
    b.vy = b.speed * slope / len;
  }

  function overlaps(b, r) {
    return b.x < r.x + r.w && b.x + b.size > r.x && b.y < r.y + r.h && b.y + b.size > r.y;
  }

  // A plugin may return extra events; they go to the caller (sound, effects,
  // network) but not back through the plugins.
  function emit(state, events, plugins, ev) {
    events.push(ev);
    for (var i = 0; i < plugins.length; i++) {
      var extra = plugins[i].onEvent ? plugins[i].onEvent(state, ev, api) : null;
      if (extra) for (var k = 0; k < extra.length; k++) events.push(extra[k]);
    }
  }

  function hitBrick(state, events, plugins, brick, b) {
    brick.hp -= 1;
    emit(state, events, plugins, {
      type: 'brickHit', brick: brick.id, hp: brick.hp,
      x: b.x + b.size / 2, y: b.y + b.size / 2
    });
    if (brick.hp <= 0) {
      emit(state, events, plugins, { type: 'brickBreak', brick: brick.id, x: brick.x + brick.w / 2, y: brick.y + brick.h / 2 });
    }
  }

  function firstBrickHit(state, b) {
    for (var i = 0; i < state.bricks.length; i++) {
      var br = state.bricks[i];
      if (br.hp > 0 && overlaps(b, br)) return br;
    }
    return null;
  }

  function movePaddles(state, inputs, dt) {
    var A = C.ARENA;
    for (var i = 0; i < 2; i++) {
      var p = state.paddles[i], inp = inputs[i] || {};
      var axis = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      p.vy = axis * C.PADDLE.speed * (p.speedScale || 1);
      p.y += p.vy * dt;
      if (p.y < A.top) p.y = A.top;
      if (p.y + p.h > A.bottom) p.y = A.bottom - p.h;
    }
  }

  function paddleBounce(state, events, plugins, p, b) {
    var half = p.h / 2 + b.size / 2;
    var rel = (b.y + b.size / 2 - (p.y + p.h / 2)) / half;
    if (rel > 1) rel = 1;
    if (rel < -1) rel = -1;
    b.speed = Math.min(C.BALL.maxSpeed, b.speed * C.BALL.accel);
    setDirection(b, p.side === 0 ? 1 : -1, rel * C.MAX_SLOPE);
    state.rally += 1;
    emit(state, events, plugins, { type: 'paddleHit', side: p.side, rel: rel, speed: b.speed, x: b.x, y: b.y });
  }

  // Hit on a paddle end: keep the reflected direction, add the speed-up.
  function endBounce(state, events, plugins, p, b, rel) {
    var speed = Math.min(C.BALL.maxSpeed, b.speed * C.BALL.accel), k = speed / b.speed;
    b.speed = speed; b.vx *= k; b.vy *= k;
    state.rally += 1;
    emit(state, events, plugins, { type: 'paddleHit', side: p.side, rel: rel, speed: b.speed, x: b.x, y: b.y });
  }

  // Moves the ball one axis at a time in steps of at most 1px. Per-axis moves
  // make the bounce side unambiguous and stop the ball tunnelling at speed.
  function moveBall(state, events, plugins, dt) {
    var b = state.ball, A = C.ARENA;
    var dist = Math.max(Math.abs(b.vx), Math.abs(b.vy)) * dt;
    var n = Math.max(1, Math.ceil(dist));
    for (var s = 0; s < n; s++) {
      // X axis: paddles and brick sides.
      var px = b.x;
      b.x += (b.vx * dt) / n;
      var hitPaddle = false;
      for (var i = 0; i < 2; i++) {
        var p = state.paddles[i];
        if (!overlaps(b, p)) continue;
        var front = p.side === 0 ? (b.vx < 0 && px >= p.x + p.w - 0.001) : (b.vx > 0 && px + b.size <= p.x + 0.001);
        if (front) {
          b.x = p.side === 0 ? p.x + p.w : p.x - b.size;
          paddleBounce(state, events, plugins, p, b);
          hitPaddle = true;
        }
      }
      if (!hitPaddle) {
        var br = firstBrickHit(state, b);
        if (br) {
          b.x = px;
          b.vx = -b.vx;
          hitBrick(state, events, plugins, br, b);
        }
      }

      // Y axis: walls, brick tops and bottoms, paddle ends.
      var py = b.y;
      b.y += (b.vy * dt) / n;
      if (b.y < A.top) { b.y = A.top + (A.top - b.y); b.vy = Math.abs(b.vy); emit(state, events, plugins, { type: 'wallHit', x: b.x, y: A.top }); }
      if (b.y + b.size > A.bottom) { b.y = A.bottom - b.size - (b.y + b.size - A.bottom); b.vy = -Math.abs(b.vy); emit(state, events, plugins, { type: 'wallHit', x: b.x, y: A.bottom }); }
      var br2 = firstBrickHit(state, b);
      if (br2) {
        b.y = py;
        b.vy = -b.vy;
        hitBrick(state, events, plugins, br2, b);
      }
      for (var j = 0; j < 2; j++) {
        var q = state.paddles[j];
        if (!overlaps(b, q)) continue;
        // Ball touches a paddle end, or the paddle moved into it: push it out.
        // If the ball was moving into that end it is a real hit, so it gets the
        // same speed-up, rally count and event as a face hit.
        var above = b.y + b.size / 2 < q.y + q.h / 2;
        var into = above ? b.vy > 0 : b.vy < 0;
        if (above) { b.y = q.y - b.size; b.vy = -Math.abs(b.vy); }
        else { b.y = q.y + q.h; b.vy = Math.abs(b.vy); }
        if (into) endBounce(state, events, plugins, q, b, above ? -1 : 1);
        // A paddle against a wall can push the ball past it; keep it inside.
        if (b.y < A.top) b.y = A.top;
        if (b.y + b.size > A.bottom) b.y = A.bottom - b.size;
      }

      if (b.x + b.size < A.left) return score(state, events, plugins, 1);
      if (b.x > A.right) return score(state, events, plugins, 0);
    }
  }

  function score(state, events, plugins, side) {
    state.score[side] += 1;
    state.server = 1 - side;
    emit(state, events, plugins, { type: 'score', side: side, score: state.score.slice() });
    if (state.score[side] >= C.WIN_SCORE) {
      state.phase = 'over';
      state.winner = side;
      emit(state, events, plugins, { type: 'matchEnd', winner: side, score: state.score.slice() });
    } else {
      state.phase = 'point';
      state.timer = C.POINT_DELAY;
    }
  }

  // inputs: [{up, down}, {up, down}] for paddle 0 (left) and 1 (right).
  // plugins: optional [{ onEvent(state, event, api) }]. Plugins must be
  // deterministic too: use api.rand(state), never Math.random or Date.
  // Returns the list of events from this tick (for sound, effects, network).
  function step(state, inputs, plugins) {
    plugins = plugins || [];
    var events = [];
    var dt = C.TICK;
    state.tick += 1;
    if (state.phase === 'over') return events;

    movePaddles(state, inputs, dt);

    if (state.phase === 'point') {
      state.timer -= dt;
      if (state.timer <= 0) { state.phase = 'serve'; state.timer = C.SERVE_DELAY; }
      return events;
    }
    if (state.phase === 'serve') {
      attachBall(state);
      state.timer -= dt;
      if (state.timer <= 0) {
        state.phase = 'play';
        launch(state);
        emit(state, events, plugins, { type: 'serve', side: state.server });
      }
      return events;
    }
    moveBall(state, events, plugins, dt);
    return events;
  }

  function snapshot(state) { return JSON.stringify(state); }
  function restore(json) { return JSON.parse(json); }

  var api = { C: C, create: create, step: step, rand: rand, snapshot: snapshot, restore: restore, setDirection: setDirection };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Arkanog = root.Arkanog || {}).Sim = api;
})(this);
