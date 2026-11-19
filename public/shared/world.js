// Shared by the browser and the Node server: block table + deterministic terrain from a seed.
// The server never sends terrain, only edits; both sides regenerate the same world from the seed.
export const CS = 16, CH = 64, SEA = 20;
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
export const isLava = (id) => id >= 45 && id <= 49;
export const lavaAmount = (id) => (id === 45 || id === LAVA_FALL ? 4 : id >= 46 && id < LAVA_FALL ? id - 45 : 0);
export const lavaFlowId = (amount, falling) => (falling ? LAVA_FALL : amount >= 4 ? 45 : 45 + amount);
export const isFluid = (id) => isWater(id) || isLava(id);
export const isTorch = (id) => id >= 31 && id <= 35;
export const isBed = (id) => id >= 36 && id <= 43;
export const isVariant = (id) => id >= 32 && id <= 43; // placed forms that are not items of their own
export const BED_H = 9 / 16;
export const blockHeight = (id) => (isBed(id) ? BED_H : 1);
export const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const bedDir = (id) => (id - 36) & 3, bedIsHead = (id) => id >= 40;
export const TORCH_LIGHT = 14;
// Which torch block to place when a face of the target block is clicked (n = the face's normal); 0 = cannot place (ceiling).
export const torchFor = (nx, ny, nz) => (ny > 0 ? 31 : ny < 0 ? 0 : nx > 0 ? 32 : nx < 0 ? 33 : nz > 0 ? 34 : 35);
// The block a torch hangs on.
export function torchSupport(id, x, y, z) { return id === 31 ? [x, y - 1, z] : id === 32 ? [x - 1, y, z] : id === 33 ? [x + 1, y, z] : id === 34 ? [x, y, z - 1] : [x, y, z + 1]; }
export const isWater = (id) => id === B.WATER || (id >= 23 && id <= WATER_FALL);
export const waterAmount = (id) => (id === B.WATER || id === WATER_FALL ? 8 : id >= 23 && id < WATER_FALL ? id - 22 : 0);
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
export const isSolid = (id) => id !== 0 && !isWater(id) && !isLava(id) && !isTorch(id);
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
  let h = SEA + (c - 0.43) * 56 + (hl - 0.5) * 14 + m * 90;
  h = Math.max(2, Math.min(CH - 6, Math.floor(h)));
  const t = fbm2(x / 320, z / 320, s + 3, 2), w = fbm2(x / 260, z / 260, s + 4, 2);
  let k = 0;
  if (h <= SEA + 1 || (t > 0.6 && w < 0.5)) k = 1;
  else if (h > 44 || t < 0.34) k = 2;
  return { h, k, w };
}

// Caves: winding tunnels plus deep caverns. On land they are allowed to cut all the way through the grass,
// so entrances open on hillsides and in the ground. Under the sea the sea floor stays sealed.
function carved1(x, y, z, s, h) {
  if (y <= 3 || y > (h > SEA + 1 ? h : h - 4)) return false;
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
    for (let y = h + 1; y <= SEA; y++) d[idx(x, y, z)] = B.WATER;
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
    if (k !== 0 || h <= SEA + 1 || h > 40) continue;
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
      if (k === 0 && h > SEA + 2 && h < 38 && !treeNear(x, z) && !carved1(x, h, z, seed, h) && !carved1(x, h - 1, z, seed, h)) return { x: x + 0.5, y: h + 1.05, z: z + 0.5 };
    }
  }
  const { h } = column1(0, 0, seed);
  return { x: 0.5, y: Math.max(h, SEA) + 2, z: 0.5 };
}

