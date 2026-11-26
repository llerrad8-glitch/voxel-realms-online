// Ships: shared by the browser and the server.
// A ship is a small block grid of its own that floats, rocks and sails. Its blocks live in LOCAL coordinates: (lx, ly, lz) are whole numbers, the block
// stands on x in [lx - 0.5, lx + 0.5], y in [ly, ly + 1], z in [lz - 0.5, lz + 0.5], and the ship's origin (0, 0, 0) is its steering wheel.
// The bow points to local -z, like everything else in the game (yaw 0 faces -z). World position = ship position + the local position turned by the ship's yaw,
// plus a gentle rocking: the deck heaves and tilts a little, which is just a height that depends on where you stand (see dyAt).
import { B, isSolid, blockHeight, isCannon, cannonId, isFluid, isPlant, DIR4 } from './world.js';

// (SHIP_MAX, the most blocks a ship can have, is the size of a pirate ship: it is defined at the bottom of this file)
// Block keys are numbers, so lookups in a ship's block map never build strings.
export const bk = (x, y, z) => x + 512 + 1024 * (z + 512 + 1024 * (y + 64));
export const unbk = (k) => { const x = (k % 1024) - 512, r = (k - (x + 512)) / 1024, z = (r % 1024) - 512, y = (r - (z + 512)) / 1024 - 64; return [x, y, z]; };

// The rocking: a slow side-to-side roll, a slower nose-up-and-down pitch and a little bob. It only depends on the ship's id and the time (seconds),
// so the server (for the pirates walking about on a deck) and every browser agree on it without being told.
export function dyAt(id, t, lx, lz) {
  const ph = id * 1.7;
  return 0.05 * Math.sin(t * 1.1 + ph) + lx * 0.055 * Math.sin(t * 0.85 + ph) + lz * 0.03 * Math.sin(t * 0.62 + ph * 1.3);
}
export function toWorld(S, lx, ly, lz, t) {
  const c = Math.cos(S.yaw), s = Math.sin(S.yaw);
  return [S.x + lx * c + lz * s, S.y + ly + dyAt(S.id, t, lx, lz), S.z - lx * s + lz * c];
}
export function toLocal(S, x, y, z, t) {
  const c = Math.cos(S.yaw), s = Math.sin(S.yaw), dx = x - S.x, dz = z - S.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
  return [lx, y - S.y - dyAt(S.id, t, lx, lz), lz];
}
// A world direction turned into the ship's frame, and back.
export const dirToLocal = (yaw, dx, dz) => [dx * Math.cos(yaw) - dz * Math.sin(yaw), dx * Math.sin(yaw) + dz * Math.cos(yaw)];
export const dirToWorld = (yaw, lx, lz) => [lx * Math.cos(yaw) + lz * Math.sin(yaw), -lx * Math.sin(yaw) + lz * Math.cos(yaw)];

