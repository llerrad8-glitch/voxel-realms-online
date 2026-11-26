// Items, block properties, tools, armor, food, crafting and smelting. Used by both the browser and the server.
import { B, BLOCKS, isWater, isLava, isVariant, WATER_FALL, isLayer, layerKind, layerN, COLORS, WOOL0, FLOWER0, PLANKS_IDS, woolColor, bedColor, WHEAT0, SAPLING0, BUSH0, COCOA0 } from './world.js';

export const I = {
  STICK: 256, COAL: 257, IRON_INGOT: 258, GOLD_INGOT: 259, DIAMOND: 260, FLINT: 261, APPLE: 262, ROTTEN: 263, BONE: 264, STRING: 265,
  ARROW: 266, FEATHER: 267, LEATHER: 268, GUNPOWDER: 269, SLIME: 270,
  RAW_PORK: 271, COOKED_PORK: 272, RAW_BEEF: 273, STEAK: 274, RAW_CHICKEN: 275, COOKED_CHICKEN: 276, RAW_MUTTON: 277, COOKED_MUTTON: 278, RAW_RABBIT: 279, COOKED_RABBIT: 280,
  BOW: 281, BUCKET: 282, WATER_BUCKET: 283, RAW_SALMON: 284, COOKED_SALMON: 285, BED: 286, SHIELD: 287, DOOR: 288,
  TROPICAL_FISH: 343, SEAWEED: 344,
  // Generation 8: 400..404 hoes (wooden, stone, iron, golden, diamond), farming, golden apple and fishing rod.
  WHEAT_SEEDS: 410, WHEAT: 411, BREAD: 412, GOLDEN_APPLE: 413, FISHING_ROD: 414,
  // Generation 10: berries (blackberry, strawberry, huckleberry: kind 0, 1, 2), banana, pine sap, sugar, cocoa beans, chocolate, cookie, lava bucket.
  BLACKBERRY: 415, STRAWBERRY: 416, HUCKLEBERRY: 417, BANANA: 418, PINE_SAP: 419, SUGAR: 420, COCOA: 421, CHOCOLATE: 422, COOKIE: 423, LAVA_BUCKET: 424,
  // Generation 11: the musket and its musket balls (a shot also burns one gunpowder).
  MUSKET: 425, MUSKET_BALL: 426,
  // Generation 12: flintlock pistol, shotgun, shotgun shell, paper (from sugar cane), and the birds' meat.
  FLINTLOCK: 427, SHOTGUN: 428, SHOTGUN_SHELL: 429, PAPER: 430, RAW_DUCK: 431, COOKED_DUCK: 432, RAW_SEAGLE: 433, COOKED_SEAGLE: 434, CANNONBALL: 435,
};
export const hoeId = (mat) => 400 + mat, hoeMat = (id) => (id >= 400 && id <= 404 ? id - 400 : -1);
// Generation 7 items. 330..336 dyes, 340..342 boats (oak, spruce, birch), 345..350 the beds of the six colours after red (the red bed is I.BED),
// 360..366 dyed leather, 370..397 dyed leather armor (colour x 4 + piece). Colours are always 0 red, 1 orange, 2 yellow, 3 green, 4 blue, 5 indigo, 6 violet.
export const WOODS = ['Oak', 'Spruce', 'Birch', 'Pine', 'Jungle', 'Banana'];
export const dyeId = (c) => 330 + c, dyeColor = (id) => (id >= 330 && id <= 336 ? id - 330 : -1);
export const boatId = (k) => (k < 3 ? 340 + k : 348 + k), boatKind = (id) => (id >= 340 && id <= 342 ? id - 340 : id >= 351 && id <= 353 ? id - 348 : -1); // oak, spruce, birch are 340..342; pine and jungle boats are 351 and 352
export const bedItemId = (c) => (c === 0 ? I.BED : 344 + c), bedItemColor = (id) => (id === I.BED ? 0 : id >= 345 && id <= 350 ? id - 344 : -1);
export const leatherDyedId = (c) => 360 + c, leatherDyedColor = (id) => (id >= 360 && id <= 366 ? id - 360 : -1);
export const dyedArmorId = (type, c) => 370 + c * 4 + type, dyedArmorColor = (id) => (id >= 370 && id <= 397 ? ((id - 370) >> 2) : -1);
export const ANY_PLANKS = 9000; // in a recipe: planks of any wood
export const TOOL_KINDS = ['pickaxe', 'axe', 'shovel', 'sword'];
export const MATS = [
  { name: 'Wooden', speed: 2, lvl: 0, dur: 59, pickaxe: 2, axe: 3, shovel: 2, sword: 4, ing: ANY_PLANKS },
  { name: 'Stone', speed: 4, lvl: 1, dur: 131, pickaxe: 3, axe: 4, shovel: 3, sword: 5, ing: B.COBBLE },
  { name: 'Iron', speed: 6, lvl: 2, dur: 250, pickaxe: 4, axe: 5, shovel: 4, sword: 6, ing: I.IRON_INGOT },
  { name: 'Golden', speed: 12, lvl: 0, dur: 32, pickaxe: 2, axe: 3, shovel: 2, sword: 4, ing: I.GOLD_INGOT },
  { name: 'Diamond', speed: 8, lvl: 3, dur: 1561, pickaxe: 5, axe: 6, shovel: 5, sword: 7, ing: I.DIAMOND },
];
export const toolId = (kind, mat) => 290 + TOOL_KINDS.indexOf(kind) * 5 + mat;
export const ARMOR_TYPES = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];
export const ARMOR_MATS = [
  { name: 'Leather', f: 5, def: [1, 3, 2, 1], ing: I.LEATHER },
  { name: 'Iron', f: 15, def: [2, 6, 5, 2], ing: I.IRON_INGOT },
  { name: 'Golden', f: 7, def: [2, 5, 3, 1], ing: I.GOLD_INGOT },
  { name: 'Diamond', f: 33, def: [3, 8, 6, 3], ing: I.DIAMOND },
];
export const armorId = (type, mat) => 310 + type * 4 + mat;

