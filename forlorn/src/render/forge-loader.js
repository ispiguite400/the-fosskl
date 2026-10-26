/*
 * Advance Forge — load a forged character into a Three.js game.
 *
 *   import * as THREE from 'three';
 *   import { loadForgeCharacter } from './forge-loader.js';
 *
 *   const hero = await loadForgeCharacter('assets/models/ronin_animated.glb', THREE);
 *   scene.add(hero.root);
 *   hero.play('Walk');                    // AnimationMixer clips baked by animate.mjs --bake
 *   // each frame: hero.update(dt);
 *
 *   // or drive it procedurally like the game's own humanoids:
 *   hero.rig.legL.hip.rotation.x = swing;   // same names as buildHumanoid()'s rig
 *
 * Reads the skinned GLBs that SculptFree's rig exports (one skinned mesh with
 * vertex colours, a joint hierarchy, optional animations). It has no
 * dependency beyond the THREE namespace you pass in, so it works with the
 * game's vendored three.module.js, which has no GLTFLoader.
 *
 * Returned object:
 *   root      THREE.Group to add to the scene (feet at y = 0, facing +Z)
 *   mesh      the THREE.SkinnedMesh
 *   bones     { [boneName]: THREE.Bone }
 *   rig       the game's joint names, mapped onto the bones:
 *               hips, torso, head, armL/armR { shoulder, elbow, hand },
 *               legL/legR { hip, knee }
 *             Game "L" is the -X side (the character's right hand side when
 *             it faces +Z), matching buildHumanoid(); the bones are named
 *             from the character's own point of view, so rig.armL is
 *             bones['UpperArm.R']. Rest rotation is zero on every joint, so
 *             the same rotations the game gives its primitive humanoids
 *             work unchanged.
 *   clips     THREE.AnimationClip[] (empty if the file has none)
 *   mixer     THREE.AnimationMixer on the root
 *   play(name, { fade = 0.2, loop = true })  crossfade to a clip by name
 *   update(dt)  advance the mixer
 *   height    model height in metres
 *   tposed    true when the file was a T-pose (the arms were lowered on load)
 *
 * Characters are exported in a T-pose. On load, the arms are lowered to
 * hang a little out from the body and that becomes the rest pose (joint
 * rotations back to zero), so "rotation 0 = arms down", as the game's own
 * humanoids and procedural animation expect. Pass { armsDown: false } to
 * keep the T-pose.
 */

export async function loadForgeCharacter(source, THREE, opts = {}) {
  const buf = typeof source === 'string' ? await (await fetch(source)).arrayBuffer() : source;
  const ch = buildForgeCharacter(buf, THREE, opts);
  await ch.ready;                                   // never hand back a character whose texture has not arrived
  return ch;
}

