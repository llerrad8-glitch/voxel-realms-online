// Ships, cannons and pirates (server side; the rules both sides share are in public/shared/ships.js).
// A ship is an entity with a block grid of its own. Players turn a build into one by placing a steering wheel; the server takes the build's blocks out of the world,
// floats the ship on the water and sails it when somebody holds the wheel. A pirate ship is the same thing, ready made, with a crew of pirates walking about its deck.
import { B, isWater, isSolid, isFluid, isPlant, waterHeight, seaOf, column, isCannon, cannonId, cannonDir, isVariant } from '../public/shared/world.js';
import { I, itemInfo, blockDrops, toolId, CANNON, GUNS } from '../public/shared/items.js';
import { MOBS } from '../public/shared/mobs.js';
import { SHIP_MAX, bk, unbk, bounds, toWorld, toLocal, dirToLocal, dirToWorld, shipBoxHit, shipSweep, collectBuild, pirateShipBlocks } from '../public/shared/ships.js';
import { send, broadcast } from './net.js';
import { mk } from './inventory.js';
import { blockAt, setEdit, setBlock, claimAt, lineClear, wakeWater } from './world.js';
import { spawnMob, spawnItem, spawnArrow, explode, hurtMob } from './ents.js';
import { damagePlayer } from './survival.js';
import { award, bump } from './achievements.js';

const rnd = Math.random, fl = Math.floor, r2 = (v) => Math.round(v * 100) / 100, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const tell = (p, m) => send(p.ws, { t: 'chat', m, sys: 1 });
const tSec = () => Date.now() / 1000;
export const shipsOf = (room) => room.ships || (room.ships = new Map());

/* ---------- ships as objects ---------- */
// Work out everything that depends on which blocks the ship has: bounds, a flat list for collision, the cannons and (for a pirate crew) the cells it is safe to walk on.
export function refresh(S) {
  bounds(S);
  S.list = []; S.cannons ||= new Map(); S.walk = new Set();
  for (const [k, id] of S.blocks) { const [x, y, z] = unbk(k); if (isSolid(id)) S.list.push([x, y, z]); if (isCannon(id) && !S.cannons.has(k)) S.cannons.set(k, { loaded: S.kind === 'pirate', cd: rnd() * 4 }); }
  for (const k of [...S.cannons.keys()]) if (!isCannon(S.blocks.get(k))) S.cannons.delete(k);
  for (const k of S.blocks.keys()) {
    const [x, y, z] = unbk(k), id = S.blocks.get(k);
    if (isSolid(id) && !S.blocks.has(bk(x, y + 1, z)) && !S.blocks.has(bk(x, y + 2, z))) S.walk.add(`${x},${y},${z}`);
  }
  S.deck = [...S.walk].map((s) => s.split(',').map(Number)); // [lx, ly(of the block we stand on), lz]
  S.ver = (S.ver || 0) + 1;
}
export function newShip(room, kind, x, y, z, yaw, blocks, extra = {}) {
  const S = { id: ++room.entId, kind, x, y, z, yaw, blocks, cannons: new Map(), speed: 0, inF: 0, inS: 0, helm: 0, ver: 0, draft: 0.5, owner: '', crew: [], born: Date.now(), ...extra };
  refresh(S); shipsOf(room).set(S.id, S); return S;
}
export function deleteShip(room, S) {
  for (const id of S.crew) room.mobs.delete(id);
  if (S.helm) { const p = room.players.get(S.helm); if (p) { p.helmShip = 0; send(p.ws, { t: 'helm', on: 0 }); } }
  shipsOf(room).delete(S.id);
}
export const shipsToSave = (room) => [...shipsOf(room).values()].filter((S) => S.kind === 'p').map((S) => {
  const b = []; for (const [k, id] of S.blocks) { const [x, y, z] = unbk(k); b.push(x, y, z, id); }
  return { x: +S.x.toFixed(2), y: +S.y.toFixed(2), z: +S.z.toFixed(2), yaw: +S.yaw.toFixed(3), owner: S.owner, b };
});
export function loadShips(room, list) {
  for (const d of Array.isArray(list) ? list.slice(0, 40) : []) {
    if (!d || ![d.x, d.y, d.z, d.yaw].every(Number.isFinite) || !Array.isArray(d.b) || d.b.length > 4 * (SHIP_MAX + 60)) continue;
    const blocks = new Map();
    for (let i = 0; i + 3 < d.b.length; i += 4) if (d.b.slice(i, i + 4).every(Number.isInteger) && d.b[i + 3] > 0 && d.b[i + 3] < 256) blocks.set(bk(d.b[i], d.b[i + 1], d.b[i + 2]), d.b[i + 3]);
    if (blocks.size) newShip(room, 'p', d.x, d.y, d.z, d.yaw, blocks, { owner: String(d.owner || '') });
  }
}

