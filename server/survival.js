// Authoritative survival rules for one player: health, hunger, mining, placing, fighting, eating, inventory windows.
import { CS, CH, B, isWater, isSolid, isBed, torchFor, bedDir, bedIsHead, DIR4, blockHeight, BED_H } from '../public/shared/world.js';
import { I, ITEMS, itemInfo, maxStack, breakTime, blockDrops, attackDamage, FOOD } from '../public/shared/items.js';
import { MOBS, MOB_TYPES, mobDims } from '../public/shared/mobs.js';
import { mk, clone, pack, unpack, addToInv, newWin, click as invClick, closeWin, newContainer, fillRecipe } from './inventory.js';
import { send, broadcast, sys } from './net.js';
import { blockAt, setBlock, settle, lineClear, boxHitsSolid } from './world.js';
import { spawnItem, spawnArrow, hurtMob, spawnMob, isNight } from './ents.js';
import { denyReason, snapshotChunk, ck, nearSpawn } from './claims.js';
import * as vault from './vault.js';
import { chunkKey, touchClaim } from './world.js';

const fl = Math.floor, r2 = (v) => Math.round(v * 100) / 100;
const held = (p) => p.inv[p.sel];
const isInt = (...v) => v.every(Number.isInteger);
const lookDir = (p) => [-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch)];
const EYES = [1.62, 1.27, 0.4, 0.3], HEIGHTS = [1.8, 1.5, 0.6, 0.6]; // standing, sneaking, crawling, sleeping
const tell = (p, m) => send(p.ws, { t: 'chat', m, sys: 1 });
// Set by saves.js (it imports this file, so it cannot be imported here): called when claims or a player's vault change.
export const hooks = { claimsChanged() {}, released() {} };
const note = (p, m) => { const now = Date.now(); if (now - (p.noteAt || 0) > 1500) { p.noteAt = now; tell(p, m); } }; // refusals are explained, but never spammed
const cleanChunkName = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 20);
const inReach = (p, x, y, z, max) => Math.hypot(x + 0.5 - p.x, y + 0.5 - (p.y + EYES[p.pose | 0]), z + 0.5 - p.z) <= max;
// True when any part of the player's body is inside a solid block (a small margin keeps a player pressed against a wall from counting).
function embedded(room, p) {
  const hw = 0.28, y0 = p.y + 0.05, y1 = p.y + HEIGHTS[p.pose | 0] - 0.05;
  for (let by = fl(y0); by <= fl(y1); by++) for (let bz = fl(p.z - hw); bz <= fl(p.z + hw); bz++) for (let bx = fl(p.x - hw); bx <= fl(p.x + hw); bx++) { const q = blockAt(room, bx, by, bz); if (isSolid(q) && by + blockHeight(q) > y0) return true; } // a bed only reaches 9/16 of the way up
  return false;
}
export const armorPoints = (p) => p.armor.reduce((s, a) => s + (a ? itemInfo(a.id).def : 0), 0);

/* ---------- player state ---------- */
export function initPlayer(p, room, s) {
  p.inv = Array(36).fill(null); p.armor = Array(4).fill(null); p.cursor = null; p.win = newWin('inv');
  if (s && Array.isArray(s.inv)) s.inv.slice(0, 36).forEach((a, i) => { p.inv[i] = unpack(a); });
  if (s && Array.isArray(s.arm)) s.arm.slice(0, 4).forEach((a, i) => { p.armor[i] = unpack(a); });
  p.off = s && s.off ? unpack(s.off) : null; if (p.off && !itemInfo(p.off.id).shield) p.off = null;
  p.spawnPt = s && Array.isArray(s.sp) && s.sp.length === 3 && s.sp.every(Number.isInteger) ? s.sp : null;
  Object.assign(p, {
    sleep: null, guard: false,
    hp: s && s.hp > 0 ? Math.min(20, s.hp) : 20, food: s && Number.isFinite(s.food) ? Math.min(20, s.food) : 20, sat: 5, exh: 0, air: 15,
    regenT: 0, starveT: 0, drownT: 0, dead: false, sel: 0, invul: 0, lastAtk: 0, lastShot: 0, useAt: 0, dig: null, lastRespawn: 0,
    fallTop: p.y, sprint: false, pose: 0, suffT: 0.25, eq: '', dirtyInv: true, dirtyStats: true, dirtyEq: true, dirtyProg: false, statsAt: 0,
  });
}
// A player linked to a save code keeps only their position in the world's own record: their items live in the vault, so they exist in one place only.
export const savePlayer = (p) => (p.vid ? { x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), pitch: r2(p.pitch), sp: p.spawnPt, vl: 1 } : savePlain(p));
const savePlain = (p) => ({ x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), pitch: r2(p.pitch), hp: p.dead ? 20 : p.hp, food: p.dead ? 20 : p.food, inv: p.inv.map(pack), arm: p.armor.map(pack), off: pack(p.off), sp: p.spawnPt });