export function buildForgeCharacter(buf, THREE, opts = {}) {
  const { json, bin } = parseGLB(buf);
  const acc = (i) => readAccessor(json, bin, i);

  const skinDef = (json.skins || [])[0];
  const meshNodeIndex = json.nodes.findIndex((n) => n.mesh !== undefined);
  if (meshNodeIndex < 0) throw new Error('forge-loader: no mesh in this file');
  const prim = json.meshes[json.nodes[meshNodeIndex].mesh].primitives[0];
  const at = prim.attributes;
  const positions = acc(at.POSITION).data, normals = at.NORMAL !== undefined ? acc(at.NORMAL).data : null;
  const skinned = !!(skinDef && at.JOINTS_0 !== undefined);
  const jointIdx = skinned ? acc(at.JOINTS_0).data : null, weightsArr = skinned ? acc(at.WEIGHTS_0).data : null;
  const ibmArr = skinned && skinDef.inverseBindMatrices !== undefined ? acc(skinDef.inverseBindMatrices).data : null;

  /* ---- a T-posed character is given arms-down as its rest (see armsDownRest) ---- */
  const raw = json.nodes.map((n) => ({ name: n.name || '', t: (n.translation || [0, 0, 0]).slice(), r: (n.rotation || [0, 0, 0, 1]).slice(), parent: -1 }));
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => { raw[c].parent = i; }));
  let conv = null;
  if (skinned && ibmArr && opts.armsDown !== false) {
    conv = armsDownRest(raw, skinDef.joints, ibmArr, [{ pos: positions, nor: normals, jn: jointIdx, wt: weightsArr }], opts.hang ?? 8);
  }

  /* ---- joints ---- */
  const nodes = json.nodes.map((n, i) => {
    const isJoint = skinDef && skinDef.joints.includes(i);
    const o = isJoint ? new THREE.Bone() : new THREE.Group();
    o.name = n.name || 'node' + i;
    o.position.fromArray(raw[i].t);
    o.quaternion.fromArray(raw[i].r);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => nodes[i].add(nodes[c])));

  /* ---- the mesh ---- */
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (at.TEXCOORD_0 !== undefined) geo.setAttribute('uv', new THREE.BufferAttribute(acc(at.TEXCOORD_0).data, 2));
  if (at.COLOR_0 !== undefined) {
    // SculptFree paints in sRGB; three.js lights vertex colours as linear, so convert or everything washes out
    const c = acc(at.COLOR_0), d = c.data;
    if (opts.srgbColors !== false) for (let i = 0; i < d.length; i++) {
      if (c.size === 4 && i % 4 === 3) continue;
      const v = d[i]; d[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(d, c.size));
  }
  if (prim.indices !== undefined) geo.setIndex(new THREE.BufferAttribute(acc(prim.indices).data, 1));
  if (at.NORMAL === undefined) geo.computeVertexNormals();

  // the colour texture (ship.mjs bakes one), from the GLB's own binary chunk
  let map = null, ready = Promise.resolve();
  const pbr = prim.material !== undefined && json.materials && json.materials[prim.material].pbrMetallicRoughness;
  if (pbr && pbr.baseColorTexture && json.images && at.TEXCOORD_0 !== undefined) {
    const img = json.images[json.textures[pbr.baseColorTexture.index].source], bv = json.bufferViews[img.bufferView];
    const bytes = new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength).slice();
    const el = new Image();
    map = new THREE.Texture(el);
    map.flipY = false;                                  // glTF UVs start top-left
    if ('colorSpace' in map) map.colorSpace = THREE.SRGBColorSpace; else map.encoding = 3001;
    ready = new Promise((resolve) => {
      el.onload = () => { map.needsUpdate = true; URL.revokeObjectURL(el.src); resolve(); };
      el.onerror = () => resolve();
    });
    el.src = URL.createObjectURL(new Blob([bytes], { type: img.mimeType || 'image/png' }));
  }
  const material = opts.material || new THREE.MeshStandardMaterial({
    map,
    vertexColors: at.COLOR_0 !== undefined && !map,
    roughness: opts.roughness ?? 0.82,
    metalness: opts.metalness ?? 0.04
  });
  // the game gives every material a sliver of self-colour so nothing turns into a black silhouette at night
  if (!opts.material && opts.emissive !== false) material.emissive = new THREE.Color(opts.emissive ?? 0x1a1a1a);

  let mesh;
  const root = new THREE.Group();
  root.name = opts.name || json.nodes[meshNodeIndex].name || 'forged';
  if (skinned) {
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(jointIdx), 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(weightsArr, 4));
    mesh = new THREE.SkinnedMesh(geo, material);
    const bones = skinDef.joints.map((j) => nodes[j]);
    const inverses = bones.map((b, k) => ibmArr ? new THREE.Matrix4().fromArray(ibmArr, k * 16) : new THREE.Matrix4());
    // joint roots go under the model root, beside the mesh
    json.scenes[json.scene || 0].nodes.forEach((n) => { if (n !== meshNodeIndex) root.add(nodes[n]); });
    root.add(mesh);
    root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
  } else {
    mesh = new THREE.Mesh(geo, material);
    root.add(mesh);
  }
  mesh.castShadow = opts.castShadow ?? true;
  mesh.receiveShadow = opts.receiveShadow ?? true;
  mesh.frustumCulled = false;                 // skinned bounds are the rest pose; a crouch would pop out

  /* ---- names the game already animates ---- */
  const bones = {};
  nodes.forEach((n) => { if (n.isBone) bones[n.name] = n; });
  const B = (n) => bones[n] || null;
  const rig = {
    hips: B('Hips'), torso: B('Chest') || B('Spine'), spine: B('Spine'), head: B('Neck') || B('Head'), skull: B('Head'),
    armL: { shoulder: B('UpperArm.R'), elbow: B('LowerArm.R'), hand: B('Hand.R') },
    armR: { shoulder: B('UpperArm.L'), elbow: B('LowerArm.L'), hand: B('Hand.L') },
    legL: { hip: B('UpperLeg.R'), knee: B('LowerLeg.R'), foot: B('Foot.R') },
    legR: { hip: B('UpperLeg.L'), knee: B('LowerLeg.L'), foot: B('Foot.L') }
  };

  /* ---- animations ---- */
  const clips = (json.animations || []).map((a, k) => {
    const tracks = [];
    for (const ch of a.channels) {
      const s = a.samplers[ch.sampler], node = nodes[ch.target.node];
      if (!node) continue;
      const times = acc(s.input).data, values = acc(s.output).data;
      if (conv && ch.target.path === 'rotation') for (let q = 0; q < values.length; q += 4) values.set(conv.toConverted(ch.target.node, Array.from(values.subarray(q, q + 4))), q);
      const interp = s.interpolation === 'STEP' ? THREE.InterpolateDiscrete : THREE.InterpolateLinear;
      if (ch.target.path === 'rotation') tracks.push(new THREE.QuaternionKeyframeTrack(node.uuid + '.quaternion', times, values, interp));
      else if (ch.target.path === 'translation') tracks.push(new THREE.VectorKeyframeTrack(node.uuid + '.position', times, values, interp));
      else if (ch.target.path === 'scale') tracks.push(new THREE.VectorKeyframeTrack(node.uuid + '.scale', times, values, interp));
    }
    return new THREE.AnimationClip(a.name || 'clip' + k, -1, tracks);
  });
  const mixer = new THREE.AnimationMixer(root);
  let current = null;
  const box = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);

  root.userData.rig = rig;
  root.userData.height = box.max.y - box.min.y;
  return {
    root, mesh, bones, rig, clips, mixer, height: box.max.y - box.min.y, tposed: !!conv, ready,
    play(name, { fade = 0.2, loop = true } = {}) {
      const clip = clips.find((c) => c.name === name) || clips.find((c) => c.name.toLowerCase().startsWith(String(name).toLowerCase()));
      if (!clip) throw new Error('forge-loader: no clip "' + name + '" (have: ' + clips.map((c) => c.name).join(', ') + ')');
      const action = mixer.clipAction(clip);
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = !loop;
      action.reset().play();
      if (current && current !== action) current.crossFadeTo(action, fade, false);
      current = action;
      return action;
    },
    update(dt) { mixer.update(dt); }
  };
}

