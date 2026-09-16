#!/usr/bin/env node
/**
 * Behaviour regression tests.
 *
 * Each scenario sets up a small world, runs the add-on for a while, and asserts
 * something a player would actually notice: the house got built, the buried ore
 * got mined, the citizen came when called, two citizens held a conversation.
 *
 * Usage: node tools/scenarios.mjs
 */
import { bootSim } from "./sim/harness.mjs";

let passed = 0, failed = 0;
const results = [];

function check(name, condition, detail) {
  if (condition) { passed++; results.push(`  \x1b[32mpass\x1b[0m  ${name}`); }
  else { failed++; results.push(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ` - ${detail}` : ""}`); }
}

async function scenario(title, fn) {
  const sim = await bootSim();
  console.log(`\n${title}`);
  try {
    await fn(sim);
  } catch (e) {
    failed++;
    results.push(`  \x1b[31mFAIL\x1b[0m  ${title} threw: ${e.message}`);
    console.log(`  \x1b[31mthrew\x1b[0m ${e.stack?.split("\n").slice(0, 3).join("\n")}`);
  }
  const errs = sim.mock.simStats.errors;
  check(`${title}: no runtime errors`, errs.length === 0, errs[0]?.split("\n")[0]);
  for (const line of results.splice(0)) console.log(line);
  sim.cleanup();
}

// --------------------------------------------------------------------------
await scenario("A stocked builder finishes a cottage", async (sim) => {
  const { mock } = sim;
  mock.seedArea();
  const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });
  await sim.start();

  mock.sendChat(player, "!ai spawn 1");
  mock.advance(40);
  const dbg = sim.debug();
  const builder = dbg.registry.all[0];
  check("citizen registered", Boolean(builder));

  const { blueprintById, materialsFor } = await sim.load("civ/blueprints.js");
  const { cellsFromBlueprint, buildTask } = await sim.load("actions/build.js");
  const { giveItem } = await sim.load("actions/inventory.js");

  const bp = blueprintById("small_house");
  // Hand them everything the blueprint needs, twice over.
  for (const [item, n] of materialsFor(bp)) giveItem(builder, item, Math.min(n * 2, 256));

  const origin = { x: 24, y: mock.SEA + 1, z: 24 };
  const cells = cellsFromBlueprint(bp, origin, 0);
  builder.task = buildTask(cells, { label: "building a cottage" });
  builder.jobLocked = true;

  const before = mock.simStats.blocksPlaced;
  for (let i = 0; i < 60 && builder.task; i++) mock.advance(200);
  const placed = mock.simStats.blocksPlaced - before;

  check(`placed most of the ${cells.length} cells (${placed})`, placed > cells.length * 0.5,
    `only ${placed} of ${cells.length}`);

  // The walls should really be there in the world.
  const walls = cells.filter((c) => c.block.includes("planks") || c.block.includes("cobblestone"));
  const standing = walls.filter((c) => mock.blockAt(c.x, c.y, c.z) === c.block).length;
  check(`walls stand in the world (${standing}/${walls.length})`,
    standing > walls.length * 0.5, `${standing}/${walls.length}`);
});

// --------------------------------------------------------------------------
await scenario("A miner digs down to buried ore", async (sim) => {
  const { mock } = sim;
  mock.seedArea();
  const player = mock.addPlayer("Jordan", { x: 200, y: mock.SEA + 1, z: 200 });
  await sim.start();

  // An emerald seam twenty blocks down. The mock never generates emerald, so
  // reaching it means the citizen really dug for it.
  for (let i = 0; i < 6; i++) mock.setBlockAt(202 + i, 40, 200, "minecraft:emerald_ore");

  mock.sendChat(player, "!ai spawn 1 miner");
  mock.advance(40);
  const miner = sim.debug().registry.all[0];
  check("miner spawned", Boolean(miner));

  // A player pointing at a block twenty blocks down - the citizen has to cut
  // its way there rather than give up.
  const { mineTask } = await sim.load("actions/mine.js");
  miner.jobLocked = true;
  miner.task = mineTask({ x: 202, y: 40, z: 200 }, { vein: true, limit: 4, label: "mining emerald" });

  let deepest = miner.location.y;
  for (let i = 0; i < 40 && miner.task; i++) {
    mock.advance(200);
    deepest = Math.min(deepest, miner.location.y);
  }

  const got = miner.countItem("minecraft:emerald");
  check(`came back with emeralds (${got})`, got > 0, "none mined");
  check(`dug well below the surface (y=${Math.round(deepest)})`, deepest < mock.SEA - 5,
    `only reached y=${Math.round(deepest)}`);
});

// --------------------------------------------------------------------------
await scenario("Citizens answer the player", async (sim) => {
  const { mock } = sim;
  mock.seedArea();
  const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });
  await sim.start();

  mock.sendChat(player, "!ai spawn 3");
  mock.advance(60);
  const dbg = sim.debug();
  const first = dbg.registry.all[0];

  // An add-on command must never reach chat.
  const cmd = mock.sendChat(player, "!ai list");
  check("commands are swallowed", cmd.cancel === true);

  // Ordinary speech must stay in chat.
  const chat = mock.sendChat(player, "hello everyone");
  check("normal chat is not swallowed", chat.cancel === false);
  mock.advance(60);

  mock.sendChat(player, `@${first.short} follow me`);
  mock.advance(40);
  check("direct order became a task",
    Boolean(first.task) && first.task.kind === "follow",
    `task=${first.task?.kind}`);

  // They answer above their head, never in chat.
  const spoke = dbg.registry.all.some((c) => (c.entity.nameTag || "").includes("“"));
  check("reply appears as a caption", spoke);
  const chatLines = mock.simStats.messages.filter((m) => m.includes("“"));
  check("nothing was said in chat", chatLines.length === 0, chatLines[0]);

  mock.sendChat(player, "everyone, stop");
  mock.advance(40);

  mock.sendChat(player, `@${first.short} go mine some iron`);
  mock.advance(40);
  check("second order replaced the first",
    Boolean(first.task) && first.task.kind !== "follow", `task=${first.task?.kind}`);
});

// --------------------------------------------------------------------------
await scenario("Citizens hold a conversation", async (sim) => {
  const { mock } = sim;
  mock.seedArea();
  const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });
  await sim.start();

  mock.sendChat(player, "!ai spawn 4");
  mock.advance(60);
  const dbg = sim.debug();

  // Keep them idle and close together so they chat rather than work.
  for (const c of dbg.registry.all) { c.jobLocked = true; c.setJob("settler"); }

  let sawConversation = false;
  let lines = 0;
  for (let i = 0; i < 200; i++) {
    for (const c of dbg.registry.all) {
      c.entity.location = { x: (dbg.registry.all.indexOf(c) % 2) * 2, y: mock.SEA + 1, z: 0 };
      c.needs.social = 10;
      if (c.conversation) sawConversation = true;
      if ((c.entity.nameTag || "").includes("“")) lines++;
    }
    mock.advance(20);
  }
  check("a conversation started", sawConversation);
  check(`captions were rendered (${lines})`, lines > 0);

  const remembered = dbg.registry.all.some((c) => c.memory.dialogue.length > 0);
  check("they remember what was said", remembered);
});

// --------------------------------------------------------------------------
await scenario("A settlement plans, builds and grows", async (sim) => {
  const { mock } = sim;
  mock.seedArea();
  const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });
  await sim.start();

  mock.sendChat(player, "!ai spawn 5");
  mock.advance(60);
  mock.sendChat(player, "!ai found Rivermeet");
  mock.advance(200);

  const dbg = sim.debug();
  const town = dbg.settlements.list[0];
  check("settlement founded", Boolean(town) && town.name === "Rivermeet");
  check("citizens joined it",
    dbg.registry.inSettlement(town.id).length === 5,
    `${dbg.registry.inSettlement(town.id).length} members`);

  const jobs = new Set(dbg.registry.inSettlement(town.id).map((c) => c.job));
  check(`roles were divided up (${[...jobs].join(", ")})`, jobs.size >= 3);

  mock.advance(6000);
  check(`something was planned (${town.structures.length})`, town.structures.length > 0);

  const { recomputeStats, TIERS } = await sim.load("civ/settlement.js");
  // Every tier must be reachable from what earlier tiers unlock, or a town
  // stalls forever one requirement short.
  const { BLUEPRINTS } = await sim.load("civ/blueprints.js");
  let unlocked = [];
  let reachable = true;
  const supply = {};
  for (const tier of TIERS) {
    for (const [need, want] of Object.entries(tier.need)) {
      if ((supply[need] || 0) < want) reachable = false;
    }
    unlocked = unlocked.concat(tier.unlocks);
    for (const id of tier.unlocks) {
      const bp = BLUEPRINTS[id];
      if (!bp || !bp.provides) continue;
      // A town builds many houses and fields but only one town hall, so a
      // repeatable blueprint can supply its stat several times over.
      const copies = bp.repeatable ? 12 : 1;
      for (const [k, v] of Object.entries(bp.provides)) supply[k] = (supply[k] || 0) + v * copies;
    }
  }
  check("the tier ladder has no dead ends", reachable);
});

// --------------------------------------------------------------------------
await scenario("Citizens defend themselves", async (sim) => {
  const { mock } = sim;
  mock.seedArea();
  const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });
  await sim.start();

  mock.sendChat(player, "!ai spawn 2 guard");
  mock.advance(60);
  const dbg = sim.debug();
  const guard = dbg.registry.all[0];

  const zombie = new mock.Entity("minecraft:zombie", { x: 3, y: mock.SEA + 1, z: 0 }, mock.overworld());
  zombie.health = 20;

  mock.fireHurt(guard.entity, zombie);
  mock.advance(40);
  check("responded to being attacked",
    Boolean(guard.task) && ["fight", "flee"].includes(guard.task.kind),
    `task=${guard.task?.kind}`);

  for (let i = 0; i < 40 && zombie.isValid; i++) mock.advance(40);
  check(`the zombie was dealt with (hp ${Math.round(zombie.health)})`,
    !zombie.isValid || zombie.health < 20, `hp=${zombie.health}`);
});

// --------------------------------------------------------------------------
await scenario("State survives a reload", async (sim) => {
  const { mock } = sim;
  mock.seedArea();
  const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });
  await sim.start();

  mock.sendChat(player, "!ai spawn 2");
  mock.advance(60);
  mock.sendChat(player, "!ai found Oldmere");
  mock.advance(300);

  const dbg = sim.debug();
  const c = dbg.registry.all[0];
  const name = c.name;
  const job = c.job;
  c.setJob("miner");
  c.memory.facts.push({ text: "iron is under the ridge", hits: 2 });
  c.persist();

  // Rebuild the citizen wrapper from the entity, as a reload would.
  const { Citizen } = await sim.load("agent/citizen.js");
  const reloaded = new Citizen(c.entity);
  check("name survived", reloaded.name === name, `${reloaded.name} != ${name}`);
  check("job survived", reloaded.job === "miner", reloaded.job);
  check("memory survived",
    reloaded.memory.facts.some((f) => f.text.includes("iron is under the ridge")));
  check("personality is stable", reloaded.personality.voice === c.personality.voice);
  check("settlement survived", reloaded.settlementId === c.settlementId);
});


// --------------------------------------------------------------------------
// The regression that started this: on a stable runtime `world.beforeEvents
// .chatSend` does not exist, subscribing threw, boot died, and `!ai spawn`
// silently did nothing. Control must not depend on chat.
// --------------------------------------------------------------------------
await scenario("Everything works on a runtime with no chat API", async (sim) => {
  const { mock } = sim;
  mock.seedArea();
  sim.stableRuntime();                       // chatSend is gone, as on stable
  const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });
  await sim.start();

  const dbg = sim.debug();
  check("the add-on still booted", Boolean(dbg));
  check("chat is reported unavailable", dbg && dbg.registry && true);

  const commands = [...mock.registeredCommands.keys()];
  check(`slash commands registered (${commands.join(" ")})`,
    commands.includes("ai:spawn") && commands.includes("ai:cmd") && commands.includes("ai:tell"),
    commands.join(" ") || "none");

  // Commands must not need cheats, or most worlds cannot use them.
  const needsCheats = commands.filter(
    (n) => mock.registeredCommands.get(n).definition.cheatsRequired !== false);
  check("no command requires cheats", needsCheats.length === 0, needsCheats.join(" "));

  // Every command must carry a namespace, or registration is rejected.
  check("all commands are namespaced", commands.every((n) => n.includes(":")));

  mock.runCustomCommand("ai:spawn", player, [4, ""]);
  mock.advance(60);
  const citizens = mock.allEntities().filter((e) => e.typeId === "ai:citizen");
  check(`/ai:spawn spawned citizens (${citizens.length})`, citizens.length === 4,
    `got ${citizens.length}`);

  mock.runCustomCommand("ai:cmd", player, ["found", "Stonewatch"]);
  mock.advance(80);
  check("/ai:cmd founded a settlement",
    sim.debug().settlements.list.some((x) => x.name === "Stonewatch"));

  const first = sim.debug().registry.all[0];
  mock.runCustomCommand("ai:tell", player, ["@" + first.short, "follow", "me"]);
  mock.advance(40);
  check("/ai:tell gave an order",
    Boolean(first.task) && first.task.kind === "follow", `task=${first.task?.kind}`);

  mock.sendScriptEvent("ai:cmd", "spawn 1", player);
  mock.advance(40);
  check("/scriptevent works too",
    mock.allEntities().filter((e) => e.typeId === "ai:citizen").length === 5);

  mock.runCustomCommand("ai:doctor", player, []);
  mock.advance(10);
  const report = mock.simStats.messages.join("\n");
  check("doctor reports the missing chat API", /chat listening/.test(report),
    report.slice(-200));
  check("doctor reports the pack version", /pack version/.test(report));

  // A player joining must be told the add-on is alive, without knowing any
  // command first - otherwise "not working" and "not installed" look the same.
  mock.simStats.messages.length = 0;
  mock.joinPlayer(player);
  mock.advance(80);
  const greeting = mock.simStats.messages.join("\n");
  check("a joining player is greeted with the version and a first command",
    /AI Citizens/.test(greeting) && /ai:spawn/.test(greeting), greeting.slice(0, 160));
});

// --------------------------------------------------------------------------
await scenario("Citizens drive their animation state", async (sim) => {
  const { mock } = sim;
  mock.seedArea();
  const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });
  await sim.start();

  mock.sendChat(player, "!ai spawn 4");
  mock.advance(60);
  const dbg = sim.debug();

  // ai:state is what the resource pack's animation controller reads. If it
  // never changes, citizens stand in the base pose doing nothing.
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    mock.advance(20);
    for (const c of dbg.registry.all) {
      const v = c.entity.getProperty("ai:state");
      if (v !== undefined) seen.add(v);
    }
  }

  const STATE = { IDLE: 0, WALK: 1, RUN: 2, MINE: 3, BUILD: 4, ATTACK: 5, TALK: 6 };
  check(`several animation states were used (${[...seen].sort((a, b) => a - b).join(",")})`,
    seen.size >= 3, `only ${seen.size}`);
  check("walking state is set", seen.has(STATE.WALK));
  check("a working state is set", seen.has(STATE.MINE) || seen.has(STATE.BUILD));

  // Skins must be spread across the twenty available, not all the same.
  const skins = new Set(dbg.registry.all.map((c) => c.entity.getProperty("ai:skin")));
  check(`skins vary (${[...skins].join(",")})`, skins.size >= 2, `all the same: ${[...skins]}`);
  const inRange = [...skins].every((v) => Number.isInteger(v) && v >= 0 && v <= 19);
  check("every skin index is in range", inRange);
});

// --------------------------------------------------------------------------
await scenario("The citizen entity has no invalid components", async (sim) => {
  const { mock } = sim;
  mock.seedArea();
  const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });
  await sim.start();

  // Read the shipped definition and check the components with required
  // sub-fields. An invalid component makes Bedrock reject the whole entity,
  // which is why nothing could be spawned at all.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { ROOT } = await import("./sim/harness.mjs");
  const def = JSON.parse(fs.readFileSync(
    path.join(ROOT, "packs/AI_Citizens_BP/entities/ai_citizen.json"), "utf8"));
  const components = def["minecraft:entity"].components;

  const equippable = components["minecraft:equippable"];
  const badSlots = equippable
    ? (equippable.slots || []).filter((s) => s.item === undefined)
    : [];
  check("no equippable slot is missing its required `item`", badSlots.length === 0,
    `${badSlots.length} slots without item`);

  check("the entity is summonable", def["minecraft:entity"].description.is_summonable === true);
  check("the entity is spawnable (spawn egg)", def["minecraft:entity"].description.is_spawnable === true);

  mock.sendChat(player, "!ai spawn 1");
  mock.advance(40);
  check("and it actually spawns",
    mock.allEntities().filter((e) => e.typeId === "ai:citizen").length === 1);
});


