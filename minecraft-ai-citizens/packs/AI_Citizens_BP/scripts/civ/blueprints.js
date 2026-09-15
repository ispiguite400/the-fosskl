/**
 * Structures citizens know how to build.
 *
 * A blueprint is layers of text. `layers[y][z][x]` is one character looked up
 * in `palette`; a space means "leave whatever is there alone". Palette entries
 * may be a plain block id or `{ block, states, optional, free }`:
 *   optional - skip silently when the material is missing (furniture)
 *   free     - place without consuming an item (second half of a door/bed)
 */

const AIR = ".";

const P = {
  C: "minecraft:cobblestone",
  S: "minecraft:stone",
  P: "minecraft:oak_planks",
  L: "minecraft:oak_log",
  F: "minecraft:oak_fence",
  G: "minecraft:glass",
  D: { block: "minecraft:oak_door", states: { direction: 2, upper_block_bit: false, door_hinge_bit: false, open_bit: false } },
  d: { block: "minecraft:oak_door", states: { direction: 2, upper_block_bit: true, door_hinge_bit: false, open_bit: false }, free: true },
  T: { block: "minecraft:torch", optional: true },
  H: { block: "minecraft:chest", optional: true },
  K: { block: "minecraft:crafting_table", optional: true },
  U: { block: "minecraft:furnace", optional: true },
  e: { block: "minecraft:red_bed", states: { direction: 0, head_piece_bit: false, occupied_bit: false }, optional: true },
  E: { block: "minecraft:red_bed", states: { direction: 0, head_piece_bit: true, occupied_bit: false }, optional: true, free: true },
  W: { block: "minecraft:water", free: true },
  M: { block: "minecraft:farmland", costs: "minecraft:dirt" },
  R: { block: "minecraft:dirt_path", costs: "minecraft:dirt" },
  A: "minecraft:oak_slab",
  B: "minecraft:cobblestone_slab",
  N: { block: "minecraft:lantern", optional: true },
  ".": "minecraft:air",
};

function bp(def) {
  return {
    ...def,
    palette: { ...P, ...(def.palette || {}) },
    width: def.layers[0][0].length,
    depth: def.layers[0].length,
    height: def.layers.length,
  };
}

