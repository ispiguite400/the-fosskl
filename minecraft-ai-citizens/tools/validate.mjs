#!/usr/bin/env node
/**
 * Static checks for the behaviour pack.
 *
 * Bedrock's script runtime fails the *entire* module on a bad import, with a
 * message that is hard to trace in-game. This resolves every relative import,
 * checks each named import is actually exported, verifies pack JSON parses, and
 * confirms every texture and animation the entity definitions reference exists.
 *
 * Usage: node tools/validate.mjs [packs-dir]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const BP = path.join(root, "packs", "AI_Citizens_BP");
const RP = path.join(root, "packs", "AI_Citizens_RP");

let errors = 0;
let warnings = 0;
const fail = (msg) => { console.error(`  \x1b[31mERROR\x1b[0m ${msg}`); errors++; };
const warn = (msg) => { console.warn(`  \x1b[33mwarn\x1b[0m  ${msg}`); warnings++; };
const ok = (msg) => console.log(`  \x1b[32mok\x1b[0m    ${msg}`);

// --------------------------------------------------------------------------
function walk(dir, ext) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, ext));
    else if (!ext || p.endsWith(ext)) out.push(p);
  }
  return out;
}

// --------------------------------------------------------------------------
// 1. JSON files parse
// --------------------------------------------------------------------------
console.log("\nJSON");
for (const file of [...walk(BP, ".json"), ...walk(RP, ".json")]) {
  try {
    JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    fail(`${path.relative(root, file)}: ${e.message}`);
  }
}
if (!errors) ok(`${[...walk(BP, ".json"), ...walk(RP, ".json")].length} files parse`);

// --------------------------------------------------------------------------
// 2. Module graph
// --------------------------------------------------------------------------
console.log("\nScript modules");
const scriptDir = path.join(BP, "scripts");
const files = walk(scriptDir, ".js");

const EXPORT_RE = [
  /^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm,
  /^export\s+class\s+([A-Za-z0-9_$]+)/gm,
  /^export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm,
];

function exportsOf(file) {
  const src = fs.readFileSync(file, "utf8");
  const names = new Set();
  for (const re of EXPORT_RE) {
    for (const m of src.matchAll(re)) names.add(m[1]);
  }
  // export { a, b as c }  /  export { x } from "./y.js"
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}(?:\s*from\s*["'][^"']+["'])?/gm)) {
    for (const part of m[1].split(",")) {
      const bits = part.trim().split(/\s+as\s+/);
      const name = (bits[1] || bits[0] || "").trim();
      if (name) names.add(name);
    }
  }
  if (/^export\s+default/m.test(src)) names.add("default");
  return names;
}

const exportMap = new Map();
for (const f of files) exportMap.set(path.resolve(f), exportsOf(f));

const IMPORT_RE = /^import\s+(?:([\w$*{][^;]*?)\s+from\s+)?["']([^"']+)["']/gm;
let importCount = 0;

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);

  for (const m of src.matchAll(IMPORT_RE)) {
    const clause = (m[1] || "").trim();
    const spec = m[2];
    importCount++;

    if (spec.startsWith("@minecraft/")) {
      const allowed = ["@minecraft/server", "@minecraft/server-ui", "@minecraft/server-net"];
      if (!allowed.includes(spec)) fail(`${rel}: unexpected engine module "${spec}"`);
      continue;
    }
    if (!spec.startsWith(".")) {
      fail(`${rel}: bare import "${spec}" - Bedrock has no module resolver`);
      continue;
    }
    if (!spec.endsWith(".js")) {
      fail(`${rel}: import "${spec}" must end in .js`);
      continue;
    }

    const target = path.resolve(path.dirname(file), spec);
    if (!fs.existsSync(target)) {
      fail(`${rel}: imports missing file "${spec}"`);
      continue;
    }

    // Named import checking
    const braced = /\{([^}]*)\}/.exec(clause);
    if (!braced) continue;
    const available = exportMap.get(target) || new Set();
    for (const part of braced[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      if (!available.has(name)) {
        fail(`${rel}: "${name}" is not exported by ${path.relative(root, target)}`);
      }
    }
  }
}
if (errors === 0) ok(`${files.length} modules, ${importCount} imports all resolve`);

// --------------------------------------------------------------------------
// 3. Manifests agree
// --------------------------------------------------------------------------
console.log("\nManifests");
const bpManifest = JSON.parse(fs.readFileSync(path.join(BP, "manifest.json"), "utf8"));
const rpManifest = JSON.parse(fs.readFileSync(path.join(RP, "manifest.json"), "utf8"));

const rpUuid = rpManifest.header.uuid;
const dep = (bpManifest.dependencies || []).find((d) => d.uuid === rpUuid);
if (!dep) fail("behaviour pack does not depend on the resource pack UUID");
else ok("behaviour pack depends on the resource pack");

const entry = bpManifest.modules.find((m) => m.type === "script")?.entry;
if (!entry || !fs.existsSync(path.join(BP, entry))) fail(`script entry "${entry}" is missing`);
else ok(`script entry ${entry} exists`);

const uuids = new Set();
for (const m of [bpManifest, rpManifest]) {
  for (const u of [m.header.uuid, ...m.modules.map((x) => x.uuid)]) {
    if (uuids.has(u)) fail(`duplicate UUID ${u}`);
    uuids.add(u);
  }
}
ok(`${uuids.size} distinct UUIDs`);

// Match a real re-export, not the explanatory comment in the stub.
const usesNet = /from\s*["']\.\/transport_net\.js["']/
  .test(fs.readFileSync(path.join(BP, "scripts", "brain", "transport.js"), "utf8"));

// Beta modules must use the dynamic "beta" string, not a pinned number: pinned
// -beta versions stop resolving when Minecraft updates, which silently kills
// the script module while the rest of the pack still loads.
const serverDep = (bpManifest.dependencies || []).find((d) => d.module_name === "@minecraft/server");
if (!serverDep) {
  fail("manifest does not depend on @minecraft/server");
} else if (/-beta$/.test(serverDep.version)) {
  fail(`@minecraft/server is pinned to "${serverDep.version}" - use "beta" so it survives updates`);
} else {
  ok(`@minecraft/server: ${serverDep.version}`);
}
for (const d of bpManifest.dependencies || []) {
  if (d.module_name && /-beta$/.test(d.version || "")) {
    fail(`${d.module_name} is pinned to "${d.version}" - use "beta"`);
  }
}

// The dynamic "beta" string needs 1.21.120; declaring less makes the failure
// silent instead of showing the pack as incompatible.
const minEngine = bpManifest.header.min_engine_version;
const usesDynamicBeta = serverDep && serverDep.version === "beta";
const engineStr = minEngine.join(".");
if (usesDynamicBeta && (minEngine[0] < 1 || minEngine[1] < 21 || (minEngine[1] === 21 && minEngine[2] < 120))) {
  fail(`min_engine_version ${engineStr} is below 1.21.120, which the dynamic "beta" version needs`);
} else {
  ok(`min_engine_version ${engineStr} matches the modules declared`);
}
const hasNetDep = (bpManifest.dependencies || []).some((d) => d.module_name === "@minecraft/server-net");
if (usesNet && !hasNetDep) fail("transport.js uses @minecraft/server-net but the manifest does not declare it");
if (!usesNet && hasNetDep) warn("manifest declares @minecraft/server-net but transport.js does not use it");
ok(usesNet ? "build: Claude bridge enabled (server-net)" : "build: offline (local brain only)");

// --------------------------------------------------------------------------
// 4. Resource pack references
// --------------------------------------------------------------------------
console.log("\nResource pack");
const clientEntity = JSON.parse(fs.readFileSync(path.join(RP, "entity", "ai_citizen.entity.json"), "utf8"));
const desc = clientEntity["minecraft:client_entity"].description;

for (const [key, tex] of Object.entries(desc.textures)) {
  const png = path.join(RP, tex + ".png");
  if (!fs.existsSync(png)) fail(`texture "${key}" -> ${tex}.png is missing`);
}
ok(`${Object.keys(desc.textures).length} skin textures present`);

const animFile = JSON.parse(fs.readFileSync(path.join(RP, "animations", "ai_citizen.animation.json"), "utf8"));
const ctrlFile = JSON.parse(fs.readFileSync(path.join(RP, "animation_controllers", "ai_citizen.animation_controllers.json"), "utf8"));
const definedAnims = new Set(Object.keys(animFile.animations));
const definedCtrls = new Set(Object.keys(ctrlFile.animation_controllers));

for (const [alias, id] of Object.entries(desc.animations)) {
  if (id.startsWith("controller.")) {
    if (!definedCtrls.has(id)) fail(`animation controller "${id}" (alias ${alias}) is not defined`);
  } else if (!definedAnims.has(id)) {
    fail(`animation "${id}" (alias ${alias}) is not defined`);
  }
}
ok(`${Object.keys(desc.animations).length} animation references resolve`);

// Every animation an animation controller plays must be aliased on the entity.
const aliases = new Set(Object.keys(desc.animations));
for (const [ctrlId, ctrl] of Object.entries(ctrlFile.animation_controllers)) {
  for (const [stateId, state] of Object.entries(ctrl.states || {})) {
    for (const a of state.animations || []) {
      const name = typeof a === "string" ? a : Object.keys(a)[0];
      if (!aliases.has(name)) fail(`${ctrlId}.${stateId} plays "${name}" which the entity does not alias`);
    }
  }
}
ok("animation controllers only play aliased animations");

const geo = JSON.parse(fs.readFileSync(path.join(RP, "models", "entity", "ai_citizen.geo.json"), "utf8"));
const geoIds = new Set(geo["minecraft:geometry"].map((g) => g.description.identifier));
for (const id of Object.values(desc.geometry)) {
  if (!geoIds.has(id)) fail(`geometry "${id}" is not defined`);
}
ok(`${geoIds.size} geometries defined`);

const boneNames = new Set();
for (const g of geo["minecraft:geometry"]) {
  for (const b of g.bones || []) boneNames.add(b.name);
}
let boneRefs = 0;
for (const anim of Object.values(animFile.animations)) {
  for (const bone of Object.keys(anim.bones || {})) {
    boneRefs++;
    if (!boneNames.has(bone)) fail(`animation targets bone "${bone}" which the model does not have`);
  }
}
ok(`${boneRefs} animation bone references resolve`);

const renderFile = JSON.parse(fs.readFileSync(path.join(RP, "render_controllers", "ai_citizen.render_controllers.json"), "utf8"));
for (const rc of desc.render_controllers) {
  const id = typeof rc === "string" ? rc : Object.keys(rc)[0];
  if (!renderFile.render_controllers[id]) fail(`render controller "${id}" is not defined`);
}
ok("render controllers resolve");

// --------------------------------------------------------------------------
// Molang. An unresolved query is a silent runtime error that can stop an entity
// animating or rendering, and nothing in the pack pipeline catches it - so the
// queries used here are checked against the documented set.
// --------------------------------------------------------------------------
const KNOWN_QUERIES = new Set([
  "property", "life_time", "anim_time", "ground_speed", "vertical_speed",
  "modified_distance_moved", "modified_move_speed", "walk_distance",
  "target_x_rotation", "target_y_rotation", "head_x_rotation", "head_y_rotation",
  "body_x_rotation", "body_y_rotation", "is_in_water", "is_in_water_or_rain",
  "is_on_ground", "is_sneaking", "is_sprinting", "is_swimming", "is_riding",
  "is_sleeping", "is_alive", "is_baby", "is_invisible", "is_on_fire",
  "is_using_item", "is_item_equipped", "hurt_time", "health", "max_health",
  "variant", "mark_variant", "skin_id", "has_target", "time_of_day",
  "delta_time", "frame_alpha", "cardinal_facing", "yaw_speed", "distance_from_camera",
  "block_face", "equipment_count", "armor_texture_slot", "actor_count",
  "is_moving", "is_jumping", "is_eating", "is_angry", "is_charged",
]);

const MOLANG_FILES = [
  ["animations/ai_citizen.animation.json", animFile],
  ["animation_controllers/ai_citizen.animation_controllers.json", ctrlFile],
  ["render_controllers/ai_citizen.render_controllers.json", renderFile],
  ["entity/ai_citizen.entity.json", clientEntity],
];

const declaredProps = new Set(
  Object.keys(JSON.parse(fs.readFileSync(path.join(BP, "entities", "ai_citizen.json"), "utf8"))
    ["minecraft:entity"].description.properties || {}),
);

let queryCount = 0;
for (const [label, doc] of MOLANG_FILES) {
  const text = JSON.stringify(doc);
  for (const m of text.matchAll(/\b(?:query|q)\.([a-z_][a-z0-9_]*)/gi)) {
    queryCount++;
    if (!KNOWN_QUERIES.has(m[1])) {
      fail(`${label}: unknown Molang query "query.${m[1]}"`);
    }
  }
  // Every property a Molang expression reads must actually be declared.
  for (const m of text.matchAll(/(?:query|q)\.property\(\s*\\?['"]([^'"\\]+)\\?['"]\s*\)/g)) {
    if (!declaredProps.has(m[1])) {
      fail(`${label}: reads undeclared entity property "${m[1]}"`);
    }
  }
}
ok(`${queryCount} Molang queries are all documented`);

// Client-synced properties are the only ones Molang can see.
for (const [name, def] of Object.entries(
  JSON.parse(fs.readFileSync(path.join(BP, "entities", "ai_citizen.json"), "utf8"))
    ["minecraft:entity"].description.properties || {},
)) {
  const readByMolang = MOLANG_FILES.some(([, doc]) => JSON.stringify(doc).includes(name));
  if (readByMolang && !def.client_sync) {
    fail(`entity property "${name}" is read by Molang but is not client_sync`);
  }
}
ok("client_sync set on every property the resource pack reads");


// --------------------------------------------------------------------------
// 5. Behaviour pack entity
// --------------------------------------------------------------------------
console.log("\nBehaviour pack entity");
const bpEntity = JSON.parse(fs.readFileSync(path.join(BP, "entities", "ai_citizen.json"), "utf8"));
const ent = bpEntity["minecraft:entity"];
const groups = new Set(Object.keys(ent.component_groups));
let eventRefs = 0;
for (const [name, ev] of Object.entries(ent.events)) {
  for (const key of ["add", "remove"]) {
    for (const g of ev[key]?.component_groups || []) {
      eventRefs++;
      if (!groups.has(g)) fail(`event "${name}" references unknown group "${g}"`);
    }
  }
}
ok(`${Object.keys(ent.events).length} events, ${eventRefs} group references resolve`);

const props = Object.keys(ent.description.properties || {});
const scriptSrc = walk(scriptDir, ".js").map((f) => fs.readFileSync(f, "utf8")).join("\n");
for (const p of props) {
  if (!scriptSrc.includes(`"${p}"`) && !scriptSrc.includes(`'${p}'`)) {
    warn(`entity property "${p}" is never set from script`);
  }
}
const navChannels = (fs.readFileSync(path.join(scriptDir, "core", "generated.js"), "utf8")
  .match(/NAV_CHANNELS = (\d+)/) || [])[1];
const travelGroups = [...groups].filter((g) => g.startsWith("ai:travel_")).length;
if (Number(navChannels) !== travelGroups) {
  fail(`NAV_CHANNELS=${navChannels} but the entity has ${travelGroups} travel groups - re-run tools/generate_entities.py`);
} else {
  ok(`${travelGroups} waypoint channels in sync with generated.js`);
}

const navEntity = JSON.parse(fs.readFileSync(path.join(BP, "entities", "ai_nav_point.json"), "utf8"));
const navGroups = Object.keys(navEntity["minecraft:entity"].component_groups).length;
if (navGroups !== travelGroups) fail(`waypoint entity has ${navGroups} channels, citizen has ${travelGroups}`);
else ok("waypoint entity channels match");

// --------------------------------------------------------------------------
// Pre-release Script APIs
// --------------------------------------------------------------------------
console.log("\nScript API safety");

// These are documented as pre-release: on a pack that declares the stable
// @minecraft/server they are simply absent, and `.subscribe` on undefined
// throws. Touching one outside a guard is what previously killed boot.
const PRERELEASE = ["chatSend", "playerPlaceBlock", "entityTamed", "messageReceive",
  "playerCraftRecipe", "soundCompleted", "watchdogTerminate"];

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  for (const api of PRERELEASE) {
    const re = new RegExp(`(?:beforeEvents|afterEvents)\\.${api}\\s*\\.subscribe`, "g");
    if (re.test(src)) {
      fail(`${rel}: subscribes to pre-release "${api}" without an optional-chaining guard`);
    }
  }
}
ok(`${PRERELEASE.length} pre-release APIs are only reached through guards`);

const mainSrc = fs.readFileSync(path.join(scriptDir, "main.js"), "utf8");
if (!/registerSlashCommands/.test(mainSrc)) {
  fail("main.js does not register slash commands - there would be no control path without chat");
} else {
  ok("a chat-independent command path is registered");
}

console.log("");
if (errors) {
  console.error(`\x1b[31m${errors} error(s)\x1b[0m, ${warnings} warning(s)`);
  process.exit(1);
}
console.log(`\x1b[32mAll checks passed\x1b[0m (${warnings} warning(s))`);
