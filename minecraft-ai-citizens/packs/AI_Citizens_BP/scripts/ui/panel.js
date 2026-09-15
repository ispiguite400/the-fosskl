/**
 * The in-game control panel (@minecraft/server-ui).
 *
 * Opened with `!ai panel` or by sneak-interacting with a citizen. Everything
 * here is also reachable from chat commands - the panel just makes it pleasant.
 */
import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";
import { CONFIG, saveConfigOverride } from "../core/config.js";
import { tell, safe } from "../core/log.js";
import { dist, prettyId } from "../core/util.js";
import { jobBadge } from "../agent/citizen.js";
import { clearOrders } from "../agent/memory.js";
import { say, TONE } from "./caption.js";
import { JOBS, jobList, assignJobs, describeJob } from "../civ/jobs.js";
import {
  describeSettlement, recomputeStats, shortages, refreshStockpiles,
  planNext, structureProgress, recentHistory, TIERS,
} from "../civ/settlement.js";
import { BLUEPRINTS, blueprintById, describeBlueprint } from "../civ/blueprints.js";
import { describeBrainStatus, claudeBrain } from "../brain/claude.js";
import { summariseInventory } from "../actions/inventory.js";
import { followTask, gotoTask, waitTask } from "../actions/registry.js";
import { cellsFromBlueprint, findBuildSite, buildTask } from "../actions/build.js";

export async function openPanel(app, player) {
  const form = new ActionFormData()
    .title("AI Citizens")
    .body(`§7${app.registry.count} citizens · ${app.settlements.list.length} settlements§r\n§7Brain: ${describeBrainStatus()}§r`)
    .button("Roster", "textures/ui/FriendsIcon")
    .button("Settlement", "textures/ui/icon_recipe_construction")
    .button("Spawn citizens", "textures/ui/color_plus")
    .button("Brain & bridge", "textures/ui/icon_book_writable")
    .button("Settings", "textures/ui/settings_glyph_color_2x")
    .button("Close");

  const res = await form.show(player);
  if (res.canceled) return;
  switch (res.selection) {
    case 0: return openRoster(app, player);
    case 1: return openSettlement(app, player);
    case 2: return openSpawn(app, player);
    case 3: return openBrain(app, player);
    case 4: return openSettings(app, player);
    default: return;
  }
}

async function openRoster(app, player) {
  const all = app.registry.all.slice(0, 40);
  if (!all.length) {
    await new MessageFormData().title("Roster").body("Nobody yet. Spawn some citizens first.")
      .button1("Back").button2("Close").show(player);
    return openPanel(app, player);
  }
  const form = new ActionFormData().title("Roster").body("Pick a citizen");
  for (const c of all) {
    const d = safe("panel.dist", () => Math.round(dist(player.location, c.location)), 0);
    form.button(`${c.name}\n§7${jobBadge(c.job)} · ${d}m · ${c.task?.label || "idle"}§r`);
  }
  form.button("§8< Back§r");
  const res = await form.show(player);
  if (res.canceled) return;
  if (res.selection >= all.length) return openPanel(app, player);
  return openCitizen(app, player, all[res.selection]);
}

export async function openCitizen(app, player, citizen) {
  if (!citizen.valid) return openPanel(app, player);
  const body = [
    `§f${citizen.name}§r §7${jobBadge(citizen.job)}§r`,
    `§7${citizen.personality.voice}; ${citizen.personality.quirk}§r`,
    `§7Dreams of ${citizen.personality.dream}§r`,
    "",
    `§7Doing: ${citizen.task?.label || citizen.goal || "nothing"}§r`,
    `§7Carrying: ${summariseInventory(citizen, 6)}§r`,
    `§7Hunger ${Math.round(citizen.needs.hunger)} · energy ${Math.round(citizen.needs.energy)} · morale ${Math.round(citizen.needs.morale)}§r`,
    `§7Health ${Math.round(citizen.health)}/${Math.round(citizen.maxHealth)}§r`,
  ].join("\n");

  const form = new ActionFormData()
    .title(citizen.name)
    .body(body)
    .button("Follow me")
    .button("Come here")
    .button("Stand by")
    .button("Change role")
    .button("Bring them to me")
    .button("Dismiss (despawn)")
    .button("§8< Back§r");

  const res = await form.show(player);
  if (res.canceled) return;
  switch (res.selection) {
    case 0:
      app.assignOrder(citizen, player, `follow ${player.name}`, {
        label: `following ${player.name}`,
        task: followTask(player.id, { ticks: 0, label: `following ${player.name}` }),
      });
      break;
    case 1:
      app.assignOrder(citizen, player, "come here", {
        label: "coming to you",
        task: gotoTask(player.location, { arrive: 2.5, label: `coming to ${player.name}` }),
      });
      break;
    case 2:
      clearOrders(citizen.memory);
      citizen.plan.length = 0;
      citizen.task = null;
      citizen.setMode("idle");
      say(citizen, "Standing by.", { tone: TONE.order });
      break;
    case 3:
      return openJobPicker(app, player, citizen);
    case 4:
      safe("panel.tp", () => citizen.entity.teleport(player.location, { dimension: player.dimension }));
      break;
    case 5: {
      const confirm = await new MessageFormData()
        .title("Dismiss")
        .body(`Send ${citizen.name} away for good?`)
        .button1("Yes, dismiss")
        .button2("Cancel")
        .show(player);
      if (!confirm.canceled && confirm.selection === 0) {
        app.removeCitizen(citizen);
        tell(player, `${citizen.name} has gone.`);
        return openRoster(app, player);
      }
      break;
    }
    default:
      return openRoster(app, player);
  }
  return openCitizen(app, player, citizen);
}

