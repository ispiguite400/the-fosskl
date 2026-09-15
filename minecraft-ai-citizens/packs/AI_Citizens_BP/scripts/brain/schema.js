/**
 * The shared decision language.
 *
 * Both brains - the local utility planner and Claude - emit the same shape:
 *
 *   { say, to, mood, goal, actions: [ { do, ...args } ], remember: [] }
 *
 * `decodeDecision` validates that and turns it into real tasks. Nothing from a
 * remote model reaches the world without passing through here, so a malformed
 * or hostile reply can at worst produce a no-op.
 */
import { CONFIG } from "../core/config.js";
import { debug } from "../core/log.js";
import { clamp, prettyId } from "../core/util.js";
import { ORES, LOGS, isOre, CROPS } from "../core/blocks.js";
import { findRecipe } from "../core/recipes.js";
import { blueprintById, BLUEPRINTS } from "../civ/blueprints.js";
import { cellsFromBlueprint } from "../actions/build.js";
import {
  gotoTask, followTask, speakTask, waitTask, exploreTask, patrolTask,
  storeTask, fetchTask, giveTask, chopTask, mineOreTask, gatherTask,
  buildTask, craftTask, farmTask, fightTask, fleeTask, eatTask,
  sleepTask, restTask, lightTask, mineTask, placeTask,
} from "../actions/registry.js";
import { nearestStockpile } from "../civ/settlement.js";
import { jobList } from "../civ/jobs.js";

/** The action vocabulary, also used to build the prompt's tool description. */
export const ACTIONS = {
  goto:    { args: "x, y, z", help: "walk to a position" },
  follow:  { args: "who, seconds?", help: "follow a player or citizen by name" },
  mine:    { args: "block, count?", help: "find and mine blocks of a type nearby" },
  mine_at: { args: "x, y, z", help: "mine one specific block" },
  chop:    { args: "count?", help: "fell nearby trees" },
  dig:     { args: "block, count?", help: "gather a common block (dirt, sand, stone)" },
  place:   { args: "block, x, y, z", help: "place one block from the pack" },
  build:   { args: "structure", help: "build a known structure at a chosen site" },
  craft:   { args: "item, count?", help: "craft or smelt an item" },
  farm:    { args: "-", help: "till, sow and harvest nearby fields" },
  attack:  { args: "who", help: "fight a nearby creature or named target" },
  flee:    { args: "-", help: "run from danger" },
  guard:   { args: "-", help: "patrol the settlement and watch for threats" },
  eat:     { args: "-", help: "eat food from the pack" },
  sleep:   { args: "-", help: "sleep until morning" },
  rest:    { args: "seconds?", help: "sit down and recover" },
  store:   { args: "item?", help: "put goods in the town stores" },
  fetch:   { args: "item, count?", help: "take goods from the town stores" },
  give:    { args: "who, item, count?", help: "hand an item to someone" },
  explore: { args: "radius?", help: "wander and map the surroundings" },
  light:   { args: "-", help: "place torches where it is dark" },
  wait:    { args: "seconds?", help: "stand still" },
  job:     { args: "role", help: `take up a role: ${jobList().join(", ")}` },
  found:   { args: "-", help: "found a new settlement here" },
  point:   { args: "x, y, z", help: "point somewhere while speaking" },
};

export function actionHelpText() {
  return Object.entries(ACTIONS)
    .map(([name, d]) => `- ${name}(${d.args}): ${d.help}`)
    .join("\n");
}

export function structureNames() {
  return Object.values(BLUEPRINTS).map((b) => `${b.id} (${b.name})`).join(", ");
}

/**
 * @returns {{say:string|null,to:string|null,mood:string,goal:string,tasks:object[],remember:string[]}}
 */
