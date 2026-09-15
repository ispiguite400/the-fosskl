/**
 * Personality is derived from a citizen's stable seed, so the same citizen is
 * the same person across restarts without storing anything extra.
 */
import { mulberry32, hashString, pick, clamp } from "../core/util.js";

export const TRAIT_NAMES = [
  "curiosity", "bravery", "industry", "sociability",
  "loyalty", "humour", "caution", "ambition",
];

const VOICES = [
  "plain-spoken", "wry", "earnest", "gruff", "cheerful", "thoughtful",
  "blunt", "poetic", "anxious", "dry", "warm", "practical",
];

const QUIRKS = [
  "counts things out loud",
  "names the tools they use",
  "always mentions the weather",
  "hums while working",
  "keeps score of favours",
  "worries about the walls",
  "quotes their grandmother",
  "is convinced the hill is haunted",
  "collects odd stones",
  "talks to the animals",
  "is saving up for a proper roof",
  "never trusts a cave",
  "is writing everything down",
  "insists on straight lines",
  "swears the sunsets are better here",
  "wants the town to have a name people remember",
];

const GOALS = [
  "see the settlement get a real wall",
  "find iron before anyone else does",
  "grow enough food that nobody goes hungry",
  "build a house with a window",
  "map the land in every direction",
  "keep everyone alive through the night",
  "have a workshop of their own",
  "make this place somewhere people want to stay",
];

export function personalityFor(seedText) {
  const rnd = mulberry32(hashString("pers:" + seedText));
  const traits = {};
  for (const t of TRAIT_NAMES) {
    // centred around 0.5 so extremes are rare but memorable
    traits[t] = clamp((rnd() + rnd() + rnd()) / 3, 0.05, 0.95);
  }
  return {
    traits,
    voice: pick(VOICES, rnd),
    quirk: pick(QUIRKS, rnd),
    dream: pick(GOALS, rnd),
  };
}

/** A compact line the brain can read as character direction. */
export function describePersonality(p) {
  const strong = Object.entries(p.traits)
    .filter(([, v]) => v > 0.66)
    .map(([k]) => k);
  const weak = Object.entries(p.traits)
    .filter(([, v]) => v < 0.33)
    .map(([k]) => `low ${k}`);
  const bits = [...strong, ...weak];
  return `${p.voice}${bits.length ? ", " + bits.join(", ") : ""}; ${p.quirk}; dreams of ${p.dream}`;
}

export function trait(citizen, name) {
  return citizen.personality?.traits?.[name] ?? 0.5;
}

/** How likely this citizen is to start a conversation right now. */
export function chattiness(citizen) {
  return trait(citizen, "sociability") * 0.8 + trait(citizen, "humour") * 0.2;
}

/** How willing they are to stand and fight rather than run. */
export function grit(citizen) {
  return trait(citizen, "bravery") * 0.7 + (1 - trait(citizen, "caution")) * 0.3;
}
