---
name: advance-forge
description: >-
  Advance Forge: build 3D models, characters, props, rigs and animations by driving the SculptFree
  sculpting app and the Rig Player from scripts, and put them into the game. USE THIS SKILL, and read
  its RULES.md in full first, whenever a task involves making, sculpting, modelling, texturing,
  painting, rigging, skinning, posing or animating anything 3D; a character, enemy, boss, NPC,
  creature, weapon, armour or hero prop; a .glb, .obj, .sculpt or skinned-mesh file; or deciding
  whether something in the game should get a custom model at all.
---

<img src="../../logo.png" alt="Advance Forge" width="96" align="right">

# Advance Forge

You have a sculpting studio, not just a text editor. This skill gives you:

| Tool | What it does | How |
|---|---|---|
| **SculptFree** (`app/sculpt.html`) | A full sculpting app: 21 brushes, dynamic topology, clay forms, booleans, remeshing, painting, rigging, and GLB/OBJ/STL/PLY export | `scripts/forge.mjs` drives it headless; `scripts/lib/sculptkit.js` and `clay.js` are the API |
| **Rig** (inside SculptFree) | A 21-bone humanoid skeleton, automatic skin weights, test poses, and skinned GLB export | `scripts/rig.mjs` |
| **Rig Player** (`app/player.html`) | Plays and bakes animations (Walk, Idle, Aim & scan, Take cover, plus your own clips) | `scripts/animate.mjs` |
| **ship** (`scripts/ship.mjs`) | **The only export for the game.** Welds, reduces to 2,000–5,000 triangles, bakes the full sculpt into a texture, rigs, bakes clips, and renders the result | `scripts/ship.mjs` |
| **forge-loader** (`game/forge-loader.js`) | Loads a forged character into the Three.js game with the game's own rig names and its clips | `import { loadForgeCharacter }` |

Everything renders to PNG, so **you can see what you made**. Use that on every step.

---

## Before you touch anything: the hard gate

These steps are not optional. Skipping them is how the first attempts at this went wrong: a
Mega Man made of plain balls, and a soldier that looked flat and lifeless. The user rejected both.

1. **Read [RULES.md](RULES.md) completely.** It's long on purpose. It holds the style rules, what
   deserves a custom model, the method, the budgets, and every mistake already made and fixed. Do
   not skim it and do not work from memory of it.
2. **Read [API.md](API.md)** before writing a build script.
3. **Open [templates/ronin.js](templates/ronin.js)** and its preview images. It's a complete,
   tested character built the right way. Copy its structure.
4. **Run the doctor** and make sure every line says `ok`:
   ```bash
   node <this skill>/scripts/forge.mjs doctor
   ```
5. **Decide whether the thing deserves a custom model at all** (RULES.md §2). Most things in a
   game don't. Characters do.

Two rules apply to everything (RULES.md, top):

- **Every character is sculpted in a T-pose.**
- **Every export goes through `scripts/ship.mjs`, at 2,000–5,000 triangles.**

If the user asks for 3D work and you have not done 1–4, stop and do them first. If you catch
yourself about to hand-place Three.js boxes for a character, stop: that's what this skill replaces.

---

## The loop: every model, every time

```text
plan → build (T-pose) → LOOK → fix → ... → rig check → LOOK → ship (2k–5k) → LOOK → game
```

1. **Plan** in writing, before any code (RULES.md §4): reference, silhouette, proportions, palette,
   what gets detail, the ship triangle count (2,000–5,000), and the T-pose.
2. **Build** with a script (start from `templates/ronin.js`):
   ```bash
   node scripts/forge.mjs build my_char.js --out out/my_char --name my_char \
        --close "0.4,0.05,1.6,0.16;0.5,0.08,1.2,0.4;0.6,0.1,0.35,0.4"
   ```
   This writes `NAME-sheet.png` (six views), `NAME-close*.png` (face, torso, legs),
   and `NAME.sculpt` (no model file: only `ship.mjs` makes one). It also prints every stroke that
   missed the surface.
3. **Look.** Open the sheet and every close-up with the Read tool. Go through the review checklist in
   RULES.md §12 honestly, and write down what's wrong. **Never say a model is done without having
   looked at it.**
4. **Fix and rebuild.** Expect 4–10 rounds on a character. The first build is a blockout, not a
   result.
5. **Rig** with the skeleton your build used:
   ```bash
   node scripts/rig.mjs out/my_char/my_char.sculpt --out out/my_char --joints my_char_joints.json
   ```
   This is a check, not the export. Look at `NAME_poses.png`: the T-pose, arms lowered, step, arms
   up and crouch. Anything stretching between a limb and the body means they were
   sculpted touching. Move the limb out in the build and rebuild; no weight setting fixes geometry
   that is fused.
6. **Ship.** This is the only way anything reaches the game:
   ```bash
   node scripts/ship.mjs out/my_char/my_char.sculpt --out out/my_char --joints my_char_joints.json \
        --tris 4000 [--clips my_clips.js]          # --static for a prop; --tris is always 2000-5000
   ```
   It welds the pieces into one skin, reduces to the triangle count, bakes the full sculpt's detail
   into a texture, rigs the mesh, bakes every clip, and renders the game file itself. Look at
   `NAME_game-sheet.png`, `NAME_game-face.png` and `NAME_game_anim_walk.png`: the model must still
   look like the sculpt, and the walk must plant flat feet with the arms down. For custom clips, and
   to check other clips, use `scripts/animate.mjs NAME_game.glb --out DIR --only idle,aim`.
7. **Put it in the game.** Copy `NAME_game.glb` into `assets/models/` and load it with
   `game/forge-loader.js` (RULES.md §11), which lowers the T-pose arms. Show the user the renders,
   and tell them honestly what's still weak.

---

## Files

```text
SKILL.md                 you are here
RULES.md                 the rule sheet: style, what to model, method, budgets, lessons, review checklist
API.md                   every function in sculptkit (M.*) and clay (M.clay.*), with the pitfalls
app/sculpt.html          SculptFree, the whole app in one file (with the Rig menu)
app/player.html          Rig Player
scripts/forge.mjs        doctor | build | render | export
scripts/rig.mjs          fit, bind, test-pose and export a skinned GLB
scripts/animate.mjs      render clip strips, add clips, bake them into the GLB
scripts/ship.mjs         THE export: weld, 2k-5k triangles, texture from the full sculpt, rig, clips
scripts/lib/             sculptkit.js, clay.js (run inside the app), browser.mjs (node plumbing)
game/forge-loader.js     load a forged GLB into Three.js, with the game's rig names
templates/ronin.js       the worked example: build, joints, previews
```

The app copies in `app/` are refreshed from `tools/sculpt` and `tools/anim` with `sync.sh` at the
plugin root. If the doctor says the rigging module is missing, run it.
