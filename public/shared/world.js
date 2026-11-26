// Shared by the browser and the Node server: block table + deterministic terrain from a seed.
// The server never sends terrain, only edits; both sides regenerate the same world from the seed.
export const CS = 16, CH = 256, SEA = 20; // (CH is the build limit: 256 blocks tall since generation 8; older worlds simply have empty air above what they had) // (SEA is generation 1 to 5's sea level; generation 6 stands 50 blocks higher, see seaOf)
export const B = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WATER: 5, LOG: 6, LEAVES: 7, SNOW: 8, PLANKS: 9, GLASS: 10, BRICKS: 11, BEDROCK: 12, COAL: 13, IRON: 14, GOLD: 15, COBBLE: 16, GRAVEL: 17, DIAMOND: 18, TABLE: 19, FURNACE: 20, CHEST: 21, WOOL: 22 };

// t = atlas tiles [top, bottom, side]; tr = see-through
export const BLOCKS = [
  null,
  { n: 'Grass Block', t: [0, 2, 1] }, { n: 'Dirt', t: [2, 2, 2] }, { n: 'Stone', t: [3, 3, 3] }, { n: 'Sand', t: [4, 4, 4] },
  { n: 'Water', t: [5, 5, 5], tr: 1 }, { n: 'Oak Log', t: [7, 7, 6] }, { n: 'Leaves', t: [8, 8, 8] }, { n: 'Snow', t: [9, 9, 9] },
  { n: 'Oak Planks', t: [10, 10, 10] }, { n: 'Glass', t: [11, 11, 11], tr: 1 }, { n: 'Bricks', t: [12, 12, 12] },
  { n: 'Bedrock', t: [13, 13, 13] }, { n: 'Coal Ore', t: [14, 14, 14] }, { n: 'Iron Ore', t: [15, 15, 15] }, { n: 'Gold Ore', t: [16, 16, 16] },
  { n: 'Cobblestone', t: [17, 17, 17] }, { n: 'Gravel', t: [18, 18, 18] }, { n: 'Diamond Ore', t: [19, 19, 19] },
  { n: 'Crafting Table', t: [20, 10, 21] }, { n: 'Furnace', t: [22, 17, 23] }, { n: 'Chest', t: [24, 24, 25] }, { n: 'Wool', t: [26, 26, 26] },
];
// Water has eight states, like the real game: 5 is a source block, 23..29 are flowing water with 1..7 "amount" (7 is next to a source,
// 1 is the thin edge, 7 blocks away), and 30 is falling water (a full-height column).
export const WATER_FALL = 30;
for (let i = 23; i <= WATER_FALL; i++) BLOCKS[i] = { n: 'Water', t: [5, 5, 5], tr: 1 };
// Torches: 31 stands on the floor, 32..35 are on a wall and point +x, -x, +z, -z (away from the wall). Beds: 36..39 are the foot and 40..43 the head;
// the number says which way the bed points (foot toward head): +x, -x, +z, -z. Torches have no collision and give light; a bed is 9/16 of a block tall.
B.TORCH = 31;
BLOCKS[31] = { n: 'Torch', t: [27, 27, 27], tr: 1 };
for (let i = 32; i <= 35; i++) BLOCKS[i] = { n: 'Torch', t: [27, 27, 27], tr: 1 };
for (let i = 36; i <= 43; i++) BLOCKS[i] = { n: 'Bed', t: [i < 40 ? 28 : 29, 10, 30], tr: 1 };
// Chunk Saver (44): a placed block that claims, protects and saves the whole 16 x 16 chunk (all heights) it stands in. It is only ever placed
// through the server's chunk-claim rules (message 'cs'), never as an ordinary block.
B.CHUNK_SAVER = 44;
BLOCKS[44] = { n: 'Chunk Saver', t: [31, 31, 31] };
// Lava: 45 is a source, 46..48 are flowing lava with 1..3 "amount" (3 is next to a source, it reaches 3 blocks), 49 is falling lava. 50 is obsidian.
// Water meeting flowing lava makes cobblestone; water meeting a lava source makes obsidian.
B.LAVA = 45; B.OBSIDIAN = 50;
export const LAVA_FALL = 49;
for (let i = 45; i <= LAVA_FALL; i++) BLOCKS[i] = { n: 'Lava', t: [33, 33, 33], tr: 1 };
BLOCKS[50] = { n: 'Obsidian', t: [32, 32, 32] };
// Generation 4: desert and cold biomes. 51 cactus, 52/53 spruce log and leaves, 54 dead bush (a plant: no collision), 76 packed snow block.
// Layers are 1..7 eighths of a block tall: 55..61 sand, 62..68 loose snow, 69..75 packed snow. Eight of one kind make the full block.
// Sand and loose snow layers fall like sand does; packed snow layers and packed snow stay put. Layers and the dead bush are not items of their own.
B.SANDSTONE = 93; B.DEEPSLATE = 94; B.SEAWEED = 95;
B.CACTUS = 51; B.SPRUCE_LOG = 52; B.SPRUCE_LEAVES = 53; B.DEAD_BUSH = 54; B.PACKED_SNOW = 76;
BLOCKS[51] = { n: 'Cactus', t: [35, 36, 34] };
BLOCKS[52] = { n: 'Spruce Log', t: [39, 39, 38] };
BLOCKS[53] = { n: 'Spruce Leaves', t: [40, 40, 40] };
BLOCKS[54] = { n: 'Dead Bush', t: [37, 37, 37], tr: 1 };
for (let k = 0; k < 3; k++) for (let n = 1; n <= 7; n++) { const t = [4, 9, 41][k]; BLOCKS[55 + k * 7 + n - 1] = { n: ['Sand Layer', 'Snow Layer', 'Packed Snow Layer'][k], t: [t, t, t], tr: 1 }; }
BLOCKS[76] = { n: 'Packed Snow', t: [41, 41, 41] };
// Doors: 77..84 are the lower half and 85..92 the upper half. Inside a half, (id - 77) & 3 says which side of the block the closed panel stands on
// (+x, -x, +z, -z, like beds) and bit 4 says it is open. A closed door is solid; an open one can be walked through (the panel is only drawn).
// Door pictures: atlas tile 42 is the lower half and 43 the upper half (with windows).
BLOCKS[93] = { n: 'Sandstone', t: [45, 45, 44] }; BLOCKS[94] = { n: 'Deepslate', t: [46, 46, 46] }; BLOCKS[95] = { n: 'Seaweed', t: [47, 47, 47], tr: 1 };
for (let i = 77; i <= 92; i++) BLOCKS[i] = { n: 'Wooden Door', t: [10, 10, i < 85 ? 42 : 43], tr: 1 };
// Generation 7: three wood sets (oak, spruce, birch), grass and flowers, rainbow wool and rainbow beds.
// 96 birch log, 97 birch leaves, 98 spruce planks, 99 birch planks, 100 grass and 101 tall grass (plants, no items), 102..108 flowers (red, orange, yellow, green, blue, indigo, violet),
// 109..115 wool in the same seven colours, 116..163 the beds of the six colours after red (red keeps 36..43): eight placed forms each, like the red bed.
export const COLORS = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Indigo', 'Violet'];
export const COLOR_RGB = [[214, 54, 48], [240, 138, 36], [244, 208, 54], [76, 172, 58], [58, 110, 226], [78, 58, 168], [154, 76, 208]];
export const FLOWER_NAMES = ['Poppy', 'Orange Tulip', 'Dandelion', 'Green Clover', 'Cornflower', 'Indigo Bellflower', 'Violet Allium'];
B.BIRCH_LOG = 96; B.BIRCH_LEAVES = 97; B.SPRUCE_PLANKS = 98; B.BIRCH_PLANKS = 99; B.GRASS_PLANT = 100; B.TALL_GRASS = 101;
BLOCKS[96] = { n: 'Birch Log', t: [49, 49, 48] }; BLOCKS[97] = { n: 'Birch Leaves', t: [50, 50, 50] };
BLOCKS[98] = { n: 'Spruce Planks', t: [52, 52, 52] }; BLOCKS[99] = { n: 'Birch Planks', t: [51, 51, 51] };
BLOCKS[100] = { n: 'Grass', t: [53, 53, 53], tr: 1 }; BLOCKS[101] = { n: 'Tall Grass', t: [54, 54, 54], tr: 1 };
export const FLOWER0 = 102, WOOL0 = 109, BED0 = 116;
for (let c = 0; c < 7; c++) {
  BLOCKS[FLOWER0 + c] = { n: FLOWER_NAMES[c], t: [55 + c, 55 + c, 55 + c], tr: 1 };
  BLOCKS[WOOL0 + c] = { n: `${COLORS[c]} Wool`, t: [62 + c, 62 + c, 62 + c] };
}
for (let c = 1; c <= 6; c++) for (let v = 0; v < 8; v++) BLOCKS[BED0 + (c - 1) * 8 + v] = { n: `${COLORS[c]} Bed`, t: [v < 4 ? 69 + (c - 1) * 3 : 70 + (c - 1) * 3, 10, 71 + (c - 1) * 3], tr: 1 };
// Generation 8 deepslate ores: 174 coal, 175 iron, 176 gold, 177 diamond (atlas tiles 98..101, the stone ore's specks on deepslate).
B.DS_COAL = 174; B.DS_IRON = 175; B.DS_GOLD = 176; B.DS_DIAMOND = 177;
BLOCKS[174] = { n: 'Deepslate Coal Ore', t: [98, 98, 98] }; BLOCKS[175] = { n: 'Deepslate Iron Ore', t: [99, 99, 99] }; BLOCKS[176] = { n: 'Deepslate Gold Ore', t: [100, 100, 100] }; BLOCKS[177] = { n: 'Deepslate Diamond Ore', t: [101, 101, 101] };
export const DS_ORE = { [B.COAL]: 174, [B.IRON]: 175, [B.GOLD]: 176, [B.DIAMOND]: 177 };
// Generation 8 (farming): 164 dry farmland, 165 watered farmland, 166..173 wheat growing (stage 0 seedling .. 7 ripe). Placed forms only: they are not items of their own.
B.FARMLAND = 164; B.FARMLAND_WET = 165;
export const WHEAT0 = 166;
BLOCKS[164] = { n: 'Farmland', t: [88, 2, 2] }; BLOCKS[165] = { n: 'Farmland', t: [89, 2, 2] };
for (let s = 0; s < 8; s++) BLOCKS[WHEAT0 + s] = { n: 'Wheat', t: [90 + s, 90 + s, 90 + s], tr: 1 };
export const isWheat = (id) => id >= 166 && id <= 173;
export const wheatStage = (id) => id - 166;
export const isFarmland = (id) => id === 164 || id === 165;
// Generation 10 (pine forest, jungle, berries, banana trees, sugar cane): 178..180 pine log, leaves, planks (tiles 102..105), 181..183 the same in jungle (106..109), 184 banana log and 185 banana leaves (110..112),
// 186..191 saplings (oak, spruce, birch, pine, jungle, banana: tiles 113..118), 192..203 berry bushes (blackberry, strawberry, huckleberry x four growth stages: tiles 119..130; only the fourth bears berries),
// 204..207 cocoa pods hanging on the side of a jungle log (the number says which way the pod points away from the log, like a wall torch: +x, -x, +z, -z), 208 sugar cane.
B.PINE_LOG = 178; B.PINE_LEAVES = 179; B.PINE_PLANKS = 180; B.JUNGLE_LOG = 181; B.JUNGLE_LEAVES = 182; B.JUNGLE_PLANKS = 183; B.BANANA_LOG = 184; B.BANANA_LEAVES = 185; B.SUGAR_CANE = 208;
BLOCKS[178] = { n: 'Pine Log', t: [103, 103, 102] }; BLOCKS[179] = { n: 'Pine Leaves', t: [105, 105, 105] }; BLOCKS[180] = { n: 'Pine Planks', t: [104, 104, 104] };
BLOCKS[181] = { n: 'Jungle Log', t: [107, 107, 106] }; BLOCKS[182] = { n: 'Jungle Leaves', t: [109, 109, 109] }; BLOCKS[183] = { n: 'Jungle Planks', t: [108, 108, 108] };
BLOCKS[184] = { n: 'Banana Log', t: [111, 111, 110] }; BLOCKS[185] = { n: 'Banana Leaves', t: [112, 112, 112] };
export const SAPLING0 = 186, BUSH0 = 192, COCOA0 = 204;
export const SAPLING_NAMES = ['Oak', 'Spruce', 'Birch', 'Pine', 'Jungle', 'Banana'], BERRY_NAMES = ['Blackberry', 'Strawberry', 'Huckleberry'];
SAPLING_NAMES.forEach((nm, k) => { BLOCKS[SAPLING0 + k] = { n: `${nm} Sapling`, t: [113 + k, 113 + k, 113 + k], tr: 1 }; });
for (let k = 0; k < 3; k++) for (let st = 0; st < 4; st++) BLOCKS[BUSH0 + k * 4 + st] = { n: `${BERRY_NAMES[k]} Bush`, t: [119 + k * 4 + st, 119 + k * 4 + st, 119 + k * 4 + st], tr: 1 };
for (let d = 0; d < 4; d++) BLOCKS[COCOA0 + d] = { n: 'Cocoa Pod', t: [131, 131, 131], tr: 1 };
BLOCKS[208] = { n: 'Sugar Cane', t: [132, 132, 132], tr: 1 };
// Generation 12: storage blocks of the four ores. 209 coal block, 210 iron block, 211 gold block, 212 diamond block (atlas tiles 133..136).
B.COAL_BLOCK = 209; B.IRON_BLOCK = 210; B.GOLD_BLOCK = 211; B.DIAMOND_BLOCK = 212;
BLOCKS[209] = { n: 'Block of Coal', t: [133, 133, 133] }; BLOCKS[210] = { n: 'Block of Iron', t: [134, 134, 134] };
BLOCKS[211] = { n: 'Block of Gold', t: [135, 135, 135] }; BLOCKS[212] = { n: 'Block of Diamond', t: [136, 136, 136] };
// Generation 12 (ships and cannons): 213 steering wheel (placing one turns the build around it into a ship), 214..217 cannon facing +x, -x, +z, -z (tiles 137..140).
B.STEERING_WHEEL = 213; B.CANNON = 214;
BLOCKS[213] = { n: 'Steering Wheel', t: [140, 140, 137] };
for (let i = 214; i <= 217; i++) BLOCKS[i] = { n: 'Cannon', t: [139, 140, 138] };
export const isCannon = (id) => id >= 214 && id <= 217;
export const cannonDir = (id) => DIR4[id - 214]; // [dx, dz] the barrel points along
export const cannonId = (dx, dz) => 214 + (Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 0 : 1) : dz > 0 ? 2 : 3);
export const isSapling = (id) => id >= 186 && id <= 191;
export const isBush = (id) => id >= 192 && id <= 203;
export const bushKind = (id) => (id - 192) >> 2, bushStage = (id) => (id - 192) & 3, bushId = (kind, stage) => 192 + kind * 4 + stage;
export const isCocoa = (id) => id >= 204 && id <= 207;
export const isCane = (id) => id === 208;
export const isLeaf = (id) => id === B.LEAVES || id === B.SPRUCE_LEAVES || id === B.BIRCH_LEAVES || id === 179 || id === 182 || id === 185; // leaves of any tree let light through
// Things that grow on their own (the server keeps a list of them): wheat, saplings, bushes that are not yet ripe, sugar cane.
export const isGrowing = (id) => isWheat(id) || isSapling(id) || (id >= 192 && id <= 202) || id === 208;
export const PLANKS_IDS = [B.PLANKS, B.SPRUCE_PLANKS, B.BIRCH_PLANKS, B.PINE_PLANKS, B.JUNGLE_PLANKS];
export const LOG_IDS = [B.LOG, B.SPRUCE_LOG, B.BIRCH_LOG, B.PINE_LOG, B.JUNGLE_LOG];
export const isFlower = (id) => id >= 102 && id <= 108;
export const woolColor = (id) => (id >= 109 && id <= 115 ? id - 109 : -1); // -1: not a coloured wool (white wool is B.WOOL)
export const isLayer = (id) => id >= 55 && id <= 75;
export const layerKind = (id) => ((id - 55) / 7) | 0; // 0 sand, 1 loose snow, 2 packed snow
export const layerN = (id) => ((id - 55) % 7) + 1; // eighths of a block
export const layerId = (kind, n) => 55 + kind * 7 + n - 1;
export const layerFull = (kind) => (kind === 0 ? B.SAND : kind === 1 ? B.SNOW : B.PACKED_SNOW); // eight layers make this block
export const isPlant = (id) => id === B.DEAD_BUSH || (id >= 100 && id <= 108) || (id >= 166 && id <= 173) || (id >= 186 && id <= 203) || id === 208; // plants have no collision and break at once (dead bush, grass, tall grass, flowers)
export const fallsId = (id) => id === B.SAND || id === B.GRAVEL || id === B.SNOW || (id >= 55 && id <= 68); // what drops when nothing holds it up
export const isLava = (id) => id >= 45 && id <= 49;
export const lavaAmount = (id) => (id === 45 || id === LAVA_FALL ? 4 : id >= 46 && id < LAVA_FALL ? id - 45 : 0);
export const lavaFlowId = (amount, falling) => (falling ? LAVA_FALL : amount >= 4 ? 45 : 45 + amount);
export const isFluid = (id) => isWater(id) || isLava(id);
export const isTorch = (id) => id >= 31 && id <= 35;
export const isBed = (id) => (id >= 36 && id <= 43) || (id >= 116 && id <= 163);
export const isDoor = (id) => id >= 77 && id <= 92;
export const doorUpper = (id) => id >= 85, doorOpen = (id) => ((id - 77) & 4) !== 0, doorDir = (id) => (id - 77) & 3;
export const doorId = (upper, open, dir) => 77 + (upper ? 8 : 0) + (open ? 4 : 0) + dir;
export const DOOR_OPEN_SIDE = [2, 3, 1, 0]; // an open door swings round the same corner: the panel moves from its closed side to this one
export const DOOR_T = 3 / 16;
export const isVariant = (id) => (id >= 32 && id <= 43) || (id >= 77 && id <= 92) || id === 54 || id === 100 || id === 101 || (id >= 116 && id <= 163) || (id >= 55 && id <= 75) || (id >= 164 && id <= 173) || (id >= 192 && id <= 207) || (id >= 215 && id <= 217); // placed forms that are not items of their own
export const BED_H = 9 / 16;
export const blockHeight = (id) => (isBed(id) ? BED_H : id >= 55 && id <= 75 ? (((id - 55) % 7) + 1) / 8 : 1);
export const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// A bed's id says its colour, which half it is and which way it points: 36.. is red, 116.. + 8 per colour for the other six.
export const bedColor = (id) => (id <= 43 ? 0 : 1 + ((id - 116) >> 3));
const bedBase = (id) => (id <= 43 ? 36 : 116 + ((id - 116) & ~7));
export const bedDir = (id) => (id - bedBase(id)) & 3, bedIsHead = (id) => id - bedBase(id) >= 4;
export const bedId = (color, head, dir) => (color === 0 ? 36 : 116 + (color - 1) * 8) + (head ? 4 : 0) + dir;
export const TORCH_LIGHT = 14;
// Which torch block to place when a face of the target block is clicked (n = the face's normal); 0 = cannot place (ceiling).
export const torchFor = (nx, ny, nz) => (ny > 0 ? 31 : ny < 0 ? 0 : nx > 0 ? 32 : nx < 0 ? 33 : nz > 0 ? 34 : 35);
// The block a torch hangs on.
export function torchSupport(id, x, y, z) { return id === 31 ? [x, y - 1, z] : id === 32 ? [x - 1, y, z] : id === 33 ? [x + 1, y, z] : id === 34 ? [x, y, z - 1] : [x, y, z + 1]; }
export const isWater = (id) => id === B.WATER || id === 95 || (id >= 23 && id <= WATER_FALL); // (95 is seaweed: a plant standing in a full block of still water)
export const waterAmount = (id) => (id === B.WATER || id === WATER_FALL || id === 95 ? 8 : id >= 23 && id < WATER_FALL ? id - 22 : 0);
export const flowId = (amount, falling) => (falling ? WATER_FALL : amount >= 8 ? B.WATER : 22 + amount);
// Height of a water block's surface (a source is 8/9, thin flow 1/9, falling water counts like a source).
export const waterHeight = (id) => waterAmount(id) / 9;
// Which way the water in a block is flowing, as a unit vector [x, z] ([0, 0] for still water). Same rule as the real game: water runs
// toward lower neighbours and toward a drop beside it. get(x, y, z) must return a block id.
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export function flowDir(get, x, y, z) {
  const id = get(x, y, z);
  if (!isWater(id)) return [0, 0];
  const own = waterHeight(id);
  let fx = 0, fz = 0;
  for (const [dx, dz] of SIDES) {
    const nb = get(x + dx, y, z + dz);
    let f = 0;
    if (isWater(nb)) f = own - waterHeight(nb);
    else if (!isSolid(nb)) { const below = get(x + dx, y - 1, z + dz); if (isWater(below)) f = own - (waterHeight(below) - 8 / 9); }
    fx += dx * f; fz += dz * f;
  }
  const len = Math.hypot(fx, fz);
  return len < 1e-6 ? [0, 0] : [fx / len, fz / len];
}
export const PLACEABLE = new Set(BLOCKS.map((_, i) => i).filter((i) => i && !isWater(i) && !isLava(i) && !isVariant(i) && i !== B.BEDROCK));
export const isSolid = (id) => id !== 0 && !isWater(id) && !isLava(id) && !isTorch(id) && !isPlant(id) && !(id >= 204 && id <= 207) && !(id >= 81 && id <= 84) && !(id >= 89 && id <= 92);
export const idx = (x, y, z) => x + CS * (z + CS * y);

