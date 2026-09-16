/**
 * The local voice.
 *
 * This module handles conversation *plumbing* (who talks to whom, whose turn
 * it is) and is where every line a citizen speaks comes from.
 *
 * Two layers, tried in order:
 *
 *   1. `social/language.js` - a generative grammar. It composes the sentence
 *      word class by word class, weighted by the speaker's voice and mood, and
 *      rejects anything they have said in their last twelve lines. Hundreds of
 *      distinct sentences per topic, so they stop sounding like a sign post.
 *   2. The `LINES` bank below - fixed templates. Used for the topics the
 *      grammar has no frame for, and whenever the grammar cannot find a
 *      sentence the citizen has not just used.
 */
import { CONFIG } from "../core/config.js";
import { pick, weightedPick, prettyId, compass, titleCase, mulberry32, hashString } from "../core/util.js";
import { moodOf } from "../agent/needs.js";
import { trait, chattiness } from "../agent/personality.js";
import { highlight } from "../agent/perception.js";
import { relationshipWord, personRecord, pushDialogue } from "../agent/memory.js";
import { blueprintById } from "../civ/blueprints.js";
import { recomputeStats, nextStructureFor, TIERS } from "../civ/settlement.js";
import { compose, polish } from "./language.js";

// --------------------------------------------------------------------------
// Line banks. {slots} are filled from the context object.
// --------------------------------------------------------------------------
const LINES = {
  greeting: [
    "Morning, {other}.", "There you are, {other}.", "Good to see you, {other}.",
    "{other}. Still standing, then.", "Ah - {other}. Just the person.",
    "Hello, {other}. Busy day.",
  ],
  greeting_warm: [
    "{other}! Come here, you.", "Now there's a face worth seeing.",
    "{other} - I was hoping you'd come by.", "You always turn up at the right moment, {other}.",
  ],
  greeting_cold: [
    "{other}.", "You again.", "Hm. {other}.", "Keep your distance and we'll get along.",
  ],
  work: [
    "Back to it. This {job} work doesn't do itself.",
    "I've {work_done} today. Hands are aching.",
    "If I get this done before dark I'll call it a good day.",
    "{task_line}",
    "Another load and the stores will hold.",
  ],
  observation_ore: [
    "There's {block} in the rock over {dir} - I can see the seam from here.",
    "{block}. {dir} of us, about {dist} paces. That's worth digging.",
    "Look at that - {block}. We're eating well this month.",
  ],
  observation_hazard: [
    "Careful - {block} {dir} of here.",
    "Mind the {block} over {dir}. I nearly walked into it.",
    "Nobody go {dir}. There's {block} down there.",
  ],
  observation_animal: [
    "A {animal}, over there. Could be supper.",
    "Sheep and cattle about. Good sign for the pasture.",
    "That {animal} has been following me half the morning.",
  ],
  observation_weather: [
    "Sky's gone the colour of wet slate.",
    "Rain again. The fields will thank it, even if I don't.",
    "Storm coming. I'd get the tools inside.",
  ],
  observation_night: [
    "Light's going. I don't like being out past dusk.",
    "That's the sun gone. Torches, quickly.",
    "Night already. Where does the day go.",
  ],
  threat: [
    "{threat}! {dir} of us!", "Weapons - there's a {threat} coming!",
    "Get behind me. {threat}, {dist} paces {dir}.",
    "Not tonight. Not a {threat}.",
  ],
  threat_brave: [
    "One {threat}. I've handled worse before breakfast.",
    "Let it come. I'm not moving.",
    "Right. {threat}. Let's be quick about this.",
  ],
  hungry: [
    "I could eat a whole field.", "When did I last eat? Too long ago.",
    "My stomach's making more noise than my pickaxe.",
  ],
  tired: [
    "I need to sit down before I fall down.",
    "One more hour. Maybe two. Then I'm done.",
    "My legs have stopped listening to me.",
  ],
  lonely: [
    "Quiet out here. Too quiet.", "I've spoken to nobody but myself all day.",
    "Anyone about? No? Right then.",
  ],
  plan: [
    "We need {need} before anything else.",
    "The {structure} goes up next. I've decided.",
    "Give me a week and this place will have a proper {structure}.",
    "If we settle the {need} problem, everything else follows.",
  ],
  town_proud: [
    "{town} is starting to look like somewhere.",
    "Look at it. {town}. Two weeks ago this was empty ground.",
    "We've got {houses} roofs up now. That's not nothing.",
  ],
  town_worried: [
    "{town} won't last a hard winter like this.",
    "We're short on {need}. Badly short.",
    "I keep counting the stores and getting the same unhappy number.",
  ],
  smalltalk: [
    "{quirk_line}", "Strange thing about this place - the light, in the evenings.",
    "I keep meaning to ask you something and keep forgetting what.",
    "Do you ever think about where the rivers go?",
    "My hands know this work better than my head does.",
    "Someone ought to write this down. Might be worth remembering.",
  ],
  order_ack: [
    "Right. {order}.", "Consider it done.", "On my way.",
    "I'll see to it.", "{order}. Understood.", "Aye. Straight away.",
  ],
  order_refuse: [
    "I can't - not with what I'm carrying.",
    "That'll have to wait. {reason}.",
    "I would, but {reason}.",
  ],
  done: [
    "That's done.", "Finished. What's next?", "There - {task}.",
    "{task}. Took longer than I'd like.",
  ],
  found: [
    "This is the place. Good ground, water nearby. We build here.",
    "Here. I can feel it. This is where {town} starts.",
    "Flat enough, sheltered enough. Here.",
  ],
  farewell: [
    "I'll be about if you need me.", "Mind yourself out there.",
    "Right - back to work.", "Don't be a stranger, {other}.",
  ],
  answer_yes: ["Aye.", "Of course.", "That I can do.", "Certainly."],
  answer_no: ["No - not this time.", "I can't, sorry.", "Afraid not."],
  confused: [
    "Say that again? The wind took it.",
    "I don't follow, {other}.",
    "You'll have to be plainer than that with me.",
  ],
};

