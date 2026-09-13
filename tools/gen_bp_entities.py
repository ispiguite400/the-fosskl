"""Behaviour-pack entity definitions.

The still life state machine lives here as component groups + events:

    still  -> the default. It does not move. At all.
    roaming-> it has decided to walk somewhere.
    fleeing-> something frightened it and it is leaving. (the movie's rule)
    neutral-> it will hit back, but only if you start it.
    hostile-> it was already wrong when it spawned.
    friendly-> you fed it. It follows you now.
    betraying-> you fed it, and then you were cruel to something else.

Scripts flip these with entity.triggerEvent(); the entity itself handles the
reflex cases (took damage, saw a monster) with no script tick needed.
"""
import json, os

BP = os.path.join(os.path.dirname(__file__), "..", "packs", "StillLife_BP")
FV = "1.21.0"

STATES = ["still", "roaming", "fleeing", "friendly", "hostile", "betraying", "jumpscare"]
GROUPS = ["sl:mode_still", "sl:mode_roam", "sl:mode_flee", "sl:mode_neutral",
          "sl:mode_hostile", "sl:mode_friend", "sl:mode_betray"]


def w(rel, obj):
    p = os.path.join(BP, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(obj, open(p, "w"), indent=2)


def ev(add, prop, extra=None):
    e = {"remove": {"component_groups": [g for g in GROUPS if g != add]},
         "add": {"component_groups": [add]},
         "set_property": {"sl:state": f"'{prop}'"}}
    if extra:
        e.update(extra)
    return e


def player_target(dist=16, must_see=True):
    return {"priority": 3, "must_see": must_see, "must_reach": False,
            "reselect_targets": True, "within_radius": dist,
            "entity_types": [{"filters": {"test": "is_family", "subject": "other",
                                          "value": "player"},
                              "max_dist": dist, "must_see": must_see}]}


def still_life(name, health, speed, dmg, box, family, sounds=True,
               loot="still_life", scale=1.0, xp=3):
    """One recreated animal. Same silhouette, wrong everything else."""
    comp = {
        "minecraft:type_family": {"family": ["sl_still", "still_life", "mob", name]},
        "minecraft:collision_box": {"width": box[0], "height": box[1]},
        "minecraft:health": {"value": health, "max": health},
        "minecraft:physics": {},
        "minecraft:pushable": {"is_pushable": True, "is_pushable_by_piston": True},
        "minecraft:movement": {"value": speed},
        "minecraft:navigation.walk": {"can_path_over_water": False,
                                      "avoid_water": True, "avoid_damage_blocks": True},
        "minecraft:movement.basic": {},
        "minecraft:jump.static": {},
        "minecraft:breathable": {"total_supply": 15, "suffocate_time": 0},
        "minecraft:nameable": {},
        "minecraft:attack": {"damage": dmg},
        "minecraft:knockback_resistance": {"value": 0.2},
        "minecraft:loot": {"table": f"loot_tables/entities/{loot}.json"},
        "minecraft:experience_reward": {"on_death": str(xp)},
        "minecraft:ambient_sound_interval": {"value": 9.0, "range": 22.0,
                                             "event_name": "ambient"},
        "minecraft:conditional_bandwidth_optimization": {},
        "minecraft:behavior.float": {"priority": 0},
        # a still life leaves if something dangerous turns up -- exactly like
        # the film, where they scatter the moment the level turns on them
        "minecraft:behavior.avoid_mob_type": {
            "priority": 1, "probability_per_strength": 1.0,
            "entity_types": [{
                "filters": {"any_of": [
                    {"test": "is_family", "subject": "other", "value": "monster"},
                    {"test": "is_family", "subject": "other", "value": "sl_apex"}]},
                "max_dist": 14, "walk_speed_multiplier": 1.5,
                "sprint_speed_multiplier": 1.9}],
            "on_escape": [{"event": "sl:calm_down", "target": "self"}],
        },
        # taking a hit wakes it up; what it becomes is decided by the script,
        # which knows how you have treated everything else
        "minecraft:damage_sensor": {
            "triggers": [{
                "cause": "all", "deals_damage": True,
                "on_damage": {
                    "filters": {"test": "is_family", "subject": "other", "value": "player"},
                    "event": "sl:struck_by_player", "target": "self"},
            }]
        },
        "minecraft:environment_sensor": {
            "triggers": [{
                "filters": {"all_of": [
                    {"test": "has_component", "operator": "!=",
                     "value": "minecraft:is_tamed"},
                    {"test": "distance_to_nearest_player", "operator": "<", "value": 3.5},
                    {"test": "random_chance", "value": 220}]},
                "event": "sl:startled", "target": "self"}]
        },
        # feed it cotton and it may decide it likes you
        "minecraft:tameable": {
            "probability": 0.34,
            "tame_items": ["sl:cotton", "sl:almond_water"],
            "tame_event": {"event": "sl:on_tame", "target": "self"},
        },
        "minecraft:behavior.tempt": {
            "priority": 4, "speed_multiplier": 0.9, "can_tempt_vertically": True,
            "items": ["sl:cotton", "sl:almond_water"],
        },
        "minecraft:despawn": {
            "despawn_from_distance": {"max_distance": 120, "min_distance": 72},
            "filters": {"all_of": [
                {"test": "has_component", "operator": "!=", "value": "minecraft:is_tamed"},
                {"test": "is_family", "subject": "self", "value": "still_life"}]},
        },
    }
    if scale != 1.0:
        comp["minecraft:scale"] = {"value": scale}

    groups = {
        "sl:mode_still": {
            "minecraft:movement": {"value": 0.0},
            # occasionally, very slowly, it turns to look at you
            "minecraft:behavior.look_at_player": {"priority": 8, "look_distance": 14,
                                                  "probability": 0.014, "angle_of_view_horizontal": 360},
        },
        "sl:mode_roam": {
            "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 0.62},
            "minecraft:behavior.look_at_player": {"priority": 7, "look_distance": 9, "probability": 0.05},
            "minecraft:behavior.random_look_around": {"priority": 9},
        },
        "sl:mode_flee": {
            "minecraft:movement": {"value": round(speed * 1.85, 3)},
            "minecraft:behavior.panic": {"priority": 1, "speed_multiplier": 1.35},
            "minecraft:behavior.avoid_mob_type": {
                "priority": 2, "probability_per_strength": 1.0,
                "entity_types": [{"filters": {"test": "is_family", "subject": "other",
                                              "value": "player"},
                                  "max_dist": 16, "walk_speed_multiplier": 1.5,
                                  "sprint_speed_multiplier": 2.0}],
                "on_escape": [{"event": "sl:calm_down", "target": "self"}]},
            "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 1.0},
        },
        "sl:mode_neutral": {
            "minecraft:behavior.hurt_by_target": {"priority": 1},
            "minecraft:behavior.melee_attack": {"priority": 2, "speed_multiplier": 1.15,
                                                "track_target": True},
            "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 0.6},
            "minecraft:behavior.look_at_player": {"priority": 7, "look_distance": 10, "probability": 0.06},
        },
        "sl:mode_hostile": {
            "minecraft:movement": {"value": round(speed * 1.3, 3)},
            "minecraft:behavior.hurt_by_target": {"priority": 1},
            "minecraft:behavior.nearest_attackable_target": player_target(18),
            "minecraft:behavior.melee_attack": {"priority": 4, "speed_multiplier": 1.25,
                                                "track_target": True},
            "minecraft:behavior.random_stroll": {"priority": 7, "speed_multiplier": 0.8},
        },
        "sl:mode_friend": {
            "minecraft:is_tamed": {},
            "minecraft:persistent": {},
            "minecraft:behavior.follow_owner": {"priority": 4, "speed_multiplier": 1.1,
                                                "start_distance": 8, "stop_distance": 2.5},
            "minecraft:behavior.owner_hurt_by_target": {"priority": 2},
            "minecraft:behavior.owner_hurt_target": {"priority": 2},
            "minecraft:behavior.melee_attack": {"priority": 3, "speed_multiplier": 1.2,
                                                "track_target": True},
            "minecraft:behavior.look_at_player": {"priority": 8, "look_distance": 8, "probability": 0.10},
            "minecraft:behavior.random_stroll": {"priority": 9, "speed_multiplier": 0.6},
        },
        # it still follows you. it is just not on your side any more.
        "sl:mode_betray": {
            "minecraft:is_tamed": {},
            "minecraft:persistent": {},
            "minecraft:movement": {"value": round(speed * 1.5, 3)},
            "minecraft:attack": {"damage": dmg + 2},
            "minecraft:behavior.nearest_attackable_target": player_target(24, must_see=False),
            "minecraft:behavior.melee_attack": {"priority": 3, "speed_multiplier": 1.4,
                                                "track_target": True},
        },
    }

    events = {
        "minecraft:entity_spawned": {"randomize": [
            {"weight": 58, "trigger": "sl:to_still"},
            {"weight": 24, "trigger": "sl:to_roam"},
            {"weight": 12, "trigger": "sl:to_neutral"},
            {"weight": 6, "trigger": "sl:to_hostile"}]},
        "sl:to_still": ev("sl:mode_still", "still"),
        "sl:to_roam": ev("sl:mode_roam", "roaming"),
        "sl:to_flee": ev("sl:mode_flee", "fleeing"),
        "sl:to_neutral": ev("sl:mode_neutral", "still"),
        "sl:to_hostile": ev("sl:mode_hostile", "hostile"),
        "sl:to_friend": ev("sl:mode_friend", "friendly"),
        "sl:to_betray": ev("sl:mode_betray", "betraying"),
        "sl:on_tame": ev("sl:mode_friend", "friendly"),
        "sl:calm_down": {"randomize": [
            {"weight": 70, "trigger": "sl:to_still"},
            {"weight": 30, "trigger": "sl:to_roam"}]},
        # a still life that is struck mostly runs. Sometimes it does not.
        "sl:struck_by_player": {"randomize": [
            {"weight": 62, "trigger": "sl:to_flee"},
            {"weight": 30, "trigger": "sl:to_neutral"},
            {"weight": 8, "trigger": "sl:to_hostile"}]},
        "sl:startled": {"randomize": [
            {"weight": 74, "trigger": "sl:noop"},
            {"weight": 26, "trigger": "sl:to_flee"}]},
        "sl:noop": {},
        "sl:jumpscare_pose": {"set_property": {"sl:state": "'jumpscare'"}},
        "sl:decay_0": {"set_property": {"sl:decay": 0}},
        "sl:decay_1": {"set_property": {"sl:decay": 1}},
        "sl:decay_2": {"set_property": {"sl:decay": 2}},
    }

    return {
        "format_version": FV,
        "minecraft:entity": {
            "description": {
                "identifier": f"sl:{name}",
                "is_spawnable": True, "is_summonable": True, "is_experimental": False,
                "properties": {
                    "sl:state": {"type": "enum", "values": STATES,
                                 "default": "still", "client_sync": True},
                    "sl:decay": {"type": "int", "range": [0, 2],
                                 "default": 0, "client_sync": True},
                },
            },
            "component_groups": groups,
            "components": comp,
            "events": events,
        },
    }


# ------------------------------------------------------------ the Tall One
def tall_one():
    comp = {
        "minecraft:type_family": {"family": ["sl_apex", "the_tall_one", "monster", "mob"]},
        "minecraft:collision_box": {"width": 1.1, "height": 4.9},
        "minecraft:health": {"value": 260, "max": 260},
        "minecraft:physics": {},
        "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
        "minecraft:knockback_resistance": {"value": 0.92},
        # deliberately mid-paced: you cannot outrun it forever, and it will
        # not close the gap in one breath either
        "minecraft:movement": {"value": 0.265},
        "minecraft:navigation.walk": {"can_pass_doors": True, "can_open_doors": True,
                                      "avoid_water": True, "can_break_doors": True},
        "minecraft:movement.basic": {},
        "minecraft:jump.static": {},
        "minecraft:can_climb": {},
        "minecraft:breathable": {"breathes_air": True, "breathes_water": True},
        "minecraft:fire_immune": {},
        "minecraft:damage_sensor": {"triggers": [
            {"cause": "fall", "deals_damage": False},
            {"cause": "drowning", "deals_damage": False},
            {"cause": "lightning", "deals_damage": False}]},
        "minecraft:attack": {"damage": 9},
        "minecraft:boss": {"should_darken_sky": False, "hud_range": 64,
                           "name": "The Tall One"},
        "minecraft:persistent": {},
        "minecraft:nameable": {},
        "minecraft:experience_reward": {"on_death": "120"},
        "minecraft:loot": {"table": "loot_tables/entities/tall_one.json"},
        "minecraft:ambient_sound_interval": {"value": 14.0, "range": 26.0,
                                             "event_name": "ambient"},
        # this is how it picks you up
        "minecraft:rideable": {
            "seat_count": 1, "family_types": ["player"], "pull_in_entities": False,
            "controlling_seat": 0, "crouching_skip_interact": True,
            "interact_text": "", "seats": [{"position": [0, 4.1, -0.9],
                                            "lock_rider_rotation": 0}],
        },
        "minecraft:behavior.float": {"priority": 0},
        "minecraft:behavior.random_stroll": {"priority": 9, "speed_multiplier": 0.7},
        "minecraft:behavior.look_at_player": {"priority": 10, "look_distance": 40,
                                              "probability": 0.9},
    }
    groups = {
        "sl:tall_hunting": {
            "minecraft:behavior.hurt_by_target": {"priority": 1},
            "minecraft:behavior.nearest_attackable_target": player_target(48, must_see=False),
            "minecraft:behavior.melee_attack": {"priority": 3, "speed_multiplier": 1.0,
                                                "track_target": True, "reach_multiplier": 1.9},
        },
        # befriended: it walks with you, and it hurts what hurts you
        "sl:tall_bonded": {
            "minecraft:is_tamed": {},
            "minecraft:behavior.follow_owner": {"priority": 3, "speed_multiplier": 1.0,
                                                "start_distance": 10, "stop_distance": 4},
            "minecraft:behavior.owner_hurt_by_target": {"priority": 1},
            "minecraft:behavior.owner_hurt_target": {"priority": 1},
            "minecraft:behavior.melee_attack": {"priority": 4, "speed_multiplier": 1.1,
                                                "track_target": True, "reach_multiplier": 1.9},
        },
        "sl:tall_grabbing": {
            "minecraft:movement": {"value": 0.0},
        },
        "sl:tall_enraged": {
            "minecraft:movement": {"value": 0.33},
            "minecraft:attack": {"damage": 14},
            "minecraft:behavior.nearest_attackable_target": player_target(64, must_see=False),
            "minecraft:behavior.melee_attack": {"priority": 2, "speed_multiplier": 1.2,
                                                "track_target": True, "reach_multiplier": 2.1},
        },
    }
    events = {
        "minecraft:entity_spawned": {"add": {"component_groups": ["sl:tall_hunting"]},
                                     "set_property": {"sl:state": "'hostile'"}},
        "sl:hunt": {"remove": {"component_groups": ["sl:tall_bonded", "sl:tall_grabbing",
                                                    "sl:tall_enraged"]},
                    "add": {"component_groups": ["sl:tall_hunting"]},
                    "set_property": {"sl:state": "'hostile'"}},
        "sl:bond": {"remove": {"component_groups": ["sl:tall_hunting", "sl:tall_grabbing",
                                                    "sl:tall_enraged"]},
                    "add": {"component_groups": ["sl:tall_bonded"]},
                    "set_property": {"sl:state": "'friendly'"}},
        "sl:grab": {"remove": {"component_groups": ["sl:tall_hunting", "sl:tall_bonded",
                                                    "sl:tall_enraged"]},
                    "add": {"component_groups": ["sl:tall_grabbing"]},
                    "set_property": {"sl:state": "'grabbing'"}},
        "sl:enrage": {"remove": {"component_groups": ["sl:tall_hunting", "sl:tall_bonded",
                                                      "sl:tall_grabbing"]},
                      "add": {"component_groups": ["sl:tall_enraged"]},
                      "set_property": {"sl:state": "'betraying'"}},
        "sl:decay_0": {"set_property": {"sl:decay": 0}},
        "sl:decay_1": {"set_property": {"sl:decay": 1}},
        "sl:decay_2": {"set_property": {"sl:decay": 2}},
    }
    return {"format_version": FV, "minecraft:entity": {
        "description": {"identifier": "sl:the_tall_one", "is_spawnable": True,
                        "is_summonable": True, "is_experimental": False,
                        "properties": {
                            "sl:state": {"type": "enum", "values": STATES,
                                         "default": "hostile", "client_sync": True},
                            "sl:decay": {"type": "int", "range": [0, 2],
                                         "default": 0, "client_sync": True}}},
        "component_groups": groups, "components": comp, "events": events}}


# --------------------------------------------------------- Captain Clark
def clark():
    comp = {
        "minecraft:type_family": {"family": ["sl_apex", "captain_clark", "monster", "mob"]},
        "minecraft:collision_box": {"width": 0.9, "height": 2.5},
        "minecraft:health": {"value": 340, "max": 340},
        "minecraft:physics": {},
        "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
        "minecraft:knockback_resistance": {"value": 0.85},
        "minecraft:movement": {"value": 0.30},
        "minecraft:navigation.walk": {"can_pass_doors": True, "can_open_doors": True,
                                      "can_break_doors": True, "avoid_water": True},
        "minecraft:movement.basic": {},
        "minecraft:jump.static": {},
        "minecraft:breathable": {"breathes_air": True, "breathes_water": True},
        "minecraft:fire_immune": {},
        "minecraft:attack": {"damage": 11},
        "minecraft:boss": {"should_darken_sky": True, "hud_range": 72,
                           "name": "Captain Clark"},
        "minecraft:persistent": {},
        "minecraft:experience_reward": {"on_death": "220"},
        "minecraft:loot": {"table": "loot_tables/entities/captain_clark.json"},
        "minecraft:ambient_sound_interval": {"value": 11.0, "range": 20.0,
                                             "event_name": "ambient"},
        "minecraft:damage_sensor": {"triggers": [
            {"cause": "fall", "deals_damage": False},
            {"cause": "drowning", "deals_damage": False},
            # Stillcloth and the Static Blade are what actually work on him
            {"cause": "entity_attack", "deals_damage": True,
             "on_damage": {"filters": {"test": "is_family", "subject": "other",
                                       "value": "player"},
                           "event": "sl:clark_struck", "target": "self"}}]},
        "minecraft:behavior.float": {"priority": 0},
        "minecraft:behavior.hurt_by_target": {"priority": 1},
        "minecraft:behavior.nearest_attackable_target": player_target(52, must_see=False),
        "minecraft:behavior.melee_attack": {"priority": 4, "speed_multiplier": 1.15,
                                            "track_target": True, "reach_multiplier": 1.4},
        "minecraft:behavior.random_stroll": {"priority": 9, "speed_multiplier": 0.8},
        "minecraft:behavior.look_at_player": {"priority": 10, "look_distance": 40},
    }
    groups = {
        "sl:clark_phase2": {
            "minecraft:movement": {"value": 0.365},
            "minecraft:attack": {"damage": 15},
            "minecraft:behavior.charge_attack": {"priority": 2, "max_distance": 14,
                                                 "speed_multiplier": 1.8},
        },
        "sl:clark_phase3": {
            "minecraft:movement": {"value": 0.40},
            "minecraft:attack": {"damage": 18},
            "minecraft:knockback_resistance": {"value": 1.0},
            "minecraft:behavior.charge_attack": {"priority": 2, "max_distance": 18,
                                                 "speed_multiplier": 2.1},
        },
        "sl:clark_stunned": {
            "minecraft:movement": {"value": 0.0},
            "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": True,
                                                      "damage_multiplier": 2.0}]},
        },
    }
    events = {
        "minecraft:entity_spawned": {"set_property": {"sl:state": "'hostile'"}},
        "sl:clark_struck": {},
        "sl:phase2": {"add": {"component_groups": ["sl:clark_phase2"]}},
        "sl:phase3": {"remove": {"component_groups": ["sl:clark_phase2"]},
                      "add": {"component_groups": ["sl:clark_phase3"]}},
        "sl:stun": {"add": {"component_groups": ["sl:clark_stunned"]}},
        "sl:unstun": {"remove": {"component_groups": ["sl:clark_stunned"]}},
        "sl:decay_0": {"set_property": {"sl:decay": 0}},
        "sl:decay_1": {"set_property": {"sl:decay": 1}},
        "sl:decay_2": {"set_property": {"sl:decay": 2}},
    }
    return {"format_version": FV, "minecraft:entity": {
        "description": {"identifier": "sl:captain_clark", "is_spawnable": True,
                        "is_summonable": True, "is_experimental": False,
                        "properties": {
                            "sl:state": {"type": "enum", "values": STATES,
                                         "default": "hostile", "client_sync": True},
                            "sl:decay": {"type": "int", "range": [0, 2],
                                         "default": 0, "client_sync": True}}},
        "component_groups": groups, "components": comp, "events": events}}


ROSTER = {
    "still_villager": dict(health=22, speed=0.23, dmg=3, box=(0.62, 1.95), xp=4),
    "still_cow":      dict(health=26, speed=0.20, dmg=3, box=(0.9, 1.5), xp=4),
    "still_pig":      dict(health=18, speed=0.22, dmg=2, box=(0.9, 0.95), xp=3),
    "still_sheep":    dict(health=18, speed=0.21, dmg=2, box=(0.9, 1.35), xp=3),
    "still_chicken":  dict(health=10, speed=0.26, dmg=2, box=(0.42, 0.75), xp=2),
    "still_wolf":     dict(health=20, speed=0.29, dmg=4, box=(0.6, 0.9), xp=4),
    "still_player":   dict(health=34, speed=0.25, dmg=5, box=(0.62, 1.95), xp=8),
}

if __name__ == "__main__":
    for n, kw in ROSTER.items():
        w(f"entities/{n}.json", still_life(n, family=n, **kw))
    w("entities/the_tall_one.json", tall_one())
    w("entities/captain_clark.json", clark())
    print(f"entities: {len(ROSTER) + 2}")
