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
    /*
     * A painted object's colour comes from its paint image rather than from
     * its vertices, read per texel exactly as the screen reads it. That is
     * the whole point of painting into an image: the exported texture is as
     * fine as the image, not as fine as the mesh.
     */
    var paint = opts.paint || geom.paint || null;
    var lpos = geom.localPositions, lnor = geom.localNormals;
    if (paint && (!lpos || !lnor)) paint = null;
    var paintRGB = [0, 0, 0];

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
          var r, g, b;
          if (paint) {
            var pa = ia * 3, pb = ib * 3, pc = ic * 3;
            paint.sample(
              lpos[pa] * w0 + lpos[pb] * w1 + lpos[pc] * w2,
              lpos[pa + 1] * w0 + lpos[pb + 1] * w1 + lpos[pc + 1] * w2,
              lpos[pa + 2] * w0 + lpos[pb + 2] * w1 + lpos[pc + 2] * w2,
              lnor[pa] * w0 + lnor[pb] * w1 + lnor[pc] * w2,
              lnor[pa + 1] * w0 + lnor[pb + 1] * w1 + lnor[pc + 1] * w2,
              lnor[pa + 2] * w0 + lnor[pb + 2] * w1 + lnor[pc + 2] * w2,
              paintRGB);
            r = paintRGB[0]; g = paintRGB[1]; b = paintRGB[2];
            if (shade) {
              var sh = shade[ia] * w0 + shade[ib] * w1 + shade[ic] * w2;
              r *= sh; g *= sh; b *= sh;
            }
          } else {
            r = ca[0] * w0 + cb[0] * w1 + cc[0] * w2;
            g = ca[1] * w0 + cb[1] * w1 + cc[1] * w2;
            b = ca[2] * w0 + cb[2] * w1 + cc[2] * w2;
          }
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
    /*
     * The unwrap splits vertices at the chart seams, so the object-space
     * copies have to be split the same way for the bake to read the paint
     * image at the right place.
     */
    if (geom.paint && geom.localPositions && geom.localNormals) {
      var n = uvGeom.vertCount, src = uvGeom.sourceVerts;
      var lp = new Float32Array(n * 3), ln = new Float32Array(n * 3);
      for (var v = 0; v < n; v++) {
        var from = src[v] * 3, to = v * 3;
        lp[to] = geom.localPositions[from];
        lp[to + 1] = geom.localPositions[from + 1];
        lp[to + 2] = geom.localPositions[from + 2];
        ln[to] = geom.localNormals[from];
        ln[to + 1] = geom.localNormals[from + 1];
        ln[to + 2] = geom.localNormals[from + 2];
      }
      uvGeom.paint = geom.paint;
      uvGeom.localPositions = lp;
      uvGeom.localNormals = ln;
    }
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

  /* ================================================================ *
   * the paint map: painting into an image instead of into vertices
   *
   * Painting by tinting vertices can only ever be as fine as the mesh. On a
   * 1,300-triangle ball that is about 650 places colour can live, so a dirt
   * stencil comes out as a handful of soft blotches — which is exactly what
   * it did, and why this exists. A paint map holds the colour in an image
   * of its own, so a stencil reads as a stencil, the detail survives
   * reducing the model for Roblox, and the image is the texture the model
   * exports with.
   *
   * The mapping from surface to image is a box: six charts in a 3x2 grid,
   * the same layout the export unwrap uses, indexed by which way the
   * surface faces. Reading it blends the three charts that face the same
   * way as the surface, weighted by how squarely they do, so there are no
   * seams where the charts meet — and because the mapping is a projection
   * rather than stored coordinates, it survives every topology change the
   * sculpting brushes make. Nothing to rebuild, nothing to go stale.
   * ================================================================ */

  var ATLAS_COLS = 3, ATLAS_ROWS = 2;
  var CHART_MARGIN = 0.03;            // of a cell, left empty so cells never bleed
  var BLEND_SHARP = 4;                // how tightly the charts blend by normal
  var TILE = 64;                      // undo granularity, in texels

  Tex.ATLAS_COLS = ATLAS_COLS;
  Tex.ATLAS_ROWS = ATLAS_ROWS;
  Tex.CHART_MARGIN = CHART_MARGIN;
  Tex.BLEND_SHARP = BLEND_SHARP;
  Tex.PAINT_TILE = TILE;
  Tex.axisOf = axisOf;
  Tex.projectFace = project;

  /**
   * A paint image for one object.
   *
   * `frame` fixes the projection: where the box sits and how big it is, in
   * the object's own space. It is captured once, when the map is made, so
   * the paint stays where it was put rather than sliding about as the model
   * is framed or moved.
   */
  function PaintMap(size, frame) {
    this.size = Math.max(64, size | 0);
    this.pixels = new Uint8Array(this.size * this.size * 4);
    this.frame = frame;
    this.version = 1;
    this.tiles = Math.ceil(this.size / TILE);
    this.dirtyX0 = 0; this.dirtyY0 = 0;
    this.dirtyX1 = this.size - 1; this.dirtyY1 = this.size - 1;
    /* per-face offsets, so a projected point maps into its own chart */
    this.off = new Float32Array(12);
    this._fitCharts();
  }
  S.PaintMap = PaintMap;
  Tex.PaintMap = PaintMap;

  /** The box a mesh needs, with a little room to grow into. */
  PaintMap.frameFor = function (mesh, headroom) {
    var mn = mesh.boundsMin(), mx = mesh.boundsMax();
    var grow = headroom === undefined ? 0.12 : headroom;
    var cx = (mn[0] + mx[0]) * 0.5, cy = (mn[1] + mx[1]) * 0.5, cz = (mn[2] + mx[2]) * 0.5;
    var span = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2], 1e-4) * (1 + grow);
    var half = span * 0.5;
    return {
      min: [cx - half, cy - half, cz - half],
      max: [cx + half, cy + half, cz + half],
      span: span
    };
  };

  /**
   * Work out where each chart sits inside its cell.
   *
   * Every chart is projected at the same scale, so a texel is the same size
   * on the surface whichever way it faces — paint does not get coarser round
   * the sides — and each chart is centred in its own cell.
   */
  PaintMap.prototype._fitCharts = function () {
    var f = this.frame;
    var inv = 1 / f.span;
    var lo = [0, 0], hi = [0, 0];
    for (var face = 0; face < 6; face++) {
      project(face, f.min[0], f.min[1], f.min[2], lo);
      project(face, f.max[0], f.max[1], f.max[2], hi);
      var loU = Math.min(lo[0], hi[0]), loV = Math.min(lo[1], hi[1]);
      var spanU = Math.abs(hi[0] - lo[0]) * inv, spanV = Math.abs(hi[1] - lo[1]) * inv;
      this.off[face * 2] = -loU * inv + (1 - spanU) * 0.5;
      this.off[face * 2 + 1] = -loV * inv + (1 - spanV) * 0.5;
    }
    this.scale = inv;
  };

  /** Where a point lands in its chart, in 0..1 within the cell. */
  PaintMap.prototype.chartST = function (face, x, y, z, out) {
    project(face, x, y, z, out);
    out[0] = out[0] * this.scale + this.off[face * 2];
    out[1] = out[1] * this.scale + this.off[face * 2 + 1];
    return out;
  };

  /** ...and where that is in the whole image, in 0..1. */
  PaintMap.prototype.atlasUV = function (face, x, y, z, out) {
    this.chartST(face, x, y, z, out);
    var s = S.clamp(out[0], 0, 1) * (1 - 2 * CHART_MARGIN) + CHART_MARGIN;
    var t = S.clamp(out[1], 0, 1) * (1 - 2 * CHART_MARGIN) + CHART_MARGIN;
    out[0] = (face % ATLAS_COLS + s) / ATLAS_COLS;
    out[1] = (Math.floor(face / ATLAS_COLS) + t) / ATLAS_ROWS;
    return out;
  };

  /**
   * How much each of the six charts has to say about a surface facing this
   * way. Only the three charts a surface can see at all get a share, and the
   * one it faces most squarely gets most of it.
   */
  PaintMap.prototype.weights = function (nx, ny, nz, out) {
    var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-12) { out[0] = 1; out[1] = out[2] = out[3] = out[4] = out[5] = 0; return out; }
    nx /= len; ny /= len; nz /= len;
    var comp = [nx > 0 ? nx : 0, nx < 0 ? -nx : 0, ny > 0 ? ny : 0,
                ny < 0 ? -ny : 0, nz > 0 ? nz : 0, nz < 0 ? -nz : 0];
    var total = 0;
    for (var f = 0; f < 6; f++) {
      var w = comp[f];
      w = w * w; w = w * w;                       // ^4: a tight blend
      out[f] = w;
      total += w;
    }
    if (total > 1e-20) { for (f = 0; f < 6; f++) out[f] /= total; }
    else { out[0] = 1; }
    return out;
  };

  /** One bilinear read of the image, in 0..1 image coordinates. */
  PaintMap.prototype.readUV = function (u, v, out) {
    var n = this.size;
    var x = S.clamp(u, 0, 1) * n - 0.5, y = S.clamp(v, 0, 1) * n - 0.5;
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var fx = x - x0, fy = y - y0;
    var x1 = x0 + 1, y1 = y0 + 1;
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 > n - 1) x1 = n - 1; if (y1 > n - 1) y1 = n - 1;
    if (x0 > n - 1) x0 = n - 1; if (y0 > n - 1) y0 = n - 1;
    var p = this.pixels;
    var oa = (y0 * n + x0) * 4, ob = (y0 * n + x1) * 4;
    var oc = (y1 * n + x0) * 4, od = (y1 * n + x1) * 4;
    for (var k = 0; k < 3; k++) {
      var top = p[oa + k] * (1 - fx) + p[ob + k] * fx;
      var bot = p[oc + k] * (1 - fx) + p[od + k] * fx;
      out[k] = (top * (1 - fy) + bot * fy) / 255;
    }
    return out;
  };

  /**
   * The colour of the surface at a point, read the way the renderer reads
   * it: the three charts that face this way, blended.
   */
  PaintMap.prototype.sample = function (x, y, z, nx, ny, nz, out) {
    var w = this._w || (this._w = new Float32Array(6));
    var st = this._st || (this._st = [0, 0]);
    var rgb = this._rgb || (this._rgb = [0, 0, 0]);
    this.weights(nx, ny, nz, w);
    out[0] = out[1] = out[2] = 0;
    for (var f = 0; f < 6; f++) {
      if (w[f] <= 0.001) continue;
      this.atlasUV(f, x, y, z, st);
      this.readUV(st[0], st[1], rgb);
      out[0] += rgb[0] * w[f];
      out[1] += rgb[1] * w[f];
      out[2] += rgb[2] * w[f];
    }
    return out;
  };

  /* ---- keeping track of what changed -------------------------------- */

  PaintMap.prototype.markDirty = function (x0, y0, x1, y1) {
    if (this.dirtyX1 < this.dirtyX0) { this.dirtyX0 = x0; this.dirtyY0 = y0; this.dirtyX1 = x1; this.dirtyY1 = y1; }
    else {
      if (x0 < this.dirtyX0) this.dirtyX0 = x0;
      if (y0 < this.dirtyY0) this.dirtyY0 = y0;
      if (x1 > this.dirtyX1) this.dirtyX1 = x1;
      if (y1 > this.dirtyY1) this.dirtyY1 = y1;
    }
    this.version++;
  };

  PaintMap.prototype.clearDirty = function () {
    this.dirtyX0 = 0; this.dirtyY0 = 0; this.dirtyX1 = -1; this.dirtyY1 = -1;
  };

  PaintMap.prototype.tileIndexAt = function (x, y) {
    return Math.floor(y / TILE) * this.tiles + Math.floor(x / TILE);
  };

  /** A copy of one tile, for the undo stack. */
  PaintMap.prototype.tileData = function (index) {
    var tx = (index % this.tiles) * TILE, ty = Math.floor(index / this.tiles) * TILE;
    var w = Math.min(TILE, this.size - tx), h = Math.min(TILE, this.size - ty);
    var out = new Uint8Array(w * h * 4);
    for (var row = 0; row < h; row++) {
      var from = ((ty + row) * this.size + tx) * 4;
      out.set(this.pixels.subarray(from, from + w * 4), row * w * 4);
    }
    return out;
  };

  PaintMap.prototype.setTileData = function (index, data) {
    var tx = (index % this.tiles) * TILE, ty = Math.floor(index / this.tiles) * TILE;
    var w = Math.min(TILE, this.size - tx), h = Math.min(TILE, this.size - ty);
    for (var row = 0; row < h; row++) {
      var to = ((ty + row) * this.size + tx) * 4;
      this.pixels.set(data.subarray(row * w * 4, (row + 1) * w * 4), to);
    }
    this.markDirty(tx, ty, tx + w - 1, ty + h - 1);
  };

  /* ---- filling and seeding ------------------------------------------ */

  PaintMap.prototype.fill = function (r, g, b) {
    var p = this.pixels;
    var br = Math.round(S.clamp(r, 0, 1) * 255);
    var bg = Math.round(S.clamp(g, 0, 1) * 255);
    var bb = Math.round(S.clamp(b, 0, 1) * 255);
    for (var i = 0; i < p.length; i += 4) { p[i] = br; p[i + 1] = bg; p[i + 2] = bb; p[i + 3] = 255; }
    this.markDirty(0, 0, this.size - 1, this.size - 1);
  };

  /**
   * Draw the mesh's own vertex colours into the map.
   *
   * Used when a map is made for a model that has already been painted the
   * old way: the colour that was there carries over instead of vanishing.
   */
  PaintMap.prototype.bakeFromMesh = function (mesh, base) {
    this.fill(base ? base[0] : 0.85, base ? base[1] : 0.85, base ? base[2] : 0.85);
    var self = this;
    var col = mesh.colors.array;
    this._rasterize(mesh, null, function (tri, a, b, c, w0, w1, w2, px, py, pz, out) {
      var oa = a * 3, ob = b * 3, oc = c * 3;
      out[0] = col[oa] * w0 + col[ob] * w1 + col[oc] * w2;
      out[1] = col[oa + 1] * w0 + col[ob + 1] * w1 + col[oc + 1] * w2;
      out[2] = col[oa + 2] * w0 + col[ob + 2] * w1 + col[oc + 2] * w2;
      out[3] = 1;
      return true;
    });
    this.markDirty(0, 0, this.size - 1, this.size - 1);
  };

  /* ---- the rasteriser ----------------------------------------------- */

  /**
   * Walk every texel of every triangle (or of the triangles given) and hand
   * it to `shade`, which returns the colour and how much of it to lay down.
   *
   * Each triangle is drawn into each chart that faces its way, and a texel
   * just outside the triangle is drawn too, faded: without that one-texel
   * spill, neighbouring triangles leave a hairline of unpainted image
   * between them and painted edges come out looking frayed.
   */
  PaintMap.prototype._rasterize = function (mesh, tris, shade, history, opts) {
    opts = opts || {};
    var accept = opts.accept || null;          // per triangle, before any texels
    var reach = opts.reach || null;            // {x,y,z,r}: skip texels outside it
    var reachR2 = reach ? reach.r * reach.r : 0;
    /*
     * Painting has its own inner loop rather than going through `shade`.
     * A dab touches tens of thousands of texels and a call per texel is
     * most of the cost of laying one down; the same work written out here
     * runs in about half the time, which is the difference between paint
     * that follows a finger and paint that trails behind it.
     */
    var fast = opts.paint || null;
    var fCol0 = 0, fCol1 = 0, fCol2 = 0, fStr = 1, fInvR = 1, fCx = 0, fCy = 0, fCz = 0;
    var fFall = null, fAlpha = null, fTile = 0, fAu = null, fAv = null, fMasks = null;
    if (fast) {
      fCol0 = fast.color[0]; fCol1 = fast.color[1]; fCol2 = fast.color[2];
      fStr = fast.strength; fInvR = 1 / fast.radius;
      fCx = fast.center[0]; fCy = fast.center[1]; fCz = fast.center[2];
      fFall = fast.falloff; fAlpha = fast.alpha || null; fTile = fast.alphaTile || 0;
      fAu = fast.alphaU; fAv = fast.alphaV; fMasks = mesh.masks.array;
    }
    var surf = [0, 0];
    var n = this.size;
    var pos = mesh.positions.array, T = mesh.tris.array;
    var w = this._wr || (this._wr = new Float32Array(6));
    var st = [0, 0], out = [0, 0, 0, 0];
    var pixels = this.pixels;
    var count = tris ? tris.length : mesh.triDead.length;
    var anything = false;
    var face, ti, t, t3, k, x, y;

    /*
     * First, sort the triangles by the charts they belong to.
     *
     * Every triangle is drawn into each of the (at most three) charts that
     * face its way, and each chart is then filled in one go. Working out
     * which charts a triangle belongs to — and where its corners land in
     * them — is done once here rather than once per chart, because it is
     * the same arithmetic six times over otherwise, and painting has to keep
     * up with a finger.
     */
    var lists = this._lists;
    if (!lists) {
      lists = this._lists = [];
      for (face = 0; face < 6; face++) {
        lists.push({ tri: new Int32Array(256), corner: new Float32Array(256 * 6),
                     weight: new Float32Array(256), count: 0,
                     x0: 0, y0: 0, x1: -1, y1: -1 });
      }
    }
    for (face = 0; face < 6; face++) {
      var l0 = lists[face];
      l0.count = 0; l0.x0 = n; l0.y0 = n; l0.x1 = -1; l0.y1 = -1;
    }

    for (ti = 0; ti < count; ti++) {
      t = tris ? tris[ti] : ti;
      if (mesh.triDead.array[t]) continue;
      t3 = t * 3;
      var ao = T[t3] * 3, bo = T[t3 + 1] * 3, co = T[t3 + 2] * 3;
      var e1x = pos[bo] - pos[ao], e1y = pos[bo + 1] - pos[ao + 1], e1z = pos[bo + 2] - pos[ao + 2];
      var e2x = pos[co] - pos[ao], e2y = pos[co + 1] - pos[ao + 1], e2z = pos[co + 2] - pos[ao + 2];
      var fnx = e1y * e2z - e1z * e2y, fny = e1z * e2x - e1x * e2z, fnz = e1x * e2y - e1y * e2x;
      if (accept && !accept(t, fnx, fny, fnz)) continue;
      this.weights(fnx, fny, fnz, w);
      for (face = 0; face < 6; face++) {
        // a chart the surface barely faces contributes almost nothing to a
        // read, so painting it is work for nothing
        if (w[face] <= 0.05) continue;
        var list = lists[face];
        if (list.count >= list.tri.length) {
          var biggerTri = new Int32Array(list.tri.length * 2);
          biggerTri.set(list.tri); list.tri = biggerTri;
          var biggerCorner = new Float32Array(list.corner.length * 2);
          biggerCorner.set(list.corner); list.corner = biggerCorner;
          var biggerWeight = new Float32Array(list.weight.length * 2);
          biggerWeight.set(list.weight); list.weight = biggerWeight;
        }
        var at = list.count++;
        list.tri[at] = t;
        list.weight[at] = w[face];
        for (k = 0; k < 3; k++) {
          var vo = T[t3 + k] * 3;
          this.atlasUV(face, pos[vo], pos[vo + 1], pos[vo + 2], st);
          var sx = st[0] * n, sy = st[1] * n;
          list.corner[at * 6 + k * 2] = sx;
          list.corner[at * 6 + k * 2 + 1] = sy;
          if (sx < list.x0) list.x0 = sx;
          if (sy < list.y0) list.y0 = sy;
          if (sx > list.x1) list.x1 = sx;
          if (sy > list.y1) list.y1 = sy;
        }
      }
    }

    for (face = 0; face < 6; face++) {
      var lst = lists[face];
      if (!lst.count || lst.x1 < 0) continue;
      var x0 = Math.max(0, Math.floor(lst.x0) - 1), x1 = Math.min(n - 1, Math.ceil(lst.x1) + 1);
      var y0 = Math.max(0, Math.floor(lst.y0) - 1), y1 = Math.min(n - 1, Math.ceil(lst.y1) + 1);
      if (x1 < x0 || y1 < y0) continue;
      var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      var need = bw * bh * 4;
      /*
       * A scratch buffer, so each texel is painted once.
       *
       * Straight into the image, a texel would be blended once per triangle
       * covering it — and every texel along a shared edge is covered twice,
       * because of the spill below — so the triangle edges would print
       * themselves into the paint as a lattice. Gathering the strongest
       * coverage per texel first and laying it down once is what keeps a dab
       * looking like a dab.
       */
      var scratch;
      if (need <= 4 * 1024 * 1024) {
        scratch = this._scratch;
        if (!scratch || scratch.length < need) scratch = this._scratch = new Float32Array(need);
        scratch.fill(0, 0, need);
      } else {
        scratch = new Float32Array(need);          // a whole-mesh bake, once
      }

      for (ti = 0; ti < lst.count; ti++) {
        t = lst.tri[ti];
        t3 = t * 3;
        var a = T[t3], b = T[t3 + 1], c = T[t3 + 2];
        var pa = a * 3, pb = b * 3, pc = c * 3;
        var fw = lst.weight[ti];
        var base = ti * 6;
        var ax = lst.corner[base], ay = lst.corner[base + 1];
        var bx = lst.corner[base + 2], by = lst.corner[base + 3];
        var cx = lst.corner[base + 4], cy = lst.corner[base + 5];

        var minX = Math.max(x0, Math.floor(Math.min(ax, bx, cx)) - 1);
        var maxX = Math.min(x1, Math.ceil(Math.max(ax, bx, cx)) + 1);
        var minY = Math.max(y0, Math.floor(Math.min(ay, by, cy)) - 1);
        var maxY = Math.min(y1, Math.ceil(Math.max(ay, by, cy)) + 1);
        if (maxX < minX || maxY < minY) continue;
        var area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (area === 0 || !isFinite(area)) continue;
        var inv = 1 / area;
        var n1x = pos[pb] - pos[pa], n1y = pos[pb + 1] - pos[pa + 1], n1z = pos[pb + 2] - pos[pa + 2];
        var n2x = pos[pc] - pos[pa], n2y = pos[pc + 1] - pos[pa + 1], n2z = pos[pc + 2] - pos[pa + 2];
        var tnx = n1y * n2z - n1z * n2y, tny = n1z * n2x - n1x * n2z, tnz = n1x * n2y - n1y * n2x;

        for (y = minY; y <= maxY; y++) {
          for (x = minX; x <= maxX; x++) {
            var tx = x + 0.5, ty = y + 0.5;
            var u0 = ((bx - tx) * (cy - ty) - (by - ty) * (cx - tx)) * inv;
            var u1 = ((cx - tx) * (ay - ty) - (cy - ty) * (ax - tx)) * inv;
            var u2 = 1 - u0 - u1;
            /*
             * Outside the triangle, slide onto its nearest point instead of
             * giving up: that is the one-texel spill that stops neighbouring
             * triangles leaving a hairline of unpainted image between them.
             */
            if (u0 < 0 || u1 < 0 || u2 < 0) {
              var c0 = u0 < 0 ? 0 : u0, c1 = u1 < 0 ? 0 : u1, c2 = u2 < 0 ? 0 : u2;
              var sum = c0 + c1 + c2;
              if (sum <= 1e-12) continue;
              c0 /= sum; c1 /= sum; c2 /= sum;
              var nearX = ax * c0 + bx * c1 + cx * c2;
              var nearY = ay * c0 + by * c1 + cy * c2;
              if ((nearX - tx) * (nearX - tx) + (nearY - ty) * (nearY - ty) > 1) continue;
              u0 = c0; u1 = c1; u2 = c2;
            }
            var px = pos[pa] * u0 + pos[pb] * u1 + pos[pc] * u2;
            var py = pos[pa + 1] * u0 + pos[pb + 1] * u1 + pos[pc + 1] * u2;
            var pz = pos[pa + 2] * u0 + pos[pb + 2] * u1 + pos[pc + 2] * u2;
            if (reach) {
              // most of a triangle's texels fall outside the brush; rule them
              // out here rather than in a call per texel
              var rx = px - reach.x, ry = py - reach.y, rz = pz - reach.z;
              if (rx * rx + ry * ry + rz * rz > reachR2) continue;
            }
            var amount, cr, cg, cb;
            if (fast) {
              var ddx = px - fCx, ddy = py - fCy, ddz = pz - fCz;
              var d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) * fInvR;
              if (d >= 1) continue;
              var f;
              if (fAlpha && fTile > 0) {
                S.Alpha.surfaceUV(px, py, pz, tnx, tny, tnz, fTile, surf);
                f = S.Alpha.sampleTiled(fAlpha, surf[0], surf[1]) * fFall(1 - d);
              } else if (fAlpha) {
                var su = ((ddx * fAu[0] + ddy * fAu[1] + ddz * fAu[2]) * fInvR) * 0.5 + 0.5;
                var sv = ((ddx * fAv[0] + ddy * fAv[1] + ddz * fAv[2]) * fInvR) * 0.5 + 0.5;
                f = S.Alpha.sample(fAlpha, su, sv);
                if (d > 0.8) f *= S.smoothstep((1 - d) / 0.2);
              } else {
                f = fFall(1 - d);
              }
              if (f <= 0) continue;
              var mk = fMasks[a] * u0 + fMasks[b] * u1 + fMasks[c] * u2;
              f *= (1 - mk) * fStr;
              if (f <= 0) continue;
              amount = f * fw;
              cr = fCol0; cg = fCol1; cb = fCol2;
            } else {
              out[3] = 1;
              if (!shade(t, a, b, c, u0, u1, u2, px, py, pz, out, tnx, tny, tnz)) continue;
              amount = out[3] * fw;
              cr = out[0]; cg = out[1]; cb = out[2];
            }
            if (amount <= 0.0005) continue;
            if (amount > 1) amount = 1;
            var so = ((y - y0) * bw + (x - x0)) * 4;
            if (amount <= scratch[so + 3]) continue;
            scratch[so] = cr; scratch[so + 1] = cg; scratch[so + 2] = cb;
            scratch[so + 3] = amount;
          }
        }
      }

      /* ...and lay it down */
      var captured = history ? {} : null;
      var tx0 = n, ty0 = n, tx1 = -1, ty1 = -1;
      for (y = y0; y <= y1; y++) {
        for (x = x0; x <= x1; x++) {
          var s2 = ((y - y0) * bw + (x - x0)) * 4;
          var amt = scratch[s2 + 3];
          if (amt <= 0.0005) continue;
          var o = (y * n + x) * 4;
          if (captured) {
            var tile = this.tileIndexAt(x, y);
            if (!captured[tile]) { captured[tile] = 1; history.capturePaintTile(this, tile); }
          }
          pixels[o] += (S.clamp(scratch[s2], 0, 1) * 255 - pixels[o]) * amt;
          pixels[o + 1] += (S.clamp(scratch[s2 + 1], 0, 1) * 255 - pixels[o + 1]) * amt;
          pixels[o + 2] += (S.clamp(scratch[s2 + 2], 0, 1) * 255 - pixels[o + 2]) * amt;
          pixels[o + 3] = 255;
          if (x < tx0) tx0 = x;
          if (y < ty0) ty0 = y;
          if (x > tx1) tx1 = x;
          if (y > ty1) ty1 = y;
        }
      }
      if (tx1 >= 0) { this.markDirty(tx0, ty0, tx1, ty1); anything = true; }
    }

    return anything;
  };

  /**
   * Lay one dab of paint down.
   *
   * Everything that decides how a sculpting brush behaves decides this too:
   * the radial falloff, the stencil read through the brush's own frame, the
   * mask, whether the surface faces the brush. The difference is only where
   * the result lands.
   */
  PaintMap.prototype.stamp = function (mesh, opts) {
    var cx = opts.center[0], cy = opts.center[1], cz = opts.center[2];
    var radius = opts.radius;
    if (!(radius > 0)) return false;
    var nrm = opts.normal;
    var front = opts.frontFacing !== false && nrm;
    var tris = mesh.trisInSphere(cx, cy, cz, radius).slice();
    return this._rasterize(mesh, tris, null, opts.history || null, {
      accept: front ? function (t, fnx, fny, fnz) {
        // a triangle facing away from the brush is not painted at all, so
        // there is no point walking its texels
        return fnx * nrm[0] + fny * nrm[1] + fnz * nrm[2] > 0;
      } : null,
      reach: { x: cx, y: cy, z: cz, r: radius },
      paint: {
        center: opts.center, radius: radius,
        color: opts.color || [1, 1, 1],
        strength: opts.strength === undefined ? 1 : opts.strength,
        falloff: opts.falloff || function (t) { return t; },
        alpha: opts.alpha || null, alphaTile: opts.alphaTile || 0,
        alphaU: opts.alphaU, alphaV: opts.alphaV
      }
    });
  };

  /**
   * Write what the image says onto the mesh's vertices.
   *
   * The reverse of `bakeFromMesh`, and needed wherever colour has to travel
   * as part of the geometry: joining two objects into one, or exporting a
   * PLY, where vertex colour is the only colour the format has. Detail finer
   * than the mesh is lost, which is the whole reason painting does not work
   * this way round.
   */
  PaintMap.prototype.toVertexColors = function (mesh) {
    var pos = mesh.positions.array, nor = mesh.normals.array, col = mesh.colors.array;
    var rgb = [0, 0, 0];
    for (var v = 0; v < mesh.masks.length; v++) {
      if (mesh.vertDead.array[v]) continue;
      var o = v * 3;
      this.sample(pos[o], pos[o + 1], pos[o + 2], nor[o], nor[o + 1], nor[o + 2], rgb);
      col[o] = rgb[0]; col[o + 1] = rgb[1]; col[o + 2] = rgb[2];
      mesh.markVertDirty(v);
    }
    return mesh;
  };

  /* ---- keeping and reloading ---------------------------------------- */

  PaintMap.prototype.clone = function () {
    var copy = new PaintMap(this.size, {
      min: this.frame.min.slice(), max: this.frame.max.slice(), span: this.frame.span
    });
    copy.pixels.set(this.pixels);
    return copy;
  };

  /**
   * The image as bytes, run-length encoded.
   *
   * A fresh map is one colour from corner to corner and a painted one has
   * large flat areas, so the runs do most of the work; a project file keeps
   * its paint without carrying four megabytes of mostly-identical pixels.
   */
  PaintMap.prototype.encode = function () {
    var p = this.pixels, n = this.size * this.size;
    var out = [];
    var i = 0;
    while (i < n) {
      var o = i * 4;
      var r = p[o], g = p[o + 1], b = p[o + 2];
      var run = 1;
      while (run < 65535 && i + run < n) {
        var q = (i + run) * 4;
        if (p[q] !== r || p[q + 1] !== g || p[q + 2] !== b) break;
        run++;
      }
      out.push(run & 255, (run >> 8) & 255, r, g, b);
      i += run;
    }
    return new Uint8Array(out);
  };

  PaintMap.decodeInto = function (map, bytes) {
    var p = map.pixels, n = map.size * map.size;
    var i = 0, at = 0;
    while (at + 4 < bytes.length && i < n) {
      var run = bytes[at] | (bytes[at + 1] << 8);
      var r = bytes[at + 2], g = bytes[at + 3], b = bytes[at + 4];
      at += 5;
      for (var k = 0; k < run && i < n; k++, i++) {
        var o = i * 4;
        p[o] = r; p[o + 1] = g; p[o + 2] = b; p[o + 3] = 255;
      }
    }
    map.markDirty(0, 0, map.size - 1, map.size - 1);
    return map;
  };

  PaintMap.prototype.toPNG = function () {
    return Tex.encodePNG(this.pixels, this.size, this.size);
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
