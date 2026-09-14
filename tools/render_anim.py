"""Evaluate the pack's animations and draw them, frame by frame.

Minecraft will not run in this container, so the only honest way to show that
a mob animates is to do what the game does: read the same .geo.json, evaluate
the same Molang out of the same .animation.json, apply it down the same bone
hierarchy, and rasterise the result.

This is a checking tool, not a shipped asset -- if a bone name in an animation
does not exist in the model, or an expression does not evaluate, that is a bug
the game would show as a limb that simply never moves, and it is reported here
rather than silently drawn as a still frame.
"""
import json, math, os, re, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import render as R

RP = R.RP
OUT = os.path.join(os.path.dirname(__file__), "preview", "anim")


# ------------------------------------------------------------------ molang
def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


ENV = {
    "COS": lambda d: math.cos(math.radians(d)),
    "SIN": lambda d: math.sin(math.radians(d)),
    "CLAMP": _clamp,
    "ABS": abs,
    "MOD": lambda a, b: math.fmod(a, b),
    "SQRT": math.sqrt,
    "LERP": lambda a, b, t: a + (b - a) * t,
}

_RE = [
    (re.compile(r"\bmath\.cos\s*\("), "COS("),
    (re.compile(r"\bmath\.sin\s*\("), "SIN("),
    (re.compile(r"\bmath\.clamp\s*\("), "CLAMP("),
    (re.compile(r"\bmath\.abs\s*\("), "ABS("),
    (re.compile(r"\bmath\.mod\s*\("), "MOD("),
    (re.compile(r"\bmath\.sqrt\s*\("), "SQRT("),
    (re.compile(r"\bmath\.lerp\s*\("), "LERP("),
    (re.compile(r"\bquery\.property\s*\(\s*'([^']+)'\s*\)"), r'CTX["prop:\1"]'),
    (re.compile(r"\bq\.property\s*\(\s*'([^']+)'\s*\)"), r'CTX["prop:\1"]'),
    (re.compile(r"\b(?:query|q)\.([a-z_][a-z0-9_]*)"), r'CTX["q:\1"]'),
    (re.compile(r"\b(?:variable|v)\.([a-z_][a-z0-9_]*)"), r'CTX["v:\1"]'),
]

_cache = {}


def molang(expr, ctx):
    """Evaluate one Molang expression to a float."""
    if isinstance(expr, (int, float)):
        return float(expr)
    src = _cache.get(expr)
    if src is None:
        src = str(expr).strip().rstrip(";")
        for rx, sub in _RE:
            src = rx.sub(sub, src)
        _cache[expr] = src
    try:
        return float(eval(src, {"__builtins__": {}}, dict(ENV, CTX=ctx)))
    except Exception as e:
        raise RuntimeError(f"molang failed: {expr!r} -> {src!r}: {e}")


def triple(val, ctx):
    if val is None:
        return None
    if isinstance(val, (int, float, str)):
        v = molang(val, ctx)
        return np.array([v, v, v], dtype=float)
    return np.array([molang(c, ctx) for c in val], dtype=float)


def keyed(chan, t, ctx, length):
    """A keyframed channel: linear between the surrounding keys."""
    ks = sorted((float(k), v) for k, v in chan.items())
    if t <= ks[0][0]:
        return triple(ks[0][1], ctx)
    if t >= ks[-1][0]:
        return triple(ks[-1][1], ctx)
    for (t0, v0), (t1, v1) in zip(ks, ks[1:]):
        if t0 <= t <= t1:
            a = triple(v0, ctx)
            b = triple(v1, ctx)
            f = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
            return a + (b - a) * f
    return triple(ks[-1][1], ctx)


def channel(chan, t, ctx, length):
    if isinstance(chan, dict):
        return keyed(chan, t, ctx, length)
    return triple(chan, ctx)


# ------------------------------------------------------------- pose solving
def pose(anims, names, t, ctx, bone_names, report):
    """Accumulate every playing animation into one per-bone pose."""
    out = {}
    for an in names:
        a = anims[an]
        length = float(a.get("animation_length", 0) or 0)
        tt = t
        if a.get("loop") is True and length:
            tt = math.fmod(t, length)
        elif length and a.get("loop") != True:
            tt = min(t, length)
        for bone, ch in a.get("bones", {}).items():
            if bone not in bone_names:
                report.setdefault("missing_bone", set()).add(f"{an}:{bone}")
                continue
            e = out.setdefault(bone, {"rotation": np.zeros(3),
                                      "position": np.zeros(3),
                                      "scale": np.ones(3)})
            if "rotation" in ch:
                e["rotation"] += channel(ch["rotation"], tt, ctx, length)
            if "position" in ch:
                e["position"] += channel(ch["position"], tt, ctx, length)
            if "scale" in ch:
                e["scale"] *= channel(ch["scale"], tt, ctx, length)
    return out