/* ---------- water ---------- */
// The height of the water surface at (x, z), looking from y0 + 3 downward, or null when there is no water there.
export function surfaceAt(room, x, z, y0) {
  const bx = fl(x), bz = fl(z);
  for (let y = fl(y0) + 3; y > y0 - 14; y--) {
    const id = blockAt(room, bx, y, bz);
    if (isWater(id)) { let yy = y; while (isWater(blockAt(room, bx, yy + 1, bz))) yy++; return yy + waterHeight(blockAt(room, bx, yy, bz)); }
  }
  return null;
}

/* ---------- placing a steering wheel: build -> ship ---------- */
export function launchShip(room, p, wx, wy, wz) {
  const get = (x, y, z) => { const v = room.edits.get(`${x},${y},${z}`); return v > 0 ? v : 0; };
  const res = collectBuild(get, wx, wy, wz);
  if (!res.ok) return { ok: false, msg: `That build is too big for a ship: a ship can be at most ${SHIP_MAX} blocks. Keep it apart from other things you built.` };
  const cells = res.cells;
  for (const [x, y, z] of cells) {
    const id = x === wx && y === wy && z === wz ? B.STEERING_WHEEL : get(x, y, z), c = claimAt(room, x, z);
    if (id === B.CHEST || id === B.FURNACE) return { ok: false, msg: 'Empty and remove chests and furnaces first: they cannot be part of a ship.' };
    if (id === B.CHUNK_SAVER || (c && c.vid !== p.vid)) return { ok: false, msg: 'Part of this build is in a protected chunk.' };
  }
  const low = Math.min(...cells.map((c) => c[1])), sf = surfaceAt(room, wx + 0.5, wz + 0.5, wy);
  if (sf === null || low > sf + 1.6) return { ok: false, msg: 'A ship has to float: build it on the water, then place the steering wheel.' };
  const blocks = new Map(), changes = [];
  for (const [x, y, z] of cells) { const wheel = x === wx && y === wy && z === wz; blocks.set(bk(x - wx, y - wy, z - wz), wheel ? B.STEERING_WHEEL : get(x, y, z)); }
  for (const [x, y, z] of cells) { if (!(x === wx && y === wy && z === wz)) { setEdit(room, x, y, z, 0); changes.push(x, y, z, 0); wakeWater(room, x, y, z); } }
  if (changes.length) { broadcast(room, { t: 'blks', b: changes }); room.markDirty(); }
  const S = newShip(room, 'p', wx + 0.5, wy, wz + 0.5, 0, blocks, { owner: p.th });
  S.y = sf - S.draft - S.b.y0 - 1; // it starts a little low and bobs up to where it floats
  award(room, p, 'ship_launch');
  return { ok: true, ship: S };
}
// Taking the wheel off a ship lets it settle back into the world as ordinary blocks (turned to the nearest compass direction).
function dock(room, S) {
  const q = Math.round(S.yaw / (Math.PI / 2)), c = Math.round(Math.cos(q * Math.PI / 2)), s = Math.round(Math.sin(q * Math.PI / 2)), ox = fl(S.x), oz = fl(S.z), oy = Math.round(S.y), yaw = q * Math.PI / 2;
  for (const [k, id0] of S.blocks) {
    const [lx, ly, lz] = unbk(k), x = ox + lx * c + lz * s, z = oz - lx * s + lz * c, y = oy + ly;
    if (y < 1 || y > 250) continue;
    let id = id0;
    if (isCannon(id)) { const [dx, dz] = cannonDir(id); const [wx, wz] = dirToWorld(yaw, dx, dz); id = cannonId(wx, wz); }
    const cur = blockAt(room, x, y, z);
    if (cur === 0 || isWater(cur) || isPlant(cur)) setBlock(room, x, y, z, id);
    else if (room.mode !== 'creative') for (const [item, n] of blockDrops(id, { id: toolId('axe', 2) })) spawnItem(room, mk(item, n), x + 0.5, y + 0.5, z + 0.5);
  }
  deleteShip(room, S);
}

