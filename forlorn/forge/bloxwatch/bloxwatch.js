/*
 * BLOX WATCH — killer. The most powerful Astral, the First Guest (Blox Watch).
 * Look:         Robloxian 2.0; pitch black, like a Guest burned to shadow; a black hood up over
 *               his head; two burning yellow eyes and nothing else on the face; faint gold lines
 *               of Astral lightning running under the black. (His eyes glow in the game.)
 * Skins:        default · void (deep violet lines and white eyes)
 */
const VOID = SKIN_ID === 'void';
const GLOW = VOID ? '#c8a0ff' : '#ffd21f';
const bolts = (g, W, H, n, seed) => { let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; for (let i = 0; i < n; i++) { let x = r() * W, y = r() * H * 0.3; g.strokeStyle = GLOW; g.lineWidth = 0.0045; g.globalAlpha = 0.7; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 0.07; y += 0.02 + r() * 0.05; g.lineTo(x, y); } g.stroke(); g.globalAlpha = 1; } };
CAST({
  skin: '#0b0b0d',
  clothes: {
    torso: (g, face, W, H) => { Wr.torso(g, face, W, H, { kind: 'hoodie', color: '#111114', collar: 'hood', trim: '#26262c', pocket: 'kanga', pants: '#0d0d0f' }); bolts(g, W, H, 4, 17 + face.length * 3); },
    arm: (g, part, face, W, H) => { Wr.arm(g, part, face, W, H, { sleeve: 'long', color: '#111114', cuff: '#0d0d0f' }); bolts(g, W, H, 2, 5 + face.length); },
    leg: (g, part, face, W, H) => { Wr.leg(g, part, face, W, H, { kind: 'trousers', color: '#0d0d0f', shoes: { kind: 'boot', color: '#070708' } }); bolts(g, W, H, 2, 9 + face.length); }
  },
  face: { eyes: 'glow', glow: VOID ? '#e8e0ff' : GLOW, eyeW: 32, eyeH: 44, brows: 'none', mouth: 'none' },
  head() { A.hood({ color: '#141418' }); }
});
