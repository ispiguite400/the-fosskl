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
  if (kind === 'bacon') return A.baconHair(o);
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
    }
  }
  C.build(0.002, 1, obj);
};

/*
 * The Pal Hair, the "bacon hair": the Roblox hair every Bacon wears. A brown mop of wide, flat,
 * wavy locks, each like a rasher of bacon with a light streak of fat down it. It parts on the
 * character's right; the locks sweep up from the part, over the crown and down the left side;
 * the fringe swoops across the forehead and curls up at the left temple; the back falls to the
 * nape in waves. Every lock is a ribbon laid on the head's surface (a rounded cylinder, so the
 * placement is exact), rippling in and out like bacon, narrow at its ends.
 * o.underHat flattens the crown so a hat (A.peaked with lift and wide) can sit on it.
 */
A.baconHair = function (o) {
  const H = Hd(), cy = H.c[1], r = H.r, hh = H.hh, V = C.v;
  A.colors.hair = o.color || '#7a4a26'; A.colors.hairHi = o.hi || '#c99a62'; A.colors.bacon = true;
  const obj = C.newObject('Hair');
  // the surface the locks lie on: the head grown a little, a cylinder with rounded edges
  const R0 = r + 0.014, H0 = hh + 0.014, rr = r * 0.45, O = H.c;
  const sdf = (x, y, z) => { const q0 = Math.hypot(x - O[0], z - O[2]) - (R0 - rr), q1 = Math.abs(y - O[1]) - (H0 - rr); return Math.hypot(Math.max(q0, 0), Math.max(q1, 0)) + Math.min(Math.max(q0, q1), 0) - rr; };
  const dirOf = (az, el) => [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  const surf = (az, el) => { const d = dirOf(az, el); let lo = 0, hi = 0.7; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (sdf(O[0] + d[0] * m, O[1] + d[1] * m, O[2] + d[2] * m) < 0) lo = m; else hi = m; } return V.addv(O, V.mul(d, lo)); };
  const nrm = (p) => { const e = 0.002; return V.norm([sdf(p[0] + e, p[1], p[2]) - sdf(p[0] - e, p[1], p[2]), sdf(p[0], p[1] + e, p[2]) - sdf(p[0], p[1] - e, p[2]), sdf(p[0], p[1], p[2] + e) - sdf(p[0], p[1], p[2] - e)]); };
  const smooth = (u) => u * u * (3 - 2 * u);
  const along = (path, t) => { const f = t * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f)), u = smooth(f - i); return [path[i][0] + (path[i + 1][0] - path[i][0]) * u, path[i][1] + (path[i + 1][1] - path[i][1]) * u]; };

  // 1. the shell under the locks: the head grown, clear of the face, ending at the ears and nape
  T('hair', 0.004);
  C.cyl(H.c, R0, H0, rr);
  const line = cy + 0.1;
  C.box([0, line - 0.3, r + 0.08], [r + 0.05, 0.3, 0.2], 0.02, [0, 0, -9], { mode: 'subtract' });             // the face: more forehead on the part side
  C.box([0, cy - 0.07 - 0.3, 0], [0.5, 0.3, 0.5], 0, null, { mode: 'subtract' });                            // below the nape
  for (const sd of [-1, 1]) C.box([sd * (r + 0.05), cy - 0.01 - 0.15, 0.1], [0.1, 0.15, 0.16], 0.02, null, { mode: 'subtract' });   // the ears

  // 2. one lock: a rippling ribbon along a path of (azimuth, elevation) points on the head
  const lock = (path, q) => {
    q = q || {};
    const n = q.n || 14, w0 = q.w || 0.075, th = q.th || 0.03, lift = q.lift || 0.002, amp = q.amp === undefined ? 0.006 : q.amp, wl = q.wl || 0.065;
    const pts = [], nn = [];
    let s0 = 0, prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n, [az, el] = along(path, t), p = surf(az, el), N0 = nrm(p);
      if (prev) s0 += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
      prev = p;
      const curl = q.curl ? q.curl * Math.pow(Math.max(0, (t - 0.7) / 0.3), 2) : 0, puff = (q.puff || 0) * (o.underHat ? 0 : 1) * Math.sin(PI * t);
      // under a hat the crown lies flat (the hat sits on it); the sides, back and fringe stay full
      const flat = o.underHat && p[1] > cy + hh * 0.75 ? 0.4 : 1;
      pts.push(V.addv(p, V.mul(N0, (lift + amp * Math.sin(s0 / wl * 2 * PI + (q.phase || 0))) * flat + th / 2 * (flat < 1 ? 0.7 : 1) + curl + puff)));
      nn.push(N0);
    }
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[i + 1], c = V.lerp(a, b, 0.5), len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const tg = V.norm(V.sub(b, a)), nm0 = V.norm(V.addv(nn[i], nn[i + 1])), nm = V.norm(V.sub(nm0, V.mul(tg, V.dot(nm0, tg)))), bn = V.cross(tg, nm);
      // a chain of flattened ovals, overlapping and blended: a thick, round-edged, rippling rasher
      const tm = (i + 0.5) / n, taper = 0.4 + 0.6 * Math.pow(Math.sin(PI * Math.min(1, tm * 1.12)), 0.6), w = w0 * taper;
      const Rm = C.basis(tg, nm, bn);
      T('hair', 0.012); C.ell(c, [len * 0.85, th / 2 * (0.7 + 0.3 * taper), w / 2], null, { R: Rm });
      if (q.streak !== false) { T('hairhi', 0.007); C.ell(V.addv(c, V.addv(V.mul(nm, th * 0.4 * (0.7 + 0.3 * taper)), V.mul(bn, w * 0.1))), [len * 0.95, th * 0.22, w * 0.13], null, { R: Rm }); }
    }
  };
  const B2 = PI;
  // the back, falling to the nape in broad waves, the ends curling out
  lock([[B2 - 1.0, 1.2], [B2 - 0.85, 0.55], [B2 - 0.75, -0.05], [B2 - 0.68, -0.34]], { phase: 0.3, streak: false, w: 0.11, amp: 0.004, curl: 0.012 });
  lock([[B2 - 0.45, 1.3], [B2 - 0.4, 0.6], [B2 - 0.34, -0.34]], { phase: 1.4, w: 0.105, amp: 0.004, curl: 0.014 });
  lock([[B2 + 0.05, 1.32], [B2 + 0.05, 0.6], [B2 + 0.05, -0.36]], { phase: 2.6, streak: false, w: 0.11, amp: 0.004, curl: 0.012 });
  lock([[B2 + 0.5, 1.28], [B2 + 0.45, 0.6], [B2 + 0.38, -0.34]], { phase: 2.2, w: 0.105, amp: 0.004, curl: 0.014 });
  lock([[B2 + 1.0, 1.2], [B2 + 0.9, 0.55], [B2 + 0.8, -0.22]], { phase: 0.9, streak: false, w: 0.1, amp: 0.004, curl: 0.01 });
  // the part side (the character's right) and the left side, over the ears
  lock([[-0.75, 1.05], [-1.2, 0.68], [-1.45, 0.18], [-1.52, 0.0]], { lift: 0.005, curl: 0.008, streak: false });
  lock([[-1.05, 1.15], [-1.6, 0.72], [-1.9, 0.22], [-2.02, 0.0]], { lift: 0.005, phase: 1.1 });
  lock([[0.95, 1.05], [1.35, 0.6], [1.6, 0.12], [1.7, -0.02]], { lift: 0.006, curl: 0.012, phase: 0.6 });
  lock([[1.35, 1.12], [1.85, 0.65], [2.1, 0.12], [2.22, -0.06]], { lift: 0.006, phase: 2.0, streak: false });
  // the crown: locks swept up from the part and back over to the left, full and high
  lock([[-1.9, 1.12], [-2.5, 1.35], [-3.48, 1.3], [-3.7, 0.85]], { lift: 0.006, puff: 0.018, phase: 0.4, w: 0.09 });
  lock([[-1.3, 1.18], [-1.4, 1.52], [2.6, 1.42], [3.0, 0.9]], { lift: 0.008, puff: 0.05, phase: 1.7, w: 0.085 });
  lock([[-0.85, 1.15], [-0.6, 1.5], [1.9, 1.45], [2.5, 0.95]], { lift: 0.012, puff: 0.06, phase: 2.6, w: 0.085 });
  lock([[-0.45, 1.1], [0.1, 1.42], [1.3, 1.3], [2.0, 0.9]], { lift: 0.016, puff: 0.055, phase: 0.2, curl: 0.01, w: 0.085 });
  // on the part side the hair is swept up and back off the forehead
  lock([[-0.22, 0.5], [-0.32, 0.88], [-0.5, 1.25]], { lift: 0.004, th: 0.026, w: 0.07, n: 9, phase: 1.9, streak: false });
  lock([[-0.62, 0.52], [-0.78, 0.9], [-0.98, 1.22]], { lift: 0.004, th: 0.026, w: 0.07, n: 9, phase: 0.5 });
  // the fringe: one big swoop across the forehead from the part, low over the left brow, curling up at the temple
  lock([[-0.5, 1.05], [-0.15, 0.78], [0.35, 0.56], [0.8, 0.44], [1.12, 0.56]], { lift: 0.016, w: 0.09, th: 0.034, curl: 0.03, puff: 0.012, phase: 0.7, n: 16 });
  C.build(0.0024, 1, obj);                     // the locks are big forms: a coarser grid keeps the sculpt small enough to ship
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
  const H = Hd(), cy = H.c[1], r = H.r + (o.wide || 0), top = cy + H.hh + (o.lift || 0);   // lift and wide: to sit on top of a full head of hair
  A.colors.cap = o.color || '#2c4a8a'; A.colors.band = o.band || '#111111'; A.colors.brim = '#0e0e0e'; A.colors.badge = o.badge || '#e0b84a';
  const obj = C.newObject('Cap');
  if (o.lift || o.wide) {
    // over a full head of hair (the Bacon General): the crown first and cut flat underneath; then the
    // band, so the cut can't eat it; the visor hangs off the band
    T('cap', 0.01); C.ell([0, top + 0.03, -0.015], [r + 0.05, 0.05, r + 0.06]);
    C.box([0, top - 0.06, 0], [0.4, 0.04, 0.4], 0, null, { mode: 'subtract' });
    T('band', 0.006); C.cyl([0, top - 0.035, -0.005], r + 0.018, 0.035, 0.01);
    T('brim', 0.003); C.ell([0, top - 0.064, r * 0.86], [r * 0.82, 0.009, r * 0.5], [16, 0, 0]);
  } else {
    // over short hair (the Army Captain): the cut takes the band down to a thin line, and the hair
    // shows under the crown, as the Captain was accepted; a full band would let the hair poke through
    T('band', 0.006); C.cyl([0, top - 0.035, -0.005], r + 0.018, 0.035, 0.01);
    T('cap', 0.01); C.ell([0, top + 0.03, -0.015], [r + 0.05, 0.05, r + 0.06]);
    C.box([0, top - 0.06, 0], [0.4, 0.04, 0.4], 0, null, { mode: 'subtract' });
    T('brim', 0.003); C.ell([0, top - 0.06, r * 0.82], [r * 0.82, 0.009, r * 0.5], [16, 0, 0]);
  }
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
      if (c.bacon) {                                        // bacon: warm brown, darker where the locks dip, a sheen on top
        const drift = mix(base, base.map((v) => v * 0.72), N(x, y, z, 26) * 0.9);
        return sheen(mix(drift, hi, Math.max(0, ny) * 0.12), 0.1);
      }
      const streak = 0.5 + 0.5 * Math.sin((x * 1.2 + y * 0.6 - z) * 80);
      return mix(mix(base.map((v) => v * 0.7), base, Math.min(1, 0.4 + Math.max(0, ny))), hi, Math.max(0, ny * 0.7 + nz * 0.2 - 0.45) * 1.5 * (0.6 + 0.4 * streak));
    }
    case 'hairhi': return sheen(mix(HEX(c.hairHi || '#c99a62'), [1, 0.92, 0.8], N(x, y, z, 60) * 0.25), 0.12);   // the streak of fat down each rasher
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
