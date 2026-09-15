# Quickstart

Five minutes from nothing to a town.

## 1. Build the add-on

```bash
./tools/build.sh
```

That writes `dist/AI_Citizens.mcaddon`.

No Bash? Zip the two folders yourself: `packs/AI_Citizens_BP` and
`packs/AI_Citizens_RP`, each keeping its own folder name, into one archive
renamed to `AI_Citizens.mcaddon`.

## 2. Install it

Open `AI_Citizens.mcaddon`. Minecraft imports both packs.

## 3. Turn it on for a world

In the world's settings:

- **Behaviour Packs** → activate **AI Citizens — Behavior**
- **Resource Packs** → activate **AI Citizens — Resources**
  (the behaviour pack pulls this in, but check it took)
- **Experiments** → turn on **Beta APIs**

Load the world.

## 4. Spawn some people

```
!ai spawn 4
```

Four citizens appear, each with a name, a face and a trade. They will start
looking for work immediately.

## 5. Found a town

Stand somewhere with trees, stone and water nearby:

```
!ai found Rivermeet
```

Everyone within 48 blocks joins. Roles get divided up, and the settlement
starts planning what to build. Come back in a few Minecraft days.

## 6. Tell them what to do

```
@Ada go mine some iron
everyone, follow me
!ai build small_house
!ai town
```

Sneak-right-click a citizen to open their page. `!ai panel` opens the control
panel. `!ai help` lists everything.

---

## Optional: a Claude brain

Only works on a **Bedrock Dedicated Server** — Bedrock does not let scripts
make network requests anywhere else.

```bash
./tools/build.sh --claude
cd bridge && npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
```

In game:

```
!ai bridge http://127.0.0.1:8787
!ai brain claude
!ai status
```

Full setup, including the server permission step: [docs/CLAUDE_SETUP.md](docs/CLAUDE_SETUP.md).

Want to check the wiring without spending anything?

```bash
DRY_RUN=true npm start          # canned replies, no API calls
node test-bridge.mjs            # end-to-end check
```

---

## If something is wrong

- **Nothing spawns** → Beta APIs is probably off. Check the world's experiments.
- **They have no faces / are invisible** → the resource pack is not active.
- **Chat commands do nothing** → the behaviour pack is not active, or the script
  module failed to load. Check the content log.
- **They stand still** → `!ai status` and `!ai debug`.

More: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
