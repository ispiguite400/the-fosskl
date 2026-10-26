/*
 * Input: keyboard + mouse, PS5 DualSense (any "standard" gamepad) and touch,
 * all folded into named actions so the game never asks which device it was.
 *
 *   input.move   { x, y }   -1..1 (y + is forward)
 *   input.look   { x, y }   this frame's look delta, in "mouse pixels"
 *   input.down(a) / pressed(a) / released(a)
 *   input.device 'kbm' | 'pad' | 'touch'  (the last one used; drives on-screen glyphs)
 *   input.glyph(a)          the button to show for an action on the current device
 *   input.rumble(strong, weak, ms)
 */
import { clamp } from './util.js';
import { IS_TOUCH } from './device.js';

export const PAD = { CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, R2: 7, CREATE: 8, OPTIONS: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, PS: 16, TOUCHPAD: 17 };
const PAD_GLYPH = { 0: '✕', 1: '○', 2: '□', 3: '△', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'CREATE', 9: 'OPTIONS', 10: 'L3', 11: 'R3', 12: '▲', 13: '▼', 14: '◀', 15: '▶', 17: 'TOUCHPAD' };

/* action -> keys, mouse buttons, pad buttons */
const BIND = {
  sprint:    { keys: ['ShiftLeft', 'ShiftRight'], pad: [PAD.L3, PAD.L1] },
  jump:      { keys: ['Space'], pad: [PAD.CROSS] },
  interact:  { keys: ['KeyE'], pad: [PAD.SQUARE] },
  attack:    { keys: [], mouse: [0], pad: [PAD.R2] },
  ability1:  { keys: ['KeyQ'], pad: [PAD.R1] },
  ability2:  { keys: ['KeyR'], pad: [PAD.L2] },
  ability3:  { keys: ['KeyF'], pad: [PAD.TRIANGLE] },
  emote:     { keys: ['KeyG'], pad: [PAD.RIGHT] },
  scoreboard:{ keys: ['Tab'], pad: [PAD.TOUCHPAD] },
  chat:      { keys: ['Enter', 'Slash'] },
  pause:     { keys: ['Escape'], pad: [PAD.OPTIONS] },
  lockCam:   { keys: [], mouse: [2] },
  confirm:   { keys: ['Enter', 'Space'], pad: [PAD.CROSS] },
  cancel:    { keys: ['Escape', 'Backspace'], pad: [PAD.CIRCLE] },
  menuUp:    { keys: ['ArrowUp', 'KeyW'], pad: [PAD.UP] },
  menuDown:  { keys: ['ArrowDown', 'KeyS'], pad: [PAD.DOWN] },
  menuLeft:  { keys: ['ArrowLeft', 'KeyA'], pad: [PAD.LEFT] },
  menuRight: { keys: ['ArrowRight', 'KeyD'], pad: [PAD.RIGHT] },
  tabPrev:   { keys: ['KeyZ'], pad: [PAD.L1] },
  tabNext:   { keys: ['KeyC'], pad: [PAD.R1] },
  alt:       { keys: ['KeyX'], pad: [PAD.TRIANGLE] }
};
const KEY_LABEL = { ShiftLeft: 'SHIFT', Space: 'SPACE', KeyE: 'E', KeyQ: 'Q', KeyR: 'R', KeyF: 'F', KeyG: 'G', Tab: 'TAB', Enter: 'ENTER', Escape: 'ESC', KeyX: 'X', KeyZ: 'Z', KeyC: 'C' };

