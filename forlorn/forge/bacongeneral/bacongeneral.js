/*
 * BACON GENERAL — killer. General Baconson, ruler of the Bacon Empire (The Last Guest).
 * Look:         Robloxian 2.0 "Man"; light skin; brown Bacon hair cropped under an officer's
 *               peaked cap (Empire blue, black band, gold badge); the Empire's blue tunic with a
 *               black collar, gold buttons and epaulettes and a red sash; black belt; black
 *               trousers with a blue stripe; tall black boots; a pistol in his right hand. A sneer.
 * Skins:        default · dress (parade whites with gold)
 */
const DR = SKIN_ID === 'dress';
const BLUE = DR ? '#eef0f2' : '#2c4a8a', TROU = DR ? '#e4e6e8' : '#141416';
CAST({
  body: { voxel: 0.0031 },                      // a coarser grid keeps the sculpt small enough to ship
  pkg: 'man', skin: '#f0d0b0',
  clothes: {
    torso: (g, face, W, H) => {
      Wr.torso(g, face, W, H, { kind: 'tee', color: BLUE, collar: 'none', buttons: 5, buttonColor: '#e8c050', belt: '#101010', pants: TROU, tuck: true });
      if (face === 'front' || face === 'top') { g.fillStyle = '#141416'; g.fillRect(W * 0.34, 0, W * 0.32, H * 0.05); }
      if (face === 'front' || face === 'back') { g.save(); g.strokeStyle = '#b42424'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(face === 'front' ? W * 0.12 : W * 0.88, 0); g.lineTo(face === 'front' ? W * 0.88 : W * 0.12, H * B.D.torsoSplit.waist); g.stroke(); g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 0.004; g.stroke(); g.restore(); }
      if (face === 'front') { const cols = ['#e8c050', '#b42424', '#3a6ac8']; for (let i = 0; i < 6; i++) { g.fillStyle = cols[i % 3]; g.fillRect(W * 0.64 + (i % 3) * 0.028, H * 0.16 + Math.floor(i / 3) * 0.018, 0.026, 0.015); } }
    },
    arm: (g, part, face, W, H) => {
      Wr.arm(g, part, face, W, H, { sleeve: 'long', color: BLUE, cuff: '#141416', glove: '#141416' });
      if (face !== 'bottom') { g.fillStyle = '#e8c050'; g.fillRect(0, 0, W, 0.03); for (let x = 0.01; x < W; x += 0.018) g.fillRect(x, 0.03, 0.008, 0.035); }
      if (face !== 'top' && face !== 'bottom') { g.fillStyle = '#e8c050'; g.fillRect(0, H * 0.74, W, 0.012); }
    },
    leg: { kind: 'trousers', color: TROU, stripe: DR ? '#e8c050' : '#2c4a8a', shoes: { kind: 'boot', color: '#0e0e10', sole: '#060606' } }
  },
  face: { eyes: 'oval', eyeW: 27, eyeH: 42, brows: 'angry', browColor: '#4a2a14', mouth: 'smirk', mouthW: 120 },
  head() {
    A.hair('short', { color: '#7a4a28' });
    A.peaked({ color: BLUE, band: '#141416', badge: '#e8c050' });
    return A.pistol({ color: '#1a1a1c' });
  }
});
