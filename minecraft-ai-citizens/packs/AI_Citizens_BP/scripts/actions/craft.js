/** Crafting and smelting at a table, a furnace, or by hand. */
import { CONFIG } from "../core/config.js";
import { safe } from "../core/log.js";
import { dist, prettyId, centerOf } from "../core/util.js";
import { findRecipe, resolveTag, RECIPES } from "../core/recipes.js";
import { STATE } from "../agent/citizen.js";
import { travelTo, isTravelling, tickNavigation, stopTravel } from "./navigation.js";
import { hasItems, consume, giveItem, holdBlock } from "./inventory.js";
import { findNearestBlock, standingSpotFor, lookAt } from "./mine.js";

const STATION_BLOCK = {
  crafting: "minecraft:crafting_table",
  furnace: "minecraft:furnace",
};

export function craftTask(outputId, count = 1) {
  return {
    kind: "craft",
    outputId,
    count,
    made: 0,
    phase: "check",
    progress: 0,
    station: null,
    label: `crafting ${prettyId(outputId)}`,
  };
}

export function stepCraft(ctx, task) {
  const { citizen, tick } = ctx;
  const recipe = findRecipe(task.outputId);
  if (!recipe) return "failed";

  if (task.made >= task.count) return "done";

  if (task.phase === "check") {
    if (!hasItems(citizen, recipe.inputs)) return "nomaterial";
    if (!recipe.station) { task.phase = "work"; task.progress = 0; return "running"; }
    const wanted = STATION_BLOCK[recipe.station];
    // A station is there to be used, not mined, so the protected-block guard
    // must not hide it.
    const found = findNearestBlock(citizen, (t) => t === wanted, 20, null, 1400, true);
    if (!found) { task.needsStation = wanted; return "nostation"; }
    task.station = found;
    task.phase = "approach";
    return "running";
  }

  if (task.phase === "approach") {
    const d = dist(citizen.location, centerOf(task.station));
    if (d <= CONFIG.reach) {
      stopTravel(citizen);
      citizen.setMode("work");
      lookAt(citizen, task.station);
      task.phase = "work";
      task.progress = 0;
      return "running";
    }
    if (!isTravelling(citizen)) {
      const stand = standingSpotFor(citizen.dimension, task.station, citizen.location);
      if (!stand || !travelTo(citizen, stand, { arrive: 1.6 })) return "failed";
    }
    if (tickNavigation(citizen, tick) === "blocked") return "failed";
    return "running";
  }

  // --- working ----------------------------------------------------------
  citizen.setState(STATE.CRAFT);
  task.progress += ctx.elapsed;
  const duration = recipe.station === "furnace" ? 60 : 24;
  if (task.progress < duration) return "running";

  if (!consume(citizen, recipe.inputs)) return "nomaterial";
  giveItem(citizen, recipe.out, recipe.count);
  task.made += recipe.count;
  task.progress = 0;
  safe("craft.sound", () => {
    citizen.dimension.playSound(
      recipe.station === "furnace" ? "random.fizz" : "random.anvil_use",
      citizen.location, { volume: 0.35, pitch: 1.2 },
    );
  });
  holdBlock(citizen, recipe.out);
  citizen.setState(STATE.IDLE);
  return task.made >= task.count ? "done" : "running";
}

/**
 * Works out what a citizen would have to craft first to reach `goalId`.
 * Returns the deepest recipe they can actually make right now, or null.
 */
export function nextCraftableStep(citizen, goalId, depth = 0) {
  if (depth > 3) return null;
  const recipe = findRecipe(goalId);
  if (!recipe) return null;
  if (hasItems(citizen, recipe.inputs)) return goalId;

  for (const [idOrTag, need] of recipe.inputs) {
    const ids = resolveTag(idOrTag);
    const inv = citizen.listInventory();
    let have = 0;
    for (const id of ids) have += inv.get(id) || 0;
    if (have >= need) continue;
    for (const id of ids) {
      const sub = nextCraftableStep(citizen, id, depth + 1);
      if (sub) return sub;
    }
  }
  return null;
}

/** Everything the citizen could make right now, cheapest first. */
export function craftableNow(citizen) {
  return RECIPES.filter((r) => hasItems(citizen, r.inputs)).map((r) => r.out);
}
