/**
 * Living like a player.
 *
 * Told to get on with it, a citizen stops being a miner or a farmer and starts
 * being a person dropped into a world with nothing. That is a different shape
 * of decision from the job planner: a job asks "what does my trade need doing
 * next", and this asks "what would I do next if I had just spawned here".
 *
 * So it is a ladder, checked top to bottom, and the first rung that is not yet
 * satisfied is the thing they do:
 *
 *   dark and nowhere to sleep   dig in
 *   no wood                     chop a tree
 *   no table, no tools          craft them, gathering what the recipe needs
 *   no stone                    mine some
 *   nothing to eat              hunt, or work the fields
 *   no torches                  find coal, make light
 *   nowhere to live             build a house
 *   no iron                     go down and find some
 *   comfortable                 improve the place, then go and look at the world
 *
 * Every rung is a real task the body already knows how to run, and the crafting
 * rungs walk the recipe tree backwards, so "I want a stone pickaxe" turns into
 * "so I need sticks, so I need planks, so I need a log" on its own.
 *
 * A rung that cannot be satisfied is skipped for a while rather than retried
 * forever - there may simply be no sheep on this island.
 */
import { CONFIG } from "../core/config.js";
import { dist } from "../core/util.js";
import { LOGS, isOre } from "../core/blocks.js";
import { resolveTag } from "../core/recipes.js";
import { findFood, isFull } from "../actions/inventory.js";
import { findNearestBlock, gatherTask, excavateTask, mineTask } from "../actions/mine.js";
import { nextCraftableStep } from "../actions/craft.js";
import { craftTask } from "../actions/craft.js";
import { fightTask } from "../actions/combat.js";
import { farmTask } from "../actions/farm.js";
import { buildTask, placeTask, cellsFromBlueprint, findBuildSite } from "../actions/build.js";
import { findBedNear } from "../actions/interact.js";
import { blockType } from "../actions/navigation.js";
import { isPassable } from "../core/blocks.js";
import { exploreTask, gotoTask, storeTask } from "../actions/registry.js";
import { blueprintById } from "../civ/blueprints.js";
import { hollowCells } from "../civ/shapes.js";

/** How many times a rung may be picked with nothing to show for it. */
const PATIENCE = 4;
/** How long a rung stays set aside, in ticks. */
const COOLDOWN = 20 * 45;
/** How far they will wander from their workbench before heading back. */
const LEASH = 44;

const ORE_BLOCKS = {
  coal: ["minecraft:coal_ore", "minecraft:deepslate_coal_ore"],
  iron: ["minecraft:iron_ore", "minecraft:deepslate_iron_ore"],
};
const STONE_BLOCKS = ["minecraft:stone", "minecraft:cobblestone", "minecraft:andesite",
                      "minecraft:granite", "minecraft:diorite", "minecraft:deepslate"];

function count(citizen, idOrTag) {
  let total = 0;
  for (const id of resolveTag(idOrTag)) total += citizen.countItem(id);
  return total;
}

/** Any tool of that kind, whatever it is made of. */
function hasTool(citizen, kind) {
  const inv = citizen.listInventory();
  for (const id of inv.keys()) if (id.includes(kind)) return true;
  return false;
}

/**
 * How much wood they have, counting planks and sticks back toward logs.
 *
 * Counting logs alone makes the ladder oscillate: crafting planks spends logs,
 * so the wood rung fires again, chops one tree, crafts again, and they never
 * climb past it. One number for all forms of wood, with a target well above
 * what the next few rungs spend, settles it.
 */
function woodValue(citizen) {
  return count(citizen, "any_log")
    + Math.floor(count(citizen, "any_planks") / 4)
    + Math.floor(citizen.countItem("minecraft:stick") / 8);
}

function hasAnyFood(citizen) {
  return Boolean(findFood(citizen));
}

/**
 * Craft something, working backwards through what it is made of. When the raw
 * material is missing entirely, `whenStuck` goes and gets it.
 */
function craftToward(citizen, goalId, whenStuck) {
  const step = nextCraftableStep(citizen, goalId);
  if (step) return craftTask(step, 1);
  return whenStuck ? whenStuck() : null;
}

/**
 * A crude measure of whether anything is happening.
 *
 * Patience has to count failures, not turns: chopping sixteen logs takes
 * several task cycles, and a rung benched for taking a while is a rung that
 * never completes. If the pockets changed since this rung was last picked,
 * something is working, so the count resets.
 */
