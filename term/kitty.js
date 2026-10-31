// Kitty terminal protocols, as far as the game needs them:
// - graphics: send an RGBA frame as zlib-compressed RGB, swap it in without
//   flicker, delete it on exit;
// - keyboard: ask for key press, repeat and release events, so held keys
//   work like in a browser;
// - queries: graphics support, window size in pixels, cell size.
// https://sw.kovidgoyal.net/kitty/graphics-protocol/
// https://sw.kovidgoyal.net/kitty/keyboard-protocol/
'use strict';

var zlib = require('zlib');

var ESC = '\x1b';
var APC = ESC + '_G';
var ST = ESC + '\\';
var CHUNK = 4096;

// Nearest-neighbour upscale and drop alpha: RGBA w*h -> RGB (w*s)*(h*s).
function toRGB(rgba, w, h, scale) {
  var W = w * scale, out = Buffer.allocUnsafe(W * h * scale * 3);
  for (var y = 0; y < h; y++) {
    var row = Buffer.allocUnsafe(W * 3);
    for (var x = 0, si = y * w * 4, di = 0; x < w; x++, si += 4) {
      for (var k = 0; k < scale; k++, di += 3) { row[di] = rgba[si]; row[di + 1] = rgba[si + 1]; row[di + 2] = rgba[si + 2]; }
    }
    for (var r = 0; r < scale; r++) row.copy(out, (y * scale + r) * W * 3);
  }
  return out;
}

// Escape sequence that transmits and shows one frame as image `id` at the
// cursor. `q=2` keeps the terminal quiet, `C=1` leaves the cursor where it is.
function frame(rgba, w, h, opts) {
  var scale = opts.scale || 1, W = w * scale, H = h * scale;
  var payload = zlib.deflateSync(toRGB(rgba, w, h, scale), { level: 1 }).toString('base64');
  var head = 'a=T,f=24,o=z,s=' + W + ',v=' + H + ',i=' + opts.id + ',p=1,q=2,C=1';
  var out = [];
  for (var i = 0; i < payload.length; i += CHUNK) {
    var more = i + CHUNK < payload.length ? 1 : 0;
    out.push(APC + (i === 0 ? head + ',' : 'q=2,') + 'm=' + more + ';' + payload.slice(i, i + CHUNK) + ST);
  }
  return out.join('');
}

// Free an image and all its placements.
function remove(id) { return APC + 'a=d,d=I,i=' + id + ',q=2' + ST; }
function removeAll() { return APC + 'a=d,d=A,q=2' + ST; }

// Graphics query: a supporting terminal answers `ESC _G i=31;OK ESC \`. The
// DA1 request after it is answered by every terminal, so its reply marks
// "no graphics answer is coming".
var QUERY_GRAPHICS = APC + 'i=31,s=1,v=1,a=q,t=d,f=24;AAAA' + ST + ESC + '[c';
var QUERY_PIXELS = ESC + '[14t';   // -> CSI 4 ; height ; width t
var QUERY_CELL = ESC + '[16t';     // -> CSI 6 ; height ; width t
var QUERY_KEYBOARD = ESC + '[?u';  // -> CSI ? flags u (kitty keyboard)
// Flags: 1 disambiguate, 2 report press/repeat/release, 8 all keys as codes.
var KEYBOARD_ON = ESC + '[>11u';
var KEYBOARD_OFF = ESC + '[<u';
var FOCUS_ON = ESC + '[?1004h';    // -> CSI I / CSI O on focus in / out
var FOCUS_OFF = ESC + '[?1004l';

var NAMED = { 13: ['Enter', 'Enter'], 27: ['Escape', 'Escape'], 32: ['Space', ' '], 9: ['Tab', 'Tab'], 127: ['Backspace', 'Backspace'], 57414: ['NumpadEnter', 'Enter'] };
var ARROWS = { A: 'ArrowUp', B: 'ArrowDown', C: 'ArrowRight', D: 'ArrowLeft' };

