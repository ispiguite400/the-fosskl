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

  // --- contests ---
  CHALLENGE: "CHALLENGE", RACE: "RACE", DUEL: "DUEL", MELEE: "MELEE",
  TOURNAMENT: "TOURNAMENT", CONTEST_BUILD: "CONTEST_BUILD", SCOREBOARD: "SCOREBOARD",
  WINNER: "WINNER", FIRST: "FIRST", VERSUS: "VERSUS", TEAM: "TEAM",
  BEAT: "BEAT", CALLOFF: "CALLOFF", PRIZE: "PRIZE",

  // --- terraforming and site work ---
  FLATTEN: "FLATTEN", FILL: "FILL", MOAT: "MOAT", PIT: "PIT", STAIRS: "STAIRS",
  ROOF: "ROOF", FENCE: "FENCE", PERIMETER: "PERIMETER", SEAL: "SEAL",
  HOLLOW: "HOLLOW", DOCK: "DOCK",

  // --- logistics ---
  SORT: "SORT", COUNT: "COUNT", SHARE: "SHARE", ARM: "ARM", COLLECT: "COLLECT",
  SWAP: "SWAP",

  // --- conditions and scheduling ---
  WHEN: "WHEN", UNTIL: "UNTIL", ALWAYS: "ALWAYS", NEVER: "NEVER",
  MORNING: "MORNING", NOON: "NOON",

  // --- places ---
  NAMEPLACE: "NAMEPLACE", WAYPOINT: "WAYPOINT",

  // --- manner and voice ---
  VOICE: "VOICE", FASTER: "FASTER", SLOWER: "SLOWER", CAREFUL: "CAREFUL",
  LOUDER: "LOUDER", FUNNY: "FUNNY", SERIOUS: "SERIOUS", PIRATE: "PIRATE",
  POLITE: "POLITE",

  // --- group selectors ---
  HALF: "HALF", EACH: "EACH", NEAREST: "NEAREST", OTHERS: "OTHERS",

  // --- social ---
  PRAISE: "PRAISE", SCOLD: "SCOLD", STORY: "STORY", OPINION: "OPINION",
  INTRODUCE: "INTRODUCE",

  // --- questions about the town ---
  WHEREIS: "WHEREIS", BEST: "BEST", REPORT: "REPORT", HEADCOUNT: "HEADCOUNT",

  // --- more work ---
  REPAIR: "REPAIR", DEMOLISH: "DEMOLISH", SAPLING: "SAPLING", WATER_CROPS: "WATER_CROPS",
  TORCHLINE: "TORCHLINE", MEET: "MEET", WAITFOR: "WAITFOR", ESCORT: "ESCORT",
  SING: "SING", CELEBRATE: "CELEBRATE", COUNTOFF: "COUNTOFF",
  OPENDOOR: "OPENDOOR", CLOSEDOOR: "CLOSEDOOR", RESUME: "RESUME",
  ROADTO: "ROADTO", TUNNELTO: "TUNNELTO", GUARDPLACE: "GUARDPLACE", MAKEBED: "MAKEBED",
  DESCRIBE: "DESCRIBE", HURT: "HURT", TIME: "TIME", KEEPBACK: "KEEPBACK",

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
define(C.BUILD, ["build", "make", "makes", "making", "construct", "erect", "assemble", "raise", "rebuild"]);
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

// --- contests -------------------------------------------------------------
define(C.CHALLENGE, ["challenge", "challenges", "compete", "competition", "contest", "match", "bet", "wager"]);
define(C.RACE, ["race", "racing", "sprint", "dash", "footrace"]);
define(C.DUEL, ["duel", "duels", "spar", "sparring", "bout", "showdown", "one-on-one"]);
define(C.MELEE, ["melee", "brawl", "freeforall", "free-for-all", "scrap", "rumble"]);
define(C.TOURNAMENT, ["tournament", "tourney", "bracket", "championship", "league"]);
define(C.SCOREBOARD, ["scoreboard", "score", "scores", "standings", "leaderboard", "results"]);
define(C.WINNER, ["winner", "winning", "won", "champion", "victor", "leading"]);
define(C.FIRST, ["first", "fastest", "quickest", "soonest", "earliest"]);
define(C.VERSUS, ["versus", "vs", "against"]);
define(C.TEAM, ["teams", "side", "sides", "squad", "pair", "partner"]);
define(C.BEAT, ["beat", "outdo", "best-them", "defeat", "thrash"]);
define(C.CALLOFF, ["calloff", "callitoff", "abandon-contest"]);
define(C.PRIZE, ["prize", "reward", "stake", "stakes", "trophy"]);

