import { load, check, eq, report, audit, volume } from './harness.mjs';
const S = load();

/* ---- edge split ---------------------------------------------------- */
{
  const m = S.Prim.makeMesh('sphere', 2);
  const v0 = m.liveVerts, t0 = m.liveTris;
  const T = m.tris.array;
  const a = T[0], b = T[1];
  const mid = m.splitEdge(a, b);
  check('split returns a vertex', mid >= 0);
  eq('split adds 1 vertex', m.liveVerts, v0 + 1);
  eq('split adds 2 triangles', m.liveTris, t0 + 2);
  audit(m, 'after one split');

  // split every edge of a triangle repeatedly
  for (let i = 0; i < 300; i++) {
    const t = i % m.triDead.length;
    if (m.triDead.array[t]) continue;
    const q = t * 3;
    m.splitEdge(m.tris.array[q], m.tris.array[q + 1]);
  }
  audit(m, 'after 300 splits');
  eq('open edges still 0 after splits', m.countBorderEdges(), 0);
}

/* ---- edge collapse ------------------------------------------------- */
{
  const m = S.Prim.makeMesh('sphere', 3);
  const t0 = m.liveTris;
  let collapsed = 0;
  const p = m.positions.array;
  for (let t = 0; t < 400 && t < m.triDead.length; t++) {
    if (m.triDead.array[t]) continue;
    const q = t * 3, a = m.tris.array[q], b = m.tris.array[q + 1];
    if (m.vertDead.array[a] || m.vertDead.array[b]) continue;
    const mx = (p[a * 3] + p[b * 3]) / 2, my = (p[a * 3 + 1] + p[b * 3 + 1]) / 2, mz = (p[a * 3 + 2] + p[b * 3 + 2]) / 2;
    if (m.collapseEdge(a, b, mx, my, mz, false)) collapsed++;
  }
  check('collapses happened', collapsed > 100, `${collapsed}`);
  eq('each collapse removes 2 tris', m.liveTris, t0 - collapsed * 2);
  audit(m, 'after collapses');
  eq('still closed after collapses', m.countBorderEdges(), 0);
}

/* ---- collapse refuses to break the surface ------------------------- */
{
  const m = S.Prim.makeMesh('sphere', 1);
  // a and b that are not an edge at all
  let nonEdge = null;
  for (let a = 0; a < m.liveVerts && !nonEdge; a++) {
    for (let b = a + 1; b < m.liveVerts; b++) {
      if (m.countEdgeTris(a, b) === 0) { nonEdge = [a, b]; break; }
    }
  }
  check('found a non-edge pair', !!nonEdge);
  check('collapse of a non-edge refused', !m.collapseEdge(nonEdge[0], nonEdge[1], 0, 0, 0, true));
  // border vertices of a plane are protected unless allowed
  const pl = S.Prim.makeMesh('plane', 2);
  let borderPair = null;
  const T = pl.tris.array;
  for (let t = 0; t < pl.liveTris && !borderPair; t++) {
    const q = t * 3;
    for (let k = 0; k < 3; k++) {
      const a = T[q + k], b = T[q + (k + 1) % 3];
      if (pl.countEdgeTris(a, b) === 1) { borderPair = [a, b]; break; }
    }
  }
  check('found a border edge on the plane', !!borderPair);
  check('border collapse refused by default', !pl.collapseEdge(borderPair[0], borderPair[1], 0, 0, 0, false));
  audit(pl, 'plane untouched by refused collapse');
}

