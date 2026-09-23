/*
 * Texturing, stencils and presets.
 *
 * The PNG writer is checked against Node's own zlib — if the browser writes
 * a file the rest of the world cannot read, that is the only way to find out
 * before somebody's model refuses to open.
 */
import { load, check, eq, report } from './harness.mjs';
import zlib from 'zlib';

const S = load();
const T = S.Texture, A = S.Alpha, P = S.Presets;

/* ---------------------------------------------------------------- *
 * a minimal PNG reader, so the tests read what the app wrote
 * ---------------------------------------------------------------- */

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function readPNG(bytes) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error('bad signature');
  let at = 8, ihdr = null, idat = [], sawEnd = false, badCRC = 0, order = [];
  while (at < bytes.length) {
    const len = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const body = bytes.subarray(at + 4, at + 8 + len);
    const want = ((bytes[at + 8 + len] << 24) | (bytes[at + 9 + len] << 16) |
                  (bytes[at + 10 + len] << 8) | bytes[at + 11 + len]) >>> 0;
    if (crc32(body) !== want) badCRC++;
    order.push(type);
    if (type === 'IHDR') ihdr = bytes.subarray(at + 8, at + 8 + len);
    if (type === 'IDAT') idat.push(Buffer.from(bytes.subarray(at + 8, at + 8 + len)));
    if (type === 'IEND') sawEnd = true;
    at += 12 + len;
  }
  const width = (ihdr[0] << 24) | (ihdr[1] << 16) | (ihdr[2] << 8) | ihdr[3];
  const height = (ihdr[4] << 24) | (ihdr[5] << 16) | (ihdr[6] << 8) | ihdr[7];
  const depth = ihdr[8], colorType = ihdr[9];
  const channels = colorType === 2 ? 3 : 4;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  const filters = [];
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
  };
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    filters.push(ft);
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? out[y * stride + x - channels] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const ul = (y > 0 && x >= channels) ? out[(y - 1) * stride + x - channels] : 0;
      let r;
      switch (ft) {
        case 0: r = v; break;
        case 1: r = v + left; break;
        case 2: r = v + up; break;
        case 3: r = v + ((left + up) >> 1); break;
        case 4: r = v + paeth(left, up, ul); break;
        default: throw new Error('unknown filter ' + ft);
      }
      out[y * stride + x] = r & 0xFF;
    }
  }
  return { width, height, depth, colorType, channels, pixels: out, badCRC, sawEnd, order,
           rawLength: raw.length, filters };
}

/* ---------------------------------------------------------------- *
 * deflate
 * ---------------------------------------------------------------- */

function rnd(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

{
  const cases = [
    ['empty', new Uint8Array(0)],
    ['one byte', new Uint8Array([42])],
    ['flat run', new Uint8Array(9000).fill(7)],
    ['two byte pattern', Uint8Array.from({ length: 5000 }, (_, i) => i % 2 ? 0xAB : 0x11)],
    ['long repeat', Uint8Array.from({ length: 40000 }, (_, i) => (i % 600) & 0xFF)]
  ];
  const r = rnd(9);
  cases.push(['random', Uint8Array.from({ length: 20000 }, () => Math.floor(r() * 256))]);
  // a run longer than one match can cover, to exercise the length codes
  const mixed = new Uint8Array(70000);
  for (let i = 0; i < mixed.length; i++) mixed[i] = i < 40000 ? 0 : (i % 251);
  cases.push(['mixed', mixed]);

  for (const [name, data] of cases) {
    let ok = false, detail = '';
    try {
      const back = zlib.inflateRawSync(Buffer.from(S.Texture.deflate(data)));
      ok = back.length === data.length && Buffer.compare(back, Buffer.from(data)) === 0;
      detail = `${back.length} vs ${data.length}`;
    } catch (e) { detail = e.message; }
    check('deflate round trips: ' + name, ok, detail);
  }

  const flat = new Uint8Array(20000).fill(3);
  const packed = S.Texture.deflate(flat);
  check('deflate actually compresses a flat run', packed.length < flat.length / 50,
    `${packed.length} bytes from ${flat.length}`);

  const zl = S.Texture.zlib(flat);
  let zlOK = false;
  try { zlOK = zlib.inflateSync(Buffer.from(zl)).length === flat.length; } catch (e) { zlOK = false; }
  check('zlib wrapper inflates with the checksum intact', zlOK);
  eq('zlib header is deflate/32K', (zl[0] << 8 | zl[1]) % 31, 0);
}

/* ---------------------------------------------------------------- *
 * PNG
 * ---------------------------------------------------------------- */

{
  // a gradient, an odd size, and every filter type exercised
  const w = 61, h = 37;
  const px = new Uint8Array(w * h * 4);
  const r = rnd(4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      px[o] = (x * 4) & 0xFF;
      px[o + 1] = (y * 6) & 0xFF;
      px[o + 2] = Math.floor(r() * 256);
      px[o + 3] = 255;
    }
  }
  const png = T.encodePNG(px, w, h);
  const got = readPNG(png);
  eq('png width', got.width, w);
  eq('png height', got.height, h);
  eq('png bit depth', got.depth, 8);
  eq('opaque images are written as RGB', got.colorType, 2);
  eq('png chunk CRCs are correct', got.badCRC, 0);
  check('png ends with IEND', got.sawEnd && got.order[got.order.length - 1] === 'IEND', got.order.join(','));
  eq('png chunk order', got.order.slice(0, 2).join(','), 'IHDR,IDAT');

  let bad = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        if (got.pixels[(y * w + x) * 3 + c] !== px[(y * w + x) * 4 + c]) bad++;
      }
    }
  }
  eq('png pixels survive the round trip exactly', bad, 0);

  // with real transparency it has to stay RGBA
  const withAlpha = px.slice();
  withAlpha[3] = 128;
  const png2 = readPNG(T.encodePNG(withAlpha, w, h));
  eq('transparency keeps the alpha channel', png2.colorType, 6);
  eq('alpha value survives', png2.pixels[3], 128);

  // one pixel
  const tiny = readPNG(T.encodePNG(new Uint8Array([10, 20, 30, 255]), 1, 1));
  check('a one pixel png reads back', tiny.width === 1 && tiny.height === 1 &&
    tiny.pixels[0] === 10 && tiny.pixels[2] === 30);

  // a flat image should be tiny
  const flatPx = new Uint8Array(128 * 128 * 4).fill(200);
  for (let i = 3; i < flatPx.length; i += 4) flatPx[i] = 255;
  const flatPng = T.encodePNG(flatPx, 128, 128);
  check('a flat 128x128 png is under 1 KB', flatPng.length < 1024, `${flatPng.length} bytes`);
}

