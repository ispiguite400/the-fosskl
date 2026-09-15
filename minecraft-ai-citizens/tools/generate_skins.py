#!/usr/bin/env python3
"""
Procedural player-skin generator for the AI Citizens add-on.

Writes 64x64 Minecraft player-format skins (with the second/overlay layer) plus
the two pack icons. Pure standard library - no Pillow required.

Usage:
    python3 tools/generate_skins.py [output_dir]

Default output_dir is packs/AI_Citizens_RP/textures/entity/ai_citizen
"""

import os
import random
import struct
import sys
import zlib

W = H = 64


# --------------------------------------------------------------------------
# Minimal PNG writer (RGBA8)
# --------------------------------------------------------------------------
class Image:
    def __init__(self, w, h):
        self.w = w
        self.h = h
        self.px = [[0, 0, 0, 0] for _ in range(w * h)]

    def put(self, x, y, rgba):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y * self.w + x] = list(rgba)

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[y * self.w + x]
        return [0, 0, 0, 0]

    def rect(self, x, y, w, h, rgba):
        for j in range(y, y + h):
            for i in range(x, x + w):
                self.put(i, j, rgba)

    def save(self, path):
        raw = bytearray()
        for y in range(self.h):
            raw.append(0)  # filter type 0 (None)
            for x in range(self.w):
                raw.extend(self.px[y * self.w + x])

        def chunk(tag, data):
            out = struct.pack(">I", len(data)) + tag + data
            return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

        png = b"\x89PNG\r\n\x1a\n"
        png += chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 6, 0, 0, 0))
        png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        png += chunk(b"IEND", b"")
        with open(path, "wb") as fh:
            fh.write(png)


# --------------------------------------------------------------------------
# Colour helpers
# --------------------------------------------------------------------------
def hx(s, a=255):
    s = s.lstrip("#")
    return [int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), a]


def shade(c, amount):
    """amount > 1 lightens, < 1 darkens."""
    return [max(0, min(255, int(c[0] * amount))),
            max(0, min(255, int(c[1] * amount))),
            max(0, min(255, int(c[2] * amount))),
            c[3]]


def jitter(c, rng, amt=7):
    d = rng.randint(-amt, amt)
    return [max(0, min(255, c[0] + d)),
            max(0, min(255, c[1] + d)),
            max(0, min(255, c[2] + d)),
            c[3]]


# --------------------------------------------------------------------------
# UV layout of the 64x64 player skin.
# Each entry is (x, y, w, h) for right / front / left / back / top / bottom.
# --------------------------------------------------------------------------
def box(ox, oy, w, d, h):
    """Standard Minecraft box UV unwrap at origin (ox, oy) for a w x h x d cube."""
    return {
        "top":    (ox + d,         oy,     w, d),
        "bottom": (ox + d + w,     oy,     w, d),
        "right":  (ox,             oy + d, d, h),
        "front":  (ox + d,         oy + d, w, h),
        "left":   (ox + d + w,     oy + d, d, h),
        "back":   (ox + d + w + d, oy + d, w, h),
    }


PARTS = {
    "head":       box(0, 0, 8, 8, 8),
    "hat":        box(32, 0, 8, 8, 8),
    "body":       box(16, 16, 8, 4, 12),
    "jacket":     box(16, 32, 8, 4, 12),
    "arm_r":      box(40, 16, 4, 4, 12),
    "sleeve_r":   box(40, 32, 4, 4, 12),
    "arm_l":      box(32, 48, 4, 4, 12),
    "sleeve_l":   box(48, 48, 4, 4, 12),
    "leg_r":      box(0, 16, 4, 4, 12),
    "pants_r":    box(0, 32, 4, 4, 12),
    "leg_l":      box(16, 48, 4, 4, 12),
    "pants_l":    box(0, 48, 4, 4, 12),
}


def fill_part(img, part, color, rng, noise=5, sides=None):
    """Paint every face of a part, darkening the sides/back a touch for depth."""
    faces = PARTS[part]
    tone = {"top": 1.10, "bottom": 0.72, "front": 1.0,
            "back": 0.88, "left": 0.92, "right": 0.92}
    for name, (x, y, w, h) in faces.items():
        if sides and name not in sides:
            continue
        base = shade(color, tone[name])
        for j in range(h):
            for i in range(w):
                img.put(x + i, y + j, jitter(base, rng, noise))


