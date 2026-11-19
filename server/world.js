// Server-side view of a world: seeded terrain plus the room's player edits.
import { CS, CH, B, genChunk, isSolid, isWater, isLava, isFluid, isTorch, isBed, torchSupport, bedDir, bedIsHead, DIR4 } from '../public/shared/world.js';
import { I } from '../public/shared/items.js';

const cache = new Map();
let budget = 0;
export const resetBudget = (n) => { budget = n; }; // chunk generations allowed per tick for background work (mobs)

export function baseChunk(seed, cx, cz, force, gen = 1) {
  const k = `${seed}:${gen}:${cx},${cz}`;
  let c = cache.get(k);
  if (c) { cache.delete(k); cache.set(k, c); return c; }
  if (!force && budget <= 0) return null;
  budget--;
  c = genChunk(cx, cz, seed, gen); cache.set(k, c);
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return c;
}
export function baseBlock(seed, x, y, z, force = true, gen = 1) {
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS), c = baseChunk(seed, cx, cz, force, gen);
  return c ? c[x - cx * CS + CS * (z - cz * CS + CS * y)] : -1; // -1 = not generated yet
}
export function blockAt(room, x, y, z, force = true) {
  if (y < 0) return B.BEDROCK;
  if (y >= CH) return 0;
  const v = room.edits.get(`${x},${y},${z}`);
  return v !== undefined ? v : baseBlock(room.seed, x, y, z, force, room.gen);
}
// Background logic treats ungenerated ground as solid so creatures never wander into the unknown.
export const solidAt = (room, x, y, z) => { const b = blockAt(room, x, y, z, false); return b === -1 || isSolid(b); };
// room.ec counts the player edits in each chunk, so "is anything built here?" is a lookup, not a scan.
export function ecAdd(room, x, z, d) { if (!room.ec) return; const k = chunkKey(x, z), n = (room.ec.get(k) || 0) + d; if (n > 0) room.ec.set(k, n); else room.ec.delete(k); }
export function setEdit(room, x, y, z, id) { // only differences from the seed are stored
  const k = `${x},${y},${z}`, had = room.edits.has(k);
  if (id === baseBlock(room.seed, x, y, z, true, room.gen)) { if (had) { room.edits.delete(k); ecAdd(room, x, z, -1); } } else { room.edits.set(k, id); if (!had) ecAdd(room, x, z, 1); }
}
// Chunks claimed by a Chunk Saver (room.claims maps "cx,cz" to the claim). Anything that changes blocks on its own, such as water or
// explosions, checks this so it never alters a protected chunk.
export const chunkKey = (x, z) => `${Math.floor(x / CS)},${Math.floor(z / CS)}`;
export const claimAt = (room, x, z) => (room.claims && room.claims.size ? room.claims.get(chunkKey(x, z)) || null : null);
export function touchClaim(room, x, z) { const c = claimAt(room, x, z); if (c) c.dirty = true; } // the saved copy is refreshed soon after
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
  const q = room.wq, lq = room.lq; if (!q || q.size > 20000) return;
  for (const [a, b, c] of NEAR) { const yy = y + b; if (yy >= 0 && yy < CH) { const k = `${x + a},${yy},${z + c}`; q.add(k); if (lq) lq.add(k); } }
}
// A torch needs a solid block to hang on, a bed needs its other half and a solid floor. When that goes, it breaks and drops itself.
const holds = (id) => isSolid(id) && !isBed(id);
function loseSupport(room, x, y, z, ox, oz) {
  if (ox !== undefined && claimAt(room, x, z) && chunkKey(x, z) !== chunkKey(ox, oz)) return; // a change outside a protected chunk never breaks things inside it
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
  setEdit(room, x, y, z, id); broadcast(room, { t: 'blk', x, y, z, id }); room.markDirty(); wakeWater(room, x, y, z); touchClaim(room, x, z);
  for (let i = 1; i < NEAR.length; i++) { const [a, b, c] = NEAR[i], q = blockAt(room, x + a, y + b, z + c, false); if (q >= 31 && q <= 43) loseSupport(room, x + a, y + b, z + c, x, z); }
  if (!isSolid(id)) { const up = blockAt(room, x, y + 1, z, false); if (up === B.SAND || up === B.GRAVEL) settle(room, x, y + 1, z); } // whatever held sand up is gone
}
// Sand and gravel with nothing under them become a falling block: it drops with gravity (the client animates it) and lands as a block again.
export function settle(room, x, y, z) {
  const F = (room.fall ||= new Map());
  for (; y < CH; y++) {
    const id = blockAt(room, x, y, z);
    if (id !== B.SAND && id !== B.GRAVEL) break;
    const below = y > 0 ? blockAt(room, x, y - 1, z) : B.BEDROCK;
    if (below !== 0 && !isFluid(below)) break; // held up
    setBlock(room, x, y, z, 0);
    const fid = ++room.entId; F.set(fid, { id: fid, b: id, x: x + 0.5, y, z: z + 0.5, vy: 0 });
  }
}
export function tickFall(room) {
  const F = room.fall; if (!F || !F.size) return;
  const dt = 0.05;
  for (const f of [...F.values()]) {
    f.vy = Math.max(-38, f.vy - 26 * dt);
    const ny = f.y + f.vy * dt, cx = Math.floor(f.x), cz = Math.floor(f.z), cy = Math.floor(ny);
    if (ny <= 1 || isSolid(blockAt(room, cx, cy, cz))) { // landed on something: the block settles in the cell above it
      const ly = ny <= 1 ? 1 : cy + 1, cur = blockAt(room, cx, ly, cz);
      if (cur === 0 || isFluid(cur)) setBlock(room, cx, ly, cz, f.b); else drop(room, cx, ly, cz, f.b);
      F.delete(f.id); continue;
    }
    f.y = ny;
  }
}