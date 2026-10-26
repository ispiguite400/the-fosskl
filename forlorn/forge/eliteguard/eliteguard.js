/*
 * ELITE GUARD — killer. The Bacon Empire's best swordsman (The Last Guest).
 * Look:         Robloxian 2.0 "Superhero" build; light skin; a black bandana; a red scar down
 *               his right eye; black lamellar armour drawn in plates with dark red cords and a red
 *               sash; black gloves and armoured boots; a straight sword in his right hand. Cold.
 * Skins:        default · crimson (red-lacquered armour)
 */
const CR = SKIN_ID === 'crimson';
const ARM = CR ? '#7a1414' : '#18181c', PLATE = CR ? '#a01c1c' : '#2a2a30', CORD = CR ? '#1a1a1a' : '#8a1a1a';
const plates = (g, W, H, y0, y1, rows) => {
  const h = (y1 - y0) / rows;
  for (let i = 0; i < rows; i++) { const y = y0 + i * h; g.fillStyle = i % 2 ? ARM : PLATE; g.fillRect(0, y, W, h); B.draw.shade(g, 0, y, W, h, 'rgba(255,255,255,0.1)', 'rgba(0,0,0,0.35)'); g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, y + h - 0.004, W, 0.004); for (let x = 0.02; x < W; x += 0.04) { g.fillStyle = CORD; g.fillRect(x, y + h * 0.4, 0.008, h * 0.25); } }
};
CAST({
  body: { voxel: 0.0031 },                      // a coarser grid keeps the sculpt small enough to ship
  pkg: 'superhero', skin: '#eac6a6',
  clothes: {
    torso: (g, face, W, H) => {
      const wy = H * B.D.torsoSplit.waist;
      g.fillStyle = ARM; g.fillRect(0, 0, W, H);
      if (face === 'front' || face === 'back') {
        // a moulded breastplate with a raised ridge and a lit rim, its straps over the shoulders
        g.fillStyle = PLATE; g.beginPath(); g.moveTo(W * 0.1, H * 0.06); g.lineTo(W * 0.9, H * 0.06); g.lineTo(W * 0.84, wy - 0.05); g.quadraticCurveTo(W / 2, wy + 0.01, W * 0.16, wy - 0.05); g.closePath(); g.fill();
        B.draw.shade(g, W * 0.1, H * 0.06, W * 0.8, wy - H * 0.06, 'rgba(255,255,255,0.16)', 'rgba(0,0,0,0.45)');
        B.draw.lines(g, [[W * 0.1, H * 0.06, W * 0.9, H * 0.06, W * 0.84, wy - 0.05], [W * 0.1, H * 0.06, W * 0.16, wy - 0.05]], 'rgba(255,255,255,0.22)', 0.005);
        if (face === 'front') { B.draw.lines(g, [[W / 2, H * 0.1, W / 2, wy - 0.04]], 'rgba(255,255,255,0.18)', 0.007); B.draw.lines(g, [[W / 2 + 0.006, H * 0.1, W / 2 + 0.006, wy - 0.04]], 'rgba(0,0,0,0.5)', 0.004); g.fillStyle = PLATE; g.beginPath(); g.moveTo(W * 0.32, 0); g.lineTo(W / 2, H * 0.1); g.lineTo(W * 0.68, 0); g.fill(); }
        for (const sx of [0.2, 0.8]) { g.fillStyle = CORD; g.fillRect(W * sx - 0.012, 0, 0.024, H * 0.08); }
        for (const [x, y] of [[0.16, 0.14], [0.84, 0.14], [0.2, 0.42], [0.8, 0.42]]) { g.fillStyle = '#9a9aa2'; g.beginPath(); g.arc(W * x, H * y, 0.007, 0, PI * 2); g.fill(); }
      } else plates(g, W, H, H * 0.06, wy - 0.02, 5);
      g.fillStyle = CR ? '#1a1a1a' : '#a01c1c'; g.fillRect(0, wy - 0.025, W, 0.05);
      if (face === 'front') { g.fillStyle = CR ? '#1a1a1a' : '#a01c1c'; g.fillRect(W * 0.62, wy - 0.02, 0.03, 0.12); g.fillRect(W * 0.66, wy - 0.02, 0.03, 0.1); }
      plates(g, W, H, wy + 0.025, H, 3);
    },
    arm: (g, part, face, W, H) => { if (face === 'bottom') { g.fillStyle = '#101012'; g.fillRect(0, 0, W, H); return; } g.fillStyle = ARM; g.fillRect(0, 0, W, H); plates(g, W, H, 0, H * 0.4, 4); Wr.shade(g, 0, H * 0.4, W, H * 0.4); g.fillStyle = '#101012'; g.fillRect(0, H * 0.8, W, H * 0.2); g.fillStyle = CORD; g.fillRect(0, H * 0.62, W, 0.012); },
    leg: (g, part, face, W, H) => {
      Wr.leg(g, part, face, W, H, { kind: 'trousers', color: ARM, shoes: { kind: 'boot', color: '#101012' } });
      plates(g, W, H, 0, H * 0.32, 3);
      if (face === 'front') { g.fillStyle = PLATE; g.fillRect(W * 0.18, H * 0.44, W * 0.64, H * 0.1); B.draw.shade(g, W * 0.18, H * 0.44, W * 0.64, H * 0.1, 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.4)'); }
    }
  },
  face: { eyes: 'narrow', eyeW: 28, eyeH: 44, brows: 'angry', browColor: '#121212', mouth: 'flat', mouthW: 100, scar: 'right', scarColor: '#c02020' },
  head() {
    A.hair('short', { color: '#1a1410' });
    A.bandana({ color: '#101012', y: 0.15 });
    return A.sword({ blade: '#c8ccd2', hilt: '#121212', guard: CR ? '#d8b040' : '#8a1a1a' });
  }
});
