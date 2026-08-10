/* NPC conversation, shop, ability vendor and class-change UI.
 *
 * Dialogue trees come from data/gamedata.js. Every node offers the player a
 * set of replies; choosing one either advances the tree or fires an action
 * the game layer handles. Fully navigable with the d-pad. */

import { el, $, clamp } from '../core/util.js';
import { Audio } from '../core/audio.js';
import { Save } from '../core/save.js';
import {
  DIALOGUE, VILLAGER_LINES, SIDEQUESTS, shopStock, ITEMS,
  ABILITIES, RANKS, rankFor, sellValue, xpValue, CLASSES, classById
} from '../data/gamedata.js';
import { addItem, hasSpace } from './inventory.js';

const CLASS_CHANGE_COST = 400;

export class DialogueUI {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.node = null;
    this.tree = null;
    this.sel = 0;
    this.typing = false;
    this._navT = 0;
  }

  /* ---------- lifecycle ---------- */
  start(treeId, npc) {
    const tree = DIALOGUE[treeId];
    if (!tree) return;
    this.tree = tree;
    this.npc = npc;
    this.treeId = treeId;
    this.open = true;
    this.game.setUIFocus(true);

    const host = document.getElementById('layer-modal');
    this.root = el('div');
    this.root.id = 'dlg';
    this.root.innerHTML = `
      <div class="dlgbox">
        <div class="who"></div>
        <div class="txt"></div>
        <div class="choices"></div>
      </div>
    `;
    host.appendChild(this.root);
    this.q = { who: $('.who', this.root), txt: $('.txt', this.root), choices: $('.choices', this.root) };

    if (tree.music) { this._prevMusic = Audio.current; Audio.play(tree.music); }
    this.goto(tree.start);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root?.remove(); this.root = null;
    this.game.setUIFocus(false);
    if (this._prevMusic) { Audio.play(this._prevMusic); this._prevMusic = null; }
    this.game.onDialogueClosed?.(this.treeId);
    Audio.sfx('uiBack', { volume: .4 });
  }

  goto(id) {
    if (!id) return this.close();
    const node = this.tree.nodes[id];
    if (!node) return this.close();
    this.node = node;
    this.sel = 0;
    this.q.who.textContent = this.npc?.displayName || this.tree.name;

    let text = node.text;
    if (text.includes('%LINE%')) {
      text = text.replace('%LINE%', this.npc?.line || VILLAGER_LINES[0]);
    }
    this._type(text);
  }

  async _type(text) {
    this.typing = true;
    this.q.choices.innerHTML = '';
    this.q.txt.innerHTML = '';
    for (let i = 0; i < text.length; i++) {
      if (!this.open) return;
      if (this.skip) { this.q.txt.textContent = text; break; }
      this.q.txt.textContent = text.slice(0, i + 1);
      await new Promise(r => setTimeout(r, 16));
    }
    this.q.txt.textContent = text;
    this.skip = false;
    this.typing = false;
    this._renderChoices();
  }

  _renderChoices() {
    const choices = (this.node.choices || []).filter(c => !c.cond || c.cond(Save.data));
    this.choices = choices;
    this.q.choices.innerHTML = '';
    choices.forEach((c, i) => {
      const n = el('div', 'choice', c.label + (c.tag ? `<span class="tagx">${c.tag}</span>` : ''));
      n.addEventListener('mouseenter', () => { this.sel = i; this._paint(); });
      n.addEventListener('click', () => { this.sel = i; this._commit(); });
      this.q.choices.appendChild(n);
    });
    this._paint();
  }

  _paint() {
    [...this.q.choices.children].forEach((n, i) => n.classList.toggle('sel', i === this.sel));
  }

  _commit() {
    const c = this.choices?.[this.sel];
    if (!c) return;
    Audio.sfx('uiConfirm', { volume: .5 });
    if (c.action) {
      const handled = this.action(c.action, c);
      if (handled === 'stop') return;
    }
    if (c.next) this.goto(c.next);
    else if (c.action !== 'open_shop' && c.action !== 'open_sell' &&
             c.action !== 'open_abilities' && c.action !== 'open_class_change') this.close();
  }

  /** Dialogue actions. Returning 'stop' suppresses navigation. */
  action(name, choice) {
    const g = this.game;
    switch (name) {
      case 'close': this.close(); return 'stop';
      case 'girl_join': g.story.girlJoin(); return;
      case 'girl_die': this.close(); g.story.girlDie(); return 'stop';
      case 'open_shop': this.shop(); return 'stop';
      case 'open_sell': this.close(); g.inventory.show('sell'); return 'stop';
      case 'open_abilities': this.abilities(); return 'stop';
      case 'open_class_change': this.classChange(); return 'stop';
      case 'offer_sidequest': this.sidequest(); return 'stop';
      default: return;
    }
  }

  /* ---------- panels rendered inside the dialogue box ---------- */
  _panel(title, bodyHTML, backFn) {
    this.q.who.textContent = title;
    this.q.txt.innerHTML = bodyHTML;
    this.q.choices.innerHTML = '';
    const back = el('div', 'choice sel', 'Back');
    back.addEventListener('click', () => { Audio.sfx('uiBack'); (backFn || (() => this.goto(this.tree.start)))(); });
    this.q.choices.appendChild(back);
    this.choices = [{ label: 'Back', action: 'panel_back' }];
    this.sel = 0;
    this._panelBack = backFn || (() => this.goto(this.tree.start));
  }

  shop() {
    const stock = shopStock(Save.data.world);
    const html = `<div style="font-size:14px;opacity:.65;margin-bottom:12px">
        ✦ ${Save.data.shekels} shekels</div><div class="shop">` +
      stock.map((s, i) => {
        const def = ITEMS[s.id];
        const can = Save.data.shekels >= s.price;
        return `<div class="sitem${can ? '' : ' cant'}" data-i="${i}">
          <div class="n">${def.name}</div>
          <div class="p">✦ ${s.price}</div>
          <div class="d">${def.desc || ''}</div>
        </div>`;
      }).join('') + '</div>';

    this._panel('Merchant Ozu', html);

    this.q.txt.querySelectorAll('.sitem').forEach(n => {
      n.addEventListener('click', () => {
        const s = stock[+n.dataset.i];
        if (Save.data.shekels < s.price) { Audio.sfx('uiDeny'); return; }
        if (!hasSpace(Save.data.inventory, s.id, 1)) {
          Audio.sfx('uiDeny'); this.game.hud.toast('INVENTORY FULL'); return;
        }
        Save.data.shekels -= s.price;
        addItem(Save.data.inventory, s.id, 1);
        Save.write();
        Audio.sfx('coin');
        this.game.hud.toast(`BOUGHT ${ITEMS[s.id].name.toUpperCase()}`);
        this.game.syncHotbar();
        this.shop();
      });
    });
  }

  abilities() {
    const d = Save.data;
    const myRank = rankFor(d.level);
    const rankIdx = id => RANKS.findIndex(r => r.id === id);
    const list = Object.values(ABILITIES).filter(a => !a.innate);

    const html = `<div style="font-size:14px;opacity:.65;margin-bottom:12px">
        ✦ ${d.shekels} shekels · Rank ${myRank.id} — ${myRank.name}</div><div class="shop">` +
      list.map((a, i) => {
        const owned = d.abilities.includes(a.id);
        const rankOk = rankIdx(myRank.id) >= rankIdx(a.rank);
        const can = !owned && rankOk && d.shekels >= a.price;
        return `<div class="sitem${can ? '' : ' cant'}" data-i="${i}">
          <div class="n">${a.name}</div>
          <div class="p">${owned ? 'LEARNED' : rankOk ? '✦ ' + a.price : 'REQUIRES RANK ' + a.rank}</div>
          <div class="d">${a.desc}</div>
        </div>`;
      }).join('') + '</div>';

    this._panel('The Sage', html);

    this.q.txt.querySelectorAll('.sitem').forEach(n => {
      n.addEventListener('click', () => {
        const a = list[+n.dataset.i];
        if (d.abilities.includes(a.id)) { Audio.sfx('uiDeny'); return; }
        if (rankIdx(rankFor(d.level).id) < rankIdx(a.rank)) {
          Audio.sfx('uiDeny'); this.game.hud.toast(`REQUIRES RANK ${a.rank}`); return;
        }
        if (d.shekels < a.price) { Audio.sfx('uiDeny'); this.game.hud.toast('NOT ENOUGH SHEKELS'); return; }
        d.shekels -= a.price;
        d.abilities.push(a.id);
        Save.write();
        Audio.sfx('rankUp');
        this.game.hud.toast(`LEARNED — ${a.name.toUpperCase()}`, true);
        this.game.player?.refreshStats();
        this.abilities();
      });
    });
  }

  classChange() {
    const d = Save.data;
    const owned = new Set(d.unlockedClasses);
    const avail = CLASSES.filter(c => owned.has(c.id) || d.unlockedWorlds.includes(c.unlockWorld));

    const html = `<div style="font-size:14px;opacity:.65;margin-bottom:12px">
        ✦ ${d.shekels} shekels · reshaping costs ${CLASS_CHANGE_COST}</div><div class="shop">` +
      avail.map((c, i) => {
        const cur = c.id === d.classId;
        return `<div class="sitem${cur ? ' cant' : ''}" data-i="${i}">
          <div class="n">${c.name} · ${c.jp}</div>
          <div class="p">${cur ? 'CURRENT' : '✦ ' + CLASS_CHANGE_COST}</div>
          <div class="d">${c.perk}</div>
        </div>`;
      }).join('') + '</div>';

    this._panel('Oathkeeper Ren', html);

    this.q.txt.querySelectorAll('.sitem').forEach(n => {
      n.addEventListener('click', () => {
        const c = avail[+n.dataset.i];
        if (c.id === d.classId) { Audio.sfx('uiDeny'); return; }
        if (d.shekels < CLASS_CHANGE_COST) { Audio.sfx('uiDeny'); this.game.hud.toast('NOT ENOUGH SHEKELS'); return; }
        d.shekels -= CLASS_CHANGE_COST;
        d.classId = c.id;
        if (!d.unlockedClasses.includes(c.id)) d.unlockedClasses.push(c.id);
        Save.write();
        Audio.sfx('rankUp');
        this.game.player?.refreshStats();
        this.game.hud.toast(`YOU ARE NOW ${c.name.toUpperCase()}`, true);
        this.classChange();
      });
    });
  }

  sidequest() {
    const d = Save.data;
    const key = `${d.world}:${this.npc?.qid ?? 0}`;
    const existing = d.sideQuests[key];

    if (existing?.done) {
      this._panel(this.npc?.displayName || 'Villager',
        `<div style="font-size:17px;line-height:1.5">You already did what I asked. I have nothing else — only thanks, and those do not travel well.</div>`,
        () => this.close());
      return;
    }
    if (existing) {
      const q = SIDEQUESTS.find(s => s.id === existing.id);
      this._panel(this.npc?.displayName || 'Villager',
        `<div style="font-size:17px;line-height:1.5">${q.text}</div>
         <div style="margin-top:14px;font-family:Cinzel,serif;font-size:12px;letter-spacing:.2em;color:var(--ember)">
           PROGRESS ${existing.progress} / ${q.count}
         </div>`, () => this.close());
      return;
    }

    // Deterministic per-NPC pick so the same villager always offers the same job.
    const q = SIDEQUESTS[(this.npc?.qid ?? 0) % SIDEQUESTS.length];
    this.q.who.textContent = this.npc?.displayName || 'Villager';
    this.q.txt.innerHTML = `<div style="font-size:19px;line-height:1.5">${q.text}</div>
      <div style="margin-top:14px;font-family:Cinzel,serif;font-size:12px;letter-spacing:.2em;color:var(--ember)">
        ${q.name.toUpperCase()} · ${q.count} · REWARD ${q.xp} XP · ✦${q.shekels}
      </div>`;
    this.q.choices.innerHTML = '';
    this.choices = [
      { label: "I'll do it.", accept: true },
      { label: 'Not now.', accept: false }
    ];
    this.choices.forEach((c, i) => {
      const n = el('div', 'choice', c.label);
      n.addEventListener('mouseenter', () => { this.sel = i; this._paint(); });
      n.addEventListener('click', () => {
        if (c.accept) {
          d.sideQuests[key] = { id: q.id, progress: 0, done: false, world: d.world };
          Save.write();
          Audio.sfx('questNew');
          this.game.hud.toast(`SIDE QUEST — ${q.name.toUpperCase()}`);
        }
        this.close();
      });
      this.q.choices.appendChild(n);
    });
    this.sel = 0; this._paint();
  }

  /* ---------- per-frame nav ---------- */
  update(dt, input) {
    if (!this.open) return;
    const p = input.p;

    if (this.typing) {
      if (p.justPressed('confirm') || p.justPressed('interact')) this.skip = true;
      return;
    }

    this._navT -= dt;
    const dir = p.isDown('menuDown') ? 1 : p.isDown('menuUp') ? -1 : 0;
    if (dir && this._navT <= 0) {
      const n = this.q.choices.children.length;
      if (n) {
        this.sel = (this.sel + dir + n) % n;
        this._paint(); Audio.sfx('uiMove', { volume: .5 });
      }
      this._navT = .22;
    }
    if (!dir) this._navT = 0;

    if (p.justPressed('confirm') || p.justPressed('interact')) {
      if (this._panelBack && this.choices?.[0]?.action === 'panel_back') {
        Audio.sfx('uiBack'); const f = this._panelBack; this._panelBack = null; f();
      } else this._commit();
    }
    if (p.justPressed('cancel')) {
      if (this._panelBack) { const f = this._panelBack; this._panelBack = null; f(); }
      else this.close();
    }
  }
}
