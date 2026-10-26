/*
 * FORLORN — shared build kit for every character.
 *
 * Joined in front of a character's own script by forge/make.mjs, so it runs
 * inside SculptFree with M and M.clay loaded. It follows the method in
 * RULES.md §5 and templates/ronin.js, parameterised so the roster can share
 * one body, one T-pose hand and one face builder:
 *
 *   K.skeleton(spec)   joints for a T-pose of any height and build
 *   K.body(J, spec, tags)  anatomy masses (ribcage, chest, belly, pelvis,
 *                      traps, deltoids, biceps, forearms, quads, calves)
 *   K.hands(J, spec)   open, palm-down T-pose hands
 *   K.head(spec)       a head from facial forms, its own object, brushed
 *   K.hairCap(spec,o)  hair as its own object: the cranium grown and cut
 *   K.shoe(...)        sole, upper, toe cap, tongue, heel tab
 *   K.creasePass()     a crease in the valley beside every fold
 *   K.joints(J,attach) prints the rig's joints file for make.mjs to save
 *
 * Style (RULES.md §3, written for this game): stylised-realistic with the
 * pushed, readable shapes of a Roblox horror movie. Heads a touch large
 * (about 6.8 heads tall), clean silhouettes, one loud identity colour per
 * survivor so they read in a dark map, killers exaggerated freely.
 * Metres, feet at y = 0, facing +Z, the character's left at +X.
 */
M.app.newScene('sphere', 5, true);
const C = M.clay, V = C.v, PI = Math.PI;
const L3 = (a, b, t) => V.lerp(a, b, t), off = (p, d) => V.addv(p, d);
const T = (t, k) => { M.tag = t; M.k = k === undefined ? 0.02 : k; };
const K = {};
K.seed = 777331;
const rnd = () => (K.seed = (K.seed * 16807) % 2147483647) / 2147483647;
const R = (a, b) => a + (b - a) * rnd();
const HEX = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const mix = (a, b, t) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * Math.max(0, Math.min(1, t)));
const N = (x, y, z, f) => C.noise(x * f, y * f, z * f), F = (x, y, z, f, o) => C.fbm(x * f, y * f, z * f, o || 3);
const SKIN_ID = typeof SKIN === 'string' ? SKIN : 'default';
K.dust = HEX('#8f8676');

/* ---------------- paint helpers ---------------- */
// cloth: a slow tonal drift, a fine weave, and dust that climbs from the ground
K.cloth = function (c, x, y, z, dust, weave) {
  c = mix(c, c.map((v) => v * 0.74), F(x, y, z, 6) * 1.2 - 0.3);
  c = c.map((v) => v * (1 + (N(x, y, z, weave || 650) - 0.5) * 0.08));
  return mix(c, K.dust, (Math.max(0, 0.45 - y) * 0.45 + Math.max(0, F(x + 3, y, z, 12) - 0.64)) * (dust === undefined ? 1 : dust));
};
K.leather = (c, x, y, z) => mix(c, c.map((v) => v * 0.65), F(x, y, z, 14) * 0.9 - 0.2).map((v) => v * (1 + (N(x, y, z, 300) - 0.5) * 0.1));
K.metal = (c, x, y, z) => mix(c, c.map((v) => v * 0.6), Math.max(0, F(x, y, z, 20) - 0.45) * 1.4);
K.skinPaint = function (base, x, y, z, ny) {
  let c = mix(base, base.map((v) => v * 0.8), N(x, y, z, 120) * 0.35);
  return c.map((v, i) => v * (1 + (N(x, y, z, 700) - 0.5) * 0.04) + (i === 0 ? 0.015 : 0));
};
K.eyes = [];
// the eyeball: white, an iris and a pupil on its front, a wet dark rim
K.eyePaint = function (x, y, z, iris) {
  for (const e of K.eyes) {
    const dx = x - e.c[0], dy = y - e.c[1], dz = z - e.c[2];
    if (dx * dx + dy * dy + dz * dz > e.r * e.r * 2.2) continue;
    if (dz < e.r * 0.45) return [0.82, 0.78, 0.74];
    const d = Math.hypot(dx, dy);
    if (d < e.r * 0.27) return [0.02, 0.018, 0.016];
    if (d < e.r * 0.6) return mix(iris, iris.map((v) => v * 0.45), d / (e.r * 0.6));
    if (d < e.r * 0.66) return iris.map((v) => v * 0.3);
    return [0.9, 0.87, 0.83];
  }
  return [0.88, 0.85, 0.8];
};

