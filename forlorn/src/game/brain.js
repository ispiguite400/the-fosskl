/*
 * The bots' minds. A brain looks at the round the way a player would (what it can see and hear,
 * what teammates call out), decides what it wants, and steers its actor by setting actor.intent.
 *
 *   new SurvivorBrain(actor, match)   new KillerBrain(actor, match)   new LobbyBrain(actor, lobby)
 *   brain.update(dt)
 *
 * Personas (data/bots.js) shape every choice: skill sets reaction time, aim and looping; team
 * decides whether they come back for you; nerve how close they let the killer get; toxic how they
 * take losing. Nobody is the same twice.
 */
import { angDiff, clamp, R, dist } from '../core/util.js';
import { ABILITIES, ITEMS, enemies } from './abilities.js';
import { STYLES, KILLER_STYLES } from '../data/bots.js';

/* ---------- path following with unsticking ---------- */
class Mover {
  constructor(a, M) { this.a = a; this.M = M; this.path = null; this.goal = null; this.i = 0; this.repathT = 0; this.stuckT = 0; this.px = a.x; this.pz = a.z; this.probe = 0; this.side = R() < 0.5 ? 1 : -1; }
  to(x, z, { direct = false, every = 1.2 } = {}) {
    const a = this.a, nav = this.M.world.nav, g = this.goal;
    if (!g || Math.hypot(g[0] - x, g[1] - z) > 1.2 || this.repathT <= 0) {
      if (direct || nav.lineFree(a.x, a.z, x, z)) this.path = [[x, z]];
      else this.path = nav.path(a.x, a.z, x, z, 22000) || [[x, z]];
      this.goal = [x, z]; this.i = 0; this.repathT = every * (0.8 + R() * 0.4);
    }
  }
  clear() { this.path = null; this.goal = null; }
  /** Steer along the path; returns the distance left to the goal. */
  step(dt, scale = 1, sprint = false) {
    const a = this.a, I = a.intent;
    this.repathT -= dt;
    if (!this.path || !this.path.length) { I.mx = I.mz = 0; I.sprint = false; return 0; }
    let wp = this.path[this.i];
    while (wp && Math.hypot(wp[0] - a.x, wp[1] - a.z) < 0.55 && this.i < this.path.length - 1) { this.i++; wp = this.path[this.i]; }
    const g = this.path[this.path.length - 1];
    const left = Math.hypot(g[0] - a.x, g[1] - a.z);
    if (left < 0.45) { I.mx = I.mz = 0; I.sprint = false; return left; }
    let dx = wp[0] - a.x, dz = wp[1] - a.z; const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    // keep a little space from other bodies
    for (const o of this.M.actors) {
      if (o === a || !o.alive || o.role === 'killer' || a.role === 'killer') continue;
      const ox = a.x - o.x, oz = a.z - o.z, d2 = ox * ox + oz * oz;
      if (d2 < 1.2 && d2 > 1e-4) { const d = Math.sqrt(d2); dx += ox / d * 0.35; dz += oz / d * 0.35; }
    }
    // stuck? nudge sideways, hop, then plan again
    this.probe += dt;
    if (this.probe > 0.8) {
      const moved = Math.hypot(a.x - this.px, a.z - this.pz);
      if (moved < 0.35 && scale > 0.2 && a.canMove() && !a.busy) { this.stuckT += this.probe; } else this.stuckT = 0;
      this.px = a.x; this.pz = a.z; this.probe = 0;
      if (this.stuckT > 1.2) { this.repathT = 0; this.stuckT = 0; this.unstick = 0.6; this.side = -this.side; if (R() < 0.6) I.jump = true; }
    }
    if (this.unstick > 0) { this.unstick -= dt; const sx = -dz * this.side, sz = dx * this.side; dx = dx * 0.3 + sx; dz = dz * 0.3 + sz; }
    const l2 = Math.hypot(dx, dz) || 1;
    I.mx = dx / l2 * scale; I.mz = dz / l2 * scale; I.sprint = sprint;
    return left;
  }
}

const placeName = (M, x, z) => {
  let best = null, bd = 1e9;
  M.gens.forEach((g, i) => { const d = dist(x, z, g.x, g.z); if (d < bd) { bd = d; best = i; } });
  if (M.landmarks) for (const L of M.landmarks) { const d = dist(x, z, L.x, L.z); if (d < bd - 3) { bd = d; best = L.name; } }
  return typeof best === 'number' ? 'gen ' + (best + 1) : best || 'spawn';
};

