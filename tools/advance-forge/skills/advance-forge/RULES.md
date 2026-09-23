# Advance Forge: the rule sheet

Read all of this before making anything, every session. It's long because every section cost
something to learn. Where a rule says **never** or **always**, it's there because the other way was
tried, shown to the user, and rejected.

### The two rules that apply to everything

1. **Every character is modelled in a T-pose**: feet under the hips, legs straight, arms straight
   out to the sides at shoulder height, palms down, fingers pointing out along the arm. No
   exceptions, not even for a character that will only ever stand still. See §9.
2. **Every model that leaves the studio goes through `scripts/ship.mjs`, and comes out at 2,000 to
   5,000 triangles.** Never hand the game anything else: not the full sculpt, not `forge.mjs`'s
   preview GLB, not `rig.mjs`'s check file. `ship.mjs` is the converter:
   - it welds the character into one closed skin;
   - it reduces it to 2k–5k triangles (it refuses anything outside that range);
   - it bakes the full sculpt's detail into a texture;
   - it rigs the character and bakes its animations.
   See §11.

Contents:

1. [Where these rules come from](#1-where-these-rules-come-from)
2. [What gets a custom model, and what doesn't](#2-what-gets-a-custom-model-and-what-doesnt)
3. [Style: match the game](#3-style-match-the-game)
4. [Plan before you build](#4-plan-before-you-build)
5. [The method: ten stages, in order](#5-the-method-ten-stages-in-order)
6. [Proportions and anatomy](#6-proportions-and-anatomy)
7. [Making it feel 3D](#7-making-it-feel-3d)
8. [Heads and faces](#8-heads-and-faces)
9. [Rigging](#9-rigging)
10. [Animation](#10-animation)
11. [Putting it in the game](#11-putting-it-in-the-game)
12. [The review checklist](#12-the-review-checklist)
13. [Pitfalls already hit, and their fixes](#13-pitfalls-already-hit-and-their-fixes)
14. [Working with the user](#14-working-with-the-user)

---

## 1. Where these rules come from

The user is building this toolset so an AI can make **good** 3D models and animations. They taught
it through four rounds of real work. Their words are the standard:

- **"Don't make it out of shapes. ACTUALLY SCULPT it so it looks good."** (on the first request)
- **"You can use other shapes if needed and add more if needed, still sculpt tho so it looks good."**
  So shapes are allowed as a *starting point*; the result must still be sculpted.
- **"It's all about being stylized and realistic."**
- On the soldier, second pass: **"You need to make the texture feel more 3D, add creases, the
  clothes, just make stuff feel more 3D, add some more shading, and make it as realistic as you
  can. Put ALOT of effort into the body."**
- On animation: **"The feet are like just pointing up like at a 45 degree angle."** Small, specific
  and correct. They look closely at every result.
- For this plugin: **"It don't have to be realistic, just what style the game is,"** and **"only
  some things should have a custom 3D model, only things that need that detail to look nice, like
  all the characters in the game."**

What happened, and what each round taught:

| Attempt | What was made | What was wrong | The lesson |
|---|---|---|---|
| Mega Man v1 | Brush strokes pulled out of a sphere | The user interrupted and asked for a restart four times | Don't grind away at a bad approach. Change the method |
| Mega Man v2 | Shapes welded, painted, a few strokes | "Ok for a start but a lot to fix": toy-like, flat, painted-on eyes | Shapes alone read as a toy. Detail has to be sculpted |
| Soldier v1 | Clay anatomy, kit, one fold pass | Flat camo, boxy pouches, stiff mannequin pose | Paint isn't depth. Gear must be layered |
| Soldier v2 | Folds as ridges, crease valleys, baked shading, layered kit | Accepted ("great job") | Folds + creases + baked shading = "feels 3D" |
| Rig v1 | Soldier rigged as sculpted | Forearm fused to vest, holster fused to glove: stretching | Sculpt limbs clear of the body |
| Anim v1 | Walk, idle, aim, crouch | Toes pointing up 30–45° | A foot bone is not horizontal when the foot is flat |
| Ronin (template) | Built while writing this plugin | Balloon obi, dotted pleats, hakama webbing between the legs | See §13: each became a rule |
| Plugin rules, v2 | The user added two rules | "Make all the character models T-pose"; "a triangle count converter that brings it down to 2k to 5k that the AI will always use to export" | §9 and §11: T-pose always, `ship.mjs` always |

---

## 2. What gets a custom model, and what doesn't

A custom model costs hours and tens of thousands of triangles. Spend that only where the player
will **see the difference**. The game already builds most of its world from primitives in
`src/entities/models.js`, `src/world/props.js` and `src/world/terrain.js`, and that's correct for
most things.

### Always gets a custom model

- **Every character**: the playable classes, NPCs (villagers, merchants, sensei, Hana and other
  companions), story characters, and anyone with dialogue or a cutscene.
- **Enemies**: every enemy type, and each tier variant that changes silhouette. A recolour does not
  need a new model.
- **Bosses**: always, at the highest budget. The player stares at them for minutes.
- **Mounts and animals the player rides, tames or fights up close.**

### Gets one when the player sees it up close

- **First-person weapons**: the katana, yari or bow in the player's hands fills a quarter of the
  screen, all game long. Model it.
- **Hero props in cutscenes or held in dialogue**: a letter, a relic, the god's mask.
- **Set-piece statues and shrines the camera frames** (the Faceless Colossus, a boss throne). Only
  if the primitive version looks cheap next to the characters.

### Never gets one; keep it procedural

Terrain, rocks, cliffs, trees, grass, bamboo, water and sky. Houses, walls, fences, gates, bridges,
stairs, roofs and torii (the architecture system in `props.js` handles these). Crates, barrels,
lanterns, carts and banners placed by the hundred. Pickups, coins, chests, projectiles and
particles. UI, icons and menus.

### The test, when unsure

Answer each honestly:

1. Does it move or deform (walk, fight, talk)?
2. Is it on screen for long, within about 5 m of the camera?
3. Does it need to show identity or emotion (a face, a posture, a costume)?
4. Will primitives visibly look worse *next to the characters around it*?

- **Two or more yes → custom model.**
- **Zero or one → procedural.** Improve the primitive version instead: better proportions, a bevel,
  a second colour.

Tell the user which way you decided and why, in one line.

---

## 3. Style: match the game

**Realism isn't the goal; matching the game is.** A model can be beautifully sculpted and still
wrong if it doesn't sit in the same world as everything around it.

### This game: 追放者たち (The Forsaken One)

From its README and code: *"stylised realism, not photorealism"*, *"procedural geometry with PBR
materials"*, fantasy medieval Japan, first-person, a day/night cycle with a strong sun and dark
shadows.

- **Proportions**: realistic, pushed slightly heroic. Humans are 7–7.5 heads tall (1.8 m for an
  adult man; `buildHumanoid` uses H = 1.8). Heroes get broader shoulders and a stronger jaw.
  Children are about 0.58 scale (the game's `child` flag). Creatures and bosses exaggerate freely:
  horns, extra arms, a carapace, bone. The game's own humanoid already takes those additions.
- **Silhouette first**: every character must be nameable **at forty metres** (the game's own words
  in `models.js`). Hat, weapon, sleeve shape, armour mass and posture carry it. Check the six-view
  sheet at thumbnail size.
- **Era and place**: kimono, hakama, obi, haori, tabi and waraji; katana, wakizashi, yari, naginata,
  yumi; kabuto, men-yoroi and lamellar dō; straw kasa hats; shimenawa rope; lacquer, iron, bronze,
  bamboo, straw, paper and silk. No modern kit in this game unless the user asks for it. The soldier
  in `tools/sculpt/examples` was a test subject, not this game's style.
- **Materials read as materials**: cloth is soft-edged and folded; lacquer and iron are crisp with a
  highlight; straw is woven; skin has warmth and variation. The game renders PBR with a strong key
  light, so a surface with no form variation looks like plastic.
- **Palette**: earthy and slightly desaturated (indigo, charcoal, rust, ochre, moss, bone), with one
  saturated accent per character (a red obi, a gold crest, a blue sash). The game adds about 10%
  self-colour to every material so night scenes stay readable; forge-loader does the same.
- **Surfaces "feel 3D"** (§7): folds, creases, layered kit and baked shading are part of the style,
  not optional polish.

### A different game, or a part of this one with its own style

Before building, write a five-line style brief from the evidence and show it to the user if you're
unsure:

1. Realism level (toon / stylised / stylised-realistic / realistic), with the sentence from the
   README or code that says so.
2. Head count and exaggeration.
3. Palette: three to six colours, taken from the game's code (`mat(0x3a3f4a…)` calls, gamedata
   colours).
4. Surface treatment: flat colour, vertex paint, PBR with baked AO, and so on.
5. What the existing models look like: open `models.js` and actually read how `buildHumanoid` is
   built.

If a style is **toon or low-poly**, the method changes: fewer folds, bigger shapes, flat or
two-tone paint, no baked grime. Still sculpt the silhouette and the key forms. "Toon" doesn't mean
"primitive".

---

## 4. Plan before you build

Write this plan in your reply or in a comment at the top of the build script **before any
geometry**:

```text
Subject:        who or what, and its role in the game
Reference:      what it should look like: era, costume pieces, the one image it must evoke
Silhouette:     the three shapes that make it recognisable at 40 m
Proportions:    height, heads tall, build (from §6)
Pose:           T-POSE: feet under hips, arms straight out at shoulder height, palms down (§9)
Pieces:         body (one clay build), head (own build), props (own builds: they ride one bone)
Detail budget:  where the eye goes (face, chest, weapon) gets the most folds, straps and paint
Palette:        4–6 named colours + 1 accent
Triangles:      the ship count, 2,000-5,000 (§11). More detail -> nearer 5k, crowds -> nearer 2k
Rig notes:      anything wide (robes, capes, big sleeves) and how it will move
```

---

## 5. The method: ten stages, in order

The order is the method. `templates/ronin.js` is written in exactly these stages; copy it.

1. **Skeleton, in a T-pose.** Write the joint positions (`J`) first: hips, knees, ankles,
   shoulders, elbows, wrists, with the arms straight out to the sides (§9). Everything is placed relative to them, and the same numbers become the rig's joints file.
   This single step prevents most rigging problems.
2. **Anatomy, under the clothes.** Build a body in masses, even if it will be covered: ribcage,
   chest, belly, pelvis, trapezius, deltoids, upper arm, forearm, thigh, calf. Clothes draped over
   a real body look real; clothes built as tubes look like tubes.
3. **Clothing.** Tight clothes are the body forms again with a larger `k` blend. Loose clothes are
   their own shapes (a sleeve bag, a flared trouser leg, a skirt panel), with the body inside.
   Keep separate garments as separate forms so the silhouette steps where the garment ends.
4. **Folds.** Ridges placed on the actual surface: `C.fold` wraps around a limb, and `C.pleat` runs
   along it. Put them where cloth really folds (§7). Add them before kit, so straps sit over them.
5. **Kit.** Belts, straps, armour plates, pouches, buckles, cords and the props themselves. Layer
   things on things: a strap over a fold, a buckle on the strap, a cord through the buckle.
   **Props that must stay rigid (weapons, hats, masks, shields) are separate clay builds**
   (`C.newObject`), so they become separate pieces that ride one bone.
6. **Head.** Its own clay build in facial forms (§8), then brushed (smooth, pinch, crease). Hair is
   another separate piece if it uses `intersect` or `subtract`.
7. **Join.** `M.joinAll()`: one mesh, and the separate pieces stay separate pieces inside it.
8. **Brush pass.** Real strokes through the app's engine: a crease in the valley beside every fold,
   plus seams, stitching, panel lines, the welt of a sole and the edge of a plate. This is the
   "ACTUALLY SCULPT it" part. It turns soft forms into made things.
9. **Paint and shade.** Colour by part (`C.autoPaint` runs as each piece is built). Add pattern,
   tonal drift, weave, wear and dust, paint the small details (eyes, the collar V, stripes), then
   `C.bakeShading()`.
10. **Ship.** `scripts/ship.mjs`, and nothing else, makes the game file at 2,000–5,000 triangles
    (§11).

**Shapes are allowed, as material, not as the result.** Starting from primitives and clay forms is
fine; the user said so. Stopping there isn't: every build ends with folds, a brush pass, paint and
baked shading.

---

## 6. Proportions and anatomy

Metres, for a 1.8 m adult man, feet at y = 0, facing +Z, the character's left at +X. Scale
everything by height / 1.8 for other sizes.

| Landmark | y | Half-width (x) | Notes |
|---|---|---|---|
| Top of skull | 1.77 | | the head is about 0.23 m tall, chin to crown |
| Eye line | 1.645 | eyes at ±0.031 | the eyes sit halfway down the head |
| Nose tip | 1.61 | | z ≈ 0.115 |
| Mouth | 1.588 | ±0.02 | |
| Chin | 1.56 | | |
| Neck base / collar | 1.47 | | |
| Shoulder joint | 1.43 | ±0.19–0.20 | shoulders are 2 head-widths each side |
| Chest (nipple line) | 1.33 | ribcage ±0.15 | |
| Elbow | 1.17 | ±0.26 | at the waist |
| Navel / waist | 1.10 | ±0.13 | the narrowest part of the torso |
| Hip joint | 0.94 | ±0.092–0.095 | |
| Wrist | 0.95 | ±0.31 | level with the hip joint when hanging |
| Fingertips | 0.80 | | mid-thigh |
| Knee | 0.52 | ±0.10–0.11 | |
| Ankle | 0.09 | ±0.11–0.12 | |
| Foot | 0.26 long | | the toe is about 0.17 m in front of the ankle |

- **Women**: shoulders about ±0.17, hips as wide as the shoulders, waist ±0.11, height 1.65.
- **Heroic male**: shoulders ±0.22, a bigger chest mass, a smaller head (8 heads tall).
- **Children**: a bigger head relative to the body (5 heads), a short torso and legs.
- **Monsters**: pick one exaggeration and commit to it. Long arms or a huge upper body; not everything
  at once.

Masses that make a body read as a body (see `templates/ronin.js` §2):

- Ribcage (an ellipsoid, 0.15 × 0.17 × 0.10) plus a chest (a flatter one in front).
- Belly and pelvis, blended with a large `k` (0.05–0.07).
- Trapezius from the neck to each shoulder.
- A deltoid capping each shoulder.
- A biceps bulge on the upper arm, and a forearm mass near the elbow.
- Quads on the front of the thigh, a calf bulge behind the shin, and the seat behind the pelvis.
- The neck: a limb from the collarbone to under the skull, slightly forward.

---

## 7. Making it feel 3D

This is where the user's standard sits. A model feels flat when its surface has no local form: when
the only thing changing across it is colour. Everything below adds form.

### Folds: where cloth really folds

| Where | What cloth does | Tool |
|---|---|---|
| Crotch to outer knee | Long diagonal pulls (3–4 per thigh) | `C.fold` with a tilt of about 0.1 |
| Behind the knee, inside the elbow | A zig-zag stack of 2–3 short folds | `C.fold` at t ≈ 0.85–0.95, arcs of about ±1 rad around the back |
| Where trousers tuck into boots or wraps | 3–5 stacked rings | `C.fold` at t 0.55–0.8, full arcs |
| Sleeve cuff, sleeve bag | Sag folds hanging down | `C.fold` with sag |
| Shirt between a vest and a belt | 3 horizontal bunches | `C.fold` around the torso axis |
| Hakama, robes, capes, long skirts | Long vertical pleats | `C.pleat` |
| Sashes, belts, wraps | One or two ridges around | `C.fold` with a full arc and a small r |

Randomise every fold slightly (start and end angle ±0.2 rad, tilt, sag, depth). Identical folds read
as a pattern, not cloth. Then **every fold gets a crease** in its valley in the brush pass (stage 8;
the ronin's loop does it for you). A ridge without its valley reads as a tube; the pair reads as
cloth.

### Layering

Things sit **on** things: a pouch on a vest, a flap on the pouch, a buckle on the flap, a cord
through the buckle, and a strap crossing over it all. Each layer is its own form with its own small
`k` (0.001–0.006), so there's a real edge and a real shadow line. Flat panels painted a different
colour don't count as layers.

### Edges and silhouette breaks

- Hard things (armour, lacquer, soles, wooden hafts) get crisp edges: a small `rnd`, or the
  `trimnormal` / `trimdynamic` brushes.
- Soft things (cloth, flesh) get large blends.
- Break the silhouette on purpose with kit: a sword hilt, a topknot, a rolled sleeve, a hanging cord.

### Paint: depth, not flat colour

- **Tonal drift**: large-scale noise darkening and lightening the base colour by about 20%. No
  surface is one colour.
- **Weave or grain** at a fine scale (noise at about 600–700) on cloth; grain on wood; a slight
  variation on metal.
- **Wear and dust**: dust climbs from the ground (stronger below 0.5 m), and grime collects in
  patches.
- **Pattern where the costume has one**: camo, a shemagh check, hakama pin-stripes, a crest.
- **Paint what paint does best**: eyes (white, iris, pupil), a collar V, a stripe or a tattoo.
  Sculpting those produced blobs. **Sculpt what sculpting does best**: anything that casts a shadow.
- **A colour change should land on a form edge** where it can (a collar band, the end of a
  sleeve), not on a smooth surface, where it looks jagged.

### Baked shading: the last step, always

`C.bakeShading({ floor: 3, ao: 0.9 })` darkens:

- where pieces sit close together (ambient occlusion from every clay field),
- inside every brushed crease,
- near the ground,

and lifts ridges. The model then carries its own light in any engine, which is most of what makes it
"feel 3D" in the game's lighting.

---

## 8. Heads and faces

The face is the first place the eye goes. Give it the most care per square centimetre.

1. **Build it from facial forms, not a sphere** (its own clay build; ronin §6):
   - Cranium and face mass as two ellipsoids.
   - The neck.
   - Jaw lines as tapered limbs from under the ear to the chin, and a chin ellipsoid.
   - Cheekbones, and a brow ridge as a limb across.
   - Eye sockets **subtracted**, with eyeballs set into them.
   - Upper and lower lids as thin limbs over the eyeballs.
   - A nose bridge limb, a tip, and two nostril wings.
   - Upper and lower lip ellipsoids with a mouth line subtracted.
   - Ears: an ellipsoid plus a torus rim, angled back about 22°.
2. **Brush it** with symmetry on: smooth to blend the forms, pinch and crease the nasolabial fold,
   clay the brow. Light strokes (strength 0.15–0.3, radius 5–20 mm).
3. **Paint the eyes**: white, a darker iris about 7.5 mm across, and a pupil about 3.5 mm. Blank white
   eyes look dead or startled.
4. **Lids decide the expression.** A heavy upper lid half over the iris looks calm, tired or hard.
   Lids that don't touch the iris look startled.
5. **Hair is its own piece**: the cranium grown 4–6 mm, `intersect`ed to keep the top, and
   `subtract`ed at the hairline and around the ears. **Never `intersect` inside the head's own
   build**: it cuts the whole head.
6. Face coverings (masks, wraps) are the head's own forms grown a few millimetres
   (`{ grow: 0.006 }`) and cut, so they follow the face (the soldier's shemagh).

---

## 9. Rigging

The skeleton is SculptFree's 21-bone humanoid: Hips, Spine, Chest, Neck and Head, then for each
side (.L = the character's left, +X) Shoulder, UpperArm, LowerArm, Hand, UpperLeg, LowerLeg, Foot
and Toes.

1. **Every character is sculpted in a T-pose. Always.**
   - **Legs**: feet under the hips (ankles about ±0.12 m for a 1.8 m man), knees straight, toes
     forward, a clear gap between the legs below the crotch.
   - **Arms**: straight out to the sides, level with the shoulders. For a 1.8 m man: shoulder joint
     about ±0.19 at y 1.43, elbow about ±0.46, wrist about ±0.70, all at y ≈ 1.42.
   - **Hands**: open, palms down, fingers together and pointing out along the arm with a slight
     natural curl, thumb forward and down.
   - **Head and spine**: straight, facing +Z.
   - **Clothing hangs as it would with the arms raised**: a kimono sleeve hangs *below* the arm,
     a cape falls straight down the back.

   Why: in a T-pose nothing touches anything it shouldn't. Anything the clay build fuses together
   becomes one surface and stretches when either side moves, and no weight setting can fix that.
   The T-pose keeps the arms far from the body and hips, so this never happens. It's also the
   industry standard, so the file works in every animation tool.

   The Rig Player and `forge-loader.js` lower the arms automatically when they load a T-posed file.
   They skin the mesh into an arms-down pose and make that the rest pose, so the clips and the
   game's own procedural animation (`rotation 0 = arm hanging`) work unchanged, while the file
   stays a clean T-pose.

   `rig.mjs` and `ship.mjs` print the arm angle, and warn if a character isn't in a T-pose. Treat
   that warning as a failed build.
2. **Garments that span both legs** (hakama, robes, long skirts and coats) web between the legs in a
   walk. Build them **split, one leg each**, like real hakama. For a true skirt or robe, keep the
   hem clear of the knees, or ask the user whether a stiff, hips-driven skirt is acceptable.
3. **Always pass your skeleton to `rig.mjs --joints`.** Write it from the build's `J` (the ronin has
   `ronin_joints.json`). The automatic fit is only a bounding-box guess; loose robes and big weapons
   throw it off.
4. **Props**: separate pieces ride one bone whole. The rig picks the bone the piece touches. When
   it picks wrong (a hip sword that the hanging hand is closer to), pin it:
   `"$attach": [{ "at": [x, y, z], "bone": "Hips" }]`.
5. **Weapons in the hand** (the soldier's rifle) are separate pieces touching the hand; they ride
   `Hand.*`. A sheathed sword rides `Hips`, a quiver `Chest`, a hat `Head`.
6. **Read the pose sheet** (`NAME_poses.png`): the T-pose rest, arms lowered, step, arms up and
   crouch, front and side, plus the weight colours. Look for:
   - the armpit and shoulder deforming badly when the arms come down, the thing a T-pose rig must
     get right: if it creases or collapses, the shoulder joint is too far in or too far out;
   - stretching between a limb and the body,
   - webbing between the legs,
   - a prop left behind or bending,
   - a joint drawn outside the limb,
   - the head deforming (the Neck and Head joints are wrong).
7. `rig.mjs` is for **checking** the rig on a 60k mesh. The game file is always made by
   `ship.mjs` (§11), which rigs the 2k–5k mesh itself with the same joints file.

---

## 10. Animation

- The built-in clips (Walk, Idle, Aim & scan, Take cover) work on any character with the humanoid
  bone names. Add your own with `animate.mjs --clips my_clips.js` (`addClip({...})`; the format is
  in the header of `animate.mjs`).
- **`abs` angles are swings from straight down, in degrees, with + meaning forward.** They mean the
  same thing whatever pose the model was sculpted in. The player subtracts each bone's rest angle.
- **Feet: 90 means flat on the floor**, and the player maps that onto each foot's real flat angle.
  Never assume a foot bone is horizontal. It runs from the ankle down to the toes, about 60° from
  vertical. That's the "toes pointing up 45°" bug.
- **`rel` angles** are extra [x, y, z] degrees on top: x pitches, y twists and z rolls out. Use them
  for the spine, head and arms crossing the body.
- **Game-ready clips** for a character: Idle, Walk, and Run (a Walk at about 1.6× cadence with longer
  strides and more lean) at minimum. Then add class-specific ones: an attack per weapon type, block,
  hit react, death, and a cast or bow draw.
- **Check every strip** (`NAME_anim_*.png`): the planted foot flat and still on the ground, no foot
  through the floor, no webbing, props moving with the right bone, and the head not wobbling.
  The side view shows most of it.
- Loops must match at the start and end (use `Math.sin` of `t / duration × 2π`). One-shots
  (attacks, deaths) set `loop: false`.

---

## 11. Putting it in the game

1. **Export with the converter, always**:
   ```bash
   node scripts/ship.mjs out/ronin/ronin.sculpt --out out/ronin --joints ronin_joints.json [--tris 4000] [--clips my_clips.js]
   node scripts/ship.mjs out/katana/katana.sculpt --out out/katana --static --tris 2000       # a prop
   ```
   What it does, in order:
   1. **Welds** the character's pieces (body, head, hair, clothing layers) into one closed skin.
      Hidden inner layers would show through at low triangle counts and waste the budget.
      Props named in the joints file's `$attach` stay separate, so they stay rigid.
   2. **Reduces** to `--tris`, **2,000–5,000 only** (default 4,000). Anything outside that range
      is clamped into it.
   3. **Bakes a texture from the full sculpt** ("high to low", as game studios do). Every texel of
      the reduced mesh looks up the visible surface of the full-detail sculpt and takes its
      colour: the paint, the pattern, and the baked folds, creases and shading. So a 4,000-triangle
      model still shows every fold you sculpted. It uses a unique, non-overlapping texture layout,
      so no two surfaces share pixels.
   4. **Rigs** it with your joints file and **bakes every clip** (built-in plus `--clips`) into the
      file.
   5. **Renders the game file itself** with its texture: `NAME_game-sheet.png`,
      `NAME_game-face.png` and `NAME_game_anim_walk.png`. Look at all of them. That's what the
      player will see.

   The output is `NAME_game.glb`. Put it in `assets/models/` (make the folder). Keep the build
   script, the joints file and the `.sculpt` too, so the model can be rebuilt; never ship a model
   you can't rebuild.
2. **Load it** with the bundled loader. Copy `game/forge-loader.js` into `src/entities/` and use it:
   ```js
   import * as THREE from 'three';
   import { loadForgeCharacter } from './forge-loader.js';
   const ronin = await loadForgeCharacter('assets/models/ronin_game.glb', THREE);
   scene.add(ronin.root);
   ronin.play('Walk');            // then ronin.update(dt) every frame
   ```
   - `ronin.rig` has the game's joint names (`hips`, `torso`, `head`,
     `armL/armR.{shoulder,elbow,hand}`, `legL/legR.{hip,knee}`), with **game L = the -X side**,
     matching `buildHumanoid()`.
   - So the existing procedural animation in `actors.js` can drive a forged character in place of
     a primitive one. `root.userData.rig` and `root.userData.height` are set the same way.
3. **Swap, don't duplicate**: when a character gets a forged model, change the spot that calls
   `buildHumanoid(...)` for it to load the GLB, keeping the same `{ root, rig, height }` shape.
   Keep a fallback to the primitive build if the file fails to load.
4. **Triangle counts: always 2,000–5,000** (`ship.mjs --tris`):

   | What | `--tris` |
   |---|---|
   | Boss, player class, main companion | 4,500–5,000 |
   | Named NPC, elite enemy | 3,500–4,500 |
   | Common enemy (many on screen) | 2,500–3,500 |
   | Crowd villager, animal | 2,000–2,500 |
   | First-person weapon, hero prop | 2,000–3,000 (`--static`) |

   Sculpt at full detail regardless. The detail reaches the game through the texture, not the
   triangles. The triangles only carry the silhouette, so spend them where the outline is: head,
   hands, weapon.
5. **Check in the game's own renderer** (the vendored three.js, strong sun, dark shadows), not just
   in SculptFree. `forge-loader.js` shows the texture and lowers the T-pose arms, so always load
   through it.

---

## 12. The review checklist

Go through this against the renders **every build**. Write the failures down, then fix them.

Silhouette and proportion:

- [ ] At thumbnail size, can you name what it is? Is the silhouette distinctive?
- [ ] Is it the height from §6? Does it look right against the numbers in the size line the build
  prints?
- [ ] Does it match the game's style (§3), rather than generic, realistic or toy-like?

Form:

- [ ] Is there a body under the clothes (shoulders, chest, hips, knees)?
- [ ] Do folds sit on the cloth where cloth really folds, each with its crease?
- [ ] Is there layering: things on things with real edges?
- [ ] Is there anything boxy that should be soft, or soft that should be crisp?
- [ ] Are there balloons? (capsule ends bulging: a round end where a flat one belongs)
- [ ] Are there floating or disconnected bits, or spikes? (check the MISS list the build prints too)

Face:

- [ ] Does it have a real nose, lips, brow, cheekbones and jaw? Do the eyes have iris and pupil?
- [ ] Do the lids give the expression you meant?

Surface:

- [ ] Is every surface varied: tonal drift, weave, wear?
- [ ] Do colour edges land on form edges?
- [ ] Was the shading baked, and are the creases dark and the ridges lit?

Pose and export:

- [ ] Is it a clean T-pose (arms level, straight out, palms down; legs straight, feet under hips)?
- [ ] Was it exported with `ship.mjs`, at 2,000–5,000 triangles?
- [ ] Do the `_game` renders look like the sculpt, with the folds, face and pattern all there in
  the texture?

Rig and animation (once rigged):

- [ ] Is there a gap between the legs? Do the armpits deform cleanly when the arms come down?
- [ ] Do all four test poses deform cleanly, with props on the right bones?
- [ ] Are the feet flat and planted in every clip, from the side?

---

## 13. Pitfalls already hit, and their fixes

| Symptom | Cause | Fix |
|---|---|---|
| Wood-grain ripples all over the surface | Many booleans one after another, each re-quantising the surface | Build everything in **one** clay build (`C.build`), not shape-by-shape booleans |
| Ripples that only show with shading on | The app's cavity shading, not the geometry | Check with `--cavity 0` before chasing it |
| A belt or sash is a giant ball | A capsule (`C.limb`) of large radius has round ends | Use `C.box` with rounding for bands, belts and flat things |
| Pleats come out as rows of dots | `C.fold` wraps *around* a limb; a narrow arc makes a bump | Use `C.pleat` for anything that runs *along* a limb |
| Strokes print `MISS` | The stroke started off the surface, or behind something | Start on the surface; strokes now slide to the first point that hits |
| A brush stroke does nothing on a big mesh | Radius in pixels is capped, or the camera is too far | `M.at(point, dir, halfHeight)` close to the spot first; radii are world metres |
| `intersect` cut the whole head | Intersect applies to everything in that build | Put hair and other cut pieces in their own `C.newObject` build |
| White boxes that read as buttons | A sculpted panel where a painted one belongs | Paint collars, V-necks and stripes in `autoPaint` |
| Eyes look dead or startled | No iris or pupil; lids too thin | Paint the iris and pupil; a heavier upper lid |
| A folded rim looks jagged where two colours meet | Colour changes on a smooth surface | Put a form edge there (a collar band, a seam) |
| Painted detail blurs after export | Colour kept on vertices, which a 4k mesh can't hold | Export only with `ship.mjs`: it bakes the colour into a texture from the full sculpt |
| Dark bands, blotches or specks on a shipped model | Hidden inner layers (scalp under hair, neck inside a collar) showing through once reduced; or overlapping texture space | `ship.mjs` welds the pieces into one skin and uses a unique texture layout; never reduce by hand |
| Character loads in a T-pose in the game | Loaded without forge-loader | Always load through `forge-loader.js` (it lowers the arms) |
| Arm lift stretches the vest | The forearm was sculpted touching the vest, and fused | T-pose (§9), then rebuild |
| A strand from the hand to the thigh | The holster touched the glove, and fused | Move the prop lower or away |
| Web between the legs in a walk | Wide trousers or a robe built as one surface | Split legs with a gap (hakama), or a skirt clear of the knees |
| The sword swings with the arm | The rig gave the prop to the nearest bone | `$attach` it to Hips |
| Joints outside the limbs | The automatic skeleton fit | Always pass `--joints` from the build's `J` |
| Toes pointing up 30–45° in clips | A foot angle of 90 treated as horizontal | Fixed in the player: 90 = flat (per-foot flat angle) |
| The model walks with a limp | It was sculpted mid-stride | T-pose (§9). `abs` angles hide it, but game code using `rig` won't |
| Colours washed out in the game | sRGB vertex colours lit as linear | Load through `forge-loader.js` (it converts) |
| Folds jump onto another limb | The surface probe reached a neighbouring form | Keep `reach` short (0.15–0.3); `C.fold` stops at a jump |
| Nothing renders / the doctor fails | Playwright or Chromium missing, or the app copy stale | `npm i -g playwright`, or set `CHROME_PATH`; run `sync.sh` |

---

## 14. Working with the user

- **Show, don't describe.** Every round, send the sheet and the close-ups (with the SendUserFile tool
  when you have it), and a render of the rig and animation when you get there.
- **Be honest about what's still weak.** The user notices everything. Say it before they do, and
  say what you'd fix next.
- **Act on feedback exactly**, including small, specific notes ("toes at 45°"). Re-render the exact
  thing they pointed at, from the angle they saw it.
- **If they say restart, restart**: wipe the attempt and start from the plan with a different
  approach, not a patch.
- **Keep effort where they asked for it.** "Put ALOT of effort into the body" means more folds, more
  layers and more passes on the body, not a longer message.
- **Commit the build scripts and the outputs together**, so every model can be rebuilt.
