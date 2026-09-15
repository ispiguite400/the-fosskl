/**
 * Generating what a citizen says, rather than choosing it from a list.
 *
 * A line bank is why they sounded like a machine: a hundred fixed sentences,
 * and you have heard them all within an hour. This composes each utterance
 * instead, from a small grammar:
 *
 *     utterance := structure, whose slots are filled from word classes,
 *                  weighted by the speaker's voice and current mood,
 *                  and rejected if they have said it lately.
 *
 * A frame with four structures and four options in each of four slots is a
 * thousand distinct sentences before personality even narrows it, so citizens
 * stop repeating and start sounding like different people.
 *
 * This is natural language *generation* - a grammar, not a model. It runs in a
 * script module with no network and answers inside a tick.
 */
import { mulberry32, hashString, weightedPick } from "../core/util.js";

/**
 * An option is a plain string, or [text, tags]. Tags describe the register the
 * option belongs to; an option is preferred when its tags match the speaker and
 * avoided when they clash.
 */
const GRAMMAR = {
  greet: {
    structures: [
      "{hail}{other}.",
      "{hail}{other}. {follow_up}",
      "{other}. {observation_of_them}",
      "{hail}{other} — {follow_up}",
    ],
    slots: {
      hail: ["", "", ["Ah, ", "warm"], ["Well now, ", "wry"], ["Morning, ", "plain"],
             ["There you are, ", "warm"], ["Right, ", "gruff"]],
      follow_up: [
        "Good to see you.", ["Just the person.", "wry"], "Busy day.",
        ["Still standing, then.", "gruff"], ["I was hoping you'd come by.", "warm"],
        ["Everything all right?", "anxious"], "How goes it?",
      ],
      observation_of_them: [
        "You look like you've been working.", ["Still in one piece, I see.", "wry"],
        "Come to see how we're getting on?", ["Don't just stand there.", "gruff"],
      ],
    },
  },

  observe_ore: {
    structures: [
      "{discovery} {material} {place}.",
      "{place} — {material}. {verdict}",
      "{verdict} {material}, {place}.",
      "{material} {place}. {verdict}",
    ],
    slots: {
      discovery: ["There's", "I see", ["Look — ", "warm"], "That's", ["Found", "plain"],
                  ["Would you look at that,", "wry"]],
      place: ["{dist} paces {dir}", "just {dir} of here", "over {dir}",
              "{dir}, not far", "in the rock {dir}"],
      verdict: ["Worth digging.", "That'll do nicely.", ["Finally.", "wry"],
                "Good find.", ["We could use that.", "plain"],
                ["I'll want a better pick first.", "anxious"], "About time."],
    },
  },

  observe_threat: {
    structures: [
      "{alarm} {threat}, {place}!",
      "{threat} {place}. {reaction}",
      "{alarm} {reaction}",
      "{threat}! {reaction}",
    ],
    slots: {
      alarm: ["", ["Careful — ", "anxious"], ["Weapons.", "brave"], ["Oi!", "gruff"],
              ["Look out —", "plain"]],
      place: ["{dist} paces {dir}", "{dir} of us", "coming from {dir}", "just {dir}"],
      reaction: [
        ["Get behind me.", "brave"], ["I'm not moving.", "brave"],
        ["Back, back!", "anxious"], "Stay sharp.",
        ["I've handled worse.", "brave"], ["I don't like this.", "anxious"],
      ],
    },
  },

  work: {
    structures: [
      "{effort}",
      "{effort} {aside}",
      "{aside}",
      "{effort} {complaint}",
    ],
    slots: {
      effort: [
        "Back to it.", "Steady work, this.", ["No rest for the likes of us.", "wry"],
        "Another load and we're done.", ["This'll take all day.", "gruff"],
        "Almost there.", ["One more, then a sit down.", "plain"],
      ],
      aside: [
        "The light's going.", "Hands are aching.", ["Worth it, mind.", "warm"],
        ["Someone else can do the next one.", "wry"], "Quiet out here.",
        ["I'll sleep well tonight.", "warm"],
      ],
      complaint: [
        ["My back.", "gruff"], ["This tool's blunt.", "gruff"],
        ["Harder than it looks.", "plain"], ["Nobody thanks you.", "wry"],
      ],
    },
  },

  acknowledge: {
    structures: [
      "{assent}",
      "{assent} {detail}",
      "{detail}",
      "{assent} {promise}",
    ],
    slots: {
      assent: ["Right.", "Aye.", ["Consider it done.", "warm"], "On it.",
               ["If you say so.", "wry"], "Understood.", ["Fine.", "gruff"],
               ["Of course.", "warm"]],
      detail: ["{order}.", "I'll see to {order}.", "{order} it is."],
      promise: ["Won't be long.", "Give me till dusk.", ["Straight away.", "warm"],
                ["When I've finished this.", "gruff"], "I'll get to it."],
    },
  },

  done: {
    structures: ["{completion}", "{completion} {next}", "{next}"],
    slots: {
      completion: ["That's done.", "Finished.", ["There.", "gruff"],
                   "{task} — done.", ["Took longer than I'd like.", "wry"]],
      next: ["What's next?", ["Anything else?", "warm"], "I'll find something.",
             ["I'm having a sit down.", "wry"]],
    },
  },

  smalltalk: {
    structures: ["{musing}", "{musing} {hook}", "{hook}"],
    slots: {
      musing: [
        "Strange light this evening.", "I keep meaning to ask you something.",
        ["Do you ever think about where the rivers go?", "poetic"],
        "My hands know this work better than my head does.",
        ["Someone ought to write this down.", "plain"],
        ["Quiet suits me.", "gruff"], "Funny how a place grows on you.",
        ["I had a dream about the hill again.", "anxious"],
      ],
      hook: ["Don't mind me.", ["What do you reckon?", "warm"], "Anyway.",
             ["Forget I said anything.", "gruff"]],
    },
  },

  plan: {
    structures: ["{need_line}", "{need_line} {urgency}", "{proposal}"],
    slots: {
      need_line: ["We need {need} before anything else.",
                  "It's {need} we're short of.",
                  ["No use building anything without {need}.", "plain"]],
      proposal: ["The {structure} goes up next.", "I say we raise the {structure}.",
                 ["Give me a week and we'll have a {structure}.", "warm"]],
      urgency: ["Sooner the better.", ["Before winter.", "anxious"],
                ["No hurry.", "wry"], "I'll start today."],
    },
  },

  farewell: {
    structures: ["{parting}", "{parting} {care}"],
    slots: {
      parting: ["Right — back to work.", "I'll be about.", ["Mind yourself.", "warm"],
                ["Later.", "gruff"], "Good talking to you."],
      care: ["Don't be a stranger.", "Watch the dark.", ["Take care out there.", "warm"]],
    },
  },

  confused: {
    structures: ["{puzzlement}", "{puzzlement} {ask}"],
    slots: {
      puzzlement: ["Say that again?", ["I don't follow.", "plain"],
                   ["You've lost me.", "wry"], "The wind took that.",
                   ["Eh?", "gruff"]],
      ask: ["Plainer, if you can.", "What is it you want doing?",
            ["Slowly, this time.", "wry"]],
    },
  },
};

