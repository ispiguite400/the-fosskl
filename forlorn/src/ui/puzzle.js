/*
 * The generator puzzle: reconnect the wires. Four coloured plugs on the left, the same colours
 * shuffled on the right; join each pair. Each solved board is one part of the generator.
 * A wrong join sparks, and the noise carries to the killer.
 *
 * Mouse / touch: click (or drag) left then right. Controller or keys: up/down to choose,
 * confirm to pick, then up/down on the right and confirm. Moving away cancels.
 */
import { el } from '../core/util.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { R } from '../core/util.js';
import { PARTS } from '../game/props.js';
import { glyph } from './glyph.js';

const COLORS = ['#ff4b4b', '#ffd23f', '#3fa7ff', '#4bff7a', '#c46bff', '#ff8a3f'];

export class Puzzle {
  /** inp: whose controls (split screen: player two's controller), p: whose glyphs */
  constructor(game, root, inp = input, p = 1) { this.game = game; this.root = root; this.open = false; this.inp = inp; this.p = p; }
  start(gen, M, actor) {
    this.gen = gen; this.M = M; this.actor = actor;
    this.open = true;
    this.inp.consume('interact'); this.inp.consume('confirm');
    this.inp.releaseLock();
    this.board();
  }
  board() {
    const n = this.gen.progress >= 2 ? 5 : 4;
    this.n = n;
    this.cols = R.shuffle(COLORS.slice()).slice(0, n);
    this.right = R.shuffle(this.cols.map((c, i) => i));
    this.links = new Array(n).fill(-1);
    this.side = 'L'; this.cur = 0; this.sel = -1;
    if (this.el) this.el.remove();
    const e = this.el = el('div', 'puzzle');
    e.innerHTML = '<h4>GENERATOR ' + (this.gen.index + 1) + '<small>part ' + (Math.floor(this.gen.progress) + 1) + ' of ' + PARTS + '</small></h4><div class="board"><svg></svg><div class="col L"></div><div class="col R"></div></div><div class="gp"><i></i></div><div class="hint"></div>';
    this.svg = e.querySelector('svg');
    const L = e.querySelector('.col.L'), Rr = e.querySelector('.col.R');
    this.nodesL = this.cols.map((c, i) => { const b = el('button', 'node'); b.style.setProperty('--c', c); b.onpointerdown = (ev) => { ev.preventDefault(); this.pick('L', i); }; L.appendChild(b); return b; });
    this.nodesR = this.right.map((ci, j) => { const b = el('button', 'node'); b.style.setProperty('--c', this.cols[ci]); b.onpointerdown = (ev) => { ev.preventDefault(); this.pick('R', j); }; b.onpointerup = () => { if (this.sel >= 0) this.pick('R', j); }; Rr.appendChild(b); return b; });
    // drag from left and let go over a right plug
    e.addEventListener('pointerup', (ev) => {
      if (this.sel < 0) return;
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      const j = this.nodesR.indexOf(t); if (j >= 0) this.pick('R', j);
    });
    this.root.appendChild(e);
    this.updateHint();
    this.draw();
  }
  updateHint() {
    const d = this.inp.device, p = this.p;
    this.el.querySelector('.hint').innerHTML = d === 'pad' ? 'D-pad to choose · ' + glyph('confirm', '', p) + ' connect · ' + glyph('cancel', '', p) + ' leave' : d === 'touch' ? 'Tap a wire, then its match · move to leave' : 'Click a wire, then its match · move or ' + glyph('cancel', '', p) + ' to leave';
    this.el.querySelector('.gp i').style.width = (this.gen.progress / PARTS * 100) + '%';
  }
  pick(side, i) {
    if (side === 'L') { if (this.links[i] >= 0) return; this.sel = i; this.side = 'R'; this.cur = this.right.findIndex((ci, j) => !this.links.includes(j)); audio.sfx('gen_tick'); }
    else if (this.sel >= 0) {
      if (this.links.includes(i)) return;
      if (this.right[i] === this.sel) { this.links[this.sel] = i; audio.sfx('gen_tick'); audio.sfx('ui', { vol: 0.5 }); }
      else { this.nodesR[i].classList.add('bad'); setTimeout(() => this.nodesR[i] && this.nodesR[i].classList.remove('bad'), 300); this.M.genMistake(this.actor, this.gen); this.inp.rumble(0.6, 0.6, 150); }
      this.sel = -1; this.side = 'L'; this.cur = Math.max(0, this.links.findIndex((x) => x < 0));
      if (this.links.every((x) => x >= 0)) { this.solved(); return; }
    }
    this.draw();
  }
  solved() {
    const a = this.actor;
    let amount = 1;
    if (this.M.bondedNear(a)) amount *= 1.1;
    if (a.def.id === 'matt' && this.gen.users.size > 1) amount *= 1.15;
    const r = this.M.genPart(a, this.gen, amount);
    this.inp.rumble(0.3, 0.2, 80);
    if (r === 'done' || this.gen.done) { this.close(); return; }
    this.board();
  }
  draw() {
    this.nodesL.forEach((b, i) => { b.classList.toggle('done', this.links[i] >= 0); b.classList.toggle('sel', this.sel === i); b.classList.toggle('focus', this.side === 'L' && this.cur === i && this.inp.device === 'pad'); });
    this.nodesR.forEach((b, j) => { b.classList.toggle('done', this.links.includes(j)); b.classList.toggle('focus', this.side === 'R' && this.cur === j && this.inp.device === 'pad'); });
    const box = this.svg.getBoundingClientRect();
    const c = (b) => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top]; };
    let s = '';
    this.links.forEach((j, i) => { if (j < 0) return; const [x1, y1] = c(this.nodesL[i]), [x2, y2] = c(this.nodesR[j]); s += '<path d="M' + x1 + ' ' + y1 + ' C' + (x1 + 90) + ' ' + y1 + ',' + (x2 - 90) + ' ' + y2 + ',' + x2 + ' ' + y2 + '" stroke="' + this.cols[i] + '" stroke-width="7" fill="none" stroke-linecap="round" style="filter:drop-shadow(0 0 4px ' + this.cols[i] + ')"/>'; });
    this.svg.innerHTML = s;
  }
  close() {
    if (!this.open) return;
    this.open = false;
    if (this.el) { this.el.remove(); this.el = null; }
    const a = this.actor;
    if (a && a.busy && a.busy.kind === 'repair') a.cancelBusy();
    if (this.p === 1) this.game.relock();
  }
  update() {
    if (!this.open) return;
    const input = this.inp;
    const a = this.actor;
    if (!a.alive || !a.busy || a.busy.kind !== 'repair' || this.gen.done || this.M.phase === 'end') { this.close(); return; }
    if (input.pressed('cancel') || Math.hypot(input.move.x, input.move.y) > 0.5) { this.close(); return; }
    const list = this.side === 'L' ? this.nodesL : this.nodesR;
    const taken = (k) => (this.side === 'L' ? this.links[k] >= 0 : this.links.includes(k));
    const step = (d) => { let k = this.cur; for (let t = 0; t < list.length; t++) { k = (k + d + list.length) % list.length; if (!taken(k)) break; } this.cur = k; this.draw(); audio.sfx('ui_move', { vol: 0.5 }); };
    if (input.device === 'pad') {
      if (input.pressed('menuUp')) step(-1);
      if (input.pressed('menuDown')) step(1);
      if (input.pressed('confirm')) this.pick(this.side, this.cur);
    }
    if (input.device !== this._dev) { this._dev = input.device; this.updateHint(); this.draw(); }
  }
}
