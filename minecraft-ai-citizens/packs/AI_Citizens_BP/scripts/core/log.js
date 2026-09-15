import { world } from "@minecraft/server";
import { CONFIG } from "./config.js";

const PREFIX = "§8[§bAI§8]§r ";

export function debug(...parts) {
  if (!CONFIG.debug) return;
  const msg = parts.map(fmt).join(" ");
  console.warn("[AI] " + msg);
  try {
    world.sendMessage("§8[AI] " + msg);
  } catch { /* not safe to message here - console line is enough */ }
}

export function info(...parts) {
  console.warn("[AI] " + parts.map(fmt).join(" "));
}

export function warn(...parts) {
  console.warn("[AI][warn] " + parts.map(fmt).join(" "));
}

/** Report an error without ever letting it kill the tick loop. */
export function reportError(where, err) {
  const msg = err && err.message ? err.message : String(err);
  console.warn(`[AI][error] ${where}: ${msg}`);
  if (CONFIG.debug && err && err.stack) console.warn(err.stack);
}

export function tell(player, text) {
  try {
    player.sendMessage(PREFIX + text);
  } catch (e) {
    reportError("tell", e);
  }
}

export function broadcast(text) {
  try {
    world.sendMessage(PREFIX + text);
  } catch (e) {
    reportError("broadcast", e);
  }
}

/** Run `fn`, swallow and log anything it throws. Returns undefined on failure. */
export function safe(where, fn, fallback) {
  try {
    return fn();
  } catch (e) {
    reportError(where, e);
    return fallback;
  }
}

function fmt(p) {
  if (typeof p === "string") return p;
  try {
    return JSON.stringify(p);
  } catch {
    return String(p);
  }
}
