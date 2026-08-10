/* In-game HUD, mission tracker, boss bar and the cinematic layer.
 *
 * Layout follows the reference: vitals and rank bottom-left (health red,
 * stamina bone, power orange), four weapon slots bottom-right, the active
 * mission centred at the top with a live distance readout. */

import { el, $, clamp, short, distStr, lerp } from '../core/util.js';
import { Save } from '../core/save.js';
import { RANKS, rankFor, xpToNext, ITEMS } from '../data/gamedata.js';
import { itemIcon } from '../art/art.js';

export class HUD {
  constructor() {
    const host = document.getElementById('layer-game');

    this.root = el('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="dmg-vig"></div>
      <div class="reticle"></div>
      <div class="compass"><div class="strip"></div></div>

      <div class="hud-mission">
        <div class="ttl">OBJECTIVE</div>
        <div class="desc"></div>
        <div class="meta"></div>
        <div class="prog"><i style="width:0%"></i></div>
      </div>

      <div class="bossbar"><div class="nm"></div><div class="tr"><div class="fl"></div></div></div>

      <div class="coin">✦ 0 SHEKELS</div>
      <div class="hud-bl">
        <div class="hud-rank">
          <div class="rank-badge">E</div>
          <div class="rank-meta">
            <div class="lvl">LV 1 · FORSAKEN</div>
            <div class="xpwrap"><i style="width:0%"></i></div>
          </div>
        </div>
        <div class="vital hp"><div class="track"><div class="ghost"></div><div class="fill"></div></div></div>
        <div class="vital st"><div class="track"><div class="fill"></div></div></div>
        <div class="vital pw"><div class="track"><div class="fill"></div></div></div>
      </div>

      <div class="hud-br"></div>
    `;
    host.appendChild(this.root);

    this.q = {
      hp: $('.vital.hp .fill', this.root),
      hpGhost: $('.vital.hp .ghost', this.root),
      st: $('.vital.st .fill', this.root),
      pw: $('.vital.pw .fill', this.root),
      pwWrap: $('.vital.pw', this.root),
      badge: $('.rank-badge', this.root),
      lvl: $('.lvl', this.root),
      xp: $('.xpwrap i', this.root),
      coin: $('.coin', this.root),
      slots: $('.hud-br', this.root),
      mission: $('.hud-mission', this.root),
      mDesc: $('.hud-mission .desc', this.root),
      mMeta: $('.hud-mission .meta', this.root),
      mProg: $('.hud-mission .prog i', this.root),
      mTtl: $('.hud-mission .ttl', this.root),
      boss: $('.bossbar', this.root),
      bossName: $('.bossbar .nm', this.root),
      bossFill: $('.bossbar .fl', this.root),
      dmg: $('.dmg-vig', this.root),
      reticle: $('.reticle', this.root),
      compass: $('.compass .strip', this.root)
    };

    this._slots = [];
    for (let i = 0; i < 4; i++) {
      const s = el('div', 'slot', `<div class="ico"></div><div class="num">${i + 1}</div><div class="qty"></div>`);
      this.q.slots.appendChild(s);
      this._slots.push({ node: s, ico: $('.ico', s), qty: $('.qty', s) });
    }

    this.cine = new Cinematics();
    this._hpGhostVal = 1;
    this._lastIcons = ['', '', '', ''];
  }

  show(on = true) { this.root.classList.toggle('on', on); }

  /* ---------- vitals ---------- */
  setVitals({ hp, hpMax, stamina, staminaMax, power, powerMax }) {
    const h = clamp(hp / hpMax, 0, 1);
    this.q.hp.style.transform = `scaleX(${h})`;
    // The pale "ghost" bar trails the real one so damage reads at a glance.
    this._hpGhostVal = Math.max(h, this._hpGhostVal);
    this.q.hpGhost.style.transform = `scaleX(${this._hpGhostVal})`;
    if (this._hpGhostVal > h) {
      clearTimeout(this._ghostT);
      this._ghostT = setTimeout(() => { this._hpGhostVal = h; }, 420);
    }
    this.q.st.style.transform = `scaleX(${clamp(stamina / staminaMax, 0, 1)})`;
    const p = clamp(power / powerMax, 0, 1);
    this.q.pw.style.transform = `scaleX(${p})`;
    this.q.pwWrap.classList.toggle('drained', p < .12);
    this.root.classList.toggle('lowhp', h < .25);
    this.q.dmg.style.opacity = h < .35 ? String((1 - h / .35) * .55) : '0';
  }

  flashDamage() {
    this.q.dmg.style.transition = 'opacity .06s';
    this.q.dmg.style.opacity = '.85';
    setTimeout(() => { this.q.dmg.style.transition = 'opacity .5s'; this.q.dmg.style.opacity = '0'; }, 90);
  }

  hitMarker() {
    this.q.reticle.classList.add('hit');
    setTimeout(() => this.q.reticle.classList.remove('hit'), 120);
  }

  /* ---------- rank / level / money ---------- */
  setProgress({ level, xp, shekels }) {
    const r = rankFor(level);
    this.q.badge.textContent = r.id;
    this.q.badge.style.color = r.color;
    this.q.badge.style.borderColor = r.color + '99';
    this.q.lvl.textContent = `LV ${level} · ${r.name.toUpperCase()}`;
    const need = xpToNext(level);
    this.q.xp.style.width = clamp(xp / need, 0, 1) * 100 + '%';
    this.q.coin.textContent = `✦ ${short(shekels)} SHEKELS`;
  }

  /* ---------- hotbar ---------- */
  setHotbar(slots, equipped, colors) {
    slots.forEach((stack, i) => {
      const s = this._slots[i];
      if (!s) return;
      s.node.classList.toggle('sel', i === equipped);
      const def = stack ? ITEMS[stack.id] : null;
      const key = def ? def.id : '';
      if (this._lastIcons[i] !== key + (colors ? colors.blade.h : '')) {
        s.ico.style.backgroundImage = def ? `url('${itemIcon(def, colors)}')` : 'none';
        this._lastIcons[i] = key + (colors ? colors.blade.h : '');
      }
      s.qty.textContent = stack && stack.qty > 1 ? stack.qty : '';
    });
  }

  /* ---------- mission tracker ---------- */
  setMission(m) {
    if (!m) { this.q.mission.style.opacity = '0'; return; }
    this.q.mission.style.opacity = '1';
    this.q.mTtl.textContent = m.title || 'OBJECTIVE';
    this.q.mDesc.textContent = m.desc || '';
    let meta = '';
    if (m.distance != null) meta += distStr(m.distance);
    if (m.count != null) meta += (meta ? '  ·  ' : '') + `${m.progress || 0} / ${m.count}`;
    this.q.mMeta.textContent = meta;
    const pr = m.count ? clamp((m.progress || 0) / m.count, 0, 1) : (m.pct ?? 0);
    this.q.mProg.style.width = pr * 100 + '%';
  }

  /* ---------- boss ---------- */
  setBoss(boss) {
    if (!boss) { this.q.boss.classList.remove('on'); return; }
    this.q.boss.classList.add('on');
    this.q.bossName.textContent = boss.name.toUpperCase();
    this.q.bossFill.style.transform = `scaleX(${clamp(boss.hp / boss.hpMax, 0, 1)})`;
  }

  /* ---------- compass ---------- */
  setHeading(yaw) {
    // Yaw 0 faces -Z (north). Build a repeating tape so it wraps cleanly.
    const deg = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const marks = [];
    for (let a = -180; a <= 180; a += 15) {
      const abs = ((deg + a) % 360 + 360) % 360;
      const label = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[abs];
      marks.push(label ? `<span style="opacity:1">${label}</span>` : '<span style="opacity:.35">·</span>');
    }
    this.q.compass.innerHTML = marks.join('&nbsp;&nbsp;&nbsp;');
    this.q.compass.style.left = '50%';
    this.q.compass.style.transform = 'translateX(-50%)';
  }

  toast(text, big = false) {
    let host = document.getElementById('toasts');
    if (!host) { host = el('div'); host.id = 'toasts'; document.getElementById('layer-game').appendChild(host); }
    const t = el('div', 'toast' + (big ? ' big' : ''), text);
    host.appendChild(t);
    setTimeout(() => t.remove(), 3600);
  }
}

/* ============================================================
   Cinematic layer: letterbox, fades, subtitles, chapter cards,
   death screen.
   ============================================================ */
export class Cinematics {
  constructor() {
    const host = document.getElementById('layer-cine');
    this.root = el('div');
    this.root.id = 'cine';
    this.root.innerHTML = `
      <div class="bar t"></div><div class="bar b"></div>
      <div class="fade"></div>
      <div class="sub"></div>
      <div class="chapter"><div class="k"></div><div class="l"></div></div>
      <div class="death"><div class="w">死</div></div>
    `;
    host.appendChild(this.root);
    this.q = {
      fade: $('.fade', this.root),
      sub: $('.sub', this.root),
      chapter: $('.chapter', this.root),
      ck: $('.chapter .k', this.root),
      cl: $('.chapter .l', this.root),
      death: $('.death', this.root)
    };
  }

  bars(on) { this.root.classList.toggle('on', on); }

  fadeTo(color = 'black', ms = 1000) {
    this.q.fade.classList.toggle('white', color === 'white');
    this.q.fade.style.transition = `opacity ${ms}ms ease`;
    this.q.fade.style.opacity = '1';
    return new Promise(r => setTimeout(r, ms));
  }

  fadeFrom(ms = 1000) {
    this.q.fade.style.transition = `opacity ${ms}ms ease`;
    this.q.fade.style.opacity = '0';
    return new Promise(r => setTimeout(r, ms));
  }

  /** Types a subtitle out, then holds it. */
  async say(text, holdMs = 2600, typeMs = 22) {
    if (!Save.settings?.subtitles) { await new Promise(r => setTimeout(r, holdMs)); return; }
    this.q.sub.classList.add('on');
    this.q.sub.textContent = '';
    for (let i = 0; i < text.length; i++) {
      this.q.sub.textContent = text.slice(0, i + 1);
      await new Promise(r => setTimeout(r, typeMs));
    }
    await new Promise(r => setTimeout(r, holdMs));
    this.q.sub.classList.remove('on');
    await new Promise(r => setTimeout(r, 400));
  }

  async chapter(jp, latin, ms = 3400) {
    this.q.ck.textContent = jp;
    this.q.cl.textContent = latin;
    this.q.chapter.classList.add('on');
    await new Promise(r => setTimeout(r, ms));
    this.q.chapter.classList.remove('on');
    await new Promise(r => setTimeout(r, 1200));
  }

  death(on) { this.q.death.classList.toggle('on', on); }

  clear() {
    this.bars(false); this.death(false);
    this.q.sub.classList.remove('on');
    this.q.chapter.classList.remove('on');
    this.q.fade.style.opacity = '0';
  }
}
