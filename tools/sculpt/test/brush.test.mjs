import { load, check, eq, report, audit, volume } from './harness.mjs';
import { makeCamera, defaultSettings } from './stubcam.mjs';
const S = load(['07-scene', '08-brush']);

function setup(over = {}, primitive = 'sphere', detail = 4) {
  const scene = new S.Scene();
  const obj = new S.SceneObject('Test', S.Prim.makeMesh(primitive, detail));
  scene.add(obj);
  const history = new S.History();
  const settings = defaultSettings(over);
  const camera = makeCamera(S);
  const engine = new S.StrokeEngine({ scene, history, settings, camera });
  return { scene, obj, history, settings, camera, engine };
}

function positionsOf(mesh) { return mesh.positions.copy(); }
function maxDelta(a, b) {
  let m = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** Drag across the middle of the screen, left to right. */
function drag(engine, steps = 10, from = [340, 300], to = [460, 300], pressure = 1) {
  const started = engine.begin({ x: from[0], y: from[1], pressure });
  if (!started) return false;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    engine.move({ x: from[0] + (to[0] - from[0]) * t, y: from[1] + (to[1] - from[1]) * t, pressure });
  }
  engine.end();
  return true;
}

/* ---- the pointer actually finds the surface ------------------------- */
{
  const { engine } = setup();
  const hit = engine.pick(400, 300);
  check('centre of screen hits the sphere', !!hit);
  check('hit normal points back at the camera', hit && hit.normal[2] > 0.9, hit ? hit.normal.join(',') : '');
  const miss = engine.pick(5, 5);
  check('corner of screen misses', !miss);
}

/* ---- every brush moves something, and undo puts it back ------------- */
{
  for (const brush of S.BRUSHES) {
    const { obj, history, engine } = setup({ brush: brush.id, strength: brush.strength });
    const mesh = obj.mesh;
    const before = positionsOf(mesh);
    const colBefore = mesh.colors.copy();
    const maskBefore = mesh.masks.copy();
    const ok = drag(engine, 12);
    check(`${brush.id}: stroke started`, ok);
    check(`${brush.id}: stamps were laid`, engine.stamps > 1, `${engine.stamps}`);

    if (brush.paint) {
      check(`${brush.id}: colours changed`, maxDelta(colBefore, mesh.colors.view()) > 0.05,
        `${maxDelta(colBefore, mesh.colors.view())}`);
    } else if (brush.mask) {
      check(`${brush.id}: mask changed`, maxDelta(maskBefore, mesh.masks.view()) > 0.05);
    } else {
      check(`${brush.id}: geometry changed`, maxDelta(before, mesh.positions.view()) > 1e-4,
        `${maxDelta(before, mesh.positions.view())}`);
    }
    audit(mesh, `${brush.id} stroke`);
    eq(`${brush.id}: mesh still closed`, mesh.countBorderEdges(), 0);

    check(`${brush.id}: history recorded one step`, history.undoStack.length === 1, `${history.undoStack.length}`);
    history.undo();
    check(`${brush.id}: undo restored positions`, maxDelta(before, mesh.positions.view()) < 1e-6,
      `${maxDelta(before, mesh.positions.view())}`);
    if (brush.paint) check(`${brush.id}: undo restored colours`, maxDelta(colBefore, mesh.colors.view()) < 1e-6);
    if (brush.mask) check(`${brush.id}: undo restored the mask`, maxDelta(maskBefore, mesh.masks.view()) < 1e-6);
    history.redo();
    check(`${brush.id}: redo reapplied the stroke`,
      brush.paint || brush.mask || maxDelta(before, mesh.positions.view()) > 1e-4);
  }
}

