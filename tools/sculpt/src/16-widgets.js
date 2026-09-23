/*
 * SculptFree — DOM helpers, icons and the small widget set the panels are
 * built from. Nothing here knows about sculpting; it is the toolkit the app
 * module assembles the interface out of.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var UI = S.UI = {};

  /* ---------------------------------------------------------------- *
   * element helper
   * ---------------------------------------------------------------- */

  /**
   * el('div.row', {onclick: fn}, [children])
   * The tag may carry #id and .class shorthands, in either order:
   * 'button#save.btn.accent' and 'button.btn#save' both work.
   */
  function el(spec, props, children) {
    spec = spec || 'div';
    var tagMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(spec);
    var node = document.createElement(tagMatch ? tagMatch[0] : 'div');
    var rest = spec.slice(tagMatch ? tagMatch[0].length : 0);
    var token = /([#.])([^#.\s]+)/g, t;
    var classes = [];
    while ((t = token.exec(rest))) {
      if (t[1] === '#') node.id = t[2];
      else classes.push(t[2]);
    }
    if (classes.length) node.className = classes.join(' ');
    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (v === undefined || v === null) continue;
        if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'class') node.className += (node.className ? ' ' : '') + v;
        else if (k === 'style' && typeof v === 'object') { for (var s in v) node.style[s] = v[s]; }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k in node && k !== 'list' && k !== 'type' && k !== 'size') {
          try { node[k] = v; } catch (e) { node.setAttribute(k, v); }
        } else node.setAttribute(k, v);
      }
    }
    if (children) UI.append(node, children);
    return node;
  }
  UI.el = el;

  UI.append = function (node, children) {
    if (children === null || children === undefined) return node;
    if (Array.isArray(children)) {
      for (var i = 0; i < children.length; i++) UI.append(node, children[i]);
      return node;
    }
    if (typeof children === 'string' || typeof children === 'number') {
      node.appendChild(document.createTextNode(String(children)));
      return node;
    }
    node.appendChild(children);
    return node;
  };

  UI.clear = function (node) { while (node.firstChild) node.removeChild(node.firstChild); return node; };

  /* ---------------------------------------------------------------- *
   * icons — single-path line glyphs, 24x24
   * ---------------------------------------------------------------- */

  var ICONS = {
    brand: 'M12 2.6 20.4 12 12 21.4 3.6 12Z M12 2.6v18.8 M3.6 12h16.8',
    // brushes
    clay: 'M5 17c0-4 3-8 7-8s7 3 7 7c0 2-2 2-4 2H8c-2 0-3 0-3-1Z M9 9c0-2 1-4 3-4',
    claystrips: 'M4 9h16 M4 13h16 M4 17h16 M6 5h12',
    draw: 'M4 19 8 18l9.5-9.5a2.1 2.1 0 0 0-3-3L5 15Z M14 6.5l3 3',
    inflate: 'M12 4v4 M12 20v-4 M4 12h4 M20 12h-4 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
    blob: 'M12 3c4 0 7 3 7 7.5S15 21 12 21s-7-4-7-10.5S8 3 12 3Z',
    crease: 'M3 20 12 5l9 15 M12 5v15',
    layer: 'M4 8h16v3H4Z M6 14h12v3H6Z',
    smooth: 'M3 15c3 0 4.5-6 9-6s6 6 9 6 M3 19h18',
    flatten: 'M3 14h18 M6 9c2 2 4 2 6 0s4-2 6 0',
    trimdynamic: 'M20.5 8.5H3.5 M12 21a9 9 0 0 1-8.5-12.5 M12 21a9 9 0 0 0 8.5-12.5 M4 6l3-3',
    trimnormal: 'M20.5 11H3.5 M12 21a9 9 0 0 1-8.4-10 M12 21a9 9 0 0 0 8.4-10 M12 8V2 M9.6 4.4 12 2l2.4 2.4',
    fill: 'M3 15h18 M8 15V9l4-3 4 3v6',
    scrape: 'M3 10h18 M7 15c1.5-2 3-2 5 0s3.5 2 5 0',
    pinch: 'M12 3v7 M12 21v-7 M8 10h8 M8 14h8 M9 6l3-3 3 3 M9 18l3 3 3-3',
    move: 'M12 3v18 M3 12h18 M12 3 9 6 M12 3l3 3 M12 21l-3-3 M12 21l3-3 M3 12l3-3 M3 12l3 3 M21 12l-3-3 M21 12l-3 3',
    snakehook: 'M4 20c0-6 4-9 8-9s6 2 6 5 M18 16l2 4 M18 16l-3 3',
    nudge: 'M4 12h13 M13 7l5 5-5 5 M20 5v14',
    rotate: 'M20 12a8 8 0 1 1-3-6.2 M20 4v5h-5',
    paint: 'M8 3h9a3 3 0 0 1 3 3v3H8Z M13 9v4a2 2 0 0 1-2 2h-1v6h4v-6',
    mask: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z M9 12l2 2 4-4',
    // ui
    undo: 'M4 9h10a5 5 0 0 1 0 10H8 M4 9l4-4 M4 9l4 4',
    redo: 'M20 9H10a5 5 0 0 0 0 10h6 M20 9l-4-4 M20 9l-4 4',
    check: 'M4 12.5 9 18 20 6',
    chevron: 'M8 10l4 4 4-4',
    close: 'M6 6l12 12 M18 6 6 18',
    eye: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
    eyeOff: 'M3 3l18 18 M10.5 6.3A9.7 9.7 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-2.6 3.1 M6.6 7.6C4 9.4 2 12 2 12s3.6 6 10 6c1.3 0 2.4-.2 3.5-.6',
    trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14',
    copy: 'M9 9h11v11H9Z M15 5H4v11h3',
    plus: 'M12 5v14 M5 12h14',
    download: 'M12 3v13 M7 11l5 5 5-5 M4 21h16',
    upload: 'M12 21V8 M7 13l5-5 5 5 M4 3h16',
    save: 'M5 3h11l3 3v15H5Z M8 3v6h7V3 M8 14h8v7H8Z',
    folder: 'M3 7h6l2 3h10v10H3Z',
    camera: 'M3 8h4l2-3h6l2 3h4v12H3Z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    grid: 'M3 9h18 M3 15h18 M9 3v18 M15 3v18',
    wire: 'M12 3 3 8v8l9 5 9-5V8Z M3 8l9 5 9-5 M12 13v8',
    cube: 'M12 3 3 8v8l9 5 9-5V8Z M3 8l9 5 9-5 M12 13v8',
    sphere: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M3.5 10c3 2.5 14 2.5 17 0 M12 3c-3 3-3 15 0 18',
    uvsphere: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M3.5 9h17 M3.5 15h17 M12 3c-3.5 4-3.5 14 0 18 M12 3c3.5 4 3.5 14 0 18',
    cylinder: 'M6 6c0-1.6 2.7-3 6-3s6 1.4 6 3v12c0 1.6-2.7 3-6 3s-6-1.4-6-3Z M6 6c0 1.7 2.7 3 6 3s6-1.3 6-3',
    cone: 'M12 3 20 20H4Z M4 20c0 1.1 3.6 2 8 2s8-.9 8-2',
    torus: 'M12 5c5 0 9 3 9 7s-4 7-9 7-9-3-9-7 4-7 9-7Z M12 10c2.2 0 4 .9 4 2s-1.8 2-4 2-4-.9-4-2 1.8-2 4-2Z',
    capsule: 'M8 8a4 4 0 0 1 8 0v8a4 4 0 0 1-8 0Z',
    plane: 'M2 16 12 9l10 7-10 4Z',
    roundbox: 'M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z M4 9h16 M9 4v16',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M9.5 9.5a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2-2.5 3.6 M12 17.5v.2',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 2.1 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.1a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 19.9 11a2 2 0 1 1 0 4Z',
    sliders: 'M4 8h10 M18 8h2 M4 16h4 M12 16h8 M15 5v6 M9 13v6',
    palette: 'M12 3a9 9 0 0 0 0 18c1.7 0 1.5-2 2.6-3s3.4 0 3.4-2.5A9 9 0 0 0 12 3Z M8 9v.2 M7 13v.2 M11 7v.2 M15 8v.2',
    symmetry: 'M12 3v18 M8 7 3 12l5 5 M16 7l5 5-5 5',
    layers: 'M12 3 3 7.5 12 12l9-4.5Z M3 12.5 12 17l9-4.5 M3 17 12 21.5 21 17',
    frame: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
    keyboard: 'M3 7h18v10H3Z M7 11v.1 M11 11v.1 M15 11v.1 M17 11v.1 M7 14h10',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 11v6 M12 7.5v.2',
    remesh: 'M4 4h7v7H4Z M13 4h7v7h-7Z M4 13h7v7H4Z M13 13h7v7h-7Z',
    subdivide: 'M3 3h18v18H3Z M3 12h18 M12 3v18 M3 7.5h18 M3 16.5h18 M7.5 3v18 M16.5 3v18',
    decimate: 'M3 20 12 4l9 16Z M12 4v16 M7 12h10',
    mirror: 'M12 2v20 M9 6 4 12l5 6 M15 6l5 6-5 6',
    orbit: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M3.5 12c0-2.2 3.8-4 8.5-4s8.5 1.8 8.5 4-3.8 4-8.5 4-8.5-1.8-8.5-4Z',
    hand: 'M8 12V6.5a1.6 1.6 0 0 1 3.2 0V11 M11.2 11V5.6a1.6 1.6 0 0 1 3.2 0V11 M14.4 11V7.2a1.6 1.6 0 0 1 3.2 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-3.2a1.6 1.6 0 0 1 3.2 0',
    file: 'M6 3h8l4 4v14H6Z M14 3v4h4',
    menu: 'M4 7h16 M4 12h16 M4 17h16',
    boolean: 'M9.5 15.5a6 6 0 1 1 0-11 6 6 0 0 1 0 11Z M14.5 4.5a6 6 0 1 1 0 11 6 6 0 0 1 0-11Z',
    radius: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
    strength: 'M12 3v9 M8.5 8.5 12 12l3.5-3.5 M5 19h14',
    reset: 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5',
    add: 'M12 3.2a8.8 8.8 0 1 0 0 17.6 8.8 8.8 0 0 0 0-17.6Z M12 7.6v8.8 M7.6 12h8.8',
    gizmo: 'M12 12V3 M12 12H3.5 M12 12l6.5 6.5 M12 3l-2.2 2.2 M12 3l2.2 2.2 M3.5 12l2.2-2.2 M3.5 12l2.2 2.2 M18.5 18.5h-3.1 M18.5 18.5v-3.1',
    scale: 'M5 19V5h14 M5 19h6 M9 15l10-10 M19 5v5 M19 5h-5',
    stencil: 'M4 4h16v16H4Z M8 8.5v.2 M12 7v.2 M16 9v.2 M9.5 12v.2 M14 12.5v.2 M7.5 16v.2 M12 16.5v.2 M16.5 15.5v.2',
    star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8Z',
    image: 'M3 5h18v14H3Z M3 16l5-5 4 4 3-3 6 6 M15.5 8.5v.2',
    texture: 'M3 3h18v18H3Z M3 9h18 M3 15h18 M9 3v18 M15 3v18'
  };
  UI.ICONS = ICONS;

  UI.icon = function (name, size) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
    var d = ICONS[name] || ICONS.info;
    var parts = d.split(' M');
    for (var i = 0; i < parts.length; i++) {
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', (i === 0 ? '' : 'M') + parts[i]);
      svg.appendChild(path);
    }
    return svg;
  };

  /* ---------------------------------------------------------------- *
   * widgets
   * ---------------------------------------------------------------- */

  /**
   * Slider with a numeric field.
   * opts: {label, min, max, step, value, format, onchange, suffix}
   */
  UI.slider = function (opts) {
    var range = el('input', { type: 'range', min: opts.min, max: opts.max,
                              step: opts.step === undefined ? 1 : opts.step, value: opts.value });
    var num = el('input.num', { type: 'text', value: format(opts.value) });
    function format(v) {
      if (opts.format) return opts.format(v);
      var step = opts.step === undefined ? 1 : opts.step;
      var dp = step >= 1 ? 0 : (String(step).split('.')[1] || '').length;
      return Number(v).toFixed(dp) + (opts.suffix || '');
    }
    function emit(v, fromText) {
      v = S.clamp(Number(v), opts.min, opts.max);
      if (isNaN(v)) return;
      range.value = v;
      if (!fromText) num.value = format(v);
      if (opts.onchange) opts.onchange(v);
    }
    range.addEventListener('input', function () { num.value = format(range.value); if (opts.onchange) opts.onchange(Number(range.value)); });
    num.addEventListener('change', function () { emit(parseFloat(num.value), false); });
    num.addEventListener('blur', function () { num.value = format(range.value); });
    var row = el('div.row', null, [
      opts.label ? el('label', { text: opts.label, title: opts.title || '' }) : null,
      el('div.slider', null, [range, num])
    ]);
    row.set = function (v) { range.value = v; num.value = format(v); };
    row.get = function () { return Number(range.value); };
    return row;
  };

  /** Checkbox styled as a small square with a tick. */
  UI.check = function (opts) {
    var input = el('input', { type: 'checkbox', checked: !!opts.value });
    input.addEventListener('change', function () { if (opts.onchange) opts.onchange(input.checked); });
    var label = el('label.check', { title: opts.title || '' }, [
      input, el('span.box', null, UI.icon('check')), el('span', { text: opts.label })
    ]);
    label.set = function (v) { input.checked = !!v; };
    label.get = function () { return input.checked; };
    return label;
  };

  /** Segmented button group. options: [{id, label, title}] */
  UI.segment = function (opts) {
    var buttons = {};
    var wrap = el('div.seg');
    (opts.options || []).forEach(function (o) {
      var b = el('button', { text: o.label, title: o.title || '', onclick: function () {
        wrap.set(o.id);
        if (opts.onchange) opts.onchange(o.id);
      } });
      buttons[o.id] = b;
      wrap.appendChild(b);
    });
    wrap.set = function (id) {
      for (var k in buttons) buttons[k].classList.toggle('on', k === id);
      wrap.value = id;
    };
    wrap.set(opts.value);
    return opts.label ? (function () {
      var row = el('div.row', null, [el('label', { text: opts.label }), wrap]);
      row.set = wrap.set;
      return row;
    })() : wrap;
  };

  /** Dropdown. options: [{id, label}] */
  UI.select = function (opts) {
    var sel = el('select');
    (opts.options || []).forEach(function (o) {
      sel.appendChild(el('option', { value: o.id, text: o.label }));
    });
    sel.value = opts.value;
    sel.addEventListener('change', function () { if (opts.onchange) opts.onchange(sel.value); });
    if (!opts.label) return sel;
    var row = el('div.row', null, [el('label', { text: opts.label }), sel]);
    row.set = function (v) { sel.value = v; };
    row.get = function () { return sel.value; };
    row.select = sel;
    return row;
  };

  UI.button = function (label, opts) {
    opts = opts || {};
    var b = el('button.btn' + (opts.class ? '.' + opts.class.split(' ').join('.') : ''), {
      title: opts.title || '', onclick: opts.onclick, disabled: !!opts.disabled
    }, [opts.icon ? UI.icon(opts.icon) : null, label ? el('span', { text: label }) : null]);
    return b;
  };

  /** Collapsible panel section. */
  UI.section = function (title, iconName, opts) {
    opts = opts || {};
    var body = el('div.body');
    var chev = UI.icon('chevron');
    chev.classList.add('chev');
    var sec = el('div.section' + (opts.closed ? '.closed' : ''), null, [
      el('header', { onclick: function () {
        sec.classList.toggle('closed');
        if (opts.onToggle) opts.onToggle(!sec.classList.contains('closed'));
      } }, [iconName ? UI.icon(iconName) : null, el('span', { text: title }), chev]),
      body
    ]);
    sec.body = body;
    sec.add = function (child) { UI.append(body, child); return sec; };
    return sec;
  };

  /* ---------------------------------------------------------------- *
   * dialogs, toasts, busy overlay
   * ---------------------------------------------------------------- */

  /**
   * Modal dialog. opts: {title, icon, wide, content, buttons:[{label, class,
   * onclick, keepOpen}], onClose}
   * Returns an object with close().
   */
  UI.dialog = function (opts) {
    var backdrop = el('div.backdrop');
    var api = {};
    function close() {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      document.removeEventListener('keydown', onKey, true);
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'Enter' && opts.buttons && opts.buttons.length) {
        var primary = null;
        for (var i = 0; i < opts.buttons.length; i++) if (/accent/.test(opts.buttons[i].class || '')) primary = opts.buttons[i];
        if (primary && document.activeElement && document.activeElement.tagName !== 'INPUT') {
          e.stopPropagation();
          if (primary.onclick) primary.onclick(api);
          if (!primary.keepOpen) close();
        }
      }
    }
    api.close = close;
    var footer = null;
    if (opts.buttons && opts.buttons.length) {
      footer = el('footer');
      opts.buttons.forEach(function (b) {
        footer.appendChild(UI.button(b.label, {
          class: b.class,
          icon: b.icon,
          onclick: function () {
            if (b.onclick) b.onclick(api);
            if (!b.keepOpen) close();
          }
        }));
      });
    }
    var dialog = el('div.dialog' + (opts.wide ? '.wide' : ''), null, [
      el('header', null, [
        opts.icon ? UI.icon(opts.icon) : null,
        el('span', { text: opts.title || '' }),
        el('button.icon-btn.close', { title: 'Close (Esc)', onclick: close }, UI.icon('close'))
      ]),
      el('div.content', null, opts.content),
      footer
    ]);
    backdrop.appendChild(dialog);
    backdrop.addEventListener('pointerdown', function (e) {
      if (e.target === backdrop && opts.dismissable !== false) close();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    api.element = dialog;
    return api;
  };

  UI.toast = function (message, kind, ms) {
    var host = document.getElementById('toasts');
    if (!host) return;
    var t = el('div.toast' + (kind ? '.' + kind : ''), { text: message });
    host.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s, transform .25s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(6px)';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }, ms || 2600);
    return t;
  };

  /**
   * Show the blocking "working" overlay, run `fn` after a paint so the
   * overlay is actually visible, then hide it. `fn` may return a result which
   * is passed to `then`.
   */
  UI.busy = function (what, detail, fn, then) {
    var overlay = document.getElementById('busy');
    var w = overlay.querySelector('.what');
    var d = overlay.querySelector('.detail');
    w.textContent = what;
    d.textContent = detail || '';
    overlay.hidden = false;
    // two frames: one to show the overlay, one to let it paint
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var result, error = null;
        var t0 = performance.now();
        try { result = fn(function (msg) { d.textContent = msg; }); }
        catch (err) { error = err; }
        var ms = performance.now() - t0;
        overlay.hidden = true;
        if (error) {
          console.error(error);
          UI.toast((error && error.message) || String(error), 'bad', 5000);
        } else if (then) {
          then(result, ms);
        }
      });
    });
  };

  UI.formatMs = function (ms) {
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
  };

  /* ---------------------------------------------------------------- *
   * colour helpers
   * ---------------------------------------------------------------- */

  UI.hexToRgb = function (hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return [1, 1, 1];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  };

  UI.rgbToHex = function (rgb) {
    function h(v) {
      var n = Math.round(S.clamp(v, 0, 1) * 255).toString(16);
      return n.length < 2 ? '0' + n : n;
    }
    return '#' + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
  };

  /** sRGB -> linear, so painted colours look right and export sensibly. */
  UI.srgbToLinear = function (c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  UI.linearToSrgb = function (c) {
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };

  /* ---------------------------------------------------------------- *
   * file helpers
   * ---------------------------------------------------------------- */

  UI.download = function (data, filename, mime) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 400);
    return blob.size;
  };

  /**
   * Is this a phone or a tablet? Only used to decide whether a file picker
   * should filter by extension, so a wrong guess costs nothing.
   */
  UI.isTouchDevice = function () {
    try {
      var nav = root.navigator || {};
      if (nav.maxTouchPoints > 1) return true;
      return /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '');
    } catch (e) { return false; }
  };

  /**
   * Ask for files.
   *
   * On a phone an extension filter is worse than no filter at all. Android's
   * file chooser turns `accept=".obj,.ply,.glb"` into a list of media types
   * it cannot resolve — there are no registered types for those extensions —
   * and then shows every file greyed out, or refuses the folder outright.
   * That is what "it won't let me import anything" looks like from the
   * outside. The importer works the format out from the file's own contents,
   * so dropping the filter on touch devices loses nothing and is the
   * difference between being able to import a model and not.
   *
   * A filter by media type ("image/*") is left alone: those resolve fine.
   */
  UI.pickFiles = function (accept, multiple, onFiles) {
    if (accept && accept.charAt(0) === '.' && UI.isTouchDevice()) accept = '';
    var input = el('input', { type: 'file', accept: accept, multiple: !!multiple, style: { display: 'none' } });
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      document.body.removeChild(input);
      if (files.length) onFiles(files);
    });
    input.click();
  };

  UI.readFile = function (file, onDone, onError) {
    var reader = new FileReader();
    reader.onload = function () { onDone(reader.result); };
    reader.onerror = function () { if (onError) onError(reader.error); };
    reader.readAsArrayBuffer(file);
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
