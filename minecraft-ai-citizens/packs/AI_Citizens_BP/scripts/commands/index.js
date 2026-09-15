/**
 * Chat wiring.
 *
 * `!ai ...` is swallowed and handled as a command. Everything else stays in
 * chat as normal - but citizens within earshot hear it, and the ones addressed
 * by name act on it. Citizens never reply in chat; they answer in the caption
 * above their heads.
 */
import { world, system } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import { tell, safe, debug } from "../core/log.js";
import { dist, trimTo } from "../core/util.js";
import { classify, looksLikeQuestion, PREFIX } from "./parser.js";
import { runCommand } from "./handlers.js";
import { say, TONE, interrupt } from "../ui/caption.js";
import { openPanel, openCitizen } from "../ui/panel.js";
import { pushOrder, pushDialogue, personRecord, remember } from "../agent/memory.js";
import { acknowledge, confusedLine } from "../social/dialogue.js";
import { record } from "../social/relationships.js";
import { thinkAboutChat, claudeBrain } from "../brain/index.js";
import { parseOrderLocally, matchStructure } from "../brain/local.js";
import { chattiness } from "../agent/personality.js";
import { blueprintById } from "../civ/blueprints.js";
import { cellsFromBlueprint, findBuildSite } from "../actions/build.js";
import { buildTask, storeTask } from "../actions/registry.js";
import { nearestStockpile } from "../civ/settlement.js";

/**
 * Hook chat, if this runtime has it.
 *
 * `chatSend` is a pre-release API on both the before and after signals. A pack
 * built against the stable `@minecraft/server` does not have it at all, and
 * `.subscribe` on an undefined signal throws - which, before this was wrapped,
 * took the whole add-on down with it and left `!ai spawn` doing nothing.
 *
 * So chat is treated as an enhancement. Slash commands (commands/slash.js) are
 * the path that always works.
 *
 * @returns {{mode: "before"|"after"|"none", error: string}}
 */
export function registerChat(app) {
  const result = { mode: "none", error: "" };

  // Preferred: the before-event, because it can swallow `!ai` commands so they
  // never appear in chat.
  const before = safe("chat.before", () => world.beforeEvents?.chatSend, null);
  if (before && typeof before.subscribe === "function") {
    const ok = safe("chat.subscribeBefore", () => {
      before.subscribe((event) => {
        const player = event.sender;
        const parsed = classify(event.message);
        if (parsed.type === "command") {
          event.cancel = true;                   // never echo add-on commands
          system.run(() => runCommand(app, player, parsed));
          return;
        }
        // Everything else stays visible in chat; citizens react next tick.
        system.run(() => routeSpeech(app, player, parsed));
      });
      return true;
    }, false);
    if (ok) { result.mode = "before"; return result; }
  }

  // Fallback: the after-event still lets citizens hear you. It cannot cancel,
  // so `!ai ...` will also show up in chat - a cosmetic cost, not a broken one.
  const after = safe("chat.after", () => world.afterEvents?.chatSend, null);
  if (after && typeof after.subscribe === "function") {
    const ok = safe("chat.subscribeAfter", () => {
      after.subscribe((event) => {
        const player = event.sender;
        const parsed = classify(event.message);
        if (parsed.type === "command") {
          system.run(() => runCommand(app, player, parsed));
          return;
        }
        system.run(() => routeSpeech(app, player, parsed));
      });
      return true;
    }, false);
    if (ok) { result.mode = "after"; return result; }
  }

  result.error = "chatSend is a pre-release API and this build targets stable";
  return result;
}

/** Runs `!ai`-style command text from any source (chat, /ai:cmd, scriptevent). */
export function handleCommandText(app, player, text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) { runCommand(app, player, { command: "help", args: [], rest: "" }); return; }
  const parsed = classify(cleaned.startsWith(PREFIX) ? cleaned : `${PREFIX} ${cleaned}`);
  if (parsed.type !== "command") { runCommand(app, player, { command: "help", args: [], rest: "" }); return; }
  runCommand(app, player, parsed);
}