export const FOOD = new Map([
  [I.RAW_PORK, [3, 1.8]], [I.COOKED_PORK, [8, 12.8]], [I.RAW_BEEF, [3, 1.8]], [I.STEAK, [8, 12.8]], [I.RAW_CHICKEN, [2, 1.2]], [I.COOKED_CHICKEN, [6, 7.2]],
  [I.RAW_MUTTON, [2, 1.2]], [I.COOKED_MUTTON, [6, 9.6]], [I.RAW_RABBIT, [3, 1.8]], [I.COOKED_RABBIT, [5, 6]], [I.APPLE, [4, 2.4]], [I.ROTTEN, [4, 0.8]],
  [I.RAW_SALMON, [2, 0.4]], [I.COOKED_SALMON, [6, 9.6]], [I.TROPICAL_FISH, [1, 0.2]],
  [I.BREAD, [5, 6]], [I.GOLDEN_APPLE, [4, 9.6]],
  [I.RAW_DUCK, [2, 1.2]], [I.COOKED_DUCK, [6, 9.6]], [I.RAW_SEAGLE, [2, 1.2]], [I.COOKED_SEAGLE, [6, 9.6]],
  [I.BLACKBERRY, [1, 0.6]], [I.STRAWBERRY, [2, 1.2]], [I.HUCKLEBERRY, [1, 0.6]], [I.BANANA, [3, 2.4]], [I.CHOCOLATE, [2, 1.2]], [I.COOKIE, [5, 2.4]], // (hunger points: 2 make one bar)
]);

