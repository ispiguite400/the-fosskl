/*
 * Audio: one WebAudio graph for everything.
 *
 *   master ─┬─ music bus ── (music.js sequencer, or Soundtrap exports from assets/music/)
 *           ├─ sfx bus ──── synthesized one-shots, placed in the world (pan + distance)
 *           └─ reverb send (a generated room), delay send
 *
 * Every sound is synthesized here, so the game ships with no audio files; drop-in recordings are
 * picked up from assets/music/manifest.json (see music.js).
 */
import { settings } from '../core/save.js';
import { clamp } from '../core/util.js';

class AudioEngine {
  constructor() {
    this.ctx = null; this.ready = false;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this._noise = null;
    this.lastStep = new Map();
  }
  /** Must run from a user gesture (browsers keep audio locked until then). */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.18;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.music = ctx.createGain(); this.music.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    // reverb: a generated decaying noise impulse
    this.verb = ctx.createConvolver(); this.verb.buffer = this._impulse(2.6, 2.4);
    this.verbSend = ctx.createGain(); this.verbSend.gain.value = 1; this.verbSend.connect(this.verb); this.verb.connect(this.master);
    // a tempo-free echo for leads
    this.delay = ctx.createDelay(1.5); this.delay.delayTime.value = 0.33;
    const fb = ctx.createGain(); fb.gain.value = 0.32; const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2600;
    this.delay.connect(dl); dl.connect(fb); fb.connect(this.delay);
    this.delaySend = ctx.createGain(); this.delaySend.connect(this.delay); dl.connect(this.master);
    this.applyVolumes();
    this.ready = true;
    document.dispatchEvent(new Event('forlorn-audio'));
  }
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.master, t, 0.05);
    this.music.gain.setTargetAtTime(settings.music * 0.8, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(settings.sfx, t, 0.05);
  }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }
  _impulse(sec, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }
  noiseBuffer() {
    if (this._noise) return this._noise;
    const ctx = this.ctx, n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return (this._noise = b);
  }
  setListener(x, y, z, yaw) { const L = this.listener; L.x = x; L.y = y; L.z = z; L.yaw = yaw; }

  /** An output for a sound at a world position (or none = centred). Returns { node, gain }. */
  _out(pos, vol = 1, range = 30, verb = 0.12) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let v = vol;
    let pan = 0;
    if (pos) {
      const L = this.listener, dx = pos.x - L.x, dz = pos.z - L.z, d = Math.hypot(dx, dz);
      v *= clamp(1 - d / range, 0, 1) ** 1.6;
      if (d > 0.5) {
        const rx = -Math.cos(L.yaw), rz = Math.sin(L.yaw);
        pan = clamp((dx * rx + dz * rz) / d, -1, 1) * 0.8;
      }
    }
    g.gain.value = v;
    if (v <= 0.002) return null;
    let head = g;
    if (ctx.createStereoPanner && pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(this.sfxBus); }
    else g.connect(this.sfxBus);
    if (verb) { const s = ctx.createGain(); s.gain.value = verb; g.connect(s); s.connect(this.verbSend); }
    return head;
  }
  _env(param, t, a, peak, d, end = 0.0001) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    param.exponentialRampToValueAtTime(Math.max(end, 0.0001), t + a + d);
  }
  _osc(type, f, t, dur, out, gainPeak = 0.3, a = 0.005, sweep) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t + dur);
    this._env(g.gain, t, a, gainPeak, dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }
  _noiseShot(t, dur, out, { type = 'bandpass', f = 1000, q = 1, peak = 0.3, a = 0.003, f2 } = {}) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noiseBuffer();
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain(); this._env(g.gain, t, a, peak, dur);
    s.connect(fl); fl.connect(g); g.connect(out);
    s.start(t, Math.random() * 1.5); s.stop(t + a + dur + 0.05);
  }

  /** Play a named sound effect. opts: { pos: {x,z}, vol, pitch, range } */
  sfx(name, opts = {}) {
    if (!this.ready) return;
    const fn = SFX[name]; if (!fn) return;
    const out = this._out(opts.pos, opts.vol === undefined ? 1 : opts.vol, opts.range || 32, opts.verb === undefined ? 0.15 : opts.verb);
    if (!out) return;
    try { fn(this, this.ctx.currentTime + 0.005, out, opts.pitch || 1, opts); } catch (e) { console.warn('sfx', name, e); }
  }
  /** Footsteps, rate-limited per actor. */
  step(actor, surface = 'dirt') {
    const t = performance.now(), last = this.lastStep.get(actor.uid) || 0;
    const gap = actor.sprinting ? 270 : 400;
    if (t - last < gap) return;
    this.lastStep.set(actor.uid, t);
    this.sfx('step', { pos: actor, vol: actor.isPlayer ? 0.35 : (actor.role === 'killer' ? 0.9 : 0.5), range: actor.role === 'killer' ? 34 : 22, surface, heavy: actor.role === 'killer' });
  }
}

