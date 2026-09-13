/* Karma: the ledger the world keeps on you.
 *
 * Feeding, taming and trading push it up. Killing things that were not
 * fighting you pushes it down, hardest of all for a still life you had
 * already befriended. The Tall One and every tamed still life read this
 * number before deciding what to do with you.
 */
import { world } from "@minecraft/server";
import { safe, tell, whisper, TAG, chance } from "./util.js";
import { addKarma, karma, mood, addCorruption, PK } from "./state.js";
import { pget, pset } from "./util.js";

const PASSIVE = new Set([
  "minecraft:cow", "minecraft:pig", "minecraft:sheep", "minecraft:chicken",
  "minecraft:rabbit", "minecraft:horse", "minecraft:donkey", "minecraft:mule",
  "minecraft:llama", "minecraft:cat", "minecraft:wolf", "minecraft:fox",
  "minecraft:panda", "minecraft:turtle", "minecraft:bee", "minecraft:axolotl",
  "minecraft:goat", "minecraft:strider", "minecraft:mooshroom", "minecraft:squid",
  "minecraft:armadillo", "minecraft:sniffer", "minecraft:camel", "minecraft:frog",
]);
const VILLAGERS = new Set([
  "minecraft:villager_v2", "minecraft:villager", "minecraft:wandering_trader",
  "minecraft:iron_golem",
]);

function isStill(e) {
  return typeof e.typeId === "string" && e.typeId.startsWith("sl:still_");
}

function note(p, delta, why) {
  const after = addKarma(p, delta);
  const sign = delta > 0 ? "§a+" : "§c";
  whisper(p, `${sign}${delta}§r §7${why} §8(the world feels ${mood(p)})`);
  return after;
}

export function install() {
  safe(() => world.afterEvents.entityDie.subscribe((ev) => {
    const victim = ev.deadEntity;
    const killer = ev.damageSource && ev.damageSource.damagingEntity;
    if (!killer || killer.typeId !== "minecraft:player") return;
    const id = victim.typeId;

    if (isStill(victim)) {
      const wasFriend = safe(() => victim.getProperty("sl:state"), "prop") === "friendly";
      pset(killer, PK.killed, Number(pget(killer, PK.killed, 0)) + 1);
      if (wasFriend) {
        note(killer, -18, "you killed something that trusted you");
        addCorruption(1.2);
      } else {
        note(killer, -5, "you killed a still life");
        addCorruption(0.35);
      }
      return;
    }
    if (VILLAGERS.has(id)) {
      note(killer, -9, "you killed a villager");
      addCorruption(0.8);
      return;
    }
    if (PASSIVE.has(id)) {
      const tamed = safe(() => victim.getComponent("minecraft:is_tamed"), "tamed");
      note(killer, tamed ? -8 : -3, tamed ? "you killed a tamed animal"
                                          : "you killed a peaceful animal");
      return;
    }
    if (id === "sl:the_tall_one") { note(killer, -4, "you put down the Tall One"); return; }
    if (id === "sl:captain_clark") { note(killer, +8, "Clark is finished"); return; }
    // hunting monsters is fine. good, even.
    const fam = safe(() => victim.matches({ families: ["monster"] }), "fam");
    if (fam) note(killer, +1, "you cleared a monster");
  }), "karma-die");

  // hitting something that was not fighting back still counts
  safe(() => world.afterEvents.entityHurt.subscribe((ev) => {
    const src = ev.damageSource && ev.damageSource.damagingEntity;
    if (!src || src.typeId !== "minecraft:player") return;
    const v = ev.hurtEntity;
    if (!v || !v.isValid) return;
    if ((isStill(v) || PASSIVE.has(v.typeId) || VILLAGERS.has(v.typeId)) && chance(0.34)) {
      addKarma(src, -1);
    }
  }), "karma-hurt");

  // kindness
  safe(() => world.afterEvents.entitySpawn.subscribe((ev) => {
    // a baby animal appearing means somebody bred something
    const e = ev.entity;
    if (!e || !PASSIVE.has(e.typeId)) return;
    const baby = safe(() => e.getComponent("minecraft:is_baby"), "baby");
    if (!baby) return;
    for (const p of world.getAllPlayers()) {
      const d = (p.location.x - e.location.x) ** 2 + (p.location.z - e.location.z) ** 2;
      if (d < 100) { addKarma(p, 2); break; }
    }
  }), "karma-breed");

  safe(() => world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
    const { player, target, itemStack } = ev;
    if (!target || !itemStack) return;
    if (VILLAGERS.has(target.typeId) && itemStack.typeId === "minecraft:emerald") {
      addKarma(player, 1);
    }
  }), "karma-trade");
}

export { karma, mood };
