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
  /*
   * How far one stroke may move a vertex from where it started, as a
   * multiple of the brush radius.
   *
   * Without a limit, a brush that builds material up runs away: every stamp
   * measures against the surface the last stamp left, so stamps landing on
   * the same few vertices — a slow drag, a tap and hold, a stroke that
   * doubles back — lift them again and again until they shoot out as a
   * spike. A limit per vertex per stroke stops that without stopping a long
   * pull, because a pull walks over fresh vertices as it goes and each of
   * them starts its own count. Lift your finger and the next stroke starts
   * again, so material still builds up pass after pass.
   */
  var STROKE_REACH = 1.1;

  /** How deep one pass of Trim Normal cuts, as a fraction of brush radius. */
  var TRIM_DEPTH = 0.12;

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
    // where the stroke started, which is the plane Trim Normal holds to
    this.anchorPoint = V3.create(0, 0, 0);
    this.anchorNormal = V3.create(0, 1, 0);
    this.anchorRadius = 1;
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
    this.detail = 0;                      // refinement target, 0 = not refining
    // the stencil, and the two in-surface axes it is read along
    this.alpha = null;
    this.alphaU = V3.create(1, 0, 0);
    this.alphaV = V3.create(0, 0, 1);
    this.alphaTile = 0;                   // > 0: read the stencil off the surface
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
    var alpha = ctx.alpha;
    var tile = ctx.alphaTile || 0;
    var surf = [0, 0];
    var au, av;
    if (alpha) {
      au = ctx.alphaU; av = ctx.alphaV;
    }
    for (var i = 0; i < n; i++) {
      var v = verts[i], o = v * 3;
      var dx = pos[o] - cx, dy = pos[o + 1] - cy, dz = pos[o + 2] - cz;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz) * inv;
      if (d >= 1) { w[i] = 0; continue; }
      var f;
      if (alpha && tile > 0) {
        /*
         * A stencil read from the surface: the pattern decides how much of
         * the dab lands where, and the dab's own round falloff decides how
         * far it reaches. Because the pattern comes from the surface rather
         * than from the dab, going over the same place again deepens it
         * instead of smearing it.
         */
        S.Alpha.surfaceUV(pos[o], pos[o + 1], pos[o + 2], nor[o], nor[o + 1], nor[o + 2],
                          tile, surf);
        f = S.Alpha.sampleTiled(alpha, surf[0], surf[1]) * falloff(1 - d);
        if (f <= 0) { w[i] = 0; continue; }
      } else if (alpha) {
        /*
         * A stencil read as one stamp: the pattern has to be what shapes the
         * dab, so the radial falloff is reduced to a vignette over the outer
         * fifth of the brush. Applying the usual curve on top would round
         * the corners off every stamp and wash the pattern out.
         */
        var u = ((dx * au[0] + dy * au[1] + dz * au[2]) * inv) * 0.5 + 0.5;
        var vv = ((dx * av[0] + dy * av[1] + dz * av[2]) * inv) * 0.5 + 0.5;
        f = S.Alpha.sample(alpha, u, vv);
        if (f <= 0) { w[i] = 0; continue; }
        if (d > 0.8) f *= S.smoothstep((1 - d) / 0.2);
      } else {
        f = falloff(1 - d);
      }
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

  /*
   * Hold back the vertices the refinement has not reached yet.
   *
   * Dynamic topology refines a little per stamp — it has to, or one stroke
   * eats the whole triangle budget — so on a coarse model the first stamps
   * land while parts of the footprint still carry edges many times the
   * detail size. Moving such a vertex by a full brush step drags a long
   * edge with it and leaves a fin: measured on a box, one stamp moved a
   * vertex 0.29 while its ring sat 0.64 away, which is the spike that made
   * sculpted models look broken.
   *
   * So a vertex moves in proportion to how refined it is: fully once its
   * edges are down near the detail size, barely at all while they are ten
   * times too long. Nothing is lost — the next stamps refine further and it
   * catches up — and the surface stays a surface the whole way.
   */
  function dampUnderRefined(ctx) {
    var detail = ctx.detail;
    if (!(detail > 0)) return;
    var mesh = ctx.mesh, verts = ctx.verts, n = ctx.count, w = ctx.weights;
    var pos = mesh.positions.array;
    var ring = ctx._ring || (ctx._ring = []);
    var full = detail * 2;                 // at or under this: move freely
    for (var i = 0; i < n; i++) {
      if (w[i] <= 0) continue;
      var v = verts[i], o = v * 3;
      ring.length = 0;
      mesh.ringVerts(v, ring);
      if (ring.length < 2) continue;
      var sum = 0;
      for (var k = 0; k < ring.length; k++) {
        var ro = ring[k] * 3;
        sum += Math.sqrt((pos[o] - pos[ro]) * (pos[o] - pos[ro]) +
                         (pos[o + 1] - pos[ro + 1]) * (pos[o + 1] - pos[ro + 1]) +
                         (pos[o + 2] - pos[ro + 2]) * (pos[o + 2] - pos[ro + 2]));
      }
      var avg = sum / ring.length;
      if (avg > full) w[i] *= full / avg;
    }
  }
  S.dampUnderRefined = dampUnderRefined;

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

  /**
   * Pull any vertex that has drifted further than `limit` from where this
   * stroke found it back onto that sphere. This is what keeps a stroke from
   * growing spikes, and it costs one distance check per touched vertex.
   */
  /*
   * A ceiling on what one stamp may move a vertex, measured in triangle
   * widths.
   *
   * A stamp that moves the surface further than the triangles are wide
   * leaves geometry the refinement cannot describe: a cliff where a brush
   * lifts, a fold where it pushes sideways. Measured with the Nudge brush
   * at a fine detail setting, one stroke left 323 needles and 38,000
   * triangles; holding each stamp to a few triangle widths leaves the same
   * stroke smooth, and costs nothing visible, because a stroke lays several
   * stamps per brush width and the movement simply accumulates over them.
   */
  /**
   * The mirror combinations the settings ask for: [1,1,1] on its own, and a
   * sign flip per axis that is switched on, so all eight octants when all
   * three are.
   */
  function symmetryCombos(st) {
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
    return combos;
  }
  S.symmetryCombos = symmetryCombos;

  function limitStampStep(mesh, verts, count, snap, cap) {
    if (!(cap > 0)) return 0;
    var pos = mesh.positions.array;
    var held = 0;
    for (var i = 0; i < count; i++) {
      var v = verts[i], o = v * 3, s3 = i * 3;
      var dx = pos[o] - snap[s3], dy = pos[o + 1] - snap[s3 + 1], dz = pos[o + 2] - snap[s3 + 2];
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d <= cap || d < 1e-12) continue;
      var k = cap / d;
      pos[o] = snap[s3] + dx * k;
      pos[o + 1] = snap[s3 + 1] + dy * k;
      pos[o + 2] = snap[s3 + 2] + dz * k;
      mesh.markVertDirty(v);
      held++;
    }
    return held;
  }
  S.limitStampStep = limitStampStep;

  function limitStrokeReach(mesh, verts, count, origins, limit) {
    if (!(limit > 0)) return 0;
    var pos = mesh.positions.array;
    var birth = mesh.vertBirth;
    var pulled = 0;
    for (var i = 0; i < count; i++) {
      var v = verts[i];
      var start = origins.get(v);
      if (!start) continue;
      var o = v * 3;
      /*
       * The slot may have been handed to a different vertex since — a
       * collapse kills a vertex and the next split takes its index. Pulling
       * the newcomer back towards where the dead one started is how a
       * stroke came to leave fins standing off the surface, so the record
       * is replaced with this vertex's own starting point instead.
       */
      if (start[3] !== birth[v]) {
        start[0] = pos[o]; start[1] = pos[o + 1]; start[2] = pos[o + 2];
        start[3] = birth[v];
        continue;
      }
      var dx = pos[o] - start[0], dy = pos[o + 1] - start[1], dz = pos[o + 2] - start[2];
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d <= limit || d < 1e-12) continue;
      var k = limit / d;
      pos[o] = start[0] + dx * k;
      pos[o + 1] = start[1] + dy * k;
      pos[o + 2] = start[2] + dz * k;
      mesh.markVertDirty(v);
      pulled++;
    }
    return pulled;
  }
  S.limitStrokeReach = limitStrokeReach;

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

  /**
   * Add — the brush everything else hangs off.
   *
   * Every stamp raises the surface to a plateau a fixed height above the
   * local average, so material *accumulates*: draw over a spot twice and it
   * is twice as thick, drag and it pulls a ridge, keep dragging and it pulls
   * a limb. With dynamic topology on (the default) the new volume gets its
   * own triangles as it grows, which is the difference between adding to a
   * model and stretching the triangles it already had.
   *
   * Ctrl (invert) digs the same shape out instead.
   */
  BrushFns.add = function (ctx) {
    areaPlane(ctx);
    var s = sgn(ctx);
    var nx = ctx.planeNormal[0], ny = ctx.planeNormal[1], nz = ctx.planeNormal[2];
    var px = ctx.planePoint[0], py = ctx.planePoint[1], pz = ctx.planePoint[2];
    // how thick one pass lays down, as a share of the brush size
    var target = ctx.radius * S.clamp(ctx.clay, 0.02, 0.6) * 1.6 * s;
    var strength = ctx.strength;
    /*
     * A floor under each stamp, so material keeps building.
     *
     * Filling to a plateau above the local average saturates: once the bump
     * is that high the sum stops moving, and going over the same place again
     * does nothing. A small guaranteed lift per stamp keeps it growing pass
     * after pass, which is what a clay brush is for — and it is safe to do
     * because the stroke reach limit bounds how far one stroke can take it.
     */
    var floor = ctx.radius * 0.05 * strength * s;
    eachVert(ctx, function (v, o, f, pos) {
      var height = (pos[o] - px) * nx + (pos[o + 1] - py) * ny + (pos[o + 2] - pz) * nz;
      var move = (target - height) * strength * f;
      var least = floor * f;
      move = s > 0 ? Math.max(move, least) : Math.min(move, least);
      // never cut while adding (or add while cutting): that is what makes it
      // build up rather than drag the whole surface along
      if (s > 0 ? move < 0 : move > 0) return;
      pos[o] += nx * move;
      pos[o + 1] += ny * move;
      pos[o + 2] += nz * move;
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

  /**
   * Trim: shave the surface flat against a plane.
   *
   * The difference from Flatten is the weighting. Flatten eases off towards
   * the rim of the brush, which leaves a soft dish; a trim holds full
   * strength across most of the footprint so the patch lands *on* the plane
   * and meets the untouched surface at a crisp edge. That is what makes it
   * the tool for hard surfaces — armour plates, cut stone, blocky props.
   *
   * By default it only cuts: material above the plane comes down, nothing
   * below is raised, so repeated strokes carve a facet instead of inflating
   * the form. Ctrl (invert) fills below the plane instead.
   *
   * `mode` picks where the plane comes from:
   *   'dynamic' — recomputed from the surface under the brush each stamp, so
   *               it follows the form and faceting it as you go
   *   'normal'  — fixed where the stroke started, so one drag trims
   *               everything to a single flat face
   */
  function trimBrush(ctx, mode) {
    var px, py, pz, nx, ny, nz;
    if (mode === 'normal') {
      nx = ctx.anchorNormal[0]; ny = ctx.anchorNormal[1]; nz = ctx.anchorNormal[2];
      // Sit the plane a little below the point the stroke started from.
      // Exactly tangent, it would have nothing above it to cut on a convex
      // form — the brush would appear to do nothing until you dragged off
      // the high point. This depth is what one pass shaves off.
      // measured once at the start of the stroke: the brush radius changes
      // slightly as the pointer moves nearer or further from the camera, and
      // using the live value would step the plane and terrace the cut
      var sink = ctx.anchorRadius * TRIM_DEPTH * (ctx.invert ? -1 : 1);
      px = ctx.anchorPoint[0] - nx * sink;
      py = ctx.anchorPoint[1] - ny * sink;
      pz = ctx.anchorPoint[2] - nz * sink;
    } else {
      areaPlane(ctx);
      px = ctx.planePoint[0]; py = ctx.planePoint[1]; pz = ctx.planePoint[2];
      nx = ctx.planeNormal[0]; ny = ctx.planeNormal[1]; nz = ctx.planeNormal[2];
    }
    var l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-12) return;
    nx /= l; ny /= l; nz /= l;

    var cut = !ctx.invert;
    // trims are meant to be decisive; a full-strength stamp lands the patch
    // on the plane rather than easing towards it
    var strength = S.clamp(ctx.strength * 1.5, 0, 1);
    eachVert(ctx, function (v, o, f, pos) {
      var d = (pos[o] - px) * nx + (pos[o + 1] - py) * ny + (pos[o + 2] - pz) * nz;
      if (cut ? d <= 0 : d >= 0) return;          // one-sided
      var w = f * 2.2;
      if (w > 1) w = 1;                            // plateau: crisp border
      var move = -d * strength * w;
      pos[o] += nx * move;
      pos[o + 1] += ny * move;
      pos[o + 2] += nz * move;
    });
  }

  BrushFns.trimDynamic = function (ctx) { trimBrush(ctx, 'dynamic'); };
  BrushFns.trimNormal = function (ctx) { trimBrush(ctx, 'normal'); };

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
    var birth = ctx.mesh.vertBirth;
    eachVert(ctx, function (v, o, f, pos) {
      var base = origin.get(v);
      if (!base || base[4] !== birth[v]) {
        base = [pos[o], pos[o + 1], pos[o + 2], 0, birth[v]];
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
    var birth = ctx.mesh.vertBirth;
    eachVert(ctx, function (v, o, f, pos) {
      var base = origin && origin.get(v);
      if (base && base[4] !== birth[v]) base = null;
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
    var birth = ctx.mesh.vertBirth;
    eachVert(ctx, function (v, o, f, pos) {
      var base = origin && origin.get(v);
      if (base && base[4] !== birth[v]) base = null;
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
    { id: 'add', label: 'Add', group: 'Add', key: 'A', fn: BrushFns.add,
      strength: 0.6, hint: 'Adds material where you draw. Go over it again and it thickens; drag and it pulls out a ridge or a limb. Ctrl digs in instead.' },
    { id: 'clay', label: 'Clay', group: 'Add', key: '1', fn: BrushFns.clay,
      strength: 0.55, hint: 'Softer than Add: fills towards the average surface, for smoothing volume in.' },
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

    { id: 'trimdynamic', label: 'Trim Dyn', group: 'Refine', key: 'T', fn: BrushFns.trimDynamic,
      strength: 0.6, crisp: true,
      hint: 'Shaves the surface flat against the plane under the brush, with a crisp edge. Cuts material away; Ctrl fills instead.' },
    { id: 'trimnormal', label: 'Trim Nrm', group: 'Refine', key: 'E', fn: BrushFns.trimNormal,
      strength: 0.6, crisp: true,
      hint: 'Trims to one flat plane, fixed where you start the stroke — for slicing a clean face across a form.' },
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
      strength: 0.6, hint: 'Paints into the model\u2019s own texture, so a pattern stays sharp however few triangles it has.' },
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
    if (!this._prevStamp) this._prevStamp = [input.x, input.y];
    this._prevStamp[0] = input.x; this._prevStamp[1] = input.y;
    this.pendingDistance = 0;

    var topo = this.usesDyntopo();
    /*
     * Painting into the object's image is recorded differently from moving
     * its vertices — tiles of the image rather than positions — so the
     * history is told which kind of stroke this is.
     */
    this.paintMap = (brush.paint && this.obj.paint) ? this.obj.paint : null;
    this.history.beginStroke(this.obj, {
      label: brush.label,
      topology: topo && !this.paintMap,
      paintMap: this.paintMap,
      colors: !!brush.paint && !this.paintMap,
      masks: !!brush.mask
    });

    this.anchorRadius = this.localRadius(this._anchorWorld);

    // resolve the stencil once for the stroke
    this.alpha = (!brush.mask && st.alpha && st.alpha !== 'none') ? S.alphaById(st.alpha) : null;
    this.stampAngle = (this.alpha && st.alphaRandomRotate) ? Math.random() * Math.PI * 2 : 0;
    if (!this._frameFwd) this._frameFwd = V3.create(0, 0, 1);
    V3.perpendicular(this._frameFwd, this._anchorNormal);
    this.ctx.origin = (brush.grab || brush.id === 'layer') ? new Map() : null;
    /*
     * Grab brushes already work from a captured start position, and paint and
     * mask brushes move nothing, so the reach limit applies to the
     * displacement brushes — the ones that can pile material up.
     */
    this.strokeOrigins = (brush.grab || brush.paint || brush.mask) ? null : new Map();
    // everything created from here on is the refinement's work, not the
    // model's own geometry (see the seeding of `strokeOrigins` below)
    this._strokeBirth = hit.object.mesh._birthClock;
    // where a grab began, so the region it pulled through can be found again
    // at the end of the stroke: a snake hook carries the anchor along with it
    if (!this._grabStart) this._grabStart = V3.create(0, 0, 0);
    V3.copy(this._grabStart, hit.localPoint);
    this.grabVerts = null;

    // grab brushes capture their vertex set once, so the same material moves
    // for the whole stroke instead of picking up new vertices as it goes
    if (brush.grab && !brush.follow) {
      // refine first: a pull with only a handful of vertices under the brush
      // drags the mesh thin, and the whole point of dynamic topology is that
      // it does not have to
      if (this.usesDyntopo()) {
        var gDetail = this.detailSize(this._anchorWorld, this.anchorRadius);
        this.obj.mesh.dyntopo(this._anchorLocal[0], this._anchorLocal[1], this._anchorLocal[2],
                              this.anchorRadius, gDetail, st.maxTriangles);
      }
      this.captureGrabSet();
    }
    this.stampAt(this._anchorLocal, this._anchorNormal, true);
    return true;
  };

  /**
   * How big the triangles under the brush should be, in the object's local
   * units.
   *
   * Measured in screen pixels by default, rather than as a fraction of the
   * brush. Tying detail to the brush size is a mistake worth naming: a small
   * brush then asks for microscopic triangles, and a single dab with a
   * four-pixel brush can ask for a hundred thousand of them — which is what
   * turned a tap into a star of stretched fins. In pixels, detail means the
   * same thing whatever size the brush is, and the triangle count grows with
   * the area actually painted over.
   *
   * The older modes are still here: 'relative' is the fraction-of-the-brush
   * behaviour and 'constant' is a fixed size in model units.
   */
  StrokeEngine.prototype.detailSize = function (worldPoint, localRadius) {
    var st = this.settings;
    if (st.detailMode === 'constant') return Math.max(st.detailSize || 0.01, 1e-6);
    if (st.detailMode === 'relative') {
      return Math.max(localRadius * S.clamp((st.detailPercent || 20) / 100, 0.02, 1), 1e-6);
    }
    var perPixel = this.camera.worldPerPixel(worldPoint) / this.obj.uniformScale();
    /*
     * A size in pixels — so the triangles are as fine as the screen can
     * show, whatever the model's scale — that follows the brush down when
     * the brush is smaller than that.
     *
     * The size has to follow, because a ten-pixel brush working against
     * twelve-pixel triangles has one vertex to push on and leaves no mark
     * at all. It has to stop following at some point, because triangles
     * finer than a pixel are invisible and not free. And following keeps
     * the cost flat rather than raising it: how many triangles fit under
     * one stamp is (radius / detail) squared, so a size proportional to the
     * brush means a small brush refines a small patch finely and a big
     * brush a big patch coarsely, for about the same number of triangles.
     */
    var px = S.clamp(st.detailPixels || 12, 3, 60);
    var byBrush = (st.radius || px) * 0.6;
    if (byBrush < px) px = Math.max(byBrush, 3);
    return Math.max(perPixel * px, 1e-6);
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
    var local = world / this.obj.uniformScale();
    /*
     * A brush wider than the model itself has nothing useful to do: the
     * surface it averages over is the whole object, so a stroke drags
     * everything at once and leaves a lopsided blob rather than a sculpt.
     * Zoomed out far enough, the brush stops growing instead of swallowing
     * the thing being made.
     *
     * The other end is handled by the refinement rather than here: the
     * detail size is a flat number of pixels, so a small brush refines the
     * surface to that size and then has triangles its own scale to work
     * with.
     */
    var cap = this.obj.mesh.boundsRadius() * 0.8;
    return (cap > 1e-6 && local > cap) ? cap : local;
  };

  /**
   * The region a grab stroke pulled through, in object space: a sphere
   * covering where it started and where it ended up.
   */
  StrokeEngine.prototype.grabRegion = function () {
    var a = this._grabStart || this._anchorLocal;
    var b = this._grabEnd || (this._grabEnd = V3.create(0, 0, 0));
    V3.copy(b, this._anchorLocal);
    if (this.grabTotal) V3.add(b, b, this.grabTotal);
    var base = this.grabRadius || this.anchorRadius || 0;
    return { x: (a[0] + b[0]) * 0.5, y: (a[1] + b[1]) * 0.5, z: (a[2] + b[2]) * 0.5,
             r: base + V3.dist(a, b) * 0.6 };
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
      origin.set(v, [pos[o], pos[o + 1], pos[o + 2], 0, mesh.vertBirth[v]]);
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

    var combos = symmetryCombos(st);

    /*
     * Mirrored passes that land on top of each other.
     *
     * A brush sitting on a mirror plane produces the same stamp twice — and
     * with all three mirrors on, up to eight times. Every pass then moved
     * the same vertices again, so a stroke cut eight times as deep as asked
     * and the curvature it left sent dynamic topology into a refining
     * frenzy: measured, one stroke of Crease at full strength went from
     * 4,500 triangles to the 150,000 ceiling and took eighteen seconds,
     * which on a phone is a crash. So a pass whose centre has already been
     * stamped is skipped.
     */
    var seen = this._symSeen || (this._symSeen = []);
    seen.length = 0;
    var dupSq = radius * radius * 0.0625;        // within a quarter of the brush

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

      var duplicate = false;
      for (var sy = 0; sy < seen.length; sy += 3) {
        var sdx = seen[sy] - cx, sdy = seen[sy + 1] - cy, sdz = seen[sy + 2] - cz;
        if (sdx * sdx + sdy * sdy + sdz * sdz < dupSq) { duplicate = true; break; }
      }
      if (duplicate) continue;
      seen.push(cx, cy, cz);

      if (this.usesDyntopo() && !(brush.grab && !brush.follow)) {
        var detail = this.detailSize(worldPoint, radius);
        /*
         * One stamp's worth of refinement, shared between the mirrors.
         *
         * Each mirrored pass refines its own copy of the region, so without
         * this a stamp with all three mirrors on does eight times the work
         * of one without — and that is how a fine detail setting with a big
         * brush turned a single stroke into a two-second freeze. Sharing
         * the budget keeps a stamp's cost the same whatever symmetry is on;
         * the mirrors simply take a few more stamps to catch up.
         */
        var share = Math.max(120, Math.round(600 / combos.length));
        /*
         * Refine a little wider than the brush. Refining exactly the
         * footprint leaves a dense island inside a ring of untouched
         * triangles, and the seam between them is where slivers and torn
         * shading come from; a wider ring grades the change instead.
         */
        mesh.dyntopo(cx, cy, cz, radius * 1.25, detail, st.maxTriangles, undefined, share);
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
      /*
       * Grab brushes drag a whole region by the pointer, so "how refined is
       * this vertex" is not a reason to hold them back; everything else is
       * damped where the refinement has not caught up (see
       * `dampUnderRefined`).
       */
      ctx.detail = (this.usesDyntopo() && !brush.grab) ? this.detailSize(worldPoint, radius) : 0;
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
      // the plane Trim Normal holds to, mirrored for this symmetry pass
      V3.set(ctx.anchorPoint, this._anchorLocal[0] * m[0], this._anchorLocal[1] * m[1], this._anchorLocal[2] * m[2]);
      V3.set(ctx.anchorNormal, this._anchorNormal[0] * m[0], this._anchorNormal[1] * m[1], this._anchorNormal[2] * m[2]);
      V3.normalize(ctx.anchorNormal, ctx.anchorNormal);
      ctx.anchorRadius = this.anchorRadius || radius;
      ctx.rotateAngle = this.rotateAngle || 0;
      if (st.paintColor) V3.copy(ctx.color, st.paintColor);
      ctx.origin = this.ctx.origin;

      // the stencil, and the two axes it is read along
      ctx.alpha = this.alpha || null;
      /*
       * How much of the model one repeat of the pattern covers. A tile of
       * one brush width means a dab shows about one repeat, which reads the
       * way a stencil is meant to while still tiling across a stroke.
       */
      ctx.alphaTile = (ctx.alpha && st.alphaMode !== 'stamp')
        ? radius * 2 * S.clamp(st.alphaScale === undefined ? 1 : st.alphaScale, 0.1, 8) : 0;
      if (ctx.alpha) {
        var fwd = this._alphaFwd || (this._alphaFwd = V3.create(0, 0, 1));
        if (st.alphaFollowStroke !== false && this.strokeDir && V3.lenSq(this.strokeDir) > 1e-12) {
          V3.set(fwd, this.strokeDir[0] * m[0], this.strokeDir[1] * m[1], this.strokeDir[2] * m[2]);
        } else {
          // no direction to follow: hold the frame the stroke started with,
          // so a stamp does not spin as the surface normal wanders
          V3.set(fwd, this._frameFwd[0] * m[0], this._frameFwd[1] * m[1], this._frameFwd[2] * m[2]);
        }
        var dotN = V3.dot(fwd, ctx.normal);
        V3.set(fwd, fwd[0] - ctx.normal[0] * dotN, fwd[1] - ctx.normal[1] * dotN, fwd[2] - ctx.normal[2] * dotN);
        if (V3.lenSq(fwd) < 1e-12) V3.perpendicular(fwd, ctx.normal);
        else V3.normalize(fwd, fwd);
        if (this.stampAngle) {
          // spin the stencil, so repeated dabs of dirt do not tile visibly
          var ca = Math.cos(this.stampAngle), sa = Math.sin(this.stampAngle);
          var side0 = V3.cross(V3.create(0, 0, 0), ctx.normal, fwd);
          V3.set(fwd, fwd[0] * ca + side0[0] * sa, fwd[1] * ca + side0[1] * sa, fwd[2] * ca + side0[2] * sa);
          V3.normalize(fwd, fwd);
        }
        V3.copy(ctx.alphaV, fwd);
        V3.cross(ctx.alphaU, ctx.normal, fwd);
        V3.normalize(ctx.alphaU, ctx.alphaU);
      }

      computeWeights(ctx);
      dampUnderRefined(ctx);
      this.history.captureVerts(verts, ctx.count);

      // remember where these vertices were when the stroke first touched
      // them, so the limit below has something to measure against
      var origins = this.strokeOrigins;
      if (origins) {
        var opos = mesh.positions.array;
        var obirth = mesh.vertBirth;
        var oring = this._oring || (this._oring = []);
        for (var oi = 0; oi < ctx.count; oi++) {
          var ov = verts[oi];
          var had = origins.get(ov);
          if (had && had[3] === obirth[ov]) continue;
          var oo = ov * 3;
          var ax = 0, ay = 0, az = 0, an = 0;
          /*
           * A vertex the refinement created during this stroke inherits
           * where its neighbours started, rather than where it was born.
           *
           * Its birthplace is already part-way through the stroke, so taking
           * that as its starting point would hand it a fresh allowance of
           * travel — and since refinement creates new vertices every stamp,
           * a stroke could creep on for ever, one generation at a time.
           *
           * A vertex that was here all along and has only just come within
           * reach of the brush is a different matter: it starts from where
           * it is, or the limit below would drag it somewhere it was never
           * pushed. That is why this asks when the vertex appeared.
           */
          if (obirth[ov] > this._strokeBirth) {
            oring.length = 0;
            mesh.ringVerts(ov, oring);
            for (var ri = 0; ri < oring.length; ri++) {
              var rec = origins.get(oring[ri]);
              if (!rec || rec[3] !== obirth[oring[ri]]) continue;
              ax += rec[0]; ay += rec[1]; az += rec[2]; an++;
            }
          }
          if (an) origins.set(ov, [ax / an, ay / an, az / an, obirth[ov]]);
          else origins.set(ov, [opos[oo], opos[oo + 1], opos[oo + 2], obirth[ov]]);
        }
      }

      /*
       * Where these vertices were before this stamp, so the step ceiling
       * below has something to measure against. Only worth keeping while
       * the refinement is running, since the ceiling is measured in
       * triangle widths.
       */
      var stepCap = (ctx.detail > 0 && !brush.paint && !brush.mask) ? ctx.detail * 3 : 0;
      var snap = null;
      if (stepCap > 0) {
        snap = this._stepSnap;
        if (!snap || snap.length < ctx.count * 3) {
          snap = this._stepSnap = new Float64Array(S.nextPow2(ctx.count * 3));
        }
        var spos = mesh.positions.array;
        for (var si = 0; si < ctx.count; si++) {
          var so2 = verts[si] * 3, d3 = si * 3;
          snap[d3] = spos[so2]; snap[d3 + 1] = spos[so2 + 1]; snap[d3 + 2] = spos[so2 + 2];
        }
      }

      if (this.paintMap) {
        /*
         * Colour that is finer than the mesh.
         *
         * Tinting vertices can only ever be as fine as the triangles under
         * the brush, which on a model built for a game is nowhere near fine
         * enough: a stencil came out as a handful of soft blotches. Painting
         * into the object's own image gives the colour its own resolution,
         * so a stencil reads as a stencil and the paint survives reducing
         * the model on export.
         */
        this.paintMap.stamp(mesh, {
          center: ctx.center, radius: radius, normal: ctx.normal,
          color: ctx.color, strength: ctx.strength,
          falloff: ctx.falloff, alpha: ctx.alpha, alphaU: ctx.alphaU, alphaV: ctx.alphaV,
          alphaTile: ctx.alphaTile, frontFacing: ctx.frontFacing,
          history: this.history
        });
        total += ctx.count;
        continue;
      }

      brush.fn(ctx);

      // `crisp` brushes (the trims) skip auto-smoothing: rounding the edge
      // off afterwards would undo the hard face they exist to cut
      // A stencil's whole point is the pattern it leaves, so relaxing the
      // surface behind the stamp would rub it straight back out.
      var autoSmooth = (brush.paint || brush.mask || brush.crisp || this.alpha) ? 0 : (st.autoSmooth || 0);
      if (autoSmooth > 0) {
        mesh.smoothVerts(verts, ctx.count, autoSmooth * 0.5, true, ctx.weights);
      }

      if (snap) limitStampStep(mesh, verts, ctx.count, snap, stepCap);
      if (origins) limitStrokeReach(mesh, verts, ctx.count, origins, radius * STROKE_REACH);

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
    // stamp mode lays exactly one dab per press, which is how you place a
    // rivet or a patch of detail without smearing it
    if (st.stampMode && !this.brush.grab) return true;
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

    /*
     * Stamps are spaced along the path the finger took on screen, and each
     * one finds the surface under that point for itself.
     *
     * Spacing them along the *surface* between two pointer positions reads
     * well until the stroke digs in: the surface path between two points
     * grows as the dent deepens, so the same finger movement lays more and
     * more stamps, which digs deeper, which lays more again. Measured on a
     * Crease stroke at full strength with three mirrors on, that loop turned
     * one stroke into five hundred stamps, a hundred and fifty thousand
     * triangles and twenty seconds — a crash, on a phone.
     *
     * On screen there is no such feedback: how many stamps a movement lays
     * depends only on how far the finger moved.
     */
    if (!this._prevStamp) this._prevStamp = [this._prevScreen[0], this._prevScreen[1]];
    var fromX = this._prevStamp[0], fromY = this._prevStamp[1];
    var pxDist = Math.sqrt((sx - fromX) * (sx - fromX) + (sy - fromY) * (sy - fromY));
    var radius = this.localRadius(hit.point);
    var stepPx = Math.max(st.radius * S.clamp(st.spacing || 0.2, 0.02, 2), 1.5);

    if (!this.strokeDir) this.strokeDir = V3.create(0, 0, 0);
    var target = hit.localPoint;
    if (V3.dist(target, this._prevLocal) > 1e-12) {
      V3.sub(this.strokeDir, target, this._prevLocal);
      V3.normalize(this.strokeDir, this.strokeDir);
    }

    var travelled = this.pendingDistance + pxDist;
    if (travelled < stepPx) {
      this.pendingDistance = travelled;
      this._prevScreen[0] = sx; this._prevScreen[1] = sy;
      return true;
    }

    // a hard bound per event as well, so a flung finger or a dropped frame
    // cannot ask for hundreds of stamps at once
    var steps = Math.min(Math.floor(travelled / stepPx), 16);
    var startOffset = stepPx - this.pendingDistance;
    var laid = 0;
    for (var i = 0; i < steps; i++) {
      var t = (startOffset + i * stepPx) / (pxDist || 1);
      if (t > 1) t = 1;
      var atX = fromX + (sx - fromX) * t, atY = fromY + (sy - fromY) * t;
      var stepHit = (t >= 1) ? hit : this.pick(atX, atY, true);
      if (!stepHit || stepHit.object !== obj) continue;
      V3.sub(this.strokeDir, stepHit.localPoint, this._prevLocal);
      if (V3.lenSq(this.strokeDir) > 1e-14) V3.normalize(this.strokeDir, this.strokeDir);
      this.stampAt(stepHit.localPoint, stepHit.localNormal, false);
      V3.copy(this._prevLocal, stepHit.localPoint);
      V3.copy(this._prevWorld, stepHit.point);
      laid++;
    }
    this.pendingDistance = travelled - steps * stepPx;
    this._prevStamp[0] = sx; this._prevStamp[1] = sy;
    this._prevScreen[0] = sx; this._prevScreen[1] = sy;
    return true;
  };

  StrokeEngine.prototype.end = function () {
    if (!this.active) return false;
    this.active = false;
    var mesh = this.obj.mesh;
    var st = this.settings;

    /*
     * A grab stroke drags the triangles it captured, so it leaves the
     * surface stretched behind it. With dynamic topology on, rebuild the
     * region it pulled through: the stretch becomes new triangles, and the
     * pull ends up looking like added material instead of a thinned mesh.
     */
    if (this.usesDyntopo() && this.brush.grab && !this.brush.follow && !this.brush.rotate) {
      var pull = this.grabRegion();
      if (pull.r > 1e-6) {
        var detail = this.detailSize(this._anchorWorld, this.grabRadius || this.anchorRadius || 0);
        mesh.dyntopo(pull.x, pull.y, pull.z, pull.r, detail, st.maxTriangles);
        mesh.computeNormals();
      }
    }

    /*
     * A grab stroke keeps no record of the vertices it touched — it drags a
     * captured set, and the reach limit does not apply to it — so the
     * needle repair below has nothing to work from. The region it pulled
     * through is the sphere covering the anchor and where the pointer ended
     * up, which is where any needle it left will be.
     */
    if (!this.strokeOrigins && this.brush.grab) {
      var pulled = this.grabRegion();
      if (pulled.r > 1e-6) {
        var gcombos = symmetryCombos(st);
        for (var gi = 0; gi < gcombos.length; gi++) {
          var gm = gcombos[gi];
          var gv = mesh.vertsInSphere(pulled.x * gm[0], pulled.y * gm[1], pulled.z * gm[2],
                                      pulled.r * 1.2);
          if (gv.length) mesh.relaxSpikesAt(Uint32Array.from(gv), gv.length);
        }
      }
    }

    /*
     * Settle the stroke.
     *
     * A brush only a couple of triangles wide leaves the surface faceted:
     * each stamp lifts the handful of vertices it covers and the ones just
     * outside stay put. A light relax over what the stroke touched turns
     * that into a bump, and it is deliberately not applied to the trims or
     * to anything working through a stencil, where the crisp edge is the
     * whole point.
     */
    if (this.strokeOrigins && this.strokeOrigins.size) {
      var settle = [];
      this.strokeOrigins.forEach(function (start, v) { settle.push(v); });

      /*
       * The last stamp of a stroke stretches the surface and then the stroke
       * ends, so nothing refines what it left. One pass over the region the
       * stroke covered puts the triangles back near the detail size.
       */
      if (this.usesDyntopo() && settle.length) {
        var pos = mesh.positions.array;
        var bx = 0, by = 0, bz = 0, n = 0, i;
        for (i = 0; i < settle.length; i++) {
          if (mesh.vertDead.array[settle[i]]) continue;
          var so = settle[i] * 3;
          bx += pos[so]; by += pos[so + 1]; bz += pos[so + 2];
          n++;
        }
        if (n) {
          bx /= n; by /= n; bz /= n;
          var spread = 0;
          for (i = 0; i < settle.length; i++) {
            if (mesh.vertDead.array[settle[i]]) continue;
            var to = settle[i] * 3;
            var d = (pos[to] - bx) * (pos[to] - bx) + (pos[to + 1] - by) * (pos[to + 1] - by) +
                    (pos[to + 2] - bz) * (pos[to + 2] - bz);
            if (d > spread) spread = d;
          }
          spread = Math.sqrt(spread) * 1.05 + 1e-6;
          mesh.dyntopo(bx, by, bz, spread, this.detailSize(this._prevWorld, this.anchorRadius),
                       st.maxTriangles, undefined, 900);
        }
      }

      var live = [];
      for (var k = 0; k < settle.length; k++) {
        if (!mesh.vertDead.array[settle[k]]) live.push(settle[k]);
      }
      var arr = live.length ? Uint32Array.from(live) : null;

      /* then settle the faceting, except where a crisp edge is the point */
      if (arr && !this.brush.crisp && !this.alpha) {
        mesh.smoothVerts(arr, arr.length, 0.18, true);
        mesh.computeNormals(arr, arr.length);
      }

      /*
       * Last, pull back anything that ended up a needle anyway. The stroke
       * engine works hard not to make them — the step ceiling, the reach
       * limit, the refinement damping — but a stroke that crosses a hard
       * edge with three mirrors on can still leave one, and one needle is
       * what someone sees. Bounded to what this stroke touched, and to
       * shapes far sharper than anything made on purpose.
       */
      if (arr) {
        // one ring beyond the stroke: the needle a stroke leaves is often
        // just outside the last stamp, where the surface was stretched but
        // not itself pushed
        var edge = [], mark = {};
        for (var e = 0; e < arr.length; e++) mark[arr[e]] = 1;
        for (var e2 = 0; e2 < arr.length; e2++) {
          edge.length = 0;
          mesh.ringVerts(arr[e2], edge);
          for (var e3 = 0; e3 < edge.length; e3++) {
            if (!mark[edge[e3]] && !mesh.vertDead.array[edge[e3]]) { mark[edge[e3]] = 1; live.push(edge[e3]); }
          }
        }
        var wide = Uint32Array.from(live);
        mesh.relaxSpikesAt(wide, wide.length);
      }
    }

    this.strokeDelta = null;
    this.grabTotal = null;
    this.rotateAngle = 0;
    this.ctx.origin = null;
    this.strokeOrigins = null;
    this.grabVerts = null;
    this.paintMap = null;
    mesh.gridMaybeRebuild();
    var committed = this.history.endStroke();
    return committed;
  };

  /** Abandon the stroke and undo whatever it has already done. */
  StrokeEngine.prototype.cancel = function () {
    this.paintMap = null;
    if (!this.active) return false;
    this.active = false;
    this.strokeDelta = null;
    this.grabTotal = null;
    this.rotateAngle = 0;
    this.ctx.origin = null;
    this.strokeOrigins = null;
    this.grabVerts = null;
    var reverted = this.history.revertStroke();
    this.obj.mesh.gridMaybeRebuild();
    return reverted;
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