// --- terraforming ---------------------------------------------------------
define(C.FLATTEN, ["flatten", "levelling", "leveling", "smooth", "even-out", "terrace"]);
define(C.FILL, ["fill", "plug", "backfill", "infill"]);
define(C.MOAT, ["moat", "ditch", "trench"]);
define(C.PIT, ["pit", "hole", "crater", "quarry-pit"]);
define(C.STAIRS, ["stairs", "steps", "stairway", "staircase"]);
define(C.ROOF, ["roof", "roofing", "ceiling", "canopy"]);
define(C.FENCE, ["fencing", "railing", "enclose", "enclosure", "pen"]);
define(C.PERIMETER, ["perimeter", "boundary", "border", "surround", "ring"]);
define(C.SEAL, ["seal", "block-up", "wall-off", "close-off", "barricade"]);
define(C.HOLLOW, ["hollow", "carve", "scoop"]);
define(C.DOCK, ["dock", "pier", "jetty", "harbour", "harbor", "wharf"]);

// --- logistics ------------------------------------------------------------
define(C.SORT, ["sort", "organise", "organize", "tidy", "arrange"]);
define(C.COUNT, ["count", "tally", "how-many", "stocktake"]);
define(C.SHARE, ["share", "split", "divide", "distribute", "deal-out"]);
define(C.ARM, ["arm-everyone", "equip-everyone", "kit", "outfit"]);
define(C.COLLECT, ["pickup", "scoop-up", "gather-drops"]);
define(C.SWAP, ["swap", "exchange", "trade-places", "switch"]);

// --- conditions -----------------------------------------------------------
define(C.WHEN, ["whenever", "everytime", "each-time"]);
define(C.UNTIL, ["until", "til", "till"]);
define(C.ALWAYS, ["always", "constantly", "forever", "permanently"]);
define(C.NEVER, ["never", "never-ever"]);
define(C.MORNING, ["morning", "dawn", "sunrise", "daybreak", "daylight"]);
define(C.NOON, ["noon", "midday", "afternoon"]);

// --- places ---------------------------------------------------------------
define(C.NAMEPLACE, ["nameplace", "mark", "marks", "bookmark", "pin", "note-this"]);
define(C.WAYPOINT, ["waypoint", "waypoints", "landmark", "landmarks", "places", "spots"]);

// --- manner ---------------------------------------------------------------
define(C.VOICE, ["voice", "accent", "tone", "manner"]);
define(C.FASTER, ["faster", "quicker", "hurry", "hustle", "quickly", "rush"]);
define(C.SLOWER, ["slower", "slowly", "steady-on", "careful-now"]);
define(C.CAREFUL, ["careful", "cautious", "safely", "mind-yourself"]);
define(C.LOUDER, ["louder", "shout-up", "speak-up"]);
define(C.FUNNY, ["funny", "funnier", "joke", "jokes", "amusing", "cheerful-voice"]);
define(C.SERIOUS, ["serious", "solemn", "grave", "businesslike"]);
define(C.PIRATE, ["pirate", "pirates", "buccaneer", "sailor-talk"]);
define(C.POLITE, ["polite", "politely", "manners", "courteous"]);

// --- group selectors ------------------------------------------------------
define(C.HALF, ["halve", "halves"]);
define(C.EACH, ["apiece", "individually", "one-each"]);
define(C.NEAREST, ["nearest", "closest", "nearby"]);
define(C.OTHERS, ["others", "rest", "remainder", "everyone-else"]);

// --- social ---------------------------------------------------------------
define(C.PRAISE, ["praise", "wellplayed", "proud", "brilliant", "excellent"]);
define(C.SCOLD, ["scold", "useless", "hopeless", "rubbish", "sloppy", "lazy"]);
define(C.STORY, ["story", "stories", "tale", "yarn", "legend"]);
define(C.OPINION, ["opinion", "think-of", "reckon-about"]);
define(C.INTRODUCE, ["introduce", "introductions", "meet-everyone"]);

