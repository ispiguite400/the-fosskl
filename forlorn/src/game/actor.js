/*
 * An actor: anyone with a body in a round or the lobby. The player and the bots drive actors the
 * same way, by setting actor.intent each frame; nothing here knows who is steering.
 *
 *   actor.intent = { mx, mz, sprint, jump, face }   world-space move (length <= 1), optional facing
 *   actor.fx.add('slow', 2, 0.4)  actor.fx.get('slow')   status effects with timers
 *   actor.damage(25, killer, 'm1')   actor.heal(30)
 */
import { clamp, damp, angDiff, TAU } from '../core/util.js';
import { byId } from '../data/characters.js';

export const TUNE = {
  survivor: { walk: 3.8, sprint: 6.0, accel: 24, drain: 8.5, regen: 16, delay: 0.9, radius: 0.42 },
  killer: { walk: 4.0, sprint: 6.25, accel: 24, drain: 7, regen: 12, delay: 1.4, radius: 0.48 },
  minion: { walk: 3.8, sprint: 5.4, accel: 20, drain: 0, regen: 0, delay: 0, radius: 0.42 },
  lobby: { walk: 3.7, sprint: 6.0, accel: 24, drain: 0, regen: 0, delay: 0, radius: 0.42 },
  gravity: 26, jump: 7.6
};

/** Status effects: each a timer and a value. Stacking takes the stronger, and the longer. */
class Effects {
  constructor() { this.m = new Map(); }
  add(name, t, v = 1, data) {
    const e = this.m.get(name);
    if (e) { e.t = Math.max(e.t, t); e.v = Math.max(e.v, v); if (data) e.data = data; e.t0 = Math.max(e.t0, t); return e; }
    const n = { t, t0: t, v, data }; this.m.set(name, n); return n;
  }
  get(name) { const e = this.m.get(name); return e ? e.v : 0; }
  has(name) { return this.m.has(name); }
  left(name) { const e = this.m.get(name); return e ? e.t : 0; }
  entry(name) { return this.m.get(name) || null; }
  remove(name) { this.m.delete(name); }
  clear() { this.m.clear(); }
  update(dt, scale) {
    for (const [k, e] of this.m) { e.t -= dt * (scale && scale[k] ? scale[k] : 1); if (e.t <= 0) this.m.delete(k); }
  }
}

let NEXT_ID = 1;

export class Actor {
  constructor(world, spec) {
    this.uid = NEXT_ID++;
    this.world = world;
    this.spec = spec;
    this.name = spec.name;
    this.charId = spec.charId; this.skin = spec.skin || 'default';
    this.def = byId(spec.charId);
    this.role = spec.role;                      // 'survivor' | 'killer' | 'minion' | 'lobby'
    this.isPlayer = !!spec.isPlayer;
    this.member = spec.member || null;          // the server member this body belongs to
    this.tune = TUNE[this.role] || TUNE.survivor;
    this.radius = this.tune.radius;
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vz = 0; this.vy = 0;
    this.yaw = 0; this.speed = 0; this.grounded = true;
    const d = this.def || {};
    this.maxHp = spec.hp || d.hp || (this.role === 'killer' ? 1000 : 100);
    this.hp = this.maxHp;
    this.maxStamina = (d.stamina || 100) * (d.passive && d.id === 'justin' ? 1.1 : 1);
    this.stamina = this.maxStamina;
    this.staminaWait = 0;
    this.sprinting = false; this.exhausted = false;
    this.alive = true; this.escaped = false; this.left = false;
    this.intent = { mx: 0, mz: 0, sprint: false, jump: false, face: null };
    this.fx = new Effects();
    this.cd = {};                                // ability id -> seconds left
    this.busy = null;                            // a channel: { kind, t, onDone, cancelOnMove, lock }
    this.item = null;
    this.view = null;
    this.stats = { gens: 0, damage: 0, hits: 0, stuns: 0, heals: 0, kills: 0, saves: 0, time: 0 };
    this.lastHitBy = null; this.lastHurt = -99;
    this.attackCd = 0;
    this.chaseHeat = 0;                          // how hard the killer is on this survivor right now
    this.bond = {};                              // other uid -> 0..1
    this.noise = 0;                              // how loud we are this moment (bots listen)
    this.push = null;                            // a forced move (dash, knockback): { vx, vz, t, onTick }
  }
  /** Shove the actor: a dash or a knockback, overriding its own movement for t seconds. */
  shove(vx, vz, t, onTick) { this.push = { vx, vz, t, onTick }; }
  get alive3() { return this.alive && !this.left; }
  setView(v) { this.view = v; if (v) this.world.scene.add(v.root); this.syncView(0); }
  place(x, z, yaw = 0) { this.x = x; this.z = z; this.y = 0; this.vx = this.vz = this.vy = 0; this.yaw = yaw; this.syncView(0); }
  forward() { return [Math.sin(this.yaw), Math.cos(this.yaw)]; }
  dist(o) { return Math.hypot(o.x - this.x, o.z - this.z); }
  /** Angle from my facing to the direction of o (0 = straight ahead). */
  angleTo(o) { return Math.abs(angDiff(this.yaw, Math.atan2(o.x - this.x, o.z - this.z))); }

