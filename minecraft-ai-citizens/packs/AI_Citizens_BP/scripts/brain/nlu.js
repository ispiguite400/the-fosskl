/**
 * Understanding what the player said.
 *
 * This is a natural-language understanding pipeline, written from scratch and
 * running inside the script pack with no network and no model:
 *
 *   normalise -> tokenise -> stem -> lexicon lookup (with typo correction)
 *             -> negation scoping -> slot extraction -> intent scoring
 *
 * It answers inside a tick, and it reports a confidence, so a citizen can say
 * "I don't follow" instead of guessing at something it half-recognised.
 *
 * Two entry points:
 *   understand(text)  one sentence -> one reading
 *   parse(text)       a whole message -> the list of readings it contains,
 *                     because "mine 20 iron then build a house" is two orders
 */

// --------------------------------------------------------------------------
// Concepts. A word maps to one or more of these; everything downstream reasons
// about concepts, never about spelling.
// --------------------------------------------------------------------------
export const C = {
  // --- actions ---
  MINE: "MINE", CHOP: "CHOP", FARM: "FARM", PLANT: "PLANT", HARVEST: "HARVEST",
  BUILD: "BUILD", PLACE: "PLACE", CLEAR: "CLEAR", TUNNEL: "TUNNEL",
  DOWNWARD: "DOWNWARD", BRIDGE: "BRIDGE", LIGHTUP: "LIGHTUP",
  FOLLOW: "FOLLOW", COME: "COME", GOTO: "GOTO", RETURN: "RETURN",
  STAY: "STAY", STOP: "STOP", SPREAD: "SPREAD", REGROUP: "REGROUP",
  GUARD: "GUARD", DEFEND: "DEFEND", ATTACK: "ATTACK", HUNT: "HUNT", FLEE: "FLEE",
  EXPLORE: "EXPLORE", REST: "REST", SLEEP: "SLEEP", WAKE: "WAKE",
  STORE: "STORE", FETCH: "FETCH", CRAFT: "CRAFT", SMELT: "SMELT",
  GIVE: "GIVE", DROP: "DROP", TAKE: "TAKE", EQUIP: "EQUIP", GATHER: "GATHER",
  SAY: "SAY", QUIET: "QUIET", EMOTE: "EMOTE",
  JOB: "JOB", RENAME: "RENAME", FOUND: "FOUND", JOIN: "JOIN",
  TEACH: "TEACH", FORGET: "FORGET", REPEAT: "REPEAT", HELP: "HELP",
  STATUS: "STATUS", INVENTORY: "INVENTORY",

  // --- materials and resources ---
  WOOD: "WOOD", STONE: "STONE", IRON: "IRON", COAL: "COAL", DIAMOND: "DIAMOND",
  GOLD: "GOLD", COPPER: "COPPER", REDSTONE: "REDSTONE", LAPIS: "LAPIS",
  EMERALD: "EMERALD", DIRT: "DIRT", SAND: "SAND", GRAVEL: "GRAVEL",
  CLAY: "CLAY", GLASS: "GLASS", OBSIDIAN: "OBSIDIAN", QUARTZ: "QUARTZ",
  NETHERRACK: "NETHERRACK", SNOW: "SNOW", ICE: "ICE", WOOL: "WOOL",
  FOOD: "FOOD", SEEDS: "SEEDS", ORE: "ORE", WATER: "WATER",

  // --- items ---
  TORCH: "TORCH", PICKAXE: "PICKAXE", AXE: "AXE", SWORD: "SWORD",
  SHOVEL: "SHOVEL", HOE: "HOE", ARMOUR: "ARMOUR", CHEST: "CHEST",
  FURNACE: "FURNACE", TABLE: "TABLE", BED: "BED", DOOR: "DOOR",
  LADDER: "LADDER", BOAT: "BOAT", BUCKET: "BUCKET", STICK: "STICK",

  // --- structures ---
  HOUSE: "HOUSE", STOREHOUSE: "STOREHOUSE", WORKSHOP: "WORKSHOP", WELL: "WELL",
  FIELD: "FIELD", TOWER: "TOWER", WALL: "WALL", ROAD: "ROAD", LAMP: "LAMP",
  HALL: "HALL", SHRINE: "SHRINE", CAMP: "CAMP",

  // --- creatures ---
  HOSTILE: "HOSTILE", ZOMBIE: "ZOMBIE", SKELETON: "SKELETON", CREEPER: "CREEPER",
  SPIDER: "SPIDER", ENDERMAN: "ENDERMAN", WITCH: "WITCH", SLIME: "SLIME",
  ANIMAL: "ANIMAL", COW: "COW", PIG: "PIG", SHEEP: "SHEEP", CHICKEN: "CHICKEN",
  HORSE: "HORSE", WOLF: "WOLF", VILLAGER: "VILLAGER",

  // --- jobs ---
  J_MINER: "J_MINER", J_BUILDER: "J_BUILDER", J_FARMER: "J_FARMER",
  J_GUARD: "J_GUARD", J_SMITH: "J_SMITH", J_SCOUT: "J_SCOUT",
  J_WOODCUTTER: "J_WOODCUTTER", J_HAULER: "J_HAULER",
  J_ARCHITECT: "J_ARCHITECT", J_SETTLER: "J_SETTLER",

  // --- directions and places ---
  NORTH: "NORTH", SOUTH: "SOUTH", EAST: "EAST", WEST: "WEST",
  UP: "UP", DOWN: "DOWN",
  HERE: "HERE", HOME: "HOME", TOWN: "TOWN", CAVE: "CAVE", SURFACE: "SURFACE",

  // --- modifiers ---
  NEGATE: "NEGATE", QUESTION: "QUESTION", SELF: "SELF", EVERYONE: "EVERYONE",
  ALL: "ALL", MORE: "MORE", NIGHT: "NIGHT", AGAIN: "AGAIN",
};

/** stem -> concepts. One word may carry several ("logs" is wood and an item). */
const LEXICON = new Map();

function define(concept, words) {
  for (const w of words) {
    const key = w.toLowerCase();
    if (!LEXICON.has(key)) LEXICON.set(key, []);
    if (!LEXICON.get(key).includes(concept)) LEXICON.get(key).push(concept);
  }
}

