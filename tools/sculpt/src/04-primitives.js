/*
 * SculptFree — base meshes to start a sculpt from.
 *
 * Each builder returns { positions, indices } in a unit-ish size (roughly 1
 * unit across) so the camera framing and default brush sizes behave the same
 * whichever primitive you pick. Everything is welded by the caller.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var Prim = S.Prim = {};

  /* ---------------------------------------------------------------- *
   * icosphere — the default sculpting ball: near-uniform triangles
   * ---------------------------------------------------------------- */

  Prim.icosphere = function (subdivisions, radius) {
    radius = radius || 0.5;
    var t = (1 + Math.sqrt(5)) / 2;
    var verts = [
      -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0,
      0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t,
      t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1
    ];
    var faces = [
      0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
      1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
      3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
      4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1
    ];

    var pos = verts.slice(), idx = faces.slice();
    for (var s = 0; s < (subdivisions || 0); s++) {
      var mid = new Map();
      var nIdx = [];
      var count = pos.length / 3;
      function midpoint(a, b) {
        var key = a < b ? a * 1e7 + b : b * 1e7 + a;
        var f = mid.get(key);
        if (f !== undefined) return f;
        var a3 = a * 3, b3 = b * 3;
        pos.push((pos[a3] + pos[b3]) / 2, (pos[a3 + 1] + pos[b3 + 1]) / 2, (pos[a3 + 2] + pos[b3 + 2]) / 2);
        mid.set(key, count);
        return count++;
      }
      for (var i = 0; i < idx.length; i += 3) {
        var a = idx[i], b = idx[i + 1], c = idx[i + 2];
        var ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
        nIdx.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      }
      idx = nIdx;
    }

    var out = new Float32Array(pos.length);
    for (var v = 0; v < pos.length; v += 3) {
      var l = Math.sqrt(pos[v] * pos[v] + pos[v + 1] * pos[v + 1] + pos[v + 2] * pos[v + 2]);
      l = l > 1e-9 ? radius / l : 0;
      out[v] = pos[v] * l; out[v + 1] = pos[v + 1] * l; out[v + 2] = pos[v + 2] * l;
    }
    return { positions: out, indices: new Uint32Array(idx) };
  };

  /* ---------------------------------------------------------------- *
   * grid-based builders
   * ---------------------------------------------------------------- */

  /**
   * Sweep a parametric surface over a (u,v) grid. `fn(u, v, out)` writes a
   * position for u,v in [0,1]. Seams are welded by the caller.
   *
   * The triangles come out wound so that **du × dv points outwards**. That is
   * a contract on the parameterisation, not on this function: sweep a sphere
   * with v running from the top down instead of the bottom up and every
   * triangle faces inwards, which — with back faces culled, as they are —
   * renders as the inside of the shape seen from within. That is exactly
   * what "the shapes are inverted" was. Each builder below therefore says
   * which way its u and v run.
   */
  function gridSurface(nu, nv, fn, closedU, closedV) {
    var pos = new Float32Array((nu + 1) * (nv + 1) * 3);
    var p = [0, 0, 0], w = 0;
    for (var j = 0; j <= nv; j++) {
      for (var i = 0; i <= nu; i++) {
        fn(i / nu, j / nv, p);
        pos[w++] = p[0]; pos[w++] = p[1]; pos[w++] = p[2];
      }
    }
    var idx = [];
    var stride = nu + 1;
    for (var jj = 0; jj < nv; jj++) {
      for (var ii = 0; ii < nu; ii++) {
        var a = jj * stride + ii, b = a + 1, c = a + stride, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    return { positions: pos, indices: new Uint32Array(idx) };
  }
  Prim.gridSurface = gridSurface;

  /** u goes round (x towards z), v goes up the poles. */
  Prim.uvsphere = function (segU, segV, radius) {
    radius = radius || 0.5;
    return gridSurface(segU || 48, segV || 24, function (u, v, out) {
      var phi = u * Math.PI * 2;
      // v = 0 is the south pole: sweeping downwards instead would wind every
      // triangle the other way round and turn the sphere inside out
      var theta = (1 - v) * Math.PI;
      var st = Math.sin(theta);
      out[0] = radius * st * Math.cos(phi);
      out[1] = radius * Math.cos(theta);
      out[2] = radius * st * Math.sin(phi);
    });
  };

  Prim.torus = function (segU, segV, ringRadius, tubeRadius) {
    ringRadius = ringRadius === undefined ? 0.35 : ringRadius;
    tubeRadius = tubeRadius === undefined ? 0.15 : tubeRadius;
    return gridSurface(segU || 64, segV || 32, function (u, v, out) {
      var a = u * Math.PI * 2, b = v * Math.PI * 2;
      var r = ringRadius + tubeRadius * Math.cos(b);
      out[0] = r * Math.cos(a);
      out[1] = tubeRadius * Math.sin(b);
      out[2] = r * Math.sin(a);
    });
  };

  Prim.plane = function (seg, size) {
    size = size || 1;
    return gridSurface(seg || 32, seg || 32, function (u, v, out) {
      out[0] = (u - 0.5) * size;
      out[1] = 0;
      out[2] = (v - 0.5) * size;
    });
  };

  /**
   * Box built from six subdivided faces. `round` in (0,1] pushes the surface
   * towards a sphere, which gives the rounded cube most sculpts start from.
   */
  Prim.box = function (seg, size, round) {
    seg = seg || 12;
    size = size || 1;
    round = round || 0;
    var h = size / 2;
    var pos = [], idx = [];
    var axes = [
      [0, 1, 2, 1], [0, 1, 2, -1],
      [1, 2, 0, 1], [1, 2, 0, -1],
      [2, 0, 1, 1], [2, 0, 1, -1]
    ];
    for (var f = 0; f < 6; f++) {
      var ax = axes[f], a = ax[0], b = ax[1], c = ax[2], sgn = ax[3];
      var base = pos.length / 3;
      for (var j = 0; j <= seg; j++) {
        for (var i = 0; i <= seg; i++) {
          var p = [0, 0, 0];
          p[a] = (i / seg - 0.5) * size;
          p[b] = (j / seg - 0.5) * size;
          p[c] = sgn * h;
          if (round > 0) {
            var l = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
            var s = (h * Math.SQRT2 * 0.72) / (l || 1);
            p[0] = p[0] * (1 - round) + p[0] * s * round;
            p[1] = p[1] * (1 - round) + p[1] * s * round;
            p[2] = p[2] * (1 - round) + p[2] * s * round;
          }
          pos.push(p[0], p[1], p[2]);
        }
      }
      var stride = seg + 1;
      for (var jj = 0; jj < seg; jj++) {
        for (var ii = 0; ii < seg; ii++) {
          var v0 = base + jj * stride + ii, v1 = v0 + 1, v2 = v0 + stride, v3 = v2 + 1;
          /*
           * Each of the three axis triples above is right-handed, so on the
           * positive side of an axis the outward normal is (along a) cross
           * (along b) — which is the winding (v0, v1, v2). It was the other
           * way round, and a box built inside out renders as the inside of a
           * room rather than as a cube.
           */
          if (sgn > 0) idx.push(v0, v1, v2, v1, v3, v2);
          else idx.push(v0, v2, v1, v1, v2, v3);
        }
      }
    }
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
  };

  /** Cylinder with capped ends; `topScale` 0 gives a cone. */
  Prim.cylinder = function (seg, rings, radius, height, topScale) {
    seg = seg || 32; rings = rings || 8;
    radius = radius === undefined ? 0.35 : radius;
    height = height === undefined ? 1 : height;
    topScale = topScale === undefined ? 1 : topScale;
    var pos = [], idx = [];
    var i, j;
    // side
    for (j = 0; j <= rings; j++) {
      var tv = j / rings;
      var r = radius * (1 - tv) + radius * topScale * tv;
      var y = -height / 2 + tv * height;
      for (i = 0; i <= seg; i++) {
        var a = i / seg * Math.PI * 2;
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      }
    }
    var stride = seg + 1;
    for (j = 0; j < rings; j++) {
      for (i = 0; i < seg; i++) {
        var v0 = j * stride + i, v1 = v0 + 1, v2 = v0 + stride, v3 = v2 + 1;
        idx.push(v0, v2, v1, v1, v2, v3);
      }
    }
    // caps as concentric rings so the triangles stay even
    function cap(y, rad, up) {
      if (rad <= 1e-6) {
        var apex = pos.length / 3;
        pos.push(0, y, 0);
        var ringStart = up ? rings * stride : 0;
        for (var k = 0; k < seg; k++) {
          // a fan seen from outside runs the other way at the top than at
          // the bottom; both were running the same way, which is why a cone
          // came out with its side facing out and its base facing in
          if (up) idx.push(apex, ringStart + k + 1, ringStart + k);
          else idx.push(apex, ringStart + k, ringStart + k + 1);
        }
        return;
      }
      var capRings = Math.max(2, Math.round(rings / 2));
      var base = pos.length / 3;
      for (var jr = 0; jr <= capRings; jr++) {
        var rr = rad * (1 - jr / capRings);
        for (var ii = 0; ii <= seg; ii++) {
          var aa = ii / seg * Math.PI * 2;
          pos.push(Math.cos(aa) * rr, y, Math.sin(aa) * rr);
        }
      }
      for (jr = 0; jr < capRings; jr++) {
        for (ii = 0; ii < seg; ii++) {
          var w0 = base + jr * stride + ii, w1 = w0 + 1, w2 = w0 + stride, w3 = w2 + 1;
          /*
           * The rings run inwards, so on the top cap the outward normal is
           * (round) cross (inward) reversed — the winding below. Both caps
           * had the winding of the other one, so the ends of a cylinder
           * faced into it.
           */
          if (up) idx.push(w0, w2, w1, w1, w2, w3);
          else idx.push(w0, w1, w2, w1, w3, w2);
        }
      }
    }
    cap(height / 2, radius * topScale, true);
    cap(-height / 2, radius, false);
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
  };

  Prim.cone = function (seg, rings, radius, height) {
    return Prim.cylinder(seg || 32, rings || 10, radius === undefined ? 0.4 : radius,
                         height === undefined ? 1 : height, 0);
  };

  /** Capsule — a cylinder with hemispherical ends, good for limbs. */
  Prim.capsule = function (seg, rings, radius, height) {
    seg = seg || 32; rings = rings || 16;
    radius = radius === undefined ? 0.25 : radius;
    height = height === undefined ? 0.5 : height;   // length of the straight part
    return gridSurface(seg, rings * 2, function (u, v, out) {
      var phi = u * Math.PI * 2;
      var t = v * 2 - 1;                    // -1..1 along the capsule
      var y, r;
      if (t < -0.5) {                       // bottom cap
        var k = (t + 1) / 0.5;              // 0..1
        var ang = (1 - k) * Math.PI / 2;
        r = radius * Math.cos(ang);
        y = -height / 2 - radius * Math.sin(ang);
      } else if (t > 0.5) {
        var k2 = (t - 0.5) / 0.5;
        var ang2 = k2 * Math.PI / 2;
        r = radius * Math.cos(ang2);
        y = height / 2 + radius * Math.sin(ang2);
      } else {
        r = radius;
        y = t * height;
      }
      out[0] = Math.cos(phi) * r;
      out[1] = y;
      out[2] = Math.sin(phi) * r;
    });
  };

  /**
   * The catalogue the UI shows. `build` returns raw arrays; `detail` is the
   * knob the primitive dialog exposes.
   */
  Prim.catalogue = [
    { id: 'sphere', label: 'Sphere', hint: 'Even triangles — the default ball',
      build: function (d) { return Prim.icosphere(Math.max(0, Math.min(7, d)), 0.5); }, detail: 4, detailMax: 7, detailLabel: 'Subdivisions' },
    { id: 'uvsphere', label: 'UV Sphere', hint: 'Poles and rings, like a globe',
      build: function (d) { return Prim.uvsphere(d * 8, d * 4, 0.5); }, detail: 6, detailMax: 16, detailLabel: 'Segments' },
    { id: 'box', label: 'Box', hint: 'Subdivided cube',
      build: function (d) { return Prim.box(d * 4, 1, 0); }, detail: 4, detailMax: 24, detailLabel: 'Segments' },
    { id: 'roundbox', label: 'Rounded Box', hint: 'Cube pushed towards a sphere',
      build: function (d) { return Prim.box(d * 4, 1, 0.55); }, detail: 5, detailMax: 24, detailLabel: 'Segments' },
    { id: 'cylinder', label: 'Cylinder', hint: 'Capped tube',
      build: function (d) { return Prim.cylinder(d * 4, d * 2, 0.35, 1, 1); }, detail: 8, detailMax: 24, detailLabel: 'Segments' },
    { id: 'cone', label: 'Cone', hint: 'Capped cone',
      build: function (d) { return Prim.cone(d * 4, d * 2, 0.4, 1); }, detail: 8, detailMax: 24, detailLabel: 'Segments' },
    { id: 'torus', label: 'Torus', hint: 'Ring',
      build: function (d) { return Prim.torus(d * 8, d * 4, 0.35, 0.15); }, detail: 8, detailMax: 24, detailLabel: 'Segments' },
    { id: 'capsule', label: 'Capsule', hint: 'Limb blank',
      build: function (d) { return Prim.capsule(d * 4, d * 2, 0.25, 0.5); }, detail: 8, detailMax: 24, detailLabel: 'Segments' },
    { id: 'plane', label: 'Plane', hint: 'Flat grid, no thickness', open: true,
      build: function (d) { return Prim.plane(d * 4, 1); }, detail: 8, detailMax: 32, detailLabel: 'Segments' }
  ];

  Prim.byId = function (id) {
    for (var i = 0; i < Prim.catalogue.length; i++) if (Prim.catalogue[i].id === id) return Prim.catalogue[i];
    return Prim.catalogue[0];
  };

  /** Build a primitive straight into a fresh Mesh. */
  Prim.makeMesh = function (id, detail) {
    var entry = Prim.byId(id);
    var data = entry.build(detail === undefined ? entry.detail : detail);
    var m = new S.Mesh();
    m.setFromArrays(data.positions, data.indices, { weld: true });
    return m;
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