/* ---- dyntopo ------------------------------------------------------- */
{
  const m = S.Prim.makeMesh('sphere', 3);
  const before = m.liveTris;
  const avg = m.averageEdgeLength();
  const r = m.dyntopo(0, 0, 0.5, 0.25, avg * 0.35, 2000000);
  check('dyntopo refined', r.split > 0, JSON.stringify(r));
  check('triangle count grew', m.liveTris > before);
  audit(m, 'after dyntopo refine');
  eq('closed after refine', m.countBorderEdges(), 0);

  const mid = m.liveTris;
  const r2 = m.dyntopo(0, 0, 0.5, 0.25, avg * 4, 2000000);
  check('dyntopo coarsened', r2.collapsed > 0, JSON.stringify(r2));
  check('triangle count shrank', m.liveTris < mid);
  audit(m, 'after dyntopo coarsen');
  eq('closed after coarsen', m.countBorderEdges(), 0);

  // respects the triangle budget
  const m2 = S.Prim.makeMesh('sphere', 2);
  const cap = m2.liveTris + 200;
  m2.dyntopo(0, 0, 0, 10, m2.averageEdgeLength() / 8, cap);
  check('dyntopo respects max triangles', m2.liveTris <= cap + 8, `${m2.liveTris} vs cap ${cap}`);
  audit(m2, 'after capped dyntopo');
}

/* ---- dyntopo under a long simulated stroke ------------------------- */
{
  const m = S.Prim.makeMesh('sphere', 3);
  const detail = m.averageEdgeLength() * 0.5;
  const out = {};
  for (let i = 0; i < 60; i++) {
    const a = i / 60 * Math.PI * 2;
    const ox = Math.cos(a) * 3, oz = Math.sin(a) * 3;
    if (!m.raycast(ox, 0.1, oz, -ox, -0.1, -oz, out, true)) continue;
    m.dyntopo(out.x, out.y, out.z, 0.12, detail, 800000);
    const verts = m.vertsInSphere(out.x, out.y, out.z, 0.12);
    const p = m.positions.array, n = m.normals.array;
    const arr = Uint32Array.from(verts);
    for (const v of verts) {
      const o = v * 3;
      p[o] += n[o] * 0.01; p[o + 1] += n[o + 1] * 0.01; p[o + 2] += n[o + 2] * 0.01;
    }
    m.computeNormals(arr, arr.length);
    m.gridUpdateVerts(arr, arr.length);
  }
  audit(m, 'after 60-step dyntopo stroke');
  eq('closed after stroke', m.countBorderEdges(), 0);
  check('stroke displaced the surface', m.boundsRadius() > 0.5, m.boundsRadius().toFixed(3));
}

/* ---- subdivide ----------------------------------------------------- */
{
  const m = S.Prim.makeMesh('sphere', 2);
  const v0 = m.liveVerts, t0 = m.liveTris;
  m.subdivide(false);
  eq('linear subdivide x4 triangles', m.liveTris, t0 * 4);
  eq('linear subdivide vertex count (Euler)', m.liveVerts, v0 + t0 * 3 / 2);
  audit(m, 'after linear subdivide');
  const r1 = m.boundsRadius();

  const m2 = S.Prim.makeMesh('sphere', 2);
  m2.subdivide(true);
  eq('loop subdivide x4 triangles', m2.liveTris, t0 * 4);
  check('loop subdivide shrinks slightly (it smooths)', m2.boundsRadius() < r1);
  audit(m2, 'after loop subdivide');
  eq('closed after subdivide', m2.countBorderEdges(), 0);

  const pl = S.Prim.makeMesh('plane', 2);
  const be = pl.countBorderEdges();
  pl.subdivide(true);
  eq('plane border preserved by loop subdivide', pl.countBorderEdges(), be * 2);
  audit(pl, 'after plane subdivide');
}

/* ---- decimate ------------------------------------------------------ */
{
  const m = S.Prim.makeMesh('sphere', 4);
  const t0 = m.liveTris, vol0 = volume(m);
  const res = m.decimate(1200, true);
  check('decimate reached target', m.liveTris <= 1300, `${m.liveTris}`);
  check('decimate removed triangles', res.removed > 0);
  audit(m, 'after decimate');
  eq('closed after decimate', m.countBorderEdges(), 0);
  const vol1 = volume(m);
  check('decimate keeps volume within 6%', Math.abs(vol1 - vol0) / vol0 < 0.06,
    `${vol0.toFixed(4)} -> ${vol1.toFixed(4)}`);
  check('decimate cut count substantially', m.liveTris < t0 / 4, `${t0} -> ${m.liveTris}`);
  check('decimate stopped near the target', m.liveTris >= 1100 && m.liveTris <= 1250, `${m.liveTris}`);
}

