# FORLORN character style: the user's rules

Read this, then `tools/advance-forge/skills/advance-forge/RULES.md`, before touching a character.
These come straight from the user's feedback, with a reference image of Guest 1337.

## The look: the MOVIE versions, not Forsaken's

- **Match how each character looked in the ObliviousHD films, never the Forsaken game.** The user:
  *"pls make everyone match how they looked in the movies not forsaken."*
- **The body is R6 wearing the films' package shapes (Robloxian 2.0): NOT plain blocks and NOT R15.**
  The user: *"he don't have a blocky body, look at the movie version of him"*, *"not r15 tho"* and
  *"Robloxian 2.0 body for him."*
  Six rigid parts, no elbows or knees: the classic cylinder head; ONE torso piece, broad rounded
  shoulders tapering to the waist; ONE piece per arm (shoulder cap, arm, forearm, a mitten hand with
  a thumb); ONE piece per leg (thigh, shin, a chunky boot/foot). Soft, rounded shapes. Characters the
  films give another package (Man, Superhero) use that package's proportions. Robloxian 2.0 is
  the slim, smooth package: round shoulders that sit over the torso's corners, a shoulder line
  sloping from the neck, smooth limbs, straight trouser legs, mitten hands with a thumb nub.
  **Never sculpt clothing onto the body**: no vests, belts, pouches or cuffs that change its shape.
- **Clothing is texture**, drawn like a Roblox Shirt and Pants template: flat colour, drawn outlines,
  drawn shading lines and highlights, patterns (UCP digital camo), drawn pouches, straps, laces,
  patches and name tapes. `lib/rbxkit.js` draws these on canvases and maps them onto the body.
- **Only accessories are 3D**: hair, hats, caps, berets, bandanas, eyepatches, glasses, held
  weapons, wings and similar. They sit on the head or are held in the arm.
- **Faces are Roblox-style decals**: thin black brows, black eye shapes, a simple mouth; drawn on a
  canvas and mapped onto the head.
- R6 animation: each part is one rigid piece on one bone; limbs swing whole from shoulder and hip (`lib/clips_r6.js`).

## Character facts the user has corrected

- **Guest 1337 has WHITE skin.** Not peach, not tan: white (Roblox "White", about `#f2f3f3`).
- **Guest 1337 has no beard and no stubble.**
- Guest 1337 (movie): navy-blue hair swept up into a quiff; stern brows, black oval eyes, a flat
  mouth; UCP digital camo upper sleeves and trousers; a tan plate carrier drawn on the torso (flag
  patch, a "USM" name tape, MOLLE rows, pouches); sleeves rolled at the elbow (a white band with a
  black stripe), white forearms; dark grey gloved hands; dark olive laced combat boots.
- **Guest 1337's movie face** (measured from the user's still, head 1.2 studs across): black upright oval
  eyes about 0.09 x 0.16 studs, centres 0.32 studs apart, at the head's vertical middle; short
  straight brows (about 0.11 studs) just above each eye, slanting down toward the nose; a flat mouth
  about 0.24 studs wide, LOW on the head (0.24 studs above the bottom of the head).
- **Guest 666 is called "The Terrible"** in this game.
- Keep **Blox Watch** and **the Bacons** (Bacon General, Bacon Colonel, Bacon Soldiers, Jez).
- **The Bacons have WHITE skin and the Bacon hair** (the Roblox Pal Hair), and it must show: the
  user: *"Bacon have white skin and bacon for their hair like what they look like."* Build it with
  `A.hair('bacon')` (wavy rasher locks with a light streak, parted on the right, the fringe swooping
  across the forehead). No helmet or fur hat that hides it; the General's cap sits on top of it
  (`underHat: true` on the hair, `lift`/`wide` on the cap).
- **Jez's under-shirt is blue** (the tee under his leather jacket).

## Method: measure, don't eyeball

Guessing proportions from a picture went wrong three times. For every character with a reference:

1. **Measure the reference with code** (PIL): the head's width and bottom, the eyes, brows and
   mouth, the hair outline, the silhouette row by row (torso widths, arm angle, legs, boots), and
   colours relative to the white of the head (lighting differs from our renderer). Work in studs
   (head = 1.2 studs across). Write the numbers into the build script's comments.
2. Build, ship, then render front on: `node forlorn/forge/look.mjs NAME.glb OUT.png --pitch 0`.
3. Put it beside the reference: `python3 forlorn/forge/sidebyside.py REF OUT-render.png CMP.png
   HEAD_BOTTOM_Y FEET_Y` and fix every difference before showing the user.
4. Check the pieces: `forge/make.mjs` prints `# pieces:`; each of torso, arms, legs and head
   (+hair) must be its own piece, riding Head / UpperArm / the leg chain / the torso bones.

References live in `forge/references/`. Get canon details right the first time: skin colour,
hair colour and style, facial hair, outfit.

## The rest of the cast (built without film stills: check each against the films)

Shared kits: `lib/wear.js` (drawn clothing), `lib/faces.js` (decals), `lib/acc.js` (hair, hats,
hoods, glasses, eyepatch, chain, sword, pistol), `lib/cast.js` (the common build). Packages:
robloxian2 for most, `slim` for Daisy, Rose, Emily and Charlie, `man` for the Army Captain, Rich
Guy, the Bacon General and the Bacon Colonel, `superhero` for the Elite Guard.

| Character | Skin | Outfit as built | Accessories |
|---|---|---|---|
| Matt | light | red pullover hoodie, dark jeans, white sneakers | short brown hair |
| Daisy | peach | teal sweatshirt with a daisy, light jeans | long golden hair, ponytail |
| Rose | light | pink tracksuit with white stripes | pink bob with a bun |
| Army Captain | tan | olive dress uniform, gold buttons, ribbons, Sam Browne | peaked cap, moustache (decal) |
| Emily | light | lavender crop top, black jeans, boots | long black hair, fringe |
| Justin | brown | green hoodie, charcoal jeans | the hood up |
| Rich Guy | light | gold suit, black shirt, gold tie | slicked hair, gold shades, gold chain |
| Charlie | WHITE (Guest's daughter) | white tee, open denim jacket | long navy hair, glowing cyan Astral eyes |
| Jez | WHITE (a Bacon) | black leather jacket over a blue motorcycle tee | Bacon hair |
| Bacon General | WHITE | Empire-blue tunic, red sash, gold epaulettes, black boots | Bacon hair, peaked cap on top, pistol |
| Bacon Colonel | WHITE | grey greatcoat with fur, dark uniform | Bacon hair, eyepatch (left), scar |
| Elite Guard | light | black armour, red sash | black bandana, scar (right eye), sword |
| Blox Watch | pitch black | black hoodie with gold lightning | hood up, glowing yellow eyes |
| Bacon Soldier | WHITE | Empire-blue tunic, black trousers | Bacon hair |