/* ---------- item registry ---------- */
export const ITEMS = new Map();
const add = (o) => ITEMS.set(o.id, { max: 64, ...o });
for (let id = 1; id < BLOCKS.length; id++) if (!isWater(id) && !isLava(id) && !isVariant(id) && id !== B.BEDROCK) add({ id, n: BLOCKS[id].n, block: id });
const plain = {
  [I.STICK]: 'Stick', [I.COAL]: 'Coal', [I.IRON_INGOT]: 'Iron Ingot', [I.GOLD_INGOT]: 'Gold Ingot', [I.DIAMOND]: 'Diamond', [I.FLINT]: 'Flint', [I.APPLE]: 'Apple',
  [I.ROTTEN]: 'Rotten Flesh', [I.BONE]: 'Bone', [I.STRING]: 'String', [I.ARROW]: 'Arrow', [I.FEATHER]: 'Feather', [I.LEATHER]: 'Leather', [I.GUNPOWDER]: 'Gunpowder',
  [I.SLIME]: 'Slimeball', [I.RAW_PORK]: 'Raw Porkchop', [I.COOKED_PORK]: 'Cooked Porkchop', [I.RAW_BEEF]: 'Raw Beef', [I.STEAK]: 'Steak', [I.RAW_CHICKEN]: 'Raw Chicken',
  [I.COOKED_CHICKEN]: 'Cooked Chicken', [I.RAW_MUTTON]: 'Raw Mutton', [I.COOKED_MUTTON]: 'Cooked Mutton', [I.RAW_RABBIT]: 'Raw Rabbit', [I.COOKED_RABBIT]: 'Cooked Rabbit',
  [I.RAW_SALMON]: 'Raw Salmon', [I.COOKED_SALMON]: 'Cooked Salmon', [I.TROPICAL_FISH]: 'Tropical Fish',
};
for (const [id, n] of Object.entries(plain)) add({ id: +id, n, food: FOOD.get(+id) || null });
add({ id: I.BOW, n: 'Bow', max: 1, dur: 384, bow: true });
add({ id: I.BED, n: 'Red Bed', max: 1, bed: true, color: 0 });
add({ id: I.SHIELD, n: 'Shield', max: 1, dur: 336, shield: true });
add({ id: I.DOOR, n: 'Wooden Door', door: true });
add({ id: I.SEAWEED, n: 'Seaweed', seaweed: true });
add({ id: I.WHEAT_SEEDS, n: 'Wheat Seeds', seeds: true });
add({ id: I.WHEAT, n: 'Wheat' });
add({ id: I.BREAD, n: 'Bread', food: FOOD.get(I.BREAD) });
add({ id: I.GOLDEN_APPLE, n: 'Golden Apple', food: FOOD.get(I.GOLDEN_APPLE), always: true, heal: 8 }); // can be eaten even when you are not hungry, and heals four hearts
add({ id: I.FISHING_ROD, n: 'Fishing Rod', max: 1, dur: 64, rod: true });
// Generation 10. A berry or a banana is food, and right-clicking the top of a grass or dirt block with one plants it (plantAs: the block that goes there).
['Blackberry', 'Strawberry', 'Huckleberry'].forEach((nm, k) => add({ id: I.BLACKBERRY + k, n: nm, food: FOOD.get(I.BLACKBERRY + k), plantAs: BUSH0 + k * 4 }));
add({ id: I.BANANA, n: 'Banana', food: FOOD.get(I.BANANA), plantAs: SAPLING0 + 5 });
add({ id: I.PINE_SAP, n: 'Pine Sap' }); add({ id: I.SUGAR, n: 'Sugar' }); add({ id: I.COCOA, n: 'Cocoa Beans' });
add({ id: I.CHOCOLATE, n: 'Chocolate', food: FOOD.get(I.CHOCOLATE) }); add({ id: I.COOKIE, n: 'Cookie', food: FOOD.get(I.COOKIE) });
add({ id: I.LAVA_BUCKET, n: 'Lava Bucket', max: 1, bucket: 'lava' });
// Generation 11: a musket fires a musket ball with a gunpowder charge: lots of damage, a long reload. (Tuning lives in MUSKET below.)
export const MUSKET = { dmg: 18, reloadMs: 3500, speed: 75, gravity: 1.2 }; // dmg in half hearts (a zombie has 20, so a body shot nearly kills it); reloadMs between shots; speed in blocks/s
add({ id: I.MUSKET, n: 'Musket', max: 1, dur: 250, gun: true });
add({ id: I.MUSKET_BALL, n: 'Musket Ball' });
// Generation 12: every gun in one table. ammo: what one shot uses up from the inventory ([item, count]); pellets: bullets per shot (spread = how far they fan out, life = seconds they fly).
// The flintlock is a small musket: it reloads in about half the time but hits half as hard. The shotgun fires a spray of pellets from a shotgun shell (no gunpowder needed): deadly close up, weak far away.
export const CANNON = { speed: 46, gravity: 11, dmg: 16, radius: 2.4, reloadMs: 2500 }; // a cannonball flies slower and drops faster than a gun's bullet, and blows up where it lands
export const GUNS = {
  [I.MUSKET]: { name: 'musket', dmg: MUSKET.dmg, reloadMs: MUSKET.reloadMs, speed: MUSKET.speed, pellets: 1, spread: 0, life: 4, ammo: [[I.MUSKET_BALL, 1], [I.GUNPOWDER, 1]] },
  [I.FLINTLOCK]: { name: 'flintlock pistol', dmg: 9, reloadMs: 1500, speed: 70, pellets: 1, spread: 0.012, life: 3, ammo: [[I.MUSKET_BALL, 1], [I.GUNPOWDER, 1]] },
  [I.SHOTGUN]: { name: 'shotgun', dmg: 6, reloadMs: 4200, speed: 62, pellets: 20, spread: 0.0425, life: 0.5, ammo: [[I.SHOTGUN_SHELL, 1]] },
};
export const ammoName = (id) => (id === I.MUSKET_BALL ? 'a musket ball' : id === I.GUNPOWDER ? 'gunpowder' : 'a shotgun shell');
add({ id: I.FLINTLOCK, n: 'Flintlock Pistol', max: 1, dur: 200, gun: true, gunSize: 0.52 });
add({ id: I.SHOTGUN, n: 'Shotgun', max: 1, dur: 200, gun: true });
add({ id: I.SHOTGUN_SHELL, n: 'Shotgun Shell' });
add({ id: I.CANNONBALL, n: 'Cannonball' });
add({ id: I.PAPER, n: 'Paper' });
add({ id: I.RAW_DUCK, n: 'Raw Duck', food: FOOD.get(I.RAW_DUCK) }); add({ id: I.COOKED_DUCK, n: 'Cooked Duck', food: FOOD.get(I.COOKED_DUCK) });
add({ id: I.RAW_SEAGLE, n: 'Raw Seagle', food: FOOD.get(I.RAW_SEAGLE) }); add({ id: I.COOKED_SEAGLE, n: 'Cooked Seagle', food: FOOD.get(I.COOKED_SEAGLE) });
for (let c = 0; c < 7; c++) add({ id: dyeId(c), n: `${COLORS[c]} Dye`, dye: c });
for (let k = 0; k < 6; k++) add({ id: boatId(k), n: `${WOODS[k]} Boat`, max: 1, boat: k });
for (let c = 1; c <= 6; c++) add({ id: bedItemId(c), n: `${COLORS[c]} Bed`, max: 1, bed: true, color: c });
for (let c = 0; c < 7; c++) add({ id: leatherDyedId(c), n: `${COLORS[c]} Leather`, dye: c });
add({ id: I.BUCKET, n: 'Bucket', max: 16, bucket: 'empty' });
add({ id: I.WATER_BUCKET, n: 'Water Bucket', max: 1, bucket: 'water' });
// Attack damage and attack speed per tool, as in Java Minecraft (order: wooden, stone, iron, golden, diamond). Axes hit hardest but swing slowest.
export const ATTACK = {
  sword: { dmg: [4, 5, 6, 4, 7], spd: [1.6, 1.6, 1.6, 1.6, 1.6] },
  axe: { dmg: [7, 9, 9, 7, 9], spd: [0.8, 0.8, 0.9, 1, 1] },
  pickaxe: { dmg: [2, 3, 4, 2, 5], spd: [1.2, 1.2, 1.2, 1.2, 1.2] },
  shovel: { dmg: [2.5, 3.5, 4.5, 2.5, 5.5], spd: [1, 1, 1, 1, 1] },
};
MATS.forEach((m, mi) => TOOL_KINDS.forEach((k) => add({ id: toolId(k, mi), n: `${m.name} ${k[0].toUpperCase()}${k.slice(1)}`, max: 1, tool: k, mat: mi, speed: m.speed, lvl: m.lvl, dur: m.dur, dmg: ATTACK[k].dmg[mi], aspd: ATTACK[k].spd[mi] })));
MATS.forEach((m, mi) => add({ id: hoeId(mi), n: `${m.name} Hoe`, max: 1, tool: 'hoe', hoe: true, mat: mi, speed: m.speed, lvl: m.lvl, dur: m.dur, dmg: 1, aspd: [1, 2, 3, 1, 4][mi] })); // hoes turn dirt and grass into farmland
ARMOR_MATS.forEach((m, mi) => ARMOR_TYPES.forEach((t, ti) => add({ id: armorId(ti, mi), n: `${m.name} ${t}`, max: 1, armor: ti, mat: mi, def: m.def[ti], dur: [11, 16, 15, 13][ti] * m.f })));
for (let c = 0; c < 7; c++) ARMOR_TYPES.forEach((t, ti) => add({ id: dyedArmorId(ti, c), n: `${COLORS[c]} Leather ${t}`, max: 1, armor: ti, mat: 0, def: ARMOR_MATS[0].def[ti], dur: [11, 16, 15, 13][ti] * ARMOR_MATS[0].f, dye: c }));
ITEMS.get(B.CHUNK_SAVER).max = 8; // each one is a diamond and eight stone, and a player can only keep three saved chunks
export const itemInfo = (id) => ITEMS.get(id);
export const maxStack = (id) => (ITEMS.get(id) || { max: 64 }).max;
export const CREATIVE_ITEMS = [...ITEMS.keys()];

