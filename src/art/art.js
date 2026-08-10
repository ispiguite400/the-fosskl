/* Procedural 2D artwork.
 *
 * The menus need large painterly backdrops and a lot of item icons. Rather
 * than ship binaries, everything here is painted into a canvas at load time
 * and handed out as a data URL.
 *
 * If you drop your own images into assets/images/ they win — see ART_FILES.
 * Missing files fall back to the generated art silently. */

import { makeRNG, clamp, lerp, fbm, hsl2hex } from '../core/util.js';

/** Optional user overrides. Drop files with these names to replace the art. */
export const ART_FILES = {
  loading: 'assets/images/loading.jpg',
  menu:    'assets/images/menu.jpg'
};

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Try a real image first; fall back to the generator. */
export function resolveArt(key, generator, w, h) {
  const file = ART_FILES[key];
  if (!file) return Promise.resolve(get(key, generator, w, h));
  return new Promise(res => {
    const img = new Image();
    img.onload = () => res(file);
    img.onerror = () => res(get(key, generator, w, h));
    img.src = file;
  });
}

export function get(key, generator, w = 1920, h = 1080) {
  if (cache.has(key)) return cache.get(key);
  const c = canvas(w, h);
  generator(c.getContext('2d'), w, h, makeRNG(hash(key)));
  const url = c.toDataURL('image/jpeg', .9);
  cache.set(key, url);
  return url;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ---------- shared painting helpers ---------- */

function vGrad(ctx, w, h, stops) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const [p, c] of stops) g.addColorStop(p, c);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

/** Warm/cold sun with layered bloom. */
function sun(ctx, x, y, r, inner = '#fff6d8', outer = 'rgba(255,150,40,0)') {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, inner);
  g.addColorStop(.12, 'rgba(255,226,150,.95)');
  g.addColorStop(.34, 'rgba(255,164,60,.42)');
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

/** One ridge of mountains from fbm, filled flat (silhouette). */
function ridgeLine(ctx, w, h, baseY, amp, freq, color, seed, alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 3) {
    const n = fbm(x * freq + seed, seed * .37, 5, 2.1, .52);
    const y = baseY + n * amp + fbm(x * freq * 3.1 + seed, 9.1, 3) * amp * .22;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h); ctx.closePath(); ctx.fill(); ctx.restore();
}

