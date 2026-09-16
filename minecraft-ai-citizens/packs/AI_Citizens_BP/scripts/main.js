/**
 * AI Citizens - entry point.
 *
 * One master interval drives everything. Work is spread across ticks so a large
 * town never stalls the server: every citizen steps its current task each pass,
 * but only a slice of them re-plan, and heavy bookkeeping runs on a slow tick.
 *
 * Nothing here ever throws into the engine - every subsystem call is wrapped,
 * because one bad tick in Bedrock kills the whole script module for the session.
 */
import { world, system } from "@minecraft/server";
import { CONFIG, loadConfigOverrides } from "./core/config.js";
import { info, debug, warn, safe, reportError, broadcast, tell } from "./core/log.js";
import { RoundRobin } from "./core/scheduler.js";
import { PACK_VERSION } from "./core/generated.js";
import { dist, isNight as timeIsNight, prettyId, clamp } from "./core/util.js";

import { Citizen, CitizenRegistry, STATE, jobBadge } from "./agent/citizen.js";
import { perceive } from "./agent/perception.js";
import { decayNeeds, moodOf, scare, reassure, socialise } from "./agent/needs.js";
import {
  remember, learnFact, activeOrder, completeOrder, pushOrder, rememberPlace,
  pushDialogue,
} from "./agent/memory.js";

import { tickCaptions, say, interrupt, TONE } from "./ui/caption.js";
import { stepTask, taskLabel } from "./actions/registry.js";
import {
  releaseNavPoint, sweepOrphanMarkers, stopTravel,
} from "./actions/navigation.js";
import { fightTask, fleeTask } from "./actions/combat.js";
import * as TaskFactory from "./actions/registry.js";
import { findBedNear } from "./actions/interact.js";
import { findBuildSite } from "./actions/build.js";

import { Settlements, refreshStockpiles, shortages, checkPromotion, planNext, logEvent, recomputeStats, allocatePlot } from "./civ/settlement.js";
import { assignJobs, planJob, JOBS } from "./civ/jobs.js";
import { blueprintById } from "./civ/blueprints.js";

import { think, claudeBrain } from "./brain/index.js";
import { tickConversations } from "./social/conversation.js";
import { record } from "./social/relationships.js";
import { completionLine } from "./social/dialogue.js";

import {
  registerChat, registerInteraction, handleCommandText, handleSpeech,
} from "./commands/index.js";
import { loadVocabulary } from "./commands/effects.js";
import { registerSlashCommands, registerScriptEvents } from "./commands/slash.js";

// --------------------------------------------------------------------------
const registry = new CitizenRegistry();
const settlements = new Settlements();
const thinkRobin = new RoundRobin(1);

let tick = 0;
let booted = false;
let bootAttempts = 0;

/**
 * What this runtime actually supports. Filled in during boot and reported by
 * `!ai doctor`, so a missing API is a line of text rather than a silent
 * add-on that does nothing.
 */
const capabilities = {
  chat: "none",
  chatError: "",
  slashCommands: [],
  slashError: "",
  scriptEvents: false,
  interaction: false,
  entityEvents: false,
  settlementsLoaded: false,
  bootError: "",
};
const shortageCache = new Map();     // settlementId -> array

const DIMENSIONS = ["overworld", "nether", "the_end"];

