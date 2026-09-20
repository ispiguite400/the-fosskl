# SculptFree

A digital sculpting app that runs in one HTML file, on a phone or a computer.
Open it, sculpt, export. Nothing is locked, watermarked or limited —
**import and export are free, in every format, at any triangle count.**

The brushes **add material**. Draw on a ball and the surface rises; go over it
again and it thickens; keep dragging and it pulls out a horn — and the new
volume gets its own triangles as it grows, so nothing is ever stretched thin.

Build from shapes as well as by sculpting: drop in a sphere, box or cylinder,
place it with the move/turn/resize handles, and weld it into the model.

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
| Next to it | **+** — add a shape to the sculpt |
| Next to that | Triangles now, and what it exports as — tap it to change either |
| Top right | Undo, redo |
| Brush row | The ten brushes you use most, plus one button for the other eleven |
| Near the sliders | The move/turn/resize handles, mirror, frame the model, and Look |
| Bottom | **Size** and **Strength** — the only two numbers you change often |

Drag on the model to sculpt. Drag off it — or two fingers, or right-drag — to
orbit. That is the whole interface.

## Sculpting

- **Left drag** sculpts · **Shift** smooths · **Ctrl** inverts the brush
- **Right drag** orbits · **Middle drag** pans · **Wheel** zooms
- **Shift + wheel** brush size · **Ctrl + wheel** strength
- One finger sculpts, two fingers orbit and pinch, three fingers pan
- `A` Add, `S` smooth, `T` / `E` the trims, `C` paint, `M` mask
- `V` the move/turn/resize handles · `Shift+A` add a shape
- **Size** runs 8 to 95 and **Strength** up to 1. Both are capped on purpose:
  a wider brush averages over so much surface that a stroke drags the whole
  form around, and past full strength a single stamp moves the surface
  further than the brush is wide. The brush is also capped against the model
  itself, so zooming out cannot make it wider than the thing you are making.
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

**Detail** is measured in screen pixels (12 by default): new triangles come
out about that big on screen, whatever size the brush is. Smaller means finer
work and more of them.

### What keeps a stroke from going wrong

Every rule here is in the code because of a specific way the tool used to
break, and each one has a test that fails if it is taken out.

**Where a stroke is allowed to go**

- **One stroke can move a vertex about one brush radius, and no further.** A
  brush that builds up measures each stamp against the surface the last stamp
  left, so stamps landing on the same few vertices — a slow drag, a tap and
  hold, a stroke that doubles back — used to lift them again and again until
  they shot out as a spike. Lift your finger and the next stroke starts
  again, so material still builds up pass after pass.
- **A vertex the refinement creates mid-stroke inherits where its neighbours
  started.** Its birthplace is already part-way through the stroke, so
  counting from there would hand every new generation of vertices a fresh
  allowance — and refinement makes new ones every stamp, so a stroke could
  creep on for ever.
- **One stamp can only move the surface a few triangle widths.** Further than
  that and the refinement cannot describe what the stamp left: a cliff where
  the brush lifts, a fold where it pushes sideways. A stroke lays several
  stamps per brush width, so the movement simply accumulates over them.
- **Stamps are spaced along the path your finger took on screen.** Spacing
  them along the surface fed back on itself: a deepening dent lengthened the
  surface path, which laid more stamps, which dug deeper. One measured stroke
  of Crease turned into five hundred stamps and twenty seconds of frozen
  screen.

**What the brush can find and refine**

- **The lookup grid never loses geometry, wherever it has moved to.** This
  was the big one. The grid dropped any triangle that had moved outside the
  box it was built for, so once a few passes of Add had grown the model past
  that box, the brush could not find the bump it had just built: strokes
  stopped biting, refinement stopped refining, and a tap went straight
  through the bump and sculpted the far side of the model. Traced stamp by
  stamp, one stroke's third stamp landed at z = −0.449 on a model whose
  surface was at z = +0.5. Geometry outside the box now goes into the nearest
  edge cells and the grid rebuilds itself around the new shape.
- **A vertex index is not a lasting name for a vertex.** Refinement collapses
  vertices and hands their slots to new ones, so everything that remembers a
  vertex across a stroke carries its serial number too. Without that, strokes
  pulled freshly created vertices back towards a dead vertex's starting point
  — fins standing off the surface, from geometry that had never been touched.
- **Detail is measured in pixels, and follows the brush down when the brush
  is smaller.** A fraction of the brush means microscopic triangles for a
  small brush; a flat twelve pixels means a ten-pixel brush has a single
  vertex to push on and leaves no mark at all. Following the brush down to a
  floor of three pixels keeps a stamp's cost about the same at every size,
  because it is the ratio of the two that decides how many triangles a stamp
  covers.
