/* Every living thing in the world plus chests and projectiles.
 *
 * Enemies use a small state machine (idle -> chase -> windup -> strike ->
 * recover) and roll a 40% block on any incoming melee hit. A blocked hit is
 * the game's central mechanic: it drains the attacker's power, knocks them
 * back hard and launches them into the air, which is where the Wind Dash
 * takes over. */

import * as THREE from 'three';
import { clamp, lerp, damp, makeRNG } from '../core/util.js';
import { buildHumanoid, buildAnimal, buildWeapon, buildChest, buildPickup } from './models.js';
import { ENEMIES, BOSSES, ANIMALS, ITEMS, LOOT, WEAPON_POOL_BY_WORLD } from '../data/gamedata.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

/* ============================================================
   Base
   ============================================================ */
export class Actor {
  constructor(game, pos) {
    this.game = game;
    this.pos = new THREE.Vector3().copy(pos);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.dead = false;
    this.remove = false;
    this.grounded = true;
    this.radius = .5;
    this.height = 1.8;
  }

  groundY(x = this.pos.x, z = this.pos.z) { return this.game.terrain.heightAt(x, z); }

  applyGravity(dt, g = -30) {
    this.vel.y += g * dt;
    this.pos.y += this.vel.y * dt;
    const gy = this.groundY();
    if (this.pos.y <= gy) {
      this.pos.y = gy;
      if (this.vel.y < -12) this.onHardLand?.(this.vel.y);
      this.vel.y = 0;
      this.grounded = true;
    } else this.grounded = false;
  }

  moveHorizontal(dt, friction = 8) {
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    // Slide along props rather than sticking to them.
    if (!this.game.props.collideAt(nx, this.pos.z, this.radius)) this.pos.x = nx;
    else this.vel.x *= -.2;
    if (!this.game.props.collideAt(this.pos.x, nz, this.radius)) this.pos.z = nz;
    else this.vel.z *= -.2;

    const k = Math.exp(-friction * dt);
    this.vel.x *= k; this.vel.z *= k;

    const h = this.game.terrain.half - 20;
    this.pos.x = clamp(this.pos.x, -h, h);
    this.pos.z = clamp(this.pos.z, -h, h);
  }

  faceTowards(target, dt, rate = 9) {
    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    let d = want - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * rate);
  }

  dispose() { this.root?.parent?.remove(this.root); }
}

/* ============================================================
   Humanoid animation helper — shared by enemies, NPCs and Hana.
   ============================================================ */
function poseHumanoid(rig, t, { speed = 0, attack = 0, block = 0, stagger = 0, airborne = false, dead = 0, aiming = false }) {
  if (!rig) return;
  const walk = Math.min(1, speed / 5);
  const f = t * (5 + walk * 5);

  // Legs: opposed swing, amplitude scaled by speed.
  const swing = Math.sin(f) * .78 * walk;
  rig.legL.hip.rotation.x = swing;
  rig.legR.hip.rotation.x = -swing;
  rig.legL.knee.rotation.x = Math.max(0, -Math.sin(f) * .9) * walk;
  rig.legR.knee.rotation.x = Math.max(0, Math.sin(f) * .9) * walk;

  if (airborne) {
    rig.legL.hip.rotation.x = -.5; rig.legR.hip.rotation.x = .3;
    rig.legL.knee.rotation.x = .9; rig.legR.knee.rotation.x = .5;
  }

  // Torso bob and counter-rotation.
  rig.hips.position.y = rig.hips.userData.baseY ??= rig.hips.position.y;
  rig.hips.position.y = (rig.hips.userData.baseY) + Math.abs(Math.sin(f)) * .045 * walk;
  rig.torso.rotation.y = -Math.sin(f) * .14 * walk;
  rig.torso.rotation.x = walk * .1 + stagger * .5;

  // Arms.
  if (aiming) {
    // Bow arm out, draw hand back to the cheek.
    rig.armL.shoulder.rotation.x = -1.55;
    rig.armL.shoulder.rotation.z = .32;
    rig.armL.elbow.rotation.x = -.12;
    rig.armR.shoulder.rotation.x = -1.35;
    rig.armR.shoulder.rotation.z = -.5;
    rig.armR.elbow.rotation.x = -1.9;
    rig.torso.rotation.y = .55;
  } else if (attack > 0) {
    // Overhead cut: wind up behind the head, then drive down and across.
    const a = 1 - attack;                       // 0 at start, 1 at end
    const wind = clamp(a / .35, 0, 1);
    const strike = clamp((a - .35) / .4, 0, 1);
    rig.armR.shoulder.rotation.x = lerp(-.2, -2.5, wind) + strike * 3.4;
    rig.armR.shoulder.rotation.z = lerp(0, -.5, wind) + strike * .8;
    rig.armR.elbow.rotation.x = lerp(-.3, -1.5, wind) + strike * 1.2;
    rig.armL.shoulder.rotation.x = -.6 + strike * .5;
    rig.torso.rotation.y = lerp(0, .5, wind) - strike * 1.0;
  } else if (block > 0) {
    // Guard: blade across the body, shoulders squared up.
    rig.armR.shoulder.rotation.x = -1.5;
    rig.armR.shoulder.rotation.z = -.7;
    rig.armR.elbow.rotation.x = -1.2;
    rig.armL.shoulder.rotation.x = -1.3;
    rig.armL.shoulder.rotation.z = .7;
    rig.armL.elbow.rotation.x = -1.1;
    rig.torso.rotation.y = .35;
  } else {
    rig.armL.shoulder.rotation.x = -swing * .7;
    rig.armR.shoulder.rotation.x = swing * .7;
    rig.armL.shoulder.rotation.z = .12;
    rig.armR.shoulder.rotation.z = -.12;
    rig.armL.elbow.rotation.x = -.3 - walk * .3;
    rig.armR.elbow.rotation.x = -.3 - walk * .3;
  }

  if (dead > 0) {
    rig.hips.rotation.x = lerp(0, -1.5, clamp(dead, 0, 1));
    rig.torso.rotation.x = lerp(0, .8, clamp(dead, 0, 1));
  }
  if (rig.cloak) rig.cloak.rotation.z = Math.sin(t * 2.2) * .05 + speed * .02;
}