// --- actions --------------------------------------------------------------
define(C.MINE, ["mine", "mining", "dig", "digging", "excavate", "quarry", "extract", "mineshaft"]);
define(C.CHOP, ["chop", "cut", "fell", "axe", "lumber", "logging", "deforest"]);
define(C.FARM, ["farm", "farming", "till", "crop", "crops", "agriculture", "field"]);
define(C.PLANT, ["plant", "sow", "seeding", "replant", "grow"]);
define(C.HARVEST, ["harvest", "reap", "pick", "gathering"]);
define(C.BUILD, ["build", "construct", "erect", "assemble", "raise", "rebuild"]);
define(C.PLACE, ["place", "put", "set", "lay"]);
define(C.CLEAR, ["clear", "flatten", "level", "strip", "demolish", "raze", "tear", "dismantle", "remove", "clean"]);
define(C.TUNNEL, ["tunnel", "corridor", "passage", "burrow", "bore"]);
define(C.DOWNWARD, ["downward", "downwards", "deeper", "shaft", "staircase"]);
define(C.BRIDGE, ["bridge", "span", "causeway"]);
define(C.LIGHTUP, ["illuminate", "lighting", "torching"]);
define(C.FOLLOW, ["follow", "accompany", "tag", "trail", "escort", "shadow"]);
define(C.COME, ["come", "approach", "hither"]);
define(C.GOTO, ["goto", "go", "goes", "going", "walk", "head", "travel", "march", "move", "proceed", "navigate"]);
define(C.RETURN, ["return", "back", "homeward"]);
define(C.STAY, ["stay", "remain", "hold", "stand", "still", "position", "anchor"]);
define(C.STOP, ["stop", "halt", "cease", "quit", "wait", "pause", "freeze", "abandon", "cancel", "enough"]);
define(C.SPREAD, ["spread", "scatter", "disperse", "fan"]);
define(C.REGROUP, ["regroup", "assemble", "rally", "huddle", "together", "gather-round"]);
define(C.GUARD, ["guard", "patrol", "sentry", "watch", "garrison"]);
define(C.DEFEND, ["defend", "protect", "cover", "bodyguard", "shield"]);
define(C.ATTACK, ["attack", "kill", "fight", "slay", "strike", "hit", "destroy", "charge", "engage"]);
define(C.HUNT, ["hunt", "butcher", "slaughter", "poach"]);
define(C.FLEE, ["flee", "run", "running", "ran", "retreat", "escape", "withdraw", "hide", "bolt"]);
define(C.EXPLORE, ["explore", "scout", "wander", "roam", "search", "survey", "map", "reconnoitre"]);
define(C.REST, ["rest", "relax", "sit", "nap", "breather", "break"]);
define(C.SLEEP, ["sleep", "slumber", "bunk", "asleep"]);
define(C.WAKE, ["wake", "awaken", "rise", "awake"]);
define(C.STORE, ["store", "stash", "deposit", "storage", "unload", "shelve"]);
define(C.FETCH, ["fetch", "retrieve", "withdraw"]);
define(C.CRAFT, ["craft", "forge", "smith", "manufacture"]);
define(C.SMELT, ["smelt", "cook", "bake", "roast", "melt", "refine"]);
define(C.GIVE, ["give", "hand", "pass", "bring", "deliver", "gift"]);
define(C.DROP, ["drop", "throw", "toss", "discard", "dump", "ditch"]);
define(C.TAKE, ["take", "grab", "claim", "loot", "salvage"]);
define(C.EQUIP, ["equip", "wield", "wear", "arm", "draw", "holding"]);
define(C.GATHER, ["gather", "collect", "get", "find", "need", "want", "want"]);
define(C.SAY, ["say", "tell", "speak", "shout", "announce", "repeat-after-me", "talk"]);
define(C.QUIET, ["quiet", "silence", "hush", "shush", "silent", "mute"]);
define(C.EMOTE, ["dance", "cheer", "wave", "point", "bow", "laugh", "celebrate", "salute"]);
define(C.JOB, ["job", "role", "become", "profession", "trade", "duty", "occupation"]);
define(C.RENAME, ["rename", "name", "call", "christen", "dub"]);
define(C.FOUND, ["found", "settle", "establish", "colonise", "colonize"]);
define(C.JOIN, ["join", "enlist", "enroll", "member"]);
define(C.TEACH, ["means", "meaning", "learn", "teach", "memorise", "memorize"]);
define(C.FORGET, ["forget", "unlearn"]);
define(C.REPEAT, ["repeat", "redo", "encore"]);
define(C.HELP, ["help", "assist", "aid", "commands", "instructions"]);
define(C.STATUS, ["status", "report", "doing", "busy", "progress", "update"]);
define(C.INVENTORY, ["inventory", "carrying", "pockets", "bag", "pack", "holdings"]);

// --- materials ------------------------------------------------------------
define(C.WOOD, ["wood", "wooden", "log", "logs", "timber", "tree", "trees", "oak", "birch", "spruce", "jungle", "acacia", "plank", "planks"]);
define(C.STONE, ["stone", "rock", "cobble", "cobblestone", "granite", "andesite", "diorite", "deepslate", "boulder"]);
define(C.IRON, ["iron"]);
define(C.COAL, ["coal"]);
define(C.DIAMOND, ["diamond", "diamonds"]);
define(C.GOLD, ["gold", "golden"]);
define(C.COPPER, ["copper"]);
define(C.REDSTONE, ["redstone"]);
define(C.LAPIS, ["lapis"]);
define(C.EMERALD, ["emerald", "emeralds"]);
define(C.DIRT, ["dirt", "soil", "earth", "mud", "grass"]);
define(C.SAND, ["sand", "sandstone"]);
define(C.GRAVEL, ["gravel", "pebbles", "shingle"]);
define(C.CLAY, ["clay", "brick", "bricks"]);
define(C.GLASS, ["glass", "pane", "panes", "window", "windows"]);
define(C.OBSIDIAN, ["obsidian"]);
define(C.QUARTZ, ["quartz"]);
define(C.NETHERRACK, ["netherrack", "nether"]);
define(C.SNOW, ["snow", "snowball"]);
define(C.ICE, ["ice", "frost"]);
define(C.WOOL, ["wool", "cloth", "fabric"]);
define(C.FOOD, ["food", "eat", "eating", "ate", "feed", "dine", "bread", "meal", "supper", "dinner", "hungry", "apple", "carrot", "potato", "beef", "pork", "mutton", "steak", "stew", "rations"]);
define(C.SEEDS, ["seed", "seeds", "wheat", "sapling", "saplings"]);
define(C.ORE, ["ore", "ores", "mineral", "minerals", "vein", "seam"]);
define(C.WATER, ["water", "river", "lake", "sea", "pond", "stream"]);

