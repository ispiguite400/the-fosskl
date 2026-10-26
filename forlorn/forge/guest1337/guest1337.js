/*
 * GUEST 1337 — survivor. "The Last Guest" (ObliviousHD), as he looks in the MOVIE.
 *
 * Subject:      the last Guest, veteran of the war with the Bacon Empire.
 * Reference:    the user's movie render (forge/STYLE.md): the Robloxian 2.0 body, WHITE skin, no
 *               beard; navy-blue hair swept up into a quiff; stern brows, black oval eyes, a flat
 *               mouth; UCP digital camo upper sleeves and trousers; a tan plate carrier drawn over
 *               the torso (flag patch, "USM" name tape, MOLLE, pouches); sleeves rolled at the elbow
 *               (a white band with a black stripe), white forearms; dark grey gloves; dark olive
 *               laced combat boots.
 * Silhouette:   Robloxian 2.0: broad tapered torso, rounded segments, the blue quiff.
 * Proportions:  5.5 studs at 0.33 m (1.81 m).
 * Pose:         T-POSE: arms straight out at shoulder height, palms down, thumbs forward.
 * Pieces:       upper/lower torso, upper arms, forearms, hands, thighs, shins, feet, head + hair:
 *               each its own rigid piece on one bone.
 * Detail:       the drawn clothing (templates below) and the face decal; the hair is sculpted.
 * Palette:      UCP greys and tans, tan carrier #c2a77a, olive boots #4d4f40, grey gloves #6d6e70,
 *               white skin #f2f2f0, navy hair #1f2b8c (the accent).
 * Triangles:    4,500 (playable survivor).
 * Skins:        default · prisoner (Guest Prison jumpsuit) · winter (snow camo)
 */
const D = B.setup({ pkg: 'robloxian2' });
const SK = SKIN_ID, PRIS = SK === 'prisoner', WIN = SK === 'winter';
const SKINC = HEX('#f2f2f0');
const HAIR = HEX('#1f2b8c'), HAIR_HI = HEX('#4253c0'), HAIR_LO = HEX('#0f1650');
const dr = B.draw;

/* ---------------- the clothing, drawn like a Roblox shirt and pants ---------------- */
const UCP = WIN ? ['#d9dbd8', '#b9bdbb', '#eeefec', '#8e9492'] : ['#9d9a84', '#767a67', '#c4c0a9', '#545850'];
const TAN = WIN ? '#a7adaf' : '#c2a77a', TAN_D = WIN ? '#7b8285' : '#a48a5f', TAN_L = WIN ? '#c5cacc' : '#d6c098', LINE = WIN ? '#3c4245' : '#4f3c27';
const BOOT = WIN ? '#5b5d5e' : '#4d4f40', GLOVE = '#6d6e70';
let seed = 11;
const camo = (g, x, y, w, h) => dr.digital(g, x, y, w, h, UCP, 0.0165, seed++);
const molle = (g, x, y, w, rows, h) => {
  for (let i = 0; i < rows; i++) {
    const yy = y + i * h * 1.65;
    g.fillStyle = TAN_D; g.fillRect(x, yy, w, h);
    g.strokeStyle = LINE; g.lineWidth = 0.0022; g.strokeRect(x, yy, w, h);
    g.beginPath(); for (let xx = x + 0.022; xx < x + w - 0.004; xx += 0.022) { g.moveTo(xx, yy); g.lineTo(xx, yy + h); } g.stroke();
  }
};
const pouch = (g, x, y, w, h) => {
  dr.panel(g, x, y, w, h, TAN, LINE, 0.0038, TAN_L);
  dr.shade(g, x + 0.004, y + h * 0.5, w - 0.008, h * 0.5 - 0.004, 'rgba(0,0,0,0)', 'rgba(60,40,20,0.28)');
  dr.panel(g, x - 0.002, y, w + 0.004, h * 0.3, TAN_D, LINE, 0.0038);
  g.fillStyle = LINE; g.fillRect(x + w / 2 - 0.007, y + h * 0.24, 0.014, 0.012);
};
const flag = (g, x, y, w, h) => {
  for (let i = 0; i < 7; i++) { g.fillStyle = i % 2 ? '#c7c7c2' : '#8c8d89'; g.fillRect(x, y + (h / 7) * i, w, h / 7 + 0.0005); }
  g.fillStyle = '#6a6c6a'; g.fillRect(x, y, w * 0.42, h * 0.55);
  g.fillStyle = '#a2a4a1';
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) g.fillRect(x + w * 0.04 + i * w * 0.095, y + h * 0.08 + j * h * 0.15, w * 0.022, w * 0.022);
  g.strokeStyle = LINE; g.lineWidth = 0.004; g.strokeRect(x, y, w, h);
};

