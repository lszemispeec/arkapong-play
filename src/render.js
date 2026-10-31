// Catacomb renderer. Draws everything on a 320x240 canvas with integer
// pixels: grayscale stone, plus red for skull eyes, torch fire and blood.
// Blood, sparks and shake are cosmetic: they live here, not in the rules.
(function (root) {
  'use strict';

  var Sim = root.Arkanog.Sim, C = Sim.C, A = C.ARENA;

  var G = ['#000000', '#0e0e0e', '#1a1a1a', '#262626', '#333333', '#424242', '#545454',
    '#686868', '#7e7e7e', '#969696', '#b0b0b0', '#cacaca', '#e6e6e6', '#ffffff'];
  var RED = { dark: '#3c0204', deep: '#6e0a0a', mid: '#a8120f', hot: '#e02a1e', core: '#ff6a4a', white: '#ffcfbf' };

  // ---------- small helpers ----------

  function makeRng(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), seed | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function px(ctx, x, y, color) { ctx.fillStyle = color; ctx.fillRect(x | 0, y | 0, 1, 1); }
  function rect(ctx, x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return { c: c, ctx: ctx };
  }

  // Draws a sprite given as rows of characters mapped through a palette.
  function sprite(ctx, rows, x, y, pal) {
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        var col = pal[rows[r][c]];
        if (col) px(ctx, x + c, y + r, col);
      }
    }
  }

  // ---------- bitmap font (5x7) ----------

  var FONT = {
    '0': '01110 10001 10011 10101 11001 10001 01110', '1': '00100 01100 00100 00100 00100 00100 01110',
    '2': '01110 10001 00001 00010 00100 01000 11111', '3': '11110 00001 00001 01110 00001 00001 11110',
    '4': '00010 00110 01010 10010 11111 00010 00010', '5': '11111 10000 11110 00001 00001 10001 01110',
    '6': '00110 01000 10000 11110 10001 10001 01110', '7': '11111 00001 00010 00100 01000 01000 01000',
    '8': '01110 10001 10001 01110 10001 10001 01110', '9': '01110 10001 10001 01111 00001 00010 01100',
    'A': '01110 10001 10001 11111 10001 10001 10001', 'B': '11110 10001 10001 11110 10001 10001 11110',
    'C': '01110 10001 10000 10000 10000 10001 01110', 'D': '11110 10001 10001 10001 10001 10001 11110',
    'E': '11111 10000 10000 11110 10000 10000 11111', 'F': '11111 10000 10000 11110 10000 10000 10000',
    'G': '01110 10001 10000 10111 10001 10001 01111', 'H': '10001 10001 10001 11111 10001 10001 10001',
    'I': '01110 00100 00100 00100 00100 00100 01110', 'J': '00111 00010 00010 00010 00010 10010 01100',
    'K': '10001 10010 10100 11000 10100 10010 10001', 'L': '10000 10000 10000 10000 10000 10000 11111',
    'M': '10001 11011 10101 10101 10001 10001 10001', 'N': '10001 10001 11001 10101 10011 10001 10001',
    'O': '01110 10001 10001 10001 10001 10001 01110', 'P': '11110 10001 10001 11110 10000 10000 10000',
    'Q': '01110 10001 10001 10001 10101 10010 01101', 'R': '11110 10001 10001 11110 10100 10010 10001',
    'S': '01111 10000 10000 01110 00001 00001 11110', 'T': '11111 00100 00100 00100 00100 00100 00100',
    'U': '10001 10001 10001 10001 10001 10001 01110', 'V': '10001 10001 10001 10001 10001 01010 00100',
    'W': '10001 10001 10001 10101 10101 10101 01010', 'X': '10001 10001 01010 00100 01010 10001 10001',
    'Y': '10001 10001 01010 00100 00100 00100 00100', 'Z': '11111 00001 00010 00100 01000 10000 11111',
    ':': '00000 01100 01100 00000 01100 01100 00000', '/': '00001 00010 00010 00100 01000 01000 10000',
    '-': '00000 00000 00000 11111 00000 00000 00000', '.': '00000 00000 00000 00000 00000 01100 01100',
    '!': '00100 00100 00100 00100 00100 00000 00100', '?': '01110 10001 00001 00010 00100 00000 00100',
    '>': '01000 00100 00010 00001 00010 00100 01000', '<': '00010 00100 01000 10000 01000 00100 00010',
    ',': '00000 00000 00000 00000 01100 00100 01000', '(': '00010 00100 01000 01000 01000 00100 00010',
    ')': '01000 00100 00010 00010 00010 00100 01000', '+': '00000 00100 00100 11111 00100 00100 00000',
    "'": '00100 00100 01000 00000 00000 00000 00000'
  };
  Object.keys(FONT).forEach(function (k) { FONT[k] = FONT[k].split(' '); });

  function textWidth(str, scale) { return str.length * 6 * (scale || 1) - (scale || 1); }

  // align: 'left' | 'center' | 'right'. Draws a 1px dark shadow for contrast.
  function text(ctx, str, x, y, color, scale, align, shadow) {
    scale = scale || 1;
    str = String(str).toUpperCase();
    var w = textWidth(str, scale);
    if (align === 'center') x = Math.round(x - w / 2);
    else if (align === 'right') x = x - w;
    if (shadow !== false) glyphs(ctx, str, x + scale, y + scale, shadow || G[0], scale);
    glyphs(ctx, str, x, y, color, scale);
  }
  function glyphs(ctx, str, x, y, color, scale) {
    ctx.fillStyle = color;
    for (var i = 0; i < str.length; i++) {
      var g = FONT[str[i]];
      if (!g) continue;
      for (var r = 0; r < 7; r++) for (var c = 0; c < 5; c++) {
        if (g[r][c] === '1') ctx.fillRect(x + (i * 6 + c) * scale, y + r * scale, scale, scale);
      }
    }
  }

  // ---------- stone ----------

  // One stone block: speckled fill, bevel light top-left, shadow bottom-right.
  function stone(ctx, x, y, w, h, base, rng, crack) {
    rect(ctx, x, y, w, h, G[base]);
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var n = rng();
      if (n < 0.14) px(ctx, x + i, y + j, G[base - 1]);
      else if (n > 0.9) px(ctx, x + i, y + j, G[base + 1]);
    }
    rect(ctx, x, y, w, 1, G[base + 2]);
    rect(ctx, x, y, 1, h, G[base + 1]);
    rect(ctx, x, y + h - 1, w, 1, G[base - 2]);
    rect(ctx, x + w - 1, y, 1, h, G[base - 2]);
    if (crack && w > 6 && h > 4) crackLine(ctx, x, y, w, h, rng, G[base - 3], 3 + (rng() * 5 | 0));
  }

  function crackLine(ctx, x, y, w, h, rng, color, len) {
    var cx = x + 2 + (rng() * (w - 4) | 0), cy = y + 1 + (rng() * (h - 2) | 0);
    var dx = rng() < 0.5 ? -1 : 1;
    for (var k = 0; k < len; k++) {
      if (cx > x && cx < x + w - 1 && cy > y && cy < y + h - 1) px(ctx, cx, cy, color);
      if (rng() < 0.6) cx += dx;
      if (rng() < 0.7) cy += 1;
    }
  }

  // Running-bond wall over an area.
  function wall(ctx, x0, y0, w, h, rng, bw, bh, lo, hi) {
    rect(ctx, x0, y0, w, h, G[1]);
    for (var y = y0, row = 0; y < y0 + h; y += bh, row++) {
      var off = row % 2 ? -(bw >> 1) : 0;
      for (var x = x0 + off; x < x0 + w; x += bw) {
        var bx = Math.max(x, x0), bwid = Math.min(x + bw, x0 + w) - bx - 1;
        var bhgt = Math.min(bh, y0 + h - y) - 1;
        if (bwid > 1 && bhgt > 1) stone(ctx, bx, y, bwid, bhgt, lo + (rng() * (hi - lo + 1) | 0), rng, rng() < 0.3);
      }
    }
  }

  function panel(ctx, x, y, w, h) {
    rect(ctx, x, y, w, h, G[7]);
    rect(ctx, x, y, w, 1, G[10]);
    rect(ctx, x, y, 1, h, G[9]);
    rect(ctx, x, y + h - 1, w, 1, G[3]);
    rect(ctx, x + w - 1, y, 1, h, G[4]);
    rect(ctx, x + 2, y + 2, w - 4, h - 4, G[2]);
    rect(ctx, x + 3, y + 3, w - 6, h - 6, G[0]);
    px(ctx, x + 1, y + 1, G[11]); px(ctx, x + w - 2, y + 1, G[11]);
    px(ctx, x + 1, y + h - 2, G[5]); px(ctx, x + w - 2, y + h - 2, G[5]);
  }

  // ---------- sprites ----------

  var SKULL = [
    '...11111...',
    '.112222211.',
    '12222222221',
    '12EEE2EEE21',
    '12EEE2EEE21',
    '12222N22221',
    '.122NNN221.',
    '..1222221..',
    '..1T1T1T1..',
    '...11111...'
  ];
  var SKULL_EYES = [[3, 3], [4, 3], [5, 3], [3, 4], [4, 4], [5, 4], [7, 3], [8, 3], [9, 3], [7, 4], [8, 4], [9, 4]];
  var SMALL_SKULL = [
    '.22222.',
    '2222222',
    '2EE2EE2',
    '2EE2EE2',
    '222N222',
    '.2T2T2.',
    '..222..'
  ];
  var SMALL_EYES = [[1, 2], [2, 2], [4, 2], [5, 2], [1, 3], [2, 3], [4, 3], [5, 3]];
  var BONE = { '1': G[8], '2': G[11], 'N': G[1], 'T': G[12], 'E': G[0] };

  var TORCH = [
    '111111',
    '.1221.',
    '.1221.',
    '..11..',
    '..11..',
    '..11..',
    '..11..',
    '.1111.'
  ];
  var FLAME = [
    ['..o...', '..oo..', '.orro.', '.orRo.', 'orRRro', 'orRyRo', 'orRyRo', '.rRyr.', '..rr..'],
    ['...o..', '..oo..', '.oro..', '.orRo.', 'orRRro', 'oRRyRo', 'orRyRo', '.rRyr.', '..rr..'],
    ['..o.o.', '.oo.o.', '.orro.', 'orRRo.', 'orRRro', 'orRyRo', 'oRyyRo', '.rRyr.', '..rr..']
  ];
  var FIRE = { 'o': RED.deep, 'r': RED.mid, 'R': RED.hot, 'y': RED.core, 'w': RED.white };

  // ---------- renderer ----------

  // Width of the fire strip from the outer edge, past the chasm lip, to just
  // behind the paddle.
  var PIT_W = 28;
  var FIRE_MAX = 36;
  var FIRE_PAL = (function () {
    function rgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255]; }
    var pal = [];
    for (var h = 0; h <= FIRE_MAX; h++) {
      pal.push(h < 4 ? [0, 0, 0, 0] : h < 9 ? rgb(RED.dark) : h < 14 ? rgb(RED.deep) : h < 20 ? rgb(RED.mid)
        : h < 27 ? rgb(RED.hot) : h < 33 ? rgb(RED.core) : rgb(RED.white));
    }
    return pal;
  })();

  // Sideways "Doom fire": heat enters at the outer edge and spreads inwards,
  // cooling at random and drifting up, so tongues of flame lick toward the
  // paddle. flare (0..1) makes it roar after a ball falls in.
  function Fire(w, h, seed, mirror) {
    this.w = w; this.h = h; this.mirror = mirror;
    this.heat = new Uint8Array(w * h);
    this.src = new Float32Array(h);
    this.rng = makeRng(seed);
    this.cv = canvas(w, h);
    this.img = this.cv.ctx.createImageData(w, h);
    this.flare = 0;
  }
  Fire.prototype.step = function () {
    var w = this.w, h = this.h, H = this.heat, r = this.rng, x, y;
    var top = Math.min(FIRE_MAX, 26 + this.flare * 10), low = top - 22;
    for (y = 0; y < h; y++) {
      // Source heat wanders per row; neighbouring rows pull it smooth.
      var v = this.src[y] + (r() - 0.5) * 12;
      if (y > 0) v = (v * 2 + this.src[y - 1]) / 3;
      this.src[y] = Math.max(low, Math.min(top, v));
      H[y * w] = this.src[y];
    }
    for (x = 1; x < w; x++) {
      for (y = 0; y < h; y++) {
        var sy = y + (r() * 3 | 0) - 1 + (r() < 0.35 ? 1 : 0);
        if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
        var val = H[sy * w + x - 1] - (r() * 3.2 | 0);
        H[y * w + x] = val > 0 ? val : 0;
      }
    }
    var d = this.img.data;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var c = FIRE_PAL[H[y * w + x]], i = (y * w + (this.mirror ? w - 1 - x : x)) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
    }
    this.cv.ctx.putImageData(this.img, 0, 0);
  };

  // ---------- vines ----------

  // Brick hits a vine needs to reach the other paddle: about 60% of all the
  // hits in the field, whatever the length of its random path.
  var VINE_HITS_TO_REACH = 90;

  // A vine that hugs a wall, one point per pixel of x. The left player's vine
  // creeps along the top wall from the left corner toward the right paddle;
  // it rides over the stone edge and sags into the arena between anchor
  // points. The right player's vine is the same turned 180 degrees, along the
  // bottom wall. Leaves, curls and dangling tendrils are placed at random.
  function vinePath(side, rng) {
    var x0 = A.left - 3, endX = A.right - 22;
    var base = A.top - 2, nextAnchor = x0, sagFrom = x0, sagLen = 1, sagDepth = 0;
    var pts = [], leaves = [], curls = [], tendrils = [], gap = 0;
    for (var x = x0; x <= endX; x++) {
      if (x >= nextAnchor) {
        sagFrom = x; sagLen = 14 + (rng() * 30 | 0); nextAnchor = x + sagLen;
        sagDepth = rng() < 0.25 ? 0 : 2 + rng() * 8;
      }
      // The wall line wanders over and just below the stone edge.
      base = Math.max(A.top - 5, Math.min(A.top + 1, base + (rng() - 0.5) * 0.9));
      var y = Math.round(base + sagDepth * Math.sin(Math.PI * (x - sagFrom) / sagLen));
      var i = pts.length;
      pts.push(side === 0 ? { x: x, y: y } : { x: A.left + A.right - 1 - x, y: A.top + A.bottom - 3 - y });
      gap++;
      if (gap > 2 && rng() < 0.3) {
        gap = 0;
        leaves.push({ i: i, up: rng() < 0.45, kind: rng() * LEAVES.length | 0, flip: rng() < 0.5, light: rng() < 0.3 });
      }
      if (rng() < 0.03) curls.push({ i: i, up: rng() < 0.5 });
      if (rng() < 0.035) tendrils.push({ i: i, len: 3 + (rng() * 9 | 0), leaf: rng() < 0.6 });
    }
    return { side: side, pts: pts, leaves: leaves, curls: curls, tendrils: tendrils };
  }

  // Ghoulish green. Growing vines are faded, almost lost in the dark; the vine
  // that wraps a paddle turns sickly bright and pulses.
  var VINE_FADED = { leafLight: '#2d4d31', stem: '#1f3523', mid: '#16281a', shade: '#0b150d', leaf: '#243f29', leafDark: '#142417', bud: '#3a6339', budHot: '#5b9150' };
  var VINE_VIVID = { leafLight: '#b4f096', stem: '#9ee07c', mid: '#5c9e48', shade: '#1f3d1c', leaf: '#7ccf5f', leafDark: '#3c7432', bud: '#c8ffa4', budHot: '#efffe0', glow: '#203f1d' };
  var VINE_PULSE = '#c8ffa4';

  // Leaf shapes, drawn growing up from the stem; flipped for down and mirrored
  // at random.
  var LEAVES = [
    ['.1', '1.'],
    ['..11', '.111', '12..'],
    ['.11.', '1111', '.12.', '..2.'],
    ['1..', '11.', '.12'],
    ['..1', '.11', '11.', '2..']
  ];
  function leafShape(l) {
    var rows = LEAVES[l.kind];
    if (l.flip) rows = rows.map(function (r) { return r.split('').reverse().join(''); });
    return l.up ? rows : rows.slice().reverse();
  }
  var CURL = ['.11.', '1..1', '..1.'];

  // pal: VINE_FADED or VINE_VIVID. pulse swaps the stem to its bright tone.
  function drawVine(ctx, v, len, pal, tipColor, pulse) {
    var n = Math.min(v.pts.length, Math.floor(len)), i;
    var stem = pulse ? VINE_PULSE : pal.stem;
    var leafPal = { '1': pal.leaf, '2': pal.leafDark }, lightPal = { '1': pal.leafLight, '2': pal.leaf };
    // Tendrils hang into the arena: down from the top vine, up from the bottom.
    var hang = v.side === 0 ? 1 : -1;
    for (i = 0; i < v.tendrils.length; i++) {
      var td = v.tendrils[i];
      if (td.i >= n) break;
      var tp0 = v.pts[td.i], ty0 = v.side === 0 ? tp0.y + 3 : tp0.y - 1;
      for (var k = 0; k < td.len; k++) px(ctx, tp0.x + (k > td.len / 2 && td.len > 6 ? (td.i & 1 ? 1 : -1) : 0), ty0 + k * hang, k < 2 ? pal.mid : pal.shade);
      if (td.leaf) sprite(ctx, LEAVES[0], tp0.x - 1, ty0 + td.len * hang - (hang < 0 ? 1 : 0), leafPal);
    }
    for (i = 0; i < n; i++) {
      var p = v.pts[i];
      // A dithered halo around a vivid vine.
      if (pal.glow && ((p.x + i) & 1)) { px(ctx, p.x, p.y - 1, pal.glow); px(ctx, p.x, p.y + 3, pal.glow); }
      px(ctx, p.x, p.y + 2, pal.shade);
      px(ctx, p.x, p.y + 1, pal.mid);
      px(ctx, p.x, p.y, stem);
      // Fill vertical jumps so the stem stays connected.
      if (i > 0 && Math.abs(v.pts[i - 1].y - p.y) > 1) rect(ctx, p.x, Math.min(p.y, v.pts[i - 1].y) + 1, 1, Math.abs(v.pts[i - 1].y - p.y) - 1, stem);
    }
    for (i = 0; i < v.leaves.length; i++) {
      var l = v.leaves[i];
      if (l.i >= n) break;
      var lp = v.pts[l.i];
      var shape = leafShape(l);
      sprite(ctx, shape, lp.x - 1, l.up ? lp.y - shape.length : lp.y + 3, l.light ? lightPal : leafPal);
    }
    for (i = 0; i < v.curls.length; i++) {
      var c = v.curls[i];
      if (c.i >= n) break;
      var cp = v.pts[c.i];
      sprite(ctx, c.up ? CURL : CURL.slice().reverse(), cp.x - 1, c.up ? cp.y - 3 : cp.y + 1, { '1': stem });
    }
    if (n > 0 && tipColor) {
      var tip = v.pts[n - 1];
      px(ctx, tip.x, tip.y, tipColor); px(ctx, tip.x, tip.y - 1, pal.bud);
    }
    return n > 0 ? v.pts[n - 1] : null;
  }

  // Straight vine from (x0, y0) to (x1, y1).
  function vineLine(ctx, x0, y0, x1, y1, color) {
    var steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
    for (var s = 0; s <= steps; s++) {
      var t = steps ? s / steps : 0;
      px(ctx, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), color);
      px(ctx, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t) + 1, VINE_VIVID.mid);
      if (s % 7 === 3) px(ctx, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t) - 1, VINE_VIVID.leaf);
    }
  }

  // Coils around a slowed paddle, with leaves sticking out.
  function drawCoils(ctx, p, frame) {
    var x = Math.round(p.x) - 1, y = Math.round(p.y), w = p.w + 2;
    for (var k = 0; k < 5; k++) {
      var cy = y + 3 + k * 7;
      for (var i = 0; i < w; i++) {
        px(ctx, x + i, cy + (i >> 2), VINE_VIVID.shade);
        px(ctx, x + i, cy + (i >> 2) + 1, (frame >> 4) % 2 ? VINE_PULSE : VINE_VIVID.stem);
      }
      var sway = ((frame >> 4) + k) % 2;
      px(ctx, x - 1 - sway, cy, VINE_VIVID.leaf); px(ctx, x + w + sway, cy + 2, VINE_VIVID.leaf);
    }
  }

  // ---------- lemmings ----------

  var GOO = ['#4e1470', '#7a1fa8', '#a63be0'];
  // Good-paddle colours: halo gold and the pale shield.
  var HOLY = { gold: '#ffe27a', light: '#eaf6ff', mid: '#9fc3e0' };
  var POWER_NAMES = { long: 'LONG PADDLE', shield: 'STONE SHIELD', slow: 'SLOW BALL', cleanse: 'CLEANSE' };
  var POWER_TAGS = { long: 'LONG', shield: 'SHLD', slow: 'SLOW', cleanse: 'PURE' };
  // 3x4 lemming, facing right. Colours follow the reference sheet.
  var LEM_PAL = { 'G': '#18c018', 'S': '#f2d2c8', 'B': '#4848e8' };
  var LEM_WALK = [['GG.', '.S.', 'BB.', 'S.S'], ['GG.', '.S.', '.BS', '.S.']];
  var LEM_FALL = ['SGS', '.S.', '.B.', 'S.S'];
  function mirror(rows) { return rows.map(function (r) { return r.split('').reverse().join(''); }); }

  // Trap door on a brick top. open: 0 shut .. 1 wide open.
  function drawDoor(ctx, d, open) {
    var x = Math.round(d.x), y = d.y - 2;
    rect(ctx, x, y, 7, 2, G[3]);
    rect(ctx, x, y - 1, 7, 1, G[7]);
    var gap = Math.round(open * 5);
    if (gap) rect(ctx, x + 1 + ((5 - gap) >> 1), y, gap, 2, G[0]);
    // Hatch leaves swing up as it opens.
    var lift = Math.round(open * 3);
    for (var k = 1; k <= lift; k++) { px(ctx, x, y - 1 - k, G[8]); px(ctx, x + 6, y - 1 - k, G[8]); }
  }

  // ---------- splatter ----------

  var BLOOD = [RED.dark, RED.deep, RED.mid];

  function Renderer(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.frame = 0;
    this.time = 0;
    this.particles = [];
    this.floorStains = [];
    this.brickStains = {};
    this.brickCache = {};
    this.trail = [];
    this.shake = 0;
    this.rng = makeRng(1234);
    this.torches = [[10, 8], [310, 8]];
    // Fire chasms behind each paddle: index 0 left, 1 right.
    this.pits = [new Fire(PIT_W, A.bottom - A.top, 5, false), new Fire(PIT_W, A.bottom - A.top, 6, true)];
    this.fireClock = 0;
    this.resetMatch();
    this.niches = [[46, 1], [252, 1]];
    this.buildBackground();
    this.paddles = {};
    this.buildGlow();
  }

  Renderer.prototype.buildBackground = function () {
    var bg = canvas(C.W, C.H), ctx = bg.ctx, rng = makeRng(77);
    wall(ctx, 0, 0, C.W, C.H, rng, 16, 8, 3, 5);
    // Side pillars: larger blocks, lighter.
    wall(ctx, 0, A.top - 4, A.left, A.bottom - A.top + 8, rng, 20, 22, 4, 6);
    wall(ctx, A.right, A.top - 4, C.W - A.right, A.bottom - A.top + 8, rng, 20, 22, 4, 6);
    // Floor and lintel: long slabs.
    wall(ctx, A.left, A.bottom, A.right - A.left, C.H - A.bottom, rng, 28, 9, 5, 7);
    wall(ctx, A.left, A.top - 6, A.right - A.left, 6, rng, 24, 6, 5, 6);
    // Arena: black pit with a dithered edge.
    rect(ctx, A.left, A.top, A.right - A.left, A.bottom - A.top, G[0]);
    for (var y = A.top; y < A.bottom; y++) for (var x = A.left; x < A.right; x++) {
      var d = Math.min(x - A.left, A.right - 1 - x, y - A.top, A.bottom - 1 - y);
      if (d < 4 && ((x + y) % 2 === 0) && rng() < 0.9 - d * 0.22) px(ctx, x, y, G[d < 2 ? 2 : 1]);
    }
    // Chasms where the side walls were: black drop with a broken rock lip.
    rect(ctx, 0, A.top, A.left, A.bottom - A.top, G[0]);
    rect(ctx, A.right, A.top, C.W - A.right, A.bottom - A.top, G[0]);
    for (y = A.top; y < A.bottom; y++) {
      if (rng() < 0.7) px(ctx, A.left - 1 + (rng() < 0.3 ? -1 : 0), y, G[rng() < 0.5 ? 4 : 5]);
      if (rng() < 0.7) px(ctx, A.right + (rng() < 0.3 ? 1 : 0), y, G[rng() < 0.5 ? 4 : 5]);
    }
    // Torch brackets.
    for (var t = 0; t < this.torches.length; t++) {
      var tx = this.torches[t][0] - 3, ty = this.torches[t][1] + 9;
      sprite(ctx, TORCH, tx, ty, { '1': G[5], '2': G[8] });
    }
    // Skull niches: dark arches with a skull, above the player panels.
    for (var n = 0; n < this.niches.length; n++) {
      var nx = this.niches[n][0], ny = this.niches[n][1];
      rect(ctx, nx, ny + 3, 22, 18, G[0]);
      rect(ctx, nx + 2, ny + 1, 18, 2, G[0]);
      rect(ctx, nx + 4, ny, 14, 1, G[0]);
      rect(ctx, nx - 1, ny + 3, 1, 18, G[8]);
      rect(ctx, nx + 22, ny + 3, 1, 18, G[3]);
      sprite(ctx, SKULL, nx + 5, ny + 6, BONE);
    }
    // Floor corner skulls.
    sprite(ctx, SMALL_SKULL, 6, 227, BONE);
    sprite(ctx, SMALL_SKULL, C.W - 13, 227, BONE);
    // HUD panels.
    panel(ctx, 108, 2, 104, 15);
    panel(ctx, 116, 19, 88, 22);
    panel(ctx, 40, 24, 34, 15);
    panel(ctx, 246, 24, 34, 15);
    text(ctx, 'ARKANOG', 160, 6, G[11], 1, 'center');
    this.bg = bg.c;
  };

  // Marble pillar of height h. role 'good' gets a gilded capital and base,
  // 'evil' gets darker stone with red veins; anything else is plain.
  Renderer.prototype.paddleSprite = function (h, role) {
    var key = h + ':' + (role || '');
    if (this.paddles[key]) return this.paddles[key];
    var w = C.PADDLE.w + 2, p = canvas(w, h), ctx = p.ctx, rng = makeRng(9);
    var shaft = role === 'evil' ? [G[0], G[6], G[9], G[9], G[8], G[7], G[6], G[5], G[3], G[0]]
      : [G[0], G[8], G[12], G[12], G[11], G[10], G[9], G[7], G[5], G[0]];
    for (var y = 0; y < h; y++) for (var x = 1; x < w - 1; x++) px(ctx, x, y, shaft[x]);
    // Marble veins.
    for (var v = 0; v * 9 + 4 < h - 6; v++) crackLine(ctx, 1, 4 + v * 9, w - 2, 10, rng, role === 'evil' ? RED.deep : G[6], 6);
    // Capital and base.
    var cap = ['1111111111', '1222222221', '.13333331.'];
    var pal = role === 'good' ? { '1': '#b8913a', '2': '#f2dc8c', '3': '#d8b860' }
      : role === 'evil' ? { '1': G[4], '2': G[8], '3': RED.deep } : { '1': G[7], '2': G[12], '3': G[9] };
    sprite(ctx, cap, 0, 0, pal);
    sprite(ctx, cap.slice().reverse(), 0, h - 3, pal);
    return (this.paddles[key] = p.c);
  };

  // Dithered glow halo: a fixed noise per pixel compared with a flickering
  // threshold, so it shimmers but stays pixel-sharp.
  Renderer.prototype.buildGlow = function () {
    var rng = makeRng(31), pts = [];
    for (var y = -14; y <= 14; y++) for (var x = -12; x <= 12; x++) {
      var d = Math.sqrt(x * x + y * y);
      if (d > 3 && d < 14) pts.push({ x: x, y: y, d: d, n: rng() });
    }
    this.glow = pts;
  };

  Renderer.prototype.drawGlow = function (ctx, cx, cy, strength, radius) {
    var pts = this.glow;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.d > radius) continue;
      var gx = cx + p.x, gy = cy + p.y;
      // Light falls on the stone, not into the black pit.
      if (gx >= A.left && gx < A.right && gy >= A.top && gy < A.bottom) continue;
      var f = (1 - p.d / radius) * strength;
      if (((gx + gy) & 1) === 0 && p.n < f * 0.7) px(ctx, gx, gy, p.n < f * 0.25 ? RED.deep : RED.dark);
    }
  };

  Renderer.prototype.brickSprite = function (br) {
    var dmg = br.maxHp - br.hp, key = br.id + ':' + dmg;
    if (this.brickCache[key]) return this.brickCache[key];
    var s = canvas(br.w, br.h), ctx = s.ctx, rng = makeRng(br.id * 97 + 3);
    // Upper slab lighter than the lower one, so they read as two layers.
    // Harder edge bricks are one shade lighter again.
    var base = (br.slab === 0 ? 9 : 7) + (br.maxHp > 1 ? 1 : 0);
    stone(ctx, 0, 0, br.w, br.h, base, rng, rng() < 0.5);
    var crng = makeRng(br.id * 31 + 11);
    for (var d = 0; d < dmg; d++) {
      crackLine(ctx, 0, 0, br.w, br.h, crng, G[base - 4], 4 + d * 3);
      // Chipped corner.
      var cx = crng() < 0.5 ? 0 : br.w - 1, cy = crng() < 0.5 ? 0 : br.h - 1;
      px(ctx, cx, cy, G[0]);
    }
    this.brickCache[key] = s.c;
    return s.c;
  };

  // Target length of each vine from the rules state. A vine that wrapped the
  // other paddle runs its full path.
  Renderer.prototype.syncVines = function (state) {
    var vs = state.ext && state.ext.vines;
    if (!vs) return;
    for (var i = 0; i < 2; i++) {
      var full = this.vines[i].pts.length;
      this.vineTarget[i] = vs.wrapped === 1 - i ? full : Math.min(full, Math.round(vs.hits[i] * full / VINE_HITS_TO_REACH));
    }
  };

  // React to simulation events with cosmetic effects.
  Renderer.prototype.onEvents = function (state, events) {
    this.state = state;
    if (events.length) this.syncVines(state);
    for (var i = 0; i < events.length; i++) {
      var e = events[i], rng = this.rng, n, k;
      if (e.type === 'brickHit') {
        n = 8 + (rng() * 7 | 0);
        for (k = 0; k < n; k++) this.blood(e.x, e.y, (rng() * 2 - 1) * 55, -rng() * 70 - 5);
        var br = state.bricks[e.brick], st = this.brickStains[e.brick] || (this.brickStains[e.brick] = []);
        for (k = 0; k < 4; k++) st.push({ x: rng() * br.w | 0, y: rng() * br.h | 0, c: BLOOD[rng() * 3 | 0] });
        // The ball picks up blood.
        if (this.ballBlood.length < 6) this.ballBlood.push({ x: rng() * 4 | 0, y: rng() * 4 | 0, c: rng() < 0.5 ? RED.mid : RED.hot });
      } else if (e.type === 'brickBreak') {
        for (k = 0; k < 26; k++) this.blood(e.x, e.y, (rng() * 2 - 1) * 80, -rng() * 90);
        for (k = 0; k < 12; k++) this.particles.push({ x: e.x + (rng() * 16 - 8), y: e.y + (rng() * 8 - 4), vx: (rng() * 2 - 1) * 50, vy: -rng() * 50, c: G[6 + (rng() * 4 | 0)], life: 0.6 + rng() * 0.5, kind: 'chip' });
      } else if (e.type === 'paddleHit') {
        for (k = 0; k < 4; k++) this.particles.push({ x: e.x + 2, y: e.y + 2, vx: (e.side === 0 ? 1 : -1) * rng() * 60, vy: (rng() * 2 - 1) * 60, c: G[12], life: 0.15 + rng() * 0.1, kind: 'spark' });
        // A bloody or slimy ball smears the paddle and sprays a little.
        var dirty = this.ballBlood.concat(this.ballGoo);
        if (dirty.length) {
          var pd = state.paddles[e.side], ps = this.paddleStains[e.side];
          for (k = 0; k < Math.min(4, dirty.length + 1); k++) {
            ps.push({ x: e.side === 0 ? pd.w - (rng() * 3 | 0) : 1 + (rng() * 3 | 0), y: Math.max(0, Math.min(pd.h - 1, Math.round(e.y - pd.y + rng() * 6 - 1))), c: dirty[(rng() * dirty.length) | 0].c });
            var gooey = this.ballGoo.length && rng() < 0.5;
            this.particles.push({ x: e.x + 2, y: e.y + 2, vx: (e.side === 0 ? 1 : -1) * (20 + rng() * 50), vy: -rng() * 50, c: gooey ? GOO[1] : RED.mid, life: 3, kind: gooey ? 'goo' : 'blood' });
          }
          if (ps.length > 60) ps.splice(0, ps.length - 60);
        }
      } else if (e.type === 'lemSplat') {
        // Purple splatter. A ball kill also smears the ball until next serve.
        for (k = 0; k < (e.cause === 'ball' ? 30 : 18); k++) {
          this.particles.push({ x: e.x, y: e.y, vx: (rng() * 2 - 1) * 70, vy: -rng() * (e.cause === 'floor' ? 55 : 100), c: GOO[rng() * 3 | 0], life: 3, kind: 'goo' });
        }
        if (e.cause === 'ball') for (k = 0; k < 3; k++) this.ballGoo.push({ x: rng() * 4 | 0, y: rng() * 4 | 0, c: GOO[1 + (rng() * 2 | 0)] });
      } else if (e.type === 'lemSaved' || e.type === 'lemHome') {
        for (k = 0; k < (e.type === 'lemHome' ? 10 : 6); k++) {
          this.particles.push({ x: e.x, y: e.y, vx: (rng() * 2 - 1) * 30, vy: -20 - rng() * 40, c: rng() < 0.5 ? HOLY.gold : HOLY.light, life: 0.5 + rng() * 0.4, kind: 'ember' });
        }
      } else if (e.type === 'power') {
        this.powerFlash = 3;
        this.powerText = POWER_NAMES[e.name];
        this.powerSide = e.side;
      } else if (e.type === 'shieldBlock') {
        this.shake = 0.2;
        for (k = 0; k < 14; k++) this.particles.push({ x: e.x + 2, y: e.y + 2, vx: (e.side === 0 ? 1 : -1) * rng() * 80, vy: (rng() * 2 - 1) * 70, c: HOLY.light, life: 0.3 + rng() * 0.3, kind: 'spark' });
      } else if (e.type === 'curse') {
        this.curseFlash = 2.5;
        this.curseTarget = e.target;
      } else if (e.type === 'serve') {
        this.ballGoo = [];
        this.ballBlood = [];
      } else if (e.type === 'vineWrap') {
        this.wrapFlash = 3;
        this.shake = 0.3;
      } else if (e.type === 'score') {
        this.shake = 0.25;
        var pit = e.side === 1 ? 0 : 1, ey = state.ball.y;
        this.pits[pit].flare = 1;
        for (k = 0; k < 16; k++) {
          this.particles.push({ x: pit === 0 ? rng() * 14 + 4 : C.W - 4 - rng() * 14, y: ey + rng() * 8 - 4,
            vx: (pit === 0 ? 1 : -1) * rng() * 30, vy: -40 - rng() * 70, c: rng() < 0.5 ? RED.core : RED.white, life: 0.5 + rng() * 0.5, kind: 'ember' });
        }
      }
    }
  };

  Renderer.prototype.blood = function (x, y, vx, vy) {
    var r = this.rng();
    this.particles.push({ x: x, y: y, vx: vx, vy: vy, c: r < 0.3 ? RED.hot : r < 0.75 ? RED.mid : RED.deep, life: 3, kind: 'blood' });
  };

  Renderer.prototype.update = function (dt) {
    this.time += dt;
    this.frame++;
    if (this.shake > 0) this.shake -= dt;
    var keep = [];
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      p.vy += (p.kind === 'spark' ? 0 : p.kind === 'ember' ? -30 : 240) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
      if ((p.kind === 'blood' || p.kind === 'goo') && p.y >= A.bottom - 1) {
        var stainC = p.kind === 'goo' ? GOO[this.rng() < 0.5 ? 0 : 1] : this.rng() < 0.5 ? RED.dark : RED.deep;
        if (p.x >= A.left && p.x < A.right) this.floorStains.push({ x: p.x | 0, y: A.bottom - 1 - (this.rng() < 0.3 ? 1 : 0), c: stainC });
        continue;
      }
      // Drops stick to the first live brick they fly into.
      if ((p.kind === 'blood' || p.kind === 'goo') && this.state && p.vy > 0) {
        var hit = null, bricks = this.state.bricks;
        for (var b = 0; b < bricks.length; b++) {
          var bk = bricks[b];
          if (bk.hp > 0 && p.x >= bk.x && p.x < bk.x + bk.w && p.y >= bk.y && p.y < bk.y + bk.h) { hit = bk; break; }
        }
        if (hit) {
          (this.brickStains[hit.id] || (this.brickStains[hit.id] = [])).push({ x: (p.x - hit.x) | 0, y: (p.y - hit.y) | 0, c: p.c });
          continue;
        }
      }
      var inside = p.kind === 'ember' ? p.x >= 0 && p.x < C.W : p.x > A.left && p.x < A.right;
      if (p.life > 0 && inside && p.y > A.top - 2) keep.push(p);
    }
    this.particles = keep;
    // Vines creep toward their target length instead of jumping.
    if (this.wrapFlash > 0) this.wrapFlash -= dt;
    if (this.curseFlash > 0) this.curseFlash -= dt;
    if (this.powerFlash > 0) this.powerFlash -= dt;
    for (var vi = 0; vi < 2; vi++) {
      var gap = this.vineTarget[vi] - this.vineShown[vi];
      this.vineShown[vi] += gap > 0 ? Math.min(gap, Math.max(12, gap * 2) * dt) : gap;
    }
    // Fire runs at 30 steps a second, whatever the frame rate.
    this.fireClock += dt;
    while (this.fireClock >= 1 / 30) {
      this.fireClock -= 1 / 30;
      for (var f = 0; f < 2; f++) {
        this.pits[f].flare = Math.max(0, this.pits[f].flare - 1 / 30 / 0.9);
        this.pits[f].step();
      }
    }
    if (this.floorStains.length > 1500) this.floorStains.splice(0, this.floorStains.length - 1500);
    // A bloody ball drips as it flies.
    var bs = this.state && this.state.ball;
    if (bs && this.state.phase === 'play' && (this.ballBlood.length || this.ballGoo.length)) {
      this.dripClock -= dt;
      if (this.dripClock <= 0) {
        this.dripClock = 0.18 - Math.min(0.12, (this.ballBlood.length + this.ballGoo.length) * 0.015);
        var goo = this.ballGoo.length && this.rng() < 0.5;
        this.particles.push({ x: bs.x + 2, y: bs.y + 3, vx: bs.vx * 0.15, vy: 10, c: goo ? GOO[1] : RED.mid, life: 3, kind: goo ? 'goo' : 'blood' });
      }
    }
  };

  // A new match: bricks are rebuilt, so their cracks and blood go too.
  Renderer.prototype.resetMatch = function () {
    var vr = makeRng((Math.random() * 0x7fffffff) | 0);
    this.vines = [vinePath(0, vr), vinePath(1, vr)];
    this.vineShown = [0, 0];
    this.vineTarget = [0, 0];
    this.wrapFlash = 0;
    this.ballGoo = [];
    this.ballBlood = [];
    this.paddleStains = [[], []];
    this.dripClock = 0;
    this.curseFlash = 0;
    this.curseTarget = 0;
    this.powerFlash = 0;
    this.brickStains = {};
    this.floorStains = [];
    this.particles = [];
  };

  Renderer.prototype.draw = function (state, view) {
    var ctx = this.ctx, i;
    var sx = 0, sy = 0;
    if (this.shake > 0) { sx = (this.frame % 2 ? 1 : -1); sy = (this.frame % 3 ? 1 : 0); }
    ctx.setTransform(1, 0, 0, 1, sx, sy);
    ctx.drawImage(this.bg, 0, 0);

    this.drawFire(ctx);
    ctx.drawImage(this.pits[0].cv.c, 0, A.top);
    ctx.drawImage(this.pits[1].cv.c, C.W - PIT_W, A.top);
    this.drawEyes(ctx);

    // Vines, behind everything that is in play.
    var vs = state.ext && state.ext.vines, tips = [null, null];
    this.syncVines(state);
    if (vs) {
      for (i = 0; i < 2; i++) {
        var growing = this.vineShown[i] < this.vineTarget[i];
        var vivid = vs.wrapped === 1 - i;
        var pal = vivid ? VINE_VIVID : VINE_FADED;
        tips[i] = drawVine(ctx, this.vines[i], this.vineShown[i], pal, growing && (this.frame >> 3) % 2 ? pal.budHot : pal.bud, vivid && (this.frame >> 4) % 2);
      }
    }

    // Floor blood.
    for (i = 0; i < this.floorStains.length; i++) px(ctx, this.floorStains[i].x, this.floorStains[i].y, this.floorStains[i].c);

    // Bricks.
    for (i = 0; i < state.bricks.length; i++) {
      var br = state.bricks[i];
      if (br.hp <= 0) continue;
      ctx.drawImage(this.brickSprite(br), br.x, br.y);
      var st = this.brickStains[br.id];
      if (st) for (var k = 0; k < st.length; k++) px(ctx, br.x + st[k].x, br.y + st[k].y, st[k].c);
    }

    // Lemmings mode: trap doors and lemmings.
    var lm = state.ext && state.ext.lem;
    if (lm) {
      for (i = 0; i < lm.doors.length; i++) {
        var dr = lm.doors[i];
        var open = dr.left > 0 ? Math.min(1, dr.t / 0.6) : Math.max(0, Math.min(1, dr.close / 0.6));
        drawDoor(ctx, dr, open);
      }
      for (i = 0; i < lm.lems.length; i++) {
        var le = lm.lems[i];
        var rows = le.falling ? LEM_FALL : LEM_WALK[((this.time * 6) | 0) + le.id & 1];
        sprite(ctx, le.dir < 0 ? mirror(rows) : rows, Math.round(le.x), Math.round(le.y), LEM_PAL);
        if (le.saved) px(ctx, Math.round(le.x) + 1, Math.round(le.y) - 1, HOLY.gold);
      }
    }

    // Paddles.
    for (i = 0; i < 2; i++) {
      var p = state.paddles[i];
      if (p.shield) {
        // Stone shield: a pale shimmering line at the chasm edge.
        var sx = i === 0 ? A.left - 1 : A.right;
        for (var sy = A.top; sy < A.bottom; sy++) if (((sy + (this.frame >> 2)) % 4) < 3) px(ctx, sx, sy, (sy + (this.frame >> 3)) % 8 < 4 ? HOLY.light : HOLY.mid);
      }
      if (p.hidden) continue;
      ctx.drawImage(this.paddleSprite(p.h, lm && lm.roles ? lm.roles[i] : ''), Math.round(p.x) - 1, Math.round(p.y));
      var pst = this.paddleStains[i];
      for (var q2 = 0; q2 < pst.length; q2++) px(ctx, Math.round(p.x) - 1 + pst[q2].x, Math.round(p.y) + pst[q2].y, pst[q2].c);
    }
    // A wrapped paddle: the winning vine runs taut from its end to the coils.
    if (vs && vs.wrapped >= 0) {
      var own = 1 - vs.wrapped, wp = state.paddles[vs.wrapped], tp = tips[own];
      if (tp && !wp.hidden && this.vineShown[own] >= this.vines[own].pts.length - 1) {
        vineLine(ctx, tp.x, tp.y, vs.wrapped === 1 ? wp.x - 1 : wp.x + wp.w, wp.y + wp.h / 2, (this.frame >> 4) % 2 ? VINE_PULSE : VINE_VIVID.stem);
        drawCoils(ctx, wp, this.frame);
      }
    }

    // Ball and a short ghost trail when it is fast.
    var b = state.ball;
    if (state.phase === 'play' || state.phase === 'serve') {
      var fast = b.speed > C.BALL.speed * 1.3;
      if (fast) for (i = 0; i < this.trail.length; i++) {
        var t = this.trail[i];
        rect(ctx, t.x + 1, t.y + 1, 2, 2, i === this.trail.length - 1 ? G[6] : G[3]);
      }
      var bx = Math.round(b.x), by = Math.round(b.y);
      rect(ctx, bx, by, 4, 4, G[13]);
      px(ctx, bx + 3, by + 3, G[9]); px(ctx, bx + 3, by, G[11]); px(ctx, bx, by + 3, G[11]);
      for (i = 0; i < this.ballBlood.length; i++) px(ctx, bx + this.ballBlood[i].x, by + this.ballBlood[i].y, this.ballBlood[i].c);
      for (i = 0; i < this.ballGoo.length; i++) px(ctx, bx + this.ballGoo[i].x, by + this.ballGoo[i].y, this.ballGoo[i].c);
      this.trail.push({ x: bx, y: by });
      if (this.trail.length > 3) this.trail.shift();
    } else this.trail = [];

    // Particles.
    for (i = 0; i < this.particles.length; i++) {
      var q = this.particles[i];
      px(ctx, q.x, q.y, q.c);
      if (q.kind === 'blood' && q.vy > 60) px(ctx, q.x, q.y - 1, RED.deep);
    }

    // HUD.
    var sc = (state.score[0] < 10 ? '0' : '') + state.score[0] + ':' + (state.score[1] < 10 ? '0' : '') + state.score[1];
    text(ctx, sc, 160, 23, G[12], 2, 'center');
    text(ctx, view.names[0], 57, 28, G[11], 1, 'center');
    text(ctx, view.names[1], 263, 28, G[11], 1, 'center');
    if (vs) {
      var tags = [this.hudLem(state, lm, 0), this.hudLem(state, lm, 1)];
      text(ctx, 'VINE ' + vs.hits[0] + tags[0], 18, 229, G[9], 1, 'left');
      text(ctx, tags[1].trim() + (tags[1] ? '  ' : '') + 'VINE ' + vs.hits[1], C.W - 18, 229, G[9], 1, 'right');
    }
    if (this.powerFlash > 0 && (this.frame >> 3) % 2) {
      text(ctx, view.names[this.powerSide] + ' POWER: ' + this.powerText, 160, A.top + 26, HOLY.gold, 1, 'center', '#5a4410');
    }
    if (lm && lm.curse && this.curseFlash > 0 && (this.frame >> 3) % 2) {
      text(ctx, view.names[this.curseTarget] + ' CURSED - BLINKING', 160, A.top + 16, GOO[2], 1, 'center', GOO[0]);
    }
    if (vs && vs.wrapped >= 0 && this.wrapFlash > 0 && (this.frame >> 3) % 2) {
      text(ctx, view.names[vs.wrapped] + ' ENTANGLED - HALF SPEED', 160, A.top + 6, VINE_VIVID.bud, 1, 'center', VINE_VIVID.shade);
    }
    if (state.phase === 'serve' && view.screen === 'play') {
      var side = state.server, py = state.paddles[side];
      var ly = py.y > A.top + 14 ? py.y - 11 : py.y + py.h + 4;
      if ((this.frame >> 4) % 2) text(ctx, 'SERVE', py.x + py.w / 2, ly, G[8], 1, 'center');
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  Renderer.prototype.drawFire = function (ctx) {
    for (var t = 0; t < this.torches.length; t++) {
      var tx = this.torches[t][0], ty = this.torches[t][1];
      var f = ((this.frame >> 3) + t) % FLAME.length;
      var flick = 0.75 + 0.25 * Math.sin(this.time * 9 + t * 2.1) + 0.1 * Math.sin(this.time * 23 + t);
      this.drawGlow(ctx, tx, ty + 4, flick, 13);
      sprite(ctx, FLAME[f], tx - 3, ty, FIRE);
      if ((this.frame >> 2) % 3 === 0) px(ctx, tx, ty + 6, RED.white);
    }
  };

  Renderer.prototype.drawEyes = function (ctx) {
    var pulse = 0.5 + 0.5 * Math.sin(this.time * 2.4);
    var eye = pulse > 0.66 ? RED.hot : pulse > 0.33 ? RED.mid : RED.deep;
    for (var n = 0; n < this.niches.length; n++) {
      var sx = this.niches[n][0] + 5, sy = this.niches[n][1] + 6;
      this.drawGlow(ctx, sx + 5, sy + 4, 0.35 + pulse * 0.5, 9);
      for (var i = 0; i < SKULL_EYES.length; i++) px(ctx, sx + SKULL_EYES[i][0], sy + SKULL_EYES[i][1], eye);
      px(ctx, sx + 4, sy + 3, RED.core); px(ctx, sx + 8, sy + 3, RED.core);
    }
    var small = [[6, 227], [C.W - 13, 227]];
    for (var s = 0; s < small.length; s++) for (var j = 0; j < SMALL_EYES.length; j++) {
      px(ctx, small[s][0] + SMALL_EYES[j][0], small[s][1] + SMALL_EYES[j][1], pulse > 0.5 ? RED.mid : RED.deep);
    }
  };

  // Lemmings part of the floor counter for one side: kills, or saves for the
  // good paddle, plus tags for active power-ups.
  Renderer.prototype.hudLem = function (state, lm, i) {
    if (!lm) return '';
    var role = lm.roles ? lm.roles[i] : 'evil', p = state.paddles[i];
    var t = role === 'good' ? '  SAVED ' + lm.saved[i] : '  LEM ' + lm.killed[i];
    if (role === 'good') {
      if (lm.long[i] > 0) t += ' ' + POWER_TAGS.long;
      if (p.shield) t += ' ' + POWER_TAGS.shield;
      if (lm.slow > 0) t += ' ' + POWER_TAGS.slow;
      if (lm.immune[i] > 0) t += ' ' + POWER_TAGS.cleanse;
    }
    return t;
  };

  // Darkens the arena with a checkerboard so overlay text reads clearly.
  Renderer.prototype.dim = function () {
    var ctx = this.ctx;
    ctx.fillStyle = G[0];
    for (var y = A.top; y < A.bottom; y++) for (var x = A.left + (y & 1); x < A.right; x += 2) ctx.fillRect(x, y, 1, 1);
  };

  // Solid framed box for menus, centred in the arena.
  Renderer.prototype.box = function (w, h) {
    this.dim();
    var x = Math.round((A.left + A.right - w) / 2), y = Math.round((A.top + A.bottom - h) / 2);
    panel(this.ctx, x, y, w, h);
    return { x: x, y: y };
  };

  Renderer.prototype.text = function (str, x, y, color, scale, align) { text(this.ctx, str, x, y, color || G[11], scale, align); };
  Renderer.prototype.redText = function (str, x, y, scale, align) { text(this.ctx, str, x, y, RED.hot, scale, align, RED.dark); };

  root.Arkanog.Render = { Renderer: Renderer, G: G, RED: RED };
})(this);
