/**
 * The Citizen: a thin, persistent soul bolted onto a Bedrock entity.
 *
 * The entity itself only knows how to walk, swing and be hurt. Everything that
 * makes a citizen a person - name, personality, memory, job, plans, speech -
 * lives here and is mirrored into the entity's dynamic properties so it
 * survives chunk unloads, restarts and world reloads.
 */
import { world } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import { NAV_CHANNELS, SKIN_COUNT } from "../core/generated.js";
import { saveJson, loadJson } from "../core/store.js";
import { reportError, safe } from "../core/log.js";
import { hashString, mulberry32, dist, clamp } from "../core/util.js";
import { nameFor, shortName } from "../core/names.js";
import { personalityFor } from "./personality.js";
import { freshNeeds } from "./needs.js";
import { freshMemory, packMemory, unpackMemory } from "./memory.js";

export const STATE = {
  IDLE: 0, WALK: 1, RUN: 2, MINE: 3, BUILD: 4, ATTACK: 5, TALK: 6,
  SIT: 7, SLEEP: 8, CRAFT: 9, FARM: 10, CARRY: 11, CHEER: 12, POINT: 13, SWIM: 14,
};

const P = {
  seed: "ai:seed",
  name: "ai:name",
  job: "ai:job",
  channel: "ai:channel",
  settlement: "ai:settlement",
  home: "ai:home",
  needs: "ai:needs",
  mem: "ai:mem",
  born: "ai:born",
};

export class Citizen {
  constructor(entity) {
    this.entity = entity;
    this.id = entity.id;

    this.seed = readString(entity, P.seed) || entity.id;
    this.name = readString(entity, P.name) || nameFor(this.seed);
    this.short = shortName(this.name);
    this.rnd = mulberry32(hashString(this.seed));
    this.personality = personalityFor(this.seed);

    this.job = readString(entity, P.job) || "settler";
    this.channel = readNumber(entity, P.channel, -1);
    this.settlementId = readString(entity, P.settlement) || "";
    this.home = readJsonProp(entity, P.home, null);
    this.bornDay = readNumber(entity, P.born, world.getDay());

    this.needs = { ...freshNeeds(), ...(readJsonProp(entity, P.needs, {}) || {}) };
    this.memory = unpackMemory(loadJson(entity, P.mem, null));

    // --- volatile runtime state (never persisted) -------------------------
    this.snapshot = null;         // latest perception
    this.plan = [];               // queued actions from the brain
    this.task = null;             // action currently being stepped
    this.goal = "settle in";      // one-line intent, shown in the roster
    this.mode = "";               // vanilla AI mode currently applied
    this.state = STATE.IDLE;
    this.navPoint = null;         // the marker entity this citizen chases
    this.route = [];              // remaining waypoints
    this.routeTarget = null;
    this.lastProgressTick = 0;
    this.lastProgressDist = Infinity;
    this.stuckCount = 0;
    this.caption = null;          // { full, shown, expires, colour }
    this.speechQueue = [];
    this.lastSpeechTick = -9999;
    this.lastThinkTick = -9999;
    this.lastRemoteTick = -9999;
    this.pendingThought = false;
    this.conversation = null;     // { withId, withName, turnsLeft, lastTick }
    this.attackCooldown = 0;
    this.lastKnownPos = { ...entity.location };
    this.dirty = false;
    this.spawnTick = 0;
  }

  // --- identity ---------------------------------------------------------
  get valid() {
    try { return this.entity && this.entity.isValid; } catch { return false; }
  }

  get location() {
    return safe("citizen.location", () => this.entity.location, this.lastKnownPos);
  }

  get dimension() {
    return this.entity.dimension;
  }

  get health() {
    return safe("citizen.health", () => {
      const c = this.entity.getComponent("minecraft:health");
      return c ? c.currentValue : 20;
    }, 20);
  }

