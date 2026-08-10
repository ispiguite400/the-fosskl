/* Procedural model library.
 *
 * Everything visible in the world is generated from primitives at runtime:
 * armoured humanoids with a real joint hierarchy, weapons that recolour to
 * the player's forge choice, animals, trees and architecture. Meshes share
 * cached geometry and materials wherever possible so a world with a few
 * thousand props still batches sanely. */

import * as THREE from 'three';
import { makeRNG, clamp, lerp, hsl2int } from '../core/util.js';

/* ---------------- shared caches ---------------- */
const geoCache = new Map();
const matCache = new Map();

const G = (key, make) => {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
};
const M = (key, make) => {
  let m = matCache.get(key);
  if (!m) { m = make(); matCache.set(key, m); }
  return m;
};

export const mat = (color, opts = {}) =>
  M(`std:${color}:${JSON.stringify(opts)}`, () => new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? .8, metalness: opts.metalness ?? .05, ...opts
  }));

const box = (w, h, d) => G(`box:${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, s = 10) => G(`cyl:${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const sph = (r, w = 12, h = 8) => G(`sph:${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
const cone = (r, h, s = 8) => G(`cone:${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/* ============================================================
   HUMANOID
   Returns a group with a named rig so animation code can pose it.
   ============================================================ */
export function buildHumanoid(opts = {}) {
  const {
    scale = 1,
    skin = 0xc79a72,
    cloth = 0x3a3f4a,
    armor = 0x4a4a52,
    accent = 0x8c2f2f,
    helmet = true,
    cloak = false,
    cloakColor = 0x7c3fbf,
    heavy = false,
    ghostly = false,
    child = false,
    glow = 0
  } = opts;

  const root = new THREE.Group();
  const rig = {};

  const skinM  = mat(skin, { roughness: .78 });
  const clothM = mat(cloth, { roughness: .92 });
  const armorM = mat(armor, { roughness: .42, metalness: .68 });
  const accM   = mat(accent, { roughness: .6 });

  if (ghostly) {
    for (const m of [skinM, clothM, armorM]) { /* shared cache — clone instead */ }
  }

  const bodyScale = child ? .58 : 1;
  const H = 1.8 * bodyScale;

  /* --- hips (root of the rig) --- */
  const hips = new THREE.Group();
  hips.position.y = H * .52;
  root.add(hips); rig.hips = hips;

  /* --- torso --- */
  const torso = new THREE.Group();
  hips.add(torso); rig.torso = torso;

  const chest = mesh(box(.42 * bodyScale, .5 * bodyScale, .24 * bodyScale), clothM, 0, .25 * bodyScale, 0);
  torso.add(chest);

  if (!child) {
    // Do-style cuirass: overlapping horizontal lames.
    for (let i = 0; i < 4; i++) {
      const w = (.46 - i * .012) * bodyScale;
      const p = mesh(box(w, .1 * bodyScale, .27 * bodyScale), armorM, 0, (.05 + i * .11) * bodyScale, 0);
      p.scale.z = 1 - i * .02;
      torso.add(p);
    }
    if (heavy) {
      // Pauldrons.
      for (const s of [-1, 1]) {
        const pl = mesh(box(.2 * bodyScale, .12 * bodyScale, .3 * bodyScale), armorM, s * .3 * bodyScale, .44 * bodyScale, 0);
        pl.rotation.z = -s * .28;
        torso.add(pl);
      }
    }
    // Sash.
    const sash = mesh(box(.48 * bodyScale, .07 * bodyScale, .28 * bodyScale), accM, 0, .04 * bodyScale, 0);
    torso.add(sash);
  }

  /* --- head --- */
  const neck = new THREE.Group();
  neck.position.y = .52 * bodyScale;
  torso.add(neck); rig.head = neck;

  const head = mesh(box(.2 * bodyScale, .24 * bodyScale, .2 * bodyScale), skinM, 0, .12 * bodyScale, 0);
  neck.add(head);

  if (helmet && !child) {
    const kabuto = mesh(sph(.15 * bodyScale, 12, 8), armorM, 0, .18 * bodyScale, 0);
    kabuto.scale.set(1, .82, 1.05);
    neck.add(kabuto);
    // Shikoro — the flared neck guard.
    for (let i = 0; i < 3; i++) {
      const g = mesh(cyl(.17 * bodyScale + i * .02, .2 * bodyScale + i * .022, .04 * bodyScale, 10),
        armorM, 0, (.12 - i * .04) * bodyScale, .02 * bodyScale);
      g.rotation.x = .16;
      neck.add(g);
    }
    // Maedate crest.
    const crest = mesh(box(.02 * bodyScale, .16 * bodyScale, .07 * bodyScale), accM, 0, .3 * bodyScale, .06 * bodyScale);
    crest.rotation.x = -.3;
    neck.add(crest);
    // Menpo, the half mask.
    const mask = mesh(box(.17 * bodyScale, .09 * bodyScale, .04 * bodyScale), mat(0x22201e, { metalness: .5, roughness: .5 }),
      0, .06 * bodyScale, .1 * bodyScale);
    neck.add(mask);
  }
  if (child) {
    // Simple hair cap so she reads as a person, not a mannequin.
    const hair = mesh(sph(.12, 10, 8), mat(0x2a1d16, { roughness: 1 }), 0, .16 * bodyScale, 0);
    hair.scale.set(1.05, .9, 1.05);
    neck.add(hair);
    const tail = mesh(box(.07, .22, .07), mat(0x2a1d16, { roughness: 1 }), 0, .06 * bodyScale, -.13 * bodyScale);
    neck.add(tail);
  }

  /* --- arms --- */
  const arm = side => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * .26 * bodyScale, .44 * bodyScale, 0);
    torso.add(shoulder);

    const upper = mesh(box(.11 * bodyScale, .3 * bodyScale, .11 * bodyScale), clothM, 0, -.15 * bodyScale, 0);
    shoulder.add(upper);
    if (!child) {
      const sode = mesh(box(.17 * bodyScale, .16 * bodyScale, .17 * bodyScale), armorM, 0, -.06 * bodyScale, 0);
      shoulder.add(sode);
    }

    const elbow = new THREE.Group();
    elbow.position.y = -.32 * bodyScale;
    shoulder.add(elbow);
    const fore = mesh(box(.1 * bodyScale, .28 * bodyScale, .1 * bodyScale), skinM, 0, -.14 * bodyScale, 0);
    elbow.add(fore);
    if (!child) {
      const bracer = mesh(box(.12 * bodyScale, .16 * bodyScale, .12 * bodyScale), armorM, 0, -.14 * bodyScale, 0);
      elbow.add(bracer);
    }

    const hand = new THREE.Group();
    hand.position.y = -.3 * bodyScale;
    elbow.add(hand);
    hand.add(mesh(box(.09 * bodyScale, .1 * bodyScale, .09 * bodyScale), skinM));

    return { shoulder, elbow, hand };
  };
  rig.armL = arm(-1); rig.armR = arm(1);

  /* --- legs --- */
  const leg = side => {
    const hip = new THREE.Group();
    hip.position.set(side * .12 * bodyScale, -.02 * bodyScale, 0);
    hips.add(hip);
    const thigh = mesh(box(.14 * bodyScale, .36 * bodyScale, .14 * bodyScale), clothM, 0, -.18 * bodyScale, 0);
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -.38 * bodyScale;
    hip.add(knee);
    const shin = mesh(box(.12 * bodyScale, .34 * bodyScale, .12 * bodyScale), clothM, 0, -.17 * bodyScale, 0);
    knee.add(shin);
    if (!child) {
      const greave = mesh(box(.14 * bodyScale, .22 * bodyScale, .14 * bodyScale), armorM, 0, -.16 * bodyScale, .01);
      knee.add(greave);
    }

    const foot = new THREE.Group();
    foot.position.y = -.36 * bodyScale;
    knee.add(foot);
    foot.add(mesh(box(.13 * bodyScale, .07 * bodyScale, .24 * bodyScale), mat(0x2b241d), 0, -.03 * bodyScale, .04 * bodyScale));
    return { hip, knee, foot };
  };
  rig.legL = leg(-1); rig.legR = leg(1);

  /* --- cloak (wizard, shadow) --- */
  if (cloak) {
    const cm = new THREE.MeshStandardMaterial({
      color: cloakColor, roughness: .95, side: THREE.DoubleSide,
      transparent: ghostly, opacity: ghostly ? .74 : 1
    });
    const body = new THREE.Mesh(new THREE.ConeGeometry(.5 * bodyScale, 1.5 * bodyScale, 12, 3, true), cm);
    body.position.y = .12 * bodyScale;
    body.castShadow = true;
    torso.add(body);
    rig.cloak = body;

    const hood = new THREE.Mesh(new THREE.ConeGeometry(.24 * bodyScale, .38 * bodyScale, 10, 1, true), cm);
    hood.position.y = .18 * bodyScale;
    neck.add(hood);
    // Nothing but shadow under the hood.
    const voidFace = mesh(sph(.11 * bodyScale, 8, 6), mat(0x05030a, { roughness: 1 }), 0, .1 * bodyScale, .02);
    neck.add(voidFace);
  }

  if (glow > 0) {
    const l = new THREE.PointLight(opts.glowColor ?? 0x9b5cff, glow, 12, 2);
    l.position.y = .6;
    root.add(l);
    rig.light = l;
  }

  if (ghostly) {
    root.traverse(o => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = .68;
        o.castShadow = false;
      }
    });
  }

  root.scale.setScalar(scale);
  root.userData.rig = rig;
  root.userData.height = H * scale;
  return { root, rig, height: H * scale };
}