def bone_transforms(bones, ap):
    """render.bone_transforms, but with the animated pose folded in."""
    by = {b["name"]: b for b in bones}
    out = {}

    def solve(name):
        if name in out:
            return out[name]
        b = by[name]
        piv = np.array(b["pivot"], dtype=float)
        base = np.array(b.get("rotation", [0, 0, 0]), dtype=float)
        a = ap.get(name)
        rot = base + (a["rotation"] if a else 0.0)
        scl = a["scale"] if a else np.ones(3)
        pos = a["position"] if a else np.zeros(3)
        M = R.rot_mat(*rot) @ np.diag(scl)
        if b.get("parent") and b["parent"] in by:
            PR, PT = solve(b["parent"])
        else:
            PR, PT = np.eye(3), np.zeros(3)
        Rw = PR @ M
        Tw = PR @ (piv + pos - M @ piv) + PT
        out[name] = (Rw, Tw)
        return out[name]

    for b in bones:
        solve(b["name"])
    return out


def faces_for(geo, ap, yaw, pitch):
    bones = geo["bones"]
    tf = bone_transforms(bones, ap)
    tw = geo["description"]["texture_width"]
    th = geo["description"]["texture_height"]
    cam = R.rot_mat(pitch, yaw, 0)
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
            rects = R.face_rects(u, v, w, h, d)
            for fname, rect in rects.items():
                corners, normal = R.face_corners(p0, p1, fname)
                pts = np.array([cam @ (Rw @ np.array(p) + Tw) for p in corners])
                nrm = cam @ (Rw @ np.array(normal, dtype=float))
                faces.append((pts, nrm, rect, (tw, th), c.get("mirror", False)))
    return faces


def raster(faces, tex, size, ctr, scale, bg):
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
        if n[2] > 0.02:
            continue
        shade = 0.42 + 0.58 * max(0.0, float(np.dot(n, light)))
        rx, ry, rw, rh = rect
        for idx, uvc in [((0, 1, 2), ((0, 0), (1, 0), (1, 1))),
                         ((0, 2, 3), ((0, 0), (1, 1), (0, 1)))]:
            X, Y, Z = sx[list(idx)], sy[list(idx)], depth[list(idx)]
            minx, maxx = int(max(0, np.floor(X.min()))), int(min(size - 1, np.ceil(X.max())))
            miny, maxy = int(max(0, np.floor(Y.min()))), int(min(size - 1, np.ceil(Y.max())))
            if minx > maxx or miny > maxy:
                continue
            gx, gy = np.meshgrid(np.arange(minx, maxx + 1) + 0.5,
                                 np.arange(miny, maxy + 1) + 0.5)
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
            img[miny:maxy + 1, minx:maxx + 1][m] = col[m]
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), "RGBA")


# ------------------------------------------------------------------- driver
def load_anims():
    out = {}
    d = os.path.join(RP, "animations")
    for f in sorted(os.listdir(d)):
        out.update(json.load(open(os.path.join(d, f)))["animations"])
    return out


def ctx_for(name, t, walking, decay=1):
    speed = 1.0 if walking else 0.0
    seed = (abs(hash(name)) % 1000) / 1000.0 * 6.2832
    awake = _clamp(speed * 6.0, 0.0, 1.0)
    c = {
        "q:life_time": t,
        "q:modified_move_speed": speed,
        "q:modified_distance_moved": t * 4.0 if walking else 0.0,
        "q:ground_speed": speed,
        "q:vertical_speed": 0.0,
        "q:is_on_ground": 1.0,
        "q:has_target": 0.0,
        "prop:sl:state": "roaming" if walking else "still",
        "prop:sl:temper": "peaceful",
        "prop:sl:motion": "wander" if walking else "sentinel",
        "prop:sl:awake": walking,
        "prop:sl:decay": decay,
        "v:sl_seed": seed,
        "v:sl_skew": 0.55,
        "v:sl_awake": awake,
        "v:sl_rest": 1.0 - awake,
        "v:sl_hostile": 0.0,
    }
    c["v:sl_t"] = t * (0.35 + awake * 5.5)
    c["v:sl_amp"] = 0.30 + awake * 0.85 + decay * 0.35
    return c