// --------------------------------------------------------------------------
// The app facade handed to commands, the panel and the brains.
// --------------------------------------------------------------------------
const app = {
  registry,
  settlements,
  taskFactories: TaskFactory,
  get tick() { return tick; },

  spawnCitizen(location, dimension, job) {
    if (registry.count >= CONFIG.maxCitizens) return null;
    const entity = safe("app.spawn", () => dimension.spawnEntity("ai:citizen", {
      x: location.x, y: location.y + 0.5, z: location.z,
    }), null);
    if (!entity) return null;
    const citizen = registry.add(entity, tick);
    if (job && JOBS[job]) { citizen.setJob(job); citizen.jobLocked = true; }
    const settlement = settlements.nearest(location, dimension.id, CONFIG.settlementRadius);
    if (settlement) {
      citizen.settlementId = settlement.id;
      rememberPlace(citizen.memory, "home", settlement.origin, "settlement");
    }
    citizen.persist();
    return citizen;
  },

  removeCitizen(citizen) {
    releaseNavPoint(citizen);
    safe("app.remove", () => { if (citizen.valid) citizen.entity.remove(); });
    registry.remove(citizen.id);
  },

  removeAll() {
    const n = registry.count;
    for (const c of registry.all.slice()) app.removeCitizen(c);
    return n;
  },

  /** A player told a citizen to do something. */
  assignOrder(citizen, player, text, plan) {
    pushOrder(citizen.memory, text, player.name, tick);
    const order = citizen.memory.orders[0];
    order.label = plan.label || "following orders";
    order.task = plan.task || null;
    citizen.plan.length = 0;
    // A multi-clause order ("mine 20 iron then build a house") arrives as a
    // list; the first becomes the task and the rest wait their turn.
    const queued = (plan.tasks && plan.tasks.length ? plan.tasks : [plan.task]).filter(Boolean);
    citizen.task = queued[0] || null;
    for (const t of queued.slice(1)) citizen.plan.push(t);
    citizen.currentOrder = order;
    citizen.goal = order.label;
    citizen.dirty = true;
    record(citizen, player.name, "talked");
  },

  foundSettlementAt(player) {
    const s = settlements.found(player.location, player.dimension.id, player.name);
    const members = registry.near(player.location, 48);
    for (const c of members) {
      c.settlementId = s.id;
      c.dirty = true;
      rememberPlace(c.memory, "home", s.origin, "settlement");
    }
    assignJobs(s, members, player.dimension);
    settlements.save();
    broadcast(`§a${s.name}§r founded — ${members.length} citizens claimed it.`);
    return s;
  },

  buildCtx(citizen) {
    return makeContext(citizen);
  },

  capabilities,

  /** `!ai ...` text from chat, a slash command or a scriptevent. */
  handleCommandText(player, text) {
    if (!booted) boot();
    handleCommandText(app, player, text);
  },

  /** Plain speech from any source, routed exactly as overheard chat is. */
  handleSpeech(player, text) {
    if (!booted) boot();
    handleSpeech(app, player, text);
  },

  /**
   * Put a line in the mouth of the citizen nearest `player`.
   *
   * The chat bridge uses this to deliver a reply written outside the game, so
   * a citizen can answer in Claude's words rather than from the local writer.
   */
  voice(player, text) {
    if (!booted) boot();
    const line = String(text || "").trim();
    if (!line) return;
    const near = registry.near(player.location, 32)
      .filter((c) => c.dimension.id === player.dimension.id);
    if (!near.length) return;
    near.sort((a, b) => dist(a.location, player.location) - dist(b.location, player.location));
    const speaker = near[0];
    interrupt(speaker, line, { tone: TONE.normal, to: player.name });
    pushDialogue(speaker.memory, "me", line);
    safe("voice.look", () => speaker.entity.lookAt(player.getHeadLocation()));
  },
};

// --------------------------------------------------------------------------
function makeContext(citizen) {
  const settlement = citizen.settlementId
    ? settlements.get(citizen.settlementId)
    : settlements.nearest(citizen.location, citizen.dimension.id, CONFIG.settlementRadius);

  const members = settlement ? registry.inSettlement(settlement.id) : [];
  const nearbyCitizens = registry.near(citizen.location, CONFIG.conversationRadius * 2)
    .filter((c) => c !== citizen);

  return {
    tick,
    elapsed: CONFIG.fastTickInterval,
    citizen,
    dimension: citizen.dimension,
    isNight: timeIsNight(world.getTimeOfDay()),
    players: safe("ctx.players", () => world.getAllPlayers(), []) || [],
    registry,
    settlements,
    settlement,
    members,
    memberCount: members.length,
    nearbyCitizens,
    shortages: settlement ? (shortageCache.get(settlement.id) || []) : [],
    tasks: TaskFactory,

    replaceTask(task) {
      citizen.task = task;
    },
    findBed(c) {
      return findBedNear(c.dimension, c.location, 24);
    },
    chooseBuildSite(c, blueprint) {
      if (settlement) {
        const plot = allocatePlot(settlement, c.dimension, blueprint);
        if (plot) {
          const record2 = {
            id: `b${Date.now().toString(36)}`,
            blueprintId: blueprint.id, origin: plot.origin, rotation: plot.rotation,
            status: "building", assignedTo: c.id, need: "requested", placed: 0,
            total: blueprint.width * blueprint.depth * blueprint.height,
          };
          settlement.structures.push(record2);
          settlements.save();
          return { origin: plot.origin, rotation: plot.rotation, structureId: record2.id };
        }
      }
      const site = findBuildSite(c.dimension, c.location, blueprint.width, blueprint.depth, 28);
      return site ? { origin: site, rotation: 0 } : null;
    },
  };
}

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------
/**
 * Boot, one isolated step at a time.
 *
 * Every step is wrapped on its own. An API this runtime does not have - and
 * there are several that are pre-release - must cost exactly the feature that
 * needs it, never the whole add-on. The previous version registered chat inside
 * one big try block, so a missing `chatSend` stopped the world loop from ever
 * starting and `!ai spawn` did nothing at all.
 */
