# Offline test harness

Minecraft will not run in CI, so `stubs/` implements enough of
`@minecraft/server` to actually execute the behaviour pack's scripts:
a fake world, dimensions, blocks, entities, players, the event buses and a
tick pump.

`run.mjs` boots `scripts/main.js`, fires every event the add-on subscribes to,
pumps ~3600 ticks across three situations (calm overworld, 90% corruption,
inside the Backrooms), then asserts that the systems produced real effects --
not merely that nothing threw.

    ./tools/harness/run.sh

`safe()` swallows exceptions in-game on purpose; the harness captures the
`console.warn` it logs so nothing stays hidden.
