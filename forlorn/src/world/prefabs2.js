/*
 * More prefabs: buildings you can go inside, cells, fences, towers, furniture, the war's kit and
 * Limbo's ruins. Same rules as prefabs.js: parts only, world units in metres, a frame to turn things.
 */
import { frame, wall, sandbags } from './prefabs.js';
import { TAU } from '../core/util.js';

const B = (P, F, lx, y, lz, w, h, d, o) => { const [x, z] = F(lx, lz); P.box(Object.assign({ x, y, z, w, h, d, ry: F.ry + ((o && o.dry) || 0) }, o)); };

/**
 * A building: four walls with doorways and windows, a floor, a flat roof that keeps the camera
 * inside, and lamps on the ceiling.
 *   doors: { front: [t, ...], back, left, right }  (metres along that wall)  windows: same
 */
export function building(P, x, z, ry, o = {}) {
  const F = frame(x, z, ry), w = o.w || 12, d = o.d || 10, h = o.h || 3.4, hw = w / 2, hd = d / 2;
  const wm = { mat: o.mat || 'concrete', color: o.color || 0xb8b4aa, h, th: o.th || 0.3 };
  const op = (side, L) => {
    const out = [];
    for (const t of (o.doors && o.doors[side]) || []) out.push([t - (o.doorW || 1.6) / 2, t + (o.doorW || 1.6) / 2, 0, 2.5]);
    for (const t of (o.windows && o.windows[side]) || []) out.push([t - 0.8, t + 0.8, 1.1, 2.2]);
    return out.filter((p) => p[0] > 0.2 && p[1] < L - 0.2);
  };
  wall(P, F, -hw, hd, hw, hd, Object.assign({}, wm, { open: op('front', w) }));
  wall(P, F, hw, -hd, -hw, -hd, Object.assign({}, wm, { open: op('back', w) }));
  wall(P, F, -hw, -hd, -hw, hd, Object.assign({}, wm, { open: op('left', d) }));
  wall(P, F, hw, hd, hw, -hd, Object.assign({}, wm, { open: op('right', d) }));
  B(P, F, 0, 0, 0, w - 0.2, 0.04, d - 0.2, { mat: (o.floor && o.floor.mat) || 'tile', color: (o.floor && o.floor.color) || 0x8a8a84, collide: false, cast: false });
  if (o.roof !== false) {
    B(P, F, 0, h, 0, w + 0.4, 0.3, d + 0.4, { mat: o.roofMat || 'concrete', color: o.roofColor || 0x4a4a4a, sight: false });
    B(P, F, 0, h + 0.3, 0, w + 0.6, 0.12, d + 0.6, { mat: 'metal', color: 0x2a2a2c, collide: false });
  }
  // a trim band at the foot of the walls, outside
  if (o.trim) for (const [ax, az, bx, bz] of [[-hw, hd + 0.17, hw, hd + 0.17], [-hw, -hd - 0.17, hw, -hd - 0.17]]) { const [cx, cz] = F((ax + bx) / 2, (az + bz) / 2); P.box({ x: cx, y: 0, z: cz, w: bx - ax, h: 0.35, d: 0.06, ry: F.ry, mat: 'concrete', color: o.trim, collide: false }); }
  for (const [lx, lz] of o.lights || []) {
    const [px, pz] = F(lx, lz);
    P.box({ x: px, y: h - 0.08, z: pz, w: 1.2, h: 0.06, d: 0.25, ry: F.ry, mat: 'neon', color: o.lightColor || 0xeaf2ff, collide: false, cast: false });
    P.light({ x: px, y: h - 0.4, z: pz, color: o.lightColor || 0xeaf2ff, intensity: o.lightI || 5, distance: 10, flicker: o.flicker || 0, glow: false });
  }
  return F;
}

/** An inside wall from local a to b, with door gaps at the given distances along it. */
export function partition(P, F, ax, az, bx, bz, o = {}) {
  wall(P, F, ax, az, bx, bz, { mat: o.mat || 'concrete', color: o.color || 0xa8a49a, h: o.h || 3.4, th: 0.2, open: (o.doors || []).map((t) => [t - 0.8, t + 0.8, 0, 2.5]) });
}