function boot() {
  if (booted) return;
  bootAttempts += 1;
  booted = true;                 // never re-enter, even if a step throws

  safe("boot.config", () => loadConfigOverrides(world));
  safe("boot.vocabulary", () => loadVocabulary());
  capabilities.settlementsLoaded = safe("boot.settlements", () => {
    settlements.load();
    return true;
  }, false);

  const chat = safe("boot.chat", () => registerChat(app), { mode: "none", error: "threw" });
  capabilities.chat = chat.mode;
  capabilities.chatError = chat.error || "";

  capabilities.interaction = safe("boot.interaction", () => registerInteraction(app), false);
  capabilities.entityEvents = safe("boot.entityEvents", () => {
    registerEntityEvents();
    return true;
  }, false);

  safe("boot.adopt", () => adoptExistingCitizens());
  safe("boot.sweep", () => {
    const swept = sweepOrphanMarkers(loadedDimensions(), registry.all);
    if (swept) debug(`swept ${swept} stray waypoints`);
  });

  info(`AI Citizens ready — ${registry.count} citizens, ${settlements.list.length} settlements`);
  info(`  commands: ${capabilities.slashCommands.join(" ") || "(none registered)"}`);
  info(`  chat listening: ${capabilities.chat}${capabilities.chatError ? ` (${capabilities.chatError})` : ""}`);
  if (capabilities.chat === "none") {
    info("  chat is a pre-release API in this build - use /ai:tell and /ai:cmd instead");
  }
}

function loadedDimensions() {
  const out = [];
  for (const id of DIMENSIONS) {
    const d = safe("dim", () => world.getDimension(id), null);
    if (d) out.push(d);
  }
  return out;
}

function adoptExistingCitizens() {
  for (const dim of loadedDimensions()) {
    const found = safe("adopt", () => dim.getEntities({ type: "ai:citizen" }), []) || [];
    for (const entity of found) {
      if (registry.get(entity.id)) continue;
      safe("adopt.add", () => registry.add(entity, tick));
    }
  }
}

function registerEntityEvents() {
  world.afterEvents.entitySpawn.subscribe((event) => {
    const e = event.entity;
    if (!e || e.typeId !== "ai:citizen") return;
    if (registry.get(e.id)) return;
    safe("spawnEvent", () => registry.add(e, tick));
  });

  // A joining player is told the add-on is alive and how to start. Without
  // this, "nothing happens" and "the scripts are not running" look identical
  // from inside the game, and the player has to already know a command to find
  // out which one they are looking at.
  safe("boot.greet", () => {
    const signal = world.afterEvents?.playerSpawn;
    if (!signal || typeof signal.subscribe !== "function") return;
    signal.subscribe((event) => {
      if (!CONFIG.announceOnJoin) return;
      if (!event.initialSpawn) return;
      const player = event.player;
      system.runTimeout(() => safe("greet", () => {
        const chatOn = capabilities.chat !== "none";
        tell(player, `§bAI Citizens §7v${PACK_VERSION}§r is running.`);
        if (capabilities.slashCommands.length) {
          tell(player, "  §7Start with §f/ai:spawn 4§7, then §f/ai:doctor§7 if anything looks wrong.§r");
        } else {
          tell(player, "  §cNo slash commands registered.§r §7Try §f/scriptevent ai:cmd doctor§7.§r");
        }
        if (chatOn) {
          tell(player, "  §7Or just type §fai! spawn 4§7 in chat.§r");
        } else {
          tell(player, "  §7Talk to them with §f/ai:tell go mine some iron§7.§r");
        }
      }), 60);
    });
  });

  world.afterEvents.entityDie.subscribe((event) => {
    const dead = event.deadEntity;
    if (!dead) return;
    const citizen = registry.get(dead.id);
    if (!citizen) return;

    releaseNavPoint(citizen);
    const settlement = citizen.settlementId ? settlements.get(citizen.settlementId) : null;
    if (settlement) {
      logEvent(settlement, `${citizen.name} was lost`);
      settlements.save();
    }
    broadcast(`§c${citizen.name}§r has died.`);

    // Everyone who saw it remembers, and the town mood drops.
    for (const other of registry.near(citizen.location, 24)) {
      if (other === citizen) continue;
      remember(other.memory, `${citizen.short} died`, 5, tick);
      scare(other, 30);
      interrupt(other, `${citizen.short}!`, { tone: TONE.alarm, seconds: 4 });
    }
    registry.remove(citizen.id);
  });

  world.afterEvents.entityHurt.subscribe((event) => {
    const hurt = event.hurtEntity;
    if (!hurt) return;
    const citizen = registry.get(hurt.id);
    if (!citizen) return;

    const source = event.damageSource?.damagingEntity;
    scare(citizen, 12);
    citizen.setState(STATE.IDLE);

    if (source && source.isValid) {
      if (source.typeId === "minecraft:player") {
        record(citizen, safeName(source), "hitThem", "struck me");
        interrupt(citizen, "What was that for?", { tone: TONE.alarm, seconds: 4 });
        return;
      }
      // Retaliate, or run - decided by the brain's combat rules.
      if (!citizen.task || citizen.task.kind !== "fight") {
        const willFight = citizen.job === "guard" || citizen.healthFraction > 0.5;
        citizen.task = willFight
          ? fightTask(source.id, { label: `fighting a ${prettyId(source.typeId)}` })
          : fleeTask(source.location);
        citizen.plan.length = 0;
      }
    }
  });
}

