#!/usr/bin/env node
/*
 * Advance Forge — rig a model with SculptFree's rigging system.
 *
 *   node rig.mjs MODEL.(sculpt|glb) --out DIR [--name NAME] [--joints joints.json]
 *                [--target TRIS] [--no-centre]
 *
 * Fits the 21-bone humanoid skeleton, places the joints (from --joints if
 * given, otherwise fitted to the model and centred in its limbs), binds, and
 * writes:
 *   DIR/NAME_rigged.glb      skinned glTF, ready for the player and the game
 *   DIR/NAME_joints.json     the joints it used — edit and pass back with --joints
 *   DIR/NAME_poses.png       rest, step, arms up, crouch and the weight colours,
 *                            each from the front and the side, skeleton drawn over
 *
 * joints.json maps bone names to [x, y, z] in metres (feet at y = 0, facing
 * +Z, the character's left is +X, so ".L" bones have x > 0). A bone may also
 * be { "head": [x,y,z], "tail": [x,y,z] } — tails only matter for Head,
 * Hand.* and Toes.*, the bones with no child. Bones you leave out keep their
 * fitted place. ALWAYS pass the skeleton your build script used: the
 * automatic fit is only a bounding-box guess, and loose robes, armour or a
 * big weapon throw it off.
 *
 * "$attach": [{ "at": [x, y, z], "bone": "Hips" }] pins the separate piece
 * nearest that point to one bone, whole. Use it for props the automatic
 * choice gets wrong: a sword worn at the hip that the hanging hand is closer
 * to, a quiver on the back, a hat.
 *
 * Read the pose sheet every time. Stretching between a limb and the body
 * means they were sculpted touching — move the limb out and rebuild; no
 * weight setting fixes geometry that is fused.
 */
import fs from 'fs';
import path from 'path';
import { launch, openApp, loadInto, writeB64, contactSheet, args, PAGE_B64 } from './lib/browser.mjs';

const A = args(process.argv.slice(2));
const file = A._[0];
if (!file) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*/, '').replace(/^ \* ?/gm, '')); process.exit(1); }
const out = A.out || path.dirname(file), name = A.name || path.basename(file).replace(/\.\w+$/, '').replace(/_rigged$/, '');
const target = A.target === undefined ? 60000 : +A.target;
const joints = A.joints ? JSON.parse(fs.readFileSync(A.joints, 'utf8')) : null;

const browser = await launch();
const { page, errors } = await openApp(browser, 700);
await loadInto(page, file);

const res = await page.evaluate(([target, joints, centre]) => {
  const S = window.SCULPT, a = window.SCULPT_APP;
  // one object to rig: join everything (props stay separate pieces, and ride one bone each)
  if (a.scene.objects.length > 1) M.joinAll();
  const o = a.scene.objects[0];
  a.scene.selected = 0;
  if (target && o.mesh.liveTris > target) { a.history.runMeshOp(o, 'Decimate', () => o.mesh.decimate(target)); a.afterMeshOp(o); }
  a.rigAddHumanoid();
  const sk = a.rig.skeleton;
  if (joints) {
    for (const b of sk.bones) {
      const j = joints[b.name];
      if (!j || b.name[0] === '$') continue;
      if (Array.isArray(j)) b.head = j.slice(); else { if (j.head) b.head = j.head.slice(); if (j.tail) b.tail = j.tail.slice(); }
    }
  } else if (!centre) { /* keep the template fit */ }
  const t0 = performance.now();
  a.rig.binding = S.Rig.computeWeights(o.mesh, o.matrix(), sk, {});
  const ms = performance.now() - t0;
  // "$attach": pin a separate piece (found by a point on or near it) to a named bone, whole
  const attached = [];
  for (const at of (joints && joints.$attach) || []) {
    const bi = sk.bones.findIndex((b) => b.name === at.bone);
    if (bi < 0) { attached.push('unknown bone ' + at.bone); continue; }
    const m = o.mesh, P = m.positions.array, n = m.vertCount(), dead = m.vertDead.array, lab = S.Rig.components(m).label;
    let best = -1, bd = Infinity;
    for (let v = 0; v < n; v++) { if (dead[v]) continue; const d = (P[v*3]-at.at[0])**2 + (P[v*3+1]-at.at[1])**2 + (P[v*3+2]-at.at[2])**2; if (d < bd) { bd = d; best = v; } }
    if (best < 0) continue;
    let count = 0;
    for (let v = 0; v < n; v++) if (!dead[v] && lab[v] === lab[best]) {
      for (let k = 0; k < 4; k++) { a.rig.binding.joints[v * 4 + k] = k ? 0 : bi; a.rig.binding.weights[v * 4 + k] = k ? 0 : 1; }
      count++;
    }
    attached.push(`${count} verts near [${at.at.join(', ')}] -> ${at.bone}` + (Math.sqrt(bd) > 0.05 ? ' (WARNING: nearest vertex is ' + Math.sqrt(bd).toFixed(3) + ' m away)' : ''));
  }
  // how much of the body each bone carries, and anything suspicious
  const m = o.mesh, n = m.vertCount(), dead = m.vertDead.array, J = a.rig.binding.joints, count = {};
  for (let v = 0; v < n; v++) if (!dead[v]) { const bn = sk.bones[J[v * 4]].name; count[bn] = (count[bn] || 0) + 1; }
  const used = {};
  for (const b of sk.bones) used[b.name] = b.tail ? { head: b.head.map((x) => +x.toFixed(4)), tail: b.tail.map((x) => +x.toFixed(4)) } : b.head.map((x) => +x.toFixed(4));
  if (joints && joints.$attach) used.$attach = joints.$attach;
  return { tris: o.mesh.liveTris, ms, summary: a.rig.binding.summary, count, used, attached };
}, [target, joints, A['no-centre'] ? false : true]);

