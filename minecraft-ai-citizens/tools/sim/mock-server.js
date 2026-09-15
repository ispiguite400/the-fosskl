/**
 * A small mock of @minecraft/server, enough to run the add-on's tick loop
 * outside the game. Used by tools/simulate.mjs.
 *
 * It is not a Minecraft emulator - it is a harness that answers the same API
 * shapes the add-on calls, over a simple voxel world, so logic bugs, bad
 * assumptions and crashes surface here rather than in-game.
 */

// --------------------------------------------------------------------------
// World data
// --------------------------------------------------------------------------
const SEA = 60;
const blocks = new Map();          // "x,y,z" -> typeId
const key = (x, y, z) => `${x},${y},${z}`;

export const simStats = {
  blocksBroken: 0,
  blocksPlaced: 0,
  sounds: 0,
  itemsSpawned: 0,
  messages: [],
  nameTags: new Map(),
  errors: [],
};

function generated(x, y, z) {
  if (y < 0) return "minecraft:bedrock";
  if (y < 5) return "minecraft:deepslate";
  if (y < SEA - 4) {
    // sprinkle ore deterministically
    const h = Math.abs(Math.imul(x * 374761393 + y * 668265263 + z * 1274126177, 1) >>> 0);
    if (h % 211 === 0) return "minecraft:iron_ore";
    if (h % 307 === 0) return "minecraft:coal_ore";
    if (h % 1511 === 0) return "minecraft:diamond_ore";
    return "minecraft:stone";
  }
  if (y < SEA) return "minecraft:dirt";
  if (y === SEA) return "minecraft:grass_block";
  // trees: a 3x3 grid of trunks every 11 blocks
  if (y > SEA && y <= SEA + 4 && x % 11 === 0 && z % 11 === 0) return "minecraft:oak_log";
  if (y > SEA + 2 && y <= SEA + 6
      && Math.abs(x % 11) <= 2 && Math.abs(z % 11) <= 2) return "minecraft:oak_leaves";
  return "minecraft:air";
}

function getType(x, y, z) {
  const k = key(x, y, z);
  if (blocks.has(k)) return blocks.get(k);
  return generated(x, y, z);
}

function setType(x, y, z, type) {
  blocks.set(key(x, y, z), type);
}

export function seedArea() {
  // a water pool so farmers can till, and a chest for the stockpile
  for (let x = 6; x < 10; x++) for (let z = 6; z < 10; z++) setType(x, SEA, z, "minecraft:water");
  setType(2, SEA + 1, 2, "minecraft:chest");
  setType(4, SEA + 1, 2, "minecraft:crafting_table");
  setType(4, SEA + 1, 4, "minecraft:furnace");
  setType(-4, SEA + 1, -4, "minecraft:red_bed");
}

// --------------------------------------------------------------------------
// Components
// --------------------------------------------------------------------------
export class ItemStack {
  constructor(typeId, amount = 1) {
    if (typeof typeId !== "string") throw new Error("ItemStack needs a type id");
    this.typeId = typeId;
    this.amount = amount;
  }
  clone() { return new ItemStack(this.typeId, this.amount); }
}

export const EquipmentSlot = {
  Mainhand: "Mainhand", Offhand: "Offhand",
  Head: "Head", Chest: "Chest", Legs: "Legs", Feet: "Feet",
};

export const EntityComponentTypes = { Inventory: "minecraft:inventory" };

export class BlockPermutation {
  constructor(typeId, states) { this.typeId = typeId; this.states = states || {}; }
  static resolve(typeId, states) {
    if (typeof typeId !== "string") throw new Error("bad block id");
    return new BlockPermutation(typeId, states);
  }
  getState(name) { return this.states[name]; }
  withState(name, value) { return new BlockPermutation(this.typeId, { ...this.states, [name]: value }); }
}

class Container {
  constructor(size) { this.size = size; this.slots = new Array(size).fill(undefined); }
  get emptySlotsCount() { return this.slots.filter((s) => !s).length; }
  getItem(i) { return this.slots[i] ? this.slots[i].clone() : undefined; }
  setItem(i, stack) { this.slots[i] = stack ? stack.clone() : undefined; }
  addItem(stack) {
    let left = stack.amount;
    for (let i = 0; i < this.size && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.typeId === stack.typeId && s.amount < 64) {
        const add = Math.min(64 - s.amount, left);
        s.amount += add; left -= add;
      }
    }
    for (let i = 0; i < this.size && left > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(64, left);
        this.slots[i] = new ItemStack(stack.typeId, add);
        left -= add;
      }
    }
    return left > 0 ? new ItemStack(stack.typeId, left) : undefined;
  }
}

