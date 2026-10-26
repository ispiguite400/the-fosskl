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
const HAIR = HEX('#26306e'), HAIR_HI = HEX('#3d4aa0'), HAIR_LO = HEX('#121842');
const dr = B.draw;

/* ---------------- the clothing, drawn like a Roblox shirt and pants ---------------- */
const UCP = WIN ? ['#d9dbd8', '#b9bdbb', '#eeefec', '#8e9492'] : ['#75735f', '#4e5248', '#99947f', '#34372f'];   // calibrated to the still
const TAN = WIN ? '#a7adaf' : '#9a8563', TAN_D = WIN ? '#7b8285' : '#7c6849', TAN_L = WIN ? '#c5cacc' : '#b6a07b', LINE = WIN ? '#3c4245' : '#2e2012';
const BOOT = WIN ? '#5b5d5e' : '#6a6855', GLOVE = '#606160';
let seed = 11;
const camo = (g, x, y, w, h) => dr.digital(g, x, y, w, h, UCP, 0.0125, seed++);
const molle = (g, x, y, w, rows, h) => {
  for (let i = 0; i < rows; i++) {
    const yy = y + i * h * 1.65;
    g.fillStyle = TAN_D; g.fillRect(x, yy, w, h);
    g.strokeStyle = LINE; g.lineWidth = 0.0032; g.strokeRect(x, yy, w, h);
    g.beginPath(); for (let xx = x + 0.022; xx < x + w - 0.004; xx += 0.022) { g.moveTo(xx, yy); g.lineTo(xx, yy + h); } g.stroke();
  }
};
const pouch = (g, x, y, w, h) => {
  dr.panel(g, x, y, w, h, TAN, LINE, 0.0055, TAN_L);
  dr.shade(g, x + 0.004, y + h * 0.5, w - 0.008, h * 0.5 - 0.004, 'rgba(0,0,0,0)', 'rgba(60,40,20,0.28)');
  dr.panel(g, x - 0.002, y, w + 0.004, h * 0.3, TAN_D, LINE, 0.0055);
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
  // the boot: the bottom half of the leg, up to just below the knee
  const top = H * D.legSplit.boot;
  g.fillStyle = BOOT; g.fillRect(0, top, W, H - top);
  dr.shade(g, 0, top, W, H - top, 'rgba(255,255,230,0.12)', 'rgba(10,10,0,0.35)');
  dr.lines(g, [[0, top + 0.004, W * 0.35, top + 0.018, W * 0.65, top - 0.002, W, top + 0.01]], 'rgba(20,20,10,0.7)', 0.006);   // trousers tucked in
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.004; g.strokeRect(0.002, top, W - 0.004, H - top - 0.002);
  if (face === 'front') {
    const cx = W / 2, a = H * D.legSplit.ankle;
    dr.lines(g, [[W * 0.08, top + 0.03, W / 2, top + 0.045, W * 0.92, top + 0.03]], 'rgba(0,0,0,0.35)', 0.004);   // the boot's collar
    g.strokeStyle = '#a5946b'; g.lineWidth = 0.005;                  // laces criss-crossing up the shin
    for (let y = top + 0.03; y < a - 0.02; y += 0.026) { g.beginPath(); g.moveTo(cx - 0.04, y); g.lineTo(cx + 0.04, y + 0.026); g.moveTo(cx + 0.04, y); g.lineTo(cx - 0.04, y + 0.026); g.stroke(); }
    g.fillStyle = '#1e1f18';
    for (let y = top + 0.03; y < a - 0.01; y += 0.026) for (const sx of [-1, 1]) { g.beginPath(); g.arc(cx + sx * 0.045, y, 0.0045, 0, PI * 2); g.fill(); }
    dr.lines(g, [[W * 0.1, a + 0.02, W / 2, a + 0.0, W * 0.9, a + 0.02]], 'rgba(0,0,0,0.5)', 0.005);   // the toe cap
    g.fillStyle = 'rgba(255,255,240,0.18)'; g.beginPath(); g.ellipse(W * 0.32, H - 0.035, 0.035, 0.012, -0.15, 0, PI * 2); g.fill();
  }
  g.fillStyle = '#26241f'; g.fillRect(0, H - 0.026, W, 0.026);                         // the sole
};
// an arm, shoulder at the top, banded as in the film still: camo sleeve to 42%, the rolled cuff,
// white forearm, a black glove cuff and the grey glove from 71% to the fingertips
const arm = (g, part, face, W, H) => {
  if (face === 'top') { if (PRIS) { g.fillStyle = '#e0702a'; g.fillRect(0, 0, W, H); } else camo(g, 0, 0, W, H); return; }
  if (face === 'bottom') { g.fillStyle = PRIS ? 'rgba(0,0,0,0)' : GLOVE; g.fillRect(0, 0, W, H); return; }
  if (PRIS) {
    const w = H * 0.8;
    g.fillStyle = '#e0702a'; g.fillRect(0, 0, W, w);
    dr.shade(g, 0, 0, W, w, 'rgba(255,220,180,0.1)', 'rgba(90,30,0,0.25)');
    g.fillStyle = '#b4531c'; g.fillRect(0, w - 0.02, W, 0.02);
    return;                                                          // bare white hands below the cuff
  }
  const sl = H * 0.42, r1 = H * 0.5, gc = H * 0.66, gl = H * 0.71;
  camo(g, 0, 0, W, sl + 0.01);
  dr.shade(g, 0, sl - 0.05, W, 0.05, 'rgba(0,0,0,0)', 'rgba(25,25,20,0.3)');
  g.fillStyle = '#e4e4e0'; g.fillRect(0, sl, W, r1 - sl);                                // the rolled cuff
  g.fillStyle = '#9a9b97'; g.fillRect(0, sl + (r1 - sl) * 0.55, W, (r1 - sl) * 0.45);
  g.fillStyle = '#141414'; g.fillRect(0, sl, W, 0.008); g.fillRect(0, sl + (r1 - sl) * 0.42, W, 0.007); g.fillRect(0, r1 - 0.006, W, 0.006);
  g.fillStyle = '#2a2a2a'; g.fillRect(0, gc, W, gl - gc);                                // the glove's cuff
  g.fillStyle = GLOVE; g.fillRect(0, gl, W, H - gl);                                       // the grey glove
  dr.shade(g, 0, gl, W, H - gl, 'rgba(255,255,255,0.1)', 'rgba(0,0,0,0.25)');
  dr.lines(g, [[0, gl + 0.004, W, gl + 0.004]], 'rgba(0,0,0,0.5)', 0.004);
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
    const L = W * 0.05, R = W * 0.95;
    // the carrier covers nearly the whole front, its shoulder straps running up over the shoulders
    g.fillStyle = TAN; g.fillRect(L, H * 0.12, R - L, H - H * 0.12);
    g.fillRect(W * 0.2, 0, W * 0.15, H * 0.14); g.fillRect(W * 0.65, 0, W * 0.15, H * 0.14);
    g.strokeStyle = LINE; g.lineWidth = 0.0045;
    g.strokeRect(L, H * 0.12, R - L, H - H * 0.12 - 0.003);
    g.strokeRect(W * 0.2, 0, W * 0.15, H * 0.13); g.strokeRect(W * 0.65, 0, W * 0.15, H * 0.13);
    if (face === 'front') {
      g.fillStyle = '#f0f0ee'; g.beginPath(); g.moveTo(W * 0.36, 0); g.quadraticCurveTo(W / 2, H * 0.13, W * 0.64, 0); g.fill();   // the neck
      // laid out as on the film still: a centre plate between two bold straps, the flag patch high
      // and wide, the name tape, MOLLE bands right across, a row of big flapped pouches at the bottom
      molle(g, L + 0.01, H * 0.17, R - L - 0.02, 12, 0.017);                                   // MOLLE across the whole carrier
      dr.panel(g, W * 0.31, H * 0.04, W * 0.38, H * 0.68, TAN, LINE, 0.007, TAN_L);            // the centre plate
      for (const sx of [0.27, 0.69]) dr.panel(g, W * sx, H * 0.0, W * 0.045, H * 0.74, TAN_D, LINE, 0.006);   // the straps
      flag(g, W * 0.36, H * 0.07, W * 0.28, H * 0.16);
      dr.panel(g, W * 0.39, H * 0.26, W * 0.22, H * 0.075, TAN_D, LINE, 0.005);
      dr.text(g, 'USM', W * 0.5, H * 0.299, 0.036, '#1e1309');
      molle(g, W * 0.34, H * 0.38, W * 0.32, 6, 0.017);
      for (const px of [0.375, 0.5, 0.625]) pouch(g, W * px - W * 0.06, H * 0.71, W * 0.12, H * 0.28);   // magazine pouches
      pouch(g, L + 0.008, H * 0.73, W * 0.17, H * 0.26); pouch(g, R - W * 0.17 - 0.008, H * 0.73, W * 0.17, H * 0.26);
      dr.shade(g, L, H * 0.05, R - L, H * 0.95, 'rgba(255,230,190,0.06)', 'rgba(40,25,10,0.24)');
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
  /*
   * Measured from the user's movie still (head 1.2 studs across; here one stud = 427 px and the
   * head's centre is (256, 256)): eyes 0.15 x 0.25 studs, centres 0.35 studs apart and 0.11 above
   * the centre; brows sitting right on the eyes, as wide as them, slanting down to the nose; the
   * mouth 0.42 studs wide, 0.28 below the centre, rising a little to his left.
   */
  g.fillStyle = '#121212'; g.strokeStyle = '#121212';
  for (const sd of [-1, 1]) {
    const cx = 256 + sd * 74;
    g.beginPath(); g.ellipse(cx, 211, 32, 53, 0, 0, PI * 2); g.fill();                       // the eye
    g.lineWidth = 12; g.lineCap = 'round';                                                    // the brow, on the eye
    g.beginPath(); g.moveTo(cx + sd * 30, 146); g.lineTo(cx - sd * 30, 155); g.stroke();
  }
  g.lineWidth = 12;
  g.beginPath(); g.moveTo(172, 383); g.lineTo(342, 373); g.stroke();                          // the mouth
  g.beginPath(); g.moveTo(172, 383); g.lineTo(168, 389); g.stroke();                          // its little hook
});