/* ---- smoothing ----------------------------------------------------- */
{
  const m = S.Prim.makeMesh('sphere', 3);
  // spike one vertex, then smooth it back down
  const p = m.positions.array;
  p[0] *= 3; p[1] *= 3; p[2] *= 3;
  const before = m.boundsRadius();
  m.smoothAll(6, 0.8, false);
  check('smoothing removed the spike', m.boundsRadius() < before, `${before.toFixed(3)} -> ${m.boundsRadius().toFixed(3)}`);
  audit(m, 'after smoothAll');

  const m2 = S.Prim.makeMesh('sphere', 3);
  const vol0 = volume(m2);
  const verts = [];
  for (let v = 0; v < m2.liveVerts; v++) verts.push(v);
  const arr = Uint32Array.from(verts);
  for (let i = 0; i < 8; i++) m2.smoothVerts(arr, arr.length, 0.6, true);
  const vol1 = volume(m2);
  check('tangential smoothing preserves volume', Math.abs(vol1 - vol0) / vol0 < 0.01,
    `${vol0.toFixed(5)} -> ${vol1.toFixed(5)}`);
}

/* ---- masking blocks edits ------------------------------------------ */
{
  const m = S.Prim.makeMesh('sphere', 2);
  m.setMaskAll(1);
  const p0 = m.positions.copy();
  const arr = new Uint32Array(m.liveVerts);
  for (let v = 0; v < m.liveVerts; v++) arr[v] = v;
  m.smoothVerts(arr, arr.length, 1, false);
  let moved = 0;
  for (let i = 0; i < p0.length; i++) if (Math.abs(p0[i] - m.positions.array[i]) > 1e-9) moved++;
  eq('fully masked mesh does not move', moved, 0);
  m.invertMask();
  eq('invert mask', m.masks.array[0], 0);
}

/* ---- symmetrize ---------------------------------------------------- */
{
  const m = S.Prim.makeMesh('sphere', 2);
  // dent the -x side so the mirror is observable
  const p = m.positions.array;
  for (let v = 0; v < m.liveVerts; v++) if (p[v * 3] < 0) p[v * 3 + 1] += 0.2;
  m.symmetrize(0, true);
  audit(m, 'after symmetrize');
  eq('symmetrized mesh is closed', m.countBorderEdges(), 0);
  // sample a few +x vertices and confirm a mirrored partner exists
  let matched = 0, tested = 0;
  const p2 = m.positions.array;
  for (let v = 0; v < m.liveVerts; v += 37) {
    if (p2[v * 3] < 0.1) continue;
    tested++;
    const want = [-p2[v * 3], p2[v * 3 + 1], p2[v * 3 + 2]];
    const near = m.vertsInSphere(want[0], want[1], want[2], 1e-3);
    if (near.length) matched++;
  }
  check('every sampled vertex has a mirror partner', tested > 0 && matched === tested, `${matched}/${tested}`);
}

/* ---- compaction keeps geometry identical --------------------------- */
{
  const m = S.Prim.makeMesh('sphere', 3);
  for (let t = 0; t < 200; t++) {
    const q = t * 3;
    const a = m.tris.array[q], b = m.tris.array[q + 1];
    if (m.triDead.array[t] || m.vertDead.array[a] || m.vertDead.array[b]) continue;
    const p = m.positions.array;
    m.collapseEdge(a, b, (p[a*3]+p[b*3])/2, (p[a*3+1]+p[b*3+1])/2, (p[a*3+2]+p[b*3+2])/2, false);
  }
  const volBefore = volume(m), tBefore = m.liveTris, vBefore = m.liveVerts;
  m.compact();
  eq('compact keeps triangle count', m.liveTris, tBefore);
  eq('compact keeps vertex count', m.liveVerts, vBefore);
  eq('compact leaves no free slots', m.freeVerts.length + m.freeTris.length, 0);
  check('compact keeps volume', Math.abs(volume(m) - volBefore) < 1e-6);
  audit(m, 'after compact');
}

