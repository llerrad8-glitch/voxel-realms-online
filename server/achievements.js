// Achievements, kept per player on the server (so they cannot be faked) and saved with the player in the world.
// Other modules report what happened (bump a counter, award an event); this file decides what that unlocks and tells the player.
import { ACH, BY_ID, breakGroups, placeGroups } from '../public/shared/achievements.js';
import { biomeKind, BIOME_NAMES, isWater } from '../public/shared/world.js';
import { isNightTick, tickAt } from '../public/shared/daycycle.js';
import { I } from '../public/shared/items.js';
import { send, sys } from './net.js';
import { blockAt } from './world.js';

const HAVE = new Map(), STAT = new Map(), ALLR = [];
for (const a of ACH) {
  if (a.have) for (const id of a.have) { if (!HAVE.has(id)) HAVE.set(id, []); HAVE.get(id).push(a.id); }
  else if (a.all) ALLR.push(a);
  else if (a.stat) { if (!STAT.has(a.stat[0])) STAT.set(a.stat[0], []); STAT.get(a.stat[0]).push(a); }
}
const fl = Math.floor, MAX_KEYS = 160;

// What is read back from a save (also used to clean an imported player record): only known achievements and sane counters survive.
export function cleanAch(raw) {
  const d = {}, s = {};
  if (raw && typeof raw === 'object') {
    for (const [k, t] of Object.entries(raw.d && typeof raw.d === 'object' ? raw.d : {})) if (BY_ID.has(k) && Number.isFinite(t)) d[k] = Math.round(t);
    let n = 0;
    for (const [k, v] of Object.entries(raw.s && typeof raw.s === 'object' ? raw.s : {})) if (n < MAX_KEYS && /^[a-z0-9:_]{1,40}$/.test(k) && Number.isFinite(v) && v >= 0) { s[k] = Math.min(1e9, Math.round(v * 10) / 10); n++; }
  }
  return { d, s };
}
export const loadAch = (p, raw) => { p.ach = cleanAch(raw); p.achChat = []; p.evts = []; p.achLast = null; p.achAcc = 0; p.achT = 0; p.achMin = 0; p.achLow = false; p.achNight = false; };
export const saveAch = (p) => p.ach || { d: {}, s: {} };
export const sendAch = (p) => send(p.ws, { t: 'achall', d: p.ach.d, s: p.ach.s });

export function award(room, p, id) {
  if (!p.ach || room.mode === 'creative') return;
  const a = BY_ID.get(id);
  if (!a || p.ach.d[id]) return;
  p.ach.d[id] = Date.now();
  send(p.ws, { t: 'ach', id });
  const now = Date.now(); p.achChat = p.achChat.filter((t) => now - t < 6000);
  if (p.achChat.length < 3) { p.achChat.push(now); sys(room, `${p.name} has made the achievement [${a.name}]`); } // (a burst of unlocks is only announced three at a time)
  if (room.markDirty) room.markDirty();
  if (id !== 'all_done' && Object.keys(p.ach.d).length >= ACH.length - 1) award(room, p, 'all_done');
}
export function bump(room, p, key, n = 1) {
  if (!p.ach || room.mode === 'creative' || !(n > 0)) return;
  const v = (p.ach.s[key] = (p.ach.s[key] || 0) + n);
  const list = STAT.get(key); if (!list) return;
  for (const a of list) if (v >= a.stat[1]) award(room, p, a.id);
}

/* ---------- things that happen ---------- */
export function onBreak(room, p, id) { bump(room, p, 'brk'); for (const g of breakGroups(id)) bump(room, p, `brk:${g}`); }
export function onPlace(room, p, id) { bump(room, p, 'place'); for (const g of placeGroups(id)) bump(room, p, `place:${g}`); }
export function onEat(room, p, id) { bump(room, p, 'eat'); bump(room, p, `eat:${id}`); }
export function onDie(room, p) { bump(room, p, 'deaths'); p.achLow = false; }
const HURT = new Set(['cactus', 'fall', 'lava', 'drown', 'arrow', 'boom', 'suffocate']);
export function onHurt(room, p, amt, src) {
  bump(room, p, 'hurt', amt);
  if (src && HURT.has(src.kind)) award(room, p, `hurt_${src.kind}`);
  if (p.hp > 0 && p.hp <= 1) award(room, p, 'close_call');
  if (p.hp > 0 && p.hp <= 8) p.achLow = true;
}
const HOSTILE = new Set(['zombie', 'skeleton', 'spider', 'boomer', 'slime', 'pirate']);
export function onKill(room, p, m) { bump(room, p, 'kills'); bump(room, p, `kill:${m.type}`); if (HOSTILE.has(m.type)) bump(room, p, 'hostile'); }
export function onFish(room, p, type) { bump(room, p, 'fish'); award(room, p, type === 'tropical' ? 'fish_tropical' : 'fish_salmon'); }

