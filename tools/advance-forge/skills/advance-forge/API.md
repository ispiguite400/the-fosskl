# Advance Forge: API reference

Build scripts run **inside the SculptFree page**, after `sculptkit.js` and `clay.js` are loaded. You
get two globals:

- `M`: sculptkit. The camera, brush strokes and scene operations.
- `M.clay` (usually `const C = M.clay`): clay forms. Signed-distance shapes blended into one
  surface, folds, pleats, painting and shading.

Every step file passed to `forge.mjs build` is joined into **one script**, so a `const` in
`body.js` is visible in `head.js`. Declare each name once. Log progress with
`console.log('# ...')`; lines starting with `#` are printed in the terminal.

**Units and axes**: metres. Feet at y = 0, facing **+Z**, the character's left at **+X**. The app
and the game both use this frame.

---

## Clay forms (`M.clay`, alias `C`)

Forms are queued, then `C.build()` turns everything queued into one watertight mesh.

Two globals shape each form as it's queued:

- `M.tag`: the part name, used by paint.
- `M.k`: the blend radius in metres. 0 gives a hard join; 0.02–0.07 gives soft flesh.

The usual helper is `const T = (tag, k) => { M.tag = tag; M.k = k; }`.

| Call | Shape |
|---|---|
| `C.ell(c, [rx, ry, rz], rotDeg?, o?)` | Ellipsoid at c with radii r. `rotDeg` is [x, y, z] Euler degrees |
| `C.limb(a, b, ra, rb?, o?)` | Tapered capsule from a (radius ra) to b (radius rb). **The ends are round**, so a large radius makes a ball |
| `C.box(c, [hx, hy, hz], rnd, rotDeg?, o?)` | Box with half-sizes h and edge rounding `rnd`. Use it for belts, plates, pouches, soles and anything flat |
| `C.cyl(c, r, halfH, rnd, rotDeg?, o?)` | Capped cylinder along the local Y axis |
| `C.torus(c, R, r, rotDeg?, o?)` | Ring: R is the ring radius, r the tube radius. Local Y is its axis |
| `C.basis(ex, ey, ez)` | A rotation from three world axes. Pass it as `o.R` to orient a box along an object (the rifle does this) |

Options `o` for any form:

| Key | Values | Meaning |
|---|---|---|
| `mode` | `'union'` (default), `'subtract'`, `'intersect'` | Subtract and intersect act on **everything already queued in this build** |
| `k` | metres | Override `M.k` for this form |
| `tag` | string | Override `M.tag` for this form |
| `grow` | metres | Dilate the form. A garment is the body grown by 4–8 mm |
| `R` | a `C.basis(...)` result | Orientation, instead of `rotDeg` |

### Building

| Call | Does |
|---|---|
| `C.build(voxel, smooth, obj?)` | Meshes the queue. `voxel` is the grid size: 0.004 for a body, 0.002 for a head, 0.0015–0.002 for props. `smooth` is 1–2 passes. Builds into `obj` (default: the first object). With `C.autoPaint` set, the result is painted |
| `C.newObject(name)` | A new empty object to build a separate piece into: a head, hair, a weapon, a hat |
| `M.joinAll()` | Merges every object into one mesh. Separate pieces stay separate pieces, and ride one bone when rigged |
| `C.autoPaint = (tag, x, y, z, nx, ny, nz) => [r, g, b]` | Colour per vertex, from the form it came from (0–1 sRGB) |
| `C.paint(fn, obj?)` | Paint an existing object with the same kind of function |
| `C.noise(x, y, z)`, `C.fbm(x, y, z, octaves)` | Smooth value noise in 0..1, for tonal drift, camo and grime |
| `C.bakeShading({ ao, dark, light, floor, blur })` | Bakes ambient occlusion and crease shading into the colours. Run it last. Defaults: ao 1.1, dark 5, light 2.5, blur 2. Use `floor: 3` for contact shadow at the feet |

### Cloth

| Call | Does |
|---|---|
| `C.fold(a, b, t, th0, th1, o)` | A ridge that wraps **around** the limb axis a→b at parameter t (0..1), from angle th0 to th1. Angle 0 is the front (+Z), and +π/2 points to `cross(axis, front)`. It sits on the real surface of the forms queued so far |
| `C.pleat(a, b, th, o)` | A ridge that runs **along** the limb at angle th, from `o.t0` to `o.t1` |
| `C.folds` | Every fold and pleat made so far (`pts`, `dirs`, `ax`, `r`, `along`); the brush pass reads it to cut valleys |

Options for folds and pleats:

| Key | Default | Meaning |
|---|---|---|
| `r` | 0.016 (fold) / 0.012 (pleat) | Ridge thickness |
| `h` | 0.0045 / 0.005 | How far it stands proud of the surface |
| `tilt` | 0 | Metres the fold slants along the axis across its length (folds only) |
| `sag` | 0 | Dip in the middle (folds only) |
| `n` | 11 / 10 | Samples along the ridge |
| `reach` | 0.2 / 0.3 | How far out to look for the surface. Keep it short so the ridge can't jump to another limb |
| `tag` | `M.tag` | Paint tag |
| `k` | 0.012 / 0.01 | Blend into the cloth |

The helpers `C.fieldAt`, `C.surfOut(c, dir, reach)` and `C.surf(from, to)` probe the queued forms;
use them to put anything exactly on the surface. `C.v` has the vector helpers `sub`, `addv`, `mul`,
`dot`, `cross`, `norm` and `lerp`.

