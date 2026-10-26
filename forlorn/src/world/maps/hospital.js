/*
 * BLOXVILLE GENERAL — the hospital, after visiting hours (Guest 666).
 * Rain outside, flickering tubes inside. Reception to the south, wards to the west, surgery
 * and the pharmacy to the east, the staff room north; the ambulance bay, the car park, a garden.
 */
import { lamp, tree, car, bench, frame, crate } from '../prefabs.js';
import { building, partition, bed, table, desk, shelf, lockers } from '../prefabs2.js';

export default {
  id: 'hospital', name: 'Bloxville General', film: 'Guest 666',
  blurb: 'The hospital after visiting hours. The power is not to be trusted.',
  size: [96, 96],
  surface: 'wood',
  ambience: {
    sky: { top: 0x0a0e14, horizon: 0x26323c, bottom: 0x0a0c10, sunDir: [-0.3, 0.6, 0.7], sunColor: 0xc0d0e0, sunSize: 0.008, stars: 0, clouds: 0.95, cloud: 0x1a2028 },
    fog: { color: 0x121a20, density: 0.03 },
    hemi: { sky: 0x5a6a78, ground: 0x22262a, intensity: 1.1 },
    sun: { dir: [-0.3, 0.7, 0.6], color: 0xa8c0d8, intensity: 1.1 },
    envIntensity: 0.55,
    grade: { tint: [0.96, 1.02, 1.0], sat: 0.85, contrast: 1.1 },
    particles: 'rain'
  },
  music: 'hospital',
  event: { at: 0.45, kind: 'blackout', title: 'BLACKOUT', text: 'The power has gone: the lights are out for 25 seconds', sound: 'thunder', dur: 25 },
  landmarks: [['reception', 0, -2], ['the wards', -18, -26], ['surgery', 18, -30], ['the pharmacy', 18, -12], ['the staff room', 0, -34], ['the ambulance bay', 26, 18], ['the car park', -26, 22]],
  build(P, r) {
    P.box({ x: 0, y: -0.5, z: 0, w: 100, h: 0.5, d: 100, mat: 'concrete', color: 0x3a3e42, collide: false, cast: false });
    P.box({ x: -2, y: 0, z: 30, w: 30, h: 0.02, d: 26, mat: 'grass', color: 0x2e4228, collide: false, cast: false });
    // THE HOSPITAL: one big block, corridors in a cross
    const F = building(P, 0, -20, 0, { w: 64, d: 40, h: 3.6, color: 0xd8e0dc, trim: 0x5a8a7a, doors: { front: [32, 8, 56], left: [20], right: [20], back: [32] }, windows: { front: [16, 24, 40, 48], back: [6, 14, 22, 42, 50, 58], left: [8, 30], right: [8, 30] }, floor: { mat: 'tile', color: 0xc8ccc4 },
      lights: [[-26, -2], [-14, -2], [0, -2], [14, -2], [26, -2], [0, -12], [0, 8], [-24, -12], [-12, -12], [-24, 10], [-12, 10], [14, -12], [24, -12], [14, 10], [24, 10], [0, 16]], lightColor: 0xe8f4f0, lightI: 4, flicker: 0.18 });
    // the cross of corridors: x from -32 to 32 at z -4..0, and z from -20 to 20 at x -2..2
    partition(P, F, -32, -4, -2, -4, { doors: [6, 18, 26] }); partition(P, F, 2, -4, 32, -4, { doors: [4, 12, 24] });
    partition(P, F, -32, 0, -2, 0, { doors: [6, 18, 26] }); partition(P, F, 2, 0, 32, 0, { doors: [4, 12, 24] });
    partition(P, F, -2, -20, -2, -4, { doors: [8] }); partition(P, F, 2, -20, 2, -4, { doors: [8] });
    partition(P, F, -2, 0, -2, 20, { doors: [6] }); partition(P, F, 2, 0, 2, 20, { doors: [6] });
    // THE WARDS (north-west): rows of beds behind curtains
    partition(P, F, -17, -20, -17, -4, { doors: [10] });
    for (let i = 0; i < 4; i++) for (const lx of [-29, -21, -13.5, -6]) { const [x, z] = F(lx, -17.5 + i * 3.6); bed(P, x, z, -Math.PI / 2, { sheet: 0xc8dce8 }); }
    for (let i = 0; i < 3; i++) { const [x, z] = F(-25, -15.7 + i * 3.6); P.box({ x, y: 0.3, z, w: 3, h: 1.9, d: 0.04, mat: 'fabric', color: 0x8ab8b0, collide: false }); }
    // RECEPTION (south-west of the cross) and the waiting chairs
    { const [x, z] = F(-8, 6); P.box({ x, y: 0, z, w: 6, h: 1.1, d: 1.2, mat: 'wood', color: 0xd8d0c0, sight: false }); }
    for (let i = 0; i < 5; i++) { const [x, z] = F(-26 + i * 3, 16); P.box({ x, y: 0, z, w: 2.4, h: 0.5, d: 0.6, mat: 'plastic', color: 0x3a7a8a, sight: false }); }
    partition(P, F, -17, 0, -17, 20, { doors: [12] });
    for (let i = 0; i < 3; i++) for (const lx of [-29, -21]) { const [x, z] = F(lx, 3.5 + i * 5); bed(P, x, z, Math.PI / 2, { sheet: 0xe8d8c8 }); }
    // SURGERY (north-east): the table, the lamps, the machines
    partition(P, F, 17, -20, 17, -4, { doors: [12] });
    { const [x, z] = F(24, -12); P.box({ x, y: 0, z, w: 1, h: 0.95, d: 2.2, mat: 'metal', color: 0x9aa4a8, sight: false }); P.cyl({ x, y: 2.8, z, r: 0.6, h: 0.2, mat: 'neon', color: 0xf8fbff, collide: false, cast: false }); }
    for (const [lx, lz] of [[21, -16], [28, -16], [28, -8]]) { const [x, z] = F(lx, lz); P.box({ x, y: 0, z, w: 0.8, h: 1.6, d: 0.6, mat: 'metal', color: 0x6a7478, sight: false }); P.box({ x, y: 1.2, z: z + 0.31, w: 0.5, h: 0.3, d: 0.02, mat: 'neon', color: 0x40ff90, collide: false, cast: false }); }
    // THE PHARMACY (north-east, by the corridor)
    for (const [lx, lz] of [[6, -17], [10, -17], [14, -17], [6, -10], [10, -10]]) { const [x, z] = F(lx, lz); shelf(P, x, z, 0, { w: 2.6, color: 0xd8dcd8 }); }
    // THE STAFF ROOM and lockers (south-east)
    for (const [lx, lz] of [[10, 8], [22, 8]]) { const [x, z] = F(lx, lz); table(P, x, z, 0, { w: 3, d: 1.2, color: 0xa08a6a, benches: true }); }
    lockers(P, F, 4, 19.4, 12, { colors: [0x6a8a9a, 0x5a7a8a] });
    partition(P, F, 17, 0, 17, 20, { doors: [5, 15] });
    for (const [lx, lz] of [[24, 4], [28, 12], [24, 16]]) { const [x, z] = F(lx, lz); desk(P, x, z, Math.PI, { chair: 0x2a2a2a, color: 0xb0b0a8 }); }
    // OUTSIDE: the ambulance bay
    P.box({ x: 26, y: 0, z: 18, w: 20, h: 0.02, d: 14, mat: 'concrete', color: 0x2a2c30, collide: false, cast: false });
    P.box({ x: 26, y: 3.4, z: 13, w: 20, h: 0.25, d: 6, mat: 'concrete', color: 0xc8ccc8, collide: false });
    for (const px of [17, 35]) P.box({ x: px, y: 0, z: 15.5, w: 0.4, h: 3.4, d: 0.4, mat: 'concrete', color: 0xa8aca8 });
    { P.box({ x: 26, y: 2.8, z: 0.2, w: 7, h: 0.7, d: 0.06, mat: 'neon', color: 0xff4040, collide: false, cast: false }); }
    for (const [x, z, a] of [[22, 18, Math.PI / 2], [30, 19, Math.PI / 2 + 0.15]]) { car(P, x, z, a, 0xf2f2ee); const F2 = frame(x, z, a); const [sx, sz] = F2(0, 0); P.box({ x: sx, y: 1.7, z: sz, w: 0.3, h: 0.12, d: 0.9, ry: a, mat: 'neon', color: 0xff3030, collide: false, cast: false }); }
    // the car park
    P.box({ x: -28, y: 0, z: 22, w: 30, h: 0.02, d: 22, mat: 'concrete', color: 0x26282c, collide: false, cast: false });
    const cc = [0x5a5a5e, 0x7a1f1f, 0x1f2f5a, 0x2a2a2a, 0xa8a8a0];
    [[-38, 15, 0.05], [-32, 15, -0.05], [-20, 15, 0], [-35, 29, Math.PI], [-23, 29, Math.PI + 0.1]].forEach(([x, z, a], i) => car(P, x, z, a + Math.PI / 2, cc[i]));
    // the garden: paths, benches, trees, a fountain
    P.cyl({ x: -2, y: 0, z: 31, r: 2.4, h: 0.6, mat: 'concrete', color: 0x9a9a94, seg: 20 });
    P.cyl({ x: -2, y: 0.55, z: 31, r: 2.1, h: 0.03, mat: 'glass', color: 0x4a6a7a, seg: 20, collide: false, cast: false });
    for (const [bx, bz, a] of [[-8, 28, 0.8], [4, 28, -0.8], [-8, 36, 2.3], [4, 36, -2.3]]) bench(P, bx, bz, a);
    for (const [tx, tz] of [[-14, 24], [10, 24], [-14, 38], [10, 38], [-16, 31], [12, 31]]) tree(P, tx, tz, r, { kind: 'oak', color: 0x2c4826 });
    for (const [x, z] of [[-14, 6], [14, 6], [-44, 34], [44, 34], [-2, 42], [26, 30]]) lamp(P, x, z, { h: 5, intensity: 6, distance: 14, color: 0xd8e8ff, flicker: x === 44 ? 0.9 : 0.05 });
    for (const [x, z] of [[40, 4], [41, 5.2], [-42, 4]]) crate(P, x, z, 0.3, 1, 0x7a8a9a);
    // dumpsters behind
    for (const x of [-20, 18]) { P.box({ x, y: 0, z: -44, w: 3, h: 1.6, d: 1.8, mat: 'metal', color: 0x2a5a3a }); P.box({ x, y: 1.6, z: -44, w: 3.1, h: 0.1, d: 1.9, mat: 'plastic', color: 0x1a1a1a, collide: false }); }
    return {
      spawns: {
        survivor: [[-4, 26], [0, 26], [-6, 24], [2, 24], [-2, 22], [-6, 40], [2, 40], [-2, 38]],
        killer: [[0, -34], [-30, -36], [30, -37]]
      },
      gens: [[-24, -32, Math.PI / 2], [24, -27.5, 0], [14.5, -30, 0], [-24.5, -14, Math.PI / 2], [26, 24, 0]],
      items: [[-20, -32], [12, -36], [8, -27], [-8, -16], [22, -6], [-30, 16], [-2, 44], [36, 24]],
      hides: [[-28, -36], [28, -26], [8, -36], [-26, -9], [26, -6], [-23, -44]]
    };
  }
};