export function decodeDecision(raw, citizen, ctx) {
  const out = { say: null, to: null, mood: "steady", goal: "", tasks: [], remember: [] };
  if (!raw || typeof raw !== "object") return out;

  if (typeof raw.say === "string" && raw.say.trim()) {
    out.say = raw.say.trim().slice(0, 220);
  }
  if (typeof raw.to === "string" && raw.to.trim()) out.to = raw.to.trim().slice(0, 32);
  if (typeof raw.mood === "string") out.mood = raw.mood.slice(0, 20);
  if (typeof raw.goal === "string") out.goal = raw.goal.trim().slice(0, 60);

  if (Array.isArray(raw.remember)) {
    out.remember = raw.remember
      .filter((f) => typeof f === "string" && f.trim())
      .slice(0, 3)
      .map((f) => f.trim().slice(0, 120));
  }

  const list = Array.isArray(raw.actions) ? raw.actions.slice(0, 6) : [];
  for (const entry of list) {
    const task = decodeAction(entry, citizen, ctx);
    if (task) out.tasks.push(task);
  }
  return out;
}

function decodeAction(entry, citizen, ctx) {
  if (!entry || typeof entry !== "object") return null;
  const verb = String(entry.do || entry.action || "").toLowerCase().trim();
  if (!verb || !ACTIONS[verb]) {
    debug(`ignored unknown action "${verb}"`);
    return null;
  }

  switch (verb) {
    case "goto": {
      const pos = readPos(entry, citizen);
      return pos ? gotoTask(pos, { label: entry.why || "walking over" }) : null;
    }
    case "follow": {
      const target = resolveName(entry.who, citizen, ctx);
      if (!target) return null;
      return followTask(target.id, {
        ticks: entry.seconds ? clamp(Number(entry.seconds), 1, 600) * 20 : 0,
        label: `following ${target.name}`,
      });
    }
    case "mine": {
      const id = normaliseBlock(entry.block);
      const count = clamp(Number(entry.count) || 8, 1, 64);
      if (!id) return mineOreTask(count);
      if (id === "any_ore") return mineOreTask(count);
      return gatherTask((t) => t === id, 24, count, `mining ${prettyId(id)}`);
    }
    case "mine_at": {
      const pos = readPos(entry, citizen);
      return pos ? mineTask(pos, { vein: false, limit: 1 }) : null;
    }
    case "chop":
      return chopTask(clamp(Number(entry.count) || 12, 1, 64));
    case "dig": {
      const id = normaliseBlock(entry.block) || "minecraft:dirt";
      const count = clamp(Number(entry.count) || 12, 1, 64);
      return gatherTask((t) => t === id, 20, count, `digging ${prettyId(id)}`);
    }
    case "place": {
      const pos = readPos(entry, citizen);
      const id = normaliseBlock(entry.block);
      if (!pos || !id) return null;
      return placeTask(pos, id);
    }
    case "build": {
      const bp = blueprintById(String(entry.structure || "").toLowerCase());
      if (!bp) return null;
      const site = ctx.chooseBuildSite ? ctx.chooseBuildSite(citizen, bp) : null;
      if (!site) return null;
      const cells = cellsFromBlueprint(bp, site.origin, site.rotation || 0);
      const task = buildTask(cells, { label: `building a ${bp.name}` });
      task.structureRef = site.structureId || null;
      return task;
    }
    case "craft": {
      const id = normaliseItem(entry.item);
      if (!id || !findRecipe(id)) return null;
      return craftTask(id, clamp(Number(entry.count) || 1, 1, 32));
    }
    case "farm":
      return farmTask(citizen.location, 12);
    case "attack": {
      const target = resolveTarget(entry.who, citizen, ctx);
      return target ? fightTask(target.id, { label: `fighting ${target.name}` }) : null;
    }
    case "flee": {
      const threat = citizen.snapshot?.threats?.[0];
      const from = threat && threat.at ? threat.at : citizen.location;
      return fleeTask(from);
    }
    case "guard": {
      const center = ctx.settlement ? ctx.settlement.origin : citizen.location;
      return patrolTask(center, 18, 3);
    }
    case "eat":
      return eatTask();
    case "sleep":
      return sleepTask(ctx.findBed ? ctx.findBed(citizen) : null);
    case "rest":
      return restTask(clamp(Number(entry.seconds) || 8, 1, 120));
    case "store": {
      if (!ctx.settlement) return null;
      const chest = nearestStockpile(ctx.settlement, citizen.location);
      return chest ? storeTask(chest, normaliseItem(entry.item)) : null;
    }
    case "fetch": {
      if (!ctx.settlement) return null;
      const chest = nearestStockpile(ctx.settlement, citizen.location);
      const id = normaliseItem(entry.item);
      return chest && id ? fetchTask(chest, id, clamp(Number(entry.count) || 8, 1, 64)) : null;
    }
    case "give": {
      const target = resolveName(entry.who, citizen, ctx);
      const id = normaliseItem(entry.item);
      if (!target || !id) return null;
      return giveTask(target.id, id, clamp(Number(entry.count) || 1, 1, 64));
    }
    case "explore":
      return exploreTask(clamp(Number(entry.radius) || 48, 8, 160), { legs: 3 });
    case "light": {
      const center = ctx.settlement ? ctx.settlement.origin : citizen.location;
      return lightTask(center, 16);
    }
    case "wait":
      return waitTask(clamp(Number(entry.seconds) || 4, 1, 60));
    case "job": {
      const role = String(entry.role || "").toLowerCase();
      if (!jobList().includes(role)) return null;
      return { kind: "wait", until: 0, seconds: 1, label: `becoming a ${role}`, setJob: role };
    }
    case "found":
      return { kind: "wait", until: 0, seconds: 1, label: "founding a settlement", foundHere: true };
    case "point": {
      const pos = readPos(entry, citizen);
      return pos ? { kind: "wait", until: 0, seconds: 2, label: "pointing", pointAt: pos } : null;
    }
    default:
      return null;
  }
}

