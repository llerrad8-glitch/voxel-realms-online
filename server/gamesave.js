// Game Saves: export a player's whole game to one .vrworld file, and import it again, on this server or a brand new one.
// Nothing here needs Upstash, Redis or a persistent disk: the file itself carries everything.
//   Export: gathers (in one synchronous step, so it is a consistent snapshot) the account's owned worlds, its progress in other worlds,
//           its save code vault with every saved chunk, and the browser settings, then builds, re-reads and verifies the file.
//   Import: validates the whole file first, shows exactly what would be added or replaced, makes a backup of anything replaced,
//           writes everything, reads it back to verify, and undoes the lot if anything fails.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { store, DATA_DIR } from './store.js';
import * as vault from './vault.js';
import { buildFile, openFile, cleanPayload, SaveError, MAX_FILE, signingOn } from './vrworld.js';

const H = { rooms: new Map(), serialize: () => ({}), getRoom: async () => null, makePublic: null, newWorldId: () => '', setLiveFor() {}, refresh() {}, ownerOnline: () => false };
export const init = (h) => Object.assign(H, h);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
const yieldLoop = () => new Promise((r) => setImmediate(r));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const GAME_VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0'; } catch { return '0'; } })();
export const validToken = (t) => typeof t === 'string' && /^[a-f0-9]{32}$/.test(t);

/* ---------- which worlds belong to whom: an index built once from storage, kept current as worlds are saved ---------- */
let idx = null, building = null;
const summarize = (id, d) => ({ owner: d.owner || null, ownerVid: d.ownerVid || null, name: d.name || id, pl: new Set(Object.keys(d.players || {})) });
export function noteWorld(id, d) { if (idx) idx.set(id, summarize(id, d)); }
async function ensureIndex() {
  if (idx) return;
  if (!building) building = (async () => {
    const m = new Map(), ids = await store.listWorldIds();
    for (let i = 0; i < ids.length; i++) { try { const d = await store.load(ids[i]); if (d) m.set(ids[i], summarize(ids[i], d)); } catch (e) { log('index: could not read world', ids[i], e.message); } if (i % 25 === 24) await yieldLoop(); }
    idx = m;
  })().finally(() => { building = null; });
  await building;
}

