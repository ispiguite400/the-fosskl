/** Name and title generation, seeded so a citizen keeps its name forever. */
import { mulberry32, hashString, pick } from "./util.js";

const FIRST = [
  "Ada", "Bram", "Cael", "Dara", "Edda", "Finn", "Greta", "Hale", "Ivo", "Juna",
  "Kell", "Lior", "Mira", "Nils", "Ona", "Pell", "Quin", "Rhea", "Sten", "Tova",
  "Ulla", "Veda", "Wren", "Xan", "Yara", "Zeph", "Alder", "Brill", "Cora", "Doran",
  "Esme", "Faro", "Gill", "Hesper", "Isolde", "Jarek", "Kiva", "Lund", "Maro", "Nesta",
  "Orin", "Perrin", "Runa", "Soren", "Thal", "Ursa", "Vance", "Wyn", "Yorick", "Zosia",
];

const LAST = [
  "Ashdown", "Barrow", "Cindermoor", "Deepfell", "Elmgate", "Fernhollow", "Grimsby",
  "Hearthstone", "Ironvale", "Jarrow", "Keldmere", "Longbarrow", "Millbrook",
  "Northwood", "Oakhollow", "Pinecross", "Quarryside", "Redmarsh", "Stonewright",
  "Thornfield", "Underhill", "Varrow", "Westmere", "Yarrowdale",
];

const EPITHET = [
  "the Steady", "the Quick", "the Quiet", "the Curious", "the Bold", "the Patient",
  "the Sharp", "the Kind", "the Stubborn", "the Bright", "the Weathered", "the Restless",
];

const SETTLEMENT_A = [
  "Ash", "Bright", "Cinder", "Deep", "Elm", "Fern", "Grim", "Hearth", "Iron",
  "Keld", "Long", "Mill", "North", "Oak", "Pine", "Red", "Stone", "Thorn", "West",
];
const SETTLEMENT_B = [
  "hold", "gate", "mere", "brook", "vale", "reach", "fell", "ford", "watch",
  "barrow", "cross", "hollow", "stead", "wick",
];

export function nameFor(seedText) {
  const rnd = mulberry32(hashString("name:" + seedText));
  const first = pick(FIRST, rnd);
  const last = pick(LAST, rnd);
  return rnd() < 0.18 ? `${first} ${pick(EPITHET, rnd)}` : `${first} ${last}`;
}

export function shortName(full) {
  return String(full).split(" ")[0];
}

export function settlementName(seedText) {
  const rnd = mulberry32(hashString("town:" + seedText));
  return pick(SETTLEMENT_A, rnd) + pick(SETTLEMENT_B, rnd);
}
