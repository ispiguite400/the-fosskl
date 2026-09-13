"""Items, blocks, recipes, loot tables and spawn rules."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from sprites import ITEMS as ITEM_SPRITES, BLOCKS as BLOCK_SPRITES

BP = os.path.join(os.path.dirname(__file__), "..", "packs", "StillLife_BP")
FV = "1.21.0"


def w(rel, obj):
    p = os.path.join(BP, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(obj, open(p, "w"), indent=2)


# ------------------------------------------------------------------ items
def item(name, category="items", **comps):
    c = {"minecraft:icon": f"sl_{name}", "minecraft:max_stack_size": 64}
    c.update(comps)
    return {"format_version": FV, "minecraft:item": {
        "description": {"identifier": f"sl:{name}",
                        "menu_category": {"category": category}},
        "components": c}}


def drink(nutrition, dur=1.6, always=True):
    return {"minecraft:food": {"nutrition": nutrition, "saturation_modifier": "low",
                               "can_always_eat": always},
            "minecraft:use_animation": "drink",
            "minecraft:use_modifiers": {"use_duration": dur, "movement_modifier": 0.35},
            "minecraft:max_stack_size": 16}


def armour(slot, prot, dur, ench):
    return {"minecraft:wearable": {"slot": f"slot.armor.{slot}", "protection": prot},
            "minecraft:durability": {"max_durability": dur},
            "minecraft:repairable": {"repair_items": [
                {"items": ["sl:stillcloth"], "repair_amount": 48}]},
            "minecraft:enchantable": {"slot": f"armor_{slot}", "value": 14},
            "minecraft:max_stack_size": 1,
            "minecraft:tags": {"tags": ["sl:stillcloth_set", "sl:backrooms_gear"]}}


def gen_items():
    I = {}
    I["cotton"] = item("cotton", "nature")
    I["stillcloth"] = item("stillcloth", "nature")
    I["still_essence"] = item("still_essence", "nature", **{
        "minecraft:glint": True, "minecraft:hover_text_color": "yellow"})
    I["tall_ones_tooth"] = item("tall_ones_tooth", "nature", **{
        "minecraft:glint": True, "minecraft:max_stack_size": 16,
        "minecraft:hover_text_color": "minecoin_gold"})
    I["reel_of_tape"] = item("reel_of_tape", "items",
                             **{"minecraft:max_stack_size": 16})

    I["almond_water"] = item("almond_water", "nature", **drink(4))
    I["bitter_almond_water"] = item("bitter_almond_water", "nature",
                                    **{**drink(2, 2.0), "minecraft:glint": True})
    I["cotton_bandage"] = item("cotton_bandage", "nature", **{
        "minecraft:food": {"nutrition": 1, "saturation_modifier": "poor",
                           "can_always_eat": True},
        "minecraft:use_animation": "bow",
        "minecraft:use_modifiers": {"use_duration": 2.2, "movement_modifier": 0.25},
        "minecraft:max_stack_size": 16})

    I["flicker_lantern"] = item("flicker_lantern", "equipment", **{
        "minecraft:durability": {"max_durability": 320},
        "minecraft:max_stack_size": 1, "minecraft:hand_equipped": True,
        "minecraft:repairable": {"repair_items": [
            {"items": ["minecraft:glowstone_dust"], "repair_amount": 60}]},
        "minecraft:tags": {"tags": ["sl:backrooms_gear"]}})
    I["camcorder"] = item("camcorder", "equipment", **{
        "minecraft:durability": {"max_durability": 180},
        "minecraft:max_stack_size": 1, "minecraft:hand_equipped": True,
        "minecraft:cooldown": {"category": "sl_camera", "duration": 2.5},
        "minecraft:tags": {"tags": ["sl:backrooms_gear"]}})
    I["polaroid"] = item("polaroid", "items", **{"minecraft:max_stack_size": 16})
    I["noclip_charm"] = item("noclip_charm", "equipment", **{
        "minecraft:max_stack_size": 1, "minecraft:glint": True,
        "minecraft:cooldown": {"category": "sl_noclip", "duration": 12.0},
        "minecraft:hover_text_color": "light_purple",
        "minecraft:tags": {"tags": ["sl:backrooms_gear"]}})
    I["exit_sign_shard"] = item("exit_sign_shard", "items", **{
        "minecraft:max_stack_size": 16, "minecraft:glint": True,
        "minecraft:cooldown": {"category": "sl_noclip", "duration": 12.0},
        "minecraft:hover_text_color": "green"})
    I["frontrooms_key"] = item("frontrooms_key", "items", **{
        "minecraft:max_stack_size": 1, "minecraft:glint": True,
        "minecraft:hover_text_color": "minecoin_gold"})
    I["hum_tuner"] = item("hum_tuner", "equipment", **{
        "minecraft:durability": {"max_durability": 140},
        "minecraft:max_stack_size": 1, "minecraft:hand_equipped": True,
        "minecraft:cooldown": {"category": "sl_tuner", "duration": 9.0},
        "minecraft:tags": {"tags": ["sl:backrooms_gear"]}})
    I["clarks_whistle"] = item("clarks_whistle", "equipment", **{
        "minecraft:max_stack_size": 1, "minecraft:glint": True,
        "minecraft:cooldown": {"category": "sl_whistle", "duration": 30.0},
        "minecraft:hover_text_color": "minecoin_gold"})
    I["distorted_compass"] = item("distorted_compass", "equipment", **{
        "minecraft:max_stack_size": 1,
        "minecraft:cooldown": {"category": "sl_compass", "duration": 4.0},
        "minecraft:tags": {"tags": ["sl:backrooms_gear"]}})
    I["sanity_anchor"] = item("sanity_anchor", "construction", **{
        "minecraft:block_placer": {"block": "sl:sanity_anchor_block"},
        "minecraft:max_stack_size": 16})

    I["static_blade"] = item("static_blade", "equipment", **{
        "minecraft:damage": 9, "minecraft:hand_equipped": True,
        "minecraft:max_stack_size": 1, "minecraft:glint": True,
        "minecraft:durability": {"max_durability": 980},
        "minecraft:enchantable": {"slot": "sword", "value": 16},
        "minecraft:repairable": {"repair_items": [
            {"items": ["sl:still_essence"], "repair_amount": 180}]},
        "minecraft:digger": {"use_efficiency": True, "destroy_speeds": [
            {"block": {"tags": "q.any_tag('wool')"}, "speed": 12}]},
        "minecraft:tags": {"tags": ["sl:backrooms_gear", "minecraft:is_sword"]}})
    I["wall_pry_bar"] = item("wall_pry_bar", "equipment", **{
        "minecraft:damage": 5, "minecraft:hand_equipped": True,
        "minecraft:max_stack_size": 1,
        "minecraft:durability": {"max_durability": 640},
        "minecraft:enchantable": {"slot": "pickaxe", "value": 12},
        "minecraft:repairable": {"repair_items": [
            {"items": ["minecraft:iron_ingot"], "repair_amount": 120}]},
        "minecraft:digger": {"use_efficiency": True, "destroy_speeds": [
            {"block": {"tags": "q.any_tag('stone','metal','wood')"}, "speed": 7}]},
        "minecraft:tags": {"tags": ["sl:backrooms_gear", "minecraft:is_pickaxe"]}})

    for n, (slot, prot, dur) in {
            "stillcloth_hood": ("head", 3, 240),
            "stillcloth_tunic": ("chest", 7, 300),
            "stillcloth_trousers": ("legs", 5, 280),
            "stillcloth_treads": ("feet", 3, 220)}.items():
        I[n] = item(n, "equipment", **armour(slot, prot, dur, 14))

    for n, o in I.items():
        w(f"items/{n}.json", o)
    missing = set(ITEM_SPRITES) - set(I)
    assert not missing, f"sprite with no item def: {missing}"
    print(f"items: {len(I)}")
    return I


# ----------------------------------------------------------------- blocks
def block(name, hardness=0.9, resist=1.2, light=0, color="#C8B45A",
          render="opaque", category="construction", friction=0.6,
          solid=True, dampening=None, tint=None):
    inst = {"texture": f"sl_{name}", "render_method": render}
    if tint:
        inst["tint_method"] = tint
    c = {
        "minecraft:destructible_by_mining": {"seconds_to_destroy": hardness},
        "minecraft:destructible_by_explosion": {"explosion_resistance": resist},
        "minecraft:map_color": color,
        "minecraft:geometry": "minecraft:geometry.full_block",
        "minecraft:material_instances": {"*": inst},
        "minecraft:friction": friction,
        "minecraft:light_dampening": dampening if dampening is not None else (15 if solid else 0),
    }
    if light:
        c["minecraft:light_emission"] = light
    if not solid:
        c["minecraft:collision_box"] = False
    return {"format_version": FV, "minecraft:block": {
        "description": {"identifier": f"sl:{name}",
                        "menu_category": {"category": category}},
        "components": c}}


def gen_blocks():
    B = {
        "wallpaper": block("wallpaper", 0.9, 1.2, color="#C8B45A"),
        "wallpaper_torn": block("wallpaper_torn", 0.7, 1.0, color="#A89440"),
        "damp_carpet": block("damp_carpet", 0.5, 0.6, color="#6A5C28", friction=0.72),
        "ceiling_tile": block("ceiling_tile", 0.4, 0.5, color="#B4AE94"),
        "buzzing_light": block("buzzing_light", 0.4, 0.5, light=15, color="#F6F0C4"),
        "moist_wall": block("moist_wall", 1.1, 1.4, color="#6E5C2E", friction=0.5),
        "exit_sign": block("exit_sign", 0.4, 0.5, light=9, color="#2E8B4A"),
        "hum_speaker": block("hum_speaker", 1.4, 3.0, color="#3A3630"),
        "cotton_bale": block("cotton_bale", 0.8, 0.8, color="#ECEAE0",
                             category="nature", friction=0.75),
        "exit_door": block("exit_door", 2.4, 8.0, light=7, color="#2E8B4A"),
        "sanity_anchor_block": block("sanity_anchor_block", 1.6, 6.0, light=13,
                                     color="#F6F0C4"),
        # you do not mine a rift. you walk into it.
        "noclip_rift": block("noclip_rift", -1, 3600000, light=8, color="#4A2C5E",
                             render="blend", solid=False, dampening=0),
    }
    B["noclip_rift"]["minecraft:block"]["components"]["minecraft:destructible_by_mining"] = False
    B["noclip_rift"]["minecraft:block"]["components"]["minecraft:destructible_by_explosion"] = False
    B["exit_door"]["minecraft:block"]["components"]["minecraft:destructible_by_explosion"] = \
        {"explosion_resistance": 1200}
    for n, o in B.items():
        w(f"blocks/{n}.json", o)
    missing = set(BLOCK_SPRITES) - set(B)
    assert not missing, f"sprite with no block def: {missing}"
    print(f"blocks: {len(B)}")


# ---------------------------------------------------------------- recipes
def shaped(rid, pattern, key, result, count=1):
    return {"format_version": "1.20.10", "minecraft:recipe_shaped": {
        "description": {"identifier": f"sl:{rid}"},
        "tags": ["crafting_table"], "pattern": pattern,
        "key": {k: {"item": v} for k, v in key.items()},
        "result": {"item": result, "count": count}}}


def shapeless(rid, ingredients, result, count=1):
    return {"format_version": "1.20.10", "minecraft:recipe_shapeless": {
        "description": {"identifier": f"sl:{rid}"}, "tags": ["crafting_table"],
        "ingredients": [{"item": i} for i in ingredients],
        "result": {"item": result, "count": count}}}


def gen_recipes():
    R = {}
    R["stillcloth"] = shaped("stillcloth", ["##", "##"], {"#": "sl:cotton"}, "sl:stillcloth")
    R["cotton_from_bale"] = shapeless("cotton_from_bale", ["sl:cotton_bale"], "sl:cotton", 9)
    R["cotton_bale"] = shaped("cotton_bale", ["###", "###", "###"],
                              {"#": "sl:cotton"}, "sl:cotton_bale")
    R["cotton_bandage"] = shaped("cotton_bandage", ["CCC"], {"C": "sl:cotton"},
                                 "sl:cotton_bandage", 2)
    R["almond_water"] = shaped("almond_water", [" C ", "CBC", " S "],
                               {"C": "sl:cotton", "B": "minecraft:potion",
                                "S": "minecraft:sugar"}, "sl:almond_water", 2)
    R["bitter_almond_water"] = shapeless(
        "bitter_almond_water", ["sl:almond_water", "sl:still_essence"],
        "sl:bitter_almond_water")
    R["hood"] = shaped("hood", ["SSS", "S S"], {"S": "sl:stillcloth"}, "sl:stillcloth_hood")
    R["tunic"] = shaped("tunic", ["S S", "SSS", "SSS"], {"S": "sl:stillcloth"},
                        "sl:stillcloth_tunic")
    R["trousers"] = shaped("trousers", ["SSS", "S S", "S S"], {"S": "sl:stillcloth"},
                           "sl:stillcloth_trousers")
    R["treads"] = shaped("treads", ["S S", "S S"], {"S": "sl:stillcloth"},
                         "sl:stillcloth_treads")
    R["static_blade"] = shaped("static_blade", [" E ", " E ", " I "],
                               {"E": "sl:still_essence", "I": "minecraft:stick"},
                               "sl:static_blade")
    R["wall_pry_bar"] = shaped("wall_pry_bar", ["  I", " I ", "I  "],
                               {"I": "minecraft:iron_ingot"}, "sl:wall_pry_bar")
    R["flicker_lantern"] = shaped("flicker_lantern", [" I ", "IEI", " I "],
                                  {"I": "minecraft:iron_nugget", "E": "sl:still_essence"},
                                  "sl:flicker_lantern")
    R["camcorder"] = shaped("camcorder", ["IGI", "IRI", "III"],
                            {"I": "minecraft:iron_ingot", "G": "minecraft:glass",
                             "R": "minecraft:redstone"}, "sl:camcorder")
    R["hum_tuner"] = shaped("hum_tuner", ["I I", "IEI", " I "],
                            {"I": "minecraft:iron_ingot", "E": "sl:still_essence"},
                            "sl:hum_tuner")
    R["noclip_charm"] = shaped("noclip_charm", [" G ", "GSG", " E "],
                               {"G": "minecraft:gold_ingot", "S": "sl:exit_sign_shard",
                                "E": "sl:still_essence"}, "sl:noclip_charm")
    R["distorted_compass"] = shapeless("distorted_compass",
                                       ["minecraft:compass", "sl:still_essence"],
                                       "sl:distorted_compass")
    R["reel_of_tape"] = shaped("reel_of_tape", ["III", "ISI", "III"],
                               {"I": "minecraft:iron_nugget", "S": "minecraft:string"},
                               "sl:reel_of_tape", 2)
    R["polaroid_blank"] = shapeless("polaroid_blank",
                                    ["minecraft:paper", "sl:reel_of_tape"],
                                    "sl:polaroid", 3)
    R["sanity_anchor"] = shaped("sanity_anchor", ["SGS", "SES", "SSS"],
                                {"S": "sl:stillcloth", "G": "minecraft:glowstone",
                                 "E": "sl:still_essence"}, "sl:sanity_anchor")
    R["wallpaper"] = shaped("wallpaper", ["CC", "CC"], {"C": "sl:cotton"},
                            "sl:wallpaper", 4)
    R["damp_carpet"] = shapeless("damp_carpet", ["sl:wallpaper", "minecraft:water_bucket"],
                                 "sl:damp_carpet", 1)
    R["ceiling_tile"] = shaped("ceiling_tile", ["SS", "SS"], {"S": "sl:stillcloth"},
                               "sl:ceiling_tile", 4)
    R["buzzing_light"] = shaped("buzzing_light", ["TTT", "TGT", "TTT"],
                                {"T": "sl:ceiling_tile", "G": "minecraft:glowstone"},
                                "sl:buzzing_light", 2)
    R["hum_speaker"] = shaped("hum_speaker", ["III", "INI", "III"],
                              {"I": "minecraft:iron_ingot", "N": "minecraft:note_block"},
                              "sl:hum_speaker")
    R["exit_sign"] = shaped("exit_sign", ["EEE"], {"E": "sl:exit_sign_shard"},
                            "sl:exit_sign")
    R["exit_door"] = shaped("exit_door", ["EEE", "EKE", "EEE"],
                            {"E": "sl:exit_sign", "K": "sl:frontrooms_key"},
                            "sl:exit_door")
    for n, o in R.items():
        w(f"recipes/{n}.json", o)
    print(f"recipes: {len(R)}")


# ------------------------------------------------------------ loot tables
def gen_loot():
    # every still life drops the same thing, whatever shape it was wearing
    w("loot_tables/entities/still_life.json", {"pools": [
        {"rolls": {"min": 1, "max": 2}, "entries": [
            {"type": "item", "name": "sl:cotton", "weight": 68,
             "functions": [{"function": "set_count", "count": {"min": 1, "max": 3}},
                           {"function": "looting_enchant", "count": {"min": 0, "max": 2}}]},
            {"type": "item", "name": "minecraft:white_wool", "weight": 32,
             "functions": [{"function": "set_count", "count": {"min": 1, "max": 2}}]}]},
        {"rolls": 1, "conditions": [{"condition": "random_chance", "chance": 0.11}],
         "entries": [{"type": "item", "name": "sl:still_essence",
                      "functions": [{"function": "set_count", "count": {"min": 1, "max": 1}}]}]},
    ]})
    w("loot_tables/entities/tall_one.json", {"pools": [
        {"rolls": 1, "entries": [{"type": "item", "name": "sl:tall_ones_tooth",
                                  "functions": [{"function": "set_count", "count": {"min": 1, "max": 2}}]}]},
        {"rolls": 1, "entries": [{"type": "item", "name": "sl:still_essence",
                                  "functions": [{"function": "set_count", "count": {"min": 4, "max": 8}}]}]},
        {"rolls": 1, "entries": [{"type": "item", "name": "sl:stillcloth",
                                  "functions": [{"function": "set_count", "count": {"min": 3, "max": 6}}]}]},
        {"rolls": 1, "conditions": [{"condition": "random_chance", "chance": 0.5}],
         "entries": [{"type": "item", "name": "sl:noclip_charm"}]},
    ]})
    w("loot_tables/entities/captain_clark.json", {"pools": [
        {"rolls": 1, "entries": [{"type": "item", "name": "sl:clarks_whistle"}]},
        {"rolls": 1, "entries": [{"type": "item", "name": "sl:frontrooms_key"}]},
        {"rolls": 1, "entries": [{"type": "item", "name": "sl:still_essence",
                                  "functions": [{"function": "set_count", "count": {"min": 8, "max": 14}}]}]},
        {"rolls": 1, "entries": [{"type": "item", "name": "sl:exit_sign_shard",
                                  "functions": [{"function": "set_count", "count": {"min": 2, "max": 5}}]}]},
    ]})
    print("loot tables: 3")


# ------------------------------------------------------------ spawn rules
def gen_spawn_rules():
    n = 0
    for name, weight in {"still_villager": 3, "still_cow": 2, "still_pig": 2,
                         "still_sheep": 2, "still_chicken": 2, "still_wolf": 1,
                         "still_player": 1}.items():
        w(f"spawn_rules/{name}.json", {
            "format_version": "1.8.0",
            "minecraft:spawn_rules": {
                "description": {"identifier": f"sl:{name}",
                                "population_control": "monster"},
                "conditions": [{
                    "minecraft:spawns_on_surface": {},
                    "minecraft:brightness_filter": {"min": 0, "max": 11,
                                                    "adjust_for_weather": False},
                    "minecraft:difficulty_filter": {"min": "easy", "max": "hard"},
                    "minecraft:weight": {"default": weight},
                    "minecraft:herd": {"min_size": 1, "max_size": 2},
                    "minecraft:biome_filter": {"test": "has_biome_tag",
                                               "operator": "==", "value": "overworld"},
                }]}})
        n += 1
    print(f"spawn rules: {n}")


if __name__ == "__main__":
    gen_items()
    gen_blocks()
    gen_recipes()
    gen_loot()
    gen_spawn_rules()
