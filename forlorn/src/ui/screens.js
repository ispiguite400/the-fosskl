/*
 * Every menu: title, loading, the lobby overlay (intermission, players, map vote), character
 * select, shop, settings, pause, results, and the cinematic cards (round intro, LMS VS card).
 */
import { el, esc, fmtTime, clamp } from '../core/util.js';
import { profile, settings, saveProfile, saveSettings, owns, grant, equippedSkin } from '../core/save.js';
import { SURVIVORS, KILLERS, isReady, byId } from '../data/characters.js';
import { input, scanPads } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { music } from '../audio/music.js';
import { portrait, mapArt } from './art.js';
import { icon, abilityIcon } from './icons.js';
import { MenuNav } from './nav.js';
import { glyph, controlsList } from './glyph.js';
import { ABILITIES } from '../game/abilities.js';
import { IS_TOUCH } from '../core/device.js';

const TIPS = [
  'Generators shorten the timer. Every one you start makes the night shorter.',
  'Stick with a teammate for a while and you bond: faster repairs, and grief speed if they fall.',
  'Dead? You linger as an echo. Once a round, reveal the killer to the living.',
  'The killer\'s Bloodlust fills as they hit and chase. When it boils over, run.',
  'Last Man Standing lasts exactly one song. Survive the song.',
  'Loop the killer round something solid: houses, walls, rocks.',
  'A wrong wire on a generator sparks, and the killer hears it.',
  'Guest 1337 can block a hit and stun the killer. Time it.',
  'Bloxy Cola: a burst of speed and stamina when you need it most.',
  'Some teammates will save you. Some will lead the killer straight to you.',
  'In Bacon City, a roof over your head hides you from the curfew searchlights.',
  'Your heart beats louder the closer the killer gets. Listen to it.'
];
const xpNeed = () => 120 + profile.level * 40;

export class UI {
  constructor(game) {
    this.game = game;
    this.screens = document.getElementById('screens');
    this.overlay = document.getElementById('overlay');
    this.cur = null; this.curName = ''; this.stack = [];
    this.nav = new MenuNav();
  }
  /** A blocking menu is up (the player is not playing). */
  modal() { return ['characters', 'shop', 'settings', 'pause', 'lobbymenu', 'howto', 'title', 'loading', 'results'].includes(this.curName); }
  clear() { this.screens.innerHTML = ''; this.cur = null; this.curName = ''; this.nav.reset(); }
  _set(name, node) {
    this.screens.innerHTML = ''; this.screens.appendChild(node); this.cur = node; this.curName = name; this.nav.reset();
    if (this.modal()) input.releaseLock();
  }
  /** Open a menu over the current one; back() returns to it. */
  push(name, ...args) { this.stack.push(this.curName); this[name](...args); }
  back() {
    const prev = this.stack.pop();
    audio.sfx('ui_back');
    if (prev === 'lobby' || !prev) { this.lobby(); this.game.relock(); }
    else if (prev === 'pause') this.pause();
    else this[prev]();
  }
  update(dt) {
    if (!this.cur) return;
    if (this.curName === 'lobby') { this.updateLobby(dt); return; }
    if (this.curName === 'title') {
      if (input.pressed('confirm') || input.pressed('interact') || input.pressed('attack') || (input.pad && input.pad.buttons.some((b) => b.pressed))) this.game.startFromTitle();
      return;
    }
    this.nav.update(this.cur, dt, {
      onBack: this.curName === 'results' ? null : () => (this.curName === 'pause' || this.curName === 'lobbymenu' ? this.game.resume() : this.stack.length ? this.back() : null),
      onTab: this.onTab
    });
    if (this.curName === 'results') this.updateResults(dt);
  }
  /** The top of a full-screen menu: back, title, tabs, money. */
  _head(title, kicker, tabs) {
    return '<div class="panel-head"><button class="btn small" data-back>' + icon('back') + 'Back</button><h2><small>' + esc(kicker) + '</small>' + esc(title) + '</h2>' + (tabs || '') + '<div class="money">' + icon('coin') + profile.money.toLocaleString() + '</div></div>';
  }

  /* ---------------- title ---------------- */
  title() {
    const s = el('div', 'screen fade-in'); s.id = 'title';
    s.innerHTML = '<div class="kicker">AN ASYMMETRICAL HORROR GAME</div><div class="logo worn">FOR<span>L</span>ORN</div><div class="tagline">One killer. Seven survivors. One more night in ObliviousHD\'s world.</div>' +
      '<div class="press">' + (IS_TOUCH ? 'TAP TO PLAY' : 'PRESS ANY BUTTON') + '</div>' +
      '<div class="credit">A fan game. Characters and places from ObliviousHD\'s Roblox films: The Last Guest, Guest 666, Blox Watch, The Bacon Hair. Inspired by Forsaken.<br>Mouse and keyboard · PS5 DualSense · touch</div>';
    s.addEventListener('pointerdown', () => this.game.startFromTitle());
    this._set('title', s);
  }