async function openJobPicker(app, player, citizen) {
  const jobs = jobList();
  const form = new ActionFormData().title(`${citizen.name}'s role`).body("Choose a role");
  for (const j of jobs) form.button(`${JOBS[j].name}\n§7${JOBS[j].blurb}§r`);
  form.button("§8< Back§r");
  const res = await form.show(player);
  if (res.canceled || res.selection >= jobs.length) return openCitizen(app, player, citizen);
  citizen.setJob(jobs[res.selection]);
  citizen.jobLocked = true;
  citizen.plan.length = 0;
  citizen.task = null;
  say(citizen, `${JOBS[citizen.job].name} work it is.`, { tone: TONE.order });
  return openCitizen(app, player, citizen);
}

async function openSettlement(app, player) {
  const s = app.settlements.nearest(player.location, player.dimension.id, 256);
  if (!s) {
    const res = await new MessageFormData()
      .title("Settlement")
      .body("No settlement nearby.\n\nFound one here?")
      .button1("Found it")
      .button2("Back")
      .show(player);
    if (!res.canceled && res.selection === 0) {
      app.foundSettlementAt(player);
    }
    return openPanel(app, player);
  }

  refreshStockpiles(s, player.dimension);
  const members = app.registry.inSettlement(s.id);
  const stats = recomputeStats(s);
  const short = shortages(s, player.dimension).slice(0, 5);
  const building = structureProgress(s);

  const body = [
    `§b${s.name}§r — ${TIERS[s.tier]?.name || "camp"}`,
    `§7${describeSettlement(s, members.length)}§r`,
    "",
    `§7Housing ${stats.housing} · food ${stats.food} · storage ${stats.storage}§r`,
    `§7Defence ${stats.defence} · crafting ${stats.crafting} · culture ${stats.culture}§r`,
    building.length ? `§eBuilding: ${building.map((b) => `${b.name} ${b.percent}%`).join(", ")}§r` : "§7Nothing under construction§r",
    short.length ? `§cShort: ${short.map((x) => `${x.short}x ${prettyId(x.item)}`).join(", ")}§r` : "§aWell stocked§r",
    "",
    ...recentHistory(s, 4).map((h) => `§8${h}§r`),
  ].join("\n");

  const form = new ActionFormData()
    .title(s.name)
    .body(body)
    .button("Plan the next building")
    .button("Order a specific build")
    .button("Re-assign everyone's jobs")
    .button("Recruit these citizens")
    .button("§8< Back§r");

  const res = await form.show(player);
  if (res.canceled) return;
  switch (res.selection) {
    case 0: {
      const planned = planNext(s, player.dimension, members.length);
      app.settlements.save();
      tell(player, planned
        ? `Planned a §e${blueprintById(planned.blueprintId)?.name || planned.blueprintId}§r.`
        : "§7Nothing needed right now.§r");
      break;
    }
    case 1:
      return openBuildPicker(app, player, s);
    case 2:
      assignJobs(s, members, player.dimension);
      tell(player, `Re-assigned §a${members.length}§r citizens.`);
      break;
    case 3: {
      const near = app.registry.near(player.location, 64);
      let n = 0;
      for (const c of near) {
        if (c.settlementId !== s.id) { c.settlementId = s.id; c.dirty = true; n++; }
      }
      assignJobs(s, app.registry.inSettlement(s.id), player.dimension);
      tell(player, `Recruited §a${n}§r into ${s.name}.`);
      break;
    }
    default:
      return openPanel(app, player);
  }
  return openSettlement(app, player);
}

