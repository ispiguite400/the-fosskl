/* Mission chain, side quests and the story beats.
 *
 * Missions are a per-world list. Each one declares how it completes, and
 * the tracker renders whichever is active with a live distance to its
 * target. The story layer owns the cutscenes: waking in the ash, the
 * wizard's interruption, Hana joining and Hana dying. */

import * as THREE from 'three';
import { Save } from '../core/save.js';
import { Audio } from '../core/audio.js';
import { WORLDS, SIDEQUESTS, THREAD, worldById, rankFor } from '../data/gamedata.js';
import { wait } from '../core/util.js';

/** Level needed before the gate to the next world opens. */
export const GATE_LEVEL = { 1: 0, 2: 45, 3: 58, 4: 70, 5: 82, 6: 94, 7: 106, 8: 118, 9: 130, 10: 999 };

export class Missions {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.list = [];
  }

  /* ==========================================================
     Build the chain for the current world
     ========================================================== */
  buildFor(worldId) {
    const f = Save.data.flags;
    this.list = [];

    if (worldId === 1) {
      this.list = [
        {
          id: 'w1_clear', title: 'MISSION', desc: 'Cut down the soldiers in the village',
          count: 35, progress: 0, kind: 'kill',
          hint: 'Left click or R2 to swing. They guard about four hits in ten.'
        },
        {
          id: 'w1_kontana', title: 'MISSION', desc: 'Find the Kontana', kind: 'reach',
          target: () => this.game.kontanaPos,
          hint: 'A blade was left in the ash. Follow the marker.'
        },
        {
          id: 'w1_wizard', title: 'BOSS', desc: 'Face the Purple Wizard', kind: 'boss',
          target: () => this.game.boss?.pos,
          hint: 'Hold right mouse or L2 to guard. Guarding costs power.'
        }
      ];
    } else if (worldId === 4) {
      /* The waste gets its own chain. Its whole idea is that the desert is
       * not empty — it is covering something — so the missions send you to
       * dig at it rather than to walk across it. */
      const need = GATE_LEVEL[4];
      this.list = [
        {
          id: 'w4_hub', title: 'MISSION', desc: 'Reach the village', kind: 'reach',
          target: () => this.game.props.hubCenter, radius: 60,
          hint: 'Get inside before the storm turns. Out here it takes the horizon with it.'
        },
        {
          id: 'w4_city', title: 'MISSION', desc: 'Find what the dunes are covering', kind: 'reach',
          target: () => this.game.props.ruinPos, radius: 45,
          hint: 'There are roof ridges out there in rows. Rows do not happen by accident.'
        },
        {
          id: 'w4_cull', title: 'MISSION', desc: 'Clear the drowned streets of 18 scavengers',
          count: 18, progress: 0, kind: 'kill',
          hint: 'They came for the same reason you did. They got here first.'
        },
        {
          id: 'w4_boss', title: 'BOSS', desc: 'Destroy the Colossus of the Waste',
          kind: 'boss', target: () => this.game.boss?.pos ?? this.game.bossSpawn,
          hint: 'It has not moved in a very long time. Do not take that for dead.'
        },
        {
          id: 'w4_gate', title: 'MISSION', desc: `Reach level ${need}, then find the gate`,
          kind: 'gate', level: need, target: () => this.game.props.gatePos
        }
      ];
    } else if (worldId === 5) {
      /* White Silence is the world that takes something. Its chain is built
       * to walk you toward that: shelter first, then the field of everyone
       * who tried this before, then the thing that put them there. */
      const need = GATE_LEVEL[5];
      this.list = [
        {
          id: 'w5_hub', title: 'MISSION', desc: 'Reach the village', kind: 'reach',
          target: () => this.game.props.hubCenter, radius: 60,
          hint: 'Out of the wind. The cold takes your power first, then the rest of you.'
        },
        {
          id: 'w5_cairns', title: 'MISSION', desc: 'Find the field of markers', kind: 'reach',
          target: () => this.game.props.cairnPos, radius: 55,
          hint: 'Someone stacked those stones by hand. Count them if you have the stomach.'
        },
        {
          id: 'w5_cull', title: 'MISSION', desc: 'Put down 20 of what walks in the snow',
          count: 20, progress: 0, kind: 'kill',
          hint: 'The husks were people who stopped moving. Do not stop moving.'
        },
        {
          id: 'w5_boss', title: 'BOSS', desc: 'Destroy the Frost Sovereign',
          kind: 'boss', target: () => this.game.boss?.pos ?? this.game.bossSpawn,
          hint: 'It does not speak. It has never needed to.'
        },
        {
          id: 'w5_gate', title: 'MISSION', desc: `Reach level ${need}, then find the gate`,
          kind: 'gate', level: need, target: () => this.game.props.gatePos
        }
      ];
    } else if (worldId === 6) {
      /* The plain's idea is that being able to see everything is not the
       * same as being safe. Its chain walks you across open ground toward
       * the one place everything alive has to come back to. */
      const need = GATE_LEVEL[6];
      this.list = [
        {
          id: 'w6_hub', title: 'MISSION', desc: 'Reach the village', kind: 'reach',
          target: () => this.game.props.hubCenter, radius: 60,
          hint: 'You can see for a kilometre here. So can everything else.'
        },
        {
          id: 'w6_water', title: 'MISSION', desc: 'Find the only water on the plain', kind: 'reach',
          target: () => this.game.props.waterholePos, radius: 55,
          hint: 'Look for the one tree big enough to argue with the horizon.'
        },
        {
          id: 'w6_cull', title: 'MISSION', desc: 'Kill 22 of what waits in the grass',
          count: 22, progress: 0, kind: 'kill',
          hint: 'Half of it is already lying down. Watch the grass, not the skyline.'
        },
        {
          id: 'w6_boss', title: 'BOSS', desc: 'Destroy the Amber Beast',
          kind: 'boss', target: () => this.game.boss?.pos ?? this.game.bossSpawn,
          hint: 'It does not stalk. It has never had to.'
        },
        {
          id: 'w6_gate', title: 'MISSION', desc: `Reach level ${need}, then find the gate`,
          kind: 'gate', level: need, target: () => this.game.props.gatePos
        }
      ];
    } else {
      const w = worldById(worldId);
      const need = GATE_LEVEL[worldId] ?? 45;
      this.list = [
        {
          id: `w${worldId}_hub`, title: 'MISSION', desc: 'Reach the village', kind: 'reach',
          target: () => this.game.props.hubCenter, radius: 60,
          hint: 'Someone there will trade, teach and reshape you.'
        },
        {
          id: `w${worldId}_cull`, title: 'MISSION', desc: `Kill ${10 + worldId * 2} of whatever roams here`,
          count: 10 + worldId * 2, progress: 0, kind: 'kill'
        },
        {
          id: `w${worldId}_boss`, title: 'BOSS', desc: `Destroy ${(w.boss && this.game.bossName(w.boss)) || 'the warden of this place'}`,
          kind: 'boss', target: () => this.game.boss?.pos
        },
        {
          id: `w${worldId}_gate`, title: 'MISSION',
          desc: worldId === 10 ? 'Climb to the Hollow God' : `Reach level ${need}, then find the gate`,
          kind: worldId === 10 ? 'final' : 'gate', level: need,
          target: () => worldId === 10 ? this.game.boss?.pos : this.game.props.gatePos
        }
      ];
    }

    const done = new Set(Save.data.missions.completed);
    this.list = this.list.filter(m => !done.has(m.id));
    this.active = this.list[0] || null;
    if (this.active) this.announce(this.active);
    return this.active;
  }

  announce(m) {
    Audio.sfx('questNew');
    this.game.hud.toast(m.desc.toUpperCase());
    if (m.hint) setTimeout(() => this.game.hud.toast(m.hint), 2200);
    Save.data.missions.active = m.id;
    Save.write();
  }

  complete(m) {
    if (!m) return;
    Save.data.missions.completed.push(m.id);
    Audio.sfx('questDone');
    this.game.hud.toast('OBJECTIVE COMPLETE', true);
    this.list.shift();
    this.active = this.list[0] || null;
    Save.write();
    this.game.onMissionComplete(m);
    if (this.active) setTimeout(() => this.announce(this.active), 1800);
  }

  /* ==========================================================
     Events
     ========================================================== */
  onKill(enemy) {
    if (this.active?.kind === 'kill') {
      this.active.progress++;
      if (this.active.progress >= this.active.count) this.complete(this.active);
    }
    // Side quests.
    for (const [key, q] of Object.entries(Save.data.sideQuests)) {
      if (q.done || q.world !== Save.data.world) continue;
      const def = SIDEQUESTS.find(s => s.id === q.id);
      if (def?.kind === 'kill') this._bumpSide(key, q, def);
    }
  }

  onBossKill(boss) {
    if (this.active?.kind === 'boss') this.complete(this.active);
    for (const [key, q] of Object.entries(Save.data.sideQuests)) {
      if (q.done || q.world !== Save.data.world) continue;
      const def = SIDEQUESTS.find(s => s.id === q.id);
      if (def?.kind === 'boss') this._bumpSide(key, q, def);
    }
  }

  onChestOpened() {
    for (const [key, q] of Object.entries(Save.data.sideQuests)) {
      if (q.done || q.world !== Save.data.world) continue;
      const def = SIDEQUESTS.find(s => s.id === q.id);
      if (def?.kind === 'chest') this._bumpSide(key, q, def);
    }
  }

  onTamed() {
    for (const [key, q] of Object.entries(Save.data.sideQuests)) {
      if (q.done || q.world !== Save.data.world) continue;
      const def = SIDEQUESTS.find(s => s.id === q.id);
      if (def?.kind === 'tame') this._bumpSide(key, q, def);
    }
  }

  onSold() {
    for (const [key, q] of Object.entries(Save.data.sideQuests)) {
      if (q.done || q.world !== Save.data.world) continue;
      const def = SIDEQUESTS.find(s => s.id === q.id);
      if (def?.kind === 'sell') this._bumpSide(key, q, def);
    }
  }

  _bumpSide(key, q, def) {
    q.progress++;
    if (q.progress >= def.count) {
      q.done = true;
      Save.data.shekels += def.shekels;
      this.game.grantXP(def.xp);
      Audio.sfx('questDone');
      this.game.hud.toast(`SIDE QUEST COMPLETE — ${def.name.toUpperCase()}`, true);
    }
    Save.write();
  }

  /* ==========================================================
     Per-frame checks
     ========================================================== */
  update(dt) {
    const m = this.active;
    if (!m) { this.game.hud.setMission(null); return; }

    let distance = null;
    const target = m.target?.();
    if (target) distance = this.game.player.pos.distanceTo(target);

    if (m.kind === 'reach' && distance != null && distance < (m.radius ?? 6)) {
      this.complete(m);
      return;
    }
    if (m.kind === 'gate') {
      const lvl = Save.data.level;
      if (lvl < m.level) {
        this.game.hud.setMission({
          title: m.title, desc: `Reach level ${m.level}`,
          count: m.level, progress: lvl
        });
        return;
      }
      if (distance != null && distance < 7) {
        this.complete(m);
        this.game.travelToNextWorld();
        return;
      }
    }

    this.game.hud.setMission({
      title: m.title, desc: m.desc,
      distance, count: m.count, progress: m.progress
    });
  }
}

