// Input sources. Each paddle reads from one source with the same interface:
//   source.poll(state, side) -> { up: boolean, down: boolean }
// The simulation only sees these booleans, so a paddle can be driven by a
// keyboard, the AI, or (later) a remote peer without changing the rules.
(function (root) {
  'use strict';

  var Sim = (typeof module !== 'undefined' && module.exports) ? require('./sim.js') : root.Arkanog.Sim;

  // Shared key state for every keyboard source on the page.
  var keys = {};
  function bindKeyboard(target) {
    target.addEventListener('keydown', function (e) { keys[e.code] = true; });
    target.addEventListener('keyup', function (e) { keys[e.code] = false; });
    target.addEventListener('blur', function () { keys = {}; });
  }

  // upCodes / downCodes: KeyboardEvent.code values, e.g. ['KeyW'].
  function KeyboardSource(upCodes, downCodes) {
    this.upCodes = upCodes;
    this.downCodes = downCodes;
  }
  KeyboardSource.prototype.poll = function () {
    var up = false, down = false, i;
    for (i = 0; i < this.upCodes.length; i++) up = up || !!keys[this.upCodes[i]];
    for (i = 0; i < this.downCodes.length; i++) down = down || !!keys[this.downCodes[i]];
    return { up: up, down: down };
  };

  // Predicts where the ball crosses the paddle line, bouncing off the walls
  // but not the bricks, then aims with a random error. The error and the
  // reaction delay are what make the AI beatable. The AI is an input source,
  // not part of the rules, so Math.random is fine here.
  function AISource(opts) {
    opts = opts || {};
    this.error = opts.error != null ? opts.error : 10;
    // Extra aim error per px/s above the serve speed: fast rallies get risky.
    this.speedError = opts.speedError != null ? opts.speedError : 0.16;
    this.reaction = opts.reaction != null ? opts.reaction : 0.12;
    this.random = opts.random || Math.random;
    this.offset = 0;
    this.wait = 0;
    this.lastDir = 0;
  }
  AISource.prototype.poll = function (state, side) {
    var C = Sim.C, A = C.ARENA;
    var p = state.paddles[side], b = state.ball;
    var centre = p.y + p.h / 2;
    var target = (A.top + A.bottom) / 2;
    var dir = b.vx > 0 ? 1 : b.vx < 0 ? -1 : 0;
    var towards = (side === 0 && dir < 0) || (side === 1 && dir > 0);

    if (dir !== this.lastDir) {
      this.lastDir = dir;
      this.wait = this.reaction;
      var spread = this.error + Math.max(0, b.speed - C.BALL.speed) * this.speedError;
      this.offset = (this.random() * 2 - 1) * spread;
    }

    if (state.phase === 'play' && towards) {
      if (this.wait > 0) { this.wait -= C.TICK; return { up: false, down: false }; }
      var lineX = side === 0 ? p.x + p.w : p.x - b.size;
      var t = (lineX - b.x) / b.vx;
      var y = b.y + b.vy * t;
      var lo = A.top, hi = A.bottom - b.size, span = hi - lo;
      // Fold the straight-line prediction back into the arena (wall bounces).
      var m = ((y - lo) % (2 * span) + 2 * span) % (2 * span);
      y = lo + (m <= span ? m : 2 * span - m);
      target = y + b.size / 2 + this.offset;
    }
    var dead = 3;
    return { up: target < centre - dead, down: target > centre + dead };
  };

  // Placeholder for a future online mode. A transport (WebRTC data channel or
  // WebSocket) pushes the peer's input for each tick; poll() returns the input
  // for the current tick, or repeats the last one (prediction) if it has not
  // arrived yet. Rollback on mismatch can use Sim.snapshot / Sim.restore.
  function NetworkSource() {
    this.byTick = {};
    this.last = { up: false, down: false };
  }
  NetworkSource.prototype.push = function (tick, input) { this.byTick[tick] = input; };
  NetworkSource.prototype.poll = function (state) {
    var inp = this.byTick[state.tick + 1];
    if (inp) { this.last = inp; delete this.byTick[state.tick + 1]; }
    return this.last;
  };

  var api = { bindKeyboard: bindKeyboard, KeyboardSource: KeyboardSource, AISource: AISource, NetworkSource: NetworkSource, keys: function () { return keys; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Arkanog.Input = api;
})(this);
