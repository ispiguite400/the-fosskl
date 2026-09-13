/* The Backrooms.
 *
 * Bedrock will not let an add-on register a real custom dimension, so instead
 * of faking one badly this claims a patch of the End so far out that nothing
 * else will ever be there, seals it, and builds Level 0 inside it: five-block
 * ceilings, damp carpet, mono-yellow wallpaper and lights that buzz.
 *
 * Sectors are 48x48 and generated deterministically from their coordinates,
 * so walking back the way you came gives you back the same rooms -- and the
 * grid of walls is keyed to GLOBAL cell coordinates, so sectors stitch
 * together with no seam.
 */
import { world, system } from "@minecraft/server";
import {
  safe, every, later, job, chance, rint, rnd, pick, hash3, clamp, fill,
  setBlock, getTypeId, isAir, sound, dsound, tell, whisper, TAG, wget, wset,
  pget, pset, floorLoc,
} from "./util.js";
import { corruptionT, addCorruption, sanity, addSanity, worldDay, PK, K } from "./state.js";

export const BASE = { x: 256000, z: 256000 };

/* Fog bookkeeping lives at module scope so noclipOut() can clear it too. */
const FOGGED = new Set();
function fogClear(p) { FOGGED.delete(p.id); }
const SECTOR = 48;
const CELL = 6;
const FLOOR = 60;          // carpet
const CEIL = 66;           // tiles
const SUB = 59;            // something under the carpet
const DIM = () => world.getDimension("the_end");

const generated = new Set();

export function sectorOf(loc) {
  return { sx: Math.floor((loc.x - BASE.x) / SECTOR),
           sz: Math.floor((loc.z - BASE.z) / SECTOR) };
}
export function isInside(p) {
  return p.dimension.id.endsWith("the_end") &&
         Math.abs(p.location.x - BASE.x) < 60000 &&
         Math.abs(p.location.z - BASE.z) < 60000;
}

// ------------------------------------------------------------- generation
const WALLSET = ["sl:wallpaper", "sl:wallpaper", "sl:wallpaper",
                 "sl:wallpaper_torn", "sl:moist_wall"];

function wallAt(cx, cz, axis) {
  return hash3(cx, axis, cz, 7) < 0.40;
}
function doorAt(cx, cz, axis) {
  return hash3(cx, axis, cz, 23) < 0.46;
}

