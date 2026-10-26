/*
 * FORLORN — clothing, drawn the way Roblox shirts and pants are: flat colour, drawn seams and
 * fold lines, a soft top-lit shade. Joined after rbxkit.js; draws into B.clothes() canvases
 * (metres, (0,0) top-left of a face seen from outside, y down). Anything left undrawn is bare skin.
 *
 *   Wr.torso(g, face, W, H, o)        o: { kind, color, color2, trim, collar, zip, pocket, buttons,
 *                                          pants, belt, logo(g, cx, cy, s), stripes, open }
 *   Wr.arm(g, part, face, W, H, o)    o: { sleeve: 'long'|'short'|'none'|'rolled', color, cuff,
 *                                          glove, stripe, watch }
 *   Wr.leg(g, part, face, W, H, o)    o: { kind: 'jeans'|'trousers'|'track'|'shorts'|'skirt',
 *                                          color, stripe, shoes: { kind, color, sole, laces } }
 */
const Wr = {};
const dk = (hex, k) => { const c = HEX(hex); return 'rgb(' + c.map((v) => Math.round(Math.max(0, Math.min(1, v * k)) * 255)).join(',') + ')'; };
Wr.dk = dk;
Wr.shade = (g, x, y, w, h, a) => B.draw.shade(g, x, y, w, h, 'rgba(255,255,255,' + (0.09 * (a || 1)) + ')', 'rgba(0,0,0,' + (0.28 * (a || 1)) + ')');
Wr.fold = (g, list, col, lw) => B.draw.lines(g, list, col || 'rgba(0,0,0,0.28)', lw || 0.0045);
Wr.hi = (g, list) => B.draw.lines(g, list, 'rgba(255,255,255,0.13)', 0.004);

