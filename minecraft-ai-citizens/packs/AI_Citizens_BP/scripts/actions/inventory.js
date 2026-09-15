/** Carrying, storing, equipping and handing over items. */
import { ItemStack, EquipmentSlot } from "@minecraft/server";
import { safe, debug } from "../core/log.js";
import { prettyId } from "../core/util.js";
import { resolveTag } from "../core/recipes.js";
import { FOODS } from "../core/blocks.js";

const CONTAINER_BLOCKS = new Set([
  "minecraft:chest", "minecraft:trapped_chest", "minecraft:barrel",
]);

// --- the citizen's own pack --------------------------------------------
export function giveItem(citizen, typeId, amount = 1) {
  const container = citizen.container;
  if (!container) return 0;
  let left = amount;
  while (left > 0) {
    const take = Math.min(left, 64);
    const ok = safe("inv.give", () => {
      container.addItem(new ItemStack(typeId, take));
      return true;
    }, false);
    if (!ok) break;
    left -= take;
  }
  return amount - left;
}

export function takeItem(citizen, typeId, amount = 1) {
  const container = citizen.container;
  if (!container) return 0;
  let need = amount;
  for (let i = 0; i < container.size && need > 0; i++) {
    const stack = safe("inv.takeScan", () => container.getItem(i));
    if (!stack || stack.typeId !== typeId) continue;
    const take = Math.min(stack.amount, need);
    need -= take;
    if (stack.amount - take <= 0) {
      safe("inv.clear", () => container.setItem(i, undefined));
    } else {
      stack.amount -= take;
      safe("inv.set", () => container.setItem(i, stack));
    }
  }
  return amount - need;
}

export function hasItems(citizen, requirements) {
  const inv = citizen.listInventory();
  for (const [idOrTag, need] of requirements) {
    let have = 0;
    for (const id of resolveTag(idOrTag)) have += inv.get(id) || 0;
    if (have < need) return false;
  }
  return true;
}

export function consume(citizen, requirements) {
  // Pre-flight so we never half-consume a recipe.
  if (!hasItems(citizen, requirements)) return false;
  for (const [idOrTag, need] of requirements) {
    let left = need;
    for (const id of resolveTag(idOrTag)) {
      if (left <= 0) break;
      left -= takeItem(citizen, id, left);
    }
  }
  return true;
}

export function firstMatching(citizen, predicate) {
  const container = citizen.container;
  if (!container) return null;
  for (let i = 0; i < container.size; i++) {
    const stack = safe("inv.first", () => container.getItem(i));
    if (stack && predicate(stack.typeId, stack)) return { slot: i, stack };
  }
  return null;
}

export function findFood(citizen) {
  const found = firstMatching(citizen, (id) => FOODS[id] !== undefined);
  return found ? { typeId: found.stack.typeId, nutrition: FOODS[found.stack.typeId], slot: found.slot } : null;
}

export function isFull(citizen) {
  return citizen.freeSlots <= 0;
}

// --- equipment ----------------------------------------------------------
const TOOL_PRIORITY = {
  pickaxe: ["netherite_pickaxe", "diamond_pickaxe", "iron_pickaxe", "stone_pickaxe", "golden_pickaxe", "wooden_pickaxe"],
  axe: ["netherite_axe", "diamond_axe", "iron_axe", "stone_axe", "golden_axe", "wooden_axe"],
  shovel: ["netherite_shovel", "diamond_shovel", "iron_shovel", "stone_shovel", "golden_shovel", "wooden_shovel"],
  sword: ["netherite_sword", "diamond_sword", "iron_sword", "stone_sword", "golden_sword", "wooden_sword"],
  hoe: ["netherite_hoe", "diamond_hoe", "iron_hoe", "stone_hoe", "golden_hoe", "wooden_hoe"],
};

export function equippable(citizen) {
  return safe("inv.equipComp", () => citizen.entity.getComponent("minecraft:equippable"));
}

