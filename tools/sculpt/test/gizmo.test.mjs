/*
 * The transform gizmo: where the handles are, what a tap lands on, and what
 * a drag does to a shape. All of it is geometry, so all of it is checked
 * here rather than by eye in a browser.
 */
import { load, check, eq, report } from './harness.mjs';
import { makeCamera } from './stubcam.mjs';

const S = load();
const G = S.Gizmo, V3 = S.V3, Q4 = S.Q4, M4 = S.M4;

function scene(primitive = 'box', detail = 2) {
  const obj = new S.SceneObject('Shape', S.Prim.makeMesh(primitive, detail));
  return { obj, camera: makeCamera(S) };
}
function near(a, b, tol = 1e-4) { return Math.abs(a - b) <= tol; }
function vecNear(v, x, y, z, tol = 1e-4) {
  return near(v[0], x, tol) && near(v[1], y, tol) && near(v[2], z, tol);
}

/* ---- the camera stub has to agree with itself ---------------------- */
{
  const { camera } = scene();
  const p = V3.create(0.2, -0.1, 0.4);
  const scr = camera.project(p, [0, 0, 0]);
  const o = V3.create(0, 0, 0), d = V3.create(0, 0, 0);
  camera.rayFromScreen(scr[0], scr[1], o, d);
  const rel = V3.sub(V3.create(0, 0, 0), p, o);
  // the perpendicular distance from the ray, via the cross product: taking
  // it from |rel|² - (rel·d)² cancels almost everything away and measures
  // float32 rounding instead of the code
  const off = V3.len(V3.cross(V3.create(0, 0, 0), rel, d));
  check('the test camera projects and unprojects consistently', off < 1e-5, `${off}`);
}

/* ---- pivot and axes ------------------------------------------------ */
{
  const { obj, camera } = scene();
  check('the gizmo sits on the middle of the shape', vecNear(G.pivot(obj), 0, 0, 0));

  obj.position[0] = 0.5;
  obj.touch();
  check('it follows the shape when it moves', vecNear(G.pivot(obj), 0.5, 0, 0));

  // an off-centre mesh: the gizmo must follow the geometry, not the origin
  const off = new S.SceneObject('Off', S.Prim.makeMesh('box', 1));
  const shift = M4.identity(M4.create());
  shift[12] = 1;                              // move the vertices +1 in x
  off.mesh.applyMatrix(shift);
  check('an off-centre mesh puts the gizmo on the geometry',
    near(G.pivot(off)[0], 1, 1e-3), `${G.pivot(off)[0]}`);

  // rotation carries the handles with it
  const turned = new S.SceneObject('Turned', S.Prim.makeMesh('box', 1));
  Q4.setAxisAngle(turned.rotation, [0, 0, 1], Math.PI / 2);
  turned.touch();
  check('the handles follow the shape’s own axes',
    vecNear(G.axis(turned, 0), 0, 1, 0, 1e-5), Array.from(G.axis(turned, 0)).join(','));

  const layout = G.layout(obj, camera, 'move');
  eq('move mode has three arrows and a centre', layout.handles.length, 4);
  eq('the centre handle is a disc', layout.handles[3].kind, 'disc');
  const armPixels = Math.hypot(layout.handles[0].to[0] - layout.pivotScreen[0],
                               layout.handles[0].to[1] - layout.pivotScreen[1]);
  check('the arms are a constant size on screen', armPixels > 70 && armPixels < 100,
    `${armPixels.toFixed(1)} px`);

  // zoom out: the arms must stay the same length on screen
  const far = makeCamera(S, { distance: 9 });
  const farLayout = G.layout(obj, far, 'move');
  const farPixels = Math.hypot(farLayout.handles[0].to[0] - farLayout.pivotScreen[0],
                               farLayout.handles[0].to[1] - farLayout.pivotScreen[1]);
  check('and stay that size from further away', Math.abs(farPixels - armPixels) < 6,
    `${armPixels.toFixed(1)} vs ${farPixels.toFixed(1)}`);
  check('but cover more of the model in world units', farLayout.arm > layout.arm * 2,
    `${layout.arm.toFixed(3)} vs ${farLayout.arm.toFixed(3)}`);

  const scaleLayout = G.layout(obj, camera, 'scale');
  eq('size mode has three squares and a centre', scaleLayout.handles.length, 4);
  eq('the size handles are points', scaleLayout.handles[0].kind, 'point');
  const rotLayout = G.layout(obj, camera, 'rotate');
  eq('turn mode has three rings', rotLayout.handles.length, 3);
  eq('a ring is a closed polyline', rotLayout.handles[0].points.length, 49);
  check('a ring closes on itself',
    rotLayout.handles[0].points[0][0] === rotLayout.handles[0].points[48][0], '');
}