/* ================= SURVIVORS ================= */
export class SurvivorBrain {
  constructor(a, M) {
    this.a = a; this.M = M; this.p = a.member.persona;
    this.style = STYLES[this.p.style] || STYLES.newbie;
    this.mv = new Mover(a, M);
    this.think = R() * 0.5; this.sense = R() * 0.3;
    this.goal = null;                       // { kind, ... }
    this.k = { x: 0, z: 0, t: -99, seen: false, heard: -99 };   // what we know of the killer
    this.fleeDir = null; this.fleeT = 0;
    this.useT = 1 + R() * 2;
    this.chatCd = 4 + R() * 6;
    this.afkT = this.p.style === 'afk' ? 40 + R() * 90 : 0;
    this.buddy = null;
    this.lastCall = -99;
    this.panic = 0;
    this.emoteT = 0;
    this.jumpT = 0;
    this.saidChased = -99; this.saidHurt = -99;
    this.genSaid = null;
  }
  get kd() { return this.k.t > -50 ? dist(this.a.x, this.a.z, this.k.x, this.k.z) : Infinity; }
  learnKiller(x, z, t, seen) { if (t >= this.k.t) { this.k.x = x; this.k.z = z; this.k.t = t; } if (seen) this.k.seen = true; }

  perceive() {
    const a = this.a, M = this.M, K = M.killer;
    this.k.seen = false;
    if (!K || !K.alive) return;
    const d = a.dist(K);
    // sight: a wide view (players turn their cameras) but things behind are noticed less
    if (d < 34 && M.canSee(a, K, false)) {
      const behind = a.angleTo(K) > 2.0;
      if (!behind || d < 9 || R() < 0.25 + this.p.skill * 0.4) { this.learnKiller(K.x, K.z, M.time, true); this.k.seen = true; }
    }
    // the terror radius: everybody hears the music getting louder
    if (!this.k.seen && d < 24 && !K.fx.has('invis')) {
      const n = d * 0.25;
      this.learnKiller(K.x + (R() - 0.5) * n, K.z + (R() - 0.5) * n, M.time - 1.5, false); this.k.heard = M.time;
    }
    // minions count as danger too, lightly
    this.minion = null;
    for (const o of M.actors) if (o.role === 'minion' && o.alive && a.dist(o) < 12 && M.canSee(a, o, false)) { this.minion = o; break; }
  }
  /** Is the killer coming for me? */
  chased() {
    const a = this.a, K = this.M.killer;
    if (!K || !K.alive || !this.k.seen) return false;
    const d = a.dist(K);
    if (d > 16) return false;
    if (K.brain && K.brain.target === a) return true;
    const vx = K.vx, vz = K.vz, sp = Math.hypot(vx, vz);
    const toMe = sp > 0.5 ? ((a.x - K.x) * vx + (a.z - K.z) * vz) / (sp * (d || 1)) : 0;
    return toMe > 0.6 || (d < 6 && K.angleTo(a) < 0.6);
  }
  ctx() {
    const a = this.a, M = this.M, K = M.killer;
    const c = { killer: this.k.t > M.time - 6 ? K : null, kd: this.kd, kSeen: this.k.seen, kLastAge: M.time - this.k.t };
    if (c.killer) { c.kFacing = K.angleTo(a) < 0.7; c.kInFront = a.angleTo(K) < 0.7; }
    c.chased = this.chasedNow; c.threat = this.threat;
    let near = 0, hurt = null, hurtD = 9, chasedAlly = null;
    for (const o of M.actors) {
      if (o === a || !o.alive || o.role !== 'survivor') continue;
      const d = a.dist(o);
      if (d < 12) near++;
      if (o.hp < o.maxHp * 0.8 && d < hurtD) { hurtD = d; hurt = o; }
      if (o.chaseHeat > 0.5 && d < 30) chasedAlly = o;
    }
    c.alliesNear = near; c.allyHurtNear = hurt; c.allyChased = chasedAlly;
    return c;
  }
  say(topic, vars = {}, force) { this.M.botSay(this.a, topic, vars, force); }

