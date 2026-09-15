/** Doors, beds, torches, sitting, eating - the small human things. */
import { BlockPermutation } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import { safe } from "../core/log.js";
import { dist, centerOf, prettyId } from "../core/util.js";
import { STATE } from "../agent/citizen.js";
import { travelTo, isTravelling, tickNavigation, stopTravel, blockType } from "./navigation.js";
import { takeItem, findFood, holdBlock } from "./inventory.js";
import { findNearestBlock, standingSpotFor, lookAt } from "./mine.js";
import { feed, rest } from "../agent/needs.js";

export function eatTask() {
  return { kind: "eat", phase: "start", progress: 0, label: "eating" };
}

export function stepEat(ctx, task) {
  const { citizen } = ctx;
  if (task.phase === "start") {
    const food = findFood(citizen);
    if (!food) return "failed";
    task.food = food;
    task.phase = "eating";
    task.progress = 0;
    holdBlock(citizen, food.typeId);
    citizen.setMode("work");
    return "running";
  }

  citizen.setState(STATE.SIT);
  task.progress += ctx.elapsed;
  if (task.progress < 32) return "running";

  if (takeItem(citizen, task.food.typeId, 1) < 1) return "failed";
  feed(citizen, task.food.nutrition);
  safe("eat.sound", () => {
    citizen.dimension.playSound("random.burp", citizen.location, { volume: 0.3, pitch: 1.1 });
  });
  holdBlock(citizen, null);
  citizen.setState(STATE.IDLE);
  return "done";
}

export function sleepTask(bedPos) {
  return { kind: "sleep", bed: bedPos, phase: bedPos ? "approach" : "ground", progress: 0, label: "sleeping" };
}

export function stepSleep(ctx, task) {
  const { citizen, tick } = ctx;

  if (task.phase === "approach") {
    const d = dist(citizen.location, centerOf(task.bed));
    if (d <= 2.0) {
      stopTravel(citizen);
      citizen.setMode("rest");
      task.phase = "asleep";
      return "running";
    }
    if (!isTravelling(citizen)) {
      const stand = standingSpotFor(citizen.dimension, task.bed, citizen.location);
      if (!stand || !travelTo(citizen, stand, { arrive: 1.4 })) { task.phase = "ground"; return "running"; }
    }
    if (tickNavigation(citizen, tick) === "blocked") task.phase = "ground";
    return "running";
  }

  if (task.phase === "ground") {
    stopTravel(citizen);
    citizen.setMode("rest");
    task.phase = "asleep";
    return "running";
  }

  citizen.setState(STATE.SLEEP);
  rest(citizen, 1.6 * (ctx.elapsed / 20));
  if (citizen.needs.energy >= 96 || !ctx.isNight) {
    citizen.setState(STATE.IDLE);
    citizen.setMode("idle");
    return "done";
  }
  return "running";
}

export function restTask(seconds = 8) {
  return { kind: "rest", until: 0, seconds, label: "resting" };
}

export function stepRest(ctx, task) {
  const { citizen, tick } = ctx;
  if (!task.until) {
    task.until = tick + task.seconds * 20;
    stopTravel(citizen);
    citizen.setMode("rest");
  }
  citizen.setState(STATE.SIT);
  rest(citizen, 0.4 * (ctx.elapsed / 20));
  if (tick >= task.until) {
    citizen.setState(STATE.IDLE);
    citizen.setMode("idle");
    return "done";
  }
  return "running";
}

/** Places a torch where it is dark - what keeps a settlement mob-free at night. */
export function lightTask(center, radius = 10) {
  return { kind: "light", center, radius, placed: 0, phase: "find", label: "placing lights" };
}

export function stepLight(ctx, task) {
  const { citizen, tick } = ctx;
  const dim = citizen.dimension;

  if (task.phase === "find") {
    if (citizen.countItem("minecraft:torch") <= 0) return task.placed ? "done" : "nomaterial";
    const spot = findTorchSpot(dim, task.center, task.radius);
    if (!spot) return task.placed ? "done" : "failed";
    task.target = spot;
    task.phase = "approach";
    return "running";
  }

  const d = dist(citizen.location, centerOf(task.target));
  if (task.phase === "approach") {
    if (d <= CONFIG.reach) {
      stopTravel(citizen);
      citizen.setMode("work");
      lookAt(citizen, task.target);
      holdBlock(citizen, "minecraft:torch");
      task.phase = "work";
      task.progress = 0;
      return "running";
    }
    if (!isTravelling(citizen)) {
      const stand = standingSpotFor(dim, task.target, citizen.location);
      if (!stand || !travelTo(citizen, stand, { arrive: 1.6 })) { task.phase = "find"; return "running"; }
    }
    if (tickNavigation(citizen, tick) === "blocked") { task.phase = "find"; return "running"; }
    return "running";
  }

  citizen.setState(STATE.BUILD);
  task.progress += ctx.elapsed;
  if (task.progress < 10) return "running";

  if (takeItem(citizen, "minecraft:torch", 1) > 0) {
    safe("light.place", () => dim.getBlock(task.target).setType("minecraft:torch"));
    task.placed += 1;
  }
  citizen.setState(STATE.IDLE);
  task.phase = "find";
  return task.placed >= 8 ? "done" : "running";
}

function findTorchSpot(dim, center, radius) {
  for (let r = 3; r <= radius; r += 3) {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const x = Math.round(center.x + Math.cos(ang) * r);
      const z = Math.round(center.z + Math.sin(ang) * r);
      for (let dy = 2; dy >= -3; dy--) {
        const y = Math.round(center.y) + dy;
        const below = blockType(dim, x, y - 1, z);
        const here = blockType(dim, x, y, z);
        if (below === undefined || here === undefined) continue;
        if (here !== "minecraft:air") continue;
        if (below === "minecraft:air" || below === "minecraft:torch") continue;
        if (hasTorchNear(dim, { x, y, z }, 5)) break;
        return { x, y, z };
      }
    }
  }
  return null;
}

function hasTorchNear(dim, pos, radius) {
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dy = -1; dy <= 2; dy++) {
        const t = blockType(dim, pos.x + dx, pos.y + dy, pos.z + dz);
        if (t === "minecraft:torch" || t === "minecraft:lantern" || t === "minecraft:wall_torch") return true;
      }
    }
  }
  return false;
}

/** Opens or closes a door at `pos`. */
export function toggleDoor(dimension, pos, open) {
  return safe("door.toggle", () => {
    const block = dimension.getBlock(pos);
    if (!block || !block.typeId.endsWith("_door")) return false;
    const current = block.permutation.getState("open_bit");
    if (current === open) return true;
    block.setPermutation(block.permutation.withState("open_bit", open));
    dimension.playSound(open ? "open.door" : "close.door", pos, { volume: 0.6 });
    return true;
  }, false);
}

export function findBedNear(dimension, location, radius = 16) {
  return findNearestBlockFrom(dimension, location, (t) => t.endsWith("_bed") || t === "minecraft:bed", radius);
}

function findNearestBlockFrom(dim, origin, predicate, radius) {
  const bx = Math.floor(origin.x), by = Math.floor(origin.y), bz = Math.floor(origin.z);
  for (let r = 1; r <= radius; r++) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const t = blockType(dim, bx + dx, by + dy, bz + dz);
          if (t !== undefined && predicate(t)) return { x: bx + dx, y: by + dy, z: bz + dz };
        }
      }
    }
  }
  return null;
}

export { findNearestBlockFrom };
