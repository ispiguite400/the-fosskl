/*
 * SculptFree — the sculptable mesh.
 *
 * A triangle mesh that supports vertices and triangles being added and
 * removed constantly while a brush is dragging across it. The layout is:
 *
 *   positions/normals/colors  Float32, 3 per vertex
 *   masks                     Float32, 1 per vertex (0 = free, 1 = locked)
 *   tris                      Uint32, 3 vertex indices per triangle
 *   vertTris[v]               indices of the triangles touching vertex v
 *
 * Removed elements are flagged dead and their slots recycled through free
 * lists, so indices stay stable across edits (undo relies on that). compact()
 * squeezes the dead slots out when it is safe to renumber.
 *
 * Picking and brush queries go through one uniform grid of triangles. Each
 * triangle is registered in every cell its bounding box touches, so large
 * triangles are found correctly; entries for triangles that have died or
 * moved are filtered at query time and the grid is rebuilt once the stale
 * entries outnumber the live ones.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var V3 = S.V3, M4 = S.M4;

  var GRID_MAX_DIM = 192;
  var GRID_TRIS_PER_CELL = 4;

  function Mesh() {
    this.positions = S.f32(3 * 64, 3);
    this.normals = S.f32(3 * 64, 3);
    this.colors = S.f32(3 * 64, 3);
    this.masks = S.f32(64, 1);
    this.vertDead = S.u8(64, 1);
    this.vertTris = [];

    this.tris = S.u32(3 * 64, 3);
    this.triDead = S.u8(64, 1);

    this.freeVerts = [];
    this.freeTris = [];
    this.liveVerts = 0;
    this.liveTris = 0;

    // grid
    this.grid = null;
    this.gridEntries = 0;
    this._triStamp = new Int32Array(64);
    this._vertStamp = new Int32Array(64);
    this._stamp = 0;

    /*
     * A serial number per vertex, handed out in order of creation.
     *
     * Dead slots get reused, so a plain vertex index is not a lasting name
     * for a vertex: anything that remembers a vertex across a topology
     * change — the brush engine's record of where a stroke first touched a
     * vertex, for one — has to be able to tell that its index now means
     * somebody else. Without it, a stroke pulled newly split vertices onto
     * a sphere around a dead vertex's old position, which is exactly the
     * fin-shaped glitch that made sculpting look broken.
     *
     * Because the numbers only ever go up, they also say *when* a vertex
     * appeared, which is how the brush engine tells a vertex the
     * refinement has just created from one it has only just reached.
     */
    this.vertBirth = new Float64Array(64);
    this._birthClock = 0;

    // scratch query results, reused to stay allocation-free
    this.qTris = [];
    this.qVerts = [];

    this._bmin = V3.create(0, 0, 0);
    this._bmax = V3.create(0, 0, 0);
    this._boundsDirty = true;

    this.dirtyMinVert = Infinity;
    this.dirtyMaxVert = -1;
    this.topoDirty = true;   // renderer needs a new index buffer
  }
  S.Mesh = Mesh;
  var P = Mesh.prototype;

  P.vertCount = function () { return this.masks.length; };
  P.triCount = function () { return this.triDead.length; };

  /* ------------------------------------------------------------------ *
   * element creation / removal
   * ------------------------------------------------------------------ */

  P.addVertex = function (x, y, z, nx, ny, nz, r, g, b, m) {
    var v;
    if (this.freeVerts.length) {
      v = this.freeVerts.pop();
      this.vertDead.array[v] = 0;
    } else {
      v = this.masks.length;
      this.masks.push(1);
      this.vertDead.push(1);
      this.positions.push(3);
      this.normals.push(3);
      this.colors.push(3);
      this.vertDead.array[v] = 0;
      if (this._vertStamp.length < this.masks.length) {
        var vs = new Int32Array(Math.max(this.masks.length * 2, 64));
        vs.set(this._vertStamp);
        this._vertStamp = vs;
      }
      if (this.vertBirth.length < this.masks.length) {
        var ve = new Float64Array(Math.max(this.masks.length * 2, 64));
        ve.set(this.vertBirth);
        this.vertBirth = ve;
      }
      this.vertTris.length = this.masks.length;
    }
    var i3 = v * 3, p = this.positions.array, n = this.normals.array, c = this.colors.array;
    p[i3] = x; p[i3 + 1] = y; p[i3 + 2] = z;
    n[i3] = nx || 0; n[i3 + 1] = ny || 0; n[i3 + 2] = nz || 0;
    c[i3] = r === undefined ? 1 : r;
    c[i3 + 1] = g === undefined ? 1 : g;
    c[i3 + 2] = b === undefined ? 1 : b;
    this.masks.array[v] = m === undefined ? 0 : m;
    var lst = this.vertTris[v];
    if (lst) lst.length = 0; else this.vertTris[v] = [];
    this.vertBirth[v] = ++this._birthClock;
    this.liveVerts++;
    this.markVertDirty(v);
    this._boundsDirty = true;
    return v;
  };

  P.addTriangle = function (a, b, c) {
    var t;
    if (this.freeTris.length) {
      t = this.freeTris.pop();
      this.triDead.array[t] = 0;
    } else {
      t = this.triDead.length;
      this.triDead.push(1);
      this.triDead.array[t] = 0;
      this.tris.push(3);
      if (this._triStamp.length < this.triDead.length) {
        var ts = new Int32Array(Math.max(this.triDead.length * 2, 64));
        ts.set(this._triStamp);
        this._triStamp = ts;
      }
    }
    var t3 = t * 3, T = this.tris.array;
    T[t3] = a; T[t3 + 1] = b; T[t3 + 2] = c;
    this.vertTris[a].push(t);
    this.vertTris[b].push(t);
    this.vertTris[c].push(t);
    this.liveTris++;
    this.topoDirty = true;
    if (this.grid) this.gridInsertTri(t);
    return t;
  };

  function dropFrom(list, t) {
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i] === t) { list[i] = list[list.length - 1]; list.pop(); return; }
    }
  }

  P.removeTriangle = function (t) {
    if (this.triDead.array[t]) return;
    var t3 = t * 3, T = this.tris.array;
    dropFrom(this.vertTris[T[t3]], t);
    dropFrom(this.vertTris[T[t3 + 1]], t);
    dropFrom(this.vertTris[T[t3 + 2]], t);
    this.triDead.array[t] = 1;
    this.freeTris.push(t);
    this.liveTris--;
    this.topoDirty = true;
  };

  P.removeVertex = function (v) {
    if (this.vertDead.array[v]) return;
    var lst = this.vertTris[v];
    while (lst.length) this.removeTriangle(lst[lst.length - 1]);
    this.vertDead.array[v] = 1;
    this.freeVerts.push(v);
    this.liveVerts--;
    this.topoDirty = true;
  };

  P.markVertDirty = function (v) {
    if (v < this.dirtyMinVert) this.dirtyMinVert = v;
    if (v > this.dirtyMaxVert) this.dirtyMaxVert = v;
  };

  P.clearDirty = function () {
    this.dirtyMinVert = Infinity;
    this.dirtyMaxVert = -1;
  };

  /* ------------------------------------------------------------------ *
   * construction from flat arrays
   * ------------------------------------------------------------------ */

  /**
   * Build from an indexed triangle list. `opts.weld` merges vertices that
   * share a position (needed for STL and other triangle soups, otherwise the
   * surface has no connectivity and smoothing/dyntopo cannot work).
   */
  P.setFromArrays = function (positions, indices, opts) {
    opts = opts || {};
    var i, n;
    this.reset();

    var pos = positions, idx = indices, colors = opts.colors || null;
    if (opts.weld !== false) {
      var welded = S.weldVertices(positions, indices, colors, opts.weldTolerance);
      pos = welded.positions; idx = welded.indices; colors = welded.colors;
    }

    n = pos.length / 3;
    this.positions.setFrom(pos.subarray ? pos.subarray(0, n * 3) : pos, n * 3);
    this.normals.push(n * 3 - this.normals.length);
    this.colors.push(n * 3 - this.colors.length);
    this.masks.push(n - this.masks.length);
    this.vertDead.push(n - this.vertDead.length);
    this.vertDead.view().fill(0);
    this.masks.view().fill(0);
    if (colors) this.colors.array.set(colors.subarray ? colors.subarray(0, n * 3) : colors, 0);
    else this.colors.view().fill(1);
    this.liveVerts = n;
    this.vertTris.length = n;
    for (i = 0; i < n; i++) {
      var l = this.vertTris[i];
      if (l) l.length = 0; else this.vertTris[i] = [];
    }
    if (this._vertStamp.length < n) this._vertStamp = new Int32Array(n + 64);
    if (this.vertBirth.length < n) this.vertBirth = new Float64Array(n + 64);

    // drop degenerate triangles while copying
    var nt = idx.length / 3, kept = 0;
    this.tris.reserve(nt * 3);
    var T = this.tris.array;
    for (i = 0; i < nt; i++) {
      var a = idx[i * 3], b = idx[i * 3 + 1], c = idx[i * 3 + 2];
      if (a === b || b === c || a === c) continue;
      if (a >= n || b >= n || c >= n) continue;
      var k3 = kept * 3;
      T[k3] = a; T[k3 + 1] = b; T[k3 + 2] = c;
      this.vertTris[a].push(kept);
      this.vertTris[b].push(kept);
      this.vertTris[c].push(kept);
      kept++;
    }
    this.tris.length = kept * 3;
    this.triDead.push(kept - this.triDead.length);
    this.triDead.view().fill(0);
    this.liveTris = kept;
    if (this._triStamp.length < kept) this._triStamp = new Int32Array(kept + 64);

    this.removeIsolatedVertices();
    if (opts.normals && opts.normals.length === n * 3 && opts.weld === false) {
      this.normals.array.set(opts.normals, 0);
    } else {
      this.computeNormals();
    }
    this._boundsDirty = true;
    this.topoDirty = true;
    this.gridRebuild();
    return this;
  };

  P.reset = function () {
    this.positions.clear(); this.normals.clear(); this.colors.clear();
    this.masks.clear(); this.vertDead.clear();
    this.tris.clear(); this.triDead.clear();
    this.vertTris.length = 0;
    this.freeVerts.length = 0; this.freeTris.length = 0;
    this.liveVerts = 0; this.liveTris = 0;
    this.grid = null; this.gridEntries = 0;
    this._boundsDirty = true; this.topoDirty = true;
    this.clearDirty();
    return this;
  };

  P.removeIsolatedVertices = function () {
    var n = this.masks.length, removed = 0;
    for (var v = 0; v < n; v++) {
      if (this.vertDead.array[v]) continue;
      if (this.vertTris[v].length === 0) {
        this.vertDead.array[v] = 1;
        this.freeVerts.push(v);
        this.liveVerts--;
        removed++;
      }
    }
    return removed;
  };

  /* ------------------------------------------------------------------ *
   * normals
   * ------------------------------------------------------------------ */

  /** Area-weighted vertex normals. Pass a vertex list to update a subset. */
  P.computeNormals = function (verts, count) {
    var P0 = this.positions.array, N = this.normals.array, T = this.tris.array;
    var i, v, nv;
    if (verts) {
      nv = count === undefined ? verts.length : count;
      for (i = 0; i < nv; i++) { v = verts[i] * 3; N[v] = N[v + 1] = N[v + 2] = 0; }
    } else {
      nv = this.masks.length;
      N.fill(0, 0, nv * 3);
    }

    var nt, t, ti;
    var touch = null;
    if (verts) {
      // accumulate over the triangles around the given vertices only
      this._stamp++;
      var st = this._stamp, stamps = this._triStamp;
      touch = this.qTris; touch.length = 0;
      for (i = 0; i < nv; i++) {
        var lst = this.vertTris[verts[i]];
        for (var j = 0; j < lst.length; j++) {
          t = lst[j];
          if (stamps[t] === st) continue;
          stamps[t] = st;
          touch.push(t);
        }
      }
      nt = touch.length;
    } else {
      nt = this.triDead.length;
    }

    for (ti = 0; ti < nt; ti++) {
      t = touch ? touch[ti] : ti;
      if (this.triDead.array[t]) continue;
      var t3 = t * 3;
      var ia = T[t3] * 3, ib = T[t3 + 1] * 3, ic = T[t3 + 2] * 3;
      var ax = P0[ia], ay = P0[ia + 1], az = P0[ia + 2];
      var e1x = P0[ib] - ax, e1y = P0[ib + 1] - ay, e1z = P0[ib + 2] - az;
      var e2x = P0[ic] - ax, e2y = P0[ic + 1] - ay, e2z = P0[ic + 2] - az;
      var nx = e1y * e2z - e1z * e2y;
      var ny = e1z * e2x - e1x * e2z;
      var nz = e1x * e2y - e1y * e2x;
      N[ia] += nx; N[ia + 1] += ny; N[ia + 2] += nz;
      N[ib] += nx; N[ib + 1] += ny; N[ib + 2] += nz;
      N[ic] += nx; N[ic + 1] += ny; N[ic + 2] += nz;
    }

    // normalize
    if (verts) {
      for (i = 0; i < nv; i++) {
        v = verts[i] * 3;
        var l = Math.sqrt(N[v] * N[v] + N[v + 1] * N[v + 1] + N[v + 2] * N[v + 2]);
        if (l > 1e-20) { l = 1 / l; N[v] *= l; N[v + 1] *= l; N[v + 2] *= l; }
      }
    } else {
      var nvt = this.masks.length;
      for (v = 0; v < nvt; v++) {
        var o = v * 3;
        var l2 = Math.sqrt(N[o] * N[o] + N[o + 1] * N[o + 1] + N[o + 2] * N[o + 2]);
        if (l2 > 1e-20) { l2 = 1 / l2; N[o] *= l2; N[o + 1] *= l2; N[o + 2] *= l2; }
      }
    }
    return this;
  };

  /** The vertices around `v`, written into `out` (an array). */
  P.ringVerts = function (v, out) {
    out.length = 0;
    var lst = this.vertTris[v], T = this.tris.array;
    for (var i = 0; i < lst.length; i++) {
      var t3 = lst[i] * 3;
      for (var k = 0; k < 3; k++) {
        var w = T[t3 + k];
        if (w === v) continue;
        var seen = false;
        for (var j = 0; j < out.length; j++) if (out[j] === w) { seen = true; break; }
        if (!seen) out.push(w);
      }
    }
    return out;
  };

  /**
   * True when the triangle fan around `v` is open. Border vertices are held
   * still by the smoothing and collapse code so open meshes keep their edges.
   */
  P.isBorderVert = function (v) {
    var lst = this.vertTris[v], T = this.tris.array, n = lst.length;
    if (n === 0) return true;
    // every edge through v must be shared by exactly two incident triangles
    for (var i = 0; i < n; i++) {
      var t3 = lst[i] * 3;
      var a = T[t3], b = T[t3 + 1], c = T[t3 + 2];
      var o1, o2;
      if (a === v) { o1 = b; o2 = c; } else if (b === v) { o1 = c; o2 = a; } else { o1 = a; o2 = b; }
      if (this.countEdgeTris(v, o1) !== 2 || this.countEdgeTris(v, o2) !== 2) return true;
    }
    return false;
  };

  P.countEdgeTris = function (a, b) {
    var lst = this.vertTris[a], T = this.tris.array, n = 0;
    for (var i = 0; i < lst.length; i++) {
      var t3 = lst[i] * 3;
      if (T[t3] === b || T[t3 + 1] === b || T[t3 + 2] === b) n++;
    }
    return n;
  };

  /** The (at most two) triangles sharing edge a-b. */
  P.edgeTris = function (a, b, out) {
    out.length = 0;
    var lst = this.vertTris[a], T = this.tris.array;
    for (var i = 0; i < lst.length; i++) {
      var t = lst[i], t3 = t * 3;
      if (T[t3] === b || T[t3 + 1] === b || T[t3 + 2] === b) out.push(t);
    }
    return out;
  };

  /* ------------------------------------------------------------------ *
   * bounds and transforms
   * ------------------------------------------------------------------ */

  P.bounds = function () {
    if (!this._boundsDirty) return this;
    var p = this.positions.array, n = this.masks.length;
    var minx = Infinity, miny = Infinity, minz = Infinity;
    var maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (var v = 0; v < n; v++) {
      if (this.vertDead.array[v]) continue;
      var i = v * 3, x = p[i], y = p[i + 1], z = p[i + 2];
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    if (minx > maxx) { minx = miny = minz = -0.5; maxx = maxy = maxz = 0.5; }
    V3.set(this._bmin, minx, miny, minz);
    V3.set(this._bmax, maxx, maxy, maxz);
    this._boundsDirty = false;
    return this;
  };

  P.boundsMin = function () { this.bounds(); return this._bmin; };
  P.boundsMax = function () { this.bounds(); return this._bmax; };

  P.boundsCenter = function (out) {
    this.bounds();
    return V3.set(out, (this._bmin[0] + this._bmax[0]) / 2,
                       (this._bmin[1] + this._bmax[1]) / 2,
                       (this._bmin[2] + this._bmax[2]) / 2);
  };

  P.boundsRadius = function () {
    this.bounds();
    var dx = this._bmax[0] - this._bmin[0];
    var dy = this._bmax[1] - this._bmin[1];
    var dz = this._bmax[2] - this._bmin[2];
    return 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  /** Mean edge length over a sample of triangles — the natural detail unit. */
  P.averageEdgeLength = function () {
    var T = this.tris.array, p = this.positions.array;
    var nt = this.triDead.length;
    if (!this.liveTris) return 1;
    var step = Math.max(1, Math.floor(nt / 4000));
    var sum = 0, count = 0;
    for (var t = 0; t < nt; t += step) {
      if (this.triDead.array[t]) continue;
      var t3 = t * 3;
      var ia = T[t3] * 3, ib = T[t3 + 1] * 3;
      var dx = p[ia] - p[ib], dy = p[ia + 1] - p[ib + 1], dz = p[ia + 2] - p[ib + 2];
      sum += Math.sqrt(dx * dx + dy * dy + dz * dz);
      count++;
    }
    return count ? sum / count : 1;
  };

  P.applyMatrix = function (m) {
    var p = this.positions.array, n = this.masks.length;
    var v = V3.create(0, 0, 0), o = V3.create(0, 0, 0);
    for (var i = 0; i < n; i++) {
      if (this.vertDead.array[i]) continue;
      var i3 = i * 3;
      V3.set(v, p[i3], p[i3 + 1], p[i3 + 2]);
      V3.transformMat4(o, v, m);
      p[i3] = o[0]; p[i3 + 1] = o[1]; p[i3 + 2] = o[2];
    }
    // a negative determinant mirrors the mesh, which flips the winding
    var det = m[0] * (m[5] * m[10] - m[6] * m[9])
            - m[4] * (m[1] * m[10] - m[2] * m[9])
            + m[8] * (m[1] * m[6] - m[2] * m[5]);
    if (det < 0) this.flipNormals(true);
    this._boundsDirty = true;
    this.computeNormals();
    this.gridRebuild();
    this.dirtyMinVert = 0; this.dirtyMaxVert = n - 1;
    return this;
  };

  P.flipNormals = function (skipRecompute) {
    var T = this.tris.array, nt = this.triDead.length;
    for (var t = 0; t < nt; t++) {
      if (this.triDead.array[t]) continue;
      var t3 = t * 3, tmp = T[t3 + 1];
      T[t3 + 1] = T[t3 + 2]; T[t3 + 2] = tmp;
    }
    this.topoDirty = true;
    if (!skipRecompute) this.computeNormals();
    return this;
  };

  /** Move the mesh so its bounding box centre sits at the origin. */
  P.centerOrigin = function () {
    var c = V3.create(0, 0, 0);
    this.boundsCenter(c);
    var p = this.positions.array, n = this.masks.length;
    for (var v = 0; v < n; v++) {
      if (this.vertDead.array[v]) continue;
      var i = v * 3;
      p[i] -= c[0]; p[i + 1] -= c[1]; p[i + 2] -= c[2];
    }
    this._boundsDirty = true;
    this.gridRebuild();
    this.dirtyMinVert = 0; this.dirtyMaxVert = n - 1;
    return c;
  };

  /* ------------------------------------------------------------------ *
   * uniform triangle grid
   * ------------------------------------------------------------------ */

  P.gridRebuild = function () {
    if (!this.liveTris) { this.grid = null; return; }
    this._boundsDirty = true;
    this.bounds();
    /*
     * Padding. The grid's box has to hold what the model is about to become,
     * not only what it is: an Add brush grows the surface outwards, and
     * geometry that leaves the box has to be clamped into the edge cells
     * until the next rebuild (see `gridInsertTri`). A margin of a few per
     * cent of the model means ordinary sculpting stays inside the box, so
     * that clamping — and the rebuilds it triggers — stay rare.
     */
    var pad = Math.max(1e-4, this.averageEdgeLength());
    var minx = this._bmin[0] - pad, miny = this._bmin[1] - pad, minz = this._bmin[2] - pad;
    var sx = (this._bmax[0] + pad) - minx;
    var sy = (this._bmax[1] + pad) - miny;
    var sz = (this._bmax[2] + pad) - minz;
    var maxSide = Math.max(sx, sy, sz, 1e-6);
    var grow = maxSide * 0.06;
    minx -= grow; miny -= grow; minz -= grow;
    sx += grow * 2; sy += grow * 2; sz += grow * 2;
    maxSide = Math.max(sx, sy, sz, 1e-6);

    var targetCells = Math.max(8, this.liveTris / GRID_TRIS_PER_CELL);
    var cell = maxSide / Math.min(GRID_MAX_DIM, Math.max(2, Math.cbrt(targetCells) * (maxSide / Math.cbrt(sx * sy * sz || 1e-9) > 8 ? 1 : 1)));
    // dimension per axis from a single cell size, capped so memory stays sane
    var dim = Math.min(GRID_MAX_DIM, Math.max(2, Math.round(Math.cbrt(targetCells))));
    cell = maxSide / dim;
    var dx = Math.max(1, Math.min(GRID_MAX_DIM, Math.ceil(sx / cell)));
    var dy = Math.max(1, Math.min(GRID_MAX_DIM, Math.ceil(sy / cell)));
    var dz = Math.max(1, Math.min(GRID_MAX_DIM, Math.ceil(sz / cell)));

    var g = this.grid;
    var nCells = dx * dy * dz;
    if (!g || g.buckets.length < nCells) {
      g = this.grid = { min: V3.create(0, 0, 0), cell: cell, inv: 1 / cell,
                        dx: dx, dy: dy, dz: dz, buckets: new Array(nCells) };
    } else {
      for (var i = 0; i < g.buckets.length; i++) { var b = g.buckets[i]; if (b) b.length = 0; }
      g.cell = cell; g.inv = 1 / cell; g.dx = dx; g.dy = dy; g.dz = dz;
    }
    V3.set(g.min, minx, miny, minz);
    this.gridEntries = 0;
    this.gridOutside = 0;

    var nt = this.triDead.length;
    for (var t = 0; t < nt; t++) {
      if (this.triDead.array[t]) continue;
      this.gridInsertTri(t);
    }
  };

  P.gridInsertTri = function (t) {
    var g = this.grid;
    if (!g) return;
    var T = this.tris.array, p = this.positions.array, t3 = t * 3;
    var ia = T[t3] * 3, ib = T[t3 + 1] * 3, ic = T[t3 + 2] * 3;
    var ax = p[ia], ay = p[ia + 1], az = p[ia + 2];
    var bx = p[ib], by = p[ib + 1], bz = p[ib + 2];
    var cx = p[ic], cy = p[ic + 1], cz = p[ic + 2];
    var inv = g.inv, mn = g.min;
    var x0 = Math.floor((Math.min(ax, bx, cx) - mn[0]) * inv);
    var x1 = Math.floor((Math.max(ax, bx, cx) - mn[0]) * inv);
    var y0 = Math.floor((Math.min(ay, by, cy) - mn[1]) * inv);
    var y1 = Math.floor((Math.max(ay, by, cy) - mn[1]) * inv);
    var z0 = Math.floor((Math.min(az, bz, cz) - mn[2]) * inv);
    var z1 = Math.floor((Math.max(az, bz, cz) - mn[2]) * inv);
    /*
     * A triangle outside the box goes into the nearest edge cells, never
     * nowhere.
     *
     * Dropping it — which is what this used to do — made the geometry
     * invisible to every grid query: the brush could not find those
     * vertices, so it stopped working on the bump it had just built;
     * dynamic topology could not refine them, so they stretched into fins;
     * and a tap could not hit them. Measured on a sphere with Add at full
     * strength, six passes grew the model past its own grid and a query
     * that should have found 747 vertices found none. Clamping keeps every
     * query honest, and `gridOutside` tells the caller to rebuild.
     */
    var outside = (x0 < 0 || y0 < 0 || z0 < 0 || x1 >= g.dx || y1 >= g.dy || z1 >= g.dz);
    if (x0 < 0) x0 = 0; else if (x0 >= g.dx) x0 = g.dx - 1;
    if (y0 < 0) y0 = 0; else if (y0 >= g.dy) y0 = g.dy - 1;
    if (z0 < 0) z0 = 0; else if (z0 >= g.dz) z0 = g.dz - 1;
    if (x1 >= g.dx) x1 = g.dx - 1; else if (x1 < 0) x1 = 0;
    if (y1 >= g.dy) y1 = g.dy - 1; else if (y1 < 0) y1 = 0;
    if (z1 >= g.dz) z1 = g.dz - 1; else if (z1 < 0) z1 = 0;
    if (outside) this.gridOutside = (this.gridOutside || 0) + 1;
    var buckets = g.buckets, dxdy = g.dx * g.dy;
    for (var z = z0; z <= z1; z++) {
      var zo = z * dxdy;
      for (var y = y0; y <= y1; y++) {
        var yo = zo + y * g.dx;
        for (var x = x0; x <= x1; x++) {
          var k = yo + x;
          var b = buckets[k];
          if (b) b.push(t); else buckets[k] = [t];
          this.gridEntries++;
        }
      }
    }
  };

  /** Re-register the triangles around the given vertices after they moved. */
  P.gridUpdateVerts = function (verts, count) {
    var g = this.grid;
    if (!g) return;
    var n = count === undefined ? verts.length : count;
    this._stamp++;
    var st = this._stamp, stamps = this._triStamp;
    var out = false;
    for (var i = 0; i < n; i++) {
      var lst = this.vertTris[verts[i]];
      for (var j = 0; j < lst.length; j++) {
        var t = lst[j];
        if (stamps[t] === st) continue;
        stamps[t] = st;
        this.gridInsertTri(t);
      }
    }
    // rebuild once the stale entries dominate, or the mesh outgrew the box
    if (this.gridOutside || this.gridEntries > this.liveTris * 6 + 4096) this.gridRebuild();
    return out;
  };

  P.gridMaybeRebuild = function () {
    if (!this.grid) { this.gridRebuild(); return; }
    if (this.gridOutside || this.gridEntries > this.liveTris * 4 + 2048) this.gridRebuild();
  };

  /**
   * Triangles whose cells overlap the sphere. Results land in `this.qTris`,
   * which is reused between calls.
   */
  P.trisInSphere = function (cx, cy, cz, r) {
    var out = this.qTris;
    out.length = 0;
    var g = this.grid;
    if (!g) {
      var nt = this.triDead.length;
      for (var t = 0; t < nt; t++) if (!this.triDead.array[t]) out.push(t);
      return out;
    }
    var inv = g.inv, mn = g.min;
    var x0 = Math.floor((cx - r - mn[0]) * inv), x1 = Math.floor((cx + r - mn[0]) * inv);
    var y0 = Math.floor((cy - r - mn[1]) * inv), y1 = Math.floor((cy + r - mn[1]) * inv);
    var z0 = Math.floor((cz - r - mn[2]) * inv), z1 = Math.floor((cz + r - mn[2]) * inv);
    // a sphere outside the box still has to look in the edge cells, because
    // that is where geometry outside the box was clamped to
    if (x0 < 0) x0 = 0; else if (x0 >= g.dx) x0 = g.dx - 1;
    if (y0 < 0) y0 = 0; else if (y0 >= g.dy) y0 = g.dy - 1;
    if (z0 < 0) z0 = 0; else if (z0 >= g.dz) z0 = g.dz - 1;
    if (x1 >= g.dx) x1 = g.dx - 1; else if (x1 < 0) x1 = 0;
    if (y1 >= g.dy) y1 = g.dy - 1; else if (y1 < 0) y1 = 0;
    if (z1 >= g.dz) z1 = g.dz - 1; else if (z1 < 0) z1 = 0;
    this._stamp++;
    var st = this._stamp, stamps = this._triStamp, dead = this.triDead.array;
    var buckets = g.buckets, dxdy = g.dx * g.dy;
    for (var z = z0; z <= z1; z++) {
      var zo = z * dxdy;
      for (var y = y0; y <= y1; y++) {
        var yo = zo + y * g.dx;
        for (var x = x0; x <= x1; x++) {
          var b = buckets[yo + x];
          if (!b) continue;
          for (var i = 0; i < b.length; i++) {
            var t2 = b[i];
            if (stamps[t2] === st || dead[t2]) continue;
            stamps[t2] = st;
            out.push(t2);
          }
        }
      }
    }
    return out;
  };

  /**
   * Vertices inside the sphere, written to `this.qVerts`. Built from the
   * triangles in range, so every live vertex in the sphere is found.
   */
  P.vertsInSphere = function (cx, cy, cz, r) {
    var tris = this.trisInSphere(cx, cy, cz, r);
    var out = this.qVerts;
    out.length = 0;
    this._stamp++;
    var st = this._stamp, stamps = this._vertStamp;
    var T = this.tris.array, p = this.positions.array, r2 = r * r;
    for (var i = 0; i < tris.length; i++) {
      var t3 = tris[i] * 3;
      for (var k = 0; k < 3; k++) {
        var v = T[t3 + k];
        if (stamps[v] === st) continue;
        stamps[v] = st;
        var i3 = v * 3;
        var dx = p[i3] - cx, dy = p[i3 + 1] - cy, dz = p[i3 + 2] - cz;
        if (dx * dx + dy * dy + dz * dz <= r2) out.push(v);
      }
    }
    return out;
  };

  /**
   * Closest ray hit. `out` receives {t, tri, x, y, z}. Walks the grid cell by
   * cell (Amanatides & Woo) and stops as soon as the best hit is closer than
   * the exit point of the cell being tested.
   */
  P.raycast = function (ox, oy, oz, dx, dy, dz, out, cull) {
    out.t = Infinity; out.tri = -1;
    var g = this.grid;
    var T = this.tris.array, p = this.positions.array;
    var t3, ia, ib, ic, hit;

    if (!g) {
      var nt = this.triDead.length;
      for (var t = 0; t < nt; t++) {
        if (this.triDead.array[t]) continue;
        t3 = t * 3; ia = T[t3] * 3; ib = T[t3 + 1] * 3; ic = T[t3 + 2] * 3;
        hit = S.rayTriangle(ox, oy, oz, dx, dy, dz,
          p[ia], p[ia + 1], p[ia + 2], p[ib], p[ib + 1], p[ib + 2], p[ic], p[ic + 1], p[ic + 2], cull);
        if (hit > 1e-5 && hit < out.t) { out.t = hit; out.tri = t; }
      }
      if (out.tri >= 0) { out.x = ox + dx * out.t; out.y = oy + dy * out.t; out.z = oz + dz * out.t; }
      return out.tri >= 0;
    }

    var cell = g.cell, mn = g.min;
    var gmax = [mn[0] + g.dx * cell, mn[1] + g.dy * cell, mn[2] + g.dz * cell];
    var span = this._raySpan || (this._raySpan = new Float64Array(2));
    if (!S.rayAABB(ox, oy, oz, dx, dy, dz, mn, gmax, span)) return false;
    var tEnter = Math.max(span[0], 0);

    var px = ox + dx * tEnter, py = oy + dy * tEnter, pz = oz + dz * tEnter;
    var ix = Math.floor((px - mn[0]) / cell);
    var iy = Math.floor((py - mn[1]) / cell);
    var iz = Math.floor((pz - mn[2]) / cell);
    if (ix < 0) ix = 0; else if (ix >= g.dx) ix = g.dx - 1;
    if (iy < 0) iy = 0; else if (iy >= g.dy) iy = g.dy - 1;
    if (iz < 0) iz = 0; else if (iz >= g.dz) iz = g.dz - 1;

    var stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    var tDeltaX = Math.abs(cell / (dx || 1e-30));
    var tDeltaY = Math.abs(cell / (dy || 1e-30));
    var tDeltaZ = Math.abs(cell / (dz || 1e-30));
    function firstCross(originComp, dirComp, minComp, idx) {
      if (dirComp === 0) return Infinity;
      var boundary = minComp + (dirComp > 0 ? (idx + 1) : idx) * cell;
      return (boundary - originComp) / dirComp;
    }
    var tMaxX = firstCross(ox, dx, mn[0], ix);
    var tMaxY = firstCross(oy, dy, mn[1], iy);
    var tMaxZ = firstCross(oz, dz, mn[2], iz);

    this._stamp++;
    var st = this._stamp, stamps = this._triStamp, dead = this.triDead.array;
    var buckets = g.buckets, dxdy = g.dx * g.dy;
    var guard = (g.dx + g.dy + g.dz) * 3 + 8;

    while (guard-- > 0) {
      var b = buckets[iz * dxdy + iy * g.dx + ix];
      if (b) {
        for (var i = 0; i < b.length; i++) {
          var tt = b[i];
          if (stamps[tt] === st || dead[tt]) continue;
          stamps[tt] = st;
          t3 = tt * 3; ia = T[t3] * 3; ib = T[t3 + 1] * 3; ic = T[t3 + 2] * 3;
          hit = S.rayTriangle(ox, oy, oz, dx, dy, dz,
            p[ia], p[ia + 1], p[ia + 2], p[ib], p[ib + 1], p[ib + 2], p[ic], p[ic + 1], p[ic + 2], cull);
          if (hit > 1e-6 && hit < out.t) { out.t = hit; out.tri = tt; }
        }
      }
      // exit parameter of the current cell
      var tExit = Math.min(tMaxX, tMaxY, tMaxZ);
      if (out.tri >= 0 && out.t <= tExit) break;
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) { ix += stepX; if (ix < 0 || ix >= g.dx) break; tMaxX += tDeltaX; }
        else { iz += stepZ; if (iz < 0 || iz >= g.dz) break; tMaxZ += tDeltaZ; }
      } else {
        if (tMaxY < tMaxZ) { iy += stepY; if (iy < 0 || iy >= g.dy) break; tMaxY += tDeltaY; }
        else { iz += stepZ; if (iz < 0 || iz >= g.dz) break; tMaxZ += tDeltaZ; }
      }
    }

    if (out.tri >= 0) {
      out.x = ox + dx * out.t; out.y = oy + dy * out.t; out.z = oz + dz * out.t;
      return true;
    }
    return false;
  };

  /** Interpolated normal at a hit point, for orienting the brush cursor. */
  P.triNormal = function (t, out) {
    var T = this.tris.array, p = this.positions.array, t3 = t * 3;
    var ia = T[t3] * 3, ib = T[t3 + 1] * 3, ic = T[t3 + 2] * 3;
    var e1x = p[ib] - p[ia], e1y = p[ib + 1] - p[ia + 1], e1z = p[ib + 2] - p[ia + 2];
    var e2x = p[ic] - p[ia], e2y = p[ic + 1] - p[ia + 1], e2z = p[ic + 2] - p[ia + 2];
    V3.set(out, e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
    return V3.normalize(out, out);
  };

  /* ------------------------------------------------------------------ *
   * compaction, copies and export views
   * ------------------------------------------------------------------ */

  /** Renumber so no dead slots remain. Invalidates stored vertex indices. */
  P.compact = function () {
    var nv = this.masks.length, nt = this.triDead.length;
    if (!this.freeVerts.length && !this.freeTris.length) return this;
    var map = new Int32Array(nv).fill(-1);
    var pos = this.positions.array, nor = this.normals.array, col = this.colors.array, msk = this.masks.array;
    var w = 0, v, i3, w3;
    for (v = 0; v < nv; v++) {
      if (this.vertDead.array[v]) continue;
      map[v] = w;
      if (w !== v) {
        i3 = v * 3; w3 = w * 3;
        pos[w3] = pos[i3]; pos[w3 + 1] = pos[i3 + 1]; pos[w3 + 2] = pos[i3 + 2];
        nor[w3] = nor[i3]; nor[w3 + 1] = nor[i3 + 1]; nor[w3 + 2] = nor[i3 + 2];
        col[w3] = col[i3]; col[w3 + 1] = col[i3 + 1]; col[w3 + 2] = col[i3 + 2];
        msk[w] = msk[v];
      }
      w++;
    }
    var T = this.tris.array, wt = 0, t, t3;
    for (t = 0; t < nt; t++) {
      if (this.triDead.array[t]) continue;
      t3 = t * 3;
      var a = map[T[t3]], b = map[T[t3 + 1]], c = map[T[t3 + 2]];
      var o3 = wt * 3;
      T[o3] = a; T[o3 + 1] = b; T[o3 + 2] = c;
      wt++;
    }
    this.positions.length = w * 3;
    this.normals.length = w * 3;
    this.colors.length = w * 3;
    this.masks.length = w;
    this.vertDead.length = w;
    this.vertDead.view().fill(0);
    this.tris.length = wt * 3;
    this.triDead.length = wt;
    this.triDead.view().fill(0);
    this.liveVerts = w; this.liveTris = wt;
    this.freeVerts.length = 0; this.freeTris.length = 0;
    this.vertTris.length = w;
    for (v = 0; v < w; v++) { var l = this.vertTris[v]; if (l) l.length = 0; else this.vertTris[v] = []; }
    for (t = 0; t < wt; t++) {
      t3 = t * 3;
      this.vertTris[T[t3]].push(t);
      this.vertTris[T[t3 + 1]].push(t);
      this.vertTris[T[t3 + 2]].push(t);
    }
    this.topoDirty = true;
    this.dirtyMinVert = 0; this.dirtyMaxVert = w - 1;
    this.gridRebuild();
    return this;
  };

  /** Tight copies of the live geometry — what exporters and tests consume. */
  P.toIndexed = function () {
    var nv = this.masks.length, nt = this.triDead.length;
    var map = new Int32Array(nv).fill(-1);
    var positions = new Float32Array(this.liveVerts * 3);
    var normals = new Float32Array(this.liveVerts * 3);
    var colors = new Float32Array(this.liveVerts * 3);
    var pos = this.positions.array, nor = this.normals.array, col = this.colors.array;
    var w = 0, v, i3, w3;
    for (v = 0; v < nv; v++) {
      if (this.vertDead.array[v]) continue;
      map[v] = w; i3 = v * 3; w3 = w * 3;
      positions[w3] = pos[i3]; positions[w3 + 1] = pos[i3 + 1]; positions[w3 + 2] = pos[i3 + 2];
      normals[w3] = nor[i3]; normals[w3 + 1] = nor[i3 + 1]; normals[w3 + 2] = nor[i3 + 2];
      colors[w3] = col[i3]; colors[w3 + 1] = col[i3 + 1]; colors[w3 + 2] = col[i3 + 2];
      w++;
    }
    var IdxCtor = w > 65535 ? Uint32Array : Uint16Array;
    var indices = new IdxCtor(this.liveTris * 3);
    var big = new Uint32Array(this.liveTris * 3);
    var T = this.tris.array, wt = 0;
    for (var t = 0; t < nt; t++) {
      if (this.triDead.array[t]) continue;
      var t3 = t * 3, o3 = wt * 3;
      big[o3] = map[T[t3]]; big[o3 + 1] = map[T[t3 + 1]]; big[o3 + 2] = map[T[t3 + 2]];
      wt++;
    }
    indices.set(big);
    return { positions: positions, normals: normals, colors: colors,
             indices: indices, indices32: big, vertCount: w, triCount: wt };
  };

  P.clone = function () {
    var m = new Mesh();
    m.positions.setFrom(this.positions.view());
    m.normals.setFrom(this.normals.view());
    m.colors.setFrom(this.colors.view());
    m.masks.setFrom(this.masks.view());
    m.vertDead.setFrom(this.vertDead.view());
    m.tris.setFrom(this.tris.view());
    m.triDead.setFrom(this.triDead.view());
    m.liveVerts = this.liveVerts; m.liveTris = this.liveTris;
    m.freeVerts = this.freeVerts.slice();
    m.freeTris = this.freeTris.slice();
    m.vertTris.length = this.vertTris.length;
    for (var v = 0; v < this.vertTris.length; v++) {
      m.vertTris[v] = this.vertTris[v] ? this.vertTris[v].slice() : [];
    }
    m._triStamp = new Int32Array(this._triStamp.length);
    m._vertStamp = new Int32Array(this._vertStamp.length);
    m.vertBirth = new Float64Array(this.vertBirth.length);
    m._birthClock = 0;
    m._boundsDirty = true;
    m.topoDirty = true;
    m.gridRebuild();
    return m;
  };

  /** Snapshot for undo. Typed-array copies of everything indices depend on. */
  P.snapshot = function () {
    return {
      positions: this.positions.copy(),
      normals: this.normals.copy(),
      colors: this.colors.copy(),
      masks: this.masks.copy(),
      vertDead: this.vertDead.copy(),
      tris: this.tris.copy(),
      triDead: this.triDead.copy(),
      liveVerts: this.liveVerts,
      liveTris: this.liveTris,
      freeVerts: this.freeVerts.slice(),
      freeTris: this.freeTris.slice()
    };
  };

  P.snapshotBytes = function (s) {
    return s.positions.byteLength + s.normals.byteLength + s.colors.byteLength +
           s.masks.byteLength + s.vertDead.byteLength + s.tris.byteLength +
           s.triDead.byteLength + (s.freeVerts.length + s.freeTris.length) * 8;
  };

  P.restore = function (s) {
    this.positions.setFrom(s.positions);
    this.normals.setFrom(s.normals);
    this.colors.setFrom(s.colors);
    this.masks.setFrom(s.masks);
    this.vertDead.setFrom(s.vertDead);
    this.tris.setFrom(s.tris);
    this.triDead.setFrom(s.triDead);
    this.liveVerts = s.liveVerts;
    this.liveTris = s.liveTris;
    this.freeVerts = s.freeVerts.slice();
    this.freeTris = s.freeTris.slice();
    var nv = this.masks.length;
    this.vertTris.length = nv;
    for (var v = 0; v < nv; v++) { var l = this.vertTris[v]; if (l) l.length = 0; else this.vertTris[v] = []; }
    var T = this.tris.array, nt = this.triDead.length;
    for (var t = 0; t < nt; t++) {
      if (this.triDead.array[t]) continue;
      var t3 = t * 3;
      this.vertTris[T[t3]].push(t);
      this.vertTris[T[t3 + 1]].push(t);
      this.vertTris[T[t3 + 2]].push(t);
    }
    if (this._vertStamp.length < nv) this._vertStamp = new Int32Array(nv + 64);
    if (this._triStamp.length < nt) this._triStamp = new Int32Array(nt + 64);
    // every slot may mean a different vertex now, so no remembered index
    // from before the restore is allowed to look valid (see `vertBirth`)
    if (this.vertBirth.length < nv) this.vertBirth = new Float64Array(nv + 64);
    else this.vertBirth.fill(0);
    this._boundsDirty = true;
    this.topoDirty = true;
    this.dirtyMinVert = 0; this.dirtyMaxVert = nv - 1;
    this.gridRebuild();
    return this;
  };

  /* ------------------------------------------------------------------ *
   * welding (shared by importers and the "merge vertices" command)
   * ------------------------------------------------------------------ */

  /**
   * Merge vertices that sit within `tol` of each other on a lattice. Returns
   * new positions/indices/colors. Triangle soups (STL) need this before they
   * can be sculpted.
   */
  S.weldVertices = function (positions, indices, colors, tol) {
    var n = positions.length / 3;
    var minx = Infinity, miny = Infinity, minz = Infinity;
    var maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    var i, i3;
    for (i = 0; i < n; i++) {
      i3 = i * 3;
      var x = positions[i3], y = positions[i3 + 1], z = positions[i3 + 2];
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    if (!(minx <= maxx)) { minx = miny = minz = 0; maxx = maxy = maxz = 1; }
    var diag = Math.max(maxx - minx, maxy - miny, maxz - minz, 1e-9);
    var eps = tol === undefined || tol === null ? diag * 1e-5 : tol;
    if (eps <= 0) eps = diag * 1e-7;
    var inv = 1 / eps;

    var map = new Int32Array(n);
    var table = new Map();
    var outPos = new Float32Array(n * 3);
    var outCol = colors ? new Float32Array(n * 3) : null;
    var w = 0;
    for (i = 0; i < n; i++) {
      i3 = i * 3;
      var gx = Math.round((positions[i3] - minx) * inv);
      var gy = Math.round((positions[i3 + 1] - miny) * inv);
      var gz = Math.round((positions[i3 + 2] - minz) * inv);
      var key = gx + ',' + gy + ',' + gz;
      var found = table.get(key);
      if (found === undefined) {
        table.set(key, w);
        var w3 = w * 3;
        outPos[w3] = positions[i3]; outPos[w3 + 1] = positions[i3 + 1]; outPos[w3 + 2] = positions[i3 + 2];
        if (outCol) { outCol[w3] = colors[i3]; outCol[w3 + 1] = colors[i3 + 1]; outCol[w3 + 2] = colors[i3 + 2]; }
        map[i] = w;
        w++;
      } else {
        map[i] = found;
      }
    }
    var outIdx = new Uint32Array(indices.length);
    for (i = 0; i < indices.length; i++) outIdx[i] = map[indices[i]];
    return {
      positions: outPos.subarray(0, w * 3),
      colors: outCol ? outCol.subarray(0, w * 3) : null,
      indices: outIdx,
      map: map,
      vertCount: w
    };
  };

  /* ------------------------------------------------------------------ *
   * non-manifold repair
   * ------------------------------------------------------------------ */

  /**
   * Split vertices that two separate sheets of surface share, so that every
   * edge ends up with at most two faces.
   *
   * Dual-contouring a voxel field (the voxel remesh) places exactly one
   * vertex in each cell the surface crosses. Where the surface nearly
   * touches itself, two sheets pass through the same cell and end up sharing
   * that single vertex, which leaves edges with four faces. Geometrically
   * the result looks right, but it is not a manifold: half-edge reasoning
   * breaks, and exporters and game engines are entitled to complain.
   *
   * The repair changes no positions. Around each vertex the incident
   * triangles are grouped into fans, walking only through edges that have
   * exactly two faces; each fan beyond the first gets its own copy of the
   * vertex.
   */
  S.splitNonManifoldVertices = function (positions, indices, colors) {
    var nv = positions.length / 3;
    var nt = indices.length / 3;

    // vertex -> incident triangles, as CSR
    var counts = new Uint32Array(nv + 1);
    var i, t, k, v;
    for (i = 0; i < indices.length; i++) counts[indices[i]]++;
    var start = new Uint32Array(nv + 1);
    var acc = 0;
    for (v = 0; v < nv; v++) { start[v] = acc; acc += counts[v]; }
    start[nv] = acc;
    var fill = start.slice();
    var vertTris = new Uint32Array(acc);
    for (t = 0; t < nt; t++) {
      for (k = 0; k < 3; k++) vertTris[fill[indices[t * 3 + k]]++] = t;
    }

    // edge -> how many faces, plus the first two triangle ids
    var edgeCount = new Map();
    function edgeKey(a, b) { return a < b ? a * nv + b : b * nv + a; }
    for (t = 0; t < nt; t++) {
      var o = t * 3;
      for (k = 0; k < 3; k++) {
        var key = edgeKey(indices[o + k], indices[o + (k + 1) % 3]);
        var rec = edgeCount.get(key);
        if (rec === undefined) edgeCount.set(key, 1);
        else edgeCount.set(key, rec + 1);
      }
    }

    // for an edge with exactly two faces, which triangle is the other one?
    var pairA = new Map();
    for (t = 0; t < nt; t++) {
      var o2 = t * 3;
      for (k = 0; k < 3; k++) {
        var key2 = edgeKey(indices[o2 + k], indices[o2 + (k + 1) % 3]);
        if (edgeCount.get(key2) !== 2) continue;
        var prev = pairA.get(key2);
        if (prev === undefined) pairA.set(key2, t);
      }
    }
    function otherFace(a, b, t) {
      var key = edgeKey(a, b);
      if (edgeCount.get(key) !== 2) return -1;
      var first = pairA.get(key);
      if (first !== t) return first;
      // the stored one is this triangle, so find the partner by scanning the
      // incident list of `a`, which is short
      for (var j = start[a]; j < start[a + 1]; j++) {
        var cand = vertTris[j];
        if (cand === t) continue;
        var co = cand * 3;
        if (indices[co] === b || indices[co + 1] === b || indices[co + 2] === b) return cand;
      }
      return -1;
    }

    var outPositions = null, outColors = null;
    var extra = [];                      // new vertices: source index
    var remap = new Map();               // (tri * 3 + corner) -> new vertex
    var groupStamp = new Int32Array(nt).fill(-1);
    var stack = [];
    var splits = 0;

    for (v = 0; v < nv; v++) {
      var from = start[v], to = start[v + 1];
      if (to - from < 2) continue;
      var group = 0;
      for (var s = from; s < to; s++) {
        var seed = vertTris[s];
        if (groupStamp[seed] === v) continue;   // already in a fan for this vertex
        // walk the fan
        stack.length = 0;
        stack.push(seed);
        groupStamp[seed] = v;
        var fan = [];
        while (stack.length) {
          var cur = stack.pop();
          fan.push(cur);
          var co2 = cur * 3;
          var a = indices[co2], b = indices[co2 + 1], c = indices[co2 + 2];
          var o1, o3;
          if (a === v) { o1 = b; o3 = c; } else if (b === v) { o1 = c; o3 = a; } else { o1 = a; o3 = b; }
          for (var e = 0; e < 2; e++) {
            var nb = otherFace(v, e === 0 ? o1 : o3, cur);
            if (nb >= 0 && groupStamp[nb] !== v) {
              groupStamp[nb] = v;
              stack.push(nb);
            }
          }
        }
        if (group > 0) {
          // this fan gets its own copy of the vertex
          var newIndex = nv + extra.length;
          extra.push(v);
          splits++;
          for (var f = 0; f < fan.length; f++) {
            var ft = fan[f] * 3;
            for (k = 0; k < 3; k++) if (indices[ft + k] === v) remap.set(fan[f] * 3 + k, newIndex);
          }
        }
        group++;
      }
    }

    if (!splits) {
      return { positions: positions, indices: indices, colors: colors, splits: 0 };
    }

    outPositions = new Float32Array((nv + extra.length) * 3);
    outPositions.set(positions);
    if (colors) {
      outColors = new Float32Array((nv + extra.length) * 3);
      outColors.set(colors);
    }
    for (i = 0; i < extra.length; i++) {
      var src = extra[i] * 3, dst = (nv + i) * 3;
      outPositions[dst] = positions[src];
      outPositions[dst + 1] = positions[src + 1];
      outPositions[dst + 2] = positions[src + 2];
      if (outColors) {
        outColors[dst] = colors[src];
        outColors[dst + 1] = colors[src + 1];
        outColors[dst + 2] = colors[src + 2];
      }
    }
    var outIndices = new Uint32Array(indices.length);
    outIndices.set(indices);
    remap.forEach(function (newIndex, slot) { outIndices[slot] = newIndex; });

    return { positions: outPositions, indices: outIndices, colors: outColors, splits: splits };
  };

  /**
   * Edge health of a raw triangle list: how many edges have one face (a
   * hole) and how many have three or more (a pinch). Used to check a
   * cleanup step before committing to it.
   */
  S.edgeHealth = function (indices) {
    var counts = new Map();
    var n = indices.length;
    for (var i = 0; i < n; i += 3) {
      for (var k = 0; k < 3; k++) {
        var a = indices[i + k], b = indices[i + (k + 1) % 3];
        var key = a < b ? a + ':' + b : b + ':' + a;
        var c = counts.get(key);
        counts.set(key, c === undefined ? 1 : c + 1);
      }
    }
    var border = 0, nonManifold = 0;
    counts.forEach(function (c) {
      if (c === 1) border++;
      else if (c > 2) nonManifold++;
    });
    return { border: border, nonManifold: nonManifold, edges: counts.size };
  };

  /** Re-weld an existing mesh in place (used by the Merge Vertices command). */
  P.weld = function (tol) {
    var d = this.toIndexed();
    var before = this.liveVerts;
    this.setFromArrays(d.positions, d.indices32, { colors: d.colors, weld: true, weldTolerance: tol });
    return before - this.liveVerts;
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
