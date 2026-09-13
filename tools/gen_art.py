"""Render item/block textures, the pack logo, and the sanity-bar GUI art."""
import math, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from sprites import ITEMS, BLOCKS, PAL

ROOT = os.path.join(os.path.dirname(__file__), "..")
RP = os.path.join(ROOT, "packs", "StillLife_RP")
BP = os.path.join(ROOT, "packs", "StillLife_BP")
FONT = "/mnt/skills/examples/canvas-design/canvas-fonts/BigShoulders-Bold.ttf"
YEL = (0xC8, 0xB4, 0x5A)


def sprite(grid, outline=True, grain=0.0, seed=0):
    rnd = random.Random(seed)
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(grid):
        for x, ch in enumerate(row):
            c = PAL[ch]
            if c is None:
                continue
            r, g, b = c
            if grain:
                n = rnd.randint(-int(14 * grain), int(14 * grain))
                r, g, b = (max(0, min(255, r + n)), max(0, min(255, g + n)),
                           max(0, min(255, b + n)))
            px[x, y] = (r, g, b, 255)
    if outline:
        out = img.copy()
        op = out.load()
        for y in range(16):
            for x in range(16):
                if px[x, y][3]:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < 16 and 0 <= ny < 16 and px[nx, ny][3]:
                        op[x, y] = (12, 10, 9, 255)
                        break
        img = out
    return img


def gen_flat():
    idir = os.path.join(RP, "textures", "items")
    bdir = os.path.join(RP, "textures", "blocks")
    os.makedirs(idir, exist_ok=True)
    os.makedirs(bdir, exist_ok=True)
    for n, g in ITEMS.items():
        sprite(g, outline=True, grain=0.6, seed=hash(n) & 0xFFF).save(
            os.path.join(idir, f"sl_{n}.png"))
    for n, g in BLOCKS.items():
        sprite(g, outline=False, grain=0.8, seed=hash(n) & 0xFFF).save(
            os.path.join(bdir, f"sl_{n}.png"))
    print(f"items {len(ITEMS)}  blocks {len(BLOCKS)}")