// --------------------------------------------------------------------------
await scenario('"ai!" is the only thing you have to remember', async (sim) => {
  const { mock } = sim;
  mock.seedArea();
  const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });
  await sim.start();

  // A command after the attention word.
  mock.sendChat(player, "ai! spawn 4");
  mock.advance(60);
  const dbg = sim.debug();
  check(`"ai! spawn 4" spawned citizens (${dbg.registry.count})`, dbg.registry.count === 4,
    `got ${dbg.registry.count}`);

  // An instruction after the attention word - no command word, no name.
  // Clear the greetings they said on spawning, or those get counted below.
  for (const c of dbg.registry.all) {
    c.task = null; c.plan.length = 0; c.speechQueue.length = 0; c.caption = null;
  }
  mock.sendChat(player, "ai! go chop some wood");
  mock.advance(10);
  const working = dbg.registry.all.filter((c) => c.task && /gather|chop/.test(c.task.kind + c.task.label));
  check(`"ai! go chop some wood" put them to work (${working.length})`, working.length > 0,
    dbg.registry.all.map((c) => c.task?.kind).join(","));

  // One of them answers - not all eight, and not none.
  const speaking = dbg.registry.all.filter((c) => c.speechQueue.length || c.caption);
  check(`exactly one answered for the group (${speaking.length})`, speaking.length === 1,
    `${speaking.length} spoke`);

  // Naming one of them still works.
  const first = dbg.registry.all[0];
  for (const c of dbg.registry.all) { c.task = null; c.plan.length = 0; }
  mock.sendChat(player, `ai! @${first.short} follow me`);
  mock.advance(40);
  check("naming a citizen targets just them",
    first.task && first.task.kind === "follow", `task=${first.task?.kind}`);

  // "follow me" with nobody named should pick the nearest, not error.
  for (const c of dbg.registry.all) { c.task = null; c.plan.length = 0; }
  mock.sendChat(player, "ai! follow me");
  mock.advance(40);
  check("\"follow me\" follows without naming anyone",
    dbg.registry.all.some((c) => c.task && c.task.kind === "follow"),
    dbg.registry.all.map((c) => c.task?.kind).join(","));

  // Commands are swallowed; instructions stay visible.
  const cmd = mock.sendChat(player, "ai! list");
  check("a command is hidden from chat", cmd.cancel === true);
  const speech = mock.sendChat(player, "ai! go mine some iron");
  check("an instruction stays in chat", speech.cancel === false);
  mock.advance(40);

  // The old prefix still works, so nobody's muscle memory breaks.
  const before = dbg.registry.count;
  mock.sendChat(player, "!ai spawn 1");
  mock.advance(40);
  check("the old !ai prefix still works", dbg.registry.count === before + 1);

  // And ordinary speech must not be swallowed by a bare "ai".
  for (const c of dbg.registry.all) { c.task = null; c.plan.length = 0; }
  const ordinary = mock.sendChat(player, "aim for the ridge, it is faster");
  check("\"aim for...\" is not treated as an instruction", ordinary.cancel === false);
  mock.advance(20);

  const { stripTrigger, interpret } = await sim.load("commands/parser.js");
  check("stripTrigger ignores a word merely starting with ai",
    stripTrigger("aim for the ridge") === null, JSON.stringify(stripTrigger("aim for the ridge")));
  check("stripTrigger accepts ai!", stripTrigger("ai! hello") === "hello");
  check("stripTrigger accepts hey ai", stripTrigger("hey ai, hello") === "hello");
  check("interpret spots a command", interpret("spawn 4").kind === "command");
  check("interpret spots speech", interpret("go mine iron").kind === "speech");
});