class Input {
  constructor() {
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.device = IS_TOUCH ? 'touch' : 'kbm';
    this.typing = false;                    // the chat box has the keyboard
    this.keys = new Set(); this.mouse = new Set();
    this.taps = new Set(); this.mouseTaps = new Set();      // pressed and released between two frames still count
    this.held = new Set(); this.prev = new Set(); this._pressed = new Set(); this._released = new Set();
    this.mouseDelta = { x: 0, y: 0 };
    this.locked = false;
    this.touch = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, buttons: new Set() };
    this.pad = null; this.padIndex = -1;
    this.wheel = 0;
    this._bind();
  }
  _bind() {
    addEventListener('keydown', (e) => {
      if (this.typing) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'Slash'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code); this.taps.add(e.code); this.device = 'kbm';
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('blur', () => { this.keys.clear(); this.mouse.clear(); });
    addEventListener('mousedown', (e) => { this.mouse.add(e.button); this.mouseTaps.add(e.button); this.device = 'kbm'; });
    addEventListener('mouseup', (e) => this.mouse.delete(e.button));
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (this.locked) { this.mouseDelta.x += e.movementX; this.mouseDelta.y += e.movementY; }
      else if (this.mouse.has(2) && this.device === 'kbm') { this.mouseDelta.x += e.movementX; this.mouseDelta.y += e.movementY; }   // right-drag to look without lock
    });
    addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement != null; });
    addEventListener('gamepadconnected', (e) => { if (this.padIndex < 0) this.padIndex = e.gamepad.index; });
    addEventListener('gamepaddisconnected', (e) => { if (this.padIndex === e.gamepad.index) this.padIndex = -1; });
  }
  requestLock(canvas) {
    if (this.device !== 'kbm' || this.locked) return;
    try { const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { canvas.requestPointerLock(); } catch { /* not allowed here */ } }); } catch { /* sandboxed */ }
  }
  releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  /** Poll once per frame, before the game reads anything. */
  update() {
    this.prev = this.held; this.held = new Set();
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = this.padIndex >= 0 ? pads[this.padIndex] : null;
    if (!pad) for (const p of pads) if (p && p.connected) { pad = p; this.padIndex = p.index; break; }
    this.pad = pad;
    let px = 0, py = 0, lx = 0, ly = 0;
    const dz = (v, d = 0.14) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
    if (pad) {
      px = dz(pad.axes[0] || 0); py = -dz(pad.axes[1] || 0);
      lx = dz(pad.axes[2] || 0, 0.1); ly = dz(pad.axes[3] || 0, 0.1);
      const any = Math.abs(px) + Math.abs(py) + Math.abs(lx) + Math.abs(ly) > 0.2 || pad.buttons.some((b) => b.pressed);
      if (any) this.device = 'pad';
    }
    // actions
    for (const a in BIND) {
      const b = BIND[a];
      let on = false;
      if (!this.typing) for (const k of b.keys) if (this.keys.has(k) || this.taps.has(k)) on = true;
      if (b.mouse) for (const m of b.mouse) if (this.mouse.has(m) || this.mouseTaps.has(m)) on = true;
      if (pad && b.pad) for (const i of b.pad) if (pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4)) on = true;
      if (this.touch.buttons.has(a)) on = true;
      if (on) this.held.add(a);
    }
    this.taps.clear(); this.mouseTaps.clear();
    this._pressed = new Set([...this.held].filter((a) => !this.prev.has(a)));
    this._released = new Set([...this.prev].filter((a) => !this.held.has(a)));
    // movement
    let kx = 0, ky = 0;
    if (!this.typing) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ky += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ky -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    }
    let mx = kx + px + this.touch.move.x, my = ky + py + this.touch.move.y;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.move.x = mx; this.move.y = my;
    // look: mouse pixels, stick scaled to feel like a mouse, touch drag
    const stick = 16 * (1 + 1.6 * Math.max(Math.abs(lx), Math.abs(ly)));
    this.look.x = this.mouseDelta.x + lx * stick + this.touch.look.x;
    this.look.y = this.mouseDelta.y + ly * stick + this.touch.look.y;
    this.mouseDelta.x = this.mouseDelta.y = 0;
    this.touch.look.x = this.touch.look.y = 0;
  }
  down(a) { return this.held.has(a); }
  pressed(a) { return this._pressed.has(a); }
  released(a) { return this._released.has(a); }
  consume(a) { this._pressed.delete(a); }
  takeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  /** The button label to show for an action on the device in use. */
  glyph(a) {
    const b = BIND[a]; if (!b) return '';
    if (this.device === 'pad') return b.pad && b.pad.length ? PAD_GLYPH[b.pad[0]] : '';
    if (this.device === 'touch') return '';
    if (b.mouse && b.mouse.length && !b.keys.length) return b.mouse[0] === 0 ? 'LMB' : 'RMB';
    return b.keys.length ? (KEY_LABEL[b.keys[0]] || b.keys[0].replace(/^Key|^Digit/, '')) : '';
  }
  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    const a = this.pad && this.pad.vibrationActuator;
    if (a && a.playEffect) a.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch(() => {});
  }
}

export const input = new Input();