/* ---------- export ---------- */
export async function exportGame({ token, code, client }) {
  if (!validToken(token)) throw new SaveError('This browser has no game on this server yet: join a world once, then export.');
  const th = sha(token);
  await ensureIndex();
  const ids = new Set();
  for (const [id, e] of idx) if (e.owner === th || e.pl.has(th)) ids.add(id);
  let vrec = null;
  if (code) { vrec = await vault.find(code); if (!vrec) throw new SaveError('The save code in the Save code box was not found on this server, so it cannot go into the file. Clear the box to export without a save code, or fix the code.'); }
  if (vrec) for (const [id, e] of idx) if (e.ownerVid === vrec.vid) ids.add(id);
  for (const r of H.rooms.values()) if (r.owner === th || r.saved[th] || (vrec && r.ownerVid === vrec.vid) || [...r.players.values()].some((p) => p.th === th)) ids.add(r.id);
  const loaded = new Map();
  for (const id of ids) if (!H.rooms.has(id)) { const d = await store.load(id); if (d) loaded.set(id, d); }
  if (vrec) vrec = await vault.get(vrec.vid);
  // ---- from here to the end of the gather there is no await: the snapshot is consistent ----
  const notes = [], worlds = [], records = [], sharedNames = [];
  if (vrec) { const holder = vault.holder(vrec.vid); if (holder) H.checkin(holder); H.refresh([...H.rooms.values()], vrec.vid); }
  for (const id of ids) {
    const r = H.rooms.get(id), d = r ? H.serialize(r) : loaded.get(id);
    if (!d) continue;
    if (d.owner === th || (vrec && d.ownerVid === vrec.vid)) worlds.push({ id, data: d });
    else if (d.players && d.players[th]) { records.push({ worldId: id, name: d.name || id, record: d.players[th] }); sharedNames.push(d.name || id); }
  }
  const vault0 = vrec ? JSON.parse(JSON.stringify(vrec)) : null;
  const clientData = {}; for (const k of ['name', 'cfg', 'code']) if (client && client[k] !== undefined && client[k] !== null) clientData[k] = client[k];
  // ---- end of gather ----
  if (!vault0) notes.push('No save code was included. If you use a save code, type it into the Save code box on the home screen before exporting, so your save-code inventory and saved chunks go into the file.');
  if (sharedNames.length) notes.push(`Shared worlds (${sharedNames.join(', ')}): your items and position there are included, but those worlds belong to other people and their blocks are not part of your file.`);
  const foreign = worlds.reduce((n, w) => n + (w.data.claims || []).filter((c) => !vault0 || c.vid !== vault0.vid).length, 0);
  if (foreign) notes.push(`${foreign} chunk(s) in your worlds are claimed by other players. Their blocks and protection are in your file, but their save codes are not: those players keep them by exporting their own game.`);
  const payload = { account: { th, created: Date.now() }, client: clientData, vault: vault0, notes, records, worlds };
  const counts = { worlds: worlds.length, changedBlocks: worlds.reduce((n, w) => n + w.data.edits.length / 4, 0), containers: worlds.reduce((n, w) => n + Object.keys(w.data.containers || {}).length, 0), savedChunks: vault0 ? vault0.chunks.filter(Boolean).length : 0, otherWorldRecords: records.length, saveCode: !!vault0 };
  const buf = await buildFile(payload, { gameVersion: GAME_VERSION, counts, notes, worlds: worlds.map((w) => ({ id: w.id, name: w.data.name, mode: w.data.mode, changedBlocks: w.data.edits.length / 4, containers: Object.keys(w.data.containers || {}).length })) });
  // verify what was just made by reading it back exactly as an import would
  const check = await openFile(buf), clean = cleanPayload(check.payload);
  const sum = (c) => [c.worlds.length, c.worlds.reduce((n, w) => n + w.data.edits.length / 4, 0), c.worlds.reduce((n, w) => n + Object.keys(w.data.containers).length, 0), c.vault ? c.vault.chunks.filter(Boolean).length : 0, c.records.length];
  const want = [worlds.length, counts.changedBlocks, counts.containers, counts.savedChunks, records.length], got = sum(clean);
  if (want.some((v, i) => v !== got[i])) throw new SaveError('The exported file failed its own verification, so it was not sent. Nothing was lost; please try again.');
  if (clean.issues.length) log('export issues', clean.issues.slice(0, 5));
  return { buf, counts, notes, issues: clean.issues };
}

/* ---------- import: plan, then commit ---------- */
const pending = new Map(), backups = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of pending) if (v.exp < now) pending.delete(k); for (const [k, v] of backups) if (v.exp < now) backups.delete(k); }, 60000).unref();