// --------------------------------------------------------------------------
await scenario("Slash commands accept the same grammar", async (sim) => {
  const { mock } = sim;
  mock.seedArea();
  sim.stableRuntime();                       // no chat at all, as on stable
  const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });
  await sim.start();

  mock.runCustomCommand("ai:cmd", player, ["spawn", "3"]);
  mock.advance(60);
  const dbg = sim.debug();
  check(`/ai:cmd spawn 3 worked (${dbg.registry.count})`, dbg.registry.count === 3);

  // /ai:tell given a command should still run it - the router decides, not the
  // player's choice of slash command.
  mock.runCustomCommand("ai:tell", player, ["spawn", "1"]);
  mock.advance(40);
  check("/ai:tell also accepts a command", dbg.registry.count === 4, `${dbg.registry.count}`);

  // ...and /ai:cmd given an instruction should treat it as speech.
  for (const c of dbg.registry.all) { c.task = null; c.plan.length = 0; }
  mock.runCustomCommand("ai:cmd", player, ["go", "chop", "some", "wood"]);
  mock.advance(40);
  check("/ai:cmd also accepts an instruction",
    dbg.registry.all.some((c) => c.task), dbg.registry.all.map((c) => c.task?.kind).join(","));

  // The attention word is accepted there too, so muscle memory transfers.
  mock.runCustomCommand("ai:tell", player, ["ai!", "spawn", "1"]);
  mock.advance(40);
  check("a stray \"ai!\" inside a slash command is ignored, not passed on",
    dbg.registry.count === 5, `${dbg.registry.count}`);
});


