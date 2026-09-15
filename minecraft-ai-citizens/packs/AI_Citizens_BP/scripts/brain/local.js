/**
 * The local brain: a utility planner that runs entirely in-game.
 *
 * It is the default when no Claude bridge is reachable, and it is always the
 * safety net - if a remote call is slow, fails, or returns nonsense, this is
 * what keeps the citizen acting like a person instead of freezing.
 *
 * Goals are scored each think-tick; the winner produces a task. Speech comes
 * from social/dialogue.js so citizens sound like themselves either way.
 */
import { CONFIG } from "../core/config.js";
import { debug } from "../core/log.js";
import { dist, clamp, pick, weightedPick, prettyId } from "../core/util.js";
import { moodOf, describeNeeds } from "../agent/needs.js";
import { trait, grit, chattiness } from "../agent/personality.js";
import { activeOrder, recentEvents } from "../agent/memory.js";
import { planJob } from "../civ/jobs.js";
import { nextStructureFor, shortages } from "../civ/settlement.js";
import { shouldEngage, nearestThreat } from "../actions/combat.js";
import { findFood } from "../actions/inventory.js";
import { findBedNear } from "../actions/interact.js";
import {
  fightTask, fleeTask, eatTask, sleepTask, restTask, exploreTask,
  waitTask, gotoTask, followTask,
} from "../actions/registry.js";
import { chooseTopic, contextFor, lineFor } from "../social/dialogue.js";

export const localBrain = {
  id: "local",
  ready: true,

  /** @returns {{say,to,mood,goal,tasks,remember}} */
  think(citizen, ctx) {
    const decision = {
      say: null, to: null, mood: moodOf(citizen), goal: citizen.goal, tasks: [], remember: [],
    };

    const goal = chooseGoal(citizen, ctx);
    decision.goal = goal.label;

    const task = goal.build(citizen, ctx);
    if (task) decision.tasks.push(task);

    // Speak occasionally - more if sociable, always if something is wrong.
    const urgent = goal.kind === "survive";
    const wantsToTalk = urgent
      || (ctx.tick - citizen.lastSpeechTick > CONFIG.speechCooldownTicks * 4
          && Math.random() < 0.10 + chattiness(citizen) * 0.18);

    if (wantsToTalk) {
      const topic = urgent ? (grit(citizen) > 0.65 ? "threat_brave" : "threat") : chooseTopic(citizen, ctx);
      decision.say = lineFor(citizen, topic, contextFor(citizen, topic, ctx));
      if (urgent) decision.tone = "alarm";
    }
    return decision;
  },
};

