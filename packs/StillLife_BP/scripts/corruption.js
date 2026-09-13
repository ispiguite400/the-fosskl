/* The world getting worse at pretending.
 *
 * Bedrock add-ons cannot replace chunk generation from script, so instead of
 * faking that, this edits terrain *after* it loads, in a ring around each
 * player, at a rate set by the corruption number. The rule that keeps it from
 * eating your base: it only ever overwrites NATURAL blocks. Anything you
 * placed yourself is off limits.
 */
import { world, system } from "@minecraft/server";
import {
  safe, every, chance, rint, rnd, pick, clamp, fill, setBlock, getTypeId,
  surfaceY, isAir, dsound, tell, TAG,
} from "./util.js";
import { corruption, corruptionT, addCorruption, decayTier, worldDay, K, karma } from "./state.js";
import { wget, wset } from "./util.js";

const NATURAL = new Set([
  "minecraft:grass_block", "minecraft:dirt", "minecraft:coarse_dirt",
  "minecraft:podzol", "minecraft:stone", "minecraft:cobblestone",
  "minecraft:andesite", "minecraft:diorite", "minecraft:granite",
  "minecraft:deepslate", "minecraft:tuff", "minecraft:sand", "minecraft:red_sand",
  "minecraft:sandstone", "minecraft:gravel", "minecraft:clay", "minecraft:snow",
  "minecraft:snow_layer", "minecraft:mycelium", "minecraft:moss_block",
  "minecraft:rooted_dirt", "minecraft:mud", "minecraft:terracotta",
  "minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern",
  "minecraft:air",
]);
const LEAVES = /_leaves$/;
const LOGS = /_log$|_wood$/;

function natural(dim, loc) {
  const t = getTypeId(dim, loc);
  if (t === undefined) return false;
  return NATURAL.has(t) || LEAVES.test(t) || LOGS.test(t) || t.startsWith("sl:");
}

/** Only write if what is already there is natural. Protects player builds. */
function put(dim, loc, type) {
  if (!natural(dim, loc)) return false;
  return setBlock(dim, loc, type);
}

const WALLS = ["sl:wallpaper", "sl:wallpaper", "sl:wallpaper_torn", "sl:moist_wall"];

// ------------------------------------------------------------- distortions
function carpetPatch(dim, x, y, z, t) {
  const r = 1 + rint(0, 1 + Math.floor(t * 2));
  for (let dx = -r; dx <= r; dx++)
    for (let dz = -r; dz <= r; dz++)
      if (dx * dx + dz * dz <= r * r + 1)
        put(dim, { x: x + dx, y, z: z + dz }, "sl:damp_carpet");
}

function wallStub(dim, x, y, z, t) {
  const len = 3 + rint(0, 3), h = 2 + rint(0, 2);
  const along = chance(0.5);
  const sink = rint(1, 3);                    // it comes up out of the ground
  for (let i = 0; i < len; i++)
    for (let j = -sink; j < h; j++) {
      const loc = along ? { x: x + i, y: y + j, z } : { x, y: y + j, z: z + i };
      put(dim, loc, pick(WALLS, rnd()));
    }
}

function doorframe(dim, x, y, z) {
  const along = chance(0.5);
  const d = along ? { x: 1, z: 0 } : { x: 0, z: 1 };
  for (let j = 0; j < 4; j++) {
    put(dim, { x, y: y + j, z }, "sl:wallpaper");
    put(dim, { x: x + d.x * 3, y: y + j, z: z + d.z * 3 }, "sl:wallpaper");
  }
  for (let i = 0; i <= 3; i++)
    put(dim, { x: x + d.x * i, y: y + 3, z: z + d.z * i }, "sl:wallpaper");
}

function floatSlab(dim, x, y, z) {
  const h = y + 4 + rint(0, 4);
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++)
      put(dim, { x: x + dx, y: h, z: z + dz }, "sl:ceiling_tile");
  put(dim, { x, y: h, z }, "sl:buzzing_light");
}

function pillar(dim, x, y, z) {
  const h = 4 + rint(0, 6);
  for (let j = -2; j < h; j++) put(dim, { x, y: y + j, z }, pick(WALLS, rnd()));
}

function sinkhole(dim, x, y, z) {
  const d = 3 + rint(0, 3);
  for (let dx = 0; dx <= 1; dx++)
    for (let dz = 0; dz <= 1; dz++)
      for (let j = 0; j <= d; j++)
        put(dim, { x: x + dx, y: y - j, z: z + dz }, "minecraft:air");
  for (let j = 0; j <= d; j++) {
    put(dim, { x: x - 1, y: y - j, z }, "sl:wallpaper");
    put(dim, { x: x + 2, y: y - j, z }, "sl:wallpaper");
    put(dim, { x, y: y - j, z: z - 1 }, "sl:wallpaper");
    put(dim, { x, y: y - j, z: z + 2 }, "sl:wallpaper");
  }
  put(dim, { x, y: y - d, z }, "sl:damp_carpet");
}

function wrongTree(dim, x, y, z) {
  // a tree the world remembered as cotton
  for (let dy = 1; dy <= 8; dy++)
    for (let dx = -3; dx <= 3; dx++)
      for (let dz = -3; dz <= 3; dz++) {
        const loc = { x: x + dx, y: y + dy, z: z + dz };
        const t = getTypeId(dim, loc);
        if (t && LEAVES.test(t)) setBlock(dim, loc, chance(0.7) ? "sl:cotton_bale"
                                                                : "minecraft:white_wool");
      }
}

