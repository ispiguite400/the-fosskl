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
  buildStatue, buildGraves, buildBridge, buildBanner, buildPlatform, buildCairn, mat, bambooParts,
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
    /* Anything burning. In a freezing world these are the only places the
     * cold is not getting in, which is what makes a lit lantern out in the
     * snow worth walking to rather than scenery. */
    this.fires = [];

    // Landmark colliders are filed into the grid as they are built, so the
    // builders can ask what they have already put down.
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
        this._addCollider(s.x, s.z, 14);
      }
    }
    if (w.theme === 'desert') {
      /* One drowned city that is always there, so the waste has a
       * destination and not just scenery. It sits in the lowest ground
       * within reach — a basin is where a city would have been, and where
       * the sand has had the least to bury. */
      let low = null;
      for (let i = 0; i < 500; i++) {
        const x = rng.range(-1, 1) * w.size * .3, z = rng.range(-1, 1) * w.size * .3;
        if (Math.hypot(x, z) < 300) continue;                 // not on the hub
        const y = this.terrain.heightAt(x, z);
        if (this.terrain.slopeAt(x, z) > .28) continue;
        if (!low || y < low.y) low = { x, y, z };
      }
      if (low) {
        this.ruinPos = new THREE.Vector3(low.x, low.y, low.z);
        this._buildDrownedCity(this.ruinPos, rng);
      }
    }
    if (w.waterhole) {
      /* On a plain this wide, everything alive has to come to the same few
       * metres of water eventually — which is exactly why the things that
       * eat them are already there. One great tree, bones, and a ring of
       * churned ground you can see from a long way off. */
      let low = null;
      for (let i = 0; i < 500; i++) {
        const x = rng.range(-1, 1) * w.size * .28, z = rng.range(-1, 1) * w.size * .28;
        if (Math.hypot(x, z) < 330) continue;
        const y = this.terrain.heightAt(x, z);
        if (this.terrain.slopeAt(x, z) > .22) continue;
        if (!low || y < low.y) low = { x, y, z };
      }
      if (low) {
        this.waterholePos = new THREE.Vector3(low.x, low.y, low.z);
        this._buildWaterhole(this.waterholePos, rng);
      }
    }
    if (w.cairns) {
      /* Everyone who tried to cross before you. The flattest wide ground in
       * the world, covered in stone markers in rough rows, with a shrine and
       * the only fire for a kilometre at the middle of it. */
      let flat = null;
      for (let i = 0; i < 500; i++) {
        const x = rng.range(-1, 1) * w.size * .3, z = rng.range(-1, 1) * w.size * .3;
        if (Math.hypot(x, z) < 340) continue;
        const sl = this.terrain.slopeAt(x, z);
        if (!flat || sl < flat.sl) flat = { x, z, sl, y: this.terrain.heightAt(x, z) };
      }
      if (flat) {
        this.cairnPos = new THREE.Vector3(flat.x, flat.y, flat.z);
        this._buildCairnField(this.cairnPos, rng);
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
          this._addCollider(p.position.x, p.position.z, 8);
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
      if (collide) this._addCollider(x, z, collide);
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

  /* ==========================================================
     The village.

     Every world but the first has one, and no two are laid out
     alike: the plan is drawn from the world's own seed, so the
     Verdant Reach might be a spoked market town and the Iron
     Crown a walled grid. It is a place with streets you can walk
     down rather than a ring of huts around a shrine, and the
     people who live there stand where people would stand — at
     their own doors, in the market, at the gate — which is what
     `npcSpots` is for.
     ========================================================== */
  _buildHub(center, rng) {
    const T = this.terrain;
    const w = this.world;
    const add = (obj, x, z, { yaw = 0, drop = .15, collide = 0, animate = false, fire = false } = {}) => {
      obj.position.set(x, T.heightAt(x, z) - drop, z);
      obj.rotation.y = yaw;
      this.landmarks.add(obj);
      if (collide) this._addCollider(x, z, collide);
      if (animate) this.animated.push(obj);
      if (fire) this.fires.push({ x, z, cell: null });
      return obj;
    };
    const ok = (x, z, slope = .34) => T.isFlatGround(x, z, slope);

    /* Spots where a person would plausibly be standing. Roles get the
     * prominent ones (plaza, gate, market); villagers take what is left. */
    this.npcSpots = [];
    const spot = (x, z, yaw, prominence) => {
      if (Math.max(Math.abs(x), Math.abs(z)) > T.half - 30) return;
      this.npcSpots.push({ x, z, yaw, prominence });
    };

    const style = w.villageStyle ?? ['radial', 'grid', 'ring', 'strip'][rng.int(0, 3)];
    this.villageStyle = style;
    // A real settlement, not a hamlet: 90-140 m across.
    const R = rng.range(88, 140);
    this.hubRadius = R + 26;

    /* ---- the plaza at the middle of it ---- */
    const shrineTiers = rng.int(3, 5);
    add(buildPagoda(rng, shrineTiers, rng.range(1.1, 1.5)), center.x, center.z,
        { yaw: rng() * 6.28, drop: 0, collide: 6 });
    add(buildPlatform(rng, 26, 26), center.x, center.z, { drop: .1 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.28 + .3, r = 11;
      add(buildBrazier(), center.x + Math.cos(a) * r, center.z + Math.sin(a) * r,
          { drop: 0, animate: true, fire: true });
    }
    // The market: stalls facing inward, and somebody behind each of them.
    const stalls = rng.int(7, 12);
    for (let i = 0; i < stalls; i++) {
      const a = (i / stalls) * 6.28 + rng.range(-.12, .12);
      const r = rng.range(17, 24);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      add(buildStall(rng), x, z, { yaw: -a, drop: 0, collide: 1.8 });
      spot(x + Math.cos(a) * 2.2, z + Math.sin(a) * 2.2, -a + Math.PI, 2);
    }
    const wellA = rng() * 6.28;
    add(buildWell(rng), center.x + Math.cos(wellA) * 14, center.z + Math.sin(wellA) * 14,
        { drop: 0, collide: 1.4 });
    spot(center.x + Math.cos(wellA) * 17, center.z + Math.sin(wellA) * 17, wellA + Math.PI, 3);

    /* ---- streets ---- */
    const streets = [];        // { ox, oz, dx, dz, len }
    if (style === 'radial') {
      const n = rng.int(5, 8);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.28 + rng.range(-.16, .16);
        streets.push({ ox: center.x, oz: center.z, dx: Math.cos(a), dz: Math.sin(a), len: R });
      }
    } else if (style === 'grid') {
      const base = rng() * 6.28;
      const rows = rng.int(3, 5);
      for (let i = 0; i < rows; i++) {
        const off = (i - (rows - 1) / 2) * rng.range(26, 34);
        for (const turn of [0, Math.PI / 2]) {
          const a = base + turn;
          const px = -Math.sin(a), pz = Math.cos(a);
          streets.push({ ox: center.x + px * off, oz: center.z + pz * off,
                         dx: Math.cos(a), dz: Math.sin(a), len: R, both: true });
        }
      }
    } else if (style === 'ring') {
      const n = rng.int(4, 6);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.28;
        streets.push({ ox: center.x, oz: center.z, dx: Math.cos(a), dz: Math.sin(a), len: R });
      }
    } else {                                  // strip: one long high street
      const a = rng() * 6.28;
      streets.push({ ox: center.x, oz: center.z, dx: Math.cos(a), dz: Math.sin(a), len: R, both: true });
      for (const side of [-1, 1]) {
        const b = a + side * rng.range(.9, 1.3);
        streets.push({ ox: center.x, oz: center.z, dx: Math.cos(b), dz: Math.sin(b), len: R * .55 });
      }
    }

    /* ---- houses along the streets, facing them ---- */
    let built = 0;
    for (const st of streets) {
      const px = -st.dz, pz = st.dx;
      const from = st.both ? -st.len : 28;
      for (let d = from; d < st.len; d += rng.range(13, 19)) {
        if (Math.abs(d) < 26) continue;                 // keep the plaza clear
        for (const side of [-1, 1]) {
          if (rng.chance(.16)) continue;                // gaps, yards, alleys
          const off = rng.range(9, 15) * side;
          const x = st.ox + st.dx * d + px * off;
          const z = st.oz + st.dz * d + pz * off;
          if (!ok(x, z)) continue;
          if (this.collideAt(x, z, 5)) continue;
          const yaw = Math.atan2(-px * side, -pz * side);
          const roll = rng();
          if (roll < .1) add(buildPagoda(rng, 2, rng.range(.6, .9)), x, z, { yaw, collide: 3.6 });
          else if (roll < .18) add(buildStall(rng), x, z, { yaw, drop: 0, collide: 1.8 });
          else add(buildHouse(rng, { scale: rng.range(.9, 1.35) }), x, z, { yaw, collide: 4.2 });
          built++;
          // Someone at the door, facing the street.
          if (rng.chance(.5)) spot(x - px * side * 5.5, z - pz * side * 5.5, yaw + Math.PI, 1);
        }
        // Street furniture.
        if (rng.chance(.3)) {
          const lx = st.ox + st.dx * d, lz = st.oz + st.dz * d;
          if (ok(lx, lz)) add(buildLantern(rng), lx, lz, { drop: 0, animate: true, fire: true });
        }
      }
      // A torii where each street leaves town.
      const ex = st.ox + st.dx * (st.len + 8), ez = st.oz + st.dz * (st.len + 8);
      if (ok(ex, ez, .5)) {
        add(buildTorii(rng, rng.range(1.1, 1.6)), ex, ez,
            { yaw: Math.atan2(st.dx, st.dz) + Math.PI / 2, drop: 0 });
        spot(ex - st.dx * 5, ez - st.dz * 5, Math.atan2(st.dx, st.dz), 2);
      }
    }

    /* ---- infill so the blocks are not hollow ---- */
    for (let i = 0; i < 26; i++) {
      const a = rng() * 6.28, r = 30 + Math.sqrt(rng()) * (R - 30);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (!ok(x, z)) continue;
      if (this.collideAt(x, z, 6)) continue;
      add(buildHouse(rng, { scale: rng.range(.85, 1.2) }), x, z,
          { yaw: -a + Math.PI / 2 + rng.range(-.4, .4), collide: 4 });
      built++;
    }

    /* ---- everyday clutter ---- */
    for (let i = 0; i < rng.int(10, 18); i++) {
      const a = rng() * 6.28, r = 14 + Math.sqrt(rng()) * (R - 14);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (!ok(x, z) || this.collideAt(x, z, 2.5)) continue;
      const roll = rng();
      const obj = roll < .3 ? buildCart(rng, { wrecked: false })
                : roll < .55 ? buildFence(rng, rng.int(3, 8), {})
                : roll < .75 ? buildBanner(rng, {})
                : roll < .9 ? buildStatue(rng)
                : buildWell(rng);
      add(obj, x, z, { yaw: rng() * 6.28, drop: 0 });
      if (roll >= .75 && rng.chance(.5)) spot(x + rng.range(-4, 4), z + rng.range(-4, 4), rng() * 6.28, 1);
    }

    /* ---- a wall around the ones that would have one ---- */
    if (style === 'ring' || style === 'grid') {
      const WR = R + 12, segs = Math.round(WR * .55);
      for (let i = 0; i < segs; i++) {
        if (rng.chance(.14)) continue;                  // gateways
        const a = (i / segs) * 6.28;
        const x = center.x + Math.cos(a) * WR, z = center.z + Math.sin(a) * WR;
        if (!ok(x, z, .55)) continue;
        add(buildFence(rng, 6, {}), x, z, { yaw: a + Math.PI / 2, drop: 0, collide: 1.3 });
      }
      for (let i = 0; i < 3; i++) {
        const a = rng() * 6.28;
        const x = center.x + Math.cos(a) * (WR - 6), z = center.z + Math.sin(a) * (WR - 6);
        if (!ok(x, z, .4)) continue;
        add(buildWatchtower(rng, {}), x, z, { yaw: rng() * 6.28, drop: 0, collide: 2.2 });
        spot(x + rng.range(-5, 5), z + rng.range(-5, 5), a + Math.PI, 2);
      }
    }

    // Plaza spots last so they sort to the front for the important people.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.28 + .5, r = rng.range(7, 13);
      spot(center.x + Math.cos(a) * r, center.z + Math.sin(a) * r, a + Math.PI, 3);
    }
    // Best spots first.
    this.npcSpots.sort((p, q) => q.prominence - p.prominence);
    this.villageSize = built;
  }

  /** Distance to the nearest fire, or Infinity. */
  fireDistance(pos) {
    let best = Infinity;
    for (const f of this.fires) {
      const dx = f.x - pos.x, dz = f.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /** True if a position is inside the safe hub radius. */
  inHub(pos, radius = null) {
    // Villages are 90-140 m across now, so the default has to follow the
    // village rather than sit at the old fixed 78 m.
    const R = radius ?? (this.hubRadius ?? 78);
    return this.world.hub && this.hubCenter.distanceTo(pos) < R;
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
    const cellFires = [];
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
    const bCount = Math.floor((w.density?.buildings ?? .2) * 4 * scale);
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
      if (roll < .16)      { obj = buildLantern(rng); animate = true; cellFires.push({ x, z }); }
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

    /* --- settlements ---
     * A world with a settled population should have somewhere to live every
     * few hundred metres, not a one-in-five chance of a hamlet per square
     * kilometre. Each cell gets several attempts, and the hamlets themselves
     * range from three huts round a well to a walled village with a
     * watchtower over it. */
    /* Capped hard, and paid for by quality. A walled village is forty-odd
     * groups; several per cell across sixty loaded cells is tens of
     * thousands of draw calls, which is what happened the first time this
     * was widened. Two attempts is enough to make country feel settled. */
    const tries = Math.min(2, Math.max(1, Math.round((w.density?.buildings ?? .2) * 2 * scale)));
    for (let t = 0; t < tries; t++) {
      if (!rng.chance(.38)) continue;
      const hx = ox + rng.range(-CELL / 2 + 40, CELL / 2 - 40);
      const hz = oz + rng.range(-CELL / 2 + 40, CELL / 2 - 40);
      if (!T.isFlatGround(hx, hz, .2)) continue;
      if (this.inHub(tmpP.set(hx, 0, hz), 130)) continue;
      this._buildHamlet(g, hx, hz, rng, colliders, cellAnimated, cellFires);
    }

    /* --- theme flourishes --- */
    /* "Dunes over drowned cities." The waste is not empty, it is covered:
     * every so often a street corner of somewhere older surfaces — the top
     * third of a pagoda, a torii with only its crossbeam clear, a colonnade
     * running off under the sand. They are sunk, not ruined, so the geometry
     * is the ordinary architecture pushed down into the ground. */
    if (w.theme === 'desert' && rng.chance(.5)) {
      const bx = ox + rng.range(-CELL / 2 + 30, CELL / 2 - 30);
      const bz = oz + rng.range(-CELL / 2 + 30, CELL / 2 - 30);
      if (T.isFlatGround(bx, bz, .5) && !this.inHub(tmpP.set(bx, 0, bz), 120)) {
        const bearing = rng() * 6.28;            // the buried street's line
        const n = rng.int(3, 8);
        for (let i = 0; i < n; i++) {
          // Strung out along the street, so it reads as one place, not litter.
          const along = (i - n / 2) * rng.range(7, 13);
          const off = rng.range(-4, 4);
          const x = bx + Math.cos(bearing) * along - Math.sin(bearing) * off;
          const z = bz + Math.sin(bearing) * along + Math.cos(bearing) * off;
          if (Math.max(Math.abs(x), Math.abs(z)) > T.half - 40) continue;
          const roll = rng();
          let obj, sink, radius = 1.6;
          if (roll < .30) { obj = buildTorii(rng, rng.range(.9, 1.5)); sink = rng.range(2.6, 4.4); }
          else if (roll < .52) { obj = buildPagoda(rng, rng.int(3, 4), rng.range(.7, 1)); sink = rng.range(6, 10); radius = 3; }
          else if (roll < .74) { obj = buildHouse(rng, { ruined: true, scale: rng.range(.9, 1.3) }); sink = rng.range(3.2, 4.8); radius = 3.4; }
          else if (roll < .90) { obj = buildStatue(rng); sink = rng.range(.6, 2.2); }
          else { obj = buildTemple(rng, rng.range(.35, .55)); sink = rng.range(3.4, 6); radius = 4; }
          obj.position.set(x, T.heightAt(x, z) - sink, z);
          obj.rotation.y = bearing + rng.range(-.25, .25);
          // Everything down here has been leaning for a very long time.
          obj.rotation.z = rng.range(-.16, .16);
          g.add(obj);
          colliders.push({ x, z, r: radius });
        }
        // Sand piled against the windward side of whatever is sticking up.
        for (let i = 0; i < rng.int(4, 9); i++) {
          const x = bx + rng.range(-34, 34), z = bz + rng.range(-34, 34);
          const r = buildRubble(rng);
          r.position.set(x, T.heightAt(x, z) - rng.range(0, .5), z);
          r.rotation.y = rng() * 6.28;
          g.add(r);
        }
      }
    }

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
    g.userData.fires = cellFires;
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
        if (g.userData.fires?.length) this.fires = this.fires.filter(f => f.cell !== key);
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
      for (const f of g.userData.fires || []) this.fires.push({ ...f, cell: key });
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

  /* ==========================================================
     The drowned city. Two streets crossing at a temple, all of it
     sunk to the eaves — you walk along what used to be third-storey
     roofline. Torii still stand at the ends of the streets because a
     torii is mostly air and the sand went through it.
     ========================================================== */
  _buildDrownedCity(center, rng) {
    const T = this.terrain;
    const place = (obj, x, z, sink, radius) => {
      obj.position.set(x, T.heightAt(x, z) - sink, z);
      obj.rotation.z = rng.range(-.13, .13);
      this.landmarks.add(obj);
      if (radius) {
        const c = { x, z, r: radius };
              }
    };

    const main = rng() * 6.28;
    for (const bearing of [main, main + Math.PI / 2]) {
      const len = rng.int(9, 14);
      for (let i = -len; i <= len; i++) {
        if (Math.abs(i) < 2) continue;                        // the crossing itself
        for (const side of [-1, 1]) {
          if (rng.chance(.22)) continue;                      // gaps: it is a ruin
          const along = i * rng.range(9, 12);
          const off = side * rng.range(7, 11);
          const x = center.x + Math.cos(bearing) * along - Math.sin(bearing) * off;
          const z = center.z + Math.sin(bearing) * along + Math.cos(bearing) * off;
          const roll = rng();
          let obj, sink, radius = 3.4;
          if (roll < .62) { obj = buildHouse(rng, { ruined: rng.chance(.6), scale: rng.range(.9, 1.4) }); sink = rng.range(3.4, 5); }
          else if (roll < .84) { obj = buildPagoda(rng, rng.int(3, 5), rng.range(.8, 1.2)); sink = rng.range(6, 10); radius = 3; }
          else { obj = buildStall(rng); sink = rng.range(1.2, 2.4); radius = 1.8; }
          obj.rotation.y = bearing + (side > 0 ? Math.PI : 0) + rng.range(-.2, .2);
          place(obj, x, z, sink, radius);
        }
      }
      // A torii at each end of the street, standing clear of the sand.
      for (const end of [-1, 1]) {
        const d = (len + 2) * 11 * end;
        const x = center.x + Math.cos(bearing) * d, z = center.z + Math.sin(bearing) * d;
        const t = buildTorii(rng, rng.range(1.3, 2));
        t.rotation.y = bearing + Math.PI / 2;
        place(t, x, z, rng.range(1.2, 2.6), 1.6);
      }
    }

    // The temple at the crossing, sunk deepest of all, and its lanterns.
    const temple = buildTemple(rng, 1.5);
    temple.rotation.y = main;
    place(temple, center.x, center.z, 13, 7);
    for (let i = 0; i < 8; i++) {
      const a = rng() * 6.28, r = rng.range(12, 40);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const s = buildStatue(rng);
      s.rotation.y = rng() * 6.28;
      place(s, x, z, rng.range(.4, 2.4), 1.2);
    }
    for (let i = 0; i < 30; i++) {
      const a = rng() * 6.28, r = Math.sqrt(rng()) * 120;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const rb = buildRubble(rng);
      rb.rotation.y = rng() * 6.28;
      place(rb, x, z, rng.range(0, .6), 0);
    }
  }

  /* ==========================================================
     One settlement: anything from three huts round a well up to
     a walled village with a tower over it and a fire in the
     middle. Placed into a streaming cell, so everything it makes
     goes onto that cell's own lists.
     ========================================================== */
  _buildHamlet(g, hx, hz, rng, colliders, cellAnimated, cellFires) {
    const T = this.terrain, w = this.world;
    const size = rng();
    const n = size > .93 ? rng.int(9, 14) : size > .45 ? rng.int(5, 8) : rng.int(3, 6);
    const spread = 9 + n * 1.5;
    const walled = size > .93;          // the expensive kind, kept rare

    for (let i = 0; i < n; i++) {
      // Two loose rings so a bigger village is not one thin circle.
      const ring = i < n * .6 ? 0 : 1;
      const k = ring === 0 ? i : i - Math.floor(n * .6);
      const cnt = ring === 0 ? Math.ceil(n * .6) : n - Math.ceil(n * .6);
      const a = (k / Math.max(1, cnt)) * 6.28 + rng.range(-.28, .28) + ring * .5;
      const r = ring === 0 ? rng.range(9, spread * .6) : rng.range(spread * .65, spread);
      const x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r;
      if (!T.isFlatGround(x, z, .3)) continue;
      let b;
      if (rng.chance(.14)) { b = buildStall(rng); colliders.push({ x, z, r: 1.8 }); }
      else if (rng.chance(.1)) { b = buildPagoda(rng, 2, rng.range(.55, .8)); colliders.push({ x, z, r: 3.4 }); }
      else { b = buildHouse(rng, { ruined: rng.chance(.18), scale: rng.range(.85, 1.25) }); colliders.push({ x, z, r: 4 }); }
      b.position.set(x, T.heightAt(x, z) - .2, z);
      b.rotation.y = -a + Math.PI / 2;
      g.add(b);
    }

    // The well everyone shares.
    const well = buildWell(rng);
    well.position.set(hx, T.heightAt(hx, hz), hz);
    g.add(well);
    colliders.push({ x: hx, z: hz, r: 1.4 });

    // Light. Also warmth, in a world where that matters.
    for (let i = 0; i < (walled ? 6 : 3); i++) {
      const a = rng() * 6.28, r = rng.range(4, spread);
      const lx = hx + Math.cos(a) * r, lz = hz + Math.sin(a) * r;
      const l = buildLantern(rng);
      l.position.set(lx, T.heightAt(lx, lz), lz);
      g.add(l);
      cellAnimated.push(l);
      cellFires.push({ x: lx, z: lz });
    }
    if (walled) {
      const br = buildBrazier();
      br.position.set(hx + 3, T.heightAt(hx + 3, hz + 2), hz + 2);
      g.add(br); cellAnimated.push(br);
      cellFires.push({ x: hx + 3, z: hz + 2 });
    }

    // Everyday clutter, so a village looks lived in rather than laid out.
    for (let i = 0; i < rng.int(2, 6); i++) {
      const a = rng() * 6.28, r = rng.range(6, spread);
      const x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r;
      const obj = rng.chance(.4) ? buildCart(rng, { wrecked: rng.chance(.25) })
                : rng.chance(.5) ? buildFence(rng, rng.int(3, 7), {})
                : buildBanner(rng, { torn: rng.chance(.3) });
      obj.position.set(x, T.heightAt(x, z), z);
      obj.rotation.y = rng() * 6.28;
      g.add(obj);
    }

    // A palisade and a tower over the big ones.
    if (walled) {
      const R = spread + 6;
      const segs = 16;
      for (let i = 0; i < segs; i++) {
        if (rng.chance(.22)) continue;               // gateways and gaps
        const a = (i / segs) * 6.28;
        const x = hx + Math.cos(a) * R, z = hz + Math.sin(a) * R;
        if (!T.isFlatGround(x, z, .45)) continue;
        const f = buildFence(rng, 5, { broken: rng.chance(.15) });
        f.position.set(x, T.heightAt(x, z), z);
        f.rotation.y = a + Math.PI / 2;
        g.add(f);
        colliders.push({ x, z, r: 1.2 });
      }
      const ta = rng() * 6.28;
      const tx = hx + Math.cos(ta) * (R - 4), tz = hz + Math.sin(ta) * (R - 4);
      if (T.isFlatGround(tx, tz, .35)) {
        const tower = buildWatchtower(rng, { ruined: rng.chance(.2) });
        tower.position.set(tx, T.heightAt(tx, tz), tz);
        tower.rotation.y = rng() * 6.28;
        g.add(tower);
        colliders.push({ x: tx, z: tz, r: 2.2 });
      }
      // A torii on the road in — every settlement in this world has one.
      const gx = hx - Math.cos(ta) * (R + 5), gz = hz - Math.sin(ta) * (R + 5);
      const tor = buildTorii(rng, rng.range(.9, 1.3));
      tor.position.set(gx, T.heightAt(gx, gz), gz);
      tor.rotation.y = ta + Math.PI / 2;
      g.add(tor);
    }
  }

  /* ==========================================================
     The waterhole. One tree big enough to see from a kilometre
     out, standing over the only water on the plain, ringed by
     what did not leave.
     ========================================================== */
  _buildWaterhole(center, rng) {
    const T = this.terrain;

    // The tree: an ordinary savanna canopy, four times over.
    const big = buildTree('savanna', rng);
    big.position.set(center.x, T.heightAt(center.x, center.z) - .4, center.z);
    big.scale.setScalar(4.2);
    big.rotation.y = rng() * 6.28;
    this.landmarks.add(big);
    this._addCollider(center.x, center.z, 2.4);

    // A handful of lesser trees leaning in toward the water.
    for (let i = 0; i < 7; i++) {
      const a = rng() * 6.28, r = rng.range(16, 40);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const t = buildTree('savanna', rng);
      t.position.set(x, T.heightAt(x, z) - .3, z);
      t.scale.setScalar(rng.range(1.2, 2.1));
      t.rotation.set(0, rng() * 6.28, rng.range(-.1, .1));
      this.landmarks.add(t);
      this._addCollider(x, z, 1);
    }

    // Bones. Whatever comes to drink is drinking somewhere it has been eaten.
    for (let i = 0; i < 26; i++) {
      const a = rng() * 6.28, r = 6 + Math.sqrt(rng()) * 34;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const bone = buildStuckSpear(rng);
      bone.position.set(x, T.heightAt(x, z) - rng.range(0, .3), z);
      bone.rotation.set(rng.range(-1.4, -.4), rng() * 6.28, rng.range(-.5, .5));
      bone.scale.setScalar(rng.range(.5, .95));
      this.landmarks.add(bone);
    }
    for (let i = 0; i < 12; i++) {
      const a = rng() * 6.28, r = 4 + Math.sqrt(rng()) * 26;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const rb = buildRubble(rng);
      rb.position.set(x, T.heightAt(x, z) - .2, z);
      rb.rotation.y = rng() * 6.28;
      this.landmarks.add(rb);
    }
    // Boulders on the rim, which is where you would sit to watch it.
    for (let i = 0; i < 9; i++) {
      const a = rng() * 6.28, r = rng.range(26, 46);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const rock = buildRock(rng, 'savanna');
      const s = rng.range(1.2, 2.8);
      rock.position.set(x, T.heightAt(x, z) - s * .35, z);
      rock.scale.setScalar(s);
      this.landmarks.add(rock);
      this._addCollider(x, z, s * .8);
    }
  }

  /* ==========================================================
     The cairn field. Rows of stacked stone, one marker per person
     the crossing took, thinning as they get further from the
     shrine because whoever was left had less time to build them.
     ========================================================== */
  _buildCairnField(center, rng) {
    const T = this.terrain;
    const ROWS = 15, COLS = 15, SPACING = 11;
    for (let r = -ROWS; r <= ROWS; r++) {
      for (let c = -COLS; c <= COLS; c++) {
        const d = Math.hypot(r, c);
        if (d < 1.6) continue;                              // the shrine's ground
        // Thinner further out: the survivors ran out of hands.
        if (rng() > clamp(1.15 - d / (ROWS * 1.05), .06, 1)) continue;
        const x = center.x + c * SPACING + rng.range(-2.4, 2.4);
        const z = center.z + r * SPACING + rng.range(-2.4, 2.4);
        if (Math.max(Math.abs(x), Math.abs(z)) > T.half - 40) continue;
        const y = T.heightAt(x, z);
        const cairn = buildCairn(rng, rng.range(.95, 1.7));
        cairn.position.set(x, y, z);
        cairn.rotation.y = rng() * 6.28;
        this.landmarks.add(cairn);
        this._addCollider(x, z, .55);
        // A few carry the spear of whoever is under them.
        if (rng.chance(.09)) {
          const sp = buildStuckSpear(rng);
          sp.position.set(x + rng.range(-1.4, 1.4), y, z + rng.range(-1.4, 1.4));
          this.landmarks.add(sp);
        }
      }
    }

    // The shrine, and the only fire out here.
    const shrine = buildPagoda(rng, 2, 1.05);
    shrine.position.set(center.x, T.heightAt(center.x, center.z), center.z);
    shrine.rotation.y = rng() * 6.28;
    this.landmarks.add(shrine);
    this._addCollider(center.x, center.z, 4.6);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * 6.28 + .4;
      const x = center.x + Math.cos(a) * 7, z = center.z + Math.sin(a) * 7;
      const br = buildBrazier();
      br.position.set(x, T.heightAt(x, z), z);
      this.landmarks.add(br);
      this.animated.push(br);
      this.fires.push({ x, z, cell: null });
    }
    for (const side of [-1, 1]) {
      const x = center.x + side * (COLS + 2) * SPACING;
      const t = buildTorii(rng, 1.5);
      t.position.set(x, T.heightAt(x, center.z), center.z);
      t.rotation.y = Math.PI / 2;
      this.landmarks.add(t);
    }
  }

  /** A permanent ring of standing rock, for a boss to hide in plain sight. */
  buildOutcrop(center, rng) {
    const T = this.terrain;
    for (let i = 0; i < 16; i++) {
      const a = rng() * 6.28, r = 7 + Math.sqrt(rng()) * 26;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const rock = buildRock(rng, this.world.theme);
      const s = rng.range(1.4, 4.2);
      rock.position.set(x, T.heightAt(x, z) - s * .3, z);
      rock.rotation.set(rng.range(-.2, .2), rng() * 6.28, rng.range(-.2, .2));
      rock.scale.set(s, s * rng.range(1.1, 2.3), s);
      this.landmarks.add(rock);
      this._addCollider(x, z, s * .8);
    }
  }

  /** A permanent collider: into the list and straight into the grid, so a
   *  landmark builder can test what it has already put down. */
  _addCollider(x, z, r) {
    const c = { x, z, r };
        this._gridAdd(c, null);
    return c;
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
    this.fires.length = 0;
    this.grid.clear();
  }
}