  update(dt) {
    const a = this.a, M = this.M, p = this.p;
    if (!a.alive) return;
    a.intent.face = null;
    this.sense -= dt;
    if (this.sense <= 0) { this.sense = this.p.react * (0.6 + R() * 0.8); this.perceive(); }
    this.chatCd -= dt; this.useT -= dt; this.jumpT -= dt;
    const K = M.killer, kd = this.kd;
    const seenAgo = M.time - this.k.t;
    // how close is too close depends on nerve (and on hp: hurt people are jumpier)
    const flee = 6 + (1 - p.nerve) * 14 + (a.hp < a.maxHp * 0.5 ? 4 : 0);
    this.chasedNow = this.chased();
    this.threat = (seenAgo < 2.5 && kd < flee) || this.chasedNow || (this.minion && a.dist(this.minion) < 6);
    a.chaseHeat = this.chasedNow ? Math.min(1, a.chaseHeat + dt * 2) : Math.max(0, a.chaseHeat - dt);

    // the AFK one stands there
    if (this.afkT > 0 && !(this.threat && kd < 5)) {
      this.afkT -= dt; a.intent.mx = a.intent.mz = 0; a.intent.sprint = false;
      if (this.afkT <= 0) { this.say('afk', {}, R() < 0.5); this.goal = null; }
      return;
    }

    // callouts: tell the others where the killer is
    if (this.k.seen && M.time - this.lastCall > 9 && R() < 0.15 + p.team * 0.4) {
      this.lastCall = M.time;
      M.callout(a, K);
      if (this.chatCd <= 0 && !this.chasedNow) { this.say('seeKiller', { place: placeName(M, K.x, K.z), gen: placeName(M, K.x, K.z).replace('gen ', ''), killer: K.def.name }); this.chatCd = 8 + R() * 8; }
    }
    if (this.chasedNow && M.time - this.saidChased > 14 && this.chatCd <= 0) { this.saidChased = M.time; this.say('chased', { place: placeName(M, a.x, a.z) }); this.chatCd = 6; M.askForHelp(a); }
    if (a.hp < a.maxHp * 0.5 && M.time - this.saidHurt > 30 && !this.threat && this.chatCd <= 0) { this.saidHurt = M.time; this.say('hurt'); this.chatCd = 8; }

    // abilities and items, with a reaction delay
    if (this.useT <= 0) { this.useT = 0.25 + p.react * 2 * (1.4 - p.skill); this.tryAbilities(); }

    // working: keep at it unless it is time to go
    if (a.busy && a.busy.kind === 'repair') {
      if (this.threat && (kd < flee * (p.style === 'rusher' ? 0.6 : 1) || this.chasedNow)) { M.stopRepair(a); this.goal = { kind: 'flee' }; }
      else { a.intent.mx = a.intent.mz = 0; return; }
    }
    if (a.busy && (a.busy.kind === 'medkit' || a.busy.kind === 'aim')) { a.intent.mx = a.intent.mz = 0; return; }

    this.think -= dt;
    if (this.think <= 0 || (this.threat && (!this.goal || this.goal.kind !== 'flee' && this.goal.kind !== 'help' && this.goal.kind !== 'troll'))) {
      this.think = 0.4 + R() * 0.5;
      this.decide();
    }
    this.act(dt);
  }

  decide() {
    const a = this.a, M = this.M, p = this.p, W = this.style.wants;
    if (this.threat && !(this.goal && this.goal.kind === 'troll' && this.kd > 3.5)) {
      // heroes may stand their ground to use a stun; trolls dance at a distance
      this.goal = { kind: 'flee' }; return;
    }
    if (this.goal && this.goal.kind === 'flee' && M.time - this.k.t < 4 && this.kd < 22) return;   // keep running a little after losing sight
    const opts = [];
    const c = this.ctx();
    // help a teammate in trouble
    if (c.allyChased && p.team > 0.55 && c.allyChased !== a) opts.push([{ kind: 'help', who: c.allyChased }, W.help * p.team * 1.5]);
    if (c.allyHurtNear && this.canHealOthers()) opts.push([{ kind: 'heal', who: c.allyHurtNear }, W.help * 1.4]);
    // a gen
    const gen = this.pickGen();
    if (gen) opts.push([{ kind: 'gen', gen }, W.gen + (M.timeLeft < 60 ? 2 : 0)]);
    // loot
    if (!a.item) { const it = this.nearestPickup(); if (it && a.dist(it) < 40) opts.push([{ kind: 'item', it }, W.item]); }
    if (W.hide) opts.push([{ kind: 'hide' }, W.hide]);
    if (W.follow) { const b = this.pickBuddy(); if (b) opts.push([{ kind: 'follow', who: b }, W.follow]); }
    if (W.troll && M.killer && M.killer.alive) opts.push([{ kind: 'troll' }, W.troll]);
    if (W.idle) opts.push([{ kind: 'idle', t: 4 + R() * 6 }, W.idle]);
    if (!opts.length) opts.push([{ kind: 'wander' }, 1]);
    // stick with what we are doing unless something is clearly better
    if (this.goal && this.goal.kind !== 'flee' && this.goal.kind !== 'wander' && R() < 0.82) {
      const still = this.goal.kind === 'gen' ? !this.goal.gen.done : this.goal.kind === 'item' ? !this.goal.it.taken : this.goal.kind === 'help' ? this.goal.who.alive && this.goal.who.chaseHeat > 0.2 : this.goal.kind === 'heal' ? this.goal.who.alive && this.goal.who.hp < this.goal.who.maxHp * 0.95 : true;
      if (still) return;
    }
    let tot = 0; for (const o of opts) tot += o[1];
    let x = R() * tot;
    for (const [g, w] of opts) { if ((x -= w) <= 0) { this.setGoal(g); return; } }
    this.setGoal(opts[0][0]);
  }
  setGoal(g) {
    const prev = this.goal; this.goal = g;
    if (g.kind === 'help' && (!prev || prev.kind !== 'help')) { this.say('helping', { name: g.who.name }); this.M.onBotHelping(this.a, g.who); }
    if (g.kind === 'hide') { const spots = this.M.world.hides.length ? this.M.world.hides : null; const s = spots ? R.pick(spots) : this.M.world.nav.randomPoint(R); g.x = s[0] + (R() - 0.5) * 2; g.z = s[1] + (R() - 0.5) * 2; g.t = 12 + R() * 20; }
    if (g.kind === 'wander' || g.kind === 'idle') { const s = this.M.world.nav.randomPoint(R, [this.a.x, this.a.z], 18); g.x = s[0]; g.z = s[1]; }
  }
  canHealOthers() { const ids = this.a.def.abilities.map((x) => x.id); return (ids.includes('firstaid') || ids.includes('supply') || ids.includes('shield')) || (this.a.item === 'medkit' && this.p.team > 0.75); }
  pickGen() {
    const a = this.a, M = this.M;
    let best = null, bs = 1e9;
    for (const g of M.gens) {
      if (g.done || g.blocked > 0) continue;
      let s = dist(a.x, a.z, g.x, g.z);
      if (M.time - this.k.t < 20) s += Math.max(0, 25 - dist(this.k.x, this.k.z, g.x, g.z)) * (1.5 - this.p.nerve);
      s -= g.progress * 4;                            // finish what has been started
      s += g.users.size * (this.p.team > 0.6 ? -2 : 5);
      if (g.users.size >= 3) s += 20;
      if (s < bs) { bs = s; best = g; }
    }
    return best;
  }
  nearestPickup() { let best = null, bd = 1e9; for (const it of this.M.pickups) { if (it.taken) continue; const d = this.a.dist(it); if (d < bd) { bd = d; best = it; } } return best; }
  pickBuddy() {
    const a = this.a, M = this.M;
    if (this.buddy && this.buddy.alive) return this.buddy;
    const cands = M.actors.filter((o) => o !== a && o.alive && o.role === 'survivor');
    if (!cands.length) return null;
    // the player first, if they are around: bots love following real people
    const pl = cands.find((o) => o.isPlayer);
    this.buddy = pl && R() < 0.6 ? pl : R.pick(cands);
    return this.buddy;
  }

