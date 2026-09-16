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
import { placeMentionedIn } from "../civ/places.js";
import { findBedNear } from "../actions/interact.js";
import {
  gotoTask, followTask, waitTask, exploreTask, patrolTask, storeTask,
  fetchTask, giveTask, chopTask, mineOreTask, speakTask,
} from "../actions/registry.js";
import { mineTask, gatherTask, excavateTask } from "../actions/mine.js";
import {
  levelCells, moatCells, pitCells, stairCells, hollowCells, shaftCells,
  corridorCells, perimeterCells, fillCells, slabCells, lineCells, sealCells,
  capped,
} from "../civ/shapes.js";
import { placeTask, buildTask } from "../actions/build.js";
import { craftTask } from "../actions/craft.js";
import { cellsFromBlueprint, findBuildSite } from "../actions/build.js";
import { blueprintById } from "../civ/blueprints.js";
import { farmTask } from "../actions/farm.js";
import { fightTask, fleeTask } from "../actions/combat.js";
import { eatTask, sleepTask, restTask, lightTask } from "../actions/interact.js";
import {
  C, RESOURCE_BLOCKS, STRUCTURE_IDS, ITEM_IDS, CREATURE_IDS,
  DIRECTION_VECTORS, isHostile, normalise,
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
export function planOrder(citizen, reading, ctx) {
  if (!reading || !reading.intent) return null;

  // A place name can also be an ordinary word - somebody calls their mine "the
  // quarry", and "quarry" already means dig. When the sentence is plainly a
  // journey and names a place we know, it is a journey.
  let r = reading;
  if (r.concepts.includes(C.GOTO) && r.intent !== "goto" && placeMentionedIn(r.text)) {
    r = { ...r, intent: "goto" };
  }

  const T = ctx.tasks || {};
  const qty = (fallback) => clamp(r.quantity ?? fallback, 1, 64);
  // "dig down 10" gives no unit, so the bare number is the distance. "chop 10
  // logs" gives no unit either, which is why quantity only stands in for
  // distance where a distance is the only thing being asked for.
  const span = (fallback) => clamp(r.distance ?? fallback, 2, 64);
  const reach = (fallback) => clamp(r.distance ?? r.quantity ?? fallback, 2, 64);
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
      // Every block of the shaft, named. A single mine task would break one
      // block and report the job done.
      const depth = Math.min(reach(12), Math.floor(here.y) + 58);
      const straight = r.concepts.includes(C.DOWN) || r.concepts.includes(C.DOWNWARD);
      const cells = straight
        ? shaftCells(here, depth)
        : stairCells(here, facingVector(citizen), depth, -1);
      return plan(`digging down ${depth} blocks`,
        excavateTask(cells, { label: "sinking a shaft" }));
    }

    case "tunnel": {
      const v = DIRECTION_VECTORS[r.direction] || facingVector(citizen);
      const length = reach(24);
      return plan(`tunnelling ${r.direction || "ahead"} ${length} blocks`,
        excavateTask(corridorCells(here, v, length, 2, 1), { label: "tunnelling" }));
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
    case "follow": {
      // "follow Ada" is a different order from "follow me", and until now
      // every follow went to whoever was speaking.
      const mate = citizenNamedIn(r.text, ctx, citizen);
      if (mate) {
        return plan(`following ${mate.short}`,
          followTask(mate.id, { ticks: 0, label: `following ${mate.short}` }));
      }
      return plan("following you", followTask(ctx.speakerId, { ticks: 0 }));
    }

    case "come": {
      // "go to Ada" and "go to the quarry" are both "come", aimed elsewhere.
      const mate = citizenNamedIn(r.text, ctx, citizen);
      if (mate) {
        return plan(`going to ${mate.short}`,
          gotoTask(mate.location, { arrive: 2.5, label: `going to ${mate.short}` }));
      }
      const place = placeMentionedIn(r.text);
      if (place) {
        return plan(`heading for ${place.name}`,
          gotoTask(place, { arrive: 3, label: `heading for ${place.name}` }));
      }
      return plan("coming over",
        gotoTask(ctx.speakerLocation || here, { arrive: 2.5, label: "coming over" }));
    }

    case "goto": {
      // "go to Ada" - a person, not a coordinate.
      const mate = citizenNamedIn(r.text, ctx, citizen);
      if (mate) {
        return plan(`going to ${mate.short}`,
          gotoTask(mate.location, { arrive: 2.5, label: `going to ${mate.short}` }));
      }
      // "go to the quarry" - a name the player invented, not a coordinate.
      const place = placeMentionedIn(r.text);
      if (place) {
        return plan(`heading for ${place.name}`,
          gotoTask(place, { sprint: true, arrive: 3, label: `heading for ${place.name}` }));
      }
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

    case "defend": {
      const ward = citizenNamedIn(r.text, ctx, citizen);
      if (ward) {
        return plan(`guarding ${ward.short}`,
          followTask(ward.id, { ticks: 0, distance: 2.5, label: `guarding ${ward.short}` }));
      }
      return plan("guarding you", followTask(ctx.speakerId, { ticks: 0, distance: 2.5, label: "guarding you" }));
    }

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
      // "give Ada a pickaxe" hands it to Ada, not to the person asking.
      const mate = citizenNamedIn(r.text, ctx, citizen);
      const to = mate ? mate.id : ctx.speakerId;
      if (!to) return null;
      return plan(`handing ${prettyId(id)} to ${mate ? mate.short : "you"}`,
        giveTask(to, id, qty(1)));
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

    // --- contests ---------------------------------------------------------
    // A contest is run by the app, not by one citizen, so these describe it
    // and let commands/effects.js set it going.
    case "contest_melee":
      return contest({ kind: "melee" }, "squaring up");
    case "contest_duel":
      return contest({ kind: "duel" }, "squaring up");
    case "contest_tournament":
      return contest({ kind: "tournament" }, "in the tournament");

    case "contest_gather": {
      const blocks = RESOURCE_BLOCKS[r.resource] || (r.resource === C.WOOD ? null : null);
      if (r.resource === C.WOOD) {
        return contest({
          kind: "gather", resource: "wood", goal: qty(16),
          blocks: ["minecraft:oak_log", "minecraft:birch_log", "minecraft:spruce_log",
                   "minecraft:jungle_log", "minecraft:acacia_log", "minecraft:dark_oak_log"],
        }, "racing for wood");
      }
      if (!blocks) return reply("Race for what? Wood, stone, iron?");
      return contest({
        kind: "gather", resource: String(r.resource).toLowerCase(),
        goal: clamp(r.quantity ?? fairGoal(r.resource), 1, 64),
        blocks: dropsFor(r.resource, blocks),
      }, `racing for ${String(r.resource).toLowerCase()}`);
    }

    case "contest_find": {
      const blocks = RESOURCE_BLOCKS[r.resource];
      if (!blocks) return reply("Find what? Diamonds? Iron?");
      return contest({
        kind: "find", resource: String(r.resource).toLowerCase(), goal: 1,
        blocks: dropsFor(r.resource, blocks),
      }, `hunting for ${String(r.resource).toLowerCase()}`);
    }

    case "contest_race": {
      const target = r.coords
        ? { x: r.coords.x, y: r.coords.y ?? here.y, z: r.coords.z }
        : aheadOf(citizen, ctx, span(40));
      return contest({ kind: "race", target }, "racing");
    }

    case "contest_dig": {
      // Digging is slow work, so an unstated depth stays modest - a race that
      // cannot be finished inside the deadline is decided on points, which is
      // a duller thing to watch.
      const depth = r.coords && r.coords.y !== null
        ? r.coords.y
        : Math.max(-58, Math.floor(here.y) - reach(8));
      return contest({ kind: "dig", depth, deadlineTicks: 20 * 60 * 10 },
        "digging for the win");
    }

    case "contest_hunt":
      return contest({ kind: "hunt", goal: qty(3) }, "hunting");

    case "contest_build":
      return contest({
        kind: "build", blueprintId: STRUCTURE_IDS[r.structure] || "small_house",
      }, "building against the clock");

    case "scoreboard":
      return { label: null, tasks: [], reply: null, effect: { kind: "scoreboard" } };

    case "contest_stop":
      return { label: null, tasks: [], reply: null, effect: { kind: "contestStop" } };

    // --- terraforming -----------------------------------------------------
    case "flatten": {
      const cells = capped(levelCells(citizen.dimension, here, span(8), 4), 300);
      if (!cells.length) return reply("It's flat enough already.");
      return plan(`levelling ${cells.length} blocks`,
        excavateTask(cells, { label: "levelling the ground" }));
    }

    case "moat": {
      const centre = ctx.settlement ? ctx.settlement.origin : here;
      const cells = capped(moatCells(citizen.dimension, centre, span(12), 3, 2), 400);
      if (!cells.length) return reply("Nothing to dig there.");
      return plan(`digging a moat, ${cells.length} blocks`,
        excavateTask(cells, { label: "digging the moat" }));
    }

    case "pit": {
      const cells = capped(pitCells(citizen.dimension, here, Math.min(span(3), 6), span(5)), 300);
      return plan("digging a pit", excavateTask(cells, { label: "digging a pit" }));
    }

    case "stairs": {
      const v = DIRECTION_VECTORS[r.direction] || facingVector(citizen);
      const up = r.concepts.includes(C.UP);
      const cells = stairCells(here, v, span(12), up ? 1 : -1);
      return plan(up ? "cutting steps up" : "cutting steps down",
        excavateTask(cells, { label: "cutting steps" }));
    }

    case "hollow": {
      const v = DIRECTION_VECTORS[r.direction] || facingVector(citizen);
      const cells = capped(hollowCells(here, v, span(8), 3, 3), 300);
      return plan("hollowing it out", excavateTask(cells, { label: "hollowing it out" }));
    }

    case "fill_hole": {
      const cells = capped(fillCells(citizen.dimension, here, Math.min(span(5), 6), 4,
        ITEM_IDS[r.resource] || "minecraft:dirt"), 250);
      if (!cells.length) return reply("Nothing to fill here.");
      return plan(`filling ${cells.length} blocks`,
        buildTask(cells, { label: "filling it in" }));
    }

    case "seal": {
      const v = DIRECTION_VECTORS[r.direction] || facingVector(citizen);
      const cells = capped(sealCells(citizen.dimension, here, v, 6, 2,
        ITEM_IDS[r.resource] || "minecraft:cobblestone"), 200);
      if (!cells.length) return reply("Nothing open to block up.");
      return plan("blocking it up", buildTask(cells, { label: "blocking it up" }));
    }

    case "perimeter": {
      const centre = ctx.settlement ? ctx.settlement.origin : here;
      const cells = capped(perimeterCells(citizen.dimension, centre, span(14), 3,
        ITEM_IDS[r.resource] || "minecraft:cobblestone"), 400);
      return plan(`walling the place in, ${cells.length} blocks`,
        buildTask(cells, { label: "raising the wall" }));
    }

    case "fence": {
      const centre = ctx.settlement ? ctx.settlement.origin : here;
      const cells = capped(perimeterCells(citizen.dimension, centre, span(10), 1,
        "minecraft:oak_fence"), 250);
      return plan("fencing it in", buildTask(cells, { label: "putting up a fence" }));
    }

    case "roof": {
      const cells = slabCells(here, Math.min(span(4), 6),
        ITEM_IDS[r.resource] || "minecraft:oak_planks", 4);
      return plan("putting a roof on", buildTask(cells, { label: "roofing it" }));
    }

    case "dock": {
      const v = DIRECTION_VECTORS[r.direction] || facingVector(citizen);
      const cells = lineCells(here, v, span(10), "minecraft:oak_planks", 0, 3);
      return plan("building a dock", buildTask(cells, { label: "building a dock" }));
    }

    // --- logistics --------------------------------------------------------
    case "sort_chests": {
      const chest = ctx.settlement ? nearestStockpile(ctx.settlement, here) : null;
      if (!chest) return reply("No chests to sort. We need a storehouse.");
      return plan("sorting the stores", storeTask(chest, null));
    }

    case "count_stock":
      return { label: null, tasks: [], reply: null,
        effect: { kind: "countStock", resource: r.resource || null } };

    case "share_out":
      return { label: null, tasks: [], reply: null,
        effect: { kind: "shareOut", itemId: ITEM_IDS[r.item] || ITEM_IDS[r.resource] || null } };

    case "arm_everyone":
      return { label: null, tasks: [], reply: null, effect: { kind: "armEveryone" } };

    case "collect_drops":
      return plan("picking up the drops", exploreTask(12, { legs: 1 }));

    case "swap_jobs":
      return { label: null, tasks: [], reply: null, effect: { kind: "swapJobs" } };

    // --- manner and voice -------------------------------------------------
    case "set_voice": {
      const voice = r.concepts.includes(C.PIRATE) ? "pirate"
        : r.concepts.includes(C.FUNNY) ? "wry"
        : r.concepts.includes(C.SERIOUS) ? "gruff"
        : r.concepts.includes(C.POLITE) ? "warm"
        : r.concepts.includes(C.LOUDER) ? "loud"
        : "plain";
      return { label: null, tasks: [], reply: null, effect: { kind: "setVoice", voice } };
    }

    case "work_faster":
      return { label: null, tasks: [], reply: null, effect: { kind: "pace", pace: "fast" } };
    case "work_careful":
      return { label: null, tasks: [], reply: null, effect: { kind: "pace", pace: "careful" } };

    // --- social -----------------------------------------------------------
    case "praise":
      return { label: null, tasks: [], reply: null, effect: { kind: "praise" } };
    case "scold":
      return { label: null, tasks: [], reply: null, effect: { kind: "scold" } };
    case "story":
      return reply(storyLine(citizen, ctx));
    case "opinion":
      return { label: null, tasks: [], reply: null,
        effect: { kind: "opinion", about: afterKeyword(r.text, ["think of", "feel about", "opinion of"]) } };
    case "introduce":
      return reply(`${citizen.name}. ${citizen.job === "settler"
        ? "I turn my hand to anything." : `I do the ${citizen.job}'s work here.`}`);

    // --- places -----------------------------------------------------------
    case "name_place": {
      // Every way of saying it - "call this place", "name this spot",
      // "remember this place" - collapses to one marker word in the normalised
      // text, so read the name from there rather than matching each phrasing.
      const name = afterKeyword(normalise(r.text), ["nameplace"])
        || afterKeyword(r.text, ["called", "call it", "name it"]);
      if (!name) return reply("Call it what?");
      return { label: null, tasks: [], reply: null,
        effect: { kind: "namePlace", name: name.replace(/^the\s+/i, "").slice(0, 24) } };
    }

    case "list_places":
      return { label: null, tasks: [], reply: null, effect: { kind: "listPlaces" } };

    // --- more work --------------------------------------------------------
    case "repair": {
      // Re-place whatever has gone missing from the wall line.
      const centre = ctx.settlement ? ctx.settlement.origin : here;
      const cells = capped(perimeterCells(citizen.dimension, centre, span(14), 3,
        ITEM_IDS[r.resource] || "minecraft:cobblestone"), 300);
      return plan("patching it up", buildTask(cells, { label: "patching it up" }));
    }

    case "demolish": {
      const cells = capped(levelCells(citizen.dimension, here, Math.min(span(6), 8), 6), 300);
      if (!cells.length) return reply("Nothing standing here to pull down.");
      return plan(`pulling down ${cells.length} blocks`,
        excavateTask(cells, { label: "pulling it down" }));
    }

    case "plant_trees": {
      const count = Math.min(qty(6), 12);
      const cells = [];
      for (let i = 0; i < count; i++) {
        // Spaced out, or they grow into each other.
        const angle = (i / count) * Math.PI * 2;
        cells.push({
          x: Math.floor(here.x + Math.cos(angle) * (4 + i)),
          y: Math.floor(here.y),
          z: Math.floor(here.z + Math.sin(angle) * (4 + i)),
          block: "minecraft:oak_sapling",
        });
      }
      return plan(`planting ${count} saplings`, buildTask(cells, { label: "planting trees" }));
    }

    case "water_crops":
      return plan("seeing to the crops", farmTask(here, span(12)));

    case "torch_line": {
      const v = DIRECTION_VECTORS[r.direction] || facingVector(citizen);
      const spacing = Math.max(3, Math.min(r.quantity ?? 8, 16));
      const length = span(32);
      const cells = [];
      for (let i = spacing; i <= length; i += spacing) {
        cells.push({
          x: Math.floor(here.x + v.x * i), y: Math.floor(here.y),
          z: Math.floor(here.z + v.z * i), block: "minecraft:torch",
        });
      }
      return plan(`lighting the way every ${spacing} blocks`,
        buildTask(cells, { label: "lighting the way" }));
    }

    case "road_to": {
      const place = placeMentionedIn(r.text);
      if (!place) return reply("A road to where? Name the place first.");
      const cells = capped(lineTo(here, place, ITEM_IDS[r.resource] || "minecraft:gravel"), 300);
      return plan(`laying a road to ${place.name}`,
        buildTask(cells, { label: `laying a road to ${place.name}` }));
    }

    case "tunnel_to": {
      const place = placeMentionedIn(r.text);
      if (!place) return reply("Dig to where? Name the place first.");
      const away = Math.hypot(place.x - here.x, place.z - here.z);
      const v = { x: (place.x - here.x) / (away || 1), z: (place.z - here.z) / (away || 1) };
      return plan(`tunnelling to ${place.name}`,
        excavateTask(capped(corridorCells(here, v, Math.min(Math.round(away), 64), 2, 1), 300),
          { label: `tunnelling to ${place.name}` }));
    }

    case "guard_place": {
      const place = placeMentionedIn(r.text);
      if (!place) return plan("on guard",
        patrolTask(ctx.settlement ? ctx.settlement.origin : here, span(18), 4));
      return plan(`guarding ${place.name}`, patrolTask(place, span(12), 6));
    }

    case "make_bed": {
      return plan("setting up a bed",
        placeTask({ x: here.x + 1, y: here.y, z: here.z }, "minecraft:red_bed"));
    }

    case "meet_at": {
      const place = placeMentionedIn(r.text);
      const target = place || (ctx.settlement ? ctx.settlement.origin : ctx.speakerLocation);
      if (!target) return reply("Meet where?");
      return plan(place ? `heading for ${place.name}` : "heading for the meeting point",
        gotoTask(target, { arrive: 3, sprint: true, label: "on my way" }));
    }

    case "wait_for": {
      const mate = citizenNamedIn(r.text, ctx, citizen);
      return plan(mate ? `waiting for ${mate.short}` : "waiting",
        waitTask(span(30), mate ? `waiting for ${mate.short}` : "waiting"));
    }

    case "escort": {
      if (!ctx.speakerId) return null;
      return plan("walking with you",
        followTask(ctx.speakerId, { ticks: 0, distance: 2.5, label: "walking with you" }));
    }

    case "sing":
      return plan("singing", speakTask(pickOne(SONGS)));

    case "celebrate":
      return { label: "celebrating", tasks: [speakTask(pickOne(CHEERS))], reply: null,
        effect: { kind: "emote", which: "cheer" } };

    case "count_off":
      return plan("counting off", speakTask(`${citizen.short}, present.`));

    case "open_door":
    case "close_door":
      return { label: null, tasks: [], reply: null,
        effect: { kind: "door", open: r.intent === "open_door" } };

    case "resume": {
      const last = citizen.memory.orders?.find((o) => o.text && o.text !== r.text);
      if (!last) return plan("back to it", waitTask(2, "back to it"));
      return { label: null, tasks: [], reply: null, effect: { kind: "repeat" } };
    }

    case "keep_back":
      return plan("keeping my distance",
        followTask(ctx.speakerId, { ticks: 0, distance: clamp(r.quantity ?? 8, 3, 24),
          label: "keeping my distance" }));

    case "describe_view":
      return reply(describeView(citizen, ctx));

    case "health_check": {
      const pct = Math.round(citizen.healthFraction * 100);
      if (pct >= 95) return reply("Not a scratch.");
      if (pct >= 60) return reply(`A few knocks. ${pct} in a hundred.`);
      if (pct >= 30) return reply(`Bleeding, if I'm honest. ${pct} in a hundred.`);
      return reply("Badly hurt. I need to sit down.");
    }

    case "time_check": {
      const night = ctx.isNight;
      return reply(night
        ? "Dark out. Nothing good happens now."
        : "Daylight yet. Plenty of work left in it.");
    }

    // --- questions about the town -----------------------------------------
    case "where_is":
      return { label: null, tasks: [], reply: null,
        effect: { kind: "whereIs", who: afterKeyword(normalise(r.text), ["whereis"]) } };

    case "who_best":
      return { label: null, tasks: [], reply: null,
        effect: { kind: "whoBest", at: r.job || (r.resource ? String(r.resource).toLowerCase() : null),
                  worst: /\bworst\b/i.test(r.text) } };

    case "town_report":
      return { label: null, tasks: [], reply: null, effect: { kind: "townReport" } };

    case "head_count":
      return { label: null, tasks: [], reply: null, effect: { kind: "headCount" } };

    // --- standing orders --------------------------------------------------
    case "standing_order":
      return { label: null, tasks: [], reply: null,
        effect: { kind: "standingOrder", trigger: triggerFrom(r), order: orderPartOf(r.text) } };

    case "until_order":
      return { label: null, tasks: [], reply: null,
        effect: { kind: "untilOrder", order: orderPartOf(r.text), goal: r.quantity || null,
                  resource: r.resource || null } };

    case "never_do":
      return { label: null, tasks: [], reply: null,
        effect: { kind: "neverDo", what: forbiddenFrom(r) } };

    default:
      return null;
  }

  function contest(spec, label) {
    return { label, tasks: [], reply: null, effect: { kind: "contest", spec } };
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

/**
 * What a mined block actually leaves in your pockets.
 *
 * A gathering contest is scored off inventory, and iron ore does not give you
 * iron ore - it gives raw iron. Scoring on the block id would leave everyone on
 * nought forever.
 */
const DROP_IDS = {
  [C.IRON]: ["minecraft:raw_iron", "minecraft:iron_ingot"],
  [C.GOLD]: ["minecraft:raw_gold", "minecraft:gold_ingot"],
  [C.COPPER]: ["minecraft:raw_copper", "minecraft:copper_ingot"],
  [C.COAL]: ["minecraft:coal"],
  [C.DIAMOND]: ["minecraft:diamond"],
  [C.EMERALD]: ["minecraft:emerald"],
  [C.LAPIS]: ["minecraft:lapis_lazuli"],
  [C.REDSTONE]: ["minecraft:redstone"],
  [C.QUARTZ]: ["minecraft:quartz"],
  [C.STONE]: ["minecraft:cobblestone", "minecraft:stone"],
  [C.DIRT]: ["minecraft:dirt"],
  [C.SAND]: ["minecraft:sand"],
  [C.GRAVEL]: ["minecraft:gravel"],
  [C.CLAY]: ["minecraft:clay_ball"],
  [C.OBSIDIAN]: ["minecraft:obsidian"],
  [C.SNOW]: ["minecraft:snowball"],
};

const dropsFor = (concept, blocks) => DROP_IDS[concept] || blocks;

/**
 * A sensible target when the player did not name one.
 *
 * "First to get diamonds" should be over in a few minutes; "first to get
 * cobblestone" should not be over in ten seconds.
 */
const GOAL_BY_RARITY = {
  [C.DIAMOND]: 1, [C.EMERALD]: 1, [C.GOLD]: 3, [C.LAPIS]: 3, [C.REDSTONE]: 6,
  [C.IRON]: 6, [C.COAL]: 10, [C.COPPER]: 8, [C.QUARTZ]: 4, [C.OBSIDIAN]: 2,
  [C.CLAY]: 8, [C.GRAVEL]: 12, [C.SAND]: 16, [C.DIRT]: 16, [C.STONE]: 20,
};
const fairGoal = (concept) => GOAL_BY_RARITY[concept] ?? 12;

/**
 * A point out in front of the player - what "that hill" and "over there"
 * actually mean when someone is pointing at something.
 */
function aheadOf(citizen, ctx, distance) {
  const from = ctx.speakerLocation || citizen.location;
  const view = ctx.speakerFacing || facingVector(citizen);
  const len = Math.hypot(view.x, view.z) || 1;
  return {
    x: from.x + (view.x / len) * distance,
    y: from.y,
    z: from.z + (view.z / len) * distance,
  };
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

/**
 * A citizen named in the sentence, if any.
 *
 * Names are not in the lexicon - they are whatever the world generated - so the
 * only way to spot "follow Ada" is to check the roster. Without this every
 * "follow" went to whoever was speaking, and half the orders in the game could
 * not be aimed at anybody else.
 */
function citizenNamedIn(text, ctx, self) {
  const registry = ctx.registry;
  if (!registry) return null;
  const haystack = ` ${String(text || "").toLowerCase()} `;
  let best = null;
  for (const other of registry.all) {
    if (other === self || !other.valid) continue;
    for (const name of [other.name, other.short]) {
      const key = String(name || "").toLowerCase();
      if (key.length < 2) continue;
      if (!haystack.includes(` ${key} `) && !haystack.includes(` ${key}.`)
          && !haystack.includes(` ${key},`) && !haystack.includes(` ${key}'`)) continue;
      // Prefer the longer match, so "Ada Fen" beats "Ada".
      if (!best || key.length > best.key.length) best = { citizen: other, key };
    }
  }
  return best ? best.citizen : null;
}

/** A straight run of blocks from here to there, on the ground. */
function lineTo(from, to, block) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const steps = Math.max(1, Math.round(Math.hypot(dx, dz)));
  const cells = [];
  for (let i = 1; i <= Math.min(steps, 280); i++) {
    cells.push({
      x: Math.floor(from.x + (dx * i) / steps),
      y: Math.floor(from.y) - 1,
      z: Math.floor(from.z + (dz * i) / steps),
      block,
    });
  }
  return cells;
}

/** What they can actually see right now, in their own words. */
function describeView(citizen, ctx) {
  const snap = citizen.snapshot;
  if (!snap) return "Nothing worth reporting.";
  const parts = [];
  if (snap.threats.length) {
    parts.push(`a ${snap.threats[0].kind} ${snap.threats[0].distance} paces ${snap.threats[0].direction}`);
  }
  const ore = snap.blocks.find((b) => b.ore);
  if (ore) parts.push(`${ore.label} ${ore.distance} paces ${ore.direction}`);
  if (snap.animals.length) parts.push(`a ${snap.animals[0].kind}`);
  if (ctx.settlement) parts.push(`${ctx.settlement.name} behind us`);
  if (!parts.length) return "Nothing but ground and sky.";
  return `${capitalise(parts[0])}${parts.length > 1 ? `, and ${parts.slice(1).join(", ")}` : ""}.`;
}

const SONGS = [
  "Oh the stone is cold and the pick is worn, and I'll not see my bed till morn...",
  "Hey-ho, the walls go up, the walls go up, the walls go up...",
  "There was a miner from over the hill, and he's digging there still, digging there still...",
  "Sing for the roof and sing for the wall, and sing for the ones who built them all.",
];
const CHEERS = [
  "To the town! Long may it stand.", "Drinks on whoever finished the roof!",
  "Well earned, all of us.", "Now this is a day worth remembering.",
];
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

/** Something that actually happened to them, told as a story. */
function storyLine(citizen, ctx) {
  const events = (citizen.memory.events || []).filter((e) => e && e.text);
  if (events.length) {
    const best = events.slice().sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
    return `I'll tell you one. ${capitalise(best.text)}. That's the truth of it.`;
  }
  const town = ctx.settlement ? ctx.settlement.name : "this place";
  return `Nothing worth telling yet. Ask me again when ${town} has a history.`;
}

/** What has to happen before a standing order fires. */
function triggerFrom(r) {
  if (r.concepts.includes(C.NIGHT)) return "night";
  if (r.concepts.includes(C.MORNING)) return "morning";
  if (r.creature && isHostile(r.creature)) return `sees:${r.creature}`;
  if (r.concepts.includes(C.HOSTILE)) return "sees:HOSTILE";
  if (r.concepts.includes(C.FOOD)) return "hungry";
  if (r.concepts.includes(C.ALWAYS)) return "always";
  return "night";
}

/**
 * The order half of "when X, do Y".
 *
 * A comma is the usual give-away. Failing that, everything after the condition
 * word is the order - "if you see a creeper run" has to leave just "run".
 */
function orderPartOf(text) {
  const raw = String(text || "").trim();
  const comma = raw.indexOf(",");
  if (comma > 0 && comma < raw.length - 2) return raw.slice(comma + 1).trim();
  const after = /\b(?:when|whenever|if|once|after|at night|at dawn|from now on)\b(.*)$/i.exec(raw);
  if (after && after[1]) {
    // "you see a creeper run away" - drop the condition, keep the order.
    const rest = after[1].replace(/^\s*(?:you\s+)?(?:see|spot|find|its|it is|it gets)\s+\S+\s*/i, "").trim();
    return rest || after[1].trim();
  }
  return raw;
}

/**
 * Which action a "never ..." order rules out.
 *
 * The action is usually in the *negated* set, not the present one - that is
 * what "never" does to it - so both have to be searched.
 */
function forbiddenFrom(r) {
  const seen = [...(r.concepts || []), ...(r.refused || [])];
  for (const c of [C.ATTACK, C.FLEE, C.MINE, C.CHOP, C.BUILD, C.FARM, C.EXPLORE, C.FOLLOW]) {
    if (seen.includes(c)) return String(c).toLowerCase();
  }
  return null;
}

/** Every intent this module can act on - used by the help text and the tests. */
export const SUPPORTED_INTENTS = [
  // work
  "chop", "mine", "dig_down", "tunnel", "clear", "bridge", "build", "place",
  "light", "farm", "repair", "demolish", "plant_trees", "water_crops",
  "torch_line", "road_to", "tunnel_to", "make_bed", "open_door", "close_door",
  // terraforming
  "flatten", "moat", "pit", "stairs", "hollow", "fill_hole", "seal",
  "perimeter", "fence", "roof", "dock",
  // movement
  "follow", "come", "goto", "go_direction", "go_home", "stay", "stop",
  "spread", "regroup", "meet_at", "wait_for", "escort", "keep_back", "resume",
  // fighting
  "attack", "hunt", "defend", "guard", "guard_place", "flee",
  // contests
  "contest_melee", "contest_duel", "contest_tournament", "contest_gather",
  "contest_find", "contest_race", "contest_dig", "contest_hunt",
  "contest_build", "scoreboard", "contest_stop",
  // things
  "craft", "smelt", "give", "drop", "take", "store", "fetch", "equip",
  "inventory", "sort_chests", "count_stock", "share_out", "arm_everyone",
  "collect_drops", "swap_jobs",
  // life
  "rest", "sleep", "wake", "eat", "explore",
  // speech and self
  "say", "quiet", "emote", "set_job", "rename", "found_town", "join_town",
  "set_voice", "work_faster", "work_careful",
  // social
  "praise", "scold", "story", "opinion", "introduce", "sing", "celebrate",
  "count_off",
  // places and town knowledge
  "name_place", "list_places", "where_is", "who_best", "town_report",
  "head_count",
  // conditions
  "standing_order", "until_order", "never_do",
  // meta
  "teach", "forget", "repeat", "help", "status",
];
