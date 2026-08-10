/* First-person player controller and combat.
 *
 * The combat loop the whole game is built around:
 *   - swinging costs power; power that hits empty starts costing health
 *   - enemies block ~40% of melee hits; being blocked drains your power,
 *     knocks you back hard and launches you into the air
 *   - while airborne, holding jump slows your fall and charges a Wind Dash;
 *     releasing fires you where you are looking. Dashing into an enemy
 *     damages them and launches you again, so a good player never lands. */

import * as THREE from 'three';
import { clamp, lerp, damp, makeRNG } from '../core/util.js';
import { ITEMS, classById, xpToNext, rankFor } from '../data/gamedata.js';
import { buildWeapon } from '../entities/models.js';
import { countItem, removeItem, addItem } from '../ui/inventory.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

const EYE_HEIGHT = 1.68;
const CROUCH_HEIGHT = 1.05;

export class Player {
  constructor(game, camera, index = 0) {
    this.game = game;
    this.camera = camera;
    this.index = index;
    this.rng = makeRNG(1234 + index);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.grounded = true;
    this.crouching = false;
    this.dead = false;
    this.radius = .45;

    /* --- vitals --- */
    this.hpMax = 100; this.hp = 100;
    this.staminaMax = 100; this.stamina = 100;
    this.powerMax = 100; this.power = 100;

    /* --- combat state --- */
    this.attackT = 0;          // >0 while a swing is playing
    this.attackCooldown = 0;
    this.blocking = false;
    this.blockHeld = 0;
    this.perfectWindow = 0;
    this.comboStep = 0;
    this.comboTimer = 0;
    this.invuln = 0;
    this.charging = 0;         // bow draw
    this.hitStop = 0;

    /* --- wind dash --- */
    this.dashCharge = 0;
    this.dashCooldown = 0;
    this.dashesLeft = 1;
    this.dashing = 0;
    this.dashDir = new THREE.Vector3();

    /* --- misc --- */
    this.mount = null;
    this.buff = null;
    this.bobT = 0;
    this.stepT = 0;
    this.landShake = 0;
    this.viewRoll = 0;
    this.recoil = 0;

    // Player one plays out of the save file. Player two carries its own
    // gear so split screen is not two people sharing one satchel.
    this.loadout = index === 0 ? null : { inventory: new Array(36).fill(null), equipped: 0 };

    this._buildViewModel();
    this.refreshStats();
  }

  get save() { return this.game.save; }
  get input() { return this.game.input.players[this.index]; }

  /** The bag this player actually draws from. */
  get inv() { return this.loadout ? this.loadout.inventory : this.save.inventory; }
  get equippedIndex() { return this.loadout ? this.loadout.equipped : this.save.equipped; }
  set equippedIndex(v) { if (this.loadout) this.loadout.equipped = v; else this.save.equipped = v; }

  /** Give this player a temporary bag of their own — used so a duel is
   *  fought with matched kit instead of whatever the campaign save holds.
   *  Player one's real inventory is untouched and restored afterwards. */
  pushTempLoadout(kind = 'versus') {
    if (!this._savedLoadout) this._savedLoadout = { had: !!this.loadout, ref: this.loadout };
    this.loadout = { inventory: new Array(36).fill(null), equipped: 0 };
    this.giveLoadout(kind);
  }

  popTempLoadout() {
    if (!this._savedLoadout) return;
    this.loadout = this._savedLoadout.had ? this._savedLoadout.ref : null;
    this._savedLoadout = null;
    this._viewWeaponId = null;
    this.syncViewModel();
  }

  /** Re-copy player one's four weapon slots into this player's bag. Co-op
   *  hands player two the same kit, and player one starts world one empty
   *  handed, so the mirror has to keep working as the run goes on rather
   *  than being taken once at spawn. Slots 4+ are player two's own. */
  mirrorWeapons(sourceInv) {
    if (!this.loadout) return;
    const inv = this.loadout.inventory;
    let changed = false;
    for (let i = 0; i < 4; i++) {
      const s = sourceInv[i];
      const mine = inv[i];
      if (!s && !mine) continue;
      if (s && mine && s.id === mine.id && s.qty === mine.qty) continue;
      inv[i] = s ? { id: s.id, qty: s.qty } : null;
      changed = true;
    }
    if (changed) this.syncViewModel();
  }

  /** Kit a player out. Co-op mirrors player one; versus is a fixed duel set. */
  giveLoadout(kind = 'versus') {
    if (!this.loadout) return;
    const inv = this.loadout.inventory;
    inv.fill(null);
    if (kind === 'coop') {
      // Same four slots as player one, plus their own consumables.
      for (let i = 0; i < 4; i++) {
        const s = this.save.inventory[i];
        inv[i] = s ? { id: s.id, qty: s.qty } : null;
      }
      inv[4] = { id: 'potion_hp', qty: 3 };
      inv[5] = { id: 'food', qty: 3 };
    } else {
      inv[0] = { id: 'kontana', qty: 1 };
      inv[1] = { id: 'bow', qty: 1 };
      inv[2] = { id: 'smoke_bomb', qty: 6 };
      inv[3] = { id: 'iron_shield', qty: 1 };
      inv[4] = { id: 'potion_hp', qty: 2 };
    }
    this.loadout.equipped = 0;
    this._viewWeaponId = null;
    this.syncViewModel();
  }

