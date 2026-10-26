/*
 * A round. One killer against the survivors on one map, until the timer runs out or nobody is
 * left. Generators shorten the timer; the last survivor gets an LMS that lasts exactly one song.
 *
 * What makes FORLORN its own game, on top of the Forsaken formula:
 *   Bond      survivors who stick together bond: faster repairs, and grief speed if one falls
 *   Echoes    the dead linger: once a round each echo can reveal the killer to the living
 *   Bloodlust the killer's meter fills on hits and chases; full, it boils over into a Frenzy
 *   Events    every map has a mid-round event from its film (an airstrike, a blackout, ...)
 */
import * as THREE from 'three';
import { buildWorld } from '../world/world.js';
import { makeCharacter } from '../render/characters.js';
import { Actor } from './actor.js';
import { Effects } from './effects.js';
import { Generator, Pickup, PARTS } from './props.js';
import { ABILITIES, ITEMS, swing } from './abilities.js';
import { SurvivorBrain, KillerBrain, MinionBrain, placeName } from './brain.js';
import { Curfew } from './curfew.js';
import { say } from '../data/bots.js';
import { lmsTrackFor, music } from '../audio/music.js';
import { audio } from '../audio/audio.js';
import { isReady } from '../data/characters.js';
import { settings } from '../core/save.js';
import { bus } from '../core/events.js';
import { R, clamp, dist, damp } from '../core/util.js';

const ROUND_TIME = 225, GEN_CUT = 20, BOND_TIME = 35;

export class Match {
  constructor(game, def, roster) {
    this.game = game; this.def = def; this.roster = roster;
    this.actors = []; this.survivors = []; this.killer = null; this.player = null;
    this.gens = []; this.pickups = [];
    this.phase = 'loading'; this.time = 0; this.timeLeft = def.time || ROUND_TIME;
    this.timers = [];
    this.lms = null; this.winner = null;
    this.bloodlust = 0;
    this.echoes = new Map();          // dead survivor -> { used }
    this.eventDone = false;
    this.lastChat = 0;
    this.log = [];
  }

  /* ---------------- loading ---------------- */
  async load(onProgress = () => {}) {
    const g = this.game;
    onProgress(0.05, 'Building ' + this.def.name);
    await new Promise((r) => setTimeout(r, 20));
    const world = this.world = buildWorld(g.renderer, this.def, (R() * 1e6) | 0);
    world.match = this;
    this.scene = world.scene;
    this.fx = new Effects(world, this);
    this.landmarks = (this.def.landmarks || []).map(([name, x, z]) => ({ name, x, z }));
    onProgress(0.3, 'Placing generators');
    world.gens.forEach(([x, z, ry], i) => {
      this.gens.push(new Generator(this.scene, x, z, ry || 0, i));
      // a generator is solid: you run round it, not through it
      const c = { type: 'box', x, z, hw: 0.85, hd: 0.5, ry: ry || 0, y0: 0, y1: 1.3, sight: false };
      world.collision.add(c); world.nav.stamp(c, 1);
    });
    // items: a few of the spots, medkits more often than colas
    const spots = R.shuffle(world.items.slice());
    spots.slice(0, Math.min(spots.length, 4 + Math.floor(R() * 3))).forEach(([x, z]) => this.pickups.push(new Pickup(this.scene, x + (R() - 0.5), z + (R() - 0.5), R() < 0.6 ? 'medkit' : 'cola')));
    onProgress(0.4, 'Waking the cast');
    let done = 0;
    const views = await Promise.all(this.roster.map(async (r) => { const v = await makeCharacter(r.charId, r.skin); done++; onProgress(0.4 + 0.5 * done / this.roster.length, 'Waking the cast'); return v; }));
    const sSpawns = R.shuffle(world.spawns.survivor.slice()), kSpawn = R.pick(world.spawns.killer);
    this.roster.forEach((r, i) => {
      const a = new Actor(world, { name: r.member.name, charId: r.charId, skin: r.skin, role: r.role, isPlayer: !r.member.bot, member: r.member });
      a.setView(views[i]);
      if (r.role === 'killer') {
        a.place(kSpawn[0], kSpawn[1], Math.atan2(-kSpawn[0], -kSpawn[1]));
        this.killer = a;
      } else {
        const s = sSpawns[i % sSpawns.length];
        a.place(s[0] + (R() - 0.5) * 0.6, s[1] + (R() - 0.5) * 0.6, Math.atan2(-s[0], -s[1]) + (R() - 0.5));
        this.survivors.push(a);
      }
      if (a.isPlayer) this.player = a;
      else a.brain = r.role === 'killer' ? new KillerBrain(a, this) : new SurvivorBrain(a, this);
      this.actors.push(a);
    });
    for (const a of this.actors) a.view.rim(a.role === 'killer' ? 0x8a2a30 : 0x5a6f9a);
    onProgress(0.95, 'Ready');
    // compile shaders before the first frame is shown
    try { g.renderer.gl.compile(this.scene, g.renderer.camera); } catch { /* fine */ }
    this.phase = 'intro';
    music.prepare(lmsTrackFor(this.survivors[0] ? this.survivors[0].charId : 'guest1337', this.killer.charId));
    return this;
  }