/* ============================================================
   WEAPONS — recolour from the player's forge choice
   ============================================================ */
export function weaponMaterials(colors) {
  const bladeHex = colors ? hsl2int(colors.blade.h, colors.blade.s, colors.blade.l) : 0xcfd6dd;
  const gripHex  = colors ? hsl2int(colors.handle.h, colors.handle.s, colors.handle.l) : 0x4a2a18;
  return {
    blade: new THREE.MeshStandardMaterial({ color: bladeHex, metalness: .92, roughness: .16 }),
    bladeDark: new THREE.MeshStandardMaterial({
      color: colors ? hsl2int(colors.blade.h, colors.blade.s, colors.blade.l * .5) : 0x6a727a,
      metalness: .85, roughness: .35
    }),
    grip: new THREE.MeshStandardMaterial({ color: gripHex, roughness: .86 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x14120f, roughness: .6, metalness: .3 })
  };
}

/** Builds a weapon mesh. `colors` is Save.data.colors. */
export function buildWeapon(id, colors) {
  const m = weaponMaterials(colors);
  const g = new THREE.Group();
  g.userData.weaponId = id;

  const grip = (len = .26, r = .022) => {
    const h = new THREE.Mesh(cyl(r, r * 1.05, len, 8), m.grip);
    h.castShadow = true;
    return h;
  };

  switch (id) {
    case 'kontana':
    case 'katana': {
      // Slight curve built from stacked segments.
      const blade = new THREE.Group();
      const SEG = 12, L = .92;
      for (let i = 0; i < SEG; i++) {
        const t = i / SEG;
        const s = new THREE.Mesh(box(.028, L / SEG + .004, .009 - t * .002), i === SEG - 1 ? m.blade : m.blade);
        s.position.set(0, L * t + L / SEG / 2, Math.pow(t, 1.7) * .07);
        s.rotation.x = -t * .12;
        s.castShadow = true;
        blade.add(s);
      }
      // Kissaki, the point.
      const tip = new THREE.Mesh(cone(.018, .07, 4), m.blade);
      tip.position.set(0, L + .03, .075); tip.rotation.x = -.2;
      blade.add(tip);
      blade.position.y = .1;
      g.add(blade);

      const tsuba = new THREE.Mesh(cyl(.055, .055, .012, 12), m.dark);
      tsuba.position.y = .09; tsuba.rotation.x = Math.PI / 2; tsuba.scale.z = .5;
      g.add(tsuba);

      const tsuka = grip(.26); tsuka.position.y = -.05; g.add(tsuka);
      // Ito wrap.
      for (let i = 0; i < 7; i++) {
        const w = new THREE.Mesh(box(.05, .012, .05), m.dark);
        w.position.y = -.16 + i * .035; w.rotation.y = .4;
        g.add(w);
      }
      if (id === 'kontana') {
        const l = new THREE.PointLight(0xffd48a, .8, 3, 2);
        l.position.y = .5; g.add(l);
      }
      break;
    }
    case 'odachi': {
      const blade = new THREE.Mesh(box(.036, 1.42, .012), m.blade);
      blade.position.y = .82; blade.castShadow = true; g.add(blade);
      const tip = new THREE.Mesh(cone(.024, .1, 4), m.blade); tip.position.y = 1.58; g.add(tip);
      const tsuba = new THREE.Mesh(cyl(.07, .07, .014, 12), m.dark);
      tsuba.position.y = .1; tsuba.rotation.x = Math.PI / 2; tsuba.scale.z = .5; g.add(tsuba);
      const h = grip(.38); h.position.y = -.1; g.add(h);
      break;
    }
    case 'voidblade': {
      const blade = new THREE.Mesh(box(.04, 1.1, .014), new THREE.MeshStandardMaterial({
        color: 0x080510, metalness: 1, roughness: .05,
        emissive: 0x4a1f7a, emissiveIntensity: .8
      }));
      blade.position.y = .66; g.add(blade);
      const tip = new THREE.Mesh(cone(.026, .1, 4), blade.material); tip.position.y = 1.26; g.add(tip);
      const h = grip(.3); h.position.y = -.02; g.add(h);
      const l = new THREE.PointLight(0x8a3fd8, 2.2, 7, 2); l.position.y = .7; g.add(l);
      break;
    }
    case 'sword': {
      const blade = new THREE.Mesh(box(.05, .86, .014), m.blade);
      blade.position.y = .55; g.add(blade);
      const tip = new THREE.Mesh(cone(.03, .1, 4), m.blade); tip.position.y = 1.02; g.add(tip);
      const cross = new THREE.Mesh(box(.28, .026, .03), m.bladeDark); cross.position.y = .11; g.add(cross);
      const h = grip(.2); h.position.y = 0; g.add(h);
      const pommel = new THREE.Mesh(sph(.035, 10, 8), m.bladeDark); pommel.position.y = -.11; g.add(pommel);
      break;
    }
    case 'fire_sword': {
      const fm = new THREE.MeshStandardMaterial({
        color: 0x3a1408, metalness: .8, roughness: .3,
        emissive: 0xff5a10, emissiveIntensity: 1.4
      });
      const blade = new THREE.Mesh(box(.055, .9, .016), fm);
      blade.position.y = .58; g.add(blade);
      const tip = new THREE.Mesh(cone(.032, .12, 4), fm); tip.position.y = 1.08; g.add(tip);
      const cross = new THREE.Mesh(box(.3, .03, .034), m.bladeDark); cross.position.y = .11; g.add(cross);
      const h = grip(.22); g.add(h);
      const l = new THREE.PointLight(0xff6a20, 3.2, 9, 2); l.position.y = .6; g.add(l);
      g.userData.fireLight = l;
      break;
    }
    case 'axe': {
      const haft = new THREE.Mesh(cyl(.026, .03, .82, 8), m.grip);
      haft.position.y = .3; g.add(haft);
      const head = new THREE.Mesh(box(.05, .2, .04), m.bladeDark);
      head.position.set(0, .68, .04); g.add(head);
      // Crescent bit.
      const bit = new THREE.Mesh(new THREE.CylinderGeometry(.17, .17, .035, 16, 1, false, 0, Math.PI * .8), m.blade);
      bit.position.set(0, .68, .16); bit.rotation.set(Math.PI / 2, 0, Math.PI * .1);
      bit.castShadow = true; g.add(bit);
      break;
    }
    case 'tetsubo': {
      const haft = new THREE.Mesh(cyl(.04, .05, 1.1, 8), m.grip);
      haft.position.y = .42; g.add(haft);
      const club = new THREE.Mesh(cyl(.09, .075, .5, 8), m.bladeDark);
      club.position.y = .92; g.add(club);
      // Studs.
      const rng = makeRNG(3);
      for (let i = 0; i < 26; i++) {
        const a = rng() * Math.PI * 2, y = .72 + rng() * .42;
        const s = new THREE.Mesh(sph(.016, 6, 4), m.blade);
        s.position.set(Math.cos(a) * .085, y, Math.sin(a) * .085);
        g.add(s);
      }
      break;
    }
    case 'spear': {
      const haft = new THREE.Mesh(cyl(.022, .024, 1.9, 8), m.grip);
      haft.position.y = .8; g.add(haft);
      const head = new THREE.Mesh(cone(.036, .3, 4), m.blade);
      head.position.y = 1.86; g.add(head);
      const collar = new THREE.Mesh(cyl(.032, .032, .06, 8), m.dark);
      collar.position.y = 1.7; g.add(collar);
      break;
    }
    case 'bow':
    case 'stormbow': {
      const limb = new THREE.Group();
      const SEG = 10, R = .62;
      for (let i = 0; i < SEG; i++) {
        const t = i / (SEG - 1);
        const a = lerp(-1.15, 1.15, t);
        const s = new THREE.Mesh(box(.022, .14, .03), m.grip);
        s.position.set(Math.sin(a) * .18, Math.cos(a) * R - R * .1, 0);
        s.rotation.z = -a;
        limb.add(s);
      }
      g.add(limb);
      const string = new THREE.Mesh(cyl(.004, .004, 1.16, 4), mat(0xe8e2d4));
      string.position.set(.16, -.06, 0); g.add(string);
      if (id === 'stormbow') {
        const l = new THREE.PointLight(0x6ad4ff, 2, 6, 2); g.add(l);
        limb.children.forEach(c => c.material = new THREE.MeshStandardMaterial({
          color: 0x1a2a44, emissive: 0x2a6aff, emissiveIntensity: .7, metalness: .6, roughness: .3
        }));
      }
      break;
    }
    case 'crossbow': {
      const stock = new THREE.Mesh(box(.055, .07, .62), m.grip);
      stock.position.z = -.06; g.add(stock);
      const bow = new THREE.Mesh(box(.72, .03, .03), m.bladeDark);
      bow.position.z = .22; g.add(bow);
      const string = new THREE.Mesh(box(.7, .006, .006), mat(0xe8e2d4));
      string.position.z = .06; g.add(string);
      const bolt = new THREE.Mesh(cyl(.008, .008, .42, 6), m.blade);
      bolt.rotation.x = Math.PI / 2; bolt.position.set(0, .05, .14); g.add(bolt);
      break;
    }
    case 'knives':
    case 'shuriken': {
      if (id === 'shuriken') {
        for (let i = 0; i < 4; i++) {
          const p = new THREE.Mesh(box(.02, .14, .006), m.blade);
          p.rotation.z = i * Math.PI / 4; g.add(p);
        }
      } else {
        const blade = new THREE.Mesh(box(.03, .24, .008), m.blade);
        blade.position.y = .16; g.add(blade);
        const tip = new THREE.Mesh(cone(.02, .07, 4), m.blade); tip.position.y = .31; g.add(tip);
        const h = grip(.12, .016); h.position.y = 0; g.add(h);
      }
      break;
    }
    case 'wood_shield':
    case 'iron_shield':
    case 'tower_shield':
    case 'oni_shield': {
      const tall = id === 'tower_shield' ? 1.15 : id === 'oni_shield' ? .95 : .8;
      const wide = id === 'tower_shield' ? .58 : .62;
      const body = new THREE.Mesh(box(wide, tall, .06),
        id === 'wood_shield' ? m.grip : m.blade);
      body.castShadow = true; g.add(body);
      const rim = new THREE.Mesh(box(wide + .04, tall + .04, .03), m.bladeDark);
      rim.position.z = -.02; g.add(rim);
      const boss = new THREE.Mesh(sph(.09, 12, 8), m.blade);
      boss.position.z = .06; boss.scale.z = .55; g.add(boss);
      if (id === 'oni_shield') {
        const face = new THREE.Mesh(box(.3, .22, .04), mat(0x8c1f1f, { roughness: .5 }));
        face.position.set(0, .12, .07); g.add(face);
        for (const s of [-1, 1]) {
          const horn = new THREE.Mesh(cone(.035, .18, 6), mat(0xe8dcc0));
          horn.position.set(s * .12, .3, .07); horn.rotation.z = s * .35; g.add(horn);
        }
        const l = new THREE.PointLight(0xff3a2a, 1.4, 5, 2); l.position.z = .3; g.add(l);
      }
      break;
    }
    case 'smoke_bomb':
    case 'fire_bomb':
    case 'thunder_bomb':
    case 'teleport_bomb': {
      const tint = { smoke_bomb: 0x4a4a52, fire_bomb: 0x8c3a14, thunder_bomb: 0x2a4a8c, teleport_bomb: 0x5a2a8c }[id];
      const body = new THREE.Mesh(sph(.09, 12, 10), mat(tint, { roughness: .55, metalness: .4 }));
      g.add(body);
      const neck = new THREE.Mesh(cyl(.03, .035, .05, 8), m.grip);
      neck.position.y = .1; g.add(neck);
      const fuse = new THREE.Mesh(cyl(.007, .007, .1, 5), mat(0xb8964e));
      fuse.position.set(.02, .17, 0); fuse.rotation.z = -.3; g.add(fuse);
      if (id !== 'smoke_bomb') {
        const l = new THREE.PointLight(
          { fire_bomb: 0xff6a20, thunder_bomb: 0x6ab4ff, teleport_bomb: 0xb45cff }[id], 1.2, 4, 2);
        l.position.y = .22; g.add(l);
      }
      break;
    }
    case 'potion_hp': case 'potion_stam': case 'potion_pow': case 'potion_op': {
      const tint = { potion_hp: 0xd8342e, potion_stam: 0xe8dcc0, potion_pow: 0xf08a1e, potion_op: 0xb44df0 }[id];
      const glass = new THREE.Mesh(sph(.08, 12, 10), new THREE.MeshStandardMaterial({
        color: tint, roughness: .1, metalness: .1, transparent: true, opacity: .78,
        emissive: tint, emissiveIntensity: .35
      }));
      glass.scale.y = 1.2; g.add(glass);
      const cork = new THREE.Mesh(cyl(.026, .03, .06, 8), m.grip);
      cork.position.y = .11; g.add(cork);
      break;
    }
    case 'key': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.05, .012, 6, 14), mat(0xd8a840, { metalness: .9, roughness: .3 }));
      ring.position.y = .12; g.add(ring);
      const shaft = new THREE.Mesh(cyl(.012, .012, .22, 6), ring.material);
      g.add(shaft);
      const tooth = new THREE.Mesh(box(.05, .022, .014), ring.material);
      tooth.position.set(.026, -.07, 0); g.add(tooth);
      break;
    }
    case 'food': {
      const bale = new THREE.Mesh(cyl(.1, .1, .16, 10), mat(0xd8c088, { roughness: 1 }));
      bale.rotation.z = Math.PI / 2; g.add(bale);
      for (let i = 0; i < 3; i++) {
        const rope = new THREE.Mesh(new THREE.TorusGeometry(.101, .008, 5, 12), mat(0x6a5230));
        rope.position.x = -.05 + i * .05; rope.rotation.y = Math.PI / 2; g.add(rope);
      }
      break;
    }
    default: {
      // Bare hands: nothing to render.
      return g;
    }
  }

  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return g;
}