/* ---- hit testing --------------------------------------------------- */
{
  const { obj, camera } = scene();
  const layout = G.layout(obj, camera, 'move');
  const xTip = layout.handles[0].to;
  eq('a tap on the X arrow picks it', G.pick(layout, xTip[0], xTip[1]).id, 'move-0');
  eq('a tap halfway along the arrow picks it too',
    G.pick(layout, (xTip[0] + layout.pivotScreen[0]) / 2, xTip[1]).id, 'move-0');
  eq('a tap in the middle picks the free handle',
    G.pick(layout, layout.pivotScreen[0], layout.pivotScreen[1]).id, 'move-free');
  check('a tap in empty space picks nothing',
    G.pick(layout, layout.pivotScreen[0] + 320, layout.pivotScreen[1] + 240) === null);
  check('a near miss respects the tolerance',
    G.pick(layout, xTip[0], xTip[1] + 40, 12) === null);
  check('and a fat finger still lands',
    G.pick(layout, xTip[0], xTip[1] + 20, 24) !== null);

  const rings = G.layout(obj, camera, 'rotate');
  const onRing = rings.handles[2].points[12];
  const picked = G.pick(rings, onRing[0], onRing[1]);
  check('a tap on a ring picks that ring', picked && picked.kind === 'ring',
    picked ? picked.id : 'null');
  check('the middle of a ring gizmo is not a handle',
    G.pick(rings, rings.pivotScreen[0], rings.pivotScreen[1], 6) === null);
}

/* ---- dragging: move ------------------------------------------------ */
{
  const { obj, camera } = scene();
  const layout = G.layout(obj, camera, 'move');
  const tip = layout.handles[0].to;
  const drag = G.beginDrag(obj, camera, layout.handles[0], tip[0], tip[1]);
  check('a drag on an arrow starts', !!drag);
  const moved = G.drag(drag, tip[0] + 80, tip[1]);
  check('dragging reports a change', moved);
  check('an arrow moves along its own axis only',
    obj.position[0] > 0.1 && near(obj.position[1], 0) && near(obj.position[2], 0),
    Array.from(obj.position).join(','));
  // the shape should end up under the pointer: the pivot's new screen position
  // must be about 80px right of where it was
  const after = camera.project(G.pivot(obj), [0, 0, 0]);
  check('the shape follows the finger', Math.abs(after[0] - (layout.pivotScreen[0] + 80)) < 2,
    `${after[0].toFixed(1)} vs ${(layout.pivotScreen[0] + 80).toFixed(1)}`);

  // dragging back returns it
  G.drag(drag, tip[0], tip[1]);
  check('dragging back puts it where it started', vecNear(obj.position, 0, 0, 0, 1e-3),
    Array.from(obj.position).join(','));

  // the free handle moves it across the screen plane
  const free = G.beginDrag(obj, camera, layout.handles[3], layout.pivotScreen[0], layout.pivotScreen[1]);
  G.drag(free, layout.pivotScreen[0] + 60, layout.pivotScreen[1] - 40);
  check('the centre handle moves it in two directions at once',
    obj.position[0] > 0.05 && obj.position[1] > 0.05, Array.from(obj.position).join(','));

  // an axis pointing straight at the camera cannot be dragged sensibly
  const flat = new S.SceneObject('Flat', S.Prim.makeMesh('box', 1));
  const zLayout = G.layout(flat, camera, 'move');
  const zHandle = zLayout.handles[2];        // local z points at the camera
  check('a handle pointing at the camera refuses the drag',
    G.beginDrag(flat, camera, zHandle, zLayout.pivotScreen[0], zLayout.pivotScreen[1]) === null);
}

