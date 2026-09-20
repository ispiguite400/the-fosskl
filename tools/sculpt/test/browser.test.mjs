/*
 * End-to-end tests in a real browser: boots the standalone build from a
 * file:// URL, drives it with real mouse and keyboard input, and checks both
 * the resulting geometry and the pixels on screen.
 */
import { createRequire } from 'module';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(globalRoot + '/playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const appFile = 'file://' + path.join(here, '..', 'sculpt.html');
const screens = path.join(here, 'screens');
const tmp = process.env.SCULPT_TMP || path.join(here, 'tmp');
fs.mkdirSync(screens, { recursive: true });
fs.mkdirSync(tmp, { recursive: true });

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function eq(name, got, want) { check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--disable-lcd-text', '--force-device-scale-factor=1']
});
const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

await page.goto(appFile);
await page.waitForFunction(() => window.SCULPT_APP && window.SCULPT_APP.renderer, null, { timeout: 15000 });
await page.waitForTimeout(400);

/* ---- boot ---------------------------------------------------------- */
{
  const state = await page.evaluate(() => {
    const app = window.SCULPT_APP;
    return {
      version: window.SCULPT.VERSION,
      objects: app.scene.objects.length,
      tris: app.scene.current().mesh.liveTris,
      verts: app.scene.current().mesh.liveVerts,
      gl: !!app.renderer.gl,
      brushes: window.SCULPT.BRUSHES.length,
      toolButtons: document.querySelectorAll('#brushes .tool').length,
      pills: document.querySelectorAll('#bar-bottom .pill').length,
      // how many controls the screen shows before anything is opened
      visibleControls: Array.from(document.querySelectorAll('#ui button, #ui input')).length,
      sheets: document.querySelectorAll('.sheet').length,
      canvasW: app.canvas.width,
      canvasH: app.canvas.height,
      standalone: document.body.dataset.build
    };
  });
  check('the app booted', state.gl === true);
  eq('standalone build marker', state.standalone, 'standalone');
  eq('one starting object', state.objects, 1);
  eq('starting sphere triangle count', state.tris, 1280);
  eq('eleven brush buttons on screen (10 plus more)', state.toolButtons, 11);
  eq('size and strength sliders on screen', state.pills, 2);
  // the whole point of the redesign: the resting screen stays uncluttered
  check('the resting screen shows few controls', state.visibleControls <= 20, String(state.visibleControls));
  eq('no sheet is open at rest', state.sheets, 0);
  check('canvas sized to the viewport', state.canvasW > 600 && state.canvasH > 400, `${state.canvasW}x${state.canvasH}`);
  check('no console errors during boot', consoleErrors.length === 0, consoleErrors.join(' | '));
}

/* ---- the renderer is actually drawing ------------------------------ */
async function pixelStats() {
  return page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.draw();                                  // draw, then read in the same task
    const gl = app.renderer.gl;
    const w = app.canvas.width, h = app.canvas.height;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, sumSq = 0, n = w * h;
    const hist = new Map();
    for (let i = 0; i < n; i++) {
      const l = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
      sum += l; sumSq += l * l;
      const key = (px[i * 4] >> 4) + ',' + (px[i * 4 + 1] >> 4) + ',' + (px[i * 4 + 2] >> 4);
      hist.set(key, (hist.get(key) || 0) + 1);
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    // the centre of the screen should be the model, brighter than the corner
    function at(x, y) {
      const i = ((h - 1 - y) * w + x) * 4;
      return [px[i], px[i + 1], px[i + 2]];
    }
    return {
      mean, variance, distinctColours: hist.size,
      centre: at(w >> 1, h >> 1), corner: at(4, 4),
      drawCalls: app.renderer.stats.drawCalls, triangles: app.renderer.stats.triangles
    };
  });
}
{
  const s = await pixelStats();
  check('the frame is not a flat colour', s.variance > 50, `variance ${s.variance.toFixed(1)}`);
  check('many shades are present (real shading)', s.distinctColours > 40, `${s.distinctColours} buckets`);
  const cLum = (s.centre[0] + s.centre[1] + s.centre[2]) / 3;
  const kLum = (s.corner[0] + s.corner[1] + s.corner[2]) / 3;
  check('the model is lit against the background', cLum > kLum + 25, `centre ${cLum.toFixed(0)} vs corner ${kLum.toFixed(0)}`);
  check('the clay matcap tints the model warm', s.centre[0] > s.centre[2], s.centre.join(','));
  check('triangles were submitted', s.triangles >= 1280, String(s.triangles));
  await page.screenshot({ path: path.join(screens, '01-startup.png') });
}

/* ---- sculpting with real mouse input ------------------------------- */
async function meshState() {
  return page.evaluate(() => {
    const app = window.SCULPT_APP;
    const mesh = app.scene.current().mesh;
    let far = 0, sumR = 0, n = 0;
    for (let v = 0; v < mesh.masks.length; v++) {
      if (mesh.vertDead.array[v]) continue;
      const o = v * 3;
      const r = Math.hypot(mesh.positions.array[o], mesh.positions.array[o + 1], mesh.positions.array[o + 2]);
      far = Math.max(far, r); sumR += r; n++;
    }
    return {
      tris: mesh.liveTris, verts: mesh.liveVerts, far, meanR: sumR / n,
      undo: app.history.undoStack.length, redo: app.history.redoStack.length,
      borderEdges: mesh.countBorderEdges(), nonManifold: mesh.countNonManifoldEdges()
    };
  });
}

const box = await page.locator('#view').boundingBox();
const cx = Math.round(box.x + box.width / 2);
const cy = Math.round(box.y + box.height / 2);

async function stroke(from, to, steps = 18, opts = {}) {
  if (opts.key) await page.keyboard.down(opts.key);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t);
  }
  await page.mouse.up();
  if (opts.key) await page.keyboard.up(opts.key);
  await page.waitForTimeout(60);
}

{
  const before = await meshState();
  await stroke([cx - 90, cy], [cx + 90, cy + 20]);
  const after = await meshState();
  check('the default brush pushed the surface out', after.far > before.far + 0.005,
    `${before.far.toFixed(4)} -> ${after.far.toFixed(4)}`);
  /*
   * The default brush adds material, so the stroke has to bring triangles
   * with it. A stroke that leaves the count alone is a stroke that stretched
   * the triangles that were already there, which is the one thing this tool
   * must not do.
   */
  check('a stroke adds triangles where it builds', after.tris > before.tris,
    `${before.tris} -> ${after.tris}`);
  eq('the mesh is still closed', after.borderEdges, 0);
  eq('the mesh is still manifold', after.nonManifold === undefined ? 0 : after.nonManifold, 0);
  eq('one undo step recorded', after.undo, 1);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  const undone = await meshState();
  eq('undo restored the triangle count', undone.tris, before.tris);
  check('undo restored the shape', Math.abs(undone.far - before.far) < 1e-6,
    `${before.far} vs ${undone.far}`);

  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(80);
  const redone = await meshState();
  eq('redo restored the sculpt', redone.tris, after.tris);
}