/*
 * armsDownRest — turn a T-posed skinned model into an arms-down one at load.
 *
 * Characters are sculpted and exported in a T-pose (arms straight out),
 * which is what rigs cleanly. Animation code, though, is written for arms
 * that hang: "rotation 0 = arm down" is what the game's rig and the clips
 * assume. So on load the arms are lowered to hang a little out from the
 * body, the mesh is skinned into that pose, and that pose becomes the new
 * rest: every joint back to identity rotation, joint positions and inverse
 * bind matrices recomputed. The file itself is untouched.
 *
 * Rotations recorded against the T-pose (animations inside the file) and
 * against the new rest (anything authored here) convert both ways:
 *   upper arm:        conv = orig * q^-1        orig = conv * q
 *   below the arm:    conv = q * orig * q^-1    orig = q^-1 * conv * q
 * where q is the rotation that lowered that arm.
 *
 * nodes:  [{ name, t:[3], r:[4], parent }]  (edited in place)
 * joints: node index per skin joint
 * ibm:    Float32Array(joints.length * 16)   (edited in place)
 * prims:  [{ pos, nor, jn, wt }] skinned vertex data (edited in place)
 * Returns null when the model is not in a T-pose or has rest rotations
 * this does not handle; otherwise { angle, toConverted(i, q), toOriginal(i, q) }.
 */
