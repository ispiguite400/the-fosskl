# Quickstart

Five minutes from nothing to a town.

## 1. Build the add-on

```bash
./tools/build.sh
```

That writes **`dist/AI_Citizens.mcaddon`** — one file with everything in it.

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
Load the world. No experiments needed.

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
- **"Already installed" / duplicate** → Minecraft only replaces a pack when the
  incoming version is higher, and ignores it otherwise. Run `/ai:doctor`: the
  first line is the pack version actually running. If it is not the one you just
  installed, delete the old pack in Settings → Storage and import again.
- **It will not import at all** → run `node tools/check-import.mjs` on the file.
  It checks the manifest the way Minecraft parses it and names the offending
  value. The usual cause is a version string that release does not understand.
- **The pack is greyed out** → your Minecraft is older than 1.21.80.
- **They stand still** → `/ai:cmd status` and `/ai:cmd debug`.

More: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
