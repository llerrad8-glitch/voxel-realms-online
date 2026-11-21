// Minecraft-style water, run by the server so every player sees the same flood.
// Rules (the same ones the real game uses):
//  - a source block (id 5) feeds its four sides with "amount 7"; each block further away is one lower, down to 1 (7 blocks of reach);
//  - water over air falls straight down as a full-height column (id 30); where it lands it spreads sideways with amount 7;
//  - water heads for the nearest drop (within 4 blocks) and otherwise spreads evenly;
//  - a flowing block with two source neighbours and a solid or source floor becomes a source (infinite water);
//  - take away the source and the flow drains away again, one block per step.
// Steps run every 5th server tick (0.25 s), the same pace as the real game, with a per-step budget so a flood never lags the server.
import { B, CS, CH, isWater, isLava, isFluid, isSolid, waterAmount, flowId, WATER_FALL, lavaAmount, lavaFlowId, LAVA_FALL } from '../public/shared/world.js';
import { blockAt, baseChunk, setBlock, claimAt, chunkKey } from './world.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // d ^ 1 is the opposite direction
const BUDGET = 600;

const SRC = (id) => id === B.WATER || id === B.SEAWEED; // still water (seaweed stands in a full block of it)
const hole = (room, x, y, z) => y > 0 && !isSolid(blockAt(room, x, y - 1, z)); // would water poured here drop further?

function slope(room, x, y, z, depth, from) { // distance (in blocks, max 4) to the nearest drop, searching sideways
  let best = 1000;
  for (let d = 0; d < 4; d++) {
    if (d === from) continue;
    const nx = x + DIRS[d][0], nz = z + DIRS[d][1], nb = blockAt(room, nx, y, nz);
    if (isSolid(nb) || SRC(nb) || isLava(nb)) continue;
    if (hole(room, nx, y, nz)) return depth;
    if (depth < 4) { const j = slope(room, nx, y, nz, depth + 1, d ^ 1); if (j < best) best = j; }
  }
  return best;
}

function sideTargets(room, x, y, z) { // the directions water prefers: toward the closest drop, else all open sides
  let best = 1000, out = [];
  for (let d = 0; d < 4; d++) {
    const nx = x + DIRS[d][0], nz = z + DIRS[d][1], nb = blockAt(room, nx, y, nz);
    if (isSolid(nb) || SRC(nb) || isLava(nb)) continue;
    const j = hole(room, nx, y, nz) ? 0 : slope(room, nx, y, nz, 1, d ^ 1);
    if (j < best) { best = j; out = []; }
    if (j <= best) out.push(d);
  }
  return out; // the nearest drop if there is one, otherwise every open side
}

// What a flowing block should be right now, given its neighbours (0 = it dries up).
function nextState(room, x, y, z) {
  let top = 0, sources = 0;
  for (const [dx, dz] of DIRS) {
    const nb = blockAt(room, x + dx, y, z + dz);
    if (!isWater(nb)) continue;
    if (SRC(nb)) sources++;
    top = Math.max(top, waterAmount(nb));
  }
  const below = blockAt(room, x, y - 1, z);
  if (sources >= 2 && (isSolid(below) || SRC(below))) return B.WATER;
  if (isWater(blockAt(room, x, y + 1, z))) return WATER_FALL;
  return top - 1 <= 0 ? 0 : flowId(top - 1, false);
}

function updateCell(room, x, y, z) {
  const id = blockAt(room, x, y, z);
  if (!isWater(id)) return; // empty cells are filled by the water beside or above them, never on their own
  if (!SRC(id)) {
    const want = nextState(room, x, y, z);
    if (want !== id) { setBlock(room, x, y, z, want); return; } // the change wakes this cell and its neighbours for the next step
  }
  const src = SRC(id), fall = id === WATER_FALL, below = y > 0 ? blockAt(room, x, y - 1, z) : B.BEDROCK;
  if (y > 0 && below === 0) { setBlock(room, x, y - 1, z, WATER_FALL); return; } // water over air falls first (the change wakes this cell again)
  if (!src && !isSolid(below)) return; // flowing or falling water over more water does not also spread sideways
  const a = fall ? 7 : waterAmount(id) - 1;
  if (a <= 0) return;
  for (const d of sideTargets(room, x, y, z)) {
    const nx = x + DIRS[d][0], nz = z + DIRS[d][1];
    if (blockAt(room, nx, y, nz) !== 0) continue;
    if (claimAt(room, nx, nz) && chunkKey(nx, nz) !== chunkKey(x, z)) continue; // water from outside never floods a protected chunk
    setBlock(room, nx, y, nz, flowId(a, false));
  }
}

