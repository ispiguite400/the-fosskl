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

const res = await page.evaluate(([target, joints]) => {
  const a = window.SCULPT_APP;
  // one object to rig: join everything (props stay separate pieces, and ride one bone each)
  if (a.scene.objects.length > 1) M.joinAll();
  const o = a.scene.objects[0];
  if (target && o.mesh.liveTris > target) { a.history.runMeshOp(o, 'Decimate', () => o.mesh.decimate(target)); a.afterMeshOp(o); }
  return M.rigWith(joints);
}, [target, joints]);

console.log(`rigged ${res.tris} triangles: ${res.summary.bones} bones, bound in ${(res.ms / 1000).toFixed(1)} s; arms ${res.armAngle.toFixed(0)} deg from hanging` + (res.tpose ? ' (T-pose)' : ''));
if (!res.tpose) console.log('WARNING: this character is not in a T-pose. RULES.md §9: sculpt every character in a T-pose.');
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
const poses = await page.evaluate(() => M.testPoses());
for (const pose of [...poses, 'weights']) {
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
    labels.push((pose === 'weights' ? 'weights' : await page.evaluate((p) => window.SCULPT.Rig.POSES[p].label, pose)) + ' · ' + view);
  }
}
const sheet = path.join(out, name + '_poses.png');
await contactSheet(browser, shots, sheet, { cols: 4, cell: 330, labels });
console.log('rig.mjs makes a full-detail rigged file for checking. For the game, export with ship.mjs (2k-5k triangles, textured).');

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
