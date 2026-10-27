/*
 * FORLORN — R6 animation clips, baked into every character by ship.mjs --clips.
 *
 * The characters are R6 rigs wearing the films' package shapes: six rigid
 * parts. An arm or a leg swings as one piece from its shoulder or hip, the
 * torso never bends, the head turns on the neck. So:
 *   - LowerArm = UpperArm and LowerLeg = UpperLeg (no elbow, no knee),
 *   - Foot = 90 + leg swing (the boot is part of the leg piece),
 *   - leaning is the whole body pitching at the hips; the legs are
 *     compensated so they keep their own angle to the ground (and their own
 *     heading and roll, so the torso can twist and sway over planted feet),
 *   - Spine, Chest, Neck and the Shoulder bones never rotate.
 * The Rig Player rests the arms 8 degrees out from the body; in the films these
 * arms hang about 18 degrees out, so every clip rolls them out by the difference. rel z is not
 * mirrored by the player: + rolls the left arm out and the right arm in.
 *
 * What makes these better than stock R6 swinging (and closer to Forsaken's):
 *   - weight: the hips ride as low as the legs allow, so a rigid leg never sinks into the floor
 *     and the body dips and rises through every step (plant());
 *   - gait: a foot spends longer on the ground than in the air, the swing is quicker, arms lag the
 *     legs, the torso twists and shifts over the standing foot, a run has a flight phase;
 *   - timing: one-shots anticipate, strike fast and follow through (easing per key);
 *   - character: every character has a movement style (spec.json "anim"): how it stands, walks,
 *     runs and swings, from a hunched nervous shuffle to an officer's march.
 *
 * "abs" = swing from straight down in the parent's frame, + forward (degrees).
 * make.mjs puts `const ROLE = 'survivor' | 'killer' | 'minion'` and `const STYLE = '...'` in front.
 */
