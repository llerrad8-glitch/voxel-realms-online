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
import { resetBudget } from './world.js';
import { tickWater } from './water.js';
import { packCont, loadCont } from './inventory.js';
import { initPlayer, savePlayer, sendState, sendStats, tickPlayer, handle, onMoved, equipOf, cheat } from './survival.js';
import { tickEnts, entsFor } from './ents.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const env = process.env;
const PORT = +env.PORT || 3000;
const DATA_DIR = env.DATA_DIR || path.join(ROOT, 'data');
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

/* ---------- storage: local disk by default, Upstash Redis (REST) when configured ---------- */
const UP_URL = env.UPSTASH_REDIS_REST_URL, UP_TOKEN = env.UPSTASH_REDIS_REST_TOKEN;
async function upstash(cmd) {
  const r = await fetch(UP_URL, { method: 'POST', headers: { Authorization: `Bearer ${UP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `Upstash HTTP ${r.status}`);
  return j.result;
}
const fileFor = (id) => path.join(DATA_DIR, `${id.replace(/[^A-Z0-9]/g, '')}.json`);
const store = UP_URL && UP_TOKEN
  ? {
    kind: 'upstash-redis',
    load: async (id) => { const v = await upstash(['GET', `vr:world:${id}`]); return v ? JSON.parse(v) : null; },
    save: (id, d) => upstash(['SET', `vr:world:${id}`, JSON.stringify(d)]),
  }
  : {
    kind: 'disk',
    load: async (id) => { try { return JSON.parse(await fs.promises.readFile(fileFor(id), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    save: async (id, d) => {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      const f = fileFor(id), tmp = `${f}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(d));
      await fs.promises.rename(tmp, f); // atomic: a crash never leaves a half-written world
    },
  };

/* ---------- rooms ---------- */
const rooms = new Map(), loading = new Map();
function hydrate(id, d) {
  const r = {
    id, name: d.name || id, seed: d.seed | 0, owner: d.owner || null, created: d.created || Date.now(), banned: new Set(d.banned || []),
    mode: d.mode === 'creative' ? 'creative' : 'survival', pvp: d.pvp !== false, cheats: !!d.cheats, dayMs: DAY_MS,
    saved: d.players || {}, edits: new Map(), containers: new Map(), players: new Map(), mobs: new Map(), items: new Map(), arrows: new Map(), entId: 0, nextId: 1,
    dirty: false, saving: false, again: false, timer: null, idle: null, fails: 0, wq: new Set(),
  };
  const e = d.edits || [];
  for (let i = 0; i + 3 < e.length; i += 4) r.edits.set(`${e[i]},${e[i + 1]},${e[i + 2]}`, e[i + 3]);
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
  return { v: 2, name: r.name, seed: r.seed, owner: r.owner, created: r.created, banned: [...r.banned], mode: r.mode, pvp: r.pvp, cheats: r.cheats, players, containers, edits };
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
  try { await store.save(r.id, serialize(r)); r.fails = 0; broadcast(r, { t: 'save', ok: true }); }
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
const createRl = new Map();
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
        mode: m.mode === 'creative' ? 'creative' : 'survival', pvp: m.pvp !== false, cheats: !!m.cheats,
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
    p.color = PALETTE[p.id % PALETTE.length];
    initPlayer(p, room, ok ? s : null);
    if (room.idle) { clearTimeout(room.idle); room.idle = null; }
    room.players.set(p.id, p); ws.p = p;
    const edits = [];
    for (const [k, id] of room.edits) { const [x, y, z] = k.split(','); edits.push(+x, +y, +z, id); }
    send(ws, {
      t: 'welcome', pid: p.id, token, now: Date.now(), epoch: room.created, dayMs: DAY_MS,
      room: { id: room.id, name: room.name, seed: room.seed, owner: room.owner === th, max: MAX_PLAYERS, mode: room.mode, pvp: room.pvp, cheats: room.cheats },
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
  r.saved[p.th] = savePlayer(p);
  const ks = Object.keys(r.saved); if (ks.length > 500) delete r.saved[ks[0]];
  markDirty(r);
  broadcast(r, { t: 'pl', id: p.id }); sys(r, `${p.name} left`);
  if (!r.players.size) {
    flush(r);
    r.idle = setTimeout(function check() { // free memory after a quiet minute, but never while a save is pending
      if (r.players.size) return;
      if (r.dirty || r.saving) { r.idle = setTimeout(check, 10000); return; }
      rooms.delete(r.id);
    }, 60000);
  }
}

/* ---------- chat commands ---------- */
function command(p, line) {
  const [cmd, ...rest] = line.slice(1).trim().split(/\s+/), arg = rest.join(' ').toLowerCase(), room = p.room;
  const say = (m) => send(p.ws, { t: 'chat', m, sys: 1 });
  const owner = room.owner && room.owner === p.th, c = (cmd || '').toLowerCase();
  switch (c) {
    case 'help': return say(owner ? `Commands: /who, /kick name, /ban name${room.cheats ? ', /give item [n], /spawn mob, /heal' : ''}` : 'Commands: /who');
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
      if (p.dead) return;
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
    default:
      if (!take(ws.rl.act)) return;
      handle(p.room, p, m);
  }
}

/* ---------- HTTP (health, config, static files for local play) + WebSocket upgrade ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let u; try { u = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/health') return json({ ok: true, game: 'voxel-realms', rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0), storage: store.kind });
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
      tickWater(r, tickN); tickEnts(r, 0.05);
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
}, 25000);

async function shutdown() {
  log('shutting down, saving worlds');
  for (const r of rooms.values()) {
    clearTimeout(r.timer);
    try { await store.save(r.id, serialize(r)); } catch (e) { log('final save failed', r.id, e.message); }
  }
  process.exit(0);
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => log('unhandled rejection', e && e.message));

server.listen(PORT, () => log(`Voxel Realms server on :${PORT} (storage: ${store.kind}, origins: ${ORIGINS.length ? ORIGINS.join(' ') : 'any'})`));