/* ---------------- the torso ---------------- */
Wr.torso = function (g, face, W, H, o) {
  const wy = H * B.D.torsoSplit.waist, col = o.color, line = dk(col, 0.55);
  const crop = o.kind === 'crop' ? wy - 0.07 : null;
  const bottom = crop || H;
  // trousers show below the waist
  if (o.pants) { g.fillStyle = o.pants; g.fillRect(0, wy, W, H - wy); Wr.shade(g, 0, wy, W, H - wy, 0.6); }
  if (o.kind !== 'none') {
    g.fillStyle = col; g.fillRect(0, 0, W, o.tuck ? wy : (o.pants ? Math.min(bottom, wy + 0.035) : bottom));
    Wr.shade(g, 0, 0, W, o.tuck ? wy : bottom);
  }
  if (face === 'top' || face === 'bottom') return;
  const front = face === 'front', back = face === 'back', side = face === 'left' || face === 'right';
  // the hem of the shirt over the trousers
  if (o.pants && !o.tuck && o.kind !== 'none') { const hy = Math.min(bottom, wy + 0.035); B.draw.lines(g, [[0, hy, W, hy]], line, 0.006); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, hy, W, 0.012); }
  if (crop) { B.draw.lines(g, [[0, crop, W, crop]], line, 0.006); }
  if (o.belt) { g.fillStyle = o.belt; g.fillRect(0, wy - 0.012, W, 0.03); if (front) { g.fillStyle = '#c8b070'; g.fillRect(W / 2 - 0.022, wy - 0.014, 0.044, 0.034); g.strokeStyle = '#5a4a20'; g.lineWidth = 0.003; g.strokeRect(W / 2 - 0.022, wy - 0.014, 0.044, 0.034); } }
  const k = o.kind;
  if (front) {
    // collars
    if (o.collar === 'crew' || !o.collar) { g.fillStyle = dk(col, 0.8); g.beginPath(); g.moveTo(W * 0.36, 0); g.quadraticCurveTo(W / 2, H * 0.11, W * 0.64, 0); g.lineTo(W * 0.6, 0); g.quadraticCurveTo(W / 2, H * 0.07, W * 0.4, 0); g.fill(); }
    if (o.collar === 'v' || o.collar === 'open') { g.fillStyle = o.color2 || 'rgba(0,0,0,0)'; g.clearRect(W * 0.4, 0, W * 0.2, 0.001); g.beginPath(); g.moveTo(W * 0.38, 0); g.lineTo(W / 2, H * (o.collar === 'open' ? 0.42 : 0.2)); g.lineTo(W * 0.62, 0); g.closePath(); if (o.color2) g.fill(); else { g.save(); g.globalCompositeOperation = 'destination-out'; g.fill(); g.restore(); } B.draw.lines(g, [[W * 0.38, 0, W / 2, H * (o.collar === 'open' ? 0.42 : 0.2), W * 0.62, 0]], line, 0.006); }
    if (o.collar === 'hood') { g.fillStyle = dk(col, 0.78); g.beginPath(); g.moveTo(W * 0.3, 0); g.quadraticCurveTo(W / 2, H * 0.2, W * 0.7, 0); g.lineTo(W * 0.62, 0); g.quadraticCurveTo(W / 2, H * 0.12, W * 0.38, 0); g.fill(); B.draw.lines(g, [[W * 0.3, 0, W / 2, H * 0.2, W * 0.7, 0]], line, 0.005); B.draw.lines(g, [[W * 0.45, H * 0.13, W * 0.44, H * 0.3], [W * 0.55, H * 0.13, W * 0.56, H * 0.3]], o.trim || '#e8e8e8', 0.006); }
    if (o.collar === 'shirt') { g.fillStyle = o.color2 || '#f2f2f0'; g.beginPath(); g.moveTo(W * 0.36, 0); g.lineTo(W * 0.46, H * 0.1); g.lineTo(W / 2, H * 0.04); g.lineTo(W * 0.54, H * 0.1); g.lineTo(W * 0.64, 0); g.fill(); B.draw.lines(g, [[W * 0.36, 0, W * 0.46, H * 0.1, W / 2, H * 0.04, W * 0.54, H * 0.1, W * 0.64, 0]], 'rgba(0,0,0,0.4)', 0.004); }
    if (k === 'jacket' || k === 'suit' || k === 'coat' || o.open) {
      // open front: the shirt beneath in a long V, lapels either side
      const vy = H * (k === 'suit' ? 0.5 : 0.6);
      g.fillStyle = o.color2 || '#2a2a2a'; g.beginPath(); g.moveTo(W * 0.38, 0); g.lineTo(W * 0.47, vy); g.lineTo(W * 0.53, vy); g.lineTo(W * 0.62, 0); g.fill();
      if (o.logo) { g.save(); g.beginPath(); g.rect(W * 0.36, 0, W * 0.28, H); g.clip(); o.logo(g, W / 2, H * 0.3, W * 0.26); g.restore(); }
      if (k === 'suit') { g.fillStyle = o.tie || '#8a1a1a'; g.beginPath(); g.moveTo(W * 0.485, H * 0.06); g.lineTo(W * 0.515, H * 0.06); g.lineTo(W * 0.525, H * 0.36); g.lineTo(W / 2, H * 0.41); g.lineTo(W * 0.475, H * 0.36); g.fill(); g.fillStyle = '#f0f0ee'; g.beginPath(); g.moveTo(W * 0.43, 0); g.lineTo(W * 0.48, H * 0.07); g.lineTo(W * 0.52, H * 0.07); g.lineTo(W * 0.57, 0); g.fill(); }
      g.fillStyle = dk(col, 0.82);
      for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(W / 2 + sd * W * 0.12, 0); g.lineTo(W / 2 + sd * W * 0.03, vy); g.lineTo(W / 2 + sd * W * 0.12, H * 0.24); g.lineTo(W / 2 + sd * W * 0.24, 0); g.fill(); }
      B.draw.lines(g, [[W * 0.38, 0, W * 0.47, vy, W * 0.47, bottom], [W * 0.62, 0, W * 0.53, vy, W * 0.53, bottom]], line, 0.006);
      if (k === 'suit' || k === 'coat') for (let i = 0; i < (o.buttons || 2); i++) { g.fillStyle = o.buttonColor || dk(col, 0.5); g.beginPath(); g.arc(W * 0.545, vy + 0.03 + i * 0.07, 0.009, 0, PI * 2); g.fill(); }
      Wr.fold(g, [[W * 0.2, H * 0.3, W * 0.3, H * 0.55, W * 0.32, H * 0.8], [W * 0.8, H * 0.3, W * 0.7, H * 0.55, W * 0.68, H * 0.8]]);
      if (o.pocket !== false) { B.draw.lines(g, [[W * 0.12, H * 0.66, W * 0.3, H * 0.66], [W * 0.7, H * 0.66, W * 0.88, H * 0.66]], line, 0.006); }
    } else {
      if (o.zip) { B.draw.lines(g, [[W / 2, H * 0.06, W / 2, bottom]], line, 0.006); B.draw.lines(g, [[W / 2, H * 0.06, W / 2, bottom]], 'rgba(220,220,220,0.5)', 0.002); }
      if (o.buttons) for (let i = 0; i < o.buttons; i++) { g.fillStyle = o.buttonColor || dk(col, 0.45); g.beginPath(); g.arc(W / 2, H * 0.12 + i * (bottom - H * 0.16) / o.buttons, 0.008, 0, PI * 2); g.fill(); }
      if (o.pocket === 'kanga') { B.draw.panel(g, W * 0.24, H * 0.55, W * 0.52, H * 0.2, dk(col, 0.92), line, 0.005); B.draw.lines(g, [[W * 0.24, H * 0.55, W * 0.3, H * 0.75], [W * 0.76, H * 0.55, W * 0.7, H * 0.75]], line, 0.005); }
      if (o.pocket === 'chest') { B.draw.panel(g, W * 0.6, H * 0.18, W * 0.16, H * 0.13, null, line, 0.004); }
      if (o.logo) o.logo(g, W / 2, H * 0.32, W * 0.3);
      // the drape of the cloth: a pull from each shoulder, a sag across the belly
      Wr.fold(g, [[W * 0.18, H * 0.12, W * 0.3, H * 0.4, W * 0.33, H * 0.62], [W * 0.82, H * 0.12, W * 0.7, H * 0.4, W * 0.67, H * 0.62], [W * 0.3, (bottom - 0.02) * 0.92, W / 2, (bottom - 0.02) * 0.95, W * 0.7, (bottom - 0.02) * 0.92]]);
      Wr.hi(g, [[W * 0.22, H * 0.1, W * 0.32, H * 0.3]]);
    }
    if (o.stripes) for (const [y, h, c] of o.stripes) { g.fillStyle = c; g.fillRect(0, H * y, W, H * h); }
  }
  if (back) {
    if (o.collar === 'hood') { g.fillStyle = dk(col, 0.8); g.beginPath(); g.ellipse(W / 2, 0.02, W * 0.26, H * 0.26, 0, 0, PI); g.fill(); B.draw.lines(g, [[W * 0.24, 0.02, W / 2, H * 0.3, W * 0.76, 0.02]], line, 0.005); }
    Wr.fold(g, [[W * 0.25, H * 0.15, W / 2, H * 0.25, W * 0.75, H * 0.15], [W * 0.3, (bottom - 0.02) * 0.9, W / 2, bottom * 0.93, W * 0.7, (bottom - 0.02) * 0.9]]);
    if (o.backPrint) o.backPrint(g, W / 2, H * 0.35, W * 0.4);
  }
  if (side) {
    Wr.fold(g, [[W / 2, H * 0.08, W / 2, bottom - 0.02]], 'rgba(0,0,0,0.22)', 0.004);
    if (o.stripes) for (const [y, h, c] of o.stripes) { g.fillStyle = c; g.fillRect(0, H * y, W, H * h); }
    if (o.sideStripe) { g.fillStyle = o.sideStripe; g.fillRect(W / 2 - 0.012, 0, 0.024, bottom); }
  }
};