def band(img, part, color, rng, top, height, noise=4, sides=None):
    """Paint a horizontal band across the four vertical faces of a part.

    `top` is measured in pixels from the top of the part.
    """
    faces = PARTS[part]
    tone = {"front": 1.0, "back": 0.88, "left": 0.92, "right": 0.92}
    for name in ("front", "back", "left", "right"):
        if sides and name not in sides:
            continue
        x, y, w, h = faces[name]
        base = shade(color, tone[name])
        for j in range(top, min(top + height, h)):
            for i in range(w):
                img.put(x + i, y + j, jitter(base, rng, noise))


def face_rect(img, part, face, x0, y0, w, h, color):
    fx, fy, fw, fh = PARTS[part][face]
    for j in range(h):
        for i in range(w):
            if 0 <= x0 + i < fw and 0 <= y0 + j < fh:
                img.put(fx + x0 + i, fy + y0 + j, color)


# --------------------------------------------------------------------------
# Palettes
# --------------------------------------------------------------------------
SKIN_TONES = ["#8d5524", "#c68642", "#e0ac69", "#f1c27d", "#ffdbac",
              "#6b4226", "#a86b3c", "#d9a066", "#5c3a21", "#eec39a"]
HAIR = ["#2b1b12", "#4a2c17", "#7a4a1e", "#b5651d", "#c9a227",
        "#d9d9d9", "#8a8a8a", "#1a1a1a", "#5d3a1a", "#a33b1f"]
EYES = ["#3b5d8f", "#4a7c3f", "#5b3a20", "#2f2f2f", "#6b4a8f", "#2e7d7d"]

# Twenty archetypes: (name, shirt, trim, pants, boots, hat_style, has_jacket)
# hat_style: hair | hood | cap | helm | wide | bald | horns
ARCHETYPES = [
    ("Farmer",    "#b0813f", "#e4d3a0", "#6b5434", "#4a3726", "wide",  False),
    ("Miner",     "#4f5a66", "#c9922b", "#39414a", "#23282e", "helm",  False),
    ("Smith",     "#6e3f28", "#3a3a3a", "#4a3a2c", "#2c2320", "bald",  True),
    ("Scout",     "#3f6b3a", "#2c4c2a", "#4a5240", "#3a2f22", "hood",  False),
    ("Builder",   "#c47a22", "#efe3c8", "#5d5850", "#37332d", "helm",  False),
    ("Guard",     "#8a2f35", "#d8c46a", "#3c3f4a", "#22252b", "helm",  True),
    ("Scholar",   "#4a3f78", "#c7b9f0", "#2f2a4a", "#241f33", "hood",  True),
    ("Healer",    "#e2e2e2", "#3f8f6a", "#c9c9c9", "#7a7a7a", "hair",  False),
    ("Hunter",    "#5c4527", "#8a6a3a", "#43331e", "#2e2318", "hood",  False),
    ("Trader",    "#7a3f8f", "#e0c04a", "#4a2c55", "#33203a", "cap",   True),
    ("Cook",      "#f2f2ee", "#c23b2e", "#d8d3c6", "#5a5048", "cap",   True),
    ("Fisher",    "#3a6e8f", "#d6e3ea", "#2c4f66", "#2a2a2a", "wide",  False),
    ("Mason",     "#8a8477", "#5c5750", "#4e4a43", "#332f2b", "bald",  False),
    ("Wanderer",  "#6b6250", "#a89a7a", "#4a4436", "#30291f", "hood",  True),
    ("Elder",     "#584a6e", "#d8d2e6", "#3a3149", "#262033", "hair",  True),
    ("Ranger",    "#2f5c46", "#9bbf6a", "#3a4433", "#262e22", "hood",  False),
    ("Herbalist", "#4f7a3a", "#d9e08a", "#57603f", "#3a3a28", "wide",  False),
    ("Cartwright","#8f6a3a", "#5a3f22", "#5c4a30", "#3a2e1e", "cap",   False),
    ("Sentinel",  "#33405c", "#93a6d1", "#2a3247", "#1c2130", "helm",  True),
    ("Chronicler","#2f4f5c", "#c9e2ea", "#2a3a42", "#1f2a30", "hair",  True),
]


