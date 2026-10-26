/*
 * The third-person camera: orbits the followed actor over the right shoulder, pulls in when a
 * wall is behind, kicks the FOV when sprinting, shakes on hits. Also flies the cinematic shots
 * (the round intro, the LMS reveal) and spectates.
 */
import * as THREE from 'three';
import { clamp, damp, lerp, angDiff } from '../core/util.js';
import { settings } from '../core/save.js';

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.yaw = Math.PI; this.pitch = 0.28;
    this.dist = 6.2; this.wantDist = 6.2;
    this.shoulder = 0.55;
    this.target = null;
    this.focus = new THREE.Vector3();
    this.shakeT = 0; this.shakeA = 0;
    this.fovKick = 0;
    this.shot = null;                       // a scripted shot { from, to, look, t, dur }
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
  }
  /** Mouse/stick/touch look, in "mouse pixels". */
  look(dx, dy) {
    const s = 0.0024 * (settings.sensitivity || 1);
    this.yaw -= dx * s;
    this.pitch = clamp(this.pitch + dy * s * (settings.invertY ? -1 : 1), -0.6, 1.25);
  }
  zoom(steps) { this.wantDist = clamp(this.wantDist + steps * 0.8, 2.4, 11); }
  shake(a, t = 0.25) { if (settings.shake === false) return; this.shakeA = Math.max(this.shakeA, a); this.shakeT = Math.max(this.shakeT, t); }
  /** The direction the camera looks, on the ground: what "forward" means for the player. */
  forward() { return [Math.sin(this.yaw), Math.cos(this.yaw)]; }
  right() { return [-Math.cos(this.yaw), Math.sin(this.yaw)]; }
  snapBehind(actor) { this.yaw = actor.yaw; this.pitch = 0.25; }

  /** A scripted move from a to b while looking at look (all Vector3 or functions returning one). */
  play(shot) { this.shot = Object.assign({ t: 0, dur: 3, ease: true }, shot); }
  stop() { this.shot = null; }

  update(dt, collision, opts = {}) {
    const cam = this.cam;
    this.dist = damp(this.dist, this.wantDist, 8, dt);
    const fovBase = settings.fov || 70;
    this.fovKick = damp(this.fovKick, opts.sprint ? 7 : 0, 5, dt);
    cam.fov = fovBase + this.fovKick + (opts.fovAdd || 0);
    cam.updateProjectionMatrix();

    if (this.shot) {
      const s = this.shot; s.t += dt;
      const k = s.ease ? smoothstep(s.t / s.dur) : clamp(s.t / s.dur, 0, 1);
      const a = typeof s.from === 'function' ? s.from() : s.from, b = typeof s.to === 'function' ? s.to() : s.to;
      cam.position.lerpVectors(a, b, k);
      const L = typeof s.look === 'function' ? s.look() : s.look;
      cam.lookAt(L);
      if (s.t >= s.dur && !s.hold) { const done = s.onDone; this.shot = null; done && done(); }
      this._shake(dt);
      return;
    }
    const t = this.target; if (!t) return;
    // the point we orbit: the head, a little over the right shoulder
    const head = 1.55 + (t.y || 0);
    this.focus.x = damp(this.focus.x, t.x, 22, dt); this.focus.z = damp(this.focus.z, t.z, 22, dt);
    this.focus.y = damp(this.focus.y, head, 10, dt);
    if (Math.abs(this.focus.x - t.x) > 4 || Math.abs(this.focus.z - t.z) > 4) this.focus.set(t.x, head, t.z);
    const [fx, fz] = this.forward(), [rx, rz] = this.right();
    const sh = this.shoulder * clamp(this.dist / 6, 0.4, 1);
    const pivot = this._w.set(this.focus.x + rx * sh, this.focus.y, this.focus.z + rz * sh);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = this._v.set(-fx * cp, sp, -fz * cp);
    let d = this.dist;
    if (collision) {
      const hit = collision.raycast3(pivot.x, pivot.y, pivot.z, dir.x, dir.y, dir.z, d + 0.3);
      if (hit < d + 0.3) d = Math.max(0.6, hit - 0.3);
    }
    cam.position.set(pivot.x + dir.x * d, Math.max(0.25, pivot.y + dir.y * d), pivot.z + dir.z * d);
    cam.lookAt(pivot.x + fx * 2, pivot.y - 0.1 + Math.min(0, this.pitch - 0.3) * -0.4, pivot.z + fz * 2);
    this._shake(dt);
    // hide the followed body if the camera is inside it
    if (t.view) t.view.root.visible = d > 1.0 || opts.showSelf;
  }
  _shake(dt) {
    if (this.shakeT <= 0) return;
    this.shakeT -= dt;
    const a = this.shakeA * clamp(this.shakeT / 0.25, 0, 1);
    this.cam.position.x += (Math.random() - 0.5) * a; this.cam.position.y += (Math.random() - 0.5) * a; this.cam.position.z += (Math.random() - 0.5) * a;
    if (this.shakeT <= 0) this.shakeA = 0;
  }
  /** Turn the orbit smoothly to look the way the actor faces (spectating, respawn). */
  ease(actor, dt, k = 2) { this.yaw += angDiff(this.yaw, actor.yaw) * Math.min(1, dt * k); this.pitch = lerp(this.pitch, 0.3, Math.min(1, dt * k)); }
}

const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