/* ============================================================
   ENEMY
   ============================================================ */
export class Enemy extends Actor {
  constructor(game, pos, typeId, levelScale = 1) {
    super(game, pos);
    const def = ENEMIES[typeId] || ENEMIES.ashigaru;
    this.typeId = typeId;
    this.def = def;
    this.name = def.name;
    this.rng = makeRNG((Math.random() * 0xffffffff) >>> 0);

    this.levelScale = levelScale;
    this.hpMax = Math.round(def.hp * levelScale);
    this.hp = this.hpMax;
    this.damage = def.damage * levelScale;
    this.speed = def.speed;
    this.blockChance = def.blockChance;      // 0.40 by design
    this.xp = Math.round(def.xp * levelScale);
    this.radius = .55 * (def.scale || 1);
    this.armor = def.armor || 0;

    const palette = this._palette(typeId);
    const built = buildHumanoid({
      scale: def.scale || 1, ...palette,
      helmet: !def.feral, heavy: def.armor > .3,
      cloak: typeId === 'shadow', cloakColor: 0x1a1030,
      ghostly: !!def.ghostly
    });
    this.root = built.root;
    this.rig = built.rig;
    this.height = built.height;
    this.root.position.copy(pos);
    game.scene.add(this.root);

    // Weapon in the right hand.
    if (def.weapon && def.weapon !== 'fist') {
      this.weapon = buildWeapon(def.weapon, this._enemyColors(typeId));
      this.weapon.scale.setScalar(.9);
      this.weapon.rotation.x = -Math.PI / 2;
      this.rig.armR.hand.add(this.weapon);
    }
    if (def.shielded) {
      this.shield = buildWeapon('iron_shield', this._enemyColors(typeId));
      this.shield.scale.setScalar(.75);
      this.shield.rotation.y = Math.PI / 2;
      this.rig.armL.hand.add(this.shield);
    }

    this.state = 'idle';
    this.t = 0;
    this.stateT = 0;
    this.attackCooldown = this.rng.range(.4, 1.6);
    this.blockTimer = 0;
    this.staggerT = 0;
    this.deadT = 0;
    this.aggro = def.aggro || 28;
    this.home = new THREE.Vector3().copy(pos);
    this.patrolTarget = null;
    this.hitFlash = 0;
    this.lastHitBy = null;
    this.smokeBlind = 0;
  }

  _palette(id) {
    const P = {
      ashigaru:    { cloth: 0x4a4030, armor: 0x5a4a3a, accent: 0x8c2f2f },
      ronin:       { cloth: 0x2f3440, armor: 0x3f4550, accent: 0xb03225 },
      bandit:      { cloth: 0x3a2a20, armor: 0x4a3a2a, accent: 0x6a4a2a },
      shadow:      { cloth: 0x14101c, armor: 0x1f1a2a, accent: 0x6a3fbf, skin: 0x3a3448 },
      husk:        { cloth: 0x3a3630, armor: 0x4a4640, accent: 0x6a5a3a, skin: 0x8a7f6a },
      frost_knight:{ cloth: 0x2a3a4a, armor: 0x7f97ad, accent: 0x4a8fc0, skin: 0xa8b8c8 },
      beast:       { cloth: 0x4a3020, armor: 0x5a3a24, accent: 0x8c4a2a, skin: 0x7a5a3a },
      drowned:     { cloth: 0x24403a, armor: 0x35564a, accent: 0x4a8f7a, skin: 0x6a8a7a },
      legionary:   { cloth: 0x7a2020, armor: 0xa88a4a, accent: 0xc9a44a },
      kingsguard:  { cloth: 0x1f1a2a, armor: 0x8f8a96, accent: 0xc9a44a },
      seraph:      { cloth: 0xe8e0d0, armor: 0xf0e8d8, accent: 0xffc861, skin: 0xf0dcc0 },
      archer:      { cloth: 0x3f4a30, armor: 0x4f5a3a, accent: 0x8a7a3a },
      crossbowman: { cloth: 0x3a3428, armor: 0x6a6050, accent: 0x8c5a2f },
      sniper:      { cloth: 0x2a3448, armor: 0x8f9fb8, accent: 0x4ab4ff, skin: 0xd8c8b0 },
      oni:         { cloth: 0x4a1f1f, armor: 0x8c2f2f, accent: 0xe8c04a, skin: 0xa8483a },
      monk:        { cloth: 0x8a5a2a, armor: 0x6a4420, accent: 0xd8b060 }
    };
    return P[id] || P.ashigaru;
  }

  _enemyColors(id) {
    const tint = {
      shadow: { h: 275, s: .5, l: .3 }, frost_knight: { h: 200, s: .4, l: .7 },
      seraph: { h: 45, s: .8, l: .7 }, legionary: { h: 40, s: .6, l: .5 },
      sniper: { h: 200, s: .8, l: .65 }, oni: { h: 0, s: .5, l: .35 }
    }[id] || { h: 210, s: .06, l: .62 };
    return { blade: tint, handle: { h: 20, s: .5, l: .2 } };
  }

  /* ---------------- damage ---------------- */