/* ---- adding material, and the export budget ------------------------- */
{
  await page.evaluate(() => window.SCULPT_APP.newScene('sphere', null, true));
  await page.waitForTimeout(150);
  const defaults = await page.evaluate(() => ({
    brush: window.SCULPT_APP.settings.brush,
    dyntopo: window.SCULPT_APP.settings.dyntopo,
    budget: window.SCULPT_APP.settings.triBudget,
    cap: window.SCULPT_APP.settings.maxTriangles,
    detail: window.SCULPT_APP.settings.detailPercent,
    tris: window.SCULPT_APP.scene.current().mesh.liveTris
  }));
  eq('the default brush is Add', defaults.brush, 'add');
  eq('brushes add triangles out of the box', defaults.dyntopo, true);
  eq('the export budget suits a Roblox prop', defaults.budget, 2000);
  check('sculpting has headroom above the export budget', defaults.cap >= 150000,
    `${defaults.cap}`);
  check('a new model starts light', defaults.tris <= 2000, `${defaults.tris}`);

  /* material stacks up: the same spot, worked over, gets thicker */
  await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.newScene('sphere', null, true);
    app.selectBrush('add');
    app.set('radius', 80);
    app.set('strength', 1);
  });
  await page.waitForTimeout(150);
  const start = await meshState();
  const heights = [];
  for (let i = 0; i < 3; i++) {
    await stroke([cx - 40, cy], [cx + 40, cy], 10);
    heights.push((await meshState()).far);
  }
  const grown = await meshState();
  check('each pass adds more material', heights[1] > heights[0] && heights[2] > heights[1],
    heights.map((h) => h.toFixed(4)).join(' -> '));
  check('the triangles come with it', grown.tris > start.tris * 1.2,
    `${start.tris} -> ${grown.tris}`);
  eq('still closed after building up', grown.borderEdges, 0);
  eq('still manifold after building up', grown.nonManifold, 0);

  /* pulling out a horn: the thing a stretched mesh cannot do */
  await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.newScene('sphere', null, true);
    app.selectBrush('add');
    app.set('radius', 60);
    app.set('strength', 1);
  });
  await page.waitForTimeout(150);
  const hornStart = await meshState();
  for (let i = 0; i < 6; i++) await stroke([cx, cy], [cx + 120, cy - 40], 14);
  const horn = await meshState();
  check('a repeated pull draws material out into a horn', horn.far > hornStart.far * 1.4,
    `${hornStart.far.toFixed(3)} -> ${horn.far.toFixed(3)}`);
  check('the horn is made of new triangles, not stretched ones',
    horn.tris > hornStart.tris * 1.5, `${hornStart.tris} -> ${horn.tris}`);
  eq('the horn is closed', horn.borderEdges, 0);
  eq('the horn is manifold', horn.nonManifold, 0);
  await page.screenshot({ path: path.join(screens, '23-add-horn.png') });

  /* the same gesture with adding switched off can only stretch */
  await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.newScene('sphere', null, true);
    app.set('dyntopo', false);
  });
  await page.waitForTimeout(150);
  const fixedStart = await meshState();
  for (let i = 0; i < 6; i++) await stroke([cx, cy], [cx + 120, cy - 40], 14);
  const fixed = await meshState();
  eq('with adding off the count cannot change', fixed.tris, fixedStart.tris);
  check('and the same gesture reaches less far', fixed.far < horn.far,
    `fixed ${fixed.far.toFixed(3)} vs adding ${horn.far.toFixed(3)}`);
  await page.evaluate(() => { window.SCULPT_APP.set('dyntopo', true); });

  /* the ceiling is respected, and it is the ceiling that warns */
  await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.newScene('sphere', null, true);
    app.set('maxTriangles', 4000);
    app.set('radius', 70);
  });
  await page.waitForTimeout(150);
  for (let i = 0; i < 4; i++) await stroke([cx - 60 + i * 20, cy - 30], [cx + 60, cy + 30], 12);
  const capped = await page.evaluate(() => {
    const app = window.SCULPT_APP;
    const chip = document.getElementById('title-chip');
    return { tris: app.scene.current().mesh.liveTris, cap: app.settings.maxTriangles,
             text: chip.textContent, over: chip.classList.contains('over'),
             border: app.scene.current().mesh.countBorderEdges() };
  });
  check('adding stops at the limit', capped.tris <= capped.cap + 8, `${capped.tris} of ${capped.cap}`);
  check('the counter turns red at the limit that stops the brushes', capped.over,
    JSON.stringify(capped));
  eq('still closed at the limit', capped.border, 0);
  check('the counter says what it will export as', / → 2k$/.test(capped.text), capped.text);

  /* picking a budget sets the export target, not a cap on sculpting */
  const applied = await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.setBudget(1000);
    const low = { budget: app.settings.triBudget, cap: app.settings.maxTriangles,
                  dyntopo: app.settings.dyntopo, detail: app.settings.detailPercent };
    app.setBudget(250000);
    const high = { budget: app.settings.triBudget, cap: app.settings.maxTriangles,
                   dyntopo: app.settings.dyntopo, detail: app.settings.detailPercent };
    app.setBudget(2000);
    return { low, high, suggested: app.detailForBudget(window.SCULPT.Prim.byId('sphere')) };
  });
  eq('a 1k budget is an export target', applied.low.budget, 1000);
  check('a 1k budget still leaves room to sculpt', applied.low.cap >= 150000, `${applied.low.cap}`);
  eq('picking a budget never switches adding off', applied.low.dyntopo, true);
  check('a small budget uses coarser triangles', applied.low.detail > applied.high.detail,
    `${applied.low.detail}% vs ${applied.high.detail}%`);
  check('a big budget raises the ceiling to match', applied.high.cap >= 250000 * 6,
    `${applied.high.cap}`);
  eq('a 2k budget suggests a 1.3k starting sphere', applied.suggested, 3);

  await page.evaluate(() => { window.SCULPT_APP.newScene('sphere', null, true); });
  await page.waitForTimeout(150);
}

/* ---- brush switching, modifiers, symmetry -------------------------- */
{
  // pick the Move brush from the strip by its title
  await page.locator('#brushes .tool[title^="Move"]').click();
  let brush = await page.evaluate(() => window.SCULPT_APP.settings.brush);
  eq('tapping the strip selected Move', brush, 'move');

  await page.keyboard.press('1');
  brush = await page.evaluate(() => window.SCULPT_APP.settings.brush);
  eq('hotkey 1 selected Clay', brush, 'clay');

  // every brush is reachable from the overflow sheet
  await page.locator('#brushes .tool.more').click();
  await page.waitForTimeout(450);
  const cards = await page.locator('.brush-card').count();
  const brushTotal = await page.evaluate(() => window.SCULPT.BRUSHES.length);
  eq('the brush sheet lists every brush', cards, brushTotal);
  await page.locator('.brush-card[title^="Pulls out horns"]').click();
  await page.waitForTimeout(220);
  brush = await page.evaluate(() => window.SCULPT_APP.settings.brush);
  eq('choosing from the sheet selects that brush', brush, 'snakehook');
  eq('the sheet closes after choosing', await page.locator('.sheet').count(), 0);
  await page.keyboard.press('1');

  // symmetry: stroke on one side, check the other side moved too
  await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.settings.symmetryX = true;
    app.newScene('sphere', 4, true);
  });
  await page.waitForTimeout(150);
  await stroke([cx + 110, cy - 30], [cx + 150, cy + 10], 14);
  const sym = await page.evaluate(() => {
    const mesh = window.SCULPT_APP.scene.current().mesh;
    let plusMoved = 0, minusMoved = 0;
    for (let v = 0; v < mesh.masks.length; v++) {
      if (mesh.vertDead.array[v]) continue;
      const o = v * 3;
      const r = Math.hypot(mesh.positions.array[o], mesh.positions.array[o + 1], mesh.positions.array[o + 2]);
      if (Math.abs(r - 0.5) < 0.002) continue;
      if (mesh.positions.array[o] > 0) plusMoved++; else minusMoved++;
    }
    return { plusMoved, minusMoved };
  });
  check('X symmetry moved both sides', sym.plusMoved > 20 && sym.minusMoved > 20,
    `+x ${sym.plusMoved}, -x ${sym.minusMoved}`);

  // shift = smooth, ctrl = invert: both must run without breaking the mesh
  await stroke([cx - 60, cy], [cx + 60, cy], 12, { key: 'Shift' });
  await stroke([cx - 40, cy + 40], [cx + 40, cy + 40], 12, { key: 'Control' });
  const modState = await meshState();
  eq('mesh still closed after shift and ctrl strokes', modState.borderEdges, 0);
  check('no console errors while sculpting', consoleErrors.length === 0, consoleErrors.join(' | '));
  await page.screenshot({ path: path.join(screens, '02-sculpted.png') });
}

/* ---- the trim brushes through real input ---------------------------- */
{
  await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.newScene('sphere', 4, true);
    app.set('symmetryX', false);
  });
  await page.waitForTimeout(150);

  // both trims have a permanent button
  for (const id of ['trimdynamic', 'trimnormal']) {
    const found = await page.locator(`#brushes .tool[title^="Trim"]`).count();
    check('the trims are on the brush strip', found === 2, String(found));
    break;
  }
  await page.keyboard.press('t');
  eq('T selects Trim Dynamic', await page.evaluate(() => window.SCULPT_APP.settings.brush), 'trimdynamic');
  await page.keyboard.press('e');
  eq('E selects Trim Normal', await page.evaluate(() => window.SCULPT_APP.settings.brush), 'trimnormal');

  const before = await page.evaluate(() => {
    const mesh = window.SCULPT_APP.scene.current().mesh;
    return { tris: mesh.liveTris, positions: Array.from(mesh.positions.view()) };
  });
  await stroke([cx - 70, cy - 20], [cx + 70, cy + 10], 18);
  const after = await page.evaluate((prev) => {
    const app = window.SCULPT_APP;
    const mesh = app.scene.current().mesh;
    const anchor = app.engine._anchorLocal, n = app.engine._anchorNormal;
    let moved = 0, above = -Infinity, grew = 0;
    for (let v = 0; v < mesh.masks.length; v++) {
      if (mesh.vertDead.array[v]) continue;
      const o = v * 3;
      if (o + 2 >= prev.length) continue;
      const d = Math.hypot(mesh.positions.array[o] - prev[o],
                           mesh.positions.array[o + 1] - prev[o + 1],
                           mesh.positions.array[o + 2] - prev[o + 2]);
      if (d <= 1e-5) continue;
      moved++;
      const r0 = Math.hypot(prev[o], prev[o + 1], prev[o + 2]);
      const r1 = Math.hypot(mesh.positions.array[o], mesh.positions.array[o + 1], mesh.positions.array[o + 2]);
      if (r1 > r0 + 1e-6) grew++;
      const h = (mesh.positions.array[o] - anchor[0]) * n[0] +
                (mesh.positions.array[o + 1] - anchor[1]) * n[1] +
                (mesh.positions.array[o + 2] - anchor[2]) * n[2];
      if (h > above) above = h;
    }
    return { moved, above, grew, tris: mesh.liveTris, border: mesh.countBorderEdges() };
  }, before.positions);
  check('a trim stroke cut a patch', after.moved > 30, String(after.moved));
  eq('the trim only removed material', after.grew, 0);
  check('nothing is left above the trim plane', after.above < 0.002, String(after.above));
  eq('the mesh is still closed', after.border, 0);
  eq('fixed topology, so the count held', after.tris, before.tris);
  await page.screenshot({ path: path.join(screens, '04-trim.png') });
  await page.keyboard.press('1');
}