/** Routes plain speech from any source, exactly as overheard chat would be. */
export function handleSpeech(app, player, text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return;
  const parsed = classify(cleaned);
  if (parsed.type === "command") { runCommand(app, player, parsed); return; }
  routeSpeech(app, player, parsed);
}

function routeSpeech(app, player, parsed) {
  const listeners = app.registry.near(player.location, CONFIG.chatRadius)
    .filter((c) => c.dimension.id === player.dimension.id);
  if (!listeners.length) return;

  switch (parsed.type) {
    case "direct":
    case "maybeDirect": {
      const target = app.registry.byName(parsed.target);
      if (!target) {
        if (parsed.type === "direct") {
          tell(player, `§7Nobody here called §f${parsed.target}§7.§r`);
        } else {
          overhear(app, player, listeners, parsed.raw);
        }
        return;
      }
      instruct(app, player, target, parsed.text, true);
      // The others still hear it - that is how gossip starts.
      overhear(app, player, listeners.filter((c) => c !== target), parsed.raw, 0.25);
      return;
    }
    case "group": {
      for (const c of listeners) instruct(app, player, c, parsed.text, true, true);
      return;
    }
    default:
      overhear(app, player, listeners, parsed.text);
  }
}

/**
 * A citizen has been told to do something.
 * Local parsing handles the common phrasings instantly; Claude (when present)
 * answers in its own words a moment later and can supersede the plan.
 */
function instruct(app, player, citizen, text, direct, quiet) {
  const ctx = app.buildCtx(citizen);
  ctx.speakerId = player.id;
  ctx.speakerLocation = player.location;
  ctx.tasks = app.taskFactories;

  pushDialogue(citizen.memory, player.name, text);
  remember(citizen.memory, `${player.name} said: ${trimTo(text, 70)}`, 2, app.tick);
  record(citizen, player.name, "talked");
  safe("chat.look", () => citizen.entity.lookAt(player.getHeadLocation()));

  const local = parseOrderLocally(citizen, text, ctx);

  if (local && local.wantsBuild) {
    const bp = blueprintById(local.wantsBuild);
    const site = bp ? findBuildSite(citizen.dimension, citizen.location, bp.width, bp.depth, 24) : null;
    if (bp && site) {
      local.task = buildTask(cellsFromBlueprint(bp, site, 0), { label: `building a ${bp.name}` });
      local.label = `building a ${bp.name}`;
    }
  }
  if (local && local.wantsStore && ctx.settlement) {
    const chest = nearestStockpile(ctx.settlement, citizen.location);
    if (chest) { local.task = storeTask(chest, null); local.label = "storing goods"; }
  }

  if (local && local.task) {
    app.assignOrder(citizen, player, text, local);
    if (!quiet) say(citizen, acknowledge(citizen, local.label), { tone: TONE.order, to: player.name });
  } else {
    // Nothing we can act on locally - record the order so the brain sees it.
    pushOrder(citizen.memory, text, player.name, app.tick);
    if (!claudeBrain.available || !claudeBrain.healthy) {
      if (!quiet) {
        say(citizen, looksLikeQuestion(text)
          ? answerLocally(citizen, text, ctx)
          : confusedLine(citizen, player.name), { tone: TONE.normal, to: player.name });
      }
    }
  }

  // Always give Claude the chance to answer in character.
  thinkAboutChat(citizen, ctx, player.name, text, Boolean(direct));
  citizen.dirty = true;
}

/** Citizens overhearing normal chat: a few of them react. */
function overhear(app, player, listeners, text, chanceScale = 1) {
  for (const c of listeners) {
    pushDialogue(c.memory, player.name, text);
    const ctx = app.buildCtx(c);
    const chance = (0.12 + chattiness(c) * 0.25) * chanceScale;
    if (Math.random() > chance) continue;
    safe("chat.glance", () => c.entity.lookAt(player.getHeadLocation()));
    thinkAboutChat(c, ctx, player.name, text, false);
    if (!claudeBrain.available || !claudeBrain.healthy) {
      if (looksLikeQuestion(text)) {
        say(c, answerLocally(c, text, ctx), { tone: TONE.normal, to: player.name });
      }
    }
  }
}