function progressMark(citizen) {
  let total = 0;
  for (const n of citizen.listInventory().values()) total += n;
  return total;
}

/** Is there one of these blocks already standing nearby? */
function stationNear(citizen, typeId, radius = 16) {
  return Boolean(findNearestBlock(citizen, (t) => t === typeId, radius, null, 1400, true));
}

/**
 * Somewhere beside them to put a workbench down.
 *
 * Crafting anything worth having needs a table standing in the world, not one
 * in your pocket - which is why a citizen with a table in their inventory and
 * nowhere to put it got stuck holding sticks forever.
 */
function spotBeside(citizen) {
  const dim = citizen.dimension;
  const base = citizen.location;
  // Rings outward, and a step up as well as level, because a citizen standing
  // in the hole they just dug has nothing clear beside them at their own feet.
  for (let r = 1; r <= 3; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (const dy of [0, 1, -1]) {
          const x = Math.floor(base.x) + dx;
          const y = Math.floor(base.y) + dy;
          const z = Math.floor(base.z) + dz;
          const here = blockType(dim, x, y, z);
          const below = blockType(dim, x, y - 1, z);
          if (here === undefined || below === undefined) continue;
          const clear = isPassable(here) || here === "minecraft:air";
          const solid = !isPassable(below) && below !== "minecraft:air";
          if (clear && solid) return { x, y, z };
        }
      }
    }
  }
  return null;
}

/** The nearest creature worth eating. */
function huntable(citizen) {
  const animals = citizen.snapshot?.animals || [];
  return animals.length ? animals[0] : null;
}

/** Somewhere to put a building. */
function siteFor(citizen, ctx, blueprint) {
  if (typeof ctx.chooseBuildSite === "function") {
    const plot = ctx.chooseBuildSite(citizen, blueprint);
    if (plot) return plot;
  }
  const site = findBuildSite(citizen.dimension, citizen.location, blueprint.width, blueprint.depth, 28);
  return site ? { origin: site, rotation: 0 } : null;
}

function buildOne(citizen, ctx, blueprintId, label) {
  const bp = blueprintById(blueprintId);
  if (!bp) return null;
  const site = siteFor(citizen, ctx, bp);
  if (!site) return null;
  return buildTask(cellsFromBlueprint(bp, site.origin, site.rotation || 0),
    { label, projectId: site.structureId || null });
}

