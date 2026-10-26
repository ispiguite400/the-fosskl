/*
 * The score. A small step sequencer plays tracks written below as patterns (drums, bass lines,
 * chords, arpeggios and melodies in scale degrees) through synth voices.
 *
 *   music.play('lobby')              crossfade to a track
 *   music.setIntensity(0..1)         layered tracks (the chase themes) open up as the killer nears
 *   music.duration('lms_terrible')   seconds: an LMS round lasts exactly as long as its song
 *
 * Soundtrap: export a song as MP3 and put it in assets/music/, then name it in
 * assets/music/manifest.json, e.g. { "lms_terrible": "my_lms.mp3" }. A recording listed there is
 * played instead of the built-in track with that id (and an LMS lasts as long as the recording).
 */
import { audio, midiHz } from './audio.js';
import { clamp } from '../core/util.js';

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11], phrygian: [0, 1, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], major: [0, 2, 4, 5, 7, 9, 11], hungarian: [0, 2, 3, 6, 7, 8, 11], locrian: [0, 1, 3, 5, 6, 8, 10]
};
const deg = (tr, d, oct = 0) => { const s = SCALES[tr.scale] || SCALES.minor, n = s.length, o = Math.floor(d / n), i = ((d % n) + n) % n; return tr.key + 12 * (o + oct) + s[i]; };

/* ---------------- voices ---------------- */
function env(g, t, a, peak, hold, rel) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.setValueAtTime(Math.max(0.0002, peak), t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  return t + a + hold + rel;
}
function osc(ctx, type, f, t, end, out, detune = 0) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune; o.connect(out); o.start(t); o.stop(end + 0.05); return o; }
function noise(ctx, t, end, out) { const s = ctx.createBufferSource(); s.buffer = audio.noiseBuffer(); s.connect(out); s.start(t, Math.random()); s.stop(end + 0.05); return s; }
function filt(ctx, type, f, q = 0.7) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

