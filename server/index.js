// Voxel Realms Online: authoritative multiplayer game server (Node.js + ws).
// Netlify serves the website; this process holds the live worlds, so it needs an always-on Node host.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { CH, findSpawn } from '../public/shared/world.js';
import { send, broadcast, sys } from './net.js';
import { store, DATA_DIR } from './store.js';
import { isHost, ck } from './claims.js';
import * as saves from './saves.js';
import { loadLive, setLive, listLive } from './live.js';
import * as gamesave from './gamesave.js';
import { SaveError, MAX_FILE } from './vrworld.js';
import { resetBudget, ecAdd } from './world.js';
import { tickWater } from './water.js';
import { packCont, loadCont } from './inventory.js';
import { initPlayer, savePlayer, sendState, sendStats, tickPlayer, tickSleep, handle, onMoved, equipOf, cheat, settleWindow } from './survival.js';
import { tickEnts, entsFor, spawnItem } from './ents.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const env = process.env;
const PORT = +env.PORT || 3000;
const MAX_PLAYERS = +env.MAX_PLAYERS || 16;
const MAX_EDITS = +env.MAX_EDITS || 200000;
const MAX_CONN_PER_IP = +env.MAX_CONN_PER_IP || 8;
const DAY_MS = (+env.DAY_MINUTES || 12) * 60000;
const ORIGINS = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const PALETTE = [0xe05a47, 0x3fa7d6, 0xf2b134, 0x7bc950, 0xb56ae0, 0xf2799f, 0x2ec4b6, 0xff9f1c];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const log = (...a) => console.log(new Date().toISOString(), ...a);
const rd = (v) => Math.round(v * 100) / 100;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const cleanName = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Builder' + crypto.randomInt(100, 1000);
const cleanRoomName = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 24);
function seedFrom(s) {
  s = String(s ?? '').trim();
  if (!s) return crypto.randomInt(1, 2 ** 31);
  if (/^-?\d{1,9}$/.test(s)) return parseInt(s, 10);
  let h = 2166136261;
  for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h | 0;
}

/* ---------- rooms ---------- */
const rooms = new Map(), loading = new Map();
function hydrate(id, d) {
  const r = {
    id, name: d.name || id, seed: d.seed | 0, owner: d.owner || null, created: d.created || Date.now(), banned: new Set(d.banned || []),
    mode: d.mode === 'creative' ? 'creative' : 'survival', pvp: d.pvp !== false, cheats: !!d.cheats, dayMs: DAY_MS, max: MAX_PLAYERS,
    ownerVid: d.ownerVid || null, hostName: d.hostName || '', live: !!d.live, perm: { build: !(d.perm && d.perm.build === false), containers: !(d.perm && d.perm.containers === false) },
    claims: new Map(), ec: new Map(), locked: false,
    saved: d.players || {}, edits: new Map(), containers: new Map(), players: new Map(), mobs: new Map(), items: new Map(), arrows: new Map(), entId: 0, nextId: 1,
    dirty: false, saving: false, again: false, timer: null, idle: null, fails: 0, wq: new Set(),
  };
  if (id === 'PUBLIC') { r.mode = 'survival'; r.cheats = false; r.locked = true; r.owner = null; r.ownerVid = null; r.live = false; } // the main public server is always survival, whatever is stored
  r.cheated = !!d.cheated || r.mode === 'creative' || r.cheats; // once creative or cheats have touched a world, save codes stay off in it
  const e = d.edits || [];
  for (let i = 0; i + 3 < e.length; i += 4) { r.edits.set(`${e[i]},${e[i + 1]},${e[i + 2]}`, e[i + 3]); ecAdd(r, e[i], e[i + 2], 1); }
  for (const c of d.claims || []) if (c && Number.isInteger(c.cx) && Number.isInteger(c.cz) && typeof c.vid === 'string') r.claims.set(ck(c.cx, c.cz), { cx: c.cx, cz: c.cz, vid: c.vid, slot: c.slot | 0, name: String(c.name || 'Chunk'), owner: String(c.owner || 'Someone'), at: c.at || 0, sx: c.sx | 0, sy: c.sy | 0, sz: c.sz | 0, dirty: false, snapAt: 0 });
  if (r.live) setLive(r, true);
  for (const [k, c] of Object.entries(d.containers || {})) r.containers.set(k, loadCont(c));
  r.spawn = findSpawn(r.seed);
  r.markDirty = () => markDirty(r);
  return r;
}
function serialize(r) {
  const edits = [];
  for (const [k, id] of r.edits) { const [x, y, z] = k.split(','); edits.push(+x, +y, +z, id); }
  const players = { ...r.saved };
  for (const p of r.players.values()) players[p.th] = savePlayer(p); // connected players are saved too, so a crash loses little
  const containers = {};
  for (const [k, c] of r.containers) containers[k] = packCont(c);
  return { v: 2, name: r.name, seed: r.seed, owner: r.owner, created: r.created, banned: [...r.banned], mode: r.mode, pvp: r.pvp, cheats: r.cheats, players, containers, edits,
    cheated: r.cheated, ownerVid: r.ownerVid, hostName: r.hostName, live: r.live, perm: r.perm,
    claims: [...r.claims.values()].map((c) => ({ cx: c.cx, cz: c.cz, vid: c.vid, slot: c.slot, name: c.name, owner: c.owner, at: c.at, sx: c.sx, sy: c.sy, sz: c.sz })) };
}
function getRoom(id, make) {
  if (rooms.has(id)) return Promise.resolve(rooms.get(id));
  if (loading.has(id)) return loading.get(id);
  const p = (async () => {
    const d = await store.load(id);
    let r = d ? hydrate(id, d) : null;
    if (!r && make) { r = hydrate(id, make); await store.save(id, serialize(r)); } // a new world is only announced once it is stored
    if (r) rooms.set(id, r);
    return r;
  })().finally(() => loading.delete(id));
  loading.set(id, p);
  return p;
}

