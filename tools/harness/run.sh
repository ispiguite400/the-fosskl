#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/../.."
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/node_modules/@minecraft/server" "$WORK/node_modules/@minecraft/server-ui" "$WORK/scripts"
echo '{"type":"module"}' > "$WORK/package.json"
echo '{"name":"@minecraft/server","version":"1.13.0","type":"module","main":"index.js"}' \
  > "$WORK/node_modules/@minecraft/server/package.json"
echo '{"name":"@minecraft/server-ui","version":"1.2.0","type":"module","main":"index.js"}' \
  > "$WORK/node_modules/@minecraft/server-ui/package.json"
cp "$HERE/stubs/server.js"    "$WORK/node_modules/@minecraft/server/index.js"
cp "$HERE/stubs/server-ui.js" "$WORK/node_modules/@minecraft/server-ui/index.js"
cp "$ROOT"/packs/StillLife_BP/scripts/*.js "$WORK/scripts/"
cp "$HERE/run.mjs" "$WORK/"
cd "$WORK" && node run.mjs