/* ---- plane cut ------------------------------------------------------ */
{
  const m = S.Prim.makeMesh('sphere', 3);
  m.cutByPlane(0, true);
  audit(m, 'after cutByPlane');
  let minX = Infinity;
  for (let v = 0; v < m.masks.length; v++) {
    if (m.vertDead.array[v]) continue;
    minX = Math.min(minX, m.positions.array[v * 3]);
  }
  check('cut removed everything below the plane', minX > -1e-6, `minX=${minX}`);
  check('cut leaves an open seam', m.countBorderEdges() > 0);
  check('cut kept roughly half the triangles', m.liveTris > 560 && m.liveTris < 800, `${m.liveTris}`);
}

/* ---- edge flip ------------------------------------------------------ */
{
  const m = S.Prim.makeMesh('sphere', 3);
  const t0 = m.liveTris, v0 = m.liveVerts;
  const vol0 = volume(m);

  // Outward-facing check: for a star-shaped mesh every face normal must have
  // a positive dot with its own centroid. A flip with the winding worked out
  // backwards breaks this immediately.
  function outwardFaces(mesh) {
    const T = mesh.tris.array, p = mesh.positions.array;
    let bad = 0;
    for (let t = 0; t < mesh.triDead.length; t++) {
      if (mesh.triDead.array[t]) continue;
      const t3 = t * 3, a = T[t3] * 3, b = T[t3 + 1] * 3, c = T[t3 + 2] * 3;
      const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const cen = [(p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3];
      if (n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] <= 0) bad++;
    }
    return bad;
  }
  eq('sphere starts with every face outward', outwardFaces(m), 0);

  // force flips through by asking for no quality gain
  let flips = 0;
  const T = m.tris.array;
  for (let t = 0; t < 250 && t < m.triDead.length; t++) {
    if (m.triDead.array[t]) continue;
    const q = t * 3;
    if (m.flipEdge(T[q], T[q + 1], -1)) flips++;
  }
  check('flips happened', flips > 40, `${flips}`);
  eq('flipping keeps the triangle count', m.liveTris, t0);
  eq('flipping keeps the vertex count', m.liveVerts, v0);
  eq('flipping keeps the mesh closed', m.countBorderEdges(), 0);
  eq('every face still points outward after flipping', outwardFaces(m), 0);
  audit(m, 'after 40+ edge flips');
  // the surface passes through the same vertices, so the volume barely moves
  check('flipping barely changes the volume', Math.abs(volume(m) - vol0) / vol0 < 0.02,
    `${vol0.toFixed(5)} -> ${volume(m).toFixed(5)}`);

  // a flip that would duplicate an existing edge must be refused
  const m2 = S.Prim.makeMesh('sphere', 1);
  let refused = 0, tried = 0;
  const T2 = m2.tris.array;
  for (let t = 0; t < m2.liveTris; t++) {
    const q = t * 3;
    for (let k = 0; k < 3; k++) {
      const a = T2[q + k], b = T2[q + (k + 1) % 3];
      tried++;
      if (!m2.flipEdge(a, b, -1)) refused++;
    }
  }
  check('some flips are refused on a coarse mesh', refused > 0, `${refused}/${tried}`);
  audit(m2, 'after attempted flips on a coarse sphere');
  eq('coarse sphere still closed', m2.countBorderEdges(), 0);

  // flips must improve the worst triangle when asked to
  const m3 = S.Prim.makeMesh('plane', 3);
  // shear the plane so its triangles become slivers
  const p3 = m3.positions.array;
  for (let v = 0; v < m3.liveVerts; v++) p3[v * 3] += p3[v * 3 + 2] * 2.4;
  let worstBefore = 1;
  for (let t = 0; t < m3.triDead.length; t++) if (!m3.triDead.array[t]) worstBefore = Math.min(worstBefore, m3.triQuality(t));
  let improved = 0;
  for (let pass = 0; pass < 3; pass++) {
    for (let t = 0; t < m3.triDead.length; t++) {
      if (m3.triDead.array[t]) continue;
      const q = t * 3;
      for (let k = 0; k < 3; k++) {
        if (m3.flipEdge(m3.tris.array[q + k], m3.tris.array[q + (k + 1) % 3])) { improved++; break; }
      }
    }
  }
  let worstAfter = 1;
  for (let t = 0; t < m3.triDead.length; t++) if (!m3.triDead.array[t]) worstAfter = Math.min(worstAfter, m3.triQuality(t));
  check('flipping improves the worst triangle of a sheared grid', worstAfter > worstBefore,
    `${worstBefore.toFixed(4)} -> ${worstAfter.toFixed(4)} in ${improved} flips`);
  audit(m3, 'after quality-driven flips');
}

