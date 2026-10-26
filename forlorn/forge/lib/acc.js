/*
 * FORLORN — accessories: the only 3D things on a body besides the body (STYLE.md). Each builds
 * into its own object, so it is its own rigid piece riding one bone. Joined after rbxkit.js.
 *
 *   A.hair(kind, o)   kind: 'bacon' | 'short' | 'spiky' | 'slick' | 'long' | 'bob' | 'afro'
 *   A.cap(o)  A.peaked(o)  A.ushanka(o)  A.helmet(o)  A.beret(o)  A.hood(o)  A.bandana(o)
 *   A.shades(o)  A.glasses(o)  A.eyepatch(o)  A.chain(o)  A.sword(o)  A.pistol(o)
 *   A.paint(tag, x, y, z, nx, ny, nz) -> colour for every tag these make (call from autoPaint)
 *
 * Head frame: B.D.head = { c, r, hh }; one stud is B.D.st metres.
 */
const A = { colors: {} };
const Hd = () => B.D.head;
const st = () => B.D.st;

/* ---------------- hair ---------------- */
A.hair = function (kind, o) {
  o = o || {};
  const H = Hd(), cy = H.c[1], r = H.r, s = st(), top = cy + H.hh;
  const obj = C.newObject('Hair');
  A.colors.hair = o.color || '#3a2a1c'; A.colors.hairHi = o.hi || null;
  T('hair', 0.006);
  // a cap that hugs the skull, clear of the face below the hairline
  const line = cy + (o.hairline || 0.36) * s;
  C.cyl([0, cy + 0.006, -0.004], r + 0.009, H.hh + 0.003, r * 0.46);
  if (kind === 'long' || kind === 'bob') {
    // the back and sides fall straight; the face stays clear
    // long hair falls past the head down the back, behind the torso; a bob stops at the jaw
    const len = kind === 'long' ? (o.len || 0.55) : 0.15;
    const end = kind === 'long' ? cy - H.hh - len * s : cy - H.hh * 0.55;
    const torsoTop = B.D.y.torso[1] * s, back = B.D.P.td * s;
    C.box([0, (top + end) / 2 - 0.01, -r * 0.4], [r + 0.022, (top - end) / 2, r * 0.66], 0.07);
    for (const sd of [-1, 1]) C.box([sd * (r + 0.002), (top + Math.max(end, cy - H.hh * 0.75)) / 2 - 0.02, -r * 0.08], [0.024, (top - Math.max(end, cy - H.hh * 0.75)) / 2, r * 0.52], 0.022);
    C.box([0, line - 0.2, r + 0.1], [r * 0.8, 0.2, 0.12], 0.01, null, { mode: 'subtract' });                    // the face
    C.box([0, torsoTop - 0.3, 0], [0.6, 0.3 + 0.012, back + 0.014], 0, null, { mode: 'subtract' });            // clear of the shoulders and back
    C.box([0, end - 0.42, 0], [0.5, 0.42, 0.5], 0, null, { mode: 'subtract' });                                // the ends
    T('hair', 0.012);
    if (o.bangs !== false) for (let i = -3; i <= 3; i++) C.limb([i * 0.035, top - 0.01, r * 0.75], [i * 0.04, line - 0.012, r * 1.02], 0.026, 0.012);
    if (o.ponytail) { T('hair', 0.02); C.ell([0, top - 0.04, -r * 0.95], [0.05, 0.045, 0.04]); C.limb([0, top - 0.05, -r * 1.05], [0, cy - 0.06, -r * 1.3], 0.05, 0.042); C.limb([0, cy - 0.06, -r * 1.3], [0, cy - H.hh - 0.12, -r * 1.25], 0.042, 0.014); }
    if (o.bun) { T('hair', 0.02); C.ell([0, top + 0.02, -r * 0.55], [0.075, 0.07, 0.075]); }
  } else {
    C.box([0, cy - 0.07 * s - 0.2, 0], [0.4, 0.2, 0.4], 0, null, { mode: 'subtract' });                       // stop at the nape
    C.box([0, line - 0.2, 0.25], [r * 0.86, 0.2, 0.18], 0.01, null, { mode: 'subtract' });                    // the face
    for (const sd of [-1, 1]) C.box([sd * 0.3, cy - 0.12 * s - 0.2, 0], [0.11, 0.2, 0.3], 0.01, null, { mode: 'subtract' });   // sideburns
    T('hair', 0.02);
    if (kind === 'short') {
      for (let i = -2; i <= 2; i++) C.limb([i * 0.05, top + 0.006, r * 0.5], [i * 0.06 + 0.02, line + 0.01, r * 0.98], 0.03, 0.016);
      C.ell([0, top - 0.005, -0.01], [r + 0.012, 0.035, r + 0.012]);
    } else if (kind === 'spiky') {
      for (let i = 0; i < 9; i++) { const a = -1.2 + i * 0.3, x = Math.sin(a) * r * 0.75, z = Math.cos(a) * r * 0.55; C.limb([x * 0.8, top - 0.02, z * 0.7], [x * 1.15, top + 0.07 + (i % 2) * 0.03, z * 1.25 + 0.03], 0.035, 0.006); }
      for (let i = 0; i < 5; i++) { const a = PI + (i - 2) * 0.45; C.limb([Math.sin(a) * r * 0.6, top - 0.03, Math.cos(a) * r * 0.6], [Math.sin(a) * r * 1.1, top + 0.03, Math.cos(a) * r * 1.15], 0.035, 0.006); }
    } else if (kind === 'slick') {
      T('hair', 0.03);
      for (let i = -2; i <= 2; i++) { const x = i * 0.06; C.limb([x, line + 0.015, r * 0.92], [x * 0.9, top + 0.04, 0.0], 0.03, 0.035); C.limb([x * 0.9, top + 0.04, 0.0], [x * 0.85, top - 0.02, -r * 0.85], 0.035, 0.025); }
    } else if (kind === 'afro') {
      T('hair', 0.04);
      C.ell([0, top - 0.01, -0.015], [r + 0.06, 0.13, r + 0.06]);
    } else if (kind === 'bacon') {
      /*
       * The Pal Hair ("bacon hair"): a brown mop swept up and over to the character's right in
       * thick wavy locks, each like a rasher of bacon, the fringe lifting off the forehead.
       */
      A.colors.hairHi = o.hi || '#a8703e';
      const locks = [[-0.02, 0.0, 1.0], [0.07, -0.05, 0.9], [-0.1, 0.03, 0.85], [0.03, -0.1, 0.8], [0.13, -0.08, 0.75]];
      for (const [x0, z0, k] of locks) {
        const pts = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8, a = t * PI;
          const x = x0 + 0.07 - t * 0.2 + Math.sin(t * PI * 3) * 0.012;
          const y = top - 0.03 + Math.sin(a) * 0.075 * k + 0.012;
          const z = (r * 0.95 - t * r * 1.6) + z0 * 0.5;
          pts.push([x, y, z]);
        }
        for (let i = 0; i < pts.length - 1; i++) C.limb(pts[i], pts[i + 1], 0.04 * k, 0.038 * k);
      }
      // the fringe flicking up at the front
      C.limb([0.02, line + 0.02, r * 0.95], [-0.06, top + 0.05, r * 1.05], 0.035, 0.01);
      C.limb([0.09, line + 0.03, r * 0.9], [0.04, top + 0.03, r * 1.08], 0.03, 0.008);
    }
  }
  C.build(0.002, 1, obj);
};

