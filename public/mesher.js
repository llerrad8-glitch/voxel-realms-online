// Chunk meshing, shared by the web workers (chunk-worker.js) and the page itself (the fallback when workers are not available).
// buildMeshData() turns one chunk and the eight around it into the vertex data of its meshes: sky light and torch light baked into vertex colours, smooth lighting and
// ambient occlusion, sun shadows, water surfaces and all the odd block shapes. It touches no WebGL and no page state, only the chunk arrays it is handed.
import { CS, CH, B, BLOCKS, isSolid, isWater, isLava, lavaAmount, LAVA_FALL, isTorch, isBed, isDoor, doorUpper, doorOpen, doorDir, DOOR_OPEN_SIDE, DOOR_T, DIR4, BED_H, blockHeight, waterAmount, WATER_FALL, flowDir, idx, isLayer, layerKind, layerN, isPlant, bedDir, bedIsHead, isLeaf, isCocoa } from './shared/world.js';
const LEAF = isLeaf; // leaves of any tree let light through
const TR = BLOCKS.map((b) => !!(b && b.tr));
let UV = [], FLOW_DIR = 1;
export function initMesher(uv, flowDir) { UV = uv; FLOW_DIR = flowDir; }
const LW = 44, LM = 14;
// The job: the chunk (CHK[4]) and its eight neighbours (null where one is not loaded), whether any of the nine holds a torch or lava, and the level of detail.
let CX = 0, CZ = 0, CHK = [], TN = false, LOD = 0;
const chunkAt = (qx, qz) => { const a = qx - CX, b = qz - CZ; return a < -1 || a > 1 || b < -1 || b > 1 ? undefined : CHK[(b + 1) * 3 + a + 1] || undefined; };
const HI = new WeakMap(); // chunk array -> the highest row that can hold a block
export function topOf(c) {
  let v = HI.get(c); if (v !== undefined) return v;
  let hi = c.length - 1; while (hi >= 0 && !c[hi]) hi--;
  v = hi < 0 ? -1 : Math.floor(hi / (CS * CS)); HI.set(c, v); return v;
}
// A chunk sent to the mesher is only as tall as it needs to be; this pads it to full height and remembers how tall it really was.
const PADS = [], PADLEN = [];
export function padChunk(a, slot = 0) { // (the nine padded arrays of a job are reused by the next job, so nothing is allocated per mesh)
  const f = PADS[slot] || (PADS[slot] = new Uint8Array(CS * CS * CH));
  f.set(a); if (PADLEN[slot] > a.length) f.fill(0, a.length, PADLEN[slot]); PADLEN[slot] = a.length;
  HI.set(f, Math.min(CH, a.length / (CS * CS)) - 1); topCache.delete(f); return f;
}
// Growable typed arrays with the push() of a plain array, so the mesh code below can stay as it was.
class FA {
  constructor(T) { this.T = T; this.a = new T(2048); this.length = 0; }
  push() { const n = arguments.length; if (this.length + n > this.a.length) { const b = new this.T(Math.max(this.a.length * 2, this.length + n)); b.set(this.a); this.a = b; } for (let i = 0; i < n; i++) this.a[this.length++] = arguments[i]; }
}
const mkB = () => ({ p: new FA(Float32Array), u: new FA(Float32Array), c: new FA(Float32Array), i: new FA(Uint32Array) });
function fin(b) {
  if (!b.i.length) return null;
  const n = b.p.length, p = b.p.a.slice(0, n), mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i += 3) for (let k = 0; k < 3; k++) { const v = p[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  const ix = b.i.a.slice(0, b.i.length);
  return { p, u: b.u.a.slice(0, b.u.length), c: b.c.a.slice(0, b.c.length), i: n / 3 < 65536 ? Uint16Array.from(ix) : ix, min: mn, max: mx };
}
export function buildMeshData(cx, cz, chunks, torchNear, lod) { CX = cx; CZ = cz; CHK = chunks; TN = !!torchNear; LOD = lod | 0; return buildMesh(cx, cz); }

function lightGrid(cx, cz) {
  if (!TN) return null;
  const x0 = cx * CS - LM, z0 = cz * CS - LM, LL = LW * LW, ids = new Uint8Array(LL * CH), light = new Uint8Array(LL * CH), q = [], lava = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const c = chunkAt(cx + a, cz + b); if (!c) continue;
    const bx = (cx + a) * CS - x0, bz = (cz + b) * CS - z0;
    for (let y = 0; y < CH; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const v = c[x + CS * (z + CS * y)]; if (!v) continue;
      const gx = bx + x, gz = bz + z; if (gx < 0 || gx >= LW || gz < 0 || gz >= LW) continue;
      const i = gx + LW * (gz + LW * y); ids[i] = v;
      if (v >= 31 && v <= 35) { light[i] = 14; q.push(i); } else if (v >= 45 && v <= 49) lava.push(i);
    }
  }
  const openId = (v) => !v || (TR[v] && !(v >= 45 && v <= 49));
  for (const i of lava) { // only lava that touches open space glows
    const x = i % LW, z = ((i / LW) | 0) % LW, y = (i / LL) | 0;
    if ((x > 0 && openId(ids[i - 1])) || (x < LW - 1 && openId(ids[i + 1])) || (z > 0 && openId(ids[i - LW])) || (z < LW - 1 && openId(ids[i + LW])) || (y < CH - 1 && openId(ids[i + LL])) || (y > 0 && openId(ids[i - LL]))) { light[i] = 13; q.push(i); }
  }
  let l = 0;
  const spread = (j) => { if (light[j] < l) { const v = ids[j]; if (!v || TR[v]) { light[j] = l; q.push(j); } } };
  for (let h = 0; h < q.length; h++) {
    const i = q[h]; l = light[i] - 1; if (l <= 0) continue;
    const x = i % LW, z = ((i / LW) | 0) % LW, y = (i / LL) | 0;
    if (x > 0) spread(i - 1); if (x < LW - 1) spread(i + 1); if (z > 0) spread(i - LW); if (z < LW - 1) spread(i + LW); if (y > 0) spread(i - LL); if (y < CH - 1) spread(i + LL);
  }
  return { at: (wx, y, wz) => { const gx = wx - x0, gz = wz - z0; return y < 0 || y >= CH || gx < 0 || gx >= LW || gz < 0 || gz >= LW ? 0 : light[gx + LW * (gz + LW * y)]; } };
}
// Faces: d = neighbour offset, s = brightness, k = which tile of the block (0 top, 1 bottom, 2 side), v = corners (counter-clockwise from outside)
const FACES = [
  { d: [1, 0, 0], s: 0.8, k: 2, v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { d: [-1, 0, 0], s: 0.8, k: 2, v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { d: [0, 1, 0], s: 1, k: 0, v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { d: [0, -1, 0], s: 0.5, k: 1, v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { d: [0, 0, 1], s: 0.7, k: 2, v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { d: [0, 0, -1], s: 0.7, k: 2, v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

const EPS = 0.0012, AOF = [0.62, 0.76, 0.88, 1], AOV = [0, 0, 0, 0], OFF = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
// Sky light: a flood fill from the open sky (15 straight down; one less per block sideways), so cave mouths glow and deep caves go properly dark.
const SKYM = 14, SKW = CS + 2 * SKYM, TRL = TR; // (TR is the see-through table, defined with the materials)
const skyFactor = (s) => (s >= 15 ? 1 : 0.004 + 0.996 * Math.pow(0.72, 15 - s)); // (colours are mixed in linear light, so these dip fast) // brightness for a sky light level: the dark end is nearly black
const blockFactor = (l) => (l <= 0 ? 0 : Math.min(1, Math.pow(l / 14, 1.8) * 1.12)); // brightness for a torch/lava light level
const opaqueId = (v) => v !== 0 && !TRL[v] && !LEAF(v);
const topCache = new WeakMap(); // chunk data -> the highest light-blocking block of each column (cleared when the chunk is edited)
function chunkTop(c) {
  let t = topCache.get(c);
  if (!t) { t = new Int16Array(CS * CS); for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) { let y = topOf(c); for (; y >= 0; y--) if (opaqueId(c[x + CS * (z + CS * y)])) break; t[x + CS * z] = y; } topCache.set(c, t); }
  return t;
}
function skyGrid(cx, cz) {
  const cs = [];
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) cs.push(chunkAt(cx + a, cz + b) || null);
  const gx0 = cx * CS - SKYM, gz0 = cz * CS - SKYM, LL = SKW * SKW;
  const idAt = (gx, y, gz) => { // grid coordinates -> block id (a chunk that is not loaded counts as solid rock)
    const wx = gx0 + gx, wz = gz0 + gz, qa = Math.floor(wx / CS) - cx + 1, qb = Math.floor(wz / CS) - cz + 1, c = cs[qb * 3 + qa];
    return c ? c[wx - (cx + qa - 1) * CS + CS * (wz - (cz + qb - 1) * CS + CS * y)] : B.BEDROCK;
  };
  const ht = new Int16Array(LL);
  for (let gz = 0; gz < SKW; gz++) for (let gx = 0; gx < SKW; gx++) {
    const wx = gx0 + gx, wz = gz0 + gz, qa = Math.floor(wx / CS) - cx + 1, qb = Math.floor(wz / CS) - cz + 1, c = cs[qb * 3 + qa];
    ht[gx + SKW * gz] = c ? chunkTop(c)[wx - (cx + qa - 1) * CS + CS * (wz - (cz + qb - 1) * CS)] : CH - 1;
  }
  let hmax = 0; for (let i = 0; i < LL; i++) if (ht[i] > hmax) hmax = ht[i];
  const light = new Uint8Array(LL * (hmax + 2)), q = [], DX = [1, -1, 0, 0, 0, 0], DZ = [0, 0, 1, -1, 0, 0], DY = [0, 0, 0, 0, 1, -1];
  for (let gz = 0; gz < SKW; gz++) for (let gx = 0; gx < SKW; gx++) { // seeds: covered air cells that sit beside open sky
    const h = ht[gx + SKW * gz];
    for (let d = 0; d < 4; d++) {
      const nx = gx + DX[d], nz = gz + DZ[d]; if (nx < 0 || nx >= SKW || nz < 0 || nz >= SKW) continue;
      for (let y = Math.max(0, ht[nx + SKW * nz] + 1); y <= h; y++) { const i = gx + SKW * gz + LL * y; if (light[i] < 14 && !opaqueId(idAt(gx, y, gz))) { light[i] = 14; q.push(i); } }
    }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], l = light[i] - 1; if (l <= 0) continue;
    const y = (i / LL) | 0, r = i - y * LL, gz = (r / SKW) | 0, gx = r - gz * SKW;
    for (let d = 0; d < 6; d++) {
      const nx = gx + DX[d], ny = y + DY[d], nz = gz + DZ[d];
      if (nx < 0 || nx >= SKW || nz < 0 || nz >= SKW || ny < 0 || ny >= CH || ny > ht[nx + SKW * nz]) continue; // (above a column's top it is open sky anyway)
      const j = nx + SKW * nz + LL * ny;
      if (light[j] >= l || opaqueId(idAt(nx, ny, nz))) continue;
      light[j] = l; q.push(j);
    }
  }
  return (wx, y, wz) => {
    if (y >= CH) return 15; if (y < 0) return 0;
    const gx = wx - gx0, gz = wz - gz0;
    if (gx < 0 || gx >= SKW || gz < 0 || gz >= SKW) return 15;
    return y > ht[gx + SKW * gz] ? 15 : light[gx + SKW * gz + LL * y];
  };
}
const waterTop = (id) => (id === WATER_FALL ? 1 : waterAmount(id) / 9); // height of a water block's surface: a source is 8/9, thin flow 1/9
function buildMesh(cx, cz) {
  const d = CHK[4], ox = cx * CS, oz = cz * CS, ymaxD = topOf(d);
  const nb = [chunkAt(cx + 1, cz), chunkAt(cx - 1, cz), chunkAt(cx, cz + 1), chunkAt(cx, cz - 1)];
  const top = new Int16Array(CS * CS); // highest block that shades the column (leaves, glass and water let light through)
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    let y = ymaxD;
    for (; y >= 0; y--) { const id = d[x + CS * (z + CS * y)]; if (id && !LEAF(id) && !TR[id]) break; }
    top[x + CS * z] = y;
  }
  const blk = (x, y, z) => { // block at chunk-local coordinates, reaching into neighbouring chunks (0 where one is not loaded)
    if (y < 0) return B.BEDROCK;
    if (y >= CH) return 0;
    if (x >= 0 && x < CS && z >= 0 && z < CS) return d[x + CS * (z + CS * y)];
    const gx = ox + x, gz = oz + z, qx = Math.floor(gx / CS), qz = Math.floor(gz / CS), c = chunkAt(qx, qz);
    return c ? c[gx - qx * CS + CS * (gz - qz * CS + CS * y)] : 0;
  };
  const occ = (x, y, z) => { const id = blk(x, y, z); return id && !TR[id] ? 1 : 0; };
  const lg = lightGrid(cx, cz), sky = skyGrid(cx, cz), blkL = (x, y, z) => (lg ? lg.at(ox + x, y, oz + z) : 0);
  // Sun shadows: a place that would otherwise be in full sunlight is dimmed when a block (or a tree's leaves) stands between it and the sun, which is taken to be
  // up and to one side, about ten blocks of reach. The shadows are baked into the chunk's lighting, so they blur softly across the corners of faces.
  const SUNV = [0.6, 0.78, 0.46], shM = new Map();
  const inShade = (x, y, z) => {
    const key = (y * 64 + z + 20) * 64 + x + 20; let v = shM.get(key);
    if (v === undefined) {
      v = 0;
      for (let i = 1; i <= 10 && !v; i++) { const sy = Math.floor(y + 0.5 + SUNV[1] * i); if (sy >= CH) break; const id = blk(Math.floor(x + 0.5 + SUNV[0] * i), sy, Math.floor(z + 0.5 + SUNV[2] * i)); if (id && !TR[id]) v = 1; }
      shM.set(key, v);
    }
    return v;
  };
  const skyL = (x, y, z) => { const s = sky(ox + x, y, oz + z); return s === 15 && inShade(x, y, z) ? 13 : s; };
  // A vertex colour carries two numbers for the shader: red = sky light (scaled by the daylight), green = torch/lava light (a warm glow that does not fade at night).
  const pushLight = (out, shade, S, L, ao = 1) => out.c.push(skyFactor(S) * shade * ao, blockFactor(L) * ao * (0.72 + 0.28 * shade), 0);
  const SM = [0, 0];
  // Smooth lighting: each corner of a face averages the light of the open cells around it, so light fades across a face instead of in whole-block steps.
  const smooth = (nx, ny, nz, t1, s1, t2, s2) => {
    const a = OFF[t1], b = OFF[t2], x1 = nx + a[0] * s1, y1 = ny + a[1] * s1, z1 = nz + a[2] * s1, x2 = nx + b[0] * s2, y2 = ny + b[1] * s2, z2 = nz + b[2] * s2, x3 = x1 + b[0] * s2, y3 = y1 + b[1] * s2, z3 = z1 + b[2] * s2;
    const o1 = occ(x1, y1, z1), o2 = occ(x2, y2, z2);
    let sv = skyL(nx, ny, nz), lv = blkL(nx, ny, nz), n = 1;
    if (!o1) { sv += skyL(x1, y1, z1); lv += blkL(x1, y1, z1); n++; }
    if (!o2) { sv += skyL(x2, y2, z2); lv += blkL(x2, y2, z2); n++; }
    if (!(o1 && o2) && !occ(x3, y3, z3)) { sv += skyL(x3, y3, z3); lv += blkL(x3, y3, z3); n++; }
    SM[0] = sv / n; SM[1] = lv / n;
  };
  const aoAt = (x, y, z, t1, s1, t2, s2) => {
    const a = OFF[t1], b = OFF[t2], o1 = occ(x + a[0] * s1, y + a[1] * s1, z + a[2] * s1), o2 = occ(x + b[0] * s2, y + b[1] * s2, z + b[2] * s2);
    if (o1 && o2) return 0;
    return 3 - o1 - o2 - occ(x + a[0] * s1 + b[0] * s2, y + a[1] * s1 + b[1] * s2, z + a[2] * s1 + b[2] * s2);
  };
  const O = mkB(), T = mkB(), Wm = mkB(), Fm = mkB(), La = mkB(), Pl = mkB();
  // Corner height of a water surface: blends the four blocks that touch the corner, so flowing water slopes smoothly like the real game.
  const cornerH = (x, y, z, qx, qz) => {
    let sum = 0, wt = 0;
    for (let i = 0; i < 4; i++) {
      const bx = x + qx - (i & 1), bz = z + qz - (i >> 1);
      if (isWater(blk(bx, y + 1, bz))) return 1;
      const b = blk(bx, y, bz);
      if (isWater(b)) { const h = waterTop(b); if (h >= 0.8) { sum += h * 10; wt += 10; } else { sum += h; wt += 1; } } else if (!isSolid(b)) wt += 1;
    }
    return wt ? sum / wt : 0;
  };
  // Water that is not moving is drawn with the calm animation, on every face. The flowing animation is only used on water that is actually
  // slanted (a flowing block whose surface runs downhill) and on waterfalls, and it is turned so the pattern runs the way the water flows.
  const STILL_UV = [[0.002, 0.002], [0.998, 0.002], [0.998, 0.998], [0.002, 0.998]], clampUV = (v) => Math.min(0.998, Math.max(0.002, v));
  const waterBlock = (x, y, z, id) => {
    const tp = top[x + CS * z], full = id === WATER_FALL || isWater(blk(x, y + 1, z));
    // Slanted = a flowing (not source) block whose four top corners are not level. Source blocks and level pools are always still.
    let slanted = false;
    if (id !== B.WATER && !full) {
      const hs = [cornerH(x, y, z, 0, 0), cornerH(x, y, z, 1, 0), cornerH(x, y, z, 0, 1), cornerH(x, y, z, 1, 1)];
      slanted = Math.max(...hs) - Math.min(...hs) > 0.02;
    }
    const dir = slanted ? flowDir(blk, x, y, z) : [0, 0];
    const moving = id === WATER_FALL || !!(dir[0] || dir[1]); // slanted AND actually running somewhere; level water is always still
    const flow = moving ? (id === WATER_FALL ? flowDir(blk, x, y, z) : dir) : [0, 0];
    for (let f = 0; f < 6; f++) {
      const F = FACES[f]; if (F.d[1] < 0) continue;
      const nid = blk(x + F.d[0], y + F.d[1], z + F.d[2]);
      if (isWater(nid) || (nid && !TR[nid])) continue; // water against water or a solid block: nothing to see
      const isTop = F.d[1] > 0, out = (isTop ? (id !== WATER_FALL && (flow[0] || flow[1])) : id === WATER_FALL) ? Fm : Wm; // only waterfalls (sides) and slanted tops run; everything else is calm
      const base = out.p.length / 3, S = skyL(x, y, z), L = blkL(x, y, z);
      let vi = 0;
      for (const q of F.v) {
        const h = q[1] ? (full ? 1 : cornerH(x, y, z, q[0], q[2])) : 0;
        out.p.push(ox + x + q[0], y + h, oz + z + q[2]); pushLight(out, F.s, S, L);
        if (out === Wm) { // calm picture: the top fills the face, the sides are cut off at the water's height so it is never stretched
          if (isTop) out.u.push(STILL_UV[vi][0], STILL_UV[vi][1]);
          else out.u.push(clampUV((F.d[0] ? q[2] : q[0]) * 1), clampUV(q[1] ? h : 0));
        } else if (isTop) { // slanted surface: the pattern's "up" points against the flow so it appears to run along it
          const bx = -FLOW_DIR * flow[0], bz = -FLOW_DIR * flow[1], rx = q[0] - 0.5, rz = q[2] - 0.5;
          out.u.push(clampUV(0.5 + 0.5 * (bz * rx - bx * rz)), clampUV(0.5 + 0.5 * (bx * rx + bz * rz)));
        } else { // sides of moving water: the pattern runs downward, like a waterfall
          const yi = q[1] ? (1 - h) * 0.5 : 0.5;
          out.u.push(clampUV(0.02 + (F.d[0] ? q[2] : q[0]) * 0.46), clampUV(FLOW_DIR > 0 ? 1 - yi : yi));
        }
        vi++;
      }
      out.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  // Lava: opaque, glowing (no day/night shading), always the same animation. A source is 8/9 tall, flowing lava 2/9 per level.
  const lavaH = (id) => (id === LAVA_FALL ? 1 : lavaAmount(id) >= 4 ? 8 / 9 : lavaAmount(id) * 2 / 9);
  // Corner height of a lava surface: like water, it blends the blocks that touch the corner, so flowing lava slopes smoothly instead of stepping.
  const lavaCorner = (x, y, z, qx, qz) => {
    let sum = 0, wt = 0;
    for (let i = 0; i < 4; i++) {
      const bx = x + qx - (i & 1), bz = z + qz - (i >> 1);
      if (isLava(blk(bx, y + 1, bz))) return 1;
      const b = blk(bx, y, bz);
      if (isLava(b)) { const h = lavaH(b); if (h >= 0.8) { sum += h * 10; wt += 10; } else { sum += h; wt += 1; } } else if (!isSolid(b)) wt += 1;
    }
    return wt ? sum / wt : 0;
  };
  const lavaBlock = (x, y, z, id) => {
    const full = id === LAVA_FALL || isLava(blk(x, y + 1, z)), h = full ? 1 : lavaH(id);
    for (let f = 0; f < 6; f++) {
      const F = FACES[f], nid = blk(x + F.d[0], y + F.d[1], z + F.d[2]);
      if (nid && !TR[nid]) continue;
      if (isLava(nid) && (F.d[1] !== 0 || isLava(blk(x + F.d[0], y + 1, z + F.d[2])) || lavaH(nid) >= h - 0.001)) continue;
      const isTop = F.d[1] > 0, base = La.p.length / 3; let vi = 0;
      for (const q of F.v) {
        const hh = q[1] ? (full ? 1 : lavaCorner(x, y, z, q[0], q[2])) : 0;
        La.p.push(ox + x + q[0], y + hh, oz + z + q[2]); La.c.push(1, 1, 1);
        if (isTop || F.d[1] < 0) La.u.push(STILL_UV[vi][0], STILL_UV[vi][1]); else La.u.push(clampUV(F.d[0] ? q[2] : q[0]), clampUV(hh));
        vi++;
      }
      La.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  // A torch is a 2 x 10 x 2 pixel stick (tilted away from the wall when it hangs on one); the flame end glows on its own.
  const TH = 0.625, HW = 0.0625, CT = Math.cos(0.3927), ST = Math.sin(0.3927);
  const torchBlock = (x, y, z, id) => {
    const ts = skyFactor(skyL(x, y, z)), uv = UV[27], uu = (f) => uv[0] + (uv[2] - uv[0]) * f, vv = (f) => uv[1] + (uv[3] - uv[1]) * f, wall = id > 31, n = wall ? DIR4[id - 32] : [0, 0];
    const at = (px, py, pz) => {
      if (!wall) return [ox + x + 0.5 + px, y + py, oz + z + 0.5 + pz];
      const s = px * n[0] + pz * n[1], t = -px * n[1] + pz * n[0], s2 = s * CT + py * ST, y2 = -s * ST + py * CT;
      return [ox + x + 0.5 - n[0] * 0.34 + s2 * n[0] - t * n[1], y + 0.2 + y2, oz + z + 0.5 - n[1] * 0.34 + s2 * n[1] + t * n[0]];
    };
    const quad = (F, y0, y1, v0, v1, col) => {
      const base = O.p.length / 3; let i = 0;
      for (const q of F.v) { O.p.push(...at((q[0] ? 1 : -1) * HW, q[1] ? y1 : y0, (q[2] ? 1 : -1) * HW)); O.c.push(ts, col > 2 ? 1 : 0.5, 0); O.u.push(i === 0 || i === 3 ? uu(7 / 16) : uu(9 / 16), i < 2 ? vv(v0) : vv(v1)); i++; }
      O.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const f of [0, 1, 4, 5]) { quad(FACES[f], 0, 0.5, 0, 0.5, 1.25); quad(FACES[f], 0.5, TH, 0.5, 0.625, 3); }
    quad(FACES[2], TH, TH, 0.5, 0.625, 3);
  };
  // A bed is 9/16 of a block tall. The blanket picture on top runs along the bed (pillow at the head end); the two halves join up without a seam.
  const bedBlock = (x, y, z, id) => {
    const head = bedIsHead(id), dir = bedDir(id), [dx, dz] = DIR4[dir], tp = top[x + CS * z], uvT = UV[BLOCKS[id].t[0]], uvS = UV[BLOCKS[id].t[2]];
    for (let f = 0; f < 6; f++) {
      const F = FACES[f]; if (F.d[1] < 0) continue;
      if (F.d[1] === 0 && ((!head && F.d[0] === dx && F.d[2] === dz) || (head && F.d[0] === -dx && F.d[2] === -dz))) continue; // between the two halves
      const nid = blk(x + F.d[0], y + F.d[1], z + F.d[2]);
      if (nid && !TR[nid]) continue;
      const S = skyL(x + F.d[0], y + F.d[1], z + F.d[2]), L = blkL(x + F.d[0], y + F.d[1], z + F.d[2]), base = O.p.length / 3;
      let i = 0;
      for (const q of F.v) {
        O.p.push(ox + x + q[0], y + q[1] * BED_H, oz + z + q[2]); pushLight(O, F.s, S, L);
        if (F.d[1] > 0) { const a = dir === 0 ? q[0] : dir === 1 ? 1 - q[0] : dir === 2 ? q[2] : 1 - q[2], c = dir < 2 ? q[2] : q[0]; O.u.push(uvT[0] + (uvT[2] - uvT[0]) * c, uvT[1] + (uvT[3] - uvT[1]) * a); }
        else O.u.push(i === 0 || i === 3 ? uvS[0] : uvS[2], uvS[1] + (uvS[3] - uvS[1]) * (q[1] ? 1 : 7 / 16));
        i++;
      }
      O.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  // A door is a thin upright panel (3/16 of a block thick) on one side of its cell, turned to the next side when open. Faces on the cell's edge hide behind opaque blocks.
  const doorBlock = (x, y, z, id) => {
    const side = doorOpen(id) ? DOOR_OPEN_SIDE[doorDir(id)] : doorDir(id), uv = UV[BLOCKS[id].t[2]], T = DOOR_T;
    const bx = side === 0 ? [1 - T, 1] : side === 1 ? [0, T] : [0, 1], bz = side === 2 ? [1 - T, 1] : side === 3 ? [0, T] : [0, 1];
    for (let f = 0; f < 6; f++) {
      const F = FACES[f], edge = F.d[0] > 0 ? bx[1] === 1 : F.d[0] < 0 ? bx[0] === 0 : F.d[2] > 0 ? bz[1] === 1 : F.d[2] < 0 ? bz[0] === 0 : true;
      const nx = x + F.d[0], ny = y + F.d[1], nz = z + F.d[2], nid = blk(nx, ny, nz);
      if (F.d[1] !== 0) { if (isDoor(nid)) continue; if (nid && !TR[nid]) continue; }
      else if (edge && nid && !TR[nid]) continue;
      const lx = edge || F.d[1] !== 0 ? nx : x, ly = edge || F.d[1] !== 0 ? ny : y, lz = edge || F.d[1] !== 0 ? nz : z;
      const S = skyL(lx, ly, lz), L = blkL(lx, ly, lz), base = O.p.length / 3; let i = 0;
      for (const q of F.v) {
        O.p.push(ox + x + bx[0] + q[0] * (bx[1] - bx[0]), y + q[1], oz + z + bz[0] + q[2] * (bz[1] - bz[0])); pushLight(O, F.s, S, L);
        if (F.d[1] !== 0) O.u.push(i === 0 || i === 3 ? uv[0] : uv[2], i < 2 ? uv[1] : uv[3]);
        else O.u.push(i === 0 || i === 3 ? uv[0] : uv[2], q[1] ? uv[3] : uv[1]);
        i++;
      }
      O.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  // A sand or snow layer is a slab 1 to 7 eighths tall. Its sides show the top of the picture, and a side is hidden by a full block or an equal or taller layer next to it.
  const layerBlock = (x, y, z, id) => {
    const hg = layerN(id) / 8, uv = UV[BLOCKS[id].t[0]];
    for (let f = 0; f < 6; f++) {
      const F = FACES[f], nx = x + F.d[0], ny = y + F.d[1], nz = z + F.d[2], nid = blk(nx, ny, nz);
      const top = F.d[1] > 0 && hg < 1; // a layer's top is inside its own cell: a leaf or log above it must not hide it (snow under trees was invisible)
      if (!top && nid && !TR[nid]) continue;
      if (F.d[1] === 0 && isLayer(nid) && layerN(nid) >= layerN(id)) continue;
      const S = top ? skyL(x, y, z) : skyL(nx, ny, nz), L = top ? blkL(x, y, z) : blkL(nx, ny, nz), base = O.p.length / 3; let i = 0;
      for (const q of F.v) {
        O.p.push(ox + x + q[0], y + q[1] * hg, oz + z + q[2]); pushLight(O, F.s, S, L);
        if (F.d[1] !== 0) O.u.push(i === 0 || i === 3 ? uv[0] : uv[2], i < 2 ? uv[1] : uv[3]);
        else O.u.push(i === 0 || i === 3 ? uv[0] : uv[2], uv[1] + (uv[3] - uv[1]) * (q[1] ? 1 : 1 - hg));
        i++;
      }
      O.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  // A cocoa pod is a small box on the side of a jungle log: id 204 + d points away from the log toward DIR4[d].
  const cocoaBlock = (x, y, z, id) => {
    const d = id - 204, uv = UV[131], S = skyL(x, y, z), L = blkL(x, y, z);
    const bx = d === 0 ? [0, 0.5] : d === 1 ? [0.5, 1] : [0.25, 0.75], bz = d === 2 ? [0, 0.5] : d === 3 ? [0.5, 1] : [0.25, 0.75], by = [0.25, 0.85];
    for (let f = 0; f < 6; f++) {
      const F = FACES[f], base = O.p.length / 3; let i = 0;
      for (const q of F.v) {
        O.p.push(ox + x + bx[0] + q[0] * (bx[1] - bx[0]), y + by[0] + q[1] * (by[1] - by[0]), oz + z + bz[0] + q[2] * (bz[1] - bz[0])); pushLight(O, F.s, S, L);
        if (F.d[1] !== 0) O.u.push(i === 0 || i === 3 ? uv[0] : uv[2], i < 2 ? uv[1] : uv[3]);
        else O.u.push(i === 0 || i === 3 ? uv[0] : uv[2], q[1] ? uv[3] : uv[1]);
        i++;
      }
      O.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  // A dead bush is two crossed upright pictures; the see-through pixels are cut out.
  const plantBlock = (x, y, z, id) => {
    const uv = UV[BLOCKS[id].t[0]], S = skyL(x, y, z), L = blkL(x, y, z);
    for (const [ax, az, bx, bz] of [[0.06, 0.06, 0.94, 0.94], [0.94, 0.06, 0.06, 0.94]]) {
      const base = Pl.p.length / 3;
      Pl.p.push(ox + x + ax, y, oz + z + az, ox + x + bx, y, oz + z + bz, ox + x + bx, y + 1, oz + z + bz, ox + x + ax, y + 1, oz + z + az);
      for (let k = 0; k < 4; k++) pushLight(Pl, 0.92, S, L);
      Pl.u.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
      Pl.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  const ymax = ymaxD; // (nothing above the highest block needs a look)
  for (let y = 0; y <= ymax; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const id = d[x + CS * (z + CS * y)];
    if (!id) continue;
    if (isWater(id)) { if (id === B.SEAWEED && !LOD) plantBlock(x, y, z, id); waterBlock(x, y, z, id); continue; } // (seaweed is a plant standing in a block of still water)
    if (id >= 55 && id <= 75) { layerBlock(x, y, z, id); continue; }
    if (isPlant(id)) { if (!LOD) plantBlock(x, y, z, id); continue; }
    if (isCocoa(id)) { if (!LOD) cocoaBlock(x, y, z, id); continue; }
    if (isLava(id)) { lavaBlock(x, y, z, id); continue; }
    if (id >= 31 && id <= 35) { torchBlock(x, y, z, id); continue; }
    if (isBed(id)) { bedBlock(x, y, z, id); continue; }
    if (id >= 77 && id <= 92) { doorBlock(x, y, z, id); continue; }
    const def = BLOCKS[id], out = def.tr ? T : O, tp = top[x + CS * z];
    for (let f = 0; f < 6; f++) {
      const F = FACES[f], nx = x + F.d[0], ny = y + F.d[1], nz = z + F.d[2];
      if (ny < 0) continue;
      let nid = 0;
      if (ny < CH) {
        if (nx < 0) nid = nb[1][CS - 1 + CS * (nz + CS * ny)];
        else if (nx >= CS) nid = nb[0][CS * (nz + CS * ny)];
        else if (nz < 0) nid = nb[3][nx + CS * (CS - 1 + CS * ny)];
        else if (nz >= CS) nid = nb[2][nx + CS * CS * ny];
        else nid = d[nx + CS * (nz + CS * ny)];
      }
      if (nid && !(TR[nid] && nid !== id)) continue;
      const lodS = LOD ? sky(ox + nx, ny, oz + nz) : 0, lodL = LOD ? blkL(nx, ny, nz) : 0;
      const uv = UV[def.t[F.k]], base = out.p.length / 3, ax = F.d[0] ? 0 : F.d[1] ? 1 : 2, t1 = (ax + 1) % 3, t2 = (ax + 2) % 3;
      let n = 0;
      for (const q of F.v) {
        // each face is grown by a hair along its own plane so neighbouring faces overlap slightly: no hairline gaps to see through at shallow angles
        out.p.push(ox + x + q[0] + (F.d[0] ? 0 : q[0] ? EPS : -EPS), y + q[1] + (F.d[1] ? 0 : q[1] ? EPS : -EPS), oz + z + q[2] + (F.d[2] ? 0 : q[2] ? EPS : -EPS));
        let a = 3;
        if (def.tr) { pushLight(out, F.s, skyL(nx, ny, nz), blkL(nx, ny, nz)); }
        else if (LOD) pushLight(out, F.s, lodS, lodL);
        else { a = aoAt(nx, ny, nz, t1, q[t1] ? 1 : -1, t2, q[t2] ? 1 : -1); smooth(nx, ny, nz, t1, q[t1] ? 1 : -1, t2, q[t2] ? 1 : -1); pushLight(out, F.s, SM[0], SM[1], AOF[a]); }
        AOV[n++] = a;
      }
      out.u.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
      if (AOV[0] + AOV[2] < AOV[1] + AOV[3]) out.i.push(base + 1, base + 2, base + 3, base + 1, base + 3, base); // split along the diagonal that avoids the darkest corner
      else out.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { o: fin(O), t: fin(T), w: fin(Wm), f: fin(Fm), l: fin(La), p: fin(Pl), lod: LOD };
}