class Block {
  constructor(dim, x, y, z) { this.dimension = dim; this.x = x; this.y = y; this.z = z; }
  get typeId() { return getType(this.x, this.y, this.z); }
  get isAir() { return this.typeId === "minecraft:air"; }
  get permutation() { return new BlockPermutation(this.typeId, { growth: 7, open_bit: false }); }
  get location() { return { x: this.x, y: this.y, z: this.z }; }
  center() { return { x: this.x + 0.5, y: this.y + 0.5, z: this.z + 0.5 }; }
  above() { return new Block(this.dimension, this.x, this.y + 1, this.z); }
  below() { return new Block(this.dimension, this.x, this.y - 1, this.z); }
  setType(type) {
    const t = typeof type === "string" ? type : type?.id;
    if (typeof t !== "string") throw new Error("setType needs a string");
    if (t === "minecraft:air") simStats.blocksBroken++; else simStats.blocksPlaced++;
    setType(this.x, this.y, this.z, t);
  }
  setPermutation(perm) {
    if (!(perm instanceof BlockPermutation)) throw new Error("setPermutation needs a BlockPermutation");
    simStats.blocksPlaced++;
    setType(this.x, this.y, this.z, perm.typeId);
  }
  getComponent(id) {
    if (id === "minecraft:inventory" && /chest|barrel/.test(this.typeId)) {
      const k = "c" + key(this.x, this.y, this.z);
      if (!chestStore.has(k)) chestStore.set(k, new Container(27));
      return { container: chestStore.get(k) };
    }
    return undefined;
  }
}
const chestStore = new Map();

// --------------------------------------------------------------------------
// Entities
// --------------------------------------------------------------------------
let nextId = 1;
const entities = [];

export class Entity {
  constructor(typeId, location, dimension) {
    this.typeId = typeId;
    this.id = `e${nextId++}`;
    this.location = { ...location };
    this.dimension = dimension;
    this.isValid = true;
    this.nameTag = "";
    this.tags = new Set();
    this.props = new Map();
    this.dynamic = new Map();
    this.events = [];
    this.health = 20;
    this.maxHealth = 20;
    this.container = typeId === "ai:citizen" ? new Container(36) : null;
    this.equipment = new Map();
    this.target = undefined;
    entities.push(this);
  }
  getHeadLocation() { return { x: this.location.x, y: this.location.y + 1.6, z: this.location.z }; }
  getViewDirection() { return { x: 0, y: 0, z: 1 }; }
  getComponent(id) {
    switch (id) {
      case "minecraft:health":
        return { currentValue: this.health, effectiveMax: this.maxHealth,
                 setCurrentValue: (v) => { this.health = v; } };
      case "minecraft:inventory":
        return this.container ? { container: this.container } : undefined;
      case "minecraft:equippable":
        return {
          setEquipment: (slot, stack) => { this.equipment.set(slot, stack); return true; },
          getEquipment: (slot) => this.equipment.get(slot),
        };
      case "minecraft:type_family":
        return { hasTypeFamily: (f) => this.typeId.includes(f) };
      default:
        return undefined;
    }
  }
  setProperty(name, value) {
    if (name === "ai:state" && (value < 0 || value > 14)) throw new Error("ai:state out of range");
    if (name === "ai:skin" && (value < 0 || value > 19)) throw new Error("ai:skin out of range");
    this.props.set(name, value);
  }
  getProperty(name) { return this.props.get(name); }
  triggerEvent(name) {
    if (!/^ai:(set_|become_|ch_)/.test(name)) throw new Error(`unknown event ${name}`);
    this.events.push(name);
    // Mirror what the entity JSON's component groups would do, so the harness
    // can emulate the vanilla pathfinder below.
    let m = /^ai:set_travel_(\d+)$/.exec(name);
    if (m) { this.mode = "travel"; this.channel = Number(m[1]); return; }
    m = /^ai:set_ch_(\d+)$/.exec(name);
    if (m) { this.channel = Number(m[1]); return; }
    m = /^ai:set_(\w+)$/.exec(name);
    if (m) this.mode = m[1];
  }
  teleport(loc, opts) { this.location = { ...loc }; if (opts?.dimension) this.dimension = opts.dimension; }
  addTag(t) { this.tags.add(t); return true; }
  removeTag(t) { return this.tags.delete(t); }
  hasTag(t) { return this.tags.has(t); }
  getTags() { return [...this.tags]; }
  setDynamicProperty(k, v) {
    if (v === undefined) this.dynamic.delete(k);
    else {
      const okType = typeof v === "string" || typeof v === "number" || typeof v === "boolean";
      if (!okType) throw new Error(`dynamic property ${k} must be a primitive, got ${typeof v}`);
      if (typeof v === "string" && v.length > 32767) throw new Error("dynamic property too long");
      this.dynamic.set(k, v);
    }
  }
  getDynamicProperty(k) { return this.dynamic.get(k); }
  applyDamage(amount, opts) {
    this.health -= amount;
    if (this.health <= 0) { this.isValid = false; fireEntityDie(this, opts?.damagingEntity); }
    return true;
  }
  applyKnockback() { return true; }
  lookAt() { return true; }
  remove() { this.isValid = false; }
  runCommand() { return { successCount: 0 }; }
}

