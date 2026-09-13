"""
Shared mob definitions for the STILL LIFE add-on.

Every model is authored from scratch but uses VANILLA BONE NAMES
(body / head / leg0..leg3 / rightArm / leftArm / rightLeg / leftLeg / wing0 ...)
so that the vanilla animation math in animations/*.animation.json drives them
exactly the way the real mob moves.  The "distortion" is baked into cube
proportions + textures, and layered on top at runtime by
animation.sl.distort, so the walk cycle stays recognisably Minecraft.
"""

# ---------------------------------------------------------------- palettes
# base = the honest vanilla-ish colour, the still life is derived from it
P = {
    "skin":      (0xC0, 0x9A, 0x78),
    "robe":      (0x6D, 0x4E, 0x38),
    "robe_dk":   (0x4A, 0x37, 0x28),
    "apron":     (0x9A, 0x8B, 0x74),
    "cow_dark":  (0x44, 0x36, 0x26),
    "cow_light": (0xD6, 0xD6, 0xD6),
    "horn":      (0xC4, 0xC4, 0xC4),
    "pig":       (0xF0, 0xA5, 0xA2),
    "pig_dk":    (0xD9, 0x8A, 0x86),
    "wool":      (0xE7, 0xE7, 0xE7),
    "wool_dk":   (0xC9, 0xC5, 0xBD),
    "chick":     (0xE3, 0xE3, 0xE3),
    "beak":      (0xF0, 0xAF, 0x00),
    "wattle":    (0xC3, 0x22, 0x1D),
    "wolf":      (0xD7, 0xD3, 0xD3),
    "wolf_dk":   (0xB0, 0xA8, 0xA4),
    "shirt":     (0x3C, 0x44, 0xAA),
    "pants":     (0x2A, 0x2A, 0x6E),
    "hair":      (0x2A, 0x1B, 0x10),
    "tall":      (0xB9, 0xB2, 0x9C),
    "tall_dk":   (0x8C, 0x86, 0x72),
    "tall_leg":  (0x63, 0x5E, 0x50),
    "olive":     (0x4A, 0x52, 0x38),
    "olive_dk":  (0x33, 0x39, 0x27),
    "brass":     (0xB8, 0x92, 0x3C),
    "pale":      (0xCB, 0xC2, 0xA8),
    "void":      (0x0A, 0x0A, 0x0A),
    # Cap'n Clark, the furniture-store pirate mascot the Backrooms copied
    "ck_teal":   (0x2E, 0x8C, 0x8E),   # turquoise button-up, big collars
    "ck_vest":   (0xC9, 0xB9, 0x92),   # long beige vest
    "ck_sash":   (0x6B, 0x3E, 0x7A),   # purplish sash
    "ck_belt":   (0x1A, 0x16, 0x12),
    "ck_pants":  (0x4A, 0x38, 0x28),   # dark brown
    "ck_peg":    (0xC8, 0x8E, 0x3C),   # amber wooden peg leg
    "ck_sock":   (0xE8, 0xE6, 0xDC),   # white crew sock, right leg only
    "ck_shoe":   (0x5A, 0x3C, 0x24),   # brown Oxford
    "ck_skin":   (0x82, 0x59, 0x40),
    "ck_beard":  (0x1E, 0x18, 0x14),
    "ck_hat":    (0x2A, 0x24, 0x1E),   # tricorne
    "ck_feath":  (0xE4, 0xD8, 0xB4),
    "ck_feath2": (0x9A, 0x2E, 0x2E),
}


def cube(name, origin, size, color, inflate=0.0, face=None, mirror=False):
    """One box. `face` marks the cube that gets eyes/mouth painted on -Z."""
    return dict(name=name, origin=list(origin), size=list(size), color=color,
                inflate=inflate, face=face, mirror=mirror)


def bone(name, pivot, cubes, parent=None, rotation=None):
    b = dict(name=name, pivot=list(pivot), cubes=cubes)
    if parent:
        b["parent"] = parent
    if rotation:
        b["rotation"] = list(rotation)
    return b


