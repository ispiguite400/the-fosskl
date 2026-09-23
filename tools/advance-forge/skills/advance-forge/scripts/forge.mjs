#!/usr/bin/env node
/*
 * Advance Forge — build, look at and export models with the SculptFree app.
 *
 *   node forge.mjs doctor
 *       Check everything is in place (Playwright, a browser, WebGL, the app).
 *
 *   node forge.mjs build step1.js [step2.js ...] --out DIR [--name NAME]
 *                  [--load start.sculpt] [--height H] [--close "yaw,pitch,y,halfH;..."]
 *       Run build steps inside the app (joined into one script, so top-level
 *       names are shared between steps), then write DIR/NAME.sculpt (the full
 *       sculpt), DIR/NAME-sheet.png (six views) and one close-up per --close
 *       entry. No model file: the game file comes only from ship.mjs.
 *
 *   node forge.mjs render FILE.(sculpt|glb|obj|stl|ply) --out DIR [--close ...] [--cavity 0]
 *       Render the six review views (and close-ups) of an existing file.
 *
 *   node forge.mjs export ...
 *       Retired. Every export goes through ship.mjs (2,000-5,000 triangles,
 *       texture baked from the full sculpt, rigged, animated).
 */
import fs from 'fs';
import path from 'path';
import { launch, openApp, loadInto, writeB64, contactSheet, args, VIEWS, PAGE_B64, APP, PLAYER } from './lib/browser.mjs';

const A = args(process.argv.slice(2));
const cmd = A._.shift();

/* ---------------- shared page actions ---------------- */

// frame the whole model: centre on its bounds, fit its height
async function frame(page, height) {
  return page.evaluate((forcedH) => {
    const a = window.SCULPT_APP, S = window.SCULPT, mn = S.V3.create(0, 0, 0), mx = S.V3.create(0, 0, 0);
    a.scene.bounds(mn, mx);
    const h = forcedH || Math.max(mx[1] - mn[1], (mx[0] - mn[0]) * 0.9, (mx[2] - mn[2]) * 0.9);
    return { cy: (mn[1] + mx[1]) / 2, half: h * 0.58, min: Array.from(mn), max: Array.from(mx) };
  }, height || 0);
}

async function snap(page, yaw, pitch, cy, half) {
  return page.evaluate(([y, p, cy, h]) => { M.view(y, p, [0, cy, 0], h); return M.snap(); }, [yaw, pitch, cy, half]);
}

function parseClose(spec) {
  if (!spec || spec === true) return [];
  return String(spec).split(';').filter(Boolean).map((s) => s.split(',').map(Number));
}

async function review(browser, page, out, name, opts = {}) {
  const f = await frame(page, opts.height);
  if (opts.cavity !== undefined) await page.evaluate((c) => M.app.set('cavity', c), +opts.cavity);
  const imgs = [];
  for (const [, yaw, pitch] of VIEWS) imgs.push(await snap(page, yaw, pitch, f.cy, f.half));
  const sheet = path.join(out, name + '-sheet.png');
  await contactSheet(browser, imgs, sheet, { labels: VIEWS.map((v) => v[0]) });
  const closes = parseClose(opts.close);
  const files = [sheet];
  for (let i = 0; i < closes.length; i++) {
    const [yaw, pitch, y, half] = closes[i];
    const d = await snap(page, yaw, pitch, y, half);
    const file = path.join(out, `${name}-close${i + 1}.png`);
    writeB64(file, d.split(',')[1]);
    files.push(file);
  }
  const b = await page.evaluate(() => { const S = window.SCULPT, mn = S.V3.create(0, 0, 0), mx = S.V3.create(0, 0, 0); window.SCULPT_APP.scene.bounds(mn, mx); return { min: Array.from(mn), max: Array.from(mx), tris: M.tris(), objects: window.SCULPT_APP.scene.objects.length }; });
  console.log(`size: ${(b.max[0] - b.min[0]).toFixed(3)} x ${(b.max[1] - b.min[1]).toFixed(3)} x ${(b.max[2] - b.min[2]).toFixed(3)} m ` +
              `(y ${b.min[1].toFixed(3)} .. ${b.max[1].toFixed(3)}), ${b.tris} triangles in ${b.objects} object(s)`);
  console.log('renders:\n  ' + files.join('\n  '));
  return files;
}

/* ---------------- commands ---------------- */

