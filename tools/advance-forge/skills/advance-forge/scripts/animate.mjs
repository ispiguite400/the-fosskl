#!/usr/bin/env node
/*
 * Advance Forge — check and bake animations with the Rig Player.
 *
 *   node animate.mjs RIGGED.glb --out DIR [--name NAME] [--clips my-clips.js]
 *                    [--only walk,idle] [--frames 6] [--bake]
 *
 * Loads a rigged GLB into the player and, for every clip, renders a strip of
 * frames across one loop from the three-quarter front and from the side:
 *   DIR/NAME_anim_<clip>.png
 * With --bake it also writes DIR/NAME_animated.glb with every clip baked in
 * at 30 fps (glTF animations: Blender, Unity, Godot, three.js and the game's
 * forge-loader.js all play them).
 *
 * --clips adds your own clips. The file is plain JavaScript run in the
 * player page; it calls addClip() once per clip:
 *
 *   addClip({ id: 'slash', name: 'Sword slash', duration: 0.9, loop: false,
 *     pose(t) {                       // t in seconds, 0 .. duration
 *       const k = Math.min(1, t / 0.3);
 *       return {
 *         abs: { 'UpperArm.R': 20 + 110 * k },   // swing from straight down, degrees, + = forward
 *         rel: { 'Chest': [0, -30 * k, 0] },     // extra [x, y, z] degrees on top of rest
 *         offset: [0, 0, 0]                      // hips, metres for a 1.8 m figure
 *       };
 *     } });
 *
 * "abs" angles are measured from straight down, so they mean the same thing
 * whatever pose the model was sculpted in; feet use 90 = flat on the floor.
 * Look at every strip: feet through the floor, toes pointing up, a limb
 * stretching or a prop left behind all show up there.
 */
import fs from 'fs';
import path from 'path';
import { launch, wire, contactSheet, args, toB64, writeB64, PLAYER } from './lib/browser.mjs';

const A = args(process.argv.slice(2));
const file = A._[0];
if (!file) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*/, '').replace(/^ \* ?/gm, '')); process.exit(1); }
const out = A.out || path.dirname(file), name = A.name || path.basename(file).replace(/\.\w+$/, '').replace(/_(rigged|animated)$/, '');
const frames = +(A.frames || 6);

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 520, height: 640 } });
const errors = [];
wire(page, errors);
await page.goto('file://' + PLAYER);
await page.addStyleTag({ content: '.top,.dock,.hint{display:none!important}' });
await page.evaluate((d) => {
  const bin = Uint8Array.from(atob(d), (c) => c.charCodeAt(0));
  window.RigPlayer.load(bin.buffer, 'model.glb');
  window.RigPlayer.state.playing = false;
  window.addClip = (c) => { c.loop = c.loop !== false; window.RigPlayer.CLIPS.push(c); };
}, toB64(file));
if (A.clips) {
  await page.addScriptTag({ content: fs.readFileSync(A.clips, 'utf8') });
  await page.evaluate(() => { const R = window.RigPlayer; R.load(R.state.model.g.bin.buffer.slice(0), 'model.glb'); R.state.playing = false; }).catch(() => {});
}
const info = await page.evaluate(() => {
  const R = window.RigPlayer, m = R.state.model;
  return { humanoid: !!R.state.human, joints: m.skins.length ? m.skins[0].joints.length : 0,
           clips: [...(R.state.human ? R.CLIPS : []).map((c) => ({ id: c.id, name: c.name, duration: c.duration })),
                   ...m.anims.map((a, i) => ({ id: 'file' + i, name: a.name, duration: a.duration, file: true }))] };
});
if (!info.joints) { console.log('That GLB has no skin — rig it first (rig.mjs).'); process.exit(1); }
if (!info.humanoid) console.log('The skeleton does not use the humanoid bone names, so only the clips inside the file can play.');
const only = A.only ? String(A.only).split(',') : null;
const clips = info.clips.filter((c) => !only || only.includes(c.id) || only.includes(c.name));
console.log('clips: ' + clips.map((c) => `${c.name} (${c.duration.toFixed(2)} s)`).join(', '));

for (const c of clips) {
  const imgs = [], labels = [];
  for (const [view, yaw] of [['3/4', 0.55], ['side', Math.PI / 2]]) {
    for (let f = 0; f < frames; f++) {
      const t = c.duration * f / frames;
      imgs.push(await page.evaluate(([c, t, yaw]) => {
        const R = window.RigPlayer;
        const clip = c.file ? R.state.model.anims[+c.id.slice(4)] : R.CLIPS.find((x) => x.id === c.id);
        R.setClip(clip); R.state.time = t; R.state.cam.yaw = yaw; R.state.cam.pitch = 0.1;
        return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(document.getElementById('gl').toDataURL('image/png')))));
      }, [c, t, yaw]));
      labels.push(`${view} ${t.toFixed(2)}s`);
    }
  }
  const sheet = path.join(out, `${name}_anim_${c.id.replace(/[^\w-]+/g, '_')}.png`);
  await contactSheet(browser, imgs, sheet, { cols: frames, cell: 230, aspect: 1.25, labels });
  console.log(`  ${c.name}: ${sheet}`);
}

if (A.bake) {
  const b64 = await page.evaluate(() => {
    const u = window.RigPlayer.exportWithAnimations(); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const gf = path.join(out, name + '_animated.glb');
  writeB64(gf, b64);
  console.log('wrote ' + gf);
}
if (errors.length) process.exitCode = 1;
await browser.close();
