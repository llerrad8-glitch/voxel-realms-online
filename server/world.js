// Server-side view of a world: seeded terrain plus the room's player edits.
import { CS, CH, B, genChunk, isSolid, isWater, isTorch, isBed, torchSupport, bedDir, bedIsHead, DIR4 } from '../public/shared/world.js';
import { I } from '../public/shared/items.js';

const cache = new Map();
let budget = 0;
export const resetBudget = (n) => { budget = n; }; // chunk generations allowed per tick for background work (mobs)

export function baseChunk(seed, cx, cz, force) {
  const k = `${seed}:${cx},${cz}`;
  let c = cache.get(k);
  if (c) { cache.delete(k); cache.set(k, c); return c; }
  if (!force && budget <= 0) return null;
  budget--;
  c = genChunk(cx, cz, seed); cache.set(k, c);
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return c;
}
export function baseBlock(seed, x, y, z, force = true) {
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS), c = baseChunk(seed, cx, cz, force);
  return c ? c[x - cx * CS + CS * (z - cz * CS + CS * y)] : -1; // -1 = not generated yet
}
export function blockAt(room, x, y, z, force = true) {
  if (y < 0) return B.BEDROCK;
  if (y >= CH) return 0;
  const v = room.edits.get(`${x},${y},${z}`);
  return v !== undefined ? v : baseBlock(room.seed, x, y, z, force);
}
// Background logic treats ungenerated ground as solid so creatures never wander into the unknown.
export const solidAt = (room, x, y, z) => { const b = blockAt(room, x, y, z, false); return b === -1 || isSolid(b); };
export function setEdit(room, x, y, z, id) { // only differences from the seed are stored
  const k = `${x},${y},${z}`;
  if (id === baseBlock(room.seed, x, y, z)) room.edits.delete(k); else room.edits.set(k, id);
}
export const exposedToSky = (room, x, y, z) => { for (let yy = y + 1; yy < CH; yy++) { const b = blockAt(room, x, yy, z, false); if (b !== 0 && !isWater(b) && b !== -1) return false; } return true; };
// True when no solid block sits between a and b (used for line of sight).
export function lineClear(room, a, b, force) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], n = Math.ceil(Math.hypot(dx, dy, dz) / 0.5);
  for (let i = 1; i < n; i++) {
    const t = i / n, x = Math.floor(a[0] + dx * t), y = Math.floor(a[1] + dy * t), z = Math.floor(a[2] + dz * t);
    if (force ? isSolid(blockAt(room, x, y, z)) : solidAt(room, x, y, z)) return false;
  }
  return true;
}
export const boxHitsSolid = (room, x, y, z, w, h) => {
  const hw = w / 2;
  for (let by = Math.floor(y + 1e-4); by <= Math.floor(y + h - 1e-4); by++)
    for (let bz = Math.floor(z - hw + 1e-4); bz <= Math.floor(z + hw - 1e-4); bz++)
      for (let bx = Math.floor(x - hw + 1e-4); bx <= Math.floor(x + hw - 1e-4); bx++) if (solidAt(room, bx, by, bz)) return true;
  return false;
};
export { CS, CH, B };

import { broadcast } from './net.js';
// Change a block for everyone in the room and mark the world for saving.
// Every change also wakes the water around it (see water.js), so holes fill and drains empty like the real game.
const NEAR = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export function wakeWater(room, x, y, z) {
  const q = room.wq; if (!q || q.size > 20000) return;
  for (const [a, b, c] of NEAR) { const yy = y + b; if (yy >= 0 && yy < CH) q.add(`${x + a},${yy},${z + c}`); }
}
// A torch needs a solid block to hang on, a bed needs its other half and a solid floor. When that goes, it breaks and drops itself.
const holds = (id) => isSolid(id) && !isBed(id);
function loseSupport(room, x, y, z) {
  const id = blockAt(room, x, y, z, false);
  if (isTorch(id)) {
    const [sx, sy, sz] = torchSupport(id, x, y, z);
    if (!holds(blockAt(room, sx, sy, sz, false))) { setBlock(room, x, y, z, 0); drop(room, x, y, z, B.TORCH); }
  } else if (isBed(id)) {
    const head = bedIsHead(id), [dx, dz] = DIR4[bedDir(id)], other = blockAt(room, head ? x - dx : x + dx, y, head ? z - dz : z + dz, false);
    const partner = other === (head ? id - 4 : id + 4), floor = holds(blockAt(room, x, y - 1, z, false));
    if (!partner || !floor) { setBlock(room, x, y, z, 0); if (partner) drop(room, x, y, z, I.BED); } // only the first half to go drops the bed
  }
}
function drop(room, x, y, z, item) { if (room.mode !== 'creative') (room.drops ||= []).push([x, y, z, item]); }
export function setBlock(room, x, y, z, id) {
  setEdit(room, x, y, z, id); broadcast(room, { t: 'blk', x, y, z, id }); room.markDirty(); wakeWater(room, x, y, z);
  for (let i = 1; i < NEAR.length; i++) { const [a, b, c] = NEAR[i], q = blockAt(room, x + a, y + b, z + c, false); if (q >= 31 && q <= 43) loseSupport(room, x + a, y + b, z + c); }
}
// Sand and gravel with nothing under them drop to the ground at once.
export function settle(room, x, y, z) {
  for (; y < CH; y++) {
    const id = blockAt(room, x, y, z);
    if (id !== B.SAND && id !== B.GRAVEL) break;
    let ly = y;
    while (ly > 1) { const b = blockAt(room, x, ly - 1, z); if (b === 0 || isWater(b)) ly--; else break; }
    if (ly !== y) { setBlock(room, x, y, z, 0); setBlock(room, x, ly, z, id); }
  }
}
