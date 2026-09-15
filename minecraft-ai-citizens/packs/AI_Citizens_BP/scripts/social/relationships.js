/** Who likes whom, and why. */
import { adjustAffinity, personRecord, relationshipWord, noteAbout } from "../agent/memory.js";
import { socialise } from "../agent/needs.js";
import { clamp } from "../core/util.js";

export const EVENTS = {
  talked: 2,
  helped: 8,
  gifted: 12,
  fedThem: 10,
  savedThem: 25,
  builtTogether: 5,
  ignored: -1,
  hitThem: -30,
  stoleFrom: -20,
  letThemDown: -6,
};

export function record(citizen, otherName, eventKey, note) {
  const delta = EVENTS[eventKey] ?? 0;
  if (!delta && !note) return;
  const value = adjustAffinity(citizen.memory, otherName, delta);
  if (note) noteAbout(citizen.memory, otherName, note);
  citizen.dirty = true;
  return value;
}

export function affinity(citizen, otherName) {
  return citizen.memory.people[otherName]?.affinity ?? 0;
}

export function describeRelationship(citizen, otherName) {
  return relationshipWord(affinity(citizen, otherName));
}

/** Everyone this citizen would call a friend, best first. */
export function friendsOf(citizen, limit = 3) {
  return Object.entries(citizen.memory.people)
    .filter(([, r]) => r.affinity >= 25)
    .sort((a, b) => b[1].affinity - a[1].affinity)
    .slice(0, limit)
    .map(([name]) => name);
}

/** Town mood: the average of how everyone feels about everyone else. */
export function socialCohesion(citizens) {
  let total = 0, n = 0;
  for (const c of citizens) {
    for (const rec of Object.values(c.memory.people)) {
      total += rec.affinity;
      n += 1;
    }
  }
  return n ? clamp(total / n, -100, 100) : 0;
}