export function sendState(p) {
  const w = p.win;
  send(p.ws, { t: 'inv', inv: p.inv.map(pack), arm: p.armor.map(pack), off: pack(p.off), cur: pack(p.cursor), sel: p.sel, wk: w.kind, ext: w.ext.map(pack), pr: w.kind === 'furnace' ? [w.cont.burn, w.cont.burnMax, w.cont.cook] : 0 });
  p.dirtyInv = false; p.dirtyProg = false; p.vdirty = true;
}
export function sendStats(p) { send(p.ws, { t: 'st', hp: p.hp, food: p.food, air: p.air, def: armorPoints(p) }); p.dirtyStats = false; p.statsAt = Date.now(); }
function sendEq(room, p) {
  const sig = `${held(p) ? held(p).id : 0}|${p.armor.map((a) => (a ? a.id : 0))}|${p.off ? p.off.id : 0}`;
  if (sig !== p.eq) { p.eq = sig; broadcast(room, { t: 'eq', id: p.id, ...equipOf(p) }); }
  p.dirtyEq = false;
}
export const equipOf = (p) => ({ held: held(p) ? held(p).id : 0, arm: p.armor.map((a) => (a ? a.id : 0)), off: p.off ? p.off.id : 0 });

function exhaust(p, a) {
  p.exh += a;
  while (p.exh >= 4) { p.exh -= 4; if (p.sat > 0) p.sat = Math.max(0, p.sat - 1); else if (p.food > 0) p.food--; p.dirtyStats = true; }
}
export function onMoved(p, hd, sprint, pose) { p.sprint = !!sprint; p.pose = pose === 1 || pose === 2 ? pose : 0; if (sprint && hd > 0 && !p.dead && hd < 5) exhaust(p, 0.1 * hd); }

function wear(p, n) { // lose durability on the held item
  const st = held(p), it = st && itemInfo(st.id);
  if (!it || !it.dur) return;
  st.d += n;
  if (st.d >= it.dur) p.inv[p.sel] = null;
  p.dirtyInv = true; p.dirtyEq = true;
}
function dropStack(room, p, st, forward = false) {
  if (!st) return;
  const d = lookDir(p);
  spawnItem(room, st, p.x + d[0] * 0.4, p.y + 1.4 + d[1] * 0.4, p.z + d[2] * 0.4, forward ? [d[0] * 4.5, d[1] * 4.5 + 1.5, d[2] * 4.5] : [d[0] * 1.5, 2, d[2] * 1.5], forward ? 2 : 1);
}

/* ---------- damage, death ---------- */
export function damagePlayer(room, p, amt, src, kb, trueDmg) {
  if (p.dead || room.mode === 'creative') return false;
  const now = Date.now();
  if (!trueDmg) {
    if (now < p.invul) return false;
    if (p.guard && p.off && kb && src && src.kind !== 'boom') { // a raised shield stops hits and arrows that come from the front
      const hk = Math.hypot(kb[0], kb[2]) || 1;
      if ((-Math.sin(p.yaw) * kb[0] - Math.cos(p.yaw) * kb[2]) / hk < -0.05) {
        p.off.d += Math.max(1, Math.ceil(amt)); if (p.off.d >= itemInfo(p.off.id).dur) { p.off = null; p.guard = false; }
        p.invul = now + 400; p.dirtyInv = true; p.dirtyEq = true; broadcast(room, { t: 'fx', k: 'block', e: 'p', id: p.id });
        send(p.ws, { t: 'kb', x: kb[0] * 0.3, y: 0, z: kb[2] * 0.3 }); return true;
      }
    }
    amt *= 1 - Math.min(20, armorPoints(p)) / 25;
    p.armor.forEach((a, i) => { if (a && ++a.d >= itemInfo(a.id).dur) p.armor[i] = null; });
    p.dirtyInv = true; p.dirtyEq = true;
  }
  p.hp = Math.max(0, p.hp - amt); p.invul = now + 500; p.dirtyStats = true;
  if (p.sleep) wake(room, p);
  broadcast(room, { t: 'fx', k: 'hurt', e: 'p', id: p.id });
  if (kb) send(p.ws, { t: 'kb', x: kb[0], y: kb[1], z: kb[2] });
  if (p.hp <= 0) die(room, p, src);
  return true;
}
function die(room, p, src) {
  p.dead = true; p.hp = 0; p.dig = null; p.useAt = 0; p.sleep = null; p.guard = false;
  const w = p.win, loot = [...p.inv, ...p.armor, p.off, p.cursor];
  if (w.kind === 'inv' || w.kind === 'table') for (let i = 0; i < w.w * w.w; i++) loot.push(w.ext[i]);
  for (const st of loot) if (st) spawnItem(room, st, p.x, p.y + 0.8, p.z, [(Math.random() - 0.5) * 5, 3 + Math.random() * 3, (Math.random() - 0.5) * 5], 2);
  p.inv.fill(null); p.armor.fill(null); p.off = null; p.cursor = null; p.win = newWin('inv');
  const how = { fall: 'fell from a high place', drown: 'drowned', suffocate: 'suffocated in a wall', starve: 'starved to death', mob: `was slain by ${src && src.name}`, player: `was slain by ${src && src.name}`, arrow: `was shot by ${src && src.name}`, boom: `was blown up by ${src && src.name}` }[src && src.kind] || 'died';
  send(p.ws, { t: 'dead', m: how });
  broadcast(room, { t: 'pl', id: p.id }, p.ws);
  sys(room, `${p.name} ${how}`);
  p.dirtyInv = true; p.dirtyStats = true; p.dirtyEq = true;
}
export function respawn(room, p) {
  const wasDead = p.dead, now = Date.now();
  if (!wasDead && room.mode !== 'creative' && now - p.lastRespawn < 8000) return; // the stuck-button is rate limited
  let sp = room.spawn;
  if (p.spawnPt) { // a bed you have slept in (or tried to) is where you come back, as long as it is still there
    const [bx, by, bz] = p.spawnPt;
    if (isBed(blockAt(room, bx, by, bz))) sp = { x: bx + 0.5, y: by + BED_H + 0.05, z: bz + 0.5 };
    else { p.spawnPt = null; tell(p, 'Your bed was missing or obstructed, so you went back to the world spawn.'); }
  }
  Object.assign(p, { x: sp.x, y: sp.y, z: sp.z, dead: false, invul: now + 2000, fallTop: sp.y, bh: 30, bu: 30, bd: 120, moved: true, lastRespawn: now, air: 15 });
  if (wasDead) { p.hp = 20; p.food = 20; p.sat = 5; p.exh = 0; }
  send(p.ws, { t: 'fix', x: p.x, y: p.y, z: p.z });
  p.dirtyInv = true; p.dirtyStats = true; p.dirtyEq = true;
  if (wasDead) broadcast(room, { t: 'pj', p: { id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, yaw: 0, pitch: 0, ...equipOf(p) } }, p.ws);
}

