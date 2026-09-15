/** Breaking blocks: approach, swing for a believable amount of time, collect. */
import { CONFIG } from "../core/config.js";
import { safe, debug } from "../core/log.js";
import { dist, prettyId, centerOf } from "../core/util.js";
import {
  hardnessOf, isProtected, isPassable, isDangerous, isOre, isLog, dropsOf, LOGS,
} from "../core/blocks.js";
import { STATE } from "../agent/citizen.js";
import { travelTo, isTravelling, tickNavigation, stopTravel, blockType, snapToGround } from "./navigation.js";
import { giveItem, equipTool, bestToolFor, isFull } from "./inventory.js";
import { remember } from "../agent/memory.js";
import { isReserved } from "../civ/territory.js";

const TOOL_SPEED = {
  netherite: 0.25, diamond: 0.3, iron: 0.45, stone: 0.65, golden: 0.4, wooden: 0.85,
};

export function mineTask(pos, opts = {}) {
  return {
    kind: "mine",
    target: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
    phase: "approach",
    progress: 0,
    tool: null,
    label: opts.label || "mining",
    vein: opts.vein !== false,     // follow a connected ore vein by default
    mined: 0,
    limit: opts.limit || 1,
    tunnelled: 0,                  // blocks cleared while digging in
    attempts: 0,
  };
}

/** Mine the nearest `count` blocks matching `predicate` within `radius`. */
export function gatherTask(predicate, radius, count, label) {
  return {
    kind: "gather",
    predicate,
    radius,
    count,
    label: label || "gathering",
    collected: 0,
    current: null,
    failures: 0,
    skip: new Set(),      // positions proved unreachable this run
  };
}