// --- items ----------------------------------------------------------------
define(C.TORCH, ["torch", "torches", "lantern", "lanterns"]);
define(C.PICKAXE, ["pickaxe", "pick", "picks"]);
define(C.AXE, ["hatchet", "axes"]);
define(C.SWORD, ["sword", "blade", "swords"]);
define(C.SHOVEL, ["shovel", "spade"]);
define(C.HOE, ["hoe"]);
define(C.ARMOUR, ["armour", "armor", "helmet", "chestplate", "boots", "leggings", "mail"]);
define(C.CHEST, ["chest", "chests", "crate", "barrel", "container"]);
define(C.FURNACE, ["furnace", "kiln", "smelter", "oven"]);
define(C.TABLE, ["crafting", "workbench", "bench"]);
define(C.BED, ["bed", "beds", "bunk"]);
define(C.DOOR, ["door", "doors", "gate", "hatch"]);
define(C.LADDER, ["ladder", "ladders", "rungs"]);
define(C.BOAT, ["boat", "raft", "canoe"]);
define(C.BUCKET, ["bucket", "pail"]);
define(C.STICK, ["stick", "sticks"]);

// --- structures -----------------------------------------------------------
define(C.HOUSE, ["house", "cottage", "hut", "shelter", "cabin", "dwelling"]);
define(C.STOREHOUSE, ["storehouse", "warehouse", "granary", "depot", "silo"]);
define(C.WORKSHOP, ["workshop", "smithy"]);
define(C.WELL, ["well", "wells"]);
define(C.FIELD, ["farmland", "plot", "garden", "paddock"]);
define(C.TOWER, ["tower", "watchtower", "lookout", "turret"]);
define(C.WALL, ["wall", "walls", "fence", "rampart", "palisade", "barrier"]);
define(C.ROAD, ["road", "path", "street", "track", "lane"]);
define(C.LAMP, ["lamp", "lamppost", "light", "lights", "streetlight"]);
define(C.HALL, ["hall", "townhall", "longhouse", "moot"]);
define(C.SHRINE, ["shrine", "temple", "altar", "chapel"]);
define(C.CAMP, ["camp", "campfire", "bonfire", "encampment"]);

// --- creatures ------------------------------------------------------------
define(C.HOSTILE, ["monster", "monsters", "mob", "mobs", "hostile", "hostiles", "enemy", "enemies", "undead"]);
define(C.ZOMBIE, ["zombie", "zombies", "husk", "drowned"]);
define(C.SKELETON, ["skeleton", "skeletons", "stray", "archer"]);
define(C.CREEPER, ["creeper", "creepers"]);
define(C.SPIDER, ["spider", "spiders"]);
define(C.ENDERMAN, ["enderman", "endermen"]);
define(C.WITCH, ["witch", "witches"]);
define(C.SLIME, ["slime", "slimes", "magma"]);
define(C.ANIMAL, ["animal", "animals", "livestock", "beast", "cattle", "creature"]);
define(C.COW, ["cow", "cows", "bull", "calf"]);
define(C.PIG, ["pig", "pigs", "hog", "boar"]);
define(C.SHEEP, ["sheep", "lamb", "ram", "ewe"]);
define(C.CHICKEN, ["chicken", "chickens", "hen", "rooster"]);
define(C.HORSE, ["horse", "horses", "pony", "mare"]);
define(C.WOLF, ["wolf", "wolves", "dog", "dogs"]);
define(C.VILLAGER, ["villager", "villagers"]);

// --- jobs -----------------------------------------------------------------
define(C.J_MINER, ["miner", "miners"]);
define(C.J_BUILDER, ["builder", "builders", "mason", "masons", "carpenter"]);
define(C.J_FARMER, ["farmer", "farmers", "shepherd"]);
define(C.J_GUARD, ["sentinel", "guards", "soldier", "warrior", "defender"]);
define(C.J_SMITH, ["blacksmith", "smiths"]);
define(C.J_SCOUT, ["scout", "scouts", "ranger", "explorer", "pathfinder"]);
define(C.J_WOODCUTTER, ["woodcutter", "woodcutters", "lumberjack", "logger", "forester"]);
define(C.J_HAULER, ["hauler", "haulers", "porter", "carrier", "courier"]);
define(C.J_ARCHITECT, ["architect", "architects", "planner", "designer"]);
define(C.J_SETTLER, ["settler", "settlers", "labourer", "laborer", "generalist"]);

// --- directions and places ------------------------------------------------
define(C.NORTH, ["north", "northward", "northern"]);
define(C.SOUTH, ["south", "southward", "southern"]);
define(C.EAST, ["east", "eastward", "eastern"]);
define(C.WEST, ["west", "westward", "western"]);
define(C.UP, ["up", "upward", "upwards", "above", "higher", "climb"]);
define(C.DOWN, ["down", "below", "beneath", "under", "lower"]);
define(C.HERE, ["here", "there", "this", "that", "spot", "place"]);
define(C.HOME, ["home", "base", "camp-home"]);
define(C.TOWN, ["town", "village", "settlement", "city", "colony"]);
define(C.CAVE, ["cave", "caves", "cavern", "underground"]);
define(C.SURFACE, ["surface", "daylight", "topside", "overground"]);

// --- modifiers ------------------------------------------------------------
define(C.NEGATE, ["not", "dont", "never", "no", "cant", "wont", "stop", "quit", "cease"]);
define(C.QUESTION, ["what", "where", "who", "why", "how", "when", "which", "whats"]);
define(C.SELF, ["me", "myself", "my", "mine-possessive"]);
define(C.EVERYONE, ["everyone", "everybody", "all-of-you", "citizens", "team", "lads", "folks"]);
define(C.MORE, ["more", "another", "extra", "further", "additional"]);
define(C.NIGHT, ["night", "dark", "dusk", "evening", "nightfall"]);
define(C.AGAIN, ["again", "once-more", "anew"]);