/* ---- paint and mask ------------------------------------------------ */
{
  await page.keyboard.press('c');                      // paint brush
  await stroke([cx - 60, cy - 20], [cx + 60, cy - 20], 16);
  const painted = await page.evaluate(() => {
    const mesh = window.SCULPT_APP.scene.current().mesh;
    let painted = 0;
    for (let v = 0; v < mesh.masks.length; v++) {
      if (mesh.vertDead.array[v]) continue;
      const o = v * 3;
      if (mesh.colors.array[o] > 0.55 && mesh.colors.array[o + 1] < 0.5) painted++;
    }
    return painted;
  });
  check('the paint brush coloured vertices', painted > 20, String(painted));

  await page.keyboard.press('m');                      // mask brush
  await stroke([cx - 40, cy + 60], [cx + 40, cy + 60], 14);
  const masked = await page.evaluate(() => {
    const mesh = window.SCULPT_APP.scene.current().mesh;
    let n = 0;
    for (let v = 0; v < mesh.masks.length; v++) if (!mesh.vertDead.array[v] && mesh.masks.array[v] > 0.2) n++;
    return n;
  });
  check('the mask brush locked vertices', masked > 30, String(masked));

  // a masked area must not move
  await page.keyboard.press('1');
  // Only fully masked vertices are expected to be frozen: the mask is a
  // continuous value, so a vertex at 0.93 still takes 7% of the brush.
  const beforeMasked = await page.evaluate(() => {
    const mesh = window.SCULPT_APP.scene.current().mesh;
    // paint the mask to solid 1 over the area the next stroke will cross
    const verts = mesh.vertsInSphere(0, 0, 0, 10);
    const out = [];
    for (let v = 0; v < mesh.masks.length; v++) {
      if (mesh.vertDead.array[v] || mesh.masks.array[v] < 0.2) continue;
      mesh.masks.array[v] = 1;
      out.push([v, mesh.positions.array[v * 3], mesh.positions.array[v * 3 + 1], mesh.positions.array[v * 3 + 2]]);
    }
    return out.slice(0, 400);
  });
  await stroke([cx - 40, cy + 60], [cx + 40, cy + 60], 14);
  const stillThere = await page.evaluate((list) => {
    const mesh = window.SCULPT_APP.scene.current().mesh;
    let moved = 0;
    for (const [v, x, y, z] of list) {
      const o = v * 3;
      if (Math.hypot(mesh.positions.array[o] - x, mesh.positions.array[o + 1] - y, mesh.positions.array[o + 2] - z) > 1e-6) moved++;
    }
    return { moved, total: list.length };
  }, beforeMasked);
  check('fully masked vertices did not move', stillThere.total > 20 && stillThere.moved === 0,
    `${stillThere.moved}/${stillThere.total} moved`);
  await page.evaluate(() => window.SCULPT_APP.maskOp('clear'));
  await page.screenshot({ path: path.join(screens, '03-painted.png') });
}

/* ---- camera navigation --------------------------------------------- */
{
  const before = await page.evaluate(() => ({ yaw: window.SCULPT_APP.camera.yaw, dist: window.SCULPT_APP.camera.distance }));
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 140, cy + 40);
  await page.mouse.up({ button: 'right' });
  const after = await page.evaluate(() => ({ yaw: window.SCULPT_APP.camera.yaw, dist: window.SCULPT_APP.camera.distance }));
  check('right-drag orbits', Math.abs(after.yaw - before.yaw) > 0.1, `${before.yaw} -> ${after.yaw}`);

  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(60);
  const zoomed = await page.evaluate(() => window.SCULPT_APP.camera.distance);
  check('the wheel zooms in', zoomed < after.dist, `${after.dist} -> ${zoomed}`);

  await page.keyboard.press('f');
  await page.waitForTimeout(400);
  const framed = await page.evaluate(() => window.SCULPT_APP.camera.distance);
  check('F frames the model', framed > 0.5 && framed < 6, String(framed));

  await page.keyboard.press('w');
  const wire = await page.evaluate(() => window.SCULPT_APP.settings.wireframe);
  eq('W toggles the wireframe', wire, true);
  const wireStats = await pixelStats();
  check('the wireframe changes the image', wireStats.variance > 50);
  await page.screenshot({ path: path.join(screens, '04-wireframe.png') });
  await page.keyboard.press('w');
}

/* ---- remesh, subdivide, decimate ----------------------------------- */
{
  const before = await meshState();
  await page.evaluate(() => window.SCULPT_APP.runRemesh({ resolution: 110, smooth: 2, colors: true }));
  await page.waitForFunction((t) => window.SCULPT_APP.scene.current().mesh.liveTris !== t &&
    document.getElementById('busy').hidden, before.tris, { timeout: 60000 });
  const after = await meshState();
  check('voxel remesh rebuilt the mesh', after.tris > 1000, String(after.tris));
  eq('remeshed mesh is closed', after.borderEdges, 0);
  check('remesh is undoable', after.undo > before.undo);
  check('remesh kept the silhouette', Math.abs(after.far - before.far) / before.far < 0.12,
    `${before.far.toFixed(3)} -> ${after.far.toFixed(3)}`);

  const remeshed = after.tris;
  await page.evaluate(() => window.SCULPT_APP.runDecimate(4000, true));
  await page.waitForFunction(() => document.getElementById('busy').hidden &&
    window.SCULPT_APP.scene.current().mesh.liveTris < 6000, null, { timeout: 60000 });
  const decimated = await meshState();
  check('decimate hit the target', decimated.tris <= 4400, String(decimated.tris));
  eq('decimated mesh is closed', decimated.borderEdges, 0);
  check('decimate reduced the count a lot', decimated.tris < remeshed / 2, `${remeshed} -> ${decimated.tris}`);

  // subdividing would blow past the budget, so it must ask first
  await page.evaluate(() => window.SCULPT_APP.subdivide(true));
  await page.waitForTimeout(250);
  const guarded = await page.locator('.dialog > header > span').first().textContent();
  eq('subdivide warns before exceeding the budget', guarded, 'Over your triangle budget');
  const unchanged = await page.evaluate(() => window.SCULPT_APP.scene.current().mesh.liveTris);
  eq('nothing happened while the warning was up', unchanged, decimated.tris);
  // confirm it
  await page.locator('.dialog footer .btn.accent').click();
  await page.waitForFunction((t) => document.getElementById('busy').hidden &&
    window.SCULPT_APP.scene.current().mesh.liveTris > t, decimated.tris, { timeout: 60000 });
  const subdivided = await meshState();
  eq('subdivide quadrupled the triangles', subdivided.tris, decimated.tris * 4);
  // and within the budget it just runs
  await page.evaluate(() => { window.SCULPT_APP.setBudget(250000); });
  await page.evaluate(() => window.SCULPT_APP.subdivide(false));
  await page.waitForFunction((t) => document.getElementById('busy').hidden &&
    window.SCULPT_APP.scene.current().mesh.liveTris > t, subdivided.tris, { timeout: 60000 });
  eq('inside the budget it subdivides without asking',
    await page.evaluate(() => window.SCULPT_APP.scene.current().mesh.liveTris), subdivided.tris * 4);
  eq('no dialog was shown', await page.locator('.dialog').count(), 0);
  await page.screenshot({ path: path.join(screens, '05-remeshed.png') });
}

/* ---- export every format through the real download path ------------ */
const exported = {};
for (const fmt of ['glb', 'obj', 'ply', 'stl']) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.evaluate((f) => window.SCULPT_APP.quickExport(f), fmt)
  ]);
  const dest = path.join(tmp, 'export.' + fmt);
  await download.saveAs(dest);
  const stat = fs.statSync(dest);
  exported[fmt] = dest;
  check(`export ${fmt.toUpperCase()} downloaded a file`, stat.size > 500, `${stat.size} bytes`);
  check(`export ${fmt.toUpperCase()} filename looks right`, /\.\w+$/.test(download.suggestedFilename()) &&
    download.suggestedFilename().endsWith('.' + fmt), download.suggestedFilename());
}
{
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.evaluate(() => window.SCULPT_APP.saveProject())
  ]);
  const dest = path.join(tmp, 'project.sculpt');
  await download.saveAs(dest);
  exported.sculpt = dest;
  check('project file downloaded', fs.statSync(dest).size > 1000);
}

/* verify the exported files in node, with the same parsers the app uses */
{
  const S = (await import('./harness.mjs')).load();
  const expected = await page.evaluate(() => {
    const mesh = window.SCULPT_APP.scene.current().mesh;
    return { tris: mesh.liveTris, verts: mesh.liveVerts };
  });
  for (const fmt of ['glb', 'obj', 'ply', 'stl']) {
    const buf = fs.readFileSync(exported[fmt]);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const res = S.IO.importBuffer('x.' + fmt, ab);
    check(`exported ${fmt} re-imports cleanly`, res.objects.length === 1 && !res.warnings.length,
      res.warnings.join(';'));
    const m = new S.Mesh();
    m.setFromArrays(res.objects[0].positions, res.objects[0].indices, { colors: res.objects[0].colors, weld: true });
    eq(`exported ${fmt} has every triangle`, m.liveTris, expected.tris);
    if (fmt !== 'stl') eq(`exported ${fmt} has every vertex`, m.liveVerts, expected.verts);
    check(`exported ${fmt} is a closed surface`, m.countBorderEdges() === 0);
  }
  const proj = S.IO.loadProject((() => {
    const b = fs.readFileSync(exported.sculpt);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  })());
  check('project file loads outside the browser', proj.ok, proj.reason || '');
  eq('project carries the object', proj.objects.length, 1);
  check('project carries the camera', !!proj.camera);
}

/* ---- import a model through the file picker ------------------------- */
{
  const before = await page.evaluate(() => window.SCULPT_APP.scene.objects.length);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    page.evaluate(() => {
      // the import dialog's own button opens the picker
      window.SCULPT_APP.importDialog();
      const buttons = Array.from(document.querySelectorAll('.dialog footer .btn'));
      buttons[buttons.length - 1].click();
    })
  ]);
  await chooser.setFiles([exported.obj, exported.ply]);
  await page.waitForFunction((n) => window.SCULPT_APP.scene.objects.length > n &&
    document.getElementById('busy').hidden, before, { timeout: 30000 });
  const state = await page.evaluate(() => ({
    objects: window.SCULPT_APP.scene.objects.length,
    names: window.SCULPT_APP.scene.objects.map((o) => o.name),
    tris: window.SCULPT_APP.scene.totals().tris
  }));
  eq('both files imported as objects', state.objects, before + 2);
  check('imported objects are named after the files', state.names.some((n) => /export/.test(n)), state.names.join(','));
  check('imported geometry is present', state.tris > 1000, String(state.tris));
  await page.screenshot({ path: path.join(screens, '06-imported.png') });
}

