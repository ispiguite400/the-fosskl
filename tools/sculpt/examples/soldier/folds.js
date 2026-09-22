// ---- join the pieces into one model ----
M.joinAll();
M.app.set('cavity', 0.12); M.app.set('matcap', 'white');

// ---- sculpt pass: cloth folds, webbing, seams (real brush strokes on the joined mesh) ----
M.opts({ dyntopo: false, symmetryX: false, strokeSmoothing: 0, pressureRadius: false, pressureStrength: false, falloff: 'smooth', autoSmooth: 0.15 });
const fold = (brush, pts, r, s) => M.wstroke(brush, pts, r, s);
const view = (p, dir, h) => M.at(p, dir, h || 0.25);
const legs = [{ x: -0.112, kz: 0.085, ky: 0.515, hx: -0.093, s: -1 }, { x: 0.108, kz: -0.075, ky: 0.52, hx: 0.093, s: 1 }];
for (const L of legs) {
  // behind the knee: stacked creases where the trousers bunch
  view([L.x, L.ky, L.kz], [0, 0, -1]);
  for (const dy of [-0.01, 0.02, 0.05]) fold('crease', [[L.x - 0.05, L.ky + dy, 0], [L.x, L.ky + dy - 0.012, 0], [L.x + 0.05, L.ky + dy, 0]], 0.012, 0.55);
  // front of the thigh: diagonal pulls from hip to knee
  view([L.x, 0.75, L.kz], [0, 0, 1]);
  for (const [y0, y1] of [[0.86, 0.78], [0.76, 0.68], [0.67, 0.61]]) {
    fold('crease', [[L.x - 0.055 * L.s, y0, 0], [L.x + 0.035 * L.s, y1, 0]], 0.011, 0.45);
    fold('clay', [[L.x - 0.05 * L.s, y0 - 0.02, 0], [L.x + 0.035 * L.s, y1 - 0.02, 0]], 0.012, 0.18);
  }
  // shins: the cloth stacks where it meets the boot
  for (const dir of [[0, 0, 1], [L.s, 0, 0.3], [-L.s, 0, 0.3]]) {
    view([L.x, 0.3, L.kz], dir);
    for (const y of [0.235, 0.265, 0.3, 0.34]) fold('crease', [[L.x - 0.08, y, L.kz], [L.x + 0.08, y + (y * 100 % 2 ? 0.01 : -0.01), L.kz]], 0.009, 0.45);
  }
  // knee pad straps above and below the pad
  view([L.x, L.ky, L.kz], [L.s * 0.6, 0, 1], 0.15);
  for (const dy of [0.075, -0.07]) fold('crease', [[L.x - 0.08, L.ky + dy, 0], [L.x + 0.08, L.ky + dy, 0]], 0.005, 0.5);
  // toe cap
  view([L.x, 0.06, L.kz + 0.14], [0, 1, 0.35], 0.1);
  fold('crease', [[L.x - 0.06, 0.06, L.kz + 0.1], [L.x, 0.06, L.kz + 0.13], [L.x + 0.06, 0.06, L.kz + 0.1]], 0.005, 0.45);
  // cargo pocket flap
  view([L.hx + 0.085 * L.s, 0.72, 0], [L.s, 0, 0]);
  fold('crease', [[L.hx + 0.1 * L.s, 0.77, 0.05], [L.hx + 0.1 * L.s, 0.775, -0.04]], 0.006, 0.5);
  // boot: tongue and lace line, welt above the sole
  view([L.x, 0.1, L.kz + 0.1], [0, 0.4, 1], 0.12);
  fold('crease', [[L.x, 0.2, 0], [L.x, 0.1, 0]], 0.006, 0.5);
  for (const y of [0.1, 0.125, 0.15, 0.175, 0.2]) {                        // laces, crossed
    fold('crease', [[L.x - 0.022, y, 0], [L.x + 0.022, y + 0.018, 0]], 0.0035, 0.35);
    fold('crease', [[L.x + 0.022, y, 0], [L.x - 0.022, y + 0.018, 0]], 0.0035, 0.35);
  }
  for (const dir of [[0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 0, -1]]) { view([L.x, 0.04, L.kz], dir, 0.15); fold('crease', [[L.x - 0.12, 0.034, L.kz], [L.x + 0.12, 0.034, L.kz]], 0.005, 0.4); }
}
// sleeves: creases at the inside of the elbow and under the shoulder
for (const [el, s] of [[[-0.255, 1.16, 0.05], -1], [[0.265, 1.165, -0.06], 1]]) {
  view(el, [0, 0, 1], 0.2);
  for (const dy of [-0.02, 0.01, 0.04]) fold('crease', [[el[0] - 0.045, el[1] + dy, 0], [el[0] + 0.045, el[1] + dy - 0.015 * s, 0]], 0.009, 0.5);
  view([el[0], 1.32, 0], [s, 0, 0], 0.2);
  for (const dy of [0, 0.035]) fold('crease', [[el[2] - 0.05, 1.3 + dy, 0], [el[2] + 0.05, 1.29 + dy, 0]].map(p => [el[0], p[1], p[0]]), 0.009, 0.4);
}
// shirt bunched between the plate carrier and the belt
for (const dir of [[0, 0, 1], [0, 0, -1]]) {
  view([0, 1.07, 0], dir, 0.2);
  for (const y of [1.055, 1.085]) fold('crease', [[-0.13, y, 0], [0, y - 0.008, 0], [0.13, y + 0.004, 0]], 0.01, 0.45);
}
// plate carrier: webbing rows round the cummerbund and back, flap lines on the pouches
for (const dir of [[1, 0, 0], [-1, 0, 0], [0, 0, -1]]) {
  view([0, 1.26, 0], dir, 0.22);
  for (let y = 1.15; y <= 1.37; y += 0.026) fold('crease', [[-0.2, y, -0.2], [0.2, y, 0.2]].map(p => dir[2] ? [p[0], y, 0] : [0, y, p[2]]), 0.004, 0.35);
}
view([0, 1.25, 0.15], [0, 0, 1], 0.2);
for (const x of [-0.08, 0, 0.08]) fold('crease', [[x - 0.03, 1.207, 0], [x + 0.03, 1.207, 0]], 0.004, 0.5);
fold('crease', [[0.047, 1.365, 0], [0.103, 1.365, 0]], 0.004, 0.5);
fold('crease', [[-0.108, 1.352, 0], [-0.032, 1.352, 0]], 0.004, 0.5);
// neck scarf: folds round the gathered cloth
for (const dir of [[0, 0, 1], [0.8, 0, 0.6], [-0.8, 0, 0.6], [0, 0, -1]]) {
  view([0, 1.49, 0], dir, 0.1);
  for (const u of [-0.04, 0, 0.04]) fold('crease', [[u, 1.515, 0], [u + 0.015, 1.465, 0]].map(p => [p[0] * dir[2] + 0, p[1], -p[0] * dir[0]]), 0.006, 0.4);
}
// face wrap: folds across the cloth
view([0, 1.59, 0.1], [0, 0, 1], 0.08);
for (const [a, b] of [[[-0.05, 1.605], [0.0, 1.575]], [[0.05, 1.6], [0.01, 1.565]], [[-0.045, 1.57], [0.03, 1.55]]]) fold('crease', [[a[0], a[1], 0], [b[0], b[1], 0]], 0.006, 0.4);
// helmet cover: a few wrinkles
view([0, 1.72, 0], [0, 0.6, 1], 0.12);
for (const [a, b] of [[[-0.07, 1.7], [-0.02, 1.74]], [[0.03, 1.745], [0.08, 1.7]], [[-0.02, 1.76], [0.03, 1.765]]]) fold('crease', [[a[0], a[1], 0], [b[0], b[1], 0]], 0.005, 0.3);