# ---------------------------------------------------------------- HUMANOID
def humanoid(tall=1.0, skin="skin", top="shirt", bottom="pants", hair="hair",
             thin_arms=False, face="human", girth=0, arms=None, gap=0):
    """Vanilla player skeleton. `tall` stretches limbs + torso only, so the
    head stays head-sized and the thing reads as a person who is WRONG."""
    aw = 3 if thin_arms else 4 + girth
    ac = arms or top                 # arms can differ from the torso so a very
    bw = 4 + girth                   # tall silhouette still reads as a person
    th = round(12 * tall, 1)          # torso height
    lh = round(12 * tall, 1)          # limb height
    hip = lh
    sh = lh + th                       # shoulder height
    return dict(
        texture=(64, 64),
        bones=[
            bone("root", [0, 0, 0], []),
            bone("waist", [0, hip, 0], [], parent="root"),
            bone("body", [0, sh, 0], [
                cube("body", [-bw, hip, -2 - girth / 2],
                     [bw * 2, th, 4 + girth], P[top]),
            ], parent="waist"),
            bone("head", [0, sh, 0], [
                cube("head", [-4, sh, -4], [8, 8, 8], P[skin], face=face),
            ], parent="body"),
            bone("hat", [0, sh, 0], [
                cube("hairTop",  [-4, sh + 6, -4], [8, 2, 8], P[hair], inflate=0.4),
                cube("hairBack", [-4, sh + 1, 3.4], [8, 5, 1], P[hair], inflate=0.3),
            ], parent="head"),
            bone("rightArm", [-bw - 1, sh - 2, 0], [
                cube("rightArm", [-bw - gap - aw, hip, -2], [aw, lh, 4], P[ac]),
            ], parent="body"),
            bone("leftArm", [bw + 1, sh - 2, 0], [
                cube("leftArm", [bw + gap, hip, -2], [aw, lh, 4], P[ac], mirror=True),
            ], parent="body"),
            bone("rightLeg", [-1.9, hip, 0], [
                cube("rightLeg", [-4, 0, -2], [4, hip, 4], P[bottom]),
            ], parent="root"),
            bone("leftLeg", [1.9, hip, 0], [
                cube("leftLeg", [0, 0, -2], [4, hip, 4], P[bottom], mirror=True),
            ], parent="root"),
        ])


# ---------------------------------------------------------------- QUADRUPED
def quadruped(bw, bh, bd, legh, legw, head, extras=(), body_col="cow_dark",
              leg_col="cow_dark", face="animal", tail=None):
    """Vanilla quadruped skeleton: body / head / leg0..leg3, head at -Z."""
    body_y = legh
    hz = -bd / 2
    bones = [
        bone("root", [0, 0, 0], []),
        bone("body", [0, body_y + bh / 2, 0], [
            cube("body", [-bw / 2, body_y, -bd / 2], [bw, bh, bd], P[body_col]),
        ], parent="root"),
        bone("head", [0, head["y"], hz], [
            cube("head", [-head["w"] / 2, head["y"] - head["h"] / 2,
                          hz - head["d"]], [head["w"], head["h"], head["d"]],
                 P[head.get("col", body_col)], face=face),
        ] + list(extras), parent="body"),
    ]
    for i, (x, z) in enumerate([(-bw / 2 + legw / 2, -bd / 2 + legw / 2),
                                (bw / 2 - legw / 2, -bd / 2 + legw / 2),
                                (-bw / 2 + legw / 2, bd / 2 - legw / 2),
                                (bw / 2 - legw / 2, bd / 2 - legw / 2)]):
        bones.append(bone(f"leg{i}", [x, legh, z], [
            cube(f"leg{i}", [x - legw / 2, 0, z - legw / 2],
                 [legw, legh, legw], P[leg_col], mirror=(i % 2 == 1)),
        ], parent="root"))
    if tail:
        bones.append(bone("tail", [0, body_y + bh, bd / 2], [
            cube("tail", [-tail[0] / 2, body_y + bh - tail[1], bd / 2],
                 [tail[0], tail[1], tail[2]], P[body_col]),
        ], parent="body"))
    return dict(texture=(64, 64), bones=bones)