// --- questions about the town --------------------------------------------
define(C.WHEREIS, ["whereis", "located", "whereabouts"]);
define(C.BEST, ["best", "strongest", "toughest", "hardest-working", "worst"]);
define(C.REPORT, ["report", "situation", "overview", "summary", "how-goes"]);
define(C.HEADCOUNT, ["headcount", "howmanyofus", "population"]);

// --- more work ------------------------------------------------------------
define(C.REPAIR, ["repair", "mend", "patch", "fix", "restore"]);
define(C.DEMOLISH, ["demolish", "teardown", "knockdown", "flatten-building"]);
define(C.SAPLING, ["planttrees", "reforest", "orchard"]);
define(C.WATER_CROPS, ["water", "irrigate", "watercrops"]);
define(C.TORCHLINE, ["torchline", "lightthepath", "torchtrail"]);
define(C.MEET, ["meet", "rendezvous", "meetup", "assemble-at"]);
define(C.WAITFOR, ["waitfor"]);
define(C.ESCORT, ["escortme"]);
define(C.SING, ["sing", "song", "sings", "singing", "chant"]);
define(C.CELEBRATE, ["party", "feast", "festival", "celebration"]);
define(C.COUNTOFF, ["countoff", "rollcall", "sound-off"]);
define(C.OPENDOOR, ["opendoor", "unbar"]);
define(C.ROADTO, ["roadto"]);
define(C.TUNNELTO, ["tunnelto"]);
define(C.GUARDPLACE, ["guardplace"]);
define(C.MAKEBED, ["makebed"]);
define(C.CLOSEDOOR, ["closedoor", "shutdoor", "bar-the-door"]);
define(C.RESUME, ["resume", "carryon", "asyouwere", "continue"]);
define(C.DESCRIBE, ["describe", "cansee", "whatssee", "lookaround"]);
define(C.HURT, ["hurt", "wounded", "injured", "bleeding", "health"]);
define(C.TIME, ["time", "oclock", "timeofday"]);
define(C.KEEPBACK, ["keepback", "standoff", "give-me-room"]);

// Tokens produced by the phrase table that need a meaning of their own.
define(C.CONTEST_BUILD, ["buildoff"]);
define(C.ARM, ["armeveryone"]);
define(C.SWAP, ["swapjobs"]);
define(C.COLLECT, ["pickup"]);

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

/**
 * Multi-word phrases, collapsed to one token before anything else looks at the
 * sentence.
 *
 * People do not say "melee", they say "fight each other". A lexicon of single
 * words cannot see that, and splitting on spaces destroys it, so the phrase is
 * rewritten first. Longest match wins, so "fight each other" beats "fight".
 */
