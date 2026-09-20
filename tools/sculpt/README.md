# SculptFree

A digital sculpting app that runs in one HTML file, on a phone or a computer.
Open it, sculpt, export. Nothing is locked, watermarked or limited —
**import and export are free, in every format, at any triangle count.**

The brushes **add material**. Draw on a ball and the surface rises; go over it
again and it thickens; keep dragging and it pulls out a horn — and the new
volume gets its own triangles as it grows, so nothing is ever stretched thin.

Set up for **Roblox** out of the box: you start with a **1,280-triangle** ball
and the export budget is **2,000**, so sculpt as dense as the shape needs and
**Export → Roblox** writes an OBJ reduced to fit. The count is on screen the
whole time.

```
tools/sculpt/sculpt.html      ← the whole app; open it in a browser
```

No server, no install, no network. Double-click the file, or serve the folder
if you prefer. Needs a browser with WebGL 2 (anything current).

---

## The screen

Almost all of it is your model. Everything else is one tap away.

**Held vertically (a phone):** brushes run along the bottom in a row you can
swipe, the two sliders sit just above them, and the model gets the whole
middle.

**On a computer or sideways:** the brushes move to a column down the left
edge and the sliders sit along the bottom.

| Where | What |
| --- | --- |
| Top left | **☰** — everything: files, shapes, remesh, settings, help |
| Next to it | Triangles now, and what it exports as — tap it to change either |
| Top right | Undo, redo |
| Brush row | The ten brushes you use most, plus one button for the other eleven |
| Near the sliders | Mirror on/off, frame the model, and Look (material, wireframe) |
| Bottom | **Size** and **Strength** — the only two numbers you change often |

Drag on the model to sculpt. Drag off it — or two fingers, or right-drag — to
orbit. That is the whole interface.

## Sculpting

- **Left drag** sculpts · **Shift** smooths · **Ctrl** inverts the brush
- **Right drag** orbits · **Middle drag** pans · **Wheel** zooms
- **Shift + wheel** brush size · **Ctrl + wheel** strength
- One finger sculpts, two fingers orbit and pinch, three fingers pan
- `A` Add, `S` smooth, `T` / `E` the trims, `C` paint, `M` mask
- `[` `]` size, `{` `}` strength, `X` `Y` `Z` mirror, `D` adding on/off,
  `F` frame, `W` wireframe, `?` for the full list

Twenty-one brushes: **add**, clay, clay strips, draw, inflate, blob, crease,
layer, **trim dynamic**, **trim normal**, smooth, flatten, fill, scrape, pinch,
move, snake hook, nudge, rotate, paint and mask. Symmetry works in the object's
own space, so it keeps working after you move or rotate the object.

### Add — the one you start with

**Add** (`A`) is the default brush and the reason the tool feels like clay
rather than rubber. Each stamp raises the surface to a plateau a little above
the local average, so:

- one pass lays a ridge with a soft edge,
- a second pass over the same place makes it thicker,
- a long drag pulls the material out with you — a horn, a limb, a branch,
- **Ctrl** digs exactly the same shape out instead.

Because **dynamic topology** is on, the volume you add arrives with its own
triangles: the count climbs as the form grows and the triangles stay near the
detail size you set, instead of the mesh being stretched to cover the new
shape. Switch it off (`D`) and every brush can only push the triangles that
are already there — useful for keeping a fixed low-poly mesh, and obvious the
moment you try to pull anything out of it.

Grab-style brushes (**move**, **snake hook**) drag the surface with the
pointer, and with adding on the region they pulled through is re-tessellated
when you let go, so a pull does not leave the mesh thin either.

Adding respects masks, and stops at the **Limit** in Brush settings (150,000
by default) — the counter turns red there, because that is the number that
stops the brushes adding, not the export budget.

### The trims

Both shave the surface flat against a plane, and both only ever *remove*
material (hold Ctrl to fill instead). Unlike Flatten, they hold full strength
across the brush instead of easing off at the rim, so the patch lands on the
plane and meets the untouched surface at a crisp edge — which is what makes
them the tools for armour plates, cut stone and blocky props.

- **Trim Dynamic** (`T`) takes its plane from the surface under the brush and
  recomputes it as you go, so it facets a form while following its shape.
- **Trim Normal** (`E`) locks the plane where you start the stroke, so one
  drag cuts a single clean flat face. The plane sits a fixed depth below the
  point you started from — that depth is what one pass shaves off — so it
  works even when you start on the high point of a curve.

