// Fishing. Right click with a fishing rod to cast: the hook flies, lands on the water and floats there. Fish nearby swim over to it,
// nibble (the float twitches), and then bite (the float plunges): right click again inside that short window to reel the fish in.
// Reel too early or too late and the fish gets away. The server decides everything; clients only draw the hook (message 'hook').
import { isWater, isSolid, waterHeight } from '../public/shared/world.js';
import { I } from '../public/shared/items.js';
import { MOBS } from '../public/shared/mobs.js';
import { blockAt } from './world.js';
import { broadcast, send } from './net.js';
import { spawnItem, spawnMob } from './ents.js';
import { mk } from './inventory.js';
import { onFish } from './achievements.js';

const rnd = Math.random, fl = Math.floor;
const GRAV = 18, SPEED = 17, MAX_AIR = 6, FIND_R = 15, BITE_WINDOW = 1.1;
const tell = (p, m) => send(p.ws, { t: 'chat', m, sys: 1 });
const rodOf = (p) => { const st = p.inv[p.sel]; return st && st.id === I.FISHING_ROD ? st : null; };
const pub = (p, h) => broadcast(p.room, { t: 'hook', id: p.id, on: 1, x: +h.x.toFixed(2), y: +h.y.toFixed(2), z: +h.z.toFixed(2), s: h.s, b: h.phase === 'bite' ? 2 : h.phase === 'nibble' ? 1 : 0 });

export function removeHook(room, p) {
  const h = p.hook; if (!h) return;
  if (h.fish) { const m = room.mobs.get(h.fish); if (m) m.lureTo = null; }
  p.hook = null; broadcast(room, { t: 'hook', id: p.id, on: 0 });
}

function lureFish(room, h) { // the nearest fish that nobody else is fishing for
  let best = null, bd = FIND_R;
  for (const m of room.mobs.values()) {
    if (!MOBS[m.type].swim || !m.wet || (m.lureTo && Date.now() - m.lureAt < 600)) continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y, m.z - h.z);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}
function spawnNearby(room, h) { // deep water with no fish around (a pond you dug, say): one swims in from a few blocks away
  if (room.mobs.size > 400 || !isWater(blockAt(room, fl(h.x), fl(h.y) - 1, fl(h.z), false))) return false;
  for (let i = 0; i < 10; i++) {
    const a = rnd() * 6.2832, d = 4 + rnd() * 5, x = h.x + Math.cos(a) * d, z = h.z + Math.sin(a) * d, y = h.y - 0.9;
    if (isWater(blockAt(room, fl(x), fl(y), fl(z), false)) && isWater(blockAt(room, fl(x), fl(y) + 1, fl(z), false))) {
      const type = rnd() < 0.5 ? 'tropical' : 'salmon';
      spawnMob(room, type, x, y, z, { size: 1 + ((rnd() * 12) | 0) });
      return true;
    }
  }
  return false;
}

export function castRod(room, p, d) {
  if (!rodOf(p) || p.dead || p.hook) return;
  const len = Math.hypot(d[0], d[1], d[2]);
  if (!Number.isFinite(len) || len < 0.5 || len > 1.5) return;
  const now = Date.now(); if (now - (p.castAt || 0) < 500) return; p.castAt = now;
  const ux = d[0] / len, uy = d[1] / len, uz = d[2] / len;
  const h = p.hook = { x: p.x + ux * 0.6, y: p.y + 1.5 + uy * 0.6, z: p.z + uz * 0.6, vx: ux * SPEED, vy: uy * SPEED + 2, vz: uz * SPEED, s: 0, t: 0, phase: 'wait', timer: 2.5 + rnd() * 3, idle: 0, fish: 0 };
  pub(p, h);
}