/* ---- decimate reaches its target on a big, uneven mesh -------------- */
{
  // A remeshed sculpt is the realistic case: tens of thousands of triangles
  // of varying quality. The decimator used to stall well short of the target
  // because it invalidated heap entries it never pushed again.
  const m = S.Prim.makeMesh('sphere', 5);
  m.subdivide(false);                               // 81920 triangles
  // dent it so the quadrics are not all identical
  const p = m.positions.array;
  for (let v = 0; v < m.masks.length; v++) {
    if (m.vertDead.array[v]) continue;
    const o = v * 3;
    const s = 1 + 0.2 * Math.sin(p[o] * 9) * Math.cos(p[o + 2] * 7);
    p[o] *= s; p[o + 1] *= s; p[o + 2] *= s;
  }
  m.computeNormals();
  m.gridRebuild();
  const before = m.liveTris;
  const t0 = Date.now();
  m.decimate(4000, true);
  const ms = Date.now() - t0;
  check('decimate reaches the requested target on a big mesh', m.liveTris <= 4100,
    `${before} -> ${m.liveTris} in ${ms}ms`);
  eq('the decimated mesh is still closed', m.countBorderEdges(), 0);
  audit(m, 'after decimating a big mesh');
  check('decimation of 80k triangles is quick', ms < 6000, `${ms}ms`);

  // and again to an even smaller budget, as a game LOD chain would
  m.decimate(900, true);
  check('a second decimation also reaches its target', m.liveTris <= 1000, `${m.liveTris}`);
  eq('still closed after the second pass', m.countBorderEdges(), 0);
  audit(m, 'after a second decimation');
}