/* ---------- noise ---------- */
const hash3 = (x, y, z, s) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const sm = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
function noise2(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z), u = sm(x - xi), v = sm(z - zi);
  return lerp(lerp(hash3(xi, 0, zi, s), hash3(xi + 1, 0, zi, s), u), lerp(hash3(xi, 0, zi + 1, s), hash3(xi + 1, 0, zi + 1, s), u), v);
}
function noise3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), u = sm(x - xi), v = sm(y - yi), w = sm(z - zi);
  return lerp(
    lerp(lerp(hash3(xi, yi, zi, s), hash3(xi + 1, yi, zi, s), u), lerp(hash3(xi, yi + 1, zi, s), hash3(xi + 1, yi + 1, zi, s), u), v),
    lerp(lerp(hash3(xi, yi, zi + 1, s), hash3(xi + 1, yi, zi + 1, s), u), lerp(hash3(xi, yi + 1, zi + 1, s), hash3(xi + 1, yi + 1, zi + 1, s), u), v),
    w);
}
// A column evaluator for noise3: a world column (x, z) keeps its sideways blend fixed while y changes, so the hashes at each height level are computed once
// per column and every y after that is two blends instead of eight hashes. It does the very same arithmetic as noise3, so the numbers are identical.
class CN3 {
  constructor(kx, ky, kz, s) { this.kx = kx; this.ky = ky; this.kz = kz; this.s = s; this.P = new Float64Array(64); this.Q = new Float64Array(64); this.st = new Int32Array(64); this.cur = 0; this.xi = 0; this.zi = 0; this.u = 0; this.w = 0; }
  col(wx, wz) { const x = wx * this.kx, z = wz * this.kz; this.xi = Math.floor(x); this.zi = Math.floor(z); this.u = sm(x - this.xi); this.w = sm(z - this.zi); this.cur++; }
  fill(l) {
    const { xi, zi, s, u } = this;
    this.P[l] = lerp(hash3(xi, l, zi, s), hash3(xi + 1, l, zi, s), u);
    this.Q[l] = lerp(hash3(xi, l, zi + 1, s), hash3(xi + 1, l, zi + 1, s), u);
    this.st[l] = this.cur;
  }
  get(y) {
    const yy = y * this.ky, yi = Math.floor(yy), v = sm(yy - yi), st = this.st, cur = this.cur;
    if (st[yi] !== cur) this.fill(yi);
    if (st[yi + 1] !== cur) this.fill(yi + 1);
    const P = this.P, Q = this.Q;
    return lerp(lerp(P[yi], P[yi + 1], v), lerp(Q[yi], Q[yi + 1], v), this.w);
  }
}
function fbm2(x, z, s, octaves) {
  let a = 1, f = 1, sum = 0, n = 0;
  for (let i = 0; i < octaves; i++) { sum += a * noise2(x * f, z * f, s + i * 101); n += a; a *= 0.5; f *= 2; }
  return sum / n;
}