  /** Returns 'blocked' | 'hit' | 'killed'. */
  takeHit(amount, fromPos, { canBeBlocked = true, attacker = null, backstab = false } = {}) {
    if (this.dead) return 'dead';

    // The 40% guard. Not rolled if the hit lands from behind.
    if (canBeBlocked && !backstab && this.state !== 'stagger' && this.rng.chance(this.blockChance)) {
      this.state = 'block';
      this.stateT = .5;
      this.game.vfx.hitSpark(this._chestPos(), tmpV.copy(this.pos).sub(fromPos).normalize(), true);
      this.game.audio.sfxAt('block', this.pos, this.game.listenerPos, 60);
      return 'blocked';
    }

    const mult = backstab ? 3 : 1;
    const dmg = Math.max(1, amount * mult * (1 - this.armor));
    this.hp -= dmg;
    this.hitFlash = .16;
    this.lastHitBy = attacker;
    this.game.vfx.bloodBurst(this._chestPos(), tmpV.copy(this.pos).sub(fromPos).normalize());
    this.game.vfx.damageNumber(this._headPos(), dmg, backstab ? 'crit' : 'normal');
    this.game.audio.sfxAt('hitFlesh', this.pos, this.game.listenerPos, 60);

    // Knock back a little so fights have space.
    tmpV.copy(this.pos).sub(fromPos).setY(0).normalize().multiplyScalar(4.5);
    this.vel.add(tmpV);

    if (this.hp <= 0) { this.die(); return 'killed'; }

    this.state = 'stagger';
    this.stateT = .28;
    return 'hit';
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
    this.game.audio.sfxAt('death', this.pos, this.game.listenerPos, 70, { volume: .45 });
    this.game.vfx.bloodBurst(this._chestPos(), new THREE.Vector3(0, 1, 0));
    this.game.onEnemyKilled(this);
  }

  _chestPos() { return tmpV2.set(this.pos.x, this.pos.y + this.height * .62, this.pos.z).clone(); }
  _headPos()  { return tmpV2.set(this.pos.x, this.pos.y + this.height * 1.02, this.pos.z).clone(); }

  /* ---------------- think ---------------- */
  update(dt, player) {
    this.t += dt;
    this.stateT -= dt;
    this.attackCooldown -= dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.smokeBlind = Math.max(0, this.smokeBlind - dt);

    if (this.dead) {
      this.deadT += dt;
      this.applyGravity(dt);
      this.moveHorizontal(dt, 5);
      this.root.position.copy(this.pos);
      this.root.rotation.y = this.yaw;
      poseHumanoid(this.rig, this.t, { dead: this.deadT / .6 });
      // Sink and fade, then retire the actor.
      if (this.deadT > 2.4) {
        const k = clamp((this.deadT - 2.4) / 2, 0, 1);
        this.root.position.y = this.pos.y - k * 1.6;
        this.root.traverse(o => {
          if (o.isMesh) {
            if (!o.material.transparent) { o.material = o.material.clone(); o.material.transparent = true; }
            o.material.opacity = 1 - k;
          }
        });
        if (k >= 1) this.remove = true;
      }
      return;
    }

    const toPlayer = tmpV.copy(player.pos).sub(this.pos);
    const dist = toPlayer.length();
    const blinded = this.smokeBlind > 0;
    const canSee = !blinded && dist < this.aggro * 1.6;

    switch (this.state) {
      case 'idle':
      case 'patrol': {
        if (canSee && dist < this.aggro && !player.dead) { this.state = 'chase'; this.stateT = 0; break; }
        // Wander around the spawn point.
        if (!this.patrolTarget || this.pos.distanceTo(this.patrolTarget) < 3 || this.stateT < -6) {
          const a = this.rng() * 6.28, r = this.rng.range(6, 26);
          this.patrolTarget = new THREE.Vector3(
            this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
          this.stateT = 0;
        }
        this._walkTo(this.patrolTarget, dt, this.speed * .38);
        break;
      }
      case 'chase': {
        if (!canSee && dist > this.aggro * 1.8) { this.state = 'idle'; break; }
        this.faceTowards(player.pos, dt);

        /* --- ranged skirmisher --- */
        const R = this.def.ranged;
        if (R) {
          if (dist < R.keepAway) {
            // Too close: back off while staying face-on.
            tmpV2.copy(this.pos).sub(player.pos).setY(0).normalize();
            this.vel.x += tmpV2.x * this.speed * dt * 8;
            this.vel.z += tmpV2.z * this.speed * dt * 8;
            this.moveHorizontal(dt);
          } else if (dist > R.range) {
            this._walkTo(player.pos, dt, this.speed);
          } else {
            // In the pocket: strafe a little and shoot.
            tmpV2.copy(player.pos).sub(this.pos).setY(0).normalize().cross(UP)
              .multiplyScalar(this.speed * .35 * (this.rng() < .5 ? 1 : -1));
            this.vel.x += tmpV2.x * dt * 3;
            this.vel.z += tmpV2.z * dt * 3;
            this.moveHorizontal(dt);
            if (this.attackCooldown <= 0) { this.state = 'aim'; this.stateT = .6; }
          }
          break;
        }

        const reach = this._reach();
        if (dist < reach && this.attackCooldown <= 0) {
          this.state = 'windup';
          this.stateT = .42;
          this.game.audio.sfxAt('swing', this.pos, this.game.listenerPos, 40, { volume: .5, delay: .3 });
        } else if (dist > reach * .85) {
          this._walkTo(player.pos, dt, this.speed);
        } else {
          // Circle-strafe just outside reach so groups do not clump.
          const side = (this.rng() < .5 ? 1 : -1);
          tmpV2.copy(toPlayer).setY(0).normalize().cross(UP).multiplyScalar(side * this.speed * .5);
          this.vel.x += tmpV2.x * dt * 6; this.vel.z += tmpV2.z * dt * 6;
          this.moveHorizontal(dt);
        }
        break;
      }
      case 'windup': {
        this.faceTowards(player.pos, dt, 4);
        this.moveHorizontal(dt, 12);
        if (this.stateT <= 0) { this.state = 'strike'; this.stateT = .2; this._struck = false; }
        break;
      }
      case 'strike': {
        this.moveHorizontal(dt, 12);
        if (!this._struck && this.stateT < .12) {
          this._struck = true;
          const d = this.pos.distanceTo(player.pos);
          if (d < this._reach() + .8) {
            player.takeHit(this.damage, this.pos, { source: this });
          }
          this.game.vfx.slash(
            this._chestPos().add(tmpV.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(1.1)),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, this.t)),
            1.6);
        }
        if (this.stateT <= 0) {
          this.state = 'chase';
          this.attackCooldown = this.rng.range(.8, 2.0) / Math.max(.5, this.levelScale * .35);
        }
        break;
      }
      case 'aim': {
        this.faceTowards(player.pos, dt, 6);
        this.moveHorizontal(dt, 10);
        if (this.stateT <= 0) {
          this._loose(player);
          const R = this.def.ranged;
          this.attackCooldown = this.rng.range(R.cooldown[0], R.cooldown[1]);
          this.state = 'chase';
        }
        break;
      }
      case 'block': {
        this.faceTowards(player.pos, dt, 5);
        this.moveHorizontal(dt, 12);
        if (this.stateT <= 0) { this.state = 'chase'; this.attackCooldown = .25; }
        break;
      }
      case 'stagger': {
        this.moveHorizontal(dt, 4);
        if (this.stateT <= 0) this.state = 'chase';
        break;
      }
    }

