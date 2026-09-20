/*
 * SculptFree — brush alphas: the greyscale stencil a brush works through.
 *
 * Without one, a brush is a smooth round dab. With one, it becomes a stamp:
 * the image's brightness scales the effect across the brush footprint, so a
 * photograph of gravel becomes gravel, a drawing of a rivet becomes a rivet,
 * and a scan of cracked paint becomes cracked paint. Same for painting —
 * the alpha decides where the colour lands.
 *
 * The image is stored as a single Float32 grid in 0..1, so sampling it is
 * one bilinear read per vertex and it costs nothing to keep a few loaded.
 *
 * There are procedural ones built in (no files to ship, works offline) and
 * any image can be loaded from disk.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var Alpha = S.Alpha = {};

  var SIZE = 128;                     // built-ins are generated at this size

  /**
   * An alpha is { id, label, size, data } where data is size*size floats in
   * 0..1, row 0 at the bottom (matching the brush's tangent frame).
   */
  Alpha.make = function (id, label, size, data) {
    return { id: id, label: label, size: size, data: data };
  };

  /* ---------------------------------------------------------------- *
   * a small deterministic noise, so the built-ins look the same every
   * time and need no assets
   * ---------------------------------------------------------------- */

  /**
   * A 32-bit integer hash. Math.imul and unsigned shifts matter here: with
   * plain float multiplies and arithmetic shifts the top bit never survives,
   * the result only spans 0..0.5, and every generated stencil comes out
   * nearly blank.
   */
  function hash2(x, y, seed) {
    var h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 69069);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }

  function valueNoise(x, y, seed) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
    var c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  function fbm(x, y, seed, octaves, gain) {
    var sum = 0, amp = 1, norm = 0, freq = 1;
    for (var o = 0; o < octaves; o++) {
      sum += valueNoise(x * freq, y * freq, seed + o * 17) * amp;
      norm += amp;
      amp *= gain === undefined ? 0.5 : gain;
      freq *= 2;
    }
    return sum / norm;
  }

  /* ---------------------------------------------------------------- *
   * the built-in stencils
   * ---------------------------------------------------------------- */

  var GENERATORS = [
    { id: 'dirt', label: 'Dirt', build: function (u, v) {
      // clumpy grain: fine noise with a soft large-scale mask over it
      var n = fbm(u * 9, v * 9, 3, 5);
      var mask = fbm(u * 2.5, v * 2.5, 91, 3);
      var d = Math.max(0, n * 0.75 + mask * 0.45 - 0.42) * 2.4;
      return S.clamp(d, 0, 1);
    } },
    { id: 'gravel', label: 'Gravel', build: function (u, v) {
      // rounded lumps: cellular-ish, from the distance to scattered points
      var best = 1e9, second = 1e9;
      var cell = 5;
      var cx = Math.floor(u * cell), cy = Math.floor(v * cell);
      for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
          var gx = cx + ox, gy = cy + oy;
          var px = (gx + hash2(gx, gy, 7)) / cell;
          var py = (gy + hash2(gx, gy, 19)) / cell;
          var d = (u - px) * (u - px) + (v - py) * (v - py);
          if (d < best) { second = best; best = d; } else if (d < second) second = d;
        }
      }
      var edge = Math.sqrt(second) - Math.sqrt(best);
      return S.clamp(1 - edge * cell * 0.9, 0, 1);
    } },
    { id: 'cracks', label: 'Cracks', build: function (u, v) {
      // the ridges between noise cells read as cracks
      var n = fbm(u * 6, v * 6, 41, 4);
      var ridge = 1 - Math.abs(n - 0.5) * 4;
      return S.clamp((ridge - 0.45) * 2.2, 0, 1);
    } },
    { id: 'scratches', label: 'Scratches', build: function (u, v) {
      // stretched noise, so the grain runs one way
      var n = fbm(u * 26, v * 2.2, 13, 4);
      return S.clamp((n - 0.52) * 4.5, 0, 1);
    } },
    { id: 'bumps', label: 'Bumps', build: function (u, v) {
      var n = fbm(u * 7, v * 7, 61, 3, 0.6);
      return S.clamp((n - 0.45) * 3.2, 0, 1);
    } },
    { id: 'cloth', label: 'Weave', build: function (u, v) {
      var warp = Math.sin(u * Math.PI * 14) * 0.5 + 0.5;
      var weft = Math.sin(v * Math.PI * 14) * 0.5 + 0.5;
      var grain = fbm(u * 18, v * 18, 5, 2) * 0.35;
      return S.clamp(Math.max(warp, weft) * 0.85 + grain - 0.25, 0, 1);
    } },
    { id: 'rivet', label: 'Rivet', build: function (u, v) {
      // a single dome, for stamping one detail at a time
      var dx = (u - 0.5) * 2, dy = (v - 0.5) * 2;
      var r = Math.sqrt(dx * dx + dy * dy);
      if (r > 0.82) return 0;
      var dome = Math.sqrt(Math.max(0, 1 - (r / 0.82) * (r / 0.82)));
      return S.clamp(dome, 0, 1);
    } },
    { id: 'square', label: 'Square', build: function (u, v) {
      // a hard-edged square, for blocking in panels
      var d = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;
      return d > 0.84 ? 0 : S.clamp((0.84 - d) * 9, 0, 1);
    } }
  ];

  var cache = {};

  /** Build (and remember) a built-in stencil. */
  Alpha.builtin = function (id) {
    if (cache[id]) return cache[id];
    var gen = null;
    for (var i = 0; i < GENERATORS.length; i++) if (GENERATORS[i].id === id) gen = GENERATORS[i];
    if (!gen) return null;
    var data = new Float32Array(SIZE * SIZE);
    var x, y, i;
    var lo = Infinity, hi = -Infinity;
    for (y = 0; y < SIZE; y++) {
      for (x = 0; x < SIZE; x++) {
        var value = gen.build((x + 0.5) / SIZE, (y + 0.5) / SIZE);
        data[y * SIZE + x] = value;
        if (value < lo) lo = value;
        if (value > hi) hi = value;
      }
    }
    // Stretch to the full range before anything else. The generators are
    // hand-tuned thresholds over noise; normalising means a stencil is
    // always usable even where a guess was off.
    if (hi - lo > 1e-6) {
      var scale = 1 / (hi - lo);
      for (i = 0; i < data.length; i++) data[i] = (data[i] - lo) * scale;
    }
    // then fade the border, so a stamp never leaves a hard rectangle
    for (y = 0; y < SIZE; y++) {
      for (x = 0; x < SIZE; x++) {
        var u = (x + 0.5) / SIZE, v = (y + 0.5) / SIZE;
        var edge = Math.min(u, v, 1 - u, 1 - v);
        if (edge < 0.06) data[y * SIZE + x] *= edge / 0.06;
      }
    }
    cache[id] = Alpha.make(id, gen.label, SIZE, data);
    return cache[id];
  };

  Alpha.BUILTIN_IDS = GENERATORS.map(function (g) { return g.id; });
  Alpha.builtinLabel = function (id) {
    for (var i = 0; i < GENERATORS.length; i++) if (GENERATORS[i].id === id) return GENERATORS[i].label;
    return id;
  };

  /* ---------------------------------------------------------------- *
   * loading an image
   * ---------------------------------------------------------------- */

  /**
   * Turn RGBA pixels into a stencil. Brightness becomes strength, and a
   * transparent pixel counts as nothing at all, so a PNG cut-out works as
   * you would expect. Oversized images are box-filtered down.
   */
  Alpha.fromPixels = function (id, label, pixels, width, height, opts) {
    opts = opts || {};
    var target = Math.min(256, Math.max(16, opts.size || 256));
    var size = Math.min(target, Math.max(width, height));
    var data = new Float32Array(size * size);
    var sx = width / size, sy = height / size;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        // average the source pixels covered by this cell
        var x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
        var y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
        var sum = 0, n = 0;
        for (var yy = y0; yy < y1 && yy < height; yy++) {
          for (var xx = x0; xx < x1 && xx < width; xx++) {
            // images arrive with row 0 at the top; flip so v runs upwards
            var o = ((height - 1 - yy) * width + xx) * 4;
            var lum = (pixels[o] * 0.299 + pixels[o + 1] * 0.587 + pixels[o + 2] * 0.114) / 255;
            sum += lum * (pixels[o + 3] / 255);
            n++;
          }
        }
        data[y * size + x] = n ? S.clamp(sum / n, 0, 1) : 0;
      }
    }
    if (opts.invert) {
      for (var i = 0; i < data.length; i++) data[i] = 1 - data[i];
    }
    if (opts.normalize !== false) {
      var lo = 1, hi = 0;
      for (var k = 0; k < data.length; k++) {
        if (data[k] < lo) lo = data[k];
        if (data[k] > hi) hi = data[k];
      }
      if (hi - lo > 1e-6 && (lo > 0.02 || hi < 0.98)) {
        var scale = 1 / (hi - lo);
        for (var j = 0; j < data.length; j++) data[j] = (data[j] - lo) * scale;
      }
    }
    return Alpha.make(id, label, size, data);
  };

  /* ---------------------------------------------------------------- *
   * sampling
   * ---------------------------------------------------------------- */

  /** Bilinear read at (u,v) in 0..1. Outside that range reads as nothing. */
  Alpha.sample = function (alpha, u, v) {
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    var n = alpha.size;
    var x = u * (n - 1), y = v * (n - 1);
    var x0 = x | 0, y0 = y | 0;
    var x1 = x0 + 1 < n ? x0 + 1 : x0;
    var y1 = y0 + 1 < n ? y0 + 1 : y0;
    var fx = x - x0, fy = y - y0;
    var d = alpha.data;
    var a = d[y0 * n + x0], b = d[y0 * n + x1];
    var c = d[y1 * n + x0], e = d[y1 * n + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
  };

  /* ---------------------------------------------------------------- *
   * the live set: built-ins plus whatever has been loaded
   * ---------------------------------------------------------------- */

  Alpha.loaded = {};                 // id -> alpha, for images from disk

  Alpha.add = function (alpha) {
    Alpha.loaded[alpha.id] = alpha;
    return alpha;
  };

  Alpha.remove = function (id) { delete Alpha.loaded[id]; };

  /** Look up a stencil by id, built-in or loaded. */
  S.alphaById = function (id) {
    if (!id || id === 'none') return null;
    if (Alpha.loaded[id]) return Alpha.loaded[id];
    return Alpha.builtin(id);
  };

  /** Every stencil available right now, for the picker. */
  Alpha.list = function () {
    var out = [];
    for (var i = 0; i < Alpha.BUILTIN_IDS.length; i++) {
      out.push({ id: Alpha.BUILTIN_IDS[i], label: Alpha.builtinLabel(Alpha.BUILTIN_IDS[i]), builtin: true });
    }
    for (var id in Alpha.loaded) {
      out.push({ id: id, label: Alpha.loaded[id].label, builtin: false });
    }
    return out;
  };

  /** A small RGBA preview, for the thumbnails in the interface. */
  Alpha.toRGBA = function (alpha, size) {
    size = size || 48;
    var out = new Uint8Array(size * size * 4);
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var v = Alpha.sample(alpha, (x + 0.5) / size, 1 - (y + 0.5) / size);
        var o = (y * size + x) * 4;
        var g = Math.round(24 + v * 210);
        out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
      }
    }
    return out;
  };


  /** The name to show for a stencil id, whether built in or loaded. */
  Alpha.labelOf = function (id) {
    if (!id || id === 'none') return 'None';
    if (Alpha.loaded[id]) return Alpha.loaded[id].label;
    return Alpha.builtinLabel(id);
  };

  /* ---------------------------------------------------------------- *
   * keeping loaded images between sessions
   *
   * An uploaded stencil is worth keeping — nobody wants to find their dirt
   * texture again every time they open the app. The grid is quantised to a
   * byte per pixel and base64'd, which is a sixteenth of the float data and
   * visually identical for a mask.
   * ---------------------------------------------------------------- */

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64_REV = null;

  function toBase64(bytes) {
    var out = '', i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63];
    }
    var left = bytes.length - i;
    if (left === 1) {
      var a = bytes[i] << 16;
      out += B64[(a >>> 18) & 63] + B64[(a >>> 12) & 63] + '==';
    } else if (left === 2) {
      var b = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64[(b >>> 18) & 63] + B64[(b >>> 12) & 63] + B64[(b >>> 6) & 63] + '=';
    }
    return out;
  }

  function fromBase64(text) {
    if (!B64_REV) {
      B64_REV = new Int8Array(128).fill(-1);
      for (var c = 0; c < B64.length; c++) B64_REV[B64.charCodeAt(c)] = c;
    }
    var clean = String(text).replace(/[^A-Za-z0-9+/]/g, '');
    var bytes = new Uint8Array(Math.floor(clean.length * 3 / 4));
    var at = 0, acc = 0, bits = 0;
    for (var i = 0; i < clean.length; i++) {
      var v = B64_REV[clean.charCodeAt(i)];
      if (v < 0) continue;
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes[at++] = (acc >>> bits) & 0xFF;
      }
    }
    return bytes.subarray(0, at);
  }

  Alpha.toBase64 = toBase64;
  Alpha.fromBase64 = fromBase64;

  Alpha.serialize = function (alpha) {
    var bytes = new Uint8Array(alpha.data.length);
    for (var i = 0; i < alpha.data.length; i++) {
      bytes[i] = Math.round(S.clamp(alpha.data[i], 0, 1) * 255);
    }
    return { id: alpha.id, label: alpha.label, size: alpha.size, data: toBase64(bytes) };
  };

  Alpha.deserialize = function (entry) {
    if (!entry || !entry.size || !entry.data) return null;
    var bytes = fromBase64(entry.data);
    var need = entry.size * entry.size;
    if (bytes.length < need) return null;
    var data = new Float32Array(need);
    for (var i = 0; i < need; i++) data[i] = bytes[i] / 255;
    return Alpha.make(String(entry.id), String(entry.label || 'Stencil'), entry.size, data);
  };

  var STORAGE_KEY = 'sculptfree.alphas.v1';
  Alpha.STORAGE_KEY = STORAGE_KEY;
  Alpha.MAX_SAVED = 16;

  /** Put every loaded stencil in the store. Returns false if it would not fit. */
  Alpha.saveAll = function (storage) {
    try {
      var list = [];
      for (var id in Alpha.loaded) list.push(Alpha.serialize(Alpha.loaded[id]));
      if (list.length > Alpha.MAX_SAVED) list = list.slice(list.length - Alpha.MAX_SAVED);
      storage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;                     // out of quota, or private browsing
    }
  };

  /** Bring saved stencils back. Returns how many were restored. */
  Alpha.loadAll = function (storage) {
    var n = 0;
    try {
      var raw = storage && storage.getItem(STORAGE_KEY);
      if (!raw) return 0;
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return 0;
      for (var i = 0; i < list.length; i++) {
        var alpha = Alpha.deserialize(list[i]);
        if (alpha) { Alpha.add(alpha); n++; }
      }
    } catch (e) { /* corrupt store: carry on with the built-ins */ }
    return n;
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
