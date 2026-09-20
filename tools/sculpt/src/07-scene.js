/*
 * SculptFree — scene objects, the scene itself, and undo history.
 *
 * Each object owns a Mesh plus a transform. Sculpting happens in the
 * object's local space: the brush position and direction are pulled into
 * local space once per stroke step, which keeps symmetry planes and dyntopo
 * detail sizes meaningful no matter how the object is placed.
 *
 * History is memory-budgeted rather than step-counted. A plain sculpt stroke
 * records only the vertices it touched; anything that changes topology stores
 * a full snapshot, because vertex indices move around. Oldest entries are
 * dropped when the budget is exceeded.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var V3 = S.V3, M4 = S.M4, Q4 = S.Q4;

  /* ================================================================ *
   * scene object
   * ================================================================ */

  var nextId = 1;

  function SceneObject(name, mesh) {
    this.id = nextId++;
    this.name = name || ('Object ' + this.id);
    this.mesh = mesh || new S.Mesh();
    this.position = V3.create(0, 0, 0);
    this.rotation = Q4.create();
    this.scale = V3.create(1, 1, 1);
    this.visible = true;
    this.baseColor = V3.create(0.85, 0.85, 0.85);
    this._matrix = M4.create();
    this._inverse = M4.create();
    this._normal = M4.create();
    this._dirty = true;
    this.renderState = null;      // owned by the renderer
  }
  S.SceneObject = SceneObject;

  SceneObject.prototype.touch = function () { this._dirty = true; };

  SceneObject.prototype.matrix = function () {
    if (this._dirty) {
      M4.compose(this._matrix, this.position, this.rotation, this.scale);
      M4.invert(this._inverse, this._matrix);
      M4.normalMatrix(this._normal, this._matrix);
      this._dirty = false;
    }
    return this._matrix;
  };

  SceneObject.prototype.inverseMatrix = function () { this.matrix(); return this._inverse; };
  SceneObject.prototype.normalMatrix = function () { this.matrix(); return this._normal; };

  /** Uniform scale factor, used to convert brush radii into local units. */
  SceneObject.prototype.uniformScale = function () {
    return (Math.abs(this.scale[0]) + Math.abs(this.scale[1]) + Math.abs(this.scale[2])) / 3 || 1e-6;
  };

  SceneObject.prototype.worldToLocalPoint = function (out, p) {
    return V3.transformMat4(out, p, this.inverseMatrix());
  };

  SceneObject.prototype.worldToLocalDir = function (out, d) {
    V3.transformDir(out, d, this.inverseMatrix());
    return V3.normalize(out, out);
  };

  SceneObject.prototype.localToWorldPoint = function (out, p) {
    return V3.transformMat4(out, p, this.matrix());
  };

  /** World-space bounding sphere, for framing the camera. */
  SceneObject.prototype.worldBounds = function (outMin, outMax) {
    var mn = this.mesh.boundsMin(), mx = this.mesh.boundsMax();
    var m = this.matrix();
    var p = V3.create(0, 0, 0), o = V3.create(0, 0, 0);
    var first = true;
    for (var i = 0; i < 8; i++) {
      V3.set(p, (i & 1) ? mx[0] : mn[0], (i & 2) ? mx[1] : mn[1], (i & 4) ? mx[2] : mn[2]);
      V3.transformMat4(o, p, m);
      if (first) { V3.copy(outMin, o); V3.copy(outMax, o); first = false; }
      else {
        for (var k = 0; k < 3; k++) {
          if (o[k] < outMin[k]) outMin[k] = o[k];
          if (o[k] > outMax[k]) outMax[k] = o[k];
        }
      }
    }
  };

  SceneObject.prototype.stats = function () {
    return { verts: this.mesh.liveVerts, tris: this.mesh.liveTris };
  };

  /** Bake the transform into the vertices and reset it to identity. */
  SceneObject.prototype.applyTransform = function () {
    this.mesh.applyMatrix(this.matrix());
    V3.set(this.position, 0, 0, 0);
    Q4.identity(this.rotation);
    V3.set(this.scale, 1, 1, 1);
    this.touch();
  };

  SceneObject.prototype.cloneObject = function () {
    var o = new SceneObject(this.name + ' copy', this.mesh.clone());
    V3.copy(o.position, this.position);
    o.rotation.set(this.rotation);
    V3.copy(o.scale, this.scale);
    V3.copy(o.baseColor, this.baseColor);
    o.visible = this.visible;
    return o;
  };

  /* ================================================================ *
   * scene
   * ================================================================ */

  function Scene() {
    this.objects = [];
    this.selected = 0;
    this._hit = { t: 0, tri: -1, x: 0, y: 0, z: 0 };
    this._lp = V3.create(0, 0, 0);
    this._ld = V3.create(0, 0, 0);
  }
  S.Scene = Scene;

  Scene.prototype.add = function (obj, select) {
    this.objects.push(obj);
    if (select !== false) this.selected = this.objects.length - 1;
    return obj;
  };

  Scene.prototype.current = function () {
    return this.objects[this.selected] || null;
  };

  Scene.prototype.remove = function (index) {
    if (index < 0 || index >= this.objects.length) return null;
    var removed = this.objects.splice(index, 1)[0];
    if (this.selected >= this.objects.length) this.selected = this.objects.length - 1;
    if (this.selected < 0) this.selected = 0;
    return removed;
  };

  Scene.prototype.clear = function () {
    this.objects.length = 0;
    this.selected = 0;
  };

  /**
   * Closest hit across visible objects. Returns null or
   * {object, index, point(world), normal(world), localPoint, tri, distance}.
   */
  Scene.prototype.raycast = function (origin, dir, onlySelected) {
    var best = null;
    var lp = this._lp, ld = this._ld;
    for (var i = 0; i < this.objects.length; i++) {
      var obj = this.objects[i];
      if (!obj.visible || !obj.mesh.liveTris) continue;
      if (onlySelected && i !== this.selected) continue;
      obj.worldToLocalPoint(lp, origin);
      obj.worldToLocalDir(ld, dir);
      var hit = this._hit;
      if (!obj.mesh.raycast(lp[0], lp[1], lp[2], ld[0], ld[1], ld[2], hit, false)) continue;
      // local t is not world t when the object is scaled, so compare in world
      var localPoint = V3.create(hit.x, hit.y, hit.z);
      var worldPoint = V3.create(0, 0, 0);
      obj.localToWorldPoint(worldPoint, localPoint);
      var dist = V3.dist(worldPoint, origin);
      if (best && dist >= best.distance) continue;
      var ln = V3.create(0, 0, 0);
      obj.mesh.triNormal(hit.tri, ln);
      var wn = V3.create(0, 0, 0);
      V3.transformDir(wn, ln, obj.normalMatrix());
      V3.normalize(wn, wn);
      best = { object: obj, index: i, point: worldPoint, normal: wn,
               localPoint: localPoint, localNormal: ln, tri: hit.tri, distance: dist };
    }
    return best;
  };

  Scene.prototype.bounds = function (outMin, outMax) {
    var any = false;
    var mn = V3.create(0, 0, 0), mx = V3.create(0, 0, 0);
    for (var i = 0; i < this.objects.length; i++) {
      var obj = this.objects[i];
      if (!obj.visible || !obj.mesh.liveVerts) continue;
      obj.worldBounds(mn, mx);
      if (!any) { V3.copy(outMin, mn); V3.copy(outMax, mx); any = true; }
      else {
        for (var k = 0; k < 3; k++) {
          if (mn[k] < outMin[k]) outMin[k] = mn[k];
          if (mx[k] > outMax[k]) outMax[k] = mx[k];
        }
      }
    }
    if (!any) { V3.set(outMin, -0.5, -0.5, -0.5); V3.set(outMax, 0.5, 0.5, 0.5); }
    return any;
  };

  Scene.prototype.totals = function () {
    var v = 0, t = 0;
    for (var i = 0; i < this.objects.length; i++) {
      v += this.objects[i].mesh.liveVerts;
      t += this.objects[i].mesh.liveTris;
    }
    return { verts: v, tris: t, objects: this.objects.length };
  };

  /** Merge several objects into one mesh, baking their transforms. */
  Scene.prototype.mergeObjects = function (indices, name) {
    var geoms = [];
    var totalV = 0, totalI = 0, i;
    for (i = 0; i < indices.length; i++) {
      var obj = this.objects[indices[i]];
      if (!obj) continue;
      var d = obj.mesh.toIndexed();
      if (!d.vertCount) continue;
      var m = obj.matrix();
      var pos = new Float32Array(d.positions.length);
      for (var v = 0; v < d.vertCount; v++) {
        var o = v * 3;
        var x = d.positions[o], y = d.positions[o + 1], z = d.positions[o + 2];
        pos[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
        pos[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        pos[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      var det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
      var idx = d.indices32;
      if (det < 0) {
        var sw = new Uint32Array(idx.length);
        for (var t = 0; t < idx.length; t += 3) { sw[t] = idx[t]; sw[t + 1] = idx[t + 2]; sw[t + 2] = idx[t + 1]; }
        idx = sw;
      }
      geoms.push({ positions: pos, colors: d.colors, indices: idx, vertCount: d.vertCount });
      totalV += d.vertCount; totalI += idx.length;
    }
    if (!geoms.length) return null;
    var allPos = new Float32Array(totalV * 3);
    var allCol = new Float32Array(totalV * 3);
    var allIdx = new Uint32Array(totalI);
    var vo = 0, io = 0;
    for (i = 0; i < geoms.length; i++) {
      var g = geoms[i];
      allPos.set(g.positions, vo * 3);
      allCol.set(g.colors, vo * 3);
      for (var k = 0; k < g.indices.length; k++) allIdx[io + k] = g.indices[k] + vo;
      vo += g.vertCount; io += g.indices.length;
    }
    var mesh = new S.Mesh();
    mesh.setFromArrays(allPos, allIdx, { colors: allCol, weld: true });
    return new SceneObject(name || 'Merged', mesh);
  };

  /* ================================================================ *
   * history
   * ================================================================ */

  function History(budgetBytes) {
    this.undoStack = [];
    this.redoStack = [];
    this.budget = budgetBytes || 384 * 1024 * 1024;
    this.bytes = 0;
    this.pending = null;
    this.onChange = null;
  }
  S.History = History;

  History.prototype._entryBytes = function (e) {
    var n = 64;
    if (e.kind === 'verts') {
      n += e.indices.byteLength + e.before.byteLength + (e.after ? e.after.byteLength : 0);
      if (e.colorBefore) n += e.colorBefore.byteLength * 2;
      if (e.maskBefore) n += e.maskBefore.byteLength * 2;
    } else if (e.kind === 'mesh') {
      n += S.Mesh.prototype.snapshotBytes(e.before);
      if (e.after) n += S.Mesh.prototype.snapshotBytes(e.after);
    } else if (e.kind === 'scene') {
      n += e.bytes || 4096;
    }
    return n;
  };

  History.prototype._push = function (entry) {
    entry._bytes = this._entryBytes(entry);
    this.undoStack.push(entry);
    this.bytes += entry._bytes;
    this.clearRedo();
    this._evict();
    if (this.onChange) this.onChange(this);
  };

  History.prototype._evict = function () {
    while (this.undoStack.length > 2 && this.bytes > this.budget) {
      var dropped = this.undoStack.shift();
      this.bytes -= dropped._bytes;
    }
  };

  History.prototype.clearRedo = function () {
    for (var i = 0; i < this.redoStack.length; i++) this.bytes -= this.redoStack[i]._bytes;
    this.redoStack.length = 0;
  };

  History.prototype.clear = function () {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.bytes = 0;
    this.pending = null;
    if (this.onChange) this.onChange(this);
  };

  /* ---- vertex-level strokes ---------------------------------------- */

  /**
   * Begin recording a stroke on `obj`. Vertices are captured the first time
   * the brush touches them, which keeps a 100-step stroke as cheap as one.
   */
  History.prototype.beginStroke = function (obj, opts) {
    opts = opts || {};
    var mesh = obj.mesh;
    if (opts.topology) {
      this.pending = { kind: 'mesh', obj: obj, label: opts.label || 'Sculpt',
                       before: mesh.snapshot(), after: null };
      return;
    }
    this.pending = {
      kind: 'verts', obj: obj, label: opts.label || 'Sculpt',
      indices: [], before: [], after: null,
      colors: !!opts.colors, masks: !!opts.masks,
      colorBefore: opts.colors ? [] : null,
      maskBefore: opts.masks ? [] : null,
      seen: new Int32Array(mesh.masks.length + 1),
      stamp: 1
    };
  };

  /** Record the pre-edit state of a vertex. Cheap and idempotent. */
  History.prototype.captureVert = function (v) {
    var p = this.pending;
    if (!p || p.kind !== 'verts') return;
    if (v >= p.seen.length) {
      var grown = new Int32Array(v + 1024);
      grown.set(p.seen);
      p.seen = grown;
    }
    if (p.seen[v] === p.stamp) return;
    p.seen[v] = p.stamp;
    var mesh = p.obj.mesh, o = v * 3;
    p.indices.push(v);
    p.before.push(mesh.positions.array[o], mesh.positions.array[o + 1], mesh.positions.array[o + 2]);
    if (p.colorBefore) p.colorBefore.push(mesh.colors.array[o], mesh.colors.array[o + 1], mesh.colors.array[o + 2]);
    if (p.maskBefore) p.maskBefore.push(mesh.masks.array[v]);
  };

  History.prototype.captureVerts = function (list, count) {
    var n = count === undefined ? list.length : count;
    for (var i = 0; i < n; i++) this.captureVert(list[i]);
  };

  /** Close the stroke and commit it, or discard it if nothing changed. */
  History.prototype.endStroke = function () {
    var p = this.pending;
    this.pending = null;
    if (!p) return false;
    var mesh = p.obj.mesh;
    if (p.kind === 'mesh') {
      p.after = mesh.snapshot();
      if (p.after.positions.length === p.before.positions.length &&
          p.after.tris.length === p.before.tris.length) {
        var same = true;
        for (var i = 0; i < p.after.positions.length; i++) {
          if (p.after.positions[i] !== p.before.positions[i]) { same = false; break; }
        }
        if (same) {
          for (i = 0; i < p.after.tris.length; i++) {
            if (p.after.tris[i] !== p.before.tris[i]) { same = false; break; }
          }
        }
        if (same) return false;
      }
      this._push(p);
      return true;
    }
    if (!p.indices.length) return false;
    var indices = new Uint32Array(p.indices);
    var before = new Float32Array(p.before);
    var after = new Float32Array(indices.length * 3);
    for (var k = 0; k < indices.length; k++) {
      var o = indices[k] * 3, w = k * 3;
      after[w] = mesh.positions.array[o];
      after[w + 1] = mesh.positions.array[o + 1];
      after[w + 2] = mesh.positions.array[o + 2];
    }
    var entry = { kind: 'verts', obj: p.obj, label: p.label,
                  indices: indices, before: before, after: after };
    if (p.colorBefore) {
      entry.colorBefore = new Float32Array(p.colorBefore);
      entry.colorAfter = new Float32Array(indices.length * 3);
      for (k = 0; k < indices.length; k++) {
        var co = indices[k] * 3, cw = k * 3;
        entry.colorAfter[cw] = mesh.colors.array[co];
        entry.colorAfter[cw + 1] = mesh.colors.array[co + 1];
        entry.colorAfter[cw + 2] = mesh.colors.array[co + 2];
      }
    }
    if (p.maskBefore) {
      entry.maskBefore = new Float32Array(p.maskBefore);
      entry.maskAfter = new Float32Array(indices.length);
      for (k = 0; k < indices.length; k++) entry.maskAfter[k] = mesh.masks.array[indices[k]];
    }
    this._push(entry);
    return true;
  };

  /**
   * Throw away the stroke in progress AND put the geometry back the way it
   * was. Used when a second finger lands mid-stroke (that is navigation, not
   * a sculpt) and when Escape is pressed.
   */
  History.prototype.revertStroke = function () {
    var p = this.pending;
    this.pending = null;
    if (!p) return false;
    var mesh = p.obj.mesh;
    if (p.kind === 'mesh') {
      mesh.restore(p.before);
      return true;
    }
    var idx = p.indices;
    if (!idx.length) return false;
    var minV = Infinity, maxV = -1;
    for (var k = 0; k < idx.length; k++) {
      var v = idx[k], o = v * 3, w = k * 3;
      if (mesh.vertDead.array[v]) continue;
      mesh.positions.array[o] = p.before[w];
      mesh.positions.array[o + 1] = p.before[w + 1];
      mesh.positions.array[o + 2] = p.before[w + 2];
      if (p.colorBefore) {
        mesh.colors.array[o] = p.colorBefore[w];
        mesh.colors.array[o + 1] = p.colorBefore[w + 1];
        mesh.colors.array[o + 2] = p.colorBefore[w + 2];
      }
      if (p.maskBefore) mesh.masks.array[v] = p.maskBefore[k];
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    if (maxV >= 0) {
      mesh.computeNormals(idx, idx.length);
      mesh.gridUpdateVerts(idx, idx.length);
      mesh.dirtyMinVert = Math.min(mesh.dirtyMinVert, minV);
      mesh.dirtyMaxVert = Math.max(mesh.dirtyMaxVert, maxV);
      mesh._boundsDirty = true;
    }
    return true;
  };

  /** Drop the stroke record without touching the geometry. */
  History.prototype.cancelStroke = function () { this.pending = null; };

  /* ---- whole-mesh operations --------------------------------------- */

  /** Wrap a topology-changing command so it can be undone. */
  History.prototype.runMeshOp = function (obj, label, fn) {
    var before = obj.mesh.snapshot();
    var result = fn();
    if (result === false) return result;      // the command declined to run
    this._push({ kind: 'mesh', obj: obj, label: label, before: before, after: obj.mesh.snapshot() });
    return result;
  };

  /**
   * Wrap a command that changes the object list. `capture` returns an opaque
   * state blob; `restore` puts it back.
   */
  History.prototype.runSceneOp = function (label, capture, restore, fn) {
    var before = capture();
    var result = fn();
    if (result === false) return result;
    this._push({ kind: 'scene', label: label, before: before, after: capture(), restore: restore,
                 bytes: 8192 });
    return result;
  };

  /* ---- apply / revert ---------------------------------------------- */

  function applyVertEntry(entry, which) {
    var mesh = entry.obj.mesh;
    var pos = which === 'before' ? entry.before : entry.after;
    var col = which === 'before' ? entry.colorBefore : entry.colorAfter;
    var msk = which === 'before' ? entry.maskBefore : entry.maskAfter;
    var idx = entry.indices;
    var minV = Infinity, maxV = -1;
    for (var k = 0; k < idx.length; k++) {
      var v = idx[k], o = v * 3, w = k * 3;
      if (mesh.vertDead.array[v]) continue;
      mesh.positions.array[o] = pos[w];
      mesh.positions.array[o + 1] = pos[w + 1];
      mesh.positions.array[o + 2] = pos[w + 2];
      if (col) {
        mesh.colors.array[o] = col[w];
        mesh.colors.array[o + 1] = col[w + 1];
        mesh.colors.array[o + 2] = col[w + 2];
      }
      if (msk) mesh.masks.array[v] = msk[k];
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    if (maxV >= 0) {
      mesh.computeNormals(idx, idx.length);
      mesh.gridUpdateVerts(idx, idx.length);
      mesh.dirtyMinVert = Math.min(mesh.dirtyMinVert, minV);
      mesh.dirtyMaxVert = Math.max(mesh.dirtyMaxVert, maxV);
      mesh._boundsDirty = true;
    }
  }

  History.prototype.undo = function () {
    var entry = this.undoStack.pop();
    if (!entry) return null;
    if (entry.kind === 'verts') applyVertEntry(entry, 'before');
    else if (entry.kind === 'mesh') entry.obj.mesh.restore(entry.before);
    else if (entry.kind === 'scene') entry.restore(entry.before);
    this.redoStack.push(entry);
    if (this.onChange) this.onChange(this);
    return entry;
  };

  History.prototype.redo = function () {
    var entry = this.redoStack.pop();
    if (!entry) return null;
    if (entry.kind === 'verts') applyVertEntry(entry, 'after');
    else if (entry.kind === 'mesh') entry.obj.mesh.restore(entry.after);
    else if (entry.kind === 'scene') entry.restore(entry.after);
    this.undoStack.push(entry);
    if (this.onChange) this.onChange(this);
    return entry;
  };

  History.prototype.canUndo = function () { return this.undoStack.length > 0; };
  History.prototype.canRedo = function () { return this.redoStack.length > 0; };
  History.prototype.undoLabel = function () {
    var e = this.undoStack[this.undoStack.length - 1];
    return e ? e.label : null;
  };
  History.prototype.redoLabel = function () {
    var e = this.redoStack[this.redoStack.length - 1];
    return e ? e.label : null;
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
