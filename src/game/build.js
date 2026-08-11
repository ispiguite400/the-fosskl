/* Building.
 *
 * Four pieces — wall, floor, ramp, roof — snapped to a fixed grid, placed
 * instantly from a ghost preview, and standing on two hits of health. That
 * last number is the whole balance of the thing: a build buys you one
 * exchange, not a fortress. An enemy that cannot reach you swings at what is
 * in the way and is through it in two.
 *
 * Pieces are their own meshes with their own colliders filed into the props
 * grid, so everything that already asks "is something in the way" — the
 * player's own movement, enemy pathing, spawn placement — sees them without
 * knowing what they are.
 *
 * The grid is 4 m, which is a little under three times the player's width:
 * wide enough to run through a doorway, tight enough that a ramp climbs at a
 * sensible angle. */

import * as THREE from 'three';
import { mat, prim } from '../entities/models.js';
import { Audio } from '../core/audio.js';

export const GRID = 4;
export const PIECES = ['wall', 'floor', 'ramp', 'roof'];
const PIECE_LABEL = { wall: 'WALL', floor: 'FLOOR', ramp: 'RAMP', roof: 'ROOF' };

/** Health, in hits. Two is the number the whole system is balanced on. */
const HITS = 2;
/** What one piece costs. */
const COST = 1;
/** Standing pieces before the oldest is retired, so a session cannot leak. */
const MAX_PIECES = 220;

const TH = .35;                   // panel thickness

function pieceGeometry(kind) {
  switch (kind) {
    case 'floor': return prim.box(GRID, TH, GRID);
    case 'roof':  return prim.cone(GRID * .72, GRID * .5, 4);
    case 'ramp':  return prim.box(GRID, TH, GRID * 1.42);
    default:      return prim.box(GRID, GRID, TH);
  }
}

export class BuildSystem {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'builds';
    game.scene.add(this.group);

    this.pieces = [];             // { mesh, collider, hp, key }
    this.byKey = new Map();       // grid key -> piece, so nothing double-stacks
    this.active = false;          // build mode on?
    this.kind = 'wall';
    this.rot = 0;                 // quarter turns, for walls and ramps

    this.matSolid = mat(0x9a7d52, { roughness: .9 });
    this.matGhostOK = new THREE.MeshBasicMaterial({
      color: 0x6fd8a0, transparent: true, opacity: .34, depthWrite: false });
    this.matGhostNo = new THREE.MeshBasicMaterial({
      color: 0xd85c5c, transparent: true, opacity: .30, depthWrite: false });

