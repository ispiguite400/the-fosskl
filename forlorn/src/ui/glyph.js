/*
 * Button glyphs: what to press for an action, drawn for the device in use: a keycap, a mouse,
 * the PlayStation shapes in their colours, Xbox or Switch letters, or what the touch button says.
 * Every glyph carries its action, so refreshGlyphs() redraws them all the moment the player
 * picks up another device, in a menu or mid-round.
 *
 * Split screen: player two's glyphs (data-p="2") are drawn for player two's controller.
 */
import { input } from '../core/input.js';
import { esc } from '../core/util.js';
import { abilityIcon } from './icons.js';
import { ABILITIES } from '../game/abilities.js';

const PS_SHAPE = { 0: '<path d="M7 7l10 10M17 7L7 17"/>', 1: '<circle cx="12" cy="12" r="5.6"/>', 2: '<rect x="7" y="7" width="10" height="10"/>', 3: '<path d="M12 6l6.2 10.6H5.8z"/>' };
const PS_COLOUR = { 0: '#8db8ff', 1: '#ff6f74', 2: '#f59bd3', 3: '#4fdcae' };
const XBOX_COLOUR = { 0: '#62c94a', 1: '#ff5a50', 2: '#4a93ff', 3: '#ffc632' };
const mouse = (side) => '<svg viewBox="0 0 24 24"><rect x="6" y="2.5" width="12" height="19" rx="6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.5v7.5M6 10h12" stroke="currentColor" stroke-width="1.4"/>' +
  (side ? '<path d="' + (side === 'L' ? 'M11.2 3.4A5.2 5.2 0 0 0 6.9 8.5v.7h4.3z' : 'M12.8 3.4a5.2 5.2 0 0 1 4.3 5.1v.7h-4.3z') + '" fill="#e8323c"/>' : '') + '</svg>';

const sources = { 1: input };
/** Whose buttons glyphs marked p are drawn for (split screen: setGlyphSource(2, theirInput); null to drop). */
export function setGlyphSource(p, src) { if (src) sources[p] = src; else delete sources[p]; }
const src = (p) => sources[p] || input;

/* move and look are sticks and keys rather than buttons, so they are drawn here */
function special(action, I) {
  const dev = I.device;
  if (action === 'move') return dev === 'pad' ? '<span class="g-pad">L STICK</span>' : dev === 'touch' ? '<span class="g-touch">LEFT THUMB</span>' : ['W', 'A', 'S', 'D'].map((k) => '<span class="g-key">' + k + '</span>').join('');
  if (action === 'look') return dev === 'pad' ? '<span class="g-pad">R STICK</span>' : dev === 'touch' ? '<span class="g-touch">DRAG RIGHT SIDE</span>' : '<span class="g-mouse">' + mouse('') + '</span>';
  return null;
}

/**
 * The drawing for one action on the device in use; '' when that device has no button for it.
 * touch: what its touch button says, when that is not a fixed word; 'ab:<id>' draws an ability's
 * round touch button, which carries that ability's picture.
 */
export function glyphInner(action, touch = '', p = 1) {
  const I = src(p);
  const s = special(action, I);
  if (s !== null) return s;
  const L = I.label(action);
  if (I.device === 'touch' && touch) return touch.startsWith('ab:') ? '<span class="g-tbtn">' + abilityIcon(touch.slice(3), (ABILITIES[touch.slice(3)] || {}).icon || '') + '</span>' : '<span class="g-touch">' + esc(touch) + '</span>';
  switch (L.kind) {
    case 'key': return '<span class="g-key">' + esc(L.text) + '</span>';
    case 'mouse': return '<span class="g-mouse">' + mouse(L.text === 'LMB' ? 'L' : 'R') + '</span>';
    case 'face':
      if (L.pad === 'ps') return '<span class="g-face" style="color:' + PS_COLOUR[L.button] + '"><svg viewBox="0 0 24 24">' + PS_SHAPE[L.button] + '</svg></span>';
      return '<span class="g-face" style="color:' + (L.pad === 'xbox' ? XBOX_COLOUR[L.button] : '#f4efe6') + '">' + esc(L.text) + '</span>';
    case 'pad': return '<span class="g-pad' + (L.button === 6 || L.button === 7 ? ' trig' : '') + '">' + esc(L.text) + '</span>';
    case 'touch': return '<span class="g-touch">' + esc(L.text) + '</span>';
  }
  return '';
}

/** A glyph for an action; touch as for glyphInner; p: whose controller (split screen). */
export function glyph(action, touch = '', p = 1) {
  return '<span class="glyph" data-act="' + action + '"' + (touch ? ' data-touch="' + esc(touch) + '"' : '') + (p !== 1 ? ' data-p="' + p + '"' : '') + '>' + glyphInner(action, touch, p) + '</span>';
}

let seen = '';
/** Redraw every glyph on the page when a player changes device. Cheap enough for every frame. */
export function refreshGlyphs(force = false) {
  const now = Object.keys(sources).map((k) => sources[k].device + ':' + sources[k].padKind).join('|');
  if (now === seen && !force) return;
  seen = now;
  for (const g of document.querySelectorAll('.glyph[data-act]')) g.innerHTML = glyphInner(g.dataset.act, g.dataset.touch || '', +(g.dataset.p || 1));
  for (const n of document.querySelectorAll('[data-devname]')) n.textContent = input.deviceName();
}

/* every control, in the order a new player needs them */
const CONTROLS = [
  ['Move', 'move'], ['Look around', 'look'], ['Sprint', 'sprint'], ['Jump', 'jump'], ['Repair / pick up', 'interact'],
  ['First ability', 'ability1', 'ABILITY'], ['Second ability', 'ability2', 'ABILITY'], ['Item (killer: third ability)', 'ability3', 'ITEM'],
  ['Attack (killer)', 'attack'], ['Emote', 'emote'], ['Scoreboard', 'scoreboard'], ['Chat', 'chat'], ['Menu', 'pause']
];
/** The controls as a list of what each does and its button, for the device in use (and kept up to date). */
export function controlsList() {
  return '<div class="ctl-list"><div class="ctl-dev">Showing buttons for: <b data-devname>' + esc(input.deviceName()) + '</b></div>' +
    CONTROLS.map(([what, a, touch]) => '<div class="ctl-item"><span>' + esc(what) + '</span>' + glyph(a, touch) + '</div>').join('') + '</div>';
}
