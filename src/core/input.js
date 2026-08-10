/* Unified input: keyboard + mouse + DualSense/standard gamepads.
 *
 * Everything the game asks about is expressed as an *action* so that the
 * combat code never needs to know whether R2 or the left mouse button was
 * pressed. Two players are supported (pad 0 / pad 1) for split-screen; the
 * keyboard always drives player 0. */

import { clamp } from './util.js';

/* Standard Gamepad indices. A DualSense reports as "standard" in Chrome,
 * Edge and Firefox, so these map cleanly onto PS5 face buttons. */
export const PAD = {
  CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3,
  L1: 4, R1: 5, L2: 6, R2: 7,
  CREATE: 8, OPTIONS: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
  PS: 16, TOUCHPAD: 17
};

/* action -> { keys:[], pad:[] } */
const BINDINGS = {
  forward:   { keys: ['KeyW', 'ArrowUp'] },
  back:      { keys: ['KeyS', 'ArrowDown'] },
  left:      { keys: ['KeyA', 'ArrowLeft'] },
  right:     { keys: ['KeyD', 'ArrowRight'] },
  jump:      { keys: ['Space'],        pad: [PAD.CROSS] },
  sprint:    { keys: ['ShiftLeft'],    pad: [PAD.L3] },
  crouch:    { keys: ['ControlLeft', 'KeyC'], pad: [PAD.CIRCLE] },
  attack:    { keys: [],               pad: [PAD.R2], mouse: [0] },
  heavy:     { keys: [],               pad: [PAD.R1], mouse: [] },
  block:     { keys: [],               pad: [PAD.L2], mouse: [2] },
  dash:      { keys: ['Space'],        pad: [PAD.CROSS] },   // held in air = wind dash
  interact:  { keys: ['KeyE'],         pad: [PAD.SQUARE] },
  inventory: { keys: ['Tab', 'KeyI'],  pad: [PAD.TOUCHPAD] },
  pause:     { keys: ['Escape'],       pad: [PAD.OPTIONS] },
  slot1:     { keys: ['Digit1'] },
  slot2:     { keys: ['Digit2'] },
  slot3:     { keys: ['Digit3'] },
  slot4:     { keys: ['Digit4'] },
  nextSlot:  { keys: ['KeyQ'],         pad: [PAD.R1] },
  prevSlot:  { keys: [],               pad: [PAD.L1] },
  drop:      { keys: ['KeyG'] },
  use:       { keys: ['KeyF'],         pad: [PAD.TRIANGLE] },
  menuUp:    { keys: ['KeyW', 'ArrowUp'],    pad: [PAD.UP] },
  menuDown:  { keys: ['KeyS', 'ArrowDown'],  pad: [PAD.DOWN] },
  menuLeft:  { keys: ['KeyA', 'ArrowLeft'],  pad: [PAD.LEFT] },
  menuRight: { keys: ['KeyD', 'ArrowRight'], pad: [PAD.RIGHT] },
  confirm:   { keys: ['Enter', 'Space'],     pad: [PAD.CROSS] },
  cancel:    { keys: ['Escape', 'Backspace'], pad: [PAD.CIRCLE] },
  mute:      { keys: ['KeyM'] }
};

class PlayerInput {
  constructor(index) {
    this.index = index;
    this.padIndex = index;      // which gamepad slot drives this player
    this.keyboard = index === 0;
    this.down = new Set();      // action names currently held
    this.pressed = new Set();   // went down this frame
    this.released = new Set();
    this.move = { x: 0, y: 0 }; // -1..1
    this.look = { x: 0, y: 0 }; // per-frame delta (mouse px / stick units)
    this.usingPad = false;
    this._padPrev = new Set();
    this._holdT = new Map();
  }
  isDown(a) { return this.down.has(a); }
  justPressed(a) { return this.pressed.has(a); }
  justReleased(a) { return this.released.has(a); }
  /** Seconds an action has been held (0 if not held). */
  heldFor(a) { return this._holdT.get(a) || 0; }
  consume(a) { this.pressed.delete(a); }
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.players = [new PlayerInput(0), new PlayerInput(1)];
    this.p = this.players[0];
    this.locked = false;
    this.sensitivity = 1.0;
    this.padSensitivity = 1.0;
    this.invertY = false;
    this.deadzone = 0.16;
    this.enabled = true;
    this.padsConnected = 0;

