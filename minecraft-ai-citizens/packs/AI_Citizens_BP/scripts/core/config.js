/**
 * Central tunables. Anything a server owner might want to change lives here.
 * `/ai config <key> <value>` edits these at runtime and persists the override.
 */
export const CONFIG = {
  // --- population -------------------------------------------------------
  maxCitizens: 40,               // hard cap on living citizens per world
  spawnCooldownTicks: 20,

  // --- thinking ---------------------------------------------------------
  brain: "auto",                 // "auto" | "claude" | "local"
  thinkIntervalTicks: 40,        // how often a citizen re-plans (2s)
  fastTickInterval: 4,           // action stepping / caption updates
  slowTickInterval: 100,         // needs, schedules, civilisation upkeep
  maxCitizensPerThinkBatch: 6,   // spread planning across ticks
  claudeTimeoutTicks: 200,       // give up on a pending remote reply after 10s

  // --- Claude bridge ----------------------------------------------------
  bridgeUrl: "http://127.0.0.1:8787",
  bridgeToken: "",               // optional shared secret, set via /ai config
  claudeMaxPendingRequests: 4,
  claudeMinIntervalTicks: 30,    // per-citizen floor between remote calls
  claudeChatIntervalTicks: 10,   // faster path when a player is talking

  // --- perception -------------------------------------------------------
  sightRadius: 24,
  blockScanRadius: 10,
  hearingRadius: 20,
  chatRadius: 32,                // how far a player's chat reaches citizens
  chatPrefix: "ai!",             // attention word: "ai! go mine some iron"
  announceOnJoin: true,          // greet a joining player so they can see it works

  // --- speech -----------------------------------------------------------
  captionSeconds: 6,
  captionWidth: 34,              // characters before wrapping
  captionMaxLines: 3,
  typewriter: true,
  typewriterCharsPerTick: 1.6,
  speechCooldownTicks: 30,
  speechSound: true,
  captionsToChat: false,   // mirror captions into chat (off: captions only)
  captionRange: 28,        // players further than this do not need the update
  conversationRadius: 14,
  conversationChance: 0.22,      // per social tick, per nearby pair
  conversationMaxTurns: 6,

  // --- needs ------------------------------------------------------------
  hungerPerSlowTick: 0.9,
  energyPerSlowTick: 0.55,
  socialPerSlowTick: 0.7,
  eatThreshold: 45,
  sleepThreshold: 25,

  // --- work -------------------------------------------------------------
  mineTicksPerBlock: 16,
  placeTicksPerBlock: 8,
  reach: 4.5,
  stuckTicks: 90,                // no progress for this long -> re-route
  taskStallTicks: 900,           // a task making no progress at all is abandoned
  maxPathWaypoints: 64,
  waypointSpacing: 8,
  arriveDistance: 1.8,
  allowTeleportUnstick: true,    // last-resort nudge when truly wedged
  allowBridging: true,           // place blocks to cross gaps
  allowTunnelling: true,         // mine through obstacles while travelling

  // --- civilisation -----------------------------------------------------
  settlementRadius: 48,
  plotSize: 11,
  buildQueueLimit: 24,
  populationPerHouse: 1,
  growthCheckTicks: 1200,
  autoGrow: true,

  // --- combat -----------------------------------------------------------
  attackCooldownTicks: 16,
  fleeHealthFraction: 0.3,

  // --- misc -------------------------------------------------------------
  debug: false,
  showNamesAlways: true,
  friendlyFire: false,
};

const OVERRIDE_KEY = "ai:config";

export function loadConfigOverrides(world) {
  try {
    const raw = world.getDynamicProperty(OVERRIDE_KEY);
    if (typeof raw !== "string" || !raw) return;
    const patch = JSON.parse(raw);
    for (const [k, v] of Object.entries(patch)) {
      if (k in CONFIG) CONFIG[k] = v;
    }
  } catch {
    /* corrupt override blob - fall back to defaults */
  }
}

export function saveConfigOverride(world, key, value) {
  let patch = {};
  try {
    const raw = world.getDynamicProperty(OVERRIDE_KEY);
    if (typeof raw === "string" && raw) patch = JSON.parse(raw);
  } catch { /* start fresh */ }
  patch[key] = value;
  CONFIG[key] = value;
  world.setDynamicProperty(OVERRIDE_KEY, JSON.stringify(patch));
}

export function coerceConfigValue(key, text) {
  const current = CONFIG[key];
  if (typeof current === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof current === "boolean") {
    if (/^(true|yes|on|1)$/i.test(text)) return true;
    if (/^(false|no|off|0)$/i.test(text)) return false;
    return undefined;
  }
  return text;
}
