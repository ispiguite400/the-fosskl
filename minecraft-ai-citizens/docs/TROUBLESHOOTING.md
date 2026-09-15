# Troubleshooting

## "This add-on is already installed" / duplicate

Minecraft identifies a pack by its UUID, and **only replaces an installed copy
when the incoming version is higher**. An equal or lower version is ignored as a
duplicate — silently, so reinstalling appears to work while you carry on running
the old code.

That makes "I reinstalled it" and "the new code is running" two different
things. To tell them apart:

```
/ai:doctor
```

The first line is the pack version. If it is not the version you just
installed, the old copy is still live.

Every build bumps the version automatically (`VERSION` in the repo root), so a
fresh build always supersedes the last. If Minecraft still refuses:

1. Remove the installed copy first — **Settings → Storage → Behaviour Packs**
   (and **Resource Packs**), or delete the `AI_Citizens_BP` / `AI_Citizens_RP`
   folders from your `behavior_packs` and `resource_packs` directories.
2. Import the `.mcaddon` again.
3. Re-activate both packs on the world and check `/ai:doctor`.

---

## It will not import

Minecraft refuses the file outright — no pack appears in the list.

```bash
node tools/check-import.mjs dist/AI_Citizens.mcaddon
```

The manifest is parsed before anything else, so a single value that release does
not understand rejects the whole package. Two have caused this here:

- **A dependency version that is not SemVer.** `"version": "beta"` is only
  understood by 1.21.120+; on anything older the manifest fails to parse. Use
  `"2.0.0"`, which resolves forward to any 2.x.
- **`min_engine_version` above the player's game.** Declaring 1.21.120 makes
  every earlier release refuse the import.

Both are now checked at build time. Rebuild with `./tools/build.sh` and the
default configuration asks for nothing version-specific.

---

## Start here

```
/ai:doctor
```

It reports, line by line, whether the script module loaded, which commands
registered, whether chat listening is available, whether interaction and entity
events are hooked, and — the important one — whether `ai:citizen` can actually
be spawned. Almost every "nothing happens" has a specific answer in that list.

If `/ai:doctor` itself does not exist, try `/scriptevent ai:cmd doctor`. If that
does nothing either, the behaviour pack is not active or the script module never
loaded; check Settings → Creator → Content Log.

---

## Citizens do not spawn at all

This is the one that bit the first release, twice over, so it is worth knowing
the shapes it takes.

**The command does nothing and there is no message.** The script module failed
to boot. Historically this was caused by subscribing to `world.beforeEvents
.chatSend`, which is a pre-release API that does not exist on a pack built
against the stable Script API — the subscribe threw and took everything with it.
Boot is now isolated step by step, so a missing API costs only the feature that
needs it. If you are on an old build, update.

**The command reports success but nobody appears.** The entity definition failed
to load, so `ai:citizen` does not exist. Bedrock rejects the whole definition
over a single invalid component — for example `minecraft:equippable` with a slot
that has no `item`. `/ai:doctor` tries to spawn one and tells you.

**The pack is greyed out in the world settings.** Your game is older than the
pack's `min_engine_version` (1.21.80). Update Minecraft.

**The pack is there but citizens do nothing, and `/ai:doctor` does not exist.**
The script module did not load. Either Beta APIs is off (the add-on needs it for
chat), or your Minecraft predates 1.21.120. Turn the toggle on, or build
`./tools/build.sh --stable` which needs neither.

**It worked, then a Minecraft update broke it.** That is the signature of a
pinned beta module version — `-beta` versions do not auto-upgrade, so a pinned
one stops resolving on the next release. This add-on uses the dynamic `"beta"`
string precisely to avoid that; if you see it, check that
`packs/AI_Citizens_BP/manifest.json` still says `"version": "beta"` and re-run
`./tools/build.sh`.

---

## Nothing happens at all

**Typing in chat does nothing, but `/ai:cmd` works.** Chat listening is off:
either Beta APIs is not enabled on this world, or you are running the
`--stable` build. `/ai:doctor` says which. The slash commands do everything chat
does in the meantime.

**Neither works.** The behaviour pack is not active, or the script module failed
to load. Check the world's behaviour pack list, then the content log (Settings →
Creator → Content Log). A script error appears there, naming the module.

**Citizens spawn but have no faces, or are invisible.** The resource pack is not
active. It should come in with the behaviour pack, but check both lists.

---

## They stand still

