/*
 * RICH GUY — survivor. Robloxian High's richest teacher (Guest 666), dripping in gold.
 * Look:         Robloxian 2.0 "Man"; light skin; slicked black hair; gold shades; a gold suit
 *               over a black shirt and a gold tie; a heavy gold chain (drawn); black dress shoes. A grin.
 * Skins:        default · diamond (an ice-blue suit, white shirt, a diamond chain)
 */
const DIA = SKIN_ID === 'diamond';
CAST({
  pkg: 'man', skin: '#f0d2b4',
  clothes: {
    torso: (g, face, W, H) => {
      Wr.torso(g, face, W, H, { kind: 'suit', color: DIA ? '#bfe4f2' : '#d8a828', color2: DIA ? '#f6f8fa' : '#141414', tie: DIA ? '#5ab4e0' : '#f2c838', buttons: 2, buttonColor: DIA ? '#ffffff' : '#fff0a0', pants: DIA ? '#a8d4e8' : '#c89820' });
      if (face !== 'front' && face !== 'top') return;
      // the heavy chain, drawn link by link, and its pendant
      const gold = DIA ? '#eef8ff' : '#f6cc3a', dark = DIA ? '#8ab0c8' : '#9a7414';
      const y0 = face === 'top' ? H * 0.3 : 0.01, n = 15;
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = W * (0.3 + 0.4 * t), y = face === 'top' ? y0 : y0 + Math.sin(t * PI) * H * 0.3;
        g.fillStyle = dark; g.beginPath(); g.ellipse(x, y + 0.003, 0.014, 0.01, 0, 0, PI * 2); g.fill();
        g.fillStyle = gold; g.beginPath(); g.ellipse(x, y, 0.012, 0.008, 0, 0, PI * 2); g.fill();
      }
      if (face === 'front') { g.fillStyle = gold; g.beginPath(); g.arc(W / 2, H * 0.36, 0.03, 0, PI * 2); g.fill(); B.draw.text(g, '$', W / 2, H * 0.362, 0.04, dark); }
    },
    arm: { sleeve: 'long', color: DIA ? '#bfe4f2' : '#d8a828', cuff: DIA ? '#ffffff' : '#141414', watch: DIA ? '#e8f8ff' : '#f2d040' },
    leg: { kind: 'trousers', color: DIA ? '#a8d4e8' : '#c89820', shoes: { kind: 'dress', color: '#121212', sole: '#0a0a0a' } }
  },
  face: { eyes: 'oval', brows: 'raised', mouth: 'grin', mouthW: 150 },
  head() {
    A.hair('slick', { color: '#141414', hi: null });
    A.shades({ lens: '#0c0c0e', frame: DIA ? '#e8f4ff' : '#e0b030' });
  }
});