def playlist(name, anims):
    """What the client entity actually animates, minus the bits that need a
    live game (target tracking, the action controller)."""
    ce = json.load(open(os.path.join(RP, "entity", f"{name}.entity.json")))
    d = ce["minecraft:client_entity"]["description"]
    amap = d["animations"]
    want = []
    for item in d["scripts"]["animate"]:
        key = item if isinstance(item, str) else next(iter(item))
        if key in ("look_at", "action", "alert", "panic"):
            continue
        ref = amap.get(key)
        if ref and ref in anims:
            want.append(ref)
    return want


def clip(name, walking, frames=24, dur=1.6, size=300, report=None):
    geo, tex = R.load_model(name)
    anims = load_anims()
    names = playlist(name, anims)
    bone_names = {b["name"] for b in geo["bones"]}
    report = report if report is not None else {}
    report.setdefault("played", {})[name] = names

    poses = [pose(anims, names, dur * i / frames, ctx_for(name, dur * i / frames, walking),
                  bone_names, report) for i in range(frames)]
    fs = [faces_for(geo, p, -32, 12) for p in poses]
    allp = np.concatenate([f[0] for fr in fs for f in fr])
    lo, hi = allp.min(axis=0), allp.max(axis=0)
    ctr = (lo + hi) / 2
    span = max(hi[0] - lo[0], hi[1] - lo[1]) or 1.0
    scale = size * 0.74 / span
    return [raster(f, tex, size, ctr, scale, (14, 13, 12, 255)) for f in fs]


def motion_of(frames):
    """How much the drawing actually changes across the clip. The whole point
    of this tool: a number that is zero means nothing moved."""
    a = [np.asarray(f.convert("L"), dtype=float) for f in frames]
    base = a[0]
    return max(float(np.abs(x - base).mean()) for x in a[1:])


ORDER = ["still_villager", "still_cow", "still_pig", "still_sheep", "still_chicken",
         "still_wolf", "still_player", "the_tall_one", "captain_clark"]
LABEL = {"still_villager": "villager", "still_cow": "cow", "still_pig": "pig",
         "still_sheep": "sheep", "still_chicken": "chicken", "still_wolf": "wolf",
         "still_player": "the copy", "the_tall_one": "the tall one",
         "captain_clark": "cap'n clark"}


def grid(mode, frames=24, cell=250):
    from PIL import ImageDraw, ImageFont
    try:
        font = ImageFont.truetype(R.FONT_R, 19)
    except Exception:
        font = ImageFont.load_default()
    walking = mode == "walk"
    report = {}
    clips = {n: clip(n, walking, frames=frames, size=cell, report=report)
             for n in ORDER}
    pad, head = 12, 44
    W = pad + 3 * (cell + pad)
    H = head + pad + 3 * (cell + 26 + pad)
    out = []
    title = ("WALKING  --  every still life, its own walk cycle"
             if walking else
             "HOLDING POSE  --  the living idle: breathing, weight shift, a slow scan")
    for f in range(frames):
        im = Image.new("RGBA", (W, H), (18, 17, 16, 255))
        d = ImageDraw.Draw(im)
        d.text((pad + 2, 14), title, font=font, fill=(198, 186, 150, 255))
        for i, n in enumerate(ORDER):
            cx = pad + (i % 3) * (cell + pad)
            cy = head + pad + (i // 3) * (cell + 26 + pad)
            im.alpha_composite(clips[n][f], (cx, cy))
            d.text((cx + 4, cy + cell + 4), LABEL[n], font=font,
                   fill=(150, 142, 120, 255))
        out.append(im.convert("P", palette=Image.ADAPTIVE, colors=128))
    return out, report


def main():
    os.makedirs(OUT, exist_ok=True)
    print(f"{'mob':<16}{'walk':>8}{'held':>8}  animations driving it")
    report = {}
    worst = []
    for n in ORDER:
        w = motion_of(clip(n, True, frames=12, report=report))
        h = motion_of(clip(n, False, frames=12, report=report))
        print(f"{n:<16}{w:>8.2f}{h:>8.2f}  {len(report['played'][n])}")
        if w < 0.3 or h < 0.3:
            worst.append(n)
    miss = report.get("missing_bone")
    if miss:
        print(f"\nBONES AN ANIMATION DRIVES THAT THE MODEL DOES NOT HAVE: {sorted(miss)}")
    if worst:
        print(f"\nMOBS THAT DO NOT VISIBLY MOVE: {worst}")
    for mode in ("walk", "idle"):
        fr, _ = grid(mode)
        p = os.path.join(OUT, f"{mode}.gif")
        fr[0].save(p, save_all=True, append_images=fr[1:], duration=66, loop=0,
                   optimize=True, disposal=2)
        print(f"wrote {p}  ({len(fr)} frames)")
    return 1 if (miss or worst) else 0


if __name__ == "__main__":
    sys.exit(main())
