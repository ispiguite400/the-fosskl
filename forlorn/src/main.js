/*
 * FORLORN — boot and the state machine.
 *
 *   title -> lobby (intermission, vote) -> loading -> round (intro, play, LMS, end) -> results -> lobby
 */
import { Renderer } from './render/renderer.js';
import { input } from './core/input.js';
import { profile, settings, addXp, saveProfile } from './core/save.js';
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
import { loadLobby, loadMap, availableMaps } from './data/maps.js';
import { preloadModel } from './render/characters.js';
import { characterModel, SHIPPED, loadShipped } from './data/characters.js';
import * as THREE from 'three';

class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.renderer = new Renderer(this.canvas);
    this.camRig = new CameraRig(this.renderer.camera);
    this.input = input;
    this.ui = new UI(this);
    this.worldUi = new WorldUI(this, document.getElementById('world-ui'));
    this.hud = new Hud(this, document.getElementById('hud'));
    const chatLayer = document.createElement('div'); chatLayer.id = 'chat-layer'; document.getElementById('ui').appendChild(chatLayer);
    this.chat = new Chat(this, chatLayer);
    this.puzzle = new Puzzle(this, document.getElementById('overlay'));
    this.touch = new Touch(this, document.getElementById('touch'));
    this.player = new PlayerControl(this);
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
    this.hud.clear();
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
    this.hud.build(M, M.player);
    this.chat.setVisible(true);
    this.touch.setLayout(M.player.role === 'killer' ? 'killer' : 'survivor', M.player);
    this.camRig.target = M.player;
    this.camRig.snapBehind(M.player);
    this.player.spectating = null;
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
    this.camRig.play({ from: new THREE.Vector3(k.x + fx * far, 3.2, k.z + fz * far), to: new THREE.Vector3(k.x + fx * near, 1.7, k.z + fz * near), look: head, dur: 3.2, onDone: () => {
      card.remove();
      if (M.phase !== 'intro') return;          // the round already ended (the player left during the intro)
      M.phase = 'play';
      this.hud.center(p.role === 'killer' ? 'HUNT THEM DOWN' : 'SURVIVE', p.role === 'killer' ? 'Kill every survivor before the timer runs out' : 'Repair generators to shorten the night', 2.6);
      audio.sfx('go', { vol: 0.6 });
      music.play('amb_' + (M.def.music || M.def.id), { fade: 2 });
      for (const a of M.actors) if (a.brain && a.role === 'survivor' && R() < 0.25) M.botSay(a, 'start');
      this.camRig.snapBehind(p);
    } });
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
    this.server.afterRound(res);
    this.state = 'results';
    input.releaseLock();
    this.puzzle.close();
    this.hud.clear();
    this.worldUi.clear();
    this.touch.setLayout('menu');
    music.play('results', { fade: 2 });
    this.ui.results(res, () => this.finishResults());
  }
  finishResults() {
    if (this.state !== 'results') return;
    if (this.match) { this.match.dispose(); this.match = null; }
    this.worldUi.clear();
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
    this.renderer.render(dt);
  }
  /** Run the game forward without drawing (testing: __forlorn.sim(10) plays ten seconds). */
  sim(seconds, dt = 1 / 30) { for (let t = 0; t < seconds; t += dt) this.step(dt); }
  step(dt) {
    input.update();
    if (input.pressed('pause') && !this.chat.isOpen && !this.puzzle.open) {
      if (this.ui.curName === 'pause' || this.ui.curName === 'lobbymenu') this.resume();
      else if (['settings', 'characters', 'shop', 'howto'].includes(this.ui.curName)) this.ui.back();
      else this.togglePause();
    }
    this.ui.update(dt);
    this.chat.update(dt);
    const R2 = this.renderer;
    if (this.state === 'title' || this.state === 'boot') {
      this.titleT = (this.titleT || 0) + dt;
      const L = this.lobby;
      if (L) { L.update(dt); const a = this.titleT * 0.05; R2.camera.position.set(Math.sin(a) * 12, 3.2, Math.cos(a) * 12); R2.camera.lookAt(0, 1.2, 0); }
      this.worldUi.update(dt, { actors: [], viewer: null });
    } else if (this.state === 'lobby' && this.lobby) {
      const L = this.lobby, me = L.me;
      this.player.update(dt, { actor: me, lobby: true });
      L.update(dt);
      this.camRig.update(dt, L.world.collision, { sprint: me && me.sprinting });
      this.worldUi.update(dt, { actors: L.actors, viewer: me });
      if (L.timeLeft <= 0 && this.state === 'lobby') this.startRound(L.winner() || (this.maps[0] && this.maps[0].id));
      this.touch.update(me);
    } else if (this.state === 'round' && this.match) {
      const M = this.match, p = M.player;
      if (!this.paused) {
        this.player.update(dt, { actor: p, match: M });
        this.puzzle.update();
        M.update(dt);
        if (M.phase !== 'intro') this.camRig.update(dt, M.world.collision, { sprint: p.alive && p.sprinting, fovAdd: p.fx.has('frenzy') ? 6 : 0 });
        else this.camRig.update(dt, null);
        this.grade(dt, M);
      }
      this.hud.update(dt, this.player);
      this.worldUi.update(dt, { actors: M.actors, viewer: p, match: M });
      this.touch.setLayout(p.alive ? (p.role === 'killer' ? 'killer' : 'survivor') : 'spectate', p);
      this.touch.update(p);
      this.xray(M, p);
    } else if (this.state === 'results' && this.match) {
      this.match.update(dt);
      this.camRig.update(dt, this.match.world.collision);
    }
  }
  /** The screen's mood: fear when the killer is close, red in a frenzy, grey when dead. */
  grade(dt, M) {
    const g = this.renderer.grade, p = M.player, k = M.killer;
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

const game = new Game();
game.boot().catch((e) => {
  console.error(e);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font:16px sans-serif;padding:2rem;text-align:center;background:#0b0b10';
  d.textContent = 'FORLORN could not start: ' + e.message;
  document.body.appendChild(d);
});