    this.applyGravity(dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;

    const speed = Math.hypot(this.vel.x, this.vel.z);
    poseHumanoid(this.rig, this.t, {
      speed,
      attack: this.state === 'windup' ? clamp(this.stateT / .42, 0, 1) * .5 + .5
            : this.state === 'strike' ? clamp(this.stateT / .2, 0, 1) * .5 : 0,
      aiming: this.state === 'aim',
      block: this.state === 'block' ? 1 : 0,
      stagger: this.state === 'stagger' ? .5 : 0,
      airborne: !this.grounded
    });

    // Red flash on hit.
    if (this.hitFlash > 0) {
      this.root.traverse(o => { if (o.isMesh && o.material.emissive) o.material.emissiveIntensity = 0; });
    }
  }

  /** Loose an arrow, leading the player's movement a little. */
  _loose(player) {
    const R = this.def.ranged;
    const from = this._chestPos().setY(this.pos.y + this.height * .78);
    // Aim ahead of where they are going, and up to cover the drop.
    const lead = tmpV.copy(player.vel ?? new THREE.Vector3()).multiplyScalar(.28);
    const target = tmpV2.copy(player.pos).add(lead).setY(player.pos.y + 1.1);
    const dir = target.sub(from).normalize();
    const dist = this.pos.distanceTo(player.pos);
    dir.y += dist * 0.006;                     // arc compensation
    dir.normalize();

    this.game.spawnProjectile({
      pos: from, dir, speed: R.speed,
      damage: this.damage, owner: this, fromPlayer: false,
      kind: this.def.weapon === 'crossbow' ? 'arrow' : 'arrow',
      itemId: 'knives', drop: 9, radius: .18
    });
    this.game.audio.sfxAt('bowShot', this.pos, this.game.listenerPos, 70);
  }

  _reach() { return 2.4 * (this.def.scale || 1) + (this.def.weapon === 'spear' ? 1.6 : 0); }

  _walkTo(target, dt, speed) {
    tmpV2.set(target.x - this.pos.x, 0, target.z - this.pos.z);
    const d = tmpV2.length();
    if (d < .2) return;
    tmpV2.normalize();
    this.vel.x += tmpV2.x * speed * dt * 9;
    this.vel.z += tmpV2.z * speed * dt * 9;
    const s = Math.hypot(this.vel.x, this.vel.z);
    if (s > speed) { this.vel.x *= speed / s; this.vel.z *= speed / s; }
    this.faceTowards(target, dt);
    this.moveHorizontal(dt, 3);
  }
}

/* ============================================================
   BOSS
   ============================================================ */
export class Boss extends Enemy {
  constructor(game, pos, bossId, levelScale = 1) {
    const def = BOSSES[bossId];
    // Reuse the enemy chassis with a stand-in archetype, then override.
    super(game, pos, 'ronin', 1);
    this.bossId = bossId;
    this.bdef = def;
    this.name = def.name;
    this.isBoss = true;

    this.root.parent?.remove(this.root);
    const built = buildHumanoid({
      scale: def.scale, cloth: 0x14101c, armor: def.color, accent: def.color,
      helmet: !def.cloak, heavy: true, cloak: !!def.cloak, cloakColor: def.color,
      glow: def.final ? 6 : 2.2, glowColor: def.color
    });
    this.root = built.root; this.rig = built.rig; this.height = built.height;
    this.root.position.copy(pos);
    game.scene.add(this.root);

    this.weapon = buildWeapon(def.final ? 'voidblade' : 'odachi',
      { blade: { h: 280, s: .5, l: .4 }, handle: { h: 0, s: 0, l: .1 } });
    this.weapon.rotation.x = -Math.PI / 2;
    this.rig.armR.hand.add(this.weapon);

    this.hpMax = Math.round(def.hp * levelScale);
    this.hp = this.hpMax;
    this.damage = def.damage * levelScale;
    this.speed = def.speed;
    this.xp = def.xp;
    this.radius = .9 * def.scale;
    this.aggro = 90;
    this.armor = .25;
    this.blockChance = .40;
    this.phase = 1;
    this.abilityCd = 4;
    this.summons = [];
  }

  takeHit(amount, fromPos, opts = {}) {
    const before = this.hp / this.hpMax;
    const res = super.takeHit(amount, fromPos, opts);
    const after = this.hp / this.hpMax;

    // Phase transitions fire once as the threshold is crossed.
    if (this.bdef.phaseAt && before > this.bdef.phaseAt && after <= this.bdef.phaseAt) {
      this.phase = 2;
      this.game.onBossPhase?.(this, 2);
    }
    if (this.bdef.phase2At && before > this.bdef.phase2At && after <= this.bdef.phase2At) {
      this.phase = 3;
      this.game.onBossPhase?.(this, 3);
    }
    return res;
  }

