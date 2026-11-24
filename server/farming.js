// Farming: wheat grows through eight stages, faster next to water. Farmland near water (within four blocks) is watered.
// Crops grow whenever anyone is in the world, also inside protected chunks (a Chunk Saver keeps a farm safe, it does not freeze it).
import { B, isWater, isWheat, isFarmland } from '../public/shared/world.js';
import { blockAt, setBlock as setBlockLoud, cropSet } from './world.js';
const setBlock = (room, x, y, z, id) => setBlockLoud(room, x, y, z, id, true); // crops growing never shake loose the sand beside them

const rnd = Math.random;
const SECS_PER_STAGE_DRY = 80, SECS_PER_STAGE_WET = 40; // average time for one growth stage: a ripe field takes about 5 to 10 minutes

// Is there water within four blocks (sideways) of this farmland block, on its own level or the one above?
export function wetNear(room, x, y, z) {
  for (let dy = 0; dy <= 1; dy++) for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) if (isWater(blockAt(room, x + dx, y + dy, z + dz, false))) return true;
  return false;
}
export function farmlandFor(room, x, y, z) { return wetNear(room, x, y, z) ? B.FARMLAND_WET : B.FARMLAND; }

// Called every server tick (20 a second); work happens once a second.
export function tickFarming(room, n) {
  if (n % 20) return;
  const crops = cropSet(room);
  if (!crops.size) return;
  for (const k of crops) {
    const [x, y, z] = k.split(',').map(Number);
    const id = blockAt(room, x, y, z, false);
    if (id === -1) continue; // not loaded right now
    if (!isWheat(id)) { crops.delete(k); continue; }
    const below = blockAt(room, x, y - 1, z, false);
    if (!isFarmland(below)) continue;
    let wet = below === B.FARMLAND_WET;
    if (rnd() < 0.15) { // now and then, check the water again (it may have been added or taken away)
      const w = wetNear(room, x, y - 1, z);
      if (w !== wet) { wet = w; setBlock(room, x, y - 1, z, w ? B.FARMLAND_WET : B.FARMLAND); }
    }
    if (id < 173 && rnd() < 1 / (wet ? SECS_PER_STAGE_WET : SECS_PER_STAGE_DRY)) setBlock(room, x, y, z, id + 1);
  }
}
