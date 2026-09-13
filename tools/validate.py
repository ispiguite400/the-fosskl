"""Cross-reference every asset path the pack JSON claims to use.

A Bedrock add-on fails silently and confusingly when a texture, geometry,
animation or sound path is wrong, so this walks the definitions and checks
that everything they point at is really on disk -- and that every entity,
item and block is wired up on both sides.
"""
import json, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
BP = os.path.join(ROOT, "packs", "StillLife_BP")
RP = os.path.join(ROOT, "packs", "StillLife_RP")
errors, warns = [], []


def err(m): errors.append(m)
def warn(m): warns.append(m)


def load(p):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception as e:
        err(f"{os.path.relpath(p, ROOT)}: invalid JSON -- {e}")
        return None


def walk(root, ext=".json"):
    for d, _, fs in os.walk(root):
        for f in fs:
            if f.endswith(ext):
                yield os.path.join(d, f)


VANILLA_TEX = {"textures/entity/steve", "textures/entity/alex",
               "textures/misc/enchanted_item_glint"}


def exists_tex(rel):
    if rel in VANILLA_TEX:
        return True                      # shipped by the base game
    for e in (".png", ".tga", ".jpg"):
        if os.path.exists(os.path.join(RP, rel + e)):
            return True
    return os.path.exists(os.path.join(RP, rel))


# ---------------------------------------------------------------- 1. JSON ok
files = list(walk(BP)) + list(walk(RP))
docs = {}
for p in files:
    d = load(p)
    if d is not None:
        docs[p] = d
print(f"json files parsed: {len(docs)}/{len(files)}")

# --------------------------------------------------- 2. geometry + anim ids
geos = set()
for p in walk(os.path.join(RP, "models")):
    d = docs.get(p) or {}
    for g in d.get("minecraft:geometry", []):
        geos.add(g["description"]["identifier"])

anims, controllers = set(), set()
for p in walk(os.path.join(RP, "animations")):
    anims |= set((docs.get(p) or {}).get("animations", {}).keys())
for p in walk(os.path.join(RP, "animation_controllers")):
    controllers |= set((docs.get(p) or {}).get("animation_controllers", {}).keys())
renders = set()
for p in walk(os.path.join(RP, "render_controllers")):
    renders |= set((docs.get(p) or {}).get("render_controllers", {}).keys())
print(f"geometries {len(geos)}  animations {len(anims)}  "
      f"anim controllers {len(controllers)}  render controllers {len(renders)}")

# ------------------------------------------------- 3. bones referenced exist
geo_bones = {}
for p in walk(os.path.join(RP, "models")):
    for g in (docs.get(p) or {}).get("minecraft:geometry", []):
        geo_bones[g["description"]["identifier"]] = {b["name"] for b in g.get("bones", [])}

# ------------------------------------------------------- 4. client entities
bp_ents, rp_ents = {}, {}
for p in walk(os.path.join(BP, "entities")):
    d = docs.get(p) or {}
    e = d.get("minecraft:entity", {})
    ident = e.get("description", {}).get("identifier")
    if ident:
        bp_ents[ident] = (p, e)

for p in walk(os.path.join(RP, "entity")):
    d = docs.get(p) or {}
    desc = d.get("minecraft:client_entity", {}).get("description", {})
    ident = desc.get("identifier")
    if not ident:
        continue
    rp_ents[ident] = (p, desc)
    rel = os.path.relpath(p, ROOT)

    for k, v in desc.get("geometry", {}).items():
        if v not in geos:
            err(f"{rel}: geometry '{v}' not defined")
    for k, v in desc.get("textures", {}).items():
        if not exists_tex(v):
            err(f"{rel}: texture '{v}' missing on disk")
    used_bones = set()
    for k, v in desc.get("animations", {}).items():
        if v.startswith("controller."):
            if v not in controllers:
                err(f"{rel}: animation controller '{v}' not defined")
        elif v not in anims:
            err(f"{rel}: animation '{v}' not defined")
    for rc in desc.get("render_controllers", []):
        name = rc if isinstance(rc, str) else list(rc.keys())[0]
        if name not in renders:
            err(f"{rel}: render controller '{name}' not defined")

    # every bone an animation drives must exist in this entity's geometry
    gid = desc.get("geometry", {}).get("default")
    bones = geo_bones.get(gid, set())
    for short, aid in desc.get("animations", {}).items():
        if aid.startswith("controller."):
            continue
        for p2 in walk(os.path.join(RP, "animations")):
            a = (docs.get(p2) or {}).get("animations", {}).get(aid)
            if not a:
                continue
            for bone in a.get("bones", {}):
                if bone not in bones:
                    err(f"{rel}: animation '{aid}' drives bone '{bone}' "
                        f"which '{gid}' does not have")

for i in bp_ents:
    if i not in rp_ents:
        err(f"entity {i} has behaviour but no client entity")
for i in rp_ents:
    if i not in bp_ents:
        err(f"entity {i} has a client entity but no behaviour")