/* ---------------- headwear ---------------- */
// a baseball cap (a Guest's): a six-panel crown and a curved brim
A.cap = function (o) {
  o = o || {};
  const H = Hd(), cy = H.c[1], r = H.r, s = st(), top = cy + H.hh, cut = cy + 0.34 * s;
  A.colors.cap = o.color || '#151517'; A.colors.brim = o.brim || o.color || '#151517';
  const obj = C.newObject('Cap');
  T('cap', 0.01);
  C.ell([0, cut, -0.004], [r + 0.017, top - cut + 0.03, r + 0.02]);
  C.box([0, cut - 0.2, 0], [0.4, 0.2, 0.4], 0, null, { mode: 'subtract' });
  C.ell([0, cut, -0.004], [r + 0.004, top - cut + 0.016, r + 0.007], null, { mode: 'subtract' });
  C.ell([0, top + 0.04, -0.004], [0.016, 0.01, 0.016]);
  T('brim', 0.004);
  C.ell([0, cut + 0.002, r * (o.back ? -0.78 : 0.78)], [r * 0.86, 0.0105, r * 0.82], [o.back ? -11 : 11, 0, 0]);
  C.build(0.0016, 1, obj);
};
// an officer's peaked cap: a tall crown with a band, a short black visor, a badge
A.peaked = function (o) {
  o = o || {};
  const H = Hd(), cy = H.c[1], r = H.r, top = cy + H.hh;
  A.colors.cap = o.color || '#2c4a8a'; A.colors.band = o.band || '#111111'; A.colors.brim = '#0e0e0e'; A.colors.badge = o.badge || '#e0b84a';
  const obj = C.newObject('Cap');
  T('band', 0.006); C.cyl([0, top - 0.035, -0.005], r + 0.018, 0.035, 0.01);
  T('cap', 0.01); C.ell([0, top + 0.03, -0.015], [r + 0.05, 0.05, r + 0.06]);
  C.box([0, top - 0.06, 0], [0.4, 0.04, 0.4], 0, null, { mode: 'subtract' });
  T('brim', 0.003); C.ell([0, top - 0.06, r * 0.82], [r * 0.82, 0.009, r * 0.5], [16, 0, 0]);
  T('badge', 0.002); C.ell([0, top + 0.01, r + 0.035], [0.028, 0.024, 0.01]);
  C.build(0.0016, 1, obj);
};
// a fur hat with flaps
A.ushanka = function (o) {
  o = o || {};
  const H = Hd(), cy = H.c[1], r = H.r, top = cy + H.hh;
  A.colors.fur = o.color || '#7a7570'; A.colors.cap = o.crown || '#3a3a3c'; A.colors.badge = o.badge || '#c8a040';
  const obj = C.newObject('Hat');
  T('cap', 0.02); C.ell([0, top + 0.01, -0.01], [r + 0.03, 0.08, r + 0.035]);
  C.box([0, top - 0.25, 0], [0.4, 0.2, 0.4], 0, null, { mode: 'subtract' });
  T('fur', 0.02); C.torus([0, top - 0.035, -0.01], r + 0.03, 0.04);
  for (const sd of [-1, 1]) C.box([sd * (r + 0.035), top - 0.12, -0.01], [0.03, 0.08, 0.1], 0.025);
  T('badge', 0.002); C.ell([0, top - 0.02, r + 0.07], [0.022, 0.022, 0.01]);
  C.build(0.0018, 1, obj);
};
// a soldier's helmet
A.helmet = function (o) {
  o = o || {};
  const H = Hd(), cy = H.c[1], r = H.r, top = cy + H.hh;
  A.colors.helmet = o.color || '#2c4a7a'; A.colors.band = o.band || '#111111';
  const obj = C.newObject('Helmet');
  T('helmet', 0.01); C.ell([0, top - 0.03, -0.01], [r + 0.045, 0.12, r + 0.05]);
  C.box([0, top - 0.33, 0], [0.4, 0.2, 0.4], 0, null, { mode: 'subtract' });
  C.ell([0, top - 0.03, -0.01], [r + 0.012, 0.09, r + 0.018], null, { mode: 'subtract' });
  T('band', 0.004); C.torus([0, top - 0.11, -0.01], r + 0.04, 0.012);
  C.build(0.0018, 1, obj);
};
A.beret = function (o) {
  o = o || {};
  const H = Hd(), cy = H.c[1], r = H.r, top = cy + H.hh;
  A.colors.cap = o.color || '#5a1a1a'; A.colors.badge = o.badge || '#e0b84a';
  const obj = C.newObject('Beret');
  T('cap', 0.02); C.ell([-0.03, top + 0.01, -0.01], [r + 0.04, 0.045, r + 0.03], [0, 0, -8]);
  C.box([0, top - 0.24, 0], [0.4, 0.22, 0.4], 0, null, { mode: 'subtract' });
  T('badge', 0.002); C.ell([0.09, top + 0.0, r + 0.0], [0.02, 0.022, 0.008]);
  C.build(0.0018, 1, obj);
};
// a hood pulled up over the head: the head's own shape grown, hollow, open at the face, with a
// soft point at the back of the crown and the fabric gathering at the neck
A.hood = function (o) {
  o = o || {};
  const H = Hd(), cy = H.c[1], r = H.r, top = cy + H.hh;
  A.colors.hood = o.color || '#3a5a3a';
  const obj = C.newObject('Hood');
  T('hood', 0.02);
  C.cyl([0, cy + 0.012, -0.012], r + 0.032, H.hh + 0.03, r * 0.55);
  C.limb([0, top - 0.02, -r * 0.45], [0, top + 0.012, -r * 0.95], 0.06, 0.02);
  C.cyl([0, cy + 0.004, 0], r + 0.008, H.hh + 0.012, r * 0.48, null, { mode: 'subtract' });
  C.box([0, cy - 0.02, r + 0.05], [r * 0.8, H.hh * 0.78, 0.09], 0.05, null, { mode: 'subtract' });          // the opening
  C.box([0, cy - H.hh - 0.2 + 0.035, 0], [0.4, 0.2, 0.4], 0, null, { mode: 'subtract' });
  T('hood', 0.012);
  for (const sd of [-1, 1]) C.limb([sd * r * 0.82, cy + H.hh * 0.6, r * 0.62], [sd * r * 0.86, cy - H.hh * 0.8, r * 0.6], 0.022, 0.018);   // the rim round the face
  C.build(0.002, 1, obj);
};
// a bandana tied round the forehead, its knot and tails at the back
A.bandana = function (o) {
  o = o || {};
  const H = Hd(), cy = H.c[1], r = H.r, top = cy + H.hh;
  A.colors.bandana = o.color || '#151515';
  const obj = C.newObject('Bandana');
  T('bandana', 0.006);
  C.cyl([0, cy + (o.y || 0.12), 0], r + 0.012, 0.03, 0.01);
  C.cyl([0, cy + (o.y || 0.12), 0], r - 0.004, 0.05, 0.0, null, { mode: 'subtract' });
  T('bandana', 0.01); C.ell([0, cy + (o.y || 0.12), -r - 0.02], [0.03, 0.025, 0.02]);
  C.limb([0.01, cy + (o.y || 0.12) - 0.01, -r - 0.03], [0.05, cy - 0.05, -r - 0.07], 0.02, 0.012);
  C.limb([-0.01, cy + (o.y || 0.12) - 0.01, -r - 0.03], [-0.04, cy - 0.07, -r - 0.06], 0.02, 0.012);
  void top;
  C.build(0.0018, 1, obj);
};

