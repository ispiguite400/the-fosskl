/*
 * SculptFree — booleans and joining.
 *
 * Two ways to combine objects:
 *
 *   join    — puts the meshes in one object and leaves the geometry alone.
 *             Instant, exact, and the surfaces still pass through each
 *             other; what you want for a prop assembled from parts.
 *
 *   boolean — union, subtract or intersect, computed through a signed
 *             distance field on a shared grid and re-extracted with the same
 *             manifold dual contouring the remesher uses. The result is one
 *             closed, watertight, sculptable surface with no self
 *             intersections, which is what a game engine and a 3D printer
 *             both want.
 *
 * Doing booleans in the field rather than by cutting triangles against each
 * other is a deliberate trade: it cannot fail on touching faces, coplanar
 * overlaps or self-intersecting input — the cases that make exact mesh
 * booleans fall over — but it rebuilds the topology, so a sharp edge is only
 * as sharp as the grid. The resolution setting is that trade, in one number.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var Bool = S.Boolean = {};
  var V3 = S.V3, M4 = S.M4;

  Bool.MODES = [
    { id: 'union', label: 'Union', symbol: 'A + B',
      hint: 'Fuse both into one surface' },
    { id: 'subtract', label: 'Subtract', symbol: 'A − B',
      hint: 'Cut the second shape out of the first' },
    { id: 'intersect', label: 'Intersect', symbol: 'A ∩ B',
      hint: 'Keep only where the two overlap' }
  ];

  Bool.modeById = function (id) {
    for (var i = 0; i < Bool.MODES.length; i++) if (Bool.MODES[i].id === id) return Bool.MODES[i];
    return Bool.MODES[0];
  };

  /** A world-space copy of an object's mesh, so both sides share one space. */
  function worldCopy(obj) {
    var m = obj.mesh.clone();
    m.applyMatrix(obj.matrix());
    return m;
  }

  /**
   * Work out the grid a boolean needs. Both shapes have to sit inside it:
   * the inside/outside test walks rays across the whole grid, so a shape
   * running off the edge would be classified wrongly.
   */
  Bool.plan = function (meshA, meshB, resolution) {
    var mn = V3.create(0, 0, 0), mx = V3.create(0, 0, 0);
    var aMn = meshA.boundsMin(), aMx = meshA.boundsMax();
    var bMn = meshB.boundsMin(), bMx = meshB.boundsMax();
    for (var k = 0; k < 3; k++) {
      mn[k] = Math.min(aMn[k], bMn[k]);
      mx[k] = Math.max(aMx[k], bMx[k]);
    }
    return S.Remesh.planFromBounds(mn, mx, resolution || 160, 2);
  };

  /** Do the two shapes overlap at all? Cheap check before the expensive part. */
  Bool.boundsOverlap = function (meshA, meshB) {
    var aMn = meshA.boundsMin(), aMx = meshA.boundsMax();
    var bMn = meshB.boundsMin(), bMx = meshB.boundsMax();
    for (var k = 0; k < 3; k++) {
      if (aMx[k] < bMn[k] || bMx[k] < aMn[k]) return false;
    }
    return true;
  };

  function combine(mode, fa, fb) {
    var n = fa.length;
    // the field is negative inside, so union is the nearer surface (min),
    // intersection the further one (max), and subtracting B flips its sign
    if (mode === 'union') {
      for (var i = 0; i < n; i++) if (fb[i] < fa[i]) fa[i] = fb[i];
    } else if (mode === 'intersect') {
      for (var j = 0; j < n; j++) if (fb[j] > fa[j]) fa[j] = fb[j];
    } else {
      for (var k = 0; k < n; k++) { var nb = -fb[k]; if (nb > fa[k]) fa[k] = nb; }
    }
    return fa;
  }

  /**
   * Colour for the result: whichever source surface is nearer to each new
   * vertex, so a subtracted pocket keeps the colour of the shape that cut it.
   */
  function transferColors(meshA, meshB, positions, count, radius) {
    var out = new Float32Array(count * 3);
    var pa = meshA.positions.array, ca = meshA.colors.array;
    var pb = meshB.positions.array, cb = meshB.colors.array;
    for (var i = 0; i < count; i++) {
      var o = i * 3;
      var x = positions[o], y = positions[o + 1], z = positions[o + 2];
      var bestA = Infinity, va = -1, bestB = Infinity, vb = -1;
      var r = radius;
      for (var attempt = 0; attempt < 4 && va < 0 && vb < 0; attempt++, r *= 2) {
        var candA = meshA.vertsInSphere(x, y, z, r);
        for (var k = 0; k < candA.length; k++) {
          var v = candA[k], v3 = v * 3;
          var d = (pa[v3] - x) * (pa[v3] - x) + (pa[v3 + 1] - y) * (pa[v3 + 1] - y) + (pa[v3 + 2] - z) * (pa[v3 + 2] - z);
          if (d < bestA) { bestA = d; va = v; }
        }
        var candB = meshB.vertsInSphere(x, y, z, r);
        for (var j = 0; j < candB.length; j++) {
          var w = candB[j], w3 = w * 3;
          var db = (pb[w3] - x) * (pb[w3] - x) + (pb[w3 + 1] - y) * (pb[w3 + 1] - y) + (pb[w3 + 2] - z) * (pb[w3 + 2] - z);
          if (db < bestB) { bestB = db; vb = w; }
        }
      }
      var useA = va >= 0 && (vb < 0 || bestA <= bestB);
      if (useA) {
        var a3 = va * 3;
        out[o] = ca[a3]; out[o + 1] = ca[a3 + 1]; out[o + 2] = ca[a3 + 2];
      } else if (vb >= 0) {
        var b3 = vb * 3;
        out[o] = cb[b3]; out[o + 1] = cb[b3 + 1]; out[o + 2] = cb[b3 + 2];
      } else {
        out[o] = out[o + 1] = out[o + 2] = 1;
      }
    }
    return out;
  }

  /**
   * Run a boolean of two scene objects and return the resulting geometry in
   * `objA`'s local space, without touching either object.
   *
   * opts: { mode, resolution, smooth, colors }
   */
  Bool.compute = function (objA, objB, opts, onProgress) {
    opts = opts || {};
    var mode = opts.mode || 'union';
    var meshA = worldCopy(objA);
    var meshB = worldCopy(objB);

    if (!Bool.boundsOverlap(meshA, meshB)) {
      if (mode === 'intersect') return { ok: false, reason: 'Those two shapes do not overlap, so the intersection is empty.' };
      if (mode === 'subtract') return { ok: false, reason: 'Those two shapes do not overlap, so there is nothing to subtract.' };
      // a union of separate shapes is fine; the field handles it
    }

    var plan = Bool.plan(meshA, meshB, opts.resolution || 160);
    if (onProgress) onProgress(0.02);
    var fieldA = S.Remesh.buildField(meshA, plan, {}, onProgress && function (f) { onProgress(0.02 + f * 0.4); });
    var fieldB = S.Remesh.buildField(meshB, plan, {}, onProgress && function (f) { onProgress(0.42 + f * 0.4); });
    combine(mode, fieldA, fieldB);
    if (onProgress) onProgress(0.84);

    var net = S.Remesh.surfaceNets(fieldA, plan.dims);
    if (!net.indices.length) {
      return { ok: false, reason: mode === 'intersect'
        ? 'The overlap is too small for this resolution — raise it, or move the shapes together.'
        : 'That left nothing behind. Check the shapes overlap the way you meant.' };
    }
    if (onProgress) onProgress(0.9);

    // sample space -> world
    var pos = net.positions, voxel = plan.voxel, org = plan.origin;
    for (var i = 0; i < pos.length; i += 3) {
      pos[i] = org[0] + pos[i] * voxel;
      pos[i + 1] = org[1] + pos[i + 1] * voxel;
      pos[i + 2] = org[2] + pos[i + 2] * voxel;
    }

    var colors = null;
    if (opts.colors !== false && (S.Remesh.hasPaint(meshA) || S.Remesh.hasPaint(meshB))) {
      colors = transferColors(meshA, meshB, pos, pos.length / 3, voxel * 1.5);
    }

    var repaired = S.splitNonManifoldVertices(pos, net.indices, colors);
    pos = repaired.positions;
    var indices = repaired.indices;
    colors = repaired.colors;

    // world -> objA's local space, so the object keeps its transform
    var inv = objA.inverseMatrix();
    var p = V3.create(0, 0, 0), q = V3.create(0, 0, 0);
    for (var v = 0; v < pos.length; v += 3) {
      V3.set(p, pos[v], pos[v + 1], pos[v + 2]);
      V3.transformMat4(q, p, inv);
      pos[v] = q[0]; pos[v + 1] = q[1]; pos[v + 2] = q[2];
    }
    if (onProgress) onProgress(1);

    return {
      ok: true, positions: pos, indices: indices, colors: colors,
      plan: plan, triCount: indices.length / 3
    };
  };

  /**
   * Apply a boolean to `objA` in place. Returns a summary, or {ok:false}.
   * The caller decides what happens to `objB`.
   */
  Bool.apply = function (objA, objB, opts, onProgress) {
    var res = Bool.compute(objA, objB, opts, onProgress);
    if (!res.ok) return res;
    var before = objA.mesh.liveTris;
    objA.mesh.setFromArrays(res.positions, res.indices, { colors: res.colors, weld: false });
    var merged = objA.mesh.weld(res.plan.voxel * 1e-5);
    var health = { border: objA.mesh.countBorderEdges(), nonManifold: objA.mesh.countNonManifoldEdges() };
    if (health.border || health.nonManifold) {
      // the weld made it worse; rebuild without it
      objA.mesh.setFromArrays(res.positions, res.indices, { colors: res.colors, weld: false });
      merged = 0;
    }
    objA.mesh.removeDegenerateTriangles(res.plan.voxel * res.plan.voxel * 1e-7);
    var passes = opts && opts.smooth !== undefined ? opts.smooth : 1;
    if (passes > 0) objA.mesh.smoothAll(passes, 0.4, false);
    objA.mesh.computeNormals();
    return { ok: true, before: before, after: objA.mesh.liveTris, plan: res.plan, verticesMerged: merged };
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