# ------------------------------------ 5. anim controller states reference ok
for p in walk(os.path.join(RP, "animation_controllers")):
    for cid, c in (docs.get(p) or {}).get("animation_controllers", {}).items():
        users = [d for _, d in rp_ents.values()
                 if cid in (d.get("animations") or {}).values()]
        for sname, st in c.get("states", {}).items():
            for a in st.get("animations", []):
                key = a if isinstance(a, str) else list(a.keys())[0]
                for d in users:
                    if key not in (d.get("animations") or {}):
                        err(f"{cid}: state '{sname}' uses '{key}' which "
                            f"{d['identifier']} does not declare")

# ----------------------------------------------------------- 6. items/blocks
items, blocks = set(), set()
for p in walk(os.path.join(BP, "items")):
    d = (docs.get(p) or {}).get("minecraft:item", {})
    ident = d.get("description", {}).get("identifier")
    if ident:
        items.add(ident)
    icon = d.get("components", {}).get("minecraft:icon")
    if isinstance(icon, dict):
        icon = icon.get("texture") or (icon.get("textures") or {}).get("default")
    if icon:
        it = load(os.path.join(RP, "textures", "item_texture.json")) or {}
        if icon not in it.get("texture_data", {}):
            err(f"{ident}: icon '{icon}' not in item_texture.json")

terrain = load(os.path.join(RP, "textures", "terrain_texture.json")) or {}
for p in walk(os.path.join(BP, "blocks")):
    d = (docs.get(p) or {}).get("minecraft:block", {})
    ident = d.get("description", {}).get("identifier")
    if ident:
        blocks.add(ident)
    mi = d.get("components", {}).get("minecraft:material_instances", {})
    for k, v in mi.items():
        t = v.get("texture")
        if t and t not in terrain.get("texture_data", {}):
            err(f"{ident}: texture '{t}' not in terrain_texture.json")

it = load(os.path.join(RP, "textures", "item_texture.json")) or {}
for k, v in it.get("texture_data", {}).items():
    if not exists_tex(v["textures"]):
        err(f"item_texture.json: '{k}' -> {v['textures']} missing")
for k, v in terrain.get("texture_data", {}).items():
    if not exists_tex(v["textures"]):
        err(f"terrain_texture.json: '{k}' -> {v['textures']} missing")

# ---------------------------------------------------------------- 7. sounds
sd = load(os.path.join(RP, "sounds", "sound_definitions.json")) or {}
sound_ids = set(sd.get("sound_definitions", {}).keys())
for name, d in sd.get("sound_definitions", {}).items():
    for s in d.get("sounds", []):
        f = s["name"] if isinstance(s, str) else s.get("name")
        if not os.path.exists(os.path.join(RP, f + ".ogg")):
            err(f"sound_definitions: '{name}' -> {f}.ogg missing")

se = load(os.path.join(RP, "sounds.json")) or {}
for ent, d in se.get("entity_sounds", {}).get("entities", {}).items():
    if ent not in bp_ents:
        err(f"sounds.json: entity '{ent}' does not exist")
    for evn, sid in d.get("events", {}).items():
        s = sid if isinstance(sid, str) else sid.get("sound")
        if s and s not in sound_ids:
            err(f"sounds.json: {ent}.{evn} -> '{s}' not defined")

# ------------------------------------------- 8. sound ids used from scripts
script_src = ""
for p in walk(os.path.join(BP, "scripts"), ".js"):
    script_src += open(p).read()
for sid in sorted(set(re.findall(r'"(sl\.[a-z0-9_.]+)"', script_src))):
    if sid not in sound_ids:
        err(f"scripts reference sound '{sid}' which is not defined")

# ------------------------------- 9. entity / item / block ids used in scripts
for eid in sorted(set(re.findall(r'"(sl:(?:still_|the_|captain_)[a-z_]+)"', script_src))):
    if eid in items or eid in blocks:
        continue                       # sl:still_essence is an item, not a mob
    if eid not in bp_ents:
        err(f"scripts reference entity '{eid}' which does not exist")
for bid in sorted(set(re.findall(r'setType\("(sl:[a-z_]+)"', script_src)) |
                  set(re.findall(r'"(sl:[a-z_]+)"\s*\)\s*;?\s*//?\s*$', script_src))):
    if bid not in blocks and bid not in items:
        warn(f"scripts use '{bid}' which is neither a block nor an item")

# ------------------------------------------ 10. events triggered by scripts
declared = {}
for ident, (p, e) in bp_ents.items():
    declared[ident] = set(e.get("events", {}).keys())
all_events = set().union(*declared.values()) if declared else set()
for evn in sorted(set(re.findall(r'triggerEvent\(\s*"(sl:[a-z0-9_]+)"', script_src))):
    if evn not in all_events:
        err(f"scripts trigger entity event '{evn}' which no entity declares")