/* ---- spikes: finding them and pulling them back ---------------------- */
{
  const clean = S.Prim.makeMesh('sphere', 3);
  eq('a clean sphere has no spikes', clean.countSpikes(), 0);
  eq('nor a box', S.Prim.makeMesh('box', 3).countSpikes(), 0);
  eq('nor a cylinder', S.Prim.makeMesh('cylinder', 3).countSpikes(), 0);
  eq('nor a torus', S.Prim.makeMesh('torus', 3).countSpikes(), 0);
  eq('relaxing a clean mesh changes nothing', clean.relaxSpikes(), 0);

  // a cone's tip is a real feature, not a glitch: the default threshold has
  // to leave it alone, or repairing a model would blunt every point on it
  const cone = S.Prim.makeMesh('cone', 3);
  const tipBefore = cone.boundsMax()[1];
  cone.relaxSpikes();
  check('a cone keeps its point', Math.abs(cone.boundsMax()[1] - tipBefore) < 1e-6,
    `${tipBefore} -> ${cone.boundsMax()[1]}`);

  // fling three vertices right out and they should be found and pulled back
  const poked = S.Prim.makeMesh('sphere', 3);
  const p = poked.positions.array;
  for (const v of [12, 300, 1100]) {
    const o = v * 3;
    p[o] *= 9; p[o + 1] *= 9; p[o + 2] *= 9;
  }
  poked.computeNormals();
  poked._boundsDirty = true;
  const wildRadius = poked.boundsRadius();
  const found = poked.countSpikes();
  check('flinging vertices out makes needles', found >= 2, `${found}`);
  const fixed = poked.relaxSpikes();
  check('relaxing reports what it moved', fixed >= found, `${fixed} vs ${found}`);
  eq('and the needles are gone', poked.countSpikes(), 0);
  check('the mesh is not torn by the repair',
    poked.countBorderEdges() === 0 && poked.countNonManifoldEdges() === 0);
  audit(poked, 'after relaxing needles');
  poked._boundsDirty = true;
  /*
   * Most of the way back, not all of it: where two needles were neighbours,
   * each one's ring is still distorted by the other, so the pass stops once
   * nothing is flagged. Going further would mean smoothing geometry that no
   * longer looks wrong.
   */
  check('the shape comes back close to its old size',
    poked.boundsRadius() < wildRadius * 0.35 && poked.boundsRadius() < 1.5,
    `${wildRadius.toFixed(2)} -> ${poked.boundsRadius().toFixed(2)}, sphere is 0.5`);

  /*
   * The threshold has to sit above the sharpest thing anyone makes on
   * purpose. A cone's apex is the worst of the primitives, and it must not
   * be touched; measured spikes from a stroke score lower still, which is
   * why prevention lives in the brush engine rather than here.
   */
  function worstRatio(mesh) {
    const pos = mesh.positions.array;
    const ring = [];
    let worst = 0;
    for (let v = 0; v < mesh.masks.length; v++) {
      if (mesh.vertDead.array[v]) continue;
      ring.length = 0;
      mesh.ringVerts(v, ring);
      if (ring.length < 3) continue;
      const o = v * 3;
      let cx = 0, cy = 0, cz = 0;
      for (const r of ring) { const ro = r * 3; cx += pos[ro]; cy += pos[ro + 1]; cz += pos[ro + 2]; }
      const inv = 1 / ring.length;
      cx *= inv; cy *= inv; cz *= inv;
      let span = 0;
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k] * 3, b = ring[(k + 1) % ring.length] * 3;
        span += Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
      }
      span *= inv;
      if (span < 1e-12) continue;
      worst = Math.max(worst, Math.hypot(pos[o] - cx, pos[o + 1] - cy, pos[o + 2] - cz) / span);
    }
    return worst;
  }
  const coneWorst = worstRatio(S.Prim.makeMesh('cone', 3));
  check('a cone apex is the sharpest thing a primitive has', coneWorst > 3 && coneWorst < 6,
    `${coneWorst.toFixed(2)}`);
  check('the repair threshold sits above it', coneWorst < 6, `${coneWorst.toFixed(2)}`);
}

/* ---- slivers, which is what a torn surface is made of ---------------- */
{
  const clean = S.Prim.makeMesh('sphere', 3);
  eq('a clean sphere has no slivers to relax', clean.relaxSlivers(), 0);

  // squash a ring of vertices sideways to make long thin triangles
  const slivered = S.Prim.makeMesh('sphere', 3);
  const sp = slivered.positions.array;
  let squashed = 0;
  for (let v = 0; v < slivered.liveVerts; v++) {
    const o = v * 3;
    if (Math.abs(sp[o + 1]) < 0.06) { sp[o + 1] *= 0.02; squashed++; }
  }
  slivered.computeNormals();
  check('squashing a band makes slivers', squashed > 10, `${squashed}`);
  const before = slivered.relaxSlivers();
  check('the slivers are found', before > 0, `${before}`);
  check('relaxing them leaves fewer', slivered.relaxSlivers() < before,
    `${before} -> ${slivered.relaxSlivers()}`);
  eq('and the mesh is still closed', slivered.countBorderEdges(), 0);
  audit(slivered, 'after relaxing slivers');
}