// The ship's bounds, worked out whenever its blocks change: { x0, x1, y0, y1, z0, z1, rad } (rad: how far from the origin any block reaches sideways).
export function bounds(S) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const k of S.blocks.keys()) { const [x, y, z] = unbk(k); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  if (x0 > x1) { x0 = x1 = y0 = y1 = z0 = z1 = 0; }
  let rad = 0; for (const [a, b] of [[x0, z0], [x0, z1], [x1, z0], [x1, z1]]) rad = Math.max(rad, Math.hypot(Math.abs(a) + 0.5, Math.abs(b) + 0.5));
  S.b = { x0, x1, y0, y1, z0, z1, rad }; return S.b;
}
export const STAND_EPS = 0.05; // feet this far under the top of a block still count as on top of it, so the rocking deck never half-buries you
const PTS = (hw) => [[0, 0], [-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw], [0, -hw], [0, hw], [-hw, 0], [hw, 0]];
// Does a body (feet at x, y, z; width w, height h) overlap a solid block of the ship? A bed or a layer only counts when the feet are below its top, like in the world.
export function shipBoxHit(S, x, y, z, w, h, t) {
  const b = S.b || bounds(S);
  if ((x - S.x) ** 2 + (z - S.z) ** 2 > (b.rad + w + 1) ** 2) return false;
  const [, cly] = toLocal(S, x, y, z, t), c = Math.cos(S.yaw), s = Math.sin(S.yaw), hw = w / 2 - 1e-4;
  const y0 = Math.floor(cly + STAND_EPS), y1 = Math.floor(cly + h - 1e-4);
  if (y1 < b.y0 || y0 > b.y1) return false;
  for (const [px, pz] of PTS(hw)) {
    const dx = x + px - S.x, dz = z + pz - S.z, cx = Math.round(dx * c - dz * s), cz = Math.round(dx * s + dz * c);
    if (cx < b.x0 || cx > b.x1 || cz < b.z0 || cz > b.z1) continue;
    for (let cy = y0; cy <= y1; cy++) { const id = S.blocks.get(bk(cx, cy, cz)); if (id && isSolid(id) && (blockHeight(id) >= 1 || cly < cy + blockHeight(id) - STAND_EPS)) return true; }
  }
  return false;
}
// Does the straight path from a to b (world points) pass through a solid block of the ship? Checked in hops of about 4 hundredths of a block, at the ship's place at time t,
// so a fast bullet can never skip over a corner of the hull. Returns the hit block key or null.
export function shipSweep(S, ax, ay, az, bx, by, bz, t) {
  const b = S.b || bounds(S), r = b.rad + 1;
  // (cheap rejection: the segment is nowhere near the ship)
  const mx = (ax + bx) / 2, mz = (az + bz) / 2, half = Math.hypot(bx - ax, bz - az) / 2;
  if (Math.hypot(mx - S.x, mz - S.z) > r + half) return null;
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) / 0.04));
  for (let i = 0; i <= n; i++) {
    const f = i / n, x = ax + (bx - ax) * f, y = ay + (by - ay) * f, z = az + (bz - az) * f;
    if ((x - S.x) ** 2 + (z - S.z) ** 2 > r * r) continue;
    const [lx, ly, lz] = toLocal(S, x, y, z, t), k = bk(Math.round(lx), Math.floor(ly), Math.round(lz)), id = S.blocks.get(k);
    if (id && isSolid(id)) return k;
  }
  return null;
}
// Where a body falling onto the ship comes to rest (world height), or null when there is nothing of the ship under its feet.
export function shipLandY(S, x, y, z, w, t) {
  const [, cly, ] = toLocal(S, x, y, z, t), c = Math.cos(S.yaw), s = Math.sin(S.yaw), hw = w / 2 - 1e-4, cy = Math.floor(cly + STAND_EPS);
  let top = null;
  for (const [px, pz] of PTS(hw)) {
    const dx = x + px - S.x, dz = z + pz - S.z, cx = Math.round(dx * c - dz * s), cz = Math.round(dx * s + dz * c), id = S.blocks.get(bk(cx, cy, cz));
    if (id && isSolid(id)) top = Math.max(top === null ? -1e9 : top, cy + blockHeight(id));
  }
  if (top === null) return null;
  const [lx, , lz] = toLocal(S, x, y, z, t);
  return S.y + top + dyAt(S.id, t, lx, lz);
}
// A ray (world origin o, direction d) against the ship's blocks: the first block it enters, with the face it came through (in ship terms). Same walk as the world's.
export function shipRay(S, o, d, max, t) {
  const b = S.b || bounds(S), [lx, ly, lz] = toLocal(S, o[0], o[1], o[2], t), c = Math.cos(S.yaw), s = Math.sin(S.yaw);
  const dx = d[0] * c - d[2] * s, dy = d[1], dz = d[0] * s + d[2] * c;
  const ox = lx + 0.5, oz = lz + 0.5; // (shifted so that a block spans [i, i + 1) in x and z)
  if (Math.hypot(lx, lz) > b.rad + max + 2) return null;
  let x = Math.floor(ox), y = Math.floor(ly), z = Math.floor(oz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
  let tmx = dx > 0 ? (x + 1 - ox) * tdx : dx < 0 ? (ox - x) * tdx : Infinity, tmy = dy > 0 ? (y + 1 - ly) * tdy : dy < 0 ? (ly - y) * tdy : Infinity, tmz = dz > 0 ? (z + 1 - oz) * tdz : dz < 0 ? (oz - z) * tdz : Infinity;
  let tt = 0, n = [0, 0, 0];
  while (tt <= max) {
    if (x >= b.x0 - 1 && x <= b.x1 + 1 && z >= b.z0 - 1 && z <= b.z1 + 1) { const id = S.blocks.get(bk(x, y, z)); if (id) return { x, y, z, id, n, t: tt, ship: S.id }; }
    else if ((sx > 0 && x > b.x1 + 1) || (sx < 0 && x < b.x0 - 1) || (sz > 0 && z > b.z1 + 1) || (sz < 0 && z < b.z0 - 1)) return null;
    if (tmx < tmy && tmx < tmz) { x += sx; tt = tmx; tmx += tdx; n = [-sx, 0, 0]; }
    else if (tmy < tmz) { y += sy; tt = tmy; tmy += tdy; n = [0, -sy, 0]; }
    else { z += sz; tt = tmz; tmz += tdz; n = [0, 0, -sz]; }
  }
  return null;
}

/* ---------- turning a build into a ship ---------- */
// Everything a player built that touches the wheel (side to side, up and down), found from the world's edits. Stops as soon as there are too many.
// get(x, y, z) gives the id of a PLAYER-PLACED block there, or 0 for anything else (air, water, natural ground). Returns { ok, cells } or { ok: false, why }.
export function collectBuild(get, wx, wy, wz, limit = SHIP_MAX) {
  const seen = new Set([`${wx},${wy},${wz}`]), q = [[wx, wy, wz]], cells = [];
  while (q.length) {
    const [x, y, z] = q.pop(); cells.push([x, y, z]);
    if (cells.length > limit) return { ok: false, why: 'big' };
    for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = x + a, ny = y + b, nz = z + c, k = `${nx},${ny},${nz}`;
      if (seen.has(k)) continue; seen.add(k);
      const id = get(nx, ny, nz);
      if (id > 0 && !isFluid(id) && !isPlant(id)) q.push([nx, ny, nz]);
    }
  }
  return { ok: true, cells };
}

