/*
 * SculptFree — rigging.
 *
 * A skeleton you can fit to a model, skin weights worked out from the shape
 * itself, test poses to check them, and export as a skinned glTF that any
 * engine or animation tool can drive.
 *
 * The skeleton is a list of joints in world space, each with a parent. Every
 * joint's rest orientation is the identity, so a pose is simply a rotation per
 * joint about its own head, expressed in its parent's frame — which at rest is
 * the world's. That keeps the exported file trivially correct (translation-only
 * bind matrices) and keeps posing code short.
 *
 * Skin weights:
 *   1. Every separate piece of the model (a rifle, a helmet, the glasses) is
 *      carried whole by the one bone it sits against, so a prop never bends.
 *   2. On the main body each vertex goes to the nearest bone it can *see*
 *      from inside the body. Visibility is what stops the side of the chest
 *      being handed to an arm that hangs a few centimetres away: the straight
 *      line from the ribs to the arm bone leaves the body, so the arm is not
 *      a candidate.
 *   3. Near each joint the weight is shared with the neighbouring bone over a
 *      blend zone, so a knee bends as a curve instead of a crease.
 *   4. A few passes of smoothing along the surface take out the seams, and
 *      the four strongest influences are kept, normalised.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var V3 = S.V3;
  var Rig = S.Rig = {};

  /* ================================================================ *
   * skeletons
   * ================================================================ */

  /*
   * The humanoid template, as fractions of the model's height with the feet
   * at 0: [name, parent, x, y, z]. x is towards the character's left (+X),
   * so ".L" is the left side of the character, not of the screen.
   */
  var HUMANOID = [
    ['Hips', null, 0, 0.53, 0],
    ['Spine', 'Hips', 0, 0.6, 0],
    ['Chest', 'Spine', 0, 0.7, 0],
    ['Neck', 'Chest', 0, 0.815, 0],
    ['Head', 'Neck', 0, 0.865, 0],
    ['Shoulder.L', 'Chest', 0.022, 0.795, 0],
    ['UpperArm.L', 'Shoulder.L', 0.108, 0.79, 0],
    ['LowerArm.L', 'UpperArm.L', 0.14, 0.645, 0],
    ['Hand.L', 'LowerArm.L', 0.155, 0.52, 0],
    ['UpperLeg.L', 'Hips', 0.053, 0.52, 0],
    ['LowerLeg.L', 'UpperLeg.L', 0.06, 0.29, 0],
    ['Foot.L', 'LowerLeg.L', 0.063, 0.055, 0],
    ['Toes.L', 'Foot.L', 0.065, 0.014, 0.075]
  ];
  // where a bone with no child ends, as an offset from its head in the same units
  var LEAF_TAILS = { 'Head': [0, 0.12, 0], 'Hand.L': [0.005, -0.06, 0], 'Toes.L': [0, 0, 0.035] };

  Rig.mirrorName = function (name) {
    if (/\.L$/.test(name)) return name.slice(0, -2) + '.R';
    if (/\.R$/.test(name)) return name.slice(0, -2) + '.L';
    return name;
  };
  Rig.side = function (name) { return /\.L$/.test(name) ? 1 : (/\.R$/.test(name) ? -1 : 0); };

  /**
   * A humanoid skeleton fitted to a box: `min` and `max` are the model's
   * world bounds, feet at min[1], facing +Z.
   */
  Rig.humanoid = function (min, max) {
    var H = Math.max(max[1] - min[1], 1e-6);
    var cx = (min[0] + max[0]) * 0.5, cz = (min[2] + max[2]) * 0.5;
    var rows = [];
    HUMANOID.forEach(function (r) {
      rows.push(r);
      if (Rig.side(r[0]) > 0) rows.push([Rig.mirrorName(r[0]), r[1] && Rig.mirrorName(r[1]), -r[2], r[3], r[4]]);
    });
    var bones = rows.map(function (r) {
      return { name: r[0], parentName: r[1], head: [cx + r[2] * H, min[1] + r[3] * H, cz + r[4] * H] };
    });
    var index = {};
    bones.forEach(function (b, i) { index[b.name] = i; });
    bones.forEach(function (b) { b.parent = b.parentName ? index[b.parentName] : -1; delete b.parentName; });
    var sk = { bones: bones, height: H };
    // leaf tails, scaled to the model
    bones.forEach(function (b) {
      var key = LEAF_TAILS[b.name] ? b.name : (LEAF_TAILS[Rig.mirrorName(b.name)] ? Rig.mirrorName(b.name) : null);
      if (!key) return;
      var o = LEAF_TAILS[key], s = key === b.name ? 1 : -1;
      b.tail = [b.head[0] + o[0] * H * s, b.head[1] + o[1] * H, b.head[2] + o[2] * H];
    });
    return sk;
  };

  Rig.clone = function (sk) {
    return { height: sk.height, bones: sk.bones.map(function (b) {
      return { name: b.name, parent: b.parent, head: b.head.slice(), tail: b.tail ? b.tail.slice() : undefined };
    }) };
  };

  Rig.indexOf = function (sk, name) {
    for (var i = 0; i < sk.bones.length; i++) if (sk.bones[i].name === name) return i;
    return -1;
  };

  Rig.children = function (sk, i) {
    var out = [];
    for (var j = 0; j < sk.bones.length; j++) if (sk.bones[j].parent === i) out.push(j);
    return out;
  };

  /**
   * Where each bone ends. A bone with one child ends at it; the spine and
   * hips have several (neck and shoulders, spine and legs), and end at the
   * one on the centre line; a leaf ends at its stored tail, or carries on
   * half as far again as the bone before it.
   */
  Rig.tails = function (sk) {
    return sk.bones.map(function (b, i) {
      var kids = Rig.children(sk, i);
      if (kids.length === 1) return sk.bones[kids[0]].head.slice();
      if (kids.length > 1) {
        for (var k = 0; k < kids.length; k++) if (Rig.side(sk.bones[kids[k]].name) === 0) return sk.bones[kids[k]].head.slice();
        return sk.bones[kids[0]].head.slice();
      }
      if (b.tail) return b.tail.slice();
      if (b.parent >= 0) {
        var p = sk.bones[b.parent].head;
        return [b.head[0] + (b.head[0] - p[0]) * 0.5, b.head[1] + (b.head[1] - p[1]) * 0.5, b.head[2] + (b.head[2] - p[2]) * 0.5];
      }
      return [b.head[0], b.head[1] + (sk.height || 1) * 0.1, b.head[2]];
    });
  };

  /** Copy one side's joints onto the other, mirrored in X about `cx`. */
  Rig.symmetrize = function (sk, fromSide, cx) {
    cx = cx || 0;
    sk.bones.forEach(function (b) {
      if (Rig.side(b.name) !== fromSide) return;
      var j = Rig.indexOf(sk, Rig.mirrorName(b.name));
      if (j < 0) return;
      var m = sk.bones[j];
      m.head = [2 * cx - b.head[0], b.head[1], b.head[2]];
      if (b.tail) m.tail = [2 * cx - b.tail[0], b.tail[1], b.tail[2]];
    });
    return sk;
  };

  /**
   * Pull joints into the middle of the body: from each joint, look both ways
   * along X and along Z for the surface and move to the midpoint. A template
   * fitted to a bounding box gets the heights roughly right but can leave an
   * elbow sitting outside the arm; this puts it back inside.
   *
   * `raycast(origin, dir)` returns a hit distance or null. Only the joints of
   * limbs and the spine are moved; the head and toes keep their place.
   */
  Rig.centreJoints = function (sk, raycast, opts) {
    opts = opts || {};
    var reach = (sk.height || 1) * 0.25;
    var moved = 0;
    sk.bones.forEach(function (b) {
      if (/^(Head|Toes)/.test(b.name)) return;
      var p = b.head;
      for (var axis = 0; axis < 3; axis += 2) {
        if (axis === 0 && Rig.side(b.name) === 0) continue;       // the spine stays on the centre line
        var dp = [0, 0, 0], dn = [0, 0, 0];
        dp[axis] = 1; dn[axis] = -1;
        var a = raycast(p, dp), c = raycast(p, dn);
        if (a === null || c === null || a > reach || c > reach) continue;
        var shift = (a - c) * 0.5;
        if (Math.abs(shift) > 1e-5) { p[axis] += shift; moved++; }
      }
    });
    if (opts.symmetric) Rig.symmetrize(sk, 1, opts.cx || 0);
    return moved;
  };

  /* ================================================================ *
   * skin weights
   * ================================================================ */

  function segDist(p, a, b, out) {
    var abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    var l2 = abx * abx + aby * aby + abz * abz;
    var t = l2 > 1e-12 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / l2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var cx = a[0] + abx * t, cy = a[1] + aby * t, cz = a[2] + abz * t;
    if (out) { out[0] = cx; out[1] = cy; out[2] = cz; out[3] = t; }
    var dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  Rig.segDist = segDist;

  /** Split a mesh into its connected pieces. Returns a label per vertex and the sizes. */
  Rig.components = function (mesh) {
    var nv = mesh.vertCount(), T = mesh.tris.array, dead = mesh.triDead.array, nt = mesh.triCount();
    var parent = new Int32Array(nv);
    for (var i = 0; i < nv; i++) parent[i] = i;
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function unite(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }
    for (var t = 0; t < nt; t++) {
      if (dead[t]) continue;
      unite(T[t * 3], T[t * 3 + 1]); unite(T[t * 3 + 1], T[t * 3 + 2]);
    }
    var label = new Int32Array(nv).fill(-1), ids = new Map(), sizes = [];
    var vdead = mesh.vertDead.array;
    for (var v = 0; v < nv; v++) {
      if (vdead[v]) continue;
      var r = find(v);
      var id = ids.get(r);
      if (id === undefined) { id = sizes.length; ids.set(r, id); sizes.push(0); }
      label[v] = id; sizes[id]++;
    }
    return { label: label, sizes: sizes };
  };

  /** Each live vertex's neighbours, as a CSR list. */
  function neighbours(mesh) {
    var nv = mesh.vertCount(), T = mesh.tris.array, dead = mesh.triDead.array, nt = mesh.triCount();
    var count = new Int32Array(nv + 1);
    for (var t = 0; t < nt; t++) {
      if (dead[t]) continue;
      for (var e = 0; e < 3; e++) { count[T[t * 3 + e]] += 2; }
    }
    var start = new Int32Array(nv + 1);
    for (var v = 0; v < nv; v++) start[v + 1] = start[v] + count[v];
    var fill = start.slice(0, nv), list = new Int32Array(start[nv]);
    for (t = 0; t < nt; t++) {
      if (dead[t]) continue;
      var a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
      list[fill[a]++] = b; list[fill[a]++] = c;
      list[fill[b]++] = c; list[fill[b]++] = a;
      list[fill[c]++] = a; list[fill[c]++] = b;
    }
    return { start: start, list: list };
  }

  /**
   * Work out skin weights for `mesh` (whose world matrix is `matrix`, or
   * identity) against skeleton `sk`.
   *
   * Returns { joints: Uint16Array(n*4), weights: Float32Array(n*4) } indexed by
   * the mesh's own vertex slots, plus `key` (to spot a mesh that has changed
   * since) and a summary of what went where.
   */
  Rig.computeWeights = function (mesh, matrix, sk, opts) {
    opts = opts || {};
    var nv = mesh.vertCount(), P = mesh.positions.array, N = mesh.normals.array, vdead = mesh.vertDead.array;
    var nb = sk.bones.length;
    var heads = sk.bones.map(function (b) { return b.head; });
    var tails = Rig.tails(sk);
    var lens = heads.map(function (h, i) { return Math.max(1e-6, V3.dist(h, tails[i])); });
    var kids = sk.bones.map(function (b, i) { return Rig.children(sk, i); });

    // world positions and normals
    var W = new Float32Array(nv * 3), WN = new Float32Array(nv * 3);
    var m = matrix || null;
    for (var v = 0; v < nv; v++) {
      var o = v * 3, x = P[o], y = P[o + 1], z = P[o + 2], nx = N[o], ny = N[o + 1], nz = N[o + 2];
      if (m) {
        W[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
        W[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        W[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        var qx = m[0] * nx + m[4] * ny + m[8] * nz, qy = m[1] * nx + m[5] * ny + m[9] * nz, qz = m[2] * nx + m[6] * ny + m[10] * nz;
        var ql = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1;
        WN[o] = qx / ql; WN[o + 1] = qy / ql; WN[o + 2] = qz / ql;
      } else {
        W[o] = x; W[o + 1] = y; W[o + 2] = z; WN[o] = nx; WN[o + 1] = ny; WN[o + 2] = nz;
      }
    }

    var comps = Rig.components(mesh);
    var main = 0;
    for (var c = 1; c < comps.sizes.length; c++) if (comps.sizes[c] > comps.sizes[main]) main = c;

    /*
     * Inside test for the main body: a coarse signed field of that piece on
     * its own. Other pieces are left out on purpose — they overlap the body,
     * and the field's inside test counts crossings, which overlaps confuse.
     */
    var inside = null;
    if (opts.visibility !== false && S.Remesh && S.Remesh.buildField) {
      var body = new S.Mesh();
      var map = new Int32Array(nv).fill(-1), bp = [], bi = [];
      for (v = 0; v < nv; v++) if (!vdead[v] && comps.label[v] === main) { map[v] = bp.length / 3; bp.push(W[v * 3], W[v * 3 + 1], W[v * 3 + 2]); }
      var T = mesh.tris.array, tdead = mesh.triDead.array, nt = mesh.triCount();
      for (var t = 0; t < nt; t++) {
        if (tdead[t]) continue;
        var a = map[T[t * 3]], b2 = map[T[t * 3 + 1]], c2 = map[T[t * 3 + 2]];
        if (a >= 0 && b2 >= 0 && c2 >= 0) bi.push(a, b2, c2);
      }
      body.setFromArrays(new Float32Array(bp), new Uint32Array(bi), { weld: false });
      var plan = S.Remesh.plan(body, opts.visibilityResolution || 110, 2);
      var field = S.Remesh.buildField(body, plan, {});
      inside = { field: field, plan: plan };
    }
    function isInside(x, y, z) {
      var pl = inside.plan, d = pl.dims, vx = pl.voxel;
      var i = Math.round((x - pl.origin[0]) / vx), j = Math.round((y - pl.origin[1]) / vx), k = Math.round((z - pl.origin[2]) / vx);
      if (i < 0 || j < 0 || k < 0 || i >= d[0] || j >= d[1] || k >= d[2]) return false;
      return inside.field[i + j * d[0] + k * d[0] * d[1]] < vx * 0.35;
    }
    function visible(p, n, q) {
      if (!inside) return true;
      var vx = inside.plan.voxel;
      var sx = p[0] - n[0] * vx * 1.5, sy = p[1] - n[1] * vx * 1.5, sz = p[2] - n[2] * vx * 1.5;
      var dx = q[0] - sx, dy = q[1] - sy, dz = q[2] - sz, L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      var steps = Math.max(1, Math.ceil(L / (vx * 0.7)));
      for (var s = 1; s <= steps; s++) {
        var f = s / steps;
        if (!isInside(sx + dx * f, sy + dy * f, sz + dz * f)) return false;
      }
      return true;
    }

    var dense = new Float32Array(nv * nb);
    var p = [0, 0, 0], n = [0, 0, 0], cp = [0, 0, 0, 0];
    var dist = new Float64Array(nb), order = new Int32Array(nb);
    var summary = { bones: nb, pieces: comps.sizes.length, rigid: [] };

    // 1. separate pieces follow one bone each
    var pieceBone = new Int32Array(comps.sizes.length).fill(-1);
    if (opts.loosePartsRigid !== false) {
      var minD = [], sumD = [];
      for (c = 0; c < comps.sizes.length; c++) { minD.push(new Float64Array(nb).fill(Infinity)); sumD.push(new Float64Array(nb)); }
      for (v = 0; v < nv; v++) {
        if (vdead[v]) continue;
        var lab = comps.label[v];
        if (lab === main) continue;
        p[0] = W[v * 3]; p[1] = W[v * 3 + 1]; p[2] = W[v * 3 + 2];
        for (var bb = 0; bb < nb; bb++) {
          var dd = segDist(p, heads[bb], tails[bb]);
          if (dd < minD[lab][bb]) minD[lab][bb] = dd;
          sumD[lab][bb] += dd;
        }
      }
      /*
       * A piece with joints inside it is a body part modelled separately —
       * an arm, a leg — and bends with them. A prop holds at most one (the
       * grip of a rifle sits round the wrist), and stays rigid.
       */
      var jointsInside = countJointsInside(mesh, W, comps, heads);
      for (c = 0; c < comps.sizes.length; c++) {
        if (c === main) continue;
        if (jointsInside[c] >= 2) { summary.skinnedPieces = (summary.skinnedPieces || 0) + 1; continue; }
        var best = 0, bestScore = Infinity;
        for (bb = 0; bb < nb; bb++) {
          // touching counts most; how close the piece is overall breaks ties (head vs neck)
          var score = minD[c][bb] + 0.1 * sumD[c][bb] / comps.sizes[c];
          if (score < bestScore) { bestScore = score; best = bb; }
        }
        pieceBone[c] = best;
        summary.rigid.push({ piece: c, verts: comps.sizes[c], bone: sk.bones[best].name });
      }
    }

    /*
     * How thick each limb is: the mean distance to its bone of the vertices
     * that face squarely away from it. A pouch strapped beside an arm faces
     * away from the arm too, but sits much further out than the sleeve does,
     * so a bone is not offered anything well beyond its own radius.
     */
    var rSum = new Float64Array(nb), rCnt = new Float64Array(nb);
    for (v = 0; v < nv; v += 3) {
      if (vdead[v] || pieceBone[comps.label[v]] >= 0) continue;
      p[0] = W[v * 3]; p[1] = W[v * 3 + 1]; p[2] = W[v * 3 + 2];
      var bestB = -1, bestD = Infinity;
      for (var b0 = 0; b0 < nb; b0++) { var d0 = segDist(p, heads[b0], tails[b0]); if (d0 < bestD) { bestD = d0; bestB = b0; } }
      segDist(p, heads[bestB], tails[bestB], cp);
      var fx = p[0] - cp[0], fy = p[1] - cp[1], fz = p[2] - cp[2], fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
      if ((fx * WN[v * 3] + fy * WN[v * 3 + 1] + fz * WN[v * 3 + 2]) / fl > 0.85 && cp[3] > 0.15 && cp[3] < 0.85) { rSum[bestB] += bestD; rCnt[bestB]++; }
    }
    var reachOf = new Float64Array(nb);
    for (b0 = 0; b0 < nb; b0++) reachOf[b0] = rCnt[b0] > 15 ? rSum[b0] / rCnt[b0] * 1.3 + 0.006 * (sk.height || 1) : Infinity;

    // 2. the body: each vertex's owner is the nearest visible bone that sits behind its surface
    var owner = new Int16Array(nv).fill(-1);
    for (v = 0; v < nv; v++) {
      if (vdead[v] || pieceBone[comps.label[v]] >= 0) continue;
      p[0] = W[v * 3]; p[1] = W[v * 3 + 1]; p[2] = W[v * 3 + 2];
      n[0] = WN[v * 3]; n[1] = WN[v * 3 + 1]; n[2] = WN[v * 3 + 2];
      for (var bb = 0; bb < nb; bb++) { dist[bb] = segDist(p, heads[bb], tails[bb]); order[bb] = bb; }
      Array.prototype.sort.call(order, function (i, j) { return dist[i] - dist[j]; });
      /*
       * Facing matters where a sculpt has fused parts together: an arm
       * hanging against the vest shares its surface, so the vest's outer face
       * is both near the arm bone and "inside" with it — but it faces away
       * from the chest, not away from the arm.
       */
      var chosen = -1, bestFace = -2, bestFaceBone = -1;
      for (var k = 0; k < Math.min(nb, 8); k++) {
        var cand = order[k];
        if (dist[cand] > dist[order[0]] * 4 + 0.03 * (sk.height || 1)) break;
        if (dist[cand] > reachOf[cand] && Rig.side(sk.bones[cand].name) !== 0) continue;
        segDist(p, heads[cand], tails[cand], cp);
        if (!visible(p, n, cp)) continue;
        var ox = p[0] - cp[0], oy = p[1] - cp[1], oz = p[2] - cp[2], ol = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
        var face = (ox * n[0] + oy * n[1] + oz * n[2]) / ol;
        if (face > 0.35) { chosen = cand; break; }
        if (face > bestFace) { bestFace = face; bestFaceBone = cand; }
      }
      owner[v] = chosen >= 0 ? chosen : (bestFaceBone >= 0 ? bestFaceBone : order[0]);
    }
    // a vertex that disagrees with most of its neighbours is a stray: it goes with them
    var nbh = neighbours(mesh);
    var votes = new Int32Array(nb);
    for (var pass = 0; pass < 3; pass++) {
      var next0 = owner.slice();
      for (v = 0; v < nv; v++) {
        if (owner[v] < 0) continue;
        var s0 = nbh.start[v], s1 = nbh.start[v + 1];
        if (s1 === s0) continue;
        votes.fill(0);
        for (var e = s0; e < s1; e++) { var ow = owner[nbh.list[e]]; if (ow >= 0) votes[ow]++; }
        var top1 = owner[v];
        for (bb = 0; bb < nb; bb++) if (votes[bb] > votes[top1]) top1 = bb;
        if (top1 !== owner[v] && votes[top1] * 10 > (s1 - s0) * 6) next0[v] = top1;
      }
      owner = next0;
    }

    // 3. shared with the neighbouring bone near each joint
    var blend = opts.blend === undefined ? 0.28 : opts.blend;
    for (v = 0; v < nv; v++) {
      if (vdead[v]) continue;
      var row = v * nb;
      var lab2 = comps.label[v];
      if (pieceBone[lab2] >= 0) { dense[row + pieceBone[lab2]] = 1; continue; }
      p[0] = W[v * 3]; p[1] = W[v * 3 + 1]; p[2] = W[v * 3 + 2];
      chosen = owner[v];
      segDist(p, heads[chosen], tails[chosen], cp);
      var tt = cp[3], L = lens[chosen];
      var zone = Math.max(Math.min(L * blend, 0.12 * (sk.height || 1)), 1e-6);
      var wSelf = 1, wPar = 0, wKid = 0, kid = -1;
      var par = sk.bones[chosen].parent;
      var fromHead = tt * L, fromTail = (1 - tt) * L;
      if (par >= 0 && fromHead < zone) wPar = 0.5 * smooth01(1 - fromHead / zone);
      if (kids[chosen].length && fromTail < zone) {
        // with several children (chest: neck and both shoulders) share with the nearest
        var bestK = Infinity;
        for (var q = 0; q < kids[chosen].length; q++) {
          var kk = kids[chosen][q], dk = V3.dist(p, heads[kk]);
          if (dk < bestK) { bestK = dk; kid = kk; }
        }
        wKid = 0.5 * smooth01(1 - fromTail / zone);
      }
      wSelf = 1 - wPar - wKid;
      dense[row + chosen] += wSelf;
      if (wPar > 0) dense[row + par] += wPar;
      if (wKid > 0 && kid >= 0) dense[row + kid] += wKid;
    }

    // 4. smooth along the surface, main body only, then keep the top four
    var passes = opts.smooth === undefined ? 4 : opts.smooth;
    if (passes > 0) {
      var tmp = new Float32Array(nb);
      for (var it = 0; it < passes; it++) {
        var next = new Float32Array(dense.length);
        for (v = 0; v < nv; v++) {
          if (vdead[v]) continue;
          var r0 = v * nb;
          if (comps.label[v] !== main) { for (bb = 0; bb < nb; bb++) next[r0 + bb] = dense[r0 + bb]; continue; }
          s0 = nbh.start[v]; s1 = nbh.start[v + 1]; var cnt = s1 - s0;
          for (bb = 0; bb < nb; bb++) tmp[bb] = 0;
          for (e = s0; e < s1; e++) { var u = nbh.list[e] * nb; for (bb = 0; bb < nb; bb++) tmp[bb] += dense[u + bb]; }
          for (bb = 0; bb < nb; bb++) next[r0 + bb] = cnt ? dense[r0 + bb] * 0.5 + 0.5 * tmp[bb] / cnt : dense[r0 + bb];
        }
        dense = next;
      }
    }
    var joints = new Uint16Array(nv * 4), weights = new Float32Array(nv * 4);
    var top = [0, 0, 0, 0], topW = [0, 0, 0, 0];
    for (v = 0; v < nv; v++) {
      if (vdead[v]) continue;
      var r1 = v * nb;
      top[0] = top[1] = top[2] = top[3] = 0; topW[0] = topW[1] = topW[2] = topW[3] = 0;
      for (bb = 0; bb < nb; bb++) {
        var w = dense[r1 + bb];
        if (w <= topW[3]) continue;
        var at = 3;
        while (at > 0 && w > topW[at - 1]) { topW[at] = topW[at - 1]; top[at] = top[at - 1]; at--; }
        topW[at] = w; top[at] = bb;
      }
      var sum = topW[0] + topW[1] + topW[2] + topW[3];
      if (sum <= 0) { topW[0] = 1; sum = 1; }
      for (k = 0; k < 4; k++) {
        joints[v * 4 + k] = topW[k] > 0 ? top[k] : 0;
        weights[v * 4 + k] = topW[k] / sum;
      }
    }
    summary.mainVerts = comps.sizes[main];
    return { joints: joints, weights: weights, key: Rig.meshKey(mesh), summary: summary };
  };

  /** How many joints lie inside each piece (crossing parity along +X, voted over three rays). */
  function countJointsInside(mesh, W, comps, heads) {
    var out = new Int32Array(comps.sizes.length);
    var T = mesh.tris.array, tdead = mesh.triDead.array, nt = mesh.triCount();
    var dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (var j = 0; j < heads.length; j++) {
      var h = heads[j];
      var votes = new Int32Array(comps.sizes.length);
      for (var di = 0; di < 3; di++) {
        var d = dirs[di], hits = new Int32Array(comps.sizes.length);
        for (var t = 0; t < nt; t++) {
          if (tdead[t]) continue;
          var a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
          var lab = comps.label[a];
          var hit = S.rayTriangle(h[0], h[1], h[2], d[0], d[1], d[2],
            W[a * 3], W[a * 3 + 1], W[a * 3 + 2], W[b * 3], W[b * 3 + 1], W[b * 3 + 2], W[c * 3], W[c * 3 + 1], W[c * 3 + 2], false);
          if (hit > 0) hits[lab]++;
        }
        for (var k = 0; k < hits.length; k++) if (hits[k] & 1) votes[k]++;
      }
      for (k = 0; k < votes.length; k++) if (votes[k] >= 2) out[k]++;
    }
    return out;
  }

  function smooth01(x) { x = x < 0 ? 0 : (x > 1 ? 1 : x); return x * x * (3 - 2 * x); }

  /** A cheap fingerprint of a mesh's topology, to tell when weights are stale. */
  Rig.meshKey = function (mesh) {
    return mesh.liveVerts + ':' + mesh.liveTris + ':' + mesh.vertCount();
  };

  /* ================================================================ *
   * posing
   * ================================================================ */

  function quatFromEuler(deg) {
    var q = [0, 0, 0, 1];
    S.Q4.fromEuler(q, (deg[0] || 0) * Math.PI / 180, (deg[1] || 0) * Math.PI / 180, (deg[2] || 0) * Math.PI / 180);
    return q;
  }
  Rig.quatFromEuler = quatFromEuler;

  function mat4FromQuatT(q, t) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var x2 = x + x, y2 = y + y, z2 = z + z;
    var xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return [1 - (yy + zz), xy + wz, xz - wy, 0,
            xy - wz, 1 - (xx + zz), yz + wx, 0,
            xz + wy, yz - wx, 1 - (xx + yy), 0,
            t[0], t[1], t[2], 1];
  }
  function mul4(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }

  /**
   * Skinning matrices for a pose. `pose` maps bone names to either a
   * quaternion [x,y,z,w] or Euler degrees {x,y,z}; `pose.$offset` moves the
   * root. Returns one column-major 4x4 per bone, taking a rest-pose world
   * point to its posed world position.
   */
  Rig.poseMatrices = function (sk, pose) {
    pose = pose || {};
    var nb = sk.bones.length, world = new Array(nb), out = new Float32Array(nb * 16);
    var done = new Uint8Array(nb);
    function solve(i) {
      if (done[i]) return world[i];
      var b = sk.bones[i], r = pose[b.name];
      var q = !r ? [0, 0, 0, 1] : (Array.isArray(r) ? r : quatFromEuler([r.x || 0, r.y || 0, r.z || 0]));
      var local;
      if (b.parent < 0) {
        var off = pose.$offset || [0, 0, 0];
        local = mat4FromQuatT(q, [b.head[0] + off[0], b.head[1] + off[1], b.head[2] + off[2]]);
        world[i] = local;
      } else {
        var ph = sk.bones[b.parent].head;
        local = mat4FromQuatT(q, [b.head[0] - ph[0], b.head[1] - ph[1], b.head[2] - ph[2]]);
        world[i] = mul4(solve(b.parent), local);
      }
      done[i] = 1;
      return world[i];
    }
    for (var i = 0; i < nb; i++) {
      var wm = solve(i), h = sk.bones[i].head;
      var skin = mul4(wm, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -h[0], -h[1], -h[2], 1]);
      for (var k = 0; k < 16; k++) out[i * 16 + k] = skin[k];
    }
    return out;
  };

  /**
   * Deform `restPos`/`restNor` (world space, per mesh slot) into `outPos`/
   * `outNor` with linear blend skinning.
   */
  Rig.skin = function (binding, mats, restPos, restNor, outPos, outNor, count) {
    var J = binding.joints, Wt = binding.weights;
    for (var v = 0; v < count; v++) {
      var o = v * 3, x = restPos[o], y = restPos[o + 1], z = restPos[o + 2];
      var nx = restNor[o], ny = restNor[o + 1], nz = restNor[o + 2];
      var px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
      for (var k = 0; k < 4; k++) {
        var w = Wt[v * 4 + k];
        if (!w) continue;
        var m = J[v * 4 + k] * 16;
        px += w * (mats[m] * x + mats[m + 4] * y + mats[m + 8] * z + mats[m + 12]);
        py += w * (mats[m + 1] * x + mats[m + 5] * y + mats[m + 9] * z + mats[m + 13]);
        pz += w * (mats[m + 2] * x + mats[m + 6] * y + mats[m + 10] * z + mats[m + 14]);
        qx += w * (mats[m] * nx + mats[m + 4] * ny + mats[m + 8] * nz);
        qy += w * (mats[m + 1] * nx + mats[m + 5] * ny + mats[m + 9] * nz);
        qz += w * (mats[m + 2] * nx + mats[m + 6] * ny + mats[m + 10] * nz);
      }
      outPos[o] = px; outPos[o + 1] = py; outPos[o + 2] = pz;
      var l = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1;
      outNor[o] = qx / l; outNor[o + 1] = qy / l; outNor[o + 2] = qz / l;
    }
  };

  /*
   * Test poses: enough to show a bad weight straight away — a bent knee, a
   * raised arm, a twisted spine. Rotations are Euler degrees in the parent's
   * frame (X pitches forward/back, Z swings out to the side).
   */
  Rig.POSES = {
    rest: { label: 'Rest', pose: {} },
    step: { label: 'Step', pose: {
      'UpperLeg.L': { x: -35 }, 'LowerLeg.L': { x: 45 }, 'Foot.L': { x: -10 },
      'UpperLeg.R': { x: 20 }, 'LowerLeg.R': { x: 10 },
      'UpperArm.L': { x: 25 }, 'UpperArm.R': { x: -20 }, 'LowerArm.L': { x: -20 }, 'LowerArm.R': { x: -15 },
      'Spine': { y: 6 }, 'Chest': { y: 6 } } },
    reach: { label: 'Arms up', pose: {
      'UpperArm.L': { z: 75 }, 'UpperArm.R': { z: -75 }, 'LowerArm.L': { z: 20 }, 'LowerArm.R': { z: -20 },
      'Chest': { x: -6 }, 'Head': { x: -12 } } },
    crouch: { label: 'Crouch', pose: {
      $offset: [0, -0.2, 0],
      'UpperLeg.L': { x: -70 }, 'UpperLeg.R': { x: -70 }, 'LowerLeg.L': { x: 100 }, 'LowerLeg.R': { x: 100 },
      'Foot.L': { x: -30 }, 'Foot.R': { x: -30 }, 'Spine': { x: 20 }, 'Chest': { x: 10 }, 'Head': { x: -20 },
      'UpperArm.L': { x: -30 }, 'UpperArm.R': { x: -30 }, 'LowerArm.L': { x: -40 }, 'LowerArm.R': { x: -40 } } }
  };
  /*
   * The crouch offset is a fraction of a 1.8 m figure; scale it to the model
   * when posing so a small model does not drop through the floor.
   */
  Rig.resolvePose = function (sk, pose) {
    var out = {};
    for (var k in pose) out[k] = pose[k];
    if (pose.$offset) { var s = (sk.height || 1.8) / 1.8; out.$offset = pose.$offset.map(function (v) { return v * s; }); }
    return out;
  };

  /* ================================================================ *
   * export
   * ================================================================ */

  /**
   * A skinned glTF of one object. Positions go out in the same space as a
   * normal export (transform applied, export axis and scale), and the joints
   * go out in that same space, so the file loads in its rest pose looking
   * exactly like the sculpt.
   */
  Rig.exportGLB = function (obj, sk, binding, opts) {
    opts = opts || {};
    var geoms = S.IO.prepare([obj], opts);
    if (!geoms.length) throw new Error('That object has no geometry.');
    var g = geoms[0];
    // compact the per-slot weights into export order (live slots, in order)
    var mesh = obj.mesh, nv = mesh.vertCount(), dead = mesh.vertDead.array;
    var joints = new Uint16Array(g.vertCount * 4), weights = new Float32Array(g.vertCount * 4), w = 0;
    for (var v = 0; v < nv; v++) {
      if (dead[v]) continue;
      for (var k = 0; k < 4; k++) { joints[w * 4 + k] = binding.joints[v * 4 + k]; weights[w * 4 + k] = binding.weights[v * 4 + k]; }
      w++;
    }
    var scale = opts.scale === undefined ? 1 : opts.scale, axis = opts.axis || 'y', tmp = [0, 0, 0];
    var bones = sk.bones.map(function (b) {
      S.IO.axisOut(axis, b.head[0] * scale, b.head[1] * scale, b.head[2] * scale, tmp);
      return { name: b.name, parent: b.parent, head: tmp.slice() };
    });
    var o2 = {};
    for (var key in opts) o2[key] = opts[key];
    o2.skin = { geom: 0, bones: bones, joints: joints, weights: weights };
    return S.IO.exportGLB(geoms, o2);
  };

  /* ================================================================ *
   * the app: a Rig sheet, a joint editor and a live pose preview
   * ================================================================ */

  if (!S.App || typeof document === 'undefined') return;
  var UI = S.UI, el = UI.el, A = S.App.prototype;

  UI.ICONS.bone = 'M7 4.5a2 2 0 1 0-2.6 2.6 2 2 0 1 0 2.6 2.6L14.3 17a2 2 0 1 0 2.6 2.6 2 2 0 1 0 2.6-2.6 2 2 0 1 0-2.6-2.6L9.6 7.1A2 2 0 1 0 7 4.5Z';

  var BONE_COLOURS = [
    [0.95, 0.35, 0.3], [0.3, 0.7, 0.95], [0.95, 0.8, 0.25], [0.45, 0.85, 0.4], [0.8, 0.45, 0.9],
    [0.95, 0.6, 0.25], [0.3, 0.9, 0.8], [0.9, 0.4, 0.65], [0.6, 0.6, 0.95], [0.75, 0.9, 0.3], [0.95, 0.95, 0.95]
  ];

  A.rigState = function () {
    if (!this.rig) this.rig = { skeleton: null, binding: null, obj: null, editing: false, sel: -1, drag: null,
                                mirror: true, posed: null, showWeights: false, rest: null };
    return this.rig;
  };

  /** Fit a fresh humanoid skeleton to the selected object. */
  A.rigAddHumanoid = function () {
    var obj = this.scene.current();
    if (!obj) { UI.toast('Nothing to rig', 'bad'); return; }
    var mn = V3.create(0, 0, 0), mx = V3.create(0, 0, 0);
    obj.worldBounds(mn, mx);
    var r = this.rigState();
    this.rigRest();
    r.skeleton = Rig.humanoid(mn, mx);
    r.obj = obj;
    r.binding = null;
    this.rigCentreJoints(true);
    this.needsRender = true;
    UI.toast('Skeleton added: ' + r.skeleton.bones.length + ' bones. Check the joints, then bind.', 'ok', 4200);
  };

  A.rigCentreJoints = function (quiet) {
    var r = this.rigState(), obj = r.obj || this.scene.current();
    if (!r.skeleton || !obj) return;
    var self = this, hit = { t: 0 }, lo = V3.create(0, 0, 0), ld = V3.create(0, 0, 0), wo = V3.create(0, 0, 0), wd = V3.create(0, 0, 0);
    var moved = Rig.centreJoints(r.skeleton, function (p, d) {
      V3.set(wo, p[0], p[1], p[2]); V3.set(wd, d[0], d[1], d[2]);
      obj.worldToLocalPoint(lo, wo); obj.worldToLocalDir(ld, wd);
      if (!obj.mesh.raycast(lo[0], lo[1], lo[2], ld[0], ld[1], ld[2], hit, false)) return null;
      return hit.t * obj.uniformScale();
    }, { symmetric: r.mirror, cx: (function () { var a = V3.create(0, 0, 0), b = V3.create(0, 0, 0); obj.worldBounds(a, b); return (a[0] + b[0]) / 2; })() });
    r.binding = null;
    this.needsRender = true;
    if (!quiet) UI.toast(moved ? 'Joints pulled into the middle of the body' : 'The joints were already inside', 'ok');
    return moved;
  };

  /** Work out the skin weights (the slow part, behind the busy overlay). */
  A.rigBind = function (then) {
    var r = this.rigState(), self = this;
    if (!r.skeleton) { UI.toast('Add a skeleton first', 'bad'); return; }
    var obj = r.obj || this.scene.current();
    r.obj = obj;
    this.rigRest();
    UI.busy('Binding', 'working out skin weights', function () {
      r.binding = Rig.computeWeights(obj.mesh, obj.matrix(), r.skeleton, {});
      return r.binding.summary;
    }, function (summary) {
      if (!summary) return;
      var rigid = summary.rigid.length ? ' · ' + summary.rigid.length + ' loose part' + (summary.rigid.length > 1 ? 's' : '') + ' fixed to a bone' : '';
      UI.toast('Bound ' + S.formatCount(summary.mainVerts) + ' vertices to ' + summary.bones + ' bones' + rigid, 'ok', 4200);
      self.needsRender = true;
      if (then) then();
    });
  };

  A.rigEnsureBound = function (then) {
    var r = this.rigState();
    if (r.binding && r.obj && r.binding.key === Rig.meshKey(r.obj.mesh)) { then(); return; }
    this.rigBind(then);
  };

  /* ---- pose preview: the mesh itself is moved, and put back exactly ---- */

  A.rigSnapshotRest = function () {
    var r = this.rigState(), mesh = r.obj.mesh, n = mesh.vertCount() * 3;
    if (r.rest) return r.rest;
    // rest positions in world space, so skinning (world) can be undone into local
    var m = r.obj.matrix(), inv = r.obj.inverseMatrix();
    var P = mesh.positions.array, N = mesh.normals.array;
    var wp = new Float32Array(n), wn = new Float32Array(n);
    for (var i = 0; i < n; i += 3) {
      var x = P[i], y = P[i + 1], z = P[i + 2];
      wp[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      wp[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      wp[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      var nx = N[i], ny = N[i + 1], nz = N[i + 2];
      wn[i] = m[0] * nx + m[4] * ny + m[8] * nz; wn[i + 1] = m[1] * nx + m[5] * ny + m[9] * nz; wn[i + 2] = m[2] * nx + m[6] * ny + m[10] * nz;
    }
    r.rest = { positions: P.slice(0, n), normals: N.slice(0, n), colors: mesh.colors.array.slice(0, n), world: wp, worldN: wn, inv: inv };
    return r.rest;
  };

  A.rigPose = function (id) {
    var r = this.rigState(), self = this;
    if (!r.skeleton) { UI.toast('Add a skeleton first', 'bad'); return; }
    if (id === 'rest') { this.rigRest(); return; }
    this.rigEnsureBound(function () {
      var rest = self.rigSnapshotRest(), mesh = r.obj.mesh, n = mesh.vertCount();
      var mats = Rig.poseMatrices(r.skeleton, Rig.resolvePose(r.skeleton, Rig.POSES[id].pose));
      var wp = new Float32Array(n * 3), wn = new Float32Array(n * 3);
      Rig.skin(r.binding, mats, rest.world, rest.worldN, wp, wn, n);
      var inv = rest.inv, P = mesh.positions.array, N = mesh.normals.array;
      for (var i = 0; i < n * 3; i += 3) {
        var x = wp[i], y = wp[i + 1], z = wp[i + 2];
        P[i] = inv[0] * x + inv[4] * y + inv[8] * z + inv[12];
        P[i + 1] = inv[1] * x + inv[5] * y + inv[9] * z + inv[13];
        P[i + 2] = inv[2] * x + inv[6] * y + inv[10] * z + inv[14];
        var nx = wn[i], ny = wn[i + 1], nz = wn[i + 2];
        var ax = inv[0] * nx + inv[4] * ny + inv[8] * nz, ay = inv[1] * nx + inv[5] * ny + inv[9] * nz, az = inv[2] * nx + inv[6] * ny + inv[10] * nz;
        var l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
        N[i] = ax / l; N[i + 1] = ay / l; N[i + 2] = az / l;
      }
      r.posed = id;
      r.poseMats = mats;
      self.rigMeshChanged();
    });
  };

  /** Back to the rest pose and the real colours. Safe to call any time. */
  A.rigRest = function () {
    var r = this.rig;
    if (!r || !r.rest || !r.obj) { if (r) { r.posed = null; r.showWeights = false; } return; }
    var mesh = r.obj.mesh, n = r.rest.positions.length;
    if (mesh.vertCount() * 3 === n) {
      mesh.positions.array.set(r.rest.positions, 0);
      mesh.normals.array.set(r.rest.normals, 0);
      mesh.colors.array.set(r.rest.colors, 0);
    }
    r.rest = null; r.posed = null; r.poseMats = null; r.showWeights = false;
    this.rigMeshChanged();
  };

  A.rigMeshChanged = function () {
    var mesh = this.rig.obj.mesh;
    mesh.dirtyMinVert = 0; mesh.dirtyMaxVert = mesh.vertCount() - 1;
    mesh._boundsDirty = true;
    this.needsRender = true;
  };

  /** Colour each vertex by its bones, to see the weights at a glance. */
  A.rigShowWeights = function (on) {
    var r = this.rigState(), self = this;
    if (!on) {
      if (r.rest) {
        r.obj.mesh.colors.array.set(r.rest.colors, 0);
        r.showWeights = false;
        if (!r.posed) this.rigRest(); else this.rigMeshChanged();
      }
      return;
    }
    this.rigEnsureBound(function () {
      self.rigSnapshotRest();
      var mesh = r.obj.mesh, n = mesh.vertCount(), C = mesh.colors.array, J = r.binding.joints, W = r.binding.weights;
      for (var v = 0; v < n; v++) {
        var cr = 0, cg = 0, cb = 0;
        for (var k = 0; k < 4; k++) {
          var w = W[v * 4 + k]; if (!w) continue;
          var col = BONE_COLOURS[J[v * 4 + k] % BONE_COLOURS.length];
          cr += col[0] * w; cg += col[1] * w; cb += col[2] * w;
        }
        C[v * 3] = cr; C[v * 3 + 1] = cg; C[v * 3 + 2] = cb;
      }
      r.showWeights = true;
      self.set('vertexColors', true);
      self.rigMeshChanged();
    });
  };

  A.rigExport = function () {
    var r = this.rigState(), self = this;
    if (!r.skeleton) { UI.toast('Add a skeleton first', 'bad'); return; }
    this.rigRest();
    this.rigEnsureBound(function () {
      UI.busy('Exporting rigged GLB', '', function () {
        var opts = self.exportOptions();
        opts.includeColors = true;
        var data = Rig.exportGLB(r.obj, r.skeleton, r.binding, opts);
        var name = self.exportFilename('glb').replace(/\.glb$/, '_rigged.glb');
        var size = UI.download(data, name, 'model/gltf-binary');
        return { name: name, size: size };
      }, function (res) {
        if (res) UI.toast('Saved ' + res.name + ' (' + S.formatBytes(res.size) + ') with ' + r.skeleton.bones.length + ' bones', 'ok', 4200);
      });
    });
  };

  A.rigRemove = function () {
    this.rigRest();
    this.rigSetEditing(false);
    this.rig = null;
    this.needsRender = true;
    UI.toast('Skeleton removed');
  };

  /* ---- projects keep the skeleton (weights are quick to work out again) ---- */

  A.rigForProject = function () {
    var r = this.rig;
    if (!r || !r.skeleton) return null;
    return { skeleton: Rig.clone(r.skeleton), object: Math.max(0, this.scene.objects.indexOf(r.obj)), mirror: r.mirror };
  };

  A.rigFromProject = function (data) {
    if (!data || !data.skeleton || !data.skeleton.bones) return;
    var r = this.rigState();
    r.skeleton = Rig.clone(data.skeleton);
    r.obj = this.scene.objects[data.object || 0] || this.scene.current();
    r.mirror = data.mirror !== false;
    r.binding = null;
  };

  /* ---- the Rig sheet ---- */

  A.openRigSheet = function () {
    var self = this, r = this.rigState();
    var sk = r.skeleton;
    var status = !sk ? 'No skeleton yet. Add one, check the joints sit in the middle of each limb, then bind.'
      : sk.bones.length + ' bones on ' + (r.obj ? r.obj.name : 'the model') + ' · ' +
        (r.binding && r.obj && r.binding.key === Rig.meshKey(r.obj.mesh) ? 'bound, weights ready' : 'not bound yet');
    var poses = el('div.rig-poses', null, Object.keys(Rig.POSES).map(function (id) {
      var b = UI.button(Rig.POSES[id].label, { class: r.posed === id || (!r.posed && id === 'rest') ? 'accent' : '',
        onclick: function () {
          self.rigPose(id);
          var all = b.parentNode ? b.parentNode.children : [];
          for (var i = 0; i < all.length; i++) all[i].classList.toggle('accent', all[i] === b);
        } });
      return b;
    }));
    this.openSheet({
      title: 'Rig',
      content: [el('p.sheet-note', { text: status }), sk ? el('div.sheet-group', { text: 'Test poses' }) : null, sk ? poses : null],
      rows: [
        { group: 'Skeleton' },
        { icon: 'bone', label: sk ? 'Fit a new humanoid skeleton' : 'Add a humanoid skeleton',
          hint: 'Hips, spine, chest, neck, head, arms, legs and feet — fitted to the selected object',
          onclick: function () { self.rigAddHumanoid(); } },
        sk ? { icon: 'gizmo', label: 'Edit joints', hint: 'Drag a joint to move it. Left and right move together while mirroring is on',
          onclick: function () { self.rigSetEditing(true); } } : null,
        sk ? { icon: 'frame', label: 'Centre joints in the body', hint: 'Look both ways from each joint and move it to the middle of the limb',
          onclick: function () { self.rigCentreJoints(); } } : null,
        sk ? { icon: 'symmetry', label: 'Mirror left and right', toggle: true, value: function () { return r.mirror; },
          onclick: function () { r.mirror = !r.mirror; } } : null,
        sk ? { group: 'Skin' } : null,
        sk ? { icon: 'check', label: 'Bind', hint: 'Work out the skin weights from the shape. Separate parts ride on one bone',
          onclick: function () { self.rigBind(); } } : null,
        sk ? { icon: 'palette', label: 'Show weights', hint: 'Colour the model by bone', toggle: true,
          value: function () { return r.showWeights; },
          onclick: function () { self.rigShowWeights(!r.showWeights); } } : null,
        sk ? { group: 'Export' } : null,
        sk ? { icon: 'download', label: 'Rigged GLB', hint: 'Mesh, colours, skeleton and weights — ready for an animation tool or engine',
          onclick: function () { self.rigExport(); } } : null,
        sk ? { icon: 'trash', label: 'Remove the skeleton', danger: true, onclick: function () { self.rigRemove(); } } : null
      ]
    });
    this._sheetIsRig = true;
    if (this._sheet) this._sheet.classList.add('side');
    this.needsRender = true;
  };

  /* ---- editing joints in the viewport ---- */

  A.rigSetEditing = function (on) {
    var r = this.rigState();
    if (on && !r.skeleton) return;
    if (on) { this.rigRest(); if (this.transform.active) this.setTransformMode(false); }
    r.editing = !!on;
    r.drag = null;
    if (!this.rigBar) {
      var self = this;
      this.rigLabel = el('span.rig-label');
      this.rigBar = el('div#bar-rig', { hidden: true }, [
        this.rigLabel,
        UI.button('Centre', { title: 'Move every joint to the middle of its limb', onclick: function () { self.rigCentreJoints(); } }),
        UI.button('Done', { class: 'accent', onclick: function () { self.rigSetEditing(false); } })
      ]);
      var ui = this.mount.querySelector('#ui');
      (ui || this.mount).appendChild(this.rigBar);
    }
    this.rigBar.hidden = !r.editing;
    if (this.bottomBar) this.bottomBar.hidden = r.editing;
    if (this.toolsEl) this.toolsEl.hidden = r.editing;
    this.rigUpdateLabel();
    this.cursor.valid = false;
    this.needsRender = true;
  };

  A.rigUpdateLabel = function () {
    var r = this.rig;
    if (!this.rigLabel || !r) return;
    this.rigLabel.textContent = r.sel >= 0 && r.skeleton ? r.skeleton.bones[r.sel].name : 'Drag a joint';
  };

  A.rigOverlay = function () {
    if (!this.rigSvg) {
      this.rigSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.rigSvg.setAttribute('id', 'rig-overlay');
      this.canvas.parentNode.insertBefore(this.rigSvg, this.canvas.nextSibling);
    }
    return this.rigSvg;
  };

  /** Draw the skeleton over the model: bones as wedges, joints as dots. */
  A.drawRig = function () {
    var r = this.rig;
    var show = r && r.skeleton && (r.editing || this._sheetIsRig);
    var svg = this.rigSvg;
    if (!show) { if (svg) svg.setAttribute('hidden', 'hidden'); return; }
    svg = this.rigOverlay();
    svg.removeAttribute('hidden');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var cam = this.camera, sk = r.skeleton, tails = Rig.tails(sk), p = [0, 0, 0], q = [0, 0, 0];
    var mats = r.posed ? r.poseMats : null;
    function place(pt, bi, out) {
      if (!mats) { cam.project(pt, out); return out; }
      var m = bi * 16, x = pt[0], y = pt[1], z = pt[2];
      var w = [mats[m] * x + mats[m + 4] * y + mats[m + 8] * z + mats[m + 12],
               mats[m + 1] * x + mats[m + 5] * y + mats[m + 9] * z + mats[m + 13],
               mats[m + 2] * x + mats[m + 6] * y + mats[m + 10] * z + mats[m + 14]];
      cam.project(w, out); return out;
    }
    var NS = 'http://www.w3.org/2000/svg';
    r.screen = [];
    sk.bones.forEach(function (b, i) {
      place(b.head, i, p); place(tails[i], i, q);
      r.screen[i] = [p[0], p[1]];
      var dx = q[0] - p[0], dy = q[1] - p[1], L = Math.sqrt(dx * dx + dy * dy) || 1, wdt = Math.min(7, L * 0.12);
      var nx = -dy / L * wdt, ny = dx / L * wdt, mx = p[0] + dx * 0.18, my = p[1] + dy * 0.18;
      var poly = document.createElementNS(NS, 'polygon');
      poly.setAttribute('points', [p[0], p[1], mx + nx, my + ny, q[0], q[1], mx - nx, my - ny].join(','));
      poly.setAttribute('class', 'rig-bone' + (i === r.sel ? ' sel' : '') + (Rig.side(b.name) > 0 ? ' left' : (Rig.side(b.name) < 0 ? ' right' : '')));
      svg.appendChild(poly);
    });
    sk.bones.forEach(function (b, i) {
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', r.screen[i][0]); c.setAttribute('cy', r.screen[i][1]);
      c.setAttribute('r', i === r.sel ? 6.5 : 4.5);
      c.setAttribute('class', 'rig-joint' + (i === r.sel ? ' sel' : ''));
      svg.appendChild(c);
    });
  };

  A.rigPointerDown = function (p) {
    var r = this.rig;
    if (!r || !r.editing || !r.screen) return false;
    var best = -1, bd = 18 * 18;
    for (var i = 0; i < r.screen.length; i++) {
      var dx = r.screen[i][0] - p.x, dy = r.screen[i][1] - p.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return false;
    r.sel = best;
    var head = r.skeleton.bones[best].head;
    r.drag = { bone: best, start: head.slice(), x: p.x, y: p.y, perPixel: this.camera.worldPerPixel(head) };
    this.rigUpdateLabel();
    this.needsRender = true;
    return true;
  };

  A.rigPointerMove = function (p) {
    var r = this.rig, d = r && r.drag;
    if (!d) return false;
    var cam = this.camera, right = cam.right(), up = cam.up();
    var dx = (p.x - d.x) * d.perPixel, dy = -(p.y - d.y) * d.perPixel;
    var b = r.skeleton.bones[d.bone];
    b.head = [d.start[0] + right[0] * dx + up[0] * dy, d.start[1] + right[1] * dx + up[1] * dy, d.start[2] + right[2] * dx + up[2] * dy];
    if (r.mirror) {
      var j = Rig.indexOf(r.skeleton, Rig.mirrorName(b.name));
      var mn = V3.create(0, 0, 0), mx = V3.create(0, 0, 0), cx = 0;
      if (r.obj) { r.obj.worldBounds(mn, mx); cx = (mn[0] + mx[0]) / 2; }
      if (j >= 0 && j !== d.bone) r.skeleton.bones[j].head = [2 * cx - b.head[0], b.head[1], b.head[2]];
      else if (j === d.bone) b.head[0] = cx;               // a centre-line joint stays on the centre line
    }
    r.binding = null;
    this.needsRender = true;
    return true;
  };

  A.rigPointerUp = function () {
    var r = this.rig;
    if (r && r.drag) { r.drag = null; this.needsRender = true; return true; }
    return false;
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
