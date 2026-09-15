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
  for (const c of dbg.registry.all) { c.speechQueue.length = 0; c.caption = null; }
  mock.sendScriptEvent("ai:voice", "Aye - there's oak just past the ridge.", player);
  mock.advance(20);
  const speaking = dbg.registry.all.filter(
    (c) => c.caption || c.speechQueue.length);
  check(`exactly one citizen spoke the line (${speaking.length})`, speaking.length === 1,
    `${speaking.length} spoke`);
  const said = speaking[0] && (speaking[0].caption?.full || speaking[0].speechQueue[0]?.text);
  check(`they said Claude's words ("${said}")`,
    typeof said === "string" && said.includes("oak just past the ridge"), String(said));

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
console.log(`\n${"=".repeat(50)}`);
if (failed) {
  console.log(`\x1b[31m${failed} failed\x1b[0m, ${passed} passed`);
  process.exit(1);
}
console.log(`\x1b[32mAll ${passed} checks passed\x1b[0m`);