/* ---- direction of travel: add brushes push out, invert pulls in ----- */
{
  for (const id of ['clay', 'draw', 'inflate', 'blob', 'claystrips', 'layer']) {
    const { obj, engine } = setup({ brush: id, strength: 0.8 });
    const r0 = obj.mesh.boundsRadius();
    drag(engine, 8);
    const grew = obj.mesh.boundsRadius() - r0;
    check(`${id} pushes the surface outwards`, grew > 0, `delta ${grew.toFixed(5)}`);

    const inv = setup({ brush: id, strength: 0.8 });
    const p0 = inv.obj.mesh.positions.copy();
    inv.engine.begin({ x: 400, y: 300, pressure: 1, invert: true });
    for (let i = 1; i <= 8; i++) inv.engine.move({ x: 400 + i * 8, y: 300, pressure: 1, invert: true });
    inv.engine.end();
    // measure along the view direction at the touched point: inverted strokes dent
    const mesh = inv.obj.mesh;
    let maxZBefore = -Infinity, maxZAfter = -Infinity;
    for (let v = 0; v < mesh.liveVerts; v++) {
      maxZBefore = Math.max(maxZBefore, p0[v * 3 + 2]);
      maxZAfter = Math.max(maxZAfter, mesh.positions.array[v * 3 + 2]);
    }
    check(`${id} inverted does not push outwards`, maxZAfter <= maxZBefore + 1e-6,
      `${maxZBefore.toFixed(5)} -> ${maxZAfter.toFixed(5)}`);
  }
}

/* ---- smooth reduces roughness, flatten flattens -------------------- */
{
  const { obj, engine, settings } = setup({ brush: 'inflate', strength: 1 });
  // roughen a patch
  drag(engine, 6);
  const mesh = obj.mesh;
  function roughness() {
    // mean distance of vertices from the average of their ring
    const ring = [];
    let sum = 0, n = 0;
    for (let v = 0; v < mesh.liveVerts; v += 3) {
      if (mesh.vertDead.array[v]) continue;
      mesh.ringVerts(v, ring);
      if (!ring.length) continue;
      let cx = 0, cy = 0, cz = 0;
      for (const w of ring) { cx += mesh.positions.array[w * 3]; cy += mesh.positions.array[w * 3 + 1]; cz += mesh.positions.array[w * 3 + 2]; }
      cx /= ring.length; cy /= ring.length; cz /= ring.length;
      const o = v * 3;
      sum += Math.hypot(mesh.positions.array[o] - cx, mesh.positions.array[o + 1] - cy, mesh.positions.array[o + 2] - cz);
      n++;
    }
    return sum / n;
  }
  const rough0 = roughness();
  settings.brush = 'smooth';
  settings.strength = 1;
  drag(engine, 14);
  const rough1 = roughness();
  check('smooth brush reduces local roughness', rough1 < rough0, `${rough0.toExponential(2)} -> ${rough1.toExponential(2)}`);

  // flatten: the touched patch should end up closer to a plane
  const f = setup({ brush: 'flatten', strength: 1 });
  const fm = f.obj.mesh;
  const before = [];
  for (let v = 0; v < fm.liveVerts; v++) {
    const o = v * 3;
    if (Math.hypot(fm.positions.array[o], fm.positions.array[o + 1]) < 0.15 && fm.positions.array[o + 2] > 0) before.push(fm.positions.array[o + 2]);
  }
  const spread0 = Math.max(...before) - Math.min(...before);
  drag(f.engine, 10, [395, 300], [405, 300]);
  const after = [];
  for (let v = 0; v < fm.liveVerts; v++) {
    const o = v * 3;
    if (Math.hypot(fm.positions.array[o], fm.positions.array[o + 1]) < 0.15 && fm.positions.array[o + 2] > 0) after.push(fm.positions.array[o + 2]);
  }
  const spread1 = Math.max(...after) - Math.min(...after);
  check('flatten reduces the spread of the patch', spread1 < spread0, `${spread0.toFixed(4)} -> ${spread1.toFixed(4)}`);
}

/* ---- masking protects the surface ---------------------------------- */
{
  const { obj, engine } = setup({ brush: 'draw', strength: 1 });
  obj.mesh.setMaskAll(1);
  const before = positionsOf(obj.mesh);
  drag(engine, 10);
  check('a fully masked mesh is untouched by the draw brush',
    maxDelta(before, obj.mesh.positions.view()) < 1e-9,
    `${maxDelta(before, obj.mesh.positions.view())}`);

  // the mask brush itself must still work on masked geometry
  const m2 = setup({ brush: 'mask', strength: 1 });
  m2.obj.mesh.setMaskAll(1);
  m2.engine.begin({ x: 400, y: 300, pressure: 1, invert: true });
  for (let i = 1; i <= 8; i++) m2.engine.move({ x: 400 + i * 6, y: 300, pressure: 1, invert: true });
  m2.engine.end();
  let minMask = 1;
  for (let v = 0; v < m2.obj.mesh.liveVerts; v++) minMask = Math.min(minMask, m2.obj.mesh.masks.array[v]);
  check('ctrl-mask erases an existing mask', minMask < 0.9, `${minMask}`);
}

