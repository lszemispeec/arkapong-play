// Vines rule, built on the plugin hook. Each brick hit grows the vine of the
// player who touched the ball last. When the last brick breaks, the longer
// vine wraps the other player's paddle and halves its speed for the rest of
// the match. A tie wraps nobody. All data lives in state.ext.vines, so it is
// part of snapshots and stays deterministic.
(function (root) {
  'use strict';

  var SLOW = 0.5;

  function vines(state) {
    return state.ext.vines || (state.ext.vines = { hits: [0, 0], last: -1, wrapped: -1 });
  }

  function onEvent(state, ev) {
    var v = vines(state);
    if (ev.type === 'serve' || ev.type === 'paddleHit') v.last = ev.side;
    else if (ev.type === 'brickHit' && v.last >= 0) v.hits[v.last] += 1;
    else if (ev.type === 'brickBreak' && v.wrapped < 0 && v.hits[0] !== v.hits[1]) {
      for (var i = 0; i < state.bricks.length; i++) if (state.bricks[i].hp > 0) return null;
      var winner = v.hits[0] > v.hits[1] ? 0 : 1, loser = 1 - winner;
      v.wrapped = loser;
      state.paddles[loser].speedScale = SLOW;
      return [{ type: 'vineWrap', side: winner, target: loser }];
    }
    return null;
  }

  var api = { onEvent: onEvent, vines: vines, SLOW: SLOW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Arkanog.Vines = api;
})(this);
