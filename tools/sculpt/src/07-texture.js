/*
 * SculptFree — texturing: an unwrap, a bake, and a PNG writer.
 *
 * A game engine wants a low-poly mesh with a texture on it, not a million
 * coloured vertices. So painting happens on the mesh (fast, no seams, no
 * unwrap to think about) and this module turns the result into a real image:
 *
 *   unwrap()  box projection — every triangle goes to whichever of the six
 *             axis directions it faces, and the six charts are packed into
 *             one atlas. Vertices shared between charts are duplicated.
 *   cavity()  a per-vertex crease term, so the bake can darken the recesses
 *             the way the viewport does.
 *   bake()    rasterises the painted colour into the atlas, then grows the
 *             covered pixels outwards so filtering never pulls in the gaps.
 *   encodePNG() writes a real, compressed PNG — deflate and all — because a
 *             single HTML file cannot lean on a library, and Node has to be
 *             able to read back what the browser wrote.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var Tex = S.Texture = {};

  /* ================================================================ *
   * checksums
   * ================================================================ */

  var CRC = null;
  function crcTable() {
    if (CRC) return CRC;
    CRC = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC[n] = c;
    }
    return CRC;
  }

  function crc32(bytes, from, to) {
    var t = crcTable();
    var c = -1;
    for (var i = from; i < to; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function adler32(bytes) {
    var a = 1, b = 0;
    // 5552 is the largest block that cannot overflow the accumulators
    for (var i = 0; i < bytes.length;) {
      var end = Math.min(i + 5552, bytes.length);
      for (; i < end; i++) { a += bytes[i]; b += a; }
      a %= 65521; b %= 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  /* ================================================================ *
   * deflate — LZ77 with the fixed Huffman tables
   *
   * Fixed tables mean no tree to build or transmit, which keeps this short,
   * and the match finder still does the real work: a texture full of flat
   * runs compresses to a few percent of its size.
   * ================================================================ */

  function BitWriter(hint) {
    this.bytes = new Uint8Array(Math.max(1024, hint | 0));
    this.len = 0;
    this.acc = 0;                       // pending bits, low end first
    this.nbits = 0;
  }

  BitWriter.prototype.room = function (extra) {
    if (this.len + extra <= this.bytes.length) return;
    var cap = this.bytes.length * 2;
    while (cap < this.len + extra) cap *= 2;
    var next = new Uint8Array(cap);
    next.set(this.bytes.subarray(0, this.len));
    this.bytes = next;
  };

  /** Write `count` bits of `value`, least significant first. count <= 16. */
  BitWriter.prototype.put = function (value, count) {
    this.acc |= (value & ((1 << count) - 1)) << this.nbits;
    this.nbits += count;
    if (this.nbits >= 8) {
      this.room(4);
      while (this.nbits >= 8) {
        this.bytes[this.len++] = this.acc & 0xFF;
        this.acc >>>= 8;
        this.nbits -= 8;
      }
    }
  };

  BitWriter.prototype.finish = function () {
    if (this.nbits) {
      this.room(1);
      this.bytes[this.len++] = this.acc & 0xFF;
      this.acc = 0; this.nbits = 0;
    }
    return this.bytes.subarray(0, this.len);
  };

  function reverse(code, bits) {
    var r = 0;
    for (var i = 0; i < bits; i++) r |= ((code >>> i) & 1) << (bits - 1 - i);
    return r;
  }

  /*
   * Huffman codes travel most-significant bit first, everything else travels
   * least-significant first. Pre-reversing every code lets the writer stay
   * one-directional.
   */
  var LIT_REV = new Uint16Array(288), LIT_BITS = new Uint8Array(288);
  (function () {
    var i;
    for (i = 0; i <= 143; i++) { LIT_REV[i] = reverse(0x30 + i, 8); LIT_BITS[i] = 8; }
    for (i = 144; i <= 255; i++) { LIT_REV[i] = reverse(0x190 + i - 144, 9); LIT_BITS[i] = 9; }
    for (i = 256; i <= 279; i++) { LIT_REV[i] = reverse(i - 256, 7); LIT_BITS[i] = 7; }
    for (i = 280; i <= 287; i++) { LIT_REV[i] = reverse(0xC0 + i - 280, 8); LIT_BITS[i] = 8; }
  })();

  var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
                  67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
                   4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513,
                   769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8,
                    9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

  /* length 3..258 -> its code index, built once */
  var LEN_CODE = new Uint8Array(259);
  (function () {
    var c = 0;
    for (var l = 3; l <= 258; l++) {
      while (c < 28 && LEN_BASE[c + 1] <= l) c++;
      LEN_CODE[l] = c;
    }
  })();

  function distCode(d) {
    var c = 0;
    while (c < 29 && DIST_BASE[c + 1] <= d) c++;
    return c;
  }

  var MIN_MATCH = 3, MAX_MATCH = 258, WINDOW = 32768, CHAIN = 32;

  /** Raw deflate stream (one final block, fixed Huffman). */
  function deflateRaw(src) {
    var n = src.length;
    var bw = new BitWriter(Math.max(1024, n >> 2));
    bw.put(1, 1);                       // BFINAL
    bw.put(1, 2);                       // BTYPE = fixed Huffman

    var HBITS = 15, HSIZE = 1 << HBITS, HMASK = HSIZE - 1;
    var head = new Int32Array(HSIZE).fill(-1);
    var prev = n ? new Int32Array(n).fill(-1) : new Int32Array(0);

    function hash(i) { return (((src[i] << 10) ^ (src[i + 1] << 5) ^ src[i + 2]) >>> 0) & HMASK; }
    function insert(i) { var h = hash(i); prev[i] = head[h]; head[h] = i; }

    var pos = 0;
    while (pos < n) {
      var bestLen = 0, bestDist = 0;
      if (pos + MIN_MATCH <= n) {
        var cand = head[hash(pos)];
        var chain = 0;
        var limit = Math.min(MAX_MATCH, n - pos);
        while (cand >= 0 && chain++ < CHAIN) {
          var dist = pos - cand;
          if (dist > WINDOW) break;
          // a cheap reject: the byte that would extend the current best
          if (src[cand + bestLen] === src[pos + bestLen]) {
            var len = 0;
            while (len < limit && src[cand + len] === src[pos + len]) len++;
            if (len > bestLen) {
              bestLen = len; bestDist = dist;
              if (len >= 128) break;    // long enough; stop hunting
            }
          }
          cand = prev[cand];
        }
        insert(pos);
      }
      if (bestLen >= MIN_MATCH) {
        var lc = LEN_CODE[bestLen];
        bw.put(LIT_REV[257 + lc], LIT_BITS[257 + lc]);
        if (LEN_EXTRA[lc]) bw.put(bestLen - LEN_BASE[lc], LEN_EXTRA[lc]);
        var dc = distCode(bestDist);
        bw.put(reverse(dc, 5), 5);
        if (DIST_EXTRA[dc]) bw.put(bestDist - DIST_BASE[dc], DIST_EXTRA[dc]);
        // keep the index honest across the bytes the match covered
        for (var k = 1; k < bestLen; k++) {
          var p = pos + k;
          if (p + MIN_MATCH <= n) insert(p);
        }
        pos += bestLen;
      } else {
        bw.put(LIT_REV[src[pos]], LIT_BITS[src[pos]]);
        pos++;
      }
    }
    bw.put(LIT_REV[256], LIT_BITS[256]);   // end of block
    return bw.finish();
  }

  Tex.deflate = function (bytes) { return deflateRaw(bytes); };

  /** zlib container: two header bytes, the deflate stream, then adler32. */
  Tex.zlib = function (bytes) {
    var body = deflateRaw(bytes);
    var out = new Uint8Array(body.length + 6);
    out[0] = 0x78; out[1] = 0x01;       // deflate, 32K window, no preset dict
    out.set(body, 2);
    var sum = adler32(bytes);
    var o = body.length + 2;
    out[o] = (sum >>> 24) & 0xFF; out[o + 1] = (sum >>> 16) & 0xFF;
    out[o + 2] = (sum >>> 8) & 0xFF; out[o + 3] = sum & 0xFF;
    return out;
  };

  /* ================================================================ *
   * PNG
   * ================================================================ */

  function paeth(a, b, c) {
    var p = a + b - c;
    var pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  }

  /**
   * Filter one row with each candidate and keep the cheapest, which is what
   * every real encoder does and costs nothing here.
   */
  function filterRows(pixels, width, height, channels) {
    var stride = width * channels;
    var out = new Uint8Array((stride + 1) * height);
    var cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
    var types = [0, 1, 2, 4];
    for (var y = 0; y < height; y++) {
      var row = y * stride, up = row - stride;
      var best = 0, bestCost = Infinity;
      for (var c = 0; c < types.length; c++) {
        var buf = cand[c], cost = 0;
        for (var x = 0; x < stride; x++) {
          var raw = pixels[row + x];
          var left = x >= channels ? pixels[row + x - channels] : 0;
          var above = y > 0 ? pixels[up + x] : 0;
          var corner = (y > 0 && x >= channels) ? pixels[up + x - channels] : 0;
          var v;
          switch (types[c]) {
            case 1: v = (raw - left) & 0xFF; break;
            case 2: v = (raw - above) & 0xFF; break;
            case 4: v = (raw - paeth(left, above, corner)) & 0xFF; break;
            default: v = raw;
          }
          buf[x] = v;
          cost += v < 128 ? v : 256 - v;
        }
        if (cost < bestCost) { bestCost = cost; best = c; }
      }
      out[y * (stride + 1)] = types[best];
      out.set(cand[best], y * (stride + 1) + 1);
    }
    return out;
  }

  function chunk(parts, type, data) {
    var head = new Uint8Array(8);
    var len = data.length;
    head[0] = (len >>> 24) & 0xFF; head[1] = (len >>> 16) & 0xFF;
    head[2] = (len >>> 8) & 0xFF; head[3] = len & 0xFF;
    for (var i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i);
    var body = new Uint8Array(4 + len);
    body.set(head.subarray(4, 8), 0);
    body.set(data, 4);
    var c = crc32(body, 0, body.length);
    var tail = new Uint8Array(4);
    tail[0] = (c >>> 24) & 0xFF; tail[1] = (c >>> 16) & 0xFF;
    tail[2] = (c >>> 8) & 0xFF; tail[3] = c & 0xFF;
    parts.push(head, data, tail);
  }

  /**
   * Write an 8-bit PNG. `pixels` is RGBA; a fully opaque image is written as
   * RGB, which is a quarter smaller and is what a game engine wants anyway.
   */
  Tex.encodePNG = function (pixels, width, height, opts) {
    opts = opts || {};
    var i, opaque = opts.rgb !== false;
    if (opaque && opts.rgb === undefined) {
      for (i = 3; i < pixels.length; i += 4) { if (pixels[i] !== 255) { opaque = false; break; } }
    }
    var channels = opaque ? 3 : 4;
    var data = pixels;
    if (channels === 3) {
      data = new Uint8Array(width * height * 3);
      for (i = 0; i < width * height; i++) {
        data[i * 3] = pixels[i * 4];
        data[i * 3 + 1] = pixels[i * 4 + 1];
        data[i * 3 + 2] = pixels[i * 4 + 2];
      }
    }
    var raw = filterRows(data, width, height, channels);
    var idat = Tex.zlib(raw);

    var ihdr = new Uint8Array(13);
    ihdr[0] = (width >>> 24) & 0xFF; ihdr[1] = (width >>> 16) & 0xFF;
    ihdr[2] = (width >>> 8) & 0xFF; ihdr[3] = width & 0xFF;
    ihdr[4] = (height >>> 24) & 0xFF; ihdr[5] = (height >>> 16) & 0xFF;
    ihdr[6] = (height >>> 8) & 0xFF; ihdr[7] = height & 0xFF;
    ihdr[8] = 8;                        // bit depth
    ihdr[9] = channels === 3 ? 2 : 6;   // colour type: truecolour, +alpha
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

    var parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
    chunk(parts, 'IHDR', ihdr);
    chunk(parts, 'IDAT', idat);
    chunk(parts, 'IEND', new Uint8Array(0));

    var total = 0;
    for (i = 0; i < parts.length; i++) total += parts[i].length;
    var out = new Uint8Array(total);
    var at = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], at); at += parts[i].length; }
    return out;
  };

  /* ================================================================ *
   * box-projection unwrap
   * ================================================================ */

  /* the six charts, laid out 3 across and 2 down */
  Tex.AXES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

  function axisOf(nx, ny, nz) {
    var ax = nx < 0 ? -nx : nx, ay = ny < 0 ? -ny : ny, az = nz < 0 ? -nz : nz;
    if (ax >= ay && ax >= az) return nx >= 0 ? 0 : 1;
    if (ay >= az) return ny >= 0 ? 2 : 3;
    return nz >= 0 ? 4 : 5;
  }
  Tex.axisOf = axisOf;

  /* project a point into a chart's 2D frame */
  function project(axis, x, y, z, out) {
    switch (axis) {
      case 0: out[0] = -z; out[1] = y; break;
      case 1: out[0] = z; out[1] = y; break;
      case 2: out[0] = x; out[1] = -z; break;
      case 3: out[0] = x; out[1] = z; break;
      case 4: out[0] = x; out[1] = y; break;
      default: out[0] = -x; out[1] = y; break;
    }
  }
  Tex.project = project;

  /**
   * Give a geometry UVs by box projection.
   *
   * Every triangle joins the chart its face normal points at, so a vertex on
   * the boundary between two charts has to exist twice — the returned
   * geometry has the same triangles but more vertices, each with one UV, so
   * it drops straight into OBJ, glTF or a GPU buffer.
   *
   * opts: { margin } — texels of gutter between charts, in a `size` atlas.
   */
  Tex.unwrap = function (geom, opts) {
    opts = opts || {};
    var size = opts.size || 1024;
    var margin = opts.margin === undefined ? 4 : opts.margin;
    var idx = geom.indices, pos = geom.positions;
    var triCount = idx.length / 3;

    /* 1. which chart each triangle belongs to */
    var faceAxis = new Uint8Array(triCount);
    for (var t = 0; t < triCount; t++) {
      var a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      var e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
      var e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
      var nx = e1y * e2z - e1z * e2y;
      var ny = e1z * e2x - e1x * e2z;
      var nz = e1x * e2y - e1y * e2x;
      if (nx === 0 && ny === 0 && nz === 0 && geom.normals) {
        // a degenerate triangle has no normal of its own; borrow a vertex's
        nx = geom.normals[a]; ny = geom.normals[a + 1]; nz = geom.normals[a + 2];
      }
      faceAxis[t] = axisOf(nx, ny, nz);
    }

    /* 2. split vertices so each copy belongs to one chart */
    var map = new Map();
    var newIdx = new Uint32Array(idx.length);
    var srcVert = [];                   // new vertex -> old vertex
    var vertAxis = [];
    for (var t2 = 0; t2 < triCount; t2++) {
      var ax = faceAxis[t2];
      for (var k = 0; k < 3; k++) {
        var v = idx[t2 * 3 + k];
        var key = v * 8 + ax;
        var to = map.get(key);
        if (to === undefined) {
          to = srcVert.length;
          map.set(key, to);
          srcVert.push(v);
          vertAxis.push(ax);
        }
        newIdx[t2 * 3 + k] = to;
      }
    }

    var n = srcVert.length;
    var outPos = new Float32Array(n * 3);
    var outNor = geom.normals ? new Float32Array(n * 3) : null;
    var outCol = geom.colors ? new Float32Array(n * 3) : null;
    var uvs = new Float32Array(n * 2);
    var flat = [0, 0];
    /* chart bounds in projected space */
    var lo = [], hi = [];
    for (var a2 = 0; a2 < 6; a2++) { lo.push([Infinity, Infinity]); hi.push([-Infinity, -Infinity]); }

    for (var i = 0; i < n; i++) {
      var s = srcVert[i] * 3, d = i * 3;
      outPos[d] = pos[s]; outPos[d + 1] = pos[s + 1]; outPos[d + 2] = pos[s + 2];
      if (outNor) { outNor[d] = geom.normals[s]; outNor[d + 1] = geom.normals[s + 1]; outNor[d + 2] = geom.normals[s + 2]; }
      if (outCol) { outCol[d] = geom.colors[s]; outCol[d + 1] = geom.colors[s + 1]; outCol[d + 2] = geom.colors[s + 2]; }
      var ax2 = vertAxis[i];
      project(ax2, pos[s], pos[s + 1], pos[s + 2], flat);
      uvs[i * 2] = flat[0]; uvs[i * 2 + 1] = flat[1];
      if (flat[0] < lo[ax2][0]) lo[ax2][0] = flat[0];
      if (flat[1] < lo[ax2][1]) lo[ax2][1] = flat[1];
      if (flat[0] > hi[ax2][0]) hi[ax2][0] = flat[0];
      if (flat[1] > hi[ax2][1]) hi[ax2][1] = flat[1];
    }

    /* 3. fit each chart into its cell, keeping the aspect ratio */
    var mu = margin / size;
    var cellW = 1 / 3, cellH = 1 / 2;
    var fit = [];
    for (var a3 = 0; a3 < 6; a3++) {
      var spanX = hi[a3][0] - lo[a3][0], spanY = hi[a3][1] - lo[a3][1];
      if (!isFinite(spanX)) { fit.push(null); continue; }
      spanX = Math.max(spanX, 1e-9); spanY = Math.max(spanY, 1e-9);
      var availW = cellW - 2 * mu, availH = cellH - 2 * mu;
      var scale = Math.min(availW / spanX, availH / spanY);
      var col = a3 % 3, rowIndex = Math.floor(a3 / 3);
      fit.push({
        scale: scale,
        u0: col * cellW + mu + (availW - spanX * scale) * 0.5 - lo[a3][0] * scale,
        v0: rowIndex * cellH + mu + (availH - spanY * scale) * 0.5 - lo[a3][1] * scale
      });
    }
    for (var j = 0; j < n; j++) {
      var f = fit[vertAxis[j]];
      if (!f) { uvs[j * 2] = 0; uvs[j * 2 + 1] = 0; continue; }
      uvs[j * 2] = uvs[j * 2] * f.scale + f.u0;
      uvs[j * 2 + 1] = uvs[j * 2 + 1] * f.scale + f.v0;
    }

    return {
      name: geom.name,
      positions: outPos,
      normals: outNor || new Float32Array(n * 3),
      colors: outCol,
      uvs: uvs,
      indices: newIdx,
      vertCount: n,
      triCount: triCount,
      color: geom.color,
      sourceVerts: srcVert,
      faceAxis: faceAxis
    };
  };

  /* ================================================================ *
   * crease term
   * ================================================================ */

  /**
   * A per-vertex 0..1 shade: 1 where the surface is flat or convex, lower in
   * the recesses. Measured as how far the one-ring sits above the tangent
   * plane, which is cheap, stable, and reads the way creases look on screen.
   */
  Tex.cavity = function (geom, strength) {
    var k = strength === undefined ? 1 : strength;
    var n = geom.vertCount, idx = geom.indices, pos = geom.positions, nor = geom.normals;
    var sum = new Float32Array(n), count = new Uint32Array(n);
    function pair(a, b) {
      var ao = a * 3, bo = b * 3;
      var dx = pos[bo] - pos[ao], dy = pos[bo + 1] - pos[ao + 1], dz = pos[bo + 2] - pos[ao + 2];
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-12) return;
      var d = (dx * nor[ao] + dy * nor[ao + 1] + dz * nor[ao + 2]) / len;
      sum[a] += d; count[a]++;
    }
    for (var t = 0; t < idx.length; t += 3) {
      var a = idx[t], b = idx[t + 1], c = idx[t + 2];
      pair(a, b); pair(b, a);
      pair(b, c); pair(c, b);
      pair(c, a); pair(a, c);
    }
    var out = new Float32Array(n);
    for (var v = 0; v < n; v++) {
      var mean = count[v] ? sum[v] / count[v] : 0;
      // positive mean: neighbours rise above the tangent plane, so it is a pit
      var occl = S.clamp(mean * 5.5, 0, 1) * k;
      out[v] = S.clamp(1 - occl * 0.75, 0, 1);
    }
    return out;
  };

  /* ================================================================ *
   * the bake
   * ================================================================ */

  /**
   * Rasterise vertex colour into the atlas. `geom` must carry uvs (so it has
   * been through unwrap). Anything not covered by a triangle is filled by
   * growing the covered pixels outwards, so a filtered texture never pulls
   * the background in across a seam.
   *
   * opts: { size, shade (per-vertex 0..1), background, dilate }
   */
  Tex.bake = function (geom, opts) {
    opts = opts || {};
    var size = opts.size || 1024;
    var W = size, H = size;
    var pixels = new Uint8Array(W * H * 4);
    var covered = new Uint8Array(W * H);
    var uvs = geom.uvs, idx = geom.indices, col = geom.colors;
    var shade = opts.shade || null;
    var base = opts.background || geom.color || [0.85, 0.85, 0.85];
    var i;

    function colorAt(v, out) {
      if (col) { out[0] = col[v * 3]; out[1] = col[v * 3 + 1]; out[2] = col[v * 3 + 2]; }
      else { out[0] = base[0]; out[1] = base[1]; out[2] = base[2]; }
      if (shade) { var s = shade[v]; out[0] *= s; out[1] *= s; out[2] *= s; }
    }

    var ca = [0, 0, 0], cb = [0, 0, 0], cc = [0, 0, 0];
    for (var t = 0; t < idx.length; t += 3) {
      var ia = idx[t], ib = idx[t + 1], ic = idx[t + 2];
      // UV origin is bottom-left (the OBJ convention); image rows run down
      var ax = uvs[ia * 2] * W - 0.5, ay = (1 - uvs[ia * 2 + 1]) * H - 0.5;
      var bx = uvs[ib * 2] * W - 0.5, by = (1 - uvs[ib * 2 + 1]) * H - 0.5;
      var cx = uvs[ic * 2] * W - 0.5, cy = (1 - uvs[ic * 2 + 1]) * H - 0.5;
      colorAt(ia, ca); colorAt(ib, cb); colorAt(ic, cc);

      var minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - 1);
      var maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)) + 1);
      var minY = Math.max(0, Math.floor(Math.min(ay, by, cy)) - 1);
      var maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)) + 1);
      var area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (area === 0) continue;
      var inv = 1 / area;
      var wrote = false;

      for (var y = minY; y <= maxY; y++) {
        for (var x = minX; x <= maxX; x++) {
          var px = x, py = y;
          var w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
          var w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
          var w2 = 1 - w0 - w1;
          // a sliver of slack, so neighbouring triangles leave no hairline
          if (w0 < -0.002 || w1 < -0.002 || w2 < -0.002) continue;
          var o = (y * W + x);
          var r = ca[0] * w0 + cb[0] * w1 + cc[0] * w2;
          var g = ca[1] * w0 + cb[1] * w1 + cc[1] * w2;
          var b = ca[2] * w0 + cb[2] * w1 + cc[2] * w2;
          pixels[o * 4] = Math.round(S.clamp(r, 0, 1) * 255);
          pixels[o * 4 + 1] = Math.round(S.clamp(g, 0, 1) * 255);
          pixels[o * 4 + 2] = Math.round(S.clamp(b, 0, 1) * 255);
          pixels[o * 4 + 3] = 255;
          covered[o] = 1;
          wrote = true;
        }
      }

      if (!wrote) {
        // a triangle smaller than a pixel still deserves one
        var mx = Math.round((ax + bx + cx) / 3), my = Math.round((ay + by + cy) / 3);
        if (mx >= 0 && my >= 0 && mx < W && my < H) {
          var mo = my * W + mx;
          pixels[mo * 4] = Math.round(S.clamp((ca[0] + cb[0] + cc[0]) / 3, 0, 1) * 255);
          pixels[mo * 4 + 1] = Math.round(S.clamp((ca[1] + cb[1] + cc[1]) / 3, 0, 1) * 255);
          pixels[mo * 4 + 2] = Math.round(S.clamp((ca[2] + cb[2] + cc[2]) / 3, 0, 1) * 255);
          pixels[mo * 4 + 3] = 255;
          covered[mo] = 1;
        }
      }
    }

    var filled = 0;
    for (i = 0; i < covered.length; i++) if (covered[i]) filled++;

    /* grow the covered area outwards to cover the gutter */
    var rounds = opts.dilate === undefined ? Math.max(2, Math.round(size / 128)) : opts.dilate;
    var work = covered;
    for (var pass = 0; pass < rounds; pass++) {
      var added = 0;
      var next = new Uint8Array(work);
      for (var yy = 0; yy < H; yy++) {
        for (var xx = 0; xx < W; xx++) {
          var o2 = yy * W + xx;
          if (work[o2]) continue;
          var sr = 0, sg = 0, sb = 0, cnt = 0;
          for (var dy = -1; dy <= 1; dy++) {
            var ny = yy + dy;
            if (ny < 0 || ny >= H) continue;
            for (var dx = -1; dx <= 1; dx++) {
              var nx = xx + dx;
              if (nx < 0 || nx >= W) continue;
              var no = ny * W + nx;
              if (!work[no]) continue;
              sr += pixels[no * 4]; sg += pixels[no * 4 + 1]; sb += pixels[no * 4 + 2];
              cnt++;
            }
          }
          if (!cnt) continue;
          pixels[o2 * 4] = Math.round(sr / cnt);
          pixels[o2 * 4 + 1] = Math.round(sg / cnt);
          pixels[o2 * 4 + 2] = Math.round(sb / cnt);
          pixels[o2 * 4 + 3] = 255;
          next[o2] = 1;
          added++;
        }
      }
      work = next;
      if (!added) break;
    }

    /* whatever is still empty gets the base colour, never black */
    var br = Math.round(S.clamp(base[0], 0, 1) * 255);
    var bg = Math.round(S.clamp(base[1], 0, 1) * 255);
    var bb = Math.round(S.clamp(base[2], 0, 1) * 255);
    for (i = 0; i < W * H; i++) {
      if (work[i]) continue;
      pixels[i * 4] = br; pixels[i * 4 + 1] = bg; pixels[i * 4 + 2] = bb; pixels[i * 4 + 3] = 255;
    }

    return { width: W, height: H, pixels: pixels, coverage: filled / (W * H) };
  };

  /**
   * Unwrap and bake in one go, and hand back everything an exporter needs.
   * opts: { size, cavity (0..1), margin }
   */
  Tex.build = function (geom, opts) {
    opts = opts || {};
    var size = opts.size || 1024;
    var uvGeom = Tex.unwrap(geom, { size: size, margin: opts.margin });
    var shade = null;
    if (opts.cavity) {
      var perSource = Tex.cavity(geom, opts.cavity);
      shade = new Float32Array(uvGeom.vertCount);
      for (var i = 0; i < uvGeom.vertCount; i++) shade[i] = perSource[uvGeom.sourceVerts[i]];
    }
    var baked = Tex.bake(uvGeom, { size: size, shade: shade, background: geom.color });
    return {
      geom: uvGeom,
      width: baked.width,
      height: baked.height,
      pixels: baked.pixels,
      coverage: baked.coverage,
      png: function () { return Tex.encodePNG(baked.pixels, baked.width, baked.height); }
    };
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
