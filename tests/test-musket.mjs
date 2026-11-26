// Headless checks for the day cycle, the recipes and the musket (run with: npm test)
import assert from 'node:assert/strict';
import { PHASES, CYCLE_MS, msToTick, tickToMs, isNightTick, tickAngle, angleTick } from '../public/shared/daycycle.js';
import { I, ITEMS, matchRecipe, ANY_PLANKS, MUSKET } from '../public/shared/items.js';
import { B } from '../public/shared/world.js';
import { mk } from '../server/inventory.js';
import { initPlayer, handle } from '../server/survival.js';
import { tickEnts, spawnMob, isNight } from '../server/ents.js';
import { NEW_GEN } from '../public/shared/world.js';

const MIN = 60000;
// ---- day cycle: each phase lasts what the schedule says
assert.equal(CYCLE_MS, 20 * MIN);
assert.equal(msToTick(0), 0);
assert.equal(Math.round(msToTick(10 * MIN)), 12000);          // daytime is 10 minutes
assert.equal(Math.round(msToTick(11.5 * MIN)), 13000);        // dusk is 1.5 minutes
assert.equal(Math.round(msToTick(18.5 * MIN)), 23000);        // night is 7 minutes
assert.equal(Math.round(msToTick(20 * MIN - 1)), 24000);
assert.equal(Math.round(tickToMs(12000)), 10 * MIN); assert.equal(Math.round(tickToMs(13000)), 11.5 * MIN); assert.equal(Math.round(tickToMs(23000)), 18.5 * MIN);
for (const t of [0, 100, 6000, 11999, 12500, 13000, 18000, 22999, 23500]) assert.ok(Math.abs(msToTick(tickToMs(t)) - t) < 1e-6, 'round trip ' + t);
assert.ok(msToTick(-5 * MIN) >= 0 && msToTick(-5 * MIN) < 24000, 'negative time wraps');
assert.ok(!isNightTick(12999) && isNightTick(13000) && isNightTick(22999) && !isNightTick(23000));
assert.ok(Math.abs(angleTick(tickAngle(13000)) - 13000) < 2);
// how long does the server consider it night? (sample the real isNight)
{ const room = { created: 0, dayMs: CYCLE_MS }; const realNow = Date.now; let nightMs = 0; const step = 1000;
  for (let ms = 0; ms < CYCLE_MS; ms += step) { Date.now = () => ms; if (isNight(room)) nightMs += step; } Date.now = realNow;
  assert.equal(nightMs, 7 * MIN, 'isNight lasts 7 minutes per cycle'); }
console.log('day cycle ok');

// ---- recipes
assert.ok(ITEMS.get(I.MUSKET).gun && ITEMS.get(I.MUSKET_BALL));
let r = matchRecipe([I.IRON_INGOT, 0, 0, 0], 2, 2); assert.deepEqual([r.out, r.n], [I.MUSKET_BALL, 4]);
const P = B.PLANKS;
r = matchRecipe([I.IRON_INGOT, I.IRON_INGOT, I.IRON_INGOT, P, I.FLINT, 0, P, 0, 0], 3, 3); assert.equal(r && r.out, I.MUSKET);
r = matchRecipe([I.IRON_INGOT, I.IRON_INGOT, I.IRON_INGOT, 0, I.FLINT, P, 0, 0, P], 3, 3); assert.equal(r && r.out, I.MUSKET, 'mirrored musket recipe');
console.log('recipes ok');

// ---- the musket on a server
const sent = [], ws = { readyState: 1, bufferedAmount: 0, send: (s) => sent.push(JSON.parse(s)) };
const room = { id: 't', seed: 1, gen: NEW_GEN, created: Date.now(), dayMs: CYCLE_MS, mode: 'survival', pvp: true, cheats: false, claims: new Map(), ec: new Map(), locked: false, perm: { build: true, containers: true },
  edits: new Map(), containers: new Map(), players: new Map(), mobs: new Map(), items: new Map(), arrows: new Map(), boats: new Map(), tame: {}, entId: 0, nextId: 1, fall: new Map(), wq: new Set(), lq: new Set(), markDirty() {} };
// ungenerated ground counts as solid on the server, so carve a corridor of air for the test shots (the floor below stays solid)
for (let x = -1; x <= 1; x++) for (let y = 150; y <= 153; y++) for (let zz = -1; zz <= 60; zz++) room.edits.set(`${x},${y},${zz}`, 0);
const p = { id: 1, name: 'Tester', ws, x: 0.5, y: 150, z: 0.5, yaw: 0, pitch: 0 };
initPlayer(p, room, null); room.players.set(1, p);
p.inv[0] = mk(I.MUSKET, 1); p.inv[1] = mk(I.MUSKET_BALL, 3); p.inv[2] = mk(I.GUNPOWDER, 2); p.sel = 0;
const z = spawnMob(room, 'zombie', 0.5, 150, 12.5); z.hp = 20; z.max = 20;
const shoot = () => handle(room, p, { t: 'shoot', dx: 0, dy: 0, dz: 1, ch: 1 });
shoot();
assert.equal(room.arrows.size, 1, 'one ball in flight'); const ball = [...room.arrows.values()][0]; assert.ok(ball.ball && ball.dmg === MUSKET.dmg);
assert.equal(p.inv[1].n, 2, 'a musket ball is used'); assert.equal(p.inv[2].n, 1, 'one gunpowder is used');
assert.ok(sent.some((m) => m.t === 'fx' && m.k === 'shot'), 'muzzle fx sent');
shoot(); assert.equal(room.arrows.size, 1, 'long cooldown: no second shot'); assert.equal(p.inv[1].n, 2);
for (let i = 0; i < 10 && room.arrows.size; i++) tickEnts(room, 0.05);
assert.equal(room.arrows.size, 0, 'the ball is gone after hitting');
assert.ok(room.mobs.get(z.id) ? room.mobs.get(z.id).hp <= 20 - MUSKET.dmg + 0.01 : true, 'the zombie took ' + MUSKET.dmg + ' damage (or died): hp ' + (room.mobs.get(z.id) && room.mobs.get(z.id).hp));
// reload over: fire again; then no powder left after the last charge -> cannot fire
p.gunReady = 0; shoot(); assert.equal(room.arrows.size, 1); assert.equal(p.inv[2], null, 'last gunpowder used up');
room.arrows.clear(); p.gunReady = 0; shoot(); assert.equal(room.arrows.size, 0, 'no gunpowder: no shot');
assert.ok(sent.some((m) => m.t === 'chat' && /gunpowder/.test(m.m)), 'told about the gunpowder');
p.inv[2] = mk(I.GUNPOWDER, 1); p.inv[1] = null; p.gunReady = 0; shoot(); assert.equal(room.arrows.size, 0, 'no musket ball: no shot');
// a fast ball must not tunnel through a thin target 60 blocks away
{ room.arrows.clear(); room.mobs.clear(); p.inv[1] = mk(I.MUSKET_BALL, 1); p.inv[2] = mk(I.GUNPOWDER, 1); p.gunReady = 0;
  const far = spawnMob(room, 'zombie', 0.5, 150, 40.5); const hp0 = far.hp; shoot();
  for (let i = 0; i < 30 && room.arrows.size; i++) tickEnts(room, 0.05);
  const after = room.mobs.get(far.id); assert.ok(!after || after.hp < hp0, 'ball reached the far target'); }
// the snapshot carries a ball flag
console.log('musket ok');
