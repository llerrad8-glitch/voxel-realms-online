// Server-side creatures, dropped items, arrows and explosions. Everything here is authoritative; clients only draw it.
import { seaOf, CH, column, biomeKind, isPlant, isLayer, blockHeight } from '../public/shared/world.js';
import { B, isWater, isLava, isSolid, flowDir, waterHeight } from '../public/shared/world.js';
import { I, blockDrops, toolId } from '../public/shared/items.js';
import { MOBS, MOB_TYPES, mobDims, TROPICAL_LOOKS } from '../public/shared/mobs.js';
import { clone, mk, addToInv, tickFurnace } from './inventory.js';
import { blockAt, setEdit, solidAt, boxHitsSolid, floorY, exposedToSky, lineClear, claimAt, touchClaim } from './world.js';
import { send, broadcast } from './net.js';
import { damagePlayer, breakContainer } from './survival.js';

const rnd = Math.random, r2 = (v) => Math.round(v * 100) / 100, fl = Math.floor;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ARROW_G = 14;

export const isNight = (room) => Math.sin((((Date.now() - room.created) % room.dayMs) / room.dayMs) * 6.2832) < -0.1;

/* ---------- dropped items ---------- */
export function spawnItem(room, st, x, y, z, vel, delay = 0.5) {
  if (!st || st.n <= 0) return;
  if (room.items.size > 300) room.items.delete(room.items.keys().next().value);
  const id = ++room.entId;
  room.items.set(id, { id, st: clone(st), x, y, z, vx: vel ? vel[0] : (rnd() - 0.5) * 2, vy: vel ? vel[1] : 3 + rnd() * 1.5, vz: vel ? vel[2] : (rnd() - 0.5) * 2, age: 0, delay });
}
function tickItems(room, dt) {
  for (const it of room.items.values()) {
    it.age += dt; it.delay -= dt;
    if (it.age > 300 || it.y < -10) { room.items.delete(it.id); continue; }
    const cx = fl(it.x), cz = fl(it.z), cy = fl(it.y + 0.1), wid = blockAt(room, cx, cy, cz, false);
    if (isLava(wid) || isLava(blockAt(room, cx, fl(it.y), cz, false))) { room.items.delete(it.id); continue; } // lava burns dropped items
    if (isWater(wid)) { // items float: they rise to the surface, bob there, and drift along with flowing water
      if (isWater(blockAt(room, cx, cy + 1, cz, false))) it.vy = Math.min(1.4, it.vy + 16 * dt);
      else it.vy += ((cy + waterHeight(wid) - 0.1 - it.y) * 30 - it.vy * 5) * dt;
      const k = Math.min(1, 2.5 * dt); it.vx -= it.vx * k; it.vz -= it.vz * k;
      const [fx, fz] = flowDir((x, y, z) => blockAt(room, x, y, z, false), cx, cy, cz);
      it.vx += fx * 3.2 * dt; it.vz += fz * 3.2 * dt;
    } else it.vy = Math.max(-30, it.vy - 22 * dt);
    const nx = it.x + it.vx * dt; if (boxHitsSolid(room, nx, it.y, it.z, 0.25, 0.25)) it.vx = 0; else it.x = nx;
    const nz = it.z + it.vz * dt; if (boxHitsSolid(room, it.x, it.y, nz, 0.25, 0.25)) it.vz = 0; else it.z = nz;
    const ny = it.y + it.vy * dt;
    if (boxHitsSolid(room, it.x, ny, it.z, 0.25, 0.25)) { if (it.vy < 0) { it.vx *= 0.5; it.vz *= 0.5; } it.vy = 0; } else it.y = ny;
    if (it.delay > 0) continue;
    for (const p of room.players.values()) {
      if (p.dead) continue;
      const dx = p.x - it.x, dz = p.z - it.z, dy = it.y - p.y;
      if (dx * dx + dz * dz > 2.25 || dy < -1.3 || dy > 2.3) continue; // roughly the player's body grown by a block, like the real game
      const left = addToInv(p.inv, it.st);
      if (left < it.st.n) { it.st.n = left; p.dirtyInv = true; p.dirtyEq = true; }
      if (!left) { room.items.delete(it.id); break; }
    }
  }
}

/* ---------- arrows ---------- */
export function spawnArrow(room, owner, x, y, z, vx, vy, vz, dmg) {
  const id = ++room.entId;
  room.arrows.set(id, { id, owner, x, y, z, vx, vy, vz, dmg, age: 0 });
}
function tickArrows(room, dt) {
  for (const a of room.arrows.values()) {
    a.age += dt;
    if (a.age > 10) { room.arrows.delete(a.id); continue; }
    let dead = false;
    for (let s = 0; s < 2 && !dead; s++) {
      const h = dt / 2;
      a.vy -= ARROW_G * h;
      a.x += a.vx * h; a.y += a.vy * h; a.z += a.vz * h;
      if (solidAt(room, fl(a.x), fl(a.y), fl(a.z))) { dead = true; break; }
      const sp = Math.hypot(a.vx, a.vy, a.vz) || 1, kb = [(a.vx / sp) * 4, 3, (a.vz / sp) * 4];
      for (const p of room.players.values()) {
        if (p.dead || (a.owner.kind === 'p' && a.owner.id === p.id) || room.mode === 'creative') continue;
        if (a.owner.kind === 'p' && !room.pvp) continue;
        if (Math.abs(a.x - p.x) < 0.45 && Math.abs(a.z - p.z) < 0.45 && a.y > p.y - 0.1 && a.y < p.y + 1.9) {
          damagePlayer(room, p, a.dmg, { kind: 'arrow', name: a.owner.name }, kb); dead = true; break;
        }
      }
      if (dead || a.owner.kind === 'm') continue;
      for (const m of room.mobs.values()) {
        const d = mobDims(m.type, m.size);
        if (Math.abs(a.x - m.x) < d.w / 2 + 0.15 && Math.abs(a.z - m.z) < d.w / 2 + 0.15 && a.y > m.y - 0.1 && a.y < m.y + d.h + 0.1) {
          hurtMob(room, m, a.dmg, a.owner.ref, kb); dead = true; break;
        }
      }
    }
    if (dead) room.arrows.delete(a.id);
  }
}