/* ---- symmetry ------------------------------------------------------ */
{
  const { obj, engine } = setup({ brush: 'draw', strength: 0.9, symmetryX: true });
  const mesh = obj.mesh;
  drag(engine, 10, [430, 300], [470, 300]);   // clearly on the +x side
  // for every displaced vertex there must be a mirrored partner displaced too
  let checked = 0, matched = 0;
  const base = S.Prim.makeMesh('sphere', 4);
  for (let v = 0; v < mesh.liveVerts; v += 5) {
    const o = v * 3;
    const moved = Math.abs(Math.hypot(mesh.positions.array[o], mesh.positions.array[o + 1], mesh.positions.array[o + 2]) - 0.5);
    if (moved < 0.004 || mesh.positions.array[o] < 0.05) continue;
    checked++;
    const want = [-mesh.positions.array[o], mesh.positions.array[o + 1], mesh.positions.array[o + 2]];
    const near = mesh.vertsInSphere(want[0], want[1], want[2], 0.02);
    let best = 0;
    for (const w of near) {
      const wo = w * 3;
      best = Math.max(best, Math.abs(Math.hypot(mesh.positions.array[wo], mesh.positions.array[wo + 1], mesh.positions.array[wo + 2]) - 0.5));
    }
    if (best > moved * 0.5) matched++;
  }
  check('X symmetry mirrors the stroke', checked > 20 && matched / checked > 0.9,
    `${matched}/${checked}`);

  // all three axes at once must not corrupt anything
  const tri = setup({ brush: 'clay', strength: 0.8, symmetryX: true, symmetryY: true, symmetryZ: true });
  drag(tri.engine, 8, [420, 260], [450, 290]);
  audit(tri.obj.mesh, 'stroke with 3-axis symmetry');
  eq('3-axis symmetry keeps the mesh closed', tri.obj.mesh.countBorderEdges(), 0);
}

/* ---- dyntopo strokes ----------------------------------------------- */
{
  const { obj, history, engine } = setup({ brush: 'clay', strength: 0.7, dyntopo: true, detailPercent: 18 }, 'sphere', 3);
  const mesh = obj.mesh;
  const t0 = mesh.liveTris;
  const snap0 = mesh.snapshot();
  drag(engine, 16, [360, 300], [440, 300]);
  check('dyntopo added triangles', mesh.liveTris > t0, `${t0} -> ${mesh.liveTris}`);
  audit(mesh, 'dyntopo stroke');
  eq('dyntopo stroke keeps the mesh closed', mesh.countBorderEdges(), 0);
  check('dyntopo stroke recorded a full snapshot', history.undoStack[0].kind === 'mesh');
  history.undo();
  eq('undo restored the triangle count', mesh.liveTris, t0);
  check('undo restored the exact positions', maxDelta(snap0.positions, mesh.positions.view()) < 1e-9);
  audit(mesh, 'after undo of a dyntopo stroke');
  history.redo();
  check('redo restored the refined mesh', mesh.liveTris > t0);
  audit(mesh, 'after redo of a dyntopo stroke');

  // the triangle budget must hold even under a long stroke
  const cap = setup({ brush: 'clay', strength: 0.5, dyntopo: true, detailPercent: 4, maxTriangles: 12000 }, 'sphere', 3);
  drag(cap.engine, 25, [340, 300], [460, 300]);
  check('dyntopo respects the triangle budget during a stroke', cap.obj.mesh.liveTris <= 12000 + 200,
    `${cap.obj.mesh.liveTris}`);
}

