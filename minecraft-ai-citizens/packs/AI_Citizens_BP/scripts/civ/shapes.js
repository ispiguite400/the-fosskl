/**
 * Where the blocks go.
 *
 * "Dig a moat", "level this", "wall the town in", "cut steps down" are all the
 * same two jobs underneath - clear these cells, or fill these cells - and they
 * differ only in which cells. This works out the cells; actions/mine.js digs
 * them and actions/build.js places them.
 *
 * Every function is pure arithmetic over coordinates plus, where it must, a
 * look at what is actually there. None of them touch a citizen, so they can be
 * checked without a world.
 */
import { blockType } from "../actions/navigation.js";
import { isPassable } from "../core/blocks.js";

const floor = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });

/** A filled disc of offsets, radius in blocks. */
function disc(radius) {
  const out = [];
  const r2 = radius * radius;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      if (dx * dx + dz * dz <= r2) out.push({ dx, dz });
    }
  }
  return out;
}

/** A one-block-thick ring of offsets. */
function ring(radius, thickness = 1) {
  const out = [];
  const outer = radius * radius;
  const inner = Math.max(0, radius - thickness) ** 2;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const d = dx * dx + dz * dz;
      if (d <= outer && d > inner) out.push({ dx, dz });
    }
  }
  return out;
}

/**
 * Ground height at a column: the first solid block from a few above the
 * reference downwards. Without this a moat dug on a slope comes out as a
 * flat-bottomed trench hanging in the air on the low side.
 */
function groundY(dim, x, z, from, searchDown = 12) {
  for (let y = from + 4; y >= from - searchDown; y--) {
    const type = blockType(dim, x, y, z);
    if (type === undefined) continue;
    if (!isPassable(type) && type !== "minecraft:air") return y;
  }
  return from;
}

// --------------------------------------------------------------------------
// Cells to dig out
// --------------------------------------------------------------------------

/** Everything standing proud of the ground inside a radius. */
export function levelCells(dim, centre, radius = 8, height = 4) {
  const c = floor(centre);
  const cells = [];
  for (const { dx, dz } of disc(radius)) {
    const x = c.x + dx, z = c.z + dz;
    for (let dy = 0; dy < height; dy++) {
      const y = c.y + dy;
      const type = blockType(dim, x, y, z);
      if (type === undefined || isPassable(type) || type === "minecraft:air") continue;
      cells.push({ x, y, z });
    }
  }
  return cells;
}

/** A ring-shaped trench, dug to the ground on each side of the slope. */
export function moatCells(dim, centre, radius = 12, depth = 3, width = 2) {
  const c = floor(centre);
  const cells = [];
  for (const { dx, dz } of ring(radius, width)) {
    const x = c.x + dx, z = c.z + dz;
    const top = groundY(dim, x, z, c.y);
    for (let d = 0; d < depth; d++) cells.push({ x, y: top - d, z });
  }
  return cells;
}

/** A straight-sided hole. */
export function pitCells(dim, centre, radius = 3, depth = 5) {
  const c = floor(centre);
  const cells = [];
  for (const { dx, dz } of disc(radius)) {
    const x = c.x + dx, z = c.z + dz;
    const top = groundY(dim, x, z, c.y);
    for (let d = 0; d < depth; d++) cells.push({ x, y: top - d, z });
  }
  return cells;
}

/**
 * A staircase, two blocks high so it can be walked, descending or climbing
 * one block per step along a direction.
 */
export function stairCells(centre, direction, steps = 12, rise = -1) {
  const c = floor(centre);
  const cells = [];
  for (let i = 1; i <= steps; i++) {
    const x = c.x + Math.round(direction.x * i);
    const z = c.z + Math.round(direction.z * i);
    const y = c.y + rise * i;
    cells.push({ x, y, z }, { x, y: y + 1, z });
  }
  return cells;
}

/**
 * A shaft straight down, one column wide.
 *
 * `mineTask` breaks the block you point it at; it does not sink a shaft. Naming
 * every block of the shaft is the difference between "dig down 15" going down
 * fifteen blocks and it breaking one and calling the job done.
 */
export function shaftCells(centre, depth = 12) {
  const c = floor(centre);
  const cells = [];
  for (let d = 1; d <= depth; d++) cells.push({ x: c.x, y: c.y - d, z: c.z });
  return cells;
}

