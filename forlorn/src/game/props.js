/*
 * Round props: generators (the survivors' objective) and items lying on the ground.
 * Scenery, so built from primitives here; characters are never built this way.
 *
 * A generator needs PARTS puzzles. The player solves them (ui/puzzle.js); bots work at a rate.
 */
import * as THREE from 'three';

export const PARTS = 4;

const MAT = {};
const mat = (k, o) => MAT[k] || (MAT[k] = new THREE.MeshStandardMaterial(o));

export class Generator {
  constructor(scene, x, z, ry, index) {
    this.x = x; this.z = z; this.ry = ry; this.index = index;
    this.progress = 0;                 // 0..PARTS
    this.done = false;
    this.users = new Set();
    this.noise = 0;
    this.blocked = 0;                  // the killer kicked it: no work until this runs out
    const g = this.group = new THREE.Group();
    const body = mat('genBody', { color: 0x9a8a3a, roughness: 0.55, metalness: 0.4 });
    const dark = mat('genDark', { color: 0x222226, roughness: 0.6, metalness: 0.6 });
    const steel = mat('genSteel', { color: 0x8a8d92, roughness: 0.35, metalness: 0.85 });
    const add = (geo, m, x0, y0, z0, rx = 0, ry0 = 0, rz = 0) => { const me = new THREE.Mesh(geo, m); me.position.set(x0, y0, z0); me.rotation.set(rx, ry0, rz); me.castShadow = true; me.receiveShadow = true; g.add(me); return me; };
    add(new THREE.BoxGeometry(1.7, 0.16, 1.0), dark, 0, 0.08, 0);                       // skid
    add(new THREE.BoxGeometry(1.5, 0.85, 0.85), body, 0, 0.6, 0);                         // body
    add(new THREE.BoxGeometry(1.52, 0.08, 0.87), dark, 0, 1.06, 0);
    add(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 14), steel, -0.35, 1.32, 0, 0, 0, Math.PI / 2);   // tank
    add(new THREE.CylinderGeometry(0.08, 0.08, 0.7, 8), dark, 0.55, 1.4, -0.2);                        // exhaust
    add(new THREE.CylinderGeometry(0.11, 0.08, 0.1, 8), dark, 0.55, 1.78, -0.2);
    for (const sx of [-0.62, 0.62]) add(new THREE.BoxGeometry(0.08, 1.1, 0.08), dark, sx, 0.7, 0.44);  // frame
    add(new THREE.BoxGeometry(1.32, 0.08, 0.08), dark, 0, 1.22, 0.44);
    // the control panel on the front (+z), where survivors work
    const panel = add(new THREE.BoxGeometry(0.7, 0.45, 0.05), mat('genPanel', { color: 0x1a1d22, roughness: 0.4, metalness: 0.3 }), 0.2, 0.7, 0.44);
    void panel;
    this.leds = [];
    for (let i = 0; i < PARTS; i++) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.03), new THREE.MeshBasicMaterial({ color: 0x331111 }));
      led.position.set(-0.05 + i * 0.16, 0.82, 0.475); g.add(led); this.leds.push(led);
    }
    for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 8), steel, 0.02 + i * 0.16, 0.6, 0.475, Math.PI / 2);
    // cables to the ground
    const cable = mat('genCable', { color: 0x111111, roughness: 0.8 });
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.75, 0.5, 0.2), new THREE.Vector3(-1.1, 0.25, 0.4), new THREE.Vector3(-1.4, 0.03, 0.9), new THREE.Vector3(-2.0, 0.03, 1.3)]);
    add(new THREE.TubeGeometry(curve, 16, 0.03, 5, false), cable, 0, 0, 0);
    // the lamp on top: red while dead, green when running
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), this.lampMat);
    this.lamp.position.set(0.4, 1.2, -0.25); g.add(this.lamp);
    const glowTex = glow();
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff2020, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    this.glow.scale.setScalar(0.9); this.glow.position.copy(this.lamp.position); g.add(this.glow);
    g.position.set(x, 0, z); g.rotation.y = ry;
    scene.add(g);
    this.t = 0;
  }
  /** Where a survivor stands to work it: in front of the panel, plus a spot each side. */
  spots() {
    const c = Math.cos(this.ry), s = Math.sin(this.ry);
    const P = (lx, lz) => [this.x + lx * c + lz * s, this.z - lx * s + lz * c];
    return [P(0, 1.15), P(-1.35, 0.2), P(1.35, 0.2), P(0, -1.1)];
  }
  /** The yaw that faces the generator from a spot. */
  faceFrom(x, z) { return Math.atan2(this.x - x, this.z - z); }
  get frac() { return this.progress / PARTS; }
  addProgress(p) {
    if (this.done) return false;
    const before = Math.floor(this.progress);
    this.progress = Math.min(PARTS, this.progress + p);
    for (let i = 0; i < PARTS; i++) this.leds[i].material.color.setHex(i < Math.floor(this.progress) ? 0x3dff6a : 0x331111);
    if (this.progress >= PARTS - 1e-6) { this.finish(); return 'done'; }
    return Math.floor(this.progress) > before ? 'part' : false;
  }
  finish() {
    this.done = true; this.progress = PARTS;
    this.lampMat.color.setHex(0x3dff6a); this.glow.material.color.setHex(0x3dff6a); this.glow.scale.setScalar(1.6);
    for (const l of this.leds) l.material.color.setHex(0x3dff6a);
  }
  update(dt) {
    this.t += dt;
    if (this.done) { this.group.children[1].position.y = 0.6 + Math.sin(this.t * 60) * 0.004; this.glow.material.opacity = 0.75 + Math.sin(this.t * 4) * 0.15; }
    else {
      this.glow.material.opacity = this.users.size ? 0.6 + Math.sin(this.t * 10) * 0.3 : 0.5;
      if (this.blocked > 0) { this.blocked -= dt; this.lampMat.color.setHex(Math.sin(this.t * 20) > 0 ? 0xff2020 : 0x220000); }
      else this.lampMat.color.setHex(0xff2020);
    }
    this.noise = Math.max(0, this.noise - dt * 0.5);
  }
  dispose() { this.group.removeFromParent(); }
}

