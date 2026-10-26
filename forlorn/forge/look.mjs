#!/usr/bin/env node
/*
 * FORLORN — look at a shipped character the way a reference picture does.
 *
 *   node forlorn/forge/look.mjs MODEL.glb OUT.png [--clip idle] [--t 0] [--yaw 0] [--pitch 0]
 *                               [--size 743x847]
 *
 * Renders the game file in Advance Forge's Rig Player (the clip at time t, front on) to
 * OUT-render.png. Then sidebyside.py puts a reference picture beside it at the same scale, so
 * the two can be compared part by part (see STYLE.md: Method).
 */
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const LIB = path.resolve(HERE, '../../tools/advance-forge/skills/advance-forge/scripts/lib/browser.mjs');
const { launch, wire, toB64, writeB64, PLAYER } = await import(LIB);

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const [file, out] = argv;
if (!file || !out) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]); process.exit(1); }
const [w, h] = String(opt('size', '743x847')).split('x').map(Number);

const browser = await launch();
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
wire(page, errors);
await page.goto('file://' + PLAYER);
await page.addStyleTag({ content: '.top,.dock,.hint,#info{display:none!important} body{background:#ddd!important}' });
await page.evaluate((d) => { window.RigPlayer.load(Uint8Array.from(atob(d), (c) => c.charCodeAt(0)).buffer, 'model.glb'); window.RigPlayer.state.playing = false; }, toB64(file));
await page.waitForFunction(() => !window.RigPlayer.state.texturesPending, null, { timeout: 15000 }).catch(() => {});
const png = await page.evaluate(([clip, t, yaw, pitch]) => {
  const R = window.RigPlayer, s = R.state;
  const c = s.model.anims.find((a) => a.name.toLowerCase() === clip) || null;
  R.setClip(c); s.time = t;
  s.cam.yaw = yaw; s.cam.pitch = pitch;
  return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(document.getElementById('gl').toDataURL('image/png')))));
}, [String(opt('clip', 'idle')).toLowerCase(), +opt('t', 0), +opt('yaw', 0), +opt('pitch', 0.04)]);
await browser.close();
const render = out.replace(/\.png$/, '') + '-render.png';
writeB64(render, png.split(',')[1]);

fs.copyFileSync(render, out);
if (errors.length) console.log('page errors: ' + errors.join(' | '));
console.log('wrote ' + out);
