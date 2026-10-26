/*
 * BACON SOLDIER — minion. The Empire's rank and file, called in by the General (The Last Guest).
 * Look:         Robloxian 2.0; light skin; brown Bacon hair under a blue steel helmet; the
 *               Empire's blue tunic with a black belt; black trousers; black boots. Blank-eyed.
 * Triangles:    3,000 (a crowd of them can be on screen).
 */
CAST({
  body: { voxel: 0.0031 },                      // a coarser grid keeps the sculpt small enough to ship
  skin: '#f0d0b0',
  clothes: {
    torso: { kind: 'tee', color: '#2c4a8a', collar: 'shirt', color2: '#22396e', buttons: 4, buttonColor: '#141416', pocket: 'chest', belt: '#101010', pants: '#141416', tuck: true },
    arm: { sleeve: 'long', color: '#2c4a8a', cuff: '#22396e', glove: '#141416' },
    leg: { kind: 'trousers', color: '#141416', shoes: { kind: 'boot', color: '#0e0e10' } }
  },
  face: { eyes: 'oval', eyeW: 26, eyeH: 40, brows: 'flat', mouth: 'flat', mouthW: 90 },
  head() { A.hair('short', { color: '#7a4a28' }); A.helmet({ color: '#2c4a7a', band: '#101010' }); }
});
