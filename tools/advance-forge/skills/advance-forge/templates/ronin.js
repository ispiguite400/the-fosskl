/*
 * TEMPLATE — a ronin, the worked example for Advance Forge.
 *
 * Build it:   node ../scripts/forge.mjs build ronin.js --out out --name ronin --close "0.4,0.05,1.6,0.16"
 * Rig it:     node ../scripts/rig.mjs out/ronin.sculpt --out out --joints ronin_joints.json
 * Animate:    node ../scripts/animate.mjs out/ronin_rigged.glb --out out --bake
 *
 * Copy this file for a new character and change the forms, not the order.
 * The order IS the method:
 *   1. skeleton      joints first; everything hangs off them
 *   2. anatomy       a body under the clothes, in masses (ribcage, pelvis, deltoid...)
 *   3. clothing      clothes are the body grown outward, plus their own shapes
 *   4. folds         ridges placed on the real surface, from how the cloth hangs
 *   5. kit           belts, straps, armour, props (props as separate pieces)
 *   6. head          separate object, built from facial forms, then brushed
 *   7. join          one mesh; props stay separate pieces so they ride one bone
 *   8. brush pass    a crease in every fold valley, seams, stitching
 *   9. paint+shade   colours by part, pattern, wear, then baked shading
 *
 * Neutral stance: feet under the hips, knees straight, arms hanging about
 * 15 degrees out from the body with a clear gap. That is the pose that rigs
 * cleanly and that the game's walk cycle expects. Units are metres, feet at
 * y = 0, facing +Z, the character's left is +X.
 */
