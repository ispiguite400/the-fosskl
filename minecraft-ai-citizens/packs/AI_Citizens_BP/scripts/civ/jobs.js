/**
 * Jobs turn "the town needs X" into "this citizen does Y next".
 *
 * Every job exposes `plan(citizen, ctx)` returning a single task (see
 * actions/registry.js) or null when there is nothing to do right now.
 */
import { CONFIG } from "../core/config.js";
import { debug } from "../core/log.js";
import { dist, prettyId, pick, compass } from "../core/util.js";
import { LOGS, ORES, isOre, CROPS, FOODS } from "../core/blocks.js";
import { RECIPES, findRecipe } from "../core/recipes.js";
import {
  gotoTask, exploreTask, patrolTask, storeTask, fetchTask, waitTask,
  chopTask, mineOreTask, gatherTask, buildTask, craftTask, farmTask,
  lightTask, fightTask, speakTask,
} from "../actions/registry.js";
import { cellsFromBlueprint } from "../actions/build.js";
import { blueprintById, materialsFor } from "./blueprints.js";
import {
  nextStructureFor, nearestStockpile, stockpileContents, shortages,
  refreshStockpiles, logEvent, planNext,
} from "./settlement.js";
import { findNearestBlock, mineTask } from "../actions/mine.js";
import { craftableNow, nextCraftableStep } from "../actions/craft.js";
import { isFull, summariseInventory } from "../actions/inventory.js";
import { surveyFields } from "../actions/farm.js";

export const JOBS = {
  settler: {
    name: "settler",
    blurb: "turns their hand to whatever the town needs",
    plan: planSettler,
  },
  lumberjack: {
    name: "woodcutter",
    blurb: "keeps the timber coming",
    plan: planLumberjack,
  },
  miner: {
    name: "miner",
    blurb: "brings up stone and ore",
    plan: planMiner,
  },
  builder: {
    name: "builder",
    blurb: "raises the buildings",
    plan: planBuilder,
  },
  farmer: {
    name: "farmer",
    blurb: "works the fields",
    plan: planFarmer,
  },
  guard: {
    name: "guard",
    blurb: "watches the walls",
    plan: planGuard,
  },
  crafter: {
    name: "crafter",
    blurb: "makes tools and fittings",
    plan: planCrafter,
  },
  hauler: {
    name: "hauler",
    blurb: "moves goods to the stores",
    plan: planHauler,
  },
  scout: {
    name: "scout",
    blurb: "maps the land",
    plan: planScout,
  },
  architect: {
    name: "architect",
    blurb: "decides what gets built next",
    plan: planArchitect,
  },
};

export function jobList() {
  return Object.keys(JOBS);
}

export function planJob(citizen, ctx) {
  const job = JOBS[citizen.job] || JOBS.settler;
  try {
    return job.plan(citizen, ctx) || null;
  } catch (e) {
    debug(`job ${citizen.job} failed to plan: ${e.message}`);
    return null;
  }
}

// --------------------------------------------------------------------------
// Individual jobs
// --------------------------------------------------------------------------

function planSettler(citizen, ctx) {
  // A settler does the most useful thing available, in rough priority order.
  return planLumberjack(citizen, ctx)
    || planBuilder(citizen, ctx)
    || planMiner(citizen, ctx)
    || planHauler(citizen, ctx)
    || exploreTask(36, { legs: 2 });
}

function planLumberjack(citizen, ctx) {
  if (isFull(citizen) || citizen.countItem("minecraft:oak_log") > 48) {
    return depositRun(citizen, ctx);
  }
  const tree = findNearestBlock(citizen, (t) => LOGS.has(t), 32);
  if (!tree) {
    // No trees in sight - go find some.
    return exploreTask(64, { legs: 2 });
  }
  return chopTask(16);
}

function planMiner(citizen, ctx) {
  if (isFull(citizen)) return depositRun(citizen, ctx);

  const ore = findNearestBlock(citizen, (t) => isOre(t), 22);
  if (ore) return mineOreTask(12);

  const stone = findNearestBlock(
    citizen,
    (t) => t === "minecraft:stone" || t === "minecraft:deepslate" || t === "minecraft:andesite",
    18,
  );
  if (stone && citizen.countItem("minecraft:cobblestone") < 96) {
    return gatherTask(
      (t) => t === "minecraft:stone" || t === "minecraft:deepslate" || t === "minecraft:andesite",
      18, 24, "quarrying",
    );
  }

  // Nothing worth digging within reach. Ore is deeper than a citizen can see,
  // so sink a shaft: a single mine target well below cuts a staircase down to
  // fresh rock, and the next plan searches again from there.
  const here = citizen.location;
  if (here.y > 12) {
    const depth = here.y > 40 ? 10 : 6;
    const shaft = mineTask(
      { x: Math.round(here.x), y: Math.round(here.y) - depth, z: Math.round(here.z) },
      { vein: false, limit: 1, label: "sinking a shaft" },
    );
    return shaft;
  }
  return exploreTask(40, { legs: 2 });
}

