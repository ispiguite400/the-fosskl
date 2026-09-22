/*
 * Clay forms: tapered limbs, ellipsoids and rounded blocks blended with a
 * smooth union, then turned into one surface by the app's own mesher
 * (Remesh.surfaceNets). This is the block-out: the result is a single
 * sculptable mesh for the brushes to work on.
 */
(function () {
  const S = window.SCULPT, app = M.app, D = Math.PI / 180;
  const C = M.clay = { ops: [], tags: [], palette: {} };
  function rotm(deg) {                       // rows of R (local->world); we use R^T to go world->local
    const [a, b, c] = (deg || [0, 0, 0]).map(v => v * D);
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
    // R = Rz * Ry * Rx
    return [cc*cb, cc*sb*sa - sc*ca, cc*sb*ca + sc*sa,
            sc*cb, sc*sb*sa + cc*ca, sc*sb*ca - cc*sa,
            -sb,   cb*sa,            cb*ca];
  }
  function tagId(t) { let i = C.tags.indexOf(t); if (i < 0) { C.tags.push(t); i = C.tags.length - 1; } return i; }
  function add(op) { op.tag = tagId(op.tag || M.tag || 'default'); op.k = op.k === undefined ? (M.k || 0) : op.k; op.mode = op.mode || 'union'; C.ops.push(op); return op; }
  // ellipsoid
  C.ell = (c, r, rot, o) => add(Object.assign({ type: 'ell', c, r, R: rotm(rot),
    bb: Math.max(...r) }, o));
  // tapered limb from a (radius ra) to b (radius rb)
  C.limb = (a, b, ra, rb, o) => add(Object.assign({ type: 'rcone', a, b, ra, rb: rb === undefined ? ra : rb }, o));
  // rounded box: centre, half sizes, rounding
  C.box = (c, h, rnd, rot, o) => add(Object.assign({ type: 'box', c, h, rnd: rnd || 0, R: rotm(rot), bb: Math.hypot(...h) + (rnd||0) }, o));
  // a frame from three world axes (unit vectors), for parts that follow an object's own orientation
  C.basis = (ex, ey, ez) => [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]];
  // capped cylinder along local Y: centre, radius, half height, edge rounding
  C.cyl = (c, r, hh, rnd, rot, o) => add(Object.assign({ type: 'cyl', c, r, hh, rnd: rnd || 0, R: rotm(rot), bb: Math.hypot(r, hh) + (rnd||0) }, o));
  C.torus = (c, R0, r, rot, o) => add(Object.assign({ type: 'torus', c, R0, r, R: rotm(rot), bb: R0 + r }, o));

  function local(op, x, y, z) {
    const dx = x - op.c[0], dy = y - op.c[1], dz = z - op.c[2], R = op.R;
    return [R[0]*dx + R[3]*dy + R[6]*dz, R[1]*dx + R[4]*dy + R[7]*dz, R[2]*dx + R[5]*dy + R[8]*dz];
  }
  function sdf(op, x, y, z) { return sdf0(op, x, y, z) - (op.grow || 0); }
  function sdf0(op, x, y, z) {
    switch (op.type) {
      case 'ell': {
        const p = local(op, x, y, z), r = op.r;
        const k0 = Math.hypot(p[0]/r[0], p[1]/r[1], p[2]/r[2]);
        const k1 = Math.hypot(p[0]/(r[0]*r[0]), p[1]/(r[1]*r[1]), p[2]/(r[2]*r[2]));
        return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(...r);
      }
      case 'rcone': {           // iq's round cone
        const a = op.a, b = op.b, r1 = op.ra, r2 = op.rb;
        const bax = b[0]-a[0], bay = b[1]-a[1], baz = b[2]-a[2];
        const l2 = bax*bax + bay*bay + baz*baz, rr = r1 - r2, a2 = l2 - rr*rr, il2 = 1 / l2;
        const pax = x-a[0], pay = y-a[1], paz = z-a[2];
        const yv = pax*bax + pay*bay + paz*baz, zv = yv - l2;
        const qx = pax*l2 - bax*yv, qy = pay*l2 - bay*yv, qz = paz*l2 - baz*yv;
        const x2 = qx*qx + qy*qy + qz*qz, y2 = yv*yv*l2, z2 = zv*zv*l2;
        const k = Math.sign(rr) * rr * rr * x2;
        if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
        if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
        return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - r1;
      }
      case 'box': {
        const p = local(op, x, y, z), h = op.h, r = op.rnd;
        const qx = Math.abs(p[0]) - h[0] + r, qy = Math.abs(p[1]) - h[1] + r, qz = Math.abs(p[2]) - h[2] + r;
        return Math.hypot(Math.max(qx,0), Math.max(qy,0), Math.max(qz,0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
      }
      case 'cyl': {
        const p = local(op, x, y, z), r = op.rnd;
        const dx = Math.hypot(p[0], p[2]) - op.r + r, dy = Math.abs(p[1]) - op.hh + r;
        return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r;
      }
      case 'torus': {
        const p = local(op, x, y, z);
        return Math.hypot(Math.hypot(p[0], p[2]) - op.R0, p[1]) - op.r;
      }
    }
  }
  C.sdf = sdf;
  function bounds(op) {
    if (op.type === 'rcone') {
      const m = Math.max(op.ra, op.rb) + (op.grow || 0);
      return [Math.min(op.a[0], op.b[0]) - m, Math.min(op.a[1], op.b[1]) - m, Math.min(op.a[2], op.b[2]) - m,
              Math.max(op.a[0], op.b[0]) + m, Math.max(op.a[1], op.b[1]) + m, Math.max(op.a[2], op.b[2]) + m];
    }
    const b = op.bb + (op.grow || 0);
    return [op.c[0]-b, op.c[1]-b, op.c[2]-b, op.c[0]+b, op.c[1]+b, op.c[2]+b];
  }
  // build the field and mesh it into the current object
  C.build = function (voxel, smooth, obj) {
    const ops = C.ops;
    const mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
    for (const op of ops) { op.box = bounds(op); if (op.mode !== 'union') continue; for (let i=0;i<3;i++){ mn[i]=Math.min(mn[i],op.box[i]); mx[i]=Math.max(mx[i],op.box[i+3]); } }
    const pad = 3 * voxel;
    for (let i=0;i<3;i++){ mn[i]-=pad; mx[i]+=pad; }
    const dims = [0,1,2].map(i => Math.ceil((mx[i]-mn[i]) / voxel) + 1);
    const nx = dims[0], ny = dims[1], nz = dims[2], N = nx*ny*nz;
    const field = new Float32Array(N).fill(1e3), tag = new Uint8Array(N).fill(255);
    for (const op of ops) {
      const m = op.k + voxel * 2;
      const i0 = Math.max(0, Math.floor((op.box[0]-m-mn[0])/voxel)), i1 = Math.min(nx-1, Math.ceil((op.box[3]+m-mn[0])/voxel));
      const j0 = Math.max(0, Math.floor((op.box[1]-m-mn[1])/voxel)), j1 = Math.min(ny-1, Math.ceil((op.box[4]+m-mn[1])/voxel));
      const k0 = Math.max(0, Math.floor((op.box[2]-m-mn[2])/voxel)), k1 = Math.min(nz-1, Math.ceil((op.box[5]+m-mn[2])/voxel));
      const k = op.k;
      for (let kk = k0; kk <= k1; kk++) { const z = mn[2] + kk*voxel;
        for (let j = j0; j <= j1; j++) { const y = mn[1] + j*voxel; let idx = j*nx + kk*nx*ny + i0;
          for (let i = i0; i <= i1; i++, idx++) {
            const x = mn[0] + i*voxel, d = sdf(op, x, y, z), a = field[idx];
            if (op.mode === 'union') {
              if (k > 0) { const h = Math.max(k - Math.abs(a - d), 0) / k; field[idx] = Math.min(a, d) - h*h*k*0.25; }
              else if (d < a) field[idx] = d;
              if (d < a + k * 0.25) tag[idx] = (d < a || tag[idx] === 255) ? op.tag : tag[idx];
            } else if (op.mode === 'subtract') {
              let v;
              if (k > 0) { const h = Math.max(k - Math.abs(a + d), 0) / k; v = Math.max(a, -d) + h*h*k*0.25; } else v = Math.max(a, -d);
              if (v > a + 1e-6 && -d > a - voxel) tag[idx] = op.tag;
              field[idx] = v;
            } else { if (d > a) field[idx] = d; }
          }
        }
      }
    }
    // seal the border
    for (let kk = 0; kk < nz; kk++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
      if (i===0||j===0||kk===0||i===nx-1||j===ny-1||kk===nz-1) field[i + j*nx + kk*nx*ny] = voxel;
    const net = S.Remesh.surfaceNets(field, dims);
    const pos = net.positions;
    for (let i = 0; i < pos.length; i += 3) { pos[i] = mn[0] + pos[i]*voxel; pos[i+1] = mn[1] + pos[i+1]*voxel; pos[i+2] = mn[2] + pos[i+2]*voxel; }
    const rep = S.splitNonManifoldVertices(pos, net.indices, null);
    obj = obj || M.obj();
    app.history.runMeshOp(obj, 'Clay block-out', () => {
      obj.mesh.setFromArrays(rep.positions, rep.indices, { weld: false });
      obj.mesh.removeDegenerateTriangles(voxel * voxel * 1e-7);
      if (smooth) obj.mesh.smoothAll(smooth, 0.5, false);
      obj.mesh.computeNormals();
    });
    app.afterMeshOp(obj);
    C.grid = { field, tag, mn, voxel, dims };
    C.ops = [];
    if (C.autoPaint) C.paint(C.autoPaint, obj);
    console.log('# clay: grid ' + dims.join('x') + ', ' + M.tris() + ' triangles');
  };
  // tag at a world point: the winning form in the nearest cell (looks a cell around for a set one)
  C.tagAt = function (x, y, z) {
    const g = C.grid, v = g.voxel, [nx, ny, nz] = g.dims;
    const i = Math.round((x - g.mn[0]) / v), j = Math.round((y - g.mn[1]) / v), k = Math.round((z - g.mn[2]) / v);
    let best = 255, bd = 1e9;
    for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i+di, b = j+dj, c = k+dk; if (a<0||b<0||c<0||a>=nx||b>=ny||c>=nz) continue;
      const idx = a + b*nx + c*nx*ny, t = g.tag[idx]; if (t === 255) continue;
      const d = Math.abs(g.field[idx]) + (di*di+dj*dj+dk*dk) * v * 0.01;
      if (d < bd) { bd = d; best = t; }
    }
    return best === 255 ? 'default' : C.tags[best];
  };
  // paint every vertex: fn(tag, x, y, z, nx, ny, nz) -> [r,g,b]
  C.paint = function (fn, obj) {
    obj = obj || M.obj();
    const mesh = obj.mesh, p = mesh.positions.array, nr = mesh.normals.array, c = mesh.colors.array, n = mesh.vertCount(), dead = mesh.vertDead.array;
    for (let v = 0; v < n; v++) {
      if (dead[v]) continue;
      const o = v*3, col = fn(C.tagAt(p[o], p[o+1], p[o+2]), p[o], p[o+1], p[o+2], nr[o], nr[o+1], nr[o+2]);
      c[o] = col[0]; c[o+1] = col[1]; c[o+2] = col[2];
    }
    mesh.dirtyMinVert = 0; mesh.dirtyMaxVert = n - 1; app.afterMeshOp(obj);
  };
  // smooth 3D value noise, for camouflage and grime
  const perm = new Uint8Array(512); { let s = 1234567; const a = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } for (let i = 0; i < 512; i++) perm[i] = a[i & 255]; }
  const fade = t => t*t*(3-2*t), h = (i, j, k) => perm[(perm[(perm[i & 255] + j) & 255] + k) & 255] / 255;
  C.noise = function (x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = fade(x-xi), yf = fade(y-yi), zf = fade(z-zi);
    const L = (a, b, t) => a + (b - a) * t;
    return L(L(L(h(xi,yi,zi), h(xi+1,yi,zi), xf), L(h(xi,yi+1,zi), h(xi+1,yi+1,zi), xf), yf),
             L(L(h(xi,yi,zi+1), h(xi+1,yi,zi+1), xf), L(h(xi,yi+1,zi+1), h(xi+1,yi+1,zi+1), xf), yf), zf);
  };
  C.fbm = (x, y, z, o) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < (o || 3); i++) { s += a * C.noise(x*f, y*f, z*f); a *= 0.5; f *= 2.03; } return s / (1 - Math.pow(0.5, o || 3)); };
})();

(function () {
  const S = window.SCULPT, app = M.app;
  // a fresh, empty object to build a separate piece into
  M.clay.newObject = function (name) {
    const o = new S.SceneObject(name, S.Prim.makeMesh('sphere', 1));
    app.scene.add(o); return o;
  };
  // Join: every object into one mesh, no welding (the Combine menu's Join)
  M.joinAll = function () {
    const sc = app.scene, idx = sc.objects.map((_, i) => i);
    const merged = sc.mergeObjects(idx, 'Soldier');
    for (const o of sc.objects) app.renderer.releaseObject(o);
    sc.objects = [merged]; sc.selected = 0;
    app.refreshObjects(); app.afterMeshOp(merged);
  };
})();
