#!/usr/bin/env node
/*
 * Advance Forge — ship: the ONLY way to export a model for the game.
 *
 *   node ship.mjs MODEL.sculpt --out DIR [--name NAME] [--tris 4000]
 *                 [--joints joints.json] [--clips my_clips.js] [--static] [--texture 1024]
 *
 * Takes the full-detail sculpt and makes the game file, DIR/NAME_game.glb:
 *
 *   1. welds the character's pieces (body, head, hair, clothing layers)
 *      into ONE closed skin, so no hidden inner layer is left to show
 *      through or to spend triangles on; props listed in the joints file's
 *      "$attach" stay separate pieces, so they stay rigid;
 *   2. reduces it to a triangle count between 2,000 and 5,000
 *      (--tris, default 4000; anything outside is clamped into that range);
 *   3. bakes the full-detail sculpt's colour (paint, pattern, baked shading)
 *      into a texture on the reduced mesh: every texel looks up the
 *      nearest point on the full sculpt ("high to low", as game studios do);
 *   4. for a character: rigs it (the humanoid skeleton from --joints) and
 *      bakes every clip (the built-in ones plus --clips) into the file;
 *      --static skips rigging, for a weapon or a prop;
 *   5. renders what the game will actually show, so you can check it:
 *      DIR/NAME_game-sheet.png, DIR/NAME_game-face.png and, for a
 *      character, DIR/NAME_game_anim_walk.png.
 *
 * The low-poly mesh keeps the look because the detail lives in the texture:
 * every fold, crease, stripe and shadow painted or baked at full resolution
 * is read per texel onto the 2k-5k mesh.
 */
import fs from 'fs';
import path from 'path';
import { launch, openApp, wire, loadInto, writeB64, contactSheet, args, PAGE_B64, PLAYER, toB64, VIEWS } from './lib/browser.mjs';

const MIN_TRIS = 2000, MAX_TRIS = 5000;
const A = args(process.argv.slice(2));
const file = A._[0];
if (!file) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*/, '').replace(/^ \* ?/gm, '')); process.exit(1); }
const out = A.out || path.dirname(file), name = A.name || path.basename(file).replace(/\.\w+$/, '');
let tris = A.tris === undefined ? 4000 : +A.tris;
if (!(tris >= MIN_TRIS && tris <= MAX_TRIS)) {
  const was = tris;
  tris = Math.min(MAX_TRIS, Math.max(MIN_TRIS, tris || 4000));
  console.log(`--tris ${was} is outside ${MIN_TRIS}-${MAX_TRIS}; using ${tris}. Game models are always 2k-5k triangles.`);
}
const texture = +(A.texture || 1024);
const joints = A.joints ? JSON.parse(fs.readFileSync(A.joints, 'utf8')) : null;
const isStatic = !!A.static;
if (!isStatic && !joints) console.log('WARNING: no --joints given, so the skeleton is the automatic fit. Pass the build\'s joints (RULES.md §9).');

const browser = await launch();
const { page, errors } = await openApp(browser, 900);
await loadInto(page, file);

// 1-3 in the app: paint map at full detail, reduce, rig, export
const res = await page.evaluate(async ([tris, texture, joints, isStatic, B64]) => {
  const toB64 = eval(B64), S = window.SCULPT, a = window.SCULPT_APP;
  const before = a.scene.objects.reduce((n, x) => n + x.mesh.liveTris, 0);
  // weld the character into one closed skin (props stay separate), keeping the full detail to bake from
  const propPoints = isStatic ? [] : ((joints && joints.$attach) || []).map((p) => p.at);
  const shell = M.shipShell(propPoints, 0.004);
  const o = a.scene.objects[0];
  a.scene.selected = 0;
  a.history.runMeshOp(o, 'Decimate', () => o.mesh.decimate(tris));
  a.afterMeshOp(o);
  const sampler = M.shipSampler(o.mesh, shell.shell, shell.props, 0.03);
  o.paint = sampler;                              // the texture bake reads colour through this
  const welded = { body: shell.bodyPieces, props: shell.propPieces, tris: shell.tris };
  const after = o.mesh.liveTris;
  let rig = null, data;
  const opts = Object.assign(a.exportOptions(), { includeColors: true, textureSize: texture, unwrap: 'charts' });
  if (isStatic) {
    const build = S.Texture.build;
    S.Texture.build = (g, o2) => build(g, Object.assign({}, o2, { unwrap: 'charts' }));      // every surface owns its pixels
    try { data = S.IO.exportTextured('glb', S.IO.prepare([o], opts), opts).files.find((f) => /\.glb$/.test(f.name)).data; }
    finally { S.Texture.build = build; }
  } else {
    rig = M.rigWith(joints);
    data = S.Rig.exportGLB(o, a.rig.skeleton, a.rig.binding, opts);
  }
  o.paint = null;
  return { before, after, rig, welded, misses: sampler.misses, glb: await toB64(data) };
}, [tris, texture, joints, isStatic, PAGE_B64]);

console.log(`welded ${res.welded.body} piece(s) into one closed skin` + (res.welded.props ? `, kept ${res.welded.props} prop(s) separate` : '') + ` (${res.welded.tris} triangles)`);
console.log(`reduced ${res.before} -> ${res.after} triangles; colour baked from the full sculpt into a ${texture}x${texture} texture` + (res.misses ? ` (${res.misses} texels found no surface)` : ''));
if (res.rig) {
  console.log(`rigged: ${res.rig.summary.bones} bones; arms ${res.rig.armAngle.toFixed(0)} deg from hanging` + (res.rig.tpose ? ' (T-pose)' : ''));
  if (!res.rig.tpose) console.log('WARNING: not a T-pose. RULES.md §9: every character is sculpted in a T-pose.');
  if (res.rig.attached.length) console.log('attached: ' + res.rig.attached.join('; '));
}
fs.mkdirSync(out, { recursive: true });
const gf = path.join(out, name + '_game.glb');
writeB64(gf, res.glb);

