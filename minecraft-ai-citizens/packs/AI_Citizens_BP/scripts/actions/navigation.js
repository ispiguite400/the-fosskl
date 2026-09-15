/**
 * Getting a citizen from A to B.
 *
 * Bedrock exposes no pathfinding API to scripts, so we drive the *vanilla*
 * pathfinder instead: each citizen owns an invisible `ai:nav_point` marker on
 * its private channel, and the entity's `move_towards_target` goal walks to it.
 * This module plans a coarse route (ground-snapped waypoints every few blocks),
 * parks the marker on the next waypoint, and watches for the citizen getting
 * wedged - at which point it jumps, side-steps, bridges a gap, tunnels through,
 * or as a last resort nudges the citizen free.
 */
import { CONFIG } from "../core/config.js";
import { safe, debug } from "../core/log.js";
import {
  dist, dist2d, norm, sub, add, mul, centerOf, floorV, clamp,
} from "../core/util.js";
import { isPassable, isDangerous, isProtected, hardnessOf } from "../core/blocks.js";
import { STATE } from "../agent/citizen.js";

const SEARCH_UP = 6;
const SEARCH_DOWN = 20;

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Plan a route to `target` and start walking.
 * @returns {boolean} false when no usable route could be planned.
 */
export function travelTo(citizen, target, opts = {}) {
  const from = citizen.location;
  const route = planRoute(citizen, from, target, opts);
  if (!route.length) {
    citizen.route = [];
    citizen.routeTarget = null;
    return false;
  }
  citizen.route = route;
  citizen.routeTarget = { ...target };
  citizen.routeOptions = {
    arrive: opts.arrive ?? CONFIG.arriveDistance,
    sprint: Boolean(opts.sprint),
    allowMining: opts.allowMining ?? CONFIG.allowTunnelling,
    allowBridging: opts.allowBridging ?? CONFIG.allowBridging,
  };
  citizen.stuckCount = 0;
  // Armed on the first tickNavigation() call - starting it at 0 would make the
  // watchdog fire immediately on every new route.
  citizen.lastProgressDist = Infinity;
  citizen.lastProgressTick = -1;
  ensureNavPoint(citizen);
  parkMarker(citizen, route[0]);
  citizen.setMode("travel");
  return true;
}

export function stopTravel(citizen) {
  citizen.route = [];
  citizen.routeTarget = null;
  releaseNavPoint(citizen);
  if (citizen.mode === "travel") citizen.setMode("idle");
}

export function isTravelling(citizen) {
  return citizen.route.length > 0;
}

export function remainingDistance(citizen) {
  if (!citizen.routeTarget) return 0;
  return dist(citizen.location, citizen.routeTarget);
}

/**
 * Step navigation for one citizen.
 * @returns {"running"|"arrived"|"blocked"}
 */
export function tickNavigation(citizen, tick) {
  if (!citizen.route.length) return "arrived";
  if (!citizen.valid) return "blocked";

  const here = citizen.location;
  const waypoint = citizen.route[0];
  const arrive = citizen.routeOptions?.arrive ?? CONFIG.arriveDistance;

  // Final waypoint uses the caller's arrival tolerance; intermediate hops are
  // loose so citizens keep flowing instead of pausing on every marker.
  const tolerance = citizen.route.length === 1 ? arrive : Math.max(arrive, 2.2);
  const d = dist(here, waypoint);

  if (citizen.lastProgressTick < 0) {
    citizen.lastProgressTick = tick;
    citizen.lastProgressDist = d;
  }

  if (d <= tolerance) {
    citizen.route.shift();
    citizen.route.detour = false;
    citizen.stuckCount = 0;
    citizen.lastProgressDist = Infinity;
    if (!citizen.route.length) {
      releaseNavPoint(citizen);
      citizen.setState(STATE.IDLE);
      return "arrived";
    }
    parkMarker(citizen, citizen.route[0]);
    return "running";
  }

  // Keep the marker alive and where it should be (it can be culled by chunk
  // unloads or by a player in creative sweeping entities).
  if (!citizen.navPoint || !navPointValid(citizen)) {
    ensureNavPoint(citizen);
    parkMarker(citizen, waypoint);
  }

  citizen.setMode("travel");
  citizen.setState(citizen.routeOptions?.sprint ? STATE.RUN : STATE.WALK);

  // --- progress watchdog -------------------------------------------------
  if (d < citizen.lastProgressDist - 0.35) {
    citizen.lastProgressDist = d;
    citizen.lastProgressTick = tick;
    citizen.stuckCount = 0;
  } else if (tick - citizen.lastProgressTick > CONFIG.stuckTicks) {
    citizen.stuckCount += 1;
    citizen.lastProgressTick = tick;
    const recovered = attemptUnstick(citizen, waypoint);
    // Each recovery attempt can "succeed" (a block mined, a detour queued) and
    // still leave the citizen exactly where they were, so the attempt count is
    // what ends the route - not whether the last attempt reported success.
    if (citizen.stuckCount >= 6 || (!recovered && citizen.stuckCount >= 3)) {
      debug(`${citizen.short} gave up on a route after ${citizen.stuckCount} attempts`);
      stopTravel(citizen);
      return "blocked";
    }
  }
  return "running";
}

