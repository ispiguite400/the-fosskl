/*
 * Prefabs: buildings and props made of parts, Roblox style.
 * Every function takes the Parts builder, a position, a turn (radians) and options.
 * Buildings have doorways and windows you can run through, which is what makes loops.
 */
import { TAU } from '../core/util.js';

/** A local frame: place things relative to (x, z) turned by ry. */
export function frame(x, z, ry) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const f = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  f.ry = ry; f.x = x; f.z = z;
  return f;
}
const B = (P, F, lx, y, lz, w, h, d, o) => { const [x, z] = F(lx, lz); P.box(Object.assign({ x, y, z, w, h, d, ry: F.ry + ((o && o.dry) || 0) }, o)); };

/** A wall from local a to b, with openings: [[t0, t1, y0, y1], ...] along its length (metres). */
export function wall(P, F, ax, az, bx, bz, o) {
  const h = o.h || 3.2, th = o.th || 0.3, L = Math.hypot(bx - ax, bz - az), ang = Math.atan2(-(bz - az), bx - ax);
  const cut = (o.open || []).slice().sort((a, b) => a[0] - b[0]);
  const piece = (t0, t1, y0, y1) => {
    if (t1 - t0 < 0.05 || y1 - y0 < 0.05) return;
    const tm = (t0 + t1) / 2, lx = ax + (bx - ax) * tm / L, lz = az + (bz - az) * tm / L;
    const [x, z] = F(lx, lz);
    P.box(Object.assign({}, o, { x, y: y0, z, w: t1 - t0, h: y1 - y0, d: th, ry: F.ry + ang, open: undefined }));
  };
  let t = 0;
  for (const [t0, t1, y0, y1] of cut) {
    piece(t, t0, 0, h);
    piece(t0, t1, 0, y0);                                  // under a window
    piece(t0, t1, y1, h);                                  // over a door or window
    t = t1;
  }
  piece(t, L, 0, h);
}