async function openBuildPicker(app, player, settlement) {
  const list = Object.values(BLUEPRINTS);
  const form = new ActionFormData().title("Order a build").body("What should they raise?");
  for (const bp of list) form.button(`${bp.name}\n§7${bp.width}x${bp.depth}, tier ${bp.tier}§r`);
  form.button("§8< Back§r");
  const res = await form.show(player);
  if (res.canceled || res.selection >= list.length) return openSettlement(app, player);

  const bp = list[res.selection];
  const site = findBuildSite(player.dimension, player.location, bp.width, bp.depth, 24);
  if (!site) {
    tell(player, "§cNo flat ground nearby for that.§r");
    return openSettlement(app, player);
  }
  settlement.structures.push({
    id: `b${Date.now().toString(36)}`,
    blueprintId: bp.id, origin: site, rotation: 0,
    status: "planned", assignedTo: null, need: "ordered", placed: 0,
    total: bp.width * bp.depth * bp.height,
  });
  app.settlements.save();
  tell(player, `Queued §e${bp.name}§r at ${site.x}, ${site.y}, ${site.z}.`);
  return openSettlement(app, player);
}

async function openSpawn(app, player) {
  const jobs = ["(auto)", ...jobList()];
  const form = new ModalFormData()
    .title("Spawn citizens")
    .slider("How many", 1, 10, 1, 1)
    .dropdown("Role", jobs, 0)
    .toggle("Recruit into the nearest settlement", true);

  const res = await form.show(player);
  if (res.canceled) return openPanel(app, player);
  const [count, jobIndex, recruit] = res.formValues;
  const job = jobIndex === 0 ? null : jobs[jobIndex];

  const spawned = [];
  for (let i = 0; i < count; i++) {
    const c = app.spawnCitizen(player.location, player.dimension, job);
    if (c) spawned.push(c);
  }
  if (recruit) {
    const s = app.settlements.nearest(player.location, player.dimension.id, CONFIG.settlementRadius);
    if (s) for (const c of spawned) { c.settlementId = s.id; c.dirty = true; }
  }
  tell(player, spawned.length
    ? `Spawned §a${spawned.length}§r: ${spawned.map((c) => c.name).join(", ")}`
    : "§cCouldn't spawn anyone.§r");
  return openPanel(app, player);
}

async function openBrain(app, player) {
  const s = claudeBrain.status();
  const form = new ModalFormData()
    .title("Brain & bridge")
    .dropdown("Thinking engine", ["auto", "claude", "local"],
      ["auto", "claude", "local"].indexOf(CONFIG.brain))
    .textField("Bridge URL", "http://127.0.0.1:8787", CONFIG.bridgeUrl)
    .textField("Shared token (optional)", "leave blank for none", CONFIG.bridgeToken)
    .slider("Seconds between remote thoughts", 1, 15, 1, Math.round(CONFIG.claudeMinIntervalTicks / 20));

  const res = await form.show(player);
  if (res.canceled) return openPanel(app, player);
  const [mode, url, token, seconds] = res.formValues;
  saveConfigOverride(world, "brain", ["auto", "claude", "local"][mode]);
  if (url) saveConfigOverride(world, "bridgeUrl", String(url).replace(/\/$/, ""));
  saveConfigOverride(world, "bridgeToken", String(token || ""));
  saveConfigOverride(world, "claudeMinIntervalTicks", Math.round(seconds * 20));
  claudeBrain.reset();
  tell(player, `Brain: ${describeBrainStatus()}`);
  tell(player, `§7transport ${s.transport}§r`);
  return openPanel(app, player);
}

async function openSettings(app, player) {
  const form = new ModalFormData()
    .title("Settings")
    .toggle("Typewriter captions", CONFIG.typewriter)
    .toggle("Show names above citizens", CONFIG.showNamesAlways)
    .toggle("Also print speech in chat", CONFIG.captionsToChat)
    .toggle("Citizens grow the settlement on their own", CONFIG.autoGrow)
    .slider("Caption seconds", 2, 15, 1, CONFIG.captionSeconds)
    .slider("Population cap", 4, 80, 4, CONFIG.maxCitizens)
    .slider("Chat hearing range", 8, 64, 4, CONFIG.chatRadius);

  const res = await form.show(player);
  if (res.canceled) return openPanel(app, player);
  const [typewriter, names, toChat, autoGrow, capSeconds, cap, chatRadius] = res.formValues;
  saveConfigOverride(world, "typewriter", typewriter);
  saveConfigOverride(world, "showNamesAlways", names);
  saveConfigOverride(world, "captionsToChat", toChat);
  saveConfigOverride(world, "autoGrow", autoGrow);
  saveConfigOverride(world, "captionSeconds", capSeconds);
  saveConfigOverride(world, "maxCitizens", cap);
  saveConfigOverride(world, "chatRadius", chatRadius);
  tell(player, "§aSettings saved.§r");
  return openPanel(app, player);
}
