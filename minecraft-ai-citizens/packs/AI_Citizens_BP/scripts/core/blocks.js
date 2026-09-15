/**
 * What citizens know about the world's blocks: what is worth mining, what is
 * safe to stand on, what each block drops, and how long it takes them.
 */
import { prettyId } from "./util.js";

export const ORES = {
  "minecraft:coal_ore": { drop: "minecraft:coal", value: 2, tier: 0 },
  "minecraft:deepslate_coal_ore": { drop: "minecraft:coal", value: 2, tier: 0 },
  "minecraft:copper_ore": { drop: "minecraft:raw_copper", value: 3, tier: 1 },
  "minecraft:deepslate_copper_ore": { drop: "minecraft:raw_copper", value: 3, tier: 1 },
  "minecraft:iron_ore": { drop: "minecraft:raw_iron", value: 6, tier: 1 },
  "minecraft:deepslate_iron_ore": { drop: "minecraft:raw_iron", value: 6, tier: 1 },
  "minecraft:gold_ore": { drop: "minecraft:raw_gold", value: 8, tier: 2 },
  "minecraft:deepslate_gold_ore": { drop: "minecraft:raw_gold", value: 8, tier: 2 },
  "minecraft:redstone_ore": { drop: "minecraft:redstone", value: 5, tier: 2 },
  "minecraft:deepslate_redstone_ore": { drop: "minecraft:redstone", value: 5, tier: 2 },
  "minecraft:lapis_ore": { drop: "minecraft:lapis_lazuli", value: 5, tier: 1 },
  "minecraft:deepslate_lapis_ore": { drop: "minecraft:lapis_lazuli", value: 5, tier: 1 },
  "minecraft:diamond_ore": { drop: "minecraft:diamond", value: 20, tier: 2 },
  "minecraft:deepslate_diamond_ore": { drop: "minecraft:diamond", value: 20, tier: 2 },
  "minecraft:emerald_ore": { drop: "minecraft:emerald", value: 18, tier: 2 },
  "minecraft:deepslate_emerald_ore": { drop: "minecraft:emerald", value: 18, tier: 2 },
  "minecraft:ancient_debris": { drop: "minecraft:ancient_debris", value: 40, tier: 3 },
  "minecraft:nether_gold_ore": { drop: "minecraft:gold_nugget", value: 3, tier: 1 },
  "minecraft:quartz_ore": { drop: "minecraft:quartz", value: 3, tier: 1 },
};

export const LOGS = new Set([
  "minecraft:oak_log", "minecraft:birch_log", "minecraft:spruce_log",
  "minecraft:jungle_log", "minecraft:acacia_log", "minecraft:dark_oak_log",
  "minecraft:mangrove_log", "minecraft:cherry_log", "minecraft:pale_oak_log",
  "minecraft:crimson_stem", "minecraft:warped_stem",
]);

export const LEAVES = new Set([
  "minecraft:oak_leaves", "minecraft:birch_leaves", "minecraft:spruce_leaves",
  "minecraft:jungle_leaves", "minecraft:acacia_leaves", "minecraft:dark_oak_leaves",
  "minecraft:mangrove_leaves", "minecraft:cherry_leaves", "minecraft:azalea_leaves",
  "minecraft:flowering_azalea_leaves", "minecraft:pale_oak_leaves",
]);

/** log id -> the planks it becomes */
export const LOG_TO_PLANKS = {
  "minecraft:oak_log": "minecraft:oak_planks",
  "minecraft:birch_log": "minecraft:birch_planks",
  "minecraft:spruce_log": "minecraft:spruce_planks",
  "minecraft:jungle_log": "minecraft:jungle_planks",
  "minecraft:acacia_log": "minecraft:acacia_planks",
  "minecraft:dark_oak_log": "minecraft:dark_oak_planks",
  "minecraft:mangrove_log": "minecraft:mangrove_planks",
  "minecraft:cherry_log": "minecraft:cherry_planks",
  "minecraft:pale_oak_log": "minecraft:pale_oak_planks",
  "minecraft:crimson_stem": "minecraft:crimson_planks",
  "minecraft:warped_stem": "minecraft:warped_planks",
};

