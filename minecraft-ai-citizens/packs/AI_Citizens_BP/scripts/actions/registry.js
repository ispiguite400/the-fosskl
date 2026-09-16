/**
 * The verb list.
 *
 * Every action is a plain object with a `kind`; `stepTask` advances it by one
 * tick-slice and returns "running" | "done" | "failed" | "nomaterial" |
 * "nostation". The brain (local or Claude) only ever emits these objects, so
 * both brains drive the same body.
 */
import { CONFIG } from "../core/config.js";
import { safe, debug } from "../core/log.js";
import { dist, dist2d, prettyId, compass, pick, norm, sub, centerOf } from "../core/util.js";
import { STATE } from "../agent/citizen.js";
import {
  travelTo, isTravelling, tickNavigation, stopTravel, snapToGround, blockType,
} from "./navigation.js";
import { stepMine, stepGather, stepExcavate, mineTask, gatherTask, excavateTask, findNearestBlock, lookAt, standingSpotFor } from "./mine.js";
import { stepPlace, stepBuild, placeTask, buildTask } from "./build.js";
import { stepCraft, craftTask } from "./craft.js";
import { stepFarm, farmTask } from "./farm.js";
import { stepFight, stepFlee, fightTask, sparTask, fleeTask, resolveEntity } from "./combat.js";
import { stepEat, stepSleep, stepRest, stepLight, eatTask, sleepTask, restTask, lightTask } from "./interact.js";
import {
  openBlockContainer, depositTo, withdrawFrom, dropItem, giveItem, isFull,
} from "./inventory.js";
import { say, TONE } from "../ui/caption.js";
import { socialise } from "../agent/needs.js";
import { isOre, isLog, LOGS, ORES } from "../core/blocks.js";

// --------------------------------------------------------------------------
// Simple task constructors
// --------------------------------------------------------------------------
export function gotoTask(pos, opts = {}) {
  return {
    kind: "goto",
    target: { x: pos.x, y: pos.y, z: pos.z },
    started: false,
    arrive: opts.arrive ?? CONFIG.arriveDistance,
    sprint: Boolean(opts.sprint),
    label: opts.label || `walking to ${Math.round(pos.x)}, ${Math.round(pos.z)}`,
  };
}

export function followTask(entityId, opts = {}) {
  return {
    kind: "follow",
    entityId,
    distance: opts.distance ?? 3.5,
    until: opts.ticks ? 0 : null,
    ticks: opts.ticks || 0,
    repathAt: 0,
    label: opts.label || "following",
  };
}

export function speakTask(text, opts = {}) {
  return { kind: "speak", text, tone: opts.tone || TONE.normal, to: opts.to || null, done: false, label: "talking" };
}

export function waitTask(seconds = 3, label = "waiting") {
  return { kind: "wait", until: 0, seconds, label };
}

export function exploreTask(radius = 48, opts = {}) {
  return { kind: "explore", radius, legs: opts.legs || 3, started: false, label: "exploring" };
}

export function patrolTask(center, radius = 16, laps = 2) {
  return { kind: "patrol", center, radius, laps, leg: 0, started: false, label: "on patrol" };
}

export function storeTask(chestPos, itemFilter) {
  return { kind: "store", chest: chestPos, filter: itemFilter || null, phase: "approach", label: "storing goods" };
}

export function fetchTask(chestPos, itemId, count) {
  return { kind: "fetch", chest: chestPos, itemId, count, phase: "approach", label: `fetching ${prettyId(itemId)}` };
}

export function giveTask(entityId, itemId, count) {
  return { kind: "give", entityId, itemId, count, phase: "approach", label: "handing something over" };
}

export function chopTask(count = 8) {
  return gatherTask((t) => LOGS.has(t), 28, count, "chopping wood");
}

export function mineOreTask(count = 12, minValue = 0) {
  return gatherTask(
    (t) => isOre(t) && (ORES[t]?.value ?? 0) >= minValue,
    20, count, "mining",
  );
}

