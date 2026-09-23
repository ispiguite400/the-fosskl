/* Shared test harness: loads the DOM-free modules and validates mesh invariants. */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/**
 * Load every module, in the order their filenames sort in — the same order
 * index.html loads them. Nothing in any module touches the DOM at load time
 * (the app's boot call is guarded), so the whole thing runs under Node.
 *
 * Taking the list from the directory rather than naming files here means
 * renumbering a module cannot quietly break the test suites.
 */
export function load() {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) require(path.join(dir, f));
  return globalThis.SCULPT;
}

let passed = 0, failed = 0;
const failures = [];

export function check(name, cond, detail = '') {
  if (cond) { passed++; }
  else { failed++; failures.push(name + (detail ? ' — ' + detail : '')); }
}

export function eq(name, got, want, tol = 0) {
  const ok = tol ? Math.abs(got - want) <= tol : got === want;
  check(name, ok, `got ${got}, want ${want}`);
}

export function report(label) {
  console.log(`\n${label}: ${passed} passed, ${failed} failed`);
  for (const f of failures) console.log('  FAIL ' + f);
  if (failed) process.exitCode = 1;
  return failed === 0;
}

/**
 * Full structural audit of a mesh: adjacency agrees with the triangle list,
 * no triangle references a dead vertex, no edge has more than two faces,
 * live counts match, free lists are consistent.
 */
export function audit(m, label) {
  const probs = [];
  const T = m.tris.array;
  let liveT = 0, liveV = 0;
  const edge = new Map();

  for (let t = 0; t < m.triDead.length; t++) {
    if (m.triDead.array[t]) continue;
    liveT++;
    const t3 = t * 3;
    const a = T[t3], b = T[t3 + 1], c = T[t3 + 2];
    if (a === b || b === c || a === c) probs.push(`tri ${t} degenerate (${a},${b},${c})`);
    for (const v of [a, b, c]) {
      if (v >= m.masks.length) { probs.push(`tri ${t} references out-of-range vert ${v}`); continue; }
      if (m.vertDead.array[v]) probs.push(`tri ${t} references dead vert ${v}`);
      if (!m.vertTris[v] || m.vertTris[v].indexOf(t) < 0) probs.push(`vertTris[${v}] missing tri ${t}`);
    }
    for (let k = 0; k < 3; k++) {
      const x = T[t3 + k], y = T[t3 + (k + 1) % 3];
      const key = x < y ? x + ':' + y : y + ':' + x;
      edge.set(key, (edge.get(key) || 0) + 1);
    }
  }
  for (const [key, n] of edge) if (n > 2) probs.push(`edge ${key} shared by ${n} faces (non-manifold)`);

  for (let v = 0; v < m.masks.length; v++) {
    if (m.vertDead.array[v]) {
      if (m.vertTris[v] && m.vertTris[v].length) probs.push(`dead vert ${v} still lists ${m.vertTris[v].length} tris`);
      continue;
    }
    liveV++;
    const lst = m.vertTris[v] || [];
    for (const t of lst) {
      if (m.triDead.array[t]) probs.push(`vertTris[${v}] lists dead tri ${t}`);
      else {
        const t3 = t * 3;
        if (T[t3] !== v && T[t3 + 1] !== v && T[t3 + 2] !== v) probs.push(`vertTris[${v}] lists tri ${t} that does not use it`);
      }
    }
    const p = m.positions.array, o = v * 3;
    if (!Number.isFinite(p[o]) || !Number.isFinite(p[o + 1]) || !Number.isFinite(p[o + 2])) probs.push(`vert ${v} has a non-finite position`);
  }

  if (liveT !== m.liveTris) probs.push(`liveTris=${m.liveTris} but counted ${liveT}`);
  if (liveV !== m.liveVerts) probs.push(`liveVerts=${m.liveVerts} but counted ${liveV}`);

  check(`audit ${label}`, probs.length === 0, probs.slice(0, 6).join(' | ') + (probs.length > 6 ? ` (+${probs.length - 6} more)` : ''));
  return probs;
}

