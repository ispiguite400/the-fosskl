/** Tilling, sowing and harvesting - how a settlement stops being hungry. */
import { BlockPermutation } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import { safe } from "../core/log.js";
import { dist, centerOf, prettyId } from "../core/util.js";
import { CROPS } from "../core/blocks.js";
import { STATE } from "../agent/citizen.js";
import { travelTo, isTravelling, tickNavigation, stopTravel, blockType } from "./navigation.js";
import { giveItem, takeItem, equipTool, holdBlock } from "./inventory.js";
import { findNearestBlock, standingSpotFor, lookAt } from "./mine.js";

const TILLABLE = new Set(["minecraft:grass_block", "minecraft:dirt", "minecraft:coarse_dirt", "minecraft:rooted_dirt"]);

export function farmTask(center, radius = 8) {
  return {
    kind: "farm",
    center: { x: Math.floor(center.x), y: Math.floor(center.y), z: Math.floor(center.z) },
    radius,
    phase: "find",
    action: null,
    target: null,
    progress: 0,
    harvested: 0,
    planted: 0,
    attempts: 0,
    skip: new Set(),
    label: "farming",
  };
}

export function stepFarm(ctx, task) {
  const { citizen, tick } = ctx;
  const dim = citizen.dimension;

  if (task.phase === "find") {
    if (task.attempts > 8) return task.harvested || task.planted ? "done" : "failed";
    const job = findFarmJob(citizen, task);
    if (!job) return task.harvested || task.planted ? "done" : "failed";
    task.action = job.action;
    task.target = job.pos;
    task.cropId = job.cropId;
    task.phase = "approach";
    task.progress = 0;
    return "running";
  }

  const d = dist(citizen.location, centerOf(task.target));

  if (task.phase === "approach") {
    if (d <= CONFIG.reach) {
      stopTravel(citizen);
      citizen.setMode("work");
      lookAt(citizen, task.target);
      if (task.action === "till") equipTool(citizen, "hoe");
      task.phase = "work";
      task.progress = 0;
      return "running";
    }
    if (!isTravelling(citizen)) {
      const stand = standingSpotFor(dim, task.target, citizen.location);
      if (!stand || !travelTo(citizen, stand, { arrive: 1.6 })) { giveUp(task); return "running"; }
    }
    if (tickNavigation(citizen, tick) === "blocked") { giveUp(task); return "running"; }
    return "running";
  }

  citizen.setState(STATE.FARM);
  task.progress += ctx.elapsed;
  if (task.progress < 18) return "running";
  task.progress = 0;

  if (task.action === "harvest") {
    const crop = CROPS[task.cropId];
    const ok = safe("farm.harvest", () => {
      dim.getBlock(task.target).setType("minecraft:air");
      return true;
    }, false);
    if (ok && crop) {
      giveItem(citizen, crop.drop, 1 + Math.floor(Math.random() * 2));
      giveItem(citizen, crop.seed, 1);
      task.harvested += 1;
      // Immediately re-sow so the field keeps producing.
      safe("farm.resow", () => {
        dim.getBlock(task.target).setPermutation(BlockPermutation.resolve(task.cropId, { growth: 0 }));
      });
    }
  } else if (task.action === "till") {
    safe("farm.till", () => dim.getBlock(task.target).setType("minecraft:farmland"));
    safe("farm.sound", () => dim.playSound("use.gravel", citizen.location, { volume: 0.4 }));
  } else if (task.action === "plant") {
    const crop = CROPS[task.cropId];
    if (crop && takeItem(citizen, crop.seed, 1) > 0) {
      const ok = safe("farm.plant", () => {
        dim.getBlock({ x: task.target.x, y: task.target.y + 1, z: task.target.z })
          .setPermutation(BlockPermutation.resolve(task.cropId, { growth: 0 }));
        return true;
      }, false);
      if (ok) task.planted += 1;
    }
  }

  citizen.setState(STATE.IDLE);
  task.phase = "find";
  return "running";
}

function giveUp(task) {
  task.skip.add(`${task.target.x},${task.target.y},${task.target.z}`);
  task.attempts += 1;
  task.phase = "find";
}

function findFarmJob(citizen, task) {
  const dim = citizen.dimension;
  const c = task.center;
  const R = task.radius;
  const inv = citizen.listInventory();

  let tillCandidate = null;
  let plantCandidate = null;

  for (let dx = -R; dx <= R; dx++) {
    for (let dz = -R; dz <= R; dz++) {
      for (let dy = -2; dy <= 2; dy++) {
        const pos = { x: c.x + dx, y: c.y + dy, z: c.z + dz };
        if (task.skip.has(`${pos.x},${pos.y},${pos.z}`)) continue;
        const t = blockType(dim, pos.x, pos.y, pos.z);
        if (t === undefined) continue;

        // 1. Ripe crops always win.
        const crop = CROPS[t];
        if (crop) {
          const growth = safe("farm.growth", () => {
            const b = dim.getBlock(pos);
            return b ? b.permutation.getState("growth") : 0;
          }, 0);
          if (growth >= crop.mature) {
            return { action: "harvest", pos, cropId: t };
          }
          continue;
        }

        // 2. Empty farmland wants seed.
        if (t === "minecraft:farmland" && !plantCandidate) {
          const above = blockType(dim, pos.x, pos.y + 1, pos.z);
          if (above === "minecraft:air") {
            for (const [cropId, def] of Object.entries(CROPS)) {
              if ((inv.get(def.seed) || 0) > 0) {
                plantCandidate = { action: "plant", pos, cropId };
                break;
              }
            }
          }
          continue;
        }

        // 3. Otherwise break new ground near water.
        if (!tillCandidate && TILLABLE.has(t)) {
          const above = blockType(dim, pos.x, pos.y + 1, pos.z);
          if (above === "minecraft:air" && nearWater(dim, pos, 4)) {
            tillCandidate = { action: "till", pos };
          }
        }
      }
    }
  }
  return plantCandidate || tillCandidate;
}

function nearWater(dim, pos, radius) {
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const t = blockType(dim, pos.x + dx, pos.y, pos.z + dz);
      if (t === "minecraft:water" || t === "minecraft:flowing_water") return true;
    }
  }
  return false;
}

/** Counts food a settlement's fields should be producing. */
export function surveyFields(dimension, center, radius) {
  let planted = 0, ripe = 0, farmland = 0;
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dy = -2; dy <= 2; dy++) {
        const pos = { x: center.x + dx, y: center.y + dy, z: center.z + dz };
        const t = blockType(dimension, pos.x, pos.y, pos.z);
        if (t === "minecraft:farmland") farmland++;
        else if (CROPS[t]) {
          planted++;
          const growth = safe("farm.survey", () => dimension.getBlock(pos).permutation.getState("growth"), 0);
          if (growth >= CROPS[t].mature) ripe++;
        }
      }
    }
  }
  return { planted, ripe, farmland };
}
