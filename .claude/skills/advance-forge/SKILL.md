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

# Advance Forge (this repo)

The plugin lives in **`tools/advance-forge/`**. It's kept there so it can also be installed in
other projects. Its real entry point is:

**`tools/advance-forge/skills/advance-forge/SKILL.md`**. Read it now, then follow its hard gate
in order:

1. Read `tools/advance-forge/skills/advance-forge/RULES.md` completely.
2. Read `tools/advance-forge/skills/advance-forge/API.md`.
3. Open `tools/advance-forge/skills/advance-forge/templates/ronin.js` and its preview PNGs.
4. Run `node tools/advance-forge/skills/advance-forge/scripts/forge.mjs doctor`.

Everything in those files applies here. Paths in them are relative to
`tools/advance-forge/skills/advance-forge/`.