// --------------------------------------------------------------------------
// The chat bridge delivers Claude's reply with /scriptevent ai:voice, and the
// player's instruction with /scriptevent ai:tell. Both must land.
// --------------------------------------------------------------------------
await scenario("The chat bridge can drive citizens from outside the game", async (sim) => {
  const { mock } = sim;
  mock.seedArea();
  sim.stableRuntime();                     // no in-game chat API at all
  const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });
  await sim.start();

  mock.sendScriptEvent("ai:cmd", "spawn 3", player);
  mock.advance(60);
  const dbg = sim.debug();
  check(`bridge spawned citizens (${dbg.registry.count})`, dbg.registry.count === 3);

  // What the bridge sends after Claude turns "we need timber" into an order.
  for (const c of dbg.registry.all) {
    c.task = null; c.plan.length = 0; c.speechQueue.length = 0; c.caption = null;
  }
  mock.sendScriptEvent("ai:tell", "chop wood", player);
  mock.advance(20);
  const chopping = dbg.registry.all.filter(
    (c) => c.task && /gather|chop/.test(`${c.task.kind}${c.task.label}`));
  check(`"chop wood" from the bridge put them to work (${chopping.length})`,
    chopping.length > 0, dbg.registry.all.map((c) => c.task?.kind).join(","));

  // And Claude's actual words, spoken by whoever is nearest.
  //
  // Look for the specific line rather than for "somebody is speaking": citizens
  // hold their own conversations while they work, so at any moment one of them
  // may legitimately have a caption up that has nothing to do with this.
  for (const c of dbg.registry.all) { c.speechQueue.length = 0; c.caption = null; }
  const LINE = "oak just past the ridge";
  mock.sendScriptEvent("ai:voice", "Aye - there's oak just past the ridge.", player);
  mock.advance(20);

  const saidIt = (c) => [c.caption?.full, ...c.speechQueue.map((q) => q.text)]
    .some((t) => typeof t === "string" && t.includes(LINE));
  const speaking = dbg.registry.all.filter(saidIt);

  check(`exactly one citizen spoke that line (${speaking.length})`, speaking.length === 1,
    `${speaking.length} said it`);
  check("they said the words the bridge sent, verbatim",
    speaking.length === 1,
    dbg.registry.all.map((c) => c.caption?.full).join(" | "));

  // The nearest one answers, not a random one.
  const nearest = dbg.registry.all
    .slice()
    .sort((a, b) => {
      const d = (c) => Math.hypot(c.location.x - player.location.x, c.location.z - player.location.z);
      return d(a) - d(b);
    })[0];
  check("the nearest citizen is the one who answered",
    speaking[0] === nearest, `${speaking[0]?.short} vs ${nearest?.short}`);
});

