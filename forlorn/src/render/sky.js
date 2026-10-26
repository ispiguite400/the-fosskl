/*
 * The sky: a shader dome (zenith -> horizon -> ground gradient, stars, a moon or sun
 * with glow, soft clouds) that also feeds the scene's reflection environment.
 */
import * as THREE from 'three';

const VS = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;
const FS = `
  uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor, uCloud; uniform float uStars, uSunSize, uTime, uClouds;
  varying vec3 vDir;
  float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    float a = hash(vec3(i, 1.0)), b = hash(vec3(i + vec2(1,0), 1.0)), c = hash(vec3(i + vec2(0,1), 1.0)), d = hash(vec3(i + vec2(1,1), 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
  void main(){
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.75, h), 0.7)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.25, h));
    // stars, fading toward the horizon
    if (uStars > 0.0 && h > 0.0) {
      vec3 g = floor(d * 380.0); float s = hash(g);
      float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 60.0);
      col += vec3(0.9, 0.95, 1.0) * step(0.9965, s) * uStars * tw * smoothstep(0.02, 0.35, h);
    }
    // the moon or sun with a halo
    float sd = dot(d, normalize(uSunDir));
    col += uSunColor * (smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.6, sd) * 2.0 + pow(max(sd, 0.0), 64.0) * 0.6 + pow(max(sd, 0.0), 8.0) * 0.15);
    // clouds drifting across the upper sky
    if (uClouds > 0.0 && h > 0.02) {
      vec2 uv = d.xz / (h + 0.25) * 1.6 + vec2(uTime * 0.008, uTime * 0.003);
      float c = smoothstep(0.45, 0.8, fbm(uv)) * uClouds * smoothstep(0.02, 0.25, h);
      col = mix(col, uCloud + uSunColor * 0.15 * pow(max(sd, 0.0), 4.0), c);
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

export function makeSky(o) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(o.top) }, uHorizon: { value: new THREE.Color(o.horizon) }, uBottom: { value: new THREE.Color(o.bottom || o.horizon) },
      uSunDir: { value: new THREE.Vector3(...(o.sunDir || [0.3, 0.5, -0.8])).normalize() }, uSunColor: { value: new THREE.Color(o.sunColor || 0xffffff) },
      uSunSize: { value: o.sunSize || 0.0015 }, uStars: { value: o.stars || 0 }, uTime: { value: 0 },
      uClouds: { value: o.clouds || 0 }, uCloud: { value: new THREE.Color(o.cloud || 0x40404a) }
    }
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  mesh.userData.tick = (dt) => { mat.uniforms.uTime.value += dt; };
  return mesh;
}

/** Bake the sky into a prefiltered environment for reflections. */
export function skyEnvironment(renderer, sky) {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  const clone = new THREE.Mesh(sky.geometry, sky.material);
  s.add(clone);
  const rt = pm.fromScene(s, 0.04);
  pm.dispose();
  return rt.texture;
}