/* ============================================================
   STORY
   ============================================================ */
export class Story {
  constructor(game) {
    this.game = game;
  }

  get cine() { return this.game.hud.cine; }

  /** Waking on the ground. Plays on first spawn and every respawn. */
  async spawnCutscene({ firstTime = false } = {}) {
    const g = this.game;
    const p = g.player;
    g.setUIFocus(true);
    g.hud.show(false);
    this.cine.bars(true);

    // Start face-down on the ground, then push up onto your feet.
    p._eye = .18;
    p.pitch = -.9;
    p.viewRoll = .8;
    await this.cine.fadeFrom(1800);

    if (firstTime) {
      await this.cine.say('You were not supposed to wake up.', 1600);
    }

    // Rise: interpolate the eye height and level the view over ~2.6s.
    const t0 = performance.now();
    const rise = () => {
      const t = Math.min(1, (performance.now() - t0) / 2600);
      const e = t * t * (3 - 2 * t);
      p._eye = 0.18 + e * (1.68 - .18);
      p.pitch = -.9 + e * .9;
      p.viewRoll = .8 * (1 - e);
      // A stagger halfway up.
      if (t > .45 && t < .62) p._eye -= .12 * Math.sin((t - .45) / .17 * Math.PI);
      if (t < 1) requestAnimationFrame(rise);
    };
    rise();

    Audio.sfx('land', { volume: .5 });
    await wait(900);
    Audio.sfx('step', { volume: .8 });
    await wait(700);
    Audio.sfx('step', { volume: .8 });
    await wait(1200);

    if (firstTime) {
      await this.cine.say('Everything you were is behind you, burning.', 2200);
    }

    this.cine.bars(false);
    g.hud.show(true);
    g.setUIFocus(false);
    Save.data.flags.seenIntro = true;
    Save.write();
  }

