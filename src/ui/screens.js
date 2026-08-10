/* Front-end screens: loading, main menu, class select, forge (colour edit),
 * settings and multiplayer. Every screen is keyboard, mouse and DualSense
 * navigable — the MenuNav helper unifies stick/d-pad/WASD/arrows. */

import { el, $, clamp, hsl2hex, hsl2rgb, wait } from '../core/util.js';
import { Audio } from '../core/audio.js';
import { Save } from '../core/save.js';
import { MenuNav } from '../core/input.js';
import { CLASSES, TIPS, WORLDS, classById } from '../data/gamedata.js';
import { loadingBG, menuBG, classBG, gearsSVG, clearIconCache } from '../art/art.js';

const HOST = () => document.getElementById('layer-screens');

export class Screens {
  constructor(input, game) {
    this.input = input;
    this.game = game;
    this.nav = new MenuNav(input);
    this.active = null;      // { root, update(dt), dispose() }
    this._raf = null;
    this._last = performance.now();
    this._loop();
  }

  _loop() {
    const now = performance.now();
    const dt = Math.min(.05, (now - this._last) / 1000);
    this._last = now;
    if (this.active?.update) {
      try { this.active.update(dt, this.nav.poll(dt)); }
      catch (e) { console.error('[screens]', e); }
    }
    this._raf = requestAnimationFrame(() => this._loop());
  }

  async _swap(node, ctrl) {
    if (this.active) {
      this.active.root.classList.remove('in');
      const old = this.active;
      setTimeout(() => { old.dispose?.(); old.root.remove(); }, 600);
    }
    HOST().appendChild(node);
    // Force a reflow so the opacity transition actually plays.
    void node.offsetHeight;
    node.classList.add('in');
    this.active = { root: node, ...ctrl };
    return this.active;
  }

  clear() {
    if (this.active) {
      this.active.root.classList.remove('in');
      const old = this.active;
      setTimeout(() => { old.dispose?.(); old.root.remove(); }, 600);
      this.active = null;
    }
  }

  /* ==========================================================
     LOADING
     ========================================================== */
  loading({ tip = TIPS[0], onDone } = {}) {
    const root = el('div', 'screen', `
      <div class="bg kenburns" style="background-image:${loadingBG()}"></div>
      <div class="vignette"></div>
      <div class="ring-wrap">
        <svg viewBox="0 0 74 74">
          <circle class="track" cx="37" cy="37" r="32"></circle>
          <circle class="fill" cx="37" cy="37" r="32"
                  stroke-dasharray="201.06" stroke-dashoffset="201.06"></circle>
        </svg>
        <div class="pct">0%</div>
      </div>
      <div class="press">PRESS ENTER OR ✕ TO CONTINUE</div>
      <div class="tipbar"><div class="tip">${tip}</div></div>
    `);
    root.id = 'loading';

    const fill = $('.fill', root), pct = $('.pct', root);
    const C = 2 * Math.PI * 32;
    let shown = 0, target = 0, done = false;

    const ctrl = {
      setProgress: v => { target = clamp(v, 0, 1); },
      update: (dt, nav) => {
        shown += (target - shown) * Math.min(1, dt * 4.5);
        fill.style.strokeDashoffset = C * (1 - shown);
        pct.textContent = Math.round(shown * 100) + '%';
        if (!done && shown > .995 && target >= 1) {
          done = true;
          root.classList.add('ready');
        }
        if (done && (nav.confirm || this.input.p.justPressed('interact'))) {
          Audio.sfx('uiConfirm');
          onDone?.();
        }
      }
    };
    // Clicking anywhere also continues — matters on touch/laptop.
    root.addEventListener('pointerdown', () => { if (done) { Audio.sfx('uiConfirm'); onDone?.(); } });

    this._swap(root, ctrl);
    return ctrl;
  }