function safeName(entity) {
  return safe("safeName", () => entity.name || entity.nameTag || "someone", "someone");
}

// --------------------------------------------------------------------------
// Master loop
// --------------------------------------------------------------------------
function masterTick() {
  if (!booted) { boot(); return; }
  tick += CONFIG.fastTickInterval;

  safe("tick.prune", () => registry.prune());
  safe("tick.tasks", stepAllTasks);
  safe("tick.captions", () => tickCaptions(registry.all, tick, CONFIG.fastTickInterval));
  safe("tick.think", thinkSlice);
  safe("tick.claudeSweep", () => claudeBrain.sweep(tick));

  if (tick % 40 < CONFIG.fastTickInterval) {
    safe("tick.conversations", () => {
      const ctx = registry.count ? makeContext(registry.all[0]) : null;
      if (ctx) tickConversations(registry, ctx);
    });
  }
  if (tick % CONFIG.slowTickInterval < CONFIG.fastTickInterval) {
    safe("tick.slow", slowTick);
  }
}

function stepAllTasks() {
  const night = timeIsNight(world.getTimeOfDay());
  for (const citizen of registry.all) {
    if (!citizen.valid) continue;

    // Pull the next planned action when the current one is finished.
    if (!citizen.task && citizen.plan.length) {
      citizen.task = citizen.plan.shift();
    }
    if (!citizen.task) {
      if (citizen.mode !== "idle" && !citizen.conversation) citizen.setMode("idle");
      continue;
    }

    const ctx = makeContext(citizen);
    ctx.isNight = night;

    const result = stepTask(ctx, citizen.task);
    citizen.goal = taskLabel(citizen.task);
    citizen.lastResult = result;

    if (result === "running") {
      if (isStalled(citizen)) {
        debug(`${citizen.short} abandoned "${citizen.goal}" - no progress`);
        stopTravel(citizen);
        finishTask(citizen, ctx, "failed");
      }
      continue;
    }
    finishTask(citizen, ctx, result);
  }
}

/**
 * Last line of defence against a task that runs forever without achieving
 * anything - an unreachable block, a build site behind a cliff, a target that
 * never resolves. Progress is anything at all: moving, breaking, placing.
 */
function isStalled(citizen) {
  const p = citizen.location;
  const t = citizen.task;
  const signature = `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}` +
    `|${t.kind}|${t.phase || ""}|${t.mined || 0}|${t.placed || 0}|${t.collected || 0}` +
    `|${t.harvested || 0}|${t.made || 0}|${t.index || 0}|${t.tunnelled || 0}`;

  if (citizen.stallSignature !== signature) {
    citizen.stallSignature = signature;
    citizen.stallSince = tick;
    return false;
  }
  return tick - (citizen.stallSince ?? tick) > CONFIG.taskStallTicks;
}