  /** Halfway through the wizard fight: lifted, whited out, waking in the hub. */
  async wizardInterlude() {
    const g = this.game;
    const p = g.player;
    g.setUIFocus(true);
    g.hud.show(false);
    g.hud.setBoss(null);
    this.cine.bars(true);
    Audio.play('sorrow', { fade: 1.2 });

    // Lifted off the ground: the view rises and tilts back.
    p.vel.set(0, 0, 0);
    const startY = p.pos.y;
    const t0 = performance.now();
    const lift = () => {
      const t = Math.min(1, (performance.now() - t0) / 3400);
      p.pos.y = startY + t * t * 9;
      p.pitch = -t * .8;
      p.viewRoll = Math.sin(t * 7) * .12 * t;
      if (t < 1) requestAnimationFrame(lift);
    };
    lift();
    Audio.sfx('magic');
    g.vfx.magicBurst(p._chest(), [.7, .35, 1], 140);

    await this.cine.say('"Not yet," he says. "You are not finished being useful."', 2600);
    await wait(600);
    Audio.sfx('teleport');
    await this.cine.fadeTo('white', 1400);
    await wait(2600);

    // Wake in the hub of world 2.
    Save.data.flags.wizardDefeated = true;
    Save.data.world = 2;
    if (!Save.data.unlockedWorlds.includes(2)) Save.data.unlockedWorlds.push(2);
    Save.write(true);

    await g.loadWorld(2, { skipFade: true });
    p.pitch = -.6;
    p._eye = .3;

    await this.cine.fadeFrom(2200);
    await this.cine.say('A village. Grass. Someone has moved you a very long way.', 2400);

    // Stand up again.
    const t1 = performance.now();
    const rise = () => {
      const t = Math.min(1, (performance.now() - t1) / 2400);
      const e = t * t * (3 - 2 * t);
      p._eye = .3 + e * (1.68 - .3);
      p.pitch = -.6 + e * .6;
      if (t < 1) requestAnimationFrame(rise);
    };
    rise();
    await wait(2600);

    this.cine.bars(false);
    g.hud.show(true);
    g.setUIFocus(false);
    Audio.play(g.world.music);
  }