const V = {
  kick(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.002, v, 0.02, 0.32); const o = osc(ctx, 'sine', 150, t, end, g); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); g.connect(out); },
  snare(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.002, v * 0.7, 0.01, 0.17), bp = filt(ctx, 'highpass', 1400); noise(ctx, t, end, bp); bp.connect(g); const g2 = ctx.createGain(), e2 = env(g2, t, 0.002, v * 0.5, 0.01, 0.08); osc(ctx, 'triangle', 190, t, e2, g2); g2.connect(out); g.connect(out); },
  clap(ctx, t, f, d, v, out) { const bp = filt(ctx, 'bandpass', 1200, 1.2); bp.connect(out); for (let i = 0; i < 3; i++) { const g = ctx.createGain(), e = env(g, t + i * 0.011, 0.001, v * 0.6, 0.005, i === 2 ? 0.16 : 0.02); noise(ctx, t + i * 0.011, e, g); g.connect(bp); } },
  hat(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.001, v * 0.32, 0.005, 0.04), hp = filt(ctx, 'highpass', 7500); noise(ctx, t, end, hp); hp.connect(g); g.connect(out); },
  ohat(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.001, v * 0.26, 0.02, 0.22), hp = filt(ctx, 'highpass', 6500); noise(ctx, t, end, hp); hp.connect(g); g.connect(out); },
  crash(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.002, v * 0.32, 0.05, 1.6), hp = filt(ctx, 'highpass', 4000); noise(ctx, t, end, hp); hp.connect(g); g.connect(out); },
  tom(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.002, v * 0.9, 0.02, 0.35); const o = osc(ctx, 'sine', f || 110, t, end, g); o.frequency.exponentialRampToValueAtTime((f || 110) * 0.55, t + 0.3); g.connect(out); },
  taiko(ctx, t, f, d, v, out) { V.tom(ctx, t, 70, d, v, out); const g = ctx.createGain(), end = env(g, t, 0.002, v * 0.3, 0.01, 0.12), lp = filt(ctx, 'lowpass', 900); noise(ctx, t, end, lp); lp.connect(g); g.connect(out); },
  rim(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.001, v * 0.3, 0.003, 0.03); osc(ctx, 'square', 1700, t, end, g); g.connect(out); },
  heart(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.004, v, 0.03, 0.14); osc(ctx, 'sine', 58, t, end, g); g.connect(out); },
  bass(ctx, t, f, d, v, out) {
    const g = ctx.createGain(), end = env(g, t, 0.005, v * 0.5, Math.max(0, d - 0.05), 0.08), lp = filt(ctx, 'lowpass', 300, 4);
    lp.frequency.setValueAtTime(220, t); lp.frequency.exponentialRampToValueAtTime(1100, t + 0.02); lp.frequency.exponentialRampToValueAtTime(260, t + 0.2);
    osc(ctx, 'sawtooth', f, t, end, lp); osc(ctx, 'square', f / 2, t, end, lp, 4); lp.connect(g); g.connect(out);
  },
  sub(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.01, v * 0.6, Math.max(0, d - 0.06), 0.1); osc(ctx, 'sine', f, t, end, g); g.connect(out); },
  reese(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.02, v * 0.4, Math.max(0, d - 0.06), 0.1), lp = filt(ctx, 'lowpass', 700, 2); osc(ctx, 'sawtooth', f, t, end, lp, -14); osc(ctx, 'sawtooth', f, t, end, lp, 14); osc(ctx, 'sine', f / 2, t, end, g); lp.connect(g); g.connect(out); },
  pad(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.45, v * 0.12, Math.max(0, d - 0.45), 0.9), lp = filt(ctx, 'lowpass', 1300); for (const dt of [-9, 0, 8]) osc(ctx, 'sawtooth', f, t, end, lp, dt); lp.connect(g); g.connect(out); g.connect(music.verbIn); },
  choir(ctx, t, f, d, v, out) {
    const g = ctx.createGain(), end = env(g, t, 0.6, v * 0.16, Math.max(0, d - 0.6), 1.1), src = ctx.createGain();
    for (const dt of [-7, 6]) { const o = osc(ctx, 'sawtooth', f, t, end, src, dt); const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5; lg.gain.value = 3; lfo.connect(lg); lg.connect(o.detune); lfo.start(t); lfo.stop(end + 0.05); }
    for (const [ff, q, a] of [[700, 5, 1], [1150, 7, 0.6], [2600, 9, 0.2]]) { const bp = filt(ctx, 'bandpass', ff, q), ga = ctx.createGain(); ga.gain.value = a * 2.4; src.connect(bp); bp.connect(ga); ga.connect(g); }
    g.connect(out); g.connect(music.verbIn);
  },
  organ(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.03, v * 0.12, Math.max(0, d - 0.05), 0.3); for (const m of [0.5, 1, 2, 3]) osc(ctx, 'sine', f * m, t, end, g); g.connect(out); g.connect(music.verbIn); },
  pluck(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.002, v * 0.22, 0.01, 0.28), lp = filt(ctx, 'lowpass', 3000, 2); lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.25); osc(ctx, 'sawtooth', f, t, end, lp); osc(ctx, 'square', f, t, end, lp, 7); lp.connect(g); g.connect(out); g.connect(music.delayIn); },
  bell(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.002, v * 0.2, 0.01, 1.4); const c = osc(ctx, 'sine', f, t, end, g); const m = ctx.createOscillator(), mg = ctx.createGain(); m.frequency.value = f * 3.5; mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(1, t + 1.2); m.connect(mg); mg.connect(c.frequency); m.start(t); m.stop(end + 0.05); g.connect(out); g.connect(music.verbIn); },
  box(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.002, v * 0.18, 0.01, 0.9); osc(ctx, 'sine', f * 2, t, end, g); osc(ctx, 'triangle', f * 4.01, t, end, g); g.connect(out); g.connect(music.verbIn); },
  piano(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.003, v * 0.2, 0.05, Math.min(1.6, d + 0.6)), lp = filt(ctx, 'lowpass', 2400); osc(ctx, 'triangle', f, t, end, lp); osc(ctx, 'sine', f * 2, t, end, lp, 3); lp.connect(g); g.connect(out); g.connect(music.verbIn); },
  lead(ctx, t, f, d, v, out) {
    const g = ctx.createGain(), end = env(g, t, 0.01, v * 0.16, Math.max(0, d - 0.02), 0.14), lp = filt(ctx, 'lowpass', 3200, 1);
    const a = osc(ctx, 'square', f, t, end, lp), b = osc(ctx, 'sawtooth', f, t, end, lp, 9);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.5; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(14, t + 0.3); lfo.connect(lg); lg.connect(a.detune); lg.connect(b.detune); lfo.start(t); lfo.stop(end + 0.05);
    lp.connect(g); g.connect(out); g.connect(music.delayIn);
  },
  saw(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.01, v * 0.12, Math.max(0, d - 0.02), 0.12), lp = filt(ctx, 'lowpass', 2600, 1); for (const dt of [-12, -4, 4, 12]) osc(ctx, 'sawtooth', f, t, end, lp, dt); lp.connect(g); g.connect(out); g.connect(music.delayIn); },
  brass(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 0.06, v * 0.2, Math.max(0, d - 0.06), 0.2), lp = filt(ctx, 'lowpass', 400, 2); lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(2400, t + 0.08); lp.frequency.linearRampToValueAtTime(1400, t + 0.4); osc(ctx, 'sawtooth', f, t, end, lp, -5); osc(ctx, 'sawtooth', f, t, end, lp, 5); lp.connect(g); g.connect(out); g.connect(music.verbIn); },
  drone(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, 1.2, v * 0.16, Math.max(0, d - 1.2), 1.6), lp = filt(ctx, 'lowpass', 500, 3); osc(ctx, 'sawtooth', f, t, end, lp, -6); osc(ctx, 'sawtooth', f * 1.5, t, end, lp, 5); lp.connect(g); g.connect(out); g.connect(music.verbIn); },
  riser(ctx, t, f, d, v, out) { const g = ctx.createGain(), end = env(g, t, d * 0.9, v * 0.3, 0.01, 0.05), bp = filt(ctx, 'bandpass', 300, 2); bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(6000, t + d); noise(ctx, t, end, bp); bp.connect(g); g.connect(out); }
};

/* ---------------- track helpers ---------------- */
// drum lines: 16 chars per bar; X accent, x hit, g ghost
const D = (inst, pat, layer = 0, vol = 1) => ({ kind: 'drum', inst, pat, layer, vol });
// bass: x root, o octave, 5 fifth, 3 third, - hold, . rest (follows the chord)
const BASS = (inst, pat, layer = 0, vol = 1, oct = -2) => ({ kind: 'bass', inst, pat, layer, vol, oct });
// pad: the chord, held for its length
const PAD = (inst, layer = 0, vol = 1, oct = -1, voices = 3) => ({ kind: 'pad', inst, layer, vol, oct, voices });
// arp: x = next chord tone (mode up/down/updown/random), - hold
const ARP = (inst, pat, mode = 'up', layer = 0, vol = 1, oct = 0, span = 2) => ({ kind: 'arp', inst, pat, mode, layer, vol, oct, span });
// melody in scale degrees: bars separated by |, 8 or 16 tokens a bar; numbers, - hold, . rest
const MEL = (inst, notes, layer = 0, vol = 1, oct = 0) => ({ kind: 'mel', inst, bars: notes.split('|').map((b) => b.trim().split(/\s+/)), layer, vol, oct });