/* ---------------- face gear ---------------- */
A.shades = function (o) {
  o = o || {};
  const H = Hd(), cy = H.c[1], r = H.r, s = st(), y = cy + 0.11 * s;
  A.colors.lens = o.lens || '#0c0c0e'; A.colors.frame = o.frame || '#d8b040';
  const obj = C.newObject('Shades');
  T('lens', 0.004);
  for (const sd of [-1, 1]) C.ell([sd * 0.075, y, r + 0.012], [0.06, 0.038, 0.012], [0, sd * 12, 0]);
  T('frame', 0.002);
  C.limb([-0.03, y + 0.01, r + 0.022], [0.03, y + 0.01, r + 0.022], 0.006);
  for (const sd of [-1, 1]) C.limb([sd * 0.13, y + 0.01, r + 0.005], [sd * (r + 0.008), y + 0.012, 0.0], 0.006);
  C.build(0.0012, 1, obj);
};
A.glasses = function (o) {
  o = o || {};
  const H = Hd(), cy = H.c[1], r = H.r, s = st(), y = cy + 0.11 * s;
  A.colors.frame = o.frame || '#1a1a1a';
  const obj = C.newObject('Glasses');
  T('frame', 0.002);
  for (const sd of [-1, 1]) C.torus([sd * 0.075, y, r + 0.014], 0.042, 0.006, [90, 0, 0]);
  C.limb([-0.033, y + 0.01, r + 0.016], [0.033, y + 0.01, r + 0.016], 0.005);
  for (const sd of [-1, 1]) C.limb([sd * 0.117, y + 0.005, r + 0.008], [sd * (r + 0.008), y + 0.01, 0.0], 0.005);
  C.build(0.0012, 1, obj);
};
A.eyepatch = function (o) {
  o = o || {};
  const H = Hd(), cy = H.c[1], r = H.r, s = st(), y = cy + 0.11 * s, sd = o.side === 'R' ? -1 : 1;
  A.colors.patch = '#0e0e0e';
  const obj = C.newObject('Patch');
  T('patch', 0.004);
  C.ell([sd * 0.074, y, r + 0.008], [0.048, 0.044, 0.012]);
  C.cyl([0, y + 0.03, 0], r + 0.006, 0.006, 0.0, [-12 * sd, 0, 18 * sd]);
  C.cyl([0, y + 0.03, 0], r - 0.004, 0.012, 0.0, [-12 * sd, 0, 18 * sd], { mode: 'subtract' });
  C.build(0.0014, 1, obj);
};