export function stepMine(ctx, task) {
  const { citizen, tick } = ctx;
  const dim = citizen.dimension;

  const type = blockType(dim, task.target.x, task.target.y, task.target.z);
  if (type === undefined) return "failed";
  if (isPassable(type) || type === "minecraft:air") {
    // Already gone - count it and move on.
    return nextVeinBlock(ctx, task) ? "running" : "done";
  }
  if (isProtected(type)) return "failed";
  if (!task.override && isReserved(ctx.settlement, task.target)) return "failed";

  const d = dist(citizen.location, centerOf(task.target));

  if (task.phase === "approach") {
    if (d <= CONFIG.reach) {
      task.phase = "work";
      task.progress = 0;
      stopTravel(citizen);
      citizen.setMode("work");
      task.tool = equipTool(citizen, bestToolFor(type));
      lookAt(citizen, task.target);
      return "running";
    }
    if (!isTravelling(citizen)) {
      // No reachable place to stand, or walking there has not worked: the block
      // is buried or walled off, so dig in to it instead of giving up.
      const stand = task.attempts < 3
        ? standingSpotFor(dim, task.target, citizen.location)
        : null;
      if (!stand || !travelTo(citizen, stand, { arrive: 1.6, allowMining: true })) {
        task.phase = "tunnel";
        task.progress = 0;
        return "running";
      }
      task.attempts += 1;
    }
    const nav = tickNavigation(citizen, tick);
    if (nav === "blocked") { task.phase = "tunnel"; task.progress = 0; return "running"; }
    return "running";
  }

  // --- tunnelling in -----------------------------------------------------
  // Mine a corridor along the line of sight, one block at a time, so a citizen
  // can reach ore that is buried rather than giving up on it.
  if (task.phase === "tunnel") {
    if (d <= CONFIG.reach) { task.phase = "work"; task.progress = 0; return "running"; }
    if (task.tunnelled > 96) return "failed";

    if (!task.tunnelTarget || !stillSolid(dim, task.tunnelTarget)) {
      const next = nextDigTarget(dim, citizen.location, task.target);
      if (!next) return "failed";
      task.tunnelTarget = next;
      task.progress = 0;
      stopTravel(citizen);
      citizen.setMode("work");
      task.tool = equipTool(citizen, bestToolFor(blockType(dim, next.x, next.y, next.z) || "minecraft:stone"));
    }

    const tType = blockType(dim, task.tunnelTarget.x, task.tunnelTarget.y, task.tunnelTarget.z);
    if (tType === undefined || isProtected(tType)) return "failed";

    citizen.setState(STATE.MINE);
    lookAt(citizen, task.tunnelTarget);
    task.progress += ctx.elapsed;
    const need = Math.max(4, Math.round(CONFIG.mineTicksPerBlock * hardnessOf(tType) * 0.6));
    if (task.progress < need) return "running";

    // Clear the block and the one above it so the corridor is walkable.
    const cleared = { ...task.tunnelTarget };
    for (const dy of [0, 1]) {
      const p = { x: task.tunnelTarget.x, y: task.tunnelTarget.y + dy, z: task.tunnelTarget.z };
      const pType = blockType(dim, p.x, p.y, p.z);
      if (pType === undefined || isPassable(pType) || isProtected(pType)) continue;
      const broke = safe("mine.tunnel", () => { dim.getBlock(p).setType("minecraft:air"); return true; }, false);
      if (broke) {
        for (const drop of dropsOf(pType)) giveItem(citizen, drop.id, drop.count);
        task.tunnelled += 1;
      }
    }
    safe("mine.tunnelSound", () => dim.playSound("dig.stone", citizen.location, { volume: 0.4 }));
    task.progress = 0;
    task.tunnelTarget = null;

    // Step into the space just cleared, then keep digging from there.
    const step = { x: cleared.x + 0.5, y: cleared.y, z: cleared.z + 0.5 };
    if (dist(citizen.location, step) > 1.0) {
      travelTo(citizen, step, { arrive: 1.0, allowMining: true, spacing: 2 });
    }
    if (isTravelling(citizen)) tickNavigation(citizen, tick);
    return "running";
  }

  // --- working ----------------------------------------------------------
  if (d > CONFIG.reach + 1.5) { task.phase = "approach"; return "running"; }

  citizen.setState(STATE.MINE);
  const speed = TOOL_SPEED[toolTier(task.tool)] ?? 1.0;
  const needed = Math.max(4, Math.round(CONFIG.mineTicksPerBlock * hardnessOf(type) * speed));
  task.progress += ctx.elapsed;

  if (task.progress % 8 < ctx.elapsed) {
    safe("mine.fx", () => {
      dim.playSound("dig.stone", citizen.location, { volume: 0.4, pitch: 0.9 });
    });
  }

  if (task.progress < needed) return "running";

  // --- break ------------------------------------------------------------
  const broke = safe("mine.break", () => {
    const block = dim.getBlock(task.target);
    if (!block) return false;
    block.setType("minecraft:air");
    return true;
  }, false);
  if (!broke) return "failed";

  safe("mine.sound", () => dim.playSound("random.pop", citizen.location, { volume: 0.5 }));
  for (const drop of dropsOf(type)) giveItem(citizen, drop.id, drop.count);
  task.mined += 1;
  task.progress = 0;
  citizen.setState(STATE.IDLE);

  if (isOre(type)) {
    remember(citizen.memory, `mined ${prettyId(type)} at ${task.target.x},${task.target.y},${task.target.z}`, 2, ctx.tick);
  }

  if (isFull(citizen)) return "done";
  if (task.mined >= task.limit && !task.vein) return "done";
  return nextVeinBlock(ctx, task) ? "running" : "done";
}

/** Ore comes in veins - having found one, take the neighbours too. */
function nextVeinBlock(ctx, task) {
  if (!task.vein || task.mined >= task.limit + 12) return false;
  const dim = ctx.citizen.dimension;
  const origin = task.target;
  const wanted = task.veinType;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dy && !dz) continue;
        const p = { x: origin.x + dx, y: origin.y + dy, z: origin.z + dz };
        const t = blockType(dim, p.x, p.y, p.z);
        if (t === undefined) continue;
        if (wanted ? t !== wanted : !(isOre(t) || isLog(t))) continue;
        task.target = p;
        task.veinType = wanted || t;
        task.phase = "approach";
        task.progress = 0;
        return true;
      }
    }
  }
  return false;
}