  /* ---------------- Hana ---------------- */
  girlJoin() {
    Save.data.flags.girlJoined = true;
    Save.write();
    this.game.spawnCompanion();
    this.game.hud.toast('HANA FOLLOWS YOU', true);
    Audio.sfx('questNew');
  }

  /** World 5: she is killed by the Frost Sovereign. */
  async girlDeathSequence() {
    const g = this.game;
    if (Save.data.flags.girlDead) return;

    g.setUIFocus(true);
    g.hud.show(false);
    this.cine.bars(true);
    Audio.play('sorrow', { fade: 1.4 });

    // Freeze the fight and look at her.
    g.freeze = true;
    if (g.companion) {
      const look = g.companion.pos.clone().setY(g.companion.pos.y + .8);
      g.lookAt(look, 1.4);
    }
    await wait(1600);

    g.dialogue.start('girl_death', { displayName: 'Hana' });
  }

  /** Called from the dialogue tree when the last line resolves. */
  async girlDie() {
    const g = this.game;
    Save.data.flags.girlDead = true;
    Save.write(true);

    await wait(900);
    if (g.companion) {
      // She goes limp, then fades.
      const c = g.companion;
      const t0 = performance.now();
      const fall = () => {
        const t = Math.min(1, (performance.now() - t0) / 3000);
        c.root.rotation.x = -t * 1.4;
        c.root.traverse(o => {
          if (o.isMesh) {
            if (!o.material.transparent) { o.material = o.material.clone(); o.material.transparent = true; }
            o.material.opacity = 1 - t;
          }
        });
        if (t < 1) requestAnimationFrame(fall);
        else { c.root.parent?.remove(c.root); g.companion = null; }
      };
      fall();
    }

    await this.cine.say('She does not say anything else.', 3000);
    await wait(1200);

    // The sky answers — in whatever language this world's sky speaks.
    g.sky.setRain(true, 240);
    if (g.sky.weather === 'rain') Audio.sfx('thunder', { volume: .8 });

    await this.cine.say({
      snow: 'The snow closes over her, the way it closes over everything here.',
      sand: 'The wind picks up, and starts taking her away a grain at a time.',
      rain: 'It begins to rain.'
    }[g.sky.weather] ?? 'It begins to rain.', 2600);
    await wait(800);

    this.cine.bars(false);
    g.hud.show(true);
    g.setUIFocus(false);
    g.freeze = false;
    Audio.play('boss');
    g.hud.toast('THE FROST SOVEREIGN IS STILL HERE', true);
  }

