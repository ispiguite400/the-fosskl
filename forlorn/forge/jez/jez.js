/*
 * JEZ — survivor. The Bacon General's son, who turned on the Empire (The Last Guest).
 * Look:         Robloxian 2.0; white skin (a Bacon); the Bacon hair (Pal Hair) in brown; a black leather
 *               jacket open over a blue tee with a motorcycle print; dark jeans; brown boots.
 *               A rebel's smirk.
 * Skins:        default · rebel (the Empire's blue tunic, torn open, a red armband)
 */
const REB = SKIN_ID === 'rebel';
const bike = (g, cx, cy, s) => { g.strokeStyle = '#1a1a1a'; g.lineWidth = s * 0.05; for (const sx of [-1, 1]) { g.beginPath(); g.arc(cx + sx * s * 0.28, cy + s * 0.12, s * 0.14, 0, PI * 2); g.stroke(); } g.beginPath(); g.moveTo(cx - s * 0.28, cy + s * 0.12); g.lineTo(cx - s * 0.05, cy - s * 0.08); g.lineTo(cx + s * 0.2, cy - s * 0.08); g.lineTo(cx + s * 0.28, cy + s * 0.12); g.moveTo(cx + s * 0.12, cy - s * 0.08); g.lineTo(cx + s * 0.2, cy - s * 0.22); g.stroke(); };
CAST({
  skin: '#f2f3f3',
  clothes: REB ? {
    torso: { kind: 'jacket', color: '#2c4a8a', color2: '#e8e0d0', pants: '#141414', belt: '#141414' },
    arm: { sleeve: 'rolled', color: '#2c4a8a', cuff: '#24407a', patch: (g, cx, cy, s) => { g.fillStyle = '#c82020'; g.fillRect(cx - s, cy + s * 0.4, s * 2, s * 0.35); } },
    leg: { kind: 'trousers', color: '#141414', shoes: { kind: 'boot', color: '#141414', laces: '#3a3a3a' } }
  } : {
    torso: { kind: 'jacket', color: '#1a1a1c', color2: '#2a6fd0', pants: '#2a3040', logo: bike },
    arm: { sleeve: 'long', color: '#1a1a1c', cuff: '#0e0e10' },
    leg: { kind: 'jeans', color: '#2a3040', shoes: { kind: 'boot', color: '#6a4a2a', laces: '#3a2a1a' } }
  },
  face: { eyes: 'oval', brows: 'angry', mouth: 'smirk', mouthW: 120 },
  head() { A.hair('bacon', { color: '#6a4426', hi: '#b07a44' }); }
});
