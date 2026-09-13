#!/usr/bin/env bash
# Regenerate every generated asset, validate, and package the .mcaddon.
set -euo pipefail
cd "$(dirname "$0")"

echo "== generating art, models and audio =="
python3 tools/gen_entities.py
python3 tools/gen_player_models.py
python3 -c "import sys;sys.path.insert(0,'tools');import gen_entities as g;g.build_armour()"
python3 tools/gen_art.py
python3 -c "import sys;sys.path.insert(0,'tools');import gen_art as a;a.gen_animated()"
[ "${SKIP_AUDIO:-0}" = "1" ] || python3 tools/gen_audio.py

echo "== generating pack definitions =="
python3 tools/gen_rp.py
python3 tools/gen_bp_entities.py
python3 tools/gen_bp_content.py

echo "== validating =="
python3 tools/validate.py

echo "== packaging =="
mkdir -p dist
rm -f dist/StillLife.mcaddon dist/StillLife_BP.mcpack dist/StillLife_RP.mcpack
( cd packs && zip -qr ../dist/StillLife.mcaddon StillLife_BP StillLife_RP \
    -x '*/__pycache__/*' '*.DS_Store' )
( cd packs/StillLife_BP && zip -qr ../../dist/StillLife_BP.mcpack . -x '*.DS_Store' )
( cd packs/StillLife_RP && zip -qr ../../dist/StillLife_RP.mcpack . -x '*.DS_Store' )
ls -lh dist/
echo "done."
