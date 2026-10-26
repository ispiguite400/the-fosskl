/*
 * A built map: geometry, light, atmosphere, collision, navigation and the things in it
 * that the match uses (spawns, generator spots, item spots).
 *
 *   const world = buildWorld(renderer, MAPDEF)
 *   world.scene / world.collision / world.nav / world.spawns / world.gens / world.items
 *   world.update(dt, focus)     lights follow the camera, fires flicker, particles drift
 */
import * as THREE from 'three';
import { Parts } from './parts.js';
import { CollisionWorld } from './collide.js';
import { NavGrid } from './nav.js';
import { makeSky, skyEnvironment } from '../render/sky.js';
import { rng } from '../core/util.js';

// map lamps are written in friendly numbers (a street lamp is about 7); three.js lights are physical
const LIGHT_GAIN = 22;

export function buildWorld(renderer, def, seed = 1) {
  const r = rng(seed * 7919 + def.id.length);
  const P = new Parts();
  const A = def.ambience;
  const info = def.build(P, r) || {};
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(A.fog.color);
  scene.fog = new THREE.FogExp2(A.fog.color, A.fog.density);

  // sky and reflections
  const sky = makeSky(A.sky);
  scene.add(sky);
  scene.environment = skyEnvironment(renderer.gl, sky);
  scene.environmentIntensity = A.envIntensity === undefined ? 0.6 : A.envIntensity;

  // light: a hemisphere fill and one shadowed key (the moon or the sun)
  const hemi = new THREE.HemisphereLight(A.hemi.sky, A.hemi.ground, A.hemi.intensity);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(A.sun.color, A.sun.intensity);
  const sd = new THREE.Vector3(...A.sun.dir).normalize();
  sun.castShadow = true;
  const q = renderer.q;
  sun.shadow.mapSize.set(q.shadow, q.shadow);
  const sc = sun.shadow.camera; sc.left = -q.shadowFar / 2; sc.right = q.shadowFar / 2; sc.top = q.shadowFar / 2; sc.bottom = -q.shadowFar / 2; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
  scene.add(sun); scene.add(sun.target);

  const geo = P.build();
  scene.add(geo);
  for (const e of info.extra || []) scene.add(e);

  // a pool of point lights, given to the map's lamps nearest the camera each frame
  const pool = [];
  for (let i = 0; i < q.maxLights; i++) { const l = new THREE.PointLight(0xffffff, 0, 10, 1.6); l.castShadow = false; scene.add(l); pool.push(l); }
  // and a glow sprite on every lamp, so distant ones still read
  const glowTex = glowTexture();
  for (const L of P.lights) {
    if (L.glow === false) continue;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: L.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, fog: true }));
    s.position.set(L.x, L.y, L.z); s.scale.setScalar(L.glowSize || 1.6);
    scene.add(s); L.sprite = s;
  }

  const bounds = def.bounds || { minX: -def.size[0] / 2, maxX: def.size[0] / 2, minZ: -def.size[1] / 2, maxZ: def.size[1] / 2 };
  // the edge of the map is a wall
  const edge = [[0, bounds.minZ - 1, (bounds.maxX - bounds.minX) / 2 + 2, 1], [0, bounds.maxZ + 1, (bounds.maxX - bounds.minX) / 2 + 2, 1], [bounds.minX - 1, 0, 1, (bounds.maxZ - bounds.minZ) / 2 + 2], [bounds.maxX + 1, 0, 1, (bounds.maxZ - bounds.minZ) / 2 + 2]];
  for (const [x, z, hw, hd] of edge) P.colliders.push({ type: 'box', x, z, hw, hd, ry: 0, y0: -5, y1: 30, sight: true });
  const collision = new CollisionWorld(P.colliders);
  const nav = new NavGrid(bounds, P.colliders);
  const spawnS = info.spawns && info.spawns.survivor ? info.spawns.survivor : [[0, 0]];
  nav.floodFrom(spawnS[0][0], spawnS[0][1]);

  const particles = makeParticles(A.particles, bounds, r);
  if (particles) scene.add(particles.points);

  const world = {
    def, scene, sky, sun, hemi, collision, nav, bounds, rand: r,
    spawns: info.spawns || { survivor: [[0, 0]], killer: [[0, 10]] },
    gens: info.gens || [], items: info.items || [], hides: info.hides || [], spots: info.spots || {},
    lights: P.lights, events: info.events || [], time: 0,
    lightScale: 1,                       // map events dim or kill the lamps
    update(dt, focus) {
      this.time += dt;
      sky.userData.tick(dt);
      // keep the shadow box on the action, snapped to texels so it does not shimmer
      const half = q.shadowFar / 2, texel = q.shadowFar / q.shadow;
      const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
      sun.position.set(fx + sd.x * 60, sd.y * 60, fz + sd.z * 60);
      sun.target.position.set(fx, 0, fz);
      void half;
      // nearest lamps get the pool
      const ls = P.lights;
      for (const L of ls) L._d = (L.x - focus.x) ** 2 + (L.z - focus.z) ** 2;
      const near = ls.slice().sort((a, b) => a._d - b._d);
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i], L = near[i];
        if (!L || L._d > 50 * 50) { l.intensity = 0; continue; }
        const fl = L.flicker ? (1 - L.flicker * 0.5 + Math.sin(this.time * 17 + i * 3) * L.flicker * 0.25 + Math.sin(this.time * 41 + i) * L.flicker * 0.25) : 1;
        l.position.set(L.x, L.y, L.z); l.color.setHex(L.color); l.distance = L.distance; l.decay = L.decay;
        l.intensity = L.intensity * LIGHT_GAIN * fl * this.lightScale * (L.off ? 0 : 1);
      }
      for (const L of ls) if (L.sprite) L.sprite.material.opacity = 0.55 * this.lightScale * (L.off ? 0 : 1);
      if (particles) particles.update(dt, focus);
    }
  };
  return world;
}

