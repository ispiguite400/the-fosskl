/*
 * BACON CITY — the walled city of The Bacon Hair, where the Guest Republic keeps the Bacon Hairs
 * penned in the slums and the Curfew Bots walk the streets after dark.
 * Night and rain. The Wall all round, its towers and searchlights; the Gate to the south.
 * The avenue runs north to south; 2nd Street and 4th Street cross it. West of the avenue: the
 * slums, the tenements, Zayden's block. East: the power plant, Republic Square and the Ministry,
 * the school and the shops.
 */
import { lamp, car, bench, crate, barrel, sandbags, frame } from '../prefabs.js';
import { building, partition, table, desk, shelf, chainFence, bed } from '../prefabs2.js';
import { sign, tenement, shack, cityWall, wallTower, streetLight, burnBarrel, dumpster, washLine, roadblock, camp, pipe, bigTank } from '../prefabs3.js';

const PI = Math.PI;

export default {
  id: 'city', name: 'Bacon City', film: 'The Bacon Hair',
  blurb: 'Curfew is in effect. Nobody gets over the Wall.',
  size: [112, 112],
  surface: 'concrete',
  ambience: {
    sky: { top: 0x05070c, horizon: 0x4a3a2c, bottom: 0x0a0a0c, sunDir: [0.35, 0.55, 0.6], sunColor: 0xc8d4ff, sunSize: 0.012, stars: 0.25, clouds: 0.8, cloud: 0x1c1b1e },
    fog: { color: 0x15161a, density: 0.021 },
    hemi: { sky: 0x6a7898, ground: 0x342c24, intensity: 1.45 },
    sun: { dir: [0.35, 0.7, 0.55], color: 0xaabcff, intensity: 1.5 },
    envIntensity: 0.55,
    grade: { tint: [1.04, 0.99, 0.95], sat: 0.9, contrast: 1.12 },
    particles: 'rain'
  },
  music: 'city',
  card: { at: [-3, 4.5, 44], look: [2, 4, 0] },
  event: { at: 0.45, kind: 'curfew', title: 'CURFEW', text: 'Curfew is in effect: the searchlights report anyone they catch to the killer', sound: 'siren', dur: 40 },
  landmarks: [['the slums', -32, -32], ['the tenements', -26, 2], ["Zayden's block", -28, 32], ['the power plant', 28, -32], ['Republic Square', 19, 2], ['the Ministry', 38, 2], ['the school', 31, 33], ['the shops', 12, 34], ['the Gate', 0, 48], ['the avenue', 0, -2]],
  build(P, r) {
    /* ---------- the ground: asphalt, pavements, markings ---------- */
    P.box({ x: 0, y: -0.5, z: 0, w: 118, h: 0.5, d: 118, mat: 'concrete', color: 0x2a2c30, collide: false, cast: false });
    const pave = (x0, x1, z0, z1, c = 0x55534f) => P.box({ x: (x0 + x1) / 2, y: 0, z: (z0 + z1) / 2, w: x1 - x0, h: 0.04, d: z1 - z0, mat: 'concrete', color: c, collide: false, cast: false });
    for (const [x0, x1] of [[-45.8, -6], [6, 45.8]]) for (const [z0, z1] of [[-45.8, -18], [-10, 14], [22, 45.8]]) pave(x0, x1, z0, z1);
    const paint = (x, z, w, d, c = 0xd8d4c4) => P.box({ x, y: 0.005, z, w, h: 0.02, d, mat: 'smooth', color: c, collide: false, cast: false });
    for (let z = -50; z <= 50; z += 4) if (Math.abs(z + 14) > 5 && Math.abs(z - 18) > 5) paint(0, z, 0.16, 2, 0xc8a030);
    for (let x = -50; x <= 50; x += 4) if (Math.abs(x) > 7) { paint(x, -14, 2, 0.16, 0xc8a030); paint(x, 18, 2, 0.16, 0xc8a030); }
    for (const zc of [-14, 18]) for (const s of [-1, 1]) for (let i = 0; i < 6; i++) { paint(s * 7.6, zc - 3 + i * 1.2, 2.2, 0.6); paint(-4 + i * 1.6, zc + s * 5, 0.6, 2.2); }
    // puddles that catch the light
    for (const [x, z, s] of [[-3, -30, 2.2], [2, 6, 1.6], [-26, -14, 2.6], [30, 18, 2], [-2, 34, 1.8], [44, -14, 2], [-30, 49, 2.4]]) P.cyl({ x, y: 0.01, z, r: s, h: 0.02, mat: 'glass', color: 0x0a0c10, seg: 14, collide: false, cast: false });

    /* ---------- THE WALL, its towers and the Gate ---------- */
    cityWall(P, -54, -54, 54, -54); cityWall(P, 54, -54, 54, 54); cityWall(P, -54, 54, -54, -54);
    cityWall(P, -54, 54, -8.5, 54); cityWall(P, 8.5, 54, 54, 54);
    const lights = [];
    for (const [x, z] of [[-51, -51], [51, -51], [-51, 51], [51, 51], [0, -52], [-52, 0], [52, 0], [-12, 52], [12, 52]]) lights.push(wallTower(P, x, z, Math.atan2(-x, -z)));
    // the Gate: two steel leaves, shut, under a concrete lintel
    for (const s of [-1, 1]) {
      P.box({ x: s * 3.6, y: 0, z: 54.4, w: 7.2, h: 14, d: 0.9, mat: 'dplate', color: 0x3a3c40, sight: true });
      for (let y = 1.5; y < 14; y += 3) P.box({ x: s * 3.6, y, z: 53.9, w: 7.0, h: 0.3, d: 0.1, mat: 'metal', color: 0x24262a, collide: false, cast: false });
      P.box({ x: s * 7.6, y: 0, z: 54, w: 1.4, h: 18, d: 3.2, mat: 'concrete', color: 0x5a5856 });
    }
    P.box({ x: 0, y: 14, z: 54, w: 16.6, h: 4, d: 3, mat: 'concrete', color: 0x5e5c58, collide: false });
    // hazard bands across the leaves, red lamps on the posts, floodlights on the steel
    for (let i = 0; i < 14; i++) P.box({ x: -6.75 + i * 1.04, y: 0.4, z: 53.88, w: 1.04, h: 0.9, d: 0.06, mat: 'smooth', color: i % 2 ? 0x1a1a1a : 0xc89a1a, collide: false, cast: false });
    P.box({ x: 0, y: 0, z: 53.9, w: 0.12, h: 14, d: 0.08, mat: 'metal', color: 0x15161a, collide: false, cast: false });
    for (const s of [-1, 1]) { P.box({ x: s * 7.6, y: 12.6, z: 52.3, w: 0.5, h: 0.5, d: 0.2, mat: 'neon', color: 0xff2a1a, collide: false, cast: false }); P.light({ x: s * 5, y: 9, z: 50.5, color: 0xdfe6ff, intensity: 7, distance: 14, glowSize: 1.2 }); }
    sign(P, 0, 16, 52.45, PI, 12, 3, ['BACON CITY', 'THE WALL KEEPS YOU SAFE'], { kind: 'screen', color: '#ff3b30', lightI: 5 });
    sandbags(P, -10, 47, 0.1, 4, 3); sandbags(P, 10, 47.5, -0.1, 4, 3);
    roadblock(P, -3.5, 46, 0, 5); roadblock(P, 3.6, 44.5, 0.05, 4.4);
    { const F = building(P, 19, 49, 0, { w: 4, d: 3, h: 2.8, color: 0x4a5a6a, doors: { left: [1.5] }, windows: { front: [2], back: [2] }, lights: [[0, 0]], lightColor: 0xfff0c0 }); void F; }
    for (const [x, z] of [[-6, 50], [6, 50], [0, 44]]) lamp(P, x, z, { h: 6, intensity: 9, distance: 16, color: 0xf2f6ff });
    // the north checkpoint: a patrol van and barriers
    car(P, -2.5, -47, PI / 2, 0xd8d8d4); P.box({ x: -2.5, y: 1.05, z: -47, w: 1.95, h: 0.12, d: 4.25, mat: 'neon', color: 0xff2020, collide: false, cast: false });
    roadblock(P, 3.5, -44, 0, 5);

    /* ---------- the street lights ---------- */
    for (const z of [-40, -27, -2, 8, 30, 42]) { streetLight(P, -7.2, z, PI / 2, { flicker: z === 8 ? 0.6 : 0 }); streetLight(P, 7.2, z + 5, -PI / 2, { dead: z === -27 }); }
    for (const x of [-38, -24, 22, 38]) streetLight(P, x, -18.8, 0, { flicker: x === -24 ? 0.5 : 0 });
    for (const x of [-32, -18, 28, 44]) streetLight(P, x, -9.2, PI);
    for (const x of [-22, 16, 30]) streetLight(P, x, 13.2, PI, { dead: x === 30 });
    for (const x of [-32, -16, 20, 44]) streetLight(P, x, 22.8, 0);
    for (const [x, z, ry] of [[-49.5, -30, PI / 2], [-49.5, 30, PI / 2], [49.5, -30, -PI / 2], [49.5, 30, -PI / 2], [-30, -49.5, 0], [30, -49.5, 0], [-30, 49.5, PI], [30, 49.5, PI]]) streetLight(P, x, z, ry, { h: 5.5, intensity: 7 });

    /* ---------- the cars left in the street ---------- */
    car(P, -2.4, -30, PI / 2 + 0.08, 0x3a4a5a); car(P, 2.6, 26, -PI / 2 - 0.15, 0x6a2a24); car(P, 2.4, -6, PI / 2, 0x2a2a2a, true);
    car(P, -30, -12.4, 0.05, 0x5a5a4a); car(P, 26, 19.6, PI, 0x2a4a3a); car(P, 36, -15.6, 0.3, 0x3a2a2a, true); car(P, -40, 20, PI - 0.1, 0x4a4a6a);

    /* ---------- NW: THE SLUMS ---------- */
    {
      const rows = [[-41.5, 0, [-42, -35.5, -29, -23.5]], [-34.5, PI, [-42, -35.5, -23.5]], [-27.5, 0, [-42, -35.5, -29, -23.5]], [-21.5, 0, [-41, -33]]];
      for (const [z, ry, xs] of rows) for (const x of xs) shack(P, x, z, ry, r);
      for (const [ax, az, bx, bz] of [[-44, -38, -21, -38], [-44, -31, -21, -31], [-39, -24.5, -26, -24.5]]) washLine(P, ax, az, bx, bz, 2.6, r);
      for (const [x, z] of [[-29, -24.6], [-38.7, -31], [-26.5, -38.2], [-27, -20.5]]) burnBarrel(P, x, z);
      for (const [x, z, ry] of [[-25.5, -20.5, 0.4], [-31, -38.5, PI / 2], [-40, -24.5, 0.2]]) camp(P, x, z, ry, r);
      for (const [x, z] of [[-44, -45], [-20, -45], [-45, -19.5]]) { crate(P, x, z, r()); crate(P, x + 1.2, z + 0.3, r(), 0.8); }
      dumpster(P, -11.5, -43.5, 0); dumpster(P, -20.5, -19.6, PI / 2, 0x3a3a5a);
      // the tenement on the avenue
      tenement(P, -13, -31, PI / 2, r, { w: 16, d: 9, floors: 4, color: 0x6a3e32, lit: 0.18, escape: false });
      sign(P, -8.33, 10.5, -31, PI / 2, 10, 4.2, ['OBEY THE REPUBLIC', 'REPORT CURFEW BREAKERS'], { kind: 'screen', color: '#ff3b30' });
      for (const [x, z, ry] of [[-25.8, -27.5, -PI / 2], [-37, -39.45, 0], [-43.4, -25.45, 0]]) sign(P, x, 1.7, z, ry, 0.9, 1.25, ['CURFEW', 'IN EFFECT', '9 PM - 6 AM'], { kind: 'poster' });
    }

    /* ---------- W: THE TENEMENTS ---------- */
    {
      tenement(P, -34, -3, 0, r, { w: 18, d: 9, floors: 3, color: 0x7a4636, doors: { front: [4, 14], back: [9] } });
      tenement(P, -34, 9.5, PI, r, { w: 18, d: 8, floors: 4, color: 0x5e4a40, doors: { front: [4, 14], back: [9] }, escapeAt: 0.7 });
      tenement(P, -14.5, 2, PI / 2, r, { w: 20, d: 9, floors: 4, color: 0x6e5244, doors: { front: [5, 15], back: [10] }, lights: [[-6, 0], [0, 0], [6, 0]], escape: false });
      sign(P, -9.83, 10, 2, PI / 2, 10, 4.5, ['CURFEW AT 9:00 PM', 'STAY INSIDE AFTER DARK'], { kind: 'screen', color: '#ff3b30' });
      // inside: rooms off the hall, beds and tables
      { const F = frame(-34, -3, 0); partition(P, F, -2, -4.5, -2, 1.5, { h: 3.6 }); for (const [lx, lz] of [[-6, -2.5], [5, -2.5]]) { const [x, z] = F(lx, lz); bed(P, x, z, PI / 2); } }
      { const F = frame(-34, 9.5, PI); partition(P, F, 2, -4, 2, 1.2, { h: 3.6 }); const [x, z] = F(-5, -1.5); table(P, x, z, 0, { w: 2, d: 1, color: 0x6a5038 }); }
      // the alley: bins, a fire, a sleeping bag, washing overhead
      for (const [x, z, ry] of [[-41.5, 3.5, PI / 2], [-27, 3.6, -PI / 2]]) dumpster(P, x, z, ry);
      burnBarrel(P, -36.5, 3.4); camp(P, -31.5, 3.5, PI / 2, r);
      washLine(P, -43, 2.2, -25, 4.8, 3.2, r); washLine(P, -43, 4.8, -25, 2.2, 4.0, r);
      for (const [x, z] of [[-24, -8], [-20, 13]]) { barrel(P, x, z, 0x3a5a7a); barrel(P, x + 0.9, z - 0.4, 0x5a3a2a); }
      sign(P, -24.8, 1.8, -6, PI / 2, 0.9, 1.25, ['MISSING', 'HAVE YOU SEEN', 'THIS BACON?'], { kind: 'poster', band: '#1a1a1a' });
    }

    /* ---------- SW: ZAYDEN'S BLOCK ---------- */
    {
      // Zayden's home: front room and kitchen, his room at the back
      const F = building(P, -34, 30, 0, { w: 12, d: 8, h: 3.4, mat: 'concrete', color: 0x8a96a0, doors: { front: [3.5], left: [5], right: [3] }, windows: { front: [8.5], back: [3, 9] }, floor: { mat: 'planks', color: 0x6a5038 }, lights: [[-3, 0], [3, 1]], lightColor: 0xffd8a8, lightI: 4.5 });
      partition(P, F, 1, -4, 1, 4, { doors: [5.6], h: 3.4 });
      { const [x, z] = F(-3, 1); table(P, x, z, 0, { w: 1.8, d: 1, color: 0x7a5a3a }); }
      { const [x, z] = F(4, -2.2); bed(P, x, z, PI / 2); }
      { const [x, z] = F(-5.2, -3.2); shelf(P, x, z, 0, { w: 2 }); }
      P.box({ x: -34, y: 3.7, z: 30, w: 12.1, h: 3, d: 8.1, mat: 'concrete', color: 0x7a8690, collide: false });
      for (const lx of [-4, 0, 4]) { const [x, z] = F(lx, 4.08); P.box({ x, y: 4.6, z, w: 1.1, h: 1.4, d: 0.06, mat: lx === 4 ? 'neon' : 'glass', color: lx === 4 ? 0xffc77a : 0x141a22, collide: false, cast: false }); }
      // his dad's garage: where Guesty was rewired. Benches, parts, a work lamp
      const G = building(P, -21, 30, 0, { w: 8, d: 8, h: 3.6, mat: 'metal', color: 0x5a6266, doors: { front: [4], left: [5] }, doorW: 3.2, windows: { back: [4] }, floor: { mat: 'concrete', color: 0x4a4a48 }, lights: [[0, 0]], lightColor: 0xffe8c0, lightI: 5, flicker: 0.1 });
      { const [x, z] = G(-1.5, -3); table(P, x, z, 0, { w: 3, d: 1, color: 0x5a4a3a }); }
      { const [x, z] = G(3, -1); shelf(P, x, z, PI / 2, { w: 2.4 }); }
      for (const [lx, lz] of [[2.2, 2.4], [2.9, 1.6], [-2.8, 2.4]]) { const [x, z] = G(lx, lz); crate(P, x, z, r(), 0.7, 0x6a6a66); }
      { const [x, z] = G(-1.5, -3); P.box({ x: x - 0.6, y: 0.95, z, w: 0.5, h: 0.5, d: 0.5, mat: 'metal', color: 0x3a3c40, collide: false }); P.ball({ x: x + 0.5, y: 1.1, z, r: 0.18, mat: 'neon', color: 0xff2a1a, collide: false, cast: false }); }
      // the court out back
      P.box({ x: -30, y: 0.02, z: 40.5, w: 18, h: 0.02, d: 8, mat: 'concrete', color: 0x3a4a5a, collide: false, cast: false });
      for (const [x, z, w, d] of [[-30, 36.6, 18, 0.08], [-30, 44.4, 18, 0.08], [-38.9, 40.5, 0.08, 8], [-21.1, 40.5, 0.08, 8], [-30, 40.5, 0.08, 8]]) paint(x, z + 0.0, w, d, 0xc8c4b8);
      for (const s of [-1, 1]) { P.cyl({ x: -30 + s * 9.6, y: 0, z: 40.5, r: 0.1, h: 3.3, mat: 'metal', color: 0x3a3a3a }); P.box({ x: -30 + s * 9.3, y: 2.7, z: 40.5, w: 0.06, h: 1.0, d: 1.6, mat: 'plastic', color: 0xe8e8e8, collide: false }); }
      chainFence(P, -40, 45.3, -20, 45.3, { barbed: false }); chainFence(P, -40, 35.8, -33, 35.8, { barbed: false }); chainFence(P, -27, 35.8, -20, 35.8, { barbed: false });
      // the corner store on the avenue
      const S = building(P, -12, 36, PI / 2, { w: 10, d: 6, h: 3.4, color: 0x6a7a6a, doors: { front: [3], back: [7] }, windows: { front: [7.5] }, floor: { mat: 'tile', color: 0x8a8a84 }, lights: [[0, 0]], lightColor: 0xe8fff0 });
      { const [x, z] = S(2.5, -1.5); shelf(P, x, z, PI / 2, { w: 2.6 }); } { const [x, z] = S(-2.5, -1.5); shelf(P, x, z, PI / 2, { w: 2.6 }); }
      sign(P, -8.83, 3.0, 36, PI / 2, 4, 1.0, '24/7 MART', { color: '#35ff7a', lightI: 1.6, glow: 1.8 });
    }

    /* ---------- NE: THE POWER PLANT ---------- */
    {
      const F = building(P, 30, -36, 0, { w: 22, d: 12, h: 6, mat: 'metal', color: 0x50565a, doors: { front: [5, 17], left: [6], right: [6] }, doorW: 2.4, windows: { back: [5, 11, 17] }, floor: { mat: 'concrete', color: 0x3e4042 }, lights: [[-6, 0], [6, 0]], lightColor: 0xd8ecff, lightI: 6, flicker: 0.08 });
      for (const lx of [-7, 7]) { const [x, z] = F(lx, -2.5); P.cyl({ x, y: 1.75, z, r: 1.3, h: 4.5, axis: 'x', ry: 0, mat: 'metal', color: 0x6a7076, seg: 14, collide: false }); P.wall({ x, z, w: 4.5, d: 2.6, h: 2.3, y: 0, sight: false }); P.box({ x, y: 0, z, w: 4, h: 0.5, d: 2.4, mat: 'concrete', color: 0x3a3a38, collide: false }); }
      for (const [lx, lz] of [[-9, 4], [9, 4]]) { const [x, z] = F(lx, lz); P.box({ x, y: 0, z, w: 2, h: 2.2, d: 1.2, mat: 'metal', color: 0x3a4a3a, sight: false }); P.box({ x, y: 1.4, z: z + 0.62, w: 0.6, h: 0.3, d: 0.02, mat: 'neon', color: 0x40ff60, collide: false, cast: false }); }
      sign(P, 30, 4.9, -29.83, 0, 8, 1.6, 'REPUBLIC POWER', { kind: 'neon', color: '#ffd23a' });
      bigTank(P, 12.5, -41, 3, 7); bigTank(P, 12.5, -30.5, 2.4, 6, 0x7a7e78);
      pipe(P, 15.5, -41, 19, -41, 3.2, 0.35); pipe(P, 15, -30.5, 19, -33, 2.6, 0.3);
      // the stack, blinking
      P.cyl({ x: 42, y: 0, z: -22.5, r: 1.6, rt: 1.2, h: 26, mat: 'brick', color: 0x6a3a30, seg: 16 });
      for (const y of [12, 25]) P.box({ x: 42, y, z: -21.25, w: 0.4, h: 0.4, d: 0.4, mat: 'neon', color: 0xff2a1a, collide: false, cast: false });
      // the transformer yard
      for (const x of [22, 28, 34]) { P.box({ x, y: 0, z: -24, w: 2.2, h: 2.4, d: 1.8, mat: 'metal', color: 0x4a5258, sight: false }); for (let i = 0; i < 5; i++) P.box({ x: x - 0.9 + i * 0.45, y: 0.3, z: -22.95, w: 0.08, h: 1.8, d: 0.3, mat: 'metal', color: 0x3a4046, collide: false, cast: false }); P.cyl({ x: x - 0.5, y: 2.4, z: -24, r: 0.12, h: 0.8, mat: 'plastic', color: 0x8a5a3a, seg: 8, collide: false }); }
      chainFence(P, 19.5, -21, 37, -21); chainFence(P, 19.5, -27, 19.5, -21);
      sign(P, 28, 1.6, -20.93, 0, 1.4, 1, ['DANGER', 'HIGH VOLTAGE'], { kind: 'poster', band: '#c8a020' });
      lamp(P, 24, -28, { h: 6, intensity: 8, distance: 15, color: 0xd8ecff }); lamp(P, 40, -28.5, { h: 6, intensity: 8, distance: 15, color: 0xd8ecff, flicker: 0.4 });
    }

    /* ---------- E: REPUBLIC SQUARE AND THE MINISTRY ---------- */
    {
      P.box({ x: 19, y: 0.04, z: 2, w: 22, h: 0.03, d: 20, mat: 'marble', color: 0x8a8680, collide: false, cast: false });
      // the monument: an obelisk in a dry basin
      P.cyl({ x: 19, y: 0, z: 2, r: 4.6, h: 0.6, mat: 'marble', color: 0xa8a49c, seg: 24 });
      P.cyl({ x: 19, y: 0.58, z: 2, r: 4.2, h: 0.04, mat: 'concrete', color: 0x3a3836, seg: 24, collide: false });
      P.box({ x: 19, y: 0.6, z: 2, w: 3, h: 1.4, d: 3, mat: 'marble', color: 0xc8c4bc });
      P.box({ x: 19, y: 2, z: 2, w: 1.5, h: 15, d: 1.5, mat: 'marble', color: 0xd0ccc4, collide: false });
      P.cyl({ x: 19, y: 17, z: 2, r: 1.06, rt: 0, h: 1.6, seg: 4, ry: PI / 4, mat: 'marble', color: 0xd8d4cc, collide: false });
      P.box({ x: 19, y: 17.1, z: 2.76, w: 0.5, h: 0.5, d: 0.02, mat: 'neon', color: 0xff3a2a, collide: false, cast: false });
      for (const [x, z] of [[15, -2], [23, -2], [15, 6], [23, 6]]) P.light({ x, y: 0.4, z, color: 0xfff0d8, intensity: 4, distance: 9, glow: false });
      // banners of the Republic on poles along the avenue
      for (const z of [-6, 2, 10]) { P.cyl({ x: 9, y: 0, z, r: 0.08, h: 8, mat: 'metal', color: 0x8a8a84, seg: 8 }); P.box({ x: 9.15, y: 4.2, z, w: 0.04, h: 3.4, d: 1.5, mat: 'fabric', color: 0x8a1414, collide: false }); P.box({ x: 9.18, y: 5.6, z, w: 0.02, h: 0.5, d: 0.5, mat: 'smooth', color: 0xe8e0d0, collide: false, cast: false }); }
      for (const [x, z, ry] of [[13, -6.5, 0], [25, -6.5, 0], [13, 10.5, PI], [25, 10.5, PI]]) bench(P, x, z, ry, 0x3a3a3a);
      for (const [x, z] of [[11, -8], [27, -8], [11, 12], [27, 12]]) lamp(P, x, z, { h: 4.5, intensity: 6, distance: 12, color: 0xf0f4ff });
      // the Ministry: marble, columns, offices, a screen over the square
      const F = building(P, 38, 2, -PI / 2, { w: 20, d: 12, h: 5, mat: 'marble', color: 0xbab6ae, doors: { front: [4, 10, 16], back: [10] }, windows: { left: [6], right: [6], back: [4, 16] }, floor: { mat: 'carpet', color: 0x5a1a1a }, lights: [[-6, -2], [0, -2], [6, -2], [-6, 3], [6, 3]], lightColor: 0xfff2d8, lightI: 5 });
      partition(P, F, -10, 0, -3, 0, { doors: [3.5], h: 5, mat: 'marble', color: 0xa8a49c }); partition(P, F, 3, 0, 10, 0, { doors: [3.5], h: 5, mat: 'marble', color: 0xa8a49c });
      for (const [lx, lz] of [[-7, -3.5], [-4.5, -3.5], [5, -3.5], [7.5, -3.5]]) { const [x, z] = F(lx, lz); desk(P, x, z, F.ry, { chair: 0x2a1a1a }); }
      P.box({ x: 38, y: 5.3, z: 2, w: 12.1, h: 8.5, d: 20.1, mat: 'marble', color: 0xa8a49c, collide: false });
      P.box({ x: 38, y: 13.8, z: 2, w: 12.6, h: 0.8, d: 20.6, mat: 'marble', color: 0x8a8680, collide: false });
      for (const z of [-7, -1, 5, 11]) { P.cyl({ x: 31, y: 0, z, r: 0.45, h: 5, mat: 'marble', color: 0xd8d4cc, seg: 12 }); P.box({ x: 31, y: 5, z, w: 1.2, h: 0.4, d: 1.2, mat: 'marble', color: 0xc8c4bc, collide: false }); }
      P.box({ x: 31, y: 5.2, z: 2, w: 1.4, h: 0.5, d: 20, mat: 'marble', color: 0xc0bcb4, collide: false });
      for (const y of [6.5, 9.5]) for (const z of [-6, -3, 7, 10]) P.box({ x: 31.92, y, z, w: 0.06, h: 1.6, d: 1.2, mat: (z * y) % 7 < 2 ? 'neon' : 'glass', color: (z * y) % 7 < 2 ? 0xffe0b0 : 0x141a22, collide: false, cast: false });
      sign(P, 31.85, 9.6, 2, -PI / 2, 8, 4, ['THE WALL', 'KEEPS YOU SAFE'], { kind: 'screen', color: '#ff3b30', lightI: 5 });
    }

    /* ---------- SE: THE SCHOOL AND THE SHOPS ---------- */
    {
      const F = building(P, 31, 33, PI, { w: 22, d: 14, h: 3.8, color: 0xb0a088, trim: 0x5a4a3a, doors: { front: [11], left: [7], right: [7], back: [5, 17] }, windows: { front: [4, 18], back: [10, 12] }, floor: { mat: 'tile', color: 0xa8a49a }, lights: [[-6, -3], [6, -3], [-6, 3], [6, 3], [0, 0]], lightColor: 0xeef4ff, lightI: 4.5, flicker: 0.1 });
      partition(P, F, -11, -1.5, -2, -1.5, { doors: [6], h: 3.8 }); partition(P, F, 2, -1.5, 11, -1.5, { doors: [3], h: 3.8 });
      partition(P, F, 0, -7, 0, -1.5, { h: 3.8 });
      for (const side of [-1, 1]) for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) { const [x, z] = F(side * (2.6 + col * 2.6), -5.5 + row * 2.2); desk(P, x, z, F.ry + PI, { chair: side < 0 ? 0x3a5a8a : 0x8a3a3a }); }
      for (const side of [-1, 1]) { const [x, z] = F(side * 5.5, -6.8); P.box({ x, y: 1.0, z, w: 5, h: 1.4, d: 0.06, ry: F.ry, mat: 'smooth', color: 0x1e3a2a, collide: false }); }
      { const [x, z] = F(-5.5, -6.75); sign(P, x, 1.7, z, F.ry, 4, 1.0, ['THE WALL PROTECTS US'], { kind: 'neon', color: '#f2f2e8', glow: 1.0, light: false }); }
      sign(P, 31, 3.1, 25.82, PI, 9, 1.2, 'BACON CITY SCHOOL', { kind: 'neon', color: '#8fd0ff', glow: 1.6 });
      chainFence(P, 20, 44, 42, 44, { barbed: false }); chainFence(P, 42, 41, 42, 44, { barbed: false });
      // the shop row on the avenue: the diner and the pawn shop
      const S = building(P, 12, 34, -PI / 2, { w: 20, d: 7, h: 3.6, color: 0x6a5048, doors: { front: [5, 15], back: [10] }, windows: { front: [2, 8, 12, 18] }, floor: { mat: 'tile', color: 0x8a2a2a }, lights: [[-5, 0], [5, 0]], lightColor: 0xffd0a0, lightI: 4.5, flicker: 0.2 });
      partition(P, S, 0, -3.5, 0, 3.5, { h: 3.6, doors: [2] });
      for (const lx of [-8, -5.5, -3]) { const [x, z] = S(lx, 1.6); table(P, x, z, S.ry, { w: 1.2, d: 1.2, color: 0xc8c0b0, benches: true }); }
      { const [x, z] = S(-5.5, -2.4); P.box({ x, y: 0, z, w: 1.0, h: 1.05, d: 8, mat: 'smooth', color: 0xb83a2a, sight: false, ry: 0 }); }
      for (const lx of [4, 7.5]) { const [x, z] = S(lx, -2.5); shelf(P, x, z, S.ry, { w: 2.6 }); }
      P.box({ x: 12, y: 3.9, z: 34, w: 7.1, h: 4, d: 20.1, mat: 'brick', color: 0x5a4038, collide: false });
      sign(P, 8.32, 4.6, 29, -PI / 2, 6, 1.5, 'BACON BITES', { color: '#ff7a2a' });
      sign(P, 8.32, 4.4, 39.5, -PI / 2, 3.6, 1.2, 'PAWN', { color: '#ffd23a', flicker: 0.5 });
      sign(P, 8.32, 3.0, 25.5, -PI / 2, 1.6, 0.6, 'OPEN', { color: '#ff3aa0', lightI: 2 });
    }

    /* ---------- odds and ends along the streets ---------- */
    for (const [x, z, ry] of [[-6.4, -20, 0], [6.4, -8.6, 0], [-6.4, 23, 0], [6.4, 13.6, 0]]) { P.cyl({ x, y: 0, z, r: 0.08, h: 2.6, mat: 'metal', color: 0x3a3a3a, seg: 6 }); P.box({ x, y: 2.6, z, w: 0.6, h: 0.6, d: 0.05, ry, mat: 'smooth', color: 0xc81e1e, collide: false }); }
    for (const [x, z] of [[-7.5, -12.2], [7.4, 20.2], [-46, 13], [46, -44], [44, 22.6]]) { P.cyl({ x, y: 0, z, r: 0.35, h: 0.9, mat: 'plastic', color: 0x2a3a2a, seg: 10, sight: false }); }
    for (const [x, z] of [[-48, -40], [-48, 40], [48, 10], [20, 48], [-20, -48], [42, -48]]) { crate(P, x, z, r()); crate(P, x + 1.15, z, r(), 0.9); crate(P, x + 0.5, z, r(), 0.7); }

    // where the searchlights stand, and the open ground they sweep
    const streets = [];
    for (let z = -48; z <= 48; z += 6) streets.push([0, z]);
    for (let x = -48; x <= 48; x += 6) if (Math.abs(x) > 4) { streets.push([x, -14]); streets.push([x, 18]); }
    for (let t = -40; t <= 40; t += 8) { streets.push([-49, t]); streets.push([49, t]); streets.push([t, -49]); streets.push([t, 49]); }
    for (const x of [13, 17, 21, 25, 28]) for (const z of [-6, 10]) streets.push([x, z]);
    return {
      spawns: {
        survivor: [[-34, 39], [-30, 39], [-26, 39], [-22, 39], [-34, 42], [-30, 42], [-26, 42], [-22, 42]],
        killer: [[30, -25.8], [47, -10], [0, -40]]
      },
      gens: [[-29, -34.5, 0], [-22, 3.5, PI / 2], [30, -38.5, 0], [41.5, 2, PI / 2], [26, 30, 0]],
      items: [[-38.7, -34.5], [-16, -44], [-30, 1.8], [-35, 28.5], [14, -24], [24, 9], [11, 33], [0, 44]],
      hides: [[-42, -41.5], [-37, -3], [-21, 31], [34, -33], [35, -6], [21.5, 38]],
      spots: { searchlights: lights, streets }
    };
  }
};
