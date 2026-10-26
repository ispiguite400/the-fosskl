/*
 * The in-round HUD: timer and generators, the team, the feed, health/stamina/bloodlust,
 * abilities with cooldowns and the right button glyph for the device in use, prompts,
 * big centre messages, spectating, the scoreboard.
 */
import { el, esc, fmtTime } from '../core/util.js';
import { input } from '../core/input.js';
import { bus } from '../core/events.js';
import { ABILITIES, ITEMS } from '../game/abilities.js';
import { portrait } from './art.js';
import { icon, abilityIcon } from './icons.js';
import { glyph } from './glyph.js';
import { settings } from '../core/save.js';
import { PARTS } from '../game/props.js';

const STATUS = {
  stun: ['Stunned', 'bad'], slow: ['Slowed', 'bad'], root: ['Rooted', 'bad'], blind: ['Blinded', 'bad'], burn: ['Burning', 'bad'], lifted: ['Lifted', 'bad'],
  haste: ['Speed', 'good'], armor: ['Protected', 'good'], absorb: ['Gold', 'good'], regen: ['Healing', 'good'], astral: ['Astral Shield', 'good'], blocking: ['Blocking', 'good'],
  hidden: ['Hidden', 'good'], disguise: ['Disguised', 'good'], invis: ['Vanished', 'good'], frenzy: ['Frenzy', 'bad'], rev_killer: ['Revealed', 'bad'], rev_survivor: ['Revealed', 'bad'], interrogate: ['Interrogating', 'good'], parry: ['Parry', 'good'], freestam: ['Endless stamina', 'good']
};

