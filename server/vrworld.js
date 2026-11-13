// The .vrworld file: one file that holds a player's whole game, and everything needed to read it back safely.
//
//   bytes 0-7    magic "VRWORLD\0"
//   bytes 8-9    format version (uint16, big endian)
//   bytes 10-13  header length (uint32)
//   header       UTF-8 JSON, readable without decompressing: what is inside, sizes, a SHA-256 of the data
//   data         the whole game as JSON, compressed with gzip
//   last 32      SHA-256 of every byte before it (detects any corruption, truncation or edit)
//   +32 optional HMAC-SHA256 of the same bytes, only if the server has SAVE_SIGNING_KEY set (detects deliberate forgery)
//
// Reading a file never runs anything from it: it is parsed as JSON, then every field is checked and copied into a fresh object.
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { CS, CH, BLOCKS } from '../public/shared/world.js';
import { unpack, loadCont, packCont, pack } from './inventory.js';
import { decode } from './claims.js';

const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
export const MAGIC = Buffer.from('VRWORLD\0', 'latin1');
export const FORMAT_VERSION = 1;
export const SUPPORTED = [1]; // older versions listed here are converted by MIGRATE below
export const MAX_FILE = (+process.env.SAVE_MAX_MB || 100) * 1024 * 1024; // compressed size
export const MAX_RAW = Math.max(MAX_FILE * 4, 64 * 1024 * 1024); // size after decompression: stops "zip bombs"
export const MAX_WORLDS = 60, MAX_EDITS = 1000000, MAX_CONTAINERS = 50000, MAX_PLAYERS = 20000;
const SIGN_KEY = process.env.SAVE_SIGNING_KEY || '';
export const signingOn = () => !!SIGN_KEY;

export class SaveError extends Error { constructor(msg) { super(msg); this.user = true; } }
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const hmac = (b) => crypto.createHmac('sha256', SIGN_KEY).update(b).digest();
const yieldLoop = () => new Promise((r) => setImmediate(r));

// Future format changes: add `2: (payload) => ...` here that turns a version 1 payload into version 2, and raise FORMAT_VERSION.
const MIGRATE = {};

/* ---------- writing ---------- */
export async function buildFile(payload, extraHeader = {}) {
  // JSON in pieces, with a breath between worlds, so a big export never freezes the game for everyone else
  const parts = [`{"account":${JSON.stringify(payload.account)},"client":${JSON.stringify(payload.client || {})},"vault":${JSON.stringify(payload.vault || null)},"notes":${JSON.stringify(payload.notes || [])},"records":${JSON.stringify(payload.records || [])},"worlds":[`];
  let first = true;
  for (const w of payload.worlds || []) { parts.push((first ? '' : ',') + JSON.stringify(w)); first = false; await yieldLoop(); }
  parts.push(']}');
  const raw = Buffer.from(parts.join(''), 'utf8');
  if (raw.length > MAX_RAW) throw new SaveError(`Your game is too large to export in one file (${Math.round(raw.length / 1048576)} MB of data, the limit is ${Math.round(MAX_RAW / 1048576)} MB).`);
  const packed = await gzip(raw, { level: 9 });
  const header = Buffer.from(JSON.stringify({ app: 'voxel-realms', format: FORMAT_VERSION, created: Date.now(), compression: 'gzip', rawBytes: raw.length, dataSha256: sha(raw).toString('hex'), signed: !!SIGN_KEY, ...extraHeader }), 'utf8');
  const head = Buffer.alloc(14); MAGIC.copy(head, 0); head.writeUInt16BE(FORMAT_VERSION, 8); head.writeUInt32BE(header.length, 10);
  const body = Buffer.concat([head, header, packed]);
  const tail = SIGN_KEY ? Buffer.concat([sha(body), hmac(body)]) : sha(body);
  const out = Buffer.concat([body, tail]);
  if (out.length > MAX_FILE) throw new SaveError(`Your game file would be ${Math.round(out.length / 1048576)} MB, over the ${Math.round(MAX_FILE / 1048576)} MB limit.`);
  return out;
}