/** A house: four walls with a door and windows, a floor, a gable roof, maybe burned. */
export function house(P, x, z, ry, o = {}) {
  const F = frame(x, z, ry), w = o.w || 8, d = o.d || 6, h = o.h || 3.2;
  const burned = !!o.burned;
  const wallC = burned ? 0x3a302a : (o.wall || 0xcab79a), trim = burned ? 0x1d1915 : (o.trim || 0x6b4a2e), roofC = burned ? 0x221b17 : (o.roof || 0x7a2e24);
  const wm = { mat: o.mat || (burned ? 'wood' : 'planks'), color: wallC, h, th: 0.3 };
  const hw = w / 2, hd = d / 2, door = o.door || 0;                      // which wall has the door: 0 front (+z)
  wall(P, F, -hw, hd, hw, hd, Object.assign({}, wm, { open: door === 0 ? [[w / 2 - 0.7, w / 2 + 0.7, 0, 2.3], [0.8, 2.0, 1.1, 2.1], [w - 2.0, w - 0.8, 1.1, 2.1]] : [[1.2, 2.6, 1.1, 2.1]] }));
  wall(P, F, hw, -hd, -hw, -hd, Object.assign({}, wm, { open: door === 2 ? [[w / 2 - 0.7, w / 2 + 0.7, 0, 2.3]] : [[w / 2 - 0.8, w / 2 + 0.8, 1.1, 2.1]] }));
  wall(P, F, -hw, -hd, -hw, hd, Object.assign({}, wm, { open: door === 3 ? [[d / 2 - 0.7, d / 2 + 0.7, 0, 2.3]] : [[d / 2 - 0.7, d / 2 + 0.7, 1.1, 2.0]] }));
  wall(P, F, hw, hd, hw, -hd, Object.assign({}, wm, { open: door === 1 ? [[d / 2 - 0.7, d / 2 + 0.7, 0, 2.3]] : [[d / 2 - 0.7, d / 2 + 0.7, 1.1, 2.0]] }));
  // corner posts and a sill band
  for (const [cx, cz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) B(P, F, cx, 0, cz, 0.42, h + 0.1, 0.42, { mat: 'wood', color: trim });
  B(P, F, 0, 0, 0, w - 0.3, 0.12, d - 0.3, { mat: 'planks', color: burned ? 0x2a221d : 0x8a6a48, collide: false, cast: false });
  // the roof: two wedges meeting at the ridge (left whole if not burned, broken open if it is)
  const rh = o.roofH || 1.6, over = 0.4;
  const ridge = [[0, 1], [Math.PI, -1]];                                 // each half tall at the ridge, low at the eave
  for (const [rot, side] of ridge) {
    if (burned && side === 1 && (o.seed || 0) % 2) continue;
    const [rx, rz] = F(0, side * (hd + over) / 2);
    P.wedge({ x: rx, y: h, z: rz, w: w + over * 2, h: rh, d: hd + over, ry: F.ry + rot, mat: o.roofMat || 'slate', color: roofC, collide: false });
  }
  if (!burned) { const [cx, cz] = F(hw * 0.5, -hd * 0.3); P.box({ x: cx, y: h, z: cz, w: 0.7, h: rh + 0.9, d: 0.7, ry: F.ry, mat: 'brick', color: 0x6e4a3e, collide: false }); }
  else {
    // a fire still burning in the ruin
    const [fx, fz] = F(hw * 0.3, -hd * 0.2);
    P.light({ x: fx, y: 1.2, z: fz, color: 0xff7a2a, intensity: 9, distance: 12, flicker: 0.6, glowSize: 2.4 });
    P.box({ x: fx, y: 0, z: fz, w: 1.2, h: 0.35, d: 0.9, ry: F.ry + 0.4, mat: 'wood', color: 0x1a1210, collide: false });
    P.ball({ x: fx, y: 0.5, z: fz, r: 0.42, sy: 1.4, mat: 'neon', color: 0xff6a1a, cast: false });
  }
}

export function fence(P, ax, az, bx, bz, o = {}) {
  const L = Math.hypot(bx - ax, bz - az), ang = Math.atan2(-(bz - az), bx - ax), n = Math.max(1, Math.round(L / 2.2));
  const color = o.color || 0x7a5a3c, h = o.h || 1.1;
  for (let i = 0; i <= n; i++) { const t = i / n; P.box({ x: ax + (bx - ax) * t, y: 0, z: az + (bz - az) * t, w: 0.18, h: h + 0.15, d: 0.18, ry: ang, mat: 'wood', color }); }
  for (const y of [h * 0.35, h * 0.8]) P.box({ x: (ax + bx) / 2, y, z: (az + bz) / 2, w: L, h: 0.12, d: 0.08, ry: ang, mat: 'wood', color, collide: o.collide !== false, sight: false });
  if (o.collide !== false) P.wall({ x: (ax + bx) / 2, z: (az + bz) / 2, w: L, d: 0.25, h, y: 0, ry: ang, sight: false });
}

export function lamp(P, x, z, o = {}) {
  const h = o.h || 3.6, color = o.color || 0xffc98a;
  P.cyl({ x, y: 0, z, r: 0.09, h, mat: 'metal', color: o.pole || 0x2b2b2e, seg: 8 });
  P.box({ x, y: h, z, w: 0.36, h: 0.4, d: 0.36, mat: 'metal', color: 0x1f1f22, collide: false });
  P.box({ x, y: h + 0.05, z, w: 0.28, h: 0.28, d: 0.28, mat: 'neon', color, collide: false, cast: false });
  P.light({ x, y: h - 0.1, z, color, intensity: o.intensity || 7, distance: o.distance || 13, flicker: o.flicker || 0 });
}

export function tree(P, x, z, r, o = {}) {
  const kind = o.kind || 'pine', s = o.s || (0.85 + r() * 0.5);
  if (kind === 'pine') {
    P.cyl({ x, y: 0, z, r: 0.22 * s, rt: 0.16 * s, h: 2 * s, mat: 'wood', color: 0x4a3426, seg: 7 });
    for (let i = 0; i < 3; i++) P.cyl({ x, y: (1.5 + i * 1.25) * s, z, r: (1.8 - i * 0.45) * s, rt: 0.05, h: 2.1 * s, mat: 'grass', color: o.color || 0x2d4a2c, seg: 8, collide: false });
  } else if (kind === 'dead') {
    P.cyl({ x, y: 0, z, r: 0.25 * s, rt: 0.12 * s, h: 4.5 * s, mat: 'wood', color: 0x2e2620, seg: 7 });
    for (let i = 0; i < 3; i++) { const a = r() * TAU; P.cyl({ x: x + Math.cos(a) * 0.6 * s, y: (2.4 + i * 0.7) * s, z: z + Math.sin(a) * 0.6 * s, r: 0.07 * s, h: 1.6 * s, rz: 0.9 * (r() - 0.5) * 2, rx: 0.5, mat: 'wood', color: 0x2e2620, seg: 5, collide: false }); }
  } else {
    P.cyl({ x, y: 0, z, r: 0.3 * s, rt: 0.22 * s, h: 2.6 * s, mat: 'wood', color: 0x4f3a28, seg: 8 });
    P.ball({ x, y: 3.4 * s, z, r: 1.9 * s, sy: 0.85, mat: 'grass', color: o.color || 0x3b5a2c, seg: 9, collide: false });
    P.ball({ x: x + 0.8 * s, y: 3.0 * s, z: z + 0.4 * s, r: 1.3 * s, mat: 'grass', color: o.color2 || 0x456a31, seg: 8, collide: false });
  }
}

export function rock(P, x, z, r, s = 1, color = 0x6e6a66) {
  P.ball({ x, y: 0.15 * s, z, r: 0.9 * s, sy: 0.7, mat: 'rock', color, seg: 7, collide: true, ry: r() * TAU });
  P.ball({ x: x + 0.6 * s, y: 0.1, z: z + 0.3 * s, r: 0.55 * s, sy: 0.6, mat: 'rock', color, seg: 6, collide: false });
}

export const crate = (P, x, z, ry, s = 1, color = 0x8a6a42) => P.box({ x, y: 0, z, w: 1.1 * s, h: 1.1 * s, d: 1.1 * s, ry, mat: 'planks', color, sight: false });
export const barrel = (P, x, z, color = 0x7a4e2e) => P.cyl({ x, y: 0, z, r: 0.42, h: 1.15, mat: 'wood', color, seg: 10, sight: false });

export function cart(P, x, z, ry, o = {}) {
  const F = frame(x, z, ry), c = o.color || 0x6b4a2c;
  B(P, F, 0, 0.6, 0, 2.6, 0.5, 1.5, { mat: 'planks', color: c });
  B(P, F, 0, 1.1, -0.72, 2.6, 0.5, 0.08, { mat: 'planks', color: c, collide: false });
  B(P, F, 0, 1.1, 0.72, 2.6, 0.5, 0.08, { mat: 'planks', color: c, collide: false });
  for (const sx of [-0.9, 0.9]) for (const sz of [-0.82, 0.82]) { const [wx, wz] = F(sx, sz); P.cyl({ x: wx, y: 0.5, z: wz, r: 0.5, h: 0.12, axis: 'z', ry: F.ry, mat: 'wood', color: 0x3a2a1c, seg: 12, collide: false }); }
  if (o.tipped) B(P, F, 1.6, 0, 0, 0.9, 0.9, 0.9, { mat: 'planks', color: 0x8a6a42 });
}

export function sandbags(P, x, z, ry, len = 3, rows = 2, color = 0x9a8a62) {
  const F = frame(x, z, ry), n = Math.round(len / 0.7);
  for (let row = 0; row < rows; row++) for (let i = 0; i < n - (row % 2); i++) {
    const [bx, bz] = F(-len / 2 + 0.35 + i * 0.7 + (row % 2) * 0.35, 0);
    P.box({ x: bx, y: row * 0.32, z: bz, w: 0.66, h: 0.32, d: 0.45, ry: F.ry + (i % 3 - 1) * 0.05, mat: 'fabric', color, collide: false, cast: row === rows - 1 });
  }
  const [cx, cz] = F(0, 0);
  P.wall({ x: cx, z: cz, w: len, d: 0.5, y: 0, h: rows * 0.32, ry: F.ry, sight: rows * 0.32 > 1.4 });
}

export function tent(P, x, z, ry, o = {}) {
  const F = frame(x, z, ry), c = o.color || 0x5d6b3e, w = o.w || 3, d = o.d || 4, h = o.h || 2.2;
  for (const [rot, side] of [[0, 1], [Math.PI, -1]]) { const [tx, tz] = F(side * w / 4, 0); P.wedge({ x: tx, y: 0, z: tz, w: d, h, d: w / 2, ry: F.ry + rot + Math.PI / 2, mat: 'fabric', color: c, collide: false }); }
  const [cx, cz] = F(0, 0); P.wall({ x: cx, z: cz, w: w * 0.8, d: d * 0.9, y: 0, h, ry: F.ry });
}

export function campfire(P, x, z, o = {}) {
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; P.ball({ x: x + Math.cos(a) * 0.75, y: 0.05, z: z + Math.sin(a) * 0.75, r: 0.22, sy: 0.7, mat: 'rock', color: 0x5a5652, seg: 6, collide: false }); }
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI; P.cyl({ x, y: 0.2, z, r: 0.08, h: 1.1, axis: 'x', ry: a, mat: 'wood', color: 0x3a2a1c, seg: 6, collide: false }); }
  P.ball({ x, y: 0.42, z, r: 0.32, sy: 1.5, mat: 'neon', color: 0xff6a1a, cast: false });
  P.light({ x, y: 1.0, z, color: o.color || 0xff8a3a, intensity: o.intensity || 11, distance: 16, flicker: 0.7, glowSize: 3 });
  P.wall({ x, z, r: 0.8, y: 0, h: 0.6, sight: false });
}

