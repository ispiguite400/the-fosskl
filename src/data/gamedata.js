/* Static game data: classes, weapons, items, worlds, ranks, abilities.
 * Kept declarative so balance can be tuned without touching systems code. */

/* ============================================================
   RANKS
   ============================================================ */
export const RANKS = [
  { id: 'E',   name: 'Forsaken',  level: 1,  color: '#8b8378' },
  { id: 'D',   name: 'Wanderer',  level: 6,  color: '#a89a86' },
  { id: 'C',   name: 'Ronin',     level: 13, color: '#c9b48a' },
  { id: 'B',   name: 'Bladebound',level: 21, color: '#d9a24a' },
  { id: 'A',   name: 'Ascendant', level: 30, color: '#f0a24a' },
  { id: 'S',   name: 'Sovereign', level: 45, color: '#ff8a2b' },
  { id: 'SS',  name: 'Immortal',  level: 62, color: '#ff5c2b' },
  { id: 'SSS', name: 'Godslayer', level: 80, color: '#ff2b5c' }
];

export function rankFor(level) {
  let r = RANKS[0];
  for (const x of RANKS) if (level >= x.level) r = x;
  return r;
}

/* Levelling curve.
 *
 * Enemy experience grows about twenty-two fold from world two to world nine,
 * because both the archetypes and the per-world level scale climb. A
 * quadratic requirement grows far slower than that, so the early worlds were
 * an enormous grind and the late ones a formality: reaching the gate took
 * roughly 1360 kills in world two against 276 in world nine.
 *
 * A cubic tracks the income curve almost exactly, which is what keeps every
 * world worth a comparable amount of play - a little over two hundred kills
 * each, landing between thirty and forty-five minutes at a realistic pace. */
export function xpToNext(level) {
  return Math.floor(90 + level + level * level * level * .016);
}

/* ============================================================
   CLASSES — stats are multipliers applied to the base player.
   Each is unlocked by reaching the listed world.
   ============================================================ */
export const CLASSES = [
  {
    id: 'knight', name: 'Knight', jp: '騎士', art: 'kingdom', unlockWorld: 1,
    stats: { health: 1.00, stamina: 1.00, power: 1.00, damage: 1.00, speed: 1.00, defense: 1.15 },
    perk: 'Balanced. Blocking costs 20% less power.',
    lore: 'You held the north gate for eleven days. On the twelfth your king ' +
          'signed a treaty and named you the price of it. The men you bled beside ' +
          'watched you walk out unarmed.'
  },
  {
    id: 'samurai', name: 'Samurai', jp: '侍', art: 'shrine', unlockWorld: 2,
    stats: { health: 1.05, stamina: 1.05, power: 1.10, damage: 1.20, speed: 1.05, defense: 1.00 },
    perk: 'Katana strikes deal +25%. Perfect blocks stagger.',
    lore: 'Your lord ordered a village burned. You refused, and cut down the men ' +
          'sent to do it. For that mercy your name was struck from the register ' +
          'and your sword-hand was promised to the crows.'
  },
  {
    id: 'assassin', name: 'Assassin', jp: '暗殺者', art: 'bamboo', unlockWorld: 3,
    stats: { health: .80, stamina: 1.35, power: 1.20, damage: 1.35, speed: 1.30, defense: .80 },
    perk: 'Backstabs deal triple damage. Silent movement.',
    lore: 'They trained you to be a rumour. When you finally asked who paid for ' +
          'the names on your list, the answer was your own house — so they ' +
          'unmade you and salted the record.'
  },
  {
    id: 'guard', name: 'Guard', jp: '衛兵', art: 'temple', unlockWorld: 4,
    stats: { health: 1.40, stamina: .90, power: 1.15, damage: .90, speed: .85, defense: 1.45 },
    perk: 'Shields never break. Knockback taken halved.',
    lore: 'You guarded a door for thirty years without asking what was behind it. ' +
          'The night it opened, what came out did not need a guard — and could ' +
          'not leave a witness.'
  },
  {
    id: 'warrior', name: 'Warrior', jp: '戦士', art: 'savanna', unlockWorld: 5,
    stats: { health: 1.25, stamina: 1.15, power: 1.00, damage: 1.15, speed: 1.00, defense: 1.05 },
    perk: 'Each kill restores 8% health. Rage builds on damage taken.',
    lore: 'You were the last one standing in a field of your own kin. The victors ' +
          'called that witchcraft rather than admit how well you fought, and ' +
          'drove you into the waste.'
  },
  {
    id: 'fighter', name: 'Fighter', jp: '闘士', art: 'desert', unlockWorld: 6,
    stats: { health: 1.10, stamina: 1.40, power: 1.30, damage: 1.05, speed: 1.15, defense: .95 },
    perk: 'Unarmed damage x3. Stamina regenerates twice as fast.',
    lore: 'Sixty-one bouts in the pit and never once did you kill. The crowd wanted ' +
          'blood; the owners wanted obedience. You gave neither, so they took ' +
          'your name and sold it to someone who would.'
  },
  {
    id: 'sensei', name: 'Sensei', jp: '先生', art: 'peaks', unlockWorld: 7,
    stats: { health: 1.00, stamina: 1.25, power: 1.35, damage: 1.10, speed: 1.10, defense: 1.10 },
    perk: 'Power regenerates 60% faster. Parry window doubled.',
    lore: 'You taught four hundred students the discipline of the open hand. One of ' +
          'them became a general. When his war came, every death he caused was ' +
          'laid at your feet.'
  },
  {
    id: 'wizard', name: 'Wizard', jp: '魔術師', art: 'nebula', unlockWorld: 8,
    stats: { health: .85, stamina: 1.10, power: 1.60, damage: 1.25, speed: 1.05, defense: .85 },
    perk: 'Bombs cost no power and deal +60%. Ranged shots home slightly.',
    lore: 'You read the last page of a book that was sealed for a reason. What you ' +
          'learned there cannot be unlearned, and the world has a way of ' +
          'expelling anyone who knows it.'
  },
  {
    id: 'emperor', name: 'Emperor', jp: '皇帝', art: 'ocean', unlockWorld: 9,
    stats: { health: 1.30, stamina: 1.20, power: 1.30, damage: 1.30, speed: 1.05, defense: 1.25 },
    perk: 'Shekels and XP gain +40%. Enemies hesitate before striking.',
    lore: 'You inherited a throne on a drowning coast and spent the treasury on ' +
          'boats instead of banners. The court called it weakness, and gave the ' +
          'crown to a man who let the water take them.'
  },
  {
    id: 'king', name: 'King', jp: '王', art: 'skyland', unlockWorld: 10,
    stats: { health: 1.45, stamina: 1.30, power: 1.45, damage: 1.45, speed: 1.10, defense: 1.35 },
    perk: 'All stats elevated. Wind Dash costs no power.',
    lore: 'You were the first one He cast down, and the only one who remembers the ' +
          'sky before it was His. Everything since has been the long walk back up.'
  }
];