/* ---------- reading: structure, integrity, decompression ---------- */
// Returns { version, header, payload (unchecked JSON), signature: 'valid' | 'invalid' | 'none' | 'unchecked' }. Throws SaveError with a plain explanation.
export async function openFile(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 14 + 2 + 32) throw new SaveError('This file is too small to be a Voxel Realms game save. It may be incomplete: download it again.');
  if (!buf.subarray(0, 8).equals(MAGIC)) throw new SaveError('This is not a Voxel Realms game save (.vrworld) file.');
  const version = buf.readUInt16BE(8), hlen = buf.readUInt32BE(10);
  if (version === 0 || version > FORMAT_VERSION) throw new SaveError(`This file uses save format ${version}, which this game version does not know. It was probably made by a newer version: update the game server and try again.`);
  if (!SUPPORTED.includes(version)) throw new SaveError(`Save format ${version} is no longer supported.`);
  if (hlen < 2 || hlen > 1048576 || 14 + hlen + 32 > buf.length) throw new SaveError('The file header is damaged. The file is corrupted or incomplete.');
  let header; try { header = JSON.parse(buf.subarray(14, 14 + hlen).toString('utf8')); } catch { throw new SaveError('The file header is damaged. The file is corrupted or incomplete.'); }
  if (!header || header.app !== 'voxel-realms' || header.format !== version || header.compression !== 'gzip') throw new SaveError('The file header is not valid for a Voxel Realms save.');
  const signed = header.signed === true, tailLen = signed ? 64 : 32;
  if (buf.length < 14 + hlen + tailLen + 1) throw new SaveError('The file is incomplete: its end is missing. Download or copy it again.');
  const body = buf.subarray(0, buf.length - tailLen), tail = buf.subarray(buf.length - tailLen);
  if (!crypto.timingSafeEqual(sha(body), tail.subarray(0, 32))) throw new SaveError('The file failed its integrity check: it is corrupted, incomplete or was changed. Nothing was imported. Try the original download or a backup copy.');
  let signature = 'none';
  if (signed) {
    if (!SIGN_KEY) signature = 'unchecked';
    else signature = crypto.timingSafeEqual(hmac(body), tail.subarray(32)) ? 'valid' : 'invalid';
  } else if (SIGN_KEY) signature = 'none';
  const packed = body.subarray(14 + hlen);
  let raw;
  try { raw = await gunzip(packed, { maxOutputLength: MAX_RAW }); } catch (e) { throw new SaveError(/maxOutputLength|Cannot create a Buffer larger/.test(e.message) ? 'The file expands to more data than this server accepts.' : 'The file data could not be decompressed: it is corrupted.'); }
  if (!crypto.timingSafeEqual(sha(raw), Buffer.from(String(header.dataSha256 || ''), 'hex'))) throw new SaveError('The file data does not match its checksum. It is corrupted.');
  let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { throw new SaveError('The file data is not valid. It is corrupted.'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new SaveError('The file data is not valid. It is corrupted.');
  for (let v = version + 1; v <= FORMAT_VERSION; v++) payload = MIGRATE[v](payload);
  return { version, header, payload, signature };
}

/* ---------- reading: every field is checked and copied; nothing from the file is trusted ---------- */
const isHex = (s, n) => typeof s === 'string' && s.length === n && /^[a-f0-9]+$/.test(s);
const num = (v, lo, hi, d = 0) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const int = (v, lo, hi, d = 0) => Math.round(num(v, lo, hi, d));
const label = (s, n, d = '') => { const t = String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, n); return t || d; };
const WORLD_ID = /^[A-Z0-9]{1,10}$/;
const BMAX = BLOCKS.length - 1;

