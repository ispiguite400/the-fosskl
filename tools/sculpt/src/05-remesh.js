/*
 * SculptFree — voxel remesh.
 *
 * Sculpting with dynamic topology eventually leaves stretched, uneven
 * triangles. Remeshing rebuilds the surface at a uniform density:
 *
 *   1. sample a signed distance field around the mesh, exactly inside a
 *      narrow band and by ray parity everywhere else,
 *   2. extract the zero level set with surface nets (dual contouring on a
 *      uniform grid), which gives well-shaped, evenly spaced triangles,
 *   3. relax the result a little to take the staircase off,
 *   4. carry the vertex colours over from the old surface.
 *
 * Meshes with open edges have no inside, so for those the field is offset
 * into a shell of a chosen thickness instead — which doubles as a Solidify.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var Remesh = S.Remesh = {};

  var MAX_SAMPLES = 24e6;            // ~96 MB of float field, the practical cap

  /* ---------------------------------------------------------------- *
   * surface nets tables
   * ---------------------------------------------------------------- */

  var cubeEdges = new Int32Array(24);
  var edgeTable = new Int32Array(256);
  (function () {
    var k = 0, i, j;
    for (i = 0; i < 8; ++i) {
      for (j = 1; j <= 4; j <<= 1) {
        var p = i ^ j;
        if (i <= p) { cubeEdges[k++] = i; cubeEdges[k++] = p; }
      }
    }
    for (i = 0; i < 256; ++i) {
      var em = 0;
      for (j = 0; j < 24; j += 2) {
        var a = !!(i & (1 << cubeEdges[j]));
        var b = !!(i & (1 << cubeEdges[j + 1]));
        em |= a !== b ? (1 << (j >> 1)) : 0;
      }
      edgeTable[i] = em;
    }
  })();

  /* Which axis each cube edge runs along, and the lookup from
     (lower corner, axis) back to the edge index. */
  var edgeAxis = new Int32Array(12);
  var edgeOfCornerAxis = new Int32Array(8 * 3).fill(-1);
  (function () {
    for (var e = 0; e < 12; e++) {
      var p = cubeEdges[e * 2], q = cubeEdges[e * 2 + 1];
      var d = p ^ q;
      var axis = d === 1 ? 0 : (d === 2 ? 1 : 2);
      edgeAxis[e] = axis;
      edgeOfCornerAxis[Math.min(p, q) * 3 + axis] = e;
    }
  })();

  /*
   * The six faces of the cube, each as four corners in a fixed cyclic order
   * plus the four cube edges between them.
   *
   * The order is expressed in the face's own (u, v) axes, which are the same
   * two axes for both cells that share a face — so both cells walk the face
   * identically. That is what makes the sheet decomposition below agree
   * across a face, and hence makes the extracted surface a manifold.
   */
  var FACES = (function () {
    var faces = [];
    for (var a = 0; a < 3; a++) {
      var u = (a + 1) % 3, v = (a + 2) % 3;
      for (var side = 0; side < 2; side++) {
        var corners = [];
        var uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
        for (var i = 0; i < 4; i++) {
          corners.push((side << a) | (uv[i][0] << u) | (uv[i][1] << v));
        }
        var edges = [];
        for (i = 0; i < 4; i++) {
          var c0 = corners[i], c1 = corners[(i + 1) % 4];
          var d = c0 ^ c1;
          var axis = d === 1 ? 0 : (d === 2 ? 1 : 2);
          edges.push(edgeOfCornerAxis[Math.min(c0, c1) * 3 + axis]);
        }
        faces.push({ corners: corners, edges: edges });
      }
    }
    return faces;
  })();

  /**
   * Extract the zero level set of `field` (sampled at dims[0]*dims[1]*dims[2]
   * corners, x fastest) as a triangle mesh.
   *
   * Dual contouring: one vertex per sheet of surface inside each cell, and
   * one quad per grid edge that crosses the surface, joining the four cells
   * around that edge.
   *
   * The subtle part is how many vertices a cell needs. Where the surface
   * nearly touches itself, two separate sheets pass through one cell; giving
   * them one shared vertex welds them into an edge with four faces, which is
   * not a manifold and cannot be sculpted or exported cleanly. So the cell's
   * crossing edges are grouped into sheets, joining two edges when they meet
   * on a face of the cube. Because both cells sharing a face group that
   * face's edges the same way, every mesh edge ends up with exactly two
   * faces: the result is closed and manifold, by construction.
   *
   * Vertex coordinates come back in sample space; the caller scales them.
   */
  Remesh.surfaceNets = function (field, dims) {
    var nx = dims[0], ny = dims[1], nz = dims[2];
    var cellsX = nx - 1, cellsY = ny - 1, cellsZ = nz - 1;
    if (cellsX < 1 || cellsY < 1 || cellsZ < 1) {
      return { positions: new Float32Array(0), indices: new Uint32Array(0) };
    }
    var strideY = nx, strideZ = nx * ny;
    var cornerOffset = new Int32Array(8);
    for (var c = 0; c < 8; c++) {
      cornerOffset[c] = (c & 1) + ((c >> 1) & 1) * strideY + ((c >> 2) & 1) * strideZ;
    }

    var vx = [], vy = [], vz = [];
    var cellVerts = new Map();
    var grid = new Float64Array(8);
    var parent = new Int32Array(12);
    var crossT = new Float64Array(12);
    var groupOf = new Int32Array(12);
    var sumX = new Float64Array(12), sumY = new Float64Array(12), sumZ = new Float64Array(12);
    var sumN = new Int32Array(12);
    var rootToGroup = new Int32Array(12);

    function find(i) {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
      return i;
    }
    function union(i, j) {
      var ri = find(i), rj = find(j);
      if (ri !== rj) parent[rj] = ri;
    }

    for (var z = 0; z < cellsZ; z++) {
      for (var y = 0; y < cellsY; y++) {
        for (var x = 0; x < cellsX; x++) {
          var base = x + y * strideY + z * strideZ;
          var mask = 0;
          for (c = 0; c < 8; c++) {
            var val = field[base + cornerOffset[c]];
            grid[c] = val;
            if (val < 0) mask |= 1 << c;
          }
          if (mask === 0 || mask === 0xff) continue;

          var e, i, crossing = 0;
          for (e = 0; e < 12; e++) {
            parent[e] = e;
            var p0 = cubeEdges[e * 2], p1 = cubeEdges[e * 2 + 1];
            var in0 = (mask >> p0) & 1, in1 = (mask >> p1) & 1;
            if (in0 === in1) { crossT[e] = -1; continue; }
            var g0 = grid[p0], g1 = grid[p1];
            var denom = g0 - g1;
            var t = Math.abs(denom) > 1e-30 ? g0 / denom : 0.5;
            crossT[e] = t < 0 ? 0 : (t > 1 ? 1 : t);
            crossing++;
          }
          if (!crossing) continue;

          /* join crossing edges that meet on a face */
          for (var f = 0; f < 6; f++) {
            var face = FACES[f];
            var fc = face.corners, fe = face.edges;
            var list = [], n = 0;
            for (i = 0; i < 4; i++) if (crossT[fe[i]] >= 0) { list.push(i); n++; }
            if (n === 2) {
              union(fe[list[0]], fe[list[1]]);
            } else if (n === 4) {
              // ambiguous face: the signs alternate around it, so there are
              // two ways to pair the crossings. Both cells decide from the
              // same corner, so they cannot disagree.
              var pivotInside = (mask >> fc[1]) & 1;
              if (pivotInside) {
                union(fe[0], fe[1]);
                union(fe[2], fe[3]);
              } else {
                union(fe[1], fe[2]);
                union(fe[3], fe[0]);
              }
            }
          }

          /* one vertex per group */
          var nGroups = 0;
          rootToGroup.fill(-1);
          sumX.fill(0); sumY.fill(0); sumZ.fill(0); sumN.fill(0);
          for (e = 0; e < 12; e++) {
            if (crossT[e] < 0) { groupOf[e] = -1; continue; }
            var root = find(e);
            var g = rootToGroup[root];
            if (g < 0) { g = nGroups++; rootToGroup[root] = g; }
            groupOf[e] = g;
            var q0 = cubeEdges[e * 2], q1 = cubeEdges[e * 2 + 1];
            var t2 = crossT[e];
            var ax = q0 & 1, ay = (q0 >> 1) & 1, az = (q0 >> 2) & 1;
            var bx = q1 & 1, by = (q1 >> 1) & 1, bz = (q1 >> 2) & 1;
            sumX[g] += ax + (bx - ax) * t2;
            sumY[g] += ay + (by - ay) * t2;
            sumZ[g] += az + (bz - az) * t2;
            sumN[g]++;
          }

          var groupVert = new Int32Array(nGroups);
          for (i = 0; i < nGroups; i++) {
            groupVert[i] = vx.length;
            vx.push(x + sumX[i] / sumN[i]);
            vy.push(y + sumY[i] / sumN[i]);
            vz.push(z + sumZ[i] / sumN[i]);
          }
          var edgeVert = new Int32Array(12).fill(-1);
          for (e = 0; e < 12; e++) if (groupOf[e] >= 0) edgeVert[e] = groupVert[groupOf[e]];
          cellVerts.set(base, edgeVert);
        }
      }
    }

    /* one quad per crossing grid edge, from the cell whose corner 0 starts it */
    var tris = [];
    var quad = new Int32Array(4);
    var OFFSETS = [[0, 0], [-1, 0], [-1, -1], [0, -1]];   // counter-clockwise about +axis
    var cell = [0, 0, 0];
    cellVerts.forEach(function (edgeVert, base) {
      var z2 = (base / strideZ) | 0;
      var rem = base - z2 * strideZ;
      var y2 = (rem / strideY) | 0;
      var x2 = rem - y2 * strideY;
      for (var a = 0; a < 3; a++) {
        if (edgeVert[edgeOfCornerAxis[a]] < 0) continue;      // no crossing
        var u = (a + 1) % 3, v = (a + 2) % 3;
        var ok = true;
        for (var q = 0; q < 4; q++) {
          var du = OFFSETS[q][0], dv = OFFSETS[q][1];
          cell[0] = x2; cell[1] = y2; cell[2] = z2;
          cell[u] += du;
          cell[v] += dv;
          if (cell[0] < 0 || cell[1] < 0 || cell[2] < 0) { ok = false; break; }
          var rec = cellVerts.get(cell[0] + cell[1] * strideY + cell[2] * strideZ);
          if (!rec) { ok = false; break; }
          var c0 = ((-du) << u) | ((-dv) << v);
          var eIdx = edgeOfCornerAxis[c0 * 3 + a];
          if (eIdx < 0 || rec[eIdx] < 0) { ok = false; break; }
          quad[q] = rec[eIdx];
        }
        if (!ok) continue;

        // split along the shorter diagonal, which avoids folding the quad
        // when the four vertices are far from coplanar
        var v0 = quad[0], v1 = quad[1], v2 = quad[2], v3 = quad[3];
        var d02 = (vx[v0] - vx[v2]) * (vx[v0] - vx[v2]) + (vy[v0] - vy[v2]) * (vy[v0] - vy[v2]) + (vz[v0] - vz[v2]) * (vz[v0] - vz[v2]);
        var d13 = (vx[v1] - vx[v3]) * (vx[v1] - vx[v3]) + (vy[v1] - vy[v3]) * (vy[v1] - vy[v3]) + (vz[v1] - vz[v3]) * (vz[v1] - vz[v3]);
        var flip = field[base] >= 0;          // which end of the edge is inside
        if (!flip) {
          if (d13 < d02) tris.push(v0, v1, v3, v1, v2, v3);
          else tris.push(v0, v1, v2, v0, v2, v3);
        } else {
          if (d13 < d02) tris.push(v0, v3, v1, v1, v3, v2);
          else tris.push(v0, v3, v2, v0, v2, v1);
        }
      }
    });

    var positions = new Float32Array(vx.length * 3);
    for (var w = 0; w < vx.length; w++) {
      positions[w * 3] = vx[w];
      positions[w * 3 + 1] = vy[w];
      positions[w * 3 + 2] = vz[w];
    }
    return { positions: positions, indices: new Uint32Array(tris) };
  };

  /* ---------------------------------------------------------------- *
   * signed distance field
   * ---------------------------------------------------------------- */

  /**
   * Work out the grid for a given resolution (voxels along the longest side),
   * clamped so the field stays within the sample budget. Reported to the UI
   * before committing to a remesh.
   */
  Remesh.plan = function (mesh, resolution, padVoxels) {
    mesh.bounds();
    var mn = mesh.boundsMin(), mx = mesh.boundsMax();
    var sx = mx[0] - mn[0], sy = mx[1] - mn[1], sz = mx[2] - mn[2];
    var maxSide = Math.max(sx, sy, sz, 1e-6);
    var res = Math.max(8, Math.min(1024, Math.round(resolution)));
    var pad = padVoxels === undefined ? 2 : padVoxels;
    var voxel, dims, samples, clamped = false;
    for (var guard = 0; guard < 64; guard++) {
      voxel = maxSide / res;
      dims = [
        Math.max(4, Math.ceil(sx / voxel) + pad * 2 + 1),
        Math.max(4, Math.ceil(sy / voxel) + pad * 2 + 1),
        Math.max(4, Math.ceil(sz / voxel) + pad * 2 + 1)
      ];
      samples = dims[0] * dims[1] * dims[2];
      if (samples <= MAX_SAMPLES) break;
      res = Math.floor(res * 0.85);
      clamped = true;
      if (res < 8) { res = 8; }
    }
    var origin = [mn[0] - voxel * pad, mn[1] - voxel * pad, mn[2] - voxel * pad];
    return {
      resolution: res, voxel: voxel, dims: dims, origin: origin,
      samples: samples, clamped: clamped,
      // surface nets makes roughly two triangles per surface-crossing cell
      estimateTris: Math.round(2 * Math.pow(samples, 2 / 3) * 1.6)
    };
  };

  /**
   * Exact unsigned distance in a band of `bandVoxels` around every triangle;
   * everything else keeps `far`.
   */
  function bandDistance(mesh, plan, bandVoxels, onProgress) {
    var dims = plan.dims, voxel = plan.voxel, origin = plan.origin;
    var nx = dims[0], ny = dims[1], nz = dims[2];
    var field = new Float32Array(nx * ny * nz);
    var far = voxel * 1e6;
    field.fill(far);

    var T = mesh.tris.array, p = mesh.positions.array;
    var nt = mesh.triDead.length;
    var band = bandVoxels * voxel;
    var inv = 1 / voxel;
    var nxny = nx * ny;
    var closest = [0, 0, 0];
    var reportEvery = Math.max(1, nt >> 5);

    for (var t = 0; t < nt; t++) {
      if (mesh.triDead.array[t]) continue;
      if (onProgress && (t % reportEvery) === 0) onProgress(t / nt);
      var t3 = t * 3;
      var ia = T[t3] * 3, ib = T[t3 + 1] * 3, ic = T[t3 + 2] * 3;
      var ax = p[ia], ay = p[ia + 1], az = p[ia + 2];
      var bx = p[ib], by = p[ib + 1], bz = p[ib + 2];
      var cx = p[ic], cy = p[ic + 1], cz = p[ic + 2];

      var x0 = Math.floor((Math.min(ax, bx, cx) - band - origin[0]) * inv);
      var x1 = Math.ceil((Math.max(ax, bx, cx) + band - origin[0]) * inv);
      var y0 = Math.floor((Math.min(ay, by, cy) - band - origin[1]) * inv);
      var y1 = Math.ceil((Math.max(ay, by, cy) + band - origin[1]) * inv);
      var z0 = Math.floor((Math.min(az, bz, cz) - band - origin[2]) * inv);
      var z1 = Math.ceil((Math.max(az, bz, cz) + band - origin[2]) * inv);
      if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (z0 < 0) z0 = 0;
      if (x1 > nx - 1) x1 = nx - 1; if (y1 > ny - 1) y1 = ny - 1; if (z1 > nz - 1) z1 = nz - 1;

      for (var iz = z0; iz <= z1; iz++) {
        var wz = origin[2] + iz * voxel;
        var zo = iz * nxny;
        for (var iy = y0; iy <= y1; iy++) {
          var wy = origin[1] + iy * voxel;
          var yo = zo + iy * nx;
          for (var ix = x0; ix <= x1; ix++) {
            var wx = origin[0] + ix * voxel;
            var d2 = S.pointTriangleSq(wx, wy, wz, ax, ay, az, bx, by, bz, cx, cy, cz, closest);
            if (d2 > band * band) continue;
            var d = Math.sqrt(d2);
            var o = yo + ix;
            if (d < field[o]) field[o] = d;
          }
        }
      }
    }
    return { field: field, far: far };
  }

  /**
   * Inside/outside by ray parity along one axis, voted across all three so a
   * mesh with a few bad triangles still classifies sensibly.
   */
  function parityInside(mesh, plan, axis, votes, weight) {
    var dims = plan.dims, voxel = plan.voxel, origin = plan.origin;
    var nx = dims[0], ny = dims[1], nz = dims[2];
    var T = mesh.tris.array, p = mesh.positions.array;
    var nt = mesh.triDead.length;
    var inv = 1 / voxel;

    // u,v are the axes across the ray; w is along it
    var u = (axis + 1) % 3, v = (axis + 2) % 3, w = axis;
    var du = dims[u], dv = dims[v];
    var rows = new Array(du * dv);
    // nudge the sample lines off the lattice so rays rarely hit an edge exactly
    var jitterU = voxel * 0.00137, jitterV = voxel * 0.00219;

    for (var t = 0; t < nt; t++) {
      if (mesh.triDead.array[t]) continue;
      var t3 = t * 3;
      var ia = T[t3] * 3, ib = T[t3 + 1] * 3, ic = T[t3 + 2] * 3;
      var au = p[ia + u], av = p[ia + v], aw = p[ia + w];
      var bu = p[ib + u], bv = p[ib + v], bw = p[ib + w];
      var cu = p[ic + u], cv = p[ic + v], cw = p[ic + w];

      var iu0 = Math.floor((Math.min(au, bu, cu) - origin[u]) * inv);
      var iu1 = Math.ceil((Math.max(au, bu, cu) - origin[u]) * inv);
      var iv0 = Math.floor((Math.min(av, bv, cv) - origin[v]) * inv);
      var iv1 = Math.ceil((Math.max(av, bv, cv) - origin[v]) * inv);
      if (iu0 < 0) iu0 = 0; if (iv0 < 0) iv0 = 0;
      if (iu1 > du - 1) iu1 = du - 1; if (iv1 > dv - 1) iv1 = dv - 1;

      var e1u = bu - au, e1v = bv - av, e2u = cu - au, e2v = cv - av;
      var det = e1u * e2v - e1v * e2u;
      if (Math.abs(det) < 1e-20) continue;
      var invDet = 1 / det;

      for (var jv = iv0; jv <= iv1; jv++) {
        var sv = origin[v] + jv * voxel + jitterV;
        for (var ju = iu0; ju <= iu1; ju++) {
          var su = origin[u] + ju * voxel + jitterU;
          var pu = su - au, pv = sv - av;
          var b1 = (pu * e2v - pv * e2u) * invDet;
          var b2 = (e1u * pv - e1v * pu) * invDet;
          if (b1 < 0 || b2 < 0 || b1 + b2 > 1) continue;
          var hit = aw + (bw - aw) * b1 + (cw - aw) * b2;
          var key = jv * du + ju;
          var list = rows[key];
          if (list) list.push(hit); else rows[key] = [hit];
        }
      }
    }

    // walk each line and mark the spans between crossings
    var strides = [1, nx, nx * ny];
    var sw = strides[w], su2 = strides[u], sv2 = strides[v];
    var nw = dims[w];
    for (var key2 = 0; key2 < rows.length; key2++) {
      var list2 = rows[key2];
      if (!list2 || list2.length < 2) continue;
      list2.sort(function (a, b) { return a - b; });
      var base = (key2 % du) * su2 + Math.floor(key2 / du) * sv2;
      var ci = 0;
      var inside = false;
      for (var iw = 0; iw < nw; iw++) {
        var wpos = origin[w] + iw * voxel;
        while (ci < list2.length && list2[ci] <= wpos) { inside = !inside; ci++; }
        if (inside) votes[base + iw * sw] += weight;
      }
    }
  }

  /**
   * Build the signed field. Returns {field, dims, origin, voxel}.
   * `opts.shell` makes a solid shell of `opts.thickness` world units instead
   * of filling the interior — the only sane option for open surfaces.
   */
  Remesh.buildField = function (mesh, plan, opts, onProgress) {
    opts = opts || {};
    var bandVoxels = opts.shell ? Math.max(2, opts.thickness / plan.voxel + 2) : 2.5;
    var res = bandDistance(mesh, plan, bandVoxels, onProgress && function (f) { onProgress(f * 0.6); });
    var field = res.field, far = res.far;
    var n = field.length;
    var i;

    if (opts.shell) {
      var half = Math.max(plan.voxel * 0.55, (opts.thickness || plan.voxel * 2) * 0.5);
      for (i = 0; i < n; i++) {
        var d = field[i];
        field[i] = (d >= far ? far : d) - half;
      }
      sealBoundary(field, plan.dims, plan.voxel);
      if (onProgress) onProgress(1);
      return field;
    }

    if (onProgress) onProgress(0.65);
    var votes = new Float32Array(n);
    parityInside(mesh, plan, 0, votes, 1);
    if (onProgress) onProgress(0.78);
    parityInside(mesh, plan, 1, votes, 1);
    if (onProgress) onProgress(0.9);
    parityInside(mesh, plan, 2, votes, 1);

    for (i = 0; i < n; i++) {
      var inside = votes[i] >= 1.5;         // at least two of three axes agree
      var dd = field[i];
      if (dd >= far) dd = plan.voxel * 4;   // outside the band: sign only
      field[i] = inside ? -dd : dd;
    }
    sealBoundary(field, plan.dims, plan.voxel);
    if (onProgress) onProgress(1);
    return field;
  };

  /**
   * Force the outermost layer of samples to read as "outside".
   *
   * Surface nets produces a closed surface for any sign field except where
   * the surface meets the edge of the grid, where it has no neighbouring
   * cell to build a quad against and silently leaves a hole. The grid is
   * padded well clear of the model, so there is nothing real out here to
   * lose, and this makes a watertight result a property of the algorithm
   * rather than something to hope for.
   */
  function sealBoundary(field, dims, voxel) {
    var nx = dims[0], ny = dims[1], nz = dims[2];
    var out = voxel * 4;
    var x, y, z, zo;
    for (z = 0; z < nz; z++) {
      zo = z * nx * ny;
      var edgeZ = (z === 0 || z === nz - 1);
      for (y = 0; y < ny; y++) {
        var row = zo + y * nx;
        var edgeY = (y === 0 || y === ny - 1);
        if (edgeZ || edgeY) {
          for (x = 0; x < nx; x++) if (field[row + x] < out) field[row + x] = out;
        } else {
          if (field[row] < out) field[row] = out;
          if (field[row + nx - 1] < out) field[row + nx - 1] = out;
        }
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * colour transfer
   * ---------------------------------------------------------------- */

  /** Nearest-surface colour lookup from the old mesh onto new vertices. */
  Remesh.transferColors = function (src, positions, count, searchRadius) {
    var out = new Float32Array(count * 3);
    var sp = src.positions.array, sc = src.colors.array;
    for (var i = 0; i < count; i++) {
      var o = i * 3;
      var x = positions[o], y = positions[o + 1], z = positions[o + 2];
      var r = searchRadius, found = -1, bestD = Infinity;
      for (var attempt = 0; attempt < 4 && found < 0; attempt++, r *= 2) {
        var cand = src.vertsInSphere(x, y, z, r);
        for (var k = 0; k < cand.length; k++) {
          var v = cand[k], v3 = v * 3;
          var dx = sp[v3] - x, dy = sp[v3 + 1] - y, dz = sp[v3 + 2] - z;
          var d = dx * dx + dy * dy + dz * dz;
          if (d < bestD) { bestD = d; found = v; }
        }
      }
      if (found >= 0) {
        var f3 = found * 3;
        out[o] = sc[f3]; out[o + 1] = sc[f3 + 1]; out[o + 2] = sc[f3 + 2];
      } else {
        out[o] = out[o + 1] = out[o + 2] = 1;
      }
    }
    return out;
  };

  /* ---------------------------------------------------------------- *
   * the whole operation
   * ---------------------------------------------------------------- */

  /**
   * Remesh `mesh` in place.
   *
   * opts.resolution   voxels along the longest bounding-box side
   * opts.smooth       relaxation passes on the result (default 2)
   * opts.colors       carry vertex colours over (default true)
   * opts.shell        solidify instead of filling (for open meshes)
   * opts.thickness    shell thickness in world units
   */
  Remesh.run = function (mesh, opts, onProgress) {
    opts = opts || {};
    var plan = Remesh.plan(mesh, opts.resolution || 128);
    var field = Remesh.buildField(mesh, plan, opts, onProgress && function (f) { onProgress(f * 0.7); });
    if (onProgress) onProgress(0.72);

    var net = Remesh.surfaceNets(field, plan.dims);
    if (!net.positions.length || !net.indices.length) {
      return { ok: false, reason: 'The field came out empty — try a higher resolution.' };
    }
    if (onProgress) onProgress(0.85);

    // sample space -> world
    var pos = net.positions, voxel = plan.voxel, org = plan.origin;
    for (var i = 0; i < pos.length; i += 3) {
      pos[i] = org[0] + pos[i] * voxel;
      pos[i + 1] = org[1] + pos[i + 1] * voxel;
      pos[i + 2] = org[2] + pos[i + 2] * voxel;
    }

    var colors = null;
    if (opts.colors !== false && Remesh.hasPaint(mesh)) {
      colors = Remesh.transferColors(mesh, pos, pos.length / 3, voxel * 1.5);
    }
    if (onProgress) onProgress(0.88);

    /*
     * Two cleanups, both optional, each checked before it is accepted.
     *
     * A vertex can be shared by two cones of surface that touch at a point
     * (manifold edges, non-manifold vertex); splitting it apart fixes that
     * and cannot open a hole, because no edge is shared.
     *
     * Separately, several cells can place their vertex at exactly the same
     * point — the poles of a sphere do — leaving a cap of zero-area
     * triangles that no edge collapse can remove. Welding exactly coincident
     * vertices deletes the cap, but it can also weld together surfaces that
     * merely touch, so the welded version is only kept when it comes out as
     * healthy as the unwelded one.
     */
    var plain = S.splitNonManifoldVertices(pos, net.indices, colors);
    var chosen = plain;
    var merged = 0;
    var welded = S.weldVertices(pos, net.indices, colors, voxel * 1e-5);
    if (welded.vertCount < pos.length / 3) {
      var weldedSplit = S.splitNonManifoldVertices(welded.positions, welded.indices, welded.colors);
      var healthA = S.edgeHealth(plain.indices);
      var healthB = S.edgeHealth(weldedSplit.indices);
      if (healthB.border <= healthA.border && healthB.nonManifold <= healthA.nonManifold) {
        chosen = weldedSplit;
        merged = (pos.length / 3) - welded.vertCount;
      }
    }
    pos = chosen.positions;
    var indices = chosen.indices;
    colors = chosen.colors;
    var repaired = chosen;
    if (onProgress) onProgress(0.94);

    var before = { verts: mesh.liveVerts, tris: mesh.liveTris };
    // Surface nets emits exactly one vertex per surface cell, so they are
    // already unique. Welding them can only merge vertices that happen to
    // coincide where the surface pinches, which makes the mesh non-manifold
    // there and leaves a hole once the degenerate triangles are dropped.
    mesh.setFromArrays(pos, indices, { colors: colors, weld: false });

    // any zero-area triangle left has three collinear vertices; collapsing
    // its shortest edge removes it without opening the surface
    var degenerate = mesh.removeDegenerateTriangles(voxel * voxel * 1e-7);

    var passes = opts.smooth === undefined ? 2 : opts.smooth;
    if (passes > 0) mesh.smoothAll(passes, 0.5, false);
    mesh.computeNormals();
    if (onProgress) onProgress(1);

    return {
      ok: true, plan: plan, before: before, pinchesSplit: repaired.splits,
      degenerateRemoved: degenerate, verticesMerged: merged,
      after: { verts: mesh.liveVerts, tris: mesh.liveTris }
    };
  };

  /** Does the mesh carry painted colour? Decides whether to transfer it. */
  Remesh.hasPaint = function (mesh) {
    var c = mesh.colors.array, n = mesh.masks.length;
    var step = Math.max(1, Math.floor(n / 2000));
    for (var v = 0; v < n; v += step) {
      if (mesh.vertDead.array[v]) continue;
      var o = v * 3;
      if (c[o] < 0.999 || c[o + 1] < 0.999 || c[o + 2] < 0.999) return true;
    }
    return false;
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
