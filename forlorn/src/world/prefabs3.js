/*
 * City prefabs, for Bacon City (The Bacon Hair): tenements with lit windows, tin shacks, the
 * Wall and its towers, street lights, burning barrels, dumpsters, washing lines, roadblocks,
 * and signs with words on them (neon, screens and posters, drawn on a canvas).
 * Same rules as prefabs.js: parts only, world units in metres, a frame to turn things.
 */
import * as THREE from 'three';
import { frame, barrel } from './prefabs.js';
import { building } from './prefabs2.js';

const B = (P, F, lx, y, lz, w, h, d, o) => { const [x, z] = F(lx, lz); P.box(Object.assign({ x, y, z, w, h, d, ry: F.ry + ((o && o.dry) || 0) }, o)); };

/* ---------- signs ---------- */
const FONT = '"Bebas Neue", Impact, "Arial Narrow", sans-serif';
/**
 * A flat sign facing local +z: kind 'neon' (glowing letters, no board), 'screen' (a lit display),
 * or 'poster' (paper, lit by the scene). lines: one string, or an array of strings.
 */
export function sign(P, x, y, z, ry, w, h, lines, o = {}) {
  const kind = o.kind || 'neon', text = Array.isArray(lines) ? lines : [lines];
  const px = 96, cw = Math.round(w * px), ch = Math.round(h * px);
  const c = document.createElement('canvas'); c.width = Math.min(1024, cw); c.height = Math.min(1024, Math.round(ch * c.width / cw));
  const g = c.getContext('2d'), W = c.width, H = c.height, col = o.color || '#ff3a3a';
  if (kind === 'screen') {
    g.fillStyle = o.bg || '#16050a'; g.fillRect(0, 0, W, H);
    const gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7); gr.addColorStop(0, 'rgba(255,60,60,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.strokeStyle = col; g.lineWidth = Math.max(4, H * 0.04); g.strokeRect(g.lineWidth, g.lineWidth, W - g.lineWidth * 2, H - g.lineWidth * 2);
  } else if (kind === 'poster') {
    g.fillStyle = o.bg || '#d8d0bc'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) { g.fillStyle = 'rgba(60,40,20,' + (Math.random() * 0.08) + ')'; g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 20, 2 + Math.random() * 20); }
    g.fillStyle = o.band || '#9a1414'; g.fillRect(0, 0, W, H * 0.22); g.fillRect(0, H * 0.9, W, H * 0.1);
  } else g.clearRect(0, 0, W, H);
  const n = text.length, lh = H * (kind === 'poster' ? 0.6 : 0.8) / n;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const t = text[i], big = i === 0;
    let size = lh * (big ? 0.95 : 0.75);
    g.font = size + 'px ' + FONT;
    const m = g.measureText(t).width; if (m > W * 0.9) { size *= W * 0.9 / m; g.font = size + 'px ' + FONT; }
    const yy = kind === 'poster' ? H * 0.28 + lh * (i + 0.5) : H / 2 + (i - (n - 1) / 2) * lh;
    if (kind === 'poster' && i === 0) { g.fillStyle = '#f2ece0'; g.fillText(t, W / 2, H * 0.115); continue; }
    if (kind !== 'poster') { g.shadowColor = col; g.shadowBlur = size * 0.35; }
    g.fillStyle = kind === 'poster' ? '#1a1414' : (big ? (o.ink || '#ffffff') : col);
    g.fillText(t, W / 2, yy);
    if (kind === 'neon') { g.shadowBlur = size * 0.12; g.fillStyle = col; g.globalAlpha = 0.55; g.fillText(t, W / 2, yy); g.globalAlpha = 1; }
    g.shadowBlur = 0;
  }
  if (kind === 'screen') { g.fillStyle = 'rgba(0,0,0,0.22)'; for (let yy = 0; yy < H; yy += 4) g.fillRect(0, yy, W, 1); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const geo = new THREE.PlaneGeometry(w, h);
  const mat = kind === 'poster'
    ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 })
    : new THREE.MeshBasicMaterial({ map: tex, transparent: kind === 'neon', depthWrite: kind !== 'neon', fog: true });
  if (kind !== 'poster') mat.color.setScalar(o.glow || (kind === 'neon' ? 2.4 : 1.5));
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.y = ry;
  m.matrixAutoUpdate = false; m.updateMatrix();
  P.extra.push(m);
  // a lit sign throws a little of its colour onto the street
  if (kind !== 'poster' && o.light !== false) { const [lx, lz] = frame(x, z, ry)(0, 1.2); P.light({ x: lx, y: y - h * 0.2, z: lz, color: o.lightColor || new THREE.Color(col).getHex(), intensity: o.lightI || 3.5, distance: 9, flicker: o.flicker || 0, glow: false }); }
  return m;
}

