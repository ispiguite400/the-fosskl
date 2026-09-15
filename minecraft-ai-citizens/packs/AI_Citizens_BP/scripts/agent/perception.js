/**
 * Turns the world around a citizen into a compact, describable snapshot.
 *
 * Scanning is deliberately coarse (stride 2) and budgeted, because this runs on
 * the server tick. The snapshot is what both brains reason over and what
 * citizens talk about, so it is phrased in terms a person would use.
 */
import { world } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import {
  dist, dist2d, compass, prettyId, keyOf, timeLabel, isNight, topN,
} from "../core/util.js";
import {
  isOre, isLog, isDangerous, noteworthiness, ORES, describeBlock,
} from "../core/blocks.js";

const HOSTILE_HINT = /zombie|skeleton|creeper|spider|enderman|witch|husk|drowned|pillager|vindicator|ravager|phantom|slime|blaze|ghast|piglin_brute|hoglin|warden|stray|silverfish|vex|evocation/i;
const PASSIVE_HINT = /cow|sheep|pig|chicken|horse|donkey|llama|rabbit|fox|wolf|cat|goat|bee|axolotl|turtle|villager|strider|camel|sniffer|armadillo/i;

export function perceive(citizen, tick) {
  const entity = citizen.entity;
  const origin = entity.location;
  const dim = entity.dimension;

  const snapshot = {
    tick,
    position: { x: Math.round(origin.x), y: Math.round(origin.y), z: Math.round(origin.z) },
    dimension: dim.id.replace("minecraft:", ""),
    time: timeLabel(world.getTimeOfDay()),
    day: world.getDay(),
    night: isNight(world.getTimeOfDay()),
    weather: readWeather(dim),
    health: readHealth(entity),
    players: [],
    citizens: [],
    threats: [],
    animals: [],
    blocks: [],
    ground: "unknown",
    standingIn: "air",
    hazards: [],
    structures: [],
  };

  scanEntities(citizen, snapshot, origin, dim);
  scanBlocks(citizen, snapshot, origin, dim);
  return snapshot;
}

function readWeather(dim) {
  try {
    const w = dim.getWeather();
    if (w === "Thunder") return "thunderstorm";
    if (w === "Rain") return "rain";
    return "clear";
  } catch {
    return "clear";
  }
}

function readHealth(entity) {
  try {
    const hp = entity.getComponent("minecraft:health");
    return hp ? { current: Math.round(hp.currentValue), max: Math.round(hp.effectiveMax) } : null;
  } catch {
    return null;
  }
}

function scanEntities(citizen, snapshot, origin, dim) {
  let nearby = [];
  try {
    nearby = dim.getEntities({ location: origin, maxDistance: CONFIG.sightRadius });
  } catch {
    return;
  }

  for (const other of nearby) {
    if (!other || !other.isValid) continue;
    if (other.id === citizen.entity.id) continue;
    let typeId;
    try { typeId = other.typeId; } catch { continue; }
    if (typeId === "ai:nav_point") continue;

    const d = dist(origin, other.location);
    const dir = compass(origin, other.location);

    if (typeId === "minecraft:player") {
      snapshot.players.push({
        name: safeName(other, "a player"),
        distance: Math.round(d),
        direction: dir,
        id: other.id,
      });
      continue;
    }
    if (typeId === "ai:citizen") {
      snapshot.citizens.push({
        name: safeName(other, "a citizen"),
        distance: Math.round(d),
        direction: dir,
        id: other.id,
      });
      continue;
    }
    const hostile = HOSTILE_HINT.test(typeId) || hasFamily(other, "monster");
    if (hostile) {
      snapshot.threats.push({
        kind: prettyId(typeId),
        distance: Math.round(d),
        direction: dir,
        id: other.id,
      });
    } else if (PASSIVE_HINT.test(typeId)) {
      snapshot.animals.push({ kind: prettyId(typeId), distance: Math.round(d), direction: dir, id: other.id });
    }
  }

  snapshot.players.sort((a, b) => a.distance - b.distance);
  snapshot.citizens.sort((a, b) => a.distance - b.distance);
  snapshot.threats.sort((a, b) => a.distance - b.distance);
  snapshot.animals.sort((a, b) => a.distance - b.distance);
  snapshot.players = snapshot.players.slice(0, 5);
  snapshot.citizens = snapshot.citizens.slice(0, 6);
  snapshot.threats = snapshot.threats.slice(0, 6);
  snapshot.animals = snapshot.animals.slice(0, 4);
}

function safeName(entity, fallback) {
  try {
    const raw = entity.nameTag;
    if (raw) return String(raw).split("\n")[0].replace(/§./g, "").trim() || fallback;
    return entity.typeId === "minecraft:player" ? entity.name : fallback;
  } catch {
    return fallback;
  }
}

function hasFamily(entity, family) {
  try {
    const comp = entity.getComponent("minecraft:type_family");
    return comp ? comp.hasTypeFamily(family) : false;
  } catch {
    return false;
  }
}