  /* ----- status ----- */
  canMove() { return this.alive && !this.fx.has('stun') && !this.fx.has('root') && !this.fx.has('lifted') && !(this.busy && this.busy.lock); }
  canAct() { return this.alive && !this.fx.has('stun') && !this.fx.has('lifted') && !(this.busy && this.busy.lock); }
  speedMul() {
    let m = 1 + this.fx.get('haste');
    m *= 1 - Math.min(0.85, this.fx.get('slow'));
    if (this.def && this.def.speed) m *= this.def.speed;
    if (this.fx.has('frenzy')) m *= 1.12;
    return m;
  }
  isVisibleTo(viewer) {
    if (!this.alive || this.left) return false;
    if (this.fx.has('invis')) return viewer.dist(this) < 3.2;
    if (this.fx.has('hidden') && this.speed < 0.3) return viewer.dist(this) < 4;
    if (this.fx.has('disguise') && viewer.role === 'killer') return viewer.dist(this) < 3;
    return true;
  }

  /* ----- health ----- */
  damage(amount, source, kind = 'hit') {
    if (!this.alive || this.escaped) return 0;
    const m = this.world.match;
    const hook = m && m.beforeDamage ? m.beforeDamage(this, amount, source, kind) : amount;
    if (hook === false || hook <= 0) return 0;
    let dmg = hook;
    let red = 0;
    if (this.def && this.def.id === 'guest1337') red += 0.1;
    if (this.def && this.def.id === 'jez' && source && source.def && /bacon/.test(source.def.id)) red += 0.15;
    red += this.fx.get('armor');
    dmg *= 1 - Math.min(0.8, red);
    // gold plating and similar absorb first
    const absorb = this.fx.entry('absorb');
    if (absorb) { const a = Math.min(absorb.v, dmg); absorb.v -= a; dmg -= a; if (absorb.v <= 0.01) this.fx.remove('absorb'); }
    if (dmg <= 0) { this.view && this.view.flash(0xf2c14e, 0.2); return 0; }
    this.hp -= dmg;
    this.lastHitBy = source; this.lastHurt = this.world.time;
    if (source) { source.stats.damage += dmg; source.stats.hits++; }
    if (this.view) { this.view.flash(0xff2020, 0.22); if (this.hp > 0 && this.role !== 'killer') this.view.once('hurt', { speed: 1.4 }); }
    if (this.busy && this.busy.cancelOnHit !== false) this.cancelBusy();
    if (this.hp <= 0) { this.hp = 0; this.die(source, kind); }
    m && m.onDamaged && m.onDamaged(this, dmg, source, kind);
    return dmg;
  }
  heal(n, source) {
    if (!this.alive) return 0;
    const before = this.hp; this.hp = Math.min(this.maxHp, this.hp + n);
    if (source && source !== this) source.stats.heals += this.hp - before;
    return this.hp - before;
  }
  die(source, kind) {
    if (!this.alive) return;
    this.alive = false; this.busy = null;
    this.fx.clear();
    this.vx = this.vz = 0;
    if (this.view) this.view.die();
    if (source && source !== this) source.stats.kills++;
    const m = this.world.match; m && m.onDeath && m.onDeath(this, source, kind);
  }
  stun(t, source) {
    if (!this.alive) return false;
    const m = this.world.match;
    if (m && m.beforeStun && m.beforeStun(this, t, source) === false) return false;
    this.fx.add('stun', t);
    this.cancelBusy();
    if (this.view) this.view.loop('stunned');
    if (source) source.stats.stuns++;
    m && m.onStun && m.onStun(this, t, source);
    return true;
  }

  /* ----- channels: repairing, healing, aiming, emotes ----- */
  startBusy(kind, opts = {}) {
    this.cancelBusy();
    this.busy = Object.assign({ kind, t: 0, dur: Infinity, cancelOnMove: true, lock: false }, opts);
    if (opts.anim && this.view) this.view.loop(opts.anim);
    return this.busy;
  }
  cancelBusy() {
    const b = this.busy; if (!b) return;
    this.busy = null;
    if (b.onCancel) b.onCancel();
    if (b.anim && this.view) this.view.clear();
  }

