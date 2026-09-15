#!/usr/bin/env node
/**
 * Import check.
 *
 * Minecraft parses a pack's manifest before anything else happens. If any value
 * in it is something that version does not understand, the import is refused
 * outright - no pack in the list, no error you can act on. That failure mode is
 * invisible to every other check in this repo, because the files are all
 * perfectly valid *content*; it is the manifest's own grammar that is wrong.
 *
 * So this reads the built .mcaddon the way the game does and enforces the rules
 * from the manifest reference:
 *
 *   - a dependency version is a vector or a real SemVer string. "beta" is
 *     neither; only 1.21.120+ special-cases it, and older releases reject the
 *     whole manifest.
 *   - min_engine_version must be no higher than the oldest game you intend to
 *     support, or that game cannot import the pack at all.
 *   - every UUID is a real UUID, distinct, and the behaviour pack's dependency
 *     on the resource pack points at a UUID that is actually in the file.
 *   - the script entry named in the manifest exists inside the archive.
 *
 * Usage: node tools/check-import.mjs dist/AI_Citizens.mcaddon [--min 1.21.80]
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = process.argv[2] || "dist/AI_Citizens.mcaddon";
const minIdx = process.argv.indexOf("--min");
const SUPPORT_FLOOR = (minIdx > 0 ? process.argv[minIdx + 1] : "1.21.80")
  .split(".").map(Number);

let errors = 0;
const fail = (m) => { console.error(`  \x1b[31mERROR\x1b[0m ${m}`); errors++; };
const ok = (m) => console.log(`  \x1b[32mok\x1b[0m    ${m}`);

if (!fs.existsSync(file)) {
  console.error(`${file} does not exist - run ./tools/build.sh first`);
  process.exit(1);
}

// --- read the archive -----------------------------------------------------
const listing = execFileSync("unzip", ["-Z", "-1", file], { encoding: "utf8" })
  .split("\n").map((l) => l.trim()).filter(Boolean);

console.log(`\nImport check: ${file}`);

if (!listing.length) fail("the archive is empty");
for (const name of listing) {
  if (name.startsWith("/") || name.includes("..") || name.includes("\\")) {
    fail(`unsafe entry name "${name}"`);
  }
}

const manifests = listing.filter((n) => n.endsWith("manifest.json"));
if (!manifests.length) {
  fail("no manifest.json anywhere - Minecraft will not recognise this as a pack");
}
for (const m of manifests) {
  const depth = m.split("/").length;
  if (depth > 2) fail(`manifest at "${m}" is nested too deep; it must sit at the root of its pack folder`);
}
ok(`${listing.length} entries, ${manifests.length} packs`);

const read = (entry) =>
  execFileSync("unzip", ["-p", file, entry], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// --- per-pack manifest checks --------------------------------------------
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const seenUuids = new Map();
const packUuids = new Set();
const parsed = [];

for (const entry of manifests) {
  const label = entry;
  let doc;
  try {
    doc = JSON.parse(read(entry));
  } catch (e) {
    fail(`${label}: not valid JSON (${e.message})`);
    continue;
  }
  parsed.push({ entry, doc });

  if (![1, 2, 3].includes(doc.format_version)) {
    fail(`${label}: format_version must be 1, 2 or 3 (got ${JSON.stringify(doc.format_version)})`);
  }

  const header = doc.header || {};
  for (const field of ["name", "uuid", "version"]) {
    if (header[field] === undefined) fail(`${label}: header.${field} is required`);
  }
  if (header.uuid && !UUID_RE.test(header.uuid)) fail(`${label}: header.uuid "${header.uuid}" is not a UUID`);
  if (header.uuid) packUuids.add(header.uuid);

  const checkVersion = (where, v) => {
    if (Array.isArray(v)) {
      if (v.length !== 3 || !v.every((n) => Number.isInteger(n) && n >= 0)) {
        fail(`${where} must be three non-negative integers, got ${JSON.stringify(v)}`);
      }
      return;
    }
    if (typeof v === "string") {
      if (!SEMVER_RE.test(v)) {
        fail(`${where} is "${v}", which is neither a vector nor a SemVer string. ` +
             `Minecraft rejects the whole manifest, so the pack will not import.`);
      }
      return;
    }
    fail(`${where} has an unusable type (${typeof v})`);
  };

  checkVersion(`${label}: header.version`, header.version);

  if (header.min_engine_version === undefined) {
    fail(`${label}: header.min_engine_version is required for behaviour and resource packs`);
  } else {
    const mev = header.min_engine_version;
    checkVersion(`${label}: header.min_engine_version`, mev);
    const v = Array.isArray(mev) ? mev : String(mev).split(".").map(Number);
    const higher = v[0] > SUPPORT_FLOOR[0]
      || (v[0] === SUPPORT_FLOOR[0] && v[1] > SUPPORT_FLOOR[1])
      || (v[0] === SUPPORT_FLOOR[0] && v[1] === SUPPORT_FLOOR[1] && v[2] > SUPPORT_FLOOR[2]);
    if (higher) {
      fail(`${label}: min_engine_version ${v.join(".")} is above the ${SUPPORT_FLOOR.join(".")} ` +
           `support floor - anyone on an older game cannot import this at all`);
    }
  }

  for (const [i, mod] of (doc.modules || []).entries()) {
    const where = `${label}: modules[${i}]`;
    if (!mod.type) fail(`${where}.type is required`);
    if (!mod.uuid || !UUID_RE.test(mod.uuid)) fail(`${where}.uuid "${mod.uuid}" is not a UUID`);
    checkVersion(`${where}.version`, mod.version);
    if (mod.type === "script") {
      if (mod.language !== "javascript") fail(`${where}.language must be "javascript"`);
      if (!mod.entry) fail(`${where}.entry is required for a script module`);
      else {
        const folder = entry.replace(/manifest\.json$/, "");
        if (!listing.includes(folder + mod.entry)) {
          fail(`${where}.entry "${mod.entry}" is not in the archive`);
        }
      }
    }
    if (mod.uuid) {
      if (seenUuids.has(mod.uuid)) fail(`duplicate UUID ${mod.uuid} (${where} and ${seenUuids.get(mod.uuid)})`);
      seenUuids.set(mod.uuid, where);
    }
  }
  if (header.uuid) {
    if (seenUuids.has(header.uuid)) fail(`duplicate UUID ${header.uuid}`);
    seenUuids.set(header.uuid, `${label}: header`);
  }
}

// --- dependencies ---------------------------------------------------------
for (const { entry, doc } of parsed) {
  for (const [i, dep] of (doc.dependencies || []).entries()) {
    const where = `${entry}: dependencies[${i}]`;

    if (dep.uuid !== undefined) {
      if (!UUID_RE.test(dep.uuid)) fail(`${where}.uuid "${dep.uuid}" is not a UUID`);
      else if (!packUuids.has(dep.uuid)) {
        fail(`${where} depends on pack ${dep.uuid}, which is not in this file - ` +
             `the pack will import but report a missing dependency`);
      }
      if (dep.version === undefined) fail(`${where}.version is required`);
      else if (Array.isArray(dep.version)) {
        if (dep.version.length !== 3) fail(`${where}.version must be three integers`);
      } else if (!SEMVER_RE.test(String(dep.version))) {
        fail(`${where}.version "${dep.version}" is not a vector or SemVer string`);
      }
      continue;
    }

    if (!dep.module_name) {
      fail(`${where} has neither a uuid nor a module_name`);
      continue;
    }
    const v = dep.version;
    if (typeof v === "string" && !SEMVER_RE.test(v)) {
      fail(`${where}: "${dep.module_name}" version "${v}" is not a SemVer string. ` +
           `Only Minecraft 1.21.120+ understands "beta"; older releases refuse the import.`);
    } else if (Array.isArray(v)) {
      fail(`${where}: script module versions are strings, not vectors`);
    } else if (typeof v !== "string") {
      fail(`${where}.version is required`);
    } else if (/-beta/.test(v) && !dep.optional) {
      console.warn(`  \x1b[33mwarn\x1b[0m  ${where}: "${dep.module_name}" is pinned to ${v}. ` +
                   `Beta pins stop resolving when Minecraft updates; mark it optional or expect to rebuild.`);
    }
  }
}
// --- version coherence ----------------------------------------------------
// Minecraft replaces an installed pack only when the incoming version is
// higher, so a build that forgets to bump is silently ignored as a duplicate.
// And a behaviour pack whose dependency names a version the resource pack does
// not have reports a missing dependency and does nothing.
const headerVersions = new Map();
for (const { entry, doc } of parsed) {
  headerVersions.set(doc.header?.uuid, { v: doc.header?.version, entry });
}
const sameVersion = (a, b) => JSON.stringify(a) === JSON.stringify(b);

for (const { entry, doc } of parsed) {
  for (const mod of doc.modules || []) {
    if (!sameVersion(mod.version, doc.header.version)) {
      fail(`${entry}: module version ${JSON.stringify(mod.version)} does not match ` +
           `header.version ${JSON.stringify(doc.header.version)}`);
    }
  }
  for (const dep of doc.dependencies || []) {
    if (!dep.uuid) continue;
    const target = headerVersions.get(dep.uuid);
    if (target && !sameVersion(dep.version, target.v)) {
      fail(`${entry}: depends on ${dep.uuid} at ${JSON.stringify(dep.version)}, ` +
           `but ${target.entry} is ${JSON.stringify(target.v)} - Minecraft will report a missing dependency`);
    }
  }
}

const versions = new Set([...headerVersions.values()].map((x) => JSON.stringify(x.v)));
if (versions.size > 1) {
  fail(`the packs in this file have different versions (${[...versions].join(", ")})`);
}

const versionFile = new URL("../VERSION", import.meta.url).pathname;
if (fs.existsSync(versionFile)) {
  const want = fs.readFileSync(versionFile, "utf8").trim();
  const got = (parsed[0]?.doc.header.version || []).join(".");
  if (got !== want) {
    fail(`package is version ${got} but VERSION says ${want} - rebuild so the bump is recorded`);
  } else {
    ok(`version ${got}, consistent across both packs`);
  }
}

if (!errors) ok("every manifest value is one Minecraft can parse");

console.log("");
if (errors) {
  console.error(`\x1b[31m${errors} problem(s) - this package would be refused at import, ` +
                `ignored as a duplicate, or load with a broken dependency\x1b[0m\n`);
  process.exit(1);
}
console.log(`\x1b[32mThis package should import cleanly on Minecraft ${SUPPORT_FLOOR.join(".")}+\x1b[0m\n`);
