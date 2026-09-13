/* The world copying your work back at you.
 *
 * Every block you place is watched. Once you have made something of a decent
 * size, the world files it away -- and later builds it again somewhere else:
 * twice the size, rotated, some materials swapped for the wrong ones, whole
 * courses of blocks slid sideways, and the bottom of it shoved into the dirt.
 * You are meant to recognise it. You are not meant to be comfortable.
 *
 * Recreations are put up inside a temporary ticking area so they can be built
 * hundreds of blocks away, out where you have not been yet.
 */
import { world, system } from "@minecraft/server";
import {
  safe, every, later, job, chance, rint, rnd, pick, clamp, setBlock, getTypeId,
  surfaceY, isAir, dsound, tell, TAG, wget, wset,
} from "./util.js";
import { corruptionT, K } from "./state.js";
import { natural } from "./corruption.js";

const MAX_BLOCKS = 160;
const MAX_BUILDS = 3;
const SNAP_AFTER_IDLE = 25 * 20;   // 25s of not placing = you are done

const buffers = new Map();          // playerId -> {blocks:[], last:tick}

// ------------------------------------------------------- material rewrites
const SWAP = {
  "minecraft:oak_planks": ["minecraft:dark_oak_planks", "sl:wallpaper", "minecraft:spruce_planks"],
  "minecraft:spruce_planks": ["minecraft:dark_oak_planks", "sl:wallpaper_torn"],
  "minecraft:birch_planks": ["sl:wallpaper", "minecraft:oak_planks"],
  "minecraft:cobblestone": ["minecraft:deepslate", "minecraft:mossy_cobblestone", "sl:moist_wall"],
  "minecraft:stone": ["minecraft:deepslate", "minecraft:tuff", "sl:wallpaper"],
  "minecraft:stone_bricks": ["minecraft:deepslate_bricks", "minecraft:cracked_stone_bricks"],
  "minecraft:glass": ["sl:wallpaper", "minecraft:black_stained_glass"],
  "minecraft:glass_pane": ["sl:wallpaper", "minecraft:black_stained_glass_pane"],
  "minecraft:bricks": ["minecraft:deepslate_bricks", "sl:moist_wall"],
  "minecraft:white_wool": ["sl:cotton_bale", "minecraft:light_gray_wool"],
  "minecraft:torch": ["sl:buzzing_light"],
  "minecraft:lantern": ["sl:buzzing_light"],
  "minecraft:glowstone": ["sl:buzzing_light"],
  "minecraft:sea_lantern": ["sl:buzzing_light"],
  "minecraft:oak_log": ["minecraft:dark_oak_log", "minecraft:stripped_oak_log"],
  "minecraft:dirt": ["minecraft:coarse_dirt", "sl:damp_carpet"],
  "minecraft:grass_block": ["sl:damp_carpet", "minecraft:podzol"],
  "minecraft:sand": ["minecraft:red_sand", "sl:damp_carpet"],
};
const WOOD = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry"];
const DYE = ["white", "light_gray", "gray", "black", "brown", "yellow", "orange"];

/** Never let a recreation place something that can burn the place down or
 *  that the player could use to grief themselves. */
const BANNED = /tnt|fire|lava|water|bed$|spawner|command_block|bedrock|barrier|structure_|portal|dragon_egg|shulker_box|chest|barrel|hopper|dispenser|dropper/;

function distort(type, r) {
  if (BANNED.test(type)) return "sl:wallpaper";
  if (r > 0.62) return type;                            // most of it survives
  const s = SWAP[type];
  if (s) return pick(s, rnd());
  for (const w of WOOD) {
    if (type.includes(w + "_")) {
      const other = pick(WOOD.filter((x) => x !== w), rnd());
      return type.replace(w + "_", other + "_");
    }
  }
  for (const d of DYE) {
    if (type.startsWith("minecraft:" + d + "_")) {
      const other = pick(DYE.filter((x) => x !== d), rnd());
      return type.replace("minecraft:" + d + "_", "minecraft:" + other + "_");
    }
  }
  return type;
}

// -------------------------------------------------------------- recording
function bufFor(p) {
  let b = buffers.get(p.id);
  if (!b) { b = { blocks: [], last: 0 }; buffers.set(p.id, b); }
  return b;
}

function snapshot(p) {
  const b = bufFor(p);
  if (b.blocks.length < 28) { b.blocks = []; return; }
  const list = b.blocks.slice(-MAX_BLOCKS);
  b.blocks = [];

  let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
  for (const q of list) {
    minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
    minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z);
  }
  // ignore things that are just a long path or a mined-out line
  if (maxX - minX > 40 || maxZ - minZ > 40 || maxY - minY > 30) return;

  const pal = [];
  const idx = (t) => {
    let i = pal.indexOf(t);
    if (i < 0) { pal.push(t); i = pal.length - 1; }
    return i;
  };
  const cells = list.map((q) =>
    `${q.x - minX},${q.y - minY},${q.z - minZ},${idx(q.type)}`).join(";");

  const rec = { w: maxX - minX + 1, h: maxY - minY + 1, d: maxZ - minZ + 1,
                pal, b: cells, at: Date.now() };
  const n = Number(wget("sl:build_n", 0));
  wset(`sl:build_${n % MAX_BUILDS}`, JSON.stringify(rec));
  wset("sl:build_n", n + 1);
}

