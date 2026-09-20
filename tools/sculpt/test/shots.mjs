/*
 * Renders a full set of interface screenshots from the built app.
 * Run: node test/shots.mjs
 */
import { createRequire } from 'module';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'screens');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const appFile = 'file://' + path.join(here, '..', 'sculpt.html');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-device-scale-factor=1']
});

/* ---------- desktop ---------- */
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(appFile);
await page.waitForFunction(() => window.SCULPT_APP && window.SCULPT_APP.renderer, null, { timeout: 20000 });
await page.waitForTimeout 
  ? await page.waitForTimeout(500) : null;

async function shot(name) {
  await page.waitForTimeout(260);
  await page.screenshot({ path: path.join(out, name + '.png') });
  console.log('  ' + name);
}

await shot('01-start');

/* sculpt a head-ish shape so later shots show real work */
await page.evaluate(() => {
  const app = window.SCULPT_APP;
  const w = app.canvas.clientWidth, h = app.canvas.clientHeight;
  const cx = w / 2, cy = h / 2;
  app.settings.symmetryX = true;
  function stroke(brush, from, to, radius, strength, steps = 16, invert = false) {
    app.settings.brush = brush;
    app.settings.radius = radius;
    app.settings.strength = strength;
    app.engine.begin({ x: from[0], y: from[1], pressure: 1, invert });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      app.engine.move({ x: from[0] + (to[0] - from[0]) * t, y: from[1] + (to[1] - from[1]) * t, pressure: 1, invert });
    }
    app.engine.end();
  }
  stroke('clay', [cx + 30, cy - 90], [cx + 120, cy - 74], 90, 0.4);         // brow
  stroke('clay', [cx + 55, cy - 44], [cx + 105, cy - 40], 66, 0.35, 14, true); // eye sockets
  stroke('clay', [cx + 60, cy + 34], [cx + 120, cy + 10], 96, 0.35);        // cheeks
  stroke('claystrips', [cx + 40, cy + 130], [cx + 118, cy + 84], 80, 0.35); // jaw
  app.settings.symmetryX = false;
  stroke('draw', [cx, cy + 4], [cx - 2, cy + 34], 52, 0.5, 14);             // nose
  app.settings.symmetryX = true;
  stroke('crease', [cx + 10, cy + 88], [cx + 56, cy + 82], 48, 0.35, 12);   // mouth
  stroke('smooth', [cx + 10, cy - 60], [cx + 120, cy + 60], 130, 0.5, 18);
  app.settings.paintColor = new Float32Array([0.86, 0.62, 0.5]);
  stroke('paint', [cx, cy - 20], [cx + 130, cy + 20], 170, 1, 10);
  app.settings.paintColor = new Float32Array([0.62, 0.24, 0.2]);
  stroke('paint', [cx + 18, cy + 84], [cx + 64, cy + 78], 32, 1, 8);
  app.settings.brush = 'clay';
  app.settings.radius = 78;
  app.settings.strength = 0.55;
  app.settings.paintColorHex = '#d94f3d';
  app.camera.yaw = 0.5; app.camera.pitch = 0.1; app.camera.update();
  app.frameSelection(true);
  app.refreshStatus();
  app.draw();
});
await page.mouse.move(700, 400);
await shot('02-sculpting');

/* each sheet */
/* the trims: cut flat faces onto a ball */
await page.evaluate(() => {
  const app = window.SCULPT_APP;
  const w = app.canvas.clientWidth, h = app.canvas.clientHeight;
  const cx = w / 2, cy = h / 2;
  app.setBudget(10000);
  app.newScene('sphere', 4, true);
  app.set('symmetryX', false);
  app.set('flat', true);
  function stroke(brush, from, to, radius, strength, steps = 16, invert = false) {
    app.settings.brush = brush;
    app.settings.radius = radius;
    app.settings.strength = strength;
    app.engine.begin({ x: from[0], y: from[1], pressure: 1, invert });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      app.engine.move({ x: from[0] + (to[0] - from[0]) * t, y: from[1] + (to[1] - from[1]) * t, pressure: 1, invert });
    }
    app.engine.end();
  }
  // Trim Normal: one clean flat face per drag, from a few angles
  stroke('trimnormal', [cx - 80, cy - 40], [cx + 80, cy - 30], 190, 1, 16);
  app.camera.yaw = 1.15; app.camera.update();
  stroke('trimnormal', [cx - 80, cy - 20], [cx + 80, cy - 10], 190, 1, 16);
  app.camera.yaw = -0.9; app.camera.pitch = 0.5; app.camera.update();
  stroke('trimnormal', [cx - 80, cy], [cx + 80, cy + 10], 180, 1, 16);
  app.camera.yaw = 2.4; app.camera.pitch = -0.3; app.camera.update();
  stroke('trimnormal', [cx - 80, cy], [cx + 80, cy + 10], 180, 1, 16);
  // Trim Dynamic: facet what curve is left
  app.camera.yaw = 0.4; app.camera.pitch = 0.2; app.camera.update();
  stroke('trimdynamic', [cx - 60, cy + 60], [cx + 60, cy + 80], 110, 1, 18);
  app.settings.brush = 'trimdynamic';
  app.settings.radius = 62;
  app.settings.strength = 0.6;
  app.frameSelection(true);
  app.refreshStatus();
  app.draw();
});
await page.mouse.move(690, 420);
await shot('03-trims');
await page.evaluate(() => { window.SCULPT_APP.set('flat', false); window.SCULPT_APP.setBudget(2000); });