export const BLUEPRINTS = {
  // ----------------------------------------------------------------- camp
  campfire: bp({
    id: "campfire",
    name: "campfire",
    tier: 0,
    role: "gathering",
    cost: { "minecraft:oak_log": 4, "minecraft:cobblestone": 8 },
    anchor: { x: 2, y: 0, z: 2 },
    layers: [
      [
        "CCCCC",
        "C...C",
        "C...C",
        "C...C",
        "CCCCC",
      ],
      [
        "L...L",
        ".....",
        "..T..",
        ".....",
        "L...L",
      ],
    ],
  }),

  // ---------------------------------------------------------------- house
  small_house: bp({
    id: "small_house",
    repeatable: true,
    name: "cottage",
    tier: 1,
    role: "housing",
    provides: { housing: 1 },
    cost: { "minecraft:oak_planks": 96, "minecraft:cobblestone": 60, "minecraft:oak_log": 16, "minecraft:glass": 8 },
    anchor: { x: 3, y: 0, z: 6 },
    layers: [
      [
        "CCCCCCC",
        "CCCCCCC",
        "CCCCCCC",
        "CCCCCCC",
        "CCCCCCC",
        "CCCCCCC",
        "CCCCCCC",
      ],
      [
        "LPPPPPL",
        "PeK..HP",
        "PE....P",
        "P.....P",
        "P.....P",
        "P....UP",
        "LPPDPPL",
      ],
      [
        "LPGPGPL",
        "G.....G",
        "P....TP",
        "P.....P",
        "P.....P",
        "G.....G",
        "LPGdGPL",
      ],
      [
        "LPPPPPL",
        "P.....P",
        "P.....P",
        "P.....P",
        "P.....P",
        "P.....P",
        "LPPPPPL",
      ],
      [
        "AAAAAAA",
        "APPPPPA",
        "APPPPPA",
        "APPPPPA",
        "APPPPPA",
        "APPPPPA",
        "AAAAAAA",
      ],
    ],
  }),

  // ------------------------------------------------------------ storehouse
  storehouse: bp({
    id: "storehouse",
    repeatable: true,
    name: "storehouse",
    tier: 1,
    role: "storage",
    provides: { storage: 6 },
    cost: { "minecraft:oak_planks": 90, "minecraft:cobblestone": 63, "minecraft:chest": 6 },
    anchor: { x: 3, y: 0, z: 6 },
    layers: [
      [
        "CCCCCCC",
        "CCCCCCC",
        "CCCCCCC",
        "CCCCCCC",
        "CCCCCCC",
        "CCCCCCC",
        "CCCCCCC",
      ],
      [
        "LPPPPPL",
        "PHHHHHP",
        "P.....P",
        "P.....P",
        "PH...HP",
        "PH...HP",
        "LPPDPPL",
      ],
      [
        "LPGPGPL",
        "P.....P",
        "P....TP",
        "P.....P",
        "PT....P",
        "P.....P",
        "LPGdGPL",
      ],
      [
        "AAAAAAA",
        "APPPPPA",
        "APPPPPA",
        "APPPPPA",
        "APPPPPA",
        "APPPPPA",
        "AAAAAAA",
      ],
    ],
  }),

  // -------------------------------------------------------------- workshop
  workshop: bp({
    id: "workshop",
    name: "workshop",
    tier: 1,
    role: "crafting",
    provides: { crafting: 2 },
    cost: { "minecraft:oak_planks": 70, "minecraft:cobblestone": 70, "minecraft:crafting_table": 2, "minecraft:furnace": 2 },
    anchor: { x: 3, y: 0, z: 6 },
    layers: [
      [
        "CCCCCCC",
        "CCCCCCC",
        "CCCCCCC",
        "CCCCCCC",
        "CCCCCCC",
        "CCCCCCC",
        "CCCCCCC",
      ],
      [
        "LCCCCCL",
        "CKK.UUC",
        "C.....C",
        "C.....C",
        "C.....C",
        "CH...HC",
        "LCCDCCL",
      ],
      [
        "LCGCGCL",
        "C....TC",
        "C.....C",
        "C.....C",
        "CT....C",
        "C.....C",
        "LCGdGCL",
      ],
      [
        "BBBBBBB",
        "BCCCCCB",
        "BCCCCCB",
        "BCCCCCB",
        "BCCCCCB",
        "BCCCCCB",
        "BBBBBBB",
      ],
    ],
  }),

  // ------------------------------------------------------------------ well
  well: bp({
    id: "well",
    name: "well",
    tier: 0,
    role: "water",
    provides: { water: 1 },
    cost: { "minecraft:cobblestone": 40, "minecraft:oak_fence": 4 },
    anchor: { x: 2, y: 1, z: 2 },
    layers: [
      [
        "CCCCC",
        "CWWWC",
        "CWWWC",
        "CWWWC",
        "CCCCC",
      ],
      [
        "CCCCC",
        "C...C",
        "C...C",
        "C...C",
        "CCCCC",
      ],
      [
        "F...F",
        ".....",
        ".....",
        ".....",
        "F...F",
      ],
      [
        "BBBBB",
        "BBBBB",
        "BBBBB",
        "BBBBB",
        "BBBBB",
      ],
    ],
  }),

  // -------------------------------------------------------------- farm plot
  farm_plot: bp({
    id: "farm_plot",
    repeatable: true,
    name: "field",
    tier: 0,
    role: "food",
    provides: { food: 4 },
    cost: { "minecraft:dirt": 40, "minecraft:oak_fence": 24 },
    anchor: { x: 4, y: 1, z: 4 },
    layers: [
      [
        "CCCCCCCCC",
        "CMMMMMMMC",
        "CMMMMMMMC",
        "CMMMWMMMC",
        "CMMMMMMMC",
        "CMMMMMMMC",
        "CMMMMMMMC",
        "CMMMMMMMC",
        "CCCCCCCCC",
      ],
      [
        "FFFFFFFFF",
        "F.......F",
        "F.......F",
        "F.......F",
        "F.......F",
        "F.......F",
        "F.......F",
        "F.......F",
        "FFFF.FFFF",
      ],
    ],
  }),

  // ------------------------------------------------------------- watchtower
  watchtower: bp({
    id: "watchtower",
    repeatable: true,
    name: "watchtower",
    tier: 2,
    role: "defence",
    provides: { defence: 3 },
    cost: { "minecraft:cobblestone": 150, "minecraft:oak_planks": 30, "minecraft:torch": 4 },
    anchor: { x: 2, y: 0, z: 2 },
    layers: [
      ["CCCCC", "CCCCC", "CCCCC", "CCCCC", "CCCCC"],
      ["CCCCC", "C...C", "C...C", "C...C", "CCDCC"],
      ["CCCCC", "C...C", "C...C", "C...C", "CCdCC"],
      ["CCGCC", "C...C", "G...G", "C...C", "CCGCC"],
      ["CCCCC", "C...C", "C...C", "C...C", "CCCCC"],
      ["CCCCC", "C...C", "C...C", "C...C", "CCCCC"],
      ["CPPPC", "PPPPP", "PPPPP", "PPPPP", "CPPPC"],
      ["F...F", ".T.T.", ".....", ".T.T.", "F...F"],
      ["FFFFF", "F...F", "F...F", "F...F", "FFFFF"],
    ],
  }),

  // ------------------------------------------------------------- town hall
  town_hall: bp({
    id: "town_hall",
    name: "town hall",
    tier: 3,
    role: "civic",
    provides: { civic: 5, storage: 4 },
    cost: { "minecraft:oak_planks": 240, "minecraft:cobblestone": 200, "minecraft:glass": 20, "minecraft:oak_log": 40 },
    anchor: { x: 5, y: 0, z: 10 },
    layers: [
      [
        "CCCCCCCCCCC", "CCCCCCCCCCC", "CCCCCCCCCCC", "CCCCCCCCCCC",
        "CCCCCCCCCCC", "CCCCCCCCCCC", "CCCCCCCCCCC", "CCCCCCCCCCC",
        "CCCCCCCCCCC", "CCCCCCCCCCC", "CCCCCCCCCCC",
      ],
      [
        "LPPPPPPPPPL",
        "PH.......HP",
        "P.........P",
        "P.........P",
        "P.........P",
        "P....K....P",
        "P.........P",
        "P.........P",
        "P.........P",
        "PT.......TP",
        "LPPPPDPPPPL",
      ],
      [
        "LPGPGPGPGPL",
        "G.........G",
        "P.........P",
        "G.........G",
        "P.........P",
        "G.........G",
        "P.........P",
        "G.........G",
        "P.........P",
        "G.........G",
        "LPGPGdGPGPL",
      ],
      [
        "LPPPPPPPPPL",
        "P.........P",
        "P.........P",
        "P.........P",
        "P.........P",
        "P.........P",
        "P.........P",
        "P.........P",
        "P.........P",
        "P.........P",
        "LPPPPPPPPPL",
      ],
      [
        "AAAAAAAAAAA",
        "APPPPPPPPPA",
        "APPPPPPPPPA",
        "APPPPPPPPPA",
        "APPPPPPPPPA",
        "APPPPPPPPPA",
        "APPPPPPPPPA",
        "APPPPPPPPPA",
        "APPPPPPPPPA",
        "APPPPPPPPPA",
        "AAAAAAAAAAA",
      ],
      [
        "           ",
        " AAAAAAAAA ",
        " APPPPPPPA ",
        " APPPPPPPA ",
        " APPPPPPPA ",
        " APPPPPPPA ",
        " APPPPPPPA ",
        " APPPPPPPA ",
        " APPPPPPPA ",
        " AAAAAAAAA ",
        "           ",
      ],
    ],
  }),

  // ----------------------------------------------------------- wall & gate
  wall_segment: bp({
    id: "wall_segment",
    repeatable: true,
    name: "wall",
    tier: 2,
    role: "defence",
    provides: { defence: 1 },
    cost: { "minecraft:cobblestone": 20 },
    anchor: { x: 0, y: 0, z: 2 },
    layers: [
      ["C", "C", "C", "C", "C"],
      ["C", "C", "C", "C", "C"],
      ["C", "C", "C", "C", "C"],
      ["B", "B", "B", "B", "B"],
    ],
  }),

  lamp_post: bp({
    id: "lamp_post",
    repeatable: true,
    name: "lamp post",
    tier: 1,
    role: "safety",
    provides: { safety: 1 },
    cost: { "minecraft:oak_fence": 3, "minecraft:torch": 1 },
    anchor: { x: 0, y: 0, z: 0 },
    layers: [["C"], ["F"], ["F"], ["F"], ["N"]],
  }),

  road_segment: bp({
    id: "road_segment",
    repeatable: true,
    name: "road",
    tier: 1,
    role: "infrastructure",
    cost: { "minecraft:dirt_path": 15 },
    anchor: { x: 1, y: 0, z: 2 },
    layers: [["RRR", "RRR", "RRR", "RRR", "RRR"]],
  }),

  shrine: bp({
    id: "shrine",
    name: "shrine",
    tier: 3,
    role: "culture",
    provides: { culture: 3, morale: 4 },
    cost: { "minecraft:stone": 60, "minecraft:glass": 8, "minecraft:torch": 4 },
    anchor: { x: 2, y: 0, z: 2 },
    layers: [
      ["SSSSS", "SSSSS", "SSSSS", "SSSSS", "SSSSS"],
      ["S...S", ".....", ".....", ".....", "S...S"],
      ["S...S", ".....", "..N..", ".....", "S...S"],
      ["SSSSS", "SGGGS", "SGGGS", "SGGGS", "SSSSS"],
      [".....", ".BBB.", ".BBB.", ".BBB.", "....."],
    ],
  }),
};