/* ---------- player actions on a ship ---------- */
const near = (p, S, lx, ly, lz, max) => { const [x, y, z] = toWorld(S, lx, ly + 0.5, lz, tSec()); return Math.hypot(x - p.x, y - (p.y + 1.5), z - p.z) <= max; };
function takeItem(p, id) { const i = p.inv.findIndex((s) => s && s.id === id); if (i < 0) return false; if (--p.inv[i].n <= 0) p.inv[i] = null; p.dirtyInv = true; return true; }
const worldCannons = (room) => room.cannons || (room.cannons = new Map());
export function handleShip(room, p, m) {
  if (p.dead) return;
  const now = Date.now();
  if (m.op === 'cannon' && m.id === 0) { // a cannon standing in the world
    const { x, y, z } = m; if (![x, y, z].every(Number.isInteger) || !isCannon(blockAt(room, x, y, z)) || Math.hypot(x + 0.5 - p.x, y + 0.5 - (p.y + 1.5), z + 0.5 - p.z) > 7) return;
    const key = `${x},${y},${z}`, st = worldCannons(room).get(key) || { loaded: false, cd: 0 }; worldCannons(room).set(key, st);
    return cannonAct(room, p, st, [x + 0.5, y + 0.5, z + 0.5], cannonDir(blockAt(room, x, y, z)), m.act, null);
  }
  const S = shipsOf(room).get(m.id); if (!S) return;
  if (m.op === 'steer') { if (S.helm !== p.id) return; S.inF = Math.max(-1, Math.min(1, +m.f || 0)); S.inS = Math.max(-1, Math.min(1, +m.s || 0)); return; }
  if (m.op === 'leave') { if (S.helm === p.id) { S.helm = 0; S.inF = S.inS = 0; p.helmShip = 0; send(p.ws, { t: 'helm', on: 0 }); } return; }
  const { x: lx, y: ly, z: lz } = m;
  if (m.op === 'helm') {
    if (S.helm === p.id) { S.helm = 0; S.inF = S.inS = 0; p.helmShip = 0; return send(p.ws, { t: 'helm', on: 0 }); }
    if (S.helm && room.players.has(S.helm)) return tell(p, 'Somebody else is steering this ship.');
    if (S.kind === 'pirate' && S.crew.some((id) => room.mobs.has(id))) return tell(p, 'The pirates will not let go of their wheel! Defeat the crew first.');
    if (!near(p, S, 0, 0, 0, 5)) return;
    if (S.kind === 'pirate') { S.kind = 'p'; S.owner = p.th; S.crew = []; award(room, p, 'pirate_capture'); tell(p, 'You have captured the pirate ship!'); }
    S.helm = p.id; p.helmShip = S.id; S.inF = S.inS = 0; award(room, p, 'ship_sail');
    return send(p.ws, { t: 'helm', on: 1, id: S.id, x: r2(p.x), y: r2(p.y), z: r2(p.z) });
  }
  if (![lx, ly, lz].every(Number.isInteger) || !near(p, S, lx, ly, lz, 7.5)) return;
  const id = S.blocks.get(bk(lx, ly, lz));
  if (m.op === 'cannon') {
    if (!isCannon(id)) return;
    const st = S.cannons.get(bk(lx, ly, lz)); if (!st) return;
    const [dx, dz] = cannonDir(id), [wx, wz] = dirToWorld(S.yaw, dx, dz), [px, py, pz] = toWorld(S, lx, ly + 0.5, lz, tSec());
    return cannonAct(room, p, st, [px, py, pz], [wx, wz], m.act, S);
  }
  if (m.op === 'break') {
    if (!id || now - (p.shipBrk || 0) < 120) return; p.shipBrk = now;
    const cr = room.mode === 'creative';
    if (id === B.STEERING_WHEEL) return dock(room, S);
    if (!cr) { const [x, y, z] = toWorld(S, lx, ly + 0.5, lz, tSec()); for (const [item, n] of blockDrops(id, p.inv[p.sel])) spawnItem(room, mk(item, n), x, y, z, [(rnd() - 0.5) * 1.5, 2.5, (rnd() - 0.5) * 1.5], 0.4); }
    S.blocks.delete(bk(lx, ly, lz)); refresh(S);
    if (S.blocks.size <= 1) deleteShip(room, S);
    return;
  }
  if (m.op === 'place') {
    const st = p.inv[p.sel], it = st && itemInfo(st.id);
    const { nx, ny, nz } = m; if (![nx, ny, nz].every(Number.isInteger) || Math.abs(nx) + Math.abs(ny) + Math.abs(nz) !== 1) return;
    const tx = lx + nx, ty = ly + ny, tz = lz + nz;
    if (!it || !it.block || S.blocks.has(bk(tx, ty, tz)) || Math.abs(tx) > 30 || Math.abs(tz) > 30 || ty < -10 || ty > 40) return;
    const blk = it.block;
    if (S.blocks.size >= SHIP_MAX) return tell(p, `A ship can be at most ${SHIP_MAX} blocks.`);
    if ([B.CHEST, B.FURNACE, B.CHUNK_SAVER, B.STEERING_WHEEL].includes(blk) || isPlant(blk) || isFluid(blk) || (blk === B.TORCH && ny !== 1)) return tell(p, 'That cannot go on a ship.');
    let id2 = blk;
    if (blk === B.CANNON) { const [dx, dz] = dirToLocal(S.yaw, -Math.sin(p.yaw), -Math.cos(p.yaw)); id2 = cannonId(dx, dz); }
    S.blocks.set(bk(tx, ty, tz), id2); refresh(S);
    if (room.mode !== 'creative') { if (--st.n <= 0) p.inv[p.sel] = null; p.dirtyInv = true; p.dirtyEq = true; }
  }
}
// Loading and firing, for a cannon on a ship (S) or in the world (S = null). pos: where the cannon is; dir: the way the barrel points (x, z).
function cannonAct(room, p, st, pos, dir, act, S) {
  const cr = room.mode === 'creative', now = Date.now(), held = p.inv[p.sel];
  if (act === 'load' || (held && held.id === I.GUNPOWDER && act !== 'fire')) {
    if (st.loaded) return tell(p, 'The cannon is already loaded with gunpowder.');
    if (!cr && !takeItem(p, I.GUNPOWDER)) return tell(p, 'You need gunpowder to load a cannon.');
    st.loaded = true; award(room, p, 'cannon_load'); return tell(p, 'Cannon loaded. Press F or right click it to fire.');
  }
  if (!st.loaded) return tell(p, 'Load the cannon with gunpowder first (right click it holding gunpowder).');
  if (now - (st.at || 0) < CANNON.reloadMs) return;
  if (!cr && !takeItem(p, I.CANNONBALL)) return tell(p, 'You need a cannonball in your inventory to fire the cannon.');
  st.loaded = false; st.at = now;
  fireCannon(room, { kind: 'p', id: p.id, name: p.name, ref: p }, pos, dir, 0.1, S && S.id);
  award(room, p, 'cannon_fire'); bump(room, p, 'cannons', 1);
}
export function fireCannon(room, owner, pos, dir /* [x, z] unit */, elev, from) {
  const len = Math.hypot(dir[0], dir[1]) || 1, ux = dir[0] / len, uz = dir[1] / len, ce = Math.cos(elev), se = Math.sin(elev), sp = CANNON.speed;
  const x = pos[0] + ux * 1.1, y = pos[1] + 0.25, z = pos[2] + uz * 1.1;
  const a = spawnArrow(room, owner, x, y, z, ux * ce * sp, se * sp, uz * ce * sp, CANNON.dmg, 2); if (a) a.from = from || 0;
  broadcast(room, { t: 'fx', k: 'shot', big: 1, x: r2(x), y: r2(y), z: r2(z), dx: r2(ux), dy: r2(se), dz: r2(uz) });
}

