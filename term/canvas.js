// A pixel-buffer stand-in for the browser canvas, with only the parts of the
// 2D context that the game uses: solid hex fills, canvas-to-canvas copies,
// translate-only transforms and image data. No smoothing, no blending beyond
// on/off alpha, which is all the pixel art needs.
'use strict';

var colorCache = {};
function parseColor(c) {
  var v = colorCache[c];
  if (v) return v;
  var m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) throw new Error('canvas shim: unsupported colour ' + c);
  var n = parseInt(m[1], 16);
  return (colorCache[c] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
}

function Context(cv) {
  this.canvas = cv;
  this.fillStyle = '#000000';
  this.imageSmoothingEnabled = false;
  this.tx = 0;
  this.ty = 0;
}

Context.prototype.setTransform = function (a, b, c, d, e, f) {
  if (a !== 1 || b !== 0 || c !== 0 || d !== 1) throw new Error('canvas shim: only translation is supported');
  this.tx = e | 0;
  this.ty = f | 0;
};

Context.prototype.fillRect = function (x, y, w, h) {
  var cv = this.canvas, data = cv.data, rgb = parseColor(this.fillStyle);
  var x0 = Math.max(0, Math.round(x) + this.tx), y0 = Math.max(0, Math.round(y) + this.ty);
  var x1 = Math.min(cv.width, Math.round(x) + this.tx + Math.round(w)), y1 = Math.min(cv.height, Math.round(y) + this.ty + Math.round(h));
  for (var yy = y0; yy < y1; yy++) {
    for (var i = (yy * cv.width + x0) * 4, end = (yy * cv.width + x1) * 4; i < end; i += 4) {
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
    }
  }
};

Context.prototype.clearRect = function (x, y, w, h) {
  var cv = this.canvas;
  var x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(cv.width, (x + w) | 0), y1 = Math.min(cv.height, (y + h) | 0);
  for (var yy = y0; yy < y1; yy++) cv.data.fill(0, (yy * cv.width + x0) * 4, (yy * cv.width + x1) * 4);
};

// drawImage(source, dx, dy): whole source, no scaling. Pixels with alpha 0
// are skipped; anything else is copied.
Context.prototype.drawImage = function (src, dx, dy) {
  if (arguments.length !== 3) throw new Error('canvas shim: only drawImage(img, x, y) is supported');
  var cv = this.canvas, d = cv.data, s = src.data;
  var ox = Math.round(dx) + this.tx, oy = Math.round(dy) + this.ty;
  var sx0 = Math.max(0, -ox), sy0 = Math.max(0, -oy);
  var sx1 = Math.min(src.width, cv.width - ox), sy1 = Math.min(src.height, cv.height - oy);
  for (var y = sy0; y < sy1; y++) {
    var si = (y * src.width + sx0) * 4, di = ((y + oy) * cv.width + sx0 + ox) * 4;
    for (var x = sx0; x < sx1; x++, si += 4, di += 4) {
      if (s[si + 3] === 0) continue;
      d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = 255;
    }
  }
};

Context.prototype.createImageData = function (w, h) {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
};

// Like the browser, putImageData ignores the transform and replaces pixels.
Context.prototype.putImageData = function (img, x, y) {
  var cv = this.canvas;
  for (var yy = 0; yy < img.height; yy++) {
    var ty = yy + y;
    if (ty < 0 || ty >= cv.height) continue;
    for (var xx = 0; xx < img.width; xx++) {
      var tx = xx + x;
      if (tx < 0 || tx >= cv.width) continue;
      var si = (yy * img.width + xx) * 4, di = (ty * cv.width + tx) * 4;
      cv.data[di] = img.data[si]; cv.data[di + 1] = img.data[si + 1]; cv.data[di + 2] = img.data[si + 2]; cv.data[di + 3] = img.data[si + 3];
    }
  }
};

function Canvas(w, h) {
  this.style = {};
  this._w = 0; this._h = 0;
  this.width = w || 300;
  this.height = h || 150;
  this.ctx = null;
}
// Setting a size clears the canvas, as in the browser.
Object.defineProperty(Canvas.prototype, 'width', {
  get: function () { return this._w; },
  set: function (v) { this._w = v | 0; this.data = new Uint8ClampedArray(this._w * this._h * 4); }
});
Object.defineProperty(Canvas.prototype, 'height', {
  get: function () { return this._h; },
  set: function (v) { this._h = v | 0; this.data = new Uint8ClampedArray(this._w * this._h * 4); }
});
Canvas.prototype.getContext = function (type) {
  if (type !== '2d') throw new Error('canvas shim: only 2d');
  return this.ctx || (this.ctx = new Context(this));
};

module.exports = { Canvas: Canvas, parseColor: parseColor };
