/*
 * Painting into an image.
 *
 * The bug these tests exist for, in the words of the person who hit it: the
 * paint brush "doesn't work the texture feature ... it's just a normal
 * drawing brush". Colour used to live in the vertices, so on a model built
 * for a game — a few hundred triangles — a dirt stencil could only come out
 * as a handful of soft blotches. It now lives in an image of the object's
 * own, and these tests hold that to account: the pattern has to be finer
 * than the mesh, it has to stay put while a stroke scrubs over it, and it
 * has to come out the other end of an export.
 */
import { load, check, eq, report } from './harness.mjs';
import { makeCamera, defaultSettings } from './stubcam.mjs';
const S = load();
const T = S.Texture, A = S.Alpha;

function ball(detail = 3) { return S.Prim.makeMesh('sphere', detail); }
function mapFor(mesh, size = 512, base = [0.85, 0.85, 0.85]) {
  const map = new S.PaintMap(size, S.PaintMap.frameFor(mesh));
  map.fill(base[0], base[1], base[2]);
  return map;
}
/** A dab of paint, with everything a brush would pass. */
function dab(map, mesh, over = {}) {
  const at = over.center || [0, 0, 0.5];
  return map.stamp(mesh, Object.assign({
    center: at, radius: 0.22, normal: over.normal || at,
    color: [0.9, 0.15, 0.1], strength: 1, falloff: S.FALLOFFS[0].fn,
    alphaU: [1, 0, 0], alphaV: [0, 1, 0]
  }, over));
}
/** Read the surface at a point on a unit-ish sphere of radius 0.5. */
function readSphere(map, x, y) {
  const z = Math.sqrt(Math.max(1e-6, 0.25 - x * x - y * y));
  const out = [0, 0, 0];
  map.sample(x, y, z, x, y, z, out);
  return out;
}
/** How much the painted colour varies over the dab — a flat smudge scores 0. */
function contrast(map, radius = 0.18, samples = 500) {
  let lo = 9, hi = -9;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2 * 7.3;
    const r = Math.sqrt((i + 0.5) / samples) * radius;
    const c = readSphere(map, Math.cos(a) * r, Math.sin(a) * r);
    const red = c[0] - c[1];
    if (red < lo) lo = red;
    if (red > hi) hi = red;
  }
  return hi - lo;
}

/* ---- the atlas ------------------------------------------------------ */
{
  const mesh = ball(3);
  const frame = S.PaintMap.frameFor(mesh);
  check('the frame holds the model', frame.span > 1 && frame.span < 1.4, `${frame.span}`);
  check('and is centred on it', Math.abs(frame.min[0] + frame.max[0]) < 1e-6);

  const map = mapFor(mesh);
  const w = new Float32Array(6);
  map.weights(0, 0, 1, w);
  eq('a surface facing +z reads only the +z chart', Math.round(w[4] * 1000) / 1000, 1);
  map.weights(1, 1, 0, w);
  check('one facing between two charts shares between those two',
    Math.abs(w[0] - 0.5) < 1e-6 && Math.abs(w[2] - 0.5) < 1e-6, Array.from(w).join(','));
  for (const n of [[1, 0, 0], [-0.3, 0.7, 0.2], [0, -1, 0], [0.5, 0.5, 0.5]]) {
    map.weights(n[0], n[1], n[2], w);
    let sum = 0;
    for (let f = 0; f < 6; f++) sum += w[f];
    check('the shares always add up to one: ' + n.join(','), Math.abs(sum - 1) < 1e-6, `${sum}`);
  }

  // every chart lands inside its own cell of the 3x2 grid
  const uv = [0, 0];
  for (let face = 0; face < 6; face++) {
    const col = face % 3, row = Math.floor(face / 3);
    for (const p of [[0.4, 0.4, 0.4], [-0.4, 0.1, -0.2], [0, 0, 0]]) {
      map.atlasUV(face, p[0], p[1], p[2], uv);
      check(`chart ${face} stays in its cell`,
        uv[0] >= col / 3 - 1e-6 && uv[0] <= (col + 1) / 3 + 1e-6 &&
        uv[1] >= row / 2 - 1e-6 && uv[1] <= (row + 1) / 2 + 1e-6,
        `${uv[0].toFixed(3)}, ${uv[1].toFixed(3)}`);
    }
  }
}

