# SculptFree

A digital sculpting app that runs in one HTML file. Open it, sculpt, export.
Nothing is locked, watermarked or limited — **import and export are free, in
every format, at any triangle count.**

Built for making game models: sculpt at whatever density you like, rebuild the
topology when it gets messy, decimate to a triangle budget, and export a GLB
that Three.js, Unity, Godot and Unreal all read without a plugin.

```
tools/sculpt/sculpt.html      ← the whole app; open it in a browser
```

No server, no install, no network. Double-click the file, or serve the folder
if you prefer. Needs a browser with WebGL 2 (anything current).

---

## The screen

Almost all of it is your model. Everything else is one tap away.

| Where | What |
| --- | --- |
| Top left | **☰** — everything: files, shapes, remesh, settings, help |
| Top right | Undo, redo |
| Left edge | The eight brushes you use most, plus **⋯** for the other ten |
| Right edge | Mirror on/off, frame the model, and Look (material, wireframe) |
| Bottom | **Size** and **Strength** — the only two numbers you change often |

Drag on the model to sculpt. Drag off it — or right-drag, or two fingers — to
orbit. That is the whole interface.

## Sculpting

- **Left drag** sculpts · **Shift** smooths · **Ctrl** inverts the brush
- **Right drag** orbits · **Middle drag** pans · **Wheel** zooms
- **Shift + wheel** brush size · **Ctrl + wheel** strength
- One finger sculpts, two fingers orbit and pinch, three fingers pan
- `[` `]` size, `{` `}` strength, `X` `Y` `Z` mirror, `D` dynamic topology,
  `F` frame, `W` wireframe, `?` for the full list

Eighteen brushes: clay, clay strips, draw, inflate, blob, crease, layer,
smooth, flatten, fill, scrape, pinch, move, snake hook, nudge, rotate, paint
and mask. Symmetry works in the object's own space, so it keeps working after
you move or rotate the object.

**Dynamic topology** adds and removes triangles under the brush as you work,
so you can pull a horn out of a sphere and it will have triangles where it
needs them. It respects masks, and stops at a triangle limit you set.

## Getting a model into a game

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
| OBJ | ✓ | ✓ | Quads and n-gons are triangulated; vertex colours supported |
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
| `src/07-scene.js` | Objects, transforms, and memory-budgeted undo history |
| `src/08-brush.js` | The brushes and the stroke engine |
| `src/09-camera.js` | Orbit camera, screen-space ray casting |
| `src/10-render.js` | WebGL2 renderer with procedurally generated matcaps |
| `src/11-widgets.js` | DOM helpers, icons, sheets and dialogs |
| `src/12-app.js` | The app: interface, input, commands |

`index.html` loads the modules for development; `node build.js` inlines
everything into `sculpt.html`.

A few decisions worth knowing about:

- **Brush size is in screen pixels**, converted to model units per stamp, so a
  brush covers the same part of the screen whether you are zoomed in on an ear
  or out at the whole figure — and it behaves the same on a scaled object.
- **Stroke spacing does not change how deep a stroke cuts.** Stamps are laid
  every `spacing × radius` along the path and their strength is scaled to
  match, so spacing is a quality control, not a strength control.
- **Dynamic topology only ever splits a triangle's longest edge and collapses
  its shortest**, then flips the diagonals that leave a badly shaped triangle
  behind. Without those three rules a long session slowly fills the surface
  with slivers, which read as speckles under cavity shading.
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
node test/topology.test.mjs     # 81  mesh invariants, split/collapse/flip, subdivide, decimate
node test/remesh.test.mjs       # 76  watertight and manifold output, volume, colour transfer
node test/io.test.mjs           # 120 round trips for every format, GLB structure, transforms
node test/brush.test.mjs        # 239 every brush, symmetry, masking, undo, dyntopo
node test/camera.test.mjs       # 18  projection, framing, ray casting
node build.js && node test/browser.test.mjs   # 142 end-to-end in a real browser
node test/shots.mjs             # renders the screenshots in test/screens
```

676 checks in total. The browser suite drives the built single file with real
mouse, touch and keyboard input, reads the rendered pixels back to confirm the
renderer is actually drawing, exports every format through the real download
path and re-imports the files in Node to verify them.

Every mesh test runs a structural audit: adjacency agreeing with the triangle
list, no triangle referencing a dead vertex, no edge with more than two faces,
live counts matching, no non-finite coordinates.

## Known limitations

- No UV unwrapping or texture painting. Vertex colour carries through to GLB,
  PLY and OBJ, which covers stylised and low-poly work; for texture maps,
  export the GLB and unwrap in Blender.
- A voxel remesh of a shape with a pole (a sphere, a cone) can leave a handful
  of zero-area triangles where several cells place their vertex at exactly the
  same point. They are invisible and harmless, and the result is still
  watertight and manifold.
- Remeshing and decimating block the interface while they run — a second or
  two at the default settings, longer at high resolution. The dialog tells you
  the voxel count before you commit.
- No sculpt layers and no multiresolution levels; dynamic topology and
  remeshing cover the same ground differently.
