/* Two-player modes beyond the duel.
 *
 * Each mode is a small object with a setup and a per-frame tick, so the game
 * only has to know "run the current match" rather than carrying a branch for
 * every rule set. They all share the split screen, the full combat system and
 * whatever the world already puts on the ground.
 *
 *   LAST STAND   co-op. Waves of everything the world has, with a breather
 *                between each to build. You share a life pool.
 *   KING         versus. Hold a circle that moves every half minute. You only
 *                score while you are in it and the other player is not.
 *   RACE         versus. Three banners in a line across open country and a
 *                world that is still full of things that bite.
 *
 * Between them they use the combat, the building, the enemy roster and the
 * terrain — nothing here is a separate little game bolted on the side.
 */

import * as THREE from 'three';
import { clamp } from '../core/util.js';
import { Audio } from '../core/audio.js';
import { mat, prim, buildBanner } from '../entities/models.js';

export const MODES = ['versus', 'coop', 'lastStand', 'king', 'race'];

/** A marked circle on the ground: the hill, a checkpoint, a defence line. */
export class Zone {
  constructor(scene, { radius = 14, color = 0xf0a24a } = {}) {
    this.radius = radius;
    this.center = new THREE.Vector3();
    const geo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true);
    this.mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: .3, side: THREE.DoubleSide, depthWrite: false
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 15;
    scene.add(this.mesh);
    this.t = 0;
  }
  moveTo(v, groundY) {
    this.center.copy(v);
    this.center.y = groundY;
    this.mesh.position.set(v.x, groundY + 2.4, v.z);
    this.mesh.scale.set(this.radius, 5, this.radius);
  }
  contains(p) {
    const dx = p.pos.x - this.center.x, dz = p.pos.z - this.center.z;
    return dx * dx + dz * dz < this.radius * this.radius;
  }
  update(dt) {
    this.t += dt;
    this.mat.opacity = .22 + Math.sin(this.t * 2.2) * .08;
  }
  setColor(c) { this.mat.color.setHex(c); }
  dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

/* ============================================================
   LAST STAND — co-op horde
   ============================================================ */
export const lastStand = {
  id: 'lastStand',
  label: 'LAST STAND',
  coop: true,
  world: 3,

  setup(g) {
    const st = g.match;
    st.wave = 0;
    st.lives = 6;
    st.breather = 8;              // seconds before wave one
    st.alive = [];
    st.zone = new Zone(g.scene, { radius: 26, color: 0x6fd8a0 });
    const c = g.props.hubCenter;
    st.zone.moveTo(c, g.terrain.heightAt(c.x, c.z));

    // Clear the field: this is a defence, not a patrol.
    for (const e of g.enemies) e.dispose();
    g.enemies.length = 0;
    g.boss = null; g.lesserBosses = [];

    // Both players stand on the line with a full kit and plenty of timber.
    for (const p of [g.player, g.player2]) {
      if (!p) continue;
      p.pushTempLoadout('versus');
      const a = p === g.player ? -4 : 4;
      const pos = new THREE.Vector3(c.x + a, 0, c.z + 3);
      pos.y = g.terrain.heightAt(pos.x, pos.z);
      p.spawnAt(pos, Math.PI);
    }
    g.save.timber = 220;
    g.hud.toast('LAST STAND — HOLD THE SHRINE', true);
    g.hud.toast('BUILD WHILE YOU CAN. B TO BUILD.');
  },

  tick(g, dt) {
    const st = g.match;
    st.zone.update(dt);

    // Anything that wandered out of the world still counts as gone.
    st.alive = g.enemies.filter(e => !e.dead);

    if (st.breather > 0) {
      st.breather -= dt;
      if (st.breather <= 0) this._startWave(g);
      g.matchBanner = `WAVE ${st.wave + 1} IN ${Math.ceil(st.breather)}`;
      return;
    }

    if (!st.alive.length) {
      // Wave cleared. Pay for it, and give them a moment to rebuild.
      st.breather = 14;
      g.save.timber = Math.min(999, (g.save.timber ?? 0) + 60);
      g.hud.toast(`WAVE ${st.wave} CLEARED — +60 TIMBER`, true);
      Audio.sfx('questDone');
      return;
    }
    g.matchBanner = `WAVE ${st.wave} · ${st.alive.length} LEFT · ${st.lives} LIVES`;
  },

  _startWave(g) {
    const st = g.match;
    st.wave++;
    const n = Math.min(26, 4 + st.wave * 2);
    const types = g.world.enemyTypes;
    const c = st.zone.center;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.28 + Math.random() * .4;
      const r = st.zone.radius + 26 + Math.random() * 30;
      const p = new THREE.Vector3(c.x + Math.cos(a) * r, 0, c.z + Math.sin(a) * r);
      p.y = g.terrain.heightAt(p.x, p.z);
      const e = g.spawnEnemy(p, types[Math.floor(Math.random() * types.length)]);
      if (e) { e.state = 'chase'; e.aggro = 400; }
    }
    Audio.sfx('bossRoar', { volume: .6 });
    g.hud.toast(`WAVE ${st.wave}`, true);
  },

  /** A player went down: it costs the shared pool, not the run. */
  onDown(g, player) {
    const st = g.match;
    st.lives--;
    if (st.lives <= 0) {
      g.matchOver(`THE SHRINE FELL ON WAVE ${st.wave}`);
      return true;
    }
    g.hud.toast(`DOWN — ${st.lives} LIVES LEFT`, true);
    setTimeout(() => {
      const c = st.zone.center;
      const pos = new THREE.Vector3(c.x + (Math.random() - .5) * 8, 0, c.z + (Math.random() - .5) * 8);
      pos.y = g.terrain.heightAt(pos.x, pos.z);
      player.spawnAt(pos, Math.PI);
      g.vfx.teleportFlash(pos.clone().setY(pos.y + 1));
    }, 2200);
    return true;
  },

  teardown(g) { g.match.zone?.dispose(); }
};