/* ---- a dab lands where the brush is, and nowhere else --------------- */
{
  const mesh = ball(4);
  const map = mapFor(mesh);
  check('the dab painted something', dab(map, mesh));
  const at = readSphere(map, 0, 0);
  check('the middle of the dab took the colour', at[0] - at[1] > 0.4,
    at.map((n) => n.toFixed(2)).join(','));

  const out = [0, 0, 0];
  map.sample(0, 0, -0.5, 0, 0, -1, out);
  check('the far side of the model is untouched', Math.abs(out[0] - out[1]) < 0.02,
    out.map((n) => n.toFixed(3)).join(','));
  const edge = readSphere(map, 0.46, 0);
  check('and so is the surface outside the brush', Math.abs(edge[0] - edge[1]) < 0.02,
    edge.map((n) => n.toFixed(3)).join(','));
}

/* ---- the whole point: finer than the mesh --------------------------- */
{
  /*
   * A 320-triangle ball has about 160 vertices, and a dab covers a dozen of
   * them. Painting a stencil into the vertices can only produce as many
   * different values as there are vertices under the brush; painting into
   * the image produces as many as there are texels. The test is the contrast
   * the pattern leaves behind, measured the same way for both.
   */
  const coarse = ball(2);
  eq('the test model really is coarse', coarse.liveTris, 320);
  const dirt = A.builtin('dirt');

  const map = mapFor(coarse);
  dab(map, coarse, { alpha: dirt, alphaTile: 0.44 });
  const painted = contrast(map);

  // the same dab, the old way: colour in the vertices
  const scene = new S.Scene();
  const obj = new S.SceneObject('Vertex', ball(2));
  scene.add(obj);
  const engine = new S.StrokeEngine({
    scene, history: new S.History(),
    settings: defaultSettings({ brush: 'paint', radius: 62, strength: 1, alpha: 'dirt' }),
    camera: makeCamera(S)
  });
  engine.begin({ x: 400, y: 300, pressure: 1 });
  engine.end();
  let lo = 9, hi = -9;
  const col = obj.mesh.colors.array;
  for (let v = 0; v < obj.mesh.masks.length; v++) {
    if (obj.mesh.vertDead.array[v]) continue;
    const o = v * 3;
    const red = col[o] - col[o + 1];
    if (red < lo) lo = red;
    if (red > hi) hi = red;
  }
  const inVertices = hi - lo;

  check('a stencil painted into the image has real contrast', painted > 0.35,
    `${painted.toFixed(3)}`);
  check('as does the same dab in the vertices, at its own scale', inVertices > 0.2,
    `${inVertices.toFixed(3)}`);

  /*
   * Contrast alone does not tell the two apart: one fully painted vertex
   * next to an unpainted one spans the same range. What separates them is
   * how often the pattern can change *across the surface* — in the vertices,
   * at most once per triangle; in the image, once per texel. So walk a small
   * circle on the surface and count how many times the paint crosses its own
   * average. That is the number the blotches in the video were missing.
   */
  function crossings(sampleAt) {
    const values = [];
    for (let i = 0; i < 240; i++) {
      const a = (i / 240) * Math.PI * 2;
      values.push(sampleAt(Math.cos(a) * 0.13, Math.sin(a) * 0.13));
    }
    const mean = values.reduce((t, v) => t + v, 0) / values.length;
    let n = 0;
    for (let i = 0; i < values.length; i++) {
      const a = values[i] - mean, b = values[(i + 1) % values.length] - mean;
      if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) n++;
    }
    return n;
  }

  const imageCrossings = crossings(function (x, y) {
    const c = readSphere(map, x, y);
    return c[0] - c[1];
  });
  // the vertex version, read the way a renderer reads it: the nearest vertex
  const vcol = obj.mesh.colors.array, vpos = obj.mesh.positions.array;
  const vertexCrossings = crossings(function (x, y) {
    const z = Math.sqrt(Math.max(1e-6, 0.25 - x * x - y * y));
    let best = -1, bestD = Infinity;
    for (let v = 0; v < obj.mesh.masks.length; v++) {
      if (obj.mesh.vertDead.array[v]) continue;
      const o = v * 3;
      const d = (vpos[o] - x) ** 2 + (vpos[o + 1] - y) ** 2 + (vpos[o + 2] - z) ** 2;
      if (d < bestD) { bestD = d; best = v; }
    }
    return vcol[best * 3] - vcol[best * 3 + 1];
  });
  check('the pattern changes many times across the surface', imageCrossings >= 6,
    `${imageCrossings} crossings`);
  check('and far more often than it can in the vertices',
    imageCrossings >= vertexCrossings * 2, `${imageCrossings} against ${vertexCrossings}`);
}