/* ---------- explosions ---------- */
// How much of a body the blast can actually reach: three points (feet, middle, head) are tested for a clear line to the centre. Walls stop it.
function exposure(room, c, x, y, z, h) {
  let n = 0;
  for (const f of [0.15, 0.5, 0.9]) if (lineClear(room, c, [x, y + h * f, z], true)) n++;
  return n / 3;
}
// Can a blast at (x, y, z) reach the block at (bx, by, bz)? The line stops at the first solid block that is not the target itself.
function blastSees(room, x, y, z, bx, by, bz) {
  const dx = bx + 0.5 - x, dy = by + 0.5 - y, dz = bz + 0.5 - z, n = Math.ceil(Math.hypot(dx, dy, dz) / 0.4);
  for (let i = 1; i < n; i++) {
    const t = i / n, cx = fl(x + dx * t), cy = fl(y + dy * t), cz = fl(z + dz * t);
    if (cx === bx && cy === by && cz === bz) return true; // reached the target's own cell
    if (isSolid(blockAt(room, cx, cy, cz))) return false;
  }
  return true;
}
export function explode(room, x, y, z, radius, name) {
  const changes = [], pick = toolId('pickaxe', 4), R = Math.ceil(radius), centre = [x, y, z];
  // Everything is judged against the world as it was a moment ago (before any block is removed), so a wall protects what is behind it.
  const hurt = [];
  const reach = radius * 2.2;
  for (const p of room.players.values()) {
    const dx = p.x - x, dy = p.y + 0.9 - y, dz = p.z - z, d = Math.hypot(dx, dy, dz);
    if (d < reach && !p.dead) { const e = exposure(room, centre, p.x, p.y, p.z, 1.8); if (e > 0) hurt.push(['p', p, dx, dy, dz, d, e]); }
  }
  for (const m of room.mobs.values()) {
    const dx = m.x - x, dy = m.y + 0.5 - y, dz = m.z - z, d = Math.hypot(dx, dy, dz), dm = mobDims(m.type, m.size);
    if (d < reach) { const e = exposure(room, centre, m.x, m.y, m.z, dm.h); if (e > 0) hurt.push(['m', m, dx, dy, dz, d, e]); }
  }
  for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
    const d = Math.hypot(dx, dy, dz);
    if (d > radius || (d > radius * 0.75 && rnd() < 0.4)) continue;
    const bx = fl(x) + dx, by = fl(y) + dy, bz = fl(z) + dz;
    if (by < 1 || by > CH - 2 || claimAt(room, bx, bz)) continue; // protected chunks are never damaged by explosions
    const id = blockAt(room, bx, by, bz);
    if (id <= 0 || id === B.BEDROCK || isWater(id)) continue;
    if (d > 0.9 && !blastSees(room, x, y, z, bx, by, bz)) continue; // blocks hidden behind other blocks survive: it cannot blast through a wall
    if (id === B.CHEST || id === B.FURNACE) breakContainer(room, bx, by, bz);
    if (rnd() < 0.3) for (const [item, n] of blockDrops(id, { id: pick })) spawnItem(room, mk(item, n), bx + 0.5, by + 0.5, bz + 0.5);
    setEdit(room, bx, by, bz, 0); changes.push(bx, by, bz, 0);
  }
  if (changes.length) { broadcast(room, { t: 'blks', b: changes }); room.markDirty(); }
  broadcast(room, { t: 'fx', k: 'boom', x: r2(x), y: r2(y), z: r2(z) });
  for (const [kind, e, dx, dy, dz, d, ex] of hurt) {
    const dmg = Math.max(0, 1 - d / reach) * 24 * ex;
    if (kind === 'p') { if (!e.dead) damagePlayer(room, e, dmg, { kind: 'boom', name }, [(dx / (d || 1)) * 7 * ex, 5 * ex, (dz / (d || 1)) * 7 * ex]); }
    else if (room.mobs.has(e.id)) hurtMob(room, e, dmg, null, [(dx / (d || 1)) * 6 * ex, 4 * ex, (dz / (d || 1)) * 6 * ex]);
  }
}