/* ---- dialogs open and close ---------------------------------------- */
{
  // the sheets first
  const sheets = [
    ['openMainMenu', 'Menu'],
    ['openBrushSheet', 'Brushes'],
    ['openExportSheet', 'Export'],
    ['openLookSheet', 'Look'],
    ['openBrushSettingsSheet', null],
    ['openObjectsSheet', 'Objects'],
    ['openMaskSheet', 'Mask']
  ];
  for (const [fn, title] of sheets) {
    await page.evaluate((f) => window.SCULPT_APP[f](), fn);
    await page.waitForTimeout(420);
    eq(`${fn} opens a sheet`, await page.locator('.sheet').count(), 1);
    if (title) {
      const heading = await page.locator('.sheet-head h3').first().textContent();
      eq(`${fn} is titled correctly`, heading, title);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(260);
    eq(`${fn} closes on Escape`, await page.locator('.sheet').count(), 0);
  }

  // toggles inside a sheet act immediately and leave it open
  await page.evaluate(() => window.SCULPT_APP.openLookSheet());
  await page.waitForTimeout(420);
  const wireRow = page.locator('.sheet-row', { hasText: 'Wireframe' }).first();
  await wireRow.click();
  await page.waitForTimeout(120);
  eq('a sheet toggle applies at once', await page.evaluate(() => window.SCULPT_APP.settings.wireframe), true);
  eq('a sheet toggle keeps the sheet open', await page.locator('.sheet').count(), 1);
  await wireRow.click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(240);

  const dialogs = [
    ['dialogExport', 'Export model'],
    ['dialogRemesh', 'Voxel remesh'],
    ['dialogDecimate', 'Decimate'],
    ['dialogPrimitive', 'Add a primitive'],
    ['dialogShortcuts', 'Keyboard and mouse'],
    ['dialogPipeline', 'Getting a sculpt into a game'],
    ['dialogPreferences', 'Preferences'],
    ['dialogAbout', 'About SculptFree']
  ];
  for (const [fn, title] of dialogs) {
    await page.evaluate((f) => window.SCULPT_APP[f](), fn);
    const heading = await page.locator('.dialog > header > span').first().textContent();
    check(`${fn} opens with the right title`, heading === title, `got "${heading}"`);
    if (fn === 'dialogExport') await page.screenshot({ path: path.join(screens, '07-export-dialog.png') });
    if (fn === 'dialogShortcuts') await page.screenshot({ path: path.join(screens, '08-shortcuts.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(40);
    const gone = await page.locator('.backdrop').count();
    eq(`${fn} closes on Escape`, gone, 0);
  }
}

/* ---- object list --------------------------------------------------- */
{
  await page.evaluate(() => window.SCULPT_APP.openObjectsSheet());
  await page.waitForTimeout(450);
  const rows = await page.locator('.obj-row').count();
  check('the object list shows every object', rows >= 3, String(rows));
  await page.locator('.obj-row').first().click();
  const sel = await page.evaluate(() => window.SCULPT_APP.scene.selected);
  eq('clicking a row selects that object', sel, 0);
  // hide the second object
  await page.locator('.obj-row').nth(1).locator('button').first().click();
  const vis = await page.evaluate(() => window.SCULPT_APP.scene.objects[1].visible);
  eq('the eye button hides an object', vis, false);
  await page.locator('.obj-row').nth(1).locator('button').first().click();

  await page.evaluate(() => { window.SCULPT_APP.closeSheet(); window.SCULPT_APP.mergeAll(); });
  await page.waitForFunction(() => document.getElementById('busy').hidden &&
    window.SCULPT_APP.scene.objects.length === 1, null, { timeout: 30000 });
  eq('merge all left a single object', await page.evaluate(() => window.SCULPT_APP.scene.objects.length), 1);
}

/* ---- a long mixed session stays healthy ---------------------------- */
{
  await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.newScene('sphere', 4, true);
    app.settings.dyntopo = true;
    app.settings.detailPercent = 20;
    app.settings.maxTriangles = 400000;
  });
  await page.waitForTimeout(150);
  const brushes = ['1', '2', '3', '4', '6', '7', '8', 'p', 'h', 'n'];
  const t0 = Date.now();
  for (let i = 0; i < brushes.length; i++) {
    await page.keyboard.press(brushes[i]);
    const ox = cx - 80 + (i * 23) % 160;
    const oy = cy - 60 + (i * 31) % 120;
    await stroke([ox, oy], [ox + 50, oy + 30], 10);
  }
  const elapsed = Date.now() - t0;
  const state = await page.evaluate(() => {
    const app = window.SCULPT_APP;
    const mesh = app.scene.current().mesh;
    // full structural audit inside the browser
    const T = mesh.tris.array;
    const problems = [];
    let liveT = 0;
    const edges = new Map();
    for (let t = 0; t < mesh.triDead.length; t++) {
      if (mesh.triDead.array[t]) continue;
      liveT++;
      const t3 = t * 3;
      for (let k = 0; k < 3; k++) {
        const a = T[t3 + k], b = T[t3 + (k + 1) % 3];
        if (a === b) problems.push('degenerate');
        if (mesh.vertDead.array[a]) problems.push('dead vertex referenced');
        const key = a < b ? a + ':' + b : b + ':' + a;
        edges.set(key, (edges.get(key) || 0) + 1);
      }
    }
    for (const [, n] of edges) if (n > 2) { problems.push('non-manifold edge'); break; }
    let nonFinite = 0;
    for (let v = 0; v < mesh.masks.length; v++) {
      if (mesh.vertDead.array[v]) continue;
      const o = v * 3;
      if (!isFinite(mesh.positions.array[o]) || !isFinite(mesh.positions.array[o + 1]) || !isFinite(mesh.positions.array[o + 2])) nonFinite++;
    }
    return { tris: mesh.liveTris, liveT, problems: problems.slice(0, 5), nonFinite,
             border: mesh.countBorderEdges(), undo: app.history.undoStack.length,
             historyBytes: app.history.bytes, fps: app.fps };
  });
  eq('no structural problems after 10 strokes', state.problems.length, 0);
  eq('no non-finite positions', state.nonFinite, 0);
  eq('mesh still watertight', state.border, 0);
  eq('every stroke recorded a history step', state.undo, brushes.length);
  check('the mesh grew with dyntopo', state.tris > 5120, String(state.tris));
  console.log(`  (10 driven strokes in ${elapsed} ms incl. browser input round-trips, ${state.tris} tris, history ${(state.historyBytes / 1048576).toFixed(1)} MB, ${state.fps} fps)`);

  // undo the whole session
  for (let i = 0; i < brushes.length; i++) await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  const rewound = await page.evaluate(() => ({
    tris: window.SCULPT_APP.scene.current().mesh.liveTris,
    undo: window.SCULPT_APP.history.undoStack.length
  }));
  eq('undoing everything returns the original sphere', rewound.tris, 5120);
  eq('the undo stack is empty', rewound.undo, 0);
  await page.screenshot({ path: path.join(screens, '09-after-undo.png') });
}

/* ---- performance at scale ------------------------------------------ */
{
  const perf = await page.evaluate(async () => {
    const app = window.SCULPT_APP;
    /*
     * A measurement has to control its inputs: earlier blocks leave the brush
     * wherever they left it, and mirroring alone multiplies the work per
     * stamp by up to eight.
     */
    app.set('radius', 62);
    app.set('strength', 0.6);
    app.set('spacing', 0.16);
    app.set('symmetryX', false);
    app.set('symmetryY', false);
    app.set('symmetryZ', false);
    app.set('alpha', 'none');
    app.set('stampMode', false);
    app.set('maxTriangles', 150000);
    app.selectBrush('add');
    app.newScene('sphere', 6, true);            // 81920 triangles
    app.settings.dyntopo = false;
    const mesh = app.scene.current().mesh;
    const startTris = mesh.liveTris;
    const gl = app.renderer.gl;
    const w = app.canvas.clientWidth, h = app.canvas.clientHeight;

    // render time, with a finish() so the software rasteriser is included
    app.draw(); gl.finish();
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) { app.camera.orbit(2, 0); app.draw(); }
    gl.finish();
    const renderMs = (performance.now() - t0) / 20;

    // picking
    const t1 = performance.now();
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      if (app.engine.pick(w / 2 + Math.sin(i) * 60, h / 2 + Math.cos(i) * 60, true)) hits++;
    }
    const pickMs = (performance.now() - t1) / 200;

    // stroke engine throughput, measured in-page so browser input latency
    // does not hide the real cost: 120 stamps with dyntopo on
    app.settings.dyntopo = true;
    app.settings.detailPercent = 25;
    const t2 = performance.now();
    app.engine.begin({ x: w / 2 - 120, y: h / 2, pressure: 1 });
    for (let i = 1; i <= 120; i++) {
      app.engine.move({ x: w / 2 - 120 + i * 2, y: h / 2 + Math.sin(i / 10) * 30, pressure: 1 });
    }
    app.engine.end();
    const strokeMs = performance.now() - t2;
    const stamps = app.engine.stamps;
    return { tris: startTris, renderMs, pickMs, hits, strokeMs, stamps,
             afterTris: mesh.liveTris };
  });
  check('sphere at subdivision 6', perf.tris >= 81920, String(perf.tris));
  check('a frame at 80k+ triangles renders in reasonable time (software GL)', perf.renderMs < 400,
    `${perf.renderMs.toFixed(1)} ms/frame`);
  check('picking is fast enough for a stroke', perf.pickMs < 4, `${perf.pickMs.toFixed(2)} ms/pick`);
  check('picking actually hits the model', perf.hits > 150, String(perf.hits));
  check('a 120-step dyntopo stroke keeps up with the pointer', perf.strokeMs / Math.max(1, perf.stamps) < 25,
    `${(perf.strokeMs / Math.max(1, perf.stamps)).toFixed(1)} ms per stamp`);
  console.log(`  (80k+ tris under SwiftShader: ${perf.renderMs.toFixed(1)} ms/frame, ` +
    `${perf.pickMs.toFixed(2)} ms/pick, ${perf.stamps} stamps in ${perf.strokeMs.toFixed(0)} ms ` +
    `-> ${perf.afterTris} tris)`);
}