# ---------------------------------------------------------------- the roster
def build_all():
    M = {}

    # --- STILL LIFE: VILLAGER ------------------------------------------
    M["still_villager"] = dict(texture=(64, 64), bones=[
        bone("root", [0, 0, 0], []),
        bone("body", [0, 24, 0], [
            cube("body",  [-4, 12, -3], [8, 12, 6], P["robe"]),
            cube("skirt", [-4, 6, -3],  [8, 8, 6],  P["robe_dk"], inflate=0.4),
        ], parent="root"),
        bone("head", [0, 24, 0], [
            cube("head", [-4, 24, -4], [8, 10, 8], P["skin"], face="villager"),
        ], parent="body"),
        bone("nose", [0, 26, 0], [
            cube("nose", [-1, 25, -6], [2, 4, 2], P["skin"]),
        ], parent="head"),
        # vanilla villagers keep their arms folded in front -- kept, then
        # skewed by the distortion layer so the fold reads as *too tight*
        bone("arms", [0, 22, 0], [
            cube("armsC", [-4, 16, -3], [8, 4, 4], P["apron"]),
            cube("armR",  [-8, 16, -2], [4, 8, 4], P["robe"]),
            cube("armL",  [4, 16, -2],  [4, 8, 4], P["robe"], mirror=True),
        ], parent="body", rotation=[-40, 0, 0]),
        bone("leg0", [-2, 12, 0], [
            cube("leg0", [-4, 0, -2], [4, 12, 4], P["robe_dk"]),
        ], parent="root"),
        bone("leg1", [2, 12, 0], [
            cube("leg1", [0, 0, -2], [4, 12, 4], P["robe_dk"], mirror=True),
        ], parent="root"),
    ])

    # --- STILL LIFE: COW -------------------------------------------------
    M["still_cow"] = quadruped(
        bw=12, bh=10, bd=18, legh=12, legw=4,
        head=dict(y=21, w=8, h=8, d=8, col="cow_light"),
        extras=[cube("hornR", [-5, 23, -13], [1, 3, 1], P["horn"]),
                cube("hornL", [4, 23, -13], [1, 3, 1], P["horn"], mirror=True)],
        body_col="cow_dark", leg_col="cow_dark", face="cow")

    # --- STILL LIFE: PIG -------------------------------------------------
    M["still_pig"] = quadruped(
        bw=10, bh=8, bd=16, legh=6, legw=4,
        head=dict(y=12, w=8, h=8, d=8, col="pig"),
        extras=[cube("snout", [-2, 10, -16], [4, 3, 1], P["pig_dk"])],
        body_col="pig", leg_col="pig", face="pig")

    # --- STILL LIFE: SHEEP -----------------------------------------------
    M["still_sheep"] = quadruped(
        bw=10, bh=10, bd=16, legh=12, legw=4,
        head=dict(y=22, w=6, h=6, d=8, col="wool_dk"),
        body_col="wool", leg_col="wool_dk", face="sheep")

    # --- STILL LIFE: CHICKEN ---------------------------------------------
    # legs 0-5, body 5-11, head 11-17: one connected bird, not a pile of parts
    M["still_chicken"] = dict(texture=(64, 32), bones=[
        bone("root", [0, 0, 0], []),
        bone("body", [0, 8, 0], [
            cube("body", [-3, 5, -3], [6, 6, 8], P["chick"]),
        ], parent="root"),
        bone("head", [0, 11, -3], [
            cube("head", [-2, 11, -6], [4, 6, 3], P["chick"], face="bird"),
        ], parent="body"),
        bone("beak", [0, 11, -3], [
            cube("beak", [-2, 13, -8], [4, 2, 2], P["beak"]),
        ], parent="head"),
        bone("wattle", [0, 11, -3], [
            cube("wattle", [-1, 11, -7], [2, 2, 2], P["wattle"]),
        ], parent="head"),
        bone("wing0", [-3, 10, 0], [
            cube("wing0", [-4, 6, -2], [1, 4, 6], P["chick"]),
        ], parent="body"),
        bone("wing1", [3, 10, 0], [
            cube("wing1", [3, 6, -2], [1, 4, 6], P["chick"], mirror=True),
        ], parent="body"),
        bone("leg0", [-2, 5, 0], [
            cube("leg0", [-3, 0, -1], [3, 5, 3], P["beak"]),
        ], parent="root"),
        bone("leg1", [2, 5, 0], [
            cube("leg1", [0, 0, -1], [3, 5, 3], P["beak"], mirror=True),
        ], parent="root"),
    ])

    # --- STILL LIFE: WOLF ------------------------------------------------
    M["still_wolf"] = quadruped(
        bw=6, bh=6, bd=14, legh=8, legw=2,
        head=dict(y=14, w=6, h=6, d=6, col="wolf"),
        extras=[cube("earR", [-3, 17, -12], [2, 2, 1], P["wolf_dk"]),
                cube("earL", [1, 17, -12], [2, 2, 1], P["wolf_dk"], mirror=True),
                cube("muzzle", [-1.5, 11.5, -15], [3, 3, 2], P["wolf_dk"])],
        body_col="wolf", leg_col="wolf_dk", face="wolf", tail=(2, 8, 2))

    # --- THE COPY (player-shaped still life) -----------------------------
    M["still_player"] = humanoid(tall=1.0, face="copy")

    # --- THE TALL ONE (boss) ---------------------------------------------
    # tall and lanky, but the limbs are a different tone from the torso or the
    # whole thing renders as one featureless column
    M["the_tall_one"] = humanoid(tall=2.2, skin="tall", top="tall_dk",
                                 bottom="tall_leg", hair="void", arms="tall",
                                 thin_arms=False, face="tall", girth=1, gap=1)

    # --- CAPTAIN CLARK (backrooms boss) ----------------------------------
    # A large Still Life copying Clark as "Cap'n Clark", the pirate mascot
    # from his own furniture-store commercial: tricorne with two feathers,
    # turquoise button-up under a long beige vest, purple sash, an amber peg
    # leg on the left, and a right arm still held out at the angle of the
    # crutch he had tucked under it on set. ~2.4 blocks -- malformed and a
    # head and a half taller than a player, but nowhere near the Tall One.
    M["captain_clark"] = dict(texture=(128, 128), bones=[
        bone("root", [0, 0, 0], []),
        bone("waist", [0, 15, 0], [], parent="root"),
        bone("body", [0, 30, 0], [
            cube("shirt",  [-4, 15, -2], [8, 15, 4], P["ck_teal"]),
            cube("vestR",  [-4, 16, -2], [3, 13.5, 4], P["ck_vest"], inflate=0.30),
            cube("vestL",  [1, 16, -2],  [3, 13.5, 4], P["ck_vest"], inflate=0.30,
                 mirror=True),
            cube("vestBk", [-4, 16, 1.4], [8, 13.5, 1], P["ck_vest"], inflate=0.30),
            cube("sash",   [-4, 18.5, -2], [8, 3, 4],  P["ck_sash"], inflate=0.62),
            cube("belt",   [-4, 15, -2], [8, 2, 4],  P["ck_belt"], inflate=0.55),
            cube("collarR", [-4.3, 26.5, -2.8], [3, 3, 1], P["ck_teal"]),
            cube("collarL", [1.3, 26.5, -2.8], [3, 3, 1], P["ck_teal"], mirror=True),
        ], parent="waist"),
        bone("head", [0, 30, 0], [
            cube("head",  [-4, 30, -4], [8, 8, 8], P["ck_skin"], face="clark"),
            cube("beard", [-4, 30, -4.6], [8, 3, 1], P["ck_beard"]),
            cube("jawR",  [-4.5, 30, -4], [1, 3, 8], P["ck_beard"]),
            cube("jawL",  [3.5, 30, -4], [1, 3, 8], P["ck_beard"], mirror=True),
        ], parent="body"),
        bone("hat", [0, 38, 0], [
            cube("crown",  [-4, 38, -4], [8, 3, 8], P["ck_hat"], inflate=0.55),
            cube("brim",   [-6.5, 37.6, -6.5], [13, 1, 13], P["ck_hat"]),
            cube("cornF",  [-2.5, 38.4, -6.6], [5, 2, 1], P["ck_hat"]),
            cube("cornR",  [-6.6, 38.4, -2.5], [1, 2, 5], P["ck_hat"]),
            cube("cornL",  [5.6, 38.4, -2.5], [1, 2, 5], P["ck_hat"], mirror=True),
            cube("feath1", [4.4, 40.5, -2], [1, 6, 4], P["ck_feath"]),
            cube("feath2", [5.6, 39.5, 0.5], [1, 5, 4], P["ck_feath2"]),
        ], parent="head"),
        # the arm the crutch was under. it never came back down.
        bone("rightArm", [-5, 28, 0], [
            cube("rSleeve", [-8, 17, -2], [4, 13, 4], P["ck_teal"]),
            cube("rCuff",   [-8, 16, -2], [4, 2, 4], P["ck_vest"], inflate=0.25),
            cube("rHand",   [-8.5, 12, -2.5], [5, 4, 5], P["ck_skin"]),
            cube("rRing1",  [-8.7, 13, -2.7], [1, 1, 1], P["brass"]),
            cube("rRing2",  [-8.7, 14, -1.2], [1, 1, 1], P["brass"]),
        ], parent="body", rotation=[0, 0, -34]),
        bone("leftArm", [5, 28, 0], [
            cube("lSleeve", [4, 17, -2], [4, 13, 4], P["ck_teal"], mirror=True),
            cube("lCuff",   [4, 16, -2], [4, 2, 4], P["ck_vest"], inflate=0.25),
            cube("lHand",   [3.5, 12, -2.5], [5, 4, 5], P["ck_skin"], mirror=True),
            cube("lRing1",  [8.2, 13, -2.7], [1, 1, 1], P["brass"]),
            cube("lRing2",  [8.2, 14, -1.2], [1, 1, 1], P["brass"]),
        ], parent="body", rotation=[0, 0, 11]),
        # right leg: sock and Oxford shoe
        bone("rightLeg", [-1.9, 15, 0], [
            cube("rTrouser", [-4, 4, -2], [4, 11, 4], P["ck_pants"]),
            cube("rSock",    [-4, 2, -2], [4, 2, 4], P["ck_sock"], inflate=0.1),
            cube("rShoe",    [-4, 0, -2.8], [4, 2, 5], P["ck_shoe"]),
        ], parent="root"),
        # left leg: the peg
        bone("leftLeg", [1.9, 15, 0], [
            cube("lTrouser", [0, 7, -2], [4, 8, 4], P["ck_pants"], mirror=True),
            cube("lPegTop",  [0.5, 4, -1.5], [3, 3, 3], P["ck_peg"]),
            cube("lPeg",     [1, 0, -1], [2, 4, 2], P["ck_peg"]),
        ], parent="root"),
    ])

    return M