/* ---------------------------------------------------------------- *
 * unwrap
 * ---------------------------------------------------------------- */

function geomFrom(mesh, name = 'obj') {
  const obj = new S.SceneObject(name, mesh);
  const geoms = S.IO.prepare([obj], { includeColors: true, includeNormals: true });
  return geoms[0];
}

{
  const mesh = S.Prim.makeMesh('sphere', 3);
  const geom = geomFrom(mesh, 'Ball');
  const uv = T.unwrap(geom, { size: 512, margin: 4 });

  eq('unwrap keeps every triangle', uv.triCount, geom.triCount);
  check('unwrap only ever adds vertices', uv.vertCount >= geom.vertCount,
    `${uv.vertCount} vs ${geom.vertCount}`);
  eq('unwrap writes one uv per vertex', uv.uvs.length, uv.vertCount * 2);

  let outside = 0, badIndex = 0;
  for (let i = 0; i < uv.uvs.length; i++) if (uv.uvs[i] < 0 || uv.uvs[i] > 1) outside++;
  for (let i = 0; i < uv.indices.length; i++) if (uv.indices[i] >= uv.vertCount) badIndex++;
  eq('every uv is inside the image', outside, 0);
  eq('every index is in range', badIndex, 0);

  // each triangle must live inside exactly one chart cell (3 across, 2 down)
  let strayTri = 0, flatTri = 0;
  for (let t = 0; t < uv.triCount; t++) {
    const cells = new Set();
    for (let k = 0; k < 3; k++) {
      const v = uv.indices[t * 3 + k];
      const col = Math.min(2, Math.floor(uv.uvs[v * 2] * 3));
      const row = Math.min(1, Math.floor(uv.uvs[v * 2 + 1] * 2));
      cells.add(col + ':' + row);
    }
    if (cells.size !== 1) strayTri++;
    const a = uv.indices[t * 3], b = uv.indices[t * 3 + 1], c = uv.indices[t * 3 + 2];
    const area = (uv.uvs[b * 2] - uv.uvs[a * 2]) * (uv.uvs[c * 2 + 1] - uv.uvs[a * 2 + 1]) -
                 (uv.uvs[b * 2 + 1] - uv.uvs[a * 2 + 1]) * (uv.uvs[c * 2] - uv.uvs[a * 2]);
    if (Math.abs(area) < 1e-12) flatTri++;
  }
  eq('no triangle straddles two charts', strayTri, 0);
  eq('no triangle collapses in uv space', flatTri, 0);

  // the split copies must carry the source vertex's data
  let mismatch = 0;
  for (let i = 0; i < uv.vertCount; i++) {
    const src = uv.sourceVerts[i];
    for (let c = 0; c < 3; c++) {
      if (uv.positions[i * 3 + c] !== geom.positions[src * 3 + c]) mismatch++;
      if (uv.normals[i * 3 + c] !== geom.normals[src * 3 + c]) mismatch++;
    }
  }
  eq('split vertices keep their position and normal', mismatch, 0);

  // a box: six flat sides, so each side should land in its own chart and the
  // charts should each hold a sixth of the triangles
  const box = geomFrom(S.Prim.makeMesh('box', 2), 'Box');
  const boxUV = T.unwrap(box, { size: 256 });
  const perAxis = new Array(6).fill(0);
  for (let t = 0; t < boxUV.triCount; t++) perAxis[boxUV.faceAxis[t]]++;
  check('a box spreads evenly over the six charts',
    perAxis.every((n) => n === perAxis[0] && n > 0), perAxis.join(','));

  // a plane only faces one way, so five charts stay empty and nothing breaks
  const plane = geomFrom(S.Prim.makeMesh('plane', 2), 'Plane');
  const planeUV = T.unwrap(plane, { size: 256 });
  let planeOutside = 0;
  for (let i = 0; i < planeUV.uvs.length; i++) {
    if (planeUV.uvs[i] < 0 || planeUV.uvs[i] > 1) planeOutside++;
  }
  eq('a single-sided mesh still unwraps inside the image', planeOutside, 0);
  eq('unwrapping a plane keeps its triangles', planeUV.triCount, plane.triCount);
}

