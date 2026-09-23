# Working in this repo

## 3D models, characters, rigs and animation: use Advance Forge (mandatory)

Any task that makes or changes a 3D model, character, enemy, boss, NPC, creature, weapon, armour or
hero prop, or rigs or animates one, **must** go through the Advance Forge plugin in
`tools/advance-forge/`. That includes deciding whether something should get a custom model at all.

Before starting such a task:

1. Read `tools/advance-forge/skills/advance-forge/SKILL.md`.
2. Read `tools/advance-forge/skills/advance-forge/RULES.md` **in full**. It holds the game's style,
   what deserves a custom model (characters always; most scenery never), the method, budgets, and
   every past mistake.
3. Read `tools/advance-forge/skills/advance-forge/API.md`, and open
   `tools/advance-forge/skills/advance-forge/templates/ronin.js`, the worked example.
4. Run `node tools/advance-forge/skills/advance-forge/scripts/forge.mjs doctor`.

Two rules with no exceptions:

- **Every character is sculpted in a T-pose**: arms straight out at shoulder height, palms down,
  legs straight, feet under the hips.
- **Every model is exported with `tools/advance-forge/skills/advance-forge/scripts/ship.mjs`**, the
  triangle converter. It outputs 2,000–5,000 triangles, with the full sculpt baked into a texture,
  rigged and animated. Never put any other model file into the game.

Build with its scripts, **look at every render** it produces before saying anything is done, and
show the user the images. Do not hand-place three.js primitives for a character when this plugin
can sculpt it.

Everything else in the game is generated at runtime from code (`src/`); see `README.md`.