/* ---------- mobs ---------- */
export function spawnMob(room, type, x, y, z, o = {}) {
  const def = MOBS[type], size = type === 'slime' || type === 'tropical' ? o.size || 1 : 1;
  const hp = type === 'slime' ? [0, 2, 6, 16][size] : def.hp;
  const m = {
    id: ++room.entId, type, x, y, z, vx: 0, vy: 0, vz: 0, yaw: rnd() * 6.28, hp, max: hp, size, ground: false,
    aux: type === 'sheep' ? (rnd() < 0.78 ? 0 : 1 + ((rnd() * 3) | 0)) : 0,
    aiT: rnd() * 3, wx: 0, wz: 0, dx: 0, dz: 0, moving: false, hurtT: 0, atkT: 1, fuse: 0, burnT: 0, burn: false, fleeT: 0, anger: 0, angerBy: 0,
    fy: 0, pitch: 0, sp: 0.6, wet: true, dryT: 0, tame: false, owner: 0, ownerTh: '', sit: false,
    arrowT: 1.5 + rnd(), shootT: 0, hopT: 0, leapT: 0, blockedT: 0, bias: 0, biasT: 0, strafe: rnd() < 0.5 ? 1 : -1, strafeT: 2, swing: 0,
  };
  room.mobs.set(m.id, m);
  return m;
}
export function hurtMob(room, m, dmg, by, kb) {
  if (!room.mobs.has(m.id)) return;
  const def = MOBS[m.type];
  m.hp -= dmg; m.hurtT = 0.4;
  if (kb) { m.vx = kb[0]; m.vy = kb[1]; m.vz = kb[2]; m.ground = false; }
  if (by && by.x !== undefined && !m.tame) { // (a tame wolf never turns on anyone)
    if (def.kind === 'passive') { m.fleeT = 4; m.fromX = by.x; m.fromZ = by.z; }
    else {
      m.anger = 25; m.angerBy = by.id;
      if (m.type === 'wolf') for (const o of room.mobs.values()) if (o !== m && o.type === 'wolf' && !o.tame && Math.hypot(o.x - m.x, o.z - m.z) < 18 && Math.abs(o.y - m.y) < 12) { o.anger = 25; o.angerBy = by.id; } // hit a wolf and every wild wolf nearby comes for you too
    }
  }
  if (m.hp <= 0) killMob(room, m);
}
function killMob(room, m) {
  room.mobs.delete(m.id);
  const def = MOBS[m.type];
  for (const [item, a, b, ch = 1] of def.drops) if (rnd() < ch) { const n = a + ((rnd() * (b - a + 1)) | 0); if (n > 0) spawnItem(room, mk(item, n), m.x, m.y + 0.4, m.z); }
  if (m.type === 'slime' && m.size === 1 && rnd() < 0.7) spawnItem(room, mk(I.SLIME, 1 + ((rnd() * 2) | 0)), m.x, m.y + 0.3, m.z);
  broadcast(room, { t: 'fx', k: 'die', ty: MOB_TYPES.indexOf(m.type), x: r2(m.x), y: r2(m.y), z: r2(m.z), yaw: r2(m.yaw), sz: m.size, aux: m.aux });
  if (m.type === 'slime' && m.size > 1) for (let i = 0, n = 2 + ((rnd() * 3) | 0); i < n; i++) spawnMob(room, 'slime', m.x + (rnd() - 0.5), m.y + 0.3, m.z + (rnd() - 0.5), { size: m.size - 1 });
}


/* ---------- fish ---------- */
// Salmon swim around inside water (never leaving it on their own), flee when hurt, and flop around and slowly suffocate on land.
function thinkFish(room, m, dt) {
  const def = MOBS[m.type];
  m.hurtT = Math.max(0, m.hurtT - dt); m.fleeT = Math.max(0, m.fleeT - dt);
  m.wet = isWater(blockAt(room, fl(m.x), fl(m.y + 0.2), fl(m.z), false));
  if (!m.wet) {
    m.wx = m.wz = 0;
    if ((m.dryT += dt) >= 1) { m.dryT = 0; hurtMob(room, m, 1, null); if (!room.mobs.has(m.id)) return; }
    if (m.ground && (m.hopT -= dt) <= 0) { m.hopT = 0.4 + rnd() * 0.6; m.vy = 4; m.vx = (rnd() - 0.5) * 2.4; m.vz = (rnd() - 0.5) * 2.4; m.ground = false; }
    return;
  }
  m.dryT = 0;
  if (m.lureTo && Date.now() - m.lureAt > 500) m.lureTo = null; // the hook is gone
  if (m.lureTo && m.fleeT <= 0) { // a fishing hook is in the water nearby: swim over to it
    const [lx, ly, lz] = m.lureTo, dx = lx - m.x, dz = lz - m.z, dy = ly - m.y, hd = Math.hypot(dx, dz), d = Math.hypot(hd, dy);
    m.fy = Math.atan2(-dx, -dz); m.pitch = Math.max(-0.6, Math.min(0.6, Math.atan2(dy, Math.max(hd, 0.3)))); m.sp = d < 1.3 ? 0.12 : d < 3 ? 0.5 : 1; m.aiT = 0.4;
    return;
  }
  if (m.fleeT > 0) { m.fy = Math.atan2(-(m.x - m.fromX), -(m.z - m.fromZ)); m.sp = 1; }
  else if ((m.aiT -= dt) <= 0) { m.aiT = 1.5 + rnd() * 3.5; m.fy = rnd() * 6.2832; m.pitch = (rnd() - 0.5) * 0.7; m.sp = rnd() < 0.2 ? 0.25 : 0.6 + rnd() * 0.4; }
}
function moveFish(room, m, dt) {
  const { w, h } = mobDims(m.type), def = MOBS[m.type];
  m.yaw += wrap(m.fy - m.yaw) * Math.min(1, 4 * dt);
  const sp = def.speed * (m.fleeT > 0 ? 2.2 : 1) * m.sp, hv = Math.cos(m.pitch);
  const vx = -Math.sin(m.yaw) * sp * hv, vz = -Math.cos(m.yaw) * sp * hv, vy = Math.sin(m.pitch) * sp;
  const lx = m.x + vx * 0.6, ly = m.y + 0.2 + vy * 0.6, lz = m.z + vz * 0.6;
  if (!isWater(blockAt(room, fl(lx), fl(ly), fl(lz), false)) || boxHitsSolid(room, lx, ly - 0.2, lz, w, h)) { // a wall, the surface or the sea floor ahead: turn around
    m.fy = m.yaw + (rnd() < 0.5 ? 1 : -1) * Math.PI * (0.55 + rnd() * 0.9); m.pitch = -m.pitch * 0.5; m.aiT = 1.2; m.vx = m.vy = m.vz = 0;
  } else {
    m.vx = vx; m.vy = vy; m.vz = vz;
    const nx = m.x + vx * dt, ny = m.y + vy * dt, nz = m.z + vz * dt;
    if (!boxHitsSolid(room, nx, m.y, m.z, w, h)) m.x = nx;
    if (!boxHitsSolid(room, m.x, m.y, nz, w, h)) m.z = nz;
    if (!boxHitsSolid(room, m.x, ny, m.z, w, h)) m.y = ny;
  }
  const cy = fl(m.y + 0.2), top = cy + waterHeight(blockAt(room, fl(m.x), cy, fl(m.z), false)) - 0.4; // stay under the surface
  if (!isWater(blockAt(room, fl(m.x), cy + 1, fl(m.z), false)) && m.y > top) { m.y = top; if (m.pitch > 0) m.pitch = -0.15; }
  m.ground = false; m.moving = true;
  m.aux = Math.round(m.pitch * 57.3);
}
function spawnFish(room, p) {
  for (let tries = 0; tries < 6; tries++) {
    const a = rnd() * 6.2832, d = 10 + rnd() * 30, x = fl(p.x + Math.cos(a) * d), z = fl(p.z + Math.sin(a) * d), sea = seaOf(room.gen), depth0 = sea - column(x, z, room.seed, room.gen).h;
    if (depth0 < 3) continue; // natural water only, and deep enough to swim in
    const type = depth0 >= 4 && rnd() < 0.6 ? 'tropical' : 'salmon'; // the open sea is full of tropical fish; salmon live in rivers and the sea alike
    let near = 0;
    for (const m of room.mobs.values()) if (m.type === type && Math.hypot(m.x - p.x, m.z - p.z) < 64) near++;
    if (near >= (type === 'tropical' ? 14 : 8)) return;
    const look = 1 + ((rnd() * TROPICAL_LOOKS) | 0); // a school shares one colour pattern, with the odd stray
    for (let i = 0, n = type === 'tropical' ? 3 + ((rnd() * 4) | 0) : 2 + ((rnd() * 3) | 0); i < n; i++) { // a small school
      const bx = x + ((rnd() * 7) | 0) - 3, bz = z + ((rnd() * 7) | 0) - 3, c = column(bx, bz, room.seed, room.gen), depth = sea - c.h;
      if (depth < 3) continue;
      const by = c.h + 1.5 + rnd() * (depth - 2.5);
      if (isWater(blockAt(room, bx, fl(by), bz, false)) && isWater(blockAt(room, bx, fl(by) + 1, bz, false))) spawnMob(room, type, bx + 0.5, by, bz + 0.5, { size: rnd() < 0.8 ? look : 1 + ((rnd() * TROPICAL_LOOKS) | 0) });
    }
    return;
  }
}