function finishTask(citizen, ctx, result) {
  const task = citizen.task;
  citizen.task = null;
  citizen.stallSignature = null;
  citizen.stallSince = tick;

  // Side-effect flags a decoded action can carry.
  if (task.setJob) { citizen.setJob(task.setJob); citizen.jobLocked = true; }
  if (task.foundHere && !citizen.settlementId) {
    const s = settlements.found(citizen.location, citizen.dimension.id, citizen.name);
    citizen.settlementId = s.id;
    rememberPlace(citizen.memory, "home", s.origin, "settlement");
    settlements.save();
    say(citizen, `This is the place. ${s.name}.`, { tone: TONE.friendly });
  }
  if (task.pointAt) {
    citizen.setState(STATE.POINT);
    system.runTimeout(() => citizen.setState(STATE.IDLE), 40);
  }

  // Record structure progress so the settlement can see the build finish.
  if (task.structureRef && ctx.settlement) {
    const record2 = ctx.settlement.structures.find((s) => s.id === task.structureRef);
    if (record2) {
      record2.placed = (record2.placed || 0) + (task.placed || 0);
      if (result === "done") {
        record2.status = "done";
        logEvent(ctx.settlement, `finished the ${blueprintById(record2.blueprintId)?.name || "building"}`);
        recomputeStats(ctx.settlement);
        const promoted = checkPromotion(ctx.settlement);
        if (promoted) broadcast(`§a${ctx.settlement.name}§r is now a §e${promoted}§r.`);
        say(citizen, completionLine(citizen, "that's the roof on"), { tone: TONE.friendly });
        for (const m of ctx.members) socialise(m, 8);
      }
      settlements.save();
    }
  }

  // Close out a player's standing order.
  if (citizen.currentOrder && citizen.currentOrder.task === task) {
    if (result === "done") {
      completeOrder(citizen.memory, citizen.currentOrder);
      say(citizen, completionLine(citizen, citizen.currentOrder.label || "that"), { tone: TONE.order });
      record(citizen, citizen.currentOrder.from, "helped");
    } else {
      completeOrder(citizen.memory, citizen.currentOrder);
      say(citizen, "I couldn't manage that one.", { tone: TONE.sad });
    }
    citizen.currentOrder = null;
    citizen.dirty = true;
  }

  if (result === "nomaterial" && task.blockedOn) {
    learnFact(citizen.memory, `we need ${prettyId(task.blockedOn)}`);
    say(citizen, `I've run out of ${prettyId(task.blockedOn)}.`, { tone: TONE.work });
  }
  if (result === "nostation" && task.needsStation) {
    say(citizen, `We need a ${prettyId(task.needsStation)} before I can do that.`, { tone: TONE.work });
  }

  citizen.setState(STATE.IDLE);
  if (!citizen.plan.length) citizen.setMode("idle");
}

/** Only a slice of the population re-plans each pass. */
function thinkSlice() {
  const all = registry.all;
  if (!all.length) return;

  const passesPerThink = Math.max(1, CONFIG.thinkIntervalTicks / CONFIG.fastTickInterval);
  thinkRobin.sliceSize = Math.max(1, Math.ceil(all.length / passesPerThink));
  thinkRobin.sliceSize = Math.min(thinkRobin.sliceSize, CONFIG.maxCitizensPerThinkBatch);

  for (const citizen of thinkRobin.next(all)) {
    if (!citizen.valid) continue;
    if (tick - citizen.lastThinkTick < CONFIG.thinkIntervalTicks / 2) continue;
    // A citizen mid-task only re-plans if something has interrupted them.
    if (citizen.task && !needsReplan(citizen)) continue;

    citizen.lastThinkTick = tick;
    safe("think", () => thinkOne(citizen));
  }
}

function needsReplan(citizen) {
  const threat = citizen.snapshot?.threats?.[0];
  if (threat && threat.distance < 12 && citizen.task.kind !== "fight" && citizen.task.kind !== "flee") return true;
  if (citizen.needs.hunger < 18 && citizen.task.kind !== "eat") return true;
  return false;
}

function thinkOne(citizen) {
  citizen.snapshot = perceive(citizen, tick);
  const ctx = makeContext(citizen);
  const decision = think(citizen, ctx);
  if (!decision) return;

  if (decision.goal) citizen.goal = decision.goal;

  if (decision.say) {
    say(citizen, decision.say, {
      tone: decision.tone === "alarm" ? TONE.alarm : TONE.normal,
      to: decision.to || null,
    });
  }
  for (const fact of decision.remember || []) learnFact(citizen.memory, fact);

  if (decision.tasks && decision.tasks.length) {
    // A remote plan replaces whatever the local brain had queued.
    citizen.plan = decision.tasks.slice(0, 5);
    if (!citizen.task || decision.source === "claude") {
      if (citizen.task) stopTravel(citizen);
      citizen.task = citizen.plan.shift();
    }
  }
  citizen.dirty = true;
}

