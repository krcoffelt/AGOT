// Procedural audio: wind, wing beats, dragonfire, roars and a slow generative score. No samples.
export class GameAudio {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    this.reverb = c.createConvolver(); this.reverb.buffer = this._impulse(3.6);
    this.revGain = c.createGain(); this.revGain.gain.value = 0.55; this.reverb.connect(this.revGain); this.revGain.connect(this.master);
    this.noise = this._noiseBuffer(3);
    // wind
    this.wind = this._loop(this.noise); this.windF = c.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 400; this.windF.Q.value = 0.6;
    this.windG = c.createGain(); this.windG.gain.value = 0; this.wind.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.master);
    this.wind2 = this._loop(this.noise, 0.7); this.wind2F = c.createBiquadFilter(); this.wind2F.type = 'lowpass'; this.wind2F.frequency.value = 180;
    this.wind2G = c.createGain(); this.wind2G.gain.value = 0; this.wind2.connect(this.wind2F); this.wind2F.connect(this.wind2G); this.wind2G.connect(this.master);
    // fire
    this.fire = this._loop(this.noise, 1.3); this.fireF = c.createBiquadFilter(); this.fireF.type = 'bandpass'; this.fireF.frequency.value = 520; this.fireF.Q.value = 0.5;
    this.fireG = c.createGain(); this.fireG.gain.value = 0; this.fire.connect(this.fireF); this.fireF.connect(this.fireG); this.fireG.connect(this.master);
    this.fireLow = this._loop(this.noise, 0.5); this.fireLowF = c.createBiquadFilter(); this.fireLowF.type = 'lowpass'; this.fireLowF.frequency.value = 110;
    this.fireLowG = c.createGain(); this.fireLowG.gain.value = 0; this.fireLow.connect(this.fireLowF); this.fireLowF.connect(this.fireLowG); this.fireLowG.connect(this.master);
    // music
    this.musicG = c.createGain(); this.musicG.gain.value = 0.0; this.musicG.connect(this.master); this.musicG.connect(this.reverb);
    this.musicOn = true; this._chord = 0; this._nextChord = 0; this._nextNote = 0; this._lastPhase = 0; this.scale = 1;
    this._drone();
  }
  resume() { if (this.ctx.state !== 'running') this.ctx.resume(); this.musicG.gain.setTargetAtTime(this.musicOn ? 0.16 : 0, this.ctx.currentTime, 2.5); }
  setVolume(v) { this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusic(on) { this.musicOn = on; this.musicG.gain.setTargetAtTime(on ? 0.16 : 0, this.ctx.currentTime, 0.8); }
  _noiseBuffer(sec) { const c = this.ctx; const b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate); const d = b.getChannelData(0); let last = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = last * 0.02 + w * 0.98; d[i] = last; } return b; }
  _impulse(sec) { const c = this.ctx; const b = c.createBuffer(2, c.sampleRate * sec, c.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.6); } return b; }
  _loop(buf, rate = 1) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * 2); return s; }

  // ------------------------------------------------------------- one-shots
  flap(strength = 1) {
    const c = this.ctx, t = c.currentTime; const s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.55 / Math.sqrt(this.scale);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(520, t); f.frequency.exponentialRampToValueAtTime(90, t + 0.42);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5 * strength, t + 0.07); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 2); s.stop(t + 0.55);
  }
  roar(big = 1) {
    const c = this.ctx, t = c.currentTime; const dur = 1.9 + 0.5 * big; const base = 92 / Math.pow(this.scale, 0.75);
    const out = c.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.75, t + 0.14); out.gain.setValueAtTime(0.7, t + dur * 0.55); out.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const shaper = c.createWaveShaper(); const curve = new Float32Array(512); for (let i = 0; i < 512; i++) { const x = i / 256 - 1; curve[i] = Math.tanh(x * 3.2); } shaper.curve = curve;
    for (const [mul, det] of [[1, 0], [1.5, 9], [0.5, -7], [2.02, 14]]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = det;
      o.frequency.setValueAtTime(base * mul * 0.8, t); o.frequency.linearRampToValueAtTime(base * mul * 1.25, t + 0.25); o.frequency.exponentialRampToValueAtTime(base * mul * 0.62, t + dur);
      const lfo = c.createOscillator(); lfo.frequency.value = 23 + Math.random() * 9; const lg = c.createGain(); lg.gain.value = base * mul * 0.09; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + dur);
      const g = c.createGain(); g.gain.value = 0.22; o.connect(g); g.connect(shaper); o.start(t); o.stop(t + dur);
    }
    const n = c.createBufferSource(); n.buffer = this.noise; n.playbackRate.value = 0.8; const ng = c.createGain(); ng.gain.value = 0.55; n.connect(ng); ng.connect(shaper); n.start(t, Math.random()); n.stop(t + dur);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 1.1; f1.frequency.setValueAtTime(260, t); f1.frequency.linearRampToValueAtTime(620, t + 0.3); f1.frequency.exponentialRampToValueAtTime(210, t + dur);
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 2; f2.frequency.setValueAtTime(900, t); f2.frequency.exponentialRampToValueAtTime(520, t + dur);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    shaper.connect(f1); shaper.connect(f2); f1.connect(lp); f2.connect(lp); lp.connect(out); out.connect(this.master); out.connect(this.reverb);
  }
  chime() {
    const c = this.ctx, t = c.currentTime;
    for (const [f, d, v] of [[587.33, 0, 0.22], [880, 0.08, 0.16], [1174.66, 0.16, 0.12], [1760, 0.3, 0.05]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = c.createGain(); g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(v, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0008, t + d + 3.2);
      o.connect(g); g.connect(this.master); g.connect(this.reverb); o.start(t + d); o.stop(t + d + 3.4);
    }
  }
  thud(v = 1) {
    const c = this.ctx, t = c.currentTime; const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    const g = c.createGain(); g.gain.setValueAtTime(0.8 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.65);
    this.flap(v * 0.8);
  }

  // ----------------------------------------------------------------- music
  _drone() {
    const c = this.ctx;
    for (const [f, v, type] of [[73.42, 0.5, 'sine'], [110, 0.22, 'sine'], [146.83, 0.12, 'triangle']]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f; const g = c.createGain(); g.gain.value = v;
      const l = c.createOscillator(); l.frequency.value = 0.05 + Math.random() * 0.05; const lg = c.createGain(); lg.gain.value = v * 0.35; l.connect(lg); lg.connect(g.gain); l.start();
      o.connect(g); g.connect(this.musicG); o.start();
    }
  }
  _pad(freqs, t, dur) {
    const c = this.ctx;
    for (const f of freqs) for (const det of [-7, 6]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(260, t); lp.frequency.linearRampToValueAtTime(900, t + dur * 0.5); lp.frequency.linearRampToValueAtTime(240, t + dur);
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.085, t + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(lp); lp.connect(g); g.connect(this.musicG); o.start(t); o.stop(t + dur + 0.1);
    }
  }
  _note(f, t, dur, v = 0.2) {
    const c = this.ctx; const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f; o2.detune.value = 5;
    const vib = c.createOscillator(); vib.frequency.value = 5; const vg = c.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.006, t + dur * 0.6); vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency); vib.start(t); vib.stop(t + dur + 0.1);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.3); g.gain.linearRampToValueAtTime(v * 0.7, t + dur * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const g2 = c.createGain(); g2.gain.value = 0.3; o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(this.musicG); o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }

  // called every frame with the flight state
  update(dt, st) {
    const c = this.ctx, t = c.currentTime; if (c.state !== 'running') return;
    this.scale = st.scale;
    const sp = Math.min(1.6, st.speed / 90);
    this.windG.gain.setTargetAtTime(st.playing ? 0.05 + sp * sp * 0.34 : 0.03, t, 0.2);
    this.windF.frequency.setTargetAtTime(260 + sp * 1050, t, 0.2);
    this.wind2G.gain.setTargetAtTime(st.playing ? 0.12 + sp * 0.3 : 0.06, t, 0.3);
    this.fireG.gain.setTargetAtTime(st.fire * 0.55, t, 0.06); this.fireLowG.gain.setTargetAtTime(st.fire * 0.9, t, 0.08);
    this.fireF.frequency.setTargetAtTime(430 + Math.sin(t * 23) * 90 + Math.sin(t * 7.1) * 60, t, 0.05);
    // wing beats: fire on each downstroke
    const ph = st.phase % (Math.PI * 2);
    if (st.flap > 0.2 && this._lastPhase < Math.PI * 0.5 && ph >= Math.PI * 0.5) this.flap(Math.min(1.2, 0.35 + st.flap * 0.7));
    this._lastPhase = ph;
    // score: slow modal chords in D minor with a sparse cello-like line
    if (!this.musicOn) return;
    const chords = [[146.83, 174.61, 220.0], [116.54, 146.83, 174.61], [174.61, 220.0, 261.63], [130.81, 164.81, 196.0], [146.83, 174.61, 220.0], [98.0, 146.83, 196.0], [110.0, 138.59, 164.81], [146.83, 220.0, 293.66]];
    if (t > this._nextChord) { const ch = chords[this._chord % chords.length]; this._pad(ch, t + 0.05, 13); this._chord++; this._nextChord = t + 11; }
    if (t > this._nextNote) {
      const scale = [293.66, 329.63, 349.23, 392.0, 440.0, 466.16, 523.25, 587.33];
      const ch = chords[(this._chord + chords.length - 1) % chords.length]; const pick = Math.random() < 0.6 ? ch[(Math.random() * 3) | 0] * 2 : scale[(Math.random() * scale.length) | 0];
      this._note(pick, t + 0.05, 3.5 + Math.random() * 3, 0.1 + Math.random() * 0.08); this._nextNote = t + 4 + Math.random() * 7;
    }
  }
}