// A stack is kept only if it is a real item; anything dropped or clamped is reported, never ignored silently.
function stack(a, issues, where) {
  const u = unpack(a);
  if (a && !u) issues.push(`${where}: an unknown item was left out`);
  else if (u && u.n !== (a[1] | 0)) issues.push(`${where}: a stack larger than allowed was reduced`);
  return pack(u);
}
function cleanPlayerRec(r, issues = [], where = 'player') {
  if (!r || typeof r !== 'object') return null;
  const o = { x: num(r.x, -3e6, 3e6), y: num(r.y, -10, CH + 100), z: num(r.z, -3e6, 3e6), yaw: num(r.yaw, -1e4, 1e4), pitch: num(r.pitch, -4, 4) };
  const sp = Array.isArray(r.sp) && r.sp.length === 3 && r.sp.every(Number.isInteger) ? r.sp.map((v) => int(v, -3e6, 3e6)) : null;
  if (r.vl) { o.sp = sp; o.vl = 1; return o; } // a player whose items live in their save code
  o.hp = num(r.hp, 1, 20, 20); o.food = num(r.food, 0, 20, 20);
  o.inv = Array.from({ length: 36 }, (_, i) => stack(Array.isArray(r.inv) ? r.inv[i] : 0, issues, where));
  o.arm = Array.from({ length: 4 }, (_, i) => stack(Array.isArray(r.arm) ? r.arm[i] : 0, issues, where));
  o.off = stack(r.off, issues, where); o.sp = sp;
  return o;
}
const CONT_KEY = /^(-?\d{1,7}),(\d{1,2}),(-?\d{1,7})$/;
function cleanContainers(src, issues, where, local) { // local: keys are chunk-relative (inside a saved chunk)
  const out = {}; let n = 0;
  for (const [k, c] of Object.entries(src && typeof src === 'object' ? src : {})) {
    const m = CONT_KEY.exec(k);
    if (!m || +m[2] >= CH || !c || typeof c !== 'object' || (n >= MAX_CONTAINERS)) { issues.push(`${where}: ignored an invalid container entry`); continue; }
    if (local && (+m[1] < 0 || +m[1] >= CS || +m[3] < 0 || +m[3] >= CS)) { issues.push(`${where}: ignored a container outside its chunk`); continue; }
    out[k] = packCont(loadCont(c)); n++;
  }
  return out;
}
export function cleanWorld(id, d, issues) {
  if (!d || typeof d !== 'object') throw new SaveError(`World ${id} is damaged.`);
  const w = {
    v: 2, name: label(d.name, 24, id), seed: int(d.seed, -2147483648, 2147483647), owner: null, created: num(d.created, 0, 4e12, Date.now()),
    banned: [], mode: d.mode === 'creative' ? 'creative' : 'survival', pvp: d.pvp !== false, cheats: !!d.cheats, cheated: !!d.cheated || d.mode === 'creative' || !!d.cheats,
    ownerVid: isHex(d.ownerVid, 32) ? d.ownerVid : null, hostName: label(d.hostName, 24), live: !!d.live,
    perm: { build: !(d.perm && d.perm.build === false), containers: !(d.perm && d.perm.containers === false) }, players: {}, containers: {}, edits: [], claims: [],
  };
  for (const t of Array.isArray(d.banned) ? d.banned.slice(0, 2000) : []) if (isHex(t, 32)) w.banned.push(t);
  let np = 0;
  for (const [t, r] of Object.entries(d.players && typeof d.players === 'object' ? d.players : {})) {
    if (!isHex(t, 32) || np >= MAX_PLAYERS) { issues.push(`${w.name}: ignored an invalid player entry`); continue; }
    const c = cleanPlayerRec(r, issues, `${w.name}, a player`); if (c) { w.players[t] = c; np++; }
  }
  w.containers = cleanContainers(d.containers, issues, w.name, false);
  const e = Array.isArray(d.edits) ? d.edits : [];
  if (e.length % 4 !== 0 || e.length > MAX_EDITS * 4) throw new SaveError(`World "${w.name}" has more changed blocks than this server accepts, or its block list is damaged.`);
  const edits = new Array(e.length);
  for (let i = 0; i < e.length; i += 4) {
    const x = e[i], y = e[i + 1], z = e[i + 2], b = e[i + 3];
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) || !Number.isInteger(b) || y < 0 || y >= CH || Math.abs(x) > 3e6 || Math.abs(z) > 3e6 || b < 0 || b > BMAX || (b > 0 && !BLOCKS[b])) throw new SaveError(`World "${w.name}" contains an invalid block entry, so the file is damaged.`);
    edits[i] = x; edits[i + 1] = y; edits[i + 2] = z; edits[i + 3] = b;
  }
  w.edits = edits;
  for (const c of Array.isArray(d.claims) ? d.claims.slice(0, 5000) : []) {
    if (!c || !Number.isInteger(c.cx) || !Number.isInteger(c.cz) || !isHex(c.vid, 32)) { issues.push(`${w.name}: ignored an invalid chunk claim`); continue; }
    w.claims.push({ cx: c.cx, cz: c.cz, vid: c.vid, slot: int(c.slot, 0, 2), name: label(c.name, 20, 'Chunk'), owner: label(c.owner, 24, 'Someone'), at: num(c.at, 0, 4e12), sx: int(c.sx, -3e6, 3e6), sy: int(c.sy, 0, CH), sz: int(c.sz, -3e6, 3e6) });
  }
  return w;
}
export function cleanVault(v, issues) {
  if (!v || typeof v !== 'object' || !isHex(v.vid, 32) || !isHex(v.codeHash, 64)) throw new SaveError('The save code data in this file is damaged.');
  const rec = {
    v: 1, vid: v.vid, codeHash: v.codeHash, name: label(v.name, 24), created: num(v.created, 0, 4e12, Date.now()), updated: num(v.updated, 0, 4e12, Date.now()),
    inv: Array.from({ length: 36 }, (_, i) => stack(Array.isArray(v.inv) ? v.inv[i] : 0, issues, 'save code')), arm: Array.from({ length: 4 }, (_, i) => stack(Array.isArray(v.arm) ? v.arm[i] : 0, issues, 'save code')),
    off: stack(v.off, issues, 'save code'), hp: num(v.hp, 1, 20, 20), food: num(v.food, 0, 20, 20), sel: int(v.sel, 0, 8), chunks: [null, null, null],
  };
  (Array.isArray(v.chunks) ? v.chunks.slice(0, 3) : []).forEach((c, i) => {
    if (!c) return;
    const data = c.data && typeof c.data === 'object' ? c.data : null;
    const snap = data && typeof data.blocks === 'string' && data.blocks.length <= 200000 ? { v: 1, cx: int(c.cx, -1e6, 1e6), cz: int(c.cz, -1e6, 1e6), blocks: data.blocks, conts: cleanContainers(data.conts, issues, `saved chunk "${label(c.name, 20)}"`, true) } : null;
    const cells = snap && decode(snap);
    if (!cells) throw new SaveError(`The saved chunk "${label(c.name, 20, String(i + 1))}" in this file is damaged, so nothing was imported.`);
    for (let k = 0; k < cells.length; k++) if (cells[k] > BMAX || (cells[k] > 0 && !BLOCKS[cells[k]])) throw new SaveError(`The saved chunk "${label(c.name, 20)}" contains an invalid block, so the file is damaged.`);
    rec.chunks[i] = { name: label(c.name, 20, `Chunk ${i + 1}`), cx: snap.cx, cz: snap.cz, wid: typeof c.wid === 'string' && WORLD_ID.test(c.wid) ? c.wid : '', wname: label(c.wname, 24), at: num(c.at, 0, 4e12), data: snap };
  });
  return rec;
}
// Checks the whole payload and returns a clean copy. issues collects anything that was ignored, so nothing is dropped silently.
export function cleanPayload(p) {
  const issues = [];
  const a = p.account;
  if (!a || !isHex(a.th, 32)) throw new SaveError('The account information in this file is damaged.');
  const out = { account: { th: a.th, created: num(a.created, 0, 4e12) }, client: {}, vault: null, records: [], worlds: [], notes: [], issues };
  for (const k of ['name', 'cfg', 'code']) if (p.client && k in p.client) {
    const v = p.client[k];
    if (k === 'name') out.client.name = label(v, 16); else if (k === 'code') out.client.code = typeof v === 'string' ? v.replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) : '';
    else if (v && typeof v === 'object') out.client.cfg = { dist: int(v.dist, 2, 12, 5), fov: int(v.fov, 40, 110, 75), sens: num(v.sens, 0.1, 5, 1), ...Object.fromEntries(Object.entries(v).filter(([kk, vv]) => /^[a-zA-Z]{1,16}$/.test(kk) && ['number', 'boolean'].includes(typeof vv))) };
  }
  if (!Array.isArray(p.worlds) || p.worlds.length > MAX_WORLDS) throw new SaveError(`The file lists more than ${MAX_WORLDS} worlds or its world list is damaged.`);
  const seen = new Set();
  for (const w of p.worlds) {
    const id = w && typeof w.id === 'string' ? w.id : '';
    if (!WORLD_ID.test(id) || id === 'PUBLIC' || seen.has(id)) throw new SaveError('A world in this file has an invalid or repeated id, so the file is damaged.');
    seen.add(id); out.worlds.push({ id, data: cleanWorld(id, w.data, issues) });
  }
  if (p.vault) out.vault = cleanVault(p.vault, issues);
  for (const r of Array.isArray(p.records) ? p.records.slice(0, 500) : []) {
    const rec = r && WORLD_ID.test(String(r.worldId)) && !seen.has(r.worldId) ? cleanPlayerRec(r.record, issues, `progress in ${label(r.name, 24)}`) : null;
    if (rec) out.records.push({ worldId: r.worldId, name: label(r.name, 24, r.worldId), record: rec }); else issues.push('ignored an invalid player record');
  }
  out.notes = (Array.isArray(p.notes) ? p.notes : []).slice(0, 50).map((n) => String(n ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 300));
  return out;
}
