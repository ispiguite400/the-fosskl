/* The Tall One, and Captain Clark.
 *
 * The Tall One arrives every five or six days, wherever you happen to be
 * standing. It is deliberately mid-paced -- you cannot walk away from it, and
 * it will not be on top of you in two seconds either. You can befriend it. If
 * you do, it will sometimes pick you up. Whether it puts you down again is
 * decided entirely by how you have treated everything else in this world.
 */
import { world, system, EquipmentSlot } from "@minecraft/server";
import {
  safe, every, later, chance, rint, rnd, clamp, dist2, sound, dsound, tell,
  whisper, TAG, wget, wset, pget, pset, surfaceY, isAir,
} from "./util.js";
import {
  corruptionT, karma, mood, betrayalChance, sanity, addSanity, addKarma,
  worldDay, decayTier, K, PK,
} from "./state.js";

const ARMOR = ["sl:stillcloth_hood", "sl:stillcloth_tunic",
               "sl:stillcloth_trousers", "sl:stillcloth_treads"];

function heldId(p) {
  return safe(() => {
    const eq = p.getComponent("minecraft:equippable");
    const it = eq && eq.getEquipment(EquipmentSlot.Mainhand);
    return it ? it.typeId : undefined;
  }, "held");
}

function stillclothPieces(p) {
  return safe(() => {
    const eq = p.getComponent("minecraft:equippable");
    if (!eq) return 0;
    const slots = [EquipmentSlot.Head, EquipmentSlot.Chest,
                   EquipmentSlot.Legs, EquipmentSlot.Feet];
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const it = eq.getEquipment(slots[i]);
      if (it && it.typeId === ARMOR[i]) n++;
    }
    return n;
  }, "armour") ?? 0;
}

function hp(e) {
  return safe(() => {
    const h = e.getComponent("minecraft:health");
    return h ? h.currentValue / h.effectiveMax : 1;
  }, "hp") ?? 1;
}

function title(p, big, small) {
  safe(() => {
    p.onScreenDisplay.setTitle(big, {
      fadeInDuration: 10, stayDuration: 50, fadeOutDuration: 20, subtitle: small,
    });
  }, "title");
}

// ------------------------------------------------------------ the Tall One
function spawnTall(p) {
  return safe(() => {
    const dir = p.getViewDirection();
    const a = Math.atan2(dir.z, dir.x) + Math.PI;      // directly behind you
    for (let d = 5; d <= 12; d += 1.5) {
      const x = Math.floor(p.location.x + Math.cos(a) * d);
      const z = Math.floor(p.location.z + Math.sin(a) * d);
      const y = surfaceY(p.dimension, x, z, Math.floor(p.location.y) + 16,
                         Math.floor(p.location.y) - 16);
      if (y === undefined) continue;
      let clear = true;
      for (let k = 1; k <= 5; k++) if (!isAir(p.dimension, { x, y: y + k, z })) clear = false;
      if (!clear) continue;
      const e = p.dimension.spawnEntity("sl:the_tall_one",
        { x: x + 0.5, y: y + 1, z: z + 0.5 });
      e.addTag("sl_tall");
      e.triggerEvent(`sl:decay_${decayTier()}`);
      title(p, "§8IT IS TALLER THAN THE TREES", "§7and it has found you");
      p.playSound("sl.music.theme_tall", { volume: 0.95 });
      p.playSound("sl.tall.roar", { volume: 1.0 });
      p.addEffect("darkness", 120, { amplifier: 0, showParticles: false });
      addSanity(p, -22);
      tell(p, `${TAG} §8Day ${worldDay()}. Something remembered your shape and got it wrong.`);
      return e;
    }
    return undefined;
  }, "spawnTall");
}

function tallCycle() {
  const day = worldDay();
  let last = Number(wget(K.tallDay, -1));
  let gap = Number(wget(K.tallGap, 0));
  if (last < 0) { wset(K.tallDay, day); wset(K.tallGap, 5 + rint(0, 1)); return; }
  if (gap <= 0) { gap = 5 + rint(0, 1); wset(K.tallGap, gap); }
  if (day - last < gap) return;

  const players = world.getAllPlayers().filter((p) =>
    safe(() => p.dimension.id.endsWith("overworld"), "d") === true);
  if (!players.length) return;
  const p = players[rint(0, players.length - 1)];
  const already = safe(() => p.dimension.getEntities({ type: "sl:the_tall_one" }).length,
    "tall-count") ?? 0;
  if (already > 0) { wset(K.tallDay, day); return; }
  if (spawnTall(p)) {
    wset(K.tallDay, day);
    wset(K.tallGap, 5 + rint(0, 1));
  }
}

