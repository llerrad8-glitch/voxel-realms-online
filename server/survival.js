// Authoritative survival rules for one player: health, hunger, mining, placing, fighting, eating, inventory windows.
import { CS, CH, B, isWater, isLava, isSolid, isBed, isDoor, doorUpper, doorOpen, doorDir, doorId, torchFor, bedDir, bedIsHead, DIR4, blockHeight, BED_H, isLayer, isPlant, bedId, bedColor, waterHeight, isFarmland, isWheat, WHEAT0, isBush, bushStage, bushKind, bushId, isSapling, isFlower } from '../public/shared/world.js';
import { I, ITEMS, itemInfo, maxStack, breakTime, blockDrops, attackDamage, attackCooldown, FOOD, boatId, MUSKET, GUNS, ammoName } from '../public/shared/items.js';
import { MOBS, MOB_TYPES, mobDims } from '../public/shared/mobs.js';
import { mk, clone, pack, unpack, addToInv, newWin, click as invClick, closeWin, newContainer, fillRecipe } from './inventory.js';
import { send, broadcast, sys } from './net.js';
import { tickToMs } from '../public/shared/daycycle.js';
import { blockAt, setBlock, settle, lineClear, boxHitsSolid } from './world.js';
import { spawnItem, spawnArrow, hurtMob, spawnMob, isNight, freeBoat, TAME_MAX, tamedCount } from './ents.js';
import { loadAch, saveAch, sendAch, award, bump, onBreak, onPlace, onEat, onDie, onHurt, tickAch } from './achievements.js';
import { denyReason, snapshotChunk, ck, nearSpawn } from './claims.js';
import * as vault from './vault.js';
import { farmlandFor } from './farming.js';
import { castRod, reelRod, removeHook } from './fishing.js';
import { chunkKey, touchClaim } from './world.js';

const fl = Math.floor, r2 = (v) => Math.round(v * 100) / 100;
const held = (p) => p.inv[p.sel];
const isInt = (...v) => v.every(Number.isInteger);
const lookDir = (p) => [-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch)];
const EYES = [1.62, 1.27, 0.4, 0.3], HEIGHTS = [1.8, 1.5, 0.6, 0.6]; // standing, sneaking, crawling, sleeping
const tell = (p, m) => send(p.ws, { t: 'chat', m, sys: 1 });
// Set by saves.js (it imports this file, so it cannot be imported here): called when claims or a player's saved chunks change.
export const hooks = { claimsChanged() {}, released() {} };
const note = (p, m) => { const now = Date.now(); if (now - (p.noteAt || 0) > 1500) { p.noteAt = now; tell(p, m); } }; // refusals are explained, but never spammed
const cleanChunkName = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 20);
const inReach = (p, x, y, z, max) => Math.hypot(x + 0.5 - p.x, y + 0.5 - (p.y + EYES[p.pose | 0]), z + 0.5 - p.z) <= max;
// True when any part of the player's body is inside a solid block (a small margin keeps a player pressed against a wall from counting).
function embedded(room, p) {
  const hw = 0.28, y0 = p.y + 0.05, y1 = p.y + HEIGHTS[p.pose | 0] - 0.05;
  for (let by = fl(y0); by <= fl(y1); by++) for (let bz = fl(p.z - hw); bz <= fl(p.z + hw); bz++) for (let bx = fl(p.x - hw); bx <= fl(p.x + hw); bx++) { const q = blockAt(room, bx, by, bz); if (isSolid(q) && by + blockHeight(q) > y0 + (isLayer(q) ? 0.55 : 0)) return true; } // a bed only reaches 9/16 of the way up; a layer you can step onto does not count
  return false;
}
function touchesCactus(room, p) {
  const hw = 0.4, y0 = p.y + 0.1, y1 = p.y + HEIGHTS[p.pose | 0] - 0.1;
  for (let by = fl(y0); by <= fl(y1); by++) for (let bz = fl(p.z - hw); bz <= fl(p.z + hw); bz++) for (let bx = fl(p.x - hw); bx <= fl(p.x + hw); bx++) if (blockAt(room, bx, by, bz, false) === B.CACTUS) return true;
  return false;
}
export const armorPoints = (p) => p.armor.reduce((s, a) => s + (a ? itemInfo(a.id).def : 0), 0);

/* ---------- player state ---------- */
export function initPlayer(p, room, s) {
  loadAch(p, s && s.ach);
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
export const savePlayer = (p) => ({ x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), pitch: r2(p.pitch), hp: p.dead ? 20 : p.hp, food: p.dead ? 20 : p.food, inv: p.inv.map(pack), arm: p.armor.map(pack), off: pack(p.off), sp: p.spawnPt, ach: saveAch(p) });