/**
 * Ordinary English that is not in our lexicon.
 *
 * Spelling correction must never touch these. Without the guard, "have" is one
 * edit from "axe", "doing" from "dig" and "could" from "hold", so a perfectly
 * normal sentence acquires meanings nobody typed - which is how "have a rest"
 * came out as an order to chop wood.
 */
const REAL_WORDS = new Set([
  "have", "has", "had", "having", "does", "did", "was", "were",
  "am", "being", "got", "getting", "puts", "took", "taken",
  "came", "gave", "make", "made", "said", "says",
  "see", "saw", "seen", "look", "looks", "looking", "know", "knew", "known",
  "think", "thought", "like", "likes", "liked", "good", "bad", "best", "nice",
  "most", "less", "much", "very", "really", "quite", "too", "also",
  "over", "near", "far", "front", "side", "left", "right",
  "into", "onto", "out", "off", "through", "across", "along", "past",
  "everything", "something", "nothing", "anything", "someone", "anyone",
  "once", "time", "times", "day", "today", "soon", "later", "while",
  "please", "thanks", "thank", "sorry", "yes", "yeah", "nope", "nah",
  "could", "should", "would", "might", "must", "shall",
  "them", "they", "him", "her", "his", "hers", "their", "whom", "whose",
  "both", "each", "every", "other", "same", "own", "new",
  "old", "big", "small", "long", "short", "high", "low", "first", "last",
  "next", "little", "lot", "bit", "way", "thing", "things", "guy", "guys",
  "man", "men", "people", "person", "friend", "friends", "names",
  "hello", "hi", "bye", "sure", "maybe", "well", "still", "even", "ever",
  "keep", "keeps", "kept", "leave", "leaves", "left", "let", "lets",
  "much", "many", "sort", "kind", "type", "such", "than", "because", "since",
  "before", "after", "until", "unless", "though", "although", "however",
]);

// Words that carry no meaning for us but often surround the ones that do.
const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "for", "and", "or", "but", "please", "pls", "plz",
  "could", "would", "can", "will", "should", "you", "your", "we", "us", "our",
  "is", "are", "be", "been", "go", "goes", "going", "gone", "just", "some",
  "any", "it", "its", "at", "on", "in", "with", "from", "by",
  "hey", "ok", "okay", "now", "then", "so", "if", "about", "abt", "lets",
  "yo", "oi", "alright", "right", "gimme", "em",
]);

const CONTRACTIONS = {
  "don't": "dont", "can't": "cant", "won't": "wont", "isn't": "isnt",
  "doesn't": "does not", "didn't": "did not", "shouldn't": "should not",
  "i'd": "i would", "i'll": "i will", "we'll": "we will", "let's": "lets",
  "you're": "you are", "what's": "what is", "that's": "that is",
  "gimme": "give me", "gonna": "going to", "wanna": "want to",
  "lemme": "let me", "outta": "out of", "kinda": "kind of",
  "all of you": "everyone", "pick up": "take", "go to": "goto",
  "light up": "illuminate", "set up": "build", "put down": "place",
  "shut up": "quiet", "get up": "wake", "lie down": "sleep",
  "once more": "again", "come back": "return", "head back": "return",
};

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 64,
  couple: 2, few: 3, several: 5, dozen: 12, lots: 32, many: 32, stack: 64,
  half: 32, handful: 5, pile: 32, load: 32,
};

// --------------------------------------------------------------------------
// Pipeline
// --------------------------------------------------------------------------
export function normalise(text) {
  let s = String(text || "").toLowerCase();
  for (const [from, to] of Object.entries(CONTRACTIONS)) s = s.split(from).join(to);
  // Coordinates may be negative, so a minus sign attached to a digit survives.
  return s.replace(/[^a-z0-9'\s-]/g, " ").replace(/\s+/g, " ").trim();
}

export function tokenise(text) {
  return normalise(text).split(" ").filter(Boolean);
}

/**
 * Candidate stems for a token, most specific first. Generating several and
 * testing each against the lexicon beats one clever stemmer: "mining" tries
 * "mining", "minin", "mine", "min" and stops at the first that means something.
 */
export function stems(token) {
  const out = [token];
  const push = (s) => { if (s.length >= 2 && !out.includes(s)) out.push(s); };

  if (token.endsWith("ies")) push(token.slice(0, -3) + "y");
  if (token.endsWith("es")) push(token.slice(0, -2));
  if (token.endsWith("s")) push(token.slice(0, -1));
  if (token.endsWith("ing")) {
    const base = token.slice(0, -3);
    push(base);
    push(base + "e");
    if (/(.)\1$/.test(base)) push(base.slice(0, -1));   // "digging" -> "dig"
  }
  if (token.endsWith("ed")) {
    const base = token.slice(0, -2);
    push(base);
    push(base + "e");
    if (/(.)\1$/.test(base)) push(base.slice(0, -1));
  }
  if (token.endsWith("er")) push(token.slice(0, -2));
  return out;
}

/**
 * Damerau-Levenshtein distance, with an early exit at `max`.
 *
 * Plain Levenshtein charges two edits for swapping adjacent letters, which is
 * wrong for this job: transposition is the most common typing mistake there is,
 * and "wodo", "mien" and "irno" are all one slip of the fingers from "wood",
 * "mine" and "iron". Counting a swap as one edit lets those through while
 * keeping the threshold tight enough that genuinely different words do not
 * match.
 */
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;

  let twoAgo = null;
  let prev = new Array(m + 1);
  let curr = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;

  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    let best = curr[0];
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      // adjacent transposition
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoAgo[j - 2] + 1);
      }
      curr[j] = value;
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    twoAgo = prev;
    prev = curr;
    curr = new Array(m + 1);
  }
  return prev[m];
}

/**
 * Words the player has taught this world, e.g. "gogo" -> "mine iron".
 * Checked before the lexicon so a taught phrase always wins.
 */
const TAUGHT = new Map();

export function teach(phrase, meaning) {
  const key = normalise(phrase);
  if (!key || !String(meaning || "").trim()) return false;
  TAUGHT.set(key, String(meaning).trim());
  return true;
}

export function unteach(phrase) { return TAUGHT.delete(normalise(phrase)); }
export function taught() { return [...TAUGHT.entries()].map(([k, v]) => ({ phrase: k, meaning: v })); }
export function loadTaught(entries) {
  TAUGHT.clear();
  for (const e of entries || []) if (e && e.phrase) TAUGHT.set(e.phrase, e.meaning);
}

