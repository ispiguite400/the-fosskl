/*
 * DAISY — survivor. Guest's childhood friend (The Last Guest).
 * Look:         slim Robloxian 2.0; peach skin; long golden hair in a ponytail with a fringe; a teal
 *               sweatshirt with a white daisy on it; light jeans; white sneakers. Warm face.
 * Skins:        default · medic (white field coat, red-cross armband, scrubs)
 */
const MED = SKIN_ID === 'medic';
const daisyLogo = (g, cx, cy, s) => {
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 8; i++) { const a = i / 8 * PI * 2; g.beginPath(); g.ellipse(cx + Math.cos(a) * s * 0.17, cy + Math.sin(a) * s * 0.17, s * 0.11, s * 0.05, a, 0, PI * 2); g.fill(); }
  g.fillStyle = '#f2c230'; g.beginPath(); g.arc(cx, cy, s * 0.08, 0, PI * 2); g.fill();
};
CAST({
  pkg: 'slim', skin: '#f2d0b0',
  clothes: MED ? {
    torso: { kind: 'coat', color: '#eef0ee', color2: '#6aa8a0', buttons: 3, buttonColor: '#9aa0a0', pants: '#6aa8a0' },
    arm: { sleeve: 'long', color: '#eef0ee', cuff: '#d8dcda', patch: (g, cx, cy, s) => { g.fillStyle = '#ffffff'; g.fillRect(cx - s / 2, cy - s * 0.3, s, s * 0.6); g.fillStyle = '#d82020'; g.fillRect(cx - s * 0.1, cy - s * 0.24, s * 0.2, s * 0.48); g.fillRect(cx - s * 0.24, cy - s * 0.1, s * 0.48, s * 0.2); } },
    leg: { kind: 'trousers', color: '#6aa8a0', shoes: { kind: 'sneaker', color: '#f2f2ee', laces: '#cccccc' } }
  } : {
    torso: { kind: 'sweater', color: '#2ab0c4', collar: 'crew', logo: daisyLogo, pants: '#7a9cc8' },
    arm: { sleeve: 'long', color: '#2ab0c4', cuff: '#2296a8' },
    leg: { kind: 'jeans', color: '#7a9cc8', shoes: { kind: 'sneaker', color: '#f6f6f2', laces: '#dddddd', accent: '#2ab0c4' } }
  },
  face: { eyes: 'oval', eyeW: 28, eyeH: 46, lash: true, brows: 'raised', browColor: '#8a6a30', mouth: 'smile', mouthW: 110, lips: '#c86a6a', blush: 'rgba(240,120,120,0.35)' },
  head() { A.hair('long', { color: '#e0b858', hi: null, ponytail: true, len: 0.35 }); }
});