/* ---------------------------------------------------------------- *
 * cavity
 * ---------------------------------------------------------------- */

{
  const sphere = geomFrom(S.Prim.makeMesh('sphere', 3));
  const flat = T.cavity(sphere, 1);
  let minShade = 1;
  for (let i = 0; i < flat.length; i++) minShade = Math.min(minShade, flat[i]);
  check('a convex surface is not darkened', minShade > 0.9, `min ${minShade.toFixed(3)}`);

  // push a dent into the sphere and the dent must come out darker
  const mesh = S.Prim.makeMesh('sphere', 4);
  const pos = mesh.positions.array;
  let moved = 0;
  for (let v = 0; v < mesh.liveVerts; v++) {
    const o = v * 3;
    if (pos[o + 1] > 0.37) {
      pos[o] *= 0.55; pos[o + 1] *= 0.55; pos[o + 2] *= 0.55;
      moved++;
    }
  }
  mesh.computeNormals();
  check('the dent test actually moved vertices', moved > 30, `${moved}`);
  const dentGeom = geomFrom(mesh);
  const shade = T.cavity(dentGeom, 1);
  let dentSum = 0, dentN = 0, restSum = 0, restN = 0;
  for (let v = 0; v < dentGeom.vertCount; v++) {
    const y = dentGeom.positions[v * 3 + 1];
    if (y > 0.17) { dentSum += shade[v]; dentN++; } else { restSum += shade[v]; restN++; }
  }
  const dentMean = dentSum / Math.max(1, dentN), restMean = restSum / Math.max(1, restN);
  check('the rim of a dent is darkened', dentMean < restMean - 0.01,
    `dent ${dentMean.toFixed(3)} vs rest ${restMean.toFixed(3)}`);
  check('cavity strength 0 leaves everything bright',
    T.cavity(dentGeom, 0).every((v) => v === 1));
}

/* ---------------------------------------------------------------- *
 * bake
 * ---------------------------------------------------------------- */