  /* ---------------- queries ---------------- */
  survivorsAlive() { return this.survivors.filter((s) => s.alive && !s.left); }
  canSee(a, b, strict = false) {
    if (!b.alive || b.left) return false;
    if (!b.isVisibleTo(a)) return false;
    if (strict && a.fx.has('blind')) return false;
    const d = a.dist(b); if (d > 42) return false;
    if (!this.world.collision.sightClear(a.x, a.z, b.x, b.z, 1.5)) return false;
    if (a.role === 'killer' && this.fx.smokeBetween(a.x, a.z, b.x, b.z)) return false;
    return true;
  }
  revealedTo(a, team) { return a.fx.has('rev_' + team); }
  reveal(a, t, team) { a.fx.add('rev_' + team, t); }
  nearGen(a, r) { return this.gens.some((g) => !g.done && a.dist(g) < r); }
  mapEdgeNear(x, z) { const b = this.world.bounds; return x - b.minX < 3 || b.maxX - x < 3 || z - b.minZ < 3 || b.maxZ - z < 3; }
  later(t, fn) { this.timers.push({ t, fn }); }

  /* ---------------- talk ---------------- */
  sfx(name, pos, opts = {}) { audio.sfx(name, Object.assign({ pos: pos && pos.x !== undefined ? pos : null }, opts)); }
  feed(text, kind = 'bad') { bus.emit('feed', { text, kind }); this.log.push(text); }
  denied(a, why) { if (a.isPlayer) { bus.emit('toast', why); audio.sfx('deny'); } }
  botSay(a, topic, vars = {}, force = false) {
    if (!a.member || !a.member.bot || a.left) return;
    if (!settings.botChat) return;
    if (this.time - this.lastChat < 0.7 && !force) return;
    const text = say(a.member, topic, Object.assign({ name: this.player ? this.player.name : '', killer: this.killer ? this.killer.def.name : '', kname: this.killer ? this.killer.name : '' }, vars), force);
    if (!text) return;
    this.lastChat = this.time;
    // they take a moment to type it, and most people stop to type
    const typing = 0.4 + text.length * 0.05 * (1.2 - a.member.persona.skill * 0.4);
    if (a.brain && a.brain.p && a.brain.p.skill < 0.8) a.brain.typingT = typing;
    this.later(typing, () => { if (!a.left) this.game.chat.post(a.member, text, a); });
  }
  /** Every bot in the round hears about something. */
  tell(ev, d) { for (const a of this.actors) if (a.brain && a.brain.onEvent) { try { a.brain.onEvent(ev, d); } catch (e) { console.error('[brain event]', ev, e); } } }
  callout(from, K) {
    this.tell('callout', { from, x: K.x, z: K.z });
    if (this.player && this.player.role === 'survivor' && this.player !== from && this.player.alive) bus.emit('ping', { x: K.x, z: K.z, kind: 'killer', label: from.name + ': killer', t: 3.5 });
  }
  askForHelp(from) { this.tell('askHelp', { from }); }
  onBotHelping(bot, who) { if (who.isPlayer) bus.emit('ping', { x: bot.x, z: bot.z, kind: 'ally', label: bot.name + ' is coming', t: 3, follow: bot }); }
  onHelped(by, who, verb) {
    if (who.isPlayer) bus.emit('toast', by.name + ' ' + verb + ' you');
    if (who.brain && R() < 0.6) this.botSay(who, 'thanksHeal', { name: by.name });
    by.stats.saves++;
  }
  giveMedkit(bot, who) {
    if (bot.item !== 'medkit') return;
    bot.item = null; who.heal(40, bot);
    this.sfx('heal', who); this.fx.burst(who.x, 1, who.z, 0x7dff9a, 24, 2, 0.8);
    this.feed(bot.name + ' gave ' + who.name + ' their medkit', 'good');
    this.onHelped(bot, who, 'gave a medkit to');
  }