// --------------------------------------------------------------------------
// Route planning
// --------------------------------------------------------------------------

export function planRoute(citizen, from, target, opts = {}) {
  const dim = citizen.dimension;
  const spacing = opts.spacing ?? CONFIG.waypointSpacing;
  const flat = { x: target.x - from.x, y: 0, z: target.z - from.z };
  const horizontal = Math.sqrt(flat.x * flat.x + flat.z * flat.z);
  const steps = clamp(Math.ceil(horizontal / spacing), 1, CONFIG.maxPathWaypoints);

  const route = [];
  const dir = norm(flat);
  let lastY = from.y;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const raw = {
      x: from.x + flat.x * t,
      y: from.y + (target.y - from.y) * t,
      z: from.z + flat.z * t,
    };
    const grounded = snapToGround(dim, raw, lastY);
    if (grounded) {
      lastY = grounded.y;
      const prev = route[route.length - 1];
      // Skip waypoints that barely move - they make citizens stutter.
      if (!prev || dist(prev, grounded) > 1.5) route.push(grounded);
    } else if (i === steps) {
      route.push(centerOf(target));
    }
  }

  // Always finish exactly on the requested spot.
  const final = snapToGround(dim, target, lastY) || centerOf(target);
  const last = route[route.length - 1];
  if (!last || dist(last, final) > 0.8) route.push(final);

  // Sidestep waypoints that land in lava or fire.
  return route.map((wp) => avoidHazard(dim, wp) || wp).slice(0, CONFIG.maxPathWaypoints);
}

/** Finds the walkable surface nearest `pos`, preferring one close to `preferY`. */
export function snapToGround(dim, pos, preferY) {
  const bx = Math.floor(pos.x), bz = Math.floor(pos.z);
  const startY = Math.floor(preferY ?? pos.y);
  let best = null, bestScore = Infinity;

  for (let dy = SEARCH_UP; dy >= -SEARCH_DOWN; dy--) {
    const y = startY + dy;
    const floor = blockType(dim, bx, y - 1, bz);
    if (floor === undefined) continue;
    if (isPassable(floor) || floor === "minecraft:air") continue;
    if (isDangerous(floor)) continue;
    const feet = blockType(dim, bx, y, bz);
    const head = blockType(dim, bx, y + 1, bz);
    if (feet === undefined || head === undefined) continue;
    if (!isPassable(feet) || !isPassable(head)) continue;

    const score = Math.abs(dy) + (isDangerous(feet) ? 20 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { x: bx + 0.5, y, z: bz + 0.5 };
      if (dy === 0) break;
    }
  }
  return best;
}