export function sendState(p) {
  const w = p.win;
  send(p.ws, { t: 'inv', inv: p.inv.map(pack), arm: p.armor.map(pack), off: pack(p.off), cur: pack(p.cursor), sel: p.sel, wk: w.kind, ext: w.ext.map(pack), pr: w.kind === 'furnace' ? [w.cont.burn, w.cont.burnMax, w.cont.cook] : 0 });
  p.dirtyInv = false; p.dirtyProg = false;
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
        p.invul = now + 400; award(room, p, 'shield_block'); p.dirtyInv = true; p.dirtyEq = true; broadcast(room, { t: 'fx', k: 'block', e: 'p', id: p.id });
        send(p.ws, { t: 'kb', x: kb[0] * 0.3, y: 0, z: kb[2] * 0.3 }); return true;
      }
    }
    amt *= 1 - Math.min(20, armorPoints(p)) / 25;
    p.armor.forEach((a, i) => { if (a && ++a.d >= itemInfo(a.id).dur) p.armor[i] = null; });
    p.dirtyInv = true; p.dirtyEq = true;
  }
  p.hp = Math.max(0, p.hp - amt); p.invul = now + 500; p.dirtyStats = true;
  onHurt(room, p, amt, src);
  if (p.sleep) wake(room, p);
  broadcast(room, { t: 'fx', k: 'hurt', e: 'p', id: p.id });
  if (kb) send(p.ws, { t: 'kb', x: kb[0], y: kb[1], z: kb[2] });
  if (p.hp <= 0) die(room, p, src);
  return true;
}
function die(room, p, src) {
  onDie(room, p, src);
  p.dead = true; p.hp = 0; p.dig = null; p.useAt = 0; p.sleep = null; p.guard = false; freeBoat(room, p);
  const w = p.win, loot = [...p.inv, ...p.armor, p.off, p.cursor];
  if (w.kind === 'inv' || w.kind === 'table') for (let i = 0; i < w.w * w.w; i++) loot.push(w.ext[i]);
  for (const st of loot) if (st) spawnItem(room, st, p.x, p.y + 0.8, p.z, [(Math.random() - 0.5) * 5, 3 + Math.random() * 3, (Math.random() - 0.5) * 5], 2);
  p.inv.fill(null); p.armor.fill(null); p.off = null; p.cursor = null; p.win = newWin('inv');
  const how = { cactus: 'was pricked to death by a cactus', fall: 'fell from a high place', drown: 'drowned', suffocate: 'suffocated in a wall', starve: 'starved to death', mob: `was slain by ${src && src.name}`, player: `was slain by ${src && src.name}`, arrow: `was shot by ${src && src.name}`, boom: `was blown up by ${src && src.name}`, lava: 'tried to swim in lava' }[src && src.kind] || 'died';
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
  award(room, p, `open_${kind}`);
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
    if (wet || p.boat) p.fallTop = p.y;
    else if (grounded) { const dist = p.fallTop - p.y; if (!cr && dist >= 3.6) damagePlayer(room, p, Math.max(1, Math.ceil(dist - 3.5)), { kind: 'fall' }, null, true); p.fallTop = p.y; }
    else p.fallTop = Math.max(p.fallTop, p.y);
    if (!cr) {
      const inLava = isLava(blockAt(room, fl(p.x), fl(p.y + 0.2), fl(p.z), false)) || isLava(blockAt(room, fl(p.x), fl(p.y + 1.0), fl(p.z), false));
      if (inLava) { p.fallTop = p.y; if ((p.lavaT = (p.lavaT || 0) + dt) >= 0.5) { p.lavaT = 0; damagePlayer(room, p, 4, { kind: 'lava' }, null); } } else p.lavaT = 0.5; // 2 hearts every half second, the first the moment you touch it
      if (touchesCactus(room, p)) { if ((p.cactusT = (p.cactusT || 0) + dt) >= 0.5) { p.cactusT = 0; damagePlayer(room, p, 1, { kind: 'cactus' }, null); } } else p.cactusT = 0.5; // a cactus pricks you every half second while you touch it
      if (embedded(room, p)) { if ((p.suffT += dt) >= 0.5) { p.suffT = 0; damagePlayer(room, p, 1, { kind: 'suffocate' }, null, true); } } else p.suffT = 0.25; // half a heart every half second while inside blocks, armor does not help
      if (head) { p.air -= dt; p.dirtyStats = true; if (p.air <= 0 && (p.drownT += dt) >= 1) { p.drownT = 0; damagePlayer(room, p, 2, { kind: 'drown' }, null, true); } }
      else { if (p.air < 15) { p.air = Math.min(15, p.air + 4 * dt); p.dirtyStats = true; } p.drownT = 0; }
      if (p.food >= 18 && p.hp < 20) { if ((p.regenT += dt) >= 4) { p.regenT = 0; p.hp = Math.min(20, p.hp + 1); exhaust(p, 6); p.dirtyStats = true; } } else p.regenT = 0;
      if (p.food <= 0) { if ((p.starveT += dt) >= 4) { p.starveT = 0; if (p.hp > 1) damagePlayer(room, p, 1, { kind: 'starve' }, null, true); } } else p.starveT = 0;
    }
    if (p.win.pos && Math.hypot(p.win.pos[0] + 0.5 - p.x, p.win.pos[2] + 0.5 - p.z) > 8) { for (const st of closeWin(p)) dropStack(room, p, st); p.dirtyInv = true; send(p.ws, { t: 'wclose' }); }
  }
  tickAch(room, p, dt);
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
  if (id <= 0 || (isWater(id) && id !== B.SEAWEED) || id === B.BEDROCK || !inReach(p, x, y, z, 7)) return deny(room, p, x, y, z); // (seaweed is water with a plant in it, and can be mined)
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
  setBlock(room, x, y, z, id === B.SEAWEED ? B.WATER : 0); settle(room, x, y + 1, z); // (mined seaweed leaves plain water)
  onBreak(room, p, id);
  if (saver) hooks.released(room, saver, p);
}
function doUse(room, p, m) {
  const { x, y, z, nx, ny, nz } = m;
  if (!isInt(x, y, z, nx, ny, nz) || Math.abs(nx) + Math.abs(ny) + Math.abs(nz) !== 1 || y < 0 || y >= CH || !inReach(p, x, y, z, 7)) return;
  const id = blockAt(room, x, y, z);
  if (isDoor(id) && p.pose !== 1) { const w = denyReason(room, p, x, z, 'use'); return w ? note(p, w) : (award(room, p, 'door_use'), toggleDoor(room, x, y, z, id)); } // (sneak to place a block against a door instead)
  if (isBed(id)) { const w = denyReason(room, p, x, z, 'use'); return w ? note(p, w) : trySleep(room, p, x, y, z, id); }
  if (id === B.TABLE) return openWindow(room, p, 'table', x, y, z);
  if (id === B.CHEST || id === B.FURNACE) { const w = denyReason(room, p, x, z, 'container'); if (w) return note(p, w); return openWindow(room, p, id === B.CHEST ? 'chest' : 'furnace', x, y, z); }
  if (isBush(id) && bushStage(id) === 3 && p.pose !== 1) return harvestBush(room, p, x, y, z, id); // right click a ripe berry bush to pick its berries (sneak to place a block against it instead)
  const st = held(p), it = st && itemInfo(st.id);
  if (it && it.bucket) return useBucket(room, p, st, it, x, y, z, nx, ny, nz);
  if (it && it.hoe) return useHoe(room, p, st, x, y, z, id);
  if (it && it.seeds) return sowSeeds(room, p, st, x, y, z, ny, id);
  if (it && it.plantAs !== undefined) return plantItem(room, p, st, it, x, y, z, ny, id);
  const onPlant = isPlant(id); // aimed at grass or a flower: a bed or door goes where it stands, clearing it
  if (it && it.bed) return placeBed(room, p, st, x, y, z, onPlant ? 0 : nx, onPlant ? 0 : ny, onPlant ? 0 : nz);
  if (it && it.door) return placeDoor(room, p, st, x, y, z, onPlant ? 0 : nx, onPlant ? 0 : ny, onPlant ? 0 : nz);
  if (it && it.seaweed) return placeSeaweed(room, p, st, x, y, z, nx, ny, nz);
  if (!it || !it.block || it.block === B.CHUNK_SAVER) return; // a Chunk Saver is placed only through the claim rules ('cs')
  const repl = isPlant(id) && it.block !== B.TORCH; // grass and flowers are replaced by what you place on them
  const px = repl ? x : x + nx, py = repl ? y : y + ny, pz = repl ? z : z + nz;
  if (py < 0 || py >= CH) return;
  const cur = blockAt(room, px, py, pz);
  if ((cur !== 0 && !isWater(cur) && !isLayer(cur) && !isPlant(cur)) || !inReach(p, px, py, pz, 7.5)) return deny(room, p, px, py, pz);
  const why = denyReason(room, p, px, pz, 'build');
  if (why) { note(p, why); return deny(room, p, px, py, pz); }
  let place = it.block;
  if (isPlant(place)) { // flowers need solid ground; a sapling needs grass or dirt; sugar cane needs grass, dirt or sand with water beside it
    const below = blockAt(room, px, py - 1, pz);
    if (!isSolid(below) || isBed(below) || isLayer(below)) return deny(room, p, px, py, pz);
    if (isSapling(place) && below !== B.GRASS && below !== B.DIRT) return deny(room, p, px, py, pz);
    if (place === B.SUGAR_CANE && !((below === B.GRASS || below === B.DIRT || below === B.SAND) && DIR4.some(([a, b]) => isWater(blockAt(room, px + a, py - 1, pz + b, false))))) return deny(room, p, px, py, pz);
  }
  if (place === B.TORCH) { // a torch goes on the top or a side of a solid block, never a ceiling
    place = torchFor(nx, ny, nz);
    const sup = blockAt(room, x, y, z);
    if (!place || !isSolid(sup) || isBed(sup) || isLayer(sup)) return deny(room, p, px, py, pz);
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
  onPlace(room, p, it.block);
  if (room.mode !== 'creative') { if (--st.n <= 0) p.inv[p.sel] = null; p.dirtyInv = true; p.dirtyEq = true; }
}
// A hoe turns the top of a grass or dirt block into farmland (watered when there is water within four blocks). Grass or flowers growing on top are cleared.
function useHoe(room, p, st, x, y, z, id) {
  if (id !== B.GRASS && id !== B.DIRT) return;
  const above = blockAt(room, x, y + 1, z);
  if (above !== 0 && !isPlant(above)) return; // something is on top of it
  if (isWheat(above)) return;
  const why = denyReason(room, p, x, z, 'build');
  if (why) return note(p, why);
  if (isPlant(above)) setBlock(room, x, y + 1, z, 0);
  setBlock(room, x, y, z, farmlandFor(room, x, y, z)); award(room, p, 'till');
  if (room.mode !== 'creative') wear(p, 1);
}
// Seeds go on the top of farmland and grow into wheat.
function sowSeeds(room, p, st, x, y, z, ny, id) {
  if (!isFarmland(id) || ny !== 1) return;
  const above = blockAt(room, x, y + 1, z);
  if (above !== 0 && !(isPlant(above) && !isWheat(above))) return;
  const why = denyReason(room, p, x, z, 'build');
  if (why) return note(p, why);
  setBlock(room, x, y + 1, z, WHEAT0); award(room, p, 'sow');
  if (room.mode !== 'creative') { if (--st.n <= 0) p.inv[p.sel] = null; p.dirtyInv = true; p.dirtyEq = true; }
}
// A berry or a banana in hand, right click on the top of a grass or dirt block: a baby berry bush (or a banana tree sapling) is planted.
function plantItem(room, p, st, it, x, y, z, ny, id) {
  if ((id !== B.GRASS && id !== B.DIRT) || ny !== 1) return;
  const above = blockAt(room, x, y + 1, z);
  if (!(above === 0 || above === B.GRASS_PLANT || above === B.TALL_GRASS || isFlower(above) || above === B.DEAD_BUSH)) return;
  const why = denyReason(room, p, x, z, 'build');
  if (why) return note(p, why);
  setBlock(room, x, y + 1, z, it.plantAs); award(room, p, it.plantAs === 191 ? 'plant_banana' : 'plant_berry');
  if (room.mode !== 'creative') { if (--st.n <= 0) p.inv[p.sel] = null; p.dirtyInv = true; p.dirtyEq = true; }
}
// Picking a ripe bush gives 1 to 3 berries and leaves the bush, which starts growing again from its second stage.
function harvestBush(room, p, x, y, z, id) {
  const why = denyReason(room, p, x, z, 'build');
  if (why) return note(p, why);
  setBlock(room, x, y, z, bushId(bushKind(id), 1), true);
  const n = 1 + Math.floor(Math.random() * 3); award(room, p, 'harvest_berry'); bump(room, p, 'berries', n);
  if (room.mode !== 'creative') spawnItem(room, mk(I.BLACKBERRY + bushKind(id), n), x + 0.5, y + 0.5, z + 0.5, [(Math.random() - 0.5) * 1.5, 2.5, (Math.random() - 0.5) * 1.5], 0.4);
}
// Fishing rod: the first right click casts, the next one reels in (a fish on the line is caught only if the float has just plunged).
function doRod(room, p, m) {
  const st = held(p);
  if (!st || st.id !== I.FISHING_ROD) return;
  if (m.op === 'reel') { if (reelRod(room, p) && room.mode !== 'creative') wear(p, 1); return; }
  if (m.op === 'cast') { if (Array.isArray(m.d) && m.d.length === 3 && m.d.every(Number.isFinite)) castRod(room, p, m.d); }
}
// Right click a door: both halves swing open or shut together.
function toggleDoor(room, x, y, z, id) {
  const ly = doorUpper(id) ? y - 1 : y, lo = blockAt(room, x, ly, z), hi = blockAt(room, x, ly + 1, z);
  if (!isDoor(lo) || !isDoor(hi) || doorUpper(lo) || !doorUpper(hi)) return;
  const open = !doorOpen(lo), dir = doorDir(lo);
  setBlock(room, x, ly, z, doorId(false, open, dir)); setBlock(room, x, ly + 1, z, doorId(true, open, dir));
}
// A door is two blocks tall and needs two free cells on a solid floor. Its closed panel stands on the side nearest you.
function placeDoor(room, p, st, x, y, z, nx, ny, nz) {
  const px = x + nx, py = y + ny, pz = z + nz, f = [-Math.sin(p.yaw), -Math.cos(p.yaw)];
  const look = Math.abs(f[0]) > Math.abs(f[1]) ? (f[0] > 0 ? 0 : 1) : f[1] > 0 ? 2 : 3, dir = look ^ 1;
  if (py < 1 || py + 1 >= CH || !inReach(p, px, py, pz, 7.5)) return;
  const below = blockAt(room, px, py - 1, pz);
  if (!(blockAt(room, px, py, pz) === 0 || isPlant(blockAt(room, px, py, pz))) || !(blockAt(room, px, py + 1, pz) === 0 || isPlant(blockAt(room, px, py + 1, pz))) || !isSolid(below) || isBed(below) || isLayer(below)) return deny(room, p, px, py, pz);
  const why = denyReason(room, p, px, pz, 'build');
  if (why) { note(p, why); return deny(room, p, px, py, pz); }
  const hits = (q, w, h) => q.x - w / 2 < px + 1 && q.x + w / 2 > px && q.z - w / 2 < pz + 1 && q.z + w / 2 > pz && q.y < py + 2 && q.y + h > py;
  for (const q of room.players.values()) if (!q.dead && hits(q, 0.6, 1.8)) return deny(room, p, px, py, pz);
  for (const q of room.mobs.values()) { const d = mobDims(q.type, q.size); if (hits(q, d.w, d.h)) return deny(room, p, px, py, pz); }
  setBlock(room, px, py, pz, doorId(false, false, dir)); setBlock(room, px, py + 1, pz, doorId(true, false, dir));
  if (room.mode !== 'creative') { if (--st.n <= 0) p.inv[p.sel] = null; p.dirtyInv = true; p.dirtyEq = true; }
}
// A bed is two blocks long and points the way you are facing; it needs air and a solid floor for both halves.
function placeBed(room, p, st, x, y, z, nx, ny, nz) {
  const px = x + nx, py = y + ny, pz = z + nz, f = [-Math.sin(p.yaw), -Math.cos(p.yaw)];
  const dir = Math.abs(f[0]) > Math.abs(f[1]) ? (f[0] > 0 ? 0 : 1) : f[1] > 0 ? 2 : 3, [dx, dz] = DIR4[dir], hx = px + dx, hz = pz + dz;
  if (py < 1 || py >= CH || !inReach(p, px, py, pz, 7.5)) return;
  const clear = (b) => b === 0 || isPlant(b), ok = (cx, cz) => clear(blockAt(room, cx, py, cz)) && isSolid(blockAt(room, cx, py - 1, cz)) && !isBed(blockAt(room, cx, py - 1, cz));
  if (!ok(px, pz) || !ok(hx, hz)) return deny(room, p, px, py, pz);
  const why = denyReason(room, p, px, pz, 'build') || denyReason(room, p, hx, hz, 'build');
  if (why) { note(p, why); return deny(room, p, px, py, pz); }
  const col = itemInfo(st.id).color | 0;
  setBlock(room, px, py, pz, bedId(col, false, dir)); setBlock(room, hx, py, hz, bedId(col, true, dir));
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
  award(room, p, 'sleep_bed');
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
      room.sleepT = 0; room.created = Date.now() - tickToMs(720); room.markDirty(); // the night is skipped: the new day starts just after sunrise
      broadcast(room, { t: 'time', epoch: room.created });
      for (const q of asleep) { bump(room, q, 'slept', 1); wake(room, q); }
    }
  } else room.sleepT = 0;
}

