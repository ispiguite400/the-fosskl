/**
 * Orders that change the citizen rather than giving them a task.
 *
 * Changing trade, taking a new name, founding a town, learning a word: these
 * need the app, the registry or the world, none of which the brain can touch.
 * The brain describes what it wants as an `effect` and this performs it, which
 * keeps the planner testable without a running world.
 */
import { world } from "@minecraft/server";
import { safe } from "../core/log.js";
import { worldStore } from "../core/store.js";
import { titleCase } from "../core/util.js";
import { JOBS } from "../civ/jobs.js";
import { STATE } from "../agent/citizen.js";
import { activeOrder } from "../agent/memory.js";
import { dropItem, equipTool, summariseInventory } from "../actions/inventory.js";
import { toggleDoor } from "../actions/interact.js";
import { blockType } from "../actions/navigation.js";
import { teach, unteach, taught, loadTaught } from "../brain/nlu.js";
import { SUPPORTED_INTENTS } from "../brain/orders.js";
import { record } from "../social/relationships.js";
import { namePlace, placeNames, placeNamed } from "../civ/places.js";
import { stockpileContents } from "../civ/settlement.js";
import { giveItem, summariseInventory as summarise } from "../actions/inventory.js";
import { prettyId, dist, compass } from "../core/util.js";

const TAUGHT_KEY = "ai:taught";


/** Words the player has taught this world survive a reload. */
export function loadVocabulary() {
  safe("vocab.load", () => loadTaught(worldStore.load(TAUGHT_KEY, [])));
}
function saveVocabulary() {
  safe("vocab.save", () => worldStore.save(TAUGHT_KEY, taught()));
}

const EMOTE_STATES = {
  cheer: STATE.CHEER, celebrate: STATE.CHEER, laugh: STATE.CHEER,
  wave: STATE.POINT, point: STATE.POINT, salute: STATE.POINT,
  bow: STATE.SIT, dance: STATE.CHEER,
};

/**
 * @returns {null|{say?:string, tell?:string, task?:object, label?:string}}
 *          null when the effect could not be carried out, so the caller can
 *          fall through to its ordinary "I didn't follow" path.
 */
