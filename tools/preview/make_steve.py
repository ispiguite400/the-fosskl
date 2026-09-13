"""A stand-in Minecraft player skin, for LOCAL PREVIEW RENDERS ONLY.

This file is never packaged. The add-on ships no player texture -- The Copy
and The Tall One both point at the game's own `textures/entity/steve`. This
exists purely so tools/render.py can draw those two for the docs images.
"""
import os, sys
from PIL import Image
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from gen_player_models import PARTS
from gen_entities import face_rects

HAIR = (0x33, 0x24, 0x18); SKIN = (0xB4, 0x84, 0x6C); SKIN_D = (0x9C, 0x6E, 0x53)
SHIRT = (0x00, 0xA0, 0xA0); PANTS = (0x40, 0x40, 0x8C); SHOE = (0x58, 0x59, 0x5B)
COL = {"head": SKIN, "hat": HAIR, "body": SHIRT,
       "rightArm": SKIN, "leftArm": SKIN, "rightLeg": PANTS, "leftLeg": PANTS}
SHADE = {"up": 1.10, "down": 0.66, "north": 1.0, "south": 0.88,
         "east": 0.82, "west": 0.94}


def main():
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    px = img.load()
    for name, piv, org, size, uv, inf, mir in PARTS:
        base = COL[name]
        # Real Steve has NO hat-layer content -- the hair is painted into the
        # head itself and the whole overlay is transparent. Match that, or the
        # preview shows a solid box where the face should be.
        if inf:
            continue
        w, h, d = size
        for f, (x, y, fw, fh) in face_rects(uv[0], uv[1], w, h, d).items():
            for j in range(fh):
                for i in range(fw):
                    c = base
                    if name in ("rightLeg", "leftLeg") and f != "up" and j >= fh - 2:
                        c = SHOE
                    if name in ("rightArm", "leftArm") and f != "down" and j < 4:
                        c = SHIRT
                    k = SHADE[f]
                    px[x + i, y + j] = (int(c[0] * k), int(c[1] * k), int(c[2] * k), 255)
    # the face
    hx, hy, hw, hh = face_rects(0, 0, 8, 8, 8)["north"]
    for (ex, sc) in ((1, True), (2, False), (5, False), (6, True)):
        px[hx + ex, hy + 4] = (0xF0, 0xEE, 0xE6, 255) if sc else (0x33, 0x2C, 0x66, 255)
    for i in range(2, 6):
        px[hx + i, hy + 6] = (0x76, 0x50, 0x3C, 255)
    # hair painted into the head, not onto an overlay
    for f, (x, y, fw, fh) in face_rects(0, 0, 8, 8, 8).items():
        rows = fh if f == "up" else (2 if f in ("north", "east", "west") else 3)
        for j in range(rows):
            for i in range(fw):
                k = SHADE[f]
                px[x + i, y + j] = (int(HAIR[0] * k), int(HAIR[1] * k),
                                    int(HAIR[2] * k), 255)
    for (ex, sc) in ((1, True), (2, False), (5, False), (6, True)):
        px[hx + ex, hy + 4] = (0xF0, 0xEE, 0xE6, 255) if sc else (0x33, 0x2C, 0x66, 255)
    for i in range(2, 6):
        px[hx + i, hy + 6] = (0x76, 0x50, 0x3C, 255)
    out = os.path.join(os.path.dirname(__file__), "steve_reference.png")
    img.save(out)
    print("preview-only skin ->", os.path.relpath(out))


if __name__ == "__main__":
    main()