// --------------------------------------------------------------------------
// The ladder
// --------------------------------------------------------------------------
const RUNGS = [
  {
    id: "shelter",
    label: "digging in for the night",
    // A player caught out after dark digs into the nearest bank rather than
    // standing in the open.
    wanted: (c, ctx) => ctx.isNight && !findBedNear(c.dimension, c.location, 24)
      && c.location.y > 50,
    plan: (c) => {
      const view = c.entity?.getViewDirection?.() || { x: 1, z: 0 };
      const len = Math.hypot(view.x, view.z) || 1;
      const face = { x: view.x / len, z: view.z / len };
      return excavateTask(hollowCells(c.location, face, 3, 1, 2),
        { label: "digging in for the night" });
    },
  },
  {
    id: "wood",
    label: "getting wood",
    wanted: (c) => woodValue(c) < 10,
    plan: (c) => (findNearestBlock(c, (t) => LOGS.has(t), 40)
      ? gatherTask((t) => LOGS.has(t), 40, 16, "getting wood")
      : exploreTask(64, { legs: 2 })),
  },
  {
    id: "table",
    label: "making a crafting table",
    // A table already standing counts. Without this they craft one, put it
    // down, notice their pockets are empty and craft another, forever.
    wanted: (c) => c.countItem("minecraft:crafting_table") < 1
      && !stationNear(c, "minecraft:crafting_table"),
    plan: (c) => craftToward(c, "minecraft:crafting_table", null),
  },
  {
    id: "workbench",
    label: "setting up a workbench",
    // A table in your pocket crafts nothing. Put it down first.
    wanted: (c) => c.countItem("minecraft:crafting_table") >= 1
      && !stationNear(c, "minecraft:crafting_table"),
    plan: (c) => {
      const spot = spotBeside(c);
      if (!spot) return null;
      // Wherever the workbench goes is home from now on.
      c.baseSpot = { x: spot.x, y: spot.y, z: spot.z, dimensionId: c.dimension.id };
      return placeTask(spot, "minecraft:crafting_table",
        { label: "setting up a workbench" });
    },
  },
  {
    id: "woodpick",
    label: "making a pickaxe",
    wanted: (c) => !hasTool(c, "pickaxe"),
    plan: (c) => craftToward(c, "minecraft:wooden_pickaxe", null),
  },
  {
    id: "stone",
    label: "mining stone",
    wanted: (c) => hasTool(c, "pickaxe") && c.countItem("minecraft:cobblestone") < 24,
    plan: (c) => gatherTask((t) => STONE_BLOCKS.includes(t), 24, 32, "mining stone"),
  },
  {
    id: "stonetools",
    label: "making better tools",
    wanted: (c) => c.countItem("minecraft:cobblestone") >= 5
      && !(hasTool(c, "stone_pickaxe") && hasTool(c, "stone_sword")),
    plan: (c) => craftToward(c,
      hasTool(c, "stone_pickaxe") ? "minecraft:stone_sword" : "minecraft:stone_pickaxe", null),
  },
  {
    id: "food",
    label: "finding food",
    // Only when they are actually getting hungry. Standing in a field on a
    // full stomach is not what a player does, and a rung that can never be
    // satisfied - no animals on this island - would block the ladder.
    wanted: (c) => c.needs.hunger < 55 && !hasAnyFood(c),
    plan: (c) => {
      const prey = huntable(c);
      if (prey) return fightTask(prey.id, { label: `hunting a ${prey.kind}` });
      return farmTask(c.location, 14);
    },
  },
  {
    id: "torches",
    label: "making light",
    wanted: (c) => c.countItem("minecraft:torch") < 6,
    plan: (c) => {
      if (c.countItem("minecraft:coal") >= 1) return craftToward(c, "minecraft:torch", null);
      return findNearestBlock(c, (t) => ORE_BLOCKS.coal.includes(t), 28)
        ? gatherTask((t) => ORE_BLOCKS.coal.includes(t), 28, 6, "looking for coal")
        : null;
    },
  },
  {
    id: "furnace",
    label: "building a furnace",
    wanted: (c) => c.countItem("minecraft:furnace") < 1
      && !stationNear(c, "minecraft:furnace")
      && c.countItem("minecraft:cobblestone") >= 8,
    plan: (c) => craftToward(c, "minecraft:furnace", null),
  },
  {
    id: "setfurnace",
    label: "setting up a furnace",
    wanted: (c) => c.countItem("minecraft:furnace") >= 1
      && !stationNear(c, "minecraft:furnace"),
    plan: (c) => {
      const spot = spotBeside(c);
      return spot ? placeTask(spot, "minecraft:furnace",
        { label: "setting up a furnace" }) : null;
    },
  },
  {
    id: "smelt",
    label: "smelting what they dug up",
    // Ore is not iron. A furnace standing nearby is what turns one into the
    // other, and without this rung they mine raw iron forever and never make a
    // tool out of it.
    wanted: (c) => c.countItem("minecraft:raw_iron") >= 1
      && stationNear(c, "minecraft:furnace"),
    plan: (c) => craftToward(c, "minecraft:iron_ingot", null),
  },
  {
    id: "house",
    label: "building somewhere to live",
    // Nobody starts a house with four planks. Wait until there is enough to
    // finish one, the way a player does.
    wanted: (c) => (c.homesBuilt || 0) < 1
      && (count(c, "any_planks") >= 16 || c.countItem("minecraft:cobblestone") >= 24),
    plan: (c, ctx) => buildOne(c, ctx, "small_house", "building somewhere to live"),
    done: (c) => { c.homesBuilt = (c.homesBuilt || 0) + 1; },
  },
  {
    id: "iron",
    label: "looking for iron",
    wanted: (c) => hasTool(c, "stone_pickaxe")
      && c.countItem("minecraft:raw_iron") + c.countItem("minecraft:iron_ingot") < 3,
    plan: (c) => {
      if (findNearestBlock(c, (t) => ORE_BLOCKS.iron.includes(t), 28)) {
        return gatherTask((t) => ORE_BLOCKS.iron.includes(t), 28, 6, "mining iron");
      }
      // None in sight - go deeper, the way a player does.
      const floorY = Math.max(-50, Math.floor(c.location.y) - 12);
      return mineTask({ x: c.location.x, y: floorY, z: c.location.z },
        { vein: true, label: "going deeper" });
    },
  },
  {
    id: "irontools",
    label: "making iron tools",
    wanted: (c) => c.countItem("minecraft:iron_ingot") >= 3 && !hasTool(c, "iron_pickaxe"),
    plan: (c) => craftToward(c, "minecraft:iron_pickaxe", null),
  },
  {
    id: "chest",
    label: "making somewhere to put things",
    wanted: (c) => c.countItem("minecraft:chest") < 1 && count(c, "any_planks") >= 8,
    plan: (c) => craftToward(c, "minecraft:chest", null),
  },
  {
    id: "unload",
    label: "putting things away",
    wanted: (c, ctx) => isFull(c) && Boolean(ctx.settlement),
    plan: (c, ctx) => {
      const chest = (ctx.settlement.stockpiles || [])[0];
      return chest ? storeTask(chest, null) : null;
    },
  },
  {
    id: "backtobase",
    label: "heading back to their workbench",
    // Without this they place a workbench, wander off looking for trees, and
    // can never craft again because the bench is forty blocks behind them.
    wanted: (c) => Boolean(c.baseSpot)
      && c.baseSpot.dimensionId === c.dimension.id
      && dist(c.location, c.baseSpot) > LEASH,
    plan: (c) => gotoTask(c.baseSpot, { arrive: 4, label: "heading back to their workbench" }),
  },
  {
    id: "improve",
    label: "improving the place",
    wanted: (c, ctx) => Boolean(ctx.settlement),
    plan: (c, ctx) => {
      // Whatever the town has least of, in the order a settlement needs them.
      for (const id of ["farm_plot", "storehouse", "well", "workshop", "lamp_post"]) {
        const task = buildOne(c, ctx, id, "improving the place");
        if (task) return task;
      }
      return null;
    },
  },
];