// Codepoint -> browser-style { code, key }.
function keyOf(cp) {
  if (NAMED[cp]) return { code: NAMED[cp][0], key: NAMED[cp][1] };
  var ch = String.fromCodePoint(cp);
  if (/[a-z]/.test(ch)) return { code: 'Key' + ch.toUpperCase(), key: ch };
  if (/[A-Z]/.test(ch)) return { code: 'Key' + ch, key: ch };
  if (/[0-9]/.test(ch)) return { code: 'Digit' + ch, key: ch };
  return { code: 'Unidentified', key: ch };
}

var TYPES = { 1: 'down', 2: 'repeat', 3: 'up' };

// Parses terminal input into key events and query replies. Returns
// { events: [{ type, code, key, ctrl }], replies: {...}, rest } where rest is
// an incomplete trailing sequence to prepend to the next chunk.
function parse(str) {
  var events = [], replies = {}, i = 0, m;
  while (i < str.length) {
    var s = str.slice(i);
    if ((m = /^\x1b_G([^;\x1b]*);?([^\x1b]*)\x1b\\/.exec(s))) {
      if (/i=31/.test(m[1])) replies.graphics = m[2] === 'OK' ? 'ok' : m[2];
    } else if ((m = /^\x1b\[\?(\d+)u/.exec(s))) {
      replies.keyboard = +m[1];
    } else if ((m = /^\x1b\[\?[\d;]*c/.exec(s))) {
      replies.da1 = true;
    } else if ((m = /^\x1b\[([IO])/.exec(s))) {
      events.push({ type: 'focus', focused: m[1] === 'I' });
    } else if ((m = /^\x1b\[(4|6);(\d+);(\d+)t/.exec(s))) {
      replies[m[1] === '4' ? 'pixels' : 'cell'] = { h: +m[2], w: +m[3] };
    } else if ((m = /^\x1b\[(\d+)(?::[\d:]*)?(?:;(\d+)(?::(\d))?)?(?:;[\d:]*)?u/.exec(s))) {
      var mods = (+m[2] || 1) - 1, k = keyOf(+m[1]);
      events.push({ type: TYPES[m[3] || 1], code: k.code, key: k.key, ctrl: !!(mods & 4) });
    } else if ((m = /^\x1b\[(?:1;(\d+)(?::(\d))?)?([ABCD])/.exec(s))) {
      events.push({ type: TYPES[m[2] || 1], code: ARROWS[m[3]], key: ARROWS[m[3]], ctrl: !!(((+m[1] || 1) - 1) & 4) });
    } else if ((m = /^\x1bO([ABCD])/.exec(s))) {
      events.push({ type: 'down', code: ARROWS[m[1]], key: ARROWS[m[1]], ctrl: false, legacy: true });
    } else if (s[0] === '\x1b' && (s.length === 1 || s[1] !== '[' && s[1] !== '_' && s[1] !== 'O')) {
      events.push({ type: 'down', code: 'Escape', key: 'Escape', ctrl: false, legacy: true });
      m = ['\x1b'];
    } else if (s[0] === '\x1b') {
      // An escape sequence we do not know yet, or one cut off mid-chunk.
      var end = /^\x1b(\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|_[^\x1b]*\x1b\\)/.exec(s);
      if (!end) return { events: events, replies: replies, rest: s };
      m = end;
    } else {
      var c = s.codePointAt(0), ch = String.fromCodePoint(c);
      if (c === 3) events.push({ type: 'down', code: 'KeyC', key: 'c', ctrl: true, legacy: true });
      else if (c === 13 || c === 10) events.push({ type: 'down', code: 'Enter', key: 'Enter', ctrl: false, legacy: true });
      else if (c >= 32) { var kk = keyOf(c); events.push({ type: 'down', code: kk.code, key: kk.key, ctrl: false, legacy: true }); }
      m = [ch];
    }
    i += m[0].length;
  }
  return { events: events, replies: replies, rest: '' };
}

module.exports = {
  frame: frame, remove: remove, removeAll: removeAll, parse: parse, toRGB: toRGB,
  QUERY_GRAPHICS: QUERY_GRAPHICS, QUERY_PIXELS: QUERY_PIXELS, QUERY_CELL: QUERY_CELL,
  QUERY_KEYBOARD: QUERY_KEYBOARD, KEYBOARD_ON: KEYBOARD_ON, KEYBOARD_OFF: KEYBOARD_OFF,
  FOCUS_ON: FOCUS_ON, FOCUS_OFF: FOCUS_OFF
};