/* ---------------- the tracks ---------------- */
export const TRACKS = {
  title: {
    title: 'Forlorn', bpm: 68, key: 50, scale: 'harmonic', prog: [0, 0, 5, 4], loop: true,
    parts: {
      drone: PAD('drone', 0, 1, -2, 2), choir: PAD('choir', 0, 0.8, 0),
      box: MEL('box', '4 . 3 . 2 . 0 . | 1 . 2 . -1 . . . | 4 . 3 . 2 . 4 . | 5 . 4 - - - . .', 0, 1, 1),
      heart: D('heart', 'x..x............', 0, 0.6)
    }
  },
  lobby: {
    title: 'Campfire', bpm: 84, key: 57, scale: 'dorian', prog: [0, 3, 5, 4], swing: 0.12, loop: true,
    parts: {
      keys: PAD('piano', 0, 1.3, 0, 4),
      bass: BASS('sub', 'x.....x.x.......', 0, 1.1),
      kick: D('kick', 'x......x..x.....', 0, 0.7), snare: D('snare', '....x.......x...', 0, 0.45), hat: D('hat', 'x.xgx.xgx.xgx.xg', 0, 0.6),
      bell: MEL('bell', '. . 4 . 2 . . . | . . 3 . 4 . 2 . | . . 4 . 6 . 4 . | 3 . 2 . 0 . . .', 0, 0.8, 1)
    }
  },
  results: { title: 'Aftermath', bpm: 76, key: 52, scale: 'minor', prog: [0, 5, 2, 6], loop: true, parts: { pad: PAD('pad', 0, 1.2, -1, 3), keys: ARP('piano', 'x...x...x...x...', 'up', 0, 1, 0), bass: BASS('sub', 'x-------x-------', 0, 0.9) } },

  // map ambience: quiet, sparse, one per film's mood
  amb_village: { title: 'Ashes of Home', bpm: 60, key: 50, scale: 'minor', prog: [0, 5, 3, 4], loop: true, parts: { drone: PAD('drone', 0, 1, -2, 2), pad: PAD('pad', 0, 0.6, -1, 3), box: MEL('box', '. . . . 4 . . . | . . 2 . . . . . | . . . . 3 . 2 . | 0 . . . . . . .', 0, 0.6, 1) } },
  amb_prison: { title: 'Cell Block', bpm: 64, key: 48, scale: 'phrygian', prog: [0, 1, 0, 6], loop: true, parts: { drone: PAD('drone', 0, 1, -2, 2), rim: D('rim', 'x.......x.......', 0, 0.3), bell: MEL('bell', '. . . . 0 . . . | . . . . 1 . . . | . . . . 0 . . . | . . . . -1 . . .', 0, 0.5, 0) } },
  amb_school: { title: 'After Hours', bpm: 70, key: 53, scale: 'minor', prog: [0, 5, 6, 4], loop: true, parts: { pad: PAD('pad', 0, 0.8, -1, 3), box: MEL('box', '0 . 2 . 4 . 2 . | 0 . 2 . 5 . 4 . | 0 . 2 . 4 . 7 . | 6 . 4 . 2 - - -', 0, 0.55, 1), sub: BASS('sub', 'x-------........', 0, 0.6) } },
  amb_war: { title: 'No Man\'s Land', bpm: 58, key: 45, scale: 'minor', prog: [0, 6, 5, 4], loop: true, parts: { drone: PAD('drone', 0, 1, -2, 2), brass: MEL('brass', '0 - - - - - - - | . . . . . . . . | 4 - - - 3 - - - | . . . . . . . .', 0, 0.5, -1), tom: D('taiko', 'x...............', 0, 0.4) } },
  amb_hospital: { title: 'Visiting Hours', bpm: 62, key: 54, scale: 'locrian', prog: [0, 1, 0, 3], loop: true, parts: { pad: PAD('organ', 0, 0.6, -1, 3), heart: D('heart', 'x..x............', 0, 0.35), box: MEL('box', '. . . . . . 4 . | . . . . . . 3 . | . . . . . . 1 . | . . . . 0 . . .', 0, 0.5, 1) } },
  amb_forest: { title: 'Campfire Stories', bpm: 66, key: 55, scale: 'dorian', prog: [0, 3, 0, 4], loop: true, parts: { pad: PAD('pad', 0, 0.7, -1, 3), keys: ARP('pluck', 'x...x...x...x...', 'updown', 0, 0.5, 0), sub: BASS('sub', 'x-------x-------', 0, 0.5) } },
  amb_limbo: { title: 'Between', bpm: 50, key: 49, scale: 'hungarian', prog: [0, 3, 1, 4], loop: true, parts: { choir: PAD('choir', 0, 1, 0, 3), drone: PAD('drone', 0, 0.9, -2, 2), bell: MEL('bell', '7 . . . . . . . | 6 . . . . . . . | 4 . . . . . . . | 3 . . . . . . .', 0, 0.5, 0) } },

  /* chase themes: layer 1 far (terror radius), 2 closer, 3 in the chase */
  chase_terrible: {
    title: 'He Never Left', bpm: 138, key: 50, scale: 'harmonic', prog: [0, 0, 5, 4], loop: true, layered: true,
    parts: {
      drone: PAD('drone', 1, 1.1, -2, 2), heart: D('heart', 'x..x....x..x....', 1, 0.9),
      pulse: BASS('reese', 'x.x.x.x.x.x.x.x.', 2, 0.8), hat: D('hat', '..x...x...x...x.', 2, 0.7),
      kick: D('kick', 'x...x...x...x...', 3, 1), snare: D('clap', '....x.......x...', 3, 0.8), hats: D('hat', 'xxxxxxxxxxxxxxxx', 3, 0.5),
      choir: PAD('choir', 3, 0.9, 0),
      lead: MEL('box', '4 . 4 . 3 . 4 . 5 . 4 . 3 . 2 . | 1 . 1 . 0 . 1 . 2 . 1 . 0 . -1 . | 4 . 4 . 3 . 4 . 7 . 6 . 5 . 4 . | 3 . 2 . 1 . 2 . 0 - - - . . . .', 3, 1.1, 1)
    }
  },
  chase_bacongeneral: {
    title: 'Empire March', bpm: 128, key: 48, scale: 'minor', prog: [0, 5, 6, 4], loop: true, layered: true,
    parts: {
      drone: PAD('drone', 1, 1, -2, 2), roll: D('snare', 'g.g.g.g.g.g.g.g.', 1, 0.35),
      bass: BASS('bass', 'x..x..x.x..x..x.', 2, 0.9), tom: D('taiko', 'x.......x.x.....', 2, 0.8),
      kick: D('kick', 'x...x...x...x...', 3, 1), snare: D('snare', '....X.......Xxgx', 3, 0.9), hat: D('hat', 'x.x.x.x.x.x.x.x.', 3, 0.6),
      brass: MEL('brass', '0 - - 0 2 - 3 - | 4 - - - 3 - 2 - | 0 - - 0 2 - 3 - | 5 - 4 - 2 - - - ', 3, 1, 0),
      pad: PAD('pad', 3, 0.6, -1)
    }
  },
  chase_baconcolonel: {
    title: 'Iron Fist', bpm: 120, key: 45, scale: 'phrygian', prog: [0, 1, 0, 6], loop: true, layered: true,
    parts: {
      drone: PAD('drone', 1, 1, -2, 2), tick: D('rim', 'x...x...x...x...', 1, 0.5),
      bass: BASS('reese', 'x...x...x..xx...', 2, 0.9), tom: D('tom', '....x.......x...', 2, 0.6),
      kick: D('kick', 'x..x..x...x..x..', 3, 1), snare: D('clap', '....x.......x...', 3, 0.8), hat: D('ohat', '..x...x...x...x.', 3, 0.6),
      brass: MEL('brass', '0 - - - 1 - - - | 0 - - - -1 - - - | 3 - 2 - 1 - 0 - | 1 - - - - - - - ', 3, 1, 0),
      arp: ARP('pluck', 'x.xxx.xxx.xxx.xx', 'down', 3, 0.6, 1)
    }
  },
  chase_eliteguard: {
    title: 'Undefeated', bpm: 152, key: 52, scale: 'phrygian', prog: [0, 1, 6, 0], loop: true, layered: true,
    parts: {
      drone: PAD('drone', 1, 1, -2, 2), taiko: D('taiko', 'x.......x.......', 1, 0.8),
      arp: ARP('pluck', 'xxxxxxxxxxxxxxxx', 'updown', 2, 0.7, 0), bass: BASS('bass', 'x.x.x.x.x.x.x.x.', 2, 0.8),
      kick: D('kick', 'x.x...x.x.x...x.', 3, 1), snare: D('snare', '....x.......x..x', 3, 0.8), hat: D('hat', 'x.x.x.x.x.x.x.x.', 3, 0.5), crash: D('crash', 'x...............', 3, 0.4),
      lead: MEL('saw', '7 - 8 - 7 - 5 - 4 - 5 - 1 - 0 - | 7 - 8 - 7 - 5 - 8 - 9 - 8 - - - ', 3, 0.9, 0)
    }
  },
  chase_bloxwatch: {
    title: 'The First Guest', bpm: 126, key: 49, scale: 'hungarian', prog: [0, 3, 1, 4], loop: true, layered: true,
    parts: {
      choir: PAD('choir', 1, 1, 0), heart: D('heart', 'x..x............', 1, 0.7),
      reese: BASS('reese', 'x-------x---x---', 2, 1), arp: ARP('bell', 'x...x...x...x.x.', 'random', 2, 0.6, 1),
      kick: D('kick', 'x...x...x...x...', 3, 1), clap: D('clap', '....x.......x...', 3, 0.8), hat: D('hat', 'x.xxx.xxx.xxx.xx', 3, 0.5),
      lead: MEL('lead', '4 - - 3 4 - 7 - | 6 - - - 4 - - - | 3 - - 2 3 - 6 - | 4 - - - - - - - ', 3, 1, 1),
      zap: ARP('pluck', 'x.x.x.x.x.x.x.x.', 'up', 3, 0.45, 1)
    }
  },

  /* LAST MAN STANDING: one song per killer, and matchups from the films get their own. */
  lms_terrible: {
    title: 'Final Detention', artist: 'FORLORN OST', bpm: 150, key: 50, scale: 'harmonic', prog: [0, 5, 3, 4], loop: false,
    sections: [
      { bars: 4, on: 'drone heart box' }, { bars: 4, on: 'drone heart box riser hat' },
      { bars: 16, on: 'kick snare hat bass choir lead' }, { bars: 8, on: 'drone heart box pad bass' },
      { bars: 4, on: 'drone heart box riser hat bass' }, { bars: 16, on: 'kick snare hat bass choir lead arp crash' }, { bars: 4, on: 'drone choir box' }
    ],
    parts: {
      drone: PAD('drone', 0, 1, -2, 2), heart: D('heart', 'x..x....x..x....', 0, 0.9), riser: { kind: 'riser', layer: 0, vol: 0.9 },
      box: MEL('box', '4 . 3 . 2 . 0 . | 1 . 2 . -1 . . . | 4 . 3 . 2 . 4 . | 5 . 4 - - - . .', 0, 1, 1),
      kick: D('kick', 'x...x...x...x.x.', 0, 1), snare: D('snare', '....X.......X...', 0, 0.9), hat: D('hat', 'x.xxx.xxx.xxx.xx', 0, 0.55), crash: D('crash', 'x...............', 0, 0.4),
      bass: BASS('reese', 'x.x.xx.xx.x.xx.x', 0, 0.85), choir: PAD('choir', 0, 1, 0), pad: PAD('pad', 0, 0.8, -1),
      lead: MEL('lead', '4 - 4 - 5 - 4 - 3 - 2 - 3 - 4 - | 7 - - - 6 - 5 - 4 - - - . . . . | 4 - 4 - 5 - 4 - 3 - 2 - 0 - 2 - | 1 - - - -1 - - - 0 - - - . . . .', 0, 1.1, 1),
      arp: ARP('pluck', 'xxxxxxxxxxxxxxxx', 'updown', 0, 0.45, 1)
    }
  },
  lms_bacongeneral: {
    title: 'Last Guest Standing', artist: 'FORLORN OST', bpm: 140, key: 48, scale: 'minor', prog: [0, 5, 6, 4], loop: false,
    sections: [
      { bars: 4, on: 'roll drone brassA' }, { bars: 4, on: 'roll drone brassA tom riser' },
      { bars: 16, on: 'kick snare hat bass brassB pad tom' }, { bars: 8, on: 'roll drone pad brassA' },
      { bars: 16, on: 'kick snare hat bass brassB pad arp crash' }, { bars: 4, on: 'drone brassA' }
    ],
    parts: {
      drone: PAD('drone', 0, 1, -2, 2), roll: D('snare', 'g.g.g.g.g.g.gxgx', 0, 0.4), riser: { kind: 'riser', layer: 0, vol: 0.9 }, tom: D('taiko', 'x.....x.x.......', 0, 0.8),
      brassA: MEL('brass', '0 - - - - - - - | 2 - - - 3 - - - | 4 - - - - - - - | 3 - 2 - - - - - ', 0, 0.9, 0),
      kick: D('kick', 'x...x...x...x...', 0, 1), snare: D('snare', '....X.......X.xx', 0, 0.9), hat: D('hat', 'x.x.x.x.x.x.x.x.', 0, 0.6), crash: D('crash', 'x...............', 0, 0.4),
      bass: BASS('bass', 'x..x..x.x..x..x.', 0, 0.9), pad: PAD('pad', 0, 0.7, -1),
      brassB: MEL('brass', '0 - - 0 2 - 3 - 4 - - - 7 - 6 - | 5 - - - 4 - 3 - 2 - - - . . . . | 0 - - 0 2 - 3 - 4 - - - 7 - 9 - | 8 - - - 7 - 6 - 7 - - - . . . . ', 0, 1, 0),
      arp: ARP('pluck', 'x.xxx.xxx.xxx.xx', 'up', 0, 0.45, 1)
    }
  },
  lms_baconcolonel: {
    title: 'One Eye Open', artist: 'FORLORN OST', bpm: 132, key: 45, scale: 'phrygian', prog: [0, 1, 6, 0], loop: false,
    sections: [{ bars: 8, on: 'drone tick bass' }, { bars: 16, on: 'kick snare hat bass brass arp' }, { bars: 8, on: 'drone tick pad' }, { bars: 16, on: 'kick snare hat bass brass arp crash pad' }, { bars: 4, on: 'drone pad' }],
    parts: {
      drone: PAD('drone', 0, 1, -2, 2), tick: D('rim', 'x...x...x...x.x.', 0, 0.5), pad: PAD('pad', 0, 0.8, -1),
      kick: D('kick', 'x..x..x...x..x..', 0, 1), snare: D('clap', '....x.......x...', 0, 0.8), hat: D('ohat', '..x...x...x...x.', 0, 0.6), crash: D('crash', 'x...............', 0, 0.4),
      bass: BASS('reese', 'x...x...x..xx...', 0, 0.9), arp: ARP('pluck', 'x.xxx.xxx.xxx.xx', 'down', 0, 0.5, 1),
      brass: MEL('brass', '0 - - - 1 - - - 3 - 1 - 0 - - - | -1 - - - 0 - - - 1 - - - - - - - ', 0, 1, 0)
    }
  },
  lms_eliteguard: {
    title: 'Duel at Dusk', artist: 'FORLORN OST', bpm: 160, key: 52, scale: 'phrygian', prog: [0, 1, 6, 0], loop: false,
    sections: [{ bars: 4, on: 'taiko drone' }, { bars: 4, on: 'taiko drone arp riser' }, { bars: 16, on: 'kick snare hat arp bass lead' }, { bars: 8, on: 'taiko drone arp' }, { bars: 16, on: 'kick snare hat arp bass lead crash' }, { bars: 4, on: 'taiko drone' }],
    parts: {
      drone: PAD('drone', 0, 1, -2, 2), taiko: D('taiko', 'x.....x.x...x...', 0, 0.9), riser: { kind: 'riser', layer: 0, vol: 0.9 },
      arp: ARP('pluck', 'xxxxxxxxxxxxxxxx', 'updown', 0, 0.6, 0), bass: BASS('bass', 'x.x.x.x.x.x.x.x.', 0, 0.85),
      kick: D('kick', 'x.x...x.x.x...x.', 0, 1), snare: D('snare', '....x.......x..x', 0, 0.8), hat: D('hat', 'x.x.x.x.x.x.x.x.', 0, 0.5), crash: D('crash', 'x...............', 0, 0.4),
      lead: MEL('saw', '7 - 8 - 7 - 5 - 4 - 5 - 1 - 0 - | 7 - 8 - 7 - 5 - 8 - 9 - 8 - - - | 11 - 10 - 8 - 7 - 8 - 7 - 5 - 4 - | 5 - 4 - 1 - - - 0 - - - . . . . ', 0, 0.9, 0)
    }
  },
  lms_bloxwatch: {
    title: 'Astral Judgement', artist: 'FORLORN OST', bpm: 136, key: 49, scale: 'hungarian', prog: [0, 3, 1, 4], loop: false,
    sections: [{ bars: 8, on: 'choir heart bell' }, { bars: 16, on: 'kick clap hat reese lead zap' }, { bars: 8, on: 'choir bell reese' }, { bars: 16, on: 'kick clap hat reese lead zap choir crash' }, { bars: 4, on: 'choir bell' }],
    parts: {
      choir: PAD('choir', 0, 1, 0), heart: D('heart', 'x..x............', 0, 0.7), bell: ARP('bell', 'x...x...x...x.x.', 'random', 0, 0.6, 1),
      kick: D('kick', 'x...x...x...x...', 0, 1), clap: D('clap', '....x.......x...', 0, 0.8), hat: D('hat', 'x.xxx.xxx.xxx.xx', 0, 0.5), crash: D('crash', 'x...............', 0, 0.4),
      reese: BASS('reese', 'x-------x---x---', 0, 1), zap: ARP('pluck', 'x.x.x.x.x.x.x.x.', 'up', 0, 0.45, 1),
      lead: MEL('lead', '4 - - 3 4 - 7 - | 6 - - - 4 - - - | 3 - - 2 3 - 6 - | 4 - - - - - - - | 7 - - 6 7 - 9 - | 8 - - - 7 - - - | 6 - - 4 3 - 2 - | 0 - - - - - - - ', 0, 1, 1)
    }
  },
  // matchups straight out of the films
  lms_guest1337_bacongeneral: {
    title: 'The Last Guest', artist: 'FORLORN OST', bpm: 146, key: 50, scale: 'minor', prog: [0, 5, 2, 6], loop: false,
    sections: [{ bars: 4, on: 'piano drone' }, { bars: 4, on: 'piano drone riser roll' }, { bars: 16, on: 'kick snare hat bass saw pad' }, { bars: 8, on: 'piano pad roll' }, { bars: 16, on: 'kick snare hat bass saw pad brass crash' }, { bars: 4, on: 'piano pad' }],
    parts: {
      piano: ARP('piano', 'x..x..x.x..x..x.', 'up', 0, 1, 0), drone: PAD('drone', 0, 0.9, -2, 2), riser: { kind: 'riser', layer: 0, vol: 0.9 }, roll: D('snare', 'g.g.g.g.g.g.gxgx', 0, 0.4),
      kick: D('kick', 'x...x...x...x...', 0, 1), snare: D('snare', '....X.......X...', 0, 0.9), hat: D('hat', 'x.xxx.xxx.xxx.xx', 0, 0.55), crash: D('crash', 'x...............', 0, 0.4),
      bass: BASS('bass', 'x.xxx.xxx.xxx.xx', 0, 0.8), pad: PAD('pad', 0, 0.8, -1),
      saw: MEL('saw', '4 - - - 2 - 4 - 5 - 4 - 2 - 0 - | 1 - - - -1 - 1 - 2 - - - . . . . | 4 - - - 2 - 4 - 7 - 6 - 5 - 4 - | 5 - - - 4 - 2 - 4 - - - . . . . ', 0, 1, 1),
      brass: PAD('brass', 0, 0.7, -1)
    }
  },
  lms_emily_terrible: {
    title: 'Watched Over', artist: 'FORLORN OST', bpm: 128, key: 53, scale: 'harmonic', prog: [0, 5, 3, 4], loop: false,
    sections: [{ bars: 8, on: 'box drone' }, { bars: 16, on: 'kick snare hat bass box choir' }, { bars: 8, on: 'box pad' }, { bars: 16, on: 'kick snare hat bass box choir lead crash' }, { bars: 4, on: 'box' }],
    parts: {
      box: MEL('box', '0 . 2 . 4 . 2 . 0 . 2 . 5 . 4 . | 0 . 2 . 4 . 7 . 6 . 4 . 2 . 1 .', 0, 1, 1), drone: PAD('drone', 0, 0.9, -2, 2), pad: PAD('pad', 0, 0.8, -1), choir: PAD('choir', 0, 0.9, 0),
      kick: D('kick', 'x...x...x...x...', 0, 1), snare: D('clap', '....x.......x...', 0, 0.8), hat: D('hat', '..x...x...x...x.', 0, 0.6), crash: D('crash', 'x...............', 0, 0.4),
      bass: BASS('reese', 'x.......x...x...', 0, 0.9),
      lead: MEL('lead', '7 - - - 6 - - - 4 - - - 2 - - - | 3 - - - 4 - - - 2 - - - - - - - ', 0, 0.9, 0)
    }
  },
  lms_charlie_bloxwatch: {
    title: 'Astral Bloodline', artist: 'FORLORN OST', bpm: 140, key: 49, scale: 'hungarian', prog: [0, 3, 1, 4], loop: false,
    sections: [{ bars: 4, on: 'bell choir' }, { bars: 4, on: 'bell choir riser' }, { bars: 16, on: 'kick clap hat reese lead arp' }, { bars: 8, on: 'bell choir reese' }, { bars: 16, on: 'kick clap hat reese lead arp choir crash' }, { bars: 4, on: 'bell' }],
    parts: {
      bell: ARP('bell', 'x.x.x.x.x.x.x.x.', 'updown', 0, 0.6, 1), choir: PAD('choir', 0, 1, 0), riser: { kind: 'riser', layer: 0, vol: 0.9 },
      kick: D('kick', 'x..x..x...x..x..', 0, 1), clap: D('clap', '....x.......x...', 0, 0.8), hat: D('hat', 'xxxxxxxxxxxxxxxx', 0, 0.45), crash: D('crash', 'x...............', 0, 0.4),
      reese: BASS('reese', 'x---x---x---x-x-', 0, 1), arp: ARP('pluck', 'xxxxxxxxxxxxxxxx', 'up', 0, 0.4, 1),
      lead: MEL('lead', '0 - 4 - 7 - 6 - 4 - 3 - 4 - - - | 3 - 1 - 3 - 4 - 1 - - - . . . . | 0 - 4 - 7 - 9 - 8 - 7 - 6 - - - | 4 - 3 - 1 - 3 - 0 - - - . . . . ', 0, 1, 1)
    }
  }
};