/* ---- grab / move brushes ------------------------------------------- */
{
  const { obj, engine } = setup({ brush: 'move', strength: 1 });
  const mesh = obj.mesh;
  const before = positionsOf(mesh);
  engine.begin({ x: 400, y: 300, pressure: 1 });
  for (let i = 1; i <= 10; i++) engine.move({ x: 400 + i * 6, y: 300, pressure: 1 });
  engine.end();
  // the grabbed patch should have moved in +x
  let sumDx = 0, moved = 0;
  for (let v = 0; v < mesh.liveVerts; v++) {
    const o = v * 3;
    const dx = mesh.positions.array[o] - before[o];
    if (Math.abs(dx) > 1e-5) { sumDx += dx; moved++; }
  }
  check('move brush dragged vertices', moved > 10, `${moved}`);
  check('move brush dragged them in +x', sumDx > 0, `${sumDx.toFixed(4)}`);
  audit(mesh, 'move brush');

  // Snake hook pulls material out along the drag, which for a stroke across
  // the front of the sphere shows up as radial extent, not as a bigger box.
  const sh = setup({ brush: 'snakehook', strength: 1, dyntopo: true, detailPercent: 25 }, 'sphere', 3);
  function furthest(mesh) {
    let r = 0;
    for (let v = 0; v < mesh.masks.length; v++) {
      if (mesh.vertDead.array[v]) continue;
      const o = v * 3;
      r = Math.max(r, Math.hypot(mesh.positions.array[o], mesh.positions.array[o + 1], mesh.positions.array[o + 2]));
    }
    return r;
  }
  const r0 = furthest(sh.obj.mesh);
  sh.engine.begin({ x: 400, y: 300, pressure: 1 });
  for (let i = 1; i <= 20; i++) sh.engine.move({ x: 400, y: 300 - i * 5, pressure: 1 });
  sh.engine.end();
  const r1 = furthest(sh.obj.mesh);
  check('snake hook pulled a horn out', r1 > r0 * 1.15, `${r0.toFixed(3)} -> ${r1.toFixed(3)}`);
  check('snake hook refined the stretched area', sh.obj.mesh.liveTris > 1280, `${sh.obj.mesh.liveTris}`);
  audit(sh.obj.mesh, 'snake hook');
  eq('snake hook keeps the mesh closed', sh.obj.mesh.countBorderEdges(), 0);
}

/* ---- stroke spacing and pressure ----------------------------------- */
{
  const tight = setup({ brush: 'draw', spacing: 0.05 });
  drag(tight.engine, 10, [340, 300], [460, 300]);
  const loose = setup({ brush: 'draw', spacing: 1.0 });
  drag(loose.engine, 10, [340, 300], [460, 300]);
  check('smaller spacing lays more stamps', tight.engine.stamps > loose.engine.stamps,
    `${tight.engine.stamps} vs ${loose.engine.stamps}`);

  const soft = setup({ brush: 'draw', strength: 1, pressureStrength: true });
  drag(soft.engine, 10, [380, 300], [420, 300], 0.1);
  const hard = setup({ brush: 'draw', strength: 1, pressureStrength: true });
  drag(hard.engine, 10, [380, 300], [420, 300], 1.0);
  check('pen pressure scales strength',
    hard.obj.mesh.boundsRadius() > soft.obj.mesh.boundsRadius(),
    `${soft.obj.mesh.boundsRadius().toFixed(4)} vs ${hard.obj.mesh.boundsRadius().toFixed(4)}`);
}

/* ---- brush radius is screen-relative, not world-relative ----------- */
{
  // zoomed out, the same pixel radius must cover more of the model
  const near = setup({ brush: 'draw', strength: 1 });
  near.camera.eye[2] = 1.5;
  drag(near.engine, 6);
  const far = setup({ brush: 'draw', strength: 1 });
  far.camera.eye[2] = 6;
  drag(far.engine, 6);
  function touched(mesh) {
    let n = 0;
    for (let v = 0; v < mesh.liveVerts; v++) {
      const o = v * 3;
      if (Math.abs(Math.hypot(mesh.positions.array[o], mesh.positions.array[o + 1], mesh.positions.array[o + 2]) - 0.5) > 1e-4) n++;
    }
    return n;
  }
  check('zooming out makes the brush cover more vertices',
    touched(far.obj.mesh) > touched(near.obj.mesh) * 1.5,
    `near=${touched(near.obj.mesh)} far=${touched(far.obj.mesh)}`);
}

