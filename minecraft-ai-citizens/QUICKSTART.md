# Quickstart

Five minutes from nothing to a town.

## 1. Build the add-on

```bash
./tools/build.sh --all
```

That writes two files to `dist/`:

- **`AI_Citizens.mcaddon`** — the safe one. Loads on any 1.21.80+ world.
- **`AI_Citizens_chat.mcaddon`** — same, plus you can talk to citizens by
  typing in chat. Needs **Beta APIs** turned on.

Start with the safe one. Once you see citizens walking around, swap to the chat
one if you want to talk to them by typing.

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
- **Experiments** → turn on **Beta APIs** *(only needed for the chat build)*

Load the world.

## 4. Spawn some people

```
/ai:spawn 4
```

Four citizens appear, each with a name, a face and a trade. They will start
looking for work immediately.

## 5. Found a town

Stand somewhere with trees, stone and water nearby:

```
/ai:cmd found Rivermeet
```

Everyone within 48 blocks joins. Roles get divided up, and the settlement
starts planning what to build. Come back in a few Minecraft days.

## 6. Tell them what to do

```
/ai:tell @Ada go mine some iron
/ai:tell everyone, follow me
/ai:cmd build small_house
/ai:cmd town
```

On the chat build you can drop the `/ai:tell` and just type `@Ada go mine some
iron` straight into chat.

Sneak-right-click a citizen to open their page. `/ai:panel` opens the control
panel. `/ai:cmd help` lists everything.

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

**Run `/ai:doctor` first.** It tells you exactly what this world supports and
whether the citizen entity can be spawned, which turns "nothing happens" into a
specific answer.

- **`/ai:doctor` does not exist** → the behaviour pack is not active, or the
  pack needs a newer game than you have. Check the pack is listed and not greyed
  out, then try `/scriptevent ai:cmd doctor`.
- **Citizens spawn but have no faces** → the resource pack is not active.
- **Typing in chat does nothing** → you are on the safe build. Use `/ai:tell`,
  or install `AI_Citizens_chat.mcaddon` with Beta APIs on.
- **They stand still** → `/ai:cmd status` and `/ai:cmd debug`.

More: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