function avoidHazard(dim, wp) {
  const t = blockType(dim, Math.floor(wp.x), Math.floor(wp.y), Math.floor(wp.z));
  if (t === undefined || !isDangerous(t)) return null;
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]]) {
    const alt = snapToGround(dim, { x: wp.x + dx, y: wp.y, z: wp.z + dz }, wp.y);
    if (alt) {
      const at = blockType(dim, Math.floor(alt.x), Math.floor(alt.y), Math.floor(alt.z));
      if (at !== undefined && !isDangerous(at)) return alt;
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// Marker management
// --------------------------------------------------------------------------

function ensureNavPoint(citizen) {
  if (navPointValid(citizen)) return citizen.navPoint;
  const spawnAt = citizen.route[0] || citizen.location;
  citizen.navPoint = safe("nav.spawn", () => {
    const marker = citizen.dimension.spawnEntity("ai:nav_point", {
      x: spawnAt.x, y: spawnAt.y + 0.1, z: spawnAt.z,
    });
    marker.triggerEvent(`ai:set_ch_${citizen.channel}`);
    marker.addTag("ai_nav");
    marker.addTag(`ai_nav_owner_${citizen.channel}`);
    return marker;
  }, null);
  return citizen.navPoint;
}

function navPointValid(citizen) {
  try {
    return Boolean(citizen.navPoint && citizen.navPoint.isValid);
  } catch {
    return false;
  }
}

function parkMarker(citizen, waypoint) {
  if (!navPointValid(citizen)) return;
  safe("nav.park", () => {
    citizen.navPoint.teleport(
      { x: waypoint.x, y: waypoint.y + 0.1, z: waypoint.z },
      { dimension: citizen.dimension },
    );
  });
}

export function releaseNavPoint(citizen) {
  if (!citizen.navPoint) return;
  safe("nav.release", () => {
    if (citizen.navPoint.isValid) citizen.navPoint.remove();
  });
  citizen.navPoint = null;
}

/** Sweeps markers left behind by a crash or a reload. */
export function sweepOrphanMarkers(dimensions, liveCitizens) {
  const owned = new Set();
  for (const c of liveCitizens) {
    if (c.navPoint) {
      try { if (c.navPoint.isValid) owned.add(c.navPoint.id); } catch { /* gone */ }
    }
  }
  let removed = 0;
  for (const dim of dimensions) {
    const markers = safe("nav.sweep", () => dim.getEntities({ type: "ai:nav_point" }), []) || [];
    for (const m of markers) {
      try {
        if (!owned.has(m.id)) { m.remove(); removed++; }
      } catch { /* already gone */ }
    }
  }
  return removed;
}

// --------------------------------------------------------------------------
// Getting unstuck
// --------------------------------------------------------------------------

function attemptUnstick(citizen, waypoint) {
  const dim = citizen.dimension;
  const here = citizen.location;
  const opts = citizen.routeOptions || {};

  // 1. A hop clears fences, slabs and small ledges.
  if (safe("nav.hop", () => {
    citizen.entity.applyKnockback({ x: 0, z: 0 }, 0.42);
    return true;
  }, false)) {
    // fall through - the hop may be enough, the checks below are cheap anyway
  }

  const dir = norm(sub(waypoint, here));
  const ahead = floorV(add(here, mul(dir, 1.0)));

  // 2. A gap in front: bridge it.
  if (opts.allowBridging) {
    const belowAhead = blockType(dim, ahead.x, Math.floor(here.y) - 1, ahead.z);
    const atAhead = blockType(dim, ahead.x, Math.floor(here.y), ahead.z);
    if (belowAhead !== undefined && isPassable(belowAhead) && isPassable(atAhead ?? "minecraft:air")) {
      if (placeBridgeBlock(citizen, { x: ahead.x, y: Math.floor(here.y) - 1, z: ahead.z })) {
        return true;
      }
    }
  }

  // 3. Something solid in the way: tunnel through it if it is ours to break.
  if (opts.allowMining) {
    for (const dy of [0, 1]) {
      const y = Math.floor(here.y) + dy;
      const t = blockType(dim, ahead.x, y, ahead.z);
      if (t === undefined || isPassable(t) || isProtected(t) || isDangerous(t)) continue;
      if (hardnessOf(t) > 6) continue;   // obsidian and friends: go around
      if (safe("nav.tunnel", () => {
        dim.getBlock({ x: ahead.x, y, z: ahead.z }).setType("minecraft:air");
        return true;
      }, false)) {
        return true;
      }
    }
  }

  // 4. Try a lateral waypoint to break the deadlock.
  const side = { x: -dir.z, y: 0, z: dir.x };
  for (const s of [3, -3, 5, -5]) {
    const probe = add(here, mul(side, s));
    const grounded = snapToGround(dim, probe, here.y);
    if (grounded && dist(grounded, here) > 1.5) {
      // Replace the detour we already inserted rather than stacking another,
      // otherwise a citizen in an awkward corner grows an endless route.
      if (citizen.route.detour) citizen.route[0] = grounded;
      else { citizen.route.unshift(grounded); citizen.route.detour = true; }
      parkMarker(citizen, grounded);
      return true;
    }
  }

  // 5. Genuinely wedged (inside a wall, on a 1x1 pillar): nudge free.
  if (CONFIG.allowTeleportUnstick && citizen.stuckCount >= 3) {
    const rescue = snapToGround(dim, waypoint, waypoint.y);
    if (rescue && dist(rescue, here) < 24) {
      safe("nav.rescue", () => citizen.entity.teleport(rescue, { dimension: dim }));
      return true;
    }
  }
  return false;
}

function placeBridgeBlock(citizen, pos) {
  const container = citizen.container;
  if (!container) return false;
  for (let i = 0; i < container.size; i++) {
    const stack = safe("nav.bridgeScan", () => container.getItem(i));
    if (!stack) continue;
    if (!/(_planks|cobblestone|dirt|stone|deepslate|_wool)$/.test(stack.typeId)) continue;
    const ok = safe("nav.bridge", () => {
      citizen.dimension.getBlock(pos).setType(stack.typeId);
      return true;
    }, false);
    if (!ok) continue;
    if (stack.amount > 1) {
      stack.amount -= 1;
      container.setItem(i, stack);
    } else {
      container.setItem(i, undefined);
    }
    return true;
  }
  return false;
}

// --------------------------------------------------------------------------
function blockType(dim, x, y, z) {
  try {
    const b = dim.getBlock({ x, y, z });
    return b ? b.typeId : undefined;
  } catch {
    return undefined;
  }
}

export { blockType };