// Saves are debounced, retried with backoff, and the players are told honestly when one fails.
function markDirty(r) { r.dirty = true; if (!r.timer) r.timer = setTimeout(() => flush(r), 2500); }
async function flush(r) {
  r.timer = null;
  if (r.saving) { r.again = true; return; }
  if (!r.dirty) return;
  r.saving = true; r.dirty = false;
  try { const d = serialize(r); await store.save(r.id, d); gamesave.noteWorld(r.id, d); r.fails = 0; broadcast(r, { t: 'save', ok: true }); }
  catch (e) {
    r.dirty = true; r.fails++; log('save failed', r.id, e.message); broadcast(r, { t: 'save', ok: false });
    r.timer = setTimeout(() => flush(r), Math.min(30000, 1000 * 2 ** r.fails));
  } finally { r.saving = false; if (r.again) { r.again = false; markDirty(r); } }
}

/* ---------- messaging helpers ---------- */
const bucket = (rate, burst) => ({ rate, burst, tokens: burst, t: Date.now() });
function take(b, n = 1) {
  const now = Date.now();
  b.tokens = Math.min(b.burst, b.tokens + ((now - b.t) / 1000) * b.rate); b.t = now;
  if (b.tokens < n) return false;
  b.tokens -= n; return true;
}
const fatal = (ws, m) => { send(ws, { t: 'err', m, fatal: true }); ws.close(1000); };
const pub = (p) => ({ id: p.id, name: p.name, color: p.color, x: rd(p.x), y: rd(p.y), z: rd(p.z), yaw: rd(p.yaw), pitch: rd(p.pitch), po: p.pose | 0, ...equipOf(p) });
const createRl = new Map(), worldsRl = new Map();
const mayCreate = (ip) => { let b = createRl.get(ip); if (!b) createRl.set(ip, (b = bucket(1 / 20, 3))); return take(b); };