/* ---------------- 1. skeleton: the T-pose for any height and build ---------------- */
/*
 * spec: { h: height (m), sh: shoulder half-width at 1.8 m, hip: hip-joint half-width,
 *         arm: arm length factor, leg: leg length factor, head: head scale }
 * Arms straight out to the sides at shoulder height, palms down; feet under the hips.
 */
K.skeleton = function (spec) {
  const s = spec.h / 1.8, sh = (spec.sh || 0.192) * s, arm = (spec.arm || 1) * s, hip = (spec.hip || 0.095) * s;
  const kneeY = 0.52 * s, hipY = 0.94 * s;
  const shY = 1.43 * s;
  const J = {
    s, hs: (spec.head || 1.08) * s,
    hipR: [-hip, hipY, 0], hipL: [hip, hipY, 0],
    kneeR: [-hip - 0.017 * s, kneeY, 0.02 * s], kneeL: [hip + 0.017 * s, kneeY, 0.02 * s],
    ankleR: [-hip - 0.029 * s, 0.09 * s, -0.005 * s], ankleL: [hip + 0.029 * s, 0.09 * s, -0.005 * s],
    shR: [-sh, shY, -0.01 * s], shL: [sh, shY, -0.01 * s],
    elR: [-sh - 0.27 * arm, shY - 0.005 * s, -0.012 * s], elL: [sh + 0.27 * arm, shY - 0.005 * s, -0.012 * s],
    wrR: [-sh - 0.505 * arm, shY - 0.01 * s, -0.008 * s], wrL: [sh + 0.505 * arm, shY - 0.01 * s, -0.008 * s],
    neck: [0, 1.47 * s, -0.005 * s]
  };
  J.sides = [
    { s: -1, hip: J.hipR, knee: J.kneeR, ank: J.ankleR, sh: J.shR, el: J.elR, wr: J.wrR },
    { s: 1, hip: J.hipL, knee: J.kneeL, ank: J.ankleL, sh: J.shL, el: J.elL, wr: J.wrL }
  ];
  return J;
};

/* ---------------- 2. anatomy under the clothes ---------------- */
/*
 * tags: { torso, arm, forearm, leg, shin, neck } — the paint tag of each mass,
 * so a hoodie torso is painted 'hoodie' while the shin under shorts is 'skin'.
 * spec.build: 'slim' | 'male' | 'female' | 'heavy' | 'brute' | 'gaunt'
 * spec.grow:  { torso, arm, leg } metres, to put a garment's thickness on the body
 */
