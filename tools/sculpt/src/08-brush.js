/*
 * SculptFree — brushes and the stroke engine.
 *
 * A stroke is a sequence of stamps laid along the path the pointer traces
 * over the surface, spaced by a fraction of the brush radius so the result
 * does not depend on how fast the pointer moved. Every stamp:
 *
 *   1. finds the vertices inside the brush sphere,
 *   2. computes a falloff weight per vertex,
 *   3. optionally refines or coarsens the topology there (dyntopo),
 *   4. applies the brush, then auto-smooths if asked,
 *   5. updates normals, the spatial grid and the dirty range for upload.
 *
 * Brush radius is specified in screen pixels, like every other sculpting
 * app, and converted to local units per stamp — so a brush covers the same
 * part of the screen whether you are zoomed in on an ear or out at the whole
 * figure, and it behaves the same on a scaled object.
 *
 * This module is DOM-free: the stroke engine is handed a camera-like object
 * with rayFromScreen() and worldPerPixel(), so it can be driven by tests.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var V3 = S.V3;

  /** How steeply a surface must turn away before the brush fades out. */
  var RIM_FADE = 0.4;

  /* ================================================================ *
   * falloff curves
   * ================================================================ */

  S.FALLOFFS = [
    { id: 'smooth', label: 'Smooth', fn: function (t) { return t * t * t * (t * (t * 6 - 15) + 10); } },
    { id: 'soft', label: 'Soft', fn: function (t) { return t * t * (3 - 2 * t); } },
    { id: 'sharp', label: 'Sharp', fn: function (t) { return t * t * t; } },
    { id: 'linear', label: 'Linear', fn: function (t) { return t; } },
    { id: 'sphere', label: 'Sphere', fn: function (t) { var u = 1 - t; return Math.sqrt(1 - u * u); } },
    { id: 'constant', label: 'Constant', fn: function (t) { return t > 0 ? 1 : 0; } }
  ];

  S.falloffById = function (id) {
    for (var i = 0; i < S.FALLOFFS.length; i++) if (S.FALLOFFS[i].id === id) return S.FALLOFFS[i];
    return S.FALLOFFS[0];
  };

  /* ================================================================ *
   * brush context
   *
   * One of these is filled per stamp and handed to the brush function.
   * Scratch buffers live on it so a stroke allocates nothing.
   * ================================================================ */

  function BrushContext() {
    this.mesh = null;
    this.obj = null;
    this.history = null;
    this.center = V3.create(0, 0, 0);     // local space
    this.normal = V3.create(0, 1, 0);     // local space, surface normal at the stamp
    this.dir = V3.create(0, 0, 0);        // local-space stroke direction
    this.delta = V3.create(0, 0, 0);      // local-space pointer delta (grab brushes)
    this.planePoint = V3.create(0, 0, 0);
    this.planeNormal = V3.create(0, 1, 0);
    this.radius = 1;
    this.strength = 0.5;
    this.invert = false;
    this.falloff = S.FALLOFFS[0].fn;
    this.color = V3.create(0.8, 0.2, 0.2);
    this.verts = null;
    this.count = 0;
    this.weights = new Float32Array(1024);
    this.origin = null;                   // Map v -> [x,y,z] for layer/grab
    this.pressure = 1;
    this.frontFacing = true;
    this.autoSmooth = 0;
    this.clay = 0.2;
  }

  BrushContext.prototype.ensureWeights = function (n) {
    if (this.weights.length < n) this.weights = new Float32Array(S.nextPow2(n));
    return this.weights;
  };

  S.BrushContext = BrushContext;

  /**
   * Weights from the radial falloff, the mask and (optionally) how much the
   * vertex faces the brush. Returns the number of vertices with weight > 0.
   */
  function computeWeights(ctx) {
    var mesh = ctx.mesh, verts = ctx.verts, n = ctx.count;
    var w = ctx.ensureWeights(n);
    var pos = mesh.positions.array, nor = mesh.normals.array, msk = mesh.masks.array;
    var cx = ctx.center[0], cy = ctx.center[1], cz = ctx.center[2];
    var inv = 1 / (ctx.radius || 1e-9);
    var nx = ctx.normal[0], ny = ctx.normal[1], nz = ctx.normal[2];
    var falloff = ctx.falloff;
    var front = ctx.frontFacing;
    for (var i = 0; i < n; i++) {
      var v = verts[i], o = v * 3;
      var dx = pos[o] - cx, dy = pos[o + 1] - cy, dz = pos[o + 2] - cz;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz) * inv;
      if (d >= 1) { w[i] = 0; continue; }
      var f = falloff(1 - d);
      if (front) {
        var dot = nor[o] * nx + nor[o + 1] * ny + nor[o + 2] * nz;
        if (dot <= 0) { w[i] = 0; continue; }
        // Fade only near the silhouette. Scaling by the dot product across
        // the whole footprint feeds back on itself: a vertex that bulges
        // towards the brush would then receive more displacement on the next
        // stamp than its neighbours, and the surface grows spikes.
        if (dot < RIM_FADE) f *= S.smoothstep(dot / RIM_FADE);
      }
      w[i] = f * (1 - msk[v]);
    }
    return w;
  }
  S.computeWeights = computeWeights;

  /**
   * Weighted average position and normal of the vertices under the brush —
   * the "area plane" the clay, flatten, fill and scrape brushes work against.
   */
  function areaPlane(ctx) {
    var mesh = ctx.mesh, verts = ctx.verts, n = ctx.count, w = ctx.weights;
    var pos = mesh.positions.array, nor = mesh.normals.array;
    var px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0, total = 0;
    for (var i = 0; i < n; i++) {
      var f = w[i];
      if (f <= 0) continue;
      var o = verts[i] * 3;
      px += pos[o] * f; py += pos[o + 1] * f; pz += pos[o + 2] * f;
      nx += nor[o] * f; ny += nor[o + 1] * f; nz += nor[o + 2] * f;
      total += f;
    }
    if (total <= 1e-12) {
      V3.copy(ctx.planePoint, ctx.center);
      V3.copy(ctx.planeNormal, ctx.normal);
      return false;
    }
    V3.set(ctx.planePoint, px / total, py / total, pz / total);
    var l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l > 1e-12) V3.set(ctx.planeNormal, nx / l, ny / l, nz / l);
    else V3.copy(ctx.planeNormal, ctx.normal);
    return true;
  }
  S.areaPlane = areaPlane;

  /* ================================================================ *
   * brush implementations
   *
   * Each receives the filled context and moves vertices. `disp` scales all
   * displacement brushes to a common feel: a full-strength stamp moves the
   * surface by about a fifth of the brush radius.
   * ================================================================ */

  function sgn(ctx) { return ctx.invert ? -1 : 1; }

  function eachVert(ctx, fn) {
    var verts = ctx.verts, n = ctx.count, w = ctx.weights, mesh = ctx.mesh;
    var pos = mesh.positions.array;
    for (var i = 0; i < n; i++) {
      var f = w[i];
      if (f <= 0) continue;
      var v = verts[i], o = v * 3;
      fn(v, o, f, pos);
      mesh.markVertDirty(v);
    }
    mesh._boundsDirty = true;
  }

  var BrushFns = {};

  BrushFns.draw = function (ctx) {
    areaPlane(ctx);
    var amount = ctx.strength * ctx.radius * 0.2 * sgn(ctx);
    var nx = ctx.planeNormal[0], ny = ctx.planeNormal[1], nz = ctx.planeNormal[2];
    eachVert(ctx, function (v, o, f, pos) {
      pos[o] += nx * amount * f;
      pos[o + 1] += ny * amount * f;
      pos[o + 2] += nz * amount * f;
    });
  };

  BrushFns.clay = function (ctx) {
    areaPlane(ctx);
    var s = sgn(ctx);
    var offset = ctx.radius * ctx.clay * s;
    var px = ctx.planePoint[0] + ctx.planeNormal[0] * offset;
    var py = ctx.planePoint[1] + ctx.planeNormal[1] * offset;
    var pz = ctx.planePoint[2] + ctx.planeNormal[2] * offset;
    var nx = ctx.planeNormal[0], ny = ctx.planeNormal[1], nz = ctx.planeNormal[2];
    var strength = ctx.strength;
    eachVert(ctx, function (v, o, f, pos) {
      var d = (pos[o] - px) * nx + (pos[o + 1] - py) * ny + (pos[o + 2] - pz) * nz;
      // only fill towards the offset plane, so clay builds up instead of
      // dragging the whole surface with it
      if (s > 0 ? d >= 0 : d <= 0) return;
      var move = -d * strength * f;
      pos[o] += nx * move;
      pos[o + 1] += ny * move;
      pos[o + 2] += nz * move;
    });
  };

  /** Clay with a rectangular kernel aligned to the stroke — clay strips. */
  BrushFns.clayStrips = function (ctx) {
    areaPlane(ctx);
    var mesh = ctx.mesh, verts = ctx.verts, n = ctx.count, w = ctx.weights;
    var pos = mesh.positions.array;
    var s = sgn(ctx);
    // build a frame: normal, stroke direction, side
    var nrm = ctx.planeNormal;
    var fwd = V3.create(ctx.dir[0], ctx.dir[1], ctx.dir[2]);
    if (V3.lenSq(fwd) < 1e-12) V3.perpendicular(fwd, nrm);
    else {
      var d = V3.dot(fwd, nrm);
      V3.set(fwd, fwd[0] - nrm[0] * d, fwd[1] - nrm[1] * d, fwd[2] - nrm[2] * d);
      if (V3.lenSq(fwd) < 1e-12) V3.perpendicular(fwd, nrm); else V3.normalize(fwd, fwd);
    }
    var side = V3.cross(V3.create(0, 0, 0), nrm, fwd);
    V3.normalize(side, side);
    var offset = ctx.radius * ctx.clay * 1.1 * s;
    var px = ctx.planePoint[0] + nrm[0] * offset;
    var py = ctx.planePoint[1] + nrm[1] * offset;
    var pz = ctx.planePoint[2] + nrm[2] * offset;
    var inv = 1 / (ctx.radius || 1e-9);
    var strength = ctx.strength;
    for (var i = 0; i < n; i++) {
      var f = w[i];
      if (f <= 0) continue;
      var v = verts[i], o = v * 3;
      var rx = pos[o] - ctx.center[0], ry = pos[o + 1] - ctx.center[1], rz = pos[o + 2] - ctx.center[2];
      var a = Math.abs(rx * fwd[0] + ry * fwd[1] + rz * fwd[2]) * inv;
      var b = Math.abs(rx * side[0] + ry * side[1] + rz * side[2]) * inv;
      var box = 1 - Math.max(a, b * 1.35);
      if (box <= 0) continue;
      var weight = ctx.falloff(S.clamp(box * 1.6, 0, 1)) * (1 - mesh.masks.array[v]);
      var dist = (pos[o] - px) * nrm[0] + (pos[o + 1] - py) * nrm[1] + (pos[o + 2] - pz) * nrm[2];
      if (s > 0 ? dist >= 0 : dist <= 0) continue;
      var move = -dist * strength * weight;
      pos[o] += nrm[0] * move;
      pos[o + 1] += nrm[1] * move;
      pos[o + 2] += nrm[2] * move;
      mesh.markVertDirty(v);
    }
    mesh._boundsDirty = true;
  };

  BrushFns.inflate = function (ctx) {
    var amount = ctx.strength * ctx.radius * 0.18 * sgn(ctx);
    var nor = ctx.mesh.normals.array;
    eachVert(ctx, function (v, o, f, pos) {
      pos[o] += nor[o] * amount * f;
      pos[o + 1] += nor[o + 1] * amount * f;
      pos[o + 2] += nor[o + 2] * amount * f;
    });
  };

  BrushFns.blob = function (ctx) {
    var amount = ctx.strength * ctx.radius * 0.22 * sgn(ctx);
    var cx = ctx.center[0], cy = ctx.center[1], cz = ctx.center[2];
    eachVert(ctx, function (v, o, f, pos) {
      var dx = pos[o] - cx, dy = pos[o + 1] - cy, dz = pos[o + 2] - cz;
      var l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l < 1e-12) return;
      var k = amount * f / l;
      pos[o] += dx * k; pos[o + 1] += dy * k; pos[o + 2] += dz * k;
    });
  };

  function planeBrush(ctx, mode) {
    areaPlane(ctx);
    var px = ctx.planePoint[0], py = ctx.planePoint[1], pz = ctx.planePoint[2];
    var nx = ctx.planeNormal[0], ny = ctx.planeNormal[1], nz = ctx.planeNormal[2];
    // the invert modifier lifts the plane away from / into the surface
    var bias = ctx.invert ? -ctx.radius * 0.08 : 0;
    px += nx * bias; py += ny * bias; pz += nz * bias;
    var strength = ctx.strength;
    eachVert(ctx, function (v, o, f, pos) {
      var d = (pos[o] - px) * nx + (pos[o + 1] - py) * ny + (pos[o + 2] - pz) * nz;
      if (mode === 'fill' && d >= 0) return;
      if (mode === 'scrape' && d <= 0) return;
      var move = -d * strength * f;
      pos[o] += nx * move; pos[o + 1] += ny * move; pos[o + 2] += nz * move;
    });
  }

  BrushFns.flatten = function (ctx) { planeBrush(ctx, 'flatten'); };
  BrushFns.fill = function (ctx) { planeBrush(ctx, 'fill'); };
  BrushFns.scrape = function (ctx) { planeBrush(ctx, 'scrape'); };

  BrushFns.smooth = function (ctx) {
    var mesh = ctx.mesh;
    // relax along the surface so smoothing does not eat volume
    mesh.smoothVerts(ctx.verts, ctx.count, ctx.strength * 0.9, !ctx.invert, ctx.weights);
  };

  BrushFns.pinch = function (ctx) {
    var s = sgn(ctx);
    var cx = ctx.center[0], cy = ctx.center[1], cz = ctx.center[2];
    var nx = ctx.normal[0], ny = ctx.normal[1], nz = ctx.normal[2];
    var strength = ctx.strength * 0.6 * s;
    eachVert(ctx, function (v, o, f, pos) {
      var dx = pos[o] - cx, dy = pos[o + 1] - cy, dz = pos[o + 2] - cz;
      var along = dx * nx + dy * ny + dz * nz;
      var rx = dx - nx * along, ry = dy - ny * along, rz = dz - nz * along;
      pos[o] -= rx * strength * f;
      pos[o + 1] -= ry * strength * f;
      pos[o + 2] -= rz * strength * f;
    });
  };

  BrushFns.crease = function (ctx) {
    areaPlane(ctx);
    var s = sgn(ctx);
    var cx = ctx.center[0], cy = ctx.center[1], cz = ctx.center[2];
    var nx = ctx.planeNormal[0], ny = ctx.planeNormal[1], nz = ctx.planeNormal[2];
    var pinch = ctx.strength * 0.7;
    var push = ctx.strength * ctx.radius * 0.16 * s;
    eachVert(ctx, function (v, o, f, pos) {
      var dx = pos[o] - cx, dy = pos[o + 1] - cy, dz = pos[o + 2] - cz;
      var along = dx * nx + dy * ny + dz * nz;
      var rx = dx - nx * along, ry = dy - ny * along, rz = dz - nz * along;
      pos[o] += -rx * pinch * f - nx * push * f;
      pos[o + 1] += -ry * pinch * f - ny * push * f;
      pos[o + 2] += -rz * pinch * f - nz * push * f;
    });
  };

  /** Constant-height displacement from the surface as it was at stroke start. */
  BrushFns.layer = function (ctx) {
    areaPlane(ctx);
    var s = sgn(ctx);
    var height = ctx.strength * ctx.radius * 0.25 * s;
    var nx = ctx.planeNormal[0], ny = ctx.planeNormal[1], nz = ctx.planeNormal[2];
    var origin = ctx.origin;
    if (!origin) return BrushFns.draw(ctx);
    eachVert(ctx, function (v, o, f, pos) {
      var base = origin.get(v);
      if (!base) {
        base = [pos[o], pos[o + 1], pos[o + 2], 0];
        origin.set(v, base);
      }
      var target = Math.max(base[3], f);        // the layer only ever rises
      base[3] = target;
      pos[o] = base[0] + nx * height * target;
      pos[o + 1] = base[1] + ny * height * target;
      pos[o + 2] = base[2] + nz * height * target;
    });
  };

  /** Grab: drag the captured vertices with the pointer. */
  BrushFns.move = function (ctx) {
    var dx = ctx.delta[0], dy = ctx.delta[1], dz = ctx.delta[2];
    if (dx === 0 && dy === 0 && dz === 0) return;
    var origin = ctx.origin;
    eachVert(ctx, function (v, o, f, pos) {
      var base = origin && origin.get(v);
      if (base) {
        pos[o] = base[0] + dx * f;
        pos[o + 1] = base[1] + dy * f;
        pos[o + 2] = base[2] + dz * f;
      } else {
        pos[o] += dx * f;
        pos[o + 1] += dy * f;
        pos[o + 2] += dz * f;
      }
    });
  };

  /** Nudge: push the surface along the stroke direction. */
  BrushFns.nudge = function (ctx) {
    var amount = ctx.strength * ctx.radius * 0.35;
    var dx = ctx.dir[0] * amount, dy = ctx.dir[1] * amount, dz = ctx.dir[2] * amount;
    eachVert(ctx, function (v, o, f, pos) {
      pos[o] += dx * f; pos[o + 1] += dy * f; pos[o + 2] += dz * f;
    });
  };

  /**
   * Snake hook: pull the surface out and along with the pointer.
   *
   * The brush sphere travels with the cursor, so a plain radial falloff lets
   * the sphere outrun the geometry and the horn comes out stubby. Flattening
   * the weight over the middle of the brush keeps the tip moving with the
   * cursor while the rim still tapers.
   */
  BrushFns.snakeHook = function (ctx) {
    var dx = ctx.delta[0], dy = ctx.delta[1], dz = ctx.delta[2];
    var pull = ctx.strength;
    var grow = ctx.strength * ctx.radius * 0.06 * (ctx.invert ? -1 : 1);
    var nx = ctx.normal[0], ny = ctx.normal[1], nz = ctx.normal[2];
    eachVert(ctx, function (v, o, f, pos) {
      var w = f * 1.7;
      if (w > 1) w = 1;
      pos[o] += dx * w * pull + nx * grow * f;
      pos[o + 1] += dy * w * pull + ny * grow * f;
      pos[o + 2] += dz * w * pull + nz * grow * f;
    });
  };

  /** Rotate the vertices under the brush around its normal. */
  BrushFns.rotate = function (ctx) {
    var angle = ctx.rotateAngle || 0;
    if (!angle) return;
    var cx = ctx.center[0], cy = ctx.center[1], cz = ctx.center[2];
    var ax = ctx.normal[0], ay = ctx.normal[1], az = ctx.normal[2];
    var origin = ctx.origin;
    eachVert(ctx, function (v, o, f, pos) {
      var base = origin && origin.get(v);
      var x = base ? base[0] : pos[o];
      var y = base ? base[1] : pos[o + 1];
      var z = base ? base[2] : pos[o + 2];
      var a = angle * f;
      var c = Math.cos(a), s2 = Math.sin(a), t = 1 - c;
      var dx = x - cx, dy = y - cy, dz = z - cz;
      // Rodrigues rotation about the brush normal
      pos[o] = cx + dx * (t * ax * ax + c) + dy * (t * ax * ay - s2 * az) + dz * (t * ax * az + s2 * ay);
      pos[o + 1] = cy + dx * (t * ax * ay + s2 * az) + dy * (t * ay * ay + c) + dz * (t * ay * az - s2 * ax);
      pos[o + 2] = cz + dx * (t * ax * az - s2 * ay) + dy * (t * ay * az + s2 * ax) + dz * (t * az * az + c);
    });
  };

  BrushFns.paint = function (ctx) {
    var mesh = ctx.mesh, verts = ctx.verts, n = ctx.count, w = ctx.weights;
    var col = mesh.colors.array;
    var r = ctx.color[0], g = ctx.color[1], b = ctx.color[2];
    var strength = ctx.strength;
    for (var i = 0; i < n; i++) {
      var f = w[i] * strength;
      if (f <= 0) continue;
      if (f > 1) f = 1;
      var v = verts[i], o = v * 3;
      col[o] += (r - col[o]) * f;
      col[o + 1] += (g - col[o + 1]) * f;
      col[o + 2] += (b - col[o + 2]) * f;
      mesh.markVertDirty(v);
    }
  };

  BrushFns.mask = function (ctx) {
    var mesh = ctx.mesh, verts = ctx.verts, n = ctx.count;
    var msk = mesh.masks.array;
    var pos = mesh.positions.array, nor = mesh.normals.array;
    var cx = ctx.center[0], cy = ctx.center[1], cz = ctx.center[2];
    var inv = 1 / (ctx.radius || 1e-9);
    var s = ctx.invert ? -1 : 1;
    var strength = ctx.strength * 0.5;
    for (var i = 0; i < n; i++) {
      var v = verts[i], o = v * 3;
      var dx = pos[o] - cx, dy = pos[o + 1] - cy, dz = pos[o + 2] - cz;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz) * inv;
      if (d >= 1) continue;
      if (ctx.frontFacing) {
        var dot = nor[o] * ctx.normal[0] + nor[o + 1] * ctx.normal[1] + nor[o + 2] * ctx.normal[2];
        if (dot <= 0) continue;
      }
      // masking ignores the mask itself, otherwise it could never be undone
      var f = ctx.falloff(1 - d) * strength * s;
      msk[v] = S.clamp(msk[v] + f, 0, 1);
      mesh.markVertDirty(v);
    }
  };

  S.BrushFns = BrushFns;

  /* ================================================================ *
   * brush catalogue
   * ================================================================ */

  S.BRUSHES = [
    { id: 'clay', label: 'Clay', group: 'Add', key: '1', fn: BrushFns.clay,
      strength: 0.55, hint: 'Builds material up towards a plane — the general-purpose brush.' },
    { id: 'claystrips', label: 'Clay Strips', group: 'Add', key: '2', fn: BrushFns.clayStrips,
      strength: 0.6, hint: 'Clay with a square edge; good for blocking in forms.' },
    { id: 'draw', label: 'Draw', group: 'Add', key: '3', fn: BrushFns.draw,
      strength: 0.4, hint: 'Pushes the surface along its average normal.' },
    { id: 'inflate', label: 'Inflate', group: 'Add', key: '4', fn: BrushFns.inflate,
      strength: 0.4, hint: 'Pushes each vertex along its own normal — swells volume.' },
    { id: 'blob', label: 'Blob', group: 'Add', key: '5', fn: BrushFns.blob,
      strength: 0.45, hint: 'Pushes outwards from the brush centre.' },
    { id: 'crease', label: 'Crease', group: 'Add', key: '6', fn: BrushFns.crease,
      strength: 0.5, hint: 'Pinches and pushes in — cuts sharp folds and seams.' },
    { id: 'layer', label: 'Layer', group: 'Add', key: '7', fn: BrushFns.layer,
      strength: 0.5, hint: 'Raises a plateau of even height, never higher than once.' },

    { id: 'smooth', label: 'Smooth', group: 'Refine', key: 'S', fn: BrushFns.smooth,
      strength: 0.5, hint: 'Relaxes the surface along itself. Hold Shift with any brush.' },
    { id: 'flatten', label: 'Flatten', group: 'Refine', key: '8', fn: BrushFns.flatten,
      strength: 0.5, hint: 'Pulls everything onto the average plane.' },
    { id: 'fill', label: 'Fill', group: 'Refine', key: '9', fn: BrushFns.fill,
      strength: 0.5, hint: 'Raises only what sits below the average plane.' },
    { id: 'scrape', label: 'Scrape', group: 'Refine', key: '0', fn: BrushFns.scrape,
      strength: 0.5, hint: 'Shaves off only what sits above the average plane.' },
    { id: 'pinch', label: 'Pinch', group: 'Refine', key: 'P', fn: BrushFns.pinch,
      strength: 0.45, hint: 'Draws vertices towards the brush centre — tightens edges.' },

    { id: 'move', label: 'Move', group: 'Move', key: 'G', fn: BrushFns.move, grab: true,
      strength: 1, hint: 'Drags the vertices under the brush with the pointer.' },
    { id: 'snakehook', label: 'Snake Hook', group: 'Move', key: 'H', fn: BrushFns.snakeHook, grab: true, follow: true,
      strength: 0.9, hint: 'Pulls out horns, limbs and tentacles as you drag.' },
    { id: 'nudge', label: 'Nudge', group: 'Move', key: 'N', fn: BrushFns.nudge,
      strength: 0.5, hint: 'Pushes the surface sideways along the stroke.' },
    { id: 'rotate', label: 'Rotate', group: 'Move', key: 'R', fn: BrushFns.rotate, grab: true, rotate: true,
      strength: 1, hint: 'Twists the surface around the brush normal.' },

    { id: 'paint', label: 'Paint', group: 'Colour', key: 'C', fn: BrushFns.paint, paint: true,
      strength: 0.6, hint: 'Paints vertex colour. Exports with PLY, GLB and OBJ.' },
    { id: 'mask', label: 'Mask', group: 'Colour', key: 'M', fn: BrushFns.mask, mask: true,
      strength: 0.8, hint: 'Locks the surface against every other brush. Ctrl to erase.' }
  ];

  S.brushById = function (id) {
    for (var i = 0; i < S.BRUSHES.length; i++) if (S.BRUSHES[i].id === id) return S.BRUSHES[i];
    return S.BRUSHES[0];
  };

  /* ================================================================ *
   * stroke engine
   * ================================================================ */

  /**
   * `deps` needs:
   *   scene     an S.Scene
   *   history   an S.History
   *   settings  the live tool settings object
   *   camera    { rayFromScreen(x, y, outOrigin, outDir), worldPerPixel(point) }
   */
  function StrokeEngine(deps) {
    this.scene = deps.scene;
    this.history = deps.history;
    this.settings = deps.settings;
    this.camera = deps.camera;
    this.ctx = new BrushContext();
    this.active = false;
    this.brush = null;
    this.obj = null;

    this._o = V3.create(0, 0, 0);
    this._d = V3.create(0, 0, 0);
    this._lp = V3.create(0, 0, 0);
    this._ld = V3.create(0, 0, 0);
    this._tmp = V3.create(0, 0, 0);
    this._tmp2 = V3.create(0, 0, 0);
    this._prevLocal = V3.create(0, 0, 0);
    this._prevWorld = V3.create(0, 0, 0);
    this._anchorWorld = V3.create(0, 0, 0);
    this._anchorLocal = V3.create(0, 0, 0);
    this._anchorNormal = V3.create(0, 1, 0);
    this._screen = [0, 0];
    this._prevScreen = [0, 0];
    this._smoothScreen = [0, 0];
    this.stamps = 0;
    this.lastStats = null;
  }
  S.StrokeEngine = StrokeEngine;

  /** Where the pointer is over the surface, or null. */
  StrokeEngine.prototype.pick = function (sx, sy, onlySelected) {
    this.camera.rayFromScreen(sx, sy, this._o, this._d);
    return this.scene.raycast(this._o, this._d, onlySelected !== false);
  };

  /**
   * Begin a stroke. `input` is
   * {x, y, pressure, invert, smooth, symmetry}. Returns true if it started.
   */
  StrokeEngine.prototype.begin = function (input) {
    var st = this.settings;
    var brush = S.brushById(input.smooth ? 'smooth' : st.brush);
    var hit = this.pick(input.x, input.y, true);
    if (!hit) {
      // grab-style brushes need a surface to anchor to; everything else too
      return false;
    }
    this.active = true;
    this.brush = brush;
    this.obj = hit.object;
    this.stamps = 0;
    this.strokeInvert = !!input.invert;
    this.strokeSmooth = !!input.smooth;
    this.pressure = input.pressure === undefined ? 1 : input.pressure;

    V3.copy(this._anchorWorld, hit.point);
    V3.copy(this._anchorLocal, hit.localPoint);
    V3.copy(this._anchorNormal, hit.localNormal);
    V3.copy(this._prevLocal, hit.localPoint);
    V3.copy(this._prevWorld, hit.point);
    this._screen[0] = this._prevScreen[0] = this._smoothScreen[0] = input.x;
    this._screen[1] = this._prevScreen[1] = this._smoothScreen[1] = input.y;
    this.pendingDistance = 0;

    var topo = this.usesDyntopo();
    this.history.beginStroke(this.obj, {
      label: brush.label,
      topology: topo,
      colors: !!brush.paint,
      masks: !!brush.mask
    });

    this.ctx.origin = (brush.grab || brush.id === 'layer') ? new Map() : null;
    this.grabVerts = null;

    // grab brushes capture their vertex set once, so the same material moves
    // for the whole stroke instead of picking up new vertices as it goes
    if (brush.grab && !brush.follow) {
      this.captureGrabSet();
    }
    this.stampAt(this._anchorLocal, this._anchorNormal, true);
    return true;
  };

  StrokeEngine.prototype.usesDyntopo = function () {
    var st = this.settings;
    if (!st.dyntopo) return false;
    var b = S.brushById(this.settings.brush);
    if (b.paint || b.mask) return false;
    return true;
  };

  StrokeEngine.prototype.localRadius = function (worldPoint) {
    var st = this.settings;
    var perPixel = this.camera.worldPerPixel(worldPoint);
    var px = st.radius * (st.pressureRadius ? S.lerp(0.35, 1, this.pressure) : 1);
    var world = px * perPixel;
    return world / this.obj.uniformScale();
  };

  StrokeEngine.prototype.captureGrabSet = function () {
    var mesh = this.obj.mesh;
    var r = this.localRadius(this._anchorWorld);
    var verts = mesh.vertsInSphere(this._anchorLocal[0], this._anchorLocal[1], this._anchorLocal[2], r);
    this.grabVerts = Uint32Array.from(verts);
    this.grabRadius = r;
    var origin = this.ctx.origin;
    var pos = mesh.positions.array;
    for (var i = 0; i < this.grabVerts.length; i++) {
      var v = this.grabVerts[i], o = v * 3;
      origin.set(v, [pos[o], pos[o + 1], pos[o + 2], 0]);
    }
  };

  /**
   * Lay one stamp. `local` is the brush centre in the object's local space.
   */
  StrokeEngine.prototype.stampAt = function (local, localNormal, first) {
    var st = this.settings;
    var mesh = this.obj.mesh;
    var brush = this.brush;
    var ctx = this.ctx;
    var worldPoint = this._tmp2;
    this.obj.localToWorldPoint(worldPoint, local);
    var radius = brush.grab && !brush.follow ? this.grabRadius : this.localRadius(worldPoint);

    var symmetry = [st.symmetryX, st.symmetryY, st.symmetryZ];
    var combos = [[1, 1, 1]];
    for (var axis = 0; axis < 3; axis++) {
      if (!symmetry[axis]) continue;
      var extra = [];
      for (var i = 0; i < combos.length; i++) {
        var c = combos[i].slice();
        c[axis] = -1;
        extra.push(c);
      }
      combos = combos.concat(extra);
    }

    var strengthScale = st.pressureStrength ? S.lerp(0.25, 1, this.pressure) : 1;
    // A stroke lays a stamp every `spacing * radius`, so without this the
    // total displacement would scale with the number of stamps: halving the
    // spacing would double how deep the stroke cuts, and stretch the
    // triangles into slivers. Normalising against the default spacing keeps
    // spacing a quality control rather than a strength control.
    strengthScale *= S.clamp((st.spacing === undefined ? 0.16 : st.spacing) / 0.16, 0.3, 2.5);
    var total = 0;

    for (var ci = 0; ci < combos.length; ci++) {
      var m = combos[ci];
      var cx = local[0] * m[0], cy = local[1] * m[1], cz = local[2] * m[2];

      if (this.usesDyntopo() && !(brush.grab && !brush.follow)) {
        var detail = st.detailMode === 'constant'
          ? st.detailSize
          : radius * S.clamp(st.detailPercent / 100, 0.02, 1);
        detail = Math.max(detail, 1e-6);
        mesh.dyntopo(cx, cy, cz, radius, detail, st.maxTriangles);
      }

      var verts;
      if (brush.grab && !brush.follow) {
        verts = this.grabVerts;
        // mirrored copies need their own vertex sets
        if (ci > 0) verts = Uint32Array.from(mesh.vertsInSphere(cx, cy, cz, radius));
        ctx.count = verts.length;
      } else {
        verts = mesh.vertsInSphere(cx, cy, cz, radius);
        ctx.count = verts.length;
      }
      if (!ctx.count) continue;

      ctx.mesh = mesh;
      ctx.obj = this.obj;
      ctx.verts = verts;
      ctx.radius = radius;
      ctx.strength = S.clamp(st.strength * strengthScale, 0, 4) * (this.strokeSmooth ? 1 : 1);
      ctx.invert = this.strokeInvert;
      ctx.falloff = S.falloffById(st.falloff).fn;
      ctx.frontFacing = st.frontFacing !== false && !brush.grab;
      ctx.clay = st.clayOffset === undefined ? 0.18 : st.clayOffset;
      ctx.pressure = this.pressure;
      V3.set(ctx.center, cx, cy, cz);
      V3.set(ctx.normal, localNormal[0] * m[0], localNormal[1] * m[1], localNormal[2] * m[2]);
      V3.normalize(ctx.normal, ctx.normal);
      V3.set(ctx.dir, this.strokeDir ? this.strokeDir[0] * m[0] : 0,
                      this.strokeDir ? this.strokeDir[1] * m[1] : 0,
                      this.strokeDir ? this.strokeDir[2] * m[2] : 0);
      V3.set(ctx.delta, this.strokeDelta ? this.strokeDelta[0] * m[0] : 0,
                        this.strokeDelta ? this.strokeDelta[1] * m[1] : 0,
                        this.strokeDelta ? this.strokeDelta[2] * m[2] : 0);
      ctx.rotateAngle = this.rotateAngle || 0;
      if (st.paintColor) V3.copy(ctx.color, st.paintColor);
      ctx.origin = this.ctx.origin;

      computeWeights(ctx);
      this.history.captureVerts(verts, ctx.count);
      brush.fn(ctx);

      var autoSmooth = brush.paint || brush.mask ? 0 : (st.autoSmooth || 0);
      if (autoSmooth > 0) {
        mesh.smoothVerts(verts, ctx.count, autoSmooth * 0.5, true, ctx.weights);
      }

      var arr = verts;
      mesh.computeNormals(arr, ctx.count);
      mesh.gridUpdateVerts(arr, ctx.count);
      total += ctx.count;
    }
    this.stamps++;
    this.lastStats = { verts: total, tris: mesh.liveTris };
    return total;
  };

  /**
   * Continue the stroke to a new pointer position. Walks the surface in
   * steps of `spacing * radius` so speed does not change the result.
   */
  StrokeEngine.prototype.move = function (input) {
    if (!this.active) return false;
    var st = this.settings;
    this.pressure = input.pressure === undefined ? 1 : input.pressure;

    // lazy-mouse style path smoothing
    var smoothing = S.clamp(st.strokeSmoothing || 0, 0, 0.95);
    this._smoothScreen[0] += (input.x - this._smoothScreen[0]) * (1 - smoothing);
    this._smoothScreen[1] += (input.y - this._smoothScreen[1]) * (1 - smoothing);
    var sx = this._smoothScreen[0], sy = this._smoothScreen[1];

    var brush = this.brush;
    var obj = this.obj;

    if (brush.grab) {
      // grab-type brushes follow the pointer through space rather than the
      // surface: project the screen motion onto the plane through the anchor
      var world = this._tmp;
      this.camera.rayFromScreen(sx, sy, this._o, this._d);
      var perPixel = this.camera.worldPerPixel(this._anchorWorld);
      if (brush.rotate) {
        var ax = sx - this._prevScreen[0], ay = sy - this._prevScreen[1];
        this.rotateAngle = (ax + ay) * 0.01 * (this.strokeInvert ? -1 : 1);
        this.strokeDelta = null;
        this.stampAt(this._anchorLocal, this._anchorNormal, false);
      } else {
        var dxs = (sx - this._prevScreen[0]) * perPixel;
        var dys = -(sy - this._prevScreen[1]) * perPixel;
        var right = this.camera.right ? this.camera.right() : V3.AXIS_X;
        var up = this.camera.up ? this.camera.up() : V3.AXIS_Y;
        V3.set(world, right[0] * dxs + up[0] * dys, right[1] * dxs + up[1] * dys, right[2] * dxs + up[2] * dys);
        // into local space (direction only, so scale is handled)
        V3.transformDir(this._ld, world, obj.inverseMatrix());
        if (brush.follow) {
          this.strokeDelta = this._ld;
          // snake hook drags the sphere along with the pointer
          V3.add(this._anchorLocal, this._anchorLocal, this._ld);
          obj.localToWorldPoint(this._anchorWorld, this._anchorLocal);
          V3.copy(this.strokeDir || (this.strokeDir = V3.create(0, 0, 0)), this._ld);
          V3.normalize(this.strokeDir, this.strokeDir);
          this.stampAt(this._anchorLocal, this._anchorNormal, false);
        } else {
          // accumulate so the grab total is absolute, not incremental
          if (!this.grabTotal) this.grabTotal = V3.create(0, 0, 0);
          V3.add(this.grabTotal, this.grabTotal, this._ld);
          this.strokeDelta = this.grabTotal;
          this.stampAt(this._anchorLocal, this._anchorNormal, false);
        }
      }
      this._prevScreen[0] = sx; this._prevScreen[1] = sy;
      return true;
    }

    var hit = this.pick(sx, sy, true);
    if (!hit || hit.object !== obj) {
      this._prevScreen[0] = sx; this._prevScreen[1] = sy;
      return false;
    }

    var target = hit.localPoint;
    var prev = this._prevLocal;
    var dist = V3.dist(target, prev);
    var radius = this.localRadius(hit.point);
    var step = Math.max(radius * S.clamp(st.spacing || 0.2, 0.02, 2), 1e-7);

    if (!this.strokeDir) this.strokeDir = V3.create(0, 0, 0);
    if (dist > 1e-12) {
      V3.sub(this.strokeDir, target, prev);
      V3.normalize(this.strokeDir, this.strokeDir);
    }

    var travelled = this.pendingDistance + dist;
    if (travelled < step) {
      this.pendingDistance = travelled;
      this._prevScreen[0] = sx; this._prevScreen[1] = sy;
      return true;
    }

    var steps = Math.min(Math.floor(travelled / step), 64);
    var startOffset = step - this.pendingDistance;
    for (var i = 0; i < steps; i++) {
      var t = (startOffset + i * step) / (dist || 1);
      if (t > 1) t = 1;
      V3.lerp(this._tmp, prev, target, t);
      this.stampAt(this._tmp, hit.localNormal, false);
    }
    this.pendingDistance = travelled - steps * step;
    V3.copy(this._prevLocal, target);
    V3.copy(this._prevWorld, hit.point);
    this._prevScreen[0] = sx; this._prevScreen[1] = sy;
    return true;
  };

  StrokeEngine.prototype.end = function () {
    if (!this.active) return false;
    this.active = false;
    this.strokeDelta = null;
    this.grabTotal = null;
    this.rotateAngle = 0;
    this.ctx.origin = null;
    this.grabVerts = null;
    var mesh = this.obj.mesh;
    mesh.gridMaybeRebuild();
    var committed = this.history.endStroke();
    return committed;
  };

  /** Abandon the stroke and undo whatever it has already done. */
  StrokeEngine.prototype.cancel = function () {
    if (!this.active) return false;
    this.active = false;
    this.strokeDelta = null;
    this.grabTotal = null;
    this.rotateAngle = 0;
    this.ctx.origin = null;
    this.grabVerts = null;
    var reverted = this.history.revertStroke();
    this.obj.mesh.gridMaybeRebuild();
    return reverted;
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
