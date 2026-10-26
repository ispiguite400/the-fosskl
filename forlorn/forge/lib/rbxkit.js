/*
 * FORLORN — the Roblox body kit: R6 wearing the films' package shapes.
 *
 * Read forge/STYLE.md first. Characters look the way they did in the
 * ObliviousHD MOVIES: an R6 rig (six rigid parts, no elbows or knees) wearing
 * the Robloxian 2.0 package shapes: the classic cylinder head; one torso piece
 * with broad rounded shoulders tapering to the waist; one piece per arm
 * (shoulder cap, arm, forearm, a mitten hand with a thumb); one piece per leg
 * (thigh, shin, a chunky boot). Nothing is sculpted onto the body: clothing is
 * a texture drawn on canvases (like a Roblox Shirt/Pants template). Only
 * accessories (hair, hats, face gear, held items) are 3D.
 *
 * Joined after lib/kit.js (clay and paint helpers).
 *
 * Rigging: each of the six parts is its own piece with a gap of 10 mm or more
 * to its neighbours. SculptFree's binder gives every separate piece to one
 * bone, so each part moves rigidly, exactly like R6.
 *
 * T-POSE: arms straight out sideways at shoulder height, palms down, thumbs
 * forward; legs straight under the hips. The shoulder pivot sits a quarter
 * stud inside the arm so a lowered arm hangs beside the torso, as in R6.
 *
 * Units: studs (B.D.st metres each); feet at y = 0, facing +Z, the character's
 * left at +X.
 */
const B = {};
/*
 * Package proportions, in studs:
 *   sh shoulder half-width, wa waist half-width, td torso half-depth,
 *   arm / fa upper arm and forearm half-thickness, leg / shin, hand size, chest (pecs)
 */
B.PACKAGES = {
  robloxian2: { sh: 1.1, wa: 0.9, td: 0.53, arm: 0.41, fa: 0.37, leg: 0.44, shin: 0.41, hand: 1, chest: 0 },
  man:        { sh: 1.18, wa: 0.86, td: 0.56, arm: 0.43, fa: 0.39, leg: 0.45, shin: 0.42, hand: 1.05, chest: 0.06 },
  superhero:  { sh: 1.28, wa: 0.88, td: 0.58, arm: 0.47, fa: 0.42, leg: 0.46, shin: 0.43, hand: 1.08, chest: 0.1 },
  slim:       { sh: 1.02, wa: 0.84, td: 0.5, arm: 0.38, fa: 0.34, leg: 0.42, shin: 0.39, hand: 0.95, chest: 0 }
};
B.setup = function (o) {
  o = o || {};
  const st = 0.34 * (o.scale || 1);
  const P = Object.assign({}, B.PACKAGES[o.pkg || 'robloxian2'], o.over || {});
  const D = { st, P, s: o.scale || 1, legX: 0.5, g: 0.03 };
  D.y = { legTop: 1.94, torso: [2.0, 4.0], headBottom: 4.05 };
  D.head = { c: [0, (D.y.headBottom + 0.59) * st, 0], r: 0.6 * st, hh: 0.59 * st };
  D.headTop = D.head.c[1] + D.head.hh;
  /*
   * The shoulder pivot sits in the gap just inside the arm's end, level with the top of the
   * shoulders: lowered about it, the arm hangs beside the torso with its top at the shoulder
   * line. (Inside the arm it would hand the arm to the Shoulder bone, which ends at the pivot.)
   */
  D.pivot = [P.sh + 0.52, 4.02];
  const px = D.pivot[0];
  D.arm = { in: px + 0.03, elbow: px + 1.09, wrist: px + 1.73, tip: px + 2.33 };
  D.joint = { hips: 2.4, spine: 2.8, chest: 3.3, neck: 4.025, hip: 1.86 };
  const m = (v) => v * st;
  // the boxes the clothing templates are drawn on (standing / hanging frame), metres
  const armTop = D.pivot[1] + (px - D.arm.in), armBot = D.pivot[1] - (D.arm.tip - px);
  D.boxes = {
    torso: { c: [0, m(3.0), 0], h: [m(P.sh), m(1.0), m(P.td)] },
    armL: { c: [m(px), m((armTop + armBot) / 2), 0], h: [m(P.arm + 0.05), m((armTop - armBot) / 2), m(P.arm + 0.05)] },
    legL: { c: [m(D.legX), m(D.y.legTop / 2), 0], h: [m(P.leg + 0.02), m(D.y.legTop / 2), m(P.leg + 0.04)] }
  };
  D.boxes.armR = { c: [-D.boxes.armL.c[0], D.boxes.armL.c[1], 0], h: D.boxes.armL.h };
  D.boxes.legR = { c: [-D.boxes.legL.c[0], D.boxes.legL.c[1], 0], h: D.boxes.legL.h };
  // where the elbow, wrist, knee, ankle and waist fall down a template, as fractions from the top
  const armLen = armTop - armBot;
  D.armSplit = { elbow: (D.arm.elbow - D.arm.in) / armLen, wrist: (D.arm.wrist - D.arm.in) / armLen };
  D.legSplit = { knee: (D.y.legTop - 1.1) / D.y.legTop, ankle: (D.y.legTop - 0.34) / D.y.legTop };
  /*
   * R6 limbs are rigid: SculptFree's binder bends any piece holding two or more joints, so
   * only the shoulder and hip pivots sit inside an arm or a leg. The elbow, wrist, knee and
   * ankle bones sit just past the ends of the limb, where they carry nothing.
   */
  D.torsoSplit = { waist: (4.0 - 2.36) / 2.0 };
  B.D = D;
  return D;
};