{
  const mesh = S.Prim.makeMesh('sphere', 3);
  // paint it a flat red
  const colors = mesh.colors.array;
  for (let v = 0; v < mesh.liveVerts; v++) {
    colors[v * 3] = 1; colors[v * 3 + 1] = 0; colors[v * 3 + 2] = 0;
  }
  const geom = geomFrom(mesh, 'Red');
  geom.color = [1, 0, 0];               // the gutter fill matches the paint
  const built = T.build(geom, { size: 128 });

  eq('the bake fills the whole image', built.pixels.length, 128 * 128 * 4);
  check('the bake covers a useful share of the image', built.coverage > 0.3,
    `${(built.coverage * 100).toFixed(1)}%`);

  let black = 0, nonRed = 0, transparent = 0;
  for (let i = 0; i < 128 * 128; i++) {
    const r = built.pixels[i * 4], g = built.pixels[i * 4 + 1], b = built.pixels[i * 4 + 2];
    if (r < 8 && g < 8 && b < 8) black++;
    if (r < 200 || g > 60 || b > 60) nonRed++;
    if (built.pixels[i * 4 + 3] !== 255) transparent++;
  }
  eq('nothing is left black', black, 0);
  eq('nothing is left transparent', transparent, 0);
  eq('a flat red model bakes to a red image', nonRed, 0);

  // the empty gutter takes the object's own colour, so filtering never pulls
  // a stray colour across a seam
  const greenBase = geomFrom(mesh, 'Red');
  greenBase.colors = null;
  greenBase.color = [0, 1, 0];
  const filled = T.bake(T.unwrap(greenBase, { size: 64 }), { size: 64, background: [0, 1, 0] });
  let offBase = 0;
  for (let i = 0; i < 64 * 64; i++) {
    if (filled.pixels[i * 4] > 20 || filled.pixels[i * 4 + 1] < 235) offBase++;
  }
  eq('an unpainted model bakes to its own colour', offBase, 0);

  // two colours: both must survive, and the seam must not smear to black
  const split = S.Prim.makeMesh('sphere', 3);
  const sc = split.colors.array, sp = split.positions.array;
  for (let v = 0; v < split.liveVerts; v++) {
    const up = sp[v * 3 + 1] > 0;
    sc[v * 3] = up ? 0.9 : 0.1;
    sc[v * 3 + 1] = 0.15;
    sc[v * 3 + 2] = up ? 0.1 : 0.9;
  }
  const twoTone = T.build(geomFrom(split, 'Two'), { size: 96 });
  let reds = 0, blues = 0;
  for (let i = 0; i < 96 * 96; i++) {
    const r = twoTone.pixels[i * 4], b = twoTone.pixels[i * 4 + 2];
    if (r > 180 && b < 80) reds++;
    if (b > 180 && r < 80) blues++;
  }
  check('both painted colours reach the image', reds > 200 && blues > 200, `${reds} red, ${blues} blue`);

  // the bake must be repeatable — a texture that changes between saves is a bug
  const again = T.build(geomFrom(split, 'Two'), { size: 96 });
  let differ = 0;
  for (let i = 0; i < again.pixels.length; i++) if (again.pixels[i] !== twoTone.pixels[i]) differ++;
  eq('baking twice gives the same image', differ, 0);

  // creases darken the result
  const creased = S.Prim.makeMesh('sphere', 4);
  const cp = creased.positions.array;
  for (let v = 0; v < creased.liveVerts; v++) {
    const o = v * 3;
    const s = 1 - 0.3 * Math.max(0, Math.cos(cp[o] * 9));
    cp[o] *= s; cp[o + 1] *= s; cp[o + 2] *= s;
  }
  creased.computeNormals();
  const cg = geomFrom(creased, 'Creased');
  function meanBrightness(result, size) {
    let sum = 0;
    for (let i = 0; i < size * size; i++) sum += result.pixels[i * 4] + result.pixels[i * 4 + 1] + result.pixels[i * 4 + 2];
    return sum / (size * size * 3);
  }
  const plainBake = T.build(cg, { size: 96, cavity: 0 });
  const shadedBake = T.build(cg, { size: 96, cavity: 1 });
  check('baking creases darkens the recesses',
    meanBrightness(shadedBake, 96) < meanBrightness(plainBake, 96) - 1,
    `${meanBrightness(shadedBake, 96).toFixed(1)} vs ${meanBrightness(plainBake, 96).toFixed(1)}`);

  // the PNG the bake hands out has to be readable
  const decoded = readPNG(plainBake.png());
  check('the baked png reads back at the right size',
    decoded.width === 96 && decoded.height === 96 && decoded.badCRC === 0);
}

/* ---------------------------------------------------------------- *
 * textured export
 * ---------------------------------------------------------------- */