await page.evaluate(() => window.SCULPT_APP.openMainMenu());
await shot('04-menu');
await page.evaluate(() => window.SCULPT_APP.openBrushSheet());
await shot('05-brushes');
await page.evaluate(() => window.SCULPT_APP.openExportSheet());
await shot('06-export');
await page.evaluate(() => window.SCULPT_APP.openLookSheet());
await shot('07-look');
await page.evaluate(() => window.SCULPT_APP.openBrushSettingsSheet());
await shot('08-brush-settings');
await page.evaluate(() => window.SCULPT_APP.openObjectsSheet());
await shot('09-objects');
await page.evaluate(() => { window.SCULPT_APP.closeSheet(); window.SCULPT_APP.dialogRemesh(); });
await shot('09-remesh');
await page.keyboard.press('Escape');
await page.evaluate(() => window.SCULPT_APP.dialogPrimitive());
await shot('10-shapes');
await page.keyboard.press('Escape');
await page.evaluate(() => window.SCULPT_APP.dialogShortcuts());
await shot('11-controls');
await page.keyboard.press('Escape');
await page.evaluate(() => window.SCULPT_APP.dialogExport());
await shot('12-export-options');
await page.keyboard.press('Escape');

/* wireframe view of the sculpt */
await page.evaluate(() => {
  const app = window.SCULPT_APP;
  app.set('wireframe', true);
  app.draw();
});
await page.mouse.move(660, 380);
await shot('13-wireframe');
await page.evaluate(() => window.SCULPT_APP.set('wireframe', false));

/* a remesh, so the even-triangle result is visible */
await page.evaluate(() => window.SCULPT_APP.runRemesh({ resolution: 140, smooth: 2, colors: true }));
await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 60000 });
await page.evaluate(() => { window.SCULPT_APP.set('wireframe', true); window.SCULPT_APP.draw(); });
await shot('14-remeshed-wireframe');
await page.evaluate(() => { window.SCULPT_APP.set('wireframe', false); window.SCULPT_APP.draw(); });
await shot('15-remeshed');

console.log('desktop errors:', errors.length ? errors.slice(0, 3) : 'none');
await page.close();

/* ---------- phone ---------- */
const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const phone = await ctx.newPage();
const perrors = [];
phone.on('pageerror', (e) => perrors.push(e.message));
await phone.goto(appFile);
await phone.waitForFunction(() => window.SCULPT_APP && window.SCULPT_APP.renderer, null, { timeout: 20000 });
await phone.waitForTimeout(600);

async function pshot(name) {
  await phone.waitForTimeout(250);
  await phone.screenshot({ path: path.join(out, name + '.png') });
  console.log('  ' + name);
}
await phone.evaluate(() => {
  const app = window.SCULPT_APP;
  const w = app.canvas.clientWidth, h = app.canvas.clientHeight;
  const cx = w / 2, cy = h / 2;
  app.settings.symmetryX = true;
  function stroke(brush, from, to, radius, strength, steps = 14, invert = false) {
    app.settings.brush = brush;
    app.settings.radius = radius;
    app.settings.strength = strength;
    app.engine.begin({ x: from[0], y: from[1], pressure: 1, invert });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      app.engine.move({ x: from[0] + (to[0] - from[0]) * t, y: from[1] + (to[1] - from[1]) * t, pressure: 1, invert });
    }
    app.engine.end();
  }
  stroke('clay', [cx + 16, cy - 74], [cx + 62, cy - 62], 62, 0.45);
  stroke('clay', [cx + 26, cy - 32], [cx + 54, cy - 30], 44, 0.4, 10, true);
  stroke('draw', [cx, cy - 2], [cx, cy + 26], 40, 0.5, 12);
  stroke('clay', [cx + 28, cy + 56], [cx + 60, cy + 34], 58, 0.4);
  stroke('smooth', [cx + 10, cy - 50], [cx + 70, cy + 40], 100, 0.5, 14);
  app.settings.brush = 'clay';
  app.settings.radius = 60;
  app.frameSelection(true);
  app.refreshStatus();
  app.draw();
});
await pshot('16-phone');
await phone.evaluate(() => window.SCULPT_APP.openMainMenu());
await pshot('17-phone-menu');
await phone.evaluate(() => window.SCULPT_APP.openBrushSheet());
await pshot('18-phone-brushes');
await phone.evaluate(() => window.SCULPT_APP.openExportSheet());
await pshot('19-phone-export');
await phone.evaluate(() => window.SCULPT_APP.openBrushSettingsSheet());
await pshot('20-phone-brush-settings');
await phone.evaluate(() => { window.SCULPT_APP.closeSheet(); window.SCULPT_APP.dialogDecimate(); });
await pshot('21-phone-reduce');
await phone.keyboard.press('Escape');
await phone.evaluate(() => window.SCULPT_APP.openLookSheet());
await pshot('22-phone-look');
await phone.keyboard.press('Escape');
console.log('phone errors:', perrors.length ? perrors.slice(0, 3) : 'none');

await browser.close();
console.log('\nscreens written to test/screens');
