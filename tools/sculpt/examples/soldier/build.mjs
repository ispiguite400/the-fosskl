/*
 * Builds the soldier by running the build steps inside the real app.
 *
 *   node build.mjs            writes soldier.sculpt, soldier.glb and the renders
 *   TARGET=100000 node build.mjs   reduce to a different triangle count first
 *
 * Needs the standalone build (node ../../build.js) and Playwright's Chromium.
 */
import { createRequire } from 'module';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const appFile = 'file://' + path.join(here, '..', '..', 'sculpt.html');
const target = +(process.env.TARGET || 250000);
const steps = ['paint.js', 'body.js', 'head.js', 'gear.js', 'rifle.js', 'folds.js'];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-device-scale-factor=1']
});
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('#')) console.log(m.text()); });
await page.goto(appFile);
await page.waitForFunction(() => window.SCULPT_APP && window.SCULPT_APP.renderer, null, { timeout: 20000 });
// just the canvas in the renders
await page.addStyleTag({ content: 'body > *:not(:has(canvas)) {display:none!important} .toast,.dialog,.sheet{display:none!important}' });
await page.addScriptTag({ path: path.join(here, 'sculptkit.js') });
await page.addScriptTag({ path: path.join(here, 'clay.js') });
const t0 = Date.now();
// one script, so the steps share their top-level names
await page.addScriptTag({ content: steps.map((f) => fs.readFileSync(path.join(here, f), 'utf8')).join('\n') });
const log = await page.evaluate(() => M.log);
if (log.length) console.log('strokes that missed the surface:', log);
console.log('sculpted in', ((Date.now() - t0) / 1000).toFixed(1), 's');

const files = await page.evaluate(async (target) => {
  const S = window.SCULPT, a = M.app, o = M.obj();
  if (M.tris() > target) {
    a.history.runMeshOp(o, 'Decimate', () => { o.mesh.decimate(target); });
    a.afterMeshOp(o);
  }
  const toB64 = async (d) => {
    if (typeof d === 'string') return btoa(unescape(encodeURIComponent(d)));
    if (d instanceof Blob) d = await d.arrayBuffer();
    const u = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const proj = S.IO.saveProject({ objects: a.scene.objects, selected: a.scene.selected,
    camera: a.camera.serialize(), settings: a.exportableSettings() });
  const opts = Object.assign(a.exportOptions(), { includeColors: true });
  const glb = S.IO.exportGeoms('glb', S.IO.prepare(a.scene.objects, opts), opts);
  return { tris: M.tris(), sculpt: await toB64(proj), glb: await toB64(glb.data) };
}, target);
fs.writeFileSync(path.join(here, 'soldier.sculpt'), Buffer.from(files.sculpt, 'base64'));
fs.writeFileSync(path.join(here, 'soldier.glb'), Buffer.from(files.glb, 'base64'));

const shots = { front: [0, 0.05, 0.92, 0.98], 'three-quarter': [0.5, 0.08, 0.92, 0.98],
                back: [Math.PI + 0.5, 0.08, 0.92, 0.98], upper: [0.45, 0.05, 1.3, 0.4],
                face: [0.35, 0.05, 1.6, 0.14], boots: [0.6, 0.2, 0.2, 0.3] };
for (const [name, v] of Object.entries(shots)) {
  const url = await page.evaluate((v) => { M.view(v[0], v[1], [0, v[2], 0], v[3]); return M.snap(); }, v);
  fs.writeFileSync(path.join(here, name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
}
console.log('wrote soldier.sculpt and soldier.glb at', files.tris, 'triangles, plus renders');
await browser.close();