// a character gets its clips baked in, by the player
if (!isStatic) {
  const pp = await browser.newPage({ viewport: { width: 520, height: 640 } });
  const perr = [];
  wire(pp, perr);
  await pp.goto('file://' + PLAYER);
  await pp.addStyleTag({ content: '.top,.dock,.hint{display:none!important}' });
  await pp.evaluate((d) => {
    window.addClip = (c) => { c.loop = c.loop !== false; window.RigPlayer.CLIPS.push(c); };
    window.RigPlayer.load(Uint8Array.from(atob(d), (c) => c.charCodeAt(0)).buffer, 'model.glb');
    window.RigPlayer.state.playing = false;
  }, toB64(gf));
  if (A.clips) await pp.addScriptTag({ content: fs.readFileSync(A.clips, 'utf8') });
  await pp.waitForFunction(() => !window.RigPlayer.state.texturesPending, null, { timeout: 15000 }).catch(() => {});
  const info = await pp.evaluate(() => ({ human: !!window.RigPlayer.state.human, conv: !!window.RigPlayer.state.model.conv, clips: window.RigPlayer.CLIPS.map((c) => c.name) }));
  if (info.human) {
    const b64 = await pp.evaluate(() => { const u = window.RigPlayer.exportWithAnimations(); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); });
    writeB64(gf, b64);
    console.log('baked clips: ' + info.clips.join(', ') + (info.conv ? ' (from the T-pose; arms lowered on load)' : ''));
    await previews(pp);
    const frames = [], labels = [];
    for (const [view, yaw] of [['3/4', 0.55], ['side', Math.PI / 2]]) for (let f = 0; f < 5; f++) {
      frames.push(await pp.evaluate(([t, yaw]) => { const R = window.RigPlayer; R.setClip(R.CLIPS.find((c) => c.id === 'walk')); R.state.time = t; R.state.cam.yaw = yaw; R.state.cam.pitch = 0.1;
        return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(document.getElementById('gl').toDataURL('image/png'))))); }, [1.1 * f / 5, yaw]));
      labels.push(`walk ${view} ${(1.1 * f / 5).toFixed(2)}s`);
    }
    await contactSheet(browser, frames, path.join(out, name + '_game_anim_walk.png'), { cols: 5, cell: 230, aspect: 1.25, labels });
  } else { console.log('WARNING: the skeleton is not the humanoid one, so no clips were baked.'); await previews(pp); }
  if (perr.length) process.exitCode = 1;
}

if (isStatic) {
  const pp = await browser.newPage({ viewport: { width: 520, height: 640 } });
  await pp.goto('file://' + PLAYER);
  await pp.addStyleTag({ content: '.top,.dock,.hint{display:none!important}' });
  await pp.evaluate((d) => { window.RigPlayer.load(Uint8Array.from(atob(d), (c) => c.charCodeAt(0)).buffer, 'model.glb'); window.RigPlayer.state.playing = false; }, toB64(gf));
  await pp.waitForFunction(() => !window.RigPlayer.state.texturesPending, null, { timeout: 15000 }).catch(() => {});
  await previews(pp);
}

/*
 * What the game will actually show: the game file itself, with its texture,
 * rendered by the player. The sheet is the rest pose (for a character, arms
 * lowered, exactly as the game loads it); the close-up is the face.
 */
async function previews(pp) {
  await pp.evaluate(() => window.RigPlayer.setClip(null));
  const st = await pp.evaluate(() => { const c = window.RigPlayer.state.cam; return { target: c.target.slice(), dist: c.dist }; });
  const imgs = [];
  for (const [, yaw, pitch] of VIEWS) {
    imgs.push(await pp.evaluate(([yaw, pitch, st]) => { const c = window.RigPlayer.state.cam; c.yaw = yaw; c.pitch = pitch; c.target = st.target.slice(); c.dist = st.dist * 0.95;
      return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(document.getElementById('gl').toDataURL('image/png'))))); }, [yaw, pitch, st]));
  }
  await pp.evaluate((st) => { const c = window.RigPlayer.state.cam; c.target = st.target.slice(); c.dist = st.dist; }, st);
  await contactSheet(browser, imgs, path.join(out, name + '_game-sheet.png'), { cell: 330, aspect: 1.25, labels: VIEWS.map((v) => v[0] + ` · ${res.after} tris`) });
  if (!isStatic) {
    const face = await pp.evaluate(([st]) => { const c = window.RigPlayer.state.cam, h = st.target[1] / 0.4; c.yaw = 0.35; c.pitch = 0.05; c.target = [st.target[0], h * 0.89, st.target[2]]; c.dist = h * 0.5;
      return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(document.getElementById('gl').toDataURL('image/png'))))); }, [st]);
    writeB64(path.join(out, name + '_game-face.png'), face.split(',')[1]);
    await pp.evaluate((st) => { const c = window.RigPlayer.state.cam; c.target = st.target.slice(); c.dist = st.dist; }, st);
  }
}

const kb = Math.round(fs.statSync(gf).size / 1024);
console.log(`wrote ${gf} (${kb} KB, ${res.after} triangles)\n  look at: ${path.join(out, name + '_game-sheet.png')}` + (isStatic ? '' : `, ${name}_game-face.png, ${name}_game_anim_walk.png`));
if (errors.length) process.exitCode = 1;
await browser.close();
