# 追放者たち — The Forsaken One

A first-person, open-world action game set in a fantasy medieval Japan, built
in **Three.js** and plain ES modules. Ten worlds, a full combat system built
around guarding and the Wind Dash, an inventory, ten playable classes, tameable
mounts, a day/night cycle with weather, local split-screen for two players, and
a story that runs from a burning village to a god above the clouds.

Everything is generated at runtime — terrain, models, music, menu artwork. The
only dependency is a vendored copy of Three.js.

---

## Running it

No build step. Serve the folder over HTTP (ES modules will not load from
`file://`):

```bash
npx http-server -p 8080 .
# or
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

It also works as-is on GitHub Pages — push the branch and enable Pages on it.

**Requirements:** any current desktop browser with WebGL2. A discrete GPU
helps; if the frame rate dips, drop **Render Scale** and **Quality** in
Settings.

---

## Controls

| Action | Keyboard / Mouse | DualSense (PS5) |
|---|---|---|
| Move | `W A S D` | Left stick |
| Look | Mouse | Right stick |
| Sprint | `Shift` | L3 |
| Crouch | `Ctrl` / `C` | ○ |
| Jump | `Space` | ✕ |
| **Wind Dash** | Hold `Space` in the air, release | Hold ✕ in the air, release |
| Attack | Left mouse | R2 |
| Guard | Hold right mouse | Hold L2 |
| Interact / talk / open | `E` | □ |
| Use item | `F` | △ |
| Weapon slots | `1` `2` `3` `4` / scroll | R1 / L1 |
| Inventory | `Tab` or `I` | Touchpad |
| Drop held item | `G` | — |
| Pause | `Esc` | Options |
| Mute | `M` | — |

A DualSense works over USB or Bluetooth with no setup — it reports as a
standard gamepad, and rumble is driven through the haptics actuator. Plug in a
second pad for split-screen; player two is always pad 2.

---

## The combat loop

This is the part everything else hangs off:

1. **Swinging costs power** (the orange bar). Power regenerates on its own,
   faster when you are not attacking. If it empties, you start paying in
   health instead.
2. **Enemies guard roughly four hits in ten.** Getting guarded drains a chunk
   of your power, knocks you back hard and **launches you into the air**.
3. **While airborne, hold jump.** Your fall slows and a Wind Dash charges.
4. **Release** and you fire off in whatever direction you are looking.
5. **Dash into an enemy** and you damage them and get launched again — so a
   good player chains dashes and never touches the ground.

Guarding yourself is unlocked when you find the Kontana in world one. Hold it;
it drains power while raised. Buy **Deflection** from the Sage and a guard
raised within a quarter-second of an incoming hit becomes a parry instead.

Hitting an enemy from behind deals bonus damage — triple as an Assassin.

---

## Progression

- **Ten worlds**, 3.6 km to 10.4 km across, streamed in 128 m chunks.
- **Ranks** E → D → C → B → A → S → SS → SSS, tied to level. Rank carries
  across worlds and gates which abilities the Sage will teach you.
- **Level 45** opens the gate out of world two; later worlds raise the bar.
- **Every world unlocks a class.** Ten in total: Knight, Samurai, Assassin,
  Guard, Warrior, Fighter, Sensei, Wizard, Emperor, King — each with its own
  stat spread, a perk that changes how you fight, and its own account of how
  it was forsaken.
- **Hubs** (worlds two onward) have a merchant, an ability vendor, a smith who
  will reshape your class for shekels, a broker who buys loot for coin and XP,
  a gatekeeper, and villagers with side quests.
- **Chests** are scattered across every world past the first. Some are locked;
  keys are deliberately placed 90–220 m away, never beside the lock. Loot is
  weighted: experience and shekels are common, weapons rare, the Draught of the
  Forsaken very rare.
- **Animals** can be tamed with rice bought at the hub, then ridden. Horses,
  elk, camels, direwolves, and mythic kirin and cloud stags in the late worlds.

---

## The worlds

| # | Name | Theme |
|---|---|---|
| 1 | Ashen Village · 灰の里 | A destroyed village mid-war. Tutorial, no hub. |
| 2 | Verdant Reach · 緑の果て | Grassland |
| 3 | Everdark Wood · 常闇の森 | Forest and bamboo |
| 4 | Sunless Waste · 陽無き荒野 | Desert |
| 5 | White Silence · 白い沈黙 | Snow |
| 6 | Amber Plain · 琥珀の原 | Savanna |
| 7 | Drowned Reach · 沈んだ領 | Ocean and islands |
| 8 | Marble Dominion · 大理石の領土 | Roman ruins and temples |
| 9 | The Iron Crown · 鉄の冠 | Mountains and a great kingdom |
| 10 | Heaven's Anvil · 天の金床 | Above the clouds. The Hollow God. |

Each has its own palette, weather bias, opening time of day, enemy roster,
boss, and ambient score. Every world runs a continuous day → sunset → night
cycle (eight minutes a full turn) with a star field at night and rain that
rolls in and greys the sky.

---

## Story

You wake face-down in the ash of a village that has already finished burning,
and get up in first person — the same animation plays every time you respawn,
in every world. World one teaches you to fight, gives you the Kontana, and ends
with the Purple Wizard, who takes you somewhere else halfway through the fight
rather than lose.

In world two a girl at the edge of the grass is looking for her parents. If you
take her in she follows you across four worlds. In world five the Frost
Sovereign kills her, and you get one last conversation. It rains afterwards.

The through-line is the Hollow God at the top of the tenth sky — the first
thing that was ever cast out, and the thing still doing the casting.

---

## Multiplayer

From the main menu:

- **Versus** — a duel in a closed arena on horizontal split screen, using the
  full combat system including guards, launches and the Wind Dash.
- **Co-op** — the whole campaign, worlds one through ten, two players on
  horizontal split screen. Progress saves to your file.

Player one uses keyboard and mouse or pad 1; player two uses pad 2.

---

## Saving

Everything persists to `localStorage` automatically: level, XP, rank, shekels,
class, unlocked classes and worlds, ability purchases, your full inventory and
hotbar layout, weapon colours, which chests you have opened in which world,
side-quest progress, story flags, and where you were standing. It autosaves
every ten seconds, on every meaningful event, and on tab close.

Settings live in a separate key so erasing a save does not reset your
sensitivity. **Settings → Erase Save Data** wipes progress; **New Game** on the
main menu does the same with a confirmation.

---

## The forge

**Edit** on the main menu opens the forge. An HSV colour wheel with separate
saturation and lightness controls lets you pick very nearly any colour for the
**blade/metal** and the **handle** independently, with presets and a live
rotating 3D preview. Your choice applies to every weapon you carry, in every
world, in the world model, the first-person view model and the inventory
icons.

---

## Project layout

```
index.html            importmap + UI layers
css/ui.css            every screen and the HUD
vendor/               Three.js (MIT, vendored so there is no CDN dependency)
src/
  main.js             boot, loading, state machine, forge preview
  core/
    util.js           math, seeded RNG, value noise / fbm / ridged noise
    input.js          keyboard, mouse and DualSense mapped onto named actions
    audio.js          procedural score and SFX (see below)
    save.js           versioned localStorage save with forward migration
  art/art.js          canvas-painted menu backdrops, class panels, item icons
  data/gamedata.js    classes, items, worlds, enemies, bosses, dialogue, loot
  ui/
    screens.js        loading, main menu, class select, forge, multiplayer, settings
    hud.js            HUD, mission tracker, boss bar, cinematics
    inventory.js      inventory model + the Minecraft-style window
    dialogue.js       conversation trees, shop, abilities, class change
  world/
    terrain.js        streaming chunked heightmap, LOD, instanced grass, water
    sky.js            shader sky dome, day/night, clouds, rain, thunder
    props.js          landmarks and streamed prop cells
  entities/
    models.js         every mesh in the game, built from primitives
    actors.js         enemies, bosses, NPCs, Hana, animals, chests, projectiles
  game/
    game.js           renderer, world lifecycle, entities, split screen
    player.js         first-person controller and combat
    vfx.js            pooled particles, damage numbers, slashes
    missions.js       mission chain, side quests, story beats and cutscenes