export const classById = id => CLASSES.find(c => c.id === id) || CLASSES[0];

/* ============================================================
   ITEMS / WEAPONS
   kind: melee | range | bomb | shield | consumable | misc
   ============================================================ */
export const ITEMS = {
  /* --- melee --- */
  fist:        { id: 'fist', name: 'Bare Hands', kind: 'melee', icon: 'sword', damage: 8, speed: .34, reach: 2.2, power: 2, stack: 1, tier: 0, innate: true,
                 desc: 'You always have these. They are rarely enough.' },
  kontana:     { id: 'kontana', name: 'Kontana', jp: '刀', kind: 'melee', icon: 'katana', damage: 34, speed: .46, reach: 3.1, power: 9, stack: 1, tier: 2, rarity: 'legend',
                 desc: 'A folded blade left in the ash of a burning shrine. Teaches the hand to refuse a blow.' },
  katana:      { id: 'katana', name: 'Katana', kind: 'melee', icon: 'katana', damage: 28, speed: .44, reach: 3.0, power: 8, stack: 1, tier: 1, rarity: 'rare',
                 desc: 'Light, fast, unforgiving of hesitation.' },
  odachi:      { id: 'odachi', name: 'Odachi', kind: 'melee', icon: 'katana', damage: 46, speed: .78, reach: 3.9, power: 16, stack: 1, tier: 3, rarity: 'epic',
                 desc: 'A field-blade too long for indoors. Cleaves through a guard.' },
  sword:       { id: 'sword', name: 'Arming Sword', kind: 'melee', icon: 'sword', damage: 24, speed: .48, reach: 2.8, power: 7, stack: 1, tier: 1,
                 desc: 'Straight, honest steel. Forgives a poor stance.' },
  axe:         { id: 'axe', name: 'War Axe', kind: 'melee', icon: 'axe', damage: 38, speed: .68, reach: 2.7, power: 13, stack: 1, tier: 2, rarity: 'rare',
                 desc: 'Breaks shields. Slow enough that a miss costs you.' },
  fire_sword:  { id: 'fire_sword', name: 'Emberfang', kind: 'melee', icon: 'sword', damage: 40, speed: .5, reach: 3.0, power: 11, stack: 1, tier: 3,
                 element: 'fire', burn: 14, rarity: 'epic',
                 desc: 'The steel never cools. Sets what it cuts alight.' },
  spear:       { id: 'spear', name: 'Yari', kind: 'melee', icon: 'sword', damage: 30, speed: .56, reach: 4.4, power: 10, stack: 1, tier: 2,
                 desc: 'Reach beats speed more often than pride admits.' },
  tetsubo:     { id: 'tetsubo', name: 'Tetsubo', kind: 'melee', icon: 'axe', damage: 55, speed: .95, reach: 3.0, power: 20, stack: 1, tier: 4, rarity: 'epic',
                 knockback: 2.4,
                 desc: 'A studded iron club. Armour is a suggestion.' },
  naginata:    { id: 'naginata', name: 'Naginata', kind: 'melee', icon: 'axe', damage: 36, speed: .62, reach: 4.0, power: 12, stack: 1, tier: 2, rarity: 'rare',
                 desc: 'A curved blade on a long haft. Sweeps a whole doorway.' },
  kusarigama:  { id: 'kusarigama', name: 'Kusarigama', kind: 'melee', icon: 'knife', damage: 26, speed: .38, reach: 4.8, power: 8, stack: 1, tier: 3, rarity: 'epic',
                 desc: 'Sickle on a weighted chain. Outranges anything its size.' },
  warfan:      { id: 'warfan', name: 'Tessen', kind: 'melee', icon: 'axe', damage: 22, speed: .3, reach: 2.4, power: 4, stack: 1, tier: 2,
                 desc: 'An iron fan. Deceptively fast, and it counts as unarmed.' },
  frostblade:  { id: 'frostblade', name: 'Winterfang', kind: 'melee', icon: 'katana', damage: 42, speed: .48, reach: 3.1, power: 11, stack: 1, tier: 3,
                 element: 'frost', rarity: 'epic',
                 desc: 'The air around it aches. Slows whatever it cuts.' },
  voidblade:   { id: 'voidblade', name: 'Nothing-Blade', kind: 'melee', icon: 'katana', damage: 72, speed: .42, reach: 3.4, power: 12, stack: 1, tier: 5,
                 rarity: 'legend', element: 'void',
                 desc: 'Forged from the space where a god used to be.' },

  /* --- ranged --- */
  bow:         { id: 'bow', name: 'Yumi', kind: 'range', icon: 'bow', damage: 30, speed: .85, power: 8, stack: 1, tier: 1,
                 projectile: 'arrow', velocity: 62, drop: 9, charge: .55,
                 desc: 'Asymmetric longbow. Draw longer, hit harder.' },
  crossbow:    { id: 'crossbow', name: 'Crossbow', kind: 'range', icon: 'crossbow', damage: 48, speed: 1.35, power: 10, stack: 1, tier: 2, rarity: 'rare',
                 projectile: 'bolt', velocity: 88, drop: 5,
                 desc: 'Punches through mail. Reloading is an eternity.' },
  knives:      { id: 'knives', name: 'Throwing Knives', kind: 'range', icon: 'knife', damage: 18, speed: .28, power: 4, stack: 32, tier: 1,
                 projectile: 'knife', velocity: 52, drop: 13, consumes: true,
                 desc: 'Quiet, quick, and you can pick them back up.' },
  shuriken:    { id: 'shuriken', name: 'Shuriken', kind: 'range', icon: 'knife', damage: 14, speed: .2, power: 3, stack: 64, tier: 1,
                 projectile: 'shuriken', velocity: 58, drop: 11, consumes: true,
                 desc: 'Thrown in threes. Meant to annoy, not to end.' },
  chakram:     { id: 'chakram', name: 'Chakram', kind: 'range', icon: 'knife', damage: 24, speed: .34, power: 5, stack: 24, tier: 2, rarity: 'rare',
                 projectile: 'shuriken', velocity: 64, drop: 4, consumes: true,
                 desc: 'A thrown ring that barely drops. Comes back if you are lucky.' },
  greatbow:    { id: 'greatbow', name: 'Siege Bow', kind: 'range', icon: 'bow', damage: 78, speed: 1.5, power: 18, stack: 1, tier: 5, rarity: 'legend',
                 projectile: 'arrow', velocity: 110, drop: 2, charge: .9,
                 desc: 'Meant for gates, not people. Draws slowly, ends arguments.' },
  stormbow:    { id: 'stormbow', name: 'Stormcaller', kind: 'range', icon: 'bow', damage: 58, speed: .8, power: 14, stack: 1, tier: 4, rarity: 'epic',
                 projectile: 'arrow', velocity: 96, drop: 3, charge: .5, element: 'shock',
                 desc: 'Each shot pulls a thread of the sky down with it.' },

  /* --- bombs --- */
  smoke_bomb:  { id: 'smoke_bomb', name: 'Smoke Bomb', kind: 'bomb', icon: 'bomb', damage: 0, speed: .6, power: 5, stack: 16, tier: 1,
                 effect: 'smoke', radius: 9, fuse: .35,
                 desc: 'Breaks every enemy\'s lock on you for six seconds.' },
  fire_bomb:   { id: 'fire_bomb', name: 'Fire Bomb', kind: 'bomb', icon: 'bomb', damage: 64, speed: .7, power: 9, stack: 16, tier: 2, rarity: 'rare',
                 effect: 'fire', radius: 7, fuse: .9, tint: '#ff7a2b',
                 desc: 'Clay, oil and a short temper.' },
  thunder_bomb:{ id: 'thunder_bomb', name: 'Thunder Bomb', kind: 'bomb', icon: 'bomb', damage: 88, speed: .8, power: 13, stack: 12, tier: 3, rarity: 'epic',
                 effect: 'shock', radius: 11, fuse: .8,
                 desc: 'Stuns everything it does not kill.' },
  ice_bomb:    { id: 'ice_bomb', name: 'Frost Bomb', kind: 'bomb', icon: 'bomb', damage: 46, speed: .7, power: 8, stack: 16, tier: 2, rarity: 'rare',
                 effect: 'frost', radius: 9, fuse: .8, tint: '#6ab4ff',
                 desc: 'Freezes everything in the blast where it stands.' },
  poison_bomb: { id: 'poison_bomb', name: 'Miasma Jar', kind: 'bomb', icon: 'bomb', damage: 30, speed: .7, power: 7, stack: 16, tier: 3, rarity: 'rare',
                 effect: 'poison', radius: 10, fuse: .7, tint: '#7ad84a',
                 desc: 'A cloud that keeps working long after it lands.' },
  teleport_bomb:{ id: 'teleport_bomb', name: 'Teleport Bomb', kind: 'bomb', icon: 'bomb', damage: 0, speed: .5, power: 12, stack: 8, tier: 3, rarity: 'epic',
                 effect: 'teleport', radius: 2, fuse: .55,
                 desc: 'Where it lands, you are. Mind the drop.' },

  /* --- shields --- */
  wood_shield: { id: 'wood_shield', name: 'Lacquered Shield', kind: 'shield', icon: 'shield', block: .55, power: 6, stack: 1, tier: 1,
                 desc: 'Cheap, light, and it will not last the season.' },
  iron_shield: { id: 'iron_shield', name: 'Iron Shield', kind: 'shield', icon: 'shield', block: .72, power: 9, stack: 1, tier: 2, rarity: 'rare',
                 desc: 'Heavy enough that holding it is its own exercise.' },
  tower_shield:{ id: 'tower_shield', name: 'Tower Shield', kind: 'shield', icon: 'shield', block: .86, power: 14, stack: 1, tier: 3, rarity: 'epic',
                 desc: 'A wall you carry. Blocks nearly everything, slows you badly.' },
  oni_shield:  { id: 'oni_shield', name: 'Oni Ward', kind: 'shield', icon: 'shield', block: .94, power: 11, stack: 1, tier: 4, rarity: 'legend',
                 reflect: .3,
                 desc: 'Something is painted on the face. It blinks when you are not looking.' },

  /* --- consumables --- */
  potion_hp:   { id: 'potion_hp', name: 'Healing Draught', kind: 'consumable', icon: 'potion', tint: '#d8342e', heal: 45, stack: 12, tier: 1, price: 30,
                 desc: 'Restores 45 health.' },
  potion_stam: { id: 'potion_stam', name: 'Wind Tonic', kind: 'consumable', icon: 'potion', tint: '#e8dcc0', stamina: 100, stack: 12, tier: 1, price: 22,
                 desc: 'Restores all stamina.' },
  potion_pow:  { id: 'potion_pow', name: 'Ember Tonic', kind: 'consumable', icon: 'potion', tint: '#f08a1e', power: 100, stack: 12, tier: 1, price: 28,
                 desc: 'Restores all power.' },
  potion_op:   { id: 'potion_op', name: 'Draught of the Forsaken', kind: 'consumable', icon: 'potion', tint: '#b44df0',
                 heal: 999, power: 999, stamina: 999, buff: { damage: 3, speed: 1.5, duration: 45 }, stack: 4, tier: 5,
                 rarity: 'legend', price: 900,
                 desc: 'Full restore, then triple damage for 45 seconds. There are not many of these.' },
  food:        { id: 'food', name: 'Rice Bale', kind: 'consumable', icon: 'food', tame: true, stack: 32, tier: 1, price: 12,
                 desc: 'Offer it to a wild animal to earn its trust.' },
  key:         { id: 'key', name: 'Rusted Key', kind: 'misc', icon: 'key', stack: 16, tier: 1,
                 desc: 'Opens one locked chest. They are never kept near the lock.' },
  shekel:      { id: 'shekel', name: 'Shekels', kind: 'misc', icon: 'coin', stack: 9999, tier: 1,
                 desc: 'Currency of a kingdom that has forgotten you.' }
};