/* ---- sculpting a transformed object -------------------------------- */
{
  const scene = new S.Scene();
  const obj = new S.SceneObject('Rotated', S.Prim.makeMesh('sphere', 4));
  obj.position[0] = 0.3;
  S.Q4.fromEuler(obj.rotation, 0.4, 0.9, 0.2);
  obj.scale[0] = obj.scale[1] = obj.scale[2] = 1.7;
  obj.touch();
  scene.add(obj);
  const history = new S.History();
  const settings = defaultSettings({ brush: 'clay', strength: 0.8 });
  const engine = new S.StrokeEngine({ scene, history, settings, camera: makeCamera(S, { distance: 5 }) });
  const before = positionsOf(obj.mesh);
  const hit = engine.pick(400, 300);
  check('transformed object is hit', !!hit);
  drag(engine, 10);
  const moved = maxDelta(before, obj.mesh.positions.view());
  check('sculpting works on a moved, rotated, scaled object', moved > 1e-4, `${moved}`);
  audit(obj.mesh, 'sculpt on a transformed object');
  // the change must be local to where the pointer was, i.e. near the hit point
  let far = 0;
  for (let v = 0; v < obj.mesh.liveVerts; v++) {
    const o = v * 3;
    if (Math.abs(before[o] - obj.mesh.positions.array[o]) > 1e-5 ||
        Math.abs(before[o + 1] - obj.mesh.positions.array[o + 1]) > 1e-5) {
      const d = Math.hypot(obj.mesh.positions.array[o] - hit.localPoint[0],
                           obj.mesh.positions.array[o + 1] - hit.localPoint[1],
                           obj.mesh.positions.array[o + 2] - hit.localPoint[2]);
      far = Math.max(far, d);
    }
  }
  check('the edit stayed local to the pointer', far < 0.6, `furthest edit ${far.toFixed(3)} from the hit`);
}

/* ---- history: budget, redo invalidation, labels --------------------- */
{
  const { obj, history, engine, settings } = setup({ brush: 'draw' });
  drag(engine, 6);
  settings.brush = 'inflate';
  drag(engine, 6);
  eq('two strokes, two undo steps', history.undoStack.length, 2);
  eq('undo label reflects the last brush', history.undoLabel(), 'Inflate');
  history.undo();
  eq('redo label', history.redoLabel(), 'Inflate');
  check('redo is available', history.canRedo());
  drag(engine, 6);
  check('a new stroke clears redo', !history.canRedo());

  const tiny = new S.History(1);            // absurdly small budget
  const scene2 = new S.Scene();
  const o2 = new S.SceneObject('B', S.Prim.makeMesh('sphere', 3));
  scene2.add(o2);
  const e2 = new S.StrokeEngine({ scene: scene2, history: tiny, settings: defaultSettings(), camera: makeCamera(S) });
  for (let i = 0; i < 6; i++) drag(e2, 4);
  check('history keeps at least a couple of steps under a tiny budget',
    tiny.undoStack.length >= 2 && tiny.undoStack.length <= 3, `${tiny.undoStack.length}`);
  check('history reports its memory use', tiny.bytes > 0);
}

/* ---- a long continuous session stays valid ------------------------- */
{
  const { obj, history, engine, settings } = setup({ brush: 'clay', strength: 0.6, dyntopo: true, detailPercent: 22 }, 'sphere', 3);
  const brushes = ['clay', 'draw', 'inflate', 'crease', 'flatten', 'smooth', 'pinch', 'claystrips', 'scrape', 'fill'];
  for (let i = 0; i < brushes.length; i++) {
    settings.brush = brushes[i];
    settings.symmetryX = i % 2 === 0;
    const a = 360 + (i * 13) % 80, b = 260 + (i * 21) % 80;
    drag(engine, 8, [a, b], [a + 40, b + 20]);
  }
  audit(obj.mesh, 'after a 10-stroke mixed session');
  eq('mesh still closed after a mixed session', obj.mesh.countBorderEdges(), 0);
  check('mesh grew in detail', obj.mesh.liveTris > 1280, `${obj.mesh.liveTris}`);
  // undo everything, then redo everything
  const n = history.undoStack.length;
  for (let i = 0; i < n; i++) history.undo();
  audit(obj.mesh, 'after undoing the whole session');
  eq('back to the starting triangle count', obj.mesh.liveTris, 1280);
  for (let i = 0; i < n; i++) history.redo();
  audit(obj.mesh, 'after redoing the whole session');
  check('redo got the detail back', obj.mesh.liveTris > 1280);
}