/** It lifts you. What happens next is the ledger, not luck. */
function grab(tall, p) {
  safe(() => {
    tall.triggerEvent("sl:grab");
    const r = tall.getComponent("minecraft:rideable");
    if (!r) return;
    r.addRider(p);
    dsound(p.dimension, "sl.tall.roar", tall.location, { volume: 1.0, pitch: 0.8 });
    title(p, "§7it has picked you up", "§8hold still");
    addSanity(p, -10);

    later(46, () => safe(() => {
      if (!tall.isValid || !p.isValid) return;
      const betrays = chance(betrayalChance(p));
      const rc = tall.getComponent("minecraft:rideable");
      if (betrays) {
        p.playSound("sl.betray", { volume: 1.0 });
        title(p, "§4IT BITES", "§cyou were not kind to the others");
        safe(() => p.applyDamage(14, {
          cause: "entityAttack", damagingEntity: tall }), "bite");
        addSanity(p, -30);
        if (rc) rc.ejectRider(p);
        later(10, () => safe(() => {
          tall.triggerEvent("sl:enrage");
          safe(() => p.applyKnockback(
            Math.cos(rnd() * 6.28), Math.sin(rnd() * 6.28), 3.2, 0.6), "kb");
        }, "enrage"), "enrage-wait");
      } else {
        if (rc) rc.ejectRider(p);
        tall.triggerEvent("sl:bond");
        p.playSound("sl.befriend", { volume: 0.9 });
        title(p, "§ait sets you down", "§7gently, this time");
        addSanity(p, 14);
      }
    }, "grab-resolve"), "grab-timer");
  }, "grab");
}

function tallTick() {
  for (const p of world.getAllPlayers()) {
    const list = safe(() => p.dimension.getEntities({
      location: p.location, maxDistance: 48, type: "sl:the_tall_one" }), "tall-scan") ?? [];
    for (const t of list) {
      const st = safe(() => t.getProperty("sl:state"), "st");
      if (st !== "friendly") continue;
      if (safe(() => t.getComponent("minecraft:rideable")?.getRiders().length, "riders")) continue;
      // it does this because it likes you. that is the unsettling part.
      if (chance(0.045)) grab(t, p);
    }
  }
}

// --------------------------------------------------------- Captain Clark
const CLARK_ADDS = ["sl:still_player", "sl:still_villager"];

function clarkTick() {
  for (const p of world.getAllPlayers()) {
    const list = safe(() => p.dimension.getEntities({
      location: p.location, maxDistance: 72, type: "sl:captain_clark" }), "clark-scan") ?? [];
    for (const c of list) {
      const f = hp(c);
      const phase = Number(safe(() => c.getDynamicProperty("sl:phase"), "ph") ?? 0);
      if (f <= 0.66 && phase < 1) {
        safe(() => c.setDynamicProperty("sl:phase", 1), "ph1");
        c.triggerEvent("sl:phase2");
        dsound(p.dimension, "sl.clark.roar", c.location, { volume: 1.0, pitch: 0.9 });
        title(p, "§6CLARK IS RUNNING NOW", "§7he stopped pretending to be careful");
      } else if (f <= 0.33 && phase < 2) {
        safe(() => c.setDynamicProperty("sl:phase", 2), "ph2");
        c.triggerEvent("sl:phase3");
        dsound(p.dimension, "sl.clark.roar", c.location, { volume: 1.0, pitch: 0.75 });
        title(p, "§4HE IS NOT ALONE", "§cbring the light");
      }
      // he makes copies of the people he has met
      if (phase >= 1 && chance(0.10)) {
        safe(() => {
          const n = phase >= 2 ? 3 : 2;
          for (let i = 0; i < n; i++) {
            const a = rnd() * Math.PI * 2, d = 4 + rnd() * 5;
            const e = p.dimension.spawnEntity(
              CLARK_ADDS[rint(0, CLARK_ADDS.length - 1)],
              { x: c.location.x + Math.cos(a) * d, y: c.location.y,
                z: c.location.z + Math.sin(a) * d });
            e.triggerEvent("sl:to_hostile");
            e.triggerEvent("sl:decay_2");
            e.addTag("sl_clark_add");
          }
        }, "clark-adds");
      }
    }
  }
}

