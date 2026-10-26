/* Pictures for the menus: character renders (made by forge/renders.mjs) and map cards. */
import { isReady } from '../data/characters.js';

export function portrait(id, skin = 'default') {
  return 'assets/renders/' + id + (skin && skin !== 'default' ? '_' + skin : '') + '.png';
}
export function hasArt(id) { return isReady(id); }

/** A map card's backdrop: the map's own sky colours. */
export function mapArt(def) {
  const s = def.ambience.sky, hex = (n) => '#' + n.toString(16).padStart(6, '0');
  return 'linear-gradient(180deg, ' + hex(s.top) + ' 0%, ' + hex(s.horizon) + ' 62%, ' + hex(s.bottom) + ' 100%)';
}
