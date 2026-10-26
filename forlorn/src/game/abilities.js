/*
 * What every ability does. Keyed by the ids in data/characters.js.
 *
 *   ABILITIES[id].cast(actor, match, aim)  -> true if it went off (then the cooldown starts)
 *   ABILITIES[id].ai(actor, match, ctx)    -> should a bot use it now? (may fill ctx.aim)
 *
 * aim = { yaw, target, point }: the player aims with the camera, bots with their brain.
 */
import * as THREE from 'three';
import { angDiff, clamp } from '../core/util.js';

/* ---------- helpers ---------- */
const isKillerSide = (a) => a.role === 'killer' || a.role === 'minion';
export const enemies = (a, M) => M.actors.filter((o) => o.alive && o !== a && isKillerSide(o) !== isKillerSide(a));
export const allies = (a, M, withSelf = false) => M.actors.filter((o) => o.alive && o.role === a.role && (withSelf || o !== a));
const yawOf = (a, aim) => (aim && aim.yaw !== undefined && aim.yaw !== null ? aim.yaw : a.yaw);
const fwd = (yaw) => [Math.sin(yaw), Math.cos(yaw)];

/** The enemy best in front of yaw within range and cone (radians, half-angle), in sight. */
export function pickTarget(a, M, yaw, range, cone, { needSight = true, list } = {}) {
  let best = null, bestS = Infinity;
  for (const o of list || enemies(a, M)) {
    const d = a.dist(o); if (d > range) continue;
    const ang = Math.abs(angDiff(yaw, Math.atan2(o.x - a.x, o.z - a.z)));
    if (ang > cone && d > 1.4) continue;
    if (needSight && !M.canSee(a, o, true)) continue;
    const s = ang * 6 + d * 0.3;
    if (s < bestS) { bestS = s; best = o; }
  }
  return best;
}
/** A straight shot: the first enemy along the line, unless a wall is nearer. */
function hitscan(a, M, yaw, range, width = 0.7) {
  const [fx, fz] = fwd(yaw);
  const wall = M.world.collision.raycast2(a.x, a.z, fx, fz, range, 1.2);
  let best = null, bestD = Math.min(range, wall);
  for (const o of enemies(a, M)) {
    const rx = o.x - a.x, rz = o.z - a.z, along = rx * fx + rz * fz;
    if (along < 0 || along > bestD) continue;
    const off = Math.abs(rx * fz - rz * fx);
    if (off < width + o.radius) { best = o; bestD = along; }
  }
  return { hit: best, dist: bestD, end: new THREE.Vector3(a.x + fx * bestD, 1.25, a.z + fz * bestD) };
}
const chest = (a) => new THREE.Vector3(a.x, a.y + 1.2, a.z);
const hand = (a) => (a.view ? a.view.handWorld('R') : chest(a));

/** A melee swing: everyone in the arc takes the hit. */
export function swing(a, M, { range, arc = 1.2, dmg, kind = 'm1', windup = 0.18, anim = 'attack', onHit }) {
  a.view && a.view.once(anim, { speed: 1.25 });
  M.sfx('swing', a, { pitch: 0.9 + Math.random() * 0.2 });
  M.later(windup, () => {
    if (!a.alive || a.fx.has('stun')) return;
    let any = false;
    for (const o of enemies(a, M)) {
      if (o.role === 'killer') continue;
      const d = a.dist(o); if (d > range + o.radius) continue;
      if (Math.abs(angDiff(a.yaw, Math.atan2(o.x - a.x, o.z - a.z))) > arc / 2 && d > 1.0) continue;
      if (!M.world.collision.sightClear(a.x, a.z, o.x, o.z, 1.0)) continue;
      const done = o.damage(dmg, a, kind);
      if (done > 0 || o.fx.has('blocking')) any = true;
      if (done > 0) { onHit && onHit(o); M.onMeleeHit(a, o, done, kind); }
    }
    if (!any) M.onWhiff(a);
  });
  return true;
}

function stunKiller(src, k, t, M, label) {
  if (k.role !== 'killer' && k.role !== 'minion') return false;
  const ok = k.stun(t, src);
  if (ok) { M.feed(src.name + ' ' + label + ' ' + k.name, 'good'); M.sfx('stun', k); }
  return ok;
}