const VOICE_TWEAKS = {
  gruff: (s) => s.replace(/\bI would\b/g, "I'd").replace(/\. /g, ". "),
  wry: (s) => s,
  poetic: (s) => s,
  anxious: (s) => (s.endsWith(".") ? s.slice(0, -1) + "..." : s),
  cheerful: (s) => s,
};

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Which grammar frame covers a topic, and which register the situation asks
 * for. A topic with no entry here has no frame, and falls through to LINES.
 */
const FRAME_FOR = {
  greeting: ["greet", []],
  greeting_warm: ["greet", ["warm", "!gruff"]],
  greeting_cold: ["greet", ["gruff", "!warm"]],
  work: ["work", []],
  observation_ore: ["observe_ore", []],
  threat: ["observe_threat", ["anxious", "!brave"]],
  threat_brave: ["observe_threat", ["brave", "!anxious"]],
  plan: ["plan", []],
  smalltalk: ["smalltalk", []],
  order_ack: ["acknowledge", []],
  done: ["done", []],
  farewell: ["farewell", []],
  confused: ["confused", []],
};

/**
 * The grammar names some facts differently from the line bank, because it
 * talks about them differently ("a seam of {material}" vs "{block}").
 */
function grammarContext(ctx) {
  const out = { ...ctx };
  if (out.material === undefined && ctx.block !== undefined) out.material = ctx.block;
  // Never hand the grammar an empty string: it would leave a hole in the
  // sentence where a fallback word belongs.
  for (const key of Object.keys(out)) {
    if (out[key] === "" || out[key] === null) delete out[key];
  }
  return out;
}

/**
 * Produce one line of speech.
 * @param {Citizen} citizen
 * @param {string} topic key into FRAME_FOR / LINES (a `_` variant is chosen
 *                       automatically by the caller)
 * @param {object} ctx  slot values and world context
 */
export function lineFor(citizen, topic, ctx = {}) {
  const tweak = VOICE_TWEAKS[citizen.personality.voice];

  const frame = FRAME_FOR[topic];
  if (frame) {
    let mood = "steady";
    try { mood = moodOf(citizen); } catch { /* needs not initialised yet */ }
    const composed = compose(citizen, frame[0], grammarContext(ctx), mood, frame[1]);
    if (composed) return tweak ? tweak(composed) : composed;
  }

  const rnd = mulberry32(hashString(citizen.seed + topic + (ctx.salt || "") + Math.floor(Math.random() * 1e6)));
  const bank = LINES[topic] || LINES.smalltalk;
  const raw = pick(bank, rnd);
  const filled = polish(fillSlots(raw, citizen, ctx));
  return tweak ? tweak(filled) : filled;
}