/**
 * What this citizen would do next, left to themselves.
 * @returns {null|{kind, label, score, build}} shaped like the other candidates
 *          in brain/local.js, so the planner can weigh it against survival.
 */
export function freePlayGoal(citizen, ctx) {
  if (!citizen.freeplay) citizen.freeplay = { skips: {}, tries: {}, rung: null };
  const state = citizen.freeplay;
  if (!state.tries) state.tries = {};
  if (!state.skips) state.skips = {};

  for (const rung of RUNGS) {
    if (ctx.tick < (state.skips[rung.id] || 0)) continue;

    let wanted = false;
    try { wanted = rung.wanted(citizen, ctx); } catch { wanted = false; }
    if (!wanted) { state.tries[rung.id] = 0; continue; }

    let task = null;
    try { task = rung.plan(citizen, ctx); } catch { task = null; }

    // Attempts are counted per rung, not for whichever was last. A rung the
    // world cannot supply - no trees, no sheep, no iron within reach - has to
    // be set aside on its own account, or everything below it waits forever
    // while the citizen shuttles between two rungs it can satisfy.
    if (!state.mark) state.mark = {};
    const mark = progressMark(citizen);
    if (state.mark[rung.id] !== mark) {
      state.mark[rung.id] = mark;
      state.tries[rung.id] = 0;
    }
    const tries = (state.tries[rung.id] || 0) + 1;
    state.tries[rung.id] = tries;
    if (!task || tries > PATIENCE) {
      state.skips[rung.id] = ctx.tick + COOLDOWN;
      state.tries[rung.id] = 0;
      continue;
    }

    state.rung = rung.id;
    if (rung.done) { try { rung.done(citizen); } catch { /* best effort */ } }

    return { kind: "freeplay", label: rung.label, score: 62, build: () => task };
  }

  // Everything on the ladder is satisfied, or set aside for the moment.
  //
  // Wandering far is the wrong answer while a rung is only benched: the
  // workbench and furnace they need are back where they left them, and a
  // citizen who sprints seventy blocks away cannot use either. So they potter
  // about near home, and only really strike out once there is nothing left on
  // the ladder at all.
  state.rung = null;
  const benched = Object.values(state.skips).some((until) => ctx.tick < until);
  const roam = benched ? 20 : 64;
  return {
    kind: "freeplay",
    label: benched ? "pottering about" : "seeing what's out there",
    score: 34,
    build: () => exploreTask(roam, { legs: benched ? 1 : 3 }),
  };
}

/** Which rung they are on, for the panel and for `ai! what are you doing`. */
export function freePlayStage(citizen) {
  return citizen.freeplay?.rung || null;
}

export const FREEPLAY_RUNGS = RUNGS.map((r) => r.id);
