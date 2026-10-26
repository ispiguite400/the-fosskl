# FORLORN

An asymmetrical survival game in the browser: one killer against up to seven survivors, played as
the cast of **ObliviousHD's Roblox films** (*The Last Guest*, *Guest 666*, *Blox Watch*), looking
the way they do in the movies. The gameplay is inspired by **Forsaken**: survive until the timer
runs out, repair generators to shorten the night, and when you're the last one left, survive the
Last Man Standing song.

It's a fan game. The characters belong to ObliviousHD.

---

## Running it

There's no build step. Serve this folder over HTTP (ES modules won't load from `file://`):

```bash
cd forlorn
python3 -m http.server 8000      # or: npx http-server -p 8000 .
```

Then open <http://localhost:8000>. It works on GitHub Pages as-is.

Plays in any current browser with WebGL 2: desktop, phones and tablets. On weaker machines, lower
**Graphics** and **Resolution scale** in Settings. Phones start on Low.

## Controls

| | Keyboard and mouse | PS5 DualSense | Touch |
|---|---|---|---|
| Move | WASD | Left stick | Left thumb (stick appears where you touch) |
| Look | Mouse (click to lock) | Right stick | Drag on the right half |
| Sprint | Shift | L3 or L1 | RUN, or push the stick far |
| Jump | Space | ✕ | JUMP |
| Interact / repair | E | □ | USE |
| Abilities | Q, R (killer: F as well) | R1, L2 (killer: △) | Ability buttons |
| Use item (survivor) | F | △ | ITEM |
| Killer attack | Left click | R2 | HIT |
| Emote | G | D-pad right | EMOTE |
| Chat | / or Enter | CREATE (quick lines) | 💬 |
| Scoreboard | Tab | Touchpad | (pause menu) |
| Menu | Esc | OPTIONS | ☰ |

Menus work with the D-pad or stick (✕ to choose, ○ to go back, L1/R1 to switch tabs). The game
shows the right button glyphs for whatever you touched last, and the DualSense rumbles on hits
and stuns.

## The game

- **A server full of bots.** Up to seven other players share the server. Each one is a person:
  their own username, skill, playstyle and typing style. Some are heroes who come back for you,
  medics, gen rushers and loopers. Others are newbies, hiders, looters, trolls who taunt the killer,
  AFKs and cowards who lead it straight to you. They call out where the killer is, ask for help,
  heal you, hand you their medkit, body-block, stun the killer, chat back when you talk to them,
  rage-quit when they die, and come and go between rounds. When a bot is the killer, it has its own
  temperament too: hunters, tunnelers, generator guards, show-offs and the occasional friendly one.
- **The lobby.** Everyone waits around the camp fire during intermission. The highest **malice**
  is the next killer (you can opt out). The map vote opens near the end.
- **The cast.** 10 survivors and 5 killers from the films, each with a passive or basic attack
  and its own abilities, plus skins:
  - Survivors: Guest 1337, Matt, Daisy, Rose, Army Captain, Emily, Justin, Rich Guy, Charlie, Jez.
  - Killers: The Terrible (Guest 666), Bacon General (who calls in Bacon Soldiers), Bacon
    Colonel, Elite Guard, Blox Watch.
- **Seven maps**, each with its own look, ambient score and mid-round event: Guest Village
  (airstrike), Guest Prison (lockdown), Robloxian High (fire drill), The Great War (artillery),
  Bloxville General (blackout), Camp Bloxwood (fog) and Limbo (astral storm).
- **Generators** are solved with a wire puzzle. A wrong wire sparks, and the killer hears it.
- **Last Man Standing**: a VS card, and a song chosen for the matchup (the films' own pairings get
  their own songs). The round lasts exactly as long as the song.
- **Shop and progression**: money and XP every round, characters and skins to buy, levels.

### What FORLORN adds to the formula

- **Bond**: survivors who stick together for a while bond. Bonded survivors repair faster and see
  each other through walls. If one dies, the other gets a burst of grief speed.
- **Echoes**: dead survivors linger as echoes, and once a round each can reveal the killer to the
  living.
- **Bloodlust**: the killer's meter fills on hits and chases. When it's full it boils over into a
  Frenzy: faster, harder, red-sighted.
- **Map events** from each film, mid-round.

## Music, and Soundtrap

Every song is composed in code (`src/audio/music.js`): the camp, each map's ambience, a layered
chase theme per killer that opens up as the killer gets closer, and the LMS songs.

To use your own **Soundtrap** songs, export them as MP3, put them in `assets/music/`, and name
them in `assets/music/manifest.json` by track id:

```json
{ "lms_terrible": "final_detention.mp3", "lobby": "my_lobby_theme.mp3" }
```

A listed recording replaces the built-in track with that id, and an LMS lasts as long as its
recording. The track ids are listed in the manifest file.

## The models: Advance Forge

Every character is sculpted with the Advance Forge plugin (`../tools/advance-forge/`), in a
T-pose, as an R6 rig wearing the films' Robloxian 2.0 package shapes. Clothing is drawn as a
texture the way Roblox shirts and pants are, faces are decals, and only accessories are 3D.
Every model is exported with the plugin's `ship.mjs` at 2,000–5,000 triangles, with the sculpt
baked into its texture, rigged and animated.

```bash
node forlorn/forge/make.mjs matt                  # build, render the sheets
node forlorn/forge/make.mjs matt --ship           # ship to assets/models/matt.glb
node forlorn/forge/make.mjs matt --skin war --ship
node forlorn/forge/renders.mjs                    # menu portraits (with the game served on :8765)
```

`forge/STYLE.md` holds the style rules for the cast. `forge/<id>/` holds each character's build
script, joints and renders; `forge/lib/` holds the body kit, clothing, faces, accessories and the
R6 animation clips.

## Layout

```text
index.html, css/          the page and the UI's look
src/main.js               boot and the state machine (title, lobby, round, results)
src/core/                 input (keyboard, mouse, DualSense, touch), save, events, helpers
src/render/               renderer and post effects, materials, sky, characters (forge-loader)
src/world/                parts, collision, navigation, prefabs, the maps
src/game/                 actors, abilities, effects, match, bots' brains, player, lobby, server
src/ui/                   HUD, menus, chat, puzzle, touch controls, world labels
src/audio/                the synth, sound effects and the score
src/data/                 the cast, bots' personalities and lines, the map list
forge/                    the Advance Forge build scripts for every character
assets/                   shipped models, portrait renders, music manifest
```
