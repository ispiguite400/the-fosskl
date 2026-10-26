/*
 * Chat, Roblox style: a log in the corner, bubbles over heads, and a box to type in
 * (Enter or / on a keyboard; the chat button on touch; quick lines on a controller).
 * Bots read what the player says and sometimes answer.
 */
import { el, esc, R } from '../core/util.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { replyTopic, say } from '../data/bots.js';
import { IS_TOUCH } from '../core/device.js';

const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa', '#f783ac', '#63e6be', '#e599f7', '#74c0fc'];
const nameColor = (name) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const QUICK = ['help!', 'killer here!', 'on my way', 'doing gens', 'thanks!', 'gg', 'hi', 'sorry'];

export class Chat {
  constructor(game, root) {
    this.game = game;
    this.box = el('div', 'chat');
    this.logEl = el('div', 'log');
    this.input = el('input'); this.input.type = 'text'; this.input.maxLength = 120; this.input.placeholder = 'To chat click here or press / key'; this.input.className = 'hidden';
    this.quick = el('div', 'quick hidden');
    for (const q of QUICK) { const b = el('button', '', q); b.onclick = () => { this.send(q); this.close(); }; this.quick.appendChild(b); }
    this.box.append(this.logEl, this.input, this.quick);
    root.appendChild(this.box);
    this.btn = el('button', 'chat-btn', '💬 Chat');
    this.btn.onclick = () => (this.isOpen ? this.close() : this.open());
    root.appendChild(this.btn);
    this.isOpen = false;
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = this.input.value.trim(); if (t) this.send(t); this.close(); }
      else if (e.key === 'Escape') this.close();
    });
    this.input.addEventListener('blur', () => { if (this.isOpen && !IS_TOUCH) setTimeout(() => this.close(), 100); });
    this.lines = [];
  }
  setVisible(v) { this.box.classList.toggle('hidden', !v); this.btn.classList.toggle('hidden', !v); }
  open() {
    this.isOpen = true; this.box.classList.add('open');
    this.input.classList.remove('hidden'); this.quick.classList.remove('hidden');
    input.typing = true; input.keys.clear();
    input.releaseLock();
    setTimeout(() => this.input.focus(), 0);
    for (const l of this.lines) l.classList.remove('old');
  }
  close() {
    this.isOpen = false; this.box.classList.remove('open');
    this.input.value = ''; this.input.classList.add('hidden'); this.quick.classList.add('hidden');
    this.input.blur(); input.typing = false;
  }
  _line(html, cls) {
    const d = el('div', cls || '', html);
    this.logEl.appendChild(d);
    this.lines.push(d);
    while (this.lines.length > 40) this.lines.shift().remove();
    setTimeout(() => { if (!this.isOpen) d.classList.add('old'); else d.dataset.old = '1'; }, 12000);
    return d;
  }
  /** A message from someone (member), shown over their character (actor) if there is one. */
  post(member, text, actor) {
    const color = member.bot ? nameColor(member.name) : '#7fe3ff';
    this._line('<b style="color:' + color + '">' + esc(member.name) + ':</b> ' + esc(text));
    audio.sfx('chat', { vol: 0.5 });
    const a = actor || this.game.actorOf(member);
    if (a) this.game.worldUi.bubble(a, text);
  }
  system(text, kind = '') { this._line('<span class="sys ' + kind + '">[' + esc(text) + ']</span>'); }
  /** The player said something: show it, then let the bots answer if they feel like it. */
  send(text) {
    const me = this.game.server.me;
    this.post(me, text, this.game.actorOf(me));
    const topic = replyTopic(text);
    if (!topic) return;
    const bots = this.game.server.bots().filter((b) => !b.leaving);
    R.shuffle(bots);
    let n = 0;
    for (const b of bots) {
      if (n >= 2) break;
      if (R() > 0.25 + b.persona.chat * 0.5) continue;
      const killer = this.game.match && this.game.match.killer;
      const line = say(b, topic, { name: me.name, place: 'gen ' + (1 + Math.floor(R() * 5)), killer: killer ? killer.def.name : 'idk', kname: killer ? killer.name : 'idk' }, true);
      if (!line) continue;
      n++;
      setTimeout(() => this.post(b, line), 900 + n * 700 + R() * 1500);
    }
  }
  update() {
    if (input.typing) return;
    if (input.pressed('chat') && !this.game.ui.modal()) { input.consume('chat'); this.open(); }
  }
}