/* ---------- containers ---------- */
export function breakContainer(room, x, y, z) {
  const key = `${x},${y},${z}`, c = room.containers.get(key);
  if (!c) return;
  room.containers.delete(key);
  for (const st of c.s) if (st) spawnItem(room, st, x + 0.5, y + 0.5, z + 0.5);
  for (const q of room.players.values()) if (q.win.key === key) { q.win = newWin('inv'); q.dirtyInv = true; send(q.ws, { t: 'wclose' }); }
}
function openWindow(room, p, kind, x, y, z) {
  const key = `${x},${y},${z}`;
  for (const st of closeWin(p)) dropStack(room, p, st);
  if (kind === 'table') p.win = newWin('table');
  else {
    let c = room.containers.get(key);
    if (!c) { c = newContainer(kind); room.containers.set(key, c); }
    p.win = newWin(kind, c, key);
  }
  p.win.key = key; p.win.pos = [x, y, z];
  p.dirtyInv = true;
  send(p.ws, { t: 'open', kind });
}

/* ---------- per-tick upkeep ---------- */
export function tickPlayer(room, p, dt) {
  const now = Date.now();
  if (!p.dead) {
    const cr = room.mode === 'creative';
    const wet = isWater(blockAt(room, fl(p.x), fl(p.y + 0.3), fl(p.z), false)), head = isWater(blockAt(room, fl(p.x), fl(p.y + EYES[p.pose | 0]), fl(p.z), false));
    const grounded = boxHitsSolid(room, p.x, p.y - 0.06, p.z, 0.6, 0.05);
    if (wet) p.fallTop = p.y;
    else if (grounded) { const dist = p.fallTop - p.y; if (!cr && dist > 3.05) damagePlayer(room, p, Math.ceil(dist - 3), { kind: 'fall' }, null, true); p.fallTop = p.y; }
    else p.fallTop = Math.max(p.fallTop, p.y);
    if (!cr) {
      if (embedded(room, p)) { if ((p.suffT += dt) >= 0.5) { p.suffT = 0; damagePlayer(room, p, 1, { kind: 'suffocate' }, null, true); } } else p.suffT = 0.25; // half a heart every half second while inside blocks, armor does not help
      if (head) { p.air -= dt; p.dirtyStats = true; if (p.air <= 0 && (p.drownT += dt) >= 1) { p.drownT = 0; damagePlayer(room, p, 2, { kind: 'drown' }, null, true); } }
      else { if (p.air < 15) { p.air = Math.min(15, p.air + 4 * dt); p.dirtyStats = true; } p.drownT = 0; }
      if (p.food >= 18 && p.hp < 20) { if ((p.regenT += dt) >= 4) { p.regenT = 0; p.hp = Math.min(20, p.hp + 1); exhaust(p, 6); p.dirtyStats = true; } } else p.regenT = 0;
      if (p.food <= 0) { if ((p.starveT += dt) >= 4) { p.starveT = 0; if (p.hp > 1) damagePlayer(room, p, 1, { kind: 'starve' }, null, true); } } else p.starveT = 0;
    }
    if (p.win.pos && Math.hypot(p.win.pos[0] + 0.5 - p.x, p.win.pos[2] + 0.5 - p.z) > 8) { for (const st of closeWin(p)) dropStack(room, p, st); p.dirtyInv = true; send(p.ws, { t: 'wclose' }); }
  }
  if (p.dirtyInv) sendState(p);
  else if (p.dirtyProg && p.win.kind === 'furnace') { send(p.ws, { t: 'wp', pr: [p.win.cont.burn, p.win.cont.burnMax, p.win.cont.cook] }); p.dirtyProg = false; }
  if (p.dirtyStats && now - p.statsAt >= 100) sendStats(p);
  if (p.dirtyEq) sendEq(room, p);
}

