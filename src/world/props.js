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
  buildGate, buildStall, buildBrazier, buildWell, buildCart, buildFence,
  buildWatchtower, buildBarricade, buildStuckSpear, buildRubble, buildLantern,
  buildStatue, buildGraves, buildBridge, buildBanner, buildPlatform, mat, bambooParts,
  treeParts, treePlan } from '../entities/models.js';

export const CELL = 256;
/* Collider bucket size. Woods carry tens of thousands of trunk colliders and
 * every actor tests twice a frame, so the list is spatially hashed: a query
 * touches the handful in one bucket instead of walking the whole world. */
const CGRID = 16;

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
    this.grid = new Map();     // `gx,gz` -> collider[]

    this._buildLandmarks();
    // Landmarks never unload, so their colliders go in with no owning cell.
    for (const c of this.colliders) this._gridAdd(c, null);
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
    if (w.theme === 'ruins') this._buildRuinedVillage(this.hubCenter, rng);

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

  /* ==========================================================
     World 1 — a whole town, not a handful of huts.
     Streets radiate from the shrine; houses line both sides of
     each street, with wells, carts, barricades and litter in the
     gaps and a broken palisade around the edge.
     ========================================================== */
  _buildRuinedVillage(c, rng) {
    const T = this.terrain;
    const add = (obj, x, z, { yaw = null, drop = 0, collide = 0, animate = false } = {}) => {
      obj.position.set(x, T.heightAt(x, z) - drop, z);
      obj.rotation.y = yaw ?? rng() * Math.PI * 2;
      this.landmarks.add(obj);
      if (collide) this.colliders.push({ x, z, r: collide });
      if (animate) this.animated.push(obj);
      return obj;
    };
    const ok = (x, z, slope = .34) => T.isFlatGround(x, z, slope);

    /* --- the shrine at the heart of it, half fallen --- */
    const shrine = buildPagoda(rng, 2, 1.15);
    add(shrine, c.x, c.z, { yaw: rng() * 6.28, collide: 5 });
    shrine.rotation.z = .07;
    add(buildPlatform(rng, 14, 14), c.x, c.z, { drop: .1 });

    /* --- streets --- */
    const STREETS = 7;
    const streetAngles = [];
    for (let s = 0; s < STREETS; s++) {
      streetAngles.push((s / STREETS) * Math.PI * 2 + rng.range(-.18, .18));
    }

    let built = 0;
    for (const a of streetAngles) {
      const dx = Math.cos(a), dz = Math.sin(a);
      // Perpendicular, for offsetting houses to either side of the road.
      const px = -dz, pz = dx;
      const length = rng.range(210, 330);

      for (let d = 22; d < length; d += rng.range(11, 17)) {
        for (const side of [-1, 1]) {
          if (rng.chance(.14)) continue;                 // gaps where it burned out
          const off = rng.range(7.5, 12) * side;
          const x = c.x + dx * d + px * off;
          const z = c.z + dz * d + pz * off;
          if (!ok(x, z)) continue;

          // Further out, more of the village is simply gone.
          const decay = d / length;
          const roll = rng();
          let obj, radius = 4.2;

          if (roll < .06 + decay * .12) {
            obj = buildRubble(rng); radius = 2.0;
          } else if (roll < .12 + decay * .14) {
            obj = buildFence(rng, rng.int(3, 6), { broken: true }); radius = 0;
          } else if (roll < .16) {
            obj = buildPagoda(rng, rng.int(2, 3), rng.range(.55, .8)); radius = 4.6;
          } else {
            obj = buildHouse(rng, { ruined: true, scale: rng.range(.9, 1.35) });
          }
          // Houses face the road.
          add(obj, x, z, { yaw: a + (side > 0 ? Math.PI / 2 : -Math.PI / 2) + rng.range(-.16, .16),
                           drop: .2, collide: radius });
          built++;
        }
      }

      /* things along the road itself */
      for (let d = 30; d < length; d += rng.range(26, 46)) {
        const x = c.x + dx * d + px * rng.range(-3, 3);
        const z = c.z + dz * d + pz * rng.range(-3, 3);
        if (!ok(x, z)) continue;
        const roll = rng();
        if (roll < .22) add(buildCart(rng, { wrecked: true }), x, z, { collide: 1.6 });
        else if (roll < .40) add(buildBarricade(rng), x, z, { yaw: a + Math.PI / 2, collide: 1.8 });
        else if (roll < .58) add(buildLantern(rng), x, z, { animate: true });
        else if (roll < .70) add(buildWell(rng), x, z, { collide: 1.4 });
        else if (roll < .84) add(buildBanner(rng, { torn: true }), x, z);
        else add(buildStatue(rng), x, z, { collide: .6 });
      }
    }

    /* --- infill between the streets so it reads as a town, not spokes --- */
    for (let i = 0; i < 220; i++) {
      const a = rng() * Math.PI * 2;
      const r = 26 + Math.sqrt(rng()) * 300;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (!ok(x, z)) continue;
      if (this._tooClose(x, z, 7)) continue;
      const roll = rng();
      if (roll < .58) {
        add(buildHouse(rng, { ruined: true, scale: rng.range(.85, 1.3) }), x, z,
          { drop: .2, collide: 4.0 });
        built++;
      } else if (roll < .74) {
        add(buildRubble(rng), x, z, { collide: 1.6 });
      } else if (roll < .86) {
        add(buildFence(rng, rng.int(4, 9), { broken: true }), x, z);
      } else {
        add(buildGraves(rng), x, z);
      }
    }

    /* --- battlefield litter --- */
    for (let i = 0; i < 160; i++) {
      const a = rng() * 6.28, r = 14 + Math.sqrt(rng()) * 320;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (!ok(x, z, .5)) continue;
      add(buildStuckSpear(rng), x, z);
    }

    /* --- fires still burning through it --- */
    for (let i = 0; i < 26; i++) {
      const a = rng() * 6.28, r = 18 + Math.sqrt(rng()) * 290;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (!ok(x, z, .45)) continue;
      add(buildBrazier(), x, z, { animate: true });
    }

    /* --- torii on the approaches --- */
    for (const a of streetAngles) {
      const d = rng.range(60, 130);
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      if (!ok(x, z, .3)) continue;
      const t = add(buildTorii(rng, rng.range(.9, 1.4)), x, z, { yaw: a + Math.PI / 2 });
      t.rotation.z = rng.range(-.12, .12);
    }

    /* --- broken palisade and towers around the edge --- */
    const RING = 330;
    for (let i = 0; i < 74; i++) {
      const a = (i / 74) * Math.PI * 2;
      if (rng.chance(.3)) continue;                       // breached sections
      const x = c.x + Math.cos(a) * RING, z = c.z + Math.sin(a) * RING;
      if (!ok(x, z, .42)) continue;
      add(buildFence(rng, 6, { broken: rng.chance(.55) }), x, z, { yaw: a + Math.PI / 2 });
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + .3;
      const x = c.x + Math.cos(a) * RING, z = c.z + Math.sin(a) * RING;
      if (!ok(x, z, .34)) continue;
      add(buildWatchtower(rng, { ruined: rng.chance(.6) }), x, z, { collide: 2.0 });
    }

    this.villageRadius = RING;
    this.villageBuildings = built;
  }

  /** Cheap spacing test against everything placed so far. */
  _tooClose(x, z, min) {
    for (const c of this.colliders) {
      if ((c.x - x) ** 2 + (c.z - z) ** 2 < min * min) return true;
    }
    return false;
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
    const cellAnimated = [];
    const rng = makeRNG(this._cellSeed(cx, cz));
    const T = this.terrain, w = this.world;
    const ox = cx * CELL, oz = cz * CELL;
    const colliders = [];

    const scale = { low: .35, medium: .6, high: 1, ultra: 1.35 }[this.quality] ?? 1;

    /* --- trees --- */
    // Dense worlds get a superlinear share: a wood is not a meadow with more
    // trees in it, and the fog closes the near field so the illusion holds.
    const td = w.density?.trees ?? .5;
    // Trees are instanced piece by piece, so the wood costs a fixed handful
    // of draw calls however thick it grows. The count is now set by how a
    // forest ought to look, not by what the renderer will tolerate.
    const treeCount = Math.floor((td + Math.max(0, td - 1) * 1.9) * 150 * scale);
    const bamboo = [];                       // instanced: stalk transforms
    const tmpP = new THREE.Vector3();

    /* Bamboo grows in thickets, not as evenly spaced saplings, and it costs
     * three draw calls a cell however many stalks there are. So it is placed
     * as clumps: pick a stand, crowd fifteen-odd stalks into a couple of
     * metres, leave the gaps between stands walkable. That is what makes a
     * grove read as a grove rather than as a lawn with sticks in it. */
    if (w.bamboo) {
      const stands = Math.floor(w.bamboo * scale);
      for (let c = 0; c < stands; c++) {
        const cxp = ox + rng.range(-CELL / 2, CELL / 2);
        const czp = oz + rng.range(-CELL / 2, CELL / 2);
        if (Math.max(Math.abs(cxp), Math.abs(czp)) > T.half - 40) continue;
        if (!T.isFlatGround(cxp, czp, .8)) continue;
        if (this.inHub(tmpP.set(cxp, 0, czp), 70)) continue;
        const n = rng.int(11, 24);
        const spread = rng.range(1.3, 3.1);
        for (let k = 0; k < n; k++) {
          const a = rng() * 6.28, r = Math.sqrt(rng()) * spread;
          const x = cxp + Math.cos(a) * r, z = czp + Math.sin(a) * r;
          const s = rng.range(.7, 1.25);
          bamboo.push({ x, y: T.heightAt(x, z) - .3, z, h: rng.range(8, 17) * s,
                        lean: rng.range(-.08, .08), spin: rng() * 6.28, s });
        }
        // One collider per stand: a thicket blocks, individual stalks do not.
        colliders.push({ x: cxp, z: czp, r: spread * .8 });
      }
    }

    /* Trees are gathered as per-piece transform lists and baked into
     * InstancedMeshes at the end of the cell. Clumping matters here as much
     * as it does for bamboo: woods grow in stands with clearings between,
     * and evenly scattered trunks read as an orchard. */
    const parts = treeParts(w.theme);
    const buckets = new Map();
    const treeM = new THREE.Matrix4(), partM = new THREE.Matrix4();
    const tq = new THREE.Quaternion(), te = new THREE.Euler(), tv = new THREE.Vector3(), ts = new THREE.Vector3();
    const clumpR = w.theme === 'forest' ? 22 : 34;
    let placed = 0, standX = 0, standZ = 0, standLeft = 0;

    for (let i = 0; i < treeCount; i++) {
      if (standLeft <= 0) {
        standX = ox + rng.range(-CELL / 2, CELL / 2);
        standZ = oz + rng.range(-CELL / 2, CELL / 2);
        standLeft = rng.int(6, 18);
      }
      standLeft--;
      const a = rng() * 6.28, rr = Math.sqrt(rng()) * clumpR;
      const x = standX + Math.cos(a) * rr, z = standZ + Math.sin(a) * rr;
      if (Math.max(Math.abs(x), Math.abs(z)) > T.half - 40) continue;
      if (!T.isFlatGround(x, z, w.theme === 'forest' ? .68 : .42)) continue;
      if (this.inHub(tmpP.set(x, 0, z), 70)) continue;
      const y = T.heightAt(x, z) - .3;
      const s = rng.range(.75, 1.3);
      treeM.compose(tv.set(x, y, z), tq.setFromEuler(te.set(0, rng() * 6.28, 0)), ts.set(s, s, s));
      const plan = treePlan(w.theme, rng);
      for (const part of plan.parts) {
        partM.compose(tv.fromArray(part.p), tq.setFromEuler(te.fromArray(part.r)), ts.fromArray(part.s));
        let list = buckets.get(part.k);
        if (!list) buckets.set(part.k, list = []);
        list.push(new THREE.Matrix4().multiplyMatrices(treeM, partM));
      }
      colliders.push({ x, z, r: .8 * s });
      placed++;
    }
    for (const [k, list] of buckets) {
      const P = parts[k];
      if (!P) continue;
      const im = new THREE.InstancedMesh(P.geo, P.mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true; im.receiveShadow = true;
      g.add(im);
    }
    g.userData.treeCount = placed;
    if (bamboo.length) g.add(...this._bambooMeshes(bamboo));

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

    /* --- roadside dressing: something to find between the landmarks --- */
    const dressing = Math.round(4 * scale);
    for (let i = 0; i < dressing; i++) {
      const x = ox + rng.range(-CELL / 2, CELL / 2);
      const z = oz + rng.range(-CELL / 2, CELL / 2);
      if (Math.max(Math.abs(x), Math.abs(z)) > T.half - 40) continue;
      if (!T.isFlatGround(x, z, .3)) continue;
      if (this.inHub(new THREE.Vector3(x, 0, z), 72)) continue;

      const roll = rng();
      let obj = null, radius = 0, animate = false;
      if (roll < .16)      { obj = buildLantern(rng); animate = true; }
      else if (roll < .30) { obj = buildStatue(rng); radius = .6; }
      else if (roll < .44) { obj = buildFence(rng, rng.int(4, 10), { broken: rng.chance(.5) }); }
      else if (roll < .56) { obj = buildWell(rng); radius = 1.4; }
      else if (roll < .66) { obj = buildCart(rng, { wrecked: rng.chance(.5) }); radius = 1.6; }
      else if (roll < .74) { obj = buildGraves(rng); }
      else if (roll < .82) { obj = buildBanner(rng, { torn: rng.chance(.5) }); }
      else if (roll < .88) { obj = buildWatchtower(rng, { ruined: rng.chance(.5) }); radius = 2.0; }
      else if (roll < .94) { obj = buildStuckSpear(rng); }
      else                 { obj = buildRubble(rng); radius = 1.4; }

      obj.position.set(x, T.heightAt(x, z), z);
      obj.rotation.y = rng() * 6.28;
      g.add(obj);
      if (radius) colliders.push({ x, z, r: radius });
      if (animate) cellAnimated.push(obj);
    }

    /* --- small hamlets: three to six houses that share a well --- */
    if (rng.chance(.22 * (w.density?.buildings ?? .2) * 5)) {
      const hx = ox + rng.range(-CELL / 3, CELL / 3);
      const hz = oz + rng.range(-CELL / 3, CELL / 3);
      if (T.isFlatGround(hx, hz, .2) && !this.inHub(new THREE.Vector3(hx, 0, hz), 130)) {
        const n = rng.int(3, 7);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 6.28 + rng.range(-.3, .3);
          const r = rng.range(9, 19);
          const x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r;
          if (!T.isFlatGround(x, z, .3)) continue;
          const h = buildHouse(rng, { ruined: rng.chance(.25), scale: rng.range(.85, 1.15) });
          h.position.set(x, T.heightAt(x, z) - .2, z);
          h.rotation.y = -a + Math.PI / 2;
          g.add(h);
          colliders.push({ x, z, r: 4 });
        }
        const well = buildWell(rng);
        well.position.set(hx, T.heightAt(hx, hz), hz);
        g.add(well);
        colliders.push({ x: hx, z: hz, r: 1.4 });
        for (let i = 0; i < 3; i++) {
          const a = rng() * 6.28, r = rng.range(4, 22);
          const lx = hx + Math.cos(a) * r, lz = hz + Math.sin(a) * r;
          const l = buildLantern(rng);
          l.position.set(lx, T.heightAt(lx, lz), lz);
          g.add(l);
          cellAnimated.push(l);
        }
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
    g.userData.animated = cellAnimated;
    this.animated.push(...cellAnimated);
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
        // Drop this cell's animated props so the tick list cannot grow forever.
        const gone = new Set(g.userData.animated || []);
        if (gone.size) this.animated = this.animated.filter(a => !gone.has(a));
        g.traverse(o => { if (o.isMesh && o.geometry?.dispose && o.userData.oneOff) o.geometry.dispose(); });
        this._gridRemoveCell(key, g.userData.colliders);
        this.cells.delete(key);
      }
    }

    // One cell per frame keeps steady play smooth, but after a teleport, a
    // world load or a hard gallop the backlog is dozens of cells and the
    // world stays visibly empty while it catches up. Spend more when behind —
    // but measured in milliseconds, not cells: a cell of open savanna is
    // under two, a cell of the Everdark Wood is fifteen, and a fixed count
    // that is generous for one is a visible hitch in the other.
    const missing = wanted.size - this.cells.size;
    const deadline = performance.now() + (missing > 6 ? 12 : 4);
    let first = true;
    for (const key of wanted) {
      if (this.cells.has(key)) continue;
      if (!first && performance.now() > deadline) break;
      first = false;
      const [cx, cz] = key.split(',').map(Number);
      const g = this._buildCell(cx, cz);
      for (const c of g.userData.colliders || []) this._gridAdd(c, key);
      this.cells.set(key, g);
      this.group.add(g);
    }
  }

  /** Three instanced meshes carrying a whole cell's worth of bamboo. */
  _bambooMeshes(list) {
    const P = bambooParts();
    const n = list.length;
    const stalks = new THREE.InstancedMesh(P.stalk.geo, P.stalk.mat, n);
    const leafA = new THREE.InstancedMesh(P.leaf.geo, P.leaf.mat, n);
    const leafB = new THREE.InstancedMesh(P.leaf.geo, P.leaf.mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const e = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    list.forEach((b, i) => {
      // The stalk geometry is a unit-height cylinder, so y scale is its height.
      e.set(0, b.spin, b.lean); q.setFromEuler(e);
      pos.set(b.x, b.y + b.h / 2, b.z);
      scl.set(b.s, b.h, b.s);
      stalks.setMatrixAt(i, m.compose(pos, q, scl));

      scl.set(b.s, b.s, b.s);
      e.set(b.lean * 3, b.spin, .2); q.setFromEuler(e);
      pos.set(b.x, b.y + b.h * .82, b.z);
      leafA.setMatrixAt(i, m.compose(pos, q, scl));
      e.set(b.lean * 3, b.spin + 1.57, -.2); q.setFromEuler(e);
      pos.set(b.x, b.y + b.h * .72, b.z);
      leafB.setMatrixAt(i, m.compose(pos, q, scl));
    });
    for (const im of [stalks, leafA, leafB]) {
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = true;
    }
    return [stalks, leafA, leafB];
  }

  /** File a collider into every grid bucket its circle touches. */
  _gridAdd(c, cellKey) {
    c._cell = cellKey;
    const x0 = Math.floor((c.x - c.r) / CGRID), x1 = Math.floor((c.x + c.r) / CGRID);
    const z0 = Math.floor((c.z - c.r) / CGRID), z1 = Math.floor((c.z + c.r) / CGRID);
    for (let gx = x0; gx <= x1; gx++)
      for (let gz = z0; gz <= z1; gz++) {
        const k = gx + ',' + gz;
        let b = this.grid.get(k);
        if (!b) this.grid.set(k, b = []);
        b.push(c);
      }
  }

  /** Drop everything a streamed-out cell had filed. */
  _gridRemoveCell(cellKey, colliders) {
    const touched = new Set();
    for (const c of colliders || []) {
      const x0 = Math.floor((c.x - c.r) / CGRID), x1 = Math.floor((c.x + c.r) / CGRID);
      const z0 = Math.floor((c.z - c.r) / CGRID), z1 = Math.floor((c.z + c.r) / CGRID);
      for (let gx = x0; gx <= x1; gx++)
        for (let gz = z0; gz <= z1; gz++) touched.add(gx + ',' + gz);
    }
    for (const k of touched) {
      const b = this.grid.get(k);
      if (!b) continue;
      const kept = b.filter(c => c._cell !== cellKey);
      if (kept.length) this.grid.set(k, kept); else this.grid.delete(k);
    }
  }

  /** Nearest blocking prop within `r` of a point, or null. */
  collideAt(x, z, radius = .5) {
    const x0 = Math.floor((x - radius) / CGRID), x1 = Math.floor((x + radius) / CGRID);
    const z0 = Math.floor((z - radius) / CGRID), z1 = Math.floor((z + radius) / CGRID);
    for (let gx = x0; gx <= x1; gx++)
      for (let gz = z0; gz <= z1; gz++) {
        const b = this.grid.get(gx + ',' + gz);
        if (!b) continue;
        for (const c of b) {
          const dx = c.x - x, dz = c.z - z, rr = c.r + radius;
          if (dx * dx + dz * dz < rr * rr) return c;
        }
      }
    return null;
  }

  tick(dt, t, night = 1) {
    for (const a of this.animated) {
      if (a.userData.nightOnly) {
        // Stone lanterns are lit at dusk and put out at dawn.
        const on = night > .35;
        if (a.userData.light) a.userData.light.intensity = on ? 2.2 + Math.sin(t * 7 + a.position.x) * .6 : 0;
        if (a.userData.fire) a.userData.fire.visible = on;
        continue;
      }
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
    this.grid.clear();
  }
}