/* ============================================================
   KING OF THE HILL — versus
   ============================================================ */
export const king = {
  id: 'king',
  label: 'KING OF THE HILL',
  versus: true,
  world: 2,
  target: 60,                     // seconds of held ground to win

  setup(g) {
    const st = g.match;
    st.held = [0, 0];
    st.moveIn = 30;
    st.zone = new Zone(g.scene, { radius: 13, color: 0xf0a24a });
    for (const e of g.enemies) e.dispose();
    g.enemies.length = 0;
    this._move(g);

    for (const p of [g.player, g.player2]) {
      if (!p) continue;
      p.pushTempLoadout('versus');
    }
    g.hud.toast('KING OF THE HILL', true);
    g.hud.toast('HOLD IT ALONE. SIXTY SECONDS WINS.');
  },

  _move(g) {
    const st = g.match;
    const c = g.props.hubCenter;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.28, r = 30 + Math.random() * 90;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (!g.terrain.isFlatGround(x, z, .3)) continue;
      st.zone.moveTo(new THREE.Vector3(x, 0, z), g.terrain.heightAt(x, z));
      // Put both players back an equal distance from the new ground.
      const spawn = (p, side) => {
        if (!p) return;
        const px = x + Math.cos(a + Math.PI / 2) * side * 22;
        const pz = z + Math.sin(a + Math.PI / 2) * side * 22;
        p.spawnAt(new THREE.Vector3(px, g.terrain.heightAt(px, pz), pz),
                  Math.atan2(x - px, z - pz));
      };
      if (st.moveIn < 30) { spawn(g.player, -1); spawn(g.player2, 1); }
      st.moveIn = 30;
      g.hud.toast('THE HILL HAS MOVED', true);
      Audio.sfx('questNew');
      return;
    }
  },

  tick(g, dt) {
    const st = g.match;
    st.zone.update(dt);
    st.moveIn -= dt;
    if (st.moveIn <= 0) this._move(g);

    const inA = g.player && !g.player.dead && st.zone.contains(g.player);
    const inB = g.player2 && !g.player2.dead && st.zone.contains(g.player2);
    // Contested ground scores for nobody, which is what makes it a fight.
    if (inA && !inB) st.held[0] += dt;
    else if (inB && !inA) st.held[1] += dt;
    st.zone.setColor(inA && inB ? 0xd85c5c : inA ? 0x6fa0f0 : inB ? 0xf07a4a : 0xf0a24a);

    g.versusScore = [Math.floor(st.held[0]), Math.floor(st.held[1])];
    g.matchBanner = `${Math.floor(st.held[0])} — ${Math.floor(st.held[1])}  ·  MOVES IN ${Math.ceil(st.moveIn)}`;

    for (const i of [0, 1]) {
      if (st.held[i] >= this.target) { g.matchOver(`PLAYER ${i + 1} HOLDS THE HILL`); return; }
    }
  },

  onDown(g, player) {
    // Death just puts you out of the circle for a while.
    setTimeout(() => {
      const c = g.match.zone.center;
      const a = Math.random() * 6.28;
      const px = c.x + Math.cos(a) * 34, pz = c.z + Math.sin(a) * 34;
      player.spawnAt(new THREE.Vector3(px, g.terrain.heightAt(px, pz), pz),
                     Math.atan2(c.x - px, c.z - pz));
    }, 2400);
    return true;
  },

  teardown(g) { g.match.zone?.dispose(); }
};

