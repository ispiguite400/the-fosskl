/* A plumber in a red cap, built from primitives like everything else here.
 *
 * buildMario() returns a Group with a real joint hierarchy (hips → torso →
 * head / shoulders → elbows, hips → knees) so the viewer can pose and
 * animate it. The figure stands on y = 0, faces +Z and is about 1.9 units
 * tall. Every joint is exposed on group.userData.joints. */

import * as THREE from 'three';

const COLORS = {
  red: 0xd21f25,
  blue: 0x1f4fbf,
  skin: 0xf6c39a,
  brown: 0x5a2e16,
  hair: 0x3b1e0e,
  white: 0xf7f7f2,
  yellow: 0xf5c518,
  black: 0x111111,
  iris: 0x2f7fd8
};

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: 0, ...opts });

function mesh(geo, material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function joint(parent, x = 0, y = 0, z = 0) {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

/* The cap badge: a white roundel with a red M, drawn on a canvas. */
function badgeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f7f2';
  g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#d21f25';
  g.font = 'bold 190px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('M', 128, 138);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildMario() {
  const m = {
    red: mat(COLORS.red),
    blue: mat(COLORS.blue, { roughness: .7 }),
    skin: mat(COLORS.skin, { roughness: .6 }),
    brown: mat(COLORS.brown, { roughness: .45 }),
    hair: mat(COLORS.hair, { roughness: .9 }),
    white: mat(COLORS.white, { roughness: .5 }),
    yellow: mat(COLORS.yellow, { roughness: .3, metalness: .6 }),
    black: mat(COLORS.black, { roughness: .2 }),
    iris: mat(COLORS.iris, { roughness: .2 })
  };
  const sph = (r, w = 32, h = 24) => new THREE.SphereGeometry(r, w, h);

  const root = new THREE.Group();
  root.name = 'Mario';
  const J = {};

  /* ---------- hips and legs ---------- */
  J.hips = joint(root, 0, .52, 0);
  J.hips.add(mesh(sph(.33), m.blue, 0, .04, 0, 1, .8, .9));

  for (const side of [-1, 1]) {
    const key = side < 0 ? 'R' : 'L';
    const leg = J['leg' + key] = joint(J.hips, .16 * side, -.08, 0);
    leg.add(mesh(new THREE.CylinderGeometry(.12, .11, .3, 20), m.blue, 0, -.14, 0));
    const foot = J['foot' + key] = joint(leg, 0, -.32, 0);
    // Shoe: a long rounded toe and a flat heel, with a darker sole.
    foot.add(mesh(sph(.15), m.brown, 0, -.02, .07, .95, .62, 1.45));
    foot.add(mesh(sph(.12), m.brown, 0, -.01, -.05, 1, .7, 1));
    foot.add(mesh(new THREE.CylinderGeometry(.14, .14, .03, 24), mat(0x2a150a), 0, -.1, .04, 1, 1, 1.5));
  }

  /* ---------- torso: red shirt, blue overalls ---------- */
  J.torso = joint(J.hips, 0, .06, 0);
  J.torso.add(mesh(sph(.35), m.red, 0, .4, 0, 1.02, .92, .86));
  J.torso.add(mesh(sph(.375), m.blue, 0, .12, 0, 1, .9, .9));

  // Bib: a curved panel wrapped round the front of the chest.
  const bibGeo = new THREE.CylinderGeometry(.335, .36, .2, 24, 1, true, -.62, 1.24);
  J.torso.add(mesh(bibGeo, mat(COLORS.blue, { roughness: .7, side: THREE.DoubleSide }), 0, .4, 0, 1, 1, .9));

  for (const side of [-1, 1]) {
    // Straps up over the shoulders and down the back.
    const strapF = mesh(new THREE.BoxGeometry(.07, .26, .03), m.blue, .15 * side, .6, .23);
    strapF.rotation.x = -.55; strapF.rotation.z = -.12 * side;
    J.torso.add(strapF);
    const strapB = mesh(new THREE.BoxGeometry(.07, .34, .03), m.blue, .15 * side, .42, -.285);
    strapB.rotation.x = .25;
    J.torso.add(strapB);
    // Gold buttons at the top of the bib.
    const btn = mesh(sph(.045, 16, 12), m.yellow, .15 * side, .47, .305, 1, 1, .5);
    btn.rotation.y = .45 * side;
    J.torso.add(btn);
  }

  /* ---------- arms ---------- */
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'R' : 'L';
    const sh = J['shoulder' + key] = joint(J.torso, .34 * side, .56, 0);
    sh.rotation.z = .32 * side;
    sh.add(mesh(sph(.12), m.red));
    sh.add(mesh(new THREE.CylinderGeometry(.1, .09, .22, 20), m.red, 0, -.12, 0));
    const el = J['elbow' + key] = joint(sh, 0, -.23, 0);
    el.add(mesh(sph(.09), m.red));
    el.add(mesh(new THREE.CylinderGeometry(.09, .085, .14, 20), m.red, 0, -.07, 0));
    const hand = J['hand' + key] = joint(el, 0, -.2, 0);
    const cuff = mesh(new THREE.TorusGeometry(.085, .035, 12, 24), m.white, 0, .07, 0);
    cuff.rotation.x = Math.PI / 2;
    hand.add(cuff);
    hand.add(mesh(sph(.14), m.white, 0, -.04, 0, 1, 1.05, .88));
    const thumb = mesh(sph(.06), m.white, -.09 * side, -.01, .07, .8, 1.2, .8);
    thumb.rotation.z = .5 * side;
    hand.add(thumb);
  }

  /* ---------- head ---------- */
  J.head = joint(J.torso, 0, .74, 0);
  const H = J.head;
  H.add(mesh(sph(.4), m.skin, 0, .33, 0, 1, .95, .95));

  // Ears
  for (const side of [-1, 1]) H.add(mesh(sph(.08), m.skin, .38 * side, .32, -.02, .45, .85, .6));

  // Nose: big and round.
  H.add(mesh(sph(.14), m.skin, 0, .27, .4, 1.05, .9, .95));

  // Moustache: a row of lobes following the curve of the face.
  for (let i = -3; i <= 3; i++) {
    const a = i * .2;
    const lobe = mesh(sph(.085, 20, 14), m.hair,
      Math.sin(a) * .31, .16 - Math.abs(i) * .012, Math.cos(a) * .31 + .06, 1.15, .62, .55);
    lobe.rotation.y = a;
    lobe.rotation.z = -i * .12;
    H.add(lobe);
  }

  // Eyes: white, blue iris, black pupil, a tiny highlight.
  for (const side of [-1, 1]) {
    const eye = joint(H, .11 * side, .43, .345);
    eye.rotation.y = .22 * side;
    eye.add(mesh(sph(.07, 24, 16), m.white, 0, 0, 0, .75, 1.35, .45));
    eye.add(mesh(sph(.036, 20, 14), m.iris, 0, -.005, .022, .8, 1.25, .45));
    eye.add(mesh(sph(.02, 16, 12), m.black, 0, -.005, .033, .8, 1.3, .4));
    eye.add(mesh(sph(.008, 8, 6), m.white, .008, .02, .04));
    const brow = mesh(new THREE.CapsuleGeometry(.018, .07, 4, 8), m.hair, .005 * side, .115, .01);
    brow.rotation.z = Math.PI / 2 + .15 * side;
    eye.add(brow);
  }

  // Hair: sideburns and the tuft at the back beneath the cap.
  for (const side of [-1, 1]) {
    const sb = mesh(new THREE.BoxGeometry(.05, .16, .09), m.hair, .35 * side, .4, .1);
    sb.rotation.y = .5 * side;
    H.add(sb);
  }
  const backHair = new THREE.SphereGeometry(.41, 32, 16, Math.PI, Math.PI, 1.05, .75);
  H.add(mesh(backHair, m.hair, 0, .33, 0, 1.01, .96, .97));

  /* ---------- cap ---------- */
  const cap = joint(H, 0, .55, -.02);
  cap.rotation.x = -.08;
  cap.add(mesh(new THREE.SphereGeometry(.425, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), m.red, 0, 0, 0, 1.02, .82, 1.04));
  cap.add(mesh(new THREE.CylinderGeometry(.43, .41, .08, 40), m.red, 0, -.03, 0, 1.02, 1, 1.04));
  // Brim: a half disc sticking out over the eyes.
  const brim = mesh(new THREE.CylinderGeometry(.32, .32, .035, 32, 1, false, -Math.PI / 2, Math.PI), m.red, 0, -.05, .26, 1.05, 1, 1);
  brim.rotation.x = .18;
  cap.add(brim);
  // Badge on the front of the crown.
  const badge = new THREE.Mesh(new THREE.CircleGeometry(.12, 40),
    new THREE.MeshStandardMaterial({ map: badgeTexture(), roughness: .5, transparent: true }));
  badge.position.set(0, .19, .4);
  badge.rotation.x = -.5;
  cap.add(badge);

  root.userData.joints = J;
  // Rest pose, so animations can blend back to it.
  root.userData.rest = Object.fromEntries(
    Object.entries(J).map(([k, j]) => [k, { p: j.position.clone(), r: j.rotation.clone() }]));
  return root;
}