// --------------------------------------------------------------------------
// Dispatcher
// --------------------------------------------------------------------------
const STEPPERS = {
  goto: stepGoto,
  follow: stepFollow,
  speak: stepSpeak,
  wait: stepWait,
  explore: stepExplore,
  patrol: stepPatrol,
  store: stepStore,
  fetch: stepFetch,
  give: stepGive,
  mine: stepMine,
  gather: stepGather,
  excavate: stepExcavate,
  place: stepPlace,
  build: stepBuild,
  craft: stepCraft,
  farm: stepFarm,
  fight: stepFight,
  flee: stepFlee,
  eat: stepEat,
  sleep: stepSleep,
  rest: stepRest,
  light: stepLight,
};

export function stepTask(ctx, task) {
  const stepper = STEPPERS[task.kind];
  if (!stepper) {
    debug(`unknown task kind ${task.kind}`);
    return "failed";
  }
  try {
    return stepper(ctx, task);
  } catch (e) {
    safe(`task:${task.kind}`, () => { throw e; });
    return "failed";
  }
}

export function taskLabel(task) {
  if (!task) return "idle";
  if (task.kind === "gather" && task.current) return task.label;
  return task.label || task.kind;
}

// --------------------------------------------------------------------------
// Steppers for the simple verbs
// --------------------------------------------------------------------------
function stepGoto(ctx, task) {
  const { citizen, tick } = ctx;
  if (!task.started) {
    if (!travelTo(citizen, task.target, { arrive: task.arrive, sprint: task.sprint })) return "failed";
    task.started = true;
  }
  const r = tickNavigation(citizen, tick);
  if (r === "arrived") { citizen.setMode("idle"); return "done"; }
  if (r === "blocked") return "failed";
  return "running";
}

function stepFollow(ctx, task) {
  const { citizen, tick } = ctx;
  if (task.ticks && !task.until) task.until = tick + task.ticks;
  if (task.until && tick > task.until) { stopTravel(citizen); return "done"; }

  const target = resolveEntity(citizen, task.entityId);
  if (!target) { stopTravel(citizen); return "done"; }

  const d = dist(citizen.location, target.location);
  if (d <= task.distance) {
    if (isTravelling(citizen)) stopTravel(citizen);
    citizen.setMode("idle");
    citizen.setState(STATE.IDLE);
    safe("follow.look", () => citizen.entity.lookAt(target.location));
    return "running";
  }

  // Re-plan periodically - the target is moving.
  if (tick >= task.repathAt || !isTravelling(citizen)) {
    task.repathAt = tick + 30;
    travelTo(citizen, target.location, { arrive: task.distance, sprint: d > 12 });
  }
  tickNavigation(citizen, tick);
  return "running";
}

function stepSpeak(ctx, task) {
  if (!task.done) {
    say(ctx.citizen, task.text, { tone: task.tone, to: task.to });
    task.done = true;
    task.until = ctx.tick + 20;
  }
  return ctx.tick >= task.until ? "done" : "running";
}

function stepWait(ctx, task) {
  const { citizen, tick } = ctx;
  if (!task.until) {
    task.until = tick + task.seconds * 20;
    stopTravel(citizen);
    citizen.setMode("idle");
  }
  citizen.setState(STATE.IDLE);
  return tick >= task.until ? "done" : "running";
}

function stepExplore(ctx, task) {
  const { citizen, tick } = ctx;
  if (!task.started || (!isTravelling(citizen) && task.legs > 0)) {
    if (task.started) task.legs -= 1;
    if (task.legs <= 0 && task.started) { citizen.setMode("idle"); return "done"; }
    task.started = true;
    const ang = Math.random() * Math.PI * 2;
    const r = task.radius * (0.5 + Math.random() * 0.5);
    // Wander outward from home, not from wherever the last leg ended, so an
    // exploring citizen circles the settlement instead of walking off the map.
    const from = ctx.settlement
      && dist(citizen.location, ctx.settlement.origin) > CONFIG.settlementRadius
      ? ctx.settlement.origin
      : citizen.location;
    const goal = {
      x: from.x + Math.cos(ang) * r,
      y: citizen.location.y,
      z: from.z + Math.sin(ang) * r,
    };
    const grounded = snapToGround(citizen.dimension, goal, citizen.location.y) || goal;
    if (!travelTo(citizen, grounded, { arrive: 3 })) return "failed";
  }
  const r = tickNavigation(citizen, tick);
  if (r === "blocked") { task.legs -= 1; stopTravel(citizen); }
  if (task.legs <= 0) { citizen.setMode("idle"); return "done"; }
  return "running";
}