/* ---- dragging: snapping -------------------------------------------- */
{
  const { obj, camera } = scene();
  const layout = G.layout(obj, camera, 'move');
  const tip = layout.handles[0].to;
  const drag = G.beginDrag(obj, camera, layout.handles[0], tip[0], tip[1]);
  G.drag(drag, tip[0] + 33, tip[1], { snap: true });
  const step = camera.worldPerPixel(layout.pivot) * 20;
  const steps = obj.position[0] / step;
  check('snapping lands on whole steps', Math.abs(steps - Math.round(steps)) < 1e-4,
    `${steps}`);
}

/* ---- dragging: rotate ---------------------------------------------- */
{
  const { obj, camera } = scene();
  const rings = G.layout(obj, camera, 'rotate');
  // the ring around local z faces the camera, so it is the easy one to drive
  const zRing = rings.handles[2];
  const start = zRing.points[0];
  const drag = G.beginDrag(obj, camera, zRing, start[0], start[1]);
  check('a ring drag starts', !!drag);
  // a quarter of the way around the ring
  const quarter = zRing.points[Math.round(48 / 4)];
  G.drag(drag, quarter[0], quarter[1]);
  const axis = G.axis(obj, 0);
  check('a quarter turn around the ring turns the shape 90°',
    Math.abs(Math.abs(axis[1]) - 1) < 0.02, Array.from(axis).join(','));

  // the middle of the shape must not wander while it turns
  const off = new S.SceneObject('Off', S.Prim.makeMesh('box', 1));
  const shift = M4.identity(M4.create());
  shift[12] = 1.5;
  off.mesh.applyMatrix(shift);
  const pivotBefore = G.pivot(off);
  const offRings = G.layout(off, camera, 'rotate');
  const offRing = offRings.handles[2];
  const d2 = G.beginDrag(off, camera, offRing, offRing.points[0][0], offRing.points[0][1]);
  G.drag(d2, offRing.points[8][0], offRing.points[8][1]);
  const pivotAfter = G.pivot(off);
  check('turning happens about the middle of the shape, which stays put',
    V3.dist(pivotBefore, pivotAfter) < 1e-3,
    `${Array.from(pivotBefore).join(',')} -> ${Array.from(pivotAfter).join(',')}`);
  check('and it really did turn', Math.abs(off.rotation[2]) > 0.01, Array.from(off.rotation).join(','));

  // snapping to 15 degrees
  const snapObj = new S.SceneObject('Snap', S.Prim.makeMesh('box', 1));
  const snapRings = G.layout(snapObj, camera, 'rotate');
  const sr = snapRings.handles[2];
  const d3 = G.beginDrag(snapObj, camera, sr, sr.points[0][0], sr.points[0][1]);
  G.drag(d3, sr.points[3][0], sr.points[3][1], { snap: true });
  const euler = Q4.toEuler([0, 0, 0], snapObj.rotation);
  const deg = euler[2] * 180 / Math.PI;
  check('turning snaps to 15° steps', Math.abs(deg / 15 - Math.round(deg / 15)) < 0.02,
    `${deg.toFixed(2)}°`);
}