export const itemById = id => ITEMS[id];

/** Base sell price derived from tier + kind so every item is sellable. */
export function sellValue(item) {
  if (!item) return 0;
  const def = ITEMS[item.id]; if (!def) return 0;
  if (def.price) return Math.floor(def.price * .5);
  const base = { melee: 42, range: 46, bomb: 18, shield: 38, consumable: 10, misc: 4 }[def.kind] ?? 10;
  return Math.floor(base * Math.pow(1.85, def.tier || 1));
}
export function xpValue(item) { return Math.floor(sellValue(item) * 1.4); }

export const RARITY_CLASS = { rare: 'rare', epic: 'epic', legend: 'legend' };

/* ============================================================
   WORLDS
   ============================================================ */
export const WORLDS = [
  {
    id: 1, name: 'Ashen Village', startPhase: 0.02, dayScale: .18, night: true, jp: '灰の里', theme: 'ruins', art: 'shrine',
    music: 'world1', tutorial: true, hub: false, size: 3600,
    subtitle: 'Where you were left for dead',
    mountains: 1.6,
    palette: { fog: 0x3a4668, sky: 0x2e3c60, ground: 0x574c3d, grass: 0x6b6b45, water: 0x243040 },
    sun: { elevation: 14, azimuth: 130, intensity: 2.2, color: 0xff9a4a },
    moon: { intensity: 1.9, color: 0xb4caf5 },
    density: { trees: .22, rocks: .6, grass: .8, buildings: 1.0 },
    enemyLevel: 1, enemyTypes: ['ashigaru', 'ronin', 'archer'], boss: 'wizard',
    ambient: 'ember',
    intro: 'Night, and smoke where the roofs were. Somewhere under it, a blade with your name on it.'
  },
  {
    id: 2, name: 'Verdant Reach', startPhase: 0.42, jp: '緑の果て', theme: 'grassland', art: 'savanna',
    music: 'world2', hub: true, size: 7200,
    subtitle: 'The plains that forgot the war',
    palette: { fog: 0xa9c5ac, sky: 0x74b0dd, ground: 0x4d7a35, grass: 0x74a844, water: 0x2f6f9e },
    sun: { elevation: 46, azimuth: 200, intensity: 1.6, color: 0xfff2d0 },
    density: { trees: .55, rocks: .3, grass: 1.4, buildings: .25 },
    enemyLevel: 6, enemyTypes: ['ashigaru', 'ronin', 'bandit', 'archer'], boss: 'oni_general',
    ambient: 'birds',
    intro: 'Grass to the horizon, and a child at the edge of it who will not stop looking for her parents.'
  },
  {
    id: 3, name: 'Everdark Wood', startPhase: 0.5, jp: '常闇の森', theme: 'forest', art: 'bamboo',
    music: 'world3', hub: true, size: 7600,
    subtitle: 'Beneath a roof of leaves',
    palette: { fog: 0x243a26, sky: 0x4c6b48, zenith: 0x1d3320,
               ground: 0x2a3c24, grass: 0x355c2c, water: 0x27503f },
    // Little of it reaches the floor: a low, green, filtered light.
    sun: { elevation: 58, azimuth: 240, intensity: .55, color: 0xc8dfa0 },
    density: { trees: 2.6, rocks: .45, grass: .5, buildings: .18 }, bamboo: 190,
    enemyLevel: 13, enemyTypes: ['ronin', 'bandit', 'shadow', 'archer', 'monk'], boss: 'forest_warden',
    ambient: 'forest', motes: 0x9fe8b0, kodama: 14,
    intro: 'The canopy holds the light out. Whatever lives here has never needed eyes.'
  },
  {
    id: 4, name: 'Sunless Waste', startPhase: 0.46, jp: '陽無き荒野', theme: 'desert', art: 'desert',
    music: 'world4', hub: true, size: 8400,
    subtitle: 'A sea that dried before memory',
    palette: { fog: 0xe0c48a, sky: 0x9ec9e8, ground: 0xc9a15c, grass: 0xa8894a, water: 0x2f8fa8 },
    sun: { elevation: 74, azimuth: 180, intensity: 2.1, color: 0xfff0c0 },
    density: { trees: .06, rocks: .9, grass: .2, buildings: .3 },
    enemyLevel: 21, enemyTypes: ['bandit', 'shadow', 'husk', 'crossbowman'], boss: 'dune_colossus',
    ambient: 'wind',
    intro: 'Dunes over drowned cities. The heat lies about distance.'
  },
  {
    id: 5, name: 'White Silence', startPhase: 0.34, jp: '白い沈黙', theme: 'snow', art: 'snow',
    music: 'world5', hub: true, size: 7800,
    subtitle: 'Where the story takes something from you',
    palette: { fog: 0xd8e4ef, sky: 0x9fc0e0, ground: 0xe8eef5, grass: 0xc0cfdc, water: 0x2a5a7f },
    sun: { elevation: 22, azimuth: 300, intensity: 1.1, color: 0xd8e8ff },
    density: { trees: .8, rocks: .6, grass: .1, buildings: .2 },
    enemyLevel: 30, enemyTypes: ['husk', 'shadow', 'frost_knight', 'crossbowman'], boss: 'frost_sovereign',
    ambient: 'wind', storyBeat: 'girl_dies',
    intro: 'Snow swallows sound. You will wish it had swallowed this too.'
  },
  {
    id: 6, name: 'Amber Plain', startPhase: 0.68, jp: '琥珀の原', theme: 'savanna', art: 'savanna',
    music: 'world6', hub: true, size: 8800,
    subtitle: 'Long grass, longer shadows',
    palette: { fog: 0xd9a860, sky: 0xe8b96a, ground: 0xa8813a, grass: 0xc9a04a, water: 0x3f7f8f },
    sun: { elevation: 36, azimuth: 260, intensity: 1.8, color: 0xffd090 },
    density: { trees: .3, rocks: .4, grass: 1.8, buildings: .2 },
    enemyLevel: 40, enemyTypes: ['frost_knight', 'husk', 'beast', 'oni', 'crossbowman'], boss: 'amber_beast',
    ambient: 'insects',
    intro: 'Nothing here hides. It simply waits until you are closer.'
  },
  {
    id: 7, name: 'Drowned Reach', startPhase: 0.3, jp: '沈んだ領', theme: 'ocean', art: 'ocean',
    music: 'world7', hub: true, size: 9200,
    subtitle: 'Islands over a swallowed empire',
    palette: { fog: 0xa8cfe0, sky: 0x5fa8d8, ground: 0xd8c9a0, grass: 0x6f9a5a, water: 0x1a6f9e },
    sun: { elevation: 30, azimuth: 100, intensity: 1.7, color: 0xffe0b0 },
    density: { trees: .5, rocks: .7, grass: .5, buildings: .35 }, water: true, waterLevel: 6,
    enemyLevel: 50, enemyTypes: ['beast', 'shadow', 'drowned', 'monk'], boss: 'tide_warden',
    ambient: 'waves',
    intro: 'The towers below still have lights in them. Do not look too long.'
  },
  {
    id: 8, name: 'Marble Dominion', startPhase: 0.48, jp: '大理石の領土', theme: 'roman', art: 'temple',
    music: 'world8', hub: true, size: 9600,
    subtitle: 'Temples without worshippers',
    palette: { fog: 0xd9cdb0, sky: 0x8fbfe0, ground: 0xb8a888, grass: 0x7f8f4a, water: 0x3f8fa8 },
    sun: { elevation: 52, azimuth: 220, intensity: 1.9, color: 0xfff2d8 },
    density: { trees: .25, rocks: .5, grass: .6, buildings: 1.6 },
    enemyLevel: 60, enemyTypes: ['drowned', 'legionary', 'shadow', 'crossbowman', 'oni'], boss: 'marble_praetor',
    ambient: 'wind',
    intro: 'Colonnades running to the horizon. Someone built all this to be remembered, and was not.'
  },
  {
    id: 9, name: 'The Iron Crown', startPhase: 0.72, jp: '鉄の冠', theme: 'kingdom', art: 'kingdom',
    music: 'world9', hub: true, size: 10400,
    subtitle: 'A kingdom in the teeth of the mountains',
    palette: { fog: 0x8f8a96, sky: 0x6f7f9f, ground: 0x6a6258, grass: 0x4f5a3a, water: 0x3a5060 },
    sun: { elevation: 26, azimuth: 320, intensity: 1.3, color: 0xffd0a0 },
    density: { trees: .4, rocks: 1.4, grass: .5, buildings: 2.0 }, mountains: 2.2,
    enemyLevel: 72, enemyTypes: ['legionary', 'frost_knight', 'kingsguard', 'sniper', 'oni'], boss: 'iron_king',
    ambient: 'wind',
    intro: 'The last throne standing. It is still warm, and that should frighten you.'
  },
  {
    id: 10, name: "Heaven's Anvil", startPhase: 0.44, jp: '天の金床', theme: 'sky', art: 'skyland',
    music: 'world10', hub: true, size: 8800,
    subtitle: 'Above the clouds, where He waits',
    palette: { fog: 0xd8e8f0, sky: 0x7fc0e8, ground: 0x7a6a58, grass: 0x5f9a4a, water: 0x8fd0e8 },
    sun: { elevation: 40, azimuth: 160, intensity: 2.0, color: 0xfff8e8 },
    density: { trees: .5, rocks: .8, grass: 1.0, buildings: .8 }, floating: true,
    enemyLevel: 88, enemyTypes: ['kingsguard', 'seraph', 'shadow', 'sniper'], boss: 'the_hollow_god',
    ambient: 'wind', final: true,
    intro: 'The islands do not fall because He has not told them to. He is at the far end of them.'
  }
];