/** Volumetric-ish fog band. */
function fogBand(ctx, w, y, thickness, alpha, rng, tint = '255,238,214') {
  ctx.save();
  for (let i = 0; i < 26; i++) {
    const cx = rng.range(-.15, 1.15) * w;
    const cy = y + rng.range(-thickness, thickness) * .5;
    const rx = rng.range(.18, .55) * w, ry = thickness * rng.range(.3, .9);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    g.addColorStop(0, `rgba(${tint},${alpha * rng.range(.5, 1)})`);
    g.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** A conifer, drawn as stacked triangles — reads well in silhouette. */
function conifer(ctx, x, baseY, hgt, color, lean = 0) {
  ctx.save(); ctx.fillStyle = color;
  ctx.translate(x, baseY); ctx.rotate(lean);
  const wdt = hgt * .26;
  ctx.fillRect(-hgt * .012, -hgt * .12, hgt * .024, hgt * .12);
  const tiers = 7;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const y = -hgt * (.1 + t * .9);
    const ww = wdt * (1 - t) * 1.05 + hgt * .012;
    const hh = hgt * .21;
    ctx.beginPath();
    ctx.moveTo(0, y - hh);
    ctx.lineTo(-ww, y);
    ctx.lineTo(-ww * .35, y);
    ctx.lineTo(-ww * .55, y + hh * .28);
    ctx.lineTo(ww * .55, y + hh * .28);
    ctx.lineTo(ww * .35, y);
    ctx.lineTo(ww, y);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/* Grain + a subtle chromatic vignette; makes flat gradients read as photo. */
function finish(ctx, w, h, { grain = .035, vig = .55 } = {}) {
  const g = ctx.createRadialGradient(w / 2, h * .46, Math.min(w, h) * .22, w / 2, h * .5, Math.max(w, h) * .78);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${vig})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - .5) * 255 * grain;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  ctx.putImageData(id, 0, 0);
}

/* ============================================================
   LOADING BACKDROP — sunlit ridgeline above a sea of fog,
   conifers in the foreground catching godrays.
   ============================================================ */
export function paintLoading(ctx, w, h, rng) {
  vGrad(ctx, w, h, [
    [0,   '#2b3a52'],
    [.16, '#6d6a73'],
    [.3,  '#c98a4b'],
    [.42, '#f0ad55'],
    [.55, '#e8933f'],
    [.72, '#8a5a34'],
    [1,   '#20160f']
  ]);

  const sx = w * .27, sy = h * .28;
  sun(ctx, sx, sy, h * .62);

  // Cloud deck above the sun.
  ctx.save();
  for (let i = 0; i < 30; i++) {
    const cy = rng.range(0, .26) * h;
    const cx = rng.range(-.1, 1.1) * w;
    const rx = rng.range(.1, .34) * w, ry = rng.range(.012, .05) * h;
    const a = rng.range(.06, .3);
    const g = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
    g.addColorStop(0, `rgba(255,190,120,${a})`);
    g.addColorStop(1, `rgba(60,40,50,${a * .8})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, rng.range(-.05, .05), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // Distant snow ridges, progressively warmer and darker toward camera.
  ridgeLine(ctx, w, h, h * .34, h * .10, .0016, 'rgba(120,116,140,.55)', 11, .8);
  ridgeLine(ctx, w, h, h * .38, h * .09, .0021, 'rgba(96,90,112,.7)', 23, .85);
  fogBand(ctx, w, h * .44, h * .1, .5, rng, '255,224,186');
  ridgeLine(ctx, w, h, h * .43, h * .08, .0029, 'rgba(70,58,64,.9)', 41);
  fogBand(ctx, w, h * .5, h * .09, .55, rng, '255,206,150');
  ridgeLine(ctx, w, h, h * .52, h * .07, .0037, 'rgba(48,36,36,.95)', 67);
  fogBand(ctx, w, h * .58, h * .08, .45, rng, '255,178,110');

  // Godrays fanning from the sun.
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 16; i++) {
    const a = rng.range(-1.15, 1.15);
    const len = h * rng.range(.7, 1.5);
    const wide = rng.range(.008, .05) * w;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(a + Math.PI / 2);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(255,206,140,${rng.range(.05, .16)})`);
    g.addColorStop(1, 'rgba(255,180,90,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-wide * .25, 0);
    ctx.lineTo(wide, len); ctx.lineTo(-wide * 1.4, len); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // Forest — three depth layers.
  const layers = [
    { y: .70, h: .13, n: 46, c: 'rgba(58,40,28,.85)' },
    { y: .82, h: .2,  n: 34, c: 'rgba(34,22,16,.93)' },
    { y: 1.0, h: .34, n: 22, c: '#150d0a' }
  ];
  for (const L of layers) {
    for (let i = 0; i < L.n; i++) {
      const x = rng.range(-.03, 1.03) * w;
      conifer(ctx, x, h * L.y + rng.range(-.01, .02) * h,
        h * L.h * rng.range(.6, 1.35), L.c, rng.range(-.03, .03));
    }
  }
  fogBand(ctx, w, h * .72, h * .07, .28, rng, '255,168,96');
  finish(ctx, w, h, { vig: .5 });
}

/* ============================================================
   MAIN MENU BACKDROP — samurai cavalry charging out of a dust
   cloud against a low sun.
   ============================================================ */
export function paintMenu(ctx, w, h, rng) {
  vGrad(ctx, w, h, [
    [0,   '#3a1a08'],
    [.14, '#7a3208'],
    [.3,  '#c2560d'],
    [.46, '#f08a1e'],
    [.6,  '#d9701a'],
    [.78, '#8c4413'],
    [1,   '#2a1206']
  ]);

  const sx = w * .5, sy = h * .49;
  sun(ctx, sx, sy, h * .58, '#fff3c8');

  // Turbulent cloud ceiling — mackerel sky, lit from below.
  ctx.save();
  for (let i = 0; i < 220; i++) {
    const cy = Math.pow(rng(), 1.7) * h * .38;
    const cx = rng.range(-.05, 1.05) * w;
    const rx = rng.range(.02, .1) * w, ry = rng.range(.006, .026) * h;
    const lit = 1 - cy / (h * .4);
    const a = rng.range(.1, .4);
    ctx.fillStyle = `rgba(${Math.round(lerp(90, 255, lit))},${Math.round(lerp(40, 150, lit))},${Math.round(lerp(30, 60, lit))},${a})`;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, rng.range(-.2, .2), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // Treeline haloed by the sun.
  ctx.save(); ctx.globalAlpha = .55;
  for (let i = 0; i < 40; i++) {
    const x = rng.range(.28, .72) * w;
    conifer(ctx, x, h * .62, h * rng.range(.1, .22), 'rgba(40,16,6,.75)');
  }
  ctx.restore();

  // Dust: the whole charge is kicking up a wall of it.
  fogBand(ctx, w, h * .66, h * .16, .5, rng, '255,180,90');
  fogBand(ctx, w, h * .78, h * .18, .42, rng, '230,140,60');

  /* --- cavalry silhouettes --- */
  const horse = (x, y, s, alpha) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#170a04';
    ctx.translate(x, y); ctx.scale(s, s);

    /* --- horse ---
       Barrel is long and shallow, chest deeper than the flank, legs in a
       gallop with the near pair extended. Everything is one flat fill so
       it reads as a silhouette against the sun. */
    ctx.beginPath();
    ctx.moveTo(-44, -62);                                   // croup
    ctx.quadraticCurveTo(-10, -72, 26, -66);                // topline
    ctx.quadraticCurveTo(44, -62, 46, -50);                 // withers
    ctx.quadraticCurveTo(44, -34, 24, -32);                 // chest/girth
    ctx.quadraticCurveTo(-6, -26, -30, -34);                // belly
    ctx.quadraticCurveTo(-46, -40, -44, -62);               // haunch
    ctx.closePath(); ctx.fill();

    // haunch mass
    ctx.beginPath(); ctx.ellipse(-32, -50, 20, 18, .1, 0, Math.PI * 2); ctx.fill();

    // neck: a wedge from the withers up to the poll
    ctx.beginPath();
    ctx.moveTo(28, -64); ctx.lineTo(56, -100);
    ctx.lineTo(68, -98); ctx.lineTo(44, -56); ctx.closePath(); ctx.fill();

    // head, jaw and ears
    ctx.beginPath();
    ctx.moveTo(56, -100); ctx.lineTo(78, -108); ctx.lineTo(82, -100);
    ctx.lineTo(66, -92); ctx.lineTo(58, -93); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(58, -104); ctx.lineTo(59, -112); ctx.lineTo(64, -103); ctx.fill();
    ctx.beginPath(); ctx.moveTo(64, -105); ctx.lineTo(66, -113); ctx.lineTo(70, -104); ctx.fill();

    // mane along the crest
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      ctx.beginPath();
      ctx.moveTo(30 + t * 26, -66 - t * 32);
      ctx.lineTo(24 + t * 26, -76 - t * 34);
      ctx.lineTo(34 + t * 26, -70 - t * 32);
      ctx.closePath(); ctx.fill();
    }

    /* legs: upper, lower, hoof — the pairs are offset for a gallop */
    const leg = (lx, ly, a1, a2, upper, lower) => {
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(a1);
      ctx.fillRect(-4.5, 0, 9, upper);
      ctx.translate(0, upper); ctx.rotate(a2);
      ctx.fillRect(-3.4, 0, 6.8, lower);
      ctx.translate(0, lower);
      ctx.fillRect(-4.2, 0, 8.4, 5);
      ctx.restore();
    };
    // far pair (slightly darker read via the shared fill, drawn first)
    leg(-24, -40, -.30, .78, 28, 26);
    leg(26, -40, .62, -.52, 26, 26);
    // near pair, extended
    leg(-30, -42, -.72, .52, 30, 28);
    leg(30, -40, 1.05, .18, 27, 26);

    // tail streaming back
    ctx.beginPath();
    ctx.moveTo(-42, -62);
    ctx.quadraticCurveTo(-70, -60, -86, -34);
    ctx.quadraticCurveTo(-72, -44, -62, -46);
    ctx.quadraticCurveTo(-50, -48, -40, -52);
    ctx.closePath(); ctx.fill();

    /* --- rider --- */
    // seat and thigh over the saddle
    ctx.beginPath(); ctx.ellipse(-4, -72, 17, 10, -.08, 0, Math.PI * 2); ctx.fill();
    // torso leaning into the charge
    ctx.save(); ctx.translate(-2, -80); ctx.rotate(-.16);
    ctx.beginPath(); ctx.ellipse(0, -8, 13, 19, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // head
    ctx.beginPath(); ctx.arc(2, -104, 8, 0, Math.PI * 2); ctx.fill();
    // kabuto: bowl, flared shikoro, twin kuwagata horns
    ctx.beginPath();
    ctx.moveTo(-9, -106); ctx.quadraticCurveTo(2, -121, 13, -106);
    ctx.lineTo(17, -97); ctx.lineTo(-13, -97); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-6, -114); ctx.lineTo(-13, -130); ctx.lineTo(-1, -117); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(9, -114); ctx.lineTo(16, -130); ctx.lineTo(4, -117); ctx.closePath(); ctx.fill();

    // arm reaching to the yari
    ctx.save(); ctx.translate(6, -88); ctx.rotate(-.9);
    ctx.fillRect(-3.5, 0, 7, 20); ctx.restore();

    // yari, held upright and slightly back
    ctx.save(); ctx.translate(10, -90); ctx.rotate(-.30);
    ctx.fillRect(-2, -86, 4, 104);
    ctx.beginPath();
    ctx.moveTo(0, -102); ctx.lineTo(5.5, -84); ctx.lineTo(-5.5, -84); ctx.closePath(); ctx.fill();
    ctx.restore();

    // sashimono banner on the back
    ctx.save(); ctx.translate(-16, -88); ctx.rotate(.16);
    ctx.fillRect(-1.6, -40, 3.2, 42);
    ctx.globalAlpha = alpha * .8;
    ctx.fillRect(1.6, -38, 13, 22);
    ctx.restore();
    ctx.restore();
  };

  // Back rank (hazy), then the front rank (crisp).
  const ranks = [
    { y: .705, s: .58, n: 9,  a: .42 },
    { y: .755, s: .78, n: 8,  a: .62 },
    { y: .82,  s: 1.0, n: 7,  a: .86 },
    { y: .9,   s: 1.32, n: 5, a: 1 }
  ];
  const unit = h / 620;
  for (const R of ranks) {
    for (let i = 0; i < R.n; i++) {
      const x = ((i + .5) / R.n) * w + rng.range(-.045, .045) * w;
      horse(x, h * R.y, R.s * unit * 1.25, R.a);
    }
  }

  // Ground dust catching the light in front of the charge.
  fogBand(ctx, w, h * .93, h * .11, .5, rng, '255,150,70');
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, h * .72);
  g.addColorStop(0, 'rgba(255,190,110,.3)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.restore();

  finish(ctx, w, h, { vig: .48, grain: .03 });
}

/* ============================================================
   CLASS PANEL ARTS — one tall painting per class.
   ============================================================ */

const PANEL_PAINTERS = {
  /* torii + shrine at dusk with red maples */
  shrine(ctx, w, h, rng) {
    vGrad(ctx, w, h, [[0, '#2a1230'], [.3, '#6d2140'], [.55, '#b23a3f'], [.8, '#3d1526'], [1, '#150912']]);
    sun(ctx, w * .62, h * .26, h * .2, '#ffe9d0');
    ridgeLine(ctx, w, h, h * .42, h * .06, .004, 'rgba(40,18,32,.8)', 3);
    // pagoda
    ctx.fillStyle = '#160a12';
    const px = w * .5, py = h * .74, pw = w * .42;
    for (let i = 0; i < 4; i++) {
      const t = i / 4, yy = py - i * h * .1, ww = pw * (1 - t * .28);
      ctx.beginPath();
      ctx.moveTo(px - ww / 2, yy); ctx.quadraticCurveTo(px, yy - h * .045, px + ww / 2, yy);
      ctx.lineTo(px + ww * .38, yy + h * .022); ctx.lineTo(px - ww * .38, yy + h * .022);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(px - ww * .2, yy + h * .02, ww * .4, h * .085);
    }
    // lit windows
    ctx.fillStyle = 'rgba(255,180,90,.75)';
    for (let i = 0; i < 8; i++) ctx.fillRect(px - pw * .16 + (i % 4) * pw * .1, py - Math.floor(i / 4) * h * .1 + h * .04, pw * .05, h * .03);
    // maple canopy
    for (let i = 0; i < 900; i++) {
      const x = rng.range(0, 1) * w, y = rng.range(.02, .42) * h;
      ctx.fillStyle = `rgba(${rng.int(180, 255)},${rng.int(30, 90)},${rng.int(40, 80)},${rng.range(.3, .9)})`;
      ctx.fillRect(x, y, rng.range(2, 7), rng.range(2, 6));
    }
    finish(ctx, w, h, { vig: .45 });
  },

  /* mist-soaked bamboo grove */
  bamboo(ctx, w, h, rng) {
    vGrad(ctx, w, h, [[0, '#c9dfa8'], [.35, '#88b16a'], [.7, '#3f6a3a'], [1, '#16301c']]);
    for (let d = 0; d < 3; d++) {
      const n = 26 - d * 6, alpha = .3 + d * .28;
      for (let i = 0; i < n; i++) {
        const x = rng.range(-.05, 1.05) * w, ww = (2 + d * 4) * (w / 400);
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.fillStyle = `hsl(${rng.int(70, 100)},${30 + d * 14}%,${40 - d * 12}%)`;
        ctx.fillRect(x, 0, ww, h);
        ctx.fillStyle = 'rgba(0,0,0,.28)';
        for (let y = rng.range(0, .1) * h; y < h; y += h * rng.range(.08, .14)) ctx.fillRect(x, y, ww, 2.5);
        ctx.restore();
      }
      fogBand(ctx, w, h * (.3 + d * .2), h * .22, .34, rng, '235,248,225');
    }
    for (let i = 0; i < 500; i++) {
      const x = rng.range(0, 1) * w, y = rng.range(0, 1) * h;
      ctx.fillStyle = `rgba(${rng.int(120, 200)},${rng.int(180, 240)},${rng.int(90, 150)},${rng.range(.2, .7)})`;
      ctx.save(); ctx.translate(x, y); ctx.rotate(rng.range(0, 6.28));
      ctx.fillRect(0, 0, rng.range(8, 26), rng.range(1.5, 3.5)); ctx.restore();
    }
    finish(ctx, w, h, { vig: .4 });
  },

  /* weathered stone temple, dawn */
  temple(ctx, w, h, rng) {
    vGrad(ctx, w, h, [[0, '#d9c39a'], [.4, '#c7a878'], [.75, '#6b5741'], [1, '#2b2119']]);
    sun(ctx, w * .5, h * .18, h * .26, '#fff8e0');
    ctx.fillStyle = '#4a3d2e';
    const bx = w * .5, by = h * .82;
    // stepped stupa
    for (let i = 0; i < 7; i++) {
      const t = i / 7, ww = w * (.66 - t * .5), hh = h * .07;
      ctx.fillStyle = `hsl(36,14%,${28 + i * 3}%)`;
      ctx.fillRect(bx - ww / 2, by - i * hh * .95 - hh, ww, hh);
      ctx.fillStyle = 'rgba(0,0,0,.2)';
      for (let k = 0; k < 9; k++) ctx.fillRect(bx - ww / 2 + k * ww / 9, by - i * hh * .95 - hh, 1.5, hh);
    }
    // doorway
    ctx.fillStyle = '#0d0a07';
    ctx.beginPath();
    ctx.moveTo(bx - w * .07, by); ctx.lineTo(bx - w * .07, by - h * .16);
    ctx.quadraticCurveTo(bx, by - h * .22, bx + w * .07, by - h * .16);
    ctx.lineTo(bx + w * .07, by); ctx.closePath(); ctx.fill();
    // stone plaza
    ctx.fillStyle = '#7a6750'; ctx.fillRect(0, by, w, h - by);
    ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1.4;
    for (let y = by; y < h; y += h * .035) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    finish(ctx, w, h, { vig: .42 });
  },

  /* open sea at sunrise */
  ocean(ctx, w, h, rng) {
    vGrad(ctx, w, h, [[0, '#12224a'], [.2, '#7a2f5a'], [.34, '#e8483a'], [.42, '#ffb347'], [.48, '#ffe9a8'],
                      [.53, '#2f7fb8'], [.75, '#1553a0'], [1, '#06214d']]);
    sun(ctx, w * .5, h * .47, h * .16, '#fffdf0');
    for (let i = 0; i < 900; i++) {
      const y = rng.range(.5, 1) * h;
      const t = (y / h - .5) * 2;
      const ww = rng.range(6, 60) * (.3 + t * 2);
      const x = rng.range(-.05, 1.05) * w;
      const glow = Math.exp(-Math.pow((x - w * .5) / (w * .16 * (1 + t * 3)), 2));
      ctx.fillStyle = `rgba(${Math.round(lerp(120, 255, glow))},${Math.round(lerp(200, 240, glow))},255,${rng.range(.15, .6)})`;
      ctx.fillRect(x, y, ww, rng.range(1.5, 4) * (.5 + t));
    }
    finish(ctx, w, h, { vig: .4 });
  },

  /* deep-space nebula */
  nebula(ctx, w, h, rng) {
    ctx.fillStyle = '#05030f'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const cx = rng.range(0, 1) * w, cy = rng.range(0, 1) * h, r = rng.range(.1, .5) * w;
      const hue = rng.pick([265, 285, 320, 205, 350, 240]);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `hsla(${hue},85%,58%,${rng.range(.05, .17)})`);
      g.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.29); ctx.fill();
    }
    for (let i = 0; i < 2600; i++) {
      const x = rng.range(0, 1) * w, y = rng.range(0, 1) * h, s = Math.pow(rng(), 7) * 4 + .4;
      const hue = rng.pick([0, 30, 200, 220, 55, 300]);
      ctx.fillStyle = `hsla(${hue},${rng.int(0, 70)}%,${rng.int(70, 100)}%,${rng.range(.3, 1)})`;
      ctx.beginPath(); ctx.arc(x, y, s, 0, 6.29); ctx.fill();
      if (s > 2.6) {
        ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = .7; ctx.globalAlpha = .55;
        ctx.beginPath(); ctx.moveTo(x - s * 4, y); ctx.lineTo(x + s * 4, y);
        ctx.moveTo(x, y - s * 4); ctx.lineTo(x, y + s * 4); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    finish(ctx, w, h, { vig: .5, grain: .02 });
  },

  /* dune sea at noon */
  desert(ctx, w, h, rng) {
    vGrad(ctx, w, h, [[0, '#8fc4e8'], [.28, '#e3d0a8'], [.42, '#e0b976'], [.7, '#b8813f'], [1, '#5c3a19']]);
    sun(ctx, w * .68, h * .2, h * .22, '#fffbe8');
    for (let i = 0; i < 8; i++) {
      const y = h * (.4 + i * .075);
      ctx.save(); ctx.fillStyle = `hsl(${34 - i}, ${52 - i * 2}%, ${64 - i * 5}%)`;
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) {
        ctx.lineTo(x, y + fbm(x * .002 + i * 9, i * 3, 4) * h * .05);
      }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill(); ctx.restore();
    }
    finish(ctx, w, h, { vig: .38 });
  },

  /* snow peaks under aurora */
  snow(ctx, w, h, rng) {
    vGrad(ctx, w, h, [[0, '#050b1e'], [.3, '#12315c'], [.6, '#4b6f96'], [.8, '#9fb6cc'], [1, '#e6eef6']]);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 16; i++) {
      const x = rng.range(-.1, 1.1) * w, y = rng.range(.02, .3) * h;
      const g = ctx.createLinearGradient(x, y, x + rng.range(-.2, .2) * w, y + h * .3);
      g.addColorStop(0, `hsla(${rng.int(120, 180)},80%,60%,${rng.range(.1, .3)})`);
      g.addColorStop(1, 'hsla(180,80%,60%,0)');
      ctx.fillStyle = g; ctx.fillRect(x - w * .06, y, w * .12, h * .34);
    }
    ctx.restore();
    ridgeLine(ctx, w, h, h * .5, h * .16, .0022, '#cfdcea', 5);
    ridgeLine(ctx, w, h, h * .62, h * .12, .0035, '#eef4fa', 15);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(255,255,255,${rng.range(.2, .9)})`;
      ctx.beginPath(); ctx.arc(rng.range(0, 1) * w, rng.range(0, 1) * h, rng.range(.6, 2.6), 0, 6.29); ctx.fill();
    }
    finish(ctx, w, h, { vig: .4 });
  },

  /* savanna, acacia, hard sun */
  savanna(ctx, w, h, rng) {
    vGrad(ctx, w, h, [[0, '#f6c86a'], [.3, '#e79b3c'], [.5, '#c9752c'], [.62, '#9c7a34'], [1, '#4a3a17']]);
    sun(ctx, w * .5, h * .42, h * .3, '#fff4c8');
    ctx.fillStyle = '#c79a45'; ctx.fillRect(0, h * .6, w, h * .4);
    const acacia = (x, y, s) => {
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = '#20170a';
      ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-2, -60); ctx.lineTo(2, -60); ctx.lineTo(4, 0); ctx.fill();
      for (const a of [-.7, -.3, .3, .7]) {
        ctx.save(); ctx.rotate(a); ctx.fillRect(-1.5, -100, 3, 46); ctx.restore();
      }
      ctx.beginPath(); ctx.ellipse(0, -104, 52, 15, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-24, -114, 26, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(26, -112, 24, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };
    const u = h / 500;
    acacia(w * .24, h * .78, u * 1.5); acacia(w * .74, h * .72, u * 1.1); acacia(w * .5, h * .95, u * 2.1);
    for (let i = 0; i < 2200; i++) {
      const y = rng.range(.6, 1) * h;
      ctx.strokeStyle = `hsla(${rng.int(36, 52)},${rng.int(40, 70)}%,${rng.int(30, 62)}%,${rng.range(.25, .8)})`;
      ctx.lineWidth = rng.range(.7, 2);
      const x = rng.range(0, 1) * w, len = rng.range(6, 28) * (y / h);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rng.range(-5, 5), y - len); ctx.stroke();
    }
    finish(ctx, w, h, { vig: .4 });
  },

  /* alpine ridges above the cloud layer */
  peaks(ctx, w, h, rng) {
    vGrad(ctx, w, h, [[0, '#1b2b4d'], [.3, '#5f7fa8'], [.5, '#c9b39a'], [.7, '#8f7f74'], [1, '#2b2622']]);
    sun(ctx, w * .3, h * .3, h * .3);
    ridgeLine(ctx, w, h, h * .34, h * .16, .0018, 'rgba(150,160,185,.7)', 7);
    fogBand(ctx, w, h * .5, h * .1, .6, rng, '245,240,235');
    ridgeLine(ctx, w, h, h * .5, h * .16, .0028, 'rgba(80,80,96,.92)', 19);
    fogBand(ctx, w, h * .66, h * .1, .5, rng, '235,228,220');
    ridgeLine(ctx, w, h, h * .68, h * .16, .0042, '#241f1e', 37);
    finish(ctx, w, h, { vig: .44 });
  },

  /* fortress kingdom on a crag */
  kingdom(ctx, w, h, rng) {
    vGrad(ctx, w, h, [[0, '#2b1a3f'], [.3, '#6a3050'], [.5, '#b9603c'], [.68, '#6a4030'], [1, '#170f12']]);
    sun(ctx, w * .74, h * .44, h * .2, '#ffeccc');
    ridgeLine(ctx, w, h, h * .56, h * .1, .003, 'rgba(40,26,40,.85)', 13);
    // castle keep
    ctx.fillStyle = '#120c12';
    const cx = w * .46, base = h * .78;
    ctx.fillRect(cx - w * .2, base - h * .2, w * .4, h * .2);
    for (let i = 0; i < 5; i++) {
      const tx = cx - w * .2 + i * w * .1;
      ctx.fillRect(tx - w * .02, base - h * .34, w * .04, h * .14);
      ctx.beginPath();
      ctx.moveTo(tx - w * .032, base - h * .34); ctx.lineTo(tx, base - h * .43);
      ctx.lineTo(tx + w * .032, base - h * .34); ctx.closePath(); ctx.fill();
    }
    ctx.fillRect(cx - w * .06, base - h * .46, w * .12, h * .26);
    ctx.beginPath();
    ctx.moveTo(cx - w * .085, base - h * .46); ctx.lineTo(cx, base - h * .6);
    ctx.lineTo(cx + w * .085, base - h * .46); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,190,110,.8)';
    for (let i = 0; i < 22; i++) {
      ctx.fillRect(cx - w * .18 + rng.range(0, .36) * w, base - rng.range(.02, .42) * h, w * .008, h * .016);
    }
    ctx.fillStyle = '#0a0709'; ctx.fillRect(0, base, w, h - base);
    finish(ctx, w, h, { vig: .46 });
  },

  /* islands adrift above the cloud sea */
  skyland(ctx, w, h, rng) {
    vGrad(ctx, w, h, [[0, '#79b4d8'], [.3, '#a9d4e2'], [.55, '#d9e9e6'], [.78, '#a8c4c4'], [1, '#5d7f88']]);
    fogBand(ctx, w, h * .68, h * .18, .7, rng, '255,255,255');
    const island = (x, y, s, alpha) => {
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.scale(s, s);
      ctx.fillStyle = '#5c4a38';
      ctx.beginPath();
      ctx.moveTo(-70, 0); ctx.lineTo(70, 0);
      ctx.quadraticCurveTo(46, 48, 12, 96); ctx.quadraticCurveTo(-6, 60, -46, 34);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4f8a3e';
      ctx.beginPath(); ctx.ellipse(0, -4, 72, 15, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3f7233';
      for (let i = 0; i < 9; i++) {
        const tx = rng.range(-60, 60);
        ctx.beginPath(); ctx.arc(tx, -14 - rng.range(0, 10), rng.range(5, 12), 0, 6.29); ctx.fill();
      }
      ctx.restore();
    };
    const u = h / 620;
    island(w * .48, h * .5, u * 2.4, 1);
    island(w * .16, h * .38, u * 1.1, .7);
    island(w * .84, h * .58, u * 1.4, .8);
    island(w * .3, h * .74, u * .8, .5);
    // rainbow arc
    ctx.save(); ctx.globalAlpha = .28; ctx.lineWidth = h * .012;
    ['#ff4d4d', '#ffa64d', '#ffe14d', '#66e07a', '#4dc3ff', '#8a6bff'].forEach((c, i) => {
      ctx.strokeStyle = c;
      ctx.beginPath(); ctx.arc(w * .62, h * .82, h * (.3 + i * .013), Math.PI * 1.12, Math.PI * 1.9); ctx.stroke();
    });
    ctx.restore();
    finish(ctx, w, h, { vig: .34 });
  }
};

export function classArt(name, w = 520, h = 1200) {
  const painter = PANEL_PAINTERS[name] || PANEL_PAINTERS.shrine;
  return get('panel:' + name, painter, w, h);
}

export const loadingArt = () => get('loading', paintLoading, 1920, 1080);
export const menuArt = () => get('menu', paintMenu, 1920, 1080);

/* ============================================================
   GEAR MOTIF for the main menu (SVG string, crisp at any size)
   ============================================================ */
export function gearsSVG() {
  const gear = (cx, cy, r, teeth, rot, op) => {
    const ri = r * .62, rt = r * 1.24, hole = r * .3;
    let d = '';
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2, step = (Math.PI * 2 / teeth);
      const a1 = a0 + step * .22, a2 = a0 + step * .30, a3 = a0 + step * .70, a4 = a0 + step * .78;
      const pt = (a, rr) => `${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`;
      d += (i === 0 ? 'M' : 'L') + pt(a0, r) + 'L' + pt(a1, r) + 'L' + pt(a2, rt) +
           'L' + pt(a3, rt) + 'L' + pt(a4, r);
    }
    d += 'Z';
    return `<g transform="rotate(${rot} ${cx} ${cy})" opacity="${op}">
      <path d="${d}" fill="#0d0906"/>
      <circle cx="${cx}" cy="${cy}" r="${ri}" fill="none" stroke="#0d0906" stroke-width="${r * .16}"/>
      <circle cx="${cx}" cy="${cy}" r="${hole}" fill="#0d0906"/>
    </g>`;
  };
  return `<svg viewBox="0 0 600 900" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    ${gear(400, 320, 150, 12, 0, .9)}
    ${gear(455, 590, 185, 14, 12, .8)}
    ${gear(268, 470, 82, 10, 24, .55)}
  </svg>`;
}

/* ============================================================
   ITEM ICONS — small canvases, tinted per weapon type.
   ============================================================ */
const ICON = 96;

function iconBase() {
  const c = canvas(ICON, ICON);
  return [c, c.getContext('2d')];
}

/** Draws a blade shape with the player's chosen metal + handle colours. */
export function itemIcon(item, colors) {
  const key = `icon:${item.id}:${colors ? colors.blade.h + '_' + colors.blade.s + '_' + colors.blade.l + '_' + colors.handle.h + '_' + colors.handle.s + '_' + colors.handle.l : 'n'}`;
  if (cache.has(key)) return cache.get(key);

  const [c, ctx] = iconBase();
  const metal = colors ? hsl2hex(colors.blade.h, colors.blade.s, colors.blade.l) : '#cfd6dd';
  const metalDark = colors ? hsl2hex(colors.blade.h, colors.blade.s, colors.blade.l * .55) : '#7c848c';
  const grip = colors ? hsl2hex(colors.handle.h, colors.handle.s, colors.handle.l) : '#4a2a18';
  const gripLt = colors ? hsl2hex(colors.handle.h, colors.handle.s, Math.min(.95, colors.handle.l * 1.6)) : '#7a4526';

  ctx.save();
  ctx.translate(ICON / 2, ICON / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.lineJoin = 'round';

  const shade = (x, y, w, h, a, b) => {
    const g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, a); g.addColorStop(.45, b); g.addColorStop(1, a);
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  };

  switch (item.icon || item.kind) {
    case 'katana': {
      // curved blade
      ctx.beginPath();
      ctx.moveTo(-4, 26); ctx.quadraticCurveTo(-2, -12, 5, -40);
      ctx.lineTo(9, -38); ctx.quadraticCurveTo(4, -10, 3, 26); ctx.closePath();
      const g = ctx.createLinearGradient(-6, 0, 10, 0);
      g.addColorStop(0, metalDark); g.addColorStop(.5, metal); g.addColorStop(1, '#ffffff');
      ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = '#0b0b0d'; ctx.fillRect(-9, 24, 18, 4);      // tsuba
      shade(-4, 28, 8, 24, grip, gripLt);                           // tsuka
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.2;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath(); ctx.moveTo(-4, 31 + i * 4.4); ctx.lineTo(4, 34 + i * 4.4); ctx.stroke();
      }
      break;
    }
    case 'sword': {
      ctx.beginPath();
      ctx.moveTo(0, -44); ctx.lineTo(6, -32); ctx.lineTo(6, 22); ctx.lineTo(-6, 22);
      ctx.lineTo(-6, -32); ctx.closePath();
      const g = ctx.createLinearGradient(-7, 0, 7, 0);
      g.addColorStop(0, metalDark); g.addColorStop(.5, '#fff'); g.addColorStop(.55, metal); g.addColorStop(1, metalDark);
      ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = metalDark; ctx.fillRect(-15, 22, 30, 5);
      shade(-4, 27, 8, 20, grip, gripLt);
      ctx.fillStyle = metal; ctx.beginPath(); ctx.arc(0, 49, 5, 0, 6.29); ctx.fill();
      break;
    }
    case 'axe': {
      shade(-3, -14, 6, 60, grip, gripLt);
      ctx.beginPath();
      ctx.moveTo(2, -18); ctx.quadraticCurveTo(30, -22, 26, 6);
      ctx.quadraticCurveTo(16, -4, 2, -2); ctx.closePath();
      ctx.fillStyle = metal; ctx.fill();
      ctx.strokeStyle = metalDark; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-2, -18); ctx.quadraticCurveTo(-26, -20, -22, 4);
      ctx.quadraticCurveTo(-14, -4, -2, -2); ctx.closePath();
      ctx.fillStyle = metalDark; ctx.fill();
      break;
    }
    case 'bow': {
      ctx.strokeStyle = grip; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(6, 0, 34, Math.PI * .62, Math.PI * 1.38); ctx.stroke();
      ctx.strokeStyle = '#e8e2d4'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-15, -30); ctx.lineTo(-15, 30); ctx.stroke();
      ctx.strokeStyle = metal; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(30, 0); ctx.stroke();
      ctx.fillStyle = metal;
      ctx.beginPath(); ctx.moveTo(34, 0); ctx.lineTo(26, -5); ctx.lineTo(26, 5); ctx.fill();
      break;
    }
    case 'crossbow': {
      shade(-4, -26, 8, 52, grip, gripLt);
      ctx.fillStyle = metalDark; ctx.fillRect(-30, -6, 60, 7);
      ctx.strokeStyle = '#e8e2d4'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-30, -3); ctx.lineTo(0, 8); ctx.lineTo(30, -3); ctx.stroke();
      ctx.fillStyle = metal; ctx.fillRect(-2, -34, 4, 30);
      ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(-5, -32); ctx.lineTo(5, -32); ctx.fill();
      break;
    }
    case 'knife': {
      ctx.beginPath();
      ctx.moveTo(0, -38); ctx.lineTo(6, -22); ctx.lineTo(5, 12); ctx.lineTo(-5, 12); ctx.lineTo(-6, -22);
      ctx.closePath();
      const g = ctx.createLinearGradient(-6, 0, 6, 0);
      g.addColorStop(0, metalDark); g.addColorStop(.5, '#fff'); g.addColorStop(1, metal);
      ctx.fillStyle = g; ctx.fill();
      shade(-4, 12, 8, 22, grip, gripLt);
      ctx.fillStyle = metalDark; ctx.fillRect(-8, 10, 16, 3);
      break;
    }
    case 'shield': {
      ctx.beginPath();
      ctx.moveTo(0, -36); ctx.lineTo(26, -24); ctx.lineTo(26, 12);
      ctx.quadraticCurveTo(20, 34, 0, 42); ctx.quadraticCurveTo(-20, 34, -26, 12);
      ctx.lineTo(-26, -24); ctx.closePath();
      const g = ctx.createLinearGradient(-26, -36, 26, 42);
      g.addColorStop(0, metal); g.addColorStop(1, metalDark);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = grip; ctx.lineWidth = 5; ctx.stroke();
      ctx.fillStyle = grip;
      ctx.beginPath(); ctx.arc(0, 2, 8, 0, 6.29); ctx.fill();
      break;
    }
    case 'bomb': {
      const g = ctx.createRadialGradient(-8, -10, 2, 0, 0, 30);
      g.addColorStop(0, '#5c5c66'); g.addColorStop(1, '#16161c');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 6, 26, 0, 6.29); ctx.fill();
      ctx.fillStyle = grip; ctx.fillRect(-6, -24, 12, 8);
      ctx.strokeStyle = '#b8964e'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, -24); ctx.quadraticCurveTo(14, -36, 8, -46); ctx.stroke();
      ctx.fillStyle = '#ffb03a';
      ctx.beginPath(); ctx.arc(8, -48, 5, 0, 6.29); ctx.fill();
      ctx.fillStyle = 'rgba(255,220,120,.5)';
      ctx.beginPath(); ctx.arc(8, -48, 10, 0, 6.29); ctx.fill();
      break;
    }
    case 'potion': {
      ctx.fillStyle = 'rgba(210,235,245,.35)';
      ctx.beginPath();
      ctx.moveTo(-7, -30); ctx.lineTo(7, -30); ctx.lineTo(7, -14);
      ctx.quadraticCurveTo(24, 2, 20, 22); ctx.quadraticCurveTo(16, 42, 0, 42);
      ctx.quadraticCurveTo(-16, 42, -20, 22); ctx.quadraticCurveTo(-24, 2, -7, -14);
      ctx.closePath(); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = item.tint || '#d8342e';
      ctx.fillRect(-24, 4, 48, 44);
      ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(-24, 4, 48, 4);
      ctx.restore();
      ctx.fillStyle = grip; ctx.fillRect(-9, -38, 18, 10);
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.beginPath(); ctx.ellipse(-9, 16, 3.5, 13, .3, 0, 6.29); ctx.fill();
      break;
    }
    case 'key': {
      ctx.strokeStyle = '#e2b544'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, -20, 14, 0, 6.29); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, 40); ctx.stroke();
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(0, 24); ctx.lineTo(13, 24); ctx.moveTo(0, 34); ctx.lineTo(11, 34); ctx.stroke();
      break;
    }
    case 'coin': {
      const g = ctx.createRadialGradient(-8, -8, 2, 0, 0, 30);
      g.addColorStop(0, '#ffe9a0'); g.addColorStop(.6, '#e0b040'); g.addColorStop(1, '#8a5f14');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 28, 0, 6.29); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 21, 0, 6.29); ctx.stroke();
      ctx.fillStyle = '#7a5210'; ctx.fillRect(-4, -12, 8, 24); ctx.fillRect(-12, -4, 24, 8);
      break;
    }
    case 'food': {
      ctx.fillStyle = '#e8d8b0';
      ctx.beginPath(); ctx.ellipse(0, 4, 26, 20, 0, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.ellipse(0, -2, 18, 11, 0, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#e8d8b0';
      ctx.beginPath(); ctx.ellipse(-6, -6, 5, 3, .3, 0, 6.29); ctx.fill();
      break;
    }
    default: {
      ctx.fillStyle = metal;
      ctx.beginPath(); ctx.arc(0, 0, 24, 0, 6.29); ctx.fill();
      ctx.fillStyle = metalDark;
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, 6.29); ctx.fill();
    }
  }

  ctx.restore();

  // Fire enchant glow.
  if (item.element === 'fire') {
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(ICON / 2, ICON / 2, 4, ICON / 2, ICON / 2, ICON / 2);
    g.addColorStop(0, 'rgba(255,140,30,.55)');
    g.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, ICON, ICON);
    ctx.globalCompositeOperation = 'source-over';
  }

  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

/** Wipes cached weapon icons so a colour change re-renders them. */
export function clearIconCache() {
  for (const k of [...cache.keys()]) if (k.startsWith('icon:')) cache.delete(k);
}