{
  const mesh = S.Prim.makeMesh('sphere', 3);
  const obj = new S.SceneObject('Rock', mesh);
  const geoms = S.IO.prepare([obj], { includeColors: true, includeNormals: true });

  const objOut = S.IO.exportTextured('obj', geoms, {
    baseName: 'rock', textureSize: 128, cavity: 0.5, includeNormals: true, includeColors: true
  });
  eq('obj export writes three files', objOut.files.length, 3);
  eq('obj file names', objOut.files.map((f) => f.name).join(','), 'rock.obj,rock.mtl,rock.png');
  eq('the image is a png', objOut.files[2].mime, 'image/png');

  const text = objOut.files[0].data;
  check('the obj points at the material library', /^mtllib rock\.mtl$/m.test(text));
  check('the obj uses the material', /^usemtl Rock_mat$/m.test(text));
  const vtCount = (text.match(/^vt /gm) || []).length;
  eq('one vt per vertex', vtCount, objOut.geoms[0].vertCount);
  check('faces reference position, uv and normal', /^f \d+\/\d+\/\d+ \d+\/\d+\/\d+ \d+\/\d+\/\d+$/m.test(text));

  const mtl = objOut.files[1].data;
  check('the material names the texture', /^map_Kd rock\.png$/m.test(mtl));
  check('a textured material is white so the image shows through', /^Kd 1\.000 1\.000 1\.000$/m.test(mtl));

  const reparsed = S.IO.parseOBJ(text);
  eq('the exported obj reads back', reparsed.objects.length, 1);
  eq('the triangle count survives the round trip',
    reparsed.objects[0].indices.length / 3, mesh.liveTris);

  const pngInfo = readPNG(objOut.files[2].data);
  check('the written texture is a valid 128px png',
    pngInfo.width === 128 && pngInfo.height === 128 && pngInfo.badCRC === 0);

  /* glb keeps everything in one file */
  const glbOut = S.IO.exportTextured('glb', geoms, {
    baseName: 'rock', textureSize: 64, includeNormals: true, includeColors: true
  });
  eq('glb export writes one file', glbOut.files.length, 1);
  eq('glb file name', glbOut.files[0].name, 'rock.glb');
  const buf = glbOut.files[0].data;
  const dv = new DataView(buf);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(Buffer.from(new Uint8Array(buf, 20, jsonLen)).toString('utf8').trim());
  eq('the glb carries one image', json.images.length, 1);
  eq('the image is embedded, not linked', json.images[0].bufferView !== undefined, true);
  eq('the image is a png', json.images[0].mimeType, 'image/png');
  eq('the glb has a sampler', json.samplers.length, 1);
  check('the primitive has texture coordinates',
    json.meshes[0].primitives[0].attributes.TEXCOORD_0 !== undefined,
    Object.keys(json.meshes[0].primitives[0].attributes).join(','));
  check('vertex colour is dropped once the paint is in the texture',
    json.meshes[0].primitives[0].attributes.COLOR_0 === undefined);
  const pbr = json.materials[0].pbrMetallicRoughness;
  check('the material samples the texture', pbr.baseColorTexture && pbr.baseColorTexture.index === 0);
  eq('the base colour is white under a texture', pbr.baseColorFactor.join(','), '1,1,1,1');

  const back = S.IO.parseGLB(buf);
  eq('the glb reads back', back.objects.length, 1);
  eq('the glb keeps its triangles', back.objects[0].indices.length / 3, mesh.liveTris);
  eq('the glb parses without complaint', back.warnings.length, 0);

  // glTF flips v, so the two exports must not agree by accident
  const uvA = objOut.geoms[0].uvs[1];
  const view = json.accessors[json.meshes[0].primitives[0].attributes.TEXCOORD_0];
  const uvView = json.bufferViews[view.bufferView];
  const binStart = 20 + jsonLen + 8;
  const glbUV = new Float32Array(buf.slice(binStart + uvView.byteOffset, binStart + uvView.byteOffset + 8))[1];
  check('glb flips the v axis for glTF', Math.abs(glbUV - (1 - uvA)) < 1e-6, `${glbUV} vs ${1 - uvA}`);

  // two objects get one image each, named after them
  const two = S.IO.prepare([obj, new S.SceneObject('Other', S.Prim.makeMesh('box', 1))],
    { includeColors: true, includeNormals: true });
  const multi = S.IO.exportTextured('obj', two, { baseName: 'set', textureSize: 32 });
  eq('one texture per object', multi.files.filter((f) => f.mime === 'image/png').length, 2);
  check('each texture is named after its object',
    multi.files.map((f) => f.name).join(',').indexOf('set_Other.png') > 0,
    multi.files.map((f) => f.name).join(','));
  check('the material library lists both materials',
    /newmtl Rock_mat/.test(multi.files[1].data) && /newmtl Other_mat/.test(multi.files[1].data));
}

/* ---------------------------------------------------------------- *
 * stencils
 * ---------------------------------------------------------------- */

