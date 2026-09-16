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
  "status", "config", "debug", "doctor", "who", "skills",
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

/** Job words that can stand in for a group: "all the miners, go dig". */
const JOB_WORDS = {
  miner: "miner", miners: "miner",
  builder: "builder", builders: "builder", mason: "builder", masons: "builder",
  farmer: "farmer", farmers: "farmer",
  guard: "guard", guards: "guard", soldier: "guard", soldiers: "guard",
  crafter: "crafter", crafters: "crafter", smith: "crafter", smiths: "crafter",
  scout: "scout", scouts: "scout",
  hauler: "hauler", haulers: "hauler",
  woodcutter: "lumberjack", woodcutters: "lumberjack",
  lumberjack: "lumberjack", lumberjacks: "lumberjack",
  architect: "architect", architects: "architect",
  settler: "settler", settlers: "settler",
};

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, both: 2, a: 1, an: 1,
};

/**
 * Who an order is aimed at.
 *
 * An order can open by naming its audience - "all the miners", "three of you",
 * "Ada and Bram", "half of you" - and the rest of the sentence is the order
 * itself. Without this every order goes to everyone in earshot, which makes
 * dividing a town's labour impossible.
 *
 * @returns {{kind, value, text}} kind is "all" | "job" | "count" | "half" |
 *          "nearest" | "names" | "none"; text is the order with the selector
 *          stripped off.
 */
export function takeAudience(input) {
  const raw = String(input || "").trim();
  const strip = (match) => raw.slice(match.length).replace(/^[\s,:.-]+/, "").trim();

  // A trade first, because "all the miners" opens with a word that would
  // otherwise be read as "all of them".
  let m = /^(?:all\s+(?:the\s+)?|the\s+)?([a-z]+)\b[\s,:.-]*/i.exec(raw);
  if (m && JOB_WORDS[m[1].toLowerCase()]) {
    return { kind: "job", value: JOB_WORDS[m[1].toLowerCase()], text: strip(m[0]) };
  }

  // "everyone", "all of you", "citizens"
  m = /^(everyone|everybody|all of you|all of ya|citizens|all|lads|folks|team)\b[\s,:.-]*/i.exec(raw);
  if (m) return { kind: "all", value: null, text: strip(m[0]) };

  // "the rest of you", "the others"
  m = /^(the rest of you|the rest|the others|everyone else)\b[\s,:.-]*/i.exec(raw);
  if (m) return { kind: "others", value: null, text: strip(m[0]) };

  // "half of you"
  m = /^(half of you|half of ya|half)\b[\s,:.-]*/i.exec(raw);
  if (m) return { kind: "half", value: null, text: strip(m[0]) };

  // "the nearest one", "closest"
  m = /^(the nearest( one)?|nearest|the closest( one)?|closest)\b[\s,:.-]*/i.exec(raw);
  if (m) return { kind: "nearest", value: 1, text: strip(m[0]) };

  // "three of you", "2 of you"
  m = /^(\d+|one|two|three|four|five|six|seven|eight|nine|ten|both)\s+of\s+(you|ya|them)\b[\s,:.-]*/i.exec(raw);
  if (m) {
    const word = m[1].toLowerCase();
    const n = /^\d+$/.test(word) ? Number(word) : (WORD_NUMBERS[word] || 1);
    return { kind: "count", value: Math.max(1, Math.min(n, 20)), text: strip(m[0]) };
  }

  // "@Ada and @Bram", "Ada and Bram"
  m = /^@?([A-Z][\w'-]{1,15})\s+(?:and|&|,)\s+@?([A-Z][\w'-]{1,15})\b[\s,:.-]*/.exec(raw);
  if (m) return { kind: "names", value: [m[1], m[2]], text: strip(m[0]) };

  return { kind: "none", value: null, text: raw };
}

export function looksLikeQuestion(text) {
  return /\?\s*$/.test(text) || /^(what|where|who|why|how|when|can you|do you|are you|is there)\b/i.test(text);
}
