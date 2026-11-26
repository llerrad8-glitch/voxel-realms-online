// Headless checks for ships, cannons and pirates (run with: node tests/test-ships.mjs)
import assert from 'node:assert/strict';
import { I, matchRecipe, GUNS, MUSKET, ITEMS } from '../public/shared/items.js';
import { B, NEW_GEN } from '../public/shared/world.js';
import { SHIP_MAX, bk, toWorld, toLocal, pirateShipBlocks } from '../public/shared/ships.js';
import { CYCLE_MS } from '../public/shared/daycycle.js';
import { initPlayer, handle } from '../server/survival.js';
import { mk } from '../server/inventory.js';
import { tickEnts, entsFor } from '../server/ents.js';
import { shipsOf, trySpawnPirateShip, tickShips, shipsMsg, shipSweepAt } from '../server/ships.js';

assert.ok(GUNS[I.FLINTLOCK].reloadMs < MUSKET.reloadMs && GUNS[I.FLINTLOCK].dmg < MUSKET.dmg, 'pistol: faster but weaker');
assert.equal(ITEMS.get(I.MUSKET_BALL).n, 'Musket Ball');
const sent = [], ws = { readyState: 1, bufferedAmount: 0, send: (s) => sent.push(JSON.parse(s)) };
const room = { id: 't', seed: 41, gen: NEW_GEN, created: Date.now(), dayMs: CYCLE_MS, mode: 'survival', pvp: true, cheats: false, claims: new Map(), ec: new Map(), locked: false, perm: { build: true, containers: true },
  edits: new Map(), containers: new Map(), players: new Map(), mobs: new Map(), items: new Map(), arrows: new Map(), boats: new Map(), ships: new Map(), tame: {}, entId: 0, nextId: 1, fall: new Map(), wq: new Set(), lq: new Set(), markDirty() {} };
