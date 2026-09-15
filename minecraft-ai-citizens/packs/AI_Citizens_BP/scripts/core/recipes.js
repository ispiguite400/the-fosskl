/**
 * A hand-picked crafting subset. Citizens craft from their own inventory plus
 * the settlement stockpile, so the list covers what a village actually needs.
 *
 * `inputs` accept either a concrete item id or a tag understood by
 * `resolveTag()` - "any_planks", "any_log", "any_wool".
 */
export const RECIPES = [
  { out: "minecraft:oak_planks", count: 4, inputs: [["any_log", 1]], station: null, tier: 0 },
  { out: "minecraft:stick", count: 4, inputs: [["any_planks", 2]], station: null, tier: 0 },
  { out: "minecraft:crafting_table", count: 1, inputs: [["any_planks", 4]], station: null, tier: 0 },
  { out: "minecraft:torch", count: 4, inputs: [["minecraft:coal", 1], ["minecraft:stick", 1]], station: null, tier: 0 },
  { out: "minecraft:chest", count: 1, inputs: [["any_planks", 8]], station: "crafting", tier: 0 },
  { out: "minecraft:furnace", count: 1, inputs: [["minecraft:cobblestone", 8]], station: "crafting", tier: 0 },
  { out: "minecraft:ladder", count: 3, inputs: [["minecraft:stick", 7]], station: "crafting", tier: 0 },
  { out: "minecraft:oak_door", count: 3, inputs: [["any_planks", 6]], station: "crafting", tier: 0 },
  { out: "minecraft:oak_fence", count: 3, inputs: [["any_planks", 4], ["minecraft:stick", 2]], station: "crafting", tier: 0 },
  { out: "minecraft:glass", count: 1, inputs: [["minecraft:sand", 1]], station: "furnace", tier: 1 },
  { out: "minecraft:stone", count: 1, inputs: [["minecraft:cobblestone", 1]], station: "furnace", tier: 1 },
  { out: "minecraft:bread", count: 1, inputs: [["minecraft:wheat", 3]], station: "crafting", tier: 0 },
  { out: "minecraft:iron_ingot", count: 1, inputs: [["minecraft:raw_iron", 1]], station: "furnace", tier: 1 },
  { out: "minecraft:gold_ingot", count: 1, inputs: [["minecraft:raw_gold", 1]], station: "furnace", tier: 2 },
  { out: "minecraft:copper_ingot", count: 1, inputs: [["minecraft:raw_copper", 1]], station: "furnace", tier: 1 },

  { out: "minecraft:wooden_pickaxe", count: 1, inputs: [["any_planks", 3], ["minecraft:stick", 2]], station: "crafting", tier: 0 },
  { out: "minecraft:wooden_axe", count: 1, inputs: [["any_planks", 3], ["minecraft:stick", 2]], station: "crafting", tier: 0 },
  { out: "minecraft:wooden_hoe", count: 1, inputs: [["any_planks", 2], ["minecraft:stick", 2]], station: "crafting", tier: 0 },
  { out: "minecraft:wooden_sword", count: 1, inputs: [["any_planks", 2], ["minecraft:stick", 1]], station: "crafting", tier: 0 },
  { out: "minecraft:stone_pickaxe", count: 1, inputs: [["minecraft:cobblestone", 3], ["minecraft:stick", 2]], station: "crafting", tier: 0 },
  { out: "minecraft:stone_axe", count: 1, inputs: [["minecraft:cobblestone", 3], ["minecraft:stick", 2]], station: "crafting", tier: 0 },
  { out: "minecraft:stone_sword", count: 1, inputs: [["minecraft:cobblestone", 2], ["minecraft:stick", 1]], station: "crafting", tier: 0 },
  { out: "minecraft:stone_shovel", count: 1, inputs: [["minecraft:cobblestone", 1], ["minecraft:stick", 2]], station: "crafting", tier: 0 },
  { out: "minecraft:iron_pickaxe", count: 1, inputs: [["minecraft:iron_ingot", 3], ["minecraft:stick", 2]], station: "crafting", tier: 1 },
  { out: "minecraft:iron_axe", count: 1, inputs: [["minecraft:iron_ingot", 3], ["minecraft:stick", 2]], station: "crafting", tier: 1 },
  { out: "minecraft:iron_sword", count: 1, inputs: [["minecraft:iron_ingot", 2], ["minecraft:stick", 1]], station: "crafting", tier: 1 },
  { out: "minecraft:shield", count: 1, inputs: [["any_planks", 6], ["minecraft:iron_ingot", 1]], station: "crafting", tier: 1 },
  { out: "minecraft:iron_helmet", count: 1, inputs: [["minecraft:iron_ingot", 5]], station: "crafting", tier: 1 },
  { out: "minecraft:iron_chestplate", count: 1, inputs: [["minecraft:iron_ingot", 8]], station: "crafting", tier: 1 },
  { out: "minecraft:iron_leggings", count: 1, inputs: [["minecraft:iron_ingot", 7]], station: "crafting", tier: 1 },
  { out: "minecraft:iron_boots", count: 1, inputs: [["minecraft:iron_ingot", 4]], station: "crafting", tier: 1 },
  { out: "minecraft:bucket", count: 1, inputs: [["minecraft:iron_ingot", 3]], station: "crafting", tier: 1 },
  { out: "minecraft:bowl", count: 4, inputs: [["any_planks", 3]], station: "crafting", tier: 0 },
  { out: "minecraft:oak_slab", count: 6, inputs: [["any_planks", 3]], station: "crafting", tier: 0 },
  { out: "minecraft:cobblestone_slab", count: 6, inputs: [["minecraft:cobblestone", 3]], station: "crafting", tier: 0 },
  { out: "minecraft:red_bed", count: 1, inputs: [["any_wool", 3], ["any_planks", 3]], station: "crafting", tier: 1 },
  { out: "minecraft:glass_pane", count: 16, inputs: [["minecraft:glass", 6]], station: "crafting", tier: 1 },
];

export const TAGS = {
  any_log: [
    "minecraft:oak_log", "minecraft:birch_log", "minecraft:spruce_log",
    "minecraft:jungle_log", "minecraft:acacia_log", "minecraft:dark_oak_log",
    "minecraft:mangrove_log", "minecraft:cherry_log", "minecraft:pale_oak_log",
  ],
  any_planks: [
    "minecraft:oak_planks", "minecraft:birch_planks", "minecraft:spruce_planks",
    "minecraft:jungle_planks", "minecraft:acacia_planks", "minecraft:dark_oak_planks",
    "minecraft:mangrove_planks", "minecraft:cherry_planks", "minecraft:pale_oak_planks",
  ],
  any_wool: [
    "minecraft:white_wool", "minecraft:light_gray_wool", "minecraft:gray_wool",
    "minecraft:brown_wool", "minecraft:red_wool", "minecraft:orange_wool",
    "minecraft:yellow_wool", "minecraft:lime_wool", "minecraft:green_wool",
    "minecraft:cyan_wool", "minecraft:blue_wool", "minecraft:purple_wool",
  ],
};

export function resolveTag(idOrTag) {
  return TAGS[idOrTag] || [idOrTag];
}

export function findRecipe(outputId) {
  return RECIPES.find((r) => r.out === outputId);
}

export function recipesProducing(outputId) {
  return RECIPES.filter((r) => r.out === outputId);
}