// --------------------------------------------------------------------------
// Coercion helpers - everything here assumes the input is untrusted.
// --------------------------------------------------------------------------
function readPos(entry, citizen) {
  const x = Number(entry.x), y = Number(entry.y), z = Number(entry.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const here = citizen.location;
  const yy = Number.isFinite(y) ? y : here.y;
  // Refuse anything absurdly far away: a typo should not send a citizen on a
  // thousand-block march.
  if (Math.abs(x - here.x) > 512 || Math.abs(z - here.z) > 512 || Math.abs(yy - here.y) > 256) {
    return null;
  }
  return { x, y: yy, z: zClamp(z) };
}

function zClamp(z) { return z; }

export function normaliseBlock(name) {
  if (!name || typeof name !== "string") return null;
  let id = name.trim().toLowerCase().replace(/\s+/g, "_");
  if (id === "ore" || id === "any_ore" || id === "ores") return "any_ore";
  if (id === "wood" || id === "log" || id === "tree") return "minecraft:oak_log";
  if (id === "stone") return "minecraft:stone";
  if (!id.includes(":")) id = "minecraft:" + id;
  if (!/^minecraft:[a-z0-9_]+$/.test(id)) return null;
  return id;
}

export function normaliseItem(name) {
  return normaliseBlock(name);
}

function resolveName(who, citizen, ctx) {
  if (!who || typeof who !== "string") return null;
  const want = who.trim().toLowerCase();
  if (!want) return null;

  for (const p of ctx.players || []) {
    if (p.name.toLowerCase() === want || p.name.toLowerCase().startsWith(want)) {
      return { id: p.id, name: p.name };
    }
  }
  const other = ctx.registry ? ctx.registry.byName(want) : null;
  if (other && other.valid) return { id: other.id, name: other.name };

  // Fall back to whatever is visible with that name.
  const seen = citizen.snapshot;
  if (seen) {
    const hit = [...seen.players, ...seen.citizens]
      .find((e) => e.name.toLowerCase().startsWith(want));
    if (hit) return { id: hit.id, name: hit.name };
  }
  return null;
}

function resolveTarget(who, citizen, ctx) {
  const named = resolveName(who, citizen, ctx);
  if (named) return named;
  const want = String(who || "").toLowerCase();
  const threats = citizen.snapshot?.threats || [];
  const match = threats.find((t) => !want || t.kind.includes(want));
  return match ? { id: match.id, name: match.kind } : (threats[0] ? { id: threats[0].id, name: threats[0].kind } : null);
}

/** Strips anything in a model reply that would be unsafe to show or act on. */
export function sanitiseSpeech(text) {
  return String(text || "")
    .replace(/§./g, "")             // no colour-code injection
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 220);
}
