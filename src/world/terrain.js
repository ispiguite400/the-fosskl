/* Streaming heightmap terrain.
 *
 * Worlds are 3.6–10.4 km across, so the mesh is built as 128 m chunks that
 * page in and out around the player with three LOD rings. Height is a pure
 * function of (x, z) plus the world seed, which means physics, prop
 * placement and the mesh always agree without storing a heightmap. */

import * as THREE from 'three';
import { fbm, ridge, clamp, lerp, smooth, makeRNG } from '../core/util.js';

export const CHUNK = 128;

const LOD_SEGMENTS = [32, 16, 8, 4];     // vertices per chunk edge by ring

/* Per-theme shaping. amp = metres of relief, freq = feature size. */
const SHAPE = {
  // The village sits in a flat basin; everything beyond it climbs into
  // real hills and mountains you can walk up.
  // Rolling ground through the village, climbing into real hills and
  // mountains beyond it. `keep` is how much relief survives in the middle.
  ruins:     { amp: 185, freq: .0011, ridged: .70, plateau: .22, cliff: .4,
               basin: { inner: 190, outer: 820, level: 0, keep: .26 } },
  grassland: { amp: 42,  freq: .0011, ridged: .10, plateau: .35, cliff: .05 },
  forest:    { amp: 58,  freq: .0014, ridged: .25, plateau: .25, cliff: .12 },
  desert:    { amp: 48,  freq: .0009, ridged: .05, plateau: .15, cliff: .04, dunes: 1 },
  snow:      { amp: 96,  freq: .0012, ridged: .55, plateau: .2,  cliff: .3 },
  savanna:   { amp: 30,  freq: .0008, ridged: .08, plateau: .5,  cliff: .05 },
  ocean:     { amp: 70,  freq: .0015, ridged: .35, plateau: .1,  cliff: .35, islands: 1 },
  roman:     { amp: 34,  freq: .0010, ridged: .12, plateau: .65, cliff: .08 },
  kingdom:   { amp: 168, freq: .0009, ridged: .78, plateau: .18, cliff: .45 },
  sky:       { amp: 54,  freq: .0018, ridged: .3,  plateau: .3,  cliff: .5, floating: 1 }
};

export class Terrain {
  constructor(scene, world, seed, quality = 'high') {
    this.scene = scene;
    this.world = world;
    this.seed = seed;
    this.shape = SHAPE[world.theme] || SHAPE.grassland;
    /* A world may ask for more relief than its theme carries — world one
     * wants real mountains behind its burnt village, world nine wants the
     * teeth its subtitle promises. The flag had been in the data since
     * those subtitles were written and nothing had ever read it. */
    this.reliefScale = world.mountains ?? 1;
    this.size = world.size;
    this.half = world.size / 2;
    this.quality = quality;
    this.chunks = new Map();
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);

    this.viewChunks = { low: 5, medium: 7, high: 9, ultra: 12 }[quality] ?? 9;
    this.rng = makeRNG(seed);
    this._offset = (seed % 8192) * .137;

