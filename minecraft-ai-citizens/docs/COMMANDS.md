# Commands

Say **`ai!`** and then whatever you want. That is the entire grammar.

```
ai! spawn 4                    runs a command
ai! go mine some iron          tells everyone nearby
ai! @Ada follow me             tells one of them
ai! what are you working on?   asks a question
```

You never have to decide which kind of thing you are typing. The first word
after `ai!` settles it: if it names a command it runs one, otherwise the
citizens take it as something you said to them.

`!ai`, `hey ai` and `ai,` are accepted too, and `ai! config chatPrefix hey`
changes it to whatever you like. A word that merely *starts* with "ai" — "aim
for the ridge" — is left alone.

Commands are hidden from chat; instructions stay visible, because you are
talking.

## Where `ai!` works

Reading chat needs a pre-release Minecraft API, so it is only in a chat-enabled
build. On the default build, put `/ai:tell` in front of the same sentence:

| chat build | default build |
|---|---|
| `ai! go mine some iron` | `/ai:tell go mine some iron` |
| `ai! spawn 4` | `/ai:spawn 4` or `/ai:cmd spawn 4` |
| `ai! @Ada follow me` | `/ai:tell @Ada follow me` |

`/ai:doctor` tells you which you have.

## Slash commands — always available

Real slash commands with autocomplete, no cheats needed, and they work
regardless of chat.

| Command | Does |
|---|---|
| `/ai:tell <anything>` | The same grammar as `ai!` |
| `/ai:cmd <anything>` | Identical — both go through one router |
| `/ai:spawn <count> <role>` | The common case, with autocomplete |
| `/ai:panel` | Open the control panel |
| `/ai:doctor` | What works on this world, and what does not |

`/scriptevent ai:cmd spawn 4` works even where custom commands do not.

## Without the attention word

Citizens still overhear ordinary chat within 32 blocks:

| You type | What happens |
|---|---|
| `@Ada go mine some iron` | Ada takes the order |
| `Ada, follow me` | Same — the `@` is optional with a comma |
| `everyone, stop` | Every citizen in earshot |
| `anyone found iron?` | Overheard — sociable citizens answer |

### Instructions they understand without Claude

`follow me` · `come here` · `stop` · `chop wood` · `mine iron` (or coal,
diamond, gold, copper, redstone, lapis, emerald) · `farm` / `plant` / `harvest`
· `build a house` (cottage, storehouse, workshop, well, farm, tower, wall, road,
lamp, town hall, shrine) · `guard` / `patrol` · `attack` · `explore` · `rest` ·
`store your goods`

With the Claude bridge running, anything reasonable works, and they answer in
character rather than from a template.

---

## Command reference

Use any of these after `ai!`, or after `/ai:cmd`.

### People

| Command | Effect |
|---|---|
| `spawn [n] [job]` | Spawn citizens where you stand. `ai! spawn 6 miner` |
| `list` | Everyone alive, their trade, distance and current job |
| `who [name]` | One citizen in detail — character, needs, inventory |
| `come` / `here` | Everyone within 64 blocks walks to you |
| `follow <name>` | That citizen follows you until told otherwise |
| `stop [name\|all]` | Cancel standing orders |
| `job <name> <role>` | Assign a trade and lock it against re-allocation |
| `tp <name>` | Teleport a citizen to you |
| `say <name> <text>` | Put words in their mouth |
| `remove <name\|all>` | Despawn |

Roles: `settler` `lumberjack` `miner` `builder` `farmer` `guard` `crafter`
`hauler` `scout` `architect`

### Settlement

| Command | Effect |
|---|---|
| `found [name]` | Found a settlement where you stand |
| `town` | Report: tier, population, stats, what is being built, shortages |
| `build <structure>` | Queue a specific building nearby |
| `structures` | Everything they know how to build, with material costs |

Structures: `campfire` `small_house` `storehouse` `workshop` `well`
`farm_plot` `watchtower` `town_hall` `wall_segment` `lamp_post`
`road_segment` `shrine`

### Brain

| Command | Effect |
|---|---|
| `brain [auto\|claude\|local]` | Choose the thinking engine |
| `bridge <url>` | Point at the Claude bridge |
| `status` | Brain health, call counts, errors, population |

`auto` uses Claude when the bridge is reachable and the local brain otherwise.
`local` never calls out. `claude` is the same as `auto` — the local brain is
always the fallback, by design.

### Settings

| Command | Effect |
|---|---|
| `config` | List every setting |
| `config <key>` | Read one |
| `config <key> <value>` | Change one (persists with the world) |
| `debug` | Toggle verbose logging |
| `doctor` | What this world supports; whether the entity can spawn |
| `panel` | Open the control panel |
| `help` | Everything above, in game |

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

`ai! panel` (or `/ai:panel`), or sneak-right-click a citizen.

- **Roster** — everyone, with distance and current job. Pick one for follow,
  come here, stand by, change role, bring to me, dismiss.
- **Settlement** — full report, plan the next building, order a specific one,
  re-assign every job, recruit nearby citizens.
- **Spawn citizens** — count, role, and whether to recruit them.
- **Brain & bridge** — engine, bridge URL, shared token, think interval.
- **Settings** — captions, names, population cap, chat range, auto-growth.
