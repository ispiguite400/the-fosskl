/*
 * SculptFree — the transform gizmo.
 *
 * Select a shape and move, turn or resize it: three arrows, three rings and
 * three size handles, drawn at a constant size on screen and dragged with a
 * finger. Everything in here is geometry — where the handles are, which one
 * a tap lands on, and what a drag does to a transform — so it runs and is
 * tested without a browser. The app draws the result as an SVG overlay.
 *
 * Two decisions worth knowing:
 *
 *   The handles follow the object's own axes, not the world's. That is what
 *   makes resizing predictable: scale is stored per local axis, so a handle
 *   that pointed somewhere else would not correspond to anything.
 *
 *   Turning and resizing happen about the middle of the shape, not about its
 *   origin. The origin is usually somewhere arbitrary (wherever the shape was
 *   built), and rotating a shape around a point outside itself is not what
 *   anyone means by "turn it". The transform's position is corrected after
 *   every change so the middle of the shape stays where it was.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var V3 = S.V3, Q4 = S.Q4;
  var G = S.Gizmo = {};

  G.MODES = [
    { id: 'move', label: 'Move', icon: 'move', hint: 'Drag an arrow to slide it along one axis, or the middle to slide it freely' },
    { id: 'rotate', label: 'Turn', icon: 'rotate', hint: 'Drag a ring to turn it around that axis' },
    { id: 'scale', label: 'Size', icon: 'scale', hint: 'Drag a square to stretch one axis, or the middle to resize evenly' }
  ];

  /* x, y, z — the same three colours everything uses */
  G.AXIS_COLOR = ['#ff6b6b', '#5ed39a', '#5aa9ff'];
  G.AXIS_NAME = ['X', 'Y', 'Z'];

  var ARM_PIXELS = 86;                  // how long the arms look, in pixels
  var RING_SEGMENTS = 48;

  function basis(i) {
    return i === 0 ? [1, 0, 0] : (i === 1 ? [0, 1, 0] : [0, 0, 1]);
  }

  /** The centre of the object's own geometry, in its local space. */
  G.localCentre = function (obj, out) {
    var mn = obj.mesh.boundsMin(), mx = obj.mesh.boundsMax();
    return V3.set(out || V3.create(0, 0, 0),
      (mn[0] + mx[0]) * 0.5, (mn[1] + mx[1]) * 0.5, (mn[2] + mx[2]) * 0.5);
  };

  /** That same centre in world space — where the gizmo sits. */
  G.pivot = function (obj, out) {
    var c = G.localCentre(obj, V3.create(0, 0, 0));
    return V3.transformMat4(out || V3.create(0, 0, 0), c, obj.matrix());
  };

  /** One of the object's axes, in world space, normalised. */
  G.axis = function (obj, i, out) {
    out = out || V3.create(0, 0, 0);
    Q4.rotateVec3(out, obj.rotation, basis(i));
    return V3.normalize(out, out);
  };

  /* ---------------------------------------------------------------- *
   * where the handles are
   * ---------------------------------------------------------------- */

  /**
   * Handle positions for one mode, in world and screen space.
   *
   * Rings come back as projected polylines: a circle in 3D is an ellipse on
   * screen, and testing the distance to the line it actually draws is both
   * simpler and more accurate than fitting a shape to it.
   */
  G.layout = function (obj, camera, mode) {
    mode = mode || 'move';
    var pivot = G.pivot(obj);
    var pivotScreen = camera.project(pivot, [0, 0, 0]);
    var arm = camera.worldPerPixel(pivot) * ARM_PIXELS;
    var axes = [G.axis(obj, 0), G.axis(obj, 1), G.axis(obj, 2)];
    var handles = [];
    var tmp = V3.create(0, 0, 0);
    var scr = [0, 0, 0];
    var i, k;

    function projectPoint(world) {
      camera.project(world, scr);
      return [scr[0], scr[1], scr[2]];
    }

    if (mode === 'move' || mode === 'scale') {
      for (i = 0; i < 3; i++) {
        V3.set(tmp, pivot[0] + axes[i][0] * arm, pivot[1] + axes[i][1] * arm, pivot[2] + axes[i][2] * arm);
        var tip = projectPoint(tmp);
        handles.push({
          id: mode + '-' + i,
          kind: mode === 'move' ? 'axis' : 'point',
          axis: i,
          colour: G.AXIS_COLOR[i],
          name: G.AXIS_NAME[i],
          from: [pivotScreen[0], pivotScreen[1]],
          to: [tip[0], tip[1]],
          at: [tip[0], tip[1]],
          depth: tip[2],
          world: V3.create(tmp[0], tmp[1], tmp[2])
        });
      }
      handles.push({
        id: mode === 'move' ? 'move-free' : 'scale-all',
        kind: 'disc',
        colour: '#e8edf4',
        at: [pivotScreen[0], pivotScreen[1]],
        radius: 22
      });
    } else {
      for (i = 0; i < 3; i++) {
        // a circle in the plane the axis is normal to
        var u = V3.create(0, 0, 0), v = V3.create(0, 0, 0);
        V3.perpendicular(u, axes[i]);
        V3.cross(v, axes[i], u);
        V3.normalize(v, v);
        var points = [];
        for (k = 0; k <= RING_SEGMENTS; k++) {
          var a = (k / RING_SEGMENTS) * Math.PI * 2;
          var ca = Math.cos(a) * arm, sa = Math.sin(a) * arm;
          V3.set(tmp, pivot[0] + u[0] * ca + v[0] * sa,
                      pivot[1] + u[1] * ca + v[1] * sa,
                      pivot[2] + u[2] * ca + v[2] * sa);
          var p = projectPoint(tmp);
          points.push([p[0], p[1]]);
        }
        /*
         * A ring seen edge-on projects to a line through the middle of the
         * gizmo. Dragging it is impossible (the pointer ray runs parallel to
         * the plane it turns in) and it sits right where the other handles
         * are, so it is drawn faintly and taken out of the hit test until
         * the view turns far enough to use it.
         */
        var bx = [Infinity, -Infinity], by = [Infinity, -Infinity];
        for (k = 0; k < points.length; k++) {
          if (points[k][0] < bx[0]) bx[0] = points[k][0];
          if (points[k][0] > bx[1]) bx[1] = points[k][0];
          if (points[k][1] < by[0]) by[0] = points[k][1];
          if (points[k][1] > by[1]) by[1] = points[k][1];
        }
        var w = bx[1] - bx[0], hgt = by[1] - by[0];
        var aspect = Math.max(w, hgt) > 1e-6 ? Math.min(w, hgt) / Math.max(w, hgt) : 0;
        handles.push({
          id: 'rotate-' + i,
          kind: 'ring',
          axis: i,
          colour: G.AXIS_COLOR[i],
          name: G.AXIS_NAME[i],
          points: points,
          flat: aspect < 0.12
        });
      }
    }

    return {
      mode: mode,
      pivot: pivot,
      pivotScreen: [pivotScreen[0], pivotScreen[1]],
      behindCamera: pivotScreen[2] <= 0,
      arm: arm,
      axes: axes,
      handles: handles
    };
  };

  /* ---------------------------------------------------------------- *
   * hit testing
   * ---------------------------------------------------------------- */

  function distToSegment(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var lenSq = dx * dx + dy * dy;
    var t = lenSq > 1e-9 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var cx = ax + dx * t, cy = ay + dy * t;
    return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
  }
  G.distToSegment = distToSegment;

  function distToPolyline(px, py, pts) {
    var best = Infinity;
    for (var i = 1; i < pts.length; i++) {
      var d = distToSegment(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      if (d < best) best = d;
    }
    return best;
  }
  G.distToPolyline = distToPolyline;

  /**
   * Which handle a tap lands on, or null.
   *
   * Discs and squares win over lines and rings, because they sit on top of
   * them; `tolerance` is generous by default, since this has to work with a
   * finger rather than a mouse.
   */
  G.pick = function (layout, x, y, tolerance) {
    var tol = tolerance === undefined ? 18 : tolerance;
    var i, h, best = null, bestDist = Infinity;

    // the handles drawn on top, tested first
    for (i = 0; i < layout.handles.length; i++) {
      h = layout.handles[i];
      if (h.kind === 'disc') {
        var dx = x - h.at[0], dy = y - h.at[1];
        if (Math.sqrt(dx * dx + dy * dy) <= h.radius) return h;
      } else if (h.kind === 'point') {
        var ex = x - h.at[0], ey = y - h.at[1];
        var d = Math.sqrt(ex * ex + ey * ey);
        if (d <= tol && d < bestDist) { best = h; bestDist = d; }
      }
    }
    if (best) return best;

    for (i = 0; i < layout.handles.length; i++) {
      h = layout.handles[i];
      if (h.kind === 'axis') {
        var da = distToSegment(x, y, h.from[0], h.from[1], h.to[0], h.to[1]);
        if (da <= tol && da < bestDist) { best = h; bestDist = da; }
      } else if (h.kind === 'ring') {
        if (h.flat) continue;               // edge-on: nothing useful to drag
        var dr = distToPolyline(x, y, h.points);
        if (dr <= tol && dr < bestDist) { best = h; bestDist = dr; }
      }
    }
    return best;
  };

  /* ---------------------------------------------------------------- *
   * dragging
   * ---------------------------------------------------------------- */

  /** Where a pointer ray meets a plane, or null if it runs parallel to it. */
  function rayPlane(camera, sx, sy, planePoint, planeNormal, out) {
    var o = V3.create(0, 0, 0), d = V3.create(0, 0, 0);
    camera.rayFromScreen(sx, sy, o, d);
    var denom = V3.dot(d, planeNormal);
    if (Math.abs(denom) < 1e-7) return null;
    var t = ((planePoint[0] - o[0]) * planeNormal[0] +
             (planePoint[1] - o[1]) * planeNormal[1] +
             (planePoint[2] - o[2]) * planeNormal[2]) / denom;
    if (!isFinite(t)) return null;
    V3.set(out, o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t);
    return out;
  }
  G.rayPlane = rayPlane;

  /**
   * How far along an axis line the pointer is, measured from `origin`.
   * Null when the axis points nearly straight at the camera, where the
   * answer would be meaningless and the shape would shoot off.
   */
  function axisParam(camera, origin, axis, sx, sy) {
    var o = V3.create(0, 0, 0), d = V3.create(0, 0, 0);
    camera.rayFromScreen(sx, sy, o, d);
    var b = V3.dot(axis, d);
    var denom = 1 - b * b;
    if (Math.abs(denom) < 1e-4) return null;   // axis and ray are parallel
    var w0 = V3.create(origin[0] - o[0], origin[1] - o[1], origin[2] - o[2]);
    var dd = V3.dot(axis, w0), e = V3.dot(d, w0);
    return (b * e - dd) / denom;
  }
  G.axisParam = axisParam;

  function conjugate(out, q) {
    out[0] = -q[0]; out[1] = -q[1]; out[2] = -q[2]; out[3] = q[3];
    return out;
  }

  /** Put the transform back so the shape's middle sits on `pivot` again. */
  function keepPivot(obj, pivot, centreLocal) {
    var scaled = V3.create(centreLocal[0] * obj.scale[0],
                           centreLocal[1] * obj.scale[1],
                           centreLocal[2] * obj.scale[2]);
    var rotated = Q4.rotateVec3(V3.create(0, 0, 0), obj.rotation, scaled);
    V3.set(obj.position, pivot[0] - rotated[0], pivot[1] - rotated[1], pivot[2] - rotated[2]);
  }
  G.keepPivot = keepPivot;

  /**
   * Start a drag. Returns the state to hand to `drag`, or null when the
   * handle cannot be dragged from this angle.
   */
  G.beginDrag = function (obj, camera, handle, x, y) {
    var pivot = G.pivot(obj);
    var state = {
      obj: obj, camera: camera, handle: handle,
      pivot: pivot,
      centreLocal: G.localCentre(obj, V3.create(0, 0, 0)),
      start: {
        position: V3.create(obj.position[0], obj.position[1], obj.position[2]),
        rotation: new Float32Array(obj.rotation),
        scale: V3.create(obj.scale[0], obj.scale[1], obj.scale[2])
      },
      moved: false
    };

    if (handle.kind === 'axis' || handle.kind === 'point') {
      var axis = G.axis(obj, handle.axis);
      state.axis = axis;
      var t = axisParam(camera, pivot, axis, x, y);
      if (t === null) return null;
      state.t0 = t;
      if (handle.kind === 'point') {
        // resizing needs a reference length; too near the middle and the
        // ratio explodes
        var armGuess = camera.worldPerPixel(pivot) * ARM_PIXELS;
        if (Math.abs(t) < armGuess * 0.15) state.t0 = t < 0 ? -armGuess * 0.15 : armGuess * 0.15;
      }
    } else if (handle.kind === 'disc') {
      if (handle.id === 'move-free') {
        state.planeNormal = V3.create(0, 0, 0);
        V3.normalize(state.planeNormal, V3.sub(state.planeNormal, camera.eye, pivot));
        var hit = rayPlane(camera, x, y, pivot, state.planeNormal, V3.create(0, 0, 0));
        if (!hit) return null;
        state.hit0 = hit;
      } else {
        var sp = camera.project(pivot, [0, 0, 0]);
        var d0 = Math.sqrt((x - sp[0]) * (x - sp[0]) + (y - sp[1]) * (y - sp[1]));
        state.screenPivot = [sp[0], sp[1]];
        state.dist0 = Math.max(d0, 12);
      }
    } else if (handle.kind === 'ring') {
      var raxis = G.axis(obj, handle.axis);
      state.axis = raxis;
      var u = V3.create(0, 0, 0), v = V3.create(0, 0, 0);
      V3.perpendicular(u, raxis);
      V3.cross(v, raxis, u);
      V3.normalize(v, v);
      state.u = u; state.v = v;
      var rhit = rayPlane(camera, x, y, pivot, raxis, V3.create(0, 0, 0));
      if (!rhit) return null;
      var rel = V3.sub(V3.create(0, 0, 0), rhit, pivot);
      state.angle0 = Math.atan2(V3.dot(rel, v), V3.dot(rel, u));
    }
    return state;
  };

  /**
   * Continue a drag. Writes straight to the object's transform and returns
   * true when something changed.
   *
   * opts: { snap } — snap turning to 15° steps and sizes to 5% steps.
   */
  G.drag = function (state, x, y, opts) {
    if (!state) return false;
    opts = opts || {};
    var obj = state.obj, camera = state.camera, handle = state.handle;
    var i;

    if (handle.kind === 'axis') {
      var t = axisParam(camera, state.pivot, state.axis, x, y);
      if (t === null) return false;
      var d = t - state.t0;
      if (opts.snap) {
        var step = state.pivot ? camera.worldPerPixel(state.pivot) * 20 : 0.1;
        d = Math.round(d / step) * step;
      }
      V3.set(obj.position,
        state.start.position[0] + state.axis[0] * d,
        state.start.position[1] + state.axis[1] * d,
        state.start.position[2] + state.axis[2] * d);
      obj.touch();
      state.moved = true;
      return true;
    }

    if (handle.kind === 'disc' && handle.id === 'move-free') {
      var hit = rayPlane(camera, x, y, state.pivot, state.planeNormal, V3.create(0, 0, 0));
      if (!hit) return false;
      V3.set(obj.position,
        state.start.position[0] + (hit[0] - state.hit0[0]),
        state.start.position[1] + (hit[1] - state.hit0[1]),
        state.start.position[2] + (hit[2] - state.hit0[2]));
      obj.touch();
      state.moved = true;
      return true;
    }

    if (handle.kind === 'ring') {
      var rhit = rayPlane(camera, x, y, state.pivot, state.axis, V3.create(0, 0, 0));
      if (!rhit) return false;
      var rel = V3.sub(V3.create(0, 0, 0), rhit, state.pivot);
      var angle = Math.atan2(V3.dot(rel, state.v), V3.dot(rel, state.u)) - state.angle0;
      if (opts.snap) {
        var snapTo = Math.PI / 12;                 // 15 degrees
        angle = Math.round(angle / snapTo) * snapTo;
      }
      var q = Q4.setAxisAngle(Q4.create(), state.axis, angle);
      Q4.normalize(obj.rotation, Q4.multiply(obj.rotation, q, state.start.rotation));
      keepPivot(obj, state.pivot, state.centreLocal);
      obj.touch();
      state.moved = true;
      return true;
    }

    if (handle.kind === 'point') {
      var tp = axisParam(camera, state.pivot, state.axis, x, y);
      if (tp === null) return false;
      var f = tp / state.t0;
      if (!isFinite(f)) return false;
      if (opts.snap) f = Math.round(f * 20) / 20;
      f = S.clamp(f, 0.02, 50);
      obj.scale[handle.axis] = state.start.scale[handle.axis] * f;
      keepPivot(obj, state.pivot, state.centreLocal);
      obj.touch();
      state.moved = true;
      return true;
    }

    if (handle.kind === 'disc' && handle.id === 'scale-all') {
      var dx = x - state.screenPivot[0], dy = y - state.screenPivot[1];
      var fu = Math.sqrt(dx * dx + dy * dy) / state.dist0;
      if (opts.snap) fu = Math.round(fu * 20) / 20;
      fu = S.clamp(fu, 0.02, 50);
      for (i = 0; i < 3; i++) obj.scale[i] = state.start.scale[i] * fu;
      keepPivot(obj, state.pivot, state.centreLocal);
      obj.touch();
      state.moved = true;
      return true;
    }

    return false;
  };

  /** Put a transform back the way it was — for undo, and for Reset. */
  G.applyTransform = function (obj, t) {
    V3.set(obj.position, t.position[0], t.position[1], t.position[2]);
    obj.rotation.set(t.rotation);
    V3.set(obj.scale, t.scale[0], t.scale[1], t.scale[2]);
    obj.touch();
  };

  G.captureTransform = function (obj) {
    return {
      position: [obj.position[0], obj.position[1], obj.position[2]],
      rotation: [obj.rotation[0], obj.rotation[1], obj.rotation[2], obj.rotation[3]],
      scale: [obj.scale[0], obj.scale[1], obj.scale[2]]
    };
  };

  /** A short readout: where it is, how it is turned, how big it is. */
  G.describe = function (obj) {
    var e = Q4.toEuler([0, 0, 0], obj.rotation);
    function n(v) { return (Math.abs(v) < 0.0005 ? 0 : v).toFixed(2); }
    function deg(v) { return Math.round(v * 180 / Math.PI) + '°'; }
    return {
      position: n(obj.position[0]) + ', ' + n(obj.position[1]) + ', ' + n(obj.position[2]),
      rotation: deg(e[0]) + ', ' + deg(e[1]) + ', ' + deg(e[2]),
      scale: n(obj.scale[0]) + ', ' + n(obj.scale[1]) + ', ' + n(obj.scale[2]),
      uniform: Math.abs(obj.scale[0] - obj.scale[1]) < 1e-6 && Math.abs(obj.scale[1] - obj.scale[2]) < 1e-6
    };
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