/* ---------- things the rest of the server asks ---------- */
// Is the point inside a block of some ship? (not the ship `ignore`, which is the one that just fired it)
export function shipAt(room, x, y, z, ignore = 0) {
  const ships = room.ships; if (!ships || !ships.size) return null;
  const t = tSec();
  for (const S of ships.values()) {
    if (S.id === ignore) continue;
    const b = S.b; if ((x - S.x) ** 2 + (z - S.z) ** 2 > (b.rad + 1) ** 2) continue;
    const [lx, ly, lz] = toLocal(S, x, y, z, t), k = bk(Math.round(lx), fl(ly), Math.round(lz)), id = S.blocks.get(k);
    if (id && isSolid(id)) return { S, k };
  }
  return null;
}
// Does a bullet's path from a to b pass through a ship's hull? (the ship `ignore` is the one that fired it, for a moment)
export function shipSweepAt(room, a, b, ignore = 0) {
  const ships = room.ships; if (!ships || !ships.size) return null;
  const t = tSec();
  for (const S of ships.values()) { if (S.id === ignore) continue; const k = shipSweep(S, a[0], a[1], a[2], b[0], b[1], b[2], t); if (k !== null) return { S, k }; }
  return null;
}
export const hitsShipBox = (room, x, y, z, w, h) => { const ships = room.ships; if (!ships || !ships.size) return false; const t = tSec(); for (const S of ships.values()) if (shipBoxHit(S, x, y, z, w, h, t)) return true; return false; };
// A blast knocks blocks off ships near it.
export function damageShips(room, x, y, z, r) {
  const ships = room.ships; if (!ships || !ships.size) return;
  const t = tSec();
  for (const S of [...ships.values()]) {
    if ((x - S.x) ** 2 + (z - S.z) ** 2 > (S.b.rad + r + 1) ** 2) continue;
    let hit = 0;
    for (const [k] of [...S.blocks]) {
      const [lx, ly, lz] = unbk(k), [wx, wy, wz] = toWorld(S, lx, ly + 0.5, lz, t);
      if (Math.hypot(wx - x, wy - y, wz - z) <= r && rnd() < 0.85) { S.blocks.delete(k); hit++; }
    }
    if (hit) { refresh(S); if (S.blocks.size < 6 || !S.blocks.has(bk(0, 0, 0))) { if (S.kind === 'pirate' && room.players.size) for (const p of room.players.values()) if (Math.hypot(p.x - S.x, p.z - S.z) < 60) award(room, p, 'sink_pirate'); deleteShip(room, S); } }
  }
}

