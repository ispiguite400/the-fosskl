# Building a civilisation

What the mob is best at, and how it works.

---

## Founding

Stand somewhere with wood, stone and water in reach, gather a few citizens, and:

```
!ai found Rivermeet
```

Everyone within 48 blocks joins, roles get divided up, and the settlement starts
planning. Leave the name off and it invents one.

A settlement claims a radius of 48 blocks (`!ai config settlementRadius`). Inside
that it lays out a plot grid, decides what to build, tracks its own chests, and
keeps a history.

---

## The tier ladder

| Tier | Needs | Unlocks |
|---|---|---|
| **camp** | — | campfire, field, well, cottage |
| **hamlet** | 2 housing, 4 food | storehouse, lamp post, road, workshop |
| **village** | 4 housing, 8 food, 6 storage, 2 crafting | watchtower, wall, shrine |
| **town** | 8 housing, 12 food, 12 storage, 3 defence | town hall |

Each tier's requirements are reachable from what earlier tiers unlock — there is
a test for that, because a ladder with a rung missing leaves a settlement stuck
forever one requirement short of the thing that would satisfy it.

Stats come from finished buildings. A cottage is 1 housing, a field is 4 food, a
storehouse is 6 storage, a workshop is 2 crafting, a watchtower is 3 defence.

---

## What gets built next

Each upkeep pass the settlement scores what it is short of:

| Want | Weight | Building |
|---|---|---|
| Housing (population + 1) | 6 + 2 per missing roof | cottage |
| Food (2 per citizen) | 7 | field |
| Storage (2 per citizen) | 5 | storehouse |
| Crafting | 4.5 | workshop |
| Water | 4 | well |
| Defence | 4 | watchtower |
| Safety | 3.5 | lamp post |
| Civic | 3 | town hall |
| Culture | 2 | shrine |

Highest weight that is unlocked and not already queued wins. At most three
things are in the queue at once, so citizens finish what they start.

Housing deliberately runs *one ahead* of the population: a town with nowhere for
a newcomer to sleep never grows, and never reaches the next tier.

---

## Where it gets built

`allocatePlot` walks outward in rings, skipping ground already claimed, and asks
`findBuildSite` whether the footprint is flat enough (no more than four blocks of
variation). Buildings are rotated to face the town centre.

Citizens never dig inside a building footprint or in the six-block plaza at the
centre — `civ/territory.js` marks that ground off limits to every gathering
task. Without it they quarry their own town square.

---

## Trades

Assigned by need whenever the roster changes:

| Trade | Share | Does |
|---|---|---|
| builder | 25% | Raises what is queued, fetching materials from the stores |
| woodcutter | 18% | Fells trees, delivers timber |
| miner | 18% | Ore and stone; sinks a shaft when the surface is worked out |
| farmer | 16% | Tills near water, sows, harvests, re-sows |
| crafter | 10% | Covers the build queue's shortfall; keeps the town tooled up |
| guard | 12% (5+) | Patrols, fights, lights the place at night |
| hauler | 1 (7+) | Moves goods into the stores |
| scout | 1 (8+) | Maps the surroundings |
| architect | 1 (6+) | Decides what gets built next |
| settler | rest | Whatever is most useful |

`!ai job Ada builder` locks a citizen's trade; the allocator leaves locked
citizens alone.

---

## Materials

Builders check what they carry, then the stores, then go and make it:

```
needs oak planks → none carried → none stored → fell a tree → craft planks → build
needs cobblestone → quarry stone
needs dirt → dig soil
needs glass → dig sand → smelt
```

Blueprints accept substitutes — any plank for oak planks, stone or deepslate for
cobblestone — so a build is not blocked by the wrong species of tree.

`!ai town` lists what the queue is short of.

---

## Growth

Every minute or so, a settlement with a spare bed and food in the stores
attracts a newcomer. They arrive, introduce themselves, and get a trade.

`!ai config autoGrow false` stops it. `!ai config maxCitizens 12` caps it.

---

## Blueprints

A blueprint is layers of text. `layers[y][z][x]` is one character looked up in a
palette. A space means "leave whatever is there alone".

```js
small_house: bp({
  id: "small_house",
  name: "cottage",
  provides: { housing: 1 },
  anchor: { x: 3, y: 0, z: 6 },     // the block the origin refers to
  layers: [
    ["CCCCCCC", "CCCCCCC", ...],    // y=0, foundation
    ["LPPPPPL", "PeK..HP", ...],    // y=1, walls and furniture
  ],
}),
```

Palette entries are a block id, or an object:

| Field | Meaning |
|---|---|
| `block` | What to place |
| `states` | Block states — door halves, bed pieces |
| `optional` | Skip silently if the material is missing (furniture) |
| `free` | Place without consuming an item (the upper half of a door) |
| `costs` | Consume a different item (farmland costs dirt) |

Cells are sorted bottom-up before building, so a citizen never has to place a
block it cannot reach.

The twelve that ship: `campfire` `small_house` `storehouse` `workshop` `well`
`farm_plot` `watchtower` `town_hall` `wall_segment` `lamp_post` `road_segment`
`shrine`.

`!ai structures` lists them in game with material costs.

---

## Several settlements

Found as many as you like. Each keeps its own roster, queue, stores and history.
Citizens belong to the nearest one when they spawn, or to whichever one you
recruit them into from the control panel.