function stepPatrol(ctx, task) {
  const { citizen, tick } = ctx;
  if (!isTravelling(citizen)) {
    if (task.started) task.leg += 1;
    task.started = true;
    if (task.leg >= task.laps * 4) { citizen.setMode("idle"); return "done"; }
    const ang = (task.leg % 4) * (Math.PI / 2) + Math.PI / 4;
    const goal = {
      x: task.center.x + Math.cos(ang) * task.radius,
      y: task.center.y,
      z: task.center.z + Math.sin(ang) * task.radius,
    };
    const grounded = snapToGround(citizen.dimension, goal, task.center.y) || goal;
    if (!travelTo(citizen, grounded, { arrive: 3 })) { task.leg += 1; return "running"; }
  }
  const r = tickNavigation(citizen, tick);
  if (r === "blocked") { task.leg += 1; stopTravel(citizen); }
  citizen.setMode(citizen.job === "guard" ? "combat" : "travel");
  return "running";
}

function stepStore(ctx, task) {
  const { citizen, tick } = ctx;
  const d = dist(citizen.location, centerOf(task.chest));

  if (task.phase === "approach") {
    if (d <= CONFIG.reach) {
      stopTravel(citizen);
      citizen.setMode("work");
      lookAt(citizen, task.chest);
      task.phase = "work";
      task.progress = 0;
      return "running";
    }
    if (!isTravelling(citizen)) {
      const stand = standingSpotFor(citizen.dimension, task.chest, citizen.location);
      if (!stand || !travelTo(citizen, stand, { arrive: 1.6 })) return "failed";
    }
    if (tickNavigation(citizen, tick) === "blocked") return "failed";
    return "running";
  }

  citizen.setState(STATE.CARRY);
  task.progress += ctx.elapsed;
  if (task.progress < 14) return "running";

  const container = openBlockContainer(citizen.dimension, task.chest);
  if (!container) return "failed";
  const moved = depositTo(citizen, container, task.filter, Infinity);
  safe("store.sound", () => citizen.dimension.playSound("random.chestopen", task.chest, { volume: 0.4 }));
  citizen.setState(STATE.IDLE);
  task.moved = moved;
  return "done";
}

function stepFetch(ctx, task) {
  const { citizen, tick } = ctx;
  const d = dist(citizen.location, centerOf(task.chest));

  if (task.phase === "approach") {
    if (d <= CONFIG.reach) {
      stopTravel(citizen);
      citizen.setMode("work");
      lookAt(citizen, task.chest);
      task.phase = "work";
      task.progress = 0;
      return "running";
    }
    if (!isTravelling(citizen)) {
      const stand = standingSpotFor(citizen.dimension, task.chest, citizen.location);
      if (!stand || !travelTo(citizen, stand, { arrive: 1.6 })) return "failed";
    }
    if (tickNavigation(citizen, tick) === "blocked") return "failed";
    return "running";
  }

  citizen.setState(STATE.CARRY);
  task.progress += ctx.elapsed;
  if (task.progress < 14) return "running";

  const container = openBlockContainer(citizen.dimension, task.chest);
  if (!container) return "failed";
  task.got = withdrawFrom(citizen, container, task.itemId, task.count);
  citizen.setState(STATE.IDLE);
  return task.got > 0 ? "done" : "failed";
}

function stepGive(ctx, task) {
  const { citizen, tick } = ctx;
  const target = resolveEntity(citizen, task.entityId);
  if (!target) return "failed";
  const d = dist(citizen.location, target.location);

  if (d > 3.0) {
    if (!isTravelling(citizen)) {
      if (!travelTo(citizen, target.location, { arrive: 2.2 })) return "failed";
    }
    if (tickNavigation(citizen, tick) === "blocked") return "failed";
    return "running";
  }

  stopTravel(citizen);
  citizen.setState(STATE.CARRY);
  safe("give.look", () => citizen.entity.lookAt(target.location));
  const gave = dropItem(citizen, task.itemId, task.count);
  citizen.setState(STATE.IDLE);
  task.gave = gave;
  return gave > 0 ? "done" : "failed";
}

export {
  mineTask, gatherTask, excavateTask, placeTask, buildTask, craftTask, farmTask,
  fightTask, sparTask, fleeTask, eatTask, sleepTask, restTask, lightTask,
};
