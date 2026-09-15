/**
 * What ground belongs to a settlement.
 *
 * Kept separate from settlement.js so the action layer can ask "may I dig
 * here?" without pulling in the whole civilisation module (settlement.js
 * imports the builder, which imports the miner - a cycle waiting to happen).
 */
import { blueprintById } from "./blueprints.js";

const PLAZA_RADIUS = 6;

/**
 * True when `pos` lies inside a planned or finished building, its foundation,
 * or the plaza at the centre of town.
 *
 * Citizens gather from wherever is nearest, which without this check means
 * quarrying the town square and undermining the houses they just built.
 */
export function isReserved(settlement, pos) {
  if (!settlement || !pos) return false;

  for (const st of settlement.structures) {
    const bp = blueprintById(st.blueprintId);
    const halfW = Math.ceil((bp ? bp.width : 8) / 2) + 1;
    const halfD = Math.ceil((bp ? bp.depth : 8) / 2) + 1;
    const height = bp ? bp.height : 6;
    if (Math.abs(pos.x - st.origin.x) > halfW) continue;
    if (Math.abs(pos.z - st.origin.z) > halfD) continue;
    if (pos.y < st.origin.y - 3 || pos.y > st.origin.y + height + 1) continue;
    return true;
  }

  const dx = pos.x - settlement.origin.x;
  const dz = pos.z - settlement.origin.z;
  if (dx * dx + dz * dz < PLAZA_RADIUS * PLAZA_RADIUS && pos.y >= settlement.origin.y - 2) {
    return true;
  }
  return false;
}

/** Distance from the settlement centre, ignoring height. */
export function distanceFromCentre(settlement, pos) {
  if (!settlement) return Infinity;
  const dx = pos.x - settlement.origin.x;
  const dz = pos.z - settlement.origin.z;
  return Math.sqrt(dx * dx + dz * dz);
}