export const PLANKS = new Set(Object.values(LOG_TO_PLANKS));

export const CROPS = {
  "minecraft:wheat": { mature: 7, drop: "minecraft:wheat", seed: "minecraft:wheat_seeds" },
  "minecraft:carrots": { mature: 7, drop: "minecraft:carrot", seed: "minecraft:carrot" },
  "minecraft:potatoes": { mature: 7, drop: "minecraft:potato", seed: "minecraft:potato" },
  "minecraft:beetroot": { mature: 7, drop: "minecraft:beetroot", seed: "minecraft:beetroot_seeds" },
};

export const FOODS = {
  "minecraft:bread": 5,
  "minecraft:cooked_beef": 8,
  "minecraft:cooked_porkchop": 8,
  "minecraft:cooked_chicken": 6,
  "minecraft:cooked_mutton": 6,
  "minecraft:cooked_cod": 5,
  "minecraft:cooked_salmon": 6,
  "minecraft:baked_potato": 5,
  "minecraft:carrot": 3,
  "minecraft:apple": 4,
  "minecraft:golden_carrot": 6,
  "minecraft:beetroot": 1,
  "minecraft:potato": 1,
  "minecraft:sweet_berries": 2,
  "minecraft:melon_slice": 2,
  "minecraft:dried_kelp": 1,
  "minecraft:pumpkin_pie": 8,
  "minecraft:beef": 3,
  "minecraft:chicken": 2,
};

/** Blocks a citizen must never mine or build over. */
export const PROTECTED = new Set([
  "minecraft:bedrock", "minecraft:barrier", "minecraft:command_block",
  "minecraft:repeating_command_block", "minecraft:chain_command_block",
  "minecraft:structure_block", "minecraft:jigsaw", "minecraft:end_portal",
  "minecraft:end_portal_frame", "minecraft:nether_portal", "minecraft:light_block",
  "minecraft:beacon", "minecraft:conduit", "minecraft:spawner", "minecraft:mob_spawner",
  "minecraft:chest", "minecraft:trapped_chest", "minecraft:barrel", "minecraft:ender_chest",
  "minecraft:shulker_box", "minecraft:furnace", "minecraft:blast_furnace",
  "minecraft:smoker", "minecraft:brewing_stand", "minecraft:enchanting_table",
  "minecraft:anvil", "minecraft:bed", "minecraft:crafting_table", "minecraft:lectern",
  "minecraft:jukebox", "minecraft:hopper", "minecraft:dispenser", "minecraft:dropper",
]);

export const DANGEROUS = new Set([
  "minecraft:lava", "minecraft:flowing_lava", "minecraft:fire", "minecraft:soul_fire",
  "minecraft:magma", "minecraft:cactus", "minecraft:sweet_berry_bush",
  "minecraft:campfire", "minecraft:soul_campfire", "minecraft:powder_snow",
  "minecraft:wither_rose", "minecraft:pointed_dripstone",
]);

export const PASSABLE = new Set([
  "minecraft:air", "minecraft:cave_air", "minecraft:void_air",
  "minecraft:short_grass", "minecraft:grass", "minecraft:tall_grass", "minecraft:fern",
  "minecraft:large_fern", "minecraft:dead_bush", "minecraft:seagrass",
  "minecraft:snow_layer", "minecraft:vine", "minecraft:torch", "minecraft:wall_torch",
  "minecraft:redstone_torch", "minecraft:lantern", "minecraft:water", "minecraft:flowing_water",
  "minecraft:dandelion", "minecraft:poppy", "minecraft:blue_orchid", "minecraft:allium",
  "minecraft:azure_bluet", "minecraft:red_tulip", "minecraft:orange_tulip",
  "minecraft:white_tulip", "minecraft:pink_tulip", "minecraft:oxeye_daisy",
  "minecraft:cornflower", "minecraft:lily_of_the_valley", "minecraft:sunflower",
  "minecraft:lilac", "minecraft:rose_bush", "minecraft:peony", "minecraft:crimson_roots",
  "minecraft:warped_roots", "minecraft:nether_sprouts", "minecraft:glow_lichen",
]);

