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
  eq('nine brush buttons on screen (8 plus more)', state.toolButtons, 9);
  eq('size and strength sliders on screen', state.pills, 2);
  // the whole point of the redesign: the resting screen stays uncluttered
  check('the resting screen shows few controls', state.visibleControls <= 18, String(state.visibleControls));
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
      borderEdges: mesh.countBorderEdges()
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
  check('a clay stroke pushed the surface out', after.far > before.far + 0.005,
    `${before.far.toFixed(4)} -> ${after.far.toFixed(4)}`);
  // the default is a fixed low-poly mesh: sculpting must not grow the count,
  // which is what keeps a model inside a Roblox budget
  eq('fixed topology keeps the triangle count', after.tris, before.tris);
  eq('the mesh is still closed', after.borderEdges, 0);
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

/* ---- the triangle budget ------------------------------------------- */
{
  const defaults = await page.evaluate(() => ({
    dyntopo: window.SCULPT_APP.settings.dyntopo,
    budget: window.SCULPT_APP.settings.triBudget,
    cap: window.SCULPT_APP.settings.maxTriangles,
    tris: window.SCULPT_APP.scene.current().mesh.liveTris
  }));
  eq('dynamic topology is off by default', defaults.dyntopo, false);
  eq('the default budget suits a Roblox prop', defaults.budget, 2000);
  check('the starting mesh is inside the budget', defaults.tris <= defaults.budget,
    `${defaults.tris} of ${defaults.budget}`);

  // with dynamic topology on, detail is added but capped at the budget
  await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.newScene('sphere', null, true);
    app.set('dyntopo', true);
  });
  await page.waitForTimeout(150);
  const start = await meshState();
  for (let i = 0; i < 6; i++) {
    await stroke([cx - 70 + i * 12, cy - 40 + i * 9], [cx + 70, cy + 30 + i * 6], 10);
  }
  const grown = await meshState();
  check('dynamic topology adds detail when switched on', grown.tris > start.tris,
    `${start.tris} -> ${grown.tris}`);
  check('it never passes the budget', grown.tris <= defaults.cap + 8,
    `${grown.tris} of ${defaults.cap}`);
  eq('still closed at the budget', grown.borderEdges, 0);

  // picking a budget sets everything that follows from it
  const applied = await page.evaluate(() => {
    const app = window.SCULPT_APP;
    app.setBudget(1000);
    const low = { cap: app.settings.maxTriangles, dyntopo: app.settings.dyntopo, detail: app.settings.detailPercent };
    app.setBudget(250000);
    const high = { cap: app.settings.maxTriangles, dyntopo: app.settings.dyntopo, detail: app.settings.detailPercent };
    app.setBudget(2000);
    return { low, high, suggested: app.detailForBudget(window.SCULPT.Prim.byId('sphere')) };
  });
  eq('a 1k budget caps the mesh', applied.low.cap, 1000);
  eq('a 1k budget switches dynamic topology off', applied.low.dyntopo, false);
  check('a small budget uses coarser triangles', applied.low.detail > applied.high.detail,
    `${applied.low.detail}% vs ${applied.high.detail}%`);
  eq('a big budget raises the cap', applied.high.cap, 250000);
  eq('a 2k budget suggests a 1.3k starting sphere', applied.suggested, 3);

  await page.evaluate(() => { window.SCULPT_APP.newScene('sphere', null, true); window.SCULPT_APP.set('dyntopo', false); });
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
  eq('the brush sheet lists all 18 brushes', cards, 18);
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
  check('the paint brush coloured vertices', painted > 50, String(painted));

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
  const S = (await import('./harness.mjs')).load(['07-scene', '08-brush', '09-camera']);
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
  eq('the brush strip is there on a phone', layout.brushButtons, 9);
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
  const S2 = (await import('./harness.mjs')).load(['07-scene', '08-brush', '09-camera']);
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

  // the budget chip reports over-budget
  const chip = await page.evaluate(() => {
    const c = document.getElementById('title-chip');
    return { text: c.textContent, over: c.classList.contains('over') };
  });
  check("the budget chip shows the overrun", chip.over && /2k$/.test(chip.text), JSON.stringify(chip));

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

/* ---- final state --------------------------------------------------- */
check('no console errors in the whole session', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));

await browser.close();

console.log(`\nbrowser: ${passed} passed, ${failed} failed`);
for (const f of failures) console.log('  FAIL ' + f);
if (failed) process.exitCode = 1;
