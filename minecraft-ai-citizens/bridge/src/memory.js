/**
 * A short rolling transcript per citizen, so a conversation with a player has
 * continuity across requests without the add-on shipping its whole history
 * every tick. Bounded and time-expired: a town left running overnight must not
 * grow the bridge's memory without limit.
 */
import { CONFIG } from "./config.js";

const histories = new Map();     // citizenId -> { turns: [], touched: number }

export function historyFor(id) {
  const entry = histories.get(id);
  if (!entry) return [];
  if (Date.now() - entry.touched > CONFIG.historyTtlMs) {
    histories.delete(id);
    return [];
  }
  return entry.turns;
}

export function remember(id, userTurn, assistantText) {
  let entry = histories.get(id);
  if (!entry) { entry = { turns: [], touched: Date.now() }; histories.set(id, entry); }
  entry.touched = Date.now();
  entry.turns.push(
    { role: "user", content: userTurn },
    { role: "assistant", content: assistantText },
  );
  // Keep pairs, newest last.
  const max = CONFIG.historyTurns * 2;
  if (entry.turns.length > max) entry.turns.splice(0, entry.turns.length - max);
}

export function forget(id) {
  histories.delete(id);
}

export function sweep() {
  const now = Date.now();
  for (const [id, entry] of histories) {
    if (now - entry.touched > CONFIG.historyTtlMs) histories.delete(id);
  }
}

export function stats() {
  return { citizens: histories.size };
}
