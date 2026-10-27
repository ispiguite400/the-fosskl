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

To get the whole game as **one HTML file** that opens straight from your files with no server
(about 59 MB, since it carries every model and picture), run `node tools/bundle.mjs` from this folder.
It needs esbuild (`npm i -g esbuild`) and writes `dist/forlorn.html`. Inside, the models and lists
are gzipped and stored as dense ASCII text (6 bytes in 7 characters), and the page unpacks the exact
same bytes when the game asks for them (with the browser's DecompressionStream, or the vendored
fflate where that is missing), so it plays the same as the served game in less space.

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

Menus work with the D-pad or stick (✕ to choose, ○ to go back, L1/R1 to switch tabs). The
DualSense rumbles on hits and stuns.

The game always shows the button to press on whatever you used last, and switches the moment you
pick up something else: a keycap or the mouse on a computer; the PlayStation shapes in their
colours, Xbox letters (A B X Y, LB RB LT RT) or Switch letters, depending on the controller's
name; or the touch button's own label or picture on a phone. That is the badge on top of each
ability, the interact prompt, each ability on the Characters screen, and the button list in How to
play and Settings (`src/ui/glyph.js`).

### Split screen

Two players on one screen, each on a controller. In the camp, a second controller presses ✕ (A on
Xbox) to join; or pick **Add player 2** in the camp menu to keep player one on keyboard and mouse
and give the controller to player two. The screen splits side by side. Each player has their own
camera, HUD, button glyphs, name tags, wire puzzle, rumble and screen mood (fear, death, blind),
and sees through walls only what their own side would. Both play every round from then on, on the
same team or one of them as the killer. Player two picks a survivor with L1 / R1 and a killer
with L2 / R2 from the characters you own, and holds ○ (B) to leave. Either player's OPTIONS
pauses, and both can drive the pause menu. Player two's earnings go into the same bank.

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
- **Eight maps**, each with its own look, ambient score and mid-round event: Guest Village
  (airstrike), Guest Prison (lockdown), Robloxian High (fire drill), The Great War (artillery),
  Bloxville General (blackout), Camp Bloxwood (fog), Limbo (astral storm) and **Bacon City**
  (curfew).
- **Bacon City**, from *The Bacon Hair*: the walled city where the Guest Republic keeps the Bacon
  Hairs in the slums. The Wall and its watch towers all round, the Gate to the south, the tin-shack
  slums, the tenements, Zayden's block and his dad's garage, the power plant, Republic Square with
  its obelisk and the Ministry, the school and the shops, under rain and propaganda screens. At
  the halfway mark the **curfew** starts: the Wall's searchlights sweep the streets, and anyone
  they catch out in the open is reported to the killer. A roof over your head keeps you hidden.
- **Generators** are solved with a wire puzzle. A wrong wire sparks, and the killer hears it.
- **Last Man Standing**: a VS card, and a song chosen for the matchup (the films' own pairings get
  their own songs). The round lasts exactly as long as the song.
- **Shop and progression**: money and XP every round, levels. The shop has Survivors, Killers,
  Skins and **Killer Chance**: as in Forsaken, you can buy malice (+15 or +30) to move up the
  line, and the lobby tells you where you stand ("You are the next killer"). Buying a character
  equips it; click one you own to equip it.

### What FORLORN adds to the formula

- **Bond**: survivors who stick together for a while bond. Bonded survivors repair faster and see
  each other through walls. If one dies, the other gets a burst of grief speed.
- **Echoes**: dead survivors linger as echoes, and once a round each can reveal the killer to the
  living.
- **Bloodlust**: the killer's meter fills on hits and chases. When it's full it boils over into a
  Frenzy: faster, harder, red-sighted.
- **Map events** from each film, mid-round.

### The interface

Built like an asymmetrical horror game's: worn black plates with slanted edges, blood red for the
killer and cold cyan for survivors, type that looks stamped and scuffed, film grain over the menus.
In a round: generators left, the clock and survivors alive across the top; every survivor down the
left with their health and what they're doing (chased, repairing, dead, gone), and the killer
under them; a heart that beats faster as the killer gets closer, with red creeping in at the edges;
abilities drawn as white line icons with sweeping cooldowns, and outlined text the way Roblox games
draw it. Map cards are photographs of the maps (`tools/mapcards.mjs`).

Settings → Survivor UI follows Forsaken's own options: the survivor list on or off; its layout
(Side, Stacked or Icons); teammates' health as Health or Percentage; and a stamina counter. The
stamina bar goes green, then yellow past half, then a washed-out grey-yellow when it runs dry.

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
node forlorn/tools/mapcards.mjs                   # map photographs for the vote and loading screens (same)
```

The maps themselves (buildings, walls, props) are built from parts in code, as the Advance Forge
rules say scenery should be; only characters get sculpted models.

`forge/STYLE.md` holds the style rules for the cast. `forge/<id>/` holds each character's build
script, joints and renders; `forge/lib/` holds the body kit, clothing, faces, accessories and the
R6 animation clips.

### Animation

The characters stay R6 (six rigid parts), but move like the ones in Forsaken rather than stock
R6 swinging (`forge/lib/clips_r6.js`, baked into every model by `ship.mjs`):

- **Weight**: the hips ride as low as the rigid legs allow, so feet stay planted and the body dips
  and rises through every step; a foot stays down longer than it swings; arms lag the legs; the
  torso twists over the feet and shifts onto the standing leg; a run leaves the ground between
  strides.
- **Timing**: strikes anticipate, hit in a few frames and follow through; reactions snap in and
  ease out; idles breathe, shift weight and look around in holds rather than a sweeping sine.
- **Character**: each character has a movement style (`"anim"` in its `spec.json`). Survivors are
  *soldier* (Guest 1337, the Captain), *casual* (Matt, Justin, Jez, Daisy, Rose), *nervous* (Emily,
  Charlie: hunched, arms held in) or *posh* (Rich Guy: hands behind the back, checks his watch).
  Killers each have their own: The Terrible's dead-armed float and trailing-arm sprint, the Bacon
  General's march and pistol whip, the Colonel's heavy stomp and rifle-butt jab, the Elite Guard's
  sword stance and flat cut, Blox Watch's stillness, head snaps and shock.
- **States**: hurt survivors limp and clutch their side, jumps have a take-off, fall and landing,
  a stun is a dizzy sway, death staggers, buckles and falls flat.

In the game (`src/render/characters.js`) clips cross-fade with weights that always add up to one;
walk and run keep their step when they change; attacks, throws and casts play on the upper body
while the legs keep running; and the body leans into turns at speed.

## Layout

```text
index.html, css/          the page and the UI's look (fonts are served locally from assets/fonts)
src/main.js               boot and the state machine (title, lobby, round, results)
src/core/                 input (keyboard, mouse, DualSense, touch; player two's controller), save, events, helpers
src/render/               renderer and post effects, materials, sky, characters (forge-loader)
src/world/                parts, collision, navigation, prefabs, the maps
src/game/                 actors, abilities, effects, match, bots' brains, player, lobby, server
src/ui/                   HUD, menus, chat, puzzle, touch controls, world labels
src/audio/                the synth, sound effects and the score
src/data/                 the cast, bots' personalities and lines, the map list
forge/                    the Advance Forge build scripts for every character
tools/                    mapcards.mjs: photographs each map for the menus
assets/                   shipped models, portrait renders, map cards, fonts, music manifest
```