K.body = function (J, spec, tags) {
  const s = J.s, b = spec.build || 'male', g = spec.grow || {};
  const W = { slim: 0.92, male: 1, female: 0.9, heavy: 1.12, brute: 1.3, gaunt: 0.78 }[b] || 1;
  const D = { slim: 0.95, male: 1, female: 0.95, heavy: 1.2, brute: 1.28, gaunt: 0.8 }[b] || 1;
  const belly = { heavy: 1.35, brute: 1.2 }[b] || 1;
  const fem = b === 'female';
  const gt = g.torso || 0, ga = g.arm || 0, gl = g.leg || 0;
  const P = (x, y, z) => [x * s, y * s, z * s];
  T(tags.torso, 0.07 * s);
  C.ell(P(0, 1.31, 0), [0.148 * s * W, 0.168 * s, 0.102 * s * D], null, { grow: gt });               // ribcage
  if (fem) { for (const sd of [-1, 1]) C.ell(P(0.062 * sd, 1.325, 0.07), [0.06 * s, 0.055 * s, 0.05 * s], null, { grow: gt, k: 0.04 * s }); }
  else C.ell(P(0, 1.365, 0.028), [0.156 * s * W, 0.082 * s, 0.086 * s * D], null, { grow: gt });     // chest
  C.ell(P(0, 1.13, 0.012 * belly), [0.13 * s * W * (fem ? 0.88 : 1), 0.11 * s, 0.094 * s * D * belly], null, { grow: gt });   // belly
  C.ell(P(0, 0.99, -0.004), [0.158 * s * (fem ? 1.08 : W * 0.97), 0.1 * s, 0.104 * s * D], null, { grow: gt });       // pelvis
  T(tags.torso, 0.05 * s);
  for (const L of J.sides) {
    C.limb(P(0, 1.47, -0.025), off(L.sh, [-0.012 * s * L.s, 0, 0]), 0.05 * s * W, 0.042 * s * W, { grow: gt });   // trapezius
    C.ell(off(L.hip, [0.0, 0.05 * s, -0.07 * s]), [0.085 * s * (fem ? 1.08 : 1), 0.085 * s, 0.07 * s], null, { grow: gl, tag: tags.seat || tags.leg }); // seat
  }
  T(tags.neck || 'skin', 0.05 * s);
  C.limb(P(0, 1.43, 0), P(0, 1.56, 0.012), 0.052 * s * (fem ? 0.85 : W), 0.048 * s * (fem ? 0.85 : 1));         // neck
  for (const L of J.sides) {
    const { sh, el, wr, hip, knee, ank } = L;
    const aw = W * (fem ? 0.86 : 1);
    T(tags.arm, 0.035 * s);
    C.ell(L3(sh, [0, sh[1], sh[2]], -0.02), [0.064 * s * aw, 0.07 * s * aw, 0.068 * s * aw], null, { grow: ga });   // deltoid
    C.limb(sh, el, 0.055 * s * aw, 0.044 * s * aw, { grow: ga });                                                  // upper arm
    C.ell(L3(sh, el, 0.55), [0.1 * s, 0.048 * s * aw, 0.05 * s * aw], null, { grow: ga, k: 0.03 * s });             // biceps
    T(tags.forearm || tags.arm, 0.03 * s);
    C.limb(el, L3(el, wr, 0.92), 0.047 * s * aw, 0.034 * s * aw, { grow: ga });                                    // forearm
    C.ell(L3(el, wr, 0.25), [0.085 * s, 0.043 * s * aw, 0.045 * s * aw], null, { grow: ga, k: 0.025 * s });         // forearm mass
    T(tags.leg, 0.04 * s);
    C.limb(hip, knee, 0.088 * s * W, 0.058 * s * W, { grow: gl });                                                  // thigh
    C.ell(off(L3(hip, knee, 0.4), [0.008 * s * L.s, 0, 0.022 * s]), [0.07 * s * W, 0.16 * s, 0.07 * s * W], null, { grow: gl });   // quads
    T(tags.shin || tags.leg, 0.035 * s);
    C.limb(knee, ank, 0.056 * s * W, 0.04 * s, { grow: g.shin === undefined ? gl : g.shin });                       // shin
    C.ell(off(L3(knee, ank, 0.3), [0, 0, -0.025 * s]), [0.05 * s * W, 0.11 * s, 0.05 * s * W], null, { grow: g.shin === undefined ? gl : g.shin });   // calf
  }
};

/* ---------------- hands: open, palms down, fingers out along the arm ---------------- */
K.hands = function (J, spec, tag) {
  const s = J.s * (spec.hand || 1);
  for (const L of J.sides) {
    const { s: sd, wr } = L;
    T(tag || 'skin', 0.012 * s);
    C.limb(off(wr, [-0.03 * sd * s, 0, 0]), off(wr, [0.02 * sd * s, -0.002 * s, 0.002 * s]), 0.034 * s, 0.03 * s);   // wrist
    C.ell(off(wr, [0.05 * sd * s, -0.004 * s, 0.002 * s]), [0.048 * s, 0.019 * s, 0.04 * s]);                         // palm
    for (let i = 0; i < 4; i++) {
      const z = wr[2] + (0.026 - i * 0.0175) * s, len = [0.07, 0.078, 0.074, 0.06][i] * s * (spec.finger || 1);
      const k0 = [wr[0] + 0.092 * sd * s, wr[1] - 0.002 * s, z], k1 = [k0[0] + len * 0.55 * sd, k0[1] - 0.006 * s, z];
      C.limb(k0, k1, 0.0092 * s, 0.0084 * s);
      C.limb(k1, [k1[0] + len * 0.45 * sd, k1[1] - 0.012 * s, z], 0.0084 * s, (spec.claw ? 0.003 : 0.0074) * s);
    }
    C.limb(off(wr, [0.03 * sd * s, -0.012 * s, 0.034 * s]), off(wr, [0.07 * sd * s, -0.022 * s, 0.058 * s]), 0.011 * s, 0.009 * s);   // thumb
  }
};
// a hand closed round a grip that runs along +Z (a held weapon), palm down
K.fist = function (wr, sd, s, tag) {
  T(tag || 'skin', 0.01 * s);
  C.limb(off(wr, [-0.03 * sd * s, 0, 0]), off(wr, [0.02 * sd * s, -0.002 * s, 0.002 * s]), 0.034 * s, 0.03 * s);
  C.ell(off(wr, [0.055 * sd * s, -0.006 * s, 0.002 * s]), [0.045 * s, 0.024 * s, 0.042 * s]);
  for (let i = 0; i < 4; i++) {
    const z = wr[2] + (0.024 - i * 0.016) * s;
    const k0 = [wr[0] + 0.095 * sd * s, wr[1] - 0.004 * s, z];
    C.limb(k0, off(k0, [0.022 * sd * s, -0.02 * s, 0]), 0.0095 * s, 0.009 * s);                  // first knuckle, curling down
    C.limb(off(k0, [0.022 * sd * s, -0.02 * s, 0]), off(k0, [0.004 * sd * s, -0.04 * s, 0]), 0.009 * s, 0.008 * s);   // round under the grip
  }
  C.limb(off(wr, [0.035 * sd * s, -0.012 * s, 0.036 * s]), off(wr, [0.085 * sd * s, -0.03 * s, 0.05 * s]), 0.011 * s, 0.009 * s);
  return off(wr, [0.1 * sd * s, -0.026 * s, 0]);           // the centre of the grip
};