export function car(P, x, z, ry, color = 0x7a1f1f, burned = false) {
  const F = frame(x, z, ry), c = burned ? 0x2a2420 : color;
  B(P, F, 0, 0.35, 0, 4.2, 0.75, 1.9, { mat: burned ? 'metal' : 'smooth', color: c });
  B(P, F, -0.2, 1.1, 0, 2.3, 0.6, 1.75, { mat: burned ? 'metal' : 'smooth', color: c, collide: false });
  B(P, F, -0.2, 1.12, 0, 2.2, 0.5, 1.8, { mat: 'glass', color: 0x9ab0c0, collide: false, cast: false });
  for (const sx of [-1.35, 1.35]) for (const sz of [-0.9, 0.9]) { const [wx, wz] = F(sx, sz); P.cyl({ x: wx, y: 0.38, z: wz, r: 0.38, h: 0.28, axis: 'z', ry: F.ry, mat: 'plastic', color: 0x151515, seg: 12, collide: false }); }
  if (!burned) for (const sz of [-0.6, 0.6]) { const [lx, lz] = F(2.1, sz); P.box({ x: lx, y: 0.7, z: lz, w: 0.06, h: 0.16, d: 0.3, ry: F.ry, mat: 'neon', color: 0xfff2c0, collide: false, cast: false }); }
}

