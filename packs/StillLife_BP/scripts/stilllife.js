/* Still lifes: spawning, decay, jump scares, friendship and betrayal.
 *
 * The behaviour pack already owns the moment-to-moment state machine. This
 * module owns the decisions that need to know things the entity cannot see:
 * how corrupt the world is, and how you have been treating everything else.
 */
import { world, system } from "@minecraft/server";
import {
  safe, every, later, chance, rint, rnd, pick, clamp, dist2, surfaceY, isAir,
  sound, dsound, whisper, tell, TAG, pget, pset,
} from "./util.js";
import {
  corruptionT, decayTier, karma, mood, betrayalChance, sanity, addKarma,
  addSanity, PK,
} from "./state.js";

const KINDS = [
  "sl:still_villager", "sl:still_cow", "sl:still_pig", "sl:still_sheep",
  "sl:still_chicken", "sl:still_wolf",
];
const SCARE_KINDS = ["sl:still_player", "sl:still_villager", "sl:still_player"];

function stillsNear(p, r) {
  return safe(() => p.dimension.getEntities({
    location: p.location, maxDistance: r, families: ["still_life"],
  }), "stills") ?? [];
}

/** A patch of ground that can hold a mob, near but not on top of the player. */
function groundNear(p, minR, maxR, angleHint) {
  for (let tries = 0; tries < 10; tries++) {
    const a = angleHint === undefined ? rnd() * Math.PI * 2
                                      : angleHint + (rnd() - 0.5) * 0.9;
    const d = minR + rnd() * (maxR - minR);
    const x = Math.floor(p.location.x + Math.cos(a) * d);
    const z = Math.floor(p.location.z + Math.sin(a) * d);
    const y = surfaceY(p.dimension, x, z, Math.floor(p.location.y) + 20,
                       Math.floor(p.location.y) - 20);
    if (y === undefined) continue;
    if (!isAir(p.dimension, { x, y: y + 1, z })) continue;
    if (!isAir(p.dimension, { x, y: y + 2, z })) continue;
    return { x: x + 0.5, y: y + 1, z: z + 0.5 };
  }
  return undefined;
}

function faceToward(e, target) {
  safe(() => {
    const dx = target.x - e.location.x, dz = target.z - e.location.z;
    const yaw = (Math.atan2(dz, dx) * 180) / Math.PI - 90;
    e.setRotation({ x: 0, y: yaw });
  }, "face");
}

function tag(e, tier) {
  safe(() => e.triggerEvent(`sl:decay_${tier}`), "tag-decay");
}

// ------------------------------------------------------------- the scares
/** A still life that simply IS there, where a moment ago it was not. */
export function jumpscare(p, forceBehind) {
  const dir = safe(() => p.getViewDirection(), "view") ?? { x: 0, y: 0, z: 1 };
  const facing = Math.atan2(dir.z, dir.x);
  const behind = forceBehind === undefined ? chance(0.58) : forceBehind;
  const a = behind ? facing + Math.PI : facing;
  const loc = groundNear(p, behind ? 1.8 : 3.0, behind ? 3.2 : 5.0, a);
  if (!loc) return false;

  const e = safe(() => p.dimension.spawnEntity(pick(SCARE_KINDS, rnd()), loc), "scare-spawn");
  if (!e) return false;

  safe(() => {
    e.triggerEvent("sl:to_still");
    e.triggerEvent("sl:jumpscare_pose");
    e.addTag("sl_scare");
    tag(e, decayTier());
  }, "scare-setup");
  faceToward(e, p.location);

  sound(p, "sl.fx.jumpscare", { volume: 1.0, pitch: 0.94 + rnd() * 0.12 });
  addSanity(p, -(6 + corruptionT() * 10));
  pset(p, PK.scares, Number(pget(p, PK.scares, 0)) + 1);

  // and then it decides what it is
  later(28 + rint(0, 22), () => {
    if (!e.isValid) return;
    const k = karma(p);
    const r = rnd();
    if (k > 30) e.triggerEvent(r < 0.55 ? "sl:to_still" : "sl:to_roam");
    else if (k > -20) e.triggerEvent(r < 0.42 ? "sl:to_flee" : r < 0.82 ? "sl:to_still"
                                                                       : "sl:to_neutral");
    else e.triggerEvent(r < 0.45 ? "sl:to_hostile" : r < 0.8 ? "sl:to_neutral" : "sl:to_flee");
  }, "scare-resolve");
  return true;
}

