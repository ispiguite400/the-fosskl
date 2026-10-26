/*
 * THE TERRIBLE — killer. Guest 666 ("Guest 666", ObliviousHD), renamed for this game.
 *
 * Subject:      the spirit of a Guest that never left: a Guest gone pitch black, red-eyed, silent.
 * Reference:    the film's Guest 666: a Guest's body and cap, entirely black, two glowing red eyes
 *               and nothing else on the face. Same Robloxian 2.0 package as Guest 1337 (STYLE.md).
 * Silhouette:   the Guest cap and its brim; a black R6 figure; the two red eyes (they glow in game).
 * Proportions:  5.5 studs at 0.33 m (1.81 m), as Guest 1337.
 * Pose:         T-POSE: arms straight out at shoulder height, palms down, thumbs forward.
 * Pieces:       torso, both arms, both legs, head, cap: each its own rigid piece on one bone.
 * Detail:       clothing drawn near-black on black (a Guest's tee and trousers, their seams and
 *               folds just catching the light); the eyes; the cap's panels and button.
 * Palette:      pitch black #0b0b0d, cloth #121215 / #0e0e10, seams #26262c, eyes #ff2a1a (accent).
 * Triangles:    4,500 (killer).
 * Skins:        default · classic (white eyes, the creepypasta) · inferno (charred, glowing cracks)
 */
const D = B.setup({ pkg: 'robloxian2' });
const SK = SKIN_ID, CLASSIC = SK === 'classic', INF = SK === 'inferno';
const SKINC = INF ? HEX('#141010') : HEX('#0b0b0d');
const dr = B.draw;
const EYE = CLASSIC ? ['#d8e4ff', '#ffffff', '#ffffff'] : INF ? ['#ff6a00', '#ffb020', '#fff2b0'] : ['#a80000', '#ff2a1a', '#ffc0b0'];

/* ---------------- the clothing: a Guest's tee and trousers, black on black ---------------- */
const SHIRT = INF ? '#171211' : '#121215', PANTS = INF ? '#120f0e' : '#0e0e10', SEAM = INF ? '#2a1e1a' : '#26262c', HI = 'rgba(120,120,140,0.10)';
// glowing cracks for the inferno skin: a few branching lines
let cseed = 3;
const rand = () => (cseed = (cseed * 16807) % 2147483647) / 2147483647;
const cracks = (g, W, H, n) => {
  if (!INF) return;
  for (let i = 0; i < n; i++) {
    let x = rand() * W, y = rand() * H, a = rand() * PI * 2;
    g.strokeStyle = '#ff7a10'; g.lineWidth = 0.006 + rand() * 0.004; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 7; k++) { a += (rand() - 0.5) * 1.4; x += Math.cos(a) * 0.03; y += Math.sin(a) * 0.03; g.lineTo(x, y); }
    g.stroke();
    g.strokeStyle = '#ffd060'; g.lineWidth = 0.0025; g.stroke();
  }
};
const torso = (g, face, W, H) => {
  g.fillStyle = SHIRT; g.fillRect(0, 0, W, H);
  dr.shade(g, 0, 0, W, H, HI, 'rgba(0,0,0,0.35)');
  if (face === 'front') {
    g.fillStyle = PANTS; g.beginPath(); g.moveTo(W * 0.37, 0); g.quadraticCurveTo(W / 2, H * 0.1, W * 0.63, 0); g.fill();   // the collar
    dr.lines(g, [[W * 0.37, 0, W / 2, H * 0.1, W * 0.63, 0]], SEAM, 0.006);
    // the tee's folds: a pull from each shoulder down to the waist, a sag at the belly
    dr.lines(g, [[W * 0.2, H * 0.12, W * 0.34, H * 0.42, W * 0.38, H * 0.7], [W * 0.8, H * 0.12, W * 0.66, H * 0.42, W * 0.62, H * 0.7], [W * 0.3, H * 0.62, W * 0.5, H * 0.66, W * 0.7, H * 0.61]], SEAM, 0.005);
  }
  if (face === 'back') dr.lines(g, [[W * 0.3, H * 0.2, W * 0.5, H * 0.3, W * 0.7, H * 0.2]], SEAM, 0.005);
  const wy = H * D.torsoSplit.waist;
  g.fillStyle = PANTS; g.fillRect(0, wy, W, H - wy);                                       // the trousers' top
  dr.lines(g, [[0, wy, W, wy]], SEAM, 0.007);
  if (face === 'front') dr.lines(g, [[W / 2, wy + 0.01, W / 2, H]], SEAM, 0.005);         // the fly seam
  cracks(g, W, H, face === 'front' || face === 'back' ? 6 : 2);
};
const arm = (g, part, face, W, H) => {
  // short sleeves to the elbow; the black arm below
  g.fillStyle = SKINC.map ? '#0b0b0d' : '#0b0b0d'; g.fillRect(0, 0, W, H);
  const sl = H * 0.36;
  g.fillStyle = SHIRT; g.fillRect(0, 0, W, sl);
  dr.lines(g, [[0, sl, W, sl]], SEAM, 0.006);
  dr.shade(g, 0, 0, W, sl, HI, 'rgba(0,0,0,0.3)');
  cracks(g, W, H, 2);
};
const leg = (g, part, face, W, H) => {
  g.fillStyle = PANTS; g.fillRect(0, 0, W, H);
  dr.shade(g, 0, 0, W, H, HI, 'rgba(0,0,0,0.3)');
  if (face === 'front') dr.lines(g, [[W * 0.25, H * 0.34, W * 0.5, H * 0.37, W * 0.75, H * 0.33], [W * 0.3, H * 0.6, W * 0.5, H * 0.62, W * 0.7, H * 0.59]], SEAM, 0.004);
  const a = H * D.legSplit.ankle;
  g.fillStyle = '#070708'; g.fillRect(0, a, W, H - a);                                      // black shoes
  dr.lines(g, [[0, a, W, a]], SEAM, 0.005);
  cracks(g, W, H, 3);
};
B.clothes(function (g, part, face, W, H) {
  if (part === 'torso') torso(g, face, W, H);
  else if (part.startsWith('arm')) arm(g, part, face, W, H);
  else leg(g, part, face, W, H);
});