  /* ---------------- loading ---------------- */
  loading(def) {
    const s = el('div', 'screen fade-in'); s.id = 'loading';
    s.style.background = mapArt(def);
    s.innerHTML = '<div class="film">' + esc(def.film || '') + '</div><div class="map worn">' + esc(def.name) + '</div><div class="blurb">' + esc(def.blurb || '') + '</div><div class="bar"><i></i></div><div class="what"></div><div class="tip"><b>TIP</b><span>' + esc(TIPS[Math.floor(Math.random() * TIPS.length)]) + '</span></div>';
    this._set('loading', s);
    return (f, what) => { s.querySelector('.bar i').style.width = Math.round(f * 100) + '%'; if (what) s.querySelector('.what').textContent = what; };
  }

  /* ---------------- lobby overlay ---------------- */
  lobby() {
    const g = this.game, L = g.lobby;
    const s = el('div', 'screen see-through'); s.id = 'lobby';
    s.innerHTML = '<div class="lobby-top"><div class="inter">INTERMISSION</div><div class="count">0:30</div><div class="sub"></div></div>' +
      '<div class="lobby-me"><div class="row1"><div class="nm"></div><div class="lvl"></div></div><div class="money"></div><div class="xpbar"><i></i></div><div class="mal"><span>Malice</span><b></b></div><div class="malbar"><i></i></div><div class="queue"></div><div class="join hidden"></div></div>' +
      '<div class="lobby-players"><h4 class="label">SERVER</h4><div class="rows"></div></div>' +
      '<div class="lobby-side"></div><div class="vote hidden"></div>';
    const side = s.querySelector('.lobby-side');
    const btn = (label, ic, fn, cls = '') => { const b = el('button', 'btn ' + cls, (ic ? icon(ic) : '') + '<span>' + label + '</span>'); b.onclick = () => { audio.sfx('ui'); fn(); }; side.appendChild(b); return b; };
    btn('Characters', 'people', () => this.push('characters'));
    btn('Shop', 'bag', () => this.push('shop'));
    btn('Killer Chance', 'skull', () => this.push('shop', 'malice'));
    btn('Settings', 'gear', () => this.push('settings'));
    btn('How to play', 'book', () => this.push('howto'));
    const optText = () => (settings.killerOptOut ? 'Killer: off' : 'Killer: on');
    this.optBtn = btn(optText(), 'knife', () => { settings.killerOptOut = !settings.killerOptOut; saveSettings(); this.optBtn.querySelector('span').textContent = optText(); }, 'small');
    this._set('lobby', s);
    this.lobbyEl = s;
    this._voteBuilt = false;
    this._lobbyT = 0;
    if (L && L.timeLeft < 13) this.buildVote();
  }
  buildVote() {
    const L = this.game.lobby, v = this.lobbyEl.querySelector('.vote');
    v.innerHTML = '<div class="label">VOTE FOR THE NEXT MAP</div><div class="cards"></div>';
    const cards = v.querySelector('.cards');
    this.voteCards = L.choices.map((def) => {
      const c = el('button', 'card');
      c.style.background = mapArt(def);
      c.innerHTML = '<div class="you">YOUR VOTE</div><div class="n">' + icon('person') + '<span>0</span></div><div class="nm">' + esc(def.name) + '</div><div class="film">' + esc(def.film) + '</div>';
      c.onclick = () => { L.vote(this.game.server.me, def.id); audio.sfx('ui'); };
      cards.appendChild(c);
      return { c, def };
    });
    v.classList.remove('hidden');
    this._voteBuilt = true;
  }
  updateLobby(dt) {
    const g = this.game, L = g.lobby, s = this.lobbyEl;
    if (!L || !s) return;
    s.querySelector('.count').textContent = fmtTime(L.timeLeft);
    s.querySelector('.lobby-top').classList.toggle('hot', L.timeLeft < 6);
    s.querySelector('.sub').textContent = L.timeLeft < 13 ? 'The vote is open' : g.server.members.length + ' players · the highest malice is the next killer';
    this._lobbyT -= dt;
    if (this._lobbyT <= 0) {
      this._lobbyT = 0.25;
      s.querySelector('.lobby-me .nm').textContent = profile.name;
      s.querySelector('.lobby-me .money').innerHTML = icon('coin') + profile.money.toLocaleString();
      s.querySelector('.lobby-me .lvl').textContent = 'Level ' + profile.level;
      s.querySelector('.lobby-me .xpbar i').style.width = Math.min(100, profile.xp / xpNeed() * 100) + '%';
      const members = g.server.members.slice().sort((a, b) => b.malice - a.malice), top = Math.max(1, ...members.map((m) => m.malice));
      s.querySelector('.lobby-me .mal b').textContent = settings.killerOptOut ? 'killer off' : profile.malice;
      s.querySelector('.lobby-me .malbar i').style.width = (settings.killerOptOut ? 0 : profile.malice / top * 100) + '%';
      const next = members.find((m) => !(m.isMe && settings.killerOptOut));
      const q = g.server.killerQueue(), qe = s.querySelector('.lobby-me .queue');
      qe.textContent = settings.killerOptOut ? 'Killer off' : q.pos === 1 && !q.gap ? 'You are the next killer' : q.pos === 1 ? 'Tied for killer' : '#' + q.pos + ' in line for killer';
      qe.classList.toggle('first', !settings.killerOptOut && q.pos === 1 && !q.gap);
      // split screen: tell a second controller it can join
      const je = s.querySelector('.lobby-me .join'), pads = scanPads().length;
      const ask = !g.p2 && (g.joinWait || pads >= 2);
      je.classList.toggle('hidden', !ask);
      if (ask && je.dataset.v !== String(g.joinWait)) { je.dataset.v = String(g.joinWait); je.innerHTML = icon('people') + (g.joinWait ? 'Player 2: press ' : 'Split screen: a second controller presses ') + '<span class="glyph"><span class="g-face" style="color:#8db8ff"><svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg></span></span> to join'; }
      s.querySelector('.lobby-players .rows').innerHTML = members.map((m) => '<div class="row' + (m.isMe ? ' me' : '') + (m === next ? ' next' : '') + '"><span class="n">' + esc(m.name) + '</span><span class="mb"><i style="width:' + Math.round(m.malice / top * 100) + '%"></i></span><span class="m">' + m.malice + '</span></div>').join('');
      if (L.timeLeft < 13 && !this._voteBuilt) this.buildVote();
      if (this._voteBuilt) {
        const n = L.tally(), mine = L.votes.get(g.server.me);
        for (const { c, def } of this.voteCards) { c.querySelector('.n span').textContent = n.get(def.id) || 0; c.classList.toggle('mine', mine === def.id); }
      }
    }
    // controller: vote with the D-pad when the vote is up
    if (this._voteBuilt && input.device === 'pad') this.nav.update(s.querySelector('.vote'), dt, {});
  }