/* ============================================================
   ANIMALS
   ============================================================ */
export function buildAnimal(def, rng = makeRNG(1)) {
  const root = new THREE.Group();
  const rig = {};
  const body = mat(def.color, { roughness: .92 });
  const dark = mat(new THREE.Color(def.color).multiplyScalar(.6).getHex(), { roughness: .95 });

  const s = def.scale ?? 1;
  const L = 1.5 * s, HGT = 1.35 * s;

  const trunk = new THREE.Group();
  trunk.position.y = HGT;
  root.add(trunk); rig.trunk = trunk;

  const barrel = mesh(box(.62 * s, .66 * s, L), body);
  if (def.hump) {
    const hump = mesh(sph(.32 * s, 10, 8), body, 0, .34 * s, -.1 * s);
    hump.scale.set(1, .8, 1.4); trunk.add(hump);
  }
  trunk.add(barrel);

  /* neck + head */
  const neck = new THREE.Group();
  neck.position.set(0, .2 * s, L * .48);
  trunk.add(neck); rig.neck = neck;
  const neckM = mesh(box(.26 * s, .62 * s, .3 * s), body, 0, .24 * s, .1 * s);
  neckM.rotation.x = -.42; neck.add(neckM);

  const head = new THREE.Group();
  head.position.set(0, .5 * s, .34 * s);
  neck.add(head); rig.head = head;
  head.add(mesh(box(.22 * s, .24 * s, .46 * s), body, 0, 0, .12 * s));
  head.add(mesh(box(.16 * s, .14 * s, .2 * s), dark, 0, -.04 * s, .38 * s));   // muzzle
  for (const sd of [-1, 1]) {
    const ear = mesh(cone(.05 * s, .16 * s, 5), body, sd * .09 * s, .16 * s, -.02 * s);
    ear.rotation.z = sd * .2; head.add(ear);
    const eye = mesh(sph(.032 * s, 8, 6), mat(0x120d0a), sd * .1 * s, .04 * s, .22 * s);
    head.add(eye);
  }
  if (def.antlers) {
    for (const sd of [-1, 1]) {
      const beam = mesh(cyl(.022 * s, .03 * s, .7 * s, 6), mat(0xa89a7a), sd * .1 * s, .42 * s, 0);
      beam.rotation.z = sd * .5; beam.rotation.x = -.2; head.add(beam);
      for (let i = 0; i < 3; i++) {
        const tine = mesh(cyl(.014 * s, .018 * s, .3 * s, 5), mat(0xa89a7a),
          sd * (.2 + i * .08) * s, (.55 + i * .12) * s, 0);
        tine.rotation.z = sd * .9; head.add(tine);
      }
    }
  }

  /* legs */
  const mkLeg = (x, z) => {
    const hip = new THREE.Group();
    hip.position.set(x, -.2 * s, z);
    trunk.add(hip);
    hip.add(mesh(box(.13 * s, .58 * s, .15 * s), body, 0, -.29 * s, 0));
    const knee = new THREE.Group();
    knee.position.y = -.58 * s; hip.add(knee);
    knee.add(mesh(box(.1 * s, .55 * s, .12 * s), body, 0, -.28 * s, 0));
    const hoof = mesh(box(.13 * s, .1 * s, .17 * s), dark, 0, -.6 * s, .01);
    knee.add(hoof);
    return { hip, knee };
  };
  rig.legs = [
    mkLeg(-.24 * s, L * .34), mkLeg(.24 * s, L * .34),
    mkLeg(-.24 * s, -L * .34), mkLeg(.24 * s, -L * .34)
  ];

  /* tail + mane */
  const tail = new THREE.Group();
  tail.position.set(0, .18 * s, -L * .5);
  trunk.add(tail); rig.tail = tail;
  tail.add(mesh(box(.09 * s, .5 * s, .09 * s), dark, 0, -.24 * s, -.04 * s));

  for (let i = 0; i < 6; i++) {
    const tuft = mesh(box(.05 * s, .16 * s, .12 * s), dark, 0, (.4 - i * .06) * s, (.2 + i * .07) * s);
    tuft.rotation.x = -.4; neck.add(tuft);
  }

  if (def.glow) {
    const l = new THREE.PointLight(def.color, 2.4, 12, 2);
    l.position.y = HGT; root.add(l);
    root.traverse(o => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.emissive = new THREE.Color(def.color);
        o.material.emissiveIntensity = .5;
      }
    });
  }

  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.userData.rig = rig;
  root.userData.height = HGT;
  return { root, rig, height: HGT };
}

