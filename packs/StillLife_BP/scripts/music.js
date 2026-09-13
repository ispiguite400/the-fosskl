/* The music director.
 *
 * Every track is a long loop, so this just decides which one belongs to the
 * moment, stops whatever was playing when the answer changes, and leaves
 * deliberate stretches of silence in the calm case -- an ambient track that
 * never stops is wallpaper, and wallpaper is not tense.
 */
import { world } from "@minecraft/server";
import { safe, every, chance, rint, rnd, pick, tell } from "./util.js";
import { corruptionT, sanity } from "./state.js";
import { isInside } from "./backrooms.js";

const LEN = {                                   // seconds, from the encoder
  "sl.music.liminal_1": 71, "sl.music.liminal_2": 75, "sl.music.liminal_3": 73,
  "sl.music.backrooms_hum": 67, "sl.music.theme_tall": 70,
  "sl.music.theme_clark": 66, "sl.music.deep_distortion": 71,
};
const CALM = ["sl.music.liminal_1", "sl.music.liminal_2", "sl.music.liminal_3"];
const state = new Map();                        // playerId -> {id, until, quietUntil}

function stop(p, id) {
  safe(() => p.runCommand(`stopsound @s ${id}`), "stopsound");
}

function want(p) {
  const near = (fam, r) => safe(() => p.dimension.getEntities({
    location: p.location, maxDistance: r, families: [fam] }).length, "mus") ?? 0;

  if (safe(() => p.dimension.getEntities({
      location: p.location, maxDistance: 64, type: "sl:captain_clark" }).length,
      "clark") > 0) return "sl.music.theme_clark";
  if (safe(() => p.dimension.getEntities({
      location: p.location, maxDistance: 56, type: "sl:the_tall_one" }).length,
      "tall") > 0) return "sl.music.theme_tall";
  if (isInside(p)) return "sl.music.backrooms_hum";
  if (corruptionT() > 0.7 || sanity(p) < 25) return "sl.music.deep_distortion";
  return null;                                  // calm: pick from CALM, with gaps
}

export function install() {
  every(40, () => {
    const now = Date.now() / 1000;
    for (const p of world.getAllPlayers()) {
      let s = state.get(p.id);
      if (!s) { s = { id: null, until: 0, quietUntil: 0 }; state.set(p.id, s); }

      const target = want(p);

      // situation changed -> cut the old track immediately
      if (target && s.id !== target) {
        if (s.id) stop(p, s.id);
        safe(() => p.playSound(target, { volume: 0.85 }), "play");
        s.id = target;
        s.until = now + LEN[target] - 1;
        continue;
      }
      if (!target && s.id && !CALM.includes(s.id)) {
        stop(p, s.id);
        s.id = null;
        s.quietUntil = now + 20 + rnd() * 50;
        continue;
      }

      if (now < s.until) continue;              // still playing

      if (target) {                             // loop the situational track
        safe(() => p.playSound(target, { volume: 0.85 }), "loop");
        s.id = target;
        s.until = now + LEN[target] - 1;
      } else {
        if (now < s.quietUntil) continue;       // deliberate silence
        const t = corruptionT();
        if (!chance(0.35 + t * 0.4)) { s.quietUntil = now + 25 + rnd() * 45; continue; }
        const id = pick(CALM, rnd());
        safe(() => p.playSound(id, { volume: 0.7 + t * 0.2 }), "calm");
        s.id = id;
        s.until = now + LEN[id] - 1;
        s.quietUntil = s.until + 30 + rnd() * 60;
      }
    }
  }, "music");

  safe(() => world.afterEvents.playerLeave.subscribe((ev) => state.delete(ev.playerId)),
    "music-leave");
}