/** Rewrites any taught phrase found in the text into what it was taught to mean. */
export function applyTaught(text) {
  let s = normalise(text);
  if (!TAUGHT.size) return s;
  // Longest phrase first, so "big dig" beats "dig".
  const keys = [...TAUGHT.keys()].sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (!k) continue;
    const re = new RegExp(`(^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`, "g");
    s = s.replace(re, `$1${TAUGHT.get(k)}$2`);
  }
  return s.replace(/\s+/g, " ").trim();
}

/** Concepts for one token: exact stem first, then a spelling-tolerant search. */
export function conceptsFor(token) {
  for (const stem of stems(token)) {
    const hit = LEXICON.get(stem);
    if (hit) return { concepts: hit, exact: true, matched: stem };
  }
  if (token.length < 4) return { concepts: [], exact: true, matched: null };

  // Only correct words we do not recognise as ordinary English. A real word is
  // a real word, however close it sits to something in the lexicon.
  if (REAL_WORDS.has(token) || STOPWORDS.has(token)) {
    return { concepts: [], exact: true, matched: null };
  }

  // Typo tolerance: "wodo" -> "wood", "mien" -> "mine", "irno" -> "iron".
  // Short words get one edit; two edits on a five-letter word is a guess, not
  // a correction.
  const maxDist = token.length >= 6 ? 2 : 1;
  let best = null, bestDist = maxDist + 1;
  for (const key of LEXICON.keys()) {
    if (Math.abs(key.length - token.length) > maxDist) continue;
    const d = editDistance(token, key, maxDist);
    if (d < bestDist) { bestDist = d; best = key; if (d === 1) break; }
  }
  if (best && bestDist <= maxDist) {
    return { concepts: LEXICON.get(best), exact: false, matched: best, distance: bestDist };
  }
  return { concepts: [], exact: true, matched: null };
}

/** Numbers, as digits or words, including "a few" and "a stack". */
export function extractQuantity(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      if (n > 0 && n <= 4096) return Math.min(n, 512);
    }
    if (NUMBER_WORDS[t] !== undefined) return NUMBER_WORDS[t];
    // "a few", "a couple"
    if (t === "a" && tokens[i + 1] && NUMBER_WORDS[tokens[i + 1]] !== undefined) {
      return NUMBER_WORDS[tokens[i + 1]];
    }
  }
  return null;
}

const DISTANCE_UNITS = new Set(["block", "blocks", "pace", "paces", "step", "steps",
  "metre", "metres", "meter", "meters", "m", "tile", "tiles", "square", "squares"]);

/** "20 blocks east" / "within 30 blocks" -> a number of blocks. */
function extractDistance(tokens) {
  for (let i = 1; i < tokens.length; i++) {
    if (!DISTANCE_UNITS.has(tokens[i])) continue;
    const before = tokens[i - 1];
    if (/^\d+$/.test(before)) return Math.min(Number(before), 256);
    if (NUMBER_WORDS[before] !== undefined) return NUMBER_WORDS[before];
  }
  return null;
}

/**
 * Three numbers in a row are coordinates - "go to 120 64 -30". Two are read as
 * x and z, because that is how people give a spot on the ground.
 */
function extractCoords(tokens) {
  const nums = [];
  for (let i = 0; i < tokens.length; i++) {
    if (/^-?\d+$/.test(tokens[i])) nums.push({ v: Number(tokens[i]), i });
    else if (nums.length && nums[nums.length - 1].i !== i - 1) nums.length = 0;
  }
  if (nums.length >= 3) {
    const [a, b, c] = nums.slice(-3);
    return { x: a.v, y: b.v, z: c.v };
  }
  if (nums.length === 2 && (nums[0].v < -64 || nums[0].v > 320 || nums[1].v < -64 || nums[1].v > 320)) {
    return { x: nums[0].v, y: null, z: nums[1].v };
  }
  return null;
}

/**
 * Which concepts fall inside the scope of a negation.
 *
 * "don't follow me" must not mean follow. A negator covers the rest of the
 * clause, up to a comma or a coordinating conjunction.
 */
function negatedIndices(tokens, analysed) {
  const negated = new Set();
  let active = false;
  for (let i = 0; i < tokens.length; i++) {
    const concepts = analysed[i]?.concepts || [];
    // "stop" is both a negator and an action; treat a bare "stop" at the start
    // as the action, and "stop mining" as negating the rest.
    const isNegator = concepts.includes(C.NEGATE);
    if (isNegator) {
      const laterAction = analysed.slice(i + 1).some((a) => a && a.concepts.some(isActionConcept));
      if (laterAction) { active = true; continue; }
    }
    if (/^(and|then|also|but)$/.test(tokens[i])) active = false;
    if (active) negated.add(i);
  }
  return negated;
}

const ACTIONS = new Set([
  C.MINE, C.CHOP, C.FARM, C.PLANT, C.HARVEST, C.BUILD, C.PLACE, C.CLEAR,
  C.TUNNEL, C.BRIDGE, C.LIGHTUP, C.FOLLOW, C.COME, C.GOTO, C.RETURN, C.STAY,
  C.GUARD, C.DEFEND, C.ATTACK, C.HUNT, C.FLEE, C.EXPLORE, C.REST, C.SLEEP,
  C.STORE, C.FETCH, C.CRAFT, C.SMELT, C.GIVE, C.DROP, C.TAKE, C.EQUIP,
  C.GATHER, C.SAY, C.EMOTE, C.GUARD,
]);
const isActionConcept = (c) => ACTIONS.has(c);