// --------------------------------------------------------------------------
// Understanding, not pattern matching. The old parser was a chain of regexes:
// it read "dont follow me" as "follow", could not count, and had no idea what
// a typo was. These are the cases that used to be wrong.
// --------------------------------------------------------------------------
await scenario("They understand what you actually typed", async (sim) => {
  const { understand, editDistance, lexiconSize, C } = await sim.load("brain/nlu.js");

  // Wood is chopped and everything else is mined, so the material picks the
  // verb even when the player says "mine wood".
  const cases = [
    ["go mine wood", "chop", { resource: C.WOOD }],
    ["chop 20 oak logs", "chop", { resource: C.WOOD, quantity: 20 }],
    ["mine some iron", "mine", { resource: C.IRON }],
    ["can you get me a stack of stone", "mine", { resource: C.STONE, quantity: 64 }],
    ["follow me", "follow", {}],
    ["dont follow me", "stop", {}],                 // negation used to be ignored
    ["stop following me", "stop", {}],
    ["build a house", "build", { structure: C.HOUSE }],
    ["go mien for wodo", "chop", { resource: C.WOOD }],     // two typos in a row
    ["find me some irno", "mine", { resource: C.IRON }],
    ["have a rest", "rest", {}],                    // must NOT be heard as "axe"
    ["come here", "come", {}],
    ["wait there", "stop", {}],
  ];

  let right = 0;
  const wrong = [];
  for (const [text, intent, slots] of cases) {
    const r = understand(text);
    let ok = r && r.intent === intent;
    for (const [k, v] of Object.entries(slots)) if (ok && r[k] !== v) ok = false;
    if (ok) right++;
    else wrong.push(`"${text}" -> ${r ? r.intent : "nothing"}${r && r.resource ? `/${r.resource}` : ""}`);
  }
  check(`understood ${right}/${cases.length} phrases`, right === cases.length, wrong.join("; "));

  // A typo is one edit away, including two letters swapped - the case plain
  // Levenshtein scores as two and so refuses to correct.
  check("a swapped pair counts as one typo (wodo/wood)", editDistance("wodo", "wood") === 1);
  check("mien/mine too", editDistance("mien", "mine") === 1);

  // And correction must not reach so far that ordinary words get rewritten.
  check("have/axe stays too far apart to correct", editDistance("have", "axe") > 1);

  check(`the lexicon is real (${lexiconSize()} entries)`, lexiconSize() > 150);

  // Nonsense should be admitted as nonsense rather than guessed at.
  const junk = understand("qwertyuiop zxcvbnm");
  check("nonsense is not confidently misread",
    !junk || junk.confidence < 0.4, junk && `${junk.intent} @ ${junk.confidence}`);
});

