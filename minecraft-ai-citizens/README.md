# AI Citizens

A Minecraft Bedrock add-on that adds a mob which looks like a player, thinks
like a person, and builds a town with you.

Spawn one and you get a named settler with a face, a trade, a personality and
a memory. They mine, chop, farm, craft, fight and build. They talk — in a
caption above their head, never in chat — to you and to each other, about what
they can actually see and what the town actually needs. Tell them what to do by
typing in chat. Give them ground and enough of them, and they will turn it into
a village and then a town, on their own.

They can think with **Claude** (`claude-opus-5`) when you run the included
bridge, and with a capable local brain when you don't.

```
/ai:spawn 6
/ai:cmd found Rivermeet
/ai:tell @Ada go find iron, we need it for the walls
/ai:tell everyone, follow me
```

---

## Contents

- [What they can do](#what-they-can-do)
- [Install](#install)
- [Talking to them](#talking-to-them)
- [Giving them a Claude brain](#giving-them-a-claude-brain)
- [Building a civilisation](#building-a-civilisation)
- [What is in the box](#what-is-in-the-box)
- [Development](#development)
- [What has and hasn't been tested](#what-has-and-hasnt-been-tested)

---

## What they can do

**They look like players.** Twenty procedurally generated player-model skins —
farmer, miner, smith, scout, builder, guard, scholar, healer, hunter, trader,
cook, fisher, mason, wanderer, elder, ranger, herbalist, cartwright, sentinel,
chronicler. Full player geometry with hat and jacket overlay layers, and
hand-written animations for walking, sprinting, swimming, mining, building,
crafting, farming, talking, sitting, sleeping, cheering and pointing.

**They do what a player does.**

| | |
|---|---|
| **Mine** | Find ore, follow a vein, and cut a staircase down to seams they cannot reach. Sink a shaft when the surface is worked out. |
| **Chop** | Fell whole trees, trunk by trunk. |
| **Build** | Twelve structures from blueprints — cottage, storehouse, workshop, well, field, watchtower, town hall, shrine, walls, roads, lamp posts, camp. They fetch materials, place bottom-up, and tell you what they are short of. |
| **Craft** | Thirty-odd recipes at a table or furnace, working backwards through the tree — no planks? They will go and fell a tree first. |
| **Farm** | Till near water, sow, harvest at maturity, and re-sow behind themselves. |
| **Fight** | Close on hostiles, swing with whatever weapon they have, retaliate when hit, and run when a fight is lost. Guards patrol and light the place at night. |
| **Carry and store** | Fill chests, take what a build needs out again, hand items to you. |
| **Look after themselves** | Eat when hungry, sleep at night, rest when exhausted. |

**They see, and they talk about it.** Every couple of seconds a citizen builds
a picture of the world around them — the time, the weather, who is nearby, what
is threatening them, which ores are in sight and in which direction, what is
dangerous. That picture is what they speak from. "There's iron in the rock over
north-east, about six paces." "Mind the lava over west." "Not tonight. Not a
creeper."

**They talk to each other.** Idle citizens standing near each other strike up
conversations, take turns, and remember what was said. Who they like and
dislike changes with what you and they do.

**Speech is always a caption.** Never chat spam. A line appears above their
head, revealed a character at a time, and fades. Colour tells you the register:
white for ordinary speech, green for friendly, red for alarm, yellow for taking
an order, blue for work.

**They remember.** Names, faces, places, facts, who helped and who hit them,
and your standing orders — all of it survives a world reload.

---

## Install

### Install

One file, everything in it.

1. Open **`AI_Citizens.mcaddon`**. Minecraft imports both packs.
2. In your world settings, activate **AI Citizens** under **Behaviour Packs**
   *and* **Resource Packs**.
3. Load the world and type `/ai:spawn 4`.

If nothing appears, type `/ai:doctor`. It reports the pack version actually
running, which parts of the Script API this world has, and whether the citizen
entity can be spawned — one command instead of guesswork.

**On reinstalling:** Minecraft replaces an installed pack only when the incoming
version is higher, and silently ignores it otherwise. Every build bumps
`VERSION` automatically so a new one always wins; `/ai:doctor` confirms which
build is live.

### Requirements

- Minecraft Bedrock **1.21.80** or newer
- No experiments, no account, no network
- Works in single-player, on Realms, on a dedicated server, on phones and on
  consoles that accept imported add-ons

### Talking to them, and the one thing that is version-specific

You talk to citizens with `/ai:tell`:

```
/ai:tell @Ada go mine some iron
/ai:tell everyone, follow me
```

Reading what you type in **open chat** — so you can drop the `/ai:tell` — is
only possible through Minecraft's *beta* script API, and every way of asking for
it is tied to a particular range of releases:

| Declared version | Works on | Cost of getting it wrong |
|---|---|---|
| `"2.0.0"` (default) | 1.21.80 → today | none; resolves forward like npm's `^` |
| `"2.1.0-beta"` | only the release that shipped that line | **the pack will not import** |
| `"beta"` | 1.21.120+ only | **the pack will not import** |

A manifest is parsed before anything else happens, so a version string the game
does not understand is not a missing feature — it is a refused import. The
default therefore asks for nothing version-specific.

To turn chat on for a version you know:

```bash
SERVER_VERSION=2.1.0-beta MIN_ENGINE=1.21.90 ./tools/build.sh
```

and enable **Beta APIs** on the world. `node tools/check-import.mjs` will tell
you whether the result can actually be imported.

---

## Talking to them

You talk to citizens by typing in chat. Three kinds of message:

**Speak to one of them by name.** They answer, and do it.

```
@Ada go mine some iron
Ada, follow me
@Pell build a house here
```

**Speak to everybody.**

```
everyone, follow me
all of you, stop
```

**Just talk.** Anything else you say is overheard by citizens within 32 blocks.
Sociable ones answer; the rest get on with their work. Ask them a question and
they will answer from what they actually know.

```
anyone found iron yet?
what are you working on?
```

They understand plain instructions: follow, come here, stop, chop wood, mine
iron, farm, build a house, guard, explore, attack, rest, store your goods. With
the Claude bridge running they understand a great deal more than that, and they
answer in their own voice.

Operator commands start with `!ai` in chat, or `/ai:cmd` anywhere:

```
!ai spawn 6 miner      /ai:cmd spawn 6 miner
!ai panel              /ai:panel
!ai found Rivermeet    /ai:cmd found Rivermeet
!ai town               /ai:cmd town
!ai doctor             /ai:doctor          what works on this world
!ai list               /ai:cmd list
!ai build small_house  /ai:cmd build small_house
!ai brain claude       /ai:cmd brain claude
!ai help               /ai:cmd help
```

Every one of these is also a real slash command with autocomplete, which is what
the stable build uses and what still works if chat is ever unavailable:

```
/ai:spawn 6 miner        /ai:tell @Ada go mine some iron
/ai:cmd found Rivermeet  /ai:panel        /ai:doctor
```

And `/scriptevent ai:cmd spawn 4` works even where custom commands do not — a
last resort, but it has never not worked.

The full list is in [docs/COMMANDS.md](docs/COMMANDS.md). Sneak-right-click a
citizen to open their page in the control panel.

---

## Giving them a Claude brain

Out of the box citizens run a local brain: a utility planner with a contextual
dialogue writer. It is genuinely capable — it is what drives everything in the
list above — and it needs no network.

The Claude bridge replaces the *judgement* and the *voice*. Instead of picking
a line from a bank, a citizen sends Claude who they are, what they can see,
what they remember and what the town needs, and gets back what they say and
what they do next.

```
cd bridge
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Then, in game:

```
!ai bridge http://127.0.0.1:8787
!ai brain claude
!ai status
```

**One important limitation.** Bedrock only lets scripts make HTTP requests on a
**Bedrock Dedicated Server**, through the `@minecraft/server-net` module. On a
phone, a console, a Realm or single-player that module does not exist, so the
Claude bridge cannot be reached from there and citizens use the local brain.
This is a platform restriction, not a choice. Build with `./tools/build.sh
--claude` and read [docs/CLAUDE_SETUP.md](docs/CLAUDE_SETUP.md) for the server
setup.

The two brains are not either/or. The local brain runs every think-tick and
Claude's answer supersedes it when it arrives — so a slow or failed request
makes citizens *less clever for a second*, never frozen and never silent. If the
bridge goes away entirely they carry on without it, and `!ai status` says so.

Details, cost control and safety notes: [docs/CLAUDE_SETUP.md](docs/CLAUDE_SETUP.md).

---

## Building a civilisation

This is what the mob is best at.

Stand somewhere with wood, stone and water, gather a few citizens, and:

```
!ai found Rivermeet
```

From then on the settlement runs itself.

**Roles are assigned by need.** A town of five gets a builder, a woodcutter, a
miner, a farmer and a crafter. At eight it gains a guard and a hauler; at ten,
a scout and an architect. Lock a citizen's trade with `!ai job` and the
allocator leaves them alone.

**It decides what to build next.** Housing before ornament, food before
luxuries, storage before statues. It surveys its own chests, works out what the
queue is short of, and sends citizens to get it.

**It grows in tiers.** Camp → hamlet → village → town, each unlocking new
blueprints. A town with a spare bed and food in the stores attracts newcomers on
its own, and announces them.

**It leaves itself alone.** Citizens never quarry the town square or undermine
a house — building footprints and the central plaza are off limits.

More on the tier ladder, the blueprint format and how to add your own:
[docs/CIVILIZATION.md](docs/CIVILIZATION.md).

---

## What is in the box

```
minecraft-ai-citizens/
├── packs/
│   ├── AI_Citizens_BP/          behaviour pack: entities + all the scripts
│   │   ├── entities/            citizen and waypoint definitions (generated)
│   │   └── scripts/             ~9,000 lines across 45 ES modules
│   │       ├── core/            config, persistence, block and recipe knowledge
│   │       ├── agent/           the citizen: personality, needs, memory, senses
│   │       ├── actions/         the verbs: move, mine, build, craft, farm, fight
│   │       ├── brain/           local planner, Claude client, decision schema
│   │       ├── civ/             settlements, jobs, blueprints, territory
│   │       ├── social/          dialogue, conversations, relationships
│   │       ├── ui/              captions and the control panel
│   │       └── commands/        chat parsing and command handlers
│   └── AI_Citizens_RP/          resource pack: 20 skins, model, animations
├── bridge/                      the Claude bridge (Node, one dependency)
├── tools/                       generators, validator, simulator, build script
└── docs/                        setup, commands, architecture, troubleshooting
```

---

## Development

```bash
./tools/build.sh                 # the add-on: dist/AI_Citizens.mcaddon
./tools/build.sh --claude        # adds the Claude bridge (dedicated server)
node tools/check-import.mjs      # will Minecraft accept the package?

node tools/validate.mjs          # static checks: imports, JSON, pack references
node tools/scenarios.mjs         # behaviour tests against a mock engine
node tools/simulate.mjs 8000     # run a town for 8000 ticks and report
node tools/simulate.mjs --verbose

python3 tools/generate_skins.py     # regenerate the 20 skins
python3 tools/generate_entities.py  # regenerate the entity definitions

cd bridge && npm install && npm start
DRY_RUN=true npm start           # test the wiring with no API calls, no cost
node bridge/test-bridge.mjs      # end-to-end check against a running bridge
```

`tools/sim/` is a small mock of `@minecraft/server` — a voxel world, entities,
containers, events and a stand-in for the vanilla pathfinder. It is not a
Minecraft emulator, but it runs the real add-on code, which is how the mining,
building, combat, conversation and persistence paths get exercised outside the
game. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the design.

---

## What has and hasn't been tested

Being straight about this, because it matters for what you should check first.

**Verified here, automatically:**

- Every module imports cleanly and every named import resolves (45 modules,
  280 imports).
- All pack JSON parses; every texture, animation, geometry, render controller,
  bone and component group referenced by the entity definitions exists.
- Every Molang query used is one Mojang documents, every entity property Molang
  reads is declared and `client_sync`, and no pre-release Script API is
  subscribed to without a guard. These checks exist because each of them was a
  real bug that stopped the add-on working.
- `tools/check-import.mjs` reads the built `.mcaddon` the way Minecraft parses
  it — manifest grammar, SemVer validity, UUIDs, the script entry actually being
  in the archive, and `min_engine_version` against a support floor. This exists
  because a manifest can be perfectly valid *content* and still be refused at
  import, which no other check in this repo could see.
- 56 behaviour checks pass against the mock engine: a stocked builder finishes a
  cottage and its walls stand in the world; a miner cuts down twenty blocks to a
  buried seam and comes back with emeralds; commands are swallowed while normal
  chat is not; orders become tasks and replace each other; replies appear as
  captions and never in chat; citizens hold conversations and remember them; a
  settlement founds, divides up roles and plans buildings; a citizen fights back
  when attacked; names, jobs, memory, personality and settlement membership all
  survive a reload; and — the regression that made the first version spawn
  nothing — the whole add-on boots, registers commands, spawns, takes orders and
  reports itself correctly on a runtime with no chat API at all.
- A 12,000-tick town runs with no runtime errors.
- The bridge serves a real add-on context packet end to end in dry-run.

**Not verified here, and worth checking first:**

- Nothing has been run in an actual Minecraft client — there isn't one in this
  environment. The pack structure, manifests and API usage are correct as far as
  static checking and the mock can tell, but first-run in-game is on you.
- The live Claude API call has not been made from here (no credentials
  available), so the request shape is written to the documented API but
  unproven. `node bridge/test-bridge.mjs` against a running bridge is the
  one-command way to confirm it. The bridge degrades gracefully if a parameter
  is rejected, and the add-on falls back to the local brain either way.
- Bed and door block ids differ between Bedrock versions; both are marked
  optional in the blueprints, so a mismatch costs you the furniture, not the
  building.

---

## Licence

MIT.