  get maxHealth() {
    return safe("citizen.maxHealth", () => {
      const c = this.entity.getComponent("minecraft:health");
      return c ? c.effectiveMax : 20;
    }, 20);
  }

  get healthFraction() {
    const m = this.maxHealth;
    return m > 0 ? this.health / m : 1;
  }

  distanceTo(location) {
    return dist(this.location, location);
  }

  // --- first-time setup -------------------------------------------------
  initialise(tick, usedChannels) {
    const e = this.entity;
    if (!readString(e, P.seed)) {
      const seed = `${e.id}:${world.getDay()}:${Math.floor(this.rnd() * 1e9)}`;
      this.seed = seed;
      this.rnd = mulberry32(hashString(seed));
      this.personality = personalityFor(seed);
      this.name = nameFor(seed);
      this.short = shortName(this.name);
      writeString(e, P.seed, seed);
      writeString(e, P.name, this.name);
      writeNumber(e, P.born, world.getDay());
      this.bornDay = world.getDay();
      safe("citizen.skin", () => {
        e.setProperty("ai:skin", Math.floor(this.rnd() * SKIN_COUNT) % SKIN_COUNT);
      });
    }
    if (this.channel < 0 || this.channel >= NAV_CHANNELS) {
      this.channel = pickChannel(usedChannels);
      writeNumber(e, P.channel, this.channel);
    }
    this.spawnTick = tick;
    this.refreshNameTag();
  }

  // --- persistence ------------------------------------------------------
  persist() {
    if (!this.valid) return;
    safe("citizen.persist", () => {
      writeString(this.entity, P.name, this.name);
      writeString(this.entity, P.job, this.job);
      writeNumber(this.entity, P.channel, this.channel);
      writeString(this.entity, P.settlement, this.settlementId);
      writeJsonProp(this.entity, P.home, this.home);
      writeJsonProp(this.entity, P.needs, this.needs);
      saveJson(this.entity, P.mem, packMemory(this.memory));
    });
    this.dirty = false;
  }

  // --- presentation -----------------------------------------------------
  setState(state) {
    if (this.state === state) return;
    this.state = state;
    safe("citizen.setState", () => this.entity.setProperty("ai:state", state));
  }

  /**
   * Applies a vanilla AI mode. `travel` needs the citizen's private waypoint
   * channel so two citizens never chase the same marker.
   */
  setMode(mode) {
    if (this.mode === mode) return;
    const event = mode === "travel" ? `ai:set_travel_${this.channel}` : `ai:set_${mode}`;
    if (safe("citizen.setMode", () => { this.entity.triggerEvent(event); return true; }, false)) {
      this.mode = mode;
    }
  }

  setJob(job) {
    if (this.job === job) return;
    this.job = job;
    this.dirty = true;
    safe("citizen.role", () => {
      this.entity.triggerEvent(job === "guard" ? "ai:become_guard" : "ai:become_civilian");
    });
    this.refreshNameTag();
  }

  /** The floating caption above the head: name, job, and whatever they are saying. */
  refreshNameTag(extraLines) {
    if (!this.valid) return;
    const lines = [];
    if (CONFIG.showNamesAlways || extraLines) {
      lines.push(`§f${this.name}§r §7${jobBadge(this.job)}§r`);
    }
    if (extraLines && extraLines.length) lines.push(...extraLines);
    safe("citizen.nameTag", () => { this.entity.nameTag = lines.join("\n"); });
  }

  // --- inventory --------------------------------------------------------
  get container() {
    return safe("citizen.container", () => {
      const inv = this.entity.getComponent("minecraft:inventory");
      return inv ? inv.container : undefined;
    });
  }

  countItem(typeId) {
    const c = this.container;
    if (!c) return 0;
    let total = 0;
    for (let i = 0; i < c.size; i++) {
      const stack = safe("countItem", () => c.getItem(i));
      if (stack && stack.typeId === typeId) total += stack.amount;
    }
    return total;
  }

