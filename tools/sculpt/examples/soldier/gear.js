// ---- head gear: helmet, sunglasses, face wrap (separate pieces, joined at the end) ----
{
  const C = M.clay, T = (t, k) => { M.tag = t; M.k = k; };
  // helmet: a high-cut shell with a rim, rails and a night-vision mount
  const HL = C.newObject('Helmet');
  T('helmet', 0.0);
  C.ell([0, 1.674, -0.012], [0.104, 0.098, 0.12]);
  T('helmet', 0.012);
  C.box([0, 1.56, 0.0], [0.2, 0.078, 0.2], 0, null, { mode: 'subtract' });                  // level cut
  C.box([0, 1.6, 0.12], [0.2, 0.078, 0.06], 0, [-18, 0, 0], { mode: 'subtract' });          // brow cut rising at the front
  for (const s of [-1, 1]) C.ell([0.1*s, 1.625, 0.005], [0.04, 0.045, 0.05], null, { mode: 'subtract' });   // high cut over the ears
  C.ell([0, 1.674, -0.012], [0.09, 0.084, 0.106], null, { mode: 'subtract', k: 0 });      // hollow
  T('rim', 0.004);
  for (const s of [-1, 1]) C.box([0.099*s, 1.66, -0.01], [0.006, 0.012, 0.058], 0.004, [0, 0, 8*s]);   // side rails
  C.box([0, 1.72, 0.103], [0.022, 0.018, 0.012], 0.005, [-35, 0, 0]);                      // NVG shroud
  T('cover', 0.004);
  C.ell([0, 1.742, -0.02], [0.05, 0.02, 0.06]);                                            // cover bunch on top
  { const rnd = (() => { let s = 777; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    for (let i = 0; i < 40; i++) {                                                          // the cover is lumpy where it is gathered
      const th = rnd() * Math.PI * 2, ph = 0.15 + rnd() * 1.1, r = [0.106, 0.1, 0.122];
      const p = [Math.sin(ph) * Math.cos(th) * r[0], 1.674 + Math.cos(ph) * r[1], -0.012 + Math.sin(ph) * Math.sin(th) * r[2]];
      if (p[1] < 1.66 || (p[2] > 0.06 && p[1] < 1.72)) continue;
      C.ell(p, [0.012 + rnd() * 0.012, 0.006, 0.012 + rnd() * 0.012], [rnd() * 40, rnd() * 180, 0], { k: 0.01 });
    } }
  T('strap', 0.003);
  C.torus([0, 1.705, -0.01], 0.103, 0.004, [4, 0, 0]);                                     // band round the helmet
  C.build(0.002, 1, HL);
  // sunglasses
  const G = C.newObject('Glasses');
  T('lens', 0.004);
  for (const s of [-1, 1]) C.box([0.035*s, 1.646, 0.1], [0.029, 0.0155, 0.0035], 0.009, [0, 24*s, -4*s]);   // wraparound lenses
  T('frame', 0.003);
  C.limb([-0.009, 1.653, 0.111], [0.009, 1.653, 0.111], 0.003, 0.003);                     // bridge
  for (const s of [-1, 1]) C.limb([0.064*s, 1.652, 0.086], [0.082*s, 1.65, 0.0], 0.0028, 0.0028);    // arms
  C.build(0.0015, 1, G);
  // face wrap: the head's own forms grown by 6 mm, kept below the eyes — cloth that follows the face
  const W = C.newObject('Wrap');
  headForms(0.006, true, 'scarf');
  T('scarf', 0.01);
  C.box([0, 1.5, 0.02], [0.2, 0.123, 0.2], 0.0, [-10, 0, 0], { mode: 'intersect' });     // top edge runs over the nose
  C.build(0.0025, 2, W);
}
