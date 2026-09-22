// ---- the rifle: a carbine hanging muzzle-down from the right hand ----
{
  const C = M.clay, T = (t, k) => { M.tag = t; M.k = k; };
  const R = C.newObject('Rifle');
  const nrm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const d = nrm([0.05, -1, 0.2]);                         // towards the muzzle
  const w = nrm(cross(d, [0, 0.2, 1]));                   // across the rifle
  const u = cross(w, d);                                   // the top of the rifle (sights) faces forward
  const grip = [-0.278, 0.852, 0.128];
  const O = [0, 1, 2].map(i => grip[i] + d[i] * 0.02 + u[i] * 0.05);    // receiver origin, just above the grip
  const P = (s, t, q) => [0, 1, 2].map(i => O[i] + d[i]*s + u[i]*t + w[i]*(q || 0));
  const B = C.basis(d, u, w);
  const tilt = (deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);   // turned in the d-u plane
    const dd = [0,1,2].map(i => d[i]*c + u[i]*s), uu = [0,1,2].map(i => -d[i]*s + u[i]*c); return C.basis(dd, uu, w); };
  const box = (s, t, q, h, rnd, basis, o) => C.box(P(s, t, q), h, rnd, null, Object.assign({ R: basis || B }, o || {}));
  T('rifle', 0.004);
  box(0.03, 0.0, 0, [0.12, 0.03, 0.016], 0.006);                        // lower + upper receiver
  box(0.03, 0.036, 0, [0.12, 0.007, 0.012], 0.002);                     // top rail
  box(0.3, 0.004, 0, [0.15, 0.026, 0.023], 0.014);                      // handguard
  for (let s = 0.17; s < 0.44; s += 0.03) box(s, 0.03, 0, [0.006, 0.004, 0.012], 0.001);   // rail slots
  C.limb(P(0.44, 0.004), P(0.6, 0.004), 0.008, 0.008);                  // barrel
  C.limb(P(0.585, 0.004), P(0.625, 0.004), 0.011, 0.011);               // muzzle device
  box(0.43, 0.035, 0, [0.006, 0.022, 0.006], 0.002, tilt(-8));           // front sight
  C.limb(P(-0.09, 0.012), P(-0.24, 0.012), 0.014, 0.014);               // buffer tube
  box(-0.24, -0.002, 0, [0.085, 0.034, 0.019], 0.01, tilt(4));           // stock
  box(-0.02, -0.058, 0, [0.017, 0.042, 0.014], 0.007, tilt(-22));        // pistol grip
  box(0.1, -0.1, 0, [0.023, 0.07, 0.012], 0.006, tilt(14));              // magazine
  box(0.03, -0.05, 0, [0.03, 0.012, 0.004], 0.003);                      // trigger guard
  C.cyl(P(0.04, 0.062), 0.017, 0.032, 0.006, null, { R: C.basis(u, d, w) });   // red-dot sight
  box(0.04, 0.045, 0, [0.02, 0.008, 0.012], 0.003);                     // its mount
  C.build(0.0018, 1, R);
}