/* ---------- buildings ---------- */
const LIT = [0xffc77a, 0xffd9a0, 0x9ab8ff, 0xffb060];
/**
 * A tenement block: a ground floor you can run through (doors and windows) under storeys you
 * cannot reach, with rows of windows (a few lit), a parapet, a water tank and fire escapes.
 */
export function tenement(P, x, z, ry, r, o = {}) {
  const w = o.w || 16, d = o.d || 10, gh = 3.6, floors = o.floors || 3, H = gh + floors * 3, hw = w / 2, hd = d / 2;
  const color = o.color || 0x7a4a3a;
  const F = building(P, x, z, ry, { w, d, h: gh, mat: 'brick', color, doors: o.doors || { front: [w / 2], back: [w / 2] }, windows: o.windows || { front: [2.2, w - 2.2], back: [2.2, w - 2.2], left: [d / 2], right: [d / 2] }, floor: { mat: 'planks', color: 0x5a4636 }, lights: o.lights || [[-hw / 2, 0], [hw / 2, 0]], lightColor: 0xffd29a, lightI: 4, flicker: o.flicker || 0.15, roof: true, roofMat: 'concrete', roofColor: 0x3a3634 });
  // the storeys above: one shell, a ledge per floor
  B(P, F, 0, gh + 0.3, 0, w + 0.1, H - gh - 0.3, d + 0.1, { mat: 'brick', color, collide: false });
  for (let f = 0; f <= floors; f++) B(P, F, 0, gh + f * 3, 0, w + 0.35, 0.18, d + 0.35, { mat: 'concrete', color: 0x6a625a, collide: false, cast: false });
  B(P, F, 0, H, 0, w + 0.3, 0.9, d + 0.3, { mat: 'brick', color: 0x5a3a2e, collide: false });
  // windows on every face of every upper floor
  const faces = [[0, hd + 0.08, w, 0], [0, -hd - 0.08, w, Math.PI], [-hw - 0.08, 0, d, -Math.PI / 2], [hw + 0.08, 0, d, Math.PI / 2]];
  for (const [fx, fz, L, rot] of faces) {
    const n = Math.max(1, Math.floor(L / 2.6));
    for (let f = 0; f < floors; f++) for (let i = 0; i < n; i++) {
      const t = -L / 2 + (i + 0.5) * L / n, lit = r() < (o.lit || 0.22);
      const lx = rot === 0 || rot === Math.PI ? fx + t : fx, lz = rot === 0 || rot === Math.PI ? fz : fz + t;
      B(P, F, lx, gh + 0.9 + f * 3, lz, rot === 0 || rot === Math.PI ? 1.1 : 0.06, 1.5, rot === 0 || rot === Math.PI ? 0.06 : 1.1, { mat: lit ? 'neon' : 'glass', color: lit ? LIT[(r() * LIT.length) | 0] : 0x141a22, collide: false, cast: false });
    }
  }
  // a fire escape on the front: landings and a ladder
  if (o.escape !== false) {
    const ex = (o.escapeAt || 0.25) * w - hw;
    for (let f = 1; f <= floors; f++) {
      B(P, F, ex, gh + (f - 1) * 3 + 0.05, hd + 0.75, 3, 0.08, 1.3, { mat: 'metal', color: 0x2a2a2c, collide: false });
      B(P, F, ex, gh + (f - 1) * 3 + 0.9, hd + 1.38, 3, 0.06, 0.06, { mat: 'metal', color: 0x2a2a2c, collide: false, cast: false });
      B(P, F, ex + 1.2, gh + (f - 1) * 3 - 3 + 0.1, hd + 1.0, 0.5, 3, 0.06, { mat: 'metal', color: 0x2a2a2c, collide: false, cast: false, rx: 0.5 });
    }
  }
  // the water tank on the roof
  if (o.tank !== false) {
    const [tx, tz] = F(hw * 0.45, -hd * 0.3);
    for (const [a, b] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) P.cyl({ x: tx + a, y: H + 0.9, z: tz + b, r: 0.08, h: 1.4, mat: 'metal', color: 0x2a2624, seg: 5, collide: false });
    P.cyl({ x: tx, y: H + 2.3, z: tz, r: 1.25, h: 2.2, mat: 'wood', color: 0x4a3426, seg: 12, collide: false });
    P.cyl({ x: tx, y: H + 4.5, z: tz, r: 1.35, rt: 0.1, h: 0.8, mat: 'metal', color: 0x2a2a2a, seg: 12, collide: false });
  }
  return Object.assign(F, { H });
}