  /* ---------------- characters ---------------- */
  characters(tab = this._charTab || 'survivor') {
    this._charTab = tab;
    const list = tab === 'survivor' ? SURVIVORS : KILLERS;
    const eq = profile.equipped[tab];
    this._charSel = this._charSel && list.some((c) => c.id === this._charSel) ? this._charSel : eq;
    const s = el('div', 'screen panel-screen fade-in');
    s.innerHTML = this._head('CHARACTERS', 'CHOOSE WHO YOU ARE', '<div class="tabs"><button class="btn" data-tab="survivor">' + icon('person') + 'Survivors</button><button class="btn" data-tab="killer">' + icon('knife') + 'Killers</button></div>') + '<div class="cs"><div class="grid"></div><div class="detail"></div></div>';
    s.querySelector('[data-back]').onclick = () => this.back();
    s.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); b.onclick = () => { this._charSel = null; this.characters(b.dataset.tab); }; });
    this.onTab = () => { this._charSel = null; this.characters(tab === 'survivor' ? 'killer' : 'survivor'); };
    const grid = s.querySelector('.grid');
    for (const c of list) {
      const ready = isReady(c.id), have = owns(c.id) || c.price === 0;
      const card = el('button', 'ccard' + (!ready ? ' forge' : !have ? ' locked' : '') + (c.id === this._charSel ? ' sel' : ''));
      card.style.setProperty('--tint', c.color + '55');
      card.innerHTML = '<span class="bar" style="background:' + c.color + '"></span><img alt="" src="' + portrait(c.id) + '" onerror="this.style.visibility=\'hidden\'"><span class="shade"></span>' + (!ready ? '<span class="soon">IN THE FORGE</span>' : '') + '<span class="nm"><small>' + esc(c.film) + '</small>' + esc(c.name) + '</span>' + (ready && !have ? '<span class="pr">$' + c.price + '</span>' : c.id === eq ? '<span class="pr eq">EQUIPPED</span>' : '');
      card.onclick = () => { this._charSel = c.id; audio.sfx('ui'); this.characters(tab); };
      grid.appendChild(card);
    }
    this._set('characters', s);
    this.detail(s.querySelector('.detail'), byId(this._charSel) || list[0], tab);
    const sel = grid.querySelector('.sel'); if (sel && input.device === 'pad') this.nav.set(sel);
  }
  detail(box, c, tab) {
    const ready = isReady(c.id), have = owns(c.id) || c.price === 0;
    const skin = this._skinSel && this._skinSel.c === c.id ? this._skinSel.s : equippedSkin(c.id);
    const bar = (label, val, f, cls = '') => '<span>' + label + '</span><span><b>' + val + '</b><span class="sb ' + cls + '"><i style="width:' + Math.round(clamp(f, 0.05, 1) * 100) + '%"></i></span></span>';
    const stats = tab === 'survivor'
      ? bar('Health', c.hp, (c.hp - 60) / 80, 's') + bar('Speed', Math.round(c.speed * 100) + '%', (c.speed - 0.85) / 0.25, 's') + bar('Stamina', c.stamina, (c.stamina - 80) / 50, 's')
      : bar('Attack', esc(c.m1.name) + ' · ' + c.m1.dmg, c.m1.dmg / 40) + bar('Speed', Math.round(c.speed * 100) + '%', (c.speed - 0.85) / 0.25) + bar('Swing', c.m1.cd + 's', 1.6 - c.m1.cd);
    const abil = (c.passive ? '<div class="abil p"><div class="k">' + icon('star') + '</div><div><b>' + esc(c.passive.name) + ' <span>passive</span></b><span>' + esc(c.passive.text) + '</span></div></div>' : '') +
      (tab === 'killer' ? '<div class="abil"><div class="k">' + abilityIcon(/claw/i.test(c.m1.name) ? 'claw' : 'm1', 'M1') + '</div><div><b>' + esc(c.m1.name) + ' ' + glyph('attack') + '</b><span>' + c.m1.dmg + ' damage, every ' + c.m1.cd + 's.</span></div></div>' : '') +
      c.abilities.map((a, i) => '<div class="abil"><div class="k">' + abilityIcon(a.id, (ABILITIES[a.id] && ABILITIES[a.id].icon) || a.key) + '</div><div><b>' + esc(a.name) + ' ' + glyph(['ability1', 'ability2', 'ability3'][i], 'ab:' + a.id) + ' <span>' + a.cd + 's cooldown</span></b><span>' + esc(a.text) + '</span></div></div>').join('');
    box.innerHTML = '<div class="art"><div class="glow" style="background:' + c.color + '"></div><div class="role">' + (tab === 'survivor' ? 'SURVIVOR' : 'KILLER') + '</div><img alt="" src="' + portrait(c.id, skin) + '" onerror="this.style.visibility=\'hidden\'"></div><div class="info"><div class="film">' + esc(c.film) + '</div><h3>' + esc(c.name) + '</h3><div class="ttl">' + esc(c.title) + '</div><div class="bio">' + esc(c.bio) + '</div><div class="stats">' + stats + '</div>' + abil + '<div class="label" style="margin-top:.5rem">SKINS</div><div class="skins"></div><div class="act"></div></div>';
    const sk = box.querySelector('.skins');
    for (const k of c.skins) {
      const kready = k.id === 'default' ? ready : isReady(c.id + '_' + k.id), kown = k.id === 'default' || owns(c.id, k.id);
      const b = el('button', 'skin' + (k.id === skin ? ' on' : ''), '<img alt="" src="' + portrait(c.id, k.id) + '" onerror="this.style.visibility=\'hidden\'"><span>' + esc(k.name) + (!kready ? '<br>forging' : !kown ? '<br><b>$' + k.price + '</b>' : '') + '</span>');
      if (!kready) b.disabled = true; else b.dataset.nav = '1';
      b.onclick = () => { this._skinSel = { c: c.id, s: k.id }; audio.sfx('ui_move'); this.detail(box, c, tab); };
      sk.appendChild(b);
    }
    const act = box.querySelector('.act');
    const skinOwned = skin === 'default' || owns(c.id, skin);
    if (!ready) act.innerHTML = '<span style="color:var(--dim);font-size:.85rem">Still being sculpted in Advance Forge.</span>';
    else if (!have) {
      const b = el('button', 'btn primary', icon('coin') + 'Buy · $' + c.price);
      b.disabled = profile.money < c.price;
      b.onclick = () => { if (profile.money < c.price) return audio.sfx('deny'); profile.money -= c.price; grant(c.id, 'default'); audio.sfx('buy'); this.characters(tab); };
      act.appendChild(b);
    } else if (!skinOwned) {
      const price = (c.skins.find((k) => k.id === skin) || {}).price || 0;
      const b = el('button', 'btn primary', icon('coin') + 'Buy skin · $' + price);
      b.disabled = profile.money < price;
      b.onclick = () => { if (profile.money < price) return audio.sfx('deny'); profile.money -= price; grant(c.id, skin); audio.sfx('buy'); this.characters(tab); };
      act.appendChild(b);
    } else {
      const isEq = profile.equipped[tab] === c.id && equippedSkin(c.id) === skin;
      const b = el('button', 'btn primary', (isEq ? icon('check') + 'Equipped' : 'Equip'));
      b.disabled = isEq;
      b.onclick = () => {
        profile.equipped[tab] = c.id; profile.equipped.skins[c.id] = skin; saveProfile(); audio.sfx('buy');
        if (tab === 'survivor' && this.game.lobby) this.game.lobby.refreshMe();
        this.characters(tab);
      };
      act.appendChild(b);
    }
  }

  /* ---------------- shop ---------------- */
  shop(tab = this._shopTab || 'survivors') {
    if (tab === 'characters') tab = 'survivors';
    this._shopTab = tab;
    const TABS = [['survivors', 'person', 'Survivors'], ['killers', 'knife', 'Killers'], ['skins', 'star', 'Skins'], ['malice', 'skull', 'Killer Chance']];
    const s = el('div', 'screen panel-screen fade-in');
    s.innerHTML = this._head('SHOP', 'SPEND WHAT YOU SURVIVED FOR', '<div class="tabs">' + TABS.map(([id, ic, l]) => '<button class="btn" data-tab="' + id + '">' + icon(ic) + l + '</button>').join('') + '</div>') + '<div class="cs" style="grid-template-columns:1fr"><div class="grid"></div></div>';
    s.querySelector('[data-back]').onclick = () => this.back();
    s.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); b.onclick = () => { audio.sfx('ui'); this.shop(b.dataset.tab); }; });
    this.onTab = (dir = 1) => { const i = TABS.findIndex((t) => t[0] === tab); this.shop(TABS[(i + (dir < 0 ? TABS.length - 1 : 1)) % TABS.length][0]); };
    const grid = s.querySelector('.grid');
    if (tab === 'malice') { this._maliceShop(grid); this._set('shop', s); return; }
    const items = [];
    for (const c of tab === 'survivors' ? SURVIVORS : tab === 'killers' ? KILLERS : [...SURVIVORS, ...KILLERS]) {
      if (tab !== 'skins') items.push({ c, skin: 'default', name: c.name, sub: c.film, price: c.price, ready: isReady(c.id), have: owns(c.id) || c.price === 0, role: tab === 'killers' ? 'killer' : 'survivor' });
      else for (const k of c.skins) if (k.id !== 'default') items.push({ c, skin: k.id, name: k.name, sub: c.name, price: k.price, ready: isReady(c.id + '_' + k.id), have: owns(c.id, k.id) });
    }
    items.sort((a, b) => (b.ready - a.ready) || (a.have - b.have) || a.price - b.price);
    for (const it of items) {
      const eq = it.role && profile.equipped[it.role] === it.c.id;
      const card = el('button', 'ccard' + (!it.ready ? ' forge' : it.have ? '' : ' locked') + (eq ? ' sel' : ''));
      card.style.setProperty('--tint', it.c.color + '55');
      const tag = eq ? '<span class="pr eq">EQUIPPED</span>' : it.have ? '<span class="pr own">' + (it.role ? 'EQUIP' : 'OWNED') + '</span>' : '<span class="pr">$' + it.price + '</span>';
      card.innerHTML = '<span class="bar" style="background:' + it.c.color + '"></span><img alt="" src="' + portrait(it.c.id, it.skin) + '" onerror="this.style.visibility=\'hidden\'"><span class="shade"></span>' + (!it.ready ? '<span class="soon">IN THE FORGE</span>' : '') + '<span class="nm"><small>' + esc(it.sub) + '</small>' + esc(it.name) + '</span>' + tag;
      card.onclick = () => {
        if (!it.ready) return audio.sfx('deny');
        const equip = () => { profile.equipped[it.role] = it.c.id; saveProfile(); if (it.role === 'survivor' && this.game.lobby) this.game.lobby.refreshMe(); };
        if (it.have) {
          if (!it.role || eq) return audio.sfx('deny');
          equip(); audio.sfx('ui'); this.game.hud.toast('Equipped ' + it.name + (it.role === 'killer' ? ': you play them when you are the killer' : '')); return this.shop(tab);
        }
        if (it.skin !== 'default' && !(owns(it.c.id) || it.c.price === 0)) { this.game.hud.toast('Buy ' + it.c.name + ' first'); return audio.sfx('deny'); }
        if (profile.money < it.price) { this.game.hud.toast('Not enough money: $' + (it.price - profile.money) + ' more'); return audio.sfx('deny'); }
        profile.money -= it.price; grant(it.c.id, it.skin); audio.sfx('buy');
        if (it.role) equip(); else { profile.equipped.skins[it.c.id] = it.skin; saveProfile(); }
        this.game.hud.toast('Bought and equipped ' + it.name + (it.skin !== 'default' ? ' (' + it.c.name + ')' : ''));
        this.shop(tab);
      };
      grid.appendChild(card);
    }
    this._set('shop', s);
  }
  /** Killer Chance: buy malice, as in Forsaken. The highest malice in the server is the next killer. */
  _maliceShop(grid) {
    grid.style.display = 'block';
    const q = this.game.server.killerQueue();
    const where = settings.killerOptOut ? 'Killer is switched off: turn it on in the lobby to be picked.' : q.pos === 1 && !q.gap ? 'You are the next killer.' : q.pos === 1 ? 'You are tied for killer: ' + q.gap + ' more malice and it is yours.' : 'You are number ' + q.pos + ' in line to be the killer' + (q.gap > 0 ? ': ' + q.gap + ' more malice to be first.' : '.');
    const box = el('div', 'malice-shop', '<div class="mal-now"><div class="label">YOUR MALICE</div><b>' + profile.malice + '</b><span>' + esc(where) + '</span><small>Every round you are not the killer, your malice goes up. The highest malice in the server plays the killer next round, then drops back to zero.</small></div><div class="mal-packs"></div>');
    const packs = box.querySelector('.mal-packs');
    for (const [n, price] of [[15, 150], [30, 250]]) {
      const b = el('button', 'mal-pack', '<span class="ic">' + icon('knife') + '</span><b>+' + n + '</b><span>MALICE</span><em>$' + price + '</em>');
      b.dataset.nav = '1';
      b.onclick = () => {
        if (profile.money < price) { this.game.hud.toast('Not enough money: $' + (price - profile.money) + ' more'); return audio.sfx('deny'); }
        profile.money -= price; profile.malice += n; this.game.server.me.malice = profile.malice; saveProfile(); audio.sfx('buy');
        if (settings.killerOptOut) { settings.killerOptOut = false; saveSettings(); }
        const q2 = this.game.server.killerQueue();
        this.game.hud.toast('+' + n + ' malice' + (q2.pos === 1 && !q2.gap ? ': you are the next killer' : ''));
        this.shop('malice');
      };
      packs.appendChild(b);
    }
    grid.appendChild(box);
  }

  /* ---------------- settings ---------------- */
  settings() {
    const s = el('div', 'screen panel-screen fade-in');
    s.innerHTML = this._head('SETTINGS', 'MAKE IT YOURS') + '<div class="settings"></div>';
    s.querySelector('[data-back]').onclick = () => this.back();
    this.onTab = null;
    const box = s.querySelector('.settings');
    const sec = (t) => box.appendChild(el('div', 'label set-sec', esc(t)));
    const row = (label, small, ctl) => { const r = el('div', 'set-row', '<label>' + esc(label) + (small ? '<small>' + esc(small) + '</small>' : '') + '</label>'); const c = el('div', 'ctl'); ctl(c); r.appendChild(c); box.appendChild(r); };
    const choice = (key, opts, after) => (c) => { for (const [v, l] of opts) { const b = el('button', 'btn' + (settings[key] === v ? ' on' : ''), l); b.onclick = () => { settings[key] = v; saveSettings(); after && after(v); this.settings(); }; c.appendChild(b); } };
    const num = (key, min, max, step, fmt, after) => (c) => {
      const minus = el('button', 'btn', '−'), val = el('span', 'val', fmt(settings[key])), plus = el('button', 'btn', '+');
      const show = () => { val.textContent = fmt(settings[key]); val.style.setProperty('--f', Math.round((settings[key] - min) / (max - min) * 100) + '%'); };
      const set = (v) => { settings[key] = Math.round(Math.max(min, Math.min(max, v)) / step) * step; show(); saveSettings(); after && after(); };
      minus.onclick = () => set(settings[key] - step); plus.onclick = () => set(settings[key] + step);
      c.append(minus, val, plus); show();
    };
    sec('PROFILE');
    row('Name', 'What everyone sees over your head', (c) => { const i = el('input'); i.type = 'text'; i.maxLength = 20; i.value = profile.name; i.onfocus = () => { input.typing = true; }; i.onblur = () => { input.typing = false; }; i.onchange = () => { profile.name = (i.value.trim() || 'Player').slice(0, 20); this.game.server.me.name = profile.name; saveProfile(); }; i.addEventListener('keydown', (e) => e.stopPropagation()); c.appendChild(i); });
    sec('VIDEO');
    row('Graphics', 'Low for phones; Ultra for strong PCs', choice('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], (v) => this.game.renderer.setQuality(v)));
    row('Resolution scale', '', num('renderScale', 0.5, 1, 0.05, (v) => Math.round(v * 100) + '%', () => this.game.renderer.resize()));
    row('Field of view', '', num('fov', 55, 100, 5, (v) => v + '°'));
    row('Camera shake', '', choice('shake', [[true, 'On'], [false, 'Off']]));
    sec('CONTROLS');
    row('Look sensitivity', 'Mouse, stick and touch', num('sensitivity', 0.2, 3, 0.1, (v) => v.toFixed(1)));
    row('Invert look', '', choice('invertY', [[false, 'Off'], [true, 'On']]));
    sec('SURVIVOR UI');
    row('Survivor UI', 'The survivor list down the left of the screen', choice('survivorUi', [[true, 'On'], [false, 'Off']]));
    row('Status display', 'How the survivor list is laid out', choice('statusLayout', [['side', 'Side'], ['stacked', 'Stacked'], ['icons', 'Icons']]));
    row('Health display type', 'Show teammates\' health as health or as a percentage', choice('healthDisplay', [['health', 'Health'], ['percent', 'Percentage']]));
    row('Stamina counter', 'A number on your stamina bar', choice('staminaCounter', [[true, 'On'], [false, 'Off']]));
    sec('AUDIO');
    row('Master volume', '', num('master', 0, 1, 0.1, (v) => Math.round(v * 100) + '%', () => audio.applyVolumes()));
    row('Music', 'Soundtrap exports in assets/music/ replace the built-in songs', num('music', 0, 1, 0.1, (v) => Math.round(v * 100) + '%', () => audio.applyVolumes()));
    row('Effects', '', num('sfx', 0, 1, 0.1, (v) => Math.round(v * 100) + '%', () => audio.applyVolumes()));
    sec('GAMEPLAY');
    row('Bot chat', 'The other players talking', choice('botChat', [[true, 'On'], [false, 'Off']]));
    row('Play as killer', 'Off: you are never picked as the killer', choice('killerOptOut', [[false, 'On'], [true, 'Off']]));
    sec('BUTTONS');
    box.appendChild(el('div', 'set-row ctl-row', controlsList()));
    this._set('settings', s);
  }

  /* ---------------- the lobby menu (OPTIONS / Esc / ☰ in the lobby) ---------------- */
  lobbyMenu() {
    const s = el('div', 'screen pause fade-in');
    s.innerHTML = '<h2><small>INTERMISSION</small>MENU</h2>';
    const b = (label, ic, fn, cls = '') => { const x = el('button', 'btn ' + cls, icon(ic) + label); x.onclick = () => { audio.sfx('ui'); fn(); }; s.appendChild(x); };
    b('Back to the camp', 'play', () => this.game.resume(), 'primary');
    b('Characters', 'people', () => { this.stack = ['lobby']; this.characters(); });
    b('Shop', 'bag', () => { this.stack = ['lobby']; this.shop(); });
    b('Settings', 'gear', () => { this.stack = ['lobby']; this.settings(); });
    b('How to play', 'book', () => { this.stack = ['lobby']; this.howto(); });
    if (this.game.p2) b('Remove player 2', 'door', () => { this.game.resume(); this.game.removePlayer2(); });
    else b('Add player 2', 'people', () => { this.game.joinWait = true; this.game.resume(); this.game.chat.system('Split screen: Player 2, press ✕ on your controller to join'); });
    this.onTab = null;
    this._set('lobbymenu', s);
    if (input.device === 'pad') this.nav.set(s.querySelector('.btn'));
  }

  /* ---------------- how to play ---------------- */
  howto() {
    const s = el('div', 'screen panel-screen fade-in');
    const sec = (ic, t, body) => '<div class="set-row"><label>' + icon(ic) + t + '</label><small>' + body + '</small></div>';
    s.innerHTML = this._head('HOW TO PLAY', 'ONE KILLER · SEVEN SURVIVORS') + '<div class="settings howto">' +
      sec('gear', 'Controls', (input.device === 'touch' ? 'Push the stick far to run. Each ability has its own round button, with its picture and name on it. ' : '') + 'Pick up another controller, keyboard or touch screen at any time and these change to match.') + controlsList() +
      sec('person', 'Survivors', 'Survive until the timer runs out. Every generator you repair takes 20 seconds off it: stand at one and press interact, then join the matching wires. A wrong wire sparks, and the killer hears it. Pick up medkits and Bloxy Colas. Use your two abilities to stun, heal, hide or outrun the killer, and loop it round walls and buildings. Your heart beats faster the closer the killer is.') +
      sec('knife', 'The killer', 'Kill every survivor before the timer runs out. Your attack hits in front of you; your three abilities hunt, trap and punish. You are a little faster than a sprinting survivor, but they loop and stun you.') +
      sec('note', 'Last Man Standing', 'When one survivor is left, the song starts. The round now lasts exactly as long as the song. The survivor gets a burst of speed and stamina; the killer starts in a Frenzy.') +
      sec('star', 'What is different here', '<b>Bond</b>: stay near another survivor for a while and you bond. Bonded survivors repair faster and see each other through walls. <b>Echoes</b>: dead survivors can reveal the killer to the living once a round. <b>Bloodlust</b>: the killer fills it by hitting and chasing; when it boils over, a Frenzy. <b>Events</b>: every map has its own, halfway through: an air raid, a lockdown, a blackout, a curfew.') +
      sec('skull', 'Who is the killer?', 'Every round you are not the killer, your malice goes up. The highest malice is the next killer. Turn "Play as killer" off in Settings to stay a survivor.') +
      sec('people', 'Split screen', 'Two players on one screen, each with a controller. In the camp, a second controller presses ✕ (A on Xbox) to join, or pick <b>Add player 2</b> from the menu to play player one on keyboard and mouse. The screen splits down the middle; both of you play the next rounds, on the same side or against each other. Player two changes survivor with L1 / R1 and killer with L2 / R2, and holds ○ (B) to leave.') +
      '</div>';
    s.querySelector('[data-back]').onclick = () => this.back();
    this.onTab = null;
    this._set('howto', s);
  }

  /* ---------------- pause ---------------- */
  pause() {
    const s = el('div', 'screen pause fade-in');
    const M = this.game.match;
    s.innerHTML = '<h2><small>' + esc(M ? M.def.name.toUpperCase() : '') + '</small>PAUSED</h2>';
    const b = (label, ic, fn, cls = '') => { const x = el('button', 'btn ' + cls, icon(ic) + label); x.onclick = () => { audio.sfx('ui'); fn(); }; s.appendChild(x); };
    b('Resume', 'play', () => this.game.resume(), 'primary');
    b('Settings', 'gear', () => this.push('settings'));
    b('Leave round', 'door', () => this.game.forfeit());
    this.onTab = null;
    this._set('pause', s);
  }

  /* ---------------- results ---------------- */
  results(res, onDone) {
    const meRow = res.rows.find((r) => r.member && r.member.isMe);
    const local = (r) => r.member && (r.member.isMe || r.member.local);
    const k = res.winner === 'killer';
    const s = el('div', 'screen results fade-in' + (k ? '' : ' s'));
    const win = meRow ? (meRow.role === 'killer') === k : !k;
    const title = meRow ? (win ? (meRow.role === 'killer' ? 'THE HUNT IS OVER' : 'YOU SURVIVED') : (meRow.role === 'killer' ? 'THEY GOT AWAY' : 'YOU DIED')) : (k ? 'KILLER WINS' : 'SURVIVORS WIN');
    const label = { escaped: ['Survived', 'st-esc', 'heart'], dead: ['Dead', 'st-dead', 'skull'], killer: ['Killer', 'st-k', 'knife'], left: ['Left', 'st-left', 'door'] };
    const rows = res.rows.map((r, i) => {
      const L = label[r.status];
      return '<div class="pr' + (local(r) ? ' me' : '') + '" style="animation-delay:' + (0.15 + i * 0.05) + 's"><span class="pic" style="background-image:url(' + portrait(r.charId || '', r.skin) + ')"></span><span class="n">' + esc(r.name) + '</span><span class="c">' + esc(r.char) + '</span><span class="stamp ' + L[1] + '">' + icon(L[2]) + L[0] + '</span><span class="num">' + r.stats.gens + '</span><span class="num">' + r.stats.stuns + '</span><span class="num">' + (r.role === 'killer' ? r.stats.kills : Math.round(r.stats.heals)) + '</span><span class="cash">$' + r.money + '</span></div>';
    }).join('');
    s.innerHTML = '<div class="win worn ' + (k ? 'k' : 's') + '">' + title + '</div><div class="why">' + esc(res.reason || '') + ' · ' + esc(res.map.name) + (res.lms ? ' · LMS: ' + esc(res.lms.name) + (res.lms.won ? ' clutched it' : ' fell') : '') + '</div>' +
      '<div class="players"><div class="pr h"><span></span><span>PLAYER</span><span>CHARACTER</span><span>RESULT</span><span class="num">GENS</span><span class="num">STUNS</span><span class="num">HEAL/K</span><span class="cash">EARNED</span></div>' + rows + '</div>' +
      (meRow ? '<div class="earn"><div><b>' + icon('coin') + '+' + meRow.money + '</b><span>Money</span></div><div><b class="xp">' + icon('star') + '+' + meRow.xp + '</b><span>XP</span></div></div>' : '') +
      '<div class="lines"></div><button class="btn primary" data-go>Continue</button>';
    s.querySelector('[data-go]').onclick = () => onDone();
    this._resultsT = 14; this._resultsDone = onDone; this._resBtn = s.querySelector('[data-go]');
    this.onTab = null;
    this._set('results', s);
    if (input.device === 'pad') this.nav.set(this._resBtn);
  }
  updateResults(dt) {
    this._resultsT -= dt;
    if (this._resBtn) this._resBtn.textContent = 'Continue (' + Math.max(0, Math.ceil(this._resultsT)) + ')';
    if (this._resultsT <= 0 && this._resultsDone) { const f = this._resultsDone; this._resultsDone = null; f(); }
  }

  /* ---------------- cinematic cards ---------------- */
  introCard(match, me) {
    const k = match.killer;
    const c = el('div', 'letterbox');
    c.style.position = 'absolute'; c.style.inset = '0'; c.style.pointerEvents = 'none';
    const role = me && me.role === 'killer' ? 'YOU ARE THE KILLER' : 'THE KILLER IS';
    const inner = el('div', 'intro-card');
    inner.innerHTML = '<div class="role">' + role + '</div><div class="nm k worn">' + esc(k.def.name.toUpperCase()) + '</div><div class="sub">' + esc(k.name) + ' · ' + esc(match.def.name) + '</div><div class="film">' + esc(k.def.title || '') + '</div>';
    c.appendChild(inner);
    this.overlay.appendChild(c);
    return c;
  }
  vsCard(s, k, track) {
    const v = el('div', 'vs');
    v.innerHTML = '<div class="lms worn">LAST MAN STANDING</div>' +
      '<div class="half l"><img alt="" src="' + portrait(s.charId, s.skin) + '" onerror="this.style.visibility=\'hidden\'"><div class="nm">' + esc(s.def.name.toUpperCase()) + '<small>' + esc(s.name) + '</small></div></div>' +
      '<div class="half r"><img alt="" src="' + portrait(k.charId, k.skin) + '" onerror="this.style.visibility=\'hidden\'"><div class="nm">' + esc(k.def.name.toUpperCase()) + '<small>' + esc(k.name) + '</small></div></div>' +
      '<div class="mid">VS</div><div class="track">♪ ' + esc(track) + '</div>';
    this.overlay.appendChild(v);
    setTimeout(() => v.classList.add('out'), 3600);
    setTimeout(() => v.remove(), 4200);
  }
}
void music;