# --------------------------------------------------------------- the logo
def corridor(size, vanish_dark=True):
    """One-point-perspective backrooms hallway. This is the whole mood."""
    W = H = size
    img = Image.new("RGB", (W, H), (0x9A, 0x88, 0x3C))
    d = ImageDraw.Draw(img)
    cx, cy = W * 0.5, H * 0.56
    vw, vh = W * 0.13, H * 0.15          # the far opening

    L, R = cx - vw, cx + vw
    T, B = cy - vh, cy + vh
    # ceiling / floor / walls as trapezoids receding to the vanishing frame
    d.polygon([(0, 0), (W, 0), (R, T), (L, T)], fill=(0xD2, 0xC4, 0x86))   # ceiling
    d.polygon([(0, H), (W, H), (R, B), (L, B)], fill=(0x6E, 0x5C, 0x2E))   # carpet
    d.polygon([(0, 0), (L, T), (L, B), (0, H)], fill=(0xC2, 0xAC, 0x54))   # left wall
    d.polygon([(W, 0), (R, T), (R, B), (W, H)], fill=(0xA8, 0x94, 0x44))   # right wall
    d.rectangle([L, T, R, B], fill=(0x14, 0x12, 0x0C) if vanish_dark
                else (0xC8, 0xB4, 0x5A))

    # receding ceiling lights
    for i in range(1, 9):
        t = i / 9.0
        e = t ** 2.1
        lx0 = cx - (cx - (L + vw * 0.35)) * (1 - e) - vw * 0.35 * e
        lx1 = cx + (cx - (L + vw * 0.35)) * (1 - e) + vw * 0.35 * e
        ly = cy - vh - (cy - vh) * (1 - e) * 0.92
        hgt = max(1, (1 - e) * H * 0.035)
        v = int(250 - 90 * e)
        d.rectangle([lx0, ly, lx1, ly + hgt], fill=(v, v, int(v * 0.86)))

    # receding floor + ceiling seams (run wall-to-wall, not as a fan)
    lw = max(1, size // 400)
    for i in range(1, 8):
        e = (i / 8.0) ** 1.7
        yb = H - (H - B) * e
        xl = 0 + (L - 0) * e
        xr = W - (W - R) * e
        d.line([(xl, yb), (xr, yb)], fill=(0x54, 0x46, 0x22), width=lw)
        yt = 0 + T * e
        d.line([(xl, yt), (xr, yt)], fill=(0xB4, 0xA2, 0x5E), width=lw)
    # wall/ceiling and wall/floor corner edges
    for a, b in (((0, 0), (L, T)), ((W, 0), (R, T))):
        d.line([a, b], fill=(0x8A, 0x78, 0x36), width=max(1, size // 300))
    for a, b in (((0, H), (L, B)), ((W, H), (R, B))):
        d.line([a, b], fill=(0x4E, 0x40, 0x20), width=max(1, size // 300))
    d.rectangle([L, T, R, B], outline=(0x30, 0x28, 0x14), width=max(1, size // 320))
    return img, (cx, cy, vw, vh)


def tall_silhouette(d, cx, base_y, h, w, col=(0x0B, 0x0A, 0x08)):
    """The Tall One, waiting at the end of the hall."""
    hw = w / 2
    head = h * 0.11
    d.rectangle([cx - hw * 0.62, base_y - h, cx + hw * 0.62, base_y - h + head], fill=col)
    d.rectangle([cx - hw, base_y - h + head * 1.02, cx + hw, base_y - h * 0.42], fill=col)
    d.rectangle([cx - hw * 1.55, base_y - h + head * 1.1,
                 cx - hw * 0.92, base_y - h * 0.16], fill=col)   # long arms
    d.rectangle([cx + hw * 0.92, base_y - h + head * 1.1,
                 cx + hw * 1.55, base_y - h * 0.16], fill=col)
    d.rectangle([cx - hw * 0.92, base_y - h * 0.45, cx - hw * 0.12, base_y], fill=col)
    d.rectangle([cx + hw * 0.12, base_y - h * 0.45, cx + hw * 0.92, base_y], fill=col)


def degrade(img, seed=7, amount=1.0):
    rnd = random.Random(seed)
    W, H = img.size
    px = img.load()
    # chromatic slip bands
    for _ in range(int(16 * amount)):
        y = rnd.randrange(H)
        hgt = rnd.randint(1, max(2, H // 90))
        off = rnd.choice([-1, 1]) * rnd.randint(2, max(3, W // 60))
        for yy in range(y, min(H, y + hgt)):
            row = [px[x, yy] for x in range(W)]
            for x in range(W):
                s = row[(x - off) % W]
                o = row[x]
                px[x, yy] = (s[0], o[1], row[(x + off) % W][2])
    # scanlines + grain + vignette
    cx, cy = W / 2, H / 2
    mr = math.hypot(cx, cy)
    for y in range(H):
        sl = 0.90 if y % 3 == 0 else 1.0
        for x in range(W):
            r, g, b = px[x, y]
            n = rnd.randint(-11, 11)
            vg = 1.0 - 0.55 * (math.hypot(x - cx, y - cy) / mr) ** 2.4
            px[x, y] = (max(0, min(255, int((r + n) * sl * vg))),
                        max(0, min(255, int((g + n) * sl * vg))),
                        max(0, min(255, int((b + n * 0.7) * sl * vg))))
    return img


def gen_logo():
    S = 1024
    img, (cx, cy, vw, vh) = corridor(S)
    d = ImageDraw.Draw(img)
    tall_silhouette(d, cx, cy + vh * 0.96, S * 0.30, S * 0.055)
    # a still life standing off to the side, facing the wrong way
    tall_silhouette(d, cx - S * 0.315, cy + vh * 2.35, S * 0.145, S * 0.048,
                    col=(0x2A, 0x24, 0x14))
    img = img.filter(ImageFilter.GaussianBlur(0.6))

    # ---- type
    lay = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lay)
    f1 = ImageFont.truetype(FONT, int(S * 0.235))
    f2 = ImageFont.truetype(FONT, int(S * 0.070))
    f3 = ImageFont.truetype(FONT, int(S * 0.040))

    def centered(dr, y, txt, font, fill, dx=0):
        bb = dr.textbbox((0, 0), txt, font=font)
        dr.text((S / 2 - (bb[2] - bb[0]) / 2 - bb[0] + dx, y), txt, font=font, fill=fill)

    for dx, col in ((-7, (0, 210, 235, 150)), (7, (235, 40, 60, 150))):
        centered(ld, S * 0.055, "STILL LIFE", f1, col, dx)
    centered(ld, S * 0.055, "STILL LIFE", f1, (250, 246, 226, 255))
    centered(ld, S * 0.300, "A  B A C K R O O M S  A D D - O N", f2, (18, 16, 10, 235))
    centered(ld, S * 0.895, "T H E   W O R L D   R E M E M B E R S   Y O U",
             f3, (245, 238, 208, 210))
    img = degrade(img, amount=1.0)
    img = Image.alpha_composite(img.convert("RGBA"), lay).convert("RGB")
    img = degrade(img, seed=91, amount=0.22)
    os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
    img.save(os.path.join(ROOT, "docs", "logo.png"))

    icon = img.resize((256, 256), Image.LANCZOS)
    for p in (BP, RP):
        icon.save(os.path.join(p, "pack_icon.png"))

    # a clean key-art banner too
    ban = Image.new("RGB", (1600, 640))
    c2, _ = corridor(1600)
    ban.paste(c2.resize((1600, 1600)).crop((0, 420, 1600, 1060)))
    bd = ImageDraw.Draw(ban)
    tall_silhouette(bd, 800, 430, 300, 46)
    bl = Image.new("RGBA", (1600, 640), (0, 0, 0, 0))
    bld = ImageDraw.Draw(bl)
    ff = ImageFont.truetype(FONT, 190)
    fs = ImageFont.truetype(FONT, 48)
    for dx, col in ((-6, (0, 210, 235, 140)), (6, (235, 40, 60, 140))):
        bld.text((80 + dx, 40), "STILL LIFE", font=ff, fill=col)
    bld.text((80, 40), "STILL LIFE", font=ff, fill=(250, 246, 226, 255))
    bld.text((88, 250), "A  B A C K R O O M S  A D D - O N   ·   B E D R O C K",
             font=fs, fill=(20, 18, 10, 240))
    ban = degrade(ban, seed=3, amount=0.7)
    ban = Image.alpha_composite(ban.convert("RGBA"), bl).convert("RGB")
    degrade(ban, seed=17, amount=0.18).save(os.path.join(ROOT, "docs", "banner.png"))
    print("logo + banner + pack icons")


if __name__ == "__main__":
    gen_flat()
    gen_logo()


def gen_animated():
    """Vertical flipbook strips for the rift and the failing light."""
    import random as _r
    bdir = os.path.join(RP, "textures", "blocks")

    # --- noclip rift: a hole in the world that will not hold still
    F = 8
    strip = Image.new("RGBA", (16, 16 * F), (0, 0, 0, 255))
    sd = ImageDraw.Draw(strip)
    rnd = _r.Random(4242)
    for f in range(F):
        oy = f * 16
        ph = f / F * math.tau
        for y in range(16):
            for x in range(16):
                dx, dy = x - 7.5, y - 7.5
                r = math.hypot(dx, dy)
                a = math.atan2(dy, dx)
                sw = math.sin(a * 3 + ph * 2 - r * 0.9)
                v = max(0.0, 1.0 - r / 8.2) * (0.55 + 0.45 * sw)
                if r < 3.4 + math.sin(ph * 2) * 0.5:
                    c = (2, 2, 3)                      # the hole itself
                else:
                    c = (int(30 + 105 * v), int(14 + 40 * v), int(48 + 130 * v))
                n = rnd.randint(-10, 10)
                sd.point((x, oy + y), fill=(max(0, c[0] + n), max(0, c[1] + n),
                                            max(0, c[2] + n), 255))
    strip.save(os.path.join(bdir, "sl_noclip_rift.png"))

    # --- buzzing light: mostly on, occasionally not
    F2 = 12
    base = Image.open(os.path.join(bdir, "sl_buzzing_light.png")).convert("RGBA")
    strip2 = Image.new("RGBA", (16, 16 * F2))
    dim = [0, 0, 0, 0, 0, 0.55, 0, 0.85, 0.25, 0, 0, 0.4]
    for f in range(F2):
        fr = base.copy()
        if dim[f]:
            px = fr.load()
            k = 1.0 - dim[f]
            for y in range(16):
                for x in range(16):
                    r, g, b, a = px[x, y]
                    px[x, y] = (int(r * k), int(g * k), int(b * k * 0.92), a)
        strip2.paste(fr, (0, f * 16))
    strip2.save(os.path.join(bdir, "sl_buzzing_light.png"))
    print("flipbooks: noclip_rift(8) buzzing_light(12)")
