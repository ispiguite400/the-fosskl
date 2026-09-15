#!/usr/bin/env python3
"""
Generates the behaviour-pack entity definitions.

Bedrock's built-in pathfinder has no scripting API, so citizens navigate by
chasing an invisible marker entity (`ai:nav_point`) that the add-on's scripts
teleport along a planned route. `minecraft:behavior.nearest_attackable_target`
can only filter on static data, so a single shared marker family would let two
citizens lock onto each other's markers. Instead every marker and every citizen
is assigned one of NUM_CHANNELS families (`ai_nav_0` .. `ai_nav_N`); a citizen
only ever sees markers on its own channel.

Run:  python3 tools/generate_entities.py
"""

import json
import os

NUM_CHANNELS = 16
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "AI_Citizens_BP")


def travel_group(ch):
    return {
        "minecraft:behavior.nearest_attackable_target": {
            "priority": 2,
            "must_see": False,
            "must_reach": False,
            "reselect_targets": True,
            "within_radius": 64,
            "scan_interval": 2,
            "target_search_height": 32,
            "entity_types": [{
                "filters": {"test": "is_family", "subject": "other", "value": "ai_nav_%d" % ch},
                "max_dist": 64,
            }],
        },
        "minecraft:behavior.move_towards_target": {
            "priority": 3,
            "speed_multiplier": 1.0,
            "within_radius": 0.6,
        },
        "minecraft:behavior.look_at_target": {"priority": 8, "look_distance": 12},
    }