/* ---------------- the face: two red eyes, nothing else ---------------- */
B.decal(function (g) {
  // set where Guest's sit (centres 0.35 studs apart, 0.11 above the middle), bigger and tilted
  // down toward the nose: a glare. A red haze around each, a dark rim, a hot core, a pale centre.
  for (const sd of [-1, 1]) {
    const cx = 256 + sd * 76, cy = 218, tilt = sd * 0.38;
    const halo = g.createRadialGradient(cx, cy, 10, cx, cy, 70);
    halo.addColorStop(0, EYE[1] + '88'); halo.addColorStop(1, EYE[1] + '00');
    g.fillStyle = halo; g.beginPath(); g.ellipse(cx, cy, 72, 60, tilt, 0, PI * 2); g.fill();
    g.fillStyle = EYE[0]; g.beginPath(); g.ellipse(cx, cy, 46, 34, tilt, 0, PI * 2); g.fill();
    g.fillStyle = EYE[1]; g.beginPath(); g.ellipse(cx, cy, 37, 26, tilt, 0, PI * 2); g.fill();
    g.fillStyle = EYE[2]; g.beginPath(); g.ellipse(cx + sd * 4, cy + 2, 17, 11, tilt, 0, PI * 2); g.fill();
    // the lid's hard upper edge: black cut slanting down toward the nose
    g.fillStyle = '#0b0b0d'; g.beginPath(); g.moveTo(cx - 60, cy - 24 + sd * 20); g.lineTo(cx + 60, cy - 24 - sd * 20); g.lineTo(cx + 60, cy - 90); g.lineTo(cx - 60, cy - 90); g.fill();
  }
  if (INF) { g.strokeStyle = '#ff7a10'; g.lineWidth = 6; g.beginPath(); g.moveTo(190, 330); g.lineTo(220, 360); g.lineTo(256, 340); g.lineTo(292, 362); g.lineTo(322, 330); g.stroke(); }
});

C.autoPaint = function (tag, x, y, z, nx, ny, nz) {
  switch (tag) {
    case 'torso': case 'arm': case 'leg': return B.clothColor(x, y, z, nx, ny, nz, SKINC);
    case 'face': return B.faceColor(x, y, z, SKINC);
    case 'cap': {
      // six panels meeting at the button; the brim a touch lighter where it faces up
      const H = D.head, a = Math.atan2(x, z - H.c[2]);
      const seam = Math.abs(Math.sin(a * 3)) < 0.06 && y > H.c[1] + 0.06 ? 0.55 : 1;
      const base = INF ? [0.07, 0.05, 0.045] : CLASSIC ? [0.09, 0.09, 0.1] : [0.06, 0.06, 0.07];
      const lift = Math.max(0, ny) * 0.05;
      return base.map((v) => (v + lift) * seam);
    }
    case 'brim': return INF ? [0.08, 0.05, 0.04] : [0.055, 0.055, 0.065];
    default: return [1, 0, 1];
  }
};

/* ---------------- the body, the head, the cap ---------------- */
B.body();
{
  const H = C.newObject('Head');
  T('face', 0);
  B.headForm(0);
  C.build(0.0018, 1, H);
}
{
  /*
   * The Guest cap: a six-panel crown hugging the top of the head down to just above the eyes,
   * a button on top and a short, stiff brim pointing forward and a little down.
   */
  const CAP = C.newObject('Cap');
  const H = D.head, cy = H.c[1], r = H.r, st = D.st, top = cy + H.hh;
  const cut = cy + 0.34 * st;
  T('cap', 0.01);
  C.ell([0, cut, -0.004], [r + 0.017, top - cut + 0.03, r + 0.02]);
  C.box([0, cut - 0.2, 0], [0.4, 0.2, 0.4], 0, null, { mode: 'subtract' });               // open underneath
  C.ell([0, cut, -0.004], [r + 0.004, top - cut + 0.016, r + 0.007], null, { mode: 'subtract' });   // hollow, so it sits on the head
  C.ell([0, top + 0.04, -0.004], [0.016, 0.01, 0.016]);                                   // the button
  // the brim: a flattened oval whose front edge curves round, tipped down a little; its back half
  // is buried in the crown
  T('brim', 0.004);
  C.ell([0, cut + 0.002, r * 0.78], [r * 0.86, 0.0105, r * 0.82], [11, 0, 0]);
  C.build(0.0016, 1, CAP);
}

B.finish({ ao: 0.35, dark: 1.2 });
B.joints([]);
