/*
 * EMILY — survivor. The new girl at Robloxian High (Guest 666).
 * Look:         slim Robloxian 2.0; light skin; long black hair with a straight fringe; a
 *               lavender crop top; black high-waisted jeans; black boots. Quiet, wary eyes.
 * Skins:        default · formal (the school dance: a lavender dress, flats)
 */
const FORMAL = SKIN_ID === 'formal';
CAST({
  pkg: 'slim', skin: '#f2d8c4',
  clothes: FORMAL ? {
    torso: { kind: 'tee', color: '#a890f0', collar: 'v', pants: '#a890f0', belt: '#6a50c0' },
    arm: { sleeve: 'none' },
    leg: { kind: 'skirt', color: '#a890f0', shoes: { kind: 'flat', color: '#3a2a6a', sole: '#2a1a4a' } }
  } : {
    torso: { kind: 'crop', color: '#b4a2ff', collar: 'crew', pants: '#1a1a20' },
    arm: { sleeve: 'short', color: '#b4a2ff' },
    leg: { kind: 'jeans', color: '#1c1c22', shoes: { kind: 'boot', color: '#141414', laces: '#3a3a3a' } }
  },
  face: { eyes: 'oval', eyeW: 28, eyeH: 46, lash: true, brows: 'worried', browColor: '#1a1a1a', mouth: 'flat', mouthW: 90, lips: '#b06a7a' },
  head() { A.hair('long', { color: '#141416', len: 0.6 }); }
});
