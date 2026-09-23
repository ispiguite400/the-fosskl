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

  /**
   * Value noise on a lattice that wraps.
   *
   * `period` is how many lattice cells there are before the pattern repeats.
   * Wrapping matters because these stencils are used as textures as well as
   * as stamps: scrub a dirt brush over a surface and the pattern is read
   * from the surface, tile after tile, so a pattern that does not meet
   * itself at the edges prints a grid of seams across the model.
   */
  function valueNoise(x, y, seed, px, py) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    function at(gx, gy) {
      if (px > 0) gx = ((gx % px) + px) % px;
      if (py > 0) gy = ((gy % py) + py) % py;
      return hash2(gx, gy, seed);
    }
    var a = at(xi, yi), b = at(xi + 1, yi);
    var c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  /**
   * Fractal noise. `period` is the lattice period of the first octave; each
   * octave doubles both the frequency and the period, so the whole sum
   * repeats over the same distance.
   */
  function fbm(x, y, seed, octaves, gain, px, py) {
    var sum = 0, amp = 1, norm = 0, freq = 1;
    for (var o = 0; o < octaves; o++) {
      sum += valueNoise(x * freq, y * freq, seed + o * 17,
                        px ? px * freq : 0, py ? py * freq : 0) * amp;
      norm += amp;
      amp *= gain === undefined ? 0.5 : gain;
      freq *= 2;
    }
    return sum / norm;
  }

  /**
   * Distance to the nearest of a grid of jittered points, and to the second
   * nearest — the two numbers every cellular pattern is built from. `first`
   * gives pebbles and blobs; `second - first` gives the seams between them.
   */
  function cellular(u, v, cells, seed, out) {
    var best = 1e9, second = 1e9;
    var cx = Math.floor(u * cells), cy = Math.floor(v * cells);
    for (var oy = -1; oy <= 1; oy++) {
      for (var ox = -1; ox <= 1; ox++) {
        var gx = cx + ox, gy = cy + oy;
        // the cell's *point* is looked up on a wrapped grid, so the pattern
        // tiles; its position stays where it is, so nothing jumps
        var wx = ((gx % cells) + cells) % cells, wy = ((gy % cells) + cells) % cells;
        var px = (gx + hash2(wx, wy, seed)) / cells;
        var py = (gy + hash2(wx, wy, seed + 101)) / cells;
        var d = (u - px) * (u - px) + (v - py) * (v - py);
        if (d < best) { second = best; best = d; } else if (d < second) second = d;
      }
    }
    out[0] = Math.sqrt(best) * cells;
    out[1] = Math.sqrt(second) * cells;
    return out;
  }

  /**
   * Distance from the middle of the nearest hexagon in a honeycomb, where 0
   * is the middle and 0.5 the edge.
   *
   * A honeycomb is two square lattices interleaved — one offset by half a
   * cell both ways — so the nearest hexagon is whichever of the two is
   * closer. Inside a cell the hexagonal distance is the larger of the two
   * supporting lines, which is what gives six flat sides instead of four.
   */
  function hexDist(u, v, cols, rows) {
    var ROW = 1.7320;                             // sqrt(3): row spacing
    /*
     * Columns and rows are whole numbers so the honeycomb meets itself when
     * tiled. A regular hexagon wants the two to be in the ratio sqrt(3),
     * which is never a whole number, so the cells come out about a seventh
     * wider than they are tall — which nobody has ever noticed in a
     * honeycomb, and a seam down the middle of a model they would.
     */
    var x = u * cols, y = v * rows * ROW;
    function fold(px, py) {
      var fx = Math.abs(px - Math.floor(px) - 0.5);
      var fy = Math.abs(py - Math.floor(py / ROW) * ROW - ROW * 0.5);
      return Math.max(fx * 0.8660 + fy * 0.5, fy);
    }
    return Math.min(fold(x, y), fold(x + 0.5, y + ROW * 0.5));
  }

  /** A hash on a grid that wraps every `cells`, so dot patterns tile. */
  function gridHash(gx, gy, cells, seed) {
    var wx = ((gx % cells) + cells) % cells, wy = ((gy % cells) + cells) % cells;
    return hash2(wx, wy, seed);
  }

  var CELL = [0, 0];

  /* ---------------------------------------------------------------- *
   * the built-in stencils
   * ---------------------------------------------------------------- */

  var GENERATORS = [
    { id: 'dirt', label: 'Dirt', build: function (u, v) {
      // clumpy grain: fine noise with a soft large-scale mask over it
      var n = fbm(u * 9, v * 9, 3, 5, 0.5, 9, 9);
      var mask = fbm(u * 3, v * 3, 91, 3, 0.5, 3, 3);
      var d = Math.max(0, n * 0.75 + mask * 0.45 - 0.42) * 2.4;
      return S.clamp(d, 0, 1);
    } },
    { id: 'gravel', label: 'Gravel', build: function (u, v) {
      // rounded lumps: cellular-ish, from the distance to scattered points
      cellular(u, v, 5, 7, CELL);
      var edge = CELL[1] - CELL[0];
      return S.clamp(1 - edge * 0.9, 0, 1);
    } },
    { id: 'cracks', label: 'Cracks', build: function (u, v) {
      // the ridges between noise cells read as cracks
      var n = fbm(u * 6, v * 6, 41, 4, 0.5, 6, 6);
      var ridge = 1 - Math.abs(n - 0.5) * 4;
      return S.clamp((ridge - 0.45) * 2.2, 0, 1);
    } },
    { id: 'scratches', label: 'Scratches', build: function (u, v) {
      // stretched noise, so the grain runs one way
      var n = fbm(u * 26, v * 2, 13, 4, 0.5, 26, 2);
      return S.clamp((n - 0.52) * 4.5, 0, 1);
    } },
    { id: 'bumps', label: 'Bumps', build: function (u, v) {
      var n = fbm(u * 7, v * 7, 61, 3, 0.6, 7, 7);
      return S.clamp((n - 0.45) * 3.2, 0, 1);
    } },
    { id: 'cloth', label: 'Weave', build: function (u, v) {
      var warp = Math.sin(u * Math.PI * 14) * 0.5 + 0.5;
      var weft = Math.sin(v * Math.PI * 14) * 0.5 + 0.5;
      var grain = fbm(u * 18, v * 18, 5, 2, 0.5, 18, 18) * 0.35;
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
    } },

    /* ---- surfaces: something to cover an area with ----------------- */
    { id: 'rock', label: 'Rock', build: function (u, v) {
      // faceted lumps: cellular, with the seams cut in hard
      cellular(u, v, 4, 23, CELL);
      var seam = S.clamp((CELL[1] - CELL[0]) * 2.6, 0, 1);
      var facet = S.clamp(1 - CELL[0] * 1.1, 0, 1);
      var grain = fbm(u * 16, v * 16, 77, 4, 0.5, 16, 16) * 0.35;
      return S.clamp(seam * 0.75 + facet * 0.35 + grain - 0.3, 0, 1);
    } },
    { id: 'bark', label: 'Bark', build: function (u, v) {
      // long vertical fissures, the way bark splits as a trunk grows
      var warp = fbm(u * 3, v * 1, 31, 3, 0.5, 3, 1) * 0.35;
      var n = fbm((u + warp) * 22, v * 2, 5, 4, 0.5, 22, 2);
      var ridge = 1 - Math.abs(n - 0.5) * 3.4;
      return S.clamp((ridge - 0.35) * 2.0, 0, 1);
    } },
    { id: 'leather', label: 'Leather', build: function (u, v) {
      // fine pebbling: small cells with the creases between them
      cellular(u, v, 16, 53, CELL);
      var crease = S.clamp((CELL[1] - CELL[0]) * 3.2, 0, 1);
      var grain = fbm(u * 40, v * 40, 13, 2, 0.5, 40, 40) * 0.3;
      return S.clamp(crease * 0.85 + grain - 0.12, 0, 1);
    } },
    { id: 'rust', label: 'Rust', build: function (u, v) {
      // patches that eat into the surface, with pitting inside them
      var patch = fbm(u * 3, v * 3, 67, 4, 0.5, 3, 3);
      var pit = fbm(u * 18, v * 18, 89, 3, 0.5, 18, 18);
      var eaten = (patch - 0.4) * 3.2 + (pit - 0.5) * 0.7;
      return S.clamp(eaten, 0, 1);
    } },
    { id: 'sponge', label: 'Sponge', build: function (u, v) {
      // holes of mixed sizes, clustered — the classic stipple-in sponge
      cellular(u, v, 7, 37, CELL);
      var hole = S.clamp(1 - CELL[0] * 1.5, 0, 1);
      var vary = fbm(u * 4, v * 4, 3, 2, 0.5, 4, 4);
      return S.clamp(hole * (0.4 + vary), 0, 1);
    } },
    { id: 'grain', label: 'Grain', build: function (u, v) {
      // plain fine noise, for taking the plastic sheen off a surface
      var n = fbm(u * 34, v * 34, 101, 3, 0.55, 34, 34);
      return S.clamp((n - 0.35) * 1.8, 0, 1);
    } },

    /* ---- marks: lines and speckle ---------------------------------- */
    { id: 'hatch', label: 'Hatch', build: function (u, v) {
      // two sets of ruled lines crossing, as a pencil would
      var a = Math.abs(Math.sin((u + v) * Math.PI * 10));
      var b = Math.abs(Math.sin((u - v) * Math.PI * 10));
      var lines = Math.max(1 - a * 3.2, 1 - b * 3.2);
      var broken = fbm(u * 12, v * 12, 47, 2, 0.5, 12, 12) * 0.5 + 0.55;
      return S.clamp(lines * broken, 0, 1);
    } },
    { id: 'stipple', label: 'Stipple', build: function (u, v) {
      /*
       * Dense fine dots, for skin and cast metal. The neighbouring cells
       * are checked as well as this one: a dot whose middle sits near a
       * cell edge otherwise gets cut off at it, which shows up as a seam
       * when the pattern is tiled across a surface.
       */
      var g = 22;
      var cx = Math.floor(u * g), cy = Math.floor(v * g);
      var best = 0;
      for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
          var gx = cx + ox, gy = cy + oy;
          var px = (gx + 0.2 + gridHash(gx, gy, g, 71) * 0.6) / g;
          var py = (gy + 0.2 + gridHash(gx, gy, g, 83) * 0.6) / g;
          var r = Math.sqrt((u - px) * (u - px) + (v - py) * (v - py)) * g;
          var size = 0.28 + gridHash(gx, gy, g, 97) * 0.22;
          var dot = (size - r) / size;
          if (dot > best) best = dot;
        }
      }
      return S.clamp(best, 0, 1);
    } },
    { id: 'spray', label: 'Spray', build: function (u, v) {
      // scattered specks, thinning out, with only about half the cells used
      var g = 15;
      var cx = Math.floor(u * g), cy = Math.floor(v * g);
      var best = 0;
      for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
          var gx = cx + ox, gy = cy + oy;
          if (gridHash(gx, gy, g, 113) < 0.45) continue;
          var px = (gx + gridHash(gx, gy, g, 127)) / g;
          var py = (gy + gridHash(gx, gy, g, 131)) / g;
          var r = Math.sqrt((u - px) * (u - px) + (v - py) * (v - py)) * g;
          var dot = 1 - r * 2.2;
          if (dot > best) best = dot;
        }
      }
      return S.clamp(best, 0, 1);
    } },
    { id: 'splatter', label: 'Splatter', build: function (u, v) {
      // thrown blobs of very different sizes, with a few strays
      var total = 0;
      for (var g = 3; g <= 9; g += 3) {
        var cx = Math.floor(u * g), cy = Math.floor(v * g);
        for (var oy = -1; oy <= 1; oy++) {
          for (var ox = -1; ox <= 1; ox++) {
            var gx = cx + ox, gy = cy + oy;
            if (gridHash(gx, gy, g, 139 + g) < 0.6) continue;
            var px = (gx + gridHash(gx, gy, g, 149)) / g;
            var py = (gy + gridHash(gx, gy, g, 151)) / g;
            // no bigger than a cell, or a blob reaches past the cells that
            // are checked and gets clipped — a seam, once tiled
            var size = (0.12 + gridHash(gx, gy, g, 157) * 0.42) / g;
            var r = Math.sqrt((u - px) * (u - px) + (v - py) * (v - py));
            total = Math.max(total, S.clamp((size - r) / size * 1.6, 0, 1));
          }
        }
      }
      return total;
    } },
    { id: 'stripes', label: 'Stripes', build: function (u, v) {
      // straight bands: panel lines, ribs, seams
      var band = Math.abs(Math.sin(v * Math.PI * 8));
      return S.clamp((band - 0.45) * 3, 0, 1);
    } },
    { id: 'wood', label: 'Wood', build: function (u, v) {
      // growth rings stretched along the grain
      var warp = fbm(u * 2, v * 6, 19, 3, 0.5, 2, 6) * 0.6;
      var rings = Math.abs(Math.sin((v * 5 + warp) * Math.PI * 2));
      var fibre = fbm(u * 3, v * 40, 29, 2, 0.5, 3, 40) * 0.25;
      return S.clamp(rings * 0.85 + fibre - 0.15, 0, 1);
    } },

    /* ---- made things: patterns with an order to them --------------- */
    { id: 'brick', label: 'Bricks', build: function (u, v) {
      // courses of bricks with mortar between, every other row offset
      var rows = 6;
      var y = v * rows;
      var row = Math.floor(y);
      var x = u * 3 + (row % 2 ? 0.5 : 0);
      var fx = x - Math.floor(x), fy = y - row;
      var mortar = 0.08;
      var inX = Math.min(fx, 1 - fx), inY = Math.min(fy, 1 - fy);
      var d = Math.min(inX, inY * 1.4);
      return S.clamp((d - mortar) * 14, 0, 1);
    } },
    { id: 'hex', label: 'Hexes', build: function (u, v) {
      // 0.5 is a hexagon's flat side, so filling to 0.43 leaves a gap
      var d = hexDist(u, v, 4, 2);
      return S.clamp((0.43 - d) * 11, 0, 1);
    } },
    { id: 'scales', label: 'Scales', build: function (u, v) {
      /*
       * Overlapping round scales, offset row by row. Each scale hangs over
       * the row below it, so both rows are checked — otherwise the overhang
       * is cut off at the row boundary, and at the edge of the pattern that
       * cut becomes a seam.
       */
      var rows = 8, cols = 5;
      var y = v * rows;
      var best = 0;
      for (var dr = -1; dr <= 0; dr++) {
        var row = Math.floor(y) + dr;
        var x = u * cols + (((row % 2) + 2) % 2 ? 0.5 : 0);
        var fx = x - Math.floor(x) - 0.5, fy = y - row;
        var r = Math.sqrt(fx * fx * 1.6 + (fy - 0.15) * (fy - 0.15) * 1.1);
        var scale = (0.62 - r) * 3.4;
        if (scale > best) best = scale;
      }
      return S.clamp(best, 0, 1);
    } },
    { id: 'grille', label: 'Grille', build: function (u, v) {
      // a punched plate: round holes on a square grid
      var g = 7;
      var fx = u * g - Math.floor(u * g) - 0.5;
      var fy = v * g - Math.floor(v * g) - 0.5;
      var r = Math.sqrt(fx * fx + fy * fy);
      return S.clamp((0.33 - r) * 8, 0, 1);
    } },

    /* ---- single stamps: one mark per press ------------------------- */
    { id: 'ring', label: 'Ring', build: function (u, v) {
      var dx = (u - 0.5) * 2, dy = (v - 0.5) * 2;
      var r = Math.sqrt(dx * dx + dy * dy);
      return S.clamp(1 - Math.abs(r - 0.6) * 8, 0, 1);
    } },
    { id: 'star', label: 'Star', build: function (u, v) {
      var dx = (u - 0.5) * 2, dy = (v - 0.5) * 2;
      var r = Math.sqrt(dx * dx + dy * dy);
      if (r > 0.95) return 0;
      /*
       * A five-pointed star has straight sides, so the test is against the
       * line from one point to the next inner corner rather than against a
       * radius: a radius that varies with the angle bulges outwards and
       * comes out looking like a flower.
       */
      var points = 5, OUT = 0.92, IN = 0.4;
      var step = Math.PI * 2 / points;
      var a = Math.atan2(dy, dx) + Math.PI * 0.5;
      var t = ((a % step) + step) % step;
      if (t > step * 0.5) t = step - t;           // fold into half a spoke
      var p0x = OUT, p0y = 0;
      var p1x = IN * Math.cos(step * 0.5), p1y = IN * Math.sin(step * 0.5);
      var ex = p1x - p0x, ey = p1y - p0y;
      var len = Math.sqrt(ex * ex + ey * ey);
      var nx = ey / len, ny = -ex / len;          // outward normal of that edge
      var px = r * Math.cos(t), py = r * Math.sin(t);
      var away = (px - p0x) * nx + (py - p0y) * ny;
      return S.clamp(-away * 9, 0, 1);
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
    /*
     * The border is *not* faded into the data, although a stamp does need
     * one: fading it here would print a grid of gaps when the stencil is
     * read as a texture, tile after tile, across a surface. The fade
     * belongs to the reading, and `Alpha.sample` does it.
     */
    cache[id] = Alpha.make(id, gen.label, SIZE, data);
    return cache[id];
  };

  Alpha.BUILTIN_IDS = GENERATORS.map(function (g) { return g.id; });
  Alpha.builtinLabel = function (id) {
    for (var i = 0; i < GENERATORS.length; i++) if (GENERATORS[i].id === id) return GENERATORS[i].label;
    return id;
  };

  /**
   * Where to read a tiled stencil for a point on the surface.
   *
   * This is what makes a stencil behave like a texture rather than a rubber
   * stamp. Read in the brush's own frame, a pattern is printed afresh under
   * every dab, and since a stroke lays several dabs per brush width the
   * pattern piles up on itself and comes out as a solid smudge — which is
   * exactly what "it's just a normal drawing brush" looked like. Read from
   * the surface, every dab lays the same pattern in the same place, so
   * scrubbing builds it up instead of wiping it out.
   *
   * The two coordinates come from the box face the surface points at, so
   * neighbouring triangles agree, and `tile` is how much of the model one
   * repeat of the pattern covers.
   */
  Alpha.surfaceUV = function (x, y, z, nx, ny, nz, tile, out) {
    var T = S.Texture;
    T.projectFace(T.axisOf(nx, ny, nz), x, y, z, out);
    var inv = 1 / (tile > 1e-9 ? tile : 1e-9);
    out[0] *= inv;
    out[1] *= inv;
    return out;
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
  /**
   * One bilinear read.
   *
   * Texel centres sit at (i + 0.5) / size, which is where the built-ins are
   * generated and where an imported image's pixels are. Treating them as
   * sitting at i / (size - 1) instead — the obvious-looking alternative —
   * shifts every read half a texel and, worse, makes the first and last
   * texel land on the same place when the image is tiled, which prints a
   * doubled line along every seam.
   *
   * `wrap` is for tiled reads: the texels either side of the seam are then
   * neighbours, as they have to be for a pattern to meet itself.
   */
  function read(alpha, u, v, wrap) {
    var n = alpha.size;
    var x = u * n - 0.5, y = v * n - 0.5;
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var fx = x - x0, fy = y - y0;
    var x1 = x0 + 1, y1 = y0 + 1;
    if (wrap) {
      x0 = ((x0 % n) + n) % n; x1 = ((x1 % n) + n) % n;
      y0 = ((y0 % n) + n) % n; y1 = ((y1 % n) + n) % n;
    } else {
      if (x0 < 0) x0 = 0; else if (x0 > n - 1) x0 = n - 1;
      if (x1 < 0) x1 = 0; else if (x1 > n - 1) x1 = n - 1;
      if (y0 < 0) y0 = 0; else if (y0 > n - 1) y0 = n - 1;
      if (y1 < 0) y1 = 0; else if (y1 > n - 1) y1 = n - 1;
    }
    var d = alpha.data;
    var a = d[y0 * n + x0], b = d[y0 * n + x1];
    var c = d[y1 * n + x0], e = d[y1 * n + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
  }

  var FADE = 0.06;                    // how much of a stamp's edge fades out

  /**
   * Read the stencil as a single stamp: outside it there is nothing, and the
   * outer edge fades, so a dab never leaves a hard rectangle behind.
   */
  Alpha.sample = function (alpha, u, v) {
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    var value = read(alpha, u, v);
    var edge = Math.min(u, v, 1 - u, 1 - v);
    if (edge < FADE) value *= edge / FADE;
    return value;
  };

  /**
   * Read the stencil as a texture: it repeats for ever in both directions
   * and has no edge, which is what lets a pattern stay put on the surface
   * while a stroke scrubs over it again and again.
   */
  Alpha.sampleTiled = function (alpha, u, v) {
    return read(alpha, u - Math.floor(u), v - Math.floor(v), true);
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