    this.ghost = new THREE.Mesh(pieceGeometry('wall'), this.matGhostOK);
    this.ghost.visible = false;
    this.ghost.renderOrder = 20;
    this.group.add(this.ghost);
    this._ghostKind = 'wall';
  }

  get timber() { return this.game.save.timber ?? 0; }
  set timber(v) { this.game.save.timber = Math.max(0, Math.min(999, Math.round(v))); }

  /* ==========================================================
     Where a piece would go
     ========================================================== */
  _snap(kind, from, look) {
    // Two grid cells ahead of where the player is looking, flattened.
    const reach = kind === 'floor' ? GRID * .9 : GRID * 1.15;
    const p = from.clone().addScaledVector(
      look.clone().setY(0).normalize(), reach);

    const gx = Math.round(p.x / GRID), gz = Math.round(p.z / GRID);
    const x = gx * GRID, z = gz * GRID;
    // Vertical: builds stack on the player's own storey.
    const base = this.game.terrain.heightAt(x, z);
    const storey = Math.max(0, Math.round((from.y - base) / GRID));
    const y = base + storey * GRID;

    const key = `${gx},${storey},${gz},${kind}`;
    return { x, y, z, gx, gz, storey, key };
  }

  _poseGhost(spot) {
    const g = this.ghost;
    if (this._ghostKind !== this.kind) {
      g.geometry = pieceGeometry(this.kind);
      this._ghostKind = this.kind;
    }
    this._pose(g, this.kind, spot, this.rot);
  }

  /** Put a mesh where its kind belongs within the grid cell. */
  _pose(m, kind, spot, rot) {
    const a = rot * Math.PI / 2;
    m.rotation.set(0, 0, 0);
    if (kind === 'floor') {
      m.position.set(spot.x, spot.y + TH / 2, spot.z);
    } else if (kind === 'roof') {
      m.position.set(spot.x, spot.y + GRID * .25, spot.z);
      m.rotation.y = Math.PI / 4;
    } else if (kind === 'ramp') {
      m.position.set(spot.x, spot.y + GRID * .5, spot.z);
      m.rotation.y = a;
      m.rotation.x = -Math.PI / 5.4;          // climbs one storey per cell
    } else {
      // Wall: stands on the edge of the cell it faces.
      const off = GRID / 2;
      m.position.set(spot.x - Math.sin(a) * off, spot.y + GRID / 2, spot.z - Math.cos(a) * off);
      m.rotation.y = a;
    }
  }

  /* ==========================================================
     Per frame
     ========================================================== */
  update(dt, player, input) {
    if (!input) return;

    // Toggle build mode.
    if (input.justPressed('buildMode')) {
      this.active = !this.active;
      this.game.hud.toast(this.active
        ? `BUILD — ${PIECE_LABEL[this.kind]} · ${this.timber} TIMBER`
        : 'BUILD OFF');
      Audio.sfx('uiMove', { volume: .5 });
    }
    // Direct piece keys work whether or not you are already in build mode.
    for (const [action, kind] of [['buildWall', 'wall'], ['buildFloor', 'floor'],
                                  ['buildRamp', 'ramp'], ['buildRoof', 'roof']]) {
      if (input.justPressed(action)) { this.kind = kind; this.active = true; }
    }
    if (this.active && input.justPressed('nextPiece')) {
      this.kind = PIECES[(PIECES.indexOf(this.kind) + 1) % PIECES.length];
      Audio.sfx('uiMove', { volume: .5 });
    }
    if (this.active && input.justPressed('rotPiece')) {
      this.rot = (this.rot + 1) % 4;
      Audio.sfx('uiMove', { volume: .4 });
    }

    this.game.hud.setBuild?.(this.active, PIECE_LABEL[this.kind], this.timber);
    if (!this.active || player.dead) { this.ghost.visible = false; return; }

    const look = new THREE.Vector3();
    player.camera.getWorldDirection(look);
    const spot = this._snap(this.kind, player.camera.position, look);
    this._poseGhost(spot);

    const blocked = this.byKey.has(spot.key) || this._wouldTrap(this.kind, spot, this.rot);
    const affordable = this.timber >= COST;
    this.ghost.material = (blocked || !affordable) ? this.matGhostNo : this.matGhostOK;
    this.ghost.visible = true;

    if (input.justPressed('place') && !blocked && affordable) this.place(spot);
  }

  /* ==========================================================
     Placing and losing pieces
     ========================================================== */
  place(spot) {
    const m = new THREE.Mesh(pieceGeometry(this.kind), this.matSolid);
    this._pose(m, this.kind, spot, this.rot);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);

    // Only things that stand up get in the way; you can walk over a floor.
    const collider = (this.kind === 'wall')
      ? this.game.props.addDynamicCollider(m.position.x, m.position.z, GRID * .42)
      : null;

    const piece = { mesh: m, collider, hp: HITS, key: spot.key, kind: this.kind };
    this.pieces.push(piece);
    this.byKey.set(spot.key, piece);
    this.timber -= COST;

    Audio.sfx('block', { volume: .35 });
    this.game.hud.toast(`${PIECE_LABEL[this.kind]} · ${this.timber} TIMBER`);

    // A session cannot leak pieces forever.
    if (this.pieces.length > MAX_PIECES) this._retire(this.pieces[0]);
  }

  /** Would this piece close on somebody? Fortnite will not let you box
   *  yourself inside a wall and neither will this. */
  _wouldTrap(kind, spot, rot) {
    if (kind === 'floor' || kind === 'roof') return false;
    this._probe ??= new THREE.Object3D();
    this._pose(this._probe, kind, spot, rot);
    /* Exactly, in the piece's own space. A wall is four metres across and a
     * third of a metre thick, so distance to its centre answers the wrong
     * question — it is far too generous along the panel and far too mean
     * across it. Rotate the player into the wall's frame and test the box. */
    const a = rot * Math.PI / 2;
    const cos = Math.cos(-a), sin = Math.sin(-a);
    const HW = GRID / 2 + .45;                 // half width, plus body radius
    const HT = TH / 2 + .55;                   // half thickness, plus body
    for (const p of [this.game.player, this.game.player2]) {
      if (!p || p.dead) continue;
      const dx = p.pos.x - this._probe.position.x;
      const dz = p.pos.z - this._probe.position.z;
      const lx = dx * cos - dz * sin;          // along the panel
      const lz = dx * sin + dz * cos;          // through it
      const dy = (p.pos.y + .9) - this._probe.position.y;
      if (Math.abs(lx) < HW && Math.abs(lz) < HT && Math.abs(dy) < GRID * .6) return true;
    }
    return false;
  }

  /** Is a build standing between these two points? Sampled along the line,
   *  because a single probe point walks straight past a wall the moment the
   *  thing looking has stepped a metre to one side. */
  pieceBetween(from, to, maxAhead = 3.2) {
    if (!this.pieces.length) return null;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const reach = Math.min(len, maxAhead);
    const probe = new THREE.Vector3();
    for (let t = .3; t <= 1.001; t += .175) {
      probe.set(from.x + dx / len * reach * t,
                from.y + dy / len * reach * t,
                from.z + dz / len * reach * t);
      const p = this.pieceNear(probe, 2.5);
      if (p) return p;
    }
    return null;
  }

  /** Nearest piece within `r` of a point, or null. */
  pieceNear(pos, r = 2.6) {
    let best = null, bd = r * r;
    for (const p of this.pieces) {
      const d = p.mesh.position.distanceToSquared(pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** A hit on a build. Two of these and it is gone. */
  damage(piece, from) {
    if (!piece || piece.gone) return false;
    piece.hp -= 1;
    Audio.sfxAt('block', piece.mesh.position, this.game.listenerPos, 50, { volume: .6 });
    this.game.vfx.hitSpark(piece.mesh.position.clone(), new THREE.Vector3(0, 1, 0), false);
    if (piece.hp <= 0) {
      this.game.vfx.explosion(piece.mesh.position.clone(), 5, [.62, .5, .32]);
      this._retire(piece);
      return true;                       // broke
    }
    // Damaged pieces go visibly darker, so you can read what is about to go.
    piece.mesh.material = this._hurtMat ??= mat(0x6a533a, { roughness: .95 });
    return false;
  }

  _retire(piece) {
    piece.gone = true;
    this.group.remove(piece.mesh);
    if (piece.collider) this.game.props.removeDynamicCollider(piece.collider);
    this.byKey.delete(piece.key);
    const i = this.pieces.indexOf(piece);
    if (i >= 0) this.pieces.splice(i, 1);
  }

  /** Timber from kills and chests. */
  grant(n) {
    const before = this.timber;
    this.timber += n;
    return this.timber - before;
  }

  dispose() {
    for (const p of [...this.pieces]) this._retire(p);
    this.group.parent?.remove(this.group);
    this.pieces.length = 0;
    this.byKey.clear();
  }
}
