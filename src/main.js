// Game shell: screens, the fixed-step loop, and wiring of input sources,
// simulation, renderer and sound.
(function (root) {
  'use strict';

  var K = root.Arkanog, Sim = K.Sim, Input = K.Input, C = Sim.C;
  var G = K.Render.G, RED = K.Render.RED;

  var canvasEl = document.getElementById('screen');
  var renderer = new K.Render.Renderer(canvasEl);
  var sound = new K.Sound();
  var params = new URLSearchParams(location.search);

  // Modes. Online play would add a mode whose remote paddle uses
  // Input.NetworkSource; nothing else here needs to change.
  var MODES = {
    pvai: { label: 'PLAYER VS CPU', names: ['P1', 'CPU'],
      sources: function () { return [new Input.KeyboardSource(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown'], ['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']), new Input.AISource()]; } },
    pvp: { label: 'PLAYER VS PLAYER', names: ['P1', 'P2'],
      sources: function () { return [new Input.KeyboardSource(['KeyW'], ['KeyS'], ['KeyA'], ['KeyD']), new Input.KeyboardSource(['ArrowUp'], ['ArrowDown'], ['ArrowLeft'], ['ArrowRight'])]; } },
    demo: { label: 'DEMO', names: ['CPU', 'CPU'],
      sources: function () { return [new Input.AISource(), new Input.AISource()]; } }
  };
  var MENU = ['pvai', 'pvp'];

  // Rules plugins (see Sim.step). Vines are always on. Lemmings is a switch
  // on the title screen: off, on (both paddles evil), or good vs evil with
  // P1 on either side.
  var LEM_MODES = ['off', 'on', 'p1good', 'p1evil'];
  var LEM_LABELS = { off: 'LEMMINGS OFF', on: 'LEMMINGS ON', p1good: 'GOOD P1 VS EVIL P2', p1evil: 'EVIL P1 VS GOOD P2' };
  var LEM_ROLES = { p1good: ['good', 'evil'], p1evil: ['evil', 'good'] };
  function loadLemMode() {
    var v = params.get('lem');
    if (v !== null) return v === '0' ? 'off' : v === 'good' ? 'p1good' : v === 'evil' ? 'p1evil' : 'on';
    try { v = localStorage.getItem('arkanog.lemmings'); } catch (e) { v = null; }
    return v === '1' ? 'on' : LEM_MODES.indexOf(v) > 0 ? v : 'off';
  }
  function saveLemMode(v) { try { localStorage.setItem('arkanog.lemmings', v); } catch (e) { /* private mode */ } }
  var plugins = [K.Vines];

  var game = {
    screen: 'title',
    menuIndex: 0,
    mode: 'demo',
    state: null,
    sources: null,
    acc: 0,
    lemMode: loadLemMode(),
    lemmings: false
  };
  game.lemmings = game.lemMode !== 'off';

  function newMatch(mode) {
    game.mode = mode;
    game.state = Sim.create({ seed: (Math.random() * 0x7fffffff) | 0, mode: mode });
    game.sources = MODES[mode].sources();
    plugins = game.lemmings ? [K.Vines, K.Lemmings] : [K.Vines];
    if (game.lemmings) K.Lemmings.setup(game.state, LEM_ROLES[game.lemMode] || null);
    game.acc = 0;
    renderer.resetMatch();
  }

  function tick() {
    var st = game.state;
    var inputs = [game.sources[0].poll(st, 0), game.sources[1].poll(st, 1)];
    var events = Sim.step(st, inputs, plugins);
    renderer.onEvents(st, events);
    if (game.screen === 'play') sound.onEvents(st, events);
    for (var i = 0; i < events.length; i++) {
      if (events[i].type === 'matchEnd' && game.screen === 'play') game.screen = 'over';
    }
    // The title screen plays an endless demo match.
    if (game.screen === 'title' && st.phase === 'over') newMatch('demo');
  }

  // ---------- keys ----------

  Input.bindKeyboard(root);
  root.addEventListener('keydown', function (e) {
    if (['ArrowUp', 'ArrowDown', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
    if (e.repeat) return;
    sound.unlock();
    if (e.code === 'KeyM') sound.toggleMusic();
    if (e.code === 'KeyN') sound.toggleSfx();
    if (sound.musicOn) sound.startMusic();
    if (e.code === 'KeyM' || e.code === 'KeyN') return;
    var enter = e.key === 'Enter';

    if (game.screen === 'title') {
      var rows = MENU.length + 1;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { game.menuIndex = (game.menuIndex + rows - 1) % rows; sound.blip(); }
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') { game.menuIndex = (game.menuIndex + 1) % rows; sound.blip(); }
      else if (e.code === 'Digit1') start(0);
      else if (e.code === 'Digit2') start(1);
      else if (e.code === 'KeyL' || ((enter || e.code === 'Space') && game.menuIndex === MENU.length)) toggleLemmings();
      else if (enter || e.code === 'Space') start(game.menuIndex);
    } else if (game.screen === 'play') {
      if (e.code === 'KeyP' || e.code === 'Escape') game.screen = 'paused';
    } else if (game.screen === 'paused') {
      if (e.code === 'KeyP' || enter || e.code === 'Space') game.screen = 'play';
      else if (e.code === 'Escape') toTitle();
    } else if (game.screen === 'over') {
      if (enter || e.code === 'Space') { newMatch(game.mode); game.screen = 'play'; }
      else if (e.code === 'Escape') toTitle();
    }
  });

  function start(i) {
    game.menuIndex = i;
    newMatch(MENU[i]);
    game.screen = 'play';
    sound.blip();
  }
  // The demo behind the title restarts so the switch shows at once.
  function toggleLemmings() {
    game.lemMode = LEM_MODES[(LEM_MODES.indexOf(game.lemMode) + 1) % LEM_MODES.length];
    game.lemmings = game.lemMode !== 'off';
    saveLemMode(game.lemMode);
    newMatch('demo');
    sound.blip();
  }
  function toTitle() { newMatch('demo'); game.screen = 'title'; }

  root.addEventListener('blur', function () { if (game.screen === 'play') game.screen = 'paused'; });
  document.addEventListener('visibilitychange', function () { if (document.hidden && game.screen === 'play') game.screen = 'paused'; });

  // ---------- scaling: largest whole-number zoom that fits ----------

  function resize() {
    var s = Math.max(1, Math.floor(Math.min(root.innerWidth / C.W, root.innerHeight / C.H)));
    canvasEl.style.width = C.W * s + 'px';
    canvasEl.style.height = C.H * s + 'px';
  }
  root.addEventListener('resize', resize);
  resize();

  // ---------- overlays ----------

  function blink(rate) { return (renderer.frame >> (rate || 5)) % 2 === 0; }

  function drawOverlay() {
    var cx = 160;
    if (game.screen === 'title') {
      renderer.box(232, 166);
      renderer.text('ARKANOG', cx + 1, 62, RED.deep, 3, 'center');
      renderer.text('ARKANOG', cx, 61, G[12], 3, 'center');
      renderer.text('PONG MEETS ARKANOID', cx, 89, G[8], 1, 'center');
      for (var i = 0; i <= MENU.length; i++) {
        var sel = i === game.menuIndex, y = 106 + i * 13;
        var label = i < MENU.length ? (i + 1) + '  ' + MODES[MENU[i]].label : 'L  ' + LEM_LABELS[game.lemMode];
        renderer.text(label, cx, y, sel ? G[12] : G[6], 1, 'center');
        if (sel) { renderer.redText('>', cx - 66, y, 1, 'left'); renderer.redText('<', cx + 66, y, 1, 'right'); }
      }
      renderer.text('P1  W A S D        P2  ARROWS', cx, 156, G[8], 1, 'center');
      renderer.text('FIRST TO 10.  P PAUSE  M MUSIC  N SFX', cx, 168, G[7], 1, 'center');
      if (LEM_ROLES[game.lemMode]) renderer.text('GOOD: A/D OR LEFT/RIGHT SLIDE', cx, 180, '#d8b860', 1, 'center');
      if (blink()) renderer.text('PRESS ENTER', cx, 194, G[11], 1, 'center');
    } else if (game.screen === 'paused') {
      renderer.box(150, 60);
      renderer.text('PAUSED', cx, 110, G[12], 2, 'center');
      renderer.text('P RESUME    ESC MENU', cx, 136, G[8], 1, 'center');
    } else if (game.screen === 'over') {
      renderer.box(170, 76);
      var names = MODES[game.mode].names, w = game.state.winner;
      renderer.redText(names[w] + ' WINS', cx, 104, 2, 'center');
      renderer.text(game.state.score[0] + ' - ' + game.state.score[1], cx, 128, G[11], 1, 'center');
      if (blink()) renderer.text('ENTER REMATCH    ESC MENU', cx, 150, G[8], 1, 'center');
    }
    if (!sound.musicOn || !sound.sfxOn) {
      var flags = (sound.musicOn ? '' : 'MUSIC OFF ') + (sound.sfxOn ? '' : 'SFX OFF');
      renderer.text(flags.trim(), 296, 212, G[6], 1, 'right');
    }
  }

  // ---------- loop ----------

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (game.screen !== 'paused') {
      game.acc += dt;
      while (game.acc >= C.TICK) { tick(); game.acc -= C.TICK; }
      renderer.update(dt);
    }
    renderer.draw(game.state, { names: MODES[game.mode].names, screen: game.screen });
    drawOverlay();
    requestAnimationFrame(frame);
  }

  newMatch('demo');
  // ?demo&ff=N starts a CPU-vs-CPU match N seconds in (for screenshots).
  if (params.has('demo')) {
    game.screen = 'play';
    var ticks = Math.round((parseFloat(params.get('ff')) || 0) / C.TICK);
    for (var t = 0; t < ticks; t++) { tick(); renderer.update(C.TICK); }
  }
  requestAnimationFrame(frame);

  // Exposed for debugging in the browser console.
  root.Arkanog.game = game;
  root.Arkanog.sound = sound;
})(this);