/* ---------------- an arm, shoulder at the top ---------------- */
Wr.arm = function (g, part, face, W, H, o) {
  const s = B.D.armSplit, col = o.color, line = dk(col || '#888888', 0.55);
  const len = o.sleeve === 'long' ? H * (s.wrist - 0.02) : o.sleeve === 'rolled' ? H * (s.elbow - 0.03) : o.sleeve === 'short' ? H * 0.33 : o.sleeve === 'cap' ? H * 0.14 : 0;
  if (face === 'top') { if (len) { g.fillStyle = col; g.fillRect(0, 0, W, H); } return; }
  if (face === 'bottom') { if (o.glove) { g.fillStyle = o.glove; g.fillRect(0, 0, W, H); } return; }
  if (len) {
    g.fillStyle = col; g.fillRect(0, 0, W, len);
    Wr.shade(g, 0, 0, W, len, 0.8);
    if (o.sleeve === 'long') {
      Wr.fold(g, [[0, H * 0.4, W * 0.5, H * 0.43, W, H * 0.39], [W * 0.1, H * 0.47, W * 0.5, H * 0.5, W * 0.9, H * 0.46]]);
      g.fillStyle = o.cuff || dk(col, 0.8); g.fillRect(0, len - 0.03, W, 0.03);
    } else if (o.sleeve === 'rolled') { g.fillStyle = o.cuff || dk(col, 1.15); g.fillRect(0, len - 0.04, W, 0.04); B.draw.lines(g, [[0, len - 0.04, W, len - 0.04]], line, 0.004); }
    B.draw.lines(g, [[0, len, W, len]], line, 0.006);
    if (o.stripe && (face === 'left' || face === 'right' || face === 'front')) { g.fillStyle = o.stripe; g.fillRect(W / 2 - 0.012, 0, 0.024, len - 0.03); }
    if (o.patch && (face === 'left' || face === 'right')) o.patch(g, W / 2, H * 0.12, W * 0.5);
  }
  if (o.watch && part === 'armL' && face !== 'top') { g.fillStyle = o.watch; g.fillRect(0, H * s.wrist - 0.025, W, 0.025); }
  if (o.glove) {
    const gy = H * (s.wrist - 0.01);
    g.fillStyle = o.glove; g.fillRect(0, gy, W, H - gy);
    Wr.shade(g, 0, gy, W, H - gy, 0.8);
    B.draw.lines(g, [[0, gy, W, gy]], 'rgba(0,0,0,0.45)', 0.004);
  }
};

