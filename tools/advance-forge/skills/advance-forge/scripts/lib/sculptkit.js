/*
 * sculptkit — drives SculptFree's own tools from a script.
 *
 * Loaded into the app page after it boots. Everything goes through the app:
 * brush strokes through the real stroke engine (M.stroke / M.wstroke / M.pull),
 * shapes through the same signed-distance union the Combine menu uses
 * (M.part / M.seg, then M.weld), and colour into the mesh the paint brush
 * writes to (M.paintParts). Coordinates are world units; the default sphere
 * has radius 0.5 and the model faces +Z.
 */
// Page-side sculpting helpers: think in world space, stroke through the real engine.
(function () {
  const app = window.SCULPT_APP, S = window.SCULPT, cam = app.camera;
  const M = window.M = {};
  M.app = app;
  M.view = function (yaw, pitch, target, halfH) {
    cam.ortho = true; cam.yaw = yaw; cam.pitch = pitch || 0; cam._goal = null;
    cam.target[0] = target[0]; cam.target[1] = target[1]; cam.target[2] = target[2];
    cam.distance = (halfH || 1.6) / Math.tan(cam.fov / 2);
    cam.update();
  };
  M.front = (t, h) => M.view(0, 0, t || [0, -0.9, 0], h);
  M.side = (t, h) => M.view(Math.PI / 2, 0, t || [0, -0.9, 0], h);   // looking from +X
  M.back = (t, h) => M.view(Math.PI, 0, t || [0, -0.9, 0], h);
  M.top = (t, h) => M.view(0, Math.PI / 2 - 0.001, t || [0, -0.9, 0], h);
  M.under = (t, h) => M.view(0, -Math.PI / 2 + 0.001, t || [0, -0.9, 0], h);
  M.px = function (p) { const o = [0, 0, 0]; cam.project(p, o); return [o[0], o[1]]; };
  // screen position of a point given in view-plane coordinates (u right, v up) relative to target
  M.uv = function (u, v) {
    const r = cam.right(), up = cam.up(), f = cam.forward(), t = cam.target;
    const d = t[0] * f[0] + t[1] * f[1] + t[2] * f[2];
    return M.px([f[0] * d + r[0] * u + up[0] * v, f[1] * d + r[1] * u + up[1] * v, f[2] * d + r[2] * u + up[2] * v]);
  };
  M.wpp = () => cam.orthoHeight() * 2 / cam.height;
  M.opts = function (o) { for (const k in o) app.settings[k] = o[k]; };
  // pts: list of [u,v] in view plane (world units). r: world radius.
  M.stroke = function (brush, pts, r, strength, o) {
    o = o || {};
    const st = app.settings;
    st.brush = brush; st.radius = r / M.wpp(); st.strength = strength;
    let sp = pts.map(p => M.uv(p[0], p[1]));
    const inv = !!o.invert;
    // start where the path first lands on the surface, so a stroke can begin off the edge of a form
    let started = false;
    outer: for (let i = 0; i < sp.length; i++) {
      const a = sp[i], b = sp[Math.min(i + 1, sp.length - 1)];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
      for (let k = 0; k < n; k++) {
        const x = a[0] + (b[0] - a[0]) * k / n, y = a[1] + (b[1] - a[1]) * k / n;
        if (app.engine.begin({ x, y, pressure: 1, invert: inv })) { sp = [[x, y]].concat(sp.slice(i + 1)); started = true; break outer; }
      }
    }
    if (!started) { M.log.push('MISS ' + brush + ' ' + JSON.stringify(pts[0])); return false; }
    for (let i = 1; i < sp.length; i++) {
      const a = sp[i - 1], b = sp[i];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(d / (o.step || 3)));
      for (let k = 1; k <= n; k++) app.engine.move({ x: a[0] + (b[0] - a[0]) * k / n, y: a[1] + (b[1] - a[1]) * k / n, pressure: 1, invert: inv });
    }
    if (o.hold) for (let k = 0; k < o.hold; k++) app.engine.move({ x: sp[sp.length - 1][0] + (k % 2), y: sp[sp.length - 1][1], pressure: 1, invert: inv });
    app.engine.end();
    return true;
  };
  M.dab = (brush, p, r, s, o) => M.stroke(brush, [p, [p[0] + 0.004, p[1]]], r, s, o);
  M.log = [];
  M.obj = () => app.scene.objects[0];
  M.tris = () => app.scene.totals().tris;
  M.snap = function () {
    app.cursor && (app.cursor.valid = false);
    app.needsRender = true; app.draw();
    return app.canvas.toDataURL('image/png');
  };
})();
(function(){
  const app = M.app;
  // lowest/extreme vertex along a direction, restricted to a predicate
  M.extreme = function (dir, pred) {
    const mesh = M.obj().mesh, p = mesh.positions.array, n = mesh.vertCount(), dead = mesh.vertDead.array;
    let best = -Infinity, bi = -1;
    for (let i = 0; i < n; i++) {
      const x = p[i*3], y = p[i*3+1], z = p[i*3+2];
      if (dead[i]) continue;
      if (pred && !pred(x, y, z)) continue;
      const d = x*dir[0] + y*dir[1] + z*dir[2];
      if (d > best) { best = d; bi = i; }
    }
    return bi < 0 ? null : [p[bi*3], p[bi*3+1], p[bi*3+2]];
  };
  // world-space stroke: pts are world points; uses current view
  M.wstroke = function (brush, wpts, r, s, o) {
    const cam = app.camera, rt = cam.right(), up = cam.up();
    const uv = wpts.map(w => [w[0]*rt[0]+w[1]*rt[1]+w[2]*rt[2], w[0]*up[0]+w[1]*up[1]+w[2]*up[2]]);
    return M.stroke(brush, uv, r, s, o);
  };
})();
(function(){
  // Pull material step by step with the Move brush. `anchor()` returns the world point to grab each step;
  // views alternate so the pick lands on opposite faces and the pull stays straight.
  M.pull = function (anchor, delta, r, steps, views, brush) {
    views = views || ['front', 'back'];
    for (let i = 0; i < steps; i++) {
      for (const v of views) {
        const a = anchor();
        M[v]([a[0], a[1], a[2]], 2.2);
        const d = delta.map(x => x / views.length);
        // an extreme vertex sits on the silhouette, where a ray can graze past; step inwards until it bites
        const L = Math.hypot(d[0], d[1], d[2]) || 1;
        for (let k = 0; k < 8; k++) {
          const b = [a[0] - d[0] / L * 0.012 * k, a[1] - d[1] / L * 0.012 * k, a[2] - d[2] / L * 0.012 * k];
          const n0 = M.log.length;
          if (M.wstroke(brush || 'move', [b, [b[0] + d[0], b[1] + d[1], b[2] + d[2]]], r, 1)) break;
          M.log.length = n0;
          if (k === 7) M.log.push('MISS pull ' + a.map(v=>v.toFixed(2)));
        }
      }
    }
  };
  M.near = (c, rad) => (x, y, z) => (x-c[0])**2 + (y-c[1])**2 + (z-c[2])**2 < rad*rad;
})();
(function(){
  // extents of the mesh in a horizontal slab around height y (optionally only where pred holds)
  M.section = function (y, h, pred) {
    h = h || 0.03;
    const mesh = M.obj().mesh, p = mesh.positions.array, n = mesh.vertCount(), dead = mesh.vertDead.array;
    let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
    for (let i = 0; i < n; i++) { if (dead[i]) continue; const x=p[i*3],yy=p[i*3+1],z=p[i*3+2];
      if (Math.abs(yy-y)>h) continue; if (pred && !pred(x,yy,z)) continue;
      x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);}
    return [x0,x1,z0,z1].map(v=>+v.toFixed(2));
  };
  M.report = function (ys) { for (const y of ys) console.log('# y=' + y + ' x/z ' + JSON.stringify(M.section(y))); };
})();
(function(){
  const app = M.app, S = window.SCULPT;
  function op(label, fn) { const o = M.obj(); const r = app.history.runMeshOp(o, label, () => fn(o.mesh)); app.afterMeshOp(o); return r; }
  M.symmetrize = () => op('Symmetrise', m => m.symmetrize(0, true));          // copy +X onto -X
  M.remesh = (res, smooth) => op('Voxel remesh', m => S.Remesh.run(m, { resolution: res || 160, smooth: smooth === undefined ? 2 : smooth }));
  M.fix = () => app.repairSurface();
})();
M.left = (t, h) => M.view(-Math.PI / 2, 0, t || [0, -0.9, 0], h);
M.smoothMesh = (n) => { for (let i = 0; i < (n||1); i++) M.app.smoothAll(); };
(function(){
  const app = M.app, S = window.SCULPT, V3 = S.V3;
  const D = Math.PI / 180;
  M.parts = [];
  function makeMesh(prim) {
    if (typeof prim === 'string') return S.Prim.makeMesh(prim, prim === 'sphere' ? 5 : 14);
    const d = S.Prim.cylinder(56, 14, prim.cyl[0], prim.cyl[1], prim.cyl[2]);
    const m = new S.Mesh(); m.setFromArrays(d.positions, d.indices, { weld: true }); return m;
  }
  // queue a shape; nothing is welded until M.weld()
  M.part = function (prim, pos, scale, rotDeg, mode, k) {
    const o = new S.SceneObject('part', makeMesh(prim));
    o.position.set(pos); o.scale.set(Array.isArray(scale) ? scale : [scale, scale, scale]);
    const r = rotDeg || [0, 0, 0];
    S.Q4.fromEuler(o.rotation, r[0] * D, r[1] * D, r[2] * D); o.touch();
    const m = o.mesh.clone(); m.applyMatrix(o.matrix());
    M.parts.push({ mesh: m, mode: mode || 'union', k: k || 0, tag: M.tag });
  };
  M.seg = function (prim, a, b, radius, flare, mode, k) {
    const dx = b[0]-a[0], dy = b[1]-a[1], dz = b[2]-a[2], L = Math.hypot(dx,dy,dz);
    const mid = [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2];
    const rz = Math.atan2(-dx, dy) / D, rx = Math.atan2(dz, Math.hypot(dx, dy)) / D;
    if (prim === 'capsule') return M.part('capsule', mid, [radius / 0.25, L, radius / 0.25], [rx, 0, rz], mode, k);
    return M.part({ cyl: [radius, L, flare || 1] }, mid, 1, [rx, 0, rz], mode, k);
  };
  // The same field union the Combine menu uses, done for every queued part in one grid,
  // so the surface is extracted once instead of re-quantised after every shape.
  M.weld = function (res, smooth) {
    const mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
    for (const p of M.parts) { const a = p.mesh.boundsMin(), b = p.mesh.boundsMax(); for (let i=0;i<3;i++){mn[i]=Math.min(mn[i],a[i]);mx[i]=Math.max(mx[i],b[i]);} }
    const plan = S.Remesh.planFromBounds(mn, mx, res || 300, 3);
    let field = null;
    for (const p of M.parts) {
      const f = S.Remesh.buildField(p.mesh, plan, {});
      if (!field) { field = f; continue; }
      const k = p.k * 1;
      for (let i = 0; i < field.length; i++) {
        const a = field[i], b = f[i];
        if (p.mode === 'union') {
          if (k > 0) { const h = Math.max(k - Math.abs(a - b), 0) / k; field[i] = Math.min(a, b) - h * h * k * 0.25; }
          else if (b < a) field[i] = b;
        } else if (p.mode === 'subtract') { if (-b > a) field[i] = -b; }
        else if (b > a) field[i] = b;
      }
    }
    const net = S.Remesh.surfaceNets(field, plan.dims);
    const pos = net.positions, vx = plan.voxel, org = plan.origin;
    for (let i = 0; i < pos.length; i += 3) { pos[i] = org[0] + pos[i]*vx; pos[i+1] = org[1] + pos[i+1]*vx; pos[i+2] = org[2] + pos[i+2]*vx; }
    const rep = S.splitNonManifoldVertices(pos, net.indices, null);
    const obj = M.obj();
    app.history.runMeshOp(obj, 'Boolean union', () => {
      obj.mesh.setFromArrays(rep.positions, rep.indices, { weld: false });
      obj.mesh.removeDegenerateTriangles(vx * vx * 1e-7);
      obj.mesh.smoothAll(smooth === undefined ? 3 : smooth, 0.5, false);
      obj.mesh.computeNormals();
    });
    app.afterMeshOp(obj);
    M.lastParts = M.parts;
    M.parts = [];
    console.log('# weld voxel ' + vx.toFixed(4) + ' tris ' + M.tris());
  };
})();