function armsDownRest(nodes, joints, ibm, prims, hangDeg) {
  const byName = {};
  nodes.forEach((n, i) => { byName[n.name] = i; });
  const need = ['UpperArm.L', 'LowerArm.L', 'UpperArm.R', 'LowerArm.R'];
  if (!need.every((n) => byName[n] !== undefined)) return null;
  // only rigs whose rest rotations are all identity (what SculptFree exports)
  if (joints.some((j) => { const r = nodes[j].r; return Math.abs(r[3]) < 0.99999; })) return null;
  const world = () => {
    const W = nodes.map(() => null);
    const solve = (i) => {
      if (W[i]) return W[i];
      const n = nodes[i], L = trs(n.t, n.r);
      W[i] = n.parent >= 0 ? mul4(solve(n.parent), L) : L;
      return W[i];
    };
    nodes.forEach((_, i) => solve(i));
    return W;
  };
  const W0 = world(), pos = (W, i) => [W[i][12], W[i][13], W[i][14]];
  const a0 = pos(W0, byName['UpperArm.L']), b0 = pos(W0, byName['LowerArm.L']);
  const angle = Math.atan2(Math.hypot(b0[0] - a0[0], b0[2] - a0[2]), a0[1] - b0[1]) * 180 / Math.PI;
  if (angle < 50) return null;

  const hang = (hangDeg === undefined ? 8 : hangDeg) * Math.PI / 180;
  const arms = [];
  for (const side of ['L', 'R']) {
    const ai = byName['UpperArm.' + side], a = pos(W0, ai), b = pos(W0, byName['LowerArm.' + side]);
    const d = norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const target = norm3([Math.sign(d[0]) * Math.sin(hang), -Math.cos(hang), d[2] * 0.3]);
    const q = fromTo(d, target);
    const desc = new Set();
    const walk = (i) => nodes.forEach((n, k) => { if (n.parent === i) { desc.add(k); walk(k); } });
    walk(ai);
    arms.push({ node: ai, q, qi: [-q[0], -q[1], -q[2], q[3]], desc });
    nodes[ai].r = q;
  }

  // skin the mesh into the lowered pose
  const W1 = world();
  const skinM = joints.map((j, k) => mul4(W1[j], Array.from(ibm.subarray(k * 16, k * 16 + 16))));
  for (const p of prims) {
    if (!p.jn || !p.wt) continue;
    const n = p.pos.length / 3;
    for (let v = 0; v < n; v++) {
      const x = p.pos[v * 3], y = p.pos[v * 3 + 1], z = p.pos[v * 3 + 2];
      const nx = p.nor ? p.nor[v * 3] : 0, ny = p.nor ? p.nor[v * 3 + 1] : 0, nz = p.nor ? p.nor[v * 3 + 2] : 0;
      let ox = 0, oy = 0, oz = 0, mx = 0, my = 0, mz = 0;
      for (let k = 0; k < 4; k++) {
        const w = p.wt[v * 4 + k]; if (!w) continue;
        const m = skinM[p.jn[v * 4 + k]];
        ox += w * (m[0] * x + m[4] * y + m[8] * z + m[12]); oy += w * (m[1] * x + m[5] * y + m[9] * z + m[13]); oz += w * (m[2] * x + m[6] * y + m[10] * z + m[14]);
        mx += w * (m[0] * nx + m[4] * ny + m[8] * nz); my += w * (m[1] * nx + m[5] * ny + m[9] * nz); mz += w * (m[2] * nx + m[6] * ny + m[10] * nz);
      }
      p.pos[v * 3] = ox; p.pos[v * 3 + 1] = oy; p.pos[v * 3 + 2] = oz;
      if (p.nor) { const l = Math.hypot(mx, my, mz) || 1; p.nor[v * 3] = mx / l; p.nor[v * 3 + 1] = my / l; p.nor[v * 3 + 2] = mz / l; }
    }
  }
  // that pose is the new rest: identity rotations, joints where the pose put them
  const wp = nodes.map((_, i) => pos(W1, i));
  nodes.forEach((n, i) => {
    if (!joints.includes(i)) return;
    const pp = n.parent >= 0 ? wp[n.parent] : [0, 0, 0];
    n.t = [wp[i][0] - pp[0], wp[i][1] - pp[1], wp[i][2] - pp[2]];
    n.r = [0, 0, 0, 1];
  });
  joints.forEach((j, k) => {
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -wp[j][0], -wp[j][1], -wp[j][2], 1];
    ibm.set(m, k * 16);
  });
  const find = (i) => arms.find((a) => a.node === i || a.desc.has(i));
  return {
    angle,
    toConverted(i, r) {
      const a = find(i); if (!a) return r;
      return a.node === i ? qmul(r, a.qi) : qmul(qmul(a.q, r), a.qi);
    },
    toOriginal(i, r) {
      const a = find(i); if (!a) return r;
      return a.node === i ? qmul(r, a.q) : qmul(qmul(a.qi, r), a.q);
    }
  };

  function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function fromTo(a, b) {
    const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const q = [c[0], c[1], c[2], 1 + d], l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return q.map((x) => x / l);
  }
  function qmul(a, b) {
    return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  }
  function trs(t, q) {
    const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return [1 - (yy + zz), xy + wz, xz - wy, 0, xy - wz, 1 - (xx + zz), yz + wx, 0, xz + wy, yz - wx, 1 - (xx + yy), 0, t[0], t[1], t[2], 1];
  }
  function mul4(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }
}

/* ---------------- GLB reading ---------------- */

function parseGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('forge-loader: not a GLB file');
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    else if (type === 0x004E4942) bin = new Uint8Array(buf, off + 8, len);
    off += 8 + len;
  }
  return { json, bin };
}

const TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(json, bin, i) {
  const a = json.accessors[i], v = json.bufferViews[a.bufferView], T = TYPES[a.componentType], n = SIZES[a.type];
  const start = bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0), stride = v.byteStride || 0;
  let data;
  if (!stride || stride === T.BYTES_PER_ELEMENT * n) {
    const bytes = new Uint8Array(bin.buffer, start, a.count * n * T.BYTES_PER_ELEMENT).slice();
    data = new T(bytes.buffer);
  } else {
    data = new T(a.count * n);
    const src = new DataView(bin.buffer);
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) data[k * n + c] = src[get](start + k * stride + c * T.BYTES_PER_ELEMENT, true);
  }
  if (a.normalized && T !== Float32Array) {
    const max = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType];
    data = Float32Array.from(data, (x) => Math.max(x / max, -1));
  }
  return { data, size: n };
}