/** The LMS song for a matchup: the films' pairings first, then the killer's own. */
export function lmsTrackFor(survivorId, killerId) {
  if (TRACKS['lms_' + survivorId + '_' + killerId]) return 'lms_' + survivorId + '_' + killerId;
  if (survivorId === 'jez' && killerId === 'bacongeneral') return 'lms_guest1337_bacongeneral';
  if (TRACKS['lms_' + killerId]) return 'lms_' + killerId;
  return 'lms_terrible';
}

/* ---------------- the player ---------------- */
class Music {
  constructor() {
    this.cur = null; this.intensity = 0; this.recordings = {}; this.manifest = null;
    this.verbIn = null; this.delayIn = null;
    this._timer = null;
  }
  async loadManifest() {
    try {
      const r = await fetch('assets/music/manifest.json', { cache: 'no-cache' });
      if (r.ok) this.manifest = await r.json();
    } catch { this.manifest = null; }
    return this.manifest;
  }
  _graph() {
    if (this.verbIn || !audio.ctx) return;
    this.verbIn = audio.ctx.createGain(); this.verbIn.gain.value = 0.35; this.verbIn.connect(audio.verbSend);
    this.delayIn = audio.ctx.createGain(); this.delayIn.gain.value = 0.25; this.delayIn.connect(audio.delaySend);
  }
  /** Seconds a track lasts once (an LMS round is this long). */
  duration(id) {
    const rec = this.recordings[id]; if (rec && rec.buffer) return rec.buffer.duration;
    const tr = TRACKS[id]; if (!tr) return 90;
    const bars = tr.sections ? tr.sections.reduce((s, x) => s + x.bars, 0) : 16;
    return bars * 4 * 60 / tr.bpm;
  }
  title(id) { const tr = TRACKS[id]; return tr ? tr.title : id; }
  /** Fetch a Soundtrap export named in the manifest, if any, before it is needed. */
  async prepare(id) {
    if (!audio.ctx || !this.manifest || !this.manifest[id] || this.recordings[id]) return;
    const entry = this.recordings[id] = { buffer: null };
    try {
      const r = await fetch('assets/music/' + this.manifest[id]);
      if (!r.ok) return;
      entry.buffer = await audio.ctx.decodeAudioData(await r.arrayBuffer());
    } catch { entry.buffer = null; }
  }
  play(id, { fade = 1.2, restart = false } = {}) {
    if (!audio.ctx) { this.pending = id; return; }
    this._graph();
    if (this.cur && this.cur.id === id && !restart) return;
    const ctx = audio.ctx, now = ctx.currentTime;
    if (this.cur) this._fadeOut(this.cur, fade);
    const tr = TRACKS[id];
    const out = ctx.createGain(); out.gain.setValueAtTime(0.0001, now); out.gain.exponentialRampToValueAtTime(1, now + Math.max(0.05, fade)); out.connect(audio.music);
    const layers = [0, 1, 2, 3].map(() => { const g = ctx.createGain(); g.connect(out); return g; });
    const st = { id, tr, out, layers, step: 0, next: now + 0.08, start: now + 0.08, ended: false, voices: 0 };
    const rec = this.recordings[id];
    if (rec && rec.buffer) {
      const s = ctx.createBufferSource(); s.buffer = rec.buffer; s.loop = !tr || tr.loop !== false; s.connect(layers[0]); s.start(now + 0.05);
      st.source = s;
    }
    this.cur = st;
    this._applyLayers(0.01);
    if (!this._timer) this._timer = setInterval(() => this._tick(), 25);
  }
  stop(fade = 1) { if (this.cur) this._fadeOut(this.cur, fade); this.cur = null; }
  _fadeOut(st, fade) {
    const now = audio.ctx.currentTime;
    st.out.gain.cancelScheduledValues(now); st.out.gain.setValueAtTime(st.out.gain.value, now); st.out.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.05, fade));
    st.ended = true;
    if (st.source) try { st.source.stop(now + fade + 0.1); } catch { /* already stopped */ }
    setTimeout(() => st.out.disconnect(), (fade + 2.5) * 1000);
  }
  setIntensity(x) { this.intensity = clamp(x, 0, 1); this._applyLayers(0.4); }
  _applyLayers(tc) {
    const st = this.cur; if (!st || !audio.ctx) return;
    const now = audio.ctx.currentTime, x = this.intensity;
    const layered = st.tr && st.tr.layered;
    st.layers.forEach((g, L) => {
      let v = 1;
      if (layered && L > 0) v = clamp(x * 3 - (L - 1), 0, 1);
      if (layered && st.source) v = L === 0 ? clamp(0.25 + x, 0, 1) : 0;
      g.gain.setTargetAtTime(v, now, tc);
    });
  }
  _tick() {
    const st = this.cur; if (!st || st.ended || !audio.ctx || st.source) return;
    const ctx = audio.ctx, tr = st.tr; if (!tr) return;
    const sp16 = 60 / tr.bpm / 4;
    while (st.next < ctx.currentTime + 0.14) {
      this._step(st, st.step, st.next, sp16);
      st.step++;
      const sw = tr.swing && st.step % 2 === 1 ? sp16 * tr.swing : (tr.swing && st.step % 2 === 0 ? -sp16 * tr.swing : 0);
      st.next += sp16 + sw;
    }
  }
  _section(tr, bar) {
    if (!tr.sections) return null;
    let b = bar;
    const total = tr.sections.reduce((s, x) => s + x.bars, 0);
    if (b >= total) { if (tr.loop === false) b = total - 1 - ((b - total) % tr.sections[tr.sections.length - 1].bars); else b %= total; }
    for (const s of tr.sections) { if (b < s.bars) return { on: s.on.split(/\s+/), barIn: b, len: s.bars }; b -= s.bars; }
    return null;
  }
  _step(st, step, t, sp16) {
    const tr = st.tr, ctx = audio.ctx;
    const bar = Math.floor(step / 16), s = step % 16;
    const sec = this._section(tr, bar);
    const chordDeg = tr.prog[bar % tr.prog.length];
    const chord = [chordDeg, chordDeg + 2, chordDeg + 4, chordDeg + 7];
    for (const name in tr.parts) {
      const p = tr.parts[name];
      if (sec && !sec.on.includes(name)) continue;
      const out = st.layers[p.layer || 0];
      const vol = p.vol || 1;
      if (p.kind === 'drum') {
        const c = p.pat[s]; if (!c || c === '.') continue;
        const v = (c === 'X' ? 1.25 : c === 'g' ? 0.4 : 1) * vol;
        V[p.inst](ctx, t, 0, sp16, v, out);
      } else if (p.kind === 'riser') {
        if (s === 0 && sec && sec.barIn === sec.len - 1) V.riser(ctx, t, 0, sp16 * 16, vol, out);
      } else if (p.kind === 'pad') {
        if (s !== 0) continue;
        const prev = tr.prog[(bar + tr.prog.length - 1) % tr.prog.length];
        if (bar > 0 && prev === chordDeg && bar % tr.prog.length !== 0 && !(sec && sec.barIn === 0)) continue;
        let len = 1; while (len < tr.prog.length && tr.prog[(bar + len) % tr.prog.length] === chordDeg) len++;
        const dur = sp16 * 16 * len;
        for (let i = 0; i < p.voices; i++) V[p.inst](ctx, t, midiHz(deg(tr, chord[i], p.oct)), dur, vol, out);
      } else if (p.kind === 'bass') {
        const c = p.pat[s]; if (!c || c === '.' || c === '-') continue;
        let len = 1; while (s + len < 16 && p.pat[s + len] === '-') len++;
        const d = c === 'o' ? chordDeg + 7 : c === '5' ? chordDeg + 4 : c === '3' ? chordDeg + 2 : chordDeg;
        V[p.inst](ctx, t, midiHz(deg(tr, d, p.oct)), sp16 * len, vol, out);
      } else if (p.kind === 'arp') {
        const c = p.pat[s]; if (!c || c !== 'x') continue;
        let len = 1; while (s + len < 16 && p.pat[s + len] === '-') len++;
        const tones = []; for (let o = 0; o < p.span; o++) for (const d of chord.slice(0, 3)) tones.push(d + o * 7);
        const n = tones.length, k = step;
        let idx;
        if (p.mode === 'down') idx = n - 1 - (k % n);
        else if (p.mode === 'updown') { const m = k % (2 * n - 2); idx = m < n ? m : 2 * n - 2 - m; }
        else if (p.mode === 'random') idx = (k * 7 + bar * 3) % n;
        else idx = k % n;
        V[p.inst](ctx, t, midiHz(deg(tr, tones[idx], p.oct)), sp16 * len, vol, out);
      } else if (p.kind === 'mel') {
        const B = p.bars[bar % p.bars.length], per = 16 / B.length;
        if (s % per !== 0) continue;
        const i = s / per, tok = B[i];
        if (!tok || tok === '.' || tok === '-') continue;
        let len = 1; while (i + len < B.length && B[i + len] === '-') len++;
        V[p.inst](ctx, t, midiHz(deg(tr, parseInt(tok, 10), p.oct)), sp16 * per * len, vol, out);
      }
    }
  }
}

export const music = new Music();
document.addEventListener('forlorn-audio', () => { if (music.pending) { const p = music.pending; music.pending = null; music.play(p); } });
