// Chunk claims: who owns which 16 x 16 chunk, who may touch it, and how a whole chunk is saved and put back.
// A claim belongs to a vault (a save code), not to a connection, so its owner is recognised wherever they enter their code.
import { CS, CH, B, isSolid } from '../public/shared/world.js';
import { blockAt, baseBlock, chunkKey, claimAt, ecAdd } from './world.js';
import { packCont, loadCont } from './inventory.js';
import { broadcastForce } from './net.js';

export const ck = (cx, cz) => `${cx},${cz}`;
const fl = Math.floor;
// Chunks within this many chunks of the world spawn can never be claimed, so nobody can wall off where everyone arrives (1 = the 3 x 3 chunks around spawn).
const SPAWN_RADIUS = Math.max(0, Math.min(4, Number.isFinite(Number(process.env.SPAWN_CLAIM_RADIUS)) && process.env.SPAWN_CLAIM_RADIUS !== undefined ? Number(process.env.SPAWN_CLAIM_RADIUS) : 1));
export const nearSpawn = (room, cx, cz) => !!room.spawn && Math.abs(cx - fl(room.spawn.x / CS)) <= SPAWN_RADIUS && Math.abs(cz - fl(room.spawn.z / CS)) <= SPAWN_RADIUS;

// The host of a private world: its creator (by browser token, or by save code if one was used), never anyone in the public world.
export const isHost = (room, p) => !!(room.owner && room.owner === p.th) || !!(room.ownerVid && p.vid && room.ownerVid === p.vid);

// Why this player may not change or use things at this column, or null if they may. kind: 'build' (place/break), 'container' (chests,
// furnaces), 'use' (beds). Claims are enforced for everyone, hosts included; the world's visitor permissions only bind visitors.
export function denyReason(room, p, x, z, kind) {
  const c = claimAt(room, x, z);
  if (c) return p.vid && c.vid === p.vid ? null : `This chunk is protected by ${c.owner}'s Chunk Saver. You cannot ${kind === 'build' ? 'build or break blocks' : 'use things'} here.`;
  if (!isHost(room, p)) {
    if (kind === 'build' && room.perm.build === false) return 'The host has turned off building for visitors.';
    if (kind === 'container' && room.perm.containers === false) return 'The host has turned off opening chests and furnaces for visitors.';
  }
  return null;
}

/* ---------- saving a chunk: every block of the full column (terrain included) plus the contents of every container ---------- */
export function snapshotChunk(room, cx, cz) {
  const ox = cx * CS, oz = cz * CS, buf = [];
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    let prev = -1, n = 0;
    for (let y = 0; y < CH; y++) {
      const id = blockAt(room, ox + x, y, oz + z) & 255;
      if (id === prev && n < 255) n++; else { if (n) buf.push(prev, n); prev = id; n = 1; }
    }
    buf.push(prev, n);
  }
  const conts = {};
  for (const [k, c] of room.containers) {
    const [x, y, z] = k.split(',').map(Number);
    if (fl(x / CS) === cx && fl(z / CS) === cz) conts[`${x - ox},${y},${z - oz}`] = packCont(c);
  }
  return { v: 1, cx, cz, blocks: Buffer.from(buf).toString('base64'), conts };
}
export function decode(snap) { // -> Uint8Array indexed (z * CS + x) * CH + y, or null if the data is damaged
  const raw = Buffer.from(String(snap.blocks || ''), 'base64'), out = new Uint8Array(CS * CS * CH);
  let col = 0, y = 0;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const id = raw[i], n = raw[i + 1];
    if (!n || col >= CS * CS || y + n > CH) return null;
    out.fill(id, col * CH + y, col * CH + y + n); y += n;
    if (y === CH) { col++; y = 0; }
  }
  return col === CS * CS && y === 0 ? out : null;
}