/* ---- dragging: scale ----------------------------------------------- */
{
  const { obj, camera } = scene();
  const layout = G.layout(obj, camera, 'scale');
  const xHandle = layout.handles[0];
  const drag = G.beginDrag(obj, camera, xHandle, xHandle.at[0], xHandle.at[1]);
  check('a size handle starts a drag', !!drag);
  G.drag(drag, xHandle.at[0] + 43, xHandle.at[1]);
  check('dragging a square stretches that axis', obj.scale[0] > 1.3, `${obj.scale[0].toFixed(3)}`);
  eq('and leaves the other two alone', obj.scale[1] === 1 && obj.scale[2] === 1, true);

  G.drag(drag, xHandle.at[0] - 200, xHandle.at[1]);
  check('a size can never go to zero or negative', obj.scale[0] >= 0.0199, `${obj.scale[0]}`);

  // the middle stays put while it resizes
  const off = new S.SceneObject('Off', S.Prim.makeMesh('box', 1));
  const shift = M4.identity(M4.create());
  shift[13] = -1.2;
  off.mesh.applyMatrix(shift);
  const before = G.pivot(off);
  const offLayout = G.layout(off, camera, 'scale');
  const d2 = G.beginDrag(off, camera, offLayout.handles[1], offLayout.handles[1].at[0], offLayout.handles[1].at[1]);
  G.drag(d2, offLayout.handles[1].at[0], offLayout.handles[1].at[1] - 30);
  check('resizing happens about the middle of the shape',
    V3.dist(before, G.pivot(off)) < 1e-3,
    `${Array.from(before).join(',')} -> ${Array.from(G.pivot(off)).join(',')}`);
  check('and the size really changed', Math.abs(off.scale[1] - 1) > 0.05, `${off.scale[1]}`);

  // the centre disc resizes evenly
  const even = new S.SceneObject('Even', S.Prim.makeMesh('box', 1));
  const evenLayout = G.layout(even, camera, 'scale');
  const disc = evenLayout.handles[3];
  const d3 = G.beginDrag(even, camera, disc, disc.at[0] + 40, disc.at[1]);
  G.drag(d3, disc.at[0] + 80, disc.at[1]);
  check('the centre handle resizes evenly',
    near(even.scale[0], even.scale[1], 1e-6) && near(even.scale[1], even.scale[2], 1e-6) &&
    even.scale[0] > 1.5, Array.from(even.scale).join(','));
}

/* ---- capture, restore, describe ------------------------------------ */
{
  const { obj } = scene();
  obj.position[0] = 0.3;
  Q4.setAxisAngle(obj.rotation, [0, 1, 0], 0.7);
  V3.set(obj.scale, 1.4, 0.8, 2);
  obj.touch();
  const snap = G.captureTransform(obj);

  V3.set(obj.position, 9, 9, 9);
  V3.set(obj.scale, 5, 5, 5);
  Q4.identity(obj.rotation);
  obj.touch();
  G.applyTransform(obj, snap);
  check('a transform round trips through capture and apply',
    vecNear(obj.position, 0.3, 0, 0) && near(obj.scale[0], 1.4) && near(obj.scale[2], 2) &&
    Math.abs(obj.rotation[1]) > 0.3, Array.from(obj.position).join(','));

  const d = G.describe(obj);
  eq('describe reads out the position', d.position, '0.30, 0.00, 0.00');
  check('describe reads out the size', /1\.40, 0\.80, 2\.00/.test(d.scale), d.scale);
  check('describe reads out the turn in degrees', /°/.test(d.rotation), d.rotation);
  eq('and knows when the size is uneven', d.uniform, false);
}

/* ---- the modes are what the interface offers ----------------------- */
{
  eq('there are three modes', G.MODES.length, 3);
  eq('their ids', G.MODES.map((m) => m.id).join(','), 'move,rotate,scale');
  check('each mode explains itself', G.MODES.every((m) => m.label && m.hint && m.icon));
  eq('three axis colours', G.AXIS_COLOR.length, 3);
}

report('gizmo');
