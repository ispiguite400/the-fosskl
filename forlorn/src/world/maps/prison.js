/*
 * GUEST PRISON — where the Bacon Empire locked up the Guests (The Last Guest).
 * Night, floodlights, towers sweeping the yard. Cell Block A to the north, the mess hall east,
 * the guard house west, the workshop south-east, the yard in the middle, the gate to the south.
 */
import { lamp, crate, barrel, frame, sandbags } from '../prefabs.js';
import { building, partition, bars, chainFence, guardTower, bunk, table, desk, lockers, bleachers, shelf } from '../prefabs2.js';

export default {
  id: 'prison', name: 'Guest Prison', film: 'The Last Guest',
  blurb: 'The Empire\'s prison for Guests. Tonight the cells are open.',
  size: [96, 96],
  surface: 'concrete',
  ambience: {
    sky: { top: 0x05070f, horizon: 0x1c2a44, bottom: 0x080a10, sunDir: [0.3, 0.6, -0.7], sunColor: 0xd8e4ff, sunSize: 0.01, stars: 0.8, clouds: 0.45, cloud: 0x141a28 },
    fog: { color: 0x0e1420, density: 0.026 },
    hemi: { sky: 0x5a6a90, ground: 0x24262c, intensity: 1.15 },
    sun: { dir: [0.3, 0.7, -0.6], color: 0xb0c4ff, intensity: 1.35 },
    envIntensity: 0.5,
    grade: { tint: [0.95, 1.0, 1.07], sat: 0.92, contrast: 1.1 },
    particles: 'dust'
  },
  music: 'prison',
  event: { at: 0.45, kind: 'alarm', title: 'LOCKDOWN', text: 'The alarm is up: every survivor is shown to the killer, and the killer to them', sound: 'siren' },
  landmarks: [['Cell Block A', -10, -31], ['the mess hall', 30, -28], ['the yard', 0, 4], ['the guard house', -30, 22], ['the workshop', 28, 24], ['the gate', 0, 42]],
  build(P, r) {
    // the ground: concrete everywhere, asphalt paths, a patch of dead grass
    P.box({ x: 0, y: -0.5, z: 0, w: 100, h: 0.5, d: 100, mat: 'concrete', color: 0x5a5c5e, collide: false, cast: false });
    P.box({ x: 0, y: 0, z: 12, w: 8, h: 0.02, d: 64, mat: 'concrete', color: 0x3a3c40, collide: false, cast: false });
    P.box({ x: 0, y: 0, z: -14, w: 80, h: 0.02, d: 6, mat: 'concrete', color: 0x3a3c40, collide: false, cast: false });
    P.box({ x: -14, y: 0, z: 6, w: 16, h: 0.02, d: 20, mat: 'grass', color: 0x4a4a32, collide: false, cast: false });
    // the outer wall and its corner towers
    for (const [x, z, w, d] of [[0, -46, 94, 1], [0, 46, 94, 1], [-46, 0, 1, 94], [46, 0, 1, 94]]) {
      const gate = z === 46;
      if (gate) { P.box({ x: -26, y: 0, z, w: 42, h: 6, d, mat: 'concrete', color: 0x7a7a74 }); P.box({ x: 26, y: 0, z, w: 42, h: 6, d, mat: 'concrete', color: 0x7a7a74 }); P.box({ x: 0, y: 4.2, z, w: 10, h: 1.8, d, mat: 'concrete', color: 0x7a7a74, collide: false }); }
      else P.box({ x, y: 0, z, w, h: 6, d, mat: 'concrete', color: 0x7a7a74 });
    }
    P.box({ x: 0, y: 0, z: 46.2, w: 10, h: 3.2, d: 0.2, mat: 'metal', color: 0x3a3c40, collide: true, sight: false });   // the gate, shut
    for (const [x, z, ry] of [[-42, -42, 0.785], [42, -42, -0.785], [-42, 42, 2.356], [42, 42, -2.356]]) guardTower(P, x, z, ry, { h: 6 });
    // CELL BLOCK A: two rows of cells off a central corridor
    {
      const F = building(P, -10, -31, 0, { w: 40, d: 18, h: 4, color: 0x8a8678, doors: { front: [20], left: [9], right: [9] }, windows: { back: [6, 14, 26, 34] }, floor: { mat: 'concrete', color: 0x6a6a66 }, lights: [[-14, 0], [-4, 0], [6, 0], [14, 0]], lightColor: 0xdfe8ff, lightI: 5, flicker: 0.04 });
      for (let i = 0; i < 9; i++) {
        const x0 = -18 + i * 4;
        // north row: cell walls and bars along the corridor
        partition(P, F, x0, -9, x0, -3.4, { h: 4 });
        const open = (i * 7) % 3 !== 0;
        { const [ax, az] = F(x0 + 0.1, -3.4), [bx, bz] = F(x0 + 3.9, -3.4); bars(P, ax, az, bx, bz, { h: 4, door: open ? [1.2, 2.6] : null }); }
        { const [bx, bz] = F(x0 + 2, -8); bunk(P, bx, bz, Math.PI / 2); }
        // south row
        partition(P, F, x0, 3.4, x0, 9, { h: 4 });
        const open2 = (i * 5) % 4 !== 1;
        { const [ax, az] = F(x0 + 0.1, 3.4), [bx, bz] = F(x0 + 3.9, 3.4); bars(P, ax, az, bx, bz, { h: 4, door: open2 ? [1.2, 2.6] : null }); }
        { const [bx, bz] = F(x0 + 2, 8); bunk(P, bx, bz, Math.PI / 2); }
      }
      partition(P, F, 18, -9, 18, -3.4, { h: 4 }); partition(P, F, 18, 3.4, 18, 9, { h: 4 });
    }
    // THE MESS HALL
    {
      const F = building(P, 30, -28, 0, { w: 18, d: 14, h: 3.6, color: 0xa8a090, doors: { front: [5, 13], left: [7] }, windows: { right: [4, 10], back: [4, 9, 14] }, floor: { mat: 'tile', color: 0x9a9890 }, lights: [[-4, -3], [4, -3], [-4, 3], [4, 3]], lightColor: 0xfff2d8 });
      for (const [lx, lz] of [[-4, -3.5], [4, -3.5], [-4, 0.5], [4, 0.5]]) { const [x, z] = F(lx, lz); table(P, x, z, 0, { w: 4, d: 0.9, color: 0x9aa0a6, mat: 'metal', benches: true }); }
      { const [x, z] = F(0, -6.2); P.box({ x, y: 0, z, w: 12, h: 1.0, d: 0.8, mat: 'metal', color: 0x8a8e92, sight: false }); }   // the serving counter
    }
    // THE GUARD HOUSE
    {
      const F = building(P, -30, 22, Math.PI / 2, { w: 16, d: 11, h: 3.4, color: 0x9a9480, doors: { front: [4], back: [12] }, windows: { front: [10, 13], left: [5] }, floor: { mat: 'carpet', color: 0x4a4a5a }, lights: [[-4, 0], [4, 0]], lightColor: 0xfff0d0 });
      partition(P, F, 1, -5.5, 1, 5.5, { doors: [3] });
      for (const [lx, lz] of [[-5, -2.5], [-5, 2], [4, -2.5]]) { const [x, z] = F(lx, lz); desk(P, x, z, F.ry, { chair: 0x2a2a2a }); }
      lockers(P, F, 3, 4.9, 8, { colors: [0x4a5a6a, 0x3e4e5e] });
    }
    // THE WORKSHOP (license plates, of course)
    {
      const F = building(P, 28, 24, 0, { w: 16, d: 12, h: 3.8, color: 0x8a8070, doors: { back: [8], left: [6] }, windows: { front: [4, 12], right: [6] }, floor: { mat: 'concrete', color: 0x5a5a56 }, lights: [[-3, 0], [4, 0]], lightColor: 0xffe2b0, flicker: 0.2 });
      for (const [lx, lz, ry] of [[-5, -4, 0], [-5, 3.5, 0], [3, -4, 0], [5.5, 2, Math.PI / 2]]) { const [x, z] = F(lx, lz); shelf(P, x, z, F.ry + ry, { w: 2.6 }); }
      { const [x, z] = F(0, 0); table(P, x, z, 0, { w: 3, d: 1.2, color: 0x6a5a48 }); }
    }
    // THE YARD: a court, bleachers, the weights, the fence round it
    P.box({ x: 8, y: 0, z: 6, w: 15, h: 0.025, d: 26, mat: 'concrete', color: 0x6a4a3a, collide: false, cast: false });
    for (const [x, z, w, d] of [[8, -6.8, 15, 0.08], [8, 18.8, 15, 0.08], [0.6, 6, 0.08, 26], [15.4, 6, 0.08, 26], [8, 6, 15, 0.08]]) P.box({ x, y: 0.03, z, w, h: 0.01, d, mat: 'neon', color: 0xd8d8d0, collide: false, cast: false });
    for (const z of [-5.4, 17.4]) {
      P.cyl({ x: 8, y: 0, z: z + (z < 0 ? -1 : 1) * 0.8, r: 0.1, h: 3.4, mat: 'metal', color: 0x3a3a3a });
      P.box({ x: 8, y: 2.9, z, w: 1.8, h: 1.1, d: 0.06, mat: 'plastic', color: 0xe8e8e8, collide: false });
      P.cyl({ x: 8, y: 3.0, z: z + (z < 0 ? 0.3 : -0.3), r: 0.25, h: 0.04, mat: 'metal', color: 0xd85a20, open: true, collide: false });
    }
    bleachers(P, 20.5, 6, -Math.PI / 2, { w: 12, rows: 4 });
    for (const [x, z] of [[-6, -2], [-8, 1], [-4, 3]]) { P.box({ x, y: 0.4, z, w: 1.6, h: 0.12, d: 0.4, mat: 'fabric', color: 0x2a2a2e, collide: false }); P.wall({ x, z, w: 1.6, d: 0.5, h: 0.6, y: 0 }); P.cyl({ x, y: 1.1, z: z - 0.2, r: 0.04, h: 2.0, axis: 'x', mat: 'metal', color: 0x8a8a8a, collide: false }); }
    chainFence(P, -2, -9, 24, -9); chainFence(P, -2, 24, 10, 24); chainFence(P, 17, 24, 24, 24); chainFence(P, 24, -9, 24, 2); chainFence(P, 24, 10, 24, 24);
    // the road to the gate: a checkpoint, sandbags, the booth
    sandbags(P, -6, 38, 0.1, 4, 3); sandbags(P, 6, 36, -0.2, 4, 3);
    { const F = building(P, 10, 41, 0, { w: 4, d: 3, h: 2.8, color: 0x6a7a8a, doors: { left: [1.5] }, windows: { front: [2], back: [2] }, lights: [[0, 0]], lightColor: 0xfff0c0 }); void F; }
    for (let i = 0; i < 6; i++) { const x = -40 + i * 5; crate(P, x, 44, r() * 0.4); }
    for (const [x, z] of [[38, 10], [39, 12], [38.5, -6], [-38, -14], [-37, -12]]) barrel(P, x, z, 0x3a5a7a);
    // floodlights over the yard and the paths
    for (const [x, z] of [[-16, -12], [16, -12], [-16, 14], [-4, 30], [20, 30], [36, -2], [-36, 2], [0, -18]]) lamp(P, x, z, { h: 6, intensity: 9, distance: 18, color: 0xeef4ff, flicker: (x * z) % 7 === 0 ? 0.5 : 0 });
    // a burned-out jeep of the Empire's, a pile of tyres
    { const F = frame(-20, 36, 0.5); for (const [lx, lz] of [[-1, 0], [1, 0], [0, 0.9]]) { const [x, z] = F(lx, lz); P.cyl({ x, y: 0, z, r: 0.45, h: 0.3, mat: 'plastic', color: 0x1a1a1a, seg: 12, collide: true, sight: false }); } }
    return {
      spawns: {
        survivor: [[-3, 36], [3, 36], [-6, 33], [6, 33], [0, 32], [-3, 30], [3, 30], [0, 38]],
        killer: [[-36, -6], [38, 4], [0, -17]]
      },
      gens: [[-22, -31, Math.PI / 2], [30, -26, 0], [-8, 10, 0.3], [-30, 18, Math.PI / 2], [28, 26, 0]],
      items: [[-26, -31], [6, -36], [34, -33], [-28, 16], [26, 22], [7, 39], [-14, 34], [20, -2]],
      hides: [[-6, -36], [2, -26], [36, -24], [-30, 26], [32, 28], [10, 41]]
    };
  }
};