export function applyEffect(app, player, citizen, effect, originalText) {
  if (!effect || !effect.kind) return null;

  switch (effect.kind) {
    case "setJob": {
      const job = resolveJob(effect.job);
      if (!job) return { say: `I've never heard of a ${effect.job}.` };
      citizen.setJob(job);
      citizen.jobLocked = true;
      citizen.persist();
      return { say: `${titleCase(JOBS[job].name)} it is.`, label: `working as a ${JOBS[job].name}` };
    }

    case "rename": {
      const name = String(effect.name || "").trim().slice(0, 24);
      if (!name) return null;
      const was = citizen.short;
      citizen.name = name;
      citizen.short = name.split(/\s+/)[0];
      citizen.dirty = true;
      citizen.persist();
      citizen.refreshNameTag();
      return { say: `${name}, then. ${was} served me well enough.` };
    }

    case "foundTown": {
      const settlement = safe("effect.found", () => app.foundSettlementAt(player), null);
      if (!settlement) return { say: "Not here. We need flat ground and room to spread." };
      return { say: `${settlement.name}. We build here.`, label: `settling ${settlement.name}` };
    }

    case "joinTown": {
      const settlement = app.settlements.nearest(citizen.location, citizen.dimension.id, 64);
      if (!settlement) return { say: "There's no town near enough to join." };
      citizen.settlementId = settlement.id;
      citizen.dirty = true;
      citizen.persist();
      return { say: `${settlement.name} has me now.` };
    }

    case "teach": {
      if (!teach(effect.phrase, effect.meaning)) return null;
      saveVocabulary();
      return {
        say: `"${effect.phrase}" means ${effect.meaning}. I'll remember.`,
        tell: `§aLearned:§r "${effect.phrase}" → ${effect.meaning}`,
      };
    }

    case "forget": {
      if (!effect.phrase) {
        loadTaught([]);
        saveVocabulary();
        return { say: "Wiped. Teach me again when you like." };
      }
      const gone = unteach(effect.phrase);
      saveVocabulary();
      return { say: gone ? `Forgotten "${effect.phrase}".` : `I never knew "${effect.phrase}".` };
    }

    case "repeat": {
      // Replay the last thing this player actually asked for, skipping the
      // "do it again" that got us here.
      const previous = citizen.memory.orders.find(
        (o) => o.text && o.text !== originalText);
      if (!previous) return { say: "You've not asked me for anything yet." };
      return { say: null, tell: null, replay: previous.text };
    }

    case "quiet":
      citizen.muted = Boolean(effect.on);
      return { say: effect.on ? null : "Talking again." , label: effect.on ? "keeping quiet" : null };

    case "equip": {
      const held = equipTool(citizen, effect.tool);
      return { say: held ? `${titleCase(effect.tool)} in hand.` : `I've no ${effect.tool} to draw.` };
    }

    case "drop": {
      if (!effect.itemId) {
        const carried = summariseInventory(citizen, 4);
        return { say: carried ? `I'm carrying ${carried}. Which?` : "Nothing to drop." };
      }
      const dropped = dropItem(citizen, effect.itemId, effect.count ?? 64);
      return { say: dropped ? "There you go." : "I haven't any." };
    }

    case "emote": {
      const state = EMOTE_STATES[effect.which] ?? STATE.CHEER;
      citizen.setState(state);
      return { say: null };
    }

    case "help":
      return { tell: helpText() };

    // --- contests ---------------------------------------------------------
    case "contest": {
      const spec = { ...effect.spec, host: player.name };
      // Everyone within earshot is in it, unless the order named people.
      spec.entrants = spec.entrants || app.registry.near(player.location, 48);
      if (spec.kind === "duel" && spec.entrants.length > 2) {
        spec.entrants = spec.entrants
          .slice()
          .sort((a, b) => dist(a.location, player.location) - dist(b.location, player.location))
          .slice(0, 2);
      }
      const started = app.contests.start(app, spec);
      if (!started.ok) return { tell: `§c${started.why}§r` };
      return { label: started.contest.title, say: null };
    }

    case "scoreboard":
      return { tell: app.contests.scoreboardLines().join("\n") };

    case "contestStop":
      return app.contests.abandon(app, "Contest called off.")
        ? { say: "Fine. We'll settle it another day." }
        : { tell: "§7Nothing running.§r" };

    // --- logistics --------------------------------------------------------
    case "countStock": {
      const settlement = app.settlements.get(citizen.settlementId);
      if (!settlement) {
        return { say: `I've ${summarise(citizen, 5) || "nothing"}. No town stores yet.` };
      }
      const stock = safe("effect.stock",
        () => stockpileContents(settlement, citizen.dimension), new Map()) || new Map();
      if (effect.resource) {
        let total = 0;
        for (const [id, n] of stock) {
          if (id.toLowerCase().includes(String(effect.resource).toLowerCase())) total += n;
        }
        return { say: `${total} of it in the stores.` };
      }
      const top = [...stock.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([id, n]) => `${n}x ${prettyId(id)}`);
      return { say: top.length ? `Stores: ${top.join(", ")}.` : "Stores are empty." };
    }

    case "shareOut": {
      const crowd = app.registry.near(citizen.location, 24);
      const id = effect.itemId;
      if (!id) return { say: "Share what?" };
      let handed = 0;
      for (const other of crowd) {
        if (other === citizen) continue;
        if (giveItem(other, id, 1)) handed += 1;
      }
      return { say: handed ? `Shared out to ${handed}.` : "Nothing to share." };
    }

    case "armEveryone": {
      const crowd = app.registry.near(player.location, 32);
      let armed = 0;
      for (const other of crowd) {
        const gave = giveItem(other, "minecraft:stone_sword", 1);
        giveItem(other, "minecraft:stone_pickaxe", 1);
        if (gave) armed += 1;
      }
      return { tell: `§aArmed ${armed}§r citizen${armed === 1 ? "" : "s"}.`,
               say: armed ? "Right. We're ready." : null };
    }

    case "swapJobs": {
      const near = app.registry.near(citizen.location, 24).filter((c) => c !== citizen);
      const other = near[0];
      if (!other) return { say: "Nobody here to swap with." };
      const mine = citizen.job, theirs = other.job;
      citizen.setJob(theirs); other.setJob(mine);
      citizen.persist(); other.persist();
      return { say: `${other.short} and I have traded. I'm the ${theirs} now.` };
    }

    // --- manner -----------------------------------------------------------
    case "setVoice": {
      const voice = effect.voice;
      for (const c of app.registry.near(player.location, 24)) {
        c.personality.voice = voice === "loud" ? c.personality.voice : voice;
        c.loud = voice === "loud" ? true : c.loud;
        c.dirty = true;
      }
      return { say: VOICE_REPLY[voice] || "As you like." };
    }

    case "pace": {
      for (const c of app.registry.near(player.location, 24)) c.pace = effect.pace;
      return { say: effect.pace === "fast" ? "Right, no dawdling." : "Slow and steady it is." };
    }

    // --- social -----------------------------------------------------------
    case "praise":
      record(citizen, player.name, "helped");
      citizen.needs.morale = Math.min(100, citizen.needs.morale + 15);
      return { say: pickLine(PRAISE_REPLIES) };

    case "scold":
      record(citizen, player.name, "wronged");
      citizen.needs.morale = Math.max(0, citizen.needs.morale - 10);
      return { say: pickLine(SCOLD_REPLIES) };

    case "opinion": {
      const about = String(effect.about || "").trim();
      if (!about) return { say: "Of who?" };
      const known = app.registry.byName(about.split(/\s+/)[0]);
      const rec = citizen.memory.people?.[known ? known.name : about];
      const affinity = rec ? rec.affinity : 0;
      const name = known ? known.short : about;
      if (affinity > 40) return { say: `${name}? Sound as a bell. I'd work a double shift for them.` };
      if (affinity < -20) return { say: `${name}. We don't speak much, and that suits us both.` };
      return { say: `${name} is all right. Pulls their weight.` };
    }

    // --- places -----------------------------------------------------------
    case "namePlace": {
      const place = namePlace(effect.name, player.location, player.dimension.id);
      if (!place) return null;
      return { say: `"${place.name}" it is. I'll know it from now on.`,
               tell: `§aMarked "${place.name}"§r at ${place.x}, ${place.z}` };
    }

    case "listPlaces": {
      const names = placeNames();
      return names.length
        ? { tell: `§ePlaces:§r ${names.join(", ")}`, say: `We've named ${names.length} spots.` }
        : { say: "We've named nowhere yet. Stand somewhere and tell me what it's called." };
    }

    // --- questions about the town -----------------------------------------
    case "whereIs": {
      const who = String(effect.who || "").trim().split(/\s+/)[0];
      if (!who) return { say: "Where's who?" };
      const found = app.registry.byName(who);
      if (found) {
        const away = Math.round(dist(citizen.location, found.location));
        const doing = found.task ? (found.task.label || found.task.kind) : "idle";
        return { say: `${found.short}? ${away} paces ${compass(citizen.location, found.location)}. ${capitalise(doing)}.` };
      }
      const place = placeNamed(who);
      if (place) return { say: `${place.name} is at ${place.x}, ${place.z}.` };
      return { say: `I don't know any ${who}.` };
    }

    case "whoBest": {
      const crowd = app.registry.all;
      if (!crowd.length) return { say: "There's only me." };
      // "Best" is measured, not opinion: wins, then health, then morale.
      const scored = crowd.map((c) => ({
        c,
        score: (c.wins || 0) * 10
          + (effect.at && c.job === effect.at ? 5 : 0)
          + (c.needs.morale / 20) + c.healthFraction * 2,
      })).sort((a, b) => b.score - a.score);
      const pickOne = effect.worst ? scored[scored.length - 1] : scored[0];
      const word = effect.worst ? "worst" : "best";
      const trade = effect.at ? ` ${effect.at}` : "";
      return { say: `${pickOne.c.short}, no question. ${pickOne.c.wins
        ? `${pickOne.c.wins} win${pickOne.c.wins === 1 ? "" : "s"} to their name.`
        : `Our ${word}${trade}.`}` };
    }

    case "townReport": {
      const settlement = app.settlements.get(citizen.settlementId);
      if (!settlement) return { say: "No town yet. Say the word and we'll found one." };
      const members = app.registry.inSettlement(settlement.id).length;
      const built = (settlement.structures || []).filter((st) => st.status === "done").length;
      const going = (settlement.structures || []).filter((st) => st.status === "building").length;
      return { say: `${settlement.name}: ${members} of us, ${built} building${built === 1 ? "" : "s"} up${going ? `, ${going} on the go` : ""}.` };
    }

    case "headCount": {
      const here = app.registry.near(player.location, 48).length;
      const all = app.registry.count;
      return { say: here === all
        ? `${all} of us, all present.`
        : `${here} of us here. ${all} in all.` };
    }

    case "door": {
      // The nearest door within reach, opened or shut.
      const near = nearestDoor(citizen);
      if (!near) return { say: "No door near enough." };
      toggleDoor(citizen.dimension, near, effect.open);
      return { say: effect.open ? "Open." : "Shut, and barred." };
    }

    // --- standing orders --------------------------------------------------
    case "standingOrder": {
      if (!effect.order) return { say: "Do what, when?" };
      citizen.standingOrders = (citizen.standingOrders || [])
        .filter((o) => o.trigger !== effect.trigger);
      citizen.standingOrders.push({ trigger: effect.trigger, order: effect.order, lastFired: 0 });
      if (citizen.standingOrders.length > 6) citizen.standingOrders.shift();
      citizen.dirty = true;
      return { say: `${describeTrigger(effect.trigger)}, ${effect.order}. Understood.` };
    }

    case "untilOrder": {
      citizen.untilGoal = { order: effect.order, goal: effect.goal, resource: effect.resource };
      return { say: effect.goal
        ? `I'll keep at it until I've ${effect.goal}.`
        : "I'll keep at it.", replay: effect.order };
    }

    case "neverDo": {
      if (!effect.what) return { say: "Never do what?" };
      citizen.forbidden = citizen.forbidden || [];
      if (!citizen.forbidden.includes(effect.what)) citizen.forbidden.push(effect.what);
      citizen.dirty = true;
      return { say: `I'll not ${effect.what} again. You have my word.` };
    }

    default:
      return null;
  }
}

