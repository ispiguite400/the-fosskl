/**
 * Understanding what a player actually said.
 *
 * This replaces a list of regular expressions, which failed in all the ways a
 * list of regular expressions does: it could not read "grab me sum wodo", it
 * had no idea what "32 cobblestone" meant, and - worst - "don't follow me" hit
 * the `follow` rule and made citizens follow.
 *
 * The pipeline here is small but it is a real one, and it runs entirely inside
 * the add-on with no network:
 *
 *   normalise -> tokenise -> stem -> look up concepts (fuzzy, for typos)
 *             -> scope negation -> extract quantities and slots
 *             -> score every intent -> pick a winner, with a confidence
 *
 * Nothing here is a language model. It is classical NLP, which is the right
 * tool for turning a short imperative sentence into a structured order, and it
 * fits in a script module that has to answer inside one game tick.
 */

// --------------------------------------------------------------------------
// Concepts
// --------------------------------------------------------------------------
export const C = {
  // actions
  MINE: "MINE", CHOP: "CHOP", FARM: "FARM", BUILD: "BUILD", FOLLOW: "FOLLOW",
  COME: "COME", STOP: "STOP", GUARD: "GUARD", ATTACK: "ATTACK",
  EXPLORE: "EXPLORE", REST: "REST", STORE: "STORE", CRAFT: "CRAFT",
  GIVE: "GIVE", GATHER: "GATHER",
  // resources
  WOOD: "WOOD", STONE: "STONE", IRON: "IRON", COAL: "COAL", DIAMOND: "DIAMOND",
  GOLD: "GOLD", COPPER: "COPPER", REDSTONE: "REDSTONE", LAPIS: "LAPIS",
  EMERALD: "EMERALD", DIRT: "DIRT", SAND: "SAND", FOOD: "FOOD", SEEDS: "SEEDS",
  ORE: "ORE",
  // structures
  HOUSE: "HOUSE", STOREHOUSE: "STOREHOUSE", WORKSHOP: "WORKSHOP", WELL: "WELL",
  FIELD: "FIELD", TOWER: "TOWER", WALL: "WALL", ROAD: "ROAD", LAMP: "LAMP",
  HALL: "HALL", SHRINE: "SHRINE", CAMP: "CAMP",
  // modifiers
  NEGATE: "NEGATE", QUESTION: "QUESTION", SELF: "SELF", HERE: "HERE",
};

/** stem -> concepts. One word may carry several (e.g. "logs" is wood). */
const LEXICON = new Map();

function define(concept, words) {
  for (const w of words) {
    const key = w.toLowerCase();
    if (!LEXICON.has(key)) LEXICON.set(key, []);
    if (!LEXICON.get(key).includes(concept)) LEXICON.get(key).push(concept);
  }
}

define(C.MINE, ["mine", "mining", "dig", "digging", "excavate", "quarry", "extract", "tunnel"]);
define(C.CHOP, ["chop", "cut", "fell", "axe", "lumber", "log", "logging", "timber"]);
define(C.FARM, ["farm", "farming", "plant", "sow", "harvest", "reap", "till", "crop", "crops", "grow"]);
define(C.BUILD, ["build", "construct", "make", "raise", "erect", "put", "place", "assemble", "create"]);
define(C.FOLLOW, ["follow", "accompany", "tag", "trail", "escort"]);
define(C.COME, ["come", "here", "approach", "over"]);
define(C.STOP, ["stop", "halt", "cease", "quit", "wait", "pause", "freeze", "hold", "abandon", "cancel"]);
define(C.GUARD, ["guard", "patrol", "defend", "protect", "watch", "sentry"]);
define(C.ATTACK, ["attack", "kill", "fight", "slay", "strike", "hit", "destroy"]);
define(C.EXPLORE, ["explore", "scout", "wander", "roam", "search", "survey", "map"]);
define(C.REST, ["rest", "sleep", "relax", "sit", "break", "nap"]);
define(C.STORE, ["store", "stash", "deposit", "chest", "storage", "unload"]);
define(C.CRAFT, ["craft", "forge", "smelt", "cook", "smith"]);
define(C.GIVE, ["give", "hand", "pass", "bring"]);
define(C.GATHER, ["gather", "collect", "get", "fetch", "grab", "find", "bring", "need", "want", "retrieve"]);

