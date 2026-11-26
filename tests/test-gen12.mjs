// Headless checks for generation 12: flintlock, shotgun, shells, paper, ore blocks, birds (run with: npm test)
import assert from 'node:assert/strict';
import { I, ITEMS, GUNS, matchRecipe, ANY_PLANKS, SMELT, FOOD, blockDrops, canHarvest } from '../public/shared/items.js';
import { B, BLOCKS } from '../public/shared/world.js';
import { MOBS, MOB_TYPES } from '../public/shared/mobs.js';

const P = B.PLANKS;
// ---- recipes
let r = matchRecipe([I.IRON_INGOT, I.IRON_INGOT, 0, P, I.FLINT, 0, P, 0, 0], 3, 3); assert.equal(r && r.out, I.FLINTLOCK, 'flintlock: two iron');
r = matchRecipe([0, I.IRON_INGOT, I.IRON_INGOT, 0, I.FLINT, P, 0, 0, P], 3, 3); assert.equal(r && r.out, I.FLINTLOCK, 'flintlock mirrored');
r = matchRecipe([I.IRON_INGOT, I.IRON_INGOT, B.IRON_BLOCK, P, I.FLINT, 0, P, 0, 0], 3, 3); assert.equal(r && r.out, I.SHOTGUN, 'shotgun: one iron is an iron block');
r = matchRecipe([I.IRON_INGOT, I.IRON_INGOT, I.IRON_INGOT, P, I.FLINT, 0, P, 0, 0], 3, 3); assert.equal(r && r.out, I.MUSKET, 'musket unchanged');
r = matchRecipe([B.SUGAR_CANE, B.SUGAR_CANE, B.SUGAR_CANE, 0, 0, 0, 0, 0, 0], 3, 3); assert.deepEqual([r.out, r.n], [I.PAPER, 3]);
const Q = I.PAPER; r = matchRecipe([Q, Q, Q, Q, I.IRON_INGOT, Q, Q, Q, Q], 3, 3); assert.equal(r && r.out, I.SHOTGUN_SHELL, 'shell: iron surrounded by paper');
for (const [it, bl] of [[I.COAL, B.COAL_BLOCK], [I.IRON_INGOT, B.IRON_BLOCK], [I.GOLD_INGOT, B.GOLD_BLOCK], [I.DIAMOND, B.DIAMOND_BLOCK]]) {
  r = matchRecipe(Array(9).fill(it), 3, 3); assert.equal(r && r.out, bl); r = matchRecipe([bl, 0, 0, 0], 2, 2); assert.deepEqual([r.out, r.n], [it, 9]);
  assert.ok(ITEMS.get(bl) && ITEMS.get(bl).block === bl, 'the block is an item');
}
// ---- guns
assert.ok(GUNS[I.FLINTLOCK].dmg < GUNS[I.MUSKET].dmg && GUNS[I.FLINTLOCK].reloadMs < GUNS[I.MUSKET].reloadMs, 'flintlock: faster but weaker');
assert.equal(GUNS[I.SHOTGUN].pellets, 20, 'shotgun fires twenty pellets');
assert.equal(GUNS[I.SHOTGUN].dmg, MOBS.seagle.hp, 'one pellet is just enough to take down a seagle');
assert.ok(GUNS[I.SHOTGUN].ammo.some(([i]) => i === I.SHOTGUN_SHELL));
for (const id of [I.FLINTLOCK, I.SHOTGUN]) assert.ok(ITEMS.get(id).gun);
assert.ok(!canHarvest(B.GOLD_BLOCK, { id: I.IRON_INGOT }) && blockDrops(B.IRON_BLOCK, { id: 292 })[0][0] === B.IRON_BLOCK, 'iron block drops itself with a stone pickaxe');
// ---- birds
assert.ok(MOB_TYPES.includes('duck') && MOB_TYPES.includes('seagle') && MOB_TYPES.indexOf('salmon') === 11, 'old mob ids unchanged');
assert.equal(SMELT.get(I.RAW_DUCK), I.COOKED_DUCK); assert.equal(SMELT.get(I.RAW_SEAGLE), I.COOKED_SEAGLE);
assert.ok(FOOD.get(I.COOKED_DUCK) && FOOD.get(I.COOKED_SEAGLE));
assert.ok(MOBS.duck.drops.some((d) => d[0] === I.RAW_DUCK) && MOBS.seagle.drops.some((d) => d[0] === I.RAW_SEAGLE));
console.log('gen12 recipes, guns and items ok');

