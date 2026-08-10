/* Inventory — Minecraft-style click-to-pick-up handling.
 *
 * Slots 0..3 are the four weapon slots shown on the HUD; 4..35 are storage.
 * Left click picks up a whole stack, shift-click splits it, right click
 * places a single item, and dropping outside the window throws it into the
 * world. Q drops the hovered stack, and every stack can be sold. */

import { el, $, $$, clamp } from '../core/util.js';
import { Audio } from '../core/audio.js';
import { Save } from '../core/save.js';
import { ITEMS, sellValue, xpValue, RARITY_CLASS } from '../data/gamedata.js';
import { itemIcon } from '../art/art.js';

export const HOTBAR_SLOTS = 4;
export const TOTAL_SLOTS = 36;

/* ---------- pure inventory operations (used by the game too) ---------- */

export function stackable(a, b) {
  if (!a || !b) return false;
  if (a.id !== b.id) return false;
  const def = ITEMS[a.id];
  return (def?.stack || 1) > 1;
}

export function addItem(inv, id, qty = 1) {
  const def = ITEMS[id];
  if (!def) return qty;
  const max = def.stack || 1;
  let left = qty;

  if (max > 1) {
    for (let i = 0; i < inv.length && left > 0; i++) {
      const s = inv[i];
      if (s && s.id === id && s.qty < max) {
        const take = Math.min(max - s.qty, left);
        s.qty += take; left -= take;
      }
    }
  }
  for (let i = 0; i < inv.length && left > 0; i++) {
    if (!inv[i]) {
      const take = Math.min(max, left);
      inv[i] = { id, qty: take }; left -= take;
    }
  }
  return left;                 // leftover that did not fit
}

export function countItem(inv, id) {
  let n = 0;
  for (const s of inv) if (s?.id === id) n += s.qty;
  return n;
}

export function removeItem(inv, id, qty = 1) {
  let left = qty;
  for (let i = inv.length - 1; i >= 0 && left > 0; i--) {
    const s = inv[i];
    if (s?.id === id) {
      const take = Math.min(s.qty, left);
      s.qty -= take; left -= take;
      if (s.qty <= 0) inv[i] = null;
    }
  }
  return qty - left;           // how many were actually removed
}

export function hasSpace(inv, id, qty = 1) {
  const def = ITEMS[id]; if (!def) return false;
  const max = def.stack || 1;
  let room = 0;
  for (const s of inv) {
    if (!s) room += max;
    else if (s.id === id && s.qty < max) room += max - s.qty;
    if (room >= qty) return true;
  }
  return false;
}

/* ============================================================
   The window
   ============================================================ */
/* Grid geometry: storage is 8 wide, the four weapon slots sit on their own
 * row underneath. The pad cursor walks this layout. */
const COLS = 8;