function* genSector(sx, sz, isChamber) {
  const dim = DIM();
  const x0 = BASE.x + sx * SECTOR;
  const z0 = BASE.z + sz * SECTOR;
  const x1 = x0 + SECTOR - 1;
  const z1 = z0 + SECTOR - 1;

  // scoop out whatever the End thought belonged here
  fill(dim, { x: x0, y: SUB - 2, z: z0 }, { x: x1, y: CEIL + 4, z: z1 }, "air");
  yield;
  fill(dim, { x: x0, y: SUB, z: z0 }, { x: x1, y: SUB, z: z1 }, "sl:wallpaper");
  yield;
  fill(dim, { x: x0, y: FLOOR, z: z0 }, { x: x1, y: FLOOR, z: z1 }, "sl:damp_carpet");
  yield;
  fill(dim, { x: x0, y: CEIL, z: z0 }, { x: x1, y: CEIL, z: z1 }, "sl:ceiling_tile");
  yield;

  const cells = SECTOR / CELL;                 // 8
  const cx0 = sx * cells, cz0 = sz * cells;

  if (isChamber) {
    // Clark's room: one enormous open floor, every light on, no cover
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < cells; j++) {
        const lx = x0 + i * CELL + 3, lz = z0 + j * CELL + 3;
        setBlock(dim, { x: lx, y: CEIL, z: lz }, "sl:buzzing_light");
        yield;
      }
    }
    for (let i = 0; i < cells; i++) {
      setBlock(dim, { x: x0 + i * CELL + 3, y: FLOOR + 1, z: z0 }, "sl:exit_sign");
      setBlock(dim, { x: x0, y: FLOOR + 1, z: z0 + i * CELL + 3 }, "sl:exit_sign");
      yield;
    }
    setBlock(dim, { x: x0 + 24, y: FLOOR + 1, z: z0 + 24 }, "sl:sanity_anchor_block");
    return;
  }

  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const cx = cx0 + i, cz = cz0 + j;
      const bx = x0 + i * CELL, bz = z0 + j * CELL;
      const mat = pick(WALLSET, hash3(cx, 5, cz, 11));

      // wall running along +X on this cell's low-Z edge
      if (wallAt(cx, cz, 0)) {
        fill(dim, { x: bx, y: FLOOR + 1, z: bz },
                  { x: bx + CELL - 1, y: CEIL - 1, z: bz }, mat);
        if (doorAt(cx, cz, 0)) {
          fill(dim, { x: bx + 2, y: FLOOR + 1, z: bz },
                    { x: bx + 3, y: FLOOR + 3, z: bz }, "air");
        }
        yield;
      }
      // wall running along +Z on this cell's low-X edge
      if (wallAt(cx, cz, 1)) {
        fill(dim, { x: bx, y: FLOOR + 1, z: bz },
                  { x: bx, y: CEIL - 1, z: bz + CELL - 1 }, mat);
        if (doorAt(cx, cz, 1)) {
          fill(dim, { x: bx, y: FLOOR + 1, z: bz + 2 },
                    { x: bx, y: FLOOR + 3, z: bz + 3 }, "air");
        }
        yield;
      }

      // the lights
      const h = hash3(cx, 9, cz, 31);
      if (h < 0.34) setBlock(dim, { x: bx + 3, y: CEIL, z: bz + 3 }, "sl:buzzing_light");

      // furniture, such as it is
      const f = hash3(cx, 13, cz, 53);
      if (f < 0.030) {
        setBlock(dim, { x: bx + 2, y: FLOOR + 1, z: bz + 2 }, "sl:exit_door");
        setBlock(dim, { x: bx + 2, y: FLOOR + 2, z: bz + 2 }, "sl:exit_sign");
      } else if (f < 0.055) {
        setBlock(dim, { x: bx + 3, y: FLOOR + 1, z: bz + 3 }, "sl:sanity_anchor_block");
      } else if (f < 0.10) {
        for (let k = 0; k < 3; k++)
          setBlock(dim, { x: bx + 2, y: FLOOR + 1 + k, z: bz + 4 }, "sl:cotton_bale");
      } else if (f < 0.13) {
        setBlock(dim, { x: bx + 4, y: FLOOR + 1, z: bz + 1 }, "sl:hum_speaker");
      } else if (f < 0.20) {
        for (let dx = 1; dx <= 3; dx++)
          for (let dz = 1; dz <= 3; dz++)
            setBlock(dim, { x: bx + dx, y: FLOOR, z: bz + dz }, "sl:moist_wall");
      }
      yield;
    }
  }
}

function ensureSector(sx, sz) {
  const key = `${sx},${sz}`;
  if (generated.has(key)) return;
  generated.add(key);
  const chamber = isChamberSector(sx, sz);
  job(genSector(sx, sz, chamber), 8);
  if (chamber) {
    later(90, () => spawnClark(sx, sz), "clark-spawn");
  }
}

// ------------------------------------------------------------ Clark's room
function chamberCoords() {
  const raw = wget("sl:clark_sector", "");
  if (!raw) return undefined;
  const p = String(raw).split(",");
  return { sx: +p[0], sz: +p[1] };
}
function isChamberSector(sx, sz) {
  const c = chamberCoords();
  return !!c && c.sx === sx && c.sz === sz;
}
function chooseChamber(fromSx, fromSz) {
  if (chamberCoords()) return;
  // he comes back, but not straight away
  const down = Number(wget(K.clarkDown, -1));
  if (down >= 0 && worldDay() - down < 10) return;
  const a = rnd() * Math.PI * 2;
  const r = 6 + rint(0, 3);
  const sx = fromSx + Math.round(Math.cos(a) * r);
  const sz = fromSz + Math.round(Math.sin(a) * r);
  wset("sl:clark_sector", `${sx},${sz}`);
}