export const worldById = id => WORLDS.find(w => w.id === id) || WORLDS[0];

/* ============================================================
   ENEMY ARCHETYPES
   ============================================================ */
export const ENEMIES = {
  /* Wears a chest until you open it. Fast, hits hard, pays out like a small
     boss - the deep wood punishes greed and then rewards nerve. */
  mimic:       { name: 'Hungering Chest', hp: 210, damage: 26, speed: 5.4, blockChance: 0, xp: 340, scale: 1.06, weapon: 'fist', armor: .18, aggro: 44, feral: true },
  ashigaru:    { name: 'Ashigaru', hp: 55,  damage: 8,  speed: 3.6, blockChance: .40, xp: 26,  scale: 1.0, weapon: 'spear',   armor: .1, aggro: 26 },
  ronin:       { name: 'Ronin',    hp: 80,  damage: 12, speed: 4.2, blockChance: .40, xp: 38,  scale: 1.02, weapon: 'katana', armor: .15, aggro: 30 },
  bandit:      { name: 'Bandit',   hp: 70,  damage: 11, speed: 4.8, blockChance: .40, xp: 34,  scale: .96, weapon: 'axe',     armor: .05, aggro: 32 },
  shadow:      { name: 'Shadow',   hp: 95,  damage: 16, speed: 5.6, blockChance: .40, xp: 52,  scale: 1.0, weapon: 'katana', armor: .1, aggro: 38, ghostly: true },
  husk:        { name: 'Husk',     hp: 140, damage: 14, speed: 2.9, blockChance: .40, xp: 58,  scale: 1.18, weapon: 'tetsubo', armor: .3, aggro: 24 },
  frost_knight:{ name: 'Frost Knight', hp: 190, damage: 22, speed: 3.8, blockChance: .40, xp: 84, scale: 1.12, weapon: 'sword', armor: .35, aggro: 30 },
  beast:       { name: 'Wilder',   hp: 160, damage: 20, speed: 6.2, blockChance: .40, xp: 78,  scale: 1.1, weapon: 'fist',    armor: .12, aggro: 40, feral: true },
  drowned:     { name: 'Drowned',  hp: 175, damage: 21, speed: 3.4, blockChance: .40, xp: 88,  scale: 1.06, weapon: 'spear',   armor: .2, aggro: 28 },
  legionary:   { name: 'Legionary',hp: 230, damage: 26, speed: 4.0, blockChance: .40, xp: 112, scale: 1.08, weapon: 'sword',   armor: .4, aggro: 32, shielded: true },
  kingsguard:  { name: 'Kingsguard', hp: 300, damage: 34, speed: 4.4, blockChance: .40, xp: 150, scale: 1.14, weapon: 'odachi', armor: .45, aggro: 34 },
  seraph:      { name: 'Seraph',   hp: 340, damage: 40, speed: 5.2, blockChance: .40, xp: 190, scale: 1.2, weapon: 'fire_sword', armor: .35, aggro: 44, flying: true },

  /* ranged skirmishers — they keep their distance and loose arrows */
  archer:      { name: 'Archer',   hp: 60,  damage: 14, speed: 4.4, blockChance: .40, xp: 40, scale: .98, weapon: 'bow',      armor: .05, aggro: 46, ranged: { range: 34, keepAway: 15, speed: 54, cooldown: [1.8, 3.2] } },
  crossbowman: { name: 'Crossbowman', hp: 110, damage: 30, speed: 3.4, blockChance: .40, xp: 76, scale: 1.02, weapon: 'crossbow', armor: .22, aggro: 50, ranged: { range: 44, keepAway: 19, speed: 76, cooldown: [2.6, 4.2] } },
  sniper:      { name: 'Sky Archer', hp: 200, damage: 46, speed: 5.0, blockChance: .40, xp: 140, scale: 1.05, weapon: 'stormbow', armor: .2, aggro: 60, ranged: { range: 60, keepAway: 26, speed: 92, cooldown: [2.2, 3.4] } },

  /* heavies */
  oni:         { name: 'Oni',      hp: 380, damage: 38, speed: 4.0, blockChance: .40, xp: 165, scale: 1.42, weapon: 'tetsubo', armor: .3, aggro: 36 },
  monk:        { name: 'Warrior Monk', hp: 210, damage: 26, speed: 5.4, blockChance: .40, xp: 104, scale: 1.0, weapon: 'spear', armor: .18, aggro: 38 }
};