function fillSlots(template, citizen, ctx) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    switch (key) {
      case "other": return ctx.other || "friend";
      case "job": return citizen.job;
      case "town": return ctx.town || "this place";
      case "need": return ctx.need || "food";
      case "structure": return ctx.structure || "storehouse";
      case "block": return ctx.block || "something";
      case "dir": return ctx.dir || "over there";
      case "dist": return String(ctx.dist ?? "a few");
      case "threat": return ctx.threat || "something";
      case "animal": return ctx.animal || "creature";
      case "order": return ctx.order || "that";
      case "reason": return ctx.reason || "my hands are full";
      case "task": return ctx.task || "the job";
      case "houses": return String(ctx.houses ?? 0);
      case "work_done": return ctx.workDone || "been at it";
      case "task_line": return ctx.taskLine || "Steady work, this.";
      case "quirk_line": return quirkLine(citizen);
      default: return "";
    }
  });
}

function quirkLine(citizen) {
  const q = citizen.personality.quirk;
  const map = {
    "counts things out loud": "Forty-one, forty-two... sorry. Habit.",
    "names the tools they use": "This pickaxe is called Nel. Don't laugh.",
    "always mentions the weather": "Air's heavy today. Something's coming.",
    "hums while working": "Hm-hm-hmm... oh, was I doing it again?",
    "keeps score of favours": "I still owe someone a day's work. I'll remember who.",
    "worries about the walls": "The east side's still open. That keeps me up.",
    "quotes their grandmother": "My grandmother used to say: build twice, cry once.",
    "is convinced the hill is haunted": "Something moves on that hill at night. I've seen it.",
    "collects odd stones": "Look at this one. Perfectly round. Perfectly useless.",
    "talks to the animals": "Morning, cow. No, she doesn't answer either.",
    "is saving up for a proper roof": "One day: slate. Proper slate. Not planks.",
    "never trusts a cave": "Caves take people. That's all I'll say.",
    "is writing everything down": "Hold still - I'm writing this down.",
    "insists on straight lines": "That wall is two degrees off. Two. I can see it.",
    "swears the sunsets are better here": "You won't get a sunset like that anywhere else.",
    "wants the town to have a name people remember": "A place needs a name people say twice.",
  };
  return map[q] || "Hm.";
}

// --------------------------------------------------------------------------
// Topic selection - what would this citizen naturally say right now?
// --------------------------------------------------------------------------
export function chooseTopic(citizen, ctx) {
  const snap = citizen.snapshot;
  const mood = moodOf(citizen);
  const options = [];

  if (snap && snap.threats.length && snap.threats[0].distance < 16) {
    options.push([trait(citizen, "bravery") > 0.65 ? "threat_brave" : "threat", 30]);
  }
  if (mood === "hungry") options.push(["hungry", 8]);
  if (mood === "exhausted") options.push(["tired", 8]);
  if (mood === "lonely") options.push(["lonely", 5]);

  const seen = snap ? highlight(snap) : null;
  if (seen) {
    if (seen.kind === "ore") options.push(["observation_ore", 9 * trait(citizen, "curiosity") + 3]);
    if (seen.kind === "hazard") options.push(["observation_hazard", 7]);
    if (seen.kind === "animal") options.push(["observation_animal", 4]);
    if (seen.kind === "weather") options.push(["observation_weather", 5]);
  }
  if (snap && snap.night) options.push(["observation_night", 4]);

  if (ctx.settlement) {
    const stats = recomputeStats(ctx.settlement);
    const struct = nextStructureFor(ctx.settlement);
    if (struct) options.push(["plan", 6]);
    if (stats.housing >= 3) options.push(["town_proud", 4]);
    if (ctx.shortage) options.push(["town_worried", 6]);
  }

  options.push(["work", 6]);
  options.push(["smalltalk", 4 + chattiness(citizen) * 6]);

  return weightedPick(options) || "smalltalk";
}