// Buckets: an empty one scoops up the water source it is aimed at; a full one pours a new source next to the block it is aimed at.
function useBucket(room, p, st, it, x, y, z, nx, ny, nz) {
  const cr = room.mode === 'creative', id = blockAt(room, x, y, z);
  if (it.bucket === 'empty') {
    if (id !== B.WATER && id !== B.LAVA) return; // a source block of water or of lava
    const why = denyReason(room, p, x, z, 'build');
    if (why) return note(p, why);
    const full = id === B.LAVA ? I.LAVA_BUCKET : I.WATER_BUCKET;
    setBlock(room, x, y, z, 0); award(room, p, id === B.LAVA ? 'scoop_lava' : 'scoop_water');
    if (!cr) {
      if (st.n <= 1) p.inv[p.sel] = mk(full, 1);
      else { st.n--; const left = addToInv(p.inv, mk(full, 1)); if (left) dropStack(room, p, mk(full, left)); }
    }
  } else {
    const px = x + nx, py = y + ny, pz = z + nz, lava = it.bucket === 'lava';
    if (py < 0 || py >= CH || !inReach(p, px, py, pz, 7.5)) return;
    const cur = blockAt(room, px, py, pz);
    if (lava) { if (cur !== 0 && !isPlant(cur)) return deny(room, p, px, py, pz); } // lava goes only into open air (or over a plant)
    else { if (cur === B.WATER) return; if (cur !== 0 && !isWater(cur)) return deny(room, p, px, py, pz); }
    const why = denyReason(room, p, px, pz, 'build');
    if (why) { note(p, why); return deny(room, p, px, py, pz); }
    setBlock(room, px, py, pz, lava ? B.LAVA : B.WATER); award(room, p, lava ? 'pour_lava' : 'pour_water');
    if (!cr) p.inv[p.sel] = mk(I.BUCKET, 1);
  }
  p.dirtyInv = true; p.dirtyEq = true;
}
// Seaweed goes into a block of still water that has solid ground (or more seaweed) under it.
function placeSeaweed(room, p, st, x, y, z, nx, ny, nz) {
  const px = x + nx, py = y + ny, pz = z + nz;
  if (py < 1 || py >= CH || !inReach(p, px, py, pz, 7.5) || blockAt(room, px, py, pz) !== B.WATER) return;
  const below = blockAt(room, px, py - 1, pz);
  if (!isSolid(below) && below !== B.SEAWEED) return;
  if (isLayer(below) || isBed(below)) return;
  const why = denyReason(room, p, px, pz, 'build');
  if (why) { note(p, why); return deny(room, p, px, py, pz); }
  setBlock(room, px, py, pz, B.SEAWEED);
  if (room.mode !== 'creative') { if (--st.n <= 0) p.inv[p.sel] = null; p.dirtyInv = true; p.dirtyEq = true; }
}

