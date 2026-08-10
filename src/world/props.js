/* World population.
 *
 * Props stream in 256 m cells around the player. Every cell derives its own
 * RNG from (worldSeed, cellX, cellZ), so the same rock sits on the same
 * hillside every time you load the game without anything being stored.
 *
 * Fixed landmarks — the hub village, the gate, the tutorial村 — are placed
 * once at world build time and never unloaded. */

import * as THREE from 'three';
import { makeRNG, clamp, lerp } from '../core/util.js';
import {
  buildTree, buildRock, buildHouse, buildPagoda, buildTorii, buildTemple,
  buildGate, buildStall, buildBrazier, mat
} from '../entities/models.js';

export const CELL = 256;

export class Props {
  constructor(scene, terrain, world, seed, quality = 'high') {
    this.scene = scene;
    this.terrain = terrain;
    this.world = world;
    this.seed = seed;
    this.quality = quality;
    this.cells = new Map();
    this.group = new THREE.Group();
    this.group.name = 'props';
    scene.add(this.group);

    this.landmarks = new THREE.Group();
    this.group.add(this.landmarks);

    this.radius = { low: 2, medium: 3, high: 4, ultra: 5 }[quality] ?? 4;
    this.animated = [];        // braziers etc. that need a per-frame tick
    this.colliders = [];       // simple cylinder colliders for buildings/rocks

    this._buildLandmarks();
  }

  /* ==========================================================
     Fixed landmarks
     ========================================================== */
  _buildLandmarks() {
    const rng = makeRNG(this.seed ^ 0xA11);
    const w = this.world;

    /* --- hub village (worlds 2..10) --- */
    if (w.hub) {
      const spot = this.terrain.findSpawn({ x: 0, z: 0 }, 260);
      this.hubCenter = new THREE.Vector3(spot.x, spot.y, spot.z);
      this._buildHub(this.hubCenter, rng);
    } else {
      this.hubCenter = new THREE.Vector3(0, this.terrain.heightAt(0, 0), 0);
    }

    /* --- world 1: the burnt village the player wakes up in --- */
    if (w.theme === 'ruins') {
      const c = this.hubCenter;
      for (let i = 0; i < 34; i++) {
        const a = rng() * Math.PI * 2, r = rng.range(18, 190);
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        if (!this.terrain.isFlatGround(x, z, .32)) continue;
        const h = buildHouse(rng, { ruined: true });
        h.position.set(x, this.terrain.heightAt(x, z) - .2, z);
        h.rotation.y = rng() * Math.PI * 2;
        this.landmarks.add(h);
        this.colliders.push({ x, z, r: 4.2 });
      }
      // A half-collapsed shrine at the heart of it.
      const p = buildPagoda(rng, 2, 1.1);
      p.position.copy(c);
      p.rotation.z = .07;
      this.landmarks.add(p);
      this.colliders.push({ x: c.x, z: c.z, r: 5 });

      const t = buildTorii(rng, 1.2);
      t.position.set(c.x + 34, this.terrain.heightAt(c.x + 34, c.z + 8), c.z + 8);
      t.rotation.y = .4; t.rotation.z = -.09;
      this.landmarks.add(t);

      // Scattered fires still burning.
      for (let i = 0; i < 9; i++) {
        const a = rng() * 6.28, r = rng.range(24, 150);
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        const b = buildBrazier();
        b.position.set(x, this.terrain.heightAt(x, z), z);
        this.landmarks.add(b);
        this.animated.push(b);
      }
    }

    /* --- the gate to the next world --- */
    if (!w.final) {
      const ga = rng() * Math.PI * 2;
      const gr = w.size * .34;
      const gx = Math.cos(ga) * gr, gz = Math.sin(ga) * gr;
      const spot = this.terrain.findSpawn({ x: gx, z: gz }, 300);
      this.gate = buildGate(1);
      this.gate.position.set(spot.x, spot.y, spot.z);
      this.gate.rotation.y = rng() * Math.PI * 2;
      this.landmarks.add(this.gate);
      this.gatePos = new THREE.Vector3(spot.x, spot.y, spot.z);
      this.animated.push(this.gate);
    }

    /* --- theme landmarks --- */
    if (w.theme === 'roman') {
      for (let i = 0; i < 7; i++) {
        const a = rng() * 6.28, r = rng.range(400, w.size * .4);
        const s = this.terrain.findSpawn({ x: Math.cos(a) * r, z: Math.sin(a) * r }, 200);
        const t = buildTemple(rng, rng.range(.8, 1.5));
        t.position.set(s.x, s.y, s.z);
        t.rotation.y = rng() * 6.28;
        this.landmarks.add(t);
        this.colliders.push({ x: s.x, z: s.z, r: 14 });
      }
    }
    if (w.theme === 'kingdom') {
      // A great keep on the highest ground we can find.
      let best = null;
      for (let i = 0; i < 400; i++) {
        const x = rng.range(-1, 1) * w.size * .35, z = rng.range(-1, 1) * w.size * .35;
        const y = this.terrain.heightAt(x, z);
        if (this.terrain.slopeAt(x, z) > .3) continue;
        if (!best || y > best.y) best = { x, y, z };
      }
      if (best) {
        for (let i = 0; i < 5; i++) {
          const p = buildPagoda(rng, 4, 2.4);
          const a = (i / 5) * 6.28;
          p.position.set(best.x + Math.cos(a) * 34, this.terrain.heightAt(best.x + Math.cos(a) * 34, best.z + Math.sin(a) * 34), best.z + Math.sin(a) * 34);
          this.landmarks.add(p);
          this.colliders.push({ x: p.position.x, z: p.position.z, r: 8 });
        }
        this.keepPos = new THREE.Vector3(best.x, best.y, best.z);
      }
    }
  }

