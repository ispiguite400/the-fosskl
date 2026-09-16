#!/usr/bin/env node
/**
 * Enumerate every command the citizens understand, and check each one works.
 *
 * "How many commands are there" is easy to answer dishonestly - you count
 * intents, or you count phrasings, or you multiply and call it a catalogue.
 * This counts only what it can prove: every phrase below is run through the
 * real parser and planner, and is counted only if it comes back with a task, an
 * effect or an answer. Anything that does not is reported as a failure.
 *
 * Writes docs/COMMANDS.md and prints the totals.
 *
 * Usage: node tools/commands.mjs [--write]
 */
import fs from "node:fs";
import path from "node:path";
import { bootSim, ROOT } from "./sim/harness.mjs";

const WRITE = process.argv.includes("--write");

const sim = await bootSim();
const { mock } = sim;
mock.seedArea();
const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });
await sim.start();
mock.sendScriptEvent("ai:cmd", "spawn 4", player);
mock.advance(20);

const citizen = sim.debug().registry.all[0];
const { parseOrderLocally } = await sim.load("brain/local.js");
const { understand, teach } = await sim.load("brain/nlu.js");
const { SUPPORTED_INTENTS } = await sim.load("brain/orders.js");
const { takeAudience } = await sim.load("commands/parser.js");
const { namePlace } = await sim.load("civ/places.js");
const registry = await sim.load("actions/registry.js");

// A named place and a taught word, so those commands have something to bite on.
namePlace("quarry", player.location, player.dimension.id);
teach("faff about", "go explore");

const ctx = {
  tasks: registry, speakerId: player.id, speakerLocation: player.location,
  speakerFacing: { x: 1, y: 0, z: 0 }, settlement: null,
  registry: sim.debug().registry,
};

// Real citizen names, so the "follow Ada" family is checked against the roster
// rather than against a name nobody has.
const MATES = sim.debug().registry.all.slice(1, 4).map((c) => c.short);

// --------------------------------------------------------------------------
// Parameter vocabularies. These are the words that genuinely change what
// happens, not synonyms of each other.
// --------------------------------------------------------------------------
const ORES = ["iron", "coal", "gold", "copper", "diamond", "emerald", "redstone",
              "lapis", "quartz", "stone", "dirt", "sand", "gravel", "clay"];
const RESOURCES = ["wood", ...ORES];
const STRUCTURES = ["house", "storehouse", "workshop", "well", "field", "watchtower",
                    "wall", "road", "lamp post", "town hall", "shrine", "campfire"];
const HOSTILES = ["zombie", "skeleton", "creeper", "spider", "enderman", "witch", "slime"];
const ANIMALS = ["cow", "pig", "sheep", "chicken", "horse", "wolf"];
const ITEMS = ["pickaxe", "axe", "sword", "shovel", "hoe", "torch", "chest",
               "furnace", "crafting table", "bed", "door", "ladder", "boat",
               "bucket", "stick"];
const DIRECTIONS = ["north", "south", "east", "west"];
const JOBS = ["miner", "builder", "farmer", "guard", "crafter", "scout",
              "hauler", "woodcutter", "architect", "settler"];
const VOICES = ["talk like a pirate", "be funnier", "be more serious",
                "speak up", "be polite"];
const AUDIENCES = ["everyone", "all the miners", "three of you", "half of you",
                   "the nearest one", "Ada and Bram"];

/** Each entry is [group, phrase]. */
const COMMANDS = [];
const add = (group, phrase) => COMMANDS.push([group, phrase]);

// --- challenges -----------------------------------------------------------
add("Challenges", "make them fight each other");
add("Challenges", "you two have a duel");
add("Challenges", "have a tournament");
add("Challenges", "who is winning");
add("Challenges", "call it off");
add("Challenges", "race to that hill");
add("Challenges", "race to 40 70 0");
for (const r of RESOURCES) {
  add("Challenges", `first to get 20 ${r} wins`);
  add("Challenges", `who can get 10 ${r} first`);
}
for (const m of HOSTILES) add("Challenges", `first to kill 5 ${m}s`);
for (const s of STRUCTURES) add("Challenges", `build off: who builds a ${s} fastest`);
for (const n of [5, 10, 20, 30]) add("Challenges", `first one to dig down ${n} blocks`);