/* ============================================================
   BOSSES
   ============================================================ */
export const BOSSES = {
  wizard: {
    name: 'The Purple Wizard', jp: '紫の魔術師', hp: 420, damage: 18, speed: 4.0, xp: 900,
    scale: 1.25, music: 'boss', phaseAt: .5, phaseEvent: 'wizard_cutscene',
    abilities: ['bolt', 'teleport', 'summon'], color: 0x7c3fbf, cloak: true,
    intro: 'He was already here when the village burned. He is not surprised to see you.'
  },
  oni_general: {
    name: 'Oni General Kurogane', hp: 1400, damage: 30, speed: 4.4, xp: 2200, scale: 1.5,
    music: 'boss', abilities: ['charge', 'slam'], color: 0x8f2a2a,
    intro: 'Three villages, one afternoon. He kept the count himself.'
  },
  forest_warden: {
    name: 'The Warden of Roots', hp: 2600, damage: 38, speed: 3.6, xp: 3800, scale: 1.8,
    music: 'boss', abilities: ['slam', 'summon'], color: 0x2f6a35,
    intro: 'The wood grew around something. That something has decided to walk.'
  },
  dune_colossus: {
    name: 'Colossus of the Waste', hp: 4200, damage: 48, speed: 3.0, xp: 5600, scale: 2.4,
    music: 'boss', abilities: ['slam', 'quake'], color: 0xb08040,
    intro: 'You mistook it for a rock formation for the last four kilometres.'
  },
  frost_sovereign: {
    name: 'The Frost Sovereign', hp: 6400, damage: 58, speed: 4.6, xp: 8200, scale: 1.7,
    music: 'boss', abilities: ['charge', 'bolt', 'quake'], color: 0x6fb0d8,
    killsGirl: true,
    intro: 'It does not speak. It has never needed to.'
  },
  amber_beast: {
    name: 'The Amber Beast', hp: 8800, damage: 66, speed: 6.4, xp: 11000, scale: 2.0,
    music: 'boss', abilities: ['charge', 'slam'], color: 0xd08a2a, feral: true,
    intro: 'Something the plain made when it was angry.'
  },
  tide_warden: {
    name: 'Warden of the Tide', hp: 12000, damage: 74, speed: 4.2, xp: 14500, scale: 2.2,
    music: 'boss', abilities: ['bolt', 'summon', 'quake'], color: 0x2a8fb0,
    intro: 'It has been holding the water back. It would like to stop.'
  },
  marble_praetor: {
    name: 'The Marble Praetor', hp: 16000, damage: 86, speed: 5.0, xp: 19000, scale: 1.9,
    music: 'boss', abilities: ['charge', 'slam', 'summon'], color: 0xd8cdb0,
    intro: 'Still holding the line for an empire that ended a thousand years ago.'
  },
  iron_king: {
    name: 'The Iron King', hp: 22000, damage: 98, speed: 5.4, xp: 26000, scale: 2.0,
    music: 'boss', abilities: ['charge', 'slam', 'bolt', 'quake'], color: 0x8f8a96,
    intro: 'He kept the crown by never once sitting down.'
  },
  the_hollow_god: {
    name: 'The Hollow God', jp: '虚ろな神', hp: 60000, damage: 120, speed: 6.0, xp: 100000,
    scale: 3.2, music: 'final', phaseAt: .66, phase2At: .33,
    abilities: ['bolt', 'summon', 'quake', 'slam', 'teleport', 'beam'], color: 0xf0e0ff,
    final: true,
    intro: 'It cast the first one down and has been emptying ever since. There is nothing inside it but the space where a name was.'
  }
};

