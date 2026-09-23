import { load, check, eq, report } from './harness.mjs';
const S = load();
const Rig = S.Rig;

/*
 * A stick figure built from clay: a torso, two legs, two arms held away from
 * the body, a head, and a separate "prop" in the right hand. Everything
 * below is checked against where each part obviously belongs.
 */
function figure() {
  const parts = [
    ['capsule', [0, 1.2, 0], [0.7, 0.9, 0.5]],          // torso
    ['capsule', [0.09, 0.55, 0], [0.3, 1.0, 0.3]],       // left leg
    ['capsule', [-0.09, 0.55, 0], [0.3, 1.0, 0.3]],      // right leg
    ['capsule', [0.3, 1.2, 0], [0.2, 0.85, 0.2]],        // left arm, clear of the torso
    ['capsule', [-0.3, 1.2, 0], [0.2, 0.85, 0.2]],       // right arm
    ['sphere', [0, 1.65, 0], [0.22, 0.26, 0.24]]         // head
  ];
  let mesh = null;
  const objs = parts.map(([prim, pos, scale]) => {
    const o = new S.SceneObject(prim, S.Prim.makeMesh(prim, prim === 'sphere' ? 3 : 8));
    S.V3.set(o.position, pos[0], pos[1], pos[2]);
    S.V3.set(o.scale, scale[0], scale[1], scale[2]);
    o.touch();
    return o;
  });
  const body = objs[0];
  for (let i = 1; i < objs.length; i++) S.Boolean.apply(body, objs[i], { mode: 'union', resolution: 90, smooth: 1 });
  body.applyTransform();
  mesh = body.mesh;
  // the prop: a separate box in the right hand, joined without welding
  const prop = new S.SceneObject('prop', S.Prim.makeMesh('box', 2));
  S.V3.set(prop.position, -0.3, 0.8, 0.12); S.V3.set(prop.scale, 0.05, 0.3, 0.05); prop.touch();
  const scene = new S.Scene();
  scene.add(body); scene.add(prop);
  const merged = scene.mergeObjects([0, 1], 'figure');
  return merged;
}

const fig = figure();
const mn = S.V3.create(0, 0, 0), mx = S.V3.create(0, 0, 0);
fig.worldBounds(mn, mx);

/* ---- skeleton ---- */
const sk = Rig.humanoid(mn, mx);
eq('humanoid: 21 bones', sk.bones.length, 21);
check('humanoid: one root', sk.bones.filter((b) => b.parent < 0).length === 1);
check('humanoid: every parent comes first', sk.bones.every((b, i) => b.parent < i));
const L = Rig.indexOf(sk, 'UpperArm.L'), Rr = Rig.indexOf(sk, 'UpperArm.R');
check('humanoid: mirrored arms', Math.abs(sk.bones[L].head[0] + sk.bones[Rr].head[0] - (mn[0] + mx[0])) < 1e-6);
check('humanoid: head above hips', sk.bones[Rig.indexOf(sk, 'Head')].head[1] > sk.bones[Rig.indexOf(sk, 'Hips')].head[1]);
eq('mirror name', Rig.mirrorName('Hand.L'), 'Hand.R');

// fit the joints to this figure, as someone would in the joint editor
const place = {
  'Hips': [0, 1.0, 0], 'Spine': [0, 1.12, 0], 'Chest': [0, 1.3, 0], 'Neck': [0, 1.46, 0], 'Head': [0, 1.52, 0],
  'Shoulder.L': [0.05, 1.5, 0], 'UpperArm.L': [0.3, 1.5, 0], 'LowerArm.L': [0.3, 1.2, 0], 'Hand.L': [0.3, 0.95, 0],
  'UpperLeg.L': [0.09, 1.0, 0], 'LowerLeg.L': [0.09, 0.55, 0], 'Foot.L': [0.09, 0.12, 0], 'Toes.L': [0.09, 0.05, 0.08]
};
for (const b of sk.bones) {
  const src = place[b.name] || place[Rig.mirrorName(b.name)];
  b.head = [src[0] * (place[b.name] ? 1 : -1), src[1], src[2]];
}
sk.bones[Rig.indexOf(sk, 'Hand.L')].tail = [0.3, 0.8, 0];
sk.bones[Rig.indexOf(sk, 'Hand.R')].tail = [-0.3, 0.8, 0];

/* ---- weights ---- */
const bind = Rig.computeWeights(fig.mesh, fig.matrix(), sk, { visibilityResolution: 80 });
const m = fig.mesh, P = m.positions.array, nv = m.vertCount(), dead = m.vertDead.array;
let sumOk = true, owners = {};
function ownerAt(pred) {
  const count = {};
  for (let v = 0; v < nv; v++) {
    if (dead[v]) continue;
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    if (!pred(x, y, z)) continue;
    const name = sk.bones[bind.joints[v * 4]].name;
    count[name] = (count[name] || 0) + 1;
  }
  let best = null;
  for (const k in count) if (!best || count[k] > count[best]) best = k;
  return { best, count };
}
for (let v = 0; v < nv; v++) {
  if (dead[v]) continue;
  const s = bind.weights[v * 4] + bind.weights[v * 4 + 1] + bind.weights[v * 4 + 2] + bind.weights[v * 4 + 3];
  if (Math.abs(s - 1) > 1e-4) sumOk = false;
  for (let k = 0; k < 4; k++) if (bind.joints[v * 4 + k] >= sk.bones.length) sumOk = false;
}
check('weights: four per vertex, summing to one, valid joints', sumOk);
eq('weights: the prop is one rigid piece', bind.summary.rigid.length, 1);
eq('weights: the prop rides the right hand', bind.summary.rigid[0] && bind.summary.rigid[0].bone, 'Hand.R');
eq('weights: shin goes to the lower leg', ownerAt((x, y) => x > 0.03 && y > 0.3 && y < 0.4).best, 'LowerLeg.L');
eq('weights: thigh goes to the upper leg', ownerAt((x, y) => x < -0.03 && x > -0.2 && y > 0.75 && y < 0.85).best, 'UpperLeg.R');
eq('weights: forearm goes to the lower arm', ownerAt((x, y) => x > 0.24 && y > 1.02 && y < 1.12).best, 'LowerArm.L');
eq('weights: head goes to the head', ownerAt((x, y) => y > 1.7).best, 'Head');
const side = ownerAt((x, y, z) => Math.abs(x) > 0.1 && Math.abs(x) < 0.17 && y > 1.1 && y < 1.3 && Math.abs(z) < 0.05);
check('weights: the side of the torso is not given to the arms',
  !/Arm/.test(side.best || ''), JSON.stringify(side.count));

