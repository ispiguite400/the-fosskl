/*
 * BACON COLONEL — killer. The one-eyed Colonel who took the Empire after the General (The Last Guest).
 * Look:         Robloxian 2.0 "Man"; light skin; a black eyepatch over his left eye and a scar;
 *               a grey fur hat with the Empire's badge; a long grey greatcoat with a fur collar,
 *               open over the dark blue uniform; black gloves; black trousers and boots. Grim.
 * Skins:        default · winter (a white winter coat and hat)
 */
const WIN = SKIN_ID === 'winter';
const COAT = WIN ? '#dcdcd8' : '#5e5a56', FUR = WIN ? '#f2f2ee' : '#8a857e';
CAST({
  body: { voxel: 0.0031 },                      // a coarser grid keeps the sculpt small enough to ship
  pkg: 'man', skin: '#ecc8a8',
  clothes: {
    torso: (g, face, W, H) => {
      Wr.torso(g, face, W, H, { kind: 'coat', color: COAT, color2: '#22304e', buttons: 4, buttonColor: '#c8a040', belt: '#121212', pants: COAT });
      if (face === 'front' || face === 'back' || face === 'top') { g.fillStyle = FUR; g.fillRect(0, 0, W, 0.05); for (let x = 0; x < W; x += 0.012) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0.035 + ((x * 997) % 0.012), 0.004, 0.02); } }
    },
    arm: (g, part, face, W, H) => {
      Wr.arm(g, part, face, W, H, { sleeve: 'long', color: COAT, cuff: FUR, glove: '#121212' });
      if (face !== 'bottom') { g.fillStyle = FUR; g.fillRect(0, 0, W, 0.04); }
    },
    leg: (g, part, face, W, H) => {
      Wr.leg(g, part, face, W, H, { kind: 'trousers', color: '#161618', stripe: '#22304e', shoes: { kind: 'boot', color: '#0e0e10' } });
      // the greatcoat's skirt over the thighs
      g.fillStyle = COAT; g.fillRect(0, 0, W, H * 0.42); Wr.shade(g, 0, 0, W, H * 0.42); g.fillStyle = FUR; g.fillRect(0, H * 0.42 - 0.03, W, 0.03);
      if (face === 'front') { g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.005; g.beginPath(); g.moveTo(part === 'legL' ? 0.01 : W - 0.01, 0); g.lineTo(part === 'legL' ? 0.01 : W - 0.01, H * 0.42); g.stroke(); }
    }
  },
  face: { eyes: 'oval', eyeW: 26, eyeH: 40, brows: 'angry', browColor: '#3a2a1a', mouth: 'frown', mouthW: 110, scar: 'left', scarColor: '#9a4a40' },
  head() {
    A.hair('short', { color: '#6a4426' });
    A.ushanka({ color: FUR, crown: WIN ? '#c8c8c4' : '#3a3a3c', badge: '#c8a040' });
    A.eyepatch({ side: 'L' });
  }
});