/* ---------- the abilities ---------- */
export const ABILITIES = {
  /* ===== survivors ===== */
  block: {
    icon: '🛡', cast(a, M) { a.fx.add('blocking', 1.2); a.view && a.view.once('block', { speed: 0.9 }); M.sfx('ui', a, { vol: 0.4 }); return true; },
    ai(a, M, c) { return c.kd < 3.2 && c.kFacing && c.killer.attackCd <= 0.2; }
  },
  grenade: {
    icon: '💣',
    cast(a, M, aim) {
      const yaw = yawOf(a, aim), [fx, fz] = fwd(yaw), h = hand(a);
      const dist = aim && aim.target ? clamp(a.dist(aim.target), 4, 14) : 10;
      const t = 0.75, vy = (0 - 1.3) / t + 0.5 * 18 * t;
      a.view && a.view.once('throw');
      M.sfx('whoosh', a);
      M.fx.projectile({ x: h.x, y: h.y, z: h.z, vx: fx * dist / t, vy, vz: fz * dist / t, gravity: 18, owner: a, color: 0x7a8a40, size: 0.13, bounce: 0.35, life: 1.2, glow: false, spin: true,
        onExpire: (p) => {
          const P = p.mesh.position; M.explode(P.x, P.z, 4, a, { stun: 1.8, dmgKiller: 0, knock: 5, color: 0xffb050 });
        } });
      return true;
    },
    ai(a, M, c) { return c.killer && c.kd > 4 && c.kd < 12 && c.kSeen && c.chased && (c.aim = { yaw: Math.atan2(c.killer.x + c.killer.vx * 0.8 - a.x, c.killer.z + c.killer.vz * 0.8 - a.z), target: c.killer }); }
  },
  shieldbash: {
    icon: '🛡',
    cast(a, M, aim) {
      const yaw = yawOf(a, aim), [fx, fz] = fwd(yaw); a.yaw = yaw;
      a.fx.add('armor', 0.6, 0.5);
      a.view && a.view.once('lunge');
      M.sfx('whoosh', a, { pitch: 0.7 });
      let hit = false;
      a.shove(fx * 12.5, fz * 12.5, 0.4, (s) => {
        if (hit) return;
        for (const k of enemies(s, M)) if (s.dist(k) < 1.4) { hit = true; stunKiller(s, k, 1.5, M, 'shield-bashed'); k.shove(fx * 7, fz * 7, 0.25); s.push = null; M.sfx('block', k); break; }
      });
      return true;
    },
    ai(a, M, c) { return c.killer && c.kd < 5 && c.kd > 1.5 && c.kSeen && c.kInFront && (c.aim = { yaw: Math.atan2(c.killer.x - a.x, c.killer.z - a.z) }); }
  },
  supply: {
    icon: '📦',
    cast(a, M) {
      const [fx, fz] = a.forward(), x = a.x + fx * 1.2, z = a.z + fz * 1.2;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x5a6b3a, roughness: 0.8 }));
      box.position.y = 0.25;
      const g = new THREE.Group(); g.add(box);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.52), new THREE.MeshBasicMaterial({ color: 0xffffff })); cross.position.y = 0.42; g.add(cross);
      const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.3), new THREE.MeshBasicMaterial({ color: 0xd82020 })); cross2.position.y = 0.47; g.add(cross2);
      M.sfx('door', { x, z });
      M.fx.zone({ x, z, r: 1.1, life: 60, mesh: g, hits: 'survivor', onEnter: (o, zn) => { if (o.hp >= o.maxHp - 1 || zn.done) return; o.heal(35, a); M.sfx('heal', o); M.fx.burst(o.x, 1, o.z, 0x7dff9a, 20, 2, 0.8); zn.done = true; if (o !== a) M.feed(o.name + ' grabbed ' + a.name + "'s supplies", 'good'); } });
      return true;
    },
    ai(a, M, c) { return c.allyHurtNear || (a.hp < a.maxHp * 0.6 && !c.threat); }
  },
  firstaid: {
    icon: '✚',
    cast(a, M) {
      let t = null, best = 7;
      for (const o of allies(a, M)) { const d = a.dist(o); if (o.hp < o.maxHp - 5 && d < best) { best = d; t = o; } }
      if (!t) t = a;
      t.fx.add('regen', 3, 10, a);
      a.view && a.view.once('heal');
      M.sfx('heal', t); M.fx.burst(t.x, 1, t.z, 0x7dff9a, 26, 2, 1);
      if (t !== a) M.onHelped(a, t, 'healed');
      return true;
    },
    ai(a, M, c) { return (c.allyHurtNear && c.allyHurtNear.hp < c.allyHurtNear.maxHp * 0.75) || a.hp < a.maxHp * 0.55; }
  },
  rally: {
    icon: '📣',
    cast(a, M) {
      for (const o of allies(a, M, true)) if (a.dist(o) < 12) { o.fx.add('haste', 4, 0.25); o.stamina = o.maxStamina; o.exhausted = false; }
      a.view && a.view.once('cheer'); M.sfx('bond', a); M.fx.ring(a.x, a.z, 12, 0x7fe3ff, 0.7);
      return true;
    },
    ai(a, M, c) { return c.threat && c.alliesNear >= 1 && c.kd < 10; }
  },
  breakout: {
    icon: '💨', cast(a, M) { a.fx.add('haste', 3, 0.45); M.sfx('whoosh', a, { pitch: 1.3 }); return true; },
    ai(a, M, c) { return c.chased && c.kd < 5; }
  },
  smoke: {
    icon: '☁',
    cast(a, M) {
      M.sfx('smoke', a);
      M.fx.zone({ x: a.x, z: a.z, r: 5, life: 6, kind: 'smoke', hits: 'killer', onTick: (k) => k.fx.add('slow', 0.2, 0.3) });
      return true;
    },
    ai(a, M, c) { return c.chased && c.kd < 6; }
  },
  warcry: {
    icon: '⚔',
    cast(a, M) {
      for (const o of allies(a, M, true)) if (a.dist(o) < 15) o.fx.add('armor', 6, 0.3);
      a.view && a.view.once('point'); M.sfx('frenzy', a, { vol: 0.5 }); M.fx.ring(a.x, a.z, 15, 0xf2c14e, 0.8);
      return true;
    },
    ai(a, M, c) { return c.threat && c.kd < 12 && (c.alliesNear >= 1 || c.chased); }
  },
  sidearm: {
    icon: '🔫',
    cast(a, M, aim) {
      a.startBusy('aim', { dur: 0.45, lock: true, cancelOnMove: false, cancelOnHit: true, onDone: () => {
        const yaw = a.isPlayer && aim && aim.live ? aim.live() : (aim && aim.target ? Math.atan2(aim.target.x - a.x, aim.target.z - a.z) : yawOf(a, aim));
        a.yaw = yaw;
        const r = hitscan(a, M, yaw, 25, 0.45);
        a.view && a.view.once('shoot');
        M.sfx('shot', a); M.fx.beam(hand(a), r.end, 0xfff0b0, 0, 0.12); M.fx.flash(a.x, 1.4, a.z, 0xffd080, 8, 0.12);
        if (r.hit) stunKiller(a, r.hit, 1.5, M, 'shot');
      } });
      a.view && a.view.once('shoot', { speed: 0.6 });
      return true;
    },
    ai(a, M, c) { return c.killer && c.kSeen && c.kd < 16 && c.kd > 3 && (c.aim = { target: c.killer }); }
  },
  hide: {
    icon: '👁', cast(a, M) { a.fx.add('hidden', 8); M.sfx('whoosh', a, { vol: 0.3, pitch: 0.6 }); return true; },
    ai(a, M, c) { return c.threat && !c.chased && c.kd > 8; }
  },
  sixthsense: {
    icon: '👁',
    cast(a, M) { const k = M.killer; if (k) { M.reveal(k, 5, 'survivor'); M.feed(a.name + ' sensed ' + k.name, 'info'); } M.sfx('echo', a); return true; },
    ai(a, M, c) { return !c.killer || (!c.kSeen && c.kLastAge > 12); }
  },
  burst: {
    icon: '⚡', cast(a, M) { a.fx.add('haste', 2.5, 0.5); M.sfx('whoosh', a, { pitch: 1.4 }); return true; },
    ai(a, M, c) { return c.chased && c.kd < 4.5; }
  },
  flashlight: {
    icon: '🔦',
    cast(a, M, aim) {
      const yaw = yawOf(a, aim); a.yaw = yaw;
      const k = pickTarget(a, M, yaw, 8.5, 0.5);
      const [fx, fz] = fwd(yaw);
      M.fx.beam(chest(a), new THREE.Vector3(a.x + fx * 8, 1.4, a.z + fz * 8), 0xfff6c8, 0, 0.35, 3);
      M.fx.flash(a.x + fx * 3, 1.4, a.z + fz * 3, 0xfff6c8, 10, 0.35);
      M.sfx('ui', a);
      if (k && k.angleTo(a) < 1.3) { k.fx.add('blind', 2); k.fx.add('slow', 2, 0.2); M.feed(a.name + ' blinded ' + k.name, 'good'); a.stats.stuns++; }
      return true;
    },
    ai(a, M, c) { return c.killer && c.kSeen && c.kd < 7.5 && c.kFacing && (c.aim = { yaw: Math.atan2(c.killer.x - a.x, c.killer.z - a.z) }); }
  },
  makeitrain: {
    icon: '💸',
    cast(a, M) { M.sfx('cash', a); M.fx.zone({ x: a.x, z: a.z, r: 3.6, life: 5, kind: 'cash', hits: 'killer', onTick: (k) => k.fx.add('slow', 0.2, 0.35) }); a.view && a.view.once('cheer'); return true; },
    ai(a, M, c) { return c.chased && c.kd < 5; }
  },
  gold: {
    icon: '🥇', cast(a, M) { a.fx.add('absorb', 8, 40); M.sfx('buy', a); M.fx.burst(a.x, 1, a.z, 0xf2c14e, 26, 2, 0.8); return true; },
    ai(a, M, c) { return c.threat && c.kd < 6; }
  },
  push: {
    icon: '✋',
    cast(a, M, aim) {
      const yaw = yawOf(a, aim); a.yaw = yaw;
      a.view && a.view.once('cast');
      M.sfx('teleport', a); M.fx.ring(a.x, a.z, 7, 0x46e0ff, 0.5);
      const k = pickTarget(a, M, yaw, 7.5, 0.6);
      if (k) { const d = a.dist(k) || 1; k.shove((k.x - a.x) / d * 15, (k.z - a.z) / d * 15, 0.4); stunKiller(a, k, 1, M, 'threw'); M.fx.burst(k.x, 1.2, k.z, 0x46e0ff, 30, 4, 0.6); }
      return true;
    },
    ai(a, M, c) { return c.killer && c.kd < 5 && c.kSeen && c.kInFront && (c.aim = { yaw: Math.atan2(c.killer.x - a.x, c.killer.z - a.z) }); }
  },
  shield: {
    icon: '🔷',
    cast(a, M) {
      let t = a, best = 10;
      for (const o of allies(a, M)) { const d = a.dist(o); const s = d - (o.chaseHeat > 0.5 ? 6 : 0) - (1 - o.hp / o.maxHp) * 4; if (d < 10 && s < best) { best = s; t = o; } }
      t.fx.add('astral', 6); M.sfx('echo', t); M.fx.burst(t.x, 1, t.z, 0x46e0ff, 24, 2, 0.8);
      if (t !== a) M.onHelped(a, t, 'shielded');
      return true;
    },
    ai(a, M, c) { return (c.allyChased && a.dist(c.allyChased) < 10) || (c.chased && c.kd < 6); }
  },
  disguise: {
    icon: '🥓', cast(a, M) { a.fx.add('disguise', 6); M.sfx('whoosh', a, { vol: 0.4, pitch: 0.8 }); return true; },
    ai(a, M, c) { return c.threat && c.kd > 4 && c.kd < 16; }
  },
  snare: {
    icon: '🪤',
    cast(a, M) {
      const g = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 6, 16), new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.7 }));
      g.rotation.x = -Math.PI / 2; g.position.y = 0.04;
      const mesh = new THREE.Group(); mesh.add(g);
      M.fx.zone({ x: a.x, z: a.z, r: 0.75, life: 45, mesh, hits: 'killer', onEnter: (k, zn) => { if (zn.done) return; k.fx.add('root', 2); M.sfx('trap', k); M.feed(k.name + " stepped in " + a.name + "'s snare", 'good'); a.stats.stuns++; zn.done = true; } });
      M.sfx('trap', a, { vol: 0.3 });
      return true;
    },
    ai(a, M, c) { return c.chased && c.kd > 2 && c.kd < 8; }
  },

  /* ===== killers ===== */
  hellfire: {
    icon: '🔥',
    cast(a, M, aim) {
      const yaw = aimYaw(a, aim), [fx, fz] = fwd(yaw); a.yaw = yaw;
      a.view && a.view.once('cast');
      M.sfx('fireball', a);
      const h = chest(a);
      M.fx.projectile({ x: h.x + fx * 0.8, y: 1.3, z: h.z + fz * 0.8, vx: fx * 21, vy: 0, vz: fz * 21, owner: a, color: 0xff5a14, size: 0.3, radius: 0.55, life: 1.4,
        onHit: (o) => { o.damage(30, a, 'fire'); o.fx.add('burn', 2, 4, a); M.fx.burst(o.x, 1.2, o.z, 0xff7a20, 30, 4, 0.7); M.sfx('fire', o); return 'stop'; },
        onWorld: (p) => { M.fx.burst(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, 0xff7a20, 26, 3, 0.6); M.sfx('fire', p.mesh.position); },
        onExpire: () => {} });
      // the burning trail
      const sx = a.x, sz = a.z;
      for (let i = 1; i <= 6; i++) M.later(i * 0.09, () => {
        const x = sx + fx * i * 3, z = sz + fz * i * 3;
        if (M.world.collision.raycast2(sx, sz, fx, fz, i * 3, 1) < i * 3 - 0.5) return;
        M.fx.zone({ x, z, r: 1.1, life: 3.2, kind: 'fire', hits: 'survivor', onTick: (o) => o.fx.add('burn', 0.5, 6, a) });
      });
      M.fx.flash(a.x, 1.5, a.z, 0xff5a14, 14, 0.4);
      return true;
    },
    ai(a, M, c) { return c.target && c.tSeen && c.td > 5 && c.td < 18 && (c.aim = { target: c.target, lead: 21 }); }
  },
  levitate: {
    icon: '🪬',
    cast(a, M, aim) {
      const yaw = aimYaw(a, aim);
      const t = aim && aim.target && a.dist(aim.target) < 18 && M.canSee(a, aim.target, true) ? aim.target : pickTarget(a, M, yaw, 18, 0.35);
      if (!t) { M.denied(a, 'No one in sight'); return false; }
      a.yaw = Math.atan2(t.x - a.x, t.z - a.z);
      a.view && a.view.once('cast', { speed: 0.6 });
      t.fx.add('lifted', 1.6); t.cancelBusy(); t.view && t.view.loop('lifted');
      M.sfx('teleport', t, { pitch: 0.6 }); M.fx.burst(t.x, 1, t.z, 0xff2a2a, 30, 2, 1.2, 3);
      M.later(1.6, () => { if (t.alive) { t.damage(20, a, 'levitate'); M.fx.burst(t.x, 0.3, t.z, 0xff2a2a, 20, 3, 0.6); M.sfx('hit', t); } });
      a.startBusy('cast', { dur: 0.7, lock: true, cancelOnMove: false });
      return true;
    },
    ai(a, M, c) { return c.target && c.tSeen && c.td > 6 && c.td < 17 && (c.aim = { target: c.target }); }
  },
  vanish: {
    icon: '🌑', cast(a, M) { a.fx.add('invis', 5); a.fx.add('haste', 5, 0.2); M.sfx('teleport', a, { pitch: 0.5 }); M.fx.burst(a.x, 1, a.z, 0x220000, 40, 2, 1); return true; },
    ai(a, M, c) { return (c.target && c.td > 14 && c.td < 30) || (!c.target && Math.random() < 0.02); }
  },
  pistol: {
    icon: '🔫',
    cast(a, M, aim) {
      a.view && a.view.once('shoot', { speed: 0.7 });
      a.startBusy('aim', { dur: 0.35, lock: false, allowMove: true, cancelOnMove: false, onDone: () => {
        const yaw = aim && aim.live ? aim.live() : aimYaw(a, aim);
        a.yaw = yaw;
        const r = hitscan(a, M, yaw, 30, 0.35);
        M.sfx('shot', a); M.fx.beam(hand(a), r.end, 0xffe0a0, 0, 0.1); M.fx.flash(a.x, 1.4, a.z, 0xffd080, 8, 0.1);
        if (r.hit) { r.hit.damage(30, a, 'shot'); M.fx.burst(r.hit.x, 1.2, r.hit.z, 0xff3030, 14, 3, 0.5); }
      } });
      a.fx.add('slow', 0.35, 0.4);
      return true;
    },
    ai(a, M, c) { return c.target && c.tSeen && c.td > 4 && c.td < 24 && Math.random() < 0.6 && (c.aim = { target: c.target, lead: 60 }); }
  },
  reinforce: {
    icon: '📻',
    cast(a, M) {
      a.view && a.view.once('point'); M.sfx('whistle', a);
      const ok = M.spawnMinions(a, 2, 20);
      if (!ok) { for (const s of M.survivorsAlive()) M.reveal(s, 5, 'killer'); M.feed(a.name + ' radioed the Empire: every survivor spotted', 'bad'); }
      return true;
    },
    ai(a, M, c) { return M.phase === 'play' && M.survivorsAlive().length >= 2 && Math.random() < 0.05; }
  },
  kgrenade: {
    icon: '💣',
    cast(a, M, aim) {
      const yaw = aimYaw(a, aim), [fx, fz] = fwd(yaw), h = hand(a);
      const dist = aim && aim.target ? clamp(a.dist(aim.target), 4, 15) : 12, t = 0.8, vy = (0 - 1.3) / t + 0.5 * 18 * t;
      a.view && a.view.once('throw'); M.sfx('whoosh', a);
      M.fx.projectile({ x: h.x, y: h.y, z: h.z, vx: fx * dist / t, vy, vz: fz * dist / t, gravity: 18, owner: a, color: 0x3a4a2a, size: 0.14, bounce: 0.3, life: 1.25, glow: false, spin: true,
        onExpire: (p) => { const P = p.mesh.position; M.explode(P.x, P.z, 4, a, { dmg: 35, color: 0xff9a40 }); } });
      return true;
    },
    ai(a, M, c) { return c.target && c.td > 5 && c.td < 14 && (c.aim = { target: c.target, lead: 14 }); }
  },
  shotgun: {
    icon: '💥',
    cast(a, M, aim) {
      const yaw = aimYaw(a, aim), [fx, fz] = fwd(yaw); a.yaw = yaw;
      a.view && a.view.once('shoot');
      M.sfx('shotgun', a); M.fx.flash(a.x + fx, 1.4, a.z + fz, 0xffc070, 14, 0.15);
      for (let i = -3; i <= 3; i++) { const y2 = yaw + i * 0.1, [gx, gz] = fwd(y2); M.fx.beam(hand(a), new THREE.Vector3(a.x + gx * 7, 1.2 + Math.random() * 0.3, a.z + gz * 7), 0xffe0a0, 0, 0.08); }
      for (const o of enemies(a, M)) {
        const d = a.dist(o); if (d > 7.5) continue;
        if (Math.abs(angDiff(yaw, Math.atan2(o.x - a.x, o.z - a.z))) > 0.4 && d > 1.2) continue;
        if (!M.world.collision.sightClear(a.x, a.z, o.x, o.z, 1.1)) continue;
        o.damage(Math.round(40 * clamp(1.15 - d / 7.5, 0.35, 1)), a, 'shot');
        o.shove((o.x - a.x) / (d || 1) * 8, (o.z - a.z) / (d || 1) * 8, 0.18);
        M.fx.burst(o.x, 1.2, o.z, 0xff3030, 16, 3, 0.5);
      }
      return true;
    },
    ai(a, M, c) { return c.target && c.tSeen && c.td < 6 && c.td > 2.2 && (c.aim = { target: c.target }); }
  },
  beartrap: {
    icon: '🪤',
    cast(a, M) {
      a.traps = (a.traps || []).filter((z) => !z.done && z.t < z.life);
      if (a.traps.length >= 3) { const old = a.traps.shift(); old.done = true; }
      const mesh = new THREE.Group();
      const jaw = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 6, 14), new THREE.MeshStandardMaterial({ color: 0x6a6a70, metalness: 0.8, roughness: 0.4 }));
      jaw.rotation.x = -Math.PI / 2; jaw.position.y = 0.05; mesh.add(jaw);
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 10), new THREE.MeshStandardMaterial({ color: 0x8a6a40, metalness: 0.5 })); plate.position.y = 0.03; mesh.add(plate);
      const [fx, fz] = a.forward();
      const z = M.fx.zone({ x: a.x + fx * 0.9, z: a.z + fz * 0.9, r: 0.65, life: 90, mesh, hits: 'survivor', onEnter: (o, zn) => { if (zn.done) return; o.damage(15, a, 'trap'); o.fx.add('root', 2.5); M.sfx('trap', o); M.reveal(o, 3, 'killer'); zn.done = true; M.feed(o.name + ' stepped in a bear trap', 'bad'); } });
      a.traps.push(z);
      a.view && a.view.once('repair', { speed: 2 }); M.sfx('trap', a, { vol: 0.25 });
      return true;
    },
    ai(a, M, c) { return (!c.target && M.nearGen(a, 5)) || (c.target && c.td > 3 && c.td < 6 && Math.random() < 0.15); }
  },
  interrogate: {
    icon: '🗡', cast(a, M) { a.fx.add('interrogate', 10); M.sfx('laugh', a, { pitch: 0.8 }); return true; },
    ai(a, M, c) { return c.target && c.td < 8; }
  },
  dashslash: {
    icon: '⚔',
    cast(a, M, aim) {
      const yaw = aimYaw(a, aim), [fx, fz] = fwd(yaw); a.yaw = yaw;
      a.view && a.view.once('slash'); M.sfx('swing', a, { pitch: 0.7 });
      const cut = new Set();
      a.shove(fx * 22, fz * 22, 0.36, (s) => {
        for (const o of enemies(s, M)) if (!cut.has(o) && s.dist(o) < 1.6) { cut.add(o); const d = o.damage(30, s, 'slash'); if (d) { M.fx.burst(o.x, 1.2, o.z, 0xff3030, 22, 4, 0.6); M.sfx('hit', o); } }
      });
      return true;
    },
    ai(a, M, c) { return c.target && c.tSeen && c.td > 3.5 && c.td < 8 && c.tAngle < 0.25 && (c.aim = { target: c.target }); }
  },
  parry: {
    icon: '🤺', cast(a, M) { a.fx.add('parry', 1); a.view && a.view.once('block'); M.sfx('block', a, { vol: 0.4 }); return true; },
    ai(a, M, c) { return c.target && c.td < 3 && c.targetHasStun && Math.random() < 0.4; }
  },
  execute: {
    icon: '☠',
    cast(a, M, aim) {
      a.yaw = aimYaw(a, aim);
      a.fx.add('slow', 0.8, 0.6);
      a.view && a.view.once('slash', { speed: 0.6 });
      M.sfx('roar', a, { pitch: 1.3, vol: 0.5 });
      M.later(0.75, () => {
        if (!a.alive || a.fx.has('stun')) return;
        let any = false;
        for (const o of enemies(a, M)) {
          const d = a.dist(o); if (d > 3.2) continue;
          if (Math.abs(angDiff(a.yaw, Math.atan2(o.x - a.x, o.z - a.z))) > 0.8 && d > 1) continue;
          const dd = o.damage(60, a, 'execute'); if (dd) { any = true; M.fx.burst(o.x, 1.2, o.z, 0xff2020, 40, 5, 0.8); M.sfx('hit', o, { pitch: 0.7 }); M.shakeNear(o, 0.25); }
        }
        if (!any) M.onWhiff(a);
      });
      return true;
    },
    ai(a, M, c) { return c.target && c.td < 2.6 && c.tAngle < 0.5 && (c.targetStuck || c.target.hp > 55); }
  },
  lightning: {
    icon: '⚡',
    cast(a, M, aim) {
      const yaw = aimYaw(a, aim);
      const first = aim && aim.target && a.dist(aim.target) < 14 && M.canSee(a, aim.target, true) ? aim.target : pickTarget(a, M, yaw, 14, 0.6);
      if (!first) { M.denied(a, 'No one in sight'); return false; }
      a.yaw = Math.atan2(first.x - a.x, first.z - a.z);
      a.view && a.view.once('cast');
      const zap = (from, to) => { M.fx.beam(from, chest(to), 0xfff36b, 0.6, 0.3, 2); M.fx.beam(from, chest(to), 0xffffff, 0.35, 0.2); to.damage(22, a, 'lightning'); to.fx.add('slow', 2, 0.3); M.fx.burst(to.x, 1.2, to.z, 0xfff36b, 20, 3, 0.5); M.fx.flash(to.x, 1.6, to.z, 0xfff36b, 12, 0.25); };
      zap(hand(a), first);
      M.sfx('zap', a);
      let second = null, best = 8;
      for (const o of enemies(a, M)) { if (o === first) continue; const d = first.dist(o); if (d < best) { best = d; second = o; } }
      if (second) M.later(0.12, () => { if (second.alive) zap(chest(first), second); });
      return true;
    },
    ai(a, M, c) { return c.target && c.tSeen && c.td > 3 && c.td < 13 && (c.aim = { target: c.target }); }
  },
  possess: {
    icon: '🌀',
    cast(a, M, aim) {
      const yaw = aimYaw(a, aim);
      const t = aim && aim.target && a.dist(aim.target) < 15 && M.canSee(a, aim.target, true) ? aim.target : pickTarget(a, M, yaw, 15, 0.45);
      if (!t) { M.denied(a, 'No one in sight'); return false; }
      a.view && a.view.once('cast', { speed: 0.7 });
      const d = a.dist(t) || 1, pull = Math.min(6, d - 1.6);
      t.cancelBusy(); t.fx.add('root', 0.5);
      t.shove((a.x - t.x) / d * pull / 0.5, (a.z - t.z) / d * pull / 0.5, 0.5);
      M.fx.beam(hand(a), chest(t), 0xffd21f, 0.25, 0.5, 2);
      M.sfx('teleport', t, { pitch: 0.7 });
      return true;
    },
    ai(a, M, c) { return c.target && c.tSeen && c.td > 5 && c.td < 14 && (c.aim = { target: c.target }); }
  },
  limbo: {
    icon: '🕳',
    cast(a, M, aim) {
      const yaw = aimYaw(a, aim), [fx, fz] = fwd(yaw);
      let reach = M.world.collision.raycast2(a.x, a.z, fx, fz, 15, 1);
      reach = Math.max(0, Math.min(15, reach) - 0.8);
      // Limbo lets you pass one wall: try past it first
      let tx = a.x + fx * 15, tz = a.z + fz * 15;
      if (!M.world.nav.walkable(tx, tz)) { tx = a.x + fx * reach; tz = a.z + fz * reach; }
      [tx, tz] = M.world.nav.nearestWalkable(tx, tz, 3);
      M.fx.burst(a.x, 1, a.z, 0xffd21f, 40, 3, 0.8); M.sfx('teleport', a);
      a.place(tx, tz, yaw);
      M.fx.burst(tx, 1, tz, 0xffd21f, 40, 3, 0.8); M.fx.ring(tx, tz, 3, 0xffd21f, 0.5);
      return true;
    },
    ai(a, M, c) { return c.target && c.td > 9 && c.td < 22 && c.tAngle < 0.3 && (c.aim = { target: c.target }); }
  }
};

