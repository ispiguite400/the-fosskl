# Architecture

## The shape of it

A citizen is a Bedrock entity with a soul bolted on. The entity knows how to
walk, swing and be hurt. Everything that makes it a person — name, personality,
memory, plans, speech — lives in script and is mirrored into the entity's
dynamic properties so it survives chunk unloads and world reloads.

```
                         ┌──────────────┐
   chat / interaction ──▶│   commands   │
                         └──────┬───────┘
                                ▼
   ┌──────────┐          ┌──────────────┐          ┌──────────────┐
   │perception│─────────▶│    brain     │◀────────▶│ Claude bridge│
   └──────────┘          │ local │claude│          │  (optional)  │
        ▲                └──────┬───────┘          └──────────────┘
        │                       │ decision
   ┌────┴─────┐                 ▼
   │  world   │◀─────── ┌──────────────┐ ◀─── jobs ◀─── settlement
   └──────────┘  tasks  │   actions    │
                        └──────┬───────┘
                               ▼
                        ┌──────────────┐
                        │   captions   │
                        └──────────────┘
```

Both brains speak the same language — a decision object — so the body does not
know or care which one is driving.

```js
{
  say: "There's iron in the rock over north-east.",
  to: "Jordan",
  mood: "steady",
  goal: "get iron to the stores",
  remember: ["iron seam at the ridge"],
  actions: [{ do: "mine", block: "minecraft:iron_ore", count: 12 }],
}
```

---

## The tick loop

One interval, running every four ticks (five times a second). Work is spread so
a large town never stalls the server.

| Every | What |
|---|---|
| 4 ticks | Step each citizen's current task; advance captions |
| 4 ticks | Re-plan a *slice* of the population (round-robin) |
| 40 ticks | Conversations |
| 100 ticks | Needs decay, settlement upkeep, persistence |
| 1200 ticks | Population growth check |

Only a slice re-plans each pass, so each citizen thinks about every two seconds
regardless of how many there are. Perception — the expensive part — happens only
on a think.

Every subsystem call is wrapped. One uncaught exception in Bedrock kills the
whole script module for the session, so nothing is allowed to throw into the
engine.

---

## Navigation, and why it looks like this

Bedrock exposes **no pathfinding API to scripts**. There is no `navigateTo`.

So the add-on drives the *vanilla* pathfinder instead. Each citizen owns an
invisible marker entity (`ai:nav_point`); the citizen's behaviour pack contains
`nearest_attackable_target` + `move_towards_target` goals pointed at that
marker's family. Park the marker somewhere and the citizen walks to it, using
Minecraft's own pathfinder — doors, ladders, jumps and all.

One problem: `nearest_attackable_target` filters on *static* data, so a single
shared marker family would let two citizens lock onto each other's markers. The
fix is channels. There are sixteen marker families (`ai_nav_0` … `ai_nav_15`)
and sixteen matching component groups on the citizen; each citizen is assigned
the least-used channel at spawn. `tools/generate_entities.py` writes all of it,
and `tools/validate.mjs` checks the script's channel count still matches.

On top of that, `actions/navigation.js` plans a coarse route (ground-snapped
waypoints every eight blocks), parks the marker on the next one, and watches for
a citizen making no progress. When one gets wedged it jumps, side-steps, bridges
a gap, tunnels through, and — only as a last resort, and only if you leave
`allowTeleportUnstick` on — nudges them free.

**Mining is not navigation.** A block twenty blocks underground has no reachable
place to stand next to it, so `standingSpotFor` returns nothing and the citizen
switches to digging: it cuts a *staircase* toward the target, one tread and one
riser at a time, because a vertical shaft is something you can fall into but
never climb out of, and the pathfinder will not follow you down one.

---

## Modules

### `core/`
| | |
|---|---|
| `config.js` | Every tunable, with runtime overrides persisted to the world |
| `util.js` | Vectors, seeded RNG, text wrapping, compass directions |
| `store.js` | JSON over dynamic properties, chunked past the size limit |
| `blocks.js` | What citizens know: ores, hardness, drops, hazards, what is off limits |
| `recipes.js` | The crafting subset a village actually needs |
| `names.js` | Seeded name and settlement-name generation |
| `scheduler.js` | Round-robin slicing and throttles |
| `generated.js` | Written by `generate_entities.py`; keeps channel counts in sync |