/* ---- and it stays put while a stroke scrubs over it ----------------- */
{
  /*
   * Read afresh under every dab, a pattern is printed in a new place each
   * time and a stroke smears it into a solid smudge. Read from the surface,
   * every dab lays it in the same place. Ten overlapping dabs, both ways.
   */
  const mesh = ball(4);
  const dirt = A.builtin('dirt');
  function scrub(alphaTile) {
    const map = mapFor(mesh);
    for (let i = 0; i < 10; i++) {
      const x = -0.12 + i * 0.024;
      const z = Math.sqrt(Math.max(0.02, 0.25 - x * x));
      dab(map, mesh, { center: [x, 0, z], normal: [x, 0, z], alpha: dirt,
                       alphaTile: alphaTile, strength: 0.5 });
    }
    return contrast(map, 0.12);
  }
  const stuck = scrub(0.44);        // the pattern taken from the surface
  const perDab = scrub(0);          // the pattern printed inside each dab
  check('scrubbing with the pattern on the surface keeps it', stuck > 0.3, `${stuck.toFixed(3)}`);
  check('and keeps more of it than printing it per dab does',
    stuck > perDab * 1.25, `${stuck.toFixed(3)} against ${perDab.toFixed(3)}`);
}

/* ---- masks and facing ---------------------------------------------- */
{
  const mesh = ball(4);
  const map = mapFor(mesh);
  // mask the +x half
  const pos = mesh.positions.array;
  for (let v = 0; v < mesh.masks.length; v++) {
    if (mesh.vertDead.array[v]) continue;
    if (pos[v * 3] > 0.02) mesh.masks.array[v] = 1;
  }
  dab(map, mesh, { radius: 0.35 });
  const free = readSphere(map, -0.2, 0);
  const masked = readSphere(map, 0.2, 0);
  check('paint lands on the unmasked side', free[0] - free[1] > 0.2,
    free.map((n) => n.toFixed(2)).join(','));
  check('and not on the masked side', masked[0] - masked[1] < 0.06,
    masked.map((n) => n.toFixed(2)).join(','));
}

