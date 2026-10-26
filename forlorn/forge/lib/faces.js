/*
 * FORLORN — Roblox-style face decals (B.decal draws a 512 x 512 canvas: (256, 256) is the head's
 * centre, one stud is 427 px, the head's bottom is y 508). Proportions follow Guest 1337's
 * measured movie face (STYLE.md): eye centres about 0.35 studs apart, 0.11 above the middle;
 * the mouth low, about 0.28 below it.
 *
 *   Fc.draw(g, { eyes, eyeW, eyeH, gap, eyeY, eyeColor, iris, brows, browColor, mouth, mouthW,
 *                mouthY, lips, blush, freckles, scar, lash, glow })
 *   eyes:  'oval' | 'round' | 'narrow' | 'glow' | 'happy' | 'none'
 *   brows: 'flat' | 'angry' | 'worried' | 'raised' | 'thick' | 'none'
 *   mouth: 'flat' | 'smile' | 'grin' | 'smirk' | 'frown' | 'open' | 'none'
 */
const Fc = {};
Fc.draw = function (g, o) {
  o = Object.assign({ eyes: 'oval', eyeW: 30, eyeH: 50, gap: 74, eyeY: 211, eyeColor: '#121212', brows: 'flat', browColor: '#121212', mouth: 'flat', mouthW: 150, mouthY: 380 }, o || {});
  const ink = o.eyeColor;
  for (const sd of [-1, 1]) {
    const cx = 256 + sd * o.gap, cy = o.eyeY;
    if (o.eyes === 'glow') {
      const halo = g.createRadialGradient(cx, cy, 8, cx, cy, 64); halo.addColorStop(0, o.glow + 'aa'); halo.addColorStop(1, o.glow + '00');
      g.fillStyle = halo; g.beginPath(); g.ellipse(cx, cy, 64, 54, 0, 0, PI * 2); g.fill();
      g.fillStyle = o.glow; g.beginPath(); g.ellipse(cx, cy, o.eyeW * 1.1, o.eyeH * 0.6, sd * 0.3, 0, PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(cx, cy, o.eyeW * 0.5, o.eyeH * 0.26, sd * 0.3, 0, PI * 2); g.fill();
    } else if (o.eyes === 'happy') {
      g.strokeStyle = ink; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.arc(cx, cy + 14, o.eyeW, PI * 1.15, PI * 1.85); g.stroke();
    } else if (o.eyes !== 'none') {
      const w = o.eyes === 'round' ? o.eyeW * 1.1 : o.eyes === 'narrow' ? o.eyeW * 1.15 : o.eyeW, h = o.eyes === 'round' ? o.eyeW * 1.1 : o.eyes === 'narrow' ? o.eyeH * 0.55 : o.eyeH;
      g.fillStyle = ink; g.beginPath(); g.ellipse(cx, cy, w, h, 0, 0, PI * 2); g.fill();
      if (o.iris) { g.fillStyle = o.iris; g.beginPath(); g.ellipse(cx + sd * 2, cy + h * 0.15, w * 0.6, h * 0.55, 0, 0, PI * 2); g.fill(); g.fillStyle = ink; g.beginPath(); g.ellipse(cx + sd * 2, cy + h * 0.18, w * 0.3, h * 0.3, 0, 0, PI * 2); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.ellipse(cx - w * 0.3, cy - h * 0.38, w * 0.26, h * 0.2, 0, 0, PI * 2); g.fill();   // the glint
      if (o.lash) { g.strokeStyle = ink; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx + sd * w * 0.7, cy - h * 0.7); g.lineTo(cx + sd * (w + 18), cy - h * 0.95); g.stroke(); g.beginPath(); g.moveTo(cx + sd * w * 0.95, cy - h * 0.35); g.lineTo(cx + sd * (w + 20), cy - h * 0.5); g.stroke(); }
    }
    // brows
    const bc = o.browColor, by = cy - (o.eyeH || 50) - 18;
    g.strokeStyle = bc; g.lineCap = 'round'; g.lineWidth = o.brows === 'thick' ? 17 : o.lash ? 8 : 11;
    g.beginPath();
    if (o.brows === 'flat' || o.brows === 'thick') { g.moveTo(cx - 30, by + 4); g.lineTo(cx + 30, by + 4); }
    else if (o.brows === 'angry') { g.moveTo(cx + sd * 32, by - 6); g.lineTo(cx - sd * 30, by + 12); }
    else if (o.brows === 'worried') { g.moveTo(cx + sd * 32, by + 10); g.lineTo(cx - sd * 30, by - 6); }
    else if (o.brows === 'raised') { g.moveTo(cx - 30, by + 2); g.quadraticCurveTo(cx, by - 14, cx + 30, by + 2); }
    if (o.brows !== 'none') g.stroke();
  }
  // the mouth
  const mx = 256, my = o.mouthY, mw = o.mouthW / 2;
  g.strokeStyle = o.mouthColor || '#121212'; g.fillStyle = o.mouthColor || '#121212'; g.lineWidth = 11; g.lineCap = 'round';
  g.beginPath();
  if (o.mouth === 'flat') { g.moveTo(mx - mw, my); g.lineTo(mx + mw, my - 6); g.stroke(); }
  else if (o.mouth === 'smile') { g.moveTo(mx - mw, my - 12); g.quadraticCurveTo(mx, my + 26, mx + mw, my - 12); g.stroke(); }
  else if (o.mouth === 'smirk') { g.moveTo(mx - mw, my + 4); g.quadraticCurveTo(mx + mw * 0.3, my + 10, mx + mw, my - 16); g.stroke(); }
  else if (o.mouth === 'frown') { g.moveTo(mx - mw, my + 10); g.quadraticCurveTo(mx, my - 18, mx + mw, my + 10); g.stroke(); }
  else if (o.mouth === 'grin') { g.moveTo(mx - mw, my - 14); g.quadraticCurveTo(mx, my + 40, mx + mw, my - 14); g.closePath(); g.fill(); g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(mx - mw * 0.8, my - 8); g.quadraticCurveTo(mx, my + 8, mx + mw * 0.8, my - 8); g.lineTo(mx + mw * 0.7, my - 2); g.quadraticCurveTo(mx, my + 14, mx - mw * 0.7, my - 2); g.fill(); }
  else if (o.mouth === 'open') { g.ellipse(mx, my, mw * 0.45, 22, 0, 0, PI * 2); g.fill(); }
  if (o.lips && o.mouth !== 'none') { g.strokeStyle = o.lips; g.lineWidth = 5; g.beginPath(); g.moveTo(mx - mw * 0.7, my - 4); g.quadraticCurveTo(mx, my + 14, mx + mw * 0.7, my - 4); g.stroke(); }
  if (o.blush) { g.fillStyle = o.blush; for (const sd of [-1, 1]) { g.beginPath(); g.ellipse(256 + sd * 118, o.eyeY + 78, 34, 16, 0, 0, PI * 2); g.fill(); } }
  if (o.freckles) { g.fillStyle = o.freckles; for (const sd of [-1, 1]) for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(256 + sd * (92 + (i % 3) * 18), o.eyeY + 72 + Math.floor(i / 3) * 16 + (i % 2) * 6, 4.5, 0, PI * 2); g.fill(); } }
  if (o.scar) { const sd = o.scar === 'left' ? 1 : -1, cx = 256 + sd * o.gap; g.strokeStyle = o.scarColor || '#b02020'; g.lineWidth = 9; g.beginPath(); g.moveTo(cx - 22, o.eyeY - 90); g.lineTo(cx + 26, o.eyeY + 80); g.stroke(); for (let i = 0; i < 3; i++) { const t = 0.25 + i * 0.25, x = cx - 22 + 48 * t, y = o.eyeY - 90 + 170 * t; g.lineWidth = 5; g.beginPath(); g.moveTo(x - 14, y + 3); g.lineTo(x + 14, y - 3); g.stroke(); } }
};
