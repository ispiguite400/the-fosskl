/*
 * GUEST VILLAGE — where the Guests lived, until the Bacon Empire came (The Last Guest).
 * Dusk. Half the houses are still burning; Bacon barricades block the old road.
 */
import { house, fence, lamp, tree, rock, crate, barrel, cart, sandbags, well, frame, ruinWall, bench } from '../prefabs.js';

export default {
  id: 'village', name: 'Guest Village', film: 'The Last Guest',
  blurb: 'The Guests\' home, the night the Bacon Empire burned it.',
  size: [92, 92],
  ambience: {
    sky: { top: 0x1b1630, horizon: 0xd8743a, bottom: 0x2a1a14, sunDir: [0.75, 0.12, -0.45], sunColor: 0xffa060, sunSize: 0.004, stars: 0.4, clouds: 0.55, cloud: 0x3a2228 },
    fog: { color: 0x3a2a2a, density: 0.022 },
    hemi: { sky: 0x6a5a8a, ground: 0x3a2618, intensity: 0.75 },
    sun: { dir: [0.75, 0.35, -0.45], color: 0xffa868, intensity: 1.6 },
    envIntensity: 0.5,
    grade: { tint: [1.04, 0.98, 0.94], sat: 1.05, contrast: 1.08 },
    particles: 'embers'
  },
  music: 'village',
  card: { at: [17, 10, 27], look: [-2, 1, -2] },
  event: { at: 0.45, kind: 'barrage', title: 'AIRSTRIKE', text: 'The Bacon Empire is shelling the village: watch for the red circles', sound: 'siren', count: 16, every: 0.6 },
  landmarks: [['the well', 0, 2], ['the watchtower', -34, -32], ['the barricade', 0, -23], ['the north road', 0, 30]],
  build(P, r) {
    // ground, the dirt road through the middle and the plaza
    P.box({ x: 0, y: -0.5, z: 0, w: 96, h: 0.5, d: 96, mat: 'grass', color: 0x4a5a32, collide: false, cast: false });
    P.box({ x: 0, y: 0, z: 0, w: 6, h: 0.02, d: 92, mat: 'dirt', color: 0x6a5238, collide: false, cast: false });
    P.box({ x: 0, y: 0, z: 2, w: 60, h: 0.02, d: 5, mat: 'dirt', color: 0x6a5238, collide: false, cast: false });
    P.cyl({ x: 0, y: 0, z: 2, r: 9, h: 0.03, mat: 'cobble', color: 0x7a7268, seg: 28, collide: false, cast: false });
    well(P, 0, 2);
    for (const [bx, bz, a] of [[-6, -3, 0.6], [6, 6, -2.4]]) bench(P, bx, bz, a);
    // houses round the plaza and down the road; half burned
    const homes = [
      [-14, -12, 0.08, 0, 0], [-14, 14, Math.PI - 0.06, 1, 0], [14, -13, -0.05, 1, 0], [15, 14, Math.PI + 0.1, 0, 0],
      [-30, -6, Math.PI / 2, 1, 1], [-31, 18, Math.PI / 2 + 0.1, 0, 3], [30, -2, -Math.PI / 2, 1, 2], [31, 22, -Math.PI / 2, 0, 1],
      [-24, -30, 0.2, 1, 0], [2, -32, 0, 0, 2], [24, -30, -0.15, 1, 0], [-8, 34, Math.PI, 1, 3], [16, 36, Math.PI + 0.2, 0, 0]
    ];
    homes.forEach(([x, z, ry, burned, door], i) => house(P, x, z, ry, { burned: !!burned, door, w: 8 + (i % 3), d: 6 + (i % 2), seed: i,
      wall: [0xcab79a, 0xb9c4c8, 0xd3c2a0, 0xa9b39b][i % 4], roof: [0x7a2e24, 0x2f4a6a, 0x5a3a24][i % 3] }));
    // fences along the yards
    fence(P, -22, -20, -6, -20); fence(P, 6, -21, 22, -21); fence(P, -22, 23, -6, 23); fence(P, 7, 25, 23, 25);
    fence(P, -38, -18, -38, 30); fence(P, 38, -14, 38, 34);
    // Bacon barricades on the road: sandbags, a tipped cart, their blue-and-black banners
    sandbags(P, -2.5, -22, 0, 4, 3); sandbags(P, 3, -24, 0.3, 3, 2); sandbags(P, 1, 26, Math.PI, 4.5, 3);
    cart(P, -5, 24, 0.7, { tipped: true }); cart(P, 8, -6, 1.9);
    for (const [bx, bz] of [[-4, -20], [5, 28]]) {
      P.cyl({ x: bx, y: 0, z: bz, r: 0.06, h: 4.2, mat: 'metal', color: 0x222222, seg: 6 });
      P.box({ x: bx + 0.55, y: 2.8, z: bz, w: 1.0, h: 1.3, d: 0.04, mat: 'fabric', color: 0x2c5ab0, collide: false });
      P.box({ x: bx + 0.55, y: 2.8, z: bz + 0.025, w: 1.0, h: 0.4, d: 0.02, mat: 'fabric', color: 0x111111, collide: false, cast: false });
    }
    // a watchtower the Bacons put up over the village
    {
      const F = frame(-34, -32, 0.3);
      for (const [lx, lz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) { const [x, z] = F(lx, lz); P.box({ x, y: 0, z, w: 0.3, h: 6, d: 0.3, ry: F.ry, mat: 'wood', color: 0x4a3426 }); }
      const [cx, cz] = F(0, 0);
      P.box({ x: cx, y: 6, z: cz, w: 3.4, h: 0.25, d: 3.4, ry: F.ry, mat: 'planks', color: 0x6b4a2c, collide: false });
      P.wedge({ x: cx, y: 7.6, z: cz, w: 3.6, h: 1.2, d: 1.8, ry: F.ry, mat: 'slate', color: 0x2f3e5a, collide: false });
      P.light({ x: cx, y: 7.2, z: cz, color: 0xfff1c8, intensity: 6, distance: 22, flicker: 0.05 });
    }
    // lamps, some dead
    for (const [lx, lz, off] of [[4, -14, 0], [-4, 12, 0], [4, 20, 1], [-4, -26, 0], [10, 2, 0], [-10, 2, 1], [20, -4, 0], [-20, 6, 0]]) {
      lamp(P, lx, lz, { flicker: off ? 0.9 : 0.08, intensity: off ? 3 : 7 });
    }
    // trees round the edge, scorched near the fires
    for (let i = 0; i < 46; i++) {
      const a = r() * Math.PI * 2, d = 38 + r() * 6, x = Math.cos(a) * d, z = Math.sin(a) * d;
      tree(P, x, z, r, { kind: r() < 0.35 ? 'dead' : 'pine' });
    }
    for (const [tx, tz] of [[-22, -2], [22, 8], [-10, -40], [26, -20], [-22, 32], [12, 28]]) tree(P, tx, tz, r, { kind: r() < 0.5 ? 'dead' : 'oak' });
    // clutter: crates, barrels, rocks, broken walls
    for (const [cx, cz, a] of [[-8, -8, 0.3], [-9, -9.4, 1.1], [9, 9, 0.6], [20, 16, 0.2], [-20, -14, 0.9], [26, 8, 0.1], [-26, 8, 1.4]]) crate(P, cx, cz, a);
    for (const [bx, bz] of [[-7.6, -6.4], [10.6, 8.2], [21.4, 17.2], [-19, -15.6], [12, -17]]) barrel(P, bx, bz);
    for (const [rx, rz] of [[-36, -10], [35, 30], [-16, 40], [28, -38], [-40, 8]]) rock(P, rx, rz, r, 1 + r() * 0.6);
    { const F = frame(-2, -40, 0); ruinWall(P, F, -6, 0, 6, 0, r, { h: 2.6 }); }
    { const F = frame(36, 6, Math.PI / 2); ruinWall(P, F, -5, 0, 5, 0, r, { h: 2.2 }); }

    return {
      spawns: {
        survivor: [[-3, 8], [3, 8], [-6, 10], [6, 10], [0, 12], [-3, 14], [3, 14], [0, 6]],
        killer: [[-10, -36], [12, 30], [-34, 4]]
      },
      gens: [[-22, 4, 0.2], [22, 10, -0.5], [-18, -24, 0.4], [18, -22, 0.8], [0, 30, 0]],
      items: [[-14, -12], [14, 14], [-30, -6], [31, 22], [2, -32], [8, 2], [-8, 34]],
      hides: [[-14, -12], [14, -13], [-30, -6], [30, -2], [2, -32], [-8, 34]]
    };
  }
};
