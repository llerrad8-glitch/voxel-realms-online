// Minecraft-style water, run by the server so every player sees the same flood.
// Rules (the same ones the real game uses):
//  - a source block (id 5) feeds its four sides with "amount 7"; each block further away is one lower, down to 1 (7 blocks of reach);
//  - water over air falls straight down as a full-height column (id 30); where it lands it spreads sideways with amount 7;
//  - flowing water heads for the nearest drop (within 4 blocks) instead of spreading evenly;
//  - a flowing block with two source neighbours and a solid or source floor becomes a source (infinite water);
//  - take away the source and the flow drains away again, one block per step.
// Steps run every 5th server tick (0.25 s), the same pace as the real game, with a per-step budget so a flood never lags the server.
import { B, isWater, isSolid, waterAmount, flowId, WATER_FALL } from '../public/shared/world.js';
import { blockAt, setBlock } from './world.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // d ^ 1 is the opposite direction
const BUDGET = 600;

const hole = (room, x, y, z) => y > 0 && !isSolid(blockAt(room, x, y - 1, z)); // would water poured here drop further?

function slope(room, x, y, z, depth, from) { // distance (in blocks, max 4) to the nearest drop, searching sideways
  let best = 1000;
  for (let d = 0; d < 4; d++) {
    if (d === from) continue;
    const nx = x + DIRS[d][0], nz = z + DIRS[d][1], nb = blockAt(room, nx, y, nz);
    if (isSolid(nb) || nb === B.WATER) continue;
    if (hole(room, nx, y, nz)) return depth;
    if (depth < 4) { const j = slope(room, nx, y, nz, depth + 1, d ^ 1); if (j < best) best = j; }
  }
  return best;
}

function sideTargets(room, x, y, z) { // the directions water prefers: toward the closest drop, else all open sides
  let best = 1000, out = [];
  for (let d = 0; d < 4; d++) {
    const nx = x + DIRS[d][0], nz = z + DIRS[d][1], nb = blockAt(room, nx, y, nz);
    if (isSolid(nb) || nb === B.WATER) continue;
    const j = hole(room, nx, y, nz) ? 0 : slope(room, nx, y, nz, 1, d ^ 1);
    if (j < best) { best = j; out = []; }
    if (j <= best) out.push(d);
  }
  return out;
}

// What a flowing block should be right now, given its neighbours (0 = it dries up).
function nextState(room, x, y, z) {
  let top = 0, sources = 0;
  for (const [dx, dz] of DIRS) {
    const nb = blockAt(room, x + dx, y, z + dz);
    if (!isWater(nb)) continue;
    if (nb === B.WATER) sources++;
    top = Math.max(top, waterAmount(nb));
  }
  const below = blockAt(room, x, y - 1, z);
  if (sources >= 2 && (isSolid(below) || below === B.WATER)) return B.WATER;
  if (isWater(blockAt(room, x, y + 1, z))) return WATER_FALL;
  return top - 1 <= 0 ? 0 : flowId(top - 1, false);
}

function updateCell(room, x, y, z) {
  const id = blockAt(room, x, y, z);
  if (!isWater(id)) return; // empty cells are filled by the water beside or above them, never on their own
  if (id !== B.WATER) {
    const want = nextState(room, x, y, z);
    if (want !== id) { setBlock(room, x, y, z, want); return; } // the change wakes this cell and its neighbours for the next step
  }
  const src = id === B.WATER, fall = id === WATER_FALL, below = y > 0 ? blockAt(room, x, y - 1, z) : B.BEDROCK;
  if (y > 0 && below === 0) { setBlock(room, x, y - 1, z, WATER_FALL); return; } // water over air falls first (the change wakes this cell again)
  if (!src && !isSolid(below)) return; // flowing or falling water over more water does not also spread sideways
  const a = fall ? 7 : waterAmount(id) - 1;
  if (a <= 0) return;
  for (const d of sideTargets(room, x, y, z)) {
    const nx = x + DIRS[d][0], nz = z + DIRS[d][1];
    if (blockAt(room, nx, y, nz) === 0) setBlock(room, nx, y, nz, flowId(a, false));
  }
}

// Called every server tick; does real work every 5th one.
export function tickWater(room, tickN) {
  const q = room.wq;
  if (!q || !q.size || tickN % 5) return;
  const batch = [];
  for (const k of q) { batch.push(k); if (batch.length >= BUDGET) break; }
  for (const k of batch) q.delete(k);
  for (const k of batch) { const [x, y, z] = k.split(',').map(Number); updateCell(room, x, y, z); }
}
