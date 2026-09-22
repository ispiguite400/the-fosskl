// the head's clay forms; `grow` dilates them all (the face wrap is the head grown by a few millimetres)
function headForms(grow, solidOnly, tagAs) {
  const C = M.clay, T = (t, k) => { M.tag = tagAs || t; M.k = k; };
  const G = (o) => Object.assign({ grow }, o || {});
  T('skin', 0.03);
  C.ell([0, 1.658, -0.014], [0.076, 0.082, 0.096], null, G());                     // cranium
  C.ell([0, 1.618, 0.034], [0.06, 0.072, 0.072], null, G());                       // face mass
  C.limb([0, 1.5, -0.005], [0, 1.585, 0.0], 0.052, 0.05, G());               // neck
  T('skin', 0.02);
  for (const s of [-1, 1]) {
    C.limb([0.062*s, 1.632, -0.012], [0.03*s, 1.566, 0.07], 0.017, 0.013, G());   // jaw line
    C.ell([0.049*s, 1.628, 0.068], [0.021, 0.013, 0.019], null, G());                   // cheekbone
    C.limb([0.038*s, 1.5, 0.03], [0.055*s, 1.605, -0.02], 0.012, 0.012, G());     // neck muscle
  }
  C.limb([-0.043, 1.667, 0.08], [0.043, 1.667, 0.08], 0.013, 0.013, G({ k: 0.015 }));   // brow ridge
  C.ell([0, 1.562, 0.08], [0.023, 0.017, 0.017], null, G());
  if (solidOnly) {                                           // the wrap bridges the nose; skip the fine detail
    C.limb([0, 1.655, 0.09], [0, 1.614, 0.108], 0.006, 0.008, G());
    C.ell([0, 1.612, 0.108], [0.01, 0.009, 0.009], null, G());
    return;
  }                       // chin
  T('skin', 0.012);
  for (const s of [-1, 1]) C.ell([0.031*s, 1.645, 0.1], [0.022, 0.015, 0.019], null, { mode: 'subtract' });  // sockets
  T('eye', 0.004);
  for (const s of [-1, 1]) C.ell([0.031*s, 1.645, 0.083], [0.0128, 0.0128, 0.0128]);   // eyeballs
  T('skin', 0.006);
  for (const s of [-1, 1]) {                                               // lids
    C.limb([0.018*s, 1.649, 0.093], [0.044*s, 1.65, 0.086], 0.0045, 0.004);
    C.limb([0.019*s, 1.64, 0.092], [0.043*s, 1.641, 0.086], 0.0035, 0.003);
  }
  T('skin', 0.006);                                                        // nose (a small part)
  C.limb([0, 1.655, 0.093], [0, 1.614, 0.115], 0.008, 0.011);
  C.ell([0, 1.61, 0.113], [0.012, 0.011, 0.011]);
  for (const s of [-1, 1]) C.ell([0.012*s, 1.607, 0.104], [0.009, 0.008, 0.008]);
  T('lip', 0.005);
  C.ell([0, 1.593, 0.098], [0.019, 0.0055, 0.007]);                       // upper lip
  C.ell([0, 1.584, 0.096], [0.017, 0.006, 0.007]);                     // lower lip
  C.box([0, 1.5885, 0.107], [0.022, 0.0012, 0.012], 0, null, { mode: 'subtract', k: 0.003 });   // mouth line
  T('skin', 0.005);
  for (const s of [-1, 1]) {                                               // ears (small parts)
    C.ell([0.079*s, 1.638, -0.012], [0.009, 0.029, 0.018], [0, 22*s, 0]);
    C.torus([0.086*s, 1.64, -0.012], 0.014, 0.0035, [0, 0, 90*s]);
  }
}
// ---- the head: built up in clay forms like a maquette, then refined with brushes ----
const H = M.clay.newObject('Head');
M.app.scene.selected = M.app.scene.objects.indexOf(H);
{
  headForms(0);
  M.clay.build(0.0022, 2, H);
}
// brush refinement on the face
M.opts({ dyntopo: false, symmetryX: true, strokeSmoothing: 0, pressureRadius: false, pressureStrength: false, falloff: 'smooth', autoSmooth: 0.3 });
M.at([0, 1.62, 0.05], [0, 0, 1], 0.1);
M.stroke('smooth', [[0.0, 1.61], [0.05, 1.63], [0.06, 1.6], [0.02, 1.57]], 0.02, 0.3);   // blend the forms
M.stroke('pinch', [[0.018, 1.62], [0.026, 1.598]], 0.008, 0.25);                          // nasolabial
M.stroke('crease', [[0.017, 1.619], [0.027, 1.598]], 0.006, 0.15);
M.stroke('clay', [[0.028, 1.662], [0.012, 1.656]], 0.009, 0.2);                          // brow furrow inner
M.stroke('crease', [[-0.004, 1.667], [0.004, 1.667]], 0.005, 0.15, {});                   // glabella
M.at([0, 1.62, 0.02], [1, 0, 0.3], 0.1);
M.stroke('flatten', [[-0.02, 1.665], [-0.045, 1.665]], 0.02, 0.25);                       // temple
M.stroke('smooth', [[0.02, 1.6], [-0.02, 1.58]], 0.02, 0.2);
