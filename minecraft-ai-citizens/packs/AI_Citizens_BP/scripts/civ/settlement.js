/**
 * Settlements: how a handful of citizens becomes a town.
 *
 * A settlement owns a patch of ground, a plot grid, a build queue, a shared
 * stockpile and a roster. It decides *what* should exist next; individual
 * citizens decide who does it and how. Everything persists in world dynamic
 * properties so a town survives a restart.
 */
import { world } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import { worldStore } from "../core/store.js";
import { safe, debug } from "../core/log.js";
import { dist, dist2d, prettyId, compass } from "../core/util.js";
import { settlementName } from "../core/names.js";
import { BLUEPRINTS, blueprintById, materialsFor } from "./blueprints.js";
import { findBuildSite } from "../actions/build.js";
import { openBlockContainer, containerContents } from "../actions/inventory.js";
import { blockType } from "../actions/navigation.js";
import { isReserved, distanceFromCentre } from "./territory.js";

export { isReserved, distanceFromCentre };

const KEY = "ai:settlements";

/**
 * The growth ladder. Each tier's `need` must be reachable using only the
 * blueprints unlocked at or below it - otherwise a settlement stalls forever
 * one requirement short of the thing that would satisfy it.
 */
export const TIERS = [
  {
    name: "camp",
    need: {},
    unlocks: ["campfire", "farm_plot", "well", "small_house"],
  },
  {
    name: "hamlet",
    need: { housing: 2, food: 4 },
    unlocks: ["storehouse", "lamp_post", "road_segment", "workshop"],
  },
  {
    name: "village",
    need: { housing: 4, food: 8, storage: 6, crafting: 2 },
    unlocks: ["watchtower", "wall_segment", "shrine"],
  },
  {
    name: "town",
    need: { housing: 8, food: 12, storage: 12, defence: 3 },
    unlocks: ["town_hall"],
  },
];

export class Settlements {
  constructor() {
    this.list = [];
  }

  load() {
    const raw = worldStore.load(KEY, null);
    this.list = Array.isArray(raw) ? raw : [];
    for (const s of this.list) normalise(s);
    return this.list;
  }

  save() {
    worldStore.save(KEY, this.list);
  }

  get(id) {
    return this.list.find((s) => s.id === id) || null;
  }

  byName(name) {
    const want = String(name).toLowerCase();
    return this.list.find((s) => s.name.toLowerCase() === want) || null;
  }