Some standing still is normal — citizens wait, rest and think.

**All of them, all the time.** Run `!ai status`. If it reports zero citizens, the
registry did not pick them up; re-enter the world. If it reports the right
number, run `!ai debug` and watch the content log.

**One of them, in one spot.** They are probably wedged. The stall watchdog gives
up on a task after 45 seconds of no progress, and `allowTeleportUnstick` (on by
default) nudges a truly wedged citizen free. `!ai tp <name>` moves them by hand.

**They will not path somewhere.** Minecraft's own pathfinder is doing the
walking, with everything that implies: they will not jump a two-block gap, climb
a wall, or swim a long way. They bridge small gaps and tunnel through soft blocks
if `allowBridging` and `allowTunnelling` are on.

---

## They will not build

**`!ai town` shows a shortage.** They are waiting on materials and will go and
get them. Give it time, or hand them what they need — they pick up dropped items.

**Nothing gets queued.** Either the settlement has everything it needs for its
tier, or no flat ground could be found. `!ai build small_house` on flatter ground
tells you which.

**A building stops half-finished.** The site was probably not as flat as it
looked, or something is in the way. `!ai town` shows the percentage.

**Beds and doors do not appear.** Block ids for those changed between Bedrock
versions. Both are marked optional in the blueprints, so a mismatch costs you the
furniture, not the building.

---

## They will not talk

**They stand in a T-pose or never animate.** The resource pack is active but its
entity definition was rejected. That happens if the client entity declares a
`min_engine_version` newer than your game (it no longer does), or if an
animation references a bone the model lacks or a Molang query that does not
exist. `node tools/validate.mjs` checks all three.

**No captions.** `!ai config showNamesAlways true` first — if the name tag is not
showing, captions cannot either. Then check you are within 28 blocks
(`captionRange`).

**They speak but say the same things.** That is the local brain. It varies lines
by personality, mood and what they can see, but it is a line bank. The Claude
bridge is the fix — see [CLAUDE_SETUP.md](CLAUDE_SETUP.md).

**They never answer me.** Check the range (`!ai config chatRadius 48`) and that
you are in the same dimension. Addressing someone by name always gets an answer;
ambient chat only gets one from sociable citizens.

**I want it in chat too.** `!ai config captionsToChat true`.

---

## The Claude bridge

**`!ai status` says "this build has no network transport".** The add-on was built
offline. Rebuild with `./tools/build.sh --claude`. On a phone, console, Realm or
single-player this is the only possible answer — Bedrock does not allow scripts
to make network requests there at all.

**"bridge failing".** In order:

1. Is it running? `curl http://127.0.0.1:8787/health`
2. Right URL? `!ai bridge` with no argument prints the current one.
3. Server permission granted? `@minecraft/server-net` must be in the server's
   `permissions.json` — see [CLAUDE_SETUP.md](CLAUDE_SETUP.md).
4. Token mismatch? If `AI_CITIZENS_TOKEN` is set, `!ai config bridgeToken` must
   match.

`!ai status` shows the last error verbatim.

**It works but replies are slow.** `EFFORT_CHAT=low` in `.env` trades some
quality for latency. Raising `claudeMinIntervalTicks` reduces the routine load so
chat requests get through faster.

**Cache hit rate is zero on `/stats`.** Something volatile has got into the
cached prefix. The system prompt and capabilities block must not contain the
time, a citizen name, or anything else that changes per request.

---

## Performance

A town of forty citizens is the tested ceiling; the default cap is 40.

If the server is struggling:

```
!ai config maxCitizens 20
!ai config thinkIntervalTicks 60      # think less often
!ai config blockScanRadius 8          # see less far
!ai config fastTickInterval 6         # step tasks less often
```

The expensive parts are perception (a coarse block survey per citizen per think)
and block searching (budgeted to 1,400 reads per call, coarsening past six
blocks). Both are spread across ticks.

---

## Getting information out

| | |
|---|---|
| `!ai status` | Brain, bridge, population, tick |
| `!ai list` | Everyone and what they are doing |
| `!ai who <name>` | One citizen: character, needs, inventory, task |
| `!ai town` | Settlement stats, queue, shortages, history |
| `!ai debug` | Verbose logging to the content log |

For development, `node tools/simulate.mjs 8000 --verbose` runs a town outside the
game and dumps per-citizen state, and `node tools/validate.mjs` catches pack
mistakes that would otherwise show up as a silent failure in game.