  /* ==========================================================
     MAIN MENU
     ========================================================== */
  mainMenu({ onPlay, onEdit, onClass, onMultiplayer, onSettings }) {
    const d = Save.data;
    const tier = Math.max(1, d?.world || 1);
    const items = [
      { id: 'play', label: Save.hasSave() && d?.flags?.seenIntro ? 'CONTINUE' : 'PLAY', fn: onPlay },
      { id: 'edit', label: 'EDIT', fn: onEdit },
      { id: 'class', label: 'CLASS', fn: onClass },
      { id: 'multi', label: 'MULTIPLAYER', fn: onMultiplayer },
      { id: 'settings', label: 'SETTINGS', fn: onSettings }
    ];
    if (Save.hasSave() && d?.flags?.seenIntro) {
      items.splice(1, 0, { id: 'new', label: 'NEW GAME', fn: () => this._confirmNewGame(onPlay) });
    }

    const root = el('div', 'screen', `
      <div class="bg kenburns" style="background-image:${menuBG()}"></div>
      <div class="vignette"></div>
      <div class="gears">${gearsSVG()}</div>
      <div class="title">
        <div class="jp">追放者たち</div>
        <div class="en">The Forsaken One</div>
      </div>
      <div class="tabs"></div>
      <div class="tier">TIER ${tier}</div>
      <div class="hintbar">
        <span>↑↓ <b>SELECT</b></span><span><b>ENTER</b> CONFIRM</span><span><b>M</b> MUTE</span>
      </div>
    `);
    root.id = 'menu';

    const tabs = $('.tabs', root);
    let sel = 0;
    items.forEach((it, i) => {
      const t = el('div', 'tab', it.label);
      t.addEventListener('mouseenter', () => { if (sel !== i) { sel = i; render(); Audio.sfx('uiMove'); } });
      t.addEventListener('click', () => { sel = i; commit(); });
      tabs.appendChild(t);
      it.node = t;
    });

    const render = () => items.forEach((it, i) => it.node.classList.toggle('sel', i === sel));
    const commit = () => { Audio.sfx('uiConfirm'); items[sel].fn?.(); };
    render();

    // Slow gear rotation gives the static backdrop some life.
    const gears = $('.gears svg', root);
    let spin = 0;

    Audio.play('menu');

    const ctrl = {
      update: (dt, nav) => {
        spin += dt * 2.2;
        if (gears) gears.style.transform = `rotate(${spin}deg)`;
        if (nav.dir === 'up')   { sel = (sel - 1 + items.length) % items.length; render(); Audio.sfx('uiMove'); }
        if (nav.dir === 'down') { sel = (sel + 1) % items.length; render(); Audio.sfx('uiMove'); }
        if (nav.confirm) commit();
        if (this.input.p.justPressed('mute')) {
          const m = Audio.toggleMute();
          Save.settings.muted = m; Save.writeSettings();
          this.toast(m ? 'MUTED' : 'SOUND ON');
        }
      }
    };
    this._swap(root, ctrl);
    return ctrl;
  }

  _confirmNewGame(onPlay) {
    this.modal({
      title: 'Begin Again',
      body: 'A new game overwrites your current progress — level, rank, inventory, worlds and story. This cannot be undone.',
      actions: [
        { label: 'ERASE AND BEGIN', danger: true, fn: () => { Save.wipe(); Save.start(true); onPlay?.(true); } },
        { label: 'KEEP MY PROGRESS', ghost: true, fn: () => {} }
      ]
    });
  }