  /* ==========================================================
     The thread
     ----------------------------------------------------------
     Each warden that falls yields one verse of the poem that
     runs under all ten worlds, and draws a word out of the
     Wizard — who is the Hollow God's steward, and who is
     steadily less comfortable with the job.
     ========================================================== */
  async wardenFell(worldId) {
    const beat = THREAD[worldId];
    if (!beat) return;
    const g = this.game;

    Save.data.verses ??= [];
    const isNew = !Save.data.verses.includes(worldId);
    if (isNew) {
      Save.data.verses.push(worldId);
      Save.data.verses.sort((a, b) => a - b);
      Save.write();
    }

    // Let the kill land before the room changes.
    await wait(2600);
    if (!g.running || g.player?.dead) return;

    if (isNew) {
      Audio.sfx('questNew');
      g.hud.toast(`VERSE ${Save.data.verses.length} OF TEN`, true);
      await wait(900);
      await this.cine.say(beat.verse, 3400);
    }
    if (beat.wizard && !Save.data.flags[`wiz${worldId}`]) {
      Save.data.flags[`wiz${worldId}`] = true;
      Save.write();
      Audio.sfx('magic', { volume: .45 });
      await this.cine.say(beat.wizard, 3600);
    }
  }

  /** How much of the poem the player is carrying. */
  get versesFound() { return (Save.data.verses || []).length; }

  /* ---------------- world transitions ---------------- */
  async worldIntro(worldId) {
    const w = worldById(worldId);
    await this.cine.chapter(w.jp, w.name.toUpperCase(), 3000);
    if (w.intro) await this.cine.say(w.intro, 2600);
  }

  /** After the final boss dies. */
  async ending() {
    const g = this.game;
    g.setUIFocus(true);
    g.hud.show(false);
    this.cine.bars(true);
    Audio.play('victory', { fade: 2 });

    Save.data.flags.finalDefeated = true;
    Save.write(true);

    const verses = (Save.data.verses || []).length;

    await wait(1800);
    await this.cine.say('The Hollow God comes apart the way a held breath does.', 3000);
    await this.cine.say('Underneath there is nothing at all — only the shape of a name that was taken.', 3400);
    await this.cine.say('Ten skies. Every one of them was a door He built to keep something in.', 3200);
    await wait(600);
    if (verses >= 10) {
      // The whole poem, in the player's hands, says what He was keeping out.
      await this.cine.say('You have all ten verses now, and read together they are not ten things.', 3200);
      await this.cine.say('They are one sentence, and the subject of it is you.', 3400);
      await this.cine.say('He built ten skies to keep one forsaken thing outside, and every warden ' +
                          'he set at a door was a man who had never been told your name.', 4200);
      await wait(600);
    } else if (verses > 0) {
      await this.cine.say(`You carry ${verses} of the ten verses. Enough to know it was a sentence. ` +
                          'Not enough to finish reading it.', 3600);
      await wait(400);
    }
    await this.cine.say('You think of a girl in the snow who called you something you had not earned, and then had.', 3800);
    await wait(800);
    await this.cine.chapter('追放者たち', 'THE FORSAKEN ONE', 4200);
    await this.cine.fadeTo('black', 2000);
    await wait(1200);
    g.returnToMenu();
  }
}

/* ============================================================
   TUTORIAL
   World one is meant to teach the game, so instead of dumping
   the controls at the player it watches what they have actually
   done and prompts for the next thing they have not tried.
   Each step fires once and is remembered in the save.
   ============================================================ */