/* ============================================================
   ABILITIES — bought at the hub, unlocked by rank
   ============================================================ */
export const ABILITIES = {
  wind_dash:   { id: 'wind_dash', name: 'Wind Dash', rank: 'E', price: 0, innate: true,
                 desc: 'Hold jump in the air to slow your fall, release to dash. Hitting an enemy launches you.' },
  double_jump: { id: 'double_jump', name: 'Second Wind', rank: 'D', price: 220,
                 desc: 'A second jump while airborne.' },
  parry:       { id: 'parry', name: 'Deflection', rank: 'D', price: 300,
                 desc: 'Blocking within 0.25s of a hit reflects it and staggers the attacker.' },
  ground_slam: { id: 'ground_slam', name: 'Ground Slam', rank: 'C', price: 520,
                 desc: 'Attack while falling to shockwave everything beneath you.' },
  execute:     { id: 'execute', name: 'Execution', rank: 'C', price: 640,
                 desc: 'Instantly kill enemies below 18% health.' },
  life_steal:  { id: 'life_steal', name: 'Bloodbind', rank: 'B', price: 980,
                 desc: 'Melee hits return 12% of damage as health.' },
  power_surge: { id: 'power_surge', name: 'Power Surge', rank: 'B', price: 1200,
                 desc: 'Power regenerates twice as fast and never fully empties.' },
  chain_dash:  { id: 'chain_dash', name: 'Chain Dash', rank: 'A', price: 1800,
                 desc: 'Wind Dash can be used twice before touching the ground.' },
  time_slip:   { id: 'time_slip', name: 'Time Slip', rank: 'A', price: 2400,
                 desc: 'Perfect blocks slow time around you for 2 seconds.' },
  forsaken:    { id: 'forsaken', name: "Forsaken's Rage", rank: 'S', price: 5000,
                 desc: 'Below 25% health, deal double damage and take 30% less.' }
};

/* ============================================================
   SHOP STOCK per hub, scaled by world
   ============================================================ */
