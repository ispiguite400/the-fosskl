/*
 * THE GREAT WAR — the front between the Roblox Army and the Bacon Empire (The Last Guest).
 * Grey morning, ash in the air. The Army's trench to the south, the Empire's to the north,
 * no man's land between: craters, wire, a burning tank, the shell of a church.
 */
import { tree, rock, crate, barrel, sandbags, frame, ruinWall, lamp, tent } from '../prefabs.js';
import { building, tank, barbed, crater, trench } from '../prefabs2.js';

export default {
  id: 'war', name: 'The Great War', film: 'The Last Guest',
  blurb: 'No man\'s land, between the Army and the Empire. Keep your head down.',
  size: [96, 100],
  surface: 'dirt',
  ambience: {
    sky: { top: 0x4a5058, horizon: 0x9a9284, bottom: 0x2a2620, sunDir: [0.2, 0.35, -0.9], sunColor: 0xfff0d8, sunSize: 0.02, stars: 0, clouds: 0.85, cloud: 0x6a6a68 },
    fog: { color: 0x6a665c, density: 0.03 },
    hemi: { sky: 0xa0a8b0, ground: 0x4a4030, intensity: 0.95 },
    sun: { dir: [0.2, 0.55, -0.8], color: 0xfff0d0, intensity: 1.3 },
    envIntensity: 0.6,
    grade: { tint: [1.02, 1.0, 0.94], sat: 0.72, contrast: 1.12 },
    particles: 'ash'
  },
  music: 'war',
  card: { at: [12, 6, 20], look: [0, 3, 0] },
  event: { at: 0.45, kind: 'barrage', title: 'ARTILLERY', text: 'Shells are falling on no man\'s land: watch for the red circles', sound: 'whistle', count: 20, every: 0.5 },
  landmarks: [['the church', 0, 0], ['the Army trench', 0, 30], ['the Empire trench', 0, -30], ['the tank', 22, 6], ['the bunker', -26, 38]],
  build(P, r) {
    P.box({ x: 0, y: -0.5, z: 0, w: 100, h: 0.5, d: 104, mat: 'dirt', color: 0x4e4434, collide: false, cast: false });
    for (let i = 0; i < 26; i++) P.cyl({ x: (r() - 0.5) * 90, y: 0, z: (r() - 0.5) * 94, r: 2 + r() * 5, h: 0.02, mat: 'grass', color: 0x4a4a30, seg: 10, collide: false, cast: false });
    // the trenches: zig-zag lines of sandbag banks, with gaps to climb out through
    const line = (z, flip) => {
      const pts = [[-46, z], [-34, z + flip * 2], [-24, z], [-12, z + flip * 3], [-4, z], [8, z + flip * 2], [20, z], [32, z + flip * 3], [46, z]];
      for (let i = 0; i < pts.length - 1; i++) { if (i === 2 || i === 5) continue; trench(P, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], { w: 3, rows: 5 }); }
    };
    line(30, 1); line(-30, -1);
    // bunkers behind each line
    building(P, -26, 39, 0, { w: 10, d: 7, h: 2.6, mat: 'concrete', color: 0x7a786e, doors: { back: [5], left: [3.5] }, windows: { front: [3, 7] }, floor: { mat: 'planks', color: 0x5a4632 }, lights: [[0, 0]], lightColor: 0xffd8a0, flicker: 0.3 });
    building(P, 24, -39, Math.PI, { w: 10, d: 7, h: 2.6, mat: 'concrete', color: 0x6a6a66, doors: { back: [5], right: [3.5] }, windows: { front: [3, 7] }, floor: { mat: 'planks', color: 0x4a3a2a }, lights: [[0, 0]], lightColor: 0xffb070, flicker: 0.3 });
    // the Army's camp and the Empire's
    tent(P, 10, 41, 0.1, { color: 0x5d6b3e }); tent(P, 18, 41, -0.1, { color: 0x5d6b3e }); tent(P, -12, -41, 0.1, { color: 0x2c4a7a }); tent(P, -4, -41, 0, { color: 0x2c4a7a });
    for (const [x, z] of [[2, 38], [3, 39.2], [-36, -38], [-35, -36.8], [38, 38], [36.8, 39]]) crate(P, x, z, r() * 0.6);
    for (const [x, z] of [[-14, 40], [-13, 41], [30, -40], [31, -41]]) barrel(P, x, z, 0x4a5238);
    // the Empire's banners over their trench
    for (const bx of [-30, 0, 30]) { P.cyl({ x: bx, y: 0, z: -34.5, r: 0.06, h: 4.5, mat: 'metal', color: 0x222222, seg: 6 }); P.box({ x: bx + 0.6, y: 3.1, z: -34.5, w: 1.1, h: 1.4, d: 0.04, mat: 'fabric', color: 0x2c5ab0, collide: false }); P.box({ x: bx + 0.6, y: 3.1, z: -34.47, w: 1.1, h: 0.4, d: 0.02, mat: 'fabric', color: 0x111111, collide: false, cast: false }); }
    // NO MAN'S LAND
    for (const [x, z, s] of [[-30, -10, 2.4], [-18, 12, 3], [-6, -16, 2.2], [12, -8, 2.6], [30, 16, 2.2], [-36, 14, 1.8], [36, -14, 2.4], [6, 18, 1.8], [-14, -4, 1.6], [20, -20, 2]]) crater(P, x, z, s, r);
    for (const [ax, az, bx, bz] of [[-40, 20, -26, 20], [-20, 21, -6, 19], [4, 20, 16, 21], [24, 19, 40, 20], [-40, -20, -28, -21], [-20, -19, -8, -20], [6, -21, 18, -20], [26, -20, 40, -19]]) barbed(P, ax, az, bx, bz);
    tank(P, 22, 6, 0.6, { burning: true, broken: true, gunTurn: 0.4 });
    tank(P, -28, -24, 2.6, { color: 0x3a4a6a, gunTurn: -0.3 });
    // the church: a nave of broken walls, the bell tower still half standing
    {
      const F = frame(0, 0, 0.08);
      ruinWall(P, F, -6, -9, -6, 7, r, { h: 5, color: 0x8a8070, mat: 'brick' });
      ruinWall(P, F, 6, -9, 6, 3, r, { h: 5, color: 0x8a8070, mat: 'brick' });
      ruinWall(P, F, -6, -9, -1.2, -9, r, { h: 5.5, color: 0x8a8070, mat: 'brick' }); ruinWall(P, F, 1.2, -9, 6, -9, r, { h: 5.5, color: 0x8a8070, mat: 'brick' });
      ruinWall(P, F, -6, 7, -2, 7, r, { h: 3, color: 0x8a8070, mat: 'brick' });
      const [tx, tz] = F(4.5, 7);
      P.box({ x: tx, y: 0, z: tz, w: 3, h: 9, d: 3, ry: F.ry, mat: 'brick', color: 0x7a7060 });
      P.wedge({ x: tx, y: 9, z: tz, w: 3.2, h: 1.6, d: 1.6, ry: F.ry, mat: 'slate', color: 0x3a3a3a, collide: false });
      for (let i = 0; i < 5; i++) { const [px, pz] = F(-3 + (i % 2) * 2.5, -6 + i * 2.2); P.box({ x: px, y: 0, z: pz, w: 1.8, h: 0.5, d: 0.5, ry: F.ry + (r() - 0.5) * 0.6, mat: 'wood', color: 0x4a3626, sight: false }); }   // pews
      for (let i = 0; i < 6; i++) { const [px, pz] = F((r() - 0.5) * 10, (r() - 0.5) * 14); P.box({ x: px, y: 0, z: pz, w: 0.6 + r(), h: 0.3 + r() * 0.4, d: 0.5 + r(), ry: r() * 3, mat: 'brick', color: 0x8a8070, collide: false }); }
    }
    // shattered trees, rocks, sandbag nests out in the open
    for (const [tx, tz] of [[-38, 4], [-24, -2], [14, 12], [34, -4], [-10, 22], [16, -28], [-40, -36], [40, 36], [8, -14], [-34, 24]]) tree(P, tx, tz, r, { kind: 'dead', s: 0.9 + r() * 0.4 });
    for (const [x, z] of [[-16, 6], [26, -6], [-40, -6], [40, 4]]) rock(P, x, z, r, 1 + r() * 0.5, 0x5a564e);
    sandbags(P, -16, -10, 0.4, 3.5, 3); sandbags(P, 16, 10, 2.8, 3.5, 3); sandbags(P, 34, 26, -0.3, 3, 3); sandbags(P, -34, -26, 0.2, 3, 3);
    for (const [x, z] of [[-26, 34], [26, -34], [0, 34], [0, -34]]) lamp(P, x, z, { h: 3.2, intensity: 6, distance: 12, color: 0xffc070, flicker: 0.25 });
    return {
      spawns: {
        survivor: [[-6, 40], [-2, 40], [2, 40], [6, 42], [-4, 43], [0, 43], [4, 44], [-8, 43]],
        killer: [[0, -42], [-36, -40], [36, -36]]
      },
      gens: [[-26, 38, 0], [24, -38, Math.PI], [3, -3, 0.08], [-30, -4, 0.5], [32, 10, -0.3]],
      items: [[-28, 37], [26, -37], [-3, 4], [18, 0], [-28, -20], [12, 38], [-38, 10], [38, -26]],
      hides: [[-26, 39], [24, -39], [4.5, 9.5], [-16, -12], [16, 12], [-34, -22]]
    };
  }
};