    this._keys = new Set();
    this._mouse = new Set();
    // Edge buffers: a key tapped and released between two frames would
    // otherwise never appear as held, and the press would be lost.
    this._keyEdge = new Set();
    this._mouseEdge = new Set();
    this._mouseDelta = { x: 0, y: 0 };
    this._wheel = 0;

    this._bindDom();
  }

  _bindDom() {
    addEventListener('keydown', e => {
      // Never swallow devtools / reload shortcuts.
      if (e.metaKey || e.ctrlKey) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) this._keyEdge.add(e.code);
      this._keys.add(e.code);
      this.players[0].usingPad = false;
    });
    addEventListener('keyup', e => this._keys.delete(e.code));
    addEventListener('blur', () => { this._keys.clear(); this._mouse.clear(); });

    this.canvas.addEventListener('mousedown', e => { this._mouse.add(e.button); this._mouseEdge.add(e.button); });
    addEventListener('mouseup', e => this._mouse.delete(e.button));
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());

    addEventListener('mousemove', e => {
      if (!this.locked) return;
      this._mouseDelta.x += e.movementX || 0;
      this._mouseDelta.y += e.movementY || 0;
    });
    addEventListener('wheel', e => { this._wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      document.body.classList.toggle('playing', this.locked);
      this.onLockChange?.(this.locked);
    });

    addEventListener('gamepadconnected', e => {
      this.padsConnected++;
      this.onPad?.(true, e.gamepad);
    });
    addEventListener('gamepaddisconnected', () => {
      this.padsConnected = Math.max(0, this.padsConnected - 1);
      this.onPad?.(false);
    });
  }

  /** Pointer lock can only be taken during a user gesture. Asking outside
   *  one rejects, which is expected — the canvas click handler retries. */
  requestLock() {
    if (this.locked) return;
    try {
      const r = this.canvas.requestPointerLock?.();
      if (r?.catch) r.catch(() => { this.onLockDenied?.(); });
    } catch { this.onLockDenied?.(); }
  }
  releaseLock() { if (this.locked) document.exitPointerLock?.(); }

  _pads() { return navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; }

  _axis(pad, i) {
    const v = pad.axes[i] || 0;
    const d = this.deadzone;
    if (Math.abs(v) < d) return 0;
    // Rescale past the deadzone so the stick still reaches full range.
    return Math.sign(v) * (Math.abs(v) - d) / (1 - d);
  }

  /** Rumble — used for hits, blocks and the wind dash. */
  rumble(playerIndex, strong = .5, weak = .3, ms = 160) {
    const pad = this._pads()[this.players[playerIndex]?.padIndex ?? 0];
    const act = pad?.vibrationActuator;
    if (!act) return;
    try {
      act.playEffect('dual-rumble', {
        startDelay: 0, duration: ms,
        strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1)
      });
    } catch { /* actuator not supported — silently ignore */ }
  }

  update(dt) {
    const pads = this._pads();

    for (const p of this.players) {
      const prevDown = new Set(p.down);
      p.down.clear(); p.pressed.clear(); p.released.clear();
      p.move.x = p.move.y = 0;
      p.look.x = p.look.y = 0;

      if (!this.enabled) continue;

      /* ---- keyboard + mouse (player 0 only) ---- */
      if (p.keyboard) {
        for (const [action, b] of Object.entries(BINDINGS)) {
          const hitKey = b.keys?.some(k => this._keys.has(k));
          const hitMouse = b.mouse?.some(m => this._mouse.has(m));
          if (hitKey || hitMouse) p.down.add(action);
          // A tap that started and ended inside this frame still counts.
          else if (b.keys?.some(k => this._keyEdge.has(k)) ||
                   b.mouse?.some(m => this._mouseEdge.has(m))) p.pressed.add(action);
        }
        p.move.x = (this._keys.has('KeyD') ? 1 : 0) - (this._keys.has('KeyA') ? 1 : 0);
        p.move.y = (this._keys.has('KeyW') ? 1 : 0) - (this._keys.has('KeyS') ? 1 : 0);
        if (this.locked) {
          p.look.x += this._mouseDelta.x * .0022 * this.sensitivity;
          p.look.y += this._mouseDelta.y * .0022 * this.sensitivity * (this.invertY ? -1 : 1);
        }
      }

      /* ---- gamepad ---- */
      const pad = pads[p.padIndex];
      if (pad) {
        let any = false;
        for (const [action, b] of Object.entries(BINDINGS)) {
          if (!b.pad) continue;
          for (const i of b.pad) {
            const btn = pad.buttons[i];
            if (btn && (btn.pressed || btn.value > .35)) { p.down.add(action); any = true; }
          }
        }
        const lx = this._axis(pad, 0), ly = this._axis(pad, 1);
        const rx = this._axis(pad, 2), ry = this._axis(pad, 3);
        if (lx || ly) { p.move.x += lx; p.move.y += -ly; any = true; }
        if (rx || ry) {
          // Squared response curve: precise near centre, fast at the edge.
          const k = 2.6 * this.padSensitivity * dt * 60;
          p.look.x += rx * Math.abs(rx) * k * .045;
          p.look.y += ry * Math.abs(ry) * k * .045 * (this.invertY ? -1 : 1);
          any = true;
        }
        // Analogue triggers double as light/heavy attack intensity.
        p.triggerL = pad.buttons[PAD.L2]?.value || 0;
        p.triggerR = pad.buttons[PAD.R2]?.value || 0;
        if (any) { p.usingPad = true; if (p.keyboard) this.lastPadUse = performance.now(); }
      }

      // Normalise diagonal movement.
      const len = Math.hypot(p.move.x, p.move.y);
      if (len > 1) { p.move.x /= len; p.move.y /= len; }

      for (const a of p.down) if (!prevDown.has(a)) p.pressed.add(a);
      for (const a of prevDown) if (!p.down.has(a)) p.released.add(a);

      for (const a of p.down) p._holdT.set(a, (p._holdT.get(a) || 0) + dt);
      for (const a of p.released) p._holdT.set(a, 0);
    }

    this._mouseDelta.x = this._mouseDelta.y = 0;
    this.wheel = this._wheel; this._wheel = 0;
    this._keyEdge.clear(); this._mouseEdge.clear();
  }

  /* Convenience passthroughs for player 0 (menus, single player). */
  isDown(a) { return this.p.isDown(a); }
  justPressed(a) { return this.p.justPressed(a); }
  justReleased(a) { return this.p.justReleased(a); }
}

/** Menus poll with repeat so holding a stick scrolls a list. */
export class MenuNav {
  constructor(input) { this.input = input; this.t = 0; this.last = null; }
  poll(dt) {
    const p = this.input.p;
    const dir = p.isDown('menuDown') ? 'down' : p.isDown('menuUp') ? 'up'
              : p.isDown('menuRight') ? 'right' : p.isDown('menuLeft') ? 'left' : null;
    let out = null;
    if (dir !== this.last) { this.last = dir; this.t = 0; if (dir) out = dir; }
    else if (dir) { this.t += dt; if (this.t > .38) { this.t = .28; out = dir; } }
    return {
      dir: out,
      confirm: p.justPressed('confirm'),
      cancel: p.justPressed('cancel')
    };
  }
}