function planBuilder(citizen, ctx) {
  const settlement = ctx.settlement;
  if (!settlement) return null;

  let structure = nextStructureFor(settlement);
  if (!structure) {
    structure = planNext(settlement, ctx.dimension, ctx.memberCount);
    if (!structure) return null;
  }

  const bp = blueprintById(structure.blueprintId);
  if (!bp) return null;

  // Do we have enough on us to make progress? If not, fetch from the stores.
  const needed = materialsFor(bp);
  const inv = citizen.listInventory();
  let carryingSomethingUseful = false;
  for (const [id] of needed) if ((inv.get(id) || 0) > 0) { carryingSomethingUseful = true; break; }

  if (!carryingSomethingUseful) {
    const chest = nearestStockpile(settlement, citizen.location);
    if (chest) {
      const stock = stockpileContents(settlement, ctx.dimension);
      for (const [id, n] of needed) {
        if ((stock.get(id) || 0) > 0) {
          return fetchTask(chest, id, Math.min(n, 64));
        }
      }
    }
    // Nothing stored either - go make the missing material ourselves.
    const gap = [...needed.entries()].find(([id]) => (inv.get(id) || 0) === 0);
    if (gap) {
      const sourcing = sourceMaterial(citizen, ctx, gap[0]);
      if (sourcing) return sourcing;
    }
    return null;
  }

  structure.status = "building";
  structure.assignedTo = citizen.id;
  const cells = cellsFromBlueprint(bp, structure.origin, structure.rotation);
  const task = buildTask(cells, { label: `building the ${bp.name}`, projectId: structure.id });
  task.structureRef = structure.id;
  return task;
}

/** How a citizen gets hold of a material they lack. */
function sourceMaterial(citizen, ctx, itemId) {
  if (/_planks$/.test(itemId)) {
    if (citizen.listInventory().size && nextCraftableStep(citizen, itemId)) {
      return craftTask(nextCraftableStep(citizen, itemId), 8);
    }
    return chopTask(12);
  }
  if (itemId === "minecraft:cobblestone" || itemId === "minecraft:stone") {
    return gatherTask(
      (t) => t === "minecraft:stone" || t === "minecraft:cobblestone" || t === "minecraft:andesite",
      20, 24, "quarrying",
    );
  }
  if (itemId === "minecraft:dirt") {
    return gatherTask(
      (t) => t === "minecraft:dirt" || t === "minecraft:grass_block",
      14, 24, "digging soil",
    );
  }
  if (LOGS.has(itemId)) return chopTask(12);
  if (findRecipe(itemId)) {
    const step = nextCraftableStep(citizen, itemId);
    if (step) return craftTask(step, 1);
  }
  if (itemId === "minecraft:glass") {
    if (citizen.countItem("minecraft:sand") >= 4) return craftTask("minecraft:glass", 8);
    return gatherTask((t) => t === "minecraft:sand", 28, 12, "digging sand");
  }
  return null;
}

function planFarmer(citizen, ctx) {
  const settlement = ctx.settlement;
  const center = settlement ? settlement.origin : citizen.location;

  if (isFull(citizen)) return depositRun(citizen, ctx);

  // Harvest/plant around any field we know about.
  const field = findNearestBlock(
    citizen,
    (t) => CROPS[t] !== undefined || t === "minecraft:farmland",
    24,
  );
  if (field) return farmTask(field, 10);

  // No field yet: make one if the settlement has planned it, else prepare soil.
  if (settlement) {
    const planned = settlement.structures.find(
      (s) => s.blueprintId === "farm_plot" && s.status !== "done",
    );
    if (planned) return planBuilder(citizen, ctx);
  }
  if (citizen.countItem("minecraft:wheat_seeds") === 0) {
    return gatherTask((t) => t === "minecraft:short_grass" || t === "minecraft:tall_grass", 20, 12, "gathering seeds");
  }
  return farmTask(center, 12);
}

function planGuard(citizen, ctx) {
  const threat = citizen.snapshot?.threats?.[0];
  if (threat && threat.distance <= 20) {
    return fightTask(threat.id, { label: `fighting a ${threat.kind}` });
  }
  const settlement = ctx.settlement;
  const center = settlement ? settlement.origin : citizen.location;

  if (ctx.isNight && citizen.countItem("minecraft:torch") > 0) {
    return lightTask(center, 16);
  }
  return patrolTask(center, Math.min(20, CONFIG.settlementRadius / 2), 2);
}

