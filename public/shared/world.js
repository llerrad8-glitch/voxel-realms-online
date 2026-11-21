// Shared by the browser and the Node server: block table + deterministic terrain from a seed.
// The server never sends terrain, only edits; both sides regenerate the same world from the seed.
export const CS = 16, CH = 128, SEA = 20; // (SEA is generation 1 to 5's sea level; generation 6 stands 50 blocks higher, see seaOf)
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
export const isLayer = (id) => id >= 55 && id <= 75;
export const layerKind = (id) => ((id - 55) / 7) | 0; // 0 sand, 1 loose snow, 2 packed snow
export const layerN = (id) => ((id - 55) % 7) + 1; // eighths of a block
export const layerId = (kind, n) => 55 + kind * 7 + n - 1;
export const layerFull = (kind) => (kind === 0 ? B.SAND : kind === 1 ? B.SNOW : B.PACKED_SNOW); // eight layers make this block
export const isPlant = (id) => id === B.DEAD_BUSH;
export const fallsId = (id) => id === B.SAND || id === B.GRAVEL || id === B.SNOW || (id >= 55 && id <= 68); // what drops when nothing holds it up
export const isLava = (id) => id >= 45 && id <= 49;
export const lavaAmount = (id) => (id === 45 || id === LAVA_FALL ? 4 : id >= 46 && id < LAVA_FALL ? id - 45 : 0);
export const lavaFlowId = (amount, falling) => (falling ? LAVA_FALL : amount >= 4 ? 45 : 45 + amount);
export const isFluid = (id) => isWater(id) || isLava(id);
export const isTorch = (id) => id >= 31 && id <= 35;
export const isBed = (id) => id >= 36 && id <= 43;
export const isDoor = (id) => id >= 77 && id <= 92;
export const doorUpper = (id) => id >= 85, doorOpen = (id) => ((id - 77) & 4) !== 0, doorDir = (id) => (id - 77) & 3;
export const doorId = (upper, open, dir) => 77 + (upper ? 8 : 0) + (open ? 4 : 0) + dir;
export const DOOR_OPEN_SIDE = [2, 3, 1, 0]; // an open door swings round the same corner: the panel moves from its closed side to this one
export const DOOR_T = 3 / 16;
export const isVariant = (id) => (id >= 32 && id <= 43) || (id >= 77 && id <= 92) || id === 54 || (id >= 55 && id <= 75); // placed forms that are not items of their own
export const BED_H = 9 / 16;
export const blockHeight = (id) => (isBed(id) ? BED_H : id >= 55 && id <= 75 ? (((id - 55) % 7) + 1) / 8 : 1);
export const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const bedDir = (id) => (id - 36) & 3, bedIsHead = (id) => id >= 40;
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
export const isSolid = (id) => id !== 0 && !isWater(id) && !isLava(id) && !isTorch(id) && id !== 54 && !(id >= 81 && id <= 84) && !(id >= 89 && id <= 92);
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
  const range = ss(0.54, 0.70, fbm2(x / 170, z / 170, s + 2, 3)); // where the mountain ranges are
  const ridge = 1 - Math.abs(fbm2(x / 52, z / 52, s + 5, 4) * 2 - 1); // sharp crest lines inside a range
  const c0 = v6 ? 0.52 : 0.45, land = v6 ? ss(0.48, 0.6, cont) : ss(0.4, 0.52, cont); // (v6: the sea takes about twice the area and each ocean is far wider)
  let h = SL + 5 + (cont < c0 ? (cont - c0) * (v6 ? 110 : 80) : (cont - c0) * 36) + (hills - 0.5) * 14; // deep seas, gentle lowlands
  h += range * land * (ridge * ridge * 34 + hills * 7);
  const rv = Math.abs(fbm2(x / 130, z / 130, s + 7, 2) - 0.5); // rivers follow the 0.5 contour of a smooth noise
  const rf = (1 - ss(0.018, 0.07, rv)) * (v6 ? ss(0.47, 0.57, cont) : ss(0.4, 0.5, cont));
  // v6: a river bed is deepest down the middle and lumpy, instead of one flat level
  const tgt = v6 ? Math.min(SL - 2, SL - 3 - (1 - ss(0, 0.05, rv)) * 2.6 + (fbm2(x / 8, z / 8, s + 8, 3) - 0.5) * 4.5) : SL - 3;
  h += (tgt - h) * rf * (1 - range * 0.5);
  if (v6 && h < SL - 1) h += (fbm2(x / 16, z / 16, s + 9, 3) - 0.5) * 7 * ss(SL - 1, SL - 6, h); // v6: hummocks and hollows on every sea floor
  if (h > 44 + OFF) h = 44 + OFF + 14 * (1 - Math.exp(-(h - 44 - OFF) / 14)); // peaks flatten out softly just under the ceiling instead of being sliced off
  h = Math.max(2, Math.min(58 + OFF, Math.floor(h)));
  const t = fbm2(x / 320, z / 320, s + 3, 2), w = fbm2(x / 260, z / 260, s + 4, 2);
  let k = 0;
  if (h <= SL + 1 || (t > 0.6 && w < 0.5 && h < 36 + OFF)) k = 1;
  else if (h > 44 + OFF || t < 0.32) k = 2;
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
const oreAt = (cr, y) => {
  const pd = 0.0032 * tri(y, 2, 9, 34), pg = 0.006 * tri(y, 2, 22, 58), pi = 0.015 * tri(y, 8, 52, 100), pc = 0.03 * tri(y, 30, 84, 126);
  return cr < pd ? B.DIAMOND : cr < pd + pg ? B.GOLD : cr < pd + pg + pi ? B.IRON : cr < pd + pg + pi + pc ? B.COAL : 0;
};
const floorOf = (x, z, s) => { const n = noise2(x / 6.5, z / 6.5, s + 85); return n > 0.64 ? B.GRAVEL : n < 0.2 ? B.DIRT : B.SAND; }; // sea and river floors: sand with patches of gravel and dirt
function genChunk2(cx, cz, seed, v3 = false, v4 = false) {
  const d = new Uint8Array(CS * CS * CH), ox = cx * CS, oz = cz * CS, M = v4 ? 5 : 3, W = CS + 2 * M;
  const hm = new Int16Array(W * W), km = new Uint8Array(W * W), wm = new Float32Array(W * W), bm = new Uint8Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { const c = (v4 ? column4 : column2)(ox - M + i, oz - M + j, seed); hm[j * W + i] = c.h; km[j * W + i] = c.k; wm[j * W + i] = c.w; bm[j * W + i] = c.b | 0; }
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
    const snowCap = h >= 48 + OFF, v6 = OFF > 0, desert = v6 && bm[(z + M) * W + x + M] === 1 && k === 1, rock = !snowCap && ((k === 0 && h > SL + 2 && sl >= 3) || k === 3), sandDepth = v4 && bm[(z + M) * W + x + M] === 1 ? 4 : 3, pool = poolAtC(x, z), shore = v3 && !pool && poolShore(x, z);
    const lakeTop = v3 ? 5 + Math.floor(noise2(wx / 46, wz / 46, seed + 81) * 4) : 9; // how high the lava lake reaches here: 5 to 8 in v3, always 9 before
    for (let y = 0; y <= h; y++) {
      let id;
      if (y === 0) id = B.BEDROCK;
      else if (y === h) id = snowCap ? B.SNOW : rock ? B.STONE : k === 1 ? B.SAND : k === 2 ? B.SNOW : B.GRASS;
      else if (y >= h - sandDepth && !snowCap && !rock) id = k === 1 ? (v6 && h <= SL && y >= h - 2 ? floorOf(wx, wz, seed) : B.SAND) : B.DIRT;
      else {
        id = v6 ? (deepslateAt(wx, y, wz, seed) ? B.DEEPSLATE : B.STONE) : B.STONE;
        const cr = hash3(wx >> 1, y >> 1, wz >> 1, seed + 7), keep = hash3(wx, y, wz, seed + 8) < 0.75;
        if (desert && y >= h - sandDepth - 7) id = B.SANDSTONE; // the desert sits on a thick bed of sandstone
        else if (v6) { const o = keep ? oreAt(cr, y) : 0; if (o) id = o; else if (y < 52 + OFF && noise3(wx * 0.09, y * 0.09, wz * 0.09, seed + 60) > 0.87) id = B.GRAVEL; }
        else if (keep && cr < 0.0011 && y < 16) id = B.DIAMOND;
        else if (keep && cr < 0.0045 && y < 26) id = B.GOLD;
        else if (keep && cr < 0.0125 && y < 40) id = B.IRON;
        else if (keep && cr < 0.0285 && y < 56) id = B.COAL;
        else if (y < 52 && noise3(wx * 0.09, y * 0.09, wz * 0.09, seed + 60) > 0.87) id = B.GRAVEL;
        if ((id === B.STONE || id === B.DEEPSLATE) && y > 3 && y < 16 && noise3(wx * 0.08, y * 0.11, wz * 0.08, seed + 70) > (v3 ? 0.905 : 0.885) && !carved2(wx, y - 1, wz, seed, h, v3) && !carved2(wx, y + 1, wz, seed, h, v3)) id = B.LAVA; // small lava pockets deep in solid rock (never hanging over a cave)
      }
      if (carved2(wx, y, wz, seed, h, v3)) id = y <= lakeTop && y > 3 && cavern2(wx, y, wz, seed) && (!v3 || h >= lakeTop + 6) ? B.LAVA : 0; // (v3: never where the ground above is so low that the lake would show on the surface) // big deep caverns have a lava lake on the floor; tunnels stay open
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
    if (h < SL && carved2(wx, h, wz, seed, h, v3)) for (let y = h; y > 9 && carved2(wx, y, wz, seed, h, v3); y--) d[idx(x, y, z)] = WATER_FALL;
    // Caves that open sideways into water get flooded at their mouth.
    else if (h <= SL + 6) for (let y = Math.max(4, h - 6); y <= Math.min(h, SL); y++) if (d[idx(x, y, z)] === 0 && waterNear(x, y, z)) d[idx(x, y, z)] = B.WATER;
  }
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
      if (k === 0 && !b && h > SL + 2 && h < 36 + OFF && !treeNear(x, z) && poolNoise(x, z, seed) < 0.7 && !carved2(x, h, z, seed, h) && !carved2(x, h - 1, z, seed, h)
        && Math.abs(col(x + 1, z, seed).h - h) < 2 && Math.abs(col(x, z + 1, seed).h - h) < 2) return { x: x + 0.5, y: h + 1.05, z: z + 0.5 };
    }
  }
  const { h } = col(0, 0, seed);
  return { x: 0.5, y: Math.max(h, SL) + 2, z: 0.5 };
}

