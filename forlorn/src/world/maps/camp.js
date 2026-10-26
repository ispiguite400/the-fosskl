/*
 * THE CAMP — the lobby. A clearing in the woods where everyone waits between rounds:
 * a big fire, log benches, tents, string lights, and the board with tonight's map.
 */
import { tent, campfire, tree, rock, crate, barrel, lamp, bench, frame } from '../prefabs.js';

export default {
  id: 'camp', name: 'The Camp', film: 'Lobby',
  size: [56, 56],
  ambience: {
    sky: { top: 0x070b1c, horizon: 0x2a2f55, bottom: 0x0b0d14, sunDir: [-0.4, 0.5, 0.6], sunColor: 0xc8d4ff, sunSize: 0.012, stars: 1, clouds: 0.25, cloud: 0x1a1d33 },
    fog: { color: 0x10142a, density: 0.03 },
    hemi: { sky: 0x5a6aaa, ground: 0x24221a, intensity: 1.0 },
    sun: { dir: [-0.4, 0.6, 0.6], color: 0xaabbff, intensity: 1.1 },
    envIntensity: 0.45,
    particles: 'fireflies'
  },
  build(P, r) {
    P.box({ x: 0, y: -0.5, z: 0, w: 60, h: 0.5, d: 60, mat: 'grass', color: 0x2f3f26, collide: false, cast: false });
    P.cyl({ x: 0, y: 0, z: 0, r: 8, h: 0.03, mat: 'dirt', color: 0x5a4632, seg: 28, collide: false, cast: false });
    campfire(P, 0, 0, { intensity: 5.5 });
    // log benches round the fire
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.3, x = Math.cos(a) * 4.2, z = Math.sin(a) * 4.2;
      P.cyl({ x, y: 0.28, z, r: 0.28, h: 2.2, axis: 'x', ry: -a + Math.PI / 2, mat: 'wood', color: 0x5a4030, seg: 9, collide: false });
      P.wall({ x, z, w: 2.2, d: 0.55, h: 0.55, ry: -a + Math.PI / 2, sight: false });
    }
    // tents
    tent(P, -11, -6, 0.5, { color: 0x4a5a36 }); tent(P, -12, 5, 1.4, { color: 0x6a3a2a }); tent(P, 11, -7, -0.6, { color: 0x2f4a6a }); tent(P, 12, 6, -1.6, { color: 0x5d6b3e });
    // string lights between poles
    const poles = [[-7, -9], [7, -9], [9, 8], [-9, 8]];
    for (const [x, z] of poles) P.cyl({ x, y: 0, z, r: 0.08, h: 3.2, mat: 'wood', color: 0x3a2a1c, seg: 6 });
    for (let k = 0; k < poles.length; k++) {
      const [ax, az] = poles[k], [bx, bz] = poles[(k + 1) % poles.length];
      for (let i = 1; i < 8; i++) {
        const t = i / 8, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = 3.0 - Math.sin(t * Math.PI) * 0.5;
        const c = [0xffd28a, 0xff8a8a, 0x8affc1, 0x8ac8ff][(i + k) % 4];
        P.ball({ x, y, z, r: 0.07, mat: 'neon', color: c, cast: false, seg: 6 });
        if (i % 3 === 0) P.light({ x, y, z, color: c, intensity: 2.2, distance: 7, glowSize: 0.7 });
      }
    }
    // the board: tonight's map
    { const F = frame(0, -12, 0); const [x, z] = F(0, 0);
      P.box({ x, y: 0, z, w: 0.2, h: 2.6, d: 0.2, mat: 'wood', color: 0x3a2a1c }); P.box({ x: x - 1.6, y: 0, z, w: 0.2, h: 2.6, d: 0.2, mat: 'wood', color: 0x3a2a1c }); P.box({ x: x + 1.6, y: 0, z, w: 0.2, h: 2.6, d: 0.2, mat: 'wood', color: 0x3a2a1c });
      P.box({ x, y: 1.1, z: z + 0.05, w: 3.6, h: 1.6, d: 0.1, mat: 'planks', color: 0x6b4a2c, collide: false });
      P.box({ x, y: 1.25, z: z + 0.12, w: 3.2, h: 1.3, d: 0.02, mat: 'fabric', color: 0xd8cfb0, collide: false, cast: false }); }
    // crates of supplies, a lantern or two
    crate(P, -5, -10, 0.2); crate(P, -5.9, -10.4, 0.9, 0.8); barrel(P, 5, -10.2); barrel(P, 5.8, -9.6, 0x4a5a6a);
    lamp(P, -14, 0, { h: 2.8, intensity: 5, color: 0xffc98a }); lamp(P, 14, 0, { h: 2.8, intensity: 5, color: 0xffc98a });
    bench(P, 0, 12, Math.PI);
    // the woods
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = 18 + r() * 9, x = Math.cos(a) * d, z = Math.sin(a) * d;
      tree(P, x, z, r, { kind: r() < 0.75 ? 'pine' : 'oak', color: 0x22361f });
    }
    for (let i = 0; i < 8; i++) { const a = r() * Math.PI * 2, d = 14 + r() * 4; rock(P, Math.cos(a) * d, Math.sin(a) * d, r, 0.6 + r() * 0.5); }
    return {
      spawns: { survivor: [[-2, 6], [2, 6], [-5, 3], [5, 3], [0, 8], [-3, 9], [3, 9], [0, 5], [-6, 7], [6, 7]], killer: [[0, -6]] },
      spots: { fire: [[-2.8, 2.6], [2.8, 2.6], [3.6, -1.2], [-3.6, -1.2], [0, -3.8], [0, 3.8], [-1.5, -3], [1.5, -3]] }
    };
  }
};
