/*
 * The player's hands: turns input (keyboard and mouse, DualSense, touch) into the actor's intent,
 * and runs interaction: repairing (the puzzle), picking things up, abilities, the killer's swing,
 * emotes, spectating and the echo once dead.
 */
import { input } from '../core/input.js';
import { bus } from '../core/events.js';
import { audio } from '../audio/audio.js';
import { angDiff } from '../core/util.js';
import { pickTarget } from './abilities.js';

export class PlayerControl {
  constructor(game) {
    this.game = game;
    this.prompt = null;
    this.spectating = null;
    this.emotes = ['wave', 'point', 'dance', 'cheer'];
    this.emoteI = 0;
  }
  /** Where the player is aiming: the camera's heading, nudged onto a target in the cone. */
  aim(a, M, range = 18, cone = 0.22) {
    const yaw = this.game.camRig.yaw;
    const t = M ? pickTarget(a, M, yaw, range, cone) : null;
    return { yaw: t ? Math.atan2(t.x - a.x, t.z - a.z) : yaw, target: t, live: () => this.game.camRig.yaw };
  }
  update(dt, ctx) {
    const g = this.game, a = ctx.actor, M = ctx.match, cam = g.camRig;
    if (!input.typing && !g.ui.modal()) {
      cam.look(input.look.x, input.look.y);
      const w = input.takeWheel(); if (w) cam.zoom(w);
    }
    if (!a) return;
    const I = a.intent;
    if (!a.alive || a.left) { this.spectate(dt, M); I.mx = I.mz = 0; return; }
    const blocked = input.typing || g.ui.modal() || g.puzzle.open;
    const [fx, fz] = cam.forward(), [rx, rz] = cam.right();
    const mx = blocked ? 0 : input.move.x, my = blocked ? 0 : input.move.y;
    I.mx = fx * my + rx * mx; I.mz = fz * my + rz * mx;
    I.sprint = !blocked && (input.down('sprint') || g.touch.sprintToggle);
    if (!blocked && input.pressed('jump')) { I.jump = true; }
    // a killer faces where they aim when swinging; survivors face where they run
    I.face = null;
    if (a.role === 'killer' && (input.down('attack') || (a.busy && a.busy.kind === 'aim'))) I.face = cam.yaw;
    if (a.busy && a.busy.kind === 'aim') I.face = cam.yaw;
    if (blocked || ctx.lobby) {
      if (ctx.lobby && !blocked) this.emote(a);
      this.prompt = null;
      return;
    }
    if (!M || M.phase === 'intro' || M.phase === 'end') { this.prompt = null; return; }
    // abilities
    const ab = a.def.abilities;
    const tryCast = (i) => {
      const ok = M.useAbility(a, i, this.aim(a, M, 20, 0.3));
      if (!ok && ab[i] && a.cd[ab[i].id] > 0) audio.sfx('deny', { vol: 0.4 });
    };
    if (input.pressed('ability1')) tryCast(0);
    if (input.pressed('ability2')) tryCast(1);
    if (input.pressed('ability3')) { if (a.role === 'killer') tryCast(2); else if (a.item) M.useItem(a); }
    if (a.role === 'killer' && input.down('attack')) { a.yaw = cam.yaw + angDiff(cam.yaw, a.yaw) * 0.3; M.attack(a); }
    this.emote(a);
    // interact: the nearest thing worth pressing E on
    this.prompt = null;
    if (a.role === 'survivor') {
      let best = null, bd = 2.3;
      for (const gen of M.gens) { if (gen.done) continue; const d = a.dist(gen); if (d < bd) { bd = d; best = { kind: 'gen', gen }; } }
      for (const it of M.pickups) { if (it.taken) continue; const d = a.dist(it); if (d < Math.min(bd, 1.9)) { bd = d; best = { kind: 'item', it }; } }
      if (best && best.kind === 'gen') {
        const gen = best.gen;
        this.prompt = { text: gen.blocked > 0 ? 'Generator jammed' : 'Repair generator ' + (gen.index + 1), action: 'interact', progress: gen.frac };
        if (input.pressed('interact') && gen.blocked <= 0) { if (M.startRepair(a, gen)) g.puzzle.start(gen, M, a); }
      } else if (best) {
        const name = best.it.kind === 'medkit' ? 'Medkit' : 'Bloxy Cola';
        this.prompt = { text: a.item ? 'Hands full (' + (a.item === 'medkit' ? 'Medkit' : 'Bloxy Cola') + ')' : 'Pick up ' + name, action: 'interact' };
        if (input.pressed('interact') && !a.item) M.pickup(a, best.it);
      }
    }
  }
  emote(a) {
    if (!input.pressed('emote')) return;
    const name = this.emotes[this.emoteI++ % this.emotes.length];
    if (a.view) a.view.once(name);
  }
  /** Dead: watch the others; once a round, echo the killer's position to them. */
  spectate(dt, M) {
    const g = this.game;
    if (!M) return;
    const alive = M.actors.filter((x) => x.alive && !x.left && x.role !== 'minion');
    if (!alive.length) return;
    if (!this.spectating || !this.spectating.alive || this.spectating.left) this.spectating = alive.find((x) => x.role === 'survivor') || alive[0];
    let i = alive.indexOf(this.spectating);
    if (input.pressed('menuLeft') || input.pressed('tabPrev')) { i = (i - 1 + alive.length) % alive.length; this.spectating = alive[i]; audio.sfx('ui_move'); }
    if (input.pressed('menuRight') || input.pressed('tabNext')) { i = (i + 1) % alive.length; this.spectating = alive[i]; audio.sfx('ui_move'); }
    if (input.pressed('ability1') || input.pressed('interact')) {
      if (M.useEcho(M.player)) bus.emit('toast', 'Your echo revealed the killer');
    }
    g.camRig.target = this.spectating;
  }
}
