# Commands

Two ways to talk to citizens: **speak to them** (they hear you), or **run a
command** (you configure them).

## Typing in chat

This is the main way in. Speak near citizens and they hear you; name one and
they act on it. It needs the **Beta APIs** world toggle, because reading chat is
only possible through Minecraft's beta script API.

## Slash commands — always available

Real slash commands with autocomplete. They need no cheats, and they work even
when chat does not — on the `--stable` build, or if Beta APIs is off.

| Command | Does |
|---|---|
| `/ai:spawn <count> <role>` | Spawn citizens where you stand |
| `/ai:tell <message>` | Say something to them — `/ai:tell @Ada go mine iron` |
| `/ai:cmd <command>` | Anything from the `!ai` list — `/ai:cmd found Rivermeet` |
| `/ai:panel` | Open the control panel |
| `/ai:doctor` | What works on this world, and what does not |

If custom commands are unavailable, `/scriptevent ai:cmd spawn 4` and
`/scriptevent ai:tell @Ada follow me` do the same thing.

---

## Speaking to them

| You type | What happens |
|---|---|
| `@Ada go mine some iron` | Ada takes the order and answers |
| `Ada, follow me` | Same — the `@` is optional when you use a comma |
| `everyone, stop` | Every citizen in earshot |
| `all of you, follow me` | Same |
| `anyone found iron?` | Overheard — sociable citizens answer |
| `what are you working on?` | They answer from what they are actually doing |

Earshot is 32 blocks by default (`!ai config chatRadius 48` to change it).

### Instructions they understand locally

Without the Claude bridge, these phrasings are parsed directly:

`follow me` · `come here` · `stop` / `wait here` · `chop wood` · `mine iron`
(or coal, diamond, gold, copper, redstone, lapis, emerald) · `farm` /
`plant` / `harvest` · `build a house` (cottage, storehouse, workshop, well,
farm, tower, wall, road, lamp, town hall, shrine) · `guard` / `patrol` ·
`attack` · `explore` / `scout` · `rest` · `store your goods`

With the bridge running, anything reasonable works, and they answer in
character rather than from a template.

---

## `!ai` commands

### People

| Command | Effect |
|---|---|
| `!ai spawn [n] [job]` | Spawn citizens where you stand. `!ai spawn 6 miner` |
| `!ai list` | Everyone alive, their trade, distance and current job |
| `!ai who [name]` | One citizen in detail — character, needs, inventory |
| `!ai come` / `!ai here` | Everyone within 64 blocks walks to you |
| `!ai follow <name>` | That citizen follows you until told otherwise |
| `!ai stop [name\|all]` | Cancel standing orders |
| `!ai job <name> <role>` | Assign a trade and lock it against re-allocation |
| `!ai tp <name>` | Teleport a citizen to you |
| `!ai say <name> <text>` | Put words in their mouth |
| `!ai remove <name\|all>` | Despawn |

Roles: `settler` `lumberjack` `miner` `builder` `farmer` `guard` `crafter`
`hauler` `scout` `architect`

### Settlement

| Command | Effect |
|---|---|
| `!ai found [name]` | Found a settlement where you stand |
| `!ai town` | Report: tier, population, stats, what is being built, shortages |
| `!ai build <structure>` | Queue a specific building nearby |
| `!ai structures` | Everything they know how to build, with material costs |

Structures: `campfire` `small_house` `storehouse` `workshop` `well`
`farm_plot` `watchtower` `town_hall` `wall_segment` `lamp_post`
`road_segment` `shrine`

### Brain

| Command | Effect |
|---|---|
| `!ai brain [auto\|claude\|local]` | Choose the thinking engine |
| `!ai bridge <url>` | Point at the Claude bridge |
| `!ai status` | Brain health, call counts, errors, population |

`auto` uses Claude when the bridge is reachable and the local brain otherwise.
`local` never calls out. `claude` is the same as `auto` — the local brain is
always the fallback, by design.

### Settings

| Command | Effect |
|---|---|
| `!ai config` | List every setting |
| `!ai config <key>` | Read one |
| `!ai config <key> <value>` | Change one (persists with the world) |
| `!ai debug` | Toggle verbose logging |
| `!ai doctor` | What this world supports; whether the entity can spawn |
| `!ai panel` | Open the control panel |
| `!ai help` | Everything above, in game |

Settings worth knowing:

| Key | Default | Meaning |
|---|---|---|
| `maxCitizens` | 40 | Population cap |
| `chatRadius` | 32 | How far your voice carries |
| `captionSeconds` | 6 | How long speech stays up |
| `typewriter` | true | Reveal speech a character at a time |
| `captionsToChat` | false | Also print speech in chat |
| `showNamesAlways` | true | Name tags when they are not speaking |
| `autoGrow` | true | Towns attract newcomers on their own |
| `settlementRadius` | 48 | How much ground a settlement claims |
| `conversationChance` | 0.06 | How often idle citizens strike up a chat |
| `friendlyFire` | false | Whether citizens can hurt each other |
| `allowTeleportUnstick` | true | Last-resort nudge for a wedged citizen |
| `debug` | false | Verbose logging |

---

## The control panel

`!ai panel`, or sneak-right-click a citizen.

- **Roster** — everyone, with distance and current job. Pick one for follow,
  come here, stand by, change role, bring to me, dismiss.
- **Settlement** — full report, plan the next building, order a specific one,
  re-assign every job, recruit nearby citizens.
- **Spawn citizens** — count, role, and whether to recruit them.
- **Brain & bridge** — engine, bridge URL, shared token, think interval.
- **Settings** — captions, names, population cap, chat range, auto-growth.
