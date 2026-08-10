/* Shared math, noise, colour and DOM helpers. */

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp  = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const rad = d => d * Math.PI / 180;
export const deg = r => r * 180 / Math.PI;
/** Frame-rate independent exponential smoothing. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/* ---------------- seeded RNG (mulberry32) ---------------- */
export function makeRNG(seed) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + r() * (b - a);
  r.int = (a, b) => Math.floor(a + r() * (b - a + 1));
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  r.chance = p => r() < p;
  r.sign = () => (r() < .5 ? -1 : 1);
  return r;
}

/* ---------------- value noise + fbm ---------------- */
const P = new Uint8Array(512);
(function seedPerm() {
  const rng = makeRNG(1337);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = rng.int(0, i); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
})();

const grad2 = (h, x, y) => {
  switch (h & 7) {
    case 0: return  x + y; case 1: return  x - y; case 2: return -x + y; case 3: return -x - y;
    case 4: return  x;     case 5: return -x;     case 6: return  y;     default: return -y;
  }
};

/** Gradient noise in [-1,1]. */
export function noise2(x, y) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x), yf = y - Math.floor(y);
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const aa = P[P[X] + Y], ab = P[P[X] + Y + 1];
  const ba = P[P[X + 1] + Y], bb = P[P[X + 1] + Y + 1];
  const x1 = lerp(grad2(aa, xf, yf),     grad2(ba, xf - 1, yf),     u);
  const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v);
}

/** Fractal brownian motion. */
export function fbm(x, y, oct = 5, lac = 2.03, gain = .5) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * noise2(x * f, y * f);
    norm += a; a *= gain; f *= lac;
  }
  return sum / norm;
}

/** Ridged noise — gives sharp mountain crests. */
export function ridge(x, y, oct = 5) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(noise2(x * f, y * f));
    sum += a * n * n; norm += a; a *= .5; f *= 2.07;
  }
  return sum / norm;
}

/* ---------------- colour ---------------- */
export function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l, l, l];
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
export function hsl2hex(h, s, l) {
  const [r, g, b] = hsl2rgb(h, s, l);
  const c = v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
export const hsl2int = (h, s, l) => parseInt(hsl2hex(h, s, l).slice(1), 16);

/* ---------------- DOM ---------------- */
export function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}
export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const wait = ms => new Promise(r => setTimeout(r, ms));

/** Simple event emitter used to decouple game <-> UI. */
export class Bus {
  constructor() { this.m = new Map(); }
  on(k, fn) { (this.m.get(k) || this.m.set(k, []).get(k)).push(fn); return () => this.off(k, fn); }
  off(k, fn) { const a = this.m.get(k); if (a) a.splice(a.indexOf(fn), 1); }
  emit(k, ...args) { const a = this.m.get(k); if (a) for (const f of [...a]) f(...args); }
}

/** Number formatter: 12400 -> 12.4k */
export function short(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return '' + Math.floor(n);
}

/** Distance readout for the mission tracker. */
export function distStr(m) {
  return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
}
