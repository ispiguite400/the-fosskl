/* Closing storm for the duel arena.
 *
 * A circular safe zone shrinks in phases: each phase holds for a while, then
 * contracts to a smaller circle somewhere inside the old one. Standing
 * outside the wall costs health, and the damage climbs with every phase, so
 * a duel that stalls is decided by the storm rather than by attrition.
 *
 * The wall is a single double-sided cylinder with a scrolling shader — it
 * has to read from inside (you are being closed in on) and from outside
 * (you are in it and need to get back). */

import * as THREE from 'three';
import { clamp, lerp, damp, makeRNG } from '../core/util.js';
import { Audio } from '../core/audio.js';

const WALL_VS = `
varying vec2 vUv;
varying vec3 vWorld;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const WALL_FS = `
uniform vec3  uColor;
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
varying vec3 vWorld;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

void main(){
  // Three noise layers drifting upward at different rates give the wall
  // a churning, non-repeating surface.
  float n = noise(vec2(vUv.x * 42.0, vUv.y * 5.0 - uTime * 0.35)) * 0.55
          + noise(vec2(vUv.x * 90.0, vUv.y * 11.0 - uTime * 0.7)) * 0.30
          + noise(vec2(vUv.x * 180.0, vUv.y * 22.0 - uTime * 1.3)) * 0.15;

  // Denser near the ground and gone well before the top, so the wall never
  // swallows the sky when you are standing in the middle of a wide circle.
  float vert = pow(smoothstep(0.85, 0.02, vUv.y), 1.6);
  float band = 0.45 + 0.55 * n;
  float a = band * vert * uIntensity;

  // Hot leading edge where the wall meets the ground.
  a += smoothstep(0.14, 0.0, vUv.y) * 0.5 * uIntensity;

  vec3 col = uColor * (0.55 + n * 0.55);
  // Filaments running up the surface — kept subtle, because a cylinder
  // shows you its near and far face at once and they stack.
  col += vec3(0.75, 0.68, 1.0) * pow(n, 8.0) * 0.5;

  // Cap the alpha well below opaque: you have to be able to fight your way
  // back out of this, not be blinded by it.
  gl_FragColor = vec4(col, clamp(a * 0.55, 0.0, 0.6));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* Phase plan. `hold` is the calm before it moves, `shrink` how long the
 * contraction takes, `radius` where it ends up, `dps` the bite outside. */
const PHASES = [
  { hold: 45, shrink: 30, radius: 92, dps: 2 },
  { hold: 32, shrink: 26, radius: 62, dps: 4 },
  { hold: 26, shrink: 22, radius: 40, dps: 7 },
  { hold: 22, shrink: 18, radius: 24, dps: 11 },
  { hold: 18, shrink: 16, radius: 13, dps: 16 },
  { hold: 14, shrink: 14, radius: 6,  dps: 24 },
  { hold: 1e9, shrink: 0, radius: 6, dps: 34 }   // final: nowhere left to go
];

export class Storm {
  constructor(game, { center, radius = 140 } = {}) {
    this.game = game;
    this.rng = makeRNG((Math.random() * 0xffffffff) >>> 0);

    this.center = center.clone();
    this.targetCenter = center.clone();
    this.radius = radius;
    this.targetRadius = radius;

    this.phase = -1;
    this.state = 'hold';
    this.timer = 6;                  // grace before the first warning
    this.dps = 0;
    this._tickT = 0;
    this._warnT = 0;

    this._build();
    this.nextPhase(true);
  }

  /* ---------------- meshes ---------------- */
  _build() {
    const H = 160;
    this.uniforms = {
      uColor: { value: new THREE.Color(0x8a4dff) },
      uTime: { value: 0 },
      uIntensity: { value: 1 }
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: WALL_VS, fragmentShader: WALL_FS,
      transparent: true, depthWrite: false,
      // Normal blending, not additive: additive doubled up across the near
      // and far walls of the cylinder and blew the whole view to white.
      side: THREE.DoubleSide, blending: THREE.NormalBlending, fog: false
    });
    // Unit radius so the whole wall resizes by scaling.
    const geo = new THREE.CylinderGeometry(1, 1, H, 96, 1, true);
    this.wallGeoHeight = H;
    this.wall = new THREE.Mesh(geo, mat);
    this.wall.frustumCulled = false;
    this.wall.renderOrder = 800;
    this.game.scene.add(this.wall);

    // Faint ring on the ground showing where the next circle will be.
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x6fd8ff, transparent: true, opacity: .35,
      side: THREE.DoubleSide, depthWrite: false
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(.985, 1, 96), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 799;
    this.ring.frustumCulled = false;
    this.game.scene.add(this.ring);
  }

  /* ---------------- phases ---------------- */
  nextPhase(first = false) {
    this.phase++;
    const p = PHASES[Math.min(this.phase, PHASES.length - 1)];
    this.spec = p;

    // The new circle sits somewhere inside the current one, never outside.
    const room = Math.max(0, this.radius - p.radius);
    const a = this.rng() * Math.PI * 2;
    const r = Math.sqrt(this.rng()) * room * .78;
    this.targetCenter.set(
      this.center.x + Math.cos(a) * r, 0,
      this.center.z + Math.sin(a) * r
    );
    this.targetRadius = p.radius;

    this.state = 'hold';
    this.timer = first ? 12 : p.hold;
    this.dps = p.dps;

    if (!first) {
      this.game.hud?.toast(`THE STORM IS COMING — PHASE ${this.phase + 1}`, true);
      Audio.sfx('thunder', { volume: .5 });
    }
  }

  _beginShrink() {
    this.state = 'shrink';
    this.timer = this.spec.shrink;
    this._shrinkFrom = { r: this.radius, c: this.center.clone() };
    this.game.hud?.toast('THE STORM IS CLOSING', true);
    Audio.sfx('bossRoar', { volume: .45 });
  }

  /* ---------------- per frame ---------------- */
  update(dt, players) {
    this.uniforms.uTime.value += dt;
    this.timer -= dt;

    if (this.state === 'hold') {
      if (this.timer <= 0) this._beginShrink();
    } else {
      const total = Math.max(.001, this.spec.shrink);
      const k = clamp(1 - this.timer / total, 0, 1);
      // Ease so it starts gently and settles rather than snapping shut.
      const e = k * k * (3 - 2 * k);
      this.radius = lerp(this._shrinkFrom.r, this.targetRadius, e);
      this.center.lerpVectors(this._shrinkFrom.c, this.targetCenter, e);
      if (this.timer <= 0) {
        this.radius = this.targetRadius;
        this.center.copy(this.targetCenter);
        if (this.phase < PHASES.length - 1) this.nextPhase();
        else { this.state = 'hold'; this.timer = 1e9; }
      }
    }

    /* --- damage anyone outside --- */
    this._tickT -= dt;
    const tick = this._tickT <= 0;
    if (tick) this._tickT = .5;

    let anyOutside = false;
    for (const p of players) {
      if (!p || p.dead) continue;
      const d = Math.hypot(p.pos.x - this.center.x, p.pos.z - this.center.z);
      const outside = d > this.radius;
      p.inStorm = outside;
      if (!outside) continue;
      anyOutside = true;
      if (tick) {
        p.hp -= this.dps * .5;
        this.game.hud?.flashDamage?.();
        this.game.rumble(p.index, .3, .5, 180);
        if (p.hp <= 0) p.die();
      }
    }

    // Warn whoever is caught out, on a cadence rather than every frame.
    this._warnT -= dt;
    if (anyOutside && this._warnT <= 0) {
      Audio.sfx('hurt', { volume: .35 });
      this._warnT = 1.6;
    }

    /* --- visuals --- */
    /* The wall is a wall, not a dome. Height tracks the radius so that a
     * wide opening circle stays a band on the horizon rather than covering
     * everything above it. */
    const wallH = clamp(this.radius * .55, 24, 90);
    const groundY = this.game.terrain.heightAt(this.center.x, this.center.z);
    this.wall.scale.set(this.radius, wallH / this.wallGeoHeight, this.radius);
    this.wall.position.set(this.center.x, groundY + wallH / 2 - 6, this.center.z);
    this.uniforms.uIntensity.value = damp(
      this.uniforms.uIntensity.value, anyOutside ? 1.25 : 1, 3, dt);
    // Redder and angrier the further in it has closed.
    this.uniforms.uColor.value.setHSL(
      lerp(.74, .86, this.phase / (PHASES.length - 1)), .85, .58);

    const showRing = this.state === 'hold' && this.phase < PHASES.length - 1;
    this.ring.visible = showRing;
    if (showRing) {
      const y = this.game.terrain.heightAt(this.targetCenter.x, this.targetCenter.z);
      this.ring.position.set(this.targetCenter.x, y + .35, this.targetCenter.z);
      this.ring.scale.set(this.targetRadius, this.targetRadius, 1);
      this.ring.material.opacity = .22 + Math.sin(this.uniforms.uTime.value * 2.4) * .12;
    }
  }

  /** Metres a player must travel to be safe, or 0 if they already are. */
  distanceOutside(p) {
    const d = Math.hypot(p.pos.x - this.center.x, p.pos.z - this.center.z);
    return Math.max(0, d - this.radius);
  }

  /** HUD summary. */
  status() {
    return {
      phase: this.phase + 1,
      phases: PHASES.length,
      closing: this.state === 'shrink',
      seconds: Math.max(0, Math.ceil(this.timer)),
      radius: this.radius,
      dps: this.dps
    };
  }

  dispose() {
    this.game.scene.remove(this.wall, this.ring);
    this.wall.geometry.dispose(); this.wall.material.dispose();
    this.ring.geometry.dispose(); this.ring.material.dispose();
  }
}