/** Puts the best tool of `kind` in the main hand. Returns its type id or null. */
export function equipTool(citizen, kind) {
  const eq = equippable(citizen);
  const list = TOOL_PRIORITY[kind] || [];
  const inv = citizen.listInventory();
  for (const suffix of list) {
    const id = "minecraft:" + suffix;
    if ((inv.get(id) || 0) <= 0) continue;
    if (!eq) return id;             // no visual, but the citizen still "has" it
    const ok = safe("inv.equip", () => {
      eq.setEquipment(EquipmentSlot.Mainhand, new ItemStack(id, 1));
      return true;
    }, false);
    return ok ? id : null;
  }
  if (eq) safe("inv.unequip", () => eq.setEquipment(EquipmentSlot.Mainhand, undefined));
  return null;
}

/** Shows a block in hand while building, so the animation reads correctly. */
export function holdBlock(citizen, typeId) {
  const eq = equippable(citizen);
  if (!eq) return;
  safe("inv.hold", () => {
    eq.setEquipment(EquipmentSlot.Mainhand, typeId ? new ItemStack(typeId, 1) : undefined);
  });
}

export function bestToolFor(typeId) {
  if (/log|planks|wood|fence|door|chest|barrel/.test(typeId)) return "axe";
  if (/dirt|sand|gravel|clay|soul_soil|snow/.test(typeId)) return "shovel";
  if (/leaves|wool|web/.test(typeId)) return null;
  return "pickaxe";
}

// --- world containers ---------------------------------------------------
export function isContainerBlock(typeId) {
  return CONTAINER_BLOCKS.has(typeId) || typeId.endsWith("shulker_box");
}

export function openBlockContainer(dimension, pos) {
  return safe("inv.block", () => {
    const block = dimension.getBlock(pos);
    if (!block || !isContainerBlock(block.typeId)) return null;
    const comp = block.getComponent("minecraft:inventory");
    return comp ? comp.container : null;
  }, null);
}

/** Moves up to `amount` of `typeId` from the citizen into a chest. */
export function depositTo(citizen, container, typeId, amount = Infinity) {
  if (!container) return 0;
  const mine = citizen.container;
  if (!mine) return 0;
  let moved = 0;
  for (let i = 0; i < mine.size && moved < amount; i++) {
    const stack = safe("inv.depScan", () => mine.getItem(i));
    if (!stack || (typeId && stack.typeId !== typeId)) continue;
    const take = Math.min(stack.amount, amount - moved);
    const leftover = safe("inv.dep", () => container.addItem(new ItemStack(stack.typeId, take)), null);
    const actually = take - (leftover ? leftover.amount : 0);
    if (actually <= 0) break;
    moved += actually;
    if (stack.amount - actually <= 0) safe("inv.depClear", () => mine.setItem(i, undefined));
    else { stack.amount -= actually; safe("inv.depSet", () => mine.setItem(i, stack)); }
  }
  return moved;
}

/** Moves up to `amount` of `typeId` out of a chest and into the citizen. */
export function withdrawFrom(citizen, container, typeId, amount = 1) {
  if (!container) return 0;
  let need = amount;
  for (let i = 0; i < container.size && need > 0; i++) {
    const stack = safe("inv.wdScan", () => container.getItem(i));
    if (!stack || stack.typeId !== typeId) continue;
    const take = Math.min(stack.amount, need);
    const got = giveItem(citizen, typeId, take);
    if (got <= 0) break;
    need -= got;
    if (stack.amount - got <= 0) safe("inv.wdClear", () => container.setItem(i, undefined));
    else { stack.amount -= got; safe("inv.wdSet", () => container.setItem(i, stack)); }
  }
  return amount - need;
}

export function containerContents(container) {
  const out = new Map();
  if (!container) return out;
  for (let i = 0; i < container.size; i++) {
    const stack = safe("inv.contents", () => container.getItem(i));
    if (!stack) continue;
    out.set(stack.typeId, (out.get(stack.typeId) || 0) + stack.amount);
  }
  return out;
}

/** Drops an item at the citizen's feet, e.g. when handing something to a player. */
export function dropItem(citizen, typeId, amount = 1) {
  const taken = takeItem(citizen, typeId, amount);
  if (taken <= 0) return 0;
  const loc = citizen.location;
  safe("inv.drop", () => {
    citizen.dimension.spawnItem(new ItemStack(typeId, taken), { x: loc.x, y: loc.y + 1, z: loc.z });
  });
  return taken;
}

export function summariseInventory(citizen, limit = 6) {
  const entries = [...citizen.listInventory().entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, n]) => `${n}x ${prettyId(id)}`);
  return entries.length ? entries.join(", ") : "nothing";
}
