/*
 * The cast: ObliviousHD's films (The Last Guest, Guest 666, Blox Watch), as they look in the
 * movies (forge/STYLE.md). Every character is a forged model in assets/models/<id>[_<skin>].glb.
 *
 * Survivors have two abilities (Q and R) and a passive; killers have a basic attack (M1) and
 * three abilities (Q, R, F). Ability behaviour lives in game/abilities.js, keyed by id.
 */
import { assetUrl } from '../core/assets.js';

export const SURVIVORS = [
  {
    id: 'guest1337', name: 'Guest 1337', title: 'The Last Guest', film: 'The Last Guest', price: 0, color: '#2f4fd8',
    hp: 120, speed: 1, stamina: 100,
    bio: 'The last Guest left in Roblox. A veteran of the war against the Bacon Empire who would rather take the hit himself than watch a friend fall.',
    passive: { name: 'Veteran', text: 'Takes 10% less damage.' },
    abilities: [
      { id: 'block', key: 'Q', name: 'Block', cd: 22, text: 'Raise your guard for 1.2s. A hit during it is shrugged off and the killer is stunned for 2s.' },
      { id: 'grenade', key: 'R', name: 'Grenade', cd: 40, text: 'Throw a grenade. It goes off after a second: the killer is stunned for 1.8s and knocked back.' }
    ],
    skins: [{ id: 'default', name: 'Soldier', price: 0 }, { id: 'prisoner', name: 'Guest Prison', price: 350 }, { id: 'winter', name: 'Winter Ops', price: 450 }]
  },
  {
    id: 'matt', name: 'Matt', title: 'The Best Man', film: 'The Last Guest', price: 500, color: '#c4372f',
    hp: 110, speed: 1, stamina: 105,
    bio: "Guest's oldest friend, who followed him into the Roblox Army. Steady, loyal, and always first through the door.",
    passive: { name: 'Brothers in Arms', text: 'Repairs 15% faster beside another survivor.' },
    abilities: [
      { id: 'shieldbash', key: 'Q', name: 'Riot Shield', cd: 28, text: 'Charge 5m behind a riot shield. Hitting the killer stuns them for 1.5s.' },
      { id: 'supply', key: 'R', name: 'Supply Drop', cd: 45, text: 'Drop a supply crate: the first survivor to grab it heals 35.' }
    ],
    skins: [{ id: 'default', name: 'Civvies', price: 0 }, { id: 'war', name: 'Great War', price: 400 }]
  },
  {
    id: 'daisy', name: 'Daisy', title: 'Heart of the Resistance', film: 'The Last Guest', price: 400, color: '#38c6d9',
    hp: 95, speed: 1.02, stamina: 100,
    bio: "Guest's childhood friend and the reason he keeps going. She patches up whoever needs it and never leaves anyone behind.",
    passive: { name: 'Hope', text: 'Survivors near her regain stamina 25% faster.' },
    abilities: [
      { id: 'firstaid', key: 'Q', name: 'First Aid', cd: 25, text: 'Heal the nearest hurt survivor (or yourself) 30 HP over 3 seconds.' },
      { id: 'rally', key: 'R', name: 'Rally', cd: 40, text: 'Survivors within 12m get 25% speed for 4s and full stamina.' }
    ],
    skins: [{ id: 'default', name: 'Sweatshirt', price: 0 }, { id: 'medic', name: 'Field Medic', price: 400 }]
  },
  {
    id: 'rose', name: 'Rose', title: 'Prison Breaker', film: 'The Last Guest', price: 600, color: '#ff6fb1',
    hp: 90, speed: 1.06, stamina: 110,
    bio: 'Broke out of Guest Prison with nothing but nerve. Fast, reckless, and impossible to keep behind bars.',
    passive: { name: 'Escape Artist', text: 'Recovers from slows and roots twice as fast.' },
    abilities: [
      { id: 'breakout', key: 'Q', name: 'Breakout', cd: 24, text: 'Sprint at 45% extra speed for 3 seconds.' },
      { id: 'smoke', key: 'R', name: 'Smoke Bomb', cd: 38, text: 'A 5m smoke cloud for 6s: the killer cannot see through it and is slowed inside.' }
    ],
    skins: [{ id: 'default', name: 'Tracksuit', price: 0 }, { id: 'prisoner', name: 'Guest Prison', price: 350 }]
  },
  {
    id: 'captain', name: 'Army Captain', title: 'Captain of the Roblox Army', film: 'The Last Guest', price: 800, color: '#7a8b3c',
    hp: 135, speed: 0.96, stamina: 95,
    bio: 'The commander who led the Roblox Army against the Bacon Empire. Slow to fall, quick to give orders.',
    passive: { name: 'Command', text: 'Survivors within 10m of him repair 10% faster.' },
    abilities: [
      { id: 'warcry', key: 'Q', name: 'Rally Cry', cd: 45, text: 'Survivors within 15m take 30% less damage for 6 seconds.' },
      { id: 'sidearm', key: 'R', name: 'Sidearm', cd: 35, text: 'Aim for half a second and fire: a hit stuns the killer for 1.5s.' }
    ],
    skins: [{ id: 'default', name: 'Dress Uniform', price: 0 }, { id: 'field', name: 'Field Command', price: 450 }]
  },
  {
    id: 'emily', name: 'Emily', title: 'The New Girl', film: 'Guest 666', price: 500, color: '#b4a2ff',
    hp: 85, speed: 1.04, stamina: 100,
    bio: 'The quiet student the bullies picked on, until the legend of Guest 666 came true. She knows how to disappear.',
    passive: { name: 'Watched Over', text: 'Sees the killer through walls within 25m.' },
    abilities: [
      { id: 'hide', key: 'Q', name: 'Hide', cd: 30, text: 'Stand still to vanish from the killer beyond 4m, for up to 8 seconds.' },
      { id: 'sixthsense', key: 'R', name: 'Sixth Sense', cd: 40, text: 'Reveal the killer to every survivor for 5 seconds.' }
    ],
    skins: [{ id: 'default', name: 'Crop Top', price: 0 }, { id: 'formal', name: 'School Dance', price: 400 }]
  },
  {
    id: 'justin', name: 'Justin', title: 'Hood Up', film: 'Guest 666', price: 400, color: '#5b8f5a',
    hp: 100, speed: 1.02, stamina: 110,
    bio: "Keeps his hood up and his head down at Robloxian High. Faster on his feet than anyone gives him credit for.",
    passive: { name: 'Track Star', text: '10% more stamina.' },
    abilities: [
      { id: 'burst', key: 'Q', name: 'Sprint Burst', cd: 20, text: 'Run 50% faster for 2.5 seconds.' },
      { id: 'flashlight', key: 'R', name: 'Flashlight', cd: 30, text: 'Shine a light in the killer\'s face from up to 8m: blinded for 2 seconds.' }
    ],
    skins: [{ id: 'default', name: 'Hoodie', price: 0 }, { id: 'varsity', name: 'Varsity', price: 350 }]
  },
  {
    id: 'richguy', name: 'Rich Guy', title: 'Money Talks', film: 'Guest 666', price: 1000, color: '#e8b923',
    hp: 105, speed: 1, stamina: 100,
    bio: "Emily's teacher, dripping in gold, with a smile you can see from across the school. He thinks money solves everything. Sometimes it does.",
    passive: { name: 'Big Spender', text: 'Earns 25% more money every round.' },
    abilities: [
      { id: 'makeitrain', key: 'Q', name: 'Make It Rain', cd: 35, text: 'Throw a fortune in cash: the killer is slowed 35% inside it for 5 seconds.' },
      { id: 'gold', key: 'R', name: 'Gold Plating', cd: 45, text: 'Absorb the next 40 damage for 8 seconds.' }
    ],
    skins: [{ id: 'default', name: 'Gold Suit', price: 0 }, { id: 'diamond', name: 'Diamond', price: 900 }]
  },
  {
    id: 'charlie', name: 'Charlie', title: 'The Astral', film: 'Blox Watch', price: 900, color: '#46e0ff',
    hp: 90, speed: 1.02, stamina: 100,
    bio: "Charlotte, daughter of the Last Guest. An Astral who can bend the world with her mind, still learning how far it goes.",
    passive: { name: 'Astral Sight', text: 'Sees generator progress and items through walls.' },
    abilities: [
      { id: 'push', key: 'Q', name: 'Telekinesis', cd: 30, text: 'Throw the killer back 6m from in front of you and stun them for 1s.' },
      { id: 'shield', key: 'R', name: 'Astral Shield', cd: 40, text: 'Shield the nearest survivor (or yourself): it blocks the next hit for 6s.' }
    ],
    skins: [{ id: 'default', name: 'First Day', price: 0 }, { id: 'awakened', name: 'Awakened', price: 600 }]
  },
  {
    id: 'jez', name: 'Jez', title: "The General's Son", film: 'The Last Guest', price: 700, color: '#2a6fd0',
    hp: 105, speed: 1, stamina: 100,
    bio: "Son of the Bacon General, who turned his back on the Empire to free the Guests. The Bacons still hesitate before hurting him.",
    passive: { name: 'Insider', text: 'Bacon killers deal him 15% less damage.' },
    abilities: [
      { id: 'disguise', key: 'Q', name: 'Bacon Disguise', cd: 45, text: 'For 6s the killer ignores you unless you are within 3m.' },
      { id: 'snare', key: 'R', name: 'Sabotage', cd: 30, text: 'Set a snare: the killer is rooted for 2s when they step in it.' }
    ],
    skins: [{ id: 'default', name: 'Motorcycle Tee', price: 0 }, { id: 'rebel', name: 'Rebel', price: 400 }]
  }
];