const RESOURCE_CONCEPTS = [
  C.DIAMOND, C.EMERALD, C.GOLD, C.IRON, C.COAL, C.COPPER, C.REDSTONE, C.LAPIS,
  C.QUARTZ, C.OBSIDIAN, C.WOOD, C.STONE, C.CLAY, C.GRAVEL, C.SAND, C.DIRT,
  C.SNOW, C.ICE, C.WOOL, C.SEEDS, C.ORE,
];
const STRUCTURE_CONCEPTS = [
  C.HOUSE, C.STOREHOUSE, C.WORKSHOP, C.WELL, C.FIELD, C.TOWER,
  C.WALL, C.ROAD, C.LAMP, C.HALL, C.SHRINE, C.CAMP,
];
const CREATURE_CONCEPTS = [
  C.ZOMBIE, C.SKELETON, C.CREEPER, C.SPIDER, C.ENDERMAN, C.WITCH, C.SLIME,
  C.HOSTILE, C.COW, C.PIG, C.SHEEP, C.CHICKEN, C.HORSE, C.WOLF, C.VILLAGER,
  C.ANIMAL,
];
const ITEM_CONCEPTS = [
  C.TORCH, C.PICKAXE, C.AXE, C.SWORD, C.SHOVEL, C.HOE, C.ARMOUR, C.CHEST,
  C.FURNACE, C.TABLE, C.BED, C.DOOR, C.LADDER, C.BOAT, C.BUCKET, C.STICK,
];
const JOB_CONCEPTS = {
  [C.J_MINER]: "miner", [C.J_BUILDER]: "builder", [C.J_FARMER]: "farmer",
  [C.J_GUARD]: "guard", [C.J_SMITH]: "crafter", [C.J_SCOUT]: "scout",
  [C.J_WOODCUTTER]: "lumberjack", [C.J_HAULER]: "hauler",
  [C.J_ARCHITECT]: "architect", [C.J_SETTLER]: "settler",
};
const DIRECTION_CONCEPTS = {
  [C.NORTH]: "north", [C.SOUTH]: "south", [C.EAST]: "east", [C.WEST]: "west",
  [C.UP]: "up", [C.DOWN]: "down",
};

// --------------------------------------------------------------------------
// Sentence -> reading
// --------------------------------------------------------------------------

/**
 * Full analysis of one sentence.
 * @returns {object} intent, confidence, and every slot the sentence filled
 */
export function understand(text) {
  const tokens = tokenise(applyTaught(text));
  const analysed = tokens.map(conceptsFor);
  const corrections = [];
  for (let i = 0; i < tokens.length; i++) {
    if (analysed[i].matched && !analysed[i].exact) {
      corrections.push({ from: tokens[i], to: analysed[i].matched });
    }
  }

  const negated = negatedIndices(tokens, analysed);
  const present = new Set();
  const negatedConcepts = new Set();
  for (let i = 0; i < tokens.length; i++) {
    for (const c of analysed[i].concepts) {
      if (negated.has(i)) negatedConcepts.add(c);
      else present.add(c);
    }
  }

  const raw = String(text || "");
  const question = present.has(C.QUESTION) || /\?\s*$/.test(raw);
  const quantity = extractQuantity(tokens);
  const distance = extractDistance(tokens);
  const coords = extractCoords(tokens);
  const resource = RESOURCE_CONCEPTS.find((c) => present.has(c)) || null;
  const structure = STRUCTURE_CONCEPTS.find((c) => present.has(c)) || null;
  const creature = CREATURE_CONCEPTS.find((c) => present.has(c)) || null;
  const item = ITEM_CONCEPTS.find((c) => present.has(c)) || null;
  const jobConcept = Object.keys(JOB_CONCEPTS).find((c) => present.has(c)) || null;
  const direction = Object.keys(DIRECTION_CONCEPTS).find((c) => present.has(c)) || null;

  const meaningful = tokens.filter((t, i) => !STOPWORDS.has(t) && analysed[i].concepts.length);
  const scores = scoreIntents({
    present, negatedConcepts, resource, structure, creature, item,
    jobConcept, direction, coords, distance, question, tokens, raw,
  });

  let intent = null, confidence = 0;
  for (const [name, score] of Object.entries(scores)) {
    if (score > confidence) { confidence = score; intent = name; }
  }
  // A single weak signal in a long sentence is probably a coincidence.
  if (confidence < 0.34) { intent = question ? "question" : null; }

  return {
    intent,
    confidence: Number(confidence.toFixed(2)),
    quantity,
    distance,
    coords,
    resource,
    structure,
    creature,
    item,
    job: jobConcept ? JOB_CONCEPTS[jobConcept] : null,
    direction: direction ? DIRECTION_CONCEPTS[direction] : null,
    everyone: present.has(C.EVERYONE),
    here: present.has(C.HERE),
    home: present.has(C.HOME) || present.has(C.TOWN),
    self: present.has(C.SELF),
    negated: negatedConcepts.size > 0,
    question,
    concepts: [...present],
    tokens,
    corrections,
    signals: meaningful.length,
    text: raw.trim(),
  };
}