/* ---------- terrain ---------- */
// Surface height h (top solid block), surface kind k (0 grass, 1 sand, 2 snow) and moisture w for a column.
function column1(x, z, s) {
  const c = fbm2(x / 200, z / 200, s, 3), hl = fbm2(x / 55, z / 55, s + 1, 4), m = Math.max(0, fbm2(x / 150, z / 150, s + 2, 3) - 0.55);
  let h = SL + (c - 0.43) * 56 + (hl - 0.5) * 14 + m * 90;
  h = Math.max(2, Math.min(58 + OFF, Math.floor(h)));
  const t = fbm2(x / 320, z / 320, s + 3, 2), w = fbm2(x / 260, z / 260, s + 4, 2);
  let k = 0;
  if (h <= SL + 1 || (t > 0.6 && w < 0.5)) k = 1;
  else if (h > 44 || t < 0.34) k = 2;
  return { h, k, w };
}

// Caves: winding tunnels plus deep caverns. On land they are allowed to cut all the way through the grass,
// so entrances open on hillsides and in the ground. Under the sea the sea floor stays sealed.
function carved1(x, y, z, s, h) {
  if (y <= 3 || y > (h > SL + 1 ? h : h - 4)) return false;
  const a = noise3(x * 0.045, y * 0.07, z * 0.045, s + 50);
  if (Math.abs(a - 0.5) < 0.042) {
    const b = noise3(x * 0.045 + 100, y * 0.07, z * 0.045 + 100, s + 51);
    if (Math.abs(b - 0.5) < 0.042) return true;
  }
  return y < 26 && noise3(x * 0.03, y * 0.05, z * 0.03, s + 52) > 0.79;
}

// One 16 x 64 x 16 chunk as a Uint8Array of block ids, indexed by idx(x, y, z).
function genChunk1(cx, cz, seed) {
  const d = new Uint8Array(CS * CS * CH), ox = cx * CS, oz = cz * CS;
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const wx = ox + x, wz = oz + z, { h, k } = column1(wx, wz, seed);
    for (let y = 0; y <= h; y++) {
      let id;
      if (y === 0) id = B.BEDROCK;
      else if (y === h) id = k === 1 ? B.SAND : k === 2 ? B.SNOW : B.GRASS;
      else if (y >= h - 3) id = k === 1 ? B.SAND : B.DIRT;
      else {
        id = B.STONE;
        const cr = hash3(wx >> 1, y >> 1, wz >> 1, seed + 7), keep = hash3(wx, y, wz, seed + 8) < 0.75; // ore comes in small veins
        if (keep && cr < 0.0011 && y < 16) id = B.DIAMOND;
        else if (keep && cr < 0.0045 && y < 26) id = B.GOLD;
        else if (keep && cr < 0.0125 && y < 40) id = B.IRON;
        else if (keep && cr < 0.0285 && y < 56) id = B.COAL;
        else if (y < 52 && noise3(wx * 0.09, y * 0.09, wz * 0.09, seed + 60) > 0.87) id = B.GRAVEL;
      }
      if (carved1(wx, y, wz, seed, h)) id = 0;
      d[idx(x, y, z)] = id;
    }
    for (let y = h + 1; y <= SL; y++) d[idx(x, y, z)] = B.WATER;
  }
  // Trees: decided per world column so a tree that straddles a chunk border is built identically from both sides.
  const put = (wx, y, wz, id, onlyAir) => {
    const x = wx - ox, z = wz - oz;
    if (x < 0 || x >= CS || z < 0 || z >= CS || y < 0 || y >= CH) return;
    const i = idx(x, y, z);
    if (!onlyAir || d[i] === 0) d[i] = id;
  };
  for (let tz = oz - 2; tz < oz + CS + 2; tz++) for (let tx = ox - 2; tx < ox + CS + 2; tx++) {
    if (hash3(tx, 0, tz, seed + 99) >= 0.045) continue;
    const { h, k, w } = column1(tx, tz, seed);
    if (k !== 0 || h <= SL + 1 || h > 40) continue;
    if (w < 0.55 && hash3(tx, 1, tz, seed + 98) > 0.3) continue;
    if (carved1(tx, h, tz, seed, h)) continue; // no tree standing over a cave mouth
    const th = 4 + Math.floor(hash3(tx, 2, tz, seed + 97) * 3);
    for (let dy = th - 2; dy <= th + 1; dy++) {
      const r = dy >= th ? 1 : 2;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dz === 0 && dy <= th) continue;
        if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        if (dy === th + 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
        put(tx + dx, h + dy, tz + dz, B.LEAVES, true);
      }
    }
    for (let y = 1; y <= th; y++) put(tx, h + y, tz, B.LOG, false);
  }
  return d;
}

// A dry grassy spot with no trees nearby, searched in rings around the origin.
function findSpawn1(seed) {
  const treeNear = (x, z) => {
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (hash3(x + dx, 0, z + dz, seed + 99) < 0.045) return true;
    return false;
  };
  for (let r = 0; r < 600; r += 4) {
    const n = Math.max(1, Math.round(r / 2));
    for (let a = 0; a < n; a++) {
      const x = Math.round(Math.cos((a / n) * 6.2832) * r), z = Math.round(Math.sin((a / n) * 6.2832) * r), { h, k } = column1(x, z, seed);
      if (k === 0 && h > SL + 2 && h < 38 && !treeNear(x, z) && !carved1(x, h, z, seed, h) && !carved1(x, h - 1, z, seed, h)) return { x: x + 0.5, y: h + 1.05, z: z + 0.5 };
    }
  }
  const { h } = column1(0, 0, seed);
  return { x: 0.5, y: Math.max(h, SL) + 2, z: 0.5 };
}

