/*
 * rigkit — page-side rigging helpers shared by rig.mjs and ship.mjs.
 * Runs inside SculptFree after sculptkit.js.
 */
(function () {
  const S = window.SCULPT, app = M.app;

  /*
   * Rig the first object: the humanoid skeleton, placed from `joints`
   * (bone -> [x,y,z] or {head, tail}; "$attach" pins pieces to bones),
   * then bound. Returns a summary for the terminal.
   */
  M.rigWith = function (joints) {
    const o = app.scene.objects[0];
    app.scene.selected = 0;
    app.rigAddHumanoid();
    const sk = app.rig.skeleton;
    if (joints) {
      for (const b of sk.bones) {
        const j = joints[b.name];
        if (!j) continue;
        if (Array.isArray(j)) b.head = j.slice(); else { if (j.head) b.head = j.head.slice(); if (j.tail) b.tail = j.tail.slice(); }
      }
    }
    const t0 = performance.now();
    app.rig.binding = S.Rig.computeWeights(o.mesh, o.matrix(), sk, {});
    const ms = performance.now() - t0;
    const attached = [];
    for (const at of (joints && joints.$attach) || []) {
      const bi = sk.bones.findIndex((b) => b.name === at.bone);
      if (bi < 0) { attached.push('unknown bone ' + at.bone); continue; }
      const m = o.mesh, P = m.positions.array, n = m.vertCount(), dead = m.vertDead.array, lab = S.Rig.components(m).label;
      let best = -1, bd = Infinity;
      for (let v = 0; v < n; v++) { if (dead[v]) continue; const d = (P[v*3]-at.at[0])**2 + (P[v*3+1]-at.at[1])**2 + (P[v*3+2]-at.at[2])**2; if (d < bd) { bd = d; best = v; } }
      if (best < 0) continue;
      let count = 0;
      for (let v = 0; v < n; v++) if (!dead[v] && lab[v] === lab[best]) {
        for (let k = 0; k < 4; k++) { app.rig.binding.joints[v * 4 + k] = k ? 0 : bi; app.rig.binding.weights[v * 4 + k] = k ? 0 : 1; }
        count++;
      }
      attached.push(`${count} verts near [${at.at.join(', ')}] -> ${at.bone}` + (Math.sqrt(bd) > 0.05 ? ' (WARNING: nearest vertex is ' + Math.sqrt(bd).toFixed(3) + ' m away)' : ''));
    }
    const m = o.mesh, n = m.vertCount(), dead = m.vertDead.array, J = app.rig.binding.joints, count = {};
    for (let v = 0; v < n; v++) if (!dead[v]) { const bn = sk.bones[J[v * 4]].name; count[bn] = (count[bn] || 0) + 1; }
    const used = {};
    for (const b of sk.bones) used[b.name] = b.tail ? { head: b.head.map((x) => +x.toFixed(4)), tail: b.tail.map((x) => +x.toFixed(4)) } : b.head.map((x) => +x.toFixed(4));
    if (joints && joints.$attach) used.$attach = joints.$attach;
    return { tris: o.mesh.liveTris, ms, summary: app.rig.binding.summary, count, used, attached, tpose: M.armAngle() > 50, armAngle: M.armAngle() };
  };

  /** How far the arms are raised from hanging straight down, in degrees (90 = T-pose). */
  M.armAngle = function () {
    const sk = app.rig && app.rig.skeleton;
    if (!sk) return 0;
    const i = S.Rig.indexOf(sk, 'UpperArm.L'), j = S.Rig.indexOf(sk, 'LowerArm.L');
    if (i < 0 || j < 0) return 0;
    const a = sk.bones[i].head, b = sk.bones[j].head;
    return Math.atan2(Math.hypot(b[0] - a[0], b[2] - a[2]), a[1] - b[1]) * 180 / Math.PI;
  };

  /*
   * Test poses that suit the model's rest pose. From a T-pose the arms have
   * to come down about the Z axis before anything else reads, so every pose
   * starts from arms lowered.
   */
  M.testPoses = function () {
    const ang = M.armAngle();
    const P = S.Rig.POSES;
    if (ang < 50) return ['rest', 'step', 'reach', 'crouch'];
    const down = ang - 8;                                         // leave the arms a little out from the body
    const lower = { 'UpperArm.L': { z: -down }, 'UpperArm.R': { z: down } };
    const merge = (base, extra) => { const o = Object.assign({}, base); for (const k in extra) o[k] = Object.assign({}, base[k] || {}, extra[k]); return o; };
    const legsOnly = (pose) => { const o = {}; for (const k in pose) if (!/Arm|Hand/.test(k)) o[k] = pose[k]; return o; };
    P.tLower = { label: 'Arms lowered', pose: lower };
    P.tStep = { label: 'Step', pose: merge(legsOnly(P.step.pose), { 'UpperArm.L': { z: -down, x: -25 }, 'UpperArm.R': { z: down, x: 20 } }) };
    P.tUp = { label: 'Arms up', pose: { 'UpperArm.L': { z: 80 }, 'UpperArm.R': { z: -80 }, 'Head': { x: -10 } } };
    P.tCrouch = { label: 'Crouch', pose: merge(legsOnly(P.crouch.pose), lower) };
    return ['rest', 'tLower', 'tStep', 'tUp', 'tCrouch'];
  };
})();

