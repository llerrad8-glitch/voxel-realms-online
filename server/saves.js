// Save codes, Chunk Saver claims, restoring chunks, host settings: the rules that tie players, vaults and worlds together.
// Everything here is decided on the server. Clients only ask; they never send inventories, items or chunk data.
import { CS, CH, B } from '../public/shared/world.js';
import { mk } from './inventory.js';
import * as vault from './vault.js';
import { isHost, ck, snapshotChunk, applyChunk, clearChunk, chunkStatus, findSaver, surfaceY, inChunk } from './claims.js';
import { hooks, applyVault, vaultView, emptyPlayer, closeViewers, settleWindow } from './survival.js';
import { send, broadcast } from './net.js';
import { setLive, touchLive } from './live.js';
import { claimAt, setBlock } from './world.js';
import { spawnItem } from './ents.js';

const H = { getRoom: async () => null, dropPlayer() {}, touchRoom() {} };
export const init = (h) => Object.assign(H, h);
const tell = (p, m) => send(p.ws, { t: 'chat', m, sys: 1 });
const cleanRoomName = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 24);
const CHEATED_MSG = 'Save codes and Chunk Savers only work in survival worlds with no creative mode or cheats, so nothing can be made from nothing.';

/* ---------- what clients are told ---------- */
export const roomPub = (room, p) => ({ id: room.id, name: room.name, seed: room.seed, owner: isHost(room, p), host: room.hostName || '', max: room.max, mode: room.mode, pvp: room.pvp, cheats: room.cheats, live: !!room.live, perm: room.perm, cheated: room.cheated, locked: !!room.locked, claims: room.claims.size });
export const claimsFor = (room, p) => [...room.claims.values()].map((c) => ({ cx: c.cx, cz: c.cz, name: c.name, owner: c.owner, mine: !!(p.vid && c.vid === p.vid) }));
export const sendClaims = (room, p) => send(p.ws, { t: 'claims', list: claimsFor(room, p) });
export function info(room, p) {
  const rec = p.vid && vault.cached(p.vid), out = { on: !room.cheated, linked: !!rec, slots: [null, null, null] };
  if (!rec) return out;
  rec.chunks.forEach((c, i) => {
    if (!c) return;
    const live = room.claims.get(ck(c.cx, c.cz)), here = !!(live && live.vid === rec.vid && live.slot === i && c.wid === room.id);
    let st = 'here', why = '', by = '';
    if (!here) { const s = chunkStatus(room, c.cx, c.cz); st = s.ok ? 'ready' : 'blocked'; why = s.why || ''; by = s.by || ''; }
    out.slots[i] = { name: c.name, cx: c.cx, cz: c.cz, wname: c.wname, wid: c.wid, st, why, by };
  });
  return out;
}
export const sendInfo = (room, p) => send(p.ws, { t: 'vault', ...info(room, p) });
function claimsChanged(room, p) { for (const q of room.players.values()) sendClaims(room, q); if (p) sendInfo(room, p); }
hooks.claimsChanged = claimsChanged;

