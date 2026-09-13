"""Emit Bedrock geometry (.geo.json) + matching entity textures (.png).

UVs are packed automatically, then the texture painter paints the exact
box-unwrap rects the geometry references, so model and skin can never drift
apart.  The distortion pass is what makes a still life a still life.
"""
import json, math, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw
from mobdefs import MOBS, FACE_STYLE

RP = os.path.join(os.path.dirname(__file__), "..", "packs", "StillLife_RP")
GEO_DIR = os.path.join(RP, "models", "entity")
TEX_DIR = os.path.join(RP, "textures", "entity", "still_life")
BACKROOMS_YELLOW = (0xC8, 0xB4, 0x5A)


# ------------------------------------------------------------------ packing
def footprint(c):
    w, h, d = [int(math.ceil(v)) for v in c["size"]]
    return max(1, 2 * d + 2 * w), max(1, d + h)


def pack(cubes, tw, th):
    """Simple shelf packer. Returns {id: (u,v)} or None if it will not fit."""
    place, x, y, shelf = {}, 0, 0, 0
    for i, c in enumerate(sorted(range(len(cubes)),
                                 key=lambda k: -footprint(cubes[k])[1])):
        w, h = footprint(cubes[c])
        if x + w > tw:
            x, y, shelf = 0, y + shelf, 0
        if y + h > th:
            return None
        place[c] = (x, y)
        x += w
        shelf = max(shelf, h)
    return place


def auto_pack(cubes, want):
    for tw, th in [want, (64, 64), (128, 64), (128, 128), (256, 128), (256, 256)]:
        if tw < want[0] or th < want[1]:
            continue
        p = pack(cubes, tw, th)
        if p is not None:
            return p, tw, th
    raise RuntimeError("texture atlas overflow")


# ------------------------------------------------------------------ faces
def face_rects(u, v, w, h, d):
    return {
        "up":    (u + d, v, w, d),
        "down":  (u + d + w, v, w, d),
        "east":  (u, v + d, d, h),
        "north": (u + d, v + d, w, h),          # -Z, the face you look at
        "west":  (u + d + w, v + d, d, h),
        "south": (u + d + w + d, v + d, w, h),
    }


def shade(col, f):
    return tuple(max(0, min(255, int(c * f))) for c in col)


def toward(col, target, t):
    return tuple(int(c + (target[i] - c) * t) for i, c in enumerate(col))


FACE_SHADE = {"up": 1.12, "down": 0.62, "north": 1.0,
              "south": 0.86, "east": 0.80, "west": 0.92}