M.app.newScene('sphere', 5, true);
const C = M.clay, V = C.v;
const L3 = (a, b, t) => V.lerp(a, b, t), off = (p, d) => V.addv(p, d);
const T = (t, k) => { M.tag = t; M.k = k === undefined ? 0.02 : k; };
const rnd = (() => { let s = 777331; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const R = (a, b) => a + (b - a) * rnd();
const PI = Math.PI;

/* ---------------- 0. palette (paint happens as each piece is built) ---------------- */
const HEX = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const mix = (a, b, t) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * Math.max(0, Math.min(1, t)));
const N = (x, y, z, f) => C.noise(x * f, y * f, z * f), F = (x, y, z, f, o) => C.fbm(x * f, y * f, z * f, o || 3);
const P = {
  gi: HEX('#2f3a4c'), giDark: HEX('#1f2734'), hakama: HEX('#3c3431'), hakamaDark: HEX('#29221f'), obi: HEX('#7a2a22'),
  under: HEX('#d8cfbd'), skin: HEX('#c9976f'), lip: HEX('#9c5e4d'), eye: HEX('#e6dfd2'), hair: HEX('#17130f'),
  straw: HEX('#b99a5c'), tabi: HEX('#d9d2c2'), cord: HEX('#6b4a2a'), saya: HEX('#1a1614'), tsuka: HEX('#2a2420'),
  ito: HEX('#6e2019'), metal: HEX('#8d8f93'), dust: HEX('#a8987a')
};
// cloth: a slow tonal drift, a fine weave, and dust that climbs from the ground
function cloth(c, x, y, z, dust) {
  c = mix(c, c.map((v) => v * 0.78), F(x, y, z, 6) * 1.2 - 0.3);
  c = c.map((v) => v * (1 + (N(x, y, z, 650) - 0.5) * 0.07));
  return mix(c, P.dust, (Math.max(0, 0.5 - y) * 0.5 + Math.max(0, F(x + 3, y, z, 12) - 0.62)) * (dust === undefined ? 1 : dust));
}
C.autoPaint = function (tag, x, y, z) {
  switch (tag) {
    case 'gi': {
      // the white under-kimono shows in a V at the chest, and the gi's collar is a darker band beside it
      const v = z > 0.05 && y > 1.2 && y < 1.5 ? Math.abs(x) - (y - 1.28) * 0.42 : 1;
      if (v < 0) return cloth(P.under, x, y, z, 0.2);
      if (v < 0.03) return cloth(P.giDark, x, y, z, 0.3);
      return cloth(mix(P.gi, P.giDark, N(x, y, z, 30) * 0.4), x, y, z, 0.5);
    }
    case 'under': return cloth(P.under, x, y, z, 0.3);
    case 'hakama': {                                     // faint vertical pin-stripe
      const stripe = Math.abs(Math.sin(Math.atan2(x, z) * 38)) > 0.93 ? 0.12 : 0;
      return cloth(mix(P.hakama, P.hakamaDark, stripe + N(x, y, z, 25) * 0.3), x, y, z);
    }
    case 'obi': return cloth(P.obi, x, y, z, 0.2);
    case 'skin': return mix(P.skin, [0.64, 0.45, 0.35], N(x, y, z, 120) * 0.3);
    case 'lip': return P.lip;
    case 'eye': {                                         // white, a dark brown iris and a black pupil on the front of the ball
      const lx = Math.abs(x) - 0.031, d = Math.hypot(lx, y - 1.645);
      return z > 0.089 && d < 0.0075 ? (d < 0.0035 ? [0.03, 0.025, 0.02] : [0.22, 0.14, 0.08]) : P.eye;
    }
    case 'hair': return mix(P.hair, [0.22, 0.2, 0.18], N(x, y, z, 200) * 0.5);
    case 'straw': { const w = Math.abs(Math.sin((x + z) * 260)) > 0.8 ? 0.85 : 1; return mix(P.straw, P.dust, Math.max(0, 0.2 - y) * 2).map((v) => v * w); }
    case 'tabi': return cloth(P.tabi, x, y, z, 1.4);
    case 'cord': return P.cord;
    case 'saya': return mix(P.saya, [0.12, 0.1, 0.09], N(x, y, z, 90) * 0.4);
    case 'tsuka': { const d = Math.abs(Math.sin(y * 420)) > 0.5 ? P.ito : P.tsuka; return d; }   // wrapped grip
    case 'metal': return P.metal;
    default: return P.gi;
  }
};

/* ---------------- 1. skeleton: a neutral, rig-ready stance ---------------- */
const J = {
  hipR: [-0.095, 0.94, 0], hipL: [0.095, 0.94, 0],
  kneeR: [-0.112, 0.52, 0.02], kneeL: [0.112, 0.52, 0.02],
  ankleR: [-0.124, 0.09, -0.005], ankleL: [0.124, 0.09, -0.005],
  shR: [-0.192, 1.43, -0.01], shL: [0.192, 1.43, -0.01],
  elR: [-0.262, 1.17, -0.02], elL: [0.262, 1.17, -0.02],
  wrR: [-0.31, 0.95, 0.03], wrL: [0.31, 0.95, 0.03]
};
const sides = [
  { s: -1, hip: J.hipR, knee: J.kneeR, ank: J.ankleR, sh: J.shR, el: J.elR, wr: J.wrR },
  { s: 1, hip: J.hipL, knee: J.kneeL, ank: J.ankleL, sh: J.shL, el: J.elL, wr: J.wrL }
];

/* ---------------- 2. anatomy under the gi ---------------- */
T('gi', 0.07);
C.ell([0, 1.31, 0.0], [0.148, 0.168, 0.102]);             // ribcage
C.ell([0, 1.365, 0.028], [0.156, 0.082, 0.086]);          // chest
C.ell([0, 1.13, 0.01], [0.13, 0.11, 0.094]);              // belly
C.ell([0, 0.99, -0.004], [0.158, 0.1, 0.104]);            // pelvis
T('gi', 0.05);
C.limb([0, 1.47, -0.025], [-0.18, 1.425, -0.012], 0.05, 0.042);    // trapezius
C.limb([0, 1.47, -0.025], [0.18, 1.425, -0.012], 0.05, 0.042);
T('skin', 0.05);
C.limb([0, 1.43, 0.0], [0, 1.55, 0.012], 0.054, 0.05);            // neck (the gi collar opens around it)

/* ---------------- 3. clothing: the gi (wide sleeves) and hakama ---------------- */
for (const L of sides) {
  const { s, hip, knee, ank, sh, el, wr } = L;
  T('gi', 0.035);
  C.ell(L3(sh, [0, 1.41, 0], -0.02), [0.062, 0.07, 0.066]);                  // deltoid under the cloth
  C.limb(sh, el, 0.058, 0.052);                                              // upper arm
  C.limb(el, L3(el, wr, 0.8), 0.056, 0.05);                                  // forearm
  // the kimono sleeve: a deep square bag hanging from the upper arm
  T('gi', 0.03);
  C.box(off(L3(sh, el, 0.75), [0.018 * s, -0.11, -0.005]), [0.05, 0.19, 0.125], 0.045, [0, 0, 10 * s]);
  T('skin', 0.02);
  C.limb(L3(el, wr, 0.78), wr, 0.04, 0.036);                                 // bare wrist
  // hakama: wide, pleated, flaring to the ankle -- and SPLIT, one leg each with a clear gap
  // between them below the crotch, or the walk stretches the cloth into a web between the legs
  T('hakama', 0.03);
  C.limb(hip, knee, 0.1, 0.094);
  C.limb(knee, off(ank, [0, 0.02, 0]), 0.094, 0.1);
  C.ell(off(L3(hip, knee, 0.35), [0.018 * s, 0, 0.01]), [0.088, 0.15, 0.092]);
}
T('hakama', 0.02);
C.box([0, 0.04, 0], [0.4, 0.06, 0.4], 0.0, null, { mode: 'subtract' });    // a flat hem, a hand above the ground
T('gi', 0.012);
C.torus([0, 1.465, 0.0], 0.068, 0.016, [14, 0, 0]);                       // the collar band round the neck

/* ---------------- 4. folds, placed on the real surface ---------------- */
T('gi');
const fold = (a, b, t, th0, th1, o) => C.fold(a, b, t, th0 + R(-0.2, 0.2), th1 + R(-0.2, 0.2),
  Object.assign({ r: R(0.013, 0.02), h: R(0.003, 0.0055), sag: R(-0.01, 0.01) }, o));
for (const L of sides) {
  const { s, hip, knee, ank, sh, el, wr } = L;
  const inner = s * PI / 2, outer = -s * PI / 2;
  // hakama pleats: long vertical folds down the front and back (the seven pleats of a real hakama)
  const top = off(hip, [0, 0.02, 0]), hem = off(ank, [0, 0.04, 0]);
  for (const th of [-1.2, -0.55, 0.1, 0.75, PI - 0.5, PI + 0.4]) C.pleat(top, hem, th + R(-0.08, 0.08), { r: 0.014, h: R(0.005, 0.008), tag: 'hakama', t0: 0.12, t1: 0.95, n: 12 });
  // the sleeve bag: sag folds
  fold(sh, el, 0.62, outer * 0.4, inner * 0.6, { tilt: 0.05, tag: 'gi' });
  fold(sh, el, 0.8, -1.4, 1.4, { tilt: 0.02, tag: 'gi' });
  // the hakama bunches at the ankle and behind the knee
  fold(knee, ank, 0.86, -2.6, 2.6, { tilt: 0.02, h: 0.006, tag: 'hakama', reach: 0.3 });
  fold(hip, knee, 0.9, PI - 0.9, PI + 0.9, { tilt: R(-0.03, 0.03), tag: 'hakama', reach: 0.3 });
}
// the gi gathers above the obi
for (const [t, th0, th1] of [[0.4, -2.2, 0.2], [0.55, -0.2, 2.2], [0.5, 2.4, 3.9]]) fold([0, 1.13, 0.01], [0, 1.05, 0], t, th0, th1, { tilt: R(-0.02, 0.02), reach: 0.3, tag: 'gi' });

/* ---------------- 5. kit: obi, sandals, the katana ---------------- */
T('obi', 0.01);
C.box([0, 1.03, 0.004], [0.165, 0.036, 0.118], 0.03);                             // the sash: a flat band that follows the waist
C.box([0.06, 1.03, 0.124], [0.034, 0.028, 0.014], 0.012, [0, 0, 18]);            // the knot
C.fold([0, 1.07, 0], [0, 0.99, 0], 0.5, -3.1, 3.1, { r: 0.005, h: 0.002, n: 30, tag: 'obi', reach: 0.3 });   // the sash's own fold
for (const L of sides) {
  const { s, ank } = L;
  T('tabi', 0.02);
  C.limb(off(ank, [0, -0.03, 0]), off(ank, [0, 0.08, 0]), 0.045, 0.043);           // split-toe sock
  C.box(off(ank, [0.004 * s, -0.045, 0.06]), [0.042, 0.035, 0.105], 0.03);
  T('straw', 0.006);
  C.box(off(ank, [0.004 * s, -0.082, 0.055]), [0.05, 0.009, 0.13], 0.008);       // waraji sole
  T('cord', 0.003);
  C.limb(off(ank, [-0.045, -0.06, 0.1]), off(ank, [0, -0.02, 0.02]), 0.004, 0.004);
  C.limb(off(ank, [0.045, -0.06, 0.1]), off(ank, [0, -0.02, 0.02]), 0.004, 0.004);
  C.torus(off(ank, [0, 0.0, 0]), 0.047, 0.004, [4, 0, 0]);
}
// hands: relaxed fists
for (const L of sides) {
  const { s, wr } = L;
  T('skin', 0.012);
  C.ell(off(wr, [0.004 * s, -0.055, 0.008]), [0.028, 0.048, 0.04], [6, 0, -6 * s]);
  for (let i = 0; i < 4; i++) {
    const z = wr[2] + 0.028 - i * 0.018;
    C.limb([wr[0] + 0.012 * s, wr[1] - 0.085, z], [wr[0] + 0.01 * s, wr[1] - 0.125, z + 0.01], 0.0095, 0.0085);
    C.limb([wr[0] + 0.01 * s, wr[1] - 0.125, z + 0.01], [wr[0] + 0.002 * s, wr[1] - 0.14, z + 0.026], 0.0085, 0.0078);
  }
  C.limb(off(wr, [-0.012 * s, -0.04, 0.036]), off(wr, [-0.016 * s, -0.075, 0.054]), 0.011, 0.009);
}
C.build(0.004, 1);                                        // the body is one object

// the katana: its own piece (a separate object), worn through the obi on the left hip, edge up
{
  const K = C.newObject('Katana');
  const a = [0.14, 1.07, 0.16], b = [0.2, 0.9, -0.33];          // saya from mouth to tip, angled back
  const d = V.norm(V.sub(b, a));
  T('saya', 0.004); C.limb(a, b, 0.017, 0.015);
  T('metal', 0.003); C.limb(V.addv(a, V.mul(d, -0.01)), V.addv(a, V.mul(d, 0.012)), 0.019, 0.019);   // koiguchi
  T('metal', 0.002); C.cyl(V.addv(a, V.mul(d, -0.02)), 0.038, 0.004, 0.002, [Math.atan2(d[2], d[1]) * 180 / PI, 0, 0]);   // tsuba
  T('tsuka', 0.004); C.limb(V.addv(a, V.mul(d, -0.025)), V.addv(a, V.mul(d, -0.27)), 0.016, 0.016);   // grip
  T('metal', 0.002); C.limb(V.addv(a, V.mul(d, -0.27)), V.addv(a, V.mul(d, -0.285)), 0.017, 0.015);  // kashira
  C.build(0.0018, 1, K);
}

/* ---------------- 6. head: forms, then brushes ---------------- */
{
  const H = C.newObject('Head');
  T('skin', 0.03);
  C.ell([0, 1.658, -0.012], [0.075, 0.082, 0.095]);                  // cranium
  C.ell([0, 1.618, 0.034], [0.06, 0.072, 0.072]);                    // face mass
  C.limb([0, 1.5, -0.005], [0, 1.585, 0.0], 0.05, 0.048);            // neck
  T('skin', 0.02);
  for (const s of [-1, 1]) {
    C.limb([0.062 * s, 1.632, -0.012], [0.03 * s, 1.566, 0.07], 0.017, 0.013);   // jaw line
    C.ell([0.05 * s, 1.63, 0.066], [0.021, 0.013, 0.019]);                        // cheekbone
  }
  C.limb([-0.043, 1.667, 0.08], [0.043, 1.667, 0.08], 0.013, 0.013, { k: 0.015 }); // brow ridge
  C.ell([0, 1.562, 0.08], [0.022, 0.017, 0.017]);                               // chin
  T('skin', 0.012);
  for (const s of [-1, 1]) C.ell([0.031 * s, 1.645, 0.1], [0.022, 0.014, 0.019], null, { mode: 'subtract' });   // sockets
  T('eye', 0.004);
  for (const s of [-1, 1]) C.ell([0.031 * s, 1.645, 0.083], [0.0128, 0.0128, 0.0128]);
  T('skin', 0.006);
  for (const s of [-1, 1]) {
    C.limb([0.017 * s, 1.6495, 0.0935], [0.046 * s, 1.6475, 0.0855], 0.0072, 0.006);   // heavy upper lid, half over the iris: a hard, tired look
    C.limb([0.019 * s, 1.64, 0.092], [0.043 * s, 1.641, 0.086], 0.0035, 0.003);
    C.ell([0.079 * s, 1.638, -0.012], [0.009, 0.029, 0.018], [0, 22 * s, 0]);  // ears
    C.torus([0.086 * s, 1.64, -0.012], 0.014, 0.0035, [0, 0, 90 * s]);
  }
  C.limb([0, 1.655, 0.093], [0, 1.614, 0.115], 0.008, 0.011);               // nose
  C.ell([0, 1.61, 0.113], [0.012, 0.011, 0.011]);
  for (const s of [-1, 1]) C.ell([0.012 * s, 1.607, 0.104], [0.009, 0.008, 0.008]);
  T('lip', 0.005);
  C.ell([0, 1.593, 0.098], [0.019, 0.0055, 0.007]);
  C.ell([0, 1.584, 0.096], [0.017, 0.006, 0.007]);
  C.box([0, 1.5885, 0.107], [0.022, 0.0012, 0.012], 0, null, { mode: 'subtract', k: 0.003 });
  C.build(0.0022, 2, H);
}
// hair: its own piece, so its intersect/subtract only cut the hair, never the face
{
  const HR = C.newObject('Hair');
  T('hair', 0.0);
  C.ell([0, 1.66, -0.014], [0.078, 0.085, 0.098], null, { grow: 0.005 });          // the cranium, grown a little
  T('hair', 0.012);
  C.box([0, 1.735, -0.02], [0.2, 0.092, 0.2], 0, null, { mode: 'intersect' });      // keep the top of the head
  C.box([0, 1.66, 0.14], [0.2, 0.06, 0.06], 0.01, [-35, 0, 0], { mode: 'subtract' }); // hairline swept back off the forehead
  for (const s of [-1, 1]) C.ell([0.085 * s, 1.63, -0.005], [0.03, 0.05, 0.04], null, { mode: 'subtract' });   // clear the ears
  T('hair', 0.01);
  C.ell([0, 1.748, -0.03], [0.018, 0.016, 0.046], [-18, 0, 0]);                     // the topknot
  C.limb([0, 1.752, 0.015], [0, 1.756, -0.075], 0.011, 0.008);
  C.build(0.0018, 1, HR);
}
// brush pass on the face (symmetry on): blend the forms, cut the nasolabial fold, furrow the brow
M.opts({ dyntopo: false, symmetryX: true, strokeSmoothing: 0, pressureRadius: false, pressureStrength: false, falloff: 'smooth', autoSmooth: 0.3 });
M.app.scene.selected = M.app.scene.objects.findIndex((o) => o.name === 'Head');
M.at([0, 1.62, 0.05], [0, 0, 1], 0.1);
M.stroke('smooth', [[0.0, 1.61], [0.05, 1.63], [0.06, 1.6], [0.02, 1.57]], 0.02, 0.3);
M.stroke('pinch', [[0.018, 1.62], [0.026, 1.598]], 0.008, 0.25);
M.stroke('crease', [[0.017, 1.619], [0.027, 1.598]], 0.006, 0.2);
M.opts({ symmetryX: false });

/* ---------------- 7. join ---------------- */
M.joinAll();

/* ---------------- 8. brush pass: a crease in the valley beside every fold ---------------- */
M.opts({ dyntopo: false, symmetryX: false, autoSmooth: 0.12 });
for (const f of C.folds) {
  const mid = f.pts.length >> 1, vd = f.dirs[mid], pts = [];
  // wrap-round folds get the valley below the ridge; pleats get one beside it
  const side = f.along ? V.norm(V.cross(vd, V.sub(f.pts[f.pts.length - 1], f.pts[0]))) : f.ax;
  for (let i = 0; i < f.pts.length; i++) if (V.dot(f.dirs[i], vd) > 0.4) pts.push(V.addv(f.pts[i], V.mul(side, f.r * 1.05)));
  if (pts.length < 2) continue;
  M.at(pts[pts.length >> 1], vd, 0.2);
  M.wstroke('crease', pts, 0.0075, 0.4);
}

/* ---------------- 9. baked shading, and the review look ---------------- */
C.bakeShading({ floor: 3, ao: 0.9 });
M.app.set('cavity', 0.1); M.app.set('matcap', 'white');
M.app.set('bgTop', '#8a8f98'); M.app.set('bgBottom', '#3a3e45');
