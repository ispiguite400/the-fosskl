/** Small helpers shared across the add-on. No Minecraft imports here. */

// --- vectors ------------------------------------------------------------
export const v3 = (x, y, z) => ({ x, y, z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

export function len(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function norm(a) {
  const l = len(a);
  return l < 1e-6 ? { x: 0, y: 0, z: 0 } : { x: a.x / l, y: a.y / l, z: a.z / l };
}

export function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function dist2d(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function floorV(a) {
  return { x: Math.floor(a.x), y: Math.floor(a.y), z: Math.floor(a.z) };
}

export function centerOf(a) {
  return { x: Math.floor(a.x) + 0.5, y: Math.floor(a.y), z: Math.floor(a.z) + 0.5 };
}

export function sameBlock(a, b) {
  return Math.floor(a.x) === Math.floor(b.x)
    && Math.floor(a.y) === Math.floor(b.y)
    && Math.floor(a.z) === Math.floor(b.z);
}

export function keyOf(a) {
  return `${Math.floor(a.x)},${Math.floor(a.y)},${Math.floor(a.z)}`;
}

export function fromKey(k) {
  const [x, y, z] = k.split(",").map(Number);
  return { x, y, z };
}

/** Compass direction from a horizontal vector, for natural-sounding speech. */
export function compass(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const ang = (Math.atan2(-dx, dz) * 180) / Math.PI;
  const dirs = ["south", "south-west", "west", "north-west",
                "north", "north-east", "east", "south-east"];
  return dirs[Math.round(((ang % 360) + 360) % 360 / 45) % 8];
}

// --- numbers ------------------------------------------------------------
export const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
export const lerp = (a, b, t) => a + (b - a) * t;

export function roundTo(n, places = 1) {
  const p = Math.pow(10, places);
  return Math.round(n * p) / p;
}

// --- randomness ---------------------------------------------------------
/** Deterministic 32-bit PRNG so a citizen's personality is stable. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export const pick = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length) % arr.length];

export function shuffled(arr, rnd = Math.random) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function weightedPick(entries, rnd = Math.random) {
  // entries: [[value, weight], ...]
  let total = 0;
  for (const [, w] of entries) total += Math.max(0, w);
  if (total <= 0) return entries.length ? entries[0][0] : undefined;
  let r = rnd() * total;
  for (const [value, w] of entries) {
    r -= Math.max(0, w);
    if (r <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

// --- text ---------------------------------------------------------------
export function wrapText(text, width, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!line.length) {
      line = w;
    } else if (line.length + 1 + w.length <= width) {
      line += " " + w;
    } else {
      lines.push(line);
      line = w;
      if (maxLines && lines.length >= maxLines) break;
    }
  }
  if (line && (!maxLines || lines.length < maxLines)) lines.push(line);
  if (maxLines && lines.length >= maxLines) {
    const joinedLen = lines.join(" ").length;
    if (joinedLen < text.length) lines[lines.length - 1] = trimTo(lines[lines.length - 1], width);
  }
  return lines;
}

export function trimTo(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + "…";
}

export function titleCase(s) {
  return String(s).replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** "minecraft:oak_planks" -> "oak planks" */
export function prettyId(id) {
  return String(id).replace(/^minecraft:/, "").replace(/_/g, " ");
}

export function stripFormatting(s) {
  return String(s).replace(/§./g, "");
}

// --- collections --------------------------------------------------------
export function groupBy(arr, fn) {
  const m = new Map();
  for (const item of arr) {
    const k = fn(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(item);
  }
  return m;
}

export function topN(arr, n, score) {
  return arr.slice().sort((a, b) => score(b) - score(a)).slice(0, n);
}

export function nowIso(day, timeOfDay) {
  const hour = Math.floor(((timeOfDay + 6000) % 24000) / 1000);
  const minute = Math.floor((((timeOfDay + 6000) % 24000) % 1000) / 1000 * 60);
  return `day ${day}, ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function timeLabel(timeOfDay) {
  const t = ((timeOfDay % 24000) + 24000) % 24000;
  if (t < 1000) return "dawn";
  if (t < 5000) return "morning";
  if (t < 7000) return "midday";
  if (t < 11000) return "afternoon";
  if (t < 13000) return "dusk";
  if (t < 18000) return "night";
  if (t < 23000) return "deep night";
  return "before dawn";
}

export function isNight(timeOfDay) {
  const t = ((timeOfDay % 24000) + 24000) % 24000;
  return t >= 13000 && t < 23000;
}