  /* ==========================================================
     CLASS SELECT
     ========================================================== */
  classSelect({ onBack, onPick, changeMode = false, cost = 0 } = {}) {
    const d = Save.data;
    const owned = new Set(d.unlockedClasses);
    const list = CLASSES.map(c => ({
      ...c,
      unlocked: owned.has(c.id) || (d.unlockedWorlds || []).includes(c.unlockWorld)
    }));

    const root = el('div', 'screen', `
      <div class="backbtn">BACK</div>
      <div class="arrow l">‹</div>
      <div class="arrow r">›</div>
      <div class="strip"></div>
    `);
    root.id = 'classes';

    const strip = $('.strip', root);
    const PER_PAGE = 5;
    let sel = Math.max(0, list.findIndex(c => c.id === d.classId));
    let page = Math.floor(sel / PER_PAGE);

    const statRow = (k, v) => {
      const pct = clamp((v - .6) / 1.1, .04, 1) * 100;
      return `<div class="statrow"><span class="k">${k}</span>
                <span class="bar"><i style="width:${pct}%"></i></span></div>`;
    };

    const build = () => {
      strip.innerHTML = '';
      const from = page * PER_PAGE;
      list.slice(from, from + PER_PAGE).forEach((c, j) => {
        const i = from + j;
        const p = el('div', 'cpanel' + (c.unlocked ? '' : ' locked'), `
          <div class="art" style="background-image:${classBG(c.art)}"></div>
          <div class="shade"></div>
          <div class="lore">${c.unlocked ? c.lore : 'Sealed'}</div>
          ${c.unlocked ? `<div class="stats">
              ${statRow('HEALTH', c.stats.health)}
              ${statRow('STAMINA', c.stats.stamina)}
              ${statRow('POWER', c.stats.power)}
              ${statRow('DAMAGE', c.stats.damage)}
              ${statRow('SPEED', c.stats.speed)}
              ${statRow('DEFENSE', c.stats.defense)}
            </div>` : `<div class="lock">UNLOCKS IN WORLD ${c.unlockWorld}<br>${WORLDS[c.unlockWorld - 1]?.name || ''}</div>`}
          <div class="name">${c.name}</div>
        `);
        p.addEventListener('mouseenter', () => { if (sel !== i) { sel = i; paint(); Audio.sfx('uiMove'); } });
        p.addEventListener('click', () => { sel = i; commit(); });
        strip.appendChild(p);
        c.node = p;
      });
      paint();
    };

    const paint = () => {
      const from = page * PER_PAGE;
      list.forEach((c, i) => c.node?.classList.toggle('sel', i === sel && i >= from && i < from + PER_PAGE));
      $('.arrow.l', root).style.display = page > 0 ? 'grid' : 'none';
      $('.arrow.r', root).style.display = (page + 1) * PER_PAGE < list.length ? 'grid' : 'none';
    };

    const move = dir => {
      const next = clamp(sel + dir, 0, list.length - 1);
      if (next === sel) return;
      sel = next;
      const np = Math.floor(sel / PER_PAGE);
      if (np !== page) { page = np; build(); } else paint();
      Audio.sfx('uiMove');
    };

    const commit = () => {
      const c = list[sel];
      if (!c.unlocked) { Audio.sfx('uiDeny'); this.toast(`SEALED — REACH WORLD ${c.unlockWorld}`); return; }
      if (changeMode && cost > 0) {
        if (d.shekels < cost) { Audio.sfx('uiDeny'); this.toast('NOT ENOUGH SHEKELS'); return; }
        d.shekels -= cost;
      }
      d.classId = c.id;
      if (!d.unlockedClasses.includes(c.id)) d.unlockedClasses.push(c.id);
      Save.write();
      Audio.sfx('uiConfirm');
      this.toast(`${c.name.toUpperCase()} — ${c.jp}`, true);
      onPick?.(c);
    };

    $('.backbtn', root).addEventListener('click', () => { Audio.sfx('uiBack'); onBack?.(); });
    $('.arrow.l', root).addEventListener('click', () => { page--; sel = clamp(sel, 0, list.length - 1); build(); Audio.sfx('uiMove'); });
    $('.arrow.r', root).addEventListener('click', () => { page++; sel = clamp(sel, page * PER_PAGE, list.length - 1); build(); Audio.sfx('uiMove'); });

    build();

    const ctrl = {
      update: (dt, nav) => {
        if (nav.dir === 'right') move(1);
        if (nav.dir === 'left') move(-1);
        if (nav.confirm) commit();
        if (nav.cancel) { Audio.sfx('uiBack'); onBack?.(); }
      }
    };
    this._swap(root, ctrl);
    return ctrl;
  }