(function () {
  const role = typeof ROLE === 'string' ? ROLE : 'survivor';
  const KILLER = role === 'killer';
  const STY = typeof STYLE === 'string' && STYLE ? STYLE : (KILLER ? 'stalker' : 'casual');
  const CL = window.RigPlayer.CLIPS;
  CL.length = 0;
  const TAU = Math.PI * 2, PI = Math.PI, sin = Math.sin, cos = Math.cos, abs = Math.abs, D2R = PI / 180;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const add = (c) => { c.loop = c.loop !== false; CL.push(c); };
  const IN = 8 - 18;                                  // player rest hang minus the hang we want
  const wrap = (v) => ((v % 1) + 1) % 1;

  /* easing for each stretch between two keys */
  const EASE = {
    io: (u) => u * u * (3 - 2 * u),                   // ease in and out
    out: (u) => 1 - (1 - u) ** 3,                     // fast start, soft landing: strikes, reactions
    snap: (u) => 1 - (1 - u) ** 5,                    // faster still
    in: (u) => u * u * u,                             // slow start: wind-ups
    lin: (u) => u,
    back: (u) => 1 + 2.7 * (u - 1) ** 3 + 1.7 * (u - 1) ** 2   // overshoot, then settle: follow-through
  };

  /*
   * Where the feet are. R6 legs are rigid blocks, 0.68 m from hip pivot to sole for a 1.8 m figure,
   * 0.32 m deep and wide. A swung or spread leg reaches less far down (and its corner more), and the
   * body's own lean and roll lift or drop each hip. The hips ride so the lowest foot is on the floor.
   */
  const LEG = 0.68, HIPD = 0.193, HIPX = 0.153, FD = 0.16, FW = 0.16;
  const reach = (a, s) => LEG * cos(a * D2R) * cos(s * D2R) + FD * sin(abs(a) * D2R) + FW * sin(abs(s) * D2R);
  function plant(p) {
    const lean = (p.lean || 0) * D2R, roll = (p.roll || 0) * D2R;
    const down = (a, s, side) => reach(a, s) + HIPD * cos(lean) * cos(roll) - side * HIPX * sin(roll);
    return Math.max(down(p.ll || 0, p.lspread || 0, 1), down(p.rl || 0, p.rspread || 0, -1)) - (HIPD + LEG);
  }

  /*
   * One R6 pose:
   *   la, ra   left / right arm swing (+ forward); lo / ro arm roll outward; ltw / rtw twist
   *   ll, rl   left / right leg swing in the WORLD (+ forward); lspread / rspread outward
   *   lean     whole-body pitch forward; twist yaw (+ to its left); roll sideways (+ top to its right)
   *   head     [pitch (+ down), yaw (+ to the character's left), roll]; held level against the
   *            body's lean, and mostly against its twist and roll (hs, 0..1)
   *   x, y, z  hips offset (metres for a 1.8 m figure); y is on top of plant() times `plant`
   *            (1 by default; 0 for poses off the floor: lying down, rolling, lifted, in the air)
   */
  function R6(p) {
    const lean = p.lean || 0, twist = p.twist || 0, roll = p.roll || 0, hs = p.hs === undefined ? 0.7 : p.hs;
    const legL = (p.ll || 0) + lean, legR = (p.rl || 0) + lean, hd = p.head || [0, 0, 0];
    const pw = p.plant === undefined || p.plant === true ? 1 : p.plant === false ? 0 : p.plant;
    const y = (p.y || 0) + (pw ? pw * plant(p) : 0);
    return {
      abs: { 'UpperArm.L': p.la || 0, 'LowerArm.L': p.la || 0, 'UpperArm.R': p.ra || 0, 'LowerArm.R': p.ra || 0,
             'UpperLeg.L': legL, 'LowerLeg.L': legL, 'Foot.L': 90 + legL, 'UpperLeg.R': legR, 'LowerLeg.R': legR, 'Foot.R': 90 + legR },
      rel: { 'Hips': [lean, twist, roll],
             'UpperArm.L': [0, p.ltw || 0, -IN + (p.lo || 0)], 'UpperArm.R': [0, -(p.rtw || 0), IN - (p.ro || 0)],
             'UpperLeg.L': [0, -twist, (p.lspread || 0) - roll], 'UpperLeg.R': [0, -twist, -(p.rspread || 0) - roll],
             'Head': [hd[0] - lean, hd[1] - twist * hs, hd[2] - roll * hs] },
      offset: [p.x || 0, y, p.z || 0]
    };
  }
  const lerpP = (a, b, u) => {
    const o = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const va = a[k], vb = b[k];
      if (k === 'plant') { const w = (v) => (v === undefined || v === true ? 1 : v === false ? 0 : v); o[k] = w(va) + (w(vb) - w(va)) * u; continue; }
      if (Array.isArray(va) || Array.isArray(vb)) { const A = va || [0, 0, 0], Bv = vb || [0, 0, 0]; o[k] = A.map((x, i) => x + (Bv[i] - x) * u); }
      else o[k] = (va || 0) + ((vb || 0) - (va || 0)) * u;
    }
    return o;
  };
  const addP = (a, b) => { const o = Object.assign({}, a); for (const k in b) o[k] = Array.isArray(b[k]) ? (a[k] || [0, 0, 0]).map((x, i) => x + b[k][i]) : typeof b[k] === 'number' ? (a[k] || 0) + b[k] : b[k]; return o; };
  // keys: [[time, pose, ease?], ...]; the ease is for the stretch that ends at that key
  function at(keys, t) {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
    const [t0, a] = keys[i], [t1, b, e] = keys[Math.min(i + 1, keys.length - 1)];
    return lerpP(a, b, t1 > t0 ? EASE[e || 'io'](clamp((t - t0) / (t1 - t0))) : 1);
  }
  const keyed = (keys, t, extra) => R6(extra ? addP(at(keys, t), extra) : at(keys, t));

  /* ---------------- styles ---------------- */
  /*
   * Each style is how a character carries itself:
   *   stand    its idle pose (the base everything else relaxes back to)
   *   walk     A leg swing, B arm swing, bias arm centre, out arm roll, lean, T twist, W side shift,
   *            Rl roll onto the standing foot, nod head dip per step, bob extra dip per step
   *   run      the same, plus F flight height
   *   arms     arm overrides while moving ({ la, ra, lo, ro } held instead of swinging; sw = how much
   *            swing is left on top)
   */
  const STYLES = {
    // survivors
    casual:  { stand: { la: 2, ra: 3, lo: 2, ro: 3, lean: 1 },
               walk: { A: 36, B: 30, bias: 3, out: 4, lean: 3, T: 7, W: 0.016, Rl: 2.2, nod: 2, bob: 0.008 },
               run: { A: 56, B: 60, bias: 12, out: 3, lean: 14, T: 9, W: 0.01, Rl: 2, nod: 3, bob: 0.01, F: 0.05 } },
    soldier: { stand: { la: 8, ra: 10, lo: 3, ro: 3, lean: 3, lspread: 4, rspread: 4, rl: -4, ll: 3 },
               walk: { A: 36, B: 24, bias: 8, out: 3, lean: 5, T: 6, W: 0.012, Rl: 1.5, nod: 1.5, bob: 0.006 },
               run: { A: 58, B: 56, bias: 16, out: 2, lean: 16, T: 8, W: 0.008, Rl: 1.5, nod: 2, bob: 0.008, F: 0.05 } },
    nervous: { stand: { la: 26, ra: 22, lo: -12, ro: -12, lean: 7, ltw: 10, rtw: 10, lspread: -1, rspread: -1 },
               walk: { A: 30, B: 14, bias: 22, out: -8, lean: 8, T: 5, W: 0.012, Rl: 2.5, nod: 3, bob: 0.01 },
               run: { A: 56, B: 62, bias: 14, out: 6, lean: 15, T: 12, W: 0.014, Rl: 3, nod: 4, bob: 0.012, F: 0.045, flail: 1 } },
    posh:    { stand: { la: -16, ra: -16, lo: -6, ro: -6, lean: -3, head: [-7, 0, 0] },
               walk: { A: 30, B: 0, bias: 0, out: 0, lean: -2, T: 4, W: 0.01, Rl: 3, nod: 1, bob: 0.004, head: [-7, 0, 0], arms: { la: -16, ra: -16, lo: -6, ro: -6, sw: 3 } },
               run: { A: 52, B: 50, bias: 8, out: 16, lean: 9, T: 6, W: 0.016, Rl: 3, nod: 3, bob: 0.01, F: 0.04, head: [-6, 0, 0] } },
    // killers
    stalker: { stand: { la: 10, ra: 12, lo: 4, ro: 4, lean: 10, ll: 2, rl: -3, lspread: 3, rspread: 3, head: [8, 0, 10] },
               walk: { A: 26, B: 9, bias: 10, out: 4, lean: 11, T: 4, W: 0.008, Rl: 1.5, nod: 0.5, bob: -0.004, glide: 0.7, head: [8, 0, 9] },
               run: { A: 60, B: 0, bias: -40, out: 5, lean: 24, T: 6, W: 0.006, Rl: 1, nod: 1, bob: 0.004, F: 0.04, head: [-8, 0, 0], arms: { la: -42, ra: -42, lo: 5, ro: 5, sw: 6 } } },
    officer: { stand: { la: -18, ra: -18, lo: -5, ro: -5, lean: -4, lspread: 3, rspread: 3, head: [-6, 0, 0] },
               walk: { A: 38, B: 34, bias: 6, out: 2, lean: -2, T: 4, W: 0.008, Rl: 1, nod: 1, bob: 0.004, head: [-5, 0, 0] },
               run: { A: 58, B: 58, bias: 12, out: 2, lean: 12, T: 7, W: 0.006, Rl: 1, nod: 2, bob: 0.008, F: 0.04, head: [-4, 0, 0] } },
    brute:   { stand: { la: 6, ra: 6, lo: 14, ro: 14, lean: 7, lspread: 8, rspread: 8, head: [6, 0, 0] },
               walk: { A: 32, B: 24, bias: 6, out: 15, lean: 8, T: 8, W: 0.03, Rl: 6, nod: 3, bob: 0.014, head: [5, 0, 0] },
               run: { A: 56, B: 46, bias: 10, out: 10, lean: 20, T: 10, W: 0.024, Rl: 5, nod: 4, bob: 0.016, F: 0.03, head: [-4, 0, 0] } },
    blade:   { stand: { la: 18, ra: 46, lo: 6, ro: -4, rtw: -20, lean: 6, twist: -14, ll: 10, rl: -10, lspread: 5, rspread: 5, head: [2, 4, 0] },
               walk: { A: 32, B: 20, bias: 10, out: 5, lean: 8, T: 4, W: 0.01, Rl: 1.5, nod: 1, bob: 0.006, arms: { ra: 44, ro: -4, rtw: -20, sw: 5 } },
               run: { A: 58, B: 56, bias: 12, out: 3, lean: 18, T: 8, W: 0.008, Rl: 1.5, nod: 2, bob: 0.008, F: 0.04, arms: { ra: -38, ro: 20, rtw: -10, sw: 6 } } },
    watcher: { stand: { la: 0, ra: 0, lo: 1, ro: 1, lean: 2 },
               walk: { A: 34, B: 6, bias: 0, out: 1, lean: 5, T: 2, W: 0.004, Rl: 0.5, nod: 0, bob: 0, head: [0, 0, 0] },
               run: { A: 60, B: 0, bias: -44, out: 4, lean: 22, T: 4, W: 0.004, Rl: 0.5, nod: 0, bob: 0, F: 0.05, head: [-10, 0, 0], arms: { la: -44, ra: -44, lo: 4, ro: 4, sw: 3 } } }
  };
  const S = STYLES[STY] || STYLES[KILLER ? 'stalker' : 'casual'];
  const STAND = Object.assign({ la: 0, ra: 0 }, S.stand);

  /*
   * A gait cycle, ph 0..1: the left foot strikes at 0, the right at 0.5. A foot is down for `duty`
   * of the cycle (more than half in a walk, less in a run) and swings forward quicker than it went
   * back. Arms lag the legs a little; the torso twists with the shoulders and shifts over the
   * standing foot; a run leaves the ground between steps.
   */
  const legWave = (ph, duty) => { ph = wrap(ph); return cos(PI * (ph < duty ? ph / duty : 1 + (ph - duty) / (1 - duty))); };
  function gait(ph, g, duty, over = {}) {
    const lw = legWave(ph, duty), rw = legWave(ph + 0.5, duty);
    const armL = cos(TAU * (ph - 0.5 - 0.06)), armR = cos(TAU * (ph - 0.06));
    const mid = duty / 2, sway = cos(TAU * (ph - mid));
    let lift = 0;
    if (g.F) for (const s of [duty, 0.5 + duty]) { const u = (wrap(ph - s)) / (0.5 - duty); if (u > 0 && u < 1) lift = g.F * sin(PI * u); }
    const flail = g.flail ? sin(TAU * ph * 2 + 1) * 6 : 0;
    const p = {
      ll: g.A * lw, rl: g.A * rw,
      la: g.bias + g.B * armL, ra: g.bias + g.B * armR,
      lo: g.out + 3 * (armL < 0 ? -armL : 0) + flail, ro: g.out + 3 * (armR < 0 ? -armR : 0) - flail,
      lean: g.lean + (g.F ? 1.5 * cos(TAU * ph * 2) : 0.6 * cos(TAU * ph * 2)),
      twist: g.T * cos(TAU * (ph - 0.04)),
      x: g.W * sway, roll: -g.Rl * sway,
      y: -(g.bob || 0) * (0.5 + 0.5 * cos(TAU * ph * 2)) + lift,
      head: [(g.head ? g.head[0] : 0) + g.nod * cos(TAU * (ph * 2 - 0.08)), g.head ? g.head[1] : 0, g.head ? g.head[2] : 0]
    };
    if (g.arms) {                                       // arms held, not swung (behind the back, a sword out, trailing)
      const h = g.arms, sw = h.sw || 0;
      for (const k of ['la', 'ra']) if (h[k] !== undefined) p[k] = h[k] + sw * (k === 'la' ? armL : armR);
      for (const k of ['lo', 'ro', 'ltw', 'rtw']) if (h[k] !== undefined) p[k] = h[k];
    }
    if (g.glide) p.y *= 1 - g.glide;                    // the ghost barely bobs
    return Object.assign(p, over);
  }

  /* ---------------- locomotion ---------------- */
  // natural speeds, at a time scale of 1 (render/characters.js matches its time scale to the real speed):
  // walk 2.7 m/s, run 5.7, chase 6.2, limp 2.2, hurt run 5.2
  add({ id: 'walk', name: 'Walk', duration: 0.62, travel: 2.7, pose(t) {
    return R6(gait(t / 0.62, S.walk, 0.6));
  } });

  add({ id: 'run', name: 'Run', duration: 0.5, travel: 5.7, pose(t) {
    return R6(gait(t / 0.5, KILLER ? STYLES.officer.run : S.run, 0.38));
  } });

  // a killer's sprint: each one's own (the trailing arms of Guest 666 and Blox Watch, the sword held back, a charge)
  add({ id: 'chase', name: 'Chase', duration: 0.48, travel: 6.2, pose(t) {
    return R6(gait(t / 0.48, S.run, 0.36));
  } });

  // hurt: the right leg is favoured, the left hand clutches the side, the body dips onto the good leg
  add({ id: 'limp', name: 'Limp', duration: 0.9, travel: 2.2, pose(t) {
    const ph = t / 0.9, lw = legWave(ph, 0.66), rw = legWave(ph + 0.5, 0.5);
    const onGood = Math.max(0, cos(TAU * (ph - 0.3)));
    return R6({ ll: 30 * lw, rl: 20 * rw, la: 38, lo: -26, ltw: 30, ra: 6 - 14 * cos(TAU * ph), ro: 6, lean: 10 + 3 * onGood,
                twist: 5 * cos(TAU * ph), x: 0.024 * cos(TAU * (ph - 0.3)), roll: -4 * cos(TAU * (ph - 0.3)), y: -0.02 * onGood,
                head: [10 + 4 * onGood, -4, 4 * cos(TAU * (ph - 0.3))] });
  } });

  add({ id: 'hurtrun', name: 'Hurt run', duration: 0.54, travel: 5.2, pose(t) {
    const p = gait(t / 0.54, S.run === STYLES.posh.run ? STYLES.casual.run : S.run, 0.4);
    return R6(Object.assign(p, { la: 40, lo: -24, ltw: 30, lean: p.lean + 4, head: [p.head[0] + 6, 0, 4] }));
  } });

  /* ---------------- standing ---------------- */
  // breathing, a slow shift of weight, and looks around that hold, not a sweeping sine
  function looks(t, dur, keys) { return at(keys.map(([u, y, p, r]) => [u * dur, { y: y || 0, p: p || 0, r: r || 0 }]), t); }
  add({ id: 'idle', name: 'Idle', duration: 6, pose(t) {
    const p = t / 6 * TAU, br = sin(p * 2), sh = sin(p);
    const L = looks(t, 6, STY === 'watcher'
      ? [[0, 0], [0.3, 0], [0.31, 34, -4, 8], [0.45, 34, -4, 8], [0.46, 0], [0.7, 0], [0.71, -40, 6, -12], [0.82, -40, 6, -12], [0.83, 0], [1, 0]]
      : STY === 'nervous'
        ? [[0, 0], [0.12, 34, -2], [0.2, 34, -2], [0.28, -6, 8], [0.4, -40, 0], [0.48, -40, 0], [0.56, 0, 4], [0.7, 22, -6], [0.78, 22, -6], [1, 0]]
        : KILLER
          ? [[0, 0], [0.2, 0], [0.34, 28, 4], [0.5, 28, 4], [0.62, -20, 6], [0.78, -20, 6], [0.9, 0], [1, 0]]
          : [[0, 0], [0.18, 0], [0.28, 26, -2], [0.42, 26, -2], [0.52, 0, 3], [0.62, 0, 3], [0.72, -22, 0], [0.84, -22, 0], [0.94, 0], [1, 0]]);
    const base = Object.assign({}, STAND);
    const h = base.head || [0, 0, 0];
    const breathe = { lo: 1.5 * br, ro: 1.5 * br, lean: 0.8 * br, y: 0.004 * br };
    let extra = {};
    switch (STY) {
      case 'casual':                                    // weight on one hip, then the other
        extra = { x: 0.018 * sh, roll: -2.2 * sh, ll: 2 + 3 * Math.max(0, -sh), rl: -2 + 3 * Math.max(0, sh), lspread: 2 + 3 * Math.max(0, -sh), rspread: 2 + 3 * Math.max(0, sh) };
        break;
      case 'soldier': extra = { x: 0.006 * sh, roll: -0.8 * sh }; break;
      case 'nervous':                                   // shivers, and hugs itself tighter now and then
        extra = { x: 0.008 * sh, la: 3 * sin(p * 6), ra: -3 * sin(p * 6), lean: 1.5 * sin(p * 3), y: 0.003 * sin(p * 9) };
        break;
      case 'posh': {                                    // checks the watch once a loop
        const w = clamp((t - 2.4) / 0.4) * clamp((4.0 - t) / 0.4);
        extra = { la: EASE.io(w) * 92, lo: -EASE.io(w) * 44, ltw: EASE.io(w) * 60, x: 0.008 * sh, roll: -0.8 * sh };
        if (w > 0) { L.y = L.y * (1 - w) - 14 * w; L.p = L.p * (1 - w) + 22 * w; }
        break;
      }
      case 'stalker':                                   // arms swaying like dead weight, a slow float
        extra = { la: 4 * sin(p + 0.6), ra: 4 * sin(p + 1.4), y: 0.008 * sin(p) - 0.004 * br, lean: 1.2 * sin(p) };
        break;
      case 'officer': extra = { lean: 0.6 * sh }; break;
      case 'brute':                                     // heavy breaths that lift the shoulders
        extra = { lo: 4 * br, ro: 4 * br, lean: 2 * br, y: 0.006 * br, x: 0.012 * sh, roll: -1.6 * sh };
        break;
      case 'blade':                                     // light on the feet, blade point circling
        extra = { ra: 4 * sin(p * 2), ro: 3 * cos(p * 2), y: 0.006 * abs(sin(p * 3)), x: 0.006 * sh };
        break;
      case 'watcher': extra = { y: 0.002 * br }; break;
    }
    const g = addP(addP(base, breathe), extra);
    g.head = [h[0] + L.p + 1.2 * sin(p * 3), h[1] + L.y, h[2] + L.r];
    return R6(g);
  } });

  add({ id: 'hurtidle', name: 'Hurt idle', duration: 3, pose(t) {
    const p = t / 3 * TAU, br = sin(p * 3);
    return R6({ la: 40, lo: -26, ltw: 30, ra: 10 + 3 * br, ro: 6, lean: 12 + 2.5 * br, ll: 6, rl: -8, lspread: 3, rspread: 5,
                x: 0.012 * sin(p), roll: -2 * sin(p), y: 0.004 * br, head: [12 + 3 * br, 10 * sin(p), 5] });
  } });

  add({ id: 'scared', name: 'Scared', duration: 2.4, pose(t) {
    const p = t / 2.4 * TAU, tremble = sin(p * 18) * 1.5;
    const L = looks(t, 2.4, [[0, 0], [0.15, 40, 4], [0.3, 40, 4], [0.45, -30, 0], [0.62, -30, 0], [0.8, 10, 8], [1, 0]]);
    return R6({ la: 55 + tremble, ra: 52 - tremble, lo: -12, ro: -12, ltw: 14, rtw: 14, lean: 12, ll: 6, rl: -8, lspread: 3, rspread: 3,
                y: 0.002 * sin(p * 18), head: [8 + L.p, L.y, 0] });
  } });

  /* ---------------- in the air ---------------- */
  add({ id: 'jump', name: 'Jump', duration: 0.4, loop: false, pose(t) {
    const up = { la: 40, ra: 46, lo: 20, ro: 22, lean: -4, ll: 26, rl: -12, head: [-6, 0, 0], plant: false, y: 0.02 };
    return keyed([[0, Object.assign({ plant: false }, STAND)], [0.12, up, 'snap'], [0.4, Object.assign({}, up, { la: 34, ra: 40, ll: 18, rl: -6 })]], t);
  } });
  add({ id: 'fall', name: 'Fall', duration: 1.2, pose(t) {
    const p = t / 1.2 * TAU;
    return R6({ la: 36 + 8 * sin(p), ra: 40 - 8 * sin(p), lo: 34 + 6 * sin(p * 2), ro: 34 - 6 * sin(p * 2), lean: 4, ll: 16 + 10 * sin(p), rl: -8 - 10 * sin(p),
                lspread: 6, rspread: 6, head: [4, 0, 0], plant: false });
  } });
  add({ id: 'land', name: 'Land', duration: 0.42, loop: false, pose(t) {
    const squash = { la: 26, ra: 30, lo: 22, ro: 22, lean: 16, ll: 24, rl: -26, lspread: 8, rspread: 8, head: [-12, 0, 0], y: -0.03 };
    return keyed([[0, Object.assign({}, STAND, { la: 36, ra: 40, lo: 30, ro: 30 })], [0.07, squash, 'snap'], [0.42, STAND, 'io']], t);
  } });

  /* ---------------- reactions ---------------- */
  add({ id: 'hurt', name: 'Hurt', duration: 0.55, loop: false, pose(t) {
    const hit = { la: 44, ra: 36, lo: 24, ro: 30, lean: -16, twist: 14, ll: 12, rl: -16, head: [-18, 12, 12], z: -0.08 };
    return keyed([[0, STAND], [0.07, hit, 'snap'], [0.2, Object.assign({}, hit, { lean: -10, twist: 8 }), 'out'], [0.55, STAND, 'io']], t);
  } });

  // dazed: the body circles over its feet, arms hanging limp and swinging behind it, the head lolling
  add({ id: 'stunned', name: 'Stunned', duration: 1.6, pose(t) {
    const p = t / 1.6 * TAU, c = cos(p), s = sin(p), lag = p - 1.1;
    return R6({ la: 8 - 12 * cos(lag), ra: 8 - 12 * cos(lag + 0.6), lo: 16 + 10 * sin(lag), ro: 16 - 10 * sin(lag), lean: 14 + 7 * c, roll: 8 * s,
                ll: 8 + 4 * s, rl: -10 + 4 * s, lspread: 7, rspread: 7,
                head: [24 + 12 * cos(p - 1.4), 14 * sin(p - 1.4), 20 * sin(p - 1.4)], hs: 0, x: 0.03 * s, z: 0.025 * c });
  } });

  add({ id: 'death', name: 'Death', duration: 1.8, loop: false, pose(t) {
    const stagger = { la: 34, ra: 22, lo: 22, ro: 32, lean: -18, twist: 16, ll: 16, rl: -20, head: [-22, 20, 16], z: -0.12, plant: true };
    const buckle = { la: 70, ra: 60, lo: 18, ro: 24, lean: 30, twist: 6, ll: -10, rl: -30, head: [-10, 10, 0], z: 0.0, plant: true };
    const fall = { la: 160, ra: 168, lo: 12, ro: 18, lean: 90, ll: -88, rl: -90, head: [-24, 62, 0], y: -0.475 - 0.19, z: 0.44, roll: 4, plant: false };
    const bounce = Object.assign({}, fall, { y: fall.y + 0.035, la: 140, ra: 150, lean: 86 });
    return keyed([[0, STAND], [0.16, stagger, 'snap'], [0.5, buckle, 'io'], [0.82, fall, 'in'], [0.96, bounce, 'out'], [1.14, fall, 'in'], [1.8, Object.assign({}, fall, { la: 166, ra: 172 })]], t);
  } });

  /* ---------------- objectives ---------------- */
  // down on one knee as far as a rigid leg goes, hands busy, and a nervous glance back now and then
  add({ id: 'repair', name: 'Repair', duration: 3.2, pose(t) {
    const p = t / 3.2 * TAU, work = sin(p * 8);
    const glance = clamp((t - 1.9) / 0.25) * clamp((2.75 - t) / 0.25);
    const g = EASE.io(glance);
    return R6({ la: 64 + 10 * work, ra: 68 - 10 * work, lo: -12 + 5 * sin(p * 16), ro: -12 + 5 * cos(p * 16), ltw: 10, rtw: 10,
                lean: 16 - 8 * g, ll: 40, rl: -36, lspread: 6, rspread: 6, twist: -4 * g,
                head: [30 - 26 * g + 3 * sin(p * 4), 2 + 70 * g, 0], hs: 0.4, y: 0.004 * work });
  } });

  add({ id: 'heal', name: 'Heal', duration: 1.6, pose(t) {
    const p = t / 1.6 * TAU;
    return R6({ la: 62 + 10 * sin(p), ra: 66 + 10 * cos(p), lo: -16, ro: -16, ltw: 14, rtw: 14, lean: 22, ll: 46, rl: -42, lspread: 6, rspread: 6,
                head: [30 + 4 * sin(p * 2), 0, 0] });
  } });

  /* ---------------- abilities and attacks ---------------- */
  // all strikes: wind-up eased in, the hit in a few frames, an overshoot, then home
  add({ id: 'throw', name: 'Throw', duration: 0.8, loop: false, pose(t) {
    const wind = { ra: 205, la: 70, lo: 10, ro: 8, lean: -8, twist: -30, ll: 22, rl: -18, head: [-6, 24, 0] };
    const rel = { ra: 110, la: 10, lean: 12, twist: 26, ll: 26, rl: -22, z: 0.06, head: [0, -6, 0] };
    const thru = { ra: 30, ro: -30, la: -10, lean: 16, twist: 32, ll: 24, rl: -20, z: 0.08 };
    return keyed([[0, STAND], [0.26, wind, 'io'], [0.32, rel, 'snap'], [0.42, thru, 'out'], [0.8, STAND, 'io']], t);
  } });

  add({ id: 'cast', name: 'Cast', duration: 0.9, loop: false, pose(t) {
    const gather = { la: -24, ra: -24, lo: 24, ro: 24, lean: -10, twist: 0, ll: 10, rl: -8, head: [-10, 0, 0], y: -0.01 };
    const push = { la: 94, ra: 94, lo: -10, ro: -10, ltw: 40, rtw: 40, lean: 12, ll: 26, rl: -20, z: 0.08 };
    const hold = Object.assign({}, push, { la: 90, ra: 90, lean: 10 });
    const tremble = t > 0.36 && t < 0.62 ? { la: 1.5 * sin(t * 90), ra: -1.5 * sin(t * 90) } : null;
    return keyed([[0, STAND], [0.26, gather, 'io'], [0.34, push, 'snap'], [0.62, hold, 'lin'], [0.9, STAND, 'io']], t, tremble);
  } });

  add({ id: 'shoot', name: 'Shoot', duration: 0.65, loop: false, pose(t) {
    const aim = { ra: 92, ro: -2, la: 24, lo: -8, lean: 2, twist: -16, ll: 12, rl: -10, head: [0, 14, 0] };
    const kick = Object.assign({}, aim, { ra: 116, lean: -5, z: -0.04, head: [-6, 14, 0] });
    return keyed([[0, STAND], [0.14, aim, 'out'], [0.24, aim, 'lin'], [0.27, kick, 'snap'], [0.4, aim, 'out'], [0.65, STAND, 'io']], t);
  } });

  add({ id: 'block', name: 'Block', duration: 1, pose(t) {
    const b = sin(t * TAU) * 2;
    return R6({ la: 100 + b, ra: 96 - b, lo: -30, ro: -30, ltw: 30, rtw: 30, lean: -4, ll: 18, rl: -16, lspread: 6, rspread: 6, head: [4, 0, 0], y: -0.01 });
  } });

  // a killer's basic swing (M1), in the killer's own manner; the hit lands at 0.25 s (swing() plays it at 1.25x after a 0.2 s windup)
  add({ id: 'attack', name: 'Attack', duration: 0.8, loop: false, pose(t) {
    let wind, hit, thru;
    switch (STY) {
      case 'officer':                                   // pistol whip: a backhand across
        wind = { ra: 110, ro: 60, rtw: -30, la: 10, lean: -4, twist: -36, ll: 16, rl: -12, head: [-4, 26, 0] };
        hit = { ra: 96, ro: -40, rtw: 10, la: 0, lean: 14, twist: 30, ll: 28, rl: -22, z: 0.12 };
        thru = { ra: 70, ro: -60, la: -6, lean: 16, twist: 40, ll: 26, rl: -20, z: 0.14 };
        break;
      case 'brute':                                     // rifle butt: both arms, a driving jab
        wind = { ra: 60, la: 70, ro: -20, lo: -24, lean: -10, twist: -20, ll: 12, rl: -10, z: -0.06, head: [-6, 10, 0] };
        hit = { ra: 104, la: 110, ro: -24, lo: -30, lean: 22, twist: 8, ll: 34, rl: -28, z: 0.2 };
        thru = Object.assign({}, hit, { ra: 98, la: 104, lean: 24, z: 0.22 });
        break;
      case 'watcher':                                   // shock: a palm thrust, both hands
        wind = { ra: 30, la: 30, ro: 24, lo: 24, lean: -6, ll: 10, rl: -8, head: [-8, 0, 0] };
        hit = { ra: 96, la: 96, ro: -6, lo: -6, ltw: 70, rtw: 70, lean: 16, ll: 28, rl: -24, z: 0.16 };
        thru = Object.assign({}, hit, { lean: 18 });
        break;
      default:                                          // a claw: overhead and down across the body
        wind = { ra: 182, ro: 16, la: 44, lo: 10, lean: -10, twist: -24, ll: 16, rl: -14, head: [-8, 16, 0] };
        hit = { ra: 46, ro: -10, la: 12, lean: 20, twist: 20, ll: 30, rl: -24, z: 0.12 };
        thru = { ra: -16, ro: -24, la: 0, lean: 18, twist: 28, ll: 26, rl: -22, z: 0.13 };
    }
    return keyed([[0, STAND], [0.2, wind, 'io'], [0.27, hit, 'snap'], [0.4, thru, 'back'], [0.8, STAND, 'io']], t);
  } });

  // a flat, sweeping cut (the Elite Guard's sword)
  add({ id: 'slash', name: 'Slash', duration: 0.75, loop: false, pose(t) {
    const wind = { ra: 92, ro: 76, rtw: -80, la: 34, lean: 2, twist: -44, ll: 16, rl: -14, head: [0, 26, 0] };
    const cut = { ra: 92, ro: -34, rtw: -80, la: 20, lean: 12, twist: 36, ll: 28, rl: -22, z: 0.1 };
    const thru = { ra: 74, ro: -58, rtw: -70, la: 8, lean: 14, twist: 48, ll: 26, rl: -20, z: 0.12 };
    return keyed([[0, STAND], [0.2, wind, 'io'], [0.27, cut, 'snap'], [0.4, thru, 'back'], [0.75, STAND, 'io']], t);
  } });

  add({ id: 'lunge', name: 'Lunge', duration: 0.9, loop: false, pose(t) {
    const coil = { ra: -34, la: -34, lo: 12, ro: 12, lean: 22, ll: 30, rl: -30, head: [-14, 0, 0], y: -0.02 };
    const go = { ra: 104, la: 104, lo: -6, ro: -6, lean: 32, ll: 52, rl: -52, z: 0.36, head: [-28, 0, 0] };
    return keyed([[0, STAND], [0.2, coil, 'io'], [0.3, go, 'snap'], [0.6, go, 'lin'], [0.9, STAND, 'io']], t);
  } });

  add({ id: 'roar', name: 'Roar', duration: 1.6, loop: false, pose(t) {
    const crouch = { la: 20, ra: 20, lo: 30, ro: 30, lean: 18, ll: 14, rl: -12, lspread: 8, rspread: 8, head: [10, 0, 0] };
    const wide = { la: 46, ra: 46, lo: 66, ro: 66, lean: -14, ll: 10, rl: -10, lspread: 10, rspread: 10, head: [-30, 0, 0], y: 0.01 };
    const shake = { head: [2 * sin(t * 70), 6 * sin(t * 47), 4 * sin(t * 59)] };
    return keyed([[0, STAND], [0.3, crouch, 'io'], [0.42, wide, 'snap'], [1.1, wide, 'lin'], [1.6, STAND, 'io']], t, t > 0.42 && t < 1.1 ? shake : null);
  } });

  add({ id: 'roll', name: 'Roll', duration: 0.6, loop: false, pose(t) {
    const k = clamp(t / 0.6), spin = 360 * EASE.io(k), tuck = sin(PI * k);
    return R6({ la: 60 * tuck, ra: 60 * tuck, ll: 90 * tuck, rl: 90 * tuck, lean: spin, y: -0.5 * tuck, z: 0.6 * k, head: [-spin + 30 * tuck, 0, 0], plant: false });
  } });

  // lifted by a killer's power: dangling, kicking
  add({ id: 'lifted', name: 'Lifted', duration: 1, pose(t) {
    const p = t * TAU;
    return R6({ la: 24 + 12 * sin(p * 2), ra: 28 - 12 * sin(p * 2), lo: 32, ro: 32, ll: 18 * sin(p * 3), rl: -18 * sin(p * 3), lean: -10, roll: 4 * sin(p),
                head: [-22, 12 * sin(p), 0], y: 0.02, plant: false });
  } });

  /* ---------------- emotes, lobby, renders ---------------- */
  add({ id: 'wave', name: 'Wave', duration: 2, loop: false, pose(t) {
    const up = EASE.io(clamp(t / 0.3)) * EASE.io(clamp((2 - t) / 0.35));
    return R6(addP(STAND, { ra: 165 * up - (STAND.ra || 0) * up, ro: 20 * up + 18 * sin(t * 13) * up, head: [-4 * up, 8 * up, 6 * up], roll: 2 * up }));
  } });

  add({ id: 'point', name: 'Point', duration: 1.4, loop: false, pose(t) {
    const pt = { ra: 92, ro: 0, rtw: 0, la: 4, lean: 3, twist: -10, ll: 8, rl: -6, head: [-4, 8, 0] };
    return keyed([[0, STAND], [0.2, pt, 'snap'], [1.05, Object.assign({}, pt, { ra: 90 }), 'lin'], [1.4, STAND, 'io']], t);
  } });

  add({ id: 'dance', name: 'Dance', duration: 1.6, pose(t) {
    const p = t / 1.6 * TAU, b = abs(sin(p * 2));
    return R6({ la: 90 + 80 * sin(p), ra: 90 - 80 * sin(p), lo: 30, ro: 30, ll: 20 * sin(p), rl: -20 * sin(p), lspread: 6, rspread: 6,
                twist: 18 * sin(p), roll: 8 * sin(p), head: [-6 + 10 * b, 12 * sin(p), 0], y: -0.04 * b, hs: 0.2 });
  } });

  add({ id: 'cheer', name: 'Cheer', duration: 1.2, pose(t) {
    const p = t / 1.2 * TAU, pump = sin(p * 2);
    return R6({ la: 170 + 8 * pump, ra: 170 - 8 * pump, lo: 16, ro: 16, head: [-16, 0, 0], y: 0.05 * abs(pump), plant: true, lean: -3 });
  } });

  add({ id: 'sit', name: 'Sit', duration: 5, pose(t) {
    const p = t / 5 * TAU;
    return R6({ la: 50, ra: 46, lo: -6, ro: -6, ll: 88, rl: 86, lspread: 4, rspread: 4, head: [6, sin(p) * 28, 0], y: -0.48, z: -0.12, plant: false });
  } });

  // the hero pose for renders and the character select
  add({ id: 'pose', name: 'Pose', duration: 3, pose(t) {
    const b = sin(t / 3 * TAU) * 1.5;
    if (KILLER) return R6(addP(STAND, { la: 8 + b, ra: 14 - b, lo: 8, ro: 6, lean: 4, twist: 14, ll: 8, rl: -6, lspread: 3, rspread: 3, head: [4, -12, 4] }));
    return R6(addP(STAND, { la: -8 + b, ra: 8 - b, lo: 6, ro: 4, lean: -2, twist: -12, ll: 10, rl: -8, lspread: 4, rspread: 4, head: [-2, 14, -4] }));
  } });
})();
