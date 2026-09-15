/**
 * Captions.
 *
 * Citizens never speak in chat. Everything they say appears as a floating
 * caption above their head, revealed a character at a time so it reads like
 * someone actually talking. A caption is just the entity's name tag with extra
 * lines, which Bedrock already renders above the head at a readable distance.
 */
import { world } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import { wrapText, trimTo, stripFormatting, dist } from "../core/util.js";
import { safe } from "../core/log.js";
import { STATE } from "../agent/citizen.js";

export const TONE = {
  normal: "§f",
  friendly: "§a",
  alarm: "§c",
  thought: "§7",
  order: "§e",
  work: "§b",
  sad: "§9",
};

/**
 * Queue a line of speech.
 * @param {Citizen} citizen
 * @param {string} text
 * @param {{tone?:string, seconds?:number, to?:string, instant?:boolean}} [opts]
 */
export function say(citizen, text, opts = {}) {
  const clean = trimTo(stripFormatting(String(text || "")).trim(), 200);
  if (!clean) return;
  citizen.speechQueue.push({
    text: clean,
    tone: opts.tone || TONE.normal,
    seconds: opts.seconds || CONFIG.captionSeconds,
    to: opts.to || null,
    instant: Boolean(opts.instant),
  });
  if (citizen.speechQueue.length > 4) citizen.speechQueue.shift();
}

/** Replace anything queued and speak right now - used for alarms. */
export function interrupt(citizen, text, opts = {}) {
  citizen.speechQueue.length = 0;
  citizen.caption = null;
  say(citizen, text, { ...opts, instant: true });
}

export function isSpeaking(citizen) {
  return Boolean(citizen.caption) || citizen.speechQueue.length > 0;
}

/**
 * Advance every citizen's caption. Called on the fast tick.
 * @param {Citizen[]} citizens
 * @param {number} tick
 * @param {number} elapsed ticks since the previous call
 */
export function tickCaptions(citizens, tick, elapsed) {
  const players = safe("caption.players", () => world.getAllPlayers(), []) || [];

  for (const citizen of citizens) {
    if (!citizen.valid) continue;

    // Start the next queued line once the current one has finished.
    if (!citizen.caption && citizen.speechQueue.length) {
      const next = citizen.speechQueue.shift();
      citizen.caption = {
        full: next.text,
        tone: next.tone,
        revealed: next.instant || !CONFIG.typewriter ? next.text.length : 0,
        expires: tick + Math.round(next.seconds * 20) + Math.round(next.text.length / 3),
        to: next.to,
        announced: false,
      };
      citizen.lastSpeechTick = tick;
      onSpeechStart(citizen, next);
    }

    const cap = citizen.caption;
    if (!cap) {
      if (citizen.state === STATE.TALK) citizen.setState(STATE.IDLE);
      continue;
    }

    // Only bother rendering for citizens somebody can actually see.
    const watched = players.some((p) => sameDim(p, citizen)
      && dist(p.location, citizen.location) <= CONFIG.captionRange);

    if (cap.revealed < cap.full.length) {
      cap.revealed = Math.min(
        cap.full.length,
        cap.revealed + CONFIG.typewriterCharsPerTick * elapsed,
      );
    }

    if (tick >= cap.expires) {
      citizen.caption = null;
      citizen.refreshNameTag();
      if (citizen.state === STATE.TALK) citizen.setState(STATE.IDLE);
      continue;
    }

    if (!watched) continue;

    const shown = cap.full.slice(0, Math.floor(cap.revealed));
    const stillTyping = cap.revealed < cap.full.length;
    const lines = wrapText(shown, CONFIG.captionWidth, CONFIG.captionMaxLines);
    const rendered = lines.map((l, i) => {
      const prefix = i === 0 ? "“" : "";
      const suffix = i === lines.length - 1 && !stillTyping ? "”" : "";
      return `${cap.tone}${prefix}${l}${suffix}§r`;
    });
    if (cap.to && lines.length) {
      rendered.push(`§8→ ${cap.to}§r`);
    }
    citizen.refreshNameTag(rendered);
  }
}

function onSpeechStart(citizen, line) {
  if (citizen.state !== STATE.SLEEP && citizen.state !== STATE.SIT) {
    citizen.setState(STATE.TALK);
  }
  if (CONFIG.speechSound) {
    safe("caption.sound", () => {
      citizen.dimension.playSound("note.hat", citizen.location, { volume: 0.25, pitch: voicePitch(citizen) });
    });
  }
  if (CONFIG.captionsToChat) {
    safe("caption.chat", () => {
      world.sendMessage(`§7<${citizen.name}>§r ${line.text}`);
    });
  }
}

/** A stable per-citizen pitch so voices are distinguishable. */
function voicePitch(citizen) {
  const base = 0.8 + (citizen.rnd ? 0 : 0);
  const h = (citizen.seed || citizen.id).split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return base + ((h % 60) / 100);
}

function sameDim(player, citizen) {
  return safe("caption.dim", () => player.dimension.id === citizen.dimension.id, false);
}

/** A short thought bubble - grey, brief, no quote marks. */
export function think(citizen, text) {
  say(citizen, text, { tone: TONE.thought, seconds: 3 });
}
