/*
 * Touch controls for phones and tablets: a floating stick on the left, drag to look on the right,
 * and buttons for everything else. They feed the same actions as keys and the controller.
 */
import { abilityIcon } from './icons.js';
import { el } from '../core/util.js';
import { input } from '../core/input.js';
import { IS_TOUCH } from '../core/device.js';
import { ABILITIES, ITEMS } from '../game/abilities.js';

export class Touch {
  constructor(game, root) {
    this.game = game; this.root = root;
    this.on = false; this.sprintToggle = false;
    this.move = null; this.look = null;
    if (IS_TOUCH) this.enable();
    addEventListener('touchstart', () => { if (!this.on) this.enable(); input.device = 'touch'; }, { passive: true });
  }
  enable() {
    if (this.on) return;
    this.on = true; document.body.classList.add('touch');
    const r = this.root; r.classList.add('on'); r.innerHTML = '';
    const mz = el('div', 'tz move'), lz = el('div', 'tz look');
    this.stick = el('div', 'stick hidden', '<i></i>');
    r.append(lz, mz, this.stick);
    // the stick appears where the thumb lands
    mz.addEventListener('pointerdown', (e) => { e.preventDefault(); input.device = 'touch'; this.move = { id: e.pointerId, x: e.clientX, y: e.clientY }; this.stick.style.left = e.clientX + 'px'; this.stick.style.top = e.clientY + 'px'; this.stick.classList.remove('hidden'); mz.setPointerCapture(e.pointerId); });
    mz.addEventListener('pointermove', (e) => {
      if (!this.move || e.pointerId !== this.move.id) return;
      let dx = e.clientX - this.move.x, dy = e.clientY - this.move.y; const R = 52, L = Math.hypot(dx, dy);
      if (L > R) { dx *= R / L; dy *= R / L; }
      input.touch.move.x = dx / R; input.touch.move.y = -dy / R;
      this.stick.firstChild.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      // push the stick far to run
      if (L > R * 1.6) this.sprintToggle = true;
    });
    const endMove = (e) => { if (!this.move || e.pointerId !== this.move.id) return; this.move = null; input.touch.move.x = input.touch.move.y = 0; this.stick.classList.add('hidden'); this.stick.firstChild.style.transform = ''; };
    mz.addEventListener('pointerup', endMove); mz.addEventListener('pointercancel', endMove);
    lz.addEventListener('pointerdown', (e) => { input.device = 'touch'; this.look = { id: e.pointerId, x: e.clientX, y: e.clientY }; lz.setPointerCapture(e.pointerId); });
    lz.addEventListener('pointermove', (e) => { if (!this.look || e.pointerId !== this.look.id) return; input.touch.look.x += (e.clientX - this.look.x) * 1.6; input.touch.look.y += (e.clientY - this.look.y) * 1.6; this.look.x = e.clientX; this.look.y = e.clientY; });
    const endLook = (e) => { if (this.look && e.pointerId === this.look.id) this.look = null; };
    lz.addEventListener('pointerup', endLook); lz.addEventListener('pointercancel', endLook);
    // buttons
    this.btns = el('div', 'tbtns'); r.appendChild(this.btns);
    this.top = el('div', 'ttop'); r.appendChild(this.top);
    this.layout = '';
  }
  _btn(parent, label, action, x, y, big, hold = true) {
    const b = el('button', 'tb' + (big ? ' big' : ''), label);
    if (x !== null) { b.style.right = x + 'rem'; b.style.bottom = y + 'rem'; }
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); input.device = 'touch'; input.touch.buttons.add(action); b.classList.add('on'); if (!hold) setTimeout(() => { input.touch.buttons.delete(action); b.classList.remove('on'); }, 90); });
    const up = () => { if (hold) { input.touch.buttons.delete(action); b.classList.remove('on'); } };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    parent.appendChild(b);
    return b;
  }
  /** Rebuild the buttons for what the player is doing (lobby, survivor, killer, spectating). */
  setLayout(mode, actor) {
    if (!this.on) return;
    const key = mode + ':' + (actor ? actor.charId : '');
    if (key === this.layout) return;
    this.layout = key;
    this.btns.innerHTML = ''; this.top.innerHTML = ''; this.abBtns = [];
    const pause = el('button', 'tb', '☰'); pause.onclick = () => this.game.togglePause(); this.top.appendChild(pause);
    const chat = el('button', 'tb', '💬'); chat.onclick = () => (this.game.chat.isOpen ? this.game.chat.close() : this.game.chat.open()); this.top.appendChild(chat);
    if (mode === 'menu') { this.btns.classList.add('hidden'); return; }
    this.btns.classList.remove('hidden');
    this._btn(this.btns, 'JUMP', 'jump', 0.2, 0.2, true);
    const run = el('button', 'tb', 'RUN'); run.style.right = '5.6rem'; run.style.bottom = '0.2rem';
    run.onpointerdown = (e) => { e.preventDefault(); this.sprintToggle = !this.sprintToggle; run.classList.toggle('on', this.sprintToggle); };
    this.btns.appendChild(run); this.runBtn = run;
    if (mode === 'lobby') { this._btn(this.btns, 'EMOTE', 'emote', 0.4, 5.6, false, false); return; }
    if (mode === 'spectate') { this._btn(this.btns, '◀', 'tabPrev', 9.6, 0.4, false, false); this._btn(this.btns, '▶', 'tabNext', 5.6, 4.4, false, false); this._btn(this.btns, 'ECHO', 'ability1', 0.4, 5.6, false, false); return; }
    const d = actor.def, acts = ['ability1', 'ability2', 'ability3'];
    if (actor.role === 'killer') {
      this._btn(this.btns, 'HIT', 'attack', 0.2, 5.4, true);
      d.abilities.forEach((a, i) => { const b = this._btn(this.btns, abilityIcon(a.id, ABILITIES[a.id] && ABILITIES[a.id].icon || '') + '<br>' + a.name.split(' ')[0], acts[i], [5.8, 9.6, 9.6][i], [4.6, 0.6, 4.6][i], false, false); b.dataset.ab = a.id; this.abBtns.push(b); });
    } else {
      this._btn(this.btns, 'USE', 'interact', 0.4, 5.6, false, false);
      d.abilities.forEach((a, i) => { const b = this._btn(this.btns, abilityIcon(a.id, ABILITIES[a.id] && ABILITIES[a.id].icon || '') + '<br>' + a.name.split(' ')[0], acts[i], [5.8, 9.6][i], [4.6, 0.6][i], false, false); b.dataset.ab = a.id; this.abBtns.push(b); });
      this.itemBtn = this._btn(this.btns, 'ITEM', 'ability3', 9.6, 4.6, false, false);
    }
  }
  update(actor) {
    if (!this.on || !actor || !this.abBtns) return;
    if (this.sprintToggle && Math.hypot(input.touch.move.x, input.touch.move.y) < 0.1 && !this.move) { this.sprintToggle = false; if (this.runBtn) this.runBtn.classList.remove('on'); }
    if (this.runBtn) this.runBtn.classList.toggle('on', this.sprintToggle);
    for (const b of this.abBtns) {
      const cd = actor.cd[b.dataset.ab] || 0;
      let c = b.querySelector('.cd');
      if (cd > 0) { if (!c) { c = el('div', 'cd'); b.appendChild(c); } c.textContent = Math.ceil(cd); } else if (c) c.remove();
    }
    if (this.itemBtn) { this.itemBtn.style.opacity = actor.item ? 1 : 0.4; if (this._item !== actor.item) { this._item = actor.item; this.itemBtn.innerHTML = actor.item ? abilityIcon(actor.item) + '<br>' + ITEMS[actor.item].name.split(' ')[0] : 'ITEM'; } }
  }
}