/* ---------------- jewellery and held things ---------------- */
// a heavy chain round the neck lying on the chest: one continuous rope of links and a pendant
A.chain = function (o) {
  o = o || {};
  const D = B.D, s = D.st, y = D.y.torso[1] * s - 0.012, fz = D.P.td * s;
  A.colors.chain = o.color || '#e6be3c';
  const obj = C.newObject('Chain');
  T('chain', 0.004);
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const a = -PI * 0.9 + i / 24 * PI * 1.8, x = Math.sin(a) * 0.13;
    const front = Math.max(0, Math.cos(a));
    pts.push([x, y - front * 0.075 + 0.008, Math.cos(a) * fz * 0.9 + front * 0.016]);
  }
  for (let i = 0; i < pts.length - 1; i++) C.limb(pts[i], pts[i + 1], 0.0075);
  for (let i = 0; i < pts.length; i += 2) C.ell(pts[i], [0.011, 0.009, 0.011]);
  const bottom = pts[12];
  C.limb(bottom, [0, bottom[1] - 0.03, bottom[2] + 0.003], 0.005);
  C.ell([0, bottom[1] - 0.055, bottom[2] + 0.006], [0.028, 0.032, 0.01]);
  C.build(0.0012, 1, obj);
  return { at: [0, bottom[1] - 0.04, bottom[2]], bone: 'Chest' };
};
// a sword gripped in the right fist, blade forward (T-pose: the hand is far out along -x)
A.sword = function (o) {
  o = o || {};
  const D = B.D, s = D.st, hx = -(D.arm.tip - 0.12) * s, y = D.pivot[1] * s - 0.01;
  A.colors.blade = o.blade || '#c8ccd2'; A.colors.hilt = o.hilt || '#1a1a1a'; A.colors.guard = o.guard || '#8a1a1a';
  const obj = C.newObject('Sword');
  T('hilt', 0.003); C.cyl([hx, y, 0.03], 0.018, 0.11, 0.006, [90, 0, 0]);
  T('guard', 0.003); C.box([hx, y, 0.15], [0.06, 0.018, 0.012], 0.006);
  T('blade', 0.002); C.box([hx, y, 0.15 + 0.45], [0.026, 0.008, 0.44], 0.004);
  C.limb([hx, y, 1.03], [hx, y, 1.08], 0.012, 0.002);
  C.build(0.0014, 1, obj);
  return { at: [hx, y, 0.6], bone: 'Hand.R' };                 // on the blade, clear of the hand
};
A.pistol = function (o) {
  o = o || {};
  const D = B.D, s = D.st, hx = -(D.arm.tip - 0.12) * s, y = D.pivot[1] * s - 0.01;
  A.colors.gun = o.color || '#202022';
  const obj = C.newObject('Pistol');
  T('gun', 0.003);
  C.box([hx, y - 0.04, 0.02], [0.016, 0.05, 0.022], 0.005, [-15, 0, 0]);
  C.box([hx, y + 0.02, 0.09], [0.017, 0.022, 0.1], 0.004);
  C.build(0.0012, 1, obj);
  return { at: [hx, y + 0.02, 0.17], bone: 'Hand.R' };          // on the barrel, clear of the hand
};

