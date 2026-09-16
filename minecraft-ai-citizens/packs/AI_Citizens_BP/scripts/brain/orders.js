/**
 * Turning a reading into work.
 *
 * `brain/nlu.js` says what the player meant. This says what the citizen should
 * actually do about it, and it is the list of everything they can be told:
 * every intent below maps onto real tasks the action layer already knows how to
 * step, so nothing here is a promise the body cannot keep.
 *
 * A plan is `{label, tasks[], reply, effect}`:
 *   tasks   queued onto citizen.plan, in order - "mine 20 iron then build a
 *           house" is two tasks, not a confused one
 *   reply   something to say instead of, or as well as, acting
 *   effect  work only the command layer can do (change job, found a town,
 *           learn a word), described rather than performed
 */
import { CONFIG } from "../core/config.js";
import { clamp, prettyId, dist } from "../core/util.js";
import { LOGS, ORES, isOre, isLog } from "../core/blocks.js";
import { summariseInventory, equipTool, dropItem } from "../actions/inventory.js";
import { nearestStockpile } from "../civ/settlement.js";
import { findBedNear } from "../actions/interact.js";
import {
  gotoTask, followTask, waitTask, exploreTask, patrolTask, storeTask,
  fetchTask, giveTask, chopTask, mineOreTask, speakTask,
} from "../actions/registry.js";
import { mineTask, gatherTask } from "../actions/mine.js";
import { placeTask, buildTask } from "../actions/build.js";
import { craftTask } from "../actions/craft.js";
import { cellsFromBlueprint, findBuildSite } from "../actions/build.js";
import { blueprintById } from "../civ/blueprints.js";
import { farmTask } from "../actions/farm.js";
import { fightTask, fleeTask } from "../actions/combat.js";
import { eatTask, sleepTask, restTask, lightTask } from "../actions/interact.js";
import {
  C, RESOURCE_BLOCKS, STRUCTURE_IDS, ITEM_IDS, CREATURE_IDS,
  DIRECTION_VECTORS, isHostile,
} from "./nlu.js";

/** Blocks worth clearing when someone says "clear this area". */
const CLUTTER = (t) =>
  LOGS.has(t) || /leaves|grass|fern|flower|bush|vine|sapling|snow_layer|mushroom|sugar_cane|cactus|dead_bush|seagrass|kelp/.test(t);

const plan = (label, tasks, extra = {}) => ({
  label, tasks: [].concat(tasks).filter(Boolean), reply: null, effect: null, ...extra,
});
const reply = (text, extra = {}) => ({ label: null, tasks: [], reply: text, effect: null, ...extra });

/**
 * @param {Citizen} citizen
 * @param {object} r  a reading from understand()
 * @param {object} ctx
 * @returns {null|{label,tasks,reply,effect}}
 */
