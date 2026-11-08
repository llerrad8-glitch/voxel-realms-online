// Items, block properties, tools, armor, food, crafting and smelting. Used by both the browser and the server.
import { B, BLOCKS, isWater } from './world.js';

export const I = {
  STICK: 256, COAL: 257, IRON_INGOT: 258, GOLD_INGOT: 259, DIAMOND: 260, FLINT: 261, APPLE: 262, ROTTEN: 263, BONE: 264, STRING: 265,
  ARROW: 266, FEATHER: 267, LEATHER: 268, GUNPOWDER: 269, SLIME: 270,
  RAW_PORK: 271, COOKED_PORK: 272, RAW_BEEF: 273, STEAK: 274, RAW_CHICKEN: 275, COOKED_CHICKEN: 276, RAW_MUTTON: 277, COOKED_MUTTON: 278, RAW_RABBIT: 279, COOKED_RABBIT: 280,
  BOW: 281, BUCKET: 282, WATER_BUCKET: 283, RAW_SALMON: 284, COOKED_SALMON: 285,
};
export const TOOL_KINDS = ['pickaxe', 'axe', 'shovel', 'sword'];
export const MATS = [
  { name: 'Wooden', speed: 2, lvl: 0, dur: 59, pickaxe: 2, axe: 3, shovel: 2, sword: 4, ing: B.PLANKS },
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
  [I.RAW_SALMON, [2, 0.4]], [I.COOKED_SALMON, [6, 9.6]],
]);

/* ---------- item registry ---------- */
export const ITEMS = new Map();
const add = (o) => ITEMS.set(o.id, { max: 64, ...o });
for (let id = 1; id < BLOCKS.length; id++) if (!isWater(id) && id !== B.BEDROCK) add({ id, n: BLOCKS[id].n, block: id });
const plain = {
  [I.STICK]: 'Stick', [I.COAL]: 'Coal', [I.IRON_INGOT]: 'Iron Ingot', [I.GOLD_INGOT]: 'Gold Ingot', [I.DIAMOND]: 'Diamond', [I.FLINT]: 'Flint', [I.APPLE]: 'Apple',
  [I.ROTTEN]: 'Rotten Flesh', [I.BONE]: 'Bone', [I.STRING]: 'String', [I.ARROW]: 'Arrow', [I.FEATHER]: 'Feather', [I.LEATHER]: 'Leather', [I.GUNPOWDER]: 'Gunpowder',
  [I.SLIME]: 'Slimeball', [I.RAW_PORK]: 'Raw Porkchop', [I.COOKED_PORK]: 'Cooked Porkchop', [I.RAW_BEEF]: 'Raw Beef', [I.STEAK]: 'Steak', [I.RAW_CHICKEN]: 'Raw Chicken',
  [I.COOKED_CHICKEN]: 'Cooked Chicken', [I.RAW_MUTTON]: 'Raw Mutton', [I.COOKED_MUTTON]: 'Cooked Mutton', [I.RAW_RABBIT]: 'Raw Rabbit', [I.COOKED_RABBIT]: 'Cooked Rabbit',
  [I.RAW_SALMON]: 'Raw Salmon', [I.COOKED_SALMON]: 'Cooked Salmon',
};
for (const [id, n] of Object.entries(plain)) add({ id: +id, n, food: FOOD.get(+id) || null });
add({ id: I.BOW, n: 'Bow', max: 1, dur: 384, bow: true });
add({ id: I.BUCKET, n: 'Bucket', max: 16, bucket: 'empty' });
add({ id: I.WATER_BUCKET, n: 'Water Bucket', max: 1, bucket: 'water' });
MATS.forEach((m, mi) => TOOL_KINDS.forEach((k) => add({ id: toolId(k, mi), n: `${m.name} ${k[0].toUpperCase()}${k.slice(1)}`, max: 1, tool: k, mat: mi, speed: m.speed, lvl: m.lvl, dur: m.dur, dmg: m[k] })));
ARMOR_MATS.forEach((m, mi) => ARMOR_TYPES.forEach((t, ti) => add({ id: armorId(ti, mi), n: `${m.name} ${t}`, max: 1, armor: ti, mat: mi, def: m.def[ti], dur: [11, 16, 15, 13][ti] * m.f })));
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
  [B.FURNACE]: { h: 3.5, tool: 'pickaxe', need: 1 }, [B.LOG]: { h: 2, tool: 'axe' }, [B.PLANKS]: { h: 2, tool: 'axe' }, [B.TABLE]: { h: 2.5, tool: 'axe' }, [B.CHEST]: { h: 2.5, tool: 'axe' },
  [B.LEAVES]: { h: 0.2, drop: (r) => { const o = []; if (r() < 0.05) o.push([I.APPLE, 1]); if (r() < 0.1) o.push([I.STICK, 1 + (r() < 0.5 ? 1 : 0)]); return o; } },
  [B.SNOW]: { h: 0.2, tool: 'shovel', drop: [] }, [B.GLASS]: { h: 0.3, drop: [] }, [B.WOOL]: { h: 0.8 },
  [B.BEDROCK]: { h: -1 }, [B.WATER]: { h: -1 },
};
for (let id = 23; id < BLOCKS.length; id++) BI[id] = { h: -1 };
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
export const attackDamage = (held) => { const it = held && ITEMS.get(held.id); return it && it.tool ? it.dmg + (it.tool === 'sword' ? 0 : -1) : 1; };

/* ---------- crafting ---------- */
export const RECIPES = [];
const shaped = (rows, key, out, n = 1) => RECIPES.push({ rows, key, out, n, w: rows[0].length, h: rows.length });
const shapeless = (ins, out, n = 1) => RECIPES.push({ ins, out, n });
shapeless([B.LOG], B.PLANKS, 4);
shaped(['P', 'P'], { P: B.PLANKS }, I.STICK, 4);
shaped(['PP', 'PP'], { P: B.PLANKS }, B.TABLE);
shaped(['CCC', 'C C', 'CCC'], { C: B.COBBLE }, B.FURNACE);
shaped(['PPP', 'P P', 'PPP'], { P: B.PLANKS }, B.CHEST);
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
shaped([' ST', 'S T', ' ST'], { S: I.STICK, T: I.STRING }, I.BOW);
shaped(['I I', ' I '], { I: I.IRON_INGOT }, I.BUCKET);
shaped(['F', 'S', 'E'], { F: I.FLINT, S: I.STICK, E: I.FEATHER }, I.ARROW, 4);

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
function fits(r, sub, mirror) {
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const ch = r.rows[y][mirror ? r.w - 1 - x : x], want = ch === ' ' ? 0 : r.key[ch];
    if (sub[y * r.w + x] !== want) return false;
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
  return null;
}

/* ---------- furnace ---------- */
export const SMELT_TIME = 10;
export const SMELT = new Map([
  [B.IRON, I.IRON_INGOT], [B.GOLD, I.GOLD_INGOT], [B.SAND, B.GLASS], [B.COBBLE, B.STONE],
  [I.RAW_PORK, I.COOKED_PORK], [I.RAW_BEEF, I.STEAK], [I.RAW_CHICKEN, I.COOKED_CHICKEN], [I.RAW_MUTTON, I.COOKED_MUTTON], [I.RAW_RABBIT, I.COOKED_RABBIT], [I.RAW_SALMON, I.COOKED_SALMON],
]);
export const FUEL = new Map([[I.COAL, 80], [B.LOG, 15], [B.PLANKS, 7.5], [I.STICK, 5]]);