// -------------------------------------------------------- gear that matters
function installGearRules() {
  safe(() => world.afterEvents.entityHurt.subscribe((ev) => {
    const victim = ev.hurtEntity;
    const src = ev.damageSource && ev.damageSource.damagingEntity;
    if (!victim || !victim.isValid) return;

    // the Static Blade is what actually cuts a copy
    if (src && src.typeId === "minecraft:player") {
      const h = heldId(src);
      const isBoss = victim.typeId === "sl:captain_clark" ||
                     victim.typeId === "sl:the_tall_one";
      if (h === "sl:static_blade" && isBoss) {
        safe(() => victim.applyDamage(7, {
          cause: "entityAttack", damagingEntity: src }), "blade-bonus");
        whisper(src, "§b>> the blade finds the seam");
      } else if (h === "sl:static_blade" && victim.typeId.startsWith("sl:still_")) {
        safe(() => victim.applyDamage(4, {
          cause: "entityAttack", damagingEntity: src }), "blade-still");
      }
    }

    // Stillcloth is the only thing here that was made out of them
    if (victim.typeId === "minecraft:player" && src &&
        (src.typeId === "sl:captain_clark" || src.typeId === "sl:the_tall_one" ||
         (typeof src.typeId === "string" && src.typeId.startsWith("sl:still_")))) {
      const n = stillclothPieces(victim);
      if (n <= 0) return;
      const back = ev.damage * (0.12 * n);
      safe(() => {
        const h = victim.getComponent("minecraft:health");
        if (h) h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + back));
        if (n === 4) whisper(victim, "§e>> the cloth remembers being them");
      }, "cloth-soak");
    }
  }), "gear-hurt");

  // killing Clark
  safe(() => world.afterEvents.entityDie.subscribe((ev) => {
    const e = ev.deadEntity;
    if (!e) return;
    if (e.typeId === "sl:captain_clark") {
      wset(K.clarkDown, worldDay());
      wset("sl:clark_sector", "");
      for (const p of world.getAllPlayers()) {
        title(p, "§aCAPTAIN CLARK IS DOWN", "§7the hum changed pitch");
        addSanity(p, 30);
        tell(p, `${TAG} §7He will be back. Things here always are.`);
      }
      safe(() => e.dimension.getEntities({
        location: e.location, maxDistance: 60, tags: ["sl_clark_add"] })
        .forEach((a) => a.remove()), "clear-adds");
    }
    if (e.typeId === "sl:the_tall_one") {
      for (const p of world.getAllPlayers()) {
        title(p, "§7IT IS DOWN", "§8it will be taller next time");
        addSanity(p, 18);
      }
      wset(K.tallGap, 5 + rint(0, 1));
    }
  }), "boss-die");
}

// ------------------------------------------------------------- befriending
function installBonding() {
  safe(() => world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
    const { player, target, itemStack } = ev;
    if (!target || target.typeId !== "sl:the_tall_one" || !itemStack) return;
    if (itemStack.typeId !== "sl:still_essence" &&
        itemStack.typeId !== "sl:tall_ones_tooth") return;
    const st = safe(() => target.getProperty("sl:state"), "st");
    if (st === "friendly") { whisper(player, "§7It is already walking with you."); return; }
    if (st === "betraying") { whisper(player, "§cIt is past listening."); return; }

    const k = karma(player);
    const p = clamp(0.22 + (k + 100) / 200 * 0.62, 0.1, 0.92);
    safe(() => {
      const inv = player.getComponent("minecraft:inventory");
      const slot = player.selectedSlotIndex ?? player.selectedSlot ?? 0;
      const it = inv.container.getItem(slot);
      if (it) {
        if (it.amount > 1) { it.amount -= 1; inv.container.setItem(slot, it); }
        else inv.container.setItem(slot, undefined);
      }
    }, "consume");

    if (chance(p)) {
      target.triggerEvent("sl:bond");
      player.playSound("sl.befriend", { volume: 1.0 });
      title(player, "§ait stops", "§7it is going to follow you now");
      addKarma(player, 6);
      addSanity(player, 16);
      pset(player, PK.bonded, 1);
    } else {
      player.playSound("sl.tall.roar", { volume: 0.9, pitch: 1.1 });
      whisper(player, `§7It looked at the offering. §8(${Math.round(p * 100)}% - it can smell the ledger)`);
    }
  }), "bond");
}

export function install() {
  every(200, () => tallCycle(), "tall-cycle");
  every(200, () => tallTick(), "tall-tick");
  every(40, () => clarkTick(), "clark-tick");
  installGearRules();
  installBonding();
}

export { spawnTall };