/* ---------- player actions ---------- */
function deny(room, p, x, y, z) { if (y >= 0 && y < CH) send(p.ws, { t: 'blk', x, y, z, id: blockAt(room, x, y, z) }); }
function doBreak(room, p, m) {
  const { x, y, z } = m;
  if (!isInt(x, y, z) || y < 1 || y >= CH || Math.abs(x) > 1e6 || Math.abs(z) > 1e6) return;
  const id = blockAt(room, x, y, z), cr = room.mode === 'creative';
  if (id <= 0 || isWater(id) || id === B.BEDROCK || !inReach(p, x, y, z, 7)) return deny(room, p, x, y, z);
  const why = denyReason(room, p, x, z, 'build'); // claims and the host's visitor rules, decided here, never on the client
  if (why) { note(p, why); return deny(room, p, x, y, z); }
  const saver = id === B.CHUNK_SAVER ? room.claims.get(chunkKey(x, z)) : null; // only its owner gets this far
  if (saver && p.pose !== 1) { note(p, 'Hold Shift while mining to pick up your Chunk Saver. Doing so releases this chunk and frees its saved-chunk slot.'); return deny(room, p, x, y, z); }
  if (!cr) {
    const need = breakTime(id, held(p)), d = p.dig;
    if (!d || d.x !== x || d.y !== y || d.z !== z || (Date.now() - d.start) / 1000 < need * 0.7 - 0.15) return deny(room, p, x, y, z);
  }
  if (id === B.CHEST || id === B.FURNACE) breakContainer(room, x, y, z);
  if (!cr) {
    for (const [item, n] of blockDrops(id, held(p))) spawnItem(room, mk(item, n), x + 0.5, y + 0.5, z + 0.5, [(Math.random() - 0.5) * 1.5, 2.5, (Math.random() - 0.5) * 1.5], 0.4);
    const it = held(p) && itemInfo(held(p).id);
    if (it && it.tool) wear(p, it.tool === 'sword' ? 2 : 1);
    exhaust(p, 0.005); p.dirtyStats = true;
  }
  p.dig = null;
  setBlock(room, x, y, z, 0); settle(room, x, y + 1, z);
  if (saver) hooks.released(room, saver, p);
}
function doUse(room, p, m) {
  const { x, y, z, nx, ny, nz } = m;
  if (!isInt(x, y, z, nx, ny, nz) || Math.abs(nx) + Math.abs(ny) + Math.abs(nz) !== 1 || y < 0 || y >= CH || !inReach(p, x, y, z, 7)) return;
  const id = blockAt(room, x, y, z);
  if (isBed(id)) { const w = denyReason(room, p, x, z, 'use'); return w ? note(p, w) : trySleep(room, p, x, y, z, id); }
  if (id === B.TABLE) return openWindow(room, p, 'table', x, y, z);
  if (id === B.CHEST || id === B.FURNACE) { const w = denyReason(room, p, x, z, 'container'); if (w) return note(p, w); return openWindow(room, p, id === B.CHEST ? 'chest' : 'furnace', x, y, z); }
  const st = held(p), it = st && itemInfo(st.id);
  if (it && it.bucket) return useBucket(room, p, st, it, x, y, z, nx, ny, nz);
  if (it && it.bed) return placeBed(room, p, st, x, y, z, nx, ny, nz);
  if (!it || !it.block || it.block === B.CHUNK_SAVER) return; // a Chunk Saver is placed only through the claim rules ('cs')
  const px = x + nx, py = y + ny, pz = z + nz;
  if (py < 0 || py >= CH) return;
  const cur = blockAt(room, px, py, pz);
  if ((cur !== 0 && !isWater(cur)) || !inReach(p, px, py, pz, 7.5)) return deny(room, p, px, py, pz);
  const why = denyReason(room, p, px, pz, 'build');
  if (why) { note(p, why); return deny(room, p, px, py, pz); }
  let place = it.block;
  if (place === B.TORCH) { // a torch goes on the top or a side of a solid block, never a ceiling
    place = torchFor(nx, ny, nz);
    const sup = blockAt(room, x, y, z);
    if (!place || !isSolid(sup) || isBed(sup)) return deny(room, p, px, py, pz);
  }
  const hits = (q, w, h) => q.x - w / 2 < px + 1 && q.x + w / 2 > px && q.z - w / 2 < pz + 1 && q.z + w / 2 > pz && q.y < py + 1 && q.y + h > py;
  let blocked = false;
  if (it.block !== B.TORCH) { // (torches may share a block with a player or creature)
    for (const q of room.players.values()) if (!q.dead && hits(q, 0.6, 1.8)) blocked = true;
    for (const q of room.mobs.values()) { const d = mobDims(q.type, q.size); if (hits(q, d.w, d.h)) blocked = true; }
  }
  if (blocked) return deny(room, p, px, py, pz);
  setBlock(room, px, py, pz, place);
  if (it.block === B.CHEST || it.block === B.FURNACE) room.containers.set(`${px},${py},${pz}`, newContainer(it.block === B.CHEST ? 'chest' : 'furnace'));
  settle(room, px, py, pz);
  if (room.mode !== 'creative') { if (--st.n <= 0) p.inv[p.sel] = null; p.dirtyInv = true; p.dirtyEq = true; }
}
// A bed is two blocks long and points the way you are facing; it needs air and a solid floor for both halves.
function placeBed(room, p, st, x, y, z, nx, ny, nz) {
  const px = x + nx, py = y + ny, pz = z + nz, f = [-Math.sin(p.yaw), -Math.cos(p.yaw)];
  const dir = Math.abs(f[0]) > Math.abs(f[1]) ? (f[0] > 0 ? 0 : 1) : f[1] > 0 ? 2 : 3, [dx, dz] = DIR4[dir], hx = px + dx, hz = pz + dz;
  if (py < 1 || py >= CH || !inReach(p, px, py, pz, 7.5)) return;
  const ok = (cx, cz) => blockAt(room, cx, py, cz) === 0 && isSolid(blockAt(room, cx, py - 1, cz)) && !isBed(blockAt(room, cx, py - 1, cz));
  if (!ok(px, pz) || !ok(hx, hz)) return deny(room, p, px, py, pz);
  const why = denyReason(room, p, px, pz, 'build') || denyReason(room, p, hx, hz, 'build');
  if (why) { note(p, why); return deny(room, p, px, py, pz); }
  setBlock(room, px, py, pz, 36 + dir); setBlock(room, hx, py, hz, 40 + dir);
  if (room.mode !== 'creative') { if (--st.n <= 0) p.inv[p.sel] = null; p.dirtyInv = true; p.dirtyEq = true; }
}
// Right click a bed: it becomes your respawn point; at night, with no monsters close, you also go to sleep.
function trySleep(room, p, x, y, z, id) {
  if (p.sleep || p.dead) return;
  const [dx, dz] = DIR4[bedDir(id)], hx = bedIsHead(id) ? x : x + dx, hz = bedIsHead(id) ? z : z + dz;
  if (Math.hypot(hx + 0.5 - p.x, y - p.y, hz + 0.5 - p.z) > 6) return;
  p.spawnPt = [hx, y, hz]; p.dirtyEq = true;
  if (!isNight(room)) return tell(p, 'You can only sleep at night. This bed is now your respawn point.');
  for (const m of room.mobs.values()) if (MOBS[m.type].kind === 'hostile' && Math.abs(m.x - hx) < 8 && Math.abs(m.y - y) < 5 && Math.abs(m.z - hz) < 8) return tell(p, 'You may not rest now, there are monsters nearby.');
  p.sleep = { x: hx, y, z: hz, dir: bedDir(id) }; p.pose = 3; p.yaw = Math.atan2(dx, dz); // lying with your head toward the pillow p.dig = null; p.useAt = 0; p.guard = false;
  p.x = hx + 0.5; p.y = y + BED_H; p.z = hz + 0.5; p.moved = true;
  send(p.ws, { t: 'sleep', on: true, x: hx, y, z: hz, dir: bedDir(id) });
}
export function wake(room, p) {
  const s = p.sleep; if (!s) return;
  p.sleep = null; p.pose = 0; p.x = s.x + 0.5; p.y = s.y + BED_H + 0.02; p.z = s.z + 0.5; p.moved = true; p.fallTop = p.y;
  send(p.ws, { t: 'sleep', on: false, x: p.x, y: p.y, z: p.z });
}
// When everyone in the world is asleep the night is skipped, like the real game; the morning also wakes anyone still in bed.
export function tickSleep(room) {
  const ps = [...room.players.values()].filter((q) => !q.dead);
  if (!ps.length) return;
  const night = isNight(room), asleep = ps.filter((q) => q.sleep);
  if (!night) { for (const q of asleep) wake(room, q); room.sleepT = 0; return; }
  if (asleep.length === ps.length) {
    room.sleepT = (room.sleepT || 0) + 0.05;
    if (room.sleepT > 2) {
      room.sleepT = 0; room.created = Date.now() - 0.03 * room.dayMs; room.markDirty();
      broadcast(room, { t: 'time', epoch: room.created });
      for (const q of asleep) wake(room, q);
    }
  } else room.sleepT = 0;
}

