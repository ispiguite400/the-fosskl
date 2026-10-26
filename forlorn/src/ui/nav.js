/*
 * Menus with a controller: the D-pad (or left stick) moves a focus ring to the nearest button in
 * that direction, ✕ presses it, ○ goes back, L1/R1 switch tabs. Keyboard arrows work the same.
 */
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';

const SEL = '.btn:not([disabled]), .ccard, .card, .node, [data-nav]';

export class MenuNav {
  constructor() { this.focus = null; this.repeat = 0; this.stickHeld = ''; }
  items(root) { return [...root.querySelectorAll(SEL)].filter((e) => e.offsetParent !== null && !e.closest('.hidden')); }
  set(e) {
    if (this.focus === e) return;
    if (this.focus) this.focus.classList.remove('focus');
    this.focus = e;
    if (e) { e.classList.add('focus'); e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  move(root, dx, dy) {
    const list = this.items(root); if (!list.length) return;
    if (!this.focus || !list.includes(this.focus)) { this.set(list[0]); return; }
    const a = this.focus.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bs = Infinity;
    for (const e of list) {
      if (e === this.focus) continue;
      const b = e.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const vx = bx - ax, vy = by - ay;
      const along = vx * dx + vy * dy; if (along <= 4) continue;
      const side = Math.abs(vx * dy - vy * dx);
      const s = along + side * 2.2;
      if (s < bs) { bs = s; best = e; }
    }
    if (best) { this.set(best); audio.sfx('ui_move'); }
  }
  /** Run each frame while a menu is up. onBack is called for ○ / Esc. */
  update(root, dt, { onBack, onTab } = {}) {
    if (!root || input.typing) return;
    const dev = input.device;
    if (dev === 'kbm' || dev === 'touch') { if (this.focus && dev === 'touch') { this.focus.classList.remove('focus'); this.focus = null; } }
    // the left stick acts as a D-pad in menus
    const sx = input.move.x, sy = input.move.y;
    let stick = '';
    if (dev === 'pad') { if (sx > 0.6) stick = 'R'; else if (sx < -0.6) stick = 'L'; else if (sy > 0.6) stick = 'U'; else if (sy < -0.6) stick = 'D'; }
    this.repeat -= dt;
    const fire = (d) => { if (d === 'U') this.move(root, 0, -1); if (d === 'D') this.move(root, 0, 1); if (d === 'L') this.move(root, -1, 0); if (d === 'R') this.move(root, 1, 0); };
    if (stick && (stick !== this.stickHeld || this.repeat <= 0)) { fire(stick); this.repeat = stick !== this.stickHeld ? 0.35 : 0.12; }
    this.stickHeld = stick;
    const padOrArrows = dev === 'pad' || input.keys.has('ArrowUp') || input.keys.has('ArrowDown') || input.keys.has('ArrowLeft') || input.keys.has('ArrowRight');
    if (padOrArrows) {
      if (input.pressed('menuUp')) fire('U');
      if (input.pressed('menuDown')) fire('D');
      if (input.pressed('menuLeft')) fire('L');
      if (input.pressed('menuRight')) fire('R');
    }
    if (this.focus && !root.contains(this.focus)) this.focus = null;
    if (dev === 'pad' && !this.focus) { const l = this.items(root); if (l.length) this.set(l[0]); }
    if (input.pressed('confirm') && this.focus && (dev === 'pad' || input.keys.has('Enter'))) { audio.sfx('ui'); this.focus.click(); }
    if (input.pressed('cancel') && onBack) { audio.sfx('ui_back'); onBack(); }
    if (onTab) { if (input.pressed('tabPrev')) onTab(-1); if (input.pressed('tabNext')) onTab(1); }
  }
  reset() { if (this.focus) this.focus.classList.remove('focus'); this.focus = null; }
}