/* ---------- generation 2: mountain ranges, rivers, lava, caves that open into water ---------- */
// Worlds remember which generation made them (room.gen), so older worlds keep exactly the terrain they had. New worlds use 2.
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function column2(x, z, s) {
  const v6 = OFF > 0, cont = fbm2(x / (v6 ? 640 : 240), z / (v6 ? 640 : 240), s, 4), hills = fbm2(x / 64, z / 64, s + 1, 4);
  const range = G7 ? ss(0.50, 0.64, fbm2(x / 380, z / 380, s + 2, 3)) : ss(0.54, 0.70, fbm2(x / 170, z / 170, s + 2, 3)); // where the mountain ranges are (g7: ranges more than twice as wide, and more of them)
  const ridge = 1 - Math.abs(fbm2(x / (G7 ? 120 : 52), z / (G7 ? 120 : 52), s + 5, 4) * 2 - 1); // sharp crest lines inside a range
  const c0 = v6 ? 0.52 : 0.45, land = v6 ? ss(0.48, 0.6, cont) : ss(0.4, 0.52, cont); // (v6: the sea takes about twice the area and each ocean is far wider)
  let h = SL + 5 + (cont < c0 ? (cont - c0) * (v6 ? 110 : 80) : (cont - c0) * 36) + (hills - 0.5) * 14; // deep seas, gentle lowlands
  h += G8 ? range * land * (ridge * ridge * 150 + hills * 24 + 22) : G7 ? range * land * (ridge * ridge * 84 + hills * 16 + 16) : range * land * (ridge * ridge * 34 + hills * 7); // g7: massifs that rise to more than twice the old height
  const rv = Math.abs(fbm2(x / 130, z / 130, s + 7, 2) - 0.5); // rivers follow the 0.5 contour of a smooth noise
  const rf = (1 - ss(0.018, 0.07, rv)) * (v6 ? ss(0.47, 0.57, cont) : ss(0.4, 0.5, cont));
  // v6: a river bed is deepest down the middle and lumpy, instead of one flat level
  const tgt = v6 ? Math.min(SL - 2, SL - 3 - (1 - ss(0, 0.05, rv)) * 2.6 + (fbm2(x / 8, z / 8, s + 8, 3) - 0.5) * 4.5) : SL - 3;
  h += (tgt - h) * rf * (1 - range * 0.5);
  if (v6 && h < SL - 1) h += (fbm2(x / 16, z / 16, s + 9, 3) - 0.5) * 7 * ss(SL - 1, SL - 6, h); // v6: hummocks and hollows on every sea floor
  if (G8) { if (h > 90) h = 90 + 118 * (1 - Math.exp(-(h - 90) / 118)); } // g8: peaks reach about 200
  else if (G7) { if (h > 82) h = 82 + 36 * (1 - Math.exp(-(h - 82) / 36)); } // peaks flatten out softly just under the ceiling (g7: up to 118, a fifty-block higher ceiling than before)
  else if (h > 44 + OFF) h = 44 + OFF + 14 * (1 - Math.exp(-(h - 44 - OFF) / 14)); // peaks flatten out softly just under the ceiling instead of being sliced off
  h = Math.max(2, Math.min(G8 ? 215 : G7 ? 118 : 58 + OFF, Math.floor(h)));
  const t = fbm2(x / 320, z / 320, s + 3, 2), w = fbm2(x / 260, z / 260, s + 4, 2);
  let k = 0;
  if (h <= SL + 1 || (t > 0.6 && w < 0.5 && h < 36 + OFF)) k = 1;
  else if (h > (G10 ? snowLn(x, z, s) : (G7 ? 52 : 44) + OFF) || t < 0.32) k = 2;
  return { h, k, w };
}
// Caves reach all the way up through the ground, sand and sea floors, so they can open into the water around them.
function carved2(x, y, z, s, h, v3 = false) {
  if (y <= 3 || y > h) return false;
  const a = noise3(x * 0.045, y * 0.07, z * 0.045, s + 50);
  if (Math.abs(a - 0.5) < 0.042) {
    const b = noise3(x * 0.045 + 100, y * 0.07, z * 0.045 + 100, s + 51);
    if (Math.abs(b - 0.5) < 0.042) return true;
  }
  return cavern2(x, y, z, s) && (!v3 || y <= h - 5); // v3: a big cavern keeps a roof of at least 4 blocks, so it never opens into the sky
}
const cavern2 = (x, y, z, s) => y < 26 + OFF && noise3(x * 0.03, y * 0.05, z * 0.03, s + 52) > 0.79;
const poolNoise = (x, z, s) => noise2(x / 38, z / 38, s + 33);
// v3 (generation 3) keeps generation 2's land exactly and changes only the lava: pools on the surface are much rarer and are recessed pits with a stone shore,
// cavern lakes sit at varying levels (so lava steps and spills down between them), and lava springs in cave walls pour down to the cave floor.
// Generation 6 rock: the lower half of the stone is deepslate, and the change between the two is a wide, ragged band (not a flat line).
const deepslateAt = (x, y, z, s) => 0.5 + ((0.55 * noise3(x * 0.06, y * 0.12, z * 0.06, s + 88) + 0.45 * hash3(x, y, z, s + 89)) - 0.5) * 2.2 > (y - 10) / 42; // (a long ramp from y 10 to 52, ragged with noise)
// Each ore has its own level where it is commonest (the middle of its range) and thins out to nothing at the ends of the range.
const tri = (y, lo, pk, hi) => (y <= lo || y >= hi ? 0 : y < pk ? (y - lo) / (pk - lo) : (hi - y) / (hi - pk));
const oreAt = (cr, y, m = 1) => { // m: how much richer the rock is (g8 deepslate has about twice as much ore)
  const pd = 0.0032 * m * tri(y, 2, 9, 34), pg = 0.006 * m * tri(y, 2, 22, 58), pi = 0.015 * m * tri(y, 8, 52, G8 ? 130 : 100), pc = 0.03 * m * tri(y, 30, 84, G8 ? 170 : 126);
  return cr < pd ? B.DIAMOND : cr < pd + pg ? B.GOLD : cr < pd + pg + pi ? B.IRON : cr < pd + pg + pi + pc ? B.COAL : 0;
};
const floorOf = (x, z, s) => { const n = noise2(x / 6.5, z / 6.5, s + 85); return n > 0.64 ? B.GRAVEL : n < 0.2 ? B.DIRT : B.SAND; }; // sea and river floors: sand with patches of gravel and dirt
/* ---------- generation 9: caves under the sea and rivers are full of water ---------- */
// Every cave air cell below sea level that sits under a sea or river bed, or that is joined (through cave air) to such a cell or to open sea water beside it, is filled
// with still water. The join is followed through the 5 x 5 chunks around the chunk being made, so a tunnel that runs out of the sea is flooded for a good way along.
// The answer for a cell never depends on which chunk asks, only on the seed, so neighbouring chunks agree.
const tileCache = new Map(), maskCache = new Map();
function lru(map, key, cap, make) {
  let v = map.get(key);
  if (v) { map.delete(key); map.set(key, v); return v; }
  v = make(); map.set(key, v); if (map.size > cap) map.delete(map.keys().next().value);
  return v;
}
const colTile = (cx, cz, seed) => lru(tileCache, seed + (G10 ? 'p' : '') + ':' + cx + ',' + cz, 2400, () => { // the column numbers (height, surface kind, moisture, biome) of every column of a chunk, worked out once and reused by its neighbours
  const t = { h: new Int16Array(CS * CS), k: new Uint8Array(CS * CS), w: new Float32Array(CS * CS), b: new Uint8Array(CS * CS) }, ox = cx * CS, oz = cz * CS;
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) { const c = column4(ox + x, oz + z, seed), i = x + CS * z; t.h[i] = c.h; t.k[i] = c.k; t.w[i] = c.w; t.b[i] = c.b | 0; }
  return t;
});
// For one chunk: which cells below the sea level are cave air (1), and which of them are flooded by themselves (the "seeds"): the sea or river bed is over them,
// or open sea water is beside them.
const caveMask = (cx, cz, seed) => lru(maskCache, seed + ':' + cx + ',' + cz, 450, () => {
  const SLn = SL, air = new Uint8Array(CS * CS * (SLn + 1)), seeds = [], ox = cx * CS, oz = cz * CS, T = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) T.push(colTile(cx + dx, cz + dz, seed).h);
  const hAt = (lx, lz) => T[((lz >> 4) + 1) * 3 + (lx >> 4) + 1][(lx & 15) + CS * (lz & 15)]; // lx, lz from -16 to 31
  const CA = new CN3(0.045, 0.07, 0.045, seed + 50), CV = new CN3(0.03, 0.05, 0.03, seed + 52);
  let n = 0;
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const wx = ox + x, wz = oz + z, h = T[4][x + CS * z];
    if (h <= 3) continue;
    CA.col(wx, wz); CV.col(wx, wz);
    const lakeTop = 5 + Math.floor(noise2(wx / 46, wz / 46, seed + 81) * 4), top = Math.min(h, SLn);
    const hE = hAt(x + 1, z), hW = hAt(x - 1, z), hS = hAt(x, z + 1), hN = hAt(x, z - 1);
    for (let y = 4; y <= top; y++) {
      const cav = y < 26 + OFF && CV.get(y) > 0.79; // the same test as carved2 (generation 3 and later)
      if (!((Math.abs(CA.get(y) - 0.5) < 0.042 && Math.abs(noise3(wx * 0.045 + 100, y * 0.07, wz * 0.045 + 100, seed + 51) - 0.5) < 0.042) || (cav && y <= h - 5))) continue;
      const i = x + CS * (z + CS * y);
      if (y <= lakeTop && cav && h >= lakeTop + 6) { air[i] = 3; continue; } // a lava lake, not air
      n++;
      if (h < SLn || y > hE || y > hW || y > hS || y > hN) { air[i] = 2; seeds.push(i); } else air[i] = 1;
    }
  }
  // Only a seed with a dry cave cell beside it (or on the chunk's edge, where the next chunk may have one) has to start the spread; the rest are inside the water already.
  const act = [];
  for (const i of seeds) {
    const lx = i & 15, lz = (i >> 4) & 15, y = i >> 8;
    if (lx === 0 || lx === 15 || lz === 0 || lz === 15 || air[i + 1] === 1 || air[i - 1] === 1 || air[i + 16] === 1 || air[i - 16] === 1 || air[i + 256] === 1 || (y > 0 && air[i - 256] === 1)) act.push(i);
  }
  return { air, seeds: Int32Array.from(act), n };
});
let floodSeen = null, floodQ = new Int32Array(1 << 16);
function floodCaves(d, cx, cz, seed) {
  const mid = caveMask(cx, cz, seed);
  if (!mid.n) return; // no cave air under the sea level in this chunk
  const MY = SL + 1, RW = CS * 5, SLICE = RW * RW, masks = [];
  for (let m = 0; m < 25; m++) masks.push(m === 12 ? mid : caveMask(cx + (m % 5) - 2, cz + ((m / 5) | 0) - 2, seed));
  if (!floodSeen || floodSeen.length !== SLICE * MY) floodSeen = new Uint8Array(SLICE * MY); else floodSeen.fill(0);
  const seen = floodSeen; let q = floodQ, qh = 0, qt = 0;
  for (let m = 0; m < 25; m++) {
    const sd = masks[m].seeds, mx = (m % 5) * CS, mz = ((m / 5) | 0) * CS;
    for (let j = 0; j < sd.length; j++) {
      const i = sd[j], r = mx + (i & 15) + RW * (mz + ((i >> 4) & 15)) + SLICE * (i >> 8);
      if (!seen[r]) { seen[r] = 1; if (qt >= q.length) { const nq = new Int32Array(q.length * 2); nq.set(q); q = floodQ = nq; } q[qt++] = r; }
    }
  }
  const airs = masks.map((m) => m.air);
  const push = (nr) => { seen[nr] = 1; if (qt >= q.length) { const nq = new Int32Array(q.length * 2); nq.set(q); q = floodQ = nq; } q[qt++] = nr; };
  while (qh < qt) {
    const r = q[qh++], y = (r / SLICE) | 0, rem = r - y * SLICE, rz = (rem / RW) | 0, rx = rem - rz * RW;
    const lx = rx & 15, lz = rz & 15, ci = (rz >> 4) * 5 + (rx >> 4), li = lx + 16 * lz + 256 * y, own = airs[ci];
    // the six neighbours: a step across a chunk edge reads the next chunk's cave mask
    if (lx < 15) { if (!seen[r + 1] && own[li + 1] === 1) push(r + 1); } else if (rx + 1 < RW && !seen[r + 1] && airs[ci + 1][li - 15] === 1) push(r + 1);
    if (lx > 0) { if (!seen[r - 1] && own[li - 1] === 1) push(r - 1); } else if (rx > 0 && !seen[r - 1] && airs[ci - 1][li + 15] === 1) push(r - 1);
    if (lz < 15) { if (!seen[r + RW] && own[li + 16] === 1) push(r + RW); } else if (rz + 1 < RW && !seen[r + RW] && airs[ci + 5][li - 240] === 1) push(r + RW);
    if (lz > 0) { if (!seen[r - RW] && own[li - 16] === 1) push(r - RW); } else if (rz > 0 && !seen[r - RW] && airs[ci - 5][li + 240] === 1) push(r - RW);
    if (y + 1 < MY && !seen[r + SLICE] && own[li + 256] === 1) push(r + SLICE);
    if (y > 0 && !seen[r - SLICE] && own[li - 256] === 1) push(r - SLICE);
  }
  const A = mid.air;
  for (let y = 4; y < MY; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const i = x + CS * (z + CS * y);
    const a = A[i];
    if (!a || a === 3 || (a === 1 && !seen[32 + x + RW * (32 + z) + SLICE * y]) || d[i] !== 0) continue;
    d[i] = B.WATER;
    // water against lava: a source turns to obsidian and flowing lava to cobblestone (the same rule the running game uses), for lava beside or under the new water
    for (let k = 0; k < 5; k++) {
      const lx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), lz = z + (k === 2 ? 1 : k === 3 ? -1 : 0), ly = k === 4 ? y - 1 : y;
      if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || ly < 0) continue;
      const j = lx + CS * (lz + CS * ly), v = d[j];
      if (v === B.LAVA) d[j] = B.OBSIDIAN; else if (v > B.LAVA && v <= LAVA_FALL) d[j] = B.COBBLE;
    }
  }
}
function genChunk2(cx, cz, seed, v3 = false, v4 = false, v9 = false) {
  const d = new Uint8Array(CS * CS * CH), ox = cx * CS, oz = cz * CS, M = G10 ? 12 : v4 ? 5 : 3, W = CS + 2 * M;
  const CA = new CN3(0.045, 0.07, 0.045, seed + 50), CV = new CN3(0.03, 0.05, 0.03, seed + 52), DS = new CN3(0.06, 0.12, 0.06, seed + 88), GR = new CN3(0.09, 0.09, 0.09, seed + 60), LV = new CN3(0.08, 0.11, 0.08, seed + 70);
  const hm = new Int16Array(W * W), km = new Uint8Array(W * W), wm = new Float32Array(W * W), bm = new Uint8Array(W * W);
  if (v9) { // generation 9 takes the column numbers from the shared tiles (each column is worked out once for all nine chunks that need it)
    const T = []; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) T.push(colTile(cx + dx, cz + dz, seed));
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const lx = i - M, lz = j - M, t = T[((lz >> 4) + 1) * 3 + (lx >> 4) + 1], q = (lx & 15) + CS * (lz & 15), o = j * W + i;
      hm[o] = t.h[q]; km[o] = t.k[q]; wm[o] = t.w[q]; bm[o] = t.b[q];
    }
  } else for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { const c = (v4 ? column4 : column2)(ox - M + i, oz - M + j, seed); hm[j * W + i] = c.h; km[j * W + i] = c.k; wm[j * W + i] = c.w; bm[j * W + i] = c.b | 0; }
  const mk = v9 ? caveMask(cx, cz, seed).air : null; // generation 9: which cells below the sea level are cave (1 dry, 2 under the sea, 3 lava lake)
  const H = (x, z) => hm[(z + M) * W + x + M];
  const slopeAt = (x, z) => { const h = H(x, z); return Math.max(Math.abs(H(x + 1, z) - h), Math.abs(H(x - 1, z) - h), Math.abs(H(x, z + 1) - h), Math.abs(H(x, z - 1) - h)); };
  const poolAtC = (x, z) => { // a surface lava pool: flat, dry ground at least 2 blocks above any water
    const h = H(x, z), k = km[(z + M) * W + x + M];
    return h > SL + 3 && h < 40 + OFF && k !== 2 && slopeAt(x, z) === 0 && Math.min(H(x + 2, z), H(x - 2, z), H(x, z + 2), H(x, z - 2)) > SL + 2 && poolNoise(ox + x, oz + z, seed) > (v3 ? 0.935 : 0.84);
  };
  const poolShore = (x, z) => { // v3: the ring of ground around a pool
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && poolAtC(x + dx, z + dz)) return true;
    return false;
  };
  const waterNear = (x, y, z) => { // is there open sea or river water beside this cell?
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + a, nz = z + b; if (nx < -M || nx >= CS + M || nz < -M || nz >= CS + M) continue; if (y > H(nx, nz) && y <= SL) return true; }
    return false;
  };
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const wx = ox + x, wz = oz + z, h = H(x, z), k = km[(z + M) * W + x + M], sl = slopeAt(x, z);
    const snowCap = h >= (G10 ? snowLn(wx, wz, seed) : (G7 ? 56 : 48) + OFF), v6 = OFF > 0, desert = v6 && bm[(z + M) * W + x + M] === 1 && k === 1, rock = !snowCap && ((k === 0 && h > SL + 2 && sl >= 3) || k === 3), sandDepth = v4 && bm[(z + M) * W + x + M] === 1 ? 4 : 3, pool = poolAtC(x, z), shore = v3 && !pool && poolShore(x, z);
    const lakeTop = v3 ? 5 + Math.floor(noise2(wx / 46, wz / 46, seed + 81) * 4) : 9; // how high the lava lake reaches here: 5 to 8 in v3, always 9 before
    CA.col(wx, wz); CV.col(wx, wz); DS.col(wx, wz); GR.col(wx, wz); LV.col(wx, wz);
    const cavernC = (y) => y < 26 + OFF && CV.get(y) > 0.79; // cavern2 for this column
    const carve = (y) => { // carved2 for this column (the same test, with the noise worked out once per column)
      if (y <= 3 || y > h) return false;
      if (mk && y <= SL) return mk[x + CS * (z + CS * y)] !== 0; // (generation 9: already worked out for the flooding)
      if (Math.abs(CA.get(y) - 0.5) < 0.042 && Math.abs(noise3(wx * 0.045 + 100, y * 0.07, wz * 0.045 + 100, seed + 51) - 0.5) < 0.042) return true;
      return cavernC(y) && (!v3 || y <= h - 5);
    };
    for (let y = 0; y <= h; y++) {
      let id;
      if (y === 0) id = B.BEDROCK;
      else if (y === h) id = snowCap && h > SL + 1 ? B.SNOW : rock ? B.STONE : k === 1 ? B.SAND : k === 2 && h > SL + 1 ? B.SNOW : B.GRASS;
      else if (y >= h - sandDepth && !snowCap && !rock) id = k === 1 ? (v6 && h <= SL && y >= h - 2 ? floorOf(wx, wz, seed) : B.SAND) : B.DIRT;
      else {
        id = v6 ? (y < 78 && 0.5 + ((0.55 * DS.get(y) + 0.45 * hash3(wx, y, wz, seed + 89)) - 0.5) * 2.2 > (y - 10) / 42 ? B.DEEPSLATE : B.STONE) : B.STONE; // (deepslateAt: above 77 it can never be true)
        const cr = hash3(wx >> 1, y >> 1, wz >> 1, seed + 7), keep = hash3(wx, y, wz, seed + 8) < 0.75;
        if (desert && y >= h - sandDepth - 7) id = B.SANDSTONE; // the desert sits on a thick bed of sandstone
        else if (v6) { const deep = G8 && id === B.DEEPSLATE, o = keep && cr < 0.13 ? oreAt(cr, y, deep ? 2.3 : 1) : 0; if (o) id = deep ? DS_ORE[o] : o; else if (y < 52 + OFF && GR.get(y) > 0.87) id = B.GRAVEL; }
        else if (keep && cr < 0.0011 && y < 16) id = B.DIAMOND;
        else if (keep && cr < 0.0045 && y < 26) id = B.GOLD;
        else if (keep && cr < 0.0125 && y < 40) id = B.IRON;
        else if (keep && cr < 0.0285 && y < 56) id = B.COAL;
        else if (y < 52 && GR.get(y) > 0.87) id = B.GRAVEL;
        if ((id === B.STONE || id === B.DEEPSLATE) && y > 3 && y < 16 && LV.get(y) > (v3 ? 0.905 : 0.885) && !carve(y - 1) && !carve(y + 1)) id = B.LAVA; // small lava pockets deep in solid rock (never hanging over a cave)
      }
      if (carve(y)) id = mk && y <= SL ? (mk[x + CS * (z + CS * y)] === 3 ? B.LAVA : 0) : y <= lakeTop && y > 3 && cavernC(y) && (!v3 || h >= lakeTop + 6) ? B.LAVA : 0; // (v3: never where the ground above is so low that the lake would show on the surface) // big deep caverns have a lava lake on the floor; tunnels stay open
      if (pool) { if (v3) { if (y >= h) id = 0; else if (y >= h - 2) id = B.LAVA; } else if (y >= h - 1) id = B.LAVA; } // occasional lava pool on flat ground (v3: a recessed pit, one block below the grass)
      else if (shore && y >= h - 1 && !snowCap) id = B.STONE; // v3: bare stone around a pool
      d[idx(x, y, z)] = id;
    }
    for (let y = h + 1; y <= SL; y++) d[idx(x, y, z)] = B.WATER;
    if (v6 && h <= SL - 3 && !carved2(wx, h, wz, seed, h, v3)) { // seaweed: in clumps on the sea and river floors, one to four blocks tall, never right under the surface
      const dens = noise2(wx / 11, wz / 11, seed + 121) > 0.5 ? 0.34 : 0.035;
      if (hash3(wx, 7, wz, seed + 120) < dens && d[idx(x, h, z)] !== 0 && !isWater(d[idx(x, h, z)])) {
        const tall = Math.min(1 + Math.floor(hash3(wx, 8, wz, seed + 122) * 4), SL - 2 - h);
        for (let q = 1; q <= tall; q++) d[idx(x, h + q, z)] = B.SEAWEED;
      }
    }
    // A cave that opens through the sea or river floor lets the water pour in as a waterfall down to the cave floor.
    if (v9) { /* generation 9 floods every cave under the sea level after the chunk is made (floodCaves below) */ }
    else if (h < SL && carved2(wx, h, wz, seed, h, v3)) for (let y = h; y > 9 && carved2(wx, y, wz, seed, h, v3); y--) d[idx(x, y, z)] = WATER_FALL;
    // Caves that open sideways into water get flooded at their mouth.
    else if (h <= SL + 6) for (let y = Math.max(4, h - 6); y <= Math.min(h, SL); y++) if (d[idx(x, y, z)] === 0 && waterNear(x, y, z)) d[idx(x, y, z)] = B.WATER;
  }
  if (v9) floodCaves(d, cx, cz, seed);
  // v3: lava springs in cave walls. A lava block set into a wall right beside open cave air with a drop under it, so it runs out and pours down to the floor.
  if (v3) for (let z = 1; z < CS - 1; z++) for (let x = 1; x < CS - 1; x++) {
    const h = H(x, z), top = Math.min(h - 8, 30);
    for (let y = 8; y <= top; y++) {
      const i = idx(x, y, z);
      if (d[i] !== B.STONE || hash3(ox + x, y, oz + z, seed + 83) >= 0.003) continue;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (d[idx(x + a, y, z + b)] === 0 && d[idx(x + a, y - 1, z + b)] === 0 && d[idx(x + a, y - 2, z + b)] === 0) { d[i] = B.LAVA; break; }
      }
    }
  }
  if (v4) { features4(d, { ox, oz, M, W, hm, km, bm, wm, seed, poolAtC, poolShore, slopeAt, v3 }); return d; }
  // Trees: only on gentle grass, never on bare rock, snow, sand or a lava pool.
  const put = (wx, y, wz, id, onlyAir) => {
    const x = wx - ox, z = wz - oz;
    if (x < 0 || x >= CS || z < 0 || z >= CS || y < 0 || y >= CH) return;
    const i = idx(x, y, z);
    if (!onlyAir || d[i] === 0) d[i] = id;
  };
  for (let tz = oz - 2; tz < oz + CS + 2; tz++) for (let tx = ox - 2; tx < ox + CS + 2; tx++) {
    if (hash3(tx, 0, tz, seed + 99) >= 0.045) continue;
    const lx = tx - ox, lz = tz - oz, h = H(lx, lz), k = km[(lz + M) * W + lx + M], w = wm[(lz + M) * W + lx + M];
    if (k !== 0 || h <= SL + 1 || h > 40 + OFF || slopeAt(lx, lz) >= 3 || poolAtC(lx, lz) || (v3 && poolShore(lx, lz))) continue;
    if (w < 0.55 && hash3(tx, 1, tz, seed + 98) > 0.3) continue;
    if (carved2(tx, h, tz, seed, h, v3)) continue;
    const th = 4 + Math.floor(hash3(tx, 2, tz, seed + 97) * 3);
    for (let dy = th - 2; dy <= th + 1; dy++) {
      const r = dy >= th ? 1 : 2;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dz === 0 && dy <= th) continue;
        if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        if (dy === th + 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
        put(tx + dx, h + dy, tz + dz, B.LEAVES, true);
      }
    }
    for (let y = 1; y <= th; y++) put(tx, h + y, tz, B.LOG, false);
  }
  return d;
}
function findSpawn2(seed, v4 = false) {
  const col = v4 ? column4 : column2;
  const treeNear = (x, z) => {
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (v4 ? treeKind(x + dx, z + dz, seed, 0) : hash3(x + dx, 0, z + dz, seed + 99) < 0.045) return true;
    return false;
  };
  for (let r = 0; r < 800; r += 4) {
    const n = Math.max(1, Math.round(r / 2));
    for (let a = 0; a < n; a++) {
      const x = Math.round(Math.cos((a / n) * 6.2832) * r), z = Math.round(Math.sin((a / n) * 6.2832) * r), { h, k, b } = col(x, z, seed);
      if (k === 0 && (!b || b === 4) && h > SL + 2 && h < 36 + OFF && !treeNear(x, z) && poolNoise(x, z, seed) < 0.7 && !carved2(x, h, z, seed, h) && !carved2(x, h - 1, z, seed, h)
        && Math.abs(col(x + 1, z, seed).h - h) < 2 && Math.abs(col(x, z + 1, seed).h - h) < 2) return { x: x + 0.5, y: h + 1.05, z: z + 0.5 };
    }
  }
  const { h } = col(0, 0, seed);
  return { x: 0.5, y: Math.max(h, SL) + 2, z: 0.5 };
}