/* ---------- ticking ---------- */
function blocked(room, S, x, y, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const [lx, ly, lz] of S.list) {
    if (S.list.length > 90 && ly > S.b.y0 + 2 && ((lx + lz + ly) & 3)) continue; // a big ship: the waterline and every fourth block above it is enough
    if (isSolid(blockAt(room, fl(x + lx * c + lz * s), fl(y + ly + 0.5), fl(z - lx * s + lz * c)))) return true;
  }
  return false;
}
const near2 = (room, S, d) => { for (const p of room.players.values()) if ((p.x - S.x) ** 2 + (p.z - S.z) ** 2 < d * d) return p; return null; };
export function tickShips(room, dt) {
  const ships = room.ships; if (!ships || !ships.size) return;
  const t = tSec();
  for (const S of [...ships.values()]) {
    const nearest = near2(room, S, S.kind === 'pirate' ? 175 : 140);
    if (!nearest) { if (S.kind === 'pirate') deleteShip(room, S); continue; } // pirate ships are not kept: they sail away when nobody is near
    if (S.helm) { const h = room.players.get(S.helm); if (!h || h.dead || Math.hypot(h.x - S.x, h.z - S.z) > S.b.rad + 12) { S.helm = 0; S.inF = S.inS = 0; if (h) { h.helmShip = 0; send(h.ws, { t: 'helm', on: 0 }); } } }
    if (S.kind === 'pirate') aiShip(room, S, dt, t);
    // floating
    const sf = surfaceAt(room, S.x, S.z, S.y + S.b.y0 + 0.5), afloat = sf !== null;
    if (afloat) S.y += (sf - S.draft - S.b.y0 - S.y) * Math.min(1, 2.2 * dt);
    // sailing
    const maxF = S.kind === 'pirate' ? 2.8 : 4.4;
    S.speed += ((afloat ? (S.inF > 0 ? maxF * S.inF : S.inF < 0 ? -1.5 : 0) : 0) - S.speed) * Math.min(1, (S.inF ? 0.55 : 0.3) * dt);
    const turn = S.inS * 0.5 * Math.min(1, 0.35 + Math.abs(S.speed) / 2) * dt * (S.speed < -0.2 ? -1 : 1);
    if (Math.abs(turn) > 1e-4) { if (!blocked(room, S, S.x, S.y, S.z, S.yaw + turn)) S.yaw += turn; else S.speed *= 0.9; }
    if (Math.abs(S.speed) > 0.02) {
      const nx = S.x - Math.sin(S.yaw) * S.speed * dt, nz = S.z - Math.cos(S.yaw) * S.speed * dt;
      if (!blocked(room, S, nx, S.y, nz, S.yaw)) { S.x = nx; S.z = nz; } else S.speed *= 0.2; // aground: it stops
    }
    if (S.kind === 'pirate') { for (const p of room.players.values()) { const [lx, ly, lz] = toLocal(S, p.x, p.y, p.z, t); if (Math.abs(lx) < 3 && lz > S.b.z0 && lz < S.b.z1 && ly > -2 && ly < 3) award(room, p, 'pirate_board'); } tickCrew(room, S, dt, t); tickCannonsAI(room, S, dt, t); }
    else for (const st of S.cannons.values()) st.cd = Math.max(0, st.cd - dt);
    S.stale = 0;
  }
}