// Buckets: an empty one scoops up the water source it is aimed at; a full one pours a new source next to the block it is aimed at.
function useBucket(room, p, st, it, x, y, z, nx, ny, nz) {
  const cr = room.mode === 'creative', id = blockAt(room, x, y, z);
  if (it.bucket === 'empty') {
    if (id !== B.WATER) return;
    const why = denyReason(room, p, x, z, 'build');
    if (why) return note(p, why);
    setBlock(room, x, y, z, 0);
    if (!cr) {
      if (st.n <= 1) p.inv[p.sel] = mk(I.WATER_BUCKET, 1);
      else { st.n--; const left = addToInv(p.inv, mk(I.WATER_BUCKET, 1)); if (left) dropStack(room, p, mk(I.WATER_BUCKET, left)); }
    }
  } else {
    const px = x + nx, py = y + ny, pz = z + nz;
    if (py < 0 || py >= CH || !inReach(p, px, py, pz, 7.5)) return;
    const cur = blockAt(room, px, py, pz);
    if (cur === B.WATER) return;
    if (cur !== 0 && !isWater(cur)) return deny(room, p, px, py, pz);
    const why = denyReason(room, p, px, pz, 'build');
    if (why) { note(p, why); return deny(room, p, px, py, pz); }
    setBlock(room, px, py, pz, B.WATER);
    if (!cr) p.inv[p.sel] = mk(I.BUCKET, 1);
  }
  p.dirtyInv = true; p.dirtyEq = true;
}
function doAttack(room, p, m) {
  const now = Date.now(), since = (now - p.lastAtk) / 1000;
  if (since < 0.08) return;
  const k = m.k === 'p' ? 'p' : 'm', target = k === 'm' ? room.mobs.get(m.id) : room.players.get(m.id);
  if (!target || target === p || target.dead) return;
  const dims = k === 'm' ? mobDims(target.type, target.size) : { w: 0.6, h: 1.8 };
  const eye = [p.x, p.y + 1.62, p.z], mid = [target.x, target.y + dims.h / 2, target.z];
  if (Math.hypot(eye[0] - mid[0], eye[1] - mid[1], eye[2] - mid[2]) > 4.8 + dims.w / 2 || !lineClear(room, eye, mid, true)) return;
  p.lastAtk = now;
  let dmg = attackDamage(held(p)) * (0.2 + 0.8 * Math.min(1, since / 0.6) ** 2);
  const grounded = boxHitsSolid(room, p.x, p.y - 0.06, p.z, 0.6, 0.05);
  if (!grounded && p.fallTop - p.y > 0.25 && since > 0.5 && !p.sprint) dmg *= 1.5; // falling blow
  const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz) || 1, kb = [(dx / d) * (p.sprint ? 7 : 5), 4.2, (dz / d) * (p.sprint ? 7 : 5)];
  if (k === 'm') { if (target.type === 'spider') target.anger = 25; hurtMob(room, target, dmg, p, kb); }
  else { if (!room.pvp || room.mode === 'creative') return; damagePlayer(room, target, dmg, { kind: 'player', name: p.name }, kb); }
  const it = held(p) && itemInfo(held(p).id);
  if (it && it.tool) wear(p, it.tool === 'sword' ? 1 : 2);
  exhaust(p, 0.1); p.dirtyStats = true;
}
function doShoot(room, p, m) {
  const st = held(p), now = Date.now();
  if (!st || !itemInfo(st.id).bow || now - p.lastShot < 400) return;
  const cr = room.mode === 'creative';
  let ai = -1;
  if (!cr) { ai = p.inv.findIndex((s) => s && s.id === I.ARROW); if (ai < 0) return; }
  const d = [+m.dx, +m.dy, +m.dz], len = Math.hypot(...d);
  if (!d.every(Number.isFinite) || !len) return;
  const pw = Math.max(0.15, Math.min(1, +m.ch || 0)), sp = 12 + 26 * pw;
  p.lastShot = now;
  spawnArrow(room, { kind: 'p', id: p.id, name: p.name, ref: p }, p.x + (d[0] / len) * 0.6, p.y + 1.55 + (d[1] / len) * 0.6, p.z + (d[2] / len) * 0.6, (d[0] / len) * sp, (d[1] / len) * sp, (d[2] / len) * sp, 1.5 + 6.5 * pw);
  if (!cr) { if (--p.inv[ai].n <= 0) p.inv[ai] = null; wear(p, 1); }
  p.dirtyInv = true; exhaust(p, 0.1);
}
function doEat(room, p) {
  const st = held(p), now = Date.now(), f = st && FOOD.get(st.id);
  if (!f || !p.useAt || now - p.useAt < 1400 || (p.food >= 20 && st.id !== 263)) return;
  p.food = Math.min(20, p.food + f[0]); p.sat = Math.min(p.food, p.sat + f[1]); p.useAt = now;
  if (room.mode !== 'creative' && --st.n <= 0) p.inv[p.sel] = null;
  p.dirtyInv = true; p.dirtyStats = true; p.dirtyEq = true;
}

