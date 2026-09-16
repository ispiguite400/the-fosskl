/** Fighting, defending and knowing when to run. */
import { CONFIG } from "../core/config.js";
import { safe } from "../core/log.js";
import { dist, prettyId, norm, sub } from "../core/util.js";
import { STATE } from "../agent/citizen.js";
import { travelTo, isTravelling, tickNavigation, stopTravel, snapToGround } from "./navigation.js";
import { equipTool } from "./inventory.js";
import { grit } from "../agent/personality.js";
import { scare, reassure } from "../agent/needs.js";
import { remember } from "../agent/memory.js";

const MELEE_REACH = 3.2;

const WEAPON_DAMAGE = {
  netherite_sword: 8, diamond_sword: 7, iron_sword: 6, stone_sword: 5,
  golden_sword: 4, wooden_sword: 4,
  netherite_axe: 10, diamond_axe: 9, iron_axe: 9, stone_axe: 9, wooden_axe: 7,
};

export function fightTask(targetId, opts = {}) {
  return {
    kind: "fight",
    targetId,
    label: opts.label || "fighting",
    cooldown: 0,
    engagedTicks: 0,
    guardSpot: opts.guardSpot || null,
    // A spar is a contest, not a killing: blows are pulled and whoever drops
    // below `yieldAt` gives best, so a tournament does not cost the town two
    // citizens per round.
    spar: Boolean(opts.spar),
    yieldAt: opts.yieldAt ?? 0.55,
    contest: Boolean(opts.spar),
  };
}

/** A friendly bout. Same fight, blunted. */
export function sparTask(targetId, opts = {}) {
  return fightTask(targetId, { ...opts, spar: true, label: opts.label || "sparring" });
}

export function fleeTask(fromLocation, opts = {}) {
  return {
    kind: "flee",
    from: { ...fromLocation },
    distance: opts.distance || 22,
    label: "running",
    started: false,
  };
}

export function stepFight(ctx, task) {
  const { citizen, tick } = ctx;
  const target = resolveEntity(citizen, task.targetId);

  if (!target) {
    citizen.setMode("idle");
    citizen.setState(STATE.IDLE);
    return "done";
  }

  // A sparring partner gives best rather than fleeing or dying.
  if (task.spar) {
    if (citizen.healthFraction <= task.yieldAt) {
      citizen.yielded = true;
      stopTravel(citizen);
      citizen.setMode("idle");
      citizen.setState(STATE.IDLE);
      return "done";
    }
    // Their opponent yielding ends it too, without a parting shot.
    const rival = ctx.registry ? ctx.registry.get(task.targetId) : null;
    if (rival && rival.yielded) { citizen.setMode("idle"); return "done"; }
  } else if (citizen.healthFraction < CONFIG.fleeHealthFraction && grit(citizen) < 0.75) {
    // Wounded and not brave enough? Break off.
    ctx.replaceTask(fleeTask(target.location));
    return "running";
  }

  const d = dist(citizen.location, target.location);
  task.engagedTicks += ctx.elapsed;

  if (d > 26 || task.engagedTicks > 20 * 60) {
    stopTravel(citizen);
    citizen.setMode("idle");
    return "done";
  }

  // Mob attack reach is a little over three blocks; anything further and we
  // have to walk. Re-path often, because the target is moving.
  if (d > MELEE_REACH) {
    citizen.setState(STATE.RUN);
    if (!isTravelling(citizen) || tick >= (task.repathAt || 0)) {
      task.repathAt = tick + 20;
      travelTo(citizen, target.location, {
        arrive: MELEE_REACH - 0.6, sprint: d > 8, allowMining: false,
      });
    }
    tickNavigation(citizen, tick);
    return "running";
  }

  // --- in reach ---------------------------------------------------------
  stopTravel(citizen);
  citizen.setMode("combat");
  safe("fight.look", () => citizen.entity.lookAt(target.location));

  task.cooldown -= ctx.elapsed;
  if (task.cooldown > 0) return "running";

  const weapon = equipTool(citizen, "sword") || equipTool(citizen, "axe");
  const bonus = weapon ? (WEAPON_DAMAGE[weapon.replace("minecraft:", "")] || 4) : 0;
  const base = citizen.job === "guard" ? 6 : 3;
  // Pulled blows in a spar, so a bout lasts long enough to watch and nobody
  // is killed by a lucky opening hit.
  const damage = task.spar ? 2 : Math.max(base, bonus);

  citizen.setState(STATE.ATTACK);
  task.cooldown = CONFIG.attackCooldownTicks;

  const killed = safe("fight.hit", () => {
    target.applyDamage(damage, { cause: "entityAttack", damagingEntity: citizen.entity });
    const push = norm(sub(target.location, citizen.location));
    target.applyKnockback({ x: push.x * 0.6, z: push.z * 0.6 }, 0.25);
    return !target.isValid;
  }, false);

  safe("fight.sound", () => {
    citizen.dimension.playSound("game.player.attack.strong", citizen.location, { volume: 0.5 });
  });

  if (killed) {
    remember(citizen.memory, `killed a ${prettyId(task.targetType || "creature")}`, 3, tick);
    reassure(citizen, 20);
    // Counted so a hunting contest can be scored off real kills.
    citizen.contestKills = (citizen.contestKills || 0) + 1;
    citizen.setMode("idle");
    return "done";
  }
  return "running";
}

export function stepFlee(ctx, task) {
  const { citizen, tick } = ctx;

  if (!task.started) {
    const away = norm(sub(citizen.location, task.from));
    const goal = {
      x: citizen.location.x + away.x * task.distance,
      y: citizen.location.y,
      z: citizen.location.z + away.z * task.distance,
    };
    const safeSpot = snapToGround(citizen.dimension, goal, citizen.location.y) || goal;
    if (!travelTo(citizen, safeSpot, { arrive: 2.5, sprint: true, allowMining: false })) {
      citizen.setMode("flee");
      return "done";
    }
    task.started = true;
    scare(citizen, 20);
  }

  citizen.setState(STATE.RUN);
  const nav = tickNavigation(citizen, tick);
  if (nav === "arrived") { citizen.setMode("idle"); return "done"; }
  if (nav === "blocked") { citizen.setMode("flee"); return "done"; }
  return "running";
}

export function resolveEntity(citizen, id) {
  if (!id) return null;
  return safe("combat.resolve", () => {
    const found = citizen.dimension.getEntities({
      location: citizen.location, maxDistance: 48,
    }).find((e) => e.id === id);
    return found && found.isValid ? found : null;
  }, null);
}

/** Nearest hostile within `radius`, or null. */
export function nearestThreat(citizen, radius = CONFIG.sightRadius) {
  const snap = citizen.snapshot;
  if (!snap || !snap.threats.length) return null;
  const t = snap.threats[0];
  return t.distance <= radius ? t : null;
}

/** True when the citizen ought to stand and fight rather than run. */
export function shouldEngage(citizen, threat) {
  if (!threat) return false;
  if (citizen.job === "guard") return true;
  if (citizen.healthFraction < 0.45) return false;
  const armed = Boolean(equipTool(citizen, "sword"));
  return grit(citizen) > (armed ? 0.45 : 0.7);
}