/* ---------------- shoes ---------------- */
// kind: 'sneaker' | 'boot' | 'dress' | 'bare' ; tags: { sole, upper, cap, lace }
K.shoe = function (J, kind, tags, o) {
  o = o || {};
  const s = J.s * (o.scale || 1);
  for (const L of J.sides) {
    const { s: sd, ank } = L;
    const a = off(ank, [0.004 * sd * s, 0, 0]);
    if (kind === 'boot') {
      T(tags.upper, 0.02 * s);
      C.limb(off(a, [0, -0.02 * s, 0]), off(a, [0, (o.shaft || 0.16) * s, 0]), 0.05 * s, 0.052 * s);   // shaft
      C.box(off(a, [0, -0.045 * s, 0.055 * s]), [0.046 * s, 0.04 * s, 0.11 * s], 0.035 * s);
      T(tags.cap || tags.upper, 0.008 * s);
      C.ell(off(a, [0, -0.05 * s, 0.135 * s]), [0.046 * s, 0.036 * s, 0.045 * s]);
      T(tags.sole, 0.004 * s);
      C.box(off(a, [0, -0.082 * s, 0.05 * s]), [0.053 * s, 0.011 * s, 0.14 * s], 0.008 * s);
      C.box(off(a, [0, -0.072 * s, -0.045 * s]), [0.05 * s, 0.016 * s, 0.04 * s], 0.006 * s);           // heel block
      T(tags.lace || tags.upper, 0.004 * s);
      for (let i = 0; i < 3; i++) C.torus(off(a, [0, (0.03 + i * 0.045) * s, 0]), 0.053 * s, 0.0045 * s, [4, 0, 0]);   // straps / lacing rings
    } else if (kind === 'sneaker') {
      T(tags.upper, 0.02 * s);
      C.limb(off(a, [0, -0.025 * s, 0]), off(a, [0, 0.035 * s, 0]), 0.047 * s, 0.045 * s);
      C.box(off(a, [0, -0.048 * s, 0.055 * s]), [0.05 * s, 0.038 * s, 0.112 * s], 0.036 * s);
      T(tags.cap || tags.upper, 0.01 * s);
      C.ell(off(a, [0, -0.06 * s, 0.14 * s]), [0.05 * s, 0.03 * s, 0.045 * s]);                        // toe cap
      T(tags.lace || tags.upper, 0.006 * s);
      C.box(off(a, [0, -0.005 * s, 0.085 * s]), [0.026 * s, 0.012 * s, 0.05 * s], 0.008 * s, [-28, 0, 0]);   // tongue
      T(tags.sole, 0.004 * s);
      C.box(off(a, [0, -0.08 * s, 0.052 * s]), [0.058 * s, 0.017 * s, 0.15 * s], 0.012 * s);           // chunky midsole
      C.box(off(a, [0, -0.025 * s, -0.05 * s]), [0.02 * s, 0.03 * s, 0.012 * s], 0.006 * s);          // heel tab
    } else if (kind === 'dress') {
      T(tags.upper, 0.015 * s);
      C.limb(off(a, [0, -0.025 * s, 0]), off(a, [0, 0.03 * s, 0]), 0.043 * s, 0.042 * s);
      C.box(off(a, [0, -0.05 * s, 0.06 * s]), [0.042 * s, 0.032 * s, 0.12 * s], 0.03 * s);
      C.ell(off(a, [0, -0.06 * s, 0.155 * s]), [0.042 * s, 0.026 * s, 0.05 * s]);
      T(tags.sole, 0.003 * s);
      C.box(off(a, [0, -0.083 * s, 0.06 * s]), [0.046 * s, 0.007 * s, 0.15 * s], 0.006 * s);
      C.box(off(a, [0, -0.072 * s, -0.04 * s]), [0.04 * s, 0.016 * s, 0.035 * s], 0.005 * s);
    } else {
      // bare / wrapped feet: a foot with toes, for creatures
      T(tags.upper, 0.02 * s);
      C.limb(off(a, [0, -0.03 * s, 0]), off(a, [0, 0.04 * s, 0]), 0.042 * s, 0.04 * s);
      C.box(off(a, [0, -0.06 * s, 0.06 * s]), [0.044 * s, 0.026 * s, 0.11 * s], 0.024 * s);
      for (let i = 0; i < 4; i++) C.limb(off(a, [(-0.03 + i * 0.02) * s, -0.07 * s, 0.15 * s]), off(a, [(-0.03 + i * 0.02) * s, -0.078 * s, (o.claw ? 0.22 : 0.18) * s]), 0.011 * s, o.claw ? 0.003 * s : 0.008 * s);
    }
  }
};

