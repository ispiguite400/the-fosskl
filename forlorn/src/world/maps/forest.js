/*
 * CAMP BLOXWOOD — the party in the woods, the night the legend came for them (Guest 666).
 * A lake with a dock, three cabins, the bonfire and the speakers still playing, tents, the cars
 * on the dirt road, and pines in every direction.
 */
import { tree, rock, crate, barrel, tent, campfire, car, bench, lamp, frame } from '../prefabs.js';
import { building, partition, bunk, table, shelf } from '../prefabs2.js';

export default {
  id: 'forest', name: 'Camp Bloxwood', film: 'Guest 666',
  blurb: 'The party in the woods. The music is still playing. Nobody is dancing.',
  size: [96, 96],
  surface: 'dirt',
  ambience: {
    sky: { top: 0x040812, horizon: 0x1a2a3a, bottom: 0x05070a, sunDir: [0.5, 0.55, 0.6], sunColor: 0xe8f0ff, sunSize: 0.014, stars: 1, clouds: 0.3, cloud: 0x10161e },
    fog: { color: 0x0a1218, density: 0.028 },
    hemi: { sky: 0x4a6a7a, ground: 0x1c2418, intensity: 1.1 },
    sun: { dir: [0.5, 0.6, 0.6], color: 0xb8ccff, intensity: 1.25 },
    envIntensity: 0.45,
    grade: { tint: [0.97, 1.02, 1.03], sat: 0.95, contrast: 1.08 },
    particles: 'fireflies'
  },
  music: 'forest',
  card: { at: [8, 4, 14], look: [0, 1, 4] },
  event: { at: 0.45, kind: 'fog', title: 'THE FOG ROLLS IN', text: 'Fog off the lake: nobody sees far for 30 seconds', sound: 'whoosh', dur: 30 },
  landmarks: [['the bonfire', 0, 4], ['the lake', 24, -22], ['the dock', 14, -14], ['the cabins', -24, -18], ['the road', -34, 20], ['the boathouse', 36, -6]],
  build(P, r) {
    P.box({ x: 0, y: -0.5, z: 0, w: 100, h: 0.5, d: 100, mat: 'grass', color: 0x253a22, collide: false, cast: false });
    // the dirt road along the west and south, the clearing
    P.box({ x: -34, y: 0, z: 0, w: 6, h: 0.02, d: 96, mat: 'dirt', color: 0x4a3a2a, collide: false, cast: false });
    P.box({ x: 0, y: 0, z: 36, w: 74, h: 0.02, d: 6, mat: 'dirt', color: 0x4a3a2a, collide: false, cast: false });
    P.cyl({ x: 0, y: 0, z: 4, r: 14, h: 0.02, mat: 'dirt', color: 0x4e3e2c, seg: 30, collide: false, cast: false });
    // THE LAKE: water you cannot cross, rocks on the shore
    P.cyl({ x: 24, y: 0.02, z: -22, r: 13, h: 0.02, mat: 'glass', color: 0x1a3a4a, seg: 40, collide: false, cast: false });
    P.cyl({ x: 24, y: -0.3, z: -22, r: 12.6, h: 0.3, mat: 'smooth', color: 0x081418, seg: 40, collide: false, cast: false });
    P.wall({ x: 24, z: -22, r: 12.4, y: 0, h: 1.4, sight: false });
    // (a gap in the rocks where the dock meets the shore)
    for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2 + r() * 0.2; if (a > 2.25 && a < 2.7) continue; rock(P, 24 + Math.cos(a) * 13.4, -22 + Math.sin(a) * 13.4, r, 0.45 + r() * 0.4, 0x4a4a46); }
    // the dock out onto the water
    { const F = frame(14, -14, -0.75); for (let i = 0; i < 7; i++) { const [x, z] = F(0, -i * 1.2); P.box({ x, y: 0.3, z, w: 2.2, h: 0.12, d: 1.1, ry: F.ry, mat: 'planks', color: 0x6a5038, collide: false }); }
      for (const [lx, lz] of [[-1, 0], [1, 0], [-1, -7.2], [1, -7.2]]) { const [x, z] = F(lx, lz); P.cyl({ x, y: -0.3, z, r: 0.1, h: 1.6, mat: 'wood', color: 0x4a3626, seg: 6, collide: false }); }
      const [ex, ez] = F(0, -3.6); P.wall({ x: ex, z: ez, w: 2.2, d: 8.4, y: -0.5, h: 0.4, ry: F.ry }); }
    // the boathouse
    building(P, 38, -6, -0.3, { w: 8, d: 6, h: 3.2, mat: 'planks', color: 0x6a4a32, doors: { left: [3], front: [4] }, windows: { back: [4] }, floor: { mat: 'planks', color: 0x5a4030 }, roofMat: 'slate', roofColor: 0x3a2a22, lights: [[0, 0]], lightColor: 0xffc080, flicker: 0.25 });
    { const F = frame(38, -6, -0.3); const [x, z] = F(-1.5, -1.5); P.box({ x, y: 0.3, z, w: 3.6, h: 0.5, d: 1.2, ry: F.ry - 0.2, mat: 'smooth', color: 0xb83a2a, sight: false }); }
    // THE CABINS: bunks inside, a porch lamp each
    for (const [cx, cz, ry] of [[-24, -26, 0.15], [-14, -36, -0.1], [-30, -8, Math.PI / 2]]) {
      const F = building(P, cx, cz, ry, { w: 9, d: 7, h: 3.2, mat: 'planks', color: 0x7a5a3a, doors: { front: [4.5] }, windows: { left: [3.5], right: [3.5], back: [3, 6] }, floor: { mat: 'planks', color: 0x6a4a30 }, roofMat: 'slate', roofColor: 0x3a3028, lights: [[0, 0]], lightColor: 0xffc890, lightI: 4, flicker: 0.12 });
      for (const lx of [-3, 3]) { const [x, z] = F(lx, -1.5); bunk(P, x, z, F.ry); }
      { const [x, z] = F(0, -2.8); shelf(P, x, z, F.ry, { w: 1.6, color: 0x5a3a26 }); }
      { const [x, z] = F(-2.6, 4.2); lamp(P, x, z, { h: 2.6, intensity: 3.5, distance: 8, color: 0xffb870 }); }
    }
    // THE PARTY: the bonfire, logs, the DJ table and its speakers, string lights, coolers
    campfire(P, 0, 4, { intensity: 10 });
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, x = Math.cos(a) * 4.6, z = 4 + Math.sin(a) * 4.6; P.cyl({ x, y: 0.28, z, r: 0.28, h: 2, axis: 'x', ry: -a + Math.PI / 2, mat: 'wood', color: 0x5a4030, seg: 9, collide: false }); P.wall({ x, z, w: 2, d: 0.55, h: 0.55, ry: -a + Math.PI / 2, sight: false }); }
    { const F = frame(10, 12, -0.6), [x, z] = F(0, 0);
      table(P, x, z, F.ry, { w: 2.4, d: 1, color: 0x2a2a2e });
      for (const s of [-1, 1]) { const [sx, sz] = F(s * 2, -0.3); P.box({ x: sx, y: 0, z: sz, w: 0.9, h: 1.7, d: 0.8, ry: F.ry, mat: 'plastic', color: 0x151518 }); P.cyl({ x: sx, y: 1.0, z: sz, r: 0.28, h: 0.82, axis: 'z', ry: F.ry, mat: 'metal', color: 0x2a2a2a, collide: false }); const [gx, gz] = F(s * 2, 0.12); P.box({ x: gx, y: 0.3, z: gz, w: 0.7, h: 0.08, d: 0.02, ry: F.ry, mat: 'neon', color: 0x40c8ff, collide: false, cast: false }); P.light({ x: gx, y: 0.6, z: gz, color: [0xff40c0, 0x40c8ff][(s + 1) / 2], intensity: 5, distance: 9, flicker: 0.4, glowSize: 1.4 }); }
      const [lx, lz] = F(0, 0.1); P.box({ x: lx, y: 0.78, z: lz, w: 0.9, h: 0.1, d: 0.5, ry: F.ry, mat: 'neon', color: 0xc040ff, collide: false, cast: false }); }
    const poles = [[-10, -6], [12, -4], [14, 16], [-12, 16]];
    for (const [x, z] of poles) P.cyl({ x, y: 0, z, r: 0.08, h: 3.4, mat: 'wood', color: 0x3a2a1c, seg: 6 });
    for (let k = 0; k < 4; k++) { const [ax, az] = poles[k], [bx, bz] = poles[(k + 1) % 4]; for (let i = 1; i < 9; i++) { const t = i / 9, c = [0xff6ab0, 0x6ac8ff, 0xffd26a, 0x8aff8a][(i + k) % 4]; P.ball({ x: ax + (bx - ax) * t, y: 3.2 - Math.sin(t * Math.PI) * 0.6, z: az + (bz - az) * t, r: 0.07, mat: 'neon', color: c, cast: false, seg: 6 }); if (i % 4 === 0) P.light({ x: ax + (bx - ax) * t, y: 2.8, z: az + (bz - az) * t, color: c, intensity: 2.2, distance: 7, glowSize: 0.7 }); } }
    for (const [x, z, c] of [[-6, 12, 0x2a6ab0], [-7, 13, 0xd83a2a], [6, -4, 0x2a6ab0]]) { P.box({ x, y: 0, z, w: 0.8, h: 0.5, d: 0.5, mat: 'plastic', color: c, sight: false }); P.box({ x, y: 0.5, z, w: 0.84, h: 0.08, d: 0.54, mat: 'plastic', color: 0xeeeeee, collide: false }); }
    for (const [x, z, ry] of [[-14, 6, 0.3], [16, 4, -0.2]]) table(P, x, z, ry, { w: 2, d: 0.9, color: 0x7a5a3a, benches: true });
    // tents
    for (const [x, z, ry, c] of [[-10, 24, 0.4, 0x2f6a4a], [-2, 26, -0.1, 0xb04a2a], [8, 25, 0.2, 0x3a4a8a], [18, 22, -0.4, 0xc8a02a]]) tent(P, x, z, ry, { color: c });
    // the road: cars, a van, a lamp
    for (const [x, z, a, c] of [[-34, 14, Math.PI / 2, 0x3a3a3e], [-35, 26, Math.PI / 2 + 0.06, 0x8a2020], [-20, 36, 0.05, 0x2a4a7a]]) car(P, x, z, a, c);
    { const F = frame(-33.5, 2, Math.PI / 2), [x, z] = F(0, 0); P.box({ x, y: 0.4, z, w: 5.2, h: 2.2, d: 2.2, ry: F.ry, mat: 'smooth', color: 0xd8d8cc }); P.box({ x, y: 1.6, z, w: 1.2, h: 0.5, d: 2.24, ry: F.ry, mat: 'glass', color: 0x2a3a4a, collide: false, cast: false }); }
    for (const [x, z] of [[-30, 36], [-30, -30], [28, 36]]) lamp(P, x, z, { h: 3.6, intensity: 5, distance: 12, color: 0xffd8a0, flicker: x > 0 ? 0.6 : 0.05 });
    for (const [x, z] of [[-18, 30], [-17, 31.1], [30, 30]]) crate(P, x, z, r() * 0.5, 0.9);
    for (const [x, z] of [[4, -6], [-15, 2]]) barrel(P, x, z, 0x3a5a3a);
    bench(P, 6, -12, 0.6); bench(P, -8, -14, -0.4);
    // the woods: dense at the edge, scattered inside
    for (let i = 0; i < 80; i++) { const a = r() * Math.PI * 2, d = 40 + r() * 8, x = Math.cos(a) * d, z = Math.sin(a) * d; if (Math.abs(x) < 47 && Math.abs(z) < 47) tree(P, x, z, r, { kind: r() < 0.85 ? 'pine' : 'oak', color: 0x1e3220 }); }
    for (const [tx, tz] of [[-20, 4], [20, 30], [-4, -20], [6, -26], [-24, 10], [30, 10], [-14, -6], [24, 16], [-40, -20], [40, 20], [-6, 34], [34, -38], [-40, 34], [8, 40], [44, -20]]) tree(P, tx, tz, r, { kind: 'pine', color: 0x22382a });
    for (const [x, z] of [[-18, 18], [26, 4], [-2, -30], [12, 34]]) rock(P, x, z, r, 0.9 + r() * 0.5, 0x4e4c48);
    return {
      spawns: {
        survivor: [[-3, 12], [3, 12], [-6, 10], [6, 10], [0, 14], [-4, 16], [4, 16], [0, -2]],
        killer: [[30, 32], [-26, 36], [38, -36]]
      },
      gens: [[-24, -24.5, 0.15], [39.1, -4.6, -0.3], [-6, 24, 0], [-20, 22, 0.4], [6, -18, 0.5]],
      items: [[-25.4, -24], [-14.1, -35], [-29, -8], [39.9, -7], [8, 15], [-14, 8], [18, 26], [-28, 32]],
      hides: [[-22.5, -24.5], [-12.6, -35], [-29, -9.5], [36.6, -5.5], [-2, 30], [-30, 2]]
    };
  }
};
