// ---- palette: multicam uniform, coyote kit, tan boots, black rifle ----
const HEX = h => [parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255];
const mix = (a, b, t) => [0,1,2].map(i => a[i] + (b[i] - a[i]) * t);
const P = {
  base: HEX('#8e7e60'), dark: HEX('#5c4f38'), mid: HEX('#766748'), light: HEX('#ac9b78'), olive: HEX('#6f6c4b'),
  coyote: HEX('#7c6748'), coyoteD: HEX('#65543a'), pad: HEX('#5f523d'), boot: HEX('#8d7657'), sole: HEX('#34302a'),
  glove: HEX('#4a4135'), skin: HEX('#c29776'), lip: HEX('#a06b58'), eye: HEX('#e8e2d8'), rim: HEX('#3a372f'),
  lens: HEX('#0c0e11'), frame: HEX('#17171a'), scarfA: HEX('#9c8a6b'), scarfB: HEX('#6f5f48'), rifle: HEX('#232426'),
  belt: HEX('#5a4b35')
};
function multicam(x, y, z) {
  const n1 = M.clay.fbm(x * 9, y * 9, z * 9, 3), n2 = M.clay.fbm(x * 21 + 7, y * 21, z * 21, 2), n3 = M.clay.noise(x * 45, y * 45, z * 45);
  let c = P.base;
  if (n1 > 0.58) c = P.mid;
  if (n1 < 0.4) c = P.light;
  if (n2 > 0.66) c = P.dark;
  if (n2 < 0.28) c = P.olive;
  return mix(c, [0.5, 0.45, 0.36], (n3 - 0.5) * 0.12);
}
function grime(c, x, y, z, amt) { const n = M.clay.fbm(x * 30, y * 30, z * 30, 2); return mix(c, [0.25, 0.22, 0.18], Math.max(0, n - 0.55) * (amt || 0.5)); }
function paintFor(tag, x, y, z, nx, ny, nz) {
  if ((tag === 'boot' || tag === 'sole') && y < 0.2) tag = y < 0.03 ? 'sole' : 'boot';   // a clean line where the upper meets the sole
  switch (tag) {
    case 'uniform': return grime(multicam(x, y, z), x, y, z, 0.6);
    case 'helmet': case 'cover': return multicam(x * 1.3, y * 1.3, z * 1.3);
    case 'vest': return grime(mix(P.coyote, P.coyoteD, M.clay.noise(x*60, y*60, z*60) * 0.5), x, y, z);
    case 'pouch': return grime(mix(P.coyote, P.light, 0.08 + M.clay.noise(x*50, y*50, z*50) * 0.12), x, y, z);
    case 'belt': return P.belt;
    case 'pad': return P.pad;
    case 'boot': return grime(mix(P.boot, P.coyoteD, M.clay.noise(x*40, y*40, z*40) * 0.3), x, y, z, 0.3);
    case 'sole': return P.sole;
    case 'glove': return mix(P.glove, P.coyoteD, M.clay.noise(x*70, y*70, z*70) * 0.3);
    case 'skin': return mix(P.skin, [0.62, 0.45, 0.36], M.clay.noise(x*120, y*120, z*120) * 0.25);
    case 'lip': return P.lip;
    case 'eye': return P.eye;
    case 'rim': return P.rim;
    case 'lens': return P.lens;
    case 'frame': return P.frame;
    case 'scarf': {                                   // shemagh check
      const a = Math.abs(Math.sin((x + z * 0.5) * 130)), b = Math.abs(Math.sin((y - z * 0.2) * 130));
      return grime(mix(P.scarfA, P.scarfB, (a > 0.96 ? 0.45 : 0) + (b > 0.96 ? 0.45 : 0) + 0.05), x, y, z, 0.3);
    }
    case 'rifle': return mix(P.rifle, [0.3, 0.3, 0.3], M.clay.noise(x*80, y*80, z*80) * 0.12);
    default: return P.base;
  }
}
