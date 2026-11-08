// Server-side creatures, dropped items, arrows and explosions. Everything here is authoritative; clients only draw it.
import { SEA, column } from '../public/shared/world.js';
import { B, isWater, flowDir, waterHeight } from '../public/shared/world.js';
import { I, blockDrops, toolId } from '../public/shared/items.js';
import { MOBS, MOB_TYPES, mobDims } from '../public/shared/mobs.js';
import { clone, mk, addToInv, tickFurnace } from './inventory.js';
import { blockAt, setEdit, solidAt, boxHitsSolid, exposedToSky, lineClear } from './world.js';
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
export function explode(room, x, y, z, radius, name) {
  const changes = [], pick = toolId('pickaxe', 4), R = Math.ceil(radius);
  for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
    const d = Math.hypot(dx, dy, dz);
    if (d > radius || (d > radius * 0.75 && rnd() < 0.4)) continue;
    const bx = fl(x) + dx, by = fl(y) + dy, bz = fl(z) + dz;
    if (by < 1 || by > 62) continue;
    const id = blockAt(room, bx, by, bz);
    if (id <= 0 || id === B.BEDROCK || isWater(id)) continue;
    if (id === B.CHEST || id === B.FURNACE) breakContainer(room, bx, by, bz);
    if (rnd() < 0.3) for (const [item, n] of blockDrops(id, { id: pick })) spawnItem(room, mk(item, n), bx + 0.5, by + 0.5, bz + 0.5);
    setEdit(room, bx, by, bz, 0); changes.push(bx, by, bz, 0);
  }
  if (changes.length) { broadcast(room, { t: 'blks', b: changes }); room.markDirty(); }
  broadcast(room, { t: 'fx', k: 'boom', x: r2(x), y: r2(y), z: r2(z) });
  const reach = radius * 2.2;
  for (const p of room.players.values()) {
    const dx = p.x - x, dy = p.y + 0.9 - y, dz = p.z - z, d = Math.hypot(dx, dy, dz);
    if (d < reach && !p.dead) damagePlayer(room, p, Math.max(0, 1 - d / reach) * 24, { kind: 'boom', name }, [(dx / (d || 1)) * 7, 5, (dz / (d || 1)) * 7]);
  }
  for (const m of [...room.mobs.values()]) {
    const dx = m.x - x, dy = m.y + 0.5 - y, dz = m.z - z, d = Math.hypot(dx, dy, dz);
    if (d < reach) hurtMob(room, m, Math.max(0, 1 - d / reach) * 24, null, [(dx / (d || 1)) * 6, 4, (dz / (d || 1)) * 6]);
  }
}