/* ---- undo puts the image back -------------------------------------- */
{
  const mesh = ball(3);
  const obj = new S.SceneObject('Ball', mesh);
  obj.paint = mapFor(mesh);
  const history = new S.History();
  const before = obj.paint.pixels.slice();

  history.beginStroke(obj, { label: 'Paint', paintMap: obj.paint });
  dab(obj.paint, mesh, { history: history });
  const committed = history.endStroke();
  check('the paint stroke was recorded', committed);
  check('and it changed the image', !sameBytes(before, obj.paint.pixels));
  const after = obj.paint.pixels.slice();

  history.undo();
  check('undo puts every texel back', sameBytes(before, obj.paint.pixels));
  history.redo();
  check('redo paints it again', sameBytes(after, obj.paint.pixels));

  // only the tiles that were touched are kept, not the whole image
  const entry = history.undoStack[history.undoStack.length - 1];
  eq('the stroke is stored as tiles', entry.kind, 'paint');
  check('a dab keeps only the tiles it touched', entry.before.size > 0 && entry.before.size < 40,
    `${entry.before.size} tiles of ${obj.paint.tiles * obj.paint.tiles}`);
  check('which is a fraction of the image', entry._bytes < obj.paint.pixels.byteLength,
    `${(entry._bytes / 1024).toFixed(0)} KB against ${(obj.paint.pixels.byteLength / 1024).toFixed(0)} KB`);
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* ---- colour travels both ways -------------------------------------- */
{
  const mesh = ball(3);
  mesh.setColorAll(0.2, 0.55, 0.9);
  const map = new S.PaintMap(256, S.PaintMap.frameFor(mesh));
  map.bakeFromMesh(mesh, [0.85, 0.85, 0.85]);
  const out = [0, 0, 0];
  map.sample(0, 0, 0.5, 0, 0, 1, out);
  check('a new image starts from the colour the model already had',
    Math.abs(out[0] - 0.2) < 0.03 && Math.abs(out[2] - 0.9) < 0.03,
    out.map((n) => n.toFixed(2)).join(','));

  // paint on it, then write it back onto the vertices
  dab(map, mesh, { color: [1, 0, 0], radius: 0.3 });
  map.toVertexColors(mesh);
  const col = mesh.colors.array;
  let reddest = 0;
  for (let v = 0; v < mesh.masks.length; v++) {
    if (mesh.vertDead.array[v]) continue;
    reddest = Math.max(reddest, col[v * 3] - col[v * 3 + 1]);
  }
  check('and the paint can be written back onto the vertices', reddest > 0.3, `${reddest.toFixed(2)}`);
}

/* ---- the painted image is what gets exported ----------------------- */
{
  const mesh = ball(3);
  const obj = new S.SceneObject('Ball', mesh);
  obj.paint = mapFor(mesh);
  const dirt = A.builtin('dirt');
  for (let i = 0; i < 6; i++) {
    const x = -0.1 + i * 0.04, z = Math.sqrt(Math.max(0.02, 0.25 - x * x));
    dab(obj.paint, mesh, { center: [x, 0, z], normal: [x, 0, z], color: [0.1, 0.45, 0.95],
                           alpha: dirt, alphaTile: 0.44 });
  }
  const geom = S.IO.prepare([obj], { includeColors: true, includeNormals: true })[0];
  check('the export carries the paint along', !!geom.paint);
  check('and the vertices as the image knows them', !!geom.localPositions && !!geom.localNormals);

  const built = T.build(geom, { size: 256 });
  let blue = 0, total = 0, varied = new Set();
  for (let i = 0; i < built.pixels.length; i += 4) {
    const r = built.pixels[i], b = built.pixels[i + 2];
    if (b > r + 40) blue++;
    varied.add(b - r);
    total++;
  }
  check('the baked texture carries the painted colour', blue > total * 0.005,
    `${(blue / total * 100).toFixed(2)}% of it`);
  check('and the pattern with it', varied.size > 20, `${varied.size} levels`);

  // an unpainted object still bakes from its vertex colours
  const plain = new S.SceneObject('Plain', ball(3));
  plain.mesh.setColorAll(0.9, 0.2, 0.2);
  const plainGeom = S.IO.prepare([plain], { includeColors: true, includeNormals: true })[0];
  const plainBake = T.build(plainGeom, { size: 128 });
  let red = 0;
  for (let i = 0; i < plainBake.pixels.length; i += 4) {
    if (plainBake.pixels[i] > plainBake.pixels[i + 1] + 40) red++;
  }
  check('an unpainted model still bakes from its vertex colours', red > 100, `${red} pixels`);
}

/* ---- and it survives being reduced for Roblox ---------------------- */
{
  /*
   * The point of all this, for the person who asked for it: a model goes to
   * Roblox under ten thousand triangles, and painted detail used to go down
   * with the triangle count because it lived in the vertices. The image does
   * not care how many triangles are left.
   */
  const mesh = ball(5);
  const obj = new S.SceneObject('Ball', mesh);
  obj.paint = mapFor(mesh);
  const dirt = A.builtin('dirt');
  for (let i = 0; i < 6; i++) {
    const x = -0.1 + i * 0.04, z = Math.sqrt(Math.max(0.02, 0.25 - x * x));
    dab(obj.paint, mesh, { center: [x, 0, z], normal: [x, 0, z], color: [0.1, 0.45, 0.95],
                           alpha: dirt, alphaTile: 0.44 });
  }
  const reduced = new S.SceneObject('Reduced', mesh.clone());
  reduced.paint = obj.paint;               // the image comes with the copy
  reduced.mesh.decimate(2000, true);
  check('the copy really was reduced', reduced.mesh.liveTris <= 2000,
    `${mesh.liveTris} -> ${reduced.mesh.liveTris}`);

  const geom = S.IO.prepare([reduced], { includeNormals: true })[0];
  const built = T.build(geom, { size: 512 });
  let painted = 0, levels = new Set();
  for (let i = 0; i < built.pixels.length; i += 4) {
    const r = built.pixels[i], b = built.pixels[i + 2];
    if (b > r + 40) painted++;
    levels.add(b - r);
  }
  check('the reduced model still exports its paint', painted > 1500, `${painted} texels`);
  check('with the pattern intact', levels.size > 30, `${levels.size} levels`);
}

/* ---- a project keeps its paint ------------------------------------- */
{
  const mesh = ball(3);
  const obj = new S.SceneObject('Ball', mesh);
  obj.paint = mapFor(mesh, 256);
  dab(obj.paint, mesh, { alpha: A.builtin('gravel'), alphaTile: 0.44 });

  const raw = obj.paint.pixels.byteLength;
  const packed = obj.paint.encode().byteLength;
  check('the image packs down for saving', packed < raw / 4,
    `${(packed / 1024).toFixed(0)} KB of ${(raw / 1024).toFixed(0)} KB`);

  const file = S.IO.saveProject({ objects: [obj], selected: 0, camera: null, settings: null });
  const back = S.IO.loadProject(file);
  check('the project loads', back.ok, back.reason || '');
  const loaded = back.objects[0].paint;
  check('and it has its paint', !!loaded);
  eq('at the same size', loaded && loaded.size, 256);
  check('texel for texel', loaded && sameBytes(obj.paint.pixels, loaded.pixels));
  const a = [0, 0, 0], b = [0, 0, 0];
  obj.paint.sample(0, 0, 0.5, 0, 0, 1, a);
  loaded.sample(0, 0, 0.5, 0, 0, 1, b);
  check('and reads the same colour back', Math.abs(a[0] - b[0]) < 1e-6);
}

/* ---- sculpting after painting -------------------------------------- */
{
  /*
   * The image is mapped by where the surface is, not by coordinates stored
   * on it, so every topology change the sculpting brushes make — splitting,
   * collapsing, remeshing — leaves the paint readable. Nothing to rebuild.
   */
  const scene = new S.Scene();
  const obj = new S.SceneObject('Ball', ball(3));
  scene.add(obj);
  obj.paint = mapFor(obj.mesh);
  dab(obj.paint, obj.mesh, { radius: 0.3 });
  const before = readSphere(obj.paint, 0.05, 0.05);

  const engine = new S.StrokeEngine({
    scene, history: new S.History(),
    settings: defaultSettings({ brush: 'add', radius: 40, strength: 0.6, dyntopo: true,
                                maxTriangles: 150000 }),
    camera: makeCamera(S)
  });
  const trisBefore = obj.mesh.liveTris;
  engine.begin({ x: 400, y: 300, pressure: 1 });
  for (let i = 1; i <= 10; i++) engine.move({ x: 400 + i * 4, y: 300, pressure: 1 });
  engine.end();
  check('the sculpt changed the topology', obj.mesh.liveTris !== trisBefore,
    `${trisBefore} -> ${obj.mesh.liveTris}`);
  const after = readSphere(obj.paint, 0.05, 0.05);
  check('and the paint is still there afterwards',
    Math.abs(before[0] - after[0]) < 0.02 && after[0] - after[1] > 0.3,
    `${before.map((n) => n.toFixed(2)).join(',')} -> ${after.map((n) => n.toFixed(2)).join(',')}`);
}

/* ---- it has to keep up with a finger ------------------------------- */
{
  const mesh = ball(4);
  const dirt = A.builtin('dirt');
  function timeDabs(size) {
    const map = mapFor(mesh, size);
    const one = (i) => {
      const x = Math.sin(i) * 0.08, y = Math.cos(i) * 0.08;
      const z = Math.sqrt(Math.max(0.02, 0.25 - x * x - y * y));
      dab(map, mesh, { center: [x, y, z], normal: [x, y, z], alpha: dirt, alphaTile: 0.44,
                       strength: 0.5 });
    };
    for (let i = 0; i < 10; i++) one(i);           // warm up
    const t0 = Date.now();
    for (let i = 0; i < 30; i++) one(i);
    return (Date.now() - t0) / 30;
  }
  const ms512 = timeDabs(512), ms1024 = timeDabs(1024);
  check('a dab on a 512 image is quick', ms512 < 12, `${ms512.toFixed(1)} ms`);
  check('and on a 1024 image', ms1024 < 25, `${ms1024.toFixed(1)} ms`);
  console.log(`  a dab takes ${ms512.toFixed(1)} ms at 512, ${ms1024.toFixed(1)} ms at 1024`);
}

report('paint');
