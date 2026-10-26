/*
 * Navigation for the bots: a walkability grid built from the map's colliders,
 * A* over it, and string-pulled paths.
 *
 *   nav.path(ax, az, bx, bz)     -> [[x, z], ...] or null
 *   nav.walkable(x, z)           nav.nearestWalkable(x, z)
 *   nav.randomPoint(r)           a random walkable point (reachable from the spawn region)
 */
const CELL = 0.5;

export class NavGrid {
  constructor(bounds, colliders, radius = 0.42) {
    this.minX = bounds.minX; this.minZ = bounds.minZ;
    this.nx = Math.ceil((bounds.maxX - bounds.minX) / CELL); this.nz = Math.ceil((bounds.maxZ - bounds.minZ) / CELL);
    this.block = new Uint8Array(this.nx * this.nz);
    this.radius = radius;
    for (const c of colliders) this.stamp(c, 1);
    // the outer ring is never walkable
    for (let i = 0; i < this.nx; i++) { this.block[i] = 1; this.block[(this.nz - 1) * this.nx + i] = 1; }
    for (let j = 0; j < this.nz; j++) { this.block[j * this.nx] = 1; this.block[j * this.nx + this.nx - 1] = 1; }
    this.region = null;
  }
  cx(x) { return Math.floor((x - this.minX) / CELL); }
  cz(z) { return Math.floor((z - this.minZ) / CELL); }
  wx(i) { return this.minX + (i + 0.5) * CELL; }
  wz(j) { return this.minZ + (j + 0.5) * CELL; }
  /** Mark (v = 1) or clear (v = 0) the cells a collider covers. */
  stamp(c, v) {
    if (c.y1 <= 0.35 || c.y0 >= 1.7) return;
    const r = this.radius;
    const ext = c.type === 'box' ? Math.hypot(c.hw, c.hd) + r : c.r + r;
    const cos = Math.cos(c.ry || 0), sin = Math.sin(c.ry || 0);
    for (let j = Math.max(0, this.cz(c.z - ext)); j <= Math.min(this.nz - 1, this.cz(c.z + ext)); j++)
      for (let i = Math.max(0, this.cx(c.x - ext)); i <= Math.min(this.nx - 1, this.cx(c.x + ext)); i++) {
        const dx = this.wx(i) - c.x, dz = this.wz(j) - c.z;
        let inside;
        if (c.type === 'box') {
          const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
          const qx = Math.max(0, Math.abs(lx) - c.hw), qz = Math.max(0, Math.abs(lz) - c.hd);
          inside = qx * qx + qz * qz < r * r;
        } else inside = dx * dx + dz * dz < (c.r + r) * (c.r + r);
        if (inside) this.block[j * this.nx + i] = v ? Math.min(255, this.block[j * this.nx + i] + 1) : Math.max(0, this.block[j * this.nx + i] - 1);
      }
  }
  free(i, j) { return i >= 0 && j >= 0 && i < this.nx && j < this.nz && this.block[j * this.nx + i] === 0; }
  walkable(x, z) { return this.free(this.cx(x), this.cz(z)); }
  nearestWalkable(x, z, maxR = 8) {
    const ci = this.cx(x), cj = this.cz(z);
    if (this.free(ci, cj)) return [x, z];
    for (let r = 1; r <= maxR / CELL; r++)
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        if (this.free(ci + di, cj + dj)) return [this.wx(ci + di), this.wz(cj + dj)];
      }
    return [x, z];
  }
  /** Flood the walkable area connected to (x, z), so random points are always reachable. */
  floodFrom(x, z) {
    const [sx, sz] = this.nearestWalkable(x, z);
    const reg = new Uint8Array(this.nx * this.nz), q = [this.cx(sx) + this.cz(sz) * this.nx];
    reg[q[0]] = 1;
    while (q.length) {
      const k = q.pop(), i = k % this.nx, j = (k / this.nx) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj, nk = nj * this.nx + ni;
        if (this.free(ni, nj) && !reg[nk]) { reg[nk] = 1; q.push(nk); }
      }
    }
    this.region = reg;
  }
  randomPoint(r, near, radius) {
    for (let t = 0; t < 400; t++) {
      let x, z;
      if (near) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius; x = near[0] + Math.cos(a) * d; z = near[1] + Math.sin(a) * d; }
      else { x = this.minX + r() * this.nx * CELL; z = this.minZ + r() * this.nz * CELL; }
      const i = this.cx(x), j = this.cz(z);
      if (this.free(i, j) && (!this.region || this.region[j * this.nx + i])) return [x, z];
    }
    return near ? this.nearestWalkable(near[0], near[1]) : [0, 0];
  }
  /** A* over the grid; 8 directions, no corner cutting. Returns a smoothed path. */
  path(ax, az, bx, bz, maxNodes = 6000) {
    let [sx, sz] = this.nearestWalkable(ax, az, 3), [tx, tz] = this.nearestWalkable(bx, bz, 6);
    const si = this.cx(sx), sj = this.cz(sz), ti = this.cx(tx), tj = this.cz(tz);
    if (si === ti && sj === tj) return [[bx, bz]];
    const N = this.nx * this.nz, start = sj * this.nx + si, goal = tj * this.nx + ti;
    const g = this._g || (this._g = new Float32Array(N)), from = this._from || (this._from = new Int32Array(N)), stamp = this._stamp || (this._stamp = new Uint32Array(N));
    this._run = (this._run || 0) + 1;
    const run = this._run, closed = run * 2, open = run * 2 + 1;
    if (run > 2e9) { stamp.fill(0); this._run = 1; }
    const heap = new Heap();
    const h = (k) => { const i = k % this.nx, j = (k / this.nx) | 0, dx = Math.abs(i - ti), dz = Math.abs(j - tj); return (dx + dz) + (1.4142 - 2) * Math.min(dx, dz); };
    g[start] = 0; from[start] = -1; stamp[start] = open; heap.push(start, h(start));
    let found = false, count = 0;
    while (heap.size) {
      const k = heap.pop();
      if (stamp[k] === closed) continue;
      stamp[k] = closed;
      if (k === goal) { found = true; break; }
      if (++count > maxNodes) break;
      const i = k % this.nx, j = (k / this.nx) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (!this.free(ni, nj)) continue;
        if (di && dj && (!this.free(i + di, j) || !this.free(i, j + dj))) continue;
        const nk = nj * this.nx + ni;
        if (stamp[nk] === closed) continue;
        const ng = g[k] + (di && dj ? 1.4142 : 1);
        if (stamp[nk] !== open || ng < g[nk]) { g[nk] = ng; from[nk] = k; stamp[nk] = open; heap.push(nk, ng + h(nk) * 1.05); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = goal; k !== -1; k = from[k]) cells.push(k);
    cells.reverse();
    // string-pull: keep only the corners we cannot see past
    const pts = cells.map((k) => [this.wx(k % this.nx), this.wz((k / this.nx) | 0)]);
    const out = [];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !this.lineFree(pts[a][0], pts[a][1], pts[b][0], pts[b][1])) b--;
      out.push(pts[b]); a = b;
    }
    if (out.length) out[out.length - 1] = [bx, bz];
    if (!this.walkable(bx, bz) && out.length) out[out.length - 1] = [tx, tz];
    return out;
  }
  lineFree(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / (CELL * 0.5));
    for (let s = 1; s < n; s++) { const t = s / n; if (!this.walkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
    return true;
  }
}

class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const K = this.k, P = this.p; let i = K.length; K.push(k); P.push(p);
    while (i > 0) { const pi = (i - 1) >> 1; if (P[pi] <= p) break; K[i] = K[pi]; P[i] = P[pi]; i = pi; }
    K[i] = k; P[i] = p;
  }
  pop() {
    const K = this.k, P = this.p, top = K[0], lk = K.pop(), lp = P.pop();
    if (K.length) {
      let i = 0; const n = K.length;
      while (true) { let c = i * 2 + 1; if (c >= n) break; if (c + 1 < n && P[c + 1] < P[c]) c++; if (P[c] >= lp) break; K[i] = K[c]; P[i] = P[c]; i = c; }
      K[i] = lk; P[i] = lp;
    }
    return top;
  }
}