  /* ==========================================================
     Stats
     ========================================================== */
  refreshStats() {
    const cls = classById(this.save.classId);
    const s = cls.stats;
    const lvl = this.save.level;
    const lvlScale = 1 + (lvl - 1) * .055;

    this.cls = cls;
    this.hpMax = Math.round(100 * s.health * lvlScale);
    this.staminaMax = Math.round(100 * s.stamina);
    this.powerMax = Math.round(100 * s.power);
    this.damageMul = s.damage * lvlScale;
    this.speedMul = s.speed;
    this.defense = s.defense;

    this.hp = Math.min(this.hp || this.hpMax, this.hpMax);
    this.stamina = Math.min(this.stamina, this.staminaMax);
    this.power = Math.min(this.power, this.powerMax);

    this.has = id => this.save.abilities.includes(id);
    this.maxDashes = this.has('chain_dash') ? 2 : 1;
  }

  /* ==========================================================
     View model — the weapon held in front of the camera
     ========================================================== */
  _buildViewModel() {
    this.viewRoot = new THREE.Group();
    this.camera.add(this.viewRoot);
    this.viewHand = new THREE.Group();
    // Sit the weapon low and to the right, angled across the view.
    this.viewHand.position.set(.84, -.38, -.74);
    this.viewHand.rotation.set(.30, -.42, .52);
    this.viewRoot.add(this.viewHand);
    this._viewWeaponId = null;
  }

  syncViewModel() {
    const stack = this.equippedStack();
    const id = stack?.id || 'fist';
    if (id === this._viewWeaponId) return;
    this._viewWeaponId = id;
    if (this.viewWeapon) { this.viewHand.remove(this.viewWeapon); }
    if (id === 'fist') { this.viewWeapon = null; return; }

    const model = buildWeapon(id, this.save.colors);
    this._modelRef = model;
    // Weapons range from a 0.2 m knife to a 1.9 m spear, so normalise every
    // one to the same on-screen presence instead of using a fixed scale.
    const bb = new THREE.Box3().setFromObject(model);
    const size = bb.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z, .001);
    // Base size, later multiplied by the viewport factor each frame.
    this._baseScale = clamp(.62 / longest, .16, 1.0);
    this._modelMinY = bb.min.y;
    const s = this._baseScale;

    // Wrap it so we can offset the pivot to the grip without fighting the
    // hand transform.
    this.viewWeapon = new THREE.Group();
    model.scale.setScalar(s);
    // Pull the model down so its lowest point sits roughly at the hand.
    model.position.y = -bb.min.y * s - .06;
    this.viewWeapon.add(model);

    // Glowing weapons (the kontana, the voidblade, the frostblade) carry a
    // real PointLight for when they are lying in the world or held by an NPC.
    // Riding inside the camera at a metre's range with inverse-square falloff,
    // that same light blows the whole viewport to white. Strip the lights out
    // and let the emissive lift below carry the glow instead.
    const lights = [];
    this.viewWeapon.traverse(o => { if (o.isLight) lights.push(o); });
    for (const l of lights) l.parent?.remove(l);

