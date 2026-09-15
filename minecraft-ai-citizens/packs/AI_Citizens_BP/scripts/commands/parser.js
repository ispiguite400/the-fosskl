/**
 * Chat parsing.
 *
 * Everything starts with the attention word - `ai!` by default:
 *
 *   ai! spawn 4                 a command
 *   ai! go mine some iron       an instruction to everyone nearby
 *   ai! @Ada follow me          an instruction to one citizen
 *   ai! what are you doing?     a question
 *
 * You do not have to remember which of those is which. `routeTrigger` looks at
 * the first word: if it names a command, it runs one; otherwise the whole thing
 * is said to the citizens. That is the entire grammar.
 *
 * Without the attention word, speech is still overheard - `@Ada ...`,
 * `everyone, ...`, or just talking near them.
 */
import { CONFIG } from "../core/config.js";

/**
 * Accepted attention words, longest first so `ai!` wins before a bare `ai`.
 * `CONFIG.chatPrefix` is tried before all of them, so a server can pick its own.
 */
const BUILT_IN_TRIGGERS = ["ai!", "!ai", "ai:", "ai,", "hey ai", "ai "];

/** Kept for callers that prepend the prefix to reconstruct a command line. */
export const PREFIX = "ai!";

/** Every word that names a command rather than something to say out loud. */
export const COMMAND_WORDS = new Set([
  "help", "spawn", "list", "panel", "come", "here", "follow", "stop", "job",
  "found", "town", "structures", "build", "tp", "remove", "brain", "bridge",
  "status", "config", "debug", "doctor", "say", "who",
]);

export function triggers() {
  const configured = String(CONFIG.chatPrefix || "").trim().toLowerCase();
  const list = configured ? [configured] : [];
  for (const t of BUILT_IN_TRIGGERS) if (!list.includes(t)) list.push(t);
  return list;
}

/**
 * Strips the attention word if the message opens with one.
 * @returns {string|null} the rest of the message, or null if not addressed to us
 */
export function stripTrigger(message) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  for (const t of triggers()) {
    if (!lower.startsWith(t)) continue;
    // A bare "ai" must be followed by a separator, or "aim for the hill" would
    // be swallowed as an instruction.
    if (/[a-z0-9]$/.test(t) && !/^[\s,:!?-]/.test(text.slice(t.length))) continue;
    return text.slice(t.length).replace(/^[\s,:!?-]+/, "").trim();
  }
  return null;
}

export function classify(message) {
  const text = String(message || "").trim();

  const addressed = stripTrigger(text);
  if (addressed !== null) {
    return { type: "trigger", text: addressed, raw: text };
  }

  const direct = /^@([\w'\-]+)[,: ]\s*(.*)$/.exec(text);
  if (direct) {
    return { type: "direct", target: direct[1], text: direct[2].trim(), raw: text };
  }

  // "Ada, go mine some iron" - addressing by name without the @
  const named = /^([A-Z][\w'\-]{1,15})\s*[,:]\s*(.+)$/.exec(text);
  if (named) {
    return { type: "maybeDirect", target: named[1], text: named[2].trim(), raw: text };
  }

  // "everyone, follow me" / "all of you, stop"
  const group = /^(everyone|everybody|all of you|citizens|all)\s*[,:]?\s*(.+)$/i.exec(text);
  if (group) {
    return { type: "group", text: group[2].trim(), raw: text };
  }

  return { type: "ambient", text, raw: text };
}

/**
 * Splits text that follows the attention word into either a command or
 * something to say.
 * @returns {{kind:"command",command:string,args:string[],rest:string}
 *          |{kind:"speech",text:string}}
 */
export function interpret(text) {
  const clean = String(text || "").trim();
  if (!clean) return { kind: "command", command: "help", args: [], rest: "" };

  const [head, ...tail] = clean.split(/\s+/);
  const word = head.toLowerCase().replace(/[^a-z]/g, "");

  if (COMMAND_WORDS.has(word)) {
    return { kind: "command", command: word, args: tail, rest: tail.join(" ") };
  }
  return { kind: "speech", text: clean };
}

/** Splits "name rest of the words" where name may be quoted. */
export function takeName(args) {
  if (!args.length) return { name: null, rest: [] };
  // "follow me" reads naturally but names nobody - treat it as no name given.
  if (/^(me|us|myself)$/i.test(args[0])) return { name: null, rest: args.slice(1) };
  if (args[0].startsWith('"')) {
    const joined = args.join(" ");
    const end = joined.indexOf('"', 1);
    if (end > 0) {
      return {
        name: joined.slice(1, end),
        rest: joined.slice(end + 1).trim().split(/\s+/).filter(Boolean),
      };
    }
  }
  return { name: args[0], rest: args.slice(1) };
}

export function looksLikeQuestion(text) {
  return /\?\s*$/.test(text) || /^(what|where|who|why|how|when|can you|do you|are you|is there)\b/i.test(text);
}
