import { load, check, eq, report, audit } from './harness.mjs';
const S = load(['07-scene']);
const IO = S.IO;

function objectOf(mesh, name = 'test', tweak) {
  const o = new S.SceneObject(name, mesh);
  if (tweak) tweak(o);
  return o;
}

/** Re-import exported bytes and return a Mesh. */
function reimport(filename, data) {
  const buf = typeof data === 'string' ? IO.encodeUtf8(data).buffer : data;
  const res = IO.importBuffer(filename, buf);
  check(`${filename}: no import warnings`, res.warnings.length === 0, res.warnings.join('; '));
  check(`${filename}: got an object`, res.objects.length > 0);
  const o = res.objects[0];
  const m = new S.Mesh();
  m.setFromArrays(o.positions, o.indices, { colors: o.colors, weld: true });
  return { mesh: m, raw: o, all: res.objects };
}

function bboxOf(mesh) {
  return [Array.from(mesh.boundsMin()), Array.from(mesh.boundsMax())];
}

/* ==== OBJ ========================================================== */
{
  const src = S.Prim.makeMesh('sphere', 3);
  src.setColorAll(0.25, 0.5, 0.75);
  const geoms = IO.prepare([objectOf(src)], { includeColors: true });
  const text = IO.exportOBJ(geoms, { includeColors: true, includeNormals: true });
  check('OBJ text has a header', /^# Exported by SculptFree/.test(text));
  eq('OBJ vertex line count', (text.match(/^v /gm) || []).length, src.liveVerts);
  eq('OBJ normal line count', (text.match(/^vn /gm) || []).length, src.liveVerts);
  eq('OBJ face line count', (text.match(/^f /gm) || []).length, src.liveTris);

  const back = reimport('roundtrip.obj', text);
  eq('OBJ round trip vertices', back.mesh.liveVerts, src.liveVerts);
  eq('OBJ round trip triangles', back.mesh.liveTris, src.liveTris);
  eq('OBJ round trip is closed', back.mesh.countBorderEdges(), 0);
  const c = back.mesh.colors.array;
  check('OBJ round trip keeps colours', Math.abs(c[0] - 0.25) < 0.002 && Math.abs(c[1] - 0.5) < 0.002 && Math.abs(c[2] - 0.75) < 0.002,
    `${c[0]},${c[1]},${c[2]}`);
  const b0 = bboxOf(src), b1 = bboxOf(back.mesh);
  check('OBJ round trip keeps the bounding box', b0.flat().every((v, i) => Math.abs(v - b1.flat()[i]) < 1e-4));
  audit(back.mesh, 'OBJ round trip');
}

/* ---- awkward OBJ input: quads, ngons, negative indices, groups ----- */
{
  const objText = `
# a cube as quads, then a triangle fan ngon, with groups
o cube
v -1 -1 -1
v  1 -1 -1
v  1  1 -1
v -1  1 -1
v -1 -1  1
v  1 -1  1
v  1  1  1
v -1  1  1
f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 2 6 7 3
f 3 7 8 4
f 5 1 4 8
o pentagon
v 0 2 0
v 1 2 0
v 1.5 3 0
v 0.5 3.5 0
v -0.5 3 0
f -5 -4 -3 -2 -1
`;
  const res = IO.parseOBJ(objText);
  eq('OBJ groups become separate objects', res.objects.length, 2);
  eq('quad faces triangulate to 12 triangles', res.objects[0].indices.length / 3, 12);
  eq('pentagon triangulates to 3 triangles', res.objects[1].indices.length / 3, 3);
  const m = new S.Mesh();
  m.setFromArrays(res.objects[0].positions, res.objects[0].indices, { weld: true });
  eq('cube from quads has 8 verts', m.liveVerts, 8);
  eq('cube from quads is closed', m.countBorderEdges(), 0);
  // negative indices must resolve to the last five vertices
  const pent = res.objects[1];
  const maxIdx = Math.max(...pent.indices);
  eq('negative indices resolved', maxIdx, 12);
}

/* ---- OBJ with 0-255 colours and v//vn faces ------------------------ */
{
  const objText = `v 0 0 0 255 0 0
v 1 0 0 0 255 0
v 0 1 0 0 0 255
vn 0 0 1
f 1//1 2//1 3//1
`;
  const res = IO.parseOBJ(objText);
  eq('one triangle parsed', res.objects[0].indices.length, 3);
  const c = res.objects[0].colors;
  check('0-255 colours normalised', Math.abs(c[0] - 1) < 1e-6 && Math.abs(c[1]) < 1e-6, `${c[0]},${c[1]},${c[2]}`);
}

/* ==== STL ========================================================== */
{
  const src = S.Prim.makeMesh('roundbox', 3);
  const geoms = IO.prepare([objectOf(src)], {});
  const bin = IO.exportSTL(geoms, {});
  eq('binary STL size', bin.byteLength, 84 + src.liveTris * 50);
  check('binary STL detected as binary', IO.looksLikeBinarySTL(bin));
  const back = reimport('roundtrip.stl', bin);
  eq('STL round trip triangles', back.mesh.liveTris, src.liveTris);
  eq('STL round trip welds back to the same vertices', back.mesh.liveVerts, src.liveVerts);
  eq('STL round trip is closed', back.mesh.countBorderEdges(), 0);
  audit(back.mesh, 'STL round trip');

  const ascii = IO.exportSTL(geoms, { ascii: true });
  check('ascii STL starts with solid', /^solid /.test(ascii));
  check('ascii STL not misdetected as binary', !IO.looksLikeBinarySTL(IO.encodeUtf8(ascii).buffer));
  const back2 = reimport('roundtrip2.stl', ascii);
  eq('ascii STL round trip triangles', back2.mesh.liveTris, src.liveTris);
  eq('ascii STL round trip vertices', back2.mesh.liveVerts, src.liveVerts);

  // STL colour extension
  src.setColorAll(1, 0, 0);
  const cgeoms = IO.prepare([objectOf(src)], { includeColors: true });
  const cbin = IO.exportSTL(cgeoms, { includeColors: true });
  const dv = new DataView(cbin);
  const attr = dv.getUint16(84 + 48, true);
  check('STL colour attribute written', (attr & 0x8000) !== 0);
  const rback = reimport('colour.stl', cbin);
  check('STL colour read back', rback.raw.colors && rback.raw.colors[0] > 0.9 && rback.raw.colors[1] < 0.1,
    rback.raw.colors ? `${rback.raw.colors[0]},${rback.raw.colors[1]}` : 'none');
}

/* ==== PLY ========================================================== */
{
  const src = S.Prim.makeMesh('torus', 6);
  src.setColorAll(0.1, 0.9, 0.3);
  const geoms = IO.prepare([objectOf(src)], { includeColors: true });

  const bin = IO.exportPLY(geoms, { includeColors: true, includeNormals: true });
  const back = reimport('roundtrip.ply', bin);
  eq('PLY binary round trip vertices', back.mesh.liveVerts, src.liveVerts);
  eq('PLY binary round trip triangles', back.mesh.liveTris, src.liveTris);
  eq('PLY binary round trip is closed', back.mesh.countBorderEdges(), 0);
  const c = back.mesh.colors.array;
  check('PLY keeps colours (8-bit precision)', Math.abs(c[0] - 0.1) < 0.01 && Math.abs(c[1] - 0.9) < 0.01 && Math.abs(c[2] - 0.3) < 0.01,
    `${c[0].toFixed(3)},${c[1].toFixed(3)},${c[2].toFixed(3)}`);
  check('PLY keeps normals', back.raw.normals && back.raw.normals.length === src.liveVerts * 3);
  audit(back.mesh, 'PLY binary round trip');

  const ascii = IO.exportPLY(geoms, { includeColors: true, ascii: true });
  check('ascii PLY header', /^ply\nformat ascii 1\.0/.test(ascii));
  const back2 = reimport('roundtrip2.ply', ascii);
  eq('PLY ascii round trip vertices', back2.mesh.liveVerts, src.liveVerts);
  eq('PLY ascii round trip triangles', back2.mesh.liveTris, src.liveTris);
}

/* ---- hand-written PLY variants ------------------------------------- */
{
  const asciiPly = `ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
element face 2
property list uchar int vertex_indices
end_header
0 0 0 255 0 0
1 0 0 0 255 0
1 1 0 0 0 255
0 1 0 255 255 0
3 0 1 2
3 0 2 3
`;
  const res = IO.parsePLY(IO.encodeUtf8(asciiPly).buffer);
  eq('hand-written PLY vertices', res.objects[0].positions.length / 3, 4);
  eq('hand-written PLY triangles', res.objects[0].indices.length / 3, 2);
  check('hand-written PLY colours', Math.abs(res.objects[0].colors[0] - 1) < 1e-6);

  // a quad face must fan-triangulate
  const quadPly = asciiPly.replace('element face 2', 'element face 1')
    .replace('3 0 1 2\n3 0 2 3\n', '4 0 1 2 3\n');
  const res2 = IO.parsePLY(IO.encodeUtf8(quadPly).buffer);
  eq('PLY quad triangulated', res2.objects[0].indices.length / 3, 2);
}

/* ==== GLB ========================================================== */
{
  const src = S.Prim.makeMesh('capsule', 6);
  src.setColorAll(0.9, 0.4, 0.1);
  const geoms = IO.prepare([objectOf(src, 'Hero')], { includeColors: true });
  const glb = IO.exportGLB(geoms, { includeColors: true });

  // structural validation
  const dv = new DataView(glb);
  eq('GLB magic', dv.getUint32(0, true), 0x46546C67);
  eq('GLB version', dv.getUint32(4, true), 2);
  eq('GLB declared length matches the buffer', dv.getUint32(8, true), glb.byteLength);
  eq('GLB length is 4-byte aligned', glb.byteLength % 4, 0);
  const jsonLen = dv.getUint32(12, true);
  eq('JSON chunk type', dv.getUint32(16, true), 0x4E4F534A);
  eq('JSON chunk padded to 4', jsonLen % 4, 0);
  const json = JSON.parse(IO.decode(new Uint8Array(glb, 20, jsonLen)));
  eq('BIN chunk type', dv.getUint32(20 + jsonLen + 4, true), 0x004E4942);
  const binLen = dv.getUint32(20 + jsonLen, true);
  eq('BIN chunk padded to 4', binLen % 4, 0);
  eq('buffer byteLength matches the chunk', json.buffers[0].byteLength <= binLen, true);
  check('all bufferView offsets are 4-byte aligned', json.bufferViews.every(v => (v.byteOffset || 0) % 4 === 0));
  check('bufferViews stay inside the buffer',
    json.bufferViews.every(v => (v.byteOffset || 0) + v.byteLength <= json.buffers[0].byteLength));
  check('POSITION accessor has min and max', json.accessors[0].min && json.accessors[0].max);
  eq('one mesh, one node', json.meshes.length + json.nodes.length, 2);
  eq('node names carry through', json.nodes[0].name, 'Hero');
  check('material is PBR', !!json.materials[0].pbrMetallicRoughness);
  eq('COLOR_0 present', json.meshes[0].primitives[0].attributes.COLOR_0 !== undefined, true);

  const back = reimport('roundtrip.glb', glb);
  eq('GLB round trip vertices', back.mesh.liveVerts, src.liveVerts);
  eq('GLB round trip triangles', back.mesh.liveTris, src.liveTris);
  eq('GLB round trip is closed', back.mesh.countBorderEdges(), 0);
  const c = back.mesh.colors.array;
  check('GLB keeps colours exactly', Math.abs(c[0] - 0.9) < 1e-6 && Math.abs(c[1] - 0.4) < 1e-6,
    `${c[0]},${c[1]}`);
  audit(back.mesh, 'GLB round trip');

  // positions must match to float precision
  const d = src.toIndexed();
  let worst = 0;
  for (let i = 0; i < d.positions.length; i++) worst = Math.max(worst, Math.abs(d.positions[i] - back.raw.positions[i]));
  check('GLB positions are bit-accurate', worst < 1e-6, `worst ${worst}`);
}

/* ---- GLB with >65535 vertices uses 32-bit indices ------------------ */
{
  const big = S.Prim.makeMesh('sphere', 5);           // ~20k tris, 10k verts
  big.subdivide(false);                               // ~82k tris, 41k verts
  big.subdivide(false);                               // ~327k tris, 164k verts
  check('big mesh is big enough for the test', big.liveVerts > 65535, `${big.liveVerts}`);
  const geoms = IO.prepare([objectOf(big)], {});
  const glb = IO.exportGLB(geoms, {});
  const dv = new DataView(glb);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(IO.decode(new Uint8Array(glb, 20, jsonLen)));
  const idxAcc = json.accessors[json.meshes[0].primitives[0].indices];
  eq('32-bit indices for a large mesh', idxAcc.componentType, 5125);
  eq('index count', idxAcc.count, big.liveTris * 3);
  const back = IO.parseGLB(glb);
  eq('large GLB round trip triangles', back.objects[0].indices.length / 3, big.liveTris);
}

/* ---- glTF with a data URI and a node transform --------------------- */
{
  const src = S.Prim.makeMesh('box', 2);
  const geoms = IO.prepare([objectOf(src)], {});
  const glb = IO.exportGLB(geoms, {});
  const dv = new DataView(glb);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(IO.decode(new Uint8Array(glb, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8;
  const binLen = dv.getUint32(20 + jsonLen, true);
  const b64 = Buffer.from(new Uint8Array(glb, binStart, binLen)).toString('base64');
  json.buffers[0].uri = 'data:application/octet-stream;base64,' + b64;
  // move the node 5 units up; the importer must bake it
  json.nodes[0].translation = [0, 5, 0];
  const res = IO.parseGLTF(json, []);
  eq('gltf with data URI imported', res.objects.length, 1);
  const m = new S.Mesh();
  m.setFromArrays(res.objects[0].positions, res.objects[0].indices, { weld: true });
  const centre = Array.from(m.boundsCenter(new Float32Array(3)));
  check('node translation baked in', Math.abs(centre[1] - 5) < 1e-4, `centre y=${centre[1]}`);
}

/* ==== transforms, scale and axis conversion ========================= */
{
  const src = S.Prim.makeMesh('box', 2);
  const obj = objectOf(src, 'moved', o => {
    o.position[0] = 2; o.position[1] = 1;
    S.Q4.fromEuler(o.rotation, 0, Math.PI / 2, 0);
    o.scale[0] = o.scale[1] = o.scale[2] = 2;
    o.touch();
  });
  const baked = IO.prepare([obj], { applyTransform: true })[0];
  let minY = Infinity, maxY = -Infinity, cx = 0;
  for (let v = 0; v < baked.vertCount; v++) {
    minY = Math.min(minY, baked.positions[v * 3 + 1]);
    maxY = Math.max(maxY, baked.positions[v * 3 + 1]);
    cx += baked.positions[v * 3];
  }
  cx /= baked.vertCount;
  check('transform baked: centre moved to x=2', Math.abs(cx - 2) < 1e-3, `${cx}`);
  check('transform baked: scaled to 2 units tall', Math.abs((maxY - minY) - 2) < 1e-3, `${maxY - minY}`);

  const raw = IO.prepare([obj], { applyTransform: false })[0];
  let maxRaw = 0;
  for (let v = 0; v < raw.vertCount; v++) maxRaw = Math.max(maxRaw, Math.abs(raw.positions[v * 3 + 1]));
  check('applyTransform:false leaves local coordinates', Math.abs(maxRaw - 0.5) < 1e-4, `${maxRaw}`);

  // scale option
  const scaled = IO.prepare([objectOf(S.Prim.makeMesh('box', 1))], { scale: 100 })[0];
  let maxS = 0;
  for (let v = 0; v < scaled.vertCount; v++) maxS = Math.max(maxS, Math.abs(scaled.positions[v * 3]));
  check('export scale applied', Math.abs(maxS - 50) < 1e-3, `${maxS}`);

  // Z-up conversion: our +y must come out as +z
  const zup = IO.prepare([objectOf(S.Prim.makeMesh('capsule', 4))], { axis: 'z' })[0];
  const yup = IO.prepare([objectOf(S.Prim.makeMesh('capsule', 4))], { axis: 'y' })[0];
  let zExtent = 0, yExtent = 0;
  for (let v = 0; v < zup.vertCount; v++) {
    zExtent = Math.max(zExtent, Math.abs(zup.positions[v * 3 + 2]));
    yExtent = Math.max(yExtent, Math.abs(yup.positions[v * 3 + 1]));
  }
  check('Z-up export moves the long axis to Z', Math.abs(zExtent - yExtent) < 1e-6, `${zExtent} vs ${yExtent}`);
  const tmp = [0, 0, 0];
  IO.axisIn('z', ...IO.axisOut('z', 1, 2, 3, [0,0,0]), tmp);
  check('axis conversion round trips', tmp[0] === 1 && tmp[1] === 2 && tmp[2] === 3, tmp.join(','));

  // mirrored scale must flip winding so faces still point outwards
  const mirrored = objectOf(S.Prim.makeMesh('sphere', 2), 'mirror', o => { o.scale[0] = -1; o.touch(); });
  const mg = IO.prepare([mirrored], {})[0];
  let outward = 0, inward = 0;
  for (let t = 0; t < mg.indices.length; t += 3) {
    const a = mg.indices[t] * 3, b = mg.indices[t + 1] * 3, c = mg.indices[t + 2] * 3;
    const p = mg.positions;
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const dot = n[0] * p[a] + n[1] * p[a + 1] + n[2] * p[a + 2];
    if (dot > 0) outward++; else inward++;
  }
  check('mirrored object keeps faces outward', outward > 0 && inward === 0, `out=${outward} in=${inward}`);
}

/* ==== project container ============================================ */
{
  const scene = new S.Scene();
  const a = new S.SceneObject('Head', S.Prim.makeMesh('sphere', 3));
  a.position[1] = 1.5; a.touch();
  a.mesh.masks.array[10] = 0.75;
  a.mesh.setColorAll(0.2, 0.3, 0.4);
  const b = new S.SceneObject('Body', S.Prim.makeMesh('capsule', 5));
  b.scale[0] = 1.5; b.touch();
  scene.add(a); scene.add(b);

  const buf = IO.saveProject({
    objects: scene.objects, selected: 1,
    camera: { distance: 3, yaw: 0.5, pitch: 0.2, target: [0, 1, 0] },
    settings: { brush: 'clay', radius: 60 }
  });
  check('project buffer is not empty', buf.byteLength > 1000);
  const loaded = IO.loadProject(buf);
  check('project loads', loaded.ok, loaded.reason || '');
  eq('project object count', loaded.objects.length, 2);
  eq('project names', loaded.objects[0].name + '/' + loaded.objects[1].name, 'Head/Body');
  eq('project selection', loaded.selected, 1);
  eq('project camera', loaded.camera.distance, 3);
  eq('project settings', loaded.settings.brush, 'clay');
  check('project transform preserved', Math.abs(loaded.objects[0].position[1] - 1.5) < 1e-6);
  check('project scale preserved', Math.abs(loaded.objects[1].scale[0] - 1.5) < 1e-6);

  const m = new S.Mesh();
  m.setFromArrays(loaded.objects[0].positions, loaded.objects[0].indices, { colors: loaded.objects[0].colors, weld: false });
  m.masks.array.set(loaded.objects[0].masks, 0);
  eq('project mesh vertices', m.liveVerts, a.mesh.liveVerts);
  eq('project mesh triangles', m.liveTris, a.mesh.liveTris);
  check('project keeps the mask', Math.abs(m.masks.array[10] - 0.75) < 1e-6, `${m.masks.array[10]}`);
  check('project keeps colours', Math.abs(m.colors.array[0] - 0.2) < 1e-6);
  audit(m, 'project round trip');

  // a foreign file must be rejected cleanly
  const bogus = IO.loadProject(IO.encodeUtf8('not a project at all, sorry').buffer);
  check('project loader rejects junk', !bogus.ok && /Not a SculptFree/.test(bogus.reason));
}

/* ==== dispatch and error handling ================================== */
{
  const src = S.Prim.makeMesh('sphere', 2);
  const geoms = IO.prepare([objectOf(src)], {});
  for (const fmt of ['obj', 'stl', 'ply', 'glb']) {
    const out = IO.exportGeoms(fmt, geoms, { includeColors: true });
    check(`exportGeoms(${fmt}) produced data`, !!out.data && (out.data.byteLength || out.data.length) > 100);
    eq(`exportGeoms(${fmt}) extension`, out.ext, fmt);
  }
  // extension-less sniffing
  const glb = IO.exportGLB(geoms, {});
  eq('sniffed GLB', IO.importBuffer('model', glb).objects.length, 1);
  const objText = IO.exportOBJ(geoms, {});
  eq('sniffed OBJ', IO.importBuffer('model', IO.encodeUtf8(objText).buffer).objects.length, 1);
  const ply = IO.exportPLY(geoms, {});
  eq('sniffed PLY', IO.importBuffer('model', ply).objects.length, 1);

  // corrupt input must not throw
  const junk = IO.importBuffer('bad.glb', IO.encodeUtf8('this is not a glb').buffer);
  check('corrupt GLB reports a warning instead of throwing', junk.objects.length === 0 && junk.warnings.length > 0,
    junk.warnings.join(';'));
  const emptyObj = IO.importBuffer('empty.obj', IO.encodeUtf8('# nothing here\n').buffer);
  check('empty OBJ warns', emptyObj.objects.length === 0 && emptyObj.warnings.length > 0);
}

report('io');