  /* ---------------- actions (player and bots alike) ---------------- */
  useAbility(a, i, aim) {
    const ab = a.def.abilities[i]; if (!ab) return false;
    if ((a.cd[ab.id] || 0) > 0 || !a.canAct() || this.phase === 'intro' || this.phase === 'end') return false;
    const A = ABILITIES[ab.id]; if (!A) return false;
    if (a.role === 'killer' && a.fx.has('invis') && ab.id !== 'vanish') a.fx.remove('invis');
    const ok = A.cast(a, this, aim || {});
    if (ok === false) return false;
    a.cd[ab.id] = ab.cd;
    bus.emit('ability', { actor: a, id: ab.id });
    return true;
  }
  useItem(a) {
    if (!a.item || !a.canAct()) return false;
    const it = ITEMS[a.item]; if (!it) return false;
    const r = it.use(a, this);
    if (r === false) return false;
    if (r !== 'keep') a.item = null;
    return true;
  }
  attack(a) {
    if (a.attackCd > 0 || !a.canAct() || this.phase === 'intro' || this.phase === 'end') return false;
    if (a.fx.has('invis')) a.fx.remove('invis');
    const m1 = a.role === 'minion' ? { dmg: 10, cd: 1.6, range: 2.3 } : a.def.m1;
    a.attackCd = m1.cd * (a.fx.has('frenzy') ? 0.7 : 1);
    swing(a, this, { range: m1.range, dmg: m1.dmg, anim: a.def.id === 'eliteguard' ? 'slash' : 'attack', windup: 0.2 });
    return true;
  }
  startRepair(a, gen) {
    if (gen.done || gen.blocked > 0 || !a.canAct()) return false;
    if (a.busy && a.busy.kind === 'repair' && a.busy.gen === gen) return true;
    a.startBusy('repair', { anim: 'repair', cancelOnMove: true, gen, onCancel: () => gen.users.delete(a) });
    gen.users.add(a);
    a.yaw = gen.faceFrom(a.x, a.z);
    return true;
  }
  stopRepair(a) { if (a.busy && a.busy.kind === 'repair') a.cancelBusy(); }
  /** A part of a generator done: by the player's puzzle, or a bot's work adding up. */
  genPart(a, gen, amount = 1) {
    const r = gen.addProgress(amount);
    if (!r) return r;
    gen.noise = 1;
    this.tell('genNoise', { gen });
    if (r === 'part') { this.sfx('gen_part', gen, { range: 30 }); }
    if (r === 'done') this.genDone(gen);
    return r;
  }
  genDone(gen) {
    this.sfx('gen_done', gen, { range: 80, vol: 1 });
    audio.sfx('gen_done', { vol: 0.25 });
    this.fx.burst(gen.x, 1.4, gen.z, 0x3dff6a, 40, 4, 1);
    this.fx.flash(gen.x, 2, gen.z, 0x3dff6a, 14, 0.8);
    for (const u of [...gen.users]) { u.stats.gens++; if (u.busy && u.busy.gen === gen) { u.cancelBusy(); } }
    gen.users.clear();
    if (this.phase === 'play') this.timeLeft = Math.max(10, this.timeLeft - GEN_CUT);
    const left = this.gens.filter((g) => !g.done).length;
    this.feed('Generator ' + (gen.index + 1) + ' is running' + (left ? ' (' + left + ' left)' : ': every generator is up'), 'good');
    bus.emit('gen', { gen, left });
    if (!left) for (const s of this.survivorsAlive()) if (s.brain) { this.botSay(s, 'genAllDone'); break; }
  }
  genMistake(a, gen) {
    gen.noise = 1.5;
    this.sfx('gen_bad', gen, { range: 60 });
    this.fx.burst(gen.x, 1, gen.z + 0.4, 0xffd060, 18, 3, 0.4);
    this.tell('genNoise', { gen });
    if (this.killer && this.killer.isPlayer) bus.emit('ping', { x: gen.x, z: gen.z, kind: 'gen', label: 'Noise', t: 3 });
    gen.addProgress(-0.25);
    gen.progress = Math.max(0, gen.progress);
  }
  pickup(a, it) {
    if (it.taken || a.item || a.dist(it) > 2.2) return false;
    it.take(); a.item = it.kind;
    this.sfx('pickup', a, { vol: 0.7 });
    if (a.brain && R() < 0.25) this.botSay(a, 'item');
    return true;
  }
  /** A blast: survivors hurt, the killer stunned, everyone shoved. */
  explode(x, z, r, by, o = {}) {
    this.sfx('boom', { x, z }, { range: 70 });
    this.fx.burst(x, 0.6, z, o.color || 0xff9a40, 60, 7, 0.9, 2);
    this.fx.burst(x, 0.4, z, 0x444444, 30, 3, 1.4, 1);
    this.fx.flash(x, 1.5, z, o.color || 0xff9a40, 20, 0.5, 18);
    this.fx.ring(x, z, r, o.color || 0xffb060, 0.5);
    for (const a of this.actors) {
      if (!a.alive) continue;
      const d = dist(a.x, a.z, x, z); if (d > r) continue;
      if (!this.world.collision.sightClear(x, z, a.x, a.z, 0.8)) continue;
      const k = 1 - d / r, dx = (a.x - x) / (d || 1), dz = (a.z - z) / (d || 1);
      const isK = a.role === 'killer' || a.role === 'minion';
      if (isK) {
        if (o.stun && by && by.role === 'survivor' && a.stun(o.stun, by)) this.feed(by.name + ' blew up ' + a.name, 'good');
        if (o.dmgKiller) a.damage(o.dmgKiller * k, by, 'blast');
        if (a.role === 'minion' && by && by.role === 'survivor') a.damage(50, by, 'blast');
      } else if (o.dmg) a.damage(o.dmg * (0.5 + 0.5 * k), by, 'blast');
      a.shove(dx * (o.knock || 6) * k, dz * (o.knock || 6) * k, 0.25);
    }
    this.shakeNear({ x, z }, 0.5);
  }
  shakeNear(p, a) { const c = this.game.camRig, P = this.game.focusActor(); if (!P) return; const d = dist(P.x, P.z, p.x, p.z); if (d < 25) c.shake(a * (1 - d / 25), 0.35); }

