/* The world's memory.
 *
 * Two numbers drive almost everything in this add-on:
 *   corruption 0..100 -- how far the world has stopped pretending.
 *                        Only ever climbs (slowly), and every distortion
 *                        system reads it as its intensity dial.
 *   karma    -100..100 -- per player. How you have treated the things that
 *                        live here. The Tall One reads this before deciding
 *                        whether to walk beside you or pick you up.
 */
import { world } from "@minecraft/server";
import { wget, wset, pget, pset, clamp, safe } from "./util.js";

export const K = {
  corruption: "sl:corruption",
  day: "sl:day_seen",
  tallDay: "sl:tall_day",
  tallGap: "sl:tall_gap",
  recreated: "sl:recreated",
  villages: "sl:villages",
  builds: "sl:builds",
  clarkDown: "sl:clark_down",
  intro: "sl:intro",
};
export const PK = {
  sanity: "sl:sanity",
  karma: "sl:karma",
  home: "sl:home",
  inBack: "sl:in_backrooms",
  sectors: "sl:sectors",
  scares: "sl:scares",
  bonded: "sl:bonded",
  tamed: "sl:tamed_count",
  killed: "sl:killed_count",
};

export function corruption() {
  return clamp(Number(wget(K.corruption, 0)), 0, 100);
}
export function addCorruption(n) {
  const v = clamp(corruption() + n, 0, 100);
  wset(K.corruption, v);
  return v;
}
/** 0 = the world is still doing a good impression. 1 = it has given up. */
export function corruptionT() {
  return corruption() / 100;
}
/** 0,1,2 -- feeds the sl:decay entity property (texture + wobble amount). */
export function decayTier() {
  const c = corruption();
  return c > 66 ? 2 : c > 33 ? 1 : 0;
}

export function karma(p) {
  return clamp(Number(pget(p, PK.karma, 0)), -100, 100);
}
export function addKarma(p, n) {
  const v = clamp(karma(p) + n, -100, 100);
  pset(p, PK.karma, v);
  return v;
}
/** How the world feels about this player, in words. */
export function mood(p) {
  const k = karma(p);
  if (k >= 55) return "fond";
  if (k >= 18) return "curious";
  if (k > -18) return "indifferent";
  if (k > -55) return "resentful";
  return "hateful";
}
/** Probability that something you befriended turns on you. */
export function betrayalChance(p) {
  const k = karma(p);
  if (k >= 55) return 0.0;
  if (k >= 18) return 0.02;
  if (k > -18) return 0.10;
  if (k > -55) return 0.30;
  return 0.62;
}

export function sanity(p) {
  return clamp(Number(pget(p, PK.sanity, 100)), 0, 100);
}
export function setSanity(p, v) {
  pset(p, PK.sanity, clamp(v, 0, 100));
}
export function addSanity(p, n) {
  setSanity(p, sanity(p) + n);
  return sanity(p);
}

export function worldDay() {
  return safe(() => {
    if (typeof world.getDay === "function") return world.getDay();
    return Math.floor(world.getAbsoluteTime() / 24000);
  }, "worldDay") ?? 0;
}

export function inBackrooms(p) {
  return pget(p, PK.inBack, false) === true;
}
