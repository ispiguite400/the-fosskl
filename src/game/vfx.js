/* Visual effects: hit sparks, blood, wind streaks for the dash, explosions,
 * smoke, teleport shimmer and floating damage numbers.
 *
 * All particles live in one pooled Points cloud per style so the effect layer
 * costs a handful of draw calls no matter how busy the fight gets. */

import * as THREE from 'three';
import { clamp, lerp, makeRNG } from '../core/util.js';

const MAX = 3000;

class Pool {
  constructor(scene, { color, size, blending, gravity, drag, fade }) {
    this.gravity = gravity; this.drag = drag; this.fade = fade;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.alpha = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.scale = new Float32Array(MAX);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aScale', new THREE.BufferAttribute(this.scale, 1));
    geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: size } },
      vertexShader: `
        attribute float aAlpha;
        attribute float aScale;
        uniform float uSize;
        varying vec3 vColor;
        varying float vAlpha;
        void main(){
          vColor = color; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * aScale * (300.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main(){
          // Round, soft-edged point sprite.
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = vAlpha * smoothstep(0.5, 0.12, d);
          gl_FragColor = vec4(vColor, a);
        }`,
      vertexColors: true, transparent: true, depthWrite: false,
      blending: blending ?? THREE.AdditiveBlending
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 900;
    scene.add(this.points);
    this.geo = geo;
    this.count = 0;
    this.head = 0;
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, life, scale) {
    const i = this.head;
    this.head = (this.head + 1) % MAX;
    this.count = Math.min(MAX, this.count + 1);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.life[i] = life; this.maxLife[i] = life;
    this.scale[i] = scale;
    this.alpha[i] = 1;
  }

  update(dt) {
    let live = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = clamp(this.life[i] / this.maxLife[i], 0, 1);
      this.alpha[i] = this.fade ? t * t : t;
      this.vel[i * 3 + 1] += this.gravity * dt;
      const d = Math.pow(this.drag, dt * 60);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] *= d; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      live++;
    }
    this.geo.setDrawRange(0, MAX);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aScale.needsUpdate = true;
    return live;
  }

  dispose() {
    this.points.parent?.remove(this.points);
    this.geo.dispose(); this.points.material.dispose();
  }
}