// a leg, hip at the top: camo trousers, the boot over the shin and foot
const leg = (g, part, face, W, H) => {
  if (face === 'top') { camo(g, 0, 0, W, H); return; }
  if (face === 'bottom') { g.fillStyle = '#26241f'; g.fillRect(0, 0, W, H); return; }
  if (PRIS) {
    g.fillStyle = '#e0702a'; g.fillRect(0, 0, W, H);
    dr.shade(g, 0, 0, W, H, 'rgba(255,220,180,0.1)', 'rgba(90,30,0,0.25)');
    const a = H * D.legSplit.ankle;
    g.fillStyle = '#2b2b2b'; g.fillRect(0, a, W, H - a); g.fillStyle = '#efefea'; g.fillRect(0, H - 0.03, W, 0.03);   // slip-on shoes
    return;
  }
  camo(g, 0, 0, W, H);
  const outer = (part === 'legL' && face === 'left') || (part === 'legR' && face === 'right');
  if (outer) {                                                        // the cargo pocket on the outer thigh
    dr.panel(g, W * 0.15, H * 0.16, W * 0.7, H * 0.17, null, 'rgba(45,45,35,0.8)', 0.0035);
    dr.panel(g, W * 0.13, H * 0.15, W * 0.74, H * 0.045, 'rgba(70,70,55,0.35)', 'rgba(45,45,35,0.8)', 0.0035);
  }
  if (face === 'front') dr.lines(g, [[W * 0.2, H * 0.36, W * 0.5, H * 0.39, W * 0.8, H * 0.35], [W * 0.25, H * 0.44, W * 0.5, H * 0.46, W * 0.75, H * 0.43]], 'rgba(40,40,30,0.4)', 0.004);
  dr.shade(g, 0, 0, W, H * 0.06, 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0)');
  // the boot: from just below the knee to the sole
  const top = H * 0.6;
  g.fillStyle = BOOT; g.fillRect(0, top, W, H - top);
  dr.shade(g, 0, top, W, H - top, 'rgba(255,255,230,0.12)', 'rgba(10,10,0,0.35)');
  dr.lines(g, [[0, top + 0.004, W * 0.35, top + 0.018, W * 0.65, top - 0.002, W, top + 0.01]], 'rgba(20,20,10,0.7)', 0.006);   // trousers tucked in
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.004; g.strokeRect(0.002, top, W - 0.004, H - top - 0.002);
  if (face === 'front') {
    const cx = W / 2, a = H * D.legSplit.ankle;
    g.strokeStyle = '#a5946b'; g.lineWidth = 0.005;                  // laces criss-crossing up the shin
    for (let y = top + 0.03; y < a - 0.02; y += 0.026) { g.beginPath(); g.moveTo(cx - 0.04, y); g.lineTo(cx + 0.04, y + 0.026); g.moveTo(cx + 0.04, y); g.lineTo(cx - 0.04, y + 0.026); g.stroke(); }
    g.fillStyle = '#1e1f18';
    for (let y = top + 0.03; y < a - 0.01; y += 0.026) for (const sx of [-1, 1]) { g.beginPath(); g.arc(cx + sx * 0.045, y, 0.0045, 0, PI * 2); g.fill(); }
    dr.lines(g, [[W * 0.1, a + 0.02, W / 2, a + 0.0, W * 0.9, a + 0.02]], 'rgba(0,0,0,0.5)', 0.005);   // the toe cap
    g.fillStyle = 'rgba(255,255,240,0.18)'; g.beginPath(); g.ellipse(W * 0.32, H - 0.035, 0.035, 0.012, -0.15, 0, PI * 2); g.fill();
  }
  g.fillStyle = '#26241f'; g.fillRect(0, H - 0.026, W, 0.026);                         // the sole
};
// an arm, shoulder at the top: camo sleeve to the elbow, the rolled cuff, white forearm, glove
const arm = (g, part, face, W, H) => {
  const e = H * D.armSplit.elbow, w = H * D.armSplit.wrist;
  if (face === 'top') { if (PRIS) { g.fillStyle = '#e0702a'; g.fillRect(0, 0, W, H); } else camo(g, 0, 0, W, H); return; }
  if (face === 'bottom') { g.fillStyle = PRIS ? '#00000000' : GLOVE; g.fillRect(0, 0, W, H); return; }
  if (PRIS) {
    g.fillStyle = '#e0702a'; g.fillRect(0, 0, W, w - 0.02);
    dr.shade(g, 0, 0, W, w, 'rgba(255,220,180,0.1)', 'rgba(90,30,0,0.25)');
    g.fillStyle = '#b4531c'; g.fillRect(0, w - 0.04, W, 0.02);
    return;                                                          // bare white hands below the cuff
  }
  camo(g, 0, 0, W, e + 0.01);
  dr.shade(g, 0, e - 0.06, W, 0.06, 'rgba(0,0,0,0)', 'rgba(25,25,20,0.3)');
  const r0 = e + 0.012, r1 = e + 0.075;                              // the rolled cuff on top of the forearm
  g.fillStyle = '#ededea'; g.fillRect(0, r0, W, r1 - r0);
  g.fillStyle = '#151515'; g.fillRect(0, r0 + (r1 - r0) * 0.42, W, (r1 - r0) * 0.22);
  dr.lines(g, [[0, r0 + 0.002, W, r0 + 0.002], [0, r1, W, r1]], 'rgba(30,30,30,0.8)', 0.004);
  g.fillStyle = '#151515'; g.fillRect(0, w - 0.03, W, 0.03);                            // the glove's cuff
  g.fillStyle = GLOVE; g.fillRect(0, w, W, H - w);                                       // the glove
  dr.shade(g, 0, w, W, H - w, 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.3)');
  if (face === 'left' || face === 'right') dr.lines(g, [[W * 0.2, H - 0.05, W * 0.8, H - 0.05]], 'rgba(0,0,0,0.25)', 0.004);
};
const torso = (g, face, W, H) => {
  const wy = H * D.torsoSplit.waist;
  if (PRIS) {
    g.fillStyle = '#e0702a'; g.fillRect(0, 0, W, H);
    dr.shade(g, 0, 0, W, H, 'rgba(255,220,180,0.12)', 'rgba(90,30,0,0.22)');
    if (face === 'front') {
      g.fillStyle = '#b4531c'; g.beginPath(); g.moveTo(W * 0.38, 0); g.lineTo(W * 0.5, H * 0.16); g.lineTo(W * 0.62, 0); g.fill();
      g.fillStyle = '#f2f2f0'; g.beginPath(); g.moveTo(W * 0.42, 0); g.lineTo(W * 0.5, H * 0.12); g.lineTo(W * 0.58, 0); g.fill();
      g.strokeStyle = '#b4531c'; g.lineWidth = 0.005; g.beginPath(); g.moveTo(W * 0.5, H * 0.16); g.lineTo(W * 0.5, H); g.stroke();
      dr.panel(g, W * 0.6, H * 0.24, W * 0.25, H * 0.1, '#f2f1ec', '#333', 0.003);
      dr.text(g, '1337', W * 0.725, H * 0.29, 0.045, '#111');
      dr.lines(g, [[W * 0.1, H * 0.5, W * 0.3, H * 0.6, W * 0.38, H * 0.9]], 'rgba(110,40,5,0.4)', 0.005);
    }
    g.fillStyle = '#b4531c'; g.fillRect(0, wy - 0.01, W, 0.02);
    return;
  }
  camo(g, 0, 0, W, H);
  if (face === 'front' || face === 'back') {
    const L = W * 0.16, R = W * 0.84;
    // the carrier, its shoulder straps running up over the shoulders
    g.fillStyle = TAN; g.fillRect(L, H * 0.12, R - L, H - H * 0.12);
    g.fillRect(W * 0.2, 0, W * 0.15, H * 0.14); g.fillRect(W * 0.65, 0, W * 0.15, H * 0.14);
    g.strokeStyle = LINE; g.lineWidth = 0.0045;
    g.strokeRect(L, H * 0.12, R - L, H - H * 0.12 - 0.003);
    g.strokeRect(W * 0.2, 0, W * 0.15, H * 0.13); g.strokeRect(W * 0.65, 0, W * 0.15, H * 0.13);
    if (face === 'front') {
      g.fillStyle = '#f0f0ee'; g.beginPath(); g.moveTo(W * 0.36, 0); g.quadraticCurveTo(W / 2, H * 0.13, W * 0.64, 0); g.fill();   // the neck
      dr.panel(g, W * 0.33, H * 0.14, W * 0.34, H * 0.62, TAN, LINE, 0.004, TAN_L);   // the plate
      flag(g, W * 0.38, H * 0.17, W * 0.24, H * 0.13);
      dr.panel(g, W * 0.39, H * 0.32, W * 0.22, H * 0.065, TAN_D, LINE, 0.0035);
      dr.text(g, 'USM', W * 0.5, H * 0.353, 0.032, '#2b2015');
      molle(g, W * 0.345, H * 0.42, W * 0.31, 4, 0.015);
      molle(g, L + 0.01, H * 0.22, W * 0.15, 7, 0.015);
      molle(g, R - W * 0.15 - 0.01, H * 0.22, W * 0.15, 7, 0.015);
      for (const px of [0.36, 0.5, 0.64]) pouch(g, W * px - W * 0.065, wy - H * 0.05, W * 0.13, H * 0.23);   // magazine pouches over the belt
      pouch(g, L + 0.006, wy - H * 0.02, W * 0.13, H * 0.2); pouch(g, R - W * 0.13 - 0.006, wy - H * 0.02, W * 0.13, H * 0.2);
    } else {
      dr.panel(g, W * 0.24, H * 0.16, W * 0.52, H * 0.66, TAN, LINE, 0.004, TAN_L);
      molle(g, W * 0.26, H * 0.22, W * 0.48, 9, 0.015);
      dr.panel(g, W / 2 - 0.05, H * 0.13, 0.1, 0.035, TAN_D, LINE, 0.003);              // the drag handle
    }
    dr.shade(g, 0, H * 0.5, W, H * 0.5, 'rgba(0,0,0,0)', 'rgba(50,35,15,0.18)');
  } else if (face === 'left' || face === 'right') {
    dr.panel(g, 0, H * 0.34, W, H * 0.66, TAN, LINE, 0.004);                            // the cummerbund
    molle(g, 0.012, H * 0.38, W - 0.024, 7, 0.015);
  } else if (face === 'top') {
    for (const sx of [0.2, 0.65]) { g.fillStyle = TAN; g.fillRect(W * sx, 0, W * 0.15, H); g.strokeStyle = LINE; g.lineWidth = 0.004; g.strokeRect(W * sx, 0, W * 0.15, H); }
  }
};
B.clothes(function (g, part, face, W, H) {
  if (part === 'torso') torso(g, face, W, H);
  else if (part.startsWith('arm')) arm(g, part, face, W, H);
  else leg(g, part, face, W, H);
});

