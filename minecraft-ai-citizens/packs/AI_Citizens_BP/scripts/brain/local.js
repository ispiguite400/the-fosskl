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
import { parse, understand } from "./nlu.js";
import { planOrder } from "./orders.js";

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
 * What a citizen should do about something a player said.
 *
 * The message is split into clauses first, because "mine 20 iron then build a
 * house" is two orders; each becomes a task and they are queued in the order
 * they were spoken. Anything the command layer has to perform itself - a change
 * of job, founding a town, learning a word - comes back as an `effect` rather
 * than being done here.
 *
 * @returns {null|{label,task,tasks,confidence,understood,reply,effect,wantsBuild,wantsStore}}
 */
export function parseOrderLocally(citizen, text, ctx) {
  const { readings, whole } = parse(text);
  if (!readings.length) return null;

  const tasks = [];
  const effects = [];
  const labels = [];
  let reply = null;
  let wantsBuild;
  let wantsStore = false;
  let best = 0;

  for (const r of readings) {
    if (r.intent === "question") continue;
    const step = planOrder(citizen, r, ctx);
    if (!step) continue;

    best = Math.max(best, r.confidence);
    if (step.label) labels.push(step.label);
    for (const t of step.tasks) tasks.push(t);
    if (step.effect) effects.push(step.effect);
    if (!reply && step.reply) reply = step.reply;
    if (step.wantsBuild !== undefined) wantsBuild = step.wantsBuild;
    if (step.wantsStore) wantsStore = true;
  }

  // Nothing mapped onto an action: let the caller say so rather than pretending.
  if (!tasks.length && !effects.length && !reply && wantsBuild === undefined) return null;

  // A queue this long is a misreading, not an instruction.
  const queued = tasks.slice(0, 8);

  return {
    label: labels.join(", then ") || "following orders",
    task: queued[0] || null,
    tasks: queued,
    confidence: Number(best.toFixed(2)),
    understood: whole,
    readings,
    reply,
    effect: effects[0] || null,
    effects,
    wantsBuild,
    wantsStore,
  };
}
