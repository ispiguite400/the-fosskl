// ---- palette: multicam uniform, coyote kit, tan boots, black rifle, all with wear and dust ----
const HEX = h => [parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255];
const mix = (a, b, t) => [0,1,2].map(i => a[i] + (b[i] - a[i]) * Math.max(0, Math.min(1, t)));
const P = {
  tan: HEX('#9a8b6b'), sage: HEX('#7f7c5e'), brown: HEX('#5e4b35'), mid: HEX('#7b6a4d'), cream: HEX('#c2b28e'), twig: HEX('#3f3326'),
  coyote: HEX('#7d6849'), coyoteD: HEX('#5f4f37'), web: HEX('#6d5a3f'), strap: HEX('#4e4130'), buckle: HEX('#1c1b19'),
  pad: HEX('#5d5140'), boot: HEX('#9a8360'), sole: HEX('#2e2a25'), lace: HEX('#4a3e2e'),
  glove: HEX('#4a4136'), skin: HEX('#c29776'), lip: HEX('#a06b58'), eye: HEX('#e8e2d8'), rim: HEX('#3a372f'),
  lens: HEX('#0b0d10'), frame: HEX('#17171a'), scarfA: HEX('#a18e6d'), scarfB: HEX('#6e5e47'), rifle: HEX('#222325'),
  belt: HEX('#5b4b35'), dust: HEX('#b5a584')
};
for (const k in P) if (!['lens', 'frame', 'buckle', 'sole', 'rifle'].includes(k)) P[k] = P[k].map(v => Math.min(1, v * 1.13));   // lift the whole palette
const N = (x, y, z, f) => M.clay.noise(x * f, y * f, z * f);
const F = (x, y, z, f, o) => M.clay.fbm(x * f, y * f, z * f, o || 3);
// multicam: a soft tan-to-sage ground, mid-brown shapes, darker brown blobs, cream highlights, fine dark twigs
function multicam(x, y, z) {
  let c = mix(P.tan, P.sage, F(x + 3, y, z, 3.5, 2) * 1.4 - 0.2);
  const m = F(x, y, z, 11), b = F(x + 9, y, z - 4, 17), h = F(x - 5, y + 2, z, 23, 2), tw = N(x + 1, y, z, 60);
  if (m > 0.56) c = mix(c, P.mid, 0.85);
  if (b > 0.62) c = mix(c, P.brown, 0.9);
  if (h > 0.68) c = mix(c, P.cream, 0.7);
  if (tw > 0.78 && b > 0.45) c = mix(c, P.twig, 0.6);
  return c;
}
// the weave of the cloth and dust that builds up towards the ground
function fabric(c, x, y, z, amt) {
  const weave = (N(x, y, z, 700) - 0.5) * 0.06 + (N(x, y, z, 180) - 0.5) * 0.05;
  c = c.map(v => v * (1 + weave));
  const dust = Math.max(0, 0.55 - y) / 0.55 * 0.35 + Math.max(0, F(x, y, z, 14) - 0.6) * 0.5;
  return mix(c, P.dust, dust * (amt === undefined ? 1 : amt));
}
function paintFor(tag, x, y, z, nx, ny, nz) {
  switch (tag) {
    case 'uniform': return fabric(multicam(x, y, z), x, y, z);
    case 'helmet': case 'cover': return fabric(multicam(x * 1.3, y * 1.3, z * 1.3), x, y + 0.6, z, 0.4);
    case 'vest': return fabric(mix(P.coyote, P.coyoteD, N(x, y, z, 40) * 0.5), x, y, z, 0.6);
    case 'pouch': return fabric(mix(P.coyote, P.cream, 0.06 + N(x, y, z, 35) * 0.12), x, y, z, 0.6);
    case 'flap': return fabric(mix(P.coyote, P.coyoteD, 0.25), x, y, z, 0.6);
    case 'webbing': return fabric(P.web, x, y, z, 0.3);
    case 'strap': return fabric(P.strap, x, y, z, 0.3);
    case 'buckle': return P.buckle;
    case 'belt': return fabric(P.belt, x, y, z, 0.4);
    case 'pad': return mix(P.pad, P.dust, Math.max(0, 0.6 - y) * 0.5);
    case 'boot': return fabric(mix(P.boot, P.coyoteD, N(x, y, z, 40) * 0.3), x, y, z, 0.7);
    case 'sole': return P.sole;
    case 'lace': return P.lace;
    case 'glove': return fabric(mix(P.glove, P.coyoteD, N(x, y, z, 70) * 0.3), x, y, z, 0.2);
    case 'skin': return mix(P.skin, [0.62, 0.45, 0.36], N(x, y, z, 120) * 0.25);
    case 'lip': return P.lip;
    case 'eye': return P.eye;
    case 'rim': return P.rim;
    case 'lens': return P.lens;
    case 'frame': return P.frame;
    case 'scarf': {                                   // shemagh check, softly woven
      const a = Math.abs(Math.sin((x + z * 0.5) * 130)), b = Math.abs(Math.sin((y - z * 0.2) * 130));
      return fabric(mix(P.scarfA, P.scarfB, (a > 0.95 ? 0.45 : 0) + (b > 0.95 ? 0.45 : 0) + 0.05), x, y, z, 0.3);
    }
    case 'rifle': return mix(P.rifle, [0.3, 0.3, 0.3], N(x, y, z, 80) * 0.12);
    default: return P.tan;
  }
}
M.clay.autoPaint = paintFor;