/**
 * Word classes any frame may use, and the fallbacks for facts the caller did
 * not supply. Without these a missing slot leaves a hole in the sentence.
 */
const GLOBAL_SLOTS = {
  dir: ["north", "south", "east", "west", "north-east", "north-west",
        "south-east", "south-west"],
  dist: ["a few", "ten", "twenty", "thirty", "forty"],
  material: ["coal", "iron", "copper", "stone"],
  threat: ["something", "a creeper", "a skeleton", "a zombie"],
  task: ["the job", "that"],
  order: ["that", "what you asked"],
  need: ["food", "timber", "stone", "shelter"],
  structure: ["storehouse", "house", "wall", "well"],
  other: ["friend"],
};

/**
 * How strongly a citizen's voice pulls toward a register.
 * `hints` are extra registers the situation asks for - a warm greeting to a
 * friend, a cold one to someone they dislike. A hint prefixed with "!" rules a
 * register out instead.
 */
function styleWeights(citizen, mood, hints = []) {
  const voice = citizen.personality?.voice || "plain";
  const weights = { [voice]: 3 };
  if (mood === "afraid" || mood === "low") weights.anxious = (weights.anxious || 1) + 2;
  if (mood === "cheerful") weights.warm = (weights.warm || 1) + 2;
  if (mood === "exhausted" || mood === "hungry") weights.gruff = (weights.gruff || 1) + 1.5;
  weights.brave = (weights.brave || 1) + (citizen.personality?.traits?.bravery || 0.5) * 2;
  weights.plain = weights.plain || 1.2;
  // A hint asks for a register; "!warm" rules one out, which is how a cold
  // greeting stays cold even when the speaker is a warm sort.
  for (const hint of hints) {
    if (hint.startsWith("!")) weights[hint.slice(1)] = -10;
    else weights[hint] = (weights[hint] || 0) + 4;
  }
  return weights;
}

