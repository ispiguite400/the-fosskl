#!/usr/bin/env node
/**
 * Runs the behaviour pack against the mock runtime in tools/sim.
 *
 * This is not a game test - it cannot tell you a house looks right. What it
 * does tell you is that the tick loop survives thousands of ticks, that
 * citizens actually mine, build, talk, take orders and found towns, and that
 * nothing throws. Run it after any script change.
 *
 * Usage: node tools/simulate.mjs [ticks]
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const BP = path.join(root, "packs", "AI_Citizens_BP");
const TICKS = Number(process.argv.find((a) => /^\d+$/.test(a))) || 4000;
const VERBOSE = process.argv.includes("--verbose");

// --- stage the pack next to mock node_modules ------------------------------
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "ai-citizens-sim-"));
fs.cpSync(path.join(BP, "scripts"), path.join(stage, "scripts"), { recursive: true });
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({ type: "module" }));

for (const [name, src] of [
  ["@minecraft/server", path.join(here, "sim", "mock-server.js")],
  ["@minecraft/server-ui", path.join(here, "sim", "mock-ui.js")],
]) {
  const dir = path.join(stage, "node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, path.join(dir, "index.js"));
  fs.writeFileSync(path.join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", type: "module", main: "index.js" }));
}

const mock = await import(path.join(stage, "node_modules", "@minecraft", "server", "index.js"));
const ui = await import(path.join(stage, "node_modules", "@minecraft", "server-ui", "index.js"));

// --- scenario ---------------------------------------------------------------
console.log(`\nAI Citizens simulation - ${TICKS} ticks\n${"=".repeat(46)}`);
mock.seedArea();
const player = mock.addPlayer("Jordan", { x: 0, y: mock.SEA + 1, z: 0 });

await import(path.join(stage, "scripts", "main.js"));
mock.advance(60);                                   // let it boot
if (VERBOSE) { mock.sendChat(player, "!ai debug"); mock.advance(10); }

const step = (label, fn, ticks) => {
  const before = mock.simStats.errors.length;
  fn();
  mock.advance(ticks);
  const errs = mock.simStats.errors.slice(before);
  const tag = errs.length ? "\x1b[31mFAIL\x1b[0m" : "\x1b[32m ok \x1b[0m";
  console.log(`[${tag}] ${label}`);
  for (const e of errs.slice(0, 3)) console.log(`        ${e.split("\n")[0]}`);
};

step("!ai spawn 6", () => mock.sendChat(player, "!ai spawn 6"), 120);

const citizens = mock.allEntities().filter((e) => e.typeId === "ai:citizen");
console.log(`        spawned ${citizens.length}: ` +
  citizens.map((c) => (c.nameTag || "?").split("\n")[0].replace(/§./g, "")).join(", "));

step("!ai found Rivermeet", () => mock.sendChat(player, "!ai found Rivermeet"), 200);
step("!ai list", () => mock.sendChat(player, "!ai list"), 20);
step("!ai town", () => mock.sendChat(player, "!ai town"), 20);
step("!ai structures", () => mock.sendChat(player, "!ai structures"), 20);
step("ambient chat is overheard", () => mock.sendChat(player, "Is anyone finding iron out there?"), 100);

const first = citizens[0];
const firstName = (first.nameTag || "").split("\n")[0].replace(/§./g, "").split(" ")[0];
step(`direct order: @${firstName} go chop some wood`,
  () => mock.sendChat(player, `@${firstName} go chop some wood`), 600);
step("direct order: mine iron", () => mock.sendChat(player, `@${firstName} mine iron for me`), 800);
step("group order", () => mock.sendChat(player, "everyone, follow me"), 200);
step("!ai stop all", () => mock.sendChat(player, "!ai stop all"), 60);
step("!ai job <name> builder", () => mock.sendChat(player, `!ai job ${firstName} builder`), 60);
step("!ai build small_house", () => mock.sendChat(player, "!ai build small_house"), 400);
step("interact opens dialogue", () => mock.fireInteract(player, first), 40);
step("sneak-interact opens the panel", () => { player.isSneaking = true; mock.fireInteract(player, first); }, 40);
step("!ai panel", () => mock.sendChat(player, "!ai panel"), 40);
step("citizen takes damage", () => mock.fireHurt(first, player), 120);
step("night falls", () => mock.setTime(14000), 600);
step("day breaks", () => mock.setTime(1000), 600);
step("!ai who", () => mock.sendChat(player, `!ai who ${firstName}`), 20);
step("!ai status", () => mock.sendChat(player, "!ai status"), 20);
step("!ai config maxCitizens 30", () => mock.sendChat(player, "!ai config maxCitizens 30"), 20);
step("!ai brain local", () => mock.sendChat(player, "!ai brain local"), 20);

console.log("\nlong run…");
const before = mock.simStats.errors.length;
if (VERBOSE) {
  const chunk = Math.max(200, Math.round(TICKS / 12));
  for (let t = 0; t < TICKS; t += chunk) {
    mock.advance(chunk);
    const dbg = globalThis.aiCitizensDebug ? globalThis.aiCitizensDebug() : null;
    console.log(`  t+${t + chunk}  broken ${mock.simStats.blocksBroken} placed ${mock.simStats.blocksPlaced}`);
    if (!dbg) continue;
    for (const c of dbg.registry.all.slice(0, 6)) {
      const p2 = c.location;
      const t = c.task;
      const inner = t && t.current ? `>${t.current.kind}:${t.current.phase}` : "";
      const task = t ? `${t.kind}${t.phase ? ":" + t.phase : ""}${inner}` : "-";
      const nums = t
        ? `got=${t.collected ?? t.mined ?? t.placed ?? 0}/${t.count ?? t.limit ?? "-"} fail=${t.failures ?? 0} skip=${t.skip ? t.skip.size : 0}`
        : "";
      const carrying = [...c.listInventory().entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([id, n]) => `${n}${id.replace("minecraft:", "").slice(0, 6)}`).join(",");
      console.log(
        `      ${c.short.padEnd(9)} ${c.job.padEnd(11)} ${task.padEnd(30)}` +
        ` ${(c.lastResult || "").padEnd(9)} ${nums.padEnd(26)}` +
        ` @${Math.round(p2.x)},${Math.round(p2.y)},${Math.round(p2.z)} [${carrying}]`,
      );
    }
  }
} else {
  mock.advance(TICKS);
}
const runErrors = mock.simStats.errors.slice(before);

// --- report -----------------------------------------------------------------
const stats = mock.simStats;
const alive = mock.allEntities().filter((e) => e.typeId === "ai:citizen");
const markers = mock.allEntities().filter((e) => e.typeId === "ai:nav_point");
const captions = [...stats.nameTags.values()];

console.log(`\n${"=".repeat(46)}\nResults`);
console.log(`  citizens alive     ${alive.length}`);
console.log(`  waypoint markers   ${markers.length} (should stay small)`);
console.log(`  blocks broken      ${stats.blocksBroken}`);
console.log(`  blocks placed      ${stats.blocksPlaced}`);
console.log(`  sounds played      ${stats.sounds}`);
console.log(`  chat messages      ${stats.messages.length}`);

const speaking = alive.filter((c) => (c.nameTag || "").includes("“"));
console.log(`  speaking right now ${speaking.length}`);

const sampleLines = alive
  .map((c) => (c.nameTag || "").replace(/§./g, "").split("\n"))
  .filter((l) => l.length > 1)
  .slice(0, 6);
if (sampleLines.length) {
  console.log("\n  captions in flight:");
  for (const l of sampleLines) console.log(`    ${l[0]}  ${l.slice(1).join(" ")}`);
}

const recent = stats.messages.slice(-8).map((m) => m.replace(/§./g, ""));
if (recent.length) {
  console.log("\n  last messages:");
  for (const m of recent) console.log(`    ${m}`);
}

const allErrors = stats.errors;
if (allErrors.length) {
  console.log(`\n\x1b[31m${allErrors.length} runtime error(s)\x1b[0m`);
  const seen = new Set();
  for (const e of allErrors) {
    const head = e.split("\n").slice(0, 3).join("\n");
    if (seen.has(head.split("\n")[0])) continue;
    seen.add(head.split("\n")[0]);
    console.log("  " + head.replace(/\n/g, "\n  "));
  }
  fs.rmSync(stage, { recursive: true, force: true });
  process.exit(1);
}

console.log("\n\x1b[32mNo runtime errors.\x1b[0m");
fs.rmSync(stage, { recursive: true, force: true });
