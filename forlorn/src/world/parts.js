/*
 * Parts: build a map the way a Roblox place is built, from parts.
 *
 *   const P = new Parts();
 *   P.box({ x, y, z, w, h, d, ry, mat: 'brick', color: 0x8a4b3a })   // y is the BOTTOM of the part
 *   P.wedge({ ... })     a ramp: full height at -z (local), nothing at +z
 *   P.cyl({ x, y, z, r, h, seg, axis })   P.ball({ x, y, z, r })
 *   P.light({ x, y, z, color, intensity, distance })
 *   const group = P.build()
 *
 * Every part of one material is merged into one mesh (vertex colours carry the tint), so a
 * whole map is a few dozen draw calls. Colliders and sight-blockers are recorded as parts are
 * added: P.colliders.
 */
import * as THREE from 'three';
import { material, MATS } from '../render/materials.js';

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(1, 1, 1), tmpP = new THREE.Vector3();

export class Parts {
  constructor() { this.groups = new Map(); this.colliders = []; this.lights = []; this.extra = []; }

  _push(geo, mat, color, matrix, cast, recv) {
    const key = mat + (cast ? '' : ':nc');
    if (!this.groups.has(key)) this.groups.set(key, { mat, cast, recv: recv !== false, geos: [] });
    const c = new THREE.Color(color === undefined ? 0xffffff : color);
    const n = geo.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.applyMatrix4(matrix);
    this.groups.get(key).geos.push(geo);
  }
  _matrix(o, cy) {
    tmpE.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpP.set(o.x || 0, cy, o.z || 0);
    return tmpM.compose(tmpP, tmpQ, tmpS);
  }
  _collider(o, shape) {
    if (o.collide === false) return;
    const y0 = o.y || 0, y1 = y0 + (o.h || 0);
    const sight = o.sight !== undefined ? o.sight : (y0 < 1.3 && y1 > 1.5 && (o.h || 0) > 0.9);
    if (shape === 'box') this.colliders.push({ type: 'box', x: o.x || 0, z: o.z || 0, hw: o.w / 2, hd: o.d / 2, ry: o.ry || 0, y0, y1, sight, tag: o.tag });
    else this.colliders.push({ type: 'cyl', x: o.x || 0, z: o.z || 0, r: o.r, y0, y1, sight, tag: o.tag });
  }

  box(o) {
    const w = o.w, h = o.h, d = o.d, tile = o.tile || (MATS[o.mat || 'plastic'] || MATS.plastic).tile;
    const g = new THREE.BoxGeometry(w, h, d);
    // world-scaled UVs: faces px nx (d x h), py ny (w x d), pz nz (w x h)
    const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
    this._push(g, o.mat || 'plastic', o.color, this._matrix(o, (o.y || 0) + h / 2), o.cast !== false, o.recv);
    if (!o.rx && !o.rz) this._collider(o, 'box');
    return this;
  }
  wedge(o) {
    // a ramp/roof piece in local space: x in [-w/2, w/2], z in [-d/2, d/2], height h at -z falling to 0 at +z
    const w = o.w / 2, d = o.d / 2, h = o.h, tile = o.tile || (MATS[o.mat || 'plastic'] || MATS.plastic).tile;
    const P = [], N = [], U = [];
    const tri = (a, b, c, uvs) => { const ab = new THREE.Vector3().subVectors(b, a), ac = new THREE.Vector3().subVectors(c, a), n = ab.cross(ac).normalize(); for (const [p, t] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]]]) { P.push(p.x, p.y, p.z); N.push(n.x, n.y, n.z); U.push(t[0], t[1]); } };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const A = V(-w, 0, -d), Bv = V(w, 0, -d), Cc = V(w, 0, d), Dd = V(-w, 0, d), E = V(-w, h, -d), F = V(w, h, -d);
    const sl = Math.hypot(h, 2 * d) / tile, wt = 2 * w / tile, dt = 2 * d / tile, ht = h / tile;
    tri(A, E, F, [[0, 0], [0, ht], [wt, ht]]); tri(A, F, Bv, [[0, 0], [wt, ht], [wt, 0]]);         // back
    tri(E, Dd, Cc, [[0, sl], [0, 0], [wt, 0]]); tri(E, Cc, F, [[0, sl], [wt, 0], [wt, sl]]);       // slope
    tri(A, Bv, Cc, [[0, 0], [wt, 0], [wt, dt]]); tri(A, Cc, Dd, [[0, 0], [wt, dt], [0, dt]]);       // bottom
    tri(A, Dd, E, [[0, 0], [dt, 0], [0, ht]]); tri(Bv, F, Cc, [[0, 0], [0, ht], [dt, 0]]);          // sides
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    this._push(g, o.mat || 'plastic', o.color, this._matrix(o, o.y || 0), o.cast !== false, o.recv);
    if (o.collide) this._collider(Object.assign({}, o, { h: h * 0.5 }), 'box');
    return this;
  }
  cyl(o) {
    const seg = o.seg || 16, tile = o.tile || (MATS[o.mat || 'plastic'] || MATS.plastic).tile;
    const g = new THREE.CylinderGeometry(o.rt !== undefined ? o.rt : o.r, o.r, o.h, seg, 1, !!o.open);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * o.r / tile, uv.getY(i) * o.h / tile);
    let m;
    if (o.axis === 'x' || o.axis === 'z') {
      g.rotateZ(o.axis === 'x' ? Math.PI / 2 : 0); if (o.axis === 'z') g.rotateX(Math.PI / 2);
      m = this._matrix(o, (o.y || 0));
    } else m = this._matrix(o, (o.y || 0) + o.h / 2);
    this._push(g, o.mat || 'plastic', o.color, m, o.cast !== false, o.recv);
    if (!o.axis || o.axis === 'y') this._collider(o, 'cyl');
    return this;
  }
  ball(o) {
    const g = new THREE.SphereGeometry(o.r, o.seg || 14, Math.max(6, (o.seg || 14) >> 1));
    if (o.sy) g.scale(1, o.sy, 1);
    this._push(g, o.mat || 'plastic', o.color, this._matrix(o, o.y || 0), o.cast !== false, o.recv);
    if (o.collide) this._collider(Object.assign({}, o, { y: (o.y || 0) - o.r, h: o.r * 2 }), 'cyl');
    return this;
  }
  /** Any geometry (already in local space with y = 0 at its base), merged like a part. */
  geo(g, o) { this._push(g, o.mat || 'plastic', o.color, this._matrix(o, o.y || 0), o.cast !== false, o.recv); return this; }
  light(o) { this.lights.push(Object.assign({ color: 0xffd9a0, intensity: 6, distance: 14, decay: 1.6, flicker: 0 }, o)); return this; }
  /** A collider with no mesh (an invisible wall, the map's edge). */
  wall(o) { this._collider(Object.assign({ collide: true }, o), o.r ? 'cyl' : 'box'); return this; }

  build() {
    const root = new THREE.Group();
    for (const [, gr] of this.groups) {
      const geo = mergeGeometries(gr.geos);
      const mesh = new THREE.Mesh(geo, material(gr.mat));
      mesh.castShadow = gr.cast; mesh.receiveShadow = gr.recv;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      root.add(mesh);
    }
    for (const e of this.extra) root.add(e);
    return root;
  }
}

/** Merge geometries with position/normal/uv/color into one indexed geometry. */
export function mergeGeometries(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.attributes.color) col.set(g.attributes.color.array, vo * 3);
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io + i] = a[i] + vo; io += a.length; }
    else { for (let i = 0; i < n; i++) idx[io + i] = vo + i; io += n; }
    vo += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