  nearest(location, dimensionId, maxDistance = Infinity) {
    let best = null, bestD = maxDistance;
    for (const s of this.list) {
      if (s.dimension !== dimensionId) continue;
      const d = dist(location, s.origin);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  found(location, dimensionId, founder) {
    const id = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
    const settlement = normalise({
      id,
      name: settlementName(id),
      origin: { x: Math.round(location.x), y: Math.round(location.y), z: Math.round(location.z) },
      dimension: dimensionId,
      founded: world.getDay(),
      founder: founder || "unknown",
      tier: 0,
      structures: [],
      stockpiles: [],
      plots: [],
      log: [],
      stats: { housing: 0, food: 0, storage: 0, defence: 0, civic: 0, culture: 0, crafting: 0, water: 0, safety: 0, morale: 0 },
    });
    this.list.push(settlement);
    this.save();
    return settlement;
  }

  disband(id) {
    const i = this.list.findIndex((s) => s.id === id);
    if (i >= 0) { this.list.splice(i, 1); this.save(); return true; }
    return false;
  }
}

function normalise(s) {
  s.structures ||= [];
  s.stockpiles ||= [];
  s.plots ||= [];
  s.log ||= [];
  s.stats ||= {};
  s.tier ??= 0;
  return s;
}

// --------------------------------------------------------------------------
// Planning
// --------------------------------------------------------------------------

/** What the settlement is short of, most urgent first. */
export function assess(settlement, memberCount) {
  const stats = recomputeStats(settlement);
  const wants = [];

  // Build one spare roof beyond the current population: a town with nowhere
  // for a newcomer to sleep never grows, and never reaches the next tier.
  const housingGap = memberCount + 1 - stats.housing;
  if (housingGap > 0) wants.push({ need: "housing", weight: 6 + housingGap * 2, blueprint: "small_house" });
  if (stats.food < Math.max(4, memberCount * 2)) wants.push({ need: "food", weight: 7, blueprint: "farm_plot" });
  if (stats.water < 1) wants.push({ need: "water", weight: 4, blueprint: "well" });
  if (stats.storage < memberCount * 2) wants.push({ need: "storage", weight: 5, blueprint: "storehouse" });
  if (stats.crafting < 2) wants.push({ need: "crafting", weight: 4.5, blueprint: "workshop" });
  if (stats.safety < memberCount) wants.push({ need: "safety", weight: 3.5, blueprint: "lamp_post" });
  if (stats.defence < 3) wants.push({ need: "defence", weight: 4, blueprint: "watchtower" });
  if (stats.culture < 3) wants.push({ need: "culture", weight: 2, blueprint: "shrine" });
  if (stats.civic < 5) wants.push({ need: "civic", weight: 3, blueprint: "town_hall" });

  const unlocked = unlockedBlueprints(settlement);
  return wants
    .filter((w) => unlocked.includes(w.blueprint))
    .sort((a, b) => b.weight - a.weight);
}

export function unlockedBlueprints(settlement) {
  const out = [];
  for (let i = 0; i <= settlement.tier && i < TIERS.length; i++) out.push(...TIERS[i].unlocks);
  return out;
}

export function recomputeStats(settlement) {
  const stats = { housing: 0, food: 0, storage: 0, defence: 0, civic: 0, culture: 0, crafting: 0, water: 0, safety: 0, morale: 0 };
  for (const st of settlement.structures) {
    if (st.status !== "done") continue;
    const bp = blueprintById(st.blueprintId);
    if (!bp || !bp.provides) continue;
    for (const [k, v] of Object.entries(bp.provides)) stats[k] = (stats[k] || 0) + v;
  }
  settlement.stats = stats;
  return stats;
}

/** Promotes the settlement when it has grown into the next tier. */
export function checkPromotion(settlement) {
  const next = TIERS[settlement.tier + 1];
  if (!next) return null;
  const stats = recomputeStats(settlement);
  for (const [k, v] of Object.entries(next.need)) {
    if ((stats[k] || 0) < v) return null;
  }
  settlement.tier += 1;
  logEvent(settlement, `grew into a ${next.name}`);
  return next.name;
}

/**
 * Queues the next structure the settlement needs, choosing a site on the plot
 * grid. Returns the new structure record, or null if nothing is needed or no
 * site could be found.
 */
export function planNext(settlement, dimension, memberCount) {
  const queued = settlement.structures.filter((s) => s.status !== "done").length;
  if (queued >= 3) return null;
  if (settlement.structures.length >= CONFIG.buildQueueLimit) return null;

  const wants = assess(settlement, memberCount);
  if (!wants.length) return null;

  for (const want of wants) {
    const bp = blueprintById(want.blueprint);
    if (!bp) continue;
    const alreadyQueued = settlement.structures.some(
      (s) => s.blueprintId === bp.id && s.status !== "done",
    );
    if (alreadyQueued) continue;

    const site = allocatePlot(settlement, dimension, bp);
    if (!site) continue;

    const record = {
      id: `b${settlement.structures.length}_${Date.now().toString(36)}`,
      blueprintId: bp.id,
      origin: site.origin,
      rotation: site.rotation,
      status: "planned",
      assignedTo: null,
      need: want.need,
      placed: 0,
      total: countCells(bp),
    };
    settlement.structures.push(record);
    logEvent(settlement, `planned a ${bp.name} to the ${compass(settlement.origin, site.origin)}`);
    return record;
  }
  return null;
}

function countCells(bp) {
  let n = 0;
  for (const layer of bp.layers) for (const row of layer) {
    for (const ch of row) if (ch !== " ") n++;
  }
  return n;
}

/** Walks outward in a ring pattern looking for unclaimed, buildable ground. */
export function allocatePlot(settlement, dimension, blueprint) {
  const step = Math.max(CONFIG.plotSize, Math.max(blueprint.width, blueprint.depth) + 3);
  const origin = settlement.origin;

  for (let ring = 1; ring <= 5; ring++) {
    const count = ring * 6;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + ring * 0.4;
      const cx = Math.round(origin.x + Math.cos(ang) * ring * step);
      const cz = Math.round(origin.z + Math.sin(ang) * ring * step);
      if (dist2d({ x: cx, z: cz }, origin) > CONFIG.settlementRadius) continue;
      if (plotTaken(settlement, cx, cz, step)) continue;

      const site = findBuildSite(dimension, { x: cx, y: origin.y, z: cz },
        blueprint.width, blueprint.depth, 10);
      if (!site) continue;

      const rotation = Math.round(Math.atan2(cz - origin.z, cx - origin.x) / (Math.PI / 2)) & 3;
      settlement.plots.push({ x: site.x, z: site.z, r: Math.max(blueprint.width, blueprint.depth) });
      return { origin: site, rotation };
    }
  }
  return null;
}

function plotTaken(settlement, x, z, step) {
  for (const p of settlement.plots) {
    if (Math.abs(p.x - x) < step * 0.85 && Math.abs(p.z - z) < step * 0.85) return true;
  }
  for (const s of settlement.structures) {
    if (Math.abs(s.origin.x - x) < step * 0.85 && Math.abs(s.origin.z - z) < step * 0.85) return true;
  }
  return false;
}

// --------------------------------------------------------------------------
// Stockpile
// --------------------------------------------------------------------------

/** Finds (and remembers) chests near the settlement centre. */
export function refreshStockpiles(settlement, dimension) {
  // Chests sit inside buildings, so search around the centre and around each
  // structure rather than sweeping the whole claim - that was tens of thousands
  // of block reads in a single tick.
  const found = [];
  const seen = new Set();
  const centres = [settlement.origin, ...settlement.structures.map((s) => s.origin)];

  for (const centre of centres.slice(0, 12)) {
    const R = 8;
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        for (let dy = -2; dy <= 5; dy++) {
          const pos = { x: centre.x + dx, y: centre.y + dy, z: centre.z + dz };
          const k = `${pos.x},${pos.y},${pos.z}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const t = blockType(dimension, pos.x, pos.y, pos.z);
          if (t === "minecraft:chest" || t === "minecraft:barrel") found.push(pos);
        }
      }
    }
    if (found.length > 24) break;
  }
  settlement.stockpiles = found;
  return found;
}

export function nearestStockpile(settlement, location) {
  let best = null, bestD = Infinity;
  for (const c of settlement.stockpiles) {
    const d = dist(location, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** Everything the town has in its chests, as a Map of itemId -> count. */
export function stockpileContents(settlement, dimension) {
  const total = new Map();
  for (const pos of settlement.stockpiles) {
    const container = openBlockContainer(dimension, pos);
    if (!container) continue;
    for (const [id, n] of containerContents(container)) {
      total.set(id, (total.get(id) || 0) + n);
    }
  }
  return total;
}

/** Items the current build queue still needs that the town does not have. */
export function shortages(settlement, dimension) {
  const stock = stockpileContents(settlement, dimension);
  const need = new Map();
  for (const st of settlement.structures) {
    if (st.status === "done") continue;
    const bp = blueprintById(st.blueprintId);
    if (!bp) continue;
    for (const [id, n] of materialsFor(bp)) {
      need.set(id, (need.get(id) || 0) + n);
    }
  }
  const out = [];
  for (const [id, n] of need) {
    const have = stock.get(id) || 0;
    if (have < n) out.push({ item: id, need: n, have, short: n - have });
  }
  return out.sort((a, b) => b.short - a.short);
}

// --------------------------------------------------------------------------
// Bookkeeping
// --------------------------------------------------------------------------
export function logEvent(settlement, text) {
  settlement.log.unshift({ day: world.getDay(), text: String(text).slice(0, 120) });
  if (settlement.log.length > 20) settlement.log.pop();
}

export function recentHistory(settlement, n = 5) {
  return settlement.log.slice(0, n).map((e) => `day ${e.day}: ${e.text}`);
}

export function describeSettlement(settlement, memberCount) {
  const stats = recomputeStats(settlement);
  const tier = TIERS[settlement.tier]?.name || "settlement";
  const done = settlement.structures.filter((s) => s.status === "done").length;
  const building = settlement.structures.filter((s) => s.status === "building").length;
  return [
    `${settlement.name} - a ${tier} founded on day ${settlement.founded} by ${settlement.founder}.`,
    `${memberCount} citizens, ${done} buildings finished, ${building} under construction.`,
    `Housing ${stats.housing}, food ${stats.food}, storage ${stats.storage}, defence ${stats.defence}.`,
  ].join(" ");
}

export function nextStructureFor(settlement) {
  return settlement.structures.find((s) => s.status === "planned" || s.status === "building") || null;
}

export function structureProgress(settlement) {
  const active = settlement.structures.filter((s) => s.status === "building");
  return active.map((s) => {
    const bp = blueprintById(s.blueprintId);
    return {
      name: bp ? bp.name : s.blueprintId,
      percent: s.total ? Math.round((s.placed / s.total) * 100) : 0,
    };
  });
}