/** A corridor two blocks high, so it can be walked back out of. */
export function corridorCells(centre, direction, length = 24, height = 2, width = 1) {
  const c = floor(centre);
  const side = { x: -direction.z, z: direction.x };
  const half = Math.floor(width / 2);
  const cells = [];
  for (let i = 1; i <= length; i++) {
    for (let w = -half; w <= half; w++) {
      for (let h = 0; h < height; h++) {
        cells.push({
          x: c.x + Math.round(direction.x * i + side.x * w),
          y: c.y + h,
          z: c.z + Math.round(direction.z * i + side.z * w),
        });
      }
    }
  }
  return cells;
}

/** A room carved into the hillside. */
export function hollowCells(centre, direction, depth = 8, width = 3, height = 3) {
  const c = floor(centre);
  const cells = [];
  const side = { x: -direction.z, z: direction.x };
  const half = Math.floor(width / 2);
  for (let i = 1; i <= depth; i++) {
    for (let w = -half; w <= half; w++) {
      for (let h = 0; h < height; h++) {
        cells.push({
          x: c.x + Math.round(direction.x * i + side.x * w),
          y: c.y + h,
          z: c.z + Math.round(direction.z * i + side.z * w),
        });
      }
    }
  }
  return cells;
}

// --------------------------------------------------------------------------
// Cells to fill
// --------------------------------------------------------------------------

/** A wall standing on the ground, following a ring. */
export function perimeterCells(dim, centre, radius = 14, height = 3, block = "minecraft:cobblestone") {
  const c = floor(centre);
  const cells = [];
  for (const { dx, dz } of ring(radius, 1)) {
    const x = c.x + dx, z = c.z + dz;
    const top = groundY(dim, x, z, c.y);
    for (let h = 1; h <= height; h++) cells.push({ x, y: top + h, z, block });
  }
  return cells;
}

/** Any air pocket in a radius, so a hole can be filled or a cave sealed. */
export function fillCells(dim, centre, radius = 5, depth = 4, block = "minecraft:dirt") {
  const c = floor(centre);
  const cells = [];
  for (const { dx, dz } of disc(radius)) {
    const x = c.x + dx, z = c.z + dz;
    for (let d = 1; d <= depth; d++) {
      const y = c.y - d;
      const type = blockType(dim, x, y, z);
      if (type === undefined) continue;
      if (isPassable(type) || type === "minecraft:air") cells.push({ x, y, z, block });
    }
  }
  return cells;
}

/** A flat lid over an area - a roof, a bridge deck or a dock. */
export function slabCells(centre, radius = 4, block = "minecraft:oak_planks", dy = 0) {
  const c = floor(centre);
  return disc(radius).map(({ dx, dz }) => ({
    x: c.x + dx, y: c.y + dy, z: c.z + dz, block,
  }));
}

/** A run of blocks in a direction - a bridge, a jetty, a road. */
export function lineCells(centre, direction, length = 12, block = "minecraft:cobblestone", dy = -1, width = 1) {
  const c = floor(centre);
  const side = { x: -direction.z, z: direction.x };
  const half = Math.floor(width / 2);
  const cells = [];
  for (let i = 1; i <= length; i++) {
    for (let w = -half; w <= half; w++) {
      cells.push({
        x: c.x + Math.round(direction.x * i + side.x * w),
        y: c.y + dy,
        z: c.z + Math.round(direction.z * i + side.z * w),
        block,
      });
    }
  }
  return cells;
}

/** Plug whatever air is exposed on the face the citizen is looking at. */
export function sealCells(dim, centre, direction, reach = 6, radius = 2, block = "minecraft:cobblestone") {
  const c = floor(centre);
  const side = { x: -direction.z, z: direction.x };
  const cells = [];
  for (let i = 1; i <= reach; i++) {
    for (let w = -radius; w <= radius; w++) {
      for (let h = 0; h <= radius; h++) {
        const x = c.x + Math.round(direction.x * i + side.x * w);
        const y = c.y + h;
        const z = c.z + Math.round(direction.z * i + side.z * w);
        const type = blockType(dim, x, y, z);
        if (type === undefined) continue;
        if (isPassable(type) || type === "minecraft:air") cells.push({ x, y, z, block });
      }
    }
  }
  return cells;
}

export const SHAPE_LIMIT = 512;

/** Shapes are capped so one order cannot queue a week of digging. */
export function capped(cells, limit = SHAPE_LIMIT) {
  return cells.length > limit ? cells.slice(0, limit) : cells;
}
