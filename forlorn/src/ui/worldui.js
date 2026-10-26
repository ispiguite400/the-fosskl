/*
 * Things drawn over the 3D view at a character: name tags, chat bubbles, health on teammates,
 * and pings (callouts, revealed killers, noisy generators) that show through walls.
 */
import * as THREE from 'three';
import { el, esc } from '../core/util.js';

const _v = new THREE.Vector3();

export class WorldUI {
  constructor(game, root) {
    this.game = game; this.root = root;
    this.tags = new Map();         // actor -> { el, nm, bubbles }
    this.pings = [];
  }
  clear() { for (const [, t] of this.tags) t.el.remove(); this.tags.clear(); for (const p of this.pings) p.el.remove(); this.pings = []; }
  tag(a) {
    let t = this.tags.get(a);
    if (t) return t;
    const e = el('div', 'tag');
    const bubbles = el('div', 'bubs');
    const nm = el('div', 'nm' + (a.role === 'killer' ? ' k' : ''), esc(a.name));
    const hp = el('div', 'hp', '<i></i>');
    e.append(bubbles, nm, hp);
    this.root.appendChild(e);
    t = { el: e, nm, bubbles, hp, hpi: hp.firstChild };
    this.tags.set(a, t);
    return t;
  }
  bubble(a, text) {
    const t = this.tag(a);
    const b = el('div', 'bub', esc(text));
    t.bubbles.appendChild(b);
    while (t.bubbles.children.length > 3) t.bubbles.firstChild.remove();
    setTimeout(() => b.classList.add('fade'), 7000);
    setTimeout(() => b.remove(), 7700);
  }
  ping(o) {
    const e = el('div', 'h-ping ' + (o.kind || ''), '<i></i><span>' + esc(o.label || '') + '</span>');
    this.root.appendChild(e);
    this.pings.push(Object.assign({ el: e, t: o.t || 3, y: 1.4 }, o));
  }
  update(dt, ctx) {
    const cam = this.game.renderer.camera, W = innerWidth, H = innerHeight;
    const actors = ctx.actors || [];
    const viewer = ctx.viewer;
    const inRound = !!ctx.match;
    const seen = new Set();
    for (const a of actors) {
      if (a.left || !a.view) continue;
      seen.add(a);
      const t = this.tag(a);
      const show = this._project(a.x, a.y + (a.view.height || 1.9) + 0.35, a.z, cam, W, H);
      const d = viewer ? Math.hypot(a.x - viewer.x, a.z - viewer.z) : 0;
      // names: everyone in the lobby; in a round only teammates, and never the killer's
      const sameTeam = viewer && (viewer.role === a.role || (viewer.role === 'killer' && a.role === 'minion'));
      const showName = !inRound ? d < 30 : (sameTeam && a !== viewer && a.alive && d < 26);
      const hasBubble = t.bubbles.children.length > 0;
      const near = d < 40 && (a.alive || hasBubble);
      if (!show || !near || (!showName && !hasBubble) || (a === viewer && !hasBubble)) { t.el.style.display = 'none'; continue; }
      t.el.style.display = '';
      t.nm.style.display = showName ? '' : 'none';
      t.hp.style.display = inRound && sameTeam && a.alive && a.role === 'survivor' && a !== viewer ? '' : 'none';
      if (inRound) t.hpi.style.width = Math.round(a.hp / a.maxHp * 100) + '%';
      const s = Math.max(0.6, Math.min(1, 14 / Math.max(1, d)));
      t.el.style.transform = 'translate(' + show.x.toFixed(1) + 'px,' + show.y.toFixed(1) + 'px) translate(-50%,-100%) scale(' + s.toFixed(2) + ')';
      t.el.style.left = '0px'; t.el.style.top = '0px';
    }
    for (const [a, t] of this.tags) if (!seen.has(a)) { t.el.remove(); this.tags.delete(a); }
    // pings
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.t -= dt;
      if (p.follow) { p.x = p.follow.x; p.z = p.follow.z; }
      if (p.t <= 0) { p.el.remove(); this.pings.splice(i, 1); continue; }
      const s = this._project(p.x, p.y, p.z, cam, W, H, true);
      if (!s) { p.el.style.display = 'none'; continue; }
      p.el.style.display = '';
      p.el.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px)';
      p.el.style.left = '0px'; p.el.style.top = '0px';
      p.el.style.opacity = Math.min(1, p.t * 2);
    }
  }
  /** World to screen; null when behind the camera (clamp = keep pings on the edges). */
  _project(x, y, z, cam, W, H, clamp) {
    _v.set(x, y, z).project(cam);
    if (_v.z > 1) { if (!clamp) return null; _v.x = -_v.x; _v.y = -1; }
    let sx = (_v.x * 0.5 + 0.5) * W, sy = (-_v.y * 0.5 + 0.5) * H;
    if (clamp) { sx = Math.max(24, Math.min(W - 24, sx)); sy = Math.max(24, Math.min(H - 24, sy)); }
    else if (sx < -100 || sx > W + 100 || sy < -100 || sy > H + 100) return null;
    return { x: sx, y: sy };
  }
}