/* ---------- join / leave ---------- */
async function onJoin(ws, m) {
  if (ws.p || ws.joining) return;
  ws.joining = true;
  try {
    const name = cleanName(m.name);
    const token = typeof m.token === 'string' && /^[a-f0-9]{32}$/.test(m.token) ? m.token : crypto.randomBytes(16).toString('hex');
    const th = sha(token);
    let room;
    if (m.create) {
      if (!mayCreate(ws.ip)) return fatal(ws, 'You are creating worlds too quickly. Wait a moment.');
      let code = null;
      for (let i = 0; i < 5 && !code; i++) { const c = newCode(); if (!rooms.has(c) && !(await store.load(c))) code = c; }
      if (!code) throw new Error('could not allocate a world code');
      room = await getRoom(code, {
        name: cleanRoomName(m.roomName) || `${name}'s world`, seed: seedFrom(m.seed), owner: th, created: Date.now(),
        mode: m.mode === 'creative' ? 'creative' : 'survival', pvp: m.pvp !== false, cheats: !!m.cheats, hostName: name,
      });
    } else {
      const id = String(m.room || 'PUBLIC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'PUBLIC';
      room = await getRoom(id, id === 'PUBLIC' ? { name: 'Public world', seed: 41, owner: null, created: Date.now(), mode: 'survival', pvp: true, cheats: false } : null);
    }
    if (!room) return fatal(ws, 'World not found. Check the code and try again.');
    if (room.banned.has(th)) return fatal(ws, 'You are banned from this world.');
    const dup = [...room.players.values()].find((q) => q.th === th);
    if (dup) { send(dup.ws, { t: 'err', m: 'You joined this world from another tab.', fatal: true }); dup.ws.close(1000); dropPlayer(dup); }
    if (room.players.size >= MAX_PLAYERS) return fatal(ws, 'This world is full.');
    const taken = (n) => [...room.players.values()].some((q) => q.name.toLowerCase() === n.toLowerCase());
    let nm = name, n = 2;
    while (taken(nm)) nm = `${name.slice(0, 13)}${n++}`;
    const s = room.saved[th], ok = s && [s.x, s.y, s.z].every(Number.isFinite) && s.y > -10 && s.y < CH + 100, at = ok ? s : room.spawn;
    const p = {
      id: room.nextId++, ws, room, th, name: nm, x: at.x, y: at.y, z: at.z, yaw: ok ? +s.yaw || 0 : 0, pitch: ok ? +s.pitch || 0 : 0,
      lastT: Date.now(), bh: 30, bu: 30, bd: 120, moved: false, left: false, hadEnts: false,
    };
    p.color = PALETTE[p.id % PALETTE.length]; p.vid = null; p.vlast = '';
    initPlayer(p, room, ok ? s : null);
    let note = '';
    if (m.code) { // a save code: validated by the server only, and it replaces nothing without being checked
      const res = await saves.redeem(room, p, m.code, ws.ip);
      note = res.msg || '';
      if (ws.readyState !== 1) { saves.afterLeave(p); return; }
    }
    if (m.create && p.vid) { room.ownerVid = p.vid; room.markDirty(); }
    if (isHost(room, p) && room.hostName !== p.name) { room.hostName = p.name; room.markDirty(); }
    if (room.idle) { clearTimeout(room.idle); room.idle = null; }
    room.players.set(p.id, p); ws.p = p;
    const edits = [];
    for (const [k, id] of room.edits) { const [x, y, z] = k.split(','); edits.push(+x, +y, +z, id); }
    send(ws, {
      t: 'welcome', pid: p.id, token, now: Date.now(), epoch: room.created, dayMs: DAY_MS,
      room: saves.roomPub(room, p), vault: saves.info(room, p), claims: saves.claimsFor(room, p), note,
      me: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch },
      players: [...room.players.values()].filter((q) => q !== p && !q.dead).map(pub), edits,
    });
    sendState(p); sendStats(p);
    broadcast(room, { t: 'pj', p: pub(p) }, ws);
    sys(room, `${p.name} joined`);
  } catch (e) {
    log('join failed', e.message);
    fatal(ws, 'The game server could not load this world. Try again in a moment.');
  } finally { ws.joining = false; }
}
function dropPlayer(p) {
  if (p.left) return;
  p.left = true;
  const r = p.room;
  r.players.delete(p.id);
  if (!p.dead) settleWindow(r, p); // items on the cursor or in the crafting grid go back to the backpack instead of being lost
  saves.beforeLeave(r, p);
  r.saved[p.th] = savePlayer(p);
  saves.afterLeave(p);
  const ks = Object.keys(r.saved); if (ks.length > 500) delete r.saved[ks[0]];
  markDirty(r);
  broadcast(r, { t: 'pl', id: p.id }); sys(r, `${p.name} left`);
  if (!r.players.size) { flush(r); scheduleIdle(r); }
}
function scheduleIdle(r) { // free memory after a quiet minute, but never while a save is pending
  if (r.players.size || r.idle) return;
  r.idle = setTimeout(function check() {
    r.idle = null;
    if (r.players.size) return;
    if (r.dirty || r.saving) { r.idle = setTimeout(check, 10000); return; }
    rooms.delete(r.id);
  }, 60000);
}
saves.init({ getRoom, dropPlayer, touchRoom: scheduleIdle });
const PUBLIC_MAKE = { name: 'Public world', seed: 41, owner: null, created: Date.now(), mode: 'survival', pvp: true, cheats: false };
gamesave.init({
  rooms, serialize, getRoom, makePublic: PUBLIC_MAKE, touchRoom: scheduleIdle, newWorldId: newCode, checkin: saves.checkin,
  refresh: (rs, vid) => saves.refreshClaims(rs, vid),
  ownerOnline: (th) => [...rooms.values()].some((r) => [...r.players.values()].some((p) => p.th === th)),
  setLiveFor: (id, d) => { if (d.live) setLive({ id, name: d.name, hostName: d.hostName, mode: d.mode, pvp: d.pvp, created: d.created }, true); else setLive({ id }, false); },
});