class Player extends Entity {
  constructor(name, location, dimension) {
    super("minecraft:player", location, dimension);
    this.name = name;
    this.isSneaking = false;
    this.onScreenDisplay = { setActionBar: () => {} };
  }
  sendMessage(msg) { simStats.messages.push(String(msg)); }
}

// --------------------------------------------------------------------------
// Dimensions
// --------------------------------------------------------------------------
class Dimension {
  constructor(id) { this.id = id; }
  getBlock(loc) {
    const x = Math.floor(loc.x), y = Math.floor(loc.y), z = Math.floor(loc.z);
    if (y < -64 || y > 320) return undefined;
    return new Block(this, x, y, z);
  }
  getEntities(opts = {}) {
    let list = entities.filter((e) => e.isValid && e.dimension.id === this.id);
    if (opts.type) list = list.filter((e) => e.typeId === opts.type);
    if (opts.families) list = list.filter((e) => opts.families.some((f) => e.typeId.includes(f)));
    if (opts.location && opts.maxDistance !== undefined) {
      list = list.filter((e) => {
        const dx = e.location.x - opts.location.x;
        const dy = e.location.y - opts.location.y;
        const dz = e.location.z - opts.location.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz) <= opts.maxDistance;
      });
    }
    return list;
  }
  getPlayers(opts) { return this.getEntities({ ...opts }).filter((e) => e.typeId === "minecraft:player"); }
  spawnEntity(typeId, loc) {
    if (typeof typeId !== "string") throw new Error("spawnEntity needs a type id");
    if (!["ai:citizen", "ai:nav_point"].includes(typeId)) throw new Error(`unknown entity ${typeId}`);
    return new Entity(typeId, loc, this);
  }
  spawnItem() { simStats.itemsSpawned++; return new Entity("minecraft:item", { x: 0, y: 0, z: 0 }, this); }
  playSound() { simStats.sounds++; }
  getWeather() { return "Clear"; }
  runCommand() { return { successCount: 0 }; }
}

const dimensions = new Map([
  ["minecraft:overworld", new Dimension("minecraft:overworld")],
  ["minecraft:nether", new Dimension("minecraft:nether")],
  ["minecraft:the_end", new Dimension("minecraft:the_end")],
]);

// --------------------------------------------------------------------------
// Events
// --------------------------------------------------------------------------
function signal() {
  const subs = [];
  return {
    subscribe: (fn) => { subs.push(fn); return fn; },
    unsubscribe: (fn) => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); },
    fire: (payload) => { for (const fn of subs.slice()) fn(payload); },
  };
}

const chatSend = signal();
const entitySpawnEv = signal();
const entityDieEv = signal();
const entityHurtEv = signal();
const interactEv = signal();

function fireEntityDie(entity, source) {
  entityDieEv.fire({ deadEntity: entity, damageSource: { damagingEntity: source } });
}

// --------------------------------------------------------------------------
// world / system
// --------------------------------------------------------------------------
const worldDynamic = new Map();
let timeOfDay = 1000;
let day = 1;

export const world = {
  getDay: () => day,
  getTimeOfDay: () => timeOfDay,
  setTimeOfDay: (t) => { timeOfDay = t; },
  getAllPlayers: () => entities.filter((e) => e.isValid && e.typeId === "minecraft:player"),
  getDimension: (id) => {
    const full = id.startsWith("minecraft:") ? id : `minecraft:${id}`;
    const d = dimensions.get(full);
    if (!d) throw new Error(`no dimension ${id}`);
    return d;
  },
  sendMessage: (msg) => { simStats.messages.push(String(msg)); },
  setDynamicProperty: (k, v) => {
    if (v === undefined) worldDynamic.delete(k);
    else {
      const okType = typeof v === "string" || typeof v === "number" || typeof v === "boolean";
      if (!okType) throw new Error(`world dynamic property ${k} must be a primitive`);
      worldDynamic.set(k, v);
    }
  },
  getDynamicProperty: (k) => worldDynamic.get(k),
  beforeEvents: { chatSend },
  afterEvents: {
    entitySpawn: entitySpawnEv,
    entityDie: entityDieEv,
    entityHurt: entityHurtEv,
    playerInteractWithEntity: interactEv,
  },
};

