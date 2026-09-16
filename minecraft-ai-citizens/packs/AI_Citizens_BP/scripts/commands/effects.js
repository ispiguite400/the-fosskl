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
import { teach, unteach, taught, loadTaught } from "../brain/nlu.js";
import { SUPPORTED_INTENTS } from "../brain/orders.js";

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

    default:
      return null;
  }
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
    Work: ["mine iron", "chop 20 wood", "dig down 15", "tunnel east 30",
           "clear this area", "build a house", "light up the place",
           "plant a field", "bridge north 12"],
    Movement: ["follow me", "come here", "go to 120 64 -30", "go north 40 blocks",
               "go home", "stay here", "stop", "spread out", "regroup"],
    Fighting: ["kill that creeper", "hunt a cow", "defend me", "guard the town", "run"],
    Things: ["craft a pickaxe", "smelt iron", "give me coal", "drop the dirt",
             "store this", "fetch 8 planks", "draw your sword", "what are you carrying"],
    Life: ["eat something", "get some sleep", "have a rest", "go explore"],
    Identity: ["become a miner", "your name is Ada", "found a town", "join the town"],
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
