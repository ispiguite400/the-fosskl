/*
 * ROSE — survivor. Broke out of Guest Prison (The Last Guest).
 * Look:         slim Robloxian 2.0; light skin; pink hair up in a bun with a fringe; a pink
 *               tracksuit (zip jacket with white stripes down the sleeves, matching pants);
 *               white sneakers. A cocky smirk.
 * Skins:        default · prisoner (the orange Guest Prison jumpsuit)
 */
const PR = SKIN_ID === 'prisoner';
CAST({
  pkg: 'slim', skin: '#f2d2bc',
  clothes: PR ? {
    torso: { kind: 'tee', color: '#e0702a', collar: 'v', color2: '#f2d2bc', pocket: 'chest', pants: '#e0702a', backPrint: (g, cx, cy, s) => B.draw.text(g, 'GUEST PRISON', cx, cy, s * 0.17, '#6a2a08') },
    arm: { sleeve: 'short', color: '#e0702a' },
    leg: { kind: 'trousers', color: '#e0702a', shoes: { kind: 'flat', color: '#f2f2ee', sole: '#d8d8d4' } }
  } : {
    torso: { kind: 'track', color: '#f06aa8', collar: 'crew', zip: true, pants: '#f06aa8', sideStripe: '#ffffff' },
    arm: { sleeve: 'long', color: '#f06aa8', cuff: '#ffffff', stripe: '#ffffff' },
    leg: { kind: 'track', color: '#f06aa8', stripe: '#ffffff', shoes: { kind: 'sneaker', color: '#ffffff', laces: '#f0a0c8', accent: '#f06aa8' } }
  },
  face: { eyes: 'oval', eyeW: 28, eyeH: 44, lash: true, brows: 'angry', browColor: '#a83a6a', mouth: 'smirk', mouthW: 110, lips: '#c0507a' },
  head() { A.hair('bob', { color: '#e0528e', bun: true, hairline: 0.34 }); }
});