`C.pivotRotate(obj, pivot, [x, y, z])` turns a whole object about a point. The soldier's head group
looks down 7° this way before joining.

---

## Brush strokes (`M`)

Strokes go through the app's **real stroke engine**, exactly as if drawn with a mouse. Point the
camera first, then stroke.

| Call | Does |
|---|---|
| `M.at(point, dir, halfHeight)` | Orthographic camera centred on `point`, looking back along `dir` (from the side you want to work on), showing `2 × halfHeight` metres vertically. Get close: 0.08–0.3 |
| `M.front(t, h)`, `M.back`, `M.side` (from +X), `M.left` (from −X), `M.top`, `M.under` | Preset views |
| `M.wstroke(brush, [[x, y, z], ...], radius, strength, o?)` | A stroke through **world points** (projected into the current view). Radius in metres. **Use this one** |
| `M.stroke(brush, [[u, v], ...], radius, strength, o?)` | The same, with points in the view plane (u = camera right, v = camera up) |
| `M.dab(brush, [u, v], radius, strength)` | One stamp |
| `M.opts({...})` | Set app settings before stroking (below) |
| `M.pull(anchorFn, delta, radius, steps)` | Move-brush pulls in alternating views, to drag out a limb (the old sphere method; clay forms are better) |

Stroke options: `invert: true` (Ctrl: dig instead of add), `step` (pixels between input events,
default 3), `hold` (extra events at the end).

A stroke that starts off the surface slides along its path to the first point that hits. One that
never hits is logged as `MISS` and printed by the build.

**Brushes**: `add`, `clay`, `claystrips`, `draw`, `inflate`, `blob`, `crease`, `layer`,
`trimdynamic`, `trimnormal`, `smooth`, `flatten`, `fill`, `scrape`, `pinch`, `move`, `snakehook`,
`nudge`, `rotate`, `paint`, `mask`.

Typical detail strokes:

| Purpose | Brush | Radius (m) | Strength |
|---|---|---|---|
| Fold valley, seam, stitching | `crease` | 0.003–0.008 | 0.3–0.5 |
| Blend facial forms | `smooth` | 0.015–0.03 | 0.2–0.35 |
| Nasolabial fold, eyelid edge | `pinch` + `crease` | 0.005–0.01 | 0.15–0.3 |
| Brow mass, cheek | `clay` | 0.008–0.02 | 0.15–0.3 |
| Flat armour face | `trimnormal` | 0.02–0.05 | 0.5–0.7 |

**Settings for scripted work** (set once before a brush pass):

```js
M.opts({ dyntopo: false, symmetryX: true, strokeSmoothing: 0, pressureRadius: false,
         pressureStrength: false, falloff: 'smooth', autoSmooth: 0.15 });
```

- `dyntopo: false`: on a dense clay mesh, dynamic topology only slows strokes down.
- `symmetryX`: mirrored strokes (faces); turn it off for asymmetric kit.
- `falloff`: `'smooth'`, `'soft'`, `'sharp'`, `'linear'`, `'sphere'` or `'constant'`.
- `detailMode: 'constant', detailSize: 0.02`: for dyntopo work, a fixed triangle size.

---

## Scene and mesh operations (`M`)

| Call | Does |
|---|---|
| `M.app` | The SculptFree app: `M.app.scene.objects`, `M.app.set(key, value)`, `M.app.rigAddHumanoid()` and more |
| `M.obj()` | The first object |
| `M.tris()` | Live triangle count |
| `M.log` | Missed strokes |
| `M.snap()` | A data URL of the canvas right now |
| `M.symmetrize()` | Copies +X onto −X |
| `M.remesh(resolution, smooth)` | Voxel remesh (even triangles) |
| `M.smoothMesh(n)` | Relaxes the whole mesh n times |
| `M.fix()` | Fix glitches: inside-out faces, spikes, slivers |
| `M.extreme(dir, pred?)` | The vertex furthest along `dir` |
| `M.section(y)` | x/z extents of the mesh at a height, to measure proportions |
| `M.app.set('cavity', 0.1)` | Shading settings for the renders |
| `M.app.set('matcap', 'white')` | |
| `M.app.set('bgTop', '#8a8f98')` | |

---

## Command line

| Command | Does |
|---|---|
| `forge.mjs doctor` | Checks the environment. Run it first |
| `forge.mjs build a.js b.js --out DIR --name N [--close "yaw,pitch,y,halfH;..."] [--target 150000] [--load start.sculpt] [--no-save]` | Build, render, save |
| `forge.mjs render FILE --out DIR [--close ...] [--cavity 0]` | Render any `.sculpt` / `.glb` / `.obj` / `.stl` / `.ply` |
| `forge.mjs export FILE.sculpt --out DIR [--target N] [--format glb\|obj\|stl\|ply\|roblox]` | Reduce and write a model file |
| `rig.mjs MODEL --out DIR --joints joints.json [--target 60000]` | Fit, bind, pose sheet, rigged GLB |
| `animate.mjs RIGGED.glb --out DIR [--clips my.js] [--only walk,idle] [--frames 6] [--bake]` | Clip strips, and the baked GLB |

Close-up spec: `yaw,pitch,y,halfHeight`. Yaw 0 faces the model's front, 1.57 its left side and
3.14 its back. Examples:

| Close-up | Spec |
|---|---|
| Face | `0.4,0.05,1.6,0.16` |
| Torso | `0.5,0.08,1.2,0.4` |
| Legs | `0.6,0.1,0.45,0.5` |
| Feet | `0.6,0.2,0.15,0.25` |
