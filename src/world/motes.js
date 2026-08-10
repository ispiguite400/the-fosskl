/* Spirit motes — the drifting lights of the Everdark Wood.
 *
 * They are ambience first: a canopy world with the sun held out needs
 * something alive in the dark. They are also a quiet hint. A share of the
 * swarm is bound to nearby unopened chests and circles them, so a player who
 * notices that the lights gather in one spot will find something there
 * without ever being told to look.
 *
 * Instanced emissive quads rather than point sprites: gl_PointSize is in
 * framebuffer pixels and misbehaves at close range and in split screen. */

import * as THREE from 'three';
import { makeRNG, clamp } from '../core/util.js';

const COUNT = { low: 60, medium: 130, high: 240, ultra: 360 };

export class Motes {
  constructor(scene, terrain, world, quality = 'high', color = 0x9fe8b0) {
    this.terrain = terrain;
    this.world = world;
    this.n = COUNT[quality] ?? 240;
    this.radius = 62;
    this.rng = makeRNG(0x1d0c ^ (world.id * 7919));

    const geo = new THREE.PlaneGeometry(.16, .16);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: .9, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.n);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 850;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    // Per-mote drift state.
    this.p = new Float32Array(this.n * 3);
    this.phase = new Float32Array(this.n);
    this.speed = new Float32Array(this.n);
    this.anchor = new Array(this.n).fill(null);
    for (let i = 0; i < this.n; i++) {
      this.phase[i] = this.rng() * 6.28;
      this.speed[i] = this.rng.range(.25, .8);
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this._v = new THREE.Vector3();
    this._anchorT = 0;
    this._scattered = false;
  }

  /** Re-seed positions around the player, binding some motes to chests. */
  _scatter(center, chests) {
    const R = this.radius;
    // A third of the swarm marks loot, spread over the nearest few chests.
    const near = (chests || [])
      .filter(c => !c.opened && c.pos.distanceTo(center) < R * 1.6)
      .slice(0, 4);
    for (let i = 0; i < this.n; i++) {
      const markLoot = near.length && i % 3 === 0;
      if (markLoot) {
        const c = near[(i / 3 | 0) % near.length];
        this.anchor[i] = c;
        const a = this.rng() * 6.28, r = this.rng.range(.7, 3.2);
        this.p[i * 3] = c.pos.x + Math.cos(a) * r;
        this.p[i * 3 + 1] = c.pos.y + this.rng.range(.4, 2.4);
        this.p[i * 3 + 2] = c.pos.z + Math.sin(a) * r;
      } else {
        this.anchor[i] = null;
        const a = this.rng() * 6.28, r = Math.sqrt(this.rng()) * R;
        const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
        this.p[i * 3] = x;
        this.p[i * 3 + 1] = this.terrain.heightAt(x, z) + this.rng.range(.5, 5.5);
        this.p[i * 3 + 2] = z;
      }
    }
    this._center = center.clone();
    this._scattered = true;
  }

  /** `night` 0..1 fades the swarm in as the light goes. */
  update(dt, camera, playerPos, chests, night = 1) {
    const vis = night > .12;
    this.mesh.visible = vis;
    if (!vis) return;

    if (!this._scattered || this._center.distanceTo(playerPos) > this.radius * .45) {
      this._scatter(playerPos, chests);
    }
    this.mesh.material.opacity = .25 + night * .7;

    this._anchorT += dt;
    camera.getWorldQuaternion(this._q);          // billboard to the viewer

    for (let i = 0; i < this.n; i++) {
      const t = this._anchorT * this.speed[i] + this.phase[i];
      const a = this.anchor[i];
      if (a && !a.opened) {
        // Bound motes orbit their chest, so the cluster reads as a place.
        const r = 1.5 + Math.sin(t * .7) * .7;
        this._v.set(a.pos.x + Math.cos(t) * r,
                    a.pos.y + 1.1 + Math.sin(t * 1.7) * .5,
                    a.pos.z + Math.sin(t) * r);
      } else {
        this.anchor[i] = null;
        this._v.set(this.p[i * 3] + Math.sin(t) * .9,
                    this.p[i * 3 + 1] + Math.sin(t * 1.3) * .55,
                    this.p[i * 3 + 2] + Math.cos(t * .8) * .9);
      }
      // Pulse: each mote breathes on its own clock.
      const k = .55 + .45 * Math.sin(t * 2.2);
      this._s.setScalar(clamp(k, .18, 1) * (a ? 1.5 : 1));
      this._m.compose(this._v, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
