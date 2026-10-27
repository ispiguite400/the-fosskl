#!/usr/bin/env node
/*
 * FORLORN — the one-file build: the whole game in a single HTML file that opens straight from a
 * phone or a computer's files, no server needed.
 *
 *   node forlorn/tools/bundle.mjs [--out FILE]        (needs esbuild: npm i -g esbuild)
 *
 * The game's code is bundled into one script (three.js included); the styles and fonts go inline;
 * and every asset the game loads (the shipped models, the portraits, the map cards, the JSON lists)
 * rides in the page as text. A small shim in front of the game answers the game's own fetches
 * from those copies and hands out blob URLs for pictures (src/core/assets.js), so the game code
 * is the same as the served version. Portraits are re-encoded as WebP to save room.
 *
 * Keeping it small without changing the game:
 *   - models and JSON are gzipped (lossless: the browser unpacks the exact bytes ship.mjs wrote,
 *     with DecompressionStream, or vendor/fflate-gunzip.js where that is missing);
 *   - binary goes in as base-125 text, 6 bytes in 7 characters (base64 takes 8): every character is
 *     one byte of ASCII, leaving out only the carriage return and '<', which the HTML parser would
 *     change or read as a tag;
 *   - the shim keeps only the packed bytes and unpacks a model each time the game asks for it (the
 *     game keeps what it asked for), and the game skips its boot-time preload of every model.
 * Writes dist/forlorn.html by default.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname), GAME = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);
let esbuild;
for (const p of ['esbuild', '/opt/node22/lib/node_modules/esbuild', '/usr/local/lib/node_modules/esbuild', '/usr/lib/node_modules/esbuild']) { try { esbuild = require(p); break; } catch { /* next */ } }
if (!esbuild) { console.error('needs esbuild: npm i -g esbuild'); process.exit(1); }
const argv = process.argv.slice(2), oi = argv.indexOf('--out');
const OUT = oi >= 0 ? path.resolve(argv[oi + 1]) : path.join(GAME, 'dist/forlorn.html');
const rel = (p) => path.join(GAME, p);

/* 1. the code: one script, three.js and its addons resolved the way the import map does */
const js = (await esbuild.build({
  entryPoints: [rel('src/main.js')], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020', legalComments: 'none',
  alias: { three: rel('vendor/three.module.js') },
  plugins: [{ name: 'addons', setup(b) { b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: rel('vendor/addons/' + a.path.slice('three/addons/'.length)) })); } }]
})).outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

/* 2. the styles, with the fonts inside them */
const fonts = fs.readFileSync(rel('css/fonts.css'), 'utf8').replace(/url\(\.\.\/(assets\/fonts\/[^)]+)\)/g, (m, p) => 'url(data:font/woff2;base64,' + fs.readFileSync(rel(p)).toString('base64') + ')');
const css = fonts + '\n' + fs.readFileSync(rel('css/forlorn.css'), 'utf8');

/* 3. the assets, as base-125 text blocks the shim reads on demand */
const TYPES = { '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.webp': 'image/webp' };
// the alphabet: ASCII 1-127 without CR (13) and '<' (60); the shim has the same list
const ALPHA = []; for (let c = 1; c < 128; c++) if (c !== 13 && c !== 60) ALPHA.push(c);
function b125(bytes) {
  const groups = Math.ceil(bytes.length / 6), out = Buffer.allocUnsafe(groups * 7);
  for (let g = 0; g < groups; g++) {
    let v = 0;
    for (let k = 5; k >= 0; k--) v = v * 256 + (bytes[g * 6 + k] || 0);       // little-endian 48 bits, exact in a double
    for (let k = 0; k < 7; k++) { const q = Math.floor(v / 125); out[g * 7 + k] = ALPHA[v - q * 125]; v = q; }
  }
  return out.toString('latin1');
}
const assets = [];
let rawTotal = 0, packedTotal = 0;
// pictures stay as they are (they are already compressed, and the page needs them without waiting); the rest is gzipped
const add = (key, bytes, type) => {
  const zip = !type.startsWith('image/');
  const body = zip ? zlib.gzipSync(bytes, { level: 9 }) : bytes;
  rawTotal += bytes.length; packedTotal += body.length;
  assets.push('<script type="application/x-forlorn" data-path="' + key + '" data-type="' + type + '" data-n="' + body.length + '"' + (zip ? ' data-z="1"' : '') + '>' + b125(body) + '</script>');
};
const each = (dir, exts) => fs.existsSync(rel(dir)) ? fs.readdirSync(rel(dir)).filter((f) => exts.includes(path.extname(f))).sort() : [];
for (const f of each('assets/models', ['.glb', '.json'])) add('assets/models/' + f, fs.readFileSync(rel('assets/models/' + f)), TYPES[path.extname(f)]);
for (const f of each('assets/maps', ['.jpg'])) add('assets/maps/' + f, fs.readFileSync(rel('assets/maps/' + f)), TYPES['.jpg']);
for (const f of each('assets/music', ['.json'])) add('assets/music/' + f, fs.readFileSync(rel('assets/music/' + f)), TYPES['.json']);
const renders = each('assets/renders', ['.png', '.json']);
let webp = false;
try { execFileSync('python3', ['-c', 'import PIL']); webp = true; } catch { /* keep the PNGs */ }
for (const f of renders) {
  const src = rel('assets/renders/' + f);
  if (webp && f.endsWith('.png')) {
    const out = execFileSync('python3', ['-c', 'import sys,io;from PIL import Image;b=io.BytesIO();Image.open(sys.argv[1]).save(b,"WEBP",quality=86,method=6);sys.stdout.buffer.write(b.getvalue())', src], { maxBuffer: 64 << 20 });
    add('assets/renders/' + f, out, TYPES['.webp']);
  } else add('assets/renders/' + f, fs.readFileSync(src), TYPES[path.extname(f)]);
}