/* ---------------- the face: the movie's decal ---------------- */
B.decal(function (g) {
  // measured from the movie still (forge/STYLE.md): one stud = 427 px, the head's bottom at y 508
  g.fillStyle = '#111'; g.strokeStyle = '#111';
  // short straight brows right above each eye, slanting down toward the nose
  g.lineWidth = 9;
  g.beginPath(); g.moveTo(165, 185); g.lineTo(211, 197); g.stroke();
  g.beginPath(); g.moveTo(347, 184); g.quadraticCurveTo(326, 186, 301, 197); g.stroke();
  // big upright oval eyes at the middle of the head, 0.32 studs apart
  for (const sd of [-1, 1]) { g.beginPath(); g.ellipse(256 + sd * 68, 248, 18, 32, 0, 0, PI * 2); g.fill(); }
  // a wide flat mouth, low on the head
  g.lineWidth = 7;
  g.beginPath(); g.moveTo(206, 406); g.lineTo(296, 405); g.quadraticCurveTo(303, 406, 306, 411); g.stroke();
});

C.autoPaint = function (tag, x, y, z, nx, ny, nz) {
  switch (tag) {
    case 'torso': case 'arm': case 'leg': return B.clothColor(x, y, z, nx, ny, nz, SKINC);
    case 'face': return B.faceColor(x, y, z, SKINC);
    case 'hair': {
      const up = Math.max(0, ny * 0.75 + nz * 0.3);
      return mix(mix(HAIR_LO, HAIR, Math.min(1, 0.35 + up)), HAIR_HI, Math.max(0, up - 0.6) * 1.6);
    }
    default: return [1, 0, 1];
  }
};

