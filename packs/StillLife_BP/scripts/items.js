/* What the twenty-four new things actually do. */
import { world, system, ItemStack, EquipmentSlot } from "@minecraft/server";
import {
  safe, every, later, chance, rint, rnd, clamp, dist2, sound, dsound, tell,
  whisper, TAG, wget, wset, pget, pset, setBlock, isAir, getTypeId, floorLoc,
} from "./util.js";
import {
  corruption, corruptionT, karma, mood, sanity, addSanity, addKarma,
  addCorruption, worldDay, PK,
} from "./state.js";
import { noclipIn, noclipOut, isInside } from "./backrooms.js";
import { landmarks } from "./recreate.js";

function consumeHeld(p) {
  safe(() => {
    const inv = p.getComponent("minecraft:inventory");
    const slot = p.selectedSlotIndex ?? p.selectedSlot ?? 0;
    const it = inv.container.getItem(slot);
    if (!it) return;
    if (it.amount > 1) { it.amount -= 1; inv.container.setItem(slot, it); }
    else inv.container.setItem(slot, undefined);
  }, "consume");
}

function lookedAtSolid(p, range) {
  return safe(() => {
    const hits = p.getBlockFromViewDirection
      ? p.getBlockFromViewDirection({ maxDistance: range, includeLiquidBlocks: false,
                                      includePassableBlocks: false })
      : undefined;
    return hits && hits.block ? hits.block : undefined;
  }, "raycast");
}

// ------------------------------------------------------------------ drinks
function onCompleteUse(ev) {
  const { source: p, itemStack: it } = ev;
  if (!p || !it) return;
  switch (it.typeId) {
    case "sl:almond_water":
      addSanity(p, 30);
      p.playSound("sl.fx.drink", { volume: 0.8 });
      whisper(p, "§a+30 sanity §7- it tastes like almonds, which is the good sign");
      break;
    case "sl:bitter_almond_water":
      addSanity(p, 58);
      addCorruption(0.4);
      p.playSound("sl.fx.drink", { volume: 0.9, pitch: 0.8 });
      safe(() => {
        p.addEffect("nausea", 220, { amplifier: 1, showParticles: false });
        p.addEffect("night_vision", 900, { amplifier: 0, showParticles: false });
      }, "bitter");
      // for a while you can see exactly how many there are
      safe(() => p.dimension.getEntities({
        location: p.location, maxDistance: 64, families: ["still_life"] })
        .forEach((e) => e.addEffect("glowing", 900, { showParticles: false })), "bitter-see");
      whisper(p, "§6+58 sanity §7- and now you can see all of them");
      break;
    case "sl:cotton_bandage":
      safe(() => {
        p.addEffect("regeneration", 200, { amplifier: 1, showParticles: true });
        p.addEffect("absorption", 600, { amplifier: 1, showParticles: false });
      }, "bandage");
      addSanity(p, 8);
      whisper(p, "§a bandaged §7- cotton from something that used to be alive");
      break;
  }
}

// ------------------------------------------------------------------- tools
function useFlickerLantern(p) {
  const on = pget(p, "sl:lantern", 0) === 1;
  pset(p, "sl:lantern", on ? 0 : 1);
  p.playSound("sl.fx.camera", { volume: 0.4, pitch: 0.7 });
  whisper(p, on ? "§8lantern off" : "§e lantern on §7- it will not stay steady");
}

function useCamcorder(p) {
  p.playSound("sl.fx.camera", { volume: 1.0 });
  const seen = safe(() => {
    const list = p.dimension.getEntities({
      location: p.location, maxDistance: 42, families: ["still_life"] });
    list.forEach((e) => e.addEffect("glowing", 320, { showParticles: false }));
    const apex = p.dimension.getEntities({
      location: p.location, maxDistance: 64, families: ["sl_apex"] });
    apex.forEach((e) => e.addEffect("glowing", 320, { showParticles: false }));
    return list.length + apex.length;
  }, "camcorder") ?? 0;
  addSanity(p, seen > 0 ? 4 : 8);
  whisper(p, seen ? `§e${seen} on tape §7- at least you know where they are`
                  : "§7nothing on tape. §8that is not the same as nothing there.");
}

function usePolaroid(p) {
  const l = floorLoc(p.location);
  const list = safe(() => JSON.parse(String(wget("sl:landmarks", "[]"))), "lm") ?? [];
  list.push({ k: "photo", x: l.x, y: l.y, z: l.z });
  while (list.length > 12) list.shift();
  wset("sl:landmarks", JSON.stringify(list));
  p.playSound("sl.fx.camera", { volume: 1.0, pitch: 1.1 });
  addSanity(p, 6);
  consumeHeld(p);
  whisper(p, `§e photographed §7${l.x} ${l.y} ${l.z} §8- proof, of a kind`);
}

function useNoclipCharm(p) {
  if (isInside(p)) { whisper(p, "§7You are already through. Find a door."); return; }
  const b = lookedAtSolid(p, 4);
  if (!b) { whisper(p, "§7Face a wall. Put your hand on it. Push."); return; }
  noclipIn(p, "You leaned on the wall and it was not there.");
}

function useExitShard(p) {
  if (!isInside(p)) { whisper(p, "§7There is nothing here to leave."); return; }
  consumeHeld(p);
  noclipOut(p, "The shard burned out. You are somewhere real.");
}

