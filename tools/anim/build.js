#!/usr/bin/env node
/*
 * Writes player.html: index.html with the rigged soldier embedded, so it
 * opens straight from the file system (a page on file:// cannot fetch the
 * GLB beside it). index.html itself stays small and loads the GLB when served.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const here = __dirname;
const page = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
const glb = fs.readFileSync(path.join(here, process.argv[2] || 'soldier_rigged.glb')).toString('base64');
const out = page.replace('<script>\n\'use strict\';', '<script>window.EMBEDDED_GLB = "' + glb + '";</script>\n<script>\n\'use strict\';');
if (out === page) throw new Error('Could not find the player script to embed before');
fs.writeFileSync(path.join(here, 'player.html'), out);
console.log('player.html written: ' + Math.round(out.length / 1024) + ' KB');
