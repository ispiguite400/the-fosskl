/*
 * FORLORN — boot and the state machine.
 *
 *   title -> lobby (intermission, vote) -> loading -> round (intro, play, LMS, end) -> results -> lobby
 *
 * Local players are slots: { p, input, camRig, control, hud, worldUi, puzzle, member, actor }.
 * Player one is always there (keyboard, mouse, touch, first controller). In the camp a second
 * controller can press ✕ to join as player two: the screen splits side by side, each player with
 * their own camera, HUD, name tags and puzzle, and both play the next rounds.
 */
import { Renderer } from './render/renderer.js';
import { input, PadInput, scanPads } from './core/input.js';
import { profile, settings, addXp, saveProfile, owns } from './core/save.js';
import { bus } from './core/events.js';
import { R } from './core/util.js';
import { audio } from './audio/audio.js';
import { music } from './audio/music.js';
import { CameraRig } from './game/camera.js';
import { PlayerControl } from './game/player.js';
import { Server } from './game/server.js';
import { Lobby } from './game/lobby.js';
import { Match } from './game/match.js';
import { UI } from './ui/screens.js';
import { Hud } from './ui/hud.js';
import { Chat } from './ui/chat.js';
import { WorldUI } from './ui/worldui.js';
import { Puzzle } from './ui/puzzle.js';
import { Touch } from './ui/touch.js';
import { refreshGlyphs, setGlyphSource, glyph } from './ui/glyph.js';
import { loadLobby, loadMap, availableMaps } from './data/maps.js';
import { preloadModel } from './render/characters.js';
import { characterModel, SHIPPED, loadShipped, SURVIVORS, KILLERS, isReady, byId } from './data/characters.js';
import { esc } from './core/util.js';
import * as THREE from 'three';