/* ---- masks hold even with dynamic topology on ----------------------- */
{
  const { obj, engine, settings } = setup({ brush: 'clay', strength: 1, dyntopo: true, detailPercent: 15 }, 'sphere', 3);
  const mesh = obj.mesh;
  // mask everything the brush is about to touch
  const front = mesh.vertsInSphere(0, 0, 0.5, 0.35);
  const locked = [];
  for (const v of front) {
    mesh.masks.array[v] = 1;
    locked.push([v, mesh.positions.array[v * 3], mesh.positions.array[v * 3 + 1], mesh.positions.array[v * 3 + 2]]);
  }
  drag(engine, 14, [380, 300], [420, 300]);
  let moved = 0, gone = 0;
  for (const [v, x, y, z] of locked) {
    if (mesh.vertDead.array[v]) { gone++; continue; }
    const o = v * 3;
    if (Math.hypot(mesh.positions.array[o] - x, mesh.positions.array[o + 1] - y, mesh.positions.array[o + 2] - z) > 1e-7) moved++;
  }
  check('dyntopo does not move masked vertices', moved === 0, `${moved}/${locked.length} moved`);
  check('dyntopo does not delete masked vertices', gone === 0, `${gone} removed`);
  audit(mesh, 'masked dyntopo stroke');
  eq('mesh still closed', mesh.countBorderEdges(), 0);
}

/* ---- cancelling a stroke puts the geometry back --------------------- */
{
  for (const brushId of ['clay', 'paint', 'mask', 'move']) {
    const { obj, history, engine } = setup({ brush: brushId, strength: 1 }, 'sphere', 3);
    const mesh = obj.mesh;
    const pos0 = mesh.positions.copy(), col0 = mesh.colors.copy(), msk0 = mesh.masks.copy();
    engine.begin({ x: 400, y: 300, pressure: 1 });
    for (let i = 1; i <= 8; i++) engine.move({ x: 400 + i * 7, y: 300, pressure: 1 });
    const changedDuring = maxDelta(pos0, mesh.positions.view()) + maxDelta(col0, mesh.colors.view()) + maxDelta(msk0, mesh.masks.view());
    check(`${brushId}: the stroke changed something before cancelling`, changedDuring > 1e-5);
    engine.cancel();
    check(`${brushId}: cancel restored positions`, maxDelta(pos0, mesh.positions.view()) < 1e-7,
      `${maxDelta(pos0, mesh.positions.view())}`);
    check(`${brushId}: cancel restored colours`, maxDelta(col0, mesh.colors.view()) < 1e-7);
    check(`${brushId}: cancel restored the mask`, maxDelta(msk0, mesh.masks.view()) < 1e-7);
    eq(`${brushId}: cancel left no history entry`, history.undoStack.length, 0);
    audit(mesh, `${brushId} after cancel`);
  }

  // cancelling a topology-changing stroke has to restore the triangles too
  const { obj, history, engine } = setup({ brush: 'clay', strength: 1, dyntopo: true, detailPercent: 12 }, 'sphere', 3);
  const mesh = obj.mesh;
  const t0 = mesh.liveTris, pos0 = mesh.positions.copy();
  engine.begin({ x: 400, y: 300, pressure: 1 });
  for (let i = 1; i <= 10; i++) engine.move({ x: 400 + i * 6, y: 300, pressure: 1 });
  check('dyntopo stroke added triangles before cancelling', mesh.liveTris > t0);
  engine.cancel();
  eq('cancel restored the triangle count', mesh.liveTris, t0);
  check('cancel restored the positions exactly', maxDelta(pos0, mesh.positions.view()) < 1e-9);
  eq('cancel left no history entry', history.undoStack.length, 0);
  audit(mesh, 'after cancelling a dyntopo stroke');
}

report('brush');