/* ---- mobile layout -------------------------------------------------- */
{
  const phoneContext = await browser.newContext({
    viewport: { width: 414, height: 820 }, hasTouch: true, isMobile: true,
    deviceScaleFactor: 2, acceptDownloads: true
  });
  const phone = await phoneContext.newPage();
  const phoneErrors = [];
  phone.on('pageerror', (e) => phoneErrors.push(e.message));
  await phone.goto(appFile);
  await phone.waitForFunction(() => window.SCULPT_APP && window.SCULPT_APP.renderer, null, { timeout: 15000 });
  await phone.waitForTimeout(400);
  const layout = await phone.evaluate(() => {
    const view = document.getElementById('view');
    const iw = window.innerWidth, ih = window.innerHeight;
    let outside = 0;
    document.querySelectorAll('#ui button, #ui .pill').forEach((n) => {
      // the brush strip scrolls sideways on a phone, so its buttons are
      // allowed past the edge; everything else must be reachable
      if (n.closest('#brushes')) return;
      const r = n.getBoundingClientRect();
      if (r.width && (r.left < -0.5 || r.right > iw + 0.5 || r.top < -0.5 || r.bottom > ih + 0.5)) outside++;
    });
    return {
      canvasW: view.clientWidth,
      canvasH: view.clientHeight,
      outside: outside,
      sheets: document.querySelectorAll('.sheet').length,
      brushButtons: document.querySelectorAll('#brushes .tool').length,
      pills: document.querySelectorAll('.pill').length,
      bodyScrollW: document.documentElement.scrollWidth,
      innerW: iw
    };
  });
  check('the viewport fills the phone screen', layout.canvasW > 380, String(layout.canvasW));
  eq('every control is fully on screen', layout.outside, 0);
  // held vertically, the brushes belong along the bottom, not down the side
  const portrait = await phone.evaluate(() => {
    const strip = document.getElementById('brushes').getBoundingClientRect();
    const bars = document.getElementById('bar-bottom').getBoundingClientRect();
    const view = document.getElementById('view').getBoundingClientRect();
    return {
      stripWide: strip.width > view.width * 0.9,
      stripAtBottom: strip.bottom > view.height - 4,
      slidersAboveStrip: bars.bottom < strip.top + 2,
      scrollable: document.getElementById('brushes').scrollWidth >= document.getElementById('brushes').clientWidth
    };
  });
  check('the brush strip spans the bottom', portrait.stripWide && portrait.stripAtBottom,
    JSON.stringify(portrait));
  check('the sliders sit above the brush strip', portrait.slidersAboveStrip);
  check('the brush strip scrolls if it overflows', portrait.scrollable);
  eq('nothing is open at rest', layout.sheets, 0);
  eq('the brush strip is there on a phone', layout.brushButtons, 11);
  eq('both sliders are there on a phone', layout.pills, 2);
  eq('no horizontal page scroll', layout.bodyScrollW, layout.innerW);
  // the menu opens as a sheet
  await phone.locator('#bar-top button').first().click();
  await phone.waitForTimeout(460);
  eq('the menu opens on a phone', await phone.locator('.sheet').count(), 1);
  await phone.screenshot({ path: path.join(screens, '10-mobile.png') });
  await phone.keyboard.press('Escape');
  await phone.waitForTimeout(260);
  await phone.screenshot({ path: path.join(screens, '11-mobile-brushes.png') });

  // a touch drag must sculpt — dispatched as real touch input, so the app
  // sees pointerType 'touch' exactly as it would on a tablet
  const pbox = await phone.locator('#view').boundingBox();
  const px = Math.round(pbox.x + pbox.width / 2), py = Math.round(pbox.y + pbox.height / 3);
  const cdp = await phoneContext.newCDPSession(phone);
  const beforeTouch = await phone.evaluate(() => window.SCULPT_APP.history.undoStack.length);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: px, y: py, id: 1, force: 0.6 }] });
  for (let i = 1; i <= 14; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: px + i * 5, y: py + i * 2, id: 1, force: 0.6 }]
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await phone.waitForTimeout(250);
  const afterTouch = await phone.evaluate(() => window.SCULPT_APP.history.undoStack.length);
  check('a one-finger drag sculpts', afterTouch > beforeTouch, `${beforeTouch} -> ${afterTouch}`);

  // two fingers must orbit instead of sculpting
  const camBefore = await phone.evaluate(() => window.SCULPT_APP.camera.yaw);
  const undoBefore = await phone.evaluate(() => window.SCULPT_APP.history.undoStack.length);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
    { x: px - 40, y: py, id: 1 }, { x: px + 40, y: py, id: 2 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
      { x: px - 40 + i * 6, y: py, id: 1 }, { x: px + 40 + i * 6, y: py, id: 2 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await phone.waitForTimeout(200);
  const camAfter = await phone.evaluate(() => window.SCULPT_APP.camera.yaw);
  const undoAfter = await phone.evaluate(() => window.SCULPT_APP.history.undoStack.length);
  check('two fingers orbit the camera', Math.abs(camAfter - camBefore) > 0.05, `${camBefore} -> ${camAfter}`);
  eq('two fingers did not add a sculpt step', undoAfter, undoBefore);
  await phone.screenshot({ path: path.join(screens, '12-mobile-sculpted.png') });

    check('no errors on the phone layout', phoneErrors.length === 0, phoneErrors.join(' | '));
  await phone.close();
  await phoneContext.close();
}

/* ---- export sized for Roblox --------------------------------------- */
{
  // Roblox rejects a MeshPart over 10,000 triangles, so the dedicated export
  // has to come back under that whatever the sculpt is doing.
  const dense = await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.setBudget(2000);                 // back to the Roblox-sized default
    app.newScene('sphere', 4, true);
    app.set('maxTriangles', 400000);
    app.scene.current().mesh.subdivide(false);      // 20480
    app.scene.current().mesh.subdivide(false);      // 81920
    app.refreshStatus();
    return app.scene.current().mesh.liveTris;
  });
  check('built a mesh well over the Roblox limit', dense > 60000, String(dense));
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.evaluate(() => window.SCULPT_APP.exportForRoblox())
  ]);
  const dest = path.join(tmp, 'roblox.obj');
  await download.saveAs(dest);
  check('the Roblox export is an OBJ', download.suggestedFilename().endsWith('.obj'),
    download.suggestedFilename());
  const S2 = (await import('./harness.mjs')).load();
  const buf = fs.readFileSync(dest);
  const res = S2.IO.importBuffer('roblox.obj', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  check('the Roblox export re-imports cleanly', res.objects.length === 1 && !res.warnings.length,
    res.warnings.join(';'));
  const m = new S2.Mesh();
  m.setFromArrays(res.objects[0].positions, res.objects[0].indices, { weld: true });
  // the working budget is 2k here, and the export honours the smaller number
  check('the Roblox export fits the budget', m.liveTris <= 2000, `${dense} -> ${m.liveTris}`);
  check('the Roblox export is not needlessly small', m.liveTris > 1600, String(m.liveTris));
  eq('the Roblox export is a closed surface', m.countBorderEdges(), 0);
  eq('the Roblox export is manifold', m.countNonManifoldEdges(), 0);
  const stillDense = await page.evaluate(() => window.SCULPT_APP.scene.current().mesh.liveTris);
  eq('the sculpt itself keeps its detail', stillDense, dense);

  // over the export budget the chip says what it will export as, and does not
  // cry about it: sculpting past the budget is the normal way to work
  const chip = await page.evaluate(() => {
    const c = document.getElementById('title-chip');
    return { text: c.textContent, over: c.classList.contains('over'), title: c.title };
  });
  check('the counter shows the sculpt and the export target', /\u2192 2k$/.test(chip.text),
    JSON.stringify(chip));
  check('sculpting past the export budget is not flagged as a problem', !chip.over,
    JSON.stringify(chip));
  check('the counter explains itself', /exports reduced to 2000/.test(chip.title), chip.title);

  // and from a high working budget it still comes back Roblox-legal
  await page.evaluate(() => window.SCULPT_APP.setBudget(250000));
  const [download2] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.evaluate(() => window.SCULPT_APP.exportForRoblox())
  ]);
  const dest2 = path.join(tmp, 'roblox-high.obj');
  await download2.saveAs(dest2);
  const buf2 = fs.readFileSync(dest2);
  const res2 = S2.IO.importBuffer('x.obj', buf2.buffer.slice(buf2.byteOffset, buf2.byteOffset + buf2.byteLength));
  const m2 = new S2.Mesh();
  m2.setFromArrays(res2.objects[0].positions, res2.objects[0].indices, { weld: true });
  check('a 250k working budget still exports under Roblox\'s 10k limit', m2.liveTris <= 10000,
    String(m2.liveTris));
  await page.evaluate(() => window.SCULPT_APP.setBudget(2000));
}

