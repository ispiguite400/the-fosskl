/*
 * SculptFree — import and export.
 *
 * Reads OBJ, STL (binary and ascii), PLY (ascii and both binary byte
 * orders) and glTF/GLB, and writes OBJ, STL, PLY, GLB and its own .sculpt
 * project container. No size limits, no watermarks, no feature gates: the
 * point of this app is that getting your model out is free.
 *
 * Everything here works on plain typed arrays so it can be tested without a
 * browser, and so the same code can run inside a worker later.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var IO = S.IO = {};

  /* ================================================================ *
   * helpers
   * ================================================================ */

  var textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
  function decode(buf) {
    var view = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    if (textDecoder) return textDecoder.decode(view);
    var s = '';
    for (var i = 0; i < view.length; i += 8192) {
      s += String.fromCharCode.apply(null, view.subarray(i, Math.min(i + 8192, view.length)));
    }
    return s;
  }
  IO.decode = decode;

  function encodeUtf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }
  IO.encodeUtf8 = encodeUtf8;

  IO.extensionOf = function (name) {
    var m = /\.([a-z0-9]+)\s*$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  };

  /** Axis conversions between our Y-up space and other tools' conventions. */
  IO.AXIS_MODES = [
    { id: 'y', label: 'Y up (glTF, Unity, Three.js)' },
    { id: 'z', label: 'Z up (Blender, 3ds Max, Godot)' }
  ];

  function axisOut(mode, x, y, z, out) {
    if (mode === 'z') { out[0] = x; out[1] = -z; out[2] = y; }
    else { out[0] = x; out[1] = y; out[2] = z; }
    return out;
  }
  function axisIn(mode, x, y, z, out) {
    if (mode === 'z') { out[0] = x; out[1] = z; out[2] = -y; }
    else { out[0] = x; out[1] = y; out[2] = z; }
    return out;
  }
  IO.axisOut = axisOut;
  IO.axisIn = axisIn;

  /**
   * Flatten a list of scene objects into export-ready geometry. Each entry
   * gets positions/normals/colors/indices in the requested space.
   *
   * opts: { scale, axis, applyTransform, includeNormals, includeColors }
   */
  IO.prepare = function (objects, opts) {
    opts = opts || {};
    var scale = opts.scale === undefined ? 1 : opts.scale;
    var axis = opts.axis || 'y';
    var apply = opts.applyTransform !== false;
    var out = [];
    var tmp = [0, 0, 0];
    for (var i = 0; i < objects.length; i++) {
      var obj = objects[i];
      var d = obj.mesh.toIndexed();
      if (!d.vertCount || !d.triCount) continue;
      var pos = d.positions, nor = d.normals;
      var n = d.vertCount;
      var outPos = new Float32Array(n * 3);
      var outNor = new Float32Array(n * 3);
      var mat = apply ? obj.matrix() : null;
      var nmat = apply ? obj.normalMatrix() : null;
      for (var v = 0; v < n; v++) {
        var o = v * 3;
        var x = pos[o], y = pos[o + 1], z = pos[o + 2];
        if (mat) {
          var w = mat[3] * x + mat[7] * y + mat[11] * z + mat[15];
          w = w || 1;
          var tx = (mat[0] * x + mat[4] * y + mat[8] * z + mat[12]) / w;
          var ty = (mat[1] * x + mat[5] * y + mat[9] * z + mat[13]) / w;
          var tz = (mat[2] * x + mat[6] * y + mat[10] * z + mat[14]) / w;
          x = tx; y = ty; z = tz;
        }
        axisOut(axis, x * scale, y * scale, z * scale, tmp);
        outPos[o] = tmp[0]; outPos[o + 1] = tmp[1]; outPos[o + 2] = tmp[2];

        var nx = nor[o], ny = nor[o + 1], nz = nor[o + 2];
        if (nmat) {
          var mx = nmat[0] * nx + nmat[4] * ny + nmat[8] * nz;
          var my = nmat[1] * nx + nmat[5] * ny + nmat[9] * nz;
          var mz = nmat[2] * nx + nmat[6] * ny + nmat[10] * nz;
          var l = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
          nx = mx / l; ny = my / l; nz = mz / l;
        }
        axisOut(axis, nx, ny, nz, tmp);
        outNor[o] = tmp[0]; outNor[o + 1] = tmp[1]; outNor[o + 2] = tmp[2];
      }
      // mirrored transforms flip winding; put it back so faces stay outward
      var flip = false;
      if (mat) {
        var det = mat[0] * (mat[5] * mat[10] - mat[6] * mat[9])
                - mat[4] * (mat[1] * mat[10] - mat[2] * mat[9])
                + mat[8] * (mat[1] * mat[6] - mat[2] * mat[5]);
        flip = det < 0;
      }
      var idx = d.indices32;
      if (flip) {
        var swapped = new Uint32Array(idx.length);
        for (var t = 0; t < idx.length; t += 3) {
          swapped[t] = idx[t]; swapped[t + 1] = idx[t + 2]; swapped[t + 2] = idx[t + 1];
        }
        idx = swapped;
      }
      var geom = {
        name: obj.name || ('object_' + (i + 1)),
        positions: outPos,
        normals: outNor,
        colors: d.colors,
        indices: idx,
        vertCount: n,
        triCount: d.triCount,
        color: obj.baseColor ? obj.baseColor.slice() : [0.85, 0.85, 0.85]
      };
      /*
       * A painted object carries its image along, plus its vertices as they
       * are in its own space. Baking the texture means asking the image what
       * colour the surface is at a point, and the image is mapped in the
       * object's space — while everything above has been moved into export
       * space. Keeping both is cheaper and exact, where inverting the
       * transform per texel would be neither.
       */
      if (obj.paint) {
        geom.paint = obj.paint;
        geom.localPositions = pos.slice(0, n * 3);
        geom.localNormals = nor.slice(0, n * 3);
      }
      out.push(geom);
    }
    return out;
  };

  /* ================================================================ *
   * OBJ
   * ================================================================ */

  /**
   * Wavefront OBJ. Handles v/vn/vt, n-gons, negative indices, o/g groups and
   * the widely used "v x y z r g b" vertex-colour extension.
   */
  IO.parseOBJ = function (text) {
    var lines = text.split('\n');
    var vp = [], vc = [], vn = [];
    var groups = [];
    var cur = null;
    var warnings = [];
    var hasColor = false;

    function ensureGroup(name) {
      if (cur && cur.indices.length === 0) { cur.name = name || cur.name; return cur; }
      cur = { name: name || ('group_' + (groups.length + 1)), indices: [], normalIdx: [] };
      groups.push(cur);
      return cur;
    }
    ensureGroup('object_1');

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // strip comments and whitespace cheaply
      var hash = line.indexOf('#');
      if (hash >= 0) line = line.slice(0, hash);
      var c0 = line.charCodeAt(0);
      if (!line.length) continue;
      if (c0 === 118) {                       // 'v'
        var c1 = line.charCodeAt(1);
        if (c1 === 32 || c1 === 9) {
          var parts = line.split(/\s+/);
          vp.push(+parts[1], +parts[2], +parts[3]);
          if (parts.length >= 7 && parts[4] !== '' && isFinite(+parts[6])) {
            var r = +parts[4], g = +parts[5], b = +parts[6];
            // some writers use 0-255
            if (r > 1.001 || g > 1.001 || b > 1.001) { r /= 255; g /= 255; b /= 255; }
            vc.push(r, g, b);
            hasColor = true;
          } else {
            vc.push(1, 1, 1);
          }
        } else if (c1 === 110) {               // 'vn'
          var pn = line.split(/\s+/);
          vn.push(+pn[1], +pn[2], +pn[3]);
        }
        continue;
      }
      if (c0 === 102 && (line.charCodeAt(1) === 32 || line.charCodeAt(1) === 9)) {   // 'f '
        var f = line.split(/\s+/);
        var poly = [], polyN = [];
        for (var k = 1; k < f.length; k++) {
          var tok = f[k];
          if (!tok) continue;
          var slash = tok.indexOf('/');
          var vi, ni = 0;
          if (slash < 0) {
            vi = parseInt(tok, 10);
          } else {
            vi = parseInt(tok.slice(0, slash), 10);
            var rest = tok.slice(slash + 1);
            var slash2 = rest.indexOf('/');
            if (slash2 >= 0) ni = parseInt(rest.slice(slash2 + 1), 10) || 0;
          }
          if (isNaN(vi)) continue;
          var total = vp.length / 3;
          poly.push(vi < 0 ? total + vi : vi - 1);
          var totalN = vn.length / 3;
          polyN.push(ni === 0 ? -1 : (ni < 0 ? totalN + ni : ni - 1));
        }
        for (var t = 1; t + 1 < poly.length; t++) {     // fan triangulation
          cur.indices.push(poly[0], poly[t], poly[t + 1]);
          cur.normalIdx.push(polyN[0], polyN[t], polyN[t + 1]);
        }
        continue;
      }
      if ((c0 === 111 || c0 === 103) && (line.charCodeAt(1) === 32 || line.charCodeAt(1) === 9)) {
        ensureGroup(line.slice(2).trim());    // 'o ' / 'g '
      }
    }

    var positions = new Float32Array(vp);
    var colors = hasColor ? new Float32Array(vc) : null;
    var objects = [];
    for (var gi = 0; gi < groups.length; gi++) {
      var grp = groups[gi];
      if (!grp.indices.length) continue;
      objects.push({
        name: grp.name,
        positions: positions,
        colors: colors,
        indices: new Uint32Array(grp.indices),
        shared: true
      });
    }
    if (!objects.length) warnings.push('No faces found in the OBJ file.');
    return { objects: objects, warnings: warnings };
  };

  IO.exportOBJ = function (geoms, opts) {
    opts = opts || {};
    var out = [];
    out.push('# Exported by SculptFree ' + S.VERSION);
    out.push('# ' + new Date().toISOString());
    if (opts.mtlName) out.push('mtllib ' + opts.mtlName);
    var vertBase = 1;
    // OBJ counts texture coordinates in their own namespace, so an object
    // without UVs must not advance it
    var uvBase = 1;
    for (var i = 0; i < geoms.length; i++) {
      var g = geoms[i];
      var n = g.vertCount;
      out.push('o ' + g.name.replace(/\s+/g, '_'));
      if (opts.mtlName) out.push('usemtl ' + materialName(g, i));
      var p = g.positions, c = g.colors, nor = g.normals;
      var v, o;
      if (opts.includeColors && c) {
        for (v = 0; v < n; v++) {
          o = v * 3;
          out.push('v ' + p[o].toPrecision(7) + ' ' + p[o + 1].toPrecision(7) + ' ' + p[o + 2].toPrecision(7) +
                   ' ' + c[o].toFixed(4) + ' ' + c[o + 1].toFixed(4) + ' ' + c[o + 2].toFixed(4));
        }
      } else {
        for (v = 0; v < n; v++) {
          o = v * 3;
          out.push('v ' + p[o].toPrecision(7) + ' ' + p[o + 1].toPrecision(7) + ' ' + p[o + 2].toPrecision(7));
        }
      }
      /*
       * Texture coordinates, when the geometry has been unwrapped. There is
       * one per vertex (the unwrap duplicates any vertex that lands on two
       * charts), so the vt list runs parallel to the v list and one index
       * serves both.
       */
      var withUV = !!g.uvs;
      if (withUV) {
        for (v = 0; v < n; v++) {
          out.push('vt ' + g.uvs[v * 2].toFixed(6) + ' ' + g.uvs[v * 2 + 1].toFixed(6));
        }
      }
      var withNormals = opts.includeNormals !== false;
      if (withNormals) {
        for (v = 0; v < n; v++) {
          o = v * 3;
          out.push('vn ' + nor[o].toFixed(6) + ' ' + nor[o + 1].toFixed(6) + ' ' + nor[o + 2].toFixed(6));
        }
      }
      var idx = g.indices;
      for (var t = 0; t < idx.length; t += 3) {
        var a = idx[t] + vertBase, b = idx[t + 1] + vertBase, cc = idx[t + 2] + vertBase;
        if (withUV && withNormals) {
          var ua = idx[t] + uvBase, ub = idx[t + 1] + uvBase, uc = idx[t + 2] + uvBase;
          out.push('f ' + a + '/' + ua + '/' + a + ' ' + b + '/' + ub + '/' + b +
                   ' ' + cc + '/' + uc + '/' + cc);
        } else if (withUV) {
          out.push('f ' + a + '/' + (idx[t] + uvBase) + ' ' + b + '/' + (idx[t + 1] + uvBase) +
                   ' ' + cc + '/' + (idx[t + 2] + uvBase));
        } else if (withNormals) {
          out.push('f ' + a + '//' + a + ' ' + b + '//' + b + ' ' + cc + '//' + cc);
        } else {
          out.push('f ' + a + ' ' + b + ' ' + cc);
        }
      }
      vertBase += n;
      if (withUV) uvBase += n;
    }
    return out.join('\n') + '\n';
  };

  function materialName(g, i) {
    var name = (g.name || ('object_' + (i + 1))).replace(/\s+/g, '_');
    return name + '_mat';
  }
  IO.materialName = materialName;

  /**
   * The companion .mtl file. One material per object, pointing at the baked
   * texture when there is one — which is all Roblox Studio, Blender or Unity
   * need to show the paint straight after import.
   */
  IO.exportMTL = function (geoms, opts) {
    opts = opts || {};
    var out = ['# Exported by SculptFree ' + S.VERSION];
    for (var i = 0; i < geoms.length; i++) {
      var g = geoms[i];
      var base = g.color || [0.85, 0.85, 0.85];
      out.push('');
      out.push('newmtl ' + materialName(g, i));
      out.push('Ka 0.000 0.000 0.000');
      out.push('Kd ' + (g.textureName ? '1.000 1.000 1.000' :
        base[0].toFixed(3) + ' ' + base[1].toFixed(3) + ' ' + base[2].toFixed(3)));
      out.push('Ks 0.050 0.050 0.050');
      out.push('Ns 20.0');
      out.push('d 1.0');
      out.push('illum 2');
      if (g.textureName) out.push('map_Kd ' + g.textureName);
    }
    return out.join('\n') + '\n';
  };

  /* ================================================================ *
   * STL
   * ================================================================ */

  IO.looksLikeBinarySTL = function (buffer) {
    var bytes = new Uint8Array(buffer);
    if (bytes.length < 84) return false;
    var dv = new DataView(buffer);
    var tri = dv.getUint32(80, true);
    if (84 + tri * 50 === bytes.length) return true;
    // some writers pad; fall back to sniffing for "solid" plus printable text
    var head = decode(bytes.subarray(0, 5)).toLowerCase();
    if (head === 'solid') {
      var sample = decode(bytes.subarray(0, Math.min(512, bytes.length)));
      if (/facet\s+normal/i.test(sample) || /vertex\s/i.test(sample)) return false;
    }
    return true;
  };

  IO.parseSTL = function (buffer) {
    if (IO.looksLikeBinarySTL(buffer)) return IO.parseBinarySTL(buffer);
    return IO.parseAsciiSTL(decode(buffer));
  };

  IO.parseBinarySTL = function (buffer) {
    var dv = new DataView(buffer);
    var nTri = dv.getUint32(80, true);
    var maxTri = Math.floor((buffer.byteLength - 84) / 50);
    var warnings = [];
    if (nTri > maxTri) { warnings.push('STL header claims ' + nTri + ' triangles but the file holds ' + maxTri + '.'); nTri = maxTri; }
    var positions = new Float32Array(nTri * 9);
    var colors = null;
    var off = 84;
    for (var t = 0; t < nTri; t++, off += 50) {
      var o = t * 9;
      for (var v = 0; v < 3; v++) {
        positions[o + v * 3] = dv.getFloat32(off + 12 + v * 12, true);
        positions[o + v * 3 + 1] = dv.getFloat32(off + 16 + v * 12, true);
        positions[o + v * 3 + 2] = dv.getFloat32(off + 20 + v * 12, true);
      }
      // the VisCAM/SolidView colour convention in the attribute short
      var attr = dv.getUint16(off + 48, true);
      if (attr & 0x8000) {
        if (!colors) { colors = new Float32Array(nTri * 9); colors.fill(1); }
        var r = ((attr >> 10) & 0x1f) / 31, g = ((attr >> 5) & 0x1f) / 31, b = (attr & 0x1f) / 31;
        for (var k = 0; k < 3; k++) {
          colors[o + k * 3] = r; colors[o + k * 3 + 1] = g; colors[o + k * 3 + 2] = b;
        }
      }
    }
    var indices = new Uint32Array(nTri * 3);
    for (var i = 0; i < indices.length; i++) indices[i] = i;
    return { objects: [{ name: 'stl_mesh', positions: positions, colors: colors, indices: indices }], warnings: warnings };
  };

  IO.parseAsciiSTL = function (text) {
    var pos = [];
    var re = /vertex\s+(-?[0-9eE.+-]+)\s+(-?[0-9eE.+-]+)\s+(-?[0-9eE.+-]+)/g;
    var m;
    while ((m = re.exec(text))) pos.push(+m[1], +m[2], +m[3]);
    var n = Math.floor(pos.length / 9) * 9;
    var positions = new Float32Array(pos.slice(0, n));
    var indices = new Uint32Array(n / 3);
    for (var i = 0; i < indices.length; i++) indices[i] = i;
    var warnings = [];
    if (!indices.length) warnings.push('No vertices found in the ascii STL.');
    return { objects: [{ name: 'stl_mesh', positions: positions, indices: indices }], warnings: warnings };
  };

  IO.exportSTL = function (geoms, opts) {
    opts = opts || {};
    var total = 0, i;
    for (i = 0; i < geoms.length; i++) total += geoms[i].triCount;

    if (opts.ascii) {
      var out = ['solid SculptFree'];
      for (i = 0; i < geoms.length; i++) {
        var g = geoms[i], p = g.positions, idx = g.indices;
        for (var t = 0; t < idx.length; t += 3) {
          var a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
          var e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
          var e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
          var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
          var l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          out.push('  facet normal ' + (nx / l).toFixed(6) + ' ' + (ny / l).toFixed(6) + ' ' + (nz / l).toFixed(6));
          out.push('    outer loop');
          out.push('      vertex ' + p[a].toPrecision(7) + ' ' + p[a + 1].toPrecision(7) + ' ' + p[a + 2].toPrecision(7));
          out.push('      vertex ' + p[b].toPrecision(7) + ' ' + p[b + 1].toPrecision(7) + ' ' + p[b + 2].toPrecision(7));
          out.push('      vertex ' + p[c].toPrecision(7) + ' ' + p[c + 1].toPrecision(7) + ' ' + p[c + 2].toPrecision(7));
          out.push('    endloop');
          out.push('  endfacet');
        }
      }
      out.push('endsolid SculptFree');
      return out.join('\n') + '\n';
    }

    var buffer = new ArrayBuffer(84 + total * 50);
    var dv = new DataView(buffer);
    var header = encodeUtf8('Binary STL written by SculptFree ' + S.VERSION);
    new Uint8Array(buffer, 0, Math.min(80, header.length)).set(header.subarray(0, 80));
    dv.setUint32(80, total, true);
    var off = 84;
    for (i = 0; i < geoms.length; i++) {
      var g2 = geoms[i], p2 = g2.positions, idx2 = g2.indices, col = g2.colors;
      for (var t2 = 0; t2 < idx2.length; t2 += 3) {
        var a2 = idx2[t2] * 3, b2 = idx2[t2 + 1] * 3, c2 = idx2[t2 + 2] * 3;
        var f1x = p2[b2] - p2[a2], f1y = p2[b2 + 1] - p2[a2 + 1], f1z = p2[b2 + 2] - p2[a2 + 2];
        var f2x = p2[c2] - p2[a2], f2y = p2[c2 + 1] - p2[a2 + 1], f2z = p2[c2 + 2] - p2[a2 + 2];
        var mx = f1y * f2z - f1z * f2y, my = f1z * f2x - f1x * f2z, mz = f1x * f2y - f1y * f2x;
        var ml = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
        dv.setFloat32(off, mx / ml, true);
        dv.setFloat32(off + 4, my / ml, true);
        dv.setFloat32(off + 8, mz / ml, true);
        for (var v2 = 0; v2 < 3; v2++) {
          var src = [a2, b2, c2][v2];
          dv.setFloat32(off + 12 + v2 * 12, p2[src], true);
          dv.setFloat32(off + 16 + v2 * 12, p2[src + 1], true);
          dv.setFloat32(off + 20 + v2 * 12, p2[src + 2], true);
        }
        var attr = 0;
        if (opts.includeColors && col) {
          var ci = idx2[t2] * 3;
          var r5 = Math.round(S.clamp(col[ci], 0, 1) * 31);
          var g5 = Math.round(S.clamp(col[ci + 1], 0, 1) * 31);
          var b5 = Math.round(S.clamp(col[ci + 2], 0, 1) * 31);
          attr = 0x8000 | (r5 << 10) | (g5 << 5) | b5;
        }
        dv.setUint16(off + 48, attr, true);
        off += 50;
      }
    }
    return buffer;
  };

  /* ================================================================ *
   * PLY
   * ================================================================ */

  var PLY_SIZES = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2,
                    int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };

  function plyReader(dv, type, little) {
    switch (type) {
      case 'char': case 'int8': return function (o) { return dv.getInt8(o); };
      case 'uchar': case 'uint8': return function (o) { return dv.getUint8(o); };
      case 'short': case 'int16': return function (o) { return dv.getInt16(o, little); };
      case 'ushort': case 'uint16': return function (o) { return dv.getUint16(o, little); };
      case 'int': case 'int32': return function (o) { return dv.getInt32(o, little); };
      case 'uint': case 'uint32': return function (o) { return dv.getUint32(o, little); };
      case 'double': case 'float64': return function (o) { return dv.getFloat64(o, little); };
      default: return function (o) { return dv.getFloat32(o, little); };
    }
  }

  IO.parsePLY = function (buffer) {
    var bytes = new Uint8Array(buffer);
    // find "end_header"
    var headerText = decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
    var endIdx = headerText.indexOf('end_header');
    if (endIdx < 0) return { objects: [], warnings: ['Not a PLY file (no end_header).'] };
    var nl = headerText.indexOf('\n', endIdx);
    var headerBytes = encodeUtf8(headerText.slice(0, nl + 1)).length;
    var lines = headerText.slice(0, endIdx).split('\n');

    var format = 'ascii', little = true;
    var elements = [];
    var curEl = null;
    for (var i = 0; i < lines.length; i++) {
      var tok = lines[i].trim().split(/\s+/);
      if (tok[0] === 'format') {
        format = tok[1];
        little = format !== 'binary_big_endian';
      } else if (tok[0] === 'element') {
        curEl = { name: tok[1], count: parseInt(tok[2], 10), props: [] };
        elements.push(curEl);
      } else if (tok[0] === 'property' && curEl) {
        if (tok[1] === 'list') curEl.props.push({ list: true, countType: tok[2], type: tok[3], name: tok[4] });
        else curEl.props.push({ list: false, type: tok[1], name: tok[2] });
      }
    }

    var warnings = [];
    var positions = null, colors = null, normals = null, indices = [];
    var vertEl = null;
    for (i = 0; i < elements.length; i++) if (elements[i].name === 'vertex') vertEl = elements[i];
    if (!vertEl) return { objects: [], warnings: ['PLY has no vertex element.'] };
    positions = new Float32Array(vertEl.count * 3);

    var colorScale = 1 / 255;
    function propIsFloat(p) { return p && (p.type === 'float' || p.type === 'float32' || p.type === 'double' || p.type === 'float64'); }

    if (format === 'ascii') {
      var body = decode(bytes.subarray(headerBytes)).split('\n');
      var lineNo = 0;
      function nextTokens() {
        while (lineNo < body.length) {
          var l = body[lineNo++].trim();
          if (l) return l.split(/\s+/);
        }
        return null;
      }
      for (var e = 0; e < elements.length; e++) {
        var el = elements[e];
        for (var r = 0; r < el.count; r++) {
          var vals = nextTokens();
          if (!vals) { warnings.push('PLY ended early.'); break; }
          if (el.name === 'vertex') {
            var pi = 0, map = {};
            for (var pp = 0; pp < el.props.length; pp++) map[el.props[pp].name] = +vals[pp];
            var o = r * 3;
            positions[o] = map.x || 0; positions[o + 1] = map.y || 0; positions[o + 2] = map.z || 0;
            if (map.nx !== undefined) {
              if (!normals) normals = new Float32Array(vertEl.count * 3);
              normals[o] = map.nx; normals[o + 1] = map.ny; normals[o + 2] = map.nz;
            }
            if (map.red !== undefined) {
              if (!colors) colors = new Float32Array(vertEl.count * 3);
              var isF = propIsFloat(el.props.find(function (q) { return q.name === 'red'; }));
              var sc = isF ? 1 : colorScale;
              colors[o] = map.red * sc; colors[o + 1] = map.green * sc; colors[o + 2] = map.blue * sc;
            }
          } else if (el.name === 'face') {
            var cnt = +vals[0];
            for (var k = 1; k + 1 < cnt; k++) {
              indices.push(+vals[1], +vals[1 + k], +vals[2 + k]);
            }
          }
        }
      }
    } else {
      var dv = new DataView(buffer);
      var off = headerBytes;
      for (var e2 = 0; e2 < elements.length; e2++) {
        var el2 = elements[e2];
        // pre-resolve readers
        var readers = [];
        for (var q = 0; q < el2.props.length; q++) {
          var pr = el2.props[q];
          readers.push({
            prop: pr,
            read: plyReader(dv, pr.type, little),
            size: PLY_SIZES[pr.type] || 4,
            readCount: pr.list ? plyReader(dv, pr.countType, little) : null,
            countSize: pr.list ? (PLY_SIZES[pr.countType] || 1) : 0
          });
        }
        for (var r2 = 0; r2 < el2.count; r2++) {
          if (off >= buffer.byteLength) { warnings.push('PLY body ended early.'); break; }
          if (el2.name === 'vertex') {
            var vals2 = {};
            for (var q2 = 0; q2 < readers.length; q2++) {
              var rd = readers[q2];
              if (rd.prop.list) {
                var c = rd.readCount(off); off += rd.countSize;
                off += c * rd.size;
                continue;
              }
              vals2[rd.prop.name] = rd.read(off);
              off += rd.size;
            }
            var o2 = r2 * 3;
            positions[o2] = vals2.x || 0; positions[o2 + 1] = vals2.y || 0; positions[o2 + 2] = vals2.z || 0;
            if (vals2.nx !== undefined) {
              if (!normals) normals = new Float32Array(vertEl.count * 3);
              normals[o2] = vals2.nx; normals[o2 + 1] = vals2.ny; normals[o2 + 2] = vals2.nz;
            }
            if (vals2.red !== undefined) {
              if (!colors) colors = new Float32Array(vertEl.count * 3);
              var redProp = null;
              for (var z = 0; z < el2.props.length; z++) if (el2.props[z].name === 'red') redProp = el2.props[z];
              var sc2 = propIsFloat(redProp) ? 1 : colorScale;
              colors[o2] = vals2.red * sc2; colors[o2 + 1] = vals2.green * sc2; colors[o2 + 2] = vals2.blue * sc2;
            }
          } else {
            for (var q3 = 0; q3 < readers.length; q3++) {
              var rd2 = readers[q3];
              if (rd2.prop.list) {
                var cnt2 = rd2.readCount(off); off += rd2.countSize;
                if (el2.name === 'face' && /vertex_ind(ex|ices)/.test(rd2.prop.name)) {
                  var poly = [];
                  for (var ci = 0; ci < cnt2; ci++) { poly.push(rd2.read(off)); off += rd2.size; }
                  for (var f = 1; f + 1 < poly.length; f++) indices.push(poly[0], poly[f], poly[f + 1]);
                } else {
                  off += cnt2 * rd2.size;
                }
              } else {
                off += rd2.size;
              }
            }
          }
        }
      }
    }

    if (!indices.length) warnings.push('PLY has no faces — imported as a point set with no surface.');
    return {
      objects: [{ name: 'ply_mesh', positions: positions, colors: colors, normals: normals,
                  indices: new Uint32Array(indices) }],
      warnings: warnings
    };
  };

  IO.exportPLY = function (geoms, opts) {
    opts = opts || {};
    var totalV = 0, totalF = 0, i;
    for (i = 0; i < geoms.length; i++) { totalV += geoms[i].vertCount; totalF += geoms[i].triCount; }
    var withColor = !!opts.includeColors;
    var withNormals = opts.includeNormals !== false;

    var header = ['ply'];
    header.push(opts.ascii ? 'format ascii 1.0' : 'format binary_little_endian 1.0');
    header.push('comment Created by SculptFree ' + S.VERSION);
    header.push('element vertex ' + totalV);
    header.push('property float x', 'property float y', 'property float z');
    if (withNormals) header.push('property float nx', 'property float ny', 'property float nz');
    if (withColor) header.push('property uchar red', 'property uchar green', 'property uchar blue');
    header.push('element face ' + totalF);
    header.push('property list uchar uint vertex_indices');
    header.push('end_header');
    var headerStr = header.join('\n') + '\n';

    if (opts.ascii) {
      var out = [headerStr.slice(0, -1)];
      var base = 0;
      for (i = 0; i < geoms.length; i++) {
        var g = geoms[i], p = g.positions, n = g.normals, c = g.colors;
        for (var v = 0; v < g.vertCount; v++) {
          var o = v * 3;
          var row = p[o].toPrecision(7) + ' ' + p[o + 1].toPrecision(7) + ' ' + p[o + 2].toPrecision(7);
          if (withNormals) row += ' ' + n[o].toFixed(6) + ' ' + n[o + 1].toFixed(6) + ' ' + n[o + 2].toFixed(6);
          if (withColor) row += ' ' + Math.round(S.clamp(c[o], 0, 1) * 255) + ' ' +
                                Math.round(S.clamp(c[o + 1], 0, 1) * 255) + ' ' +
                                Math.round(S.clamp(c[o + 2], 0, 1) * 255);
          out.push(row);
        }
      }
      base = 0;
      for (i = 0; i < geoms.length; i++) {
        var g2 = geoms[i], idx = g2.indices;
        for (var t = 0; t < idx.length; t += 3) {
          out.push('3 ' + (idx[t] + base) + ' ' + (idx[t + 1] + base) + ' ' + (idx[t + 2] + base));
        }
        base += g2.vertCount;
      }
      return out.join('\n') + '\n';
    }

    var vertStride = 12 + (withNormals ? 12 : 0) + (withColor ? 3 : 0);
    var headerBytes = encodeUtf8(headerStr);
    var size = headerBytes.length + totalV * vertStride + totalF * 13;
    var buf = new ArrayBuffer(size);
    var u8 = new Uint8Array(buf);
    u8.set(headerBytes, 0);
    var dv = new DataView(buf);
    var off = headerBytes.length;
    for (i = 0; i < geoms.length; i++) {
      var g3 = geoms[i], p3 = g3.positions, n3 = g3.normals, c3 = g3.colors;
      for (var v3 = 0; v3 < g3.vertCount; v3++) {
        var o3 = v3 * 3;
        dv.setFloat32(off, p3[o3], true); dv.setFloat32(off + 4, p3[o3 + 1], true); dv.setFloat32(off + 8, p3[o3 + 2], true);
        off += 12;
        if (withNormals) {
          dv.setFloat32(off, n3[o3], true); dv.setFloat32(off + 4, n3[o3 + 1], true); dv.setFloat32(off + 8, n3[o3 + 2], true);
          off += 12;
        }
        if (withColor) {
          dv.setUint8(off, Math.round(S.clamp(c3[o3], 0, 1) * 255));
          dv.setUint8(off + 1, Math.round(S.clamp(c3[o3 + 1], 0, 1) * 255));
          dv.setUint8(off + 2, Math.round(S.clamp(c3[o3 + 2], 0, 1) * 255));
          off += 3;
        }
      }
    }
    var base2 = 0;
    for (i = 0; i < geoms.length; i++) {
      var g4 = geoms[i], idx4 = g4.indices;
      for (var t4 = 0; t4 < idx4.length; t4 += 3) {
        dv.setUint8(off, 3); off += 1;
        dv.setUint32(off, idx4[t4] + base2, true); off += 4;
        dv.setUint32(off, idx4[t4 + 1] + base2, true); off += 4;
        dv.setUint32(off, idx4[t4 + 2] + base2, true); off += 4;
      }
      base2 += g4.vertCount;
    }
    return buf;
  };

  /* ================================================================ *
   * glTF / GLB
   * ================================================================ */

  var GLTF_COMPONENT = {
    5120: { ctor: Int8Array, size: 1 }, 5121: { ctor: Uint8Array, size: 1 },
    5122: { ctor: Int16Array, size: 2 }, 5123: { ctor: Uint16Array, size: 2 },
    5125: { ctor: Uint32Array, size: 4 }, 5126: { ctor: Float32Array, size: 4 }
  };
  var GLTF_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

  function readAccessor(json, buffers, index) {
    var acc = json.accessors[index];
    if (!acc) return null;
    var comp = GLTF_COMPONENT[acc.componentType];
    var perElement = GLTF_COUNT[acc.type] || 1;
    var out = new Float32Array(acc.count * perElement);
    if (acc.bufferView === undefined) return out;         // all zeroes is legal
    var view = json.bufferViews[acc.bufferView];
    var buf = buffers[view.buffer || 0];
    if (!buf) return null;
    var base = (view.byteOffset || 0) + (acc.byteOffset || 0);
    var stride = view.byteStride || comp.size * perElement;
    var dv = new DataView(buf);
    var norm = acc.normalized;
    var maxVal = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[acc.componentType] || 1;
    for (var i = 0; i < acc.count; i++) {
      for (var k = 0; k < perElement; k++) {
        var o = base + i * stride + k * comp.size;
        if (o + comp.size > buf.byteLength) return out;
        var val;
        switch (acc.componentType) {
          case 5120: val = dv.getInt8(o); break;
          case 5121: val = dv.getUint8(o); break;
          case 5122: val = dv.getInt16(o, true); break;
          case 5123: val = dv.getUint16(o, true); break;
          case 5125: val = dv.getUint32(o, true); break;
          default: val = dv.getFloat32(o, true);
        }
        if (norm) val = Math.max(val / maxVal, acc.componentType === 5120 || acc.componentType === 5122 ? -1 : 0);
        out[i * perElement + k] = val;
      }
    }
    return out;
  }

  function nodeMatrix(node) {
    var M4 = S.M4, Q4 = S.Q4;
    if (node.matrix) return new Float32Array(node.matrix);
    var t = node.translation || [0, 0, 0];
    var r = node.rotation || [0, 0, 0, 1];
    var s = node.scale || [1, 1, 1];
    return M4.compose(M4.create(), t, r, s);
  }

  IO.parseGLB = function (buffer) {
    var dv = new DataView(buffer);
    var magic = dv.getUint32(0, true);
    if (magic !== 0x46546C67) return { objects: [], warnings: ['Not a GLB file.'] };
    var length = dv.getUint32(8, true);
    var off = 12;
    var json = null, bin = null;
    while (off + 8 <= Math.min(length, buffer.byteLength)) {
      var chunkLen = dv.getUint32(off, true);
      var chunkType = dv.getUint32(off + 4, true);
      var start = off + 8;
      if (chunkType === 0x4E4F534A) json = JSON.parse(decode(new Uint8Array(buffer, start, chunkLen)));
      else if (chunkType === 0x004E4942) bin = buffer.slice(start, start + chunkLen);
      off = start + chunkLen + (chunkLen % 4 ? 4 - (chunkLen % 4) : 0);
    }
    if (!json) return { objects: [], warnings: ['GLB has no JSON chunk.'] };
    return IO.parseGLTF(json, bin ? [bin] : []);
  };

  /** Shared by .gltf and .glb. `extraBuffers[0]` is the GLB binary chunk. */
  IO.parseGLTF = function (json, extraBuffers) {
    var warnings = [];
    var buffers = [];
    var i;
    for (i = 0; i < (json.buffers || []).length; i++) {
      var b = json.buffers[i];
      if (b.uri === undefined) {
        buffers[i] = extraBuffers[0] || null;
      } else if (/^data:/.test(b.uri)) {
        var comma = b.uri.indexOf(',');
        var b64 = b.uri.slice(comma + 1);
        var binStr = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
        var arr = new Uint8Array(binStr.length);
        for (var c = 0; c < binStr.length; c++) arr[c] = binStr.charCodeAt(c);
        buffers[i] = arr.buffer;
      } else {
        buffers[i] = null;
        warnings.push('glTF references the external file "' + b.uri + '", which is not available. Use a .glb for a single self-contained file.');
      }
    }

    var objects = [];
    var M4 = S.M4;

    function emitMesh(meshIndex, matrix, nodeName) {
      var mesh = json.meshes[meshIndex];
      if (!mesh) return;
      for (var pi = 0; pi < mesh.primitives.length; pi++) {
        var prim = mesh.primitives[pi];
        if (prim.mode !== undefined && prim.mode !== 4) {
          warnings.push('Skipped a primitive that is not a triangle list.');
          continue;
        }
        var posIdx = prim.attributes && prim.attributes.POSITION;
        if (posIdx === undefined) continue;
        var positions = readAccessor(json, buffers, posIdx);
        if (!positions) continue;
        var n = positions.length / 3;
        var normals = prim.attributes.NORMAL !== undefined ? readAccessor(json, buffers, prim.attributes.NORMAL) : null;
        var rawColors = prim.attributes.COLOR_0 !== undefined ? readAccessor(json, buffers, prim.attributes.COLOR_0) : null;
        var colors = null;
        if (rawColors) {
          var per = rawColors.length / n;
          colors = new Float32Array(n * 3);
          for (var v = 0; v < n; v++) {
            colors[v * 3] = rawColors[v * per];
            colors[v * 3 + 1] = rawColors[v * per + 1];
            colors[v * 3 + 2] = rawColors[v * per + 2];
          }
        } else if (prim.material !== undefined && json.materials && json.materials[prim.material]) {
          var mat = json.materials[prim.material];
          var pbr = mat.pbrMetallicRoughness;
          if (pbr && pbr.baseColorFactor) {
            colors = new Float32Array(n * 3);
            for (var v2 = 0; v2 < n; v2++) {
              colors[v2 * 3] = pbr.baseColorFactor[0];
              colors[v2 * 3 + 1] = pbr.baseColorFactor[1];
              colors[v2 * 3 + 2] = pbr.baseColorFactor[2];
            }
          }
        }

        var indices;
        if (prim.indices !== undefined) {
          var raw = readAccessor(json, buffers, prim.indices);
          indices = new Uint32Array(raw.length);
          for (var k = 0; k < raw.length; k++) indices[k] = raw[k];
        } else {
          indices = new Uint32Array(n);
          for (var k2 = 0; k2 < n; k2++) indices[k2] = k2;
        }

        // bake the node transform into the vertices
        if (matrix) {
          var tmp = [0, 0, 0];
          for (var v3 = 0; v3 < n; v3++) {
            var o = v3 * 3;
            var x = positions[o], y = positions[o + 1], z = positions[o + 2];
            var w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
            w = w || 1;
            positions[o] = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w;
            positions[o + 1] = (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w;
            positions[o + 2] = (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w;
          }
          normals = null;   // recomputed after import anyway
        }

        objects.push({
          name: nodeName || mesh.name || ('gltf_mesh_' + meshIndex),
          positions: positions, normals: normals, colors: colors, indices: indices
        });
      }
    }

    function walk(nodeIndex, parentMatrix) {
      var node = json.nodes[nodeIndex];
      if (!node) return;
      var local = nodeMatrix(node);
      var world = parentMatrix ? M4.multiply(M4.create(), parentMatrix, local) : local;
      if (node.mesh !== undefined) emitMesh(node.mesh, world, node.name);
      var kids = node.children || [];
      for (var i2 = 0; i2 < kids.length; i2++) walk(kids[i2], world);
    }

    var sceneIdx = json.scene === undefined ? 0 : json.scene;
    var scene = (json.scenes || [])[sceneIdx];
    if (scene && scene.nodes) {
      for (i = 0; i < scene.nodes.length; i++) walk(scene.nodes[i], null);
    } else if (json.meshes) {
      for (i = 0; i < json.meshes.length; i++) emitMesh(i, null, null);
    }
    if (!objects.length) warnings.push('No triangle meshes found in the glTF.');
    return { objects: objects, warnings: warnings };
  };

  function pad4(n) { return (n + 3) & ~3; }

  /**
   * Write a valid glTF 2.0 binary file. One node and mesh per object, with
   * positions, normals, optional vertex colours and a simple PBR material.
   */
  IO.exportGLB = function (geoms, opts) {
    opts = opts || {};
    var withColors = !!opts.includeColors;
    var json = {
      asset: { version: '2.0', generator: 'SculptFree ' + S.VERSION },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: []
    };
    var textureIndex = {};              // png byte length + name -> texture id

    // lay out the binary blob first so byte offsets are known
    var chunks = [];
    var byteLength = 0;
    function addView(typedArray, target) {
      var offset = pad4(byteLength);
      var padBytes = offset - byteLength;
      if (padBytes) chunks.push(new Uint8Array(padBytes));
      chunks.push(new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength));
      byteLength = offset + typedArray.byteLength;
      var view = { buffer: 0, byteOffset: offset, byteLength: typedArray.byteLength };
      if (target) view.target = target;
      json.bufferViews.push(view);
      return json.bufferViews.length - 1;
    }

    for (var i = 0; i < geoms.length; i++) {
      var g = geoms[i];
      var n = g.vertCount;

      var minX = Infinity, minY = Infinity, minZ = Infinity;
      var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (var v = 0; v < n; v++) {
        var o = v * 3, x = g.positions[o], y = g.positions[o + 1], z = g.positions[o + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }

      var posView = addView(g.positions, 34962);
      json.accessors.push({ bufferView: posView, componentType: 5126, count: n, type: 'VEC3',
                            min: [minX, minY, minZ], max: [maxX, maxY, maxZ] });
      var posAcc = json.accessors.length - 1;

      var norView = addView(g.normals, 34962);
      json.accessors.push({ bufferView: norView, componentType: 5126, count: n, type: 'VEC3' });
      var norAcc = json.accessors.length - 1;

      /*
       * Texture coordinates. glTF's v axis runs down from the top-left while
       * ours runs up from the bottom-left (the OBJ convention), so flip it
       * here rather than keeping two sets of coordinates around.
       */
      var uvAcc = -1;
      if (g.uvs) {
        var flipped = new Float32Array(n * 2);
        for (var u = 0; u < n; u++) {
          flipped[u * 2] = g.uvs[u * 2];
          flipped[u * 2 + 1] = 1 - g.uvs[u * 2 + 1];
        }
        var uvView = addView(flipped, 34962);
        json.accessors.push({ bufferView: uvView, componentType: 5126, count: n, type: 'VEC2' });
        uvAcc = json.accessors.length - 1;
      }

      /* the baked image, embedded in the same binary chunk */
      var texAcc = -1;
      if (g.texturePNG && uvAcc >= 0) {
        var key = g.name + ':' + g.texturePNG.length;
        if (textureIndex[key] === undefined) {
          var imgView = addView(g.texturePNG, 0);
          if (!json.images) { json.images = []; json.samplers = []; json.textures = []; }
          json.images.push({ name: (g.name || 'texture') + '_colour', bufferView: imgView, mimeType: 'image/png' });
          json.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 });
          json.textures.push({ source: json.images.length - 1, sampler: json.samplers.length - 1 });
          textureIndex[key] = json.textures.length - 1;
        }
        texAcc = textureIndex[key];
      }

      var colAcc = -1;
      if (withColors && g.colors && texAcc < 0) {
        // VEC4 with opaque alpha is the most widely supported colour layout
        var rgba = new Float32Array(n * 4);
        for (var v2 = 0; v2 < n; v2++) {
          rgba[v2 * 4] = g.colors[v2 * 3];
          rgba[v2 * 4 + 1] = g.colors[v2 * 3 + 1];
          rgba[v2 * 4 + 2] = g.colors[v2 * 3 + 2];
          rgba[v2 * 4 + 3] = 1;
        }
        var colView = addView(rgba, 34962);
        json.accessors.push({ bufferView: colView, componentType: 5126, count: n, type: 'VEC4' });
        colAcc = json.accessors.length - 1;
      }

      var idx = n > 65535 ? new Uint32Array(g.indices) : new Uint16Array(g.indices);
      var idxView = addView(idx, 34963);
      json.accessors.push({ bufferView: idxView, componentType: n > 65535 ? 5125 : 5123,
                            count: idx.length, type: 'SCALAR' });
      var idxAcc = json.accessors.length - 1;

      var base = g.color || [0.85, 0.85, 0.85];
      var pbr = {
        baseColorFactor: (texAcc >= 0 || (withColors && g.colors)) ? [1, 1, 1, 1] : [base[0], base[1], base[2], 1],
        metallicFactor: opts.metallic === undefined ? 0 : opts.metallic,
        roughnessFactor: opts.roughness === undefined ? 0.65 : opts.roughness
      };
      if (texAcc >= 0) pbr.baseColorTexture = { index: texAcc, texCoord: 0 };
      json.materials.push({
        name: g.name + '_material',
        pbrMetallicRoughness: pbr,
        doubleSided: true
      });
      var matIdx = json.materials.length - 1;

      var attributes = { POSITION: posAcc, NORMAL: norAcc };
      if (uvAcc >= 0) attributes.TEXCOORD_0 = uvAcc;
      if (colAcc >= 0) attributes.COLOR_0 = colAcc;
      json.meshes.push({ name: g.name, primitives: [{ attributes: attributes, indices: idxAcc, material: matIdx, mode: 4 }] });
      json.nodes.push({ name: g.name, mesh: json.meshes.length - 1 });
      json.scenes[0].nodes.push(json.nodes.length - 1);
    }

    json.buffers.push({ byteLength: byteLength });

    var jsonBytes = encodeUtf8(JSON.stringify(json));
    var jsonPadded = pad4(jsonBytes.length);
    var binPadded = pad4(byteLength);
    var total = 12 + 8 + jsonPadded + 8 + binPadded;
    var out = new ArrayBuffer(total);
    var u8 = new Uint8Array(out);
    var dv = new DataView(out);
    dv.setUint32(0, 0x46546C67, true);      // 'glTF'
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, jsonPadded, true);
    dv.setUint32(16, 0x4E4F534A, true);     // 'JSON'
    u8.set(jsonBytes, 20);
    for (var sp = 20 + jsonBytes.length; sp < 20 + jsonPadded; sp++) u8[sp] = 0x20;
    var binStart = 20 + jsonPadded;
    dv.setUint32(binStart, binPadded, true);
    dv.setUint32(binStart + 4, 0x004E4942, true);   // 'BIN'
    var w = binStart + 8;
    for (var ci = 0; ci < chunks.length; ci++) {
      u8.set(chunks[ci], w);
      w += chunks[ci].length;
    }
    return out;
  };

  /* ================================================================ *
   * .sculpt project container
   *
   *   magic "SCULPTF1" | uint32 json length | json | raw buffers
   *
   * Keeps exact topology, masks, colours, per-object transforms, the camera
   * and the tool settings, so a session can be resumed bit for bit.
   * ================================================================ */

  var PROJECT_MAGIC = 'SCULPTF1';

  IO.saveProject = function (state) {
    var buffers = [];
    var byteLength = 0;
    function add(typed) {
      var entry = { offset: byteLength, length: typed.byteLength, dtype: typed.constructor.name };
      buffers.push(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
      byteLength += typed.byteLength;
      // keep 4-byte alignment for the readers
      var padBytes = pad4(byteLength) - byteLength;
      if (padBytes) { buffers.push(new Uint8Array(padBytes)); byteLength += padBytes; }
      return entry;
    }

    var objects = [];
    for (var i = 0; i < state.objects.length; i++) {
      var obj = state.objects[i];
      var d = obj.mesh.toIndexed();
      var masks = new Float32Array(d.vertCount);
      // toIndexed drops dead slots, so re-collect masks in the same order
      var w = 0;
      for (var v = 0; v < obj.mesh.masks.length; v++) {
        if (obj.mesh.vertDead.array[v]) continue;
        masks[w++] = obj.mesh.masks.array[v];
      }
      var entry = {
        name: obj.name,
        visible: obj.visible !== false,
        position: Array.from(obj.position),
        rotation: Array.from(obj.rotation),
        scale: Array.from(obj.scale),
        baseColor: obj.baseColor ? Array.from(obj.baseColor) : [0.85, 0.85, 0.85],
        vertCount: d.vertCount,
        triCount: d.triCount,
        positions: add(d.positions),
        colors: add(d.colors),
        masks: add(masks),
        indices: add(d.indices32)
      };
      /*
       * The paint image, run-length encoded. A project has to come back with
       * its paint on it, and the runs make that cheap: a map that has been
       * painted in one corner is mostly one colour, and even a busy one
       * compresses to a fraction of its four megabytes.
       */
      if (obj.paint) {
        entry.paint = {
          size: obj.paint.size,
          frame: { min: obj.paint.frame.min.slice(), max: obj.paint.frame.max.slice(),
                   span: obj.paint.frame.span },
          data: add(obj.paint.encode())
        };
      }
      objects.push(entry);
    }

    var meta = {
      app: 'SculptFree', version: S.VERSION, saved: new Date().toISOString(),
      objects: objects,
      selected: state.selected === undefined ? 0 : state.selected,
      camera: state.camera || null,
      settings: state.settings || null
    };
    var jsonBytes = encodeUtf8(JSON.stringify(meta));
    var headerLen = PROJECT_MAGIC.length + 4;
    var out = new ArrayBuffer(headerLen + jsonBytes.length + byteLength);
    var u8 = new Uint8Array(out);
    u8.set(encodeUtf8(PROJECT_MAGIC), 0);
    new DataView(out).setUint32(PROJECT_MAGIC.length, jsonBytes.length, true);
    u8.set(jsonBytes, headerLen);
    var off = headerLen + jsonBytes.length;
    for (var b = 0; b < buffers.length; b++) { u8.set(buffers[b], off); off += buffers[b].length; }
    return out;
  };

  IO.loadProject = function (buffer) {
    var u8 = new Uint8Array(buffer);
    if (decode(u8.subarray(0, 8)) !== PROJECT_MAGIC) {
      return { ok: false, reason: 'Not a SculptFree project file.' };
    }
    var jsonLen = new DataView(buffer).getUint32(8, true);
    var meta = JSON.parse(decode(u8.subarray(12, 12 + jsonLen)));
    var dataStart = 12 + jsonLen;
    function grab(entry, Ctor) {
      var bytes = u8.subarray(dataStart + entry.offset, dataStart + entry.offset + entry.length);
      // copy so the result is aligned and independent of the source buffer
      var copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      return new Ctor(copy.buffer, 0, entry.length / Ctor.BYTES_PER_ELEMENT);
    }
    var objects = [];
    for (var i = 0; i < meta.objects.length; i++) {
      var o = meta.objects[i];
      var loaded = {
        name: o.name,
        visible: o.visible,
        position: o.position, rotation: o.rotation, scale: o.scale,
        baseColor: o.baseColor,
        positions: grab(o.positions, Float32Array),
        colors: grab(o.colors, Float32Array),
        masks: grab(o.masks, Float32Array),
        indices: grab(o.indices, Uint32Array)
      };
      if (o.paint && o.paint.data) {
        var map = new S.PaintMap(o.paint.size, o.paint.frame);
        S.PaintMap.decodeInto(map, grab(o.paint.data, Uint8Array));
        loaded.paint = map;
      }
      objects.push(loaded);
    }
    return { ok: true, objects: objects, camera: meta.camera, settings: meta.settings,
             selected: meta.selected, version: meta.version, saved: meta.saved };
  };

  /* ================================================================ *
   * dispatch
   * ================================================================ */

  IO.FORMATS = {
    obj: { label: 'OBJ (Wavefront)', ext: 'obj', binary: false, colors: true, note: 'Universal. Vertex colours as a widely-read extension.' },
    stl: { label: 'STL', ext: 'stl', binary: true, colors: true, note: 'For 3D printing. No proper colour support.' },
    ply: { label: 'PLY (Stanford)', ext: 'ply', binary: true, colors: true, note: 'Best for vertex colours.' },
    glb: { label: 'GLB (glTF 2.0)', ext: 'glb', binary: true, colors: true, note: 'For game engines: Three.js, Unity, Godot, Unreal.' },
    sculpt: { label: 'SculptFree project', ext: 'sculpt', binary: true, colors: true, note: 'Everything, including masks and camera.' }
  };

  IO.importBuffer = function (filename, buffer) {
    var ext = IO.extensionOf(filename);
    try {
      switch (ext) {
        case 'obj': return IO.parseOBJ(decode(buffer));
        case 'stl': return IO.parseSTL(buffer);
        case 'ply': return IO.parsePLY(buffer);
        case 'glb': return IO.parseGLB(buffer);
        case 'gltf': return IO.parseGLTF(JSON.parse(decode(buffer)), []);
        case 'sculpt': {
          var pr = IO.loadProject(buffer);
          if (!pr.ok) return { objects: [], warnings: [pr.reason] };
          return { project: pr, objects: pr.objects, warnings: [] };
        }
        default: {
          // sniff: GLB magic, PLY/OBJ/STL text
          var head = decode(new Uint8Array(buffer, 0, Math.min(64, buffer.byteLength)));
          if (head.slice(0, 4) === 'glTF') return IO.parseGLB(buffer);
          if (head.slice(0, 3) === 'ply') return IO.parsePLY(buffer);
          if (head.slice(0, 8) === PROJECT_MAGIC) {
            var pr2 = IO.loadProject(buffer);
            return pr2.ok ? { project: pr2, objects: pr2.objects, warnings: [] } : { objects: [], warnings: [pr2.reason] };
          }
          if (/^\s*(v|vn|vt|f|o|g|mtllib|usemtl)\s/m.test(head)) return IO.parseOBJ(decode(buffer));
          return IO.parseSTL(buffer);
        }
      }
    } catch (err) {
      return { objects: [], warnings: ['Could not read "' + filename + '": ' + (err && err.message || err)] };
    }
  };

  /**
   * Export with a baked texture.
   *
   * The paint lives on the mesh, so it has to become an image before another
   * program can see it: every object is unwrapped by box projection, its
   * colour is rasterised into an atlas, and the result is written as a real
   * PNG. OBJ gets a .mtl and the image beside it (which is exactly what
   * Roblox Studio wants: upload the mesh, upload the image, set it as the
   * TextureID); GLB carries the image inside the one file.
   *
   * opts adds: { textureSize, cavity, baseName }
   */
  IO.exportTextured = function (format, geoms, opts) {
    opts = opts || {};
    var size = opts.textureSize || 1024;
    var baseName = (opts.baseName || 'sculpt').replace(/\.[a-z0-9]+$/i, '');
    var files = [];
    var textured = [];
    var totalPixels = 0;
    for (var i = 0; i < geoms.length; i++) {
      var built = S.Texture.build(geoms[i], { size: size, cavity: opts.cavity || 0 });
      var g = built.geom;
      g.color = geoms[i].color;
      var png = built.png();
      totalPixels += built.coverage;
      var suffix = geoms.length > 1
        ? '_' + String(geoms[i].name || ('object_' + (i + 1))).replace(/\s+/g, '_')
        : '';
      var pngName = baseName + suffix + '.png';
      if (format === 'glb') {
        g.texturePNG = png;
      } else {
        g.textureName = pngName;
        files.push({ name: pngName, data: png, mime: 'image/png' });
      }
      textured.push(g);
    }
    if (format === 'glb') {
      files.push({ name: baseName + '.glb', data: IO.exportGLB(textured, opts), mime: 'model/gltf-binary' });
    } else {
      var objOpts = {};
      for (var k in opts) objOpts[k] = opts[k];
      objOpts.mtlName = baseName + '.mtl';
      files.unshift({ name: objOpts.mtlName, data: IO.exportMTL(textured, opts), mime: 'text/plain' });
      files.unshift({ name: baseName + '.obj', data: IO.exportOBJ(textured, objOpts), mime: 'text/plain' });
    }
    return {
      files: files,
      geoms: textured,
      coverage: geoms.length ? totalPixels / geoms.length : 0
    };
  };

  IO.exportGeoms = function (format, geoms, opts) {
    switch (format) {
      case 'obj': return { data: IO.exportOBJ(geoms, opts), mime: 'text/plain', ext: 'obj' };
      case 'stl': return { data: IO.exportSTL(geoms, opts), mime: 'model/stl', ext: 'stl' };
      case 'ply': return { data: IO.exportPLY(geoms, opts), mime: 'application/octet-stream', ext: 'ply' };
      case 'glb': return { data: IO.exportGLB(geoms, opts), mime: 'model/gltf-binary', ext: 'glb' };
      default: throw new Error('Unknown export format: ' + format);
    }
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
