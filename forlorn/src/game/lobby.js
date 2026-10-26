/*
 * The lobby: everyone in the server hangs around the camp between rounds, as their survivor.
 * An intermission counts down; near the end the map vote opens; then the round loads.
 */
import { buildWorld } from '../world/world.js';
import { makeCharacter } from '../render/characters.js';
import { Actor } from './actor.js';
import { LobbyBrain } from './brain.js';
import { R } from '../core/util.js';
import { say } from '../data/bots.js';
import { settings } from '../core/save.js';
import { audio } from '../audio/audio.js';

export const INTERMISSION = 30, VOTE_AT = 13;

export class Lobby {
  constructor(game, def) { this.game = game; this.def = def; this.actors = []; this.time = 0; this.timeLeft = INTERMISSION; this.votes = new Map(); this.choices = []; }
  async enter(maps, firstTime) {
    const g = this.game;
    if (!this.world) { this.world = buildWorld(g.renderer, this.def, 7); this.world.match = null; }
    this.scene = this.world.scene;
    this.spots = this.world.spots;
    this.timeLeft = firstTime ? INTERMISSION + 10 : INTERMISSION;
    this.votes.clear();
    this.choices = R.shuffle(maps.slice()).slice(0, Math.min(3, maps.length));
    await Promise.all(g.server.members.map((m) => this.spawn(m)));
    this.chatT = 3 + R() * 4;
  }
  async spawn(m) {
    if (this.actors.some((a) => a.member === m)) return;
    const { charId, skin } = this.game.server.survivorFor(m);
    const v = await makeCharacter(charId, skin);
    const a = new Actor(this.world, { name: m.name, charId, skin, role: 'lobby', isPlayer: m.isMe, member: m });
    a.setView(v); v.rim(0x5a6f9a);
    const s = R.pick(this.world.spawns.survivor);
    a.place(s[0] + (R() - 0.5) * 2, s[1] + (R() - 0.5) * 2, Math.atan2(-s[0], -s[1]));
    if (m.bot) a.brain = new LobbyBrain(a, this);
    this.actors.push(a);
    return a;
  }
  despawn(m) { const a = this.actors.find((x) => x.member === m); if (a) { a.dispose(); this.actors = this.actors.filter((x) => x !== a); } }
  /** The player changed character: swap their body. */
  async refreshMe() {
    const me = this.actors.find((a) => a.member.isMe); if (!me) return;
    const x = me.x, z = me.z, yaw = me.yaw;
    this.despawn(me.member);
    const a = await this.spawn(me.member); a.place(x, z, yaw);
    this.game.camRig.target = a;
  }
  get me() { return this.actors.find((a) => a.member.isMe); }
  vote(m, mapId) { this.votes.set(m, mapId); }
  tally() {
    const n = new Map(this.choices.map((c) => [c.id, 0]));
    for (const [, id] of this.votes) n.set(id, (n.get(id) || 0) + 1);
    return n;
  }
  winner() {
    const n = this.tally(); let top = -1, best = [];
    for (const [id, c] of n) { if (c > top) { top = c; best = [id]; } else if (c === top) best.push(id); }
    return R.pick(best);
  }
  update(dt) {
    this.time += dt;
    this.timeLeft -= dt;
    for (const a of this.actors) if (a.brain) a.brain.update(dt);
    for (const a of this.actors) a.update(dt, this.world.collision);
    for (const a of this.actors) if (a.grounded && a.speed > 1.2 && a.view.root.visible) audio.step(a, 'dirt');
    // bots vote as the vote opens, over a few seconds
    if (this.timeLeft < VOTE_AT && this.choices.length) for (const m of this.game.server.bots()) {
      if (this.votes.has(m) || R() > dt * 0.6) continue;
      const fav = this.choices[(m.name.length + (m.persona.skill * 10 | 0)) % this.choices.length];
      this.vote(m, R() < 0.6 ? fav.id : R.pick(this.choices).id);
      if (settings.botChat && R() < 0.15 * m.persona.chat) { const t = say(m, 'voteMap', { map: R.pick(this.choices).name }); if (t) this.game.chat.post(m, t); }
    }
    // now and then someone leaves or joins, as on any real server
    if (this.timeLeft > 8 && R() < dt / 70) {
      const d = this.game.server.drift();
      if (d && d.left) { this.despawn(d.left); this.votes.delete(d.left); this.game.chat.system(d.left.name + ' left the game', 'leave'); audio.sfx('leave', { vol: 0.5 }); }
      if (d && d.joined) { this.spawn(d.joined); this.game.chat.system(d.joined.name + ' joined the game', 'join'); audio.sfx('join', { vol: 0.5 }); if (R() < 0.6) setTimeout(() => { const t = say(d.joined, 'join', {}); if (t) this.game.chat.post(d.joined, t); }, 2500 + R() * 3000); }
    }
    // small talk
    this.chatT -= dt;
    if (this.chatT <= 0) {
      this.chatT = 4 + R() * 9;
      const bots = this.game.server.bots();
      if (bots.length && settings.botChat) {
        const b = R.pick(bots);
        const t = say(b, 'lobby', { money: b.money, char: (this.actors.find((a) => a.member === b) || { def: { name: 'guest' } }).def.name });
        if (t) this.game.chat.post(b, t);
      }
    }
    this.world.update(dt, this.game.camRig.cam.position);
  }
  leave() { for (const a of this.actors) a.dispose(); this.actors = []; }
}