# ------------------------------------------------------------------ painter
def paint_cube(px, c, uv, rnd, decay):
    w, h, d = [int(math.ceil(v)) for v in c["size"]]
    base = c["color"]
    # the still life is the mob "remembered wrong": drained, jaundiced
    base = toward(base, BACKROOMS_YELLOW, 0.30 + decay * 0.25)
    g = sum(base) / 3
    base = tuple(int(v + (g - v) * (0.22 + decay * 0.2)) for v in base)

    for fname, (x, y, fw, fh) in face_rects(uv[0], uv[1], w, h, d).items():
        col = shade(base, FACE_SHADE[fname])
        for j in range(fh):
            for i in range(fw):
                p = list(col)
                # grain
                n = rnd.randint(-9, 9)
                # scanlines: the recreation is a bad recording of a mob
                sl = 0.87 if (y + j) % 3 == 0 else 1.0
                # vignette toward cube edges
                ed = min(i, fw - 1 - i, j, fh - 1 - j)
                vg = 1.0 if ed > 1 else (0.80 if ed == 0 else 0.91)
                for k in range(3):
                    p[k] = max(0, min(255, int((p[k] + n) * sl * vg)))
                px[x + i, y + j] = (p[0], p[1], p[2], 255)

        # torn scan bands -- a horizontal slip, like a dropped frame
        if fw > 3 and rnd.random() < 0.5:
            for _ in range(rnd.randint(1, 2)):
                by = y + rnd.randrange(fh)
                off = rnd.choice([-2, -1, 1, 2])
                row = [px[x + i, by] for i in range(fw)]
                for i in range(fw):
                    px[x + i, by] = row[(i - off) % fw]

        # rot: patches where the copy simply gave up
        if rnd.random() < 0.30 + decay * 0.3:
            rw, rh = rnd.randint(1, max(1, fw // 3)), rnd.randint(1, max(1, fh // 3))
            rx, ry = x + rnd.randrange(max(1, fw - rw + 1)), y + rnd.randrange(max(1, fh - rh + 1))
            for j in range(rh):
                for i in range(rw):
                    o = px[rx + i, ry + j]
                    px[rx + i, ry + j] = (int(o[0] * 0.45), int(o[1] * 0.44),
                                          int(o[2] * 0.40), 255)


def paint_face_details(img, c, uv, style, rnd):
    """Eyes / mouth on the -Z face. In the movie the faces are the tell."""
    w, h, d = [int(math.ceil(v)) for v in c["size"]]
    x, y, fw, fh = face_rects(uv[0], uv[1], w, h, d)["north"]
    dr = ImageDraw.Draw(img)
    st = FACE_STYLE[style]
    VOID = (6, 5, 4, 255)

    eyes = list(st["eyes"])
    mode = rnd.random()
    if mode < 0.18:
        eyes = eyes[:1]                                   # one eye missing
    elif mode < 0.30 and fh > 5:
        eyes.append((rnd.randrange(max(1, fw - 1)), 1))   # a spare one

    for (ex, ey) in eyes:
        ex, ey = min(ex, fw - 2), min(ey, fh - 2)
        dr.rectangle([x + ex, y + ey, x + ex + 1, y + ey], fill=VOID)
        # the smear: eyes run down the face like wet paint
        if rnd.random() < 0.55:
            for k in range(1, rnd.randint(2, max(2, fh - ey - 1))):
                if y + ey + k < y + fh:
                    o = img.getpixel((x + ex, y + ey + k))
                    img.putpixel((x + ex, y + ey + k),
                                 (int(o[0] * 0.35), int(o[1] * 0.34), int(o[2] * 0.32), 255))

    if st["mouth"]:
        mx, my, mw, mh = st["mouth"]
        if my + mh <= fh and mx + mw <= fw:
            dr.rectangle([x + mx, y + my, x + mx + mw - 1, y + my + mh - 1],
                         fill=VOID if rnd.random() < 0.6 else (40, 30, 28, 255))
    if st["brow"]:
        dr.rectangle([x, y + 1, x + fw - 1, y + 1], fill=(0, 0, 0, 90))


# ------------------------------------------------------------------ build
def build(name, model, decay=0.0, seed=None):
    rnd = random.Random(seed if seed is not None else hash(name) & 0xFFFF)
    cubes, owner = [], []
    for b in model["bones"]:
        for c in b["cubes"]:
            cubes.append(c)
            owner.append(b["name"])
    place, tw, th = auto_pack(cubes, model["texture"])

    # ---- geometry
    lo = [1e9] * 3
    hi = [-1e9] * 3
    bones_json, idx = [], 0
    for b in model["bones"]:
        jb = {"name": b["name"], "pivot": [round(v, 2) for v in b["pivot"]]}
        if "parent" in b:
            jb["parent"] = b["parent"]
        if "rotation" in b:
            jb["rotation"] = b["rotation"]
        jc = []
        for c in b["cubes"]:
            u, v = place[idx]
            idx += 1
            e = {"origin": [round(x, 2) for x in c["origin"]],
                 "size": [round(x, 2) for x in c["size"]],
                 "uv": [u, v]}
            if c["inflate"]:
                e["inflate"] = c["inflate"]
            if c["mirror"]:
                e["mirror"] = True
            jc.append(e)
            for k in range(3):
                lo[k] = min(lo[k], c["origin"][k])
                hi[k] = max(hi[k], c["origin"][k] + c["size"][k])
        if jc:
            jb["cubes"] = jc
        bones_json.append(jb)

    geo = {
        "format_version": "1.16.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": f"geometry.sl.{name}",
                "texture_width": tw, "texture_height": th,
                "visible_bounds_width": round(max(2.0, (hi[0] - lo[0]) / 16 + 1), 2),
                "visible_bounds_height": round(max(2.0, (hi[1] - lo[1]) / 16 + 0.6), 2),
                "visible_bounds_offset": [0, round((hi[1] - lo[1]) / 32, 2), 0],
            },
            "bones": bones_json,
        }],
    }
    os.makedirs(GEO_DIR, exist_ok=True)
    with open(os.path.join(GEO_DIR, f"{name}.geo.json"), "w") as f:
        json.dump(geo, f, indent=2)

    # ---- texture
    img = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    px = img.load()
    for i, c in enumerate(cubes):
        paint_cube(px, c, place[i], rnd, decay)
    for i, c in enumerate(cubes):
        if c["face"]:
            paint_face_details(img, c, place[i], c["face"], rnd)
    os.makedirs(TEX_DIR, exist_ok=True)
    img.save(os.path.join(TEX_DIR, f"{name}.png"))
    return tw, th, (hi[1] - lo[1]) / 16


if __name__ == "__main__":
    for n, m in MOBS.items():
        decay = 0.5 if n in ("the_tall_one", "captain_clark") else 0.0
        tw, th, hgt = build(n, m, decay=decay)
        print(f"{n:18s} atlas {tw}x{th}  height {hgt:.2f} blocks")
    # extra decayed variants: the world's later, worse attempts at a copy
    for n in ("still_villager", "still_cow", "still_player"):
        for lvl, d in (("v2", 0.45), ("v3", 0.85)):
            tw, th, _ = build(n, MOBS[n], decay=d, seed=hash(n + lvl) & 0xFFFF)
            os.rename(os.path.join(TEX_DIR, f"{n}.png"),
                      os.path.join(TEX_DIR, f"{n}_{lvl}.png"))
        build(n, MOBS[n], decay=0.0)   # restore the clean pass
        print(f"{n:18s} + decayed variants v2/v3")


def build_armour():
    from mobdefs import ARMOUR
    global TEX_DIR
    keep = TEX_DIR
    TEX_DIR = os.path.join(RP, "textures", "models", "armor")
    for n, m in ARMOUR.items():
        tw, th, _ = build(n, m, decay=0.15, seed=hash(n) & 0xFFF)
        os.rename(os.path.join(TEX_DIR, f"{n}.png"),
                  os.path.join(TEX_DIR, f"sl_stillcloth_{n.split('_')[1]}.png"))
        print(f"armour {n:14s} atlas {tw}x{th}")
    TEX_DIR = keep