/** A room that should not be here, half-swallowed by the hill. */
function roomShell(dim, x, y, z) {
  const w = 5 + rint(0, 3), d = 5 + rint(0, 3), h = 4;
  const sink = rint(1, 4);
  const y0 = y - sink;
  for (let dx = 0; dx < w; dx++)
    for (let dz = 0; dz < d; dz++)
      for (let dy = 0; dy < h; dy++) {
        const edge = dx === 0 || dz === 0 || dx === w - 1 || dz === d - 1;
        const loc = { x: x + dx, y: y0 + dy, z: z + dz };
        if (dy === 0) put(dim, loc, "sl:damp_carpet");
        else if (dy === h - 1) put(dim, loc, chance(0.18) ? "sl:buzzing_light" : "sl:ceiling_tile");
        else if (edge) put(dim, loc, chance(0.10) ? "minecraft:air" : pick(WALLS, rnd()));
        else put(dim, loc, "minecraft:air");
      }
  // a doorway, always, even though nothing uses it
  put(dim, { x: x + ((w / 2) | 0), y: y0 + 1, z }, "minecraft:air");
  put(dim, { x: x + ((w / 2) | 0), y: y0 + 2, z }, "minecraft:air");
}

const EDITS = [
  { w: 26, fn: carpetPatch, min: 0.00 },
  { w: 18, fn: wallStub,    min: 0.06 },
  { w: 12, fn: doorframe,   min: 0.12 },
  { w: 10, fn: pillar,      min: 0.18 },
  { w: 10, fn: floatSlab,   min: 0.26 },
  { w: 10, fn: wrongTree,   min: 0.30 },
  { w:  8, fn: sinkhole,    min: 0.42 },
  { w: 12, fn: roomShell,   min: 0.55 },
];

function oneEdit(p) {
  const t = corruptionT();
  const pool = EDITS.filter((e) => t >= e.min);
  if (!pool.length) return;
  let total = pool.reduce((a, e) => a + e.w, 0);
  let r = rnd() * total;
  let chosen = pool[0];
  for (const e of pool) { r -= e.w; if (r <= 0) { chosen = e; break; } }

  const a = rnd() * Math.PI * 2;
  const dist = 22 + rnd() * 34;
  const x = Math.floor(p.location.x + Math.cos(a) * dist);
  const z = Math.floor(p.location.z + Math.sin(a) * dist);
  const y = surfaceY(p.dimension, x, z, Math.floor(p.location.y) + 40,
                     Math.floor(p.location.y) - 40);
  if (y === undefined) return;            // chunk not loaded, try again later
  safe(() => chosen.fn(p.dimension, x, y + 1, z, t), "edit");
}

// ---------------------------------------------------------------- schedule
let lastDay = -1;

export function install() {
  // corruption climbs with the calendar. It never goes back down on its own.
  every(200, () => {
    const d = worldDay();
    if (lastDay < 0) lastDay = Number(wget(K.day, d));
    if (d > lastDay) {
      const days = Math.min(6, d - lastDay);
      addCorruption(days * 0.85);
      lastDay = d;
      wset(K.day, d);
      const c = corruption();
      if (c > 20 && c - days * 0.85 <= 20)
        world.sendMessage(`${TAG} §7Something about the light is wrong today.`);
      if (c > 50 && c - days * 0.85 <= 50)
        world.sendMessage(`${TAG} §6The world has stopped trying to look like itself.`);
      if (c > 80 && c - days * 0.85 <= 80)
        world.sendMessage(`${TAG} §cIt knows you are still here.`);
    }
  }, "corruption-day");

  // the actual warping pass
  every(140, () => {
    const t = corruptionT();
    if (t <= 0.01) return;
    for (const p of world.getAllPlayers()) {
      if (!p.dimension.id.endsWith("overworld")) continue;
      const budget = 1 + Math.floor(t * 4);
      for (let i = 0; i < budget; i++) if (chance(0.55 + t * 0.4)) oneEdit(p);
    }
  }, "corruption-warp");

  // keep every still life's decay tier in step with the world
  every(300, () => {
    const tier = decayTier();
    for (const p of world.getAllPlayers()) {
      const list = safe(() => p.dimension.getEntities({
        location: p.location, maxDistance: 64, families: ["still_life"],
      }), "decay-scan") ?? [];
      for (const e of list) {
        safe(() => {
          if (e.getProperty("sl:decay") !== tier) e.triggerEvent(`sl:decay_${tier}`);
        }, "decay-set");
      }
    }
  }, "corruption-decay");

  // the haze, thickening. /fog push STACKS, so only ever fire it on a
  // transition -- pushing every second would build a tower of fog layers.
  const fogOn = new Set();
  every(100, () => {
    const t = corruptionT();
    for (const p of world.getAllPlayers()) {
      const want = t > 0.25 && p.dimension.id.endsWith("overworld");
      const on = fogOn.has(p.id);
      if (want === on) continue;
      safe(() => {
        p.runCommand(want ? `fog @s push sl:distortion sl_overworld`
                          : `fog @s remove sl_overworld`);
      }, "fog");
      if (want) fogOn.add(p.id); else fogOn.delete(p.id);
    }
  }, "corruption-fog");
}

export { corruption, corruptionT, put, natural, NATURAL };
