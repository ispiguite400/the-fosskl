/**
 * Builds the context packet sent to the Claude bridge.
 *
 * The wording of the system prompt lives in the bridge (bridge/src/prompts.js)
 * so it can be tuned without repacking the add-on, and so the bridge can cache
 * a byte-stable prefix. This module's job is to send everything Claude needs to
 * be *this* citizen, in this place, at this moment - and nothing else.
 */
import { CONFIG } from "../core/config.js";
import { prettyId, timeLabel } from "../core/util.js";
import { describePersonality } from "../agent/personality.js";
import { describeNeeds, moodOf } from "../agent/needs.js";
import {
  summarise, recentEvents, knownFacts, dialogueTranscript, activeOrder,
  relationshipWord,
} from "../agent/memory.js";
import { describeSnapshot } from "../agent/perception.js";
import { summariseInventory } from "../actions/inventory.js";
import {
  describeSettlement, recentHistory, nextStructureFor, recomputeStats,
  shortages, TIERS,
} from "../civ/settlement.js";
import { blueprintById } from "../civ/blueprints.js";
import { actionHelpText, structureNames } from "./schema.js";
import { describeJob } from "../civ/jobs.js";

export function buildContext(citizen, ctx, request) {
  const snap = citizen.snapshot;
  const settlement = ctx.settlement;

  const packet = {
    v: 1,
    request: request.kind,                     // "tick" | "chat" | "converse"
    citizen: {
      id: citizen.id,
      name: citizen.name,
      job: citizen.job,
      jobBlurb: describeJob(citizen.job),
      personality: describePersonality(citizen.personality),
      voice: citizen.personality.voice,
      mood: moodOf(citizen),
      needs: describeNeeds(citizen),
      health: `${Math.round(citizen.health)}/${Math.round(citizen.maxHealth)}`,
      inventory: summariseInventory(citizen, 10),
      bornDay: citizen.bornDay,
      goal: citizen.goal,
      doing: citizen.task ? (citizen.task.label || citizen.task.kind) : "nothing in particular",
    },
    world: snap ? {
      brief: describeSnapshot(snap),
      position: snap.position,
      time: snap.time,
      day: snap.day,
      night: snap.night,
      weather: snap.weather,
      players: snap.players,
      citizens: snap.citizens,
      threats: snap.threats,
      blocks: snap.blocks.slice(0, 6),
      hazards: snap.hazards,
    } : null,
    memory: {
      summary: summarise(citizen.memory, citizen.name),
      recent: recentEvents(citizen.memory, 6),
      facts: knownFacts(citizen.memory, 5),
      conversation: dialogueTranscript(citizen.memory, 8),
      order: describeOrder(citizen),
    },
    settlement: settlement ? {
      name: settlement.name,
      tier: TIERS[settlement.tier]?.name || "camp",
      summary: describeSettlement(settlement, ctx.memberCount || 0),
      building: describeBuilding(settlement),
      shortages: (ctx.shortages || []).slice(0, 5)
        .map((s) => `${prettyId(s.item)}: have ${s.have}, need ${s.need}`),
      history: recentHistory(settlement, 4),
    } : null,
    capabilities: {
      actions: actionHelpText(),
      structures: structureNames(),
    },
  };

  if (request.kind === "chat") {
    packet.message = {
      from: request.speaker,
      text: request.text,
      addressedToMe: Boolean(request.direct),
      relationship: relationshipWord(
        citizen.memory.people[request.speaker]?.affinity ?? 0,
      ),
    };
  }
  if (request.kind === "converse") {
    packet.partner = {
      name: request.partnerName,
      lastLine: request.lastLine || null,
      relationship: relationshipWord(
        citizen.memory.people[request.partnerName]?.affinity ?? 0,
      ),
    };
  }
  return packet;
}

function describeOrder(citizen) {
  const order = activeOrder(citizen.memory);
  if (!order) return null;
  return `${order.from} told me: "${order.text}"`;
}

function describeBuilding(settlement) {
  const next = nextStructureFor(settlement);
  if (!next) return null;
  const bp = blueprintById(next.blueprintId);
  const pct = next.total ? Math.round((next.placed / next.total) * 100) : 0;
  return `${bp ? bp.name : next.blueprintId} at ${next.origin.x},${next.origin.y},${next.origin.z} - ${next.status}, ${pct}% placed`;
}

/**
 * Batched conversation context: when several citizens stand together, the
 * bridge can answer for all of them at once and keep the group coherent.
 */
export function buildGroupContext(citizens, ctx, request) {
  return {
    v: 1,
    request: "group",
    trigger: request,
    scene: citizens[0]?.snapshot ? describeSnapshot(citizens[0].snapshot) : "",
    settlement: ctx.settlement ? {
      name: ctx.settlement.name,
      summary: describeSettlement(ctx.settlement, ctx.memberCount || 0),
    } : null,
    citizens: citizens.map((c) => ({
      id: c.id,
      name: c.name,
      job: c.job,
      personality: describePersonality(c.personality),
      mood: moodOf(c),
      doing: c.task ? (c.task.label || c.task.kind) : "idle",
    })),
    capabilities: { actions: actionHelpText(), structures: structureNames() },
  };
}
