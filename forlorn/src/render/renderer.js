/*
 * The renderer: three.js with post-processing.
 *
 *   scene render -> bloom -> grade (vignette, contrast, saturation, tint, fear pulse,
 *   chromatic aberration, film grain, death desaturation) -> output (ACES, sRGB) -> FXAA
 *
 * Quality presets trade shadows, bloom and resolution so phones keep 30+ fps.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { settings } from '../core/save.js';

export const QUALITY = {
  low:    { shadow: 1024, shadowFar: 32, ratio: 0.85, bloom: false, maxLights: 4, grain: false, aa: true },
  medium: { shadow: 2048, shadowFar: 42, ratio: 1, bloom: true, maxLights: 6, grain: true, aa: true },
  high:   { shadow: 2048, shadowFar: 52, ratio: 1.5, bloom: true, maxLights: 10, grain: true, aa: true },
  ultra:  { shadow: 4096, shadowFar: 60, ratio: 2, bloom: true, maxLights: 14, grain: true, aa: true }
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.35 }, uSat: { value: 1.0 }, uContrast: { value: 1.05 }, uLift: { value: new THREE.Vector3(0, 0, 0) },
    uTint: { value: new THREE.Vector3(1, 1, 1) }, uFear: { value: 0 }, uChroma: { value: 0 }, uGrain: { value: 0.035 },
    uDeath: { value: 0 }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Vector3(1, 1, 1) }, uBlind: { value: 0 }
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uSat, uContrast, uFear, uChroma, uGrain, uDeath, uFlash, uBlind;
    uniform vec2 uRes; uniform vec3 uLift, uTint, uFlashColor; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv, c = uv - 0.5;
      float r2 = dot(c, c);
      vec3 col;
      float ca = uChroma * 0.006 * (0.4 + r2 * 3.0);
      if (ca > 0.0001) { col.r = texture2D(tDiffuse, uv + c * ca).r; col.g = texture2D(tDiffuse, uv).g; col.b = texture2D(tDiffuse, uv - c * ca).b; }
      else col = texture2D(tDiffuse, uv).rgb;
      col = col * uTint + uLift;
      col = (col - 0.18) * uContrast + 0.18;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat * (1.0 - uDeath * 0.85));
      // fear: a red pulse creeping in from the edges while the killer is near
      float pulse = 0.6 + 0.4 * sin(uTime * 7.0);
      col = mix(col, col * vec3(1.25, 0.55, 0.55), uFear * pulse * smoothstep(0.05, 0.45, r2 * 2.2));
      // blinded by a flash or spray: wash to white, then fade
      col = mix(col, vec3(1.0), uBlind * smoothstep(0.6, 0.0, r2) );
      col = mix(col, uFlashColor, uFlash);
      float vig = smoothstep(0.85, 0.2, r2 * (1.0 + uVignette * 1.6 + uFear * 0.8 + uDeath * 0.8));
      col *= mix(1.0, vig, 0.85);
      col += (hash(uv * uRes + fract(uTime * 7.31)) - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov || 70, 1, 0.08, 400);
    this.time = 0;
    this.grade = GradeShader.uniforms;
    this.setQuality(settings.quality);
    addEventListener('resize', () => this.resize());
  }
  setQuality(q) {
    this.q = QUALITY[q] || QUALITY.medium;
    this.qName = q;
    const c = new EffectComposer(this.gl);
    this.renderPass = new RenderPass(this.scene, this.camera);
    c.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82);
    this.bloom.enabled = this.q.bloom;
    c.addPass(this.bloom);
    const old = this.gradePass ? this.gradePass.uniforms : null;
    this.gradePass = new ShaderPass(GradeShader);
    if (old) for (const k in old) if (k !== 'tDiffuse') this.gradePass.uniforms[k].value = old[k].value;   // keep the grade across a quality change
    c.addPass(this.gradePass);
    c.addPass(new OutputPass());
    this.fxaa = new ShaderPass(FXAAShader);
    this.fxaa.enabled = this.q.aa;
    c.addPass(this.fxaa);
    this.composer = c;
    this.grade = this.gradePass.uniforms;
    this.grade.uGrain.value = this.q.grain ? 0.035 : 0;
    this.resize();
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    const ratio = Math.min(devicePixelRatio || 1, this.q.ratio) * (settings.renderScale || 1);
    this.gl.setPixelRatio(ratio);
    this.gl.setSize(w, h, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fxaa.material.uniforms.resolution.value.set(1 / (w * ratio), 1 / (h * ratio));
    this.grade.uRes.value.set(w * ratio, h * ratio);
    this.bloom.resolution.set(w * ratio * 0.5, h * ratio * 0.5);
  }
  setScene(scene) { this.scene = scene; this.renderPass.scene = scene; }
  render(dt) {
    this.time += dt;
    this.grade.uTime.value = this.time;
    this.composer.render(dt);
  }
}
