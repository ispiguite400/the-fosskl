/*
 * Characters on screen: forged models (Advance Forge GLBs, loaded through its
 * forge-loader) with an animation layer on top.
 *
 *   const view = await makeCharacter('guest1337', 'default')
 *   view.setMove(speed, sprinting, chase, { grounded, vy, injured })
 *                                       idle / walk / run / chase (limping when hurt, falling in the air),
 *                                       cadence matched to speed
 *   view.loop('repair')                 hold a looping pose (repair, heal, stunned, sit, dance ...)
 *   view.once('attack')                 a one-shot over the top, then back to locomotion
 *   view.flash(color)  view.ghost(a)    hit flash; fade to a translucent echo
 *   view.update(dt)
 */
import * as THREE from 'three';
import { buildForgeCharacter } from './forge-loader.js';
import { characterModel, characterGlow } from '../data/characters.js';
import { settings } from '../core/save.js';

const buffers = new Map();       // file -> Promise<ArrayBuffer>
// file -> { mat: Promise<material with the baked texture>, users, timer }: one texture shared by every
// copy of a character, let go KEEP seconds after the last copy goes (and rebuilt if it comes back)
const templates = new Map();
const KEEP = 45;

function fetchBuffer(file) {
  if (!buffers.has(file)) buffers.set(file, fetch(file).then((r) => { if (!r.ok) throw new Error('missing model ' + file); return r.arrayBuffer(); }));
  return buffers.get(file);
}
export function preloadModel(file) { return fetchBuffer(file).catch(() => null); }

/*
 * The character material: the baked texture, a rim of light so silhouettes read at night, a hit
 * flash, and (for characters whose eyes burn) a glow on the brightest, most saturated texels.
 */