export class Hud {
  constructor(game, root) {
    this.game = game; this.root = root; this.m = null;
    this.offs = [];
    this.offs.push(bus.on('feed', (d) => this.feedLine(d.text, d.kind)));
    this.offs.push(bus.on('toast', (t) => this.toast(t)));
    this.offs.push(bus.on('ping', (p) => this.game.worldUi.ping(p)));
    this.offs.push(bus.on('hurt', () => this.hurtFlash()));
    this.offs.push(bus.on('gen', (d) => { if (!d.left) this.center('EVERY GENERATOR IS RUNNING', 'Hold out until the timer runs out', 3); }));
    this.offs.push(bus.on('frenzy', (d) => { const P = this.game.focusActor(); if (P && P.role === 'killer') this.center('FRENZY', 'Faster, harder, for 8 seconds', 2.5); else this.center(d.killer.name.toUpperCase() + ' IS IN A FRENZY', '', 2.2); }));
    this.offs.push(bus.on('event', (ev) => this.center(ev.title || 'EVENT', ev.text || '', 3.5)));
    this.offs.push(bus.on('death', (d) => { if (d.actor.isPlayer) this.center('YOU DIED', 'You linger as an echo: press ' + (input.glyph('ability1') || 'the Echo button') + ' once to reveal the killer', 4); }));
    this.offs.push(bus.on('bond', (d) => { if (d.a.isPlayer || d.b.isPlayer) this.toast('Bonded with ' + (d.a.isPlayer ? d.b.name : d.a.name) + ': faster repairs together'); }));
  }
  build(match, me) {
    this.m = match; this.me = me;
    const r = this.root; r.innerHTML = '';
    this.vign = el('div', 'h-vignette-hit'); r.appendChild(this.vign);
    this.terror = el('div', 'h-terror'); r.appendChild(this.terror);
    const top = el('div', 'h-top');
    const gensSide = el('div', 'h-plate h-side gens', icon('bolt') + '<div><span class="v">0</span><small>GENS</small></div>');
    const clock = el('div', 'h-plate h-clock');
    this.timer = el('div', 'h-timer', '0:00');
    this.gensEl = el('div', 'h-gens');
    this.genCells = match.gens.map(() => { const i = el('i', '', '<b></b>'); this.gensEl.appendChild(i); return i; });
    this.mapEl = el('div', 'h-map', esc(match.def.name));
    clock.append(this.timer, this.gensEl, this.mapEl);
    const aliveSide = el('div', 'h-plate h-side r alive', icon('person') + '<div><span class="v">0</span><small>ALIVE</small></div>');
    top.append(gensSide, clock, aliveSide);
    this.clock = clock; this.gensLeft = gensSide.querySelector('.v'); this.aliveEl = aliveSide.querySelector('.v');
    r.appendChild(top);
    this.team = el('div', 'h-team ' + (settings.statusLayout || 'side') + (settings.survivorUi === false ? ' hidden' : '')); r.appendChild(this.team);
    this.rows = new Map();
    const list = [...match.survivors];
    list.forEach((a) => {
      const row = el('div', 'tm' + (a === me ? ' me' : ''));
      const pic = el('div', 'pic', '<i class="st"></i>'); pic.style.backgroundImage = 'url(' + portrait(a.charId, a.skin) + ')';
      const who = el('div', 'who', '<div class="nm">' + esc(a.name) + '<span class="bond"></span></div><div class="ch">' + esc(a.def.name) + '</div><div class="hpb"><i></i></div>');
      const hpn = el('div', 'hpn', '');
      row.append(pic, who, hpn);
      row.title = a.name;
      this.team.appendChild(row);
      this.rows.set(a, { row, hp: who.querySelector('.hpb i'), bond: who.querySelector('.bond'), st: pic.querySelector('.st'), stName: '', hpn, hpTxt: '' });
    });
    // the killer, under the survivors, in red
    const K = match.killer;
    if (K) {
      const row = el('div', 'tm killer');
      const pic = el('div', 'pic', '<i class="st">' + icon('stun') + '</i>'); pic.style.backgroundImage = 'url(' + portrait(K.charId, K.skin) + ')';
      row.append(pic, el('div', 'who', '<div class="ktag">' + (K === me ? 'YOU ARE THE KILLER' : 'THE KILLER') + '</div><div class="nm">' + esc(K.name) + '</div><div class="ch">' + esc(K.def.name) + '</div>'));
      this.team.appendChild(row);
      this.killerRow = row;
    }
    this.feed = el('div', 'h-feed'); r.appendChild(this.feed);
    this.cross = el('div', 'h-cross'); r.appendChild(this.cross);
    this.prompt = el('div', 'h-prompt hidden'); r.appendChild(this.prompt);
    this.centerEl = el('div', 'h-center'); r.appendChild(this.centerEl);
    const bottom = el('div', 'h-bottom');
    this.status = el('div', 'h-status');
    const bars = el('div', 'h-bars');
    this.heart = el('div', 'h-heart', icon(me && me.role === 'killer' ? 'drop' : 'heart')); bars.appendChild(this.heart);
    if (me && me.role === 'killer') {
      this.bl = el('div', 'h-bar bl', '<span class="txt">BLOODLUST</span><i></i><span class="num"></span>');
      bars.appendChild(this.bl);
    } else {
      this.hp = el('div', 'h-bar', '<span class="txt">HEALTH</span><i class="lag"></i><i class="cur"></i><span class="num"></span>');
      bars.appendChild(this.hp);
    }
    this.st = el('div', 'h-bar st', '<i></i><span class="num"></span>'); bars.appendChild(this.st);
    this.st.classList.toggle('nonum', settings.staminaCounter === false);
    this.abils = el('div', 'h-abils');
    this.abEls = [];
    if (me) {
      const defs = me.def.abilities.slice();
      const actions = ['ability1', 'ability2', 'ability3'];
      if (me.role === 'killer') this.abEls.push(this._ab({ name: me.def.m1.name, icon: abilityIcon(/claw/i.test(me.def.m1.name) ? 'claw' : 'm1', '🗡'), action: 'attack', m1: true, cd: me.def.m1.cd }));
      defs.forEach((d, i) => this.abEls.push(this._ab({ name: d.name, icon: abilityIcon(d.id, (ABILITIES[d.id] && ABILITIES[d.id].icon) || '✦'), action: actions[i], id: d.id, cd: d.cd })));
      if (me.role === 'survivor') this.abEls.push(this._ab({ name: 'Item', icon: '', action: 'ability3', item: true }));
    }
    bottom.append(this.status, bars);
    r.appendChild(bottom); r.appendChild(this.abils);
    this.spec = el('div', 'h-spec hidden'); r.appendChild(this.spec);
    this.board = el('div', 'h-board hidden'); r.appendChild(this.board);
    this.t = 0;
  }
  _ab(o) {
    // the button to press sits on top of each tile, drawn for the device in use (ui/glyph.js keeps it current)
    const w = el('div', 'abw', glyph(o.action));
    const e = el('div', 'ab' + (o.item ? ' item' : '') + (o.m1 ? ' m1' : ''), '<span class="ic">' + o.icon + '</span><span class="nm">' + esc(o.name) + '</span><div class="cd hidden"></div>');
    w.appendChild(e);
    this.abils.appendChild(w);
    return Object.assign(o, { el: e, cdEl: e.querySelector('.cd'), ic: e.querySelector('.ic'), nm: e.querySelector('.nm') });
  }
  feedLine(text, kind) {
    if (!this.feed) return;
    const d = el('div', kind || '', icon(kind === 'good' ? 'bolt' : kind === 'info' ? 'eye' : 'skull') + '<span>' + esc(text) + '</span>');
    this.feed.appendChild(d);
    while (this.feed.children.length > 6) this.feed.firstChild.remove();
    setTimeout(() => d.remove(), 7000);
  }
  toast(text) {
    const t = el('div', 'toast', esc(text));
    this.game.ui.overlay.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  center(big, small, t = 2.5) {
    if (!this.centerEl) return;
    this.centerEl.innerHTML = '<div class="big worn">' + esc(big) + '</div>' + (small ? '<div class="small">' + esc(small) + '</div>' : '');
    clearTimeout(this._ct); this._ct = setTimeout(() => { if (this.centerEl) this.centerEl.innerHTML = ''; }, t * 1000);
  }
  hurtFlash() { if (!this.vign) return; this.vign.style.boxShadow = 'inset 0 0 140px rgba(232,50,60,0.75)'; setTimeout(() => { if (this.vign) this.vign.style.boxShadow = ''; }, 250); }
  clear() { clearTimeout(this._ct); this.root.innerHTML = ''; this.m = null; this.feed = null; this.centerEl = null; this.vign = null; this.killerRow = null; }

  update(dt, player) {
    const m = this.m; if (!m) return;
    this.t -= dt;
    // the cheap bits every frame
    const me = this.me;
    if (me) {
      if (this.hp) { const f = Math.max(0, me.hp / me.maxHp) * 100; this.hp.querySelector('.cur').style.width = f + '%'; this.hp.querySelector('.lag').style.width = f + '%'; }
      if (this.bl) { this.bl.querySelector('i').style.width = m.bloodlust + '%'; this.bl.classList.toggle('full', me.fx.has('frenzy')); }
      const sf = me.stamina / me.maxStamina;
      this.st.querySelector('i').style.width = (sf * 100) + '%';
      // as in Forsaken: green, yellow past half, a washed-out grey-yellow when it runs dry
      this.st.classList.toggle('mid', sf < 0.5 && sf >= 0.15 && !me.exhausted);
      this.st.classList.toggle('out', sf < 0.15 || !!me.exhausted);
      this.st.querySelector('.num').textContent = Math.floor(me.stamina);
    }
    if (this.t > 0) return;
    this.t = 0.1;
    this.timer.textContent = fmtTime(m.timeLeft);
    this.timer.classList.toggle('lms', m.phase === 'lms');
    this.clock.classList.toggle('lms', m.phase === 'lms');
    if (m.lms && !this._lmsShown) { this._lmsShown = true; this.mapEl.innerHTML = '<span class="lmsname">LAST MAN STANDING</span> · ♪ ' + esc(m.lms.title || ''); }
    m.gens.forEach((g, i) => { const c = this.genCells[i]; c.classList.toggle('done', g.done); c.firstChild.style.width = (g.progress / PARTS * 100) + '%'; });
    this.gensLeft.textContent = m.gens.filter((g) => !g.done).length;
    this.aliveEl.textContent = m.survivorsAlive().length;
    const K = m.killer;
    for (const [a, r] of this.rows) {
      const f = a.hp / a.maxHp;
      const chased = a.alive && !a.left && K && K.alive && a.dist(K) < 14 && m.canSee(K, a);
      const repair = a.alive && a.busy && a.busy.kind === 'repair';
      const st = !a.alive ? 'dead' : a.left ? 'left' : chased ? 'chased' : repair ? 'repair' : '';
      r.row.classList.toggle('dead', !a.alive && !a.left);
      r.row.classList.toggle('left', !!a.left);
      r.row.classList.toggle('hurt', a.alive && f < 0.7);
      r.row.classList.toggle('crit', a.alive && f < 0.35);
      r.row.classList.toggle('chased', st === 'chased');
      r.row.classList.toggle('repair', st === 'repair');
      if (st !== r.stName) { r.stName = st; r.st.innerHTML = st ? icon({ dead: 'skull', left: 'door', chased: 'eye', repair: 'wrench' }[st]) : ''; }
      r.hp.style.width = (a.alive ? f * 100 : 0) + '%';
      const txt = !a.alive || a.left ? '' : settings.healthDisplay === 'percent' ? Math.round(f * 100) + '%' : String(Math.max(1, Math.ceil(a.hp)));
      if (txt !== r.hpTxt) { r.hpTxt = txt; r.hpn.textContent = txt; }
      r.bond.textContent = me && me !== a && (me.bond[a.uid] || 0) >= 1 ? ' ♥' : '';
    }
    if (this.killerRow && K) this.killerRow.classList.toggle('stunned', K.alive && K.fx.has('stun'));
    if (this.hp && me) this.hp.querySelector('.num').textContent = Math.max(0, Math.ceil(me.hp));
    if (this.bl) this.bl.querySelector('.num').textContent = Math.round(m.bloodlust) + '%';
    // the terror radius: the heart beats faster, the edges go red, as the killer closes in
    let near = 0;
    if (me && me.alive && me.role === 'survivor' && K && K.alive && !K.fx.has('invis')) { const d = me.dist(K); if (d < 30) near = 1 - d / 30; }
    if (me && me.role === 'killer') near = m.bloodlust / 100;
    this.heart.classList.toggle('on', near > 0);
    if (near > 0) this.heart.style.setProperty('--beat', (1.25 - near * 0.85).toFixed(2) + 's');
    this.terror.style.opacity = me && me.role === 'survivor' ? Math.max(0, near * 1.4 - 0.35).toFixed(2) : 0;
    if (me) {
      // abilities and their cooldowns
      for (const o of this.abEls) {
        let cd = 0;
        if (o.m1) cd = me.attackCd;
        else if (o.item) { if (o._item !== me.item) { o._item = me.item; o.ic.innerHTML = me.item ? abilityIcon(me.item, ITEMS[me.item].icon) : '·'; o.nm.textContent = me.item ? ITEMS[me.item].name : 'No item'; } o.el.style.opacity = me.item ? 1 : 0.5; }
        else cd = me.cd[o.id] || 0;
        o.cdEl.classList.toggle('hidden', !(cd > 0));
        if (cd > 0) { o.cdEl.textContent = cd >= 10 ? Math.ceil(cd) : cd.toFixed(1); o.cdEl.style.setProperty('--p', Math.round(Math.min(1, cd / (o.cd || cd)) * 100) + '%'); }
        o.el.classList.toggle('ready', !(cd > 0));
      }
      // status chips
      const chips = [];
      for (const [k, e] of me.fx.m) if (STATUS[k]) chips.push('<span class="' + STATUS[k][1] + '">' + (k === 'haste' && e.t > 900 ? 'Last Stand' : STATUS[k][0]) + '</span>');
      if (me.exhausted) chips.push('<span class="bad">Exhausted</span>');
      const html = chips.join('');
      if (html !== this._chips) { this.status.innerHTML = html; this._chips = html; }
      this.cross.style.display = me.alive && (me.role === 'killer') ? '' : 'none';
    }
    // prompt
    const p = player.prompt;
    if (p && me && me.alive) {
      const html = glyph(p.action) + '<span>' + esc(p.text) + '</span>' + (p.progress !== undefined ? '<span class="prog"><i style="width:' + Math.round(p.progress * 100) + '%"></i></span>' : '');
      if (html !== this._prompt) { this.prompt.innerHTML = html; this._prompt = html; }
      this.prompt.classList.remove('hidden');
    } else this.prompt.classList.add('hidden');
    // spectating
    if (me && !me.alive && player.spectating) {
      const s = player.spectating, e = m.echoes.get(me);
      const echo = e && !e.used ? '<button class="btn small" data-echo>ECHO ' + glyph('ability1') + '</button>' : '<span style="color:var(--faint);font-size:.75rem">echo used</span>';
      const html = '<button class="btn small" data-prev>◀</button><div class="who"><small>SPECTATING</small>' + esc(s.name) + ' · ' + esc(s.def.name) + '</div><button class="btn small" data-next>▶</button>' + echo;
      if (html !== this._spec) {
        this.spec.innerHTML = html; this._spec = html;
        const b = (q, f) => { const x = this.spec.querySelector(q); if (x) x.onclick = f; };
        b('[data-prev]', () => input.touch.buttons.add('tabPrev') && setTimeout(() => input.touch.buttons.delete('tabPrev'), 60));
        b('[data-next]', () => input.touch.buttons.add('tabNext') && setTimeout(() => input.touch.buttons.delete('tabNext'), 60));
        b('[data-echo]', () => { if (m.useEcho(me)) this.toast('Your echo revealed the killer'); });
      }
      this.spec.classList.remove('hidden');
    } else this.spec.classList.add('hidden');
    // the scoreboard
    if (input.down('scoreboard')) {
      const rows = [...m.survivors, m.killer].filter(Boolean).map((a) => { const st = a.role === 'killer' ? ['Killer', ''] : a.left ? ['Left', 's-left'] : a.alive ? ['Alive', 's-alive'] : ['Dead', 's-dead']; return '<tr' + (a.role === 'killer' ? ' class="k"' : '') + '><td><span class="pp" style="background-image:url(' + portrait(a.charId, a.skin) + ')"></span>' + esc(a.name) + '</td><td>' + esc(a.def.name) + '</td><td class="' + st[1] + '">' + st[0] + '</td><td>' + a.stats.gens + '</td><td>' + a.stats.stuns + '</td><td>' + (a.role === 'killer' ? a.stats.kills : Math.round(a.stats.heals)) + '</td></tr>'; }).join('');
      this.board.innerHTML = '<h4 class="label">' + esc(m.def.name.toUpperCase()) + ' · ' + fmtTime(m.timeLeft) + '</h4><table><tr><th>Player</th><th>Character</th><th>Status</th><th>Gens</th><th>Stuns</th><th>Heals / Kills</th></tr>' + rows + '</table>';
      this.board.classList.remove('hidden');
    } else this.board.classList.add('hidden');
  }
  dispose() { for (const o of this.offs) o(); }
}