  act(dt) {
    const a = this.a, M = this.M, g = this.goal, p = this.p, I = a.intent;
    if (!g) { I.mx = I.mz = 0; return; }
    const sprintFar = (d) => d > 18 && p.skill < 0.6 && a.stamina > a.maxStamina * 0.6;   // newer players sprint everywhere
    switch (g.kind) {
      case 'flee': return this.flee(dt);
      case 'gen': {
        if (g.gen.done) { this.goal = null; this.say('genDone', { gen: g.gen.index + 1 }); return; }
        if (!g.spot) { const spots = g.gen.spots(); g.spot = spots.find((s) => !M.actors.some((o) => o !== a && o.alive && dist(o.x, o.z, s[0], s[1]) < 0.6)) || spots[0]; }
        this.mv.to(g.spot[0], g.spot[1]);
        const left = this.mv.step(dt, 1, sprintFar(a.dist(g.gen)));
        if (left < 0.5) {
          a.intent.mx = a.intent.mz = 0;
          M.startRepair(a, g.gen);
          if (this.genSaid !== g.gen && this.chatCd <= 0 && R() < 0.4) { this.genSaid = g.gen; this.say('genStart', { gen: g.gen.index + 1 }); this.chatCd = 10; }
        }
        return;
      }
      case 'item': {
        if (g.it.taken) { this.goal = null; return; }
        this.mv.to(g.it.x, g.it.z);
        if (this.mv.step(dt, 1, sprintFar(a.dist(g.it))) < 1.0) { M.pickup(a, g.it); this.goal = null; }
        return;
      }
      case 'help': {
        const who = g.who, K = M.killer;
        if (!who.alive || !K) { this.goal = null; return; }
        // stand between the killer and them: a body block, and a stun if we have one
        const tx = K.alive && this.kd < 40 ? (who.x * 0.45 + K.x * 0.55) : who.x, tz = K.alive && this.kd < 40 ? (who.z * 0.45 + K.z * 0.55) : who.z;
        this.mv.to(tx, tz, { every: 0.5 });
        this.mv.step(dt, 1, a.dist(who) > 6);
        if (a.dist(who) < 3 && who.chaseHeat < 0.1) { this.goal = null; }
        return;
      }
      case 'heal': {
        const who = g.who;
        if (!who.alive || who.hp >= who.maxHp * 0.95) { this.goal = null; return; }
        this.mv.to(who.x, who.z, { every: 0.6 });
        if (this.mv.step(dt, 1, a.dist(who) > 10) < 2.4) {
          I.mx = I.mz = 0;
          if (a.item === 'medkit' && p.team > 0.75) { M.giveMedkit(a, who); this.goal = null; }
        }
        return;
      }
      case 'hide': {
        g.t -= dt;
        const left = (this.mv.to(g.x, g.z), this.mv.step(dt, 1, false));
        if (left < 0.6) { I.mx = I.mz = 0; if (a.def.abilities[0].id === 'hide' && !a.cd.hide && R() < 0.02) M.useAbility(a, 0); }
        if (g.t <= 0) this.goal = null;
        return;
      }
      case 'follow': {
        const who = g.who;
        if (!who.alive) { this.buddy = null; this.goal = null; return; }
        const d = a.dist(who);
        if (who.busy && who.busy.kind === 'repair' && who.busy.gen && !who.busy.gen.done) { this.goal = { kind: 'gen', gen: who.busy.gen }; return; }
        if (d > 4.5) { this.mv.to(who.x, who.z, { every: 0.8 }); this.mv.step(dt, 1, d > 10); } else { I.mx = I.mz = 0; if (R() < dt * 0.05) { a.view && a.view.once('wave'); } }
        return;
      }
      case 'troll': {
        const K = M.killer;
        if (!K || !K.alive) { this.goal = null; return; }
        const d = a.dist(K);
        if (d < 4.5) { this.flee(dt); return; }
        if (d > 9) { this.mv.to(K.x, K.z, { every: 0.8 }); this.mv.step(dt, 1, d > 20); }
        else {
          I.mx = I.mz = 0; I.face = Math.atan2(K.x - a.x, K.z - a.z);
          if (this.jumpT <= 0) { I.jump = R() < 0.5; this.jumpT = 0.6 + R(); }
          if (R() < dt * 0.3) { a.view && a.view.once(R() < 0.5 ? 'dance' : 'point'); }
          if (this.chatCd <= 0 && R() < 0.05) { this.say('trollTaunt'); this.chatCd = 7; }
        }
        return;
      }
      case 'idle': {
        g.t -= dt; I.mx = I.mz = 0;
        if (g.t <= 0) this.goal = null;
        return;
      }
      default: {
        this.mv.to(g.x, g.z);
        if (this.mv.step(dt, 0.8, false) < 1) this.goal = null;
      }
    }
  }