function spawnClark(sx, sz) {
  safe(() => {
    const dim = DIM();
    const x = BASE.x + sx * SECTOR + 24;
    const z = BASE.z + sz * SECTOR + 24;
    const near = dim.getEntities({
      location: { x, y: FLOOR + 2, z }, maxDistance: 90, type: "sl:captain_clark",
    });
    if (near.length) return;
    const e = dim.spawnEntity("sl:captain_clark", { x: x + 8, y: FLOOR + 1, z: z + 8 });
    e.addTag("sl_clark");
    for (const p of world.getAllPlayers()) {
      if (!isInside(p)) continue;
      tell(p, `${TAG} §c"Stay where you are. I am coming to you."`);
      p.playSound("sl.clark.roar", { volume: 1.0 });
    }
  }, "spawn-clark");
}

// ------------------------------------------------------------ in and out
function packHome(p) {
  const l = p.location;
  return `${p.dimension.id}|${l.x.toFixed(2)}|${l.y.toFixed(2)}|${l.z.toFixed(2)}`;
}

export function noclipIn(p, why) {
  if (isInside(p)) return false;
  return safe(() => {
    pset(p, PK.home, packHome(p));
    const dim = DIM();
    const sx = rint(-2, 2), sz = rint(-2, 2);
    const tx = BASE.x + sx * SECTOR + 24;
    const tz = BASE.z + sz * SECTOR + 24;

    safe(() => dim.runCommand(
      `tickingarea add ${tx - 64} ${SUB - 4} ${tz - 64} ${tx + 64} ${CEIL + 6} ${tz + 64} sl_backrooms`),
      "back-ta");

    p.playSound("sl.fx.noclip", { volume: 1.0 });
    p.addEffect("blindness", 70, { amplifier: 0, showParticles: false });
    tell(p, `${TAG} §e${why ?? "You noclipped out of reality."}`);

    later(40, () => {
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) ensureSector(sx + dx, sz + dz);
      chooseChamber(sx, sz);
      later(50, () => safe(() => {
        p.teleport({ x: tx + 0.5, y: FLOOR + 1, z: tz + 0.5 }, { dimension: dim });
        pset(p, PK.inBack, true);
        pset(p, PK.sectors, 0);
        addCorruption(0.6);
        p.playSound("sl.music.backrooms_hum", { volume: 0.9 });
        tell(p, `§8§oThe hum is the only thing that is honest here.`);
        later(60, () => safe(() =>
          DIM().runCommand(`tickingarea remove sl_backrooms`), "back-ta-rm"), "rm");
      }, "back-tp"), "back-tp-wait");
    }, "back-gen-wait");
    return true;
  }, "noclipIn") === true;
}

export function noclipOut(p, why) {
  return safe(() => {
    const raw = String(pget(p, PK.home, ""));
    p.playSound("sl.fx.door", { volume: 1.0 });
    p.addEffect("blindness", 60, { amplifier: 0, showParticles: false });
    pset(p, PK.inBack, false);
    safe(() => p.runCommand(`fog @s remove sl_backrooms`), "fog-rm");
    fogClear(p);
    const parts = raw.split("|");
    if (parts.length === 4) {
      const dim = world.getDimension(parts[0]);
      p.teleport({ x: +parts[1], y: +parts[2], z: +parts[3] }, { dimension: dim });
    } else {
      const dim = world.getDimension("overworld");
      safe(() => p.runCommand("spreadplayers 0 0 8 240 @s"), "spread");
      p.teleport(p.location, { dimension: dim });
    }
    addSanity(p, 22);
    tell(p, `${TAG} §a${why ?? "You found a way out."}`);
    return true;
  }, "noclipOut") === true;
}