```

### Audio

There are no audio files. `core/audio.js` synthesises everything with WebAudio:
a generated convolution reverb, taiko (pitch-dropping sine plus a noise skin),
koto plucks via Karplus-Strong, a breathy shakuhachi lead with vibrato that
eases in, and low choir. Tracks are written as a `bar()` function over Japanese
modes (hirajoshi, in-sen, yo, kumoi) and scheduled two bars ahead on a
lookahead timer, so they never stutter. Menus, each world, hubs, bosses, the
final fight, the sorrow cue and the ending all have their own arrangement, and
the SFX bank is built from the same primitives.

Because browsers require a gesture before audio can start, the loading screen
holds at 100% until you press a key or a face button.

### Artwork

`art/art.js` paints the loading backdrop, the main-menu charge, the ten class
panels and every item icon into canvases at load time. To use your own images
instead, drop them in `assets/images/` and name them in
`assets/images/manifest.json`; anything you do not list keeps the generated
art. See the README in that folder.

---

## Known limits

- Fonts come from Google Fonts. Offline, the game falls back to system serifs;
  layout is unaffected.
- Models are procedural geometry with PBR materials, not authored/scanned
  assets. It is stylised realism, not photorealism — no engine that ships as
  readable source can be otherwise.
- Split-screen is local only; there is no netcode.
- Ten full worlds is a lot of grinding to see end to end. `GATE_LEVEL` in
  `src/game/missions.js` is one object if you want to retune the pacing.

---

Three.js is MIT licensed; see `vendor/THREE-LICENSE`.
