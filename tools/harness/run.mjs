/* Drive the STILL LIFE scripts against the stub and surface everything
 * that safe() would otherwise swallow. */
const warnings = new Map();
const realWarn = console.warn;
console.warn = (...a) => {
  const s = a.join(" ");
  warnings.set(s, (warnings.get(s) ?? 0) + 1);
};
let hardFail = null;
process.on("uncaughtException", (e) => { hardFail = e; });

const M = await import("@minecraft/server");
const { world, system, _tick, _mkPlayer, CALLS } = M;

await import("./scripts/main.js");
_tick();                                    // boot()

const p = _mkPlayer({ x: 0, y: 64, z: 0 });
const dim = world.getDimension("overworld");

// populate the world so the interesting branches actually run
for (const t of ["sl:still_villager","sl:still_cow","sl:still_player",
                 "sl:the_tall_one","sl:captain_clark"]) {
  dim.spawnEntity(t, { x: 3, y: 64, z: 3 });
}
dim._ents.find(e=>e.typeId==="sl:still_villager")._props["sl:state"] = "friendly";

// fire every event at least once
const A = world.afterEvents, B = world.beforeEvents;
const src = { damagingEntity: p };
A.playerSpawn._fire({ player: p, initialSpawn: true });
A.playerSpawn._fire({ player: p, initialSpawn: false });
for (const e of dim._ents.filter(x => x.typeId !== "minecraft:player")) {
  A.entityDie._fire({ deadEntity: e, damageSource: src });
  A.entityHurt._fire({ hurtEntity: e, damage: 6, damageSource: src });
  A.entityHurt._fire({ hurtEntity: p, damage: 6, damageSource: { damagingEntity: e } });
  A.entitySpawn._fire({ entity: e });
  A.playerInteractWithEntity._fire({ player: p, target: e,
    itemStack: { typeId: "sl:cotton", amount: 3 } });
  A.playerInteractWithEntity._fire({ player: p, target: e,
    itemStack: { typeId: "sl:still_essence", amount: 3 } });
}
for (let i = 0; i < 40; i++) {
  A.playerPlaceBlock._fire({ player: p,
    block: { x: i % 6, y: 64 + ((i / 6) | 0), z: (i * 3) % 5, typeId: "minecraft:oak_planks" } });
}
const ITEMS = ["sl:flicker_lantern","sl:camcorder","sl:polaroid","sl:noclip_charm",
  "sl:exit_sign_shard","sl:frontrooms_key","sl:hum_tuner","sl:clarks_whistle",
  "sl:distorted_compass","sl:tall_ones_tooth"];
for (const id of ITEMS) A.itemUse._fire({ source: p, itemStack: { typeId: id, amount: 1 } });
for (const id of ["sl:almond_water","sl:bitter_almond_water","sl:cotton_bandage"])
  A.itemCompleteUse._fire({ source: p, itemStack: { typeId: id, amount: 1 } });
A.playerInteractWithBlock._fire({ player: p, block: { typeId: "sl:exit_door", x:0,y:64,z:0 } });
for (const c of ["!sl","!sl status","!sl help","!sl corrupt 55","!sl tall",
                 "!sl recreate","!sl village","!sl bogus"])
  B.chatSend._fire({ message: c, sender: p, cancel: false });

// run a while at low corruption, then crank it and run again
for (let i = 0; i < 900; i++) _tick();
world.setDynamicProperty("sl:corruption", 92);
world._time = 24000 * 9;                    // trip the Tall One day cycle
for (let i = 0; i < 1800; i++) _tick();

// and once from inside the Backrooms
p.dimension = world.getDimension("the_end");
p.location = { x: 256024, y: 61, z: 256024 };
world.getDimension("the_end")._ents.push(p);
for (let i = 0; i < 900; i++) _tick();

console.warn = realWarn;
const bad = [...warnings.entries()].filter(([k]) => k.includes("[STILL LIFE]"));
console.log(`ticks run: ${system.currentTick}`);
console.log(`commands issued: ${CALLS.commands.length}  blocks set: ${CALLS.setBlocks}` +
            `  entities spawned: ${CALLS.spawns.length}  sounds: ${CALLS.sounds.length}`);
console.log(`intervals registered: ${system._iv.length}`);
if (hardFail) { console.log("\nHARD FAILURE:\n", hardFail); process.exitCode = 2; }
if (bad.length) {
  console.log(`\n${bad.length} distinct caught errors:`);
  for (const [k, n] of bad.sort((a,b)=>b[1]-a[1])) console.log(`  x${n}  ${k}`);
  process.exitCode = 1;
} else {
  console.log("\nno caught errors.");
}

// ------------------------------------------------ did it actually DO things
const cmds = CALLS.commands;
const has = (re) => cmds.some((c) => re.test(c));
const checks = [
  ["backrooms sectors built",   has(/^fill 2560\d\d /)],
  ["backrooms carpet laid",     cmds.some((c) => c.includes("sl:damp_carpet"))],
  ["backrooms ceiling laid",    cmds.some((c) => c.includes("sl:ceiling_tile"))],
  ["ticking areas used",        has(/^tickingarea add /)],
  ["ticking areas cleaned up",  has(/^tickingarea remove /)],
  ["fog pushed",                has(/^fog @s push sl:/)],
  ["music stopped on switch",   has(/^stopsound /)],
  ["overworld terrain warped",  CALLS.setBlocks > 500],
  ["still lifes spawned",       CALLS.spawns.some((s) => s.startsWith("sl:still_"))],
  ["tall one spawned",          CALLS.spawns.includes("sl:the_tall_one")],
  ["music played",              CALLS.sounds.some((s) => s.startsWith("sl.music."))],
  ["jumpscare fired",           CALLS.sounds.includes("sl.fx.jumpscare")],
  ["effects applied",           CALLS.effects.length > 0],
  ["sanity persisted",          typeof p.getDynamicProperty("sl:sanity") === "number"],
  ["karma persisted",           typeof p.getDynamicProperty("sl:karma") === "number"],
  ["corruption persisted",      typeof world.getDynamicProperty("sl:corruption") === "number"],
  ["a build was recorded",      Number(world.getDynamicProperty("sl:build_n") ?? 0) > 0],
  ["landmarks recorded",        !!world.getDynamicProperty("sl:landmarks")],
];
console.log("\nbehaviour checks:");
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(`\nkarma=${p.getDynamicProperty("sl:karma")} ` +
            `sanity=${Math.round(Number(p.getDynamicProperty("sl:sanity")))} ` +
            `corruption=${world.getDynamicProperty("sl:corruption")}`);
const bl = world.getDynamicProperty("sl:build_0");
if (bl) console.log(`recorded build payload: ${bl.length} bytes (limit 32767)`);
if (failed) process.exitCode = 1;