  _buildHub(center, rng) {
    const T = this.terrain;
    const y = p => T.heightAt(p.x, p.z);

    // Central plaza pagoda.
    const p = buildPagoda(rng, 3, 1.2);
    p.position.copy(center);
    this.landmarks.add(p);
    this.colliders.push({ x: center.x, z: center.z, r: 5 });

    // Ring of houses.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 6.28 + rng.range(-.1, .1);
      const r = rng.range(26, 62);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const h = buildHouse(rng, { ruined: false });
      h.position.set(x, T.heightAt(x, z) - .15, z);
      h.rotation.y = -a + Math.PI / 2 + rng.range(-.2, .2);
      this.landmarks.add(h);
      this.colliders.push({ x, z, r: 4 });
    }

    // Market stalls and braziers around the plaza.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.28 + .4, r = 15;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const s = buildStall(rng);
      s.position.set(x, T.heightAt(x, z), z);
      s.rotation.y = -a;
      this.landmarks.add(s);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.28, r = 9;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const b = buildBrazier();
      b.position.set(x, T.heightAt(x, z), z);
      this.landmarks.add(b);
      this.animated.push(b);
    }

    // Torii marking the road in.
    const t = buildTorii(rng, 1.4);
    t.position.set(center.x, T.heightAt(center.x, center.z + 74), center.z + 74);
    this.landmarks.add(t);
  }

  /** True if a position is inside the safe hub radius. */
  inHub(pos, radius = 78) {
    return this.world.hub && this.hubCenter.distanceTo(pos) < radius;
  }

  /* ==========================================================
     Streaming cells
     ========================================================== */
  _cellSeed(cx, cz) {
    // Mix the cell coordinates into the world seed with a hash.
    let h = (this.seed ^ 0x2545F491) >>> 0;
    h = Math.imul(h ^ (cx * 0x9E3779B1), 0x85EBCA6B) >>> 0;
    h = Math.imul(h ^ (cz * 0xC2B2AE35), 0x27D4EB2F) >>> 0;
    return h >>> 0;
  }

  _buildCell(cx, cz) {
    const g = new THREE.Group();
    const rng = makeRNG(this._cellSeed(cx, cz));
    const T = this.terrain, w = this.world;
    const ox = cx * CELL, oz = cz * CELL;
    const colliders = [];

    const scale = { low: .35, medium: .6, high: 1, ultra: 1.35 }[this.quality] ?? 1;

    /* --- trees --- */
    const treeCount = Math.floor((w.density?.trees ?? .5) * 26 * scale);
    for (let i = 0; i < treeCount; i++) {
      const x = ox + rng.range(-CELL / 2, CELL / 2);
      const z = oz + rng.range(-CELL / 2, CELL / 2);
      if (Math.max(Math.abs(x), Math.abs(z)) > T.half - 40) continue;
      if (!T.isFlatGround(x, z, .42)) continue;
      if (this.inHub(new THREE.Vector3(x, 0, z), 70)) continue;
      const t = buildTree(w.theme, rng);
      t.position.set(x, T.heightAt(x, z) - .3, z);
      t.rotation.y = rng() * 6.28;
      const s = rng.range(.75, 1.3);
      t.scale.setScalar(s);
      g.add(t);
      colliders.push({ x, z, r: .8 * s });
    }

    /* --- rocks --- */
    const rockCount = Math.floor((w.density?.rocks ?? .4) * 14 * scale);
    for (let i = 0; i < rockCount; i++) {
      const x = ox + rng.range(-CELL / 2, CELL / 2);
      const z = oz + rng.range(-CELL / 2, CELL / 2);
      if (Math.max(Math.abs(x), Math.abs(z)) > T.half - 40) continue;
      const y = T.heightAt(x, z);
      if (w.water && y < (w.waterLevel || 0)) continue;
      if (y < -100) continue;
      const r = buildRock(rng, w.theme);
      r.position.set(x, y - rng.range(.2, .9), z);
      r.rotation.set(rng() * 6.28, rng() * 6.28, rng() * 6.28);
      g.add(r);
      if (r.scale.x > .5) colliders.push({ x, z, r: 1.6 });
    }

    /* --- outlying buildings --- */
    const bCount = Math.floor((w.density?.buildings ?? .2) * 3 * scale);
    for (let i = 0; i < bCount; i++) {
      if (!rng.chance(.4)) continue;
      const x = ox + rng.range(-CELL / 2, CELL / 2);
      const z = oz + rng.range(-CELL / 2, CELL / 2);
      if (Math.max(Math.abs(x), Math.abs(z)) > T.half - 60) continue;
      if (!T.isFlatGround(x, z, .22)) continue;
      if (this.inHub(new THREE.Vector3(x, 0, z), 100)) continue;
      let b;
      if (w.theme === 'roman') b = buildTemple(rng, rng.range(.4, .7));
      else if (rng.chance(.22)) b = buildPagoda(rng, rng.int(2, 3), rng.range(.6, 1));
      else b = buildHouse(rng, { ruined: w.theme === 'ruins' || rng.chance(.35) });
      b.position.set(x, T.heightAt(x, z) - .2, z);
      b.rotation.y = rng() * 6.28;
      g.add(b);
      colliders.push({ x, z, r: 4.5 });
    }

    /* --- torii, wayshrines, atmosphere --- */
    if (rng.chance(.16)) {
      const x = ox + rng.range(-CELL / 2, CELL / 2);
      const z = oz + rng.range(-CELL / 2, CELL / 2);
      if (T.isFlatGround(x, z, .25)) {
        const t = buildTorii(rng, rng.range(.6, 1.1));
        t.position.set(x, T.heightAt(x, z), z);
        t.rotation.y = rng() * 6.28;
        g.add(t);
      }
    }

    /* --- theme flourishes --- */
    if (w.theme === 'sky' && rng.chance(.5)) {
      // Small floating shards under the islands.
      for (let i = 0; i < rng.int(2, 6); i++) {
        const x = ox + rng.range(-CELL / 2, CELL / 2);
        const z = oz + rng.range(-CELL / 2, CELL / 2);
        const r = buildRock(rng, 'sky');
        r.position.set(x, T.heightAt(x, z) - rng.range(20, 90), z);
        r.scale.setScalar(rng.range(1.5, 5));
        g.add(r);
      }
    }

    g.userData.colliders = colliders;
    return g;
  }

  update(playerPos) {
    const pcx = Math.round(playerPos.x / CELL);
    const pcz = Math.round(playerPos.z / CELL);
    const R = this.radius;

    const wanted = new Set();
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (Math.hypot(dx, dz) > R + .4) continue;
        wanted.add(`${pcx + dx},${pcz + dz}`);
      }
    }

    for (const [key, g] of this.cells) {
      if (!wanted.has(key)) {
        this.group.remove(g);
        g.traverse(o => { if (o.isMesh && o.geometry?.dispose && o.userData.oneOff) o.geometry.dispose(); });
        this.cells.delete(key);
      }
    }

    let budget = 1;
    for (const key of wanted) {
      if (this.cells.has(key)) continue;
      if (budget-- <= 0) break;
      const [cx, cz] = key.split(',').map(Number);
      const g = this._buildCell(cx, cz);
      this.cells.set(key, g);
      this.group.add(g);
    }
  }

  /** Nearest blocking prop within `r` of a point, or null. */
  collideAt(x, z, radius = .5) {
    for (const c of this.colliders) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < c.r + radius) return c;
    }
    for (const [, g] of this.cells) {
      for (const c of g.userData.colliders || []) {
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < c.r + radius) return c;
      }
    }
    return null;
  }

  tick(dt, t) {
    for (const a of this.animated) {
      if (a.userData.fire) {
        const f = a.userData.fire;
        const s = 1 + Math.sin(t * 9 + a.position.x) * .18 + Math.sin(t * 15.3) * .1;
        f.scale.set(s, s * 1.4, s);
        if (a.userData.light) a.userData.light.intensity = 3.4 + Math.sin(t * 11 + a.position.z) * 1.1;
      }
      if (a.userData.portal) {
        a.userData.portal.material.opacity = .3 + Math.sin(t * 1.6) * .12;
        a.userData.light.intensity = 5 + Math.sin(t * 2.1) * 2;
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.cells.clear();
    this.animated.length = 0;
    this.colliders.length = 0;
  }
}