function useFrontroomsKey(p) {
  if (!isInside(p)) { whisper(p, "§7The key does not fit anything out here."); return; }
  const dir = safe(() => p.getViewDirection(), "dir") ?? { x: 0, y: 0, z: 1 };
  const x = Math.floor(p.location.x + dir.x * 2);
  const z = Math.floor(p.location.z + dir.z * 2);
  const y = Math.floor(p.location.y);
  setBlock(p.dimension, { x, y, z }, "sl:exit_door");
  setBlock(p.dimension, { x, y: y + 1, z }, "sl:exit_sign");
  p.playSound("sl.fx.door", { volume: 0.9 });
  whisper(p, "§a a door, where there was wall");
}

function useHumTuner(p) {
  p.playSound("sl.ambient.buzz", { volume: 0.8, pitch: 1.4 });
  let calmed = 0, stunned = 0;
  safe(() => {
    for (const e of p.dimension.getEntities({
      location: p.location, maxDistance: 18, families: ["still_life"] })) {
      const st = e.getProperty("sl:state");
      if (st === "hostile" || st === "betraying" || st === "fleeing") {
        e.triggerEvent(chance(0.5) ? "sl:to_still" : "sl:to_roam");
        calmed++;
      }
    }
    for (const c of p.dimension.getEntities({
      location: p.location, maxDistance: 14, type: "sl:captain_clark" })) {
      c.triggerEvent("sl:stun");
      stunned++;
      later(120, () => safe(() => { if (c.isValid) c.triggerEvent("sl:unstun"); }, "unstun"),
        "unstun-timer");
    }
  }, "tuner");
  addSanity(p, 3);
  whisper(p, stunned ? `§b the hum catches him §7- 6 seconds, double damage`
                     : calmed ? `§a ${calmed} of them went quiet`
                              : `§7 nothing was listening`);
}

function useWhistle(p) {
  p.playSound("sl.befriend", { volume: 1.0, pitch: 0.8 });
  let n = 0;
  safe(() => {
    for (const e of p.dimension.getEntities({
      location: p.location, maxDistance: 120, families: ["still_life", "sl_apex"] })) {
      const st = e.getProperty ? e.getProperty("sl:state") : undefined;
      if (st !== "friendly") continue;
      const a = rnd() * Math.PI * 2;
      e.teleport({ x: p.location.x + Math.cos(a) * 3, y: p.location.y,
                   z: p.location.z + Math.sin(a) * 3 });
      n++;
    }
  }, "whistle");
  whisper(p, n ? `§a ${n} came when you called` : `§7 nothing came`);
}

function useCompass(p) {
  const l = p.location;
  const lm = landmarks();
  let best, bestD = Infinity;
  for (const m of lm) {
    const d = (m.x - l.x) ** 2 + (m.z - l.z) ** 2;
    if (d < bestD) { bestD = d; best = m; }
  }
  const c = corruption();
  const lines = [
    `${TAG} §8------------------------------`,
    `  §7sanity     §f${Math.round(sanity(p))}%`,
    `  §7the ledger §f${karma(p)} §8(it feels §f${mood(p)}§8)`,
    `  §7corruption §f${Math.round(c)}% §8${c > 66 ? "(it has stopped pretending)"
        : c > 33 ? "(it is slipping)" : "(it still looks like itself)"}`,
    `  §7day        §f${worldDay()}`,
  ];
  if (best) {
    const dx = best.x - l.x, dz = best.z - l.z;
    const dist = Math.round(Math.hypot(dx, dz));
    const dirs = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
    const idx = (Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) + 8) % 8;
    lines.push(`  §7nearest    §f${best.k} §8${dist}m ${dirs[idx]}`);
  } else {
    lines.push(`  §7nearest    §8nothing it wants to show you yet`);
  }
  lines.push(`§8------------------------------`);
  tell(p, lines.join("\n"));
  p.playSound("sl.fx.camera", { volume: 0.3, pitch: 1.4 });
}

function useTooth(p) {
  whisper(p, `§7It is warm. §8The world feels §f${mood(p)}§8 about you.`);
  p.playSound("sl.still.idle", { volume: 0.6, pitch: 0.6 });
}

const HANDLERS = {
  "sl:flicker_lantern": useFlickerLantern,
  "sl:camcorder": useCamcorder,
  "sl:polaroid": usePolaroid,
  "sl:noclip_charm": useNoclipCharm,
  "sl:exit_sign_shard": useExitShard,
  "sl:frontrooms_key": useFrontroomsKey,
  "sl:hum_tuner": useHumTuner,
  "sl:clarks_whistle": useWhistle,
  "sl:distorted_compass": useCompass,
  "sl:tall_ones_tooth": useTooth,
};

export function install() {
  safe(() => world.afterEvents.itemUse.subscribe((ev) => {
    const fn = HANDLERS[ev.itemStack && ev.itemStack.typeId];
    if (fn) safe(() => fn(ev.source), "item:" + ev.itemStack.typeId);
  }), "item-use");

  safe(() => world.afterEvents.itemCompleteUse.subscribe(
    (ev) => safe(() => onCompleteUse(ev), "item-complete")), "item-complete-sub");

  // the lantern, flickering
  every(25, () => {
    for (const p of world.getAllPlayers()) {
      if (pget(p, "sl:lantern", 0) !== 1) continue;
      const holding = safe(() => {
        const eq = p.getComponent("minecraft:equippable");
        const it = eq && eq.getEquipment(EquipmentSlot.Mainhand);
        return it && it.typeId === "sl:flicker_lantern";
      }, "lantern-held");
      if (!holding) { pset(p, "sl:lantern", 0); continue; }
      if (chance(0.14)) {
        safe(() => p.playSound("sl.ambient.buzz", { volume: 0.25, pitch: 1.6 }), "lf");
        continue;                                   // this is the flicker
      }
      safe(() => p.addEffect("night_vision", 60, {
        amplifier: 0, showParticles: false }), "lantern-nv");
    }
  }, "lantern");
}