  update(dt, player) {
    if (!this.dead) {
      this.abilityCd -= dt;
      const dist = this.pos.distanceTo(player.pos);
      if (this.abilityCd <= 0 && dist < 60 && this.state !== 'stagger') {
        this._useAbility(player, dist);
        this.abilityCd = lerp(6.5, 2.4, (this.phase - 1) / 2) + this.rng.range(0, 2);
      }
    }
    super.update(dt, player);
  }

  _useAbility(player, dist) {
    const list = this.bdef.abilities || [];
    if (!list.length) return;
    const pick = this.rng.pick(list);
    const V = this.game.vfx;

    switch (pick) {
      case 'bolt': {
        this.game.audio.sfxAt('magic', this.pos, this.game.listenerPos, 80);
        const from = this._chestPos();
        const dir = tmpV.copy(player.pos).setY(player.pos.y + 1).sub(from).normalize().clone();
        this.game.spawnProjectile({
          pos: from, dir, speed: 34, damage: this.damage * 1.3, owner: this,
          kind: 'magic', color: this.bdef.color, radius: .35, drop: 0, homing: this.phase >= 2 ? .8 : 0
        });
        V.magicBurst(from, [.7, .35, 1], 30);
        break;
      }
      case 'teleport': {
        this.game.audio.sfxAt('teleport', this.pos, this.game.listenerPos, 90);
        V.teleportFlash(this.pos.clone().add(new THREE.Vector3(0, 1, 0)));
        const a = this.rng() * 6.28, r = this.rng.range(8, 16);
        this.pos.x = player.pos.x + Math.cos(a) * r;
        this.pos.z = player.pos.z + Math.sin(a) * r;
        this.pos.y = this.groundY();
        V.teleportFlash(this.pos.clone().add(new THREE.Vector3(0, 1, 0)));
        break;
      }
      case 'summon': {
        this.game.audio.sfxAt('bossRoar', this.pos, this.game.listenerPos, 110);
        const n = 2 + this.phase;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 6.28;
          const p = new THREE.Vector3(
            this.pos.x + Math.cos(a) * 8, 0, this.pos.z + Math.sin(a) * 8);
          p.y = this.game.terrain.heightAt(p.x, p.z);
          const e = this.game.spawnEnemy(p, this.rng.pick(this.game.world.enemyTypes));
          if (e) { V.magicBurst(p.clone().setY(p.y + 1), [.7, .3, 1], 40); this.summons.push(e); }
        }
        break;
      }
      case 'charge': {
        this.game.audio.sfxAt('bossRoar', this.pos, this.game.listenerPos, 110, { volume: .7 });
        tmpV.copy(player.pos).sub(this.pos).setY(0).normalize();
        this.vel.addScaledVector(tmpV, 34);
        this.state = 'strike'; this.stateT = .6; this._struck = false;
        break;
      }
      case 'slam': {
        this.game.audio.sfxAt('bomb', this.pos, this.game.listenerPos, 110);
        V.explosion(this.pos.clone().setY(this.pos.y + .5), 9, [.7, .5, .3]);
        if (dist < 12) {
          player.takeHit(this.damage * 1.4, this.pos, { source: this, launch: 12 });
        }
        for (const e of this.game.enemies) {
          if (e !== this && e.pos.distanceTo(this.pos) < 12) e.vel.y += 6;
        }
        break;
      }
      case 'quake': {
        this.game.audio.sfxAt('thunder', this.pos, this.game.listenerPos, 130);
        this.game.shake(1.4, 1.2);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * 6.28;
          const p = this.pos.clone().add(new THREE.Vector3(Math.cos(a) * 9, .6, Math.sin(a) * 9));
          V.explosion(p, 5, [.6, .45, .3]);
        }
        if (dist < 20 && player.grounded) player.takeHit(this.damage * .8, this.pos, { source: this, launch: 9 });
        break;
      }
      case 'beam': {
        // Only the final boss. A sustained sweep the player must break line on.
        this.game.audio.sfxAt('magic', this.pos, this.game.listenerPos, 140, { volume: 1 });
        const from = this._chestPos();
        for (let i = 0; i < 9; i++) {
          const dir = tmpV.copy(player.pos).setY(player.pos.y + 1).sub(from).normalize().clone();
          dir.applyAxisAngle(UP, (i - 4) * .09);
          this.game.spawnProjectile({
            pos: from.clone(), dir, speed: 46, damage: this.damage, owner: this,
            kind: 'magic', color: 0xffffff, radius: .4, drop: 0, delay: i * .07
          });
        }
        break;
      }
    }
  }
}

/* ============================================================
   NPC
   ============================================================ */
export class NPC extends Actor {
  constructor(game, pos, { tree, displayName, line, qid = 0, look = {} }) {
    super(game, pos);
    this.tree = tree;
    this.displayName = displayName;
    this.line = line;
    this.qid = qid;
    this.interactRange = 4.2;

    const built = buildHumanoid({
      scale: .98, helmet: false,
      cloth: look.cloth ?? 0x5a4a3a, armor: look.armor ?? 0x6a5a44,
      accent: look.accent ?? 0x8c5a2f, skin: look.skin ?? 0xc79a72,
      cloak: !!look.cloak, cloakColor: look.cloakColor ?? 0x3a3a5a
    });
    this.root = built.root; this.rig = built.rig; this.height = built.height;
    this.root.position.copy(pos);
    this.pos.y = this.groundY();
    this.root.position.copy(this.pos);
    game.scene.add(this.root);

    this.t = Math.random() * 10;
    this.yaw = Math.random() * 6.28;
  }

