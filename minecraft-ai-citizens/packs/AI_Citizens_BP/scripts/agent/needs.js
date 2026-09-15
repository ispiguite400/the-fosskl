/** Hunger, energy, social contact, safety and morale - the drive behind goals. */
import { CONFIG } from "../core/config.js";
import { clamp } from "../core/util.js";

export function freshNeeds() {
  return { hunger: 100, energy: 100, social: 100, safety: 100, morale: 70 };
}

export function decayNeeds(citizen, isNightTime) {
  const n = citizen.needs;
  const working = citizen.task && citizen.task.kind !== "idle";
  n.hunger = clamp(n.hunger - CONFIG.hungerPerSlowTick * (working ? 1.3 : 1), 0, 100);
  n.energy = clamp(
    n.energy - CONFIG.energyPerSlowTick * (working ? 1.4 : 1) * (isNightTime ? 1.5 : 1),
    0, 100,
  );
  n.social = clamp(n.social - CONFIG.socialPerSlowTick, 0, 100);

  // starvation and exhaustion grind morale down; comfort lifts it
  const strain = (n.hunger < 25 ? 1.5 : 0) + (n.energy < 20 ? 1.2 : 0) + (n.safety < 40 ? 1.0 : 0);
  const comfort = (n.hunger > 70 ? 0.5 : 0) + (n.social > 70 ? 0.6 : 0) + (citizen.home ? 0.4 : 0);
  n.morale = clamp(n.morale - strain + comfort, 0, 100);
}

export function feed(citizen, amount) {
  citizen.needs.hunger = clamp(citizen.needs.hunger + amount * 9, 0, 100);
  citizen.needs.morale = clamp(citizen.needs.morale + 3, 0, 100);
}

export function rest(citizen, amount) {
  citizen.needs.energy = clamp(citizen.needs.energy + amount, 0, 100);
}

export function socialise(citizen, amount = 18) {
  citizen.needs.social = clamp(citizen.needs.social + amount, 0, 100);
  citizen.needs.morale = clamp(citizen.needs.morale + 1.5, 0, 100);
}

export function scare(citizen, amount = 25) {
  citizen.needs.safety = clamp(citizen.needs.safety - amount, 0, 100);
  citizen.needs.morale = clamp(citizen.needs.morale - amount * 0.25, 0, 100);
}

export function reassure(citizen, amount = 6) {
  citizen.needs.safety = clamp(citizen.needs.safety + amount, 0, 100);
}

export function moodOf(citizen) {
  const n = citizen.needs;
  if (n.safety < 35) return "afraid";
  if (n.hunger < 25) return "hungry";
  if (n.energy < 20) return "exhausted";
  if (n.morale > 78) return "cheerful";
  if (n.morale < 30) return "low";
  if (n.social < 30) return "lonely";
  return "steady";
}

/** Short status the brain sees, e.g. "hungry (22), tired (18)". */
export function describeNeeds(citizen) {
  const n = citizen.needs;
  const parts = [];
  if (n.hunger < CONFIG.eatThreshold) parts.push(`hungry (${Math.round(n.hunger)})`);
  if (n.energy < 40) parts.push(`tired (${Math.round(n.energy)})`);
  if (n.social < 40) parts.push(`lonely (${Math.round(n.social)})`);
  if (n.safety < 60) parts.push(`uneasy (${Math.round(n.safety)})`);
  if (!parts.length) parts.push("comfortable");
  return parts.join(", ");
}