// ---- the guns and birds on a server
import { handle, initPlayer, damagePlayer } from '../server/survival.js';
import { tickEnts, spawnMob, hurtMob } from '../server/ents.js';
import { mk } from '../server/inventory.js';
import { NEW_GEN } from '../public/shared/world.js';
const sent = [], ws = { readyState: 1, bufferedAmount: 0, send: (s) => sent.push(JSON.parse(s)) };
const room = { id: 't', seed: 1, gen: NEW_GEN, created: Date.now(), dayMs: 1200000, mode: 'survival', pvp: true, cheats: false, claims: new Map(), ec: new Map(), locked: false, perm: { build: true, containers: true },
  edits: new Map(), containers: new Map(), players: new Map(), mobs: new Map(), items: new Map(), arrows: new Map(), boats: new Map(), tame: {}, entId: 0, nextId: 1, fall: new Map(), wq: new Set(), lq: new Set(), markDirty() {} };
for (let x = -1; x <= 1; x++) for (let y = 150; y <= 153; y++) for (let zz = -1; zz <= 60; zz++) room.edits.set(`${x},${y},${zz}`, 0);
const p = { id: 1, name: 'Tester', ws, x: 0.5, y: 150, z: 0.5, yaw: 0, pitch: 0 };
initPlayer(p, room, null); room.players.set(1, p);
const shoot = () => handle(room, p, { t: 'shoot', dx: 0, dy: 0, dz: 1, ch: 1 });
// flintlock: a ball + gunpowder, and a shorter reload than the musket
p.inv[0] = mk(I.FLINTLOCK, 1); p.inv[1] = mk(I.MUSKET_BALL, 2); p.inv[2] = mk(I.GUNPOWDER, 2); p.sel = 0;
shoot(); assert.equal(room.arrows.size, 1); assert.equal([...room.arrows.values()][0].dmg, GUNS[I.FLINTLOCK].dmg); assert.equal(p.inv[1].n, 1); assert.equal(p.inv[2].n, 1);
shoot(); assert.equal(room.arrows.size, 1, 'still reloading');
assert.ok(p.gunReady - Date.now() <= GUNS[I.FLINTLOCK].reloadMs + 5);
// the reload is shared: swapping to a musket right after firing does not skip it
p.inv[3] = mk(I.MUSKET, 1); p.sel = 3; shoot(); assert.equal(room.arrows.size, 1, 'swapping guns does not skip the reload');
// shotgun: a shell only (no gunpowder), a fan of pellets
room.arrows.clear(); p.gunReady = 0; p.inv[4] = mk(I.SHOTGUN, 1); p.inv[5] = mk(I.SHOTGUN_SHELL, 2); p.sel = 4;
p.inv[1] = null; p.inv[2] = null; shoot(); assert.equal(room.arrows.size, 20, 'twenty pellets');
assert.ok([...room.arrows.values()].every((a) => a.shotId), 'shotgun pellets share a shot id'); assert.equal(p.inv[5].n, 1, 'one shell used');
assert.ok([...room.arrows.values()].every((a) => Math.abs(a.life * 62 - (p.viewR + 8)) < 1), 'pellets fly as far as the view distance (like every bullet)');
room.arrows.clear(); p.gunReady = 0; p.inv[5] = null; sent.length = 0; shoot(); assert.equal(room.arrows.size, 0, 'no shell, no shot'); assert.ok(sent.some((m) => m.t === 'chat' && /shotgun shell/.test(m.m)));
console.log('gen12 guns ok');

// A shotgun blast can damage a player with up to five pellets, even though ordinary hit-invulnerability is active.
const target = { id: 2, name: 'Target', ws, x: 5, y: 150, z: 5 };
initPlayer(target, room, null); target.hp = 100; room.players.set(target.id, target);
for (let i = 0; i < 20; i++) damagePlayer(room, target, GUNS[I.SHOTGUN].dmg, { kind: 'arrow', name: 'Tester', shotId: 'test-shot-1' }, [0, 0, 1]);
assert.equal(target.hp, 70, 'only five pellets from one shell deal damage');
target.invul = 0; // a later shell arrives after the normal hit-invulnerability window
for (let i = 0; i < 20; i++) damagePlayer(room, target, GUNS[I.SHOTGUN].dmg, { kind: 'arrow', name: 'Tester', shotId: 'test-shot-2' }, [0, 0, 1]);
assert.equal(target.hp, 40, 'a new shell starts a new five-pellet damage count');