  update(dt, player) {
    this.t += dt;
    // Turn to face the player when they are close enough to talk.
    const d = this.pos.distanceTo(player.pos);
    if (d < 10) this.faceTowards(player.pos, dt, 3);
    this.root.rotation.y = this.yaw;
    this.root.position.copy(this.pos);
    poseHumanoid(this.rig, this.t, { speed: 0 });
    // Idle breathing.
    this.rig.torso.rotation.x = Math.sin(this.t * 1.4) * .04;
    this.rig.head.rotation.y = Math.sin(this.t * .6) * .3;
  }
}

/* ============================================================
   HANA — the companion. Follows, then dies in world 5.
   ============================================================ */
export class Companion extends Actor {
  constructor(game, pos) {
    super(game, pos);
    const built = buildHumanoid({
      scale: 1, child: true, helmet: false,
      cloth: 0x8a4a5a, armor: 0x8a4a5a, accent: 0xd8a0b0, skin: 0xdcae8a
    });
    this.root = built.root; this.rig = built.rig; this.height = built.height;
    this.root.position.copy(pos);
    game.scene.add(this.root);
    this.displayName = 'Hana';
    this.t = 0;
    this.radius = .32;
    this.teleportTimer = 0;
  }

  update(dt, player) {
    this.t += dt;
    const d = this.pos.distanceTo(player.pos);

    // Follow, but keep a respectful distance.
    let speed = 0;
    if (d > 3.2) {
      const target = player.pos;
      tmpV2.set(target.x - this.pos.x, 0, target.z - this.pos.z).normalize();
      const want = clamp((d - 3) * 1.6, 0, 8.5);
      this.vel.x += tmpV2.x * want * dt * 10;
      this.vel.z += tmpV2.z * want * dt * 10;
      this.faceTowards(player.pos, dt, 7);
      speed = Math.hypot(this.vel.x, this.vel.z);
    } else {
      this.faceTowards(player.pos, dt, 4);
    }

    this.applyGravity(dt);
    this.moveHorizontal(dt, 6);

    // If she falls too far behind (dash, cliff), catch her up.
    this.teleportTimer = d > 45 ? this.teleportTimer + dt : 0;
    if (this.teleportTimer > 1.6) {
      const a = Math.random() * 6.28;
      this.pos.set(player.pos.x + Math.cos(a) * 3, 0, player.pos.z + Math.sin(a) * 3);
      this.pos.y = this.groundY();
      this.teleportTimer = 0;
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    poseHumanoid(this.rig, this.t, { speed });
  }
}

/* ============================================================
   ANIMAL — tameable, rideable
   ============================================================ */
export class Animal extends Actor {
  constructor(game, pos, typeId) {
    super(game, pos);
    const def = ANIMALS[typeId] || ANIMALS.horse;
    this.typeId = typeId;
    this.def = def;
    this.name = def.name;
    this.tamed = false;
    this.ridden = false;
    this.rng = makeRNG((Math.random() * 0xffffffff) >>> 0);
    this.radius = .8 * def.scale;
    this.interactRange = 4.5;

    const built = buildAnimal(def, this.rng);
    this.root = built.root; this.rig = built.rig; this.height = built.height;
    this.pos.y = this.groundY();
    this.root.position.copy(this.pos);
    game.scene.add(this.root);

    this.t = Math.random() * 20;
    this.target = null;
    this.flee = 0;
    this.home = this.pos.clone();
  }

  tame() {
    this.tamed = true;
    this.game.audio.sfxAt('tame', this.pos, this.game.listenerPos, 40);
    this.game.vfx.magicBurst(this.pos.clone().setY(this.pos.y + this.height), [1, .8, .4], 50);
  }