// Entry point for every gameplay message from a client.
export function handle(room, p, m) {
  if (p.dead && m.t !== 'respawn') return;
  if (p.sleep && ['dig', 'brk', 'use', 'atk', 'shoot', 'eat', 'hold'].includes(m.t)) return;
  switch (m.t) {
    case 'hot': if (Number.isInteger(m.i) && m.i >= 0 && m.i < 9 && m.i !== p.sel) { p.sel = m.i; p.dig = null; p.useAt = 0; p.dirtyEq = true; } break;
    case 'dig': if (isInt(m.x, m.y, m.z)) p.dig = { x: m.x, y: m.y, z: m.z, start: Date.now() }; break;
    case 'brk': doBreak(room, p, m); break;
    case 'use': doUse(room, p, m); break;
    case 'atk': doAttack(room, p, m); break;
    case 'shoot': doShoot(room, p, m); break;
    case 'hold': p.useAt = m.on ? Date.now() : 0; break;
    case 'eat': doEat(room, p); break;
    case 'click': if (p.win.cont && p.win.pos) { const w = denyReason(room, p, p.win.pos[0], p.win.pos[2], 'container'); if (w) { for (const st of closeWin(p)) dropStack(room, p, st); p.dirtyInv = true; send(p.ws, { t: 'wclose' }); note(p, w); break; } }
      if (typeof m.g === 'string' && invClick(p, m.g, m.i, m.b ? 1 : 0, !!m.s)) { p.dirtyInv = true; p.dirtyEq = true; p.dirtyStats = true; if (p.win.pos) touchClaim(room, p.win.pos[0], p.win.pos[2]); for (const q of room.players.values()) if (q !== p && q.win.key && q.win.key === p.win.key) q.dirtyInv = true; } else p.dirtyInv = true; break;
    case 'close': for (const st of closeWin(p)) dropStack(room, p, st); p.dirtyInv = true; break;
    case 'drop': { const st = held(p); if (!st) break; const one = m.all ? clone(st) : mk(st.id, 1, st.d); if (m.all) p.inv[p.sel] = null; else if (--st.n <= 0) p.inv[p.sel] = null; dropStack(room, p, one, true); p.dirtyInv = true; p.dirtyEq = true; break; }
    case 'dropc': { const c = p.cursor; if (!c) break; const one = m.all ? clone(c) : mk(c.id, 1, c.d); if (m.all) p.cursor = null; else if (--c.n <= 0) p.cursor = null; dropStack(room, p, one, true); p.dirtyInv = true; break; }
    case 'cre': if (room.mode === 'creative' && ITEMS.has(m.id)) { p.cursor = mk(m.id, maxStack(m.id)); p.dirtyInv = true; } break;
    case 'respawn': respawn(room, p); break;
    case 'guard': p.guard = !!m.on && !!p.off && !p.sleep; break; // shield raised or lowered
    case 'wake': wake(room, p); break;
    case 'cs': doChunkSaver(room, p, m); break;
    case 'fillr': if (Number.isInteger(m.i) && fillRecipe(p, m.i)) p.dirtyInv = true; break; // recipe book: lay the ingredients out in the crafting grid
  }
}