/* ---------------- the body: six rounded package parts ---------------- */
/*
 * Builds the torso, both arms and both legs, each into its own object, so no smooth blend can
 * bridge the gap between parts (one clay build would weld them). The torso goes into the
 * scene's first object; call this before building the head.
 */
B.body = function (o) {
  o = o || {};
  const D = B.D, P = D.P, st = D.st, m = (v) => v * st, vox = o.voxel || 0.0026;
  // the torso: broad rounded shoulders tapering to the waist, the hips a touch wider at the belt
  T('torso', m(0.22));
  C.box([0, m(3.6), 0], [m(P.sh), m(0.4), m(P.td)], m(0.26));
  C.box([0, m(2.9), 0], [m(P.wa + 0.02), m(0.7), m(P.td * 0.95)], m(0.24));
  C.box([0, m(2.18), 0], [m(P.wa + 0.05), m(0.18), m(P.td * 0.93)], m(0.15));
  if (P.chest) for (const sd of [-1, 1]) C.ell([m(sd * 0.46), m(3.45), m(P.td - 0.12)], [m(0.44), m(0.32), m(0.14 + P.chest)]);
  if (o.torsoExtra) o.torsoExtra(m);
  C.build(vox, 1);
  for (const sd of [-1, 1]) {
    const ax = (v) => sd * m(v), py = m(D.pivot[1]), hs = P.hand;
    // the arm: a shoulder cap, the upper arm, the forearm and a mitten hand with a thumb, one piece
    const A = C.newObject(sd > 0 ? 'ArmL' : 'ArmR');
    T('arm', m(0.1));
    C.ell([ax(D.arm.in + 0.3), py + m(0.02), 0], [m(0.3), m(P.arm + 0.06), m(P.arm + 0.05)]);
    C.box([ax((D.arm.in + D.arm.elbow) / 2), py, 0], [m((D.arm.elbow - D.arm.in) / 2), m(P.arm), m(P.arm)], m(0.18));
    C.box([ax((D.arm.elbow + D.arm.wrist) / 2), py, 0], [m((D.arm.wrist - D.arm.elbow) / 2 + 0.06), m(P.fa), m(P.fa)], m(0.16));
    T('arm', m(0.06));
    C.box([ax((D.arm.wrist + D.arm.tip) / 2), py - m(0.03), 0], [m((D.arm.tip - D.arm.wrist) / 2), m(0.22 * hs), m(0.35 * hs)], m(0.13));
    C.limb([ax(D.arm.wrist + 0.1), py - m(0.1), m(0.22 * hs)], [ax(D.arm.wrist + 0.26), py - m(0.22 * hs), m(0.49 * hs)], m(0.11 * hs), m(0.09 * hs));
    if (o.armExtra) o.armExtra(sd, ax, py, m);
    C.build(vox, 1, A);
    // the leg: thigh, shin and a chunky boot, one piece
    const L = C.newObject(sd > 0 ? 'LegL' : 'LegR');
    const lx = sd * m(D.legX);
    T('leg', m(0.12));
    C.box([lx, m(1.495), 0], [m(P.leg), m(0.445), m(P.leg)], m(0.17));
    C.box([lx, m(0.72), 0], [m(P.shin), m(0.43), m(P.shin)], m(0.16));
    C.box([lx, m(0.17), m(0.12)], [m(P.leg + 0.01), m(0.17), m(P.leg + 0.13)], m(0.14));
    if (o.legExtra) o.legExtra(sd, lx, m);
    C.build(vox, 1, L);
  }
};
// the classic head: a cylinder with well-rounded top and bottom edges
B.headForm = function (grow) {
  const H = B.D.head;
  C.cyl(H.c, H.r + (grow || 0), H.hh + (grow || 0), H.r * 0.45);
};

