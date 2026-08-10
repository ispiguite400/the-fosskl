/* Sky, weather and the day/night cycle.
 *
 * Every world runs dawn -> noon -> sunset -> night on a continuous clock.
 * The sky is a shader dome with a physically-flavoured gradient, a sun disc
 * and a star field that fades in after dusk. Rain rolls in stochastically,
 * greys the sky, and drives the audio bed. */

import * as THREE from 'three';
import { clamp, lerp, makeRNG } from '../core/util.js';

const DAY_LENGTH = 480;      // seconds for a full cycle (8 real minutes)
export const SKY_RADIUS = 4200;   // keep well inside the camera far plane

const SKY_VS = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const SKY_FS = `
uniform vec3  uZenith;
uniform vec3  uHorizon;
uniform vec3  uGround;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform float uSunIntensity;
uniform float uStars;
uniform float uMoon;
uniform float uOvercast;
uniform float uTime;
varying vec3 vDir;

// Cheap hash-based star field on the direction vector.
float hash31(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.1,0.2,0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float stars(vec3 d){
  vec3 g = floor(d * 220.0);
  float h = hash31(g);
  float bright = smoothstep(0.9975, 1.0, h);
  // Slight twinkle, offset per-cell so they don't pulse in unison.
  float tw = 0.75 + 0.25 * sin(uTime * 2.2 + h * 100.0);
  return bright * tw;
}

void main(){
  vec3 d = normalize(vDir);
  float up = d.y;

  // Base gradient: ground haze -> horizon -> zenith.
  float t = clamp(up * 0.5 + 0.5, 0.0, 1.0);
  // A gentle exponent leaves a very wide pale band hugging the horizon,
  // which reads as a blown-out white sky. Bring the zenith colour down.
  vec3 col = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.38));
  col = mix(uGround, col, smoothstep(-0.12, 0.06, up));

  // Sun disc + halo, warmed toward the horizon.
  float sd = max(dot(d, uSunDir), 0.0);
  float disc = smoothstep(0.9992, 0.9997, sd);
  float halo = pow(sd, 220.0) * 0.55 + pow(sd, 12.0) * 0.22 + pow(sd, 3.0) * 0.06;
  col += uSunColor * (disc * 14.0 + halo) * uSunIntensity;

  // Moon, opposite the sun.
  vec3 md = -uSunDir;
  float mdot = max(dot(d, md), 0.0);
  float moonDisc = smoothstep(0.9994, 0.9998, mdot);
  col += vec3(0.86, 0.9, 1.0) * (moonDisc * 9.0 + pow(mdot, 60.0) * 0.3) * uMoon;

  // Stars only above the horizon, and only at night.
  if (up > 0.0) {
    col += vec3(0.9, 0.93, 1.0) * stars(d) * uStars * (1.0 - uOvercast * 0.9);
    // Faint band of galactic light.
    float band = exp(-pow((d.y - d.x * 0.28) * 3.2, 2.0));
    col += vec3(0.36, 0.4, 0.62) * band * uStars * 0.1 * (1.0 - uOvercast);
  }

  // Overcast washes everything toward flat grey.
  col = mix(col, vec3(0.42, 0.44, 0.47) * (0.42 + uSunIntensity * 0.5), uOvercast);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(scene, world, renderer) {
    this.scene = scene;
    this.world = world;
    // Phase 0.25 is sunrise, 0.5 noon, 0.75 sunset, 0 midnight.
    // Worlds may pick their own opening light; the ruins want late gold.
    this.time = (world.startPhase ?? .42) * DAY_LENGTH;
    this.rain = 0;                    // 0..1 current intensity
    this.rainTarget = 0;
    this.forcedRain = null;
    this._rainTimer = 40 + Math.random() * 180;

    const p = world.palette;

    this.uniforms = {
      uZenith:      { value: new THREE.Color(0x2f6fb0) },
      uHorizon:     { value: new THREE.Color(p.sky) },
      uGround:      { value: new THREE.Color(p.fog) },
      uSunDir:      { value: new THREE.Vector3(0, 1, 0) },
      uSunColor:    { value: new THREE.Color(world.sun.color) },
      uSunIntensity:{ value: 1 },
      uStars:       { value: 0 },
      uMoon:        { value: 0 },
      uOvercast:    { value: 0 },
      uTime:        { value: 0 }
    };

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 24),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader: SKY_VS, fragmentShader: SKY_FS,
        side: THREE.BackSide, depthWrite: false, fog: false
      })
    );
    // Must stay comfortably inside the camera far plane or the dome clips.
    this.dome.scale.setScalar(SKY_RADIUS);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    scene.add(this.dome);

    /* ---- lighting ---- */
    this.sun = new THREE.DirectionalLight(world.sun.color, world.sun.intensity);
    this.sun.castShadow = true;
    // Shadow detail is (frustum width / map size). A tight box around the
    // player at 4k gives ~2cm per texel instead of ~19cm, which is the
    // difference between readable contact shadows and grey mush.
    const q = renderer?.shadowQuality ?? 'high';
    const MAP = { low: 1024, medium: 2048, high: 4096, ultra: 4096 }[q] ?? 4096;
    const S = { low: 70, medium: 60, high: 55, ultra: 45 }[q] ?? 55;
    this.sun.shadow.mapSize.set(MAP, MAP);
    Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 600 });
    this.sun.shadow.bias = -0.00022;
    this.sun.shadow.normalBias = .022;
    this.sun.shadow.radius = 2.2;
    this.shadowSpan = S;
    scene.add(this.sun);
    scene.add(this.sun.target);

    /* Moonlight is its own key light rather than a bump to the ambient —
     * it casts shadows, so a night world still has shape and direction. */
    const moon = world.moon || { intensity: .85, color: 0x93a9d8 };
    this.moon = new THREE.DirectionalLight(moon.color, 0);
    this.moonBase = moon.intensity;
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(this.sun.shadow.mapSize.x, this.sun.shadow.mapSize.y);
    // Copy the frustum bounds only — Object3D.position is read-only, so a
    // blanket Object.assign of the camera throws.
    Object.assign(this.moon.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 600 });
    this.moon.shadow.camera.updateProjectionMatrix();
    this.moon.shadow.bias = -0.0003;
    this.moon.shadow.normalBias = .03;
    scene.add(this.moon);
    scene.add(this.moon.target);

    this.hemi = new THREE.HemisphereLight(p.sky, p.ground, .45);
    scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xffffff, .14);
    scene.add(this.ambient);

    /* ---- fog ---- */
    scene.fog = new THREE.FogExp2(p.fog, this._baseFog());

    /* ---- clouds ---- */
    this._buildClouds();
    /* ---- rain ---- */
    this._buildRain();

    /* ---- image-based lighting ----
     * Baking the sky into a prefiltered cube map gives every PBR material
     * real reflections and sky bounce. Without it, metal reads as flat
     * plastic no matter how the roughness is set. */
    this.renderer = renderer;
    if (renderer) {
      this._pmrem = new THREE.PMREMGenerator(renderer);
      this._pmrem.compileEquirectangularShader();
      this._envScene = new THREE.Scene();
      // A private copy of the dome so baking never disturbs the live one.
      this._envDome = new THREE.Mesh(this.dome.geometry, this.dome.material);
      this._envDome.scale.setScalar(10);
      this._envScene.add(this._envDome);
      this._envT = 0;
      this._bakeEnvironment();
    }
  }

  /** Re-bake the environment map. Cheap enough for a few times a minute. */
  _bakeEnvironment() {
    if (!this._pmrem) return;
    try {
      const rt = this._pmrem.fromScene(this._envScene, 0, .1, 100);
      this.scene.environment?.dispose?.();
      this.scene.environment = rt.texture;
      this._envRT?.dispose();
      this._envRT = rt;
    } catch (e) {
      console.warn('[sky] environment bake failed', e);
      this._pmrem = null;
    }
  }

  _baseFog() {
    // Low enough that hills a kilometre out are still visible.
    return { ruins: .0013, forest: .0030, snow: .0026, desert: .0014,
             ocean: .0016, sky: .0018, kingdom: .0016 }[this.world.theme] ?? .0018;
  }

  /* ---------------- clouds ---------------- */
  _buildClouds() {
    const rng = makeRNG(4242);
    const tex = this._cloudTexture();
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: .34, depthWrite: false, fog: false
    });
    /* Clouds are flat planes. Seen from below at a grazing angle they are
     * foreshortened to slivers that pile up along the horizon and stack to a
     * solid white band — which is exactly what a duel in world two looked
     * like. Fade each one out as it turns edge-on to the camera. */
    mat.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          varying float vFacing;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vFacing = abs(normalize(normalMatrix * vec3(0.0, 0.0, 1.0)).z);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vFacing;`)
        .replace('#include <opaque_fragment>', `
          gl_FragColor.a *= smoothstep(0.06, 0.42, vFacing);
          #include <opaque_fragment>`);
    };
    this.clouds = new THREE.Group();
    const n = this.world.theme === 'sky' ? 90 : 38;
    for (let i = 0; i < n; i++) {
      const s = rng.range(400, 1400);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s * rng.range(.35, .6)), mat);
      // Kept high and reasonably close in, so they read overhead rather than
      // as a wall of haze at eye level.
      const a = rng() * Math.PI * 2, r = rng.range(300, 2200);
      m.position.set(Math.cos(a) * r, rng.range(620, 1350), Math.sin(a) * r);
      m.rotation.x = -Math.PI / 2 + rng.range(-.06, .06);
      m.rotation.z = rng() * Math.PI;
      m.renderOrder = -900;
      m.userData.drift = rng.range(1.5, 5);
      this.clouds.add(m);
    }
    this.scene.add(this.clouds);
  }

  _cloudTexture() {
    const s = 256, c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(s, s), d = img.data;
    const rng = makeRNG(99);
    // Radial falloff x fbm = a soft, non-repeating puff.
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = (y * s + x) * 4;
        const dx = (x / s - .5) * 2, dy = (y / s - .5) * 2;
        const rad = clamp(1 - Math.hypot(dx, dy * 1.7), 0, 1);
        let n = 0, amp = 1, f = 3;
        for (let o = 0; o < 5; o++) {
          n += amp * Math.abs(Math.sin(x * .04 * f + rng.range(0, .01)) * Math.cos(y * .05 * f));
          amp *= .55; f *= 2;
        }
        const a = clamp(rad * rad * (0.45 + n * .55), 0, 1);
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  /* ---------------- rain ---------------- */
  _buildRain() {
    const N = 9000;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N);
    const rng = makeRNG(7);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rng.range(-40, 40);
      pos[i * 3 + 1] = rng.range(0, 46);
      pos[i * 3 + 2] = rng.range(-40, 40);
      vel[i] = rng.range(38, 62);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this._rainVel = vel;

    const mat = new THREE.PointsMaterial({
      color: 0xbfd4e2, size: .12, transparent: true, opacity: 0,
      depthWrite: false, sizeAttenuation: true
    });
    this.rainMesh = new THREE.Points(geo, mat);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    this.scene.add(this.rainMesh);
  }

  /** Force rain on or off (used by the story beat after Hana dies). */
  setRain(on, duration = 0) {
    this.forcedRain = on ? { until: this.time + duration } : null;
    this.rainTarget = on ? 1 : 0;
    if (duration > 0) this._forcedUntilRealtime = performance.now() + duration * 1000;
  }

  /* ---------------- per frame ---------------- */
  update(dt, playerPos, audio) {
    // A world may run its cycle slower, or hold a single hour entirely.
    this.time += dt * (this.world.dayScale ?? 1);
    this.uniforms.uTime.value += dt;
    const cycle = (this.time % DAY_LENGTH) / DAY_LENGTH;   // 0..1
    this.dayPhase = cycle;

    /* Sun path: rises at 0.25, peaks at 0.5, sets at 0.75, midnight at 0. */
    const sunAngle = cycle * Math.PI * 2 - Math.PI / 2;
    const tilt = (this.world.sun.azimuth || 180) * Math.PI / 180;
    const elev = Math.sin(sunAngle);
    const dir = new THREE.Vector3(
      Math.cos(sunAngle) * Math.sin(tilt),
      elev,
      Math.cos(sunAngle) * Math.cos(tilt)
    ).normalize();
    this.uniforms.uSunDir.value.copy(dir);

    const above = clamp(elev, -1, 1);
    // lightFloor lets a world sit at golden hour without going dark.
    const floor = this.world.lightFloor ?? 0;
    const daylight = Math.max(floor, clamp(above * 1.6 + .18, 0, 1));
    const dusk = clamp(1 - Math.abs(above) * 4.5, 0, 1);      // peaks at the horizon
    const night = clamp(-above * 2.6, 0, 1);

    /* ---- weather ---- */
    if (this.forcedRain) {
      if (this._forcedUntilRealtime && performance.now() > this._forcedUntilRealtime) {
        this.forcedRain = null; this.rainTarget = 0;
      }
    } else {
      this._rainTimer -= dt;
      if (this._rainTimer <= 0) {
        const wet = { forest: .45, ocean: .4, snow: .35, grassland: .3, ruins: .25,
                      kingdom: .3, roman: .2, savanna: .15, sky: .15, desert: .04 }[this.world.theme] ?? .25;
        this.rainTarget = Math.random() < wet ? 1 : 0;
        this._rainTimer = this.rainTarget ? 60 + Math.random() * 120 : 120 + Math.random() * 300;
      }
    }
    this.rain = lerp(this.rain, this.rainTarget, Math.min(1, dt * .28));

    if (audio) {
      if (this.rain > .25 && !this._rainAudio) { audio.startRain(); this._rainAudio = true; }
      else if (this.rain <= .2 && this._rainAudio) { audio.stopRain(); this._rainAudio = false; }
    }

    /* ---- sky colours ---- */
    const p = this.world.palette;
    const zenithDay = new THREE.Color(0x2f6fb0);
    const zenithNight = new THREE.Color(0x040814);
    const horizonDay = new THREE.Color(p.sky);
    const horizonDusk = new THREE.Color(0xff7a2b);
    const horizonNight = new THREE.Color(0x0b1024);

    const zen = zenithDay.clone().lerp(zenithNight, night);
    const hor = horizonDay.clone().lerp(horizonDusk, dusk * .85).lerp(horizonNight, night);
    this.uniforms.uZenith.value.copy(zen);
    this.uniforms.uHorizon.value.copy(hor);
    this.uniforms.uGround.value.copy(new THREE.Color(p.fog).lerp(new THREE.Color(0x05070f), night));
    this.uniforms.uSunIntensity.value = daylight;
    this.uniforms.uStars.value = clamp(night * 1.3, 0, 1);
    this.uniforms.uMoon.value = clamp(night * 1.2, 0, 1);
    this.uniforms.uOvercast.value = this.rain * .85;
    this.uniforms.uSunColor.value.copy(new THREE.Color(this.world.sun.color))
      .lerp(new THREE.Color(0xff6a2b), dusk);

    /* ---- lights ---- */
    // Push the key light harder and pull the fill down — flat ambient was
    // washing the shadows out entirely.
    const sunI = this.world.sun.intensity * 1.45 * daylight * (1 - this.rain * .68);
    this.sun.intensity = sunI;
    this.sun.color.copy(this.uniforms.uSunColor.value);
    this.sun.visible = sunI > .01;

    // Keep the shadow frustum locked to the player.
    if (playerPos) {
      // Snap the shadow centre to texel-sized steps or the map crawls and
      // shimmers as the player walks.
      const texel = (this.shadowSpan * 2) / this.sun.shadow.mapSize.x;
      const sx = Math.round(playerPos.x / texel) * texel;
      const sz = Math.round(playerPos.z / texel) * texel;
      this.sun.target.position.set(sx, playerPos.y, sz);
      this.sun.position.set(sx, playerPos.y, sz).add(dir.clone().multiplyScalar(180));
      this.sun.target.updateMatrixWorld();
      this.sun.shadow.camera.updateProjectionMatrix();
      this.dome.position.copy(playerPos);
      this.clouds.position.set(playerPos.x, 0, playerPos.z);
    }

    // Sky fill only — kept low so cast shadows stay dark and legible.
    this.hemi.intensity = lerp(.20, .48, daylight) * (1 - this.rain * .3) * (1 + this.rain * .8)
                        + night * .42;
    /* ---- moon ---- */
    this.moon.intensity = this.moonBase * clamp(night * 1.25, 0, 1) * (1 - this.rain * .6);
    this.moon.visible = this.moon.intensity > .01;
    if (playerPos && this.moon.visible) {
      const md = dir.clone().negate();
      const texel = (this.shadowSpan * 2) / this.moon.shadow.mapSize.x;
      const mx = Math.round(playerPos.x / texel) * texel;
      const mz = Math.round(playerPos.z / texel) * texel;
      this.moon.target.position.set(mx, playerPos.y, mz);
      this.moon.position.set(mx, playerPos.y, mz).add(md.multiplyScalar(180));
      this.moon.target.updateMatrixWorld();
    }

    this.hemi.color.copy(hor);
    this.hemi.groundColor.copy(new THREE.Color(p.ground).multiplyScalar(lerp(.5, 1, daylight)));
    // A little moonlight so night is navigable rather than pitch black.
    this.ambient.intensity = lerp(.20, .07, daylight) + night * .30;
    this.ambient.color.setHex(night > .5 ? 0x5a72a8 : 0xffffff);

    /* ---- fog ---- */
    const base = this._baseFog();
    // Clear air at night so distant relief still reads under moonlight.
    this.scene.fog.density = base * (1 + this.rain * 1.7) * lerp(0.72, 1, daylight);
    this.scene.fog.color.copy(hor).lerp(new THREE.Color(0x9aa4ad), this.rain * .7);

    /* ---- refresh the environment map as the light turns over ---- */
    if (this._pmrem) {
      this._envT -= dt;
      if (this._envT <= 0) { this._bakeEnvironment(); this._envT = 6; }
    }

    /* ---- clouds drift ---- */
    for (const c of this.clouds.children) {
      c.position.x += c.userData.drift * dt;
      if (c.position.x > 3600) c.position.x = -3600;
      c.material.opacity = lerp(.30, .62, this.rain) * lerp(.35, 1, daylight + night * .25);
    }

    /* ---- rain particles ---- */
    this.rainMesh.visible = this.rain > .02;
    if (this.rainMesh.visible && playerPos) {
      this.rainMesh.material.opacity = this.rain * .55;
      this.rainMesh.position.set(playerPos.x, playerPos.y, playerPos.z);
      const pos = this.rainMesh.geometry.attributes.position;
      const arr = pos.array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] -= this._rainVel[i / 3] * dt;
        arr[i] += dt * 5;                       // slight slant
        if (arr[i + 1] < -6) {
          arr[i + 1] = 44;
          arr[i] = (Math.random() - .5) * 80;
          arr[i + 2] = (Math.random() - .5) * 80;
        }
      }
      pos.needsUpdate = true;
    }

    /* Occasional thunder while it is really coming down. */
    if (this.rain > .6 && audio) {
      this._thunderT = (this._thunderT ?? 12) - dt;
      if (this._thunderT <= 0) {
        audio.sfx('thunder', { volume: .5 + Math.random() * .4 });
        this._thunderT = 14 + Math.random() * 40;
        this._flash = .8;
      }
    }
    if (this._flash > 0) {
      this._flash -= dt * 3.2;
      this.ambient.intensity += Math.max(0, this._flash) * 1.6;
    }
  }

  /** 0 = midnight, .5 = noon. Used to decide ambient audio and enemy spawns. */
  get isNight() { return this.uniforms.uStars.value > .4; }

  dispose() {
    this._envRT?.dispose();
    this._pmrem?.dispose();
    this.scene.environment = null;
    this.scene.remove(this.dome, this.sun, this.sun.target, this.moon, this.moon.target,
      this.hemi, this.ambient, this.clouds, this.rainMesh);
    this.dome.geometry.dispose(); this.dome.material.dispose();
    this.rainMesh.geometry.dispose(); this.rainMesh.material.dispose();
    for (const c of this.clouds.children) c.geometry.dispose();
    this.clouds.children[0]?.material.map?.dispose();
    this.clouds.children[0]?.material.dispose();
  }
}