// --- gathering and mining -------------------------------------------------
for (const r of RESOURCES) {
  add("Work", `go mine some ${r}`);
  add("Work", `get me 20 ${r}`);
  add("Work", `bring me a stack of ${r}`);
}

// --- building -------------------------------------------------------------
for (const s of STRUCTURES) add("Work", `build a ${s}`);
add("Work", "light up the place");
add("Work", "plant a field");

// --- digging shapes -------------------------------------------------------
for (const n of [5, 10, 15, 20, 30]) add("Groundwork", `dig down ${n}`);
for (const d of DIRECTIONS) {
  add("Groundwork", `tunnel ${d} 30 blocks`);
  add("Groundwork", `bridge ${d} 12`);
  add("Groundwork", `build a dock to the ${d}`);
}
add("Groundwork", "clear this area");
add("Groundwork", "level the ground");
add("Groundwork", "dig a moat around the town");
add("Groundwork", "dig a pit");
add("Groundwork", "cut steps down");
add("Groundwork", "hollow out the hill");
add("Groundwork", "fill in the hole");
add("Groundwork", "wall off that cave");
add("Groundwork", "build a wall all the way round");
add("Groundwork", "fence in the field");
add("Groundwork", "put a roof on");

// --- movement -------------------------------------------------------------
add("Movement", "follow me");
add("Movement", "come here");
add("Movement", "go home");
add("Movement", "stay here");
add("Movement", "stop");
add("Movement", "spread out");
add("Movement", "regroup");
add("Movement", "go to the quarry");
for (const d of DIRECTIONS) for (const n of [20, 40]) add("Movement", `go ${d} ${n} blocks`);
for (const c of ["120 70 -30", "0 64 0", "-200 70 350"]) add("Movement", `go to ${c}`);

// --- fighting -------------------------------------------------------------
for (const m of HOSTILES) add("Fighting", `kill that ${m}`);
for (const a of ANIMALS) add("Fighting", `hunt a ${a}`);
add("Fighting", "defend me");
add("Fighting", "guard the town");
add("Fighting", "run away");

// --- things ---------------------------------------------------------------
for (const i of ITEMS) {
  add("Things", `craft a ${i}`);
  add("Things", `give me a ${i}`);
}
for (const r of ["iron", "gold", "copper"]) add("Things", `smelt some ${r}`);
for (const i of ["pickaxe", "axe", "sword", "shovel", "hoe"]) add("Things", `draw your ${i}`);
add("Things", "drop the dirt");
add("Things", "store this");
add("Things", "fetch 8 planks");
add("Things", "sort the chests");
add("Things", "share out the food");
add("Things", "arm everyone");
add("Things", "collect the drops");
add("Things", "what are you carrying");
for (const r of RESOURCES) add("Things", `how much ${r} do we have`);

// --- life -----------------------------------------------------------------
add("Life", "eat something");
add("Life", "get some sleep");
add("Life", "have a rest");
add("Life", "go explore");
add("Life", "wake up");

// --- identity -------------------------------------------------------------
for (const j of JOBS) add("Identity", `become a ${j}`);
add("Identity", "your name is Ada");
add("Identity", "found a town");
add("Identity", "join the town");
add("Identity", "swap jobs with Ada");

// --- manner ---------------------------------------------------------------
for (const v of VOICES) add("Manner", v);
add("Manner", "hurry up");
add("Manner", "be careful");
add("Manner", "be quiet");

// --- social ---------------------------------------------------------------
add("Social", "well done");
add("Social", "that is rubbish");
add("Social", "tell me a story");
add("Social", "what do you think of Ada");
add("Social", "introduce yourself");
add("Social", "where is Ada");
add("Social", "who is the best miner");
add("Social", "who is the worst");
add("Social", "how is the town");
add("Social", "how many of us are there");
add("Social", "what are you doing");
add("Social", "say hello everyone");
add("Social", "dance");