async function doctor() {
  const ok = (m) => console.log('  ok   ' + m), bad = (m) => { console.log('  FAIL ' + m); process.exitCode = 1; };
  console.log('Advance Forge doctor');
  fs.existsSync(APP) ? ok('app: ' + APP) : bad('app missing: ' + APP + ' (run sync.sh in the plugin folder)');
  fs.existsSync(PLAYER) ? ok('player: ' + PLAYER) : bad('player missing: ' + PLAYER);
  let browser;
  try { browser = await launch(); ok('browser launched'); } catch (e) { bad('browser: ' + e.message); return; }
  try {
    const { page, errors } = await openApp(browser, 400);
    const info = await page.evaluate(() => ({ version: window.SCULPT.VERSION, rig: !!window.SCULPT.Rig, kit: typeof M.stroke, clay: typeof M.clay.build }));
    ok(`SculptFree ${info.version} running with WebGL`);
    info.rig ? ok('rigging module present') : bad('rigging module missing: the app copy is too old');
    info.kit === 'function' && info.clay === 'function' ? ok('sculptkit + clay loaded') : bad('helper libraries did not load');
    // a real stroke, to prove the engine responds
    const t = await page.evaluate(() => { M.front([0, 0, 0], 0.8); const before = M.tris(); M.stroke('add', [[-0.1, 0.1], [0.1, 0.1]], 0.12, 0.6); return [before, M.tris()]; });
    t[1] > t[0] ? ok(`a test stroke added material (${t[0]} -> ${t[1]} triangles)`) : bad('a test stroke did nothing');
    errors.length ? bad('console errors: ' + errors.join(' | ')) : ok('no console errors');
  } catch (e) { bad(e.message); }
  await browser.close();
}

async function build() {
  const steps = A._;
  if (!steps.length) throw new Error('build needs at least one step file');
  const out = A.out || 'forge-out', name = A.name || path.basename(steps[steps.length - 1], '.js');
  const browser = await launch();
  const { page, errors } = await openApp(browser);
  if (A.load) console.log('loaded ' + A.load + ': ' + (await loadInto(page, A.load)).tris + ' triangles');
  const code = steps.map((f) => `/* ===== ${f} ===== */\n` + fs.readFileSync(f, 'utf8')).join('\n;\n');
  const t0 = Date.now();
  await page.addScriptTag({ content: code });
  const log = await page.evaluate(() => M.log.slice());
  console.log(`built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (log.length) console.log(`strokes that missed the surface (${log.length}):\n  ` + log.slice(0, 40).join('\n  '));
  if (errors.length) { console.log('BUILD HAD ERRORS — fix them before trusting the renders'); process.exitCode = 1; }
  await review(browser, page, out, name, { close: A.close, height: A.height && +A.height, cavity: A.cavity });
  if (!A['no-save']) await saveProject(page, out, name);
  await browser.close();
}

async function render() {
  const file = A._[0];
  if (!file) throw new Error('render needs a file');
  const out = A.out || 'forge-out', name = A.name || path.basename(file).replace(/\.\w+$/, '');
  const browser = await launch();
  const { page } = await openApp(browser);
  await loadInto(page, file);
  await review(browser, page, out, name, { close: A.close, height: A.height && +A.height, cavity: A.cavity });
  await browser.close();
}

async function saveProject(page, out, name) {
  const b64 = await page.evaluate(async (B64) => {
    const toB64 = eval(B64), S = window.SCULPT, a = window.SCULPT_APP;
    if (a.rig && a.rig.rest) a.rigRest();
    return toB64(S.IO.saveProject({ objects: a.scene.objects, selected: a.scene.selected, camera: a.camera.serialize(),
      settings: a.exportableSettings(), rig: a.rigForProject ? a.rigForProject() : null }));
  }, PAGE_B64);
  const pf = path.join(out, name + '.sculpt');
  writeB64(pf, b64);
  console.log(`wrote ${pf} (the full sculpt). For the game: node ship.mjs ${pf} --out ${out} --joints ...`);
}

async function exportCmd() {
  console.log('forge.mjs export is retired. Every model for the game is exported with ship.mjs:\n' +
    '  node ship.mjs MODEL.sculpt --out DIR --joints joints.json [--tris 2000-5000]   (a character)\n' +
    '  node ship.mjs MODEL.sculpt --out DIR --static [--tris 2000-5000]               (a prop)');
  process.exit(1);
}

const COMMANDS = { doctor, build, render, export: exportCmd };
if (!COMMANDS[cmd]) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*/, '').replace(/^ \* ?/gm, ''));
  process.exit(cmd ? 1 : 0);
}
COMMANDS[cmd]().catch((e) => { console.error('error: ' + e.message); process.exit(1); });