/** A tin shack: corrugated walls you can run through, a sloped tin roof. */
export function shack(P, x, z, ry, r, o = {}) {
  const w = o.w || 4.2, d = o.d || 3.6, h = 2.6;
  const col = o.color || [0x7a4a32, 0x5a6a6a, 0x6a5a40, 0x4a5a4a][(r() * 4) | 0];
  const F = building(P, x, z, ry, { w, d, h, mat: 'metal', color: col, doors: o.doors || { front: [w / 2] }, windows: o.windows || { back: [w / 2] }, floor: { mat: 'dirt', color: 0x3a3028 }, lights: r() < 0.45 ? [[0, 0]] : [], lightColor: 0xffb070, lightI: 3, flicker: 0.4, roof: false });
  // the roof: one tin sheet, tilted, with a lip; it blocks sight like a roof
  B(P, F, 0, h, 0, w + 0.7, 0.12, d + 0.7, { mat: 'metal', color: o.roof || 0x6a4a3a, collide: false, rx: 0.12 });
  B(P, F, 0, h, 0, w, 0.3, d, { mat: 'metal', color: 0x2a2a2a, collide: true, sight: false, cast: false });
  return F;
}

/* ---------- the Wall ---------- */
/** A stretch of the city Wall from a to b: tall concrete, buttresses, a walkway, red lamps on top. */
export function cityWall(P, ax, az, bx, bz, o = {}) {
  const L = Math.hypot(bx - ax, bz - az), ang = Math.atan2(-(bz - az), bx - ax), h = o.h || 18, th = o.th || 2.4;
  const ux = (bx - ax) / L, uz = (bz - az) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
  let nx = -uz, nz = ux; if (nx * mx + nz * mz > 0) { nx = -nx; nz = -nz; }        // n points into the city (towards 0, 0)
  P.box({ x: mx, y: 0, z: mz, w: L, h, d: th, ry: ang, mat: 'concrete', color: o.color || 0x6c6a66, sight: true });
  P.box({ x: mx + nx * (th / 2 + 0.05), y: 0, z: mz + nz * (th / 2 + 0.05), w: L, h: 1.2, d: 0.12, ry: ang, mat: 'concrete', color: 0x4a4846, collide: false, cast: false });   // a stained foot
  P.box({ x: mx, y: h, z: mz, w: L, h: 1.1, d: th + 0.8, ry: ang, mat: 'concrete', color: 0x5a5856, collide: false });                   // the cap
  // buttresses and warning lamps every few metres
  const n = Math.max(1, Math.floor(L / (o.every || 12)));
  for (let i = 0; i <= n; i++) {
    const t = i / n, px = ax + (bx - ax) * t + nx * (th / 2 + 0.6), pz = az + (bz - az) * t + nz * (th / 2 + 0.6);
    P.box({ x: px, y: 0, z: pz, w: 1.6, h: h - 1, d: 1.2, ry: ang, mat: 'concrete', color: 0x605e5a });
    P.box({ x: px, y: h - 2.2, z: pz + 0, w: 0.3, h: 0.3, d: 0.3, ry: ang, mat: 'neon', color: 0xff2a1a, collide: false, cast: false });
  }
  // hazard stripes at the foot, a band of rust
  P.box({ x: mx + nx * (th / 2 + 0.07), y: 1.2, z: mz + nz * (th / 2 + 0.07), w: L, h: 0.35, d: 0.04, ry: ang, mat: 'smooth', color: 0x8a6a20, collide: false, cast: false });
}
/** A watch tower on the Wall, with its searchlight. Returns the lamp's position. */
export function wallTower(P, x, z, ry, o = {}) {
  const F = frame(x, z, ry), y0 = o.y || 18;
  B(P, F, 0, 0, 0, 5, y0, 5, { mat: 'concrete', color: 0x646260 });
  B(P, F, 0, y0, 0, 5.6, 3.2, 5.6, { mat: 'concrete', color: 0x585654, collide: false });
  for (const [lx, lz, w2, d2] of [[0, 2.85, 4, 0.1], [0, -2.85, 4, 0.1], [2.85, 0, 0.1, 4], [-2.85, 0, 0.1, 4]]) B(P, F, lx, y0 + 1.4, lz, w2, 1.1, d2, { mat: 'neon', color: 0xffe2a0, collide: false, cast: false });
  B(P, F, 0, y0 + 3.2, 0, 6.4, 0.4, 6.4, { mat: 'metal', color: 0x2a2a2c, collide: false });
  B(P, F, 0, y0 + 3.6, 0, 0.18, 2.4, 0.18, { mat: 'metal', color: 0x2a2a2c, collide: false });
  B(P, F, 0, y0 + 5.9, 0, 0.35, 0.35, 0.35, { mat: 'neon', color: 0xff2a1a, collide: false, cast: false });
  const [sx, sz] = F(0, 3.1);
  P.cyl({ x: sx, y: y0 + 0.4, z: sz, r: 0.55, h: 0.9, axis: 'z', ry: F.ry, mat: 'metal', color: 0x1a1a1a, collide: false });
  P.light({ x: sx, y: y0 + 0.4, z: sz, color: 0xf4f8ff, intensity: 6, distance: 24, flicker: 0, glowSize: 3.4 });
  return [sx, y0 + 0.4, sz];
}