function face(m, dx, dz, dt) { m.yaw += wrap(Math.atan2(-dx, -dz) - m.yaw) * Math.min(1, 10 * dt); }
function steer(m, dx, dz, speed, dt) {
  let ang = Math.atan2(dz, dx);
  if (m.biasT > 0) ang += m.bias;
  m.wx = Math.cos(ang) * speed; m.wz = Math.sin(ang) * speed;
  face(m, m.wx, m.wz, dt);
}
const stop = (m) => { m.wx = 0; m.wz = 0; };

function wander(m, def, dt, speed) {
  m.aiT -= dt;
  if (m.aiT <= 0) {
    if (rnd() < 0.4) { m.moving = false; m.aiT = 2 + rnd() * 4; }
    else { const a = rnd() * 6.2832; m.dx = Math.cos(a); m.dz = Math.sin(a); m.moving = true; m.aiT = 1.5 + rnd() * 3; }
  }
  if (m.moving) steer(m, m.dx, m.dz, speed, dt); else stop(m);
}

function nearestPlayer(room, m, range) {
  let best = null, bd = range * range;
  for (const p of room.players.values()) {
    if (p.dead || room.mode === 'creative') continue;
    const dx = p.x - m.x, dz = p.z - m.z, dy = p.y - m.y, d = dx * dx + dz * dz + dy * dy * 0.5;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/* ---------- tame wolves ---------- */
export const TAME_MAX = 6;
export const tamedCount = (room, p) => { let n = 0; for (const m of room.mobs.values()) if (m.tame && m.ownerTh === p.th) n++; n += ((room.tame && room.tame[p.th]) || []).length; return n; };
// A tame wolf follows its owner (and hurries or jumps to them when far behind), sits when told to, and fights what attacks them: monsters close to the owner
// (but not a boomer) and whatever the owner last hit.
function thinkPet(room, m, dt) {
  const def = MOBS.wolf;
  m.hurtT = Math.max(0, m.hurtT - dt); m.atkT = Math.max(0, m.atkT - dt); m.swing = Math.max(0, m.swing - dt); m.biasT = Math.max(0, m.biasT - dt);
  const owner = room.players.get(m.owner);
  if (!owner || owner.dead) { stop(m); return; }
  if (m.sit) { stop(m); return; }
  const odx = owner.x - m.x, odz = owner.z - m.z, od = Math.hypot(odx, odz);
  if (od > 26 || Math.abs(owner.y - m.y) > 14) { // too far behind: it appears beside its owner
    for (let k = 0; k < 8; k++) {
      const a = rnd() * 6.2832, x = owner.x + Math.cos(a) * 2, z = owner.z + Math.sin(a) * 2, y = owner.y + 0.1;
      if (!boxHitsSolid(room, x, y, z, 0.6, 0.85)) { m.x = x; m.y = y; m.z = z; m.vx = m.vy = m.vz = 0; return; }
    }
    return;
  }
  let tgt = null, best = 1e9;
  const hitRecent = owner.hitMob && Date.now() - (owner.hitMobAt || 0) < 8000 ? room.mobs.get(owner.hitMob) : null;
  if (hitRecent && hitRecent.id !== m.id && !(hitRecent.tame && hitRecent.ownerTh === m.ownerTh) && Math.hypot(hitRecent.x - m.x, hitRecent.z - m.z) < 18) tgt = hitRecent;
  else for (const o of room.mobs.values()) {
    if (o === m || MOBS[o.type].kind !== 'hostile' || o.type === 'boomer') continue;
    const d = Math.hypot(o.x - owner.x, o.z - owner.z);
    if (d < 12 && d < best) { best = d; tgt = o; }
  }
  if (tgt) {
    const dx = tgt.x - m.x, dz = tgt.z - m.z, dist = Math.hypot(dx, dz), dy = tgt.y - m.y;
    if (dist > 0.9) steer(m, dx, dz, def.speed * 1.1, dt); else { stop(m); face(m, dx, dz, dt); }
    if (dist < 1.7 && Math.abs(dy) < 1.7 && m.atkT <= 0) { m.atkT = 0.8; m.swing = 0.4; hurtMob(room, tgt, 4, null, [(dx / (dist || 1)) * 4, 3.5, (dz / (dist || 1)) * 4]); }
    return;
  }
  if (od > 3.5) steer(m, odx, odz, def.speed * (od > 10 ? 1.25 : 0.9), dt);
  else if (od < 1.6) { stop(m); face(m, odx, odz, dt); }
  else stop(m);
}
// Tame wolves are kept with their owner: stored when the owner leaves, put back beside them when they return.
export function stashWolves(room, p) {
  const list = [];
  for (const m of [...room.mobs.values()]) if (m.tame && m.ownerTh === p.th) { list.push({ hp: Math.ceil(m.hp), sit: !!m.sit, col: m.aux | 0 }); room.mobs.delete(m.id); }
  if (list.length) { (room.tame ||= {})[p.th] = [...((room.tame && room.tame[p.th]) || []), ...list].slice(0, TAME_MAX); }
}
export function restoreWolves(room, p) {
  const list = room.tame && room.tame[p.th];
  if (!list || !list.length) return;
  delete room.tame[p.th];
  for (const w of list.slice(0, TAME_MAX)) {
    const m = spawnMob(room, 'wolf', p.x + (rnd() - 0.5) * 3, p.y + 0.3, p.z + (rnd() - 0.5) * 3);
    Object.assign(m, { tame: true, owner: p.id, ownerTh: p.th, sit: !!w.sit, aux: (w.col | 0) % 7, max: 20, hp: Math.max(1, Math.min(20, w.hp | 0 || 20)) });
  }
}
export const wolvesToSave = (room) => {
  const out = {};
  for (const [th, list] of Object.entries(room.tame || {})) out[th] = list.map((w) => ({ hp: w.hp | 0, sit: !!w.sit, col: w.col | 0 }));
  for (const m of room.mobs.values()) if (m.tame && m.ownerTh) (out[m.ownerTh] ||= []).push({ hp: Math.ceil(m.hp), sit: !!m.sit, col: m.aux | 0 });
  return out;
};

/* ---------- boats ---------- */
// The rider's game drives the boat (like their own walking); the server follows the rider and keeps boats nobody sits in afloat.
export function freeBoat(room, p) {
  if (!p || !p.boat) return;
  const b = room.boats.get(p.boat);
  if (b && b.rider === p.id) b.rider = 0;
  p.boat = 0;
  send(p.ws, { t: 'unride' });
}
export function syncBoat(room, p, yaw) {
  const b = room.boats.get(p.boat);
  if (!b || b.rider !== p.id) { p.boat = 0; send(p.ws, { t: 'unride' }); return; }
  b.x = p.x; b.z = p.z; b.y = p.y - 0.35; b.bw = Number.isFinite(yaw) ? yaw : b.bw; b.yaw = b.bw;
}
function tickBoats(room, dt) {
  for (const b of room.boats.values()) {
    if (b.rider) { const r = room.players.get(b.rider); if (!r || r.dead || r.boat !== b.id) { b.rider = 0; } else continue; }
    const cx = fl(b.x), cz = fl(b.z);
    let cy = fl(b.y + 0.3);
    if (isWater(blockAt(room, cx, cy, cz, false))) { // afloat: ride the water's surface and drift with a current
      while (isWater(blockAt(room, cx, cy + 1, cz, false))) cy++;
      const top = cy + waterHeight(blockAt(room, cx, cy, cz, false)) - 0.2;
      b.y += (top - b.y) * Math.min(1, 6 * dt);
      const [fx, fz] = flowDir((x, y, z) => blockAt(room, x, y, z, false), cx, cy, cz);
      if (fx || fz) { const nx = b.x + fx * 1.2 * dt, nz = b.z + fz * 1.2 * dt; if (!boxHitsSolid(room, nx, b.y, nz, 1.2, 0.5)) { b.x = nx; b.z = nz; } }
    } else if (!boxHitsSolid(room, b.x, b.y - 0.2, b.z, 1.2, 0.3)) b.y -= 8 * dt; // out of the water: it falls to the ground
    if (b.y < -20) room.boats.delete(b.id);
  }
}


function think(room, m, dt, night) {
  const def = MOBS[m.type];
  if (m.tame) return thinkPet(room, m, dt);
  m.hurtT = Math.max(0, m.hurtT - dt); m.atkT = Math.max(0, m.atkT - dt); m.shootT = Math.max(0, m.shootT - dt); m.swing = Math.max(0, m.swing - dt);
  m.biasT = Math.max(0, m.biasT - dt); m.anger = Math.max(0, m.anger - dt);
  if (def.burns) {
    const sun = !night && exposedToSky(room, fl(m.x), fl(m.y + 1), fl(m.z)) && !isWater(blockAt(room, fl(m.x), fl(m.y + 0.3), fl(m.z), false));
    m.burn = sun;
    if (sun && (m.burnT += dt) >= 1) { m.burnT = 0; hurtMob(room, m, 1, null, null); if (!room.mobs.has(m.id)) return; }
  }
  if (m.fleeT > 0) { // passive animals bolt away from whatever hurt them
    m.fleeT -= dt;
    steer(m, m.x - (m.fromX ?? m.x - 1), m.z - (m.fromZ ?? m.z), def.speed * 2, dt);
    return;
  }
  let tgt = null;
  if (def.kind === 'hostile') tgt = nearestPlayer(room, m, def.sight);
  else if (def.kind === 'neutral' && m.anger > 0) tgt = room.players.get(m.angerBy) || null;
  if (tgt && (tgt.dead || room.mode === 'creative')) tgt = null;
  if (m.type === 'boomer') { // a creeper only notices you with a clear line of sight; it keeps hunting for a couple of seconds after losing you, then gives up
    m.seenT = Math.max(0, (m.seenT || 0) - dt);
    if (tgt) { if (lineClear(room, [m.x, m.y + 1.4, m.z], [tgt.x, tgt.y + 1.5, tgt.z], true)) { m.seenT = 2.5; m.seenBy = tgt.id; } else if (!(m.seenT > 0 && m.seenBy === tgt.id)) tgt = null; }
  }
  if (m.type === 'spider' && !night && !m.anger && !(tgt && tgt.hurtSpiderUntil > Date.now())) tgt = null; // calm in daylight unless provoked
  if (!tgt) {
    m.fuse = Math.max(0, m.fuse - dt); m.lit = false;
    wander(m, def, dt, def.speed * (def.kind === 'hostile' ? 0.45 : 0.6));
    if (def.hop) { m.hopT -= dt; if (m.moving && m.ground && m.hopT <= 0) { m.vy = m.type === 'slime' ? 6 : 5; m.hopT = m.type === 'slime' ? 1.6 : 0.5; } if (!m.moving) stop(m); }
    return;
  }
  const dx = tgt.x - m.x, dz = tgt.z - m.z, dy = tgt.y - m.y, dist = Math.hypot(dx, dz), nx = dx / (dist || 1), nz = dz / (dist || 1);
  const kb = [nx * 5.5, 4.5, nz * 5.5];
  const hit = (dmg) => { if (damagePlayer(room, tgt, dmg, { kind: 'mob', name: def.name }, kb)) m.swing = 0.4; };
  switch (m.type) {
    case 'zombie':
    case 'wolf':
      if (dist > 0.9) steer(m, dx, dz, def.speed, dt); else { stop(m); face(m, dx, dz, dt); }
      if (dist < 1.6 && Math.abs(dy) < 1.7 && m.atkT <= 0) { hit(def.dmg); m.atkT = m.type === 'wolf' ? 0.9 : 1.0; }
      break;
    case 'spider':
      m.leapT -= dt;
      if (dist > 1.0) steer(m, dx, dz, def.speed, dt); else stop(m);
      if (dist < 4.5 && dist > 1.8 && m.ground && m.leapT <= 0) { m.vy = 6.5; m.vx = nx * 7; m.vz = nz * 7; m.leapT = 1.6; }
      if (dist < 1.9 && Math.abs(dy) < 1.4 && m.atkT <= 0) { hit(def.dmg); m.atkT = 1.0; }
      break;
    case 'slime': {
      const sz = m.size, reach = 0.55 * sz + 0.9;
      face(m, dx, dz, dt); m.hopT -= dt;
      if (m.ground && m.hopT <= 0) { m.vy = 5.5 + sz * 0.6; m.vx = nx * (2.2 + sz * 0.5); m.vz = nz * (2.2 + sz * 0.5); m.hopT = 0.9 + rnd() * 0.6; }
      stop(m);
      if (dist < reach && Math.abs(dy) < 0.55 * sz + 1 && m.atkT <= 0) { hit(sz); m.atkT = 0.8; }
      break;
    }
    case 'skeleton': {
      face(m, dx, dz, dt);
      if (dist > 15) steer(m, dx, dz, def.speed, dt);
      else if (dist < 6) steer(m, -dx, -dz, def.speed, dt);
      else { m.strafeT -= dt; if (m.strafeT <= 0) { m.strafe = -m.strafe; m.strafeT = 2 + rnd() * 2; } steer(m, -nz * m.strafe, nx * m.strafe, def.speed * 0.6, dt); face(m, dx, dz, dt); }
      m.arrowT -= dt;
      const from = [m.x, m.y + 1.55, m.z], to = [tgt.x, tgt.y + 1.1, tgt.z];
      if (m.arrowT <= 0 && dist < 22 && lineClear(room, from, to)) {
        const sp = 26, jx = (rnd() - 0.5) * 1.2, jz = (rnd() - 0.5) * 1.2, ex = to[0] + jx - from[0], ez = to[2] + jz - from[2], ey = to[1] + (rnd() - 0.5) * 0.6 - from[1];
        const t = Math.max(0.15, Math.hypot(ex, ez) / sp);
        spawnArrow(room, { kind: 'm', id: m.id, name: def.name }, from[0], from[1], from[2], ex / t, (ey + 0.5 * ARROW_G * t * t) / t, ez / t, 2 + rnd() * 2);
        m.arrowT = 1.6 + rnd() * 1.2; m.shootT = 0.5;
      }
      break;
    }
    case 'boomer':
      // It lights up when you come within two blocks, and keeps going until you are more than six blocks away (so backing off a little does not save you).
      if (dist <= 2) m.lit = true;
      if (dist > 6 || !lineClear(room, [m.x, m.y + 1.4, m.z], [tgt.x, tgt.y + 1.5, tgt.z], true)) { m.lit = false; m.fuse = 0; } // out of range or a wall between you: the fuse is off
      if (m.lit) { stop(m); face(m, dx, dz, dt); m.fuse += dt; }
      else { m.fuse = Math.max(0, m.fuse - dt * 2); if (dist < def.sight) steer(m, dx, dz, def.speed, dt); }
      if (m.fuse >= 1.5) { room.mobs.delete(m.id); explode(room, m.x, m.y + 0.8, m.z, 3.2, def.name); }
      break;
    default:
      wander(m, def, dt, def.speed);
  }
}

function move(room, m, dt) {
  const { w, h } = mobDims(m.type, m.size), def = MOBS[m.type];
  const a = Math.min(1, (m.ground ? 10 : 1.5) * dt);
  if (!(def.hop && !m.ground)) { m.vx += (m.wx - m.vx) * a; m.vz += (m.wz - m.vz) * a; }
  const wet = isWater(blockAt(room, fl(m.x), fl(m.y + 0.3), fl(m.z), false));
  if (wet) m.vy = Math.min(2.2, m.vy + 14 * dt); else m.vy = Math.max(-40, m.vy - 26 * dt);
  if (m.type === 'chicken' && m.vy < -2) m.vy = -2;
  let blocked = false;
  const stepUp = (tx, tz) => { if (!m.ground) return false; for (let dy = 0.125; dy <= 0.6; dy += 0.125) if (!boxHitsSolid(room, tx, m.y + dy, tz, w, h)) { m.y += dy; return true; } return false; }; // walk up onto a snow or sand layer
  const nx = m.x + m.vx * dt; if (boxHitsSolid(room, nx, m.y, m.z, w, h) && !stepUp(nx, m.z)) { m.vx = 0; blocked = true; } else m.x = nx;
  const nz = m.z + m.vz * dt; if (boxHitsSolid(room, m.x, m.y, nz, w, h) && !stepUp(m.x, nz)) { m.vz = 0; blocked = true; } else m.z = nz;
  const ny = m.y + m.vy * dt;
  if (boxHitsSolid(room, m.x, ny, m.z, w, h)) { if (m.vy < 0) { m.ground = true; m.y = floorY(room, m.x, ny, m.z, w); } m.vy = 0; } else { m.y = ny; m.ground = false; }
  const moving = Math.abs(m.wx) + Math.abs(m.wz) > 0.1;
  if (blocked && moving && !def.hop) {
    if (m.ground) m.vy = 8.6; // hop up a one-block step
    if ((m.blockedT += dt) > 1.2) { m.bias = (rnd() < 0.5 ? 1 : -1) * 1.5; m.biasT = 1.2; m.blockedT = 0; m.aiT = 0; }
  } else m.blockedT = 0;
  if (m.y < -20) room.mobs.delete(m.id);
}

/* ---------- spawning ---------- */
const weigh = (list) => { let t = list.reduce((s, [, w]) => s + w, 0) * rnd(); for (const [v, w] of list) if ((t -= w) <= 0) return v; return list[0][0]; };
const open = (b) => b === 0 || isPlant(b); // grass and flowers do not get in a creature's way
function spawnPassive(room, p) {
  const a = rnd() * 6.2832, d = 20 + rnd() * 24, x = fl(p.x + Math.cos(a) * d), z = fl(p.z + Math.sin(a) * d), { h, k } = column(x, z, room.seed, room.gen);
  if (h <= seaOf(room.gen) + 1 || k === 1) return;
  const ground = blockAt(room, x, h, z, false), lay = blockAt(room, x, h + 1, z, false);
  if (ground <= 0 || isLava(ground) || !(open(lay) || isLayer(lay)) || !open(blockAt(room, x, h + 2, z, false))) return;
  let type;
  if (room.gen >= 7) { // by biome: plains hold herds, the taiga wolves, the tundra rabbits and the odd wolf
    const bio = biomeKind(x + 0.5, z + 0.5, room.seed, room.gen);
    type = bio === 4 ? weigh([['cow', 3], ['sheep', 3], ['pig', 2], ['chicken', 2], ['rabbit', 2], ['wolf', 0.08]])
      : bio === 2 ? weigh([['wolf', 3], ['rabbit', 2], ['sheep', 0.7]])
      : bio === 3 ? weigh([['rabbit', 3], ['wolf', 0.5]])
      : weigh([['pig', 3], ['cow', 2], ['sheep', 2], ['chicken', 2], ['rabbit', 2], ['wolf', 0.9]]);
  } else type = k === 2 ? (rnd() < 0.5 ? 'wolf' : 'rabbit') : weigh([['pig', 3], ['cow', 3], ['sheep', 3], ['chicken', 2], ['rabbit', 2], ['wolf', 0.25]]);
  for (let i = 0, n = type === 'wolf' ? 2 + ((rnd() * 3) | 0) : 2 + ((rnd() * 3) | 0); i < n; i++) {
    const bx = x + ((rnd() * 5) | 0) - 2, bz = z + ((rnd() * 5) | 0) - 2, c = column(bx, bz, room.seed, room.gen), g = blockAt(room, bx, c.h, bz, false), l = blockAt(room, bx, c.h + 1, bz, false);
    if (c.h > seaOf(room.gen) + 1 && g > 0 && !isLava(g) && (open(l) || isLayer(l)) && open(blockAt(room, bx, c.h + 2, bz, false))) spawnMob(room, type, bx + 0.5, c.h + 1.01 + (isLayer(l) ? blockHeight(l) : 0), bz + 0.5);
  }
}
// Hostile creatures need darkness. At night anywhere outside a torch's glow will do; by day only the dark parts of caves count
// (covered by several blocks of rock and with no torch or lava close by). Creepers (boomers) are the exception, but only just: by day they are very rare (and rarer in dark caves than at night).
function glowNear(room, x, y, z) { // a torch or lava within 7 blocks lights the place up
  for (let dy = -3; dy <= 3; dy++) for (let dz = -7; dz <= 7; dz++) for (let dx = -7; dx <= 7; dx++) {
    const b = blockAt(room, x + dx, y + dy, z + dz, false);
    if ((b >= 31 && b <= 35) || isLava(b)) return true;
  }
  return false;
}
function deepDark(room, x, y, z) { // roofed by at least 4 blocks of solid material
  let roof = 0;
  for (let yy = y + 2; yy < CH; yy++) { const b = blockAt(room, x, yy, z, false); if (b > 0 && isSolid(b)) { if (++roof >= 4) return true; } else if (b === -1) return false; }
  return false;
}
function spawnHostile(room, p, night) {
  for (let tries = 0; tries < 8; tries++) {
    const a = rnd() * 6.2832, d = 16 + rnd() * 22, x = fl(p.x + Math.cos(a) * d), z = fl(p.z + Math.sin(a) * d);
    let y = fl(p.y) + ((rnd() * 24) | 0) - 14;
    y = Math.max(4, Math.min(CH - 4, y));
    for (let s = 0; s < 14; s++, y--) { // walk down to a floor
      const here = blockAt(room, x, y, z, false), below = blockAt(room, x, y - 1, z, false);
      if (here === -1) break;
      if (open(here) && below > 0 && !isPlant(below) && !isWater(below) && !isLava(below) && open(blockAt(room, x, y + 1, z, false))) {
        const sky = exposedToSky(room, x, y, z);
        const tooClose = [...room.players.values()].some((q) => Math.hypot(q.x - x, q.z - z) < 12 && Math.abs(q.y - y) < 12);
        if (tooClose) break;
        const dark = night ? !glowNear(room, x, y, z) : deepDark(room, x, y, z) && !glowNear(room, x, y, z);
        const list = dark ? [['zombie', 5], ['skeleton', 4], ['spider', 3], ['boomer', night ? 1.5 : 0.4], ['slime', !sky && y < seaOf(room.gen) + 20 ? 2 : 0]] : [['boomer', 1]];
        if (!dark && night) break; // lit-up ground at night stays safe, even from creepers
        if (!dark && rnd() > 0.012) break; // a boomer on open daytime ground is very rare now: about one try in eighty spawns one
        const type = weigh(list);
        spawnMob(room, type, x + 0.5, y + 0.01, z + 0.5, { size: type === 'slime' ? 1 + ((rnd() * 3) | 0) : 1 });
        return;
      }
    }
  }
}
function spawnTick(room, night) {
  const ps = [...room.players.values()].filter((p) => !p.dead);
  if (!ps.length) return;
  let pas = 0, hos = 0;
  let fish = 0;
  for (const m of room.mobs.values()) { if (m.tame) continue; MOBS[m.type].swim ? fish++ : MOBS[m.type].kind === 'hostile' ? hos++ : pas++; }
  for (const p of ps) {
    if (fish < 8 + 8 * ps.length && rnd() < 0.5) spawnFish(room, p);
    if (pas < 6 + 3 * ps.length && rnd() < 0.5) spawnPassive(room, p);
    if (hos < 8 + 4 * ps.length && rnd() < 0.7) spawnHostile(room, p, night);
  }
}

/* ---------- per-tick driver ---------- */
export function tickEnts(room, dt) {
  if (room.drops && room.drops.length) for (const [x, y, z, id] of room.drops.splice(0)) spawnItem(room, mk(id, 1), x + 0.5, y + 0.5, z + 0.5, [(rnd() - 0.5) * 1.2, 2.2, (rnd() - 0.5) * 1.2], 0.4);
  room.tickN = (room.tickN || 0) + 1;
  const night = isNight(room), ps = [...room.players.values()];
  if (!ps.length) return;
  room.spawnT = (room.spawnT || 0) - dt;
  if (room.spawnT <= 0) { room.spawnT = 2; spawnTick(room, night); }
  for (const m of [...room.mobs.values()]) {
    let near = 1e9;
    for (const p of ps) near = Math.min(near, Math.hypot(p.x - m.x, p.z - m.z));
    if (!m.tame && (near > 100 || (MOBS[m.type].kind === 'hostile' && near > 56 && rnd() < 0.01))) { room.mobs.delete(m.id); continue; }
    if (near > 72 && !m.tame) continue; // too far from anyone to bother simulating
    if (MOBS[m.type].swim) { thinkFish(room, m, dt); if (room.mobs.has(m.id)) (m.wet ? moveFish : move)(room, m, dt); continue; }
    think(room, m, dt, night);
    if (isLava(blockAt(room, fl(m.x), fl(m.y + 0.2), fl(m.z), false)) && (m.lavaT = (m.lavaT || 0) + dt) >= 0.5) { m.lavaT = 0; hurtMob(room, m, 4, null); if (!room.mobs.has(m.id)) continue; }
    if (room.mobs.has(m.id)) move(room, m, dt);
  }
  tickItems(room, dt); tickArrows(room, dt); tickBoats(room, dt);
  for (const [key, c] of room.containers) {
    if (c.t !== 'furnace') continue;
    const changed = tickFurnace(c, dt);
    if (changed) { const [fx, , fz] = key.split(',').map(Number); touchClaim(room, fx, fz); }
    for (const p of ps) if (p.win.key === key) { if (changed) p.dirtyInv = true; else if (room.tickN % 5 === 0 && (c.burn > 0 || c.cook > 0)) p.dirtyProg = true; }
  }
}

// What one player gets to see: entities within 80 blocks.
export function entsFor(room, p) {
  const m = [], i = [], a = [], f = [], b = [], inRange = (e) => (e.x - p.x) ** 2 + (e.z - p.z) ** 2 < 6400;
  for (const e of room.mobs.values()) if (inRange(e)) {
    m.push([e.id, MOB_TYPES.indexOf(e.type), r2(e.x), r2(e.y), r2(e.z), r2(e.yaw), Math.ceil(e.hp),
      (e.hurtT > 0 ? 1 : 0) | (e.burn ? 2 : 0) | (e.fuse > 0 ? 4 : 0) | (e.shootT > 0 ? 8 : 0) | (e.swing > 0 ? 16 : 0) | (e.ground ? 32 : 0) | (e.fleeT > 0 ? 64 : 0) | (e.wet === false ? 128 : 0) | (e.tame ? 256 : 0) | (e.sit ? 512 : 0) | (e.anger > 0 && e.type === 'wolf' ? 1024 : 0),
      e.size, e.aux, r2(e.fuse)]);
  }
  for (const e of room.items.values()) if (inRange(e)) i.push([e.id, e.st.id, e.st.n, r2(e.x), r2(e.y), r2(e.z)]);
  for (const e of room.arrows.values()) if (inRange(e)) a.push([e.id, r2(e.x), r2(e.y), r2(e.z), r2(e.vx), r2(e.vy), r2(e.vz)]);
  if (room.fall) for (const e of room.fall.values()) if (inRange(e)) f.push([e.id, e.b, r2(e.x), r2(e.y), r2(e.z), r2(e.vy)]);
  for (const e of room.boats.values()) if (inRange(e)) b.push([e.id, e.kind, r2(e.x), r2(e.y), r2(e.z), r2(e.bw), e.rider]);
  return { t: 'ents', m, i, a, f, b };
}