/* ---------- linking a player to a vault ---------- */
export function checkin(p) { // copy the player's items and progress into their vault (only when something changed)
  const rec = p.vid && vault.cached(p.vid); if (!rec) return;
  const v = vaultView(p), s = JSON.stringify(v);
  if (s === p.vlast) return;
  p.vlast = s; Object.assign(rec, v); rec.name = p.name; vault.markDirty(rec);
}
export async function redeem(room, p, code, ip) {
  if (room.cheated) return { ok: false, msg: CHEATED_MSG + ' You joined without your save code.' };
  if (p.vid) return { ok: false, msg: 'A save code is already linked to you.' };
  if (!vault.attemptAllowed(ip)) return { ok: false, msg: 'Too many save code attempts. Wait a minute and try again.' };
  const rec = await vault.find(code);
  if (!rec) { vault.attemptFailed(ip); return { ok: false, msg: 'That save code was not found. Check it and try again.' }; }
  const h = vault.holder(rec.vid);
  if (h && h !== p) {
    if (h.th !== p.th) return { ok: false, msg: `That save code is in use right now${h.room ? ` in "${h.room.name}"` : ''}. Only one player can use a save code at a time.` };
    send(h.ws, { t: 'err', m: 'You used your save code in another world.', fatal: true }); h.ws.close(1000); H.dropPlayer(h); // same browser: take over
  }
  if (p.vid || p.left) return { ok: false, msg: 'A save code is already linked to you.' };
  vault.lease(rec.vid, p); p.vid = rec.vid;
  settleWindow(room, p); applyVault(room, p, rec); checkin(p); vault.markDirty(rec, true);
  return { ok: true, msg: 'Save code accepted. Your inventory, equipment and saved chunks are with you.' };
}
export async function createFor(room, p) {
  if (room.cheated) return tell(p, CHEATED_MSG);
  if (p.vid) return tell(p, 'You already have a save code. Use "New code" if you need a fresh one.');
  if (p.vbusy) return; p.vbusy = true;
  settleWindow(room, p);
  const { code, rec } = vault.make(vaultView(p), p.name);
  vault.lease(rec.vid, p); p.vid = rec.vid; p.vlast = JSON.stringify(vaultView(p)); // from this moment the items live in the vault only
  try {
    await vault.persistNew(rec);
    send(p.ws, { t: 'vcode', code, why: 'new' }); sendInfo(room, p); sendClaims(room, p);
    tell(p, 'Your save code is ready. Copy it somewhere safe: it is the only way back to your items and chunks.');
  } catch (e) {
    console.log('save code creation failed', e.message);
    if (!p.left) { vault.discard(rec); p.vid = null; applyVault(room, p, rec); tell(p, 'Could not create the save code just now. Your items are unchanged, try again in a moment.'); sendInfo(room, p); }
  } finally { p.vbusy = false; }
}
export async function rotateFor(room, p) {
  const rec = p.vid && vault.cached(p.vid); if (!rec || p.vbusy) return;
  p.vbusy = true;
  try { const code = await vault.rotate(rec); send(p.ws, { t: 'vcode', code, why: 'rot' }); tell(p, 'Your new save code is ready. The old one no longer works.'); }
  catch (e) { console.log('rotate failed', e.message); tell(p, 'Could not make a new code just now. The old one still works.'); }
  finally { p.vbusy = false; }
}
function snapClaim(room, c) {
  c.dirty = false; c.snapAt = Date.now();
  const snap = snapshotChunk(room, c.cx, c.cz), rec = vault.cached(c.vid);
  const put = (r) => { const s = r && r.chunks[c.slot]; if (!s || s.wid !== room.id || s.cx !== c.cx || s.cz !== c.cz) return; s.data = snap; s.at = Date.now(); s.wname = room.name; vault.markDirty(r); };
  if (rec) put(rec); else vault.get(c.vid).then(put).catch(() => {});
}
export function refreshClaims(rooms, vid) { // sync: bring this vault's saved chunk copies up to date with the live chunks (used by export)
  for (const room of rooms) if (!room.cheated) for (const c of room.claims.values()) if (c.vid === vid) snapClaim(room, c);
}
export function saveNow(room, p) { // the "Save now" button
  const rec = p.vid && vault.cached(p.vid); if (!rec) return;
  checkin(p);
  if (!room.cheated) for (const c of room.claims.values()) if (c.vid === p.vid) snapClaim(room, c);
  vault.markDirty(rec, true); tell(p, 'Saved to your save code.');
}
export function beforeLeave(room, p) { // final check-in; the player's own claims are saved as they stand
  if (!p.vid) return;
  checkin(p);
  if (!room.cheated) for (const c of room.claims.values()) if (c.vid === p.vid) snapClaim(room, c);
  const rec = vault.cached(p.vid); if (rec) vault.flushNow(rec).catch(() => {});
}
export const afterLeave = (p) => { if (p.vid) vault.unlease(p.vid, p); p.vid = null; };
export function tick(room, n) {
  if (n % 40 === 0) for (const p of room.players.values()) if (p.vid && !p.left) checkin(p);
  if (n % 100 === 0 && !room.cheated && room.claims.size) { const now = Date.now(); for (const c of room.claims.values()) if (c.dirty && now - c.snapAt > 15000) snapClaim(room, c); }
}
export async function shutdown(rooms) {
  for (const room of rooms) if (!room.cheated) for (const c of room.claims.values()) if (c.dirty) snapClaim(room, c);
  await vault.flushAll();
}

