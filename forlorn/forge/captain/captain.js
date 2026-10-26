/*
 * ARMY CAPTAIN — survivor. Led the Roblox Army against the Bacon Empire (The Last Guest).
 * Look:         Robloxian 2.0 "Man" proportions; tan skin; a dark moustache; an olive dress
 *               uniform with gold buttons, a Sam Browne belt and ribbon bars; olive trousers with
 *               a dark stripe; black boots; an officer's peaked cap with a gold badge. Stern.
 * Skins:        default · field (digital camo field uniform and a maroon beret)
 */
const FIELD = SKIN_ID === 'field';
const ribbons = (g, cx, cy, s) => { const cols = ['#c83030', '#3060c0', '#e0c040', '#30a050', '#ffffff', '#a040a0']; for (let i = 0; i < 6; i++) { g.fillStyle = cols[i]; g.fillRect(cx + s * 0.25 + (i % 3) * s * 0.12, cy - s * 0.18 + Math.floor(i / 3) * s * 0.07, s * 0.11, s * 0.06); } };
CAST({
  body: { voxel: 0.0031 },                      // a coarser grid keeps the sculpt small enough to ship
  pkg: 'man', skin: '#d6a47c',
  clothes: FIELD ? {
    torso: (g, face, W, H) => { B.draw.digital(g, 0, 0, W, H, ['#75735f', '#4e5248', '#99947f', '#34372f'], 0.0125, 7); Wr.shade(g, 0, 0, W, H); if (face === 'front') { Wr.fold(g, [[W / 2, H * 0.08, W / 2, H]], 'rgba(0,0,0,0.35)', 0.005); B.draw.panel(g, W * 0.18, H * 0.18, W * 0.2, H * 0.14, null, 'rgba(0,0,0,0.4)', 0.004); B.draw.panel(g, W * 0.62, H * 0.18, W * 0.2, H * 0.14, null, 'rgba(0,0,0,0.4)', 0.004); } g.fillStyle = '#3a3020'; g.fillRect(0, H * B.D.torsoSplit.waist - 0.012, W, 0.03); },
    arm: (g, part, face, W, H) => { if (face === 'bottom') return; B.draw.digital(g, 0, 0, W, H * 0.8, ['#75735f', '#4e5248', '#99947f', '#34372f'], 0.0125, part === 'armL' ? 3 : 4); },
    leg: (g, part, face, W, H) => { B.draw.digital(g, 0, 0, W, H, ['#75735f', '#4e5248', '#99947f', '#34372f'], 0.0125, part === 'legL' ? 5 : 6); Wr.leg(g, part, face, W, H, { kind: 'none', color: 'rgba(0,0,0,0)', shoes: { kind: 'boot', color: '#3a3628', laces: '#6a6048' } }); }
  } : {
    torso: { kind: 'coat', color: '#56643a', color2: '#d8d2b8', tie: '#3a4024', buttons: 4, buttonColor: '#e0c050', belt: '#5a3a1c', pants: '#4a5632', logo: ribbons },
    arm: { sleeve: 'long', color: '#56643a', cuff: '#4a5632', patch: (g, cx, cy, s) => { g.fillStyle = '#e0c050'; for (let i = 0; i < 3; i++) g.fillRect(cx - s * 0.3, cy + i * s * 0.18, s * 0.6, s * 0.08); } },
    leg: { kind: 'trousers', color: '#4a5632', stripe: '#2e3620', shoes: { kind: 'boot', color: '#141414', sole: '#0a0a0a' } }
  },
  face: { eyes: 'oval', eyeW: 27, eyeH: 44, brows: 'angry', browColor: '#2a1a10', mouth: 'flat', mouthW: 110 },
  faceExtra(g) { g.fillStyle = '#2a1a10'; g.beginPath(); g.moveTo(180, 352); g.quadraticCurveTo(256, 320, 332, 352); g.quadraticCurveTo(300, 362, 256, 348); g.quadraticCurveTo(212, 362, 180, 352); g.fill(); },
  head() {
    A.hair('short', { color: '#2a1a10' });
    if (FIELD) A.beret({ color: '#6a1a24' }); else A.peaked({ color: '#56643a', band: '#2e3620', badge: '#e0c050' });
  }
});
