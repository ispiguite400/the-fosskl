/**
 * Citizens talking to each other.
 *
 * Pairs up idle neighbours, then alternates turns with a pause between lines so
 * the captions are readable. When Claude is driving, each turn asks the bridge
 * for the line and falls back to the local writer if the answer is slow.
 */
import { CONFIG } from "../core/config.js";
import { debug } from "../core/log.js";
import { dist, shuffled } from "../core/util.js";
import { say, TONE, isSpeaking } from "../ui/caption.js";
import { STATE } from "../agent/citizen.js";
import { pushDialogue } from "../agent/memory.js";
import { socialise } from "../agent/needs.js";
import { chattiness } from "../agent/personality.js";
import {
  canConverse, startConversation, replyLine, endConversation, farewellLine,
} from "./dialogue.js";
import { record } from "./relationships.js";
import { claudeBrain } from "../brain/claude.js";
import { sanitiseSpeech } from "../brain/schema.js";

const TURN_GAP_TICKS = 55;

export function tickConversations(registry, ctx) {
  const tick = ctx.tick;

  // --- advance running conversations -------------------------------------
  for (const citizen of registry.all) {
    const convo = citizen.conversation;
    if (!convo) continue;

    const partner = registry.get(convo.withId);
    if (!partner || !partner.valid || dist(citizen.location, partner.location) > CONFIG.conversationRadius + 4) {
      endConversation(citizen);
      if (partner) endConversation(partner);
      continue;
    }

    // Face each other - small thing, reads as a real conversation.
    if (citizen.state !== STATE.SLEEP) {
      try { citizen.entity.lookAt(partner.entity.getHeadLocation()); } catch { /* fine */ }
    }

    if (!convo.myTurn) continue;
    if (tick - convo.lastTick < TURN_GAP_TICKS) continue;
    if (isSpeaking(citizen)) continue;

    if (convo.turnsLeft <= 0) {
      say(citizen, farewellLine(citizen, partner.short), { tone: TONE.friendly, to: partner.short });
      socialise(citizen);
      socialise(partner);
      record(citizen, partner.name, "talked");
      record(partner, citizen.name, "talked");
      endConversation(citizen);
      endConversation(partner);
      continue;
    }

    speakTurn(citizen, partner, ctx);
    convo.turnsLeft -= 1;
    convo.lastTick = tick;
    convo.myTurn = false;
    if (partner.conversation) {
      partner.conversation.myTurn = true;
      partner.conversation.lastTick = tick;
    }
  }

  // --- occasionally start new ones ---------------------------------------
  if (registry.count < 2) return;
  if (tick % 40 !== 0) return;

  const idle = registry.all.filter((c) => c.valid && canConverse(c, tick) && !busy(c));
  for (const a of shuffled(idle).slice(0, 4)) {
    if (a.conversation) continue;
    const partner = idle.find((b) => b !== a && !b.conversation
      && b.dimension.id === a.dimension.id
      && dist(a.location, b.location) <= CONFIG.conversationRadius);
    if (!partner) continue;
    const chance = CONFIG.conversationChance * (0.5 + chattiness(a)) * (0.5 + chattiness(partner));
    if (Math.random() > chance) continue;

    const opener = startConversation(a, partner, tick, ctx);
    a.conversation.myTurn = false;
    partner.conversation.myTurn = true;
    partner.conversation.lastTick = tick;
    say(a, opener, { tone: TONE.friendly, to: partner.short });
    pushDialogue(a.memory, "me", opener);
    pushDialogue(partner.memory, a.short, opener);
  }
}

function busy(citizen) {
  const k = citizen.task?.kind;
  return k === "fight" || k === "flee" || k === "sleep" || k === "build";
}

function speakTurn(citizen, partner, ctx) {
  // Prefer a remote line if one is already waiting for this citizen.
  const remote = claudeBrain.poll(citizen);
  let line = null;
  if (remote && typeof remote.say === "string" && remote.say.trim()) {
    line = sanitiseSpeech(remote.say);
  } else {
    line = replyLine(citizen, partner, ctx);
    // Queue a remote line for the *next* turn so the conversation warms up.
    const lastHeard = partner.memory.dialogue.slice(-1)[0]?.t || null;
    claudeBrain.requestConverse(citizen, ctx, partner.short, lastHeard);
  }

  say(citizen, line, { tone: TONE.friendly, to: partner.short });
  pushDialogue(citizen.memory, "me", line);
  pushDialogue(partner.memory, citizen.short, line);
  citizen.dirty = true;
  partner.dirty = true;
}

/** A player can drop into an ongoing conversation; citizens turn to look. */
export function attendTo(citizen, entity) {
  try { citizen.entity.lookAt(entity.getHeadLocation()); } catch { /* fine */ }
}
