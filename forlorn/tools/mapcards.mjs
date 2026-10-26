// node tools/mapcards.mjs [mapId ...] : photograph each map from its `card` view for the menus.
// Needs the game served on http://127.0.0.1:8765 (python3 -m http.server 8765 in forlorn/).
// Writes assets/maps/<id>.jpg (960×540).
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const here = path.dirname(fileURLToPath(import.meta.url)), out = path.join(here, '..', 'assets', 'maps');
const ids = process.argv.slice(2);
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.addInitScript(() => { try { const s = JSON.parse(localStorage.getItem('forlorn.settings.v1') || '{}'); s.quality = 'ultra'; s.renderScale = 1; localStorage.setItem('forlorn.settings.v1', JSON.stringify(s)); } catch {} });
await page.goto('http://127.0.0.1:8765/index.html');
await page.waitForFunction(() => window.__forlorn && window.__forlorn.state === 'title', null, { timeout: 60000 });
await page.waitForTimeout(1500);
const list = ids.length ? ids : await page.evaluate(async () => (await import('./src/data/maps.js')).MAP_IDS);
for (const id of list) {
  const ok = await page.evaluate(async (id) => {
    const { loadMap } = await import('./src/data/maps.js'); const { buildWorld } = await import('./src/world/world.js');
    const def = await loadMap(id); if (!def.card) return false;
    const g = window.__forlorn; g.state = 'view'; g.ui.clear(); document.getElementById('ui').style.display = 'none';
    if (g.cardWorld) g.cardWorld.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    const w = buildWorld(g.renderer, def, 3); g.cardWorld = w; g.renderer.setScene(w.scene);
    w.scene.fog.density *= 0.8;
    const c = g.renderer.camera; c.fov = 58; c.updateProjectionMatrix();
    c.position.set(...def.card.at); c.lookAt(...def.card.look);
    for (let i = 0; i < 3; i++) w.update(0.016, c.position);
    return true;
  }, id);
  if (!ok) { console.log('skip', id, '(no card view)'); continue; }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, id + '.jpg'), type: 'jpeg', quality: 82 });
  console.log('card', id);
}
await browser.close();
