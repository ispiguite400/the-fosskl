/*
 * Roblox-style part materials, painted procedurally at load.
 *
 * Every map is built from "parts" like a Roblox place: a box (or wedge, cylinder,
 * ball) with a material and a colour. Each material here is a neutral detail
 * texture (multiplied by the part's colour) plus a normal map worked out from
 * its height, so bricks, planks and plates catch the light.
 *
 *   material(name) -> THREE.MeshStandardMaterial (vertex colours carry the tint)
 *   MATS[name].tile  metres per texture repeat
 */
import * as THREE from 'three';
import { rng, clamp } from '../core/util.js';

const SIZE = 256;

// a height field (0..1) and an albedo (0..1 grey with optional hue) per material
const PAINT = {
  plastic(h, a, r) { fill(h, (x, y) => 0.5 + (r() - 0.5) * 0.02); fill(a, (x, y) => 0.92 + noiseAt(x, y, 24) * 0.08); },
  smooth(h, a) { fill(h, () => 0.5); fill(a, (x, y) => 0.96 + noiseAt(x, y, 40) * 0.04); },
  wood(h, a, r) {
    const off = r() * 10;
    fill(a, (x, y) => { const g = Math.sin((y / SIZE * 26 + noiseAt(x, y, 18) * 3.2 + off) * Math.PI); return 0.72 + 0.16 * g + noiseAt(x, y, 90) * 0.12; });
    fill(h, (x, y) => 0.5 + 0.08 * Math.sin((y / SIZE * 26 + noiseAt(x, y, 18) * 3.2 + off) * Math.PI));
  },
  planks(h, a, r) {
    const rows = 4, rowH = SIZE / rows, shade = [...Array(rows * 3)].map(() => 0.78 + r() * 0.2), cut = [...Array(rows)].map(() => r() * SIZE);
    fill(a, (x, y) => {
      const row = Math.floor(y / rowH), ry = y - row * rowH, cx = (x + cut[row]) % SIZE;
      const gap = ry < 3 || cx < 3 ? 0.35 : 1;
      const grain = Math.sin((ry / rowH * 9 + noiseAt(x, y, 30) * 2.5 + row) * Math.PI) * 0.07;
      return (shade[row * 3 + (cx > SIZE / 2 ? 1 : 0)] + grain + noiseAt(x, y, 120) * 0.08) * gap;
    });
    fill(h, (x, y) => { const row = Math.floor(y / rowH), ry = y - row * rowH, cx = (x + cut[row]) % SIZE; return ry < 3 || cx < 3 ? 0.1 : 0.6 + noiseAt(x, y, 60) * 0.1; });
  },
  brick(h, a, r) {
    const bh = SIZE / 8, bw = SIZE / 4, shade = [...Array(64)].map(() => 0.72 + r() * 0.26);
    const info = (x, y) => { const row = Math.floor(y / bh), off = row % 2 ? bw / 2 : 0, col = Math.floor((x + off) / bw), lx = (x + off) % bw, ly = y % bh; return { row, col, mortar: lx < 4 || ly < 4 }; };
    fill(a, (x, y) => { const b = info(x, y); return b.mortar ? 0.78 : shade[(b.row * 5 + b.col) % 64] + noiseAt(x, y, 70) * 0.1 - 0.05; });
    fill(h, (x, y) => { const b = info(x, y); return b.mortar ? 0.15 : 0.7 + noiseAt(x, y, 50) * 0.15; });
  },
  concrete(h, a, r) { fill(a, (x, y) => 0.8 + noiseAt(x, y, 30) * 0.12 + noiseAt(x, y, 140) * 0.1 - (r() < 0.004 ? 0.25 : 0)); fill(h, (x, y) => 0.5 + noiseAt(x, y, 90) * 0.2); },
  cobble(h, a, r) {
    const pts = [...Array(40)].map(() => [r() * SIZE, r() * SIZE, 0.7 + r() * 0.25]);
    const cell = (x, y) => { let d1 = 1e9, d2 = 1e9, best = 0; for (let i = 0; i < pts.length; i++) for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { const dx = x - pts[i][0] - ox * SIZE, dy = y - pts[i][1] - oy * SIZE, d = dx * dx + dy * dy; if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d; } return { e: Math.sqrt(d2) - Math.sqrt(d1), s: pts[best][2] }; };
    const cache = new Float32Array(SIZE * SIZE * 2);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) { const c = cell(x, y); cache[(y * SIZE + x) * 2] = c.e; cache[(y * SIZE + x) * 2 + 1] = c.s; }
    fill(a, (x, y) => { const e = cache[(y * SIZE + x) * 2]; return e < 3 ? 0.45 : cache[(y * SIZE + x) * 2 + 1] + noiseAt(x, y, 60) * 0.08; });
    fill(h, (x, y) => clamp(cache[(y * SIZE + x) * 2] / 12, 0, 1));
  },
  metal(h, a, r) { fill(a, (x, y) => 0.8 + noiseAt(x * 0.05, y * 4, 8) * 0.12 + noiseAt(x, y, 200) * 0.05); fill(h, (x, y) => 0.5 + noiseAt(x * 0.05, y * 4, 8) * 0.05); },
  dplate(h, a) {
    const s = 32;
    const bump = (x, y) => { const cx = (x % s) - s / 2, cy = (y % s) - s / 2, u = (cx + cy) / s, v = (cx - cy) / s; return Math.abs(u) < 0.42 && Math.abs(v) < 0.1 ? 1 : 0; };
    fill(a, (x, y) => 0.78 + bump(x, y) * 0.12 + noiseAt(x, y, 100) * 0.06); fill(h, (x, y) => 0.3 + bump(x, y) * 0.5);
  },
  grass(h, a, r) {
    fill(a, (x, y) => 0.72 + noiseAt(x, y, 20) * 0.18 + noiseAt(x, y, 180) * 0.14 + (r() < 0.06 ? 0.12 : 0));
    fill(h, (x, y) => 0.5 + noiseAt(x, y, 160) * 0.25);
  },
  dirt(h, a, r) { fill(a, (x, y) => 0.7 + noiseAt(x, y, 16) * 0.2 + noiseAt(x, y, 120) * 0.12 - (r() < 0.02 ? 0.15 : 0)); fill(h, (x, y) => 0.5 + noiseAt(x, y, 70) * 0.3); },
  sand(h, a) { fill(a, (x, y) => 0.86 + noiseAt(x, y, 160) * 0.1); fill(h, (x, y) => 0.5 + Math.sin(x * 0.12 + noiseAt(x, y, 10) * 6) * 0.06); },
  fabric(h, a) { fill(a, (x, y) => 0.82 + ((x >> 1) % 2 === (y >> 1) % 2 ? 0.06 : -0.04) + noiseAt(x, y, 50) * 0.08); fill(h, (x, y) => 0.5 + ((x >> 1) % 2 === (y >> 1) % 2 ? 0.1 : 0)); },
  slate(h, a, r) { fill(a, (x, y) => 0.7 + noiseAt(x * 0.3, y * 2, 10) * 0.24 + noiseAt(x, y, 100) * 0.08); fill(h, (x, y) => 0.4 + noiseAt(x * 0.3, y * 2, 10) * 0.4); },
  marble(h, a) { fill(a, (x, y) => { const v = Math.abs(Math.sin((x + y) * 0.03 + noiseAt(x, y, 12) * 8)); return 0.86 + (v < 0.06 ? -0.2 : 0) + noiseAt(x, y, 60) * 0.06; }); fill(h, () => 0.5); },
  tile(h, a, r) {
    const t = SIZE / 4, shade = [...Array(16)].map(() => 0.88 + r() * 0.1);
    fill(a, (x, y) => (x % t < 3 || y % t < 3 ? 0.62 : shade[(Math.floor(x / t) + Math.floor(y / t) * 4) % 16] + noiseAt(x, y, 80) * 0.04));
    fill(h, (x, y) => (x % t < 3 || y % t < 3 ? 0.2 : 0.6));
  },
  carpet(h, a, r) { fill(a, (x, y) => 0.78 + noiseAt(x, y, 200) * 0.18 + (r() - 0.5) * 0.06); fill(h, (x, y) => 0.5 + (r() - 0.5) * 0.2); },
  snow(h, a) { fill(a, (x, y) => 0.94 + noiseAt(x, y, 40) * 0.06); fill(h, (x, y) => 0.5 + noiseAt(x, y, 30) * 0.3); },
  rock(h, a) { fill(a, (x, y) => 0.62 + noiseAt(x, y, 14) * 0.25 + noiseAt(x, y, 90) * 0.15); fill(h, (x, y) => noiseAt(x, y, 14) * 0.7 + noiseAt(x, y, 90) * 0.3); },
  neon(h, a) { fill(h, () => 0.5); fill(a, () => 1); },
  glass(h, a) { fill(h, () => 0.5); fill(a, () => 1); }
};
export const MATS = {
  plastic: { tile: 4, rough: 0.55, metal: 0, nrm: 0.4 }, smooth: { tile: 8, rough: 0.35, metal: 0, nrm: 0 },
  wood: { tile: 2.5, rough: 0.75, metal: 0, nrm: 0.6 }, planks: { tile: 3, rough: 0.78, metal: 0, nrm: 1.4 },
  brick: { tile: 2, rough: 0.85, metal: 0, nrm: 2 }, concrete: { tile: 4, rough: 0.9, metal: 0, nrm: 0.8 },
  cobble: { tile: 3, rough: 0.85, metal: 0, nrm: 2.2 }, metal: { tile: 3, rough: 0.42, metal: 0.75, nrm: 0.3 },
  dplate: { tile: 1.5, rough: 0.4, metal: 0.8, nrm: 1.6 }, grass: { tile: 4, rough: 0.95, metal: 0, nrm: 0.9 },
  dirt: { tile: 4, rough: 0.95, metal: 0, nrm: 1 }, sand: { tile: 6, rough: 0.95, metal: 0, nrm: 0.6 },
  fabric: { tile: 1.5, rough: 0.9, metal: 0, nrm: 0.5 }, slate: { tile: 4, rough: 0.8, metal: 0, nrm: 1.5 },
  marble: { tile: 4, rough: 0.3, metal: 0, nrm: 0 }, tile: { tile: 2, rough: 0.35, metal: 0, nrm: 1 },
  carpet: { tile: 2, rough: 1, metal: 0, nrm: 0.6 }, snow: { tile: 5, rough: 0.9, metal: 0, nrm: 0.8 },
  rock: { tile: 4, rough: 0.9, metal: 0, nrm: 2 }, neon: { tile: 4, rough: 0.4, metal: 0, nrm: 0, emissive: true },
  glass: { tile: 4, rough: 0.05, metal: 0.1, nrm: 0, glass: true }
};