export const KILLERS = [
  {
    id: 'terrible', name: 'The Terrible', title: 'Guest 666', film: 'Guest 666', price: 0, color: '#ff2a2a',
    speed: 1, stamina: 120, m1: { name: 'Claw', dmg: 25, cd: 1.5, range: 2.6 },
    bio: 'The spirit of a Guest that never left. Pitch black, red-eyed, silent. He comes for the ones who hurt others, and tonight that is everyone.',
    abilities: [
      { id: 'hellfire', key: 'Q', name: 'Hellfire', cd: 14, text: 'Hurl a fireball: 30 damage, and it leaves a burning trail.' },
      { id: 'levitate', key: 'R', name: 'Levitate', cd: 30, text: 'Lift the survivor you are looking at (18m): helpless for 1.6s, 20 damage.' },
      { id: 'vanish', key: 'F', name: 'Vanish', cd: 40, text: 'Fade from sight for 5 seconds and move 20% faster.' }
    ],
    skins: [{ id: 'default', name: 'The Terrible', price: 0 }, { id: 'classic', name: 'White Eyes', price: 500 }, { id: 'inferno', name: 'Inferno', price: 900 }]
  },
  {
    id: 'bacongeneral', name: 'Bacon General', title: 'Ruler of the Bacon Empire', film: 'The Last Guest', price: 0, color: '#3d74c9',
    speed: 0.98, stamina: 115, m1: { name: 'Pistol Whip', dmg: 25, cd: 1.5, range: 2.5 },
    bio: "General Baconson, who burned the Guest villages and took Guest's parents. He does not fight fair, and he never comes alone.",
    abilities: [
      { id: 'pistol', key: 'Q', name: 'Pistol Shot', cd: 10, text: 'Aim and fire: 30 damage at up to 30m.' },
      { id: 'reinforce', key: 'R', name: 'Reinforcements', cd: 60, text: 'Call two Bacon Soldiers to hunt for 20 seconds.' },
      { id: 'kgrenade', key: 'F', name: 'Grenade', cd: 25, text: 'Lob a grenade: 35 damage in a 4m blast.' }
    ],
    skins: [{ id: 'default', name: 'Bacon General', price: 0 }, { id: 'dress', name: 'Parade Dress', price: 600 }]
  },
  {
    id: 'baconcolonel', name: 'Bacon Colonel', title: 'The Iron Fist', film: 'The Last Guest', price: 600, color: '#8f8f8f',
    speed: 1, stamina: 120, m1: { name: 'Rifle Butt', dmg: 25, cd: 1.5, range: 2.5 },
    bio: 'The one-eyed Colonel who took over the Empire after the General fell. Patient, cruel, and very good with traps.',
    abilities: [
      { id: 'shotgun', key: 'Q', name: 'Shotgun', cd: 12, text: 'A wide blast: up to 40 damage close in.' },
      { id: 'beartrap', key: 'R', name: 'Bear Trap', cd: 15, text: 'Set a trap (three at once): 15 damage and rooted for 2.5s.' },
      { id: 'interrogate', key: 'F', name: 'Interrogate', cd: 35, text: 'Your next hit reveals every survivor for 6 seconds.' }
    ],
    skins: [{ id: 'default', name: 'Fur Coat', price: 0 }, { id: 'winter', name: 'Winter Campaign', price: 600 }]
  },
  {
    id: 'eliteguard', name: 'Elite Guard', title: 'Blade of the Empire', film: 'The Last Guest', price: 800, color: '#a01c1c',
    speed: 1.02, stamina: 120, m1: { name: 'Sword', dmg: 30, cd: 1.7, range: 2.9 },
    bio: 'The Empire\'s best, in black armour and a black bandana, with a sword and a red scar. He has never lost a duel.',
    abilities: [
      { id: 'dashslash', key: 'Q', name: 'Dash Slash', cd: 12, text: 'Dash 8m, cutting everything you pass: 30 damage.' },
      { id: 'parry', key: 'R', name: 'Parry', cd: 20, text: 'For 1s, stuns used on you are turned back: 20 damage to the survivor instead.' },
      { id: 'execute', key: 'F', name: 'Execution', cd: 30, text: 'A slow, heavy blow: 60 damage.' }
    ],
    skins: [{ id: 'default', name: 'Black Armour', price: 0 }, { id: 'crimson', name: 'Crimson Guard', price: 700 }]
  },
  {
    id: 'bloxwatch', name: 'Blox Watch', title: 'The First Guest', film: 'Blox Watch', price: 1000, color: '#ffd21f',
    speed: 1, stamina: 125, m1: { name: 'Shock', dmg: 25, cd: 1.5, range: 2.7 },
    bio: 'The most powerful Astral, believed to be the very first Guest. Pitch black, yellow-eyed, with lightning in his hands.',
    abilities: [
      { id: 'lightning', key: 'Q', name: 'Astral Lightning', cd: 14, text: 'Lightning leaps to a survivor in sight (14m) and on to one more: 22 damage each, slowed.' },
      { id: 'possess', key: 'R', name: 'Possession', cd: 30, text: 'Seize a survivor within 15m and drag them 6m toward you.' },
      { id: 'limbo', key: 'F', name: 'Limbo Step', cd: 18, text: 'Step through Limbo: reappear up to 15m ahead.' }
    ],
    skins: [{ id: 'default', name: 'Blox Watch', price: 0 }, { id: 'void', name: 'Void', price: 900 }]
  }
];

