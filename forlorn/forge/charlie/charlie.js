/*
 * CHARLIE — survivor. Charlotte, the Last Guest's daughter, an Astral (Blox Watch).
 * Look:         slim Robloxian 2.0; WHITE skin like her father; long navy hair with a fringe;
 *               glowing cyan Astral eyes; a white tee under an open denim jacket; dark jeans;
 *               white sneakers.
 * Skins:        default · awakened (a dark hoodie traced with glowing cyan lines)
 */
const AW = SKIN_ID === 'awakened';
const lines = (g, W, H, n, seed) => { let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; g.strokeStyle = '#46e0ff'; g.lineWidth = 0.006; for (let i = 0; i < n; i++) { let x = r() * W, y = r() * H; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { if (r() < 0.5) x += (r() - 0.5) * 0.12; else y += (r() - 0.5) * 0.12; g.lineTo(x, y); } g.stroke(); } };
CAST({
  pkg: 'slim', skin: '#f2f2f0',
  clothes: AW ? {
    torso: (g, face, W, H) => { Wr.torso(g, face, W, H, { kind: 'hoodie', color: '#141a2a', collar: 'hood', trim: '#46e0ff', pocket: 'kanga', pants: '#10141e' }); lines(g, W, H, 5, 11 + face.length); },
    arm: (g, part, face, W, H) => { Wr.arm(g, part, face, W, H, { sleeve: 'long', color: '#141a2a', cuff: '#46e0ff' }); lines(g, W, H * 0.8, 2, 3 + face.length); },
    leg: (g, part, face, W, H) => { Wr.leg(g, part, face, W, H, { kind: 'jeans', color: '#10141e', shoes: { kind: 'sneaker', color: '#e8f8ff', laces: '#46e0ff' } }); lines(g, W, H * 0.7, 2, 7 + face.length); }
  } : {
    torso: { kind: 'jacket', color: '#4a6a9a', color2: '#f4f4f2', pants: '#22283a', pocket: false },
    arm: { sleeve: 'long', color: '#4a6a9a', cuff: '#3a5682' },
    leg: { kind: 'jeans', color: '#22283a', shoes: { kind: 'sneaker', color: '#f6f6f2', laces: '#dddddd', accent: '#46e0ff' } }
  },
  face: { eyes: 'glow', glow: '#46e0ff', eyeW: 30, eyeH: 46, brows: 'flat', browColor: '#1e2660', mouth: 'flat', mouthW: 90, lips: '#c08080' },
  head() { A.hair('long', { color: '#26306e', len: 0.5 }); }
});