// The public terrain functions. gen is the world's generation: 1 = the original terrain, 2 = mountains, rivers and lava.
export const column = (x, z, s, gen = 1) => (setBS(gen), gen >= 4 ? column4(x, z, s) : gen >= 2 ? column2(x, z, s) : column1(x, z, s));
export const carved = (x, y, z, s, h, gen = 1) => (setBS(gen), gen >= 2 ? carved2(x, y, z, s, h, gen >= 3) : carved1(x, y, z, s, h));
export const genChunk = (cx, cz, seed, gen = 1) => (setBS(gen), gen >= 2 ? genChunk2(cx, cz, seed, gen >= 3, gen >= 4, gen >= 9) : genChunk1(cx, cz, seed));
export const findSpawn = (seed, gen = 1) => (setBS(gen), gen >= 2 ? findSpawn2(seed, gen >= 4) : findSpawn1(seed));
export const NEW_GEN = 10; // new worlds use this; older worlds keep the generation they were made with
export const normGen = (g) => (g >= 10 ? 10 : g >= 9 ? 9 : g >= 8 ? 8 : g >= 7 ? 7 : g >= 6 ? 6 : g === 5 ? 5 : g === 4 ? 4 : g === 3 ? 3 : g === 2 ? 2 : 1);
// The biome at a spot: 0 temperate, 1 desert, 2 cold. Only generation 4 worlds have biomes; older worlds are all temperate.
export const biomeAt = (x, z, s, gen = 4) => (setBS(gen), gen >= 4 ? biomeOfNoise(x, z, s) : 0);

