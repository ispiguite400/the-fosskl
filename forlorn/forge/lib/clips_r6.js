/*
 * FORLORN — R6 animation clips, baked into every character by ship.mjs --clips.
 *
 * The characters are R6 rigs wearing the films' package shapes: six rigid
 * parts. An arm or a leg swings as one piece from its shoulder or hip, the
 * torso never bends, the head turns on the neck. So:
 *   - LowerArm = UpperArm and LowerLeg = UpperLeg (no elbow, no knee),
 *   - Foot = 90 + leg swing (the boot is part of the leg piece),
 *   - leaning is the whole body pitching at the hips; the legs are
 *     compensated so they keep their own angle to the ground,
 *   - Spine, Chest, Neck and the Shoulder bones never rotate.
 * The Rig Player rests the arms 8 degrees out from the body; these arms hang
 * 4 degrees out, so every clip rolls them in by the difference. rel z is not
 * mirrored by the player: + rolls the left arm out and the right arm in.
 *
 * "abs" = swing from straight down in the parent's frame, + forward (degrees).
 * make.mjs puts `const ROLE = 'survivor' | 'killer'` in front.
 */
(function () {
  const role = typeof ROLE === 'string' ? ROLE : 'survivor';
  const KILLER = role === 'killer';
  const CL = window.RigPlayer.CLIPS;
  CL.length = 0;
  const TAU = Math.PI * 2, sin = Math.sin, cos = Math.cos, abs = Math.abs;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const ease = (v) => { v = clamp(v); return v * v * (3 - 2 * v); };
  const add = (c) => { c.loop = c.loop !== false; CL.push(c); };
  const IN = 8 - 4;                                   // player rest hang minus the hang we want

  /*
   * One R6 pose:
   *   la, ra   left / right arm swing (+ forward); lo / ro arm roll outward; ltw / rtw twist
   *   ll, rl   left / right leg swing in the WORLD (+ forward); lspread / rspread outward
   *   lean     whole-body pitch forward; twist yaw; roll sideways
   *   head     [pitch (+ down), yaw (+ to the character's left), roll]
   *   x, y, z  hips offset (metres for a 1.8 m figure)
   */
  function R6(p) {
    const lean = p.lean || 0;
    const legL = (p.ll || 0) + lean, legR = (p.rl || 0) + lean;
    return {
      abs: { 'UpperArm.L': p.la || 0, 'LowerArm.L': p.la || 0, 'UpperArm.R': p.ra || 0, 'LowerArm.R': p.ra || 0,
             'UpperLeg.L': legL, 'LowerLeg.L': legL, 'Foot.L': 90 + legL, 'UpperLeg.R': legR, 'LowerLeg.R': legR, 'Foot.R': 90 + legR },
      rel: { 'Hips': [lean, p.twist || 0, p.roll || 0],
             'UpperArm.L': [0, p.ltw || 0, -IN + (p.lo || 0)], 'UpperArm.R': [0, -(p.rtw || 0), IN - (p.ro || 0)],
             'UpperLeg.L': [0, 0, p.lspread || 0], 'UpperLeg.R': [0, 0, -(p.rspread || 0)],
             'Head': [(p.head ? p.head[0] : 0) - lean, p.head ? p.head[1] : 0, p.head ? p.head[2] : 0] },
      offset: [p.x || 0, p.y || 0, p.z || 0]
    };
  }
  const lerpP = (a, b, u) => {
    const o = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const va = a[k], vb = b[k];
      if (Array.isArray(va) || Array.isArray(vb)) { const A = va || [0, 0, 0], Bv = vb || [0, 0, 0]; o[k] = A.map((x, i) => x + (Bv[i] - x) * u); }
      else o[k] = (va || 0) + ((vb || 0) - (va || 0)) * u;
    }
    return o;
  };
  function keyed(keys, t) {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
    const [t0, a] = keys[i], [t1, b] = keys[Math.min(i + 1, keys.length - 1)];
    return R6(lerpP(a, b, t1 > t0 ? ease((t - t0) / (t1 - t0)) : 1));
  }
  const STAND = KILLER ? { la: 6, ra: 8, lean: 6, head: [4, 0, 0], lo: 2, ro: 2 } : { la: 0, ra: 0 };

  /* ---------------- locomotion ---------------- */
  add({ id: 'idle', name: 'Idle', duration: 4, pose(t) {
    const p = t / 4 * TAU, b = sin(p * 2), sw = sin(p);
    if (KILLER) return R6({ la: 8 + 3 * b, ra: 10 - 3 * b, lo: 3, ro: 3, lean: 8 + 2 * b, ll: 2, rl: -2, lspread: 3, rspread: 3,
                            head: [6 + sin(p * 3) * 3, sin(p) * 24, sin(p * 0.5) * 9], y: -0.012 + b * 0.006, x: sw * 0.01 });
    return R6({ la: 2 * b, ra: -2 * b, lo: 1, ro: 1, lean: b * 0.8, ll: sw * 1.5, rl: -sw * 1.5, roll: sw * 1.2,
                head: [sin(p * 3) * 2, sin(p) * 22, 0], y: b * 0.004 });
  } });

  add({ id: 'walk', name: 'Walk', duration: 0.9, travel: 2.0, pose(t) {
    const p = t / 0.9 * TAU, a = KILLER ? 30 : 36, s = sin(p);
    return R6({ ll: -a * s, rl: a * s, la: a * 0.9 * s, ra: -a * 0.9 * s, lean: KILLER ? 7 : 2,
                twist: 5 * s, roll: 2 * cos(p * 2), head: [KILLER ? 4 : 0, -4 * s, 0], y: -0.02 + 0.026 * abs(cos(p)) });
  } });

  add({ id: 'run', name: 'Run', duration: 0.6, travel: 4.6, pose(t) {
    const p = t / 0.6 * TAU, s = sin(p);
    return R6({ ll: -58 * s, rl: 58 * s, la: 62 * s, ra: -62 * s, lo: 4, ro: 4, lean: KILLER ? 16 : 12,
                twist: 8 * s, roll: 3 * cos(p * 2), head: [-2, -6 * s, 0], y: -0.05 + 0.06 * abs(sin(p + 0.4)), z: 0.02 });
  } });

  // the classic R6 sprint some killers use: arms trailing behind
  add({ id: 'chase', name: 'Chase', duration: 0.56, travel: 5, pose(t) {
    const p = t / 0.56 * TAU, s = sin(p);
    return R6({ ll: -60 * s, rl: 60 * s, la: -38 + 8 * s, ra: -38 - 8 * s, lo: 12, ro: 12, lean: 22,
                twist: 6 * s, head: [-10, 0, 0], y: -0.06 + 0.06 * abs(sin(p + 0.4)), z: 0.03 });
  } });

  add({ id: 'scared', name: 'Scared', duration: 2.4, pose(t) {
    const p = t / 2.4 * TAU, look = sin(p) * 45 + sin(p * 3) * 12, tremble = sin(p * 18) * 1.5;
    return R6({ la: 55 + tremble, ra: 52 - tremble, lo: -10, ro: -10, lean: 10, ll: 6, rl: -8, y: -0.05, head: [6, look, 0] });
  } });

  /* ---------------- reactions ---------------- */
  add({ id: 'hurt', name: 'Hurt', duration: 0.5, loop: false, pose(t) {
    const k = sin(Math.PI * clamp(t / 0.5));
    return R6({ la: 40 * k, ra: 34 * k, lo: 20 * k, ro: 24 * k, lean: -14 * k, ll: 6 * k, rl: -10 * k, head: [-14 * k, 8 * k, 10 * k], z: -0.08 * k, y: -0.02 * k });
  } });

  add({ id: 'stunned', name: 'Stunned', duration: 1.2, pose(t) {
    const p = t / 1.2 * TAU;
    return R6({ la: 150, ra: 150, lo: 18, ro: 18, lean: 14 + 4 * sin(p), roll: 7 * sin(p), ll: 4, rl: -4, head: [20, 0, 12 * sin(p + 1)], y: -0.03, x: 0.03 * sin(p) });
  } });

  add({ id: 'death', name: 'Death', duration: 1.6, loop: false, pose(t) {
    const stagger = { la: 30, ra: 20, lo: 20, ro: 30, lean: -16, ll: 14, rl: -18, head: [-20, 20, 14], z: -0.1, y: -0.04 };
    const fall = { la: 160, ra: 168, lo: 10, ro: 16, lean: 88, ll: -86, rl: -88, head: [-20, 60, 0], y: -0.66, z: 0.42, roll: 4 };
    const settle = Object.assign({}, fall, { y: -0.645, lean: 86 });
    return keyed([[0, STAND], [0.3, stagger], [0.85, fall], [1.0, settle], [1.6, fall]], t);
  } });

  /* ---------------- objectives ---------------- */
  add({ id: 'repair', name: 'Repair', duration: 1.6, pose(t) {
    const p = t / 1.6 * TAU;
    return R6({ la: 70 + 12 * sin(p * 2), ra: 70 + 12 * cos(p * 2), lo: -10 + 6 * sin(p * 4), ro: -10 + 6 * cos(p * 4),
                lean: 12, ll: 12, rl: -6, head: [26, 8 * sin(p * 0.5), 0], y: -0.03 });
  } });

  add({ id: 'heal', name: 'Heal', duration: 1.4, pose(t) {
    const p = t / 1.4 * TAU;
    return R6({ la: 80 + 10 * sin(p), ra: 80 + 10 * cos(p), lo: -16, ro: -16, lean: 20, ll: 70, rl: -60, head: [26, 0, 0], y: -0.3, z: 0.02 });
  } });

  /* ---------------- abilities and attacks ---------------- */
  add({ id: 'throw', name: 'Throw', duration: 0.7, loop: false, pose(t) {
    const wind = { ra: 200, la: 60, lean: -6, twist: -26, ll: 18, rl: -14, ro: 6 };
    const rel = { ra: 110, la: 10, lean: 10, twist: 24, ll: 22, rl: -18, z: 0.06 };
    const thru = { ra: 40, la: 0, lean: 12, twist: 26, ll: 18, rl: -14, z: 0.08 };
    return keyed([[0, STAND], [0.22, wind], [0.32, rel], [0.45, thru], [0.7, STAND]], t);
  } });

  add({ id: 'cast', name: 'Cast', duration: 0.85, loop: false, pose(t) {
    const gather = { la: 30, ra: 30, lo: -20, ro: -20, lean: -8, ll: 8, rl: -6, head: [-6, 0, 0] };
    const push = { la: 92, ra: 92, lo: -8, ro: -8, lean: 10, ll: 22, rl: -16, z: 0.06 };
    return keyed([[0, STAND], [0.25, gather], [0.38, push], [0.62, push], [0.85, STAND]], t);
  } });

  add({ id: 'shoot', name: 'Shoot', duration: 0.6, loop: false, pose(t) {
    const aim = { ra: 92, la: 20, lean: 2, twist: -14, ll: 10, rl: -8, head: [0, 10, 0] };
    const kick = Object.assign({}, aim, { ra: 112, lean: -4, z: -0.03 });
    return keyed([[0, STAND], [0.16, aim], [0.24, aim], [0.3, kick], [0.42, aim], [0.6, STAND]], t);
  } });

  add({ id: 'block', name: 'Block', duration: 1, pose(t) {
    const b = sin(t * TAU) * 2;
    return R6({ la: 95 + b, ra: 92 - b, lo: -24, ro: -24, lean: 6, ll: 16, rl: -12, head: [2, 0, 0], y: -0.03 });
  } });

  add({ id: 'attack', name: 'Attack', duration: 0.7, loop: false, pose(t) {
    const wind = { ra: 170, la: 40, ro: 10, lean: -8, twist: -20, ll: 14, rl: -12, head: [-6, 12, 0] };
    const hit = { ra: 40, la: 10, ro: 0, lean: 18, twist: 18, ll: 26, rl: -22, z: 0.1, y: -0.03 };
    const thru = { ra: -10, la: 0, lean: 16, twist: 24, ll: 22, rl: -18, z: 0.1, y: -0.03 };
    return keyed([[0, STAND], [0.24, wind], [0.33, hit], [0.45, thru], [0.7, STAND]], t);
  } });

  // a flat, sweeping cut
  add({ id: 'slash', name: 'Slash', duration: 0.65, loop: false, pose(t) {
    const wind = { ra: 90, ro: 70, la: 30, lean: 2, twist: -40, ll: 14, rl: -12, head: [0, 20, 0] };
    const cut = { ra: 90, ro: -30, la: 20, lean: 10, twist: 34, ll: 24, rl: -20, z: 0.08 };
    const thru = { ra: 70, ro: -50, la: 10, lean: 12, twist: 44, ll: 22, rl: -18, z: 0.1 };
    return keyed([[0, STAND], [0.2, wind], [0.3, cut], [0.42, thru], [0.65, STAND]], t);
  } });

  add({ id: 'lunge', name: 'Lunge', duration: 0.85, loop: false, pose(t) {
    const coil = { ra: -30, la: -30, lo: 10, ro: 10, lean: 20, ll: 30, rl: -30, y: -0.08, head: [-12, 0, 0] };
    const go = { ra: 100, la: 100, lo: -6, ro: -6, lean: 30, ll: 50, rl: -50, y: -0.1, z: 0.35, head: [-26, 0, 0] };
    return keyed([[0, STAND], [0.2, coil], [0.34, go], [0.6, go], [0.85, STAND]], t);
  } });

  add({ id: 'roar', name: 'Roar', duration: 1.5, loop: false, pose(t) {
    const wide = { la: 40, ra: 40, lo: 60, ro: 60, lean: -12, ll: 8, rl: -8, lspread: 8, rspread: 8, head: [-24, 0, 0], y: -0.04 };
    const shake = Object.assign({}, wide, { head: [-28, 8, 6], lean: -14 });
    return keyed([[0, STAND], [0.3, wide], [0.6, shake], [0.95, wide], [1.5, STAND]], t);
  } });

  add({ id: 'roll', name: 'Roll', duration: 0.6, loop: false, pose(t) {
    const k = clamp(t / 0.6), spin = 360 * ease(k), tuck = sin(Math.PI * k);
    return R6({ la: 60 * tuck, ra: 60 * tuck, ll: 90 * tuck, rl: 90 * tuck, lean: spin, y: -0.5 * tuck, z: 0.6 * k, head: [-spin + 30 * tuck, 0, 0] });
  } });

  // lifted by a killer's power: dangling, kicking
  add({ id: 'lifted', name: 'Lifted', duration: 1, pose(t) {
    const p = t * TAU;
    return R6({ la: 20 + 10 * sin(p * 2), ra: 25 - 10 * sin(p * 2), lo: 30, ro: 30, ll: 15 * sin(p * 3), rl: -15 * sin(p * 3), lean: -8, head: [-20, 10 * sin(p), 0], y: 0.02 });
  } });

  /* ---------------- emotes, lobby, renders ---------------- */
  add({ id: 'wave', name: 'Wave', duration: 2, loop: false, pose(t) {
    const up = clamp(t / 0.3) * clamp((2 - t) / 0.35);
    return R6({ ra: 165 * ease(up), ro: 20 * up + 18 * sin(t * 13) * up, head: [-4 * up, 8 * up, 6 * up], roll: 2 * up });
  } });

  add({ id: 'point', name: 'Point', duration: 1.4, loop: false, pose(t) {
    const up = ease(clamp(t / 0.22)) * ease(clamp((1.4 - t) / 0.3));
    return R6({ ra: 90 * up, lean: 2 * up, twist: -8 * up, head: [-4 * up, 6 * up, 0] });
  } });

  add({ id: 'dance', name: 'Dance', duration: 1.6, pose(t) {
    const p = t / 1.6 * TAU, b = abs(sin(p * 2));
    return R6({ la: 90 + 80 * sin(p), ra: 90 - 80 * sin(p), lo: 30, ro: 30, ll: 20 * sin(p), rl: -20 * sin(p), lspread: 6, rspread: 6,
                twist: 18 * sin(p), roll: 8 * sin(p), head: [-6 + 10 * b, 12 * sin(p), 0], y: -0.06 * b });
  } });

  add({ id: 'cheer', name: 'Cheer', duration: 1.2, pose(t) {
    const p = t / 1.2 * TAU, pump = sin(p * 2);
    return R6({ la: 170 + 8 * pump, ra: 170 - 8 * pump, lo: 16, ro: 16, head: [-16, 0, 0], y: 0.04 * abs(pump) });
  } });

  add({ id: 'sit', name: 'Sit', duration: 5, pose(t) {
    const p = t / 5 * TAU;
    return R6({ la: 50, ra: 46, lo: -6, ro: -6, ll: 88, rl: 86, lspread: 4, rspread: 4, head: [6, sin(p) * 28, 0], y: -0.48, z: -0.12 });
  } });

  // the hero pose for renders and the character select
  add({ id: 'pose', name: 'Pose', duration: 3, pose(t) {
    const b = sin(t / 3 * TAU) * 1.5;
    if (KILLER) return R6({ la: 18 + b, ra: 28 - b, lo: 14, ro: 10, lean: 12, twist: 14, ll: 16, rl: -12, lspread: 5, rspread: 5, head: [10, -12, 6], y: -0.03 });
    return R6({ la: -6 + b, ra: 10 - b, lo: 8, ro: 6, lean: -2, twist: -12, ll: 10, rl: -8, lspread: 4, rspread: 4, head: [-2, 14, -4], roll: 2 });
  } });
})();