export class InventoryUI {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.held = null;            // stack currently on the cursor
    this.hoverIndex = -1;
    this.mode = 'inventory';     // inventory | sell
    this.root = null;
    this._mouse = { x: 0, y: 0 };
    this.padIndex = 0;           // cursor position for controller navigation
    this._navT = 0;
    this._bind();
  }

  _bind() {
    addEventListener('mousemove', e => {
      this._mouse.x = e.clientX; this._mouse.y = e.clientY;
      if (this.dragNode) {
        this.dragNode.style.left = e.clientX + 'px';
        this.dragNode.style.top = e.clientY + 'px';
      }
      if (this.tipNode) this._placeTip(e.clientX, e.clientY);
    });
  }

  get inv() { return Save.data.inventory; }

  toggle(mode = 'inventory') { this.open ? this.close() : this.show(mode); }

  show(mode = 'inventory') {
    if (this.open) return;
    this.open = true;
    this.mode = mode;

    const host = document.getElementById('layer-modal');
    this.root = el('div');
    this.root.id = 'inv';
    this.root.innerHTML = `
      <div class="invwrap">
        <div class="invhead">
          <h3>${mode === 'sell' ? 'Sell — Ash Broker' : 'Inventory'}</h3>
          <div class="hlp">${mode === 'sell'
            ? 'CLICK or ✕ to sell for shekels and experience · ESC / ○ to leave'
            : 'CLICK take · SHIFT+CLICK split · RIGHT CLICK place one · Q drop'
              + '<br>PAD: D-pad move · ✕ take/place · □ split · R1 place one · △ drop · ○ close'}</div>
        </div>
        <div class="grid"></div>
        <div class="hotrow"></div>
        <div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:13px;opacity:.6">✦ <b class="coins"></b> shekels</div>
          <div style="font-size:12px;opacity:.45" class="foot"></div>
        </div>
      </div>
    `;
    host.appendChild(this.root);

    $('.grid', this.root).style.gridTemplateColumns = 'repeat(8,1fr)';
    $('.hotrow', this.root).style.gridTemplateColumns = 'repeat(8,1fr)';

    this._buildCells();
    this.render();

    // Dropping the held stack on the backdrop throws it into the world.
    this.root.addEventListener('mousedown', e => {
      if (e.target === this.root && this.held) this._throw();
    });
    this.root.addEventListener('contextmenu', e => e.preventDefault());

    addEventListener('keydown', this._key = e => {
      if (!this.open) return;
      if (e.code === 'Escape' || e.code === 'Tab' || e.code === 'KeyI') { e.preventDefault(); this.close(); }
      if (e.code === 'KeyQ' && this.hoverIndex >= 0) this._dropSlot(this.hoverIndex, e.shiftKey);
    });

    Audio.sfx('uiConfirm', { volume: .5 });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    // Anything still on the cursor goes back into the bag.
    if (this.held) { addItem(this.inv, this.held.id, this.held.qty); this.held = null; }
    this._clearDrag(); this._clearTip();
    removeEventListener('keydown', this._key);
    this._padActive = false;
    this.root?.remove(); this.root = null;
    Save.write();
    this.game?.onInventoryClosed?.();
    Audio.sfx('uiBack', { volume: .5 });
  }

  /** Move the controller cursor. Storage is a grid; the hotbar is one row. */
  _padMove(dx, dy) {
    let i = this.padIndex;
    const inStorage = i >= HOTBAR_SLOTS;

    if (dx) {
      if (inStorage) {
        const rel = i - HOTBAR_SLOTS;
        const row = Math.floor(rel / COLS);
        const col = clamp(rel % COLS + dx, 0, COLS - 1);
        i = HOTBAR_SLOTS + row * COLS + col;
      } else {
        i = clamp(i + dx, 0, HOTBAR_SLOTS - 1);
      }
    }
    if (dy) {
      if (inStorage) {
        const rel = i - HOTBAR_SLOTS;
        const row = Math.floor(rel / COLS), col = rel % COLS;
        const rows = Math.ceil((TOTAL_SLOTS - HOTBAR_SLOTS) / COLS);
        const nr = row + dy;
        // Falling off the bottom drops onto the weapon slots.
        if (nr >= rows) i = clamp(col, 0, HOTBAR_SLOTS - 1);
        else if (nr < 0) i = i;
        else i = clamp(HOTBAR_SLOTS + nr * COLS + col, HOTBAR_SLOTS, TOTAL_SLOTS - 1);
      } else if (dy < 0) {
        // Up from the weapon slots re-enters the last storage row.
        const rows = Math.ceil((TOTAL_SLOTS - HOTBAR_SLOTS) / COLS);
        i = clamp(HOTBAR_SLOTS + (rows - 1) * COLS + i, HOTBAR_SLOTS, TOTAL_SLOTS - 1);
      }
    }
    this.padIndex = clamp(i, 0, TOTAL_SLOTS - 1);
    this._paintCursor();
    Audio.sfx('uiMove', { volume: .4 });
  }

  _paintCursor() {
    if (!this.cells) return;
    this.cells.forEach((c, i) => c?.node.classList.toggle('padcur', i === this.padIndex));
    const cur = this.cells[this.padIndex];
    if (cur) {
      this.hoverIndex = this.padIndex;
      const r = cur.node.getBoundingClientRect();
      this._showTip(this.padIndex, r.right, r.top);
    }
  }

  /** Per-frame controller handling while the window is open. */
  update(dt, input) {
    if (!this.open) return;
    const p = input.p;
    if (!p.usingPad && !this._padActive) return;   // mouse users are unaffected
    this._padActive = true;

    this._navT -= dt;
    const dx = p.isDown('menuRight') ? 1 : p.isDown('menuLeft') ? -1 : 0;
    const dy = p.isDown('menuDown') ? 1 : p.isDown('menuUp') ? -1 : 0;
    if ((dx || dy) && this._navT <= 0) { this._padMove(dx, dy); this._navT = .18; }
    if (!dx && !dy) this._navT = 0;

    if (this.mode === 'sell') {
      if (p.justPressed('confirm') || p.justPressed('attack')) this._sell(this.padIndex);
    } else {
      // Cross takes / places a whole stack, Square splits, Triangle drops.
      if (p.justPressed('confirm')) this._click(this.padIndex, false);
      if (p.justPressed('interact')) this._click(this.padIndex, true);
      if (p.justPressed('use')) this._dropSlot(this.padIndex, false);
      if (p.justPressed('heavy')) this._placeOne(this.padIndex);
    }
    if (p.justPressed('cancel') || p.justPressed('inventory')) this.close();
  }

  _buildCells() {
    const grid = $('.grid', this.root), hot = $('.hotrow', this.root);
    this.cells = [];

    const make = (index, parent) => {
      const c = el('div', 'cell', `<div class="ico"></div><div class="qty"></div>`);
      c.addEventListener('mousedown', e => {
        e.preventDefault();
        if (this.mode === 'sell') return this._sell(index);
        if (e.button === 2) this._placeOne(index);
        else this._click(index, e.shiftKey);
      });
      c.addEventListener('mouseenter', e => { this.hoverIndex = index; this._showTip(index, e.clientX, e.clientY); c.classList.add('over'); });
      c.addEventListener('mouseleave', () => { if (this.hoverIndex === index) this.hoverIndex = -1; this._clearTip(); c.classList.remove('over'); });
      parent.appendChild(c);
      this.cells[index] = { node: c, ico: $('.ico', c), qty: $('.qty', c) };
    };

    for (let i = HOTBAR_SLOTS; i < TOTAL_SLOTS; i++) make(i, grid);
    for (let i = 0; i < HOTBAR_SLOTS; i++) make(i, hot);
    this._paintCursor();
    // Pad the hotbar row out to eight columns so it lines up with the grid.
    for (let i = 0; i < 4; i++) hot.appendChild(el('div', 'cell dead'));
  }

  render() {
    if (!this.root) return;
    const colors = Save.data.colors;
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const c = this.cells[i]; if (!c) continue;
      const s = this.inv[i];
      const def = s ? ITEMS[s.id] : null;
      c.ico.style.backgroundImage = def ? `url('${itemIcon(def, colors)}')` : 'none';
      c.qty.textContent = s && s.qty > 1 ? s.qty : '';
      c.node.className = 'cell' + (def?.rarity ? ' ' + RARITY_CLASS[def.rarity] : '');
    }
    $('.coins', this.root).textContent = Save.data.shekels;
    const used = this.inv.filter(Boolean).length;
    $('.foot', this.root).textContent = `${used} / ${TOTAL_SLOTS} slots used`;
    // Refresh the four HUD slots directly — going through game.syncHotbar()
    // would call back into render() and recurse.
    this.game?.hud?.setHotbar(this.inv.slice(0, 4), Save.data.equipped, Save.data.colors);
  }

  /* ---------- click handling ---------- */
  _click(i, shift) {
    const slot = this.inv[i];
    if (this.held) {
      if (!slot) {
        this.inv[i] = this.held; this.held = null;
      } else if (stackable(slot, this.held)) {
        const max = ITEMS[slot.id].stack || 1;
        const take = Math.min(max - slot.qty, this.held.qty);
        slot.qty += take; this.held.qty -= take;
        if (this.held.qty <= 0) this.held = null;
      } else {
        this.inv[i] = this.held; this.held = slot;    // swap
      }
      Audio.sfx('uiMove', { volume: .5 });
    } else if (slot) {
      if (shift && slot.qty > 1) {
        const half = Math.ceil(slot.qty / 2);
        this.held = { id: slot.id, qty: half };
        slot.qty -= half;
        if (slot.qty <= 0) this.inv[i] = null;
      } else {
        this.held = slot; this.inv[i] = null;
      }
      Audio.sfx('pickup', { volume: .4 });
    }
    this._updateDrag(); this.render(); Save.write();
  }

  _placeOne(i) {
    if (!this.held) {
      // Right click with an empty hand splits the stack in half.
      const s = this.inv[i];
      if (s && s.qty > 1) {
        const half = Math.ceil(s.qty / 2);
        this.held = { id: s.id, qty: half }; s.qty -= half;
        this._updateDrag(); this.render();
      }
      return;
    }
    const slot = this.inv[i];
    if (!slot) { this.inv[i] = { id: this.held.id, qty: 1 }; this.held.qty--; }
    else if (stackable(slot, this.held) && slot.qty < (ITEMS[slot.id].stack || 1)) { slot.qty++; this.held.qty--; }
    else return;
    if (this.held.qty <= 0) this.held = null;
    this._updateDrag(); this.render(); Save.write();
    Audio.sfx('uiMove', { volume: .35 });
  }

  _dropSlot(i, all) {
    const s = this.inv[i]; if (!s) return;
    const qty = all ? s.qty : 1;
    s.qty -= qty;
    if (s.qty <= 0) this.inv[i] = null;
    this.game?.dropItemInWorld?.(s.id, qty);
    this.render(); Save.write();
    Audio.sfx('uiBack', { volume: .5 });
  }

  _throw() {
    if (!this.held) return;
    this.game?.dropItemInWorld?.(this.held.id, this.held.qty);
    this.held = null;
    this._updateDrag(); this.render(); Save.write();
    Audio.sfx('uiBack', { volume: .5 });
  }

  _sell(i) {
    const s = this.inv[i]; if (!s) return;
    const def = ITEMS[s.id];
    if (def.innate) { Audio.sfx('uiDeny'); return; }
    const coins = sellValue(s) * s.qty;
    const xp = xpValue(s) * s.qty;
    Save.data.shekels += coins;
    this.inv[i] = null;
    this.game?.grantXP?.(xp);
    this.game?.onSold?.(s);
    this.render(); Save.write();
    Audio.sfx('coin');
    this.game?.hud?.toast(`SOLD ${def.name.toUpperCase()} · +${coins} ✦ · +${xp} XP`);
  }

  /* ---------- cursor stack ---------- */
  _updateDrag() {
    if (this.held) {
      if (!this.dragNode) {
        this.dragNode = el('div'); this.dragNode.id = 'drag';
        document.body.appendChild(this.dragNode);
      }
      this.dragNode.style.backgroundImage = `url('${itemIcon(ITEMS[this.held.id], Save.data.colors)}')`;
      this.dragNode.style.left = this._mouse.x + 'px';
      this.dragNode.style.top = this._mouse.y + 'px';
      this.dragNode.textContent = this.held.qty > 1 ? this.held.qty : '';
      this.dragNode.style.cssText += ';display:grid;place-items:end center;font:600 13px Cinzel,serif;color:#fff;text-shadow:0 1px 3px #000';
    } else this._clearDrag();
  }
  _clearDrag() { this.dragNode?.remove(); this.dragNode = null; }

  /* ---------- tooltip ---------- */
  _showTip(i, x, y) {
    const s = this.inv[i]; if (!s) return this._clearTip();
    const def = ITEMS[s.id]; if (!def) return;
    this._clearTip();
    const n = el('div'); n.id = 'tip';
    const kindLabel = { melee: 'MELEE', range: 'RANGED', bomb: 'BOMB', shield: 'SHIELD', consumable: 'CONSUMABLE', misc: 'ITEM' }[def.kind] || '';
    const lines = [];
    if (def.damage) lines.push(`Damage ${def.damage}`);
    if (def.speed) lines.push(`Swing ${def.speed.toFixed(2)}s`);
    if (def.reach) lines.push(`Reach ${def.reach.toFixed(1)}m`);
    if (def.block) lines.push(`Blocks ${Math.round(def.block * 100)}%`);
    if (def.radius) lines.push(`Radius ${def.radius}m`);
    if (def.heal) lines.push(`Heals ${def.heal === 999 ? 'fully' : def.heal}`);
    if (def.power) lines.push(`Power cost ${def.power}`);
    if (def.element) lines.push(`Element: ${def.element}`);
    n.innerHTML = `
      <div class="n">${def.name}${def.jp ? ' · ' + def.jp : ''}</div>
      <div style="font-family:Cinzel,serif;font-size:10px;letter-spacing:.2em;opacity:.55">${kindLabel}${def.rarity ? ' · ' + def.rarity.toUpperCase() : ''}</div>
      <div class="s">${lines.join(' · ')}</div>
      ${def.desc ? `<div class="d">${def.desc}</div>` : ''}
      <div class="s">Sells for ✦${sellValue(s)} · ${xpValue(s)} XP</div>
    `;
    document.body.appendChild(n);
    this.tipNode = n;
    this._placeTip(x, y);
  }
  _placeTip(x, y) {
    if (!this.tipNode) return;
    const r = this.tipNode.getBoundingClientRect();
    this.tipNode.style.left = clamp(x + 18, 8, innerWidth - r.width - 8) + 'px';
    this.tipNode.style.top = clamp(y + 18, 8, innerHeight - r.height - 8) + 'px';
  }
  _clearTip() { this.tipNode?.remove(); this.tipNode = null; }
}
