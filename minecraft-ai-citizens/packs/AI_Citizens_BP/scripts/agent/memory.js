/**
 * A citizen's memory.
 *
 * - `events`   short-term episodic log (what just happened, in order)
 * - `facts`    durable one-line beliefs about the world ("iron is under the ridge")
 * - `people`   per-person relationship: affinity, what they were last told, debts
 * - `places`   named locations they can navigate back to
 * - `orders`   standing instructions from a player, newest first
 *
 * Everything is bounded so a long-lived world cannot grow the save forever.
 */
import { dist, trimTo } from "../core/util.js";

const MAX_EVENTS = 24;
const MAX_FACTS = 20;
const MAX_PEOPLE = 24;
const MAX_PLACES = 16;
const MAX_ORDERS = 6;
const MAX_DIALOGUE = 12;

export function freshMemory() {
  return {
    events: [],
    facts: [],
    people: {},
    places: {},
    orders: [],
    dialogue: [],
    lastSpokeTick: -9999,
  };
}

// --- episodic -----------------------------------------------------------
export function remember(mem, text, importance = 1, tick = 0) {
  const entry = { t: tick, text: trimTo(String(text), 140), w: importance };
  mem.events.push(entry);
  if (mem.events.length > MAX_EVENTS) {
    // drop the least important of the oldest half rather than always the head,
    // so a big moment survives a busy minute
    const half = mem.events.slice(0, Math.floor(mem.events.length / 2));
    let worstIdx = 0;
    for (let i = 1; i < half.length; i++) if (half[i].w < half[worstIdx].w) worstIdx = i;
    mem.events.splice(worstIdx, 1);
  }
}

export function recentEvents(mem, n = 6) {
  return mem.events.slice(-n).map((e) => e.text);
}

// --- semantic -----------------------------------------------------------
export function learnFact(mem, text) {
  const clean = trimTo(String(text), 120);
  if (!clean) return;
  const existing = mem.facts.findIndex((f) => f.text === clean);
  if (existing >= 0) {
    mem.facts[existing].hits += 1;
    return;
  }
  mem.facts.push({ text: clean, hits: 1 });
  if (mem.facts.length > MAX_FACTS) {
    mem.facts.sort((a, b) => a.hits - b.hits);
    mem.facts.shift();
  }
}

export function knownFacts(mem, n = 6) {
  return mem.facts.slice(-n).map((f) => f.text);
}

// --- people -------------------------------------------------------------
export function personRecord(mem, name) {
  if (!mem.people[name]) {
    mem.people[name] = { affinity: 0, met: 0, lastSaid: "", notes: [] };
    const keys = Object.keys(mem.people);
    if (keys.length > MAX_PEOPLE) delete mem.people[keys[0]];
  }
  return mem.people[name];
}

export function adjustAffinity(mem, name, delta) {
  const rec = personRecord(mem, name);
  rec.affinity = Math.max(-100, Math.min(100, rec.affinity + delta));
  return rec.affinity;
}

export function noteAbout(mem, name, text) {
  const rec = personRecord(mem, name);
  rec.notes.push(trimTo(text, 90));
  if (rec.notes.length > 3) rec.notes.shift();
}

export function relationshipWord(affinity) {
  if (affinity >= 60) return "trusted friend";
  if (affinity >= 25) return "friend";
  if (affinity > -15) return "acquaintance";
  if (affinity > -50) return "wary of them";
  return "hostile";
}

// --- places -------------------------------------------------------------
export function rememberPlace(mem, label, location, kind = "place") {
  mem.places[label] = {
    x: Math.round(location.x), y: Math.round(location.y), z: Math.round(location.z),
    kind,
  };
  const keys = Object.keys(mem.places);
  if (keys.length > MAX_PLACES) delete mem.places[keys[0]];
}

export function recallPlace(mem, label) {
  return mem.places[label];
}

export function nearestPlace(mem, from, kind) {
  let best = null, bestD = Infinity;
  for (const [label, p] of Object.entries(mem.places)) {
    if (kind && p.kind !== kind) continue;
    const d = dist(from, p);
    if (d < bestD) { bestD = d; best = { label, ...p, distance: d }; }
  }
  return best;
}

// --- orders -------------------------------------------------------------
export function pushOrder(mem, text, from, tick) {
  mem.orders.unshift({ text: trimTo(text, 160), from, t: tick, done: false });
  if (mem.orders.length > MAX_ORDERS) mem.orders.pop();
}

export function activeOrder(mem) {
  return mem.orders.find((o) => !o.done);
}

export function completeOrder(mem, order) {
  if (order) order.done = true;
}

export function clearOrders(mem) {
  mem.orders.length = 0;
}

// --- dialogue -----------------------------------------------------------
export function pushDialogue(mem, speaker, text) {
  mem.dialogue.push({ s: speaker, t: trimTo(text, 160) });
  if (mem.dialogue.length > MAX_DIALOGUE) mem.dialogue.shift();
}

export function dialogueTranscript(mem, n = 8) {
  return mem.dialogue.slice(-n).map((d) => `${d.s}: ${d.t}`);
}

/** Everything the brain needs, as plain text. */
export function summarise(mem, citizenName) {
  const lines = [];
  const facts = knownFacts(mem, 5);
  if (facts.length) lines.push("Knows: " + facts.join("; "));
  const events = recentEvents(mem, 5);
  if (events.length) lines.push("Lately: " + events.join("; "));
  const people = Object.entries(mem.people)
    .sort((a, b) => Math.abs(b[1].affinity) - Math.abs(a[1].affinity))
    .slice(0, 4)
    .map(([n, r]) => `${n} (${relationshipWord(r.affinity)})`);
  if (people.length) lines.push("People: " + people.join(", "));
  const places = Object.entries(mem.places)
    .slice(0, 5)
    .map(([l, p]) => `${l} @ ${p.x},${p.y},${p.z}`);
  if (places.length) lines.push("Places: " + places.join(", "));
  const order = activeOrder(mem);
  if (order) lines.push(`Standing order from ${order.from}: "${order.text}"`);
  return lines.join("\n") || `${citizenName} has no notable memories yet.`;
}

// --- serialisation ------------------------------------------------------
export function packMemory(mem) {
  return {
    e: mem.events.slice(-12),
    f: mem.facts.slice(-12),
    p: mem.people,
    l: mem.places,
    // Orders carry a live task object (which can hold functions), so only the
    // human-readable part is persisted; the brain re-derives the task on load.
    o: mem.orders.map((o) => ({ text: o.text, from: o.from, t: o.t, done: o.done, label: o.label })),
    d: mem.dialogue.slice(-6),
  };
}

export function unpackMemory(blob) {
  const mem = freshMemory();
  if (!blob || typeof blob !== "object") return mem;
  mem.events = Array.isArray(blob.e) ? blob.e : [];
  mem.facts = Array.isArray(blob.f) ? blob.f : [];
  mem.people = blob.p && typeof blob.p === "object" ? blob.p : {};
  mem.places = blob.l && typeof blob.l === "object" ? blob.l : {};
  mem.orders = Array.isArray(blob.o) ? blob.o : [];
  mem.dialogue = Array.isArray(blob.d) ? blob.d : [];
  return mem;
}
