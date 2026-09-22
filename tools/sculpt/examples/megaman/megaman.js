// Mega Man, sculpted in SculptFree. Run: node build.mjs (from this folder)
M.app.newScene('sphere', 5, true);
const sides = [1, -1];
const T = (t) => (M.tag = t);
// ---------- 1. block out from shapes ----------
T('helmet'); M.part('sphere', [0, 0, 0], 1.0);
T(null);     M.part('roundbox', [0, -0.27, 0.42], [0.60, 0.62, 0.5], [0,0,0], 'subtract');   // face opening
T('face');   M.part('sphere', [0, -0.1, 0.0], [0.86, 0.84, 0.84]);
             M.part('sphere', [0, -0.15, 0.405], 0.07);                                       // nose
T('ear');    M.part({cyl:[0.35,1,1]}, [0, -0.02, 0], [0.47, 1.1, 0.47], [0,0,90]);
T('light');  M.seg('capsule', [0,-0.36,0], [0,-0.6,0], 0.1);
             M.part('sphere', [0, -0.76, 0], [0.64, 0.56, 0.46], null, 'union', 0.02);      // chest
T('dark');   M.part('sphere', [0, -1.01, 0], [0.55, 0.32, 0.42], null, 'union', 0.02);     // shorts
for (const s of sides) {
  T('light'); M.part('sphere', [0.33*s, -0.64, 0], 0.28, null, 'union', 0.02);             // shoulder
              M.seg('capsule', [0.36*s,-0.66,0], [0.47*s,-0.9,0], 0.09, 1, 'union', 0.02);
              M.seg('capsule', [0.16*s,-1.02,0], [0.18*s,-1.62,0.0], 0.1, 1, 'union', 0.02);
  T('dark');  M.seg('cyl', [0.19*s,-1.92,0.01], [0.185*s,-1.53,0], 0.155, 1.18);               // boot
              M.part('sphere', [0.2*s, -1.93, 0.08], [0.34, 0.26, 0.52], null, 'union', 0.02);
  T(null);    M.part('box', [0.2*s, -2.16, 0.05], [0.5, 0.2, 0.8], null, 'subtract');         // flat sole
}
T('dark'); M.seg('cyl', [0.54,-1.14,0], [0.47,-0.9,0], 0.105, 1.4);                            // glove
           M.part('sphere', [0.56,-1.22,0.02], 0.27, null, 'union', 0.02);                     // fist
           M.seg('cyl', [-0.55,-1.28,0.02], [-0.47,-0.9,0], 0.13, 1.12);                       // Mega Buster
           M.seg('cyl', [-0.565,-1.34,0.02], [-0.55,-1.26,0.02], 0.105, 1);
T('muzzle'); M.seg('cyl', [-0.575,-1.4,0.02], [-0.55,-1.26,0.02], 0.065, 1, 'subtract');
M.weld(300, 4);

// ---------- 2. paint ----------
const C = { helmet: M.hex('#1d5fd9'), dark: M.hex('#1d5fd9'), ear: M.hex('#1d5fd9'), light: M.hex('#55c8fb'),
            face: M.hex('#fcd3b2'), muzzle: M.hex('#16223a'), default: M.hex('#1d5fd9') };
const W = [1,1,1], IRIS = M.hex('#2a78e0'), PUPIL = M.hex('#0d1624'), LINE = M.hex('#23262e'), LIP = M.hex('#b5505a');
const set = (o, c) => { o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; };
M.paintParts(C, (x, y, z, o, tag) => {
  if (tag === 'helmet' || tag === 'face') {                      // the shell is the outer surface; anything recessed is face
    const r = Math.hypot(x, y, z);
    const opening = Math.abs(x) < 0.3 && y < 0.045 && y > -0.6 && z > 0.16;   // where the subtract box cut the shell
    tag = (opening || (tag === 'face' && r < 0.497)) ? 'face' : 'helmet';
    set(o, C[tag]);
  }
  if (tag === 'helmet' && Math.abs(x) < 0.085 && y > 0.07 && z > 0.12) set(o, C.light);        // forehead stripe
  if (tag === 'ear' && Math.abs(x) > 0.53 && Math.hypot(y + 0.02, z) < 0.105) set(o, C.light);
  if (tag === 'face' && z > 0.28) {
    for (const s of sides) {
      const ex = 0.14 * s, ey = -0.075;
      const e = ((x - ex) / 0.088) ** 2 + ((y - ey) / 0.118) ** 2;
      if (e < 1.18 && (e > 1 || (y > ey + 0.07 && e > 0.82))) set(o, LINE);                   // outline, heavier on top
      else if (e <= 1) {
        set(o, W);
        const ix = ex - 0.012 * s, iy = ey - 0.012;
        const d = Math.hypot(x - ix, y - iy);
        if (d < 0.062) set(o, IRIS);
        if (d < 0.034) set(o, PUPIL);
        if (Math.hypot(x - (ix + 0.02), y - (iy + 0.028)) < 0.017) set(o, W);
      }
    }
    if (Math.abs(x) < 0.05 && Math.abs(y - (-0.31 + 4 * x * x)) < 0.009) set(o, LIP);            // mouth
  }
});

// ---------- 3. sculpt details ----------
M.opts({ dyntopo: false, strokeSmoothing: 0, pressureRadius: false, pressureStrength: false, falloff: 'smooth', autoSmooth: 0.2 });
// face: soft cheeks, a mouth line, brow lip under the helmet
M.opts({ symmetryX: true });
M.front([0, -0.2, 0], 0.6);
M.dab('inflate', [0.2, -0.26], 0.09, 0.25);
M.dab('inflate', [0.2, -0.26], 0.09, 0.25);
M.stroke('crease', [[-0.045, -0.302], [0, -0.312], [0.045, -0.302]], 0.018, 0.35);
// waist: tuck the belt line
M.front([0, -0.9, 0], 1.2); M.stroke('crease', [[-0.24, -0.9], [0.24, -0.9]], 0.03, 0.3);
M.back([0, -0.9, 0], 1.2);  M.stroke('crease', [[-0.24, -0.9], [0.24, -0.9]], 0.03, 0.3);
// boots: a groove under the cuff
M.opts({ symmetryX: true });
for (const v of ['front', 'back']) { M[v]([0, -1.6, 0], 0.8); M.stroke('crease', [[0.07, -1.61], [0.3, -1.61]], 0.025, 0.4); }
M.side([0, -1.6, 0], 0.8); M.stroke('crease', [[-0.13, -1.61], [0.13, -1.61]], 0.025, 0.4);
M.left([0, -1.6, 0], 0.8); M.stroke('crease', [[-0.13, -1.61], [0.13, -1.61]], 0.025, 0.4);
// fist: finger grooves (left hand only)
M.opts({ symmetryX: false });
M.front([0.56, -1.22, 0], 0.4);
for (const y of [-1.19, -1.235, -1.28]) M.stroke('crease', [[0.51, y], [0.61, y + 0.01]], 0.014, 0.4);
// buster: two rings round the barrel
for (const v of ['front', 'back']) { M[v]([-0.5, -1.1, 0], 0.6); for (const y of [-1.05, -1.2]) M.wstroke('crease', [[-0.62, y, 0], [-0.4, y + 0.02, 0]], 0.018, 0.4); }
M.app.set('cavity', 0.08); M.app.set('matcap', 'white');
console.log('# tris', M.tris());