MOBS = build_all()

FACE_STYLE = {
    # Proper Minecraft eyes: a sclera pixel and a pupil pixel per eye, drawn
    # symmetrically so the pupils sit inboard the way vanilla mobs' do.
    # `w` is the eye width in pixels -- 1 on faces too narrow for a pair.
    "villager": dict(eyes=[(1, 3), (5, 3)], w=2, sclera=(0xF2, 0xF0, 0xE6),
                     pupil=(0x3C, 0x4C, 0x6A), mouth=(3, 6, 2, 1), brow=True),
    "human":    dict(eyes=[(1, 3), (5, 3)], w=2, sclera=(0xF4, 0xF2, 0xEA),
                     pupil=(0x4A, 0x33, 0x22), mouth=(3, 6, 2, 1), brow=False),
    "copy":     dict(eyes=[(1, 3), (5, 3)], w=2, sclera=(0xEE, 0xEC, 0xE2),
                     pupil=(0x3A, 0x4E, 0x74), mouth=(2, 6, 4, 1), brow=False),
    "tall":     dict(eyes=[(1, 3), (5, 3)], w=2, sclera=(0xE6, 0xE2, 0xD2),
                     pupil=(0x2A, 0x26, 0x22), mouth=(1, 6, 6, 2), brow=False),
    "clark":    dict(eyes=[(1, 3), (5, 3)], w=2, sclera=(0xF0, 0xEC, 0xDE),
                     pupil=(0x4A, 0x2E, 0x1C), mouth=None, brow=True, scar=True),
    "cow":      dict(eyes=[(1, 2), (5, 2)], w=2, sclera=(0xF0, 0xEE, 0xE6),
                     pupil=(0x2E, 0x24, 0x1C), mouth=(2, 5, 4, 2), brow=False),
    "pig":      dict(eyes=[(1, 2), (5, 2)], w=2, sclera=(0xF2, 0xEA, 0xE6),
                     pupil=(0x33, 0x22, 0x1E), mouth=(2, 5, 4, 2), brow=False),
    "sheep":    dict(eyes=[(0, 2), (4, 2)], w=2, sclera=(0xF2, 0xF0, 0xEA),
                     pupil=(0x2C, 0x26, 0x20), mouth=(2, 4, 2, 1), brow=False),
    "wolf":     dict(eyes=[(0, 1), (4, 1)], w=2, sclera=(0xF0, 0xEE, 0xE8),
                     pupil=(0x3A, 0x2C, 0x1E), mouth=(2, 3, 2, 2), brow=False),
    "bird":     dict(eyes=[(0, 1), (3, 1)], w=1, sclera=(0xF0, 0xEE, 0xE6),
                     pupil=(0x28, 0x22, 0x1C), mouth=None, brow=False),
    "animal":   dict(eyes=[(1, 2), (5, 2)], w=2, sclera=(0xF0, 0xEE, 0xE6),
                     pupil=(0x2E, 0x26, 0x1E), mouth=None, brow=False),
}