/* ---------- block properties: hardness, tool, harvest level, drops ---------- */
const d1 = (id, n = 1) => [[id, n, n]];
export const BI = {
  [B.GRASS]: { h: 0.6, tool: 'shovel', drop: d1(B.DIRT) }, [B.DIRT]: { h: 0.5, tool: 'shovel' }, [B.SAND]: { h: 0.5, tool: 'shovel' },
  [B.GRAVEL]: { h: 0.6, tool: 'shovel', drop: (r) => (r() < 0.1 ? d1(I.FLINT) : d1(B.GRAVEL)) },
  [B.STONE]: { h: 1.5, tool: 'pickaxe', need: 1, drop: d1(B.COBBLE) }, [B.COBBLE]: { h: 2, tool: 'pickaxe', need: 1 }, [B.BRICKS]: { h: 2, tool: 'pickaxe', need: 1 },
  [B.COAL]: { h: 3, tool: 'pickaxe', need: 1, drop: d1(I.COAL) }, [B.IRON]: { h: 3, tool: 'pickaxe', need: 1, lvl: 1 },
  [B.GOLD]: { h: 3, tool: 'pickaxe', need: 1, lvl: 2 }, [B.DIAMOND]: { h: 3, tool: 'pickaxe', need: 1, lvl: 2, drop: d1(I.DIAMOND) },
  [B.FURNACE]: { h: 3.5, tool: 'pickaxe', need: 1 }, [B.CHUNK_SAVER]: { h: 5, tool: 'pickaxe' }, [B.LOG]: { h: 2, tool: 'axe' }, [B.PLANKS]: { h: 2, tool: 'axe' }, [B.TABLE]: { h: 2.5, tool: 'axe' }, [B.CHEST]: { h: 2.5, tool: 'axe' },
  [B.LEAVES]: { h: 0.2, drop: (r) => { const o = []; if (r() < 0.05) o.push([I.APPLE, 1]); if (r() < 0.1) o.push([I.STICK, 1 + (r() < 0.5 ? 1 : 0)]); return o; } },
  [B.SNOW]: { h: 0.2, tool: 'shovel', drop: [] }, [B.GLASS]: { h: 0.3, drop: [] }, [B.WOOL]: { h: 0.8 },
  [B.BEDROCK]: { h: -1 }, [B.WATER]: { h: -1 },
};
for (let id = 23; id <= WATER_FALL; id++) BI[id] = { h: -1 };
for (let id = 45; id <= 49; id++) BI[id] = { h: -1 }; // lava cannot be mined
BI[B.OBSIDIAN] = { h: 50, tool: 'pickaxe', need: 1, lvl: 3 }; // only a diamond pickaxe can harvest it, and it takes a long time
for (let id = 31; id <= 35; id++) BI[id] = { h: 0, drop: d1(B.TORCH) }; // torches break at once and always give back the floor torch
for (let id = 36; id <= 43; id++) BI[id] = { h: 0.2, drop: d1(I.BED) };
BI[B.SANDSTONE] = { h: 0.8, tool: 'pickaxe', need: 1 }; BI[B.DEEPSLATE] = { h: 3, tool: 'pickaxe', need: 1 };
// Generation 8 deepslate ores: harder than the stone ones, same drops (iron and gold give their ore block, which is smelted).
BI[B.DS_COAL] = { h: 4.5, tool: 'pickaxe', need: 1, drop: d1(I.COAL) }; BI[B.DS_IRON] = { h: 4.5, tool: 'pickaxe', need: 1, lvl: 1, drop: d1(B.IRON) };
BI[B.DS_GOLD] = { h: 4.5, tool: 'pickaxe', need: 1, lvl: 2, drop: d1(B.GOLD) }; BI[B.DS_DIAMOND] = { h: 4.5, tool: 'pickaxe', need: 1, lvl: 2, drop: d1(I.DIAMOND) };
for (let id = 77; id <= 92; id++) BI[id] = { h: 3, tool: 'axe', drop: d1(I.DOOR) }; // either half gives the door back (the other half goes without dropping)
// Desert and cold biome blocks. Sand layers give a little sand back, snow layers just crumble, a dead bush gives sticks.
BI[B.CACTUS] = { h: 0.4 }; BI[B.SPRUCE_LOG] = { h: 2, tool: 'axe' }; BI[B.PACKED_SNOW] = { h: 0.4, tool: 'shovel', drop: [] };
BI[B.SPRUCE_LEAVES] = { h: 0.2, drop: (r) => (r() < 0.12 ? [[I.STICK, 1]] : []) };
BI[B.DEAD_BUSH] = { h: 0, drop: (r) => [[I.STICK, 1 + Math.floor(r() * 3)]] }; // a desert shrub always gives one to three sticks
// Generation 7: birch and spruce wood, grass, flowers, coloured wool and beds, mineable seaweed.
BI[B.BIRCH_LOG] = { h: 2, tool: 'axe' }; BI[B.SPRUCE_PLANKS] = { h: 2, tool: 'axe' }; BI[B.BIRCH_PLANKS] = { h: 2, tool: 'axe' };
BI[B.BIRCH_LEAVES] = { h: 0.2, drop: (r) => (r() < 0.1 ? [[I.STICK, 1]] : []) };
BI[B.GRASS_PLANT] = { h: 0, drop: (r) => (r() < 0.15 ? d1(I.WHEAT_SEEDS) : []) }; BI[B.TALL_GRASS] = { h: 0, drop: (r) => (r() < 0.25 ? d1(I.WHEAT_SEEDS) : []) }; // grass sometimes gives wheat seeds
BI[B.FARMLAND] = { h: 0.6, tool: 'shovel', drop: d1(B.DIRT) }; BI[B.FARMLAND_WET] = { h: 0.6, tool: 'shovel', drop: d1(B.DIRT) };
for (let s = 0; s < 8; s++) BI[WHEAT0 + s] = { h: 0, drop: s === 7 ? (r) => [[I.WHEAT, 1], [I.WHEAT_SEEDS, 1 + Math.floor(r() * 3)]] : d1(I.WHEAT_SEEDS) }; // ripe wheat gives wheat and seeds, a young crop only its seed
for (let c = 0; c < 7; c++) { BI[FLOWER0 + c] = { h: 0 }; BI[WOOL0 + c] = { h: 0.8 }; } // a flower drops itself
for (let id = 116; id <= 163; id++) BI[id] = { h: 0.2, drop: d1(bedItemId(bedColor(id))) };
BI[B.SEAWEED] = { h: 0, drop: d1(I.SEAWEED) };
for (let id = 55; id <= 75; id++) BI[id] = layerKind(id) === 0 ? { h: 0.1, tool: 'shovel', drop: (r) => (r() < layerN(id) / 8 ? d1(B.SAND) : []) } : { h: 0.1, tool: 'shovel', drop: [] };
// Generation 10: pine, jungle and banana wood; saplings (a leaf gives its own tree's sapling now and then); berry bushes (only the ripe, fourth stage gives 1 to 3 berries); cocoa pods; sugar cane.
BI[B.PINE_LOG] = { h: 2, tool: 'axe' }; BI[B.JUNGLE_LOG] = { h: 2, tool: 'axe' }; BI[B.BANANA_LOG] = { h: 2, tool: 'axe' };
BI[B.PINE_PLANKS] = { h: 2, tool: 'axe' }; BI[B.JUNGLE_PLANKS] = { h: 2, tool: 'axe' };
const leafDrop = (sap, stick, extra) => ({ h: 0.2, drop: (r) => { const o = []; if (r() < 0.06) o.push([SAPLING0 + sap, 1]); if (r() < stick) o.push([I.STICK, 1]); if (extra) extra(r, o); return o; } });
{ const oakLeaves = BI[B.LEAVES].drop; BI[B.LEAVES] = { h: 0.2, drop: (r) => { const o = oakLeaves(r); if (r() < 0.06) o.push([SAPLING0, 1]); return o; } }; }
BI[B.SPRUCE_LEAVES] = leafDrop(1, 0.12); BI[B.BIRCH_LEAVES] = leafDrop(2, 0.1); BI[B.JUNGLE_LEAVES] = leafDrop(4, 0.1);
BI[B.PINE_LEAVES] = leafDrop(3, 0.12, (r, o) => { if (r() < 0.15) o.push([I.PINE_SAP, 1]); }); // 15% pine sap
BI[B.BANANA_LEAVES] = { h: 0.2, drop: (r) => (r() < 0.25 ? [[I.BANANA, 1]] : []) }; // 25% a banana
for (let k = 0; k < 6; k++) BI[SAPLING0 + k] = { h: 0 };
for (let k = 0; k < 3; k++) for (let st = 0; st < 4; st++) BI[BUSH0 + k * 4 + st] = { h: 0, drop: st === 3 ? [[I.BLACKBERRY + k, 1, 3]] : [] };
for (let d = 0; d < 4; d++) BI[COCOA0 + d] = { h: 0.2, drop: [[I.COCOA, 2, 3]] };
BI[B.SUGAR_CANE] = { h: 0 };
BI[B.STEERING_WHEEL] = { h: 1.5, tool: 'axe' }; for (let id = 214; id <= 217; id++) BI[id] = { h: 3, tool: 'pickaxe', drop: d1(B.CANNON) }; // (a cannon in any direction gives back the one cannon item)
// Generation 12: ore blocks (wooden pickaxe for coal, stone for iron, iron for gold and diamond).
BI[B.COAL_BLOCK] = { h: 5, tool: 'pickaxe', need: 1, lvl: 0 }; BI[B.IRON_BLOCK] = { h: 5, tool: 'pickaxe', need: 1, lvl: 1 };
BI[B.GOLD_BLOCK] = { h: 3, tool: 'pickaxe', need: 1, lvl: 2 }; BI[B.DIAMOND_BLOCK] = { h: 5, tool: 'pickaxe', need: 1, lvl: 2 };
function effectiveTool(b, held) {
  const it = held && ITEMS.get(held.id);
  return it && b.tool && it.tool === b.tool ? it : null;
}
export function canHarvest(id, held) {
  const b = BI[id]; if (!b) return true;
  const t = effectiveTool(b, held);
  return !b.need || (!!t && t.lvl >= (b.lvl || 0));
}
// Seconds of continuous digging, the same formula the real game uses: hardness x 1.5 with the right tool, x 5 without, divided by tool speed.
export function breakTime(id, held) {
  const b = BI[id]; if (!b) return 1;
  if (b.h < 0) return Infinity;
  const t = effectiveTool(b, held);
  return (b.h * (canHarvest(id, held) ? 1.5 : 5)) / (t ? t.speed : 1);
}
export function blockDrops(id, held, rnd = Math.random) {
  const b = BI[id] || {};
  if (!canHarvest(id, held)) return [];
  const list = typeof b.drop === 'function' ? b.drop(rnd) : b.drop || d1(id);
  return list.map(([item, a, z]) => [item, z === undefined ? a : a + Math.floor(rnd() * (z - a + 1))]);
}
export const attackDamage = (held) => { const it = held && ITEMS.get(held.id); return it && it.tool ? it.dmg : 1; };
// Seconds for a swing to recharge fully: a bare hand is quick (0.25 s), a sword 0.625 s, an axe 1 to 1.25 s.
export const attackCooldown = (held) => { const it = held && ITEMS.get(held.id); return 1 / (it && it.aspd ? it.aspd : 4); };

