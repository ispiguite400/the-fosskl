#!/usr/bin/env node
/*
 * FORLORN — render every shipped character and skin for the menus.
 *   node forlorn/forge/renders.mjs [id ...]      (needs the game served on http://127.0.0.1:8765)
 * Writes assets/renders/<id>[_skin].png from assets/models/<id>[_skin].glb.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { stamp } from './stamp.mjs';
const HERE = path.dirname(new URL(import.meta.url).pathname), GAME = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const KILLERS = new Set(['terrible', 'bacongeneral', 'baconcolonel', 'eliteguard', 'bloxwatch', 'baconsoldier']);
const want = process.argv.slice(2);
const models = fs.readdirSync(path.join(GAME, 'assets/models')).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4));
const out = path.join(GAME, 'assets/renders'); fs.mkdirSync(out, { recursive: true });
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 600, height: 800 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto('http://127.0.0.1:8765/forge/portrait.html');
await page.waitForFunction(() => window.ready);
for (const name of models) {
  const known = ['terrible', 'guest1337', 'bacongeneral', 'baconcolonel', 'eliteguard', 'bloxwatch', 'baconsoldier', 'matt', 'daisy', 'rose', 'captain', 'emily', 'justin', 'richguy', 'charlie', 'jez'];
  const id = known.find((k) => name === k || name.startsWith(k + '_'));
  if (!id || (want.length && !want.includes(id) && !want.includes(name))) continue;
  const skin = name === id ? 'default' : name.slice(id.length + 1);
  const url = await page.evaluate(([i, s, k]) => window.portrait(i, s, k), [id, skin, KILLERS.has(id)]);
  fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
  console.log('rendered', name);
}
await browser.close();
stamp();                                         // new hashes, so the menus fetch the new portraits
