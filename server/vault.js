// Player profiles: the small per-account record that holds a player's three saved chunks (blocks, chests and all).
// The account is the browser's identity (a hash of its secret token), so there is nothing to type or remember. Everything here is
// saved by exporting a game save file (see gamesave.js); profiles are rebuilt from that file on any server.
import { store } from './store.js';

export const CHUNK_SLOTS = 3;
const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ---------- cache and write-behind saving ---------- */
const cache = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function entry(rec) {
  let e = cache.get(rec.vid);
  if (!e) { e = { rec, dirty: false, saving: false, again: false, timer: null, last: Date.now() }; cache.set(rec.vid, e); }
  e.last = Date.now();
  return e;
}
export async function get(vid) { // a stored profile, or null
  if (typeof vid !== 'string' || !/^[a-f0-9]{32}$/.test(vid)) return null;
  const e = cache.get(vid);
  if (e) { e.last = Date.now(); return e.rec; }
  const rec = await store.getJSON('save-' + vid);
  if (!rec) return null;
  const again = cache.get(vid);
  return again ? again.rec : entry(rec).rec;
}
// The profile of an account, created empty the first time it is needed (it is written to storage when it first holds a chunk).
export async function profile(vid) {
  const rec = await get(vid);
  if (rec) return rec;
  const now = Date.now(), fresh = { v: 2, vid, created: now, updated: now, chunks: Array(CHUNK_SLOTS).fill(null) };
  const again = cache.get(vid);
  return again ? again.rec : entry(fresh).rec;
}
export const cached = (vid) => { const e = vid && cache.get(vid); return e ? e.rec : null; };

async function flush(e) {
  e.timer = null;
  if (e.saving) { e.again = true; return; }
  if (!e.dirty) return;
  e.saving = true; e.dirty = false;
  try { await store.setJSON('save-' + e.rec.vid, e.rec); }
  catch (err) { e.dirty = true; log('profile save failed', e.rec.vid.slice(0, 6), err.message); e.timer = setTimeout(() => flush(e), 5000); }
  finally { e.saving = false; if (e.again) { e.again = false; if (e.dirty && !e.timer) flush(e); } }
}
export function markDirty(rec, now = false) {
  const e = entry(rec); e.dirty = true; rec.updated = Date.now();
  if (now) { clearTimeout(e.timer); return flush(e); }
  if (!e.timer) e.timer = setTimeout(() => flush(e), 2000);
  return Promise.resolve();
}
export async function flushNow(rec) {
  const e = entry(rec); clearTimeout(e.timer); e.timer = null;
  for (let i = 0; e.saving && i < 100; i++) await sleep(20);
  e.again = false; await flush(e);
}
export async function flushAll() { for (const e of [...cache.values()]) if (e.dirty) await flushNow(e.rec); }
setInterval(() => { // forget profiles nobody has touched for ten minutes
  const now = Date.now();
  for (const [vid, e] of cache) if (!e.dirty && !e.saving && now - e.last > 600000) cache.delete(vid);
}, 60000).unref();

/* ---------- game-file import ---------- */
// Put a profile into storage, returning what it replaced so the change can be undone.
export async function install(rec) {
  const prev = (cache.get(rec.vid) && JSON.parse(JSON.stringify(cache.get(rec.vid).rec))) || await store.getJSON('save-' + rec.vid);
  cache.delete(rec.vid);
  await store.setJSON('save-' + rec.vid, rec);
  return prev;
}
export async function remove(vid) { cache.delete(vid); await store.delJSON('save-' + vid); }