function loadBuild() {
  const n = Number(wget("sl:build_n", 0));
  if (n <= 0) return undefined;
  for (let t = 0; t < MAX_BUILDS; t++) {
    const i = Math.floor(rnd() * Math.min(n, MAX_BUILDS));
    const raw = wget(`sl:build_${i}`, "");
    if (raw) return safe(() => JSON.parse(raw), "build-parse");
  }
  return undefined;
}

// -------------------------------------------------------- ticking helpers
let areaBusy = false;
function withArea(dim, cx, cy, cz, rad, build) {
  if (areaBusy) return false;
  areaBusy = true;
  const name = "sl_recreate";
  safe(() => dim.runCommand(`tickingarea remove ${name}`), "ta-clean");
  const ok = safe(() => dim.runCommand(
    `tickingarea add ${cx - rad} ${Math.max(-60, cy - 24)} ${cz - rad} ` +
    `${cx + rad} ${Math.min(300, cy + 40)} ${cz + rad} ${name}`), "ta-add");
  if (!ok) { areaBusy = false; return false; }
  later(50, () => {
    safe(build, "recreate-build");
    later(200, () => {
      safe(() => dim.runCommand(`tickingarea remove ${name}`), "ta-remove");
      areaBusy = false;
    }, "ta-cleanup");
  }, "ta-wait");
  return true;
}

function remember(kind, loc) {
  const raw = wget("sl:landmarks", "[]");
  const list = safe(() => JSON.parse(raw), "lm") ?? [];
  list.push({ k: kind, x: Math.round(loc.x), y: Math.round(loc.y), z: Math.round(loc.z) });
  while (list.length > 12) list.shift();
  wset("sl:landmarks", JSON.stringify(list));
}
export function landmarks() {
  return safe(() => JSON.parse(wget("sl:landmarks", "[]")), "lm-read") ?? [];
}

// ------------------------------------------------------------- recreation
function* buildRecreation(dim, rec, ox, oy, oz, rot, t) {
  const cells = rec.b.split(";");
  const rotate = (x, z) => {
    if (rot === 1) return [-z, x];
    if (rot === 2) return [-x, -z];
    if (rot === 3) return [z, -x];
    return [x, z];
  };
  // each course of the build slides sideways a little: same building,
  // different plan
  const shift = [];
  for (let y = 0; y < rec.h; y++)
    shift.push(chance(0.45) ? rint(-2, 2) : 0);

  for (const c of cells) {
    const parts = c.split(",");
    if (parts.length !== 4) continue;
    const bx = +parts[0], by = +parts[1], bz = +parts[2];
    const type0 = rec.pal[+parts[3]];
    if (!type0) continue;
    if (chance(0.07)) { yield; continue; }         // pieces it forgot
    const type = distort(type0, rnd());
    const [rx, rz] = rotate(bx, bz);
    // scale x2: a copy that is too big for the space it is in
    for (let sx = 0; sx < 2; sx++)
      for (let sy = 0; sy < 2; sy++)
        for (let sz = 0; sz < 2; sz++) {
          const loc = {
            x: ox + rx * 2 + sx + (shift[by] ?? 0),
            y: oy + by * 2 + sy,
            z: oz + rz * 2 + sz,
          };
          safe(() => {
            const b = dim.getBlock(loc);
            if (!b) return;
            const cur = b.typeId;
            if (cur !== "minecraft:air" && !natural(dim, loc)) return;
            b.setType(type);
          }, "recreate-set");
        }
    yield;
  }
}

export function recreateFor(p) {
  const rec = loadBuild();
  if (!rec) return false;
  const dim = p.dimension;
  const a = rnd() * Math.PI * 2;
  const d = 140 + rnd() * 240;
  const ox = Math.floor(p.location.x + Math.cos(a) * d);
  const oz = Math.floor(p.location.z + Math.sin(a) * d);
  const rad = Math.max(32, Math.max(rec.w, rec.d) * 2 + 16);

  return withArea(dim, ox, Math.floor(p.location.y), oz, rad, () => {
    const gy = surfaceY(dim, ox, oz, 240, -50);
    if (gy === undefined) return;
    // shoved into the ground, the way things clip in the film
    const oy = gy + 1 - rint(2, 5);
    job(buildRecreation(dim, rec, ox, oy, oz, rint(0, 3), corruptionT()), 90);
    remember("recreation", { x: ox, y: oy, z: oz });
    later(60, () => {
      dsound(dim, "sl.fx.recreate", { x: ox, y: oy + 4, z: oz }, { volume: 1.0 });
      for (const q of world.getAllPlayers()) {
        q.playSound("sl.fx.recreate", { volume: 0.35 });
        tell(q, `${TAG} §7Something you built has been built again, somewhere else.`);
      }
    }, "recreate-announce");
  });
}