// Right click again: reel in. Returns true when a fish was caught (the caller wears the rod).
export function reelRod(room, p) {
  const h = p.hook; if (!h) return false;
  let caught = null;
  if (h.s === 1 && h.phase === 'bite' && h.fish) caught = room.mobs.get(h.fish) || null;
  else if (h.fish) { const m = room.mobs.get(h.fish); if (m) { m.fleeT = 3; m.fromX = h.x; m.fromZ = h.z; } } // reeled too early: the fish is spooked
  const hx = h.x, hy = h.y, hz = h.z;
  removeHook(room, p);
  if (!caught) return false;
  room.mobs.delete(caught.id);
  const item = caught.type === 'tropical' ? I.TROPICAL_FISH : I.RAW_SALMON;
  const dx = p.x - hx, dz = p.z - hz, dist = Math.hypot(dx, dz) || 1;
  spawnItem(room, mk(item, 1), hx, hy + 0.2, hz, [(dx / dist) * Math.min(5, dist * 0.9), 5 + Math.min(3, dist * 0.2), (dz / dist) * Math.min(5, dist * 0.9)], 0.1);
  tell(p, 'You caught a fish!'); onFish(room, p, caught.type);
  return true;
}

export function tickFishing(room, dt) {
  for (const p of room.players.values()) {
    const h = p.hook; if (!h) continue;
    if (p.dead || !rodOf(p) || Math.hypot(h.x - p.x, h.z - p.z) > 40) { removeHook(room, p); continue; }
    h.t += dt;
    if (h.s === 0) { // in the air
      for (let i = 0; i < 2 && p.hook; i++) {
        h.vy -= GRAV * dt * 0.5; h.x += h.vx * dt * 0.5; h.y += h.vy * dt * 0.5; h.z += h.vz * dt * 0.5;
        const b = blockAt(room, fl(h.x), fl(h.y), fl(h.z), false);
        if (b === -1) { removeHook(room, p); break; }
        if (isWater(b)) { // lands: float at the top of this stretch of water
          let y0 = fl(h.y); while (isWater(blockAt(room, fl(h.x), y0 + 1, fl(h.z), false))) y0++;
          h.y = y0 + waterHeight(blockAt(room, fl(h.x), y0, fl(h.z), false)); h.vx = h.vy = h.vz = 0; h.s = 1; h.phase = 'wait'; h.timer = 2 + rnd() * 3; h.idle = 0; pub(p, h); break;
        }
        if (isSolid(b)) { tell(p, 'The hook hit a block. Aim at the water.'); removeHook(room, p); break; }
      }
      if (p.hook) { if (h.t > MAX_AIR) removeHook(room, p); else pub(p, h); }
      continue;
    }
    // floating on the water
    if (!isWater(blockAt(room, fl(h.x), fl(h.y - 0.15), fl(h.z), false))) { h.s = 0; h.vx = h.vy = h.vz = 0; h.fish = 0; pub(p, h); continue; } // the water went away: it falls
    if (h.fish && !room.mobs.has(h.fish)) { h.fish = 0; h.phase = 'wait'; h.timer = 2; pub(p, h); }
    if (h.fish) { const m = room.mobs.get(h.fish); m.lureTo = [h.x, h.y - 0.45, h.z]; m.lureAt = Date.now(); }
    if (h.phase === 'wait') {
      h.timer -= dt;
      if (!h.fish && h.timer <= 0) {
        const m = lureFish(room, h);
        if (m) { h.fish = m.id; h.idle = 0; }
        else if ((h.idle += dt) > 4 && spawnNearby(room, h)) h.idle = 0;
      }
      if (h.fish) { const m = room.mobs.get(h.fish); if (Math.hypot(m.x - h.x, m.y - h.y, m.z - h.z) < 1.1) { h.phase = 'nibble'; h.timer = 0.6 + rnd() * 1.6; pub(p, h); } }
    } else if (h.phase === 'nibble') {
      h.timer -= dt;
      if (h.timer <= 0) { h.phase = 'bite'; h.timer = BITE_WINDOW; pub(p, h); }
    } else if (h.phase === 'bite') {
      h.timer -= dt;
      if (h.timer <= 0) { // too slow: the fish gets away
        const m = room.mobs.get(h.fish); if (m) { m.lureTo = null; m.fleeT = 3; m.fromX = h.x; m.fromZ = h.z; }
        h.fish = 0; h.phase = 'wait'; h.timer = 3 + rnd() * 4; h.idle = 0; pub(p, h); tell(p, 'The fish got away. Reel in the moment the float plunges!');
      }
    }
  }
}
