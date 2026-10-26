/*
 * MATT — survivor. Guest's best friend (The Last Guest), in his own clothes.
 * Look:         Robloxian 2.0; light skin; short brown hair; a red pullover hoodie, hood down,
 *               kangaroo pocket; dark-wash jeans; white sneakers with a red flash. A steady face.
 * Skins:        default · war (Great War olive tunic and puttees, a brodie helmet)
 * Triangles:    4,500.
 */
const WAR = SKIN_ID === 'war';
CAST({
  body: WAR ? { voxel: 0.0031 } : {},             // the helmet's extra piece needs a smaller sculpt to ship
  skin: '#f0d0b0',
  clothes: WAR ? {
    torso: { kind: 'tee', color: '#5d6236', collar: 'shirt', color2: '#6a6e40', buttons: 4, buttonColor: '#a08850', pocket: 'chest', belt: '#4a3420', pants: '#4f5430' },
    arm: { sleeve: 'long', color: '#5d6236', cuff: '#4f5430' },
    leg: { kind: 'trousers', color: '#4f5430', shoes: { kind: 'boot', color: '#3a2a1c', sole: '#1a1410' } }
  } : {
    torso: { kind: 'hoodie', color: '#b8302a', collar: 'hood', trim: '#f0e8e0', pocket: 'kanga', pants: '#2a3a5a' },
    arm: { sleeve: 'long', color: '#b8302a', cuff: '#92241f' },
    leg: { kind: 'jeans', color: '#2c3d5e', shoes: { kind: 'sneaker', color: '#f2f2ee', sole: '#e8e8e4', laces: '#d8d8d4', accent: '#c4372f' } }
  },
  face: { eyes: 'oval', brows: 'flat', mouth: 'smile', mouthW: 120 },
  head() {
    if (WAR) { A.hair('short', { color: '#5a3a22' }); A.helmet({ color: '#5a5e3a' }); }
    else A.hair('short', { color: '#5a3a22' });
  }
});
