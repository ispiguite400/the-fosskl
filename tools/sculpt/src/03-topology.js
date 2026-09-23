/*
 * SculptFree — topology editing: edge split and collapse, dynamic topology,
 * subdivision, decimation and smoothing.
 *
 * Split and collapse are the two primitives everything else is built from.
 * Both refuse to run when the result would be non-manifold or would flip a
 * face, so a long sculpting session cannot quietly corrupt the mesh.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var P = S.Mesh.prototype;
  var V3 = S.V3;

  /* ------------------------------------------------------------------ *
   * edge split
   * ------------------------------------------------------------------ */

  /**
   * Insert a vertex along edge a-b at parameter `t` (0.5, the midpoint, by
   * default) and re-triangulate the one or two triangles that share it.
   * Returns the new vertex, or -1 if a-b is not an edge.
   *
   * Note: addVertex/addTriangle may grow the underlying buffers, so nothing
   * here may hold on to `positions.array` across those calls.
   */
  P.splitEdge = function (a, b, t) {
    var shared = this.edgeTris(a, b, this._eTris || (this._eTris = []));
    if (!shared.length || shared.length > 2) return -1;
    var ts = shared.slice();

    var f = t === undefined ? 0.5 : t;
    if (f < 0.001) f = 0.001; else if (f > 0.999) f = 0.999;
    var g = 1 - f;
    var pos = this.positions.array, nor = this.normals.array, col = this.colors.array, msk = this.masks.array;
    var a3 = a * 3, b3 = b * 3;
    var m = this.addVertex(
      pos[a3] * g + pos[b3] * f, pos[a3 + 1] * g + pos[b3 + 1] * f, pos[a3 + 2] * g + pos[b3 + 2] * f,
      nor[a3] * g + nor[b3] * f, nor[a3 + 1] * g + nor[b3 + 1] * f, nor[a3 + 2] * g + nor[b3 + 2] * f,
      col[a3] * g + col[b3] * f, col[a3 + 1] * g + col[b3 + 1] * f, col[a3 + 2] * g + col[b3 + 2] * f,
      msk[a] * g + msk[b] * f);
    // the buffers may have been reallocated by addVertex
    nor = this.normals.array;
    var mn = m * 3;
    var l = Math.sqrt(nor[mn] * nor[mn] + nor[mn + 1] * nor[mn + 1] + nor[mn + 2] * nor[mn + 2]);
    if (l > 1e-20) { l = 1 / l; nor[mn] *= l; nor[mn + 1] *= l; nor[mn + 2] *= l; }

    var T = this.tris.array;
    for (var i = 0; i < ts.length; i++) {
      var tri = ts[i], t3 = tri * 3;
      var v0 = T[t3], v1 = T[t3 + 1], v2 = T[t3 + 2];
      // rotate the triangle so it reads (x, y, c) with x->y being the split edge
      var x, y, c;
      if (v0 === a && v1 === b) { x = a; y = b; c = v2; }
      else if (v1 === a && v2 === b) { x = a; y = b; c = v0; }
      else if (v2 === a && v0 === b) { x = a; y = b; c = v1; }
      else if (v0 === b && v1 === a) { x = b; y = a; c = v2; }
      else if (v1 === b && v2 === a) { x = b; y = a; c = v0; }
      else { x = b; y = a; c = v1; }
      this.removeTriangle(tri);
      this.addTriangle(x, m, c);
      this.addTriangle(m, y, c);
      T = this.tris.array;          // addTriangle may have grown the list
    }
    return m;
  };

  /* ------------------------------------------------------------------ *
   * edge collapse
   * ------------------------------------------------------------------ */

  /**
   * Would collapsing b onto a keep the mesh manifold and unflipped?
   * `tx,ty,tz` is where the surviving vertex will end up.
   */
  P.canCollapse = function (a, b, tx, ty, tz, allowBorder) {
    if (a === b) return false;
    if (this.vertDead.array[a] || this.vertDead.array[b]) return false;
    var shared = this.edgeTris(a, b, this._cTris || (this._cTris = []));
    if (shared.length !== 2) {
      if (!(allowBorder && shared.length === 1)) return false;
    }
    var T = this.tris.array;

    // link condition: a and b may only share the vertices opposite the
    // triangles they already share, otherwise the collapse folds the surface
    var opp = [];
    for (var i = 0; i < shared.length; i++) {
      var t3 = shared[i] * 3;
      for (var k = 0; k < 3; k++) {
        var v = T[t3 + k];
        if (v !== a && v !== b) opp.push(v);
      }
    }
    this._stamp++;
    var st = this._stamp, stamps = this._vertStamp;
    var ringA = this.vertTris[a];
    for (i = 0; i < ringA.length; i++) {
      var ta = ringA[i] * 3;
      for (k = 0; k < 3; k++) { var w = T[ta + k]; if (w !== a) stamps[w] = st; }
    }
    var ringB = this.vertTris[b];
    var commonCount = 0;
    this._stamp++;
    var st2 = this._stamp;
    for (i = 0; i < ringB.length; i++) {
      var tb = ringB[i] * 3;
      for (k = 0; k < 3; k++) {
        var u = T[tb + k];
        if (u === a || u === b) continue;
        if (stamps[u] === st && stamps[u] !== st2) {
          // mark visited with the second stamp so duplicates count once
          stamps[u] = st2;
          commonCount++;
        }
      }
    }
    if (commonCount !== opp.length) return false;

    // valence guard: runaway valence makes later collapses unstable
    var valence = 0;
    this._stamp++;
    var st3 = this._stamp;
    for (i = 0; i < ringA.length; i++) {
      var t3a = ringA[i] * 3;
      for (k = 0; k < 3; k++) { var q = T[t3a + k]; if (q !== a && stamps[q] !== st3) { stamps[q] = st3; valence++; } }
    }
    for (i = 0; i < ringB.length; i++) {
      var t3b = ringB[i] * 3;
      for (k = 0; k < 3; k++) { var q2 = T[t3b + k]; if (q2 !== b && stamps[q2] !== st3) { stamps[q2] = st3; valence++; } }
    }
    if (valence > 24) return false;

    if (!allowBorder && (this.isBorderVert(a) || this.isBorderVert(b))) return false;

    // Face flip, degeneracy and sliver check on every triangle that
    // survives. Slivers are what produce the folded, spiky facets that make
    // a long sculpting session look broken, so a collapse is refused when it
    // would make a triangle much worse shaped than it already is.
    var pos = this.positions.array;
    for (var pass = 0; pass < 2; pass++) {
      var keep = pass === 0 ? a : b, other = pass === 0 ? b : a;
      var ring = this.vertTris[keep];
      for (i = 0; i < ring.length; i++) {
        var t = ring[i], tt3 = t * 3;
        var v0 = T[tt3], v1 = T[tt3 + 1], v2 = T[tt3 + 2];
        if (v0 === other || v1 === other || v2 === other) continue;   // dies in the collapse
        var ax, ay, az, bx, by, bz, cx, cy, cz;
        var o0 = v0 * 3, o1 = v1 * 3, o2 = v2 * 3;
        ax = v0 === keep ? tx : pos[o0]; ay = v0 === keep ? ty : pos[o0 + 1]; az = v0 === keep ? tz : pos[o0 + 2];
        bx = v1 === keep ? tx : pos[o1]; by = v1 === keep ? ty : pos[o1 + 1]; bz = v1 === keep ? tz : pos[o1 + 2];
        cx = v2 === keep ? tx : pos[o2]; cy = v2 === keep ? ty : pos[o2 + 1]; cz = v2 === keep ? tz : pos[o2 + 2];
        var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        var e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        var newLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (newLen < 1e-16) return false;
        // old normal
        var oax = pos[o0], oay = pos[o0 + 1], oaz = pos[o0 + 2];
        var f1x = pos[o1] - oax, f1y = pos[o1 + 1] - oay, f1z = pos[o1 + 2] - oaz;
        var f2x = pos[o2] - oax, f2y = pos[o2 + 1] - oay, f2z = pos[o2 + 2] - oaz;
        var mx = f1y * f2z - f1z * f2y, my = f1z * f2x - f1x * f2z, mz = f1x * f2y - f1y * f2x;
        var oldLen = Math.sqrt(mx * mx + my * my + mz * mz);
        if (oldLen > 1e-16 && (nx * mx + ny * my + nz * mz) / (newLen * oldLen) < 0.1) return false;

        // shape quality: 4*sqrt(3)*area / sum of squared edges, which is 1
        // for an equilateral triangle and tends to 0 for a sliver
        var e3x = cx - bx, e3y = cy - by, e3z = cz - bz;
        var sumSq = (e1x * e1x + e1y * e1y + e1z * e1z) +
                    (e2x * e2x + e2y * e2y + e2z * e2z) +
                    (e3x * e3x + e3y * e3y + e3z * e3z);
        var newQual = sumSq > 1e-30 ? (3.4641016 * (newLen * 0.5)) / sumSq : 0;
        var g1x = pos[o2] - pos[o1], g1y = pos[o2 + 1] - pos[o1 + 1], g1z = pos[o2 + 2] - pos[o1 + 2];
        var oldSumSq = (f1x * f1x + f1y * f1y + f1z * f1z) +
                       (f2x * f2x + f2y * f2y + f2z * f2z) +
                       (g1x * g1x + g1y * g1y + g1z * g1z);
        var oldQual = oldSumSq > 1e-30 ? (3.4641016 * (oldLen * 0.5)) / oldSumSq : 0;
        if (newQual < 0.09 && newQual < oldQual * 0.85) return false;
      }
    }
    return true;
  };

  /**
   * Collapse edge a-b onto a single vertex at (tx,ty,tz), keeping `a`.
   * Returns true when it ran. Attributes are averaged.
   */
  P.collapseEdge = function (a, b, tx, ty, tz, allowBorder) {
    if (!this.canCollapse(a, b, tx, ty, tz, allowBorder)) return false;
    var T = this.tris.array;
    var pos = this.positions.array, col = this.colors.array, msk = this.masks.array;

    var a3 = a * 3, b3 = b * 3;
    pos[a3] = tx; pos[a3 + 1] = ty; pos[a3 + 2] = tz;
    col[a3] = (col[a3] + col[b3]) * 0.5;
    col[a3 + 1] = (col[a3 + 1] + col[b3 + 1]) * 0.5;
    col[a3 + 2] = (col[a3 + 2] + col[b3 + 2]) * 0.5;
    msk[a] = Math.max(msk[a], msk[b]);

    var ringB = this.vertTris[b].slice();
    for (var i = 0; i < ringB.length; i++) {
      var t = ringB[i], t3 = t * 3;
      if (T[t3] === a || T[t3 + 1] === a || T[t3 + 2] === a) {
        this.removeTriangle(t);
      } else {
        for (var k = 0; k < 3; k++) if (T[t3 + k] === b) T[t3 + k] = a;
        this.vertTris[a].push(t);
      }
    }
    this.vertTris[b].length = 0;
    this.vertDead.array[b] = 1;
    this.freeVerts.push(b);
    this.liveVerts--;
    this.topoDirty = true;
    this.markVertDirty(a);
    this._boundsDirty = true;
    return true;
  };

  /* ------------------------------------------------------------------ *
   * edge flip
   * ------------------------------------------------------------------ */

  /**
   * Shape quality of a triangle: 1 for equilateral, towards 0 for a sliver.
   * (4*sqrt(3)*area divided by the sum of the squared edge lengths.)
   */
  P.triQuality = function (t) {
    var T = this.tris.array, p = this.positions.array, t3 = t * 3;
    var ia = T[t3] * 3, ib = T[t3 + 1] * 3, ic = T[t3 + 2] * 3;
    return quality3(p[ia], p[ia + 1], p[ia + 2], p[ib], p[ib + 1], p[ib + 2], p[ic], p[ic + 1], p[ic + 2]);
  };

  function quality3(ax, ay, az, bx, by, bz, cx, cy, cz) {
    var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    var e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    var e3x = cx - bx, e3y = cy - by, e3z = cz - bz;
    var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    var area2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
    var sumSq = e1x * e1x + e1y * e1y + e1z * e1z +
                e2x * e2x + e2y * e2y + e2z * e2z +
                e3x * e3x + e3y * e3y + e3z * e3z;
    if (sumSq < 1e-30) return 0;
    return 1.7320508 * area2 / sumSq;
  }
  S.triQuality3 = quality3;

  /**
   * Swap the diagonal of the quad formed by the two triangles sharing edge
   * a-b. This is the operation that clears slivers out of a sculpted
   * surface: it changes nothing about the shape, only how it is divided into
   * triangles.
   *
   * Refuses to run when the result would be non-manifold, would fold the
   * surface, or would not actually improve the worst triangle.
   */
  P.flipEdge = function (a, b, minGain) {
    var shared = this.edgeTris(a, b, this._fTris || (this._fTris = []));
    if (shared.length !== 2) return false;
    var T = this.tris.array, pos = this.positions.array;
    var k;

    // Work out which of the two triangles walks the edge a->b and which
    // walks b->a. Getting this backwards reverses the winding of both new
    // triangles, which turns the surface inside out along that edge.
    function directedHas(t, x, y) {
      var o = t * 3;
      return (T[o] === x && T[o + 1] === y) || (T[o + 1] === x && T[o + 2] === y) ||
             (T[o + 2] === x && T[o] === y);
    }
    var tAB, tBA;
    if (directedHas(shared[0], a, b) && directedHas(shared[1], b, a)) {
      tAB = shared[0]; tBA = shared[1];
    } else if (directedHas(shared[1], a, b) && directedHas(shared[0], b, a)) {
      tAB = shared[1]; tBA = shared[0];
    } else {
      return false;              // inconsistent winding here; leave it alone
    }

    var c = -1, d = -1;
    var qAB = tAB * 3, qBA = tBA * 3;
    for (k = 0; k < 3; k++) { var v = T[qAB + k]; if (v !== a && v !== b) c = v; }
    for (k = 0; k < 3; k++) { var w = T[qBA + k]; if (w !== a && w !== b) d = w; }
    if (c < 0 || d < 0 || c === d) return false;
    // the new diagonal must not already exist somewhere else in the mesh
    if (this.countEdgeTris(c, d) > 0) return false;
    // flipping away from a valence-3 vertex would strand it
    var ringTmp = this._fRing || (this._fRing = []);
    this.ringVerts(a, ringTmp);
    if (ringTmp.length <= 3) return false;
    this.ringVerts(b, ringTmp);
    if (ringTmp.length <= 3) return false;

    var ao = a * 3, bo = b * 3, co = c * 3, dd = d * 3;
    // before: (a,b,c) and (b,a,d); after: (a,d,c) and (d,b,c)
    var oldQ = Math.min(this.triQuality(tAB), this.triQuality(tBA));
    var newQ = Math.min(
      quality3(pos[ao], pos[ao + 1], pos[ao + 2], pos[dd], pos[dd + 1], pos[dd + 2], pos[co], pos[co + 1], pos[co + 2]),
      quality3(pos[dd], pos[dd + 1], pos[dd + 2], pos[bo], pos[bo + 1], pos[bo + 2], pos[co], pos[co + 1], pos[co + 2])
    );
    if (newQ <= oldQ + (minGain === undefined ? 0.02 : minGain)) return false;

    // the flipped pair must still face the way the old pair did
    function faceNormal(x, y, z, out) {
      var e1x = pos[y] - pos[x], e1y = pos[y + 1] - pos[x + 1], e1z = pos[y + 2] - pos[x + 2];
      var e2x = pos[z] - pos[x], e2y = pos[z + 1] - pos[x + 1], e2z = pos[z + 2] - pos[x + 2];
      out[0] = e1y * e2z - e1z * e2y;
      out[1] = e1z * e2x - e1x * e2z;
      out[2] = e1x * e2y - e1y * e2x;
      var l = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]);
      if (l < 1e-20) return false;
      out[0] /= l; out[1] /= l; out[2] /= l;
      return true;
    }
    var n1 = this._fn1 || (this._fn1 = [0, 0, 0]);
    var n2 = this._fn2 || (this._fn2 = [0, 0, 0]);
    var m1 = this._fm1 || (this._fm1 = [0, 0, 0]);
    var m2 = this._fm2 || (this._fm2 = [0, 0, 0]);
    if (!faceNormal(ao, bo, co, n1) || !faceNormal(bo, ao, dd, n2)) return false;
    if (!faceNormal(ao, dd, co, m1) || !faceNormal(dd, bo, co, m2)) return false;
    var avgX = n1[0] + n2[0], avgY = n1[1] + n2[1], avgZ = n1[2] + n2[2];
    var al = Math.sqrt(avgX * avgX + avgY * avgY + avgZ * avgZ);
    if (al < 1e-12) return false;
    avgX /= al; avgY /= al; avgZ /= al;
    if (m1[0] * avgX + m1[1] * avgY + m1[2] * avgZ < 0.55) return false;
    if (m2[0] * avgX + m2[1] * avgY + m2[2] * avgZ < 0.55) return false;

    this.removeTriangle(tAB);
    this.removeTriangle(tBA);
    this.addTriangle(a, d, c);
    this.addTriangle(d, b, c);
    this.markVertDirty(a);
    this.markVertDirty(b);
    this.markVertDirty(c);
    this.markVertDirty(d);
    return true;
  };

  /* ------------------------------------------------------------------ *
   * dynamic topology
   * ------------------------------------------------------------------ */

  /**
   * Bring the triangle density inside the brush sphere towards `detail`
   * (a target edge length in local units): long edges split, short edges
   * collapse. Returns {split, collapsed}.
   */
  P.dyntopo = function (cx, cy, cz, radius, detail, maxTris, mode, maxSplits) {
    var splitLen = detail * 1.34, collapseLen = detail * 0.66;
    var splitSq = splitLen * splitLen, collapseSq = collapseLen * collapseLen;
    var doSplit = mode !== 'collapse', doCollapse = mode !== 'split';
    /*
     * A ceiling on how much refining one call may do.
     *
     * A big brush at full strength moves the surface several triangle widths
     * in a single stamp, so the next stamp finds everything stretched and
     * refines it again — and again, stamp after stamp, until a single stroke
     * has eaten the whole triangle budget and taken ten seconds doing it.
     * With a ceiling, the same stroke simply refines a little less each
     * stamp and stays responsive.
     */
    var splitBudget = maxSplits === undefined ? 600 : maxSplits;
    var r2 = radius * radius;
    var nSplit = 0, nCollapse = 0;
    var pos, T;
    // Masked geometry must not move, and a collapse moves or removes its
    // vertices, so edges anchored in a masked area are left as they are.
    var msk = this.masks.array;

    /*
     * Splitting is decided by the triangle, not by where its midpoint lands.
     *
     * The obvious rule — "the split has to land inside the brush" — refuses
     * to refine a triangle bigger than the brush at all, because its longest
     * edge runs right past. The brush then drags one lone vertex of a huge
     * triangle and leaves a star of stretched fins, which is exactly what
     * "it breaks very easily" looked like.
     *
     * So the allowance scales with the edge being split: a split may land up
     * to its own edge length away from the brush. A huge triangle is
     * therefore allowed to halve even though the cut falls far outside —
     * and as its pieces get smaller the allowance shrinks with them, so the
     * refinement funnels in towards the brush instead of spreading over the
     * model. The split ceiling below bounds what one stamp may do.
     */

    if (doSplit && this.liveTris < maxTris) {
      // Several passes: a split shortens the edge it acts on, but the two
      // triangles it leaves behind may still hold edges above the threshold.
      for (var pass = 0; pass < 10; pass++) {
        var tris = this.trisInSphere(cx, cy, cz, radius).slice();
        var did = 0;
        for (var i = 0; i < tris.length; i++) {
          var t = tris[i];
          if (this.triDead.array[t]) continue;
          if (this.liveTris >= maxTris) break;
          if (nSplit >= splitBudget) break;
          pos = this.positions.array; T = this.tris.array;
          var t3 = t * 3;

          // Only ever split a triangle's longest edge. Splitting any other
          // edge leaves a sliver behind, and slivers are what make a
          // sculpted surface speckle under cavity shading.
          var bestSq = 0, ba = -1, bb = -1, bmx = 0, bmy = 0, bmz = 0;
          for (var k = 0; k < 3; k++) {
            var v0 = T[t3 + k], v1 = T[t3 + (k + 1) % 3];
            var o0 = v0 * 3, o1 = v1 * 3;
            var dx = pos[o0] - pos[o1], dy = pos[o0 + 1] - pos[o1 + 1], dz = pos[o0 + 2] - pos[o1 + 2];
            var lenSq = dx * dx + dy * dy + dz * dz;
            if (lenSq <= bestSq) continue;
            bestSq = lenSq; ba = v0; bb = v1;
            bmx = (pos[o0] + pos[o1]) * 0.5;
            bmy = (pos[o0 + 1] + pos[o1 + 1]) * 0.5;
            bmz = (pos[o0 + 2] + pos[o1 + 2]) * 0.5;
          }
          if (ba < 0) continue;
          if (msk[ba] >= 0.5 || msk[bb] >= 0.5) continue;
          if (bestSq <= splitSq) continue;                   // already fine enough
          var ddx = bmx - cx, ddy = bmy - cy, ddz = bmz - cz;
          var allow = radius + Math.sqrt(bestSq);
          if (ddx * ddx + ddy * ddy + ddz * ddz > allow * allow) continue;
          if (this.splitEdge(ba, bb) >= 0) { nSplit++; did++; }
        }
        if (!did || nSplit >= splitBudget) break;
      }
    }

    if (doCollapse) {
      var tris2 = this.trisInSphere(cx, cy, cz, radius).slice();
      pos = this.positions.array; T = this.tris.array;
      for (var j = 0; j < tris2.length; j++) {
        var t2 = tris2[j];
        if (this.triDead.array[t2]) continue;
        var q3 = t2 * 3;

        // Mirror of the split rule: only the shortest edge is a candidate,
        // so collapsing cannot squash a triangle sideways into a sliver.
        var minSq = Infinity, ca = -1, cb = -1, cmx = 0, cmy = 0, cmz = 0;
        for (var k2 = 0; k2 < 3; k2++) {
          var a = T[q3 + k2], b = T[q3 + (k2 + 1) % 3];
          if (this.vertDead.array[a] || this.vertDead.array[b]) { minSq = Infinity; break; }
          var p0 = a * 3, p1 = b * 3;
          var ex = pos[p0] - pos[p1], ey = pos[p0 + 1] - pos[p1 + 1], ez = pos[p0 + 2] - pos[p1 + 2];
          var lsq = ex * ex + ey * ey + ez * ez;
          if (lsq >= minSq) continue;
          minSq = lsq; ca = a; cb = b;
          cmx = (pos[p0] + pos[p1]) * 0.5;
          cmy = (pos[p0 + 1] + pos[p1 + 1]) * 0.5;
          cmz = (pos[p0 + 2] + pos[p1 + 2]) * 0.5;
        }
        if (ca < 0 || minSq >= collapseSq) continue;
        if (msk[ca] >= 0.5 || msk[cb] >= 0.5) continue;
        var rx = cmx - cx, ry = cmy - cy, rz = cmz - cz;
        if (rx * rx + ry * ry + rz * rz > r2) continue;
        if (this.collapseEdge(ca, cb, cmx, cmy, cmz, false)) {
          nCollapse++;
          pos = this.positions.array; T = this.tris.array;
        }
      }
    }

    // Third pass: swap the diagonals that leave a badly shaped triangle
    // behind. Splits and collapses alone slowly accumulate slivers.
    var nFlip = 0;
    if (doSplit || doCollapse) {
      var tris3 = this.trisInSphere(cx, cy, cz, radius).slice();
      for (var f = 0; f < tris3.length; f++) {
        var t3f = tris3[f];
        if (this.triDead.array[t3f]) continue;
        if (this.triQuality(t3f) > 0.45) continue;      // already well shaped
        T = this.tris.array; pos = this.positions.array;
        var o3 = t3f * 3;
        for (var k3 = 0; k3 < 3; k3++) {
          var fa = T[o3 + k3], fb = T[o3 + (k3 + 1) % 3];
          if (msk[fa] >= 0.5 || msk[fb] >= 0.5) continue;
          var fmx = (pos[fa * 3] + pos[fb * 3]) * 0.5 - cx;
          var fmy = (pos[fa * 3 + 1] + pos[fb * 3 + 1]) * 0.5 - cy;
          var fmz = (pos[fa * 3 + 2] + pos[fb * 3 + 2]) * 0.5 - cz;
          if (fmx * fmx + fmy * fmy + fmz * fmz > r2) continue;
          if (this.flipEdge(fa, fb)) { nFlip++; break; }
        }
      }
    }

    if (nSplit || nCollapse || nFlip) {
      this._boundsDirty = true;
      this.gridMaybeRebuild();
    }
    return { split: nSplit, collapsed: nCollapse, flipped: nFlip };
  };

  /**
   * Collapse edges shorter than `tol`, which removes zero-area triangles
   * without opening the surface.
   *
   * Dual contouring occasionally places two neighbouring cells' vertices at
   * exactly the same point, leaving a triangle with no area. Deleting such a
   * triangle would leave a hole; collapsing its zero-length edge removes it
   * and keeps the mesh closed and manifold.
   */
  P.collapseTinyEdges = function (tol) {
    var tolSq = tol * tol;
    var T = this.tris.array;
    var collapsed = 0;
    for (var pass = 0; pass < 4; pass++) {
      var pos = this.positions.array;
      var did = 0;
      var nt = this.triDead.length;
      for (var t = 0; t < nt; t++) {
        if (this.triDead.array[t]) continue;
        T = this.tris.array;
        pos = this.positions.array;
        var t3 = t * 3;
        for (var k = 0; k < 3; k++) {
          var a = T[t3 + k], b = T[t3 + (k + 1) % 3];
          if (this.vertDead.array[a] || this.vertDead.array[b]) break;
          var o0 = a * 3, o1 = b * 3;
          var dx = pos[o0] - pos[o1], dy = pos[o0 + 1] - pos[o1 + 1], dz = pos[o0 + 2] - pos[o1 + 2];
          if (dx * dx + dy * dy + dz * dz > tolSq) continue;
          if (this.collapseEdge(a, b, (pos[o0] + pos[o1]) * 0.5,
                                      (pos[o0 + 1] + pos[o1 + 1]) * 0.5,
                                      (pos[o0 + 2] + pos[o1 + 2]) * 0.5, true)) {
            collapsed++; did++;
          }
          break;
        }
      }
      if (!did) break;
    }
    if (collapsed) {
      this._boundsDirty = true;
      this.gridRebuild();
    }
    return collapsed;
  };

  /**
   * Remove triangles with (near) zero area by collapsing their shortest
   * edge, which keeps the surface closed. These come from dual contouring
   * placing a quad's vertices exactly in a line across flat, axis-aligned
   * stretches of the field.
   */
  P.removeDegenerateTriangles = function (areaTol) {
    var removed = 0;
    for (var pass = 0; pass < 4; pass++) {
      var did = 0;
      var nt = this.triDead.length;
      for (var t = 0; t < nt; t++) {
        if (this.triDead.array[t]) continue;
        var T = this.tris.array, p = this.positions.array;
        var t3 = t * 3;
        var ia = T[t3] * 3, ib = T[t3 + 1] * 3, ic = T[t3 + 2] * 3;
        var e1x = p[ib] - p[ia], e1y = p[ib + 1] - p[ia + 1], e1z = p[ib + 2] - p[ia + 2];
        var e2x = p[ic] - p[ia], e2y = p[ic + 1] - p[ia + 1], e2z = p[ic + 2] - p[ia + 2];
        var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        if (Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5 > areaTol) continue;

        // shortest edge first: collapsing it disturbs the least
        var order = [0, 1, 2];
        var lens = [];
        for (var k = 0; k < 3; k++) {
          var a = T[t3 + k] * 3, b = T[t3 + (k + 1) % 3] * 3;
          var dx = p[a] - p[b], dy = p[a + 1] - p[b + 1], dz = p[a + 2] - p[b + 2];
          lens.push(dx * dx + dy * dy + dz * dz);
        }
        order.sort(function (x, y) { return lens[x] - lens[y]; });
        for (var oi = 0; oi < 3; oi++) {
          var kk = order[oi];
          var va = T[t3 + kk], vb = T[t3 + (kk + 1) % 3];
          if (this.vertDead.array[va] || this.vertDead.array[vb]) break;
          var oa = va * 3, ob = vb * 3;
          if (this.collapseEdge(va, vb, (p[oa] + p[ob]) * 0.5,
                                        (p[oa + 1] + p[ob + 1]) * 0.5,
                                        (p[oa + 2] + p[ob + 2]) * 0.5, true)) {
            removed++; did++;
            break;
          }
        }
      }
      if (!did) break;
    }
    if (removed) {
      this._boundsDirty = true;
      this.gridRebuild();
    }
    return removed;
  };

  /** Count triangles with (near) zero area — reported by the mesh checks. */
  P.countDegenerateTriangles = function (tol) {
    var T = this.tris.array, p = this.positions.array;
    var limit = (tol === undefined ? 1e-12 : tol);
    var n = 0;
    for (var t = 0; t < this.triDead.length; t++) {
      if (this.triDead.array[t]) continue;
      var t3 = t * 3, ia = T[t3] * 3, ib = T[t3 + 1] * 3, ic = T[t3 + 2] * 3;
      var e1x = p[ib] - p[ia], e1y = p[ib + 1] - p[ia + 1], e1z = p[ib + 2] - p[ia + 2];
      var e2x = p[ic] - p[ia], e2y = p[ic + 1] - p[ia + 1], e2z = p[ic + 2] - p[ia + 2];
      var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      if (Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5 <= limit) n++;
    }
    return n;
  };

  /* ------------------------------------------------------------------ *
   * uniform subdivision
   * ------------------------------------------------------------------ */

  /**
   * One round of 4:1 subdivision. `smooth` applies Loop's weights, which
   * rounds the surface off the way a subdivision surface would; linear mode
   * keeps the silhouette exactly and just adds density.
   */
  P.subdivide = function (smooth) {
    this.compact();
    var nv = this.liveVerts, nt = this.liveTris;
    var pos = this.positions.array, col = this.colors.array, msk = this.masks.array;
    var T = this.tris.array;

    var newVertCount = nv;           // grows as midpoints are created
    var edgeMap = new Map();
    var estimate = nv + nt * 2;
    var outPos = new Float32Array(estimate * 3);
    var outCol = new Float32Array(estimate * 3);
    var outMsk = new Float32Array(estimate);
    outPos.set(pos.subarray(0, nv * 3));
    outCol.set(col.subarray(0, nv * 3));
    outMsk.set(msk.subarray(0, nv));

    var self = this;
    var ring = [];

    function growTo(n) {
      if (n * 3 <= outPos.length) return;
      // arrays are pre-sized from Euler's formula; only pathological meshes
      // (lots of boundary) need more room
      var np = new Float32Array(n * 3 * 2), nc = new Float32Array(n * 3 * 2), nm = new Float32Array(n * 2);
      np.set(outPos); nc.set(outCol); nm.set(outMsk);
      outPos = np; outCol = nc; outMsk = nm;
    }

    function midpoint(a, b) {
      var key = a < b ? a * nv + b : b * nv + a;
      var found = edgeMap.get(key);
      if (found !== undefined) return found;
      var m = newVertCount++;
      growTo(newVertCount);
      var a3 = a * 3, b3 = b * 3, m3 = m * 3;
      if (smooth) {
        // Loop odd vertex: 3/8 of the edge ends, 1/8 of the two opposite
        var shared = self.edgeTris(a, b, []);
        if (shared.length === 2) {
          var opp = [];
          for (var i = 0; i < 2; i++) {
            var t3 = shared[i] * 3;
            for (var k = 0; k < 3; k++) { var v = T[t3 + k]; if (v !== a && v !== b) opp.push(v); }
          }
          var c3 = opp[0] * 3, d3 = opp[1] * 3;
          for (var c = 0; c < 3; c++) {
            outPos[m3 + c] = 0.375 * (pos[a3 + c] + pos[b3 + c]) + 0.125 * (pos[c3 + c] + pos[d3 + c]);
          }
        } else {
          for (var c2 = 0; c2 < 3; c2++) outPos[m3 + c2] = 0.5 * (pos[a3 + c2] + pos[b3 + c2]);
        }
      } else {
        for (var c3b = 0; c3b < 3; c3b++) outPos[m3 + c3b] = 0.5 * (pos[a3 + c3b] + pos[b3 + c3b]);
      }
      for (var cc = 0; cc < 3; cc++) outCol[m3 + cc] = 0.5 * (col[a3 + cc] + col[b3 + cc]);
      outMsk[m] = 0.5 * (msk[a] + msk[b]);
      edgeMap.set(key, m);
      return m;
    }

    var outIdx = new Uint32Array(nt * 12);
    var w = 0;
    for (var t = 0; t < nt; t++) {
      var t3 = t * 3;
      var a = T[t3], b = T[t3 + 1], c = T[t3 + 2];
      var ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      outIdx[w++] = a; outIdx[w++] = ab; outIdx[w++] = ca;
      outIdx[w++] = ab; outIdx[w++] = b; outIdx[w++] = bc;
      outIdx[w++] = ca; outIdx[w++] = bc; outIdx[w++] = c;
      outIdx[w++] = ab; outIdx[w++] = bc; outIdx[w++] = ca;
    }

    if (smooth) {
      // Loop even vertices, computed from the original positions
      for (var v = 0; v < nv; v++) {
        this.ringVerts(v, ring);
        var n = ring.length;
        if (n < 3) continue;
        var v3 = v * 3;
        if (this.isBorderVert(v)) {
          // boundary rule: 3/4 v + 1/8 of the two boundary neighbours
          var nb = [];
          for (var i2 = 0; i2 < n; i2++) if (this.countEdgeTris(v, ring[i2]) === 1) nb.push(ring[i2]);
          if (nb.length === 2) {
            var p13 = nb[0] * 3, p23 = nb[1] * 3;
            for (var cb = 0; cb < 3; cb++) {
              outPos[v3 + cb] = 0.75 * pos[v3 + cb] + 0.125 * (pos[p13 + cb] + pos[p23 + cb]);
            }
          }
          continue;
        }
        var cosv = Math.cos(2 * Math.PI / n);
        var inner = 0.375 + 0.25 * cosv;
        var beta = (0.625 - inner * inner) / n;
        var sx = 0, sy = 0, sz = 0;
        for (var r = 0; r < n; r++) {
          var r3 = ring[r] * 3;
          sx += pos[r3]; sy += pos[r3 + 1]; sz += pos[r3 + 2];
        }
        outPos[v3] = (1 - n * beta) * pos[v3] + beta * sx;
        outPos[v3 + 1] = (1 - n * beta) * pos[v3 + 1] + beta * sy;
        outPos[v3 + 2] = (1 - n * beta) * pos[v3 + 2] + beta * sz;
      }
    }

    this.setFromArrays(outPos.subarray(0, newVertCount * 3), outIdx.subarray(0, w),
                       { colors: outCol.subarray(0, newVertCount * 3), weld: false });
    this.masks.array.set(outMsk.subarray(0, newVertCount), 0);
    return this;
  };

  /* ------------------------------------------------------------------ *
   * decimation (quadric error metric)
   * ------------------------------------------------------------------ */

  /**
   * Reduce to roughly `targetTris` triangles, collapsing the edges that
   * change the surface least. Good enough to bake game LODs straight out of
   * a sculpt.
   */
  P.decimate = function (targetTris, preserveBorders) {
    this.compact();
    if (this.liveTris <= targetTris) return { removed: 0 };
    var nv = this.liveVerts;
    var pos = this.positions.array, T = this.tris.array;

    // per-vertex quadric: symmetric 4x4 stored as 10 floats
    var Q = new Float64Array(nv * 10);
    var nt = this.liveTris;
    for (var t = 0; t < nt; t++) {
      var t3 = t * 3;
      var ia = T[t3] * 3, ib = T[t3 + 1] * 3, ic = T[t3 + 2] * 3;
      var e1x = pos[ib] - pos[ia], e1y = pos[ib + 1] - pos[ia + 1], e1z = pos[ib + 2] - pos[ia + 2];
      var e2x = pos[ic] - pos[ia], e2y = pos[ic + 1] - pos[ia + 1], e2z = pos[ic + 2] - pos[ia + 2];
      var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      var l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-20) continue;
      var area = l * 0.5;
      nx /= l; ny /= l; nz /= l;
      var d = -(nx * pos[ia] + ny * pos[ia + 1] + nz * pos[ia + 2]);
      var q = [nx * nx, nx * ny, nx * nz, nx * d, ny * ny, ny * nz, ny * d, nz * nz, nz * d, d * d];
      for (var k = 0; k < 3; k++) {
        var vo = T[t3 + k] * 10;
        for (var e = 0; e < 10; e++) Q[vo + e] += q[e] * area;
      }
    }

    function error(vi, x, y, z) {
      var o = vi * 10;
      return Q[o] * x * x + 2 * Q[o + 1] * x * y + 2 * Q[o + 2] * x * z + 2 * Q[o + 3] * x
           + Q[o + 4] * y * y + 2 * Q[o + 5] * y * z + 2 * Q[o + 6] * y
           + Q[o + 7] * z * z + 2 * Q[o + 8] * z + Q[o + 9];
    }

    var version = new Int32Array(nv);
    var ea = [], eb = [], eva = [], evb = [];      // candidate edge records
    var heap = new S.Heap();
    var self = this;

    /**
     * Cheapest of three placements for the merged vertex: either end, or the
     * midpoint. Written without allocating, since this runs once per edge
     * per pass and a big decimation evaluates it millions of times.
     */
    function candidateCost(a, b, outPoint) {
      var a3 = a * 3, b3 = b * 3;
      var ax = pos[a3], ay = pos[a3 + 1], az = pos[a3 + 2];
      var bx = pos[b3], by = pos[b3 + 1], bz = pos[b3 + 2];
      var mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
      var ea = error(a, ax, ay, az) + error(b, ax, ay, az);
      var eb = error(a, bx, by, bz) + error(b, bx, by, bz);
      var em = error(a, mx, my, mz) + error(b, mx, my, mz);
      var best = em, px = mx, py = my, pz = mz;
      if (ea < best) { best = ea; px = ax; py = ay; pz = az; }
      if (eb < best) { best = eb; px = bx; py = by; pz = bz; }
      outPoint[0] = px; outPoint[1] = py; outPoint[2] = pz;
      return best < 0 ? 0 : best;
    }

    var pt = new Float64Array(3);
    function pushEdge(a, b) {
      if (a === b) return;
      var cost = candidateCost(a, b, pt);
      var id = ea.length;
      ea.push(a); eb.push(b); eva.push(version[a]); evb.push(version[b]);
      heap.push(cost, id);
    }

    // seed every edge once (a<b so each is considered a single time)
    for (var t2 = 0; t2 < nt; t2++) {
      var q3 = t2 * 3;
      for (var k2 = 0; k2 < 3; k2++) {
        var a2 = T[q3 + k2], b2 = T[q3 + (k2 + 1) % 3];
        if (a2 < b2) pushEdge(a2, b2);
      }
    }

    var removed = 0, ring = [];
    var guard = nt * 40;
    while (this.liveTris > targetTris && guard-- > 0) {
      var id2 = heap.pop();
      if (id2 < 0) break;
      var a3v = ea[id2], b3v = eb[id2];
      if (this.vertDead.array[a3v] || this.vertDead.array[b3v]) continue;
      if (version[a3v] !== eva[id2] || version[b3v] !== evb[id2]) continue;  // stale
      candidateCost(a3v, b3v, pt);
      var before = this.liveTris;
      if (!this.collapseEdge(a3v, b3v, pt[0], pt[1], pt[2], !preserveBorders)) continue;
      removed += before - this.liveTris;
      // `a` absorbs b's quadric and moves, so every edge touching it needs a
      // fresh cost. Nothing else changed: bumping the ring's versions too
      // would invalidate edges between ring vertices that never get pushed
      // again, and the decimator would stall well short of the target.
      var ao = a3v * 10, bo = b3v * 10;
      for (var e2 = 0; e2 < 10; e2++) Q[ao + e2] += Q[bo + e2];
      version[a3v]++;
      this.ringVerts(a3v, ring);
      for (var r = 0; r < ring.length; r++) pushEdge(a3v, ring[r]);
    }

    this.compact();
    this.computeNormals();
    return { removed: removed };
  };

  /* ------------------------------------------------------------------ *
   * smoothing
   * ------------------------------------------------------------------ */

  /**
   * Laplacian smoothing of the given vertices. `tangential` keeps the motion
   * in the surface plane, which relaxes the triangle layout without eating
   * volume — what the Smooth brush uses.
   */
  P.smoothVerts = function (verts, count, amount, tangential, weights) {
    var n = count === undefined ? verts.length : count;
    if (!n) return;
    var pos = this.positions.array, nor = this.normals.array, T = this.tris.array;
    var msk = this.masks.array;
    var target = this._smoothBuf;
    if (!target || target.length < n * 3) target = this._smoothBuf = new Float32Array(Math.max(n * 3, 1024));

    var i, v, k;
    for (i = 0; i < n; i++) {
      v = verts[i];
      var lst = this.vertTris[v];
      var sx = 0, sy = 0, sz = 0, cnt = 0;
      for (var j = 0; j < lst.length; j++) {
        var t3 = lst[j] * 3;
        for (k = 0; k < 3; k++) {
          var w = T[t3 + k];
          if (w === v) continue;
          var w3 = w * 3;
          sx += pos[w3]; sy += pos[w3 + 1]; sz += pos[w3 + 2];
          cnt++;
        }
      }
      var i3 = i * 3;
      if (!cnt) { target[i3] = target[i3 + 1] = target[i3 + 2] = 0; continue; }
      // each ring vertex is counted once per incident triangle, which is the
      // usual cotangent-free weighting and is stable enough here
      var v3 = v * 3;
      var dx = sx / cnt - pos[v3], dy = sy / cnt - pos[v3 + 1], dz = sz / cnt - pos[v3 + 2];
      if (tangential) {
        var d = dx * nor[v3] + dy * nor[v3 + 1] + dz * nor[v3 + 2];
        dx -= nor[v3] * d; dy -= nor[v3 + 1] * d; dz -= nor[v3 + 2] * d;
      }
      target[i3] = dx; target[i3 + 1] = dy; target[i3 + 2] = dz;
    }

    for (i = 0; i < n; i++) {
      v = verts[i];
      var f = amount * (1 - msk[v]) * (weights ? weights[i] : 1);
      if (f === 0) continue;
      var o3 = v * 3, s3 = i * 3;
      pos[o3] += target[s3] * f;
      pos[o3 + 1] += target[s3 + 1] * f;
      pos[o3 + 2] += target[s3 + 2] * f;
      this.markVertDirty(v);
    }
    this._boundsDirty = true;
  };

  /** Smooth the whole mesh (Mesh > Smooth All). */
  /**
   * Find the spikes: vertices sitting far off the surface their own ring
   * describes.
   *
   * The measure is the distance from the middle of the ring, against how
   * wide that ring is — deliberately not against the edges that reach the
   * vertex itself, because a spike stretches those and would then hide
   * behind them.
   *
   * Measuring against the ring's width rather than the spacing between its
   * vertices is what makes the score mean the same thing at any resolution:
   * a cone's apex scores 2.5 whether its ring holds eight vertices or
   * eighty, where the spacing measure grew with the count and eventually
   * called the apex a fault. It also needs no ring ordering, so it reads
   * a border vertex correctly too.
   *
   * With `out`, appends [vertex, x, y, z] for each one, where x,y,z is where
   * it should go. Returns how many were found.
   */
  function scanSpikes(mesh, factor, strength, out, only, onlyCount) {
    var pos = mesh.positions.array;
    var ring = [];
    var found = 0;
    var n = only ? (onlyCount === undefined ? only.length : onlyCount) : mesh.masks.length;
    for (var vi = 0; vi < n; vi++) {
      var v = only ? only[vi] : vi;
      if (mesh.vertDead.array[v]) continue;
      ring.length = 0;
      mesh.ringVerts(v, ring);
      if (ring.length < 3) continue;
      var o = v * 3;
      var cx = 0, cy = 0, cz = 0;
      for (var i = 0; i < ring.length; i++) {
        var ro = ring[i] * 3;
        cx += pos[ro]; cy += pos[ro + 1]; cz += pos[ro + 2];
      }
      var inv = 1 / ring.length;
      cx *= inv; cy *= inv; cz *= inv;

      // how wide the ring is — the local scale
      var span = 0;
      for (var k = 0; k < ring.length; k++) {
        var a = ring[k] * 3;
        span += Math.sqrt((pos[a] - cx) * (pos[a] - cx) +
                          (pos[a + 1] - cy) * (pos[a + 1] - cy) +
                          (pos[a + 2] - cz) * (pos[a + 2] - cz));
      }
      span *= inv;
      if (span < 1e-12) continue;

      var dx = pos[o] - cx, dy = pos[o + 1] - cy, dz = pos[o + 2] - cz;
      var off = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (off <= span * factor) continue;
      found++;
      if (out) {
        out.push(v, cx + dx * (1 - strength), cy + dy * (1 - strength), cz + dz * (1 - strength));
      }
    }
    return found;
  }

  /*
   * Where the threshold comes from, measured on the primitives themselves:
   *
   *   sphere          0.1     a smooth surface
   *   cylinder rim    0.75    a hard edge
   *   box corner      0.98    a corner
   *   plane border    1.44    an open edge
   *   cone apex       2.50    the sharpest thing anyone makes on purpose
   *   a real needle   7.1     one vertex pulled half a radius out
   *
   * Four sits in the gap: it leaves every sharp feature that was made on
   * purpose alone, and still catches the genuine needles — a vertex flung
   * out of an imported mesh, or left behind by a boolean. Prevention is
   * what deals with sculpting spikes: the stroke reach limit and the
   * refinement damping in the brush engine.
   */
  var SPIKE_FACTOR = 4;

  /**
   * Pull needle vertices back onto the surface. Returns how many moved.
   *
   * Runs a few passes, because pulling a needle most of the way back can
   * leave it just over the threshold still.
   */
  P.relaxSpikes = function (factor, strength, only, onlyCount) {
    factor = factor === undefined ? SPIKE_FACTOR : factor;
    strength = strength === undefined ? 0.85 : strength;
    var pos = this.positions.array;
    var moved = 0;
    var ring = [];
    /*
     * When the caller names a region, the region has to grow with the
     * repair: pulling a needle back relaxes its neighbours too, and that
     * can leave the vertex just outside the region slightly out of shape.
     * So each pass looks at what the last one moved, and at their rings.
     */
    var work = only, workCount = onlyCount;
    for (var pass = 0; pass < 4; pass++) {
      var targets = [];
      scanSpikes(this, factor, strength, targets, work, workCount);
      if (!targets.length) break;
      // collect first, apply after: moving as we go would let one needle drag
      // its neighbour's idea of the surface with it
      var touched = [];
      for (var k = 0; k < targets.length; k += 4) {
        var v = targets[k], o = v * 3;
        pos[o] = targets[k + 1];
        pos[o + 1] = targets[k + 2];
        pos[o + 2] = targets[k + 3];
        this.markVertDirty(v);
        touched.push(v);
      }
      moved += touched.length;

      /*
       * Then relax the ring around each one. Where two needles were
       * neighbours, each has distorted the other's ring, so pulling one back
       * leaves the other measuring against a surface that is still wrong —
       * and the scan stops flagging it while it is plainly still out. A light
       * pass over the neighbourhood settles that.
       */
      var near = [];
      var seen = {};
      for (var i = 0; i < touched.length; i++) {
        var tv = touched[i];
        if (!seen[tv]) { seen[tv] = 1; near.push(tv); }
        ring.length = 0;
        this.ringVerts(tv, ring);
        for (var r = 0; r < ring.length; r++) {
          if (!seen[ring[r]]) { seen[ring[r]] = 1; near.push(ring[r]); }
        }
      }
      if (near.length) this.smoothVerts(Uint32Array.from(near), near.length, 0.5, false);

      if (only) {
        // the next pass watches everything this one could have disturbed
        var grown = near.slice();
        var seenGrown = seen;
        for (var g = 0; g < near.length; g++) {
          ring.length = 0;
          this.ringVerts(near[g], ring);
          for (var gr = 0; gr < ring.length; gr++) {
            if (!seenGrown[ring[gr]]) { seenGrown[ring[gr]] = 1; grown.push(ring[gr]); }
          }
        }
        work = grown; workCount = grown.length;
      }
    }
    if (moved) { this._boundsDirty = true; this.computeNormals(); }
    return moved;
  };

  /**
   * Pull back any needle a stroke left behind, looking only at the vertices
   * the stroke touched.
   *
   * The same repair as `relaxSpikes`, but bounded to a region: a stroke has
   * no business straightening geometry at the other end of the model, and
   * scanning the whole mesh at the end of every stroke is work the phone
   * does not have to spare.
   */
  P.relaxSpikesAt = function (verts, count, factor, strength) {
    if (!verts || !count) return 0;
    /*
     * Repairs go a little below the threshold that reports a needle. Pulling
     * a needle back to exactly the threshold leaves it there, one rounding
     * error from being flagged again, and each pass of the repair nudges
     * its neighbours too; a margin means anything worth reporting is
     * comfortably gone in one go. Even so this stays well clear of a cone's
     * apex, which scores 2.5.
     */
    if (factor === undefined) factor = SPIKE_FACTOR * 0.8;
    return this.relaxSpikes(factor, strength, verts, count);
  };

  /** Count the needle vertices without touching anything. */
  P.countSpikes = function (factor, only, onlyCount) {
    return scanSpikes(this, factor === undefined ? SPIKE_FACTOR : factor, 0.85, null, only, onlyCount);
  };

  /**
   * Relax the vertices of badly shaped triangles.
   *
   * Slivers — long, thin, almost-zero-area triangles — are what a torn or
   * glitchy surface is actually made of, and they read as hard fins under
   * any shading. Smoothing only the vertices that belong to them cleans that
   * up without softening anything that is already well formed.
   *
   * Returns how many triangles were involved.
   */
  /**
   * Turn the whole mesh the right way out.
   *
   * Two separate faults, and a mesh can have either or both. The first is
   * *inconsistency*: neighbouring triangles wound opposite ways, so parts of
   * a surface face out and parts face in — the ends of a tube facing into
   * it, say. The second is being *inside out*: every triangle consistent
   * with its neighbours, but the whole shell facing inwards, which with back
   * faces culled draws the far inside of the shape instead of the near
   * outside.
   *
   * Consistency is fixed by walking the surface: two triangles that share an
   * edge agree only if they run along it in opposite directions, so a
   * neighbour that runs the same way is flipped, and the walk carries on
   * from there. Which way round the result faces is then one decision per
   * connected piece — the sign of its enclosed volume where it is closed,
   * and where it is not, whether its faces mostly point away from its
   * middle.
   *
   * A flat piece is left exactly as it is: a sheet has no outside, so there
   * is no answer to give. Those are drawn from both sides instead.
   *
   * Returns { flipped, pieces, turned }: how many triangles were turned to
   * agree with their neighbours, how many separate pieces were found, and
   * how many of those pieces were inside out.
   */
  P.orientConsistently = function () {
    var T = this.tris.array, pos = this.positions.array;
    var nt = this.triDead.length;
    var seen = new Uint8Array(nt);
    var stack = [], piece = [];
    var edge = [];
    var flipped = 0, pieces = 0, turned = 0;
    var self = this;

    function flip(t) {
      var t3 = t * 3, tmp = T[t3 + 1];
      T[t3 + 1] = T[t3 + 2]; T[t3 + 2] = tmp;
    }
    /** Does triangle `t` run from a to b, the same way as its neighbour? */
    function runsSame(t, a, b) {
      var t3 = t * 3;
      for (var k = 0; k < 3; k++) {
        if (T[t3 + k] === a && T[t3 + (k + 1) % 3] === b) return true;
      }
      return false;
    }

    for (var seed = 0; seed < nt; seed++) {
      if (this.triDead.array[seed] || seen[seed]) continue;
      pieces++;
      seen[seed] = 1;
      stack.length = 0; piece.length = 0;
      stack.push(seed); piece.push(seed);
      var open = false;
      while (stack.length) {
        var t = stack.pop();
        var t3 = t * 3;
        for (var k = 0; k < 3; k++) {
          var a = T[t3 + k], b = T[t3 + (k + 1) % 3];
          edge.length = 0;
          this.edgeTris(a, b, edge);
          if (edge.length < 2) open = true;
          for (var i = 0; i < edge.length; i++) {
            var o = edge[i];
            if (o === t || this.triDead.array[o] || seen[o]) continue;
            // sharing an edge in the same direction means facing opposite ways
            if (runsSame(o, a, b)) { flip(o); flipped++; }
            seen[o] = 1;
            stack.push(o);
            piece.push(o);
          }
        }
      }

      /* which way round is this piece? */
      var cx = 0, cy = 0, cz = 0, n = 0;
      var j, o3, ia, ib, ic;
      for (j = 0; j < piece.length; j++) {
        o3 = piece[j] * 3;
        for (var c = 0; c < 3; c++) {
          var v3 = T[o3 + c] * 3;
          cx += pos[v3]; cy += pos[v3 + 1]; cz += pos[v3 + 2]; n++;
        }
      }
      if (!n) continue;
      cx /= n; cy /= n; cz /= n;

      var volume = 0, facing = 0;
      for (j = 0; j < piece.length; j++) {
        o3 = piece[j] * 3;
        ia = T[o3] * 3; ib = T[o3 + 1] * 3; ic = T[o3 + 2] * 3;
        var ax = pos[ia] - cx, ay = pos[ia + 1] - cy, az = pos[ia + 2] - cz;
        var bx = pos[ib] - cx, by = pos[ib + 1] - cy, bz = pos[ib + 2] - cz;
        var gx = pos[ic] - cx, gy = pos[ic + 1] - cy, gz = pos[ic + 2] - cz;
        volume += (ax * (by * gz - bz * gy) - ay * (bx * gz - bz * gx) + az * (bx * gy - by * gx)) / 6;
        // ...and, for an open piece, whether the faces point away from the middle
        var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        var e2x = gx - ax, e2y = gy - ay, e2z = gz - az;
        var fnx = e1y * e2z - e1z * e2y, fny = e1z * e2x - e1x * e2z, fnz = e1x * e2y - e1y * e2x;
        var mx = (ax + bx + gx) / 3, my = (ay + by + gy) / 3, mz = (az + bz + gz) / 3;
        facing += fnx * mx + fny * my + fnz * mz;
      }
      var inside = open ? (facing < 0) : (volume < 0);
      if (inside) {
        for (j = 0; j < piece.length; j++) flip(piece[j]);
        turned++;
      }
    }

    if (flipped || turned) {
      this.topoDirty = true;
      this.computeNormals();
    }
    return { flipped: flipped, pieces: pieces, turned: turned };
  };

  P.relaxSlivers = function (quality, amount) {
    quality = quality === undefined ? 0.12 : quality;
    amount = amount === undefined ? 0.6 : amount;
    var T = this.tris.array;
    var seen = new Uint8Array(this.masks.length);
    var verts = [];
    var count = 0;
    for (var t = 0; t < this.triDead.length; t++) {
      if (this.triDead.array[t]) continue;
      if (this.triQuality(t) >= quality) continue;
      count++;
      var t3 = t * 3;
      for (var k = 0; k < 3; k++) {
        var v = T[t3 + k];
        if (v < seen.length && !seen[v]) { seen[v] = 1; verts.push(v); }
      }
    }
    if (verts.length) {
      this.smoothVerts(Uint32Array.from(verts), verts.length, amount, true);
      this.computeNormals();
      this._boundsDirty = true;
    }
    return count;
  };

  P.smoothAll = function (iterations, amount, tangential) {
    var live = [];
    var nv = this.masks.length;
    for (var v = 0; v < nv; v++) if (!this.vertDead.array[v]) live.push(v);
    var arr = new Uint32Array(live);
    for (var i = 0; i < iterations; i++) {
      this.smoothVerts(arr, arr.length, amount, tangential);
    }
    this.computeNormals();
    this.gridRebuild();
    this.dirtyMinVert = 0; this.dirtyMaxVert = nv - 1;
    return this;
  };

  /** Blur the mask (Mask > Smooth). */
  P.smoothMask = function (iterations, amount) {
    var nv = this.masks.length, msk = this.masks.array, T = this.tris.array;
    var tmp = new Float32Array(nv);
    for (var it = 0; it < iterations; it++) {
      for (var v = 0; v < nv; v++) {
        if (this.vertDead.array[v]) continue;
        var lst = this.vertTris[v], s = 0, c = 0;
        for (var j = 0; j < lst.length; j++) {
          var t3 = lst[j] * 3;
          for (var k = 0; k < 3; k++) { var w = T[t3 + k]; if (w !== v) { s += msk[w]; c++; } }
        }
        tmp[v] = c ? msk[v] + (s / c - msk[v]) * amount : msk[v];
      }
      for (v = 0; v < nv; v++) if (!this.vertDead.array[v]) msk[v] = tmp[v];
    }
    this.dirtyMinVert = 0; this.dirtyMaxVert = nv - 1;
    return this;
  };

  /* ------------------------------------------------------------------ *
   * whole-mesh helpers used by the Mesh menu
   * ------------------------------------------------------------------ */

  P.setMaskAll = function (value) {
    var nv = this.masks.length;
    for (var v = 0; v < nv; v++) if (!this.vertDead.array[v]) this.masks.array[v] = value;
    this.dirtyMinVert = 0; this.dirtyMaxVert = nv - 1;
  };

  P.invertMask = function () {
    var nv = this.masks.length;
    for (var v = 0; v < nv; v++) if (!this.vertDead.array[v]) this.masks.array[v] = 1 - this.masks.array[v];
    this.dirtyMinVert = 0; this.dirtyMaxVert = nv - 1;
  };

  P.setColorAll = function (r, g, b) {
    var nv = this.masks.length, col = this.colors.array;
    for (var v = 0; v < nv; v++) {
      if (this.vertDead.array[v]) continue;
      var i = v * 3;
      col[i] = r; col[i + 1] = g; col[i + 2] = b;
    }
    this.dirtyMinVert = 0; this.dirtyMaxVert = nv - 1;
  };

  /**
   * Split every edge that crosses the `axis` plane so the mesh can be cut
   * cleanly along it. New vertices land exactly on the plane.
   */
  P.splitPlaneEdges = function (axis, eps) {
    var splits = 0;
    for (var pass = 0; pass < 64; pass++) {
      var did = 0;
      var nt = this.triDead.length;
      for (var t = 0; t < nt; t++) {
        if (this.triDead.array[t]) continue;
        var T = this.tris.array, pos = this.positions.array, t3 = t * 3;
        for (var k = 0; k < 3; k++) {
          var a = T[t3 + k], b = T[t3 + (k + 1) % 3];
          var ca = pos[a * 3 + axis], cb = pos[b * 3 + axis];
          if ((ca > eps && cb < -eps) || (ca < -eps && cb > eps)) {
            var f = ca / (ca - cb);
            var m = this.splitEdge(a, b, f);
            if (m >= 0) {
              this.positions.array[m * 3 + axis] = 0;
              did++; splits++;
            }
            break;                 // this triangle is gone; move on
          }
        }
      }
      if (!did) break;
    }
    return splits;
  };

  /**
   * Keep only the half of the mesh on one side of an axis plane, cutting
   * cleanly through the triangles that straddle it.
   */
  P.cutByPlane = function (axis, positive) {
    var eps = Math.max(this.boundsRadius() * 1e-6, 1e-9);
    this.splitPlaneEdges(axis, eps);
    var sgn = positive ? 1 : -1;
    var T = this.tris.array, pos = this.positions.array;
    var nt = this.triDead.length;
    for (var t = 0; t < nt; t++) {
      if (this.triDead.array[t]) continue;
      var t3 = t * 3, drop = false;
      for (var k = 0; k < 3; k++) {
        if (pos[T[t3 + k] * 3 + axis] * sgn < -eps) { drop = true; break; }
      }
      if (drop) this.removeTriangle(t);
    }
    this.removeIsolatedVertices();
    // snap the seam so the mirrored copy welds onto it exactly
    var nv = this.masks.length;
    for (var v = 0; v < nv; v++) {
      if (this.vertDead.array[v]) continue;
      var o = v * 3 + axis;
      if (Math.abs(pos[o]) <= eps * 4) pos[o] = 0;
    }
    this._boundsDirty = true;
    this.topoDirty = true;
    this.gridRebuild();
    this.dirtyMinVert = 0; this.dirtyMaxVert = nv - 1;
    return this;
  };

  /**
   * Make the mesh symmetric: cut at the axis plane, keep one half, mirror it
   * and weld the seam. axis: 0=x, 1=y, 2=z; `positive` keeps the + side.
   */
  P.symmetrize = function (axis, positive) {
    this.cutByPlane(axis, positive);
    var d = this.toIndexed();
    var pos = d.positions, idx = d.indices32, col = d.colors;
    var half = d.vertCount, i, v;

    var outPos = new Float32Array(half * 6);
    var outCol = new Float32Array(half * 6);
    outPos.set(pos); outCol.set(col);
    for (v = 0; v < half; v++) {
      var o = v * 3, w = (half + v) * 3;
      outPos[w] = axis === 0 ? -pos[o] : pos[o];
      outPos[w + 1] = axis === 1 ? -pos[o + 1] : pos[o + 1];
      outPos[w + 2] = axis === 2 ? -pos[o + 2] : pos[o + 2];
      outCol[w] = col[o]; outCol[w + 1] = col[o + 1]; outCol[w + 2] = col[o + 2];
    }
    var n = idx.length;
    var outIdx = new Uint32Array(n * 2);
    outIdx.set(idx);
    for (i = 0; i < n; i += 3) {
      // reversed winding, because mirroring flips handedness
      outIdx[n + i] = idx[i] + half;
      outIdx[n + i + 1] = idx[i + 2] + half;
      outIdx[n + i + 2] = idx[i + 1] + half;
    }
    var tol = Math.max(this.boundsRadius() * 1e-7, 1e-10);
    this.setFromArrays(outPos, outIdx, { colors: outCol, weld: true, weldTolerance: tol });
    return this;
  };

  /**
   * Count edges whose face count is not two: `mode` 'border' for open edges
   * (one face), 'nonmanifold' for pinched ones (three or more), or 'any'.
   */
  P.countOddEdges = function (mode) {
    var T = this.tris.array, nt = this.triDead.length, n = 0;
    for (var t = 0; t < nt; t++) {
      if (this.triDead.array[t]) continue;
      var t3 = t * 3;
      for (var k = 0; k < 3; k++) {
        var a = T[t3 + k], b = T[t3 + (k + 1) % 3];
        if (a > b) { var tmp = a; a = b; b = tmp; }
        else if (a === b) continue;
        // count each edge once, from the triangle that lists it as a<b
        if (T[t3 + k] > T[t3 + (k + 1) % 3]) continue;
        var c = this.countEdgeTris(a, b);
        if (c === 2) continue;
        if (mode === 'border' && c !== 1) continue;
        if (mode === 'nonmanifold' && c <= 2) continue;
        n++;
      }
    }
    return n;
  };

  /** Open edges: exactly one face. Zero means the surface is watertight. */
  P.countBorderEdges = function () { return this.countOddEdges('border'); };

  /** Pinched edges: three or more faces. Zero means the surface is manifold. */
  P.countNonManifoldEdges = function () { return this.countOddEdges('nonmanifold'); };

})(typeof globalThis !== 'undefined' ? globalThis : this);