const VOICE_REPLY = {
  pirate: "Arr. As ye say, cap'n.",
  wry: "Funnier. I'll try not to strain anything.",
  gruff: "Serious. Right.",
  warm: "Of course — happy to.",
  loud: "LOUDER. LIKE THIS?",
  plain: "Plain talking, then.",
};

const PRAISE_REPLIES = [
  "Kind of you to say.", "I'll take that.", "Someone noticed. Good.",
  "That's the job.", "Ta.",
];
const SCOLD_REPLIES = [
  "Understood. I'll do better.", "Harsh. But noted.", "Right. My fault.",
  "I'll put it right.",
];

const pickLine = (list) => list[Math.floor(Math.random() * list.length)];
const capitalise = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/** The closest door, within a few blocks. */
function nearestDoor(citizen) {
  const here = citizen.location;
  let best = null, bestD = Infinity;
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      for (let dy = -1; dy <= 2; dy++) {
        const x = Math.floor(here.x) + dx, y = Math.floor(here.y) + dy, z = Math.floor(here.z) + dz;
        const type = safe("door.read", () => blockType(citizen.dimension, x, y, z), undefined);
        if (!type || !/door|gate|trapdoor/.test(type)) continue;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; best = { x, y, z }; }
      }
    }
  }
  return best;
}