/* ---------------- where a body vertex sits on the clothing templates ---------------- */
// which part a point is on, with the arms lowered to hang: position and normal
B.locate = function (x, y, z, nx, ny, nz) {
  const D = B.D, st = D.st;
  if (y < (D.y.legTop + D.g / 2) * st) return { part: x < 0 ? 'legR' : 'legL', p: [x, y, z], n: [nx, ny, nz] };
  if (Math.abs(x) > (D.P.sh + 0.08) * st) {
    const sd = x < 0 ? -1 : 1, rx = x - sd * D.pivot[0] * st, ry = y - D.pivot[1] * st;
    return { part: sd < 0 ? 'armR' : 'armL', p: [sd * D.pivot[0] * st + sd * ry, D.pivot[1] * st - sd * rx, z], n: [sd * ny, -sd * nx, nz] };
  }
  return { part: 'torso', p: [x, y, z], n: [nx, ny, nz] };
};
// the face (by the normal) and (u, v) in metres from the part's box centre: u right as seen from outside, v up
B.faceOf = function (box, p, n) {
  const dx = p[0] - box.c[0], dy = p[1] - box.c[1], dz = p[2] - box.c[2];
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (az >= ax && az >= ay * 0.9) return n[2] > 0 ? { f: 'front', u: dx, v: dy } : { f: 'back', u: -dx, v: dy };
  if (ax >= ay * 0.9) return n[0] > 0 ? { f: 'left', u: -dz, v: dy } : { f: 'right', u: dz, v: dy };
  return n[1] > 0 ? { f: 'top', u: dx, v: -dz } : { f: 'bottom', u: dx, v: dz };
};

/* ---------------- clothing templates: one canvas per face of each part ---------------- */
/*
 * B.clothes(draw): draw(g, part, face, W, H) is called once per face, with g a 2D context in
 * METRES: (0, 0) the top-left of the face as seen from outside, x right, y down, W x H its size.
 * part: 'torso' | 'armL' | 'armR' | 'legL' | 'legR'. Faces: 'front' 'back' 'left' 'right'
 * 'top' 'bottom' ('left' is the character's left side). A hanging arm and a leg are drawn top
 * (shoulder, hip) to bottom (hand, foot); B.D.armSplit / legSplit / torsoSplit give where the
 * elbow, wrist, knee, ankle and waist fall, as fractions of H from the top.
 */
B.PX = 720;
B.tex = {};
B.clothes = function (draw) {
  const D = B.D;
  for (const part in D.boxes) {
    const h = D.boxes[part].h;
    const dims = { front: [2 * h[0], 2 * h[1]], back: [2 * h[0], 2 * h[1]], left: [2 * h[2], 2 * h[1]], right: [2 * h[2], 2 * h[1]], top: [2 * h[0], 2 * h[2]], bottom: [2 * h[0], 2 * h[2]] };
    for (const face in dims) {
      const [W, H] = dims[face], cw = Math.max(8, Math.round(W * B.PX)), ch = Math.max(8, Math.round(H * B.PX));
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      const g = cv.getContext('2d');
      g.scale(cw / W, ch / H);
      g.lineJoin = 'round'; g.lineCap = 'round';
      draw(g, part, face, W, H);
      B.tex[part + ':' + face] = { data: g.getImageData(0, 0, cw, ch).data, cw, ch, W, H };
    }
  }
};
B.sample = function (key, u, v) {
  const t = B.tex[key];
  if (!t) return null;
  const px = (u / t.W + 0.5) * t.cw - 0.5, py = (0.5 - v / t.H) * t.ch - 0.5;
  const x0 = Math.max(0, Math.min(t.cw - 1, Math.floor(px))), y0 = Math.max(0, Math.min(t.ch - 1, Math.floor(py)));
  const x1 = Math.min(t.cw - 1, x0 + 1), y1 = Math.min(t.ch - 1, y0 + 1), fx = Math.max(0, Math.min(1, px - x0)), fy = Math.max(0, Math.min(1, py - y0));
  const out = [0, 0, 0, 0];
  const at = (x, y, w) => { const i = (y * t.cw + x) * 4; for (let k = 0; k < 4; k++) out[k] += t.data[i + k] / 255 * w; };
  at(x0, y0, (1 - fx) * (1 - fy)); at(x1, y0, fx * (1 - fy)); at(x0, y1, (1 - fx) * fy); at(x1, y1, fx * fy);
  return out;                                     // canvas colours are sRGB already, as the paint expects
};
// a body vertex's colour from its template, over the skin where the clothes leave it bare
B.clothColor = function (x, y, z, nx, ny, nz, skin) {
  const L = B.locate(x, y, z, nx, ny, nz), box = B.D.boxes[L.part], F = B.faceOf(box, L.p, L.n);
  const c = B.sample(L.part + ':' + F.f, F.u, F.v);
  if (!c) return skin;
  return mix(skin, [c[0], c[1], c[2]], c[3]);
};

