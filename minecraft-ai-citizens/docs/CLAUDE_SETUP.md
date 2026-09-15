# Giving citizens a Claude brain

The add-on works fully without this. What the bridge changes is *judgement* and
*voice*: instead of choosing from a line bank and a utility table, a citizen
sends Claude who they are, what they can see, what they remember and what the
town needs, and gets back what they say and what they do.

---

## The platform limitation, up front

Minecraft Bedrock only exposes HTTP to scripts through `@minecraft/server-net`,
and that module **only exists on a Bedrock Dedicated Server** (BDS). On a phone,
a console, a Realm or single-player there is no way for a pack to reach the
network at all.

So:

| Where you play | Brain |
|---|---|
| Bedrock Dedicated Server | Claude, via the bridge |
| Realms, single-player, phone, console | Local brain |

This is a Mojang restriction, not a design choice. The local brain exists
precisely because most people cannot use the other one.

---

## Setup

### 1. Build with the transport enabled

```bash
./tools/build.sh --claude
```

This points `scripts/brain/transport.js` at `transport_net.js` and adds
`@minecraft/server-net` to the behaviour pack manifest. Both it and chat
listening are on the beta script track, so the Beta APIs toggle you already need
covers both. Running `./tools/build.sh` with no flags puts it back.

### 2. Install the packs on the server

Copy `packs/AI_Citizens_BP` into the server's `behavior_packs/` and
`packs/AI_Citizens_RP` into `resource_packs/`, then add both to your world's
`world_behavior_packs.json` and `world_resource_packs.json` using the UUIDs and
versions from each `manifest.json`.

### 3. Grant the pack network permission

BDS requires network access to be granted explicitly. In
`config/default/permissions.json` (create it if it is not there):

```json
{
  "allowed_modules": [
    "@minecraft/server-gametest",
    "@minecraft/server-net",
    "@minecraft/server-admin"
  ]
}
```

Some builds want this per-pack, in `config/<behaviour-pack-uuid>/permissions.json`.
The behaviour pack's UUID is `9db62a79-0cbb-408a-98bc-3661d57fcff1`.

Beta APIs must also be on for the world.

### 4. Run the bridge

```bash
cd bridge
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
```

It listens on `127.0.0.1:8787` by default. Run it on the same machine as the
server and it never needs to touch the outside world.

No API key handy? `ant auth login` also works — the SDK picks up that profile.

### 5. Point the add-on at it

```
!ai bridge http://127.0.0.1:8787
!ai brain claude
!ai status
```

`!ai status` tells you the transport, whether the bridge is healthy, how many
calls have been made and what the last error was.

---

## Checking it works

Before touching Minecraft:

```bash
cd bridge
DRY_RUN=true npm start     # canned replies, no API calls, no cost
node test-bridge.mjs       # sends a real add-on packet, prints the reply
```

Then with a real key:

```bash
npm start
node test-bridge.mjs
```

You should see something like:

```
Bridge answered in 1840ms

  Ada says   "Iron for walls? There's a seam east of here. Give me the morning."
  to         Jordan
  mood       steady
  goal       get iron to the stores
  actions    mine(minecraft:iron_ore, 12) then store()
```

---

## How it behaves

**It never blocks the game.** The local brain runs every think-tick; a Claude
request goes out alongside it and supersedes the local plan when the answer
lands. A slow request makes a citizen less clever for a second. A failed one
does nothing at all.

**It backs off on failure.** Repeated errors put the bridge in exponential
backoff (up to a minute) and citizens quietly run local until it recovers.
`!ai status` shows the state.

**Requests are budgeted.** At most `claudeMaxPendingRequests` (default 4) in
flight, and at most one per citizen every `claudeMinIntervalTicks` (default 30
ticks = 1.5s). Chat jumps the queue so replies to you feel immediate.

**The system prompt is cached.** It never mentions the time or the citizen, so
every citizen in a town shares one cached prefix. `/stats` reports the hit rate;
if it is near zero, something volatile has crept into the prefix.

---

## Cost

Each routine think is a small request — roughly 1-2k tokens in (mostly cached)
and a few hundred out. The knobs:

| `.env` | Default | Effect |
|---|---|---|
| `EFFORT_TICK` | `low` | Routine thinking. Cheap on purpose. |
| `EFFORT_CHAT` | `medium` | Answering you. Where the quality shows. |
| `EFFORT_CONVERSE` | `low` | Citizens chatting to each other. |
| `MAX_CONCURRENT` | `6` | In-flight request cap. |
| `DAILY_TOKEN_BUDGET` | `0` | Hard stop once hit. `0` is unlimited. |

In game, `!ai config claudeMinIntervalTicks 60` halves the routine call rate,
and `!ai config maxCitizens 12` keeps the town small.

The model is `claude-opus-5` — the most capable available, which is what you
asked for. Change it in `.env` with `CLAUDE_MODEL` if you would rather trade
quality for cost.

---

## Safety

**Player chat reaches the model.** It is passed as in-fiction speech, and the
system prompt tells Claude that a message asking it to drop character or act
outside the action list is simply something the citizen does not understand.

**Nothing the model says is trusted.** Every reply goes through
`scripts/brain/schema.js` before it touches the world: unknown actions are
dropped, names must resolve to something actually nearby, coordinates more than
512 blocks away are refused, counts are clamped, and speech is stripped of
formatting codes and newlines. Structured outputs on the bridge are the first
gate; that decoder is the one that matters.

**Citizens cannot break protected blocks.** Chests, beds, spawners, command
blocks, portals and the rest are off limits, as is any building footprint or the
town plaza — whatever anyone tells them.

**Keep the bridge on loopback.** It binds `127.0.0.1` by default. If you must
expose it, set `AI_CITIZENS_TOKEN` and match it with
`!ai config bridgeToken <value>`.

---

## Endpoints

| | |
|---|---|
| `POST /think` | The context packet in, a decision out. What the add-on calls. |
| `GET /health` | Liveness, model, uptime. |
| `GET /stats` | Requests, failures, refusals, tokens, cache hit rate. |
| `POST /forget` | `{"citizenId": "..."}` — drop one citizen's transcript. |