for tmpl in sorted(set(re.findall(r'triggerEvent\(`(sl:[a-z_]+)\$\{', script_src))):
    if not any(e.startswith(tmpl) for e in all_events):
        err(f"scripts trigger templated event '{tmpl}*' which no entity declares")

# ----------------------------------------- 11. component groups referenced
for ident, (p, e) in bp_ents.items():
    groups = set(e.get("component_groups", {}).keys())
    for evn, body in e.get("events", {}).items():
        for key in ("add", "remove"):
            for g in (body.get(key) or {}).get("component_groups", []):
                if g not in groups:
                    err(f"{ident}: event '{evn}' {key}s unknown group '{g}'")
        for r in body.get("randomize", []):
            t = r.get("trigger")
            if t and t not in e.get("events", {}):
                err(f"{ident}: randomize -> unknown event '{t}'")
    # properties used by set_property must be declared
    props = set(e.get("description", {}).get("properties", {}).keys())
    for evn, body in e.get("events", {}).items():
        for pk in (body.get("set_property") or {}):
            if pk not in props:
                err(f"{ident}: event '{evn}' sets undeclared property '{pk}'")

# ------------------------------------------------------ 12. recipes / loot
known = items | blocks
for p in walk(os.path.join(BP, "recipes")):
    d = docs.get(p) or {}
    for kind in ("minecraft:recipe_shaped", "minecraft:recipe_shapeless"):
        r = d.get(kind)
        if not r:
            continue
        ids = []
        for k, v in (r.get("key") or {}).items():
            ids.append(v["item"])
        for v in (r.get("ingredients") or []):
            ids.append(v["item"])
        ids.append(r["result"]["item"])
        for i in ids:
            if i.startswith("sl:") and i not in known:
                err(f"{os.path.basename(p)}: recipe uses unknown '{i}'")
        # shaped patterns must be rectangular and only use declared keys
        pat = r.get("pattern")
        if pat:
            if len({len(x) for x in pat}) != 1:
                err(f"{os.path.basename(p)}: pattern rows differ in length")
            used = {c for row in pat for c in row if c != " "}
            if used - set((r.get("key") or {}).keys()):
                err(f"{os.path.basename(p)}: pattern uses undefined key(s) "
                    f"{used - set(r['key'].keys())}")

for p in walk(os.path.join(BP, "loot_tables")):
    d = docs.get(p) or {}
    for pool in d.get("pools", []):
        for ent in pool.get("entries", []):
            n = ent.get("name", "")
            if n.startswith("sl:") and n not in known:
                err(f"{os.path.basename(p)}: loot entry unknown '{n}'")

# -------------------------------------------------- 13. spawn rules + lang
for p in walk(os.path.join(BP, "spawn_rules")):
    d = (docs.get(p) or {}).get("minecraft:spawn_rules", {})
    i = d.get("description", {}).get("identifier")
    if i and i not in bp_ents:
        err(f"{os.path.basename(p)}: spawn rule for unknown entity '{i}'")

lang = open(os.path.join(RP, "texts", "en_US.lang")).read()
for i in sorted(items):
    if f"item.{i}=" not in lang:
        warn(f"no lang entry for item {i}")
for b in sorted(blocks):
    if f"tile.{b}.name=" not in lang:
        warn(f"no lang entry for block {b}")
for e in sorted(bp_ents):
    if f"entity.{e}.name=" not in lang:
        warn(f"no lang entry for entity {e}")

# ---------------------------------------------------- 14. manifests + deps
for pack, name in ((BP, "BP"), (RP, "RP")):
    m = load(os.path.join(pack, "manifest.json")) or {}
    if not os.path.exists(os.path.join(pack, "pack_icon.png")):
        err(f"{name}: pack_icon.png missing")
    for mod in m.get("modules", []):
        if mod.get("type") == "script":
            entry = os.path.join(pack, mod["entry"])
            if not os.path.exists(entry):
                err(f"{name}: script entry {mod['entry']} missing")
bpm = load(os.path.join(BP, "manifest.json")) or {}
rpm = load(os.path.join(RP, "manifest.json")) or {}
deps = [d.get("uuid") for d in bpm.get("dependencies", []) if d.get("uuid")]
if rpm.get("header", {}).get("uuid") not in deps:
    err("BP manifest does not depend on the RP uuid")
uuids = [bpm["header"]["uuid"], rpm["header"]["uuid"]] + \
        [m["uuid"] for m in bpm["modules"]] + [m["uuid"] for m in rpm["modules"]]
if len(set(uuids)) != len(uuids):
    err("duplicate UUIDs across manifests")

# ------------------------------------------------------------------ report
print(f"entities {len(bp_ents)}  items {len(items)}  blocks {len(blocks)}  "
      f"sounds {len(sound_ids)}")
if warns:
    print(f"\n{len(warns)} warnings:")
    for w in warns[:20]:
        print(f"  ! {w}")
if errors:
    print(f"\n{len(errors)} ERRORS:")
    for e in errors[:60]:
        print(f"  x {e}")
    sys.exit(1)
print("\nall asset cross-references resolve.")
