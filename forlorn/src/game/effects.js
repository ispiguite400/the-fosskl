/*
 * Things abilities leave in the world: projectiles, clouds, traps, beams, bursts of sparks.
 *
 *   fx.projectile({ x, y, z, vx, vy, vz, owner, radius, gravity, life, color, size, hits, onHit, onWorld })
 *   fx.zone({ x, z, r, life, color, kind, onTick(actor, dt), onEnter(actor) })
 *   fx.burst(x, y, z, color, n)   fx.ring(x, z, r, color)   fx.beam(a, b, color, jag)
 *   fx.flash(x, y, z, color, intensity, t)   a pooled point light
 */
import * as THREE from 'three';

const _v = new THREE.Vector3();

let sparkTex = null;
function spark() {
  if (sparkTex) return sparkTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (sparkTex = new THREE.CanvasTexture(c));
}
let smokeTex = null;
function smokeT() {
  if (smokeTex) return smokeTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = 64 + (Math.random() - 0.5) * 50, y = 64 + (Math.random() - 0.5) * 50, r = 18 + Math.random() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  return (smokeTex = new THREE.CanvasTexture(c));
}

export class Effects {
  constructor(world, match) {
    this.world = world; this.match = match; this.scene = world.scene;
    this.list = [];
    this.lights = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffffff, 0, 12, 1.6); this.scene.add(l); this.lights.push({ l, t: 0, t0: 1, i: 0 }); }
    // one shared particle system for sparks and embers
    this.N = 600;
    this.pPos = new Float32Array(this.N * 3); this.pVel = new Float32Array(this.N * 3); this.pCol = new Float32Array(this.N * 3); this.pLife = new Float32Array(this.N); this.pMax = new Float32Array(this.N);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.pGeo = geo;
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.16, map: spark(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    for (let i = 0; i < this.N; i++) this.pPos[i * 3 + 1] = -100;
    this.pNext = 0;
  }
  add(e) { this.list.push(e); return e; }
  clear() { for (const e of this.list) e.dispose && e.dispose(); this.list = []; }

  flash(x, y, z, color = 0xffaa55, intensity = 12, t = 0.4, distance = 14) {
    const s = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
    s.l.position.set(x, y, z); s.l.color.setHex(color); s.l.distance = distance; s.i = intensity; s.t = t; s.t0 = t;
  }
  burst(x, y, z, color = 0xffaa55, n = 24, speed = 4, life = 0.7, up = 2) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.pNext; this.pNext = (this.pNext + 1) % this.N;
      this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = speed * (0.4 + Math.random() * 0.8), r = Math.sqrt(1 - u * u);
      this.pVel[i * 3] = Math.cos(a) * r * s; this.pVel[i * 3 + 1] = Math.abs(u) * s + up; this.pVel[i * 3 + 2] = Math.sin(a) * r * s;
      this.pCol[i * 3] = c.r; this.pCol[i * 3 + 1] = c.g; this.pCol[i * 3 + 2] = c.b;
      this.pLife[i] = this.pMax[i] = life * (0.6 + Math.random() * 0.8);
    }
  }
  /** An expanding ring on the ground. */
  ring(x, z, r = 3, color = 0xffffff, life = 0.5, y = 0.05) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); this.scene.add(m);
    let t = 0;
    return this.add({ update: (dt) => { t += dt; const k = t / life; m.scale.setScalar(0.2 + k * r); m.material.opacity = 0.8 * (1 - k); return t < life; }, dispose: () => { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); } });
  }
  /** A warning circle that fills, then fires. */
  marker(x, z, r, color, life, onDone) {
    const g = new THREE.Group();
    const edge = new THREE.Mesh(new THREE.RingGeometry(r * 0.94, r, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    edge.rotation.x = fill.rotation.x = -Math.PI / 2; g.add(edge, fill); g.position.set(x, 0.06, z); this.scene.add(g);
    let t = 0;
    return this.add({ update: (dt) => { t += dt; const k = Math.min(1, t / life); fill.scale.setScalar(k); edge.material.opacity = 0.5 + 0.4 * Math.sin(t * 18); if (t >= life) { onDone && onDone(); return false; } return true; }, dispose: () => { g.removeFromParent(); edge.geometry.dispose(); fill.geometry.dispose(); edge.material.dispose(); fill.material.dispose(); } });
  }
  /** A straight tracer or a jagged lightning bolt between two points. */
  beam(a, b, color = 0xffffff, jag = 0, life = 0.18, width = 1) {
    const pts = [];
    const n = jag ? 10 : 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = new THREE.Vector3().lerpVectors(a, b, t);
      if (jag && i > 0 && i < n) { p.x += (Math.random() - 0.5) * jag; p.y += (Math.random() - 0.5) * jag; p.z += (Math.random() - 0.5) * jag; }
      pts.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, linewidth: width });
    const line = new THREE.Line(geo, mat); this.scene.add(line);
    // a glowing core so it reads (WebGL lines are one pixel wide)
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * width, 0.03 * width, a.distanceTo(b), 5, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.position.lerpVectors(a, b, 0.5); core.lookAt(b); core.rotateX(Math.PI / 2); this.scene.add(core);
    let t = 0;
    return this.add({ update: (dt) => { t += dt; mat.opacity = core.material.opacity = Math.max(0, 1 - t / life); return t < life; }, dispose: () => { line.removeFromParent(); core.removeFromParent(); geo.dispose(); mat.dispose(); core.geometry.dispose(); core.material.dispose(); } });
  }
  /** A thrown or fired object. */
  projectile(o) {
    const size = o.size || 0.18;
    const mesh = o.mesh || new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), new THREE.MeshBasicMaterial({ color: o.color || 0xffaa55 }));
    if (o.glow !== false) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: spark(), color: o.color || 0xffaa55, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.scale.setScalar(size * 7); mesh.add(s);
    }
    mesh.position.set(o.x, o.y, o.z); this.scene.add(mesh);
    const p = Object.assign({ vx: 0, vy: 0, vz: 0, gravity: 0, radius: 0.35, life: 3, t: 0, hits: 'enemy', bounce: 0, trail: o.color || 0xffaa55 }, o, { mesh });
    const self = this;
    p.update = (dt) => {
      p.t += dt;
      const ox = mesh.position.x, oy = mesh.position.y, oz = mesh.position.z;
      p.vy -= p.gravity * dt;
      let nx = ox + p.vx * dt, ny = oy + p.vy * dt, nz = oz + p.vz * dt;
      // the world
      const dx = nx - ox, dy = ny - oy, dz = nz - oz, L = Math.hypot(dx, dy, dz);
      if (L > 1e-5) {
        const hit = self.world.collision.raycast3(ox, oy, oz, dx / L, dy / L, dz / L, L + p.radius * 0.5);
        if (hit < L + p.radius * 0.5 || ny < 0.05) {
          if (p.bounce > 0) {
            if (ny < 0.05) { ny = 0.05; p.vy = Math.abs(p.vy) * p.bounce; p.vx *= 0.7; p.vz *= 0.7; }
            else { p.vx *= -p.bounce; p.vz *= -p.bounce; nx = ox; nz = oz; }
          } else { mesh.position.set(ox + dx / L * Math.max(0, hit - 0.05), Math.max(0.05, oy + dy / L * Math.max(0, hit - 0.05)), oz + dz / L * Math.max(0, hit - 0.05)); p.onWorld && p.onWorld(p); return false; }
        }
      }
      mesh.position.set(nx, ny, nz);
      if (p.spin) { mesh.rotation.x += dt * 9; mesh.rotation.z += dt * 6; }
      if (Math.random() < 0.6) self.burst(nx, ny, nz, p.trail, 1, 0.4, 0.35, 0);
      // bodies
      if (p.onHit) for (const a of self.match.actors) {
        if (!a.alive || a === p.owner || (p.ignore && p.ignore.has(a))) continue;
        if (p.hits === 'enemy' && (a.role === 'killer' || a.role === 'minion') === (p.owner.role === 'killer' || p.owner.role === 'minion')) continue;
        const ax = a.x - nx, az = a.z - nz, ay = (a.y + 1) - ny;
        if (ax * ax + az * az < (a.radius + p.radius) ** 2 && Math.abs(ay) < 1.1) { if (p.onHit(a, p) !== 'pierce') return false; (p.ignore || (p.ignore = new Set())).add(a); }
      }
      if (p.t >= p.life) { p.onExpire && p.onExpire(p); return false; }
      return true;
    };
    p.dispose = () => { mesh.removeFromParent(); mesh.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); }); };
    return this.add(p);
  }
  /** A patch of ground that does something to whoever stands in it. */
  zone(o) {
    const z = Object.assign({ t: 0, life: 5, r: 3, inside: new Set(), hits: 'all' }, o);
    if (o.kind === 'smoke') {
      const g = new THREE.Group();
      for (let i = 0; i < 14; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeT(), color: o.color || 0xd8d8e0, transparent: true, opacity: 0, depthWrite: false, fog: true }));
        const a = Math.random() * Math.PI * 2, d = Math.random() * z.r * 0.7;
        s.position.set(Math.cos(a) * d, 0.6 + Math.random() * 1.8, Math.sin(a) * d); s.scale.setScalar(z.r * (0.9 + Math.random() * 0.6));
        s.userData.spin = (Math.random() - 0.5) * 0.4; g.add(s);
      }
      g.position.set(z.x, 0, z.z); this.scene.add(g); z.group = g;
    } else if (o.kind === 'fire') {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CircleGeometry(z.r, 24), new THREE.MeshBasicMaterial({ color: 0xff4a10, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04; g.add(disc); g.position.set(z.x, 0, z.z); this.scene.add(g); z.group = g; z.disc = disc;
    } else if (o.kind === 'cash') {
      const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0x5fbf5a, roughness: 0.8, side: THREE.DoubleSide });
      for (let i = 0; i < 40; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.15), mat);
        const a = Math.random() * Math.PI * 2, d = Math.random() * z.r;
        m.position.set(Math.cos(a) * d, 0.5 + Math.random() * 3, Math.sin(a) * d); m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        m.userData.fall = 0.6 + Math.random() * 0.8; g.add(m);
      }
      g.position.set(z.x, 0, z.z); this.scene.add(g); z.group = g;
    } else if (o.mesh) { o.mesh.position.set(z.x, 0, z.z); this.scene.add(o.mesh); z.group = o.mesh; }
    const self = this;
    z.update = (dt) => {
      z.t += dt;
      const fade = Math.min(1, z.t / 0.4, (z.life - z.t) / 0.8);
      if (z.kind === 'smoke' && z.group) for (const s of z.group.children) { s.material.opacity = 0.85 * Math.max(0, fade); s.material.rotation += s.userData.spin * dt; }
      if (z.kind === 'fire' && z.disc) { z.disc.material.opacity = (0.25 + Math.sin(z.t * 20) * 0.08) * Math.max(0, fade); if (Math.random() < 0.7) self.burst(z.x + (Math.random() - 0.5) * z.r * 1.4, 0.1, z.z + (Math.random() - 0.5) * z.r * 1.4, 0xff7a20, 1, 0.6, 0.6, 1.4); }
      if (z.kind === 'cash' && z.group) for (const m of z.group.children) { if (m.position.y > 0.02) { m.position.y -= m.userData.fall * dt; m.rotation.x += dt * 3; } }
      z.tick && z.tick(z, dt);
      for (const a of self.match.actors) {
        if (!a.alive) continue;
        if (z.hits === 'killer' && a.role !== 'killer') continue;
        if (z.hits === 'survivor' && a.role !== 'survivor') continue;
        const inside = (a.x - z.x) ** 2 + (a.z - z.z) ** 2 < z.r * z.r;
        if (inside) { if (!z.inside.has(a)) { z.inside.add(a); z.onEnter && z.onEnter(a, z); } z.onTick && z.onTick(a, dt, z); }
        else z.inside.delete(a);
      }
      return z.t < z.life && !z.done;
    };
    z.dispose = () => { if (z.group) { z.group.removeFromParent(); z.group.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose && m.material.dispose(); }); } };
    return this.add(z);
  }
  /** Is a point inside any smoke? (smoke blocks the killer's sight) */
  smokeBetween(ax, az, bx, bz) {
    for (const e of this.list) {
      if (e.kind !== 'smoke' || e.t > e.life - 0.5) continue;
      // distance from the zone centre to the segment
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((e.x - ax) * dx + (e.z - az) * dz) / L2));
      const px = ax + dx * t - e.x, pz = az + dz * t - e.z;
      if (px * px + pz * pz < e.r * e.r * 0.8) return true;
    }
    return false;
  }
  update(dt) {
    this.list = this.list.filter((e) => { const keep = e.update(dt); if (!keep) e.dispose && e.dispose(); return keep; });
    for (const s of this.lights) { if (s.t > 0) { s.t -= dt; s.l.intensity = s.i * Math.max(0, s.t / s.t0); } else s.l.intensity = 0; }
    const P = this.pPos, Vv = this.pVel, C = this.pCol;
    for (let i = 0; i < this.N; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) { P[i * 3 + 1] = -100; continue; }
      Vv[i * 3 + 1] -= 6 * dt;
      P[i * 3] += Vv[i * 3] * dt; P[i * 3 + 1] += Vv[i * 3 + 1] * dt; P[i * 3 + 2] += Vv[i * 3 + 2] * dt;
      if (P[i * 3 + 1] < 0.02) { P[i * 3 + 1] = 0.02; Vv[i * 3 + 1] *= -0.3; Vv[i * 3] *= 0.6; Vv[i * 3 + 2] *= 0.6; }
      const k = this.pLife[i] / this.pMax[i];
      C[i * 3] *= 0.985 + 0.015 * k; C[i * 3 + 1] *= 0.97 + 0.03 * k; C[i * 3 + 2] *= 0.96 + 0.04 * k;
    }
    this.pGeo.attributes.position.needsUpdate = true; this.pGeo.attributes.color.needsUpdate = true;
  }
  dispose() { this.clear(); this.points.removeFromParent(); this.pGeo.dispose(); for (const s of this.lights) s.l.removeFromParent(); }
}
export { _v };
