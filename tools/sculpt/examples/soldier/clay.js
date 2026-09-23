/*
 * Clay forms: tapered limbs, ellipsoids and rounded blocks blended with a
 * smooth union, then turned into one surface by the app's own mesher
 * (Remesh.surfaceNets). This is the block-out: the result is a single
 * sculptable mesh for the brushes to work on.
 */
(function () {
  const S = window.SCULPT, app = M.app, D = Math.PI / 180;
  const C = M.clay = { ops: [], tags: [], palette: {}, grids: [], folds: [] };
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
  C.bounds = (op) => bounds(op);
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
    C.grids.push({ g: C.grid, obj });
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

(function () {
  const C = M.clay, app = M.app, S = window.SCULPT;
  const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]], addv = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
  const mul = (a, s) => [a[0]*s, a[1]*s, a[2]*s], dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const norm = (a) => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
  C.v = { sub, addv, mul, dot, cross, norm, lerp: (a, b, t) => addv(a, mul(sub(b, a), t)) };

  // the field of the forms queued so far, at one point (same blending as the build)
  C.fieldAt = function (x, y, z) {
    let a = 1e3;
    for (const op of C.ops) {
      const bx = op._bb || (op._bb = C.bounds(op)), m = op.k + 0.01;
      if (x < bx[0]-m || y < bx[1]-m || z < bx[2]-m || x > bx[3]+m || y > bx[4]+m || z > bx[5]+m) {
        if (op.mode === 'intersect') a = Math.max(a, 1);
        continue;
      }
      const d = C.sdf(op, x, y, z), k = op.k;
      if (op.mode === 'union') {
        if (k > 0) { const h = Math.max(k - Math.abs(a - d), 0) / k; a = Math.min(a, d) - h*h*k*0.25; } else a = Math.min(a, d);
      } else if (op.mode === 'subtract') a = Math.max(a, -d);
      else a = Math.max(a, d);
    }
    return a;
  };
  // where a line from `from` (outside) towards `to` first meets the surface
  C.surf = function (from, to) {
    const N = 48; let prev = from, fp = C.fieldAt(...from);
    for (let i = 1; i <= N; i++) {
      const p = C.v.lerp(from, to, i / N), f = C.fieldAt(...p);
      if (f < 0 && fp >= 0) {
        let lo = prev, hi = p;
        for (let k = 0; k < 20; k++) { const mid = C.v.lerp(lo, hi, 0.5); if (C.fieldAt(...mid) < 0) hi = mid; else lo = mid; }
        return C.v.lerp(lo, hi, 0.5);
      }
      prev = p; fp = f;
    }
    return null;
  };
  // from inside a form, straight out along `dir`: where the surface is first crossed
  C.surfOut = function (c, dir, reach) {
    const N = 60; let prev = c, fp = C.fieldAt(...c);
    if (fp > 0) return null;
    for (let i = 1; i <= N; i++) {
      const p = addv(c, mul(dir, reach * i / N)), f = C.fieldAt(...p);
      if (f >= 0) {
        let lo = prev, hi = p;
        for (let k = 0; k < 20; k++) { const mid = C.v.lerp(lo, hi, 0.5); if (C.fieldAt(...mid) < 0) lo = mid; else hi = mid; }
        return C.v.lerp(lo, hi, 0.5);
      }
      prev = p; fp = f;
    }
    return null;
  };
  /*
   * A cloth fold: a ridge that wraps round a limb (axis a -> b) at parameter t,
   * from angle th0 to th1 (0 = `front`, measured round the axis), tilting by
   * `tilt` metres along the axis across its length and sagging by `sag` in the
   * middle. The ridge sits on the actual surface of the forms queued so far.
   * Each fold is remembered so the brush pass can cut the valley beside it.
   */
  C.fold = function (a, b, t, th0, th1, o) {
    o = o || {};
    const ax = norm(sub(b, a)), P0 = C.v.lerp(a, b, t);
    const front = o.front || [0, 0, 1];
    const e1 = norm(sub(front, mul(ax, dot(front, ax)))), e2 = cross(ax, e1);
    const n = o.n || 11, r = o.r || 0.016, h = o.h || 0.0045, tilt = o.tilt || 0, sag = o.sag || 0;
    const pts = [], dirs = [], us = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), th = th0 + (th1 - th0) * u;
      const c = addv(P0, mul(ax, tilt * (u - 0.5) + sag * Math.sin(Math.PI * u)));
      const dir = addv(mul(e1, Math.cos(th)), mul(e2, Math.sin(th)));
      const s = C.surfOut(c, dir, o.reach || 0.2);
      if (s) { pts.push(s); dirs.push(dir); us.push(u); }
    }
    // a fold is one continuous ridge: stop at any jump (the ray found some other form)
    const step = Math.max(0.02, 2.5 * (o.reach || 0.2) * Math.abs(th1 - th0) / (n - 1));
    for (let i = 1; i < pts.length; i++) if (Math.hypot(...sub(pts[i], pts[i - 1])) > step) { pts.length = dirs.length = us.length = i; break; }
    if (pts.length < 3) return null;
    const centre = (i) => { const w = Math.sin(Math.PI * (0.08 + 0.84 * us[i])), ri = r * (0.3 + 0.7 * w); return [addv(pts[i], mul(dirs[i], h * w - ri)), ri]; };
    const k = o.k === undefined ? 0.012 : o.k;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [p, rp] = centre(i), [q, rq] = centre(i + 1);
      C.limb(p, q, rp, rq, { k, tag: o.tag });
    }
    C.folds.push({ pts, dirs, ax, r, deep: o.deep === undefined ? 1 : o.deep });
    return pts;
  };

  // turn an object about a pivot (the head group looking down a little)
  C.pivotRotate = function (obj, pivot, deg) {
    const D = Math.PI / 180;
    S.Q4.fromEuler(obj.rotation, deg[0] * D, deg[1] * D, deg[2] * D);
    const q = obj.rotation, v = [0, 0, 0];
    S.Q4.rotateVec3(v, q, pivot);
    obj.position[0] = pivot[0] - v[0]; obj.position[1] = pivot[1] - v[1]; obj.position[2] = pivot[2] - v[2];
    obj.touch();
  };

  /*
   * Bake shading into the colour, so the model carries its own light:
   *  - ambient occlusion from the clay fields (every piece's, so the helmet
   *    darkens the head and the vest shadows the shirt),
   *  - cavity from the sculpted surface itself, so every brushed crease gets
   *    a dark line and every ridge a lighter edge.
   */
  C.bakeShading = function (o) {
    o = o || {};
    const mesh = M.obj().mesh, P = mesh.positions.array, Nn = mesh.normals.array, Col = mesh.colors.array;
    const nv = mesh.vertCount(), dead = mesh.vertDead.array, T = mesh.tris.array, tdead = mesh.triDead.array, nt = mesh.triCount();
    const grids = C.grids.map(({ g, obj }) => ({ g, inv: obj.inverseMatrix().slice ? Array.from(obj.inverseMatrix()) : obj.inverseMatrix() }));
    function sample(gr, x, y, z) {
      const m = gr.inv, g = gr.g;
      const lx = m[0]*x + m[4]*y + m[8]*z + m[12], ly = m[1]*x + m[5]*y + m[9]*z + m[13], lz = m[2]*x + m[6]*y + m[10]*z + m[14];
      const fx = (lx - g.mn[0]) / g.voxel, fy = (ly - g.mn[1]) / g.voxel, fz = (lz - g.mn[2]) / g.voxel;
      const [nx, ny, nz] = g.dims;
      if (fx < 0 || fy < 0 || fz < 0 || fx >= nx - 1 || fy >= ny - 1 || fz >= nz - 1) return 1e3;
      const i = fx | 0, j = fy | 0, k = fz | 0, u = fx - i, v = fy - j, w = fz - k, F = g.field, sy = nx, sz = nx * ny, b = i + j*sy + k*sz;
      const c00 = F[b] + (F[b+1] - F[b]) * u, c10 = F[b+sy] + (F[b+sy+1] - F[b+sy]) * u;
      const c01 = F[b+sz] + (F[b+sz+1] - F[b+sz]) * u, c11 = F[b+sy+sz] + (F[b+sy+sz+1] - F[b+sy+sz]) * u;
      return (c00 + (c10 - c00) * v) * (1 - w) + (c01 + (c11 - c01) * v) * w;
    }
    const field = (x, y, z) => { let f = 1e3; for (const gr of grids) { const s = sample(gr, x, y, z); if (s < f) f = s; } return f; };
    const steps = o.steps || [0.006, 0.013, 0.024, 0.04, 0.065, 0.1];
    const ao = new Float32Array(nv);
    for (let v = 0; v < nv; v++) {
      if (dead[v]) continue;
      const x = P[v*3], y = P[v*3+1], z = P[v*3+2], nx = Nn[v*3], ny = Nn[v*3+1], nz = Nn[v*3+2];
      let occ = 0, wsum = 0;
      for (let i = 0; i < steps.length; i++) {
        const d = steps[i], f = field(x + nx*d, y + ny*d, z + nz*d), wgt = 1 / (1 + i * 0.6);
        occ += Math.max(0, Math.min(1, (d - f) / d)) * wgt; wsum += wgt;
      }
      ao[v] = occ / wsum;
    }
    // cavity: how far each vertex sits below the average of its neighbours, along its normal
    const sum = new Float32Array(nv * 3), cnt = new Float32Array(nv), elen = new Float32Array(nv);
    for (let t = 0; t < nt; t++) {
      if (tdead[t]) continue;
      for (let e = 0; e < 3; e++) {
        const a = T[t*3+e], b = T[t*3+(e+1)%3];
        sum[a*3] += P[b*3]; sum[a*3+1] += P[b*3+1]; sum[a*3+2] += P[b*3+2]; cnt[a]++;
        sum[b*3] += P[a*3]; sum[b*3+1] += P[a*3+1]; sum[b*3+2] += P[a*3+2]; cnt[b]++;
        const L = Math.hypot(P[a*3]-P[b*3], P[a*3+1]-P[b*3+1], P[a*3+2]-P[b*3+2]); elen[a] += L; elen[b] += L;
      }
    }
    let cav = new Float32Array(nv);
    for (let v = 0; v < nv; v++) {
      if (dead[v] || !cnt[v]) continue;
      const ax = sum[v*3]/cnt[v] - P[v*3], ay = sum[v*3+1]/cnt[v] - P[v*3+1], az = sum[v*3+2]/cnt[v] - P[v*3+2];
      cav[v] = (ax*Nn[v*3] + ay*Nn[v*3+1] + az*Nn[v*3+2]) / (elen[v] / cnt[v] + 1e-9);
    }
    // blur the cavity a couple of times over the mesh, so it reads as shading rather than noise
    for (let it = 0; it < (o.blur === undefined ? 2 : o.blur); it++) {
      const acc = new Float32Array(nv), c2 = new Float32Array(nv);
      for (let t = 0; t < nt; t++) { if (tdead[t]) continue; for (let e = 0; e < 3; e++) { const a = T[t*3+e], b = T[t*3+(e+1)%3]; acc[a] += cav[b]; c2[a]++; acc[b] += cav[a]; c2[b]++; } }
      for (let v = 0; v < nv; v++) if (c2[v]) cav[v] = cav[v] * 0.4 + 0.6 * acc[v] / c2[v];
    }
    const kA = o.ao === undefined ? 1.1 : o.ao, kD = o.dark === undefined ? 5 : o.dark, kL = o.light === undefined ? 2.5 : o.light;
    for (let v = 0; v < nv; v++) {
      if (dead[v]) continue;
      let f = Math.max(0.3, 1 - kA * ao[v]);
      const c = cav[v];
      f *= c > 0 ? Math.max(0.35, 1 - kD * c) : Math.min(1.35, 1 - kL * c);
      if (o.floor) f *= 1 - Math.max(0, 0.12 - P[v*3+1]) * o.floor;    // a little contact shadow near the ground
      for (let k = 0; k < 3; k++) Col[v*3+k] = Math.min(1, Col[v*3+k] * f);
    }
    mesh.dirtyMinVert = 0; mesh.dirtyMaxVert = nv - 1; app.afterMeshOp(M.obj());
  };
})();