(function () {
  const S = window.SCULPT;
  /*
   * A colour sampler that reads the full-detail sculpt: for a point on the
   * reduced mesh, look along its normal both ways for the high-detail
   * surface and take the colour there (barycentric, from the vertex
   * colours). This is a proper "high to low" bake: nothing is projected,
   * so a chin never paints the neck under it and an eye socket keeps its
   * own colour. Pass the clone of the mesh from before the reduction.
   * `reach` is how far off the reduced surface the detailed one may lie.
   */
  /*
   * `low` is the reduced mesh, `high` the clone from before the reduction.
   * Each separate piece of the model (body, head, hair, sword...) samples
   * only its own piece of the full sculpt, so overlapping pieces never
   * bleed into each other: hair never paints the forehead, a collar never
   * shadows the neck. The bake passes the export triangle index, which
   * follows the order of low.toIndexed().
   */
  M.highSampler = function (low, high, reach) {
    const r = reach || 0.03;
    // pieces of the high mesh, each its own raycastable mesh
    const hl = S.Rig.components(high).label, HP = high.positions.array, HC = high.colors.array, HT = high.tris.array;
    let nComp = 0; for (let i = 0; i < hl.length; i++) if (hl[i] + 1 > nComp) nComp = hl[i] + 1;
    const pieces = [];
    for (let c = 0; c < nComp; c++) pieces.push({ map: new Map(), pos: [], col: [], idx: [] });
    for (let t = 0; t < high.triCount(); t++) {
      if (high.triDead.array[t]) continue;
      const pc = pieces[hl[HT[t * 3]]];
      for (let k = 0; k < 3; k++) {
        const v = HT[t * 3 + k];
        let to = pc.map.get(v);
        if (to === undefined) { to = pc.pos.length / 3; pc.map.set(v, to); pc.pos.push(HP[v*3], HP[v*3+1], HP[v*3+2]); pc.col.push(HC[v*3], HC[v*3+1], HC[v*3+2]); }
        pc.idx.push(to);
      }
    }
    const meshes = pieces.map((pc) => {
      if (!pc.idx.length) return null;
      const m = new S.Mesh();
      m.setFromArrays(new Float32Array(pc.pos), new Uint32Array(pc.idx), { colors: new Float32Array(pc.col), weld: false });
      return m;
    });
    // which high piece each export triangle belongs to
    const d = low.toIndexed(), li = d.indices32, nv = d.vertCount;
    const parent = new Int32Array(nv); for (let i = 0; i < nv; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let t = 0; t < li.length; t += 3) { const a = find(li[t]), b = find(li[t + 1]), c = find(li[t + 2]); parent[a] = b; parent[find(c)] = find(b); }
    const lowToHigh = new Map(), triPiece = new Int32Array(li.length / 3);
    for (let t = 0; t < li.length / 3; t++) {
      const root = find(li[t * 3]);
      let hp = lowToHigh.get(root);
      if (hp === undefined) {
        // the high piece nearest this low piece: vote over a few of its vertices
        const votes = new Map();
        for (let k = 0; k < 3; k++) {
          const v = li[t * 3 + k], x = d.positions[v*3], y = d.positions[v*3+1], z = d.positions[v*3+2];
          let best = -1, bd = Infinity;
          for (const hv of high.vertsInSphere(x, y, z, r)) { const dd = (HP[hv*3]-x)**2 + (HP[hv*3+1]-y)**2 + (HP[hv*3+2]-z)**2; if (dd < bd) { bd = dd; best = hv; } }
          if (best >= 0) votes.set(hl[best], (votes.get(hl[best]) || 0) + 1);
        }
        hp = -1; let bv = 0; for (const [c, n] of votes) if (n > bv) { bv = n; hp = c; }
        if (hp >= 0) lowToHigh.set(root, hp);
      }
      triPiece[t] = hp === undefined ? -1 : hp;
    }
    const hit = { t: 0, tri: -1 };
    function colourAt(m, tri, x, y, z, out) {
      const P = m.positions.array, C = m.colors.array, T = m.tris.array;
      const a = T[tri * 3], b = T[tri * 3 + 1], c = T[tri * 3 + 2];
      const ax = P[a*3], ay = P[a*3+1], az = P[a*3+2];
      const v0 = [P[b*3]-ax, P[b*3+1]-ay, P[b*3+2]-az], v1 = [P[c*3]-ax, P[c*3+1]-ay, P[c*3+2]-az], v2 = [x-ax, y-ay, z-az];
      const d00 = v0[0]*v0[0]+v0[1]*v0[1]+v0[2]*v0[2], d01 = v0[0]*v1[0]+v0[1]*v1[1]+v0[2]*v1[2], d11 = v1[0]*v1[0]+v1[1]*v1[1]+v1[2]*v1[2];
      const d20 = v2[0]*v0[0]+v2[1]*v0[1]+v2[2]*v0[2], d21 = v2[0]*v1[0]+v2[1]*v1[1]+v2[2]*v1[2];
      const den = d00 * d11 - d01 * d01 || 1e-12;
      let v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
      v = Math.max(0, Math.min(1, v)); w = Math.max(0, Math.min(1 - v, w)); const u = 1 - v - w;
      for (let k = 0; k < 3; k++) out[k] = C[a*3+k] * u + C[b*3+k] * v + C[c*3+k] * w;
    }
    return {
      misses: 0,
      sample(x, y, z, nx, ny, nz, out, tri) {
        const piece = tri === undefined ? -1 : triPiece[tri];
        const m = piece >= 0 ? meshes[piece] : high;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        // from just outside looking in, and from just inside looking out: keep the hit nearest the reduced surface
        let best = -1, bt = Infinity, bx = 0, by = 0, bz = 0;
        for (const s of [1, -1]) {
          const ox = x + nx * r * s, oy = y + ny * r * s, oz = z + nz * r * s;
          if (m.raycast(ox, oy, oz, -nx * s, -ny * s, -nz * s, hit, false) && hit.t < 2 * r) {
            const dd = Math.abs(hit.t - r);
            if (dd < bt) { bt = dd; best = hit.tri; bx = ox - nx * s * hit.t; by = oy - ny * s * hit.t; bz = oz - nz * s * hit.t; }
          }
        }
        if (best >= 0) { colourAt(m, best, bx, by, bz, out); return out; }
        // nothing along the normal (a thin edge): the nearest vertex of the same piece
        const P = m.positions.array, C = m.colors.array;
        let bd = Infinity, bv = -1;
        for (const v of m.vertsInSphere(x, y, z, r)) { const dd = (P[v*3]-x)**2 + (P[v*3+1]-y)**2 + (P[v*3+2]-z)**2; if (dd < bd) { bd = dd; bv = v; } }
        if (bv < 0) { this.misses++; out[0] = out[1] = out[2] = 0.5; return out; }
        out[0] = C[bv*3]; out[1] = C[bv*3+1]; out[2] = C[bv*3+2];
        return out;
      }
    };
  };
})();