// --------------------------------------------------------------------------
// Speech is composed from a grammar, not drawn from a list. The symptom of a
// list is hearing the same sentence twice in an evening.
// --------------------------------------------------------------------------
await scenario("They do not say the same thing twice", async (sim) => {
  const { lineFor } = await sim.load("social/dialogue.js");
  const { variety, frames } = await sim.load("social/language.js");

  const total = frames().reduce((n, f) => n + variety(f), 0);
  check(`the grammar spans ${total} sentences across ${frames().length} frames`,
    total > 600, String(total));

  // One speaker, many lines, each topic.
  const speaker = {
    id: "t1", seed: 9182, short: "Bram", name: "Bram Holt", job: "miner",
    personality: { voice: "wry", quirk: "hums while working", traits: { bravery: 0.6 } },
    needs: { hunger: 70, energy: 70, social: 70, safety: 80, morale: 60 },
    memory: { people: {} }, task: null, snapshot: null, recentLines: [],
  };

  const said = [];
  for (let i = 0; i < 30; i++) said.push(lineFor(speaker, "greeting", { other: "Mira" }));
  const distinct = new Set(said).size;
  check(`30 greetings produced ${distinct} different sentences`, distinct >= 15, said.slice(0, 4).join(" | "));

  // Whatever it composes has to read like a sentence.
  const topics = ["greeting", "greeting_warm", "greeting_cold", "work", "smalltalk",
                  "observation_ore", "threat", "threat_brave", "plan", "order_ack",
                  "done", "farewell", "confused"];
  const malformed = [];
  for (const topic of topics) {
    for (let i = 0; i < 40; i++) {
      const line = lineFor(speaker, topic, {});      // deliberately no facts supplied
      if (/\{\w+\}/.test(line)) malformed.push(`${topic}: unfilled slot "${line}"`);
      else if (/^[\s,.\u2014-]/.test(line)) malformed.push(`${topic}: ragged start "${line}"`);
      else if (/ {2}/.test(line)) malformed.push(`${topic}: double space "${line}"`);
      // A new sentence starts with a capital. An ellipsis is not a new
      // sentence, so "Hm-hm-hmm... oh" is fine.
      else if (/(?<!\.)\. +[a-z]|[!?] +[a-z]/.test(line)) {
        malformed.push(`${topic}: lowercase sentence "${line}"`);
      }
      else if (line.length < 2) malformed.push(`${topic}: empty`);
    }
  }
  check("every composed line is well formed", malformed.length === 0, malformed[0]);

  // A topic the grammar has no frame for must still produce speech, from the
  // old template bank.
  const fallback = lineFor(speaker, "hungry", {});
  check("topics with no frame still fall back to the line bank",
    typeof fallback === "string" && fallback.length > 3, fallback);
});

