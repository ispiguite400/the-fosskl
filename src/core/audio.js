/* Procedural cinematic score + SFX.
 *
 * Nothing is streamed from disk — every note is synthesised with WebAudio so
 * the game ships as pure source. The score is built from Japanese modes
 * (hirajoshi / in-sen / yo) layered over a convolution reverb, with taiko,
 * koto-style plucks (Karplus-Strong) and a shakuhachi-ish breathy lead.
 *
 * Music.play('menu') cross-fades; each track schedules itself one bar ahead
 * on a lookahead timer so it never stutters under GC. */

import { clamp, makeRNG } from './util.js';

const A4 = 440;
const note = n => A4 * Math.pow(2, (n - 69) / 12);   // MIDI -> Hz

/* Scale degrees (semitone offsets from the root). */
const SCALES = {
  hirajoshi: [0, 2, 3, 7, 8],
  insen:     [0, 1, 5, 7, 10],
  yo:        [0, 2, 5, 7, 9],
  kumoi:     [0, 2, 3, 7, 9],
  minor:     [0, 2, 3, 5, 7, 8, 10],
  phrygian:  [0, 1, 3, 5, 7, 8, 10]
};

function scaleNote(root, scale, degree) {
  const s = SCALES[scale] || SCALES.hirajoshi;
  const oct = Math.floor(degree / s.length);
  const idx = ((degree % s.length) + s.length) % s.length;
  return root + s[idx] + oct * 12;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.master = null;
    this.current = null;
    this._track = null;
    this._timer = null;
    this._nextBar = 0;
    this._bar = 0;
    this._rng = makeRNG(7);
    this.volumes = { master: .8, music: .55, sfx: .85 };
  }

  /* Must be called from a user gesture. */
  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(this.ctx.destination);

    // Gentle bus compression keeps big hits from clipping the score.
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 22;
    this.comp.ratio.value = 3.2; this.comp.attack.value = .006; this.comp.release.value = .26;
    this.comp.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.volumes.music;
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.4, 2.2);
    this.revGain = this.ctx.createGain(); this.revGain.gain.value = .42;
    this.reverb.connect(this.revGain); this.revGain.connect(this.comp);

    this.musicBus.connect(this.comp); this.musicBus.connect(this.reverb);
    this.sfxBus.connect(this.comp);

    const sfxRev = this.ctx.createGain(); sfxRev.gain.value = .16;
    this.sfxBus.connect(sfxRev); sfxRev.connect(this.reverb);

    this.ready = true;
    return this.ctx;
  }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }

  setVolumes({ master, music, sfx, muted }) {
    if (master != null) this.volumes.master = master;
    if (music != null) this.volumes.music = music;
    if (sfx != null) this.volumes.sfx = sfx;
    if (muted != null) this.muted = muted;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, .05);
    this.musicBus.gain.setTargetAtTime(this.volumes.music, t, .05);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, .05);
  }

  toggleMute() { this.setVolumes({ muted: !this.muted }); return this.muted; }

  /* ---------- generated impulse response ---------- */
  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Slight early-reflection cluster then a smooth exponential tail.
        const env = Math.pow(1 - t, decay);
        d[i] = (Math.random() * 2 - 1) * env * (i < rate * .02 ? 1.5 : 1);
      }
    }
    return buf;
  }

  _noiseBuffer(seconds = 1) {
    const rate = this.ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* ================= instrument voices ================= */

  /** Bowed / sustained pad — the emotional bed under every track. */
  _pad(freq, t, dur, gain = .12, dest = this.musicBus, detune = 7) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * .35);
    g.gain.linearRampToValueAtTime(gain * .8, t + dur * .7);
    g.gain.linearRampToValueAtTime(0, t + dur);

    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 2.2, t);
    f.frequency.linearRampToValueAtTime(freq * 5, t + dur * .5);
    f.Q.value = .8;

    for (const [type, det, mul] of [['sawtooth', -detune, 1], ['sawtooth', detune, 1], ['sine', 0, .5]]) {
      const o = this.ctx.createOscillator();
      o.type = type; o.frequency.value = freq * mul; o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + .1);
    }
    f.connect(g); g.connect(dest);
  }

  /** Koto / biwa pluck via Karplus-Strong. */
  _pluck(freq, t, gain = .25, damp = .5, dest = this.musicBus) {
    const rate = this.ctx.sampleRate;
    const n = Math.max(2, Math.floor(rate / freq));
    const buf = this.ctx.createBuffer(1, rate * 2.4, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    for (let i = n; i < d.length; i++) d[i] = (d[i - n] + d[i - n + 1]) * .5 * (1 - damp * .008);

    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(.0001, t + 2.2);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = clamp(freq * 8, 800, 7000);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t); src.stop(t + 2.4);
  }

  /** Breathy shakuhachi-style lead: sine core + filtered noise breath. */
  _flute(freq, t, dur, gain = .16, dest = this.musicBus) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + .13);
    g.gain.setValueAtTime(gain, t + dur * .72);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);

    const o = this.ctx.createOscillator();
    o.type = 'sine'; o.frequency.setValueAtTime(freq * .992, t);
    o.frequency.linearRampToValueAtTime(freq, t + .16);

    // Vibrato that eases in, the way a player would phrase it.
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
    lfo.frequency.value = 5.1;
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(freq * .012, t + dur * .5);
    lfo.connect(lg); lg.connect(o.frequency);
    lfo.start(t); lfo.stop(t + dur);

    const breath = this.ctx.createBufferSource();
    breath.buffer = this._noiseBuffer(dur + .2);
    const bf = this.ctx.createBiquadFilter();
    bf.type = 'bandpass'; bf.frequency.value = freq * 2.4; bf.Q.value = 2.4;
    const bg = this.ctx.createGain(); bg.gain.value = gain * .22;
    breath.connect(bf); bf.connect(bg); bg.connect(g);
    breath.start(t); breath.stop(t + dur);

    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + .05);
  }

  /** Taiko — pitch-dropping sine body plus a noise skin transient. */
  _taiko(t, gain = .5, pitch = 92, dest = this.musicBus) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(pitch * 2.4, t);
    o.frequency.exponentialRampToValueAtTime(pitch * .55, t + .16);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(.0001, t + .7);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + .75);

    const n = this.ctx.createBufferSource(); n.buffer = this._noiseBuffer(.12);
    const nf = this.ctx.createBiquadFilter(); nf.type = 'bandpass';
    nf.frequency.value = 340; nf.Q.value = .9;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(gain * .5, t); ng.gain.exponentialRampToValueAtTime(.0001, t + .1);
    n.connect(nf); nf.connect(ng); ng.connect(dest); n.start(t); n.stop(t + .13);
  }

  /** Low choral "voices" — used in boss and finale cues. */
  _choir(freq, t, dur, gain = .1, dest = this.musicBus) {
    for (const mul of [1, 1.5, 2]) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = freq * mul;
      o.detune.value = (Math.random() * 2 - 1) * 16;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain / mul, t + dur * .4);
      g.gain.linearRampToValueAtTime(0, t + dur);
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = freq * mul * 1.6; f.Q.value = 1.2;
      o.connect(f); f.connect(g); g.connect(dest);
      o.start(t); o.stop(t + dur + .05);
    }
  }

  /* ================= track definitions =================
   * Each track is { bpm, beatsPerBar, root, scale, bar(t, i, rng) }.
   * bar() schedules one bar starting at AudioContext time t. */

  _tracks() {
    const T = {};

    T.loading = {
      bpm: 52, beats: 4, root: 50, scale: 'kumoi', gain: .9,
      bar: (t, i, rng, s) => {
        const spb = 60 / s.bpm;
        this._pad(note(s.root - 12), t, spb * 4, .1);
        this._pad(note(scaleNote(s.root, s.scale, i % 3)), t, spb * 4, .07);
        if (i % 2 === 0) this._flute(note(scaleNote(s.root + 12, s.scale, rng.int(0, 4))), t + spb, spb * 2.2, .12);
        this._pluck(note(scaleNote(s.root, s.scale, rng.int(0, 4))), t + spb * 2.5, .14);
      }
    };

    /* Main menu: solemn, wide, with a slow taiko heartbeat. */
    T.menu = {
      bpm: 58, beats: 4, root: 45, scale: 'hirajoshi', gain: 1,
      bar: (t, i, rng, s) => {
        const spb = 60 / s.bpm;
        this._pad(note(s.root - 12), t, spb * 4, .13);
        this._pad(note(s.root - 5), t, spb * 4, .07);
        this._taiko(t, .34, 78);
        if (i % 2 === 1) this._taiko(t + spb * 2.5, .2, 88);
        this._choir(note(scaleNote(s.root, s.scale, (i % 4))), t, spb * 4, .06);
        if (i % 4 === 2) this._flute(note(scaleNote(s.root + 12, s.scale, rng.int(1, 4))), t + spb, spb * 2.4, .13);
        this._pluck(note(scaleNote(s.root, s.scale, rng.int(0, 4))), t + spb * rng.int(1, 3), .11);
      }
    };

    /* Ambient exploration beds — one per world flavour. */
    const ambient = (root, scale, bright) => ({
      bpm: 46, beats: 4, root, scale, gain: .72,
      bar: (t, i, rng, s) => {
        const spb = 60 / s.bpm;
        this._pad(note(s.root - 12), t, spb * 4, .085);
        if (rng.chance(.7)) this._pad(note(scaleNote(s.root, s.scale, rng.int(0, 3))), t, spb * 4, .05);
        if (rng.chance(bright ? .8 : .45)) {
          this._pluck(note(scaleNote(s.root + 12, s.scale, rng.int(0, 4))), t + spb * rng.int(0, 3), .1);
        }
        if (i % 4 === 0) this._flute(note(scaleNote(s.root + 12, s.scale, rng.int(0, 3))), t + spb * .5, spb * 3, .09);
      }
    });

    T.world1  = ambient(43, 'insen', false);
    T.world2  = ambient(50, 'yo', true);
    T.world3  = ambient(48, 'kumoi', true);
    T.world4  = ambient(45, 'hirajoshi', false);
    T.world5  = ambient(41, 'phrygian', false);
    T.world6  = ambient(52, 'yo', true);
    T.world7  = ambient(47, 'kumoi', true);
    T.world8  = ambient(44, 'minor', false);
    T.world9  = ambient(49, 'hirajoshi', true);
    T.world10 = ambient(38, 'phrygian', false);

    /* Combat / boss: driving taiko ostinato + choir stabs. */
    T.boss = {
      bpm: 132, beats: 4, root: 38, scale: 'phrygian', gain: 1.05,
      bar: (t, i, rng, s) => {
        const spb = 60 / s.bpm;
        for (let b = 0; b < 4; b++) {
          this._taiko(t + b * spb, b === 0 ? .55 : .3, b === 0 ? 70 : 96);
          if (b % 2 === 1) this._taiko(t + b * spb + spb * .5, .18, 120);
        }
        this._pad(note(s.root - 12), t, spb * 4, .16);
        this._choir(note(scaleNote(s.root, s.scale, i % 3)), t, spb * 4, .1);
        if (i % 2 === 0) {
          for (let k = 0; k < 4; k++) {
            this._pluck(note(scaleNote(s.root + 12, s.scale, rng.int(0, 5))), t + k * spb * .5, .13, .8);
          }
        }
      }
    };

    /* Final villain — same engine, heavier, half-step tension. */
    T.final = {
      bpm: 146, beats: 4, root: 35, scale: 'phrygian', gain: 1.1,
      bar: (t, i, rng, s) => {
        const spb = 60 / s.bpm;
        for (let b = 0; b < 8; b++) this._taiko(t + b * spb * .5, b % 4 === 0 ? .6 : .22, b % 4 === 0 ? 62 : 104);
        this._pad(note(s.root - 12), t, spb * 4, .18);
        this._pad(note(s.root - 11), t + spb * 2, spb * 2, .1);
        this._choir(note(scaleNote(s.root, s.scale, i % 5)), t, spb * 4, .13);
        this._flute(note(scaleNote(s.root + 24, s.scale, rng.int(0, 4))), t + spb * rng.int(0, 2), spb * 1.6, .1);
      }
    };

    /* The girl's death. Sparse, slow, no percussion. */
    T.sorrow = {
      bpm: 40, beats: 4, root: 41, scale: 'kumoi', gain: .95,
      bar: (t, i, rng, s) => {
        const spb = 60 / s.bpm;
        this._pad(note(s.root - 12), t, spb * 4, .1);
        this._pad(note(scaleNote(s.root, s.scale, i % 2)), t, spb * 4, .06);
        this._pluck(note(scaleNote(s.root + 12, s.scale, [0, 2, 1, 4][i % 4])), t + spb, .12, .3);
        if (i % 2 === 0) this._flute(note(scaleNote(s.root + 12, s.scale, [2, 1, 0, 3][i % 4])), t + spb * 1.5, spb * 2.6, .1);
      }
    };

    /* Hub village — warm, safe. */
    T.hub = {
      bpm: 64, beats: 4, root: 52, scale: 'yo', gain: .8,
      bar: (t, i, rng, s) => {
        const spb = 60 / s.bpm;
        this._pad(note(s.root - 12), t, spb * 4, .08);
        this._pluck(note(scaleNote(s.root, s.scale, rng.int(0, 4))), t + spb * .5, .12);
        this._pluck(note(scaleNote(s.root, s.scale, rng.int(0, 4))), t + spb * 2.5, .09);
        if (i % 4 === 0) this._flute(note(scaleNote(s.root + 12, s.scale, 2)), t, spb * 2.5, .08);
      }
    };

    T.victory = {
      bpm: 72, beats: 4, root: 53, scale: 'yo', gain: 1,
      bar: (t, i, rng, s) => {
        const spb = 60 / s.bpm;
        this._taiko(t, .45, 82);
        this._pad(note(s.root - 12), t, spb * 4, .12);
        this._choir(note(scaleNote(s.root, s.scale, i % 3)), t, spb * 4, .1);
        this._flute(note(scaleNote(s.root + 12, s.scale, [0, 2, 4, 3][i % 4])), t + spb * .5, spb * 2, .13);
      }
    };

    return T;
  }

  /* ================= transport ================= */

  play(name, { fade = 2.2 } = {}) {
    if (!this.ready) return;
    if (this.current === name) return;
    this.current = name;

    const tracks = this._tracksCache || (this._tracksCache = this._tracks());
    const spec = tracks[name];

    // Fade the outgoing bed out; new voices simply start quiet and rise.
    if (this._out) this._out.gain.cancelScheduledValues(this.ctx.currentTime);
    if (this.musicBus) {
      const t = this.ctx.currentTime;
      this.musicBus.gain.cancelScheduledValues(t);
      this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
      this.musicBus.gain.linearRampToValueAtTime(0.0001, t + fade * .4);
      this.musicBus.gain.linearRampToValueAtTime(this.volumes.music * (spec?.gain ?? 1), t + fade);
    }

    clearInterval(this._timer);
    if (!spec) { this._track = null; return; }

    this._track = spec;
    this._bar = 0;
    this._rng = makeRNG((name.length * 7919 + 13) >>> 0);
    this._nextBar = this.ctx.currentTime + .12;

    const tick = () => {
      if (!this._track) return;
      const barLen = (60 / this._track.bpm) * this._track.beats;
      // Schedule ~2 bars ahead so the audio thread is never starved.
      while (this._nextBar < this.ctx.currentTime + barLen * 2) {
        try { this._track.bar(this._nextBar, this._bar, this._rng, this._track); }
        catch (e) { console.warn('[audio] bar failed', e); }
        this._nextBar += barLen;
        this._bar++;
      }
    };
    tick();
    this._timer = setInterval(tick, 220);
  }

  stop(fade = 1.4) {
    clearInterval(this._timer);
    this._track = null; this.current = null;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
    this.musicBus.gain.linearRampToValueAtTime(.0001, t + fade);
  }

  /** Duck the music under a cutscene line or a big hit. */
  duck(amount = .35, ms = 900) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, target = this.volumes.music;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
    this.musicBus.gain.linearRampToValueAtTime(target * amount, t + .12);
    this.musicBus.gain.linearRampToValueAtTime(target, t + ms / 1000);
  }

  /* ================= SFX ================= */

  sfx(name, opts = {}) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime + (opts.delay || 0);
    const vol = (opts.volume ?? 1);
    const d = this.sfxBus;
    const F = this._sfx[name];
    if (F) F.call(this, t, vol, d, opts);
  }

  get _sfx() {
    if (this.__sfx) return this.__sfx;
    const noiseHit = (t, vol, dest, { f = 2400, q = 1.2, dur = .18, type = 'bandpass' } = {}) => {
      const n = this.ctx.createBufferSource(); n.buffer = this._noiseBuffer(dur + .05);
      const bf = this.ctx.createBiquadFilter(); bf.type = type; bf.frequency.value = f; bf.Q.value = q;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      n.connect(bf); bf.connect(g); g.connect(dest); n.start(t); n.stop(t + dur + .05);
      return { bf, g };
    };
    const tone = (t, vol, dest, { f0, f1, dur = .2, type = 'sine' }) => {
      const o = this.ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + .03);
    };

    return this.__sfx = {
      uiMove:   (t, v, d) => tone(t, .07 * v, d, { f0: 780, f1: 700, dur: .07, type: 'triangle' }),
      uiConfirm:(t, v, d) => { tone(t, .1 * v, d, { f0: 520, f1: 900, dur: .16, type: 'triangle' });
                               this._taiko(t, .18 * v, 110, d); },
      uiBack:   (t, v, d) => tone(t, .09 * v, d, { f0: 480, f1: 260, dur: .16, type: 'triangle' }),
      uiDeny:   (t, v, d) => tone(t, .12 * v, d, { f0: 200, f1: 120, dur: .22, type: 'square' }),

      swing:    (t, v, d) => { const { bf } = noiseHit(t, .28 * v, d, { f: 900, q: .7, dur: .26 });
                               bf.frequency.setValueAtTime(600, t);
                               bf.frequency.exponentialRampToValueAtTime(4200, t + .16); },
      swingHeavy:(t, v, d) => { const { bf } = noiseHit(t, .4 * v, d, { f: 500, q: .6, dur: .4 });
                               bf.frequency.setValueAtTime(320, t);
                               bf.frequency.exponentialRampToValueAtTime(2600, t + .3); },
      hitFlesh: (t, v, d) => { noiseHit(t, .34 * v, d, { f: 420, q: 1.6, dur: .16 });
                               tone(t, .22 * v, d, { f0: 150, f1: 60, dur: .18 }); },
      hitMetal: (t, v, d) => { noiseHit(t, .3 * v, d, { f: 3200, q: 3.4, dur: .3 });
                               tone(t, .16 * v, d, { f0: 1800, f1: 900, dur: .28, type: 'triangle' });
                               tone(t, .1 * v, d, { f0: 2700, f1: 1500, dur: .34, type: 'triangle' }); },
      block:    (t, v, d) => { noiseHit(t, .42 * v, d, { f: 2600, q: 2.2, dur: .34 });
                               tone(t, .24 * v, d, { f0: 1200, f1: 380, dur: .3, type: 'square' });
                               this._taiko(t, .22 * v, 66, d); },
      parry:    (t, v, d) => { noiseHit(t, .5 * v, d, { f: 5200, q: 4, dur: .4 });
                               tone(t, .2 * v, d, { f0: 2600, f1: 1900, dur: .5, type: 'triangle' }); },
      punch:    (t, v, d) => { noiseHit(t, .26 * v, d, { f: 300, q: 1.1, dur: .13 });
                               tone(t, .18 * v, d, { f0: 120, f1: 55, dur: .14 }); },

      bowDraw:  (t, v, d) => noiseHit(t, .12 * v, d, { f: 1200, q: 4, dur: .5 }),
      bowShot:  (t, v, d) => { noiseHit(t, .3 * v, d, { f: 2200, q: 1.4, dur: .22 });
                               tone(t, .12 * v, d, { f0: 900, f1: 300, dur: .2, type: 'triangle' }); },
      arrowHit: (t, v, d) => noiseHit(t, .3 * v, d, { f: 1400, q: 2.6, dur: .16 }),

      windDash: (t, v, d) => { const { bf, g } = noiseHit(t, .5 * v, d, { f: 500, q: .5, dur: .85 });
                               bf.frequency.setValueAtTime(280, t);
                               bf.frequency.exponentialRampToValueAtTime(5200, t + .3);
                               bf.frequency.exponentialRampToValueAtTime(700, t + .82);
                               g.gain.setValueAtTime(.02, t);
                               g.gain.linearRampToValueAtTime(.5 * v, t + .07);
                               g.gain.exponentialRampToValueAtTime(.0001, t + .85);
                               tone(t, .2 * v, d, { f0: 90, f1: 420, dur: .5, type: 'sine' }); },
      windCharge:(t, v, d) => { const { bf } = noiseHit(t, .16 * v, d, { f: 400, q: 3, dur: .9 });
                               bf.frequency.setValueAtTime(300, t);
                               bf.frequency.exponentialRampToValueAtTime(1800, t + .85); },
      launch:   (t, v, d) => { tone(t, .3 * v, d, { f0: 140, f1: 900, dur: .45, type: 'sine' });
                               noiseHit(t, .3 * v, d, { f: 800, q: .6, dur: .5 }); },

      jump:     (t, v, d) => noiseHit(t, .12 * v, d, { f: 700, q: 1.1, dur: .1 }),
      land:     (t, v, d) => { noiseHit(t, .22 * v, d, { f: 260, q: 1, dur: .18 });
                               tone(t, .14 * v, d, { f0: 90, f1: 45, dur: .2 }); },
      step:     (t, v, d) => noiseHit(t, .085 * v, d, { f: 420 + Math.random() * 320, q: 1.4, dur: .09 }),

      bomb:     (t, v, d) => { tone(t, .5 * v, d, { f0: 220, f1: 32, dur: .9 });
                               noiseHit(t, .5 * v, d, { f: 700, q: .4, dur: .9, type: 'lowpass' });
                               this._taiko(t, .4 * v, 54, d); },
      smoke:    (t, v, d) => { const { bf } = noiseHit(t, .35 * v, d, { f: 900, q: .5, dur: 1.1 });
                               bf.frequency.setValueAtTime(2600, t);
                               bf.frequency.exponentialRampToValueAtTime(340, t + 1); },
      teleport: (t, v, d) => { tone(t, .26 * v, d, { f0: 300, f1: 3200, dur: .45, type: 'triangle' });
                               tone(t + .1, .2 * v, d, { f0: 3200, f1: 260, dur: .5, type: 'sine' });
                               noiseHit(t, .2 * v, d, { f: 3000, q: 2, dur: .6 }); },

      pickup:   (t, v, d) => { tone(t, .14 * v, d, { f0: 660, f1: 990, dur: .13, type: 'triangle' });
                               tone(t + .08, .12 * v, d, { f0: 990, f1: 1320, dur: .16, type: 'triangle' }); },
      coin:     (t, v, d) => { tone(t, .12 * v, d, { f0: 1400, f1: 1900, dur: .1, type: 'square' });
                               tone(t + .06, .1 * v, d, { f0: 1900, f1: 2500, dur: .14, type: 'square' }); },
      chest:    (t, v, d) => { noiseHit(t, .3 * v, d, { f: 500, q: 1.2, dur: .5 });
                               tone(t + .2, .16 * v, d, { f0: 400, f1: 1200, dur: .5, type: 'triangle' }); },
      locked:   (t, v, d) => { noiseHit(t, .22 * v, d, { f: 1100, q: 5, dur: .16 });
                               tone(t, .1 * v, d, { f0: 200, f1: 150, dur: .2, type: 'square' }); },
      levelUp:  (t, v, d) => { [0, 4, 7, 12].forEach((s, i) =>
                                 this._pluck(note(64 + s), t + i * .1, .22 * v, .4, d));
                               this._taiko(t, .3 * v, 90, d); },
      rankUp:   (t, v, d) => { [0, 5, 7, 12, 17].forEach((s, i) =>
                                 this._pluck(note(60 + s), t + i * .11, .24 * v, .3, d));
                               this._choir(note(60), t, 2.4, .1, d); },
      hurt:     (t, v, d) => { tone(t, .26 * v, d, { f0: 300, f1: 90, dur: .3, type: 'sawtooth' });
                               noiseHit(t, .2 * v, d, { f: 600, q: 1, dur: .25 }); },
      death:    (t, v, d) => { tone(t, .34 * v, d, { f0: 220, f1: 40, dur: 1.8, type: 'sawtooth' });
                               this._taiko(t, .5 * v, 48, d);
                               this._choir(note(38), t, 3, .12, d); },
      heal:     (t, v, d) => { [0, 7, 12, 16].forEach((s, i) =>
                                 this._pluck(note(67 + s), t + i * .07, .14 * v, .5, d)); },

      bossRoar: (t, v, d) => { tone(t, .45 * v, d, { f0: 180, f1: 45, dur: 1.6, type: 'sawtooth' });
                               const { bf } = noiseHit(t, .4 * v, d, { f: 400, q: .6, dur: 1.6 });
                               bf.frequency.setValueAtTime(900, t);
                               bf.frequency.exponentialRampToValueAtTime(180, t + 1.4);
                               this._taiko(t, .55 * v, 52, d); },
      magic:    (t, v, d) => { tone(t, .2 * v, d, { f0: 900, f1: 220, dur: .7, type: 'sine' });
                               noiseHit(t, .18 * v, d, { f: 2400, q: 3, dur: .8 }); },
      thunder:  (t, v, d) => { const { bf } = noiseHit(t, .5 * v, d, { f: 300, q: .3, dur: 2.4, type: 'lowpass' });
                               bf.frequency.setValueAtTime(1800, t);
                               bf.frequency.exponentialRampToValueAtTime(120, t + 2); },
      gate:     (t, v, d) => { this._choir(note(50), t, 3.2, .16, d);
                               tone(t, .3 * v, d, { f0: 60, f1: 200, dur: 2.6, type: 'sine' });
                               noiseHit(t, .3 * v, d, { f: 1400, q: 1.2, dur: 2.6 }); },
      tame:     (t, v, d) => { [0, 4, 9].forEach((s, i) => this._pluck(note(62 + s), t + i * .12, .18 * v, .4, d)); },
      questNew: (t, v, d) => { this._pluck(note(64), t, .2 * v, .4, d);
                               this._pluck(note(71), t + .13, .18 * v, .4, d); },
      questDone:(t, v, d) => { [0, 7, 12].forEach((s, i) => this._pluck(note(65 + s), t + i * .1, .22 * v, .35, d));
                               this._taiko(t, .22 * v, 96, d); }
    };
  }

  /* Positional one-shot: attenuates by distance from the listener. */
  sfxAt(name, worldPos, listenerPos, maxDist = 60, opts = {}) {
    const dx = worldPos.x - listenerPos.x, dy = worldPos.y - listenerPos.y, dz = worldPos.z - listenerPos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > maxDist) return;
    this.sfx(name, { ...opts, volume: (opts.volume ?? 1) * (1 - d / maxDist) ** 1.6 });
  }

  /* ---------- looping rain bed ---------- */
  startRain() {
    if (!this.ready || this._rain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(4); src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = 1400; f.Q.value = .55;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
    const g = this.ctx.createGain(); g.gain.value = 0;
    g.gain.setTargetAtTime(.16, this.ctx.currentTime, 2.5);
    src.connect(f); f.connect(hp); hp.connect(g); g.connect(this.sfxBus);
    src.start();
    this._rain = { src, g };
  }
  stopRain() {
    if (!this._rain) return;
    const { src, g } = this._rain; this._rain = null;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 1.6);
    setTimeout(() => { try { src.stop(); } catch {} }, 5000);
  }

  /* ---------- looping wind bed, intensity follows player speed ---------- */
  startWind() {
    if (!this.ready || this._wind) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(4); src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = this.ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.sfxBus); src.start();
    this._wind = { src, g, f };
  }
  setWind(intensity) {
    if (!this._wind) return;
    const t = this.ctx.currentTime;
    this._wind.g.gain.setTargetAtTime(clamp(intensity, 0, 1) * .3, t, .12);
    this._wind.f.frequency.setTargetAtTime(400 + intensity * 2200, t, .12);
  }
}

export const Audio = new AudioEngine();