# ---------------------------------------------------------------- armour
# Bone names match the vanilla player skeleton so the attachables ride the
# player's own animations (walking, sneaking, swimming) with no extra work.
def armour():
    A = {}
    A["armor_helmet"] = dict(texture=(64, 32), bones=[
        bone("head", [0, 24, 0], [
            cube("helm", [-4, 24, -4], [8, 8, 8], P["pale"], inflate=1.0),
            cube("crest", [-1, 32, -4], [2, 2, 8], P["olive_dk"], inflate=1.0),
        ]),
    ])
    A["armor_chest"] = dict(texture=(64, 64), bones=[
        bone("body", [0, 24, 0], [
            cube("chest", [-4, 12, -2], [8, 12, 4], P["pale"], inflate=1.01),
        ]),
        bone("rightArm", [-5, 22, 0], [
            cube("rsleeve", [-8, 12, -2], [4, 12, 4], P["pale"], inflate=1.0),
        ]),
        bone("leftArm", [5, 22, 0], [
            cube("lsleeve", [4, 12, -2], [4, 12, 4], P["pale"], inflate=1.0, mirror=True),
        ]),
    ])
    A["armor_legs"] = dict(texture=(64, 32), bones=[
        bone("body", [0, 24, 0], [
            cube("belt", [-4, 12, -2], [8, 12, 4], P["pale"], inflate=0.5),
        ]),
        bone("rightLeg", [-1.9, 12, 0], [
            cube("rleg", [-4, 0, -2], [4, 12, 4], P["pale"], inflate=0.5),
        ]),
        bone("leftLeg", [1.9, 12, 0], [
            cube("lleg", [0, 0, -2], [4, 12, 4], P["pale"], inflate=0.5, mirror=True),
        ]),
    ])
    A["armor_boots"] = dict(texture=(64, 32), bones=[
        bone("rightLeg", [-1.9, 12, 0], [
            cube("rboot", [-4, 0, -2], [4, 6, 4], P["pale"], inflate=1.0),
        ]),
        bone("leftLeg", [1.9, 12, 0], [
            cube("lboot", [0, 0, -2], [4, 6, 4], P["pale"], inflate=1.0, mirror=True),
        ]),
    ])
    return A


ARMOUR = armour()
