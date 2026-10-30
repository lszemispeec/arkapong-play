// Lemmings mode, built on the plugin hooks. Now and then a trap door opens on
// a random brick whose top is clear, and lemmings climb out. Each walks left
// or right at random, turns at a wall, and falls when the ground ends. A fall
// that lands on a brick is fine; a fall to the arena floor kills. The ball
// kills any lemming it touches; the kill counts for the player who touched the
// ball last. Every 10th kill curses the other paddle: it blinks in and out at
// random for 10 seconds. All data lives in state.ext.lem, so it is part of
// snapshots and stays deterministic.
(function (root) {
  'use strict';

  var Sim = (typeof module !== 'undefined' && module.exports) ? require('./sim.js') : root.Arkanog.Sim;
  var C = Sim.C, A = C.ARENA;

  var L = {
    W: 3, H: 4,               // half a brick tall
    WALK: 9, FALL: 45,        // px per second
    FIRST_DOOR: 4,            // seconds of play before the first door
    DOOR_GAP: [6, 10],        // seconds between doors
    DOOR_OPEN: 0.6,           // seconds for the hatch to open or close
    RELEASE: 5, EVERY: 1.1,   // lemmings per door, seconds between them
    MAX_ALIVE: 24,
    CURSE_EVERY: 10,          // kills per curse
    CURSE_TIME: 10,           // seconds the cursed paddle blinks
    BLINK: [0.05, 0.45]       // seconds per visible or hidden spell
  };

  function lem(state) {
    return state.ext.lem || (state.ext.lem = { doors: [], lems: [], wait: L.FIRST_DOOR, nextId: 0, killed: [0, 0], floor: 0, curse: [0, 0], blinkT: [0, 0] });
  }

  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function liveBrickIn(state, r) {
    for (var i = 0; i < state.bricks.length; i++) {
      var br = state.bricks[i];
      if (br.hp > 0 && overlaps(br, r)) return br;
    }
    return null;
  }

  // Full bricks with nothing on top of them and no door yet.
  function doorSites(state, data) {
    var out = [];
    for (var i = 0; i < state.bricks.length; i++) {
      var br = state.bricks[i];
      if (br.hp <= 0 || br.w !== C.BRICK.w) continue;
      if (liveBrickIn(state, { x: br.x, y: br.y - L.H - 4, w: br.w, h: L.H + 4 })) continue;
      if (data.doors.some(function (d) { return d.brick === br.id; })) continue;
      out.push(br);
    }
    return out;
  }

  function standing(state, l) {
    var feet = l.y + L.H;
    for (var i = 0; i < state.bricks.length; i++) {
      var br = state.bricks[i];
      if (br.hp > 0 && l.x < br.x + br.w && l.x + L.W > br.x && feet >= br.y - 0.001 && feet <= br.y + 0.5) return br;
    }
    return null;
  }

  function onEvent(state, ev) {
    if (ev.type !== 'brickBreak') return null;
    var data = lem(state);
    // A door dies with its brick.
    data.doors = data.doors.filter(function (d) { return d.brick !== ev.brick; });
    return null;
  }

  function onTick(state, api) {
    var data = lem(state), dt = C.TICK, out = [], i;

    // Doors: schedule, open, release, close.
    if (!data.doors.length) {
      data.wait -= dt;
      if (data.wait <= 0) {
        var sites = doorSites(state, data);
        if (sites.length) {
          var br = sites[(api.rand(state) * sites.length) | 0];
          data.doors.push({ brick: br.id, x: br.x + (br.w - 7) / 2, y: br.y, t: 0, left: L.RELEASE, next: L.DOOR_OPEN });
          out.push({ type: 'doorOpen', x: br.x + br.w / 2, y: br.y });
        }
        data.wait = L.DOOR_GAP[0] + api.rand(state) * (L.DOOR_GAP[1] - L.DOOR_GAP[0]);
      }
    }
    for (i = data.doors.length - 1; i >= 0; i--) {
      var d = data.doors[i];
      d.t += dt;
      if (d.left > 0) {
        d.next -= dt;
        if (d.next <= 0 && data.lems.length < L.MAX_ALIVE) {
          d.left -= 1;
          d.next = L.EVERY;
          data.lems.push({ id: data.nextId++, x: d.x + 2, y: d.y - L.H, dir: api.rand(state) < 0.5 ? -1 : 1, falling: false, fell: 0 });
          out.push({ type: 'lemSpawn', x: d.x + 3, y: d.y });
        }
        if (d.left === 0) d.close = L.EVERY + L.DOOR_OPEN;
      } else if ((d.close -= dt) <= 0) data.doors.splice(i, 1);
    }

    // Cursed paddles blink at random until the curse runs out.
    for (i = 0; i < 2; i++) {
      var pad = state.paddles[i];
      if (data.curse[i] > 0) {
        data.curse[i] -= dt;
        data.blinkT[i] -= dt;
        if (data.blinkT[i] <= 0) {
          pad.hidden = !pad.hidden;
          data.blinkT[i] = L.BLINK[0] + api.rand(state) * (L.BLINK[1] - L.BLINK[0]);
        }
        if (data.curse[i] <= 0) { data.curse[i] = 0; pad.hidden = false; }
      }
    }

    // Lemmings: walk, turn, fall, land, die.
    var b = state.ball, ballBox = { x: b.x, y: b.y, w: b.size, h: b.size };
    for (i = data.lems.length - 1; i >= 0; i--) {
      var l = data.lems[i], box;
      if (l.falling) {
        var feet0 = l.y + L.H;
        l.y += L.FALL * dt;
        l.fell += L.FALL * dt;
        var landed = null;
        for (var k = 0; k < state.bricks.length; k++) {
          var lb = state.bricks[k];
          if (lb.hp > 0 && l.x < lb.x + lb.w && l.x + L.W > lb.x && feet0 <= lb.y && l.y + L.H >= lb.y) { landed = lb; break; }
        }
        if (landed) { l.y = landed.y - L.H; l.falling = false; l.fell = 0; }
        else if (l.y + L.H >= A.bottom) {
          data.lems.splice(i, 1);
          data.floor += 1;
          out.push({ type: 'lemSplat', cause: 'floor', x: l.x + 1.5, y: A.bottom - 1 });
          continue;
        }
      } else {
        var nx = l.x + l.dir * L.WALK * dt;
        box = { x: nx, y: l.y, w: L.W, h: L.H - 0.01 };
        if (liveBrickIn(state, box) || nx < A.left || nx + L.W > A.right) l.dir = -l.dir;
        else l.x = nx;
        if (!standing(state, l)) l.falling = true;
      }
      if (state.phase === 'play' && overlaps(ballBox, { x: l.x, y: l.y, w: L.W, h: L.H })) {
        var by = state.ext.vines ? state.ext.vines.last : -1;
        data.lems.splice(i, 1);
        out.push({ type: 'lemSplat', cause: 'ball', by: by, x: l.x + 1.5, y: l.y + 2 });
        if (by >= 0) {
          data.killed[by] += 1;
          if (data.killed[by] % L.CURSE_EVERY === 0) {
            // A new curse restarts the 10 seconds.
            data.curse[1 - by] = L.CURSE_TIME;
            out.push({ type: 'curse', side: by, target: 1 - by, kills: data.killed[by] });
          }
        }
      }
    }
    return out;
  }

  var api = { onEvent: onEvent, onTick: onTick, lem: lem, L: L };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Arkanog.Lemmings = api;
})(this);