/* ---------- save codes: bringing a vault's items into the world, and Chunk Savers ---------- */
// Everyone who is looking into a chest or furnace inside this chunk (other than its owner) is sent back to their inventory.
export function closeViewers(room, cx, cz, keepVid) {
  for (const q of room.players.values()) {
    if (!q.win.pos || (keepVid && q.vid === keepVid)) continue;
    if (Math.floor(q.win.pos[0] / CS) !== cx || Math.floor(q.win.pos[2] / CS) !== cz) continue;
    for (const st of closeWin(q)) dropStack(room, q, st);
    q.dirtyInv = true; send(q.ws, { t: 'wclose' });
  }
}
// Move a vault's inventory and equipment onto the player. Slots keep their places where they are free; anything that does not fit goes
// into the first free space, and the rest drops at the player's feet. The vault is then re-saved from the player, so items exist once.
export function applyVault(room, p, rec) {
  const rest = [];
  (rec.inv || []).slice(0, 36).forEach((a, i) => { const s = unpack(a); if (!s) return; if (!p.inv[i]) p.inv[i] = s; else rest.push(s); });
  (rec.arm || []).slice(0, 4).forEach((a, i) => { const s = unpack(a); if (!s) return; if (!p.armor[i] && itemInfo(s.id).armor === i) p.armor[i] = s; else rest.push(s); });
  const o = unpack(rec.off); if (o) { if (!p.off && itemInfo(o.id).shield) p.off = o; else rest.push(o); }
  for (const s of rest) { const left = addToInv(p.inv, s); if (left) dropStack(room, p, mk(s.id, left, s.d)); }
  if (rec.hp > 0) p.hp = Math.min(20, rec.hp);
  if (Number.isFinite(rec.food)) p.food = Math.max(0, Math.min(20, rec.food));
  if (Number.isInteger(rec.sel) && rec.sel >= 0 && rec.sel < 9) p.sel = rec.sel;
  p.dirtyInv = true; p.dirtyStats = true; p.dirtyEq = true; p.vdirty = true; p.vlast = '';
}
export function settleWindow(room, p) { for (const st of closeWin(p)) dropStack(room, p, st); p.dirtyInv = true; } // crafting grid and held stack go back to the inventory
export const vaultView = (p) => ({ inv: p.inv.map(pack), arm: p.armor.map(pack), off: pack(p.off), hp: p.dead ? 20 : p.hp, food: p.dead ? 20 : p.food, sel: p.sel });
// Take a player's items out of the world (they have just been saved into their vault) so they exist in one place only.
export function emptyPlayer(room, p) {
  for (const st of closeWin(p)) dropStack(room, p, st);
  p.inv.fill(null); p.armor.fill(null); p.off = null; p.cursor = null; p.guard = false; p.win = newWin('inv');
  p.dirtyInv = true; p.dirtyEq = true;
}