  /** Run: pick the escape that keeps the most distance and breaks sight, loop if we are good. */
  flee(dt) {
    const a = this.a, M = this.M, p = this.p, I = a.intent;
    const kx = this.k.x, kz = this.k.z;
    const kd = this.kd;
    this.fleeT -= dt;
    if (this.fleeT <= 0 || !this.fleeDir) {
      this.fleeT = 0.35 + (1 - p.skill) * 0.5;
      const nav = M.world.nav, col = M.world.collision;
      let best = null, bs = -1e9;
      const n = 14;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + R() * 0.3;
        for (const r of [5, 9]) {
          const x = a.x + Math.sin(ang) * r, z = a.z + Math.cos(ang) * r;
          if (!nav.walkable(x, z) || !nav.lineFree(a.x, a.z, x, z)) continue;
          let s = dist(x, z, kx, kz) * 1.2 - (kd < 3 ? 0 : 0);
          // running past the killer is suicide
          const toK = Math.atan2(kx - a.x, kz - a.z);
          if (Math.abs(angDiff(ang, toK)) < 0.9) s -= 12;
          if (!col.sightClear(x, z, kx, kz, 1.4)) s += 3 + p.skill * 5;               // break line of sight
          // open space vs dead ends
          let open = 0; for (let k = 0; k < 6; k++) { const b = k / 6 * Math.PI * 2; if (nav.walkable(x + Math.sin(b) * 2.5, z + Math.cos(b) * 2.5)) open++; }
          s += (open - 4) * 1.5;
          // loopers like to circle something solid
          if (p.skill > 0.55) { let near = 0; for (let k = 0; k < 4; k++) { const b = k / 4 * Math.PI * 2; if (!nav.walkable(x + Math.sin(b) * 1.6, z + Math.cos(b) * 1.6)) near++; } if (near && near < 3) s += p.skill * 4; }
          // keep going roughly the way we were (no dithering)
          if (this.fleeDir) s += Math.cos(angDiff(ang, this.fleeDir)) * 2.5;
          // good teammates lead the killer away from the others; bad ones toward them
          for (const o of M.actors) if (o !== a && o.alive && o.role === 'survivor' && dist(x, z, o.x, o.z) < 8) s += p.team > 0.5 ? -2 : (p.style === 'troll' || p.style === 'coward' ? 2.5 : 0);
          if (M.mapEdgeNear && M.mapEdgeNear(x, z)) s -= 6;
          s += R() * (2.5 - p.skill * 2);                                                 // panic
          if (s > bs) { bs = s; best = [x, z, ang]; }
        }
      }
      if (best) { this.fleeDir = best[2]; this.fleeTarget = best; }
      else { this.fleeDir = Math.atan2(a.x - kx, a.z - kz); this.fleeTarget = [a.x + Math.sin(this.fleeDir) * 6, a.z + Math.cos(this.fleeDir) * 6]; }
    }
    // stamina: good players walk while the killer is far, sprint when it counts
    const needSprint = kd < (p.skill > 0.6 ? 11 : 30) || this.chasedNow;
    this.mv.to(this.fleeTarget[0], this.fleeTarget[1], { direct: true });
    this.mv.step(dt, 1, needSprint);
    if (this.chasedNow && this.jumpT <= 0 && R() < 0.2 * (1 - p.skill)) { I.jump = true; this.jumpT = 1.5; }
    // safe again?
    if (M.time - this.k.t > 5 && kd > 20) { this.goal = null; }
  }

  tryAbilities() {
    const a = this.a, M = this.M, p = this.p;
    if (!a.canAct() || a.busy) return;
    const c = this.ctx();
    // a skilled player uses things at the right moment; a newbie mashes or forgets
    const willing = p.style === 'afk' ? 0.05 : 0.35 + p.skill * 0.6;
    for (let i = 0; i < a.def.abilities.length; i++) {
      const ab = a.def.abilities[i], A = ABILITIES[ab.id];
      if (!A || a.cd[ab.id] > 0) continue;
      c.aim = null;
      let want = false;
      try { want = A.ai(a, M, c); } catch { want = false; }
      if (!want && p.skill < 0.25 && R() < 0.01) want = true;            // mashing buttons
      if (want && R() < willing) { M.useAbility(a, i, c.aim || undefined); return; }
    }
    if (a.item) { const it = ITEMS[a.item]; if (it && it.ai(a, M, c) && R() < willing + 0.2) M.useItem(a); }
  }
  /** Something happened that this bot might react to. */
  onEvent(ev, d) {
    const a = this.a, M = this.M, p = this.p;
    if (!a.alive && ev !== 'lms' && ev !== 'end') return;
    switch (ev) {
      case 'callout': if (d.from !== a) this.learnKiller(d.x, d.z, M.time - 0.8 - (1 - p.skill), false); break;
      case 'askHelp': if (d.from !== a && p.team > 0.6 && a.alive && !this.threat && a.dist(d.from) < 35 && R() < p.team) { this.goal = { kind: 'help', who: d.from }; this.say('helping', { name: d.from.name }); M.onBotHelping(a, d.from); } break;
      case 'stunned': if (d.by === a && R() < 0.6) this.say('stunned'); break;
      case 'ping': if (d.kind === 'killer') this.learnKiller(d.x, d.z, M.time - 0.5, false); break;
    }
  }
}