/* ---------------- the head: facial forms, its own object ---------------- */
/*
 * spec.face: { jaw, chin, brow, nose, noseW, lips, lid (0 open .. 1 heavy), cheek, long, ear,
 *              fem, mouthW, tag, lipTag }
 * Builds into a new object named 'Head'. Returns hp(), the head-space -> world mapping,
 * so hair and hats can be placed with the same numbers the ronin uses.
 */
K.head = function (J, spec) {
  const f = Object.assign({ jaw: 1, chin: 1, brow: 1, nose: 1, noseW: 1, lips: 1, lid: 0.5, cheek: 1, long: 1, ear: 1, mouthW: 1 }, spec.face || {});
  const hk = J.hs, base = 1.47 * J.s;
  const hp = (x, y, z) => [x * hk, (y - 1.47) * hk * f.long + base, z * hk];
  const r = (v) => v * hk;
  K.hp = hp; K.hr = r;
  const H = C.newObject('Head');
  const skin = f.tag || 'skin';
  T(skin, r(0.03));
  C.ell(hp(0, 1.658, -0.012), [r(0.075), r(0.082), r(0.095)]);                            // cranium
  C.ell(hp(0, 1.618, 0.034), [r(0.06 * f.cheek), r(0.072), r(0.072)]);                    // face mass
  C.limb(hp(0, 1.5, -0.005), hp(0, 1.585, 0), r(0.05), r(0.048));                         // neck
  T(skin, r(0.02));
  for (const sd of [-1, 1]) {
    C.limb(hp(0.062 * sd * f.jaw, 1.632, -0.012), hp(0.03 * sd * f.jaw, 1.566 - (f.fem ? -0.004 : 0), 0.07), r(0.017 * f.jaw), r(0.013));   // jaw line
    C.ell(hp(0.05 * sd, 1.63, 0.066), [r(0.021 * f.cheek), r(0.013), r(0.019)]);                                                          // cheekbone
  }
  C.limb(hp(-0.043, 1.667, 0.08), hp(0.043, 1.667, 0.08), r(0.013 * f.brow), r(0.013 * f.brow), { k: r(0.015) });   // brow ridge
  C.ell(hp(0, 1.562, 0.08), [r(0.022 * f.chin), r(0.017 * f.chin), r(0.017)]);                                    // chin
  T(skin, r(0.012));
  for (const sd of [-1, 1]) C.ell(hp(0.031 * sd, 1.645, 0.1), [r(0.022), r(0.014), r(0.019)], null, { mode: 'subtract' });   // sockets
  T('eye', r(0.004));
  K.eyes = [];
  for (const sd of [-1, 1]) {
    const c = hp(0.031 * sd, 1.645, 0.083);
    C.ell(c, [r(0.0128), r(0.0128), r(0.0128)]);
    K.eyes.push({ c, r: r(0.0128) });
  }
  T(skin, r(0.006));
  const lid = f.lid;
  for (const sd of [-1, 1]) {
    C.limb(hp(0.017 * sd, 1.6495 + 0.002 * (1 - lid), 0.0935), hp(0.046 * sd, 1.6475 + 0.002 * (1 - lid), 0.0855), r(0.0062 + 0.002 * lid), r(0.0052 + 0.0016 * lid));   // upper lid
    C.limb(hp(0.019 * sd, 1.64, 0.092), hp(0.043 * sd, 1.641, 0.086), r(0.0035), r(0.003));                                                                           // lower lid
    C.ell(hp(0.079 * sd, 1.638, -0.012), [r(0.009 * f.ear), r(0.029 * f.ear), r(0.018 * f.ear)], [0, 22 * sd, 0]);                                                      // ear
    C.torus(hp(0.086 * sd, 1.64, -0.012), r(0.014 * f.ear), r(0.0035), [0, 0, 90 * sd]);
  }
  C.limb(hp(0, 1.655, 0.093), hp(0, 1.614 - 0.004 * (f.nose - 1), 0.115 + 0.008 * (f.nose - 1)), r(0.008 * f.noseW), r(0.011 * f.noseW));   // nose bridge
  C.ell(hp(0, 1.61 - 0.004 * (f.nose - 1), 0.113 + 0.008 * (f.nose - 1)), [r(0.012 * f.noseW), r(0.011), r(0.011)]);                         // tip
  for (const sd of [-1, 1]) C.ell(hp(0.012 * sd * f.noseW, 1.607, 0.104), [r(0.009), r(0.008), r(0.008)]);                                     // wings
  T(f.lipTag || 'lip', r(0.005));
  C.ell(hp(0, 1.593, 0.098), [r(0.019 * f.mouthW), r(0.0055 * f.lips), r(0.007 * f.lips)]);
  C.ell(hp(0, 1.584, 0.096), [r(0.017 * f.mouthW), r(0.006 * f.lips * (f.fem ? 1.15 : 1)), r(0.007 * f.lips)]);
  C.box(hp(0, 1.5885, 0.107), [r(0.022 * f.mouthW), r(0.0012), r(0.012)], 0, null, { mode: 'subtract', k: r(0.003) });
  if (spec.headExtra) spec.headExtra(hp, r);
  C.build(0.0022 * Math.max(1, hk / 1.1), 2, H);
  // brush pass on the face, symmetry on: blend the forms, nasolabial fold, a touch of brow
  M.opts({ dyntopo: false, symmetryX: true, strokeSmoothing: 0, pressureRadius: false, pressureStrength: false, falloff: 'smooth', autoSmooth: 0.3 });
  M.app.scene.selected = M.app.scene.objects.findIndex((o) => o === H);
  const c0 = hp(0, 1.62, 0.05);
  M.at(c0, [0, 0, 1], r(0.1));
  const uv = (x, y) => { const p = hp(x, y, 0); return [p[0], p[1]]; };
  M.stroke('smooth', [uv(0.0, 1.61), uv(0.05, 1.63), uv(0.06, 1.6), uv(0.02, 1.57)], r(0.02), 0.3);
  M.stroke('pinch', [uv(0.018, 1.62), uv(0.026, 1.598)], r(0.008), 0.25);
  M.stroke('crease', [uv(0.017, 1.619), uv(0.027, 1.598)], r(0.006), f.fem ? 0.1 : 0.2);
  if (f.brow > 1.1) M.stroke('clay', [uv(-0.035, 1.672), uv(0.035, 1.672)], r(0.01), 0.2);
  M.opts({ symmetryX: false });
  return hp;
};