  listInventory() {
    const c = this.container;
    const out = new Map();
    if (!c) return out;
    for (let i = 0; i < c.size; i++) {
      const stack = safe("listInventory", () => c.getItem(i));
      if (!stack) continue;
      out.set(stack.typeId, (out.get(stack.typeId) || 0) + stack.amount);
    }
    return out;
  }

  get freeSlots() {
    const c = this.container;
    return c ? c.emptySlotsCount : 0;
  }
}

// --------------------------------------------------------------------------
// Registry
// --------------------------------------------------------------------------
export class CitizenRegistry {
  constructor() {
    this.byId = new Map();
    this.order = [];
  }

  get all() {
    return this.order;
  }

  get count() {
    return this.order.length;
  }

  get(id) {
    return this.byId.get(id);
  }

  byName(name) {
    const want = String(name).toLowerCase();
    return this.order.find(
      (c) => c.name.toLowerCase() === want || c.short.toLowerCase() === want,
    );
  }

  add(entity, tick) {
    if (this.byId.has(entity.id)) return this.byId.get(entity.id);
    const citizen = new Citizen(entity);
    citizen.initialise(tick, this.channelUsage());
    this.byId.set(citizen.id, citizen);
    this.order.push(citizen);
    return citizen;
  }

  remove(id) {
    const c = this.byId.get(id);
    if (!c) return;
    this.byId.delete(id);
    const i = this.order.indexOf(c);
    if (i >= 0) this.order.splice(i, 1);
  }

  channelUsage() {
    const usage = new Array(NAV_CHANNELS).fill(0);
    for (const c of this.order) {
      if (c.channel >= 0 && c.channel < NAV_CHANNELS) usage[c.channel]++;
    }
    return usage;
  }

  /** Drops citizens whose entity has gone away (killed, unloaded, removed). */
  prune() {
    for (let i = this.order.length - 1; i >= 0; i--) {
      if (!this.order[i].valid) {
        const dead = this.order[i];
        this.byId.delete(dead.id);
        this.order.splice(i, 1);
      }
    }
  }

  near(location, radius) {
    return this.order.filter((c) => c.valid && dist(c.location, location) <= radius);
  }

  inSettlement(settlementId) {
    return this.order.filter((c) => c.settlementId === settlementId);
  }
}

// --------------------------------------------------------------------------
function pickChannel(usage) {
  let best = 0;
  for (let i = 1; i < usage.length; i++) if (usage[i] < usage[best]) best = i;
  return best;
}

export function jobBadge(job) {
  const badges = {
    settler: "· settler", builder: "⛏ builder", miner: "⛏ miner",
    farmer: "🌾 farmer", lumberjack: "🪓 woodcutter", guard: "🛡 guard",
    crafter: "🔨 crafter", scout: "🧭 scout", hauler: "📦 hauler",
    architect: "📐 architect", cook: "🍞 cook", trader: "💰 trader",
  };
  return badges[job] || `· ${job}`;
}

function readString(entity, key) {
  const v = safe("readString", () => entity.getDynamicProperty(key));
  return typeof v === "string" ? v : "";
}

function readNumber(entity, key, fallback) {
  const v = safe("readNumber", () => entity.getDynamicProperty(key));
  return typeof v === "number" ? v : fallback;
}

function writeString(entity, key, value) {
  safe("writeString", () => entity.setDynamicProperty(key, String(value ?? "")));
}

function writeNumber(entity, key, value) {
  safe("writeNumber", () => entity.setDynamicProperty(key, Number(value) || 0));
}

function readJsonProp(entity, key, fallback) {
  const raw = readString(entity, key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function writeJsonProp(entity, key, value) {
  safe("writeJsonProp", () => {
    entity.setDynamicProperty(key, value === null || value === undefined ? undefined : JSON.stringify(value));
  });
}

export function clampNeeds(needs) {
  for (const k of Object.keys(needs)) needs[k] = clamp(needs[k], 0, 100);
  return needs;
}