  /* ----- per frame ----- */
  update(dt, collision) {
    this.fx.update(dt, this.def && this.def.id === 'rose' ? { slow: 2, root: 2 } : null);
    for (const k in this.cd) if (this.cd[k] > 0) this.cd[k] = Math.max(0, this.cd[k] - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    if (this.alive) this.stats.time += dt;
    // stunned/lifted animation ends when the effect does
    if (this.view && this.view.overrideName === 'stunned' && !this.fx.has('stun')) this.view.clear();
    if (this.view && this.view.overrideName === 'lifted' && !this.fx.has('lifted')) this.view.clear();
    if (this.view && this.view.overrideName === 'lifted') { /* held in the air by an ability */ }

    // healing over time, burning
    const hot = this.fx.entry('regen');
    if (hot && this.alive) this.heal(hot.v * dt, hot.data);
    const burn = this.fx.entry('burn');
    if (burn && this.alive) { this.hp -= burn.v * dt; if (this.hp <= 0) { this.hp = 0; this.die(burn.data, 'burn'); } }

    const I = this.intent, T = this.tune;
    let mx = I.mx || 0, mz = I.mz || 0;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const moving = ml > 0.05;
    if (!this.canMove()) { mx = mz = 0; }
    if (this.busy) {
      this.busy.t += dt;
      if (this.busy.cancelOnMove && moving && !this.busy.lock) this.cancelBusy();
      else if (this.busy.t >= this.busy.dur) { const b = this.busy; this.busy = null; if (b.anim && this.view) this.view.clear(); b.onDone && b.onDone(); }
      if (this.busy && !this.busy.allowMove) { mx = mz = 0; }
    }

    // stamina
    const wantSprint = I.sprint && moving && this.canMove() && (!this.busy || this.busy.allowMove);
    if (T.drain > 0) {
      if (wantSprint && !this.exhausted && this.stamina > 0) {
        this.sprinting = true;
        if (!this.fx.has('freestam')) this.stamina -= T.drain * dt;
        this.staminaWait = T.delay;
        if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; }
      } else {
        this.sprinting = false;
        this.staminaWait -= dt;
        if (this.staminaWait <= 0) this.stamina = Math.min(this.maxStamina, this.stamina + T.regen * (1 + this.fx.get('stamregen')) * dt);
        if (this.exhausted && this.stamina > this.maxStamina * 0.3) this.exhausted = false;
      }
    } else this.sprinting = wantSprint;

    const top = (this.sprinting ? T.sprint : T.walk) * this.speedMul();
    const tx = mx * top, tz = mz * top;
    const k = moving ? T.accel : T.accel * 1.4;
    this.vx = damp(this.vx, tx, k / 4, dt); this.vz = damp(this.vz, tz, k / 4, dt);
    if (this.push) {
      this.vx = this.push.vx; this.vz = this.push.vz; this.push.t -= dt;
      const p = this.push;
      if (p.onTick) p.onTick(this, dt);
      if (p.t <= 0 && this.push === p) { this.push = null; this.vx *= 0.3; this.vz *= 0.3; }
    }
    if (!this.alive) { this.vx = this.vz = 0; }

    // jump and fall
    if (I.jump && this.grounded && this.canMove() && !this.busy) { this.vy = TUNE.jump; this.grounded = false; this.noise = Math.max(this.noise, 0.3); }
    I.jump = false;
    if (!this.grounded) {
      this.vy -= TUNE.gravity * dt; this.y += this.vy * dt;
      if (this.y <= 0) { this.y = 0; this.vy = 0; this.grounded = true; }
    }

    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    if (collision && this.alive) [nx, nz] = collision.resolve(nx, nz, this.radius, this.y, 1.8);
    const realV = Math.hypot(nx - this.x, nz - this.z) / Math.max(dt, 1e-4);
    this.x = nx; this.z = nz;
    this.speed = damp(this.speed, Math.min(realV, Math.hypot(this.vx, this.vz) + 0.01), 14, dt);

    // facing: where we are told to look, else where we move
    if (this.alive && !this.fx.has('stun') && !this.fx.has('lifted')) {
      let want = null;
      if (I.face !== null && I.face !== undefined) want = I.face;
      else if (moving && this.speed > 0.4) want = Math.atan2(this.vx, this.vz);
      if (want !== null) this.yaw += angDiff(this.yaw, want) * Math.min(1, dt * (I.face !== null && I.face !== undefined ? 16 : 11));
      this.yaw = ((this.yaw % TAU) + TAU) % TAU;
    }
    this.noise = Math.max(0, this.noise - dt * 0.8);
    if (this.sprinting) this.noise = Math.max(this.noise, 0.45);
    this.syncView(dt);
  }
  syncView(dt) {
    const v = this.view; if (!v) return;
    v.root.position.set(this.x, this.y, this.z);
    v.root.rotation.y = this.yaw;
    if (this.alive) {
      if (!v.override) v.setMove(this.speed, this.sprinting, this.role === 'killer');
    }
    v.update(dt);
  }
  dispose() { if (this.view) this.view.dispose(); this.view = null; }
}

export const hpFrac = (a) => clamp(a.hp / a.maxHp, 0, 1);
