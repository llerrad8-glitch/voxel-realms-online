// Shared by the browser and the Node server: block table + deterministic terrain from a seed.
// The server never sends terrain, only edits; both sides regenerate the same world from the seed.
export const CS = 16, CH = 64, SEA = 20;
export const B = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WATER: 5, LOG: 6, LEAVES: 7, SNOW: 8, PLANKS: 9, GLASS: 10, BRICKS: 11, BEDROCK: 12, COAL: 13, IRON: 14, GOLD: 15 };

// t = atlas tiles [top, bottom, side]; tr = see-through
export const BLOCKS = [
  null,
  { n: 'Grass', t: [0, 2, 1] }, { n: 'Dirt', t: [2, 2, 2] }, { n: 'Stone', t: [3, 3, 3] }, { n: 'Sand', t: [4, 4, 4] },
  { n: 'Water', t: [5, 5, 5], tr: 1 }, { n: 'Log', t: [7, 7, 6] }, { n: 'Leaves', t: [8, 8, 8] }, { n: 'Snow', t: [9, 9, 9] },
  { n: 'Planks', t: [10, 10, 10] }, { n: 'Glass', t: [11, 11, 11], tr: 1 }, { n: 'Bricks', t: [12, 12, 12] },
  { n: 'Bedrock', t: [13, 13, 13] }, { n: 'Coal Ore', t: [14, 14, 14] }, { n: 'Iron Ore', t: [15, 15, 15] }, { n: 'Gold Ore', t: [16, 16, 16] },
];
export const HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.PLANKS, B.LOG, B.BRICKS, B.GLASS, B.SAND, B.LEAVES];
export const PLACEABLE = new Set([B.GRASS, B.DIRT, B.STONE, B.SAND, B.LOG, B.LEAVES, B.SNOW, B.PLANKS, B.GLASS, B.BRICKS, B.COAL, B.IRON, B.GOLD]);
export const isSolid = (id) => id !== 0 && id !== B.WATER;
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
export function column(x, z, s) {
  const c = fbm2(x / 200, z / 200, s, 3), hl = fbm2(x / 55, z / 55, s + 1, 4), m = Math.max(0, fbm2(x / 150, z / 150, s + 2, 3) - 0.55);
  let h = SEA + (c - 0.43) * 56 + (hl - 0.5) * 14 + m * 90;
  h = Math.max(2, Math.min(CH - 6, Math.floor(h)));
  const t = fbm2(x / 320, z / 320, s + 3, 2), w = fbm2(x / 260, z / 260, s + 4, 2);
  let k = 0;
  if (h <= SEA + 1 || (t > 0.6 && w < 0.5)) k = 1;
  else if (h > 44 || t < 0.34) k = 2;
  return { h, k, w };
}

function carved(x, y, z, s) {
  const a = noise3(x * 0.045, y * 0.07, z * 0.045, s + 50);
  if (Math.abs(a - 0.5) < 0.07) {
    const b = noise3(x * 0.045 + 100, y * 0.07, z * 0.045 + 100, s + 51);
    if (Math.abs(b - 0.5) < 0.07) return true;
  }
  return y < 22 && noise3(x * 0.03, y * 0.05, z * 0.03, s + 52) > 0.78;
}

// One 16 x 64 x 16 chunk as a Uint8Array of block ids, indexed by idx(x, y, z).
export function genChunk(cx, cz, seed) {
  const d = new Uint8Array(CS * CS * CH), ox = cx * CS, oz = cz * CS;
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const wx = ox + x, wz = oz + z, { h, k } = column(wx, wz, seed);
    for (let y = 0; y <= h; y++) {
      let id;
      if (y === 0) id = B.BEDROCK;
      else if (y === h) id = k === 1 ? B.SAND : k === 2 ? B.SNOW : B.GRASS;
      else if (y >= h - 3) id = k === 1 ? B.SAND : B.DIRT;
      else {
        id = B.STONE;
        const r = hash3(wx, y, wz, seed + 7);
        if (r < 0.010 && y < 50) id = B.COAL; else if (r < 0.016 && y < 36) id = B.IRON; else if (r < 0.0185 && y < 20) id = B.GOLD;
        if (y > 3 && carved(wx, y, wz, seed)) id = 0;
      }
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
    const { h, k, w } = column(tx, tz, seed);
    if (k !== 0 || h <= SEA + 1 || h > 40) continue;
    if (w < 0.55 && hash3(tx, 1, tz, seed + 98) > 0.3) continue;
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
export function findSpawn(seed) {
  const treeNear = (x, z) => {
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (hash3(x + dx, 0, z + dz, seed + 99) < 0.045) return true;
    return false;
  };
  for (let r = 0; r < 600; r += 4) {
    const n = Math.max(1, Math.round(r / 2));
    for (let a = 0; a < n; a++) {
      const x = Math.round(Math.cos((a / n) * 6.2832) * r), z = Math.round(Math.sin((a / n) * 6.2832) * r), { h, k } = column(x, z, seed);
      if (k === 0 && h > SEA + 2 && h < 38 && !treeNear(x, z)) return { x: x + 0.5, y: h + 1.05, z: z + 0.5 };
    }
  }
  const { h } = column(0, 0, seed);
  return { x: 0.5, y: Math.max(h, SEA) + 2, z: 0.5 };
}