/* ---------- claims: releasing, moving, restoring ---------- */
function dropClaim(room, c) { room.claims.delete(ck(c.cx, c.cz)); closeViewers(room, c.cx, c.cz, null); room.markDirty(); }
hooks.released = (room, c, p) => { // the owner mined their own Chunk Saver
  dropClaim(room, c);
  const rec = vault.cached(c.vid);
  if (rec && rec.chunks[c.slot] && rec.chunks[c.slot].cx === c.cx && rec.chunks[c.slot].cz === c.cz) { rec.chunks[c.slot] = null; vault.markDirty(rec, true); }
  tell(p, `Chunk "${c.name}" is released: it is no longer protected and its slot is free again.`);
  claimsChanged(room, p);
};
export async function release(room, p, m) {
  const rec = p.vid && vault.cached(p.vid), i = m.slot;
  if (!rec || !Number.isInteger(i) || i < 0 || i > 2 || !rec.chunks[i] || p.vbusy) return;
  p.vbusy = true;
  try {
    const s = rec.chunks[i], src = s.wid === room.id ? room : s.wid ? await H.getRoom(s.wid, null).catch(() => null) : null;
    const c = src && src.claims.get(ck(s.cx, s.cz));
    if (c && c.vid === rec.vid && c.slot === i) { dropClaim(src, c); if (src !== room) { claimsChanged(src, null); H.touchRoom(src); } } // the blocks stay as they are; the Chunk Saver block can be mined by anyone now
    rec.chunks[i] = null; vault.markDirty(rec, true);
    tell(p, `Released "${s.name}". Its slot is free. The chunk stays in its world as ordinary, unprotected blocks.`);
    claimsChanged(room, p);
  } finally { p.vbusy = false; }
}
export function unclaimHere(room, p) { // host of a private world: free a claim that is in the way
  if (room.locked || !isHost(room, p)) return 'Only the host of a private world can do that.';
  const c = claimAt(room, p.x, p.z);
  if (!c) return 'This chunk is not claimed.';
  dropClaim(room, c);
  if (room.edits.get(`${c.sx},${c.sy},${c.sz}`) === B.CHUNK_SAVER) { setBlock(room, c.sx, c.sy, c.sz, 0); spawnItem(room, mk(B.CHUNK_SAVER, 1), c.sx + 0.5, c.sy + 0.5, c.sz + 0.5); }
  vault.get(c.vid).then((rec) => { const s = rec && rec.chunks[c.slot]; if (s && s.cx === c.cx && s.cz === c.cz && s.wid === room.id) { rec.chunks[c.slot] = null; vault.markDirty(rec, true); } for (const q of room.players.values()) if (q.vid === c.vid) sendInfo(room, q); }).catch(() => {});
  claimsChanged(room, p);
  return `Released ${c.owner}'s chunk "${c.name}". The chunk stays as ordinary blocks.`;
}
function relocate(room, cx, cz) { // after a chunk is put back: nobody stays buried, nothing floats inside it
  for (const q of room.players.values()) if (!q.dead && inChunk(cx, cz, q.x, q.z)) {
    q.y = surfaceY(room, Math.floor(q.x), Math.floor(q.z)); q.fallTop = q.y; q.moved = true; q.bh = 30; q.bu = 30; q.bd = 120;
    send(q.ws, { t: 'fix', x: q.x, y: q.y, z: q.z });
  }
  for (const mob of [...room.mobs.values()]) if (inChunk(cx, cz, mob.x, mob.z)) room.mobs.delete(mob.id);
  for (const it of room.items.values()) if (inChunk(cx, cz, it.x, it.z)) { it.y = surfaceY(room, Math.floor(it.x), Math.floor(it.z)) + 0.5; it.vy = 0; }
}
export async function restore(room, p, m) {
  const rec = p.vid && vault.cached(p.vid), i = m.slot;
  if (!rec) return tell(p, 'Enter or create your save code first.');
  if (room.cheated) return tell(p, CHEATED_MSG);
  if (!Number.isInteger(i) || i < 0 || i > 2 || !rec.chunks[i] || p.vbusy) return;
  p.vbusy = true;
  try { await doRestore(room, p, rec, i, m.at === 'orig' ? 'orig' : 'here'); } finally { p.vbusy = false; }
}
async function doRestore(room, p, rec, i, where) {
  const slot = rec.chunks[i];
  const cx = where === 'orig' ? slot.cx : Math.floor(p.x / CS), cz = where === 'orig' ? slot.cz : Math.floor(p.z / CS);
  const fail = (msg) => send(p.ws, { t: 'cres', ok: false, slot: i, msg });
  const refuse = (st) => (where === 'orig'
    ? send(p.ws, { t: 'cprompt', slot: i, name: slot.name, cx, cz, why: st.why, by: st.by || '' })
    : fail(st.why === 'claimed' ? `This chunk is already claimed by ${st.by}. Walk to another spot and try again.` : st.why === 'spawn' ? 'The area around the world spawn cannot be claimed. Walk a little further out and try again.' : 'This chunk already has builds in it, so it is not free. Walk to a spot nobody has built on and try again.'));
  const mine = room.claims.get(ck(cx, cz));
  if (mine && mine.vid === rec.vid && mine.slot === i) return fail(`"${slot.name}" is already placed in this chunk.`);
  let st = chunkStatus(room, cx, cz);
  if (!st.ok) return refuse(st);
  if (!findSaver(slot.data || {})) { /* damaged copy: only usable if the live chunk can still be read below */ }
  const src = slot.wid === room.id ? room : slot.wid ? await H.getRoom(slot.wid, null).catch(() => null) : null;
  if (p.left || p.vid !== rec.vid || room.cheated) return;
  st = chunkStatus(room, cx, cz); // the world may have changed while the other one was loading
  if (!st.ok) return refuse(st);
  const old = src && src.claims.get(ck(slot.cx, slot.cz)), live = old && old.vid === rec.vid && old.slot === i;
  const data = live && !src.cheated ? snapshotChunk(src, slot.cx, slot.cz) : slot.data; // the live chunk is the newest copy
  const saver = data && findSaver(data);
  if (!saver) return fail('The saved data for this chunk is damaged, so it was not moved. Nothing was changed.');
  if (live) { // a chunk exists in one place only: it leaves the world it was in, so nothing is ever duplicated
    closeViewers(src, old.cx, old.cz, null); clearChunk(src, old.cx, old.cz); src.claims.delete(ck(old.cx, old.cz));
    if (src !== room) { claimsChanged(src, null); H.touchRoom(src); }
  }
  applyChunk(room, cx, cz, data);
  room.claims.set(ck(cx, cz), { cx, cz, vid: rec.vid, slot: i, name: slot.name, owner: p.name, at: Date.now(), sx: cx * CS + saver[0], sy: saver[1], sz: cz * CS + saver[2], dirty: false, snapAt: Date.now() });
  Object.assign(slot, { cx, cz, wid: room.id, wname: room.name, data, at: Date.now() });
  vault.markDirty(rec, true); room.markDirty();
  relocate(room, cx, cz);
  send(p.ws, { t: 'cres', ok: true, slot: i, msg: `"${slot.name}" is now placed here (chunk ${cx}, ${cz}), exactly as you saved it.` });
  tell(p, `"${slot.name}" has been placed in chunk ${cx}, ${cz}.`);
  claimsChanged(room, p);
}

