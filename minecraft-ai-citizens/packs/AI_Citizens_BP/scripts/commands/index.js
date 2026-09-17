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
import { classify, interpret, looksLikeQuestion, takeAudience, PREFIX } from "./parser.js";
import { runCommand } from "./handlers.js";
import { say, TONE, interrupt } from "../ui/caption.js";
import { openPanel, openCitizen } from "../ui/panel.js";
import { pushOrder, pushDialogue, personRecord, remember } from "../agent/memory.js";
import { acknowledge, confusedLine } from "../social/dialogue.js";
import { record } from "../social/relationships.js";
import { thinkAboutChat, claudeBrain } from "../brain/index.js";
import { parseOrderLocally } from "../brain/local.js";
import { chattiness } from "../agent/personality.js";
import { applyEffect } from "./effects.js";

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
        if (parsed.type === "trigger") {
          // "ai! spawn 4" is housekeeping and is swallowed; "ai! go mine iron"
          // is you talking, so it stays in chat for everyone to see.
          if (interpret(parsed.text).kind === "command") event.cancel = true;
          system.run(() => routeTrigger(app, player, parsed.text));
          return;
        }
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
        if (parsed.type === "trigger") {
          system.run(() => routeTrigger(app, player, parsed.text));
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

/**
 * Everything the player says to the citizens arrives here - from chat after the
 * attention word, from /ai:cmd and /ai:tell, or from /scriptevent. The first
 * word decides whether it is a command or something to say, so the player never
 * has to pick the right entry point.
 */
export function routeTrigger(app, player, text) {
  const plan = interpret(text);
  if (plan.kind === "command") {
    runCommand(app, player, plan);
    return "command";
  }

  // Addressed to the citizens, so it is an instruction rather than something
  // merely overheard - even without a name attached.
  const inner = classify(plan.text);
  if (inner.type === "direct" || inner.type === "maybeDirect") {
    routeSpeech(app, player, inner);
  } else {
    routeSpeech(app, player, { type: "group", text: plan.text, raw: plan.text });
  }
  return "speech";
}

/** `/ai:cmd ...` and `/scriptevent ai:cmd ...`. */
export function handleCommandText(app, player, text) {
  const cleaned = String(text || "").trim();
  const stripped = classify(cleaned);
  routeTrigger(app, player, stripped.type === "trigger" ? stripped.text : cleaned);
}

/** `/ai:tell ...` - same router, so either command works for either purpose. */
export function handleSpeech(app, player, text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return;
  const stripped = classify(cleaned);
  routeTrigger(app, player, stripped.type === "trigger" ? stripped.text : cleaned);
}

function routeSpeech(app, player, parsed) {
  let listeners = app.registry.near(player.location, CONFIG.chatRadius)
    .filter((c) => c.dimension.id === player.dimension.id);

  // Nobody in earshot. Ordinarily that is the end of it - you cannot give an
  // order to someone who cannot hear you. The exception is a town you have
  // sent off to live on its own: they wander, and once they are all over the
  // horizon there is no way left to call them back. So when there are citizens
  // off duty somewhere, the nearest of them still hears you.
  if (!listeners.length) {
    const strays = app.registry.all
      .filter((c) => c.offDuty && c.valid && c.dimension.id === player.dimension.id)
      .sort((a, b) => dist(a.location, player.location) - dist(b.location, player.location));
    if (!strays.length) return;
    listeners = strays.slice(0, 1);
  }

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
      // Anything said after the attention word arrives here, so this is where
      // "all the miners" and "three of you" have to be read - not only in the
      // overheard path.
      const aimed = audienceFor(app, player, listeners, parsed.text);
      if (aimed) { orderGroup(app, player, aimed.audience, aimed.text); return; }
      orderGroup(app, player, listeners, parsed.text);
      return;
    }
    default: {
      // "all the miners, go dig" and "three of you follow me" are orders to a
      // slice of the town, not chatter to overhear.
      const picked = audienceFor(app, player, listeners, parsed.text);
      if (picked) { orderGroup(app, player, picked.audience, picked.text); return; }
      overhear(app, player, listeners, parsed.text);
    }
  }
}

/**
 * A citizen has been told to do something.
 * Local parsing handles the common phrasings instantly; Claude (when present)
 * answers in its own words a moment later and can supersede the plan.
 */