def draw_face(img, tone, eye, rng, dark_brow):
    """Eyes, brows, nose and mouth on the head's front face."""
    # subtle cheek shading
    face_rect(img, "head", "front", 0, 6, 8, 2, shade(tone, 0.94))
    # eye whites
    face_rect(img, "head", "front", 1, 4, 2, 1, hx("#f4f4f4"))
    face_rect(img, "head", "front", 5, 4, 2, 1, hx("#f4f4f4"))
    # irises
    face_rect(img, "head", "front", 2, 4, 1, 1, eye)
    face_rect(img, "head", "front", 5, 4, 1, 1, eye)
    # brows
    face_rect(img, "head", "front", 1, 3, 2, 1, dark_brow)
    face_rect(img, "head", "front", 5, 3, 2, 1, dark_brow)
    # nose + mouth
    face_rect(img, "head", "front", 3, 5, 2, 1, shade(tone, 0.88))
    face_rect(img, "head", "front", 3, 6, 2, 1, shade(tone, 0.70))


def draw_hair(img, layer, hair, style, rng):
    """Hair / headgear on either the head layer or the hat overlay layer."""
    if style == "bald":
        # just a thin band at the back
        band(img, layer, hair, rng, 0, 1, noise=3, sides=("back", "left", "right"))
        fill_part(img, layer, hair, rng, noise=3, sides=("top",))
        return
    if style in ("hair", "hood", "cap", "wide", "helm"):
        fill_part(img, layer, hair, rng, noise=4, sides=("top",))
        depth = {"hair": 3, "hood": 8, "cap": 2, "wide": 2, "helm": 5}[style]
        band(img, layer, hair, rng, 0, depth, noise=4,
             sides=("back", "left", "right"))
        # fringe over the forehead
        fringe = {"hair": 2, "hood": 2, "cap": 2, "wide": 2, "helm": 3}[style]
        face_rect(img, layer, "front", 0, 0, 8, fringe, shade(hair, 1.0))
        for i in range(8):
            if rng.random() < 0.45:
                face_rect(img, layer, "front", i, fringe, 1, 1, shade(hair, 0.9))
    if style == "wide":
        # wide brim: fill the bottom ring of the hat layer so it flares out
        band(img, layer, hair, rng, 7, 1, noise=2)
        fill_part(img, layer, shade(hair, 0.8), rng, noise=2, sides=("bottom",))
    if style == "hood":
        # shoulders-of-the-hood shadow
        band(img, layer, shade(hair, 0.75), rng, 6, 2, noise=3,
             sides=("back", "left", "right"))


def build_skin(index, archetype, seed):
    name, shirt_hex, trim_hex, pants_hex, boots_hex, hat_style, jacket = archetype
    rng = random.Random(seed)
    img = Image(W, H)

    tone = hx(SKIN_TONES[rng.randrange(len(SKIN_TONES))])
    hair = hx(HAIR[rng.randrange(len(HAIR))])
    eye = hx(EYES[rng.randrange(len(EYES))])
    shirt = hx(shirt_hex)
    trim = hx(trim_hex)
    pants = hx(pants_hex)
    boots = hx(boots_hex)

    # --- head ---------------------------------------------------------
    fill_part(img, "head", tone, rng, noise=6)
    draw_face(img, tone, eye, rng, shade(hair, 0.6))
    # hair sits on the head itself so the silhouette reads even without the
    # overlay layer, then the overlay adds volume on top.
    draw_hair(img, "head", hair, "hair" if hat_style != "bald" else "bald", rng)
    draw_face(img, tone, eye, rng, shade(hair, 0.6))
    if hat_style == "helm":
        draw_hair(img, "hat", hx(trim_hex), "helm", rng)
    elif hat_style in ("hood", "cap", "wide"):
        draw_hair(img, "hat", hx(trim_hex) if hat_style == "cap" else shade(shirt, 0.85),
                  hat_style, rng)
    elif hat_style == "hair":
        draw_hair(img, "hat", hair, "hair", rng)

    # --- body ---------------------------------------------------------
    fill_part(img, "body", shirt, rng, noise=6)
    band(img, "body", trim, rng, 0, 1, noise=3)          # collar
    band(img, "body", shade(pants, 0.8), rng, 9, 1, noise=3)  # belt
    face_rect(img, "body", "front", 3, 1, 2, 8, shade(trim, 0.95))  # placket
    face_rect(img, "body", "front", 3, 9, 2, 1, hx("#d9b64a"))      # buckle
    if jacket:
        fill_part(img, "jacket", shade(shirt, 0.82), rng, noise=5)
        band(img, "jacket", trim, rng, 0, 2, noise=3)
        band(img, "jacket", shade(trim, 0.8), rng, 10, 2, noise=3)

    # --- arms ---------------------------------------------------------
    for arm, sleeve in (("arm_r", "sleeve_r"), ("arm_l", "sleeve_l")):
        fill_part(img, arm, tone, rng, noise=6)
        band(img, arm, shirt, rng, 0, 7, noise=5)
        band(img, arm, trim, rng, 6, 1, noise=3)
        fill_part(img, arm, shirt, rng, noise=4, sides=("top",))
        if jacket:
            band(img, sleeve, shade(shirt, 0.82), rng, 0, 8, noise=4)
            fill_part(img, sleeve, shade(shirt, 0.82), rng, noise=3, sides=("top",))

    # --- legs ---------------------------------------------------------
    for leg, over in (("leg_r", "pants_r"), ("leg_l", "pants_l")):
        fill_part(img, leg, pants, rng, noise=6)
        band(img, leg, boots, rng, 9, 3, noise=4)
        fill_part(img, leg, shade(boots, 0.7), rng, noise=3, sides=("bottom",))
        band(img, over, shade(pants, 0.9), rng, 0, 2, noise=3)

    return img, name