    this.material = this._makeMaterial();
    this._buildGrass();
    if (world.water) this._buildWater();
  }

  /* ---------------- height field ---------------- */

  /** Metres above sea level at a world position. Deterministic. */
  heightAt(x, z) {
    const S = this.shape;
    const o = this._offset;
    const nx = (x + o) * S.freq, nz = (z + o) * S.freq;

    let h = fbm(nx, nz, 6, 2.05, .5);
    // Ridged component gives mountains a crest instead of a dome.
    if (S.ridged > 0) {
      h = lerp(h, ridge(nx * 1.4, nz * 1.4, 5) * 2 - 1, S.ridged);
    }
    // Plateau: flatten mid-range values so there is somewhere to fight.
    if (S.plateau > 0) {
      const flat = Math.sign(h) * Math.pow(Math.abs(h), 1 + S.plateau * 1.6);
      h = lerp(h, flat, S.plateau);
    }
    let y = h * S.amp * this.reliefScale;

    // Fine detail so slopes never look like flat shading.
    y += fbm(nx * 9.3, nz * 9.3, 3) * S.amp * .05 * this.reliefScale;

    if (S.dunes) {
      // Wind-aligned dune ripples running roughly NE.
      const d = Math.sin((x * .06 + z * .028) + fbm(nx * 3, nz * 3, 3) * 4);
      y += d * 6.5 + Math.sin(x * .012 - z * .02) * 9;
    }
    if (S.islands) {
      // Push land up in clumps, drop everything else below the waterline.
      const mask = fbm(nx * .55, nz * .55, 3);
      y += (mask > .06 ? (mask - .06) * 120 : (mask - .06) * 40) - 14;
    }
    if (S.floating) {
      // Sky world: terrain only exists inside island masks.
      const mask = fbm(nx * .5 + 40, nz * .5 - 20, 3);
      const inside = smooth(clamp((mask - .02) * 6, 0, 1));
      y = y * inside + (1 - inside) * -220;
    }

    // Flatten a basin so a settlement has somewhere coherent to stand,
    // then let the ground climb away from it in every direction.
    if (S.basin) {
      const bd = Math.hypot(x, z);
      const k = smooth(clamp((bd - S.basin.inner) / (S.basin.outer - S.basin.inner), 0, 1));
      // `keep` is how much of the natural relief survives in the middle.
      y = lerp(S.basin.level + y * (S.basin.keep ?? .1), y, k);
    }

    // Bowl the outer rim so the player is funnelled back in.
    const d = Math.max(Math.abs(x), Math.abs(z)) / this.half;
    if (d > .82) {
      const t = clamp((d - .82) / .18, 0, 1);
      y = lerp(y, y + 260 * t * t, 1) ;
    }
    return y;
  }

  /** Surface normal by finite differences — used for slope tests. */
  normalAt(x, z, e = 1.2) {
    const hL = this.heightAt(x - e, z), hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e), hU = this.heightAt(x, z + e);
    const n = new THREE.Vector3(hL - hR, 2 * e, hD - hU);
    return n.normalize();
  }

  slopeAt(x, z) { return 1 - this.normalAt(x, z).y; }

  /** True where the ground is walkable and above water. */
  isFlatGround(x, z, maxSlope = .35) {
    if (this.world.water && this.heightAt(x, z) < (this.waterY ?? this.world.waterLevel ?? 0) + 1) return false;
    if (this.shape.floating && this.heightAt(x, z) < -100) return false;
    return this.slopeAt(x, z) < maxSlope;
  }

  /* ---------------- materials ---------------- */

  _makeMaterial() {
    const p = this.world.palette;
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      // Snow and wet ground pick up a little sheen from the environment map.
      roughness: this.world.theme === 'snow' ? .58 : .88,
      metalness: this.world.theme === 'snow' ? .05 : .02,
      envMapIntensity: .55,
      flatShading: false
    });
    // A cheap detail texture keeps large flat areas from looking plastic.
    mat.map = this._detailTexture();
    mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
    mat.map.repeat.set(CHUNK / 6, CHUNK / 6);
    return mat;
  }

  _detailTexture() {
    const s = 256, c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, s, s);
    const img = ctx.getImageData(0, 0, s, s), d = img.data;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = (y * s + x) * 4;
        const n = 235 + fbm(x * .08, y * .08, 4) * 34 + (Math.random() - .5) * 12;
        d[i] = d[i + 1] = d[i + 2] = clamp(n, 0, 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    // Grazing-angle ground is where low anisotropy shows most.
    tex.anisotropy = 16;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  /** Ground colour from height, slope and theme. */
  _colorAt(x, z, y, slope, out) {
    const w = this.world, p = w.palette;
    const rock = new THREE.Color(0x6a635c);
    let c;

    switch (w.theme) {
      case 'ruins': {
        // Trampled earth with surviving grass in patches, then soot on top.
        const burn = clamp(fbm(x * .01, z * .01, 3) * .5 + .5, 0, 1);
        c = new THREE.Color().lerpColors(new THREE.Color(p.ground), new THREE.Color(p.grass), burn);
        c.lerp(new THREE.Color(0x241e18), clamp(fbm(x * .04 + 9, z * .04, 2) * .9, 0, .5)); // scorch
        c.lerp(rock, clamp((slope - .3) * 2.6, 0, 1));
        break;
      }
      case 'snow': {
        const bare = clamp((slope - .28) * 3.2, 0, 1);
        c = new THREE.Color().lerpColors(new THREE.Color(0xeef4fa), rock, bare);
        break;
      }
      case 'desert': {
        c = new THREE.Color().lerpColors(new THREE.Color(0xd9b06a), new THREE.Color(0xc08d48),
          clamp(fbm(x * .006, z * .006, 3) * .5 + .5, 0, 1));
        c.lerp(rock, clamp((slope - .4) * 2.4, 0, 1));
        break;
      }
      case 'ocean': {
        const beach = clamp(1 - (y - (w.waterLevel || 0)) / 8, 0, 1);
        c = new THREE.Color().lerpColors(new THREE.Color(p.grass), new THREE.Color(0xe2d3a8), beach);
        c.lerp(rock, clamp((slope - .35) * 2.4, 0, 1));
        break;
      }
      case 'kingdom': {
        const alt = clamp((y - 60) / 110, 0, 1);
        c = new THREE.Color().lerpColors(new THREE.Color(p.grass), rock, clamp(slope * 2.2, 0, 1));
        c.lerp(new THREE.Color(0xe8eef4), alt * .85);
        break;
      }
      case 'roman': {
        c = new THREE.Color().lerpColors(new THREE.Color(0x8f8f52), new THREE.Color(0xb8a888),
          clamp(fbm(x * .004, z * .004, 3) * .5 + .5, 0, 1));
        c.lerp(rock, clamp((slope - .3) * 2.4, 0, 1));
        break;
      }
      case 'sky': {
        c = new THREE.Color(p.grass);
        c.lerp(new THREE.Color(0x7a6a58), clamp((slope - .2) * 2.4, 0, 1));
        break;
      }
      default: {
        const dry = clamp(fbm(x * .003 + 5, z * .003, 3) * .5 + .5, 0, 1);
        c = new THREE.Color().lerpColors(new THREE.Color(p.grass), new THREE.Color(p.ground), dry * .55);
        c.lerp(rock, clamp((slope - .32) * 2.6, 0, 1));
      }
    }
    // Break up tiling with low-frequency value noise.
    const v = 1 + fbm(x * .02, z * .02, 2) * .12;
    out.setRGB(c.r * v, c.g * v, c.b * v);
  }

  /* ---------------- chunk build ---------------- */

  _buildChunk(cx, cz, lod) {
    const seg = LOD_SEGMENTS[Math.min(lod, LOD_SEGMENTS.length - 1)];
    const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, seg, seg);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    const ox = cx * CHUNK, oz = cz * CHUNK;

    // PlaneGeometry lays vertices out row-major, (seg+1) per row. Sampling
    // the height once per vertex and deriving slope from the neighbours we
    // already have costs a fifth of calling slopeAt() per vertex.
    const N = seg + 1;
    const step = CHUNK / seg;
    const heights = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const y = this.heightAt(pos.getX(i) + ox, pos.getZ(i) + oz);
      heights[i] = y;
      pos.setY(i, y);
    }

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = r * N + c;
        const hL = heights[r * N + Math.max(0, c - 1)];
        const hR = heights[r * N + Math.min(N - 1, c + 1)];
        const hD = heights[Math.max(0, r - 1) * N + c];
        const hU = heights[Math.min(N - 1, r + 1) * N + c];
        // Central difference over the actual spacing between samples.
        const spanX = (Math.min(N - 1, c + 1) - Math.max(0, c - 1)) * step || step;
        const spanZ = (Math.min(N - 1, r + 1) - Math.max(0, r - 1)) * step || step;
        const nx = (hL - hR) / spanX, nz = (hD - hU) / spanZ;
        const slope = 1 - 1 / Math.sqrt(nx * nx + nz * nz + 1);

        this._colorAt(pos.getX(i) + ox, pos.getZ(i) + oz, heights[i], slope, col);
        colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.userData.chunk = `${cx},${cz}`;
    return mesh;
  }

  /* ---------------- grass ---------------- */

  _buildGrass() {
    const density = this.world.density?.grass ?? 0;
    // Low quality gets thinner, shorter grass — never a bald world.
    if (density <= 0) { this.grass = null; return; }

    const count = Math.floor(({ low: 10000, medium: 26000, high: 55000, ultra: 90000 }[this.quality] ?? 55000) * clamp(density, .5, 1.3));
    this.grassCount = count;
    // Tighter radius, same instance budget: a dense carpet underfoot that
    // fades into the terrain colour rather than sparse spikes to the horizon.
    this.grassRadius = { low: 24, medium: 32, high: 42, ultra: 58 }[this.quality] ?? 42;

    // One instance is a tuft, not a blade: three quads fanned around the
    // stem, each leaning a different way. Crossed quads alone read as two
    // solid fins up close; a fan reads as grass.
    const blade = new THREE.BufferGeometry();
    const H = .58, W = .019;
    const verts = [], uvs = [], cols = [], idx = [];
    const TUFT = [
      { a: 0.0, lean: .10, h: 1.00 },
      { a: 1.05, lean: -.14, h: .78 },
      { a: 2.10, lean: .06, h: .90 }
    ];
    TUFT.forEach((t, k) => {
      const dx = Math.cos(t.a) * W, dz = Math.sin(t.a) * W;
      const th = H * t.h;
      const lx = Math.cos(t.a + 1.57) * t.lean, lz = Math.sin(t.a + 1.57) * t.lean;
      const base = k * 4;
      verts.push(
        -dx, 0, -dz,
         dx, 0, dz,
         dx * .18 + lx, th, dz * .18 + lz,
        -dx * .18 + lx, th, -dz * .18 + lz);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      // Roots sit in shadow, tips catch the light — without this the tuft is
      // a flat slab of colour and reads as plastic.
      cols.push(.52, .52, .48, .52, .52, .48, 1.12, 1.12, 1.05, 1.12, 1.12, 1.05);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    blade.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    blade.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    blade.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    blade.setIndex(idx);
    blade.computeVertexNormals();

    const grassColor = new THREE.Color(this.world.palette.grass).multiplyScalar(1.15);
    const mat = new THREE.MeshStandardMaterial({
      color: grassColor, roughness: .92, side: THREE.DoubleSide, vertexColors: true,
      // Blades are near-vertical, so a low sun would otherwise render them
      // as black slivers. A touch of self-colour keeps them readable.
      emissive: grassColor.clone().multiplyScalar(.16)
    });
    // Wind sway, applied in the vertex shader so 40k blades stay cheap.
    mat.onBeforeCompile = shader => {
      shader.uniforms.uTime = this.grassTime = { value: 0 };
      shader.uniforms.uWind = this.grassWind = { value: new THREE.Vector3(1, 0, .3) };
      shader.uniforms.uGust = this.grassGust = { value: 0 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime;
          uniform vec3  uWind;
          uniform float uGust;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 wp = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 wp = vec3(0.0);
          #endif
          /* Idle sway, plus the weather. A gust runs across the field as a
           * travelling wave rather than bending everything at once, which is
           * what makes a blizzard or a sandstorm read as moving air instead
           * of a static lean. */
          float phase = uTime * 1.6 + wp.x * 0.22 + wp.z * 0.17;
          float sway = sin(phase) * 0.16 + sin(uTime * 3.1 + wp.x * 0.6) * 0.05;
          float front = dot(wp.xz, normalize(uWind.xz + vec2(0.001))) * 0.06;
          float gust  = uGust * (0.55 + 0.45 * sin(uTime * 2.3 - front));
          float bend  = position.y * position.y;
          transformed.x += (sway + uWind.x * gust * 1.9) * bend;
          transformed.z += (sway * 0.6 + uWind.z * gust * 1.9) * bend;
          // Flattened toward the ground in a real blow.
          transformed.y -= gust * bend * 0.5;
        `);
      this.grassShader = shader;
    };

    this.grass = new THREE.InstancedMesh(blade, mat, count);
    this.grass.frustumCulled = false;
    this.grass.castShadow = false;
    this.grass.receiveShadow = true;
    this.grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.grass);
    this._grassAnchor = new THREE.Vector3(1e9, 0, 1e9);
  }

  _scatterGrass(center) {
    if (!this.grass) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const rng = makeRNG(this.seed ^ 0x9e37);
    const R = this.grassRadius;
    const density = this.world.density?.grass ?? 1;

    for (let i = 0; i < this.grassCount; i++) {
      // Distribute with sqrt so density is uniform in area, not radius.
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * R;
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      const y = this.heightAt(x, z);
      const slope = this.slopeAt(x, z);

      // Hide blades on cliffs, under water, or where the biome is bare.
      const patch = fbm(x * .05, z * .05, 2) * .5 + .5;
      const ok = slope < .62 && patch < clamp(density, .35, 1) * 1.2 &&
                 (!this.world.water || y > (this.world.waterLevel || 0) + .5) &&
                 y > -100;
      // Ankle-to-shin height: the geometry is .58m tall, so this lands
      // between 22cm and 41cm — grass you walk through, not wade through.
      // The outer tenth shrinks away so the patch has no hard rim.
      const edge = clamp((R - r) / (R * .16), 0, 1);
      const h = ok ? (.38 + rng() * .32) * edge * (this.world.theme === 'savanna' ? 2.2 : 1) : 0;

      pos.set(x, y, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI);
      scl.set(.8 + rng() * .45, h, .8 + rng() * .45);
      m.compose(pos, q, scl);
      this.grass.setMatrixAt(i, m);
    }
    this.grass.instanceMatrix.needsUpdate = true;
    this._grassAnchor.copy(center);
  }

  /* ---------------- water ---------------- */

  _buildWater() {
    const level = this.world.waterLevel || 0;
    this.waterY = level;
    const geo = new THREE.PlaneGeometry(this.size * 1.4, this.size * 1.4, 64, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.world.palette.water),
      transparent: true, opacity: .82, roughness: .1, metalness: .3
    });
    mat.onBeforeCompile = shader => {
      shader.uniforms.uTime = this.waterTime = { value: 0 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          transformed.y += sin(position.x * 0.08 + uTime * 1.4) * 0.5
                         + sin(position.z * 0.11 - uTime * 1.1) * 0.4;`);
    };
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = level;
    this.water.receiveShadow = false;
    this.group.add(this.water);
  }

  /* ---------------- streaming ---------------- */

  update(playerPos, dt) {
    const pcx = Math.round(playerPos.x / CHUNK);
    const pcz = Math.round(playerPos.z / CHUNK);
    const R = this.viewChunks;
    const maxChunk = Math.ceil(this.half / CHUNK);

    const wanted = new Set();
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > R + .5) continue;
        const cx = pcx + dx, cz = pcz + dz;
        if (Math.abs(cx) > maxChunk || Math.abs(cz) > maxChunk) continue;
        const lod = d < 2 ? 0 : d < 4 ? 1 : d < 7 ? 2 : 3;
        wanted.add(`${cx},${cz}|${lod}`);
      }
    }

    // Retire chunks that are out of range or at the wrong LOD.
    for (const [key, mesh] of this.chunks) {
      if (!wanted.has(key)) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }

    // Build at most a few per frame so streaming never spikes the frame time.
    let budget = 2;
    for (const key of wanted) {
      if (this.chunks.has(key)) continue;
      if (budget-- <= 0) break;
      const [coord, lod] = key.split('|');
      const [cx, cz] = coord.split(',').map(Number);
      const mesh = this._buildChunk(cx, cz, +lod);
      this.chunks.set(key, mesh);
      this.group.add(mesh);
    }

    if (this.grass && this._grassAnchor.distanceTo(playerPos) > this.grassRadius * .35) {
      this._scatterGrass(playerPos);
    }
    if (this.grassTime) this.grassTime.value += dt;
    // The field leans with whatever the sky is doing.
    const sky = this.sky;                 // handed over by the game on load
    if (this.grassWind && sky) {
      if (sky.windDir) this.grassWind.value.copy(sky.windDir);
      this.grassGust.value = (sky.blown ? (sky.storm ?? 0) : (sky.rain ?? 0) * .35) * .5;
    }
    if (this.waterTime) this.waterTime.value += dt;
    if (this.water) {
      this.water.position.x = playerPos.x; this.water.position.z = playerPos.z;
      /* The tide. A world may breathe its water up and down over the day
       * cycle, which is the difference between a sea and a reach: at low
       * water the flats come up and you can walk to things that are islands
       * six hours later. `waterY` is the live level everything else asks. */
      if (this.world.tide) {
        const phase = this.tidePhase ?? 0;
        this.waterY = (this.world.waterLevel || 0) +
                      Math.sin(phase * Math.PI * 2) * this.world.tide;
        this.water.position.y = this.waterY;
      }
    }
  }

  /** Blocking build of the chunks immediately around a point (used on spawn). */
  ensureAround(pos) {
    const pcx = Math.round(pos.x / CHUNK), pcz = Math.round(pos.z / CHUNK);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const d = Math.hypot(dx, dz);
        const lod = d < 2 ? 0 : 1;
        const key = `${pcx + dx},${pcz + dz}|${lod}`;
        if (this.chunks.has(key)) continue;
        const mesh = this._buildChunk(pcx + dx, pcz + dz, lod);
        this.chunks.set(key, mesh);
        this.group.add(mesh);
      }
    }
    if (this.grass) this._scatterGrass(pos);
  }

  /** Find walkable ground near a target, spiralling outward. */
  findSpawn(near = { x: 0, z: 0 }, radius = 400) {
    const rng = makeRNG((this.seed ^ 0x51ed) >>> 0);
    for (let i = 0; i < 220; i++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * radius;
      const x = clamp(near.x + Math.cos(a) * r, -this.half + 60, this.half - 60);
      const z = clamp(near.z + Math.sin(a) * r, -this.half + 60, this.half - 60);
      if (this.isFlatGround(x, z, .3)) return { x, y: this.heightAt(x, z), z };
    }
    return { x: near.x, y: this.heightAt(near.x, near.z), z: near.z };
  }

  dispose() {
    for (const [, mesh] of this.chunks) { mesh.geometry.dispose(); }
    this.chunks.clear();
    this.material.map?.dispose();
    this.material.dispose();
    this.grass?.geometry.dispose();
    this.grass?.material.dispose();
    this.water?.geometry.dispose();
    this.water?.material.dispose();
    this.scene.remove(this.group);
  }
}