let _glow = null;
function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}

/* Ambient particles: embers, ash, rain, snow, fireflies, dust, motes. */
function makeParticles(kind, bounds, r) {
  if (!kind) return null;
  const spec = {
    embers: { n: 500, color: 0xff8a3a, size: 0.12, rise: 1.2, drift: 0.6, blend: THREE.AdditiveBlending, area: 40 },
    ash: { n: 900, color: 0x9a9690, size: 0.07, rise: -0.5, drift: 0.5, blend: THREE.NormalBlending, area: 40 },
    rain: { n: 2600, color: 0x9fb4d0, size: 0.06, rise: -16, drift: 1.2, blend: THREE.NormalBlending, area: 34, streak: true },
    snow: { n: 1800, color: 0xffffff, size: 0.1, rise: -1.2, drift: 0.8, blend: THREE.NormalBlending, area: 38 },
    fireflies: { n: 220, color: 0xd9ff6b, size: 0.14, rise: 0.1, drift: 0.7, blend: THREE.AdditiveBlending, area: 40, blink: true },
    dust: { n: 700, color: 0xd8cfb8, size: 0.05, rise: 0.05, drift: 0.3, blend: THREE.AdditiveBlending, area: 30 },
    motes: { n: 600, color: 0xb98cff, size: 0.11, rise: 0.4, drift: 0.5, blend: THREE.AdditiveBlending, area: 40, blink: true }
  }[kind];
  if (!spec) return null;
  const pos = new Float32Array(spec.n * 3), vel = new Float32Array(spec.n * 3);
  for (let i = 0; i < spec.n; i++) {
    pos[i * 3] = (r() - 0.5) * spec.area * 2; pos[i * 3 + 1] = r() * 14; pos[i * 3 + 2] = (r() - 0.5) * spec.area * 2;
    vel[i * 3] = (r() - 0.5) * spec.drift; vel[i * 3 + 1] = spec.rise * (0.6 + r() * 0.8); vel[i * 3 + 2] = (r() - 0.5) * spec.drift;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: spec.color, size: spec.size, map: glowTexture(), transparent: true, depthWrite: false, blending: spec.blend, opacity: 0.85, sizeAttenuation: true });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  let t = 0;
  return {
    points,
    update(dt, focus) {
      t += dt;
      const A = spec.area;
      for (let i = 0; i < spec.n; i++) {
        let x = pos[i * 3] + (vel[i * 3] + Math.sin(t * 0.7 + i) * spec.drift * 0.3) * dt, y = pos[i * 3 + 1] + vel[i * 3 + 1] * dt, z = pos[i * 3 + 2] + (vel[i * 3 + 2] + Math.cos(t * 0.5 + i * 1.3) * spec.drift * 0.3) * dt;
        // wrap round the camera so the field always surrounds the player
        if (x - focus.x > A) x -= 2 * A; else if (x - focus.x < -A) x += 2 * A;
        if (z - focus.z > A) z -= 2 * A; else if (z - focus.z < -A) z += 2 * A;
        if (y < 0) y += 14; else if (y > 14) y -= 14;
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      }
      geo.attributes.position.needsUpdate = true;
      if (spec.blink) mat.opacity = 0.6 + Math.sin(t * 3) * 0.25;
    }
  };
}
