#!/usr/bin/env node
/*
 * FORLORN — build a character with Advance Forge, the plugin's own scripts only.
 *
 *   node forlorn/forge/make.mjs <id> [--skin NAME] [--rig] [--ship] [--tris 4500] [--close "..."]
 *
 *   1. forge.mjs build  lib/kit.js <id>/<id>.js   (with `const SKIN = NAME` in front for a skin)
 *        -> renders <scratch>/<id>[_skin]/NAME-sheet.png and close-ups, and the .sculpt
 *        -> the build prints "# JOINTS {...}", saved as forge/<id>/<id>_joints.json
 *   2. --rig   rig.mjs on the full sculpt: the T-pose / arms-down / step / crouch check sheet
 *   3. --ship  ship.mjs: weld, 2,000-5,000 triangles, texture baked from the sculpt, rig,
 *              every clip in lib/clips.js; the game file goes to assets/models/<id>[_skin].glb
 *
 * Every render is copied to forge/<id>/renders/ so the look of every round is kept.
 * The .sculpt stays in the scratch folder (9 MB gzipped each); the build script
 * rebuilds it exactly, so the script and the joints file are what is committed.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const GAME = path.resolve(HERE, '..');
const PLUGIN = path.resolve(GAME, '../tools/advance-forge/skills/advance-forge/scripts');
const SCRATCH = process.env.FORGE_SCRATCH || '/tmp/forlorn-forge';

const argv = process.argv.slice(2);
const id = argv[0];
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
if (!id) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]); process.exit(1); }
const skin = opt('skin', null);
const name = skin && skin !== 'default' ? `${id}_${skin}` : id;
const dir = path.join(HERE, id);
const out = path.join(SCRATCH, name);
const renders = path.join(dir, 'renders');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(renders, { recursive: true });

const run = (script, args) => {
  console.log(`\n$ node ${path.basename(script)} ${args.map((a) => path.isAbsolute(a) ? path.relative(process.cwd(), a) || a : a).join(' ')}`);
  const o = execFileSync('node', [script, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  process.stdout.write(o);
  return o;
};
const keep = (files) => { for (const f of files) if (fs.existsSync(f)) fs.copyFileSync(f, path.join(renders, path.basename(f))); };

const spec = JSON.parse(fs.readFileSync(path.join(dir, 'spec.json'), 'utf8'));
const steps = [...(spec.kits || ['kit.js', 'rbxkit.js']).map((k) => path.join(HERE, 'lib', k)), path.join(dir, id + '.js')];
if (skin && skin !== 'default') {
  const sk = path.join(out, 'skin.js');
  fs.writeFileSync(sk, `const SKIN = ${JSON.stringify(skin)};\n`);
  steps.unshift(sk);
}
const close = opt('close', spec.close || '0.4,0.05,1.6,0.16;0.5,0.08,1.2,0.4;0.6,0.1,0.35,0.4');

if (!opt('no-build', false)) {
  const log = run(path.join(PLUGIN, 'forge.mjs'), ['build', ...steps, '--out', out, '--name', name, '--close', close]);
  const m = log.match(/# JOINTS (\{.*\})/);
  if (!m) throw new Error('the build printed no joints; K.joints(J, attach) must run');
  fs.writeFileSync(path.join(dir, id + '_joints.json'), JSON.stringify(JSON.parse(m[1]), null, 1) + '\n');
  keep(fs.readdirSync(out).filter((f) => f.startsWith(name + '-') && f.endsWith('.png')).map((f) => path.join(out, f)));
}
const joints = path.join(dir, id + '_joints.json');
const sculpt = path.join(out, name + '.sculpt');

if (opt('rig', false)) {
  run(path.join(PLUGIN, 'rig.mjs'), [sculpt, '--out', out, '--joints', joints]);
  keep([path.join(out, name + '_poses.png')]);
}

if (opt('ship', false)) {
  const tris = String(opt('tris', spec.tris || 4000));
  const clips = path.join(out, 'clips.js');
  fs.writeFileSync(clips, `const ROLE = ${JSON.stringify(spec.role || 'survivor')};\n` + fs.readFileSync(path.join(HERE, 'lib', spec.clips || 'clips_r6.js'), 'utf8'));
  run(path.join(PLUGIN, 'ship.mjs'), [sculpt, '--out', out, '--name', name, '--joints', joints, '--tris', tris,
    '--clips', clips, '--texture', String(spec.texture || 1024)]);
  const models = path.join(GAME, 'assets/models');
  fs.mkdirSync(models, { recursive: true });
  fs.copyFileSync(path.join(out, name + '_game.glb'), path.join(models, name + '.glb'));
  keep(['_game-sheet.png', '_game-face.png', '_game_anim_walk.png'].map((s) => path.join(out, name + s)));
  // the game reads this list at boot to know which characters and skins are ready
  const index = fs.readdirSync(models).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)).sort();
  fs.writeFileSync(path.join(models, 'index.json'), JSON.stringify(index) + '\n');
  console.log(`\nin the game: assets/models/${name}.glb`);
}