{
  check('there is a whole set of built-in stencils', A.BUILTIN_IDS.length >= 24,
    `${A.BUILTIN_IDS.length} of them`);
  for (const id of A.BUILTIN_IDS) {
    const alpha = A.builtin(id);
    check('builtin stencil builds: ' + id, !!alpha && alpha.size > 0);
    let lo = 1, hi = 0, nan = 0;
    for (let i = 0; i < alpha.data.length; i++) {
      const v = alpha.data[i];
      if (!Number.isFinite(v)) nan++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    eq('stencil stays in range: ' + id, nan, 0);
    check('stencil uses the full range: ' + id, lo < 0.05 && hi > 0.95, `${lo.toFixed(3)}..${hi.toFixed(3)}`);
    /*
     * A stamp's border has to fade, or a dab leaves a rectangle — but the
     * fade belongs to the reading rather than to the data, because the same
     * stencil is also read as a texture, tile after tile, where a faded
     * border would print a grid of gaps. So the stored image runs right to
     * its edges and `sample` does the fading.
     */
    const n = alpha.size;
    let edgeMax = 0;
    for (let x = 0; x < n; x++) {
      const t = (x + 0.5) / n;
      edgeMax = Math.max(edgeMax, A.sample(alpha, t, 0.001), A.sample(alpha, t, 0.999),
                         A.sample(alpha, 0.001, t), A.sample(alpha, 0.999, t));
    }
    check('a stamp of it fades at the edge: ' + id, edgeMax < 0.08, `${edgeMax.toFixed(3)}`);

    /*
     * Read as a texture, the pattern has to meet itself: the two texels
     * either side of the seam should differ no more than neighbouring
     * texels inside the image do. A pattern that fails this prints a grid
     * of lines across a scrubbed surface.
     */
    if (['rivet', 'square', 'ring', 'star'].indexOf(id) < 0) {
      // the biggest step between neighbouring texels anywhere in the image,
      // which is the most a seam is allowed to be
      let inside = 0, seam = 0;
      for (let y = 0; y < n; y++) {
        for (let x = 1; x < n; x++) {
          inside = Math.max(inside, Math.abs(alpha.data[y * n + x] - alpha.data[y * n + x - 1]));
          inside = Math.max(inside, Math.abs(alpha.data[x * n + y] - alpha.data[(x - 1) * n + y]));
        }
      }
      for (let x = 0; x < n; x++) {
        const t = (x + 0.5) / n;
        seam = Math.max(seam,
          Math.abs(A.sampleTiled(alpha, 1 - 0.5 / n, t) - A.sampleTiled(alpha, 0.5 / n, t)),
          Math.abs(A.sampleTiled(alpha, t, 1 - 0.5 / n) - A.sampleTiled(alpha, t, 0.5 / n)));
      }
      check('read as a texture it meets itself: ' + id, seam <= inside + 0.02,
        `${seam.toFixed(3)} across the seam, ${inside.toFixed(3)} the most anywhere else`);
    }
    check('builtin stencils are cached', A.builtin(id) === alpha);
  }
  check('an unknown stencil id is not invented', A.builtin('nope') === null);

  const dirt = A.builtin('dirt');
  eq('sampling outside the stencil reads nothing', A.sample(dirt, -0.1, 0.5), 0);
  eq('sampling past the far edge reads nothing', A.sample(dirt, 0.5, 1.4), 0);
  const at = 63.5 / dirt.size;          // the centre of texel 63
  const mid = A.sample(dirt, at, at);
  check('sampling a texel centre returns that texel',
    Math.abs(mid - dirt.data[63 * dirt.size + 63]) < 1e-6,
    `${mid} vs ${dirt.data[63 * dirt.size + 63]}`);
  const blended = A.sample(dirt, 0.5, 0.5);
  const corners = [dirt.data[63 * dirt.size + 63], dirt.data[63 * dirt.size + 64],
                   dirt.data[64 * dirt.size + 63], dirt.data[64 * dirt.size + 64]];
  check('sampling between texels blends them',
    blended >= Math.min.apply(null, corners) - 1e-6 && blended <= Math.max.apply(null, corners) + 1e-6,
    `${blended} outside ${corners.join('..')}`);

  /* loading an image */
  const w = 8, h = 4;
  const pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      // top row white, bottom row black, full alpha
      const v = y === 0 ? 255 : 0;
      pixels[o] = pixels[o + 1] = pixels[o + 2] = v;
      pixels[o + 3] = 255;
    }
  }
  const img = A.fromPixels('test', 'Test', pixels, w, h, { normalize: false });
  eq('a loaded image keeps its label', img.label, 'Test');
  // read inside the border, since a stamp's outermost 6% fades out
  check('image rows are flipped so v runs upwards',
    A.sample(img, 0.5, 0.9) > 0.9 && A.sample(img, 0.5, 0.1) < 0.1,
    `${A.sample(img, 0.5, 0.9)} / ${A.sample(img, 0.5, 0.1)}`);
  const inv = A.fromPixels('inv', 'Inv', pixels, w, h, { normalize: false, invert: true });
  check('inverting a loaded image flips it', A.sample(inv, 0.5, 0.9) < 0.1);

  // transparency counts as nothing
  const cut = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    cut[i * 4] = cut[i * 4 + 1] = cut[i * 4 + 2] = 255;
    cut[i * 4 + 3] = i < (w * h) / 2 ? 0 : 255;
  }
  const cutAlpha = A.fromPixels('cut', 'Cut', cut, w, h, { normalize: false });
  check('a transparent pixel reads as nothing', A.sample(cutAlpha, 0.5, 0.95) < 0.02,
    `${A.sample(cutAlpha, 0.5, 0.95)}`);

  // an oversized image is boxed down rather than refused
  const bigW = 700, bigH = 300;
  const big = new Uint8Array(bigW * bigH * 4).fill(255);
  const downed = A.fromPixels('big', 'Big', big, bigW, bigH);
  check('a large image is scaled down', downed.size <= 256, `${downed.size}`);

  /* the registry */
  A.loaded = {};
  A.add(img);
  eq('a loaded stencil is findable', S.alphaById('test'), img);
  eq('none means none', S.alphaById('none'), null);
  eq('the list has the built-ins plus what is loaded', A.list().length, A.BUILTIN_IDS.length + 1);
  eq('labelOf reads a loaded stencil', A.labelOf('test'), 'Test');
  eq('labelOf reads a built-in', A.labelOf('gravel'), 'Gravel');
  eq('labelOf handles none', A.labelOf('none'), 'None');
  A.remove('test');
  eq('a removed stencil is gone', S.alphaById('test'), null);

  /* thumbnails */
  const rgba = A.toRGBA(A.builtin('rivet'), 16);
  eq('a thumbnail is rgba', rgba.length, 16 * 16 * 4);
  let opaqueThumb = true, grey = true;
  for (let i = 0; i < 16 * 16; i++) {
    if (rgba[i * 4 + 3] !== 255) opaqueThumb = false;
    if (rgba[i * 4] !== rgba[i * 4 + 1] || rgba[i * 4 + 1] !== rgba[i * 4 + 2]) grey = false;
  }
  check('thumbnails are opaque greyscale', opaqueThumb && grey);

  /* saving */
  function stubStore() {
    return { m: {}, getItem(k) { return this.m[k] === undefined ? null : this.m[k]; },
             setItem(k, v) { this.m[k] = String(v); } };
  }
  const store = stubStore();
  A.loaded = {};
  A.add(A.make('keep', 'Keep', dirt.size, dirt.data));
  check('stencils save', A.saveAll(store));
  A.loaded = {};
  eq('stencils come back', A.loadAll(store), 1);
  const restored = S.alphaById('keep');
  let worst = 0;
  for (let i = 0; i < dirt.data.length; i++) worst = Math.max(worst, Math.abs(dirt.data[i] - restored.data[i]));
  check('a saved stencil is accurate to a byte', worst <= 1 / 255 + 1e-6, `${worst}`);
  eq('a saved stencil keeps its label', restored.label, 'Keep');

  const broken = stubStore();
  broken.m['sculptfree.alphas.v1'] = '{not json';
  A.loaded = {};
  eq('a corrupt store restores nothing', A.loadAll(broken), 0);
  eq('an empty store restores nothing', A.loadAll(stubStore()), 0);

  // the cap keeps localStorage from filling up
  A.loaded = {};
  for (let i = 0; i < A.MAX_SAVED + 4; i++) {
    A.add(A.make('a' + i, 'A' + i, 16, new Float32Array(256).fill(i / 40)));
  }
  const capped = stubStore();
  A.saveAll(capped);
  A.loaded = {};
  eq('saving caps how many stencils are kept', A.loadAll(capped), A.MAX_SAVED);
  A.loaded = {};

  // base64 helpers on their own
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 0xFF);
  const round = A.fromBase64(A.toBase64(bytes));
  let b64bad = round.length !== bytes.length ? 1 : 0;
  for (let i = 0; i < bytes.length && !b64bad; i++) if (round[i] !== bytes[i]) b64bad = 1;
  eq('base64 round trips', b64bad, 0);
  for (const len of [0, 1, 2, 3, 4, 5]) {
    const src = Uint8Array.from({ length: len }, (_, i) => i + 1);
    const got = A.fromBase64(A.toBase64(src));
    check('base64 handles length ' + len, got.length === len && Array.from(got).join(',') === Array.from(src).join(','),
      `${Array.from(got).join(',')}`);
  }
}

