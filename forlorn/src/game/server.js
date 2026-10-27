/*
 * The server: who is in this game with you. Bots come and go between rounds like real players
 * do (some rage quit, some get bored, new ones join), keep their money and malice, and have
 * mains they like to play.
 */
import { profile, saveProfile, equippedSkin, owns } from '../core/save.js';
import { makeBot } from '../data/bots.js';
import { SURVIVORS, KILLERS, isReady } from '../data/characters.js';
import { R } from '../core/util.js';
import { audio } from '../audio/audio.js';

const SIZE = 8;   // players in a server, you included

export class Server {
  constructor(game) {
    this.game = game;
    this.me = { name: profile.name, bot: false, isMe: true, persona: null, malice: profile.malice, level: profile.level };
    this.members = [this.me];
    for (let i = 0; i < SIZE - 1 - Math.floor(R() * 2); i++) this.members.push(this._newBot());
    this.round = 0;
  }
  _newBot() {
    const b = makeBot();
    const ready = SURVIVORS.filter((s) => isReady(s.id));
    b.main = (ready.length ? R.pick(ready) : SURVIVORS[0]).id;
    const kready = KILLERS.filter((k) => isReady(k.id));
    b.killerMain = (kready.length ? R.pick(kready) : KILLERS[0]).id;
    b.skins = {};
    for (const c of [...SURVIVORS, ...KILLERS]) if (R() < 0.3) { const s = c.skins.filter((x) => x.id !== 'default' && isReady(c.id + '_' + x.id)); if (s.length) b.skins[c.id] = R.pick(s).id; }
    return b;
  }
  bots() { return this.members.filter((m) => m.bot); }
  /** Split screen: player two takes a bot's place in the server (and gives it back on leaving). */
  addLocal() {
    if (this.p2) return this.p2;
    if (this.members.length >= SIZE) { const b = this.bots().sort((x, y) => x.malice - y.malice)[0]; if (b) this.members = this.members.filter((m) => m !== b); }
    this.p2 = { name: (profile.p2 && profile.p2.name) || 'Player 2', bot: false, isMe: false, local: 2, persona: null, malice: 0, level: profile.level };
    this.members.push(this.p2);
    return this.p2;
  }
  removeLocal() {
    const m = this.p2; if (!m) return null;
    this.members = this.members.filter((x) => x !== m);
    this.p2 = null;
    if (this.members.length < SIZE) this.members.push(this._newBot());
    return m;
  }
  /** Between rounds: some leave, some join. Returns { left: [], joined: [] }. */
  churn() {
    const left = [], joined = [];
    for (const m of this.bots()) {
      m.roundsHere = (m.roundsHere || 0) + 1;
      const bored = m.roundsHere > 3 && R() < 0.08 * (1.5 - m.persona.patience);
      if (m.leaving || bored) left.push(m);
    }
    this.members = this.members.filter((m) => !left.includes(m));
    while (this.members.length < SIZE && (this.members.length < SIZE - 2 || R() < 0.6)) { const b = this._newBot(); this.members.push(b); joined.push(b); }
    return { left, joined };
  }
  /** One player comes or goes mid-intermission. Returns { left } or { joined } or null. */
  drift() {
    const bots = this.bots();
    if (bots.length > 4 && R() < 0.5) {
      const m = R.pick(bots.filter((b) => b.persona.patience < 0.75 || b.persona.style === 'afk')) || null;
      if (!m) return null;
      this.members = this.members.filter((x) => x !== m);
      return { left: m };
    }
    if (this.members.length < SIZE) { const b = this._newBot(); this.members.push(b); return { joined: b }; }
    return null;
  }
  /** Highest malice is the killer; the rest are survivors. */
  pickKiller(optOut) {
    this.me.malice = profile.malice;
    let pool = this.members.filter((m) => !((m.isMe || m.local) && optOut));
    let top = Math.max(...pool.map((m) => m.malice));
    const best = pool.filter((m) => m.malice === top);
    return R.pick(best);
  }
  /** Where the player stands in line to be the killer: { pos, gap } (gap: malice short of first). */
  killerQueue() {
    this.me.malice = profile.malice;
    const others = this.members.filter((m) => !m.isMe), top = Math.max(0, ...others.map((m) => m.malice));
    const pos = 1 + others.filter((m) => m.malice > this.me.malice).length;
    return { pos, gap: this.me.malice > top ? 0 : top - this.me.malice + 1 };
  }
  survivorFor(m) {
    if (m.isMe) return { charId: profile.equipped.survivor, skin: equippedSkin(profile.equipped.survivor) };
    if (m.local) { const id = owns(profile.p2.survivor) && isReady(profile.p2.survivor) ? profile.p2.survivor : 'guest1337'; return { charId: id, skin: equippedSkin(id) }; }
    const id = isReady(m.main) ? m.main : (SURVIVORS.find((s) => isReady(s.id)) || SURVIVORS[0]).id;
    const skin = m.skins[id] || 'default';
    return { charId: id, skin: isReady(id + '_' + skin) || skin === 'default' ? skin : 'default' };
  }
  killerFor(m) {
    if (m.isMe) return { charId: profile.equipped.killer, skin: equippedSkin(profile.equipped.killer) };
    if (m.local) { const k = KILLERS.find((c) => c.id === profile.p2.killer); const id = k && (k.price === 0 || owns(k.id)) && isReady(k.id) ? k.id : 'terrible'; return { charId: id, skin: equippedSkin(id) }; }
    const ready = KILLERS.filter((k) => isReady(k.id));
    const id = isReady(m.killerMain) ? m.killerMain : (ready.length ? R.pick(ready).id : KILLERS[0].id);
    const skin = m.skins[id] || 'default';
    return { charId: id, skin: isReady(id + '_' + skin) || skin === 'default' ? skin : 'default' };
  }
  /** After a round: malice for everyone who was not the killer, money for the bots. */
  afterRound(results) {
    this.round++;
    for (const r of results.rows) {
      const m = r.member; if (!m) continue;
      if (r.role === 'killer') m.malice = 0; else m.malice += 1 + (R() < 0.5 ? 1 : 0) + (r.status === 'dead' ? 0 : 1);
      if (m.bot) m.money += r.money;
      if (m.bot && r.role === 'survivor' && r.status === 'dead') m.mood = Math.max(0, (m.mood || 0.5) - 0.15);
    }
    // bots who were not in the round (joined late) still gain malice
    for (const m of this.members) if (!results.rows.some((r) => r.member === m)) m.malice += 1;
    profile.malice = this.me.malice;
    saveProfile();
    audio.sfx('ui', { vol: 0.1 });
  }
}