Neither is auto-smoothed, whatever the Smoothing setting says: rounding the
edge off afterwards would undo the face you just cut.

## Stencils

Any brush can work through a greyscale **stencil** instead of a plain round
dab: the brightness of the image decides how hard the brush bites, so a photo
of gravel stamps gravel and a drawing of a rivet stamps a rivet.

☰ → **Brush settings** → *Stencil*:

- Eight built-in stencils — dirt, gravel, cracks, scratches, bumps, weave,
  rivet, square — generated in code, so there is nothing to download.
- **Load image…** takes any PNG or JPEG from your phone or computer.
  Brightness becomes strength, transparency counts as nothing, and the result
  is kept for next time. **Invert** makes a light-on-dark image work too.
- **One stamp per press** places a single dab wherever you tap, which is how
  rivets, panels and logos go on. Otherwise the pattern repeats along the
  stroke.
- **Follow the stroke** turns the stencil to face the direction you are
  drawing; **Random turn** spins it each stroke so a pattern does not tile
  visibly.

A stencil turns auto-smoothing off for that stroke: relaxing the surface
behind the stamp would rub the pattern straight back out.

## Presets

☰ → **Presets** holds ready-made setups — Block out, Refine form, Smooth pass,
Hard surface, Panel cut, Sharp crease, Rocky detail, Rivets, Scratches,
Cracked, Dirt paint, Base colour — each one a brush plus its size, strength,
falloff, spacing, smoothing, stencil, stamp mode and paint colour.

Tap one to apply it. **Save the current brush** keeps whatever you have dialled
in under a name of your own, and saved presets live in the browser's storage
alongside your settings.

## Texture and paint

Painting happens on the model (fast, no seams, no unwrap to think about) and
☰ → **Texture** turns it into a real image:

- A **live preview** of the baked texture, with how much of the image the model
  uses.
- **Image size** 512, 1024 or 2048, and a **Creases** slider that darkens the
  recesses the way they look on screen.
- **Roblox: mesh + texture** — an OBJ reduced to the budget plus the PNG.
- **OBJ + texture** — `.obj`, `.mtl` and `.png`, which Blender, Unity and
  Godot all open with the texture already attached.
- **GLB with the texture inside** — one file, image embedded.
- **Just the image** — the PNG on its own.

The unwrap is a **box projection**: every triangle goes to whichever of the six
axis directions it faces, and the six charts are packed into one atlas with a
gutter between them. Vertices on a chart boundary are duplicated, so the
triangle count never changes — only the vertex count. The baked pixels are
grown outwards past the edge of each chart, so filtering never pulls the
background in across a seam.

The PNG is written by the app itself — deflate, filters and all — because a
single HTML file cannot lean on a library.

## Roblox

Roblox refuses a MeshPart over **10,000 triangles** — but that is a ceiling,
not a target. A prop in a real game is usually 1k–4k, so that hundreds of them
can be on screen at once. The app is set up for that:

- You start with a **1,280-triangle** sphere and a **2,000** export budget.
  The chip at the top reads `1.3k / 2k` while you are under it and
  `12k → 2k` once you are over — the second number is what Export writes.
- **Sculpt as dense as the shape needs.** The brushes add triangles as they
  build; the count only has to come down when you export, and it comes down on
  a copy.
- **Subdividing warns you** before it quadruples the count past your budget.
- **☰ → Export → Roblox** writes an OBJ reduced to fit, and never goes over
  Roblox's 10,000 even if you raised the budget. Each object comes out as its
  own MeshPart, and your sculpt keeps its detail.
- **☰ → Texture → Roblox: mesh + texture** does the same and bakes the paint
  into a PNG beside it, ready to upload as the MeshPart's `TextureID`.

**Budgets** live in ☰ → Brush settings: 1k, 2k, 5k, 10k, plus 50k and 250k for
other engines. Picking one sets what Export reduces to, how coarse the new
triangles are, and the starting density of new shapes — it never stops the
brushes adding.

| Budget | You get | Good for |
| --- | --- | --- |
| 1k | 1,280-triangle start, chunky strokes | small props, lots of them |
| 2k *(default)* | 1,280-triangle start, normal strokes | a normal Roblox prop |
| 5k–10k | 5,120-triangle start, finer strokes | a detailed hero mesh |
| 50k+ | dense start, fine strokes | other engines, or an LOD chain |