/* ---------- chat commands ---------- */
function command(p, line) {
  const [cmd, ...rest] = line.slice(1).trim().split(/\s+/), arg = rest.join(' ').toLowerCase(), room = p.room;
  const say = (m) => send(p.ws, { t: 'chat', m, sys: 1 });
  const owner = isHost(room, p), c = (cmd || '').toLowerCase();
  const hc = ['mode', 'pvp', 'cheats', 'live', 'build', 'chests', 'rename', 'unclaim'].includes(c) ? saves.hostCommand(room, p, c, rest) : null;
  if (hc !== null) return say(hc);
  switch (c) {
    case 'help': return say(owner && !room.locked ? `Commands: /who, /kick name, /ban name, /mode survival|creative, /pvp on|off, /cheats on|off, /live on|off, /build on|off, /chests on|off, /rename name, /unclaim${room.cheats ? ', /give item [n], /spawn mob, /heal' : ''}` : 'Commands: /who');
    case 'who': return say('Online: ' + [...room.players.values()].map((q) => q.name).join(', '));
    case 'kick': case 'ban': {
      if (!owner) return say('Only the world owner can do that.');
      const t = [...room.players.values()].find((q) => q.name.toLowerCase() === arg);
      if (!t || t === p) return say('No other player with that name.');
      const ban = c === 'ban';
      if (ban) { room.banned.add(t.th); markDirty(room); }
      send(t.ws, { t: 'err', m: ban ? 'You were banned from this world.' : 'You were kicked from this world.', fatal: true });
      t.ws.close(1000); dropPlayer(t);
      return sys(room, `${t.name} was ${ban ? 'banned' : 'kicked'}`);
    }
    default: {
      if (!owner || !room.cheats) return say('Unknown command. Try /help');
      const res = cheat(room, p, c, rest);
      return say(res || 'Unknown command. Try /help');
    }
  }
}

/* ---------- message handling ---------- */
async function onMessage(ws, raw) {
  if (!take(ws.rl.all)) return;
  let m; try { m = JSON.parse(raw); } catch { return ws.close(1008, 'bad json'); }
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'join') return onJoin(ws, m);
  const p = ws.p;
  if (!p || p.left) return;
  switch (m.t) {
    case 'pos': {
      if (p.dead || p.sleep) return;
      const { x, y, z, yaw, pitch } = m;
      if (![x, y, z, yaw, pitch].every((v) => typeof v === 'number' && Number.isFinite(v))) return;
      // Movement budget: the player may move about as fast as the game allows, no faster, however often they send.
      const now = Date.now(), el = Math.min(3, (now - p.lastT) / 1000); p.lastT = now;
      p.bh = Math.min(30, p.bh + 16 * el); p.bu = Math.min(30, p.bu + 16 * el); p.bd = Math.min(120, p.bd + 70 * el);
      const hd = Math.hypot(x - p.x, z - p.z), dy = y - p.y;
      if (hd > p.bh || dy > p.bu || -dy > p.bd || Math.abs(x) > 1e6 || Math.abs(z) > 1e6 || y < -50 || y > CH + 300) return send(ws, { t: 'fix', x: p.x, y: p.y, z: p.z });
      p.bh -= hd; if (dy > 0) p.bu -= dy; else p.bd += dy;
      p.x = x; p.y = y; p.z = z; p.yaw = yaw % 6.2832; p.pitch = Math.max(-1.6, Math.min(1.6, pitch)); p.moved = true;
      onMoved(p, hd, m.sp, m.po);
      break;
    }
    case 'chat': {
      if (!take(ws.rl.chat)) return send(ws, { t: 'chat', m: 'You are sending messages too fast.', sys: 1 });
      const s = String(m.m ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
      if (!s) return;
      if (s[0] === '/') return command(p, s);
      broadcast(p.room, { t: 'chat', from: p.name, m: s, ts: Date.now() });
      break;
    }
    case 'vnew': case 'vcode': case 'vrot': case 'vsave': case 'crest': case 'crel': case 'wset': case 'vinfo': {
      if (!take(ws.rl.act)) return;
      const room = p.room;
      if (m.t === 'vnew') return saves.createFor(room, p);
      if (m.t === 'vrot') return saves.rotateFor(room, p);
      if (m.t === 'vsave') { if (Date.now() - (p.vsaveAt || 0) < 2000) return; p.vsaveAt = Date.now(); return saves.saveNow(room, p); }
      if (m.t === 'crest') return saves.restore(room, p, { slot: m.slot, at: m.at });
      if (m.t === 'crel') return saves.release(room, p, { slot: m.slot });
      if (m.t === 'vinfo') { saves.sendInfo(room, p); return saves.sendClaims(room, p); }
      if (m.t === 'vcode') {
        const res = await saves.redeem(room, p, String(m.code ?? '').slice(0, 40), ws.ip);
        send(ws, { t: 'chat', m: res.msg, sys: 1 }); if (res.ok) { saves.sendInfo(room, p); saves.sendClaims(room, p); send(ws, { t: 'vok' }); }
        return;
      }
      const res = saves.applySettings(room, p, m);
      return send(ws, { t: 'chat', m: res.msg, sys: 1 });
    }
    default:
      if (!take(ws.rl.act)) return;
      handle(p.room, p, m);
  }
}

