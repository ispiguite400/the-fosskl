# Soldier: a scripted sculpt, test 2 (third pass)

![Soldier, three-quarter view](three-quarter.png)

A stylised-realistic soldier in a helmet, face wrap, sunglasses, plate carrier
and multicam uniform, carrying a carbine. It was built in SculptFree by
scripts that drive the app.

| File | What it is |
| --- | --- |
| `soldier.sculpt` | The project. Open it with ☰ → Open project |
| `soldier.glb` | The model with vertex colours, reduced to 250k triangles |
| `body.js` | The body: a walking skeleton fleshed out with anatomy, roomy uniform and cloth folds, plus the plate carrier, pouches, belt, holster, knee pads, gloves and boots |
| `head.js` | The head, built up in clay forms and refined with brushes |
| `gear.js` | The helmet (lumpy cover, rails, band, night-vision mount), sunglasses and face wrap |
| `rifle.js` | The carbine, carried in the right hand |
| `finish.js` | Tilts the head down a little, then joins every piece into one mesh |
| `creases.js` | The brush pass: a crease cut beside every fold, stitching round the plates, webbing ticks, seams and welts |
| `look.js` | Bakes the shading into the colour and sets up the view |
| `paint.js` | The palette: layered multicam, fabric weave, dust towards the ground, coyote kit, shemagh check |
| `clay.js`, `sculptkit.js` | Helpers that drive the app |
| `build.mjs` | Runs every step inside the app and writes the files and renders |

## How it is made

- **Anatomy under the clothes.** A walking skeleton, with the right leg
  forward, the left pushing off and the left arm swinging, is fleshed out
  with tapered limbs and blended clay masses. The upper arm has a deltoid,
  biceps, elbow and forearm, the torso has a ribcage, chest, belly and
  pelvis, and the uniform around them is roomy.
- **Folds that sit on the cloth.** Every fold is a broad, soft ridge that
  wraps partway round a limb. It is placed on the actual surface by probing
  outward from the limb's centre, and it tilts, sags and varies in depth.
  The folds include thigh pulls from the crotch, zig-zags behind the knees,
  stacking where the trousers are bloused into the boots, a twist down each
  sleeve, bunching inside the elbows and at the cuffs, and the shirt
  gathered under the carrier.
- **Brush creases.** A second pass cuts a Crease stroke into the valley
  beside each fold, then adds stitching round the plates, webbing ticks on
  the belt, the outer trouser seams, sole welts and toe-cap seams.
- **Layered kit.** The plate carrier has shoulder pads, raised webbing rows,
  magazine pouches with flaps, buckles and bungee cords, admin and radio
  pouches, a radio antenna, a name tape, a light, a carabiner, a knife,
  grenade pouches and a hydration carrier with its drinking tube. There is
  also a battle belt with pouches, a drop-leg holster strapped to the thigh,
  knee pads with straps, gloves with knuckle pads, and boots with a toe cap,
  heel counter, laces, collar and a real sole.
- **Shading baked into the colour.** The model carries its own light:
  - Shadow where pieces sit close together, worked out from every piece's
    shape, so the vest shades the shirt and the helmet shades the face.
  - A dark line in every sculpted crease and a light edge on every ridge.
  - A little contact shadow near the ground.

  It shows in any viewer and in the GLB.
- **Paint.** Layered multicam, with a tan-to-sage ground, brown shapes,
  cream highlights and fine twigs, plus a fabric weave and dust that builds
  up towards the ground.

Rebuild with `node ../../build.js && node build.mjs`. This takes about 90
seconds. The sculpt is about 880k triangles, and the project and GLB are
reduced to 300k.

## Rigged and animated

This soldier is rigged with SculptFree's **☰ → Rig** and animated in
`../../../anim/`, which holds the rigged GLB, a version with four clips baked
in, and a player. To rig cleanly, two things changed from the first sculpt:

- **The arms hang a few centimetres out from the body.** Where a forearm
  rested against the vest, the clay build fused them into one surface, and
  lifting the arm stretched the vest with it.
- **The holster sits lower on the thigh**, clear of the right glove.