/* ---------------- the face decal ---------------- */
/*
 * B.decal(draw): draw(g) paints a 512 x 512 Roblox-style face decal covering 1.2 studs of the
 * head's front (arc length) by 1.2 studs of its height; (256, 256) is the head's centre and one
 * stud is 427 px. The head's bottom is at y 508.
 */
B.decal = function (draw) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const g = cv.getContext('2d');
  g.lineJoin = 'round'; g.lineCap = 'round';
  draw(g);
  B.faceTex = { data: g.getImageData(0, 0, 512, 512).data };
};
B.faceColor = function (x, y, z, skin) {
  const H = B.D.head, st = B.D.st, t = B.faceTex;
  if (!t || z < H.c[2]) return skin;
  const ang = Math.atan2(x - H.c[0], z - H.c[2]);
  const u = ang * H.r / st, v = (y - H.c[1]) / st;
  const px = (u / 1.2 + 0.5) * 512, py = (0.5 - v / 1.2) * 512;
  if (px < 0 || py < 0 || px > 511 || py > 511) return skin;
  const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0, x1 = Math.min(511, x0 + 1), y1 = Math.min(511, y0 + 1);
  const o = [0, 0, 0, 0];
  const at = (xx, yy, w) => { const i = (yy * 512 + xx) * 4; for (let k = 0; k < 4; k++) o[k] += t.data[i + k] / 255 * w; };
  at(x0, y0, (1 - fx) * (1 - fy)); at(x1, y0, fx * (1 - fy)); at(x0, y1, (1 - fx) * fy); at(x1, y1, fx * fy);
  return mix(skin, [o[0], o[1], o[2]], o[3]);
};