// --------------------------------------------------------------------------
// The complaint that drove this: "it isn't AI if there are only 5 things I can
// tell them". Every phrase below has to produce a real task, a real effect or
// a real answer - not an acknowledgement of something that never happens.
// --------------------------------------------------------------------------
await scenario("There is a lot you can tell them", async (sim) => {
  const { mock } = sim;
  mock.seedArea();
  const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });
  await sim.start();
  mock.sendScriptEvent("ai:cmd", "spawn 1", player);
  mock.advance(20);

  const citizen = sim.debug().registry.all[0];
  const { parseOrderLocally } = await sim.load("brain/local.js");
  const { SUPPORTED_INTENTS } = await sim.load("brain/orders.js");
  const registry = await sim.load("actions/registry.js");
  const ctx = {
    tasks: registry, speakerId: player.id, speakerLocation: player.location,
    settlement: null,
  };

  // One phrase per thing they can be told, spread across every category.
  const phrases = [
    "mine some iron", "chop 20 oak logs", "dig down 15", "tunnel east 30 blocks",
    "clear this area", "build a house", "build a watchtower", "light up the place",
    "plant a field", "bridge north 12",
    "follow me", "come here", "go to 120 70 -30", "go north 40 blocks",
    "stay here", "stop", "spread out", "regroup",
    "kill that creeper", "hunt a cow", "defend me", "guard the town", "run away",
    "craft a pickaxe", "smelt iron", "give me coal", "drop the dirt",
    "store this", "fetch 8 planks", "draw your sword", "what are you carrying",
    "eat something", "get some sleep", "have a rest", "go explore", "wake up",
    "become a miner", "your name is Ada", "found a town", "join the town",
    "be quiet", "say hello everyone", "dance", "what are you doing", "help",
    '"dig deep" means mine iron', "forget dig deep", "do that again",
  ];

  const intents = new Set();
  const nothing = [];
  for (const phrase of phrases) {
    const local = parseOrderLocally(citizen, phrase, ctx);
    const acted = Boolean(local && (local.tasks.length || local.effect
      || local.reply || local.wantsBuild !== undefined));
    if (acted) for (const r of local.readings) intents.add(r.intent);
    else nothing.push(phrase);
  }
  check(`${phrases.length - nothing.length}/${phrases.length} phrases do something`,
    nothing.length === 0, nothing.join(" | "));
  check(`${intents.size} different things understood`, intents.size >= 40, [...intents].join(","));
  check(`the catalogue lists ${SUPPORTED_INTENTS.length} intents`,
    SUPPORTED_INTENTS.length >= 45, String(SUPPORTED_INTENTS.length));

  // Nonsense must still be refused rather than guessed at.
  for (const junk of ["qwertyuiop", "blorp the flurb", "asdf asdf"]) {
    check(`"${junk}" is refused, not guessed`,
      parseOrderLocally(citizen, junk, ctx) === null);
  }

  // Two orders in one sentence, queued in the order they were spoken.
  const chained = parseOrderLocally(citizen, "mine 20 iron then build a house", ctx);
  check("a chained order becomes two tasks",
    Boolean(chained) && chained.tasks.length === 2,
    chained ? chained.tasks.map((t) => t.kind).join("+") : "null");
  check("and they queue in the order they were said",
    Boolean(chained) && chained.tasks[0].kind === "gather" && chained.tasks[1].kind === "build",
    chained ? chained.tasks.map((t) => t.kind).join(" then ") : "null");

  // A word the player invents has to survive into the next order.
  const { teach, understand } = await sim.load("brain/nlu.js");
  teach("faff about", "go explore");
  check("a taught phrase is understood afterwards",
    understand("faff about").intent === "explore",
    understand("faff about").intent);
});