/* ---------------- a leg, hip at the top ---------------- */
Wr.leg = function (g, part, face, W, H, o) {
  const s = B.D.legSplit, col = o.color, line = dk(col, 0.55), kind = o.kind || 'trousers';
  const sh = o.shoes || {}, ankle = H * s.ankle;
  const hem = kind === 'shorts' ? H * 0.42 : kind === 'skirt' ? H * 0.38 : ankle;
  if (face === 'top') { g.fillStyle = col; g.fillRect(0, 0, W, H); return; }
  if (face === 'bottom') { g.fillStyle = sh.sole || '#222222'; g.fillRect(0, 0, W, H); return; }
  g.fillStyle = col; g.fillRect(0, 0, W, hem);
  Wr.shade(g, 0, 0, W, hem, 0.8);
  if (kind === 'jeans') {
    // a little fade on the thigh and knee, the seams, the hem
    B.draw.shade(g, W * 0.2, H * 0.1, W * 0.6, H * 0.45, 'rgba(255,255,255,0.0)', 'rgba(255,255,255,0.1)');
    if (face === 'left' || face === 'right') B.draw.lines(g, [[W / 2, 0, W / 2, hem]], 'rgba(230,190,90,0.55)', 0.0035);
    if (face === 'front') { B.draw.lines(g, [[W * 0.15, H * 0.02, W * 0.3, H * 0.1, W * 0.62, H * 0.06]], line, 0.004); Wr.fold(g, [[W * 0.2, H * 0.47, W * 0.5, H * 0.5, W * 0.8, H * 0.46], [W * 0.25, H * 0.53, W * 0.5, H * 0.55, W * 0.75, H * 0.52]]); }
    if (face === 'back') { B.draw.panel(g, W * 0.2, H * 0.06, W * 0.6, H * 0.16, null, 'rgba(230,190,90,0.5)', 0.0035); }
  } else if (kind === 'track') {
    if (face === 'left' || face === 'right') { g.fillStyle = o.stripe || '#f2f2f2'; g.fillRect(W / 2 - 0.018, 0, 0.012, hem); g.fillRect(W / 2 + 0.006, 0, 0.012, hem); }
    Wr.fold(g, [[W * 0.2, H * 0.5, W * 0.5, H * 0.53, W * 0.8, H * 0.49]]);
    g.fillStyle = dk(col, 0.75); g.fillRect(0, hem - 0.03, W, 0.03);
  } else {
    if (o.stripe && (face === 'left' || face === 'right')) { g.fillStyle = o.stripe; g.fillRect(W / 2 - 0.01, 0, 0.02, hem); }
    if (face === 'front') { B.draw.lines(g, [[W / 2, H * 0.04, W / 2, hem - 0.02]], 'rgba(0,0,0,0.18)', 0.004); Wr.fold(g, [[W * 0.22, H * 0.5, W * 0.5, H * 0.52, W * 0.78, H * 0.49]]); }
  }
  B.draw.lines(g, [[0, hem, W, hem]], line, 0.005);
  if (kind === 'skirt' || kind === 'shorts') { if (o.socks) { g.fillStyle = o.socks; g.fillRect(0, ankle - 0.08, W, 0.08); } }
  else if (o.socks) { /* hidden by trousers */ }
  // shoes
  const top = sh.kind === 'boot' ? H * (s.ankle - 0.12) : ankle;
  const sc = sh.color || '#2a2a2a';
  g.fillStyle = sc; g.fillRect(0, top, W, H - top);
  Wr.shade(g, 0, top, W, H - top, 0.9);
  g.fillStyle = sh.sole || (sh.kind === 'sneaker' ? '#f2f2f0' : '#1a1a1a'); g.fillRect(0, H - 0.026, W, 0.026);
  if (face === 'front') {
    if (sh.laces) { g.strokeStyle = sh.laces; g.lineWidth = 0.004; for (let y = top + 0.02; y < H - 0.06; y += 0.022) { g.beginPath(); g.moveTo(W * 0.38, y); g.lineTo(W * 0.62, y + 0.012); g.moveTo(W * 0.62, y); g.lineTo(W * 0.38, y + 0.012); g.stroke(); } }
    if (sh.kind === 'sneaker' && sh.accent) { g.fillStyle = sh.accent; g.beginPath(); g.ellipse(W * 0.5, H - 0.05, W * 0.3, 0.018, 0, 0, PI * 2); g.fill(); }
    if (sh.kind === 'dress') { g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.ellipse(W * 0.35, H - 0.05, 0.03, 0.01, -0.2, 0, PI * 2); g.fill(); }
  }
  B.draw.lines(g, [[0, top, W, top]], 'rgba(0,0,0,0.5)', 0.004);
};