def build_icon(path, size=128):
    """Pack icon: a stylised citizen head with a speech bubble."""
    rng = random.Random(1337)
    img = Image(size, size)
    bg_a, bg_b = hx("#1d2433"), hx("#2f3d57")
    for y in range(size):
        t = y / (size - 1)
        row = [int(bg_a[i] + (bg_b[i] - bg_a[i]) * t) for i in range(3)] + [255]
        img.rect(0, y, size, 1, row)

    s = size // 16  # one "pixel" of the 16x16 design
    head = hx("#e0ac69")
    hair = hx("#4a2c17")
    design = [
        "................",
        "................",
        "....HHHHHHHH....",
        "...HHHHHHHHHH...",
        "...HFFFFFFFFH...",
        "...FFWEFFEWFF...",
        "...FFFFFFFFFF...",
        "...FFFNNFFFFF...",
        "...FFMMMMFFFF...",
        "....FFFFFFFF....",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
    ]
    cmap = {
        "H": hair, "F": head, "W": hx("#f4f4f4"), "E": hx("#3b5d8f"),
        "N": shade(head, 0.85), "M": shade(head, 0.65),
    }
    for row, line in enumerate(design):
        for col, ch in enumerate(line):
            if ch in cmap:
                img.rect(col * s, (row + 1) * s, s, s, cmap[ch])

    # speech bubble
    bub = hx("#f6f3e8")
    img.rect(int(size * 0.52), int(size * 0.55), int(size * 0.40), int(size * 0.26), bub)
    img.rect(int(size * 0.56), int(size * 0.81), int(size * 0.08), int(size * 0.07), bub)
    ink = hx("#1d2433")
    for i, wdt in enumerate((0.28, 0.22, 0.25)):
        img.rect(int(size * 0.56), int(size * (0.60 + i * 0.06)),
                 int(size * wdt), max(2, s // 2), ink)
    img.save(path)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "packs", "AI_Citizens_RP", "textures", "entity", "ai_citizen")
    os.makedirs(out, exist_ok=True)

    names = []
    for i, arch in enumerate(ARCHETYPES):
        img, name = build_skin(i, arch, seed=9000 + i * 17)
        path = os.path.join(out, "citizen_%02d.png" % i)
        img.save(path)
        names.append(name)
        print("wrote %s  (%s)" % (path, name))

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for pack in ("AI_Citizens_BP", "AI_Citizens_RP"):
        icon = os.path.join(root, "packs", pack, "pack_icon.png")
        build_icon(icon)
        print("wrote %s" % icon)

    print("\n%d skins: %s" % (len(names), ", ".join(names)))


if __name__ == "__main__":
    main()