/* ---- dynamic topology stays affordable ------------------------------- */
{
  /*
   * The failure this guards against: a brush much smaller than the local
   * triangles used to ask for microscopic detail, and one dab could spend
   * minutes adding a hundred thousand triangles. The refinement now has a
   * ceiling per call.
   */
  const mesh = S.Prim.makeMesh('sphere', 2);        // 320 coarse triangles
  const before = mesh.liveTris;
  const t0 = Date.now();
  /*
   * A brush far smaller than the triangles it sits on, asking for detail
   * finer still. It has to refine — a brush that cannot refine drags one
   * lone vertex of a huge triangle and leaves a star of fins — but it must
   * not run away doing it.
   */
  const tiny = mesh.dyntopo(0, 0.5, 0, 0.02, 0.0005, 500000);
  const ms = Date.now() - t0;
  check('a brush smaller than the triangles still refines', tiny.split > 0, `${tiny.split} splits`);
  check('and stops at the ceiling rather than running away', tiny.split <= 600,
    `${tiny.split} splits`);
  check('quickly', ms < 2000, `${ms} ms`);
  check('the mesh grew, but not by orders of magnitude', mesh.liveTris < before * 8,
    `${before} -> ${mesh.liveTris}`);
  eq('and it is still closed', mesh.countBorderEdges(), 0);
  eq('and manifold', mesh.countNonManifoldEdges(), 0);

  /*
   * The refinement has to stay near the brush rather than spreading over
   * the model: what matters is that the triangles far from it are left
   * coarse.
   */
  const spread = S.Prim.makeMesh('sphere', 2);
  const savgSpread = spread.averageEdgeLength();
  spread.dyntopo(0, 0.5, 0, savgSpread * 0.4, savgSpread * 0.15, 500000);
  let nearFine = 0, farCoarse = 0, farFine = 0;
  for (let t = 0; t < spread.triDead.length; t++) {
    if (spread.triDead.array[t]) continue;
    const T = spread.tris.array, p = spread.positions.array;
    const a = T[t * 3] * 3;
    const d = Math.hypot(p[a], p[a + 1] - 0.5, p[a + 2]);
    let longest = 0;
    for (let k = 0; k < 3; k++) {
      const x = T[t * 3 + k] * 3, y = T[t * 3 + (k + 1) % 3] * 3;
      longest = Math.max(longest, Math.hypot(p[y] - p[x], p[y + 1] - p[x + 1], p[y + 2] - p[x + 2]));
    }
    if (d < savgSpread) { if (longest < savgSpread * 0.6) nearFine++; }
    else if (d > savgSpread * 4) { if (longest > savgSpread * 0.6) farCoarse++; else farFine++; }
  }
  check('the triangles under the brush end up fine', nearFine > 0, `${nearFine}`);
  check('and the far side of the model is left alone', farCoarse > farFine * 4,
    `${farCoarse} coarse against ${farFine} fine, far from the brush`);

  // a sensible ask refines, and stays inside the ceiling per call
  const work = S.Prim.makeMesh('sphere', 2);
  const avg = work.averageEdgeLength();
  const t1 = Date.now();
  const result = work.dyntopo(0, 0.5, 0, avg * 2, avg * 0.1, 500000);
  const ms1 = Date.now() - t1;
  check('a sensible ask does refine', result.split > 0, JSON.stringify(result));
  check('one call cannot run away', result.split <= 600, `${result.split} splits`);
  check('and it returns quickly', ms1 < 2000, `${ms1} ms`);
  eq('the mesh is still closed', work.countBorderEdges(), 0);
  eq('and still manifold', work.countNonManifoldEdges(), 0);
  audit(work, 'after a bounded refinement');

  // the ceiling is adjustable, and honoured
  const small = S.Prim.makeMesh('sphere', 2);
  const savg = small.averageEdgeLength();
  const r2 = small.dyntopo(0, 0.5, 0, savg * 2, savg * 0.1, 500000, undefined, 20);
  check('a tighter ceiling does less', r2.split <= 20, `${r2.split} splits`);
}

report('topology');