/* ---------- the pirate ship ---------- */
// Built only from wood (planks and logs), floating on the sea. Returns { blocks: Map, cannons: [[lx, ly, lz]], walk: Set of deck cells ("lx,lz"), deckY }.
// The wheel (B.STEERING_WHEEL) is the origin, at the back of the ship; the bow is toward -z.
export function pirateShipBlocks() {
  const blocks = new Map(), put = (x, y, z, id) => blocks.set(bk(x, y, z), id);
  const OAK = B.PLANKS, SPR = B.SPRUCE_PLANKS, BIR = B.BIRCH_PLANKS, LOG = B.LOG, SLOG = B.SPRUCE_LOG;
  const half = (z) => (z <= -14 ? 0 : z === -13 ? 1 : z === -12 ? 1 : z === -11 ? 2 : z >= 1 ? 1 : 2); // how far the hull reaches to each side at row z (the bow narrows to a point)
  const CZ = [-4, -7, -10]; // rows that carry a cannon on each side
  const cannons = [];
  for (let z = -14; z <= 1; z++) {
    const h = half(z);
    for (let x = -h; x <= h; x++) {
      const edge = Math.abs(x) === h;
      if (Math.abs(x) <= Math.max(0, h - 1)) put(x, -3, z, SPR); // the bottom
      put(x, -2, z, OAK); // hull sides and floor
      put(x, -1, z, edge ? OAK : SPR); // the deck floor (the sides come up to meet it)
      if (edge && !CZ.includes(z)) put(x, 0, z, OAK); // the rail (it has gaps where the cannons are)
    }
  }
  for (const z of CZ) for (const sgn of [-1, 1]) { const x = sgn * (half(z) - 1); put(x, 0, z, cannonId(sgn, 0)); cannons.push([x, 0, z]); }
  put(0, 0, 0, B.STEERING_WHEEL);
  for (let x = -1; x <= 1; x++) put(x, 0, 1, OAK); // the stern rail
  for (const [mz, top] of [[-3, 9], [-8, 8]]) { // two masts, each with a yard and a square sail made of planks
    for (let y = 0; y <= top; y++) put(0, y, mz, SLOG);
    for (let x = -2; x <= 2; x++) { put(x, top - 1, mz + 1, LOG); for (let y = 3; y <= top - 2; y++) put(x, y, mz + 1, BIR); }
  }
  put(0, 0, -15, LOG); put(0, 1, -16, LOG); // the bowsprit
  const walk = new Set();
  for (const k of blocks.keys()) {
    const [x, y, z] = unbk(k);
    if (y === -1 && isSolid(blocks.get(k)) && !blocks.has(bk(x, 0, z)) && !blocks.has(bk(x, 1, z))) walk.add(`${x},${z}`);
  }
  return { blocks, cannons, walk, deckY: 0, minY: -3 };
}
export const SHIP_MAX = pirateShipBlocks().blocks.size; // a ship somebody built can be as big as a pirate ship
