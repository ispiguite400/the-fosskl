/*
 * LIMBO — the place between, where the Astrals go (Blox Watch).
 * Black stone cracked with gold, broken pillars, monoliths and crystals, ruins hanging in the
 * void overhead, a ring temple at the centre. The sky is the colour of a bruise.
 */
import { rock, frame } from '../prefabs.js';
import { pillar, monolith, crystal } from '../prefabs2.js';
import { TAU } from '../../core/util.js';

export default {
  id: 'limbo', name: 'Limbo', film: 'Blox Watch',
  blurb: 'Between worlds, where the Astrals go. The First Guest is waiting.',
  size: [96, 96],
  surface: 'metal',
  ambience: {
    sky: { top: 0x05020c, horizon: 0x5a2a6a, bottom: 0x0a0414, sunDir: [0, 0.25, -1], sunColor: 0xffd21f, sunSize: 0.03, stars: 1, clouds: 0.6, cloud: 0x2a1238 },
    fog: { color: 0x1a0c26, density: 0.024 },
    hemi: { sky: 0x8a5ab0, ground: 0x24182c, intensity: 1.1 },
    sun: { dir: [0, 0.5, -0.85], color: 0xffd88a, intensity: 1.35 },
    envIntensity: 0.6,
    grade: { tint: [1.02, 0.96, 1.08], sat: 1.12, contrast: 1.1 },
    particles: 'motes'
  },
  music: 'limbo',
  card: { at: [14, 8, 18], look: [0, 4, 0] },
  event: { at: 0.45, kind: 'storm', title: 'ASTRAL STORM', text: 'Lightning is striking the stone: watch for the gold circles', sound: 'thunder', count: 18, every: 0.6 },
  landmarks: [['the temple', 0, 0], ['the monoliths', -30, -20], ['the crystal field', 28, 24], ['the stair', 30, -30], ['the broken head', -26, 26]],
  build(P, r) {
    P.box({ x: 0, y: -0.5, z: 0, w: 100, h: 0.5, d: 100, mat: 'rock', color: 0x1a1620, collide: false, cast: false });
    // golden cracks running through the stone
    for (let i = 0; i < 26; i++) {
      let x = (r() - 0.5) * 90, z = (r() - 0.5) * 90, a = r() * TAU;
      for (let k = 0; k < 6; k++) { const L = 1.5 + r() * 3; a += (r() - 0.5) * 1.2; P.box({ x: x + Math.cos(a) * L / 2, y: 0.005, z: z + Math.sin(a) * L / 2, w: L, h: 0.01, d: 0.07 + r() * 0.06, ry: -a, mat: 'neon', color: r() < 0.7 ? 0xffc21f : 0xb070ff, collide: false, cast: false }); x += Math.cos(a) * L; z += Math.sin(a) * L; }
    }
    // stone slabs, tilted and cracked, raised a little off the ground
    for (let i = 0; i < 30; i++) { const x = (r() - 0.5) * 86, z = (r() - 0.5) * 86; if (Math.hypot(x, z) < 12) continue; P.box({ x, y: 0, z, w: 2 + r() * 4, h: 0.15 + r() * 0.2, d: 2 + r() * 4, ry: r() * 3, mat: 'marble', color: 0x2a2432, collide: false }); }
    // THE TEMPLE: a ring of pillars on a dais round an altar of light
    P.cyl({ x: 0, y: 0, z: 0, r: 11, h: 0.3, mat: 'marble', color: 0x2e2838, seg: 32, collide: false });
    P.cyl({ x: 0, y: 0.3, z: 0, r: 10.6, h: 0.02, mat: 'marble', color: 0x3a3246, seg: 32, collide: false, cast: false });
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; pillar(P, Math.cos(a) * 9, Math.sin(a) * 9, r, { h: i % 3 === 0 ? 2 + r() * 2 : 7, r: 0.65, broken: i % 3 === 0, glow: 0xffd21f, color: 0x2a2432 }); }
    P.cyl({ x: 0, y: 0, z: 0, r: 1.4, h: 1.1, mat: 'marble', color: 0x3a3244, seg: 12 });
    P.cyl({ x: 0, y: 1.1, z: 0, r: 0.9, h: 0.1, mat: 'neon', color: 0xffd21f, seg: 12, collide: false, cast: false });
    P.light({ x: 0, y: 2.2, z: 0, color: 0xffd21f, intensity: 10, distance: 18, flicker: 0.15, glowSize: 3.4 });
    // ruins hanging in the void above it
    for (let i = 0; i < 9; i++) { const a = r() * TAU, d = 6 + r() * 30; P.box({ x: Math.cos(a) * d, y: 9 + r() * 12, z: Math.sin(a) * d, w: 2 + r() * 4, h: 1 + r() * 2, d: 2 + r() * 4, rx: r() * 0.6, ry: r() * 3, rz: r() * 0.6, mat: 'rock', color: 0x2a2234, collide: false }); }
    // THE MONOLITHS (north-west), ringed and humming
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + 0.3; monolith(P, -30 + Math.cos(a) * 7, -20 + Math.sin(a) * 7, -a + Math.PI / 2, { h: 5 + r() * 3, glow: 0xffd21f }); }
    P.light({ x: -30, y: 3, z: -20, color: 0xffd21f, intensity: 7, distance: 16, flicker: 0.3 });
    // THE CRYSTAL FIELD (south-east)
    for (let i = 0; i < 9; i++) { const x = 28 + (r() - 0.5) * 18, z = 24 + (r() - 0.5) * 16, c = r() < 0.5 ? 0xb48cff : 0x7fe3ff; if (Math.hypot(x - 27, z - 18) > 3.2) crystal(P, x, z, r, c); }
    // THE STAIR to nowhere (north-east)
    { const F = frame(30, -30, 0.6); for (let i = 0; i < 9; i++) { const [x, z] = F(0, i * 0.9); P.box({ x, y: 0, z, w: 4, h: 0.4 + i * 0.4, d: 0.9, ry: F.ry, mat: 'marble', color: 0x342c40 }); }
      const [tx, tz] = F(0, 9.5); P.box({ x: tx, y: 3.6, z: tz, w: 4.4, h: 0.3, d: 2.2, ry: F.ry, mat: 'marble', color: 0x3a3246, collide: false }); }
    // THE BROKEN HEAD (south-west): the giant head of a Guest, half sunk in the stone
    {
      P.cyl({ x: -26, y: -1.2, z: 26, r: 4.4, h: 7, rz: 0.35, rx: 0.15, mat: 'smooth', color: 0xd8d4c8, seg: 24, collide: false });
      P.wall({ x: -26, z: 26, r: 4.2, y: 0, h: 5 });
      P.box({ x: -22.2, y: 3.2, z: 27.8, w: 0.8, h: 1.4, d: 0.2, ry: -0.6, mat: 'smooth', color: 0x111111, collide: false, cast: false });
      P.box({ x: -23.4, y: 3.5, z: 30, w: 0.8, h: 1.4, d: 0.2, ry: -0.6, mat: 'smooth', color: 0x111111, collide: false, cast: false });
    }
    // broken pillars and rocks to loop round, all over
    for (const [x, z] of [[-14, -34], [10, -38], [-38, 2], [40, -4], [16, 14], [-12, 18], [6, 30], [-36, -36], [38, 38], [-4, -22], [22, -10], [-20, 6]]) pillar(P, x, z, r, { h: 2 + r() * 5, broken: r() < 0.6, color: 0x2a2432, glow: r() < 0.4 ? 0xb070ff : null });
    for (const [x, z] of [[-8, 38], [36, 10], [-40, -14], [14, -24], [26, 40], [-44, 18]]) rock(P, x, z, r, 1.2 + r() * 0.8, 0x2a2430);
    // gates of light at the edge
    for (const [x, z, ry] of [[0, 44, 0], [44, 0, Math.PI / 2], [0, -44, 0], [-44, 0, Math.PI / 2]]) {
      const F = frame(x, z, ry);
      for (const s of [-1, 1]) { const [px, pz] = F(s * 2.5, 0); P.box({ x: px, y: 0, z: pz, w: 0.8, h: 6, d: 0.8, ry, mat: 'marble', color: 0x2a2432 }); }
      const [cx, cz] = F(0, 0); P.box({ x: cx, y: 6, z: cz, w: 6, h: 0.8, d: 0.8, ry, mat: 'marble', color: 0x2a2432, collide: false });
      P.box({ x: cx, y: 0.3, z: cz, w: 4.2, h: 5.4, d: 0.04, ry, mat: 'neon', color: 0x6a3aa0, collide: false, cast: false });
      P.light({ x: cx, y: 3, z: cz, color: 0x9a60ff, intensity: 6, distance: 12, glowSize: 3 });
    }
    return {
      spawns: {
        survivor: [[-3, 34], [3, 34], [-6, 32], [6, 32], [0, 30], [-3, 37], [3, 37], [0, 39]],
        killer: [[0, -36], [-36, -30], [36, -36]]
      },
      gens: [[0, -5, 0], [-30, -20, 0.3], [27, 18, -0.2], [26, -24, 0.6], [-20, 18, 0.8]],
      items: [[5, 4], [-30, -24], [24, 28], [28, -34], [-24, 20], [-12, -14], [14, 36], [40, 20]],
      hides: [[-26, -22], [30, 26], [36, -32], [-30, 22], [8, -38], [-38, 4]]
    };
  }
};