function scoreIntents(f) {
  const { present, negatedConcepts, resource, structure, creature, item,
          jobConcept, direction, coords, distance, question, tokens, raw } = f;
  const has = (c) => present.has(c);
  const s = {};
  const add = (name, value) => { s[name] = Math.max(s[name] || 0, Math.min(1, value)); };

  // --- meta: teaching, help, repeating --------------------------------
  // Checked first because "learn that dig means mine iron" contains an action
  // that must not be run right now.
  if (has(C.TEACH) && / means | learn /.test(` ${normalise(raw)} `)) add("teach", 0.97);
  if (has(C.FORGET)) add("forget", 0.9);
  if (has(C.HELP) && !has(C.DEFEND)) add("help", 0.85);
  if (has(C.AGAIN) || has(C.REPEAT)) add("repeat", 0.8);

  // --- stopping ---------------------------------------------------------
  // A negated action is a request to stop doing it, which is why "don't follow
  // me" must never come out as follow.
  if (has(C.STOP) && !has(C.MINE) && !has(C.CHOP)) add("stop", 0.9);
  if (negatedConcepts.size && [...negatedConcepts].some(isActionConcept)) add("stop", 0.85);
  if (has(C.STAY)) add("stay", 0.88);

  // --- resource gathering -----------------------------------------------
  // Wood is chopped, everything else is mined - so the material decides the
  // verb even when the player says "mine wood".
  const wantsGathering = has(C.GATHER) || has(C.MINE) || has(C.CHOP) || has(C.HARVEST);
  if (resource === C.WOOD) add("chop", wantsGathering ? 0.95 : 0.6);
  else if (resource && resource !== C.SEEDS) {
    add("mine", wantsGathering ? 0.95 : 0.65);
  }
  if (has(C.MINE) && !resource) add("mine", 0.8);
  if (has(C.CHOP) && !resource) add("chop", 0.85);
  if (has(C.ORE)) add("mine", 0.85);

  // --- digging shapes ---------------------------------------------------
  if (has(C.DOWNWARD) || (has(C.MINE) && has(C.DOWN))) add("dig_down", 0.92);
  if (has(C.TUNNEL)) add("tunnel", 0.93);
  if (has(C.CLEAR)) add("clear", structure ? 0.6 : 0.9);
  if (has(C.BRIDGE)) add("bridge", 0.9);

  // --- building ---------------------------------------------------------
  if (has(C.BUILD) || structure) add("build", structure ? 0.9 : 0.7);
  if (has(C.PLACE) && (item || resource) && !has(C.BUILD)) add("place", 0.8);
  if (has(C.LIGHTUP) || (has(C.TORCH) && !has(C.CRAFT) && !has(C.GIVE))) add("light", 0.88);

  // --- farming ----------------------------------------------------------
  if (has(C.FARM) || resource === C.SEEDS) add("farm", 0.85);
  if (has(C.PLANT)) add("farm", 0.88);
  if (has(C.HARVEST) && !resource) add("farm", 0.8);

  // --- movement ---------------------------------------------------------
  if (has(C.FOLLOW)) add("follow", 0.9);
  if (has(C.COME)) add("come", has(C.SELF) ? 0.88 : 0.7);
  if (has(C.GOTO) && coords) add("goto", 0.95);
  if (coords && !has(C.BUILD)) add("goto", 0.8);
  if (has(C.GOTO) && direction && direction !== C.UP && direction !== C.DOWN) add("go_direction", 0.9);
  if (direction && distance && !has(C.MINE) && !has(C.TUNNEL)) add("go_direction", 0.85);
  if (has(C.RETURN)) add("go_home", 0.88);
  // "home" on its own is an order. Not when they are building one.
  if (has(C.HOME) && !has(C.BUILD) && !structure) add("go_home", has(C.GOTO) ? 0.88 : 0.8);
  if (has(C.SPREAD)) add("spread", 0.88);
  if (has(C.REGROUP)) add("regroup", 0.88);

  // --- combat -----------------------------------------------------------
  if (has(C.ATTACK)) add("attack", creature ? 0.95 : 0.85);
  if (has(C.HUNT)) add("hunt", 0.9);
  if (has(C.DEFEND)) add("defend", 0.9);
  if (has(C.GUARD)) add("guard", 0.9);
  if (has(C.FLEE)) add("flee", 0.88);
  // A named hostile with no verb is still a warning worth acting on.
  if (creature && !has(C.ATTACK) && !has(C.HUNT) && isHostile(creature) && !question) {
    add("attack", 0.55);
  }

  // --- items ------------------------------------------------------------
  if (has(C.CRAFT)) add("craft", item || resource ? 0.9 : 0.7);
  if (has(C.SMELT)) add("smelt", 0.88);
  if (has(C.GIVE) && (has(C.SELF) || item || resource)) add("give", 0.88);
  if (has(C.DROP)) add("drop", 0.85);
  if (has(C.STORE)) add("store", 0.88);
  if (has(C.FETCH)) add("fetch", 0.88);
  if (has(C.TAKE) && !has(C.GATHER)) add("take", 0.7);
  if (has(C.EQUIP)) add("equip", 0.88);
  if (has(C.INVENTORY)) add("inventory", 0.9);

  // --- life -------------------------------------------------------------
  if (has(C.REST)) add("rest", 0.8);
  if (has(C.SLEEP)) add("sleep", 0.88);
  if (has(C.WAKE)) add("wake", 0.85);
  if (has(C.FOOD) && !has(C.GIVE) && !has(C.STORE)) add("eat", 0.7);
  if (has(C.EXPLORE)) add("explore", 0.85);

  // --- social and identity ----------------------------------------------
  if (has(C.SAY)) add("say", 0.85);
  if (has(C.QUIET)) add("quiet", 0.9);
  if (has(C.EMOTE)) add("emote", 0.85);
  if (has(C.JOB) || jobConcept) add("set_job", jobConcept ? 0.9 : 0.6);
  if (has(C.RENAME)) add("rename", 0.85);
  if (has(C.FOUND)) add("found_town", 0.9);
  if (has(C.JOIN)) add("join_town", 0.85);
  if (has(C.STATUS)) add("status", 0.88);

  // A question about any of this is a question, not an order - except where
  // the question *is* the request. "What are you carrying?" wants the answer
  // the inventory intent already produces, not a shrug.
  if (question) {
    for (const k of Object.keys(s)) {
      if (!ANSWERABLE_QUESTIONS.has(k)) s[k] *= 0.45;
    }
    add("question", 0.6);
  }
  return s;
}

/** Intents that answer a question rather than being drowned out by one. */
const ANSWERABLE_QUESTIONS = new Set(["inventory", "status", "help", "teach", "forget"]);

const HOSTILES = new Set([C.ZOMBIE, C.SKELETON, C.CREEPER, C.SPIDER, C.ENDERMAN,
  C.WITCH, C.SLIME, C.HOSTILE]);
export const isHostile = (c) => HOSTILES.has(c);

// --------------------------------------------------------------------------
// Message -> several readings
// --------------------------------------------------------------------------

/**
 * Clause boundaries.
 *
 * "mine 20 iron then build a house" is two orders, not one confused one. Split
 * on sequencing words only - "and" alone is left attached unless what follows
 * clearly starts a new action, because "bread and butter" is one thing.
 */
export function splitClauses(text) {
  const s = normalise(applyTaught(text));
  if (!s) return [];
  const rough = s.split(/\s*(?:;|,?\s*(?:then|after that|afterwards|next up|followed by)\s+)/)
    .map((p) => p.trim()).filter(Boolean);

  const out = [];
  for (const part of rough) {
    // "and" splits only when the following words open with an action verb.
    const pieces = part.split(/\s+and\s+/);
    let buffer = pieces[0];
    for (let i = 1; i < pieces.length; i++) {
      // "and have a rest" is a new order even though it opens with "have";
      // look a few words in before deciding it is not.
      const head = pieces[i].split(/\s+/).filter((w) => !STOPWORDS.has(w)).slice(0, 3);
      const opensAction = head.some((w) => conceptsFor(w).concepts.some(isActionConcept));
      if (opensAction) { out.push(buffer.trim()); buffer = pieces[i]; }
      else buffer += ` and ${pieces[i]}`;
    }
    out.push(buffer.trim());
  }
  return out.filter(Boolean);
}

/**
 * Understand a whole message.
 * @returns {{readings: object[], text: string}} one reading per clause, in the
 *          order they were said, so they can be queued as a plan.
 */
