/*
 * The maps: eight places from the films, each with its own look, music and mid-round event.
 * A map module default-exports { id, name, film, blurb, size, ambience, music, event, build(P, r) }.
 */
const LOADERS = {
  village: () => import('../world/maps/village.js'),
  prison: () => import('../world/maps/prison.js'),
  school: () => import('../world/maps/school.js'),
  war: () => import('../world/maps/war.js'),
  hospital: () => import('../world/maps/hospital.js'),
  forest: () => import('../world/maps/forest.js'),
  limbo: () => import('../world/maps/limbo.js'),
  city: () => import('../world/maps/city.js')
};
export const MAP_IDS = Object.keys(LOADERS);
const cache = new Map();

export async function loadMap(id) {
  if (cache.has(id)) return cache.get(id);
  const m = (await LOADERS[id]()).default;
  cache.set(id, m);
  return m;
}
export async function loadLobby() { return (await import('../world/maps/camp.js')).default; }
/** Every map that loads (one still being built is left out of the vote). */
export async function availableMaps() {
  const out = [];
  for (const id of MAP_IDS) { try { out.push(await loadMap(id)); } catch { /* not built yet */ } }
  return out;
}