// Mobs also take damage from at most five pellets per shotgun shell.
const mobTarget = { id: 9001, type: 'pig', size: 1, hp: 100, tame: false, hurtT: 0, vx: 0, vy: 0, vz: 0 };
room.mobs.set(mobTarget.id, mobTarget);
for (let i = 0; i < 20; i++) hurtMob(room, mobTarget, GUNS[I.SHOTGUN].dmg, null, null, 'mob-test-shot-1');
assert.equal(mobTarget.hp, 70, 'mobs take damage from only five pellets per shell');
for (let i = 0; i < 20; i++) hurtMob(room, mobTarget, GUNS[I.SHOTGUN].dmg, null, null, 'mob-test-shot-2');
assert.equal(mobTarget.hp, 40, 'a second shell gets its own five-pellet mob damage cap');
room.mobs.delete(mobTarget.id);

// birds: a floating duck stays on the water, a flock keeps flying, a seagle dives and surfaces
room.mobs.clear(); room.arrows.clear();
const sea = 70;
for (let x = -12; x <= 12; x++) for (let z = 80; z <= 104; z++) for (let y = 60; y <= 69; y++) room.edits.set(`${x},${y},${z}`, 5); // a little pond to float on
for (let x = -12; x <= 12; x++) for (let z = 80; z <= 104; z++) for (let y = 70; y <= 110; y++) room.edits.set(`${x},${y},${z}`, 0);
for (let x = -12; x <= 12; x++) for (let z = 80; z <= 104; z++) room.edits.set(`${x},59,${z}`, 3);
p.x = 60.5; p.y = 72; p.z = 92.5; // (far from the pond: a duck only takes off when you come close)
const duck = spawnMob(room, 'duck', 0.5, sea - 0.15, 92.5, { size: 1 });
for (let i = 0; i < 200; i++) tickEnts(room, 0.05);
assert.ok(room.mobs.has(duck.id), 'duck alive'); assert.equal(duck.aux, 0, 'sits on the water'); assert.ok(Math.abs(duck.y - (sea - 0.14)) < 0.6 && duck.y < sea + 0.5, 'duck y ' + duck.y);
// a player coming close: the duck first RUNS across the water away from them (wings beating), then takes off
{ const x0 = duck.x; p.x = x0 - 6; p.z = duck.z; tickEnts(room, 0.05); tickEnts(room, 0.05);
  assert.equal(duck.aux, 2, 'startled duck runs first'); for (let i = 0; i < 8; i++) tickEnts(room, 0.05);
  assert.ok(duck.x > x0 + 1, 'it ran away from the player: ' + (duck.x - x0)); assert.ok(duck.y < sea + 0.5, 'still on the water while running');
  for (let i = 0; i < 40; i++) tickEnts(room, 0.05); assert.equal(duck.aux, 1, 'then it flies away'); room.mobs.delete(duck.id); p.x = 60.5; }
console.log('duck runs then flies ok');
// flock
const flockDucks = []; const fid = 777; room.flocks = new Map([[fid, { id: fid, cx: 0, cz: 92, ang: 0, rad: 20, dir: 1, alt: 20, x: 20, z: 92, y: 90, hd: 1.5, dr: 0, stamp: -1 }]]);
for (let i = 0; i < 4; i++) { const d = spawnMob(room, 'duck', 5 + i, 90, 92, { size: 1 }); d.flock = fid; d.slot = i; flockDucks.push(d); }
const y0 = flockDucks.map((d) => d.y); for (let i = 0; i < 200; i++) tickEnts(room, 0.05);
assert.ok(flockDucks.every((d) => room.mobs.has(d.id) && d.aux === 1), 'flock flying'); assert.ok(flockDucks.every((d) => d.y > sea + 5), 'flock high in the sky');
// seagle
const sg = spawnMob(room, 'seagle', 0.5, sea + 16, 92.5); sg.sg = { mode: 'cruise', cx: 0.5, cz: 92.5, ang: 0, rad: 6, dir: 1, alt: 16, t: 0, dive: 0.1, tx: 0, ty: 0, tz: 0, under: 0 };
const seen = new Set(); let minY = 1e9; for (let i = 0; i < 400; i++) { tickEnts(room, 0.05); seen.add(sg.aux); minY = Math.min(minY, sg.y); }
assert.ok(seen.has(1) && seen.has(2) && seen.has(3) && seen.has(4), 'seagle cruises, dives, goes under and climbs: ' + [...seen]); assert.ok(minY < sea, 'it went below the surface: ' + minY);
// killing a duck drops raw duck
room.items.clear(); for (let k = 0; k < 20; k++) { const d = spawnMob(room, 'duck', 0.5, sea, 92.5, { size: 2 }); hurtMob(room, d, 99, null); }
assert.ok([...room.items.values()].some((i) => i.st.id === I.RAW_DUCK), 'raw duck drops');
console.log('gen12 birds ok');