/** Mining time multiplier - soft rock is quick, obsidian is a project. */
const HARDNESS = {
  "minecraft:dirt": 0.5, "minecraft:grass_block": 0.6, "minecraft:sand": 0.5,
  "minecraft:gravel": 0.6, "minecraft:clay": 0.6, "minecraft:snow": 0.3,
  "minecraft:stone": 1.5, "minecraft:cobblestone": 2.0, "minecraft:deepslate": 3.0,
  "minecraft:andesite": 1.5, "minecraft:diorite": 1.5, "minecraft:granite": 1.5,
  "minecraft:obsidian": 12.0, "minecraft:ancient_debris": 10.0,
  "minecraft:iron_ore": 3.0, "minecraft:diamond_ore": 3.0, "minecraft:gold_ore": 3.0,
  "minecraft:netherrack": 0.4, "minecraft:end_stone": 3.0,
};

export function hardnessOf(typeId) {
  if (HARDNESS[typeId] !== undefined) return HARDNESS[typeId];
  if (LOGS.has(typeId)) return 2.0;
  if (LEAVES.has(typeId)) return 0.2;
  if (PLANKS.has(typeId)) return 2.0;
  if (ORES[typeId]) return 3.0;
  if (typeId.includes("deepslate")) return 3.0;
  if (typeId.includes("wool") || typeId.includes("leaves")) return 0.8;
  return 1.5;
}

export function isPassable(typeId) {
  return PASSABLE.has(typeId) || typeId.endsWith("_sapling") || typeId.endsWith("_carpet");
}

export function isDangerous(typeId) {
  return DANGEROUS.has(typeId);
}

export function isProtected(typeId) {
  return PROTECTED.has(typeId) || typeId.includes("command_block") || typeId.endsWith("_bed");
}

export function isOre(typeId) {
  return Boolean(ORES[typeId]);
}

export function isLog(typeId) {
  return LOGS.has(typeId);
}

export function isFood(typeId) {
  return FOODS[typeId] !== undefined;
}

/** What a citizen gets in hand for breaking this block (simplified silk-free drops). */
export function dropsOf(typeId) {
  if (ORES[typeId]) return [{ id: ORES[typeId].drop, count: 1 }];
  if (LEAVES.has(typeId)) return [];
  if (typeId === "minecraft:stone") return [{ id: "minecraft:cobblestone", count: 1 }];
  if (typeId === "minecraft:deepslate") return [{ id: "minecraft:cobbled_deepslate", count: 1 }];
  if (typeId === "minecraft:grass_block" || typeId === "minecraft:dirt_with_roots") {
    return [{ id: "minecraft:dirt", count: 1 }];
  }
  if (typeId === "minecraft:gravel") return [{ id: "minecraft:gravel", count: 1 }];
  if (typeId.endsWith("_slab") || typeId.endsWith("_stairs")) return [{ id: typeId, count: 1 }];
  return [{ id: typeId, count: 1 }];
}

/** Short, human phrase a citizen would use for a block. */
export function describeBlock(typeId) {
  if (ORES[typeId]) return prettyId(typeId).replace(" ore", " ore");
  return prettyId(typeId);
}

/** Interest score: how excited a citizen is to see this while wandering. */
export function noteworthiness(typeId) {
  if (ORES[typeId]) return 3 + ORES[typeId].value / 10;
  if (typeId === "minecraft:lava" || typeId === "minecraft:flowing_lava") return 4;
  if (typeId === "minecraft:spawner" || typeId === "minecraft:mob_spawner") return 6;
  if (typeId === "minecraft:chest") return 4;
  if (typeId === "minecraft:water") return 1;
  if (LOGS.has(typeId)) return 1.2;
  return 0;
}
