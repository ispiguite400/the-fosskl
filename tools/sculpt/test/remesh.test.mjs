import { load, check, eq, report, audit, volume } from './harness.mjs';
const S = load();

/* ---- remesh a sphere: volume and shape must survive ---------------- */
{
  const m = S.Prim.makeMesh('sphere', 4);
  const vol0 = volume(m), r0 = m.boundsRadius();
  const t0 = Date.now();
  const res = S.Remesh.run(m, { resolution: 64, smooth: 2 });
  const ms = Date.now() - t0;
  check('remesh ran', res.ok, res.reason || '');
  audit(m, 'after remesh of a sphere');
  eq('remeshed sphere is closed', m.countBorderEdges(), 0);
  const vol1 = volume(m);
  check('remesh keeps volume within 8%', Math.abs(vol1 - vol0) / vol0 < 0.08,
    `${vol0.toFixed(4)} -> ${vol1.toFixed(4)}`);
  check('remesh keeps radius within 5%', Math.abs(m.boundsRadius() - r0) / r0 < 0.05,
    `${r0.toFixed(3)} -> ${m.boundsRadius().toFixed(3)}`);
  check('remesh produced a sane triangle count', m.liveTris > 4000 && m.liveTris < 40000, `${m.liveTris}`);
  console.log(`  sphere remesh @64: ${m.liveVerts} verts, ${m.liveTris} tris, ${ms}ms`);

  // every vertex should sit near the original radius
  const p = m.positions.array;
  let worst = 0;
  for (let v = 0; v < m.masks.length; v++) {
    if (m.vertDead.array[v]) continue;
    const o = v * 3;
    const r = Math.hypot(p[o], p[o + 1], p[o + 2]);
    worst = Math.max(worst, Math.abs(r - 0.5));
  }
  check('remeshed surface hugs the sphere', worst < 0.03, `worst deviation ${worst.toFixed(4)}`);
}

/* ---- remesh preserves separate parts and concavities --------------- */
{
  // torus: a hole must survive, which parity-based inside tests get wrong
  // if the winding or vote logic is broken
  const m = S.Prim.makeMesh('torus', 8);
  const vol0 = volume(m);
  const res = S.Remesh.run(m, { resolution: 96, smooth: 1 });
  check('torus remesh ran', res.ok);
  audit(m, 'after remesh of a torus');
  eq('remeshed torus is closed', m.countBorderEdges(), 0);
  const vol1 = volume(m);
  check('torus volume within 10%', Math.abs(vol1 - vol0) / vol0 < 0.1,
    `${vol0.toFixed(5)} -> ${vol1.toFixed(5)}`);
  // the hole: no vertex should be near the centre axis
  const p = m.positions.array;
  let minR = Infinity;
  for (let v = 0; v < m.masks.length; v++) {
    if (m.vertDead.array[v]) continue;
    const o = v * 3;
    minR = Math.min(minR, Math.hypot(p[o], p[o + 2]));
  }
  check('the torus hole survived', minR > 0.12, `closest vertex to axis ${minR.toFixed(3)}`);
}

/* ---- shell mode on an open mesh ------------------------------------ */
{
  const m = S.Prim.makeMesh('plane', 4);
  check('plane starts open', m.countBorderEdges() > 0);
  const res = S.Remesh.run(m, { resolution: 48, shell: true, thickness: 0.06, smooth: 1 });
  check('shell remesh ran', res.ok, res.reason || '');
  audit(m, 'after shell remesh');
  eq('shelled plane is closed', m.countBorderEdges(), 0);
  const v = volume(m);
  check('shell has positive volume', v > 0, `${v}`);
  // roughly area(1x1) * thickness, allowing for the rounded rim
  check('shell volume is about area x thickness', v > 0.03 && v < 0.14, `${v.toFixed(4)}`);
}