- **A brush can always refine what it sits on.** A triangle bigger than the
  brush has its longest edge running right past it, so a rule of "the split
  has to land inside the brush" refuses to refine at all — and then the brush
  drags one lone vertex of a huge triangle and leaves a star of stretched
  fins. Instead a split may land up to its own edge length away, so a big
  triangle can halve even though the cut falls outside, and the allowance
  shrinks with the pieces so the work funnels in towards the brush.
- **Vertices the refinement has not reached yet move less.** Refinement is
  rationed per stamp, so on a coarse model the first stamps land while parts
  of the footprint still carry edges many times the detail size. Such a
  vertex moves in proportion to how refined it is, and catches up over the
  next stamps.

**What symmetry costs**

- **A stamp that lands on a mirror plane is only laid once.** A brush sitting
  on the plane produced the same stamp twice, and with all three mirrors on
  up to eight times, so it cut eight times as deep as asked.
- **One stamp's refinement budget is shared between the mirrors.** Each
  mirrored pass refines its own copy of the region, so three mirrors used to
  mean eight times the work — two seconds of frozen screen for one stroke at
  a fine detail setting. The mirrors take a few more stamps to catch up
  instead.

**And when the stroke ends**

- **A stroke settles when you lift your finger.** The last stamp stretches
  the surface and then nothing refines it, so one refinement pass runs over
  the region the stroke covered. A brush only a couple of triangles wide also
  leaves the surface faceted; a light relax turns that into a bump. The trims
  and anything working through a stencil are left alone, where the crisp edge
  is the point.
- **Any needle left behind is pulled back in.** Bounded to what the stroke
  touched, and only for shapes far sharper than anything anyone makes on
  purpose — a cone's apex scores 2.5 on the measure used, and the repair
  starts at 3.2.

And when something does go wrong: **☰ → Fix glitches** pulls needle vertices
back onto the surface, relaxes the slivers a torn surface is made of, drops
triangles that have collapsed to nothing, and closes hairline splits. It is
one undo step, so you can always look and change your mind.

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

## Building with shapes

A model is usually several shapes before it is one shape. Tap **+** in the top
bar (or ☰ → Add a shape), pick a sphere, box, cylinder, cone, torus, capsule
or plane, and choose:

- **Add to this sculpt** — the shape drops in beside what you are working on,
  sized to about half of it and touching its side, and the move/turn/resize
  handles come up straight away. Place it, then:
  - **Union** welds it into the sculpt as one continuous surface, which is
    what you want for a body, a limb or a horn. It runs through the same
    distance field the booleans use, so the result is watertight.
  - **Subtract** cuts the shape out of the sculpt — a socket, a window, a
    bite, a bolt hole.
  - **Intersect** keeps only the part where the two overlap, which is how you
    trim a form down to a box, a cylinder or a sphere.
  - **Join** puts it in the same mesh without welding — instant, and right
    when the parts do not need to merge (a bolt sitting on a plate).

  All four are on the strip while the shape is still loose, and in
  ☰ → Combine for any two objects at any time.
- **Separate object** — keep it as its own object, to sculpt and export on its
  own. One Roblox MeshPart is one object, so a character built as head, body
  and arms exports as three parts.

### The handles

Tap the **handles button** down the right edge (or press `V`) to get them for
the selected shape. Three modes, from the strip along the bottom:

| Mode | What you drag |
| --- | --- |
| **Move** | an arrow to slide along one axis, or the ball in the middle to slide it across the screen |
| **Turn** | a ring to turn around that axis. Rings you are looking at edge-on fade out, because there is nothing to drag there |
| **Size** | a square to stretch one axis, or the middle to resize evenly |

- **Tap any shape** to work on that one instead — that is how you select.
- The handles keep the same size on screen however far you zoom, and they
  follow the shape's own axes, so stretching does what it looks like.
- Turning and resizing happen about the middle of the shape, not its origin.
- Every drag is one undo step, named Move, Turn or Resize.
- The sliders button on the strip opens exact numbers, snapping (15° and 5%
  steps), duplicate, reset, freeze the transform into the mesh, centre the
  origin, and delete.

While the handles are up the brushes are put away, so a drag can never
accidentally sculpt.

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
| `src/15-gizmo.js` | The move/turn/resize handles: where they are, what a tap hits, what a drag does |
| `src/16-widgets.js` | DOM helpers, icons, sheets and dialogs |
| `src/17-app.js` | The app: interface, input, commands |

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
  every `spacing × radius` along the path your finger takes *on screen*, and
  their strength is scaled to match, so spacing is a quality control, not a
  strength control. Measuring that path along the surface instead is what let
  a deepening dent ask for more and more stamps.
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
- **A needle is measured against how wide its ring is, not how finely that
  ring is divided.** The first measure — distance from the middle of the ring
  against the spacing between the ring's own vertices — grew with the
  resolution: a cone's apex scored 3.3 at detail 2 and 8.0 at detail 5, so
  any threshold that caught real needles blunted fine cones. Against the
  ring's width the same apex scores 2.5 at every resolution, a hard edge
  0.75, a box corner 0.98, and a vertex pulled half a radius out of a sphere
  7.1. The threshold sits at 4, in the gap. That is what made repair safe
  enough to run at the end of every stroke, on the region the stroke touched;
  prevention still does most of the work, and Fix glitches is there for a
  model that arrives broken.