/* ---------- boats: place one on water, climb in, drive it (the rider's game moves it), climb out, break it ---------- */
function doBoat(room, p, m) {
  const op = m.op;
  if (op === 'leave') return freeBoat(room, p);
  if (op === 'place') {
    const st = held(p), it = st && itemInfo(st.id), { x, y, z } = m;
    if (!it || it.boat === undefined || !isInt(x, y, z) || p.boat || y < 1 || y >= CH - 2) return;
    let wy = y, id = blockAt(room, x, wy, z);
    if (!isWater(id) || !inReach(p, x, y, z, 7)) return;
    while (isWater(blockAt(room, x, wy + 1, z))) wy++; // up to the surface
    const why = denyReason(room, p, x, z, 'build');
    if (why) return note(p, why);
    if (room.boats.size >= 300) return note(p, 'There are too many boats in this world.');
    const top = wy + waterHeight(blockAt(room, x, wy, z));
    const b = { id: ++room.entId, kind: it.boat, x: x + 0.5, y: top - 0.2, z: z + 0.5, yaw: p.yaw, rider: 0, bw: p.yaw };
    room.boats.set(b.id, b); award(room, p, 'boat_place');
    if (room.mode !== 'creative') { if (--st.n <= 0) p.inv[p.sel] = null; p.dirtyInv = true; p.dirtyEq = true; }
    room.markDirty();
    return;
  }
  const b = room.boats.get(m.id);
  if (!b || Math.hypot(b.x - p.x, b.z - p.z) > 6 || Math.abs(b.y - p.y) > 5) return;
  if (op === 'ride') {
    if (b.rider && room.players.has(b.rider) && b.rider !== p.id) return note(p, 'Someone is already in that boat.');
    if (p.boat) freeBoat(room, p);
    b.rider = p.id; p.boat = b.id; p.sleep = null;
    award(room, p, 'boat_ride'); award(room, p, `boat_k${b.kind}`); if (b.kind === 5) award(room, p, 'banana_boat');
    p.x = b.x; p.z = b.z; p.y = b.y + 0.35; p.moved = true; p.fallTop = p.y;
    send(p.ws, { t: 'ride', id: b.id, x: b.x, y: b.y, z: b.z, yaw: b.bw, kind: b.kind });
  } else if (op === 'break') {
    if (b.rider && room.players.has(b.rider)) freeBoat(room, room.players.get(b.rider));
    room.boats.delete(b.id); room.markDirty();
    if (room.mode !== 'creative') spawnItem(room, mk(boatId(b.kind), 1), b.x, b.y + 0.6, b.z);
  }
}