def citizen():
    groups = {
        "ai:mode_idle": {
            "minecraft:behavior.random_stroll": {
                "priority": 7, "speed_multiplier": 0.7,
                "xz_dist": 10, "y_dist": 5, "interval": 180,
            },
            "minecraft:behavior.look_at_player": {
                "priority": 8, "look_distance": 10, "probability": 0.05,
            },
            "minecraft:behavior.random_look_around": {"priority": 9, "look_distance": 8},
        },
        "ai:mode_combat": {
            "minecraft:behavior.hurt_by_target": {"priority": 1},
            "minecraft:behavior.nearest_attackable_target": {
                "priority": 2,
                "must_see": True,
                "must_see_forget_duration": 12,
                "reselect_targets": True,
                "within_radius": 24,
                "scan_interval": 8,
                "entity_types": [
                    {"filters": {"test": "is_family", "subject": "other", "value": "monster"}, "max_dist": 20},
                    {"filters": {"test": "has_tag", "subject": "other", "operator": "==", "value": "ai_hostile"}, "max_dist": 24},
                ],
            },
            "minecraft:behavior.melee_attack": {
                "priority": 3, "speed_multiplier": 1.15,
                "track_target": True, "reach_multiplier": 1.4,
            },
            "minecraft:behavior.look_at_target": {"priority": 8, "look_distance": 16},
        },
        "ai:mode_work": {
            "minecraft:behavior.look_at_target": {"priority": 8, "look_distance": 8},
            "minecraft:behavior.random_look_around": {"priority": 10, "look_distance": 4},
        },
        "ai:mode_rest": {
            "minecraft:behavior.look_at_player": {"priority": 9, "look_distance": 6, "probability": 0.02},
        },
        "ai:mode_flee": {
            "minecraft:behavior.avoid_mob_type": {
                "priority": 1,
                "entity_types": [{
                    "filters": {"test": "is_family", "subject": "other", "value": "monster"},
                    "max_dist": 14, "walk_speed_multiplier": 1.3, "sprint_speed_multiplier": 1.45,
                }],
                "probability_per_strength": 1.0,
            },
            "minecraft:behavior.panic": {"priority": 2, "speed_multiplier": 1.3, "ignore_mob_damage": False},
        },
        "ai:role_guard": {
            "minecraft:attack": {"damage": 6},
            "minecraft:health": {"value": 26, "max": 26},
            "minecraft:knockback_resistance": {"value": 0.5},
        },
        "ai:role_civilian": {
            "minecraft:attack": {"damage": 3},
            "minecraft:health": {"value": 20, "max": 20},
            "minecraft:knockback_resistance": {"value": 0.15},
        },
    }
    for ch in range(NUM_CHANNELS):
        groups["ai:travel_%d" % ch] = travel_group(ch)

    all_modes = ["ai:mode_idle", "ai:mode_combat", "ai:mode_work",
                 "ai:mode_rest", "ai:mode_flee"]
    all_travel = ["ai:travel_%d" % c for c in range(NUM_CHANNELS)]

    events = {
        "minecraft:entity_spawned": {
            "add": {"component_groups": ["ai:mode_idle", "ai:role_civilian"]}
        },
        "ai:become_guard": {
            "remove": {"component_groups": ["ai:role_civilian"]},
            "add": {"component_groups": ["ai:role_guard"]},
        },
        "ai:become_civilian": {
            "remove": {"component_groups": ["ai:role_guard"]},
            "add": {"component_groups": ["ai:role_civilian"]},
        },
    }
    for mode in all_modes:
        short = mode.split("mode_")[1]
        events["ai:set_" + short] = {
            "remove": {"component_groups": [m for m in all_modes if m != mode] + all_travel},
            "add": {"component_groups": [mode]},
        }
    for ch in range(NUM_CHANNELS):
        grp = "ai:travel_%d" % ch
        events["ai:set_travel_%d" % ch] = {
            "remove": {"component_groups": all_modes + [g for g in all_travel if g != grp]},
            "add": {"component_groups": [grp]},
        }

    return {
        "format_version": "1.21.0",
        "minecraft:entity": {
            "description": {
                "identifier": "ai:citizen",
                "is_spawnable": True,
                "is_summonable": True,
                "is_experimental": False,
                "properties": {
                    "ai:skin": {"type": "int", "range": [0, 19], "default": 0, "client_sync": True},
                    "ai:state": {"type": "int", "range": [0, 14], "default": 0, "client_sync": True},
                },
            },
            "component_groups": groups,
            "components": {
                "minecraft:type_family": {"family": ["ai_citizen", "citizen", "mob"]},
                "minecraft:collision_box": {"width": 0.6, "height": 1.9},
                "minecraft:health": {"value": 20, "max": 20},
                "minecraft:attack": {"damage": 3},
                "minecraft:movement": {"value": 0.3},
                "minecraft:underwater_movement": {"value": 0.14},
                "minecraft:movement.basic": {},
                "minecraft:jump.static": {},
                "minecraft:can_climb": {},
                "minecraft:physics": {},
                "minecraft:pushable": {"is_pushable": True, "is_pushable_by_piston": True},
                "minecraft:knockback_resistance": {"value": 0.15},
                "minecraft:follow_range": {"value": 64, "max": 96},
                "minecraft:navigation.walk": {
                    "can_path_over_water": False,
                    "can_pass_doors": True,
                    "can_open_doors": True,
                    "can_break_doors": False,
                    "avoid_water": True,
                    "avoid_damage_blocks": True,
                    "can_walk": True,
                    "can_sink": False,
                    "can_jump": True,
                },
                "minecraft:annotation.open_door": {},
                "minecraft:breathable": {
                    "total_supply": 15, "suffocate_time": 0,
                    "breathes_water": False, "generates_bubbles": True,
                },
                "minecraft:nameable": {"always_show": True, "allow_name_tag_renaming": False},
                "minecraft:persistent": {},
                "minecraft:conditional_bandwidth_optimization": {},
                "minecraft:inventory": {
                    "inventory_size": 36,
                    "container_type": "container",
                    "can_be_siphoned_from": False,
                    "private": False,
                    "restrict_to_owner": False,
                },
                "minecraft:equipment": {"table": "loot_tables/empty.json"},
                # NOTE: no "minecraft:equippable". Its schema requires an `item`
                # on every slot, which would restrict what a citizen may hold;
                # a slot entry without one is invalid and makes the entire
                # entity definition fail to load. The script layer asks for the
                # Equippable component and degrades to inventory-only when it is
                # not there, so held items are a visual nicety, not a dependency.
                "minecraft:behavior.pickup_items": {
                    "priority": 6, "max_dist": 5, "goal_radius": 1.5,
                    "speed_multiplier": 1.0, "can_pickup_any_item": True,
                    "pickup_based_on_chance": False, "track_target": True,
                },
                "minecraft:behavior.float": {"priority": 0},
                "minecraft:behavior.look_at_player": {"priority": 9, "look_distance": 10, "probability": 0.03},
                "minecraft:behavior.random_look_around": {"priority": 10, "look_distance": 8},
                "minecraft:loot": {"table": "loot_tables/empty.json"},
                "minecraft:hurt_on_condition": {
                    "damage_conditions": [{
                        "filters": {"test": "in_lava", "subject": "self", "operator": "==", "value": True},
                        "cause": "lava", "damage_per_tick": 4,
                    }]
                },
            },
            "events": events,
        },
    }