const STEPS = [
  { id: 'look',    text: 'Move the mouse or the right stick to look around',
    done: g => g._tut.looked > 2.2 },
  { id: 'move',    text: 'W A S D or the left stick to move',
    done: g => g._tut.moved > 3 },
  { id: 'sprint',  text: 'Hold SHIFT (or press L3) to sprint — it burns the pale stamina bar',
    done: g => g._tut.sprinted > 1.2 },
  { id: 'attack',  text: 'LEFT CLICK or R2 to swing. Each swing costs power — the orange bar',
    done: g => g._tut.swings >= 3 },
  { id: 'guarded', text: 'They guard about four hits in ten. Bait it out, then punish the opening',
    done: g => g._tut.enemiesHit >= 2, when: g => g._tut.swings >= 3 },
  { id: 'kill',    text: 'Strike from behind for bonus damage and experience',
    done: g => Save.data.kills >= 1, when: g => g._tut.enemiesHit >= 1 },
  { id: 'allies',  text: 'The knights in blue are with you — fight beside them',
    done: g => g._tut.sawAlly > 4, when: g => g._tut.sawAlly > 0 },
  { id: 'slots',   text: '1-4 or the shoulder buttons swap weapons · TAB opens your inventory',
    done: g => g._tut.swappedSlot || g._tut.openedInv, when: g => Save.data.kills >= 2 },
  { id: 'block',   text: 'Hold RIGHT CLICK or L2 to guard. Guarding drains power, and empty power costs health',
    done: g => g._tut.blocked > 1.0, when: g => Save.data.flags.blockUnlocked },
  { id: 'dash',    text: 'Airborne: HOLD jump to hang, then RELEASE to Wind Dash where you are looking',
    done: g => g._tut.dashes >= 1, when: g => Save.data.flags.blockUnlocked },
  { id: 'chain',   text: 'Dash into an enemy and it launches you again — a good player never lands',
    done: g => g._tut.dashHits >= 1, when: g => g._tut.dashes >= 1 }
];

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.holdT = 0;
    this.gapT = 0;
    game._tut = {
      looked: 0, moved: 0, sprinted: 0, blocked: 0,
      swings: 0, enemiesHit: 0, dashes: 0, dashHits: 0,
      swappedSlot: false, openedInv: false, sawAlly: 0
    };
    this._node = null;
  }

  get seen() {
    Save.data.tutorial ??= {};
    return Save.data.tutorial;
  }

  _ensureNode() {
    if (this._node) return this._node;
    const n = document.createElement('div');
    n.id = 'tutorial';
    document.getElementById('layer-game').appendChild(n);
    return this._node = n;
  }

  update(dt) {
    // Only world one teaches, and only while the player is actually playing.
    if (this.game.world?.id !== 1 || this.game.uiFocus || this.game.freeze) {
      if (this._node) this._node.classList.remove('on');
      return;
    }

    const g = this.game, p = g.player, t = g._tut;
    const inp = g.input.players[0];

    /* --- watch what they do --- */
    if (Math.abs(inp.look.x) + Math.abs(inp.look.y) > .004) t.looked += dt;
    if (inp.move.x || inp.move.y) t.moved += dt;
    if (inp.isDown('sprint') && (inp.move.x || inp.move.y)) t.sprinted += dt;
    if (p?.blocking) t.blocked += dt;
    if (inp.justPressed('slot2') || inp.justPressed('slot3') ||
        inp.justPressed('slot4') || inp.justPressed('nextSlot')) t.swappedSlot = true;
    if (g.inventory.open) t.openedInv = true;
    // Count time spent near a friendly knight.
    if (g.allies?.some(a => !a.dead && a.pos.distanceTo(p.pos) < 22)) t.sawAlly += dt;

    /* --- pick the next unfinished step --- */
    if (this.active && this.active.done(g)) {
      this.seen[this.active.id] = true;
      Save.write();
      Audio.sfx('questDone', { volume: .4 });
      this.active = null;
      this.gapT = 1.4;
      this._ensureNode().classList.remove('on');
    }
    if (this.gapT > 0) { this.gapT -= dt; return; }

    if (!this.active) {
      this.active = STEPS.find(s =>
        !this.seen[s.id] && (!s.when || s.when(g)) && !s.done(g)) || null;
      if (this.active) {
        const n = this._ensureNode();
        n.innerHTML = this.active.text;
        n.classList.add('on');
        Audio.sfx('uiMove', { volume: .5 });
      }
    }
  }

  dispose() { this._node?.remove(); this._node = null; }
}