// a patch of sea (water edits over air) with a floor of sand under it
const Y = 150;
for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) { room.edits.set(`${x},${Y - 1},${z}`, B.SAND); for (let y = Y; y <= Y + 4; y++) room.edits.set(`${x},${y},${z}`, y <= Y + 2 ? B.WATER : 0); }
const p = { id: 1, name: 'Tester', ws, th: 'a'.repeat(32), vid: 'v', x: 0.5, y: Y + 3.2, z: 6.5, yaw: 0, pitch: 0 };
initPlayer(p, room, null); room.players.set(1, p);
// a 6-block raft on the water, then the wheel
for (let x = 0; x < 3; x++) for (let z = 0; z < 2; z++) room.edits.set(`${x},${Y + 2},${z}`, B.PLANKS);
p.inv[0] = mk(B.STEERING_WHEEL, 1); p.sel = 0;
handle(room, p, { t: 'use', x: 1, y: Y + 2, z: 1, nx: 0, ny: 1, nz: 0 });
assert.equal(shipsOf(room).size, 1, 'the wheel made a ship'); const S = [...shipsOf(room).values()][0];
assert.equal(S.blocks.size, 7); assert.equal(SHIP_MAX, pirateShipBlocks().blocks.size, 'a ship may be as big as a pirate ship'); assert.equal(p.inv[0], null, 'the wheel was used');
assert.ok(!room.edits.has(`0,${Y + 2},0`) || room.edits.get(`0,${Y + 2},0`) === 0, 'the raft left the world');
for (let i = 0; i < 100; i++) tickShips(room, 0.05);
assert.ok(S.y > Y + 2 && S.y < Y + 4, 'floats at the surface: ' + S.y);
// sailing
p.x = S.x; p.y = S.y + 1; p.z = S.z; handle(room, p, { t: 'ship', op: 'helm', id: S.id });
assert.equal(S.helm, 1); handle(room, p, { t: 'ship', op: 'steer', id: S.id, f: 1, s: 0 });
const z0 = S.z; for (let i = 0; i < 100; i++) tickShips(room, 0.05); assert.ok(S.z < z0 - 1, 'it sailed forward (toward -z)');
// too big
const big = new Map(); for (let x = 0; x < 18; x++) for (let z = 0; z < 17; z++) big.set(`${x + 10},${Y + 2},${z + 10}`, B.PLANKS); // 306 blocks: more than a pirate ship has
for (const [k, v] of big) room.edits.set(k, v);
p.inv[0] = mk(B.STEERING_WHEEL, 1); handle(room, p, { t: 'use', x: 12, y: Y + 2, z: 12, nx: 0, ny: 1, nz: 0 });
assert.equal(shipsOf(room).size, 1, 'a build bigger than a pirate ship is refused'); assert.ok(p.inv[0], 'the wheel was kept');
// cannon on the ship: load + fire
S.blocks.set(bk(1, 0, 0), 214); S.blocks.set(bk(2, 0, 0), B.PLANKS); S.helm = 0; // (adds a cannon facing +x)
import('../server/ships.js').then(async (m) => {
  const mod = await import('../server/ships.js'); // refresh is exported
  mod.refresh(S);
  p.x = S.x; p.y = S.y + 1; p.z = S.z; p.inv[1] = mk(I.GUNPOWDER, 2); p.inv[2] = mk(I.CANNONBALL, 2);
  p.sel = 2; handle(room, p, { t: 'ship', op: 'cannon', id: S.id, x: 1, y: 0, z: 0, act: 'fire' }); assert.equal(room.arrows.size, 0, 'unloaded: no shot');
  p.sel = 1; handle(room, p, { t: 'ship', op: 'cannon', id: S.id, x: 1, y: 0, z: 0, act: 'load' }); assert.equal(p.inv[1].n, 1, 'gunpowder used to load');
  p.sel = 2; handle(room, p, { t: 'ship', op: 'cannon', id: S.id, x: 1, y: 0, z: 0, act: 'fire' });
  assert.equal(room.arrows.size, 1, 'the cannon fired'); assert.equal(p.inv[2].n, 1, 'a cannonball used'); assert.equal([...room.arrows.values()][0].ball, 2);
  handle(room, p, { t: 'ship', op: 'cannon', id: S.id, x: 1, y: 0, z: 0, act: 'fire' }); assert.equal(room.arrows.size, 1, 'must be loaded again each time');
  // a pirate ship
  room.mobs.clear(); let made = false; for (let i = 0; i < 400 && !made; i++) made = trySpawnPirateShip(room, { x: 0, z: 0 });
  console.log('pirate ship spawn on a test sea (natural terrain decides):', made);
  const msg = shipsMsg(room, p); assert.ok(msg.length >= 1); assert.ok(sent.some((x) => x.t === 'ship' && x.op === 'blocks'));
  // let the pirates and their ship run for a while with a player sailing nearby: nothing may throw, the crew stays on deck, the ship stays afloat and the cannons fire
  const P = [...shipsOf(room).values()].find((x) => x.kind === 'pirate'); assert.ok(P, 'a pirate ship exists'); assert.ok(P.crew.length >= 3);
  for (const id of P.crew) assert.equal(room.mobs.get(id).type, 'pirate');
  for (const x of P.blocks.values()) assert.ok([B.PLANKS, B.SPRUCE_PLANKS, B.BIRCH_PLANKS, B.LOG, B.SPRUCE_LOG, B.STEERING_WHEEL, 214, 215].includes(x), 'only wood and its fittings: ' + x);
  p.x = P.x + 25; p.z = P.z; p.y = P.y; p.hp = 1e9; let shots = 0, steps = 0;
  for (let i = 0; i < 1200; i++) { tickEnts(room, 0.05); p.hp = 20; if (room.arrows.size) shots++; steps++; p.x = P.x + 25; p.z = P.z; }
  assert.ok(shots > 0, 'the pirates shoot'); assert.ok(shipsOf(room).has(P.id));
  for (const id of P.crew) { const m = room.mobs.get(id); if (m) { assert.ok(P.walk.has(`${Math.round(m.lx)},${m.deckY - 1},${Math.round(m.lz)}`), 'a pirate stays on the deck'); } }
  // pirates spawn on the deck floor and keep moving about it (no rails, no mast tops, never stuck in one place)
  for (const id of P.crew) { const m = room.mobs.get(id); if (m) assert.equal(m.deckY, 0, 'a pirate stands on the deck floor'); }
  p.x = P.x + 100; p.z = P.z; // (a player too far to be seen: the pirates wander)
  const seen = new Map(P.crew.map((id) => [id, new Set()]));
  for (let i = 0; i < 1500; i++) { p.x = P.x + 100; p.z = P.z; p.y = P.y; tickShips(room, 0.05); for (const id of P.crew) { const m = room.mobs.get(id); if (m) { seen.get(id).add(`${Math.round(m.lx)},${Math.round(m.lz)}`); assert.ok(P.walk.has(`${Math.round(m.lx)},-1,${Math.round(m.lz)}`), 'a pirate stays on the deck'); } } }
  assert.ok([...seen.values()].some((v) => v.size >= 4), 'the pirates walk about the deck');
  console.log('ships tests ok');
});
