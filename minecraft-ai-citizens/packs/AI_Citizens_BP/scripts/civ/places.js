/**
 * Named landmarks.
 *
 * "Call this place the quarry" then "everyone go to the quarry" - a shared
 * gazetteer, not one citizen's memory, because the whole town has to know where
 * the quarry is. Saved with the world, so the names survive a reload.
 */
import { safe } from "../core/log.js";
import { worldStore } from "../core/store.js";

const KEY = "ai:places";
const PLACES = new Map();

export function loadPlaces() {
  safe("places.load", () => {
    PLACES.clear();
    for (const p of worldStore.load(KEY, []) || []) {
      if (p && p.name) PLACES.set(p.name.toLowerCase(), p);
    }
  });
}

function save() {
  safe("places.save", () => worldStore.save(KEY, [...PLACES.values()]));
}

export function namePlace(name, location, dimensionId) {
  const clean = String(name || "").trim().replace(/^the\s+/i, "").slice(0, 24);
  if (!clean) return null;
  const place = {
    name: clean,
    x: Math.round(location.x), y: Math.round(location.y), z: Math.round(location.z),
    dimensionId: dimensionId || "minecraft:overworld",
  };
  PLACES.set(clean.toLowerCase(), place);
  save();
  return place;
}

export function forgetPlace(name) {
  const gone = PLACES.delete(String(name || "").toLowerCase());
  if (gone) save();
  return gone;
}

export function placeNamed(name) {
  return PLACES.get(String(name || "").trim().toLowerCase().replace(/^the\s+/, "")) || null;
}

export function placeNames() {
  return [...PLACES.values()].map((p) => p.name);
}

/**
 * The first named place mentioned anywhere in a sentence.
 *
 * Place names are whatever the player invented, so they cannot live in the
 * lexicon - the only way to spot "go to the quarry" is to look for every name
 * we know. Longest first, so "old quarry" wins over "quarry".
 */
export function placeMentionedIn(text) {
  const haystack = ` ${String(text || "").toLowerCase()} `;
  const names = [...PLACES.keys()].sort((a, b) => b.length - a.length);
  for (const key of names) {
    if (haystack.includes(` ${key} `) || haystack.includes(` ${key}.`)
        || haystack.includes(` ${key},`)) {
      return PLACES.get(key);
    }
  }
  return null;
}

export function placeCount() { return PLACES.size; }