/*
 * Hair as its own object (so its intersect/subtract only ever cut the hair):
 * the cranium grown, kept above `top`, cut back at the hairline and round the ears.
 * o: { grow, top, line (hairline tilt deg), back (keep how far down the back), extra(hp, r) }
 */
K.hairCap = function (o) {
  o = o || {};
  const hp = K.hp, r = K.hr;
  const HR = C.newObject('Hair');
  T(o.tag || 'hair', 0.0);
  C.ell(hp(0, 1.66, -0.014), [r(0.078), r(0.085), r(0.098)], null, { grow: r(o.grow || 0.006) });
  if (o.extraUnion) o.extraUnion(hp, r);
  T(o.tag || 'hair', r(0.012));
  C.box(hp(0, (o.top || 1.66) + 0.09, -0.02), [r(0.2), r(0.09), r(0.2)], 0, null, { mode: 'intersect' });
  C.box(hp(0, 1.66 + (o.lineY || 0), 0.14 + (o.lineZ || 0)), [r(0.2), r(0.06), r(0.06)], r(0.01), [o.line === undefined ? -35 : o.line, 0, 0], { mode: 'subtract' });
  for (const sd of [-1, 1]) C.ell(hp(0.085 * sd, 1.63, -0.005), [r(0.03), r(0.05), r(0.04)], null, { mode: 'subtract' });
  if (o.extra) { T(o.tag || 'hair', r(0.01)); o.extra(hp, r); }
  C.build(0.0018 * Math.max(1, K.hr(1) / 1.1), 1, HR);
  return HR;
};

