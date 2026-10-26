/*
 * ROBLOXIAN HIGH — the school where the legend of Guest 666 came true (Guest 666).
 * After dark: the main block's hallway of lockers and its classrooms, the cafeteria and library,
 * the gym next door, the parking lot, and the football field under its lights.
 */
import { lamp, tree, car, bench, frame, crate } from '../prefabs.js';
import { building, partition, table, desk, lockers, bleachers, shelf, chainFence } from '../prefabs2.js';

export default {
  id: 'school', name: 'Robloxian High', film: 'Guest 666',
  blurb: 'Lights out at Robloxian High. Something is still in the halls.',
  size: [100, 96],
  surface: 'wood',
  ambience: {
    sky: { top: 0x0d0820, horizon: 0x40285a, bottom: 0x0b0814, sunDir: [-0.5, 0.5, -0.6], sunColor: 0xe0d0ff, sunSize: 0.012, stars: 0.9, clouds: 0.35, cloud: 0x22183a },
    fog: { color: 0x150f22, density: 0.024 },
    hemi: { sky: 0x6a5a9a, ground: 0x26202c, intensity: 1.1 },
    sun: { dir: [-0.5, 0.6, -0.6], color: 0xc8b8ff, intensity: 1.25 },
    envIntensity: 0.5,
    grade: { tint: [1.0, 0.97, 1.06], sat: 1.0, contrast: 1.08 },
    particles: 'motes'
  },
  music: 'school',
  card: { at: [-20, 8, 6], look: [2, 2, -24] },
  event: { at: 0.45, kind: 'alarm', title: 'FIRE DRILL', text: 'The alarm is ringing: everyone is shown to everyone', sound: 'siren' },
  landmarks: [['the hallway', 0, -26], ['the cafeteria', -14, -17], ['the library', 14, -17], ['the gym', 36, -29], ['the parking lot', -30, 16], ['the field', 24, 22]],
  build(P, r) {
    P.box({ x: 0, y: -0.5, z: 0, w: 104, h: 0.5, d: 100, mat: 'grass', color: 0x34452c, collide: false, cast: false });
    // THE MAIN BLOCK: a hallway east-west, classrooms north, cafeteria and library south
    {
      const F = building(P, 0, -26, 0, { w: 52, d: 28, h: 3.8, color: 0xc8b49a, trim: 0x6a4a3a, doors: { front: [26, 6, 46], left: [14], right: [14] }, windows: { back: [5, 11, 18, 24, 31, 37, 44], front: [16, 36] }, floor: { mat: 'tile', color: 0xb0aca0 }, lights: [[-20, 0], [-8, 0], [4, 0], [16, 0], [-19, -9], [-6, -9], [7, -9], [19, -9], [-14, 9], [14, 9]], lightColor: 0xeef4ff, lightI: 4.5, flicker: 0.08 });
      // classrooms along the north wall: walls with a door onto the hallway
      for (let i = 0; i <= 4; i++) partition(P, F, -26 + i * 13, -14, -26 + i * 13, -4, {});
      for (let i = 0; i < 4; i++) {
        partition(P, F, -26 + i * 13, -4, -13 + i * 13, -4, { doors: [3.5, 10] });
        for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) { const [x, z] = F(-22.5 + i * 13 + col * 3, -11.5 + row * 2.4); desk(P, x, z, Math.PI, { chair: [0x3a5a8a, 0x8a3a3a, 0x3a7a4a, 0xb08a2a][i] }); }
        { const [x, z] = F(-19.5 + i * 13, -13.6); P.box({ x, y: 1.0, z, w: 6, h: 1.4, d: 0.06, mat: 'smooth', color: 0x1e3a2a, collide: false }); }   // the chalkboard
      }
      // the hallway: lockers both sides
      lockers(P, F, -24, -3.5, 10, { colors: [0x3a5a9a, 0x34508a] }); lockers(P, F, 4, -3.5, 12, { colors: [0x9a3a3a, 0x8a3434] });
      lockers(P, F, -22, 3.6, 8, { colors: [0x3a5a9a, 0x34508a] }); lockers(P, F, 8, 3.6, 8, { colors: [0x9a3a3a, 0x8a3434] });
      // the cafeteria (west) and the library (east) along the south side
      partition(P, F, -26, 4, -2, 4, { doors: [8, 18] });
      partition(P, F, 2, 4, 26, 4, { doors: [6, 18] });
      partition(P, F, -2, 4, -2, 14, {}); partition(P, F, 2, 4, 2, 14, {});
      for (const [lx, lz] of [[-20, 7.5], [-12, 7.5], [-20, 11.5], [-12, 11.5], [-6, 9.5]]) { const [x, z] = F(lx, lz); table(P, x, z, 0, { w: 4, d: 1, color: 0xd8d0c0, mat: 'plastic', benches: true }); }
      for (const [lx, lz] of [[6, 6], [6, 10], [22, 6], [22, 10], [14, 12.6]]) { const [x, z] = F(lx, lz); shelf(P, x, z, lz > 12 ? 0 : Math.PI / 2, { w: 3, color: 0x6a4a32 }); }
      { const [x, z] = F(14, 8); table(P, x, z, 0, { w: 3, d: 1.4, color: 0x7a5a3a }); }
    }
    // THE GYM
    {
      const F = building(P, 36, -29, 0, { w: 16, d: 22, h: 6, color: 0x9a8a7a, trim: 0x4a3a5a, doors: { left: [8, 16], front: [8] }, windows: { right: [6, 16] }, floor: { mat: 'planks', color: 0xb08a5a }, lights: [[-3, -6], [3, -6], [-3, 6], [3, 6]], lightColor: 0xfff6e0, lightI: 6 });
      bleachers(P, ...F(5.6, 0), -Math.PI / 2, { w: 14, rows: 4 });
      for (const lz of [-10, 10]) { const [x, z] = F(0, lz); P.box({ x, y: 2.8, z, w: 1.8, h: 1.1, d: 0.06, mat: 'plastic', color: 0xeeeeee, collide: false }); P.cyl({ x, y: 2.9, z: z - Math.sign(lz) * 0.3, r: 0.25, h: 0.04, mat: 'metal', color: 0xd85a20, open: true, collide: false }); }
      { const [x, z] = F(-4, 0); P.box({ x, y: 0.05, z, w: 0.08, h: 0.01, d: 20, mat: 'neon', color: 0xd8d0c0, collide: false, cast: false }); }
      for (const [lx, lz] of [[-6, -8], [-6.5, -7]]) { const [x, z] = F(lx, lz); crate(P, x, z, 0.3, 0.7, 0x2a5a8a); }
    }
    // lamps on the walls outside, over every door and along the front
    for (const [x, z] of [[-20, -11.6], [-6, -11.6], [6, -11.6], [20, -11.6], [0, -11.6], [-26.4, -26], [26.4, -26], [28, -24], [36, -17.6]]) {
      P.box({ x, y: 3.0, z, w: 0.5, h: 0.22, d: 0.3, mat: 'neon', color: 0xffe6b0, collide: false, cast: false });
      P.light({ x, y: 2.7, z: z + (z > -12 ? 0.6 : 0), color: 0xffe0a8, intensity: 3.5, distance: 9, glowSize: 1.1 });
    }
    // the front: a flagpole, benches, trees, the sign
    P.cyl({ x: 0, y: 0, z: -6, r: 0.08, h: 9, mat: 'metal', color: 0xb8b8b8 });
    P.box({ x: 0.8, y: 7.4, z: -6, w: 1.4, h: 0.9, d: 0.03, mat: 'fabric', color: 0x2c5ab0, collide: false });
    for (const [bx, bz, a] of [[-8, -6, 0], [8, -6, 0], [-14, 0, 0.3], [14, 0, -0.3]]) bench(P, bx, bz, a);
    { P.box({ x: -16, y: 0, z: -7, w: 6, h: 1.6, d: 0.5, mat: 'brick', color: 0x6a3a32 }); P.box({ x: -16, y: 0.5, z: -6.7, w: 5, h: 0.7, d: 0.06, mat: 'neon', color: 0xf2e8d0, collide: false, cast: false }); }
    for (const [tx, tz] of [[-22, -4], [22, -4], [-6, 4], [6, 4], [-30, -8], [30, -8], [44, -8]]) tree(P, tx, tz, r, { kind: 'oak' });
    // THE PARKING LOT
    P.box({ x: -30, y: 0, z: 18, w: 34, h: 0.02, d: 30, mat: 'concrete', color: 0x2e2e32, collide: false, cast: false });
    for (let i = 0; i < 6; i++) for (const z of [8, 28]) P.box({ x: -44 + i * 5.2, y: 0.03, z, w: 0.12, h: 0.01, d: 5, mat: 'neon', color: 0xc8c8a0, collide: false, cast: false });
    const carC = [0x7a1f1f, 0x1f3a7a, 0x2a2a2a, 0xd8d8d0, 0x3a6a3a, 0x8a6a2a];
    for (const [cx, cz, a, i] of [[-41.4, 8, Math.PI / 2, 0], [-31, 8, Math.PI / 2, 1], [-25.8, 8, Math.PI / 2 + 0.1, 2], [-36.2, 28, -Math.PI / 2, 3], [-20.6, 28, -Math.PI / 2, 4], [-30, 18, 0.2, 5]]) car(P, cx, cz, a, carC[i]);
    // the school bus
    { const F = frame(-12, 30, 0.1); const [x, z] = F(0, 0); P.box({ x, y: 0.4, z, w: 11, h: 2.6, d: 2.6, ry: F.ry, mat: 'smooth', color: 0xe8b020 }); for (let i = 0; i < 6; i++) { const [wx, wz] = F(-4 + i * 1.6, 1.31); P.box({ x: wx, y: 1.9, z: wz, w: 1.2, h: 0.8, d: 0.04, ry: F.ry, mat: 'glass', color: 0x3a4a5a, collide: false, cast: false }); } }
    for (const [x, z] of [[-14, 12], [-44, 18], [-16, 4]]) lamp(P, x, z, { h: 5, intensity: 7, distance: 15, color: 0xffd8a0, flicker: x === -44 ? 0.8 : 0 });
    // THE FIELD
    P.box({ x: 24, y: 0, z: 24, w: 40, h: 0.02, d: 26, mat: 'grass', color: 0x3d6a32, collide: false, cast: false });
    for (let i = 0; i <= 8; i++) P.box({ x: 5 + i * 4.75, y: 0.03, z: 24, w: 0.1, h: 0.01, d: 24, mat: 'neon', color: 0xe8e8e0, collide: false, cast: false });
    for (const gx of [5, 43]) { P.cyl({ x: gx, y: 0, z: 24, r: 0.1, h: 1.6, mat: 'metal', color: 0xe8d040 }); P.cyl({ x: gx, y: 1.6, z: 24, r: 0.07, h: 3.6, axis: 'z', mat: 'metal', color: 0xe8d040, collide: false }); for (const dz of [-1.8, 1.8]) P.cyl({ x: gx, y: 1.6, z: 24 + dz, r: 0.06, h: 3, mat: 'metal', color: 0xe8d040, collide: false }); }
    bleachers(P, 24, 40, Math.PI, { w: 18, rows: 5 });
    for (const [x, z] of [[2, 10], [46, 10], [2, 38], [46, 38]]) lamp(P, x, z, { h: 9, intensity: 10, distance: 24, color: 0xf0f6ff });
    chainFence(P, 2, 9, 46, 9, { barbed: false, h: 2 }); chainFence(P, 46, 9, 46, 39, { barbed: false, h: 2 });
    // the woods behind it all
    for (let i = 0; i < 40; i++) { const a = r() * Math.PI * 2, d = 46 + r() * 5, x = Math.cos(a) * d, z = Math.sin(a) * d; if (Math.abs(x) < 51 && Math.abs(z) < 49) tree(P, x, z, r, { kind: 'pine', color: 0x21331f }); }
    return {
      spawns: {
        survivor: [[-4, 2], [4, 2], [-8, 4], [8, 4], [0, 6], [-4, 8], [4, 8], [0, 0]],
        killer: [[36, -32], [-20, -26], [26, 30]]
      },
      gens: [[-14, -26, 0], [14, -20.5, 0], [-23.5, -16.5, -Math.PI / 2], [38, -26, Math.PI / 2], [-36, 18, 0]],
      items: [[-21, -35], [5, -31.2], [20, -18], [-16, -17], [33, -38], [-36, 14], [24, 34], [10, 22]],
      hides: [[-8, -36], [21, -36], [34, -20], [-12, 26], [-44, 26], [38, 40]]
    };
  }
};