/* ---------- street things ---------- */
/** A sodium street light on an arm (or a dead one). */
export function streetLight(P, x, z, ry, o = {}) {
  const F = frame(x, z, ry), h = o.h || 6, color = o.color || 0xffa850;
  P.cyl({ x, y: 0, z, r: 0.11, h, mat: 'metal', color: 0x2a2c2e, seg: 8 });
  B(P, F, 0, h - 0.1, 0.9, 0.14, 0.14, 1.9, { mat: 'metal', color: 0x2a2c2e, collide: false });
  B(P, F, 0, h - 0.3, 1.7, 0.45, 0.22, 0.7, { mat: 'metal', color: 0x1f2022, collide: false });
  const [lx, lz] = F(0, 1.7);
  if (o.dead) return;
  P.box({ x: lx, y: h - 0.36, z: lz, w: 0.36, h: 0.06, d: 0.55, ry: F.ry, mat: 'neon', color: new THREE.Color(color).multiplyScalar(0.5).getHex(), collide: false, cast: false });
  P.light({ x: lx, y: h - 0.6, z: lz, color, intensity: o.intensity || 8, distance: o.distance || 15, flicker: o.flicker || 0, glowSize: 1.0 });
}
/** An oil drum with a fire in it, where the homeless keep warm. */
export function burnBarrel(P, x, z) {
  barrel(P, x, z, 0x3a2a22);
  P.ball({ x, y: 1.15, z, r: 0.26, sy: 1.4, mat: 'neon', color: 0xc8501a, cast: false });
  P.light({ x, y: 1.8, z, color: 0xff8a3a, intensity: 4.5, distance: 10, flicker: 0.6, glowSize: 1.3 });
}
export function dumpster(P, x, z, ry, color = 0x2e4a34) {
  const F = frame(x, z, ry);
  B(P, F, 0, 0.15, 0, 2.2, 1.3, 1.3, { mat: 'metal', color, sight: false });
  B(P, F, 0, 1.45, -0.1, 2.25, 0.08, 1.45, { mat: 'plastic', color: 0x1a1a1a, collide: false, rx: -0.2 });
  for (const sx of [-0.9, 0.9]) for (const sz of [-0.5, 0.5]) { const [wx, wz] = F(sx, sz); P.cyl({ x: wx, y: 0, z: wz, r: 0.08, h: 0.15, mat: 'plastic', color: 0x111111, seg: 6, collide: false }); }
}
/** A washing line between two points, with clothes on it. */
export function washLine(P, ax, az, bx, bz, y, r) {
  const L = Math.hypot(bx - ax, bz - az), ang = Math.atan2(-(bz - az), bx - ax);
  P.cyl({ x: (ax + bx) / 2, y, z: (az + bz) / 2, r: 0.015, h: L, axis: 'x', ry: ang, mat: 'plastic', color: 0xcfc8b8, seg: 4, collide: false, cast: false });
  const n = Math.floor(L / 0.9);
  for (let i = 1; i < n; i++) {
    if (r() < 0.3) continue;
    const t = i / n, h = 0.4 + r() * 0.5;
    P.box({ x: ax + (bx - ax) * t, y: y - h, z: az + (bz - az) * t, w: 0.45 + r() * 0.3, h, d: 0.03, ry: ang, mat: 'fabric', color: [0xb83a3a, 0x3a6ab8, 0xd8d0c0, 0x5a8a4a, 0xd8a83a, 0x6a4a8a][(r() * 6) | 0], collide: false });
  }
}
/** A striped roadblock. */
export function roadblock(P, x, z, ry, len = 3) {
  const F = frame(x, z, ry), n = Math.round(len / 0.5);
  for (let i = 0; i < n; i++) B(P, F, -len / 2 + (i + 0.5) * len / n, 0.6, 0, len / n, 0.3, 0.12, { mat: 'smooth', color: i % 2 ? 0xd8d8d0 : 0xc81e1e, collide: false });
  for (const s of [-1, 1]) B(P, F, s * (len / 2 - 0.15), 0, 0, 0.12, 0.9, 0.5, { mat: 'metal', color: 0x2a2a2a, collide: false });
  const [cx, cz] = F(0, 0); P.wall({ x: cx, z: cz, w: len, d: 0.4, h: 0.9, y: 0, ry: F.ry, sight: false });
}
/** Cardboard and a tarp: where someone sleeps. */
export function camp(P, x, z, ry, r) {
  const F = frame(x, z, ry);
  B(P, F, 0, 0.02, 0, 0.9, 0.12, 2, { mat: 'fabric', color: [0x4a5a3a, 0x5a3a3a, 0x3a4a6a][(r() * 3) | 0], collide: false });
  for (let i = 0; i < 3; i++) B(P, F, 0.9 + r() * 0.6, 0, -0.6 + i * 0.6, 0.5 + r() * 0.3, 0.4 + r() * 0.3, 0.5, { mat: 'planks', color: 0x9a7a52, collide: false, dry: r() });
  const [tx, tz] = F(-0.2, 0); P.wedge({ x: tx, y: 0, z: tz, w: 2.2, h: 1.3, d: 1.4, ry: F.ry + Math.PI / 2, mat: 'fabric', color: 0x2a4a6a, collide: false });
}
/** A pipe run between two points at a height. */
export function pipe(P, ax, az, bx, bz, y, rad = 0.3, color = 0x5a5a56) {
  const L = Math.hypot(bx - ax, bz - az), ang = Math.atan2(-(bz - az), bx - ax);
  P.cyl({ x: (ax + bx) / 2, y, z: (az + bz) / 2, r: rad, h: L, axis: 'x', ry: ang, mat: 'metal', color, seg: 10, collide: false });
  for (const t of [0.15, 0.5, 0.85]) { const x = ax + (bx - ax) * t, z = az + (bz - az) * t; if (y > 0.5) P.box({ x, y: 0, z, w: 0.25, h: y, d: 0.25, mat: 'metal', color: 0x3a3a38 }); }
}
/** A storage tank on a plinth, with a ladder. */
export function bigTank(P, x, z, rad, h, color = 0x8a8a84) {
  P.cyl({ x, y: 0, z, r: rad + 0.3, h: 0.4, mat: 'concrete', color: 0x5a5856, seg: 20 });
  P.cyl({ x, y: 0.4, z, r: rad, h, mat: 'metal', color, seg: 20, sight: true });
  P.cyl({ x, y: 0.4 + h, z, r: rad, rt: rad * 0.2, h: rad * 0.35, mat: 'metal', color, seg: 20, collide: false });
  P.box({ x: x + rad + 0.05, y: 0.4, z, w: 0.08, h, d: 0.5, mat: 'metal', color: 0x2a2a2a, collide: false, cast: false });
  for (const y of [h * 0.3, h * 0.6]) P.cyl({ x, y: 0.4 + y, z, r: rad + 0.03, h: 0.12, mat: 'metal', color: 0x4a4a46, seg: 20, open: true, collide: false, cast: false });
}