/* ---------------- brush pass: a crease in every fold valley ---------------- */
K.creasePass = function (strength) {
  M.opts({ dyntopo: false, symmetryX: false, autoSmooth: 0.12 });
  for (const f of C.folds) {
    const mid = f.pts.length >> 1, vd = f.dirs[mid], pts = [];
    const side = f.along ? V.norm(V.cross(vd, V.sub(f.pts[f.pts.length - 1], f.pts[0]))) : f.ax;
    for (let i = 0; i < f.pts.length; i++) if (V.dot(f.dirs[i], vd) > 0.4) pts.push(V.addv(f.pts[i], V.mul(side, f.r * 1.05)));
    if (pts.length < 2) continue;
    M.at(pts[pts.length >> 1], vd, 0.2);
    M.wstroke('crease', pts, 0.0075, strength || 0.4);
  }
};
// randomised fold, as in the ronin: identical folds read as a pattern, not cloth
K.fold = (a, b, t, th0, th1, o) => C.fold(a, b, t, th0 + R(-0.2, 0.2), th1 + R(-0.2, 0.2),
  Object.assign({ r: R(0.013, 0.02), h: R(0.003, 0.0055), sag: R(-0.01, 0.01) }, o));

/* ---------------- the rig's joints file, from J ---------------- */
K.joints = function (J, attach) {
  const s = J.s, P = (x, y, z) => [+(x * s).toFixed(4), +(y * s).toFixed(4), +(z * s).toFixed(4)];
  const r4 = (p) => p.map((v) => +v.toFixed(4));
  const top = K.hp ? K.hp(0, 1.77, 0)[1] : 1.77 * s;
  const neckTop = K.hp ? K.hp(0, 1.555, 0.005) : P(0, 1.555, 0.005);
  const j = {
    Hips: [0, +(J.hipL[1] + 0.03 * s).toFixed(4), 0], Spine: P(0, 1.1, 0.005), Chest: P(0, 1.28, 0), Neck: P(0, 1.47, -0.005),
    Head: { head: r4(neckTop), tail: [0, +top.toFixed(4), 0] }
  };
  for (const L of J.sides) {
    const n = L.s > 0 ? 'L' : 'R';
    j['Shoulder.' + n] = P(0.045 * L.s, 1.43, -0.012);
    j['UpperArm.' + n] = r4(L.sh);
    j['LowerArm.' + n] = r4(L.el);
    j['Hand.' + n] = { head: r4(L.wr), tail: r4(off(L.wr, [0.133 * s * L.s, -0.015 * s, 0])) };
    j['UpperLeg.' + n] = r4(L.hip);
    j['LowerLeg.' + n] = r4(L.knee);
    j['Foot.' + n] = r4(L.ank);
    j['Toes.' + n] = { head: r4(off(L.ank, [0.002 * s * L.s, -0.07 * s, 0.105 * s])), tail: r4(off(L.ank, [0.003 * s * L.s, -0.07 * s, 0.16 * s])) };
  }
  if (attach && attach.length) j.$attach = attach.map((a) => ({ at: r4(a.at), bone: a.bone }));
  console.log('# JOINTS ' + JSON.stringify(j));
  return j;
};

K.finish = function (o) {
  o = o || {};
  M.joinAll();
  K.creasePass(o.crease);
  if (o.after) o.after();
  C.bakeShading({ floor: 3, ao: o.ao === undefined ? 0.9 : o.ao });
  M.app.set('cavity', 0.1); M.app.set('matcap', 'white');
  M.app.set('bgTop', '#8a8f98'); M.app.set('bgBottom', '#3a3e45');
};