Then in Studio: **Model → Insert → Insert 3D Model** (or right-click a
MeshPart → set its MeshId) and pick the `.obj`. Roblox is Y-up like this app,
so the orientation carries over; resize the MeshPart in Studio rather than
worrying about scale here.

Two things worth knowing: Studio's mesh importer ignores vertex colour (so the
Roblox export leaves it out to keep the file small — colour a MeshPart with
its **Color** property or a texture), and one MeshPart is one mesh, so build a
character as several objects and export them separately.

## Getting a model into another engine

1. Sculpt freely with dynamic topology on.
2. **Remesh** (☰ → Remesh) when the surface gets uneven. This rebuilds it as
   an even grid of triangles — watertight and manifold.
3. **Reduce triangles** to your budget. It collapses the edges that change the
   shape least, so the silhouette survives. Export at 100%, 50% and 20% for an
   LOD chain.
4. **Export GLB**. One self-contained binary with geometry, normals, vertex
   colours and a PBR material.

In Three.js:

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

new GLTFLoader().load('models/hero.glb', (gltf) => {
  gltf.scene.traverse((n) => { if (n.isMesh) n.castShadow = true; });
  scene.add(gltf.scene);
});
```

If you painted the model, set `material.vertexColors = true` — the exporter
writes vertex colours as `COLOR_0`.

**Axes and units.** SculptFree, glTF, Three.js and Unity are all Y-up, so
leave the up axis alone for those. Pick Z-up for Blender, 3ds Max or Godot.
The scale multiplier covers engines working in centimetres (×100) or
millimetres (×1000).

## Formats

| Format | In | Out | Notes |
| --- | --- | --- | --- |
| OBJ | ✓ | ✓ | What Roblox reads. Quads and n-gons are triangulated; vertex colours supported |
| STL | ✓ | ✓ | Binary and text; triangle soups are welded on import so they can be sculpted |
| PLY | ✓ | ✓ | Text and both binary byte orders; the best format for vertex colour |
| glTF / GLB | ✓ | ✓ | Node transforms baked in; 16- or 32-bit indices as needed |
| `.sculpt` | ✓ | ✓ | The project: exact topology, masks, colours, transforms, camera |

Drag any of them onto the window to open it. There is no size limit beyond
your machine's memory.

Your work never leaves your computer. The recovery copy (every two minutes)
lives in your browser's own storage, and projects are files you keep.

---

## How it is built

No dependencies at all — not even Three.js. That is what makes it one portable
file that works offline.

| File | What it does |
| --- | --- |
| `src/01-core.js` | Vector/matrix maths, growable typed arrays, geometry predicates |
| `src/02-mesh.js` | The sculptable mesh: adjacency, a uniform grid for picking and brush queries, welding, non-manifold repair |
| `src/03-topology.js` | Edge split, collapse and flip; dynamic topology; Loop subdivision; quadric decimation; smoothing |
| `src/04-primitives.js` | Starting shapes |
| `src/05-remesh.js` | Voxel remesh: signed distance field, then manifold dual contouring |
| `src/06-io.js` | Every importer and exporter, plus the project container |
| `src/07-texture.js` | Box-projection unwrap, the vertex-colour bake, and a PNG writer with its own deflate |
| `src/08-scene.js` | Objects, transforms, and memory-budgeted undo history |
| `src/09-alpha.js` | Brush stencils: the built-in patterns, loading an image, sampling |
| `src/10-preset.js` | Brush presets, built-in and saved |
| `src/11-brush.js` | The brushes and the stroke engine |
| `src/12-camera.js` | Orbit camera, screen-space ray casting |
| `src/13-render.js` | WebGL2 renderer with procedurally generated matcaps |
| `src/14-boolean.js` | Join, and union / subtract / intersect through the distance field |
| `src/15-widgets.js` | DOM helpers, icons, sheets and dialogs |
| `src/16-app.js` | The app: interface, input, commands |

`index.html` loads the modules for development; `node build.js` inlines
everything into `sculpt.html`.

A few decisions worth knowing about:

- **Brush size is in screen pixels**, converted to model units per stamp, so a
  brush covers the same part of the screen whether you are zoomed in on an ear
  or out at the whole figure — and it behaves the same on a scaled object.
- **Framing fits the part of the canvas you can actually see**, using the
  model's projected extent along both screen axes. Fitting the vertical field
  of view alone (or the bounding sphere) either runs a model off the sides of
  a phone held vertically or leaves a third of the screen empty.
- **Stroke spacing does not change how deep a stroke cuts.** Stamps are laid
  every `spacing × radius` along the path and their strength is scaled to
  match, so spacing is a quality control, not a strength control.
- **Dynamic topology only ever splits a triangle's longest edge and collapses
  its shortest**, then flips the diagonals that leave a badly shaped triangle
  behind. Without those three rules a long session slowly fills the surface
  with slivers, which read as speckles under cavity shading.
- **Adding material and the export budget are two different numbers.** The
  budget is what Export reduces a *copy* to; the Limit is where dynamic
  topology stops adding. Tying them together was a mistake worth naming: with
  a 2,000-triangle cap the brushes could only push the triangles the mesh
  already had, so sculpting felt like stretching rubber instead of adding
  clay. Now you sculpt at whatever density the shape needs and the count comes
  down on export.
- **A grab stroke re-tessellates what it pulled.** Move and Snake Hook drag
  the triangles they captured, which leaves the surface thin behind them; with
  adding on, the region between where the pull started and where it ended is
  rebuilt when you let go.
- **Undo is budgeted by memory, not by step count.** A plain stroke records
  only the vertices it touched; anything that changes topology stores a
  snapshot, because vertex indices move.
- **The remesher is manifold by construction.** Dual contouring normally puts
  one vertex in each cell, so where a surface nearly touches itself two sheets
  share a vertex and produce an edge with four faces. Here a cell's crossing
  edges are grouped into sheets by which of them meet on each cube face —
  a decision both cells sharing that face make identically — so every mesh
  edge ends up with exactly two faces.

## Tests

```bash
node test/topology.test.mjs     # 81   mesh invariants, split/collapse/flip, subdivide, decimate
node test/remesh.test.mjs       # 76   watertight and manifold output, volume, colour transfer
node test/io.test.mjs           # 120  round trips for every format, GLB structure, transforms
node test/brush.test.mjs        # 323  every brush, adding vs stretching, symmetry, masking, undo
node test/camera.test.mjs       # 18   projection, framing, ray casting
node test/boolean.test.mjs      # 51   union / subtract / intersect against analytic volumes
node test/texture.test.mjs      # 362  PNG writer, unwrap, bake, textured export, stencils, presets
node build.js && node test/browser.test.mjs   # 288 end-to-end in a real browser
node test/shots.mjs             # renders the screenshots in test/screens
```

1,319 checks in total. Some of them are worth naming, because they are the
ones that catch a regression you would otherwise ship:

- **Brushes have to add, not stretch.** The same pull is run with dynamic
  topology on and off: adding must bring triangles with it, reach further,
  and leave the longest edge near the detail size rather than several times
  it. The browser suite does the same thing through real mouse input and
  checks the horn is closed and manifold.
- **The PNG writer is decoded by Node's own zlib**, chunk CRCs and all, and
  compared pixel for pixel. A file the rest of the world cannot open is not a
  file.
- **Booleans are checked against the analytic volume** of two overlapping
  spheres — union, subtract and intersect all land within 0.4%.
- **Every export goes through the real download path** in the browser and is
  re-imported in Node to verify it.
- **The phone layout is measured, not eyeballed**: at 412×915 nothing may sit
  off either edge, no button may be under 22px tall, and no sheet may run past
  the bottom of the screen.

Every mesh test runs a structural audit: adjacency agreeing with the triangle
list, no triangle referencing a dead vertex, no edge with more than two faces,
live counts matching, no non-finite coordinates.

## Known limitations

- The unwrap is a box projection, not a seam-aware one. It is automatic and
  always works, but a hand-unwrapped model uses its texture space better. If
  you need that, export the GLB and unwrap in Blender.
- Painting is on the model, so how fine the paint can be depends on how many
  triangles are under the brush. Subdivide (or ☰ → Texture → *More paint
  detail*) before painting small marks, or paint after remeshing.
- A voxel remesh of a shape with a pole (a sphere, a cone) can leave a handful
  of zero-area triangles where several cells place their vertex at exactly the
  same point. They are invisible and harmless, and the result is still
  watertight and manifold.
- Remeshing and decimating block the interface while they run — a second or
  two at the default settings, longer at high resolution. The dialog tells you
  the voxel count before you commit.
- No sculpt layers and no multiresolution levels; dynamic topology and
  remeshing cover the same ground differently.
- Roblox's own importer, not this app, decides what it accepts. The 10,000
  triangle ceiling is current at the time of writing; if that changes, set
  your own budget in Brush settings.