/**
 * Work out who an order names, if anyone.
 * @returns {null|{audience: Citizen[], text: string}} null when the sentence
 *          names nobody, so it stays ordinary overheard speech.
 */
function audienceFor(app, player, listeners, text) {
  const picked = takeAudience(text);
  if (picked.kind === "none" || !picked.text) return null;

  const byDistance = listeners.slice().sort(
    (a, b) => dist(a.location, player.location) - dist(b.location, player.location));

  let audience;
  switch (picked.kind) {
    case "all": audience = byDistance; break;
    case "half": audience = byDistance.slice(0, Math.max(1, Math.ceil(byDistance.length / 2))); break;
    case "nearest": audience = byDistance.slice(0, 1); break;
    case "count": audience = byDistance.slice(0, picked.value); break;
    case "job": audience = byDistance.filter((c) => c.job === picked.value); break;
    case "others": audience = byDistance.filter((c) => !c.currentOrder); break;
    case "names": {
      audience = picked.value
        .map((name) => app.registry.byName(name))
        .filter((c) => Boolean(c));
      break;
    }
    default: return null;
  }

  if (!audience.length) {
    if (picked.kind === "job") tell(player, `§7No ${picked.value}s here.§r`);
    else if (picked.kind === "names") tell(player, "§7Nobody here by those names.§r");
    return null;
  }
  return { audience, text: picked.text };
}

/** One of them answers for the group; a chorus of eight captions is unreadable. */
function orderGroup(app, player, audience, text) {
  audience.forEach((c, i) => instruct(app, player, c, text, true, i > 0));
}

/**
 * Give one citizen one order, as if a player had said it to them.
 *
 * Used by standing orders, which fire from the tick loop with no chat message
 * behind them. `quiet` keeps a nightly "come home" from filling the screen with
 * the same caption every evening.
 */
export function instructOne(app, player, citizen, text, opts = {}) {
  if (!player || !citizen || !citizen.valid) return false;
  instruct(app, player, citizen, text, true, Boolean(opts.quiet));
  return true;
}

function instruct(app, player, citizen, text, direct, quiet, depth = 0) {
  const ctx = app.buildCtx(citizen);
  ctx.speakerId = player.id;
  ctx.speakerLocation = player.location;
  // "race to that hill" means the hill they are looking at.
  ctx.speakerFacing = safe("chat.facing", () => player.getViewDirection(), null);
  ctx.tasks = app.taskFactories;

  pushDialogue(citizen.memory, player.name, text);
  remember(citizen.memory, `${player.name} said: ${trimTo(text, 70)}`, 2, app.tick);
  record(citizen, player.name, "talked");
  safe("chat.look", () => citizen.entity.lookAt(player.getHeadLocation()));

  const local = parseOrderLocally(citizen, text, ctx);

  // They said "build" but not what. Asking is better than guessing or going
  // quiet - and it is what a person would do.
  if (local && local.wantsBuild === null && !quiet) {
    say(citizen, "Build what? A house, a store, a well?", { tone: TONE.order, to: player.name });
  }
  // Things only the app can do: change a trade, found a town, learn a word.
  let handled = false;
  for (const effect of (local?.effects || [])) {
    const outcome = applyEffect(app, player, citizen, effect, text);
    if (!outcome) continue;
    handled = true;
    if (outcome.say && !quiet) say(citizen, outcome.say, { tone: TONE.order, to: player.name });
    if (outcome.tell) tell(player, outcome.tell);
    if (outcome.task) { local.task = outcome.task; local.tasks = [outcome.task]; }
    if (outcome.label) local.label = outcome.label;
    // "do that again" replays the previous order. One hop only, so a pair of
    // repeats cannot bounce off each other.
    if (outcome.replay && depth === 0) {
      instruct(app, player, citizen, outcome.replay, direct, quiet, depth + 1);
      return;
    }
  }

  // Something they can answer without moving - "what are you carrying?".
  if (local && local.reply && !quiet) {
    say(citizen, local.reply, { tone: TONE.normal, to: player.name });
    handled = true;
  }

  if (local && local.task) {
    app.assignOrder(citizen, player, text, local);
    if (!quiet) say(citizen, acknowledge(citizen, local.label), { tone: TONE.order, to: player.name });
  } else if (handled) {
    citizen.dirty = true;
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