define(C.WOOD, ["wood", "wooden", "log", "logs", "timber", "tree", "trees", "oak", "birch", "spruce", "plank", "planks"]);
define(C.STONE, ["stone", "rock", "cobble", "cobblestone", "granite", "andesite", "diorite", "deepslate"]);
define(C.IRON, ["iron"]);
define(C.COAL, ["coal"]);
define(C.DIAMOND, ["diamond", "diamonds"]);
define(C.GOLD, ["gold", "golden"]);
define(C.COPPER, ["copper"]);
define(C.REDSTONE, ["redstone"]);
define(C.LAPIS, ["lapis"]);
define(C.EMERALD, ["emerald", "emeralds"]);
define(C.DIRT, ["dirt", "soil", "earth", "mud"]);
define(C.SAND, ["sand"]);
define(C.FOOD, ["food", "bread", "eat", "meal", "supper", "hungry"]);
define(C.SEEDS, ["seed", "seeds", "wheat"]);
define(C.ORE, ["ore", "ores", "mineral", "minerals"]);

define(C.HOUSE, ["house", "home", "cottage", "hut", "shelter", "cabin"]);
define(C.STOREHOUSE, ["storehouse", "warehouse", "granary", "depot"]);
define(C.WORKSHOP, ["workshop", "forge", "smithy", "workbench"]);
define(C.WELL, ["well"]);
define(C.FIELD, ["field", "farmland", "plot", "garden"]);
define(C.TOWER, ["tower", "watchtower", "lookout"]);
define(C.WALL, ["wall", "walls", "fence", "rampart"]);
define(C.ROAD, ["road", "path", "street"]);
define(C.LAMP, ["lamp", "light", "lights", "torch", "torches", "lantern"]);
define(C.HALL, ["hall", "townhall"]);
define(C.SHRINE, ["shrine", "temple", "altar"]);
define(C.CAMP, ["camp", "campfire", "fire"]);

define(C.NEGATE, ["not", "dont", "don't", "never", "stop", "no", "cant", "can't", "quit", "cease"]);
define(C.QUESTION, ["what", "where", "who", "why", "how", "when", "which"]);
define(C.SELF, ["me", "myself", "my", "i"]);
define(C.HERE, ["here", "there", "this", "that"]);

/**
 * Ordinary English that is not in our lexicon.
 *
 * Spelling correction must never touch these. Without the guard, "have" is one
 * edit from "axe", "doing" from "dig" and "could" from "hold", so a perfectly
 * normal sentence acquires meanings nobody typed - which is how "have a rest"
 * came out as an order to chop wood.
 */
const REAL_WORDS = new Set([
  "have", "has", "had", "having", "does", "did", "done", "doing", "was", "were",
  "am", "being", "get", "got", "getting", "put", "puts", "take", "took", "taken",
  "come", "came", "give", "gave", "make", "made", "made", "say", "said", "says",
  "see", "saw", "seen", "look", "looks", "looking", "know", "knew", "known",
  "think", "thought", "like", "likes", "liked", "good", "bad", "best", "nice",
  "more", "most", "less", "much", "very", "really", "quite", "too", "also",
  "over", "under", "near", "far", "back", "front", "side", "left", "right",
  "north", "south", "east", "west", "down", "into", "onto", "out", "off",
  "there", "where", "here", "everything", "something", "nothing", "anything",
  "one", "once", "time", "times", "day", "night", "today", "soon", "later",
  "mind", "minds", "please", "thanks", "thank", "sorry", "yes", "yeah", "nope",
  "could", "should", "would", "might", "must", "shall", "want", "wants",
  "them", "they", "him", "her", "his", "hers", "their", "who", "whom", "whose",
  "all", "both", "each", "every", "other", "another", "same", "own", "new",
  "old", "big", "small", "long", "short", "high", "low", "first", "last",
  "next", "little", "lot", "bit", "way", "thing", "things", "guy", "guys",
  "man", "men", "people", "person", "friend", "friends", "name", "names",
  "hello", "hi", "bye", "sure", "maybe", "well", "still", "even", "ever",
]);