/* ---------- HTTP (health, config, static files for local play) + WebSocket upgrade ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };
/* ---------- Game Saves: one .vrworld file for a whole game (see gamesave.js) ---------- */
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-vr-token', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-expose-headers': 'content-disposition, content-length, x-vr-notes', 'cache-control': 'no-store' };
const gsBusy = new Set(), gsRl = new Map(), SAVE_PER_MIN = +env.SAVE_RATE_PER_MIN || 6; // export/import requests allowed per minute and address
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new SaveError(`That file is larger than this server accepts (${Math.round(limit / 1048576)} MB).`)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', () => reject(new SaveError('The upload was interrupted. Try again.')));
  });
}
async function gameSaveRoute(req, res, u, ip) {
  const send = (code, body, type = 'application/json', extra = {}) => { res.writeHead(code, { ...CORS, 'content-type': type, ...extra }); res.end(body); };
  const fail = (e) => { if (!(e instanceof SaveError)) log('game save error', e.stack || e.message); send(e instanceof SaveError ? 400 : 500, JSON.stringify({ error: e instanceof SaveError ? e.message : 'The server hit an unexpected problem. Nothing was changed. Try again, and check the server log.' })); };
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== 'POST') return send(405, JSON.stringify({ error: 'POST only' }));
  let b = gsRl.get(ip); if (!b) gsRl.set(ip, (b = bucket(SAVE_PER_MIN / 60, Math.max(6, SAVE_PER_MIN))));
  if (!take(b)) return send(429, JSON.stringify({ error: 'Too many requests. Wait a minute and try again.' }));
  if (gsBusy.has(ip)) return send(429, JSON.stringify({ error: 'Another save or import from your connection is still running.' }));
  gsBusy.add(ip);
  try {
    if (u.pathname === '/api/import/preview') {
      const buf = await readBody(req, MAX_FILE + 1024), tok = String(req.headers['x-vr-token'] || '');
      return send(200, JSON.stringify(await gamesave.previewImport({ token: tok, buf })));
    }
    const body = JSON.parse((await readBody(req, 65536)).toString('utf8') || '{}');
    if (u.pathname === '/api/export') {
      const r = await gamesave.exportGame({ token: body.token, code: typeof body.code === 'string' ? body.code.slice(0, 40) : '', client: body.client && typeof body.client === 'object' ? body.client : {} });
      const name = `voxel-realms-${new Date().toISOString().slice(0, 10)}.vrworld`;
      return send(200, r.buf, 'application/octet-stream', { 'content-disposition': `attachment; filename="${name}"`, 'content-length': r.buf.length, 'x-vr-notes': Buffer.from(JSON.stringify({ counts: r.counts, notes: r.notes })).toString('base64') });
    }
    if (u.pathname === '/api/import/commit') return send(200, JSON.stringify(await gamesave.commitImport({ token: body.token, importId: body.importId, replace: body.replace })));
    if (u.pathname === '/api/backup') { const buf = gamesave.getBackup(body.token, body.id); return send(200, buf, 'application/octet-stream', { 'content-disposition': 'attachment; filename="voxel-realms-backup.vrworld"', 'content-length': buf.length }); }
    return send(404, JSON.stringify({ error: 'Not found' }));
  } catch (e) { if (e instanceof SyntaxError) return fail(new SaveError('The request was not understood.')); return fail(e); }
  finally { gsBusy.delete(ip); }
}
const server = http.createServer((req, res) => {
  let u; try { u = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/health') return json({ ok: true, game: 'voxel-realms', rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0), storage: store.kind });
  if (u.pathname === '/api/worlds') { // the Active Worlds list: only worlds whose hosts switched "live" on
    const ip = ipOf(req); let b = worldsRl.get(ip); if (!b) worldsRl.set(ip, (b = bucket(0.5, 10)));
    if (!take(b)) { res.writeHead(429); return res.end(); }
    return json({ worlds: listLive(rooms, MAX_PLAYERS, isHost) });
  }
  if (u.pathname.startsWith('/api/export') || u.pathname.startsWith('/api/import') || u.pathname === '/api/backup') return gameSaveRoute(req, res, u, ipOf(req));
  if (u.pathname === '/api/config') return json({ server: '' }); // same origin when the site is served from this process
  let rel; try { rel = decodeURIComponent(u.pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUB, path.normalize(rel));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
const perIp = new Map();
const ipOf = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
server.on('upgrade', (req, socket, head) => {
  const refuse = (code, msg) => { socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
  let u; try { u = new URL(req.url, 'http://x'); } catch { return refuse(400, 'Bad Request'); }
  if (u.pathname !== '/ws') return refuse(404, 'Not Found');
  if (ORIGINS.length && !ORIGINS.includes((req.headers.origin || '').replace(/\/+$/, ''))) return refuse(403, 'Forbidden');
  const ip = ipOf(req);
  if ((perIp.get(ip) || 0) >= MAX_CONN_PER_IP) return refuse(429, 'Too Many Requests');
  wss.handleUpgrade(req, socket, head, (ws) => { ws.ip = ip; perIp.set(ip, (perIp.get(ip) || 0) + 1); wss.emit('connection', ws, req); });
});
wss.on('connection', (ws) => {
  ws.alive = true;
  ws.rl = { all: bucket(120, 240), act: bucket(40, 80), chat: bucket(1.2, 4) };
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw, isBinary) => { if (isBinary) return ws.close(1003); onMessage(ws, raw).catch((e) => log('handler error', e.stack || e.message)); });
  ws.on('close', () => { perIp.set(ws.ip, Math.max(0, (perIp.get(ws.ip) || 1) - 1)); if (ws.p) dropPlayer(ws.p); });
  ws.on('error', () => {});
  setTimeout(() => { if (!ws.p && ws.readyState === 1) ws.close(1008, 'join timeout'); }, 15000);
});

// The game loop: 20 ticks a second for players, creatures, items and arrows; positions and entities go out every other tick.
let tickN = 0;
setInterval(() => {
  try {
    tickN++; resetBudget(3);
    for (const r of rooms.values()) {
      if (!r.players.size) continue;
      tickWater(r, tickN); tickSleep(r); tickEnts(r, 0.05); saves.tick(r, tickN);
      for (const p of r.players.values()) tickPlayer(r, p, 0.05);
      if (tickN % 2) continue;
      const s = [];
      for (const p of r.players.values()) if (p.moved && !p.dead) { p.moved = false; s.push([p.id, rd(p.x), rd(p.y), rd(p.z), rd(p.yaw), rd(p.pitch), p.pose | 0]); }
      if (s.length) broadcast(r, { t: 'ps', s });
      for (const p of r.players.values()) {
        const msg = entsFor(r, p), any = msg.m.length + msg.i.length + msg.a.length > 0;
        if (any || p.hadEnts) { send(p.ws, msg); p.hadEnts = any; }
      }
    }
  } catch (e) { log('tick error', e.stack || e.message); }
}, 50);
setInterval(() => { // drop dead sockets
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
  if (createRl.size > 5000) createRl.clear();
  if (worldsRl.size > 5000) worldsRl.clear();
}, 25000);

async function shutdown() {
  log('shutting down, saving worlds');
  for (const r of rooms.values()) {
    clearTimeout(r.timer);
    try { await store.save(r.id, serialize(r)); } catch (e) { log('final save failed', r.id, e.message); }
  }
  try { await saves.shutdown(rooms.values()); } catch (e) { log('final vault save failed', e.message); }
  process.exit(0);
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => log('unhandled rejection', e && e.message));

await loadLive();
server.listen(PORT, () => log(`Voxel Realms server on :${PORT} (storage: ${store.kind}, origins: ${ORIGINS.length ? ORIGINS.join(' ') : 'any'})`));