def nav_point():
    groups = {}
    events = {}
    for ch in range(NUM_CHANNELS):
        groups["ai:ch_%d" % ch] = {
            "minecraft:type_family": {"family": ["ai_nav_point", "ai_nav_%d" % ch]}
        }
    for ch in range(NUM_CHANNELS):
        events["ai:set_ch_%d" % ch] = {
            "remove": {"component_groups": ["ai:ch_%d" % c for c in range(NUM_CHANNELS) if c != ch]},
            "add": {"component_groups": ["ai:ch_%d" % ch]},
        }
    return {
        "format_version": "1.21.0",
        "minecraft:entity": {
            "description": {
                "identifier": "ai:nav_point",
                "is_spawnable": False,
                "is_summonable": True,
                "is_experimental": False,
            },
            "component_groups": groups,
            "components": {
                "minecraft:type_family": {"family": ["ai_nav_point"]},
                "minecraft:collision_box": {"width": 0.01, "height": 0.01},
                "minecraft:health": {"value": 1024, "max": 1024},
                "minecraft:physics": {"has_gravity": False, "has_collision": False},
                "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
                "minecraft:knockback_resistance": {"value": 1.0},
                "minecraft:fire_immune": {},
                "minecraft:damage_sensor": {
                    "triggers": [{"cause": "all", "deals_damage": False}]
                },
                "minecraft:persistent": {},
                "minecraft:is_hidden_when_invisible": {},
                "minecraft:loot": {"table": "loot_tables/empty.json"},
                "minecraft:conditional_bandwidth_optimization": {},
            },
            "events": events,
        },
    }


def main():
    os.makedirs(os.path.join(BP, "entities"), exist_ok=True)
    os.makedirs(os.path.join(BP, "loot_tables"), exist_ok=True)

    with open(os.path.join(BP, "entities", "ai_citizen.json"), "w") as fh:
        json.dump(citizen(), fh, indent=2)
    with open(os.path.join(BP, "entities", "ai_nav_point.json"), "w") as fh:
        json.dump(nav_point(), fh, indent=2)
    with open(os.path.join(BP, "loot_tables", "empty.json"), "w") as fh:
        json.dump({"pools": []}, fh, indent=2)

    # Keep the script layer's channel count in sync with the generated data.
    const = os.path.join(BP, "scripts", "core", "generated.js")
    os.makedirs(os.path.dirname(const), exist_ok=True)
    with open(const, "w") as fh:
        fh.write(
            "// GENERATED by tools/generate_entities.py - do not edit by hand.\n"
            "export const NAV_CHANNELS = %d;\n"
            "export const SKIN_COUNT = 20;\n" % NUM_CHANNELS
        )
    print("wrote entities for %d nav channels" % NUM_CHANNELS)


if __name__ == "__main__":
    main()
