#!/usr/bin/env node
/*
 * FORLORN — stamp the shipped models and menu portraits with a short hash of their contents.
 *   node forlorn/forge/stamp.mjs        (make.mjs and renders.mjs run it for you)
 * Writes assets/models/index.json and assets/renders/index.json as { name: hash }. The game
 * reads them at boot: a model's list says it is shipped, and its hash goes on the end of its
 * address, so a browser fetches a rebuilt model or portrait instead of showing a cached old one.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const GAME = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function stampDir(dir, ext) {
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort()) {
    out[f.slice(0, -ext.length)] = crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, f))).digest('hex').slice(0, 10);
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(out, null, 1) + '\n');
  return out;
}

export function stamp() {
  return { models: stampDir(path.join(GAME, 'assets/models'), '.glb'), renders: stampDir(path.join(GAME, 'assets/renders'), '.png') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const s = stamp();
  console.log('stamped', Object.keys(s.models).length, 'models and', Object.keys(s.renders).length, 'portraits');
}