/* ---------- host settings ---------- */
export function applySettings(room, p, s) {
  if (room.locked) return { ok: false, msg: 'The main public server always runs in survival mode. Its settings cannot be changed.' };
  if (!isHost(room, p)) return { ok: false, msg: 'Only the host of this world can change its settings.' };
  const next = {}, bool = (k) => typeof s[k] === 'boolean';
  if (typeof s.name === 'string' && cleanRoomName(s.name)) next.name = cleanRoomName(s.name);
  if (s.mode === 'survival' || s.mode === 'creative') next.mode = s.mode;
  for (const k of ['pvp', 'cheats', 'live']) if (bool(k)) next[k] = s[k];
  for (const k of ['build', 'containers']) if (bool(k)) next[k] = s[k];
  const taint = !room.cheated && ((next.mode === 'creative' && room.mode !== 'creative') || (next.cheats === true && !room.cheats));
  if (taint && room.claims.size) return { ok: false, msg: 'This world has protected chunks. Release or move them first: creative mode and cheats turn Chunk Savers off for good.' };
  if (taint) { // creative and cheats end save codes here: every linked player's items go safely back into their vault first
    for (const q of [...room.players.values()]) if (q.vid) {
      settleWindow(room, q); checkin(q);
      const rec = vault.cached(q.vid); if (rec) vault.flushNow(rec).catch(() => {});
      emptyPlayer(room, q); vault.unlease(q.vid, q); q.vid = null; q.vlast = '';
      tell(q, 'This world is now creative or has cheats on, so save codes are off here. Your items are safe in your save code.');
    }
    room.cheated = true;
  }
  if (next.name) room.name = next.name;
  if (next.mode && next.mode !== room.mode) { room.mode = next.mode; for (const q of room.players.values()) { settleWindow(room, q); send(q.ws, { t: 'wclose' }); } }
  if (next.pvp !== undefined) room.pvp = next.pvp;
  if (next.cheats !== undefined) room.cheats = next.cheats;
  if (next.build !== undefined) room.perm.build = next.build;
  if (next.containers !== undefined) room.perm.containers = next.containers;
  if (next.live !== undefined) { room.live = next.live; room.hostName = p.name; setLive(room, next.live); } else touchLive(room);
  room.markDirty();
  for (const q of room.players.values()) { send(q.ws, { t: 'rset', room: roomPub(room, q) }); sendInfo(room, q); }
  return { ok: true, msg: 'World settings updated.' };
}
export function hostCommand(room, p, c, args) { // chat versions of the same controls; null means "not one of these commands"
  const flag = (a) => (['on', 'true', 'yes', '1'].includes(a) ? true : ['off', 'false', 'no', '0'].includes(a) ? false : undefined);
  const run = (s) => applySettings(room, p, s).msg;
  const a = (args[0] || '').toLowerCase();
  switch (c) {
    case 'mode': return a === 'survival' || a === 'creative' ? run({ mode: a }) : 'Usage: /mode survival or /mode creative';
    case 'pvp': case 'cheats': case 'live': case 'build': case 'chests': {
      const f = flag(a); if (f === undefined) return `Usage: /${c} on or /${c} off`;
      return run({ [c === 'chests' ? 'containers' : c]: f });
    }
    case 'rename': return args.length ? run({ name: args.join(' ') }) : 'Usage: /rename New name';
    case 'unclaim': return unclaimHere(room, p);
    default: return null;
  }
}