/* ============================================================
   RACE — versus
   ============================================================ */
export const race = {
  id: 'race',
  label: 'RACE',
  versus: true,
  world: 6,

  setup(g) {
    const st = g.match;
    st.leg = [0, 0];              // checkpoint each player is on
    st.marks = [];
    st.zone = new Zone(g.scene, { radius: 11, color: 0x6fd8a0 });

    const c = g.props.hubCenter;
    const bearing = Math.random() * 6.28;
    for (let i = 1; i <= 3; i++) {
      const d = i * 260;
      const x = c.x + Math.cos(bearing) * d, z = c.z + Math.sin(bearing) * d;
      const s = g.terrain.findSpawn({ x, z }, 90);
      const banner = buildBanner(g.rng, {});
      banner.position.set(s.x, s.y, s.z);
      banner.scale.setScalar(3.2);
      g.scene.add(banner);
      st.marks.push({ pos: new THREE.Vector3(s.x, s.y, s.z), mesh: banner });
    }
    st.zone.moveTo(st.marks[0].pos, st.marks[0].pos.y);

    for (const p of [g.player, g.player2]) {
      if (!p) continue;
      p.pushTempLoadout('versus');
      const side = p === g.player ? -1 : 1;
      const px = c.x + Math.cos(bearing + Math.PI / 2) * side * 5;
      const pz = c.z + Math.sin(bearing + Math.PI / 2) * side * 5;
      p.spawnAt(new THREE.Vector3(px, g.terrain.heightAt(px, pz), pz),
                Math.atan2(st.marks[0].pos.x - px, st.marks[0].pos.z - pz));
    }
    g.hud.toast('RACE — THREE BANNERS', true);
    g.hud.toast('The country between them is not empty.');
  },

  tick(g, dt) {
    const st = g.match;
    st.zone.update(dt);
    const players = [g.player, g.player2];
    for (let i = 0; i < 2; i++) {
      const p = players[i];
      if (!p || p.dead || st.leg[i] >= st.marks.length) continue;
      const m = st.marks[st.leg[i]];
      if (p.pos.distanceTo(m.pos) < 12) {
        st.leg[i]++;
        Audio.sfx('questDone');
        g.hud.toast(`PLAYER ${i + 1} — BANNER ${st.leg[i]} OF 3`, true);
        if (st.leg[i] >= st.marks.length) { g.matchOver(`PLAYER ${i + 1} WINS THE RACE`); return; }
      }
    }
    // The marker follows whoever is in front.
    const lead = st.leg[0] >= st.leg[1] ? 0 : 1;
    const next = st.marks[Math.min(st.leg[lead], st.marks.length - 1)];
    st.zone.moveTo(next.pos, next.pos.y);
    g.versusScore = [st.leg[0], st.leg[1]];
    g.matchBanner = `BANNERS  ${st.leg[0]} — ${st.leg[1]}`;
  },

  onDown(g, player) {
    // Losing a fight costs you distance, not the race.
    setTimeout(() => {
      const st = g.match;
      const i = player === g.player ? 0 : 1;
      const back = st.marks[Math.max(0, st.leg[i] - 1)].pos;
      const px = back.x + (Math.random() - .5) * 14, pz = back.z + (Math.random() - .5) * 14;
      player.spawnAt(new THREE.Vector3(px, g.terrain.heightAt(px, pz), pz), 0);
    }, 2000);
    return true;
  },

  teardown(g) {
    g.match.zone?.dispose();
    for (const m of g.match.marks || []) m.mesh.parent?.remove(m.mesh);
  }
};

export const MODE_DEFS = { lastStand, king, race };