console.log(`rigged ${res.tris} triangles: ${res.summary.bones} bones, bound in ${(res.ms / 1000).toFixed(1)} s`);
const rigid = res.summary.rigid.filter((r) => r.verts > 30);
if (rigid.length) console.log('rigid pieces (ride one bone whole):\n  ' + rigid.map((r) => `${r.verts} verts -> ${r.bone}`).join('\n  '));
if (res.attached.length) console.log('attached:\n  ' + res.attached.join('\n  '));
if (res.summary.skinnedPieces) console.log(`${res.summary.skinnedPieces} separate piece(s) contain joints and are skinned like the body`);
const empty = Object.keys(res.used).filter((b) => b[0] !== '$' && !res.count[b] && !/^(Shoulder|Toes)/.test(b));
if (empty.length) console.log('WARNING: bones that own no vertices (a joint is probably outside the body): ' + empty.join(', '));
fs.mkdirSync(out, { recursive: true });
const jf = path.join(out, name + '_joints.json');
fs.writeFileSync(jf, JSON.stringify(res.used, null, 1));

// the pose sheet: each test pose from the front and the side, with the skeleton overlay
const shots = [], labels = [];
for (const pose of ['rest', 'step', 'reach', 'crouch', 'weights']) {
  for (const [view, yaw] of [['front', 0.35], ['side', Math.PI / 2]]) {
    await page.evaluate(([pose, yaw]) => {
      const a = window.SCULPT_APP, S = window.SCULPT;
      a._sheetIsRig = true;
      if (pose === 'weights') { a.rigRest(); a.rigShowWeights(true); } else { a.rigShowWeights(false); a.rigPose(pose); }
      const mn = S.V3.create(0, 0, 0), mx = S.V3.create(0, 0, 0); a.scene.bounds(mn, mx);
      const h = mx[1] - mn[1];
      a.camera.ortho = false; a.camera.yaw = yaw; a.camera.pitch = 0.08; a.camera._goal = null;
      a.camera.target.set([(mn[0] + mx[0]) / 2, mn[1] + h * 0.47, (mn[2] + mx[2]) / 2]); a.camera.distance = h * 1.85; a.camera.update();
      a.needsRender = true; a.draw();
    }, [pose, yaw]);
    await page.waitForTimeout(120);
    shots.push('data:image/png;base64,' + (await page.screenshot()).toString('base64'));
    labels.push(pose === 'reach' ? 'arms up · ' + view : pose + ' · ' + view);
  }
}
const sheet = path.join(out, name + '_poses.png');
await contactSheet(browser, shots, sheet, { cols: 4, cell: 330, labels });

const glb = await page.evaluate(async (B64) => {
  const toB64 = eval(B64), a = window.SCULPT_APP;
  a.rigRest();
  const opts = Object.assign(a.exportOptions(), { includeColors: true });
  return toB64(window.SCULPT.Rig.exportGLB(a.rig.obj, a.rig.skeleton, a.rig.binding, opts));
}, PAGE_B64);
const gf = path.join(out, name + '_rigged.glb');
writeB64(gf, glb);
console.log(`wrote ${gf}\n      ${jf}\n      ${sheet}  <- LOOK AT THIS before moving on`);
if (errors.length) process.exitCode = 1;
await browser.close();