### `agent/`
| | |
|---|---|
| `citizen.js` | The Citizen class and registry; persistence; mode and state |
| `personality.js` | Eight traits, a voice, a quirk and a dream, all seeded |
| `needs.js` | Hunger, energy, social contact, safety, morale |
| `memory.js` | Episodic events, durable facts, people, places, orders, dialogue |
| `perception.js` | Builds the world snapshot, and the prose describing it |

Personality is derived from a stable seed rather than stored, so a citizen is
the same person across restarts without spending any save space on it. Memory is
bounded everywhere — a world left running for a month cannot grow the save.

### `actions/`
The verbs. Every task is a plain object with a `kind`; `stepTask` advances it
one tick-slice and returns `running` / `done` / `failed` / `nomaterial` /
`nostation`. Both brains emit these and nothing else.

`navigation` `mine` `build` `craft` `farm` `combat` `interact` `inventory`
`registry`

### `brain/`
| | |
|---|---|
| `index.js` | Runs the local brain every tick, lets Claude supersede it |
| `local.js` | Utility planner: survive → orders → needs → work → social → wander |
| `claude.js` | Async request pipeline, health tracking, backoff |
| `prompt.js` | Builds the context packet |
| `schema.js` | The action vocabulary and the decoder that validates every reply |
| `transport*.js` | Network indirection, so the pack builds without the beta module |

`transport.js` re-exports from `transport_none.js` by default. `build.sh
--claude` rewrites it to `transport_net.js` and adds the manifest dependency.
A static `import` of a module that is not present would kill the whole bundle at
load time, which is why this is a file swap and not a runtime check.

### `civ/`
| | |
|---|---|
| `settlement.js` | Claims, plot grid, build queue, stockpile, tiers, growth |
| `jobs.js` | Ten trades; each turns "the town needs X" into "do Y next" |
| `blueprints.js` | Twelve structures as layered text |
| `territory.js` | What ground is off limits to digging |

`territory.js` is separate from `settlement.js` on purpose: the action layer
needs to ask "may I dig here?", and `settlement.js` imports the builder, which
imports the miner. Splitting it breaks the cycle.

### `social/`, `ui/`, `commands/`
Conversations and turn-taking; relationship scores; the caption renderer and
the control panel; chat parsing and the `!ai` command set.

---

## Testing

There is no Minecraft in CI, so `tools/sim/` mocks `@minecraft/server`: a voxel
world, entities, containers, block permutations, dynamic properties, the event
signals, and a stand-in for the vanilla pathfinder. It answers the same API
shapes the add-on calls, so the *real* add-on code runs against it.

| | |
|---|---|
| `tools/validate.mjs` | Imports resolve, JSON parses, every pack reference exists, channel counts match |
| `tools/scenarios.mjs` | 34 behaviour checks — building, deep mining, orders, captions, conversation, settlement growth, combat, reload |
| `tools/simulate.mjs` | Runs a town for N ticks and reports; `--verbose` dumps per-citizen state |

The mock is not an emulator and cannot tell you a house looks right. What it
does tell you is that the tick loop survives, that citizens really mine, build,
talk and take orders, and that nothing throws.

---

## Adding things

**A new action.** Write a stepper in `actions/`, register it in
`actions/registry.js`, add it to `ACTIONS` in `brain/schema.js` (which is what
the prompt shows Claude), and decode it in `decodeAction`.

**A new structure.** Add a blueprint to `civ/blueprints.js` — layers of text
plus a palette. Mark furniture `optional` so a missing chest does not block the
build, and use `costs` when the block placed is not the item consumed
(farmland costs dirt). Then add it to a tier's `unlocks` in `civ/settlement.js`.

**A new job.** Add a `plan(citizen, ctx)` to `civ/jobs.js` returning one task,
and give it a share in `assignJobs`.

**A new skin.** Add an archetype to `tools/generate_skins.py`, re-run it, and
raise `SKIN_COUNT` in `generate_entities.py` plus the texture list in the render
controller and the `ai:skin` property range.
