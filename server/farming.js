// Farming: wheat grows through eight stages, faster next to water. Farmland near water (within four blocks) is watered.
// Generation 10 adds: saplings that grow into whole trees, berry bushes (four stages, ripe in the fourth) and sugar cane (up to three tall).
// Crops grow whenever anyone is in the world, also inside protected chunks (a Chunk Saver keeps a farm safe, it does not freeze it).
import { B, isWater, isWheat, isFarmland, isSapling, isBush, bushStage, isCane, isLeaf, isPlant, SAPLING0, treeBlocks } from '../public/shared/world.js';
import { blockAt, setBlock as setBlockLoud, cropSet, claimAt, chunkKey } from './world.js';
const setBlock = (room, x, y, z, id) => setBlockLoud(room, x, y, z, id, true); // crops growing never shake loose the sand beside them

const rnd = Math.random;
const SECS_PER_STAGE_DRY = 80, SECS_PER_STAGE_WET = 40; // average time for one growth stage: a ripe field takes about 5 to 10 minutes
const SAPLING_SECS = 120, BUSH_SECS = 90, CANE_SECS = 100; // average seconds for a sapling to grow into a tree, a bush to reach its next stage, a sugar cane to grow one block
const TREE_TYPES = ['oak', 'spruce', 'birch', 'pine', 'jungle', 'banana'];

// Is there water within four blocks (sideways) of this farmland block, on its own level or the one above?
export function wetNear(room, x, y, z) {
  for (let dy = 0; dy <= 1; dy++) for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) if (isWater(blockAt(room, x + dx, y + dy, z + dz, false))) return true;
  return false;
}
export function farmlandFor(room, x, y, z) { return wetNear(room, x, y, z) ? B.FARMLAND_WET : B.FARMLAND; }

// A sapling grows into its tree if there is room for the trunk (a jungle sapling tries a 3 x 3, then a 2 x 2, then a 1 x 1 tree). Leaves only fill empty cells.
function growSapling(room, x, y, z, id) {
  const below = blockAt(room, x, y - 1, z, false);
  if (below !== B.GRASS && below !== B.DIRT) return;
  const type = TREE_TYPES[id - SAPLING0], q = rnd(), top = type === 'jungle' ? (q < 0.65 ? 1 : q < 0.92 ? 2 : 3) : 1, sk = chunkKey(x, z);
  for (let size = top; size >= 1; size--) {
    const list = treeBlocks(type, x, y - 1, z, room.seed, size, rnd);
    let ok = true;
    for (const [bx, by, bz, , onlyAir] of list) {
      if (onlyAir || by < y) continue; // (a big trunk's roots go down into the ground)
      const cur = blockAt(room, bx, by, bz, false), c = claimAt(room, bx, bz);
      if (by >= 255 || cur === -1 || !(cur === 0 || isPlant(cur) || isLeaf(cur)) || (c && chunkKey(bx, bz) !== sk)) { ok = false; break; }
    }
    if (!ok) continue;
    for (const [bx, by, bz, bid, onlyAir] of list) {
      if (by > 255) continue;
      const c = claimAt(room, bx, bz);
      if (c && chunkKey(bx, bz) !== sk) continue; // a tree never grows into someone else's protected chunk
      if (onlyAir) { if (blockAt(room, bx, by, bz, false) !== 0) continue; }
      setBlock(room, bx, by, bz, bid);
    }
    return;
  }
}

// Called every server tick (20 a second); work happens once a second.
export function tickFarming(room, n) {
  if (n % 20) return;
  const crops = cropSet(room);
  if (!crops.size) return;
  for (const k of crops) {
    const [x, y, z] = k.split(',').map(Number);
    const id = blockAt(room, x, y, z, false);
    if (id === -1) continue; // not loaded right now
    if (isSapling(id)) { if (rnd() < 1 / SAPLING_SECS) growSapling(room, x, y, z, id); continue; }
    if (isBush(id)) { if (bushStage(id) >= 3) crops.delete(k); else if (rnd() < 1 / BUSH_SECS) setBlock(room, x, y, z, id + 1); continue; }
    if (isCane(id)) {
      let h = 1; while (blockAt(room, x, y - h, z, false) === B.SUGAR_CANE) h++;
      if (h < 3 && blockAt(room, x, y + 1, z, false) === 0 && rnd() < 1 / CANE_SECS) setBlock(room, x, y + 1, z, B.SUGAR_CANE);
      continue;
    }
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
