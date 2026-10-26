/*
 * FORLORN — the common shape of a cast build script, joined after the kits:
 *
 *   CAST({ pkg, skin, clothes: { torso, arm, leg }, face, head(), extras(), attach, glowFace })
 *
 * torso / arm / leg are Wr option objects (or functions (g, part, face, W, H) to draw by hand);
 * face is Fc options (or a function (g) to draw the decal); head() builds the accessories.
 */
function CAST(o) {
  const D = B.setup({ pkg: o.pkg || 'robloxian2', over: o.over });
  const SKINC = HEX(o.skin || '#f2f2f0');
  B.clothes(function (g, part, face, W, H) {
    const c = o.clothes;
    if (part === 'torso') return typeof c.torso === 'function' ? c.torso(g, face, W, H) : Wr.torso(g, face, W, H, c.torso);
    if (part.startsWith('arm')) return typeof c.arm === 'function' ? c.arm(g, part, face, W, H) : Wr.arm(g, part, face, W, H, c.arm);
    return typeof c.leg === 'function' ? c.leg(g, part, face, W, H) : Wr.leg(g, part, face, W, H, c.leg);
  });
  B.decal(function (g) { if (typeof o.face === 'function') o.face(g); else Fc.draw(g, o.face); if (o.faceExtra) o.faceExtra(g); });
  C.autoPaint = function (tag, x, y, z, nx, ny, nz) {
    if (tag === 'torso' || tag === 'arm' || tag === 'leg') return B.clothColor(x, y, z, nx, ny, nz, SKINC);
    if (tag === 'face') return B.faceColor(x, y, z, SKINC);
    if (o.paint) { const c = o.paint(tag, x, y, z, nx, ny, nz); if (c) return c; }
    return A.paint(tag, x, y, z, nx, ny, nz) || [1, 0, 1];
  };
  B.body(o.body || {});
  { const Hh = C.newObject('Head'); T('face', 0); B.headForm(0); C.build(0.0018, 1, Hh); }
  const attach = [];
  if (o.head) { const a = o.head(); if (a) attach.push(...[].concat(a)); }
  B.finish(o.finish || {});
  B.joints(attach);
  return D;
}