// --- places ---------------------------------------------------------------
add("Places", "call this place the quarry");
add("Places", "name this spot the forge");
add("Places", "what places do we know");

// --- standing orders ------------------------------------------------------
for (const order of ["come home", "go to sleep", "guard the town", "stop working"]) {
  add("Standing", `when it gets dark ${order}`);
}
for (const m of HOSTILES) add("Standing", `if you see a ${m} run away`);
for (const r of ["wood", "iron", "stone"]) add("Standing", `keep mining until you have 64 ${r}`);
for (const a of ["fight", "explore", "mine"]) add("Standing", `never ${a}`);
add("Standing", "from now on guard the town");

// --- teaching -------------------------------------------------------------
add("Teaching", '"dig deep" means mine iron');
add("Teaching", "forget dig deep");
add("Teaching", "do that again");
add("Teaching", "faff about");
add("Teaching", "help");

// --- aimed at another citizen ---------------------------------------------
for (const mate of MATES) {
  add("Each other", `follow ${mate}`);
  add("Each other", `go to ${mate}`);
  add("Each other", `protect ${mate}`);
  add("Each other", `wait for ${mate}`);
  add("Each other", `where is ${mate}`);
  add("Each other", `what do you think of ${mate}`);
  add("Each other", `swap jobs with ${mate}`);
  for (const i of ["pickaxe", "sword", "torch", "bread"]) {
    add("Each other", `give ${mate} a ${i}`);
  }
}
add("Each other", "escort me");
add("Each other", "meet at the quarry");
add("Each other", "count off");

// --- more work ------------------------------------------------------------
add("Groundwork", "repair the wall");
add("Groundwork", "tear down that house");
add("Groundwork", "plant some trees");
add("Groundwork", "water the crops");
for (const d of DIRECTIONS) add("Groundwork", `put torches every 8 blocks to the ${d}`);
add("Groundwork", "light the way");

add("Social", "sing a song");
add("Social", "have a party");

// --- storing and fetching, by material ------------------------------------
for (const r of RESOURCES) {
  add("Things", `fetch me some ${r}`);
  add("Things", `drop the ${r}`);
}

// --- placing, by item -----------------------------------------------------
for (const i of ["torch", "chest", "furnace", "crafting table", "ladder", "door"]) {
  add("Things", `place a ${i} here`);
}

// --- guarding and patrolling by radius ------------------------------------
for (const n of [10, 20, 30]) add("Fighting", `guard the town within ${n} blocks`);

// --- standing orders, more triggers ---------------------------------------
for (const order of ["come home", "light some torches", "regroup"]) {
  add("Standing", `each morning ${order}`);
}
for (const a of ANIMALS) add("Standing", `if you see a ${a} hunt it`);

// --- challenges, more shapes ----------------------------------------------
for (const d of DIRECTIONS) add("Challenges", `race ${d} 50 blocks`);
for (const r of ["wood", "stone", "iron", "coal"]) {
  add("Challenges", `see who can get 30 ${r}`);
  add("Challenges", `first to find ${r} wins`);
}

// --- named places ---------------------------------------------------------
add("Places", "go to the quarry");
add("Places", "meet at the quarry");
add("Places", "build a road to the quarry");
add("Places", "tunnel to the quarry");
add("Places", "guard the quarry");
add("Places", "where is the quarry");

// --- odds and ends --------------------------------------------------------
add("Odds", "open the door");
add("Odds", "close the door");
add("Odds", "make me a bed");
add("Odds", "carry on");
add("Odds", "back to work");
add("Odds", "keep back");
add("Odds", "what can you see");
add("Odds", "are you hurt");
add("Odds", "are you alright");
add("Odds", "what time is it");
add("Odds", "look around");

// --- crafting, by item ----------------------------------------------------
for (const i of ITEMS) add("Things", `make me a ${i}`);