/* ---------- what stands in a chunk right now ---------- */
function eachEditIn(room, cx, cz, fn) {
  for (const [k, id] of room.edits) { const [x, y, z] = k.split(',').map(Number); if (fl(x / CS) === cx && fl(z / CS) === cz) fn(x, y, z, id, k); }
}
// A saved chunk may only go where nothing of anyone's stands: no claim, no player edits, no containers. That keeps it from overwriting builds.
export function chunkStatus(room, cx, cz) {
  if (nearSpawn(room, cx, cz)) return { ok: false, why: 'spawn' };
  const c = room.claims.get(ck(cx, cz));
  if (c) return { ok: false, why: 'claimed', by: c.owner };
  let built = (room.ec.get(ck(cx, cz)) || 0) > 0;
  if (!built) for (const k of room.containers.keys()) { const [x, , z] = k.split(',').map(Number); if (fl(x / CS) === cx && fl(z / CS) === cz) { built = true; break; } }
  return built ? { ok: false, why: 'built' } : { ok: true };
}

const BATCH = 3000; // blocks per message
function sendChanges(room, ch) { for (let i = 0; i < ch.length; i += BATCH * 4) broadcastForce(room, { t: 'blks', b: ch.slice(i, i + BATCH * 4) }); }

// Turn a chunk back into plain terrain: every player edit goes and its containers go with it (their contents live in the saved copy now).
export function clearChunk(room, cx, cz) {
  const ch = [], keys = [];
  eachEditIn(room, cx, cz, (x, y, z, id, k) => { keys.push(k); ch.push(x, y, z, baseBlock(room.seed, x, y, z)); });
  for (const k of keys) { room.edits.delete(k); const [x, , z] = k.split(',').map(Number); ecAdd(room, x, z, -1); }
  for (const k of [...room.containers.keys()]) { const [x, , z] = k.split(',').map(Number); if (fl(x / CS) === cx && fl(z / CS) === cz) room.containers.delete(k); }
  sendChanges(room, ch); room.markDirty();
}
// Put a saved chunk into this world exactly as it was. Returns false (and changes nothing) if the saved data is damaged.
export function applyChunk(room, cx, cz, snap) {
  const cells = decode(snap); if (!cells) return false;
  const ox = cx * CS, oz = cz * CS, ch = [];
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) for (let y = 0; y < CH; y++) {
    const gx = ox + x, gz = oz + z, want = cells[(z * CS + x) * CH + y], key = `${gx},${y},${gz}`, base = baseBlock(room.seed, gx, y, gz);
    const had = room.edits.has(key) ? room.edits.get(key) : base;
    const exists = room.edits.has(key);
    if (want === base) { if (exists) { room.edits.delete(key); ecAdd(room, gx, gz, -1); } } else { room.edits.set(key, want); if (!exists) ecAdd(room, gx, gz, 1); }
    if (want !== had) ch.push(gx, y, gz, want);
  }
  for (const [lk, c] of Object.entries(snap.conts || {})) {
    const [lx, y, lz] = lk.split(',').map(Number);
    if (![lx, y, lz].every(Number.isInteger) || lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 0 || y >= CH) continue;
    room.containers.set(`${ox + lx},${y},${oz + lz}`, loadCont(c));
  }
  sendChanges(room, ch); room.markDirty();
  return true;
}
// Where the Chunk Saver block stands inside saved data (so a restored claim can point at it).
export function findSaver(snap) {
  const cells = decode(snap); if (!cells) return null;
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) for (let y = 0; y < CH; y++) if (cells[(z * CS + x) * CH + y] === B.CHUNK_SAVER) return [x, y, z];
  return null;
}
// A safe place to stand in this column: on top of the highest block that has two free blocks above it.
export function surfaceY(room, x, z) {
  for (let y = CH - 3; y >= 1; y--) if (isSolid(blockAt(room, x, y, z)) && !isSolid(blockAt(room, x, y + 1, z)) && !isSolid(blockAt(room, x, y + 2, z))) return y + 1;
  return CH - 2;
}
export const inChunk = (cx, cz, x, z) => fl(x / CS) === cx && fl(z / CS) === cz;
export { chunkKey };