/** A short, honest answer built from what the citizen actually knows. */
function answerLocally(citizen, question, ctx) {
  const q = question.toLowerCase();
  const snap = citizen.snapshot;

  if (/\b(what.*doing|what are you|busy)\b/.test(q)) {
    return citizen.task ? `${capitalise(citizen.task.label || citizen.task.kind)}.` : "Nothing much. Give me a job.";
  }
  if (/\b(who are you|your name|what.*called)\b/.test(q)) {
    return `${citizen.name}. ${citizen.job === "settler" ? "Turn my hand to anything." : `I do the ${citizen.job}'s work here.`}`;
  }
  if (/\b(where|which way)\b/.test(q) && snap) {
    const ore = snap.blocks.find((b) => b.ore);
    if (ore) return `${capitalise(ore.label)} ${ore.distance} paces ${ore.direction}.`;
    if (ctx.settlement) return `${ctx.settlement.name} is that way. Everything else I'd have to go and find.`;
  }
  if (/\b(how.*you|how are|alright|ok)\b/.test(q)) {
    const n = citizen.needs;
    if (n.hunger < 35) return "Hungry. Otherwise fine.";
    if (n.energy < 30) return "Tired to the bone, but standing.";
    if (n.morale > 70) return "Better than I've any right to be.";
    return "Getting on with it.";
  }
  if (/\b(what.*need|short|missing)\b/.test(q) && ctx.shortages?.length) {
    const s = ctx.shortages[0];
    return `We're short of ${s.item.replace("minecraft:", "").replace(/_/g, " ")}. Badly.`;
  }
  if (/\b(town|village|settlement|here)\b/.test(q) && ctx.settlement) {
    return `${ctx.settlement.name}. ${ctx.memberCount} of us. It's coming along.`;
  }
  if (/\b(see|look|notice)\b/.test(q) && snap) {
    if (snap.threats.length) return `A ${snap.threats[0].kind}, ${snap.threats[0].direction} of here. Watch yourself.`;
    if (snap.blocks.length) return `${capitalise(snap.blocks[0].label)}, mostly. ${snap.blocks[0].direction} of us.`;
  }
  return confusedLine(citizen, "friend");
}

function capitalise(s) {
  return String(s).charAt(0).toUpperCase() + String(s).slice(1);
}

/** Sneak-interact with a citizen to open their page in the panel. */
export function registerInteraction(app) {
  const signal = safe("interact.signal", () => world.afterEvents?.playerInteractWithEntity, null);
  if (!signal || typeof signal.subscribe !== "function") return false;
  return safe("interact.subscribe", () => {
    signal.subscribe((event) => {
    const { player, target } = event;
    if (!target || target.typeId !== "ai:citizen") return;
    const citizen = app.registry.get(target.id);
    if (!citizen) return;
    if (player.isSneaking) {
      system.run(() => openCitizen(app, player, citizen));
    } else {
      const ctx = app.buildCtx(citizen);
      safe("interact.look", () => citizen.entity.lookAt(player.getHeadLocation()));
      thinkAboutChat(citizen, ctx, player.name, "(you walk up to them)", true);
      if (!claudeBrain.available || !claudeBrain.healthy) {
        say(citizen, greetingFor(citizen, player.name), { tone: TONE.friendly, to: player.name });
      }
    }
    });
    return true;
  }, false);
}

function greetingFor(citizen, playerName) {
  const rec = personRecord(citizen.memory, playerName);
  rec.met += 1;
  if (rec.met === 1) return `You must be ${playerName}. ${citizen.name}.`;
  if (rec.affinity > 40) return `${playerName}! Good to see you.`;
  if (rec.affinity < -30) return `${playerName}. What do you want.`;
  return `${playerName}. Something you need?`;
}