function planCrafter(citizen, ctx) {
  const settlement = ctx.settlement;

  // 1. Cover the build queue's shortfall.
  if (settlement) {
    for (const gap of shortages(settlement, ctx.dimension).slice(0, 4)) {
      const step = nextCraftableStep(citizen, gap.item);
      if (step) return craftTask(step, Math.min(8, gap.short));
    }
  }
  // 2. Make sure the town is tooled up.
  for (const tool of ["minecraft:stone_pickaxe", "minecraft:stone_axe", "minecraft:stone_sword", "minecraft:torch", "minecraft:bread"]) {
    if (citizen.countItem(tool) >= 4) continue;
    const step = nextCraftableStep(citizen, tool);
    if (step) return craftTask(step, 4);
  }
  // 3. Otherwise convert raw stock into useful stock.
  const options = craftableNow(citizen);
  if (options.length) return craftTask(pick(options), 4);
  return depositRun(citizen, ctx) || null;
}

function planHauler(citizen, ctx) {
  const settlement = ctx.settlement;
  if (!settlement) return null;
  if (citizen.listInventory().size > 0) {
    const run = depositRun(citizen, ctx);
    if (run) return run;
  }
  // Collect from the citizen who is carrying the most surplus.
  const loaded = ctx.members
    .filter((m) => m.id !== citizen.id && m.freeSlots < 6)
    .sort((a, b) => a.freeSlots - b.freeSlots)[0];
  if (loaded) return gotoTask(loaded.location, { label: `going to help ${loaded.short}` });
  return waitTask(6, "waiting at the stores");
}

function planScout(citizen, ctx) {
  if (isFull(citizen)) return depositRun(citizen, ctx);
  return exploreTask(80, { legs: 4 });
}

function planArchitect(citizen, ctx) {
  const settlement = ctx.settlement;
  if (!settlement) return null;
  refreshStockpiles(settlement, ctx.dimension);
  const planned = planNext(settlement, ctx.dimension, ctx.memberCount);
  if (planned) {
    const bp = blueprintById(planned.blueprintId);
    return speakTask(`We should put the ${bp ? bp.name : "next building"} over there.`, { tone: "§b" });
  }
  // Nothing to plan: pitch in as a builder.
  return planBuilder(citizen, ctx) || patrolTask(settlement.origin, 14, 1);
}

// --------------------------------------------------------------------------
// Shared helpers
// --------------------------------------------------------------------------
function depositRun(citizen, ctx) {
  const settlement = ctx.settlement;
  if (!settlement) return null;
  if (!settlement.stockpiles.length) refreshStockpiles(settlement, ctx.dimension);
  const chest = nearestStockpile(settlement, citizen.location);
  if (!chest) return null;
  if (citizen.listInventory().size === 0) return null;
  return storeTask(chest, null);
}

/**
 * Chooses who does what. Called when a settlement's roster changes so the town
 * always has the cover it needs rather than nine woodcutters.
 */
export function assignJobs(settlement, members, dimension) {
  if (!members.length) return;
  const n = members.length;
  const quota = [];

  quota.push(["builder", Math.max(1, Math.round(n * 0.25))]);
  quota.push(["lumberjack", Math.max(1, Math.round(n * 0.18))]);
  quota.push(["miner", Math.max(1, Math.round(n * 0.18))]);
  quota.push(["farmer", Math.max(1, Math.round(n * 0.16))]);
  if (n >= 4) quota.push(["crafter", Math.max(1, Math.round(n * 0.1))]);
  if (n >= 5) quota.push(["guard", Math.max(1, Math.round(n * 0.12))]);
  if (n >= 7) quota.push(["hauler", 1]);
  if (n >= 8) quota.push(["scout", 1]);
  if (n >= 6) quota.push(["architect", 1]);

  const pool = members.slice();
  // Keep anyone a player has explicitly assigned.
  const locked = pool.filter((m) => m.jobLocked);
  const free = pool.filter((m) => !m.jobLocked);
  const counts = new Map();
  for (const m of locked) counts.set(m.job, (counts.get(m.job) || 0) + 1);

  let i = 0;
  for (const [job, want] of quota) {
    let have = counts.get(job) || 0;
    while (have < want && i < free.length) {
      free[i].setJob(job);
      i++; have++;
    }
    counts.set(job, have);
  }
  for (; i < free.length; i++) free[i].setJob("settler");
}

export function describeJob(job) {
  const def = JOBS[job];
  return def ? `${def.name} - ${def.blurb}` : job;
}