/* 4. the shim: answer fetches and picture addresses from the copies above */
const shim = `(() => {
  const nodes = {}, packed = {}, urls = {};
  for (const s of document.querySelectorAll('script[type="application/x-forlorn"]')) nodes[s.dataset.path] = s;
  const DEC = new Uint8Array(128); let d = 0; for (let c = 1; c < 128; c++) if (c !== 13 && c !== 60) DEC[c] = d++;
  // base-125 text back to bytes: 7 characters, 6 bytes
  const decode = (s, n) => {
    const out = new Uint8Array(Math.ceil(n / 6) * 6);
    for (let i = 0, o = 0; i < s.length; i += 7, o += 6) {
      let v = 0;
      for (let k = 6; k >= 0; k--) v = v * 125 + DEC[s.charCodeAt(i + k)];
      for (let k = 0; k < 6; k++) { const q = Math.floor(v / 256); out[o + k] = v - q * 256; v = q; }
    }
    return out.subarray(0, n);
  };
  // the stored bytes, read once from the page (the text is let go)
  const take = (k) => { if (!packed[k]) { const s = nodes[k]; packed[k] = decode(s.textContent, +s.dataset.n); s.textContent = ''; } return packed[k]; };
  const unzip = async (b) => typeof DecompressionStream === 'function'
    ? new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
    : __fflate.gunzipSync(b);
  const keyOf = (u) => { u = String(u && u.url ? u.url : u); const i = u.indexOf('assets/'); return i < 0 ? null : decodeURIComponent(u.slice(i).split(/[?#]/)[0]); };
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const k = keyOf(input);
    if (k && nodes[k]) {
      const n = nodes[k], b = take(k), body = n.dataset.z ? await unzip(b) : b.slice();
      return new Response(body, { status: 200, headers: { 'Content-Type': n.dataset.type } });
    }
    if (k) return new Response('', { status: 404 });
    return real(input, init);
  };
  window.__assetURL = (p) => {
    const k = keyOf(p); if (!k || !nodes[k] || nodes[k].dataset.z) return p;
    if (!urls[k]) { urls[k] = URL.createObjectURL(new Blob([take(k)], { type: nodes[k].dataset.type })); delete packed[k]; }
    return urls[k];
  };
  window.__oneFile = true;
})();`;

/* 5. the page */
let html = fs.readFileSync(rel('index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]*>\s*/g, '').replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '').replace(/<script type="module"[^>]*><\/script>\s*/, '');
// replacement functions, not strings: the code is full of "$'" and "$&", which a string replacement would expand
html = html.replace('</head>', () => '<style>\n' + css + '\n</style>\n</head>');
const gunzip = fs.readFileSync(rel('vendor/fflate-gunzip.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
html = html.replace('</body>', () => assets.join('\n') + '\n<script>' + gunzip + '</script>\n<script>' + shim + '</script>\n<script>' + js + '</script>\n</body>');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log('wrote', path.relative(process.cwd(), OUT), (fs.statSync(OUT).size / 1048576).toFixed(1) + ' MB,', assets.length, 'assets inside' + (webp ? ' (portraits as WebP)' : '') +
  ': ' + (rawTotal / 1048576).toFixed(1) + ' MB of assets, ' + (packedTotal / 1048576).toFixed(1) + ' MB packed');
