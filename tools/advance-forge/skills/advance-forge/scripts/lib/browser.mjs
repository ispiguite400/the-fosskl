/*
 * Advance Forge — the shared plumbing every script uses: find Playwright and
 * a Chromium, open the bundled app or player headless, move files in and out
 * of the page, and lay renders out as contact sheets.
 */
import { createRequire } from 'module';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
export const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const APP = path.join(SKILL, 'app', 'sculpt.html');
export const PLAYER = path.join(SKILL, 'app', 'player.html');
export const LIB = path.join(SKILL, 'scripts', 'lib');

/** Playwright, from the project, the global install, or a path in PLAYWRIGHT_PATH. */
export function playwright() {
  const tries = [process.env.PLAYWRIGHT_PATH, 'playwright'];
  try { tries.push(path.join(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(), 'playwright')); } catch (e) { /* no npm */ }
  for (const t of tries) {
    if (!t) continue;
    try { return require(t); } catch (e) { /* next */ }
  }
  throw new Error('Playwright is not installed. Run: npm i -g playwright  (then: npx playwright install chromium, unless a Chromium is already provided)');
}

/** A Chromium to launch: CHROME_PATH, a pre-installed Playwright browser, or Playwright's own. */
export function chromiumPath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', path.join(process.env.HOME || '', '.cache', 'ms-playwright')].filter(Boolean);
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
      for (const exe of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        const p = path.join(r, d, exe);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return undefined;           // let Playwright use its own
}

export async function launch() {
  const { chromium } = playwright();
  return chromium.launch({
    executablePath: chromiumPath(),
    // software WebGL works everywhere, including servers with no GPU
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-device-scale-factor=1']
  });
}

/** Pipe page console lines starting with "#" (the build scripts' progress) and all errors to the terminal. */
export function wire(page, errors) {
  page.on('pageerror', (e) => { errors.push(e.message); console.log('page error: ' + e.message); });
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') { errors.push(t); console.log('console error: ' + t); }
    else if (t.startsWith('#')) console.log(t);
  });
}

/** Open the sculpting app with the helper libraries loaded. */
export async function openApp(browser, size = 900) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const errors = [];
  wire(page, errors);
  await page.goto('file://' + APP);
  await page.waitForFunction(() => window.SCULPT_APP && window.SCULPT_APP.renderer, null, { timeout: 30000 });
  // renders show only the model: no toolbars, toasts or dialogs
  await page.addStyleTag({ content: '#ui,#toasts,#sheets,#busy,#drop-hint,.dialog{display:none!important}' });
  // no "recover your last sculpt?" prompt in the way
  await page.evaluate(() => { try { window.SCULPT_APP.settings.autosave = false; } catch (e) { /* fine */ } });
  await page.addScriptTag({ path: path.join(LIB, 'sculptkit.js') });
  await page.addScriptTag({ path: path.join(LIB, 'clay.js') });
  return { page, errors };
}

export const toB64 = (file) => fs.readFileSync(file).toString('base64');

/** Page-side: bytes (ArrayBuffer | typed array | string) -> base64, for handing files back to node. */
export const PAGE_B64 = `async (d) => {
  if (typeof d === 'string') return btoa(unescape(encodeURIComponent(d)));
  if (d instanceof Blob) d = await d.arrayBuffer();
  const u = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}`;

/** Load a .sculpt project or a mesh file (glb/obj/stl/ply) into the app, replacing the scene. */
export async function loadInto(page, file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const res = await page.evaluate(([d, name, ext]) => {
    const S = window.SCULPT, a = window.SCULPT_APP;
    const buf = Uint8Array.from(atob(d), (c) => c.charCodeAt(0)).buffer;
    if (ext === 'sculpt') {
      const p = S.IO.loadProject(buf);
      if (!p.ok) return { ok: false, reason: p.reason };
      a.applyProject(p);
      return { ok: true, tris: a.scene.totals().tris, rig: !!p.rig };
    }
    const r = S.IO.importBuffer(name, buf);
    if (!r || !r.objects || !r.objects.length) return { ok: false, reason: (r && r.warnings && r.warnings.join('; ')) || 'could not read ' + name };
    for (const o of a.scene.objects) a.renderer.releaseObject(o);
    a.scene.clear(); a.history.clear();
    for (const m of r.objects) {
      const mesh = new S.Mesh();
      mesh.setFromArrays(m.positions, m.indices, { colors: m.colors, weld: true });
      a.scene.add(new S.SceneObject(m.name || name, mesh));
    }
    a.refreshObjects(); a.frameAll(true);
    return { ok: true, tris: a.scene.totals().tris };
  }, [toB64(file), path.basename(file), ext]);
  if (!res.ok) throw new Error('Could not load ' + file + ': ' + res.reason);
  return res;
}

/** Write base64 from the page to a file, making the folder. */
export function writeB64(file, b64) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
}

/** Lay data-URL images out in a grid and save one PNG. */
export async function contactSheet(browser, images, file, opts = {}) {
  const cols = opts.cols || Math.min(images.length, 3), w = opts.cell || 420;
  const rows = Math.ceil(images.length / cols), h = Math.round(w * (opts.aspect || 1));
  const labels = opts.labels || [];
  const html = `<body style="margin:0;background:#1d2026;display:grid;grid-template-columns:repeat(${cols},${w}px);font:12px system-ui;color:#cfd6e0">` +
    images.map((d, i) => `<div style="position:relative;width:${w}px;height:${h}px"><img src="${d}" style="width:100%;height:100%;object-fit:cover">` +
      (labels[i] ? `<span style="position:absolute;left:8px;top:6px;background:#0008;padding:2px 6px;border-radius:4px">${labels[i]}</span>` : '') + '</div>').join('') + '</body>';
  const p = await browser.newPage({ viewport: { width: cols * w, height: rows * h } });
  await p.setContent(html);
  await p.waitForTimeout(150);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await p.screenshot({ path: file });
  await p.close();
}

/** Tiny argv parser: --key value, --flag, and positionals. */
export function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2), v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++; }
    } else out._.push(a);
  }
  return out;
}

/*
 * The standard review views, as [label, yaw, pitch]. Yaw 0 looks at the
 * model's front (it faces +Z); pi/2 looks at its left side.
 */
export const VIEWS = [['front', 0, 0.05], ['three-quarter', 0.6, 0.12], ['side', Math.PI / 2, 0.05],
                      ['back', Math.PI, 0.1], ['back three-quarter', Math.PI + 0.7, 0.12], ['other side', -Math.PI / 2, 0.05]];
