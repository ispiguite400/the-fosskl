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
 * Package proportions, in studs. robloxian2 is MEASURED from the user's movie still of Guest
 * 1337 (head 1.2 studs across = 133 px): torso 2.12 tall, 1.94 across the chest tapering hard to
 * 1.46 at the waist and 1.76 at the hips; arms 0.68 thick, hanging about 16 degrees out, the
 * mitten hand the last 18% of the arm; legs 0.70 thick and 2.12 long with a 0.2 stud gap; tall
 * boots over the bottom half, the foot widening to 0.84.
 *   ch/wa/hp  half-widths at chest, waist, hips; td torso half-depth
 *   arm/fa    upper arm / forearm half-thickness; hand mitten half-thickness
 *   leg/shin  thigh / shin half-width; boot shaft and foot half-widths
 */
B.PACKAGES = {
  robloxian2: { ch: 0.97, wa: 0.73, hp: 0.88, td: 0.5, arm: 0.35, fa: 0.32, hand: 0.215, leg: 0.35, shin: 0.34, shaft: 0.37, foot: 0.42 },
  man:        { ch: 1.05, wa: 0.76, hp: 0.86, td: 0.54, arm: 0.36, fa: 0.34, hand: 0.225, leg: 0.36, shin: 0.35, shaft: 0.38, foot: 0.43 },
  superhero:  { ch: 1.14, wa: 0.78, hp: 0.88, td: 0.57, arm: 0.4, fa: 0.37, hand: 0.235, leg: 0.37, shin: 0.36, shaft: 0.39, foot: 0.44 },
  slim:       { ch: 0.9, wa: 0.68, hp: 0.82, td: 0.47, arm: 0.31, fa: 0.29, hand: 0.2, leg: 0.33, shin: 0.32, shaft: 0.35, foot: 0.4 }
};
B.setup = function (o) {
  o = o || {};
  const st = 0.333 * (o.scale || 1);
  const P = Object.assign({}, B.PACKAGES[o.pkg || 'robloxian2'], o.over || {});
  const D = { st, P, s: o.scale || 1, legX: 0.46, g: 0.04 };
  D.y = { legTop: 2.1, torso: [2.14, 4.26], headBottom: 4.3, boot: 1.05 };
  D.head = { c: [0, (D.y.headBottom + 0.59) * st, 0], r: 0.6 * st, hh: 0.59 * st };
  D.headTop = D.head.c[1] + D.head.hh;
  /*
   * The shoulder pivot sits in the gap just inside the arm's end, level with the top of the
   * shoulders: lowered about it, the arm hangs beside the chest with its top at the shoulder
   * line. (Inside the arm it would hand the arm to the Shoulder bone, which ends at the pivot.)
   */
  D.pivot = [P.ch + 0.1, 4.3];                                // measured: the arm's inner edge 1.02 studs out at chest height, hanging 18 degrees out
  const px = D.pivot[0];
  const len = 2.48;                                             // shoulder top to fingertip (measured)
  D.arm = { in: px + 0.04, elbow: px + 0.04 + 0.45 * len, wrist: px + 0.04 + 0.82 * len, tip: px + 0.04 + len };
  D.joint = { hips: 2.6, spine: 3.0, chest: 3.5, neck: 4.28, hip: 2.02 };
  const m = (v) => v * st;
  // the boxes the clothing templates are drawn on (standing / hanging frame), metres
  const armTop = D.pivot[1] - (D.arm.in - px), armBot = D.pivot[1] - (D.arm.tip - px);
  D.boxes = {
    torso: { c: [0, m((D.y.torso[0] + D.y.torso[1]) / 2), 0], h: [m(P.ch + 0.03), m((D.y.torso[1] - D.y.torso[0]) / 2), m(P.td)] },
    armL: { c: [m(px), m((armTop + armBot) / 2), 0], h: [m(P.arm + 0.04), m((armTop - armBot) / 2), m(P.arm + 0.04)] },
    legL: { c: [m(D.legX), m(D.y.legTop / 2), 0], h: [m(P.foot), m(D.y.legTop / 2), m(P.leg + 0.04)] }
  };
  D.boxes.armR = { c: [-D.boxes.armL.c[0], D.boxes.armL.c[1], 0], h: D.boxes.armL.h };
  D.boxes.legR = { c: [-D.boxes.legL.c[0], D.boxes.legL.c[1], 0], h: D.boxes.legL.h };
  // where things fall down a template, as fractions from the top
  D.armSplit = { elbow: 0.45, wrist: 0.82 };
  D.legSplit = { knee: (D.y.legTop - 1.12) / D.y.legTop, boot: (D.y.legTop - D.y.boot) / D.y.legTop, ankle: (D.y.legTop - 0.45) / D.y.legTop };
  D.torsoSplit = { waist: (D.y.torso[1] - 2.52) / (D.y.torso[1] - D.y.torso[0]) };
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
  const D = B.D, P = D.P, st = D.st, m = (v) => v * st, vox = o.voxel || 0.0026, t0 = D.y.torso[0], t1 = D.y.torso[1];
  // the torso, measured: full chest width for the top 0.9 studs, a quick taper to the waist,
  // straight down the waist, then a flare out to the hips
  T('torso', m(0.12));
  C.box([0, m(t1 - 0.45), 0], [m(P.ch), m(0.45), m(P.td)], m(0.2));
  C.box([0, m(2.95), 0], [m(P.wa), m(0.45), m(P.td * 0.92)], m(0.18));
  C.box([0, m(t0 + 0.2), 0], [m(P.hp), m(0.2), m(P.td * 0.94)], m(0.14));
  C.box([0, m(t0 + 0.42), 0], [m((P.wa + P.hp) / 2), m(0.12), m(P.td * 0.93)], m(0.12));
  if (o.torsoExtra) o.torsoExtra(m);
  C.build(vox, 1);
  for (const sd of [-1, 1]) {
    const ax = (v) => sd * m(v), py = m(D.pivot[1]);
    // the arm: a rounded shoulder, the upper arm, the forearm and a mitten hand with a thumb, one piece
    const A = C.newObject(sd > 0 ? 'ArmL' : 'ArmR');
    // Robloxian 2.0: a big round shoulder (it sits over the torso's corner once the arm hangs),
    // smooth near-tubular upper arm and forearm, and a mitten hand with a thumb nub
    T('arm', m(0.2));
    C.ell([ax(D.arm.in + 0.38), py, 0], [m(0.38), m(P.arm + 0.04), m(P.arm + 0.04)]);
    C.box([ax((D.arm.in + 0.3 + D.arm.elbow) / 2), py, 0], [m((D.arm.elbow - D.arm.in - 0.3) / 2), m(P.arm), m(P.arm)], m(P.arm * 0.75));
    C.box([ax((D.arm.elbow + D.arm.wrist) / 2), py, 0], [m((D.arm.wrist - D.arm.elbow) / 2 + 0.08), m(P.fa), m(P.fa)], m(P.fa * 0.72));
    T('arm', m(0.07));
    C.box([ax((D.arm.wrist + D.arm.tip) / 2), py - m(0.02), 0], [m((D.arm.tip - D.arm.wrist) / 2), m(P.hand), m(P.fa * 0.9)], m(0.15));
    C.limb([ax(D.arm.wrist + 0.08), py - m(0.06), m(P.fa * 0.6)], [ax(D.arm.wrist + 0.24), py - m(P.hand + 0.04), m(P.fa + 0.13)], m(0.1), m(0.085));
    if (o.armExtra) o.armExtra(sd, ax, py, m);
    C.build(vox, 1, A);
    // the leg: thigh, shin, a tall boot whose foot widens, one piece
    const L = C.newObject(sd > 0 ? 'LegL' : 'LegR');
    const lx = sd * m(D.legX);
    // one straight trouser leg, as on the still
    T('leg', m(0.08));
    C.box([lx, m((0.45 + D.y.legTop) / 2), 0], [m(P.leg), m((D.y.legTop - 0.45) / 2), m(P.leg)], m(0.16));
    T('leg', m(0.08));
    C.box([lx, m((0.4 + D.y.boot) / 2), 0], [m(P.shaft), m((D.y.boot - 0.4) / 2), m(P.shaft)], m(0.18));
    C.box([lx, m(0.24), m(0.08)], [m(P.foot), m(0.24), m(P.foot + 0.1)], m(0.2));
    C.ell([lx, m(0.2), m(0.5)], [m(P.foot * 0.92), m(0.21), m(0.24)]);                           // the rounded toe of the shoe
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
  if (Math.abs(x) > (D.P.ch + 0.1) * st) {
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
    j['Shoulder.' + n] = P3(sd * 0.4, py - 0.6);               // angled up from the chest, clear of the head
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