/* ---------- wolves: bones tame them, food heals them, other items make them sit or stand, dye changes the collar ---------- */
const WOLF_FOOD = new Set([I.RAW_PORK, I.COOKED_PORK, I.RAW_BEEF, I.STEAK, I.RAW_CHICKEN, I.COOKED_CHICKEN, I.RAW_MUTTON, I.COOKED_MUTTON, I.RAW_RABBIT, I.COOKED_RABBIT, I.ROTTEN]);
function doMobUse(room, p, m) {
  const w = room.mobs.get(m.id);
  if (!w || w.type !== 'wolf' || Math.hypot(w.x - p.x, w.z - p.z) > 4.5 || Math.abs(w.y - p.y) > 3) return;
  const st = held(p), it = st && itemInfo(st.id), cr = room.mode === 'creative', use = () => { if (!cr && --st.n <= 0) p.inv[p.sel] = null; p.dirtyInv = true; p.dirtyEq = true; };
  if (!w.tame) {
    if (!st || st.id !== I.BONE) return;
    if (tamedCount(room, p) >= TAME_MAX) return note(p, `You can only look after ${TAME_MAX} tame wolves at once.`);
    use();
    if (Math.random() < 1 / 3) {
      Object.assign(w, { tame: true, owner: p.id, ownerTh: p.th, sit: true, anger: 0, angerBy: 0, aux: 0, hp: 20, max: 20, fleeT: 0 });
      broadcast(room, { t: 'fx', k: 'tame', ok: 1, x: r2(w.x), y: r2(w.y + 0.8), z: r2(w.z) });
      award(room, p, 'tame_wolf'); bump(room, p, 'tamed', 1);
    } else broadcast(room, { t: 'fx', k: 'tame', ok: 0, x: r2(w.x), y: r2(w.y + 0.8), z: r2(w.z) });
    return;
  }
  if (w.owner !== p.id) return;
  if (st && WOLF_FOOD.has(st.id)) { if (w.hp >= w.max) return; const f = FOOD.get(st.id); w.hp = Math.min(w.max, w.hp + (f ? f[0] : 2)); use(); broadcast(room, { t: 'fx', k: 'tame', ok: 1, x: r2(w.x), y: r2(w.y + 0.8), z: r2(w.z) }); return; }
  if (it && it.dye !== undefined && st.id >= 330 && st.id <= 336) { w.aux = it.dye; use(); return; } // a dye changes the collar
  w.sit = !w.sit; w.moving = false;
}
function doAttack(room, p, m) {
  const now = Date.now(), since = (now - p.lastAtk) / 1000;
  if (since < 0.08) return;
  const k = m.k === 'p' ? 'p' : 'm', target = k === 'm' ? room.mobs.get(m.id) : room.players.get(m.id);
  if (!target || target === p || target.dead) return;
  if (k === 'm' && target.type === 'wolf' && target.tame && target.owner === p.id) return; // you do not hurt your own wolf
  const dims = k === 'm' ? mobDims(target.type, target.size) : { w: 0.6, h: 1.8 };
  // The hit lands if the body (its whole box, feet included, a little generous) is in reach and any of a few points on it can be seen from the eye.
  const eye = [p.x, p.y + (EYES[p.pose | 0] || 1.62), p.z], hw = dims.w / 2 + 0.12, cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const nearP = [cl(eye[0], target.x - hw, target.x + hw), cl(eye[1], target.y - 0.1, target.y + dims.h + 0.1), cl(eye[2], target.z - hw, target.z + hw)];
  if (Math.hypot(eye[0] - nearP[0], eye[1] - nearP[1], eye[2] - nearP[2]) > 5) return;
  const seen = [nearP, [target.x, target.y + 0.15, target.z], [target.x, target.y + dims.h / 2, target.z], [target.x, target.y + dims.h - 0.1, target.z]];
  if (!seen.some((q) => lineClear(room, eye, q, true))) return;
  // The swing recharges over the weapon's cooldown (a hand 0.25 s, a sword 0.63 s, an axe 1 to 1.25 s). A click before it is 55% charged does nothing at all and
  // does not restart the recharge, and a hit between then and full is weaker (and knocks back less), so clicking as fast as you can is worse than timing your hits.
  const charge = Math.min(1, since / attackCooldown(held(p)));
  if (charge < 0.55) return;
  p.lastAtk = now;
  let dmg = attackDamage(held(p)) * (0.1 + 0.9 * charge * charge);
  const grounded = boxHitsSolid(room, p.x, p.y - 0.06, p.z, 0.6, 0.05), wetNow = isWater(blockAt(room, fl(p.x), fl(p.y + 0.3), fl(p.z), false));
  // Critical hit: almost fully charged, falling, not sprinting and not in water. Axes, with their big base damage, hit hardest of all.
  const crit = charge > 0.9 && !grounded && !wetNow && !p.sprint && p.fallTop - p.y > 0.05;
  if (crit) { dmg *= 1.5; award(room, p, 'crit'); }
  const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz) || 1, kf = 0.4 + 0.6 * charge, kb = [(dx / d) * (p.sprint ? 7 : 5) * kf, 4.2 * kf, (dz / d) * (p.sprint ? 7 : 5) * kf];
  if (crit) broadcast(room, { t: 'fx', k: 'crit', x: r2(target.x), y: r2(target.y + dims.h * 0.6), z: r2(target.z) });
  if (k === 'm') { if (target.type === 'spider') target.anger = 25; p.hitMob = target.id; p.hitMobAt = now; hurtMob(room, target, dmg, p, kb); }
  else { if (!room.pvp || room.mode === 'creative') return; damagePlayer(room, target, dmg, { kind: 'player', name: p.name }, kb); }
  const it = held(p) && itemInfo(held(p).id);
  if (it && it.tool) wear(p, it.tool === 'sword' ? 1 : 2);
  exhaust(p, 0.1); p.dirtyStats = true;
}
// A gun (see GUNS in shared/items.js): each shot uses up its ammunition from the inventory, then the gun has to reload (one shared timer, so swapping guns never skips a reload).
// A musket or flintlock fires one ball; a shotgun fires a fan of pellets that die quickly.
function doGun(room, p, m, gun, id) {
  const now = Date.now(), cr = room.mode === 'creative';
  if (now < (p.gunReady || 0)) return;
  const slots = [];
  if (!cr) for (const [item, n] of gun.ammo) {
    const si = p.inv.findIndex((s) => s && s.id === item && s.n >= n);
    if (si < 0) return tell(p, `You need ${ammoName(item)} to fire the ${gun.name}.`);
    slots.push([si, n]);
  }
  const d = [+m.dx, +m.dy, +m.dz], len = Math.hypot(...d);
  if (!d.every(Number.isFinite) || !len) return;
  p.gunReady = now + gun.reloadMs; p.lastGun = now;
  const u = [d[0] / len, d[1] / len, d[2] / len], ox = p.x + u[0] * 0.7, oy = p.y + 1.55 + u[1] * 0.7, oz = p.z + u[2] * 0.7;
  award(room, p, id === I.MUSKET ? 'musket_fire' : id === I.FLINTLOCK ? 'flintlock_fire' : 'shotgun_fire');
  for (let i = 0; i < gun.pellets; i++) {
    let v = u;
    if (gun.spread) { const w = [u[0] + (Math.random() - 0.5) * 2 * gun.spread, u[1] + (Math.random() - 0.5) * 2 * gun.spread, u[2] + (Math.random() - 0.5) * 2 * gun.spread], l = Math.hypot(...w); v = [w[0] / l, w[1] / l, w[2] / l]; }
    spawnArrow(room, { kind: 'p', id: p.id, name: p.name, ref: p }, ox, oy, oz, v[0] * gun.speed, v[1] * gun.speed, v[2] * gun.speed, gun.dmg, true, gun.life);
  }
  broadcast(room, { t: 'fx', k: 'shot', x: r2(ox), y: r2(oy), z: r2(oz), dx: r2(u[0]), dy: r2(u[1]), dz: r2(u[2]), big: gun.pellets > 1 ? 1 : 0 });
  if (!cr) {
    for (const [si, n] of slots) if ((p.inv[si].n -= n) <= 0) p.inv[si] = null;
    wear(p, 1);
  }
  p.dirtyInv = true; exhaust(p, 0.1);
}
function doShoot(room, p, m) {
  const st = held(p), now = Date.now();
  if (st && itemInfo(st.id).gun) return doGun(room, p, m, GUNS[st.id], st.id);
  if (!st || !itemInfo(st.id).bow || now - p.lastShot < 400) return;
  const cr = room.mode === 'creative';
  let ai = -1;
  if (!cr) { ai = p.inv.findIndex((s) => s && s.id === I.ARROW); if (ai < 0) return; }
  const d = [+m.dx, +m.dy, +m.dz], len = Math.hypot(...d);
  if (!d.every(Number.isFinite) || !len) return;
  const pw = Math.max(0.15, Math.min(1, +m.ch || 0)), sp = 12 + 26 * pw;
  p.lastShot = now; bump(room, p, 'arrows', 1);
  spawnArrow(room, { kind: 'p', id: p.id, name: p.name, ref: p }, p.x + (d[0] / len) * 0.6, p.y + 1.55 + (d[1] / len) * 0.6, p.z + (d[2] / len) * 0.6, (d[0] / len) * sp, (d[1] / len) * sp, (d[2] / len) * sp, 1.5 + 6.5 * pw);
  if (!cr) { if (--p.inv[ai].n <= 0) p.inv[ai] = null; wear(p, 1); }
  p.dirtyInv = true; exhaust(p, 0.1);
}
function doEat(room, p) {
  const st = held(p), now = Date.now(), f = st && FOOD.get(st.id);
  if (!f || !p.useAt || now - p.useAt < 1400 || (p.food >= 20 && st.id !== 263 && !itemInfo(st.id).always)) return;
  p.food = Math.min(20, p.food + f[0]); p.sat = Math.min(p.food, p.sat + f[1]); p.useAt = now; onEat(room, p, st.id);
  const heal = itemInfo(st.id).heal; if (heal) p.hp = Math.min(20, p.hp + heal); // a golden apple heals four hearts at once
  if (room.mode !== 'creative' && --st.n <= 0) p.inv[p.sel] = null;
  p.dirtyInv = true; p.dirtyStats = true; p.dirtyEq = true;
}

