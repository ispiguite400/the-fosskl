"""The Copy and The Tall One: the vanilla player model, nothing invented.

Both use the standard 64x64 player skin UV layout and the vanilla
`textures/entity/steve` texture that ships with the game -- this add-on
supplies no artwork for either of them.

The Copy is the player model at exactly vanilla proportions.
The Tall One is the same model with the torso and limbs stretched vertically
while the head stays head-sized, so the skin smears up the body. That stretch
is the whole silhouette: a very tall version of the player.
"""
import json, os

RP = os.path.join(os.path.dirname(__file__), "..", "packs", "StillLife_RP")
GEO = os.path.join(RP, "models", "entity")

# Vanilla player skin layout. Do not change these UVs -- they are what makes
# a real Minecraft skin land in the right places.
PARTS = [
    # bone,        pivot(y-scaled?), origin,           size,        uv,        inflate, mirror
    ("head",      (0, 24, 0),  (-4, 24, -4), (8, 8, 8),  (0, 0),   0.0,  False),
    ("hat",       (0, 24, 0),  (-4, 24, -4), (8, 8, 8),  (32, 0),  0.5,  False),
    ("body",      (0, 24, 0),  (-4, 12, -2), (8, 12, 4), (16, 16), 0.0,  False),
    ("body",      (0, 24, 0),  (-4, 12, -2), (8, 12, 4), (16, 32), 0.25, False),
    ("rightArm",  (-5, 22, 0), (-8, 12, -2), (4, 12, 4), (40, 16), 0.0,  False),
    ("rightArm",  (-5, 22, 0), (-8, 12, -2), (4, 12, 4), (40, 32), 0.25, False),
    ("leftArm",   (5, 22, 0),  (4, 12, -2),  (4, 12, 4), (32, 48), 0.0,  True),
    ("leftArm",   (5, 22, 0),  (4, 12, -2),  (4, 12, 4), (48, 48), 0.25, True),
    ("rightLeg",  (-1.9, 12, 0), (-4, 0, -2), (4, 12, 4), (0, 16), 0.0,  False),
    ("rightLeg",  (-1.9, 12, 0), (-4, 0, -2), (4, 12, 4), (0, 32), 0.25, False),
    ("leftLeg",   (1.9, 12, 0),  (0, 0, -2),  (4, 12, 4), (16, 48), 0.0, True),
    ("leftLeg",   (1.9, 12, 0),  (0, 0, -2),  (4, 12, 4), (0, 48),  0.25, True),
]
PARENT = {"head": "body", "hat": "head", "body": "waist",
          "rightArm": "body", "leftArm": "body",
          "rightLeg": "root", "leftLeg": "root"}


def build(ident, stretch=1.0):
    """stretch scales torso and limb HEIGHT only. The head stays 8x8x8, which
    is what makes a tall one read as a stretched person rather than a giant."""
    S = stretch
    hip = 12.0 * S          # top of the legs
    sh = 24.0 * S           # shoulder / neck line

    def sy(v):
        """Map a vanilla y coordinate onto the stretched skeleton."""
        if v >= 24:
            return sh + (v - 24)          # head sits on top, unscaled
        return v * S

    bones = {}
    order = ["root", "waist", "body", "head", "hat",
             "rightArm", "leftArm", "rightLeg", "leftLeg"]
    for name in order:
        b = {"name": name, "pivot": [0, 0, 0]}
        if name in PARENT:
            b["parent"] = PARENT[name]
        bones[name] = b
    bones["root"]["pivot"] = [0, 0, 0]
    bones["waist"]["pivot"] = [0, round(hip, 2), 0]
    bones["waist"]["parent"] = "root"

    for name, piv, org, size, uv, inf, mir in PARTS:
        b = bones[name]
        b["pivot"] = [piv[0], round(sy(piv[1]), 2), piv[2]]
        c = {"origin": [org[0], round(sy(org[1]), 2), org[2]],
             "size": [size[0], round(size[1] * (S if name != "head" and name != "hat" else 1.0), 2),
                      size[2]],
             "uv": list(uv)}
        if inf:
            c["inflate"] = inf
        if mir:
            c["mirror"] = True
        b.setdefault("cubes", []).append(c)

    top = sy(24) + 8
    geo = {
        "format_version": "1.16.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": f"geometry.sl.{ident}",
                "texture_width": 64, "texture_height": 64,
                "visible_bounds_width": 3,
                "visible_bounds_height": round(top / 16 + 0.6, 2),
                "visible_bounds_offset": [0, round(top / 32, 2), 0],
            },
            "bones": [bones[n] for n in order],
        }],
    }
    os.makedirs(GEO, exist_ok=True)
    with open(os.path.join(GEO, f"{ident}.geo.json"), "w") as f:
        json.dump(geo, f, indent=2)
    return top / 16


if __name__ == "__main__":
    h1 = build("still_player", 1.0)
    h2 = build("the_tall_one", 3.6)
    print(f"still_player  {h1:.2f} blocks  (vanilla player proportions)")
    print(f"the_tall_one  {h2:.2f} blocks  (same model, torso+limbs x3.6)")