/* ================= KILLERS ================= */
export class KillerBrain {
  constructor(a, M) {
    this.a = a; this.M = M; this.p = a.member ? a.member.persona : { skill: 0.6, react: 0.25, chat: 0.4, toxic: 0.3, killerStyle: 'hunter', typing: 'lower' };
    this.ks = KILLER_STYLES[this.p.killerStyle] || KILLER_STYLES.hunter;
    this.mv = new Mover(a, M);
    this.target = null; this.last = new Map();      // survivor -> { x, z, t }
    this.sense = 0; this.think = 0; this.useT = 2; this.swingWait = 0;
    this.patrol = null; this.searchT = 0;
    this.chatCd = 6 + R() * 6;
    this.spare = new Set();
    this.tSeen = false;
  }
  say(topic, vars = {}, force) { this.M.botSay(this.a, topic, vars, force); }
  perceive() {
    const a = this.a, M = this.M;
    this.visible = [];
    for (const s of M.actors) {
      if (s.role !== 'survivor' || !s.alive) continue;
      const d = a.dist(s);
      if (d < 36 && M.canSee(a, s, true) && !a.fx.has('blind')) {
        // the killer looks around too, but sees best what is in front
        if (a.angleTo(s) < 1.6 || d < 10 || R() < 0.3 + this.p.skill * 0.4) { this.visible.push(s); this.last.set(s, { x: s.x, z: s.z, t: M.time, vx: s.vx, vz: s.vz }); }
      } else if (d < 16 && s.noise > 0.3 && !s.fx.has('hidden')) {
        // footsteps and panting
        this.last.set(s, { x: s.x + (R() - 0.5) * 3, z: s.z + (R() - 0.5) * 3, t: M.time - 1, vx: 0, vz: 0 });
      }
      if (M.revealedTo(s, 'killer')) this.last.set(s, { x: s.x, z: s.z, t: M.time, vx: s.vx, vz: s.vz });
    }
  }
  pickTarget() {
    const a = this.a, M = this.M, ks = this.ks;
    let best = null, bs = 1e9;
    for (const s of this.visible) {
      if (this.spare.has(s)) continue;
      let sc = a.dist(s);
      sc -= (1 - s.hp / s.maxHp) * 8 * ks.tunnel;
      if (s === this.target) sc -= 6 + ks.tunnel * 10;               // hysteresis: keep chasing
      if (s.busy && s.busy.kind === 'repair') sc -= 4 * ks.patrol;
      if (s.isPlayer) sc -= 1.5;                                        // people are more fun to chase
      if (sc < bs) { bs = sc; best = s; }
    }
    if (!best && this.target && this.target.alive) {
      const L = this.last.get(this.target);
      if (L && M.time - L.t < 6 + ks.tunnel * 6) return this.target;   // still on their trail
    }
    return best;
  }
  ctx() {
    const a = this.a, t = this.target;
    const c = { target: t, td: t ? a.dist(t) : Infinity, tSeen: this.tSeen };
    if (t) { c.tAngle = a.angleTo(t); c.targetHasStun = t.def.abilities.some((x) => ['block', 'grenade', 'shieldbash', 'push', 'sidearm', 'flashlight'].includes(x.id) && !(t.cd[x.id] > 0)); c.targetStuck = t.fx.has('root') || t.fx.has('lifted') || t.fx.has('stun') || (t.busy && t.busy.kind === 'repair'); }
    return c;
  }
  update(dt) {
    const a = this.a, M = this.M, I = a.intent, p = this.p;
    if (!a.alive) return;
    I.face = null; I.jump = false;
    this.sense -= dt; this.think -= dt; this.useT -= dt; this.chatCd -= dt;
    if (this.sense <= 0) { this.sense = p.react * (0.7 + R() * 0.6); this.perceive(); }
    if (this.think <= 0) {
      this.think = 0.3 + R() * 0.3;
      const nt = this.pickTarget();
      if (nt && nt !== this.target) { this.target = nt; if (this.chatCd <= 0 && R() < this.ks.taunt) { this.say('taunt'); this.chatCd = 10; } if (R() < this.ks.taunt * 0.2 && a.def.id === 'terrible') M.sfx('laugh', a, { pitch: 0.7 }); }
      if (!nt && this.target && !this.target.alive) this.target = null;
      if (nt === null && this.target && M.time - (this.last.get(this.target) || { t: -99 }).t > 8) this.target = null;
    }
    if (a.busy && a.busy.lock) { I.mx = I.mz = 0; return; }
    const t = this.target;
    this.tSeen = !!(t && this.visible && this.visible.includes(t));
    if (this.useT <= 0) { this.useT = 0.35 + p.react * 1.5; this.tryAbilities(); }
    if (t && t.alive) {
      const L = this.last.get(t) || { x: t.x, z: t.z, t: M.time, vx: 0, vz: 0 };
      let tx = L.x, tz = L.z;
      const d = a.dist(t);
      if (this.tSeen) {
        // aim a little ahead of where they run; better killers lead more (and cut corners)
        const lead = clamp(d / 6.5, 0, 1.2) * (0.3 + p.skill * 0.7);
        tx = t.x + t.vx * lead; tz = t.z + t.vz * lead;
        if (!M.world.nav.walkable(tx, tz)) { tx = t.x; tz = t.z; }
      }
      const direct = this.tSeen && M.world.nav.lineFree(a.x, a.z, tx, tz);
      this.mv.to(tx, tz, { direct, every: 0.45 });
      const left = this.mv.step(dt, 1, d < 22 || !this.tSeen);
      if (this.tSeen && d < 4) I.face = Math.atan2(t.x - a.x, t.z - a.z);
      // the swing
      const range = a.def.m1.range;
      if (this.tSeen && d < range + 0.25 && a.attackCd <= 0 && !a.fx.has('stun')) {
        this.swingWait += dt;
        const ang = a.angleTo(t);
        if (this.swingWait > p.react * (1.2 - p.skill * 0.6) && ang < 0.7) { this.swingWait = 0; M.attack(a); }
      } else if (this.tSeen && d < range + 1.4 && a.attackCd <= 0 && R() < dt * (1 - p.skill) * 2) { M.attack(a); }   // early swings: a classic whiff
      else this.swingWait = 0;
      // lost them: go to the last place, then look around
      if (!this.tSeen && left < 1.2 && M.time - L.t > 1) { this.searchT = 4 + this.ks.tunnel * 4; this.searchAt = [L.x, L.z]; this.target = null; }
      if (this.friendlyCheck(t)) this.target = null;
      return;
    }
    // no target: search, then patrol gens
    if (this.searchT > 0) {
      this.searchT -= dt;
      if (!this.search || this.mv.step(dt, 0.9, false) < 0.8) { const s = M.world.nav.randomPoint(R, this.searchAt, 9); this.search = s; this.mv.to(s[0], s[1]); }
      this.mv.step(dt, 0.9, false);
      return;
    }
    if (!this.patrol || this.mv.step(dt, 1, false) < 1.2) this.patrol = this.pickPatrol();
    this.mv.to(this.patrol[0], this.patrol[1], { every: 2 });
    this.mv.step(dt, 1, this.patrolSprint);
  }
  pickPatrol() {
    const a = this.a, M = this.M;
    // a gen being worked on is loud
    let best = null, bs = -1e9;
    for (const g of M.gens) {
      if (g.done) continue;
      let s = g.noise * 30 + g.progress * 4 * this.ks.patrol - a.dist(g) * 0.25 + R() * 6;
      if (g.users.size && a.dist(g) < 40) s += 12 * this.ks.patrol;
      if (s > bs) { bs = s; best = g; }
    }
    // recent sightings
    for (const [s, L] of this.last) if (s.alive && M.time - L.t < 20) { const sc = 18 - (M.time - L.t) - dist(a.x, a.z, L.x, L.z) * 0.2 + this.ks.tunnel * 6; if (sc > bs) { bs = sc; best = { x: L.x, z: L.z }; } }
    this.patrolSprint = R() < 0.4;
    if (!best || R() < 0.15) return M.world.nav.randomPoint(R);
    const [x, z] = M.world.nav.nearestWalkable(best.x + (R() - 0.5) * 4, best.z + (R() - 0.5) * 4, 4);
    return [x, z];
  }
  /** The friendly killer lets a dancing or emoting survivor go, once. */
  friendlyCheck(t) {
    if (this.ks.mercy <= 0) return false;
    if (t.view && ['dance', 'wave', 'cheer'].includes(t.view.oneShot && t.view.oneShot.getClip().name.toLowerCase()) && R() < this.ks.mercy) {
      this.spare.add(t); this.M.later(20, () => this.spare.delete(t));
      this.say('taunt', {}, true);
      return true;
    }
    return false;
  }
  tryAbilities() {
    const a = this.a, M = this.M;
    if (!a.canAct()) return;
    const c = this.ctx();
    for (let i = 0; i < a.def.abilities.length; i++) {
      const ab = a.def.abilities[i], A = ABILITIES[ab.id];
      if (!A || a.cd[ab.id] > 0) continue;
      c.aim = null;
      let want = false;
      try { want = A.ai(a, M, c); } catch { want = false; }
      if (want && R() < 0.4 + this.p.skill * 0.5) {
        // aim error: the less skilled, the wider
        if (c.aim && c.aim.target && this.p.skill < 0.9) c.aim.err = (R() - 0.5) * (1 - this.p.skill) * 0.4;
        M.useAbility(a, i, c.aim || undefined);
        return;
      }
    }
  }
  onEvent(ev, d) {
    const M = this.M;
    if (ev === 'genNoise' && this.a.dist(d.gen) < 60 && !this.target) { this.patrol = [d.gen.x + (R() - 0.5) * 3, d.gen.z + (R() - 0.5) * 3]; }
    if (ev === 'stunned' && d.who === this.a && this.chatCd <= 0 && R() < this.p.toxic) { this.say('reply_noob', { name: d.by.name }); this.chatCd = 10; }
    void M;
  }
}