(function () {
  const S = window.SCULPT, app = M.app;
  /*
   * Game-ready geometry for ship.mjs. A sculpt is layers: hair over a
   * scalp, a collar over a neck, a sleeve over an arm, every one a closed
   * piece with more piece inside it. At full detail the inner layers are
   * hidden; reduced to a few thousand triangles, the outer layers pull back
   * and the dark, shaded inner ones show through. And a game model should
   * not spend its budget on surfaces no one sees.
   *
   * So every piece of the character is welded into ONE closed skin (the
   * union of their distance fields, the same maths as the Combine menu).
   * Props stay separate pieces so they stay rigid: any piece containing
   * one of `propPoints` (the "$attach" points of the joints file).
   *
   * Replaces the first object's mesh. Returns the full-detail meshes to
   * bake colour from: `shell` (all the character pieces) and `props`.
   */
  M.shipShell = function (propPoints, voxel) {
    if (app.scene.objects.length > 1) M.joinAll();
    const o = app.scene.objects[0], mesh = o.mesh;
    const lab = S.Rig.components(mesh).label, P = mesh.positions.array, C = mesh.colors.array, T = mesh.tris.array, dead = mesh.vertDead.array;
    let nComp = 0; for (let i = 0; i < lab.length; i++) if (lab[i] + 1 > nComp) nComp = lab[i] + 1;
    const isProp = new Uint8Array(nComp);
    for (const pt of propPoints || []) {
      let best = -1, bd = Infinity;
      for (let v = 0; v < mesh.vertCount(); v++) { if (dead[v]) continue; const d = (P[v*3]-pt[0])**2 + (P[v*3+1]-pt[1])**2 + (P[v*3+2]-pt[2])**2; if (d < bd) { bd = d; best = v; } }
      if (best >= 0) isProp[lab[best]] = 1;
    }
    // one mesh per piece (closed, so each gives a clean distance field)
    const pieces = [];
    for (let c = 0; c < nComp; c++) pieces.push({ map: new Map(), pos: [], col: [], idx: [] });
    for (let t = 0; t < mesh.triCount(); t++) {
      if (mesh.triDead.array[t]) continue;
      const pc = pieces[lab[T[t * 3]]];
      for (let k = 0; k < 3; k++) {
        const v = T[t * 3 + k];
        let to = pc.map.get(v);
        if (to === undefined) { to = pc.pos.length / 3; pc.map.set(v, to); pc.pos.push(P[v*3], P[v*3+1], P[v*3+2]); pc.col.push(C[v*3], C[v*3+1], C[v*3+2]); }
        pc.idx.push(to);
      }
    }
    const toMesh = (pcs) => {
      let nv = 0, ni = 0;
      for (const pc of pcs) { nv += pc.pos.length; ni += pc.idx.length; }
      const pos = new Float32Array(nv), col = new Float32Array(nv), idx = new Uint32Array(ni);
      let vo = 0, io = 0;
      for (const pc of pcs) {
        pos.set(pc.pos, vo); col.set(pc.col, vo);
        const base = vo / 3; for (let i = 0; i < pc.idx.length; i++) idx[io + i] = pc.idx[i] + base;
        vo += pc.pos.length; io += pc.idx.length;
      }
      const m = new S.Mesh(); m.setFromArrays(pos, idx, { colors: col, weld: false });
      return m;
    };
    const bodyPieces = pieces.filter((pc, c) => pc.idx.length && !isProp[c]);
    const propPieces = pieces.filter((pc, c) => pc.idx.length && isProp[c]);
    const shell = toMesh(bodyPieces), props = propPieces.map((pc) => toMesh([pc]));

    // weld: the union of every body piece's distance field, one surface out
    const mn = shell.boundsMin(), mx = shell.boundsMax();
    const vx = voxel || 0.004;
    const res = Math.round(Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / vx);
    const plan = S.Remesh.planFromBounds(mn, mx, res, 3);
    let field = null;
    for (const pc of bodyPieces) {
      const f = S.Remesh.buildField(toMesh([pc]), plan, {});
      if (!field) { field = f; continue; }
      for (let i = 0; i < field.length; i++) if (f[i] < field[i]) field[i] = f[i];
    }
    const net = S.Remesh.surfaceNets(field, plan.dims), np = net.positions;
    for (let i = 0; i < np.length; i += 3) { np[i] = plan.origin[0] + np[i] * plan.voxel; np[i+1] = plan.origin[1] + np[i+1] * plan.voxel; np[i+2] = plan.origin[2] + np[i+2] * plan.voxel; }
    const rep = S.splitNonManifoldVertices(np, net.indices, null);
    // the new object: the welded skin plus the props, still separate pieces
    const all = [{ pos: rep.positions, idx: rep.indices, col: new Float32Array(rep.positions.length).fill(0.6) }].concat(propPieces);
    const merged = toMesh(all);
    app.history.runMeshOp(o, 'Weld for the game', () => {
      o.mesh.setFromArrays(merged.positions.array.slice(0, merged.vertCount() * 3), merged.tris.array.slice(0, merged.triCount() * 3), { colors: merged.colors.array.slice(0, merged.vertCount() * 3), weld: false });
      o.mesh.removeDegenerateTriangles(plan.voxel * plan.voxel * 1e-7);
      o.mesh.smoothAll(1, 0.5, false);
      o.mesh.computeNormals();
    });
    app.afterMeshOp(o);
    return { shell, props, bodyPieces: bodyPieces.length, propPieces: propPieces.length, tris: o.mesh.liveTris };
  };

  /*
   * The colour sampler for a shipped model. Triangles of the welded skin
   * read the VISIBLE surface of the full-detail character: a ray from just
   * outside, inward along the normal, first hit. Triangles of a prop read
   * that prop's own full-detail piece, the nearest surface along the normal.
   * The bake passes the export triangle index (low.toIndexed() order).
   */
  M.shipSampler = function (low, shell, props, reach) {
    const r = reach || 0.03;
    // which piece of the reduced mesh each export triangle is on, and which high mesh that is
    const d = low.toIndexed(), li = d.indices32, nv = d.vertCount;
    const parent = new Int32Array(nv); for (let i = 0; i < nv; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let t = 0; t < li.length; t += 3) { parent[find(li[t])] = find(li[t + 1]); parent[find(li[t + 2])] = find(li[t + 1]); }
    const size = new Map();
    for (let v = 0; v < nv; v++) { const k = find(v); size.set(k, (size.get(k) || 0) + 1); }
    let skinRoot = -1, big = 0; for (const [k, n] of size) if (n > big) { big = n; skinRoot = k; }
    const source = new Map();          // low piece -> high mesh
    const nearest = (m, x, y, z) => { const P = m.positions.array; let bd = Infinity; for (const v of m.vertsInSphere(x, y, z, 0.05)) bd = Math.min(bd, (P[v*3]-x)**2 + (P[v*3+1]-y)**2 + (P[v*3+2]-z)**2); return bd; };
    const triSource = new Array(li.length / 3);
    for (let t = 0; t < li.length / 3; t++) {
      const root = find(li[t * 3]);
      if (!source.has(root)) {
        if (root === skinRoot || !props.length) source.set(root, { m: shell, visible: true });
        else {
          const v = li[t * 3], x = d.positions[v*3], y = d.positions[v*3+1], z = d.positions[v*3+2];
          let best = null, bd = Infinity;
          for (const pm of props) { const dd = nearest(pm, x, y, z); if (dd < bd) { bd = dd; best = pm; } }
          source.set(root, { m: best || shell, visible: !best });
        }
      }
      triSource[t] = source.get(root);
    }
    const hit = { t: 0, tri: -1 };
    function colourAt(m, tri, x, y, z, out) {
      const P = m.positions.array, C = m.colors.array, T = m.tris.array;
      const a = T[tri * 3], b = T[tri * 3 + 1], c = T[tri * 3 + 2];
      const ax = P[a*3], ay = P[a*3+1], az = P[a*3+2];
      const v0 = [P[b*3]-ax, P[b*3+1]-ay, P[b*3+2]-az], v1 = [P[c*3]-ax, P[c*3+1]-ay, P[c*3+2]-az], v2 = [x-ax, y-ay, z-az];
      const d00 = v0[0]*v0[0]+v0[1]*v0[1]+v0[2]*v0[2], d01 = v0[0]*v1[0]+v0[1]*v1[1]+v0[2]*v1[2], d11 = v1[0]*v1[0]+v1[1]*v1[1]+v1[2]*v1[2];
      const d20 = v2[0]*v0[0]+v2[1]*v0[1]+v2[2]*v0[2], d21 = v2[0]*v1[0]+v2[1]*v1[1]+v2[2]*v1[2];
      const den = d00 * d11 - d01 * d01 || 1e-12;
      let v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
      v = Math.max(0, Math.min(1, v)); w = Math.max(0, Math.min(1 - v, w)); const u = 1 - v - w;
      for (let k = 0; k < 3; k++) out[k] = C[a*3+k] * u + C[b*3+k] * v + C[c*3+k] * w;
    }
    return {
      misses: 0,
      sample(x, y, z, nx, ny, nz, out, tri) {
        const src = tri === undefined ? { m: shell, visible: true } : triSource[tri], m = src.m;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        if (src.visible) {
          // the visible surface: from outside, looking in, the first thing the ray meets
          const ox = x + nx * r, oy = y + ny * r, oz = z + nz * r;
          if (m.raycast(ox, oy, oz, -nx, -ny, -nz, hit, false) && hit.t < 2.5 * r) {
            colourAt(m, hit.tri, ox - nx * hit.t, oy - ny * hit.t, oz - nz * hit.t, out); return out;
          }
        } else {
          let best = -1, bt = Infinity, bx = 0, by = 0, bz = 0;
          for (const s of [1, -1]) {
            const ox = x + nx * r * s, oy = y + ny * r * s, oz = z + nz * r * s;
            if (m.raycast(ox, oy, oz, -nx * s, -ny * s, -nz * s, hit, false) && hit.t < 2 * r) {
              const dd = Math.abs(hit.t - r);
              if (dd < bt) { bt = dd; best = hit.tri; bx = ox - nx * s * hit.t; by = oy - ny * s * hit.t; bz = oz - nz * s * hit.t; }
            }
          }
          if (best >= 0) { colourAt(m, best, bx, by, bz, out); return out; }
        }
        const P = m.positions.array, C = m.colors.array;
        let bd = Infinity, bv = -1;
        for (const v of m.vertsInSphere(x, y, z, r)) { const dd = (P[v*3]-x)**2 + (P[v*3+1]-y)**2 + (P[v*3+2]-z)**2; if (dd < bd) { bd = dd; bv = v; } }
        if (bv < 0) { this.misses++; out[0] = out[1] = out[2] = 0.5; return out; }
        out[0] = C[bv*3]; out[1] = C[bv*3+1]; out[2] = C[bv*3+2];
        return out;
      }
    };
  };
})();