class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.renderer = new Renderer(this.canvas);
    this.camRig = new CameraRig(this.renderer.camera);
    this.input = input;
    this.ui = new UI(this);
    // player one's slot; player two's is made when they join
    const one = { p: 1, input, camRig: this.camRig, control: null, hud: null, worldUi: null, puzzle: null, member: null, actor: null };
    this.slots = [one];
    this.worldUi = one.worldUi = new WorldUI(this, document.getElementById('world-ui'));
    this.hud = one.hud = new Hud(this, document.getElementById('hud'), one);
    const chatLayer = document.createElement('div'); chatLayer.id = 'chat-layer'; document.getElementById('ui').appendChild(chatLayer);
    this.chat = new Chat(this, chatLayer);
    this.puzzle = one.puzzle = new Puzzle(this, document.getElementById('overlay'));
    this.touch = new Touch(this, document.getElementById('touch'));
    this.player = one.control = new PlayerControl(this, one);
    this.joinWait = false;                   // "Add player 2" from the menu: the next controller to press ✕ joins
    this.server = new Server(this);
    this.state = 'boot';
    this.lobby = null; this.match = null; this.paused = false;
    this.last = performance.now();
    this.fps = 60;
    this.canvas.addEventListener('click', () => this.relock());
    bus.on('lms', (d) => this.ui.vsCard(d.survivor, d.killer, d.track));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'round' && !this.paused) this.togglePause(); });
    window.__forlorn = this;
  }
  async boot() {
    music.loadManifest();
    await loadShipped();
    this.server = new Server(this);
    for (const id of SHIPPED) preloadModel(characterModel(id));
    this.lobbyDef = await loadLobby();
    this.maps = await availableMaps();
    // the title sits over the camp at night
    this.lobby = new Lobby(this, this.lobbyDef);
    await this.lobby.enter(this.maps, true);
    this.renderer.setScene(this.lobby.scene);
    this.state = 'title';
    this.ui.title();
    this.chat.setVisible(false);
    this.titleT = 0;
    requestAnimationFrame((t) => this.frame(t));
    const splash = document.getElementById('boot'); if (splash) splash.remove();
  }
  startFromTitle() {
    if (this.state !== 'title') return;
    input.consume('chat'); input.consume('confirm');
    audio.init();
    music.play('lobby', { fade: 2 });
    this.enterLobby(true);
  }
  /** Re-grab the mouse after a menu closes (only where pointer lock is allowed). */
  relock() {
    if (this.ui.modal() || this.chat.isOpen || this.puzzle.open || input.device !== 'kbm') return;
    if (this.state === 'round' || this.state === 'lobby') input.requestLock(this.canvas);
  }
  actorOf(member) {
    const list = this.match ? this.match.actors : this.lobby ? this.lobby.actors : [];
    return list.find((a) => a.member === member) || null;
  }
  focusActor() {
    if (this.match) { const p = this.match.player; return p && !p.alive && this.player.spectating ? this.player.spectating : p; }
    return this.lobby ? this.lobby.me : null;
  }
  /** The local slot that plays this actor (null for bots). */
  slotFor(actor) { return this.slots.find((s) => s.actor === actor) || null; }
  get p2() { return this.slots[1] || null; }

  /* ---------------- split screen ---------------- */
  /** A second controller joins as player two (only in the camp, between rounds). */
  addPlayer2(padIndex) {
    if (this.p2 || this.state !== 'lobby' || !this.lobby) return false;
    this.joinWait = false;
    const inp = new PadInput(padIndex);
    inp.update();                            // the ✕ that joined is already held, so it is not also a jump
    input.claimed.add(padIndex); input.others = [inp];
    setGlyphSource(2, inp);
    const cam = new THREE.PerspectiveCamera(settings.fov || 70, 1, 0.08, 400);
    const ui = document.getElementById('ui'), screens = document.getElementById('screens');
    const layer = (id) => { const d = document.createElement('div'); d.id = id; ui.insertBefore(d, screens); return d; };
    const slot = { p: 2, input: inp, camRig: new CameraRig(cam), control: null, member: null, actor: null };
    slot.worldUi = new WorldUI(this, layer('world-ui2'), cam);
    slot.hud = new Hud(this, layer('hud2'), slot);
    slot.puzzle = new Puzzle(this, layer('overlay2'), inp, 2);
    slot.control = new PlayerControl(this, slot);
    slot.member = this.server.addLocal();
    this.slots[1] = slot;
    this.renderer.setSplit(cam);
    ui.classList.add('split');
    this.lobby.spawn(slot.member).then((a) => { if (!a) return; slot.actor = a; slot.camRig.target = a; slot.camRig.snapBehind(a); slot.camRig.yaw = Math.PI; slot.camRig.pitch = 0.3; this.lobbyP2(); });
    this.chat.system(slot.member.name + ' joined on controller ' + (padIndex + 1), 'join');
    audio.sfx('join', { vol: 0.6 });
    inp.rumble(0.5, 0.5, 180);
    return true;
  }
  /** Player two leaves (from the camp, or their controller went away). */
  removePlayer2() {
    const s = this.p2; if (!s || this.state !== 'lobby') return;
    s.puzzle.close();
    s.hud.dispose(); s.worldUi.clear();
    for (const id of ['world-ui2', 'hud2', 'overlay2']) { const d = document.getElementById(id); if (d) d.remove(); }
    input.claimed.delete(s.input.padIndex); input.others = [];
    setGlyphSource(2, null);
    if (this.lobby) { this.lobby.despawn(s.member); this.lobby.votes.delete(s.member); }
    this.server.removeLocal();
    this.slots.length = 1;
    this.renderer.setSplit(null);
    document.getElementById('ui').classList.remove('split');
    this.chat.system(s.member.name + ' left split screen', 'leave');
  }
  /** Player two's corner of the camp: who they will play, and how to change it or leave. */
  lobbyP2() {
    const s = this.p2; if (!s || this.state !== 'lobby') return;
    const sv = byId(this.server.survivorFor(s.member).charId), kl = byId(this.server.killerFor(s.member).charId);
    const g = (a) => glyphP2(a);
    s.hud.root.innerHTML = '<div class="p2-card"><div class="p2-tag">PLAYER 2</div><div class="p2-row"><small>SURVIVOR</small>' + g('tabPrev') + '<b>' + esc(sv ? sv.name : '') + '</b>' + g('tabNext') + '</div>' +
      '<div class="p2-row"><small>KILLER</small>' + g('ability2') + '<b>' + esc(kl ? kl.name : '') + '</b>' + g('attack') + '</div><div class="p2-hint">Hold ' + g('cancel') + ' to leave</div></div>';
  }
  /** Player two flips through the characters player one owns. */
  cycleP2(kind, dir) {
    const s = this.p2; if (!s) return;
    const list = (kind === 'survivor' ? SURVIVORS : KILLERS).filter((c) => isReady(c.id) && (c.price === 0 || owns(c.id)));
    if (!list.length) return;
    const cur = profile.p2[kind], i = Math.max(0, list.findIndex((c) => c.id === cur));
    profile.p2[kind] = list[(i + dir + list.length) % list.length].id;
    saveProfile();
    audio.sfx('ui_move');
    if (kind === 'survivor' && this.lobby) this.lobby.refreshMember(s.member).then((a) => { if (a) { s.actor = a; s.camRig.target = a; } });
    this.lobbyP2();
  }
  /** In the camp: a controller nobody has presses ✕ to join; player two holds ○ to leave. */
  splitScreen(dt) {
    if (this.state !== 'lobby' || this.ui.modal() || this.chat.isOpen) return;
    const s = this.p2;
    if (!s) {
      for (const pad of scanPads()) {
        const mine = pad.index === input.padIndex && !this.joinWait;
        if (mine || input.claimed.has(pad.index)) continue;
        if (pad.pressed.includes(0)) { if (!this._joinHeld) { this._joinHeld = true; if (this.joinWait && pad.index === input.padIndex) { input.padIndex = -1; input.device = this.touch.on ? 'touch' : 'kbm'; } this.addPlayer2(pad.index); } return; }
      }
      this._joinHeld = false;
      return;
    }
    if (!s.input.connected) { this.removePlayer2(); return; }
    s.leaveT = s.input.down('cancel') ? (s.leaveT || 0) + dt : 0;
    if (s.leaveT > 1.2) { this.removePlayer2(); return; }
    if (s.input.pressed('tabPrev')) this.cycleP2('survivor', -1);
    if (s.input.pressed('tabNext')) this.cycleP2('survivor', 1);
    if (s.input.pressed('ability2')) this.cycleP2('killer', -1);
    if (s.input.pressed('attack')) this.cycleP2('killer', 1);
  }

  /* ---------------- lobby ---------------- */
  async enterLobby(first = false) {
    this.state = 'lobby';
    if (!first || !this.lobby) {
      const { left, joined } = this.server.churn();
      for (const m of left) { this.chat.system(m.name + ' left the game', 'leave'); }
      if (!this.lobby) this.lobby = new Lobby(this, this.lobbyDef);
      this.lobby.leave();
      await this.lobby.enter(this.maps, false);
      let d = 0;
      for (const m of joined) { setTimeout(() => { this.chat.system(m.name + ' joined the game', 'join'); audio.sfx('join', { vol: 0.5 }); }, (d += 1500 + R() * 3000)); }
    }
    this.renderer.setScene(this.lobby.scene);
    this.camRig.target = this.lobby.me;
    if (this.lobby.me) this.camRig.snapBehind(this.lobby.me);
    this.camRig.yaw = Math.PI; this.camRig.pitch = 0.3;
    this.slots[0].actor = this.lobby.me;
    for (const s of this.slots) s.hud.clear();
    const p2 = this.p2;
    if (p2) { p2.actor = this.lobby.p2; p2.camRig.target = p2.actor; p2.camRig.yaw = Math.PI; p2.camRig.pitch = 0.3; p2.control.spectating = null; this.lobbyP2(); }
    this.ui.lobby();
    this.chat.setVisible(true);
    this.touch.setLayout('lobby', this.lobby.me);
    music.play('lobby', { fade: 2 });
    if (first) setTimeout(() => this.chat.system('Welcome to FORLORN. ' + (input.device === 'pad' ? 'Controller connected.' : input.device === 'touch' ? 'Touch controls on.' : 'Click to look around. Press / to chat.')), 600);
  }

  /* ---------------- a round ---------------- */
  async startRound(mapId) {
    if (this.state !== 'lobby') return;
    this.state = 'loading';
    input.releaseLock();
    const def = await loadMap(mapId);
    const progress = this.ui.loading(def);
    this.chat.setVisible(false);
    this.touch.setLayout('menu');
    music.play('title', { fade: 1.5 });
    // who is the killer
    const killer = this.server.pickKiller(settings.killerOptOut);
    const roster = this.server.members.map((m) => {
      const role = m === killer ? 'killer' : 'survivor';
      const { charId, skin } = role === 'killer' ? this.server.killerFor(m) : this.server.survivorFor(m);
      return { member: m, role, charId, skin };
    });
    if (killer.bot && R() < 0.5) setTimeout(() => this.chat.post(killer, (R() < 0.5 ? 'lets gooo im killer' : 'hehe')), 1200);
    const M = new Match(this, def, roster);
    try { await M.load(progress); }
    catch (e) { console.error(e); this.chat.system('Could not load ' + def.name + ': ' + e.message); this.state = 'lobby'; this.ui.lobby(); return; }
    if (this.lobby) this.lobby.leave();
    this.match = M;
    this.renderer.setScene(M.scene);
    this.state = 'round';
    this.ui.clear();
    this.slots[0].actor = M.player;
    if (this.p2) this.p2.actor = M.player2;
    for (const s of this.slots) {
      s.hud.build(M, s.actor);
      s.camRig.target = s.actor;
      if (s.actor) s.camRig.snapBehind(s.actor);
      s.control.spectating = null;
    }
    this.chat.setVisible(true);
    this.touch.setLayout(M.player.role === 'killer' ? 'killer' : 'survivor', M.player);
    this.intro();
    this.relock();
  }
  /** The reveal: the camera finds the killer, then drops behind you. */
  intro() {
    const M = this.match, k = M.killer, p = M.player;
    const head = () => new THREE.Vector3(k.x, 1.6, k.z);
    // find the most open side of the killer for the camera, and turn the killer to face it
    let best = k.yaw, bd = -1;
    for (let i = 0; i < 16; i++) {
      const a = k.yaw + i / 16 * Math.PI * 2, d = Math.min(8, M.world.collision.raycast3(k.x, 1.7, k.z, Math.sin(a), 0, Math.cos(a), 8));
      const score = d - (i ? 0.3 : 0);
      if (score > bd) { bd = score; best = a; }
    }
    k.yaw = best; k.syncView(0);
    const far = Math.max(2.5, Math.min(7, bd - 0.6)), near = Math.min(2.6, far * 0.6);
    const [fx, fz] = k.forward();
    const card = this.ui.introCard(M, p);
    music.play('chase_' + k.charId, { fade: 0.5, restart: true }); music.setIntensity(0.4);
    audio.sfx('sting', { vol: 0.7 });
    k.view && k.view.once('roar');
    const shot = () => ({ from: new THREE.Vector3(k.x + fx * far, 3.2, k.z + fz * far), to: new THREE.Vector3(k.x + fx * near, 1.7, k.z + fz * near), look: head, dur: 3.2 });
    if (this.p2) this.p2.camRig.play(Object.assign(shot(), { onDone: () => { if (M.player2) this.p2 && this.p2.camRig.snapBehind(M.player2); } }));
    this.camRig.play(Object.assign(shot(), { onDone: () => {
      card.remove();
      if (M.phase !== 'intro') return;          // the round already ended (the player left during the intro)
      M.phase = 'play';
      for (const s of this.slots) if (s.actor) s.hud.center(s.actor.role === 'killer' ? 'HUNT THEM DOWN' : 'SURVIVE', s.actor.role === 'killer' ? 'Kill every survivor before the timer runs out' : 'Repair generators to shorten the night', 2.6);
      audio.sfx('go', { vol: 0.6 });
      music.play('amb_' + (M.def.music || M.def.id), { fade: 2 });
      for (const a of M.actors) if (a.brain && a.role === 'survivor' && R() < 0.25) M.botSay(a, 'start');
      this.camRig.snapBehind(p);
    } }));
  }
  onMatchEnd(res) {
    const me = res.rows.find((r) => r.member && r.member.isMe);
    if (me) {
      profile.money += me.money; addXp(me.xp);
      profile.stats.rounds++;
      if (me.status === 'escaped') profile.stats.escapes++;
      profile.stats.kills += me.role === 'killer' ? me.stats.kills : 0;
      profile.stats.gens += me.stats.gens;
      if (res.lms && res.lms.won && me.status === 'escaped' && this.match.lms && this.match.lms.survivor.isPlayer) profile.stats.lmsWins++;
      saveProfile();
    }
    // split screen: player two's earnings go in the same bank
    const two = res.rows.find((r) => r.member && r.member.local === 2);
    if (two) { profile.money += two.money; addXp(Math.round(two.xp / 2)); saveProfile(); }
    this.server.afterRound(res);
    this.state = 'results';
    input.releaseLock();
    for (const s of this.slots) { s.puzzle.close(); s.hud.clear(); s.worldUi.clear(); }
    this.touch.setLayout('menu');
    music.play('results', { fade: 2 });
    this.ui.results(res, () => this.finishResults());
  }
  finishResults() {
    if (this.state !== 'results') return;
    if (this.match) { this.match.dispose(); this.match = null; }
    for (const s of this.slots) s.worldUi.clear();
    this.enterLobby(false);
  }
  togglePause() {
    if (this.state !== 'round' && this.state !== 'lobby') return;
    if (this.paused) return this.resume();
    if (this.ui.modal()) return;
    this.paused = this.state === 'round';
    this.ui.stack = [];
    input.releaseLock();
    if (this.state === 'round') this.ui.pause(); else this.ui.lobbyMenu();
  }
  resume() { this.paused = false; this.ui.clear(); this.ui.stack = []; if (this.state === 'lobby') this.ui.lobby(); this.relock(); }
  forfeit() {
    // split screen: leaving ends the round for the couch
    const M = this.match; if (!M) return;
    this.paused = false; this.ui.clear();
    const p = M.player;
    if (p.alive) { p.left = true; p.alive = false; M.feed(p.name + ' left the game', 'info'); M.checkLms(); }
    M.end(M.survivorsAlive().length ? 'survivors' : 'killer', 'You left the round');
  }

  /* ---------------- the frame ---------------- */
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    let dt = (t - this.last) / 1000; this.last = t;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.05);
    this.fps = this.fps * 0.95 + (1 / dt) * 0.05;
    this.step(dt);
    music.tick();
    const c = this.renderer.camera;
    audio.setListener(c.position.x, c.position.y, c.position.z, this.camRig.yaw);
    const world = this.state === 'round' || this.state === 'results' ? this.match && this.match.world : this.lobby && this.lobby.world;
    this.renderer.render(dt, (i, v) => {
      const s = this.slots[i];
      if (this.slots.length > 1 && world) world.focus(v.camera.position);      // shadows and lamps around this player's view
      if (s && s.actor && this.slots.length > 1 && this.state === 'round' && this.match) this.xray(this.match, s.actor);
    });
  }
  /** Run the game forward without drawing (testing: __forlorn.sim(10) plays ten seconds). */
  sim(seconds, dt = 1 / 30) { for (let t = 0; t < seconds; t += dt) this.step(dt); }
  step(dt) {
    input.update();
    for (const s of this.slots) if (s.p !== 1) s.input.update();
    input.menuShare = this.ui.modal();
    refreshGlyphs();
    this.splitScreen(dt);
    if (input.pressed('pause') && !this.chat.isOpen && !this.puzzle.open) {
      if (this.ui.curName === 'pause' || this.ui.curName === 'lobbymenu') this.resume();
      else if (['settings', 'characters', 'shop', 'howto'].includes(this.ui.curName)) this.ui.back();
      else this.togglePause();
    }
    this.ui.update(dt);
    this.chat.update(dt);
    this.touch.root.classList.toggle('modal', this.ui.modal());
    const R2 = this.renderer;
    if (this.state === 'title' || this.state === 'boot') {
      this.titleT = (this.titleT || 0) + dt;
      const L = this.lobby;
      if (L) { L.update(dt); const a = this.titleT * 0.05; R2.camera.position.set(Math.sin(a) * 12, 3.2, Math.cos(a) * 12); R2.camera.lookAt(0, 1.2, 0); }
      this.worldUi.update(dt, { actors: [], viewer: null });
    } else if (this.state === 'lobby' && this.lobby) {
      const L = this.lobby, me = L.me;
      this.slots[0].actor = me;
      if (this.p2 && !this.p2.actor) this.p2.actor = L.p2;
      for (const s of this.slots) s.control.update(dt, { actor: s.actor, lobby: true });
      L.update(dt);
      for (const s of this.slots) s.camRig.update(dt, L.world.collision, { sprint: s.actor && s.actor.sprinting });
      for (const s of this.slots) s.worldUi.update(dt, { actors: L.actors, viewer: s.actor });
      if (L.timeLeft <= 0 && this.state === 'lobby') this.startRound(L.winner() || (this.maps[0] && this.maps[0].id));
      this.touch.update(me);
    } else if (this.state === 'round' && this.match) {
      const M = this.match, p = M.player;
      if (!this.paused) {
        for (const s of this.slots) s.control.update(dt, { actor: s.actor, match: M });
        for (const s of this.slots) s.puzzle.update();
        M.update(dt);
        this.slots.forEach((s, i) => {
          const a = s.actor;
          if (M.phase !== 'intro' && a) s.camRig.update(dt, M.world.collision, { sprint: a.alive && a.sprinting, fovAdd: a.fx.has('frenzy') ? 6 : 0 });
          else s.camRig.update(dt, null);
          if (a) this.grade(dt, M, a, this.renderer.views[i] ? this.renderer.views[i].grade : null);
        });
      }
      for (const s of this.slots) s.hud.update(dt, s.control);
      for (const s of this.slots) s.worldUi.update(dt, { actors: M.actors, viewer: s.actor, match: M });
      this.touch.setLayout(p.alive ? (p.role === 'killer' ? 'killer' : 'survivor') : 'spectate', p);
      this.touch.update(p);
      if (this.slots.length === 1) this.xray(M, p);
    } else if (this.state === 'results' && this.match) {
      this.match.update(dt);
      this.camRig.update(dt, this.match.world.collision);
    }
  }
  /** The screen's mood: fear when the killer is close, red in a frenzy, grey when dead. */
  grade(dt, M, p = M.player, g = this.renderer.grade) {
    if (!g || !p) return;
    const k = M.killer;
    const A = M.def.ambience.grade || {};
    let fear = 0;
    if (p.alive && p.role === 'survivor' && k && k.alive && !k.fx.has('invis')) fear = Math.max(0, 1 - p.dist(k) / 20) * 0.7;
    if (p.role === 'killer' && p.fx.has('frenzy')) fear = 0.6;
    const ease = (u, v, r) => { u.value += (v - u.value) * Math.min(1, dt * r); };
    ease(g.uFear, fear, 3);
    ease(g.uDeath, p.alive ? 0 : 1, 1.5);
    ease(g.uBlind, p.fx.has('blind') ? 1 : 0, 6);
    ease(g.uChroma, (p.fx.has('stun') ? 1.5 : 0) + fear * 0.8 + (M.phase === 'lms' ? 0.5 : 0), 4);
    ease(g.uSat, (A.sat || 1) * (M.phase === 'lms' ? 1.15 : 1), 2);
    ease(g.uContrast, (A.contrast || 1.05) * (M.phase === 'lms' ? 1.06 : 1), 2);
    const tint = A.tint || [1, 1, 1];
    g.uTint.value.set(tint[0], tint[1], tint[2]);
    ease(g.uVignette, M.phase === 'lms' ? 0.6 : 0.35, 2);
  }
  /** Revealed characters glow through walls for the side they are revealed to; so do bonded friends. */
  xray(M, p) {
    const team = p.role === 'killer' ? 'killer' : 'survivor';
    for (const a of M.actors) {
      if (!a.view) continue;
      let c = null;
      if (a !== p && a.alive && M.revealedTo(a, team)) c = a.role === 'killer' ? 0xff2020 : 0xffd21f;
      else if (a !== p && a.alive && team === 'survivor' && a.role === 'survivor' && (p.bond[a.uid] || 0) >= 1) c = 0xff8fb8;
      else if (a !== p && a.alive && team === 'survivor' && a.role === 'killer' && p.def && p.def.id === 'emily' && p.alive && p.dist(a) < 25) c = 0xb48cff;
      a.view.setXray(c);
      // the killer fades while vanished; hidden survivors go faint
      if (a.role === 'killer') a.view.ghost(a.fx.has('invis') ? (p === a ? 0.35 : 0.06) : 1);
      else if (a.fx.has('hidden') && a.speed < 0.3) a.view.ghost(p.role === 'killer' ? 0.15 : 0.5);
      else if (a.fx.has('disguise')) a.view.ghost(1);
      else a.view.ghost(1);
    }
  }
}

/** A glyph drawn for player two's controller. */
const glyphP2 = (a) => glyph(a, '', 2);

const game = new Game();
game.boot().catch((e) => {
  console.error(e);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font:16px sans-serif;padding:2rem;text-align:center;background:#0b0b10';
  d.textContent = 'FORLORN could not start: ' + e.message;
  document.body.appendChild(d);
});