/* ---- colour transfer ----------------------------------------------- */
{
  const m = S.Prim.makeMesh('sphere', 3);
  // paint the +x half red
  const p = m.positions.array, c = m.colors.array;
  for (let v = 0; v < m.liveVerts; v++) {
    const o = v * 3;
    if (p[o] > 0) { c[o] = 1; c[o + 1] = 0; c[o + 2] = 0; } else { c[o] = 0.2; c[o + 1] = 0.4; c[o + 2] = 1; }
  }
  check('paint detected', S.Remesh.hasPaint(m));
  S.Remesh.run(m, { resolution: 48, smooth: 0, colors: true });
  const p2 = m.positions.array, c2 = m.colors.array;
  let red = 0, blue = 0, wrong = 0;
  for (let v = 0; v < m.masks.length; v++) {
    if (m.vertDead.array[v]) continue;
    const o = v * 3;
    if (p2[o] > 0.15) { if (c2[o] > 0.8 && c2[o + 2] < 0.3) red++; else wrong++; }
    else if (p2[o] < -0.15) { if (c2[o + 2] > 0.8 && c2[o] < 0.4) blue++; else wrong++; }
  }
  check('colours carried across the remesh', red > 50 && blue > 50 && wrong < (red + blue) * 0.05,
    `red=${red} blue=${blue} wrong=${wrong}`);
}

/* ---- planning and the sample budget -------------------------------- */
{
  const m = S.Prim.makeMesh('sphere', 2);
  const low = S.Remesh.plan(m, 32), high = S.Remesh.plan(m, 5000);
  check('plan respects the requested resolution', low.resolution === 32);
  check('plan clamps absurd resolutions', high.clamped && high.samples <= 24e6, `${high.samples}`);
  check('plan pads the box', low.origin[0] < m.boundsMin()[0]);
}

/* ---- the remesh output must be watertight AND manifold -------------- */
{
  // Dual contouring's classic failure is a pinch: where the surface nearly
  // touches itself, two sheets share a cell's single vertex and produce an
  // edge with four faces. That is invisible on screen but breaks sculpting,
  // 3D printing and strict exporters, so it is checked on every shape.
  for (const [shape, res] of [['sphere', 48], ['sphere', 96], ['torus', 96],
                              ['capsule', 96], ['cylinder', 96], ['cone', 96],
                              ['roundbox', 96], ['box', 64], ['uvsphere', 80]]) {
    const m = S.Prim.makeMesh(shape, 8);
    const r = S.Remesh.run(m, { resolution: res, smooth: 1 });
    check(`${shape}@${res}: remesh ran`, r.ok, r.reason || '');
    eq(`${shape}@${res}: watertight`, m.countBorderEdges(), 0);
    eq(`${shape}@${res}: manifold`, m.countNonManifoldEdges(), 0);
    audit(m, `${shape}@${res} remesh`);
    // a handful of zero-area triangles can survive on the poles; they are
    // invisible, but they must not be widespread
    check(`${shape}@${res}: almost no zero-area triangles`,
      m.countDegenerateTriangles() < Math.max(24, m.liveTris * 0.001),
      `${m.countDegenerateTriangles()} of ${m.liveTris}`);
  }
}

/* ---- a sculpted surface that used to pinch -------------------------- */
{
  // A surface with deep creases and thin pulled shapes is what triggers the
  // pinch case. This rebuilds one and checks the result end to end.
  const m = S.Prim.makeMesh('sphere', 4);
  const p = m.positions.array;
  for (let v = 0; v < m.masks.length; v++) {
    if (m.vertDead.array[v]) continue;
    const o = v * 3;
    const x = p[o], y = p[o + 1], z = p[o + 2];
    // deep wrinkles: the surface folds back within a voxel or two
    const s = 1 + 0.34 * Math.sin(x * 22) * Math.cos(z * 19) + 0.12 * Math.sin(y * 31);
    p[o] = x * s; p[o + 1] = y * s; p[o + 2] = z * s;
  }
  m.computeNormals();
  m.gridRebuild();
  const r = S.Remesh.run(m, { resolution: 96, smooth: 2 });
  check('wrinkled surface remeshed', r.ok);
  eq('wrinkled remesh is watertight', m.countBorderEdges(), 0);
  eq('wrinkled remesh is manifold', m.countNonManifoldEdges(), 0);
  audit(m, 'wrinkled remesh');
  check('the pinch repair reported what it did', typeof r.pinchesSplit === 'number');
}

/* ---- edge health helper -------------------------------------------- */
{
  // two triangles sharing an edge: healthy
  const good = new Uint32Array([0, 1, 2, 2, 1, 3]);
  let h = S.edgeHealth(good);
  eq('edgeHealth counts holes', h.border, 4);
  eq('edgeHealth finds no pinch', h.nonManifold, 0);
  // four triangles all sharing edge 0-1: a pinch
  const pinched = new Uint32Array([0, 1, 2, 0, 1, 3, 0, 1, 4, 0, 1, 5]);
  h = S.edgeHealth(pinched);
  eq('edgeHealth finds the pinch', h.nonManifold, 1);
}

report('remesh');
