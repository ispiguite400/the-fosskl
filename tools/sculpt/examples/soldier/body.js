// ===== Soldier — stylised-realistic, from the start =====
M.app.newScene('sphere', 5, true);
M.clay.autoPaint = paintFor;         // each piece is painted as it is built (paint.js)
const C = M.clay, add3 = (a, b, t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
const T = (t, k) => { M.tag = t; M.k = k === undefined ? 0.02 : k; };
// skeleton (metres, feet at y = 0, facing +Z; his right is -X). Walking: right leg forward, rifle in right hand.
const J = {
  hipR: [-0.093, 0.93, 0.015], hipL: [0.093, 0.93, -0.015],
  kneeR: [-0.112, 0.515, 0.085], kneeL: [0.108, 0.52, -0.075],
  ankleR: [-0.12, 0.1, 0.03], ankleL: [0.118, 0.115, -0.16],
  shR: [-0.2, 1.425, -0.005], shL: [0.2, 1.425, -0.015],
  elR: [-0.255, 1.16, 0.05], elL: [0.265, 1.165, -0.06],
  wrR: [-0.275, 0.925, 0.1], wrL: [0.295, 0.935, -0.01]
};
// ---- torso under the kit ----
T('uniform', 0.07);
C.ell([0, 1.31, 0.0], [0.15, 0.17, 0.1]);                 // ribcage
C.ell([0, 1.36, 0.028], [0.155, 0.085, 0.085]);           // chest
C.ell([0, 1.13, 0.012], [0.132, 0.11, 0.092]);            // belly
C.ell([0, 0.985, -0.008], [0.158, 0.1, 0.105]);           // pelvis
for (const s of [-1, 1]) C.ell([0.068*s, 0.925, -0.052], [0.078, 0.088, 0.07]);   // seat
C.limb([0, 1.47, -0.025], [-0.19, 1.43, -0.01], 0.055, 0.045);   // trapezius
C.limb([0, 1.47, -0.025], [0.19, 1.43, -0.02], 0.055, 0.045);
C.limb([0, 1.43, 0.0], [0, 1.555, 0.018], 0.055, 0.05);          // neck
// ---- arms (sleeves) ----
T('uniform', 0.03);
for (const [sh, el, wr, s] of [[J.shR, J.elR, J.wrR, -1], [J.shL, J.elL, J.wrL, 1]]) {
  C.ell(add3(sh, [0, 1.41, 0], -0.05), [0.074, 0.08, 0.076]);            // deltoid
  C.limb(sh, el, 0.064, 0.052);                                          // upper arm
  C.ell(add3(sh, el, 0.5).map((v, i) => v + [0, 0, 0.015][i]), [0.045, 0.08, 0.05]);   // biceps
  C.limb(el, wr, 0.054, 0.04);                                          // forearm
  C.ell(add3(el, wr, 0.3), [0.05, 0.075, 0.048]);                        // forearm mass
}
// ---- legs (trousers) ----
for (const [hip, knee, ank, s] of [[J.hipR, J.kneeR, J.ankleR, -1], [J.hipL, J.kneeL, J.ankleL, 1]]) {
  T('uniform', 0.035);
  C.limb(hip, knee, 0.096, 0.066);                                        // thigh
  C.ell(add3(hip, knee, 0.4).map((v, i) => v + [0.012*s, 0, 0.02][i]), [0.075, 0.13, 0.07]);  // quads
  C.limb(knee, add3(knee, ank, 0.75), 0.065, 0.058);                       // shin
  C.ell(add3(knee, ank, 0.3).map((v, i) => v + [0, 0, -0.02][i]), [0.05, 0.1, 0.055]);        // calf
  T('uniform', 0.012);
  C.box(add3(hip, knee, 0.5).map((v, i) => v + [0.085*s, 0, 0.005][i]), [0.018, 0.075, 0.055], 0.014, [0, 0, -4*s]);   // cargo pocket
  T('pad', 0.01);
  C.ell(knee.map((v, i) => v + [0, 0.005, 0.052][i]), [0.058, 0.072, 0.026], [-8, 0, 0]);       // knee pad
  // ---- boots ----
  T('boot', 0.02);
  const heel = [ank[0], 0.058, ank[2] - 0.05], toe = [ank[0] + 0.014*s, 0.05, ank[2] + 0.185];
  C.limb([ank[0], ank[1] - 0.04, ank[2]], [ank[0], ank[1] + 0.11, ank[2] - 0.005], 0.064, 0.06);   // shaft
  C.limb(heel, toe, 0.058, 0.046);                                        // foot
  C.ell(add3(heel, toe, 0.6).map((v, i) => v + [0, 0.02, 0][i]), [0.058, 0.05, 0.09]);           // instep
  T('boot', 0.004);
  C.limb([ank[0], ank[1] + 0.105, ank[2] - 0.005], [ank[0], ank[1] + 0.125, ank[2] - 0.005], 0.066, 0.066);  // collar
  T('sole', 0.006);
  C.box([ank[0] + 0.007*s, 0.016, ank[2] + 0.065], [0.064, 0.016, 0.158], 0.014);
  T('uniform', 0.03);                                                     // trousers bloused over the boot
  C.limb([ank[0], ank[1] + 0.12, ank[2]], [ank[0], ank[1] + 0.2, ank[2] + 0.01], 0.07, 0.058);
}
// ---- plate carrier ----
T('vest', 0.012);
C.box([0, 1.265, 0.004], [0.165, 0.145, 0.128], 0.045);                   // carrier + cummerbund
C.box([0, 1.3, 0.11], [0.125, 0.13, 0.03], 0.02, [-4, 0, 0]);              // front plate
C.box([0, 1.3, -0.105], [0.125, 0.14, 0.03], 0.02, [4, 0, 0]);             // back plate
for (const s of [-1, 1]) C.limb([0.105*s, 1.405, 0.1], [0.12*s, 1.472, 0.0], 0.022, 0.022), C.limb([0.12*s, 1.472, 0.0], [0.105*s, 1.405, -0.1], 0.022, 0.022);  // shoulder straps
T('pouch', 0.006);
for (const x of [-0.08, 0, 0.08]) C.box([x, 1.175, 0.146], [0.034, 0.05, 0.022], 0.014);    // magazine pouches
C.box([0.075, 1.335, 0.145], [0.03, 0.045, 0.02], 0.012);                   // radio
C.box([-0.07, 1.33, 0.143], [0.04, 0.036, 0.016], 0.012);                    // admin
C.box([0.175, 1.19, 0.02], [0.03, 0.06, 0.05], 0.012, [0, 0, -6]);          // side pouches
C.box([-0.175, 1.19, 0.02], [0.03, 0.06, 0.05], 0.012, [0, 0, 6]);
C.box([0, 1.22, -0.15], [0.09, 0.08, 0.03], 0.02);                          // hydration
// ---- belt and drop holster ----
T('belt', 0.006);
C.box([0, 1.0, -0.004], [0.168, 0.026, 0.118], 0.022);
C.box([0, 1.0, 0.117], [0.03, 0.022, 0.006], 0.004);                        // buckle
T('pouch', 0.008);
C.box([-0.175, 0.86, 0.035], [0.028, 0.085, 0.052], 0.012, [0, 0, 5]);      // holster
C.box([0.165, 0.95, -0.06], [0.03, 0.05, 0.04], 0.01);                      // dump pouch
// ---- hands (gloves) ----
T('glove', 0.012);
// right: a fist round the rifle grip
C.ell([-0.28, 0.87, 0.115], [0.035, 0.05, 0.045], [15, 0, -5]);
C.box([-0.282, 0.838, 0.13], [0.031, 0.03, 0.032], 0.018, [15, 0, -5]);   // curled fingers
C.limb([-0.262, 0.875, 0.14], [-0.262, 0.845, 0.16], 0.014, 0.012);         // thumb
C.limb(J.wrR, [-0.277, 0.905, 0.105], 0.041, 0.04);                          // cuff
// left: relaxed, fingers loosely curled
C.ell([0.3, 0.88, 0.0], [0.03, 0.052, 0.042], [0, 0, 6]);
C.limb([0.302, 0.855, 0.018], [0.298, 0.8, 0.02], 0.016, 0.013);
C.limb([0.3, 0.855, 0.0], [0.3, 0.795, 0.006], 0.016, 0.013);
C.limb([0.298, 0.855, -0.018], [0.297, 0.805, -0.012], 0.015, 0.012);
C.limb([0.285, 0.875, 0.03], [0.28, 0.84, 0.045], 0.014, 0.012);           // thumb
C.limb(J.wrL, [0.297, 0.92, -0.005], 0.041, 0.04);
// ---- scarf round the neck and over the lower face ----
T('scarf', 0.025);
C.torus([0, 1.475, 0.01], 0.068, 0.034, [8, 0, 0]);
C.build(0.005, 1);