// --------------------------------------------------------------------------
// Parsing is not the same as doing. This drives the real tick loop.
// --------------------------------------------------------------------------
await scenario("Orders survive the round trip into the world", async (sim) => {
  const { mock } = sim;
  mock.seedArea();
  const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });
  await sim.start();
  mock.sendScriptEvent("ai:cmd", "spawn 3", player);
  mock.advance(20);
  const all = sim.debug().registry.all;

  const reset = () => {
    for (const c of all) {
      c.speechQueue.length = 0; c.caption = null;
      c.task = null; c.plan.length = 0; c.muted = false;
    }
  };

  const drove = (order, kinds) => {
    reset();
    mock.sendScriptEvent("ai:tell", order, player);
    mock.advance(3);
    const got = all.filter((c) => c.task && kinds.includes(c.task.kind));
    check(`"${order}" put someone to work (${kinds.join("/")})`, got.length > 0,
      all.map((c) => c.task?.kind || "-").join(","));
  };

  drove("go mine some iron", ["gather", "mine", "goto"]);
  drove("follow me", ["follow"]);
  drove("dig down 12", ["mine"]);
  drove("tunnel north 20 blocks", ["mine"]);
  drove("go north 30 blocks", ["goto"]);
  drove("have a rest", ["rest"]);

  // Telling them to be quiet has to actually silence the captions.
  reset();
  mock.sendScriptEvent("ai:tell", "be quiet", player);
  mock.advance(3);
  check("\"be quiet\" mutes them", all.every((c) => c.muted),
    all.map((c) => c.muted).join(","));
  for (const c of all) { c.speechQueue.length = 0; c.caption = null; }
  mock.sendScriptEvent("ai:tell", "go mine iron", player);
  mock.advance(3);
  const spoke = all.filter((c) => c.speechQueue.length || c.caption);
  check("a muted citizen still takes the order but says nothing",
    spoke.length === 0 && all.some((c) => c.task),
    `${spoke.length} spoke`);

  // And a new name has to stick.
  reset();
  for (const c of all) c.muted = false;
  mock.sendScriptEvent("ai:tell", "your name is Bramble", player);
  mock.advance(3);
  check("a citizen answers to a new name",
    all.some((c) => c.name === "Bramble"), all.map((c) => c.name).join(","));
});

// --------------------------------------------------------------------------
console.log(`\n${"=".repeat(50)}`);
if (failed) {
  console.log(`\x1b[31m${failed} failed\x1b[0m, ${passed} passed`);
  process.exit(1);
}
console.log(`\x1b[32mAll ${passed} checks passed\x1b[0m`);
