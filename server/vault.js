// Player vaults and save codes. Everything a save code stands for lives here on the server; the code itself is only a long random key.
//  - A code is 100 bits of crypto.randomInt randomness (20 symbols). The server stores only its SHA-256 hash, never the code.
//  - The code maps to an internal vault id; the vault holds the inventory, equipment, progress and up to three saved chunks.
//  - A vault is leased by one connected player at a time, so the same items can never be in two worlds at once.
import crypto from 'node:crypto';
import { store } from './store.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', BODY = 20;
export const CHUNK_SLOTS = 3;
const log = (...a) => console.log(new Date().toISOString(), ...a);

export function newCode() {
  const s = Array.from({ length: BODY }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join('');
  return 'VR-' + s.match(/.{5}/g).join('-');
}
export function parseCode(raw) { // tolerant of spaces, dashes and lower case; null when it cannot be one of ours
  let n = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (n.length === BODY + 2 && n.startsWith('VR')) n = n.slice(2);
  if (n.length !== BODY) return null;
  for (const ch of n) if (!ALPHA.includes(ch)) return null;
  return n;
}
const hashCode = (body) => crypto.createHash('sha256').update('voxel-realms-save:' + body).digest('hex');

/* ---------- cache and write-behind saving ---------- */
const cache = new Map(), leases = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function entry(rec) {
  let e = cache.get(rec.vid);
  if (!e) { e = { rec, dirty: false, saving: false, again: false, timer: null, last: Date.now() }; cache.set(rec.vid, e); }
  e.last = Date.now();
  return e;
}
export async function get(vid) {
  if (typeof vid !== 'string' || !/^[a-f0-9]{32}$/.test(vid)) return null;
  const e = cache.get(vid);
  if (e) { e.last = Date.now(); return e.rec; }
  const rec = await store.getJSON('save-' + vid);
  if (!rec) return null;
  const again = cache.get(vid); // someone else may have loaded it while we waited
  return again ? again.rec : entry(rec).rec;
}
export const cached = (vid) => { const e = vid && cache.get(vid); return e ? e.rec : null; };

async function flush(e) {
  e.timer = null;
  if (e.saving) { e.again = true; return; }
  if (!e.dirty) return;
  e.saving = true; e.dirty = false;
  try { await store.setJSON('save-' + e.rec.vid, e.rec); }
  catch (err) { e.dirty = true; log('vault save failed', e.rec.vid.slice(0, 6), err.message); e.timer = setTimeout(() => flush(e), 5000); }
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
setInterval(() => { // forget vaults nobody is using any more
  const now = Date.now();
  for (const [vid, e] of cache) if (!leases.has(vid) && !e.dirty && !e.saving && now - e.last > 600000) cache.delete(vid);
}, 60000).unref();

/* ---------- codes ---------- */
// make() is synchronous on purpose: the caller links the vault to the player in the same tick, so there is never a moment when the items
// are both in the world's record and in the vault. persistNew() then writes it out.
export function make(fields, name) {
  const code = newCode(), codeHash = hashCode(parseCode(code)), vid = crypto.randomBytes(16).toString('hex'), now = Date.now();
  const rec = { v: 1, vid, created: now, updated: now, name, codeHash, ...fields, chunks: Array(CHUNK_SLOTS).fill(null) };
  entry(rec);
  return { code, rec };
}
export async function persistNew(rec) { // the vault first, then the code that points at it
  await store.setJSON('save-' + rec.vid, rec);
  await store.setJSON('code-' + rec.codeHash, { vid: rec.vid });
}
// Used by game-file import: put a vault (and the code that opens it) into storage, returning what it replaced so the change can be undone.
export async function install(rec) {
  const prev = (cache.get(rec.vid) && JSON.parse(JSON.stringify(cache.get(rec.vid).rec))) || await store.getJSON('save-' + rec.vid);
  cache.delete(rec.vid);
  await store.setJSON('save-' + rec.vid, rec);
  await store.setJSON('code-' + rec.codeHash, { vid: rec.vid });
  if (prev && prev.codeHash !== rec.codeHash) await store.delJSON('code-' + prev.codeHash).catch(() => {});
  return prev;
}
export async function remove(vid, codeHash) { cache.delete(vid); await store.delJSON('save-' + vid); if (codeHash) await store.delJSON('code-' + codeHash).catch(() => {}); }
export const codeOwner = async (codeHash) => { const i = await store.getJSON('code-' + codeHash); return i && i.vid ? i.vid : null; };
export function discard(rec) { cache.delete(rec.vid); leases.delete(rec.vid); }
export async function find(code) {
  const body = parseCode(code); if (!body) return null;
  const idx = await store.getJSON('code-' + hashCode(body));
  return idx && idx.vid ? get(idx.vid) : null;
}
// A new code replaces the old one at once (use it if a code has leaked). The vault, its items and its chunks stay exactly as they are.
export async function rotate(rec) {
  const code = newCode(), codeHash = hashCode(parseCode(code)), old = rec.codeHash;
  await store.setJSON('code-' + codeHash, { vid: rec.vid });
  rec.codeHash = codeHash;
  await markDirty(rec, true); await flushNow(rec);
  if (old) await store.delJSON('code-' + old).catch(() => {});
  return code;
}

/* ---------- one player at a time ---------- */
export const holder = (vid) => { const q = leases.get(vid); return q && !q.left ? q : null; };
export const lease = (vid, p) => { leases.set(vid, p); };
export const unlease = (vid, p) => { if (leases.get(vid) === p) leases.delete(vid); };

/* ---------- guessing protection: only a few wrong codes per address ---------- */
const tries = new Map();
export function attemptAllowed(ip) {
  const now = Date.now();
  let b = tries.get(ip);
  if (!b) tries.set(ip, (b = { tokens: 10, t: now }));
  b.tokens = Math.min(10, b.tokens + ((now - b.t) / 1000) / 6); b.t = now; // refills one try every 6 seconds
  return b.tokens >= 1;
}
export function attemptFailed(ip) { const b = tries.get(ip); if (b) b.tokens = Math.max(0, b.tokens - 1); }
setInterval(() => { if (tries.size > 5000) tries.clear(); }, 60000).unref();