  update(dt, player) {
    this.t += dt;
    let speed = 0;

    if (this.ridden) {
      // Driven by the player controller; just follow the requested velocity.
      this.applyGravity(dt);
      this.moveHorizontal(dt, 3.2);
      speed = Math.hypot(this.vel.x, this.vel.z);
    } else {
      const d = this.pos.distanceTo(player.pos);
      if (!this.tamed && d < 9) this.flee = 2.2;
      this.flee = Math.max(0, this.flee - dt);

      if (this.flee > 0) {
        tmpV2.copy(this.pos).sub(player.pos).setY(0).normalize();
        this.vel.x += tmpV2.x * this.def.speed * dt * 8;
        this.vel.z += tmpV2.z * this.def.speed * dt * 8;
        this.yaw = Math.atan2(tmpV2.x, tmpV2.z);
      } else if (this.tamed && d > 8) {
        tmpV2.copy(player.pos).sub(this.pos).setY(0).normalize();
        this.vel.x += tmpV2.x * this.def.speed * .5 * dt * 8;
        this.vel.z += tmpV2.z * this.def.speed * .5 * dt * 8;
        this.faceTowards(player.pos, dt, 4);
      } else {
        // Graze and drift.
        if (!this.target || this.pos.distanceTo(this.target) < 3) {
          const a = this.rng() * 6.28, r = this.rng.range(6, 34);
          this.target = new THREE.Vector3(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
        }
        if (this.rng.chance(dt * .5)) {
          tmpV2.set(this.target.x - this.pos.x, 0, this.target.z - this.pos.z).normalize();
          this.vel.x += tmpV2.x * this.def.speed * .22;
          this.vel.z += tmpV2.z * this.def.speed * .22;
          this.faceTowards(this.target, dt, 2);
        }
      }
      this.applyGravity(dt);
      this.moveHorizontal(dt, 3.6);
      speed = Math.hypot(this.vel.x, this.vel.z);
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;

    // Gallop: legs in diagonal pairs, body rocking.
    const f = this.t * (3 + speed * 1.3);
    const amp = clamp(speed / 8, 0, 1);
    const rig = this.rig;
    rig.legs[0].hip.rotation.x = Math.sin(f) * .8 * amp;
    rig.legs[3].hip.rotation.x = Math.sin(f) * .8 * amp;
    rig.legs[1].hip.rotation.x = -Math.sin(f) * .8 * amp;
    rig.legs[2].hip.rotation.x = -Math.sin(f) * .8 * amp;
    for (let i = 0; i < 4; i++) {
      rig.legs[i].knee.rotation.x = Math.max(0, Math.sin(f + (i % 2) * Math.PI)) * .7 * amp;
    }
    rig.trunk.rotation.x = Math.sin(f * 2) * .05 * amp;
    rig.trunk.position.y = this.height + Math.abs(Math.sin(f)) * .1 * amp;
    rig.neck.rotation.x = -.1 + Math.sin(f) * .08 * amp;
    rig.tail.rotation.x = Math.sin(this.t * 3) * .2;
  }
}

/* ============================================================
   CHEST
   ============================================================ */
export class Chest extends Actor {
  constructor(game, pos, { locked = false, id }) {
    super(game, pos);
    this.id = id;
    this.locked = locked;
    this.opened = false;
    this.interactRange = 3.4;
    this.root = buildChest(locked);
    this.pos.y = this.groundY();
    this.root.position.copy(this.pos);
    this.root.rotation.y = Math.random() * 6.28;
    game.scene.add(this.root);
    this.lidAngle = 0;
    this.t = 0;
  }

  open(player) {
    if (this.opened) return null;
    if (this.locked) {
      if (!this.game.consumeKey()) {
        this.game.audio.sfx('locked');
        this.game.hud.toast('LOCKED — FIND A KEY');
        return null;
      }
    }
    this.opened = true;
    this.game.audio.sfxAt('chest', this.pos, this.game.listenerPos, 40);
    this.game.vfx.magicBurst(this.pos.clone().setY(this.pos.y + 1), [1, .8, .35], 60);
    return this.rollLoot();
  }

  rollLoot() {
    const rng = makeRNG((this.id * 2654435761) >>> 0);
    const total = LOOT.reduce((a, l) => a + l.weight, 0);
    let r = rng() * total;
    let entry = LOOT[0];
    for (const l of LOOT) { if (r < l.weight) { entry = l; break; } r -= l.weight; }

    const worldId = this.game.world.id;
    const pool = WEAPON_POOL_BY_WORLD[worldId] || ['sword'];

    switch (entry.type) {
      case 'xp': return { type: 'xp', amount: Math.round(rng.range(...entry.amount) * (1 + worldId * .5)) };
      case 'shekels': return { type: 'shekels', amount: Math.round(rng.range(...entry.amount) * (1 + worldId * .4)) };
      case 'weapon': return { type: 'item', id: rng.pick(pool), qty: 1 };
      case 'consumable': return { type: 'item', id: rng.pick(['potion_hp', 'potion_pow', 'potion_stam', 'key']), qty: rng.int(1, 3) };
      case 'op': return { type: 'item', id: 'potion_op', qty: 1 };
    }
    return { type: 'shekels', amount: 50 };
  }

  update(dt) {
    this.t += dt;
    const want = this.opened ? -2.1 : 0;
    this.lidAngle = damp(this.lidAngle, want, 6, dt);
    this.root.userData.lid.rotation.x = this.lidAngle;
    if (!this.opened) {
      this.root.position.y = this.pos.y + Math.sin(this.t * 1.6) * .03;
    }
  }
}

/* ============================================================
   Ground pickup
   ============================================================ */
export class Pickup extends Actor {
  constructor(game, pos, itemId, qty = 1) {
    super(game, pos);
    this.itemId = itemId;
    this.qty = qty;
    this.interactRange = 2.6;
    this.root = buildPickup(itemId, game.save.colors);
    this.pos.y = this.groundY() + .3;
    this.root.position.copy(this.pos);
    game.scene.add(this.root);
    this.t = Math.random() * 6;
    this.life = 300;                 // despawn after five minutes
  }

  update(dt, player) {
    this.t += dt; this.life -= dt;
    this.root.rotation.y += dt * 1.4;
    this.root.position.y = this.pos.y + Math.sin(this.t * 2) * .18;
    if (this.life <= 0) this.remove = true;

    // Vacuum in when the player is very close.
    const d = this.pos.distanceTo(player.pos);
    if (d < 2.2) {
      tmpV.copy(player.pos).sub(this.pos).normalize().multiplyScalar(dt * 9);
      this.pos.add(tmpV);
      if (d < .9) this.game.collectPickup(this);
    }
  }
}

/* ============================================================
   PROJECTILE — arrows, bolts, knives, bombs, magic
   ============================================================ */
export class Projectile {
  constructor(game, opts) {
    this.game = game;
    this.pos = opts.pos.clone();
    this.vel = opts.dir.clone().normalize().multiplyScalar(opts.speed);
    this.damage = opts.damage;
    this.owner = opts.owner;
    this.kind = opts.kind || 'arrow';
    this.drop = opts.drop ?? 9;
    this.life = opts.life ?? 6;
    this.radius = opts.radius ?? .2;
    this.homing = opts.homing || 0;
    this.itemId = opts.itemId;
    this.effect = opts.effect;
    this.blastRadius = opts.blastRadius || 0;
    this.fuse = opts.fuse ?? null;
    this.remove = false;
    this.delay = opts.delay || 0;
    this.fromPlayer = opts.fromPlayer || false;

    let mesh;
    if (this.kind === 'magic') {
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(this.radius * 1.6, 10, 8),
        new THREE.MeshBasicMaterial({ color: opts.color ?? 0xb45cff })
      );
      const l = new THREE.PointLight(opts.color ?? 0xb45cff, 5, 14, 2);
      mesh.add(l);
    } else if (this.kind === 'bomb') {
      mesh = buildWeapon(this.itemId || 'smoke_bomb', game.save.colors);
    } else {
      mesh = buildWeapon(this.itemId === 'shuriken' ? 'shuriken' : 'knives', game.save.colors);
      mesh.scale.setScalar(.9);
    }
    this.root = mesh;
    this.root.position.copy(this.pos);
    game.scene.add(this.root);
  }

  update(dt, player) {
    if (this.delay > 0) { this.delay -= dt; return; }
    this.life -= dt;
    if (this.life <= 0) { this.detonate(); return; }

    if (this.homing > 0) {
      const target = this.fromPlayer ? this.game.nearestEnemy(this.pos, 40) : player;
      if (target) {
        tmpV.copy(target.pos).setY(target.pos.y + 1).sub(this.pos).normalize()
          .multiplyScalar(this.vel.length() * this.homing * dt * 3);
        this.vel.add(tmpV);
      }
    }

    this.vel.y -= this.drop * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.root.position.copy(this.pos);

    // Point along the flight path.
    if (this.kind !== 'magic') {
      this.root.lookAt(tmpV.copy(this.pos).add(this.vel));
      this.root.rotateX(Math.PI / 2);
      if (this.kind === 'bomb') this.root.rotation.z += dt * 8;
    }

    if (this.fuse != null) {
      this.fuse -= dt;
      if (this.fuse <= 0) { this.detonate(); return; }
    }

    // Ground / prop collision.
    const gy = this.game.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= gy) {
      this.pos.y = gy;
      if (this.kind === 'bomb') { if (this.fuse == null) this.detonate(); else { this.vel.multiplyScalar(.2); } }
      else this.stick();
      return;
    }

    /* --- hits --- */
    if (this.fromPlayer) {
      for (const e of this.game.enemies) {
        if (e.dead || e === this.owner) continue;
        if (this.pos.distanceTo(tmpV.copy(e.pos).setY(e.pos.y + e.height * .6)) < e.radius + this.radius + .4) {
          this.onHitActor(e);
          return;
        }
      }
    } else if (player && !player.dead) {
      if (this.pos.distanceTo(tmpV.copy(player.pos).setY(player.pos.y + 1)) < 1 + this.radius) {
        player.takeHit(this.damage, this.pos, { source: this.owner, ranged: true });
        this.game.vfx.hitSpark(this.pos, new THREE.Vector3(0, 1, 0));
        this.destroy();
        return;
      }
    }
  }