// Everything the player has on them: unlocks "get X" and "have all of these".
export function scanInv(room, p) {
  if (!p.ach || room.mode === 'creative') return;
  const have = new Set();
  for (const st of p.inv) if (st) have.add(st.id);
  for (const st of p.armor) if (st) have.add(st.id);
  if (p.off) have.add(p.off.id); if (p.cursor) have.add(p.cursor.id);
  for (const id of have) { const l = HAVE.get(id); if (l) for (const a of l) award(room, p, a); }
  for (const a of ALLR) if (!p.ach.d[a.id] && a.all.every((id) => have.has(id))) award(room, p, a.id);
  if (p.inv.every(Boolean)) award(room, p, 'full_inv');
  for (const st of p.armor) if (st && st.id >= 310 && st.id <= 325) { const mat = (st.id - 310) & 3; if (mat === 1) award(room, p, 'iron_gear'); if (mat === 3) award(room, p, 'diamond_gear'); } // (worn armor)
}

// Called every server tick for every player.
export function tickAch(room, p, dt) {
  if (!p.ach || room.mode === 'creative') return;
  if (p.evts.length) { for (const [k, id, n] of p.evts.splice(0)) { if (k === 'c') { bump(room, p, 'crafted', n); if (id === I.COOKIE) bump(room, p, `craft:${id}`, n); } else bump(room, p, 'smelted', n); } }
  if (p.dirtyInv) scanInv(room, p);
  if (p.dead) { p.achLast = null; return; }
  const L = p.achLast; p.achLast = { x: p.x, z: p.z };
  if (L && !p.sleep) {
    const d = Math.hypot(p.x - L.x, p.z - L.z);
    if (d > 0 && d < 3) { // (a teleport is not walking)
      p.achAcc += d;
      if (p.achAcc >= 1) { const m = fl(p.achAcc); p.achAcc -= m; if (p.boat) bump(room, p, 'boatm', m); else if (isWater(blockAt(room, fl(p.x), fl(p.y + 0.3), fl(p.z), false))) bump(room, p, 'swim', m); else bump(room, p, 'walk', m); }
    }
  }
  if ((p.achMin += dt) >= 60) { p.achMin -= 60; bump(room, p, 'mins', 1); }
  if ((p.achT += dt) < 1.5) return;
  p.achT = 0;
  const b = biomeKind(fl(p.x), fl(p.z), room.seed, room.gen);
  if (BIOME_NAMES[b]) { award(room, p, `biome${b}`); if (BIOME_NAMES.every((_, i) => p.ach.d[`biome${i}`])) award(room, p, 'all_biomes'); }
  if (p.y >= 150) award(room, p, 'high'); if (p.y >= 190) award(room, p, 'sky');
  if (p.y <= 25) award(room, p, 'deep'); if (p.y <= 3) award(room, p, 'bottom');
  const sp = room.spawn, far = sp ? Math.hypot(p.x - sp.x, p.z - sp.z) : 0;
  if (far >= 1000) award(room, p, 'far1000'); if (far >= 5000) award(room, p, 'far5000'); if (far >= 20000) award(room, p, 'far20000');
  if (p.food <= 0) award(room, p, 'starve');
  if (p.achLow && p.hp >= 20) { p.achLow = false; award(room, p, 'regen'); }
  const night = isNightTick(tickAt(Date.now() - room.created));
  if (night && !p.sleep) p.achNight = true; else if (!night && p.achNight) { p.achNight = false; award(room, p, 'night'); }
}
