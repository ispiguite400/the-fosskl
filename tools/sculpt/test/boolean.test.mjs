import { load, check, eq, report, audit, volume } from './harness.mjs';
import { makeCamera, defaultSettings } from './stubcam.mjs';
const S = load();

function obj(prim, detail, pos, scale) {
  const o = new S.SceneObject(prim, S.Prim.makeMesh(prim, detail));
  if (pos) S.V3.set(o.position, pos[0], pos[1], pos[2]);
  if (scale) S.V3.set(o.scale, scale, scale, scale);
  o.touch();
  return o;
}

/* Two equal spheres of radius r, centres d apart, have an exactly known
   overlap: V = (pi/12)(4r + d)(2r - d)^2. Everything below is checked
   against that rather than against a previous run. */
const R = 0.5, D = 0.35;
const V_SPHERE = (4 / 3) * Math.PI * R * R * R;
const V_LENS = (Math.PI / 12) * (4 * R + D) * (2 * R - D) * (2 * R - D);

{
  const expected = {
    union: 2 * V_SPHERE - V_LENS,
    subtract: V_SPHERE - V_LENS,
    intersect: V_LENS
  };
  for (const mode of ['union', 'subtract', 'intersect']) {
    const A = obj('sphere', 4);
    const B = obj('sphere', 4, [D, 0, 0]);
    const res = S.Boolean.apply(A, B, { mode, resolution: 120, smooth: 1 });
    check(`${mode}: ran`, res.ok, res.reason || '');
    audit(A.mesh, `${mode} result`);
    eq(`${mode}: watertight`, A.mesh.countBorderEdges(), 0);
    eq(`${mode}: manifold`, A.mesh.countNonManifoldEdges(), 0);
    const got = volume(A.mesh);
    const want = expected[mode];
    check(`${mode}: volume matches the analytic value`, Math.abs(got - want) / want < 0.03,
      `${got.toFixed(5)} vs ${want.toFixed(5)} (${(Math.abs(got - want) / want * 100).toFixed(2)}%)`);
    check(`${mode}: result is a single sensible mesh`, A.mesh.liveTris > 1000, String(A.mesh.liveTris));
  }
}

/* ---- shapes that do not touch ---------------------------------------- */
{
  const far = [3, 0, 0];
  for (const mode of ['intersect', 'subtract']) {
    const A = obj('sphere', 3);
    const B = obj('sphere', 3, far);
    const before = A.mesh.liveTris;
    const res = S.Boolean.apply(A, B, { mode, resolution: 80 });
    check(`${mode} of separated shapes is refused`, !res.ok, JSON.stringify(res).slice(0, 80));
    check(`${mode} refusal explains itself`, !!res.reason && /overlap/i.test(res.reason), res.reason || '');
    eq(`${mode} refusal left the mesh alone`, A.mesh.liveTris, before);
  }
  // a union of separated shapes is legitimate: two shells in one object
  const A = obj('sphere', 3);
  const B = obj('sphere', 3, far);
  const res = S.Boolean.apply(A, B, { mode: 'union', resolution: 80, smooth: 0 });
  check('union of separated shapes works', res.ok, res.reason || '');
  audit(A.mesh, 'union of two separate shells');
  eq('two shells are still watertight', A.mesh.countBorderEdges(), 0);
  eq('two shells are still manifold', A.mesh.countNonManifoldEdges(), 0);
  check('union of separated shapes keeps both volumes',
    Math.abs(volume(A.mesh) - 2 * V_SPHERE) / (2 * V_SPHERE) < 0.06,
    `${volume(A.mesh).toFixed(4)} vs ${(2 * V_SPHERE).toFixed(4)}`);
}

/* ---- transforms ------------------------------------------------------ */
{
  // A is moved, rotated and scaled; the result must come back in A's local
  // space so the object keeps its transform and lands where it looked
  const A = obj('sphere', 4, [1.5, 0.4, -0.2], 1.6);
  S.Q4.fromEuler(A.rotation, 0.5, 0.9, 0.2);
  A.touch();
  const B = obj('box', 3, [1.5 + 0.4, 0.4, -0.2], 1.0);
  const worldMinBefore = S.V3.create(0, 0, 0), worldMaxBefore = S.V3.create(0, 0, 0);
  A.worldBounds(worldMinBefore, worldMaxBefore);

  const res = S.Boolean.apply(A, B, { mode: 'subtract', resolution: 110, smooth: 1 });
  check('boolean on a transformed object ran', res.ok, res.reason || '');
  audit(A.mesh, 'subtract on a transformed object');
  eq('still watertight', A.mesh.countBorderEdges(), 0);

  // the object's transform is untouched
  check('the transform is untouched', Math.abs(A.position[0] - 1.5) < 1e-6 && Math.abs(A.scale[0] - 1.6) < 1e-6,
    `pos ${A.position[0]}, scale ${A.scale[0]}`);
  // and the result occupies roughly where A was, minus the bite
  const mn = S.V3.create(0, 0, 0), mx = S.V3.create(0, 0, 0);
  A.worldBounds(mn, mx);
  let drift = 0;
  for (let k = 0; k < 3; k++) {
    drift = Math.max(drift, Math.abs(mn[k] - worldMinBefore[k]), Math.abs(mx[k] - worldMaxBefore[k]));
  }
  check('the result stayed where the object was', drift < 0.25, `worst corner moved ${drift.toFixed(3)}`);
  check('subtracting removed volume', volume(A.mesh) > 0 && volume(A.mesh) < V_SPHERE * 1.6 ** 3,
    String(volume(A.mesh).toFixed(4)));
}