  /* ---------------- hooks from actors ---------------- */
  beforeDamage(t, amount, src, kind) {
    if (this.phase === 'end' || this.phase === 'intro') return false;
    const melee = kind === 'm1' || kind === 'slash' || kind === 'execute';
    if (t.fx.has('blocking') && src && (src.role === 'killer' || src.role === 'minion') && (melee || src.dist(t) < 4)) {
      t.fx.remove('blocking');
      this.sfx('block', t); this.fx.burst(t.x, 1.3, t.z, 0xfff2a0, 26, 4, 0.5);
      if (src.stun(2, t)) this.feed(t.name + ' blocked ' + src.name, 'good');
      this.tell('stunned', { by: t, who: src });
      return false;
    }
    if (t.fx.has('astral')) { t.fx.remove('astral'); this.sfx('block', t); this.fx.burst(t.x, 1.2, t.z, 0x46e0ff, 30, 3, 0.6); return false; }
    if (t.role === 'killer' && src && src.role === 'survivor') return false;   // survivors stun, they do not kill
    return amount;
  }
  beforeStun(t, time, src) {
    if (t.fx.has('parry') && src && src.alive) {
      t.fx.remove('parry');
      src.damage(20, t, 'parry'); src.stun(1, t);
      this.sfx('block', t); this.fx.burst(t.x, 1.3, t.z, 0xff4040, 26, 4, 0.5);
      this.feed(t.name + ' parried ' + src.name, 'bad');
      return false;
    }
    return true;
  }
  onStun(t, time, src) {
    if (t.role === 'killer') { this.bloodlust = Math.min(100, this.bloodlust + 8); this.tell('stunned', { by: src, who: t }); }
    if (t.isPlayer || (src && src.isPlayer)) { this.game.input.rumble(0.7, 0.4, 200); }
    if (t.brain && t.brain.mv) t.brain.mv.clear();
  }
  onMeleeHit(k, s, dmg) {
    this.sfx('hit', s, { pitch: 0.9 + R() * 0.2 });
    this.fx.burst(s.x, 1.25, s.z, 0xd01818, 22, 3.5, 0.6, 1);
    k.fx.add('slow', 1.25, 0.45);                     // the killer winds down after a hit...
    if (s.alive) s.fx.add('haste', 1.5, 0.35);        // ...and the survivor bolts
    if (k.role === 'killer') this.bloodlust = Math.min(100, this.bloodlust + 14);
    if (k.fx.has('interrogate')) { k.fx.remove('interrogate'); for (const o of this.survivorsAlive()) this.reveal(o, 6, 'killer'); this.feed(k.name + ' made ' + s.name + ' talk: everyone revealed', 'bad'); }
    if (s.isPlayer) { this.game.camRig.shake(0.35, 0.3); this.game.input.rumble(1, 0.6, 260); bus.emit('hurt', { dmg }); }
    if (k.isPlayer) { this.game.camRig.shake(0.15, 0.15); this.game.input.rumble(0.5, 0.8, 120); }
  }
  onWhiff(k) { k.fx.add('slow', 0.5, 0.25); }
  onDamaged(t, dmg, src, kind) {
    void kind;
    if (t.role === 'survivor' && t.alive && t.brain && t.hp < t.maxHp * 0.35 && t.member.persona.toxic > 0.75 && R() < 0.03) this.rageQuit(t);
    void src; void dmg;
  }
  onDeath(a, src, kind) {
    this.sfx('oof', a, { range: 40, pitch: 0.95 + R() * 0.1 });
    if (a.role === 'minion') { this.fx.burst(a.x, 1, a.z, 0x3d74c9, 30, 3, 0.7); this.later(1.5, () => this.removeActor(a)); return; }
    if (a.role !== 'survivor') return;
    this.sfx('death', a, { range: 60, vol: 0.6 });
    this.fx.burst(a.x, 1, a.z, 0xd01818, 40, 3, 1);
    const how = kind === 'burn' ? ' burned ' : kind === 'lightning' ? ' struck down ' : kind === 'shot' ? ' shot ' : kind === 'blast' ? ' blew up ' : ' killed ';
    this.feed((src && src !== a ? src.name + how : '') + a.name + (src && src !== a ? '' : ' died'), 'bad');
    this.echoes.set(a, { used: false, at: this.time });
    bus.emit('death', { actor: a, by: src });
    if (a.brain) {
      this.later(1 + R() * 2, () => this.botSay(a, 'died', {}, R() < 0.5));
      if (a.member.persona.toxic > 0.6 && R() < 0.35) this.later(4 + R() * 6, () => this.rageQuit(a));
    }
    // the others react; the bonded one grieves
    for (const o of this.survivorsAlive()) {
      if ((a.bond[o.uid] || 0) >= 1) { o.fx.add('haste', 4, 0.3); this.feed(o.name + ' lost their bond with ' + a.name, 'info'); }
      if (o.brain && R() < 0.35) this.later(1.5 + R() * 3, () => this.botSay(o, 'allyDied', { name: a.name }));
    }
    if (this.killer && this.killer.brain && R() < 0.3) this.later(1, () => this.botSay(this.killer, 'taunt'));
    this.checkLms();
  }
  rageQuit(a) {
    if (a.left) return;
    this.botSay(a, 'rage', {}, true);
    this.later(1.2, () => {
      a.left = true;
      if (a.alive) { a.alive = false; this.feed(a.name + ' left the game', 'info'); this.checkLms(); }
      a.member.leaving = true;
      this.game.chat.system(a.name + ' left the game', 'leave');
      audio.sfx('leave', { vol: 0.6 });
      if (a.view) a.view.setVisible(false);
      for (const g of this.gens) g.users.delete(a);
    });
  }
  removeActor(a) { a.dispose(); this.actors = this.actors.filter((x) => x !== a); }

