/* The game: renderer, world lifecycle, entity streaming, interaction and
 * the two split-screen modes.
 *
 * Owns one THREE.Scene per world. Loading a world tears the old one down
 * completely so memory does not creep across ten of them. */

import * as THREE from 'three';
import { clamp, lerp, damp, makeRNG, wait, el } from '../core/util.js';
import { Audio } from '../core/audio.js';
import { Save } from '../core/save.js';
import {
  WORLDS, worldById, ENEMIES, BOSSES, ANIMALS, ITEMS, CLASSES,
  VILLAGER_LINES, rankFor, sellValue, xpValue
} from '../data/gamedata.js';
import { Terrain } from '../world/terrain.js';
import { Sky } from '../world/sky.js';
import { Props } from '../world/props.js';
import { VFX } from './vfx.js';
import { Player } from './player.js';
import { Missions, Story, Tutorial, GATE_LEVEL } from './missions.js';
import { Storm } from './storm.js';
import { Enemy, Boss, NPC, Companion, Animal, Chest, Pickup, Projectile, Ally } from '../entities/actors.js';
import { buildWeapon, buildPickup } from '../entities/models.js';
import { HUD, SplitHUD } from '../ui/hud.js';
import { InventoryUI, addItem, removeItem, countItem, hasSpace } from '../ui/inventory.js';
import { DialogueUI } from '../ui/dialogue.js';

const tmpV = new THREE.Vector3();

export class Game {
  constructor(canvas, input, screens) {
    this.canvas = canvas;
    this.input = input;
    this.screens = screens;
    this.audio = Audio;
    this.running = false;
    this.mode = 'single';        // single | coop | versus
    this.freeze = false;
    this.uiFocus = false;
    this.timeScale = 1;
    this._timeScaleTarget = 1;
    this.shakeAmt = 0;
    this.shakeT = 0;
    this.elapsed = 0;
    this.inCombat = false;
    this._combatT = 0;

    this.enemies = [];
    this.npcs = [];
    this.animals = [];
    this.chests = [];
    this.pickups = [];
    this.projectiles = [];
    this.hazards = [];        // lingering area effects (poison clouds)
    this.allies = [];         // knights fighting on your side
    this.companion = null;
    this.boss = null;

    this._initRenderer();

    this.hud = new HUD();
    this.inventory = new InventoryUI(this);
    this.dialogue = new DialogueUI(this);
    this.missions = new Missions(this);
    this.story = new Story(this);
    this.tutorial = new Tutorial(this);

    this._bindResize();

    // The loop runs from boot so menus get polled input; it early-returns
    // until a world is actually loaded and running.
    this._last = performance.now();
    this._loop();

    // Handy for debugging from the console.
    window.__game = this;
  }

  get save() { return Save.data; }
  get settings() { return Save.settings; }
  get listenerPos() { return this.player?.pos ?? new THREE.Vector3(); }

  /* ==========================================================
     Renderer
     ========================================================== */
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance', stencil: false
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Slightly under 1 so highlights roll off instead of clipping to white.
    this.renderer.toneMappingExposure = .92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowQuality = Save.settings?.quality ?? 'high';
    this.renderer.setScissorTest(false);