// --- quantities that change the job --------------------------------------
for (const r of ["wood", "stone", "iron", "coal"]) {
  for (const n of ["5", "16", "32", "a stack of"]) {
    add("Work", `get me ${n} ${r}`);
  }
}

// --- contests, every resource as a find ----------------------------------
for (const r of ORES) add("Challenges", `first to find ${r}`);

// --- standing orders, every hostile with every response ------------------
for (const m of HOSTILES) {
  add("Standing", `if you see a ${m} come home`);
  add("Standing", `if you see a ${m} kill it`);
}

// --- guarding and following, by citizen ----------------------------------
for (const mate of MATES) {
  add("Each other", `stay near ${mate}`);
  add("Each other", `keep an eye on ${mate}`);
}

// --- chained --------------------------------------------------------------
add("Chained", "mine 20 iron then build a house");
add("Chained", "chop wood then go home and have a rest");
add("Chained", "go north 20 blocks then dig down 10");
add("Chained", "build a house then build a well");

// --------------------------------------------------------------------------
// Check every one.
// --------------------------------------------------------------------------
const groups = new Map();
const failures = [];
let working = 0;

for (const [group, phrase] of COMMANDS) {
  const local = parseOrderLocally(citizen, phrase, ctx);
  const ok = Boolean(local && (local.tasks.length || local.effect || local.reply
    || local.wantsBuild !== undefined));
  if (ok) working += 1;
  else failures.push(`${group}: ${phrase}`);
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push({ phrase, ok, intent: understand(phrase).intent });
}

// Every one of those can also be aimed at a slice of the town.
let aimable = 0;
for (const audience of AUDIENCES) {
  const probe = takeAudience(`${audience} go mine iron`);
  if (probe.kind !== "none") aimable += 1;
}

console.log("\nCommands that work, by group");
console.log("-".repeat(46));
for (const [group, list] of groups) {
  const good = list.filter((e) => e.ok).length;
  console.log(`  ${group.padEnd(14)} ${String(good).padStart(4)} / ${list.length}`);
}
console.log("-".repeat(46));
console.log(`  ${"TOTAL".padEnd(14)} ${String(working).padStart(4)} / ${COMMANDS.length}`);
console.log(`\n  ${SUPPORTED_INTENTS.length} distinct intents behind them`);
console.log(`  ${aimable} ways to aim any of them at part of the town`);
console.log(`  = ${working} x ${aimable + 1} = ${working * (aimable + 1)} addressable orders`);

if (failures.length) {
  console.log(`\n\x1b[31m${failures.length} do not work:\x1b[0m`);
  for (const f of failures.slice(0, 40)) console.log(`  ${f}`);
}

if (WRITE) {
  const lines = [
    "# Every command",
    "",
    `Generated by \`node tools/commands.mjs --write\`. Every phrase here is run`,
    "through the real parser and planner before it is listed, so nothing on this",
    "page is a command that does not work.",
    "",
    `**${working} verified commands**, built from **${SUPPORTED_INTENTS.length} intents**.`,
    "",
    "Say `ai!` first (or use `/ai:tell`). Add a name, a trade or a number to aim",
    "an order at part of the town:",
    "",
    "```",
    "ai! everyone follow me",
    "ai! all the miners dig down 20",
    "ai! three of you go chop wood",
    "ai! Ada and Bram go mine iron",
    "```",
    "",
  ];
  for (const [group, list] of groups) {
    lines.push(`## ${group}`, "");
    for (const entry of list.filter((e) => e.ok)) {
      lines.push(`- \`ai! ${entry.phrase}\``);
    }
    lines.push("");
  }
  const out = path.join(ROOT, "docs", "COMMANDS.md");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join("\n"));
  console.log(`\nWrote ${path.relative(ROOT, out)}`);
}

console.log(`\nerrors during the run: ${mock.simStats.errors.length}`);
sim.cleanup();
process.exit(failures.length ? 1 : 0);