let noiseGrid = null;
function noiseAt(x, y, scale) {
  // tileable value noise over the texture
  if (!noiseGrid) { const r = rng(9); noiseGrid = new Float32Array(64 * 64); for (let i = 0; i < noiseGrid.length; i++) noiseGrid[i] = r(); }
  const n = Math.max(1, Math.min(48, Math.round(scale / 4))), fx = x / SIZE * n, fy = y / SIZE * n, o = n % 16;
  const xi = Math.floor(fx), yi = Math.floor(fy), xf = fx - xi, yf = fy - yi;
  const g = (i, j) => noiseGrid[((((j % n) + n) % n) + o) * 64 + ((((i % n) + n) % n) + o)];
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = g(xi, yi) + (g(xi + 1, yi) - g(xi, yi)) * u, b = g(xi, yi + 1) + (g(xi + 1, yi + 1) - g(xi, yi + 1)) * u;
  return a + (b - a) * v;
}
function fill(buf, fn) { for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) buf[y * SIZE + x] = fn(x, y); }

const cache = new Map();
export function material(name) {
  if (cache.has(name)) return cache.get(name);
  const spec = MATS[name] || MATS.plastic, paint = PAINT[name] || PAINT.plastic;
  const h = new Float32Array(SIZE * SIZE), a = new Float32Array(SIZE * SIZE);
  paint(h, a, rng(name.length * 977 + name.charCodeAt(0)));
  // albedo
  const cv = document.createElement('canvas'); cv.width = cv.height = SIZE;
  const g = cv.getContext('2d'), img = g.createImageData(SIZE, SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) { const v = clamp(a[i], 0, 1) * 255; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(cv);
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  // normal map from the height field
  let normalMap = null;
  if (spec.nrm > 0) {
    const nv = document.createElement('canvas'); nv.width = nv.height = SIZE;
    const ng = nv.getContext('2d'), nimg = ng.createImageData(SIZE, SIZE);
    const H = (x, y) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * spec.nrm * 4, dy = (H(x, y + 1) - H(x, y - 1)) * spec.nrm * 4;
      const l = Math.hypot(dx, dy, 1), i = (y * SIZE + x) * 4;
      nimg.data[i] = (-dx / l * 0.5 + 0.5) * 255; nimg.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; nimg.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; nimg.data[i + 3] = 255;
    }
    ng.putImageData(nimg, 0, 0);
    normalMap = new THREE.CanvasTexture(nv);
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  }
  const m = new THREE.MeshStandardMaterial({ map, normalMap, roughness: spec.rough, metalness: spec.metal, vertexColors: true });
  if (spec.emissive) { m.emissive = new THREE.Color(1, 1, 1); m.emissiveIntensity = 1.6; m.emissiveMap = map; m.toneMapped = true; m.vertexColors = true; m.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.rgb;'); }; }
  if (spec.glass) { m.transparent = true; m.opacity = 0.32; m.depthWrite = false; }
  m.name = name;
  cache.set(name, m);
  return m;
}
