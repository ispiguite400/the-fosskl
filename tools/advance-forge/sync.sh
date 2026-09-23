#!/bin/sh
# Refresh the plugin's copies of the app and the player from the tools beside it.
#   tools/sculpt  -> skills/advance-forge/app/sculpt.html   (rebuilt first)
#   tools/anim    -> skills/advance-forge/app/player.html
set -e
here="$(cd "$(dirname "$0")" && pwd)"
tools="$(dirname "$here")"
node "$tools/sculpt/build.js"
cp "$tools/sculpt/sculpt.html" "$here/skills/advance-forge/app/sculpt.html"
cp "$tools/anim/index.html" "$here/skills/advance-forge/app/player.html"
echo "synced app and player into $here/skills/advance-forge/app"
node "$here/skills/advance-forge/scripts/forge.mjs" doctor