export const MINIONS = [{ id: 'baconsoldier', name: 'Bacon Soldier', dmg: 10, speed: 0.9 }];

export const ALL = [...SURVIVORS, ...KILLERS];
export const byId = (id) => ALL.find((c) => c.id === id) || MINIONS.find((c) => c.id === id) || null;

/* Which models have been forged and shipped. A character whose model is not ready yet is
   shown as "in the forge" in the menus and cannot be picked. */
export const SHIPPED = new Set(['guest1337', 'matt', 'daisy', 'rose', 'captain', 'emily', 'justin', 'richguy', 'charlie', 'jez',
  'terrible', 'bacongeneral', 'baconcolonel', 'eliteguard', 'bloxwatch', 'baconsoldier']);
export const isReady = (id) => SHIPPED.has(id);
/**
 * Every model in assets/models/index.json (written by forge/stamp.mjs) counts as shipped. The
 * index also holds a hash of each model and portrait, which goes on the end of its address, so a
 * rebuilt character shows up at once instead of an old copy from the browser's cache.
 */
export const STAMP = { models: {}, renders: {} };
export async function loadShipped() {
  const get = async (url) => { try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; } };
  const [m, p] = await Promise.all([get('assets/models/index.json'), get('assets/renders/index.json')]);
  if (Array.isArray(m)) for (const n of m) SHIPPED.add(n);
  else if (m) for (const [n, h] of Object.entries(m)) { SHIPPED.add(n); STAMP.models[n] = h; }
  if (p && !Array.isArray(p)) STAMP.renders = p;
  return SHIPPED;
}
const stamped = (url, h) => (h ? url + '?v=' + h : url);
/** How strongly a character's eyes (its brightest, most saturated colours) glow. */
const GLOW = { terrible: 4, bloxwatch: 4, charlie: 1.2 };
export const characterGlow = (id) => GLOW[id] || 0;
export function characterModel(id, skin = 'default') {
  const name = id + (skin && skin !== 'default' ? '_' + skin : '');
  return stamped('assets/models/' + name + '.glb', STAMP.models[name]);
}
export function characterPortrait(id, skin = 'default') {
  const name = id + (skin && skin !== 'default' ? '_' + skin : '');
  return assetUrl(stamped('assets/renders/' + name + '.png', STAMP.renders[name]));
}