// Place a Chunk Saver: the server alone decides. It needs a linked save code, a free one of the three slots, a unique name and an unclaimed chunk.
function doChunkSaver(room, p, m) {
  const st = held(p);
  if (!st || st.id !== B.CHUNK_SAVER) return;
  const { x, y, z, nx, ny, nz } = m;
  if (!isInt(x, y, z, nx, ny, nz) || Math.abs(nx) + Math.abs(ny) + Math.abs(nz) !== 1 || y < 0 || y >= CH || !inReach(p, x, y, z, 7)) return;
  if (room.cheated) return tell(p, 'Chunk Savers only work in survival worlds with no creative mode or cheats, so nothing can be made from nothing.');
  const rec = p.vid && vault.cached(p.vid);
  if (!rec) { send(p.ws, { t: 'need_code' }); return tell(p, 'Create or enter your save code first. A saved chunk belongs to your save code.'); }
  const slot = rec.chunks.findIndex((c) => !c);
  if (slot < 0) return tell(p, 'You already have three saved chunks. Release one first (pause menu, Save code and chunks).');
  const name = cleanChunkName(m.name);
  if (!name) return tell(p, 'Give the saved chunk a name first.');
  if (rec.chunks.some((c) => c && c.name.toLowerCase() === name.toLowerCase())) return tell(p, `You already have a saved chunk called "${name}".`);
  const px = x + nx, py = y + ny, pz = z + nz;
  if (py < 1 || py >= CH || !inReach(p, px, py, pz, 7.5)) return;
  const cur = blockAt(room, px, py, pz);
  if (cur !== 0 && !isWater(cur)) return deny(room, p, px, py, pz);
  const why = denyReason(room, p, px, pz, 'build');
  if (why) return tell(p, why);
  const cx = Math.floor(px / CS), cz = Math.floor(pz / CS), key = ck(cx, cz), old = room.claims.get(key);
  if (nearSpawn(room, cx, cz)) return tell(p, 'The area around the world spawn cannot be claimed, so everyone can always build and move there. Walk a little further out.');
  if (old) return tell(p, old.vid === p.vid ? 'This chunk is already protected by your own Chunk Saver.' : `This chunk is already claimed by ${old.owner}.`);
  const hits = (q, w, h) => q.x - w / 2 < px + 1 && q.x + w / 2 > px && q.z - w / 2 < pz + 1 && q.z + w / 2 > pz && q.y < py + 1 && q.y + h > py;
  for (const q of room.players.values()) if (!q.dead && hits(q, 0.6, 1.8)) return deny(room, p, px, py, pz);
  for (const q of room.mobs.values()) { const d = mobDims(q.type, q.size); if (hits(q, d.w, d.h)) return deny(room, p, px, py, pz); }
  setBlock(room, px, py, pz, B.CHUNK_SAVER);
  if (--st.n <= 0) p.inv[p.sel] = null;
  p.dirtyInv = true; p.dirtyEq = true;
  room.claims.set(key, { cx, cz, vid: p.vid, slot, name, owner: p.name, at: Date.now(), sx: px, sy: py, sz: pz, dirty: false, snapAt: Date.now() });
  rec.chunks[slot] = { name, cx, cz, wid: room.id, wname: room.name, at: Date.now(), data: snapshotChunk(room, cx, cz) }; // saved the moment it is placed
  vault.markDirty(rec, true); room.markDirty();
  closeViewers(room, cx, cz, p.vid);
  tell(p, `Chunk saved as "${name}". Everything in this chunk is now protected and saved to your save code.`);
  hooks.claimsChanged(room, p);
}

/* ---------- owner cheat commands (only when the world was created with cheats on) ---------- */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
export function cheat(room, p, cmd, args) {
  if (cmd === 'give') {
    const q = norm(args[0] || ''), list = [...ITEMS.values()];
    const it = list.find((i) => String(i.id) === q || norm(i.n) === q) || list.find((i) => norm(i.n).startsWith(q)) || list.find((i) => norm(i.n).includes(q));
    if (!q || !it) return 'Unknown item. Try /give diamond_pickaxe 1';
    let n = Math.max(1, Math.min(2304, parseInt(args[1], 10) || 1)), given = 0;
    while (n > 0) { const t = Math.min(n, it.max); const left = addToInv(p.inv, mk(it.id, t)); given += t - left; n -= t; if (left) break; }
    p.dirtyInv = true; p.dirtyEq = true;
    return `Gave ${given} ${it.n}`;
  }
  if (cmd === 'spawn') {
    const t = norm(args[0] || '');
    if (!MOB_TYPES.includes(t)) return 'Mobs: ' + MOB_TYPES.join(', ');
    const sz = t === 'slime' ? Math.max(1, Math.min(3, parseInt(args[1], 10) || 2)) : 1, dim = mobDims(t, sz);
    let at = [p.x + 0.9, p.y + 0.3, p.z]; // fallback: right beside the player
    for (let k = 0; k < 8; k++) { // prefer a clear spot with ground underneath, three blocks away
      const a = p.yaw + (k * Math.PI) / 4, x = p.x - Math.sin(a) * 3, z = p.z - Math.cos(a) * 3, y = p.y + 0.1;
      if (!boxHitsSolid(room, x, y, z, dim.w, dim.h) && boxHitsSolid(room, x, y - 1.5, z, dim.w, 0.4)) { at = [x, y, z]; break; }
    }
    spawnMob(room, t, at[0], at[1], at[2], { size: sz });
    return `Spawned a ${MOBS[t].name}`;
  }
  if (cmd === 'heal') { p.hp = 20; p.food = 20; p.sat = 5; p.dirtyStats = true; return 'Healed'; }
  return null;
}