export function ruinWall(P, F, ax, az, bx, bz, r, o = {}) {
  // a wall with a ragged, broken top
  const L = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(L / 1.2)), ang = Math.atan2(-(bz - az), bx - ax);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, h = (o.h || 3) * (0.35 + r() * 0.65);
    const [x, z] = F(ax + (bx - ax) * t, az + (bz - az) * t);
    P.box({ x, y: 0, z, w: L / n + 0.02, h, d: o.th || 0.45, ry: F.ry + ang, mat: o.mat || 'brick', color: o.color || 0x7a5d50 });
  }
}

export function bench(P, x, z, ry, color = 0x6b4a2c) {
  const F = frame(x, z, ry);
  B(P, F, 0, 0.45, 0, 1.8, 0.1, 0.5, { mat: 'planks', color, sight: false });
  B(P, F, 0, 0.55, -0.24, 1.8, 0.5, 0.08, { mat: 'planks', color, collide: false });
  for (const sx of [-0.75, 0.75]) B(P, F, sx, 0, 0, 0.1, 0.45, 0.45, { mat: 'metal', color: 0x2a2a2a, collide: false });
}

export function well(P, x, z) {
  P.cyl({ x, y: 0, z, r: 1.1, h: 0.9, mat: 'cobble', color: 0x7a746c, seg: 14 });
  P.cyl({ x, y: 0.88, z, r: 0.85, h: 0.04, mat: 'smooth', color: 0x0d1418, seg: 14, collide: false });
  for (const s of [-1, 1]) P.box({ x: x + s * 0.95, y: 0.9, z, w: 0.15, h: 1.5, d: 0.15, mat: 'wood', color: 0x4a3426, collide: false });
  P.wedge({ x, y: 2.4, z, w: 2.4, h: 0.6, d: 1.6, mat: 'slate', color: 0x5a3326, collide: false });
}