(function(){
  const app = M.app;
  // Colour every vertex like the part it came from (the same nearest-surface rule the booleans use
  // to carry colour), then let `over(x,y,z,col)` paint details on top.
  M.paintParts = function (palette, over) {
    const mesh = M.obj().mesh, p = mesh.positions.array, c = mesh.colors.array, n = mesh.vertCount(), dead = mesh.vertDead.array;
    const parts = M.lastParts.filter(q => q.tag);
    for (const q of parts) q.mesh.bounds && q.mesh.bounds();
    const out = [0,0,0];
    for (let v = 0; v < n; v++) {
      if (dead[v]) continue;
      const x = p[v*3], y = p[v*3+1], z = p[v*3+2];
      let best = Infinity, tag = null;
      for (const q of parts) {
        const qp = q.mesh.positions.array;
        for (let r = 0.02; r <= 0.16; r *= 2) {
          const cand = q.mesh.vertsInSphere(x, y, z, r);
          if (!cand.length) continue;
          for (const w of cand) { const d = (qp[w*3]-x)**2 + (qp[w*3+1]-y)**2 + (qp[w*3+2]-z)**2; if (d < best) { best = d; tag = q.tag; } }
          break;
        }
      }
      const col = palette[tag] || palette.default;
      out[0] = col[0]; out[1] = col[1]; out[2] = col[2];
      if (over) over(x, y, z, out, tag);
      c[v*3] = out[0]; c[v*3+1] = out[1]; c[v*3+2] = out[2];
    }
    mesh.dirtyMinVert = 0; mesh.dirtyMaxVert = n - 1;
    app.afterMeshOp(M.obj());
  };
  M.hex = h => [parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255];
})();
// aim the camera at a point from a direction (the side of the surface you want to work on)
M.at = function (p, dir, halfH) {
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  M.view(Math.atan2(dir[0], dir[2]), Math.asin(dir[1] / l), p, halfH || 0.2);
};