  onHitActor(e) {
    if (this.blastRadius > 0) { this.detonate(); return; }
    e.takeHit(this.damage, this.pos, { canBeBlocked: false, attacker: this.owner });
    this.game.audio.sfxAt('arrowHit', this.pos, this.game.listenerPos, 50);
    this.destroy();
  }

  stick() {
    // Thrown knives can be picked back up.
    if (this.itemId && (this.itemId === 'knives' || this.itemId === 'shuriken') && Math.random() < .6) {
      this.game.spawnPickup(this.pos.clone(), this.itemId, 1);
    }
    this.destroy();
  }

  detonate() {
    const V = this.game.vfx;
    const A = this.game.audio;
    switch (this.effect) {
      case 'smoke':
        V.smokeCloud(this.pos, 9);
        A.sfxAt('smoke', this.pos, this.game.listenerPos, 70);
        for (const e of this.game.enemies) {
          if (e.pos.distanceTo(this.pos) < 14) e.smokeBlind = 6;
        }
        break;
      case 'teleport':
        A.sfxAt('teleport', this.pos, this.game.listenerPos, 80);
        V.teleportFlash(this.pos);
        if (this.fromPlayer) this.game.player.teleportTo(this.pos);
        break;
      case 'frost': {
        V.explosion(this.pos, this.blastRadius || 8, [.5, .8, 1]);
        A.sfxAt('bomb', this.pos, this.game.listenerPos, 110, { volume: .7 });
        const r = this.blastRadius || 8;
        for (const e of this.game.enemies) {
          if (e.dead) continue;
          const d = e.pos.distanceTo(this.pos);
          if (d < r) {
            e.takeHit(this.damage * (1 - d / r * .5), this.pos, { canBeBlocked: false, attacker: this.owner });
            // Frozen in place rather than knocked around.
            e.state = 'stagger'; e.stateT = 3.2;
            e.vel.set(0, 0, 0);
          }
        }
        this.destroy();
        return;
      }
      case 'poison': {
        V.smokeCloud(this.pos, this.blastRadius || 10);
        V.magicBurst(this.pos, [.48, .85, .29], 60);
        A.sfxAt('smoke', this.pos, this.game.listenerPos, 90);
        // A lingering cloud that keeps ticking for eight seconds.
        this.game.addHazard({
          pos: this.pos.clone(), radius: this.blastRadius || 10,
          dps: this.damage * .5, life: 8, owner: this.owner, color: [.48, .85, .29]
        });
        this.destroy();
        return;
      }
      case 'fire':
      case 'shock':
      default: {
        const color = this.effect === 'shock' ? [.4, .7, 1] : [1, .5, .15];
        V.explosion(this.pos, this.blastRadius || 6, color);
        A.sfxAt('bomb', this.pos, this.game.listenerPos, 120);
        this.game.shake(.7, .5);
        const r = this.blastRadius || 6;
        if (this.fromPlayer) {
          for (const e of this.game.enemies) {
            if (e.dead) continue;
            const d = e.pos.distanceTo(this.pos);
            if (d < r) {
              e.takeHit(this.damage * (1 - d / r * .55), this.pos, { canBeBlocked: false, attacker: this.owner });
              if (this.effect === 'shock') { e.state = 'stagger'; e.stateT = 1.6; }
            }
          }
        } else {
          const d = this.game.player.pos.distanceTo(this.pos);
          if (d < r) this.game.player.takeHit(this.damage * (1 - d / r * .55), this.pos, { source: this.owner });
        }
        break;
      }
    }
    this.destroy();
  }

  destroy() {
    this.remove = true;
    this.root.parent?.remove(this.root);
  }
}
