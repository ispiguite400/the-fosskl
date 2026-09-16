/** Implementations for every `!ai` command. */
import { world, system } from "@minecraft/server";
import { CONFIG, saveConfigOverride, coerceConfigValue } from "../core/config.js";
import { tell, broadcast, info, safe } from "../core/log.js";
import { dist, prettyId, titleCase, compass } from "../core/util.js";
import { takeName } from "./parser.js";
import { jobBadge } from "../agent/citizen.js";
import { PACK_VERSION } from "../core/generated.js";
import { pushOrder, clearOrders, rememberPlace, remember } from "../agent/memory.js";
import { say, TONE, interrupt } from "../ui/caption.js";
import { openPanel } from "../ui/panel.js";
import {
  BLUEPRINTS, blueprintById, describeBlueprint, materialsFor,
} from "../civ/blueprints.js";
import {
  describeSettlement, recentHistory, recomputeStats, shortages,
  refreshStockpiles, planNext, structureProgress, TIERS, logEvent,
} from "../civ/settlement.js";
import { JOBS, jobList, assignJobs, describeJob } from "../civ/jobs.js";
import { describeBrainStatus, claudeBrain } from "../brain/claude.js";
import { summariseInventory } from "../actions/inventory.js";
import { followTask, waitTask, gotoTask, buildTask } from "../actions/registry.js";
import { cellsFromBlueprint, findBuildSite } from "../actions/build.js";
import { acknowledge } from "../social/dialogue.js";
import { describeSkills } from "./effects.js";
import { SUPPORTED_INTENTS } from "../brain/orders.js";

export function runCommand(app, player, parsed) {
  const handler = COMMANDS[parsed.command];
  if (!handler) {
    tell(player, `Unknown command §c${parsed.command}§r. Try §e!ai help§r.`);
    return;
  }
  try {
    handler(app, player, parsed);
  } catch (e) {
    tell(player, `§cThat went wrong:§r ${e.message}`);
    info(`command ${parsed.command} failed: ${e.message}`);
  }
}

