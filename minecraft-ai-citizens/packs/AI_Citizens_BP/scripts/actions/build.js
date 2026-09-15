/** Placing blocks: from a single block up to a whole blueprint. */
import { BlockPermutation } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import { safe, debug } from "../core/log.js";
import { dist, centerOf, prettyId } from "../core/util.js";
import { isPassable, isProtected } from "../core/blocks.js";
import { STATE } from "../agent/citizen.js";
import { travelTo, isTravelling, tickNavigation, stopTravel, blockType, snapToGround } from "./navigation.js";
import { takeItem, hasItems, holdBlock } from "./inventory.js";
import { standingSpotFor, lookAt } from "./mine.js";
import { resolveTag } from "../core/recipes.js";

export function placeTask(pos, typeId, opts = {}) {
  return {
    kind: "place",
    target: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
    typeId,
    states: opts.states || null,
    // `costs` names the item consumed when it differs from the block placed
    // (farmland costs dirt); `free` places without consuming anything.
    costs: opts.costs === undefined ? typeId : opts.costs,
    free: Boolean(opts.free),
    phase: "approach",
    progress: 0,
    label: opts.label || `placing ${prettyId(typeId)}`,
  };
}

/**
 * Build a whole structure.
 * @param {Array<{x,y,z,block,states?}>} cells absolute positions
 */
export function buildTask(cells, opts = {}) {
  return {
    kind: "build",
    cells: cells.slice(),
    index: 0,
    label: opts.label || "building",
    projectId: opts.projectId || null,
    placed: 0,
    missing: new Map(),
    current: null,
    clearFirst: opts.clearFirst !== false,
  };
}

export function stepPlace(ctx, task) {
  const { citizen, tick } = ctx;
  const dim = citizen.dimension;
  const existing = blockType(dim, task.target.x, task.target.y, task.target.z);
  if (existing === undefined) return "failed";

  if (existing === task.typeId) return "done";
  if (!isPassable(existing) && isProtected(existing)) return "failed";

  const d = dist(citizen.location, centerOf(task.target));

  if (task.phase === "approach") {
    if (d <= CONFIG.reach) {
      task.phase = "work";
      task.progress = 0;
      stopTravel(citizen);
      citizen.setMode("work");
      holdBlock(citizen, task.typeId);
      lookAt(citizen, task.target);
      return "running";
    }
    if (!isTravelling(citizen)) {
      const stand = standingSpotFor(dim, task.target, citizen.location);
      if (!stand || !travelTo(citizen, stand, { arrive: 1.6, allowMining: true })) return "failed";
    }
    if (tickNavigation(citizen, tick) === "blocked") return "failed";
    return "running";
  }

  if (d > CONFIG.reach + 1.5) { task.phase = "approach"; return "running"; }

  citizen.setState(STATE.BUILD);
  task.progress += ctx.elapsed;
  if (task.progress < CONFIG.placeTicksPerBlock) return "running";

  if (!task.free && takeItem(citizen, task.costs || task.typeId, 1) < 1) return "nomaterial";

  const ok = safe("build.place", () => {
    const block = dim.getBlock(task.target);
    if (!block) return false;
    if (task.states) {
      block.setPermutation(BlockPermutation.resolve(task.typeId, task.states));
    } else {
      block.setType(task.typeId);
    }
    return true;
  }, false);

  if (!ok) return "failed";
  safe("build.sound", () => dim.playSound("use.stone", citizen.location, { volume: 0.5, pitch: 1.0 }));
  citizen.setState(STATE.IDLE);
  return "done";
}

export function stepBuild(ctx, task) {
  const { citizen } = ctx;

  if (task.current) {
    const r = stepPlace(ctx, task.current);
    if (r === "running") return "running";
    if (r === "done") task.placed += 1;
    if (r === "nomaterial") {
      const id = task.current.typeId;
      task.missing.set(id, (task.missing.get(id) || 0) + 1);
      task.blockedOn = id;
      task.current = null;
      task.index += 1;
      return "running";
    }
    task.current = null;
    task.index += 1;
    return "running";
  }

  // Find the next cell that still needs work.
  while (task.index < task.cells.length) {
    const cell = task.cells[task.index];
    const existing = blockType(citizen.dimension, cell.x, cell.y, cell.z);
    if (existing === undefined) { task.index += 1; continue; }

    if (cell.block === "minecraft:air") {
      // Clearing a cell is a place-with-nothing: just remove it if allowed.
      if (existing !== "minecraft:air" && !isProtected(existing)) {
        safe("build.clear", () => citizen.dimension.getBlock(cell).setType("minecraft:air"));
      }
      task.index += 1;
      continue;
    }
    if (existing === cell.block) { task.index += 1; continue; }

    if (cell.free) {
      task.current = placeTask(cell, cell.block, { states: cell.states || null, free: true });
      return "running";
    }
    const wantedItem = cell.costs || cell.block;
    const material = pickMaterial(citizen, wantedItem);
    if (!material) {
      if (cell.optional) { task.index += 1; continue; }   // furniture is a nicety
      task.missing.set(wantedItem, (task.missing.get(wantedItem) || 0) + 1);
      task.blockedOn = wantedItem;
      task.index += 1;
      continue;
    }
    task.current = placeTask(cell, cell.block, {
      states: cell.states || null,
      costs: material,
    });
    return "running";
  }

  return task.placed > 0 || task.missing.size === 0 ? "done" : "failed";
}