// Words that carry no meaning for us but often surround the ones that do.
const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "for", "and", "or", "but", "please", "pls", "plz",
  "could", "would", "can", "will", "should", "you", "your", "we", "us", "our",
  "is", "are", "be", "been", "go", "goes", "going", "gone", "just", "some",
  "any", "it", "its", "at", "on", "in", "up", "down", "with", "from", "by",
  "hey", "ok", "okay", "now", "then", "so", "if", "about", "abt", "lets",
]);

const CONTRACTIONS = {
  "don't": "dont", "can't": "cant", "won't": "wont", "isn't": "isnt",
  "i'd": "i would", "i'll": "i will", "we'll": "we will", "let's": "lets",
  "gimme": "give me", "gonna": "going to", "wanna": "want to",
};

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 64,
  couple: 2, few: 3, several: 5, dozen: 12, lots: 32, many: 32, stack: 64,
};

// --------------------------------------------------------------------------
// Pipeline
// --------------------------------------------------------------------------
export function normalise(text) {
  let s = String(text || "").toLowerCase();
  for (const [from, to] of Object.entries(CONTRACTIONS)) s = s.split(from).join(to);
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
  C.MINE, C.CHOP, C.FARM, C.BUILD, C.FOLLOW, C.COME, C.GUARD, C.ATTACK,
  C.EXPLORE, C.REST, C.STORE, C.CRAFT, C.GIVE, C.GATHER,
]);
const isActionConcept = (c) => ACTIONS.has(c);

const RESOURCE_CONCEPTS = [
  C.WOOD, C.STONE, C.IRON, C.COAL, C.DIAMOND, C.GOLD, C.COPPER,
  C.REDSTONE, C.LAPIS, C.EMERALD, C.DIRT, C.SAND, C.SEEDS, C.ORE,
];
const STRUCTURE_CONCEPTS = [
  C.HOUSE, C.STOREHOUSE, C.WORKSHOP, C.WELL, C.FIELD, C.TOWER,
  C.WALL, C.ROAD, C.LAMP, C.HALL, C.SHRINE, C.CAMP,
];

/**
 * Full analysis of a sentence.
 * @returns {{intent, confidence, quantity, resource, structure, negated, question, concepts, tokens, corrections}}
 */
export function understand(text) {
  const tokens = tokenise(text);
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

  const question = present.has(C.QUESTION) || /\?\s*$/.test(String(text || ""));
  const quantity = extractQuantity(tokens);
  const resource = RESOURCE_CONCEPTS.find((c) => present.has(c)) || null;
  const structure = STRUCTURE_CONCEPTS.find((c) => present.has(c)) || null;

  const meaningful = tokens.filter((t, i) => !STOPWORDS.has(t) && analysed[i].concepts.length);
  const scores = scoreIntents({ present, negatedConcepts, resource, structure, question, tokens });

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
    resource,
    structure,
    negated: negatedConcepts.size > 0,
    question,
    concepts: [...present],
    tokens,
    corrections,
    signals: meaningful.length,
  };
}