function rimMaterial(base, glow = 0) {
  const m = base.clone();
  m.userData.rim = { value: new THREE.Color(0x6d7fa8) };
  m.userData.flash = { value: new THREE.Color(0, 0, 0) };
  m.userData.glow = { value: glow };
  m.onBeforeCompile = (s) => {
    s.uniforms.uRim = m.userData.rim; s.uniforms.uFlash = m.userData.flash; s.uniforms.uGlow = m.userData.glow;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform vec3 uFlash; uniform float uGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rimF = pow(1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0), 3.0);
        totalEmissiveRadiance += uRim * rimF * 0.55 + uFlash;
        if (uGlow > 0.0) {
          float gx = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b), gn = min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
          float gk = smoothstep(0.3, 0.6, gx - gn) * smoothstep(0.08, 0.45, gx);
          totalEmissiveRadiance += diffuseColor.rgb * gk * uGlow;
        }`);
  };
  m.customProgramCacheKey = () => 'forlorn-rim';
  return m;
}

export async function makeCharacter(id, skin = 'default') {
  const file = characterModel(id, skin);
  let buf;
  try { buf = await fetchBuffer(file); } catch (e) { buf = await fetchBuffer(characterModel('guest1337', 'default')); }
  let t = templates.get(file), ch;
  if (!t) {
    // the first copy builds the shared material (a second one arriving meanwhile waits for it)
    t = { mat: null, users: 0, timer: 0 };
    templates.set(file, t);
    ch = buildForgeCharacter(buf.slice(0), THREE, { roughness: 0.62, metalness: 0.02 });
    t.mat = ch.ready.then(() => { const m = ch.mesh.material; shrinkTexture(m); m.emissive = new THREE.Color(0x101014); return m; });
    ch.mesh.material = rimMaterial(await t.mat, characterGlow(id));
  } else {
    ch = buildForgeCharacter(buf.slice(0), THREE, { material: rimMaterial(await t.mat, characterGlow(id)) });
  }
  t.users++; clearTimeout(t.timer);
  const view = new CharacterView(ch, id);
  view.onDispose = () => release(file, t);
  return view;
}
function release(file, t) {
  if (--t.users > 0) return;
  clearTimeout(t.timer);
  t.timer = setTimeout(() => {
    if (t.users > 0 || templates.get(file) !== t) return;
    templates.delete(file);
    t.mat.then((m) => { if (m.map) m.map.dispose(); m.dispose(); });
  }, KEEP * 1000);
}

/* On the lighter settings a character's 2048 texture is cut down when it loads (phones hold a
   dozen characters at once). */
const TEX_MAX = { low: 512, medium: 1024 };
function shrinkTexture(mat) {
  const max = TEX_MAX[settings.quality], img = mat.map && mat.map.image;
  if (!max || !img || !img.width || img.width <= max) return;
  const c = document.createElement('canvas'); c.width = c.height = max;
  c.getContext('2d').drawImage(img, 0, 0, max, max);
  const t = new THREE.CanvasTexture(c);
  t.flipY = mat.map.flipY; t.colorSpace = mat.map.colorSpace; t.anisotropy = 2;
  if (img.close) img.close();
  mat.map.dispose(); mat.map = t; mat.needsUpdate = true;
}

/* how fast each locomotion clip travels at a time scale of 1 (forge/lib/clips_r6.js); the clip plays
   at the real speed's share of it, so feet keep pace with the ground */
const NATURAL = { walk: 2.7, run: 5.7, chase: 6.2, limp: 2.2, hurtrun: 5.2 };
const LOCO = new Set(['idle', 'walk', 'run', 'chase', 'limp', 'hurtidle', 'hurtrun']);
// one-shots that are all arms: on the move they play on the upper body and the legs keep going
const UPPER_SHOTS = new Set(['attack', 'slash', 'throw', 'cast', 'shoot', 'point', 'wave', 'block', 'cheer']);
const UPPER_BONES = ['Spine', 'Chest', 'Neck', 'Head', 'Shoulder.L', 'Shoulder.R', 'UpperArm.L', 'UpperArm.R', 'LowerArm.L', 'LowerArm.R', 'Hand.L', 'Hand.R'];
// a clip a character's file may not have yet falls back to its nearest
const FALLBACK = { limp: 'walk', hurtidle: 'idle', hurtrun: 'run', chase: 'run', fall: 'idle', jump: 'idle' };
const key = (name) => String(name).toLowerCase().replace(/\s+/g, '');
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/*
 * The animation layers, with weights that always add up to one (the mixer averages anything else,
 * which is how a swing ends up at half strength over a walk):
 *   base   locomotion (idle / walk / run / chase, limping when hurt, falling in the air) or a held
 *          loop (repair, stunned ...); a change of base cross-fades, and walk <-> run keep their step
 *   shot   a one-shot over the base: whole-body, or upper-body only while moving (the base's legs
 *          then come from a legs-only copy of the same clip, in step)
 * On top: the body banks into turns, and the head turns to what it looks at.
 */
export class CharacterView {
  constructor(ch, id) {
    this.id = id;
    this.ch = ch;
    this.root = new THREE.Group();
    this.tilt = new THREE.Group();            // banking into turns
    this.root.add(this.tilt);
    this.tilt.add(ch.root);
    this.mesh = ch.mesh;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mixer = ch.mixer;
    this.clips = {};
    for (const c of ch.clips) this.clips[key(c.name)] = c;
    this.actions = {};                        // per clip: the whole, and its one-shot, upper and lower copies (made when first needed)
    this.upperIds = new Set(UPPER_BONES.map((n) => ch.bones[n]).filter(Boolean).map((b) => b.uuid));
    this.base = null;                         // { key, full, lower, w }
    this.fading = [];                         // bases fading out
    this.override = null; this.overrideName = '';
    this.shot = null;                         // { key, act, upper, w, left, hold, out }
    this.shotName = '';
    this.speed = 0; this.sprint = false; this.chase = false; this.injured = false;
    this.airT = 0; this.grounded = true; this.vy = 0;
    this.bank = 0; this._yaw = null;
    this.flashT = 0; this.flashColor = new THREE.Color();
    this.headYaw = 0; this.headPitch = 0;
    this.height = ch.height;
    this.head = ch.bones['Head'];
    this.hands = { L: ch.bones['Hand.L'], R: ch.bones['Hand.R'] };
    this._setBase('idle', 0);
  }
  has(name) { return !!this.clips[key(name)]; }
  _resolve(name) { let k = key(name); while (!this.clips[k] && FALLBACK[k]) k = FALLBACK[k]; return this.clips[k] ? k : null; }
  /** A clip's action: whole (the base), or a copy for a one-shot ('shot'), its arms and head ('upper') or the rest ('lower'). */
  _action(k, part) {
    const id = part ? k + ':' + part : k;
    if (this.actions[id]) return this.actions[id];
    let clip = this.clips[k];
    if (part) {
      const tracks = part === 'shot' ? clip.tracks : clip.tracks.filter((t) => this.upperIds.has(t.name.split('.')[0]) === (part === 'upper'));
      clip = new THREE.AnimationClip(clip.name + ':' + part, clip.duration, tracks);
    }
    const a = this.mixer.clipAction(clip);
    a.setEffectiveWeight(0);
    return (this.actions[id] = a);
  }
  /** Change the base clip: cross-fade, and keep the step when going between walk, run and their kin. */
  _setBase(name, fade = 0.2) {
    const k = this._resolve(name); if (!k) return null;
    const b = this.base;
    if (b && b.key === k) return b;
    let nb;
    const i = this.fading.findIndex((f) => f.key === k);
    if (i >= 0) { nb = this.fading.splice(i, 1)[0]; nb.fadeT = fade; }          // still fading out: pick it up where it is
    else {
      const full = this._action(k);
      const once = k === 'jump';
      full.reset(); full.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); full.clampWhenFinished = once; full.timeScale = 1;
      const stepping = (x) => LOCO.has(x) && x !== 'idle' && x !== 'hurtidle';
      if (b && stepping(b.key) && stepping(k)) { const d0 = b.full.getClip().duration, d1 = full.getClip().duration; full.time = ((b.full.time % d0) / d0) * d1; }
      full.play();
      nb = { key: k, full, lower: null, w: 0, fadeT: fade };
    }
    if (b) { b.fadeT = fade; this.fading.push(b); }
    if (!b || fade <= 0) { for (const f of this.fading) this._stopBase(f); this.fading = []; nb.w = 1; }
    this.base = nb;
    return nb;
  }
  _stopBase(b) { b.full.stop(); b.full.setEffectiveWeight(0); if (b.lower) { b.lower.stop(); b.lower.setEffectiveWeight(0); } }
  /**
   * Locomotion from ground speed (m/s), and how the body is: in the air, hurt.
   * state: { grounded, vy, injured }
   */
  setMove(speed, sprinting, chase, state = {}) {
    this.speed = speed; this.sprint = sprinting; this.chase = !!chase;
    this.injured = !!state.injured;
    const grounded = state.grounded !== false;
    this.grounded = grounded;                 // update() counts the time in the air
    if (grounded && this.airT > 0) {
      if (this.airT > 0.3 && speed < 2.5 && !this.override && this.has('land')) this.once('land');
      this.airT = 0;
    }
    if (this.override) return;
    let name = this.injured ? 'hurtidle' : 'idle', ts = 1;
    if (!grounded && this.airT > 0.12) name = (state.vy || 0) > 1.5 ? 'jump' : 'fall';
    else if (speed > 0.25) {
      if (speed > 4.6 || sprinting) name = this.injured ? 'hurtrun' : chase ? 'chase' : 'run';
      else name = this.injured ? 'limp' : 'walk';
      ts = speed / NATURAL[name];
    }
    const b = this._setBase(name, name === 'jump' ? 0.08 : 0.18);
    if (b && LOCO.has(b.key) && b.key !== 'idle' && b.key !== 'hurtidle') b.full.timeScale = Math.max(0.55, Math.min(1.8, ts));
  }
  /** Hold a looping pose until clear() (repair, heal, stunned, scared, sit, dance, lifted, block). */
  loop(name) {
    if (this.overrideName === name) return;
    if (!this._resolve(name)) return;
    this.override = true; this.overrideName = name;
    if (this.shot && !this.shot.hold && (name === 'stunned' || name === 'lifted')) this.shot.out = true;   // knocked out of a swing
    this._setBase(name, 0.2);
  }
  clear() {
    if (!this.override) return;
    this.override = null; this.overrideName = '';
    this.setMove(this.speed, this.sprint, this.chase, { injured: this.injured });
  }
  /** A one-shot over everything, then back. Returns its duration in seconds. */
  once(name, { speed = 1, hold = false } = {}) {
    const k = this._resolve(name); if (!k || k === 'idle') return 0;
    const upper = UPPER_SHOTS.has(k) && !hold && this.speed > 1.2 && !this.override;
    const act = this._action(k, upper ? 'upper' : 'shot');
    const prev = this.shot;
    if (prev && prev.act !== act) { prev.act.stop(); prev.act.setEffectiveWeight(0); }
    act.reset(); act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; act.timeScale = speed; act.play();
    const d = act.getClip().duration / speed;
    this.shot = { key: k, act, upper, w: prev ? prev.w : 0, left: d, hold, out: false };
    this.shotName = k;
    return d;
  }
  /** The death fall: plays once and stays down. */
  die() { this.override = null; this.overrideName = ''; this.once('death', { hold: true }); }
  flash(color = 0xff2a2a, t = 0.18) { this.flashT = t; this.flashT0 = t; this.flashColor.set(color); }
  rim(color) { this.mesh.material.userData.rim.value.set(color); }
  ghost(alpha) {
    const m = this.mesh.material;
    m.transparent = alpha < 1; m.opacity = alpha; m.depthWrite = alpha >= 1;
    this.mesh.castShadow = alpha > 0.6;
  }
  setVisible(v) { this.root.visible = v; }
  /** Show through walls in a flat colour (revealed, bonded), or null to stop. */
  setXray(color) {
    if (color === null || color === undefined) { if (this.xr) this.xr.visible = false; return; }
    if (!this.xr) {
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, depthTest: false, depthWrite: false, fog: false });
      const x = new THREE.SkinnedMesh(this.mesh.geometry, m);
      x.bind(this.mesh.skeleton, this.mesh.bindMatrix);
      x.position.copy(this.mesh.position); x.quaternion.copy(this.mesh.quaternion); x.scale.copy(this.mesh.scale);
      x.renderOrder = 10; x.frustumCulled = false; x.castShadow = false;
      this.mesh.parent.add(x);
      this.xr = x;
    }
    this.xr.material.color.setHex(color); this.xr.visible = true;
  }
  headWorld(out = new THREE.Vector3()) { (this.head || this.root).getWorldPosition(out); out.y += 0.35; return out; }
  handWorld(side = 'R', out = new THREE.Vector3()) { const b = this.hands[side]; if (b) b.getWorldPosition(out); else this.root.getWorldPosition(out).y += 1; return out; }
  update(dt) {
    if (!this.grounded) this.airT += dt;
    // the shot: in fast, out a little slower; a held one (death) stays
    const sh = this.shot;
    if (sh) {
      sh.left -= dt;
      if (sh.left <= 0.15 && !sh.hold) sh.out = true;
      sh.w = sh.out ? sh.w - dt / 0.15 : Math.min(1, sh.w + dt / 0.06);
      if (sh.out && sh.w <= 0) { sh.act.stop(); sh.act.setEffectiveWeight(0); this.shot = null; this.shotName = ''; }
    }
    const S = this.shot ? Math.max(0, Math.min(1, this.shot.w)) : 0, upper = this.shot && this.shot.upper;
    // the bases: the current one fades in as the old ones fade out, together always one
    const b = this.base;
    if (b && b.w < 1) b.w = Math.min(1, b.w + dt / Math.max(0.01, b.fadeT || 0.2));
    for (const f of this.fading) f.w -= dt / Math.max(0.01, f.fadeT || 0.2);
    this.fading = this.fading.filter((f) => f.w > 0 || (this._stopBase(f), false));
    const all = b ? [b, ...this.fading] : this.fading;
    const sum = all.reduce((n, x) => n + Math.max(0, x.w), 0) || 1;
    for (const x of all) {
      const w = Math.max(0, x.w) / sum;
      x.full.setEffectiveWeight(w * (1 - S));
      if (upper) {
        if (!x.lower) { x.lower = this._action(x.key, 'lower'); x.lower.setLoop(x.full.loop, Infinity); x.lower.play(); }
        x.lower.time = x.full.time; x.lower.timeScale = x.full.timeScale;
        x.lower.setEffectiveWeight(w * S);
      } else if (x.lower) x.lower.setEffectiveWeight(0);
    }
    if (this.shot) this.shot.act.setEffectiveWeight(S);
    this.mixer.update(dt);
    // lean into turns at speed
    const yaw = this.root.rotation.y;
    if (this._yaw === null) this._yaw = yaw;
    const rate = dt > 0 ? wrapAngle(yaw - this._yaw) / dt : 0;
    this._yaw = yaw;
    const want = this.speed > 1.5 && !this.override ? Math.max(-0.17, Math.min(0.17, -rate * this.speed * 0.011)) : 0;
    this.bank += (want - this.bank) * Math.min(1, dt * 7);
    this.tilt.rotation.z = this.bank;
    // turn the head toward what it is looking at (after the clip has posed it)
    if (this.head && (this.headYaw || this.headPitch)) {
      this.head.rotation.y += this.headYaw;
      this.head.rotation.x += this.headPitch;
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / this.flashT0);
      this.mesh.material.userData.flash.value.copy(this.flashColor).multiplyScalar(k * 0.8);
    } else this.mesh.material.userData.flash.value.setRGB(0, 0, 0);
  }
  dispose() {
    this.root.removeFromParent(); this.mesh.material.dispose(); if (this.xr) this.xr.material.dispose();
    if (this.onDispose) { const f = this.onDispose; this.onDispose = null; f(); }   // the shared texture may go too
  }
}