/* ---------- lava ---------- */
// Lava works like water but is slower (a step every 0.75 s) and only reaches 3 blocks. A source feeds its sides with amount 3.
function lavaNext(room, x, y, z) {
  let top = 0;
  for (const [dx, dz] of DIRS) { const nb = blockAt(room, x + dx, y, z + dz); if (isLava(nb)) top = Math.max(top, lavaAmount(nb)); }
  if (isLava(blockAt(room, x, y + 1, z))) return LAVA_FALL;
  return top - 1 <= 0 ? 0 : lavaFlowId(top - 1, false);
}
function updateLava(room, x, y, z) {
  const id = blockAt(room, x, y, z);
  if (!isLava(id)) return;
  if (id !== B.LAVA) {
    const want = lavaNext(room, x, y, z);
    if (want !== id) { setBlock(room, x, y, z, want); return; }
  }
  const src = id === B.LAVA, below = y > 0 ? blockAt(room, x, y - 1, z) : B.BEDROCK;
  if (y > 0 && below === 0) { setBlock(room, x, y - 1, z, LAVA_FALL); return; }
  if (!src && !isSolid(below)) return;
  const a = lavaAmount(id) - 1;
  if (a <= 0) return;
  for (const d of sideTargets(room, x, y, z)) {
    const nx = x + DIRS[d][0], nz = z + DIRS[d][1];
    if (blockAt(room, nx, y, nz) !== 0) continue;
    if (claimAt(room, nx, nz) && chunkKey(nx, nz) !== chunkKey(x, z)) continue;
    setBlock(room, nx, y, nz, lavaFlowId(a, false));
  }
}
// Water touching lava: a lava source becomes obsidian, flowing lava becomes cobblestone. (Checked for every lava cell that is woken.)
const TOUCH = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
function meet(room, x, y, z) {
  const id = blockAt(room, x, y, z);
  if (!isLava(id)) return;
  for (const [a, b, c] of TOUCH) {
    if (!isWater(blockAt(room, x + a, y + b, z + c))) continue;
    if (claimAt(room, x, z)) return; // protected chunks are left alone
    setBlock(room, x, y, z, id === B.LAVA ? B.OBSIDIAN : B.COBBLE);
    return;
  }
}

/* ---------- natural water and lava start moving by themselves ---------- */
// The terrain makes water and lava, but nothing has to touch it for it to flow: as a chunk comes within about 4 chunks of a player, every
// fluid block that has air beside it or under it is put on the update list once, so a river that meets a cave mouth pours in, a lava spring in a
// cave wall runs down to the floor, and so on. (Settled fluid is checked and left alone, so this is also safe for worlds that were already explored.)
const WAKE_R = 4;
function wakeChunk(room, cx, cz) {
  const c = baseChunk(room.seed, cx, cz, true, room.gen), q = room.wq, lq = room.lq;
  if (!c || !q || q.size > 20000) return;
  const ox = cx * CS, oz = cz * CS, clean = !(room.ec && room.ec.get(`${cx},${cz}`)); // no player edits here: the generated chunk is the truth
  const cell = (x, y, z) => (clean && x >= 0 && x < CS && z >= 0 && z < CS ? c[x + CS * (z + CS * y)] : blockAt(room, ox + x, y, oz + z, false));
  for (let y = 1; y < CH - 1; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    if (!isFluid(cell(x, y, z))) continue;
    if (cell(x, y - 1, z) === 0 || cell(x + 1, y, z) === 0 || cell(x - 1, y, z) === 0 || cell(x, y, z + 1) === 0 || cell(x, y, z - 1) === 0) {
      const k = `${ox + x},${y},${oz + z}`; q.add(k); if (lq) lq.add(k);
    }
  }
}
function wakeNear(room) { // one chunk per call, nearest to a player first
  const W = (room.woke ||= new Set());
  for (const p of room.players.values()) {
    const pcx = Math.floor(p.x / CS), pcz = Math.floor(p.z / CS);
    for (let r = 0; r <= WAKE_R; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const k = `${pcx + dx},${pcz + dz}`;
      if (W.has(k)) continue;
      W.add(k); wakeChunk(room, pcx + dx, pcz + dz); return;
    }
  }
}

// Called every server tick; does real work every 5th one (water) and every 15th (lava, slower than water but quick enough to watch).
export function tickWater(room, tickN) {
  if (tickN % 5 === 2 && room.players.size) wakeNear(room);
  const q = room.wq;
  if (q && q.size && tickN % 5 === 0) {
    const batch = [];
    for (const k of q) { batch.push(k); if (batch.length >= BUDGET) break; }
    for (const k of batch) q.delete(k);
    for (const k of batch) { const [x, y, z] = k.split(',').map(Number); if (isLava(blockAt(room, x, y, z))) meet(room, x, y, z); else updateCell(room, x, y, z); }
  }
  const lq = room.lq;
  if (lq && lq.size && tickN % 10 === 0) { // lava takes a step every half second (water: a quarter)
    const batch = [];
    for (const k of lq) { batch.push(k); if (batch.length >= BUDGET) break; }
    for (const k of batch) lq.delete(k);
    for (const k of batch) { const [x, y, z] = k.split(',').map(Number); updateLava(room, x, y, z); }
  }
}