  /** Bacon Soldiers: needs their model; returns false if it is not ready yet. */
  spawnMinions(owner, n, life) {
    if (!isReady('baconsoldier')) return false;
    for (let i = 0; i < n; i++) {
      makeCharacter('baconsoldier').then((v) => {
        if (this.phase === 'end') { v.dispose(); return; }
        const a = new Actor(this.world, { name: 'Bacon Soldier', charId: 'baconsoldier', role: 'minion', hp: 60 });
        a.def = { id: 'baconsoldier', name: 'Bacon Soldier', abilities: [], m1: { dmg: 10, cd: 1.6, range: 2.3 }, speed: 0.92 };
        a.maxHp = a.hp = 60;
        a.setView(v); v.rim(0x3d74c9);
        const [x, z] = this.world.nav.nearestWalkable(owner.x + (i ? 2 : -2), owner.z - 1.5, 4);
        a.place(x, z, owner.yaw);
        a.brain = new MinionBrain(a, this);
        this.actors.push(a);
        this.fx.burst(x, 1, z, 0x3d74c9, 30, 3, 0.7);
        this.later(life, () => { if (a.alive) { a.alive = false; this.fx.burst(a.x, 1, a.z, 0x3d74c9, 30, 3, 0.7); this.removeActor(a); } });
      });
    }
    this.feed(owner.name + ' called in reinforcements', 'bad');
    return true;
  }

