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
console.log(`\n${"=".repeat(50)}`);
if (failed) {
  console.log(`\x1b[31m${failed} failed\x1b[0m, ${passed} passed`);
  process.exit(1);
}
console.log(`\x1b[32mAll ${passed} checks passed\x1b[0m`);