function scanBlocks(citizen, snapshot, origin, dim) {
  const bx = Math.floor(origin.x), by = Math.floor(origin.y), bz = Math.floor(origin.z);

  // --- immediate footing -------------------------------------------------
  snapshot.ground = safeType(dim, { x: bx, y: by - 1, z: bz }) || "air";
  snapshot.standingIn = safeType(dim, { x: bx, y: by, z: bz }) || "air";

  // --- coarse survey -----------------------------------------------------
  const R = CONFIG.blockScanRadius;
  const found = new Map();      // typeId -> {count, nearest: {pos, distance}}
  const hazards = new Map();

  for (let dy = -6; dy <= 4; dy += 2) {
    for (let dx = -R; dx <= R; dx += 2) {
      for (let dz = -R; dz <= R; dz += 2) {
        const pos = { x: bx + dx, y: by + dy, z: bz + dz };
        const type = safeType(dim, pos);
        if (!type || type === "minecraft:air" || type === "minecraft:cave_air") continue;

        if (isDangerous(type)) {
          const prev = hazards.get(type);
          const d = dist(origin, pos);
          if (!prev || d < prev.distance) hazards.set(type, { pos, distance: d });
          continue;
        }

        const score = noteworthiness(type);
        if (score <= 0) continue;
        const d = dist(origin, pos);
        const prev = found.get(type);
        if (!prev) {
          found.set(type, { count: 1, nearest: pos, distance: d, score });
        } else {
          prev.count += 1;
          if (d < prev.distance) { prev.nearest = pos; prev.distance = d; }
        }
      }
    }
  }

  snapshot.blocks = topN([...found.entries()], 8, ([, v]) => v.score + 2 / (1 + v.distance))
    .map(([type, v]) => ({
      type,
      label: describeBlock(type),
      count: v.count,
      distance: Math.round(v.distance),
      direction: compass(origin, v.nearest),
      at: { x: v.nearest.x, y: v.nearest.y, z: v.nearest.z },
      ore: isOre(type),
      wood: isLog(type),
      value: ORES[type] ? ORES[type].value : 0,
    }));

  snapshot.hazards = [...hazards.entries()]
    .sort((a, b) => a[1].distance - b[1].distance)
    .slice(0, 3)
    .map(([type, v]) => ({
      type, label: prettyId(type),
      distance: Math.round(v.distance),
      direction: compass(origin, v.pos),
      at: v.pos,
    }));
}

function safeType(dim, pos) {
  try {
    const b = dim.getBlock(pos);
    return b ? b.typeId : undefined;
  } catch {
    return undefined;     // unloaded chunk - simply unknown
  }
}

/** Prose the brain (and the local dialogue writer) can quote directly. */
export function describeSnapshot(snap) {
  const lines = [];
  lines.push(`It is ${snap.time} on day ${snap.day}${snap.weather !== "clear" ? `, ${snap.weather}` : ""}.`);
  lines.push(`Standing at ${snap.position.x}, ${snap.position.y}, ${snap.position.z} in the ${snap.dimension} on ${prettyId(snap.ground)}.`);
  if (snap.health) lines.push(`Health ${snap.health.current}/${snap.health.max}.`);
  if (snap.threats.length) {
    lines.push("Threats: " + snap.threats
      .map((t) => `${t.kind} ${t.distance}m ${t.direction}`).join(", ") + ".");
  }
  if (snap.players.length) {
    lines.push("Players nearby: " + snap.players
      .map((p) => `${p.name} (${p.distance}m ${p.direction})`).join(", ") + ".");
  }
  if (snap.citizens.length) {
    lines.push("Other citizens: " + snap.citizens
      .map((c) => `${c.name} (${c.distance}m)`).join(", ") + ".");
  }
  if (snap.blocks.length) {
    lines.push("In sight: " + snap.blocks
      .map((b) => `${b.count}x ${b.label} ${b.distance}m ${b.direction}`).join(", ") + ".");
  }
  if (snap.hazards.length) {
    lines.push("Hazards: " + snap.hazards
      .map((h) => `${h.label} ${h.distance}m ${h.direction}`).join(", ") + ".");
  }
  if (snap.animals.length) {
    lines.push("Animals: " + snap.animals.map((a) => a.kind).join(", ") + ".");
  }
  return lines.join("\n");
}

/** The single most remark-worthy thing in view, or null. */
export function highlight(snap) {
  if (snap.threats.length && snap.threats[0].distance < 14) {
    return { kind: "threat", subject: snap.threats[0] };
  }
  const ore = snap.blocks.find((b) => b.ore && b.value >= 6);
  if (ore) return { kind: "ore", subject: ore };
  const hazard = snap.hazards.find((h) => h.distance < 8);
  if (hazard) return { kind: "hazard", subject: hazard };
  if (snap.weather === "thunderstorm") return { kind: "weather", subject: { label: "the storm" } };
  const ore2 = snap.blocks.find((b) => b.ore);
  if (ore2) return { kind: "ore", subject: ore2 };
  if (snap.animals.length) return { kind: "animal", subject: snap.animals[0] };
  return null;
}
