/* Pictures for the menus: character renders (made by forge/renders.mjs) and map cards (made by tools/mapcards.mjs). */
import { isReady, characterPortrait } from '../data/characters.js';

export function portrait(id, skin = 'default') { return characterPortrait(id, skin); }
export function hasArt(id) { return isReady(id); }

/** A map card's backdrop: its photograph, over the map's own sky colours in case the photo is missing. */
export function mapArt(def) {
  const s = def.ambience.sky, hex = (n) => '#' + n.toString(16).padStart(6, '0');
  return 'url(assets/maps/' + def.id + '.jpg) center / cover no-repeat, linear-gradient(180deg, ' + hex(s.top) + ' 0%, ' + hex(s.horizon) + ' 62%, ' + hex(s.bottom) + ' 100%)';
}