/* ================= MINIONS (Bacon Soldiers) ================= */
export class MinionBrain extends KillerBrain {
  constructor(a, M) { super(a, M); this.p = { skill: 0.35, react: 0.4, chat: 0, toxic: 0, killerStyle: 'hunter', typing: 'lower' }; this.ks = KILLER_STYLES.hunter; }
  say() {}
  tryAbilities() {}
}

/* ================= THE LOBBY ================= */
export class LobbyBrain {
  constructor(a, L) {
    this.a = a; this.L = L; this.p = a.member.persona;
    this.mv = new Mover(a, L);
    this.t = R() * 3; this.goal = null;
    this.afk = this.p.style === 'afk' && R() < 0.7;
  }
  update(dt) {
    const a = this.a, L = this.L, I = a.intent;
    I.face = null;
    if (this.afk) { I.mx = I.mz = 0; return; }
    this.t -= dt;
    if (this.t <= 0 || !this.goal) {
      this.t = 4 + R() * 10;
      const r = R();
      const spots = L.spots;
      if (r < 0.35) this.goal = { kind: 'go', p: R.pick(spots.fire) };
      else if (r < 0.55) { const o = R.pick(L.actors.filter((x) => x !== a)); this.goal = o ? { kind: 'near', who: o } : null; }
      else if (r < 0.7) this.goal = { kind: 'go', p: L.world.nav.randomPoint(R, [0, 0], 14) };
      else if (r < 0.8) this.goal = { kind: 'emote', name: R.pick(['dance', 'wave', 'cheer', 'point']) };
      else if (r < 0.88 && this.p.style === 'troll') this.goal = { kind: 'jumpy' };
      else this.goal = { kind: 'stand' };
    }
    const g = this.goal;
    if (!g) { I.mx = I.mz = 0; return; }
    if (g.kind === 'go') { this.mv.to(g.p[0], g.p[1]); if (this.mv.step(dt, 0.75, false) < 0.6) { this.goal = { kind: 'stand', face: Math.atan2(-a.x, -a.z) }; } }
    else if (g.kind === 'near') { if (!g.who.alive) { this.goal = null; return; } const d = a.dist(g.who); if (d > 2.6) { this.mv.to(g.who.x, g.who.z, { every: 1 }); this.mv.step(dt, 0.8, d > 12); } else { I.mx = I.mz = 0; I.face = Math.atan2(g.who.x - a.x, g.who.z - a.z); } }
    else if (g.kind === 'emote') { I.mx = I.mz = 0; a.view && a.view.once(g.name); this.goal = { kind: 'stand' }; }
    else if (g.kind === 'jumpy') { I.mx = Math.sin(L.time * 2 + a.uid) * 0.6; I.mz = Math.cos(L.time * 2 + a.uid) * 0.6; I.sprint = true; if (R() < dt * 2) I.jump = true; }
    else { I.mx = I.mz = 0; if (g.face !== undefined) I.face = g.face; }
  }
}

export { placeName, Mover, enemies };