export function parse(text) {
  const clauses = splitClauses(text);
  if (clauses.length <= 1) {
    const one = understand(text);
    return { readings: one.intent ? [one] : [], text: String(text || "").trim(), whole: one };
  }
  const readings = [];
  for (const clause of clauses) {
    const r = understand(clause);
    if (r.intent && r.intent !== "question") readings.push(r);
  }
  const whole = understand(text);
  // If splitting produced nothing usable, fall back to reading it as one thing.
  if (!readings.length && whole.intent) readings.push(whole);
  return { readings, text: String(text || "").trim(), whole };
}

// --------------------------------------------------------------------------
// Concept -> the ids the action layer works in
// --------------------------------------------------------------------------
export const RESOURCE_BLOCKS = {
  [C.IRON]: ["minecraft:iron_ore", "minecraft:deepslate_iron_ore"],
  [C.COAL]: ["minecraft:coal_ore", "minecraft:deepslate_coal_ore"],
  [C.DIAMOND]: ["minecraft:diamond_ore", "minecraft:deepslate_diamond_ore"],
  [C.GOLD]: ["minecraft:gold_ore", "minecraft:deepslate_gold_ore"],
  [C.COPPER]: ["minecraft:copper_ore", "minecraft:deepslate_copper_ore"],
  [C.REDSTONE]: ["minecraft:redstone_ore", "minecraft:deepslate_redstone_ore"],
  [C.LAPIS]: ["minecraft:lapis_ore", "minecraft:deepslate_lapis_ore"],
  [C.EMERALD]: ["minecraft:emerald_ore", "minecraft:deepslate_emerald_ore"],
  [C.QUARTZ]: ["minecraft:quartz_ore"],
  [C.OBSIDIAN]: ["minecraft:obsidian"],
  [C.STONE]: ["minecraft:stone", "minecraft:cobblestone", "minecraft:andesite",
              "minecraft:granite", "minecraft:diorite", "minecraft:deepslate"],
  [C.DIRT]: ["minecraft:dirt", "minecraft:grass_block", "minecraft:coarse_dirt"],
  [C.SAND]: ["minecraft:sand", "minecraft:red_sand", "minecraft:sandstone"],
  [C.GRAVEL]: ["minecraft:gravel"],
  [C.CLAY]: ["minecraft:clay"],
  [C.SNOW]: ["minecraft:snow", "minecraft:snow_layer"],
  [C.ICE]: ["minecraft:ice", "minecraft:packed_ice"],
  [C.WOOL]: ["minecraft:white_wool"],
  [C.GLASS]: ["minecraft:glass"],
};

export const STRUCTURE_IDS = {
  [C.HOUSE]: "small_house", [C.STOREHOUSE]: "storehouse", [C.WORKSHOP]: "workshop",
  [C.WELL]: "well", [C.FIELD]: "farm_plot", [C.TOWER]: "watchtower",
  [C.WALL]: "wall_segment", [C.ROAD]: "road_segment", [C.LAMP]: "lamp_post",
  [C.HALL]: "town_hall", [C.SHRINE]: "shrine", [C.CAMP]: "campfire",
};

/** Concept -> a craftable/placeable item id. */
export const ITEM_IDS = {
  [C.TORCH]: "minecraft:torch",
  [C.PICKAXE]: "minecraft:stone_pickaxe",
  [C.AXE]: "minecraft:stone_axe",
  [C.SWORD]: "minecraft:stone_sword",
  [C.SHOVEL]: "minecraft:stone_shovel",
  [C.HOE]: "minecraft:stone_hoe",
  [C.CHEST]: "minecraft:chest",
  [C.FURNACE]: "minecraft:furnace",
  [C.TABLE]: "minecraft:crafting_table",
  [C.DOOR]: "minecraft:oak_door",
  [C.LADDER]: "minecraft:ladder",
  [C.BOAT]: "minecraft:oak_boat",
  [C.BUCKET]: "minecraft:bucket",
  [C.STICK]: "minecraft:stick",
  [C.BED]: "minecraft:red_bed",
  [C.WOOD]: "minecraft:oak_planks",
  [C.STONE]: "minecraft:cobblestone",
  [C.GLASS]: "minecraft:glass",
  [C.IRON]: "minecraft:iron_ingot",
  [C.GOLD]: "minecraft:gold_ingot",
  [C.COAL]: "minecraft:coal",
  [C.DIAMOND]: "minecraft:diamond",
  [C.EMERALD]: "minecraft:emerald",
  [C.COPPER]: "minecraft:copper_ingot",
  [C.FOOD]: "minecraft:bread",
  [C.SEEDS]: "minecraft:wheat_seeds",
  [C.DIRT]: "minecraft:dirt",
  [C.SAND]: "minecraft:sand",
};

/** Concept -> the entity ids to look for in the world. */
export const CREATURE_IDS = {
  [C.ZOMBIE]: ["minecraft:zombie", "minecraft:husk", "minecraft:drowned", "minecraft:zombie_villager"],
  [C.SKELETON]: ["minecraft:skeleton", "minecraft:stray"],
  [C.CREEPER]: ["minecraft:creeper"],
  [C.SPIDER]: ["minecraft:spider", "minecraft:cave_spider"],
  [C.ENDERMAN]: ["minecraft:enderman"],
  [C.WITCH]: ["minecraft:witch"],
  [C.SLIME]: ["minecraft:slime", "minecraft:magma_cube"],
  [C.COW]: ["minecraft:cow", "minecraft:mooshroom"],
  [C.PIG]: ["minecraft:pig"],
  [C.SHEEP]: ["minecraft:sheep"],
  [C.CHICKEN]: ["minecraft:chicken"],
  [C.HORSE]: ["minecraft:horse", "minecraft:donkey"],
  [C.WOLF]: ["minecraft:wolf"],
  [C.VILLAGER]: ["minecraft:villager_v2", "minecraft:villager"],
};

/** Unit vector for a compass word, for "go 30 blocks east". */
export const DIRECTION_VECTORS = {
  north: { x: 0, z: -1 }, south: { x: 0, z: 1 },
  east: { x: 1, z: 0 }, west: { x: -1, z: 0 },
};

export function lexiconSize() { return LEXICON.size; }
export function lexiconWords() { return [...LEXICON.keys()]; }