/** Killer aim: toward the target (with lead) or the given yaw. */
function aimYaw(a, aim) {
  if (aim && aim.target) {
    const t = aim.target, lead = aim.lead ? a.dist(t) / aim.lead : 0;
    return Math.atan2(t.x + t.vx * lead - a.x, t.z + t.vz * lead - a.z) + (aim.err || 0);
  }
  return yawOf(a, aim);
}

export const ITEMS = {
  medkit: { name: 'Medkit', icon: '✚', color: 0xe8e8e8,
    use(a, M) {
      if (a.hp >= a.maxHp - 1) { M.denied(a, 'Already at full health'); return false; }
      a.startBusy('medkit', { dur: 2, anim: 'heal', onDone: () => { a.heal(40, a); M.sfx('heal', a); M.fx.burst(a.x, 1, a.z, 0x7dff9a, 24, 2, 0.8); a.item = null; } });
      return 'keep';
    },
    ai(a, M, c) { return a.hp < a.maxHp * 0.6 && (!c.threat || c.kd > 14); } },
  cola: { name: 'Bloxy Cola', icon: '🥤', color: 0xd83030,
    use(a, M) { a.fx.add('haste', 6, 0.25); a.fx.add('freestam', 3); a.stamina = a.maxStamina; a.exhausted = false; M.sfx('drink', a); return true; },
    ai(a, M, c) { return c.chased && c.kd < 6 && a.stamina < a.maxStamina * 0.5; } }
};