const COMMANDS = {
  help(app, player) {
    const chatOn = app.capabilities && app.capabilities.chat !== "none";
    const say = chatOn ? "ai!" : "/ai:tell";

    tell(player, "§bAI Citizens§r");
    tell(player, `§7Say §f${say}§7 and then whatever you want. That is the whole thing.§r`);
    tell(player, `  §f${say} go mine some iron§r §8- tells everyone nearby§r`);
    tell(player, `  §f${say} @Ada follow me§r §8- tells one of them§r`);
    tell(player, `  §f${say} spawn 4§r §8- runs a command§r`);
    if (!chatOn) {
      tell(player, "§7Typing §fai!§7 straight into chat needs the chat build - §f!ai doctor§7.§r");
    }
    tell(player, `§7Try §f${say} skills§7 for everything they understand.§r`);
    tell(player, "§7Commands:§r");
    const lines = [
      ["spawn [n] [job]", "spawn citizens where you stand"],
      ["list", "who is alive, and what they are doing"],
      ["who <name>", "one citizen in detail"],
      ["panel", "open the control panel"],
      ["come", "call everyone nearby to you"],
      ["follow [name]", "that citizen follows you"],
      ["stop [name|all]", "cancel orders"],
      ["job <name> <job>", `set a role (${jobList().join(", ")})`],
      ["found [name]", "found a settlement where you stand"],
      ["town", "settlement report"],
      ["build <structure>", "queue a build"],
      ["structures", "what they know how to build"],
      ["tp <name>", "teleport a citizen to you"],
      ["remove <name|all>", "despawn citizens"],
      ["brain [auto|claude|local]", "choose the thinking engine"],
      ["bridge <url>", "point at the Claude bridge"],
      ["status", "brain and bridge health"],
      ["config <key> [value]", "read or change a setting"],
      ["debug", "toggle verbose logging"],
      ["doctor", "what works on this world, and what does not"],
    ];
    for (const [cmd, help] of lines) {
      tell(player, `  §e${say} ${cmd}§r §8- ${help}§r`);
    }
  },

  /** Everything a citizen understands, grouped. The answer to "what can I say?" */
  skills(app, player) {
    const chatOn = app.capabilities && app.capabilities.chat !== "none";
    const say = chatOn ? "ai!" : "/ai:tell";
    const groups = describeSkills();
    tell(player, `§bThings you can tell them§r §7(${SUPPORTED_INTENTS.length} in all)§r`);
    for (const [group, examples] of Object.entries(groups)) {
      tell(player, `§e${group}§r`);
      for (const example of examples) tell(player, `  §f${say} ${example}§r`);
    }
    tell(player, "§7They take typos, and \"then\" chains two orders:§r");
    tell(player, `  §f${say} mine 20 iron then build a house§r`);
    tell(player, "§7Aim an order with a name, a trade or a number:§r");
    tell(player, `  §f${say} all the miners dig down 20§r`);
  },

  spawn(app, player, parsed) {
    const count = Math.max(1, Math.min(20, Number(parsed.args[0]) || 1));
    const job = parsed.args[1] && JOBS[parsed.args[1].toLowerCase()] ? parsed.args[1].toLowerCase() : null;
    const spawned = [];
    for (let i = 0; i < count; i++) {
      const c = app.spawnCitizen(player.location, player.dimension, job);
      if (c) spawned.push(c);
    }
    if (!spawned.length) {
      tell(player, "§cCouldn't spawn anyone§r — the population cap may be reached.");
      return;
    }
    tell(player, `Spawned §a${spawned.length}§r: ${spawned.map((c) => c.name).join(", ")}`);
    for (const c of spawned) {
      say(c, `${c.name}. ${JOBS[c.job]?.blurb || "ready to work"}.`, { tone: TONE.friendly });
    }
  },

  list(app, player) {
    const all = app.registry.all;
    if (!all.length) { tell(player, "No citizens yet. Try §e!ai spawn 4§r."); return; }
    tell(player, `§b${all.length} citizen${all.length === 1 ? "" : "s"}§r`);
    for (const c of all.slice(0, 24)) {
      const d = safe("cmd.dist", () => Math.round(dist(player.location, c.location)), 0);
      tell(player, `  §f${c.name}§r §7${jobBadge(c.job)}§r §8${d}m — ${c.task?.label || c.goal || "idle"}§r`);
    }
    if (all.length > 24) tell(player, `  §8…and ${all.length - 24} more§r`);
  },

  panel(app, player) {
    system.run(() => openPanel(app, player));
  },

  come(app, player) { COMMANDS.here(app, player); },

  here(app, player) {
    const near = app.registry.near(player.location, 64);
    if (!near.length) { tell(player, "Nobody is close enough to hear you."); return; }
    for (const c of near) {
      app.assignOrder(c, player, "come here", {
        label: "coming to you",
        task: gotoTask(player.location, { arrive: 2.5, label: `coming to ${player.name}` }),
      });
    }
    tell(player, `§a${near.length}§r on their way.`);
  },

  follow(app, player, parsed) {
    // "ai! follow me" names nobody, so fall back to whoever is closest.
    const { name } = takeName(parsed.args);
    const c = name ? app.registry.byName(name) : app.registry.near(player.location, 24)[0];
    if (!c) {
      tell(player, name ? `§cNo citizen called ${name}.§r` : "§cNobody close enough to hear you.§r");
      return;
    }
    app.assignOrder(c, player, `follow ${player.name}`, {
      label: `following ${player.name}`,
      task: followTask(player.id, { ticks: 0, label: `following ${player.name}` }),
    });
    tell(player, `§f${c.name}§r is following you.`);
  },

  stop(app, player, parsed) {
    const target = parsed.args[0];
    const list = !target || target.toLowerCase() === "all"
      ? app.registry.near(player.location, 96)
      : [app.registry.byName(target)].filter(Boolean);
    if (!list.length) { tell(player, "§cNobody to stop.§r"); return; }
    for (const c of list) {
      clearOrders(c.memory);
      c.plan.length = 0;
      c.task = null;
      c.setMode("idle");
      say(c, "Standing by.", { tone: TONE.order });
    }
    tell(player, `Stopped §a${list.length}§r.`);
  },

  job(app, player, parsed) {
    const { name, rest } = takeName(parsed.args);
    const role = (rest[0] || "").toLowerCase();
    const c = name ? app.registry.byName(name) : null;
    if (!c) { tell(player, "§cUsage:§r !ai job <name> <role>"); return; }
    if (!JOBS[role]) { tell(player, `§cUnknown role.§r Options: ${jobList().join(", ")}`); return; }
    c.setJob(role);
    c.jobLocked = true;
    c.plan.length = 0;
    c.task = null;
    say(c, acknowledge(c, `I'll take up ${JOBS[role].name} work`), { tone: TONE.order });
    tell(player, `§f${c.name}§r is now a §e${JOBS[role].name}§r.`);
  },

  found(app, player, parsed) {
    const existing = app.settlements.nearest(player.location, player.dimension.id, CONFIG.settlementRadius);
    if (existing) {
      tell(player, `§e${existing.name}§r already claims this ground.`);
      return;
    }
    const s = app.settlements.found(player.location, player.dimension.id, player.name);
    if (parsed.rest) s.name = parsed.rest.slice(0, 24);
    app.settlements.save();

    const members = app.registry.near(player.location, 48);
    for (const c of members) {
      c.settlementId = s.id;
      c.dirty = true;
      rememberPlace(c.memory, "home", s.origin, "settlement");
      say(c, `${s.name}. We build here.`, { tone: TONE.friendly });
    }
    assignJobs(s, members, player.dimension);
    logEvent(s, `founded by ${player.name}`);
    app.settlements.save();
    broadcast(`§a${s.name}§r has been founded — ${members.length} citizens claimed it.`);
  },

  town(app, player) {
    const s = app.settlements.nearest(player.location, player.dimension.id, 256);
    if (!s) { tell(player, "No settlement nearby. Try §e!ai found§r."); return; }
    const members = app.registry.inSettlement(s.id);
    refreshStockpiles(s, player.dimension);
    const stats = recomputeStats(s);
    tell(player, `§b${s.name}§r — ${TIERS[s.tier]?.name || "camp"}`);
    tell(player, `  §7${describeSettlement(s, members.length)}§r`);
    tell(player, `  §7Housing ${stats.housing} · food ${stats.food} · storage ${stats.storage} · defence ${stats.defence} · crafting ${stats.crafting}§r`);
    const building = structureProgress(s);
    if (building.length) {
      tell(player, "  §eUnder construction:§r " + building.map((b) => `${b.name} ${b.percent}%`).join(", "));
    }
    const short = shortages(s, player.dimension).slice(0, 4);
    if (short.length) {
      tell(player, "  §cShort of:§r " + short.map((x) => `${x.short}x ${prettyId(x.item)}`).join(", "));
    }
    const history = recentHistory(s, 3);
    for (const h of history) tell(player, `  §8${h}§r`);
  },

  structures(app, player) {
    tell(player, "§bKnown structures§r");
    for (const bp of Object.values(BLUEPRINTS)) {
      tell(player, `  §e${bp.id}§r §8- ${describeBlueprint(bp)}§r`);
    }
  },

  build(app, player, parsed) {
    const id = (parsed.args[0] || "").toLowerCase();
    const bp = blueprintById(id);
    if (!bp) { tell(player, "§cUnknown structure.§r Try §e!ai structures§r."); return; }

    const site = findBuildSite(player.dimension, player.location, bp.width, bp.depth, 24);
    if (!site) { tell(player, "§cNo flat ground nearby for that.§r"); return; }

    const crew = app.registry.near(player.location, 48);
    if (!crew.length) { tell(player, "§cNo citizens nearby to build it.§r"); return; }

    const s = app.settlements.nearest(player.location, player.dimension.id, CONFIG.settlementRadius);
    if (s) {
      s.structures.push({
        id: `b${Date.now().toString(36)}`,
        blueprintId: bp.id, origin: site, rotation: 0,
        status: "planned", assignedTo: null, need: "ordered", placed: 0,
        total: bp.width * bp.depth * bp.height,
      });
      logEvent(s, `${player.name} ordered a ${bp.name}`);
      app.settlements.save();
      tell(player, `Queued a §e${bp.name}§r at ${site.x}, ${site.y}, ${site.z}.`);
    } else {
      const cells = cellsFromBlueprint(bp, site, 0);
      const builder = crew[0];
      app.assignOrder(builder, player, `build a ${bp.name}`, {
        label: `building a ${bp.name}`,
        task: buildTask(cells, { label: `building a ${bp.name}` }),
      });
      tell(player, `§f${builder.name}§r will build a §e${bp.name}§r at ${site.x}, ${site.y}, ${site.z}.`);
    }
    const mats = [...materialsFor(bp).entries()].slice(0, 5)
      .map(([id2, n]) => `${n}x ${prettyId(id2)}`).join(", ");
    tell(player, `  §7Needs: ${mats}§r`);
  },

  tp(app, player, parsed) {
    const { name } = takeName(parsed.args);
    const c = name ? app.registry.byName(name) : null;
    if (!c) { tell(player, "§cNo such citizen.§r"); return; }
    safe("cmd.tp", () => c.entity.teleport(player.location, { dimension: player.dimension }));
    tell(player, `§f${c.name}§r is here.`);
  },

  remove(app, player, parsed) {
    const target = parsed.args[0];
    if (!target) { tell(player, "§cUsage:§r !ai remove <name|all>"); return; }
    if (target.toLowerCase() === "all") {
      const n = app.removeAll();
      tell(player, `Removed §a${n}§r citizens.`);
      return;
    }
    const c = app.registry.byName(target);
    if (!c) { tell(player, "§cNo such citizen.§r"); return; }
    app.removeCitizen(c);
    tell(player, `Removed §f${target}§r.`);
  },

  brain(app, player, parsed) {
    const mode = (parsed.args[0] || "").toLowerCase();
    if (!mode) { tell(player, `Brain: ${describeBrainStatus()}`); return; }
    if (!["auto", "claude", "local"].includes(mode)) {
      tell(player, "§cUsage:§r !ai brain <auto|claude|local>");
      return;
    }
    saveConfigOverride(world, "brain", mode);
    claudeBrain.reset();
    tell(player, `Brain set to §e${mode}§r. ${describeBrainStatus()}`);
  },

  bridge(app, player, parsed) {
    const url = parsed.args[0];
    if (!url) { tell(player, `Bridge URL: §e${CONFIG.bridgeUrl}§r`); return; }
    if (!/^https?:\/\//.test(url)) { tell(player, "§cThat isn't a URL.§r"); return; }
    saveConfigOverride(world, "bridgeUrl", url.replace(/\/$/, ""));
    claudeBrain.reset();
    tell(player, `Bridge set to §e${CONFIG.bridgeUrl}§r.`);
  },

  status(app, player) {
    tell(player, `Brain: ${describeBrainStatus()}`);
    const s = claudeBrain.status();
    tell(player, `  §7transport ${s.transport} · pending ${s.pending} · calls ${s.calls} · errors ${s.errors}§r`);
    tell(player, `  §7citizens ${app.registry.count}/${CONFIG.maxCitizens} · settlements ${app.settlements.list.length} · tick ${app.tick}§r`);
    if (s.lastError) tell(player, `  §clast error: ${s.lastError}§r`);
  },

  config(app, player, parsed) {
    const key = parsed.args[0];
    if (!key) {
      const keys = Object.keys(CONFIG).join(", ");
      tell(player, `§7Settings:§r ${keys}`);
      return;
    }
    if (!(key in CONFIG)) { tell(player, `§cNo setting called ${key}.§r`); return; }
    if (parsed.args.length < 2) {
      tell(player, `§e${key}§r = §f${JSON.stringify(CONFIG[key])}§r`);
      return;
    }
    const value = coerceConfigValue(key, parsed.args.slice(1).join(" "));
    if (value === undefined) { tell(player, "§cThat value doesn't fit this setting.§r"); return; }
    saveConfigOverride(world, key, value);
    tell(player, `§e${key}§r = §a${JSON.stringify(value)}§r`);
  },

  debug(app, player) {
    saveConfigOverride(world, "debug", !CONFIG.debug);
    tell(player, `Debug logging §e${CONFIG.debug ? "on" : "off"}§r.`);
  },

  /**
   * What this runtime can and cannot do. Several Script API features are
   * pre-release and simply absent depending on how the pack was built, so this
   * turns "nothing happens" into a specific, fixable answer.
   */
  doctor(app, player) {
    const c = app.capabilities || {};
    const ok = (v) => (v ? "§a✔§r" : "§c✘§r");

    tell(player, "§bAI Citizens — diagnostics§r");
    // Which build is actually running. Minecraft ignores an imported pack whose
    // version is not higher than the installed one, so "I reinstalled it" and
    // "the new code is running" are not the same thing - this tells them apart.
    tell(player, `  §7pack version §f${PACK_VERSION}§r`);
    tell(player, `  ${ok(true)} script module loaded`);
    tell(player, `  ${ok(c.slashCommands && c.slashCommands.length)} slash commands: §f${(c.slashCommands || []).join(" ") || "none"}§r`);
    if (c.slashError) tell(player, `      §c${c.slashError}§r`);
    tell(player, `  ${ok(c.scriptEvents)} /scriptevent ai:cmd …`);

    if (c.chat === "before") {
      tell(player, `  ${ok(true)} chat listening (commands hidden from chat)`);
    } else if (c.chat === "after") {
      tell(player, `  ${ok(true)} chat listening §7(after-event: !ai text also shows in chat)§r`);
    } else {
      tell(player, `  ${ok(false)} chat listening — §7${c.chatError || "unavailable"}§r`);
      tell(player, "      §7Typing §fai!§7 in chat needs the pre-release chat API.§r");
      tell(player, "      §7Use §f/ai:tell go mine some iron§7 - it does exactly the same thing.§r");
    }

    tell(player, `  ${ok(c.interaction)} right-click / sneak-click on a citizen`);
    tell(player, `  ${ok(c.entityEvents)} death, damage and spawn events`);
    tell(player, `  ${ok(c.settlementsLoaded)} settlement save data`);

    // Can the entity actually be spawned? This is the question that matters.
    let spawnOk = false;
    let spawnErr = "";
    try {
      const probe = player.dimension.spawnEntity("ai:citizen", {
        x: player.location.x, y: player.location.y - 200, z: player.location.z,
      });
      spawnOk = Boolean(probe);
      if (probe) probe.remove();
    } catch (e) {
      spawnErr = String(e && e.message ? e.message : e).slice(0, 90);
    }
    tell(player, `  ${ok(spawnOk)} entity §fai:citizen§r can be spawned`);
    if (!spawnOk) {
      tell(player, `      §c${spawnErr || "the behaviour pack entity failed to load"}§r`);
      tell(player, "      §7Check both packs are active and Beta APIs is on.§r");
    }

    tell(player, `  §7brain: ${describeBrainStatus()}§r`);
    tell(player, `  §7citizens ${app.registry.count}/${CONFIG.maxCitizens} · settlements ${app.settlements.list.length}§r`);
  },

  say(app, player, parsed) {
    const { name, rest } = takeName(parsed.args);
    const c = name ? app.registry.byName(name) : null;
    if (!c || !rest.length) { tell(player, "§cUsage:§r !ai say <name> <text>"); return; }
    interrupt(c, rest.join(" "), { tone: TONE.normal });
  },

  who(app, player, parsed) {
    const { name } = takeName(parsed.args);
    const c = name ? app.registry.byName(name) : app.registry.near(player.location, 12)[0];
    if (!c) { tell(player, "§cNo such citizen.§r"); return; }
    tell(player, `§b${c.name}§r §7${jobBadge(c.job)}§r`);
    tell(player, `  §7${c.personality.voice}; ${c.personality.quirk}§r`);
    tell(player, `  §7dreams of ${c.personality.dream}§r`);
    tell(player, `  §7doing: ${c.task?.label || c.goal || "nothing"}§r`);
    tell(player, `  §7carrying: ${summariseInventory(c, 6)}§r`);
    tell(player, `  §7needs: hunger ${Math.round(c.needs.hunger)}, energy ${Math.round(c.needs.energy)}, morale ${Math.round(c.needs.morale)}§r`);
  },
};

export { COMMANDS };
