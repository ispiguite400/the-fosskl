/*
 * SculptFree — orbit camera.
 *
 * Spherical orbit around a target point, with the interface the stroke
 * engine needs: a ray through a screen pixel, and how many world units one
 * pixel covers at a given point (so brush radius can be specified in
 * pixels). Perspective and orthographic both work; view changes ease in so
 * hitting "front" does not teleport you.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var V3 = S.V3, M4 = S.M4;

  function Camera() {
    this.target = V3.create(0, 0, 0);
    this.distance = 3;
    this.yaw = Math.PI * 0.25;
    this.pitch = Math.PI * 0.12;
    this.fov = 42 * Math.PI / 180;
    this.ortho = false;
    this.width = 1;
    this.height = 1;
    this.near = 0.01;
    this.far = 100;

    this.eye = V3.create(0, 0, 3);
    this._right = V3.create(1, 0, 0);
    this._up = V3.create(0, 1, 0);
    this._forward = V3.create(0, 0, -1);
    this.view = M4.create();
    this.proj = M4.create();
    this.viewProj = M4.create();

    // eased transitions
    this._goal = null;
    this._roll = 0;
    this.update();
  }
  S.Camera = Camera;
  var P = Camera.prototype;

  P.setViewport = function (w, h) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.update();
  };

  P.aspect = function () { return this.width / this.height; };

  /** Half-height of the ortho frustum, matched to the perspective framing. */
  P.orthoHeight = function () {
    return Math.tan(this.fov / 2) * this.distance;
  };

  P.update = function () {
    var cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    var cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    var dirX = cp * sy, dirY = sp, dirZ = cp * cy;
    V3.set(this.eye, this.target[0] + dirX * this.distance,
                     this.target[1] + dirY * this.distance,
                     this.target[2] + dirZ * this.distance);
    V3.set(this._forward, -dirX, -dirY, -dirZ);
    V3.normalize(this._forward, this._forward);
    // right/up from the world up, which keeps the horizon level
    V3.set(this._right, cy, 0, -sy);
    V3.cross(this._up, this._right, this._forward);
    V3.normalize(this._up, this._up);

    M4.lookAt(this.view, this.eye, this.target, this._up);

    var radius = Math.max(this.distance, 0.001);
    this.near = Math.max(radius * 0.002, 1e-4);
    this.far = radius * 40 + 100;
    if (this.ortho) {
      var h = this.orthoHeight(), w = h * this.aspect();
      M4.ortho(this.proj, -w, w, -h, h, -this.far, this.far);
    } else {
      M4.perspective(this.proj, this.fov, this.aspect(), this.near, this.far);
    }
    M4.multiply(this.viewProj, this.proj, this.view);
    return this;
  };

  P.right = function () { return this._right; };
  P.up = function () { return this._up; };
  P.forward = function () { return this._forward; };

  /* ---- interaction -------------------------------------------------- */

  P.orbit = function (dxPixels, dyPixels) {
    var speed = 0.0075;
    this.yaw -= dxPixels * speed;
    this.pitch += dyPixels * speed;
    var limit = Math.PI / 2 - 0.01;
    this.pitch = S.clamp(this.pitch, -limit, limit);
    this.yaw = this.yaw % (Math.PI * 2);
    this._goal = null;
    this.update();
  };

  P.pan = function (dxPixels, dyPixels) {
    var perPixel = this.ortho ? (this.orthoHeight() * 2 / this.height)
                              : (2 * Math.tan(this.fov / 2) * this.distance / this.height);
    var t = this.target;
    t[0] -= this._right[0] * dxPixels * perPixel - this._up[0] * dyPixels * perPixel;
    t[1] -= this._right[1] * dxPixels * perPixel - this._up[1] * dyPixels * perPixel;
    t[2] -= this._right[2] * dxPixels * perPixel - this._up[2] * dyPixels * perPixel;
    this._goal = null;
    this.update();
  };

  P.zoom = function (factor) {
    this.distance = S.clamp(this.distance * factor, 1e-3, 1e5);
    this._goal = null;
    this.update();
  };

  /** Zoom towards a point under the cursor, like a map. */
  P.zoomAt = function (factor, worldPoint) {
    if (!worldPoint) return this.zoom(factor);
    var before = V3.create(0, 0, 0);
    V3.sub(before, worldPoint, this.target);
    var newDist = S.clamp(this.distance * factor, 1e-3, 1e5);
    var moved = 1 - newDist / this.distance;
    this.distance = newDist;
    V3.addScaled(this.target, this.target, before, moved * 0.8);
    this._goal = null;
    this.update();
  };

  /* ---- framing ------------------------------------------------------ */

  /**
   * Frame a box so it fits the part of the canvas that is actually visible.
   *
   * `insets` (pixels: top, bottom, left, right) keeps the model clear of the
   * interface. Both axes are considered, which matters on a phone held
   * vertically: fitting the vertical field of view alone would run the model
   * off the sides, because the horizontal field is much narrower there.
   */
  P.frameBounds = function (min, max, immediate, insets) {
    var cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
    var dx = max[0] - min[0], dy = max[1] - min[1], dz = max[2] - min[2];
    var radius = Math.max(0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz), 1e-4);

    var top = insets && insets.top || 0, bottom = insets && insets.bottom || 0;
    var left = insets && insets.left || 0, right = insets && insets.right || 0;
    var usableW = Math.max(40, this.width - left - right);
    var usableH = Math.max(40, this.height - top - bottom);

    // How wide and tall the box actually appears: its support along the
    // camera's right and up axes. Fitting the box's diagonal instead (a
    // bounding sphere) wastes a third of the screen on anything round.
    var r = this._right, u = this._up;
    var halfW = 0.5 * (Math.abs(dx * r[0]) + Math.abs(dy * r[1]) + Math.abs(dz * r[2]));
    var halfH = 0.5 * (Math.abs(dx * u[0]) + Math.abs(dy * u[1]) + Math.abs(dz * u[2]));
    // depth extent, so a deep object is not clipped by moving in too close
    var f = this._forward;
    var halfD = 0.5 * (Math.abs(dx * f[0]) + Math.abs(dy * f[1]) + Math.abs(dz * f[2]));

    var tanV = Math.tan(this.fov / 2);
    var tanUsableV = tanV * (usableH / this.height);
    var tanUsableH = tanV * this.aspect() * (usableW / this.width);
    var dist = Math.max(halfH / Math.max(tanUsableV, 1e-6),
                        halfW / Math.max(tanUsableH, 1e-6)) * 1.03 + halfD * 0.5;
    if (!(dist > 1e-6)) dist = radius * 3;

    // shift the target so the model sits in the middle of the visible area
    var target = V3.create(cx, cy, cz);
    var perPixel = 2 * tanV * dist / this.height;
    var offX = (left + usableW / 2) - this.width / 2;
    var offY = (top + usableH / 2) - this.height / 2;
    V3.addScaled(target, target, this._right, -offX * perPixel);
    V3.addScaled(target, target, this._up, offY * perPixel);

    if (immediate) {
      V3.copy(this.target, target);
      this.distance = dist;
      this._goal = null;
      this.update();
    } else {
      this._goal = { target: target, distance: dist, yaw: this.yaw, pitch: this.pitch };
    }
    return this;
  };

  var VIEWS = {
    front: [0, 0], back: [Math.PI, 0], right: [Math.PI / 2, 0], left: [-Math.PI / 2, 0],
    top: [0, Math.PI / 2 - 0.001], bottom: [0, -Math.PI / 2 + 0.001],
    iso: [Math.PI * 0.25, Math.PI * 0.18]
  };
  P.setView = function (name, immediate) {
    var v = VIEWS[name];
    if (!v) return this;
    if (immediate) {
      this.yaw = v[0]; this.pitch = v[1];
      this._goal = null;
      this.update();
    } else {
      // take the shortest way round
      var yaw = v[0];
      while (yaw - this.yaw > Math.PI) yaw -= Math.PI * 2;
      while (this.yaw - yaw > Math.PI) yaw += Math.PI * 2;
      this._goal = { target: V3.create(this.target[0], this.target[1], this.target[2]),
                     distance: this.distance, yaw: yaw, pitch: v[1] };
    }
    return this;
  };

  P.viewNames = function () { return Object.keys(VIEWS); };

  /** Advance an eased transition. Returns true while still moving. */
  P.animate = function (dt) {
    var g = this._goal;
    if (!g) return false;
    var k = 1 - Math.pow(0.001, Math.min(dt, 0.1));    // time-corrected easing
    this.yaw += (g.yaw - this.yaw) * k;
    this.pitch += (g.pitch - this.pitch) * k;
    this.distance += (g.distance - this.distance) * k;
    V3.lerp(this.target, this.target, g.target, k);
    var done = Math.abs(g.yaw - this.yaw) < 1e-4 && Math.abs(g.pitch - this.pitch) < 1e-4 &&
               Math.abs(g.distance - this.distance) < 1e-5 && V3.dist(g.target, this.target) < 1e-5;
    if (done) {
      this.yaw = g.yaw; this.pitch = g.pitch; this.distance = g.distance;
      V3.copy(this.target, g.target);
      this._goal = null;
    }
    this.update();
    return true;
  };

  /* ---- projection helpers ------------------------------------------- */

  /** Ray through a pixel. Pixel coordinates are CSS pixels, y down. */
  P.rayFromScreen = function (sx, sy, outOrigin, outDir) {
    var ndcX = (sx / this.width) * 2 - 1;
    var ndcY = 1 - (sy / this.height) * 2;
    var tanH = Math.tan(this.fov / 2);
    if (this.ortho) {
      var h = this.orthoHeight(), w = h * this.aspect();
      V3.set(outOrigin,
        this.eye[0] + this._right[0] * ndcX * w + this._up[0] * ndcY * h,
        this.eye[1] + this._right[1] * ndcX * w + this._up[1] * ndcY * h,
        this.eye[2] + this._right[2] * ndcX * w + this._up[2] * ndcY * h);
      V3.copy(outDir, this._forward);
      return;
    }
    var ax = ndcX * tanH * this.aspect(), ay = ndcY * tanH;
    V3.set(outDir,
      this._forward[0] + this._right[0] * ax + this._up[0] * ay,
      this._forward[1] + this._right[1] * ax + this._up[1] * ay,
      this._forward[2] + this._right[2] * ax + this._up[2] * ay);
    V3.normalize(outDir, outDir);
    V3.copy(outOrigin, this.eye);
  };

  /** World units per pixel at `point` — the brush radius conversion. */
  P.worldPerPixel = function (point) {
    if (this.ortho) return this.orthoHeight() * 2 / this.height;
    var dx = point[0] - this.eye[0], dy = point[1] - this.eye[1], dz = point[2] - this.eye[2];
    var depth = Math.abs(dx * this._forward[0] + dy * this._forward[1] + dz * this._forward[2]);
    if (depth < 1e-6) depth = 1e-6;
    return 2 * Math.tan(this.fov / 2) * depth / this.height;
  };

  /** World -> pixel, for placing labels and the on-screen radius circle. */
  P.project = function (point, out) {
    var m = this.viewProj;
    var x = point[0], y = point[1], z = point[2];
    var cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (Math.abs(cw) < 1e-9) cw = 1e-9;
    var cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw;
    var cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
    out[0] = (cx * 0.5 + 0.5) * this.width;
    out[1] = (0.5 - cy * 0.5) * this.height;
    out[2] = cw;
    return out;
  };

  P.serialize = function () {
    return { target: Array.from(this.target), distance: this.distance,
             yaw: this.yaw, pitch: this.pitch, fov: this.fov, ortho: this.ortho };
  };

  P.restore = function (data) {
    if (!data) return this;
    if (data.target) V3.set(this.target, data.target[0], data.target[1], data.target[2]);
    if (typeof data.distance === 'number') this.distance = data.distance;
    if (typeof data.yaw === 'number') this.yaw = data.yaw;
    if (typeof data.pitch === 'number') this.pitch = data.pitch;
    if (typeof data.fov === 'number') this.fov = data.fov;
    this.ortho = !!data.ortho;
    this._goal = null;
    return this.update();
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
