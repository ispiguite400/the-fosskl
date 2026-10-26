/*
 * Every menu: title, loading, the lobby overlay (intermission, players, map vote), character
 * select, shop, settings, pause, results, and the cinematic cards (round intro, LMS VS card).
 */
import { el, esc, fmtTime } from '../core/util.js';
import { profile, settings, saveProfile, saveSettings, owns, grant, equippedSkin } from '../core/save.js';
import { SURVIVORS, KILLERS, isReady, byId } from '../data/characters.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { music } from '../audio/music.js';
import { portrait, mapArt } from './art.js';
import { MenuNav } from './nav.js';
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
  'Some teammates will save you. Some will lead the killer straight to you.'
];

export class UI {
  constructor(game) {
    this.game = game;
    this.screens = document.getElementById('screens');
    this.overlay = document.getElementById('overlay');
    this.cur = null; this.curName = ''; this.stack = [];
    this.nav = new MenuNav();
  }
  /** A blocking menu is up (the player is not playing). */
  modal() { return ['characters', 'shop', 'settings', 'pause', 'title', 'loading', 'results'].includes(this.curName); }
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
      onBack: this.curName === 'results' ? null : () => (this.curName === 'pause' ? this.game.resume() : this.stack.length ? this.back() : null),
      onTab: this.onTab
    });
    if (this.curName === 'results') this.updateResults(dt);
  }

  /* ---------------- title ---------------- */
  title() {
    const s = el('div', 'screen fade-in'); s.id = 'title';
    s.innerHTML = '<div class="logo">FOR<span>L</span>ORN</div><div class="tag">An asymmetrical survival game · ObliviousHD\'s films</div>' +
      '<div class="press">' + (IS_TOUCH ? 'TAP TO PLAY' : 'PRESS ANY BUTTON') + '</div>' +
      '<div class="credit">A fan game. Characters from ObliviousHD\'s Roblox films (The Last Guest, Guest 666, Blox Watch). Inspired by Forsaken.<br>Works with mouse and keyboard, PS5 DualSense and touch.</div>';
    s.addEventListener('pointerdown', () => this.game.startFromTitle());
    this._set('title', s);
  }

  /* ---------------- loading ---------------- */
  loading(def) {
    const s = el('div', 'screen fade-in'); s.id = 'loading';
    s.innerHTML = '<div class="film">' + esc(def.film || '') + '</div><div class="map">' + esc(def.name) + '</div><div style="color:var(--dim);font-size:.85rem;margin-top:.3rem">' + esc(def.blurb || '') + '</div><div class="bar"><i></i></div><div class="what" style="margin-top:.5rem;font-size:.75rem;color:var(--faint)"></div><div class="tip">' + esc(TIPS[Math.floor(Math.random() * TIPS.length)]) + '</div>';
    this._set('loading', s);
    return (f, what) => { s.querySelector('.bar i').style.width = Math.round(f * 100) + '%'; if (what) s.querySelector('.what').textContent = what; };
  }

  /* ---------------- lobby overlay ---------------- */
  lobby() {
    const g = this.game, L = g.lobby;
    const s = el('div', 'screen see-through'); s.id = 'lobby';
    s.innerHTML = '<div class="lobby-top"><div class="inter">INTERMISSION</div><div class="count">0:30</div><div class="sub"></div></div>' +
      '<div class="lobby-me"><div class="nm"></div><div class="money"></div><div class="lvl"></div><div class="xpbar"><i></i></div><div class="mal"></div></div>' +
      '<div class="lobby-players"><h4>PLAYERS</h4><div class="rows"></div></div>' +
      '<div class="lobby-side"></div><div class="vote hidden"></div>';
    const side = s.querySelector('.lobby-side');
    const btn = (label, fn, cls = '') => { const b = el('button', 'btn ' + cls, label); b.onclick = () => { audio.sfx('ui'); fn(); }; side.appendChild(b); return b; };
    btn('Characters', () => this.push('characters'));
    btn('Shop', () => this.push('shop'));
    btn('Settings', () => this.push('settings'));
    this.optBtn = btn(settings.killerOptOut ? 'Killer: off' : 'Killer: on', () => { settings.killerOptOut = !settings.killerOptOut; saveSettings(); this.optBtn.textContent = settings.killerOptOut ? 'Killer: off' : 'Killer: on'; }, 'small');
    this._set('lobby', s);
    this.lobbyEl = s;
    this._voteBuilt = false;
    this._lobbyT = 0;
    if (L && L.timeLeft < 13) this.buildVote();
  }
  buildVote() {
    const L = this.game.lobby, v = this.lobbyEl.querySelector('.vote');
    v.innerHTML = '';
    this.voteCards = L.choices.map((def) => {
      const c = el('button', 'card');
      c.innerHTML = '<div class="art" style="background:' + mapArt(def) + '"><div class="n">0</div></div><div class="nm">' + esc(def.name) + '</div><div class="film">' + esc(def.film) + '</div>';
      c.onclick = () => { L.vote(this.game.server.me, def.id); audio.sfx('ui'); };
      v.appendChild(c);
      return { c, def };
    });
    v.classList.remove('hidden');
    this._voteBuilt = true;
  }
  updateLobby(dt) {
    const g = this.game, L = g.lobby, s = this.lobbyEl;
    if (!L || !s) return;
    s.querySelector('.count').textContent = fmtTime(L.timeLeft);
    s.querySelector('.sub').textContent = L.timeLeft < 13 ? 'Vote for the next map' : g.server.members.length + ' players · next killer: highest malice';
    this._lobbyT -= dt;
    if (this._lobbyT <= 0) {
      this._lobbyT = 0.25;
      s.querySelector('.lobby-me .nm').textContent = profile.name;
      s.querySelector('.lobby-me .money').textContent = '$' + profile.money.toLocaleString();
      s.querySelector('.lobby-me .lvl').textContent = 'Level ' + profile.level;
      s.querySelector('.lobby-me .xpbar i').style.width = Math.min(100, profile.xp / (120 + profile.level * 40) * 100) + '%';
      s.querySelector('.lobby-me .mal').textContent = 'Malice ' + profile.malice + (settings.killerOptOut ? ' (killer off)' : '');
      const rows = g.server.members.slice().sort((a, b) => b.malice - a.malice).map((m) => '<div class="row' + (m.isMe ? ' me' : '') + '"><span>' + esc(m.name) + '</span><span class="m">' + m.malice + '</span></div>').join('');
      s.querySelector('.lobby-players .rows').innerHTML = rows;
      if (L.timeLeft < 13 && !this._voteBuilt) this.buildVote();
      if (this._voteBuilt) {
        const n = L.tally(), mine = L.votes.get(g.server.me);
        for (const { c, def } of this.voteCards) { c.querySelector('.n').textContent = n.get(def.id) || 0; c.classList.toggle('mine', mine === def.id); }
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
    s.innerHTML = '<div class="panel-head"><button class="btn small" data-back>◀ Back</button><h2>CHARACTERS</h2><div class="tabs"><button class="btn" data-tab="survivor">Survivors</button><button class="btn" data-tab="killer">Killers</button></div><div class="money">$' + profile.money.toLocaleString() + '</div></div><div class="cs"><div class="grid"></div><div class="detail"></div></div>';
    s.querySelector('[data-back]').onclick = () => this.back();
    s.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); b.onclick = () => { this._charSel = null; this.characters(b.dataset.tab); }; });
    this.onTab = () => { this._charSel = null; this.characters(tab === 'survivor' ? 'killer' : 'survivor'); };
    const grid = s.querySelector('.grid');
    for (const c of list) {
      const ready = isReady(c.id), have = owns(c.id) || c.price === 0;
      const card = el('button', 'ccard' + (!ready ? ' forge' : !have ? ' locked' : '') + (c.id === this._charSel ? ' sel' : ''));
      card.innerHTML = '<span class="bar" style="background:' + c.color + '"></span><img alt="" src="' + portrait(c.id) + '" onerror="this.style.visibility=\'hidden\'"><span class="shade"></span>' + (!ready ? '<span class="soon">IN THE FORGE</span>' : '') + '<span class="nm">' + esc(c.name) + '</span>' + (ready && !have ? '<span class="pr">$' + c.price + '</span>' : c.id === eq ? '<span class="pr" style="color:var(--cyan)">EQUIPPED</span>' : '');
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
    const stats = tab === 'survivor' ? '<span>Health <b>' + c.hp + '</b></span><span>Speed <b>' + Math.round(c.speed * 100) + '%</b></span><span>Stamina <b>' + c.stamina + '</b></span>' : '<span>Attack <b>' + esc(c.m1.name) + ' ' + c.m1.dmg + '</b></span><span>Speed <b>' + Math.round(c.speed * 100) + '%</b></span>';
    const abil = (c.passive ? '<div class="abil"><div class="k">P</div><div><b>' + esc(c.passive.name) + '</b><span>' + esc(c.passive.text) + '</span></div></div>' : '') +
      (tab === 'killer' ? '<div class="abil"><div class="k">M1</div><div><b>' + esc(c.m1.name) + '</b><span>' + c.m1.dmg + ' damage, every ' + c.m1.cd + 's.</span></div></div>' : '') +
      c.abilities.map((a) => '<div class="abil"><div class="k">' + ((ABILITIES[a.id] && ABILITIES[a.id].icon) || a.key) + '</div><div><b>' + esc(a.name) + ' <span style="color:var(--faint)">' + a.key + ' · ' + a.cd + 's</span></b><span>' + esc(a.text) + '</span></div></div>').join('');
    box.innerHTML = '<div class="art"><div class="glow" style="background:' + c.color + '"></div><img alt="" src="' + portrait(c.id, skin) + '" onerror="this.style.visibility=\'hidden\'"></div><div class="info"><div class="film">' + esc(c.film) + '</div><h3>' + esc(c.name) + '</h3><div class="ttl">' + esc(c.title) + '</div><div class="bio">' + esc(c.bio) + '</div><div class="stats">' + stats + '</div>' + abil + '<div class="skins"></div><div class="act"></div></div>';
    const sk = box.querySelector('.skins');
    for (const k of c.skins) {
      const kready = k.id === 'default' ? ready : isReady(c.id + '_' + k.id), kown = k.id === 'default' || owns(c.id, k.id);
      const b = el('button', 'btn small' + (k.id === skin ? ' on' : ''), esc(k.name) + (!kready ? ' · forging' : !kown ? ' · $' + k.price : ''));
      if (!kready) b.disabled = true;
      b.onclick = () => { this._skinSel = { c: c.id, s: k.id }; this.detail(box, c, tab); };
      sk.appendChild(b);
    }
    const act = box.querySelector('.act');
    const skinOwned = skin === 'default' || owns(c.id, skin);
    if (!ready) act.innerHTML = '<span style="color:var(--dim);font-size:.85rem">Still being sculpted in Advance Forge.</span>';
    else if (!have) {
      const b = el('button', 'btn primary', 'Buy · $' + c.price);
      b.disabled = profile.money < c.price;
      b.onclick = () => { if (profile.money < c.price) return audio.sfx('deny'); profile.money -= c.price; grant(c.id, 'default'); audio.sfx('buy'); this.characters(tab); };
      act.appendChild(b);
    } else if (!skinOwned) {
      const price = (c.skins.find((k) => k.id === skin) || {}).price || 0;
      const b = el('button', 'btn primary', 'Buy skin · $' + price);
      b.disabled = profile.money < price;
      b.onclick = () => { if (profile.money < price) return audio.sfx('deny'); profile.money -= price; grant(c.id, skin); audio.sfx('buy'); this.characters(tab); };
      act.appendChild(b);
    } else {
      const isEq = profile.equipped[tab] === c.id && equippedSkin(c.id) === skin;
      const b = el('button', 'btn primary', isEq ? 'Equipped' : 'Equip');
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
  shop(tab = this._shopTab || 'characters') {
    this._shopTab = tab;
    const s = el('div', 'screen panel-screen fade-in');
    s.innerHTML = '<div class="panel-head"><button class="btn small" data-back>◀ Back</button><h2>SHOP</h2><div class="tabs"><button class="btn" data-tab="characters">Characters</button><button class="btn" data-tab="skins">Skins</button></div><div class="money">$' + profile.money.toLocaleString() + '</div></div><div class="cs" style="grid-template-columns:1fr"><div class="grid"></div></div>';
    s.querySelector('[data-back]').onclick = () => this.back();
    s.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); b.onclick = () => this.shop(b.dataset.tab); });
    this.onTab = () => this.shop(tab === 'characters' ? 'skins' : 'characters');
    const grid = s.querySelector('.grid');
    const items = [];
    for (const c of [...SURVIVORS, ...KILLERS]) {
      if (tab === 'characters') { if (c.price > 0) items.push({ c, skin: 'default', name: c.name, price: c.price, ready: isReady(c.id), have: owns(c.id) }); }
      else for (const k of c.skins) if (k.id !== 'default') items.push({ c, skin: k.id, name: k.name + ' ' + c.name, price: k.price, ready: isReady(c.id + '_' + k.id), have: owns(c.id, k.id) });
    }
    items.sort((a, b) => (b.ready - a.ready) || (a.have - b.have) || a.price - b.price);
    for (const it of items) {
      const card = el('button', 'ccard' + (!it.ready ? ' forge' : it.have ? '' : ' locked'));
      card.innerHTML = '<span class="bar" style="background:' + it.c.color + '"></span><img alt="" src="' + portrait(it.c.id, it.skin) + '" onerror="this.style.visibility=\'hidden\'"><span class="shade"></span>' + (!it.ready ? '<span class="soon">IN THE FORGE</span>' : '') + '<span class="nm">' + esc(it.name) + '</span><span class="pr">' + (it.have ? 'OWNED' : '$' + it.price) + '</span>';
      card.onclick = () => {
        if (!it.ready || it.have) return audio.sfx('deny');
        if (it.skin !== 'default' && !(owns(it.c.id) || it.c.price === 0)) { this.game.hud.toast('Buy ' + it.c.name + ' first'); return audio.sfx('deny'); }
        if (profile.money < it.price) { this.game.hud.toast('Not enough money'); return audio.sfx('deny'); }
        profile.money -= it.price; grant(it.c.id, it.skin); audio.sfx('buy'); this.game.hud.toast('Bought ' + it.name); this.shop(tab);
      };
      grid.appendChild(card);
    }
    this._set('shop', s);
  }

  /* ---------------- settings ---------------- */
  settings() {
    const s = el('div', 'screen panel-screen fade-in');
    s.innerHTML = '<div class="panel-head"><button class="btn small" data-back>◀ Back</button><h2>SETTINGS</h2></div><div class="settings"></div>';
    s.querySelector('[data-back]').onclick = () => this.back();
    this.onTab = null;
    const box = s.querySelector('.settings');
    const row = (label, small, ctl) => { const r = el('div', 'set-row', '<label>' + esc(label) + (small ? '<small>' + esc(small) + '</small>' : '') + '</label>'); const c = el('div', 'ctl'); ctl(c); r.appendChild(c); box.appendChild(r); };
    const choice = (key, opts, after) => (c) => { for (const [v, l] of opts) { const b = el('button', 'btn' + (settings[key] === v ? ' on' : ''), l); b.onclick = () => { settings[key] = v; saveSettings(); after && after(v); this.settings(); }; c.appendChild(b); } };
    const num = (key, min, max, step, fmt, after) => (c) => {
      const minus = el('button', 'btn', '−'), val = el('span', 'val', fmt(settings[key])), plus = el('button', 'btn', '+');
      const set = (v) => { settings[key] = Math.round(Math.max(min, Math.min(max, v)) / step) * step; val.textContent = fmt(settings[key]); saveSettings(); after && after(); };
      minus.onclick = () => set(settings[key] - step); plus.onclick = () => set(settings[key] + step);
      c.append(minus, val, plus);
    };
    row('Name', 'What everyone sees over your head', (c) => { const i = el('input'); i.type = 'text'; i.maxLength = 20; i.value = profile.name; i.onfocus = () => { input.typing = true; }; i.onblur = () => { input.typing = false; }; i.onchange = () => { profile.name = (i.value.trim() || 'Player').slice(0, 20); this.game.server.me.name = profile.name; saveProfile(); }; i.addEventListener('keydown', (e) => e.stopPropagation()); c.appendChild(i); });
    row('Graphics', 'Low for phones; Ultra for strong PCs', choice('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], (v) => this.game.renderer.setQuality(v)));
    row('Resolution scale', '', num('renderScale', 0.5, 1, 0.05, (v) => Math.round(v * 100) + '%', () => this.game.renderer.resize()));
    row('Look sensitivity', 'Mouse, stick and touch', num('sensitivity', 0.2, 3, 0.1, (v) => v.toFixed(1)));
    row('Invert look', '', choice('invertY', [[false, 'Off'], [true, 'On']]));
    row('Field of view', '', num('fov', 55, 100, 5, (v) => v + '°'));
    row('Master volume', '', num('master', 0, 1, 0.1, (v) => Math.round(v * 100) + '%', () => audio.applyVolumes()));
    row('Music', 'Soundtrap exports in assets/music/ replace the built-in songs', num('music', 0, 1, 0.1, (v) => Math.round(v * 100) + '%', () => audio.applyVolumes()));
    row('Effects', '', num('sfx', 0, 1, 0.1, (v) => Math.round(v * 100) + '%', () => audio.applyVolumes()));
    row('Camera shake', '', choice('shake', [[true, 'On'], [false, 'Off']]));
    row('Bot chat', 'The other players talking', choice('botChat', [[true, 'On'], [false, 'Off']]));
    row('Play as killer', 'Off: you are never picked as the killer', choice('killerOptOut', [[false, 'On'], [true, 'Off']]));
    const ctrl = el('div', 'set-row', '<label>Controls<small>Move WASD · Sprint Shift · Jump Space · Interact E · Abilities Q R F · Attack LMB · Emote G · Chat / · Scoreboard Tab · Menu Esc<br>DualSense: L-stick move · R-stick look · L3/L1 sprint · ✕ jump · □ interact · R1 L2 △ abilities · R2 attack · ▶ emote · touchpad scores · OPTIONS menu</small></label>');
    box.appendChild(ctrl);
    this._set('settings', s);
  }

  /* ---------------- pause ---------------- */
  pause() {
    const s = el('div', 'screen pause fade-in');
    s.innerHTML = '<h2>PAUSED</h2>';
    const b = (label, fn, cls = '') => { const x = el('button', 'btn ' + cls, label); x.onclick = () => { audio.sfx('ui'); fn(); }; s.appendChild(x); };
    b('Resume', () => this.game.resume(), 'primary');
    b('Settings', () => this.push('settings'));
    b('Leave round', () => this.game.forfeit());
    this.onTab = null;
    this._set('pause', s);
  }

  /* ---------------- results ---------------- */
  results(res, onDone) {
    const s = el('div', 'screen results fade-in');
    const meRow = res.rows.find((r) => r.member && r.member.isMe);
    const k = res.winner === 'killer';
    const win = meRow ? (meRow.role === 'killer') === k : !k;
    const title = meRow ? (win ? (meRow.role === 'killer' ? 'THE HUNT IS OVER' : 'YOU SURVIVED') : (meRow.role === 'killer' ? 'THEY GOT AWAY' : 'YOU DIED')) : (k ? 'KILLER WINS' : 'SURVIVORS WIN');
    const label = { escaped: ['Survived', 'st-esc'], dead: ['Dead', 'st-dead'], killer: ['Killer', 'st-k'], left: ['Left', 'st-left'] };
    const rows = res.rows.map((r) => '<tr class="' + (r.member && r.member.isMe ? 'me' : '') + '"><td>' + esc(r.name) + '</td><td>' + esc(r.char) + '</td><td class="' + label[r.status][1] + '">' + label[r.status][0] + '</td><td>' + r.stats.gens + '</td><td>' + r.stats.stuns + '</td><td>' + (r.role === 'killer' ? r.stats.kills : Math.round(r.stats.heals)) + '</td><td style="color:var(--gold)">$' + r.money + '</td></tr>').join('');
    s.innerHTML = '<div class="win ' + (k ? 'k' : 's') + '">' + title + '</div><div class="why">' + esc(res.reason || '') + ' · ' + esc(res.map.name) + (res.lms ? ' · LMS: ' + esc(res.lms.name) + (res.lms.won ? ' clutched it' : ' fell') : '') + '</div>' +
      '<table><tr><th>Player</th><th>Character</th><th>Result</th><th>Gens</th><th>Stuns</th><th>Heals / Kills</th><th>Earned</th></tr>' + rows + '</table>' +
      (meRow ? '<div class="earn"><div><b>+$' + meRow.money + '</b><span>Money</span></div><div><b class="xp">+' + meRow.xp + '</b><span>XP</span></div></div>' : '') +
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
    const c = el('div', 'intro-card letterbox');
    const role = me && me.role === 'killer' ? 'YOU ARE THE KILLER' : 'THE KILLER IS';
    c.innerHTML = '<div class="role">' + role + '</div><div class="nm k">' + esc(k.def.name.toUpperCase()) + '</div><div class="sub">' + esc(k.name) + ' · ' + esc(match.def.name) + '</div>';
    c.style.position = 'absolute'; c.style.inset = '0'; c.style.pointerEvents = 'none';
    const inner = el('div', 'intro-card'); inner.innerHTML = c.innerHTML; c.innerHTML = ''; c.className = 'letterbox'; c.appendChild(inner);
    this.overlay.appendChild(c);
    return c;
  }
  vsCard(s, k, track) {
    const v = el('div', 'vs');
    v.innerHTML = '<div class="lms">LAST MAN STANDING</div>' +
      '<div class="half l"><img alt="" src="' + portrait(s.charId, s.skin) + '" onerror="this.style.visibility=\'hidden\'"><div class="nm">' + esc(s.def.name.toUpperCase()) + '<small>' + esc(s.name) + '</small></div></div>' +
      '<div class="half r"><img alt="" src="' + portrait(k.charId, k.skin) + '" onerror="this.style.visibility=\'hidden\'"><div class="nm">' + esc(k.def.name.toUpperCase()) + '<small>' + esc(k.name) + '</small></div></div>' +
      '<div class="mid">VS</div><div class="track">♪ ' + esc(track) + '</div>';
    this.overlay.appendChild(v);
    setTimeout(() => v.classList.add('out'), 3600);
    setTimeout(() => v.remove(), 4200);
  }
}
void music;