const intervals = [];
const timeouts = [];
let currentTick = 0;

export const system = {
  get currentTick() { return currentTick; },
  run: (fn) => { timeouts.push({ at: currentTick, fn }); return timeouts.length; },
  runTimeout: (fn, ticks) => { timeouts.push({ at: currentTick + ticks, fn }); return timeouts.length; },
  runInterval: (fn, ticks) => { intervals.push({ every: Math.max(1, ticks), fn, last: -999 }); return intervals.length; },
  clearRun: () => {},
  runJob: (gen) => { for (const _ of gen) { /* drain */ } return 0; },
  beforeEvents: { shutdown: signal() },
  afterEvents: {},
};

// --------------------------------------------------------------------------
// Harness controls
// --------------------------------------------------------------------------
/**
 * Stands in for Minecraft's own pathfinder.
 *
 * A citizen in travel mode walks toward the waypoint marker on its channel at
 * roughly vanilla speed, stepping up one block and falling back to the surface.
 * Crude, but it exercises the add-on's real arrival, stuck-detection and
 * work-in-reach code paths instead of leaving citizens frozen.
 */
const WALK_SPEED = 0.22;

function surfaceAt(x, z, nearY) {
  const bx = Math.floor(x), bz = Math.floor(z);
  for (let y = Math.floor(nearY) + 3; y > Math.floor(nearY) - 12; y--) {
    const below = getType(bx, y - 1, bz);
    const at = getType(bx, y, bz);
    const head = getType(bx, y + 1, bz);
    const solid = below !== "minecraft:air" && !below.includes("leaves");
    const clear = at === "minecraft:air" || at === "minecraft:water" || at.includes("grass");
    const clearHead = head === "minecraft:air" || head.includes("grass") || head.includes("leaves");
    if (solid && clear && clearHead) return y;
  }
  return Math.floor(nearY);
}

function simulateMovement() {
  for (const e of entities) {
    if (!e.isValid || e.typeId !== "ai:citizen") continue;
    if (e.mode !== "travel" && e.mode !== "combat") {
      e.location.y = surfaceAt(e.location.x, e.location.z, e.location.y);
      continue;
    }
    const marker = entities.find((n) => n.isValid && n.typeId === "ai:nav_point"
      && n.channel === e.channel && n.dimension.id === e.dimension.id);

    if (marker) {
      const dx = marker.location.x - e.location.x;
      const dz = marker.location.z - e.location.z;
      const d = Math.hypot(dx, dz);
      if (d >= 0.15) {
        const nx = e.location.x + (dx / d) * Math.min(WALK_SPEED, d);
        const nz = e.location.z + (dz / d) * Math.min(WALK_SPEED, d);
        const ny = surfaceAt(nx, nz, e.location.y);
        // Vanilla mobs cannot climb more than a block at a time.
        if (ny - e.location.y <= 1.05) {
          e.location.x = nx;
          e.location.z = nz;
          e.location.y = ny;
        }
      }
    }
    // Gravity applies whether or not they are walking - a citizen who mines the
    // floor out from under themselves has to drop into the hole.
    e.location.y = surfaceAt(e.location.x, e.location.z, e.location.y);
  }
}

export function advance(ticks) {
  for (let i = 0; i < ticks; i++) {
    currentTick++;
    simulateMovement();
    timeOfDay = (timeOfDay + 1) % 24000;
    if (timeOfDay === 0) day++;

    const due = timeouts.filter((t) => t.at <= currentTick);
    for (const t of due) {
      timeouts.splice(timeouts.indexOf(t), 1);
      try { t.fn(); } catch (e) { simStats.errors.push(`timeout: ${e.stack || e.message}`); }
    }
    for (const iv of intervals) {
      if (currentTick - iv.last >= iv.every) {
        iv.last = currentTick;
        try { iv.fn(); } catch (e) { simStats.errors.push(`interval: ${e.stack || e.message}`); }
      }
    }
  }
}

export function addPlayer(name, location) {
  return new Player(name, location, dimensions.get("minecraft:overworld"));
}

export function sendChat(player, message) {
  const event = { sender: player, message, cancel: false };
  chatSend.fire(event);
  return event;
}

export function fireSpawn(entity) { entitySpawnEv.fire({ entity }); }
export function fireHurt(entity, source) {
  entityHurtEv.fire({ hurtEntity: entity, damageSource: { damagingEntity: source } });
}
export function fireInteract(player, target) {
  interactEv.fire({ player, target });
}
export function allEntities() { return entities.filter((e) => e.isValid); }
export function overworld() { return dimensions.get("minecraft:overworld"); }
export function setTime(t) { timeOfDay = t; }
export { getType as blockAt, setType as setBlockAt, SEA };