/* ---- stencils through the real interface ---------------------------- */
{
  await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.closeSheet();
    app.newScene('sphere', 4, true);       // 5,120 triangles to stamp into
    app.set('alpha', 'none');
    app.set('stampMode', false);
    app.set('dyntopo', false);
    app.set('maxTriangles', 400000);
    app.selectBrush('draw');
    app.set('radius', 120);
    app.set('strength', 0.8);
  });

  await page.evaluate(() => window.SCULPT_APP.openBrushSettingsSheet());
  await page.waitForTimeout(220);
  const picker = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.alpha-grid .alpha-cell'));
    const thumb = cells[1] && cells[1].querySelector('canvas');
    let spread = 0;
    if (thumb) {
      const data = thumb.getContext('2d').getImageData(0, 0, thumb.width, thumb.height).data;
      let lo = 255, hi = 0;
      for (let i = 0; i < data.length; i += 4) { lo = Math.min(lo, data[i]); hi = Math.max(hi, data[i]); }
      spread = hi - lo;
    }
    return {
      cells: cells.length,
      labels: cells.map((c) => c.querySelector('small').textContent),
      firstIsOn: cells[0].classList.contains('on'),
      thumbSpread: spread,
      buttons: Array.from(document.querySelectorAll('.sheet .btn span')).map((b) => b.textContent)
    };
  });
  eq('the stencil picker lists none plus the built-ins', picker.cells, 9);
  eq('the first cell is None and is selected', picker.labels[0] + ':' + picker.firstIsOn, 'None:true');
  check('the stencil thumbnails are actually drawn', picker.thumbSpread > 100, `${picker.thumbSpread}`);
  check('the sheet offers loading an image', picker.buttons.join(',').indexOf('Load image') >= 0,
    picker.buttons.join(','));

  await page.locator('.alpha-grid .alpha-cell', { hasText: 'Gravel' }).click();
  await page.waitForTimeout(120);
  const picked = await page.evaluate(() => ({
    alpha: window.SCULPT_APP.settings.alpha,
    on: Array.from(document.querySelectorAll('.alpha-grid .alpha-cell.on'))
      .map((c) => c.querySelector('small').textContent).join(',')
  }));
  eq('picking a stencil sets it', picked.alpha, 'gravel');
  eq('the picked stencil is the only one marked', picked.on, 'Gravel');
  await page.screenshot({ path: path.join(screens, '16-stencils.png') });
  await page.evaluate(() => window.SCULPT_APP.closeSheet());
  await page.waitForTimeout(220);

  /* the same dab, with and without a stencil */
  await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.newScene('sphere', 5, true);       // 20,480 triangles, so a stamp has detail to bite into
    app.set('maxTriangles', 400000);
    app.selectBrush('draw');
    app.set('radius', 70);
    app.set('strength', 0.7);
    app.set('stampMode', true);
  });

  /**
   * Press once and describe the shape of the dent: what share of the moved
   * vertices sit near the deepest point, and what share barely moved. A
   * plain brush leaves a dome — a few deep vertices and a long shallow
   * skirt. A stencil with hard edges leaves a plateau: most of the footprint
   * at full depth and very little skirt.
   */
  async function dabProfile(drag) {
    await page.evaluate(() => {
      const m = window.SCULPT_APP.scene.current().mesh;
      window.__before = Float32Array.from(m.positions.array.subarray(0, m.liveVerts * 3));
    });
    if (drag) {
      await stroke([cx - 60, cy], [cx + 60, cy], 14);
    } else {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.up();
    }
    await page.waitForTimeout(80);
    return page.evaluate(() => {
      const m = window.SCULPT_APP.scene.current().mesh;
      const before = window.__before, pos = m.positions.array;
      const moves = [];
      let max = 0;
      for (let v = 0; v < m.liveVerts; v++) {
        const o = v * 3;
        const d = Math.hypot(pos[o] - before[o], pos[o + 1] - before[o + 1], pos[o + 2] - before[o + 2]);
        if (d > 1e-7) moves.push(d);
        if (d > max) max = d;
      }
      let deep = 0, solid = 0, skirt = 0;
      for (const d of moves) {
        if (d > 0.7 * max) deep++;
        if (d > 0.3 * max) solid++;
        if (d < 0.2 * max) skirt++;
      }
      return { moved: moves.length, max: max,
               plateau: moves.length ? deep / moves.length : 0,
               solid: moves.length ? solid / moves.length : 0,
               skirt: moves.length ? skirt / moves.length : 0 };
    });
  }

  await page.evaluate(() => window.SCULPT_APP.set('alpha', 'none'));
  const plain = await dabProfile();
  await page.evaluate(() => window.SCULPT_APP.undo());
  await page.waitForTimeout(120);
  await page.evaluate(() => window.SCULPT_APP.set('alpha', 'square'));
  const stencilled = await dabProfile();

  check('a plain dab moves vertices', plain.moved > 100, `${plain.moved}`);
  check('a stencilled dab moves vertices', stencilled.moved > 100, `${stencilled.moved}`);
  check('a plain brush leaves a dome, not a plateau', plain.plateau < 0.3,
    `${(plain.plateau * 100).toFixed(0)}% at full depth`);
  check('a hard-edged stencil stamps a plateau', stencilled.plateau > 0.5,
    `${(stencilled.plateau * 100).toFixed(0)}% at full depth`);
  check('a stencil cuts the soft skirt away', stencilled.skirt < plain.skirt * 0.6,
    `plain ${(plain.skirt * 100).toFixed(0)}% vs stencil ${(stencilled.skirt * 100).toFixed(0)}%`);
  await page.screenshot({ path: path.join(screens, '17-stencil-stroke.png') });

  /* a patterned stencil over a drag, the way dirt and gravel are used */
  await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.undo();
    app.set('stampMode', false);
    app.set('alpha', 'none');
    app.set('radius', 90);
  });
  const plainDrag = await dabProfile(true);
  await page.evaluate(() => window.SCULPT_APP.undo());
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    window.SCULPT_APP.set('alpha', 'gravel');
    window.SCULPT_APP.set('alphaRandomRotate', true);
  });
  const gravelDrag = await dabProfile(true);

  check('a patterned stencil still cuts a stroke', gravelDrag.moved > 200, `${gravelDrag.moved}`);
  /*
   * A plain stroke is mostly skirt: the radial falloff means most of the
   * footprint is barely touched. A stencil replaces that falloff with the
   * pattern, so the same footprint comes out as lumps at depth rather than a
   * wide shallow smear — which is exactly what makes it read as gravel.
   */
  check('a patterned stencil replaces the soft falloff with lumps',
    gravelDrag.skirt < plainDrag.skirt * 0.8,
    `plain ${(plainDrag.skirt * 100).toFixed(0)}% skirt vs stencil ${(gravelDrag.skirt * 100).toFixed(0)}%`);
  check('the pattern puts more of the footprint at real depth',
    gravelDrag.solid > plainDrag.solid * 1.35,
    `plain ${(plainDrag.solid * 100).toFixed(1)}% vs stencil ${(gravelDrag.solid * 100).toFixed(1)}%`);

  /* stamp mode: one dab per press, however far the pointer travels */
  await page.evaluate(() => { window.SCULPT_APP.undo(); });
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    window.SCULPT_APP.set('alpha', 'rivet');
    window.SCULPT_APP.set('alphaRandomRotate', false);
    window.SCULPT_APP.set('stampMode', true);
    window.SCULPT_APP.set('radius', 60);
  });
  await page.evaluate(() => {
    const m = window.SCULPT_APP.scene.current().mesh;
    window.__before = Float32Array.from(m.positions.array.subarray(0, m.liveVerts * 3));
  });
  await stroke([cx - 100, cy - 30], [cx + 100, cy + 30], 20);
  const stamped = await page.evaluate(() => {
    const m = window.SCULPT_APP.scene.current().mesh;
    const before = window.__before, pos = m.positions.array;
    let moved = 0, minX = Infinity, maxX = -Infinity;
    for (let v = 0; v < m.liveVerts; v++) {
      const o = v * 3;
      const d = Math.hypot(pos[o] - before[o], pos[o + 1] - before[o + 1], pos[o + 2] - before[o + 2]);
      if (d > 1e-6) { moved++; minX = Math.min(minX, pos[o]); maxX = Math.max(maxX, pos[o]); }
    }
    return { moved: moved, width: maxX - minX, undo: window.SCULPT_APP.history.undoStack.length };
  });
  check('a stamp still changes the surface', stamped.moved > 20, `${stamped.moved}`);
  // the drag covered 200px; a single dab of a 60px brush cannot be that wide
  check('stamp mode lays one dab, not a trail', stamped.width < 0.35, `${stamped.width.toFixed(3)} wide`);

  await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.undo();
    app.set('stampMode', false);
    app.set('alpha', 'none');
  });
}