const PHRASES = {
  // contests
  "fight each other": "melee", "fight it out": "melee", "free for all": "melee",
  "have a fight": "melee", "fight amongst yourselves": "melee",
  "one on one": "duel", "square off": "duel", "square up": "duel",
  "have a duel": "duel", "fight me": "duel",
  "first to": "first", "first one to": "first", "whoever gets": "first",
  "who can get": "first", "see who can": "first", "see who gets": "first",
  "race to": "race", "race me": "race", "race each other": "race",
  "build off": "buildoff", "build contest": "buildoff", "building contest": "buildoff",
  "who is winning": "scoreboard", "whos winning": "scoreboard",
  "who won": "scoreboard", "what is the score": "scoreboard",
  "call it off": "calloff", "call off": "calloff", "stop the contest": "calloff",
  "best of three": "tournament", "knockout": "tournament",
  "team up": "team", "split into teams": "team",
  "winner gets": "prize", "winner takes": "prize",

  // work
  "dig a moat": "moat", "dig a trench": "moat", "dig a pit": "pit",
  "dig a hole": "pit", "dig out": "hollow", "hollow out": "hollow",
  "wall off": "seal", "block up": "seal", "close off": "seal",
  "board up": "seal", "brick up": "seal",
  "level the ground": "flatten", "level out": "flatten", "even out": "flatten",
  "flatten out": "flatten", "clear and level": "flatten",
  "fill in": "fill", "fill the hole": "fill", "fill it in": "fill",
  "put a roof on": "roof", "roof it": "roof",
  "fence off": "fence", "fence in": "fence", "put a fence": "fence",
  "wall around": "perimeter", "all the way round": "perimeter",
  "cut steps": "stairs", "cut some stairs": "stairs",
  "strip mine": "tunnel", "branch mine": "tunnel",
  "dig down to": "downward", "dig straight down": "downward",
  "go get": "gather", "go and get": "gather", "fetch me": "gather",

  // items
  "bring me": "give", "hand over": "give", "hand me": "give",
  "pass me": "give", "give me": "give",
  "put away": "store", "take everything": "store", "empty your pockets": "store",
  "drop everything": "store", "stash it": "store",
  "pick up": "take", "pick it up": "take", "collect the drops": "pickup",
  "arm everyone": "armeveryone", "kit everyone out": "armeveryone",
  "give everyone": "share", "share out": "share", "split it": "share",
  "divide it up": "share", "hand them out": "share",
  "sort the chests": "sort", "sort out the chests": "sort", "tidy the chests": "sort",
  "how many": "count", "how much": "count",
  "swap jobs": "swapjobs", "trade places": "swapjobs",

  // movement and posture
  "stay close": "follow", "keep up": "follow", "stick with me": "follow",
  "come back": "return", "head back": "return", "get back here": "return",
  "wait here": "stay", "wait there": "stay", "hold position": "stay",
  "stand still": "stay", "stay put": "stay", "dont move": "stay",
  "hold on": "stop", "knock it off": "stop", "that is enough": "stop",
  "pack it in": "stop", "leave it": "stop", "drop it": "stop",
  "back off": "flee", "get out of there": "flee", "run for it": "flee",
  "leg it": "flee", "get clear": "flee",
  "spread out": "spread", "fan out": "spread",
  "get together": "regroup", "gather round": "regroup", "form up": "regroup",
  "line up": "regroup",

  // combat
  "look after": "defend", "watch my back": "defend", "cover me": "defend",
  "keep watch": "guard", "stand guard": "guard", "on guard": "guard",
  "keep an eye out": "guard", "keep an eye on": "defend",
  "stay near": "defend", "stick close to": "defend",
  "take it down": "attack", "deal with": "attack", "get rid of": "attack",
  "go for": "attack",

  // life
  "get some sleep": "sleep", "turn in": "sleep", "lie down": "sleep",
  "get up": "wake", "wake up": "wake", "rise and shine": "wake",
  "have a rest": "rest", "take a break": "rest", "sit down": "rest",
  "something to eat": "eat", "get some food": "eat", "have a bite": "eat",

  // social
  "well done": "praise", "good job": "praise", "nice work": "praise",
  "good work": "praise", "thank you": "praise", "thanks": "praise",
  "not good enough": "scold", "do better": "scold", "thats rubbish": "scold",
  "tell me a story": "story", "tell us a story": "story",
  "what do you think of": "opinion", "how do you feel about": "opinion",
  "talk like a pirate": "pirate", "be a pirate": "pirate",
  "be funnier": "funny", "be more serious": "serious", "be serious": "serious",
  "speak less": "quiet", "talk less": "quiet", "pipe down": "quiet",
  "speak up": "louder", "talk more": "louder",
  "from now on": "always", "every time": "whenever", "each morning": "morning",
  "when it gets dark": "night", "at night": "night", "when night falls": "night",
  "at dawn": "morning", "in the morning": "morning",
  "keep going until": "until", "carry on until": "until", "keep at it": "always",

  // places
  "call this place": "nameplace", "call this spot": "nameplace",
  "name this place": "nameplace", "mark this spot": "nameplace",
  "remember this place": "nameplace", "remember this spot": "nameplace",
  "name this spot": "nameplace", "name this area": "nameplace",
  "call this area": "nameplace", "call this the": "nameplace",
  "this place is": "nameplace", "this is the": "nameplace",

  // more work
  "plant trees": "planttrees", "plant some trees": "planttrees",
  "plant saplings": "planttrees", "grow some trees": "planttrees",
  "water the crops": "watercrops", "water the field": "watercrops",
  "tear down": "teardown", "knock down": "knockdown", "pull down": "teardown",
  "torches every": "torchline", "light the path": "lightthepath",
  "light the way": "lightthepath", "torch the tunnel": "torchtrail",
  "meet at": "meet", "meet me at": "meet", "gather at": "meet",
  "everyone to": "meet", "assemble at": "meet",
  "wait for": "waitfor", "hang on for": "waitfor",
  "escort me": "escortme", "walk me": "escortme", "come with me": "escortme",
  "sing a song": "sing", "sing us": "sing",
  "have a party": "party", "throw a party": "party",
  "count off": "countoff", "roll call": "rollcall",

  // doors and odds and ends
  "open the door": "opendoor", "open the gate": "opendoor",
  "close the door": "closedoor", "shut the door": "closedoor",
  "shut the gate": "closedoor", "bar the door": "closedoor",
  "carry on": "carryon", "as you were": "asyouwere", "back to work": "carryon",
  "what can you see": "cansee", "what do you see": "cansee",
  "look around": "lookaround", "anything out there": "cansee",
  "are you hurt": "hurt", "are you ok": "hurt", "are you alright": "hurt",
  "how is your health": "health",
  "what time is it": "timeofday", "is it night": "timeofday",
  "keep back": "keepback", "stand back": "keepback", "give me room": "keepback",
  "make me a bed": "makebed", "set up a bed": "makebed", "build me a bed": "makebed",
  "build a road to": "roadto", "make a road to": "roadto", "path to": "roadto",
  "tunnel to": "tunnelto", "dig to": "tunnelto",
  "guard the": "guardplace",

  // questions
  "where is": "whereis", "wheres": "whereis", "where has": "whereis",
  "how many of us": "howmanyofus", "how many are we": "howmanyofus",
  "how many citizens": "howmanyofus", "how is the town": "report",
  "how are things": "report", "how goes it": "report",
  "who is the best": "best", "whos the best": "best",
  "who is the worst": "best", "whats it like": "report",

  // groups
  "all of the": "all", "every one of you": "everyone", "the rest of you": "others",
  "half of you": "half", "the nearest one": "nearest",
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
/** Phrase keys, longest first, so the most specific match is taken. */
const PHRASE_KEYS = Object.keys(PHRASES).sort((a, b) => b.length - a.length);

export function normalise(text) {
  let s = String(text || "").toLowerCase();
  for (const [from, to] of Object.entries(CONTRACTIONS)) s = s.split(from).join(to);
  // Punctuation goes before phrase matching, so "who's winning?" still matches.
  // Coordinates may be negative, so a minus sign attached to a digit survives.
  s = s.replace(/[^a-z0-9'\s-]/g, " ").replace(/\s+/g, " ").trim();
  for (const phrase of PHRASE_KEYS) {
    if (!s.includes(phrase)) continue;
    s = s.split(phrase).join(PHRASES[phrase]);
  }
  return s.replace(/\s+/g, " ").trim();
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

/**
 * Concepts for one token: exact stem first, then a spelling-tolerant search.
 *
 * `noCorrection` marks a token as a name. Names must never be corrected:
 * "Bramble" is two edits from "rumble", so without this guard naming a citizen
 * Bramble starts a brawl.
 */
export function conceptsFor(token, noCorrection = false) {
  for (const stem of stems(token)) {
    const hit = LEXICON.get(stem);
    if (hit) return { concepts: hit, exact: true, matched: stem };
  }
  if (token.length < 4 || noCorrection) {
    return { concepts: [], exact: true, matched: null };
  }

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

/** Words that introduce a name, so whatever follows them is not a typo. */
const NAMING_WORDS = new Set([
  "name", "named", "call", "called", "rename", "nameplace", "dub", "christen",
]);

/**
 * Which tokens are names rather than words, and how strongly.
 *
 * Two signals, and they deserve different treatment:
 *
 *   position   the words after "call" or "name" are a name whatever they look
 *              like, so they carry no meaning at all - otherwise "call him
 *              Rumble" starts a brawl, because a rumble is a real brawl
 *   capitals   a capital part-way through a sentence marks a proper noun. It
 *              only blocks *correction*: "call this place the Quarry" should
 *              still not be read as an order to quarry, but the word is doing
 *              ordinary work elsewhere, so its meaning is left alone.
 */
function nameMask(raw, tokens) {
  const blocked = new Array(tokens.length).fill(false);
  const noCorrect = new Array(tokens.length).fill(false);

  const rawWords = String(raw || "").split(/\s+/);
  const capitalised = new Set();
  for (let i = 1; i < rawWords.length; i++) {
    const word = rawWords[i].replace(/[^A-Za-z'-]/g, "");
    if (word.length > 1 && /^[A-Z][a-z]/.test(word)) capitalised.add(word.toLowerCase());
  }

  let naming = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (capitalised.has(tokens[i])) noCorrect[i] = true;
    if (naming > 0 && !STOPWORDS.has(tokens[i])) {
      blocked[i] = true;
      noCorrect[i] = true;
      naming -= 1;
    }
    if (NAMING_WORDS.has(tokens[i])) naming = 3;
  }
  return { blocked, noCorrect };
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
  // Handed over as often as they are eaten or sown.
  C.FOOD, C.SEEDS,
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
  const names = nameMask(text, tokens);
  const analysed = tokens.map((t, i) => (names.blocked[i]
    ? { concepts: [], exact: true, matched: null }
    : conceptsFor(t, names.noCorrect[i])));
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
    // "never fight" pushes the action into the negated set, and a caller that
    // wants to know *what* is being refused has to be able to see it.
    refused: [...negatedConcepts],
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
  // "go to Ada", "go to the quarry" - a destination the lexicon cannot know,
  // so score it low and let the planner look for a name it recognises.
  if (has(C.GOTO) && !coords) add("goto", 0.4);
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
  // "make" builds a house and crafts a pickaxe - the object decides which.
  if (has(C.BUILD) && item && !structure) add("craft", 0.92);
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

  // --- contests ---------------------------------------------------------
  // Checked with a high floor: "first to get 20 wood" contains an order to
  // gather, and the contest has to win over it or it becomes plain work.
  if (has(C.SCOREBOARD)) add("scoreboard", 0.95);
  if (has(C.CALLOFF)) add("contest_stop", 0.95);
  if (has(C.MELEE)) add("contest_melee", 0.96);
  if (has(C.TOURNAMENT)) add("contest_tournament", 0.96);
  if (has(C.DUEL)) add("contest_duel", 0.96);
  if (has(C.CONTEST_BUILD)) add("contest_build", 0.96);
  if (has(C.RACE)) add(coords || direction || has(C.HERE) ? "contest_race" : "contest_race", 0.94);

  // "first to ..." turns whatever follows into the thing being raced for.
  // It has to beat the plain work it describes: "first to get 20 wood" is a
  // race, and scoring it as an order to chop wood loses the whole point.
  if (has(C.FIRST) || has(C.CHALLENGE) || has(C.WINNER)) {
    if (has(C.ATTACK) || has(C.HUNT) || creature) add("contest_hunt", 0.98);
    else if (has(C.BUILD) || structure) add("contest_build", 0.98);
    else if (has(C.DOWNWARD) || (has(C.MINE) && has(C.DOWN))) add("contest_dig", 0.98);
    else if (resource) add("contest_gather", 0.98);
    else if (has(C.RACE) || has(C.GOTO) || coords) add("contest_race", 0.98);
    else if (has(C.CHALLENGE)) add("contest_melee", 0.9);
  }
  if (has(C.VERSUS) && !has(C.CHALLENGE)) add("contest_duel", 0.9);

  // --- terraforming and site work ---------------------------------------
  if (has(C.FLATTEN)) add("flatten", 0.92);
  if (has(C.FILL)) add("fill_hole", 0.9);
  if (has(C.MOAT)) add("moat", 0.93);
  if (has(C.PIT)) add("pit", 0.9);
  if (has(C.STAIRS)) add("stairs", 0.9);
  if (has(C.SEAL)) add("seal", 0.93);
  if (has(C.HOLLOW)) add("hollow", 0.9);
  if (has(C.PERIMETER) && (has(C.WALL) || has(C.BUILD) || has(C.FENCE))) add("perimeter", 0.93);
  else if (has(C.PERIMETER)) add("perimeter", 0.85);
  if (has(C.FENCE)) add("fence", 0.94);
  if (has(C.ROOF)) add("roof", 0.88);
  if (has(C.DOCK)) add("dock", 0.9);

  // --- logistics --------------------------------------------------------
  if (has(C.SORT)) add("sort_chests", 0.9);
  if (has(C.COUNT)) add("count_stock", 0.88);
  if (has(C.SHARE)) add("share_out", 0.9);
  if (has(C.ARM)) add("arm_everyone", 0.92);
  if (has(C.COLLECT)) add("collect_drops", 0.9);
  if (has(C.SWAP)) add("swap_jobs", 0.9);

  // --- manner and voice -------------------------------------------------
  if (has(C.PIRATE)) add("set_voice", 0.94);
  if (has(C.FUNNY)) add("set_voice", 0.9);
  if (has(C.SERIOUS)) add("set_voice", 0.9);
  if (has(C.POLITE)) add("set_voice", 0.88);
  if (has(C.LOUDER)) add("set_voice", 0.85);
  if (has(C.FASTER)) add("work_faster", 0.88);
  if (has(C.SLOWER) || has(C.CAREFUL)) add("work_careful", 0.88);

  // --- social -----------------------------------------------------------
  if (has(C.PRAISE)) add("praise", 0.92);
  if (has(C.SCOLD)) add("scold", 0.9);
  if (has(C.STORY)) add("story", 0.92);
  if (has(C.OPINION)) add("opinion", 0.9);
  if (has(C.INTRODUCE)) add("introduce", 0.9);

  // --- places -----------------------------------------------------------
  if (has(C.NAMEPLACE)) add("name_place", 0.95);
  if (has(C.WAYPOINT)) add("list_places", 0.85);

  // --- more work --------------------------------------------------------
  if (has(C.REPAIR)) add("repair", 0.9);
  if (has(C.DEMOLISH)) add("demolish", 0.92);
  if (has(C.SAPLING)) add("plant_trees", 0.94);
  if (has(C.WATER_CROPS)) add("water_crops", 0.92);
  if (has(C.TORCHLINE)) add("torch_line", 0.93);
  if (has(C.MEET)) add("meet_at", 0.92);
  if (has(C.WAITFOR)) add("wait_for", 0.92);
  if (has(C.ESCORT)) add("escort", 0.92);
  if (has(C.SING)) add("sing", 0.92);
  if (has(C.CELEBRATE)) add("celebrate", 0.92);
  if (has(C.COUNTOFF)) add("count_off", 0.92);
  if (has(C.OPENDOOR)) add("open_door", 0.93);
  if (has(C.CLOSEDOOR)) add("close_door", 0.93);
  if (has(C.RESUME)) add("resume", 0.9);
  if (has(C.DESCRIBE)) add("describe_view", 0.92);
  if (has(C.HURT)) add("health_check", 0.92);
  if (has(C.TIME)) add("time_check", 0.92);
  if (has(C.KEEPBACK)) add("keep_back", 0.9);
  if (has(C.ROADTO)) add("road_to", 0.95);
  if (has(C.TUNNELTO)) add("tunnel_to", 0.95);
  if (has(C.GUARDPLACE)) add("guard_place", 0.91);
  if (has(C.MAKEBED)) add("make_bed", 0.93);

  // --- questions about the town -----------------------------------------
  if (has(C.WHEREIS)) add("where_is", 0.92);
  if (has(C.BEST)) add("who_best", 0.94);
  if (has(C.REPORT) || (has(C.TOWN) && question)) add("town_report", 0.9);
  if (has(C.HEADCOUNT)) add("head_count", 0.92);

  // --- standing orders --------------------------------------------------
  // "when it gets dark, come home" is not an order to come home now.
  const conditional = has(C.WHEN) || (has(C.NIGHT) && !question) || has(C.MORNING)
    || has(C.ALWAYS) || /\bif\b/.test(normalise(raw));
  if (conditional && [...present].some(isActionConcept)) add("standing_order", 0.93);
  if (has(C.UNTIL) && [...present].some(isActionConcept)) add("until_order", 0.9);
  // "never fight" negates the very action it is about, so the action lands in
  // negatedConcepts rather than present - look in both.
  if (has(C.NEVER) && (
    [...present].some(isActionConcept) || [...negatedConcepts].some(isActionConcept))) {
    add("never_do", 0.92);
  }

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
/**
 * Intents a question mark does not weaken.
 *
 * Some are answers ("what are you carrying?"); the contests are orders that
 * happen to be phrased as questions - "who can get 20 wood first?" is a
 * challenge, not idle curiosity.
 */
const ANSWERABLE_QUESTIONS = new Set([
  "inventory", "status", "help", "teach", "forget",
  "scoreboard", "count_stock", "opinion", "story", "list_places",
  "where_is", "who_best", "town_report", "head_count",
  "describe_view", "health_check", "time_check",
  "contest_melee", "contest_duel", "contest_tournament", "contest_gather",
  "contest_race", "contest_dig", "contest_hunt", "contest_build",
  "contest_find", "contest_stop",
]);

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
