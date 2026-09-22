// ---- the rifle, carried by the receiver in the right hand, muzzle down ----
{
  const C = M.clay, T = (t, k) => { M.tag = t; M.k = k; };
  const R = C.newObject('Rifle');
  const nrm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const d = nrm([0.02, -1, 0.1]);                                     // towards the muzzle
  const dx = d[0]; const u = nrm([1 - d[0]*dx, -d[1]*dx, -d[2]*dx]);   // top of the rifle, towards his leg
  const w = cross(d, u);
  const hand = [-0.264, 0.834, 0.158];
  const O = [0, 1, 2].map(i => hand[i] - d[i] * 0.06);
  const P = (s, t, q) => [0, 1, 2].map(i => O[i] + d[i]*s + u[i]*t + w[i]*(q || 0));
  const B = C.basis(d, u, w);
  const tilt = (deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const dd = [0,1,2].map(i => d[i]*c + u[i]*s), uu = [0,1,2].map(i => -d[i]*s + u[i]*c); return C.basis(dd, uu, w); };
  const box = (s, t, q, h, rnd, basis) => C.box(P(s, t, q), h, rnd, null, { R: basis || B });
  T('rifle', 0.004);
  box(0.03, 0.0, 0, [0.12, 0.028, 0.015], 0.006);                        // receivers
  box(0.03, 0.034, 0, [0.12, 0.007, 0.011], 0.002);                      // top rail
  for (let s = -0.07; s < 0.15; s += 0.012) box(s, 0.041, 0, [0.0035, 0.003, 0.011], 0.001);
  box(0.3, 0.004, 0, [0.15, 0.025, 0.022], 0.013);                       // handguard
  for (let s = 0.17; s < 0.44; s += 0.024) box(s, 0.029, 0, [0.005, 0.004, 0.012], 0.001);
  for (const q of [-1, 1]) for (let s = 0.18; s < 0.44; s += 0.03) box(s, 0.004, 0.022 * q, [0.008, 0.012, 0.003], 0.002);   // vents
  C.limb(P(0.44, 0.004), P(0.6, 0.004), 0.008, 0.008);                   // barrel
  C.limb(P(0.585, 0.004), P(0.628, 0.004), 0.011, 0.011);                // muzzle device
  box(0.43, 0.035, 0, [0.006, 0.022, 0.006], 0.002, tilt(-8));            // front sight
  C.limb(P(-0.09, 0.012), P(-0.24, 0.012), 0.014, 0.014);                // buffer tube
  box(-0.245, -0.002, 0, [0.085, 0.034, 0.019], 0.01, tilt(4));           // stock
  box(-0.02, -0.058, 0, [0.017, 0.042, 0.014], 0.007, tilt(-22));         // pistol grip
  box(0.1, -0.1, 0, [0.023, 0.07, 0.012], 0.006, tilt(14));               // magazine
  box(0.03, -0.05, 0, [0.03, 0.012, 0.004], 0.003);                       // trigger guard
  C.cyl(P(0.04, 0.062), 0.017, 0.032, 0.006, null, { R: C.basis(u, d, w) });   // red-dot sight
  box(0.04, 0.045, 0, [0.02, 0.008, 0.012], 0.003);
  C.build(0.0018, 1, R);
}