/* ---------- generation 4: desert and cold biomes, varied trees, sand and snow layers ---------- */
// Temperature and dryness decide the biome. The scales are large, so a desert is a vast region and a cold land stretches for hundreds of blocks.
// Generation 5 makes every biome 3 times wider than generation 4 did (BS is set from the world's generation by the public functions below, which run synchronously).
// Generation 6 also stands the whole world 50 blocks higher (sea level 70 instead of 20) so there is three times as much rock under the ground, with deepslate in the lower half.
// Generation 7 keeps the generation 6 sea, rivers, caves and deserts, and changes: much bigger mountains, two kinds of cold land (taiga with spruce forest, tundra with no trees),
// plains full of grass and flowers, a forest with grass, flowers and birches, and the cold land really covered in snow with spruce trees standing in it.
let BS = 1, OFF = 0, SL = 20, G7 = false, G8 = false, G10 = false;
// Generation 8 keeps generation 7's world and changes: a 256-block build limit with far higher mountains (peaks up to about 200), deepslate ores and denser ore in the deepslate,
// flowers in big regions (some with none at all, some thick with them) and forests that are all oak, all birch or a mix of both.
const setBS = (gen) => { BS = gen >= 5 ? 3 : 1; OFF = gen >= 6 ? 50 : 0; SL = 20 + OFF; G7 = gen >= 7; G8 = gen >= 8; G10 = gen >= 10; };
export const seaOf = (gen) => (gen >= 6 ? 70 : 20);
export const deepLine = (gen) => (gen >= 6 ? 32 : -1); // the height below which it is deepslate country (used for the underground music)
const tempMoist = (x, z, s) => [fbm2(x / (430 * BS), z / (430 * BS), s + 11, 3), fbm2(x / (380 * BS), z / (380 * BS), s + 12, 3)];
const desertW = (t, m) => ss(0.56, 0.61, t) * (1 - ss(0.5, 0.56, m));
function biomeOfNoise(x, z, s) { const [t, m] = tempMoist(x, z, s); return desertW(t, m) >= 0.5 ? 1 : t < 0.372 ? 2 : 0; } // the coarse biome: 0 temperate, 1 desert, 2 cold
// Generation 7 splits two of them: cold land is taiga (2, spruce forest) or tundra (3, no trees at all), and temperate land is forest (0) or plains (4).
const tundraN = (x, z, s) => fbm2(x / (250 * BS), z / (250 * BS), s + 13, 3), plainsN = (x, z, s) => fbm2(x / (230 * BS), z / (230 * BS), s + 14, 3);
// Generation 10: the snow on mountains starts far higher (about 142 blocks, ragged from place to place; it used to start at 106), and the temperate land gains two biomes:
// a pine forest on its cool side (next to the taiga) and a jungle on its warm, wet side (next to the desert).
const snowLn = (x, z, s) => 142 + (noise2(x / 40, z / 40, s + 150) - 0.5) * 16;
const biome10 = (x, z, s) => {
  const [t, m] = tempMoist(x, z, s), j = (fbm2(x / (110 * BS), z / (110 * BS), s + 160, 2) - 0.5) * 0.06;
  if (t + j > 0.57 && m > 0.57) return 6;
  if (t + j < 0.425) return 5;
  return -1;
};
const subBiome = (x, z, s, b) => (!G7 ? b : b === 2 ? (tundraN(x, z, s) > 0.5 ? 3 : 2) : b === 0 ? (G10 && biome10(x, z, s) >= 0 ? biome10(x, z, s) : plainsN(x, z, s) > 0.52 ? 4 : 0) : b);
export const BIOME_NAMES = ['Forest', 'Desert', 'Snowy Taiga', 'Snowy Tundra', 'Plains', 'Pine Forest', 'Jungle'];
// The detailed biome at a spot (0 forest, 1 desert, 2 snowy taiga, 3 snowy tundra, 4 plains); older worlds only have 0, 1 and 2.
export const biomeKind = (x, z, s, gen = 4) => (setBS(gen), gen >= 4 ? subBiome(x, z, s, biomeOfNoise(x, z, s)) : 0);
// Generation 6 dunes: curving crests with a long gentle windward slope and a short steep far side, different in size from place to place.
function duneH6(x, z, s) {
  const field = ss(0.28, 0.52, fbm2(x / 230, z / 230, s + 21, 2));
  if (field <= 0) return 0;
  const wx = x + (fbm2(x / 50, z / 50, s + 24, 2) - 0.5) * 46, wz = z + (fbm2(x / 50 + 40, z / 50 + 40, s + 25, 2) - 0.5) * 46;
  const u = wx * 0.87 + wz * 0.5, v = -wx * 0.5 + wz * 0.87; // u runs across the wind, v along a crest
  const period = 34 + 26 * fbm2(x / 260, z / 260, s + 26, 2);
  const ph = u / period + fbm2(v / 80, u / 160, s + 27, 2) * 1.8, f = ph - Math.floor(ph);
  const saw = f < 0.7 ? f / 0.7 : (1 - f) / 0.3, crest = saw * saw * (3 - 2 * saw), amp = 2.5 + 7 * fbm2(x / 180, z / 180, s + 28, 2);
  return field * (crest * amp + (fbm2(x / 7, z / 7, s + 23, 2) - 0.5) * 0.9);
}
// Dunes: long ridges that run across the wind, only in some parts of the desert (the rest is a flat, empty sand sea).
function duneH(x, z, s) {
  if (OFF > 0) return duneH6(x, z, s);
  const u = x * 0.87 + z * 0.5, v = -x * 0.5 + z * 0.87;
  const field = ss(0.46, 0.62, fbm2(x / 150, z / 150, s + 21, 2));
  if (field <= 0) return 0;
  const ridge = 1 - Math.abs(fbm2(u / 26, v / 70, s + 22, 3) * 2 - 1);
  return field * (Math.pow(ridge, 3) * 4.4 + (fbm2(x / 9, z / 9, s + 23, 2) - 0.5) * 1.8);
}
const rockH = (x, z, s) => { const n = noise2(x / 5.2, z / 5.2, s + 31); return n > 0.84 ? 1 + Math.floor((n - 0.84) * 14) : 0; }; // small stone outcrops poking out of the sand
function column4(x, z, s) {
  const c = column2(x, z, s), [t, m] = tempMoist(x, z, s), dw = desertW(t, m), b = subBiome(x, z, s, dw >= 0.5 ? 1 : t < 0.372 ? 2 : 0);
  let h = c.h, k = c.k;
  if (dw > 0 && c.h > SL + 1) { // the land flattens out into a wide, low desert and blends back into the surroundings
    const flat = Math.max(SL + 2, SL + 3 + (c.h - SL - 3) * 0.2 + duneH(x, z, s) * dw);
    h = Math.max(SL + 2, Math.floor(c.h + (flat - c.h) * dw));
    if (b === 1) { k = 1; if (OFF === 0) { const r = rockH(x, z, s); if (r > 0) { h += r; k = 3; } } } // (v6: no stone outcrops in the desert)
  } else if (b === 2 || b === 3) k = c.h > (G10 ? snowLn(x, z, s) : G7 ? 52 + OFF : 44) && c.h > SL + 1 ? 2 : c.k === 1 ? 1 : 0; // (snow never covers the sea or river floor: only land above the water line can be snowy) // cold land is grass under snow layers, bare snow only up on the peaks (before generation 7 the whole cold land counted as peak, so no spruce could stand there)
  return { h: Math.max(2, Math.min(G8 ? 215 : G7 ? 118 : 58 + OFF, h)), k, w: c.w, b };
}
// Where a tree may stand and what kind. Groves and clearings come from a slow noise, so trees clump and thin out instead of sitting evenly.
function treeKind(tx, tz, seed, b) {
  if (b === 1 || b === 3) return 0; // no trees in the desert or in the tundra
  const dens = noise2(tx / 34, tz / 34, seed + 91), p = (b === 4 ? 0.006 : b === 5 ? 0.056 : b === 6 ? 0.07 : b === 2 ? (G7 ? 0.058 : 0.05) : 0.045) * ((b === 2 && G7) || b === 5 ? 0.35 + 2 * dens * dens : b === 6 ? 0.55 + 1.5 * dens * dens : 0.12 + 2.4 * dens * dens); // plains: a lone tree here and there; taiga and pine forest: dense spruce or pine; jungle: thick
  if (hash3(tx, 0, tz, seed + 99) >= p) return 0;
  return 1 + Math.floor(hash3(tx, 5, tz, seed + 96) * 6);
}
function features4(d, X) {
  const { ox, oz, M, W, hm, km, bm, wm, seed, poolAtC, poolShore, slopeAt, v3 } = X;
  const H = (x, z) => hm[(z + M) * W + x + M], K = (x, z) => km[(z + M) * W + x + M], Bm = (x, z) => bm[(z + M) * W + x + M];
  const put = (wx, y, wz, id, onlyAir) => {
    const x = wx - ox, z = wz - oz;
    if (x < 0 || x >= CS || z < 0 || z >= CS || y < 0 || y >= CH) return;
    const i = idx(x, y, z);
    if (!onlyAir || d[i] === 0) d[i] = id;
  };
  const r = (tx, tz, i) => hash3(tx, 10 + i, tz, seed + 95);
  /* ---- desert: cactus, dead bushes, and sand layers that only gather where the ground is uneven ---- */
  const sandy = (x, z) => Bm(x, z) === 1 && K(x, z) === 1 && H(x, z) > SL + 1;
  const cand = (x, z) => sandy(x, z) && hash3(ox + x, 3, oz + z, seed + 61) < 0.013;
  const flat = (x, z) => Math.abs(H(x + 1, z) - H(x, z)) <= 1 && Math.abs(H(x - 1, z) - H(x, z)) <= 1 && Math.abs(H(x, z + 1) - H(x, z)) <= 1 && Math.abs(H(x, z - 1) - H(x, z)) <= 1;
  const cactusAt = (x, z) => {
    if (!cand(x, z) || !flat(x, z)) return 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && cand(x + dx, z + dz)) return 0; // cacti stand alone
    return 1 + Math.floor(hash3(ox + x, 4, oz + z, seed + 62) * 3); // 1 to 3 blocks tall
  };
  const nearCactus = (x, z) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (cactusAt(x + dx, z + dz)) return true; return false; }; // sand never piles up around a cactus
  // Sand is caught by bumps: a cell collects sand only when a higher block stands within three cells of it (the closer and taller, the more). Flat ground collects none.
  const L1 = (x, z) => {
    if (!sandy(x, z)) return 0;
    const h = H(x, z); let c = 0;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const up = H(x + dx, z + dz) - h;
      if ((dx || dz) && up > 0) c = Math.max(c, up * 4.2 - (Math.max(Math.abs(dx), Math.abs(dz)) - 1) * 1.5);
    }
    c *= 0.5 + noise2((ox + x) / 6.3, (oz + z) / 6.3, seed + 41);
    return c >= 0.75 ? Math.min(7, Math.round(c)) : 0;
  };
  // ...and sand is more likely right next to sand that is already there, which stretches the heaps into dunes.
  const L2 = (x, z) => {
    let n = L1(x, z);
    if (!sandy(x, z)) return 0;
    let best = 0;
    for (const [a, b] of DIR4) { const q = L1(x + a, z + b); if (q >= 2 && H(x + a, z + b) + 1 >= H(x, z)) best = Math.max(best, q); }
    if (best) n = Math.max(n, Math.floor(best * 0.72 + 0.2 + noise2((ox + x) / 5.1, (oz + z) / 5.1, seed + 42) * 0.7));
    return Math.min(7, n);
  };
  // Grass and flowers (generation 7). The plains are thick with both; the forest has patches. Flowers come in clumps of one colour, with a few strays of other colours.
  const flora = (wx, h, wz, plains) => {
    const r = hash3(wx, 11, wz, seed + 130), r2 = hash3(wx, 12, wz, seed + 131), patch = noise2(wx / 9, wz / 9, seed + 132), clump = Math.floor(noise2(wx / 16 + 50, wz / 16 + 50, seed + 133) * 7) % 7;
    let inPatch = patch > (plains ? 0.6 : 0.7), fd = inPatch ? (plains ? 0.5 : 0.32) : plains ? 0.06 : 0.01;
    if (G8) { // flowers by region: below half the land has none at all, a band has a few, and some regions are thick with them (the clumps inside those are packed)
      const reg = ss(0.5, 0.64, fbm2(wx / 120, wz / 120, seed + 136, 3));
      inPatch = patch > 0.7 - reg * 0.18;
      fd = 0.0004 + reg * (inPatch ? (plains ? 0.62 : 0.52) : plains ? 0.04 : 0.01);
    }
    const gd = plains ? 0.66 : 0.2 * (0.35 + 1.3 * noise2(wx / 28, wz / 28, seed + 134)); // how thick the grass is here
    if (r < fd) put(wx, h + 1, wz, FLOWER0 + (inPatch && r2 < 0.8 ? clump : Math.floor(hash3(wx, 13, wz, seed + 135) * 7)), true);
    else if (r < fd + gd) put(wx, h + 1, wz, r2 < (plains ? 0.28 : 0.1) ? B.TALL_GRASS : B.GRASS_PLANT, true);
  };
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const wx = ox + x, wz = oz + z, h = H(x, z), bio = Bm(x, z), ground = d[idx(x, h, z)];
    const snowH = G10 ? snowLn(wx, wz, seed) : (G7 ? 56 : 48) + OFF;
    if (h >= snowH + (G10 ? 0 : 4) || h <= SL + 1 || !isSolid(ground) || poolAtC(x, z)) continue;
    if (bio === 1 && K(x, z) === 1) {
      const cac = cactusAt(x, z);
      if (cac) { for (let y = 1; y <= cac; y++) put(wx, h + y, wz, B.CACTUS, true); continue; }
      const n = nearCactus(x, z) ? 0 : L2(x, z);
      if (n) put(wx, h + 1, wz, layerId(0, n), true);
      else if (hash3(wx, 6, wz, seed + 63) < 0.035) put(wx, h + 1, wz, B.DEAD_BUSH, true);
    } else if ((bio === 2 || bio === 3) && h < snowH) { // cold land: a cover of packed snow, a little thicker in dips and against rises
      const v = noise2(wx / 9, wz / 9, seed + 51), up = Math.max(H(x + 1, z), H(x - 1, z), H(x, z + 1), H(x, z - 1)) - h;
      put(wx, h + 1, wz, layerId(2, Math.min(5, 1 + Math.floor(v * 3.2) + (up > 0 ? 1 : 0))), true);
    } else if (G7 && (bio === 0 || bio === 4) && K(x, z) === 0 && ground === B.GRASS) flora(wx, h, wz, bio === 4);
    else if (G10 && (bio === 5 || bio === 6) && K(x, z) === 0 && ground === B.GRASS) { // pine forest: a little grass; jungle: thick grass and the odd flower
      const q = hash3(wx, 14, wz, seed + 137), q2 = hash3(wx, 15, wz, seed + 138);
      if (bio === 5) { if (q < 0.14) put(wx, h + 1, wz, q2 < 0.1 ? B.TALL_GRASS : B.GRASS_PLANT, true); }
      else if (q < 0.5) put(wx, h + 1, wz, q2 < 0.35 ? B.TALL_GRASS : B.GRASS_PLANT, true);
      else if (q < 0.515) put(wx, h + 1, wz, FLOWER0 + Math.floor(q2 * 7), true);
    }
  }
  /* ---- trees: oak in the temperate land, spruce in the cold ---- */
  const TM = G10 ? 9 : 4; // (generation 10: the big jungle trees reach nine blocks sideways)
  for (let tz = oz - TM; tz < oz + CS + TM; tz++) for (let tx = ox - TM; tx < ox + CS + TM; tx++) {
    const lx = tx - ox, lz = tz - oz, bio = Bm(lx, lz), kind = treeKind(tx, tz, seed, bio);
    if (!kind) continue;
    const h = H(lx, lz), k = K(lx, lz), w = wm[(lz + M) * W + lx + M];
    if (k !== 0 || h <= SL + 1 || h > (bio === 2 ? 46 : bio === 5 ? 56 : 40) + OFF || slopeAt(lx, lz) >= 3 || poolAtC(lx, lz) || (v3 && poolShore(lx, lz))) continue;
    if (bio === 0 && w < 0.55 && hash3(tx, 1, tz, seed + 98) > 0.3) continue;
    if (carved2(tx, h, tz, seed, h, v3)) continue;
    if (bio === 6) { // jungle: banana trees now and then, otherwise 1 x 1 trees, with 2 x 2 and (rarely) 3 x 3 giants wherever they have room
      const q = hash3(tx, 8, tz, seed + 101);
      if (q < 0.1) { banana(put, tx, h, tz, 1, (i) => r(tx, tz, i), seed); continue; }
      let size = q < 0.62 ? 1 : q < 0.93 ? 2 : 3;
      if (size > 1) for (let dz = -3; dz <= 3 && size > 1; dz++) for (let dx = -3; dx <= 3; dx++) if ((dx || dz) && treeKind(tx + dx, tz + dz, seed, 6)) { size = 1; break; }
      jungle(put, tx, h, tz, size, (i) => r(tx, tz, i), seed); continue;
    }
    (bio === 2 ? spruce : bio === 5 ? pineTree : G8 ? (hash3(tx, 7, tz, seed + 92) < birchFrac(tx, tz, seed) ? birch : oak) : G7 && hash3(tx, 7, tz, seed + 92) < (bio === 4 ? 0.25 : 0.4) ? birch : oak)(put, tx, h, tz, kind, (i) => r(tx, tz, i), seed);
  }
  if (G10) { berries10(put, d, X, H, K, Bm); cane10(put, d, X, H, K); }
}
// Generation 8 forest kinds: slow regional noise makes the woods all oak, all birch, or half and half.
const birchFrac = (x, z, s) => { const f = fbm2(x / 130, z / 130, s + 141, 2); return ss(0.40, 0.44, f) * 0.5 + ss(0.56, 0.60, f) * 0.5; };
// Oak: six different shapes (small and round, tall and narrow, wide and flat, big, leaning, and a low bush), each with its own size, and ragged leaves.
function oak(put, tx, h, tz, kind, r, seed) {
  let th, rx, ry, cy, lean = 0, ldx = 0, ldz = 0;
  if (kind === 1) { th = 4 + Math.floor(r(0) * 2); rx = 2.3; ry = 1.9; cy = th; }
  else if (kind === 2) { th = 6 + Math.floor(r(0) * 3); rx = 2.1; ry = 2.9; cy = th - 1; }
  else if (kind === 3) { th = 3 + Math.floor(r(0) * 2); rx = 3.5; ry = 1.7; cy = th; }
  else if (kind === 4) { th = 6 + Math.floor(r(0) * 3); rx = 3.3; ry = 3.1; cy = th - 0.5; }
  else if (kind === 5) { th = 5 + Math.floor(r(0) * 2); rx = 2.4; ry = 2; cy = th; lean = 2 + Math.floor(r(1) * 2); const a = Math.floor(r(2) * 4); ldx = [1, -1, 0, 0][a]; ldz = [0, 0, 1, -1][a]; }
  else { th = 1 + Math.floor(r(0) * 2); rx = 1.8; ry = 1.5; cy = th; }
  rx *= 0.9 + r(3) * 0.25; ry *= 0.9 + r(4) * 0.25; // no two are quite the same size
  let cx = tx, cz = tz;
  for (let y = 1; y <= th; y++) { if (lean && y > lean) { cx = tx + ldx; cz = tz + ldz; } put(cx, h + y, cz, B.LOG, false); }
  const R = Math.ceil(rx), RY = Math.ceil(ry);
  for (let dy = -RY; dy <= RY + 1; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const e = (dx / rx) ** 2 + ((dy - (cy - th) + 0.0) / ry) ** 2 + (dz / rx) ** 2, y = h + th + dy;
    const j = (hash3(cx + dx, y, cz + dz, seed + 94) - 0.5) * 0.6;
    if (dx === 0 && dz === 0 && dy < 0) continue;
    if (e + j <= 1 || (dx === 0 && dz === 0 && dy === 1)) put(cx + dx, y, cz + dz, B.LEAVES, true);
  }
}
// Birch: a slim pale trunk and a narrow, slightly ragged oval of light leaves.
function birch(put, tx, h, tz, kind, r, seed) {
  const th = 5 + Math.floor(r(0) * 4), rx = 1.9 + r(3) * 0.4, ry = 2.2 + r(4) * 0.6, top = th - 1;
  for (let y = 1; y <= th; y++) put(tx, h + y, tz, B.BIRCH_LOG, false);
  const R = Math.ceil(rx), RY = Math.ceil(ry);
  for (let dy = -RY; dy <= RY + 1; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const y = h + top + dy, e = (dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rx) ** 2, j = (hash3(tx + dx, y, tz + dz, seed + 94) - 0.5) * 0.6;
    if (dx === 0 && dz === 0 && y <= h + th) continue;
    if (e + j <= 1) put(tx + dx, y, tz + dz, B.BIRCH_LEAVES, true);
  }
}
// Spruce: a tall narrow cone, a slim spire, a short wide one, or a thin sparse one; always with a bare trunk at the bottom and a point on top.
function spruce(put, tx, h, tz, kind, r, seed, LOG = B.SPRUCE_LOG, LEAF = B.SPRUCE_LEAVES) {
  const v = kind % 4, bare = G10 && r(6) < 0.6 ? 3 + Math.floor(r(7) * 2) : 1; // (generation 10: 6 in 10 spruce and pine trees stand on a bare trunk 3 or 4 blocks tall; the rest keep 1)
  const th = (v === 0 ? 6 + Math.floor(r(0) * 4) : v === 1 ? 9 + Math.floor(r(0) * 4) : v === 2 ? 4 + Math.floor(r(0) * 3) : 5 + Math.floor(r(0) * 4)) + bare - 1; // (a taller trunk lifts the whole crown, so the crown keeps its size)
  const maxR = v === 0 ? 3 : v === 1 ? 2 : v === 2 ? 3 : 2, slope = v === 0 ? 0.55 : v === 1 ? 0.4 : v === 2 ? 0.9 : 0.5, gap = v === 3 ? 0.3 : 0.06;
  for (let y = 1; y <= th; y++) put(tx, h + y, tz, LOG, false);
  put(tx, h + th + 1, tz, LEAF, true); if (v !== 3) put(tx, h + th + 2, tz, LEAF, true);
  for (let i = 0, y = h + th; y >= h + 1 + bare; i++, y--) {
    const rad = Math.min(maxR, Math.floor((i + 1) * slope + (i & 1 ? 0.4 : 0)));
    if (rad < 1) continue;
    for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
      if (!dx && !dz) continue;
      if (rad >= 2 && Math.abs(dx) === rad && Math.abs(dz) === rad) continue; // rounded corners
      if (Math.max(Math.abs(dx), Math.abs(dz)) === rad && hash3(tx + dx, y, tz + dz, seed + 93) < gap) continue; // a few gaps on the outer ring
      put(tx + dx, y, tz + dz, LEAF, true);
    }
  }
}

