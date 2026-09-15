#!/usr/bin/env node
/**
 * Checks a running bridge end to end: sends the same context packet the add-on
 * sends, prints what came back, and says whether the shape is usable.
 *
 *   node test-bridge.mjs                       # http://127.0.0.1:8787
 *   node test-bridge.mjs http://host:8787 token
 */
const url = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const token = process.argv[3] || process.env.AI_CITIZENS_TOKEN || "";

const packet = {
  v: 1,
  request: "chat",
  citizen: {
    id: "test-citizen", name: "Ada Ashdown", job: "miner",
    jobBlurb: "miner - brings up stone and ore",
    personality: "wry, curious, hard-working; collects odd stones; dreams of finding iron first",
    voice: "wry", mood: "steady", needs: "hungry (32)", health: "17/20",
    inventory: "12x cobblestone, 3x coal, 1x stone pickaxe",
    bornDay: 2, goal: "fill the stores", doing: "mining",
  },
  world: {
    brief: "It is afternoon on day 6.\nStanding at 41, 58, -12 in the overworld on stone.\n"
      + "Threats: zombie 9m north.\nIn sight: 4x iron ore 6m east, 2x coal ore 11m west.",
    position: { x: 41, y: 58, z: -12 }, time: "afternoon", day: 6, night: false,
    weather: "clear", players: [{ name: "Jordan", distance: 4, direction: "east" }],
    citizens: [], threats: [{ kind: "zombie", distance: 9, direction: "north" }],
    blocks: [{ label: "iron ore", distance: 6, direction: "east", count: 4, ore: true }], hazards: [],
  },
  memory: {
    summary: "Knows: iron is under the ridge\nPeople: Jordan (friend)",
    recent: ["mined iron ore at 44,57,-10"], facts: ["iron is under the ridge"],
    conversation: ["Jordan: anyone found iron?"], order: null,
  },
  settlement: {
    name: "Rivermeet", tier: "hamlet",
    summary: "Rivermeet - a hamlet founded on day 2 by Jordan. 6 citizens, 3 buildings finished.",
    building: "cottage at 24,61,24 - building, 40% placed",
    shortages: ["oak planks: have 12, need 96"], history: ["day 5: finished the well"],
  },
  capabilities: {
    actions: [
      "- goto(x, y, z): walk to a position",
      "- mine(block, count?): find and mine blocks of a type nearby",
      "- attack(who): fight a nearby creature",
      "- store(item?): put goods in the town stores",
      "- wait(seconds?): stand still",
    ].join("\n"),
    structures: "small_house (cottage), storehouse (storehouse), well (well)",
  },
  message: {
    from: "Jordan",
    text: "Ada, we need iron for the walls - can you get some?",
    addressedToMe: true, relationship: "friend",
  },
};

const started = Date.now();
let res;
try {
  res = await fetch(`${url}/think`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-AI-Citizens-Token": token } : {}),
    },
    body: JSON.stringify(packet),
  });
} catch (e) {
  console.error(`\n\x1b[31mCould not reach the bridge at ${url}\x1b[0m\n  ${e.message}`);
  console.error("  Is it running?  cd bridge && npm start\n");
  process.exit(1);
}

const ms = Date.now() - started;
const body = await res.text();

if (!res.ok) {
  console.error(`\n\x1b[31mBridge replied ${res.status}\x1b[0m: ${body}\n`);
  process.exit(1);
}

let decision;
try {
  decision = JSON.parse(body);
} catch {
  console.error(`\n\x1b[31mBridge did not return JSON\x1b[0m:\n${body}\n`);
  process.exit(1);
}

console.log(`\n\x1b[32mBridge answered in ${ms}ms\x1b[0m\n`);
console.log(`  Ada says   ${decision.say ? `"${decision.say}"` : "(nothing)"}`);
if (decision.to) console.log(`  to         ${decision.to}`);
console.log(`  mood       ${decision.mood}`);
console.log(`  goal       ${decision.goal}`);
console.log(`  actions    ${(decision.actions || []).map((a) => `${a.do}(${[a.block, a.item, a.who, a.structure, a.count].filter(Boolean).join(", ")})`).join(" then ") || "(carry on)"}`);
if (decision.remember?.length) console.log(`  remembers  ${decision.remember.join(" | ")}`);

const problems = [];
if (typeof decision.mood !== "string") problems.push("mood is missing");
if (!Array.isArray(decision.actions)) problems.push("actions is not an array");
if (decision.say && decision.say.length > 220) problems.push("say is too long for a caption");

try {
  const stats = await (await fetch(`${url}/stats`)).json();
  console.log(`\n  model      ${stats.model}`);
  console.log(`  requests   ${stats.requests} (${stats.failures} failed, ${stats.refusals} refused)`);
  console.log(`  tokens     ${stats.inputTokens} in / ${stats.outputTokens} out, cache hit rate ${stats.cacheHitRate}`);
} catch { /* stats are a nicety */ }

if (problems.length) {
  console.error(`\n\x1b[31mProblems:\x1b[0m ${problems.join("; ")}\n`);
  process.exit(1);
}
console.log(`\n\x1b[32mLooks good - point the add-on at it with:\x1b[0m  !ai bridge ${url}\n`);