C.autoPaint = function (tag, x, y, z, nx, ny, nz) {
  switch (tag) {
    case 'torso': case 'arm': case 'leg': return B.clothColor(x, y, z, nx, ny, nz, SKINC);
    case 'face': return B.faceColor(x, y, z, SKINC);
    case 'hair': {
      // glossy: dark underneath, a bright sheen where the hair faces up and toward the light
      const up = Math.max(0, ny * 0.7 + nz * 0.25 - nx * 0.2);
      const streak = 0.5 + 0.5 * Math.sin((x * 1.5 + y * 0.8 - z) * 90);
      return mix(mix(HAIR_LO, HAIR, Math.min(1, 0.3 + up)), HAIR_HI, Math.max(0, up - 0.45) * 1.8 * (0.7 + 0.3 * streak));
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
  /*
   * The hair, measured from the still: the hairline 0.37 studs above the head's centre with a small
   * V of fringe to 0.3; side locks down the sides of the head to 0.15 below the centre; on his right
   * a big quiff rising about 0.45 studs over the top, its outer edge near vertical at 0.4 studs
   * from the middle, its inner edge sweeping down across the top to his left side; a small lock
   * flaring out over his right ear.
   */
  const HR = C.newObject('Hair');
  const H = D.head, cy = H.c[1], r = H.r, st = D.st, top = cy + H.hh;
  T('hair', 0.006);
  C.cyl([0, cy + 0.006, -0.004], r + 0.008, H.hh + 0.002, r * 0.46);                  // a thin cap hugging the skull
  C.box([0, cy - 0.07 * st - 0.2, 0], [0.4, 0.2, 0.4], 0, null, { mode: 'subtract' }); // the back stops at the nape
  // the face: clear below the hairline across the front; the sides stay as thin locks to below the eyes
  C.box([0, cy + 0.37 * st - 0.2, 0.25], [r * 0.86, 0.2, 0.18], 0.01, null, { mode: 'subtract' });
  for (const sd of [-1, 1]) C.box([sd * 0.3, cy - 0.15 * st - 0.2, 0], [0.11, 0.2, 0.3], 0.01, null, { mode: 'subtract' });
  T('hair', 0.012);
  // the V of fringe hanging over the middle of the forehead, down to 0.3 studs above the centre
  C.limb([-0.06 * st, cy + 0.4 * st, r * 0.9], [0.005, cy + 0.3 * st, r * 0.97], 0.016, 0.006);
  C.limb([0.08 * st, cy + 0.4 * st, r * 0.9], [0.005, cy + 0.3 * st, r * 0.97], 0.016, 0.006);
  /*
   * The pompadour, measured: height of the hair above the top of the head across the face,
   * from his right (-x) to his left: a near-vertical outer edge at -0.43 studs rising to the
   * peak (0.45), 0.34 at the middle, 0.25 at +0.25, 0.13 at +0.4, nothing past +0.6.
   * Each lock rises off the hairline and sweeps back over the crown at that height.
   */
  const lift = [[-0.46, 0.28], [-0.42, 0.4], [-0.3, 0.38], [-0.15, 0.35], [0, 0.31], [0.15, 0.25], [0.28, 0.18], [0.4, 0.1], [0.52, 0.03]];
  T('hair', 0.035);
  for (const [xs, hgt] of lift) {
    const x = xs * st, h = hgt * st, ra = 0.05;
    const front = [x * 0.95, top - 0.03, Math.sqrt(Math.max(0, r * r - x * x)) * 0.85];
    const crown = [x * 0.9 - 0.02 * st, top + h - ra * 0.6, 0.02];
    const back = [x * 0.85, top + h * 0.35 - ra * 0.5, -r * 0.8];
    C.limb(front, crown, ra * 0.7, ra);
    C.limb(crown, back, ra, ra * 0.8);
  }
  // the peak: a distinct point standing up over his right side, above everything else
  T('hair', 0.02);
  C.limb([-0.22 * st, top + 0.25 * st, 0.08], [-0.36 * st, top + 0.48 * st, 0.05], 0.055, 0.03);
  C.limb([-0.36 * st, top + 0.48 * st, 0.05], [-0.42 * st, top + 0.62 * st, 0.02], 0.03, 0.006);
  C.limb([-0.3 * st, top + 0.2 * st, -0.06], [-0.4 * st, top + 0.5 * st, -0.02], 0.045, 0.01);
  // the lock flaring out over his right ear
  C.limb([-0.5 * st, top - 0.03, 0.0], [-0.72 * st, top + 0.14 * st, 0.02], 0.025, 0.006);
  C.build(0.002, 1, HR);
}

B.finish();
B.joints([]);