/* ---------- pirates ---------- */
const players = (room) => [...room.players.values()].filter((p) => !p.dead && room.mode !== 'creative');
function aiShip(room, S, dt, t) {
  const live = S.crew.some((id) => room.mobs.has(id));
  if (!live) { S.inF = 0; S.inS = 0; return; } // a ship with no crew just drifts
  let tgt = null, bd = 1e9; for (const p of players(room)) { const d = Math.hypot(p.x - S.x, p.z - S.z); if (d < bd) { bd = d; tgt = p; } }
  S.ai ||= { wanderT: 0, turn: 0 };
  if (!tgt || bd > 95) { // no one near: cruise, now and then turning
    S.ai.wanderT -= dt; if (S.ai.wanderT <= 0) { S.ai.wanderT = 6 + rnd() * 10; S.ai.turn = rnd() < 0.4 ? 0 : (rnd() < 0.5 ? -1 : 1) * (0.3 + rnd() * 0.7); }
    S.inF = 0.5; S.inS = S.ai.turn; if (S.speed < 0.2 && S.inF > 0) S.inS = S.ai.turn || 1; return;
  }
  const want = Math.atan2(-(tgt.x - S.x), -(tgt.z - S.z)); // the heading that points the bow at the player
  let goal = want, f = 1;
  if (bd < 40) { // close enough: turn side-on so the cannons bear, and slow down
    const a = want + Math.PI / 2, b = want - Math.PI / 2; goal = Math.abs(wrap(a - S.yaw)) < Math.abs(wrap(b - S.yaw)) ? a : b; f = bd < 24 ? 0.3 : 0.55;
    if (bd < 16) { goal = want + Math.PI; f = 0.5; } // too close: sail away
  }
  S.inS = Math.max(-1, Math.min(1, wrap(goal - S.yaw) * 2)); S.inF = f;
}
function tickCannonsAI(room, S, dt, t) {
  const crew = S.crew.filter((id) => room.mobs.has(id)).length; if (!crew) return;
  const ps = players(room); if (!ps.length) return;
  for (const [k, st] of S.cannons) {
    st.cd -= dt; if (st.cd > 0) continue;
    const id = S.blocks.get(k), [lx, ly, lz] = unbk(k), [dx, dz] = cannonDir(id), [wx, wz] = dirToWorld(S.yaw, dx, dz), [px, py, pz] = toWorld(S, lx, ly + 0.5, lz, t);
    let tgt = null, best = 1e9;
    for (const p of ps) {
      const ex = p.x - px, ez = p.z - pz, d = Math.hypot(ex, ez);
      if (d < 12 || d > 58) continue;
      const ang = Math.abs(wrap(Math.atan2(ez, ex) - Math.atan2(wz, wx)));
      if (ang < 0.42 && d < best) { best = d; tgt = p; }
    }
    if (!tgt) { st.cd = 0.5; continue; }
    const D = best, ratio = Math.min(1, (CANNON.gravity * D) / (CANNON.speed * CANNON.speed)), elev = 0.5 * Math.asin(ratio) + (tgt.y + 1 - py) / (D * 2.2) + (rnd() - 0.5) * 0.07;
    const ex = tgt.x - px + (rnd() - 0.5) * D * 0.12, ez = tgt.z - pz + (rnd() - 0.5) * D * 0.12; // (they miss a lot, the sea is rough)
    fireCannon(room, { kind: 'm', id: S.id, name: 'Pirate cannon' }, [px, py, pz], [ex, ez], Math.max(0.02, elev), S.id);
    st.cd = 6 + rnd() * 5;
  }
}
// The cells (\"x,z\") a pirate can stand on at one deck level (the level is the y of the block it stands on). Kept until the ship's blocks change.
function levelCells(S, y) {
  if (!S.lvl || S.lvl.ver !== S.ver) S.lvl = { ver: S.ver, m: new Map() };
  let c = S.lvl.m.get(y);
  if (!c) { c = new Set(); for (const k of S.walk) { const [x, yy, z] = k.split(',').map(Number); if (yy === y) c.add(`${x},${z}`); } S.lvl.m.set(y, c); }
  return c;
}
// The cell a spot belongs to, or the nearest walkable cell when the spot is not on one ([x, z] or null).
function cellOf(cells, x, z) {
  const cx = Math.round(x), cz = Math.round(z); if (cells.has(`${cx},${cz}`)) return [cx, cz];
  let best = null, bd = 1e9; for (const k of cells) { const [a, b] = k.split(',').map(Number), d = (a - x) ** 2 + (b - z) ** 2; if (d < bd) { bd = d; best = [a, b]; } }
  return best;
}
// The next cell on the shortest way from cell a to cell g over walkable cells (so a pirate goes round a mast or a cannon instead of walking into it).
function nextCell(cells, a, g) {
  const key = (c) => `${c[0]},${c[1]}`, prev = new Map([[key(a), null]]), q = [a];
  for (let i = 0; i < q.length; i++) {
    const c = q[i]; if (c[0] === g[0] && c[1] === g[1]) break;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = [c[0] + dx, c[1] + dz], k = key(n); if (cells.has(k) && !prev.has(k)) { prev.set(k, c); q.push(n); } }
  }
  if (!prev.has(key(g))) return null;
  let c = g; while (prev.get(key(c)) && key(prev.get(key(c))) !== key(a)) c = prev.get(key(c));
  return prev.get(key(c)) ? c : g;
}
// A pirate has a body: all four corners of it must be over the deck, so it never stands half inside a rail, a cannon or a mast.
const PR = 0.27, bodyOk = (cells, x, z) => cells.has(`${Math.round(x - PR)},${Math.round(z - PR)}`) && cells.has(`${Math.round(x + PR)},${Math.round(z - PR)}`) && cells.has(`${Math.round(x - PR)},${Math.round(z + PR)}`) && cells.has(`${Math.round(x + PR)},${Math.round(z + PR)}`);
function tickCrew(room, S, dt, t) {
  const def = MOBS.pirate, ps = players(room);
  for (const id of [...S.crew]) {
    const m = room.mobs.get(id); if (!m) { S.crew.splice(S.crew.indexOf(id), 1); continue; }
    m.hurtT = Math.max(0, m.hurtT - dt); m.atkT = Math.max(0, m.atkT - dt); m.shootT = Math.max(0, m.shootT - dt); m.swing = Math.max(0, m.swing - dt); m.vx = m.vy = m.vz = 0; m.ground = true;
    let lx = m.lx, lz = m.lz;
    let tgt = null, bd = def.sight * def.sight;
    for (const p of ps) { const dx = p.x - m.x, dz = p.z - m.z, dy = p.y - m.y, d = dx * dx + dz * dz + dy * dy * 0.5; if (d < bd) { bd = d; tgt = p; } }
    let gx = m.gx, gz = m.gz, speed = def.speed * 0.5, faceX = null, faceZ = null;
    if (tgt) {
      const [tlx, tly, tlz] = toLocal(S, tgt.x, tgt.y, tgt.z, t), dx = tgt.x - m.x, dz = tgt.z - m.z, hd = Math.hypot(dx, dz);
      const aboard = tly > -1.5 && tly < 3.5 && S.walk.has(`${Math.round(tlx)},${m.deckY - 1},${Math.round(tlz)}`) || (Math.abs(tlx) < 3.2 && tlz > S.b.z0 - 1.5 && tlz < S.b.z1 + 1.5 && tly > -1.5 && tly < 3.5);
      faceX = tlx - lx; faceZ = tlz - lz;
      if (m.aux === 1) { // a pistol: stands and shoots, and steps toward a player on the deck
        m.arrowT -= dt;
        const from = [m.x, m.y + 1.5, m.z], to = [tgt.x, tgt.y + 1.1, tgt.z];
        if (m.arrowT <= 0 && hd < 32 && lineClear(room, from, to)) {
          const sp = GUNS[I.FLINTLOCK].speed * 0.85, ex = to[0] - from[0] + (rnd() - 0.5) * hd * 0.14, ey = to[1] - from[1] + (rnd() - 0.5) * hd * 0.07 + hd * 0.02, ez = to[2] - from[2] + (rnd() - 0.5) * hd * 0.14, len = Math.hypot(ex, ey, ez);
          const a = spawnArrow(room, { kind: 'm', id: m.id, name: def.name }, from[0] + ex / len, from[1] + ey / len, from[2] + ez / len, (ex / len) * sp, (ey / len) * sp, (ez / len) * sp, 6, true); if (a) a.from = S.id;
          broadcast(room, { t: 'fx', k: 'shot', x: r2(from[0]), y: r2(from[1]), z: r2(from[2]), dx: r2(ex / len), dy: r2(ey / len), dz: r2(ez / len) });
          m.arrowT = 2.4 + rnd() * 1.4; m.shootT = 0.5;
        }
        if (aboard && hd > 7) { gx = tlx; gz = tlz; speed = def.speed * 0.7; } else { gx = null; }
      } else { // a sword: runs at a player on the deck, or toward the nearest part of the deck
        if (aboard) { gx = tlx; gz = tlz; }
        else if (!m.gT || (m.gT -= dt) <= 0) { m.gT = 0.6; const c = cellOf(levelCells(S, m.deckY - 1), tlx, tlz); if (c) { gx = c[0]; gz = c[1]; } }
        speed = def.speed;
        if (hd < 2.1 && Math.abs(tgt.y - m.y) < 2 && m.atkT <= 0) { damagePlayer(room, tgt, def.dmg, { kind: 'mob', name: def.name }, [(dx / (hd || 1)) * 5, 4, (dz / (hd || 1)) * 5]); m.atkT = 1.0; m.swing = 0.4; }
      }
    } else if (gx === null || gx === undefined || Math.hypot(gx - lx, gz - lz) < 0.3 || rnd() < 0.004) { // wander between cells of the deck
      const cs = [...levelCells(S, m.deckY - 1)], c = cs.length ? cs[(rnd() * cs.length) | 0] : null; if (c) { const [a, b] = c.split(',').map(Number); gx = a; gz = b; }
    }
    let moving = false;
    if (gx !== null && gx !== undefined) {
      const cells = levelCells(S, m.deckY - 1), d = Math.hypot(gx - lx, gz - lz);
      if (d > 0.15 && cells.size) {
        // head for the goal itself when it is in the same cell, else for the next cell on the way round whatever is in the road
        let wx = gx, wz = gz; const a = cellOf(cells, lx, lz), g = cellOf(cells, gx, gz);
        if (a && g && (a[0] !== g[0] || a[1] !== g[1])) { const n = nextCell(cells, a, g); if (n) { wx = n[0]; wz = n[1]; } else gx = null; }
        if (gx !== null) {
          const dx = wx - lx, dz = wz - lz, dd = Math.hypot(dx, dz) || 1, mv = Math.min(speed * dt, dd), sx = (dx / dd) * mv, sz = (dz / dd) * mv;
          if (bodyOk(cells, lx + sx, lz + sz)) { lx += sx; lz += sz; moving = true; } else if (bodyOk(cells, lx + sx, lz)) { lx += sx; moving = true; } else if (bodyOk(cells, lx, lz + sz)) { lz += sz; moving = true; }
          else if (!bodyOk(cells, lx, lz) && a) { lx += (a[0] - lx) * Math.min(1, 4 * dt); lz += (a[1] - lz) * Math.min(1, 4 * dt); moving = true; } // (found itself half in a block: slide back to the middle of its cell)
          else gx = null;
          if (faceX === null) { faceX = dx; faceZ = dz; }
        }
      }
    }
    m.lx = lx; m.lz = lz; m.gx = gx; m.gz = gz; m.moving = moving;
    if (faceX !== null && (faceX || faceZ)) m.ly = wrap(Math.atan2(-faceX, -faceZ)); // (the way it faces, in the ship's frame)
    const [x, y, z] = toWorld(S, lx, m.deckY, lz, t); m.x = x; m.y = y; m.z = z;
    m.yaw += wrap(S.yaw + (m.ly || 0) - m.yaw) * Math.min(1, 10 * dt);
  }
}
// A pirate ship rarely appears out on deep water, some way from a player. It needs open sea all round (no ground within its length) and nothing sticking out of the water.
export function trySpawnPirateShip(room, p) {
  const ships = shipsOf(room); let all = 0;
  for (const S of ships.values()) if (S.kind === 'pirate') { all++; if (Math.hypot(S.x - p.x, S.z - p.z) < 200) return false; }
  if (all >= 1 + room.players.size) return false;
  const sea = seaOf(room.gen);
  for (let tries = 0; tries < 10; tries++) {
    const a = rnd() * 6.2832, d = 60 + rnd() * 40, x = fl(p.x + Math.cos(a) * d), z = fl(p.z + Math.sin(a) * d);
    let ok = true;
    for (let dx = -20; dx <= 20 && ok; dx += 8) for (let dz = -20; dz <= 20; dz += 8) if (sea - column(x + dx, z + dz, room.seed, room.gen).h < 5) { ok = false; break; } // deep water all round, natural sea floor well down
    if (!ok) continue;
    const sf = surfaceAt(room, x + 0.5, z + 0.5, sea); if (sf === null) continue;
    for (let dx = -18; dx <= 18 && ok; dx += 3) for (let dz = -18; dz <= 18 && ok; dz += 3) for (let y = fl(sf); y <= fl(sf) + 9; y += 3) { const id = blockAt(room, x + dx, y, z + dz, false); if (id > 0 && isSolid(id)) { ok = false; break; } } // nothing built or growing out of the water there
    if (!ok) continue;
    const ps = pirateShipBlocks(), S = newShip(room, 'pirate', x + 0.5, 0, z + 0.5, rnd() * 6.2832, ps.blocks, { draft: 1.0 });
    S.y = sf - S.draft - S.b.y0;
    const crew = 3 + ((rnd() * 3) | 0), deck = S.deck.filter(([, cy, cz]) => cy === ps.deckY - 1 && cz < 0 && cz > -13); // (only the deck floor: not a rail, a mast top or the bowsprit)
    for (let i = 0; i < crew && deck.length; i++) {
      const c = deck[(rnd() * deck.length) | 0], m = spawnMob(room, 'pirate', S.x, S.y, S.z);
      Object.assign(m, { shipId: S.id, lx: c[0], lz: c[2], deckY: c[1] + 1, aux: i % 2 === 0 ? 0 : 1, ly: rnd() * 6.28, gx: null, gz: null, moving: false });
      S.crew.push(m.id);
    }
    return true;
  }
  return false;
}
// What a player is told about the ships near them: the block list when it is new or changed, and every update the ship's place.
export function shipsMsg(room, p) {
  const ships = room.ships, out = [], seen = (p.shipVer ||= new Map());
  if (!ships || !ships.size) { seen.clear(); return out; }
  for (const S of ships.values()) {
    if ((S.x - p.x) ** 2 + (S.z - p.z) ** 2 > 140 * 140) { seen.delete(S.id); continue; }
    if (seen.get(S.id) !== S.ver) {
      seen.set(S.id, S.ver);
      const b = []; for (const [k, id] of S.blocks) { const [x, y, z] = unbk(k); b.push(x, y, z, id); }
      send(p.ws, { t: 'ship', op: 'blocks', id: S.id, kind: S.kind === 'pirate' ? 1 : 0, ver: S.ver, b });
    }
    out.push([S.id, S.kind === 'pirate' ? 1 : 0, r2(S.x), r2(S.y), r2(S.z), r2(S.yaw), S.ver, r2(S.speed), S.helm]);
  }
  for (const id of [...seen.keys()]) if (!ships.has(id)) seen.delete(id);
  return out;
}
export function releaseHelm(room, p) { const S = p.helmShip && shipsOf(room).get(p.helmShip); if (S && S.helm === p.id) { S.helm = 0; S.inF = S.inS = 0; } p.helmShip = 0; }
