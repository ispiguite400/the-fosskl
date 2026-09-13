"""A tiny software renderer for Bedrock .geo.json + its texture.

Not a Minecraft screenshot -- Minecraft will not run in this container -- but
it draws the exact geometry and the exact texture the game will load, with the
same bone hierarchy, so what you see here is what spawns in the world.
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), "..")
RP = os.path.join(ROOT, "packs", "StillLife_RP")
GEO = os.path.join(RP, "models", "entity")
TEX = os.path.join(RP, "textures", "entity", "still_life")
FONT = "/mnt/skills/examples/canvas-design/canvas-fonts/BigShoulders-Bold.ttf"
FONT_R = "/mnt/skills/examples/canvas-design/canvas-fonts/BigShoulders-Regular.ttf"


def rot_mat(rx, ry, rz):
    rx, ry, rz = map(math.radians, (rx, ry, rz))
    cx, sx, cy, sy, cz, sz = (math.cos(rx), math.sin(rx), math.cos(ry),
                              math.sin(ry), math.cos(rz), math.sin(rz))
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def face_rects(u, v, w, h, d):
    return {
        "up":    (u + d, v, w, d),
        "down":  (u + d + w, v, w, d),
        "east":  (u, v + d, d, h),
        "north": (u + d, v + d, w, h),
        "west":  (u + d + w, v + d, d, h),
        "south": (u + d + w + d, v + d, w, h),
    }


def face_corners(p0, p1, name):
    x0, y0, z0 = p0
    x1, y1, z1 = p1
    C = {
        "north": [(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)],
        "south": [(x1, y1, z1), (x0, y1, z1), (x0, y0, z1), (x1, y0, z1)],
        "east":  [(x0, y1, z1), (x0, y1, z0), (x0, y0, z0), (x0, y0, z1)],
        "west":  [(x1, y1, z0), (x1, y1, z1), (x1, y0, z1), (x1, y0, z0)],
        "up":    [(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)],
        "down":  [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
    }
    N = {"north": (0, 0, -1), "south": (0, 0, 1), "east": (-1, 0, 0),
         "west": (1, 0, 0), "up": (0, 1, 0), "down": (0, -1, 0)}
    return C[name], N[name]


def load_model(name):
    g = json.load(open(os.path.join(GEO, f"{name}.geo.json")))["minecraft:geometry"][0]
    tex = Image.open(os.path.join(TEX, f"{name}.png")).convert("RGBA")
    return g, np.array(tex, dtype=np.float64) / 255.0


def bone_transforms(bones):
    """world matrix + translation per bone, honouring the parent chain."""
    by = {b["name"]: b for b in bones}
    out = {}

    def solve(name):
        if name in out:
            return out[name]
        b = by[name]
        piv = np.array(b["pivot"], dtype=float)
        R = rot_mat(*b.get("rotation", [0, 0, 0]))
        if b.get("parent") and b["parent"] in by:
            PR, PT = solve(b["parent"])
        else:
            PR, PT = np.eye(3), np.zeros(3)
        # p -> PR @ (R @ (p - piv) + piv) + PT
        Rw = PR @ R
        Tw = PR @ (piv - R @ piv) + PT
        out[name] = (Rw, Tw)
        return out[name]

    for b in bones:
        solve(b["name"])
    return out


def gather_faces(geo, yaw, pitch):
    bones = geo["bones"]
    tf = bone_transforms(bones)
    tw = geo["description"]["texture_width"]
    th = geo["description"]["texture_height"]
    cam = rot_mat(pitch, yaw, 0)
    faces = []
    for b in bones:
        Rw, Tw = tf[b["name"]]
        for c in b.get("cubes", []):
            inf = c.get("inflate", 0.0)
            o = np.array(c["origin"], dtype=float) - inf
            s = np.array(c["size"], dtype=float) + inf * 2
            p0, p1 = o, o + s
            u, v = c["uv"]
            w, h, d = [int(math.ceil(x)) for x in c["size"]]
            rects = face_rects(u, v, w, h, d)
            for fname, rect in rects.items():
                corners, normal = face_corners(p0, p1, fname)
                pts = np.array([cam @ (Rw @ np.array(p) + Tw) for p in corners])
                nrm = cam @ (Rw @ np.array(normal, dtype=float))
                faces.append((pts, nrm, rect, (tw, th), c.get("mirror", False)))
    return faces


def render(name, size=560, yaw=-32, pitch=14, margin=0.14, bg=(0, 0, 0, 0)):
    geo, tex = load_model(name)
    faces = gather_faces(geo, yaw, pitch)
    allp = np.concatenate([f[0] for f in faces])
    lo, hi = allp.min(axis=0), allp.max(axis=0)
    ctr = (lo + hi) / 2
    span = max(hi[0] - lo[0], hi[1] - lo[1]) or 1.0
    scale = size * (1 - margin * 2) / span

    img = np.zeros((size, size, 4))
    img[:, :] = np.array(bg) / 255.0
    zbuf = np.full((size, size), 1e18)
    light = np.array([-0.42, 0.80, -0.43])
    light /= np.linalg.norm(light)

    for pts, nrm, rect, (tw, th), mirror in faces:
        q = (pts - ctr) * scale
        depth = q[:, 2]
        sx = size / 2 + q[:, 0]
        sy = size / 2 - q[:, 1]
        n = nrm / (np.linalg.norm(nrm) or 1)
        if n[2] > 0.02:                       # back-face
            continue
        shade = 0.42 + 0.58 * max(0.0, float(np.dot(n, light)))
        rx, ry, rw, rh = rect
        # two triangles, affine UV
        tri = [((0, 1, 2), ((0, 0), (1, 0), (1, 1))),
               ((0, 2, 3), ((0, 0), (1, 1), (0, 1)))]
        for idx, uvc in tri:
            X = sx[list(idx)]
            Y = sy[list(idx)]
            Z = depth[list(idx)]
            minx, maxx = int(max(0, np.floor(X.min()))), int(min(size - 1, np.ceil(X.max())))
            miny, maxy = int(max(0, np.floor(Y.min()))), int(min(size - 1, np.ceil(Y.max())))
            if minx > maxx or miny > maxy:
                continue
            xs = np.arange(minx, maxx + 1)
            ys = np.arange(miny, maxy + 1)
            gx, gy = np.meshgrid(xs + 0.5, ys + 0.5)
            d = ((Y[1] - Y[2]) * (X[0] - X[2]) + (X[2] - X[1]) * (Y[0] - Y[2]))
            if abs(d) < 1e-9:
                continue
            l0 = ((Y[1] - Y[2]) * (gx - X[2]) + (X[2] - X[1]) * (gy - Y[2])) / d
            l1 = ((Y[2] - Y[0]) * (gx - X[2]) + (X[0] - X[2]) * (gy - Y[2])) / d
            l2 = 1 - l0 - l1
            m = (l0 >= -0.002) & (l1 >= -0.002) & (l2 >= -0.002)
            if not m.any():
                continue
            zz = l0 * Z[0] + l1 * Z[1] + l2 * Z[2]
            uu = l0 * uvc[0][0] + l1 * uvc[1][0] + l2 * uvc[2][0]
            vv = l0 * uvc[0][1] + l1 * uvc[1][1] + l2 * uvc[2][1]
            if mirror:
                uu = 1 - uu
            px = np.clip((rx + uu * (rw - 1e-6)).astype(int), 0, tw - 1)
            py = np.clip((ry + vv * (rh - 1e-6)).astype(int), 0, th - 1)
            samp = tex[py, px]
            m = m & (samp[..., 3] > 0.35)
            sub = zbuf[miny:maxy + 1, minx:maxx + 1]
            m = m & (zz < sub)
            if not m.any():
                continue
            sub[m] = zz[m]
            col = samp.copy()
            col[..., :3] *= shade
            tgt = img[miny:maxy + 1, minx:maxx + 1]
            tgt[m] = col[m]
    out = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), "RGBA")
    return out


# ------------------------------------------------------------- contact sheet
LABEL = {
    "still_villager": ("STILL LIFE", "villager"),
    "still_cow": ("STILL LIFE", "cow"),
    "still_pig": ("STILL LIFE", "pig"),
    "still_sheep": ("STILL LIFE", "sheep"),
    "still_chicken": ("STILL LIFE", "chicken"),
    "still_wolf": ("STILL LIFE", "wolf"),
    "still_player": ("THE COPY", "player-shaped"),
    "the_tall_one": ("THE TALL ONE", "5 blocks / boss"),
    "captain_clark": ("CAPTAIN CLARK", "backrooms boss"),
}
ORDER = ["still_villager", "still_cow", "still_pig", "still_sheep", "still_chicken",
         "still_wolf", "still_player", "the_tall_one", "captain_clark"]


def sheet():
    cols, cell, pad = 3, 400, 26
    top = 118
    rows = (len(ORDER) + cols - 1) // cols
    W = cols * cell + pad * (cols + 1)
    H = top + rows * (cell + 58) + pad
    img = Image.new("RGB", (W, H), (26, 24, 19))
    d = ImageDraw.Draw(img)
    for y in range(H):                                     # a faint yellow wash
        k = 1.0 - abs(y - H / 2) / H * 0.5
        d.line([(0, y), (W, y)], fill=(int(30 * k), int(28 * k), int(20 * k)))
    f1 = ImageFont.truetype(FONT, 66)
    f2 = ImageFont.truetype(FONT_R, 30)
    f3 = ImageFont.truetype(FONT, 30)
    f4 = ImageFont.truetype(FONT_R, 23)
    d.text((pad + 6, 22), "STILL LIFE", font=f1, fill=(236, 226, 178))
    d.text((pad + 8, 84), "every model and skin generated by the add-on build, rendered from the shipped .geo.json",
           font=f4, fill=(150, 142, 110))

    for i, name in enumerate(ORDER):
        cx = pad + (i % cols) * (cell + pad)
        cy = top + (i // cols) * (cell + 58)
        d.rectangle([cx, cy, cx + cell, cy + cell], fill=(38, 35, 26),
                    outline=(70, 64, 44))
        big = name in ("the_tall_one",)
        r = render(name, size=cell - 20, margin=0.10 if big else 0.16)
        img.paste(r, (cx + 10, cy + 10), r)
        t, s = LABEL[name]
        d.text((cx + 6, cy + cell + 6), t, font=f3, fill=(228, 214, 150))
        bb = d.textbbox((0, 0), t, font=f3)
        d.text((cx + 12 + bb[2], cy + cell + 12), s, font=f4, fill=(132, 124, 96))
    img.save(os.path.join(ROOT, "docs", "mobs.png"))
    print("docs/mobs.png")


def hero():
    """The Tall One at the end of the corridor, at the scale it actually is."""
    sys.path.insert(0, os.path.dirname(__file__))
    from gen_art import corridor, degrade
    S = 1400
    base, (cx, cy, vw, vh) = corridor(S)
    img = base.resize((S, int(S * 0.62))).convert("RGBA")
    W, H = img.size

    tall = render("the_tall_one", size=int(H * 0.86), margin=0.02, yaw=-14, pitch=6)
    img.paste(tall, (int(W * 0.50 - tall.width / 2), int(H * 0.10)), tall)
    for nm, sx, sy, sc in (("still_villager", 0.20, 0.40, 0.42),
                           ("still_player", 0.79, 0.34, 0.50),
                           ("still_cow", 0.34, 0.62, 0.34)):
        m = render(nm, size=int(H * sc), margin=0.02, yaw=-40 + 60 * sx, pitch=8)
        img.paste(m, (int(W * sx - m.width / 2), int(H * sy)), m)

    img = degrade(img.convert("RGB"), seed=55, amount=0.55).convert("RGBA")
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, 40)
    d.text((28, H - 58), "THE TALL ONE  ·  arrives every five or six days  ·  3.8 blocks tall",
           font=f, fill=(238, 230, 190))
    img.convert("RGB").save(os.path.join(ROOT, "docs", "hero.png"))
    print("docs/hero.png")


if __name__ == "__main__":
    os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
    sheet()
    hero()


def item_sheet():
    """Every item and block icon, at 6x, with its in-game name."""
    sys.path.insert(0, os.path.dirname(__file__))
    from gen_rp import ITEM_NAMES, BLOCK_NAMES
    S, cols, pad = 96, 6, 20
    lab = 46
    groups = [("THE TWENTY-FOUR ITEMS", "items", ITEM_NAMES),
              ("THE TWELVE BLOCKS", "blocks", BLOCK_NAMES)]
    rows = sum((len(g[2]) + cols - 1) // cols for g in groups)
    W = cols * (S + pad) + pad
    H = 112 + rows * (S + lab + pad) + len(groups) * 56 + pad
    img = Image.new("RGB", (W, H), (26, 24, 19))
    d = ImageDraw.Draw(img)
    f1 = ImageFont.truetype(FONT, 60)
    f2 = ImageFont.truetype(FONT, 30)
    f3 = ImageFont.truetype(FONT_R, 20)
    f4 = ImageFont.truetype(FONT_R, 22)
    d.text((pad + 4, 18), "STILL LIFE", font=f1, fill=(236, 226, 178))
    d.text((pad + 6, 74), "all art generated by the build - no external assets",
           font=f4, fill=(146, 138, 108))
    y = 118
    for title, folder, names in groups:
        d.text((pad + 4, y), title, font=f2, fill=(214, 198, 132))
        y += 46
        for i, (key, nice) in enumerate(names.items()):
            cx = pad + (i % cols) * (S + pad)
            cy = y + (i // cols) * (S + lab + pad)
            d.rectangle([cx, cy, cx + S, cy + S], fill=(40, 37, 27),
                        outline=(72, 66, 46))
            src = os.path.join(RP, "textures", folder, f"sl_{key}.png")
            ic = Image.open(src).convert("RGBA")
            if ic.height > ic.width:                    # flipbook strip
                ic = ic.crop((0, 0, ic.width, ic.width))
            ic = ic.resize((S - 12, S - 12), Image.NEAREST)
            img.paste(ic, (cx + 6, cy + 6), ic)
            words, line, lines = nice.split(), "", []
            for w in words:
                t = (line + " " + w).strip()
                if d.textlength(t, font=f3) > S + 4 and line:
                    lines.append(line); line = w
                else:
                    line = t
            lines.append(line)
            for j, ln in enumerate(lines[:2]):
                d.text((cx + 2, cy + S + 4 + j * 15), ln, font=f3, fill=(178, 168, 132))
        y += ((len(names) + cols - 1) // cols) * (S + lab + pad) + 10
    img.save(os.path.join(ROOT, "docs", "items.png"))
    print("docs/items.png")