/* ---------- mobs ---------- */
export function spawnMob(room, type, x, y, z, o = {}) {
  const def = MOBS[type], size = type === 'slime' ? o.size || 1 : 1;
  const hp = type === 'slime' ? [0, 2, 6, 16][size] : def.hp;
  const m = {
    id: ++room.entId, type, x, y, z, vx: 0, vy: 0, vz: 0, yaw: rnd() * 6.28, hp, max: hp, size, ground: false,
    aux: type === 'sheep' ? (rnd() < 0.78 ? 0 : 1 + ((rnd() * 3) | 0)) : 0,
    aiT: rnd() * 3, wx: 0, wz: 0, dx: 0, dz: 0, moving: false, hurtT: 0, atkT: 1, fuse: 0, burnT: 0, burn: false, fleeT: 0, anger: 0, angerBy: 0,
    fy: 0, pitch: 0, sp: 0.6, wet: true, dryT: 0,
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
  if (by && by.x !== undefined) {
    if (def.kind === 'passive') { m.fleeT = 4; m.fromX = by.x; m.fromZ = by.z; }
    else { m.anger = 25; m.angerBy = by.id; }
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
    const a = rnd() * 6.2832, d = 10 + rnd() * 30, x = fl(p.x + Math.cos(a) * d), z = fl(p.z + Math.sin(a) * d);
    if (SEA - column(x, z, room.seed).h < 3) continue; // natural water only, and deep enough to swim in
    let near = 0;
    for (const m of room.mobs.values()) if (m.type === 'salmon' && Math.hypot(m.x - p.x, m.z - p.z) < 64) near++;
    if (near >= 8) return;
    for (let i = 0, n = 2 + ((rnd() * 3) | 0); i < n; i++) { // a small school
      const bx = x + ((rnd() * 7) | 0) - 3, bz = z + ((rnd() * 7) | 0) - 3, c = column(bx, bz, room.seed), depth = SEA - c.h;
      if (depth < 3) continue;
      const by = c.h + 1.5 + rnd() * (depth - 2.5);
      if (isWater(blockAt(room, bx, fl(by), bz, false)) && isWater(blockAt(room, bx, fl(by) + 1, bz, false))) spawnMob(room, 'salmon', bx + 0.5, by, bz + 0.5);
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

function think(room, m, dt, night) {
  const def = MOBS[m.type];
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
  if (m.type === 'spider' && !night && !m.anger && !(tgt && tgt.hurtSpiderUntil > Date.now())) tgt = null; // calm in daylight unless provoked
  if (!tgt) {
    m.fuse = Math.max(0, m.fuse - dt);
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
      if (dist < 3.2) { stop(m); face(m, dx, dz, dt); m.fuse += dt; }
      else { m.fuse = Math.max(0, m.fuse - dt * 2); if (dist < def.sight) steer(m, dx, dz, def.speed, dt); }
      if (dist > 7) m.fuse = 0;
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
  const nx = m.x + m.vx * dt; if (boxHitsSolid(room, nx, m.y, m.z, w, h)) { m.vx = 0; blocked = true; } else m.x = nx;
  const nz = m.z + m.vz * dt; if (boxHitsSolid(room, m.x, m.y, nz, w, h)) { m.vz = 0; blocked = true; } else m.z = nz;
  const ny = m.y + m.vy * dt;
  if (boxHitsSolid(room, m.x, ny, m.z, w, h)) { if (m.vy < 0) { m.ground = true; m.y = fl(ny + 1e-4) + 1; } m.vy = 0; } else { m.y = ny; m.ground = false; }
  const moving = Math.abs(m.wx) + Math.abs(m.wz) > 0.1;
  if (blocked && moving && !def.hop) {
    if (m.ground) m.vy = 8.6; // hop up a one-block step
    if ((m.blockedT += dt) > 1.2) { m.bias = (rnd() < 0.5 ? 1 : -1) * 1.5; m.biasT = 1.2; m.blockedT = 0; m.aiT = 0; }
  } else m.blockedT = 0;
  if (m.y < -20) room.mobs.delete(m.id);
}

/* ---------- spawning ---------- */
const weigh = (list) => { let t = list.reduce((s, [, w]) => s + w, 0) * rnd(); for (const [v, w] of list) if ((t -= w) <= 0) return v; return list[0][0]; };
function spawnPassive(room, p) {
  const a = rnd() * 6.2832, d = 20 + rnd() * 24, x = fl(p.x + Math.cos(a) * d), z = fl(p.z + Math.sin(a) * d), { h, k } = column(x, z, room.seed);
  if (h <= SEA + 1 || k === 1) return;
  if (blockAt(room, x, h, z, false) <= 0 || blockAt(room, x, h + 1, z, false) !== 0 || blockAt(room, x, h + 2, z, false) !== 0) return;
  const type = k === 2 ? (rnd() < 0.5 ? 'wolf' : 'rabbit') : weigh([['pig', 3], ['cow', 3], ['sheep', 3], ['chicken', 2], ['rabbit', 2], ['wolf', 0.25]]);
  for (let i = 0, n = type === 'wolf' ? 2 : 2 + ((rnd() * 3) | 0); i < n; i++) {
    const bx = x + ((rnd() * 5) | 0) - 2, bz = z + ((rnd() * 5) | 0) - 2, c = column(bx, bz, room.seed);
    if (c.h > SEA + 1 && blockAt(room, bx, c.h + 1, bz, false) === 0 && blockAt(room, bx, c.h, bz, false) > 0) spawnMob(room, type, bx + 0.5, c.h + 1.01, bz + 0.5);
  }
}
function spawnHostile(room, p, night) {
  for (let tries = 0; tries < 8; tries++) {
    const a = rnd() * 6.2832, d = 16 + rnd() * 22, x = fl(p.x + Math.cos(a) * d), z = fl(p.z + Math.sin(a) * d);
    let y = fl(p.y) + ((rnd() * 24) | 0) - 14;
    y = Math.max(4, Math.min(60, y));
    for (let s = 0; s < 14; s++, y--) { // walk down to a floor
      const here = blockAt(room, x, y, z, false), below = blockAt(room, x, y - 1, z, false);
      if (here === -1) break;
      if (here === 0 && below > 0 && !isWater(below) && blockAt(room, x, y + 1, z, false) === 0) {
        const sky = exposedToSky(room, x, y, z);
        if (sky && !night) break;
        const tooClose = [...room.players.values()].some((q) => Math.hypot(q.x - x, q.z - z) < 12 && Math.abs(q.y - y) < 12);
        if (tooClose) break;
        const type = weigh([['zombie', 5], ['skeleton', 4], ['spider', 3], ['boomer', 1.5], ['slime', !sky && y < 40 ? 2 : 0]]);
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
  for (const m of room.mobs.values()) MOBS[m.type].swim ? fish++ : MOBS[m.type].kind === 'hostile' ? hos++ : pas++;
  for (const p of ps) {
    if (fish < 4 + 4 * ps.length && rnd() < 0.5) spawnFish(room, p);
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
    if (near > 100 || (MOBS[m.type].kind === 'hostile' && near > 56 && rnd() < 0.01)) { room.mobs.delete(m.id); continue; }
    if (near > 72) continue; // too far from anyone to bother simulating
    if (MOBS[m.type].swim) { thinkFish(room, m, dt); if (room.mobs.has(m.id)) (m.wet ? moveFish : move)(room, m, dt); continue; }
    think(room, m, dt, night);
    if (room.mobs.has(m.id)) move(room, m, dt);
  }
  tickItems(room, dt); tickArrows(room, dt);
  for (const [key, c] of room.containers) {
    if (c.t !== 'furnace') continue;
    const changed = tickFurnace(c, dt);
    for (const p of ps) if (p.win.key === key) { if (changed) p.dirtyInv = true; else if (room.tickN % 5 === 0 && (c.burn > 0 || c.cook > 0)) p.dirtyProg = true; }
  }
}

// What one player gets to see: entities within 80 blocks.
export function entsFor(room, p) {
  const m = [], i = [], a = [], inRange = (e) => (e.x - p.x) ** 2 + (e.z - p.z) ** 2 < 6400;
  for (const e of room.mobs.values()) if (inRange(e)) {
    m.push([e.id, MOB_TYPES.indexOf(e.type), r2(e.x), r2(e.y), r2(e.z), r2(e.yaw), Math.ceil(e.hp),
      (e.hurtT > 0 ? 1 : 0) | (e.burn ? 2 : 0) | (e.fuse > 0 ? 4 : 0) | (e.shootT > 0 ? 8 : 0) | (e.swing > 0 ? 16 : 0) | (e.ground ? 32 : 0) | (e.fleeT > 0 ? 64 : 0) | (e.wet === false ? 128 : 0),
      e.size, e.aux, r2(e.fuse)]);
  }
  for (const e of room.items.values()) if (inRange(e)) i.push([e.id, e.st.id, e.st.n, r2(e.x), r2(e.y), r2(e.z)]);
  for (const e of room.arrows.values()) if (inRange(e)) a.push([e.id, r2(e.x), r2(e.y), r2(e.z), r2(e.vx), r2(e.vy), r2(e.vz)]);
  return { t: 'ents', m, i, a };
}