/* ---------- crafting ---------- */
export const RECIPES = [];
const shaped = (rows, key, out, n = 1, hide = false) => RECIPES.push({ rows, key, out, n, w: rows[0].length, h: rows.length, hide });
// (hide: a recipe that works but is left out of the recipe book, to keep the list short)
const shapeless = (ins, out, n = 1) => RECIPES.push({ ins, out, n, hide: false });
shapeless([B.LOG], B.PLANKS, 4); // each tree gives its own planks
shapeless([B.SPRUCE_LOG], B.SPRUCE_PLANKS, 4);
shapeless([B.BIRCH_LOG], B.BIRCH_PLANKS, 4);
shapeless([B.PINE_LOG], B.PINE_PLANKS, 4);
shapeless([B.JUNGLE_LOG], B.JUNGLE_PLANKS, 4);
shapeless([B.BANANA_LOG], B.JUNGLE_PLANKS, 2);
shaped(['P', 'P'], { P: ANY_PLANKS }, I.STICK, 4);
shaped(['PP', 'PP'], { P: ANY_PLANKS }, B.TABLE);
shaped(['CCC', 'C C', 'CCC'], { C: B.COBBLE }, B.FURNACE);
shaped(['PPP', 'P P', 'PPP'], { P: ANY_PLANKS }, B.CHEST);
PLANKS_IDS.slice(0, 5).forEach((pl, k) => shaped(['P P', 'PPP'], { P: pl }, boatId(k))); // a boat needs five planks of one wood
shaped(['L L', 'LLL'], { L: B.BANANA_LOG }, boatId(5)); // a banana boat is made of five banana logs
MATS.forEach((m, mi) => {
  const key = { M: m.ing, S: I.STICK };
  shaped(['MMM', ' S ', ' S '], key, toolId('pickaxe', mi));
  shaped(['MM', 'MS', ' S'], key, toolId('axe', mi));
  shaped(['M', 'S', 'S'], key, toolId('shovel', mi));
  shaped(['M', 'M', 'S'], key, toolId('sword', mi));
});
ARMOR_MATS.forEach((m, mi) => {
  const key = { M: m.ing };
  shaped(['MMM', 'M M'], key, armorId(0, mi));
  shaped(['M M', 'MMM', 'MMM'], key, armorId(1, mi));
  shaped(['MMM', 'M M', 'M M'], key, armorId(2, mi));
  shaped(['M M', 'M M'], key, armorId(3, mi));
});
for (let c = 0; c < 7; c++) { // armor made of dyed leather comes out in that colour
  const key = { M: leatherDyedId(c) };
  shaped(['MMM', 'M M'], key, dyedArmorId(0, c), 1, true);
  shaped(['M M', 'MMM', 'MMM'], key, dyedArmorId(1, c), 1, true);
  shaped(['MMM', 'M M', 'M M'], key, dyedArmorId(2, c), 1, true);
  shaped(['M M', 'M M'], key, dyedArmorId(3, c), 1, true);
}
shaped([' ST', 'S T', ' ST'], { S: I.STICK, T: I.STRING }, I.BOW);
shaped(['I I', ' I '], { I: I.IRON_INGOT }, I.BUCKET);
shaped(['C', 'S'], { C: I.COAL, S: I.STICK }, B.TORCH, 4);
shaped(['WWW', 'PPP'], { W: B.WOOL, P: ANY_PLANKS }, I.BED);
for (let c = 0; c < 7; c++) shaped(['WWW', 'PPP'], { W: WOOL0 + c, P: ANY_PLANKS }, bedItemId(c)); // three wool of one colour make a bed of that colour
shaped(['PP', 'PP', 'PP'], { P: ANY_PLANKS }, I.DOOR, 3);
shaped(['SS', 'SS'], { S: B.SAND }, B.SANDSTONE, 1);
shaped(['PIP', 'PPP', ' P '], { P: ANY_PLANKS, I: I.IRON_INGOT }, I.SHIELD);
// Dyes: every flower makes two dyes of its colour. A dye and wool, a bed, leather or leather armor give the same thing in that colour
// (any colour of wool, bed or armor works, not only the white wool, red bed and plain leather listed in the recipe book: see dyeRule below).
for (let c = 0; c < 7; c++) {
  shapeless([FLOWER0 + c], dyeId(c), 2);
  shapeless([B.WOOL, dyeId(c)], WOOL0 + c, 1);
  shapeless([I.LEATHER, dyeId(c)], leatherDyedId(c), 1);
  if (c > 0) shapeless([I.BED, dyeId(c)], bedItemId(c), 1);
}
shaped(['F', 'S', 'E'], { F: I.FLINT, S: I.STICK, E: I.FEATHER }, I.ARROW, 4);
shaped(['SSS', 'SDS', 'SSS'], { S: B.STONE, D: I.DIAMOND }, B.CHUNK_SAVER); // one diamond in the middle, completely surrounded by eight stone

