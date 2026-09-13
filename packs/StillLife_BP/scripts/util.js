/* Small helpers shared by every STILL LIFE system.
 * Everything here is defensive on purpose: one API shape changing between
 * Bedrock versions should degrade a single feature, never brick the pack. */
import { world, system } from "@minecraft/server";

export const OVERWORLD = () => world.getDimension("overworld");

/** Run fn, swallow (and once-log) anything it throws. */
const logged = new Set();
export function safe(fn, tag = "sl") {
  try {
    return fn();
  } catch (e) {
    const k = tag + ":" + (e && e.message ? e.message : String(e));
    if (!logged.has(k)) {
      logged.add(k);
      console.warn(`[STILL LIFE] ${tag}: ${e}`);
    }
    return undefined;
  }
}

/** system.runInterval that can never kill the tick loop. */
export function every(ticks, fn, tag = "tick") {
  return system.runInterval(() => safe(fn, tag), ticks);
}

export function later(ticks, fn, tag = "later") {
  return system.runTimeout(() => safe(fn, tag), ticks);
}

/** Spread a generator's work across ticks. Uses runJob when the runtime has
 *  it, otherwise drains a fixed budget per tick. */
export function job(gen, budget = 120) {
  if (typeof system.runJob === "function") {
    const h = safe(() => system.runJob(gen), "runJob");
    if (h !== undefined) return h;
  }
  const id = system.runInterval(() => {
    for (let i = 0; i < budget; i++) {
      let r;
      try {
        r = gen.next();
      } catch (e) {
        system.clearRun(id);
        return;
      }
      if (r.done) {
        system.clearRun(id);
        return;
      }
    }
  }, 1);
  return id;
}

// ------------------------------------------------------------------ maths
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Deterministic 32-bit hash -> [0,1). Same coords always give the same
 *  world, which is what lets the Backrooms regenerate identically. */
export function hash3(x, y, z, seed = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 2147483647 + seed * 971;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function pick(arr, r) {
  return arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];
}

export const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
export const rnd = () => Math.random();
export const chance = (p) => Math.random() < p;

export function dist2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function floorLoc(l) {
  return { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) };
}

// ------------------------------------------------------- dynamic property
export function wget(key, dflt) {
  const v = safe(() => world.getDynamicProperty(key), "wget");
  return v === undefined || v === null ? dflt : v;
}
export function wset(key, val) {
  safe(() => world.setDynamicProperty(key, val), "wset");
}
export function pget(p, key, dflt) {
  const v = safe(() => p.getDynamicProperty(key), "pget");
  return v === undefined || v === null ? dflt : v;
}
export function pset(p, key, val) {
  safe(() => p.setDynamicProperty(key, val), "pset");
}

// ------------------------------------------------------------- world edit
/** Bulk fill via /fill -- far cheaper than a setType loop and stable across
 *  every script API version we care about. Caps at the vanilla 32768 limit. */
export function fill(dim, a, b, block, mode = "replace") {
  const n = (Math.abs(a.x - b.x) + 1) * (Math.abs(a.y - b.y) + 1) * (Math.abs(a.z - b.z) + 1);
  if (n > 32768) return false;
  return safe(() => {
    dim.runCommand(
      `fill ${a.x} ${a.y} ${a.z} ${b.x} ${b.y} ${b.z} ${block} ${mode}`
    );
    return true;
  }, "fill") === true;
}

export function setBlock(dim, loc, typeId) {
  return safe(() => {
    const b = dim.getBlock(loc);
    if (!b) return false;
    b.setType(typeId);
    return true;
  }, "setBlock") === true;
}

export function getTypeId(dim, loc) {
  return safe(() => {
    const b = dim.getBlock(loc);
    return b ? b.typeId : undefined;
  }, "getTypeId");
}

export function isAir(dim, loc) {
  const t = getTypeId(dim, loc);
  return t === "minecraft:air" || t === undefined;
}

/** Highest non-air block at (x,z). Returns undefined if the column is not
 *  loaded, which is the normal case for far-away chunks. */
export function surfaceY(dim, x, z, from = 200, to = -60) {
  for (let y = from; y > to; y--) {
    const t = getTypeId(dim, { x, y, z });
    if (t === undefined) return undefined;
    if (t !== "minecraft:air" && t !== "minecraft:water" &&
        t !== "minecraft:short_grass" && t !== "minecraft:tall_grass" &&
        t !== "minecraft:snow_layer" && !t.endsWith("_leaves")) {
      return y;
    }
  }
  return undefined;
}

// ------------------------------------------------------------------ text
export const TAG = "§e[Still Life]§r";
export function tell(p, msg) {
  safe(() => p.sendMessage(msg), "tell");
}
export function whisper(p, msg) {
  safe(() => p.onScreenDisplay.setActionBar(msg), "whisper");
}
export function sound(p, id, opts) {
  safe(() => p.playSound(id, opts ?? {}), "sound");
}
export function dsound(dim, id, loc, opts) {
  safe(() => dim.playSound(id, loc, opts ?? {}), "dsound");
}