/* ---------- generation 2: mountain ranges, rivers, lava, caves that open into water ---------- */
// Worlds remember which generation made them (room.gen), so older worlds keep exactly the terrain they had. New worlds use 2.
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function column2(x, z, s) {
  const cont = fbm2(x / 240, z / 240, s, 4), hills = fbm2(x / 64, z / 64, s + 1, 4);
  const range = ss(0.54, 0.70, fbm2(x / 170, z / 170, s + 2, 3)); // where the mountain ranges are
  const ridge = 1 - Math.abs(fbm2(x / 52, z / 52, s + 5, 4) * 2 - 1); // sharp crest lines inside a range
  const land = ss(0.4, 0.52, cont);
  let h = SEA + 5 + (cont < 0.45 ? (cont - 0.45) * 80 : (cont - 0.45) * 36) + (hills - 0.5) * 14; // deep seas, gentle lowlands
  h += range * land * (ridge * ridge * 34 + hills * 7);
  const rv = Math.abs(fbm2(x / 130, z / 130, s + 7, 2) - 0.5); // rivers follow the 0.5 contour of a smooth noise
  const rf = (1 - ss(0.018, 0.07, rv)) * ss(0.4, 0.5, cont);
  h += (SEA - 3 - h) * rf * (1 - range * 0.5);
  if (h > 44) h = 44 + 14 * (1 - Math.exp(-(h - 44) / 14)); // peaks flatten out softly just under the ceiling instead of being sliced off
  h = Math.max(2, Math.min(CH - 6, Math.floor(h)));
  const t = fbm2(x / 320, z / 320, s + 3, 2), w = fbm2(x / 260, z / 260, s + 4, 2);
  let k = 0;
  if (h <= SEA + 1 || (t > 0.6 && w < 0.5 && h < 36)) k = 1;
  else if (h > 44 || t < 0.32) k = 2;
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
const cavern2 = (x, y, z, s) => y < 26 && noise3(x * 0.03, y * 0.05, z * 0.03, s + 52) > 0.79;
const poolNoise = (x, z, s) => noise2(x / 38, z / 38, s + 33);
// v3 (generation 3) keeps generation 2's land exactly and changes only the lava: pools on the surface are much rarer and are recessed pits with a stone shore,
// cavern lakes sit at varying levels (so lava steps and spills down between them), and lava springs in cave walls pour down to the cave floor.
function genChunk2(cx, cz, seed, v3 = false) {
  const d = new Uint8Array(CS * CS * CH), ox = cx * CS, oz = cz * CS, M = 3, W = CS + 2 * M;
  const hm = new Int16Array(W * W), km = new Uint8Array(W * W), wm = new Float32Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { const c = column2(ox - M + i, oz - M + j, seed); hm[j * W + i] = c.h; km[j * W + i] = c.k; wm[j * W + i] = c.w; }
  const H = (x, z) => hm[(z + M) * W + x + M];
  const slopeAt = (x, z) => { const h = H(x, z); return Math.max(Math.abs(H(x + 1, z) - h), Math.abs(H(x - 1, z) - h), Math.abs(H(x, z + 1) - h), Math.abs(H(x, z - 1) - h)); };
  const poolAtC = (x, z) => { // a surface lava pool: flat, dry ground at least 2 blocks above any water
    const h = H(x, z), k = km[(z + M) * W + x + M];
    return h > SEA + 3 && h < 40 && k !== 2 && slopeAt(x, z) === 0 && Math.min(H(x + 2, z), H(x - 2, z), H(x, z + 2), H(x, z - 2)) > SEA + 2 && poolNoise(ox + x, oz + z, seed) > (v3 ? 0.935 : 0.84);
  };
  const poolShore = (x, z) => { // v3: the ring of ground around a pool
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && poolAtC(x + dx, z + dz)) return true;
    return false;
  };
  const waterNear = (x, y, z) => { // is there open sea or river water beside this cell?
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + a, nz = z + b; if (nx < -M || nx >= CS + M || nz < -M || nz >= CS + M) continue; if (y > H(nx, nz) && y <= SEA) return true; }
    return false;
  };
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const wx = ox + x, wz = oz + z, h = H(x, z), k = km[(z + M) * W + x + M], sl = slopeAt(x, z);
    const snowCap = h >= 48, rock = !snowCap && k === 0 && h > SEA + 2 && sl >= 3, pool = poolAtC(x, z), shore = v3 && !pool && poolShore(x, z);
    const lakeTop = v3 ? 5 + Math.floor(noise2(wx / 46, wz / 46, seed + 81) * 4) : 9; // how high the lava lake reaches here: 5 to 8 in v3, always 9 before
    for (let y = 0; y <= h; y++) {
      let id;
      if (y === 0) id = B.BEDROCK;
      else if (y === h) id = snowCap ? B.SNOW : rock ? B.STONE : k === 1 ? B.SAND : k === 2 ? B.SNOW : B.GRASS;
      else if (y >= h - 3 && !snowCap && !rock) id = k === 1 ? B.SAND : B.DIRT;
      else {
        id = B.STONE;
        const cr = hash3(wx >> 1, y >> 1, wz >> 1, seed + 7), keep = hash3(wx, y, wz, seed + 8) < 0.75;
        if (keep && cr < 0.0011 && y < 16) id = B.DIAMOND;
        else if (keep && cr < 0.0045 && y < 26) id = B.GOLD;
        else if (keep && cr < 0.0125 && y < 40) id = B.IRON;
        else if (keep && cr < 0.0285 && y < 56) id = B.COAL;
        else if (y < 52 && noise3(wx * 0.09, y * 0.09, wz * 0.09, seed + 60) > 0.87) id = B.GRAVEL;
        else if (y > 3 && y < 16 && noise3(wx * 0.08, y * 0.11, wz * 0.08, seed + 70) > (v3 ? 0.905 : 0.885) && !carved2(wx, y - 1, wz, seed, h, v3) && !carved2(wx, y + 1, wz, seed, h, v3)) id = B.LAVA; // small lava pockets deep in solid rock (never hanging over a cave)
      }
      if (carved2(wx, y, wz, seed, h, v3)) id = y <= lakeTop && y > 3 && cavern2(wx, y, wz, seed) && (!v3 || h >= lakeTop + 6) ? B.LAVA : 0; // (v3: never where the ground above is so low that the lake would show on the surface) // big deep caverns have a lava lake on the floor; tunnels stay open
      if (pool) { if (v3) { if (y >= h) id = 0; else if (y >= h - 2) id = B.LAVA; } else if (y >= h - 1) id = B.LAVA; } // occasional lava pool on flat ground (v3: a recessed pit, one block below the grass)
      else if (shore && y >= h - 1 && !snowCap) id = B.STONE; // v3: bare stone around a pool
      d[idx(x, y, z)] = id;
    }
    for (let y = h + 1; y <= SEA; y++) d[idx(x, y, z)] = B.WATER;
    // A cave that opens through the sea or river floor lets the water pour in as a waterfall down to the cave floor.
    if (h < SEA && carved2(wx, h, wz, seed, h, v3)) for (let y = h; y > 9 && carved2(wx, y, wz, seed, h, v3); y--) d[idx(x, y, z)] = WATER_FALL;
    // Caves that open sideways into water get flooded at their mouth.
    else if (h <= SEA + 6) for (let y = Math.max(4, h - 6); y <= Math.min(h, SEA); y++) if (d[idx(x, y, z)] === 0 && waterNear(x, y, z)) d[idx(x, y, z)] = B.WATER;
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
    if (k !== 0 || h <= SEA + 1 || h > 40 || slopeAt(lx, lz) >= 3 || poolAtC(lx, lz) || (v3 && poolShore(lx, lz))) continue;
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
function findSpawn2(seed) {
  const treeNear = (x, z) => {
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (hash3(x + dx, 0, z + dz, seed + 99) < 0.045) return true;
    return false;
  };
  for (let r = 0; r < 800; r += 4) {
    const n = Math.max(1, Math.round(r / 2));
    for (let a = 0; a < n; a++) {
      const x = Math.round(Math.cos((a / n) * 6.2832) * r), z = Math.round(Math.sin((a / n) * 6.2832) * r), { h, k } = column2(x, z, seed);
      if (k === 0 && h > SEA + 2 && h < 36 && !treeNear(x, z) && poolNoise(x, z, seed) < 0.7 && !carved2(x, h, z, seed, h) && !carved2(x, h - 1, z, seed, h)
        && Math.abs(column2(x + 1, z, seed).h - h) < 2 && Math.abs(column2(x, z + 1, seed).h - h) < 2) return { x: x + 0.5, y: h + 1.05, z: z + 0.5 };
    }
  }
  const { h } = column2(0, 0, seed);
  return { x: 0.5, y: Math.max(h, SEA) + 2, z: 0.5 };
}

// The public terrain functions. gen is the world's generation: 1 = the original terrain, 2 = mountains, rivers and lava.
export const column = (x, z, s, gen = 1) => (gen >= 2 ? column2(x, z, s) : column1(x, z, s));
export const carved = (x, y, z, s, h, gen = 1) => (gen >= 2 ? carved2(x, y, z, s, h, gen >= 3) : carved1(x, y, z, s, h));
export const genChunk = (cx, cz, seed, gen = 1) => (gen >= 2 ? genChunk2(cx, cz, seed, gen >= 3) : genChunk1(cx, cz, seed));
export const findSpawn = (seed, gen = 1) => (gen >= 2 ? findSpawn2(seed) : findSpawn1(seed));
export const NEW_GEN = 3; // new worlds use this; older worlds keep the generation they were made with
export const normGen = (g) => (g >= 3 ? 3 : g === 2 ? 2 : 1);