// The public terrain functions. gen is the world's generation: 1 = the original terrain, 2 = mountains, rivers and lava.
export const column = (x, z, s, gen = 1) => (setBS(gen), gen >= 4 ? column4(x, z, s) : gen >= 2 ? column2(x, z, s) : column1(x, z, s));
export const carved = (x, y, z, s, h, gen = 1) => (setBS(gen), gen >= 2 ? carved2(x, y, z, s, h, gen >= 3) : carved1(x, y, z, s, h));
export const genChunk = (cx, cz, seed, gen = 1) => (setBS(gen), gen >= 2 ? genChunk2(cx, cz, seed, gen >= 3, gen >= 4) : genChunk1(cx, cz, seed));
export const findSpawn = (seed, gen = 1) => (setBS(gen), gen >= 2 ? findSpawn2(seed, gen >= 4) : findSpawn1(seed));
export const NEW_GEN = 6; // new worlds use this; older worlds keep the generation they were made with
export const normGen = (g) => (g >= 6 ? 6 : g === 5 ? 5 : g === 4 ? 4 : g === 3 ? 3 : g === 2 ? 2 : 1);
// The biome at a spot: 0 temperate, 1 desert, 2 cold. Only generation 4 worlds have biomes; older worlds are all temperate.
export const biomeAt = (x, z, s, gen = 4) => (setBS(gen), gen >= 4 ? biomeOfNoise(x, z, s) : 0);