/** Slot values for the chosen topic, read off the current snapshot. */
export function contextFor(citizen, topic, ctx) {
  const snap = citizen.snapshot;
  const out = { ...ctx };
  const seen = snap ? highlight(snap) : null;

  if (topic.startsWith("observation_ore") && seen && seen.kind === "ore") {
    out.block = seen.subject.label;
    out.dir = seen.subject.direction;
    out.dist = seen.subject.distance;
  }
  if (topic === "observation_hazard" && seen && seen.kind === "hazard") {
    out.block = seen.subject.label;
    out.dir = seen.subject.direction;
  }
  if (topic === "observation_animal" && snap && snap.animals.length) {
    out.animal = snap.animals[0].kind;
  }
  if (topic.startsWith("threat") && snap && snap.threats.length) {
    out.threat = snap.threats[0].kind;
    out.dir = snap.threats[0].direction;
    out.dist = snap.threats[0].distance;
  }
  if (ctx.settlement) {
    out.town = ctx.settlement.name;
    const stats = recomputeStats(ctx.settlement);
    out.houses = stats.housing;
    const struct = nextStructureFor(ctx.settlement);
    if (struct) {
      const bp = blueprintById(struct.blueprintId);
      out.structure = bp ? bp.name : "building";
      out.need = sayableNeed(struct.need);
    }
  }
  if (citizen.task) out.taskLine = taskCommentary(citizen);
  return out;
}

/**
 * A settlement's need is a planning label - "housing", "requested", "ordered" -
 * and half of them are not things a person says they are short of. Anything
 * without a plain-English form is dropped rather than spoken, which is why
 * citizens no longer announce "it's ordered we're short of".
 */
const NEED_WORDS = {
  housing: "roofs", food: "food", water: "water", storage: "storage",
  crafting: "tools", safety: "light", defence: "walls", space: "space",
};

function sayableNeed(need) {
  return NEED_WORDS[String(need || "").toLowerCase()] || "space";
}

function taskCommentary(citizen) {
  const k = citizen.task?.kind;
  const map = {
    mine: "Rock's harder here than it looks.",
    gather: "Just a few more and I'm done.",
    build: "Line it up, set it straight, next one.",
    place: "There. That'll hold.",
    craft: "Measure, cut, fit. Same as always.",
    farm: "Soil's good. Better than I expected.",
    fight: "Stay back!",
    goto: "Not far now.",
    follow: "Right behind you.",
    store: "Heavy load, this.",
    explore: "Wonder what's over that ridge.",
    patrol: "All quiet. So far.",
    sleep: "...",
    eat: "That's better.",
  };
  return map[k] || "Steady work, this.";
}

// --------------------------------------------------------------------------
// Conversations between citizens
// --------------------------------------------------------------------------
export function canConverse(citizen, tick) {
  if (citizen.conversation) return false;
  if (tick - citizen.lastSpeechTick < CONFIG.speechCooldownTicks) return false;
  if (citizen.task && ["fight", "flee", "sleep"].includes(citizen.task.kind)) return false;
  return true;
}

export function startConversation(a, b, tick, ctx) {
  const turns = 2 + Math.floor(Math.random() * (CONFIG.conversationMaxTurns - 1));
  a.conversation = { withId: b.id, withName: b.short, turnsLeft: turns, lastTick: tick, initiator: true };
  b.conversation = { withId: a.id, withName: a.short, turnsLeft: turns, lastTick: tick, initiator: false };

  const rec = personRecord(a.memory, b.name);
  const topic = rec.affinity > 40 ? "greeting_warm" : rec.affinity < -20 ? "greeting_cold" : "greeting";
  return lineFor(a, topic, contextFor(a, topic, { ...ctx, other: b.short }));
}

export function replyLine(citizen, partner, ctx) {
  const topic = chooseTopic(citizen, ctx);
  return lineFor(citizen, topic, contextFor(citizen, topic, { ...ctx, other: partner.short }));
}

export function endConversation(citizen) {
  citizen.conversation = null;
}

export function farewellLine(citizen, otherName) {
  return lineFor(citizen, "farewell", { other: otherName });
}

/** A short, honest answer when a player says something we cannot parse. */
export function confusedLine(citizen, playerName) {
  return lineFor(citizen, "confused", { other: playerName });
}

export function acknowledge(citizen, orderText) {
  return lineFor(citizen, "order_ack", { order: shortenOrder(orderText) });
}

export function refuse(citizen, reason) {
  return lineFor(citizen, "order_refuse", { reason });
}

export function completionLine(citizen, taskLabel) {
  return lineFor(citizen, "done", { task: taskLabel });
}

function shortenOrder(text) {
  const t = String(text || "").trim();
  return t.length > 48 ? t.slice(0, 45) + "..." : t;
}

export { LINES };
