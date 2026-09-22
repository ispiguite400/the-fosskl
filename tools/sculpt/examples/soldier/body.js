// ===== Soldier v3: the body =====
M.app.newScene('sphere', 5, true);
const C = M.clay, V = C.v;
const L3 = (a, b, t) => V.lerp(a, b, t), off = (p, d) => V.addv(p, d);
const T = (t, k) => { M.tag = t; M.k = k === undefined ? 0.02 : k; };
const rnd = (() => { let s = 20240922; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const R = (a, b) => a + (b - a) * rnd();
// skeleton: metres, feet at y = 0, facing +Z, his right is -X. Right leg forward, left pushing off;
// the right hand carries the rifle, the left arm swings forward a little.
const J = {
  hipR: [-0.094, 0.935, 0.02], hipL: [0.094, 0.935, -0.02],
  kneeR: [-0.108, 0.525, 0.125], kneeL: [0.106, 0.52, -0.075],
  ankleR: [-0.118, 0.105, 0.075], ankleL: [0.114, 0.128, -0.215],
  shR: [-0.198, 1.425, -0.005], shL: [0.198, 1.42, -0.02],
  elR: [-0.25, 1.165, 0.025], elL: [0.262, 1.175, -0.02],
  wrR: [-0.268, 0.935, 0.105], wrL: [0.274, 0.955, 0.13]
};
const sides = [
  { s: -1, hip: J.hipR, knee: J.kneeR, ank: J.ankleR, sh: J.shR, el: J.elR, wr: J.wrR, footPitch: 0 },
  { s: 1, hip: J.hipL, knee: J.kneeL, ank: J.ankleL, sh: J.shL, el: J.elL, wr: J.wrL, footPitch: 13 }
];

// ---------------- torso under the kit ----------------
T('uniform', 0.07);
C.ell([0, 1.31, 0.0], [0.152, 0.17, 0.104]);                // ribcage
C.ell([0, 1.36, 0.03], [0.158, 0.085, 0.088]);              // chest
C.ell([0, 1.13, 0.014], [0.138, 0.112, 0.097]);             // belly
C.ell([0, 0.985, -0.006], [0.162, 0.102, 0.108]);           // pelvis
for (const s of [-1, 1]) C.ell([0.068*s, 0.925, -0.05], [0.08, 0.09, 0.072]);   // seat
T('uniform', 0.05);
C.limb([0, 1.47, -0.025], [-0.19, 1.43, -0.01], 0.058, 0.048);   // trapezius
C.limb([0, 1.47, -0.025], [0.19, 1.425, -0.025], 0.058, 0.048);
C.limb([0, 1.43, 0.0], [0, 1.54, 0.012], 0.056, 0.052);          // neck
C.ell([0, 1.44, 0.035], [0.06, 0.03, 0.04]);                     // collar front

// ---------------- limbs ----------------
for (const L of sides) {
  const { s, hip, knee, ank, sh, el, wr } = L;
  // sleeves: deltoid, upper arm, biceps, forearm; the cloth is roomy
  T('uniform', 0.035);
  C.ell(L3(sh, [0, 1.41, 0], -0.02), [0.07, 0.078, 0.074]);
  C.limb(sh, el, 0.063, 0.055);
  C.ell(off(L3(sh, el, 0.5), [0, 0, 0.016]), [0.05, 0.085, 0.055]);
  C.limb(el, L3(el, wr, 0.92), 0.058, 0.046);
  C.ell(L3(el, wr, 0.28), [0.055, 0.08, 0.052]);
  C.torus(L3(el, wr, 0.9), 0.046, 0.009, [0, 0, 0]);               // sleeve bunched at the cuff
  // trousers: roomy thigh and knee, bloused over the boot
  T('uniform', 0.04);
  C.limb(hip, knee, 0.102, 0.072);
  C.ell(off(L3(hip, knee, 0.42), [0.014*s, 0, 0.018]), [0.082, 0.14, 0.078]);
  C.limb(knee, L3(knee, ank, 0.72), 0.072, 0.064);
  C.ell(off(L3(knee, ank, 0.3), [0, 0, -0.022]), [0.056, 0.105, 0.06]);
  const top = off(ank, [0, 0.1, -0.005]);
  C.limb(L3(knee, ank, 0.68), off(top, [0, 0.03, 0.01]), 0.066, 0.074);   // blousing
}

// ---------------- cloth folds (broad soft ridges on the real surface) ----------------
T('uniform');
const PI = Math.PI;
// a fold with some randomness in where it starts and ends, how far it tilts and how deep it is
const fold = (a, b, t, th0, th1, o) => C.fold(a, b, t, th0 + R(-0.25, 0.25), th1 + R(-0.25, 0.25),
  Object.assign({ r: R(0.013, 0.02), h: R(0.003, 0.0055), sag: R(-0.01, 0.01) }, o));
for (const L of sides) {
  const { s, hip, knee, ank, sh, el, wr } = L;
  const inner = s * PI / 2, outer = -s * PI / 2;      // angle round the limb (0 = front)
  // thigh front: long diagonal pulls from the crotch towards the outer knee
  for (const t of [0.22, 0.4, 0.56]) fold(hip, knee, t + R(-0.04, 0.04), inner * 0.8, outer * 0.5, { tilt: 0.1 });
  fold(hip, knee, 0.12, inner * 1.1, inner * 0.1, { tilt: 0.06, n: 7 });                 // crotch
  fold(hip, knee, 0.7, outer * 0.3, outer * 1.3, { tilt: 0.04, h: 0.004 });              // outer thigh under the pocket
  // behind the knee: a few zig-zag folds
  fold(hip, knee, 0.86, PI - 1.0, PI + 0.8, { tilt: R(-0.04, 0.04), h: 0.006 });
  fold(knee, ank, 0.07, PI - 0.8, PI + 1.0, { tilt: R(-0.04, 0.04), h: 0.006 });
  // shin: one twist, then the cloth stacks where it is bloused into the boot
  fold(knee, ank, 0.3, inner * 0.7, outer * 1.1, { tilt: -0.07 });
  for (const t of [0.58, 0.68, 0.77]) fold(knee, ank, t + R(-0.015, 0.015), R(-2.4, -0.8), R(0.8, 2.4), { tilt: R(-0.03, 0.03), h: R(0.004, 0.006) });
  // sleeves: a twist down the upper arm, bunching inside the elbow, a pull on the forearm, stacking at the cuff
  fold(sh, el, 0.3, inner, outer * 0.5 + 0.6, { tilt: 0.08 });
  fold(sh, el, 0.55, outer * 1.2, inner * 0.3, { tilt: -0.07 });
  fold(sh, el, 0.7, inner * 0.8, outer * 0.8, { tilt: 0.06, h: 0.004 });
  fold(sh, el, 0.86, -1.0, 1.1, { tilt: R(-0.03, 0.03), h: 0.005 });
  fold(el, wr, 0.1, -1.1, 0.9, { tilt: R(-0.03, 0.03), h: 0.005 });
  fold(el, wr, 0.42, inner * 0.9, outer * 0.6, { tilt: 0.07 });
  fold(el, wr, 0.74, -2.2, 2.0, { tilt: R(-0.02, 0.02), h: 0.004 });
}
// shirt bunched between the plate carrier and the belt
for (const [t, th0, th1] of [[0.3, -2.0, 0.4], [0.55, -0.3, 2.2], [0.4, 2.4, 3.9]])
  fold([0, 1.12, 0.01], [0, 1.03, 0.0], t, th0, th1, { tilt: R(-0.02, 0.02), reach: 0.25 });

// ---------------- plate carrier ----------------
T('vest', 0.012);
C.box([0, 1.265, 0.004], [0.168, 0.148, 0.13], 0.048);                       // carrier + cummerbund
C.box([0, 1.3, 0.113], [0.126, 0.132, 0.03], 0.022, [-4, 0, 0]);               // front plate
C.box([0, 1.3, -0.108], [0.126, 0.142, 0.03], 0.022, [4, 0, 0]);               // back plate
for (const s of [-1, 1]) {
  C.limb([0.1*s, 1.41, 0.105], [0.118*s, 1.475, 0.0], 0.025, 0.026);          // shoulder straps
  C.limb([0.118*s, 1.475, 0.0], [0.1*s, 1.41, -0.105], 0.026, 0.025);
  T('strap', 0.006);
  C.box([0.119*s, 1.462, 0.0], [0.03, 0.012, 0.06], 0.01, [0, 0, -12*s]);        // shoulder pads
  T('vest', 0.012);
}
C.limb([-0.03, 1.44, -0.13], [0.03, 1.44, -0.13], 0.008, 0.008);             // drag handle
// webbing rows on the cummerbund and back plate
T('webbing', 0.002);
for (let y = 1.16; y <= 1.37; y += 0.027) {
  for (const s of [-1, 1]) C.box([0.17*s, y, 0.0], [0.006, 0.0055, 0.085], 0.002);
  C.box([0, y, -0.14], [0.11, 0.0055, 0.006], 0.002);
}
// pouches, each with its flap
const pouch = (c, h, flap) => {
  T('pouch', 0.006); C.box(c, h, 0.013);
  T('flap', 0.003);  C.box([c[0], c[1] + h[1] - 0.012, c[2] + 0.004], [h[0] + 0.003, 0.016, h[2] - 0.002], 0.006);
  if (flap !== false) { T('buckle', 0.001); C.box([c[0], c[1] + h[1] - 0.026, c[2] + h[2] + 0.005], [0.007, 0.0045, 0.0025], 0.0015); }
};
for (const x of [-0.08, 0, 0.08]) {
  pouch([x, 1.178, 0.147], [0.034, 0.052, 0.022]);                                   // rifle magazines
  T('strap', 0.001); C.limb([x - 0.016, 1.2, 0.171], [x - 0.016, 1.135, 0.171], 0.0022, 0.0022);   // bungee cord
  C.limb([x + 0.016, 1.2, 0.171], [x + 0.016, 1.135, 0.171], 0.0022, 0.0022);
}
T('webbing', 0.002);                                                                    // webbing across the plate between the pouches
for (const y of [1.255, 1.28]) C.box([0, y, 0.146], [0.115, 0.0055, 0.004], 0.002);
T('flap', 0.002); C.box([0, 1.4, 0.139], [0.045, 0.011, 0.003], 0.002, [-6, 0, 0]);       // name tape
T('rifle', 0.003); C.cyl([0.1, 1.43, 0.12], 0.01, 0.028, 0.003, [-60, 0, 0]);            // light on the shoulder strap
T('buckle', 0.001); C.torus([-0.105, 1.42, 0.118], 0.012, 0.0025, [0, 0, 90]);          // carabiner
pouch([-0.072, 1.338, 0.145], [0.042, 0.038, 0.018]);                                 // admin
pouch([0.078, 1.34, 0.147], [0.03, 0.048, 0.021]);                                    // radio
T('rifle', 0.002); C.limb([0.09, 1.39, 0.15], [0.12, 1.53, 0.1], 0.003, 0.0025);      // radio antenna
C.limb([0.068, 1.39, 0.15], [0.07, 1.4, 0.15], 0.006, 0.006);                          // radio knob
for (const s of [-1, 1]) { T('pouch', 0.006); C.cyl([0.178*s, 1.205, 0.045], 0.03, 0.045, 0.012, [0, 0, 0]); }   // grenades
T('pouch', 0.008); C.box([0.0, 1.235, -0.16], [0.095, 0.1, 0.028], 0.022);                // hydration carrier
T('strap', 0.004); C.limb([-0.06, 1.33, -0.17], [-0.13, 1.47, -0.05], 0.006, 0.006);       // drinking tube over the shoulder
C.limb([-0.13, 1.47, -0.05], [-0.115, 1.4, 0.12], 0.006, 0.006);
T('pouch', 0.005); C.box([-0.13, 1.25, 0.135], [0.012, 0.055, 0.008], 0.005, [0, 0, -20]);  // knife
T('rifle', 0.003); C.limb([-0.118, 1.305, 0.141], [-0.105, 1.34, 0.14], 0.008, 0.007);     // its handle

// ---------------- battle belt and drop-leg holster ----------------
T('belt', 0.008);
C.box([0, 1.0, -0.004], [0.172, 0.03, 0.122], 0.026);
T('buckle', 0.002); C.box([0, 1.0, 0.121], [0.03, 0.02, 0.006], 0.004);
T('pouch', 0.007);
C.box([0.17, 0.955, -0.06], [0.032, 0.058, 0.045], 0.016);                     // dump pouch
C.cyl([0.1, 0.985, -0.14], 0.04, 0.05, 0.014);                                 // canteen
C.box([-0.12, 0.99, -0.13], [0.04, 0.035, 0.025], 0.012);                      // first-aid pouch
{ // holster on the right thigh, hanging from the belt, strapped round the leg
  const { hip, knee } = sides[0];
  const c = off(L3(hip, knee, 0.33), [-0.1, 0, 0.02]);
  T('strap', 0.004); C.box(off(c, [0.004, 0.11, -0.005]), [0.012, 0.06, 0.018], 0.005);       // hanger
  T('pouch', 0.008); C.box(c, [0.028, 0.085, 0.05], 0.014, [8, 0, 4]);
  T('rifle', 0.004); C.box(off(c, [0, 0.085, -0.012]), [0.014, 0.03, 0.022], 0.007, [-15, 0, 4]);   // pistol grip
  T('strap', 0.003);
  for (const t of [0.3, 0.52]) C.fold(hip, knee, t, -3.12, 3.12, { r: 0.006, h: 0.004, n: 28, tag: 'strap', k: 0.003, reach: 0.2 });
}

// ---------------- knee pads ----------------
for (const L of sides) {
  const { knee, hip, ank } = L;
  const fwd = V.norm(V.cross([1, 0, 0], V.sub(ank, hip))).map(v => -v);
  T('pad', 0.008); C.ell(off(knee, V.mul(fwd, 0.062)), [0.056, 0.072, 0.024], [-8 + (L.s < 0 ? -8 : 6), 0, 0]);
  T('strap', 0.003);
  C.fold(L.hip, knee, 0.88, -3.12, 3.12, { r: 0.0055, h: 0.0035, n: 28, tag: 'strap', k: 0.003, reach: 0.2 });
  C.fold(knee, ank, 0.13, -3.12, 3.12, { r: 0.0055, h: 0.0035, n: 28, tag: 'strap', k: 0.003, reach: 0.2 });
}

// ---------------- boots ----------------
for (const L of sides) {
  const { s, ank, footPitch } = L;
  const pitch = footPitch * PI / 180;
  const fwd = [0.07 * s, -Math.sin(pitch), Math.cos(pitch)], up = [0, Math.cos(pitch), Math.sin(pitch)];
  const at = (f, u) => V.addv(V.addv([ank[0], 0, ank[2]], V.mul(fwd, f)), [0, u + (footPitch ? 0.02 + f * Math.sin(pitch) * -0 : 0), 0]);
  const heel = [ank[0], (footPitch ? 0.095 : 0.07), ank[2] - 0.048];
  const toe = V.addv(heel, V.mul(fwd, 0.225));
  toe[1] = footPitch ? 0.058 : 0.062;
  const mid = L3(heel, toe, 0.5), yaw = Math.atan2(fwd[0], fwd[2]) * 180 / PI, rot = [footPitch, yaw, 0];
  const my = footPitch ? 0.078 : 0.072, sy = footPitch ? 0.034 : 0.021;
  T('boot', 0.022);
  C.limb(off(ank, [0, -0.03, 0]), off(ank, [0, 0.12, -0.005]), 0.064, 0.062);       // shaft
  C.box([mid[0], my, mid[2]], [0.054, 0.036, 0.132], 0.03, rot);                      // foot: a rounded block with real sides
  C.ell([mid[0], my + 0.03, mid[2] + 0.02], [0.052, 0.04, 0.085], rot);                // instep
  T('boot', 0.006);
  C.ell(off(L3(heel, toe, 0.93), [0, footPitch ? -0.018 : -0.002, 0]), [0.05, 0.034, 0.045], rot);   // toe cap
  C.ell(off(heel, [0, -0.005, -0.015]), [0.05, 0.048, 0.03]);                        // heel counter
  C.limb(off(ank, [0, 0.118, -0.005]), off(ank, [0, 0.13, -0.005]), 0.068, 0.068);   // padded collar
  T('sole', 0.004);                                                                  // the sole: same outline, a lip wider
  C.box([mid[0], sy, mid[2]], [0.059, 0.02, 0.156], 0.016, rot);
  C.box([heel[0], sy + 0.002, heel[2] - 0.01], [0.055, 0.023, 0.05], 0.014, rot);    // heel block
  // laces: crossed ridges up the front
  T('lace', 0.002);
  for (let i = 0; i < 6; i++) {
    const y = ank[1] + 0.005 + i * 0.022 - (i < 2 ? 0 : 0), z = ank[2] + 0.062 - i * 0.004 + (i < 2 ? 0.03 - i * 0.015 : 0);
    C.limb([ank[0] - 0.02, y, z], [ank[0] + 0.02, y + 0.014, z], 0.0028, 0.0028);
    C.limb([ank[0] + 0.02, y, z], [ank[0] - 0.02, y + 0.014, z], 0.0028, 0.0028);
  }
  // trousers bloused over the top
  T('uniform', 0.025);
  C.limb(off(ank, [0, 0.13, 0.0]), off(ank, [0, 0.2, 0.012]), 0.075, 0.066);
}

// ---------------- gloves ----------------
T('glove', 0.012);
// right hand: fingers wrapped round the rifle's pistol grip
{
  const w = J.wrR;
  C.ell(off(w, [-0.006, -0.055, 0.02]), [0.032, 0.05, 0.043], [18, 0, -5]);             // palm
  for (let i = 0; i < 4; i++) {
    const y = w[1] - 0.075 - i * 0.019;
    C.limb([w[0] - 0.02, y, w[2] + 0.045], [w[0] - 0.012, y - 0.004, w[2] + 0.068], 0.0105, 0.0095);   // knuckle to middle
    C.limb([w[0] - 0.012, y - 0.004, w[2] + 0.068], [w[0] + 0.012, y - 0.006, w[2] + 0.066], 0.0095, 0.009);   // curled tips
  }
  C.limb(off(w, [0.012, -0.045, 0.045]), off(w, [0.02, -0.075, 0.075]), 0.012, 0.01);    // thumb
  T('pad', 0.004); C.box(off(w, [-0.03, -0.075, 0.035]), [0.006, 0.03, 0.02], 0.005, [18, 0, -5]);   // knuckle pad
  T('glove', 0.012); C.limb(w, off(w, [0, -0.03, 0.01]), 0.044, 0.043);                   // cuff
}
// left hand: relaxed, fingers loosely curled forward
{
  const w = J.wrL;
  C.ell(off(w, [0.004, -0.05, 0.01]), [0.03, 0.052, 0.042], [10, 0, 6]);
  for (let i = 0; i < 4; i++) {
    const z = w[2] + 0.03 - i * 0.02, x = w[0] + 0.012;
    C.limb([x, w[1] - 0.09, z], [x, w[1] - 0.13, z + 0.012], 0.0105, 0.0095);
    C.limb([x, w[1] - 0.13, z + 0.012], [x - 0.004, w[1] - 0.15, z + 0.03], 0.0095, 0.0085);
  }
  C.limb(off(w, [-0.01, -0.04, 0.04]), off(w, [-0.016, -0.075, 0.058]), 0.012, 0.01);
  T('pad', 0.004); C.box(off(w, [0.03, -0.07, 0.012]), [0.006, 0.03, 0.022], 0.005, [10, 0, 6]);
  T('glove', 0.012); C.limb(w, off(w, [0, -0.03, 0.005]), 0.044, 0.043);
}

// ---------------- shemagh, bunched round the neck and over the collar ----------------
T('scarf', 0.02);
C.torus([0, 1.49, 0.01], 0.07, 0.03, [10, 0, 0]);
C.torus([0, 1.458, 0.005], 0.085, 0.03, [6, 0, 0]);
C.ell([0, 1.44, 0.075], [0.07, 0.05, 0.035], [-20, 0, 0]);
C.ell([0.02, 1.38, 0.12], [0.045, 0.06, 0.02], [-10, 0, 10]);        // the loose end hanging over the carrier
for (const t of [0.25, 0.6]) C.fold([0, 1.5, 0.0], [0, 1.44, 0.0], t, R(-2.2, -1.2), R(1.2, 2.2), { r: 0.014, h: 0.006, tilt: R(-0.03, 0.03), sag: R(-0.012, 0.012), n: 13, tag: 'scarf', reach: 0.18 });

C.build(0.004, 1);