  /* ---------------- LMS ---------------- */
  checkLms() {
    if (this.phase !== 'play') { this.checkEnd(); return; }
    const alive = this.survivorsAlive();
    if (alive.length === 1 && this.survivors.length >= 2 && !this.lms) {
      const s = alive[0], k = this.killer;
      const track = lmsTrackFor(s.charId, k.charId);
      const len = music.duration(track);
      this.lms = { survivor: s, track, len, start: this.time, title: music.title(track) };
      this.phase = 'lms';
      this.timeLeft = len;
      s.fx.add('haste', 9999, 0.12); s.maxStamina *= 1.3; s.stamina = s.maxStamina; s.heal(25);
      this.bloodlust = 100;
      music.play(track, { fade: 0.4, restart: true });
      audio.sfx('sting', { vol: 0.8 });
      bus.emit('lms', { survivor: s, killer: k, track: music.title(track), len });
      this.feed('LAST MAN STANDING: ' + s.name, 'info');
      if (s.brain) this.later(1, () => this.botSay(s, 'lms', {}, R() < 0.6));
      for (const [d] of this.echoes) if (d.brain && R() < 0.4) this.later(2 + R() * 4, () => this.botSay(d, 'lmsSpectator', { name: s.name }));
      if (k.brain) this.later(2, () => this.botSay(k, 'taunt'));
    }
    this.checkEnd();
  }
  checkEnd() {
    if (this.phase === 'end' || this.phase === 'intro' || this.phase === 'loading') return;
    if (this.survivorsAlive().length === 0) this.end('killer', this.survivors.length > 0 ? 'Nobody survived' : 'No survivors');
  }
  end(winner, reason) {
    if (this.phase === 'end') return;
    this.phase = 'end'; this.winner = winner; this.reason = reason; this.endT = 0;
    for (const a of this.actors) { a.intent.mx = a.intent.mz = 0; a.cancelBusy(); }
    if (winner === 'survivors') for (const s of this.survivorsAlive()) { s.escaped = true; s.view && s.view.loop('cheer'); }
    else if (this.killer && this.killer.alive) this.killer.view && this.killer.view.once('roar');
    music.stop(1.5);
    audio.sfx(winner === 'killer' ? 'sting' : 'gen_done', { vol: 0.8 });
    bus.emit('end', { winner, reason });
    // last words
    for (const a of this.actors) if (a.brain && a.member) {
      const topic = a.role === 'killer' ? (winner === 'killer' ? 'killerWinMe' : 'killerLoseMe') : (winner === 'killer' ? 'killerWin' : 'escape');
      if (R() < 0.6) this.later(0.6 + R() * 3, () => this.botSay(a, topic, {}, true));
    }
  }