// Generation 8: hoes, bread, golden apple, fishing rod.
MATS.forEach((m, mi) => shaped(['MM', ' S', ' S'], { M: m.ing, S: I.STICK }, hoeId(mi)));
shaped(['WWW'], { W: I.WHEAT }, I.BREAD);
shaped(['GGG', 'GAG', 'GGG'], { G: I.GOLD_INGOT, A: I.APPLE }, I.GOLDEN_APPLE); // an apple completely surrounded by gold
shaped(['  S', ' ST', 'S T'], { S: I.STICK, T: I.STRING }, I.FISHING_ROD);

// Generation 11: one iron ingot makes four musket balls; a musket is a barrel of three iron ingots, a flint for the lock and two planks for the stock.
shapeless([I.IRON_INGOT], I.MUSKET_BALL, 4);
shaped(['III', 'PF ', 'P  '], { I: I.IRON_INGOT, P: ANY_PLANKS, F: I.FLINT }, I.MUSKET);
// Generation 12: a flintlock pistol is a musket with one iron ingot less; a shotgun is a musket whose third ingot is an iron block.
shaped(['II', 'PF', 'P '], { I: I.IRON_INGOT, P: ANY_PLANKS, F: I.FLINT }, I.FLINTLOCK);
shaped(['IIX', 'PF ', 'P  '], { I: I.IRON_INGOT, X: B.IRON_BLOCK, P: ANY_PLANKS, F: I.FLINT }, I.SHOTGUN);
shaped(['CCC'], { C: B.SUGAR_CANE }, I.PAPER, 3); // three sugar canes in a row make three paper
shaped(['PPP', 'PIP', 'PPP'], { P: I.PAPER, I: I.IRON_INGOT }, I.SHOTGUN_SHELL, 4); // one iron ingot completely surrounded by paper makes four shells
// Four iron ingots make four cannonballs; a cannon is a barrel of six iron ingots on a plank carriage; a steering wheel is four sticks around a plank.
shapeless([I.IRON_INGOT, I.IRON_INGOT, I.IRON_INGOT, I.IRON_INGOT], I.CANNONBALL, 4);
shaped(['III', 'III', 'P P'], { I: I.IRON_INGOT, P: ANY_PLANKS }, B.CANNON);
shaped([' S ', 'SPS', ' S '], { S: I.STICK, P: ANY_PLANKS }, B.STEERING_WHEEL);
// Ore blocks: nine of the ore make a block, a block makes nine back.
[[I.COAL, B.COAL_BLOCK], [I.IRON_INGOT, B.IRON_BLOCK], [I.GOLD_INGOT, B.GOLD_BLOCK], [I.DIAMOND, B.DIAMOND_BLOCK]].forEach(([it, bl]) => { shaped(['MMM', 'MMM', 'MMM'], { M: it }, bl); shapeless([bl], it, 9); });

