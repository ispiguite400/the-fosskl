/* The sanity bar.
 *
 * Bedrock has no API for adding a real HUD bar, so this renders into the
 * action bar -- ASCII only, because the Bedrock glyph atlas cannot be trusted
 * with box-drawing characters on every platform. It only shows itself when
 * sanity is not full or has just changed, so it stays out of the way.
 */
import { world, system } from "@minecraft/server";
import {
  safe, every, clamp, chance, rint, whisper, sound, dsound, pget, pset,
} from "./util.js";
import {
  sanity, setSanity, addSanity, corruptionT, inBackrooms, PK,
} from "./state.js";

const SHOWN = new Map();   // player id -> tick we last drew the bar
const LASTV = new Map();

/* Set by main.js. Kept as a hook rather than an import so sanity.js and
   backrooms.js never form a cycle. */
let onFloorGaveWay = null;
export function setFloorGaveWay(fn) { onFloorGaveWay = fn; }

function colourFor(v) {
  if (v > 70) return "§a";
  if (v > 45) return "§e";
  if (v > 22) return "§6";
  return "§c";
}

function render(p, v) {
  const cells = 20;
  const on = Math.round((v / 100) * cells);
  const c = colourFor(v);
  const bar = c + "|".repeat(on) + "§8" + "|".repeat(cells - on);
  let label = "§7SANITY";
  if (v <= 22) label = "§4SANITY";
  else if (v <= 45) label = "§6SANITY";
  whisper(p, `${label} §8[${bar}§8] ${c}${Math.round(v)}%`);
}

/** Light level where the player is standing, 0..15, best effort. */
function brightness(p) {
  return safe(() => {
    const b = p.dimension.getBlock(p.location);
    if (!b) return 8;
    // getLightLevel isn't on every runtime; fall back to sky + time of day
    if (typeof b.getLightLevel === "function") return b.getLightLevel();
    const t = world.getTimeOfDay ? world.getTimeOfDay() : 6000;
    const day = t > 23000 || t < 12000;
    return p.dimension.id.endsWith("overworld") && day && p.location.y > 55 ? 14 : 4;
  }, "brightness") ?? 8;
}

function nearbyCount(p, families, r) {
  return safe(() => p.dimension.getEntities({
    location: p.location, maxDistance: r, families,
  }).length, "nearby") ?? 0;
}

/** One sanity step, ~ every 2 seconds. */
function step(p) {
  const t = corruptionT();
  let d = 0;

  const light = brightness(p);
  if (light <= 3) d -= 0.28;
  else if (light <= 7) d -= 0.11;
  else if (light >= 13) d += 0.40;

  // being looked at by things that should not be looking
  const stills = nearbyCount(p, ["still_life"], 14);
  const apex = nearbyCount(p, ["sl_apex"], 40);
  d -= stills * 0.10;
  d -= apex * 0.80;

  // the Backrooms are not survivable indefinitely, that is the whole idea
  if (inBackrooms(p)) d -= 0.55 + t * 0.30;
  else d -= t * 0.22;

  // a friend at your side helps
  const friends = safe(() => p.dimension.getEntities({
    location: p.location, maxDistance: 10, families: ["still_life"],
  }).filter((e) => e.getProperty && e.getProperty("sl:state") === "friendly").length,
    "friends") ?? 0;
  d += friends * 0.28;

  // a lit Sanity Anchor nearby is the only real safe ground
  if (safe(() => {
    const l = p.location;
    for (let dx = -6; dx <= 6; dx += 3)
      for (let dz = -6; dz <= 6; dz += 3)
        for (let dy = -2; dy <= 3; dy += 2) {
          const b = p.dimension.getBlock({
            x: Math.floor(l.x) + dx, y: Math.floor(l.y) + dy, z: Math.floor(l.z) + dz });
          if (b && b.typeId === "sl:sanity_anchor_block") return true;
        }
    return false;
  }, "anchor") === true) d += 1.8;

  const hp = safe(() => {
    const h = p.getComponent("minecraft:health");
    return h ? h.currentValue / h.effectiveMax : 1;
  }, "hp") ?? 1;
  if (hp < 0.35) d -= 0.25;

  const before = sanity(p);
  const after = clamp(before + d, 0, 100);
  setSanity(p, after);
  return { before, after };
}

/** What losing your mind actually does to you. */
function effects(p, v) {
  const dim = p.dimension;
  safe(() => {
    if (v <= 70 && chance(0.05)) {
      sound(p, "sl.ambient.whisper", { volume: 0.5, pitch: 0.9 + Math.random() * 0.2 });
    }
    if (v <= 45) {
      if (chance(0.10)) p.addEffect("nausea", 90, { amplifier: 0, showParticles: false });
      if (chance(0.06)) sound(p, "sl.ambient.sanity_low", { volume: 0.5 });
    }
    if (v <= 25) {
      if (chance(0.12)) p.addEffect("blindness", 40, { amplifier: 0, showParticles: false });
      if (chance(0.08)) p.addEffect("slowness", 80, { amplifier: 0, showParticles: false });
      // hallucinations: a still life that was never really there
      if (chance(0.07)) hallucinate(p);
    }
    if (v <= 8) {
      if (chance(0.10)) {
        p.addEffect("darkness", 120, { amplifier: 0, showParticles: false });
        sound(p, "sl.ambient.sanity_low", { volume: 0.8, pitch: 0.8 });
      }
      // at the very bottom the floor stops holding you (movie rule)
      if (chance(0.012) && onFloorGaveWay) {
        system.run(() => safe(() => onFloorGaveWay(p), "sanity-noclip"));
      }
    }
  }, "effects");
}

const HALLU = ["sl:still_villager", "sl:still_player", "sl:still_cow"];
function hallucinate(p) {
  safe(() => {
    const dir = p.getViewDirection();
    const a = Math.atan2(dir.z, dir.x) + (Math.random() < 0.5 ? 1.9 : -1.9);
    const r = 7 + Math.random() * 6;
    const loc = {
      x: p.location.x + Math.cos(a) * r,
      y: p.location.y,
      z: p.location.z + Math.sin(a) * r,
    };
    const e = p.dimension.spawnEntity(HALLU[rint(0, HALLU.length - 1)], loc);
    e.triggerEvent("sl:to_still");
    e.addTag("sl_hallucination");
    // it was never there
    system.runTimeout(() => safe(() => { if (e.isValid) e.remove(); }, "hallu-gone"),
      60 + rint(0, 80));
  }, "hallucinate");
}

export function restore(p, amount, why) {
  const v = addSanity(p, amount);
  SHOWN.set(p.id, 0);
  if (why) whisper(p, `§a+${amount} sanity §7- ${why}`);
  return v;
}

export function install() {
  every(40, () => {
    for (const p of world.getAllPlayers()) {
      const { before, after } = step(p) ?? {};
      if (after === undefined) continue;
      effects(p, after);
      const changed = Math.abs((LASTV.get(p.id) ?? 100) - after) > 0.4;
      LASTV.set(p.id, after);
      if (after < 99.5 || changed) render(p, after);
    }
  }, "sanity");

  // sleeping through the night is the cheap, honest way back
  safe(() => world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!initialSpawn) restore(player, 35, "you woke up");
  }), "sanity-spawn");
}