- **The handles turn and resize about the middle of the shape.** A shape's
  origin is wherever it happened to be built, which is usually not inside it;
  rotating around a point outside the shape is not what anyone means by
  "turn it". The transform's position is corrected after every change so the
  middle of the shape stays where it was.
- **A grab stroke re-tessellates what it pulled.** Move and Snake Hook drag
  the triangles they captured, which leaves the surface thin behind them; with
  adding on, the region between where the pull started and where it ended is
  rebuilt when you let go.
- **The lookup grid holds everything, even what has left its box.** Geometry
  that moves outside the box the grid was built for goes into the nearest
  edge cells rather than being dropped, and the grid rebuilds around the new
  shape at the next opportunity. The alternative — dropping it until a
  rebuild happens to come along — makes the brush, the refinement and picking
  all silently blind exactly where you are working.
- **A vertex is named by a serial number, not by its index.** Indices are
  slots and slots get reused, so anything that remembers a vertex from one
  stamp to the next stores the number the vertex was created with. It is the
  difference between "this is the vertex whose stroke started there" and
  "this is whoever holds that slot now".
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
node test/topology.test.mjs     # 134  mesh invariants, split/collapse/flip, the grid, needles, decimate
node test/remesh.test.mjs       # 76   watertight and manifold output, volume, colour transfer
node test/io.test.mjs           # 120  round trips for every format, GLB structure, transforms
node test/brush.test.mjs        # 411  every brush, adding vs stretching, the stroke limits, masking, undo
node test/camera.test.mjs       # 18   projection, framing, ray casting
node test/boolean.test.mjs      # 51   union / subtract / intersect against analytic volumes
node test/texture.test.mjs      # 362  PNG writer, unwrap, bake, textured export, stencils, presets
node test/gizmo.test.mjs        # 52   handle layout, hit testing, move/turn/resize maths
node build.js && node test/browser.test.mjs   # 402 end-to-end in a real browser
node test/shots.mjs             # renders the screenshots in test/screens
```

1,626 checks in total. Some of them are worth naming, because they are the
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
- **What is hidden is measured too.** Three separate elements were staying on
  screen after being told to hide — an element with its own `display` ignores
  the `hidden` attribute, and SVG elements have no `hidden` property at all.
  The tests now read the computed style rather than trusting the flag.
- **The handles are checked as geometry**: a drag on an arrow has to land the
  shape under the finger, a quarter turn around a ring has to be 90°, and the
  middle of a shape must not wander while it turns or resizes.
- **The gesture that used to break it is a test.** A small brush at full
  strength, scrubbed over one spot on a coarse mesh, driven with real input:
  it fails if that leaves a needle, a hole, a non-manifold edge, a runaway
  triangle count or a ballooned shape. So are both slider ceilings — from the
  slider, the keyboard, a preset and an old settings file.
- **The reported crash is a test, at the sizes reported.** Crease at full
  power and sizes 4 to 10 with all three mirrors on, in the browser, timed:
  it fails if a stroke takes longer than a few seconds, runs to the triangle
  ceiling, leaves a needle or a hole, or loses the canvas.
- **"The brush keeps working on what it built" is a test.** Seven passes of
  Add on the same spot: each pass has to grow the model further out, and a
  tap in the middle afterwards has to hit the near side of the bump rather
  than the far side of the model.
- **The grid is checked against brute force.** Vertices are pushed a long way
  outside the box the grid was built for, without a rebuild, and every query
  has to return exactly what a scan over every triangle returns.
- **Randomised strokes hunt for the rest.** A fuzz harness drives thousands
  of strokes with random brushes, sizes, strengths, falloffs, stencils,
  symmetry combinations, detail settings and gestures across six primitives,
  and after every round it checks the mesh is closed, manifold, free of
  non-finite coordinates, no further from the detail size than asked, and
  that the stroke added no needles — and that no round took longer than a
  fraction of a second. It is what found most of the bugs listed above; it
  lives outside the repository because it is a search, not a test, but each
  thing it found is a test now.

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
- Sculpting right up against a sharp tip — the apex of a cone, the point of a
  horn you have pulled out — can round it off very slightly. Refining around
  a tip tightens the ring of triangles that meets there, which makes the tip
  itself read as a needle to the repair that runs when you lift your finger.
  It is a fraction of a triangle's worth of rounding, and it only happens
  where you are actually sculpting.
- Roblox's own importer, not this app, decides what it accepts. The 10,000
  triangle ceiling is current at the time of writing; if that changes, set
  your own budget in Brush settings.
