#!/usr/bin/env node
// Plays Arkanog inside a terminal that speaks the kitty graphics protocol
// (Rex, kitty, Ghostty, WezTerm, ...). It runs the same game scripts as the
// browser build: minimal stand-ins for window, document and canvas are set up,
// the scripts are loaded in order, and each frame of the canvas is sent to
// the terminal as an image. There is no sound in the terminal.
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var vm = require('vm');
var Canvas = require('./canvas.js').Canvas;
var kitty = require('./kitty.js');

var USAGE = [
  'Usage: arkanog-term [options]',
  '',
  '  --lemmings        start with lemmings mode on',
  '  --demo            watch a CPU-vs-CPU match',
  '  --scale N         pixel scale 1-6 (default: fit the window, up to 4)',
  '  --fps N           frames per second, 10-60 (default 30)',
  '  --dump FILE       render frames to FILE instead of a terminal (for tests)',
  '  --frames N        with --dump: how many frames (default 60)',
  '  -h, --help        show this help',
  '',
  'Keys: as in the browser. Q or Ctrl+C quits.'
].join('\n');

function parseArgs(argv) {
  var o = { fps: 30, scale: 0, frames: 60 };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--lemmings') o.lemmings = true;
    else if (a === '--demo') o.demo = true;
    else if (a === '--scale') o.scale = Math.max(1, Math.min(6, +argv[++i] | 0));
    else if (a === '--fps') o.fps = Math.max(10, Math.min(60, +argv[++i] | 0));
    else if (a === '--dump') o.dump = argv[++i];
    else if (a === '--frames') o.frames = Math.max(1, +argv[++i] | 0);
    else { o.error = 'unknown option ' + a; }
  }
  return o;
}

// ---------- browser stand-ins ----------

function installBrowser(opts) {
  var listeners = {}, docListeners = {};
  var screen = new Canvas(320, 240);
  var raf = null;
  var store = path.join(os.homedir(), '.arkanog-term.json');
  var saved = {};
  try { saved = JSON.parse(fs.readFileSync(store, 'utf8')); } catch (e) { /* first run */ }

  var g = globalThis;
  g.window = g;
  g.addEventListener = function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); };
  g.document = {
    hidden: false,
    createElement: function () { return new Canvas(); },
    getElementById: function () { return screen; },
    addEventListener: function (type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); }
  };
  var q = [];
  if (opts.demo) q.push('demo');
  if (opts.lemmings) q.push('lem=1');
  g.location = { search: q.length ? '?' + q.join('&') : '' };
  g.innerWidth = 320; g.innerHeight = 240;
  g.requestAnimationFrame = function (fn) { raf = fn; };
  g.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(saved, k) ? saved[k] : null; },
    setItem: function (k, v) {
      saved[k] = String(v);
      try { fs.writeFileSync(store, JSON.stringify(saved)); } catch (e) { /* read-only home */ }
    }
  };

  return {
    screen: screen,
    // Runs the game's pending frame callback, as the browser would.
    frame: function (now) { var fn = raf; raf = null; if (fn) fn(now); },
    dispatch: function (type, ev) { (listeners[type] || []).forEach(function (fn) { fn(ev); }); }
  };
}

function loadGame() {
  var root = path.join(__dirname, '..');
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var scripts = [], re = /<script src="([^"]+)"/g, m;
  while ((m = re.exec(html))) scripts.push(m[1]);
  scripts.forEach(function (src) {
    var file = path.join(root, src);
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
  });
}

function keyEvent(code, key, repeat) {
  return { code: code, key: key, repeat: !!repeat, preventDefault: function () {} };
}

// ---------- dump mode: no terminal, for tests ----------

function dump(opts) {
  var browser = installBrowser(opts);
  loadGame();
  var out = fs.openSync(opts.dump, 'w');
  // Simulated clock: frames are evenly spaced whatever the real speed.
  var t = performance.now();
  for (var f = 0; f < opts.frames; f++) {
    t += 1000 / opts.fps;
    browser.frame(t);
    fs.writeSync(out, kitty.frame(browser.screen.data, 320, 240, { id: 1 + (f & 1), scale: opts.scale || 1 }));
  }
  fs.closeSync(out);
}

// ---------- terminal mode ----------