// Generation 10: sugar (from pine sap or sugar cane), chocolate (cocoa beans and sugar), cookies (chocolate and three wheat make four).
shapeless([I.PINE_SAP], I.SUGAR, 1);
shapeless([B.SUGAR_CANE], I.SUGAR, 1);
shapeless([I.COCOA, I.SUGAR], I.CHOCOLATE, 1);
shapeless([I.CHOCOLATE, I.WHEAT, I.WHEAT, I.WHEAT], I.COOKIE, 4);

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
function fits(r, sub, mirror) {
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const ch = r.rows[y][mirror ? r.w - 1 - x : x], want = ch === ' ' ? 0 : r.key[ch], have = sub[y * r.w + x];
    if (want === ANY_PLANKS ? !PLANKS_IDS.includes(have) : have !== want) return false;
  }
  return true;
}
// cells: item ids (0 = empty), row-major, W x H. Returns { out, n } or null.
export function matchRecipe(cells, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cells[y * W + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1, sub = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sub.push(cells[(y0 + y) * W + x0 + x]);
  const flat = sub.filter(Boolean).sort((a, b) => a - b);
  for (const r of RECIPES) {
    if (r.ins) { if (same(flat, [...r.ins].sort((a, b) => a - b))) return r; }
    else if (r.w === w && r.h === h && (fits(r, sub, false) || fits(r, sub, true))) return r;
  }
  return dyeRule(flat);
}
// Dyeing: one dye with one piece of wool, a bed, leather or leather armor of any colour gives that piece in the dye's colour.
// (The recipe book only lists the white wool, red bed and plain leather versions: this rule covers every other colour.)
function dyeRule(flat) {
  if (flat.length !== 2) return null;
  const di = flat.findIndex((id) => dyeColor(id) >= 0), oi = 1 - di;
  if (di < 0 || dyeColor(flat[oi]) >= 0) return null;
  const c = dyeColor(flat[di]), o = flat[oi], it = ITEMS.get(o);
  if (o === B.WOOL || woolColor(o) >= 0) return woolColor(o) === c ? null : { out: WOOL0 + c, n: 1 };
  if (bedItemColor(o) >= 0) return bedItemColor(o) === c ? null : { out: bedItemId(c), n: 1 };
  if (o === I.LEATHER || leatherDyedColor(o) >= 0) return leatherDyedColor(o) === c ? null : { out: leatherDyedId(c), n: 1 };
  if (it && it.armor !== undefined && it.mat === 0) return dyedArmorColor(o) === c ? null : { out: dyedArmorId(it.armor, c), n: 1 };
  return null;
}

/* ---------- furnace ---------- */
export const SMELT_TIME = 10;
export const SMELT = new Map([
  [B.IRON, I.IRON_INGOT], [B.GOLD, I.GOLD_INGOT], [B.DS_IRON, I.IRON_INGOT], [B.DS_GOLD, I.GOLD_INGOT], [B.SAND, B.GLASS], [B.COBBLE, B.STONE],
  [I.RAW_PORK, I.COOKED_PORK], [I.RAW_BEEF, I.STEAK], [I.RAW_CHICKEN, I.COOKED_CHICKEN], [I.RAW_MUTTON, I.COOKED_MUTTON], [I.RAW_RABBIT, I.COOKED_RABBIT], [I.RAW_SALMON, I.COOKED_SALMON],
  [I.RAW_DUCK, I.COOKED_DUCK], [I.RAW_SEAGLE, I.COOKED_SEAGLE],
]);
export const FUEL = new Map([[I.COAL, 80], [B.COAL_BLOCK, 800], [B.LOG, 15], [B.SPRUCE_LOG, 15], [B.BIRCH_LOG, 15], [B.PINE_LOG, 15], [B.JUNGLE_LOG, 15], [B.BANANA_LOG, 15], [B.PLANKS, 7.5], [B.SPRUCE_PLANKS, 7.5], [B.BIRCH_PLANKS, 7.5], [B.PINE_PLANKS, 7.5], [B.JUNGLE_PLANKS, 7.5], [I.STICK, 5]]);