/** Cell bars between two points: you see through, you do not walk through. */
export function bars(P, ax, az, bx, bz, o = {}) {
  const L = Math.hypot(bx - ax, bz - az), ang = Math.atan2(-(bz - az), bx - ax), n = Math.round(L / 0.16), h = o.h || 3;
  const gap = o.door || null;                     // [t0, t1]: an open cell door
  for (let i = 0; i <= n; i++) {
    const t = i / n, along = t * L;
    if (gap && along > gap[0] && along < gap[1]) continue;
    P.cyl({ x: ax + (bx - ax) * t, y: 0, z: az + (bz - az) * t, r: 0.025, h, mat: 'metal', color: o.color || 0x55585c, seg: 5, collide: false, cast: i % 2 === 0 });
  }
  for (const y of [0.05, h * 0.5, h - 0.08]) P.box({ x: (ax + bx) / 2, y, z: (az + bz) / 2, w: L, h: 0.07, d: 0.07, ry: ang, mat: 'metal', color: o.color || 0x55585c, collide: false });
  const seg = (t0, t1) => { if (t1 - t0 < 0.1) return; const tm = (t0 + t1) / 2 / L; P.wall({ x: ax + (bx - ax) * tm, z: az + (bz - az) * tm, w: t1 - t0, d: 0.15, h, y: 0, ry: ang, sight: false }); };
  if (gap) { seg(0, gap[0]); seg(gap[1], L); } else seg(0, L);
}

/** A chain-link fence with barbed wire on top. */
export function chainFence(P, ax, az, bx, bz, o = {}) {
  const L = Math.hypot(bx - ax, bz - az), ang = Math.atan2(-(bz - az), bx - ax), n = Math.max(1, Math.round(L / 3)), h = o.h || 3.2;
  for (let i = 0; i <= n; i++) { const t = i / n; P.cyl({ x: ax + (bx - ax) * t, y: 0, z: az + (bz - az) * t, r: 0.05, h: h + 0.4, mat: 'metal', color: 0x6a6d70, seg: 6, collide: false }); }
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  P.box({ x: mx, y: 0.1, z: mz, w: L, h: h - 0.1, d: 0.02, ry: ang, mat: 'glass', color: 0x8a9096, collide: false, cast: false });   // the mesh, see-through
  for (const y of [0.1, h * 0.5, h]) P.box({ x: mx, y, z: mz, w: L, h: 0.05, d: 0.05, ry: ang, mat: 'metal', color: 0x6a6d70, collide: false });
  if (o.barbed !== false) P.cyl({ x: mx, y: h + 0.25, z: mz, r: 0.18, h: L, axis: 'x', ry: ang, mat: 'metal', color: 0x5a5d60, seg: 6, open: true, collide: false, cast: false });
  if (o.collide !== false) P.wall({ x: mx, z: mz, w: L, d: 0.2, h, y: 0, ry: ang, sight: false });
}