/* ============================================================
   VEGETATION
   ============================================================ */
export function buildTree(theme, rng) {
  const g = new THREE.Group();
  const h = rng.range(6, 14);

  const barkColor = { snow: 0x4a4038, desert: 0x8a6a44, savanna: 0x5a4428 }[theme] ?? 0x4a3626;
  const bark = mat(barkColor, { roughness: 1 });

  if (theme === 'forest' && rng.chance(.55)) {
    /* bamboo cluster */
    const n = rng.int(4, 9);
    for (let i = 0; i < n; i++) {
      const bh = rng.range(7, 15);
      const stalk = mesh(cyl(.05, .07, bh, 6), mat(0x6a8f3a, { roughness: .8 }),
        rng.range(-1.2, 1.2), bh / 2, rng.range(-1.2, 1.2));
      stalk.rotation.z = rng.range(-.05, .05);
      g.add(stalk);
      for (let k = 0; k < 4; k++) {
        const leaf = mesh(box(.02, .9, .16), mat(0x7aa84a, { roughness: .9, side: THREE.DoubleSide }),
          stalk.position.x, bh * (.6 + k * .1), stalk.position.z);
        leaf.rotation.set(rng.range(-.6, .6), rng() * 6.28, rng.range(-.6, .6));
        g.add(leaf);
      }
    }
    return g;
  }

  if (theme === 'desert') {
    /* palm */
    const trunk = mesh(cyl(.16, .26, h * .8, 7), bark, 0, h * .4, 0);
    trunk.rotation.z = rng.range(-.12, .12);
    g.add(trunk);
    const frondM = mat(0x5a7a32, { roughness: .95, side: THREE.DoubleSide });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const f = mesh(box(.1, .06, 3.4), frondM, Math.cos(a) * 1.2, h * .8, Math.sin(a) * 1.2);
      f.rotation.set(rng.range(.2, .5), -a, 0);
      g.add(f);
    }
    return g;
  }

  if (theme === 'snow' || theme === 'kingdom') {
    /* conifer */
    const trunk = mesh(cyl(.14, .3, h, 7), bark, 0, h / 2, 0);
    g.add(trunk);
    const needle = mat(theme === 'snow' ? 0x2a4a34 : 0x2f5a34, { roughness: 1 });
    const snowM = mat(0xeef4fa, { roughness: .8 });
    const tiers = rng.int(5, 8);
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const r = (1 - t) * h * .3 + .4;
      const c = mesh(cone(r, h * .3, 8), needle, 0, h * (.28 + t * .68), 0);
      g.add(c);
      if (theme === 'snow') {
        const cap = mesh(cone(r * .92, h * .1, 8), snowM, 0, h * (.28 + t * .68) + h * .1, 0);
        g.add(cap);
      }
    }
    return g;
  }

  /* broadleaf / maple */
  const trunk = mesh(cyl(.16, .38, h * .62, 8), bark, 0, h * .31, 0);
  trunk.rotation.z = rng.range(-.07, .07);
  g.add(trunk);

  const autumnal = theme === 'ruins';
  const leafColor = autumnal
    ? [0xb03a24, 0xd06a26, 0x8c2a1e][rng.int(0, 2)]
    : theme === 'savanna' ? 0x6a7a34
    : [0x3f6a2a, 0x4a7a34, 0x35602a][rng.int(0, 2)];
  const leaf = mat(leafColor, { roughness: .95 });

  const blobs = rng.int(4, 7);
  for (let i = 0; i < blobs; i++) {
    const r = rng.range(1.4, 2.9);
    const b = mesh(sph(r, 8, 6), leaf,
      rng.range(-1.6, 1.6), h * .62 + rng.range(0, 2.4), rng.range(-1.6, 1.6));
    b.scale.y = theme === 'savanna' ? .38 : rng.range(.7, 1);
    g.add(b);
  }
  // A couple of limbs so the canopy is not floating.
  for (let i = 0; i < 3; i++) {
    const a = rng() * 6.28;
    const limb = mesh(cyl(.05, .1, 2.4, 5), bark, Math.cos(a) * .5, h * .55, Math.sin(a) * .5);
    limb.rotation.set(Math.cos(a) * .7, 0, Math.sin(a) * .7);
    g.add(limb);
  }
  return g;
}