// ------------------------------------------------------------ rifts
function maybeRift(p) {
  const t = corruptionT();
  if (t < 0.32) return;
  if (!chance(0.05 + t * 0.06)) return;
  safe(() => {
    const a = rnd() * Math.PI * 2, d = 14 + rnd() * 22;
    const x = Math.floor(p.location.x + Math.cos(a) * d);
    const z = Math.floor(p.location.z + Math.sin(a) * d);
    for (let y = Math.floor(p.location.y) + 4; y > Math.floor(p.location.y) - 6; y--) {
      if (isAir(p.dimension, { x, y, z }) && !isAir(p.dimension, { x, y: y - 1, z })) {
        setBlock(p.dimension, { x, y, z }, "sl:noclip_rift");
        dsound(p.dimension, "sl.fx.noclip", { x, y, z }, { volume: 0.6, pitch: 0.8 });
        return;
      }
    }
  }, "rift");
}

// ------------------------------------------------------------------ wiring
export function install() {
  const fogged = FOGGED;

  // keep the rooms ahead of the player
  every(20, () => {
    for (const p of world.getAllPlayers()) {
      if (!isInside(p)) {
        if (pget(p, PK.inBack, false) === true) pset(p, PK.inBack, false);
        if (fogged.has(p.id)) {
          safe(() => p.runCommand(`fog @s remove sl_backrooms`), "fog-out");
          fogged.delete(p.id);
        }
        continue;
      }
      pset(p, PK.inBack, true);
      const { sx, sz } = sectorOf(p.location);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) ensureSector(sx + dx, sz + dz);

      if (!fogged.has(p.id)) {
        safe(() => p.runCommand(`fog @s push sl:backrooms sl_backrooms`), "fog-in");
        fogged.add(p.id);
      }

      // you fell off the edge of the level
      if (p.location.y < SUB - 8) {
        p.teleport({ x: p.location.x, y: FLOOR + 1, z: p.location.z });
        addSanity(p, -8);
      }
    }
  }, "back-stream");

  // company
  every(160, () => {
    for (const p of world.getAllPlayers()) {
      if (!isInside(p)) continue;
      const near = safe(() => p.dimension.getEntities({
        location: p.location, maxDistance: 48, families: ["still_life"] }).length,
        "back-count") ?? 0;
      if (near > 6) continue;
      const a = rnd() * Math.PI * 2, d = 16 + rnd() * 22;
      const x = p.location.x + Math.cos(a) * d, z = p.location.z + Math.sin(a) * d;
      safe(() => {
        const e = p.dimension.spawnEntity(
          chance(0.45) ? "sl:still_player" : "sl:still_villager",
          { x, y: FLOOR + 1, z });
        e.triggerEvent(chance(0.5) ? "sl:to_still" : "sl:to_roam");
        e.triggerEvent("sl:decay_2");
      }, "back-spawn");
    }
  }, "back-pop");

  every(240, () => {
    for (const p of world.getAllPlayers())
      if (!isInside(p) && p.dimension.id.endsWith("overworld")) maybeRift(p);
  }, "back-rift");

  // walking into a rift takes you through
  every(10, () => {
    for (const p of world.getAllPlayers()) {
      if (isInside(p)) continue;
      const l = floorLoc(p.location);
      for (const dy of [0, 1, -1]) {
        const t = getTypeId(p.dimension, { x: l.x, y: l.y + dy, z: l.z });
        if (t === "sl:noclip_rift") { noclipIn(p, "The wall gave. You went through it."); return; }
      }
    }
  }, "back-rift-touch");

  // the exit door
  safe(() => world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
    const { player, block } = ev;
    if (!block) return;
    if (block.typeId === "sl:exit_door") {
      if (isInside(player)) noclipOut(player, "The door opened onto somewhere real.");
      else noclipIn(player, "The door did not open onto the room behind it.");
    }
  }), "back-door");

  // dying in there puts you back in the world, at a cost
  safe(() => world.afterEvents.entityDie.subscribe((ev) => {
    const e = ev.deadEntity;
    if (!e || e.typeId !== "minecraft:player") return;
    pset(e, PK.inBack, false);
    safe(() => e.runCommand(`fog @s remove sl_backrooms`), "fog-death");
  }), "back-death");
}

export { spawnClark };
