/**
 * Chat parsing.
 *
 * Three kinds of message:
 *   !ai ...          an add-on command (swallowed, never shown in chat)
 *   @Name do this    a direct instruction to one citizen (shown in chat)
 *   anything else    overheard by citizens within CONFIG.chatRadius
 */
import { CONFIG } from "../core/config.js";

export const PREFIX = "!ai";

export function classify(message) {
  const text = String(message || "").trim();

  if (text.toLowerCase().startsWith(PREFIX)) {
    const rest = text.slice(PREFIX.length).trim();
    const [head, ...tail] = rest.split(/\s+/);
    return {
      type: "command",
      command: (head || "help").toLowerCase(),
      args: tail,
      rest: tail.join(" "),
      raw: text,
    };
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

/** Splits "name rest of the words" where name may be quoted. */
export function takeName(args) {
  if (!args.length) return { name: null, rest: [] };
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