let _glow = null;
function glow() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (_glow = new THREE.CanvasTexture(c));
}

/** An item on the ground: a medkit or a Bloxy Cola, turning slowly, with a glint. */
export class Pickup {
  constructor(scene, x, z, kind) {
    this.x = x; this.z = z; this.kind = kind; this.taken = false;
    const g = this.group = new THREE.Group();
    if (kind === 'medkit') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.22), new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.5 }));
      const red = new THREE.MeshBasicMaterial({ color: 0xd82020 });
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.225), red), c2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.225), red);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 5, 10, Math.PI), new THREE.MeshStandardMaterial({ color: 0x333333 }));
      handle.position.y = 0.16;
      g.add(box, c1, c2, handle);
    } else {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.32, 14), new THREE.MeshStandardMaterial({ color: 0xc81e28, roughness: 0.3, metalness: 0.6 }));
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.102, 0.102, 0.09, 14), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }));
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.03, 14), new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.9, roughness: 0.3 }));
      top.position.y = 0.175;
      g.add(can, band, top);
    }
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: kind === 'medkit' ? 0x9affb0 : 0xff9a9a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
    s.scale.setScalar(1.3); this.glint = s;
    this.root = new THREE.Group(); this.root.add(g, s);
    this.root.position.set(x, 0, z);
    scene.add(this.root);
    this.t = Math.random() * 6;
  }
  update(dt) { this.t += dt; this.group.rotation.y += dt * 1.2; this.group.position.y = 0.45 + Math.sin(this.t * 2) * 0.06; this.glint.position.y = this.group.position.y; }
  take() { this.taken = true; this.root.removeFromParent(); }
  dispose() { this.root.removeFromParent(); }
}