    // View models must not be clipped by the world or cast shadows. They also
    // carry a little of their own colour: at night the scene light alone
    // renders the held weapon as a black silhouette, which hides the colours
    // the player chose in the forge.
    const glow = lights.length ? .5 : .3;
    this.viewWeapon.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = false; o.renderOrder = 1000;
      if (o.material?.isMeshStandardMaterial) {
        o.material = o.material.clone();
        const lift = o.material.color.clone().multiplyScalar(glow);
        o.material.emissive.add(lift);
      }
    });
    this.viewHand.add(this.viewWeapon);
  }

  /* ==========================================================
     Equipment
     ========================================================== */
  equippedStack() {
    return this.inv[clamp(this.equippedIndex ?? 0, 0, 3)] || null;
  }
  equippedDef() {
    const s = this.equippedStack();
    return s ? ITEMS[s.id] : ITEMS.fist;
  }
  setEquipped(i) {
    this.equippedIndex = clamp(i, 0, 3);
    this.syncViewModel();
    this.game.syncHotbar();
    this.game.audio.sfx('uiMove', { volume: .35 });
  }

  /** The shield we would raise, if any: equipped shield or one in the bar. */
  activeShield() {
    const eq = this.equippedDef();
    if (eq.kind === 'shield') return eq;
    for (let i = 0; i < 4; i++) {
      const s = this.inv[i];
      if (s && ITEMS[s.id]?.kind === 'shield') return ITEMS[s.id];
    }
    return null;
  }

  /* ==========================================================
     Spawn / death
     ========================================================== */
  spawnAt(pos, yaw = 0) {
    this.pos.copy(pos);
    this.pos.y = this.game.terrain.heightAt(pos.x, pos.z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.dead = false;
    this.hp = this.hpMax;
    this.stamina = this.staminaMax;
    this.power = this.powerMax;
    this.invuln = 1.5;
    this.dashesLeft = this.maxDashes;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.game.audio.sfx('death');
    this.save.deaths++;
    this.game.onPlayerDeath(this);
  }

  takeHit(amount, fromPos, { source = null, launch = 0, ranged = false } = {}) {
    if (this.dead || this.invuln > 0) return 'miss';

    const dirToAttacker = tmpV.copy(fromPos).sub(this.pos).setY(0).normalize();
    const facing = tmpV2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const frontal = facing.dot(dirToAttacker) > .2;

    /* --- blocking --- */
    if (this.blocking && frontal && this.save.flags.blockUnlocked) {
      const shield = this.activeShield();
      const ratio = shield ? shield.block : .55;
      const perfect = this.has('parry') && this.blockHeld < .25;

      if (perfect) {
        // Deflection: no damage, attacker staggered, brief slow-motion.
        this.game.audio.sfx('parry');
        this.game.vfx.hitSpark(this._chest(), dirToAttacker, true);
        this.game.vfx.damageNumber(this._head(), 0, 'block');
        if (source?.state !== undefined) { source.state = 'stagger'; source.stateT = 1.4; }
        if (this.has('time_slip')) this.game.setTimeScale(.35, 2);
        this.game.rumble(this.index, .6, .3, 120);
        return 'parry';
      }

      const through = amount * (1 - ratio);
      const powerCost = amount * .55;
      this.power -= powerCost;
      this.hp -= through * (1 / this.defense);
      this.game.audio.sfx('block');
      this.game.vfx.hitSpark(this._chest(), dirToAttacker, true);
      this.game.vfx.damageNumber(this._head(), 0, 'block');
      this.vel.addScaledVector(dirToAttacker, -6);
      this.game.hud.flashDamage();
      this.game.rumble(this.index, .45, .25, 140);
      if (this.power <= 0) this._powerBreak();
      if (this.hp <= 0) this.die();
      return 'blocked';
    }

    /* --- clean hit --- */
    let dmg = amount / this.defense;
    if (this.has('forsaken') && this.hp / this.hpMax < .25) dmg *= .7;
    this.hp -= dmg;
    this.invuln = .35;

    this.game.audio.sfx('hurt');
    this.game.hud.flashDamage();
    this.game.vfx.bloodBurst(this._chest(), dirToAttacker.clone().negate());
    this.game.shake(.5, .3);
    this.game.rumble(this.index, .7, .5, 200);

    this.vel.addScaledVector(dirToAttacker, -7);
    if (launch > 0) { this.vel.y = launch; this.grounded = false; }

    if (this.hp <= 0) this.die();
    return 'hit';
  }

  /** Power hitting zero: the bar refills slowly and health pays the bill. */
  _powerBreak() {
    this.power = 0;
    if (this.has('power_surge')) { this.power = this.powerMax * .15; return; }
    this.hp -= 6;
    this.game.audio.sfx('hurt', { volume: .5 });
    this.game.hud.flashDamage();
    if (this.hp <= 0) this.die();
  }

  _chest() { return tmpV2.set(this.pos.x, this.pos.y + 1.2, this.pos.z).clone(); }
  _head()  { return tmpV2.set(this.pos.x, this.pos.y + 1.9, this.pos.z).clone(); }

  /* ==========================================================
     Main update
     ========================================================== */
  update(dt, world) {
    const inp = this.input;

    if (this.hitStop > 0) { this.hitStop -= dt; dt *= .12; }

    /* ---- look ---- */
    if (!this.game.uiFocus) {
      this.yaw -= inp.look.x;
      this.pitch = clamp(this.pitch - inp.look.y, -1.45, 1.45);
    }

    /* ---- timers ---- */
    this.attackT = Math.max(0, this.attackT - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer <= 0) this.comboStep = 0;
    if (this.buff) {
      this.buff.t -= dt;
      if (this.buff.t <= 0) { this.buff = null; this.game.hud.toast('THE DRAUGHT FADES'); }
    }

    if (this.dead) { this._deathCamera(dt); return; }

    /* ---- movement ---- */
    if (this.mount) this._updateMounted(dt, inp);
    else this._updateOnFoot(dt, inp, world);

    /* ---- combat input ---- */
    if (!this.game.uiFocus) this._combatInput(dt, inp);

    /* ---- regeneration ---- */
    this._regen(dt);

    /* ---- camera ---- */
    this._updateCamera(dt);
    this.syncViewModel();
    this._animateViewModel(dt);
  }

  _updateOnFoot(dt, inp, world) {
    const moving = inp.move.x !== 0 || inp.move.y !== 0;
    this.crouching = inp.isDown('crouch') && this.grounded;

    let speed = 4.6 * this.speedMul;
    const wantSprint = inp.isDown('sprint') && moving && this.stamina > 1 && !this.crouching && !this.blocking;
    if (wantSprint) { speed *= 1.72; this.stamina -= 17 * dt; }
    if (this.crouching) speed *= .45;
    if (this.blocking) speed *= .5;
    if (this.buff) speed *= this.buff.speed || 1;
    if (!this.grounded) speed *= .82;

    // Camera-relative movement.
    const fwd = tmpV.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = tmpV2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3()
      .addScaledVector(fwd, inp.move.y)
      .addScaledVector(right, inp.move.x);
    if (wish.lengthSq() > 0) wish.normalize();

    const accel = this.grounded ? 46 : 12;
    this.vel.x = damp(this.vel.x, wish.x * speed, accel * .18, dt);
    this.vel.z = damp(this.vel.z, wish.z * speed, accel * .18, dt);

    /* ---- jump / wind dash ---- */
    if (inp.justPressed('jump')) {
      if (this.grounded) {
        this.vel.y = 9.4;
        this.grounded = false;
        this.game.audio.sfx('jump');
        this.dashesLeft = this.maxDashes;
      } else if (this.has('double_jump') && !this._usedDouble) {
        this.vel.y = 8.4;
        this._usedDouble = true;
        this.game.audio.sfx('jump', { volume: .8 });
        this.game.vfx.windBurst(this.pos.clone(), UP);
      }
    }

    // Holding jump in the air slows the fall and charges the dash.
    const canDash = !this.grounded && this.dashesLeft > 0 && this.dashCooldown <= 0 &&
                    this.save.abilities.includes('wind_dash');
    this._hanging = false;
    if (canDash && inp.isDown('dash') && inp.heldFor('dash') > .08) {
      this.dashCharge = Math.min(1, this.dashCharge + dt * 1.7);
      // Hold to hang: the wind takes your weight. Scaling the fall alone only
      // traded acceleration for a brisk constant drop, which does not read as
      // slowed. Gravity is nearly cancelled below and the descent capped, so
      // you hover long enough to pick your line before releasing.
      this._hanging = true;
      if (!this._chargeSfx) { this.game.audio.sfx('windCharge'); this._chargeSfx = true; }
      this.game.vfx.windTrail(this._chest(), UP, .35);
    } else if (this.dashCharge > 0) {
      this._releaseDash();
    }

    /* ---- gravity + ground ---- */
    this.vel.y -= (this._hanging ? 4.5 : 30) * dt;
    if (this._hanging) this.vel.y = Math.max(this.vel.y, -2.4);
    if (this.dashing > 0) {
      this.dashing -= dt;
      this.vel.y = Math.max(this.vel.y, -4);
      this.game.vfx.windTrail(this._chest(), this.dashDir, 1.4);
      this._dashHitCheck();
    }

    this.pos.y += this.vel.y * dt;

    /* A sandstorm shoves. Not enough to take control away — you can still
     * walk into it — but enough that crossing the waste with the wind on your
     * shoulder is a different journey from crossing it with the wind behind.
     * Airborne, with nothing to brace against, it carries you much further. */
    const storm = this.game.sky?.sand ?? 0;
    if (storm > .12) {
      const w = this.game.sky.windDir;
      const push = storm * (this.grounded ? 5.4 : 11) * dt;
      this.vel.x += w.x * push;
      this.vel.z += w.z * push;
    }

    // Horizontal movement with prop sliding.
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    if (!this.game.props.collideAt(nx, this.pos.z, this.radius)) this.pos.x = nx; else this.vel.x *= -.15;
    if (!this.game.props.collideAt(this.pos.x, nz, this.radius)) this.pos.z = nz; else this.vel.z *= -.15;

    const half = this.game.terrain.half - 24;
    this.pos.x = clamp(this.pos.x, -half, half);
    this.pos.z = clamp(this.pos.z, -half, half);

    const gy = this.game.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= gy) {
      if (!this.grounded) {
        const impact = -this.vel.y;
        if (impact > 13) {
          this.game.audio.sfx('land');
          this.landShake = clamp(impact / 40, 0, 1);
          this.game.shake(this.landShake * .6, .25);
          // Fall damage past a generous threshold.
          if (impact > 26) {
            this.hp -= (impact - 26) * 2.4;
            this.game.hud.flashDamage();
            if (this.hp <= 0) this.die();
          }
          // Ground Slam: land mid-attack to shockwave everything nearby.
          if (this.has('ground_slam') && this.attackT > 0) this._groundSlam();
        }
        this.grounded = true;
        this.dashesLeft = this.maxDashes;
        this._usedDouble = false;
      }
      this.pos.y = gy;
      this.vel.y = 0;
    } else this.grounded = false;

    /* ---- footsteps ---- */
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && hs > 1.5) {
      this.stepT -= dt * hs;
      if (this.stepT <= 0) {
        this.game.audio.sfx('step', { volume: this.crouching ? .25 : .7 });
        this.stepT = 3.2;
        this.save.distance = (this.save.distance || 0) + 1;
      }
    }
    // Wind noise scales with how fast you are actually moving — or with the
    // storm, if the waste is blowing harder than you are running.
    this.game.audio.setWind?.(clamp(
      Math.max((hs - 6) / 22 + (this.dashing > 0 ? .8 : 0), (this.game.sky?.sand ?? 0) * 1.1), 0, 1));
  }

  _updateMounted(dt, inp) {
    const m = this.mount;
    const fwd = tmpV.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = tmpV2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const speed = m.def.speed * (inp.isDown('sprint') ? 1.5 : 1);

    m.vel.x = damp(m.vel.x, (fwd.x * inp.move.y + right.x * inp.move.x) * speed, 4, dt);
    m.vel.z = damp(m.vel.z, (fwd.z * inp.move.y + right.z * inp.move.x) * speed, 4, dt);
    if (inp.move.x || inp.move.y) m.yaw = lerp(m.yaw, this.yaw, dt * 4);

    if (inp.justPressed('jump') && m.grounded) { m.vel.y = 9; m.grounded = false; }

    this.pos.copy(m.pos);
    this.grounded = m.grounded;

    if (inp.justPressed('interact')) this.dismount();
  }

  mountAnimal(animal) {
    if (!animal.tamed || !animal.def.rideable) return false;
    this.mount = animal;
    animal.ridden = true;
    this.game.hud.toast(`RIDING ${animal.name.toUpperCase()} — E TO DISMOUNT`);
    this.game.audio.sfx('uiConfirm');
    return true;
  }

  dismount() {
    if (!this.mount) return;
    this.mount.ridden = false;
    const a = this.yaw + Math.PI / 2;
    this.pos.set(this.mount.pos.x + Math.cos(a) * 2, 0, this.mount.pos.z + Math.sin(a) * 2);
    this.pos.y = this.game.terrain.heightAt(this.pos.x, this.pos.z);
    this.mount = null;
    this.vel.set(0, 0, 0);
  }

  /* ==========================================================
     Wind Dash
     ========================================================== */
  _releaseDash() {
    const charge = this.dashCharge;
    this.dashCharge = 0;
    this._chargeSfx = false;
    if (charge < .12) return;

    const cost = this.cls.id === 'king' ? 0 : 14;
    if (this.power < cost) { this.game.audio.sfx('uiDeny', { volume: .5 }); return; }
    this.power -= cost;

    // Dash exactly where the camera is pointing, including up and down.
    this.dashDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const strength = lerp(24, 46, charge);
    this.vel.copy(this.dashDir).multiplyScalar(strength);
    this.vel.y = Math.max(this.vel.y, this.dashDir.y * strength * .9 + 4);

    this.dashing = .34;
    this.dashesLeft--;
    this.dashCooldown = .18;
    this.invuln = Math.max(this.invuln, .22);

    if (this.index === 0 && this.game._tut) this.game._tut.dashes++;
    this.game.audio.sfx('windDash');
    this.game.vfx.windBurst(this._chest(), this.dashDir);
    this.game.shake(.5, .25);
    this.game.rumble(this.index, .8, .6, 220);
    this._dashHits = new Set();
  }

  _dashHitCheck() {
    const def = this.equippedDef();
    // Only melee weapons (and fists) carry the dash impact.
    if (def.kind !== 'melee') return;
    for (const e of this.game.enemies) {
      if (e.dead || this._dashHits?.has(e)) continue;
      const d = tmpV.copy(e.pos).setY(e.pos.y + e.height * .5).distanceTo(this._chest());
      if (d > e.radius + 2.2) continue;

      this._dashHits.add(e);
      const dmg = (def.damage || 10) * this.damageMul * 1.6 * (this.buff?.damage || 1);
      const res = e.takeHit(dmg, this.pos, { attacker: this, canBeBlocked: false });

      // Mace-with-wind-burst behaviour: the impact throws you back up.
      this.vel.copy(this.dashDir).multiplyScalar(-8);
      this.vel.y = 17;
      this.grounded = false;
      this.dashing = 0;
      this.dashesLeft = this.maxDashes;

      if (this.index === 0 && this.game._tut) this.game._tut.dashHits++;
      this.game.audio.sfx('launch');
      this.game.vfx.windBurst(e._chestPos(), this.dashDir);
      this.game.vfx.explosion(e._chestPos(), 3, [.8, .92, 1]);
      this.game.shake(1, .4);
      this.game.rumble(this.index, 1, .8, 280);
      this.game.hud.hitMarker();
      this.hitStop = .06;
      break;
    }
  }

  _groundSlam() {
    this.game.audio.sfx('bomb', { volume: .8 });
    this.game.vfx.explosion(this.pos.clone(), 8, [.85, .9, 1]);
    this.game.shake(1.2, .5);
    const def = this.equippedDef();
    for (const e of this.game.enemies) {
      const d = e.pos.distanceTo(this.pos);
      if (d < 9) {
        e.takeHit((def.damage || 10) * this.damageMul * 1.8 * (1 - d / 9 * .5),
          this.pos, { canBeBlocked: false, attacker: this });
        e.vel.y += 9;
      }
    }
  }

  teleportTo(pos) {
    this.pos.copy(pos);
    this.pos.y = this.game.terrain.heightAt(pos.x, pos.z) + .2;
    this.vel.set(0, 0, 0);
    this.game.vfx.teleportFlash(this._chest());
  }

  /* ==========================================================
     Combat input
     ========================================================== */
  _combatInput(dt, inp) {
    const def = this.equippedDef();

    /* ---- hotbar ---- */
    for (let i = 0; i < 4; i++) if (inp.justPressed('slot' + (i + 1))) this.setEquipped(i);
    if (inp.justPressed('nextSlot')) this.setEquipped((this.equippedIndex + 1) % 4);
    if (inp.justPressed('prevSlot')) this.setEquipped((this.equippedIndex + 3) % 4);
    if (this.index === 0 && this.game.input.wheel) {
      this.setEquipped((this.equippedIndex + (this.game.input.wheel > 0 ? 1 : 3)) % 4);
    }

    /* ---- block ---- */
    const wantBlock = inp.isDown('block') && this.save.flags.blockUnlocked && this.power > 0;
    if (wantBlock && !this.blocking) { this.blockHeld = 0; }
    this.blocking = wantBlock;
    if (this.blocking) {
      this.blockHeld += dt;
      const shield = this.activeShield();
      const drain = (shield ? 5 : 8) * (this.cls.id === 'knight' ? .8 : 1);
      this.power -= drain * dt;
      if (this.power <= 0) { this.power = 0; this._powerBreak(); this.blocking = false; }
    }

    /* ---- use consumable ---- */
    if (inp.justPressed('use')) this._useConsumable();
    if (inp.justPressed('drop')) {
      const s = this.equippedStack();
      if (s) {
        this.game.dropItemInWorld(s.id, 1);
        removeItem(this.inv, s.id, 1);
        this.game.syncHotbar();
      }
    }

    /* ---- attack ---- */
    if (this.blocking) { this.charging = 0; return; }

    if (def.kind === 'range' && def.charge) {
      // Bows: hold to draw, release to loose.
      if (inp.isDown('attack')) {
        if (this.charging === 0) this.game.audio.sfx('bowDraw');
        this.charging = Math.min(1, this.charging + dt / def.charge);
      } else if (this.charging > 0) {
        this._fireRanged(def, this.charging);
        this.charging = 0;
      }
      return;
    }

    if (inp.isDown('attack') && this.attackCooldown <= 0) {
      switch (def.kind) {
        case 'range': this._fireRanged(def, 1); break;
        case 'bomb': this._throwBomb(def); break;
        case 'shield': this._melee(ITEMS.fist); break;   // shield bash uses fists
        default: this._melee(def); break;
      }
    }
  }

  _useConsumable() {
    // Prefer whatever consumable sits in the active slot, else the first one.
    let stack = this.equippedStack();
    let idx = this.equippedIndex;
    if (!stack || ITEMS[stack.id]?.kind !== 'consumable') {
      idx = this.inv.findIndex(s => s && ITEMS[s.id]?.kind === 'consumable' && ITEMS[s.id].heal);
      stack = idx >= 0 ? this.inv[idx] : null;
    }
    if (!stack) { this.game.audio.sfx('uiDeny', { volume: .4 }); return; }
    const def = ITEMS[stack.id];
    if (def.kind !== 'consumable') { this.game.audio.sfx('uiDeny', { volume: .4 }); return; }

    if (def.heal) this.hp = Math.min(this.hpMax, this.hp + def.heal);
    if (def.stamina) this.stamina = this.staminaMax;
    if (def.power) this.power = this.powerMax;
    if (def.buff) {
      this.buff = { damage: def.buff.damage, speed: def.buff.speed, t: def.buff.duration };
      this.game.hud.toast('THE DRAUGHT TAKES HOLD', true);
    }
    if (def.tame) {
      const a = this.game.nearestAnimal(this.pos, 6);
      if (a && !a.tamed) { a.tame(); this.game.onAnimalTamed(a); }
      else { this.game.audio.sfx('uiDeny', { volume: .4 }); return; }
    }

    stack.qty--;
    if (stack.qty <= 0) this.inv[idx] = null;
    this.game.audio.sfx(def.tame ? 'tame' : 'heal');
    this.game.vfx.magicBurst(this._chest(), def.tint ? [1, .5, .4] : [.5, 1, .6], 30);
    this.game.syncHotbar();
    this.game.saveNow();
  }

  /* ---------------- melee ---------------- */
  _melee(def) {
    const cost = def.power || 2;
    if (this.power < cost * .5) { this.game.audio.sfx('uiDeny', { volume: .35 }); this.attackCooldown = .3; return; }
    this.power -= cost;
    if (this.power <= 0) this._powerBreak();

    const speed = def.speed * (this.cls.id === 'assassin' ? .85 : 1);
    this.attackT = speed;
    this.attackCooldown = speed;
    this.comboStep = (this.comboStep + 1) % 3;
    this.comboTimer = speed * 2.2;

    this.game.audio.sfx(def.damage > 35 ? 'swingHeavy' : def.id === 'fist' ? 'punch' : 'swing');
    if (this.index === 0 && this.game._tut) this.game._tut.swings++;

    // Resolve the hit partway through the swing so it reads as connecting.
    setTimeout(() => this._resolveMelee(def), speed * 380);
  }

  _resolveMelee(def) {
    if (this.dead) return;
    const reach = (def.reach || 2.2) + (this.cls.id === 'fighter' && def.id === 'fist' ? 1 : 0);
    const origin = this._chest();
    const look = tmpV.set(0, 0, -1).applyQuaternion(this.camera.quaternion);

    let base = (def.damage || 8) * this.damageMul * (this.buff?.damage || 1);
    if (def.id === 'fist' && this.cls.id === 'fighter') base *= 3;
    if (def.kind === 'melee' && this.cls.id === 'samurai' && (def.id === 'katana' || def.id === 'kontana')) base *= 1.25;

    let hitAny = false;

    for (const e of this.game.enemies) {
      if (e.dead) continue;
      const toE = tmpV2.copy(e.pos).setY(e.pos.y + e.height * .55).sub(origin);
      const d = toE.length();
      if (d > reach + e.radius) continue;
      // 100 degree arc in front of the camera.
      if (toE.normalize().dot(look) < .42) continue;

      // Backstab: are we behind them?
      const eFace = tmpV.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
      const toPlayer = tmpV2.copy(this.pos).sub(e.pos).setY(0).normalize();
      const backstab = eFace.dot(toPlayer) < -.35;
      // "Slaying your enemies from behind will yield bonus points" — every
      // class gets the damage and XP bonus; the Assassin just gets more.
      let dmg = base;
      if (backstab) dmg *= this.cls.id === 'assassin' ? 3 : 1.8;

      if (this.has('execute') && e.hp / e.hpMax < .18) dmg = e.hp + 1;

      const res = e.takeHit(dmg, this.pos, { attacker: this, backstab });
      hitAny = true;

      if (res === 'blocked') {
        this._gotBlocked(e);
        return;                    // a blocked swing ends the exchange
      }
      if (res === 'killed' || res === 'hit') {
        if (this.index === 0 && this.game._tut) this.game._tut.enemiesHit++;
        this.game.hud.hitMarker();
        this.hitStop = .045;
        this.game.rumble(this.index, .45, .3, 90);
        if (this.has('life_steal')) this.hp = Math.min(this.hpMax, this.hp + dmg * .12);
        if (this.cls.id === 'warrior' && res === 'killed') this.hp = Math.min(this.hpMax, this.hp + this.hpMax * .08);
        if (backstab) {
          this.game.hud.toast('+BONUS · FROM BEHIND');
          this.gainXP(Math.round(e.xp * .5));
          this.game.vfx.damageNumber(e._headPos(), 0, 'crit');
        }
      }
    }

    // Chests and destructibles.
    if (!hitAny) {
      this.game.vfx.slash(
        origin.clone().addScaledVector(look, reach * .6),
        this.camera.quaternion.clone(), reach * .55);
    }
  }

  /** An enemy guarded: you lose power, get knocked back and launched. */
  _gotBlocked(enemy) {
    this.power -= 22;
    this.attackCooldown = .55;
    this.attackT = 0;

    const away = tmpV.copy(this.pos).sub(enemy.pos).setY(0).normalize();
    this.vel.copy(away).multiplyScalar(19);
    this.vel.y = 15.5;
    this.grounded = false;
    this.dashesLeft = this.maxDashes;   // you get the dash back on the way up

    this.game.audio.sfx('block');
    this.game.audio.sfx('launch', { delay: .05 });
    this.game.vfx.windBurst(this._chest(), away);
    this.game.shake(1.1, .45);
    this.game.rumble(this.index, 1, .9, 320);
    this.game.hud.toast('GUARDED — HOLD JUMP, THEN RELEASE');
    this.viewRoll = -.5;

    if (this.power <= 0) this._powerBreak();
  }

  /* ---------------- ranged ---------------- */
  _fireRanged(def, charge) {
    if (def.consumes) {
      const stack = this.equippedStack();
      if (!stack || stack.qty <= 0) { this.game.audio.sfx('uiDeny', { volume: .4 }); this.attackCooldown = .3; return; }
    }
    const cost = def.power || 4;
    if (this.power < cost) { this.game.audio.sfx('uiDeny', { volume: .4 }); this.attackCooldown = .3; return; }
    this.power -= cost;

    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const origin = this.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, .8);

    this.game.spawnProjectile({
      pos: origin, dir,
      speed: def.velocity * lerp(.55, 1, charge),
      damage: def.damage * this.damageMul * lerp(.4, 1, charge) * (this.buff?.damage || 1),
      owner: this, fromPlayer: true,
      kind: def.projectile === 'knife' || def.projectile === 'shuriken' ? 'knife' : 'arrow',
      itemId: def.id, drop: def.drop, radius: .18,
      homing: this.cls.id === 'wizard' ? .35 : 0
    });

    this.game.audio.sfx('bowShot');
    this.attackCooldown = def.speed;
    this.recoil = .5 + charge * .5;
    this.game.rumble(this.index, .3, .5, 120);

    if (def.consumes) {
      const stack = this.equippedStack();
      stack.qty--;
      if (stack.qty <= 0) this.inv[this.equippedIndex] = null;
      this.game.syncHotbar();
    }
  }

  /* ---------------- bombs ---------------- */
  _throwBomb(def) {
    const stack = this.equippedStack();
    if (!stack || stack.qty <= 0) { this.game.audio.sfx('uiDeny', { volume: .4 }); return; }

    const wizard = this.cls.id === 'wizard';
    const cost = wizard ? 0 : (def.power || 6);
    if (this.power < cost) { this.game.audio.sfx('uiDeny', { volume: .4 }); return; }
    this.power -= cost;

    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    dir.y += .16;
    const origin = this.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, .7);

    this.game.spawnProjectile({
      pos: origin, dir, speed: 22,
      damage: (def.damage || 0) * this.damageMul * (wizard ? 1.6 : 1) * (this.buff?.damage || 1),
      owner: this, fromPlayer: true, kind: 'bomb', itemId: def.id,
      drop: 20, radius: .3, fuse: def.fuse, effect: def.effect,
      blastRadius: def.radius
    });

    this.game.audio.sfx('swing', { volume: .5 });
    this.attackCooldown = def.speed;

    stack.qty--;
    if (stack.qty <= 0) this.inv[this.equippedIndex] = null;
    this.game.syncHotbar();
  }

  /* ==========================================================
     Regeneration
     ========================================================== */
  _regen(dt) {
    // Power comes back on its own, faster when you are not swinging.
    const idle = this.attackCooldown <= 0 && !this.blocking;
    let powerRate = (idle ? 9 : 3.5) * (this.cls.id === 'sensei' ? 1.6 : 1);
    if (this.has('power_surge')) powerRate *= 2;
    this.power = clamp(this.power + powerRate * dt, 0, this.powerMax);

    // Stamina is quick; health is slow but real.
    const staminaRate = this.input.isDown('sprint') ? 0 : (this.cls.id === 'fighter' ? 26 : 13);
    this.stamina = clamp(this.stamina + staminaRate * dt, 0, this.staminaMax);

    if (!this.game.inCombat) {
      this.hp = clamp(this.hp + this.hpMax * .012 * dt, 0, this.hpMax);
    } else {
      this.hp = clamp(this.hp + this.hpMax * .004 * dt, 0, this.hpMax);
    }
  }

  /* ==========================================================
     Camera
     ========================================================== */
  _updateCamera(dt) {
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.bobT += dt * hs * 1.5;

    const eye = this.crouching ? CROUCH_HEIGHT : EYE_HEIGHT;
    this._eye = damp(this._eye ?? eye, eye, 12, dt);

    const bobAmt = clamp(hs / 8, 0, 1) * (this.grounded ? 1 : .2);
    const bobY = Math.sin(this.bobT * 2) * .045 * bobAmt;
    const bobX = Math.cos(this.bobT) * .035 * bobAmt;

    this.camera.position.set(
      this.pos.x + bobX,
      this.pos.y + this._eye + bobY + (this.mount ? this.mount.height * .8 : 0),
      this.pos.z
    );

    // Roll: lean into strafes, plus a kick when you get guarded.
    const strafe = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw);
    this.viewRoll = damp(this.viewRoll, clamp(-strafe * .012, -.06, .06) + (this.dashing > 0 ? .12 : 0), 7, dt);

    // FOV punch while sprinting or dashing.
    const baseFov = this.game.settings.fov;
    const targetFov = baseFov + (hs > 7 ? 6 : 0) + (this.dashing > 0 ? 18 : 0) + this.charging * -8;
    this.camera.fov = damp(this.camera.fov, targetFov, 8, dt);
    this.camera.updateProjectionMatrix();

    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw + Math.PI);
    this.camera.rotateX(this.pitch);
    this.camera.rotateZ(this.viewRoll);

    this.landShake = damp(this.landShake, 0, 8, dt);
  }

  _deathCamera(dt) {
    // Fall to the ground and roll the view.
    this._eye = damp(this._eye ?? EYE_HEIGHT, .4, 3, dt);
    this.pitch = damp(this.pitch, -.5, 2, dt);
    this.viewRoll = damp(this.viewRoll, 1.1, 2, dt);
    this.camera.position.set(this.pos.x, this.pos.y + this._eye, this.pos.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw + Math.PI);
    this.camera.rotateX(this.pitch);
    this.camera.rotateZ(this.viewRoll);
  }

  /* ==========================================================
     View-model animation
     ========================================================== */
  /** What the camera actually sees at the hand's depth, and what a
   *  reference 16:9 full-height view would see there. Offsets are authored
   *  against the reference and rescaled, so the weapon sits in the same
   *  place whatever the viewport shape is. */
  _viewFrame(depth) {
    const halfH = Math.abs(depth) * Math.tan(this.camera.fov * Math.PI / 360);
    return {
      halfH,
      halfW: halfH * this.camera.aspect,
      refHalfW: halfH * (16 / 9)          // vertical fov is unchanged, so refHalfH === halfH
    };
  }

  /** Split screen gives each player half the vertical pixels, so a model
   *  covering the same fraction of the viewport looks physically smaller.
   *  Scale up to compensate. */
  get _viewportScale() { return this.game.mode === 'single' ? 1 : 1.75; }

  _animateViewModel(dt) {
    if (!this.viewHand) return;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const t = this.bobT;

    let px = .84, py = -.38, pz = -.74;
    let rx = .30, ry = -.42, rz = .52;

    // Idle sway + walk bob.
    const bob = clamp(hs / 8, 0, 1);
    px += Math.cos(t) * .022 * bob;
    py += Math.abs(Math.sin(t)) * .026 * bob;
    rz += Math.sin(t) * .05 * bob;

    if (this.blocking) {
      // Bring the guard up centre-screen.
      px = .30; py = -.22; pz = -.60;
      rx = .1; ry = -1.15; rz = -.35;
    } else if (this.attackT > 0) {
      const def = this.equippedDef();
      const k = 1 - this.attackT / (def.speed || .4);   // 0..1 through the swing
      const wind = clamp(k / .3, 0, 1);
      const strike = clamp((k - .3) / .45, 0, 1);
      const alt = this.comboStep % 2 === 0 ? 1 : -1;

      px = lerp(.84, .62 * alt, wind) + strike * -.62 * alt;
      py = lerp(-.38, -.06, wind) - strike * .34;
      pz = lerp(-.74, -.56, wind) - strike * .26;
      rx = lerp(.30, -.9, wind) + strike * 2.1;
      ry = lerp(-.42, -.9 * alt, wind) + strike * 1.5 * alt;
      rz = lerp(.52, .8 * alt, wind) - strike * 1.9 * alt;
    } else if (this.charging > 0) {
      // Bow draw: pull the model back and toward centre.
      px = lerp(.84, .14, this.charging);
      py = lerp(-.38, -.18, this.charging);
      pz = lerp(-.74, -.60, this.charging);
      ry = lerp(-.42, -.05, this.charging);
      rx = lerp(.30, 0, this.charging);
    } else if (this.dashCharge > 0) {
      px = .84 - this.dashCharge * .09;
      py = -.38 + this.dashCharge * .1;
      rz = .52 + this.dashCharge * .5;
    }

    // Recoil kick decays back to rest.
    if (this.recoil > 0) {
      pz += this.recoil * .16;
      rx -= this.recoil * .5;
      this.recoil = damp(this.recoil, 0, 9, dt);
    }

    /* --- make the placement independent of viewport shape --- */
    const frame = this._viewFrame(pz);
    // Re-express the authored x as the same fraction of the visible width.
    // Vertical fov does not change with the split, so py is left alone.
    px = frame.halfW * (px / frame.refHalfW);

    if (this._modelRef && this._baseScale) {
      const s = this._baseScale * this._viewportScale;
      this._modelRef.scale.setScalar(s);
      this._modelRef.position.y = -this._modelMinY * s - .06;
    }

    const rate = this.attackT > 0 ? 26 : 12;
    this.viewHand.position.x = damp(this.viewHand.position.x, px, rate, dt);
    this.viewHand.position.y = damp(this.viewHand.position.y, py, rate, dt);
    this.viewHand.position.z = damp(this.viewHand.position.z, pz, rate, dt);
    this.viewHand.rotation.x = damp(this.viewHand.rotation.x, rx, rate, dt);
    this.viewHand.rotation.y = damp(this.viewHand.rotation.y, ry, rate, dt);
    this.viewHand.rotation.z = damp(this.viewHand.rotation.z, rz, rate, dt);
  }

  /* ==========================================================
     Progression
     ========================================================== */
  gainXP(amount) {
    const mul = this.cls.id === 'emperor' ? 1.4 : 1;
    this.save.xp += Math.round(amount * mul);
    let leveled = false;
    while (this.save.xp >= xpToNext(this.save.level)) {
      this.save.xp -= xpToNext(this.save.level);
      this.save.level++;
      leveled = true;
    }
    if (leveled) {
      const before = this.save.rank;
      const r = rankFor(this.save.level);
      this.refreshStats();
      this.hp = this.hpMax; this.power = this.powerMax; this.stamina = this.staminaMax;
      this.game.audio.sfx('levelUp');
      this.game.vfx.levelUp(this.pos.clone());
      this.game.hud.toast(`LEVEL ${this.save.level}`, true);
      if (r.id !== before) {
        this.save.rank = r.id;
        this.game.audio.sfx('rankUp', { delay: .6 });
        setTimeout(() => this.game.hud.toast(`RANK ${r.id} — ${r.name.toUpperCase()}`, true), 900);
      }
      this.game.onLevelUp?.(this.save.level);
    }
  }
}
