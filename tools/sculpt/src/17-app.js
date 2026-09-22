/*
 * SculptFree — the application.
 *
 * Owns the scene, the camera, the renderer, the stroke engine and the whole
 * interface. Split into three parts in this file: state and setup, the
 * interface, then input and commands.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var UI = S.UI;
  var el = UI.el;
  var V3 = S.V3, M4 = S.M4, Q4 = S.Q4;

  /*
   * The ceilings for the two sliders. Kept low on purpose: a brush wider
   * than a fifth of the screen averages over so much surface that a stroke
   * drags the whole form around, and strength above 1 moves the surface
   * further than the brush is wide in a single stamp — both of which end in
   * a mess rather than a model.
   */
  var MAX_RADIUS = 95;
  var MAX_STRENGTH = 1;

  var STORAGE_KEY = 'sculptfree.settings.v1';
  var DB_NAME = 'sculptfree';
  var DB_STORE = 'projects';

  var DEFAULTS = {
    // brush
    brush: 'add',
    radius: 62,
    strength: 0.55,
    falloff: 'smooth',
    spacing: 0.16,
    strokeSmoothing: 0.3,
    autoSmooth: 0.28,
    clayOffset: 0.18,
    frontFacing: true,
    pressureRadius: true,
    pressureStrength: true,
    paintColorHex: '#d94f3d',
    /*
     * Stencils. A brush with a stencil stops being a round dab and becomes a
     * stamp of whatever the image shows, which is how dirt, gravel, cracks
     * and rivets get onto a model without sculpting each one by hand.
     */
    alpha: 'none',
    stampMode: false,
    alphaFollowStroke: true,
    alphaRandomRotate: false,
    /*
     * How a stencil is read. 'surface' takes the pattern from the model, so
     * scrubbing over a place builds the same pattern up instead of smearing
     * a fresh copy of it each dab; 'stamp' prints one copy per dab, which is
     * what a rivet or a panel wants. Surface is the default because that is
     * what people reach for a dirt or gravel brush expecting.
     */
    alphaMode: 'surface',
    alphaScale: 1,
    /*
     * Where paint goes. Into the object's own image, because colour in the
     * vertices can only ever be as fine as the mesh — on a model built for a
     * game, nowhere near fine enough to show a pattern. 'vertex' keeps the
     * old behaviour for anyone exporting vertex colours in a PLY.
     */
    paintTarget: 'texture',
    paintSize: 1024,
    /*
     * Topology.
     *
     * Dynamic topology is ON, and that is the whole feel of the tool: a
     * brush adds material and the new volume gets its own triangles as it
     * grows. With it off, a stroke can only push the triangles the mesh
     * already has, so a ball turns into a stretched ball instead of a ball
     * with a horn on it.
     *
     * Two separate numbers, which is easy to mix up:
     *   maxTriangles  the ceiling while sculpting. Headroom, not a target —
     *                 150,000 leaves room for any prop and keeps a stroke
     *                 responsive on a phone, where a mesh in the high
     *                 hundreds of thousands starts to drag.
     *   triBudget     what the model is EXPORTED at. Roblox refuses a
     *                 MeshPart over 10,000 triangles and a real prop is
     *                 usually 1k-4k, so the default is 2,000 and Export
     *                 reduces a copy to it. The sculpt keeps its detail.
     */
    dyntopo: true,
    /*
     * Detail is measured in screen pixels: triangles under the brush are
     * kept about this big on screen. Measuring it as a fraction of the brush
     * instead (the old 'relative' mode, still available) means a small brush
     * asks for microscopic triangles, which is how a single tap could ask
     * for a hundred thousand of them and leave a spike behind.
     */
    detailMode: 'pixels',
    detailPixels: 12,
    detailPercent: 20,
    detailSize: 0.01,
    maxTriangles: 150000,
    triBudget: 2000,
    remeshResolution: 160,
    remeshSmooth: 2,
    decimateTarget: 30000,
    // symmetry
    symmetryX: true,
    symmetryY: false,
    symmetryZ: false,
    // view
    matcap: 'clay',
    flat: false,
    wireframe: false,
    vertexColors: true,
    cavity: 0.4,
    grid: false,
    showSymmetry: false,
    maskVis: 1,
    bgTop: '#232936',
    bgBottom: '#0e1116',
    vignette: 0.35,
    renderScale: 1,
    ortho: false,
    fov: 42,
    // combine
    booleanMode: 'union',
    booleanResolution: 160,
    booleanSmooth: 1,
    booleanKeep: false,
    booleanReduce: true,
    booleanTarget: -1,
    // export
    exportFormat: 'obj',
    exportScale: 1,
    exportAxis: 'y',
    exportColors: true,
    exportNormals: true,
    exportAscii: false,
    exportSelectedOnly: false,
    textureSize: 1024,
    textureCavity: 0.45,
    // transform
    gizmoMode: 'move',
    gizmoSnap: false,
    // misc
    historyBudgetMB: 384,
    autosave: true,
    navigateMode: false
  };

  function App(mount) {
    this.mount = mount || document.body;
    this.settings = this.loadSettings();
    /*
     * Uploaded stencils and saved presets live in the same store as the
     * settings, so a phone that gets closed and reopened still has the dirt
     * texture and the brush setups that were dialled in.
     */
    this.userPresets = [];
    try {
      if (root.localStorage) {
        S.Alpha.loadAll(root.localStorage);
        this.userPresets = S.Presets.load(root.localStorage);
      }
    } catch (e) { /* private browsing: built-ins only */ }
    if (this.settings.alpha && this.settings.alpha !== 'none' && !S.alphaById(this.settings.alpha)) {
      this.settings.alpha = 'none';
    }
    this.scene = new S.Scene();
    this.history = new S.History(this.settings.historyBudgetMB * 1024 * 1024);
    this.camera = new S.Camera();
    this.needsRender = true;
    this.frameTimes = [];
    this.fps = 0;
    this.lastFrame = performance.now();
    this.cursor = { valid: false, point: V3.create(0, 0, 0), normal: V3.create(0, 1, 0), radius: 0.1, inner: 0.5 };
    this.pointers = new Map();
    this.navigating = null;
    this.spaceDown = false;
    this.dirtySinceSave = false;
    this.lastAutosave = 0;
    this.panelRefs = {};
    this.statusTip = '';
    /*
     * Transform mode: the gizmo, its current handle drag, and the shape
     * waiting to be joined into the sculpt (if one was just added).
     */
    this.transform = { active: false, mode: 'move', drag: null, layout: null, pending: null, snap: false };

    this.buildDom();
    this.initGL();
    this.bindInput();
    this.newScene('sphere', null, true);
    this.restoreAutosaveOffer();
    this.loop();
  }
  S.App = App;
  var A = App.prototype;

  /* ================================================================ *
   * settings
   * ================================================================ */

  /*
   * Settings the tool remembers, with one migration.
   *
   * Version 2 is the release where the brushes started adding material. A
   * settings blob written before that carries the old topology defaults —
   * dynamic topology off, a 2,000-triangle ceiling — and restoring them
   * would hand a returning user the very behaviour that was fixed. So those
   * keys are dropped on the way in, once, and everything else is kept.
   */
  var SETTINGS_SCHEMA = 4;
  var STALE_ON_UPGRADE = ['dyntopo', 'maxTriangles', 'detailPercent', 'detailMode', 'detailSize',
                          'detailPixels', 'paintTarget', 'alphaMode'];

  A.loadSettings = function () {
    var out = {};
    for (var k in DEFAULTS) out[k] = DEFAULTS[k];
    try {
      var raw = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        var upgrading = (saved.schema || 0) < SETTINGS_SCHEMA;
        for (var key in saved) {
          if (!(key in DEFAULTS)) continue;
          if (upgrading && STALE_ON_UPGRADE.indexOf(key) >= 0) continue;
          out[key] = saved[key];
        }
        // the old default brush was Clay; move that one over to Add, but
        // leave any other choice alone
        if (upgrading && saved.brush === 'clay') out.brush = DEFAULTS.brush;
      }
    } catch (e) { /* private mode, or corrupt: defaults are fine */ }
    out.radius = S.clamp(out.radius, 8, MAX_RADIUS);
    out.strength = S.clamp(out.strength, 0, MAX_STRENGTH);
    out.paintColor = new Float32Array(UI.hexToRgb(out.paintColorHex));
    return out;
  };

  A.saveSettings = function () {
    try {
      var copy = { schema: SETTINGS_SCHEMA };
      for (var k in DEFAULTS) copy[k] = this.settings[k];
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
    } catch (e) { /* ignore */ }
  };

  A.set = function (key, value, opts) {
    // the two ceilings are enforced here rather than in every caller, so a
    // preset, a project or a settings file from an older build cannot bring
    // an unusable brush back
    if (key === 'radius') value = S.clamp(value, 8, MAX_RADIUS);
    if (key === 'strength') value = S.clamp(value, 0, MAX_STRENGTH);
    if (key === 'detailPixels') value = S.clamp(value, 4, 40);
    this.settings[key] = value;
    if (key === 'paintColorHex') this.settings.paintColor = new Float32Array(UI.hexToRgb(value));
    if (key === 'historyBudgetMB') this.history.budget = value * 1024 * 1024;
    if (key === 'ortho' || key === 'fov') {
      this.camera.ortho = !!this.settings.ortho;
      this.camera.fov = this.settings.fov * Math.PI / 180;
      this.camera.update();
    }
    if (key === 'matcap') this.renderer.setMatcap(value);
    if (key === 'renderScale') this.resize();
    this.needsRender = true;
    if (!opts || opts.persist !== false) this.saveSettings();
  };

  /* ================================================================ *
   * DOM skeleton
   * ================================================================ */

  /* ================================================================ *
   * the screen
   *
   * Deliberately almost empty: the model, a strip of brush icons, two
   * sliders, and one menu button. Everything else lives in sheets that open
   * only when asked for, so nothing competes with the sculpt for attention.
   * ================================================================ */

  /** The brushes that get a permanent button. The rest live under "More". */
  var PRIMARY_BRUSHES = ['add', 'clay', 'draw', 'trimdynamic', 'trimnormal',
                        'smooth', 'crease', 'move', 'inflate', 'paint'];

  A.buildDom = function () {
    var self = this;

    this.canvas = el('canvas#view');
    this.radiusPreview = el('div#radius-preview');
    this.hudEl = el('div#stats');

    /* top row: menu, what you are sculpting, undo/redo */
    this.menuBtn = el('button.round.big', { title: 'Menu', onclick: function (e) {
      e.stopPropagation();
      self.openMainMenu();
    } }, UI.icon('menu'));
    this.titleChip = el('button#title-chip', {
      title: 'Triangle budget',
      onclick: function () { self.dialogDecimate(); }
    });
    this.shapeBtn = el('button.round', { title: 'Add a shape to the sculpt', onclick: function (e) {
      e.stopPropagation();
      self.dialogPrimitive();
    } }, UI.icon('plus'));
    this.undoBtn = el('button.round', { title: 'Undo (Ctrl+Z)', onclick: function () { self.undo(); } }, UI.icon('undo'));
    this.redoBtn = el('button.round', { title: 'Redo (Ctrl+Shift+Z)', onclick: function () { self.redo(); } }, UI.icon('redo'));
    var topBar = el('div#bar-top', null, [
      this.menuBtn, this.shapeBtn, this.titleChip, el('div.spring'), this.undoBtn, this.redoBtn
    ]);

    /* left column: brushes */
    this.toolsEl = el('div#brushes');
    this.buildBrushStrip();

    /* right column: the three things worth a permanent switch */
    this.symBtn = el('button.round', { title: 'Mirror (X)', onclick: function () { self.toggle('symmetryX'); } },
      UI.icon('symmetry'));
    this.frameBtn = el('button.round', { title: 'Frame the model (F)', onclick: function () { self.frameSelection(); } },
      UI.icon('frame'));
    this.lookBtn = el('button.round', { title: 'Look', onclick: function (e) { e.stopPropagation(); self.openLookSheet(); } },
      UI.icon('palette'));
    this.moveBtn = el('button.round', { title: 'Move, turn and resize the shape (V)', onclick: function (e) {
      e.stopPropagation();
      self.setTransformMode(!self.transform.active);
    } }, UI.icon('gizmo'));
    var rightBar = el('div#bar-right', null, [this.moveBtn, this.symBtn, this.frameBtn, this.lookBtn]);

    /* bottom: size and strength, the only two numbers that matter */
    this.sizePill = this.makePill('radius', 'Size', 8, MAX_RADIUS, 1, this.settings.radius, function (v) {
      self.set('radius', v);
      self.refreshStatus();
    }, function (v) { return Math.round(v); });
    this.strengthPill = this.makePill('strength', 'Strength', 0, MAX_STRENGTH, 0.01, this.settings.strength, function (v) {
      self.set('strength', v);
      self.refreshStatus();
    }, function (v) { return Number(v).toFixed(2); });
    var bottomBar = el('div#bar-bottom', null, [this.sizePill, this.strengthPill]);
    this.bottomBar = bottomBar;

    /*
     * The transform strip takes the place of the two sliders while the gizmo
     * is up: in transform mode brush size and strength are not what you are
     * adjusting, and a phone has no room for both.
     */
    this.transformBar = this.buildTransformBar();

    this.sheetHost = el('div#sheets');
    this.panelEl = this.sheetHost;        // Escape closes whatever is open

    /* the gizmo is an SVG overlay: crisp at any zoom, and easy to hit-test */
    this.gizmoEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.gizmoEl.setAttribute('id', 'gizmo');
    this.gizmoEl.setAttribute('hidden', 'hidden');

    var ui = el('div#ui', null, [topBar, this.toolsEl, rightBar, bottomBar, this.transformBar, this.hudEl]);

    UI.append(this.mount, [
      el('div#app', null, [this.canvas, this.gizmoEl, this.radiusPreview, ui]),
      this.sheetHost,
      el('div#toasts'),
      el('div#busy', { hidden: true }, el('div.card', null, [
        el('div.spin'), el('div.what', { text: 'Working' }), el('div.detail')
      ])),
      el('div#drop-hint', { hidden: true }, el('div', { text: 'Drop a model to open it' }))
    ]);

    document.addEventListener('pointerdown', function (e) {
      if (!e.target.closest('#sheets') && !e.target.closest('#ui')) self.closeSheet();
    });

    this.panelRefs.radius = this.sizePill;
    this.panelRefs.strength = this.strengthPill;
  };

  /** A slider that lives directly on the canvas: icon, track, value. */
  A.makePill = function (iconName, label, min, max, step, value, onchange, format) {
    var range = el('input', { type: 'range', min: min, max: max, step: step, value: value });
    var out = el('span.val', { text: format(value) });
    range.addEventListener('input', function () {
      out.textContent = format(range.value);
      onchange(Number(range.value));
    });
    var pill = el('div.pill', { title: label }, [UI.icon(iconName), range, out]);
    pill.set = function (v) { range.value = v; out.textContent = format(v); };
    pill.get = function () { return Number(range.value); };
    return pill;
  };

  A.buildBrushStrip = function () {
    var self = this;
    UI.clear(this.toolsEl);
    this.toolButtons = {};
    PRIMARY_BRUSHES.forEach(function (id) {
      var b = S.brushById(id);
      var btn = el('button.tool', { title: b.label + ' (' + b.key + ')\n' + b.hint,
        onclick: function () { self.selectBrush(id); } }, UI.icon(id));
      self.toolButtons[id] = btn;
      self.toolsEl.appendChild(btn);
    });
    this.moreBrushBtn = el('button.tool.more', { title: 'More brushes',
      onclick: function (e) { e.stopPropagation(); self.openBrushSheet(); } }, UI.icon('menu'));
    this.toolsEl.appendChild(this.moreBrushBtn);
  };

  A.selectBrush = function (id) {
    this.set('brush', id);
    var known = false;
    for (var k in this.toolButtons) {
      var on = k === id;
      this.toolButtons[k].classList.toggle('on', on);
      if (on) known = true;
    }
    // a brush from the overflow sheet takes over the More button
    if (this.moreBrushBtn) {
      this.moreBrushBtn.classList.toggle('on', !known);
      UI.clear(this.moreBrushBtn);
      this.moreBrushBtn.appendChild(UI.icon(known ? 'menu' : id));
    }
    var b = S.brushById(id);
    this.statusTip = b.hint;
    this.refreshStatus();
    this.closeSheet();
    this.needsRender = true;
  };

  A.syncViewButtons = function () {
    if (this.symBtn) {
      var any = this.settings.symmetryX || this.settings.symmetryY || this.settings.symmetryZ;
      this.symBtn.classList.toggle('on', !!any);
      var axes = (this.settings.symmetryX ? 'X' : '') + (this.settings.symmetryY ? 'Y' : '') + (this.settings.symmetryZ ? 'Z' : '');
      this.symBtn.title = 'Mirror ' + (axes || 'off') + ' (X, Y, Z)';
    }
  };

  A.refreshStatus = function () {
    var obj = this.scene.current();
    if (this.titleChip) {
      /*
       * What the sculpt costs now, and what it will be exported at. Sculpting
       * past the export budget is normal and expected — Export reduces a
       * copy — so the chip only turns red at the dynamic-topology ceiling,
       * which is the number that actually stops the brushes adding.
       */
      var budget = this.settings.triBudget;
      var cap = this.settings.maxTriangles;
      var tris = obj ? obj.mesh.liveTris : 0;
      this.titleChip.textContent = S.formatCount(tris) +
        (budget && tris > budget ? ' \u2192 ' + S.formatCount(budget) : ' / ' + S.formatCount(budget));
      this.titleChip.classList.toggle('over', this.settings.dyntopo && tris >= cap - 8);
      this.titleChip.classList.toggle('near', this.settings.dyntopo && tris > cap * 0.85 && tris < cap - 8);
      this.titleChip.title = obj
        ? (obj.name + ' \u2014 ' + tris + ' triangles now, exports reduced to ' + budget +
           '. Tap to change either number.')
        : '';
    }
    if (this.undoBtn) this.undoBtn.disabled = !this.history.canUndo();
    if (this.redoBtn) this.redoBtn.disabled = !this.history.canRedo();
    if (this.sizePill) this.sizePill.set(this.settings.radius);
    if (this.strengthPill) this.strengthPill.set(this.settings.strength);
    this.syncViewButtons();
    if (this.sheetRefresh) this.sheetRefresh();
  };

  A.updateHud = function () {
    var obj = this.scene.current();
    if (!obj) { this.hudEl.textContent = ''; return; }
    var bits = [S.formatCount(obj.mesh.liveTris) + ' tris'];
    if (this.settings.dyntopo) bits.push('dyntopo');
    var axes = (this.settings.symmetryX ? 'X' : '') + (this.settings.symmetryY ? 'Y' : '') + (this.settings.symmetryZ ? 'Z' : '');
    if (axes) bits.push('mirror ' + axes);
    bits.push(this.fps + ' fps');
    this.hudEl.textContent = bits.join('   ');
  };

  /* placeholder so old call sites stay valid; the material sheet rebuilds
     its own swatches when it opens */
  A.syncMatcaps = function () {
    if (!this.matcapButtons) return;
    for (var k in this.matcapButtons) {
      this.matcapButtons[k].classList.toggle('on', k === this.settings.matcap);
    }
  };

  A.closeMenus = function () { /* no menu bar any more */ };

  A.toggle = function (key) {
    this.set(key, !this.settings[key]);
    this.syncViewButtons();
    this.refreshStatus();
    this.updateHud();
    UI.toast(labelFor(key) + (this.settings[key] ? ' on' : ' off'), null, 1200);
  };

  function labelFor(key) {
    return ({
      wireframe: 'Wireframe', flat: 'Flat shading', grid: 'Grid', ortho: 'Orthographic',
      symmetryX: 'Mirror X', symmetryY: 'Mirror Y', symmetryZ: 'Mirror Z',
      dyntopo: 'Dynamic topology', navigateMode: 'One-finger orbit',
      vertexColors: 'Vertex colour'
    })[key] || key;
  }

  /* ================================================================ *
   * sheets
   *
   * One at a time, sliding up from the bottom (or centred on a wide
   * screen). Rows are big enough for a thumb and carry a one-line
   * explanation, so nothing needs a manual.
   * ================================================================ */

  A.closeSheet = function () {
    if (this._sheet) {
      var s = this._sheet;
      this._sheet = null;
      this.sheetRefresh = null;
      s.classList.remove('open');
      setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 180);
    }
  };

  /**
   * Show a sheet. `spec` is {title, rows} or {title, content}.
   * A row is {icon, label, hint, onclick, toggle, value, danger, chevron}.
   */
  A.openSheet = function (spec) {
    var self = this;
    this.closeSheet();
    var body = el('div.sheet-body');
    var sheet = el('div.sheet', null, [
      el('div.sheet-head', null, [
        spec.back ? el('button.round.small', { title: 'Back', onclick: function () { spec.back(); } }, UI.icon('chevron')) : null,
        el('h3', { text: spec.title }),
        el('div.spring'),
        el('button.round.small', { title: 'Close', onclick: function () { self.closeSheet(); } }, UI.icon('close'))
      ]),
      body
    ]);

    if (spec.content) UI.append(body, spec.content);
    if (spec.rows) {
      spec.rows.forEach(function (row) {
        if (!row) return;
        if (row.group) {
          body.appendChild(el('div.sheet-group', { text: row.group }));
          return;
        }
        var right = null;
        if (row.toggle) {
          right = el('span.switch' + (row.value() ? '.on' : ''));
        } else if (row.chevron) {
          right = UI.icon('chevron');
          right.classList.add('go');
        } else if (row.note) {
          right = el('span.row-note', { text: row.note });
        }
        var node = el('button.sheet-row' + (row.danger ? '.danger' : ''), {
          onclick: function () {
            if (row.toggle) {
              row.onclick();
              right.classList.toggle('on', !!row.value());
              return;                      // toggles keep the sheet open
            }
            if (!row.keepOpen) self.closeSheet();
            row.onclick();
          }
        }, [
          row.icon ? UI.icon(row.icon) : el('span.no-icon'),
          el('span.sheet-label', null, [
            el('b', { text: row.label }),
            row.hint ? el('small', { text: row.hint }) : null
          ]),
          right
        ]);
        body.appendChild(node);
      });
    }
    this.sheetHost.appendChild(sheet);
    this._sheet = sheet;
    // let the browser lay it out before starting the slide-up
    requestAnimationFrame(function () { sheet.classList.add('open'); });
    return sheet;
  };

  /* ---- the main menu ---- */

  A.openMainMenu = function () {
    var self = this;
    this.openSheet({
      title: 'Menu',
      rows: [
        { group: 'Model' },
        { icon: 'plus', label: 'New shape', hint: 'Start again from a sphere, box, cylinder…',
          chevron: true, onclick: function () { self.dialogPrimitive(true); } },
        { icon: 'plus', label: 'Add a shape', hint: 'Drop a sphere, box or cylinder in and place it with the handles',
          chevron: true, onclick: function () { self.dialogPrimitive(); } },
        { icon: 'gizmo', label: 'Move, turn, resize', hint: 'The handles for the selected shape (V)',
          onclick: function () { self.setTransformMode(true); } },
        { icon: 'layers', label: 'Objects', hint: 'Switch between, hide, rename, delete',
          chevron: true, onclick: function () { self.openObjectsSheet(); } },
        { icon: 'boolean', label: 'Combine', hint: 'Join, union, subtract or intersect two objects',
          chevron: true, onclick: function () { self.openCombineSheet(); } },

        { group: 'Files — all free, no limits' },
        { icon: 'upload', label: 'Open a model', hint: 'OBJ, STL, PLY, GLB or a saved project',
          chevron: true, onclick: function () { self.importDialog(); } },
        { icon: 'download', label: 'Export', hint: 'Roblox OBJ, or GLB, PLY, STL',
          chevron: true, onclick: function () { self.openExportSheet(); } },
        { icon: 'save', label: 'Save project', hint: 'Keeps masks, colour and the camera',
          onclick: function () { self.saveProject(); } },
        { icon: 'camera', label: 'Screenshot', onclick: function () { self.screenshot(); } },

        { group: 'Surface' },
        { icon: 'remesh', label: 'Remesh', hint: 'Rebuild it with even triangles',
          chevron: true, onclick: function () { self.dialogRemesh(); } },
        { icon: 'subdivide', label: 'Subdivide', hint: 'Four times the triangles, smoother',
          onclick: function () { self.subdivide(true); } },
        { icon: 'decimate', label: 'Reduce triangles', hint: 'Fit a Roblox MeshPart, or lighten for any engine',
          chevron: true, onclick: function () { self.dialogDecimate(); } },
        { icon: 'mirror', label: 'Make symmetrical', hint: 'Mirror the +X half onto the other side',
          onclick: function () { self.symmetrize(0, true); } },
        { icon: 'smooth', label: 'Smooth everything', onclick: function () { self.smoothAll(); } },
        { icon: 'reset', label: 'Fix glitches', hint: 'Pull out spikes, drop bad triangles, close hairline splits',
          onclick: function () { self.repairSurface(); } },
        { icon: 'mask', label: 'Mask', hint: 'Clear, invert or blur the locked area',
          chevron: true, onclick: function () { self.openMaskSheet(); } },
        { icon: 'texture', label: 'Texture', hint: 'Bake the paint into an image and export it',
          chevron: true, onclick: function () { self.openTextureSheet(); } },

        { group: 'Settings' },
        { icon: 'star', label: 'Presets', hint: 'Ready-made brush setups, and your own',
          chevron: true, onclick: function () { self.openPresetSheet(); } },
        { icon: 'sliders', label: 'Brush settings', hint: 'Falloff, spacing, stencils, detail, pressure',
          chevron: true, onclick: function () { self.openBrushSettingsSheet(); } },
        { icon: 'palette', label: 'Look', hint: 'Material, wireframe, background',
          chevron: true, onclick: function () { self.openLookSheet(); } },
        { icon: 'settings', label: 'Preferences', hint: 'Undo memory, recovery, touch',
          chevron: true, onclick: function () { self.dialogPreferences(); } },

        { group: 'Help' },
        { icon: 'keyboard', label: 'Controls', hint: 'Mouse, touch and keyboard',
          chevron: true, onclick: function () { self.dialogShortcuts(); } },
        { icon: 'cube', label: 'Getting models into a game', chevron: true,
          onclick: function () { self.dialogPipeline(); } },
        { icon: 'info', label: 'About', chevron: true, onclick: function () { self.dialogAbout(); } }
      ]
    });
  };

  /* ---- brush picker (the overflow) ---- */

  A.openBrushSheet = function () {
    var self = this;
    var grid = el('div.brush-grid');
    S.BRUSHES.forEach(function (b) {
      var btn = el('button.brush-card' + (b.id === self.settings.brush ? '.on' : ''), {
        title: b.hint,
        onclick: function () { self.selectBrush(b.id); }
      }, [UI.icon(b.id), el('b', { text: b.label }), el('small', { text: b.key })]);
      grid.appendChild(btn);
    });
    this.openSheet({
      title: 'Brushes',
      content: [
        grid,
        el('div.sheet-buttons', null, [
          UI.button('Presets', { icon: 'star', onclick: function () { self.openPresetSheet(); } }),
          UI.button('Brush settings', { icon: 'sliders', onclick: function () { self.openBrushSettingsSheet(); } })
        ]),
        el('p.sheet-note', { text: 'Hold Shift while sculpting to smooth, Ctrl to invert — with any brush.' })
      ]
    });
  };

  /* ---- export ---- */

  A.openExportSheet = function () {
    var self = this;
    var totals = this.scene.totals();
    this.openSheet({
      title: 'Export',
      rows: [
        { icon: 'cube', label: 'Roblox', hint: 'OBJ, reduced to ' +
            S.formatCount(Math.min(this.settings.triBudget || 10000, 10000)) + ' triangles',
          note: 'ready', onclick: function () { self.exportForRoblox(); } },
        { icon: 'file', label: 'OBJ', hint: 'Full detail, opens in anything',
          onclick: function () { self.quickExport('obj'); } },
        { icon: 'cube', label: 'GLB', hint: 'For Three.js, Unity, Godot, Unreal',
          onclick: function () { self.quickExport('glb'); } },
        { icon: 'palette', label: 'PLY', hint: 'Keeps painted colour exactly', onclick: function () { self.quickExport('ply'); } },
        { icon: 'texture', label: 'With a baked texture', hint: 'OBJ + PNG, or GLB with the image inside',
          chevron: true, onclick: function () { self.openTextureSheet(); } },
        { icon: 'decimate', label: 'STL', hint: 'For 3D printing', onclick: function () { self.quickExport('stl'); } },
        { group: 'More' },
        { icon: 'sliders', label: 'Export options', hint: 'Scale, up axis, colour, text formats',
          chevron: true, onclick: function () { self.dialogExport(); } },
        { icon: 'save', label: 'Save project', hint: 'To carry on sculpting later',
          onclick: function () { self.saveProject(); } }
      ],
      content: null
    });
    // a short line about what will be written
    var body = this._sheet.querySelector('.sheet-body');
    body.insertBefore(el('p.sheet-note', {
      text: S.formatCount(totals.tris) + ' triangles across ' + totals.objects +
            ' object' + (totals.objects === 1 ? '' : 's') + ' — nothing is watermarked or limited.'
    }), body.firstChild);
  };

  /* ---- objects ---- */

  A.openObjectsSheet = function () {
    var self = this;
    var list = el('div#objects');
    this.objectsHost = list;
    this.openSheet({
      title: 'Objects',
      content: [
        list,
        el('div.sheet-buttons', null, [
          UI.button('Add', { icon: 'plus', onclick: function () { self.closeSheet(); self.dialogPrimitive(); } }),
          UI.button('Duplicate', { icon: 'copy', onclick: function () { self.duplicateObject(); self.refreshObjects(); } }),
          UI.button('Combine…', { icon: 'boolean', onclick: function () { self.openCombineSheet(); } }),
          UI.button('Delete', { icon: 'trash', class: 'danger', onclick: function () { self.deleteObject(); self.refreshObjects(); } })
        ]),
        el('p.sheet-note', { text: 'Each object has its own mesh. Sculpting only ever touches the selected one.' })
      ]
    });
    this.refreshObjects();                 // the list is in the document now
    this.sheetRefresh = function () { self.refreshObjects(); };
  };

  /**
   * Bring the object list up to date.
   *
   * Rows are updated in place when the list has not changed shape. Tearing
   * them down and rebuilding on every selection detached the element under
   * the pointer — which swallowed the click that caused it — and flickered.
   */
  A.refreshObjects = function () {
    this.refreshTransformBar();
    var self = this;
    var host = this.objectsHost;
    if (!host || !host.parentNode) return;
    var objs = this.scene.objects;

    if (host.children.length === objs.length) {
      for (var i = 0; i < objs.length; i++) {
        var row = host.children[i];
        var obj = objs[i];
        row.classList.toggle('on', i === self.scene.selected);
        var eye = row.querySelector('button');
        var wantVisible = obj.visible ? '1' : '0';
        if (eye.dataset.visible !== wantVisible) {
          eye.dataset.visible = wantVisible;
          eye.classList.toggle('off', !obj.visible);
          UI.clear(eye);
          eye.appendChild(UI.icon(obj.visible ? 'eye' : 'eyeOff'));
        }
        var name = row.querySelector('.name');
        if (document.activeElement !== name && name.value !== obj.name) name.value = obj.name;
        row.querySelector('.count').textContent = S.formatCount(obj.mesh.liveTris);
      }
      return;
    }

    UI.clear(host);
    objs.forEach(function (obj, i) {
      var nameInput = el('input.name', { type: 'text', value: obj.name, onchange: function () {
        obj.name = nameInput.value || obj.name;
        self.refreshStatus();
      } });
      var eye = el('button' + (obj.visible ? '' : '.off'), { title: 'Show or hide', onclick: function () {
        obj.visible = !obj.visible;
        self.refreshObjects();
        self.needsRender = true;
      } }, UI.icon(obj.visible ? 'eye' : 'eyeOff'));
      eye.dataset.visible = obj.visible ? '1' : '0';
      var row = el('div.obj-row' + (i === self.scene.selected ? '.on' : ''), {
        onpointerdown: function (e) {
          if (e.target.closest('button')) return;
          if (self.scene.selected === i) return;
          self.scene.selected = i;
          self.refreshObjects();
          self.refreshStatus();
          self.needsRender = true;
        }
      }, [eye, nameInput, el('span.count', { text: S.formatCount(obj.mesh.liveTris) })]);
      host.appendChild(row);
    });
  };

  /* ---- combine: join and booleans ---- */

  A.openCombineSheet = function () {
    var self = this;
    var st = this.settings;
    var a = this.scene.current();
    if (!a) { UI.toast('No object selected', 'bad'); return; }

    var others = [];
    for (var i = 0; i < this.scene.objects.length; i++) {
      if (i !== this.scene.selected) others.push(i);
    }
    if (!others.length) {
      this.openSheet({
        title: 'Combine',
        content: [
          el('p.sheet-note', { text: 'Combining needs two objects. Add a second shape (Menu \u2192 Add a shape), position it where you want it, then come back.' }),
          el('div.sheet-buttons', null, [
            UI.button('Add a shape', { icon: 'plus', onclick: function () { self.closeSheet(); self.dialogPrimitive(); } })
          ])
        ]
      });
      return;
    }

    var mode = st.booleanMode || 'union';
    var target = others.indexOf(st.booleanTarget) >= 0 ? st.booleanTarget : others[0];
    var note = el('p.sheet-note');
    var resRow, smoothRow, keepCheck, reduceCheck, targetHost, applyBtn;

    function refresh() {
      var entry = mode === 'join'
        ? { label: 'Join', hint: 'Puts both meshes in one object and leaves the geometry alone. Instant and exact; the surfaces still pass through each other.' }
        : S.Boolean.modeById(mode);
      var b = self.scene.objects[target];
      var total = a.mesh.liveTris + (b ? b.mesh.liveTris : 0);
      note.innerHTML = '<b>' + entry.label + '</b> \u2014 ' + entry.hint +
        (mode === 'join'
          ? '<br>Result: <b>' + S.formatCount(total) + '</b> triangles, the two meshes unchanged.'
          : '<br>Rebuilds one closed surface on a grid, so a sharp edge is only as sharp as the resolution.');
      var showBool = mode !== 'join';
      resRow.style.display = showBool ? '' : 'none';
      smoothRow.style.display = showBool ? '' : 'none';
      for (var k = 0; k < targetHost.children.length; k++) {
        targetHost.children[k].classList.toggle('on', +targetHost.children[k].dataset.index === target);
      }
    }

    var modeSeg = UI.segment({ value: mode, options: [
      { id: 'join', label: 'Join', title: 'Keep both meshes, one object' },
      { id: 'union', label: 'Union', title: 'Fuse into one surface' },
      { id: 'subtract', label: 'Subtract', title: 'Cut B out of A' },
      { id: 'intersect', label: 'Intersect', title: 'Keep only the part where the two overlap' }
    ], onchange: function (v) {
      mode = v;
      if (v !== 'join') self.set('booleanMode', v);
      refresh();
    } });

    targetHost = el('div#objects');
    others.forEach(function (index) {
      var o = self.scene.objects[index];
      var row = el('div.obj-row' + (index === target ? '.on' : ''), {
        onpointerdown: function () {
          target = index;
          self.set('booleanTarget', index);
          refresh();
        }
      }, [
        UI.icon('cube'),
        el('span.name', { text: o.name }),
        el('span.count', { text: S.formatCount(o.mesh.liveTris) })
      ]);
      row.dataset.index = index;
      targetHost.appendChild(row);
    });

    resRow = UI.slider({ label: 'Resolution', min: 48, max: 480, step: 4, value: st.booleanResolution,
      title: 'Voxels along the longest side. Higher keeps edges sharper and takes longer.',
      onchange: function (v) { self.set('booleanResolution', v); refresh(); } });
    smoothRow = UI.slider({ label: 'Relax', min: 0, max: 4, step: 1, value: st.booleanSmooth,
      onchange: function (v) { self.set('booleanSmooth', v); } });
    keepCheck = UI.check({ label: 'Keep the other object', value: !!st.booleanKeep,
      onchange: function (v) { self.set('booleanKeep', v); } });
    reduceCheck = UI.check({ label: 'Reduce to budget afterwards', value: st.booleanReduce !== false,
      title: 'A boolean rebuilds the surface at grid density, which is usually far more triangles than a game mesh wants',
      onchange: function (v) { self.set('booleanReduce', v); } });

    this.openSheet({
      title: 'Combine',
      content: [
        el('div.row', null, modeSeg),
        note,
        el('p.sheet-note', { text: 'With' }),
        targetHost,
        resRow, smoothRow,
        el('div.row.wrap', null, [keepCheck, reduceCheck]),
        el('div.sheet-buttons', null, [
          UI.button('Cancel', { onclick: function () { self.closeSheet(); } }),
          (applyBtn = UI.button('Apply', { icon: 'check', class: 'accent', onclick: function () {
            self.closeSheet();
            self.applyCombine(mode, target, {
              resolution: resRow.get(),
              smooth: smoothRow.get(),
              keep: keepCheck.get(),
              reduce: reduceCheck.get()
            });
          } }))
        ])
      ]
    });
    refresh();
  };

  /**
   * Run a join or a boolean between the selected object and another one.
   * The geometry is computed first, then applied inside a single history
   * step that covers both the mesh and the object list.
   */
  A.applyCombine = function (mode, indexB, opts) {
    var self = this;
    var indexA = this.scene.selected;
    var a = this.scene.objects[indexA];
    var b = this.scene.objects[indexB];
    if (!a || !b) { UI.toast('Pick two objects to combine', 'bad'); return; }
    var label = mode === 'join' ? 'Join' : ('Boolean ' + mode);

    UI.busy(label, a.name + ' + ' + b.name, function (report) {
      if (mode === 'join') {
        /*
         * Joining makes one mesh out of two, so each object's paint image —
         * which is mapped in that object's own space — cannot come along as
         * it is. The colour does: it is written onto the vertices first, and
         * the first stroke on the joined object lifts it back into an image
         * of its own. Fine detail is lost, saying so beats losing the lot.
         */
        if (a.paint) a.paint.toVertexColors(a.mesh);
        if (b.paint) b.paint.toVertexColors(b.mesh);
        if (a.paint || b.paint) UI.toast('Joined \u2014 painted detail is now as fine as the mesh', null, 4200);
        return { join: self.scene.mergeObjects([indexA, indexB], a.name) };
      }
      return S.Boolean.compute(a, b, {
        mode: mode, resolution: opts.resolution, smooth: opts.smooth, colors: true
      }, function (f) { report(Math.round(f * 100) + '%'); });
    }, function (result, ms) {
      if (!result) return;
      if (result.ok === false) { UI.toast(result.reason, 'bad', 5000); return; }

      var beforeTris = a.mesh.liveTris;
      self.history.runSceneOp(label,
        function () {
          return { objects: self.scene.objects.slice(), selected: self.scene.selected,
                   obj: a, mesh: a.mesh.snapshot() };
        },
        function (state) {
          self.scene.objects = state.objects.slice();
          self.scene.selected = Math.min(state.selected, Math.max(0, self.scene.objects.length - 1));
          state.obj.mesh.restore(state.mesh);
          self.refreshObjects();
          self.refreshStatus();
          self.needsRender = true;
        },
        function () {
          if (result.join) {
            // a join replaces both objects with the merged one
            var merged = result.join;
            var keep = [];
            for (var i = 0; i < self.scene.objects.length; i++) {
              if (i !== indexA && i !== indexB) keep.push(self.scene.objects[i]);
            }
            self.renderer.releaseObject(a);
            self.renderer.releaseObject(b);
            keep.push(merged);
            self.scene.objects = keep;
            self.scene.selected = keep.length - 1;
            return;
          }
          a.mesh.setFromArrays(result.positions, result.indices, { colors: result.colors, weld: false });
          a.mesh.removeDegenerateTriangles(result.plan.voxel * result.plan.voxel * 1e-7);
          if (opts.smooth > 0) a.mesh.smoothAll(opts.smooth, 0.4, false);
          if (opts.reduce !== false) {
            var budget = self.settings.triBudget || 10000;
            if (a.mesh.liveTris > budget) a.mesh.decimate(budget, true);
          }
          a.mesh.computeNormals();
          if (!opts.keep) {
            self.renderer.releaseObject(b);
            var at = self.scene.objects.indexOf(b);
            if (at >= 0) self.scene.remove(at);
            self.scene.selected = self.scene.objects.indexOf(a);
          }
        });

      self.afterMeshOp(a);
      var health = a.mesh.countBorderEdges() + a.mesh.countNonManifoldEdges();
      UI.toast(label + ': ' + S.formatCount(beforeTris) + ' \u2192 ' +
        S.formatCount(a.mesh.liveTris) + ' triangles in ' + UI.formatMs(ms) +
        (health ? ' (with ' + health + ' odd edges)' : ''), health ? null : 'ok', 4200);
    });
  };

  /* ---- mask ---- */

  A.openMaskSheet = function () {
    var self = this;
    this.openSheet({
      title: 'Mask',
      rows: [
        { icon: 'mask', label: 'Clear the mask', hint: 'Unlock the whole surface',
          onclick: function () { self.maskOp('clear'); } },
        { icon: 'mirror', label: 'Invert', onclick: function () { self.maskOp('invert'); } },
        { icon: 'smooth', label: 'Blur the edge', onclick: function () { self.maskOp('smooth'); } },
        { icon: 'mask', label: 'Mask everything', onclick: function () { self.maskOp('fill'); } }
      ],
      content: null
    });
    var body = this._sheet.querySelector('.sheet-body');
    body.insertBefore(el('p.sheet-note', {
      text: 'Pick the Mask brush (M) and paint to lock part of the surface; hold Ctrl to erase. Locked areas ignore every brush.'
    }), body.firstChild);
  };

  /* ---- look (material and display) ---- */

  A.openLookSheet = function () {
    var self = this;
    var st = this.settings;
    var matcapHost = el('div.matcaps');
    this.matcapButtons = {};
    S.MATCAPS.forEach(function (preset) {
      var canvas = el('canvas', { width: 64, height: 64 });
      var mc = S.makeMatcap(preset, 64);
      var ctx2d = canvas.getContext('2d');
      var img = ctx2d.createImageData(64, 64);
      img.data.set(mc.data);
      ctx2d.putImageData(img, 0, 0);
      var b = el('button.matcap', { title: preset.label, onclick: function () {
        self.set('matcap', preset.id);
        self.syncMatcaps();
      } }, canvas);
      self.matcapButtons[preset.id] = b;
      matcapHost.appendChild(b);
    });
    this.syncMatcaps();

    this.openSheet({
      title: 'Look',
      content: [
        el('p.sheet-note', { text: 'Material' }),
        matcapHost,
        el('div.sheet-buttons', null, [
          UI.button('Load matcap', { icon: 'upload', onclick: function () { self.loadMatcapImage(); } }),
          UI.button('Screenshot', { icon: 'camera', onclick: function () { self.screenshot(); } })
        ])
      ],
      rows: [
        { group: 'Show' },
        { icon: 'wire', label: 'Wireframe', toggle: true, keepOpen: true,
          value: function () { return self.settings.wireframe; },
          onclick: function () { self.set('wireframe', !self.settings.wireframe); } },
        { icon: 'flatten', label: 'Flat shading', toggle: true, keepOpen: true,
          value: function () { return self.settings.flat; },
          onclick: function () { self.set('flat', !self.settings.flat); } },
        { icon: 'grid', label: 'Ground grid', toggle: true, keepOpen: true,
          value: function () { return self.settings.grid; },
          onclick: function () { self.set('grid', !self.settings.grid); } },
        { icon: 'symmetry', label: 'Mirror planes', toggle: true, keepOpen: true,
          value: function () { return self.settings.showSymmetry; },
          onclick: function () { self.set('showSymmetry', !self.settings.showSymmetry); } },
        { icon: 'palette', label: 'Painted colour', toggle: true, keepOpen: true,
          value: function () { return self.settings.vertexColors; },
          onclick: function () { self.set('vertexColors', !self.settings.vertexColors); } },
        { icon: 'cube', label: 'Orthographic camera', toggle: true, keepOpen: true,
          value: function () { return self.settings.ortho; },
          onclick: function () { self.set('ortho', !self.settings.ortho); } }
      ]
    });

    var body = this._sheet.querySelector('.sheet-body');
    body.appendChild(el('p.sheet-note', { text: 'Fine tuning' }));
    body.appendChild(UI.slider({ label: 'Creases', min: 0, max: 1.5, step: 0.01, value: st.cavity,
      title: 'Screen-space crease shading, which makes form easy to read',
      onchange: function (v) { self.set('cavity', v); } }));
    body.appendChild(UI.slider({ label: 'Quality', min: 0.5, max: 2, step: 0.05, value: st.renderScale,
      title: 'Lower it for more speed on a laptop or phone',
      onchange: function (v) { self.set('renderScale', v); } }));
    body.appendChild(el('div.row', null, [
      el('label', { text: 'Backdrop' }),
      el('input', { type: 'color', value: st.bgTop, oninput: function (e) { self.set('bgTop', e.target.value); } }),
      el('input', { type: 'color', value: st.bgBottom, oninput: function (e) { self.set('bgBottom', e.target.value); } })
    ]));
  };

  /* ================================================================ *
   * transform mode: select a shape, then move, turn or resize it
   * ================================================================ */

  A.buildTransformBar = function () {
    var self = this;
    this.transformName = el('button#gizmo-object', {
      title: 'Which shape the gizmo is on — tap for the list',
      onclick: function (e) { e.stopPropagation(); self.openObjectsSheet(); }
    });
    this.transformModeSeg = UI.segment({
      value: this.settings.gizmoMode || 'move',
      options: S.Gizmo.MODES.map(function (m) { return { id: m.id, label: m.label, title: m.hint }; }),
      onchange: function (v) { self.setGizmoMode(v); }
    });
    /*
     * All four ways of combining, right where the shape was added: union to
     * weld it on, subtract to cut it out (a socket, a window, a bite),
     * intersect to keep only the overlap, join to leave both surfaces alone.
     */
    this.transformJoin = el('div.gizmo-join', { hidden: true }, [
      UI.button('Union', { class: 'accent', title: 'Weld the shape into the sculpt as one surface',
        onclick: function () { self.joinPendingShape('union'); } }),
      UI.button('Subtract', { title: 'Cut the shape out of the sculpt',
        onclick: function () { self.joinPendingShape('subtract'); } }),
      UI.button('Intersect', { title: 'Keep only the part where the two overlap',
        onclick: function () { self.joinPendingShape('intersect'); } }),
      UI.button('Join', { title: 'Put both surfaces in one mesh without welding, which is instant',
        onclick: function () { self.joinPendingShape('join'); } })
    ]);
    var bar = el('div#bar-transform', { hidden: true }, [
      this.transformName,
      this.transformModeSeg,
      this.transformJoin,
      el('div.gizmo-tools', null, [
        UI.button('', { icon: 'plus', title: 'Add another shape',
          onclick: function () { self.dialogPrimitive(); } }),
        UI.button('', { icon: 'sliders', title: 'Exact numbers, and what to do with it',
          onclick: function () { self.openTransformSheet(); } }),
        UI.button('Done', { class: 'accent', onclick: function () { self.setTransformMode(false); } })
      ])
    ]);
    return bar;
  };

  A.setTransformMode = function (on) {
    var t = this.transform;
    t.active = !!on;
    t.drag = null;
    if (!t.active) t.pending = null;
    if (this.moveBtn) this.moveBtn.classList.toggle('on', t.active);
    if (this.transformBar) this.transformBar.hidden = !t.active;
    if (this.bottomBar) this.bottomBar.hidden = t.active;
    if (this.toolsEl) this.toolsEl.hidden = t.active;
    if (this.gizmoEl) {
      /*
       * The overlay is an SVG element, and `hidden` is a property of HTML
       * elements only: assigning it here would set a harmless JavaScript
       * property and leave the gizmo on screen. The attribute is what counts.
       */
      if (t.active) {
        this.gizmoEl.removeAttribute('hidden');
      } else {
        this.gizmoEl.setAttribute('hidden', 'hidden');
        // leave nothing behind: the last handles drawn would otherwise sit
        // there until the next time the gizmo comes up
        while (this.gizmoEl.firstChild) this.gizmoEl.removeChild(this.gizmoEl.firstChild);
      }
    }
    if (t.active) {
      t.mode = this.settings.gizmoMode || 'move';
      if (this.transformModeSeg && this.transformModeSeg.set) this.transformModeSeg.set(t.mode);
      this.cursor.valid = false;
      var obj = this.scene.current();
      this.statusTip = obj ? 'Drag a handle to move it; tap another shape to pick that one instead' : '';
    } else {
      var brush = S.brushById(this.settings.brush);
      this.statusTip = brush.hint;
    }
    this.refreshTransformBar();
    this.refreshStatus();
    this.needsRender = true;
  };

  A.setGizmoMode = function (mode) {
    this.transform.mode = mode;
    this.set('gizmoMode', mode);
    if (this.transformModeSeg && this.transformModeSeg.set) this.transformModeSeg.set(mode);
    var entry = null;
    for (var i = 0; i < S.Gizmo.MODES.length; i++) if (S.Gizmo.MODES[i].id === mode) entry = S.Gizmo.MODES[i];
    if (entry) { this.statusTip = entry.hint; this.refreshStatus(); }
    this.needsRender = true;
  };

  A.refreshTransformBar = function () {
    if (!this.transformBar) return;
    var obj = this.scene.current();
    if (this.transformName) {
      this.transformName.textContent = obj ? obj.name : 'Nothing selected';
    }
    if (this.transformJoin) {
      // the Join buttons only mean anything while a freshly added shape is
      // still sitting loose in the scene
      var pending = this.transform.pending;
      var live = pending && this.scene.objects.indexOf(pending.shape) >= 0 &&
                 this.scene.objects.indexOf(pending.target) >= 0;
      this.transformJoin.hidden = !live;
    }
  };

  /** Draw the gizmo. Called from the frame loop while transform mode is on. */
  A.updateGizmo = function () {
    var t = this.transform;
    if (!t.active || !this.gizmoEl) return;
    var obj = this.scene.current();
    var svg = this.gizmoEl;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!obj || !obj.visible) { t.layout = null; return; }

    var layout = S.Gizmo.layout(obj, this.camera, t.mode);
    t.layout = layout;
    if (layout.behindCamera) return;
    svg.setAttribute('viewBox', '0 0 ' + this.camera.width + ' ' + this.camera.height);

    function node(name, attrs) {
      var n = document.createElementNS('http://www.w3.org/2000/svg', name);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    }
    var active = t.drag && t.drag.handle ? t.drag.handle.id : null;

    for (var i = 0; i < layout.handles.length; i++) {
      var h = layout.handles[i];
      var on = h.id === active;
      if (h.kind === 'axis') {
        svg.appendChild(node('line', { x1: h.from[0], y1: h.from[1], x2: h.to[0], y2: h.to[1],
          stroke: h.colour, 'stroke-width': on ? 5 : 3, 'stroke-linecap': 'round',
          opacity: on ? 1 : 0.9 }));
        svg.appendChild(node('circle', { cx: h.to[0], cy: h.to[1], r: on ? 9 : 7,
          fill: h.colour, stroke: '#0d1014', 'stroke-width': 1.5 }));
      } else if (h.kind === 'point') {
        svg.appendChild(node('line', { x1: h.from[0], y1: h.from[1], x2: h.to[0], y2: h.to[1],
          stroke: h.colour, 'stroke-width': on ? 4 : 2.5, 'stroke-linecap': 'round', opacity: 0.85 }));
        var side = on ? 16 : 13;
        svg.appendChild(node('rect', { x: h.to[0] - side / 2, y: h.to[1] - side / 2,
          width: side, height: side, rx: 3, fill: h.colour, stroke: '#0d1014', 'stroke-width': 1.5 }));
      } else if (h.kind === 'ring') {
        svg.appendChild(node('polyline', { points: h.points.map(function (p) { return p[0] + ',' + p[1]; }).join(' '),
          fill: 'none', stroke: h.colour, 'stroke-width': on ? 5 : (h.flat ? 1.5 : 3),
          opacity: on ? 1 : (h.flat ? 0.3 : 0.75) }));
      } else if (h.kind === 'disc') {
        svg.appendChild(node('circle', { cx: h.at[0], cy: h.at[1], r: h.radius,
          fill: on ? 'rgba(255,255,255,0.22)' : 'rgba(232,237,244,0.12)',
          stroke: '#e8edf4', 'stroke-width': on ? 2.5 : 1.5 }));
        if (layout.mode === 'scale') {
          svg.appendChild(node('circle', { cx: h.at[0], cy: h.at[1], r: 4, fill: '#e8edf4' }));
        }
      }
    }
  };

  /* ---- input, from the canvas handlers ---- */

  /**
   * A press while the gizmo is up. Returns true when it was handled, so the
   * canvas does not start a brush stroke.
   */
  A.transformPointerDown = function (p, e) {
    var t = this.transform;
    if (!t.active) return false;
    var obj = this.scene.current();
    if (obj && t.layout) {
      var handle = S.Gizmo.pick(t.layout, p.x, p.y, e && e.pointerType === 'touch' ? 24 : 16);
      if (handle) {
        var drag = S.Gizmo.beginDrag(obj, this.camera, handle, p.x, p.y);
        if (!drag) {
          UI.toast('That handle is edge-on — turn the view a little', null, 1800);
          return true;
        }
        drag.before = S.Gizmo.captureTransform(obj);
        t.drag = drag;
        this.needsRender = true;
        return true;
      }
    }
    // not a handle: tap a shape to work on that one instead
    var hit = this.engine.pick(p.x, p.y, false);
    if (hit && hit.object) {
      var index = this.scene.objects.indexOf(hit.object);
      if (index >= 0 && index !== this.scene.selected) {
        this.scene.selected = index;
        this.refreshObjects();
        this.refreshTransformBar();
        this.refreshStatus();
        UI.toast(hit.object.name, null, 1200);
      }
      this.needsRender = true;
      return true;
    }
    return false;                      // empty space: let the camera orbit
  };

  A.transformPointerMove = function (p) {
    var t = this.transform;
    if (!t.active || !t.drag) return false;
    if (S.Gizmo.drag(t.drag, p.x, p.y, { snap: this.settings.gizmoSnap })) {
      this.dirtySinceSave = true;
      this.needsRender = true;
      if (this._sheet && this.sheetRefresh) this.sheetRefresh();
    }
    return true;
  };

  A.transformPointerUp = function () {
    var self = this;
    var t = this.transform;
    if (!t.drag) return false;
    var drag = t.drag;
    t.drag = null;
    var obj = drag.obj;
    if (!drag.moved) { this.needsRender = true; return true; }

    var after = S.Gizmo.captureTransform(obj);
    var before = drag.before;
    var label = t.mode === 'move' ? 'Move' : (t.mode === 'rotate' ? 'Turn' : 'Resize');
    // the transform is already applied; record it so undo can put it back
    this.history.runSceneOp(label,
      function () { return { obj: obj, t: before }; },
      function (state) {
        S.Gizmo.applyTransform(state.obj, state.t);
        self.refreshTransformBar();
        self.refreshStatus();
        self.needsRender = true;
      },
      function () { S.Gizmo.applyTransform(obj, after); });
    this.refreshStatus();
    this.needsRender = true;
    return true;
  };

  /* ---- adding a shape into the sculpt ---- */

  /**
   * Put a new shape into the scene next to the current one, sized to match,
   * and go straight into transform mode with it selected. The shape stays a
   * separate object until it is joined, so it can be moved, resized and
   * thrown away freely.
   */
  A.insertShape = function (primId, detail) {
    var self = this;
    var entry = S.Prim.byId(primId);
    var target = this.scene.current();
    var shape = null;

    this.sceneOp('Add ' + entry.label, function () {
      var mesh = S.Prim.makeMesh(primId, detail);
      shape = new S.SceneObject(entry.label, mesh);
      if (target) {
        // match it to the sculpt: a bit under half its size, sitting against
        // its side so it overlaps enough to weld
        var mn = V3.create(0, 0, 0), mx = V3.create(0, 0, 0);
        target.worldBounds(mn, mx);
        var span = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
        var smn = mesh.boundsMin(), smx = mesh.boundsMax();
        var own = Math.max(smx[0] - smn[0], smx[1] - smn[1], smx[2] - smn[2]) || 1;
        var want = span * 0.45;
        var f = want / own;
        V3.set(shape.scale, f, f, f);
        var right = self.camera.right();
        var centre = V3.create((mn[0] + mx[0]) * 0.5, (mn[1] + mx[1]) * 0.5, (mn[2] + mx[2]) * 0.5);
        var reach = span * 0.5 + want * 0.3;
        var pivot = V3.create(centre[0] + right[0] * reach,
                              centre[1] + right[1] * reach,
                              centre[2] + right[2] * reach);
        S.Gizmo.keepPivot(shape, pivot, S.Gizmo.localCentre(shape, V3.create(0, 0, 0)));
        V3.copy(shape.baseColor, target.baseColor);
      }
      shape.touch();
      self.scene.add(shape);
      self.scene.selected = self.scene.objects.length - 1;
    });

    this.transform.pending = target ? { target: target, shape: shape } : null;
    this.setTransformMode(true);
    this.setGizmoMode('move');
    this.refreshObjects();
    this.refreshStatus();
    this.dirtySinceSave = true;
    this.needsRender = true;
    UI.toast(target
      ? 'Drag it into place, resize it, then tap Union to make it part of the sculpt'
      : entry.label + ' added', null, 4200);
  };

  /** Weld (or merge) the shape that was just added into the sculpt. */
  A.joinPendingShape = function (mode) {
    var t = this.transform;
    var pending = t.pending;
    if (!pending) { UI.toast('Nothing waiting to be joined', null, 1800); return; }
    var targetIndex = this.scene.objects.indexOf(pending.target);
    var shapeIndex = this.scene.objects.indexOf(pending.shape);
    if (targetIndex < 0 || shapeIndex < 0) {
      t.pending = null;
      this.refreshTransformBar();
      UI.toast('That shape is no longer in the scene', 'bad');
      return;
    }
    this.scene.selected = targetIndex;
    t.pending = null;
    this.refreshTransformBar();
    var known = { union: 1, subtract: 1, intersect: 1, join: 1 };
    this.applyCombine(known[mode] ? mode : 'union', shapeIndex, {
      resolution: this.settings.booleanResolution,
      smooth: this.settings.booleanSmooth,
      keep: false,
      reduce: false                    // a sculpt should not be decimated by a join
    });
  };

  /* ---- the transform sheet: exact numbers and the shape commands ---- */

  A.openTransformSheet = function () {
    var self = this;
    var obj = this.scene.current();
    if (!obj) { UI.toast('Nothing selected', 'bad'); return; }
    var readout = el('p.sheet-note');
    var rows = [];

    function refresh() {
      var d = S.Gizmo.describe(obj);
      readout.textContent = 'Position ' + d.position + '   ·   Turn ' + d.rotation +
                            '   ·   Size ' + d.scale;
    }

    var uniform = UI.slider({ label: 'Size', min: 0.05, max: 5, step: 0.01,
      value: (obj.scale[0] + obj.scale[1] + obj.scale[2]) / 3,
      title: 'Resize the shape evenly',
      onchange: function (v) {
        V3.set(obj.scale, v, v, v);
        obj.touch();
        refresh();
        self.needsRender = true;
      } });

    var axisRows = ['X', 'Y', 'Z'].map(function (name, i) {
      return UI.slider({ label: name, min: -3, max: 3, step: 0.01, value: obj.position[i],
        title: 'Position along ' + name,
        onchange: function (v) {
          obj.position[i] = v;
          obj.touch();
          refresh();
          self.needsRender = true;
        } });
    });

    this.openSheet({
      title: obj.name,
      content: [readout, uniform].concat(axisRows, [
        UI.check({ label: 'Snap to steps', value: !!this.settings.gizmoSnap,
          title: 'Turning snaps to 15°, resizing to 5% steps',
          onchange: function (v) { self.set('gizmoSnap', v); } })
      ]),
      rows: [
        { group: 'This shape' },
        { icon: 'boolean', label: 'Combine with another shape', hint: 'Union, subtract, intersect or join',
          chevron: true,
          onclick: function () { self.openCombineSheet(); } },
        { icon: 'copy', label: 'Duplicate', onclick: function () { self.duplicateObject(); } },
        { icon: 'reset', label: 'Reset the transform', hint: 'Back to no move, no turn, original size',
          onclick: function () { self.resetTransform(); } },
        { icon: 'save', label: 'Freeze the transform', hint: 'Bake it into the mesh and start from scratch',
          onclick: function () { self.applyTransform(); } },
        { icon: 'frame', label: 'Centre the origin', onclick: function () { self.centerOrigin(); } },
        { icon: 'trash', label: 'Delete this shape', danger: true,
          onclick: function () { self.deleteObject(); self.refreshTransformBar(); } }
      ]
    });
    refresh();
    this.sheetRefresh = function () {
      refresh();
      uniform.set((obj.scale[0] + obj.scale[1] + obj.scale[2]) / 3);
      for (var i = 0; i < 3; i++) axisRows[i].set(obj.position[i]);
    };
  };

  /* ---- stencils ---- */

  /**
   * The stencil picker: a thumbnail per stencil, built-ins first, then
   * anything uploaded. Each thumbnail is the stencil itself drawn into a
   * small canvas, so what you pick is what the brush will stamp.
   */
  A.buildAlphaGrid = function () {
    var self = this;
    var grid = el('div.alpha-grid');

    function cell(id, label, alpha, removable) {
      var node = el('button.alpha-cell' + (self.settings.alpha === id ? '.on' : ''), {
        title: alpha ? label : 'No stencil — a plain round brush',
        onclick: function () {
          self.set('alpha', id);
          grid.rebuild();
        }
      });
      if (alpha) {
        var size = 46;
        var cvs = el('canvas', { width: size, height: size });
        var ctx = cvs.getContext('2d');
        var img = ctx.createImageData(size, size);
        img.data.set(S.Alpha.toRGBA(alpha, size));
        ctx.putImageData(img, 0, 0);
        node.appendChild(cvs);
      } else {
        node.appendChild(el('span.alpha-none', null, UI.icon('close')));
      }
      node.appendChild(el('small', { text: label }));
      if (removable) {
        node.appendChild(el('span.alpha-x', {
          title: 'Remove this stencil',
          onclick: function (e) {
            e.stopPropagation();
            self.deleteAlpha(id);
            grid.rebuild();
          }
        }, UI.icon('trash')));
      }
      return node;
    }

    grid.rebuild = function () {
      UI.clear(grid);
      grid.appendChild(cell('none', 'None', null, false));
      var list = S.Alpha.list();
      for (var i = 0; i < list.length; i++) {
        grid.appendChild(cell(list[i].id, list[i].label, S.alphaById(list[i].id), !list[i].builtin));
      }
    };
    grid.rebuild();
    return grid;
  };

  A.saveAlphas = function () {
    try {
      if (root.localStorage && !S.Alpha.saveAll(root.localStorage)) {
        UI.toast('Stencils are loaded but could not be saved for next time', null, 3200);
      }
    } catch (e) { /* ignore */ }
  };

  A.deleteAlpha = function (id) {
    S.Alpha.remove(id);
    this.saveAlphas();
    if (this.settings.alpha === id) this.set('alpha', 'none');
  };

  /**
   * Turn an image file into a stencil. Brightness becomes strength, so a
   * photo of dirt or a drawing of a rivet works straight away; a PNG with
   * transparency uses its alpha as well.
   */
  A.loadAlphaFromFile = function (file, grid, invert) {
    var self = this;
    if (!root.URL || !root.Image) { UI.toast('This browser cannot read image files', 'bad'); return; }
    var url = URL.createObjectURL(file);
    var img = new root.Image();
    img.onload = function () {
      try {
        // draw it down to stencil size first; the browser's scaler is both
        // faster and better than doing it a pixel at a time
        var max = 256;
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        var scale = Math.min(1, max / Math.max(w, h, 1));
        var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        var cvs = document.createElement('canvas');
        cvs.width = cw; cvs.height = ch;
        var ctx = cvs.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);
        var pixels = ctx.getImageData(0, 0, cw, ch).data;
        var label = String(file.name || 'Stencil').replace(/\.[a-z0-9]+$/i, '').slice(0, 16) || 'Stencil';
        var id = 'img-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1296).toString(36);
        S.Alpha.add(S.Alpha.fromPixels(id, label, pixels, cw, ch, { invert: !!invert }));
        self.saveAlphas();
        self.set('alpha', id);
        if (grid && grid.rebuild) grid.rebuild();
        UI.toast('Stencil “' + label + '” ready — draw with it', 'ok', 3400);
      } catch (e) {
        UI.toast('Could not read that image', 'bad');
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      UI.toast('Could not open that image', 'bad');
    };
    img.src = url;
  };

  /** Make an inverted copy of the stencil in use, for light-on-dark images. */
  A.invertCurrentAlpha = function (grid) {
    var alpha = S.alphaById(this.settings.alpha);
    if (!alpha) { UI.toast('Pick a stencil first', null, 1800); return; }
    var id = alpha.id + '-inv';
    if (!S.Alpha.loaded[id]) {
      var data = new Float32Array(alpha.data.length);
      for (var i = 0; i < data.length; i++) data[i] = 1 - alpha.data[i];
      S.Alpha.add(S.Alpha.make(id, alpha.label + ' ⇄', alpha.size, data));
      this.saveAlphas();
    }
    this.set('alpha', id);
    if (grid && grid.rebuild) grid.rebuild();
  };

  /** The stencil block, shared by the brush settings sheet. */
  A.buildAlphaSection = function () {
    var self = this;
    var st = this.settings;
    var grid = this.buildAlphaGrid();
    var stampCheck = UI.check({ label: 'One stamp per press', value: st.stampMode,
      title: 'Tap to place a single dab instead of drawing a stroke — for rivets, panels and logos',
      onchange: function (v) { self.set('stampMode', v); } });
    var followCheck = UI.check({ label: 'Follow the stroke', value: st.alphaFollowStroke !== false,
      title: 'Turns the stencil to face the direction you are drawing',
      onchange: function (v) { self.set('alphaFollowStroke', v); } });
    var rotateCheck = UI.check({ label: 'Random turn', value: !!st.alphaRandomRotate,
      title: 'Spins the stencil a random amount each stroke, so a pattern does not repeat',
      onchange: function (v) { self.set('alphaRandomRotate', v); } });
    /*
     * How the pattern is read matters more than it sounds. Printed afresh
     * under every dab, a pattern piles up on itself as a stroke passes over
     * it and comes out a solid smudge — the complaint was that a textured
     * brush "is just a normal drawing brush". Taken from the model, every
     * dab lays the same pattern in the same place, so scrubbing builds it up.
     */
    var modeSeg = UI.segment({ label: 'Pattern', value: st.alphaMode === 'stamp' ? 'stamp' : 'surface',
      options: [
        { id: 'surface', label: 'On the model', title: 'The pattern sits on the surface: going over it again builds it up' },
        { id: 'stamp', label: 'One per dab', title: 'The pattern is printed inside each dab, turning with the stroke' }
      ],
      onchange: function (v) { self.set('alphaMode', v); } });
    var scaleRow = UI.slider({ label: 'Pattern size', min: 0.2, max: 4, step: 0.1,
      value: st.alphaScale === undefined ? 1 : st.alphaScale,
      title: 'How much of the model one repeat of the pattern covers, as a share of the brush',
      onchange: function (v) { self.set('alphaScale', v); } });
    return [
      el('p.sheet-note', { text: 'Stencil — the brush works through this pattern instead of a round dab' }),
      grid,
      el('div.sheet-buttons', null, [
        UI.button('Load image…', { icon: 'image', onclick: function () {
          UI.pickFiles('image/*', false, function (files) { self.loadAlphaFromFile(files[0], grid); });
        } }),
        UI.button('Invert', { icon: 'reset', onclick: function () { self.invertCurrentAlpha(grid); } })
      ]),
      modeSeg,
      scaleRow,
      el('div.check-row', null, [stampCheck, followCheck, rotateCheck])
    ];
  };

  /* ---- presets ---- */

  A.savePresets = function () {
    try { if (root.localStorage) S.Presets.save(root.localStorage, this.userPresets); } catch (e) { /* ignore */ }
  };

  A.applyPreset = function (id) {
    var self = this;
    var preset = S.Presets.byId(id, this.userPresets);
    if (!preset) return;
    var settings = {};
    for (var k in preset.settings) settings[k] = preset.settings[k];
    // a preset can ask for a stencil that is no longer loaded
    if (settings.alpha && settings.alpha !== 'none' && !S.alphaById(settings.alpha)) settings.alpha = 'none';
    S.Presets.apply({ settings: settings }, this.settings, function (key, value) { self.set(key, value); });
    if (settings.brush) this.selectBrush(settings.brush);
    this.syncPills();
    this.syncViewButtons();
    this.updateHud();
    this.refreshStatus();
    UI.toast(preset.label + ' — ' + S.Presets.describe(preset), 'ok', 2600);
  };

  A.syncPills = function () {
    if (this.panelRefs.radius) this.panelRefs.radius.set(this.settings.radius);
    if (this.panelRefs.strength) this.panelRefs.strength.set(this.settings.strength);
  };

  A.saveCurrentPreset = function () {
    var self = this;
    var brush = S.brushById(this.settings.brush);
    var input = el('input', { type: 'text', value: brush.label + ' setup', maxlength: 28 });
    UI.dialog({
      title: 'Save this setup',
      icon: 'star',
      content: [
        el('p.note', { text: 'Keeps the brush, size, strength, falloff, spacing, smoothing, stencil, ' +
                             'stamp mode and paint colour. Mirroring, the triangle budget and the camera stay as they are.' }),
        el('div.row', null, [el('label', { text: 'Name' }), input])
      ],
      buttons: [
        { label: 'Cancel' },
        { label: 'Save', class: 'accent', onclick: function () {
          var preset = S.Presets.capture(self.settings, input.value.trim() || 'My preset');
          self.userPresets.push(preset);
          self.savePresets();
          UI.toast('Saved “' + preset.label + '”', 'ok');
        } }
      ]
    });
    setTimeout(function () { input.focus(); input.select(); }, 50);
  };

  A.deletePreset = function (id) {
    for (var i = 0; i < this.userPresets.length; i++) {
      if (this.userPresets[i].id === id) {
        this.userPresets.splice(i, 1);
        this.savePresets();
        return true;
      }
    }
    return false;
  };

  /**
   * The preset sheet. Built-in setups first — the ones a game model actually
   * needs — then anything saved from the current brush.
   */
  A.openPresetSheet = function () {
    var self = this;
    var list = el('div.preset-list');

    function rebuild() {
      UI.clear(list);
      var all = S.Presets.all(self.userPresets);
      all.forEach(function (preset) {
        var row = el('button.preset-row', {
          onclick: function () {
            self.closeSheet();
            self.applyPreset(preset.id);
          }
        }, [
          UI.icon(preset.settings.brush || 'star'),
          el('span.preset-label', null, [
            el('b', { text: preset.label }),
            el('small', { text: preset.hint || S.Presets.describe(preset) })
          ])
        ]);
        if (preset.user) {
          row.appendChild(el('span.preset-x', { title: 'Delete this preset', onclick: function (e) {
            e.stopPropagation();
            self.deletePreset(preset.id);
            rebuild();
          } }, UI.icon('trash')));
        }
        list.appendChild(row);
      });
      if (!self.userPresets.length) {
        list.appendChild(el('p.sheet-note', { text: 'Set a brush up how you like it, then save it here.' }));
      }
    }
    rebuild();

    this.openSheet({
      title: 'Presets',
      content: [
        list,
        el('div.sheet-buttons', null, [
          UI.button('Save the current brush', { icon: 'star', class: 'accent', onclick: function () {
            self.closeSheet();
            self.saveCurrentPreset();
          } })
        ])
      ]
    });
  };

  /* ---- texture ---- */

  /**
   * Bake and export. Painting happens on the mesh, which is fast and has no
   * seams to fight, but a game needs an image — so this unwraps the model by
   * box projection, rasterises the paint into an atlas and writes a PNG.
   */
  A.openTextureSheet = function () {
    var self = this;
    var st = this.settings;
    var preview = el('canvas.tex-preview', { width: 200, height: 200 });
    var note = el('p.sheet-note', { text: 'Baking a preview…' });
    var timer = null;

    function refresh() {
      var obj = self.scene.current();
      if (!obj) { note.textContent = 'Nothing to bake.'; return; }
      var geoms = S.IO.prepare([obj], { scale: 1, axis: 'y', applyTransform: false, includeColors: true });
      if (!geoms.length) { note.textContent = 'This object has no geometry.'; return; }
      var built = S.Texture.build(geoms[0], { size: 200, cavity: self.settings.textureCavity });
      var ctx = preview.getContext('2d');
      var img = ctx.createImageData(built.width, built.height);
      img.data.set(built.pixels);
      ctx.putImageData(img, 0, 0);
      note.textContent = obj.name + ' \u2014 six charts, ' +
        Math.round(built.coverage * 100) + '% of the image used, ' +
        S.formatCount(built.geom.vertCount) + ' points after the unwrap.' +
        (obj.paint ? ' Painted at ' + obj.paint.size + ' \u00d7 ' + obj.paint.size + '.' : '');
    }
    function refreshSoon() {
      clearTimeout(timer);
      timer = setTimeout(refresh, 120);
    }

    this.openSheet({
      title: 'Texture',
      content: [
        el('div.tex-wrap', null, preview),
        note,
        UI.segment({ label: 'Image size', value: String(st.textureSize), options: [
          { id: '512', label: '512', title: 'Small and light' },
          { id: '1024', label: '1024', title: 'A good default for a game prop' },
          { id: '2048', label: '2048', title: 'For a hero model' }
        ], onchange: function (v) { self.set('textureSize', parseInt(v, 10)); } }),
        UI.slider({ label: 'Creases', min: 0, max: 1, step: 0.05, value: st.textureCavity,
          title: 'Darkens the recesses in the baked image, the way they look on screen',
          onchange: function (v) { self.set('textureCavity', v); refreshSoon(); } })
      ],
      rows: [
        { group: 'Save' },
        { icon: 'cube', label: 'Roblox: mesh + texture', hint: 'OBJ under the budget, plus the PNG to upload as its texture',
          onclick: function () { self.exportForRoblox(null, true); } },
        { icon: 'file', label: 'OBJ + texture', hint: 'Full detail: .obj, .mtl and .png',
          onclick: function () { self.exportWithTexture('obj'); } },
        { icon: 'cube', label: 'GLB with the texture inside', hint: 'One file for Three.js, Unity, Godot, Blender',
          onclick: function () { self.exportWithTexture('glb'); } },
        { icon: 'image', label: 'Just the image', hint: 'The PNG on its own',
          onclick: function () { self.exportTextureImage(); } },
        { group: 'Paint' },
        { icon: 'paint', label: 'Paint settings', hint: 'Colour, stencil, swatches',
          chevron: true, onclick: function () { self.openBrushSettingsSheet(); } },
        { icon: 'subdivide', label: 'More paint detail', hint: 'Only needed when painting onto the vertices: subdivides so the colour has more places to live',
          onclick: function () {
            if (self.settings.paintTarget === 'texture') {
              UI.toast('Paint already has its own image \u2014 detail does not depend on the mesh', null, 4200);
              return;
            }
            self.subdivide(true);
          } },
        { icon: 'reset', label: 'Clear the paint', hint: 'Throws the painted image away and goes back to the plain colour',
          onclick: function () { self.dropPaintMap(); } }
      ]
    });
    requestAnimationFrame(refresh);
  };

  /** Texture options shared by every baked export. */
  A.textureOptions = function () {
    var opts = this.exportOptions();
    opts.textureSize = this.settings.textureSize;
    opts.cavity = this.settings.textureCavity;
    opts.baseName = this.exportFilename('x').replace(/\.x$/, '');
    return opts;
  };

  A.exportWithTexture = function (format) {
    var self = this;
    var objs = this.exportTargets();
    if (!objs.length) { UI.toast('Nothing to export', 'bad'); return; }
    var opts = this.textureOptions();
    UI.busy('Baking the texture', opts.textureSize + ' × ' + opts.textureSize, function (report) {
      var geoms = S.IO.prepare(objs, opts);
      if (!geoms.length) throw new Error('The selected objects have no geometry.');
      report('unwrapping, then painting the image');
      var out = S.IO.exportTextured(format, geoms, opts);
      var names = [], bytes = 0;
      for (var i = 0; i < out.files.length; i++) {
        bytes += UI.download(out.files[i].data, out.files[i].name, out.files[i].mime);
        names.push(out.files[i].name);
      }
      return { names: names, bytes: bytes };
    }, function (result) {
      if (!result) return;
      UI.toast('Saved ' + result.names.join(', ') + ' — ' + S.formatBytes(result.bytes), 'ok', 5200);
    });
  };

  A.exportTextureImage = function () {
    var self = this;
    var obj = this.scene.current();
    if (!obj) { UI.toast('Nothing to bake', 'bad'); return; }
    var opts = this.textureOptions();
    UI.busy('Baking the texture', opts.textureSize + ' × ' + opts.textureSize, function () {
      var geoms = S.IO.prepare([obj], { scale: 1, axis: 'y', applyTransform: false, includeColors: true });
      if (!geoms.length) throw new Error('This object has no geometry.');
      var built = S.Texture.build(geoms[0], { size: opts.textureSize, cavity: opts.cavity });
      var name = self.exportFilename('png');
      return { name: name, size: UI.download(built.png(), name, 'image/png') };
    }, function (result) {
      if (!result) return;
      UI.toast('Saved ' + result.name + ' — ' + S.formatBytes(result.size), 'ok', 4200);
    });
  };

  /* ---- brush settings (everything that used to crowd the screen) ---- */

  A.openBrushSettingsSheet = function () {
    var self = this;
    var st = this.settings;
    var brush = S.brushById(st.brush);

    var detailRow = UI.slider({ label: 'Detail', min: 4, max: 40, step: 1, value: st.detailPixels, suffix: ' px',
      title: 'How big the new triangles are on screen. Smaller means finer detail and more of them',
      onchange: function (v) { self.set('detailPixels', v); } });
    var maxRow = UI.slider({ label: 'Limit', min: 25000, max: 2000000, step: 25000, value: st.maxTriangles,
      format: function (v) { return S.formatCount(Number(v)); },
      title: 'Dynamic topology stops adding triangles here',
      onchange: function (v) { self.set('maxTriangles', v); } });

    var colorInput = el('input', { type: 'color', value: st.paintColorHex, oninput: function () {
      self.set('paintColorHex', colorInput.value);
    } });
    var swatches = el('div.swatches');
    ['#d94f3d', '#e8833a', '#f2c14e', '#7fb069', '#4a9fd4', '#5b6ee1', '#9b6bd4', '#8c6239', '#c9c9c9', '#ffffff']
      .forEach(function (hex) {
        swatches.appendChild(el('button.swatch', { style: { background: hex }, title: hex, onclick: function () {
          self.set('paintColorHex', hex);
          colorInput.value = hex;
        } }));
      });

    var budgetSeg = UI.segment({ label: 'Budget', value: String(st.triBudget), options: [
      { id: '1000', label: '1k', title: 'Very light — small props' },
      { id: '2000', label: '2k', title: 'A good Roblox prop' },
      { id: '5000', label: '5k', title: 'A detailed Roblox model' },
      { id: '10000', label: '10k', title: 'Roblox\u2019s hard limit for one MeshPart' }
    ], onchange: function (v) { self.setBudget(parseInt(v, 10)); } });
    var bigBudgetRow = el('div.btn-grid', null, [
      UI.button('50k', { onclick: function () { self.setBudget(50000); } }),
      UI.button('250k — other engines', { onclick: function () { self.setBudget(250000); } })
    ]);

    this.openSheet({
      title: brush.label + ' settings',
      content: [
        el('p.sheet-note', { text: brush.hint }),
        UI.select({ label: 'Falloff', value: st.falloff,
          options: S.FALLOFFS.map(function (f) { return { id: f.id, label: f.label }; }),
          onchange: function (v) { self.set('falloff', v); } }),
        UI.slider({ label: 'Smoothing', min: 0, max: 1, step: 0.01, value: st.autoSmooth,
          title: 'Relaxes the surface slightly behind every stamp',
          onchange: function (v) { self.set('autoSmooth', v); } }),
        UI.slider({ label: 'Steadiness', min: 0, max: 0.92, step: 0.01, value: st.strokeSmoothing,
          title: 'Smooths the path of the stroke for steadier lines',
          onchange: function (v) { self.set('strokeSmoothing', v); } }),
        UI.slider({ label: 'Spacing', min: 0.02, max: 1, step: 0.01, value: st.spacing,
          title: 'Distance between brush stamps',
          onchange: function (v) { self.set('spacing', v); } }),
        this.buildAlphaSection(),
        el('p.sheet-note', { text: 'Paint' }),
        UI.segment({ label: 'Paint onto', value: st.paintTarget === 'vertex' ? 'vertex' : 'texture',
          options: [
            { id: 'texture', label: 'The texture', title: 'Colour lives in an image, so a pattern stays sharp however few triangles the model has' },
            { id: 'vertex', label: 'The vertices', title: 'Colour lives in the mesh: as fine as the triangles, and exports in a PLY' }
          ],
          onchange: function (v) { self.set('paintTarget', v); } }),
        UI.segment({ label: 'Texture size', value: String(st.paintSize || 1024), options: [
          { id: '512', label: '512', title: 'Light' },
          { id: '1024', label: '1024', title: 'A good default' },
          { id: '2048', label: '2048', title: 'For a hero model' }
        ], onchange: function (v) { self.set('paintSize', parseInt(v, 10)); } }),
        el('div.row', null, [colorInput,
          UI.button('Pick from model', { icon: 'palette', class: 'grow', onclick: function () {
            self.closeSheet();
            self.startColorPick();
          } })]),
        swatches,
        el('div.sheet-buttons', null, [
          UI.button('Fill object', { onclick: function () { self.fillColor(); } }),
          UI.button('Clear colour', { onclick: function () { self.fillColor(true); } })
        ]),
        el('p.sheet-note', { text: 'Changing the texture size starts a fresh image for anything painted after it; what is already painted keeps the size it was made at.' })
      ],
      rows: [
        { group: 'Triangles' },
        { icon: 'layers', label: 'Add triangles as you sculpt', hint: 'Dynamic topology (D) — off, brushes can only stretch what is there',
          toggle: true, keepOpen: true,
          value: function () { return self.settings.dyntopo; },
          onclick: function () { self.set('dyntopo', !self.settings.dyntopo); self.updateHud(); } },
        { group: 'Mirror' },
        { icon: 'symmetry', label: 'Mirror X', toggle: true, keepOpen: true,
          value: function () { return self.settings.symmetryX; },
          onclick: function () { self.set('symmetryX', !self.settings.symmetryX); self.syncViewButtons(); } },
        { icon: 'symmetry', label: 'Mirror Y', toggle: true, keepOpen: true,
          value: function () { return self.settings.symmetryY; },
          onclick: function () { self.set('symmetryY', !self.settings.symmetryY); self.syncViewButtons(); } },
        { icon: 'symmetry', label: 'Mirror Z', toggle: true, keepOpen: true,
          value: function () { return self.settings.symmetryZ; },
          onclick: function () { self.set('symmetryZ', !self.settings.symmetryZ); self.syncViewButtons(); } },
        { group: 'Pen' },
        { icon: 'draw', label: 'Pressure changes size', toggle: true, keepOpen: true,
          value: function () { return self.settings.pressureRadius; },
          onclick: function () { self.set('pressureRadius', !self.settings.pressureRadius); } },
        { icon: 'draw', label: 'Pressure changes strength', toggle: true, keepOpen: true,
          value: function () { return self.settings.pressureStrength; },
          onclick: function () { self.set('pressureStrength', !self.settings.pressureStrength); } },
        { icon: 'eye', label: 'Skip surfaces facing away', toggle: true, keepOpen: true,
          value: function () { return self.settings.frontFacing; },
          onclick: function () { self.set('frontFacing', !self.settings.frontFacing); } }
      ]
    });

    // the detail sliders belong with the dyntopo switch
    var body = this._sheet.querySelector('.sheet-body');
    body.appendChild(budgetSeg);
    body.appendChild(bigBudgetRow);
    body.appendChild(detailRow);
    body.appendChild(maxRow);
    body.appendChild(el('p.sheet-note', {
      text: 'The budget is what Export reduces a copy of the model to \u2014 Roblox refuses a mesh over 10,000 triangles and a real prop is usually 1k\u20134k. Sculpt as dense as you need: the brushes add triangles as they build, and the count above only has to come down when you export. Detail sets how fine those new triangles are, Limit is where adding stops.'
    }));
  };

  /* ================================================================ *
   * GL, sizing and the frame loop
   * ================================================================ */

  A.initGL = function () {
    var self = this;
    this.renderer = new S.Renderer(this.canvas);
    this.renderer.setMatcap(this.settings.matcap);
    this.camera.ortho = !!this.settings.ortho;
    this.camera.fov = this.settings.fov * Math.PI / 180;
    this.engine = new S.StrokeEngine({
      scene: this.scene, history: this.history, settings: this.settings, camera: this.camera
    });
    this.history.onChange = function () { self.refreshStatus(); };

    if (root.ResizeObserver) {
      this._ro = new ResizeObserver(function () { self.resize(); });
      this._ro.observe(this.canvas.parentNode);
    }
    root.addEventListener('resize', function () { self.resize(); });
    this.resize();
  };

  A.resize = function () {
    var wrap = this.canvas.parentNode;
    var w = wrap.clientWidth || 800;
    var h = wrap.clientHeight || 600;
    this.renderer.resize(w, h, this.settings.renderScale);
    this.camera.setViewport(w, h);
    this.needsRender = true;
  };

  A.loop = function () {
    var self = this;
    function frame(now) {
      var dt = Math.min((now - self.lastFrame) / 1000, 0.25);
      self.lastFrame = now;
      if (self.camera.animate(dt)) self.needsRender = true;
      if (self.needsRender) {
        self.draw();
        self.needsRender = false;
      }
      self.frameTimes.push(dt);
      if (self.frameTimes.length > 30) self.frameTimes.shift();
      var sum = 0;
      for (var i = 0; i < self.frameTimes.length; i++) sum += self.frameTimes[i];
      self.fps = sum > 0 ? Math.round(self.frameTimes.length / sum) : 0;
      self.maybeAutosave(now);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  A.draw = function () {
    if (this.transform.active) this.updateGizmo();
    var st = this.settings;
    var scene = this.scene;
    var obj = scene.current();
    var gridExtent = 1;
    if (obj) gridExtent = Math.max(obj.mesh.boundsRadius() * 2.4, this.camera.distance * 0.8);

    this.renderer.render(scene, this.camera, {
      background: [UI.hexToRgb(st.bgTop), UI.hexToRgb(st.bgBottom)],
      vignette: st.vignette,
      wireframe: st.wireframe,
      flat: st.flat,
      vertexColors: st.vertexColors,
      cavity: st.cavity,
      maskVis: st.maskVis,
      grid: st.grid,
      gridExtent: gridExtent,
      symmetry: st.showSymmetry ? {
        any: st.symmetryX || st.symmetryY || st.symmetryZ,
        x: st.symmetryX, y: st.symmetryY, z: st.symmetryZ
      } : null,
      cursor: this.cursor
    });
    this.updateHud();
  };

  /* ================================================================ *
   * input
   * ================================================================ */

  A.eventPos = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  A.bindInput = function () {
    var self = this;
    var canvas = this.canvas;

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    canvas.addEventListener('pointerdown', function (e) {
      self.closeMenus();
      canvas.setPointerCapture(e.pointerId);
      var p = self.eventPos(e);
      self.pointers.set(e.pointerId, { x: p.x, y: p.y, type: e.pointerType, button: e.button });

      if (self.pointers.size >= 2) {
        // A second finger means the user is navigating, not sculpting, so the
        // dab the first finger just made is undone rather than committed.
        if (self.engine.active) {
          self.engine.cancel();
          self.needsRender = true;
        }
        // a gizmo drag is committed rather than thrown away: the shape has
        // already visibly moved, so undo should have something to undo
        if (self.transform.drag) self.transformPointerUp();
        self.startTouchNav();
        return;
      }

      var wantNav = e.button === 1 || e.button === 2 || e.altKey || self.spaceDown ||
                    (e.pointerType === 'touch' && self.settings.navigateMode);
      if (wantNav) {
        var mode = (e.button === 1 || (e.shiftKey && e.button === 2) || self.spaceDown) ? 'pan' : 'orbit';
        self.navigating = { mode: mode, x: p.x, y: p.y };
        canvas.classList.add('navigating');
        return;
      }

      if (self.pickingColor) {
        self.finishColorPick(p);
        return;
      }

      // with the gizmo up, a press is either a handle, a shape to select, or
      // empty space to orbit from — never a brush stroke
      if (self.transform.active) {
        if (self.transformPointerDown(p, e)) return;
        self.navigating = { mode: 'orbit', x: p.x, y: p.y };
        canvas.classList.add('navigating');
        return;
      }

      self.preparePaint();
      var started = self.engine.begin({
        x: p.x, y: p.y,
        pressure: e.pointerType === 'mouse' ? 1 : (e.pressure || 0.5) * 2,
        invert: e.ctrlKey || e.metaKey,
        smooth: e.shiftKey
      });
      if (started) {
        self.dirtySinceSave = true;
        self.needsRender = true;
      } else {
        // clicking off the model orbits instead, which feels natural
        self.navigating = { mode: 'orbit', x: p.x, y: p.y };
        canvas.classList.add('navigating');
      }
    });

    canvas.addEventListener('pointermove', function (e) {
      var p = self.eventPos(e);
      var tracked = self.pointers.get(e.pointerId);
      if (tracked) { tracked.x = p.x; tracked.y = p.y; }

      if (self.pointers.size >= 2) { self.updateTouchNav(); return; }

      if (self.transform.active && self.transform.drag) {
        self.transformPointerMove(p);
        return;
      }

      if (self.navigating) {
        var dx = p.x - self.navigating.x, dy = p.y - self.navigating.y;
        self.navigating.x = p.x;
        self.navigating.y = p.y;
        if (self.navigating.mode === 'pan') self.camera.pan(dx, dy);
        else self.camera.orbit(dx, dy);
        self.needsRender = true;
        return;
      }

      if (self.engine.active) {
        self.engine.move({
          x: p.x, y: p.y,
          pressure: e.pointerType === 'mouse' ? 1 : (e.pressure || 0.5) * 2,
          invert: e.ctrlKey || e.metaKey,
          smooth: e.shiftKey
        });
        self.updateCursor(p, true);
        self.needsRender = true;
        return;
      }
      self.updateCursor(p, false);
    });

    function endPointer(e) {
      self.pointers.delete(e.pointerId);
      if (self.transform.drag) {
        self.transformPointerUp();
        self.refreshObjects();
      }
      if (self.engine.active) {
        var committed = self.engine.end();
        if (committed) self.dirtySinceSave = true;
        self.refreshStatus();
        self.refreshObjects();
        self.warnIfBudgetFull();
      }
      if (self.pointers.size < 2) self.touchNav = null;
      if (!self.pointers.size) {
        self.navigating = null;
        self.canvas.classList.remove('navigating');
      }
      self.needsRender = true;
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', function (e) {
      if (!self.engine.active && !self.navigating) {
        self.cursor.valid = false;
        self.needsRender = true;
      }
    });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.shiftKey) {
        self.nudgeRadius(e.deltaY > 0 ? -6 : 6);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        self.nudgeStrength(e.deltaY > 0 ? -0.04 : 0.04);
        return;
      }
      var factor = Math.exp(S.clamp(e.deltaY, -240, 240) * 0.0016);
      var p = self.eventPos(e);
      var hit = self.engine.pick(p.x, p.y, false);
      self.camera.zoomAt(factor, hit ? hit.point : null);
      self.needsRender = true;
    }, { passive: false });

    document.addEventListener('keydown', function (e) { self.onKey(e); });
    document.addEventListener('keyup', function (e) {
      if (e.code === 'Space') self.spaceDown = false;
    });

    // drag and drop import
    var dropHint = document.getElementById('drop-hint');
    var dragDepth = 0;
    root.addEventListener('dragenter', function (e) {
      e.preventDefault();
      dragDepth++;
      dropHint.hidden = false;
    });
    root.addEventListener('dragover', function (e) { e.preventDefault(); });
    root.addEventListener('dragleave', function (e) {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) dropHint.hidden = true;
    });
    root.addEventListener('drop', function (e) {
      e.preventDefault();
      dragDepth = 0;
      dropHint.hidden = true;
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) self.importFiles(Array.prototype.slice.call(files));
    });

    root.addEventListener('beforeunload', function (e) {
      if (self.dirtySinceSave && self.scene.totals().tris > 0) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    });
  };

  /**
   * Set the export budget.
   *
   * This is what Export reduces a copy of the model to, not a cap on what
   * you can sculpt: dynamic topology keeps its headroom, because a brush
   * that cannot add triangles goes back to stretching the ones already
   * there. It also picks a matching stroke detail, so a small budget means
   * chunkier strokes and there is less to throw away at the end.
   */
  A.setBudget = function (n) {
    n = Math.max(200, Math.round(n));
    this.set('triBudget', n);
    /*
     * Headroom for the brushes: six times the budget, never under 150,000,
     * and never under what the model already has — dropping the ceiling
     * below the live count would make the next stroke coarsen the mesh
     * instead of adding to it, which is a nasty surprise.
     */
    var obj = this.scene.current();
    var live = obj ? obj.mesh.liveTris : 0;
    this.set('maxTriangles', Math.max(n * 6, 150000, live));
    this.set('detailPixels', n <= 2000 ? 18 : (n <= 10000 ? 14 : (n <= 50000 ? 10 : 8)));
    this.refreshStatus();
    this.updateHud();
    UI.toast('Export budget ' + S.formatCount(n) + ' triangles \u2014 sculpt as dense as you like, ' +
             'Export reduces to it', null, 3800);

  };

  /** A starting density that lands near the budget for a given primitive. */
  A.detailForBudget = function (entry) {
    var budget = this.settings.triBudget || 2000;
    if (entry.id === 'sphere') {
      // icosphere: 20 * 4^n triangles
      var n = Math.round(Math.log(Math.max(budget * 0.65, 20) / 20) / Math.log(4));
      return S.clamp(n, 1, entry.detailMax || 7);
    }
    // everything else is a grid: triangles grow with the square of the knob
    var guess = Math.round(Math.sqrt(budget / 60));
    return S.clamp(guess, 2, entry.detailMax || 12);
  };

  /**
   * Dynamic topology stops adding triangles at the Limit. Say so once, with
   * the way out, rather than leaving the brush silently doing nothing.
   */
  A.warnIfBudgetFull = function () {
    var obj = this.scene.current();
    if (!obj || !this.settings.dyntopo) return;
    var cap = this.settings.maxTriangles;
    if (obj.mesh.liveTris < cap - 8) return;
    var now = performance.now();
    if (this._budgetWarned && now - this._budgetWarned < 30000) return;
    this._budgetWarned = now;
    UI.toast('At the ' + S.formatCount(cap) + ' triangle limit \u2014 the brushes cannot add any more. ' +
      'Raise Limit in Brush settings, or remesh to even the surface out.', null, 5000);
  };

  /* ---- touch navigation ---- */

  A.startTouchNav = function () {
    var pts = Array.from(this.pointers.values());
    this.touchNav = {
      cx: (pts[0].x + pts[1].x) / 2,
      cy: (pts[0].y + pts[1].y) / 2,
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
      count: this.pointers.size
    };
    this.canvas.classList.add('navigating');
  };

  A.updateTouchNav = function () {
    if (!this.touchNav) { this.startTouchNav(); return; }
    var pts = Array.from(this.pointers.values());
    if (pts.length < 2) return;
    var cx = (pts[0].x + pts[1].x) / 2;
    var cy = (pts[0].y + pts[1].y) / 2;
    var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    var nav = this.touchNav;
    var dx = cx - nav.cx, dy = cy - nav.cy;

    if (pts.length >= 3) this.camera.pan(dx, dy);
    else {
      this.camera.orbit(dx, dy);
      var pinch = nav.dist / dist;
      if (isFinite(pinch) && pinch > 0) this.camera.zoom(S.clamp(pinch, 0.5, 2));
    }
    nav.cx = cx; nav.cy = cy; nav.dist = dist;
    this.needsRender = true;
  };

  /* ---- brush cursor ---- */

  A.updateCursor = function (p, duringStroke) {
    var hit = this.engine.pick(p.x, p.y, true);
    if (!hit) {
      if (this.cursor.valid) this.needsRender = true;
      this.cursor.valid = false;
      return;
    }
    var perPixel = this.camera.worldPerPixel(hit.point);
    V3.copy(this.cursor.point, hit.point);
    V3.copy(this.cursor.normal, hit.normal);
    this.cursor.radius = this.settings.radius * perPixel;
    this.cursor.inner = 0.55;
    this.cursor.valid = true;
    var brush = S.brushById(this.settings.brush);
    this.cursor.color = brush.paint ? [this.settings.paintColor[0], this.settings.paintColor[1], this.settings.paintColor[2], 0.95]
                      : brush.mask ? [0.45, 0.65, 1, 0.9]
                      : [1, 1, 1, 0.8];
    this.needsRender = true;
  };

  A.nudgeRadius = function (delta) {
    var v = S.clamp(this.settings.radius + delta, 8, MAX_RADIUS);
    this.set('radius', v);
    if (this.panelRefs.radius) this.panelRefs.radius.set(v);
    this.showRadiusPreview();
    this.refreshStatus();
  };

  A.nudgeStrength = function (delta) {
    var v = S.clamp(this.settings.strength + delta, 0, MAX_STRENGTH);
    this.set('strength', v);
    if (this.panelRefs.strength) this.panelRefs.strength.set(v);
    UI.toast('Strength ' + v.toFixed(2), null, 900);
    this.refreshStatus();
  };

  A.showRadiusPreview = function () {
    var self = this;
    var prev = this.radiusPreview;
    var r = this.settings.radius;
    var rect = this.canvas.getBoundingClientRect();
    prev.style.display = 'block';
    prev.style.width = prev.style.height = (r * 2) + 'px';
    prev.style.left = (rect.width / 2 - r) + 'px';
    prev.style.top = (rect.height / 2 - r) + 'px';
    clearTimeout(this._radiusTimer);
    this._radiusTimer = setTimeout(function () { prev.style.display = 'none'; }, 600);
  };

  /* ---- keyboard ---- */

  A.onKey = function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.code === 'Space') { this.spaceDown = true; e.preventDefault(); return; }

    var mod = e.ctrlKey || e.metaKey;
    var key = e.key;

    if (mod) {
      switch (key.toLowerCase()) {
        case 'z': e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return;
        case 'y': e.preventDefault(); this.redo(); return;
        case 's': e.preventDefault(); this.saveProject(); return;
        case 'e': e.preventDefault(); this.dialogExport(); return;
        case 'i': e.preventDefault(); this.importDialog(); return;
        case 'o': e.preventDefault(); this.openProject(); return;
        case 'p': e.preventDefault(); this.screenshot(); return;
        case 'r': e.preventDefault(); this.dialogRemesh(); return;
        case 'd': e.preventDefault(); this.subdivide(true); return;
        case 'n': e.preventDefault(); this.dialogNew(); return;
      }
      return;
    }

    if (e.altKey) {
      var views = ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso'];
      var n = parseInt(key, 10);
      if (n >= 1 && n <= 7) {
        e.preventDefault();
        this.camera.setView(views[n - 1]);
        this.needsRender = true;
      }
      return;
    }

    // brush hotkeys
    for (var i = 0; i < S.BRUSHES.length; i++) {
      var b = S.BRUSHES[i];
      if (b.key && b.key.toLowerCase() === key.toLowerCase() && !e.shiftKey) {
        this.selectBrush(b.id);
        UI.toast(b.label, null, 900);
        return;
      }
    }

    switch (key) {
      case '[': this.nudgeRadius(-Math.max(2, this.settings.radius * 0.1)); return;
      case ']': this.nudgeRadius(Math.max(2, this.settings.radius * 0.1)); return;
      case '{': this.nudgeStrength(-0.05); return;
      case '}': this.nudgeStrength(0.05); return;
      case 'f': this.frameSelection(); return;
      case 'F': this.frameAll(); return;
      case 'w': this.toggle('wireframe'); return;
      case 'W': this.toggle('flat'); return;
      case 'G': this.toggle('grid'); return;
      case 'O': this.toggle('ortho'); return;
      case 'x': this.toggle('symmetryX'); return;
      case 'y': this.toggle('symmetryY'); return;
      case 'z': this.toggle('symmetryZ'); return;
      case 'd': this.toggle('dyntopo'); return;
      case 'A': this.dialogPrimitive(); return;
      case 'v': this.setTransformMode(!this.transform.active); return;
      case '?': this.dialogShortcuts(); return;
      case 'Escape':
        if (this.engine.active) { this.engine.cancel(); this.needsRender = true; }
        if (this._sheet) { this.closeSheet(); return; }
        if (this.transform.active) { this.setTransformMode(false); return; }
        this.closeSheet();
        return;
      case 'Delete': this.deleteObject(); return;
    }
  };

  A.toggleFullscreen = function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  };
  /* ================================================================ *
   * scene commands
   * ================================================================ */

  A.captureScene = function () {
    // a light snapshot of the object list for undoing add/delete/merge
    var objects = this.scene.objects.slice();
    return { objects: objects, selected: this.scene.selected };
  };

  A.restoreScene = function (state) {
    this.scene.objects = state.objects.slice();
    this.scene.selected = Math.min(state.selected, Math.max(0, this.scene.objects.length - 1));
    this.refreshObjects();
    this.refreshStatus();
    this.needsRender = true;
  };

  A.sceneOp = function (label, fn) {
    var self = this;
    return this.history.runSceneOp(label, function () { return self.captureScene(); },
      function (state) { self.restoreScene(state); }, fn);
  };

  A.newScene = function (primId, detail, initial) {
    this.transform.pending = null;
    var self = this;
    if (detail === undefined || detail === null) {
      detail = this.detailForBudget(S.Prim.byId(primId || 'sphere'));
    }
    for (var i = 0; i < this.scene.objects.length; i++) this.renderer.releaseObject(this.scene.objects[i]);
    this.scene.clear();
    this.history.clear();
    var mesh = S.Prim.makeMesh(primId || 'sphere', detail);
    var obj = new S.SceneObject(S.Prim.byId(primId || 'sphere').label, mesh);
    this.scene.add(obj);
    this.frameAll(true);
    this.refreshObjects();
    this.refreshStatus();
    this.dirtySinceSave = false;
    this.needsRender = true;
    if (!initial) UI.toast('New sculpt started');
  };

  A.addPrimitive = function (primId, detail) {
    var self = this;
    var entry = S.Prim.byId(primId);
    this.sceneOp('Add ' + entry.label, function () {
      var mesh = S.Prim.makeMesh(primId, detail);
      var obj = new S.SceneObject(entry.label, mesh);
      // drop it beside whatever is already there
      var mn = V3.create(0, 0, 0), mx = V3.create(0, 0, 0);
      if (self.scene.objects.length && self.scene.bounds(mn, mx)) {
        obj.position[0] = mx[0] + (mesh.boundsMax()[0] - mesh.boundsMin()[0]) * 0.6 + 0.05;
        obj.touch();
      }
      self.scene.add(obj);
    });
    this.refreshObjects();
    this.refreshStatus();
    this.dirtySinceSave = true;
    this.needsRender = true;
  };

  A.duplicateObject = function () {
    var self = this;
    var obj = this.scene.current();
    if (!obj) return;
    this.sceneOp('Duplicate object', function () {
      var copy = obj.cloneObject();
      copy.position[0] += Math.max(obj.mesh.boundsRadius(), 0.1) * 0.8;
      copy.touch();
      self.scene.add(copy);
    });
    this.refreshObjects();
    this.refreshStatus();
    this.dirtySinceSave = true;
    this.needsRender = true;
  };

  A.deleteObject = function () {
    this.transform.pending = null;
    this.transform.drag = null;
    var self = this;
    if (this.scene.objects.length <= 1) {
      UI.toast('The last object cannot be deleted — use File > New instead', 'bad');
      return;
    }
    var index = this.scene.selected;
    var obj = this.scene.objects[index];
    this.sceneOp('Delete object', function () {
      self.scene.remove(index);
    });
    if (obj) this.renderer.releaseObject(obj);
    this.refreshObjects();
    this.refreshStatus();
    this.dirtySinceSave = true;
    this.needsRender = true;
  };

  A.mergeAll = function () {
    var self = this;
    var visible = [];
    for (var i = 0; i < this.scene.objects.length; i++) if (this.scene.objects[i].visible) visible.push(i);
    if (visible.length < 2) { UI.toast('Nothing to merge — there is only one visible object', 'bad'); return; }
    UI.busy('Merging objects', visible.length + ' objects', function () {
      return self.scene.mergeObjects(visible, 'Merged');
    }, function (merged) {
      if (!merged) { UI.toast('Merge produced nothing', 'bad'); return; }
      self.sceneOp('Merge objects', function () {
        for (var k = visible.length - 1; k >= 0; k--) {
          var victim = self.scene.objects[visible[k]];
          self.renderer.releaseObject(victim);
          self.scene.remove(visible[k]);
        }
        self.scene.add(merged);
      });
      self.refreshObjects();
      self.refreshStatus();
      self.dirtySinceSave = true;
      self.needsRender = true;
      UI.toast('Merged into ' + S.formatCount(merged.mesh.liveTris) + ' triangles', 'ok');
    });
  };

  A.undo = function () {
    var entry = this.history.undo();
    if (!entry) { UI.toast('Nothing to undo'); return; }
    this.refreshObjects();
    this.refreshStatus();
    this.needsRender = true;
    this.dirtySinceSave = true;
  };

  A.redo = function () {
    var entry = this.history.redo();
    if (!entry) { UI.toast('Nothing to redo'); return; }
    this.refreshObjects();
    this.refreshStatus();
    this.needsRender = true;
    this.dirtySinceSave = true;
  };

  /* ================================================================ *
   * mesh commands
   * ================================================================ */

  A.withMesh = function (label, fn, busyText) {
    var self = this;
    var obj = this.scene.current();
    if (!obj) { UI.toast('No object selected', 'bad'); return; }
    var run = function (report) {
      return self.history.runMeshOp(obj, label, function () { return fn(obj, obj.mesh, report); });
    };
    if (busyText) {
      UI.busy(busyText, '', run, function (result, ms) {
        self.afterMeshOp(obj);
        if (result && result.message) UI.toast(result.message + ' in ' + UI.formatMs(ms), 'ok', 3600);
      });
    } else {
      var t0 = performance.now();
      var result = run(function () {});
      this.afterMeshOp(obj);
      if (result && result.message) UI.toast(result.message + ' in ' + UI.formatMs(performance.now() - t0), 'ok', 3600);
    }
  };

  A.afterMeshOp = function (obj) {
    obj.mesh.topoDirty = true;
    obj.mesh.dirtyMinVert = 0;
    obj.mesh.dirtyMaxVert = obj.mesh.masks.length - 1;
    this.refreshObjects();
    this.refreshStatus();
    this.dirtySinceSave = true;
    this.needsRender = true;
  };

  A.subdivide = function (smooth) {
    var self = this;
    var obj = this.scene.current();
    if (!obj) return;
    var predicted = obj.mesh.liveTris * 4;
    var budget = this.settings.triBudget || 10000;
    if (predicted > 6000000) {
      UI.toast('That would make ' + S.formatCount(predicted) + ' triangles — reduce or remesh first', 'bad', 4200);
      return;
    }
    if (predicted > budget) {
      UI.dialog({
        title: 'Over your triangle budget',
        icon: 'decimate',
        content: [
          el('p', { html: 'Subdividing would take this mesh from <b>' + S.formatCount(obj.mesh.liveTris) +
            '</b> to <b>' + S.formatCount(predicted) + '</b> triangles. Your budget is <b>' +
            S.formatCount(budget) + '</b>' + (budget <= 10000 ? ', and Roblox will not accept a MeshPart over 10,000.' : '.') }),
          el('div.hint', { text: 'You can subdivide anyway and reduce on the way out — Export \u2192 Roblox always fits the file to the budget.' })
        ],
        buttons: [
          { label: 'Cancel' },
          { label: 'Subdivide anyway', class: 'accent', onclick: function () { self.doSubdivide(smooth); } }
        ]
      });
      return;
    }
    this.doSubdivide(smooth);
  };

  A.doSubdivide = function (smooth) {
    this.withMesh(smooth ? 'Subdivide (smooth)' : 'Subdivide', function (o, mesh) {
      var before = mesh.liveTris;
      mesh.subdivide(!!smooth);
      return { message: 'Subdivided ' + S.formatCount(before) + ' → ' + S.formatCount(mesh.liveTris) + ' triangles' };
    }, 'Subdividing');
  };

  /**
   * Fix glitches.
   *
   * A way out when a sculpt has gone wrong: pull spikes back onto the
   * surface, collapse the slivers, drop triangles that have shrunk to
   * nothing, close hairline splits, and rebuild the normals. Nothing here
   * changes the shape that was meant — it removes the parts that are not
   * really surface.
   */
  A.repairSurface = function () {
    this.withMesh('Fix glitches', function (obj, mesh) {
      var beforeTris = mesh.liveTris;
      var beforeBorder = mesh.countBorderEdges();
      var beforeNon = mesh.countNonManifoldEdges();

      // needles first: every other measurement here is thrown off by them
      var spikes = mesh.relaxSpikes();
      // then the slivers, which is what a torn surface is actually made of
      var slivers = mesh.relaxSlivers();

      var avg = mesh.averageEdgeLength() || 1e-4;
      mesh.collapseTinyEdges(avg * 0.02);
      mesh.removeDegenerateTriangles(avg * avg * 1e-6);
      if (mesh.countNonManifoldEdges() > 0 || mesh.countBorderEdges() > 0) {
        // welding rebuilds the mesh from its triangle list, which is also
        // what separates the pinched vertices behind a non-manifold edge
        mesh.weld(avg * 0.02);
      }
      mesh.computeNormals();
      mesh.gridRebuild();

      var bits = [];
      if (spikes) bits.push(spikes + (spikes === 1 ? ' spike' : ' spikes') + ' pulled back');
      if (slivers) bits.push(slivers + ' sliver' + (slivers === 1 ? '' : 's') + ' relaxed');
      if (beforeTris - mesh.liveTris > 0) bits.push((beforeTris - mesh.liveTris) + ' bad triangles removed');
      if (beforeBorder - mesh.countBorderEdges() > 0) bits.push('holes closed');
      if (beforeNon - mesh.countNonManifoldEdges() > 0) bits.push('pinches separated');
      return { message: bits.length ? bits.join(', ') : 'Nothing to fix \u2014 the surface is clean',
               spikes: spikes, slivers: slivers };
    }, 'Looking for spikes, slivers and splits');
  };

  A.smoothAll = function () {
    this.withMesh('Smooth mesh', function (o, mesh) {
      mesh.smoothAll(2, 0.5, true);
      return { message: 'Smoothed the whole mesh' };
    }, 'Smoothing');
  };

  A.weld = function () {
    this.withMesh('Merge vertices', function (o, mesh) {
      var removed = mesh.weld();
      return { message: removed ? 'Merged ' + removed + ' duplicate vertices' : 'No duplicate vertices found' };
    }, 'Merging vertices');
  };

  A.recomputeNormals = function () {
    this.withMesh('Recompute normals', function (o, mesh) {
      mesh.computeNormals();
      return { message: 'Normals recomputed' };
    });
  };

  A.flipNormals = function () {
    this.withMesh('Flip normals', function (o, mesh) {
      mesh.flipNormals();
      return { message: 'Normals flipped' };
    });
  };

  A.symmetrize = function (axis, positive) {
    this.withMesh('Symmetrise', function (o, mesh) {
      mesh.symmetrize(axis, positive);
      return { message: 'Symmetrised: ' + S.formatCount(mesh.liveTris) + ' triangles' };
    }, 'Symmetrising');
  };

  A.centerOrigin = function () {
    var self = this;
    this.withMesh('Centre origin', function (o, mesh) {
      var moved = mesh.centerOrigin();
      // keep the object where it looks: shift the transform the other way
      var world = V3.create(0, 0, 0);
      V3.transformDir(world, moved, o.matrix());
      V3.add(o.position, o.position, world);
      o.touch();
      return { message: 'Origin centred' };
    });
  };

  A.applyTransform = function () {
    this.withMesh('Apply transform', function (o, mesh) {
      o.applyTransform();
      return { message: 'Transform baked into the mesh' };
    });
  };

  A.resetTransform = function () {
    var obj = this.scene.current();
    if (!obj) return;
    V3.set(obj.position, 0, 0, 0);
    Q4.identity(obj.rotation);
    V3.set(obj.scale, 1, 1, 1);
    obj.touch();
    this.refreshStatus();
    this.needsRender = true;
  };

  A.maskOp = function (op) {
    var self = this;
    var obj = this.scene.current();
    if (!obj) return;
    this.history.runMeshOp(obj, 'Mask: ' + op, function () {
      var mesh = obj.mesh;
      if (op === 'clear') mesh.setMaskAll(0);
      else if (op === 'fill') mesh.setMaskAll(1);
      else if (op === 'invert') mesh.invertMask();
      else if (op === 'smooth') mesh.smoothMask(3, 0.6);
    });
    this.afterMeshOp(obj);
  };

  /* ---- painting ----------------------------------------------------- *
   * Colour lives in an image of the object's own, not in its vertices: see
   * the paint map in the texture module for why, and the video that made
   * the case — a dirt stencil painted onto a 1,300-triangle ball came out
   * as four soft blotches, because 650 vertices is all the colour had to
   * live in.
   * ------------------------------------------------------------------- */

  /** The paint image for an object, made on demand. */
  A.ensurePaintMap = function (obj) {
    if (!obj) return null;
    if (obj.paint) return obj.paint;
    var size = S.clamp(this.settings.paintSize || 1024, 256, 2048);
    var map = new S.PaintMap(size, S.PaintMap.frameFor(obj.mesh));
    /*
     * Whatever colour the object already had comes across, so switching to
     * painting on the image never loses work — including the base colour of
     * an object that has never been painted at all.
     */
    map.bakeFromMesh(obj.mesh, obj.baseColor);
    obj.paint = map;
    return map;
  };

  /** Called as a stroke starts: a paint brush needs somewhere to paint. */
  A.preparePaint = function () {
    if (this.settings.paintTarget !== 'texture') return;
    var brush = S.brushById(this.settings.brush);
    if (!brush || !brush.paint) return;
    var obj = this.scene.current();
    if (!obj || obj.paint) return;
    this.ensurePaintMap(obj);
    this.needsRender = true;
  };

  A.dropPaintMap = function (obj) {
    obj = obj || this.scene.current();
    if (!obj || !obj.paint) return;
    var self = this;
    var keep = obj.paint;
    this.history.runSceneOp('Clear paint', function () { return { map: obj.paint }; },
      function (state) { obj.paint = state.map; self.needsRender = true; },
      function () { obj.paint = null; });
    this.needsRender = true;
    UI.toast('Paint cleared');
    return keep;
  };

  A.fillColor = function (white) {
    var self = this;
    var obj = this.scene.current();
    if (!obj) return;
    var c = white ? [1, 1, 1] : this.settings.paintColor;
    if (this.settings.paintTarget === 'texture') {
      var map = this.ensurePaintMap(obj);
      // one flat colour over the whole image, as one undo step
      var before = map.pixels.slice();
      this.history.runSceneOp(white ? 'Clear colour' : 'Fill colour',
        function () { return { pixels: before }; },
        function (state) {
          map.pixels.set(state.pixels);
          map.markDirty(0, 0, map.size - 1, map.size - 1);
          self.needsRender = true;
        },
        function () { map.fill(c[0], c[1], c[2]); });
      var after = map.pixels.slice();
      var top = this.history.undoStack[this.history.undoStack.length - 1];
      if (top && top.kind === 'scene') top.after = { pixels: after };
      this.needsRender = true;
      return;
    }
    this.history.runMeshOp(obj, 'Fill colour', function () {
      obj.mesh.setColorAll(c[0], c[1], c[2]);
    });
    this.set('vertexColors', true);
    this.afterMeshOp(obj);
  };

  A.startColorPick = function () {
    this.pickingColor = true;
    this.canvas.style.cursor = 'copy';
    UI.toast('Click the model to pick up its colour');
  };

  A.finishColorPick = function (p) {
    this.pickingColor = false;
    this.canvas.style.cursor = '';
    var hit = this.engine.pick(p.x, p.y, true);
    if (!hit) { UI.toast('Nothing there', 'bad'); return; }
    var mesh = hit.object.mesh;
    var v = mesh.tris.array[hit.tri * 3];
    var c;
    if (hit.object.paint) {
      // read the image where the tap landed, which is where the colour is
      c = [0, 0, 0];
      hit.object.paint.sample(hit.localPoint[0], hit.localPoint[1], hit.localPoint[2],
                              hit.localNormal[0], hit.localNormal[1], hit.localNormal[2], c);
    } else {
      c = [mesh.colors.array[v * 3], mesh.colors.array[v * 3 + 1], mesh.colors.array[v * 3 + 2]];
    }
    var hex = UI.rgbToHex(c);
    this.set('paintColorHex', hex);
    this.rebuildColourSwatches && this.rebuildColourSwatches();
    UI.toast('Picked ' + hex);
    this.needsRender = true;
  };

  /**
   * How much of the canvas the interface covers, so framing can keep the
   * model clear of it. The numbers follow the layout in ui.css.
   */
  A.viewInsets = function () {
    var w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    if (h > w) return { top: 66, bottom: 156, left: 10, right: 10 };   // portrait
    return { top: 62, bottom: 74, left: 74, right: 62 };
  };

  A.frameSelection = function (immediate) {
    var obj = this.scene.current();
    if (!obj) return this.frameAll(immediate);
    var mn = V3.create(0, 0, 0), mx = V3.create(0, 0, 0);
    obj.worldBounds(mn, mx);
    this.camera.frameBounds(mn, mx, immediate, this.viewInsets());
    this.needsRender = true;
  };

  A.frameAll = function (immediate) {
    var mn = V3.create(0, 0, 0), mx = V3.create(0, 0, 0);
    this.scene.bounds(mn, mx);
    this.camera.frameBounds(mn, mx, immediate, this.viewInsets());
    this.needsRender = true;
  };

  /* ================================================================ *
   * remesh / decimate
   * ================================================================ */

  A.runRemesh = function (opts) {
    var self = this;
    var obj = this.scene.current();
    if (!obj) return;
    UI.busy('Voxel remeshing', 'resolution ' + opts.resolution, function (report) {
      return self.history.runMeshOp(obj, 'Voxel remesh', function () {
        return S.Remesh.run(obj.mesh, opts, function (frac) {
          // the overlay cannot repaint mid-operation, but the text is set for
          // anything that reads the DOM (and for the tests)
          report(Math.round(frac * 100) + '%');
        });
      });
    }, function (result, ms) {
      self.afterMeshOp(obj);
      if (result && result.ok) {
        UI.toast('Remeshed: ' + S.formatCount(result.before.tris) + ' → ' +
          S.formatCount(result.after.tris) + ' triangles in ' + UI.formatMs(ms), 'ok', 4000);
      } else if (result && result.reason) {
        UI.toast(result.reason, 'bad', 4000);
      }
    });
  };

  A.runDecimate = function (target, preserveBorders) {
    var self = this;
    this.withMesh('Decimate', function (o, mesh) {
      var before = mesh.liveTris;
      mesh.decimate(target, preserveBorders);
      return { message: 'Decimated ' + S.formatCount(before) + ' → ' + S.formatCount(mesh.liveTris) + ' triangles' };
    }, 'Decimating');
  };

  /* ================================================================ *
   * import / export
   * ================================================================ */

  A.importDialog = function () {
    var self = this;
    var axis = this.settings.exportAxis;
    var fitCheck, centreCheck, replaceCheck;
    UI.dialog({
      title: 'Import a model',
      icon: 'upload',
      content: [
        el('p', { text: 'OBJ, STL (binary or ascii), PLY, glTF/GLB and .sculpt projects. Triangle soups such as STL are welded on the way in so they can be sculpted straight away.' }),
        UI.select({ label: 'Up axis', value: axis, options: S.IO.AXIS_MODES,
          onchange: function (v) { axis = v; } }),
        el('div.row.wrap', null, [
          (fitCheck = UI.check({ label: 'Scale to about one unit', value: false,
            title: 'Handy when a model arrives in millimetres or in feet' })),
          (centreCheck = UI.check({ label: 'Centre on origin', value: false }))
        ]),
        el('div.row.wrap', null, [
          (replaceCheck = UI.check({ label: 'Replace the current scene', value: false }))
        ]),
        el('div.hint', { text: 'Tap Choose files and pick the model from your phone\u2019s storage \u2014 Downloads, or wherever you saved it. The format is worked out from the file itself, so it does not matter what the file is called. On a computer you can also drag files straight onto the window.' })
      ],
      buttons: [
        { label: 'Cancel' },
        { label: 'Choose files…', class: 'accent', onclick: function () {
          UI.pickFiles('.obj,.stl,.ply,.glb,.gltf,.sculpt', true, function (files) {
            self.importFiles(files, {
              axis: axis,
              fit: fitCheck.get(),
              centre: centreCheck.get(),
              replace: replaceCheck.get()
            });
          });
        } }
      ]
    });
  };

  A.importFiles = function (files, opts) {
    var self = this;
    opts = opts || {};
    var pending = files.length;
    var results = [];
    files.forEach(function (file) {
      UI.readFile(file, function (buffer) {
        results.push({ name: file.name, buffer: buffer, size: file.size });
        if (--pending === 0) self.processImports(results, opts);
      }, function (err) {
        pending--;
        UI.toast('Could not read ' + file.name, 'bad');
        if (pending === 0 && results.length) self.processImports(results, opts);
      });
    });
  };

  A.processImports = function (files, opts) {
    var self = this;
    UI.busy('Importing', files.map(function (f) { return f.name; }).join(', '), function (report) {
      var added = [];
      var warnings = [];
      var projectLoaded = false;
      for (var i = 0; i < files.length; i++) {
        report(files[i].name);
        var res = S.IO.importBuffer(files[i].name, files[i].buffer);
        if (res.project) {
          self.applyProject(res.project);
          projectLoaded = true;
          continue;
        }
        (res.warnings || []).forEach(function (w) { warnings.push(files[i].name + ': ' + w); });
        var baseName = files[i].name.replace(/\.[^.]+$/, '');
        for (var k = 0; k < res.objects.length; k++) {
          var src = res.objects[k];
          if (!src.indices || !src.indices.length) continue;
          var mesh = new S.Mesh();
          var positions = src.positions;
          if (opts.axis === 'z') {
            positions = new Float32Array(src.positions.length);
            var tmp = [0, 0, 0];
            for (var v = 0; v < src.positions.length; v += 3) {
              S.IO.axisIn('z', src.positions[v], src.positions[v + 1], src.positions[v + 2], tmp);
              positions[v] = tmp[0]; positions[v + 1] = tmp[1]; positions[v + 2] = tmp[2];
            }
          }
          mesh.setFromArrays(positions, src.indices, { colors: src.colors, weld: true });
          if (!mesh.liveTris) continue;
          var name = res.objects.length > 1 ? baseName + ' / ' + (src.name || (k + 1)) : baseName;
          var obj = new S.SceneObject(name, mesh);
          if (opts.centre || opts.fit) {
            mesh.centerOrigin();
          }
          if (opts.fit) {
            var r = mesh.boundsRadius();
            if (r > 1e-9) {
              var s = 0.6 / r;
              var m = M4.identity(M4.create());
              m[0] = m[5] = m[10] = s;
              mesh.applyMatrix(m);
            }
          }
          added.push(obj);
        }
      }
      return { added: added, warnings: warnings, projectLoaded: projectLoaded };
    }, function (result, ms) {
      if (!result) return;
      if (result.projectLoaded && !result.added.length) return;
      if (!result.added.length) {
        self.showImportWarnings(result.warnings, 0, 0);
        return;
      }
      self.sceneOp('Import', function () {
        if (opts.replace) {
          for (var i = self.scene.objects.length - 1; i >= 0; i--) {
            self.renderer.releaseObject(self.scene.objects[i]);
            self.scene.remove(i);
          }
        }
        for (var k = 0; k < result.added.length; k++) self.scene.add(result.added[k]);
      });
      var tris = 0, verts = 0;
      result.added.forEach(function (o) { tris += o.mesh.liveTris; verts += o.mesh.liveVerts; });
      self.frameAll(true);
      self.refreshObjects();
      self.refreshStatus();
      self.dirtySinceSave = true;
      self.needsRender = true;
      UI.toast('Imported ' + result.added.length + ' object' + (result.added.length > 1 ? 's' : '') + ': ' +
        S.formatCount(tris) + ' triangles in ' + UI.formatMs(ms), 'ok', 3800);
      if (result.warnings.length) self.showImportWarnings(result.warnings, tris, verts);
    });
  };

  A.showImportWarnings = function (warnings, tris, verts) {
    if (!warnings || !warnings.length) return;
    UI.dialog({
      title: 'Import notes',
      icon: 'info',
      content: [
        tris ? el('p', { text: 'The model came in, but the reader had something to say:' })
             : el('p', { text: 'Nothing could be imported from that file.' })
      ].concat(warnings.map(function (w) { return el('div.warn', { text: w }); })),
      buttons: [{ label: 'Close', class: 'accent' }]
    });
  };

  A.exportOptions = function () {
    var st = this.settings;
    return {
      scale: st.exportScale,
      axis: st.exportAxis,
      applyTransform: true,
      includeColors: st.exportColors,
      includeNormals: st.exportNormals,
      ascii: st.exportAscii
    };
  };

  A.exportTargets = function () {
    var objs = [];
    if (this.settings.exportSelectedOnly) {
      var cur = this.scene.current();
      if (cur) objs.push(cur);
    } else {
      for (var i = 0; i < this.scene.objects.length; i++) {
        if (this.scene.objects[i].visible) objs.push(this.scene.objects[i]);
      }
    }
    return objs;
  };

  A.quickExport = function (format) {
    var self = this;
    var objs = this.exportTargets();
    if (!objs.length) { UI.toast('Nothing to export', 'bad'); return; }
    var opts = this.exportOptions();
    UI.busy('Exporting ' + format.toUpperCase(), '', function () {
      var geoms = S.IO.prepare(objs, opts);
      if (!geoms.length) throw new Error('The selected objects have no geometry.');
      var out = S.IO.exportGeoms(format, geoms, opts);
      var name = self.exportFilename(out.ext);
      var size = UI.download(out.data, name, out.mime);
      var tris = 0;
      geoms.forEach(function (g) { tris += g.triCount; });
      return { name: name, size: size, tris: tris };
    }, function (result, ms) {
      if (!result) return;
      UI.toast('Saved ' + result.name + ' — ' + S.formatCount(result.tris) + ' triangles, ' +
        S.formatBytes(result.size), 'ok', 4200);
    });
  };

  /**
   * Export a copy cut down to the triangle budget, as OBJ.
   *
   * Roblox rejects a MeshPart over 10,000 triangles, and it reads OBJ. The
   * sculpt itself is left at full detail: the reduction happens on a copy,
   * per object, so each one arrives as its own MeshPart inside the limit.
   */
  A.exportForRoblox = function (budget, withTexture) {
    var self = this;
    // Roblox's own ceiling is 10,000 per MeshPart, so this export never goes
    // above that however high the working budget is set. A lower working
    // budget is honoured, since that is what the model was made for.
    var limit = Math.min(budget || this.settings.triBudget || 10000, 10000);
    var objs = this.exportTargets();
    if (!objs.length) { UI.toast('Nothing to export', 'bad'); return; }
    UI.busy('Preparing for Roblox', 'reducing to ' + S.formatCount(limit) + ' triangles', function (report) {
      var temps = [];
      var reduced = 0, original = 0;
      for (var i = 0; i < objs.length; i++) {
        var src = objs[i];
        original += src.mesh.liveTris;
        var copy = new S.SceneObject(src.name, src.mesh.liveTris > limit ? src.mesh.clone() : src.mesh);
        V3.copy(copy.position, src.position);
        copy.rotation.set(src.rotation);
        V3.copy(copy.scale, src.scale);
        if (src.baseColor) V3.copy(copy.baseColor, src.baseColor);
        /*
         * The paint image comes with the copy. It is mapped by where the
         * surface is rather than by coordinates stored on the vertices, so
         * it still reads correctly after the copy has been reduced to fit
         * Roblox — which is the whole reason painting works this way.
         */
        copy.paint = src.paint;
        copy.touch();
        if (src.mesh.liveTris > limit) {
          report(src.name + ': ' + S.formatCount(src.mesh.liveTris) + ' \u2192 ' + S.formatCount(limit));
          copy.mesh.decimate(limit, true);
        }
        reduced += copy.mesh.liveTris;
        temps.push(copy);
      }
      var geoms = S.IO.prepare(temps, {
        scale: 1, axis: 'y', applyTransform: true,
        includeNormals: true, includeColors: false
      });
      /*
       * Roblox's mesh importer ignores vertex colour, so colour only reaches
       * the game as an image: with the texture asked for, the paint is baked
       * into a PNG and written beside the mesh, ready to upload and set as
       * the MeshPart's TextureID. Without it, the OBJ goes out on its own and
       * stays small.
       */
      if (withTexture) {
        var texOpts = {
          scale: 1, axis: 'y', applyTransform: true, includeNormals: true, includeColors: false,
          textureSize: self.settings.textureSize, cavity: self.settings.textureCavity,
          baseName: self.exportFilename('x').replace(/\.x$/, '')
        };
        report('baking the texture');
        var coloured = S.IO.prepare(temps, {
          scale: 1, axis: 'y', applyTransform: true, includeNormals: true, includeColors: true
        });
        var out = S.IO.exportTextured('obj', coloured, texOpts);
        var names = [], bytes = 0;
        for (var f = 0; f < out.files.length; f++) {
          bytes += UI.download(out.files[f].data, out.files[f].name, out.files[f].mime);
          names.push(out.files[f].name);
        }
        return { name: names.join(', '), size: bytes, original: original, reduced: reduced,
                 objects: temps.length, limit: limit };
      }
      var text = S.IO.exportOBJ(geoms, { includeNormals: true, includeColors: false });
      var name = self.exportFilename('obj');
      var size = UI.download(text, name, 'text/plain');
      return { name: name, size: size, original: original, reduced: reduced, objects: temps.length, limit: limit };
    }, function (result, ms) {
      if (!result) return;
      var over = result.reduced > result.limit;
      UI.toast('Saved ' + result.name + ' \u2014 ' +
        S.formatCount(result.original) + ' \u2192 ' + S.formatCount(result.reduced) +
        ' triangles, ' + S.formatBytes(result.size), over ? 'bad' : 'ok', 5000);
    });
  };

  A.exportFilename = function (ext) {
    var obj = this.scene.current();
    var base = (obj && obj.name ? obj.name : 'sculpt').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '');
    if (!base) base = 'sculpt';
    var d = new Date();
    function two(n) { return (n < 10 ? '0' : '') + n; }
    var stamp = d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes());
    return base + '_' + stamp + '.' + ext;
  };

  A.saveProject = function () {
    var self = this;
    UI.busy('Saving project', '', function () {
      var data = S.IO.saveProject({
        objects: self.scene.objects,
        selected: self.scene.selected,
        camera: self.camera.serialize(),
        settings: self.exportableSettings()
      });
      var name = self.exportFilename('sculpt');
      var size = UI.download(data, name, 'application/octet-stream');
      return { name: name, size: size };
    }, function (result) {
      if (!result) return;
      self.dirtySinceSave = false;
      UI.toast('Saved ' + result.name + ' (' + S.formatBytes(result.size) + ')', 'ok', 3600);
    });
  };

  A.exportableSettings = function () {
    var out = {};
    for (var k in DEFAULTS) out[k] = this.settings[k];
    return out;
  };

  A.openProject = function () {
    var self = this;
    UI.pickFiles('.sculpt', false, function (files) {
      self.importFiles(files, { replace: true });
    });
  };

  A.applyProject = function (project) {
    var self = this;
    this.transform.pending = null;
    this.transform.drag = null;
    for (var i = this.scene.objects.length - 1; i >= 0; i--) {
      this.renderer.releaseObject(this.scene.objects[i]);
    }
    this.scene.clear();
    this.history.clear();
    project.objects.forEach(function (o) {
      var mesh = new S.Mesh();
      mesh.setFromArrays(o.positions, o.indices, { colors: o.colors, weld: false });
      if (o.masks && o.masks.length === mesh.masks.length) mesh.masks.array.set(o.masks, 0);
      var obj = new S.SceneObject(o.name, mesh);
      if (o.position) V3.set(obj.position, o.position[0], o.position[1], o.position[2]);
      if (o.rotation) obj.rotation.set(o.rotation);
      if (o.scale) V3.set(obj.scale, o.scale[0], o.scale[1], o.scale[2]);
      if (o.baseColor) V3.set(obj.baseColor, o.baseColor[0], o.baseColor[1], o.baseColor[2]);
      if (o.paint) obj.paint = o.paint;
      obj.visible = o.visible !== false;
      obj.touch();
      self.scene.add(obj, false);
    });
    this.scene.selected = Math.min(project.selected || 0, Math.max(0, this.scene.objects.length - 1));
    if (project.settings) {
      for (var k in project.settings) {
        if (k in DEFAULTS && k.slice(0, 6) !== 'export') this.settings[k] = project.settings[k];
      }
      this.settings.paintColor = new Float32Array(UI.hexToRgb(this.settings.paintColorHex));
      this.renderer.setMatcap(this.settings.matcap);
      this.camera.ortho = !!this.settings.ortho;
      this.camera.fov = this.settings.fov * Math.PI / 180;
    }
    if (project.camera) this.camera.restore(project.camera);
    else this.frameAll(true);
    this.refreshObjects();
    this.refreshStatus();
    this.syncMatcaps();
    this.syncViewButtons();
    this.dirtySinceSave = false;
    this.needsRender = true;
    UI.toast('Project loaded' + (project.saved ? ' (saved ' + new Date(project.saved).toLocaleString() + ')' : ''), 'ok', 3600);
  };

  A.screenshot = function () {
    var self = this;
    this.cursor.valid = false;
    this.draw();
    this.canvas.toBlob(function (blob) {
      if (!blob) { UI.toast('Screenshot failed', 'bad'); return; }
      var name = self.exportFilename('png');
      UI.download(blob, name, 'image/png');
      UI.toast('Saved ' + name, 'ok');
    }, 'image/png');
  };

  A.loadMatcapImage = function () {
    var self = this;
    UI.pickFiles('image/*', false, function (files) {
      var url = URL.createObjectURL(files[0]);
      var img = new Image();
      img.onload = function () {
        self.renderer.setMatcap('custom', img);
        self.settings.matcap = 'custom';
        self.syncMatcaps();
        self.needsRender = true;
        URL.revokeObjectURL(url);
        UI.toast('Matcap loaded');
      };
      img.onerror = function () { UI.toast('That image could not be loaded', 'bad'); };
      img.src = url;
    });
  };
  /* ================================================================ *
   * dialogs
   * ================================================================ */

  A.dialogNew = function () {
    var self = this;
    UI.dialog({
      title: 'Start a new sculpt',
      icon: 'file',
      content: [
        el('p', { text: 'This clears the scene and the undo history. Save your project first if you want to come back to it.' })
      ],
      buttons: [
        { label: 'Cancel' },
        { label: 'Save project first', onclick: function () { self.saveProject(); } },
        { label: 'New sculpt', class: 'accent', onclick: function () { self.dialogPrimitive(true); } }
      ]
    });
  };

  A.dialogPrimitive = function (replaceScene) {
    var self = this;
    var chosen = 'sphere';
    var detailRow;
    var grid = el('div.prim-grid');
    var buttons = {};
    var iconFor = { sphere: 'sphere', uvsphere: 'uvsphere', box: 'cube', roundbox: 'roundbox',
                    cylinder: 'cylinder', cone: 'cone', torus: 'torus', capsule: 'capsule', plane: 'plane' };
    function select(id) {
      chosen = id;
      for (var k in buttons) buttons[k].classList.toggle('on', k === id);
      var entry = S.Prim.byId(id);
      detailRow.set(self.detailForBudget(entry));
      detailRow.querySelector('label').textContent = entry.detailLabel || 'Detail';
      updateEstimate();
    }
    var estimate = el('div.hint', { text: '' });
    function updateEstimate() {
      var entry = S.Prim.byId(chosen);
      var data = entry.build(detailRow.get());
      var tris = data.indices.length / 3;
      var budget = self.settings.triBudget;
      estimate.innerHTML = '<b>' + S.formatCount(tris) + '</b> triangles \u2014 your budget is ' +
        S.formatCount(budget) + '.' +
        (tris > budget ? ' <span style="color:var(--red)">Over budget; lower the detail, or reduce it afterwards.</span>' : '');
    }
    S.Prim.catalogue.forEach(function (entry) {
      var b = el('button.prim', { onclick: function () { select(entry.id); } }, [
        UI.icon(iconFor[entry.id] || 'cube'),
        el('b', { text: entry.label }),
        el('small', { text: entry.hint })
      ]);
      buttons[entry.id] = b;
      grid.appendChild(b);
    });
    detailRow = UI.slider({ label: 'Detail', min: 0, max: 12, step: 1, value: 3,
      onchange: function () { updateEstimate(); } });

    UI.dialog({
      title: replaceScene ? 'New sculpt from a primitive' : 'Add a primitive',
      icon: 'plus',
      wide: true,
      content: [grid, detailRow, estimate,
        el('div.hint', { text: replaceScene
          ? 'Sphere is the usual starting point: its triangles are all about the same size. The detail is preset to suit your triangle budget.'
          : 'Add to this sculpt drops the shape beside what you are working on and gives you the move, turn and resize handles. Place it, then tap Union to weld it in (or Join to keep it as a separate shell in the same mesh).' })],
      buttons: replaceScene ? [
        { label: 'Cancel' },
        { label: 'Start sculpting', class: 'accent', onclick: function () {
          var entry = S.Prim.byId(chosen);
          self.newScene(chosen, S.clamp(detailRow.get(), 0, entry.detailMax || 12));
        } }
      ] : [
        { label: 'Cancel' },
        { label: 'Separate object', title: 'Keep it as its own object, off to the side',
          onclick: function () {
            var entry = S.Prim.byId(chosen);
            self.addPrimitive(chosen, S.clamp(detailRow.get(), 0, entry.detailMax || 12));
          } },
        { label: 'Add to this sculpt', class: 'accent', onclick: function () {
          var entry = S.Prim.byId(chosen);
          self.insertShape(chosen, S.clamp(detailRow.get(), 0, entry.detailMax || 12));
        } }
      ]
    });
    select('sphere');
  };

  A.dialogRemesh = function () {
    var self = this;
    var obj = this.scene.current();
    if (!obj) { UI.toast('No object selected', 'bad'); return; }
    var mesh = obj.mesh;
    var open = mesh.countBorderEdges() > 0;
    var st = this.settings;
    var resRow, smoothRow, colorCheck, shellCheck, thicknessRow;
    var info = el('div.hint');
    var warn = el('div.warn', { hidden: true });

    function refresh() {
      var plan = S.Remesh.plan(mesh, resRow.get());
      var voxels = plan.samples;
      info.innerHTML = 'Voxel grid <b>' + plan.dims.join(' × ') + '</b> (' + S.formatCount(voxels) +
        ' samples), voxel size <b>' + plan.voxel.toPrecision(3) + '</b>. Expect roughly <b>' +
        S.formatCount(plan.estimateTris) + '</b> triangles.';
      var heavy = voxels > 6e6;
      warn.hidden = !(heavy || plan.clamped);
      if (plan.clamped) warn.textContent = 'That resolution needs more memory than is safe, so it has been capped at ' + plan.resolution + '.';
      else if (heavy) warn.textContent = 'This is a big grid — the app will be unresponsive for a few seconds while it works.';
      thicknessRow.style.display = shellCheck.get() ? '' : 'none';
    }

    resRow = UI.slider({ label: 'Resolution', min: 24, max: 640, step: 4, value: st.remeshResolution,
      title: 'Voxels along the longest side of the model',
      onchange: function (v) { self.set('remeshResolution', v); refresh(); } });
    smoothRow = UI.slider({ label: 'Relax passes', min: 0, max: 6, step: 1, value: st.remeshSmooth,
      title: 'Takes the staircase off the voxel surface',
      onchange: function (v) { self.set('remeshSmooth', v); } });
    colorCheck = UI.check({ label: 'Carry vertex colour over', value: true });
    shellCheck = UI.check({ label: 'Shell (solidify) instead of fill', value: open,
      title: 'For surfaces with open edges, which have no inside to fill',
      onchange: function () { refresh(); } });
    thicknessRow = UI.slider({ label: 'Thickness', min: 0.002, max: 0.2, step: 0.002,
      value: Math.max(0.01, mesh.boundsRadius() * 0.05),
      format: function (v) { return Number(v).toFixed(3); } });

    UI.dialog({
      title: 'Voxel remesh',
      icon: 'remesh',
      content: [
        el('p', { text: 'Rebuilds the surface as an even grid of triangles. Use it when sculpting has stretched the topology, or before decimating for a game.' }),
        resRow, smoothRow,
        el('div.row.wrap', null, [colorCheck, shellCheck]),
        thicknessRow,
        info, warn,
        open ? el('div.warn', { text: 'This mesh has open edges (' + mesh.countBorderEdges() +
          ' of them). Filling needs a closed surface, so shell mode is switched on for you.' }) : null,
        el('div.hint', { text: 'Current mesh: ' + S.formatCount(mesh.liveTris) + ' triangles, ' +
          S.formatCount(mesh.liveVerts) + ' vertices.' })
      ],
      buttons: [
        { label: 'Cancel' },
        { label: 'Remesh', class: 'accent', icon: 'remesh', onclick: function () {
          self.runRemesh({
            resolution: resRow.get(),
            smooth: smoothRow.get(),
            colors: colorCheck.get(),
            shell: shellCheck.get(),
            thickness: thicknessRow.get()
          });
        } }
      ]
    });
    refresh();
  };

  A.dialogDecimate = function () {
    var self = this;
    var obj = this.scene.current();
    if (!obj) { UI.toast('No object selected', 'bad'); return; }
    var current = obj.mesh.liveTris;
    var budget = this.settings.triBudget || 10000;
    // default to the budget when the mesh is over it, otherwise to half
    var target = current > budget ? budget : Math.max(100, Math.floor(current / 2));
    var info = el('div.hint');
    var targetRow, borderCheck;
    function refresh() {
      var t = targetRow.get();
      info.innerHTML = 'From <b>' + S.formatCount(current) + '</b> down to <b>' + S.formatCount(t) +
        '</b> triangles — ' + Math.round(t / current * 100) + '% of the current mesh.';
    }
    targetRow = UI.slider({ label: 'Target', min: 100, max: Math.max(1000, current), step: 100, value: target,
      format: function (v) { return S.formatCount(Number(v)); },
      onchange: function (v) { self.set('decimateTarget', v); refresh(); } });
    borderCheck = UI.check({ label: 'Keep open edges where they are', value: true });
    UI.dialog({
      title: 'Decimate',
      icon: 'decimate',
      content: [
        el('p', { text: 'Collapses the edges that change the shape least, so the silhouette survives. Roblox will not accept a MeshPart over 10,000 triangles.' }),
        targetRow,
        el('div.row.wrap', null, borderCheck),
        info,
        el('div.btn-grid.three', null, [
          UI.button('Roblox 10k', { onclick: function () { targetRow.set(Math.min(10000, current)); refresh(); } }),
          UI.button('50%', { onclick: function () { targetRow.set(Math.floor(current / 2)); refresh(); } }),
          UI.button('25%', { onclick: function () { targetRow.set(Math.floor(current / 4)); refresh(); } })
        ])
      ],
      buttons: [
        { label: 'Cancel' },
        { label: 'Decimate', class: 'accent', icon: 'decimate', onclick: function () {
          self.runDecimate(targetRow.get(), borderCheck.get());
        } }
      ]
    });
    refresh();
  };

  A.dialogExport = function () {
    var self = this;
    var st = this.settings;
    var format = st.exportFormat;
    var summary = el('div.hint');
    var note = el('div.hint');
    var asciiCheck, colorCheck, normalCheck, selectedCheck, scaleRow, axisRow, formatSeg;

    function estimateBytes(tris, verts) {
      switch (format) {
        case 'stl': return asciiCheck.get() ? tris * 260 : 84 + tris * 50;
        case 'obj': return verts * (colorCheck.get() ? 62 : 34) + (normalCheck.get() ? verts * 38 : 0) + tris * 26;
        case 'ply': return asciiCheck.get() ? verts * 60 + tris * 14 : 300 + verts * (12 + (normalCheck.get() ? 12 : 0) + (colorCheck.get() ? 3 : 0)) + tris * 13;
        default: return verts * (24 + (colorCheck.get() ? 16 : 0)) + tris * (verts > 65535 ? 12 : 6) + 2048;
      }
    }

    function refresh() {
      var objs = selectedCheck.get() ? (self.scene.current() ? [self.scene.current()] : [])
                                     : self.exportTargets();
      var tris = 0, verts = 0;
      objs.forEach(function (o) { tris += o.mesh.liveTris; verts += o.mesh.liveVerts; });
      summary.innerHTML = '<b>' + objs.length + '</b> object' + (objs.length === 1 ? '' : 's') + ', <b>' +
        S.formatCount(tris) + '</b> triangles, <b>' + S.formatCount(verts) + '</b> vertices — about <b>' +
        S.formatBytes(estimateBytes(tris, verts)) + '</b>.';
      var f = S.IO.FORMATS[format];
      note.textContent = f ? f.note : '';
      asciiCheck.parentNode.style.display = (format === 'stl' || format === 'ply') ? '' : 'none';
      colorCheck.parentNode.style.display = format === 'stl' ? '' : '';
    }

    formatSeg = UI.segment({ value: format, options: [
      { id: 'glb', label: 'GLB', title: 'glTF 2.0 binary — game engines' },
      { id: 'obj', label: 'OBJ', title: 'Wavefront OBJ — universal' },
      { id: 'ply', label: 'PLY', title: 'Stanford PLY — best vertex colour' },
      { id: 'stl', label: 'STL', title: 'STL — 3D printing' }
    ], onchange: function (v) { format = v; self.set('exportFormat', v); refresh(); } });

    scaleRow = UI.slider({ label: 'Scale', min: 0.001, max: 1000, step: 0.001, value: st.exportScale,
      format: function (v) { return '×' + Number(v).toPrecision(4); },
      title: 'Multiply every coordinate — use 100 for centimetres, 1000 for millimetres',
      onchange: function (v) { self.set('exportScale', v); } });
    axisRow = UI.select({ label: 'Up axis', value: st.exportAxis, options: S.IO.AXIS_MODES,
      onchange: function (v) { self.set('exportAxis', v); } });
    colorCheck = UI.check({ label: 'Vertex colour', value: st.exportColors,
      onchange: function (v) { self.set('exportColors', v); refresh(); } });
    normalCheck = UI.check({ label: 'Normals', value: st.exportNormals,
      onchange: function (v) { self.set('exportNormals', v); refresh(); } });
    asciiCheck = UI.check({ label: 'Text instead of binary', value: st.exportAscii,
      onchange: function (v) { self.set('exportAscii', v); refresh(); } });
    selectedCheck = UI.check({ label: 'Selected object only', value: st.exportSelectedOnly,
      onchange: function (v) { self.set('exportSelectedOnly', v); refresh(); } });

    UI.dialog({
      title: 'Export model',
      icon: 'download',
      wide: true,
      content: [
        el('div.warn.ok', { text: 'Nothing is locked, watermarked or limited here. Export as often as you like, at any resolution.' }),
        el('h4', { text: 'Format' }),
        el('div.row', null, formatSeg),
        note,
        el('h4', { text: 'Units and orientation' }),
        scaleRow, axisRow,
        el('h4', { text: 'What to include' }),
        el('div.row.wrap', null, [colorCheck, normalCheck, asciiCheck, selectedCheck]),
        el('h4', { text: 'Summary' }),
        summary,
        el('div.hint', { text: 'Object transforms are baked into the exported coordinates, so what you see is what you get.' })
      ],
      buttons: [
        { label: 'Cancel' },
        { label: 'Save project instead', icon: 'save', onclick: function () { self.saveProject(); } },
        { label: 'Export', class: 'accent', icon: 'download', onclick: function () { self.quickExport(format); } }
      ]
    });
    refresh();
  };

  A.dialogPreferences = function () {
    var self = this;
    var st = this.settings;
    UI.dialog({
      title: 'Preferences',
      icon: 'settings',
      content: [
        el('h4', { text: 'Undo history' }),
        UI.slider({ label: 'Memory', min: 64, max: 2048, step: 32, value: st.historyBudgetMB, suffix: ' MB',
          title: 'Strokes that change topology store a full snapshot, so this is the practical limit on how far back you can go',
          onchange: function (v) { self.set('historyBudgetMB', v); self.refreshStatus(); } }),
        el('div.hint', { text: 'Currently holding ' + this.history.undoStack.length + ' steps using ' +
          S.formatBytes(this.history.bytes) + '.' }),
        el('h4', { text: 'Recovery' }),
        el('div.row.wrap', null, UI.check({ label: 'Keep a recovery copy in this browser', value: st.autosave,
          onchange: function (v) { self.set('autosave', v); } })),
        el('div.hint', { text: 'Saved every two minutes while you work, and offered back the next time you open the app. It never leaves your machine.' }),
        el('h4', { text: 'Input' }),
        el('div.row.wrap', null, [
          UI.check({ label: 'One finger navigates instead of sculpting', value: st.navigateMode,
            onchange: function (v) { self.set('navigateMode', v); self.syncViewButtons(); } })
        ]),
        el('div.hint', { text: 'Right mouse or two fingers always orbit; middle mouse or three fingers pan.' }),
        el('h4', { text: 'Everything else' }),
        el('div.row', null, UI.button('Reset all settings to defaults', { class: 'grow danger', onclick: function () {
          try { root.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
          UI.toast('Settings reset — reload to apply', 'ok', 4000);
        } }))
      ],
      buttons: [{ label: 'Done', class: 'accent' }]
    });
  };

  A.dialogShortcuts = function () {
    function dl(pairs) {
      var d = el('dl');
      pairs.forEach(function (p) {
        d.appendChild(el('dt', { text: p[0] }));
        d.appendChild(el('dd', { text: p[1] }));
      });
      return d;
    }
    var brushKeys = S.BRUSHES.map(function (b) { return [b.key, b.label]; });
    UI.dialog({
      title: 'Keyboard and mouse',
      icon: 'keyboard',
      wide: true,
      content: el('div.shortcut-grid', null, [
        el('div', null, [el('h4', { text: 'Mouse' }), dl([
          ['Left drag', 'Sculpt with the current brush'],
          ['Shift + left', 'Smooth (temporary)'],
          ['Ctrl + left', 'Invert the brush'],
          ['Right drag', 'Orbit'],
          ['Middle drag', 'Pan'],
          ['Alt + left', 'Orbit'],
          ['Space + left', 'Pan'],
          ['Wheel', 'Zoom'],
          ['Shift + wheel', 'Brush radius'],
          ['Ctrl + wheel', 'Brush strength']
        ])]),
        el('div', null, [el('h4', { text: 'Touch' }), dl([
          ['One finger', 'Sculpt'],
          ['Two fingers', 'Orbit and pinch to zoom'],
          ['Three fingers', 'Pan'],
          ['Orbit button', 'Make one finger navigate instead']
        ]), el('h4', { text: 'View' }), dl([
          ['F', 'Frame the selected object'],
          ['Shift + F', 'Frame everything'],
          ['Alt + 1…7', 'Front, back, left, right, top, bottom, 3/4'],
          ['W', 'Wireframe'],
          ['Shift + W', 'Flat shading'],
          ['Shift + G', 'Grid'],
          ['Shift + O', 'Orthographic']
        ])]),
        el('div', null, [el('h4', { text: 'Brushes' }), dl(brushKeys)]),
        el('div', null, [el('h4', { text: 'Tools and files' }), dl([
          ['[ / ]', 'Brush radius'],
          ['{ / }', 'Brush strength'],
          ['X / Y / Z', 'Toggle mirroring on that axis'],
          ['D', 'Dynamic topology on or off'],
          ['Ctrl + Z / Ctrl + Shift + Z', 'Undo / redo'],
          ['Ctrl + R', 'Voxel remesh'],
          ['Ctrl + D', 'Subdivide'],
          ['Shift + A', 'Add a primitive'],
          ['Ctrl + I', 'Import a model'],
          ['Ctrl + E', 'Export a model'],
          ['Ctrl + S', 'Save the project'],
          ['Ctrl + O', 'Open a project'],
          ['Ctrl + P', 'Screenshot'],
          ['Esc', 'Cancel the stroke, close menus'],
          ['?', 'This list']
        ])])
      ]),
      buttons: [{ label: 'Close', class: 'accent' }]
    });
  };

  A.dialogPipeline = function () {
    UI.dialog({
      title: 'Getting a sculpt into a game',
      icon: 'cube',
      wide: true,
      content: [
        el('h4', { text: '1. Sculpt freely, then rebuild the topology' }),
        el('p', { text: 'Dynamic topology gives you detail where you need it but leaves uneven triangles. Run a voxel remesh (Ctrl+R) when the surface gets messy, and again before you export.' }),
        el('h4', { text: '2. Decimate to a budget' }),
        el('p', { text: 'A character for a real-time game usually wants somewhere between 5k and 60k triangles. Decimate collapses the least important edges first, so the silhouette survives. Export one file per level of detail by decimating to 100%, 50% and 20% in turn.' }),
        el('h4', { text: '3. Export GLB' }),
        el('p', { html: 'GLB is one self-contained binary: geometry, normals, vertex colours and a PBR material in a single file. It is the format Three.js, Unity, Godot and Unreal all read without a plugin.' }),
        el('h4', { text: 'Three.js' }),
        el('p', { html: 'Load it with <code>GLTFLoader</code>:' }),
        el('pre', { style: { background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: '7px', padding: '10px', overflowX: 'auto', fontSize: '11.5px' } },
          el('code', { text: "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';\n\nnew GLTFLoader().load('models/hero.glb', (gltf) => {\n  const mesh = gltf.scene;\n  mesh.traverse((n) => { if (n.isMesh) n.castShadow = true; });\n  scene.add(mesh);\n});" })),
        el('p', { html: 'If your material uses vertex colours, set <code>material.vertexColors = true</code> — the exporter writes them as <code>COLOR_0</code>.' }),
        el('h4', { text: 'Axes and units' }),
        el('p', { text: 'SculptFree, glTF, Three.js and Unity are all Y-up, so leave the up axis alone for those. Choose Z-up for Blender, 3ds Max or Godot. The scale multiplier is there for engines that work in centimetres (×100) or millimetres (×1000).' }),
        el('h4', { text: 'What about UVs and texturing?' }),
        el('p', { text: 'There is no UV unwrapper here — that is a different tool. Vertex colours carry through to GLB and PLY, which is enough for stylised and low-poly work. For texture maps, export the GLB and unwrap it in Blender.' })
      ],
      buttons: [{ label: 'Close', class: 'accent' }]
    });
  };

  A.dialogAbout = function () {
    var info = {};
    try { info = this.renderer.contextInfo(); } catch (e) {}
    UI.dialog({
      title: 'About SculptFree',
      icon: 'brand',
      content: [
        el('p', { html: '<b>SculptFree ' + S.VERSION + '</b> — a digital sculpting app that runs in a browser, in one HTML file, with no account, no network and no paywall.' }),
        el('div.warn.ok', { text: 'Import and export are free and unlimited: OBJ, STL, PLY and GLB, in and out, at any triangle count.' }),
        el('h4', { text: 'What is in it' }),
        el('p', { text: '21 brushes with symmetry, masking, stencils and vertex painting; dynamic topology; voxel remeshing; Loop subdivision; quadric decimation; booleans; a multi-object scene with transforms; baked textures; undo that covers topology changes; and its own WebGL2 renderer with generated matcaps, so there are no assets to download.' }),
        el('h4', { text: 'Your work stays on your machine' }),
        el('p', { text: 'Nothing is uploaded anywhere. The recovery copy lives in this browser’s own storage, and projects are saved to files you keep.' }),
        el('h4', { text: 'This machine' }),
        el('dl.kv', null, [
          el('dt', { text: 'Renderer' }), el('dd', { text: info.renderer || 'unknown' }),
          el('dt', { text: 'Max texture' }), el('dd', { text: (info.maxTextureSize || '?') + ' px' })
        ])
      ],
      buttons: [{ label: 'Close', class: 'accent' }]
    });
  };

  /* ================================================================ *
   * recovery copy in IndexedDB
   * ================================================================ */

  A.withDB = function (mode, fn) {
    if (!root.indexedDB) return;
    try {
      var req = root.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () {
        var db = req.result;
        try {
          var tx = db.transaction(DB_STORE, mode);
          fn(tx.objectStore(DB_STORE), db);
        } catch (e) { db.close(); }
      };
      req.onerror = function () { /* storage unavailable: not fatal */ };
    } catch (e) { /* ignore */ }
  };

  A.maybeAutosave = function (now) {
    if (!this.settings.autosave || !this.dirtySinceSave) return;
    if (this.engine.active) return;
    if (now - this.lastAutosave < 120000) return;
    this.lastAutosave = now;
    this.writeAutosave();
  };

  A.writeAutosave = function () {
    var self = this;
    if (!this.scene.objects.length) return;
    var total = this.scene.totals();
    if (total.verts > 3000000) return;       // too big to be worth blocking on
    try {
      var data = S.IO.saveProject({
        objects: this.scene.objects,
        selected: this.scene.selected,
        camera: this.camera.serialize(),
        settings: this.exportableSettings()
      });
      this.withDB('readwrite', function (store) {
        store.put({ data: data, time: Date.now(), tris: total.tris, objects: total.objects }, 'autosave');
      });
    } catch (e) { /* ignore */ }
  };

  A.restoreAutosaveOffer = function () {
    var self = this;
    if (!this.settings.autosave) return;
    this.withDB('readonly', function (store) {
      var get = store.get('autosave');
      get.onsuccess = function () {
        var rec = get.result;
        if (!rec || !rec.data) return;
        var when = new Date(rec.time);
        var age = Date.now() - rec.time;
        if (age > 1000 * 60 * 60 * 24 * 30) return;
        UI.dialog({
          title: 'Recover your last sculpt?',
          icon: 'reset',
          content: [
            el('p', { text: 'A recovery copy from ' + when.toLocaleString() + ' is in this browser: ' +
              S.formatCount(rec.tris || 0) + ' triangles across ' + (rec.objects || 1) + ' object(s).' }),
            el('div.hint', { text: 'Recovering replaces the scene you are looking at now.' })
          ],
          buttons: [
            { label: 'Start fresh' },
            { label: 'Discard the copy', class: 'danger', onclick: function () {
              self.withDB('readwrite', function (s2) { s2.delete('autosave'); });
            } },
            { label: 'Recover', class: 'accent', onclick: function () {
              var project = S.IO.loadProject(rec.data);
              if (project.ok) self.applyProject(project);
              else UI.toast('The recovery copy could not be read', 'bad');
            } }
          ]
        });
      };
    });
  };

  /* ================================================================ *
   * boot
   * ================================================================ */

  S.boot = function (mount) {
    var host = mount || document.body;
    try {
      var probe = document.createElement('canvas');
      if (!probe.getContext('webgl2')) throw new Error('no webgl2');
    } catch (e) {
      host.innerHTML = '<div style="max-width:560px;margin:14vh auto;padding:0 22px;font:14px/1.6 system-ui,sans-serif;color:#e8edf4">' +
        '<h1 style="font-size:20px">SculptFree needs WebGL 2</h1>' +
        '<p style="color:#8b96a6">This browser cannot open a WebGL 2 context, so the sculpting view has nothing to draw on. ' +
        'Any current version of Chrome, Edge, Firefox or Safari will work. On a desktop it is worth checking that hardware acceleration is switched on.</p></div>';
      return null;
    }
    var app = new App(host);
    root.SCULPT_APP = app;            // the browser tests drive the app through this
    return app;
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { S.boot(); });
    } else {
      S.boot();
    }
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