/* ---- posing ---- */
{
  const rest = Rig.poseMatrices(sk, {});
  let ident = true;
  for (let i = 0; i < rest.length; i++) if (Math.abs(rest[i] - (i % 16 % 5 === 0 ? 1 : 0)) > 1e-6) ident = false;
  check('pose: the rest pose moves nothing', ident);

  const W = new Float32Array(nv * 3), N = m.normals.array.slice(0, nv * 3), outP = new Float32Array(nv * 3), outN = new Float32Array(nv * 3);
  W.set(P.subarray(0, nv * 3));
  Rig.skin(bind, Rig.poseMatrices(sk, { 'UpperArm.L': { z: 90 } }), W, N, outP, outN, nv);
  // the left hand swings from hanging down to straight out sideways
  let handBefore = null, handAfter = null;
  for (let v = 0; v < nv; v++) {
    if (dead[v]) continue;
    if (Math.abs(W[v * 3] - 0.3) < 0.03 && Math.abs(W[v * 3 + 1] - 0.85) < 0.02) { handBefore = [W[v * 3], W[v * 3 + 1]]; handAfter = [outP[v * 3], outP[v * 3 + 1]]; break; }
  }
  check('pose: found a hand vertex', !!handBefore);
  if (handBefore) {
    check('pose: raising the arm lifts the hand to shoulder height', Math.abs(handAfter[1] - 1.5) < 0.08, JSON.stringify(handAfter));
    check('pose: and swings it out to the side', handAfter[0] > 0.9, JSON.stringify(handAfter));
  }
  let feetStill = true;
  for (let v = 0; v < nv; v++) if (!dead[v] && W[v * 3 + 1] < 0.4 && Math.hypot(outP[v * 3] - W[v * 3], outP[v * 3 + 1] - W[v * 3 + 1], outP[v * 3 + 2] - W[v * 3 + 2]) > 1e-4) feetStill = false;
  check('pose: the legs stay where they were', feetStill);

  const crouch = Rig.poseMatrices(sk, Rig.resolvePose(sk, Rig.POSES.crouch.pose));
  check('pose: the test poses resolve', crouch.length === sk.bones.length * 16 && crouch.every(Number.isFinite));
}

/* ---- the skinned GLB ---- */
{
  const buf = Rig.exportGLB(fig, sk, bind, { includeColors: true });
  const dv = new DataView(buf);
  eq('glb: magic', dv.getUint32(0, true), 0x46546C67);
  const jlen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jlen)));
  eq('glb: one skin', (json.skins || []).length, 1);
  eq('glb: a joint per bone', json.skins[0].joints.length, sk.bones.length);
  const prim = json.meshes[0].primitives[0];
  check('glb: joints and weights on the mesh', prim.attributes.JOINTS_0 !== undefined && prim.attributes.WEIGHTS_0 !== undefined);
  eq('glb: the mesh node uses the skin', json.nodes[0].skin, 0);
  const ibm = json.accessors[json.skins[0].inverseBindMatrices];
  eq('glb: an inverse bind matrix per joint', ibm.count, sk.bones.length);
  eq('glb: matrices are MAT4', ibm.type, 'MAT4');
  // every joint node sits where its bone does (sum of translations down the chain)
  let placed = true;
  const joints = json.skins[0].joints;
  const world = (ni) => {
    const n = json.nodes[ni];
    const parent = json.nodes.findIndex((p) => p.children && p.children.includes(ni));
    const pw = parent >= 0 ? world(parent) : [0, 0, 0];
    return [pw[0] + n.translation[0], pw[1] + n.translation[1], pw[2] + n.translation[2]];
  };
  joints.forEach((ni, k) => {
    const w = world(ni), h = sk.bones[k].head;
    if (Math.hypot(w[0] - h[0], w[1] - h[1], w[2] - h[2]) > 1e-5) placed = false;
  });
  check('glb: joints are where the bones are', placed);
  eq('glb: vertex count matches the weights', json.accessors[prim.attributes.JOINTS_0].count, json.accessors[prim.attributes.POSITION].count);
  let inRange = true;
  for (const v of json.bufferViews) if (v.byteOffset + v.byteLength > json.buffers[0].byteLength) inRange = false;
  check('glb: every buffer view is inside the buffer', inRange);
}

/* ---- a project keeps the skeleton ---- */
{
  const data = S.IO.saveProject({ objects: [fig], selected: 0, rig: { skeleton: Rig.clone(sk), object: 0, mirror: true } });
  const back = S.IO.loadProject(data);
  check('project: loads', back.ok);
  eq('project: keeps the bones', back.rig && back.rig.skeleton.bones.length, sk.bones.length);
  check('project: keeps where they are', back.rig && Math.abs(back.rig.skeleton.bones[5].head[1] - sk.bones[5].head[1]) < 1e-9);
}

report('rig');