/* ---------------- the body, the head, the hair ---------------- */
B.body();
{
  const H = C.newObject('Head');
  T('face', 0);
  B.headForm(0);
  C.build(0.0018, 1, H);
}
{
  // the movie's hair: sleek and close on top, one pointed quiff rising off the front over his
  // right side and leaning out, the sides brushed down to about eye level
  const HR = C.newObject('Hair');
  const H = D.head, cy = H.c[1], r = H.r;
  T('hair', 0.006);
  C.cyl([0, cy + 0.008, -0.004], r + 0.008, H.hh - 0.002, r * 0.48);                  // a thin cap hugging the skull
  C.box([0, cy - 0.26, 0], [0.4, 0.16, 0.4], 0, null, { mode: 'subtract' });           // down to the middle of the back of the head
  C.box([0, cy - 0.095, 0.25], [0.4, 0.17, 0.17], 0.012, null, { mode: 'subtract' });  // the hairline, just above the brows
  for (const sd of [-1, 1]) C.box([sd * 0.3, cy - 0.165, 0.07], [0.12, 0.15, 0.15], 0.012, null, { mode: 'subtract' });   // sides down to eye level
  T('hair', 0.016);
  const tip = [-0.135, cy + 0.32, 0.1];
  for (const [x, ra] of [[-0.14, 0.035], [-0.09, 0.042], [-0.03, 0.045], [0.03, 0.04]]) {
    const base = [x, cy + 0.11, 0.17], mid = [x * 0.7 - 0.05, cy + 0.22, 0.14];
    C.limb(base, mid, ra * 0.75, ra);
    C.limb(mid, tip, ra, 0.006);
  }
  // the rest of the front swept back low over the crown toward his left
  C.limb([0.04, cy + 0.12, 0.16], [0.17, cy + 0.17, 0.02], 0.035, 0.02);
  C.limb([0.0, cy + 0.17, 0.08], [0.15, cy + 0.2, -0.06], 0.035, 0.015);
  T('hair', 0.008);
  C.pleat([-0.03, cy + 0.11, 0.17], tip, 0.35, { r: 0.005, h: 0.0025, t0: 0.1, t1: 0.85, n: 9, tag: 'hair', front: [0.2, 0.3, 1], reach: 0.1 });
  C.pleat([-0.03, cy + 0.11, 0.17], tip, -0.45, { r: 0.005, h: 0.0025, t0: 0.1, t1: 0.85, n: 9, tag: 'hair', front: [0.2, 0.3, 1], reach: 0.1 });
  C.pleat([0.04, cy + 0.12, 0.16], [0.17, cy + 0.17, 0.02], 0, { r: 0.004, h: 0.002, t0: 0.15, t1: 0.85, n: 7, tag: 'hair', front: [0, 1, 0.3], reach: 0.1 });
  C.build(0.002, 1, HR);
}

B.finish();
B.joints([]);