  /* ==========================================================
     FORGE / EDIT — advanced HSV colour wheel
     ========================================================== */
  edit({ onBack, previewMount, firstRun = false } = {}) {
    const colors = Save.data.colors;
    let part = 'blade';

    const root = el('div', 'screen', `
      ${firstRun ? '' : '<div class="backbtn">BACK</div>'}
      <div class="wrap">
        <div class="preview"><canvas id="forgeCanvas"></canvas></div>
        <div class="side">
          <h2>${firstRun ? 'Before You Begin' : 'The Forge'}</h2>
          <div class="sub">${firstRun
            ? 'Choose your steel. These colours are applied to every weapon you will ever carry, across all ten worlds. You can come back and change them any time from the main menu.'
            : 'Your chosen colours are applied to every weapon you carry, now and in every world after.'}</div>

          <div class="seg">
            <button data-p="blade" class="on">BLADE / METAL</button>
            <button data-p="handle">HANDLE</button>
          </div>

          <div class="wheelbox">
            <canvas id="wheel" width="512" height="512"></canvas>
            <div id="wheelDot"></div>
          </div>

          <div class="slider">
            <label><span>LIGHTNESS</span><span class="lv">50%</span></label>
            <input id="lightness" type="range" min="2" max="98" value="50">
          </div>
          <div class="slider">
            <label><span>SATURATION</span><span class="sv">50%</span></label>
            <input id="saturation" type="range" min="0" max="100" value="50">
          </div>

          <div class="hexline"><span class="chip"></span><span class="hex">#000000</span></div>

          <div class="panel-h" style="font-size:14px">PRESETS</div>
          <div class="swatches"></div>

          <button class="btn" id="applyBtn">${firstRun ? 'BEGIN' : 'SAVE AND RETURN'}</button>
          <button class="btn ghost" id="resetBtn">RESET TO DEFAULT</button>
        </div>
      </div>
    `);
    root.id = 'edit';

    const wheel = $('#wheel', root), wctx = wheel.getContext('2d');
    const dot = $('#wheelDot', root);
    const lSlider = $('#lightness', root), sSlider = $('#saturation', root);
    const lv = $('.lv', root), sv = $('.sv', root);
    const chip = $('.chip', root), hexTxt = $('.hex', root);

    /* --- paint the hue/saturation wheel at the current lightness --- */
    const R = 256;
    const paintWheel = () => {
      const L = colors[part].l;
      const img = wctx.createImageData(512, 512);
      const dta = img.data;
      for (let y = 0; y < 512; y++) {
        for (let x = 0; x < 512; x++) {
          const dx = x - R, dy = y - R;
          const r = Math.hypot(dx, dy);
          const i = (y * 512 + x) * 4;
          if (r > R) { dta[i + 3] = 0; continue; }
          const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
          const s = clamp(r / R, 0, 1);
          const [rr, gg, bb] = hsl2rgb(h, s, L);
          dta[i] = rr * 255; dta[i + 1] = gg * 255; dta[i + 2] = bb * 255;
          // Feather the rim so the circle is not aliased.
          dta[i + 3] = 255 * clamp((R - r) / 1.6, 0, 1);
        }
      }
      wctx.putImageData(img, 0, 0);
    };

    const placeDot = () => {
      const c = colors[part];
      const a = c.h * Math.PI / 180;
      const rr = c.s * 50;
      dot.style.left = (50 + Math.cos(a) * rr) + '%';
      dot.style.top = (50 + Math.sin(a) * rr) + '%';
      dot.style.background = hsl2hex(c.h, c.s, c.l);
    };

    const syncUI = () => {
      const c = colors[part];
      lSlider.value = Math.round(c.l * 100);
      sSlider.value = Math.round(c.s * 100);
      lv.textContent = Math.round(c.l * 100) + '%';
      sv.textContent = Math.round(c.s * 100) + '%';
      const hex = hsl2hex(c.h, c.s, c.l);
      chip.style.background = hex;
      hexTxt.textContent = hex.toUpperCase();
      // Tint the slider tracks so they preview the axis they control.
      lSlider.style.background = `linear-gradient(90deg,${hsl2hex(c.h, c.s, .02)},${hsl2hex(c.h, c.s, .5)},${hsl2hex(c.h, c.s, .98)})`;
      sSlider.style.background = `linear-gradient(90deg,${hsl2hex(c.h, 0, c.l)},${hsl2hex(c.h, 1, c.l)})`;
      placeDot();
      preview?.setColors(colors);
      clearIconCache();
    };

    /* --- wheel interaction (pointer drag) --- */
    let dragging = false;
    const pick = e => {
      const r = wheel.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * 512 - R;
      const y = (e.clientY - r.top) / r.height * 512 - R;
      const dist = Math.hypot(x, y);
      const c = colors[part];
      c.h = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      c.s = clamp(dist / R, 0, 1);
      syncUI();
    };
    wheel.addEventListener('pointerdown', e => { dragging = true; wheel.setPointerCapture(e.pointerId); pick(e); });
    wheel.addEventListener('pointermove', e => { if (dragging) pick(e); });
    wheel.addEventListener('pointerup', () => { dragging = false; Audio.sfx('uiMove', { volume: .5 }); });

    lSlider.addEventListener('input', () => { colors[part].l = lSlider.value / 100; paintWheel(); syncUI(); });
    sSlider.addEventListener('input', () => { colors[part].s = sSlider.value / 100; syncUI(); });

    /* --- part tabs --- */
    root.querySelectorAll('.seg button').forEach(b => {
      b.addEventListener('click', () => {
        root.querySelectorAll('.seg button').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        part = b.dataset.p;
        paintWheel(); syncUI();
        Audio.sfx('uiMove');
      });
    });

    /* --- presets --- */
    const PRESETS = [
      { h: 205, s: .10, l: .78, n: 'Folded Steel' }, { h: 0, s: 0, l: .96, n: 'Silver' },
      { h: 45, s: .78, l: .55, n: 'Gold' },          { h: 20, s: .62, l: .38, n: 'Bronze' },
      { h: 0, s: .78, l: .42, n: 'Blood' },          { h: 275, s: .70, l: .52, n: 'Amethyst' },
      { h: 205, s: .85, l: .55, n: 'Azure' },        { h: 150, s: .70, l: .45, n: 'Jade' },
      { h: 28, s: .95, l: .55, n: 'Ember' },         { h: 0, s: 0, l: .08, n: 'Obsidian' },
      { h: 185, s: .95, l: .70, n: 'Spirit' },       { h: 320, s: .80, l: .62, n: 'Orchid' }
    ];
    const sw = $('.swatches', root);
    PRESETS.forEach(p => {
      const s = el('div', 'swatch');
      s.style.background = hsl2hex(p.h, p.s, p.l);
      s.title = p.n;
      s.addEventListener('click', () => {
        Object.assign(colors[part], { h: p.h, s: p.s, l: p.l });
        paintWheel(); syncUI(); Audio.sfx('uiMove');
      });
      sw.appendChild(s);
    });

    /* --- live 3D weapon preview --- */
    let preview = null;
    previewMount?.($('#forgeCanvas', root)).then(p => { preview = p; preview.setColors(colors); });

    const finish = () => {
      Save.write(true);
      clearIconCache();
      Audio.sfx('uiConfirm');
      onBack?.();
    };
    $('#applyBtn', root).addEventListener('click', finish);
    $('.backbtn', root)?.addEventListener('click', () => { Audio.sfx('uiBack'); Save.write(true); onBack?.(); });
    $('#resetBtn', root).addEventListener('click', () => {
      colors.blade = { h: 205, s: .10, l: .78 };
      colors.handle = { h: 18, s: .55, l: .22 };
      paintWheel(); syncUI(); Audio.sfx('uiBack');
    });

    paintWheel(); syncUI();

    const ctrl = {
      update: (dt, nav) => {
        // Gamepad: right stick nudges hue/saturation, d-pad changes lightness.
        const p = this.input.p;
        if (p.look.x || p.look.y) {
          const c = colors[part];
          c.h = (c.h + p.look.x * 60 + 360) % 360;
          c.s = clamp(c.s - p.look.y * .6, 0, 1);
          syncUI();
        }
        if (nav.dir === 'up')   { colors[part].l = clamp(colors[part].l + .04, .02, .98); paintWheel(); syncUI(); }
        if (nav.dir === 'down') { colors[part].l = clamp(colors[part].l - .04, .02, .98); paintWheel(); syncUI(); }
        if (p.justPressed('nextSlot')) {
          part = part === 'blade' ? 'handle' : 'blade';
          root.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x.dataset.p === part));
          paintWheel(); syncUI(); Audio.sfx('uiMove');
        }
        if (nav.confirm) finish();
        if (nav.cancel) { Audio.sfx('uiBack'); Save.write(true); onBack?.(); }
        preview?.update(dt);
      },
      dispose: () => preview?.dispose()
    };
    this._swap(root, ctrl);
    return ctrl;
  }

  /* ==========================================================
     MULTIPLAYER
     ========================================================== */
  multiplayer({ onBack, onVersus, onCoop }) {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean).length : 0;
    const root = el('div', 'screen', `
      <div class="bg kenburns" style="background-image:${menuBG()}"></div>
      <div class="vignette"></div>
      <div class="backbtn">BACK</div>
      <div class="panel">
        <h2 class="panel-h" style="font-size:26px;margin-bottom:4px">Two Players</h2>
        <div style="opacity:.55;font-size:13.5px;margin-bottom:26px;letter-spacing:.04em">
          Horizontal split screen. Player one uses keyboard and mouse or pad 1;
          player two uses pad 2. ${pads} controller${pads === 1 ? '' : 's'} detected.
        </div>

        <div class="mpick" data-m="versus">
          <div class="row" style="border:0;padding:0">
            <div>
              <div class="lbl" style="font-size:16px">VERSUS</div>
              <div class="hint" style="margin-top:6px;max-width:420px">
                A duel in a closed arena using the full combat system — blocking,
                launches and Wind Dash. First to five falls wins.
              </div>
            </div>
          </div>
        </div>

        <div class="mpick" data-m="coop" style="margin-top:8px">
          <div class="row" style="border:0;padding:0">
            <div>
              <div class="lbl" style="font-size:16px">CO-OP CAMPAIGN</div>
              <div class="hint" style="margin-top:6px;max-width:420px">
                The whole journey, worlds one through ten, with a second player.
                Progress saves to your file.
              </div>
            </div>
          </div>
        </div>

        <button class="btn" id="mpGo">BEGIN</button>
        <button class="btn ghost" id="mpBack">BACK</button>
      </div>
    `);
    root.id = 'multi';

    // Style the two selectable cards.
    root.querySelectorAll('.mpick').forEach(n => {
      n.style.cssText += 'padding:18px 20px;border:1px solid rgba(255,255,255,.12);cursor:pointer;transition:.18s';
    });

    let mode = 'versus';
    const paint = () => root.querySelectorAll('.mpick').forEach(n => {
      const on = n.dataset.m === mode;
      n.style.borderColor = on ? 'rgba(240,162,74,.75)' : 'rgba(255,255,255,.12)';
      n.style.background = on ? 'rgba(240,162,74,.12)' : 'transparent';
    });
    root.querySelectorAll('.mpick').forEach(n => n.addEventListener('click', () => {
      mode = n.dataset.m; paint(); Audio.sfx('uiMove');
    }));
    paint();

    const go = () => {
      Audio.sfx('uiConfirm');
      if (mode === 'versus') onVersus?.(); else onCoop?.();
    };
    $('#mpGo', root).addEventListener('click', go);
    $('#mpBack', root).addEventListener('click', () => { Audio.sfx('uiBack'); onBack?.(); });
    $('.backbtn', root).addEventListener('click', () => { Audio.sfx('uiBack'); onBack?.(); });

    const ctrl = {
      update: (dt, nav) => {
        if (nav.dir === 'up' || nav.dir === 'down') {
          mode = mode === 'versus' ? 'coop' : 'versus'; paint(); Audio.sfx('uiMove');
        }
        if (nav.confirm) go();
        if (nav.cancel) { Audio.sfx('uiBack'); onBack?.(); }
      }
    };
    this._swap(root, ctrl);
    return ctrl;
  }

  /* ==========================================================
     SETTINGS
     ========================================================== */
  settings({ onBack, onApply }) {
    const s = Save.settings;
    const root = el('div', 'screen', `
      <div class="bg kenburns" style="background-image:${menuBG()}"></div>
      <div class="vignette"></div>
      <div class="backbtn">BACK</div>
      <div class="panel">
        <h2 class="panel-h" style="font-size:26px">Settings</h2>
        <div id="rows"></div>
        <button class="btn" id="setBack">DONE</button>
        <button class="btn ghost" id="wipeBtn">ERASE SAVE DATA</button>
      </div>
    `);
    root.id = 'settings';

    const rows = $('#rows', root);
    const addRow = (label, hint, control) => {
      const r = el('div', 'row', `<div><div class="lbl">${label}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`);
      r.appendChild(control);
      rows.appendChild(r);
      return r;
    };
    const range = (key, min, max, step, fmt, apply) => {
      const wrap = el('div', '', '');
      wrap.style.cssText = 'display:flex;align-items:center;gap:12px';
      const i = el('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = s[key];
      const v = el('span', 'hint', fmt(s[key]));
      v.style.minWidth = '52px';
      i.addEventListener('input', () => {
        s[key] = parseFloat(i.value); v.textContent = fmt(s[key]);
        apply?.(); Save.writeSettings(); onApply?.(s);
      });
      wrap.append(i, v); return wrap;
    };
    const toggle = (key, apply) => {
      const t = el('div', 'toggle' + (s[key] ? ' on' : ''), '<i></i>');
      t.addEventListener('click', () => {
        s[key] = !s[key]; t.classList.toggle('on', s[key]);
        Audio.sfx('uiMove'); apply?.(); Save.writeSettings(); onApply?.(s);
      });
      return t;
    };
    const select = (key, opts, apply) => {
      const sel = el('select');
      opts.forEach(([v, l]) => { const o = el('option', '', l); o.value = v; sel.appendChild(o); });
      sel.value = s[key];
      sel.addEventListener('change', () => { s[key] = sel.value; apply?.(); Save.writeSettings(); onApply?.(s); });
      return sel;
    };

    const pct = v => Math.round(v * 100) + '%';
    addRow('MASTER VOLUME', null, range('masterVolume', 0, 1, .01, pct, () => Audio.setVolumes(volObj())));
    addRow('MUSIC', null, range('musicVolume', 0, 1, .01, pct, () => Audio.setVolumes(volObj())));
    addRow('EFFECTS', null, range('sfxVolume', 0, 1, .01, pct, () => { Audio.setVolumes(volObj()); Audio.sfx('uiMove'); }));
    addRow('MUTE ALL', 'Also toggled with M', toggle('muted', () => Audio.setVolumes(volObj())));
    addRow('MOUSE SENSITIVITY', null, range('sensitivity', .2, 3, .05, v => v.toFixed(2) + 'x'));
    addRow('CONTROLLER SENSITIVITY', 'Right stick look speed', range('padSensitivity', .2, 3, .05, v => v.toFixed(2) + 'x'));
    addRow('INVERT Y AXIS', null, toggle('invertY'));
    addRow('CONTROLLER RUMBLE', 'DualSense haptics', toggle('rumble'));
    addRow('FIELD OF VIEW', null, range('fov', 60, 110, 1, v => Math.round(v) + '°'));
    addRow('RENDER SCALE', 'Lower this if the frame rate dips', range('renderScale', .5, 1, .05, pct));
    addRow('QUALITY', 'Shadows, grass and draw distance', select('quality', [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['ultra', 'ULTRA']]));
    addRow('VIEW DISTANCE', null, range('viewDistance', .5, 2, .1, v => v.toFixed(1) + 'x'));
    addRow('SHADOWS', null, toggle('shadows'));
    addRow('SUBTITLES', null, toggle('subtitles'));

    const volObj = () => ({
      master: s.masterVolume, music: s.musicVolume, sfx: s.sfxVolume, muted: s.muted
    });

    $('#setBack', root).addEventListener('click', () => { Audio.sfx('uiBack'); onBack?.(); });
    $('.backbtn', root).addEventListener('click', () => { Audio.sfx('uiBack'); onBack?.(); });
    $('#wipeBtn', root).addEventListener('click', () => {
      this.modal({
        title: 'Erase Everything',
        body: 'This permanently deletes your save: level, rank, worlds, inventory and story progress. There is no way back.',
        actions: [
          { label: 'ERASE', danger: true, fn: () => { Save.wipe(); location.reload(); } },
          { label: 'CANCEL', ghost: true, fn: () => {} }
        ]
      });
    });

    const ctrl = { update: (dt, nav) => { if (nav.cancel) { Audio.sfx('uiBack'); onBack?.(); } } };
    this._swap(root, ctrl);
    return ctrl;
  }

  /* ==========================================================
     Shared bits: toast + modal
     ========================================================== */
  toast(text, big = false) {
    let host = document.getElementById('toasts');
    if (!host) {
      host = el('div'); host.id = 'toasts';
      document.getElementById('layer-game').appendChild(host);
    }
    const t = el('div', 'toast' + (big ? ' big' : ''), text);
    host.appendChild(t);
    setTimeout(() => t.remove(), 3600);
  }

  modal({ title, body, actions = [] }) {
    const host = document.getElementById('layer-modal');
    const wrap = el('div', 'screen in');
    wrap.style.background = 'rgba(0,0,0,.62)';
    wrap.style.backdropFilter = 'blur(5px)';
    const p = el('div', 'panel', `
      <h2 class="panel-h" style="font-size:22px">${title}</h2>
      <div style="font-size:15px;line-height:1.55;opacity:.82;margin:14px 0 26px">${body}</div>
    `);
    actions.forEach(a => {
      const b = el('button', 'btn' + (a.ghost ? ' ghost' : ''), a.label);
      if (a.danger) { b.style.borderColor = 'rgba(200,48,44,.7)'; b.style.color = '#e05752'; }
      b.addEventListener('click', () => { Audio.sfx(a.danger ? 'uiDeny' : 'uiConfirm'); wrap.remove(); a.fn?.(); });
      p.appendChild(b);
    });
    wrap.appendChild(p);
    host.appendChild(wrap);
    return wrap;
  }
}