export function blueprintById(id) {
  return BLUEPRINTS[id] || null;
}

export function blueprintsForTier(tier) {
  return Object.values(BLUEPRINTS).filter((b) => (b.tier ?? 0) <= tier);
}

export function blueprintsByRole(role) {
  return Object.values(BLUEPRINTS).filter((b) => b.role === role);
}

/** Total item requirement for a blueprint, as a Map. */
export function materialsFor(blueprint) {
  const out = new Map();
  for (const layer of blueprint.layers) {
    for (const row of layer) {
      for (const ch of row) {
        if (ch === " ") continue;
        const entry = blueprint.palette[ch];
        if (!entry) continue;
        const block = typeof entry === "string" ? entry : entry.block;
        if (block === "minecraft:air" || block === "minecraft:water") continue;
        if (typeof entry === "object" && entry.free) continue;
        const cost = typeof entry === "object" && entry.costs ? entry.costs : block;
        out.set(cost, (out.get(cost) || 0) + 1);
      }
    }
  }
  return out;
}

export function describeBlueprint(blueprint) {
  const mats = [...materialsFor(blueprint).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id, n]) => `${n}x ${id.replace("minecraft:", "").replace(/_/g, " ")}`);
  return `${blueprint.name} (${blueprint.width}x${blueprint.depth}x${blueprint.height}) needs ${mats.join(", ")}`;
}