// ---------------------------------------------------------------- spawning
function ambientSpawn(p) {
  const t = corruptionT();
  const near = stillsNear(p, 56).length;
  const cap = 3 + Math.floor(t * 9);
  if (near >= cap) return;

  const loc = groundNear(p, 26, 54);
  if (!loc) return;
  const kind = pick(KINDS, rnd());
  const e = safe(() => p.dimension.spawnEntity(kind, loc), "ambient-spawn");
  if (!e) return;
  tag(e, decayTier());
  // a corrupt world produces angrier copies
  const r = rnd();
  if (r < 0.55 - t * 0.25) e.triggerEvent("sl:to_still");
  else if (r < 0.80 - t * 0.1) e.triggerEvent("sl:to_roam");
  else if (r < 0.93 - t * 0.15) e.triggerEvent("sl:to_neutral");
  else e.triggerEvent("sl:to_hostile");
}

// ----------------------------------------------------- friendship, and not
function tamedStills(p) {
  return stillsNear(p, 48).filter((e) => safe(() => {
    const st = e.getProperty("sl:state");
    return st === "friendly";
  }, "is-friend") === true);
}

function betrayalPass(p) {
  const chanceOf = betrayalChance(p);
  if (chanceOf <= 0) return;
  for (const e of tamedStills(p)) {
    if (!chance(chanceOf * 0.10)) continue;      // rolled per pass, not per second
    safe(() => {
      e.triggerEvent("sl:to_betray");
      dsound(p.dimension, "sl.betray", e.location, { volume: 1.0 });
      tell(p, `${TAG} §cIt was never really yours.`);
      addSanity(p, -12);
    }, "betray");
  }
}

export function install() {
  // spawning + scares, paced off corruption and off how you have behaved
  every(120, () => {
    const t = corruptionT();
    for (const p of world.getAllPlayers()) {
      const inside = pget(p, PK.inBack, false) === true;
      // the Backrooms run their own population; do not also seed the overworld
      // spawner in there
      if (!inside && chance(0.35 + t * 0.4)) ambientSpawn(p);

      // nice players get scared less. this is deliberate.
      const k = karma(p);
      const scareP = clamp(0.020 + t * 0.075 + (k < 0 ? -k / 100 * 0.05 : -k / 100 * 0.015),
                           0.004, 0.16) * (inside ? 1.5 : 1.0);
      const s = sanity(p);
      if (chance(scareP * (s < 40 ? 1.9 : 1.0))) jumpscare(p);
    }
  }, "still-spawn");

  every(400, () => {
    for (const p of world.getAllPlayers()) betrayalPass(p);
  }, "still-betray");

  // taming feedback + the karma reward for being kind to a copy
  safe(() => world.afterEvents.entityHitEntity.subscribe(() => {}), "noop");

  safe(() => world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
    const { player, target, itemStack } = ev;
    if (!target || !itemStack || !target.typeId.startsWith("sl:still_")) return;
    if (itemStack.typeId !== "sl:cotton" && itemStack.typeId !== "sl:almond_water") return;
    later(2, () => {
      if (!target.isValid) return;
      const st = safe(() => target.getProperty("sl:state"), "st");
      if (st === "friendly") {
        dsound(player.dimension, "sl.befriend", target.location, { volume: 0.9 });
        addKarma(player, 5);
        addSanity(player, 6);
        pset(player, PK.tamed, Number(pget(player, PK.tamed, 0)) + 1);
        tell(player, `${TAG} §aIt decided it likes you. §7(it can still change its mind)`);
      }
    }, "tame-check");
  }), "still-interact");

  // hallucinations and scare-spawns are not allowed to pile up forever
  every(600, () => {
    for (const p of world.getAllPlayers()) {
      const list = safe(() => p.dimension.getEntities({
        location: p.location, maxDistance: 90, families: ["still_life"],
      }), "cull-scan") ?? [];
      let extra = list.length - (14 + Math.floor(corruptionT() * 14));
      if (extra <= 0) continue;
      for (const e of list) {
        if (extra <= 0) break;
        const keep = safe(() => {
          const st = e.getProperty("sl:state");
          return st === "friendly" || st === "betraying";
        }, "keep") === true;
        if (keep) continue;
        if (dist2(e.location, p.location) < 48 * 48) continue;
        safe(() => e.remove(), "cull");
        extra--;
      }
    }
  }, "still-cull");
}