/** Closed-surface volume via the divergence theorem — used to detect leaks. */
export function volume(m) {
  const T = m.tris.array, p = m.positions.array;
  let vol = 0;
  for (let t = 0; t < m.triDead.length; t++) {
    if (m.triDead.array[t]) continue;
    const t3 = t * 3, a = T[t3] * 3, b = T[t3 + 1] * 3, c = T[t3 + 2] * 3;
    vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
          - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
          + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return vol;
}

/* Camera checks live here so the node suite can cover the maths too. */
export function cameraTests(S, { check, eq }) {
  const cam = new S.Camera();
  cam.setViewport(800, 600);
  cam.target[0] = 0; cam.target[1] = 0; cam.target[2] = 0;
  cam.distance = 3;
  cam.yaw = 0; cam.pitch = 0;
  cam.update();
  check('camera sits on +z for the front view', Math.abs(cam.eye[2] - 3) < 1e-5 && Math.abs(cam.eye[0]) < 1e-6,
    Array.from(cam.eye).join(','));

  const o = S.V3.create(0, 0, 0), d = S.V3.create(0, 0, 0);
  cam.rayFromScreen(400, 300, o, d);
  check('centre ray points at the target', Math.abs(d[0]) < 1e-6 && Math.abs(d[1]) < 1e-6 && d[2] < -0.99,
    Array.from(d).join(','));
  cam.rayFromScreen(800, 300, o, d);
  check('right edge ray tilts +x', d[0] > 0.1, Array.from(d).join(','));
  cam.rayFromScreen(400, 0, o, d);
  check('top edge ray tilts +y', d[1] > 0.1, Array.from(d).join(','));

  // project and unproject must agree
  const p = S.V3.create(0.3, -0.2, 0.1);
  const scr = [0, 0, 0];
  cam.project(p, scr);
  cam.rayFromScreen(scr[0], scr[1], o, d);
  // the point must lie on that ray
  const toP = S.V3.sub(S.V3.create(0, 0, 0), p, o);
  const along = S.V3.dot(toP, d);
  const perp = Math.sqrt(Math.max(0, S.V3.lenSq(toP) - along * along));
  check('project and rayFromScreen are consistent', perp < 1e-4, `off-axis ${perp}`);

  // world per pixel scales with distance
  const nearPP = cam.worldPerPixel(S.V3.create(0, 0, 2.5));
  const farPP = cam.worldPerPixel(S.V3.create(0, 0, -2.5));
  check('worldPerPixel grows with depth', farPP > nearPP * 2, `${nearPP} vs ${farPP}`);

  // orbit stays inside the pole limits
  for (let i = 0; i < 100; i++) cam.orbit(0, 500);
  check('pitch is clamped at the pole', Math.abs(cam.pitch) < Math.PI / 2, `${cam.pitch}`);

  // framing a box puts it fully in view
  const min = S.V3.create(-1, -1, -1), max = S.V3.create(1, 1, 1);
  cam.frameBounds(min, max, true);
  check('framing places the target at the box centre', S.V3.len(cam.target) < 1e-6);
  check('framing pulls back far enough', cam.distance > 1.7, `${cam.distance}`);

  // ortho rays are parallel
  cam.ortho = true;
  cam.update();
  const d2 = S.V3.create(0, 0, 0);
  cam.rayFromScreen(100, 100, o, d);
  cam.rayFromScreen(700, 500, o, d2);
  check('ortho rays are parallel', S.V3.dist(d, d2) < 1e-6);

  const state = cam.serialize();
  const cam2 = new S.Camera();
  cam2.setViewport(800, 600);
  cam2.restore(state);
  check('camera state round trips', Math.abs(cam2.distance - cam.distance) < 1e-9 && cam2.ortho === true);

  // view presets
  cam.ortho = false;
  cam.setView('top', true);
  check('top view looks down', cam.forward()[1] < -0.99, Array.from(cam.forward()).join(','));
  cam.setView('left', true);
  check('left view looks along +x', cam.forward()[0] > 0.99, Array.from(cam.forward()).join(','));
}
