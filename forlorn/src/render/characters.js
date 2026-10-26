/*
 * Characters on screen: forged models (Advance Forge GLBs, loaded through its
 * forge-loader) with an animation layer on top.
 *
 *   const view = await makeCharacter('guest1337', 'default')
 *   view.setMove(speed, sprinting)      idle / walk / run, cadence matched to speed
 *   view.loop('repair')                 hold a looping pose (repair, heal, stunned, sit, dance ...)
 *   view.once('attack')                 a one-shot over the top, then back to locomotion
 *   view.flash(color)  view.ghost(a)    hit flash; fade to a translucent echo
 *   view.update(dt)
 */
import * as THREE from 'three';
import { buildForgeCharacter } from './forge-loader.js';
import { characterModel } from '../data/characters.js';

const buffers = new Map();       // file -> Promise<ArrayBuffer>
const templates = new Map();     // file -> material with the baked texture, shared by every copy

function fetchBuffer(file) {
  if (!buffers.has(file)) buffers.set(file, fetch(file).then((r) => { if (!r.ok) throw new Error('missing model ' + file); return r.arrayBuffer(); }));
  return buffers.get(file);
}
export function preloadModel(file) { return fetchBuffer(file).catch(() => null); }

function rimMaterial(base) {
  const m = base.clone();
  m.userData.rim = { value: new THREE.Color(0x6d7fa8) };
  m.userData.flash = { value: new THREE.Color(0, 0, 0) };
  m.onBeforeCompile = (s) => {
    s.uniforms.uRim = m.userData.rim; s.uniforms.uFlash = m.userData.flash;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform vec3 uFlash;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rimF = pow(1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0), 3.0);
        totalEmissiveRadiance += uRim * rimF * 0.55 + uFlash;`);
  };
  m.customProgramCacheKey = () => 'forlorn-rim';
  return m;
}

export async function makeCharacter(id, skin = 'default') {
  const file = characterModel(id, skin);
  let buf;
  try { buf = await fetchBuffer(file); } catch (e) { buf = await fetchBuffer(characterModel('guest1337', 'default')); }
  let tpl = templates.get(file);
  let ch;
  if (!tpl) {
    ch = buildForgeCharacter(buf.slice(0), THREE, { roughness: 0.62, metalness: 0.02 });
    await ch.ready;
    tpl = ch.mesh.material;
    tpl.emissive = new THREE.Color(0x101014);
    templates.set(file, tpl);
    ch.mesh.material = rimMaterial(tpl);
  } else {
    ch = buildForgeCharacter(buf.slice(0), THREE, { material: rimMaterial(tpl) });
  }
  return new CharacterView(ch, id);
}

const LOCO = { idle: 'Idle', walk: 'Walk', run: 'Run', chase: 'Chase' };

export class CharacterView {
  constructor(ch, id) {
    this.id = id;
    this.ch = ch;
    this.root = new THREE.Group();
    this.root.add(ch.root);
    this.mesh = ch.mesh;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mixer = ch.mixer;
    this.actions = {};
    for (const c of ch.clips) this.actions[c.name.toLowerCase()] = this.mixer.clipAction(c);
    this.base = null; this.baseName = '';
    this.override = null; this.overrideName = '';
    this.oneShot = null;
    this.speed = 0; this.sprint = false;
    this.flashT = 0; this.flashColor = new THREE.Color();
    this.headYaw = 0; this.headPitch = 0;
    this.height = ch.height;
    this.head = ch.bones['Head'];
    this.hands = { L: ch.bones['Hand.L'], R: ch.bones['Hand.R'] };
    this._play('idle');
  }
  action(name) { return this.actions[name.toLowerCase()] || null; }
  _play(name, fade = 0.2) {
    const a = this.action(name);
    if (!a || this.base === a) return a;
    a.reset(); a.setEffectiveWeight(1); a.setLoop(THREE.LoopRepeat, Infinity); a.play();
    if (this.base) this.base.crossFadeTo(a, fade, false);
    this.base = a; this.baseName = name;
    return a;
  }
  /** Locomotion from ground speed (m/s). */
  setMove(speed, sprinting, chase) {
    this.speed = speed; this.sprint = sprinting;
    if (this.override) return;
    let name = 'idle', scale = 1;
    if (speed > 0.25) {
      if (speed > 4.6 || sprinting) { name = chase && this.action('chase') ? 'chase' : 'run'; scale = speed / (name === 'chase' ? 5 : 4.6); }
      else { name = 'walk'; scale = speed / 2.0; }
    }
    const a = this._play(name, 0.18);
    if (a) a.timeScale = name === 'idle' ? 1 : Math.max(0.6, Math.min(1.9, scale));
  }
  /** Hold a looping pose until clear() (repair, heal, stunned, scared, sit, dance, lifted, block). */
  loop(name) {
    if (this.overrideName === name) return;
    const a = this.action(name); if (!a) return;
    this.overrideName = name; this.override = a;
    this.base = null;
    for (const k in this.actions) if (this.actions[k] !== a && this.actions[k] !== this.oneShot) this.actions[k].fadeOut(0.2);
    a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.setEffectiveWeight(1); a.fadeIn(0.2); a.play();
  }
  clear() {
    if (!this.override) return;
    this.override.fadeOut(0.2); this.override = null; this.overrideName = '';
    this.base = null; this.setMove(this.speed, this.sprint);
  }
  /** A one-shot over everything, then back. Returns its duration in seconds. */
  once(name, { speed = 1, hold = false } = {}) {
    const a = this.action(name); if (!a) return 0;
    if (this.oneShot && this.oneShot !== a) this.oneShot.fadeOut(0.08);
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = speed; a.setEffectiveWeight(1); a.fadeIn(0.06); a.play();
    this.oneShot = a; this.oneShotHold = hold;
    const d = a.getClip().duration / speed;
    this.oneShotLeft = d;
    return d;
  }
  /** The death fall: plays once and stays down. */
  die() { this.clear(); this.once('death', { hold: true }); }
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
    if (this.oneShot) {
      this.oneShotLeft -= dt;
      if (this.oneShotLeft <= 0 && !this.oneShotHold) { this.oneShot.fadeOut(0.18); this.oneShot = null; }
    }
    this.mixer.update(dt);
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
  dispose() { this.root.removeFromParent(); this.mesh.material.dispose(); if (this.xr) this.xr.material.dispose(); }
}