const N = (n) => 440 * Math.pow(2, (n - 69) / 12);

/* The sound effects. Each is (engine, start time, output node, pitch, opts). */
const SFX = {
  step(A, t, o, p, op) {
    const heavy = op.heavy;
    A._noiseShot(t, heavy ? 0.12 : 0.07, o, { type: 'lowpass', f: (op.surface === 'wood' ? 900 : op.surface === 'metal' ? 2400 : 600) * (0.85 + Math.random() * 0.3), q: 0.8, peak: heavy ? 0.5 : 0.28 });
    if (heavy) A._osc('sine', 70, t, 0.12, o, 0.4, 0.002, 40);
    if (op.surface === 'metal') A._osc('triangle', 1800 + Math.random() * 400, t, 0.05, o, 0.04);
  },
  jump(A, t, o) { A._noiseShot(t, 0.08, o, { type: 'bandpass', f: 500, q: 1, peak: 0.15 }); },
  land(A, t, o) { A._noiseShot(t, 0.1, o, { type: 'lowpass', f: 400, peak: 0.35 }); },
  swing(A, t, o, p) { A._noiseShot(t, 0.22, o, { type: 'bandpass', f: 700 * p, f2: 3200 * p, q: 2.2, peak: 0.45, a: 0.04 }); },
  hit(A, t, o, p) {
    A._osc('sine', 140 * p, t, 0.25, o, 0.8, 0.002, 45);
    A._noiseShot(t, 0.18, o, { type: 'lowpass', f: 2200, f2: 300, peak: 0.7 });
    A._noiseShot(t + 0.01, 0.06, o, { type: 'highpass', f: 3000, peak: 0.25 });
  },
  oof(A, t, o, p) {
    // the classic Roblox death "oof": a short vocal "uh" with a falling pitch, from two formants
    const ctx = A.ctx, src = ctx.createOscillator(); src.type = 'sawtooth';
    src.frequency.setValueAtTime(220 * p, t); src.frequency.exponentialRampToValueAtTime(130 * p, t + 0.22);
    const g = ctx.createGain(); A._env(g.gain, t, 0.015, 0.7, 0.24);
    for (const [f, q, v] of [[600, 6, 1], [1000, 8, 0.55], [2400, 10, 0.18]]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(f, t); bp.frequency.linearRampToValueAtTime(f * 0.8, t + 0.25); bp.Q.value = q;
      const gv = ctx.createGain(); gv.gain.value = v * 2.2; src.connect(bp); bp.connect(gv); gv.connect(g);
    }
    g.connect(o); src.start(t); src.stop(t + 0.32);
  },
  death(A, t, o) { A._osc('sine', 90, t, 1.4, o, 0.6, 0.01, 30); A._osc('sawtooth', 220, t, 0.9, o, 0.08, 0.02, 55); A._noiseShot(t, 1.2, o, { type: 'lowpass', f: 600, f2: 80, peak: 0.25, a: 0.02 }); },
  stun(A, t, o) {
    A._osc('square', 520, t, 0.08, o, 0.25, 0.002, 260);
    A._osc('sine', 980, t + 0.05, 0.5, o, 0.15, 0.005, 920);
    for (let i = 0; i < 3; i++) A._osc('triangle', 1600 + i * 300, t + 0.1 + i * 0.09, 0.12, o, 0.08);
  },
  block(A, t, o) { A._osc('square', 220, t, 0.05, o, 0.3); A._noiseShot(t, 0.25, o, { type: 'bandpass', f: 3200, q: 4, peak: 0.4 }); A._osc('triangle', 1250, t, 0.4, o, 0.15); A._osc('triangle', 1880, t, 0.35, o, 0.08); },
  boom(A, t, o, p) {
    A._osc('sine', 110 * p, t, 0.9, o, 1, 0.002, 28);
    A._noiseShot(t, 1.1, o, { type: 'lowpass', f: 3000, f2: 120, peak: 1, a: 0.002 });
    A._noiseShot(t + 0.02, 0.3, o, { type: 'highpass', f: 1800, peak: 0.3 });
  },
  shot(A, t, o, p) { A._noiseShot(t, 0.16, o, { type: 'lowpass', f: 6000, f2: 400, peak: 1, a: 0.001 }); A._osc('sine', 160 * p, t, 0.18, o, 0.8, 0.001, 50); },
  shotgun(A, t, o) { A._noiseShot(t, 0.35, o, { type: 'lowpass', f: 5000, f2: 200, peak: 1.2, a: 0.001 }); A._osc('sine', 110, t, 0.3, o, 1, 0.001, 35); },
  fireball(A, t, o) { A._noiseShot(t, 0.6, o, { type: 'bandpass', f: 400, f2: 1600, q: 0.8, peak: 0.7, a: 0.05 }); A._osc('sawtooth', 90, t, 0.5, o, 0.15, 0.04, 220); },
  fire(A, t, o) { A._noiseShot(t, 0.4, o, { type: 'bandpass', f: 900, q: 0.6, peak: 0.25, a: 0.06 }); },
  zap(A, t, o) {
    for (let i = 0; i < 6; i++) A._noiseShot(t + i * 0.035, 0.05, o, { type: 'highpass', f: 2000 + Math.random() * 3000, peak: 0.5 });
    A._osc('sawtooth', 1400, t, 0.3, o, 0.25, 0.002, 160);
  },
  thunder(A, t, o) { A._noiseShot(t, 2.2, o, { type: 'lowpass', f: 900, f2: 60, peak: 1, a: 0.01 }); A._osc('sine', 50, t, 1.6, o, 0.6, 0.01, 30); },
  whoosh(A, t, o, p) { A._noiseShot(t, 0.45, o, { type: 'bandpass', f: 300 * p, f2: 2400 * p, q: 1.4, peak: 0.5, a: 0.12 }); },
  teleport(A, t, o) { A._osc('sine', 300, t, 0.5, o, 0.3, 0.01, 1800); A._osc('triangle', 900, t + 0.1, 0.5, o, 0.15, 0.02, 220); A._noiseShot(t, 0.5, o, { type: 'bandpass', f: 2000, f2: 400, q: 3, peak: 0.3 }); },
  roar(A, t, o, p) {
    const ctx = A.ctx, s = ctx.createOscillator(); s.type = 'sawtooth';
    s.frequency.setValueAtTime(75 * p, t); s.frequency.linearRampToValueAtTime(95 * p, t + 0.4); s.frequency.exponentialRampToValueAtTime(45 * p, t + 1.3);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 23; lg.gain.value = 18; lfo.connect(lg); lg.connect(s.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(1400, t + 0.35); f.frequency.linearRampToValueAtTime(300, t + 1.3); f.Q.value = 4;
    const g = ctx.createGain(); A._env(g.gain, t, 0.08, 0.9, 1.25);
    s.connect(f); f.connect(g); g.connect(o); s.start(t); s.stop(t + 1.45); lfo.start(t); lfo.stop(t + 1.45);
    A._noiseShot(t, 1.2, o, { type: 'bandpass', f: 700, q: 1.2, peak: 0.35, a: 0.1 });
  },
  laugh(A, t, o, p) { for (let i = 0; i < 5; i++) { A._osc('sawtooth', (170 - i * 8) * p, t + i * 0.16, 0.12, o, 0.2, 0.01, (120 - i * 6) * p); A._noiseShot(t + i * 0.16, 0.1, o, { type: 'bandpass', f: 900, q: 3, peak: 0.15 }); } },
  heal(A, t, o) { [72, 76, 79, 84].forEach((n, i) => A._osc('sine', N(n), t + i * 0.07, 0.5, o, 0.12, 0.02)); },
  drink(A, t, o) { A._noiseShot(t, 0.6, o, { type: 'highpass', f: 4000, peak: 0.2, a: 0.02 }); for (let i = 0; i < 4; i++) A._osc('sine', 300 + i * 40, t + i * 0.12, 0.08, o, 0.2); },
  pickup(A, t, o) { A._osc('square', N(76), t, 0.07, o, 0.12); A._osc('square', N(83), t + 0.07, 0.12, o, 0.12); },
  gen_tick(A, t, o) { A._osc('square', 1800, t, 0.03, o, 0.06); },
  gen_part(A, t, o) { A._osc('triangle', N(67), t, 0.15, o, 0.25); A._osc('triangle', N(74), t + 0.08, 0.25, o, 0.25); A._noiseShot(t, 0.2, o, { type: 'bandpass', f: 4000, q: 3, peak: 0.12 }); },
  gen_bad(A, t, o) { A._noiseShot(t, 0.5, o, { type: 'bandpass', f: 3000, q: 1, peak: 0.8 }); A._osc('sawtooth', 120, t, 0.4, o, 0.4, 0.002, 60); },
  gen_done(A, t, o) {
    A._osc('sawtooth', 55, t, 1.6, o, 0.25, 0.3, 110);
    [60, 64, 67, 72, 76].forEach((n, i) => A._osc('triangle', N(n), t + 0.25 + i * 0.08, 0.9, o, 0.2, 0.01));
  },
  gen_hum(A, t, o) { A._osc('sawtooth', 58, t, 0.6, o, 0.05, 0.1); },
  ui(A, t, o) { A._osc('triangle', 1200, t, 0.04, o, 0.12); },
  ui_move(A, t, o) { A._osc('triangle', 900, t, 0.03, o, 0.06); },
  ui_back(A, t, o) { A._osc('triangle', 700, t, 0.06, o, 0.12, 0.002, 400); },
  buy(A, t, o) { [76, 79, 84, 88].forEach((n, i) => A._osc('square', N(n), t + i * 0.06, 0.14, o, 0.08)); },
  deny(A, t, o) { A._osc('square', 180, t, 0.18, o, 0.15); A._osc('square', 140, t + 0.12, 0.2, o, 0.15); },
  chat(A, t, o) { A._osc('sine', 1300, t, 0.05, o, 0.06); },
  tick(A, t, o) { A._osc('square', 1000, t, 0.05, o, 0.12); },
  go(A, t, o) { A._osc('square', 1500, t, 0.35, o, 0.15); },
  sting(A, t, o) {
    A._osc('sawtooth', 55, t, 2.4, o, 0.5, 0.01, 41);
    A._osc('sawtooth', 58.3, t, 2.4, o, 0.4, 0.01, 43);
    A._noiseShot(t, 1.6, o, { type: 'lowpass', f: 4000, f2: 100, peak: 0.8, a: 0.001 });
    A._osc('sine', 880, t, 1.6, o, 0.12, 0.01, 860);
  },
  heartbeat(A, t, o) { A._osc('sine', 62, t, 0.12, o, 0.9, 0.004, 40); A._osc('sine', 58, t + 0.2, 0.14, o, 0.6, 0.004, 38); },
  smoke(A, t, o) { A._noiseShot(t, 1.4, o, { type: 'lowpass', f: 1600, f2: 300, peak: 0.6, a: 0.02 }); },
  cash(A, t, o) { for (let i = 0; i < 8; i++) A._noiseShot(t + i * 0.04, 0.05, o, { type: 'bandpass', f: 3000 + Math.random() * 2000, q: 5, peak: 0.2 }); A._osc('square', N(88), t, 0.08, o, 0.06); A._osc('square', N(91), t + 0.08, 0.15, o, 0.06); },
  trap(A, t, o) { A._noiseShot(t, 0.08, o, { type: 'highpass', f: 2500, peak: 0.9 }); A._osc('square', 300, t, 0.1, o, 0.4, 0.001, 90); },
  echo(A, t, o) { [84, 79, 76, 72].forEach((n, i) => A._osc('sine', N(n), t + i * 0.12, 1.2, o, 0.08, 0.05)); },
  bond(A, t, o) { [72, 79].forEach((n, i) => A._osc('sine', N(n), t + i * 0.1, 0.6, o, 0.1, 0.02)); },
  frenzy(A, t, o) { A._osc('sawtooth', 40, t, 1.2, o, 0.5, 0.05, 80); A._noiseShot(t, 1, o, { type: 'bandpass', f: 200, f2: 2000, q: 2, peak: 0.4, a: 0.2 }); },
  siren(A, t, o) { const ctx = A.ctx, s = ctx.createOscillator(), g = ctx.createGain(); s.type = 'sawtooth'; s.frequency.setValueAtTime(440, t); for (let i = 0; i < 6; i++) { s.frequency.linearRampToValueAtTime(880, t + i * 0.9 + 0.45); s.frequency.linearRampToValueAtTime(440, t + i * 0.9 + 0.9); } A._env(g.gain, t, 0.2, 0.12, 5.2); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800; s.connect(f); f.connect(g); g.connect(o); s.start(t); s.stop(t + 5.5); },
  whistle(A, t, o) { A._osc('sine', 1800, t, 1.4, o, 0.12, 0.05, 400); },
  door(A, t, o) { A._noiseShot(t, 0.3, o, { type: 'lowpass', f: 800, peak: 0.4 }); A._osc('triangle', 180, t, 0.2, o, 0.2, 0.002, 120); },
  join(A, t, o) { A._osc('sine', N(79), t, 0.12, o, 0.08); A._osc('sine', N(84), t + 0.08, 0.2, o, 0.08); },
  leave(A, t, o) { A._osc('sine', N(79), t, 0.12, o, 0.08); A._osc('sine', N(72), t + 0.08, 0.2, o, 0.08); }
};

export const audio = new AudioEngine();
export { N as midiHz };