export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.rng = makeRNG(31337);
    this.sparks = new Pool(scene, { color: 0xffffff, size: 26, gravity: -18, drag: .94, fade: true });
    this.blood  = new Pool(scene, { color: 0xff0000, size: 34, gravity: -26, drag: .96, fade: false, blending: THREE.NormalBlending });
    this.smoke  = new Pool(scene, { color: 0x888888, size: 120, gravity: 1.4, drag: .93, fade: false, blending: THREE.NormalBlending });
    this.wind   = new Pool(scene, { color: 0xcfe8ff, size: 60, gravity: 0, drag: .9, fade: true });
    this.magic  = new Pool(scene, { color: 0xb45cff, size: 44, gravity: -2, drag: .95, fade: true });

    this.numbers = [];
    this.slashes = [];
    this._slashGeo = new THREE.PlaneGeometry(1, 1);
  }

  /* ---------------- one-shots ---------------- */

  hitSpark(pos, normal = new THREE.Vector3(0, 1, 0), metal = false) {
    const n = metal ? 26 : 14;
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(
        this.rng.range(-1, 1), this.rng.range(-.2, 1), this.rng.range(-1, 1)
      ).normalize().multiplyScalar(this.rng.range(3, 11)).add(normal.clone().multiplyScalar(3));
      const c = metal ? [1, .85, .45] : [1, .6, .25];
      this.sparks.spawn(pos.x, pos.y, pos.z, v.x, v.y, v.z, c[0], c[1], c[2],
        this.rng.range(.2, .5), this.rng.range(.4, 1.1));
    }
  }

  bloodBurst(pos, dir) {
    for (let i = 0; i < 22; i++) {
      const v = dir.clone().multiplyScalar(this.rng.range(2, 7)).add(new THREE.Vector3(
        this.rng.range(-2.5, 2.5), this.rng.range(1, 5), this.rng.range(-2.5, 2.5)
      ));
      this.blood.spawn(pos.x, pos.y, pos.z, v.x, v.y, v.z,
        this.rng.range(.35, .62), .03, .03, this.rng.range(.5, 1.1), this.rng.range(.5, 1.4));
    }
  }

  /** Trailing streaks behind the player during a Wind Dash. */
  windTrail(pos, dir, strength = 1) {
    for (let i = 0; i < 5; i++) {
      const off = new THREE.Vector3(
        this.rng.range(-1.4, 1.4), this.rng.range(-1.2, 1.2), this.rng.range(-1.4, 1.4)
      );
      const v = dir.clone().multiplyScalar(-this.rng.range(6, 16) * strength).add(off);
      this.wind.spawn(pos.x + off.x, pos.y + off.y, pos.z + off.z, v.x, v.y, v.z,
        .78, .92, 1, this.rng.range(.18, .45), this.rng.range(.6, 2.2));
    }
  }

  /** Expanding ring of wind at the moment of the dash. */
  windBurst(pos, dir) {
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2;
      const perp = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      perp.applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2 * 0);
      const v = perp.multiplyScalar(this.rng.range(8, 20))
        .add(dir.clone().multiplyScalar(this.rng.range(-3, 3)));
      this.wind.spawn(pos.x, pos.y, pos.z, v.x, v.y + this.rng.range(-2, 5), v.z,
        .82, .94, 1, this.rng.range(.35, .7), this.rng.range(1, 2.6));
    }
  }

  explosion(pos, radius = 6, color = [1, .5, .15]) {
    for (let i = 0; i < 120; i++) {
      const v = new THREE.Vector3(
        this.rng.range(-1, 1), this.rng.range(-.4, 1), this.rng.range(-1, 1)
      ).normalize().multiplyScalar(this.rng.range(4, radius * 3.4));
      this.sparks.spawn(pos.x, pos.y, pos.z, v.x, v.y, v.z,
        color[0], color[1], color[2], this.rng.range(.35, .95), this.rng.range(1, 3));
    }
    for (let i = 0; i < 44; i++) {
      const v = new THREE.Vector3(
        this.rng.range(-1, 1), this.rng.range(0, 1), this.rng.range(-1, 1)
      ).multiplyScalar(this.rng.range(2, 8));
      this.smoke.spawn(pos.x, pos.y + 1, pos.z, v.x, v.y, v.z,
        .22, .2, .19, this.rng.range(1.2, 2.6), this.rng.range(2, 5));
    }
    const flash = new THREE.PointLight(new THREE.Color(color[0], color[1], color[2]), 30, radius * 6, 2);
    flash.position.copy(pos);
    this.scene.add(flash);
    this._fadeLight(flash, .35);
  }

  smokeCloud(pos, radius = 8) {
    for (let i = 0; i < 160; i++) {
      const a = this.rng() * 6.28, r = this.rng() * radius;
      const v = new THREE.Vector3(Math.cos(a) * r * .4, this.rng.range(.4, 2.4), Math.sin(a) * r * .4);
      this.smoke.spawn(pos.x + Math.cos(a) * r * .3, pos.y + this.rng.range(0, 2), pos.z + Math.sin(a) * r * .3,
        v.x, v.y, v.z, .55, .55, .58, this.rng.range(3, 6), this.rng.range(3, 7));
    }
  }

  magicBurst(pos, color = [.7, .35, 1], n = 60) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(
        this.rng.range(-1, 1), this.rng.range(-1, 1), this.rng.range(-1, 1)
      ).normalize().multiplyScalar(this.rng.range(2, 12));
      this.magic.spawn(pos.x, pos.y, pos.z, v.x, v.y, v.z,
        color[0], color[1], color[2], this.rng.range(.4, 1.1), this.rng.range(.8, 2.4));
    }
  }

  teleportFlash(pos) {
    this.magicBurst(pos, [.72, .4, 1], 110);
    const l = new THREE.PointLight(0xb45cff, 24, 30, 2);
    l.position.copy(pos); this.scene.add(l);
    this._fadeLight(l, .5);
  }

  levelUp(pos) {
    for (let i = 0; i < 130; i++) {
      const a = this.rng() * 6.28, r = this.rng.range(.4, 2.2);
      this.magic.spawn(pos.x + Math.cos(a) * r, pos.y, pos.z + Math.sin(a) * r,
        Math.cos(a) * .6, this.rng.range(5, 13), Math.sin(a) * .6,
        1, .78, .35, this.rng.range(.9, 1.8), this.rng.range(1, 2.6));
    }
  }

  /** Sweeping crescent that follows a melee swing. */
  slash(pos, quat, scale = 1, color = 0xffffff) {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: .8, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    const m = new THREE.Mesh(this._slashGeo, mat);
    m.position.copy(pos);
    m.quaternion.copy(quat);
    m.scale.setScalar(scale);
    m.renderOrder = 950;
    this.scene.add(m);
    this.slashes.push({ mesh: m, t: 0, life: .22, scale });
  }

  _fadeLight(light, time) {
    const start = light.intensity;
    const t0 = performance.now();
    const step = () => {
      const t = (performance.now() - t0) / (time * 1000);
      if (t >= 1) { this.scene.remove(light); return; }
      light.intensity = start * (1 - t);
      requestAnimationFrame(step);
    };
    step();
  }

  /* ---------------- floating damage numbers ---------------- */
  damageNumber(pos, amount, kind = 'normal') {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    const colors = { normal: '#ffffff', crit: '#ff8a2b', block: '#8fbfe0', heal: '#6fe08a', boss: '#ff4a3a' };
    ctx.font = `bold ${kind === 'crit' ? 76 : 58}px Cinzel, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,.85)';
    const text = kind === 'block' ? 'BLOCKED' : Math.round(amount).toString();
    ctx.strokeText(text, 128, 64);
    ctx.fillStyle = colors[kind] || '#fff';
    ctx.fillText(text, 128, 64);

    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false
    }));
    spr.position.copy(pos);
    spr.scale.set(2.2, 1.1, 1);
    spr.renderOrder = 999;
    this.scene.add(spr);
    this.numbers.push({
      spr, t: 0, life: 1.15,
      vel: new THREE.Vector3((Math.random() - .5) * 1.4, 3.4, (Math.random() - .5) * 1.4)
    });
  }

  /* ---------------- per-frame ---------------- */
  update(dt, camera) {
    this.sparks.update(dt);
    this.blood.update(dt);
    this.smoke.update(dt);
    this.wind.update(dt);
    this.magic.update(dt);

    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.t += dt;
      n.vel.y -= 5.5 * dt;
      n.spr.position.addScaledVector(n.vel, dt);
      const k = clamp(1 - n.t / n.life, 0, 1);
      n.spr.material.opacity = k * k;
      n.spr.scale.set(2.2 * (1 + (1 - k) * .3), 1.1 * (1 + (1 - k) * .3), 1);
      if (n.t >= n.life) {
        this.scene.remove(n.spr);
        n.spr.material.map.dispose(); n.spr.material.dispose();
        this.numbers.splice(i, 1);
      }
    }

    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      s.t += dt;
      const k = clamp(1 - s.t / s.life, 0, 1);
      s.mesh.material.opacity = k * .85;
      s.mesh.scale.setScalar(s.scale * (1 + (1 - k) * .8));
      if (s.t >= s.life) {
        this.scene.remove(s.mesh);
        s.mesh.material.dispose();
        this.slashes.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const p of [this.sparks, this.blood, this.smoke, this.wind, this.magic]) p.dispose();
    for (const n of this.numbers) { this.scene.remove(n.spr); n.spr.material.map.dispose(); n.spr.material.dispose(); }
    for (const s of this.slashes) { this.scene.remove(s.mesh); s.mesh.material.dispose(); }
    this.numbers.length = 0; this.slashes.length = 0;
    this._slashGeo.dispose();
  }
}
