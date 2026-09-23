// ---- brush pass: a crease in the valley beside every fold, seams, flap edges ----
M.opts({ dyntopo: false, symmetryX: false, strokeSmoothing: 0, pressureRadius: false, pressureStrength: false, falloff: 'smooth', autoSmooth: 0.12 });
{
  const V = M.clay.v;
  let n = 0;
  for (const f of M.clay.folds) {
    const mid = f.pts.length >> 1;
    const views = [f.dirs[mid]];
    if (V.dot(f.dirs[0], f.dirs[f.pts.length - 1]) < 0) views.push(f.dirs[0], f.dirs[f.pts.length - 1]);
    for (const vd of views) {
      // the valley sits just below the ridge (down the limb)
      const pts = [];
      for (let i = 0; i < f.pts.length; i++) if (V.dot(f.dirs[i], vd) > 0.4) pts.push(V.addv(f.pts[i], V.mul(f.ax, f.r * 1.05)));
      if (pts.length < 2) continue;
      M.at(pts[pts.length >> 1], vd, 0.2);
      M.wstroke('crease', pts, 0.0075, 0.4 * f.deep); n++;
    }
  }
  console.log('# fold creases', n);
}

// stitching round the plates, ticks of webbing on the belt, seams on the boots and trousers
{
  const S = (dir, pts, r, s) => { M.at(pts[pts.length >> 1], dir, 0.3); M.wstroke('crease', pts, r, s); };
  S([0, 0, 1], [[-0.11, 1.415, 0.14], [0.11, 1.415, 0.14], [0.13, 1.3, 0.14], [0.13, 1.19, 0.14]], 0.004, 0.45);
  S([0, 0, 1], [[-0.11, 1.415, 0.14], [-0.13, 1.3, 0.14], [-0.13, 1.19, 0.14]], 0.004, 0.45);
  S([0, 0, -1], [[-0.12, 1.43, -0.13], [0.12, 1.43, -0.13], [0.13, 1.17, -0.13], [-0.13, 1.17, -0.13], [-0.12, 1.43, -0.13]], 0.004, 0.45);
  for (const dir of [[0, 0, 1], [1, 0, 0.3], [-1, 0, 0.3], [0, 0, -1]]) {
    M.at([0, 1.0, 0], dir, 0.25);
    const r = M.app.camera.right();
    for (let u = -0.16; u <= 0.16; u += 0.026) M.wstroke('crease', [[r[0]*u, 1.018, r[2]*u], [r[0]*u, 0.982, r[2]*u]], 0.003, 0.4);
  }
  for (const [x, z, s] of [[-0.118, 0.075, -1], [0.114, -0.215, 1]]) {
    for (const dir of [[0, 0.3, 1], [s, 0.2, 0], [-s, 0.2, 0], [0, 0.2, -1]]) {
      M.at([x, 0.05, z], dir, 0.14);
      const r = M.app.camera.right();
      M.wstroke('crease', [-0.14, -0.07, 0, 0.07, 0.14].map(u => [x + r[0]*u, 0.038, z + r[2]*u]), 0.0035, 0.45);   // sole welt
    }
    M.at([x, 0.07, z + 0.12], [0, 0.6, 1], 0.1);
    M.wstroke('crease', [[x - 0.05, 0.075, z + 0.1], [x, 0.09, z + 0.12], [x + 0.05, 0.075, z + 0.1]], 0.004, 0.45);   // toe cap seam
    M.at([x, 0.6, 0], [s, 0, 0], 0.4);                                                                             // outer seam of the trousers
    M.wstroke('crease', [[x, 0.9, z * 0.2], [x, 0.7, z * 0.4], [x, 0.5, z * 0.8], [x, 0.3, z]], 0.003, 0.3);
  }
}