/* ---- uploading an image as a stencil -------------------------------- */
{
  const loaded = await page.evaluate(async () => {
    const app = window.SCULPT_APP;
    // paint a checkerboard, hand it over as a real PNG File
    const cvs = document.createElement('canvas');
    cvs.width = cvs.height = 64;
    const ctx = cvs.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#fff';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) if ((x + y) % 2 === 0) ctx.fillRect(x * 8, y * 8, 8, 8);
    }
    const blob = await new Promise((res) => cvs.toBlob(res, 'image/png'));
    const file = new File([blob], 'checker-test.png', { type: 'image/png' });
    app.loadAlphaFromFile(file, null);
    // the load runs on the image's onload, so wait for it
    for (let i = 0; i < 60; i++) {
      if (Object.keys(window.SCULPT.Alpha.loaded).length) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const ids = Object.keys(window.SCULPT.Alpha.loaded);
    const alpha = window.SCULPT.Alpha.loaded[ids[0]];
    let lo = 1, hi = 0;
    for (let i = 0; i < alpha.data.length; i++) { lo = Math.min(lo, alpha.data[i]); hi = Math.max(hi, alpha.data[i]); }
    let stored = 0;
    try { stored = JSON.parse(window.localStorage.getItem('sculptfree.alphas.v1') || '[]').length; } catch (e) { stored = -1; }
    return { count: ids.length, id: ids[0], label: alpha.label, size: alpha.size,
             lo: lo, hi: hi, selected: app.settings.alpha === ids[0], stored: stored };
  });
  eq('an uploaded image becomes one stencil', loaded.count, 1);
  eq('the stencil is named after the file', loaded.label, 'checker-test');
  check('the uploaded stencil has real contrast', loaded.lo < 0.05 && loaded.hi > 0.95,
    `${loaded.lo} .. ${loaded.hi}`);
  check('the uploaded stencil is selected straight away', loaded.selected);
  check('the uploaded stencil was saved for next time', loaded.stored === 1 || loaded.stored === -1,
    `${loaded.stored}`);

  // it shows up in the picker with a way to remove it
  await page.evaluate(() => window.SCULPT_APP.openBrushSettingsSheet());
  await page.waitForTimeout(200);
  const inPicker = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.alpha-grid .alpha-cell'));
    const mine = cells.find((c) => c.querySelector('small').textContent === 'checker-test');
    return { cells: cells.length, found: !!mine, removable: !!(mine && mine.querySelector('.alpha-x')),
             builtinRemovable: !!cells[1].querySelector('.alpha-x') };
  });
  eq('the picker grew by one', inPicker.cells, 10);
  check('the uploaded stencil is in the picker', inPicker.found);
  check('an uploaded stencil can be removed', inPicker.removable);
  check('a built-in stencil cannot be removed', inPicker.builtinRemovable === false);
  await page.screenshot({ path: path.join(screens, '18-stencil-upload.png') });

  await page.locator('.alpha-grid .alpha-cell', { hasText: 'checker-test' }).locator('.alpha-x').click();
  await page.waitForTimeout(120);
  const afterRemove = await page.evaluate(() => ({
    loaded: Object.keys(window.SCULPT.Alpha.loaded).length,
    alpha: window.SCULPT_APP.settings.alpha,
    cells: document.querySelectorAll('.alpha-grid .alpha-cell').length
  }));
  eq('removing a stencil takes it out of the picker', afterRemove.cells, 9);
  eq('removing the stencil in use falls back to none', afterRemove.alpha, 'none');
  eq('nothing is left loaded', afterRemove.loaded, 0);
  await page.evaluate(() => window.SCULPT_APP.closeSheet());
  await page.waitForTimeout(200);
}

/* ---- presets -------------------------------------------------------- */
{
  await page.evaluate(() => window.SCULPT_APP.openPresetSheet());
  await page.waitForTimeout(220);
  const sheet = await page.evaluate(() => ({
    rows: document.querySelectorAll('.preset-row').length,
    labels: Array.from(document.querySelectorAll('.preset-row b')).map((b) => b.textContent),
    hints: Array.from(document.querySelectorAll('.preset-row small')).map((b) => b.textContent).filter(Boolean).length,
    title: document.querySelector('.sheet header b, .sheet .sheet-title, .sheet header span') &&
           document.querySelector('.sheet').textContent.indexOf('Presets') >= 0
  }));
  check('the preset sheet lists the built-ins', sheet.rows >= 12, `${sheet.rows}`);
  check('every preset row explains itself', sheet.hints === sheet.rows, `${sheet.hints}/${sheet.rows}`);
  check('the presets include a hard-surface setup', sheet.labels.indexOf('Hard surface') >= 0,
    sheet.labels.join(','));
  await page.screenshot({ path: path.join(screens, '19-presets.png') });

  await page.locator('.preset-row', { hasText: 'Rivets' }).click();
  await page.waitForTimeout(200);
  const applied = await page.evaluate(() => {
    const app = window.SCULPT_APP;
    const range = document.querySelector('#bar-bottom .pill input[type=range]');
    return {
      brush: app.settings.brush, alpha: app.settings.alpha, stamp: app.settings.stampMode,
      radius: app.settings.radius, pill: Number(range.value),
      toolOn: document.querySelector('#brushes .tool.on') !== null,
      sheets: document.querySelectorAll('.sheet').length
    };
  });
  eq('a preset switches the brush', applied.brush, 'draw');
  eq('a preset picks up its stencil', applied.alpha, 'rivet');
  eq('a preset can turn on stamp mode', applied.stamp, true);
  eq('the size slider follows the preset', applied.pill, applied.radius);
  check('the brush strip shows the new brush', applied.toolOn);
  eq('applying a preset closes the sheet', applied.sheets, 0);

  /* save the current setup, then delete it again */
  await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.set('radius', 33);
    app.set('strength', 0.42);
    app.saveCurrentPreset();
  });
  await page.waitForTimeout(200);
  await page.fill('.dialog input[type=text]', 'Test setup');
  await page.locator('.dialog .btn', { hasText: 'Save' }).click();
  await page.waitForTimeout(200);
  const saved = await page.evaluate(() => {
    const app = window.SCULPT_APP;
    let stored = -1;
    try { stored = JSON.parse(window.localStorage.getItem('sculptfree.presets.v1') || '[]').length; } catch (e) {}
    return { count: app.userPresets.length, label: app.userPresets[0] && app.userPresets[0].label,
             radius: app.userPresets[0] && app.userPresets[0].settings.radius, stored: stored };
  });
  eq('the setup was saved', saved.count, 1);
  eq('the saved setup kept its name', saved.label, 'Test setup');
  eq('the saved setup kept the size', saved.radius, 33);
  check('the saved setup is in local storage', saved.stored === 1 || saved.stored === -1, `${saved.stored}`);

  await page.evaluate(() => window.SCULPT_APP.openPresetSheet());
  await page.waitForTimeout(220);
  const withMine = await page.evaluate(() => ({
    rows: document.querySelectorAll('.preset-row').length,
    mineRemovable: !!Array.from(document.querySelectorAll('.preset-row'))
      .find((r) => r.textContent.indexOf('Test setup') >= 0 && r.querySelector('.preset-x'))
  }));
  check('the saved setup appears in the list', withMine.rows >= 13, `${withMine.rows}`);
  check('a saved setup can be deleted', withMine.mineRemovable);
  await page.locator('.preset-row', { hasText: 'Test setup' }).locator('.preset-x').click();
  await page.waitForTimeout(150);
  const deleted = await page.evaluate(() => ({
    count: window.SCULPT_APP.userPresets.length,
    rows: document.querySelectorAll('.preset-row').length
  }));
  eq('deleting a setup removes it', deleted.count, 0);
  check('the list shrank', deleted.rows === withMine.rows - 1, `${deleted.rows}`);
  await page.evaluate(() => window.SCULPT_APP.closeSheet());
  await page.waitForTimeout(200);
}