export function planOrder(citizen, r, ctx) {
  if (!r || !r.intent) return null;
  const T = ctx.tasks || {};
  const qty = (fallback) => clamp(r.quantity ?? fallback, 1, 64);
  const span = (fallback) => clamp(r.distance ?? fallback, 2, 64);
  const here = citizen.location;

  switch (r.intent) {
    // --- stopping and staying -------------------------------------------
    case "stop":
      return plan("standing by", waitTask(20, "standing by"));
    case "stay":
      return plan("holding position", waitTask(span(60), "holding position"));
    case "quiet":
      return { label: "keeping quiet", tasks: [], reply: null, effect: { kind: "quiet", on: !r.negated } };

    // --- gathering --------------------------------------------------------
    case "chop":
      return plan("cutting wood", T.chopTask ? T.chopTask(qty(16)) : chopTask(qty(16)));

    case "mine": {
      const blocks = RESOURCE_BLOCKS[r.resource];
      if (blocks) {
        const pretty = String(r.resource).toLowerCase();
        return plan(`mining ${pretty}`,
          gatherTask((b) => blocks.includes(b), 24, qty(8), `mining ${pretty}`));
      }
      return plan("mining", mineOreTask(qty(12)));
    }

    case "dig_down": {
      // One mine task at a target below: the miner tunnels down to reach it,
      // clearing a walkable shaft on the way.
      const depth = span(12);
      const floorY = Math.max(-58, Math.floor(here.y) - depth);
      return plan(`digging down ${Math.floor(here.y) - floorY} blocks`,
        mineTask({ x: here.x, y: floorY, z: here.z }, { vein: false, label: "sinking a shaft" }));
    }

    case "tunnel": {
      const v = DIRECTION_VECTORS[r.direction] || facingVector(citizen);
      const length = span(24);
      const end = {
        x: Math.floor(here.x + v.x * length),
        y: Math.floor(here.y),
        z: Math.floor(here.z + v.z * length),
      };
      return plan(`tunnelling ${r.direction || "ahead"} ${length} blocks`,
        mineTask(end, { vein: false, label: "tunnelling" }));
    }

    case "clear":
      return plan("clearing the ground",
        gatherTask(CLUTTER, span(12), qty(24), "clearing the ground"));

    case "bridge": {
      const v = DIRECTION_VECTORS[r.direction] || facingVector(citizen);
      const length = span(12);
      const cells = [];
      for (let i = 1; i <= length; i++) {
        cells.push({
          x: Math.floor(here.x + v.x * i),
          y: Math.floor(here.y) - 1,
          z: Math.floor(here.z + v.z * i),
          block: ITEM_IDS[r.resource] || "minecraft:cobblestone",
        });
      }
      return plan(`bridging ${length} blocks`, buildTask(cells, { label: "building a bridge" }));
    }

    // --- building ---------------------------------------------------------
    case "build": {
      const blueprintId = STRUCTURE_IDS[r.structure] || null;
      // Told to build, but not what. Asking beats guessing.
      if (!blueprintId) return { label: "building", tasks: [], reply: null, effect: null, wantsBuild: null };

      const bp = blueprintById(blueprintId);
      const site = bp ? buildSite(citizen, ctx, bp) : null;
      if (!bp || !site) {
        return reply("No room for that here. Find me flatter ground.");
      }
      return plan(`building a ${bp.name}`,
        buildTask(cellsFromBlueprint(bp, site.origin, site.rotation || 0),
          { label: `building a ${bp.name}`, projectId: site.structureId || null }),
        { wantsBuild: blueprintId });
    }

    case "place": {
      const id = ITEM_IDS[r.item] || ITEM_IDS[r.resource];
      if (!id) return null;
      const count = qty(1);
      const cells = [];
      for (let i = 0; i < Math.min(count, 12); i++) {
        cells.push({ x: Math.floor(here.x) + i, y: Math.floor(here.y), z: Math.floor(here.z), block: id });
      }
      return plan(`placing ${prettyId(id)}`,
        count > 1 ? buildTask(cells, { label: `placing ${prettyId(id)}` })
                  : placeTask(here, id));
    }

    case "light":
      return plan("lighting the place up", lightTask(here, span(12)));

    // --- farming ----------------------------------------------------------
    case "farm":
      return plan("working the fields", farmTask(here, span(12)));

    // --- movement ---------------------------------------------------------
    case "follow":
      return plan("following you", followTask(ctx.speakerId, { ticks: 0 }));

    case "come":
      return plan("coming over",
        gotoTask(ctx.speakerLocation || here, { arrive: 2.5, label: "coming over" }));

    case "goto": {
      if (!r.coords) return null;
      const target = { x: r.coords.x, y: r.coords.y ?? here.y, z: r.coords.z };
      return plan(`walking to ${Math.round(target.x)}, ${Math.round(target.z)}`,
        gotoTask(target, { sprint: true }));
    }

    case "go_direction": {
      const v = DIRECTION_VECTORS[r.direction];
      if (!v) return null;
      const length = span(20);
      const target = { x: here.x + v.x * length, y: here.y, z: here.z + v.z * length };
      return plan(`heading ${r.direction} ${length} blocks`,
        gotoTask(target, { sprint: true, label: `heading ${r.direction}` }));
    }

    case "go_home": {
      const home = ctx.settlement ? ctx.settlement.origin : null;
      if (!home) return reply("I've no home to go back to yet. Found a town and I will have.");
      return plan("heading home", gotoTask(home, { arrive: 4, label: "heading home" }));
    }

    case "spread":
      return plan("spreading out", exploreTask(span(24), { legs: 1 }));

    case "regroup": {
      const rally = ctx.settlement ? ctx.settlement.origin : (ctx.speakerLocation || here);
      return plan("regrouping", gotoTask(rally, { arrive: 3, label: "regrouping" }));
    }

    // --- combat -----------------------------------------------------------
    case "attack": {
      const target = findCreature(citizen, r.creature, true);
      if (!target) {
        return plan("looking for trouble", exploreTask(24, { legs: 1 }),
          { reply: r.creature ? `No ${label(r.creature)} in sight. I'll go and look.` : null });
      }
      return plan(`fighting ${target.label}`, fightTask(target.id));
    }

    case "hunt": {
      const target = findCreature(citizen, r.creature || C.ANIMAL, false);
      if (!target) return plan("hunting", exploreTask(32, { legs: 2 }), { reply: "Nothing to hunt here. I'll range out." });
      return plan(`hunting ${target.label}`, fightTask(target.id));
    }

    case "defend":
      return plan("guarding you", followTask(ctx.speakerId, { ticks: 0, distance: 2.5, label: "guarding you" }));

    case "guard": {
      const centre = ctx.settlement ? ctx.settlement.origin : here;
      return plan("on guard", patrolTask(centre, span(18), 4));
    }

    case "flee":
      return plan("falling back", fleeTask(citizen.snapshot?.threats?.[0]
        ? here : (ctx.speakerLocation || here)));

    // --- items ------------------------------------------------------------
    case "craft": {
      const id = ITEM_IDS[r.item] || ITEM_IDS[r.resource];
      if (!id) return reply("Craft what? A pickaxe, a torch, a chest?");
      return plan(`crafting ${prettyId(id)}`, craftTask(id, qty(1)));
    }

    case "smelt": {
      const source = r.resource === C.IRON ? "minecraft:iron_ingot"
        : r.resource === C.GOLD ? "minecraft:gold_ingot"
        : r.resource === C.COPPER ? "minecraft:copper_ingot"
        : r.item === C.FOOD || r.resource === C.FOOD ? "minecraft:cooked_beef"
        : null;
      if (!source) return reply("Smelt what? Iron, gold, or something to eat?");
      return plan(`smelting ${prettyId(source)}`, craftTask(source, qty(1)));
    }

    case "give": {
      const id = ITEM_IDS[r.item] || ITEM_IDS[r.resource];
      if (!id) return reply(`I'm carrying ${summariseInventory(citizen, 4) || "nothing worth having"}. Name one.`);
      if (!ctx.speakerId) return null;
      return plan(`handing over ${prettyId(id)}`, giveTask(ctx.speakerId, id, qty(1)));
    }

    case "drop": {
      const id = ITEM_IDS[r.item] || ITEM_IDS[r.resource];
      return { label: "dropping it", tasks: [], reply: null,
        effect: { kind: "drop", itemId: id, count: r.quantity ?? null } };
    }

    case "take":
      return plan("picking things up", waitTask(4, "picking things up"));

    case "store": {
      const chest = ctx.settlement ? nearestStockpile(ctx.settlement, here) : null;
      if (!chest) return reply("Nowhere to put it. We need a storehouse first.");
      return plan("storing goods", storeTask(chest, null));
    }

    case "fetch": {
      const chest = ctx.settlement ? nearestStockpile(ctx.settlement, here) : null;
      const id = ITEM_IDS[r.item] || ITEM_IDS[r.resource];
      if (!chest || !id) return reply("Fetch what, and from where? We've no store yet.");
      return plan(`fetching ${prettyId(id)}`, fetchTask(chest, id, qty(8)));
    }

    case "equip": {
      const kind = r.item === C.SWORD ? "sword" : r.item === C.AXE ? "axe"
        : r.item === C.SHOVEL ? "shovel" : r.item === C.HOE ? "hoe" : "pickaxe";
      return { label: `drawing a ${kind}`, tasks: [], reply: null,
        effect: { kind: "equip", tool: kind } };
    }

    case "inventory":
      return reply(inventoryLine(citizen));

    // --- life -------------------------------------------------------------
    case "rest":
      return plan("resting", restTask(span(20)));

    case "sleep": {
      const bed = findBedNear(citizen.dimension, here, 24);
      if (!bed) return plan("lying down", restTask(40), { reply: "No bed near. I'll sit a while instead." });
      return plan("going to sleep", sleepTask(bed));
    }

    case "wake":
      return plan("up and about", waitTask(2, "up and about"));

    case "eat":
      return plan("finding something to eat", eatTask());

    case "explore":
      return plan("scouting", exploreTask(span(80), { legs: 4 }));

    // --- speech and identity ----------------------------------------------
    case "say": {
      const words = afterKeyword(r.text, ["say", "tell", "shout", "announce"]);
      if (!words) return reply("Say what?");
      return plan("passing it on", speakTask(words));
    }

    case "emote":
      return { label: "larking about", tasks: [], reply: null,
        effect: { kind: "emote", which: emoteFrom(r.text) } };

    case "set_job":
      if (!r.job) return reply("Which trade? Miner, builder, farmer, guard, scout?");
      return { label: `taking up ${r.job} work`, tasks: [], reply: null,
        effect: { kind: "setJob", job: r.job } };

    case "rename": {
      const name = afterKeyword(r.text, ["call you", "name you", "rename you", "call yourself", "name", "call"]);
      if (!name) return reply("Call me what?");
      return { label: "answering to a new name", tasks: [], reply: null,
        effect: { kind: "rename", name: titleCase(name.split(/\s+/).slice(0, 3).join(" ")) } };
    }

    case "found_town":
      return { label: "founding a town", tasks: [], reply: null, effect: { kind: "foundTown" } };

    case "join_town":
      return { label: "joining the town", tasks: [], reply: null, effect: { kind: "joinTown" } };

    // --- meta -------------------------------------------------------------
    case "teach": {
      const pair = teachingPair(r.text);
      if (!pair) return reply('Say it like this: "ai! \\"dig deep\\" means mine iron".');
      return { label: "learning a word", tasks: [], reply: null,
        effect: { kind: "teach", phrase: pair.phrase, meaning: pair.meaning } };
    }

    case "forget": {
      const phrase = afterKeyword(r.text, ["forget", "unlearn"]);
      return { label: "forgetting it", tasks: [], reply: null,
        effect: { kind: "forget", phrase: phrase || null } };
    }

    case "repeat":
      return { label: "doing it again", tasks: [], reply: null, effect: { kind: "repeat" } };

    case "help":
      return { label: null, tasks: [], reply: null, effect: { kind: "help" } };

    case "status":
      return reply(statusLine(citizen, ctx));

    default:
      return null;
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Where a structure can stand. A settlement allocates a plot so buildings line
 * up; without one, any flat patch nearby will do.
 */
function buildSite(citizen, ctx, blueprint) {
  if (typeof ctx.chooseBuildSite === "function") {
    const plot = ctx.chooseBuildSite(citizen, blueprint);
    if (plot) return plot;
  }
  const site = findBuildSite(citizen.dimension, citizen.location,
    blueprint.width, blueprint.depth, 28);
  return site ? { origin: site, rotation: 0 } : null;
}

/** Which way the citizen is looking, as a flat unit vector. */
function facingVector(citizen) {
  const v = citizen.entity?.getViewDirection?.();
  if (!v) return { x: 1, z: 0 };
  const len = Math.hypot(v.x, v.z) || 1;
  return { x: v.x / len, z: v.z / len };
}

const label = (concept) => String(concept || "").toLowerCase();

/**
 * Find something to fight or hunt. The perception snapshot is checked first
 * because it is already built; a direct query is the fallback for anything the
 * snapshot does not track.
 */
function findCreature(citizen, concept, hostileWanted) {
  const snap = citizen.snapshot;
  const ids = CREATURE_IDS[concept] || null;
  const pool = hostileWanted ? (snap?.threats || []) : (snap?.animals || []);

  for (const seen of pool) {
    if (!ids) return { id: seen.id, label: seen.kind };
    if (ids.some((id) => id.endsWith(seen.kind.replace(/\s+/g, "_")))) {
      return { id: seen.id, label: seen.kind };
    }
  }
  // A named creature that is not in the snapshot: ask the world directly.
  if (ids) {
    for (const typeId of ids) {
      const found = safeEntities(citizen, typeId);
      if (found) return { id: found.id, label: prettyId(typeId) };
    }
  }
  if (!hostileWanted && pool.length) return { id: pool[0].id, label: pool[0].kind };
  return null;
}

function safeEntities(citizen, typeId) {
  try {
    const list = citizen.dimension.getEntities({
      type: typeId, location: citizen.location, maxDistance: CONFIG.sightRadius, closest: 1,
    });
    return list && list.length ? list[0] : null;
  } catch { return null; }
}

/** Everything after the first of these words, trimmed of filler. */
function afterKeyword(text, keywords) {
  const s = String(text || "").trim();
  const lower = s.toLowerCase();
  for (const k of keywords) {
    const at = lower.indexOf(k);
    if (at < 0) continue;
    const rest = s.slice(at + k.length)
      .replace(/^[\s:,\-"']+/, "")
      // "your name is Ada" leaves "is Ada" behind; drop the copula.
      .replace(/^(?:is|are|was|will be|shall be|be)\s+/i, "")
      .replace(/["']\s*$/, "")
      .trim();
    if (rest) return rest;
  }
  return null;
}

/** '"dig deep" means mine iron' -> {phrase, meaning}. */
function teachingPair(text) {
  const s = String(text || "").trim();
  const quoted = /["']([^"']{2,40})["']\s*(?:means|=|is)\s+(.{2,80})/i.exec(s);
  if (quoted) return { phrase: quoted[1].trim(), meaning: quoted[2].trim() };
  const plain = /(?:when i say\s+)?(.{2,40}?)\s+means\s+(.{2,80})/i.exec(s);
  if (plain) return { phrase: plain[1].replace(/^(learn|remember|that)\s+/i, "").trim(), meaning: plain[2].trim() };
  return null;
}

function emoteFrom(text) {
  const s = String(text || "").toLowerCase();
  for (const e of ["dance", "cheer", "wave", "point", "bow", "laugh", "celebrate", "salute"]) {
    if (s.includes(e)) return e;
  }
  return "cheer";
}

function titleCase(s) {
  return String(s).replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function inventoryLine(citizen) {
  const summary = summariseInventory(citizen, 5);
  if (!summary || /^nothing/i.test(summary)) return "Empty-handed.";
  return `Carrying ${summary}.`;
}

function statusLine(citizen, ctx) {
  const doing = citizen.task ? (citizen.task.label || citizen.task.kind) : "nothing in particular";
  const town = ctx.settlement ? ` We're at ${ctx.settlement.name}.` : "";
  return `${capitalise(doing)}.${town}`;
}

const capitalise = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/** Every intent this module can act on - used by the help text and the tests. */
export const SUPPORTED_INTENTS = [
  "stop", "stay", "quiet", "chop", "mine", "dig_down", "tunnel", "clear",
  "bridge", "build", "place", "light", "farm", "follow", "come", "goto",
  "go_direction", "go_home", "spread", "regroup", "attack", "hunt", "defend",
  "guard", "flee", "craft", "smelt", "give", "drop", "take", "store", "fetch",
  "equip", "inventory", "rest", "sleep", "wake", "eat", "explore", "say",
  "emote", "set_job", "rename", "found_town", "join_town", "teach", "forget",
  "repeat", "help", "status",
];