export function shopStock(worldId) {
  const base = [
    { id: 'potion_hp', price: 30 }, { id: 'potion_stam', price: 22 },
    { id: 'potion_pow', price: 28 }, { id: 'food', price: 12 },
    { id: 'smoke_bomb', price: 45 }
  ];
  if (worldId >= 3) base.push({ id: 'katana', price: 260 }, { id: 'bow', price: 300 }, { id: 'wood_shield', price: 140 });
  if (worldId >= 4) base.push({ id: 'fire_bomb', price: 120 }, { id: 'knives', price: 90 }, { id: 'iron_shield', price: 420 });
  if (worldId >= 5) base.push({ id: 'axe', price: 560 }, { id: 'crossbow', price: 640 });
  if (worldId >= 6) base.push({ id: 'spear', price: 500 }, { id: 'thunder_bomb', price: 340 },
                             { id: 'naginata', price: 780 }, { id: 'ice_bomb', price: 260 });
  if (worldId >= 7) base.push({ id: 'odachi', price: 1400 }, { id: 'tower_shield', price: 1100 },
                             { id: 'chakram', price: 420 }, { id: 'poison_bomb', price: 500 });
  if (worldId >= 8) base.push({ id: 'fire_sword', price: 2200 }, { id: 'teleport_bomb', price: 700 },
                             { id: 'kusarigama', price: 2600 }, { id: 'frostblade', price: 2400 });
  if (worldId >= 9) base.push({ id: 'tetsubo', price: 3200 }, { id: 'stormbow', price: 3600 },
                             { id: 'greatbow', price: 6800 });
  if (worldId >= 10) base.push({ id: 'oni_shield', price: 7000 }, { id: 'potion_op', price: 900 });
  return base;
}

/* ============================================================
   CHEST LOOT TABLE
   ============================================================ */
export const LOOT = [
  { weight: 40, type: 'xp',      amount: [180, 900] },
  { weight: 34, type: 'shekels', amount: [60, 340] },
  { weight: 18, type: 'weapon' },
  { weight: 6,  type: 'consumable' },
  { weight: 2,  type: 'op' }
];

export const WEAPON_POOL_BY_WORLD = {
  1: ['sword', 'knives'],
  2: ['sword', 'katana', 'bow', 'knives', 'wood_shield'],
  3: ['katana', 'bow', 'axe', 'shuriken', 'wood_shield', 'warfan'],
  4: ['axe', 'crossbow', 'spear', 'iron_shield', 'fire_bomb', 'naginata'],
  5: ['spear', 'crossbow', 'iron_shield', 'fire_sword', 'thunder_bomb', 'ice_bomb', 'frostblade'],
  6: ['odachi', 'fire_sword', 'stormbow', 'tower_shield', 'chakram', 'naginata'],
  7: ['odachi', 'stormbow', 'tower_shield', 'teleport_bomb', 'kusarigama', 'poison_bomb'],
  8: ['tetsubo', 'stormbow', 'fire_sword', 'oni_shield', 'kusarigama', 'frostblade'],
  9: ['tetsubo', 'oni_shield', 'voidblade', 'thunder_bomb', 'greatbow'],
  10: ['voidblade', 'oni_shield', 'greatbow', 'potion_op']
};

/* ============================================================
   ANIMALS
   ============================================================ */
export const ANIMALS = {
  horse:     { name: 'Horse',      rideable: true, speed: 11, hp: 120, scale: 1.0, color: 0x5a3a24, worlds: [2, 3, 6, 8, 9] },
  elk:       { name: 'Great Elk',  rideable: true, speed: 13, hp: 140, scale: 1.15, color: 0x6a4a2a, antlers: true, worlds: [3, 5] },
  camel:     { name: 'Camel',      rideable: true, speed: 9,  hp: 160, scale: 1.1, color: 0xc9a06a, hump: true, worlds: [4, 6] },
  direwolf:  { name: 'Direwolf',   rideable: true, speed: 15, hp: 110, scale: .9, color: 0x6a6a72, worlds: [3, 5, 6] },
  kirin:     { name: 'Kirin',      rideable: true, speed: 18, hp: 220, scale: 1.2, color: 0xd8c070, glow: true, mythic: true, worlds: [7, 8, 9, 10] },
  tanuki:    { name: 'Tanuki',     rideable: false, speed: 6, hp: 40, scale: .4, color: 0x8a6a4a, worlds: [2, 3] },
  crane:     { name: 'Crane',      rideable: false, speed: 8, hp: 30, scale: .7, color: 0xf0f0f0, worlds: [2, 7] },
  cloudstag: { name: 'Cloud Stag', rideable: true, speed: 20, hp: 260, scale: 1.3, color: 0xe8f0ff, glow: true, mythic: true, worlds: [10] }
};

/* ============================================================
   NPC dialogue trees.
   Nodes: { text, choices:[{label, next, action, cond}] }
   ============================================================ */
