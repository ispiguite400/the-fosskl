/*
 * Curfew (Bacon City's event): the Wall's searchlights swing down into the streets. Anyone a beam
 * finds out in the open is reported to the killer; a roof over your head keeps you hidden.
 * The beams wander from one open street spot to the next for the event's length, then go dark.
 */
import * as THREE from 'three';
import { audio } from '../audio/audio.js';
import { settings } from '../core/save.js';
import { bus } from '../core/events.js';
import { R, dist } from '../core/util.js';

const RADIUS = 3.4, UP = new THREE.Vector3(0, 1, 0);
let poolTex = null;
function poolTexture() {
  if (poolTex) return poolTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return (poolTex = new THREE.CanvasTexture(c));
}

export class Curfew {
  constructor(M, ev) {
    this.M = M; this.left = ev.dur || 40; this.fade = 0;
    const w = M.world;
    this.streets = (w.spots.streets || []).filter(([x, z]) => w.nav.walkable(x, z) && !w.collision.roofed(x, z));
    if (!this.streets.length) this.streets = [[0, 0]];
    const towers = (w.spots.searchlights || []).slice();
    // the towers nearest the survivors light up first
    const S = M.survivorsAlive();
    const heat = (t) => S.reduce((m, s) => Math.min(m, dist(t[0], t[2], s.x, s.z)), 1e9);
    towers.sort((a, b) => heat(a) - heat(b));
    this.beams = towers.slice(0, ev.beams || 5).map((o, i) => this._beam(o, i));
    this.caught = new Map();
    this.announce();
    for (const s of S) if (s.brain && R() < 0.25) M.later(1 + R() * 3, () => M.botSay(s, 'curfew'));
  }
  _beam([ox, oy, oz], i) {
    const scene = this.M.world.scene;
    const geo = new THREE.CylinderGeometry(RADIUS, 0.35, 1, 28, 1, true); geo.translate(0, 0.5, 0);
    const cone = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    cone.position.set(ox, oy, oz); cone.frustumCulled = false;
    const pool = new THREE.Mesh(new THREE.CircleGeometry(RADIUS * 1.15, 32), new THREE.MeshBasicMaterial({ map: poolTexture(), color: 0xeaf2ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
    pool.rotation.x = -Math.PI / 2;
    scene.add(cone); scene.add(pool);
    const start = this._near(ox, oz, 30);
    const L = { x: start[0], y: 3.2, z: start[1], color: 0xeef4ff, intensity: 12, distance: 11, decay: 1.4, flicker: 0, glow: false };
    this.M.world.lights.push(L);
    return { o: new THREE.Vector3(ox, oy, oz), x: start[0], z: start[1], to: this._near(start[0], start[1], 26), speed: 3.6 + i * 0.35, cone, pool, L, wait: 0 };
  }
  /** A street spot within reach of (x, z), favouring the ones survivors are near. */
  _near(x, z, reach) {
    const S = this.M.survivorsAlive(), opts = this.streets.filter(([a, b]) => dist(a, b, x, z) < reach && dist(a, b, x, z) > 4);
    const list = opts.length ? opts : this.streets;
    if (S.length && R() < 0.45) { const s = R.pick(S); return list.slice().sort((p, q) => dist(p[0], p[1], s.x, s.z) - dist(q[0], q[1], s.x, s.z))[0]; }
    return R.pick(list);
  }
  announce() {
    bus.emit('toast', 'CURFEW IS IN EFFECT. RETURN TO YOUR HOMES.');
    if (!('speechSynthesis' in window) || settings.sfx <= 0) return;
    try {
      const u = new SpeechSynthesisUtterance('Attention. Curfew is now in effect. Return to your homes.');
      u.pitch = 0.2; u.rate = 0.82; u.volume = Math.min(1, settings.master * settings.sfx);
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch { /* no voice: the siren will do */ }
  }
  update(dt) {
    const M = this.M;
    this.left -= dt;
    const on = this.left > 0 && M.phase !== 'end';
    this.fade = Math.max(0, Math.min(1, this.fade + (on ? dt : -dt) * 0.8));
    const tmp = new THREE.Vector3();
    for (const b of this.beams) {
      // drift to the next spot, linger, pick another
      const dx = b.to[0] - b.x, dz = b.to[1] - b.z, d = Math.hypot(dx, dz);
      if (d < 0.3) { b.wait -= dt; if (b.wait <= 0) { b.to = this._near(b.x, b.z, 26); b.wait = 0.6 + R() * 1.6; } }
      else { const s = Math.min(d, b.speed * dt); b.x += dx / d * s; b.z += dz / d * s; }
      tmp.set(b.x, 0, b.z).sub(b.o);
      const L = tmp.length();
      b.cone.quaternion.setFromUnitVectors(UP, tmp.normalize());
      b.cone.scale.set(1, L, 1);
      b.cone.material.opacity = 0.05 * this.fade;
      b.pool.position.set(b.x, 0.06, b.z);
      b.pool.material.opacity = 0.3 * this.fade;
      b.L.x = b.x; b.L.z = b.z; b.L.intensity = 9 * this.fade;
      if (!on) continue;
      for (const s of M.survivorsAlive()) {
        if (dist(s.x, s.z, b.x, b.z) > RADIUS * 0.95 || M.world.collision.roofed(s.x, s.z) || s.fx.has('invis')) continue;
        M.reveal(s, 2.2, 'killer');
        const last = this.caught.get(s) || -99;
        if (M.time - last > 8) {
          M.feed('A searchlight caught ' + s.name, 'bad');
          audio.sfx('trap', { pos: s, vol: 0.6 });
          if (s.isPlayer) { bus.emit('toast', 'CURFEW VIOLATION: the killer knows where you are', s); M.local(s, (x) => x.input.rumble(0.4, 0.2, 200)); }
          if (s.brain && R() < 0.35) M.botSay(s, 'spotted');
        }
        this.caught.set(s, M.time);
      }
    }
    if (!on && this.fade <= 0 && !this.done) { this.done = true; this.dispose(); M.feed('The searchlights go dark', 'info'); }
  }
  dispose() {
    const w = this.M.world;
    for (const b of this.beams) {
      for (const m of [b.cone, b.pool]) { w.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
      const i = w.lights.indexOf(b.L); if (i >= 0) w.lights.splice(i, 1);
    }
    this.beams = [];
  }
}