async function existingWorld(id) { const r = H.rooms.get(id); return r ? { room: r, data: H.serialize(r) } : { room: null, data: await store.load(id) }; }
async function makePlan(th, clean) {
  const items = [], thOld = clean.account.th;
  if (H.ownerOnline(th)) throw new SaveError('You are connected to a world right now. Go back to the main menu (Leave world), then import.');
  for (const w of clean.worlds) {
    const ex = await existingWorld(w.id), base = { key: `world:${w.id}`, kind: 'world', id: w.id, name: w.data.name, blocks: w.data.edits.length / 4, containers: Object.keys(w.data.containers).length };
    if (!ex.data) items.push({ ...base, status: 'new', detail: 'Will be added.' });
    else if (ex.data.owner === th || ex.data.owner === thOld) {
      if (ex.room && ex.room.players.size) items.push({ ...base, status: 'blocked', detail: 'Players are in this world right now. Try again when it is empty.' });
      else items.push({ ...base, status: 'conflict', detail: `This server already has this world (${ex.data.edits.length / 4} changed blocks). Replacing it overwrites that version.` });
    } else items.push({ ...base, status: 'copy', detail: 'Another player already owns a world with this code on this server, so yours is added as a separate copy with a new code. Nothing of theirs is touched.' });
  }
  if (clean.vault) {
    const v = clean.vault, ex = await vault.get(v.vid), owner = await vault.codeOwner(v.codeHash), base = { key: 'vault', kind: 'vault', name: 'Save code, inventory and saved chunks', chunks: v.chunks.filter(Boolean).length };
    if (owner && owner !== v.vid) items.push({ ...base, status: 'blocked', detail: 'This save code already belongs to a different save on this server, so it was not imported.' });
    else if (vault.holder(v.vid)) items.push({ ...base, status: 'blocked', detail: 'This save code is in use by a player right now. Try again after they leave.' });
    else if (ex) items.push({ ...base, status: 'conflict', detail: `This server already has this save code (last saved ${new Date(ex.updated).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC; the file's copy was saved ${new Date(v.updated).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC). Replacing it overwrites that inventory and those chunks.` });
    else items.push({ ...base, status: 'new', detail: 'Will be added. Your save code will work on this server again.' });
  }
  for (const r of clean.records) {
    const base = { key: `record:${r.worldId}`, kind: 'record', id: r.worldId, name: `Your progress in ${r.name}` };
    if (r.worldId === 'PUBLIC') { const ex = await existingWorld('PUBLIC'); items.push(ex.data && ex.data.players && ex.data.players[th] ? { ...base, status: 'conflict', detail: 'You already have progress in the public world here. Replacing it overwrites your current items and position.' } : { ...base, status: 'new', detail: 'Will be added.' }); continue; }
    const ex = await existingWorld(r.worldId);
    if (!ex.data) items.push({ ...base, status: 'blocked', detail: 'That world is not on this server (it belongs to someone else), so there is nothing to attach your progress to.' });
    else if (ex.room && ex.room.players.size && [...ex.room.players.values()].some((p) => p.th === th)) items.push({ ...base, status: 'blocked', detail: 'You are in this world right now.' });
    else items.push(ex.data.players && ex.data.players[th] ? { ...base, status: 'conflict', detail: 'You already have progress in this world here. Replacing it overwrites your current items and position.' } : { ...base, status: 'new', detail: 'Will be added.' });
  }
  return items;
}
export async function previewImport({ token, buf }) {
  if (buf.length > MAX_FILE) throw new SaveError('This file is larger than the server accepts.');
  const { version, header, payload, signature } = await openFile(buf);
  if (signingOn() && signature !== 'valid') throw new SaveError(signature === 'invalid' ? 'This file failed its signature check: it was changed after export, or it was made by a server with a different SAVE_SIGNING_KEY. Nothing was imported.' : 'This file is not signed, but this server requires signed save files (SAVE_SIGNING_KEY is set). Nothing was imported.');
  const clean = cleanPayload(payload);
  let newToken = null;
  if (!validToken(token)) { newToken = crypto.randomBytes(16).toString('hex'); token = newToken; }
  const th = sha(token), items = await makePlan(th, clean);
  const id = crypto.randomBytes(12).toString('hex');
  pending.set(id, { th, clean, exp: Date.now() + 10 * 60000, header });
  const warnings = [];
  if (signature === 'unchecked') warnings.push('This file was signed by another server, and this server has no SAVE_SIGNING_KEY, so its contents cannot be checked against forgery. Only import files you made yourself.');
  if (signature === 'none' && !signingOn()) warnings.push('This server does not use file signatures, so edited files cannot be told apart from real ones. Only import files you made yourself.');
  return { importId: id, token: newToken, format: version, created: header.created, gameVersion: header.gameVersion || '', items, notes: clean.notes, issues: clean.issues.slice(0, 20), warnings, client: clean.client, signature,
    summary: { worlds: clean.worlds.length, changedBlocks: header.counts ? header.counts.changedBlocks : 0, savedChunks: clean.vault ? clean.vault.chunks.filter(Boolean).length : 0, saveCode: !!clean.vault } };
}
export async function commitImport({ token, importId, replace }) {
  const pend = pending.get(String(importId));
  if (!pend || pend.exp < Date.now()) throw new SaveError('This import expired. Choose the file again.');
  if (!validToken(token) || sha(token) !== pend.th) throw new SaveError('This import belongs to a different browser. Choose the file again.');
  pending.delete(importId);
  const th = pend.th, clean = pend.clean, thOld = clean.account.th, rep = new Set(Array.isArray(replace) ? replace.filter((s) => typeof s === 'string') : []);
  const items = await makePlan(th, clean); // re-checked now: the server may have changed since the preview
  const todo = [], skipped = [];
  for (const it of items) {
    if (it.status === 'new' || it.status === 'copy') todo.push(it);
    else if (it.status === 'conflict' && rep.has(it.key)) todo.push(it);
    else skipped.push({ name: it.name, reason: it.status === 'conflict' ? 'You chose to keep the version already on this server.' : it.detail });
  }
  const idMap = new Map(), byKey = new Map(items.map((i) => [i.key, i]));
  for (const it of todo) if (it.kind === 'world' && it.status === 'copy') { let nid = ''; for (let i = 0; i < 20 && !nid; i++) { const c = H.newWorldId(); if (!H.rooms.has(c) && !(await store.load(c))) nid = c; } if (!nid) throw new SaveError('Could not find a free world code. Try again.'); idMap.set(it.id, nid); }
  // backup of everything that is about to be replaced, in the same file format, so it can be imported again
  const bw = [], bv = { v: null }, br = [];
  for (const it of todo) if (it.status === 'conflict') {
    if (it.kind === 'world') { const ex = await existingWorld(it.id); if (ex.data) bw.push({ id: it.id, data: ex.data }); }
    else if (it.kind === 'vault') bv.v = await vault.get(clean.vault.vid);
    else if (it.kind === 'record') { const ex = await existingWorld(it.id); if (ex.data && ex.data.players[th]) br.push({ worldId: it.id, name: ex.data.name || it.id, record: ex.data.players[th] }); }
  }
  let backupId = null, backupInfo = null;
  if (bw.length || bv.v || br.length) {
    const bbuf = await buildFile({ account: { th, created: Date.now() }, client: {}, vault: bv.v ? JSON.parse(JSON.stringify(bv.v)) : null, notes: ['Automatic backup made before an import replaced this data.'], records: br, worlds: bw }, { gameVersion: GAME_VERSION, backup: true });
    backupId = crypto.randomBytes(12).toString('hex'); backups.set(backupId, { th, buf: bbuf, exp: Date.now() + 3600000 });
    const name = `backup-before-import-${new Date().toISOString().replace(/[:.]/g, '-')}-${backupId.slice(0, 6)}.vrworld`;
    try { await fs.promises.mkdir(path.join(DATA_DIR, 'backups'), { recursive: true }); await fs.promises.writeFile(path.join(DATA_DIR, 'backups', name), bbuf); backupInfo = { file: name, savedOnServer: true }; }
    catch (e) { backupInfo = { file: name, savedOnServer: false }; log('backup could not be written to disk', e.message); }
  }
  const undo = [], restored = [], written = [];
  try {
    for (const it of todo.filter((i) => i.kind === 'world')) {
      const w = clean.worlds.find((x) => x.id === it.id), nid = idMap.get(it.id) || it.id, prior = it.status === 'conflict' ? (await existingWorld(nid)).data : null;
      const d = JSON.parse(JSON.stringify(w.data)); d.owner = th;
      if (thOld !== th && d.players[thOld] && !d.players[th]) { d.players[th] = d.players[thOld]; delete d.players[thOld]; }
      d.banned = d.banned.filter((b) => b !== th);
      if (idMap.has(it.id)) d.name = `${d.name} (restored)`.slice(0, 24);
      const room = H.rooms.get(nid); if (room) { if (room.players.size) throw new SaveError(`Players joined "${d.name}" during the import, so it was not replaced.`); clearTimeout(room.timer); clearTimeout(room.idle); H.rooms.delete(nid); }
      await store.save(nid, d); noteWorld(nid, d); H.setLiveFor(nid, d);
      undo.push(async () => { if (prior) { await store.save(nid, prior); noteWorld(nid, prior); } else { await store.deleteWorld(nid); if (idx) idx.delete(nid); } });
      written.push({ kind: 'world', id: nid, text: JSON.stringify(d), name: d.name }); restored.push(`World "${d.name}" (world code ${nid}${idMap.has(it.id) ? ', a new code because the old one belongs to someone else here' : ''}): ${d.edits.length / 4} changed blocks, ${Object.keys(d.containers).length} chests and furnaces`);
    }
    const vi = todo.find((i) => i.kind === 'vault');
    if (vi) {
      const rec = JSON.parse(JSON.stringify(clean.vault));
      for (const s of rec.chunks) if (s && idMap.has(s.wid)) { s.wid = idMap.get(s.wid); }
      const prev = await vault.install(rec);
      undo.push(async () => { if (prev) await vault.install(prev); else await vault.remove(rec.vid, rec.codeHash); });
      written.push({ kind: 'vault', text: JSON.stringify(rec) }); restored.push(`Save code: inventory, equipment and ${rec.chunks.filter(Boolean).length} saved chunk(s)`);
    }
    for (const it of todo.filter((i) => i.kind === 'record')) {
      const r = clean.records.find((x) => x.worldId === it.id), room = await H.getRoom(it.id, it.id === 'PUBLIC' ? H.makePublic : null);
      if (!room) throw new SaveError(`World ${it.id} could not be opened.`);
      if (H.touchRoom) H.touchRoom(room);
      const prevRec = room.saved[th]; room.saved[th] = JSON.parse(JSON.stringify(r.record)); await store.save(room.id, H.serialize(room)); noteWorld(room.id, H.serialize(room));
      undo.push(async () => { if (prevRec) room.saved[th] = prevRec; else delete room.saved[th]; await store.save(room.id, H.serialize(room)); });
      written.push({ kind: 'record', id: room.id, text: JSON.stringify(r.record) }); restored.push(`Your progress in ${r.name}`);
    }
    for (const w of written) { // read everything back from storage and compare
      let got;
      if (w.kind === 'world') got = JSON.stringify(await store.load(w.id));
      else if (w.kind === 'vault') got = JSON.stringify(await store.getJSON('save-' + clean.vault.vid));
      else { const d = await store.load(w.id); got = JSON.stringify(d && d.players && d.players[th]); }
      if (got !== w.text) throw new SaveError('Verification failed: what was written does not match the file.');
    }
  } catch (e) {
    for (const u of undo.reverse()) { try { await u(); } catch (err) { log('rollback step failed', err.message); } }
    log('import failed and was rolled back:', e.message);
    throw new SaveError(`${e.user ? e.message : 'Something went wrong while restoring.'} Everything was put back exactly as it was before the import; nothing was changed.`);
  }
  for (const w of written) if (w.kind === 'world') H.setLiveFor(w.id, JSON.parse(w.text));
  log(`import ok for ${th.slice(0, 6)}: ${restored.length} restored, ${skipped.length} skipped`);
  return { restored, skipped, notes: clean.notes, issues: clean.issues.slice(0, 20), backup: backupId ? { id: backupId, ...backupInfo } : null, client: clean.client, ids: Object.fromEntries(idMap) };
}
export function getBackup(token, id) {
  const b = backups.get(String(id));
  if (!b || !validToken(token) || sha(token) !== b.th) throw new SaveError('That backup is no longer available from the server memory. If the server saved it to disk it is in the data folder, in the backups folder.');
  return b.buf;
}