export function buildRock(rng, theme) {
  const s = rng.range(.7, 3.4);
  const geo = new THREE.IcosahedronGeometry(s, 1);
  // Push each vertex out irregularly so no two rocks are alike.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const f = 1 + (rng() - .5) * .55;
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * .8, pos.getZ(i) * f);
  }
  geo.computeVertexNormals();
  const color = { snow: 0x8fa0ac, desert: 0xb08a58, ruins: 0x5a5044 }[theme] ?? 0x6a635c;
  const m = new THREE.Mesh(geo, mat(color, { roughness: 1, flatShading: true }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/* ============================================================
   ARCHITECTURE
   ============================================================ */
export function buildTorii(rng, scale = 1) {
  const g = new THREE.Group();
  const red = mat(0xb03225, { roughness: .8 });
  const dark = mat(0x1f1a16, { roughness: .9 });
  const H = 6 * scale, W = 5 * scale;
  for (const s of [-1, 1]) {
    const p = mesh(cyl(.19 * scale, .25 * scale, H, 10), red, s * W / 2, H / 2, 0);
    p.rotation.z = -s * .03; g.add(p);
  }
  const kasagi = mesh(box(W * 1.44, .3 * scale, .5 * scale), dark, 0, H, 0);
  kasagi.rotation.x = 0; g.add(kasagi);
  const shimaki = mesh(box(W * 1.28, .2 * scale, .38 * scale), red, 0, H - .3 * scale, 0);
  g.add(shimaki);
  const nuki = mesh(box(W * 1.06, .22 * scale, .3 * scale), red, 0, H * .72, 0);
  g.add(nuki);
  const gaku = mesh(box(.5 * scale, .7 * scale, .1 * scale), dark, 0, H * .84, 0);
  g.add(gaku);
  return g;
}

export function buildPagoda(rng, tiers = 3, scale = 1) {
  const g = new THREE.Group();
  const wall = mat(0x6a5340, { roughness: .95 });
  const beam = mat(0x3a2a1e, { roughness: .9 });
  const roof = mat(0x2a2a30, { roughness: .8 });
  let y = 0, w = 5 * scale;
  for (let i = 0; i < tiers; i++) {
    const hgt = 2.6 * scale;
    g.add(mesh(box(w, hgt, w), wall, 0, y + hgt / 2, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(mesh(box(.22 * scale, hgt, .22 * scale), beam, sx * w / 2, y + hgt / 2, sz * w / 2));
    }
    // Flared hip roof.
    const r = mesh(cone(w * .92, 1.3 * scale, 4), roof, 0, y + hgt + .6 * scale, 0);
    r.rotation.y = Math.PI / 4;
    g.add(r);
    const eave = mesh(box(w * 1.5, .12 * scale, w * 1.5), roof, 0, y + hgt + .06 * scale, 0);
    g.add(eave);
    y += hgt + .9 * scale;
    w *= .82;
  }
  const finial = mesh(cyl(.06 * scale, .1 * scale, 1.6 * scale, 6), mat(0xc9a44a, { metalness: .7, roughness: .4 }),
    0, y + .6 * scale, 0);
  g.add(finial);
  return g;
}

/** Village house — optionally burnt out for world 1. */
export function buildHouse(rng, { ruined = false, scale = 1 } = {}) {
  const g = new THREE.Group();
  const w = rng.range(4, 7) * scale, d = rng.range(4, 7) * scale, h = rng.range(2.6, 3.6) * scale;
  const wallC = ruined ? 0x3a3028 : 0x8a7a5e;
  const wall = mat(wallC, { roughness: .96 });
  const beam = mat(ruined ? 0x1a1512 : 0x4a3626, { roughness: .95 });

  if (ruined && rng.chance(.35)) {
    // Only the frame and a stub of wall left.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = mesh(box(.2, h * rng.range(.4, 1.1), .2), beam, sx * w / 2, h / 2, sz * d / 2);
      post.rotation.z = rng.range(-.14, .14);
      g.add(post);
    }
    g.add(mesh(box(w, .5, d), wall, 0, .25, 0));
    return g;
  }

  g.add(mesh(box(w, h, d), wall, 0, h / 2, 0));
  // Exposed timber frame.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(mesh(box(.18, h, .18), beam, sx * w / 2, h / 2, sz * d / 2));
  }
  g.add(mesh(box(w + .04, .16, d + .04), beam, 0, h * .55, 0));

  // Hip roof.
  const roofM = mat(ruined ? 0x2a2420 : 0x3a3a42, { roughness: .9 });
  const roof = mesh(cone(Math.max(w, d) * .82, h * .7, 4), roofM, 0, h + h * .35, 0);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  g.add(mesh(box(w * 1.34, .12, d * 1.34), roofM, 0, h + .06, 0));

  if (!ruined) {
    // Shoji panels.
    const paper = mat(0xd8cfae, { roughness: .9, emissive: 0x2a2010, emissiveIntensity: .25 });
    g.add(mesh(box(w * .62, h * .5, .06), paper, 0, h * .42, d / 2 + .02));
  } else if (rng.chance(.5)) {
    // Collapsed section + charring.
    const rubble = mesh(box(w * .5, .8, d * .5), mat(0x241d18, { roughness: 1, flatShading: true }),
      rng.range(-1, 1), .4, rng.range(-1, 1));
    rubble.rotation.y = rng() * 3;
    g.add(rubble);
  }
  return g;
}

/** Roman colonnade / temple for world 8. */
export function buildTemple(rng, scale = 1) {
  const g = new THREE.Group();
  const stone = mat(0xcfc4a8, { roughness: .85 });
  const w = 14 * scale, d = 22 * scale, h = 8 * scale;

  g.add(mesh(box(w + 3, 1.2, d + 3), stone, 0, .6, 0));
  g.add(mesh(box(w + 1.6, .8, d + 1.6), stone, 0, 1.6, 0));

  const colGeo = cyl(.5 * scale, .58 * scale, h, 14);
  const cols = 6, rows = 10;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const edge = i === 0 || i === cols - 1 || j === 0 || j === rows - 1;
      if (!edge) continue;
      if (rng.chance(.12)) continue;           // a few have fallen
      const x = lerp(-w / 2, w / 2, i / (cols - 1));
      const z = lerp(-d / 2, d / 2, j / (rows - 1));
      const broken = rng.chance(.18);
      const c = mesh(broken ? cyl(.5 * scale, .58 * scale, h * rng.range(.3, .7), 14) : colGeo,
        stone, x, broken ? h * .25 : h / 2 + 2, z);
      g.add(c);
      if (!broken) {
        g.add(mesh(box(1.3 * scale, .4, 1.3 * scale), stone, x, h + 2.2, z));
      }
    }
  }
  // Entablature + pediment.
  g.add(mesh(box(w + 2.6, 1.1, d + 2.6), stone, 0, h + 3, 0));
  const ped = mesh(cone(w * .78, 3.2, 4), stone, 0, h + 5.2, 0);
  ped.rotation.y = Math.PI / 4; ped.scale.z = d / w;
  g.add(ped);
  return g;
}

