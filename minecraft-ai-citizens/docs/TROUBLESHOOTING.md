# Troubleshooting

## Nothing happens at all

**`!ai` commands do nothing.** The behaviour pack is not active, or the script
module failed to load. Check the world's behaviour pack list, then the content
log (Settings → Creator → Content Log). A script error appears there, naming the
module.

**`!ai spawn` says nothing and nobody appears.** Beta APIs is off. World
settings → Experiments → Beta APIs. Scripted add-ons cannot run without it.

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
