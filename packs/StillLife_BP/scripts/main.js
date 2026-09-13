/* STILL LIFE - A Backrooms Add-On
 * ------------------------------------------------------------------
 * Entry point. Each subsystem installs its own event handlers and
 * intervals; nothing here runs per-tick itself.
 */
import { world, system } from "@minecraft/server";
import { safe, every, later, tell, whisper, TAG, wget, wset, chance } from "./util.js";
import { corruption, corruptionT, karma, mood, sanity, worldDay, K } from "./state.js";

import * as Sanity from "./sanity.js";
import * as Karma from "./karma.js";
import * as Corruption from "./corruption.js";
import * as StillLife from "./stilllife.js";
import * as Recreate from "./recreate.js";
import * as Backrooms from "./backrooms.js";
import * as Bosses from "./bosses.js";
import * as Items from "./items.js";
import * as Music from "./music.js";

const VERSION = "1.0.0";

// sanity.js needs a way into the Backrooms without importing it (cycle).
Sanity.setFloorGaveWay((p) =>
  Backrooms.noclipIn(p, "You went through the floor. Nobody saw."));

function intro(p) {
  tell(p, [
    ``,
    `§e§lSTILL LIFE§r §8v${VERSION}`,
    `§7The world has started making copies. They are not very good copies.`,
    ``,
    `§8- §7Watch your §fsanity§7 bar. Light, almond water and sleep bring it back.`,
    `§8- §7The things you meet remember how you treat them.`,
    `§8- §7Craft a §fDistorted Compass§7 to see where you stand.`,
    `§8- §7Something very tall arrives every five or six days.`,
    ``,
  ].join("\n"));
}

function commands() {
  safe(() => world.beforeEvents.chatSend.subscribe((ev) => {
    const msg = ev.message.trim();
    if (!msg.startsWith("!sl")) return;
    ev.cancel = true;
    const p = ev.sender;
    const arg = msg.slice(3).trim().toLowerCase();
    system.run(() => safe(() => {
      if (arg === "" || arg === "status") {
        tell(p, [
          `${TAG} §8--------------------------------`,
          `  §7sanity      §f${Math.round(sanity(p))}%`,
          `  §7ledger      §f${karma(p)} §8(§f${mood(p)}§8)`,
          `  §7corruption  §f${Math.round(corruption())}%`,
          `  §7day         §f${worldDay()}`,
          `  §8!sl help`,
        ].join("\n"));
      } else if (arg === "help") {
        tell(p, [
          `${TAG} §7commands`,
          `  §f!sl status §8- where you stand`,
          `  §f!sl corrupt <0-100> §8- set world corruption (creative/testing)`,
          `  §f!sl tall §8- call the Tall One now (creative/testing)`,
          `  §f!sl recreate §8- rebuild one of your builds now`,
          `  §f!sl village §8- put up a distorted village now`,
        ].join("\n"));
      } else if (arg.startsWith("corrupt")) {
        const n = parseFloat(arg.split(/\s+/)[1]);
        if (!isNaN(n)) {
          wset(K.corruption, Math.max(0, Math.min(100, n)));
          tell(p, `${TAG} §7corruption set to §f${Math.round(corruption())}%`);
        }
      } else if (arg === "tall") {
        Bosses.spawnTall(p) ? tell(p, `${TAG} §7It is behind you.`)
                            : tell(p, `${TAG} §7No room for it here.`);
      } else if (arg === "recreate") {
        tell(p, Recreate.recreateFor(p) ? `${TAG} §7Building your copy...`
                                        : `${TAG} §7It has not watched you build anything yet.`);
      } else if (arg === "village") {
        tell(p, Recreate.villageFor(p) ? `${TAG} §7Putting up houses...`
                                       : `${TAG} §7Not here.`);
      } else {
        tell(p, `${TAG} §7unknown. try §f!sl help`);
      }
    }, "cmd"));
  }), "chat");
}

function boot() {
  Sanity.install();
  Karma.install();
  Corruption.install();
  StillLife.install();
  Recreate.install();
  Backrooms.install();
  Bosses.install();
  Items.install();
  Music.install();
  commands();

  safe(() => world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!initialSpawn) return;
    later(60, () => intro(player), "intro");
  }), "spawn-intro");

  // the world says something, occasionally, when it is getting worse
  const LINES = [
    "§8§oYou have been counted.",
    "§8§oIt is practising your walk.",
    "§8§oSomething moved a room you had already left.",
    "§8§oThe carpet in here is not from here.",
    "§8§oIt got the eyes wrong again.",
    "§8§oIt is not following you. It is ahead of you.",
  ];
  every(2400, () => {
    const t = corruptionT();
    if (t < 0.2) return;
    if (!chance(0.25 + t * 0.35)) return;
    const line = LINES[Math.floor(Math.random() * LINES.length)];
    for (const p of world.getAllPlayers()) whisper(p, line);
  }, "flavour");

  console.warn(`[STILL LIFE] v${VERSION} online. corruption=${Math.round(corruption())}%`);
}

system.run(() => safe(boot, "boot"));