/* ---------------- paint for everything above ---------------- */
A.paint = function (tag, x, y, z, nx, ny, nz) {
  const c = A.colors;
  const sheen = (base, k) => { const up = Math.max(0, ny * 0.7 + nz * 0.3); return mix(base, [1, 1, 1], up * (k || 0.12)); };
  switch (tag) {
    case 'hair': {
      const base = HEX(c.hair), hi = c.hairHi ? HEX(c.hairHi) : mix(base, [1, 1, 1], 0.3);
      if (c.hairHi) {                                       // bacon: light and dark bands along each lock
        const band = 0.5 + 0.5 * Math.sin((z * 32 + x * 9) * 1.0);
        return sheen(mix(base, hi, band > 0.62 ? 0.75 : 0.0), 0.15);
      }
      const streak = 0.5 + 0.5 * Math.sin((x * 1.2 + y * 0.6 - z) * 80);
      return mix(mix(base.map((v) => v * 0.7), base, Math.min(1, 0.4 + Math.max(0, ny))), hi, Math.max(0, ny * 0.7 + nz * 0.2 - 0.45) * 1.5 * (0.6 + 0.4 * streak));
    }
    case 'cap': return sheen(HEX(c.cap), 0.08);
    case 'brim': return HEX(c.brim || c.cap);
    case 'band': return HEX(c.band);
    case 'badge': return sheen(HEX(c.badge), 0.4);
    case 'fur': return mix(HEX(c.fur), HEX(c.fur).map((v) => v * 0.7), N(x, y, z, 400));
    case 'helmet': return sheen(K.metal(HEX(c.helmet), x, y, z), 0.15);
    case 'hood': return sheen(HEX(c.hood), 0.06);
    case 'bandana': return HEX(c.bandana);
    case 'lens': return sheen(HEX(c.lens), 0.35);
    case 'frame': return sheen(HEX(c.frame), 0.3);
    case 'patch': return HEX(c.patch);
    case 'chain': return sheen(HEX(c.chain), 0.5);
    case 'blade': return sheen(HEX(c.blade), 0.45);
    case 'hilt': return HEX(c.hilt);
    case 'guard': return sheen(HEX(c.guard), 0.2);
    case 'gun': return sheen(HEX(c.gun), 0.2);
    default: return null;
  }
};