export function stepGather(ctx, task) {
  const { citizen } = ctx;
  if (task.collected >= task.count || isFull(citizen)) return "done";
  if (!task.skip) task.skip = new Set();

  if (!task.current) {
    const settlement = ctx.settlement;
    const found = findNearestBlock(
      citizen, task.predicate, task.radius,
      (p) => !task.skip.has(`${p.x},${p.y},${p.z}`) && !isReserved(settlement, p),
    );
    if (!found) return task.collected > 0 ? "done" : "failed";
    const foundType = blockType(citizen.dimension, found.x, found.y, found.z);
    const veiny = isOre(foundType) || isLog(foundType);
    task.current = mineTask(found, { vein: veiny, limit: task.count - task.collected });
    if (veiny) task.current.veinType = foundType;
  }

  const result = stepMine(ctx, task.current);
  if (result === "running") return "running";

  task.collected += task.current.mined || 0;
  if (result === "failed" && !task.current.mined) {
    // Remember the block we could not get to, so the next search skips it.
    const t = task.current.target;
    task.skip.add(`${t.x},${t.y},${t.z}`);
    task.failures += 1;
    if (task.failures >= 6) return task.collected > 0 ? "done" : "failed";
  }
  task.current = null;
  return task.collected >= task.count ? "done" : "running";
}

/**
 * Nearest matching block, searched outward in Chebyshev shells.
 *
 * This runs on the server tick, so it is budgeted: at most `maxReads` block
 * lookups, coarsening to a stride of two past the inner shells. Ore veins and
 * tree trunks are several blocks thick, so the stride costs very little recall
 * and keeps a town of forty citizens from stalling the world.
 *
 * Vertical range is deliberately shallow - a citizen finds what is around them,
 * not what is twenty blocks down. Getting deep is the miner's job (it sinks a
 * shaft), not the search's.
 */