function describeTrigger(trigger) {
  if (trigger === "night") return "When it gets dark";
  if (trigger === "morning") return "Come morning";
  if (trigger === "hungry") return "When I'm hungry";
  if (trigger === "always") return "From now on";
  if (String(trigger).startsWith("sees:")) {
    return `If I see a ${String(trigger).slice(5).toLowerCase()}`;
  }
  return "When that happens";
}

function resolveJob(word) {
  const w = String(word || "").toLowerCase();
  if (JOBS[w]) return w;
  // Job records carry a display name that may differ from the key
  // ("lumberjack" is shown as "woodcutter").
  for (const [key, job] of Object.entries(JOBS)) {
    if (job.name.toLowerCase() === w) return key;
  }
  return null;
}

/** Everything a citizen can be told, grouped so it is readable in chat. */
export function describeSkills() {
  return {
    Challenges: ["make them fight each other", "you two have a duel",
                 "first to get 20 wood wins", "who can get 10 iron first",
                 "race to that hill", "have a tournament",
                 "build off: who builds a house fastest",
                 "first to kill 5 zombies", "who is winning", "call it off"],
    Work: ["mine iron", "chop 20 wood", "dig down 15", "tunnel east 30",
           "clear this area", "build a house", "light up the place",
           "plant a field", "bridge north 12"],
    Groundwork: ["level the ground", "dig a moat around the town", "dig a pit",
                 "cut steps down", "hollow out the hill", "fill in the hole",
                 "wall off that cave", "build a wall all the way round",
                 "fence in the field", "put a roof on", "build a dock"],
    Movement: ["follow me", "come here", "go to 120 64 -30", "go north 40 blocks",
               "go home", "stay here", "stop", "spread out", "regroup"],
    Fighting: ["kill that creeper", "hunt a cow", "defend me", "guard the town", "run"],
    Things: ["craft a pickaxe", "smelt iron", "give me coal", "drop the dirt",
             "store this", "fetch 8 planks", "draw your sword",
             "sort the chests", "share out the food", "arm everyone",
             "what are you carrying", "how much wood do we have"],
    Life: ["eat something", "get some sleep", "have a rest", "go explore"],
    Identity: ["become a miner", "your name is Ada", "found a town", "join the town",
               "swap jobs with Ada"],
    Manner: ["talk like a pirate", "be funnier", "be more serious", "hurry up",
             "be careful", "be quiet", "speak up"],
    Social: ["well done", "tell me a story", "what do you think of Ada",
             "introduce yourself", "where is Ada", "who is the best miner",
             "how is the town", "how many of us are there"],
    Places: ["call this place the quarry", "go to the quarry", "what places do we know"],
    Standing: ["when it gets dark come home", "if you see a creeper run away",
               "keep mining until you have 64", "never fight",
               "from now on guard the town"],
    Groups: ["everyone follow me", "all the miners go dig", "three of you follow me",
             "half of you go home", "Ada and Bram go mine iron", "the nearest one come here"],
    Teaching: ['"dig deep" means mine iron', "forget dig deep", "do that again"],
  };
}

function helpText() {
  const groups = describeSkills();
  const lines = [`§e${SUPPORTED_INTENTS.length} things they understand.§r Say "ai!" then any of these:`];
  for (const [group, examples] of Object.entries(groups)) {
    lines.push(`§7${group}:§r ${examples.join(" · ")}`);
  }
  lines.push("§7Add a name to aim it:§r ai! @Ada go mine iron");
  return lines.join("\n");
}