    // Far plane has to clear the sky dome and the cloud shell.
    this.cameras = [
      new THREE.PerspectiveCamera(78, 1, .1, 12000),
      new THREE.PerspectiveCamera(78, 1, .1, 12000)
    ];
    this._resize();
  }

  _bindResize() {
    addEventListener('resize', () => this._resize());
  }

  _resize() {
    const scale = this.settings?.renderScale ?? 1;
    const w = Math.floor(innerWidth * scale);
    const h = Math.floor(innerHeight * scale);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.viewW = w; this.viewH = h;
    this._updateCameraAspects();
  }

  _updateCameraAspects() {
    const split = this.mode !== 'single';
    for (const c of this.cameras) {
      c.aspect = this.viewW / (split ? this.viewH / 2 : this.viewH);
      c.fov = this.settings?.fov ?? 78;
      c.updateProjectionMatrix();
    }
  }

  applySettings(s) {
    this.renderer.shadowMap.enabled = s.shadows;
    this._resize();
    const q = s.quality;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'low' ? 1 : q === 'ultra' ? 2 : 1.5));
    this.renderer.shadowQuality = q;
    if (this.sky) this.sky.sun.castShadow = s.shadows;
    this.input.sensitivity = s.sensitivity;
    this.input.padSensitivity = s.padSensitivity;
    this.input.invertY = s.invertY;
  }

  /* ==========================================================
     World lifecycle
     ========================================================== */
  async loadWorld(worldId, { skipFade = false, spawnPos = null, intro = true } = {}) {
    this.loading = true;
    if (!skipFade) await this.hud.cine.fadeTo('black', 900);

    this._teardownWorld();

    const world = worldById(worldId);
    this.world = world;
    Save.data.world = worldId;
    if (!Save.data.unlockedWorlds.includes(worldId)) Save.data.unlockedWorlds.push(worldId);

    // Unlock the class tied to this world.
    const cls = CLASSES.find(c => c.unlockWorld === worldId);
    if (cls && !Save.data.unlockedClasses.includes(cls.id)) {
      Save.data.unlockedClasses.push(cls.id);
      setTimeout(() => this.hud.toast(`CLASS UNLOCKED — ${cls.name.toUpperCase()}`, true), 3000);
    }

    this.scene = new THREE.Scene();
    const seed = Save.seed(worldId);
    this.seed = seed;
    this.rng = makeRNG(seed);

    const q = this.settings.quality;
    this.terrain = new Terrain(this.scene, world, seed, q);
    this.sky = new Sky(this.scene, world, this.renderer);
    this.props = new Props(this.scene, this.terrain, world, seed, q);
    this.vfx = new VFX(this.scene);

    /* --- player --- */
    if (!this.player) {
      this.player = new Player(this, this.cameras[0], 0);
      this.scene.add(this.cameras[0]);
    } else {
      // Re-parent the existing camera and view model into the new scene.
      this.scene.add(this.cameras[0]);
    }
    if (this.mode !== 'single' && !this.player2) {
      this.player2 = new Player(this, this.cameras[1], 1);
      this.player2.giveLoadout(this.mode === 'versus' ? 'versus' : 'coop');
    }
    if (this.player2) this.scene.add(this.cameras[1]);

    const spawn = spawnPos || this._clearSpawn(world);
    this.terrain.ensureAround(new THREE.Vector3(spawn.x, spawn.y, spawn.z));
    this.player.spawnAt(new THREE.Vector3(spawn.x, spawn.y, spawn.z), Math.PI);
    this.player.refreshStats();
    this.player.syncViewModel();
    if (this.player2) this.player2.spawnAt(new THREE.Vector3(spawn.x + 4, spawn.y, spawn.z), Math.PI);

    this._populate(world);
    this.missions.buildFor(worldId);

    // Restore Hana if she is with us and still alive.
    if (Save.data.flags.girlJoined && !Save.data.flags.girlDead && worldId >= 2 && worldId <= 5) {
      this.spawnCompanion();
    }

    Audio.play(this.props.inHub(this.player.pos) ? 'hub' : world.music);
    Audio.startWind();

    Save.write(true);
    this.loading = false;

    if (!skipFade) {
      await this.hud.cine.fadeFrom(1400);
      if (intro) await this.story.worldIntro(worldId);
    }
    this.hud.show(true);
  }

  /** Ground that is flat, in the open, and not inside a building. */
  _clearSpawn(world) {
    const near = world.hub
      ? { x: this.props.hubCenter.x, z: this.props.hubCenter.z + 40 }
      : { x: this.props.hubCenter.x, z: this.props.hubCenter.z };
    for (let i = 0; i < 90; i++) {
      const s = this.terrain.findSpawn(near, 40 + i * 4);
      if (!this.props.collideAt(s.x, s.z, 3.5)) return s;
    }
    return this.terrain.findSpawn(near, 220);
  }

  _teardownWorld() {
    for (const list of [this.enemies, this.npcs, this.animals, this.chests, this.pickups, this.allies]) {
      for (const a of list) a.dispose?.();
      list.length = 0;
    }
    for (const p of this.projectiles) p.root?.parent?.remove(p.root);
    this.projectiles.length = 0;
    this.hazards.length = 0;
    if (this.storm) { this.storm.dispose(); this.storm = null; }
    if (this.companion) { this.companion.dispose(); this.companion = null; }
    this.boss = null;
    this.hud.setBoss(null);

    this.vfx?.dispose();
    this.props?.dispose();
    this.sky?.dispose();
    this.terrain?.dispose();
    if (this.scene) {
      // Detach cameras so their view models survive the world swap.
      for (const c of this.cameras) if (c.parent) c.parent.remove(c);
      this.scene.clear();
    }
    this.scene = null;
  }

  /* ==========================================================
     Population
     ========================================================== */
  _populate(world) {
    const rng = this.rng;
    const lvlScale = 1 + (world.enemyLevel - 1) * .1;
    this.enemyLevelScale = lvlScale;

    /* --- NPCs in the hub --- */
    if (world.hub) {
      const c = this.props.hubCenter;
      const roles = [
        { tree: 'shopkeep', displayName: 'Merchant Ozu', look: { cloth: 0x6a4a2a, accent: 0xc9a44a } },
        { tree: 'smith', displayName: 'Oathkeeper Ren', look: { cloth: 0x3a3a44, armor: 0x7a7a84, accent: 0xb03225 } },
        { tree: 'sage', displayName: 'The Sage', look: { cloth: 0x2a2a3a, cloak: true, cloakColor: 0x4a3f6a } },
        { tree: 'broker', displayName: 'Ash Broker', look: { cloth: 0x4a3a2a, accent: 0x8a6a2a } },
        { tree: 'gatekeeper', displayName: 'Gatekeeper', look: { cloth: 0x2a3a4a, armor: 0x6a7a8a } }
      ];
      roles.forEach((r, i) => {
        const a = (i / roles.length) * 6.28 + .3;
        const x = c.x + Math.cos(a) * 11, z = c.z + Math.sin(a) * 11;
        this.npcs.push(new NPC(this, new THREE.Vector3(x, 0, z), r));
      });
      // Villagers with side quests.
      for (let i = 0; i < 7; i++) {
        const a = rng() * 6.28, r = rng.range(18, 52);
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        this.npcs.push(new NPC(this, new THREE.Vector3(x, 0, z), {
          tree: 'villager', displayName: 'Villager', qid: i,
          line: VILLAGER_LINES[(i + world.id) % VILLAGER_LINES.length],
          look: { cloth: [0x6a5a44, 0x4a5a4a, 0x5a4a5a][i % 3] }
        }));
      }
    }

    /* --- the lost girl, world 2 --- */
    if (world.id === 2 && !Save.data.flags.girlJoined && !Save.data.flags.girlDead) {
      const c = this.props.hubCenter;
      const p = this.terrain.findSpawn({ x: c.x + 70, z: c.z + 40 }, 30);
      const girl = new NPC(this, new THREE.Vector3(p.x, 0, p.z), {
        tree: 'girl_meet', displayName: 'Lost Girl',
        look: { cloth: 0x8a4a5a, armor: 0x8a4a5a, accent: 0xd8a0b0, skin: 0xdcae8a }
      });
      girl.root.scale.setScalar(.62);
      girl.isGirl = true;
      this.npcs.push(girl);
      this.girlNPC = girl;
    }

    /* --- roaming enemies --- */
    const target = world.tutorial ? 30 : 26;
    for (let i = 0; i < target; i++) this._spawnRoamer(true);

    /* --- friendly knights: world one is a battle, not an ambush --- */
    if (world.tutorial) {
      for (let i = 0; i < 9; i++) this._spawnAlly(true);
    }

    /* --- the world 1 kontana --- */
    if (world.id === 1 && !Save.data.flags.kontanaFound) {
      const p = this.terrain.findSpawn({ x: this.props.hubCenter.x, z: this.props.hubCenter.z }, 220);
      this.kontanaPos = new THREE.Vector3(p.x, p.y, p.z);
      const pk = new Pickup(this, this.kontanaPos.clone(), 'kontana', 1);
      pk.isKontana = true;
      pk.life = Infinity;
      // A pillar of light so it can be found from a distance.
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(.7, .7, 40, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffd48a, transparent: true, opacity: .18, side: THREE.DoubleSide, depthWrite: false })
      );
      beam.position.y = 20;
      pk.root.add(beam);
      this.pickups.push(pk);
    }

    /* --- boss --- */
    const wstate = Save.world(world.id);
    if (world.boss && !wstate.bossDead) {
      let bp;
      if (world.id === 1) {
        const p = this.terrain.findSpawn({ x: this.props.hubCenter.x - 160, z: this.props.hubCenter.z + 120 }, 90);
        bp = new THREE.Vector3(p.x, p.y, p.z);
      } else {
        const a = rng() * 6.28, r = world.size * .28;
        const p = this.terrain.findSpawn({ x: Math.cos(a) * r, z: Math.sin(a) * r }, 200);
        bp = new THREE.Vector3(p.x, p.y, p.z);
      }
      this.bossSpawn = bp;
      this.boss = new Boss(this, bp, world.boss, lvlScale);
      this.enemies.push(this.boss);
    }

    /* --- animals --- */
    const animalTypes = Object.entries(ANIMALS).filter(([, a]) => a.worlds.includes(world.id));
    if (animalTypes.length) {
      for (let i = 0; i < 16; i++) {
        const [id] = rng.pick(animalTypes);
        const a = rng() * 6.28, r = rng.range(80, world.size * .35);
        const p = this.terrain.findSpawn({ x: Math.cos(a) * r, z: Math.sin(a) * r }, 120);
        this.animals.push(new Animal(this, new THREE.Vector3(p.x, p.y, p.z), id));
      }
    }

    /* --- chests and keys (every world but the first) --- */
    if (world.id > 1) {
      const opened = new Set(wstate.chestsOpened);
      const n = 22 + world.id * 2;
      for (let i = 0; i < n; i++) {
        const a = rng() * 6.28, r = rng.range(60, world.size * .42);
        const p = this.terrain.findSpawn({ x: Math.cos(a) * r, z: Math.sin(a) * r }, 160);
        const locked = rng.chance(.42);
        const chest = new Chest(this, new THREE.Vector3(p.x, p.y, p.z), { locked, id: world.id * 1000 + i });
        if (opened.has(chest.id)) { chest.opened = true; chest.lidAngle = -2.1; }
        this.chests.push(chest);

        // Keys are placed 90-220m away — findable, never adjacent.
        if (locked && !opened.has(chest.id)) {
          const ka = rng() * 6.28, kr = rng.range(90, 220);
          const kp = this.terrain.findSpawn({ x: p.x + Math.cos(ka) * kr, z: p.z + Math.sin(ka) * kr }, 60);
          const key = new Pickup(this, new THREE.Vector3(kp.x, kp.y, kp.z), 'key', 1);
          key.life = Infinity;
          this.pickups.push(key);
        }
      }
    }
  }

  /** Natural respawn: keeps enemy density up without ever spawning on-screen. */
  _spawnRoamer(initial = false) {
    const w = this.world;
    if (!w) return null;
    const rng = this.rng;
    const types = w.enemyTypes;
    const p = this.player;

    let pos = null;
    for (let i = 0; i < 24; i++) {
      const a = rng() * 6.28;
      const r = initial ? rng.range(60, Math.min(900, w.size * .3)) : rng.range(70, 150);
      const base = initial ? { x: 0, z: 0 } : p.pos;
      const x = base.x + Math.cos(a) * r, z = base.z + Math.sin(a) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) > this.terrain.half - 60) continue;
      if (!this.terrain.isFlatGround(x, z, .38)) continue;
      if (this.props.inHub(tmpV.set(x, 0, z), 95)) continue;
      if (!initial && Math.hypot(x - p.pos.x, z - p.pos.z) < 62) continue;
      pos = new THREE.Vector3(x, this.terrain.heightAt(x, z), z);
      break;
    }
    if (!pos) return null;

    // Rare unique bosses roam too, but far less often.
    if (!initial && rng.chance(.035) && !this.roamingBoss) {
      const ids = Object.keys(BOSSES).filter(k => !BOSSES[k].final && k !== w.boss);
      const b = new Boss(this, pos, rng.pick(ids), this.enemyLevelScale * .55);
      b.isRoaming = true;
      this.enemies.push(b);
      this.roamingBoss = b;
      this.hud.toast('SOMETHING LARGE HAS TAKEN NOTICE');
      return b;
    }

    const e = new Enemy(this, pos, rng.pick(types), this.enemyLevelScale);
    this.enemies.push(e);
    return e;
  }

  /** Put a friendly knight into the fight near the player. */
  _spawnAlly(initial = false) {
    if (this.allies.length >= 12) return null;
    const rng = this.rng;
    const base = initial ? this.props.hubCenter : this.player.pos;
    for (let i = 0; i < 24; i++) {
      const a = rng() * 6.28;
      const r = initial ? rng.range(20, 120) : rng.range(30, 70);
      const x = base.x + Math.cos(a) * r, z = base.z + Math.sin(a) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) > this.terrain.half - 60) continue;
      if (!this.terrain.isFlatGround(x, z, .4)) continue;
      const kind = rng.chance(.18) ? 'captain' : rng.chance(.3) ? 'bowman' : 'knight';
      const p = new THREE.Vector3(x, this.terrain.heightAt(x, z), z);
      const ally = new Ally(this, p, kind, this.enemyLevelScale);
      this.allies.push(ally);
      return ally;
    }
    return null;
  }

  /** Nearest living ally, so enemies have someone else to swing at. */
  nearestAlly(pos, maxDist = 40) {
    let best = null, bd = maxDist;
    for (const a of this.allies) {
      if (a.dead) continue;
      const d = a.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  spawnEnemy(pos, typeId) {
    if (this.enemies.length > 70) return null;
    const e = new Enemy(this, pos, typeId, this.enemyLevelScale);
    this.enemies.push(e);
    return e;
  }

  spawnCompanion() {
    if (this.companion || Save.data.flags.girlDead) return;
    const p = this.player.pos.clone();
    p.x += 2; p.z += 2;
    p.y = this.terrain.heightAt(p.x, p.z);
    this.companion = new Companion(this, p);
    if (this.girlNPC) {
      this.girlNPC.dispose();
      this.npcs.splice(this.npcs.indexOf(this.girlNPC), 1);
      this.girlNPC = null;
    }
  }

  spawnProjectile(opts) {
    const p = new Projectile(this, opts);
    this.projectiles.push(p);
    return p;
  }

  /** A lingering damage-over-time volume, e.g. a poison cloud. */
  addHazard(h) { this.hazards.push({ ...h, t: 0 }); return h; }

  _updateHazards(dt) {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.life -= dt;
      h.t += dt;
      // Tick damage twice a second rather than every frame.
      if (h.t >= .5) {
        h.t = 0;
        for (const e of this.enemies) {
          if (!e.dead && e.pos.distanceTo(h.pos) < h.radius) {
            e.takeHit(h.dps * .5, h.pos, { canBeBlocked: false, attacker: h.owner });
          }
        }
        this.vfx.magicBurst(
          h.pos.clone().add(new THREE.Vector3((Math.random() - .5) * h.radius, .5,
            (Math.random() - .5) * h.radius)), h.color, 12);
      }
      if (h.life <= 0) this.hazards.splice(i, 1);
    }
  }

  spawnPickup(pos, itemId, qty = 1) {
    const p = new Pickup(this, pos, itemId, qty);
    this.pickups.push(p);
    return p;
  }

  dropItemInWorld(itemId, qty = 1) {
    if (!this.player) return;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cameras[0].quaternion);
    const p = this.player.pos.clone().addScaledVector(dir, 2).setY(this.player.pos.y + 1);
    this.spawnPickup(p, itemId, qty);
    this.hud.toast(`DROPPED ${ITEMS[itemId]?.name.toUpperCase() || itemId}`);
  }

  collectPickup(pk) {
    if (pk.collected) return;
    const def = ITEMS[pk.itemId];
    if (!hasSpace(Save.data.inventory, pk.itemId, pk.qty)) {
      this.hud.toast('INVENTORY FULL');
      return;
    }
    pk.collected = true;
    pk.remove = true;
    addItem(Save.data.inventory, pk.itemId, pk.qty);
    Audio.sfx('pickup');
    this.hud.toast(`${def.name.toUpperCase()}${pk.qty > 1 ? ' ×' + pk.qty : ''}`);
    this.syncHotbar();

    if (pk.isKontana) this._onKontana();
    Save.write();
  }

  _onKontana() {
    Save.data.flags.kontanaFound = true;
    Save.data.flags.blockUnlocked = true;
    // Put it straight into the first slot so the player can use it now.
    const inv = Save.data.inventory;
    const at = inv.findIndex(s => s?.id === 'kontana');
    if (at > 3) { const tmp = inv[0]; inv[0] = inv[at]; inv[at] = tmp; }
    this.player.setEquipped(0);
    Save.write(true);
    Audio.sfx('rankUp');
    this.hud.toast('KONTANA — YOU CAN NOW GUARD', true);
    setTimeout(() => this.hud.toast('HOLD RIGHT MOUSE OR L2 TO GUARD'), 2400);
  }

  consumeKey() {
    if (countItem(Save.data.inventory, 'key') <= 0) return false;
    removeItem(Save.data.inventory, 'key', 1);
    this.syncHotbar();
    return true;
  }

  /* ==========================================================
     Callbacks from actors
     ========================================================== */
  onEnemyKilled(e) {
    Save.data.kills++;
    this.grantXP(e.xp);
    const coins = Math.round(e.xp * .5 * (this.player.cls.id === 'emperor' ? 1.4 : 1));
    Save.data.shekels += coins;

    if (e.isBoss) {
      Save.data.bossKills++;
      this.hud.setBoss(null);
      if (e === this.boss) {
        Save.world().bossDead = true;
        this.missions.onBossKill(e);
        this.boss = null;
        if (this.world.final) { this.story.ending(); return; }
        Audio.play(this.world.music);
        this.hud.toast(`${e.name.toUpperCase()} HAS FALLEN`, true);
      } else if (e.isRoaming) {
        this.roamingBoss = null;
        this.missions.onBossKill(e);
      }
      // Bosses always drop something worth having.
      const pool = ['potion_op', 'potion_hp', 'potion_hp', 'key', 'key'];
      for (const id of pool) this.spawnPickup(e.pos.clone().setY(e.pos.y + 1), id, 1);
    } else {
      this.missions.onKill(e);
      // Ordinary drops.
      if (Math.random() < .22) {
        const pool = ['potion_hp', 'potion_stam', 'potion_pow', 'key', 'knives', 'food'];
        this.spawnPickup(e.pos.clone().setY(e.pos.y + 1),
          pool[Math.floor(Math.random() * pool.length)], 1);
      }
    }
    Save.write();
  }

  onBossPhase(boss, phase) {
    if (boss.bdef.phaseEvent === 'wizard_cutscene' && phase === 2) {
      this.story.wizardInterlude();
      // The wizard vanishes with the player.
      boss.dead = true; boss.remove = true;
      boss.root.parent?.remove(boss.root);
      this.boss = null;
      return;
    }
    Audio.sfx('bossRoar');
    this.hud.toast(`${boss.name.toUpperCase()} — PHASE ${phase}`, true);
    this.shake(1.4, 1);

    // World 5: the Frost Sovereign takes Hana.
    if (boss.bdef.killsGirl && this.companion && !Save.data.flags.girlDead) {
      this.story.girlDeathSequence();
    }
  }

  onPlayerDeath(player) {
    if (this.mode === 'versus') return this._versusDown(player);
    this.hud.cine.death(true);
    Audio.play('sorrow', { fade: 1 });
    setTimeout(async () => {
      await this.hud.cine.fadeTo('black', 1400);
      this.hud.cine.death(false);
      // Respawn at the hub (or the world start) with the wake-up cutscene.
      const spawn = this.world.hub
        ? this.terrain.findSpawn({ x: this.props.hubCenter.x, z: this.props.hubCenter.z + 30 }, 30)
        : this.terrain.findSpawn({ x: 0, z: 0 }, 60);
      player.spawnAt(new THREE.Vector3(spawn.x, spawn.y, spawn.z), Math.PI);
      // Death costs a slice of your purse, never your progress.
      Save.data.shekels = Math.floor(Save.data.shekels * .85);
      Save.write(true);
      Audio.play(this.world.music);
      await this.story.spawnCutscene({ firstTime: false });
    }, 2600);
  }

  /** A duellist fell: award the point, check for a winner, respawn. */
  _versusDown(loser) {
    const winner = loser === this.player ? 1 : 0;
    this.versusScore[winner]++;
    Audio.sfx('rankUp');
    this.hud.toast(`PLAYER ${winner + 1} SCORES — ${this.versusScore[0]} : ${this.versusScore[1]}`, true);
    this._paintVersusScore();

    if (this.versusScore[winner] >= 5) {
      this.freeze = true;
      this.hud.toast(`PLAYER ${winner + 1} WINS`, true);
      Audio.play('victory');
      setTimeout(() => {
        this.freeze = false;
        this.versusScore = [0, 0];
        this._paintVersusScore();
        this._versusRespawn(this.player, -8);
        this._versusRespawn(this.player2, 8);
      }, 5000);
      return;
    }
    setTimeout(() => this._versusRespawn(loser, loser === this.player ? -8 : 8), 1800);
  }

  _versusRespawn(p, offset) {
    if (!p) return;
    // Always come back inside the storm, never into the wall.
    const c = this.storm ? this.storm.center : this.props.hubCenter;
    const reach = this.storm ? Math.min(Math.abs(offset), this.storm.radius * .55) : Math.abs(offset);
    const dir = Math.sign(offset) || 1;
    const pos = new THREE.Vector3(c.x + dir * reach, 0, c.z + (Math.random() - .5) * reach * .6);
    pos.y = this.terrain.heightAt(pos.x, pos.z);
    p.spawnAt(pos, offset < 0 ? Math.PI / 2 : -Math.PI / 2);
    this.vfx.teleportFlash(pos.clone().setY(pos.y + 1));
    Audio.sfx('teleport');
  }

  _paintStormHUD() {
    const st = this.storm.status();
    this._stormEl ??= (() => {
      const n = el('div');
      n.id = 'stormhud';
      document.getElementById('layer-game').appendChild(n);
      return n;
    })();
    const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this._stormEl.innerHTML = st.closing
      ? `<b class="closing">CLOSING</b> <span>${mmss(st.seconds)}</span>`
      : `<b>PHASE ${st.phase}/${st.phases}</b> <span>${mmss(st.seconds)}</span>`;
    this._stormEl.classList.toggle('urgent', st.closing);

    // Tell whoever is caught outside how far they have to run.
    this.splitHUD?.forEach((h, i) => {
      const p = i === 0 ? this.player : this.player2;
      if (!p) return;
      const out = this.storm.distanceOutside(p);
      h.setStorm(out > 0 ? Math.ceil(out) : 0);
    });
  }

  _paintVersusScore() {
    this._vsEl ??= (() => {
      const n = el('div');
      n.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
        'font-family:Cinzel,serif;font-size:26px;letter-spacing:.3em;color:#f4ece0;' +
        'background:rgba(6,5,4,.7);padding:6px 26px;text-shadow:0 2px 10px #000;' +
        'pointer-events:none;z-index:25';
      document.getElementById('layer-game').appendChild(n);
      return n;
    })();
    this._vsEl.textContent = `${this.versusScore[0]}  —  ${this.versusScore[1]}`;
    this._vsEl.style.display = this.mode === 'versus' ? 'block' : 'none';
  }

  onMissionComplete(m) {
    this.grantXP(300 + Save.data.world * 120);
    Save.data.shekels += 80 + Save.data.world * 40;
  }

  onAnimalTamed(a) {
    this.hud.toast(`${a.name.toUpperCase()} TRUSTS YOU — E TO RIDE`, true);
    this.missions.onTamed();
  }

  onSold() { this.missions.onSold(); }

  onDialogueClosed(treeId) {
    if (treeId === 'girl_meet' && Save.data.flags.girlJoined) this.spawnCompanion();
  }

  onInventoryClosed() {
    this.setUIFocus(false);
    this.syncHotbar();
  }

  onLevelUp(level) {
    const need = GATE_LEVEL[this.world.id];
    if (need && level === need) this.hud.toast('THE GATE WILL OPEN FOR YOU NOW', true);
  }

  grantXP(n) { this.player?.gainXP(n); }
  saveNow() { Save.write(); }
  bossName(id) { return BOSSES[id]?.name; }

  nearestEnemy(pos, maxDist = 50) {
    let best = null, bd = maxDist;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = e.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  nearestAnimal(pos, maxDist = 8) {
    let best = null, bd = maxDist;
    for (const a of this.animals) {
      const d = a.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  /* ==========================================================
     Interaction
     ========================================================== */
  _findInteractable(player) {
    let best = null, bd = 5;
    const check = (a, range, label, act) => {
      const d = a.pos.distanceTo(player.pos);
      if (d < Math.min(range, bd)) { bd = d; best = { actor: a, label, act }; }
    };
    for (const n of this.npcs) check(n, n.interactRange, `Talk to ${n.displayName}`, () => {
      this.setUIFocus(true);
      this.dialogue.start(n.tree, n);
    });
    for (const c of this.chests) if (!c.opened) check(c, c.interactRange, c.locked ? 'Unlock chest' : 'Open chest', () => this._openChest(c));
    for (const a of this.animals) {
      if (a.tamed && a.def.rideable) check(a, a.interactRange, `Ride ${a.name}`, () => player.mountAnimal(a));
      else if (!a.tamed) check(a, a.interactRange, `Feed ${a.name} (F with rice)`, () => {
        if (countItem(Save.data.inventory, 'food') > 0) {
          removeItem(Save.data.inventory, 'food', 1);
          a.tame(); this.onAnimalTamed(a); this.syncHotbar();
        } else { Audio.sfx('uiDeny'); this.hud.toast('YOU NEED RICE'); }
      });
    }
    for (const p of this.pickups) check(p, p.interactRange, `Take ${ITEMS[p.itemId]?.name}`, () => this.collectPickup(p));
    if (this.props.gatePos && !this.world.final) {
      const d = this.props.gatePos.distanceTo(player.pos);
      const need = GATE_LEVEL[this.world.id] ?? 45;
      if (d < 7 && d < bd) {
        best = {
          actor: { pos: this.props.gatePos },
          label: Save.data.level >= need ? 'Step through the gate' : `The gate is sealed — level ${need}`,
          act: () => {
            if (Save.data.level >= need) this.travelToNextWorld();
            else { Audio.sfx('uiDeny'); this.hud.toast(`REACH LEVEL ${need}`); }
          }
        };
      }
    }
    return best;
  }

  _openChest(chest) {
    const loot = chest.open(this.player);
    if (!loot) return;
    Save.world().chestsOpened.push(chest.id);
    Save.data.chestsOpened++;
    this.missions.onChestOpened();

    if (loot.type === 'xp') {
      this.grantXP(loot.amount);
      this.hud.toast(`+${loot.amount} EXPERIENCE`, true);
    } else if (loot.type === 'shekels') {
      Save.data.shekels += loot.amount;
      Audio.sfx('coin');
      this.hud.toast(`+${loot.amount} SHEKELS`, true);
    } else {
      const p = chest.pos.clone().setY(chest.pos.y + 1.2);
      this.spawnPickup(p, loot.id, loot.qty);
      const def = ITEMS[loot.id];
      this.hud.toast(def.rarity === 'legend' ? `${def.name.toUpperCase()} — LEGENDARY` : def.name.toUpperCase(), true);
    }
    Save.write();
  }

  /* ==========================================================
     Travel
     ========================================================== */
  async travelToNextWorld() {
    const next = this.world.id + 1;
    if (next > 10) return;
    Audio.sfx('gate');
    await wait(600);
    this.hud.show(false);
    await this.loadWorld(next);
    await this.story.spawnCutscene({ firstTime: false });
  }

  /* ==========================================================
     Camera helpers
     ========================================================== */
  shake(amount, time) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
    this.shakeT = Math.max(this.shakeT, time);
  }

  setTimeScale(scale, duration) {
    this.timeScale = scale;
    this._timeScaleTarget = 1;
    this._timeScaleT = duration;
  }

  rumble(index, strong, weak, ms) {
    if (this.settings.rumble) this.input.rumble(index, strong, weak, ms);
  }

  /** Smoothly aim the player's view at a world point (cutscenes). */
  lookAt(target, time = 1) {
    const p = this.player;
    const dir = tmpV.copy(target).sub(p.pos);
    const yaw = Math.atan2(dir.x, dir.z) + Math.PI;
    const pitch = Math.atan2(dir.y - 1.6, Math.hypot(dir.x, dir.z));
    this._lookTarget = { yaw, pitch, t: time };
  }

  setUIFocus(on) {
    this.uiFocus = on;
    if (on) this.input.releaseLock();
    else if (this.running && this.mode !== 'versus') this.input.requestLock();
  }

  /* ==========================================================
     Main loop
     ========================================================== */
  start(mode = 'single') {
    this.mode = mode;
    document.body.classList.toggle('split', mode !== 'single');
    if (mode !== 'single' && !this.splitHUD) {
      this.splitHUD = [new SplitHUD('top'), new SplitHUD('bottom')];
      this.splitHUD[0].setLabel('PLAYER ONE');
      this.splitHUD[1].setLabel('PLAYER TWO');
    } else if (mode === 'single' && this.splitHUD) {
      this.splitHUD.forEach(h => h.dispose());
      this.splitHUD = null;
    }
    this._updateCameraAspects();
    this.running = true;
    this.hud.show(true);
    this._last = performance.now();
    if (!this._raf) this._loop();
  }

  stop() {
    this.running = false;
    if (this._vsEl) this._vsEl.style.display = 'none';
    if (this.splitHUD) { this.splitHUD.forEach(h => h.dispose()); this.splitHUD = null; }
    if (this.storm) { this.storm.dispose(); this.storm = null; }
    if (this._stormEl) { this._stormEl.remove(); this._stormEl = null; }
    this.hud.show(false);
    Audio.stop();
    Audio.stopRain();
    document.body.classList.remove('split');
  }

  returnToMenu() {
    // Hand the campaign inventory back if we were duelling.
    if (this.mode === 'versus') {
      this.player?.popTempLoadout();
      this.player2?.popTempLoadout();
      if (this._versusPrevBlock !== undefined) {
        Save.data.flags.blockUnlocked = this._versusPrevBlock;
        this._versusPrevBlock = undefined;
      }
      Save.write(true);
    }
    this.stop();
    this._teardownWorld();
    this.input.releaseLock();
    this.onReturnToMenu?.();
  }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    const now = performance.now();
    let dt = Math.min(.06, (now - this._last) / 1000);
    this._last = now;

    this.input.update(dt);

    if (!this.running || !this.scene) return;

    /* --- time scale (parry slow-mo) --- */
    if (this._timeScaleT > 0) {
      this._timeScaleT -= dt;
      if (this._timeScaleT <= 0) this.timeScale = 1;
    }
    this.timeScale = damp(this.timeScale, this._timeScaleTarget, 3, dt);
    const sdt = dt * this.timeScale;
    this.elapsed += sdt;

    /* --- global input --- */
    const p0 = this.input.players[0];
    if (p0.justPressed('inventory') && !this.dialogue.open) {
      this.setUIFocus(!this.inventory.open);
      this.inventory.toggle();
    }
    if (p0.justPressed('pause') && !this.inventory.open && !this.dialogue.open) {
      this.togglePause();
    }
    if (p0.justPressed('mute')) {
      const m = Audio.toggleMute();
      Save.settings.muted = m; Save.writeSettings();
      this.hud.toast(m ? 'MUTED' : 'SOUND ON');
    }

    if (this.dialogue.open) this.dialogue.update(dt, this.input);
    if (this.inventory.open) this.inventory.update(dt, this.input);
    if (this.inventory.open || this.dialogue.open || this.paused) {
      this._render();
      return;
    }

    if (!this.freeze && !this.loading) {
      this._updateWorld(sdt);
    }

    this._updateCameraShake(sdt);
    this._updateHUD();
    this._render();
  }

  _updateWorld(dt) {
    const players = this.player2 ? [this.player, this.player2] : [this.player];

    /* --- players --- */
    for (const p of players) p.update(dt, this.world);

    /* --- player two interacts with the world too --- */
    if (this.player2 && this.mode === 'coop') {
      const i2 = this._findInteractable(this.player2);
      if (i2 && this.input.players[1].justPressed('interact')) i2.act();
    }

    /* --- interaction prompt --- */
    const inter = this._findInteractable(this.player);
    this._promptEl ??= (() => {
      const n = el('div');
      n.style.cssText = 'position:absolute;left:50%;top:56%;transform:translateX(-50%);' +
        'font-family:Cinzel,serif;font-size:14px;letter-spacing:.18em;color:#f4ece0;' +
        'text-shadow:0 2px 10px #000;pointer-events:none;opacity:0;transition:opacity .18s';
      document.getElementById('layer-game').appendChild(n);
      return n;
    })();
    if (inter && !this.uiFocus) {
      this._promptEl.style.opacity = '1';
      this._promptEl.innerHTML = `<b style="color:var(--ember)">E</b> &nbsp;${inter.label}`;
      if (this.input.players[0].justPressed('interact')) inter.act();
    } else this._promptEl.style.opacity = '0';

    /* --- mouse-look is gated behind pointer lock; say so plainly --- */
    this._lockHint ??= (() => {
      const n = el('div');
      n.style.cssText = 'position:absolute;left:50%;top:44%;transform:translateX(-50%);' +
        'font-family:Cinzel,serif;font-size:13px;letter-spacing:.24em;color:#f4ece0;' +
        'background:rgba(6,5,4,.6);padding:10px 22px;text-shadow:0 2px 10px #000;' +
        'pointer-events:none;opacity:0;transition:opacity .25s';
      n.textContent = 'CLICK TO LOOK AROUND';
      document.getElementById('layer-game').appendChild(n);
      return n;
    })();
    const needLock = !this.input.locked && !this.uiFocus && !this.input.players[0].usingPad;
    this._lockHint.style.opacity = needLock ? '1' : '0';

    /* --- world streaming --- */
    this.terrain.update(this.player.pos, dt);
    this.props.update(this.player.pos);
    this.props.tick(dt, this.elapsed, this.sky.uniforms.uStars.value);
    this.sky.update(dt, this.player.pos, Audio);

    /* --- actors --- */
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      // Only think about enemies the player could plausibly meet.
      const d = e.pos.distanceTo(this.player.pos);
      if (d > 260 && !e.isBoss) { if (d > 700) { e.dispose(); this.enemies.splice(i, 1); } continue; }
      e.update(dt, this._closestPlayer(e.pos));
      if (e.remove) { e.dispose(); this.enemies.splice(i, 1); }
    }
    for (let i = this.allies.length - 1; i >= 0; i--) {
      const a = this.allies[i];
      a.update(dt, this.player);
      if (a.remove) { a.dispose(); this.allies.splice(i, 1); }
    }
    // Reinforcements, so the line does not simply evaporate.
    if (this.world.tutorial) {
      this._allyT = (this._allyT ?? 0) - dt;
      if (this._allyT <= 0) {
        const alive = this.allies.filter(a => !a.dead).length;
        if (alive < 7) this._spawnAlly(false);
        this._allyT = 6;
      }
    }

    for (const n of this.npcs) n.update(dt, this.player);
    for (const a of this.animals) a.update(dt, this.player);
    for (const c of this.chests) if (c.pos.distanceTo(this.player.pos) < 120) c.update(dt);
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.update(dt, this.player);
      if (pk.remove) { pk.dispose(); this.pickups.splice(i, 1); }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.update(dt, this._closestPlayer(pr.pos));
      if (pr.remove) this.projectiles.splice(i, 1);
    }
    if (this.companion) this.companion.update(dt, this.player);
    this._updateHazards(dt);
    if (this.storm) {
      this.storm.update(dt, [this.player, this.player2]);
      this._paintStormHUD();
    }

    // Split screen halves the viewport, and renderScale shrinks the buffer
    // again; particle sprites are sized in framebuffer pixels, so they need
    // to know how tall the view they land in actually is.
    this.vfx.update(dt, this.cameras[0],
      this.viewH / (this.mode === 'single' || !this.player2 ? 1 : 2));
    this.missions.update(dt);
    this.tutorial.update(dt);

    /* --- combat state (drives health regen and music) --- */
    const near = this.nearestEnemy(this.player.pos, 32);
    if (near) this._combatT = 4;
    this._combatT = Math.max(0, this._combatT - dt);
    this.inCombat = this._combatT > 0;

    /* --- boss bar + music --- */
    const activeBoss = this.enemies.find(e => e.isBoss && !e.dead && e.pos.distanceTo(this.player.pos) < 70);
    if (activeBoss) {
      this.hud.setBoss(activeBoss);
      if (Audio.current !== activeBoss.bdef.music) Audio.play(activeBoss.bdef.music);
    } else {
      this.hud.setBoss(null);
      const want = this.props.inHub(this.player.pos) ? 'hub' : this.world.music;
      if (Audio.current !== want && !this.freeze) Audio.play(want);
    }

    /* --- respawn roamers --- */
    this._spawnT = (this._spawnT ?? 0) - dt;
    if (this._spawnT <= 0) {
      const near = this.enemies.filter(e => !e.dead && e.pos.distanceTo(this.player.pos) < 220).length;
      const want = this.world.tutorial ? 10 : 18;
      if (near < want && this.enemies.length < 70 && !this.props.inHub(this.player.pos, 120)) {
        this._spawnRoamer(false);
      }
      this._spawnT = 2.2;
    }

    /* --- cutscene look-at --- */
    if (this._lookTarget) {
      const L = this._lookTarget;
      this.player.yaw = damp(this.player.yaw, L.yaw, 4, dt);
      this.player.pitch = damp(this.player.pitch, L.pitch, 4, dt);
      L.t -= dt;
      if (L.t <= 0) this._lookTarget = null;
    }

    /* --- periodic autosave --- */
    this._saveT = (this._saveT ?? 0) - dt;
    if (this._saveT <= 0) {
      Save.data.pos = [this.player.pos.x, this.player.pos.y, this.player.pos.z];
      Save.data.yaw = this.player.yaw;
      Save.data.stats = { hp: this.player.hp, stamina: this.player.stamina, power: this.player.power };
      Save.data.playtime = (Save.data.playtime || 0) + 10;
      Save.write();
      this._saveT = 10;
    }
  }

  _closestPlayer(pos) {
    if (!this.player2) return this.player;
    return this.player.pos.distanceTo(pos) <= this.player2.pos.distanceTo(pos) ? this.player : this.player2;
  }

  _updateCameraShake(dt) {
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmt * clamp(this.shakeT / .3, 0, 1);
      for (const c of this.cameras) {
        c.position.x += (Math.random() - .5) * a * .32;
        c.position.y += (Math.random() - .5) * a * .32;
        c.rotateZ((Math.random() - .5) * a * .022);
      }
      if (this.shakeT <= 0) this.shakeAmt = 0;
    }
  }

  _updateHUD() {
    const p = this.player;
    if (!p) return;
    if (this.splitHUD) {
      this.splitHUD[0].update(this.player, Save.data.colors);
      this.splitHUD[1].update(this.player2, Save.data.colors);
    }
    this.hud.setVitals({
      hp: p.hp, hpMax: p.hpMax,
      stamina: p.stamina, staminaMax: p.staminaMax,
      power: p.power, powerMax: p.powerMax
    });
    this.hud.setProgress({ level: Save.data.level, xp: Save.data.xp, shekels: Save.data.shekels });
    this.hud.setHeading(p.yaw);
    this.syncHotbar();
  }

  syncHotbar() {
    if (!this.player) return;
    this.hud.setHotbar(
      Save.data.inventory.slice(0, 4),
      Save.data.equipped,
      Save.data.colors
    );
    if (this.inventory.open) this.inventory.render();
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      this.input.releaseLock();
      this._pauseUI = this.screens.modal({
        title: 'Paused',
        body: `World ${this.world.id} — ${this.world.name}<br>Level ${Save.data.level} · Rank ${rankFor(Save.data.level).id} · ✦${Save.data.shekels}<br><br>Your progress is saved automatically.`,
        actions: [
          { label: 'RESUME', fn: () => { this.paused = false; this.input.requestLock(); } },
          { label: 'SETTINGS', ghost: true, fn: () => { this.paused = false; this.onOpenSettings?.(); } },
          { label: 'RETURN TO MENU', ghost: true, fn: () => { this.paused = false; Save.write(true); this.returnToMenu(); } }
        ]
      });
    }
  }

  /* ==========================================================
     Render (single or horizontal split)
     ========================================================== */
  _render() {
    if (!this.scene) return;
    const r = this.renderer;

    if (this.mode === 'single' || !this.player2) {
      r.setScissorTest(false);
      r.setViewport(0, 0, this.viewW, this.viewH);
      r.render(this.scene, this.cameras[0]);
      return;
    }

    // Horizontal split: player one on top, player two below.
    const h = Math.floor(this.viewH / 2);
    r.setScissorTest(true);

    r.setViewport(0, h, this.viewW, h);
    r.setScissor(0, h, this.viewW, h);
    r.render(this.scene, this.cameras[0]);

    r.setViewport(0, 0, this.viewW, h);
    r.setScissor(0, 0, this.viewW, h);
    r.render(this.scene, this.cameras[1]);

    r.setScissorTest(false);
  }

  /* ==========================================================
     Versus arena
     ========================================================== */
  async startVersus() {
    this.mode = 'versus';
    this.versusScore = [0, 0];
    document.body.classList.add('split');

    // A small flat arena on world 2's terrain, everything else stripped out.
    await this.loadWorld(2, { intro: false });
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
    for (const a of this.animals) a.dispose();
    this.animals.length = 0;

    // Both duellists get the same kit and full guard, so the duel is decided
    // by play rather than by whose campaign save is further along.
    this._versusPrevBlock = Save.data.flags.blockUnlocked;
    Save.data.flags.blockUnlocked = true;
    this.player2 ??= new Player(this, this.cameras[1], 1);
    this.scene.add(this.cameras[1]);
    this.player.pushTempLoadout('versus');
    this.player2.pushTempLoadout('versus');

    const c = this.props.hubCenter;
    this.player.spawnAt(new THREE.Vector3(c.x - 8, 0, c.z), Math.PI / 2);
    this.player2.spawnAt(new THREE.Vector3(c.x + 8, 0, c.z), -Math.PI / 2);
    this._updateCameraAspects();

    // The closing storm gives a stalling duel a clock.
    this.storm = new Storm(this, { center: c.clone(), radius: 150 });

    this.hud.toast('FIRST TO FIVE FALLS', true);
    this.hud.toast('THE STORM WILL CLOSE IN');
    this._paintVersusScore();
    this.start('versus');
  }
}
