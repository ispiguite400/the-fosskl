/*
 * SculptFree — core: namespace, math, growable typed arrays, small utilities.
 *
 * Everything here is DOM-free so the geometry and I/O layers can be unit
 * tested under Node. The module attaches to a single global namespace so the
 * whole app can be concatenated into one <script> block for the standalone
 * single-file build.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT || (root.SCULPT = {});
  S.VERSION = '1.0.0';

  /* ------------------------------------------------------------------ *
   * scalars
   * ------------------------------------------------------------------ */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(t) { return t * t * (3 - 2 * t); }
  function smootherstep(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function sign(v) { return v < 0 ? -1 : 1; }
  function nextPow2(v) { var p = 1; while (p < v) p *= 2; return p; }

  S.clamp = clamp;
  S.lerp = lerp;
  S.smoothstep = smoothstep;
  S.smootherstep = smootherstep;
  S.sign = sign;
  S.nextPow2 = nextPow2;

  /* ------------------------------------------------------------------ *
   * growable typed arrays
   *
   * Sculpting adds and removes vertices constantly, so the mesh keeps its
   * attributes in buffers that can grow without reallocating on every push.
   * `array` is the live buffer; `length` is how much of it is in use.
   * ------------------------------------------------------------------ */

  function Buf(Ctor, capacity, stride) {
    this.Ctor = Ctor;
    this.stride = stride || 1;
    this.array = new Ctor(Math.max(capacity || 0, this.stride) );
    this.length = 0;                     // in elements, not items
  }

  Buf.prototype.reserve = function (elements) {
    if (elements <= this.array.length) return;
    var cap = this.array.length || this.stride;
    while (cap < elements) cap *= 2;
    var next = new this.Ctor(cap);
    next.set(this.array.subarray(0, this.length));
    this.array = next;
  };

  /** Make room for `n` more elements and return the offset they start at. */
  Buf.prototype.push = function (n) {
    var at = this.length;
    this.reserve(at + n);
    this.length = at + n;
    return at;
  };

  Buf.prototype.clear = function () { this.length = 0; };

  /** A view of the used region — cheap, no copy. */
  Buf.prototype.view = function () { return this.array.subarray(0, this.length); };

  /** A standalone copy of the used region. */
  Buf.prototype.copy = function () { return this.array.slice(0, this.length); };

  Buf.prototype.setFrom = function (src, count) {
    var n = count === undefined ? src.length : count;
    this.reserve(n);
    this.array.set(n === src.length ? src : src.subarray(0, n), 0);
    this.length = n;
  };

  S.Buf = Buf;
  S.f32 = function (cap, stride) { return new Buf(Float32Array, cap, stride); };
  S.u32 = function (cap, stride) { return new Buf(Uint32Array, cap, stride); };
  S.u8 = function (cap, stride) { return new Buf(Uint8Array, cap, stride); };

  /* ------------------------------------------------------------------ *
   * vec3 — component-wise helpers. The hot loops in the sculpt engine use
   * raw scalars to stay allocation-free; these are for the cold paths.
   * ------------------------------------------------------------------ */

  var V3 = {
    create: function (x, y, z) { return new Float32Array([x || 0, y || 0, z || 0]); },
    set: function (o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; },
    copy: function (o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
    add: function (o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
    sub: function (o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
    scale: function (o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
    addScaled: function (o, a, b, s) { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; },
    dot: function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
    cross: function (o, a, b) {
      var ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
      o[0] = ay * bz - az * by; o[1] = az * bx - ax * bz; o[2] = ax * by - ay * bx;
      return o;
    },
    len: function (a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); },
    lenSq: function (a) { return a[0] * a[0] + a[1] * a[1] + a[2] * a[2]; },
    dist: function (a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return Math.sqrt(x * x + y * y + z * z); },
    normalize: function (o, a) {
      var l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
      if (l > 1e-20) { l = 1 / l; o[0] = a[0] * l; o[1] = a[1] * l; o[2] = a[2] * l; }
      else { o[0] = o[1] = o[2] = 0; }
      return o;
    },
    lerp: function (o, a, b, t) {
      o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t;
      return o;
    },
    /** Any unit vector perpendicular to `a` (assumed normalized). */
    perpendicular: function (o, a) {
      if (Math.abs(a[0]) < 0.7) V3.cross(o, a, V3.AXIS_X);
      else V3.cross(o, a, V3.AXIS_Y);
      return V3.normalize(o, o);
    },
    transformMat4: function (o, a, m) {
      var x = a[0], y = a[1], z = a[2];
      var w = m[3] * x + m[7] * y + m[11] * z + m[15];
      w = w || 1;
      o[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      o[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      o[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
      return o;
    },
    /** Direction transform — ignores translation. */
    transformDir: function (o, a, m) {
      var x = a[0], y = a[1], z = a[2];
      o[0] = m[0] * x + m[4] * y + m[8] * z;
      o[1] = m[1] * x + m[5] * y + m[9] * z;
      o[2] = m[2] * x + m[6] * y + m[10] * z;
      return o;
    }
  };
  V3.AXIS_X = V3.create(1, 0, 0);
  V3.AXIS_Y = V3.create(0, 1, 0);
  V3.AXIS_Z = V3.create(0, 0, 1);
  S.V3 = V3;

  /* ------------------------------------------------------------------ *
   * mat4 — column-major, same convention as WebGL/GLSL.
   * ------------------------------------------------------------------ */

  var M4 = {
    create: function () {
      var m = new Float32Array(16);
      m[0] = m[5] = m[10] = m[15] = 1;
      return m;
    },
    identity: function (m) {
      m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
      m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
      m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
      m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
      return m;
    },
    copy: function (o, a) { o.set(a); return o; },
    multiply: function (o, a, b) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
          a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
          a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
          a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      for (var i = 0; i < 4; i++) {
        var b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
        o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      }
      return o;
    },
    perspective: function (o, fovy, aspect, near, far) {
      var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      o[0] = f / aspect; o[1] = 0; o[2] = 0; o[3] = 0;
      o[4] = 0; o[5] = f; o[6] = 0; o[7] = 0;
      o[8] = 0; o[9] = 0; o[10] = (far + near) * nf; o[11] = -1;
      o[12] = 0; o[13] = 0; o[14] = 2 * far * near * nf; o[15] = 0;
      return o;
    },
    ortho: function (o, l, r, b, t, n, f) {
      var lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
      o[0] = -2 * lr; o[1] = 0; o[2] = 0; o[3] = 0;
      o[4] = 0; o[5] = -2 * bt; o[6] = 0; o[7] = 0;
      o[8] = 0; o[9] = 0; o[10] = 2 * nf; o[11] = 0;
      o[12] = (l + r) * lr; o[13] = (t + b) * bt; o[14] = (f + n) * nf; o[15] = 1;
      return o;
    },
    lookAt: function (o, eye, center, up) {
      var zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
      var l = Math.sqrt(zx * zx + zy * zy + zz * zz);
      if (l < 1e-12) return M4.identity(o);
      l = 1 / l; zx *= l; zy *= l; zz *= l;
      var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      l = Math.sqrt(xx * xx + xy * xy + xz * xz);
      if (l < 1e-12) { xx = 1; xy = 0; xz = 0; } else { l = 1 / l; xx *= l; xy *= l; xz *= l; }
      var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
      o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
      o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
      o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
      o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
      o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
      o[15] = 1;
      return o;
    },
    /** Trans * Rot(quat) * Scale, the standard object transform. */
    compose: function (o, pos, q, scl) {
      var x = q[0], y = q[1], z = q[2], w = q[3];
      var x2 = x + x, y2 = y + y, z2 = z + z;
      var xx = x * x2, xy = x * y2, xz = x * z2;
      var yy = y * y2, yz = y * z2, zz = z * z2;
      var wx = w * x2, wy = w * y2, wz = w * z2;
      var sx = scl[0], sy = scl[1], sz = scl[2];
      o[0] = (1 - (yy + zz)) * sx; o[1] = (xy + wz) * sx; o[2] = (xz - wy) * sx; o[3] = 0;
      o[4] = (xy - wz) * sy; o[5] = (1 - (xx + zz)) * sy; o[6] = (yz + wx) * sy; o[7] = 0;
      o[8] = (xz + wy) * sz; o[9] = (yz - wx) * sz; o[10] = (1 - (xx + yy)) * sz; o[11] = 0;
      o[12] = pos[0]; o[13] = pos[1]; o[14] = pos[2]; o[15] = 1;
      return o;
    },
    invert: function (o, m) {
      var a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3],
          a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7],
          a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11],
          a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
      var b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10,
          b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
          b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
          b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
          b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31,
          b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return M4.identity(o);
      det = 1 / det;
      o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
      o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
      o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return o;
    },
    /** Inverse-transpose of the upper 3x3, packed into a mat4 for normals. */
    normalMatrix: function (o, m) {
      M4.invert(o, m);
      // transpose the 3x3 block in place
      var t;
      t = o[1]; o[1] = o[4]; o[4] = t;
      t = o[2]; o[2] = o[8]; o[8] = t;
      t = o[6]; o[6] = o[9]; o[9] = t;
      o[3] = o[7] = o[11] = o[12] = o[13] = o[14] = 0;
      o[15] = 1;
      return o;
    }
  };
  S.M4 = M4;

  /* ------------------------------------------------------------------ *
   * quat
   * ------------------------------------------------------------------ */

  var Q4 = {
    create: function () { return new Float32Array([0, 0, 0, 1]); },
    identity: function (q) { q[0] = q[1] = q[2] = 0; q[3] = 1; return q; },
    setAxisAngle: function (q, axis, rad) {
      var h = rad * 0.5, s = Math.sin(h);
      q[0] = axis[0] * s; q[1] = axis[1] * s; q[2] = axis[2] * s; q[3] = Math.cos(h);
      return q;
    },
    multiply: function (o, a, b) {
      var ax = a[0], ay = a[1], az = a[2], aw = a[3];
      var bx = b[0], by = b[1], bz = b[2], bw = b[3];
      o[0] = ax * bw + aw * bx + ay * bz - az * by;
      o[1] = ay * bw + aw * by + az * bx - ax * bz;
      o[2] = az * bw + aw * bz + ax * by - ay * bx;
      o[3] = aw * bw - ax * bx - ay * by - az * bz;
      return o;
    },
    normalize: function (o, a) {
      var l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3]);
      if (l > 1e-20) { l = 1 / l; o[0] = a[0] * l; o[1] = a[1] * l; o[2] = a[2] * l; o[3] = a[3] * l; }
      else Q4.identity(o);
      return o;
    },
    fromEuler: function (q, x, y, z) {   // XYZ order, radians
      var c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
      var s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
      q[0] = s1 * c2 * c3 + c1 * s2 * s3;
      q[1] = c1 * s2 * c3 - s1 * c2 * s3;
      q[2] = c1 * c2 * s3 + s1 * s2 * c3;
      q[3] = c1 * c2 * c3 - s1 * s2 * s3;
      return q;
    },
    toEuler: function (out, q) {
      var x = q[0], y = q[1], z = q[2], w = q[3];
      var sinp = 2 * (w * y - z * x);
      out[0] = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
      out[1] = Math.abs(sinp) >= 1 ? sign(sinp) * Math.PI / 2 : Math.asin(sinp);
      out[2] = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
      return out;
    },
    rotateVec3: function (o, q, v) {
      var x = q[0], y = q[1], z = q[2], w = q[3];
      var vx = v[0], vy = v[1], vz = v[2];
      var tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
      o[0] = vx + w * tx + (y * tz - z * ty);
      o[1] = vy + w * ty + (z * tx - x * tz);
      o[2] = vz + w * tz + (x * ty - y * tx);
      return o;
    }
  };
  S.Q4 = Q4;

  /* ------------------------------------------------------------------ *
   * geometry predicates used by picking and remeshing
   * ------------------------------------------------------------------ */

  /**
   * Ray/triangle intersection (Moller-Trumbore). Returns the ray parameter
   * `t` or -1 on a miss. `cull` rejects back faces.
   */
  S.rayTriangle = function (ox, oy, oz, dx, dy, dz,
                            ax, ay, az, bx, by, bz, cx, cy, cz, cull) {
    var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    var e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    var px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    var det = e1x * px + e1y * py + e1z * pz;
    if (cull) { if (det < 1e-12) return -1; }
    else if (det > -1e-12 && det < 1e-12) return -1;
    var inv = 1 / det;
    var tx = ox - ax, ty = oy - ay, tz = oz - az;
    var u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-6 || u > 1 + 1e-6) return -1;
    var qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    var v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-6 || u + v > 1 + 1e-6) return -1;
    return (e2x * qx + e2y * qy + e2z * qz) * inv;
  };

  /** Slab test. Returns [tmin, tmax] overlap with the ray, or null. */
  S.rayAABB = function (ox, oy, oz, dx, dy, dz, min, max, out) {
    var t0 = -Infinity, t1 = Infinity, inv, a, b;
    inv = 1 / dx; a = (min[0] - ox) * inv; b = (max[0] - ox) * inv;
    if (a > b) { var s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b;
    inv = 1 / dy; a = (min[1] - oy) * inv; b = (max[1] - oy) * inv;
    if (a > b) { var s2 = a; a = b; b = s2; }
    if (a > t0) t0 = a; if (b < t1) t1 = b;
    inv = 1 / dz; a = (min[2] - oz) * inv; b = (max[2] - oz) * inv;
    if (a > b) { var s3 = a; a = b; b = s3; }
    if (a > t0) t0 = a; if (b < t1) t1 = b;
    if (t1 < t0 || t1 < 0) return null;
    out[0] = t0; out[1] = t1;
    return out;
  };

  /** Squared distance from a point to a triangle, plus the closest point. */
  S.pointTriangleSq = function (px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
    var abx = bx - ax, aby = by - ay, abz = bz - az;
    var acx = cx - ax, acy = cy - ay, acz = cz - az;
    var apx = px - ax, apy = py - ay, apz = pz - az;
    var d1 = abx * apx + aby * apy + abz * apz;
    var d2 = acx * apx + acy * apy + acz * apz;
    var qx, qy, qz;
    if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
    else {
      var bpx = px - bx, bpy = py - by, bpz = pz - bz;
      var d3 = abx * bpx + aby * bpy + abz * bpz;
      var d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
      else {
        var vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) {
          var v1 = d1 / (d1 - d3);
          qx = ax + abx * v1; qy = ay + aby * v1; qz = az + abz * v1;
        } else {
          var cpx = px - cx, cpy = py - cy, cpz = pz - cz;
          var d5 = abx * cpx + aby * cpy + abz * cpz;
          var d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
          else {
            var vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) {
              var w1 = d2 / (d2 - d6);
              qx = ax + acx * w1; qy = ay + acy * w1; qz = az + acz * w1;
            } else {
              var va = d3 * d6 - d5 * d4;
              if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
                var w2 = (d4 - d3) / ((d4 - d3) + (d5 - d6));
                qx = bx + (cx - bx) * w2; qy = by + (cy - by) * w2; qz = bz + (cz - bz) * w2;
              } else {
                var den = 1 / (va + vb + vc);
                var vv = vb * den, ww = vc * den;
                qx = ax + abx * vv + acx * ww;
                qy = ay + aby * vv + acy * ww;
                qz = az + abz * vv + acz * ww;
              }
            }
          }
        }
      }
    }
    if (out) { out[0] = qx; out[1] = qy; out[2] = qz; }
    var dx = px - qx, dy = py - qy, dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
  };

  /* ------------------------------------------------------------------ *
   * misc
   * ------------------------------------------------------------------ */

  /** Binary min-heap keyed by float cost. Used by the decimator. */
  function Heap() { this.cost = [0]; this.item = [0]; this.n = 0; }
  Heap.prototype.push = function (cost, item) {
    var i = ++this.n;
    this.cost[i] = cost; this.item[i] = item;
    while (i > 1) {
      var p = i >> 1;
      if (this.cost[p] <= this.cost[i]) break;
      var c = this.cost[p]; this.cost[p] = this.cost[i]; this.cost[i] = c;
      var t = this.item[p]; this.item[p] = this.item[i]; this.item[i] = t;
      i = p;
    }
  };
  Heap.prototype.pop = function () {
    if (this.n === 0) return -1;
    var top = this.item[1];
    this.cost[1] = this.cost[this.n]; this.item[1] = this.item[this.n];
    this.n--;
    var i = 1;
    for (;;) {
      var l = i << 1, r = l + 1, m = i;
      if (l <= this.n && this.cost[l] < this.cost[m]) m = l;
      if (r <= this.n && this.cost[r] < this.cost[m]) m = r;
      if (m === i) break;
      var c = this.cost[m]; this.cost[m] = this.cost[i]; this.cost[i] = c;
      var t = this.item[m]; this.item[m] = this.item[i]; this.item[i] = t;
      i = m;
    }
    return top;
  };
  S.Heap = Heap;

  S.formatCount = function (n) {
    if (n < 1000) return String(n);
    if (n < 1e6) {
      // 1280 -> "1.3k" but 2000 -> "2k", not "2.0k"
      var k = (n / 1000).toFixed(n < 10000 ? 1 : 0);
      return k.replace(/\.0$/, '') + 'k';
    }
    return (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
  };

  S.formatBytes = function (n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
