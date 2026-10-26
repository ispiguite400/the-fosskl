/* The player's profile and settings, in localStorage, versioned. */

import { defaultQuality } from './device.js';

const KEY = 'forlorn.profile.v1', SKEY = 'forlorn.settings.v1';

const DEFAULT_PROFILE = {
  name: 'Player',
  money: 600,
  xp: 0,
  level: 1,
  malice: 0,                     // the killer chance: highest malice is the killer next round
  owned: { guest1337: ['default'] },
  equipped: { survivor: 'guest1337', killer: 'terrible', skins: {} },
  stats: { rounds: 0, escapes: 0, kills: 0, gens: 0, saves: 0, lmsWins: 0 },
  emotes: ['wave', 'point', 'dance', 'cheer']
};
const DEFAULT_SETTINGS = {
  quality: defaultQuality(), renderScale: 1, sensitivity: 1, invertY: false, fov: 70,
  master: 0.8, music: 0.7, sfx: 0.9, chatBubbles: true, botChat: true, shake: true, killerOptOut: false,
  survivorUi: true, statusLayout: 'side', healthDisplay: 'health', staminaCounter: true
};

const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: play on without saving */ } };

const merge = (base, over) => {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  if (!over) return out;
  for (const k in over) out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null ? merge(base[k], over[k]) : over[k];
  return out;
};

export const profile = merge(DEFAULT_PROFILE, read(KEY));
export const settings = merge(DEFAULT_SETTINGS, read(SKEY));

export function saveProfile() { write(KEY, profile); }
export function saveSettings() { write(SKEY, settings); }

export function owns(charId, skin = 'default') { return !!(profile.owned[charId] && profile.owned[charId].includes(skin)); }
export function grant(charId, skin = 'default') {
  if (!profile.owned[charId]) profile.owned[charId] = [];
  if (!profile.owned[charId].includes(skin)) profile.owned[charId].push(skin);
  saveProfile();
}
export function equippedSkin(charId) { return profile.equipped.skins[charId] || 'default'; }

export function addXp(n) {
  profile.xp += n;
  let need;
  while (profile.xp >= (need = 120 + profile.level * 40)) { profile.xp -= need; profile.level++; }
  saveProfile();
}