// Entry point for every gameplay message from a client.
export function handle(room, p, m) {
  if (p.dead && m.t !== 'respawn') return;
  if (p.sleep && ['dig', 'brk', 'use', 'atk', 'shoot', 'eat', 'hold', 'rod'].includes(m.t)) return;
  switch (m.t) {
    case 'hot': if (Number.isInteger(m.i) && m.i >= 0 && m.i < 9 && m.i !== p.sel) { p.sel = m.i; p.dig = null; p.useAt = 0; p.dirtyEq = true; p.lastAtk = Date.now(); } break;
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
    case 'boat': doBoat(room, p, m); break;
    case 'rod': doRod(room, p, m); break;
    case 'achq': sendAch(p); break;
    case 'mobuse': doMobUse(room, p, m); break;
    case 'fillr': if (Number.isInteger(m.i) && fillRecipe(p, m.i)) p.dirtyInv = true; break; // recipe book: lay the ingredients out in the crafting grid
  }
}

/* ---------- Chunk Savers ---------- */
// Everyone who is looking into a chest or furnace inside this chunk (other than its owner) is sent back to their inventory.
export function closeViewers(room, cx, cz, keepVid) {
  for (const q of room.players.values()) {
    if (!q.win.pos || (keepVid && q.vid === keepVid)) continue;
    if (Math.floor(q.win.pos[0] / CS) !== cx || Math.floor(q.win.pos[2] / CS) !== cz) continue;
    for (const st of closeWin(q)) dropStack(room, q, st);
    q.dirtyInv = true; send(q.ws, { t: 'wclose' });
  }
}
export function settleWindow(room, p) { for (const st of closeWin(p)) dropStack(room, p, st); p.dirtyInv = true; } // crafting grid and held stack go back to the inventory

// Place a Chunk Saver: the server alone decides. It needs one of the player's three free slots, a unique name and an unclaimed chunk.
function doChunkSaver(room, p, m) {
  const st = held(p);
  if (!st || st.id !== B.CHUNK_SAVER) return;
  const { x, y, z, nx, ny, nz } = m;
  if (!isInt(x, y, z, nx, ny, nz) || Math.abs(nx) + Math.abs(ny) + Math.abs(nz) !== 1 || y < 0 || y >= CH || !inReach(p, x, y, z, 7)) return;
  if (room.cheated) return tell(p, 'Chunk Savers only work in survival worlds with no creative mode or cheats, so nothing can be made from nothing.');
  const rec = p.vid && vault.cached(p.vid);
  if (!rec) return tell(p, 'Chunk Savers are not available right now. Try again in a moment.');
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
  tell(p, `Chunk saved as "${name}". Everything in this chunk is now protected. Remember to export your game save to keep it.`);
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
