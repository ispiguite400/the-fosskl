/*
 * JUSTIN — survivor. Hood up, head down, Robloxian High (Guest 666).
 * Look:         Robloxian 2.0; brown skin; short black hair under a green hoodie with the hood
 *               up; charcoal jeans; black-and-white sneakers. A guarded look.
 * Skins:        default · varsity (a red-and-white varsity jacket, hood down)
 */
const VAR = SKIN_ID === 'varsity';
CAST({
  skin: '#8a5a3c',
  clothes: VAR ? {
    torso: { kind: 'jacket', color: '#b42a2a', color2: '#f2f2ee', pants: '#3a3a40', backPrint: (g, cx, cy, s) => B.draw.text(g, 'RH', cx, cy, s * 0.5, '#f2f2ee') },
    arm: { sleeve: 'long', color: '#f2f2ee', cuff: '#b42a2a' },
    leg: { kind: 'jeans', color: '#3a3a40', shoes: { kind: 'sneaker', color: '#141414', sole: '#f2f2ee', laces: '#f2f2ee' } }
  } : {
    torso: { kind: 'hoodie', color: '#3e7a44', collar: 'hood', trim: '#d8d8d0', pocket: 'kanga', pants: '#3a3a40' },
    arm: { sleeve: 'long', color: '#3e7a44', cuff: '#2e5e34' },
    leg: { kind: 'jeans', color: '#3a3a40', shoes: { kind: 'sneaker', color: '#141414', sole: '#f2f2ee', laces: '#f2f2ee', accent: '#f2f2ee' } }
  },
  face: { eyes: 'oval', brows: 'flat', mouth: 'flat', mouthW: 100 },
  head() { if (VAR) A.hair('short', { color: '#141414' }); else A.hood({ color: '#3e7a44' }); }
});