// ------------------------------------------------------ distorted villages
const VWALL = ["sl:wallpaper", "sl:wallpaper_torn", "minecraft:dark_oak_planks",
               "minecraft:cobblestone", "sl:moist_wall"];

function* buildVillage(dim, cx, cz, gy, n) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6;
    const r = 9 + rnd() * 22;
    const hx = Math.floor(cx + Math.cos(a) * r);
    const hz = Math.floor(cz + Math.sin(a) * r);
    const sy = surfaceY(dim, hx, hz, gy + 24, gy - 24) ?? gy;
    const w = 5 + rint(0, 4), d = 5 + rint(0, 4), h = 4 + rint(0, 2);
    const sink = rint(1, 4);                    // half-buried, like the movie
    const y0 = sy + 1 - sink;
    const wall = pick(VWALL, rnd());
    const skew = rint(-2, 2);

    for (let dy = 0; dy < h; dy++) {
      const off = Math.round((dy / h) * skew);  // the walls do not go up straight
      for (let dx = 0; dx < w; dx++)
        for (let dz = 0; dz < d; dz++) {
          const edge = dx === 0 || dz === 0 || dx === w - 1 || dz === d - 1;
          const loc = { x: hx + dx + off, y: y0 + dy, z: hz + dz };
          safe(() => {
            const b = dim.getBlock(loc);
            if (!b) return;
            if (b.typeId !== "minecraft:air" && !natural(dim, loc)) return;
            if (dy === 0) b.setType("sl:damp_carpet");
            else if (dy === h - 1) b.setType(chance(0.22) ? "minecraft:air"
                                    : chance(0.2) ? "sl:buzzing_light" : "sl:ceiling_tile");
            else if (edge) b.setType(chance(0.12) ? "minecraft:air" : wall);
            else b.setType("minecraft:air");
          }, "vil-set");
        }
      yield;
    }
    // a door hole nobody uses
    for (let dy = 1; dy <= 2; dy++)
      safe(() => dim.getBlock({ x: hx + ((w / 2) | 0), y: y0 + dy, z: hz })
        ?.setType("minecraft:air"), "vil-door");

    // no villagers. that is the point. sometimes a copy of one, standing.
    if (chance(0.55)) {
      safe(() => {
        const e = dim.spawnEntity("sl:still_villager",
          { x: hx + w / 2, y: y0 + 1, z: hz + d / 2 });
        e.triggerEvent("sl:to_still");
      }, "vil-still");
    }
    yield;
  }
  // paths that lead between houses and stop
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 30;
    const x = Math.floor(cx + Math.cos(a) * r), z = Math.floor(cz + Math.sin(a) * r);
    const y = surfaceY(dim, x, z, gy + 20, gy - 20);
    if (y !== undefined) safe(() => {
      const b = dim.getBlock({ x, y, z });
      if (b && natural(dim, { x, y, z })) b.setType("sl:damp_carpet");
    }, "vil-path");
    yield;
  }
}

export function villageFor(p) {
  const dim = p.dimension;
  if (!dim.id.endsWith("overworld")) return false;
  const a = rnd() * Math.PI * 2;
  const d = 120 + rnd() * 200;
  const cx = Math.floor(p.location.x + Math.cos(a) * d);
  const cz = Math.floor(p.location.z + Math.sin(a) * d);

  return withArea(dim, cx, Math.floor(p.location.y), cz, 48, () => {
    const gy = surfaceY(dim, cx, cz, 240, -50);
    if (gy === undefined) return;
    job(buildVillage(dim, cx, cz, gy, 4 + rint(0, 4)), 70);
    remember("village", { x: cx, y: gy, z: cz });
    const n = Number(wget(K.villages, 0));
    wset(K.villages, n + 1);
    for (const q of world.getAllPlayers())
      tell(q, `${TAG} §7There are houses out there now. Nobody is in them.`);
  });
}

// ------------------------------------------------------------------ wiring
export function install() {
  safe(() => world.afterEvents.playerPlaceBlock.subscribe((ev) => {
    const { player, block } = ev;
    const b = bufFor(player);
    if (b.blocks.length < 600) {
      b.blocks.push({ x: block.x, y: block.y, z: block.z, type: block.typeId });
    }
    b.last = system.currentTick;
  }), "recreate-watch");

  every(100, () => {
    for (const p of world.getAllPlayers()) {
      const b = buffers.get(p.id);
      if (!b || !b.blocks.length) continue;
      if (system.currentTick - b.last > SNAP_AFTER_IDLE || b.blocks.length >= MAX_BLOCKS * 2) {
        safe(() => snapshot(p), "snapshot");
      }
    }
  }, "recreate-snap");

  // the world only starts copying once it has started slipping
  every(1200, () => {
    const t = corruptionT();
    if (t < 0.10) return;
    const players = world.getAllPlayers();
    if (!players.length) return;
    const p = players[rint(0, players.length - 1)];
    if (!p.dimension.id.endsWith("overworld")) return;
    if (chance(0.22 + t * 0.35)) recreateFor(p);
    else if (t > 0.18 && chance(0.16 + t * 0.22)) villageFor(p);
  }, "recreate-tick");
}