/** The gate to the next world. */
export function buildGate(scale = 1) {
  const g = new THREE.Group();
  const stone = mat(0x2a2630, { roughness: .7, metalness: .3 });
  const H = 11 * scale, W = 8 * scale;
  for (const s of [-1, 1]) {
    g.add(mesh(box(1.3 * scale, H, 1.3 * scale), stone, s * W / 2, H / 2, 0));
  }
  g.add(mesh(box(W + 2.6 * scale, 1.5 * scale, 1.6 * scale), stone, 0, H, 0));

  // The portal itself.
  const portalMat = new THREE.MeshBasicMaterial({
    color: 0xd8b8ff, transparent: true, opacity: .38, side: THREE.DoubleSide, depthWrite: false
  });
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(W - .6 * scale, H - 1 * scale), portalMat);
  portal.position.y = H / 2;
  g.add(portal);
  g.userData.portal = portal;

  const l = new THREE.PointLight(0xb88aff, 6, 40, 2);
  l.position.y = H / 2; g.add(l);
  g.userData.light = l;

  // Runes on the posts.
  const runeM = new THREE.MeshStandardMaterial({ color: 0x2a1a3a, emissive: 0x9a5aff, emissiveIntensity: 1.4 });
  for (let i = 0; i < 8; i++) {
    for (const s of [-1, 1]) {
      const r = mesh(box(.3 * scale, .3 * scale, .06), runeM, s * (W / 2 + .68 * scale), 1.4 + i * 1.1 * scale, 0);
      g.add(r);
    }
  }
  return g;
}

