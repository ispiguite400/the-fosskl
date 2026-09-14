"""Generate every JSON definition in the STILL LIFE resource pack."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from sprites import ITEMS, BLOCKS

RP = os.path.join(os.path.dirname(__file__), "..", "packs", "StillLife_RP")


def w(rel, obj):
    p = os.path.join(RP, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        json.dump(obj, f, indent=2)


# ------------------------------------------------------------------ roster
FAM_BONES = {
    "humanoid": ["body", "head", "leftArm", "rightArm", "leftLeg", "rightLeg"],
    "tall":     ["body", "head", "leftArm", "rightArm", "leftLeg", "rightLeg"],
    "villager": ["body", "head", "nose", "arms", "leg0", "leg1"],
    "quad":     ["body", "head", "leg0", "leg1", "leg2", "leg3"],
    "bird":     ["body", "head", "beak", "wing0", "wing1", "leg0", "leg1"],
}
FAM_MOVE = {"humanoid": "humanoid", "tall": "tall", "villager": "villager",
            "quad": "quadruped", "bird": "chicken"}
FAM_ATTACK = {"humanoid": "humanoid", "tall": "humanoid", "villager": "villager",
              "quad": "quadruped", "bird": "quadruped"}

ENTS = {
    "still_villager": dict(fam="villager", decay=3, egg=("#8A7A4E", "#3A2E1E")),
    "still_cow":      dict(fam="quad", decay=3, egg=("#6B5A42", "#C9C4B4")),
    "still_pig":      dict(fam="quad", decay=1, egg=("#C99A8E", "#7A5A52")),
    "still_sheep":    dict(fam="quad", decay=1, egg=("#CFC8B4", "#8A8375")),
    "still_chicken":  dict(fam="bird", decay=1, egg=("#CFCABA", "#C08A20")),
    "still_wolf":     dict(fam="quad", decay=1, tail=True, egg=("#BDB6AE", "#6E665E")),
    # vanilla=True: renders as the player, with the player's own skin, and
    # skips the distortion layer entirely. No custom artwork.
    "still_player":   dict(fam="humanoid", decay=1, vanilla=True,
                           egg=("#9A8A62", "#3C44AA")),
    "the_tall_one":   dict(fam="tall", decay=1, vanilla=True, boss=True,
                           egg=("#0F0E0C", "#C8B45A")),
    "captain_clark":  dict(fam="humanoid", decay=1, egg=("#3A402C", "#B8923C"), boss=True),
}


# --------------------------------------------------- the distortion layer
def distort_anim(fam):
    """The signature look: every still life is warped, and warped uniquely.

    variable.sl_skew is rolled once per entity and never re-rolled (`??`), so
    two still villagers standing side by side are wrong in different ways.
    variable.sl_awake gates the motion, so a genuinely *still* still life is
    dead still -- it only starts to crawl once it has begun to move.
    """
    S, T, A = "variable.sl_skew", "variable.sl_t", "variable.sl_amp"
    b = {}
    if fam in ("humanoid", "tall"):
        big = 1.0 if fam == "humanoid" else 1.9
        b["head"] = {
            "scale": [f"1.0 + {S} * 0.10", f"1.13 + math.sin({T} + variable.sl_seed) * 0.030 * {A}", "0.95"],
            "rotation": [f"math.sin({T} * 0.7 + variable.sl_seed) * {2.5 * big} * {A}", 0,
                         f"{S} * {6.0 * big} + math.sin({T} * 0.5) * 2.0 * {A}"],
            "position": [f"{S} * 0.6", f"{0.4 * big}", 0]}
        b["body"] = {"scale": [f"0.90 - {S} * 0.04", f"1.07", f"1.14"],
                     "rotation": [f"{1.5 * big}", 0, f"{S} * 2.5"]}
        b["leftArm"] = {"scale": ["0.85", f"1.20 + {S} * 0.12", "0.85"],
                        "rotation": [f"math.sin({T} * 0.43) * 2.0 * {A}", 0, f"-5.0 + {S} * 6.0"]}
        b["rightArm"] = {"scale": ["0.85", f"1.20 - {S} * 0.12", "0.85"],
                         "rotation": [f"math.sin({T} * 0.51 + 2.1) * 2.0 * {A}", 0, f"5.0 - {S} * 6.0"]}
        b["leftLeg"] = {"scale": ["0.94", f"1.06 + {S} * 0.05", "0.94"]}
        b["rightLeg"] = {"scale": ["0.94", f"1.06 - {S} * 0.05", "0.94"]}
    elif fam == "villager":
        b["head"] = {"scale": [f"1.02 + {S} * 0.08", f"1.10 + math.sin({T} + variable.sl_seed) * 0.028 * {A}", "0.96"],
                     "rotation": [f"math.sin({T} * 0.63 + variable.sl_seed) * 2.6 * {A}", 0, f"{S} * 6.5"],
                     "position": [f"{S} * 0.5", "0.3", 0]}
        b["nose"] = {"scale": [f"1.0 + {S} * 0.5", "1.0", f"1.4 + {S} * 0.6"]}
        b["body"] = {"scale": ["0.94", "1.06", "1.08"], "rotation": ["1.5", 0, f"{S} * 2.0"]}
        b["arms"] = {"scale": [f"1.05 + {S} * 0.10", "1.0", "1.0"],
                     "rotation": [f"math.sin({T} * 0.4) * 2.5 * {A}", f"{S} * 3.0", 0]}
        b["leg0"] = {"scale": ["0.95", f"1.05 + {S} * 0.06", "0.95"]}
        b["leg1"] = {"scale": ["0.95", f"1.05 - {S} * 0.06", "0.95"]}
    elif fam == "quad":
        b["head"] = {"scale": [f"1.05 + {S} * 0.10", f"1.08 + math.sin({T} + variable.sl_seed) * 0.03 * {A}", f"1.10"],
                     "rotation": [f"math.sin({T} * 0.55 + variable.sl_seed) * 3.0 * {A}",
                                  f"{S} * 5.0", f"{S} * 7.0"],
                     "position": [0, f"{S} * 0.5", "-0.4"]}
        b["body"] = {"scale": ["0.95", f"1.05 + {S} * 0.05", "1.06"],
                     "rotation": [0, 0, f"{S} * 2.2 + math.sin({T} * 0.33) * 1.2 * {A}"]}
        for i, sgn in enumerate((1, -1, -1, 1)):
            b[f"leg{i}"] = {"scale": ["0.92", f"1.07 + {S} * {0.07 * sgn}", "0.92"],
                            "rotation": [0, 0, f"{S} * {3.0 * sgn}"]}
    elif fam == "bird":
        b["head"] = {"scale": [f"1.10 + {S} * 0.12", f"1.16", "1.0"],
                     "rotation": [f"math.sin({T} * 0.9 + variable.sl_seed) * 4.0 * {A}", f"{S} * 8.0", f"{S} * 6.0"]}
        b["beak"] = {"scale": [f"1.0 + {S} * 0.4", "1.0", f"1.6 + {S} * 0.5"]}
        b["body"] = {"scale": ["0.94", "1.08", "1.06"]}
        b["wing0"] = {"scale": ["1.0", f"1.15 + {S} * 0.10", f"1.10"]}
        b["wing1"] = {"scale": ["1.0", f"1.15 - {S} * 0.10", f"1.10"]}
        b["leg0"] = {"scale": ["1.0", f"1.12 + {S} * 0.08", "1.0"]}
        b["leg1"] = {"scale": ["1.0", f"1.12 - {S} * 0.08", "1.0"]}
    return {"loop": True, "bones": b}


def jumpscare_anim(fam):
    """The lunge. Bone sets differ per family, so this is generated rather
    than hand-written -- a villager has no `rightArm` to throw at you."""
    head = {"rotation": {"0.0": [0, 0, 0], "0.08": [-26, 0, 0],
                         "0.5": [8, 0, 0], "1.1": [0, 0, 0]},
            "scale": {"0.0": 1.0, "0.06": 1.55, "0.4": 1.12, "1.1": 1.0}}
    body = {"rotation": {"0.0": [0, 0, 0], "0.09": [-12, 0, 0], "1.1": [0, 0, 0]},
            "scale": {"0.0": 1.0, "0.09": 1.14, "1.1": 1.0}}
    b = {"head": head, "body": body}
    if fam in ("humanoid", "tall"):
        k = 1.0 if fam == "humanoid" else 1.25
        b["rightArm"] = {"rotation": {"0.0": [0, 0, 0], "0.1": [-166 * k, -30, -34],
                                      "0.7": [-140, -10, -20], "1.1": [0, 0, 0]}}
        b["leftArm"] = {"rotation": {"0.0": [0, 0, 0], "0.1": [-166 * k, 30, 34],
                                     "0.7": [-140, 10, 20], "1.1": [0, 0, 0]}}
    elif fam == "villager":
        b["arms"] = {"rotation": {"0.0": [-40, 0, 0], "0.1": [-172, 0, 0],
                                  "0.6": [-120, 0, 0], "1.1": [-40, 0, 0]},
                     "scale": {"0.0": 1.0, "0.1": 1.3, "1.1": 1.0}}
        b["nose"] = {"scale": {"0.0": 1.0, "0.1": 2.0, "1.1": 1.0}}
    elif fam == "quad":
        for i, sgn in enumerate((1, -1, -1, 1)):
            b[f"leg{i}"] = {"rotation": {"0.0": [0, 0, 0], "0.1": [-46 * sgn, 0, 0],
                                         "0.6": [16 * sgn, 0, 0], "1.1": [0, 0, 0]}}
    elif fam == "bird":
        b["wing0"] = {"rotation": {"0.0": [0, 0, 0], "0.08": [0, 0, -96],
                                   "0.5": [0, 0, -40], "1.1": [0, 0, 0]}}
        b["wing1"] = {"rotation": {"0.0": [0, 0, 0], "0.08": [0, 0, 96],
                                   "0.5": [0, 0, 40], "1.1": [0, 0, 0]}}
        b["beak"] = {"scale": {"0.0": 1.0, "0.1": 1.8, "1.1": 1.0}}
    return {"loop": False, "animation_length": 1.1, "bones": b}


def idle_anim(fam):
    """The living idle -- breathing, weight shift, a slow scan of the room.

    Every copy runs this whether it is walking or holding a pose, which is
    what makes a still life read as *paused* rather than as a lump of geometry.
    Amplitude is scaled by variable.sl_rest so it fades out as the copy starts
    to walk and the stride takes over. Molang trig is in degrees, so the
    multipliers on query.life_time are degrees-per-second: 110 is roughly a
    three-second breath, 23 a fifteen-second scan.
    """
    R = "variable.sl_rest"
    L = "query.life_time"
    P = "variable.sl_seed"                       # per-entity phase offset
    br = f"1.0 + math.sin({L} * 110 + {P}) * 0.020 * {R}"
    b = {}
    if fam in ("humanoid", "tall"):
        # a tall thing sways more slowly and further
        k = 1.0 if fam == "humanoid" else 1.8
        b["body"] = {
            "scale": [br, "1.0", br],
            "rotation": [f"math.sin({L} * 55 + {P}) * {1.8 * k} * {R}", 0,
                         f"math.cos({L} * 37 + {P}) * {2.4 * k} * {R}"],
            "position": [f"math.cos({L} * 37 + {P}) * {0.22 * k} * {R}",
                         f"math.sin({L} * 110 + {P}) * {0.34 * k} * {R}", 0]}
        b["head"] = {"rotation": [
            f"math.sin({L} * 23 + {P}) * {6.0 * k} * {R}",
            f"math.sin({L} * 13 + {P}) * 19.0 * {R}",
            f"math.cos({L} * 29 + {P}) * 3.2 * {R}"]}
        b["leftArm"] = {"rotation": [f"math.sin({L} * 47 + {P}) * 5.0 * {R}", 0,
                                     f"2.0 + math.cos({L} * 41 + {P}) * 3.2 * {R}"]}
        b["rightArm"] = {"rotation": [f"math.cos({L} * 43 + {P}) * 5.0 * {R}", 0,
                                      f"-2.0 - math.sin({L} * 41 + {P}) * 3.2 * {R}"]}
        # the weight shifts from one leg to the other, slowly
        b["leftLeg"] = {"rotation": [f"math.cos({L} * 37 + {P}) * 2.2 * {R}", 0, 0]}
        b["rightLeg"] = {"rotation": [f"-math.cos({L} * 37 + {P}) * 2.2 * {R}", 0, 0]}
    elif fam == "villager":
        b["body"] = {"scale": [br, "1.0", br],
                     "rotation": [f"math.sin({L} * 51 + {P}) * 1.7 * {R}", 0,
                                  f"math.cos({L} * 33 + {P}) * 2.2 * {R}"],
                     "position": [f"math.cos({L} * 33 + {P}) * 0.2 * {R}",
                                  f"math.sin({L} * 110 + {P}) * 0.32 * {R}", 0]}
        b["head"] = {"rotation": [f"math.sin({L} * 21 + {P}) * 5.5 * {R}",
                                  f"math.sin({L} * 11 + {P}) * 21.0 * {R}",
                                  f"math.cos({L} * 27 + {P}) * 3.0 * {R}"]}
        b["arms"] = {"rotation": [f"math.sin({L} * 45 + {P}) * 4.5 * {R}", 0, 0],
                     "position": [0, f"math.sin({L} * 110 + {P}) * 0.22 * {R}", 0]}
        b["leg0"] = {"rotation": [f"math.cos({L} * 33 + {P}) * 2.0 * {R}", 0, 0]}
        b["leg1"] = {"rotation": [f"-math.cos({L} * 33 + {P}) * 2.0 * {R}", 0, 0]}
    elif fam == "quad":
        b["body"] = {"scale": ["1.0", br, br],
                     "rotation": [0, 0, f"math.cos({L} * 39 + {P}) * 1.4 * {R}"],
                     "position": [0, f"math.sin({L} * 110 + {P}) * 0.13 * {R}", 0]}
        # the slow graze: head dips, holds, comes back up
        b["head"] = {"rotation": [f"6.0 * {R} + math.sin({L} * 19 + {P}) * 7.0 * {R}",
                                  f"math.sin({L} * 12 + {P}) * 12.0 * {R}",
                                  f"math.cos({L} * 25 + {P}) * 2.0 * {R}"]}
        # legs barely shift weight when standing
        for i, sgn in enumerate((1, -1, -1, 1)):
            b[f"leg{i}"] = {"rotation": [
                f"math.sin({L} * 31 + {P} + {i * 90}) * {1.1 * sgn} * {R}", 0, 0]}
    elif fam == "bird":
        b["body"] = {"scale": [br, br, "1.0"],
                     "position": [0, f"math.sin({L} * 130 + {P}) * 0.14 * {R}", 0]}
        # a bird's head is never still: fast, jerky, punctuated
        b["head"] = {"rotation": [f"math.sin({L} * 37 + {P}) * 5.0 * {R}",
                                  f"math.sin({L} * 61 + {P}) * 22.0 * {R}", 0],
                     "position": [0, 0, f"math.cos({L} * 61 + {P}) * 0.5 * {R}"]}
        b["wing0"] = {"rotation": [0, 0, f"-2.0 - math.sin({L} * 71 + {P}) * 3.0 * {R}"]}
        b["wing1"] = {"rotation": [0, 0, f"2.0 + math.sin({L} * 71 + {P}) * 3.0 * {R}"]}
        for i in (0, 1):
            b[f"leg{i}"] = {"rotation": [
                f"math.sin({L} * 29 + {P} + {i * 180}) * 1.6 * {R}", 0, 0]}
    return {"loop": True, "bones": b}


def alert_anim(fam):
    """Breaking pose. The head comes up first, then the body follows.

    This is the tell that a sentinel has noticed you, so it is deliberately
    readable from a distance: a sharp lift, then a slow settle into a stance
    that is clearly no longer the pose it was holding.
    """
    head = {"rotation": {"0.0": [0, 0, 0], "0.12": [-22, 0, 0],
                         "0.45": [-12, 14, 0], "0.9": [-9, -12, 0],
                         "1.5": [-6, 0, 0]}}
    body = {"rotation": {"0.0": [0, 0, 0], "0.16": [-6, 0, 0], "1.5": [-2, 0, 0]},
            "position": {"0.0": [0, 0, 0], "0.16": [0, 0.4, 0], "1.5": [0, 0.15, 0]}}
    b = {"head": head, "body": body}
    if fam in ("humanoid", "tall"):
        b["leftArm"] = {"rotation": {"0.0": [0, 0, 0], "0.2": [-14, 0, 9],
                                     "1.5": [-5, 0, 5]}}
        b["rightArm"] = {"rotation": {"0.0": [0, 0, 0], "0.2": [-14, 0, -9],
                                      "1.5": [-5, 0, -5]}}
    elif fam == "villager":
        b["arms"] = {"rotation": {"0.0": [0, 0, 0], "0.2": [-18, 0, 0],
                                  "1.5": [-7, 0, 0]}}
    elif fam == "quad":
        # head snaps up out of the graze, front legs plant
        for i in (0, 1):
            b[f"leg{i}"] = {"rotation": {"0.0": [0, 0, 0], "0.14": [-9, 0, 0],
                                         "1.5": [-3, 0, 0]}}
    elif fam == "bird":
        b["wing0"] = {"rotation": {"0.0": [0, 0, 0], "0.1": [0, 0, -52],
                                   "0.6": [0, 0, -14], "1.5": [0, 0, -6]}}
        b["wing1"] = {"rotation": {"0.0": [0, 0, 0], "0.1": [0, 0, 52],
                                   "0.6": [0, 0, 14], "1.5": [0, 0, 6]}}
    return {"loop": "hold_on_last_frame", "animation_length": 1.5, "bones": b}


def gen_animations():
    anims = {f"animation.sl.distort.{f}": distort_anim(f) for f in FAM_BONES}
    anims.update({f"animation.sl.jumpscare.{f}": jumpscare_anim(f) for f in FAM_BONES})
    anims.update({f"animation.sl.idle.{f}": idle_anim(f) for f in FAM_BONES})
    anims.update({f"animation.sl.alert.{f}": alert_anim(f) for f in FAM_BONES})
    # the world's later, worse copies twitch harder
    w("animations/distort.animation.json", {"format_version": "1.8.0", "animations": anims})
    print(f"animations: {len(anims)} generated (distort + jumpscare per family)")


# ------------------------------------------------------- anim controllers
def gen_anim_controllers():
    ac = {}
    for fam in ("humanoid", "tall", "villager", "quad", "bird"):
        atk = FAM_ATTACK[fam]
        states = {
            "default": {
                "transitions": [
                    {"jumpscare": "query.property('sl:state') == 'jumpscare'"},
                    {"grab": "query.property('sl:state') == 'grabbing'"},
                    {"attack": "variable.attack_time > 0.0"},
                ],
            },
            "attack": {
                "animations": ["attack"],
                "blend_transition": 0.18,
                "transitions": [{"default": "variable.attack_time <= 0.0"}],
            },
            "jumpscare": {
                "animations": ["jumpscare"],
                "blend_transition": 0.05,
                "transitions": [{"default": "query.property('sl:state') != 'jumpscare'"}],
            },
            "grab": {
                "animations": ["grab"] if fam == "tall" else ["attack"],
                "blend_transition": 0.25,
                "transitions": [{"default": "query.property('sl:state') != 'grabbing'"}],
            },
        }
        ac[f"controller.animation.sl.action.{fam}"] = {
            "initial_state": "default", "states": states}
    w("animation_controllers/still_life.animation_controllers.json",
      {"format_version": "1.10.0", "animation_controllers": ac})
    print(f"animation controllers: {len(ac)}")


# ------------------------------------------------------ render controllers
def gen_render_controllers():
    rc = {}
    rc["controller.render.sl.entity"] = {
        "arrays": {"textures": {"Array.skins": ["Texture.default", "Texture.v2", "Texture.v3"]}},
        "geometry": "Geometry.default",
        "materials": [{"*": "Material.default"}],
        "textures": ["Array.skins[query.property('sl:decay')]"],
        # the sepia wash: a photograph of a mob, left in a window too long
        "overlay_color": {
            "r": "0.86", "g": "0.79", "b": "0.44",
            "a": "0.09 + query.property('sl:decay') * 0.085 + math.sin(query.life_time * 31.0) * 0.025",
        },
        "is_hurt_color": {"r": "1.0", "g": "0.36", "b": "0.30", "a": "0.55"},
    }
    rc["controller.render.sl.entity_single"] = {
        "geometry": "Geometry.default",
        "materials": [{"*": "Material.default"}],
        "textures": ["Texture.default"],
        "overlay_color": {
            "r": "0.86", "g": "0.79", "b": "0.44",
            "a": "0.12 + math.sin(query.life_time * 31.0) * 0.03",
        },
        "is_hurt_color": {"r": "1.0", "g": "0.36", "b": "0.30", "a": "0.55"},
    }
    # exactly how a player renders: no tint, no wash
    rc["controller.render.sl.plain"] = {
        "geometry": "Geometry.default",
        "materials": [{"*": "Material.default"}],
        "textures": ["Texture.default"],
        "is_hurt_color": {"r": "1.0", "g": "0.36", "b": "0.30", "a": "0.55"},
    }
    rc["controller.render.sl.armor"] = {
        "geometry": "Geometry.default",
        "materials": [{"*": "Material.default"}],
        "textures": ["Texture.default"],
    }
    w("render_controllers/still_life.render_controllers.json",
      {"format_version": "1.10.0", "render_controllers": rc})
    print(f"render controllers: {len(rc)}")


# ------------------------------------------------------- client entities
def client_entity(name, cfg):
    fam = cfg["fam"]
    vanilla = cfg.get("vanilla", False)
    boss = cfg.get("boss", False)
    multi = cfg["decay"] > 1 and not vanilla
    tex = {"default": "textures/entity/steve" if vanilla
           else f"textures/entity/still_life/{name}"}
    if multi:
        tex["v2"] = f"textures/entity/still_life/{name}_v2"
        tex["v3"] = f"textures/entity/still_life/{name}_v3"

    anims = {
        "move": f"animation.sl.{FAM_MOVE[fam]}.move",
        "look_at": "animation.sl.look_at_target",
        "idle": f"animation.sl.idle.{fam}",
        "alert": f"animation.sl.alert.{fam}",
        "distort": f"animation.sl.distort.{fam}",
        "panic": "animation.sl.flee_panic",
        "attack": f"animation.sl.{FAM_ATTACK[fam]}.attack",
        "jumpscare": f"animation.sl.jumpscare.{fam}",
        "action": f"controller.animation.sl.action.{fam}",
    }
    # idle runs unconditionally -- it is amplitude-gated by variable.sl_rest
    # instead, so a copy that is walking blends smoothly out of it rather than
    # popping between two animations
    animate = ["look_at", "move", "idle",
               {"panic": "query.property('sl:state') == 'fleeing'"},
               "action"]
    # only the still lifes carry the temperament/motion properties; the two
    # bosses have their own, much shorter state list
    if not boss:
        animate.insert(3, {"alert": "query.property('sl:state') == 'alert'"})
    else:
        anims.pop("alert", None)
    if vanilla:
        # it is the player model. Do not warp it.
        anims.pop("distort", None)
    else:
        animate.insert(2, "distort")
    if fam == "tall":
        anims["grab"] = "animation.sl.tall.grab"
    if cfg.get("tail"):
        anims["tail"] = "animation.sl.tail.sway"
        animate.insert(3, "tail")

    # a still life that has not woken up does not move AT ALL; once it does,
    # the wrongness accelerates. sl_seed/sl_skew are rolled once per entity.
    pre = [
        "variable.sl_seed = variable.sl_seed ?? math.random(0.0, 6.2832);",
        "variable.sl_skew = variable.sl_skew ?? math.random(-1.0, 1.0);",
        "variable.sl_awake = math.clamp(query.modified_move_speed * 6.0, 0.0, 1.0);",
        "variable.sl_rest = 1.0 - variable.sl_awake;",
        ("variable.sl_hostile = (query.property('sl:state') == 'hostile') ? 1.0 : 0.0;"
         if boss else
         "variable.sl_hostile = (query.property('sl:temper') == 'hostile' || query.property('sl:state') == 'betraying') ? 1.0 : 0.0;"),
        "variable.sl_t = query.life_time * (0.35 + variable.sl_awake * 5.5 + variable.sl_hostile * 3.0);",
        "variable.sl_amp = 0.30 + variable.sl_awake * 0.85 + query.property('sl:decay') * 0.35 + variable.sl_hostile * 0.6;",
    ]

    d = {
        "identifier": f"sl:{name}",
        "min_engine_version": "1.8.0",
        "materials": {"default": "entity_alphatest"},
        "textures": tex,
        "geometry": {"default": f"geometry.sl.{name}"},
        "animations": anims,
        "scripts": {"pre_animation": pre, "animate": animate},
        "render_controllers": ["controller.render.sl.plain" if vanilla
                               else "controller.render.sl.entity" if multi
                               else "controller.render.sl.entity_single"],
        "spawn_egg": {"base_color": cfg["egg"][0], "overlay_color": cfg["egg"][1]},
    }
    return {"format_version": "1.10.0", "minecraft:client_entity": {"description": d}}


def gen_entities():
    for n, c in ENTS.items():
        w(f"entity/{n}.entity.json", client_entity(n, c))
    print(f"client entities: {len(ENTS)}")


# ------------------------------------------------------------ attachables
ARMOR_PIECES = {"stillcloth_hood": "helmet", "stillcloth_tunic": "chest",
                "stillcloth_trousers": "legs", "stillcloth_treads": "boots"}


def gen_attachables():
    for item, piece in ARMOR_PIECES.items():
        w(f"attachables/{item}.attachable.json", {
            "format_version": "1.10.0",
            "minecraft:attachable": {
                "description": {
                    "identifier": f"sl:{item}",
                    "materials": {"default": "armor", "enchanted": "armor_enchanted"},
                    "textures": {
                        "default": f"textures/models/armor/sl_stillcloth_{piece}",
                        "enchanted": "textures/misc/enchanted_item_glint",
                    },
                    "geometry": {"default": f"geometry.sl.armor_{piece}"},
                    "scripts": {
                        "parent_setup": f"variable.{'helmet' if piece == 'helmet' else 'chest' if piece == 'chest' else 'leg' if piece == 'legs' else 'boot'}_layer_visible = 0.0;"
                    },
                    "render_controllers": ["controller.render.sl.armor"],
                }
            }
        })
    print(f"attachables: {len(ARMOR_PIECES)}")


# --------------------------------------------------------- texture atlases
def gen_atlases():
    w("textures/item_texture.json", {
        "resource_pack_name": "still_life", "texture_name": "atlas.items",
        "texture_data": {f"sl_{n}": {"textures": f"textures/items/sl_{n}"} for n in ITEMS},
    })
    w("textures/terrain_texture.json", {
        "resource_pack_name": "still_life", "texture_name": "atlas.terrain",
        "padding": 8, "num_mip_levels": 4,
        "texture_data": {f"sl_{n}": {"textures": f"textures/blocks/sl_{n}"} for n in BLOCKS},
    })
    w("textures/flipbook_textures.json", [
        {"flipbook_texture": "textures/blocks/sl_noclip_rift",
         "atlas_tile": "sl_noclip_rift", "ticks_per_frame": 3, "blend_frames": True},
        {"flipbook_texture": "textures/blocks/sl_buzzing_light",
         "atlas_tile": "sl_buzzing_light", "ticks_per_frame": 7, "blend_frames": False},
    ])
    print(f"atlases: {len(ITEMS)} items / {len(BLOCKS)} blocks / 2 flipbooks")


# ------------------------------------------------------------------ sound
MUSIC = ["liminal_1", "liminal_2", "liminal_3", "backrooms_hum",
         "theme_tall", "theme_clark", "deep_distortion"]
MOBSND = ["still_idle", "still_hurt", "still_death", "befriend", "betray",
          "tall_step", "tall_roar", "clark_roar"]
AMB = ["buzz", "whisper", "sanity_low"]
FX = ["jumpscare", "noclip", "recreate", "camera", "drink", "door"]


def gen_sounds():
    sd = {}
    for m in MUSIC:
        sd[f"sl.music.{m}"] = {
            "category": "music", "min_distance": 0.0, "max_distance": 0.0,
            "sounds": [{"name": f"sounds/music/sl_{m}", "stream": True,
                        "volume": 0.85, "load_on_low_memory": False}],
        }
    vol = {"still_idle": 0.65, "still_hurt": 0.9, "still_death": 0.95,
           "befriend": 0.8, "betray": 1.0, "tall_step": 1.0,
           "tall_roar": 1.0, "clark_roar": 1.0}
    for s in MOBSND:
        sd[f"sl.{s.replace('_', '.')}"] = {
            "category": "hostile" if "tall" in s or "clark" in s else "neutral",
            "sounds": [{"name": f"sounds/mob/sl_{s}", "volume": vol[s]}],
        }
    for s in AMB:
        sd[f"sl.ambient.{s}"] = {
            "category": "ambient",
            "sounds": [{"name": f"sounds/ambient/sl_{s}", "volume": 0.7}],
        }
    for s in FX:
        sd[f"sl.fx.{s}"] = {
            "category": "player" if s in ("camera", "drink") else "ambient",
            "sounds": [{"name": f"sounds/effect/sl_{s}",
                        "volume": 1.0 if s == "jumpscare" else 0.85}],
        }
    w("sounds/sound_definitions.json",
      {"format_version": "1.14.0", "sound_definitions": sd})

    ent = {}
    for n, c in ENTS.items():
        if n == "the_tall_one":
            ev = {"ambient": "sl.tall.roar", "hurt": "sl.still.hurt",
                  "death": "sl.tall.roar", "step": "sl.tall.step",
                  "attack": "sl.tall.roar"}
            pitch = [0.7, 0.85]
        elif n == "captain_clark":
            ev = {"ambient": "sl.clark.roar", "hurt": "sl.still.hurt",
                  "death": "sl.clark.roar", "attack": "sl.clark.roar"}
            pitch = [0.85, 1.0]
        else:
            ev = {"ambient": "sl.still.idle", "hurt": "sl.still.hurt",
                  "death": "sl.still.death"}
            pitch = [0.62, 0.92]
        ent[f"sl:{n}"] = {"volume": 1.0, "pitch": pitch, "events": ev}
    w("sounds.json", {"format_version": "1.14.0",
                      "entity_sounds": {"entities": ent}})
    print(f"sounds: {len(sd)} definitions, {len(ent)} entity maps")


# ------------------------------------------------------------------- lang
ITEM_NAMES = {
    "cotton": "Cotton", "stillcloth": "Stillcloth",
    "almond_water": "Almond Water", "bitter_almond_water": "Bitter Almond Water",
    "cotton_bandage": "Cotton Bandage", "flicker_lantern": "Flicker Lantern",
    "camcorder": "Camcorder", "polaroid": "Polaroid",
    "noclip_charm": "Noclip Charm", "exit_sign_shard": "Exit Sign Shard",
    "frontrooms_key": "Frontrooms Key", "stillcloth_hood": "Stillcloth Hood",
    "stillcloth_tunic": "Stillcloth Tunic", "stillcloth_trousers": "Stillcloth Trousers",
    "stillcloth_treads": "Stillcloth Treads", "hum_tuner": "Hum Tuner",
    "tall_ones_tooth": "The Tall One's Tooth", "clarks_whistle": "Clark's Whistle",
    "static_blade": "Static Blade", "wall_pry_bar": "Wall Pry Bar",
    "sanity_anchor": "Sanity Anchor", "distorted_compass": "Distorted Compass",
    "reel_of_tape": "Reel of Tape", "still_essence": "Still Essence",
}
BLOCK_NAMES = {
    "wallpaper": "Yellow Wallpaper", "wallpaper_torn": "Torn Wallpaper",
    "damp_carpet": "Damp Carpet", "ceiling_tile": "Ceiling Tile",
    "buzzing_light": "Buzzing Light", "moist_wall": "Moist Wall",
    "exit_door": "Exit Door", "noclip_rift": "Noclip Rift",
    "sanity_anchor_block": "Sanity Anchor", "cotton_bale": "Cotton Bale",
    "exit_sign": "Exit Sign", "hum_speaker": "Hum Speaker",
}
ENT_NAMES = {
    "still_villager": "Still Life", "still_cow": "Still Life",
    "still_pig": "Still Life", "still_sheep": "Still Life",
    "still_chicken": "Still Life", "still_wolf": "Still Life",
    "still_player": "The Copy", "the_tall_one": "The Tall One",
    "captain_clark": "Captain Clark",
}
EGG_NAMES = {
    "still_villager": "Still Life (Villager)", "still_cow": "Still Life (Cow)",
    "still_pig": "Still Life (Pig)", "still_sheep": "Still Life (Sheep)",
    "still_chicken": "Still Life (Chicken)", "still_wolf": "Still Life (Wolf)",
    "still_player": "The Copy", "the_tall_one": "The Tall One",
    "captain_clark": "Captain Clark",
}


def gen_lang():
    L = ["## STILL LIFE - A Backrooms Add-On", ""]
    L.append("pack.name=STILL LIFE")
    L.append("pack.description=The world remembers you.")
    L.append("")
    for k, v in ITEM_NAMES.items():
        L.append(f"item.sl:{k}={v}")
    L.append("")
    for k, v in BLOCK_NAMES.items():
        L.append(f"tile.sl:{k}.name={v}")
        L.append(f"item.sl:{k}={v}")
    L.append("")
    for k, v in ENT_NAMES.items():
        L.append(f"entity.sl:{k}.name={v}")
    L.append("")
    for k, v in EGG_NAMES.items():
        L.append(f"item.spawn_egg.entity.sl:{k}.name=Spawn {v}")
    L.append("")
    L.append("itemGroup.name.sl_backrooms=Still Life")
    L.append("action.hint.exit.sl:exit_door=Open")
    L.append("action.hint.exit.sl:noclip_rift=Noclip")
    for p in ("RP", "BP"):
        pass
    body = "\n".join(L) + "\n"
    for sub in ("texts/en_US.lang",):
        p = os.path.join(RP, sub)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "w").write(body)
    w("texts/languages.json", ["en_US"])
    bp = os.path.join(RP, "..", "StillLife_BP", "texts")
    os.makedirs(bp, exist_ok=True)
    open(os.path.join(bp, "en_US.lang"), "w").write(body)
    json.dump(["en_US"], open(os.path.join(bp, "languages.json"), "w"))
    print(f"lang: {len(L)} lines")


if __name__ == "__main__":
    gen_animations()
    gen_anim_controllers()
    gen_render_controllers()
    gen_entities()
    gen_attachables()
    gen_atlases()
    gen_sounds()
    gen_lang()