/* ---------------------------------------------------------------- *
 * the stencil's footprint
 * ---------------------------------------------------------------- */

{
  // the two shapes a stamp relies on: solid in the middle, nothing at the rim
  const square = A.builtin('square');
  check('a square stencil is solid in the middle', A.sample(square, 0.5, 0.5) > 0.9,
    `${A.sample(square, 0.5, 0.5)}`);
  check('a square stencil reaches its corners', A.sample(square, 0.2, 0.8) > 0.9,
    `${A.sample(square, 0.2, 0.8)}`);
  const rivet = A.builtin('rivet');
  check('a rivet stencil is a dome', A.sample(rivet, 0.5, 0.5) > 0.9 && A.sample(rivet, 0.98, 0.5) === 0,
    `${A.sample(rivet, 0.5, 0.5)} / ${A.sample(rivet, 0.98, 0.5)}`);
  check('a round stencil is symmetric',
    Math.abs(A.sample(rivet, 0.3, 0.5) - A.sample(rivet, 0.7, 0.5)) < 0.02);
}

/* ---------------------------------------------------------------- *
 * presets
 * ---------------------------------------------------------------- */

{
  check('there are built-in presets', P.BUILTIN.length >= 10, `${P.BUILTIN.length}`);
  const ids = new Set();
  for (const preset of P.BUILTIN) {
    check('preset has a label: ' + preset.id, !!preset.label && !!preset.hint);
    check('preset ids are unique: ' + preset.id, !ids.has(preset.id));
    ids.add(preset.id);
    check('preset names a real brush: ' + preset.id, !!S.brushById(preset.settings.brush),
      preset.settings.brush);
    for (const key in preset.settings) {
      check('preset only sets known keys: ' + preset.id + '.' + key, P.KEYS.indexOf(key) >= 0);
    }
    const alpha = preset.settings.alpha;
    if (alpha && alpha !== 'none') {
      check('preset uses a stencil that exists: ' + preset.id, A.BUILTIN_IDS.indexOf(alpha) >= 0, alpha);
    }
    check('preset strength is sane: ' + preset.id,
      preset.settings.strength === undefined || (preset.settings.strength > 0 && preset.settings.strength <= 1));
    check('preset radius is sane: ' + preset.id,
      preset.settings.radius === undefined || (preset.settings.radius >= 4 && preset.settings.radius <= 400));
    check('preset describes itself: ' + preset.id, P.describe(preset).length > 3, P.describe(preset));
  }

  const settings = { brush: 'clay', radius: 62, strength: 0.55, falloff: 'smooth', spacing: 0.16,
                     autoSmooth: 0.28, strokeSmoothing: 0.3, clayOffset: 0.18, alpha: 'none',
                     stampMode: false, alphaFollowStroke: true, alphaRandomRotate: false,
                     paintColorHex: '#d94f3d', frontFacing: true, dyntopo: false };
  const seen = [];
  const changed = P.apply(P.builtinById('rivets'), settings, (k, v) => { settings[k] = v; seen.push(k); });
  check('applying a preset reports what it changed', changed.length > 3, changed.join(','));
  eq('applying a preset goes through set()', seen.join(','), changed.join(','));
  eq('the preset picked its brush', settings.brush, 'draw');
  eq('the preset picked its stencil', settings.alpha, 'rivet');
  eq('the preset turned on stamp mode', settings.stampMode, true);
  eq('applying it again changes nothing', P.apply(P.builtinById('rivets'), settings, () => {}).length, 0);

  const mine = P.capture(settings, 'Mine');
  eq('a captured preset takes every key', Object.keys(mine.settings).length, P.KEYS.length);
  check('a captured preset is marked as the user’s', mine.user === true);
  check('captured ids do not collide', P.capture(settings).id !== P.capture(settings).id);

  const other = { brush: 'smooth', radius: 10, strength: 0.1, alpha: 'none', stampMode: false };
  P.apply(mine, other, (k, v) => { other[k] = v; });
  eq('a captured preset restores the brush', other.brush, 'draw');
  eq('a captured preset restores the radius', other.radius, settings.radius);

  function stubStore() {
    return { m: {}, getItem(k) { return this.m[k] === undefined ? null : this.m[k]; },
             setItem(k, v) { this.m[k] = String(v); } };
  }
  const store = stubStore();
  check('presets save', P.save(store, [mine]));
  const loaded = P.load(store);
  eq('presets come back', loaded.length, 1);
  eq('a loaded preset keeps its name', loaded[0].label, 'Mine');
  eq('a loaded preset keeps its brush', loaded[0].settings.brush, 'draw');
  eq('a loaded preset is the user’s', loaded[0].user, true);

  const dirty = stubStore();
  dirty.m['sculptfree.presets.v1'] = JSON.stringify([
    { id: 'x', label: 'X', settings: { brush: 'clay', evil: 'rm -rf', historyBudgetMB: 99999 } },
    { nonsense: true },
    null
  ]);
  const cleaned = P.load(dirty);
  eq('a junk entry is skipped', cleaned.length, 1);
  eq('unknown keys are dropped', Object.keys(cleaned[0].settings).join(','), 'brush');

  const corrupt = stubStore();
  corrupt.m['sculptfree.presets.v1'] = 'not json at all';
  eq('a corrupt preset store is empty', P.load(corrupt).length, 0);
  eq('an empty preset store is empty', P.load(stubStore()).length, 0);

  eq('all() puts the built-ins first', P.all(loaded)[0].id, P.BUILTIN[0].id);
  eq('all() appends the saved ones', P.all(loaded).length, P.BUILTIN.length + 1);
  eq('byId finds a built-in', P.byId('blockout', loaded).id, 'blockout');
  eq('byId finds a saved one', P.byId(mine.id, loaded).label, 'Mine');
  check('byId returns nothing for an unknown id', P.byId('nope', loaded) === null);
}

report('texture');