/* ---- texture: bake, preview and export ------------------------------ */
{
  // paint something first, so there is colour worth baking
  await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.newScene('sphere', 3, true);
    app.set('alpha', 'none');
    app.set('stampMode', false);
    app.set('paintColorHex', '#2b6cff');
    app.fillColor();
    app.set('paintColorHex', '#ffcc22');
    app.selectBrush('paint');
    app.set('radius', 90);
    app.set('strength', 1);
  });
  await stroke([cx - 50, cy - 20], [cx + 50, cy + 20], 12);

  await page.evaluate(() => window.SCULPT_APP.openTextureSheet());
  await page.waitForTimeout(600);
  const preview = await page.evaluate(() => {
    const cvs = document.querySelector('.tex-preview');
    if (!cvs) return null;
    const d = cvs.getContext('2d').getImageData(0, 0, cvs.width, cvs.height).data;
    let blue = 0, yellow = 0, black = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 2] > 120 && d[i] < 90) blue++;
      if (d[i] > 150 && d[i + 1] > 110 && d[i + 2] < 90) yellow++;
      if (d[i] < 10 && d[i + 1] < 10 && d[i + 2] < 10) black++;
    }
    return { w: cvs.width, h: cvs.height, blue, yellow, black,
             note: document.querySelector('.sheet .sheet-note').textContent };
  });
  check('the texture sheet shows a preview', preview && preview.w >= 128, JSON.stringify(preview && preview.w));
  check('the baked preview carries the base colour', preview.blue > 500, `${preview.blue} blue pixels`);
  check('the baked preview carries the painted colour', preview.yellow > 50, `${preview.yellow} yellow pixels`);
  eq('the baked preview has no holes', preview.black, 0);
  check('the sheet reports how much of the image is used', /% of the image used/.test(preview.note),
    preview.note);
  await page.screenshot({ path: path.join(screens, '20-texture.png') });

  /* OBJ + MTL + PNG, through the real download path */
  const downloads = [];
  const collect = (d) => downloads.push(d);
  page.on('download', collect);
  await page.evaluate(() => {
    window.SCULPT_APP.set('textureSize', 512);
    window.SCULPT_APP.exportWithTexture('obj');
  });
  for (let i = 0; i < 120 && downloads.length < 3; i++) await page.waitForTimeout(100);
  page.off('download', collect);
  eq('a textured OBJ export writes three files', downloads.length, 3);
  const names = [];
  for (const d of downloads) {
    const dest = path.join(tmp, d.suggestedFilename());
    await d.saveAs(dest);
    names.push(d.suggestedFilename());
  }
  const objName = names.find((n) => n.endsWith('.obj'));
  const mtlName = names.find((n) => n.endsWith('.mtl'));
  const pngName = names.find((n) => n.endsWith('.png'));
  check('the set is an obj, an mtl and a png', !!objName && !!mtlName && !!pngName, names.join(','));
  check('the three files share one name', objName.replace(/\.obj$/, '') === pngName.replace(/\.png$/, ''),
    names.join(','));

  const objText = fs.readFileSync(path.join(tmp, objName), 'utf8');
  check('the exported obj has texture coordinates', /^vt /m.test(objText));
  check('the exported obj points at the material file', objText.indexOf('mtllib ' + mtlName) >= 0);
  const mtlText = fs.readFileSync(path.join(tmp, mtlName), 'utf8');
  check('the material points at the image', mtlText.indexOf('map_Kd ' + pngName) >= 0, mtlText.slice(0, 120));

  const png = fs.readFileSync(path.join(tmp, pngName));
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  check('the image is a png', sig.every((b, i) => png[i] === b));
  const pngW = png.readUInt32BE(16), pngH = png.readUInt32BE(20);
  eq('the image is the size that was asked for', `${pngW}x${pngH}`, '512x512');
  check('the image is not a stub', png.length > 2000, `${png.length} bytes`);

  const S3 = (await import('./harness.mjs')).load();
  const objBuf = fs.readFileSync(path.join(tmp, objName));
  const reimported = S3.IO.importBuffer(objName,
    objBuf.buffer.slice(objBuf.byteOffset, objBuf.byteOffset + objBuf.byteLength));
  check('the textured obj re-imports cleanly', reimported.objects.length === 1 && !reimported.warnings.length,
    reimported.warnings.join(';'));

  /* GLB carries the image inside */
  const [glb] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.evaluate(() => window.SCULPT_APP.exportWithTexture('glb'))
  ]);
  const glbPath = path.join(tmp, glb.suggestedFilename());
  await glb.saveAs(glbPath);
  check('the textured glb is one file', glb.suggestedFilename().endsWith('.glb'), glb.suggestedFilename());
  const glbBuf = fs.readFileSync(glbPath);
  const ab = glbBuf.buffer.slice(glbBuf.byteOffset, glbBuf.byteOffset + glbBuf.byteLength);
  const jsonLen = new DataView(ab).getUint32(12, true);
  const glbJson = JSON.parse(Buffer.from(new Uint8Array(ab, 20, jsonLen)).toString('utf8').trim());
  check('the glb has the texture inside it', !!glbJson.images && glbJson.images.length === 1 &&
    glbJson.images[0].mimeType === 'image/png');
  check('the glb material samples it',
    !!glbJson.materials[0].pbrMetallicRoughness.baseColorTexture);
  const reglb = S3.IO.parseGLB(ab);
  check('the textured glb re-imports cleanly', reglb.objects.length === 1 && !reglb.warnings.length,
    reglb.warnings.join(';'));

  /* Roblox: a mesh inside the budget and its texture */
  await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.setBudget(2000);
    app.set('maxTriangles', 400000);
    app.scene.current().mesh.subdivide(false);
    app.scene.current().mesh.subdivide(false);
    app.refreshStatus();
  });
  const robloxFiles = [];
  const collect2 = (d) => robloxFiles.push(d);
  page.on('download', collect2);
  await page.evaluate(() => window.SCULPT_APP.exportForRoblox(null, true));
  for (let i = 0; i < 150 && robloxFiles.length < 3; i++) await page.waitForTimeout(100);
  page.off('download', collect2);
  eq('the Roblox texture export writes a mesh and an image', robloxFiles.length, 3);
  const robloxNames = [];
  for (const d of robloxFiles) {
    await d.saveAs(path.join(tmp, 'rbx-' + d.suggestedFilename()));
    robloxNames.push(d.suggestedFilename());
  }
  const rbxObj = robloxNames.find((n) => n.endsWith('.obj'));
  check('the Roblox set includes the image', robloxNames.some((n) => n.endsWith('.png')), robloxNames.join(','));
  const rbxBuf = fs.readFileSync(path.join(tmp, 'rbx-' + rbxObj));
  const rbxRes = S3.IO.importBuffer(rbxObj, rbxBuf.buffer.slice(rbxBuf.byteOffset, rbxBuf.byteOffset + rbxBuf.byteLength));
  const rbxMesh = new S3.Mesh();
  rbxMesh.setFromArrays(rbxRes.objects[0].positions, rbxRes.objects[0].indices, { weld: true });
  check('the textured Roblox mesh still fits the budget', rbxMesh.liveTris <= 2000, `${rbxMesh.liveTris}`);
  check('the textured Roblox mesh is closed', rbxMesh.countBorderEdges() === 0,
    `${rbxMesh.countBorderEdges()} border edges`);
  await page.evaluate(() => {
    window.SCULPT_APP.closeSheet();
    window.SCULPT_APP.newScene('sphere', 3, true);
  });
  await page.waitForTimeout(200);
}

/* ---- the new sheets on a phone, held upright ------------------------ */
{
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(400);
  const sheets = [
    ['brush settings', () => window.SCULPT_APP.openBrushSettingsSheet()],
    ['presets', () => window.SCULPT_APP.openPresetSheet()],
    ['texture', () => window.SCULPT_APP.openTextureSheet()]
  ];
  for (const [name, open] of sheets) {
    await page.evaluate(open);
    await page.waitForTimeout(name === 'texture' ? 700 : 260);
    // the sheet slides up; measuring mid-animation reads a position it is
    // about to leave, so wait for it to settle
    await page.waitForFunction(() => {
      const el = document.querySelector('.sheet');
      if (!el) return false;
      const now = el.getBoundingClientRect().bottom;
      const settled = window.__lastSheetBottom === now;
      window.__lastSheetBottom = now;
      return settled;
    }, null, { timeout: 4000 });
    const fit = await page.evaluate(() => {
      const sheet = document.querySelector('.sheet');
      const r = sheet.getBoundingClientRect();
      // every control has to be reachable: nothing may sit off either edge
      let offEdge = 0, tooSmall = 0;
      for (const node of sheet.querySelectorAll('button, input, canvas')) {
        const b = node.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;   // hidden
        if (b.left < -0.5 || b.right > window.innerWidth + 0.5) offEdge++;
        if (node.tagName === 'BUTTON' && b.height > 0 && b.height < 22) tooSmall++;
      }
      return {
        width: r.width, viewport: window.innerWidth,
        pageScroll: document.documentElement.scrollWidth - window.innerWidth,
        bottom: Math.round(r.bottom), height: Math.round(r.height),
        offEdge: offEdge, tooSmall: tooSmall,
        controls: sheet.querySelectorAll('button, input').length
      };
    });
    check(`the ${name} sheet fits a phone`, fit.width <= fit.viewport + 0.5,
      `${fit.width} in ${fit.viewport}`);
    eq(`the ${name} sheet causes no sideways scroll`, fit.pageScroll <= 0, true);
    eq(`nothing in the ${name} sheet sits off the edge`, fit.offEdge, 0);
    eq(`every button in the ${name} sheet is big enough to tap`, fit.tooSmall, 0);
    check(`the ${name} sheet does not run past the screen`, fit.bottom <= 916,
      `bottom ${fit.bottom}`);
    await page.screenshot({ path: path.join(screens, '2' + (1 + sheets.findIndex((x) => x[0] === name)) + '-phone-' + name.split(' ')[0] + '.png') });
    await page.evaluate(() => window.SCULPT_APP.closeSheet());
    await page.waitForTimeout(240);
  }
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.waitForTimeout(300);
}

/* ---- settings saved by the old build are migrated ------------------- */
{
  /*
   * Someone who used the version where dynamic topology was off has that
   * choice sitting in their browser's storage. Restoring it would hand them
   * back the stretching behaviour, so the load drops those keys once and
   * keeps everything else.
   */
  await page.evaluate(() => {
    window.localStorage.setItem('sculptfree.settings.v1', JSON.stringify({
      brush: 'clay', dyntopo: false, maxTriangles: 2000, detailPercent: 45,
      radius: 123, strength: 0.42, matcap: 'skin', triBudget: 5000, cavity: 0.9
    }));
  });
  await page.reload();
  await page.waitForFunction(() => window.SCULPT_APP && window.SCULPT_APP.renderer, null, { timeout: 15000 });
  await page.keyboard.press('Escape');            // dismiss any recovery offer
  await page.waitForTimeout(200);
  const migrated = await page.evaluate(() => {
    const st = window.SCULPT_APP.settings;
    let stored = null;
    try { stored = JSON.parse(window.localStorage.getItem('sculptfree.settings.v1')); } catch (e) { /* ignore */ }
    return { brush: st.brush, dyntopo: st.dyntopo, cap: st.maxTriangles, detail: st.detailPercent,
             radius: st.radius, strength: st.strength, matcap: st.matcap, budget: st.triBudget,
             cavity: st.cavity, schema: stored && stored.schema };
  });
  eq('an old settings file no longer switches adding off', migrated.dyntopo, true);
  eq('the old 2k ceiling is replaced with real headroom', migrated.cap, 150000);
  eq('the old coarse detail is replaced', migrated.detail, 20);
  eq('the old default brush moves across to Add', migrated.brush, 'add');
  eq('the brush size is kept', migrated.radius, 123);
  eq('the strength is kept', migrated.strength, 0.42);
  eq('the material is kept', migrated.matcap, 'skin');
  eq('the export budget is kept', migrated.budget, 5000);
  eq('other look settings are kept', migrated.cavity, 0.9);

  // sculpting once writes the stamp, so the migration happens only once
  await page.evaluate(() => window.SCULPT_APP.set('radius', 70));
  const stamped = await page.evaluate(() => {
    try { return JSON.parse(window.localStorage.getItem('sculptfree.settings.v1')).schema; }
    catch (e) { return null; }
  });
  eq('the migration stamps the file so it runs once', stamped, 2);

  await page.evaluate(() => {
    try { window.localStorage.removeItem('sculptfree.settings.v1'); } catch (e) { /* ignore */ }
  });
}

/* ---- final state --------------------------------------------------- */
check('no console errors in the whole session', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));

await browser.close();

console.log(`\nbrowser: ${passed} passed, ${failed} failed`);
for (const f of failures) console.log('  FAIL ' + f);
if (failed) process.exitCode = 1;