/* ---------- generation 4: desert and cold biomes, varied trees, sand and snow layers ---------- */
// Temperature and dryness decide the biome. The scales are large, so a desert is a vast region and a cold land stretches for hundreds of blocks.
// Generation 5 makes every biome 3 times wider than generation 4 did (BS is set from the world's generation by the public functions below, which run synchronously).
// Generation 6 also stands the whole world 50 blocks higher (sea level 70 instead of 20) so there is three times as much rock under the ground, with deepslate in the lower half.
let BS = 1, OFF = 0, SL = 20;
const setBS = (gen) => { BS = gen >= 5 ? 3 : 1; OFF = gen >= 6 ? 50 : 0; SL = 20 + OFF; };
export const seaOf = (gen) => (gen >= 6 ? 70 : 20);
export const deepLine = (gen) => (gen >= 6 ? 32 : -1); // the height below which it is deepslate country (used for the underground music)
const tempMoist = (x, z, s) => [fbm2(x / (430 * BS), z / (430 * BS), s + 11, 3), fbm2(x / (380 * BS), z / (380 * BS), s + 12, 3)];
const desertW = (t, m) => ss(0.56, 0.61, t) * (1 - ss(0.5, 0.56, m));
function biomeOfNoise(x, z, s) { const [t, m] = tempMoist(x, z, s); return desertW(t, m) >= 0.5 ? 1 : t < 0.372 ? 2 : 0; }
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
  const c = column2(x, z, s), [t, m] = tempMoist(x, z, s), dw = desertW(t, m), b = dw >= 0.5 ? 1 : t < 0.372 ? 2 : 0;
  let h = c.h, k = c.k;
  if (dw > 0 && c.h > SL + 1) { // the land flattens out into a wide, low desert and blends back into the surroundings
    const flat = Math.max(SL + 2, SL + 3 + (c.h - SL - 3) * 0.2 + duneH(x, z, s) * dw);
    h = Math.max(SL + 2, Math.floor(c.h + (flat - c.h) * dw));
    if (b === 1) { k = 1; if (OFF === 0) { const r = rockH(x, z, s); if (r > 0) { h += r; k = 3; } } } // (v6: no stone outcrops in the desert)
  } else if (b === 2) k = c.h > 44 ? 2 : c.k === 1 ? 1 : 0; // cold land is grass under snow layers, bare snow only up on the peaks
  return { h: Math.max(2, Math.min(58 + OFF, h)), k, w: c.w, b };
}
// Where a tree may stand and what kind. Groves and clearings come from a slow noise, so trees clump and thin out instead of sitting evenly.
function treeKind(tx, tz, seed, b) {
  if (b === 1) return 0;
  const dens = noise2(tx / 34, tz / 34, seed + 91), p = (b === 2 ? 0.05 : 0.045) * (0.12 + 2.4 * dens * dens);
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
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const wx = ox + x, wz = oz + z, h = H(x, z), bio = Bm(x, z), ground = d[idx(x, h, z)];
    if (h >= 52 + OFF || h <= SL + 1 || !isSolid(ground) || poolAtC(x, z)) continue;
    if (bio === 1 && K(x, z) === 1) {
      const cac = cactusAt(x, z);
      if (cac) { for (let y = 1; y <= cac; y++) put(wx, h + y, wz, B.CACTUS, true); continue; }
      const n = nearCactus(x, z) ? 0 : L2(x, z);
      if (n) put(wx, h + 1, wz, layerId(0, n), true);
      else if (hash3(wx, 6, wz, seed + 63) < 0.035) put(wx, h + 1, wz, B.DEAD_BUSH, true);
    } else if (bio === 2 && h < 48 + OFF) { // cold land: a cover of packed snow, a little thicker in dips and against rises
      const v = noise2(wx / 9, wz / 9, seed + 51), up = Math.max(H(x + 1, z), H(x - 1, z), H(x, z + 1), H(x, z - 1)) - h;
      put(wx, h + 1, wz, layerId(2, Math.min(5, 1 + Math.floor(v * 3.2) + (up > 0 ? 1 : 0))), true);
    }
  }
  /* ---- trees: oak in the temperate land, spruce in the cold ---- */
  for (let tz = oz - 4; tz < oz + CS + 4; tz++) for (let tx = ox - 4; tx < ox + CS + 4; tx++) {
    const lx = tx - ox, lz = tz - oz, bio = Bm(lx, lz), kind = treeKind(tx, tz, seed, bio);
    if (!kind) continue;
    const h = H(lx, lz), k = K(lx, lz), w = wm[(lz + M) * W + lx + M];
    if (k !== 0 || h <= SL + 1 || h > (bio === 2 ? 46 : 40) + OFF || slopeAt(lx, lz) >= 3 || poolAtC(lx, lz) || (v3 && poolShore(lx, lz))) continue;
    if (bio === 0 && w < 0.55 && hash3(tx, 1, tz, seed + 98) > 0.3) continue;
    if (carved2(tx, h, tz, seed, h, v3)) continue;
    (bio === 2 ? spruce : oak)(put, tx, h, tz, kind, (i) => r(tx, tz, i), seed);
  }
}
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
// Spruce: a tall narrow cone, a slim spire, a short wide one, or a thin sparse one; always with a bare trunk at the bottom and a point on top.
function spruce(put, tx, h, tz, kind, r, seed) {
  const v = kind % 4;
  const th = v === 0 ? 6 + Math.floor(r(0) * 4) : v === 1 ? 9 + Math.floor(r(0) * 4) : v === 2 ? 4 + Math.floor(r(0) * 3) : 5 + Math.floor(r(0) * 4);
  const maxR = v === 0 ? 3 : v === 1 ? 2 : v === 2 ? 3 : 2, slope = v === 0 ? 0.55 : v === 1 ? 0.4 : v === 2 ? 0.9 : 0.5, gap = v === 3 ? 0.3 : 0.06;
  for (let y = 1; y <= th; y++) put(tx, h + y, tz, B.SPRUCE_LOG, false);
  put(tx, h + th + 1, tz, B.SPRUCE_LEAVES, true); if (v !== 3) put(tx, h + th + 2, tz, B.SPRUCE_LEAVES, true);
  for (let i = 0, y = h + th; y >= h + 2; i++, y--) {
    const rad = Math.min(maxR, Math.floor((i + 1) * slope + (i & 1 ? 0.4 : 0)));
    if (rad < 1) continue;
    for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
      if (!dx && !dz) continue;
      if (rad >= 2 && Math.abs(dx) === rad && Math.abs(dz) === rad) continue; // rounded corners
      if (Math.max(Math.abs(dx), Math.abs(dz)) === rad && hash3(tx + dx, y, tz + dz, seed + 93) < gap) continue; // a few gaps on the outer ring
      put(tx + dx, y, tz + dz, B.SPRUCE_LEAVES, true);
    }
  }
}
