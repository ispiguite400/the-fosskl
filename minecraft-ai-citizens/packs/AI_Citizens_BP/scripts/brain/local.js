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
import { understand, RESOURCE_BLOCKS, STRUCTURE_IDS } from "./nlu.js";

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
 * Turns what a player said into a task.
 *
 * The understanding is done by brain/nlu.js - tokenising, stemming, spelling
 * correction, negation scoping and intent scoring - so this function only has
 * to map a recognised intent onto the action layer. It used to be a chain of
 * regular expressions, which could not read a sentence it had not been written
 * for and, worse, turned "don't follow me" into an order to follow.
 *
 * @returns {{label, task, confidence, understood}|null}
 */
export function parseOrderLocally(citizen, text, ctx) {
  const reading = understand(text);
  if (!reading.intent || reading.intent === "question") return null;

  const T = ctx.tasks || {};
  const qty = (fallback) => clamp(reading.quantity ?? fallback, 1, 64);
  const done = (label, task) => ({
    label, task, confidence: reading.confidence, understood: reading,
  });

  switch (reading.intent) {
    case "stop":
      return done("standing by", waitTask(20, "standing by"));

    case "follow":
      return done("following you", followTask(ctx.speakerId, { ticks: 0 }));

    case "come":
      return done("coming over",
        gotoTask(ctx.speakerLocation, { arrive: 2.5, label: "coming over" }));

    case "chop":
      return done("cutting wood", T.chopTask ? T.chopTask(qty(16)) : null);

    case "mine": {
      const blocks = RESOURCE_BLOCKS[reading.resource];
      if (blocks && T.gatherTask) {
        const pretty = String(reading.resource || "ore").toLowerCase();
        return done(`mining ${pretty}`,
          T.gatherTask((b) => blocks.includes(b), 24, qty(8), `mining ${pretty}`));
      }
      return done("mining", T.mineOreTask ? T.mineOreTask(qty(12)) : null);
    }

    case "farm":
      return done("working the fields",
        T.farmTask ? T.farmTask(citizen.location, 12) : null);

    case "build":
      return {
        label: "building", task: null, confidence: reading.confidence,
        understood: reading,
        wantsBuild: STRUCTURE_IDS[reading.structure] || null,
      };

    case "guard": {
      const centre = ctx.settlement ? ctx.settlement.origin : citizen.location;
      return done("on guard", T.patrolTask ? T.patrolTask(centre, 18, 4) : null);
    }

    case "attack": {
      const threat = citizen.snapshot?.threats?.[0];
      if (!threat) return done("looking for trouble", exploreTask(24, { legs: 1 }));
      return done(`fighting a ${threat.kind}`, fightTask(threat.id));
    }

    case "explore":
      return done("scouting", exploreTask(80, { legs: 4 }));

    case "rest":
      return done("resting", restTask(20));

    case "eat":
      return done("finding something to eat", eatTask());

    case "store":
      return {
        label: "storing goods", task: null, confidence: reading.confidence,
        understood: reading, wantsStore: true,
      };

    default:
      return null;
  }
}