  /* ---------------- the frame ---------------- */
  update(dt) {
    const real = dt;
    if (this.phase === 'end') { this.endT += real; dt *= this.endT < 1.4 ? 0.35 : 1; }
    this.time += dt;
    this.world.time = this.time;
    // timers
    for (let i = this.timers.length - 1; i >= 0; i--) { const t = this.timers[i]; t.t -= dt; if (t.t <= 0) { this.timers.splice(i, 1); try { t.fn(); } catch (e) { console.error(e); } } }
    if (this.phase === 'play' || this.phase === 'lms') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.end(this.survivorsAlive().length ? 'survivors' : 'killer', this.phase === 'lms' ? 'Survived the last stand' : 'Survived until dawn'); }
      if (!this.eventDone && this.def.event && this.phase === 'play' && this.time > (this.def.time || ROUND_TIME) * (this.def.event.at || 0.45)) { this.eventDone = true; this.mapEvent(this.def.event); }
    }
    // brains (not during the intro: everyone holds still for the reveal)
    const live = this.phase === 'play' || this.phase === 'lms';
    for (const a of this.actors) {
      if (a.brain && live && !a.left) { try { a.brain.update(dt); } catch (e) { console.error('[brain]', a.name, e); a.intent.mx = a.intent.mz = 0; } }
      else if (a.brain) { a.intent.mx = a.intent.mz = 0; a.intent.sprint = false; }
    }
    for (const a of this.actors) if (!a.left) a.update(dt, this.world.collision);
    this.separate();
    // floating in a levitation
    for (const a of this.actors) if (a.fx.has('lifted')) { a.y = damp(a.y, 1.6, 5, dt); a.vy = 0; a.grounded = false; a.x += Math.sin(this.time * 9) * 0.004; }
    // repairs: bots work at a rate set by their skill (the player solves puzzles instead)
    for (const g of this.gens) {
      g.update(dt);
      for (const u of g.users) {
        if (!u.alive || !u.busy || u.busy.gen !== g) { g.users.delete(u); continue; }
        if (u.isPlayer) continue;
        let rate = 0.085 + u.member.persona.skill * 0.045;                // about 35-45 s for a generator alone
        if (u.def.id === 'matt' && g.users.size > 1) rate *= 1.15;
        if (this.survivors.some((c) => c.alive && c.def.id === 'captain' && c.dist(u) < 10)) rate *= 1.1;
        if (this.bondedNear(u)) rate *= 1.1;
        if (R() < dt * 0.012 * (1 - u.member.persona.skill)) { this.genMistake(u, g); continue; }   // a botched part
        this.genPart(u, g, rate * dt);
      }
    }
    for (const p of this.pickups) if (!p.taken) p.update(dt);
    this.fx.update(dt);
    this.bondTick(dt);
    this.bloodlustTick(dt);
    this.echoTick(dt);
    if (this.curfew) this.curfew.update(dt);
    // footsteps
    for (const a of this.actors) if (a.alive && a.grounded && a.speed > 1.2 && a.view && a.view.root.visible) audio.step(a, this.def.surface || 'dirt');
    this.musicTick(dt);
    this.world.update(dt, this.game.camRig.cam.position);
    if (this.phase === 'end' && this.endT > 4.2 && !this.reported) { this.reported = true; this.game.onMatchEnd(this.results()); }
  }
  /** Bodies do not overlap: survivors can block the killer, and each other. */
  separate() {
    const A = this.actors;
    for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
      const a = A[i], b = A[j];
      if (!a.alive || !b.alive || a.left || b.left || a.fx.has('lifted') || b.fx.has('lifted')) continue;
      if (a.fx.has('invis') || b.fx.has('invis')) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, m = a.radius + b.radius;
      if (d2 >= m * m || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), push = (m - d);
      const ka = a.role === 'killer' ? 0.25 : 0.5, kb = b.role === 'killer' ? 0.25 : 0.5, s = ka + kb;
      const nx = dx / d, nz = dz / d;
      a.x -= nx * push * ka / s; a.z -= nz * push * ka / s; b.x += nx * push * kb / s; b.z += nz * push * kb / s;
    }
  }
  bondedNear(a) { for (const o of this.survivors) if (o !== a && o.alive && (a.bond[o.uid] || 0) >= 1 && a.dist(o) < 12) return true; return false; }
  bondTick(dt) {
    const S = this.survivorsAlive();
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      const a = S[i], b = S[j];
      if (a.dist(b) > 8) continue;
      const v = Math.min(1, (a.bond[b.uid] || 0) + dt / BOND_TIME);
      if (v >= 1 && (a.bond[b.uid] || 0) < 1) {
        this.feed(a.name + ' and ' + b.name + ' are bonded', 'info'); audio.sfx('bond', { pos: a, vol: 0.6 });
        if (a.brain && R() < 0.3) this.botSay(a, 'bond', { name: b.name }); else if (b.brain && R() < 0.3) this.botSay(b, 'bond', { name: a.name });
        bus.emit('bond', { a, b });
      }
      a.bond[b.uid] = b.bond[a.uid] = v;
    }
  }
  bloodlustTick(dt) {
    const k = this.killer; if (!k || !k.alive) return;
    if (k.fx.has('frenzy')) { this.bloodlust = Math.max(0, this.bloodlust - dt * 100 / 8); return; }
    // a chase builds it
    for (const s of this.survivorsAlive()) if (k.dist(s) < 12 && this.canSee(k, s)) { this.bloodlust = Math.min(100, this.bloodlust + dt * 1.4); break; }
    if (this.bloodlust >= 100 && this.phase !== 'end' && this.phase !== 'intro') {
      k.fx.add('frenzy', 8);
      this.sfx('frenzy', k, { range: 60 }); this.sfx('roar', k, { range: 50, vol: 0.7 });
      k.view && k.view.once('roar');
      this.fx.ring(k.x, k.z, 10, 0xff2020, 0.8); this.fx.burst(k.x, 1.4, k.z, 0xff2020, 50, 4, 1);
      this.feed(k.name + ' is in a FRENZY', 'bad');
      bus.emit('frenzy', { killer: k });
    }
  }
  /** Echoes: a dead survivor can reveal the killer once. Bots do it when it would help. */
  echoTick() {
    for (const [d, e] of this.echoes) {
      if (e.used || !d.brain || d.left) continue;
      if (this.time - e.at > 15 && R() < 0.004 * (0.3 + d.member.persona.team) && this.survivorsAlive().some((s) => s.chaseHeat > 0.3 || this.phase === 'lms')) this.useEcho(d);
    }
  }
  useEcho(d) {
    const e = this.echoes.get(d); if (!e || e.used || !this.killer || !this.killer.alive) return false;
    e.used = true;
    this.reveal(this.killer, 4.5, 'survivor');
    audio.sfx('echo', { vol: 0.7 });
    this.feed(d.name + "'s echo revealed " + this.killer.name, 'info');
    if (d.brain && R() < 0.5) this.botSay(d, 'echo');
    return true;
  }

  /** The map's event, from its film. */
  mapEvent(ev) {
    bus.emit('event', ev);
    this.feed(ev.text || 'Something is happening', 'info');
    audio.sfx(ev.sound || 'siren', { vol: 0.7 });
    if (ev.kind === 'barrage' || ev.kind === 'storm') {
      const n = ev.count || 14;
      for (let i = 0; i < n; i++) this.later(i * (ev.every || 0.7), () => {
        if (this.phase === 'end') return;
        const who = R.pick(this.actors.filter((a) => a.alive));
        let x, z;
        if (who && R() < 0.7) { x = who.x + (R() - 0.5) * 8; z = who.z + (R() - 0.5) * 8; } else [x, z] = this.world.nav.randomPoint(R);
        this.fx.marker(x, z, 3, ev.kind === 'storm' ? 0xfff36b : 0xff4030, 1.6, () => {
          if (ev.kind === 'storm') { this.fx.beam(new THREE.Vector3(x, 30, z), new THREE.Vector3(x, 0, z), 0xfff36b, 2.5, 0.35, 3); this.sfx('thunder', { x, z }, { range: 80 }); }
          this.explode(x, z, 3, null, { dmg: 18, color: ev.kind === 'storm' ? 0xfff36b : 0xff8a30, stunAll: true });
          for (const a of this.actors) if ((a.role === 'killer' || a.role === 'minion') && a.alive && dist(a.x, a.z, x, z) < 3) a.stun(1.4, null);
        });
      });
    } else if (ev.kind === 'blackout') {
      const w = this.world, fog0 = w.scene.fog.density;
      w.lightScale = 0.08; w.scene.fog.density = fog0 * 1.5;
      this.later(ev.dur || 25, () => { w.lightScale = 1; w.scene.fog.density = fog0; this.feed('The lights are back', 'info'); });
    } else if (ev.kind === 'alarm') {
      for (const s of this.survivorsAlive()) this.reveal(s, 4, 'killer');
      if (this.killer) this.reveal(this.killer, 4, 'survivor');
    } else if (ev.kind === 'curfew') {
      this.curfew = new Curfew(this, ev);
    } else if (ev.kind === 'fog') {
      const f = this.world.scene.fog, d0 = f.density;
      f.density = d0 * 2.2;
      this.later(ev.dur || 30, () => { f.density = d0; });
    }
  }
  musicTick() {
    if (this.phase === 'lms' || this.phase === 'end' || this.phase === 'intro') return;
    const P = this.game.focusActor(); if (!P) return;
    const k = this.killer;
    let d = 99;
    if (P.role === 'killer') { for (const s of this.survivorsAlive()) if (this.canSee(P, s)) d = Math.min(d, P.dist(s)); }
    else if (k && k.alive && !k.fx.has('invis')) d = P.dist(k);
    const track = d < 32 ? 'chase_' + k.charId : 'amb_' + (this.def.music || this.def.id);
    const chased = P.role === 'survivor' && P.chaseHeat > 0.4;
    const x = d < 32 ? clamp(1 - (d - 6) / 26, 0, 1) * 0.92 + (chased || (P.role === 'killer' && d < 10) ? 0.15 : 0) : 0;
    // hold the chase a moment after it ends, as the music would
    if (track.startsWith('chase')) { this.chaseHold = 4; music.play(track, { fade: 0.8 }); music.setIntensity(x); }
    else if ((this.chaseHold = (this.chaseHold || 0) - 1 / 60) <= 0) music.play(track, { fade: 2.5 });
    else music.setIntensity(Math.max(0, music.intensity - 0.004));
  }

  /* ---------------- the round's story, for the results screen ---------------- */
  results() {
    const rows = [];
    for (const a of [...this.survivors, this.killer].filter(Boolean)) {
      const m = a.member;
      let status = a.role === 'killer' ? 'killer' : a.left ? 'left' : a.alive ? 'escaped' : 'dead';
      const earned = this.reward(a, status);
      rows.push({ member: m, actor: a, name: a.name, char: a.def.name, charId: a.charId, skin: a.skin, role: a.role, status, stats: Object.assign({}, a.stats), money: earned.money, xp: earned.xp });
    }
    return { winner: this.winner, reason: this.reason, map: this.def, rows, lms: this.lms ? { name: this.lms.survivor.name, won: this.winner === 'survivors' } : null, log: this.log };
  }
  reward(a, status) {
    let money = 25, xp = 30;
    const s = a.stats;
    if (a.role === 'killer') { money += s.kills * 40 + Math.floor(s.damage * 0.2); xp += s.kills * 35; if (this.winner === 'killer') { money += 120; xp += 80; } }
    else {
      money += s.gens * 30 + s.stuns * 25 + Math.floor(s.heals * 0.6) + s.saves * 15 + Math.floor(s.time * 0.25);
      xp += s.gens * 20 + s.stuns * 20 + s.saves * 15 + Math.floor(s.time * 0.2);
      if (status === 'escaped') { money += 100; xp += 60; }
      if (this.lms && this.lms.survivor === a && status === 'escaped') { money += 150; xp += 100; }
      if (a.def.id === 'richguy') money = Math.floor(money * 1.25);
    }
    if (status === 'left') { money = 0; xp = 0; }
    return { money, xp };
  }
  dispose() {
    if (this.curfew) this.curfew.dispose();
    this.fx.dispose();
    for (const a of this.actors) a.dispose();
    for (const g of this.gens) g.dispose();
    for (const p of this.pickups) p.dispose();
    this.world.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    if (this.world.scene.environment) this.world.scene.environment.dispose();
  }
}

export { PARTS, placeName };
