/* Persistent progress.
 *
 * Everything lives in one JSON blob in localStorage. It is versioned and
 * migrated forward so an old save never hard-crashes a newer build. Writes
 * are debounced because the game autosaves on a lot of small events. */

const KEY = 'forsaken.save.v1';
const SETTINGS_KEY = 'forsaken.settings.v1';
export const SAVE_VERSION = 6;

export function freshSave() {
  return {
    version: SAVE_VERSION,
    created: Date.now(),
    playtime: 0,

    /* progression */
    classId: 'knight',
    unlockedClasses: ['knight'],
    level: 1, xp: 0, shekels: 40,
    rank: 'E',
    world: 1,
    unlockedWorlds: [1],
    worldSeeds: {},              // world -> seed, so a world regenerates identically
    abilities: ['wind_dash'],
    ownedAbilities: [],

    /* customisation — HSL so the colour wheel round-trips exactly */
    colors: {
      blade:  { h: 205, s: .10, l: .78 },
      handle: { h: 18,  s: .55, l: .22 }
    },

    /* inventory: 36 slots, first 4 mirror the hotbar */
    inventory: new Array(36).fill(null),
    hotbar: [0, 1, 2, 3],
    equipped: 0,

    /* per-world persistent state */
    worlds: {},                  // { [id]: { chestsOpened:[], bossDead:bool, discovered:bool } }

    /* story + mission flags */
    flags: {
      tutorialDone: false,
      kontanaFound: false,
      blockUnlocked: false,
      wizardDefeated: false,
      girlJoined: false,
      girlDead: false,
      finalDefeated: false,
      seenIntro: false,
      forgeDone: false
    },
    missions: { active: null, completed: [] },
    /* Verses of the poem that runs under all ten worlds. One per warden. */
    verses: [],
    /* Building material. Carried between worlds like everything else. */
    timber: 60,
    tutorial: {},
    sideQuests: {},

    /* transform — restored on continue */
    pos: null, yaw: 0,
    stats: { hp: 100, stamina: 100, power: 100 },

    /* stats for the profile / rank screen */
    kills: 0, bossKills: 0, deaths: 0, chestsOpened: 0, distance: 0
  };
}

export function defaultSettings() {
  return {
    masterVolume: .8, musicVolume: .55, sfxVolume: .85, muted: false,
    sensitivity: 1, padSensitivity: 1, invertY: false,
    fov: 78, renderScale: 1, shadows: true, quality: 'high',
    viewDistance: 1, motionBlur: true, subtitles: true, rumble: true
  };
}

/* ---------------- migration ---------------- */
function migrate(s) {
  if (!s || typeof s !== 'object') return freshSave();
  const base = freshSave();
  // Shallow-merge missing top-level keys, deep-merge the nested objects we own.
  const out = { ...base, ...s };
  out.colors = { ...base.colors, ...(s.colors || {}) };
  out.colors.blade = { ...base.colors.blade, ...(s.colors?.blade || {}) };
  out.colors.handle = { ...base.colors.handle, ...(s.colors?.handle || {}) };
  out.flags = { ...base.flags, ...(s.flags || {}) };
  out.stats = { ...base.stats, ...(s.stats || {}) };
  out.missions = { ...base.missions, ...(s.missions || {}) };
  out.tutorial = { ...(s.tutorial || {}) };
  if (!Array.isArray(out.inventory)) out.inventory = base.inventory;
  if (out.inventory.length < 36) {
    out.inventory = out.inventory.concat(new Array(36 - out.inventory.length).fill(null));
  }
  if (!Array.isArray(out.hotbar) || out.hotbar.length !== 4) out.hotbar = base.hotbar;
  if (!Array.isArray(out.unlockedWorlds) || !out.unlockedWorlds.length) out.unlockedWorlds = [1];
  if (!Array.isArray(out.unlockedClasses) || !out.unlockedClasses.length) out.unlockedClasses = ['knight'];
  out.version = SAVE_VERSION;
  return out;
}

/* ---------------- api ---------------- */
let _pending = null, _timer = null;

export const Save = {
  data: null,
  settings: null,

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      this.data = raw ? migrate(JSON.parse(raw)) : null;
    } catch (e) {
      console.warn('[save] corrupt save, starting fresh', e);
      this.data = null;
    }
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      this.settings = raw ? { ...defaultSettings(), ...JSON.parse(raw) } : defaultSettings();
    } catch { this.settings = defaultSettings(); }
    return this.data;
  },

  hasSave() {
    try { return !!localStorage.getItem(KEY); } catch { return false; }
  },

  start(fresh = false) {
    if (fresh || !this.data) this.data = freshSave();
    return this.data;
  },

  /** Debounced write — call freely. */
  write(immediate = false) {
    if (!this.data) return;
    _pending = this.data;
    if (immediate) return this._flush();
    if (_timer) return;
    _timer = setTimeout(() => this._flush(), 900);
  },

  _flush() {
    clearTimeout(_timer); _timer = null;
    if (!_pending) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(_pending));
    } catch (e) {
      console.warn('[save] write failed', e);
    }
    _pending = null;
  },

  writeSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch {}
  },

  wipe() {
    try { localStorage.removeItem(KEY); } catch {}
    this.data = null;
  },

  /** Per-world scratch state, created on demand. */
  world(id = this.data.world) {
    const w = this.data.worlds;
    if (!w[id]) w[id] = { chestsOpened: [], keysFound: [], bossDead: false, discovered: false, npcsMet: [] };
    return w[id];
  },

  /** Deterministic seed per world so terrain is identical across sessions. */
  seed(id = this.data.world) {
    const s = this.data.worldSeeds;
    if (!s[id]) s[id] = (Math.random() * 0xffffffff) >>> 0;
    return s[id];
  },

  export() { return btoa(unescape(encodeURIComponent(JSON.stringify(this.data)))); },
  import(str) {
    try {
      this.data = migrate(JSON.parse(decodeURIComponent(escape(atob(str)))));
      this.write(true); return true;
    } catch { return false; }
  }
};

/* Never lose progress on an accidental tab close. */
addEventListener('beforeunload', () => Save._flush());
addEventListener('visibilitychange', () => { if (document.hidden) Save._flush(); });