/* ---------------- drawing helpers ---------------- */
B.draw = {
  // a fill with a drawn outline and an inner highlight, the Roblox-clothing way
  panel(g, x, y, w, h, fill, line, lw, hi) {
    if (fill) { g.fillStyle = fill; g.fillRect(x, y, w, h); }
    if (hi) { g.strokeStyle = hi; g.lineWidth = lw * 0.8; g.strokeRect(x + lw * 1.5, y + lw * 1.5, w - lw * 3, h - lw * 3); }
    if (line) { g.strokeStyle = line; g.lineWidth = lw; g.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw); }
  },
  // digital camo: square pixels in four colours gathered into blobs; seeded so each face differs
  digital(g, x, y, w, h, cols, cell, seed) {
    let s = (seed || 1) * 7919 % 2147483647 || 1;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    g.fillStyle = cols[0]; g.fillRect(x, y, w, h);
    const nx = Math.ceil(w / cell) + 2, ny = Math.ceil(h / cell) + 2, grid = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) grid.push(r());
    const at = (i, j) => grid[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = (at(i, j) * 2 + at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1) + at(i + 1, j + 1)) / 7 + (r() - 0.5) * 0.14;
      const k = v > 0.6 ? 3 : v > 0.54 ? 2 : v < 0.41 ? 1 : 0;
      if (!k) continue;
      g.fillStyle = cols[k]; g.fillRect(x + (i - 1) * cell, y + (j - 1) * cell, cell * 1.02, cell * 1.02);
    }
  },
  // lines: each [x0, y0, x1, y1 ...] a polyline, or [x0, y0, cx, cy, x1, y1] a curve
  lines(g, list, col, lw) {
    g.strokeStyle = col; g.lineWidth = lw;
    for (const l of list) { g.beginPath(); g.moveTo(l[0], l[1]); if (l.length === 6) g.quadraticCurveTo(l[2], l[3], l[4], l[5]); else for (let i = 2; i < l.length; i += 2) g.lineTo(l[i], l[i + 1]); g.stroke(); }
  },
  shade(g, x, y, w, h, top, bottom) {
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, top); gr.addColorStop(1, bottom);
    g.fillStyle = gr; g.fillRect(x, y, w, h);
  },
  text(g, str, x, y, size, col, weight) {
    g.save(); g.translate(x, y); g.scale(0.001, 0.001);
    g.fillStyle = col; g.font = `${weight || 'bold'} ${Math.round(size * 1000)}px "DejaVu Sans", Arial, Helvetica, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(str, 0, 0); g.restore();
  }
};

/* ---------------- joints for the rig: R6 pivots ---------------- */
B.joints = function (attach) {
  const D = B.D, st = D.st, J = D.joint, m = (v) => +(v * st).toFixed(4);
  const P3 = (x, y, z) => [m(x), m(y), m(z || 0)];
  const j = {
    Hips: P3(0, J.hips), Spine: P3(0, J.spine), Chest: P3(0, J.chest), Neck: P3(0, J.neck),
    Head: { head: P3(0, D.y.headBottom + 0.02), tail: [0, +D.headTop.toFixed(4), 0] }
  };
  for (const sd of [-1, 1]) {
    const n = sd > 0 ? 'L' : 'R', py = D.pivot[1];
    j['Shoulder.' + n] = P3(sd * 0.4, py);
    j['UpperArm.' + n] = P3(sd * D.pivot[0], py);
    j['LowerArm.' + n] = P3(sd * (D.arm.tip + 0.04), py);
    j['Hand.' + n] = { head: P3(sd * (D.arm.tip + 0.08), py), tail: P3(sd * (D.arm.tip + 0.32), py) };
    j['UpperLeg.' + n] = P3(sd * D.legX, J.hip);
    j['LowerLeg.' + n] = P3(sd * D.legX, -0.04);
    j['Foot.' + n] = P3(sd * D.legX, -0.08);
    j['Toes.' + n] = { head: P3(sd * D.legX, -0.08, 0.3), tail: P3(sd * D.legX, -0.08, 0.55) };
  }
  if (attach && attach.length) j.$attach = attach.map((a) => ({ at: a.at.map((v) => +v.toFixed(4)), bone: a.bone }));
  console.log('# JOINTS ' + JSON.stringify(j));
  return j;
};

B.finish = function (o) {
  o = o || {};
  M.joinAll();
  // every R6 part must be its own piece: list them, so a fusion shows up in the build log
  {
    const mesh = M.obj().mesh, comps = window.SCULPT.Rig.components(mesh), P = mesh.positions.array, lab = comps.label;
    const bb = comps.sizes.map(() => [1e9, 1e9, -1e9, -1e9]);
    for (let v = 0; v < lab.length; v++) { const c = lab[v]; if (c < 0) continue; const b = bb[c]; b[0] = Math.min(b[0], P[v * 3]); b[1] = Math.min(b[1], P[v * 3 + 1]); b[2] = Math.max(b[2], P[v * 3]); b[3] = Math.max(b[3], P[v * 3 + 1]); }
    console.log('# pieces: ' + comps.sizes.length + ' — ' + bb.map((b) => `x ${b[0].toFixed(2)}..${b[2].toFixed(2)} y ${b[1].toFixed(2)}..${b[3].toFixed(2)}`).join(' | '));
  }
  if (C.folds.length) K.creasePass(o.crease || 0.25);
  if (o.after) o.after();
  C.bakeShading({ floor: 1.5, ao: o.ao === undefined ? 0.5 : o.ao, dark: o.dark === undefined ? 2 : o.dark, light: 1.2 });
  M.app.set('cavity', 0.05); M.app.set('matcap', 'white');
  M.app.set('bgTop', '#2a2c33'); M.app.set('bgBottom', '#1d1e24');
};