export function buildChest(locked = false) {
  const g = new THREE.Group();
  const wood = mat(0x5a3f26, { roughness: .9 });
  const iron = mat(0x3a3a42, { roughness: .5, metalness: .7 });
  const gold = mat(0xc9a44a, { roughness: .35, metalness: .9 });

  const base = mesh(box(1.1, .62, .72), wood, 0, .31, 0);
  g.add(base);

  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, .62, -.36);
  g.add(lidPivot);
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(.36, .36, 1.1, 12, 1, false, 0, Math.PI),
    wood
  );
  lid.rotation.z = Math.PI / 2; lid.position.z = .36;
  lid.castShadow = true;
  lidPivot.add(lid);
  g.userData.lid = lidPivot;

  for (const x of [-.38, 0, .38]) {
    g.add(mesh(box(.09, .66, .76), iron, x, .32, 0));
  }
  const lock = mesh(box(.18, .2, .1), locked ? gold : iron, 0, .58, .38);
  g.add(lock);
  g.userData.locked = locked;

  if (locked) {
    const l = new THREE.PointLight(0xffc861, 1.6, 6, 2);
    l.position.set(0, .8, .4); g.add(l);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Cluster of market stalls, braziers and banners for a hub village. */
export function buildStall(rng) {
  const g = new THREE.Group();
  const wood = mat(0x6a4a2e, { roughness: .95 });
  const cloth = mat([0xb03225, 0x2a4a8c, 0x3a6a3a][rng.int(0, 2)], { roughness: .95, side: THREE.DoubleSide });

  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(mesh(box(.12, 2.4, .12), wood, sx * 1.4, 1.2, sz * 1));
  }
  g.add(mesh(box(3.2, .12, 2.4), wood, 0, 1.1, 0));
  const awn = mesh(box(3.6, .06, 2.8), cloth, 0, 2.5, 0);
  awn.rotation.x = .12;
  g.add(awn);
  for (let i = 0; i < rng.int(2, 5); i++) {
    g.add(mesh(box(.3, .3, .3), mat(0x8a6a3a), rng.range(-1.2, 1.2), 1.32, rng.range(-.8, .8)));
  }
  return g;
}