function optionWeight(option, weights) {
  if (typeof option === "string") return 1;
  const tags = option[1];
  const list = Array.isArray(tags) ? tags : [tags];
  let w = 0.35;                       // tagged options are rarer by default
  for (const t of list) w += weights[t] || 0;
  return w;
}

const optionText = (option) => (typeof option === "string" ? option : option[0]);

function fillSlots(text, frame, citizen, ctx, rnd, weights, depth = 0) {
  if (depth > 4) return text;
  return text.replace(/\{(\w+)\}/g, (_, name) => {
    // Context values win: they are the facts of the moment.
    if (ctx && ctx[name] !== undefined && ctx[name] !== null) return String(ctx[name]);

    const options = (frame.slots && frame.slots[name]) || GLOBAL_SLOTS[name];
    if (!options) return "";
    const entries = options.map((o) => [o, optionWeight(o, weights)]);
    const chosen = weightedPick(entries, rnd);
    return fillSlots(optionText(chosen), frame, citizen, ctx, rnd, weights, depth + 1);
  });
}

/**
 * Sentences are assembled from fragments, so the capitals land in the wrong
 * places: an option written to start a sentence ("Weapons.") ends up mid-line,
 * and a fact spliced in from the world ("iron ore") ends up starting one. This
 * repairs both, and clears up the punctuation left by an empty slot.
 */
function tidy(text) {
  let out = String(text)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([,.!?;:]){2,}/g, "$1")
    .replace(/^\s*[—-]+\s*/, "")       // leading dash from an empty first slot
    .replace(/\s*[—-]\s*([,.!?])/g, "$1")  // dash left dangling before punctuation
    .replace(/^\s*[,.]\s*/, "")            // leading comma/stop, same cause
    .trim();

  // A clause after a dash continues the sentence, so it is not capitalised -
  // unless it begins with "I".
  out = out.replace(/(—\s+)([A-Z][\w']*)/g, (m, dash, word) =>
    (/^I$|^I'/.test(word) ? m : dash + word[0].toLowerCase() + word.slice(1)));

  // Capitalise the start of the line and of each new sentence.
  out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());

  return out;
}

/**
 * Compose one line.
 * @returns {string|null} null when the frame is unknown, or when every attempt
 *                        repeated something the citizen said recently, so a
 *                        caller can fall back to the older template bank.
 */
export function compose(citizen, frameName, ctx = {}, mood = "steady", hints = []) {
  const frame = GRAMMAR[frameName];
  if (!frame) return null;

  const weights = styleWeights(citizen, mood, hints);
  const seed = hashString(`${citizen.seed}:${frameName}:${Math.floor(Math.random() * 1e9)}`);
  const rnd = mulberry32(seed);

  if (!citizen.recentLines) citizen.recentLines = [];

  // Try a few times to say something they have not just said.
  for (let attempt = 0; attempt < 6; attempt++) {
    const structure = weightedPick(
      frame.structures.map((s) => [s, 1]), rnd,
    );
    const line = tidy(fillSlots(structure, frame, citizen, ctx, rnd, weights));
    if (!line || line.length < 2) continue;

    const key = hashString(line.toLowerCase());
    if (!citizen.recentLines.includes(key)) {
      citizen.recentLines.push(key);
      if (citizen.recentLines.length > 12) citizen.recentLines.shift();
      return line;
    }
  }
  return null;
}

/** Roughly how many distinct sentences a frame can produce. */
export function variety(frameName) {
  const frame = GRAMMAR[frameName];
  if (!frame) return 0;
  let total = 0;
  for (const structure of frame.structures) {
    let combos = 1;
    for (const m of structure.matchAll(/\{(\w+)\}/g)) {
      const options = (frame.slots && frame.slots[m[1]]) || GLOBAL_SLOTS[m[1]];
      combos *= options ? options.length : 1;
    }
    total += combos;
  }
  return total;
}

export function frames() {
  return Object.keys(GRAMMAR);
}

/**
 * The tidying a template line still needs: a slot filled with a lowercase word
 * ("friend", a task name) can land at the start of a sentence.
 * An ellipsis is not a sentence break, so "Hm-hm-hmm... oh" is left alone.
 */
export function polish(text) {
  return String(text)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim()
    .replace(/(^|(?:[^.]\.|[!?])\s+)([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
}
