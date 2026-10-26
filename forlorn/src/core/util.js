/* Small maths and helpers shared by everything. */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Angle difference in -PI..PI. */
export const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
/** Turn angle a toward b by at most step. */
export const turnToward = (a, b, step) => { const d = angDiff(a, b); return a + clamp(d, -step, step); };
/** Exponential approach, frame-rate independent: k is the rate per second. */
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));

/** Seeded random number generator (mulberry32). */
export function rng(seed) {
  let s = seed >>> 0;
  const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  r.shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  return r;
}
export const R = rng((Date.now() ^ (Math.random() * 1e9)) >>> 0);

/** Weighted pick: items [{ w, ... }] or [[value, weight]]. */
export function weighted(list, r = R) {
  let total = 0;
  for (const it of list) total += Array.isArray(it) ? it[1] : it.w;
  let x = r() * total;
  for (const it of list) { const w = Array.isArray(it) ? it[1] : it.w; if ((x -= w) <= 0) return Array.isArray(it) ? it[0] : it; }
  return Array.isArray(list[0]) ? list[list.length - 1][0] : list[list.length - 1];
}

/** 2D value noise, for terrain wobble and texture work. */
const PERM = (() => { const p = new Uint8Array(512), r = rng(1337), a = [...Array(256).keys()]; r.shuffle(a); for (let i = 0; i < 512; i++) p[i] = a[i & 255]; return p; })();
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (i, j) => PERM[(PERM[i & 255] + j) & 255] / 255;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
}
export function fbm2(x, y, oct = 4) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); n += a; a *= 0.5; f *= 2.02; } return s / n; }

export const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
export const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
