/*
 * SculptFree — brush presets.
 *
 * A preset is a named bundle of brush settings: which brush, how big, how
 * strong, which stencil, whether it stamps once or draws. The built-in ones
 * are the setups a game model actually needs — block out the form, cut a
 * panel, scatter rivets, dust dirt into the recesses — and anything you dial
 * in yourself can be saved beside them and comes back next time.
 *
 * Presets are just settings, so applying one is a handful of assignments and
 * nothing here needs to know about meshes or the interface.
 */
(function (root) {
  'use strict';

  var S = root.SCULPT;
  var P = S.Presets = {};

  /* The settings a preset carries. Anything outside this list (the triangle
   * budget, mirroring, the camera) belongs to the model, not to the brush,
   * and is deliberately left alone. */
  P.KEYS = [
    'brush', 'radius', 'strength', 'falloff', 'spacing', 'autoSmooth', 'strokeSmoothing',
    'clayOffset', 'alpha', 'stampMode', 'alphaFollowStroke', 'alphaRandomRotate',
    'paintColorHex', 'frontFacing', 'dyntopo'
  ];

  P.BUILTIN = [
    { id: 'blockout', label: 'Block out', hint: 'Big soft clay for the first shapes',
      settings: { brush: 'clay', radius: 95, strength: 0.6, falloff: 'smooth', spacing: 0.16,
                  autoSmooth: 0.35, alpha: 'none', stampMode: false, dyntopo: false } },
    { id: 'refine', label: 'Refine form', hint: 'Smaller clay, gentler, for shaping',
      settings: { brush: 'clay', radius: 70, strength: 0.4, falloff: 'smooth', spacing: 0.12,
                  autoSmooth: 0.3, alpha: 'none', stampMode: false } },
    { id: 'smoothpass', label: 'Smooth pass', hint: 'Relax the surface without losing volume',
      settings: { brush: 'smooth', radius: 95, strength: 0.5, falloff: 'smooth', spacing: 0.1,
                  autoSmooth: 0, alpha: 'none', stampMode: false } },
    { id: 'hardsurface', label: 'Hard surface', hint: 'Trim Normal, flat and decisive',
      settings: { brush: 'trimnormal', radius: 95, strength: 0.85, falloff: 'linear', spacing: 0.08,
                  autoSmooth: 0, alpha: 'none', stampMode: false } },
    { id: 'panelcut', label: 'Panel cut', hint: 'A square stamp that presses one panel in',
      settings: { brush: 'trimdynamic', radius: 90, strength: 0.9, falloff: 'linear', spacing: 0.08,
                  autoSmooth: 0, alpha: 'square', stampMode: true, alphaFollowStroke: false,
                  alphaRandomRotate: false } },
    { id: 'sharpcrease', label: 'Sharp crease', hint: 'Cut a hard line — seams, mouths, panel gaps',
      settings: { brush: 'crease', radius: 34, strength: 0.6, falloff: 'sharp', spacing: 0.06,
                  autoSmooth: 0, alpha: 'none', stampMode: false } },
    { id: 'rocks', label: 'Rocky detail', hint: 'Gravel stamped along the stroke',
      settings: { brush: 'draw', radius: 90, strength: 0.4, falloff: 'smooth', spacing: 0.3,
                  autoSmooth: 0, alpha: 'gravel', stampMode: false, alphaRandomRotate: true } },
    { id: 'rivets', label: 'Rivets', hint: 'One dome per tap, for bolts and studs',
      settings: { brush: 'draw', radius: 26, strength: 0.7, falloff: 'smooth', spacing: 0.5,
                  autoSmooth: 0, alpha: 'rivet', stampMode: true, alphaFollowStroke: false } },
    { id: 'scratches', label: 'Scratches', hint: 'Fine scraped lines',
      settings: { brush: 'draw', radius: 60, strength: 0.25, falloff: 'smooth', spacing: 0.25,
                  autoSmooth: 0, alpha: 'scratches', stampMode: false, alphaFollowStroke: true } },
    { id: 'cracked', label: 'Cracked', hint: 'Broken, weathered surface',
      settings: { brush: 'draw', radius: 95, strength: 0.3, falloff: 'smooth', spacing: 0.35,
                  autoSmooth: 0, alpha: 'cracks', stampMode: false, alphaRandomRotate: true } },
    { id: 'dirtpaint', label: 'Dirt paint', hint: 'Dusty brown through a grain stencil',
      settings: { brush: 'paint', radius: 95, strength: 0.4, falloff: 'smooth', spacing: 0.2,
                  alpha: 'dirt', stampMode: false, alphaRandomRotate: true,
                  paintColorHex: '#6b5238' } },
    { id: 'basecolour', label: 'Base colour', hint: 'Solid paint with no stencil',
      settings: { brush: 'paint', radius: 95, strength: 0.7, falloff: 'smooth', spacing: 0.12,
                  alpha: 'none', stampMode: false, paintColorHex: '#d94f3d' } }
  ];

  P.builtinById = function (id) {
    for (var i = 0; i < P.BUILTIN.length; i++) if (P.BUILTIN[i].id === id) return P.BUILTIN[i];
    return null;
  };

  /** Take the current settings as a preset. */
  P.capture = function (settings, label) {
    var out = {};
    for (var i = 0; i < P.KEYS.length; i++) {
      var k = P.KEYS[i];
      if (settings[k] !== undefined) out[k] = settings[k];
    }
    return {
      id: 'user-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1296).toString(36),
      label: label || 'My preset',
      user: true,
      settings: out
    };
  };

  /**
   * Write a preset's settings through `set` (so the app can react to each
   * one). Returns the keys that actually changed.
   */
  P.apply = function (preset, settings, set) {
    var changed = [];
    if (!preset || !preset.settings) return changed;
    for (var i = 0; i < P.KEYS.length; i++) {
      var k = P.KEYS[i];
      var v = preset.settings[k];
      if (v === undefined) continue;
      if (settings[k] === v) continue;
      if (set) set(k, v); else settings[k] = v;
      changed.push(k);
    }
    return changed;
  };

  /** A one-line summary for the interface. */
  P.describe = function (preset) {
    if (!preset) return '';
    var s = preset.settings || {};
    var bits = [];
    if (s.brush) {
      var b = S.brushById ? S.brushById(s.brush) : null;
      bits.push(b ? b.label : s.brush);
    }
    if (s.radius !== undefined) bits.push(Math.round(s.radius) + ' px');
    if (s.strength !== undefined) bits.push(Math.round(s.strength * 100) + '%');
    if (s.alpha && s.alpha !== 'none') {
      bits.push((S.Alpha && S.Alpha.labelOf ? S.Alpha.labelOf(s.alpha) : s.alpha) +
                (s.stampMode ? ' stamp' : ' stencil'));
    } else if (s.stampMode) {
      bits.push('one dab per press');
    }
    return bits.join(' · ');
  };

  /* ---------------------------------------------------------------- *
   * saving
   * ---------------------------------------------------------------- */

  var STORAGE_KEY = 'sculptfree.presets.v1';
  P.STORAGE_KEY = STORAGE_KEY;

  /** Read the saved presets. A missing or corrupt store is simply empty. */
  P.load = function (storage) {
    try {
      var raw = storage && storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (!p || typeof p !== 'object' || !p.settings) continue;
        var clean = {};
        for (var k in p.settings) {
          if (P.KEYS.indexOf(k) >= 0) clean[k] = p.settings[k];
        }
        out.push({ id: p.id || ('user-' + i), label: String(p.label || 'Preset'), user: true, settings: clean });
      }
      return out;
    } catch (e) { return []; }
  };

  P.save = function (storage, list) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(list.map(function (p) {
        return { id: p.id, label: p.label, settings: p.settings };
      })));
      return true;
    } catch (e) { return false; }
  };

  /** Built-ins first, then anything saved. */
  P.all = function (userList) {
    return P.BUILTIN.concat(userList || []);
  };

  P.byId = function (id, userList) {
    var all = P.all(userList);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
