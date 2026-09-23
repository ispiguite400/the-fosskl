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
 */

export async function loadForgeCharacter(source, THREE, opts = {}) {
  const buf = typeof source === 'string' ? await (await fetch(source)).arrayBuffer() : source;
  return buildForgeCharacter(buf, THREE, opts);
}

export function buildForgeCharacter(buf, THREE, opts = {}) {
  const { json, bin } = parseGLB(buf);
  const acc = (i) => readAccessor(json, bin, i);

  /* ---- joints ---- */
  const skinDef = (json.skins || [])[0];
  const nodes = json.nodes.map((n, i) => {
    const isJoint = skinDef && skinDef.joints.includes(i);
    const o = isJoint ? new THREE.Bone() : new THREE.Group();
    o.name = n.name || 'node' + i;
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => nodes[i].add(nodes[c])));

  /* ---- the mesh ---- */
  const meshNodeIndex = json.nodes.findIndex((n) => n.mesh !== undefined);
  if (meshNodeIndex < 0) throw new Error('forge-loader: no mesh in this file');
  const prim = json.meshes[json.nodes[meshNodeIndex].mesh].primitives[0];
  const at = prim.attributes;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(acc(at.POSITION).data, 3));
  if (at.NORMAL !== undefined) geo.setAttribute('normal', new THREE.BufferAttribute(acc(at.NORMAL).data, 3));
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

  const material = opts.material || new THREE.MeshStandardMaterial({
    vertexColors: at.COLOR_0 !== undefined,
    roughness: opts.roughness ?? 0.82,
    metalness: opts.metalness ?? 0.04
  });
  // the game gives every material a sliver of self-colour so nothing turns into a black silhouette at night
  if (!opts.material && opts.emissive !== false) material.emissive = new THREE.Color(opts.emissive ?? 0x1a1a1a);

  let mesh;
  const root = new THREE.Group();
  root.name = opts.name || json.nodes[meshNodeIndex].name || 'forged';
  if (skinDef && at.JOINTS_0 !== undefined) {
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(acc(at.JOINTS_0).data), 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(acc(at.WEIGHTS_0).data, 4));
    mesh = new THREE.SkinnedMesh(geo, material);
    const bones = skinDef.joints.map((j) => nodes[j]);
    const ibm = skinDef.inverseBindMatrices !== undefined ? acc(skinDef.inverseBindMatrices).data : null;
    const inverses = bones.map((b, k) => ibm ? new THREE.Matrix4().fromArray(ibm, k * 16) : new THREE.Matrix4());
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
    root, mesh, bones, rig, clips, mixer, height: box.max.y - box.min.y,
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