/* ---------- generation 10: pine, jungle and banana trees, berry clumps, sugar cane ---------- */
// Pine: the spruce shapes, with their own (lighter) wood and needles.
const pineTree = (put, tx, h, tz, kind, r, seed) => spruce(put, tx, h, tz, kind, r, seed, B.PINE_LOG, B.PINE_LEAVES);
// A ragged ball of leaves (only into air).
function blob(put, cx, cy, cz, rx, ry, id, seed) {
  const R = Math.ceil(rx), RY = Math.ceil(ry);
  for (let dy = -RY; dy <= RY; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const e = (dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rx) ** 2, j = (hash3(cx + dx, cy + dy, cz + dz, seed + 94) - 0.5) * 0.6;
    if (e + j <= 1) put(cx + dx, cy + dy, cz + dz, id, true);
  }
}
// Jungle tree: size 1 is a 1 x 1 trunk, size 2 a 2 x 2 trunk and size 3 a 3 x 3 trunk (the big ones are much taller, flare into the ground and have side branches). Cocoa pods hang on the trunk.
function jungle(put, tx, h, tz, size, r, seed) {
  const n = size >= 3 ? 3 : size >= 2 ? 2 : 1, o = n === 3 ? -1 : 0;
  const th = n === 1 ? 7 + Math.floor(r(0) * 5) : n === 2 ? 13 + Math.floor(r(0) * 6) : 18 + Math.floor(r(0) * 6);
  const cells = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) cells.push([tx + o + i, tz + o + j]);
  const inT = (x, z) => x >= tx + o && x < tx + o + n && z >= tz + o && z < tz + o + n;
  for (const [x, z] of cells) for (let y = n === 1 ? 1 : -3; y <= th; y++) put(x, h + y, z, B.JUNGLE_LOG, false);
  for (const [x, z] of cells) for (let d = 0; d < 4; d++) { // cocoa pods on the outside of the trunk, below the leaves
    const px = x + DIR4[d][0], pz = z + DIR4[d][1];
    if (inT(px, pz)) continue;
    for (let y = 4; y <= th - 3; y++) if (hash3(px, h + y, pz, seed + 170 + d) < (n === 1 ? 0.07 : 0.03)) put(px, h + y, pz, COCOA0 + d, true);
  }
  const rx = n === 1 ? 3.3 : n === 2 ? 5.2 : 7, ry = n === 1 ? 2.5 : n === 2 ? 2.4 : 2.8;
  blob(put, tx, h + th - 1, tz, rx, ry, B.JUNGLE_LEAVES, seed);
  blob(put, tx, h + th + 1, tz, rx * 0.62, ry * 0.65, B.JUNGLE_LEAVES, seed);
  if (n > 1) for (let i = 0; i < n + 1; i++) { // side branches ending in their own clump of leaves
    const a = r(1 + i) * 6.2832, dd = rx * (0.6 + 0.25 * r(10 + i)), sy = h + th - 3 - Math.floor(r(20 + i) * 5);
    for (let t = n === 2 ? 1 : 2; t < dd * 0.75; t++) put(tx + Math.round(Math.cos(a) * t), sy, tz + Math.round(Math.sin(a) * t), B.JUNGLE_LOG, false);
    blob(put, tx + Math.round(Math.cos(a) * dd * 0.78), sy + 1, tz + Math.round(Math.sin(a) * dd * 0.78), 2.8, 1.9, B.JUNGLE_LEAVES, seed);
  }
}
// Banana tree: very short (a trunk of two or three blocks) with a flat crown of bright green fronds that droop at the tips.
function banana(put, tx, h, tz, kind, r, seed) {
  const th = 2 + Math.floor(r(0) * 2), top = h + th;
  for (let y = 1; y <= th; y++) put(tx, h + y, tz, B.BANANA_LOG, false);
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const a = Math.abs(dx), b = Math.abs(dz);
    if (!dx && !dz) continue;
    if (a + b <= 3 && !(a === 2 && b === 2)) put(tx + dx, top, tz + dz, B.BANANA_LEAVES, true);
    if ((a === 2 && !b) || (b === 2 && !a)) put(tx + dx, top - 1, tz + dz, B.BANANA_LEAVES, true);
  }
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) put(tx + dx, top + 1, tz + dz, B.BANANA_LEAVES, true);
}
// A tree for the server to grow from a sapling, as a list of [x, y, z, block, onlyIntoAir]; h is the ground's height (the sapling stands on it). Jungle trees come in size 1, 2 or 3.
export function treeBlocks(type, tx, h, tz, seed, size = 1, rnd = Math.random) {
  const out = [], put = (x, y, z, id, onlyAir) => out.push([x, y, z, id, onlyAir]), r = () => rnd();
  if (type === 'oak') oak(put, tx, h, tz, 1 + Math.floor(rnd() * 5), r, seed);
  else if (type === 'birch') birch(put, tx, h, tz, 1, r, seed);
  else if (type === 'spruce') spruce(put, tx, h, tz, Math.floor(rnd() * 3), r, seed);
  else if (type === 'pine') pineTree(put, tx, h, tz, Math.floor(rnd() * 3), r, seed);
  else if (type === 'jungle') jungle(put, tx, h, tz, size, r, seed);
  else banana(put, tx, h, tz, 1, r, seed);
  return out;
}
// Berry clumps: each 80 x 80 square may hold one clump (about 45% of them do), 3 to 20 bushes of one kind, all ripe. Blackberries grow in spruce and pine woods and on mountains,
// huckleberries in the oak and birch woods, strawberries thick in the jungle and very rarely in the oak woods. They stand only on open grass or dirt.
// The clump's centre is picked from a few tries in its square, so it lands in a place where bushes can stand rather than in a lake or a desert.
const BCELL = 80, clumpCache = new Map();
function clumpIn(ci, cj, seed) {
  return lru(clumpCache, seed + ':' + ci + ',' + cj, 6000, () => {
    const none = { x: 0, z: 0, kind: -1, n: 0 };
    if (hash3(ci, 1, cj, seed + 300) >= 0.45) return none;
    for (let t = 0; t < 4; t++) {
      const cx0 = ci * BCELL + 10 + Math.floor(hash3(ci, 2 + t * 7, cj, seed + 301) * (BCELL - 20)), cz0 = cj * BCELL + 10 + Math.floor(hash3(ci, 3 + t * 7, cj, seed + 302) * (BCELL - 20));
      const c = column4(cx0, cz0, seed);
      if (c.k !== 0 || c.h <= SL + 1 || c.h >= snowLn(cx0, cz0, seed) || c.b === 1 || c.b === 3 || c.b === 4) continue;
      const kind = c.h > SL + 24 ? 0 : c.b === 6 ? 1 : c.b === 2 || c.b === 5 ? 0 : c.b === 0 ? (hash3(ci, 4, cj, seed + 303) < 0.07 ? 1 : 2) : -1; // mountain: blackberry; jungle: strawberry; spruce, pine: blackberry; oak and birch woods: huckleberry (rarely strawberry)
      if (kind < 0) continue;
      return { x: cx0, z: cz0, kind, n: 3 + Math.floor(hash3(ci, 5, cj, seed + 304) * 18) };
    }
    return none;
  });
}
function berries10(put, d, X, H, K) {
  const { ox, oz, seed, poolAtC } = X;
  for (let cj = Math.floor(oz / BCELL); cj <= Math.floor((oz + CS - 1) / BCELL); cj++) for (let ci = Math.floor(ox / BCELL); ci <= Math.floor((ox + CS - 1) / BCELL); ci++) {
    const cl = clumpIn(ci, cj, seed); if (cl.kind < 0) continue;
    const R = 1.5 + Math.sqrt(cl.n) * 1.0;
    for (let i = 0; i < cl.n; i++) {
      const a = hash3(ci, 10 + i, cj, seed + 305) * 6.2832, rr = Math.sqrt(hash3(ci, 40 + i, cj, seed + 306)) * R;
      const bx = Math.round(cl.x + Math.cos(a) * rr), bz = Math.round(cl.z + Math.sin(a) * rr), lx = bx - ox, lz = bz - oz;
      if (lx < 0 || lx >= CS || lz < 0 || lz >= CS) continue;
      const h = H(lx, lz);
      if (K(lx, lz) !== 0 || h <= SL + 1 || h >= snowLn(bx, bz, seed) || poolAtC(lx, lz)) continue;
      const ground = d[idx(lx, h, lz)], above = d[idx(lx, h + 1, lz)];
      if ((ground !== B.GRASS && ground !== B.DIRT) || !(above === 0 || above === B.GRASS_PLANT || above === B.TALL_GRASS || isFlower(above) || (above >= 69 && above <= 75))) continue; // (69..75: a snow cover that the bush pokes through)
      put(bx, h + 1, bz, bushId(cl.kind, 3), false);
    }
  }
}
// Sugar cane: one to three tall, in clumps, on sand, dirt or grass at the water's edge (level with the water beside it).
function cane10(put, d, X, H, K) {
  const { ox, oz, seed } = X;
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const h = H(x, z); if (h !== SL || K(x, z) === 2) continue;
    const g = d[idx(x, h, z)]; if (g !== B.SAND && g !== B.DIRT && g !== B.GRASS) continue;
    if (!(H(x + 1, z) < SL || H(x - 1, z) < SL || H(x, z + 1) < SL || H(x, z - 1) < SL)) continue;
    const wx = ox + x, wz = oz + z, dens = noise2(wx / 9, wz / 9, seed + 311) > 0.7 ? 0.035 : 0.0005; // (rarer again in generation 12: few clumps, almost no loners)
    if (hash3(wx, 20, wz, seed + 310) >= dens) continue;
    const th = 1 + Math.floor(hash3(wx, 21, wz, seed + 312) * 3);
    for (let y = 1; y <= th; y++) { if (d[idx(x, h + y, z)] !== 0) break; put(wx, h + y, wz, B.SUGAR_CANE, true); }
  }
}
