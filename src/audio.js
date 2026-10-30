// Chiptune sound: pulse, triangle and noise voices made with WebAudio.
// No audio files. Browsers only allow sound after a user gesture, so
// unlock() runs on the first key press.
(function (root) {
  'use strict';

  function midi(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function Sound() {
    this.ctx = null;
    this.musicOn = load('arkanog.music', true);
    this.sfxOn = load('arkanog.sfx', true);
    this.playing = false;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
  }

  function load(key, def) {
    try { var v = localStorage.getItem(key); return v == null ? def : v === '1'; } catch (e) { return def; }
  }
  function save(key, v) { try { localStorage.setItem(key, v ? '1' : '0'); } catch (e) { /* private mode */ } }

  Sound.prototype.unlock = function () {
    if (!this.ctx) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      var ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(ctx.destination);
      this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicOn ? 0.32 : 0; this.musicBus.connect(this.master);
      this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.sfxOn ? 0.6 : 0; this.sfxBus.connect(this.master);
      this.pulse25 = pulseWave(ctx, 0.25);
      this.pulse12 = pulseWave(ctx, 0.125);
      var len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = this.noise.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  };

  // Pulse wave with the given duty cycle, from its Fourier series.
  function pulseWave(ctx, duty) {
    var n = 32, real = new Float32Array(n), imag = new Float32Array(n);
    for (var k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return ctx.createPeriodicWave(real, imag);
  }

  // One note on a voice. type: 'square' | 'triangle' | 'pulse25' | 'pulse12'.
  Sound.prototype.tone = function (bus, type, freq, t, dur, vol, slideTo) {
    var ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    if (type === 'pulse25') o.setPeriodicWave(this.pulse25);
    else if (type === 'pulse12') o.setPeriodicWave(this.pulse12);
    else o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(bus);
    o.start(t); o.stop(t + dur + 0.02);
  };

  Sound.prototype.hiss = function (bus, t, dur, vol, filter, freq, freqTo) {
    var ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise;
    f.type = filter; f.frequency.setValueAtTime(freq, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  };

  // ---------- sound effects ----------

  Sound.prototype.onEvents = function (state, events) {
    if (!this.ctx || !this.sfxOn) return;
    for (var i = 0; i < events.length; i++) this.sfx(events[i], state);
  };

  Sound.prototype.sfx = function (e, state) {
    var t = this.ctx.currentTime, bus = this.sfxBus;
    switch (e.type) {
      case 'paddleHit':
        this.tone(bus, 'pulse25', 480 + Math.min(state.rally, 12) * 28, t, 0.08, 0.5);
        break;
      case 'wallHit':
        this.tone(bus, 'square', 240, t, 0.04, 0.25);
        break;
      case 'brickHit':
        this.hiss(bus, t, 0.09, 0.5, 'bandpass', 1400, 400);
        this.tone(bus, 'square', 150, t, 0.1, 0.35, 70);
        break;
      case 'brickBreak':
        this.hiss(bus, t, 0.35, 0.6, 'lowpass', 3000, 200);
        this.tone(bus, 'square', 220, t, 0.3, 0.35, 45);
        break;
      case 'serve':
        this.tone(bus, 'pulse12', 880, t, 0.05, 0.3);
        break;
      case 'vineWrap':
        this.tone(bus, 'square', 110, t, 0.7, 0.4, 55);
        this.hiss(bus, t, 0.5, 0.3, 'bandpass', 600, 200);
        break;
      case 'score':
        // The ball drops into the fire chasm.
        this.hiss(bus, t, 0.6, 0.5, 'lowpass', 900, 120);
        [659, 494, 330].forEach(function (f, k) { this.tone(bus, 'square', f, t + k * 0.09, 0.09, 0.35); }, this);
        break;
      case 'matchEnd':
        [57, 60, 64, 69, 72, 76, 81].forEach(function (m, k) { this.tone(bus, 'pulse25', midi(m), t + 0.3 + k * 0.1, k === 6 ? 0.8 : 0.12, 0.4); }, this);
        break;
    }
  };

  Sound.prototype.blip = function () {
    if (!this.ctx || !this.sfxOn) return;
    this.tone(this.sfxBus, 'pulse12', 660, this.ctx.currentTime, 0.05, 0.3);
  };

  // ---------- music ----------
  // 8 bars of 16 steps, A minor. Bars 0-3: arpeggios. Bars 4-7: lead melody.

  var BPM = 132;
  var CHORDS = [
    { bass: 45, arp: [69, 72, 76] }, { bass: 41, arp: [65, 69, 72] },
    { bass: 43, arp: [67, 71, 74] }, { bass: 40, arp: [64, 68, 71] },
    { bass: 45, arp: [69, 72, 76] }, { bass: 38, arp: [62, 65, 69] },
    { bass: 40, arp: [64, 68, 71] }, { bass: 40, arp: [64, 68, 71] }
  ];
  // Eighth notes per bar for bars 4-7; 0 = rest.
  var LEAD = [
    [76, 0, 72, 76, 81, 0, 79, 0],
    [77, 0, 74, 77, 81, 0, 77, 76],
    [76, 0, 71, 68, 71, 0, 74, 0],
    [76, 74, 72, 71, 68, 0, 64, 0]
  ];

  Sound.prototype.startMusic = function () {
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    var self = this;
    this.timer = setInterval(function () { self.schedule(); }, 25);
  };

  Sound.prototype.stopMusic = function () {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  };

  Sound.prototype.schedule = function () {
    var dur = 60 / BPM / 4, now = this.ctx.currentTime;
    // After a stall (background tab, slow frame) drop the missed steps and
    // keep the beat, instead of queuing all of them at once.
    if (this.nextTime < now) {
      var missed = Math.ceil((now - this.nextTime) / dur);
      this.step = (this.step + missed) % (16 * 8);
      this.nextTime += missed * dur;
    }
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime, dur);
      this.step = (this.step + 1) % (16 * 8);
      this.nextTime += dur;
    }
  };

  Sound.prototype.playStep = function (step, t, dur) {
    var bar = step >> 4, s = step & 15, ch = CHORDS[bar], bus = this.musicBus;
    if (s % 2 === 0) this.tone(bus, 'triangle', midi(ch.bass + ((s >> 1) % 2 ? 12 : 0)), t, dur * 1.8, 0.7);
    this.tone(bus, 'pulse12', midi(ch.arp[s % 3] + (bar < 4 ? 0 : 12)), t, dur * 0.9, bar < 4 ? 0.22 : 0.1);
    if (bar >= 4 && s % 2 === 0) {
      var n = LEAD[bar - 4][s >> 1];
      if (n) this.tone(bus, 'pulse25', midi(n), t, dur * 1.9, 0.3);
    }
    if (s === 0 || s === 8) this.tone(bus, 'sine', 150, t, 0.12, 0.8, 40);
    if (s === 4 || s === 12) this.hiss(bus, t, 0.1, 0.35, 'bandpass', 1800);
    if (s % 2 === 0) this.hiss(bus, t, 0.025, 0.12, 'highpass', 7000);
  };

  Sound.prototype.toggleMusic = function () {
    this.musicOn = !this.musicOn; save('arkanog.music', this.musicOn);
    if (this.musicBus) this.musicBus.gain.value = this.musicOn ? 0.32 : 0;
  };
  Sound.prototype.toggleSfx = function () {
    this.sfxOn = !this.sfxOn; save('arkanog.sfx', this.sfxOn);
    if (this.sfxBus) this.sfxBus.gain.value = this.sfxOn ? 0.6 : 0;
  };

  root.Arkanog.Sound = Sound;
})(this);