function play(opts) {
  var stdin = process.stdin, stdout = process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) {
    console.error('arkanog-term needs an interactive terminal.');
    process.exit(1);
  }
  var replies = {}, pending = '', started = false, closed = false;
  // ARKANOG_TERM_DEBUG=1 shows a debug line; =FILE also logs raw input there.
  var debug = process.env.ARKANOG_TERM_DEBUG || '';
  var held = {}, kittyKeys = false, browser = null, lastKey = '';

  function write(s) { stdout.write(s); }

  function cleanup() {
    if (closed) return;
    closed = true;
    write(kitty.removeAll() + (kittyKeys ? kitty.KEYBOARD_OFF : '') + kitty.FOCUS_OFF + '\x1b[?25h\x1b[?1049l');
    try { stdin.setRawMode(false); } catch (e) { /* already closed */ }
  }
  function quit(code, msg) {
    cleanup();
    if (msg) console.error(msg);
    process.exit(code);
  }
  process.on('exit', cleanup);
  process.on('SIGTERM', function () { quit(0); });
  process.on('uncaughtException', function (e) { quit(1, e.stack || String(e)); });

  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.on('data', function (chunk) {
    if (debug && debug !== '1') fs.appendFileSync(debug, JSON.stringify(chunk) + '\n');
    var r = kitty.parse(pending + chunk);
    pending = r.rest;
    Object.keys(r.replies).forEach(function (k) { replies[k] = r.replies[k]; });
    if (started) r.events.forEach(onKey);
  });

  // Without the kitty keyboard protocol the terminal sends no key releases,
  // only presses and auto-repeats. A key then counts as held until no repeat
  // has arrived for a moment; the first wait is longer to cover the delay
  // before auto-repeat starts.
  function legacyPress(code, key) {
    var h = held[code];
    if (h) clearTimeout(h.timer);
    else browser.dispatch('keydown', keyEvent(code, key, false));
    held[code] = { timer: setTimeout(function () { delete held[code]; browser.dispatch('keyup', keyEvent(code, key)); }, h ? 90 : 550) };
  }

  function onKey(e) {
    lastKey = e.type + ' ' + (e.code || '');
    if (e.type === 'focus') { if (!e.focused) browser.dispatch('blur', {}); return; }
    if ((e.code === 'KeyC' && e.ctrl) || e.code === 'KeyQ') { if (e.type !== 'up') quit(0); return; }
    if (!kittyKeys) return legacyPress(e.code, e.key);
    if (e.type === 'up') browser.dispatch('keyup', keyEvent(e.code, e.key));
    else browser.dispatch('keydown', keyEvent(e.code, e.key, e.type === 'repeat'));
  }

  var scale = 2, cols = 0, cellW = 0, cellH = 0;
  function layout() {
    var px = replies.pixels, cell = replies.cell;
    cellW = cell ? cell.w : px ? px.w / stdout.columns : 8;
    cellH = cell ? cell.h : px ? px.h / stdout.rows : 16;
    var winW = px ? px.w : stdout.columns * cellW, winH = px ? px.h : stdout.rows * cellH;
    // Auto-fit stops at 4x: a 6x frame is about 240 KB, too much at 30 fps.
    scale = opts.scale || Math.max(1, Math.min(4, Math.floor(Math.min(winW / 320, (winH - 2 * cellH) / 240))));
    cols = Math.max(0, Math.floor((stdout.columns - Math.ceil(320 * scale / cellW)) / 2));
    write('\x1b[2J');
  }

  function status() {
    var rows = Math.ceil(240 * scale / cellH);
    if (debug) {
      var gm = globalThis.Arkanog.game, st = gm.state;
      var dl = 'key ' + lastKey + ' | screen ' + gm.screen + ' mode ' + gm.mode + ' lem ' + gm.lemmings + ' | P1 y ' + st.paddles[0].y.toFixed(1) + ' | score ' + st.score.join('-');
      write('\x1b[' + (rows + 2) + ';' + (cols + 1) + 'H\x1b[2K' + dl);
    }
    var line = 'Q quit   kitty graphics ' + (replies.graphics || '?') + '   keys: ' + (kittyKeys ? 'kitty (press/release)' : 'legacy (auto-repeat)') + '   scale ' + scale + 'x';
    write('\x1b[' + (rows + 1) + ';' + (cols + 1) + 'H\x1b[2m' + line.slice(0, Math.max(0, stdout.columns - cols)) + '\x1b[0m');
  }

  // Ask the terminal what it can do, then start.
  write('\x1b[?1049h\x1b[?25l' + kitty.QUERY_KEYBOARD + kitty.QUERY_PIXELS + kitty.QUERY_CELL + kitty.QUERY_GRAPHICS);
  var waited = 0;
  var probe = setInterval(function () {
    waited += 50;
    if (!(replies.da1 || waited >= 1500)) return;
    clearInterval(probe);
    if (replies.graphics !== 'ok') quit(1, 'This terminal did not confirm kitty graphics support (reply: ' + (replies.graphics || 'none') + '). Try Rex, kitty, Ghostty or WezTerm.');
    kittyKeys = replies.keyboard !== undefined;
    write((kittyKeys ? kitty.KEYBOARD_ON : '') + kitty.FOCUS_ON);
    browser = installBrowser(opts);
    loadGame();
    started = true;
    layout();
    process.on('SIGWINCH', function () { write(kitty.QUERY_PIXELS + kitty.QUERY_CELL); setTimeout(function () { layout(); status(); }, 100); });
    status();
    loop();
  }, 50);

  // Two image ids take turns: show the new frame, then delete the old one,
  // so the screen never goes blank between frames.
  var id = 1;
  function loop() {
    if (closed) return;
    var start = Date.now();
    browser.frame(performance.now());
    var next = id === 1 ? 2 : 1;
    write('\x1b[1;' + (cols + 1) + 'H' + kitty.frame(browser.screen.data, 320, 240, { id: next, scale: scale }) + kitty.remove(id));
    id = next;
    if (debug) status();
    setTimeout(loop, Math.max(1, 1000 / opts.fps - (Date.now() - start)));
  }
}

var opts = parseArgs(process.argv.slice(2));
if (opts.help) { console.log(USAGE); process.exit(0); }
if (opts.error) { console.error(opts.error + '\n\n' + USAGE); process.exit(2); }
if (opts.dump) dump(opts);
else play(opts);