/** A guard tower on four legs, with a searchlight. */
export function guardTower(P, x, z, ry, o = {}) {
  const F = frame(x, z, ry), h = o.h || 5.5, c = o.color || 0x5a5a56;
  for (const [lx, lz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) B(P, F, lx, 0, lz, 0.3, h, 0.3, { mat: 'metal', color: c });
  for (const y of [h * 0.35, h * 0.7]) for (const [a, b, w2, d2] of [[0, -1.3, 2.6, 0.08], [0, 1.3, 2.6, 0.08], [-1.3, 0, 0.08, 2.6], [1.3, 0, 0.08, 2.6]]) B(P, F, a, y, b, w2, 0.1, d2, { mat: 'metal', color: c, collide: false });
  B(P, F, 0, h, 0, 3.4, 0.25, 3.4, { mat: 'concrete', color: 0x6a6a66, sight: false });
  for (const [a, b, w2, d2] of [[0, -1.6, 3.4, 0.12], [0, 1.6, 3.4, 0.12], [-1.6, 0, 0.12, 3.4], [1.6, 0, 0.12, 3.4]]) B(P, F, a, h + 0.25, b, w2, 1.0, d2, { mat: 'concrete', color: 0x7a7a74, collide: false });
  B(P, F, 0, h + 2.5, 0, 3.8, 0.2, 3.8, { mat: 'metal', color: 0x3a3a3c, collide: false });
  for (const [lx, lz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) B(P, F, lx, h + 1.25, lz, 0.12, 1.3, 0.12, { mat: 'metal', color: c, collide: false });
  const [sx, sz] = F(0, 1.9);
  P.cyl({ x: sx, y: h + 1.5, z: sz, r: 0.3, h: 0.5, axis: 'z', ry: F.ry, mat: 'metal', color: 0x222222, collide: false });
  P.light({ x: sx, y: h + 1.4, z: sz, color: o.light || 0xf4f8ff, intensity: 9, distance: 26, flicker: 0, glowSize: 2.6 });
}

/* ---------- furniture ---------- */
export function bed(P, x, z, ry, o = {}) {
  const F = frame(x, z, ry);
  B(P, F, 0, 0, 0, 0.95, 0.45, 2.0, { mat: 'metal', color: o.frame || 0x7a7e84, sight: false });
  B(P, F, 0, 0.45, 0.05, 0.9, 0.16, 1.85, { mat: 'fabric', color: o.sheet || 0xd8dce0, collide: false });
  B(P, F, 0, 0.6, -0.72, 0.6, 0.12, 0.35, { mat: 'fabric', color: 0xf0f0ee, collide: false });
  B(P, F, 0, 0, -1.0, 0.95, 1.0, 0.06, { mat: 'metal', color: o.frame || 0x7a7e84, collide: false });
}
export function bunk(P, x, z, ry) {
  const F = frame(x, z, ry);
  for (const y of [0.35, 1.45]) { B(P, F, 0, y, 0, 0.9, 0.12, 1.95, { mat: 'metal', color: 0x5a5e62, collide: false }); B(P, F, 0, y + 0.12, 0, 0.85, 0.14, 1.85, { mat: 'fabric', color: 0xb8b0a0, collide: false }); }
  for (const [lx, lz] of [[-0.42, -0.95], [0.42, -0.95], [-0.42, 0.95], [0.42, 0.95]]) B(P, F, lx, 0, lz, 0.06, 2.0, 0.06, { mat: 'metal', color: 0x5a5e62, collide: false });
  const [cx, cz] = F(0, 0); P.wall({ x: cx, z: cz, w: 0.95, d: 2.0, h: 2, y: 0, ry: F.ry, sight: false });
}
export function table(P, x, z, ry, o = {}) {
  const F = frame(x, z, ry), w = o.w || 1.8, d = o.d || 0.9, c = o.color || 0x8a6a48;
  B(P, F, 0, 0.72, 0, w, 0.06, d, { mat: o.mat || 'wood', color: c, collide: false });
  for (const [lx, lz] of [[-w / 2 + 0.08, -d / 2 + 0.08], [w / 2 - 0.08, -d / 2 + 0.08], [-w / 2 + 0.08, d / 2 - 0.08], [w / 2 - 0.08, d / 2 - 0.08]]) B(P, F, lx, 0, lz, 0.07, 0.72, 0.07, { mat: 'metal', color: 0x3a3a3a, collide: false });
  const [cx, cz] = F(0, 0); P.wall({ x: cx, z: cz, w, d, h: 0.78, y: 0, ry: F.ry, sight: false });
  if (o.benches) for (const s of [-1, 1]) { B(P, F, 0, 0.42, s * (d / 2 + 0.35), w, 0.06, 0.32, { mat: o.mat || 'wood', color: c, collide: false }); B(P, F, 0, 0, s * (d / 2 + 0.35), 0.1, 0.42, 0.1, { mat: 'metal', color: 0x3a3a3a, collide: false }); }
}
export function desk(P, x, z, ry, o = {}) {
  const F = frame(x, z, ry);
  B(P, F, 0, 0, 0, 1.2, 0.75, 0.6, { mat: 'wood', color: o.color || 0x9a7a52, sight: false });
  B(P, F, 0, 0, -0.65, 0.45, 0.45, 0.45, { mat: 'plastic', color: o.chair || 0x3a5a8a, collide: false });
  B(P, F, 0, 0.45, -0.85, 0.45, 0.5, 0.06, { mat: 'plastic', color: o.chair || 0x3a5a8a, collide: false });
}
export function lockers(P, F, lx, lz, n, o = {}) {
  for (let i = 0; i < n; i++) {
    const c = o.colors ? o.colors[i % o.colors.length] : (o.color || 0x3a5a8a);
    B(P, F, lx + i * 0.5, 0, lz, 0.48, 1.9, 0.45, { mat: 'metal', color: c, collide: false });
    B(P, F, lx + i * 0.5, 1.5, lz + 0.23, 0.3, 0.05, 0.01, { mat: 'metal', color: 0x1a1a1a, collide: false, cast: false });
  }
  const [cx, cz] = F(lx + (n - 1) * 0.25, lz); P.wall({ x: cx, z: cz, w: n * 0.5, d: 0.5, h: 1.9, y: 0, ry: F.ry });
}
export function bleachers(P, x, z, ry, o = {}) {
  const F = frame(x, z, ry), w = o.w || 10, rows = o.rows || 5;
  for (let i = 0; i < rows; i++) B(P, F, 0, i * 0.45, -i * 0.7, w, 0.45, 0.7, { mat: 'metal', color: i % 2 ? 0x8a8e94 : 0x9aa0a6, collide: false });
  const [cx, cz] = F(0, -(rows - 1) * 0.35); P.wall({ x: cx, z: cz, w, d: rows * 0.7, h: rows * 0.45, y: 0, ry: F.ry });
}
export function shelf(P, x, z, ry, o = {}) {
  const F = frame(x, z, ry), w = o.w || 2;
  B(P, F, 0, 0, 0, w, 2.0, 0.45, { mat: 'metal', color: o.color || 0x6a6e72, sight: true });
  for (let i = 0; i < 4; i++) B(P, F, (i % 2 - 0.5) * w * 0.4, 0.3 + i * 0.45, 0.05, w * 0.35, 0.3, 0.35, { mat: 'planks', color: [0xa08060, 0x8a9aa8, 0xc8b890, 0x7a6a5a][i], collide: false });
}

/* ---------- the war ---------- */
export function tank(P, x, z, ry, o = {}) {
  const F = frame(x, z, ry), c = o.color || 0x4a5238;
  B(P, F, 0, 0.3, 0, 3.2, 0.9, 6.0, { mat: 'metal', color: c });
  for (const s of [-1, 1]) B(P, F, s * 1.75, 0, 0, 0.7, 1.1, 6.4, { mat: 'metal', color: 0x2a2a26 });
  B(P, F, 0, 1.2, -0.4, 2.2, 0.8, 2.6, { mat: 'metal', color: c, collide: false, rx: 0 });
  const [bx, bz] = F(0, 1.6);
  P.cyl({ x: bx, y: 1.55, z: bz, r: 0.13, h: 3.2, axis: 'z', ry: F.ry + (o.gunTurn || 0), rx: o.broken ? -0.25 : 0, mat: 'metal', color: 0x3a3e2c, collide: false });
  if (o.burning) { const [fx, fz] = F(0.5, -1.5); P.light({ x: fx, y: 2.2, z: fz, color: 0xff7a2a, intensity: 8, distance: 12, flicker: 0.7, glowSize: 2.2 }); P.ball({ x: fx, y: 2.1, z: fz, r: 0.4, sy: 1.4, mat: 'neon', color: 0xff6a1a, cast: false }); }
}
export function barbed(P, ax, az, bx, bz) {
  const L = Math.hypot(bx - ax, bz - az), ang = Math.atan2(-(bz - az), bx - ax), n = Math.max(1, Math.round(L / 2));
  for (let i = 0; i <= n; i++) { const t = i / n; P.box({ x: ax + (bx - ax) * t, y: 0, z: az + (bz - az) * t, w: 0.08, h: 1.0, d: 0.08, ry: ang + 0.785, mat: 'wood', color: 0x4a3a2a, collide: false }); }
  P.cyl({ x: (ax + bx) / 2, y: 0.5, z: (az + bz) / 2, r: 0.45, h: L, axis: 'x', ry: ang, mat: 'metal', color: 0x4a4a48, seg: 7, open: true, collide: false, cast: false });
  P.wall({ x: (ax + bx) / 2, z: (az + bz) / 2, w: L, d: 0.8, h: 0.9, y: 0, ry: ang, sight: false });
}
export function crater(P, x, z, r, rnd) {
  const n = 9;
  for (let i = 0; i < n; i++) { const a = i / n * TAU + rnd() * 0.3; P.ball({ x: x + Math.cos(a) * r, y: -0.05, z: z + Math.sin(a) * r, r: r * 0.42, sy: 0.35, mat: 'dirt', color: 0x4a3e30, seg: 7, collide: false }); }
  P.cyl({ x, y: 0, z, r: r * 0.85, h: 0.025, mat: 'dirt', color: 0x2a2219, seg: 16, collide: false, cast: false });
}
/** A trench line: two banks of sandbags with a walkway between. */
export function trench(P, ax, az, bx, bz, o = {}) {
  const L = Math.hypot(bx - ax, bz - az), ang = Math.atan2(-(bz - az), bx - ax), nx = -(bz - az) / L, nz = (bx - ax) / L, w = o.w || 2.4;
  for (const s of [-1, 1]) sandbags(P, (ax + bx) / 2 + nx * s * w / 2, (az + bz) / 2 + nz * s * w / 2, ang, L, o.rows || 5);
  P.box({ x: (ax + bx) / 2, y: 0, z: (az + bz) / 2, w: L, h: 0.03, d: w - 0.4, ry: ang, mat: 'planks', color: 0x5a4632, collide: false, cast: false });
}

/* ---------- Limbo ---------- */
export function pillar(P, x, z, rnd, o = {}) {
  const h = o.h || (3 + rnd() * 6), r = o.r || (0.6 + rnd() * 0.4);
  P.cyl({ x, y: 0, z, r, rt: r * 0.92, h, mat: 'marble', color: o.color || 0x2a2630, seg: 10 });
  P.cyl({ x, y: 0, z, r: r * 1.25, h: 0.4, mat: 'marble', color: o.color || 0x2a2630, seg: 10, collide: false });
  if (!o.broken) P.cyl({ x, y: h, z, r: r * 1.2, h: 0.35, mat: 'marble', color: o.color || 0x2a2630, seg: 10, collide: false });
  if (o.glow) P.cyl({ x, y: h * 0.4, z, r: r * 1.01, h: 0.08, mat: 'neon', color: o.glow, seg: 10, collide: false, cast: false });
}
export function monolith(P, x, z, ry, o = {}) {
  const F = frame(x, z, ry), h = o.h || 6;
  B(P, F, 0, 0, 0, o.w || 1.6, h, 0.6, { mat: 'rock', color: o.color || 0x14121a });
  B(P, F, 0, h * 0.25, 0.31, 0.08, h * 0.55, 0.02, { mat: 'neon', color: o.glow || 0xffd21f, collide: false, cast: false });
}
export function crystal(P, x, z, rnd, color = 0xb48cff) {
  for (let i = 0; i < 4; i++) { const a = rnd() * TAU, h = 0.8 + rnd() * 1.8; P.cyl({ x: x + Math.cos(a) * 0.4, y: 0, z: z + Math.sin(a) * 0.4, r: 0.22, rt: 0.02, h, rx: (rnd() - 0.5) * 0.6, rz: (rnd() - 0.5) * 0.6, mat: 'neon', color, seg: 5, collide: false, cast: false }); }
  P.wall({ x, z, r: 0.7, y: 0, h: 1.5, sight: false });
  P.light({ x, y: 1.2, z, color, intensity: 1.2, distance: 8, glowSize: 1.4 });
}