/** Accepts any plank/log variant when a blueprint asks for a generic one. */
function pickMaterial(citizen, wanted) {
  const inv = citizen.listInventory();
  if ((inv.get(wanted) || 0) > 0) return wanted;
  const alternatives = ALTERNATIVES[wanted];
  if (alternatives) {
    for (const alt of alternatives) if ((inv.get(alt) || 0) > 0) return alt;
  }
  return null;
}

const ALTERNATIVES = {
  "minecraft:oak_slab": ["minecraft:oak_slab", "minecraft:spruce_slab", "minecraft:birch_slab", "minecraft:oak_planks"],
  "minecraft:cobblestone_slab": ["minecraft:cobblestone_slab", "minecraft:stone_slab", "minecraft:cobblestone"],
  "minecraft:oak_fence": ["minecraft:oak_fence", "minecraft:spruce_fence", "minecraft:birch_fence"],
  "minecraft:dirt": ["minecraft:dirt", "minecraft:coarse_dirt", "minecraft:grass_block"],
  "minecraft:red_bed": ["minecraft:red_bed", "minecraft:white_bed", "minecraft:bed"],
  "minecraft:oak_planks": resolveTag("any_planks"),
  "minecraft:oak_log": resolveTag("any_log"),
  "minecraft:cobblestone": ["minecraft:cobblestone", "minecraft:stone", "minecraft:cobbled_deepslate", "minecraft:andesite"],
  "minecraft:stone": ["minecraft:stone", "minecraft:cobblestone", "minecraft:andesite", "minecraft:deepslate"],
  "minecraft:glass": ["minecraft:glass", "minecraft:glass_pane"],
  "minecraft:torch": ["minecraft:torch", "minecraft:lantern"],
  "minecraft:oak_door": ["minecraft:oak_door", "minecraft:spruce_door", "minecraft:birch_door"],
};

/** Everything the blueprint still needs, as [itemId, count] pairs. */
export function shoppingList(task) {
  return [...task.missing.entries()].sort((a, b) => b[1] - a[1]);
}

/** Flattens a blueprint (see civ/blueprints.js) into absolute cells. */
export function cellsFromBlueprint(blueprint, origin, rotation = 0) {
  const cells = [];
  const { layers, palette, anchor } = blueprint;
  const ax = anchor?.x ?? 0, ay = anchor?.y ?? 0, az = anchor?.z ?? 0;

  for (let y = 0; y < layers.length; y++) {
    const rows = layers[y];
    for (let z = 0; z < rows.length; z++) {
      const row = rows[z];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === " ") continue;                 // untouched
        const entry = palette[ch];
        if (entry === undefined) continue;
        const local = rotate({ x: x - ax, y: y - ay, z: z - az }, rotation);
        const isObj = typeof entry === "object";
        cells.push({
          x: origin.x + local.x,
          y: origin.y + local.y,
          z: origin.z + local.z,
          block: isObj ? entry.block : entry,
          states: isObj ? entry.states || null : null,
          costs: isObj ? entry.costs || null : null,
          free: isObj ? Boolean(entry.free) : false,
          optional: isObj ? Boolean(entry.optional) : false,
        });
      }
    }
  }
  // Build bottom-up so citizens never place a block they cannot reach.
  cells.sort((a, b) => a.y - b.y);
  return cells;
}

function rotate(p, quarterTurns) {
  let { x, z } = p;
  for (let i = 0; i < ((quarterTurns % 4) + 4) % 4; i++) {
    const nx = -z, nz = x;
    x = nx; z = nz;
  }
  return { x, y: p.y, z };
}

/** Finds flat-enough ground for a footprint, near `near`. */
export function findBuildSite(dimension, near, width, depth, maxRadius = 32) {
  let best = null, bestScore = Infinity;
  for (let r = 4; r <= maxRadius; r += 4) {
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const cx = Math.round(near.x + Math.cos(ang) * r);
      const cz = Math.round(near.z + Math.sin(ang) * r);
      const score = flatnessAt(dimension, cx, cz, near.y, width, depth);
      if (score === null) continue;
      const penalty = score.roughness + r * 0.05;
      if (penalty < bestScore) {
        bestScore = penalty;
        best = { x: cx, y: score.y, z: cz };
      }
    }
    if (best && bestScore < 3) break;
  }
  return best;
}

function flatnessAt(dimension, cx, cz, refY, width, depth) {
  const half = Math.floor(width / 2), halfD = Math.floor(depth / 2);
  let min = Infinity, max = -Infinity, samples = 0;
  for (let dx = -half; dx <= half; dx += Math.max(1, Math.floor(width / 3))) {
    for (let dz = -halfD; dz <= halfD; dz += Math.max(1, Math.floor(depth / 3))) {
      const g = snapToGround(dimension, { x: cx + dx + 0.5, y: refY, z: cz + dz + 0.5 }, refY);
      if (!g) return null;
      min = Math.min(min, g.y);
      max = Math.max(max, g.y);
      samples++;
    }
  }
  if (!samples || max - min > 4) return null;
  return { y: Math.round((min + max) / 2), roughness: max - min };
}
