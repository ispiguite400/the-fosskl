/*
 * Collision against a map's colliders: boxes turned about Y, and upright cylinders.
 * Characters are circles on the ground; everything here is in the XZ plane plus a height range.
 *
 *   world.resolve(x, z, r)      -> [x, z] pushed out of every solid
 *   world.raycast3(from, dir, maxD)  -> distance to the first solid (camera collision)
 *   world.sightClear(ax, az, bx, bz, h) -> no sight-blocking solid between two points
 */
const CELL = 4;

export class CollisionWorld {
  constructor(colliders) {
    this.list = [];
    this.hash = new Map();
    for (const c of colliders) this.add(c);
  }
  _key(i, j) { return i * 73856093 ^ j * 19349663; }
  _cells(c, fn) {
    const r = c.type === 'box' ? Math.hypot(c.hw, c.hd) : c.r;
    for (let i = Math.floor((c.x - r) / CELL); i <= Math.floor((c.x + r) / CELL); i++)
      for (let j = Math.floor((c.z - r) / CELL); j <= Math.floor((c.z + r) / CELL); j++) fn(this._key(i, j));
  }
  add(c) {
    if (c.type === 'box') { c.cos = Math.cos(c.ry || 0); c.sin = Math.sin(c.ry || 0); }
    this.list.push(c);
    this._cells(c, (k) => { if (!this.hash.has(k)) this.hash.set(k, []); this.hash.get(k).push(c); });
    return c;
  }
  remove(c) {
    const i = this.list.indexOf(c); if (i >= 0) this.list.splice(i, 1);
    this._cells(c, (k) => { const a = this.hash.get(k); if (a) { const j = a.indexOf(c); if (j >= 0) a.splice(j, 1); } });
  }
  near(x, z, r, out = []) {
    out.length = 0;
    const seen = new Set();
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const a = this.hash.get(this._key(i, j)); if (!a) continue;
        for (const c of a) if (!seen.has(c)) { seen.add(c); out.push(c); }
      }
    return out;
  }
  /** Push a circle (feet at y, height ht) out of every solid it overlaps. */
  resolve(x, z, r, y = 0, ht = 1.8) {
    const near = this.near(x, z, r + 2, this._tmp || (this._tmp = []));
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const c of near) {
        if (c.y1 <= y + 0.35 || c.y0 >= y + ht) continue;      // step over low things, pass under high ones
        if (c.type === 'cyl') {
          const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
          if (d < m && d > 1e-6) { x = c.x + dx / d * m; z = c.z + dz / d * m; moved = true; }
        } else {
          // into the box's frame
          const dx = x - c.x, dz = z - c.z;
          const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
          const cx = Math.max(-c.hw, Math.min(c.hw, lx)), cz = Math.max(-c.hd, Math.min(c.hd, lz));
          let ox = lx - cx, oz = lz - cz, d = Math.hypot(ox, oz);
          if (d >= r) continue;
          let nx, nz;
          if (d > 1e-6) { nx = ox / d; nz = oz / d; }
          else {                                   // centre inside the box: leave by the nearest face
            const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
            if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; d = -px; } else { nx = 0; nz = Math.sign(lz) || 1; d = -pz; }
          }
          const push = r - d, wx = nx * push, wz = nz * push;
          x += wx * c.cos + wz * c.sin; z += -wx * c.sin + wz * c.cos;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return [x, z];
  }
  /** Distance along a 3D ray to the first solid, or maxD. */
  raycast3(ox, oy, oz, dx, dy, dz, maxD) {
    let best = maxD;
    const steps = Math.ceil(maxD / CELL) + 1, seen = new Set();
    for (let s = 0; s <= steps; s++) {
      const px = ox + dx * s * CELL * 0.9, pz = oz + dz * s * CELL * 0.9;
      for (const c of this.near(px, pz, CELL)) {
        if (seen.has(c)) continue; seen.add(c);
        const t = c.type === 'box' ? rayBox(c, ox, oy, oz, dx, dy, dz) : rayCyl(c, ox, oy, oz, dx, dy, dz);
        if (t >= 0 && t < best) best = t;
      }
    }
    return best;
  }
  /** Is the straight line between two points at eye height free of sight blockers? */
  sightClear(ax, az, bx, bz, h = 1.5) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 0.01) return true;
    const t = this.raycast2(ax, az, dx / L, dz / L, L, h, true);
    return t >= L - 0.05;
  }
  /** 2D ray at height h; sightOnly limits to colliders that block sight. */
  raycast2(ox, oz, dx, dz, maxD, h = 1, sightOnly = false) {
    let best = maxD;
    const seen = new Set();
    for (let s = 0; s * CELL * 0.8 <= maxD + CELL; s++) {
      const px = ox + dx * s * CELL * 0.8, pz = oz + dz * s * CELL * 0.8;
      for (const c of this.near(px, pz, CELL)) {
        if (seen.has(c)) continue; seen.add(c);
        if (sightOnly ? !c.sight : (c.y0 > h || c.y1 < h)) continue;
        const t = c.type === 'box' ? rayBox(c, ox, h, oz, dx, 0, dz) : rayCyl(c, ox, h, oz, dx, 0, dz);
        if (t >= 0 && t < best) best = t;
      }
      if (s * CELL * 0.8 > best) break;
    }
    return best;
  }
}

function rayBox(c, ox, oy, oz, dx, dy, dz) {
  const rx = ox - c.x, rz = oz - c.z;
  const lx = rx * c.cos - rz * c.sin, lz = rx * c.sin + rz * c.cos;
  const ldx = dx * c.cos - dz * c.sin, ldz = dx * c.sin + dz * c.cos;
  let t0 = -Infinity, t1 = Infinity;
  const slab = (o, d, lo, hi) => {
    if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
    let a = (lo - o) / d, b = (hi - o) / d; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); return t0 <= t1;
  };
  if (!slab(lx, ldx, -c.hw, c.hw) || !slab(oy, dy, c.y0, c.y1) || !slab(lz, ldz, -c.hd, c.hd)) return -1;
  if (t1 < 0) return -1;
  return t0 >= 0 ? t0 : 0;
}
function rayCyl(c, ox, oy, oz, dx, dy, dz) {
  const fx = ox - c.x, fz = oz - c.z, a = dx * dx + dz * dz;
  if (a < 1e-9) return -1;
  const b = 2 * (fx * dx + fz * dz), cc = fx * fx + fz * fz - c.r * c.r, disc = b * b - 4 * a * cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = (-b - s) / (2 * a);
  if (t < 0) t = cc < 0 ? 0 : (-b + s) / (2 * a);
  if (t < 0) return -1;
  const y = oy + dy * t;
  return y >= c.y0 && y <= c.y1 ? t : -1;
}
