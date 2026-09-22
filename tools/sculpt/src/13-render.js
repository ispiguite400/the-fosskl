/*
 * SculptFree — WebGL2 renderer.
 *
 * Deliberately dependency-free: no Three.js, no external matcap images, so
 * the whole app is one HTML file that works offline. It draws:
 *
 *   - the meshes, shaded with a procedurally generated matcap plus optional
 *     screen-space cavity shading, vertex colour and mask tint,
 *   - an optional wireframe overlay,
 *   - a ground grid and the symmetry planes,
 *   - the brush cursor, projected onto the surface.
 *
 * Vertex data is uploaded straight from the mesh's own buffers, dead slots
 * included: the index buffer only ever references live vertices, so dead
 * slots cost a little memory and nothing else. Strokes upload just the
 * range of vertices they touched.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var V3 = S.V3, M4 = S.M4;

  /* ================================================================ *
   * procedural matcaps
   *
   * A matcap is a picture of a sphere lit the way you want the model lit.
   * Generating them means no image assets, and the palette can be tuned.
   * ================================================================ */

  S.MATCAPS = [
    { id: 'clay', label: 'Red Clay', base: [0.78, 0.42, 0.34], spec: 0.35, gloss: 28, rim: 0.16, rimColor: [1, 0.85, 0.7], ambient: [0.16, 0.1, 0.1],
      lights: [[-0.35, 0.55, 0.75, 1.05], [0.6, 0.15, 0.6, 0.35], [0.1, -0.7, 0.4, 0.22]] },
    { id: 'grey', label: 'Studio Grey', base: [0.62, 0.63, 0.66], spec: 0.4, gloss: 42, rim: 0.12, rimColor: [1, 1, 1], ambient: [0.13, 0.14, 0.16],
      lights: [[-0.4, 0.6, 0.7, 1.0], [0.75, 0.1, 0.4, 0.4], [0, -0.8, 0.3, 0.2]] },
    { id: 'white', label: 'White Cast', base: [0.9, 0.9, 0.92], spec: 0.28, gloss: 30, rim: 0.2, rimColor: [0.9, 0.95, 1], ambient: [0.2, 0.21, 0.24],
      lights: [[-0.3, 0.7, 0.65, 0.9], [0.7, 0.2, 0.5, 0.35]] },
    { id: 'skin', label: 'Skin', base: [0.86, 0.63, 0.53], spec: 0.22, gloss: 18, rim: 0.22, rimColor: [1, 0.6, 0.5], ambient: [0.2, 0.12, 0.11],
      lights: [[-0.35, 0.5, 0.78, 1.0], [0.65, 0.05, 0.55, 0.32], [0.0, -0.75, 0.45, 0.3]] },
    { id: 'jade', label: 'Jade', base: [0.3, 0.62, 0.48], spec: 0.55, gloss: 60, rim: 0.3, rimColor: [0.6, 1, 0.85], ambient: [0.06, 0.16, 0.13],
      lights: [[-0.4, 0.55, 0.72, 1.0], [0.7, 0.25, 0.5, 0.45]] },
    { id: 'steel', label: 'Steel', base: [0.55, 0.58, 0.63], spec: 0.9, gloss: 120, rim: 0.25, rimColor: [0.8, 0.9, 1], ambient: [0.1, 0.11, 0.13],
      lights: [[-0.45, 0.6, 0.65, 1.0], [0.8, 0.0, 0.4, 0.7], [0.1, -0.85, 0.3, 0.35]] },
    { id: 'gold', label: 'Gold', base: [0.85, 0.65, 0.25], spec: 0.95, gloss: 90, rim: 0.28, rimColor: [1, 0.9, 0.6], ambient: [0.16, 0.11, 0.03],
      lights: [[-0.4, 0.6, 0.68, 1.0], [0.75, 0.1, 0.45, 0.6]] },
    { id: 'dark', label: 'Dark Ceramic', base: [0.22, 0.23, 0.27], spec: 0.75, gloss: 80, rim: 0.35, rimColor: [0.7, 0.8, 1], ambient: [0.05, 0.05, 0.07],
      lights: [[-0.4, 0.55, 0.7, 1.0], [0.7, 0.2, 0.5, 0.5]] },
    { id: 'blueprint', label: 'Blueprint', base: [0.35, 0.5, 0.78], spec: 0.3, gloss: 24, rim: 0.4, rimColor: [0.8, 0.95, 1], ambient: [0.08, 0.12, 0.22],
      lights: [[-0.3, 0.65, 0.7, 0.95], [0.7, -0.1, 0.5, 0.4]] },
    { id: 'wax', label: 'Green Wax', base: [0.55, 0.72, 0.4], spec: 0.2, gloss: 14, rim: 0.18, rimColor: [0.9, 1, 0.8], ambient: [0.12, 0.17, 0.1],
      lights: [[-0.35, 0.6, 0.72, 1.0], [0.6, 0.1, 0.6, 0.3], [0, -0.8, 0.4, 0.25]] }
  ];

  /**
   * Render one matcap into an RGBA byte array. For each pixel of the disc,
   * the normal is reconstructed and shaded analytically.
   */
  S.makeMatcap = function (preset, size) {
    size = size || 256;
    var data = new Uint8Array(size * size * 4);
    var base = preset.base, amb = preset.ambient || [0.1, 0.1, 0.1];
    var lights = preset.lights;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var u = (x + 0.5) / size * 2 - 1;
        var v = 1 - (y + 0.5) / size * 2;
        var r2 = u * u + v * v;
        var o = (y * size + x) * 4;
        var edge = 1;
        if (r2 > 1) {
          // just outside the disc: keep shading the silhouette so grazing
          // normals do not sample an empty texel
          var k = 1 / Math.sqrt(r2);
          u *= k; v *= k; r2 = 1;
          edge = 0.82;
        }
        var nz = Math.sqrt(Math.max(0, 1 - r2));
        var cr = amb[0] * base[0], cg = amb[1] * base[1], cb = amb[2] * base[2];
        var sr = 0, sg = 0, sb = 0;
        for (var li = 0; li < lights.length; li++) {
          var L = lights[li];
          var ll = Math.sqrt(L[0] * L[0] + L[1] * L[1] + L[2] * L[2]) || 1;
          var lx = L[0] / ll, ly = L[1] / ll, lz = L[2] / ll, power = L[3];
          var ndl = u * lx + v * ly + nz * lz;
          if (ndl > 0) {
            // soften the terminator a little, like a big softbox
            var diff = Math.pow(ndl, 0.85) * power;
            cr += base[0] * diff; cg += base[1] * diff; cb += base[2] * diff;
            // Blinn-Phong against the fixed view direction (0,0,1)
            var hx = lx, hy = ly, hz = lz + 1;
            var hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
            var ndh = (u * hx + v * hy + nz * hz) / hl;
            if (ndh > 0) {
              var sp = Math.pow(ndh, preset.gloss) * preset.spec * power;
              sr += sp; sg += sp; sb += sp;
            }
          }
        }
        var fres = Math.pow(1 - nz, 3) * (preset.rim || 0);
        var rc = preset.rimColor || [1, 1, 1];
        cr += rc[0] * fres; cg += rc[1] * fres; cb += rc[2] * fres;
        cr = (cr + sr) * edge; cg = (cg + sg) * edge; cb = (cb + sb) * edge;
        // filmic-ish shoulder so highlights do not clip flat
        data[o] = Math.round(255 * Math.pow(S.clamp(cr / (1 + cr * 0.4), 0, 1), 1 / 2.2) );
        data[o + 1] = Math.round(255 * Math.pow(S.clamp(cg / (1 + cg * 0.4), 0, 1), 1 / 2.2));
        data[o + 2] = Math.round(255 * Math.pow(S.clamp(cb / (1 + cb * 0.4), 0, 1), 1 / 2.2));
        data[o + 3] = 255;
      }
    }
    return { data: data, size: size };
  };

  /* ================================================================ *
   * shaders
   * ================================================================ */

  var MESH_VS = [
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec3 aPosition;',
    'layout(location=1) in vec3 aNormal;',
    'layout(location=2) in vec3 aColor;',
    'layout(location=3) in float aMask;',
    'uniform mat4 uModelView;',
    'uniform mat4 uProj;',
    'uniform mat3 uNormalMat;',
    'out vec3 vViewPos;',
    'out vec3 vViewNormal;',
    'out vec3 vColor;',
    'out float vMask;',
    // the object's own space, for reading its paint image
    'out vec3 vLocalPos;',
    'out vec3 vLocalNormal;',
    'void main() {',
    '  vec4 vp = uModelView * vec4(aPosition, 1.0);',
    '  vViewPos = vp.xyz;',
    '  vViewNormal = uNormalMat * aNormal;',
    '  vColor = aColor;',
    '  vMask = aMask;',
    '  vLocalPos = aPosition;',
    '  vLocalNormal = aNormal;',
    '  gl_Position = uProj * vp;',
    '}'
  ].join('\n');

  var MESH_FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vViewPos;',
    'in vec3 vViewNormal;',
    'in vec3 vColor;',
    'in float vMask;',
    'in vec3 vLocalPos;',
    'in vec3 vLocalNormal;',
    'uniform sampler2D uMatcap;',
    'uniform float uFlat;',
    'uniform float uVertexColor;',
    'uniform float uCavity;',
    'uniform float uMaskVis;',
    'uniform vec3 uTint;',
    'uniform float uGhost;',
    // the paint image: six charts in a 3x2 grid, read by which way the
    // surface faces (see the paint map in the texture module)
    'uniform sampler2D uPaintTex;',
    'uniform float uPaint;',
    'uniform float uPaintScale;',
    'uniform vec2 uPaintOff[6];',
    'out vec4 fragColor;',
    'vec2 chartOf(int f, vec3 p) {',
    '  if (f == 0) return vec2(-p.z, p.y);',
    '  if (f == 1) return vec2(p.z, p.y);',
    '  if (f == 2) return vec2(p.x, -p.z);',
    '  if (f == 3) return vec2(p.x, p.z);',
    '  if (f == 4) return vec2(p.x, p.y);',
    '  return vec2(-p.x, p.y);',
    '}',
    'vec3 readPaint(vec3 p, vec3 n) {',
    '  float side[6];',
    '  side[0] = max(n.x, 0.0); side[1] = max(-n.x, 0.0);',
    '  side[2] = max(n.y, 0.0); side[3] = max(-n.y, 0.0);',
    '  side[4] = max(n.z, 0.0); side[5] = max(-n.z, 0.0);',
    '  vec3 sum = vec3(0.0);',
    '  float total = 0.0;',
    '  for (int f = 0; f < 6; f++) {',
    '    float w = side[f] * side[f];',
    '    w = w * w;',                       // ^4: the same tight blend the CPU uses
    '    if (w <= 0.001) continue;',
    '    vec2 st = clamp(chartOf(f, p) * uPaintScale + uPaintOff[f], 0.0, 1.0);',
    // the same margin the paint map leaves round each chart, from the same
    // constant, so the shader and the rasteriser cannot drift apart
    '    st = st * ' + (1 - 2 * S.Texture.CHART_MARGIN).toFixed(6) +
      ' + ' + S.Texture.CHART_MARGIN.toFixed(6) + ';',
    '    vec2 uv = vec2((float(f - (f / 3) * 3) + st.x) / 3.0, (float(f / 3) + st.y) / 2.0);',
    '    sum += texture(uPaintTex, uv).rgb * w;',
    '    total += w;',
    '  }',
    '  return total > 0.0 ? sum / total : vec3(1.0);',
    '}',
    'void main() {',
    '  vec3 n = normalize(vViewNormal);',
    // on a two-sided surface the far side's normal points away from the eye,
    // and shading it with that normal would leave it black
    '  if (!gl_FrontFacing) n = -n;',
    '  if (uFlat > 0.5) {',
    '    vec3 fn = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));',
    '    if (dot(fn, n) < 0.0) fn = -fn;',
    '    n = fn;',
    '  }',
    '  vec2 uv = n.xy * 0.5 + 0.5;',
    '  vec3 base = texture(uMatcap, uv).rgb;',
    '  if (uCavity > 0.001) {',
    // divergence of the screen-space normal field: positive on ridges,
    // negative in creases. Scaled by the derivative of depth so the effect
    // does not explode when zoomed right in.
    '    vec3 sn = normalize(vViewNormal);',
    '    float div = (dFdx(sn.x) + dFdy(sn.y));',
    '    float amount = clamp(div * 14.0, -1.0, 1.0);',
    '    base *= 1.0 + amount * uCavity;',
    '  }',
    '  if (uPaint > 0.5) {',
    '    base *= readPaint(vLocalPos, normalize(vLocalNormal));',
    '  } else {',
    '    base *= mix(uTint, vColor * uTint, uVertexColor);',
    '  }',
    '  if (uMaskVis > 0.001 && vMask > 0.001) {',
    '    base = mix(base, base * 0.45 + vec3(0.12, 0.32, 0.72) * 0.55, vMask * uMaskVis);',
    '  }',
    '  fragColor = vec4(max(base, vec3(0.0)), uGhost);',
    '}'
  ].join('\n');

  var LINE_VS = [
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec3 aPosition;',
    'uniform mat4 uModelView;',
    'uniform mat4 uProj;',
    'uniform float uDepthNudge;',
    'out vec3 vViewPos;',
    'void main() {',
    '  vec4 vp = uModelView * vec4(aPosition, 1.0);',
    // pull lines a hair towards the camera so they sit on top of the surface
    '  vp.z += uDepthNudge * max(1.0, -vp.z);',
    '  vViewPos = vp.xyz;',
    '  gl_Position = uProj * vp;',
    '}'
  ].join('\n');

  var LINE_FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vViewPos;',
    'uniform vec4 uColor;',
    'uniform float uFadeStart;',
    'uniform float uFadeEnd;',
    'out vec4 fragColor;',
    'void main() {',
    '  float d = length(vViewPos);',
    '  float fade = uFadeEnd > uFadeStart ? 1.0 - clamp((d - uFadeStart) / (uFadeEnd - uFadeStart), 0.0, 1.0) : 1.0;',
    '  fragColor = vec4(uColor.rgb, uColor.a * fade);',
    '  if (fragColor.a < 0.004) discard;',
    '}'
  ].join('\n');

  var BG_VS = [
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec2 aPos;',
    'out vec2 vUv;',
    'void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var BG_FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'uniform vec3 uTop;',
    'uniform vec3 uBottom;',
    'uniform float uVignette;',
    'out vec4 fragColor;',
    'void main() {',
    '  vec3 c = mix(uBottom, uTop, pow(vUv.y, 0.9));',
    '  vec2 d = vUv - 0.5;',
    '  c *= 1.0 - uVignette * dot(d, d) * 1.6;',
    '  fragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  /* ================================================================ *
   * renderer
   * ================================================================ */

  function compile(gl, type, src, label) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Shader compile failed (' + label + '): ' + log);
    }
    return sh;
  }

  function program(gl, vs, fs, label) {
    var p = gl.createProgram();
    var v = compile(gl, gl.VERTEX_SHADER, vs, label + '.vert');
    var f = compile(gl, gl.FRAGMENT_SHADER, fs, label + '.frag');
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Program link failed (' + label + '): ' + gl.getProgramInfoLog(p));
    }
    var uniforms = {};
    var count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < count; i++) {
      var info = gl.getActiveUniform(p, i);
      uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
    }
    return { program: p, u: uniforms };
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    var attrs = { antialias: true, alpha: false, depth: true, stencil: false,
                  premultipliedAlpha: false, powerPreference: 'high-performance',
                  preserveDrawingBuffer: false, desynchronized: false };
    var gl = canvas.getContext('webgl2', attrs);
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;

    this.progMesh = program(gl, MESH_VS, MESH_FS, 'mesh');
    this.progLine = program(gl, LINE_VS, LINE_FS, 'line');
    this.progBg = program(gl, BG_VS, BG_FS, 'bg');

    // fullscreen quad for the background
    this.bgVao = gl.createVertexArray();
    gl.bindVertexArray(this.bgVao);
    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.matcapTextures = {};
    this.matcapId = 'clay';
    this.customMatcap = null;

    this._lineVao = gl.createVertexArray();
    this._lineBuf = gl.createBuffer();
    gl.bindVertexArray(this._lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._lineBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this._lineData = new Float32Array(4096 * 3);
    this._lineCapacity = 4096;

    this._mv = M4.create();
    this._nm = new Float32Array(9);
    this._nm4 = M4.create();
    this._identity = M4.create();
    this._tmpMat = M4.create();

    this.stats = { drawCalls: 0, triangles: 0, uploadedBytes: 0 };
    this.buildGrid();
    this.setMatcap('clay');
  }
  S.Renderer = Renderer;
  var R = Renderer.prototype;

  R.setMatcap = function (id, imageData) {
    var gl = this.gl;
    if (id === 'custom' && imageData) {
      if (this.matcapTextures.custom) gl.deleteTexture(this.matcapTextures.custom);
      this.matcapTextures.custom = this.uploadMatcap(imageData, true);
      this.matcapId = 'custom';
      return;
    }
    if (!this.matcapTextures[id]) {
      var preset = null;
      for (var i = 0; i < S.MATCAPS.length; i++) if (S.MATCAPS[i].id === id) preset = S.MATCAPS[i];
      if (!preset) preset = S.MATCAPS[0];
      var mc = S.makeMatcap(preset, 256);
      this.matcapTextures[id] = this.uploadMatcap(mc, false);
    }
    this.matcapId = id;
  };

  R.uploadMatcap = function (mc, isImage) {
    var gl = this.gl;
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (isImage) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mc);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, mc.size, mc.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, mc.data);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  };

  R.resize = function (cssWidth, cssHeight, scale) {
    var dpr = (root.devicePixelRatio || 1) * (scale || 1);
    var w = Math.max(1, Math.round(cssWidth * dpr));
    var h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    return { width: w, height: h };
  };

  /* ---- per-object GPU buffers ---------------------------------------- */

  R.objectState = function (obj) {
    var gl = this.gl;
    var st = obj.renderState;
    if (!st) {
      st = obj.renderState = {
        vao: gl.createVertexArray(),
        pos: gl.createBuffer(), nor: gl.createBuffer(), col: gl.createBuffer(), msk: gl.createBuffer(),
        idx: gl.createBuffer(), edges: null,
        vertCapacity: 0, indexCount: 0, edgeCount: 0, edgeTopoStamp: -1, topoStamp: -1,
        paintTex: null, paintSize: 0, paintVersion: -1
      };
      gl.bindVertexArray(st.vao);
      var bind = function (buf, loc, size) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      };
      bind(st.pos, 0, 3);
      bind(st.nor, 1, 3);
      bind(st.col, 2, 3);
      bind(st.msk, 3, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, st.idx);
      gl.bindVertexArray(null);
    }
    return st;
  };

  R.releaseObject = function (obj) {
    var st = obj.renderState;
    if (!st) return;
    var gl = this.gl;
    gl.deleteVertexArray(st.vao);
    gl.deleteBuffer(st.pos); gl.deleteBuffer(st.nor);
    gl.deleteBuffer(st.col); gl.deleteBuffer(st.msk);
    gl.deleteBuffer(st.idx);
    if (st.edges) gl.deleteBuffer(st.edges);
    if (st.paintTex) gl.deleteTexture(st.paintTex);
    obj.renderState = null;
  };

  R.syncObject = function (obj, wantEdges) {
    var gl = this.gl;
    var mesh = obj.mesh;
    var st = this.objectState(obj);
    var vertSlots = mesh.masks.length;

    if (st.vertCapacity < vertSlots) {
      var cap = Math.max(vertSlots, 1024);
      gl.bindBuffer(gl.ARRAY_BUFFER, st.pos);
      gl.bufferData(gl.ARRAY_BUFFER, cap * 12, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, st.nor);
      gl.bufferData(gl.ARRAY_BUFFER, cap * 12, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, st.col);
      gl.bufferData(gl.ARRAY_BUFFER, cap * 12, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, st.msk);
      gl.bufferData(gl.ARRAY_BUFFER, cap * 4, gl.DYNAMIC_DRAW);
      st.vertCapacity = cap;
      mesh.dirtyMinVert = 0;
      mesh.dirtyMaxVert = vertSlots - 1;
    }

    // vertex attributes: either the touched range or everything
    if (mesh.dirtyMaxVert >= 0) {
      var from = Math.max(0, mesh.dirtyMinVert);
      var to = Math.min(vertSlots - 1, mesh.dirtyMaxVert);
      var count = to - from + 1;
      if (count > 0) {
        var wide = count > vertSlots * 0.6;
        if (wide) { from = 0; count = vertSlots; }
        var bytes = 0;
        gl.bindBuffer(gl.ARRAY_BUFFER, st.pos);
        gl.bufferSubData(gl.ARRAY_BUFFER, from * 12, mesh.positions.array, from * 3, count * 3);
        gl.bindBuffer(gl.ARRAY_BUFFER, st.nor);
        gl.bufferSubData(gl.ARRAY_BUFFER, from * 12, mesh.normals.array, from * 3, count * 3);
        gl.bindBuffer(gl.ARRAY_BUFFER, st.col);
        gl.bufferSubData(gl.ARRAY_BUFFER, from * 12, mesh.colors.array, from * 3, count * 3);
        gl.bindBuffer(gl.ARRAY_BUFFER, st.msk);
        gl.bufferSubData(gl.ARRAY_BUFFER, from * 4, mesh.masks.array, from, count);
        bytes = count * 40;
        this.stats.uploadedBytes += bytes;
      }
      mesh.clearDirty();
    }

    if (mesh.topoDirty || st.indexCount === 0) {
      var indices = this._buildIndices(mesh);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, st.idx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
      st.indexCount = indices.length;
      st.topoStamp = (st.topoStamp + 1) | 0;
      mesh.topoDirty = false;
      st.edgeTopoStamp = -1;
    }

    /*
     * The paint image. Only the part that changed is sent: a stroke touches
     * a patch of a four-megabyte image, and sending all of it per dab is the
     * difference between painting and waiting.
     */
    var map = obj.paint;
    if (map) {
      if (!st.paintTex || st.paintSize !== map.size) {
        if (st.paintTex) gl.deleteTexture(st.paintTex);
        st.paintTex = gl.createTexture();
        st.paintSize = map.size;
        st.paintVersion = -1;
        gl.bindTexture(gl.TEXTURE_2D, st.paintTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, map.size, map.size, 0,
                      gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        map.markDirty(0, 0, map.size - 1, map.size - 1);
      }
      if (st.paintVersion !== map.version) {
        var px0 = map.dirtyX0, py0 = map.dirtyY0, px1 = map.dirtyX1, py1 = map.dirtyY1;
        if (px1 < px0 || py1 < py0) { px0 = py0 = 0; px1 = py1 = map.size - 1; }
        var pw = px1 - px0 + 1, ph = py1 - py0 + 1;
        gl.bindTexture(gl.TEXTURE_2D, st.paintTex);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, map.size);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, py0);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, px0);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, px0, py0, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, map.pixels);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
        st.paintVersion = map.version;
        map.clearDirty();
        this.stats.uploadedBytes += pw * ph * 4;
      }
    }

    if (wantEdges && st.edgeTopoStamp !== st.topoStamp) {
      if (!st.edges) st.edges = gl.createBuffer();
      var edges = this._buildEdges(mesh);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, st.edges);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, edges, gl.STATIC_DRAW);
      st.edgeCount = edges.length;
      st.edgeTopoStamp = st.topoStamp;
    }
    return st;
  };

  R._buildIndices = function (mesh) {
    var out = new Uint32Array(mesh.liveTris * 3);
    var T = mesh.tris.array, dead = mesh.triDead.array;
    var n = mesh.triDead.length, w = 0;
    for (var t = 0; t < n; t++) {
      if (dead[t]) continue;
      var t3 = t * 3;
      out[w++] = T[t3]; out[w++] = T[t3 + 1]; out[w++] = T[t3 + 2];
    }
    return w === out.length ? out : out.subarray(0, w);
  };

  R._buildEdges = function (mesh) {
    // three edges per triangle; shared edges are drawn twice, which costs a
    // little fill rate and saves building an edge set for a 500k-tri mesh
    var out = new Uint32Array(mesh.liveTris * 6);
    var T = mesh.tris.array, dead = mesh.triDead.array;
    var n = mesh.triDead.length, w = 0;
    for (var t = 0; t < n; t++) {
      if (dead[t]) continue;
      var t3 = t * 3;
      var a = T[t3], b = T[t3 + 1], c = T[t3 + 2];
      out[w++] = a; out[w++] = b;
      out[w++] = b; out[w++] = c;
      out[w++] = c; out[w++] = a;
    }
    return w === out.length ? out : out.subarray(0, w);
  };

  /* ---- static line geometry ------------------------------------------ */

  R.buildGrid = function (extent, divisions) {
    extent = extent || 1;
    divisions = divisions || 20;
    var verts = [];
    var step = extent * 2 / divisions;
    for (var i = 0; i <= divisions; i++) {
      var p = -extent + i * step;
      verts.push(-extent, 0, p, extent, 0, p);
      verts.push(p, 0, -extent, p, 0, extent);
    }
    this.gridLines = new Float32Array(verts);
    this.axisLines = new Float32Array([
      -extent, 0, 0, extent, 0, 0,
      0, 0, -extent, 0, 0, extent
    ]);
  };

  R.drawLines = function (data, count, color, mv, opts) {
    var gl = this.gl;
    opts = opts || {};
    if (count > this._lineCapacity) {
      this._lineCapacity = S.nextPow2(count);
      this._lineData = new Float32Array(this._lineCapacity * 3);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this._lineCapacity * 12, gl.DYNAMIC_DRAW);
    }
    var prog = this.progLine;
    gl.useProgram(prog.program);
    gl.bindVertexArray(this._lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._lineBuf);
    // (re)allocate lazily on first use
    if (!this._lineAllocated) {
      gl.bufferData(gl.ARRAY_BUFFER, this._lineCapacity * 12, gl.DYNAMIC_DRAW);
      this._lineAllocated = true;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 3);
    gl.uniformMatrix4fv(prog.u.uModelView, false, mv || this._mv);
    gl.uniformMatrix4fv(prog.u.uProj, false, this._proj);
    gl.uniform4fv(prog.u.uColor, color);
    gl.uniform1f(prog.u.uDepthNudge, opts.nudge === undefined ? 0 : opts.nudge);
    gl.uniform1f(prog.u.uFadeStart, opts.fadeStart === undefined ? 0 : opts.fadeStart);
    gl.uniform1f(prog.u.uFadeEnd, opts.fadeEnd === undefined ? 0 : opts.fadeEnd);
    gl.drawArrays(gl.LINES, 0, count);
    gl.bindVertexArray(null);
    this.stats.drawCalls++;
  };

  /* ---- the frame ------------------------------------------------------ */

  /**
   * Draw the scene.
   *
   * opts: {
   *   background: [topColor, bottomColor], vignette,
   *   wireframe, flat, vertexColors, cavity, maskVis, grid, symmetry,
   *   cursor: {point, normal, radius, inner, valid}, activeIndex
   * }
   */
  R.render = function (scene, camera, opts) {
    opts = opts || {};
    var gl = this.gl;
    this.stats.drawCalls = 0;
    this.stats.triangles = 0;
    this._proj = camera.proj;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);

    // background
    var bg = opts.background || [[0.17, 0.19, 0.23], [0.07, 0.08, 0.1]];
    gl.useProgram(this.progBg.program);
    gl.bindVertexArray(this.bgVao);
    gl.uniform3fv(this.progBg.u.uTop, bg[0]);
    gl.uniform3fv(this.progBg.u.uBottom, bg[1]);
    gl.uniform1f(this.progBg.u.uVignette, opts.vignette === undefined ? 0.35 : opts.vignette);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this.stats.drawCalls++;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    // grid, drawn before the meshes so it never hides them
    if (opts.grid) {
      var gridExtent = opts.gridExtent || 1;
      M4.copy(this._mv, camera.view);
      var scaleM = M4.identity(this._tmpMat);
      scaleM[0] = scaleM[5] = scaleM[10] = gridExtent;
      M4.multiply(this._mv, camera.view, scaleM);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      this.drawLines(this.gridLines, this.gridLines.length / 3, [0.55, 0.6, 0.68, 0.16], this._mv,
                     { fadeStart: camera.distance * 0.6, fadeEnd: camera.distance * 3.2 });
      this.drawLines(this.axisLines, 4, [0.7, 0.75, 0.85, 0.3], this._mv,
                     { fadeStart: camera.distance * 0.6, fadeEnd: camera.distance * 3.2 });
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // meshes
    var prog = this.progMesh;
    gl.useProgram(prog.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.matcapTextures[this.matcapId] || this.matcapTextures.clay);
    gl.uniform1i(prog.u.uMatcap, 0);
    gl.uniformMatrix4fv(prog.u.uProj, false, camera.proj);
    gl.uniform1f(prog.u.uFlat, opts.flat ? 1 : 0);
    gl.uniform1f(prog.u.uVertexColor, opts.vertexColors ? 1 : 0);
    gl.uniform1f(prog.u.uCavity, opts.cavity === undefined ? 0.35 : opts.cavity);
    gl.uniform1f(prog.u.uMaskVis, opts.maskVis === undefined ? 1 : opts.maskVis);

    for (var i = 0; i < scene.objects.length; i++) {
      var obj = scene.objects[i];
      if (!obj.visible || !obj.mesh.liveTris) continue;
      var st = this.syncObject(obj, !!opts.wireframe);
      M4.multiply(this._mv, camera.view, obj.matrix());
      M4.normalMatrix(this._nm4, this._mv);
      this._nm[0] = this._nm4[0]; this._nm[1] = this._nm4[1]; this._nm[2] = this._nm4[2];
      this._nm[3] = this._nm4[4]; this._nm[4] = this._nm4[5]; this._nm[5] = this._nm4[6];
      this._nm[6] = this._nm4[8]; this._nm[7] = this._nm4[9]; this._nm[8] = this._nm4[10];
      gl.useProgram(prog.program);
      gl.uniformMatrix4fv(prog.u.uModelView, false, this._mv);
      gl.uniformMatrix3fv(prog.u.uNormalMat, false, this._nm);
      gl.uniform3fv(prog.u.uTint, obj.baseColor);
      gl.uniform1f(prog.u.uGhost, 1);
      if (obj.paint && st.paintTex && opts.vertexColors !== false) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, st.paintTex);
        gl.uniform1i(prog.u.uPaintTex, 1);
        gl.uniform1f(prog.u.uPaint, 1);
        gl.uniform1f(prog.u.uPaintScale, obj.paint.scale);
        gl.uniform2fv(prog.u.uPaintOff, obj.paint.off);
        gl.activeTexture(gl.TEXTURE0);
      } else {
        gl.uniform1f(prog.u.uPaint, 0);
      }
      gl.bindVertexArray(st.vao);
      if (obj.doubleSided) gl.disable(gl.CULL_FACE);
      gl.drawElements(gl.TRIANGLES, st.indexCount, gl.UNSIGNED_INT, 0);
      if (obj.doubleSided) gl.enable(gl.CULL_FACE);
      gl.bindVertexArray(null);
      this.stats.drawCalls++;
      this.stats.triangles += st.indexCount / 3;

      if (opts.wireframe && st.edges) {
        gl.useProgram(this.progLine.program);
        gl.bindVertexArray(st.vao);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, st.edges);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniformMatrix4fv(this.progLine.u.uModelView, false, this._mv);
        gl.uniformMatrix4fv(this.progLine.u.uProj, false, camera.proj);
        gl.uniform4fv(this.progLine.u.uColor, [0.05, 0.06, 0.08, 0.35]);
        gl.uniform1f(this.progLine.u.uDepthNudge, 0.0012);
        gl.uniform1f(this.progLine.u.uFadeStart, 0);
        gl.uniform1f(this.progLine.u.uFadeEnd, 0);
        gl.drawElements(gl.LINES, st.edgeCount, gl.UNSIGNED_INT, 0);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
        // the shared VAO's element binding was changed; put the index buffer back
        gl.bindVertexArray(st.vao);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, st.idx);
        gl.bindVertexArray(null);
        this.stats.drawCalls++;
      }
    }

    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // symmetry planes
    if (opts.symmetry && opts.symmetry.any) {
      var obj2 = scene.current();
      if (obj2) {
        M4.multiply(this._mv, camera.view, obj2.matrix());
        var r = Math.max(obj2.mesh.boundsRadius(), 1e-3) * 0.82;
        var planes = [
          { on: opts.symmetry.x, color: [1, 0.45, 0.48, 0.17], axis: 0 },
          { on: opts.symmetry.y, color: [0.58, 1, 0.52, 0.17], axis: 1 },
          { on: opts.symmetry.z, color: [0.52, 0.68, 1, 0.17], axis: 2 }
        ];
        for (var pi = 0; pi < planes.length; pi++) {
          if (!planes[pi].on) continue;
          var lines = this._planeLines(planes[pi].axis, r);
          gl.depthMask(false);
          this.drawLines(lines, lines.length / 3, planes[pi].color, this._mv, { nudge: 0 });
          gl.depthMask(true);
        }
      }
    }

    // brush cursor
    if (opts.cursor && opts.cursor.valid) {
      var c = opts.cursor;
      var ring = this._cursorLines(c.point, c.normal, c.radius, c.inner);
      gl.depthMask(false);
      gl.disable(gl.DEPTH_TEST);
      this.drawLines(ring, ring.length / 3, c.color || [1, 1, 1, 0.85], camera.view, {});
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
    }

    gl.disable(gl.BLEND);
    return this.stats;
  };

  /**
   * The mirror plane as a square outline plus a cross, sized to the object.
   * A full grid of lines reads as scene clutter rather than as a plane.
   */
  R._planeLines = function (axis, r) {
    var out = [];
    var a = (axis + 1) % 3, b = (axis + 2) % 3;
    function pt(u, v) {
      var p = [0, 0, 0];
      p[a] = u; p[b] = v;
      return p;
    }
    function seg(p1, p2) { out.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]); }
    // outline
    seg(pt(-r, -r), pt(r, -r));
    seg(pt(r, -r), pt(r, r));
    seg(pt(r, r), pt(-r, r));
    seg(pt(-r, r), pt(-r, -r));
    // cross through the middle
    seg(pt(-r, 0), pt(r, 0));
    seg(pt(0, -r), pt(0, r));
    return new Float32Array(out);
  };

  R._cursorLines = function (point, normal, radius, innerFraction) {
    var segs = 48;
    var u = V3.create(0, 0, 0), v = V3.create(0, 0, 0);
    V3.perpendicular(u, normal);
    V3.cross(v, normal, u);
    V3.normalize(v, v);
    var out = new Float32Array((segs * 2 + (innerFraction ? segs * 2 : 0) + 2) * 3);
    var w = 0, i, a, x, y, z, a2, x2, y2, z2;
    for (i = 0; i < segs; i++) {
      a = (i / segs) * Math.PI * 2;
      a2 = ((i + 1) / segs) * Math.PI * 2;
      x = point[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * radius;
      y = point[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * radius;
      z = point[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * radius;
      x2 = point[0] + (u[0] * Math.cos(a2) + v[0] * Math.sin(a2)) * radius;
      y2 = point[1] + (u[1] * Math.cos(a2) + v[1] * Math.sin(a2)) * radius;
      z2 = point[2] + (u[2] * Math.cos(a2) + v[2] * Math.sin(a2)) * radius;
      out[w++] = x; out[w++] = y; out[w++] = z;
      out[w++] = x2; out[w++] = y2; out[w++] = z2;
    }
    if (innerFraction) {
      var ir = radius * innerFraction;
      for (i = 0; i < segs; i++) {
        a = (i / segs) * Math.PI * 2;
        a2 = ((i + 1) / segs) * Math.PI * 2;
        out[w++] = point[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * ir;
        out[w++] = point[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * ir;
        out[w++] = point[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * ir;
        out[w++] = point[0] + (u[0] * Math.cos(a2) + v[0] * Math.sin(a2)) * ir;
        out[w++] = point[1] + (u[1] * Math.cos(a2) + v[1] * Math.sin(a2)) * ir;
        out[w++] = point[2] + (u[2] * Math.cos(a2) + v[2] * Math.sin(a2)) * ir;
      }
    }
    // a short spike along the normal shows which way the brush pushes
    out[w++] = point[0]; out[w++] = point[1]; out[w++] = point[2];
    out[w++] = point[0] + normal[0] * radius * 0.45;
    out[w++] = point[1] + normal[1] * radius * 0.45;
    out[w++] = point[2] + normal[2] * radius * 0.45;
    return out.subarray(0, w);
  };

  /** Read the current frame back as a PNG blob (call right after render). */
  R.screenshot = function (callback, type, quality) {
    this.canvas.toBlob(callback, type || 'image/png', quality);
  };

  R.contextInfo = function () {
    var gl = this.gl;
    var dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE)
    };
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