export function buildBrazier() {
  const g = new THREE.Group();
  const iron = mat(0x2a2620, { roughness: .6, metalness: .6 });
  g.add(mesh(cyl(.06, .1, 1.2, 8), iron, 0, .6, 0));
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(.34, .2, .3, 12, 1, true), iron);
  bowl.position.y = 1.32; bowl.castShadow = true;
  g.add(bowl);
  const fire = new THREE.Mesh(sph(.2, 8, 6), new THREE.MeshBasicMaterial({
    color: 0xff8a2b, transparent: true, opacity: .85
  }));
  fire.position.y = 1.42;
  g.add(fire);
  g.userData.fire = fire;
  const l = new THREE.PointLight(0xff8a2b, 4, 18, 2);
  l.position.y = 1.5; g.add(l);
  g.userData.light = l;
  return g;
}

/** Dropped item pickup: the weapon model spinning over a glow. */
export function buildPickup(itemId, colors) {
  const g = new THREE.Group();
  const model = buildWeapon(itemId, colors);
  model.scale.setScalar(.6);
  model.position.y = .5;
  g.add(model);
  g.userData.model = model;

  const halo = new THREE.Mesh(
    new THREE.CylinderGeometry(.45, .45, .02, 16),
    new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: .3, depthWrite: false })
  );
  halo.position.y = .04;
  g.add(halo);
  const l = new THREE.PointLight(0xffc861, 1.2, 5, 2);
  l.position.y = .6; g.add(l);
  return g;
}

export function disposeObject(obj) {
  obj.traverse(o => {
    if (o.isMesh || o.isPoints || o.isLine) {
      // Cached geometry/materials are shared — only dispose one-offs.
      if (!o.geometry.userData?.shared && !geoCache.has(o.geometry.uuid)) {
        if (![...geoCache.values()].includes(o.geometry)) o.geometry.dispose();
      }
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m && ![...matCache.values()].includes(m)) m.dispose();
    }
  });
}