/* ---- colour carries across ------------------------------------------- */
{
  const A = obj('sphere', 4);
  A.mesh.setColorAll(1, 0.1, 0.1);
  const B = obj('sphere', 4, [D, 0, 0]);
  B.mesh.setColorAll(0.1, 0.3, 1);
  const res = S.Boolean.apply(A, B, { mode: 'union', resolution: 110, smooth: 0, colors: true });
  check('coloured union ran', res.ok);
  let red = 0, blue = 0;
  const c = A.mesh.colors.array;
  for (let v = 0; v < A.mesh.masks.length; v++) {
    if (A.mesh.vertDead.array[v]) continue;
    const o = v * 3;
    if (c[o] > 0.7 && c[o + 2] < 0.4) red++;
    else if (c[o + 2] > 0.7 && c[o] < 0.4) blue++;
  }
  check('both colours survive the union', red > 100 && blue > 100, `red=${red} blue=${blue}`);
}

/* ---- the result is sculptable ---------------------------------------- */
{
  const scene = new S.Scene();
  const A = obj('sphere', 4);
  const B = obj('sphere', 4, [D, 0, 0]);
  scene.add(A);
  S.Boolean.apply(A, B, { mode: 'subtract', resolution: 110, smooth: 1 });
  const history = new S.History();
  const settings = defaultSettings({ brush: 'clay', strength: 0.6, dyntopo: false });
  const cam = makeCamera(S, { distance: 3 });
  const engine = new S.StrokeEngine({ scene, history, settings, camera: cam });
  const hit = engine.pick(400, 300);
  check('the boolean result can be picked', !!hit);
  const before = A.mesh.positions.copy();
  engine.begin({ x: 400, y: 300, pressure: 1 });
  for (let i = 1; i <= 10; i++) engine.move({ x: 400 + i * 6, y: 300, pressure: 1 });
  engine.end();
  let moved = 0;
  for (let i = 0; i < before.length; i++) if (Math.abs(before[i] - A.mesh.positions.array[i]) > 1e-5) moved++;
  check('the boolean result can be sculpted', moved > 30, String(moved));
  audit(A.mesh, 'sculpted boolean result');
  eq('still watertight after sculpting', A.mesh.countBorderEdges(), 0);
}

/* ---- join (no field, no rebuild) ------------------------------------- */
{
  const scene = new S.Scene();
  const A = obj('sphere', 3);
  const B = obj('box', 3, [0.8, 0, 0]);
  scene.add(A);
  scene.add(B);
  const totalBefore = A.mesh.liveTris + B.mesh.liveTris;
  const joined = scene.mergeObjects([0, 1], 'Joined');
  check('join produced an object', !!joined);
  eq('join keeps every triangle', joined.mesh.liveTris, totalBefore);
  audit(joined.mesh, 'joined object');
  check('join keeps both volumes', Math.abs(volume(joined.mesh) - (volume(A.mesh) + volume(B.mesh))) < 1e-4);
  // the box was offset, so the joined bounds must span both
  const mn = joined.mesh.boundsMin(), mx = joined.mesh.boundsMax();
  check('join spans both shapes', mx[0] > 1.2 && mn[0] < -0.4, `${mn[0].toFixed(2)}..${mx[0].toFixed(2)}`);
}

/* ---- modes are declared for the interface ---------------------------- */
{
  eq('three boolean modes', S.Boolean.MODES.length, 3);
  for (const m of S.Boolean.MODES) {
    check(`mode ${m.id} has a label, symbol and hint`, !!m.label && !!m.symbol && !!m.hint);
  }
  eq('unknown mode falls back to union', S.Boolean.modeById('nonsense').id, 'union');
}

report('boolean');