function scoreIntents({ present, negatedConcepts, resource, structure, question, tokens }) {
  const has = (c) => present.has(c);
  const s = {};
  const add = (name, value) => { s[name] = Math.max(s[name] || 0, Math.min(1, value)); };

  // --- stopping ---------------------------------------------------------
  // A negated action is a request to stop doing it, which is why "don't follow
  // me" must never come out as follow.
  if (has(C.STOP) && !has(C.MINE) && !has(C.CHOP)) add("stop", 0.9);
  if (negatedConcepts.size && [...negatedConcepts].some(isActionConcept)) add("stop", 0.85);

  // --- resource gathering -----------------------------------------------
  // Wood is chopped, everything else is mined - so the material decides the
  // verb even when the player says "mine wood".
  const wantsGathering = has(C.GATHER) || has(C.MINE) || has(C.CHOP);
  if (resource === C.WOOD) add("chop", wantsGathering ? 0.95 : 0.6);
  else if (resource && resource !== C.SEEDS) {
    add("mine", wantsGathering ? 0.95 : 0.65);
  }
  if (has(C.MINE) && !resource) add("mine", 0.8);
  if (has(C.CHOP) && !resource) add("chop", 0.85);
  if (has(C.ORE)) add("mine", 0.85);

  // --- the rest ---------------------------------------------------------
  if (has(C.FARM) || resource === C.SEEDS) add("farm", 0.85);
  if (has(C.BUILD) || structure) add("build", structure ? 0.9 : 0.7);
  if (has(C.FOLLOW)) add("follow", 0.9);
  if (has(C.COME) && !has(C.BUILD)) add("come", has(C.SELF) ? 0.85 : 0.6);
  if (has(C.GUARD)) add("guard", 0.9);
  if (has(C.ATTACK)) add("attack", 0.9);
  if (has(C.EXPLORE)) add("explore", 0.85);
  if (has(C.REST)) add("rest", 0.8);
  if (has(C.STORE)) add("store", 0.85);
  if (has(C.CRAFT)) add("craft", 0.8);
  if (has(C.FOOD)) add("eat", 0.7);

  // A question about any of this is a question, not an order.
  if (question) {
    for (const k of Object.keys(s)) s[k] *= 0.45;
    add("question", 0.6);
  }
  return s;
}

/** Concept -> the block ids the action layer works in. */
export const RESOURCE_BLOCKS = {
  [C.IRON]: ["minecraft:iron_ore", "minecraft:deepslate_iron_ore"],
  [C.COAL]: ["minecraft:coal_ore", "minecraft:deepslate_coal_ore"],
  [C.DIAMOND]: ["minecraft:diamond_ore", "minecraft:deepslate_diamond_ore"],
  [C.GOLD]: ["minecraft:gold_ore", "minecraft:deepslate_gold_ore"],
  [C.COPPER]: ["minecraft:copper_ore", "minecraft:deepslate_copper_ore"],
  [C.REDSTONE]: ["minecraft:redstone_ore", "minecraft:deepslate_redstone_ore"],
  [C.LAPIS]: ["minecraft:lapis_ore", "minecraft:deepslate_lapis_ore"],
  [C.EMERALD]: ["minecraft:emerald_ore", "minecraft:deepslate_emerald_ore"],
  [C.STONE]: ["minecraft:stone", "minecraft:cobblestone", "minecraft:andesite", "minecraft:deepslate"],
  [C.DIRT]: ["minecraft:dirt", "minecraft:grass_block", "minecraft:coarse_dirt"],
  [C.SAND]: ["minecraft:sand"],
};

export const STRUCTURE_IDS = {
  [C.HOUSE]: "small_house", [C.STOREHOUSE]: "storehouse", [C.WORKSHOP]: "workshop",
  [C.WELL]: "well", [C.FIELD]: "farm_plot", [C.TOWER]: "watchtower",
  [C.WALL]: "wall_segment", [C.ROAD]: "road_segment", [C.LAMP]: "lamp_post",
  [C.HALL]: "town_hall", [C.SHRINE]: "shrine", [C.CAMP]: "campfire",
};

export function lexiconSize() {
  return LEXICON.size;
}
