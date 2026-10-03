// Tiny procedural sound engine: no audio files needed.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
  }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.music = this.ctx.createGain(); this.music.gain.value = 0.22; this.music.connect(this.master);
    // shared noise buffer
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
    this.nextNote = this.ctx.currentTime + 1;
    this.chordIdx = 0;
  }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }
  get t() { return this.ctx.currentTime; }

  noise(dur, { freq = 1000, q = 1, type = 'bandpass', gain = 0.3, attack = 0.005, out } = {}) {
    if (!this.ctx) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, this.t);
    g.gain.linearRampToValueAtTime(gain, this.t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, this.t + dur);
    s.connect(f); f.connect(g); g.connect(out || this.sfx);
    s.start(this.t, Math.random()); s.stop(this.t + dur + 0.05);
  }
  tone(freq, dur, { type = 'sine', gain = 0.2, attack = 0.005, slide = 0, delay = 0, out } = {}) {
    if (!this.ctx) return;
    const t0 = this.t + delay;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(out || this.sfx);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  step() { this.noise(0.09, { freq: 500 + Math.random() * 400, q: 0.8, gain: 0.12 }); }
  swim() { this.noise(0.35, { freq: 900, q: 0.5, type: 'lowpass', gain: 0.15, attack: 0.08 }); }
  jump() { this.tone(330, 0.16, { type: 'triangle', gain: 0.08, slide: 1.8 }); }
  land() { this.noise(0.12, { freq: 260, q: 0.7, gain: 0.22 }); }
  splash() { this.noise(0.6, { freq: 1200, q: 0.4, type: 'lowpass', gain: 0.35, attack: 0.01 }); }
  bounce() { this.tone(180, 0.35, { type: 'sine', gain: 0.25, slide: 3.2 }); this.tone(360, 0.25, { type: 'triangle', gain: 0.06, slide: 2.5 }); }
  kick() { this.noise(0.08, { freq: 300, q: 1, gain: 0.3 }); this.tone(140, 0.12, { gain: 0.15, slide: 0.6 }); }
  pickup(n = 0) {
    const base = [523.25, 587.33, 659.25, 783.99, 880][n % 5];
    this.tone(base, 0.25, { type: 'triangle', gain: 0.12 });
    this.tone(base * 1.5, 0.35, { type: 'sine', gain: 0.1, delay: 0.07 });
    this.tone(base * 2, 0.5, { type: 'sine', gain: 0.06, delay: 0.14 });
  }
  discover() {
    [392, 523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, 0.8, { type: 'triangle', gain: 0.09, delay: i * 0.11 }));
  }
  heart() { this.tone(660, 0.18, { gain: 0.1, slide: 1.3 }); this.tone(880, 0.25, { gain: 0.08, delay: 0.1, slide: 1.2 }); }
  chime(f = 880) { this.tone(f, 2.2, { type: 'sine', gain: 0.12 }); this.tone(f * 2.76, 1.2, { type: 'sine', gain: 0.03 }); }
  note(f) { this.tone(f, 1.2, { type: 'triangle', gain: 0.14 }); this.tone(f * 2, 0.6, { gain: 0.04 }); }
  open() { this.tone(440, 0.08, { type: 'square', gain: 0.03 }); this.tone(660, 0.1, { type: 'square', gain: 0.03, delay: 0.05 }); }
  /** Animal-Crossing-ish babble for dialogue characters */
  blip(pitch = 1) {
    const f = (220 + Math.random() * 180) * pitch;
    this.tone(f, 0.06, { type: 'square', gain: 0.025, attack: 0.002, slide: 1.1 });
  }
  animal(type) {
    const p = { cow: 0.35, elephant: 0.3, lion: 0.4, tiger: 0.45, polar: 0.4, chick: 2.2, parrot: 1.8, bee: 1.4 }[type] || 1;
    if (type === 'bee') { this.tone(220, 0.5, { type: 'sawtooth', gain: 0.03, slide: 1.05 }); return; }
    this.tone(300 * p, 0.25, { type: 'triangle', gain: 0.1, slide: 1.4 });
    this.tone(420 * p, 0.2, { type: 'triangle', gain: 0.07, delay: 0.12, slide: 0.8 });
  }
  horn() { this.tone(110, 1.2, { type: 'sawtooth', gain: 0.06, attack: 0.1 }); this.tone(165, 1.2, { type: 'sawtooth', gain: 0.04, attack: 0.1 }); }
  bird() {
    const f = 1800 + Math.random() * 1200;
    for (let i = 0; i < 3; i++) this.tone(f * (1 + i * 0.07), 0.08, { gain: 0.025, delay: i * 0.1, slide: 1.3 });
  }

  startAmbience() {
    // wind bed
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0.04;
    s.connect(f); f.connect(this.windGain); this.windGain.connect(this.master); s.start();
    this.windFilter = f;
    // waves bed
    const s2 = this.ctx.createBufferSource(); s2.buffer = this.noiseBuf; s2.loop = true;
    const f2 = this.ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 700;
    this.waveGain = this.ctx.createGain(); this.waveGain.gain.value = 0;
    s2.connect(f2); f2.connect(this.waveGain); this.waveGain.connect(this.master); s2.start();
    // rain bed
    const s3 = this.ctx.createBufferSource(); s3.buffer = this.noiseBuf; s3.loop = true;
    const f3 = this.ctx.createBiquadFilter(); f3.type = 'highpass'; f3.frequency.value = 2500;
    this.rainGain = this.ctx.createGain(); this.rainGain.gain.value = 0;
    s3.connect(f3); f3.connect(this.rainGain); this.rainGain.connect(this.master); s3.start(0, 0.7);
  }

  update(dt, { shore = 0, rain = 0, altitude = 0, night = 0, time = 0 }) {
    if (!this.ctx) return;
    const t = this.t;
    this.windGain.gain.setTargetAtTime(0.03 + Math.min(0.12, altitude * 0.004) + rain * 0.03, t, 0.5);
    this.waveGain.gain.setTargetAtTime(shore * (0.06 + 0.05 * Math.sin(time * 0.7)), t, 0.3);
    this.rainGain.gain.setTargetAtTime(rain * 0.08, t, 0.5);
    if (!night && Math.random() < dt * 0.15 && shore < 0.5) this.bird();
    if (night && Math.random() < dt * 0.4) this.tone(4200 + Math.random() * 300, 0.04, { gain: 0.01, type: 'square' }); // crickets
    this.updateMusic(night);
  }

  // soft generative music: gentle pentatonic plucks over slow chords
  updateMusic(night) {
    if (!this.musicOn) return;
    const now = this.t;
    if (now < this.nextNote - 0.1) return;
    const chords = night
      ? [[220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66], [164.81, 196, 246.94]]
      : [[261.63, 329.63, 392], [220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66]];
    const beat = night ? 0.75 : 0.55;
    const ch = chords[this.chordIdx % chords.length];
    const t0 = Math.max(now, this.nextNote);
    // bass pad every 8 beats
    if (!this.beatN) this.beatN = 0;
    if (this.beatN % 8 === 0) {
      ch.forEach((f) => this.padNote(f / 2, beat * 8, t0));
      this.chordIdx++;
    }
    if (Math.random() < 0.62) {
      const scale = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];
      const f = ch[0] * scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.3 ? 2 : 1);
      this.pluck(f, t0);
    }
    this.beatN++;
    this.nextNote = t0 + beat;
  }
  padNote(f, dur, t0) {
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.12, t0 + 1.2); g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(g); g.connect(this.music); o.start(t0); o.stop(t0 + dur + 0.1);
  }
  pluck(f, t0) {
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.22, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
    o.connect(g); g.connect(this.music); o.start(t0); o.stop(t0 + 1.5);
  }
}