export function findNearestBlock(citizen, predicate, radius, accept, maxReads = 1400) {
  const dim = citizen.dimension;
  const o = citizen.location;
  const bx = Math.floor(o.x), by = Math.floor(o.y), bz = Math.floor(o.z);
  const Y_DOWN = 8, Y_UP = 6;
  let reads = 0;

  for (let r = 1; r <= radius; r++) {
    const stride = r <= 6 ? 1 : 2;
    let best = null, bestD = Infinity;

    for (let dy = -Math.min(r, Y_DOWN); dy <= Math.min(r, Y_UP); dy++) {
      for (let dx = -r; dx <= r; dx += stride) {
        for (let dz = -r; dz <= r; dz += stride) {
          const onShell = Math.max(Math.abs(dx), Math.abs(dz)) > r - stride
            || Math.abs(dy) === Math.min(r, Y_DOWN);
          if (!onShell) continue;
          if (reads++ > maxReads) return best;

          const p = { x: bx + dx, y: by + dy, z: bz + dz };
          const t = blockType(dim, p.x, p.y, p.z);
          if (t === undefined || isProtected(t)) continue;
          if (!predicate(t)) continue;
          if (accept && !accept(p)) continue;
          const d = (dx * dx) + (dy * dy * 2) + (dz * dz);   // prefer level ground
          if (d < bestD) { bestD = d; best = p; }
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * A block a citizen can stand on that puts `target` within arm's reach.
 *
 * Returning a spot that is merely *near* the target is not good enough: for a
 * buried block the surface directly above it looks like a fine place to stand,
 * but the citizen would arrive and still be six blocks short. When no spot is
 * actually in reach this returns null, and the caller digs in instead.
 */
export function standingSpotFor(dim, target, from) {
  const offsets = [
    [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, -1], [1, -1], [-1, 1],
    [2, 0], [-2, 0], [0, 2], [0, -2],
  ];
  const center = { x: target.x + 0.5, y: target.y, z: target.z + 0.5 };
  let best = null, bestD = Infinity;

  for (const [dx, dz] of offsets) {
    const spot = snapToGround(
      dim,
      { x: target.x + dx + 0.5, y: target.y + 1, z: target.z + dz + 0.5 },
      target.y + 1,
    );
    if (!spot) continue;
    if (dist(spot, center) > CONFIG.reach - 0.4) continue;   // not actually in reach
    const d = dist(spot, from);
    if (d < bestD) { bestD = d; best = spot; }
  }
  return best;
}

/**
 * The next block to break in order to get closer to `to`.
 *
 * Going down, this cuts a staircase - one step forward, one step down - because
 * a vertical shaft is something a citizen can fall into but never climb out of,
 * and Minecraft's pathfinder will not follow them into it. Otherwise it is the
 * first solid block along the line of sight that is within arm's reach.
 */
export function nextDigTarget(dim, from, to) {
  const fx = Math.floor(from.x), fy = Math.floor(from.y), fz = Math.floor(from.z);
  const dxTotal = to.x - fx;
  const dzTotal = to.z - fz;
  const horizontal = Math.sqrt(dxTotal * dxTotal + dzTotal * dzTotal);

  if (to.y < fy - 1) {
    const candidates = [];
    if (horizontal > 1.5) {
      // Step toward the target on its dominant axis, dropping one block.
      const sx = Math.abs(dxTotal) >= Math.abs(dzTotal) ? Math.sign(dxTotal) : 0;
      const sz = sx === 0 ? Math.sign(dzTotal) : 0;
      candidates.push({ x: fx + sx, y: fy - 1, z: fz + sz });   // the tread
      candidates.push({ x: fx + sx, y: fy, z: fz + sz });       // the riser
    }
    candidates.push({ x: fx, y: fy - 1, z: fz });               // straight down
    for (const p of candidates) {
      if (diggable(dim, p)) return p;
    }
  }

  const eye = { x: from.x, y: from.y + 1.5, z: from.z };
  const dx = to.x + 0.5 - eye.x, dy = to.y + 0.5 - eye.y, dz = to.z + 0.5 - eye.z;
  const total = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (total < 0.001) return null;
  const steps = Math.ceil(total / 0.4);

  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * Math.min(total, CONFIG.reach);
    const p = {
      x: Math.floor(eye.x + (dx / total) * t),
      y: Math.floor(eye.y + (dy / total) * t),
      z: Math.floor(eye.z + (dz / total) * t),
    };
    const type = blockType(dim, p.x, p.y, p.z);
    if (type === undefined) return null;
    if (isPassable(type) || type === "minecraft:air") continue;
    if (isProtected(type) || hardnessOf(type) > 8) return null;
    return p;
  }
  return null;
}

function diggable(dim, pos) {
  const t = blockType(dim, pos.x, pos.y, pos.z);
  if (t === undefined) return false;
  if (isPassable(t) || t === "minecraft:air") return false;
  if (isProtected(t) || isDangerous(t)) return false;
  return hardnessOf(t) <= 8;
}

function stillSolid(dim, pos) {
  const t = blockType(dim, pos.x, pos.y, pos.z);
  return t !== undefined && !isPassable(t) && t !== "minecraft:air";
}

export function lookAt(citizen, pos) {
  safe("mine.look", () => {
    citizen.entity.lookAt({ x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
  });
}

function toolTier(toolId) {
  if (!toolId) return "hand";
  const m = /minecraft:(\w+?)_(pickaxe|axe|shovel|sword|hoe)/.exec(toolId);
  return m ? m[1] : "hand";
}
