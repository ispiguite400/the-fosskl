#!/usr/bin/env node
/*
 * FORLORN — the one-file build: the whole game in a single HTML file that opens straight from a
 * phone or a computer's files, no server needed.
 *
 *   node forlorn/tools/bundle.mjs [--out FILE]        (needs esbuild: npm i -g esbuild)
 *
 * The game's code is bundled into one script (three.js included); the styles and fonts go inline;
 * and every asset the game loads (the shipped models, the portraits, the map cards, the JSON lists)
 * rides in the page as base64. A small shim in front of the game answers the game's own fetches
 * from those copies and hands out blob URLs for pictures (src/core/assets.js), so the game code
 * is the same as the served version. Portraits are re-encoded as WebP to save room (the models
 * are shipped files and go in untouched). Writes dist/forlorn.html by default.
 */
import fs from 'fs';
import path from 'path';
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

/* 3. the assets, as base64 blocks the shim reads on demand */
const TYPES = { '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.webp': 'image/webp' };
const assets = [];
const add = (key, bytes, type) => assets.push('<script type="application/x-forlorn" data-path="' + key + '" data-type="' + type + '">' + bytes.toString('base64') + '</script>');
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
  const nodes = {}, bytes = {}, urls = {};
  for (const s of document.querySelectorAll('script[type="application/x-forlorn"]')) nodes[s.dataset.path] = s;
  const keyOf = (u) => { u = String(u && u.url ? u.url : u); const i = u.indexOf('assets/'); return i < 0 ? null : decodeURIComponent(u.slice(i).split(/[?#]/)[0]); };
  const get = (k) => { if (!bytes[k]) { const b = atob(nodes[k].textContent), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); bytes[k] = a; nodes[k].textContent = ''; } return bytes[k]; };
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const k = keyOf(input);
    if (k && nodes[k]) return new Response(get(k), { status: 200, headers: { 'Content-Type': nodes[k].dataset.type } });
    if (k) return new Response('', { status: 404 });
    return real(input, init);
  };
  window.__assetURL = (p) => { const k = keyOf(p); if (!k || !nodes[k]) return p; return urls[k] || (urls[k] = URL.createObjectURL(new Blob([get(k)], { type: nodes[k].dataset.type }))); };
})();`;

/* 5. the page */
let html = fs.readFileSync(rel('index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]*>\s*/g, '').replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '').replace(/<script type="module"[^>]*><\/script>\s*/, '');
// replacement functions, not strings: the code is full of "$'" and "$&", which a string replacement would expand
html = html.replace('</head>', () => '<style>\n' + css + '\n</style>\n</head>');
html = html.replace('</body>', () => assets.join('\n') + '\n<script>' + shim + '</script>\n<script>' + js + '</script>\n</body>');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log('wrote', path.relative(process.cwd(), OUT), (fs.statSync(OUT).size / 1048576).toFixed(1) + ' MB,', assets.length, 'assets inside' + (webp ? ' (portraits as WebP)' : ''));