// --------------------------------------------------------------------------
// Goal scoring
// --------------------------------------------------------------------------
function chooseGoal(citizen, ctx) {
  const needs = citizen.needs;
  const threat = nearestThreat(citizen, 18);
  const order = activeOrder(citizen.memory);
  const candidates = [];

  // --- survive ----------------------------------------------------------
  if (threat) {
    const engage = shouldEngage(citizen, threat);
    candidates.push({
      kind: "survive",
      label: engage ? `fighting a ${threat.kind}` : "getting clear of danger",
      score: 100 - threat.distance * 2,
      build: (c) => (engage
        ? fightTask(threat.id, { label: `fighting a ${threat.kind}` })
        : fleeTask(threat.at || c.location)),
    });
  }
  if (citizen.healthFraction < 0.35 && !threat) {
    candidates.push({
      kind: "recover", label: "catching their breath", score: 55,
      build: () => restTask(12),
    });
  }

  // --- orders -----------------------------------------------------------
  if (order && order.task) {
    candidates.push({
      kind: "order",
      label: order.label || "following orders",
      score: 80,
      build: () => order.task,
    });
  }

  // --- needs ------------------------------------------------------------
  if (needs.hunger < CONFIG.eatThreshold && findFood(citizen)) {
    candidates.push({
      kind: "eat",
      label: "finding something to eat",
      score: 70 - needs.hunger,
      build: () => eatTask(),
    });
  }
  if (ctx.isNight && needs.energy < 60) {
    candidates.push({
      kind: "sleep",
      label: "turning in for the night",
      score: 60 - needs.energy * 0.5,
      build: (c, cx) => sleepTask(findBedNear(c.dimension, c.location, 20)),
    });
  } else if (needs.energy < CONFIG.sleepThreshold) {
    candidates.push({
      kind: "rest", label: "resting", score: 45, build: () => restTask(15),
    });
  }

  // --- work -------------------------------------------------------------
  const jobTask = planJob(citizen, ctx);
  if (jobTask) {
    const industry = trait(citizen, "industry");
    candidates.push({
      kind: "work",
      label: jobTask.label || `working as a ${citizen.job}`,
      score: 30 + industry * 25 + (ctx.settlement ? 8 : 0),
      build: () => jobTask,
    });
  }

  // --- social -----------------------------------------------------------
  if (needs.social < 45 && ctx.nearbyCitizens && ctx.nearbyCitizens.length) {
    const friend = ctx.nearbyCitizens[0];
    candidates.push({
      kind: "social",
      label: `catching up with ${friend.short}`,
      score: 28 + (45 - needs.social) * 0.4,
      build: () => gotoTask(friend.location, { arrive: 3, label: `going to see ${friend.short}` }),
    });
  }

  // --- homesickness -----------------------------------------------------
  // Without this, a citizen who cannot find work near home keeps exploring
  // outward and never comes back.
  if (ctx.settlement) {
    const away = dist(citizen.location, ctx.settlement.origin);
    const leash = CONFIG.settlementRadius * 2.5;
    if (away > leash) {
      candidates.push({
        kind: "gohome",
        label: `heading back to ${ctx.settlement.name}`,
        score: 40 + Math.min(40, (away - leash) * 0.4),
        build: () => gotoTask(ctx.settlement.origin, { arrive: 4, sprint: away > leash * 2, label: `heading back to ${ctx.settlement.name}` }),
      });
    }
  }

  // --- curiosity / fallback --------------------------------------------
  candidates.push({
    kind: "wander",
    label: "looking around",
    score: 8 + trait(citizen, "curiosity") * 12,
    build: () => (Math.random() < 0.6 ? exploreTask(40, { legs: 2 }) : waitTask(5, "taking a moment")),
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

/**
 * Turns a player's plain-English instruction into a task, without a model.
 * Handles the common cases; anything else falls through to the remote brain
 * (or an honest "say that again?").
 */
export function parseOrderLocally(citizen, text, ctx) {
  const t = String(text || "").toLowerCase();
  const num = (def) => {
    const m = /(\d+)/.exec(t);
    return m ? clamp(Number(m[1]), 1, 64) : def;
  };

  if (/\b(follow|come with|stay with|stick with)\b/.test(t)) {
    return { label: "following you", task: followTask(ctx.speakerId, { ticks: 0 }) };
  }
  if (/\b(stop|halt|wait here|hold on|stand down)\b/.test(t)) {
    return { label: "standing by", task: waitTask(20, "standing by") };
  }
  if (/\b(come here|over here|to me|follow me)\b/.test(t)) {
    return { label: "coming over", task: gotoTask(ctx.speakerLocation, { arrive: 2.5, label: "coming over" }) };
  }
  if (/\b(chop|cut|fell|log|timber|wood)\b/.test(t)) {
    const { chopTask } = ctx.tasks;
    return { label: "cutting wood", task: chopTask(num(16)) };
  }
  if (/\b(mine|dig|ore|iron|coal|diamond|gold|copper)\b/.test(t)) {
    const { mineOreTask, gatherTask } = ctx.tasks;
    const specific = /\b(iron|coal|diamond|gold|copper|redstone|lapis|emerald)\b/.exec(t);
    if (specific) {
      const want = `minecraft:${specific[1]}_ore`;
      const deep = `minecraft:deepslate_${specific[1]}_ore`;
      return {
        label: `mining ${specific[1]}`,
        task: gatherTask((b) => b === want || b === deep, 24, num(8), `mining ${specific[1]}`),
      };
    }
    return { label: "mining", task: mineOreTask(num(12)) };
  }
  if (/\b(farm|plant|harvest|sow|crops?|wheat)\b/.test(t)) {
    const { farmTask } = ctx.tasks;
    return { label: "working the fields", task: farmTask(citizen.location, 12) };
  }
  if (/\b(build|construct|raise|put up)\b/.test(t)) {
    return { label: "building", task: null, wantsBuild: matchStructure(t) };
  }
  if (/\b(guard|patrol|defend|watch)\b/.test(t)) {
    const { patrolTask } = ctx.tasks;
    const center = ctx.settlement ? ctx.settlement.origin : citizen.location;
    return { label: "on guard", task: patrolTask(center, 18, 4) };
  }
  if (/\b(attack|kill|fight)\b/.test(t)) {
    const threat = citizen.snapshot?.threats?.[0];
    if (threat) {
      return { label: `fighting a ${threat.kind}`, task: fightTask(threat.id) };
    }
  }
  if (/\b(explore|scout|look around|map)\b/.test(t)) {
    return { label: "scouting", task: exploreTask(80, { legs: 4 }) };
  }
  if (/\b(rest|sleep|sit)\b/.test(t)) {
    return { label: "resting", task: restTask(20) };
  }
  if (/\b(store|deposit|put.*(chest|stores))\b/.test(t)) {
    return { label: "storing goods", task: null, wantsStore: true };
  }
  return null;
}

function matchStructure(text) {
  const map = {
    house: "small_house", home: "small_house", cottage: "small_house",
    store: "storehouse", storehouse: "storehouse", warehouse: "storehouse",
    workshop: "workshop", forge: "workshop",
    well: "well", farm: "farm_plot", field: "farm_plot",
    tower: "watchtower", watchtower: "watchtower",
    wall: "wall_segment", road: "road_segment", lamp: "lamp_post",
    hall: "town_hall", "town hall": "town_hall", shrine: "shrine",
    camp: "campfire", campfire: "campfire",
  };
  for (const [word, id] of Object.entries(map)) {
    if (text.includes(word)) return id;
  }
  return null;
}

export { matchStructure };