export const DIALOGUE = {
  /* --- the lost girl, world 2 --- */
  girl_meet: {
    name: 'Lost Girl',
    start: 'a',
    nodes: {
      a: {
        text: "I've been walking since the smoke. I keep thinking if I go far enough I'll find where they went.",
        choices: [
          { label: 'Who are you looking for?', next: 'b' },
          { label: 'It is not safe out here.', next: 'b2' }
        ]
      },
      b: {
        text: "My mother and my father. They told me to run to the river and wait. I waited. It got dark twice.",
        choices: [{ label: '…', next: 'c' }]
      },
      b2: {
        text: "I know. I'm not stupid. But if I stop walking then it's true, isn't it. That they're gone.",
        choices: [{ label: '…', next: 'c' }]
      },
      c: {
        text: "You have a sword. Are you a soldier? You look like the ones who came through. But you're not, are you. You're something else.",
        choices: [
          { label: "I'm nobody's soldier. Not anymore.", next: 'd' },
          { label: "I'm the one they threw away.", next: 'd' }
        ]
      },
      d: {
        text: "Then we're the same. Nobody's looking for either of us.",
        choices: [
          { label: 'Come with me. Stay behind me and stay close.', next: 'join', action: 'girl_join' },
          { label: 'You would be safer here.', next: 'e' }
        ]
      },
      e: {
        text: "There isn't a here. There's just wherever I'm standing.",
        choices: [{ label: 'Then stand near me. Come on.', next: 'join', action: 'girl_join' }]
      },
      join: {
        text: "Okay. Okay. I'll keep up, I promise. I'm Hana.",
        choices: [{ label: 'Stay close, Hana.', next: null, action: 'close' }]
      }
    }
  },

  /* --- the girl's death, world 5 --- */
  girl_death: {
    name: 'Hana',
    start: 'a', unskippable: true, music: 'sorrow',
    nodes: {
      a: {
        text: "It's cold. It wasn't cold a minute ago.",
        choices: [{ label: "Don't talk. I've got you.", next: 'b' }]
      },
      b: {
        text: "You always say that. You said it in the wood, and in the sand, and you were right both times.",
        choices: [
          { label: "I'm right this time too.", next: 'c' },
          { label: 'Stay awake. Look at me.', next: 'c' }
        ]
      },
      c: {
        text: "I'm not scared. That's the strange part. I thought I'd be so scared.",
        choices: [{ label: '…', next: 'd' }]
      },
      d: {
        text: "Do you think they're somewhere? My mother and father. Do you think anyone is?",
        choices: [
          { label: 'Yes. I think someone is waiting for you.', next: 'e' },
          { label: "I don't know. I hope so.", next: 'e' }
        ]
      },
      e: {
        text: "Then I'll tell them you looked after me. I'll tell them you were good at it.",
        choices: [{ label: 'Hana—', next: 'f' }]
      },
      f: {
        text: "I .. love you.... dad",
        choices: [{ label: '…', next: null, action: 'girl_die' }]
      }
    }
  },

  /* --- hub NPCs --- */
  shopkeep: {
    name: 'Merchant Ozu', start: 'a',
    nodes: {
      a: {
        text: "You have the look of someone who has been paying for things with their body. I accept shekels instead.",
        choices: [
          { label: 'Show me your stock.', next: null, action: 'open_shop' },
          { label: "I'd like to sell something.", next: null, action: 'open_sell' },
          { label: 'What is this place?', next: 'b' },
          { label: 'Nothing for now.', next: null, action: 'close' }
        ]
      },
      b: {
        text: "A village that exists because the gate does. Everyone here walked out of somewhere worse. Nobody asks.",
        choices: [{ label: 'Understood.', next: 'a' }]
      }
    }
  },
  smith: {
    name: 'Oathkeeper Ren', start: 'a',
    nodes: {
      a: {
        text: "A class is only a shape you were beaten into. For the right price I can beat you into another.",
        choices: [
          { label: 'Change my class.', next: null, action: 'open_class_change' },
          { label: 'What does it cost?', next: 'b' },
          { label: 'Later.', next: null, action: 'close' }
        ]
      },
      b: {
        text: "Four hundred shekels and an afternoon of screaming. Your level stays. Your rank stays. Only the shape changes.",
        choices: [{ label: 'Do it.', next: null, action: 'open_class_change' }, { label: 'Not today.', next: null, action: 'close' }]
      }
    }
  },
  sage: {
    name: 'The Sage', start: 'a',
    nodes: {
      a: {
        text: "Rank is not a reward. It is permission — the world only teaches you what it thinks you can survive knowing.",
        choices: [
          { label: 'Show me what I can learn.', next: null, action: 'open_abilities' },
          { label: 'Who is the Hollow God?', next: 'b' },
          { label: 'Nothing.', next: null, action: 'close' }
        ]
      },
      b: {
        text: "The first thing that was ever cast out, and the last thing still doing the casting. Every gate you open is one He built to keep something in. Including you.",
        choices: [
          { label: 'Then I will open all of them.', next: 'c' },
          { label: 'How do I kill it?', next: 'c' }
        ]
      },
      c: {
        text: "You climb. Ten skies. And on the last one you will find that He has been forsaken longer than you have, and is much worse at bearing it.",
        choices: [{ label: '…', next: 'a' }]
      }
    }
  },
  broker: {
    name: 'Ash Broker', start: 'a',
    nodes: {
      a: {
        text: "Steel you cannot carry is steel you should not own. I turn it into experience and coin. No questions about where it came from.",
        choices: [
          { label: 'Sell items.', next: null, action: 'open_sell' },
          { label: 'Walk away.', next: null, action: 'close' }
        ]
      }
    }
  },
  gatekeeper: {
    name: 'Gatekeeper', start: 'a',
    nodes: {
      a: {
        text: "The gate reads what you are, not what you claim. Reach the fifth rank and it will let you through.",
        choices: [
          { label: 'Where does it lead?', next: 'b' },
          { label: 'Understood.', next: null, action: 'close' }
        ]
      },
      b: {
        text: "Upward. Always upward. Nobody has ever come back down to say what is at the top.",
        choices: [{ label: '…', next: null, action: 'close' }]
      }
    }
  },
  villager: {
    name: 'Villager', start: 'a',
    nodes: {
      a: {
        text: '%LINE%',
        choices: [
          { label: 'Do you need anything done?', next: null, action: 'offer_sidequest' },
          { label: 'Take care of yourself.', next: null, action: 'close' }
        ]
      }
    }
  }
};

export const VILLAGER_LINES = [
  "There's something out past the treeline that walks like a man and isn't.",
  "My brother went looking for a chest by the ridge. He found the key first. He did not find the chest.",
  "The horses out east will come to you if you're patient and carrying rice.",
  "It rains here when something dies badly. You'll learn to read it.",
  "Don't fight the ones in red head-on. They'll block, and then you're in the air.",
  "Rank is everything. The gate won't even look at you below Ascendant.",
  "Someone tried to sell me a purple potion once. I should have bought it.",
  "You get used to the sky being wrong. That's the part that worries me.",
  "There was a girl with you last I looked. Where'd she go?",
  "They say the wizard in the ash country wasn't the real one. Just something wearing the cloak."
];

export const SIDEQUESTS = [
  { id: 'cull',    name: 'Thin Their Numbers', kind: 'kill',   count: 8,  xp: 600,  shekels: 180,
    text: 'They come out of the grass at dusk. Kill eight and they will think twice.' },
  { id: 'chest',   name: 'What He Left Behind', kind: 'chest',  count: 2,  xp: 900,  shekels: 260,
    text: 'My father buried two chests before the burning. I cannot bring myself to look.' },
  { id: 'tame',    name: 'Bring Him Home',      kind: 'tame',   count: 1,  xp: 500,  shekels: 200,
    text: 'The grey one at the water. He was ours before the war. Gentle him for me.' },
  { id: 'boss',    name: 'The Thing In The Hills', kind: 'boss', count: 1, xp: 2400, shekels: 900,
    text: 'Something large has taken the high ground. It has stopped being a rumour.' },
  { id: 'gather',  name: 'Salvage',             kind: 'sell',   count: 5,  xp: 400,  shekels: 150,
    text: 'Sell five pieces of scrap to the broker. Even the dead can pay their way.' }
];

/* Loading-screen tips. The first one is fixed by request. */
export const TIPS = [
  'God and Jesus love you',
  'Slaying your enemies from behind will yield bonus points',
  'Hold jump in the air, then release to Wind Dash',
  'Blocking drains power. Empty power costs health.',
  'Enemies block roughly four times in ten. Bait it out.',
  'Keys are never kept beside the chest they open.',
  'Feed a wild animal and it will carry you.',
  'Every world you reach unlocks a new class.',
  'You can fight with nothing at all. It is simply harder.',
  'Reach the fifth rank and the gate will open.'
];