// --------------------------------------------------------------------------
// Slow tick: needs, settlement upkeep, persistence, growth
// --------------------------------------------------------------------------
let slowCounter = 0;

function slowTick() {
  slowCounter += 1;
  const night = timeIsNight(world.getTimeOfDay());

  adoptExistingCitizens();

  for (const citizen of registry.all) {
    if (!citizen.valid) continue;
    decayNeeds(citizen, night);
    if (!citizen.snapshot?.threats?.length) reassure(citizen, 3);
    if (citizen.dirty && slowCounter % 3 === 0) citizen.persist();
  }

  for (const settlement of settlements.list) {
    const dim = safe("slow.dim", () => world.getDimension(settlement.dimension), null);
    if (!dim) continue;
    const members = registry.inSettlement(settlement.id);

    if (slowCounter % 4 === 0) {
      safe("slow.stock", () => refreshStockpiles(settlement, dim));
      safe("slow.short", () => shortageCache.set(settlement.id, shortages(settlement, dim)));
    }
    if (slowCounter % 2 === 0 && members.length) {
      safe("slow.plan", () => planNext(settlement, dim, members.length));
    }
    if (slowCounter % 8 === 0 && members.length) {
      safe("slow.jobs", () => assignJobs(settlement, members, dim));
    }
    safe("slow.promote", () => {
      const promoted = checkPromotion(settlement);
      if (promoted) broadcast(`§a${settlement.name}§r has grown into a §e${promoted}§r.`);
    });
  }

  if (slowCounter % Math.max(1, Math.round(CONFIG.growthCheckTicks / CONFIG.slowTickInterval)) === 0) {
    safe("slow.growth", growSettlements);
  }
  if (slowCounter % 6 === 0) safe("slow.save", () => settlements.save());
}

/** A town with spare housing and food attracts new people. */
function growSettlements() {
  if (!CONFIG.autoGrow) return;
  if (registry.count >= CONFIG.maxCitizens) return;

  for (const settlement of settlements.list) {
    const members = registry.inSettlement(settlement.id);
    if (!members.length) continue;
    const stats = recomputeStats(settlement);
    const spareHousing = stats.housing - members.length;
    if (spareHousing < CONFIG.populationPerHouse) continue;
    if (stats.food < members.length * 2) continue;

    const dim = safe("grow.dim", () => world.getDimension(settlement.dimension), null);
    if (!dim) continue;

    const newcomer = app.spawnCitizen(settlement.origin, dim, null);
    if (!newcomer) continue;
    newcomer.settlementId = settlement.id;
    newcomer.persist();
    assignJobs(settlement, registry.inSettlement(settlement.id), dim);
    logEvent(settlement, `${newcomer.name} arrived`);
    say(newcomer, `I heard there was work in ${settlement.name}.`, { tone: TONE.friendly });
    broadcast(`§a${newcomer.name}§r has joined §e${settlement.name}§r.`);
    settlements.save();
    break;                                   // one arrival per check, at most
  }
}

// --------------------------------------------------------------------------
// Start
// --------------------------------------------------------------------------

/**
 * Live state for debugging. Exposed only while `debug` is on, and read by
 * tools/simulate.mjs; nothing in the add-on depends on it.
 */
export function debugState() {
  return { registry, settlements, tick, claudeBrain };
}
globalThis.aiCitizensDebug = debugState;

// Custom commands can only be registered during `system.beforeEvents.startup`,
// which fires before the world exists - so this has to run at module load, not
// inside boot().
const slash = registerSlashCommands(app);
capabilities.slashCommands = slash.registered;
capabilities.slashError = slash.error;
capabilities.scriptEvents = registerScriptEvents(app);

system.run(boot);
system.runInterval(() => {
  try {
    masterTick();
  } catch (e) {
    reportError("masterTick", e);
  }
}, CONFIG.fastTickInterval);

// Persist everything on the way out so nothing is lost on a clean stop.
system.beforeEvents.shutdown?.subscribe?.(() => {
  safe("shutdown", () => {
    for (const c of registry.all) c.persist();
    settlements.save();
  });
});
