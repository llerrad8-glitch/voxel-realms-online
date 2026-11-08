import * as THREE from 'three';
import { CS, CH, B, BLOCKS, isSolid, isWater, isTorch, isBed, torchFor, DIR4, BED_H, blockHeight, waterAmount, WATER_FALL, flowDir, idx, genChunk } from './shared/world.js';
import { itemInfo, breakTime, I } from './shared/items.js';
import { MOB_TYPES, mobDims } from './shared/mobs.js';
import { UV, PACK, atlas, waterStrip, WATER_FRAMES, flowStrip, FLOW_FRAMES, FLOW_DIR } from './icons.js';
import { atlasTex, makeMob, makePlayer, setEquipment, itemMesh, arrowMesh, HeldView } from './models.js';
import { Particles, Cracks } from './fx.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('vr.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('vr.' + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const cfg = { dist: 5, fov: 75, sens: 1, ...store.get('cfg', {}) };
const MENU_SEED = 7, W = 0.3, H = 1.8, EYE = 1.62;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const keys = new Set(), others = new Map(), mobs = new Map(), drops = new Map(), arrows = new Map(), ghosts = [];
let state = 'menu', locked = false, chatOpen = false, leaving = false, joined = false, serverReady = false, dead = false, mode = 'survival';
let mouseL = false, mouseR = false;
let net = null, ws = null, session = null, roomInfo = null, retry = 0, myId = 0;
let tOff = 0, epoch = 0, dayMs = 720000;
let sleeping = null, sleepT = 0, guardSent = false; // in bed (and for how long); whether the server thinks your shield is up
const WAKE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'];
const P = { x: 0, y: 40, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, ground: false, fly: false, sprint: false };
const stats = { hp: 20, food: 20, air: 15, def: 0 };

/* ---------- renderer ---------- */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(cfg.fov, 1, 0.1, 600);
camera.rotation.order = 'YXZ';
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 30, 90);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const matO = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true });
const matT = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false });
// Water scrolls through a strip of animation frames (the real water texture when a pack is installed).
const waterTex = new THREE.CanvasTexture(waterStrip);
waterTex.magFilter = waterTex.minFilter = THREE.NearestFilter; waterTex.generateMipmaps = false; waterTex.colorSpace = THREE.SRGBColorSpace; waterTex.repeat.set(1, 1 / WATER_FRAMES);
const matW = new THREE.MeshBasicMaterial({ map: waterTex, vertexColors: true, transparent: true, opacity: 0.74, depthWrite: false, side: THREE.DoubleSide });
// Flowing water (slopes and waterfalls) uses the separate, larger flowing-water animation; still water keeps the calm one.
const flowTex = new THREE.CanvasTexture(flowStrip);
flowTex.magFilter = flowTex.minFilter = THREE.NearestFilter; flowTex.generateMipmaps = false; flowTex.colorSpace = THREE.SRGBColorSpace; flowTex.repeat.set(1, 1 / FLOW_FRAMES);
const matF = new THREE.MeshBasicMaterial({ map: flowTex, vertexColors: true, transparent: true, opacity: 0.74, depthWrite: false, side: THREE.DoubleSide });
try { // menus get the dirt texture, like the real game
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(atlas, 32, 0, 16, 16, 0, 0, 64, 64);
  document.documentElement.style.setProperty('--dirt', `url(${c.toDataURL()})`);
} catch { /* canvas blocked: plain panels */ }
const fx = new Particles(scene), cracks = new Cracks(scene), held = new HeldView(camera, scene);
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const ui = createUI({ send });
const audio = createAudio(); // sunset music + creature sounds (audio.js)

/* ---------- world storage + chunk meshing ---------- */
let worldSeed = MENU_SEED, wantKey = '', want = [];
const chunks = new Map(), meshes = new Map(), editsByChunk = new Map(), dirty = new Set();
const ck = (cx, cz) => cx + ',' + cz;
const TR = BLOCKS.map((b) => !!(b && b.tr));
// Torch light. Each chunk that has a torch within reach gets a small light map: a flood fill from every torch (14 at the torch, one less per block,
// stopped by solid blocks), so a torch lights its room and not the room next door. Chunks with no torch nearby skip all of this.
const torchChunks = new Map(), LW = 44, LM = 14;
const countTorches = (d) => { let n = 0; for (let i = 0; i < d.length; i++) { const v = d[i]; if (v >= 31 && v <= 35) n++; } return n; };
const torchNear = (cx, cz) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (torchChunks.get(ck(cx + a, cz + b))) return true; return false; };
function lightGrid(cx, cz) {
  if (!torchNear(cx, cz)) return null;
  const x0 = cx * CS - LM, z0 = cz * CS - LM, LL = LW * LW, ids = new Uint8Array(LL * CH), light = new Uint8Array(LL * CH), q = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const c = chunks.get(ck(cx + a, cz + b)); if (!c) continue;
    const bx = (cx + a) * CS - x0, bz = (cz + b) * CS - z0;
    for (let y = 0; y < CH; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const v = c[x + CS * (z + CS * y)]; if (!v) continue;
      const gx = bx + x, gz = bz + z; if (gx < 0 || gx >= LW || gz < 0 || gz >= LW) continue;
      const i = gx + LW * (gz + LW * y); ids[i] = v;
      if (v >= 31 && v <= 35) { light[i] = 14; q.push(i); }
    }
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

function getBlock(x, y, z) {
  if (y < 0) return B.BEDROCK;
  if (y >= CH) return 0;
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS), c = chunks.get(ck(cx, cz));
  return c ? c[idx(x - cx * CS, y, z - cz * CS)] : B.BEDROCK; // unloaded counts as solid, so nobody falls out of the world
}
function setBlock(x, y, z, id) {
  if (y < 0 || y >= CH) return;
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS), k = ck(cx, cz), lx = x - cx * CS, lz = z - cz * CS, i = idx(lx, y, lz);
  let e = editsByChunk.get(k); if (!e) editsByChunk.set(k, (e = new Map()));
  e.set(i, id); // remembered so the edit survives the chunk being unloaded and regenerated
  const c = chunks.get(k); if (!c) return;
  const old = c[i]; c[i] = id; dirty.add(k);
  const t0 = old >= 31 && old <= 35, t1 = id >= 31 && id <= 35;
  if (t0 || t1) torchChunks.set(k, (torchChunks.get(k) || 0) + (t1 ? 1 : 0) - (t0 ? 1 : 0));
  if (t0 || t1 || torchNear(cx, cz)) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (chunks.has(ck(cx + a, cz + b))) dirty.add(ck(cx + a, cz + b)); // light reaches 14 blocks
  if (lx === 0) dirty.add(ck(cx - 1, cz)); if (lx === CS - 1) dirty.add(ck(cx + 1, cz));
  if (lz === 0) dirty.add(ck(cx, cz - 1)); if (lz === CS - 1) dirty.add(ck(cx, cz + 1));
}
function dropMesh(k) {
  const m = meshes.get(k); if (!m) return;
  for (const o of [m.o, m.t, m.w, m.f]) if (o) { scene.remove(o); o.geometry.dispose(); }
  meshes.delete(k);
}
function disposeModel(g) { scene.remove(g); g.traverse((n) => { if (n.geometry) n.geometry.dispose(); }); }
function clearEntities() {
  for (const o of mobs.values()) disposeModel(o.model.g);
  for (const o of drops.values()) scene.remove(o.mesh);
  for (const o of arrows.values()) disposeModel(o.mesh);
  for (const o of ghosts) disposeModel(o.model.g);
  mobs.clear(); drops.clear(); arrows.clear(); ghosts.length = 0;
}
function resetWorld(seed) {
  for (const k of [...meshes.keys()]) dropMesh(k);
  chunks.clear(); editsByChunk.clear(); dirty.clear(); wantKey = ''; worldSeed = seed;
  for (const id of [...others.keys()]) removeOther(id);
  clearEntities(); cracks.hide();
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

// Only exposed faces become geometry: three meshes per chunk (solid blocks, glass, and water). Faces deep under the surface get darker, so caves
// are properly dim without a lighting engine, and corners next to other blocks get a soft ambient-occlusion shade.
const AOF = [0.55, 0.72, 0.86, 1], AOV = [0, 0, 0, 0], OFF = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const waterTop = (id) => (id === WATER_FALL ? 1 : waterAmount(id) / 9); // height of a water block's surface: a source is 8/9, thin flow 1/9
function buildMesh(cx, cz) {
  const k = ck(cx, cz), d = chunks.get(k), ox = cx * CS, oz = cz * CS;
  const nb = [chunks.get(ck(cx + 1, cz)), chunks.get(ck(cx - 1, cz)), chunks.get(ck(cx, cz + 1)), chunks.get(ck(cx, cz - 1))];
  const top = new Int16Array(CS * CS); // highest block that shades the column (leaves, glass and water let light through)
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    let y = CH - 1;
    for (; y >= 0; y--) { const id = d[x + CS * (z + CS * y)]; if (id && id !== B.LEAVES && !TR[id]) break; }
    top[x + CS * z] = y;
  }
  const blk = (x, y, z) => { // block at chunk-local coordinates, reaching into neighbouring chunks (0 where one is not loaded)
    if (y < 0) return B.BEDROCK;
    if (y >= CH) return 0;
    if (x >= 0 && x < CS && z >= 0 && z < CS) return d[x + CS * (z + CS * y)];
    const gx = ox + x, gz = oz + z, qx = Math.floor(gx / CS), qz = Math.floor(gz / CS), c = chunks.get(ck(qx, qz));
    return c ? c[gx - qx * CS + CS * (gz - qz * CS + CS * y)] : 0;
  };
  const occ = (x, y, z) => { const id = blk(x, y, z); return id && !TR[id] ? 1 : 0; };
  const lg = lightGrid(cx, cz), glow = (x, y, z) => (lg ? lg.at(ox + x, y, oz + z) : 0);
  // Face colour: the usual shade, or a warm torch glow if that is brighter. The glow is boosted because the whole world is dimmed at night.
  const pushCol = (out, s, L, ao = 1) => { if (!L) { out.c.push(s, s, s); return; } const b = Math.pow(L / 14, 1.5) * 3 * ao; out.c.push(Math.max(s, b), Math.max(s, b * 0.85), Math.max(s, b * 0.6)); };
  const aoAt = (x, y, z, t1, s1, t2, s2) => {
    const a = OFF[t1], b = OFF[t2], o1 = occ(x + a[0] * s1, y + a[1] * s1, z + a[2] * s1), o2 = occ(x + b[0] * s2, y + b[1] * s2, z + b[2] * s2);
    if (o1 && o2) return 0;
    return 3 - o1 - o2 - occ(x + a[0] * s1 + b[0] * s2, y + a[1] * s1 + b[1] * s2, z + a[2] * s1 + b[2] * s2);
  };
  const O = { p: [], u: [], c: [], i: [] }, T = { p: [], u: [], c: [], i: [] }, Wm = { p: [], u: [], c: [], i: [] }, Fm = { p: [], u: [], c: [], i: [] };
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
    const moving = id === WATER_FALL || slanted;
    const flow = moving ? flowDir(blk, x, y, z) : [0, 0];
    for (let f = 0; f < 6; f++) {
      const F = FACES[f]; if (F.d[1] < 0) continue;
      const nid = blk(x + F.d[0], y + F.d[1], z + F.d[2]);
      if (isWater(nid) || (nid && !TR[nid])) continue; // water against water or a solid block: nothing to see
      const isTop = F.d[1] > 0, out = moving && (isTop ? flow[0] || flow[1] : true) ? Fm : Wm;
      const depth = tp - y - (isTop ? 1 : 0), lit = F.s * (depth <= 1 ? 1 : 0.36 + 0.64 * Math.max(0, 1 - (depth - 1) / 14)), base = out.p.length / 3;
      let vi = 0;
      for (const q of F.v) {
        const h = q[1] ? (full ? 1 : cornerH(x, y, z, q[0], q[2])) : 0;
        out.p.push(ox + x + q[0], y + h, oz + z + q[2]); pushCol(out, lit, glow(x, y, z));
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
  // A torch is a 2 x 10 x 2 pixel stick (tilted away from the wall when it hangs on one); the flame end glows on its own.
  const TH = 0.625, HW = 0.0625, CT = Math.cos(0.3927), ST = Math.sin(0.3927);
  const torchBlock = (x, y, z, id) => {
    const uv = UV[27], uu = (f) => uv[0] + (uv[2] - uv[0]) * f, vv = (f) => uv[1] + (uv[3] - uv[1]) * f, wall = id > 31, n = wall ? DIR4[id - 32] : [0, 0];
    const at = (px, py, pz) => {
      if (!wall) return [ox + x + 0.5 + px, y + py, oz + z + 0.5 + pz];
      const s = px * n[0] + pz * n[1], t = -px * n[1] + pz * n[0], s2 = s * CT + py * ST, y2 = -s * ST + py * CT;
      return [ox + x + 0.5 - n[0] * 0.34 + s2 * n[0] - t * n[1], y + 0.2 + y2, oz + z + 0.5 - n[1] * 0.34 + s2 * n[1] + t * n[0]];
    };
    const quad = (F, y0, y1, v0, v1, col) => {
      const base = O.p.length / 3; let i = 0;
      for (const q of F.v) { O.p.push(...at((q[0] ? 1 : -1) * HW, q[1] ? y1 : y0, (q[2] ? 1 : -1) * HW)); O.c.push(col, col, col); O.u.push(i === 0 || i === 3 ? uu(7 / 16) : uu(9 / 16), i < 2 ? vv(v0) : vv(v1)); i++; }
      O.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const f of [0, 1, 4, 5]) { quad(FACES[f], 0, 0.5, 0, 0.5, 1.25); quad(FACES[f], 0.5, TH, 0.5, 0.625, 3); }
    quad(FACES[2], TH, TH, 0.5, 0.625, 3);
  };
  // A bed is 9/16 of a block tall. The blanket picture on top runs along the bed (pillow at the head end); the two halves join up without a seam.
  const bedBlock = (x, y, z, id) => {
    const head = id >= 40, dir = (id - 36) & 3, [dx, dz] = DIR4[dir], tp = top[x + CS * z], uvT = UV[head ? 29 : 28], uvS = UV[30];
    for (let f = 0; f < 6; f++) {
      const F = FACES[f]; if (F.d[1] < 0) continue;
      if (F.d[1] === 0 && ((!head && F.d[0] === dx && F.d[2] === dz) || (head && F.d[0] === -dx && F.d[2] === -dz))) continue; // between the two halves
      const nid = blk(x + F.d[0], y + F.d[1], z + F.d[2]);
      if (nid && !TR[nid]) continue;
      const depth = tp - y - (F.d[1] > 0 ? 1 : 0), lit = F.s * (depth <= 1 ? 1 : 0.36 + 0.64 * Math.max(0, 1 - (depth - 1) / 14)), L = glow(x + F.d[0], y + F.d[1], z + F.d[2]), base = O.p.length / 3;
      let i = 0;
      for (const q of F.v) {
        O.p.push(ox + x + q[0], y + q[1] * BED_H, oz + z + q[2]); pushCol(O, lit, L);
        if (F.d[1] > 0) { const a = dir === 0 ? q[0] : dir === 1 ? 1 - q[0] : dir === 2 ? q[2] : 1 - q[2], c = dir < 2 ? q[2] : q[0]; O.u.push(uvT[0] + (uvT[2] - uvT[0]) * c, uvT[1] + (uvT[3] - uvT[1]) * a); }
        else O.u.push(i === 0 || i === 3 ? uvS[0] : uvS[2], uvS[1] + (uvS[3] - uvS[1]) * (q[1] ? 1 : 7 / 16));
        i++;
      }
      O.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  for (let y = 0; y < CH; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const id = d[x + CS * (z + CS * y)];
    if (!id) continue;
    if (isWater(id)) { waterBlock(x, y, z, id); continue; }
    if (id >= 31 && id <= 35) { torchBlock(x, y, z, id); continue; }
    if (id >= 36 && id <= 43) { bedBlock(x, y, z, id); continue; }
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
      const depth = tp - y - (F.d[1] > 0 ? 1 : 0), lit = F.s * (depth <= 1 ? 1 : 0.36 + 0.64 * Math.max(0, 1 - (depth - 1) / 14));
      const uv = UV[def.t[F.k]], base = out.p.length / 3, ax = F.d[0] ? 0 : F.d[1] ? 1 : 2, t1 = (ax + 1) % 3, t2 = (ax + 2) % 3, L = glow(nx, ny, nz);
      let n = 0;
      for (const q of F.v) {
        out.p.push(ox + x + q[0], y + q[1], oz + z + q[2]);
        const a = def.tr ? 3 : aoAt(nx, ny, nz, t1, q[t1] ? 1 : -1, t2, q[t2] ? 1 : -1), s = lit * AOF[a];
        AOV[n++] = a; pushCol(out, lit, L, AOF[a]);
      }
      out.u.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
      if (AOV[0] + AOV[2] < AOV[1] + AOV[3]) out.i.push(base + 1, base + 2, base + 3, base + 1, base + 3, base); // split along the diagonal that avoids the darkest corner
      else out.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  dropMesh(k);
  const mk = (b, mat, order) => {
    if (!b.i.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
    g.setIndex(b.i); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.renderOrder = order; scene.add(m); return m;
  };
  meshes.set(k, { o: mk(O, matO, 0), t: mk(T, matT, 1), w: mk(Wm, matW, 2), f: mk(Fm, matF, 2) });
}

// Generate nearest chunks first, mesh only once all four neighbours exist, and stay inside a per-frame time budget.
function streamChunks(px, pz, budget) {
  const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS), R = cfg.dist, key = pcx + ',' + pcz + ',' + R;
  if (key !== wantKey) {
    wantKey = key; want = [];
    for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 <= (R + 1) * (R + 1)) want.push([pcx + dx, pcz + dz, d2]);
    }
    want.sort((a, b) => a[2] - b[2]);
    for (const k of [...chunks.keys()]) {
      const [x, z] = k.split(',').map(Number);
      if ((x - pcx) ** 2 + (z - pcz) ** 2 > (R + 3) ** 2) { chunks.delete(k); torchChunks.delete(k); dropMesh(k); dirty.delete(k); }
    }
  }
  const t0 = performance.now();
  for (const [cx, cz] of want) {
    if (performance.now() - t0 > budget) return;
    const k = ck(cx, cz);
    if (chunks.has(k)) continue;
    const d = genChunk(cx, cz, worldSeed), e = editsByChunk.get(k);
    if (e) for (const [i, id] of e) d[i] = id;
    chunks.set(k, d);
    const nt = countTorches(d);
    if (nt) { torchChunks.set(k, nt); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if ((a || b) && chunks.has(ck(cx + a, cz + b))) dirty.add(ck(cx + a, cz + b)); }
  }
  for (const [cx, cz, d2] of want) {
    if (d2 > R * R) break;
    if (performance.now() - t0 > budget) return;
    const k = ck(cx, cz);
    if (meshes.has(k) && !dirty.has(k)) continue;
    if (!chunks.has(k) || !chunks.has(ck(cx + 1, cz)) || !chunks.has(ck(cx - 1, cz)) || !chunks.has(ck(cx, cz + 1)) || !chunks.has(ck(cx, cz - 1))) continue;
    dirty.delete(k); buildMesh(cx, cz);
  }
}
function chunksReady() {
  const pcx = Math.floor(P.x / CS), pcz = Math.floor(P.z / CS);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!chunks.has(ck(pcx + dx, pcz + dz))) return false;
  return true;
}

/* ---------- player physics, picking ---------- */
// Poses: 0 standing, 1 sneaking (slow, never walks off an edge), 2 crawling (0.6 high: fits a one block gap).
const POSE_H = [1.8, 1.5, 0.6], POSE_EYE = [1.62, 1.27, 0.4];
let pose = 0, eyeY = EYE, sprintOn = false, lastTapW = 0;
function collides(x, y, z, h = POSE_H[pose], ign) { // ign: blocks the player is already buried in, which do not push back
  const x0 = Math.floor(x - W + 1e-4), x1 = Math.floor(x + W - 1e-4), y0 = Math.floor(y + 1e-4), y1 = Math.floor(y + h - 1e-4), z0 = Math.floor(z - W + 1e-4), z1 = Math.floor(z + W - 1e-4);
  for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) { const id = getBlock(bx, by, bz); if (isSolid(id) && (!isBed(id) || y < by + BED_H - 1e-4) && !(ign && ign.has(bx + ',' + by + ',' + bz))) return true; }
  return false;
}
function landY(x, y, z) { // where you come to rest: on top of the block, or 9/16 up for a bed
  const by = Math.floor(y + 1e-4); let top = by;
  for (let bz = Math.floor(z - W + 1e-4); bz <= Math.floor(z + W - 1e-4); bz++) for (let bx = Math.floor(x - W + 1e-4); bx <= Math.floor(x + W - 1e-4); bx++) { const id = getBlock(bx, by, bz); if (isSolid(id)) top = Math.max(top, by + blockHeight(id)); }
  return top === by ? by + 1 : top;
}
function buriedIn(x, y, z, h) {
  const s = new Set();
  for (let by = Math.floor(y + 1e-4); by <= Math.floor(y + h - 1e-4); by++) for (let bz = Math.floor(z - W + 1e-4); bz <= Math.floor(z + W - 1e-4); bz++) for (let bx = Math.floor(x - W + 1e-4); bx <= Math.floor(x + W - 1e-4); bx++) { const id = getBlock(bx, by, bz); if (isSolid(id) && (!isBed(id) || y < by + BED_H - 1e-4)) s.add(bx + ',' + by + ',' + bz); }
  return s;
}
function eyeInWater() { // the eye is under the actual water surface, which is lower than the top of the block for sources and flows
  const ex = Math.floor(P.x), ey = Math.floor(P.y + eyeY), ez = Math.floor(P.z), id = getBlock(ex, ey, ez);
  if (!isWater(id)) return false;
  return isWater(getBlock(ex, ey + 1, ez)) || P.y + eyeY - ey < waterTop(id);
}
function physics(dt) {
  const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const shift = keys.has('ShiftLeft') || keys.has('ShiftRight'), jump = keys.has('Space');
  if (mode !== 'creative') P.fly = false;
  const bx = Math.floor(P.x), bz = Math.floor(P.z);
  const swim = isWater(getBlock(bx, Math.floor(P.y + 0.2), bz)), waist = isWater(getBlock(bx, Math.floor(P.y + 0.9), bz));
  // Sprinting: double-tap W, keep W held. It ends when W is released, when you stop, sneak, or run low on food.
  const sneakKey = shift && !P.fly;
  if (!keys.has('KeyW') || fwd <= 0 || sneakKey || P.fly || (mode !== 'creative' && stats.food <= 6)) sprintOn = false;
  P.sprint = sprintOn;
  // Sprinting in water switches to crawl-swimming. Whenever the standing body would not fit (a one block gap), you stay crawling.
  const swimCrawl = P.sprint && (pose === 2 ? swim : waist);
  let np = P.fly ? 0 : swimCrawl || keys.has('KeyC') ? 2 : sneakKey ? 1 : 0;
  while (np < 2 && collides(P.x, P.y, P.z, POSE_H[np])) np++;
  if (np === 2 && collides(P.x, P.y, P.z, POSE_H[2])) np = pose; // buried in blocks: keep the pose, suffocation does the rest
  pose = np;
  const h0 = POSE_H[pose], ign = collides(P.x, P.y, P.z, h0) ? buriedIn(P.x, P.y, P.z, h0) : null; // inside blocks: no pushing out, just move on
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw), [cfx, cfz] = swim ? flowDir(getBlock, bx, Math.floor(P.y + 0.2), bz) : [0, 0]; // flowing water carries you along
  let wx = -sy * fwd + cy * side, wz = -cy * fwd - sy * side;
  const len = Math.hypot(wx, wz); if (len > 1) { wx /= len; wz /= len; }
  const speed = P.fly ? 11 : swimCrawl ? 5.6 : swim ? 3 : pose === 2 ? 1.8 : pose === 1 ? 1.5 : P.sprint ? 7 : mouseR && eating ? 2 : 4.6;
  const a = Math.min(1, (P.ground || P.fly || swim ? 16 : 5) * dt);
  P.vx += (wx * speed + cfx * 1.6 - P.vx) * a; P.vz += (wz * speed + cfz * 1.6 - P.vz) * a;
  if (P.fly) P.vy = (jump ? 8 : 0) - (shift ? 8 : 0);
  else if (swimCrawl && fwd > 0) { const ld = lookDir(); P.vy += (ld[1] * speed + (jump ? 2 : 0) - P.vy) * a; } // crawl-swimming goes where you look
  else if (swim) P.vy = Math.max(-3, Math.min(3.2, P.vy + (jump ? 14 : -10) * dt));
  else { P.vy = Math.max(-50, P.vy - 28 * dt); if (jump && P.ground && pose !== 2) { P.vy = 9; P.ground = false; } }
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(P.vx), Math.abs(P.vy), Math.abs(P.vz)) * dt / 0.4)), h = dt / steps;
  const edge = pose === 1 && P.ground && !P.fly; // sneaking: stay on the block you are standing on
  let bumped = false;
  for (let s = 0; s < steps; s++) {
    const nx = P.x + P.vx * h; if (collides(nx, P.y, P.z, h0, ign) || (edge && !collides(nx, P.y - 0.6, P.z, 0.6))) { P.vx = 0; bumped = true; } else P.x = nx;
    const nz = P.z + P.vz * h; if (collides(P.x, P.y, nz, h0, ign) || (edge && !collides(P.x, P.y - 0.6, nz, 0.6))) { P.vz = 0; bumped = true; } else P.z = nz;
    const ny = P.y + P.vy * h;
    if (collides(P.x, ny, P.z, h0, ign)) { if (P.vy < 0) { P.ground = true; P.y = landY(P.x, ny, P.z); } P.vy = 0; }
    else { P.y = ny; if (P.vy !== 0) P.ground = false; }
  }
  if (swim && jump && bumped) P.vy = 8.5; // heave out of the water onto a ledge
  if (P.y < -10) send({ t: 'respawn' });
}
const lookDir = () => [-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch)];
function raycast(ox, oy, oz, dx, dy, dz, max, srcWater) { // srcWater: an empty bucket can aim at water sources; everything else sees through water // voxel walk (Amanatides & Woo)
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
  let tmx = dx > 0 ? (x + 1 - ox) * tdx : dx < 0 ? (ox - x) * tdx : Infinity;
  let tmy = dy > 0 ? (y + 1 - oy) * tdy : dy < 0 ? (oy - y) * tdy : Infinity;
  let tmz = dz > 0 ? (z + 1 - oz) * tdz : dz < 0 ? (oz - z) * tdz : Infinity;
  let t = 0, n = [0, 0, 0];
  while (t <= max) {
    const id = getBlock(x, y, z);
    if (id && (!isWater(id) || (srcWater && id === B.WATER))) return { x, y, z, id, n, t };
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; n = [-sx, 0, 0]; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; n = [0, -sy, 0]; }
    else { z += sz; t = tmz; tmz += tdz; n = [0, 0, -sz]; }
  }
  return null;
}
function hitBox(o, d, cx, cy, cz, hw, hh) { // ray against a box, returns distance or Infinity
  let t0 = 0, t1 = 1e9;
  for (let i = 0; i < 3; i++) {
    const c = [cx, cy, cz][i], h = i === 1 ? hh : hw, lo = c - h, hi = c + h;
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo || o[i] > hi) return Infinity; continue; }
    let a = (lo - o[i]) / d[i], b = (hi - o[i]) / d[i]; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return Infinity;
  }
  return t0;
}
function entityRay(o, d, max) { // nearest creature or player under the crosshair
  let best = null;
  for (const m of mobs.values()) { const s = mobDims(MOB_TYPES[m.type], m.size), t = hitBox(o, d, m.x, m.y + s.h / 2, m.z, s.w / 2 + 0.05, s.h / 2 + 0.05); if (t < max && (!best || t < best.t)) best = { k: 'm', id: m.id, t, x: m.x, y: m.y + s.h / 2, z: m.z }; }
  if (pvpOn()) for (const p of others.values()) { const t = hitBox(o, d, p.x, p.y + 0.9, p.z, 0.35, 0.9); if (t < max && (!best || t < best.t)) best = { k: 'p', id: p.id, t, x: p.x, y: p.y + 0.9, z: p.z }; }
  return best;
}
const pvpOn = () => !!(roomInfo && roomInfo.pvp && mode !== 'creative');
const overlapsPlayer = (x, y, z) => P.x - W < x + 1 && P.x + W > x && P.z - W < z + 1 && P.z + W > z && P.y < y + 1 && P.y + POSE_H[pose] > y;
const hl = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x000000 }));
hl.visible = false; scene.add(hl);

/* ---------- mining, attacking, placing, eating, bow ---------- */
let mining = null, mineDelay = 0, swing = 0, chipT = 0, lastAtk = 0, lastPlace = 0, eating = null, charging = null, target = null;
const startSwing = () => { if (swing <= 0) swing = 0.001; };
function stopMining() { if (mining) { mining = null; cracks.hide(); } }
function mine(t, dt) {
  const key = t.x + ',' + t.y + ',' + t.z;
  if (!mining || mining.key !== key) {
    mining = { key, x: t.x, y: t.y, z: t.z, id: t.id, t: 0, need: mode === 'creative' ? 0 : breakTime(t.id, ui.held()) };
    send({ t: 'dig', x: t.x, y: t.y, z: t.z });
  }
  if (mining.need === Infinity) { cracks.hide(); return; }
  mining.t += dt; startSwing();
  chipT -= dt; if (chipT <= 0 && mining.need > 0.15) { chipT = 0.11; fx.blockChip(t.id, t.x, t.y, t.z, t.n); }
  const prog = mining.need <= 0 ? 1 : mining.t / mining.need;
  if (prog < 1) { cracks.show(t.x, t.y, t.z, Math.floor(prog * 10)); return; }
  send({ t: 'brk', x: t.x, y: t.y, z: t.z });
  fx.blockBreak(t.id, t.x, t.y, t.z, 26);
  setBlock(t.x, t.y, t.z, 0);
  stopMining(); mineDelay = mode === 'creative' ? 0.2 : 0.18;
}
function attack(t) {
  send({ t: 'atk', k: t.k, id: t.id }); startSwing();
  fx.burst(t.x, t.y, t.z, [0.85, 0.15, 0.15], 6, 2.5, 0.09, 0.45);
}
function useBlock(t, now) {
  const hs = ui.held(), it = hs && itemInfo(hs.id);
  if ([B.TABLE, B.CHEST, B.FURNACE].includes(t.id) || isBed(t.id)) { send({ t: 'use', x: t.x, y: t.y, z: t.z, nx: t.n[0], ny: t.n[1], nz: t.n[2] }); return true; }
  if (it && it.bucket) { // empty bucket scoops the water source it aims at, a full one pours next to the block it aims at; the server decides
    if (it.bucket === 'empty' ? t.id === B.WATER : !isWater(t.id)) { send({ t: 'use', x: t.x, y: t.y, z: t.z, nx: t.n[0], ny: t.n[1], nz: t.n[2] }); startSwing(); }
    return true;
  }
  if (it && it.bed) { send({ t: 'use', x: t.x, y: t.y, z: t.z, nx: t.n[0], ny: t.n[1], nz: t.n[2] }); startSwing(); lastPlace = now; return true; } // the server lays out both halves
  if (!(it && it.block)) return false;
  const x = t.x + t.n[0], y = t.y + t.n[1], z = t.z + t.n[2], cur = getBlock(x, y, z);
  let place = it.block;
  if (place === B.TORCH) { place = torchFor(t.n[0], t.n[1], t.n[2]); if (!place || !isSolid(t.id) || isBed(t.id)) return true; } // top or side of a solid block
  if (y < 0 || y >= CH || (cur && !isWater(cur)) || (!isTorch(place) && overlapsPlayer(x, y, z))) return true;
  setBlock(x, y, z, place); startSwing(); lastPlace = now;
  send({ t: 'use', x: t.x, y: t.y, z: t.z, nx: t.n[0], ny: t.n[1], nz: t.n[2] }); // predicted here; the server confirms or undoes it
  return true;
}
function rightDown(now) {
  const hs = ui.held(), it = hs && itemInfo(hs.id);
  if (target && target.k === undefined && target.id !== undefined && useBlock(target, now)) return;
  if (it && it.food && (mode !== 'creative') && stats.food < 20) { eating = { t: 0 }; send({ t: 'hold', on: true }); }
  else if (it && it.bow && (mode === 'creative' || ui.count(I.ARROW) > 0)) charging = { t: 0 };
}
function rightUp() {
  if (eating) { eating = null; send({ t: 'hold', on: false }); }
  if (charging) {
    if (charging.t > 0.15) { const d = lookDir(); send({ t: 'shoot', dx: d[0], dy: d[1], dz: d[2], ch: Math.min(1, charging.t) }); startSwing(); }
    charging = null;
  }
}

/* ---------- sky, sun and moon ---------- */
const NIGHT = new THREE.Color(0x0a1030), DAY = new THREE.Color(0x87ceeb);
function discTex(draw) { const c = document.createElement('canvas'); c.width = c.height = 32; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t; }
function envTex(img, cell) { const c = document.createElement('canvas'); c.width = c.height = cell; c.getContext('2d').drawImage(img, 0, 0, cell, cell, 0, 0, cell, cell); const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace; return t; }
const moonImg = PACK.env.moon, moonCell = moonImg ? (moonImg.width >= moonImg.height * 2 ? moonImg.width / 4 : Math.min(moonImg.width, moonImg.height)) : 0;
const sun = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ map: PACK.env.sun ? envTex(PACK.env.sun, Math.min(PACK.env.sun.width, PACK.env.sun.height)) : discTex((g) => { g.fillStyle = '#fff3a0'; g.fillRect(4, 4, 24, 24); g.fillStyle = '#ffd84a'; g.fillRect(8, 8, 16, 16); g.fillStyle = '#ffffff'; g.fillRect(12, 12, 8, 8); }), transparent: true, depthWrite: false, fog: false }));
const moon = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), new THREE.MeshBasicMaterial({ map: moonImg ? envTex(moonImg, moonCell) : discTex((g) => { g.fillStyle = '#d9dde6'; g.fillRect(6, 6, 20, 20); g.fillStyle = '#b4bac6'; g.fillRect(10, 9, 5, 5); g.fillRect(17, 16, 6, 6); g.fillRect(9, 19, 4, 4); }), transparent: true, depthWrite: false, fog: false }));
sun.renderOrder = moon.renderOrder = -1; scene.add(sun, moon);
const starPos = new Float32Array(240 * 3);
for (let i = 0; i < 240; i++) { const a = Math.random() * 6.283, e = Math.random() * 1.4 - 0.2, r = 420; starPos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3); }
const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })); stars.frustumCulled = false; scene.add(stars);
// A sky dome shades from the horizon colour (which the fog matches) up to a deeper blue, and the horizon warms up around sunrise and sunset.
const SUNSET = new THREE.Color(0xff9a5a), ZEN_DAY = new THREE.Color(0x3f82d8), ZEN_NIGHT = new THREE.Color(0x02050e), zen = new THREE.Color(), hor = new THREE.Color();
const dome = new THREE.Mesh(new THREE.SphereGeometry(450, 20, 10), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
dome.renderOrder = -2; dome.frustumCulled = false; scene.add(dome);
const domeCol = new Float32Array(dome.geometry.attributes.position.count * 3); dome.geometry.setAttribute('color', new THREE.BufferAttribute(domeCol, 3));
let skyAng = 1.2;
function sky(inGame) {
  let t = 1, ang = 1.2;
  if (inGame) {
    const ph = ((((Date.now() + tOff - epoch) % dayMs) + dayMs) % dayMs) / dayMs; ang = ph * 6.2832;
    t = Math.min(1, Math.max(0, (Math.sin(ang) + 0.25) / 0.9));
  }
  skyAng = ang;
  scene.background.copy(NIGHT).lerp(DAY, t);
  if (inGame) { const glow = Math.max(0, 1 - Math.abs(Math.sin(ang)) / 0.22) * 0.5; if (glow > 0) scene.background.lerp(SUNSET, glow); }
  scene.fog.color.copy(scene.background);
  const b = 0.3 + 0.7 * t; matO.color.setScalar(b); matT.color.setScalar(b); matW.color.setScalar(b); matF.color.setScalar(b);
  scene.fog.near = Math.max(8, cfg.dist * CS * 0.5); scene.fog.far = cfg.dist * CS * 0.95;
  const cp = camera.position, dx = Math.cos(ang), dy = Math.sin(ang);
  sun.position.set(cp.x + dx * 300, cp.y + dy * 300, cp.z + 90); sun.lookAt(cp);
  moon.position.set(cp.x - dx * 300, cp.y - dy * 300, cp.z - 90); moon.lookAt(cp);
  stars.position.set(cp.x, cp.y, cp.z); stars.material.opacity = Math.max(0, 0.9 - t * 1.6);
  const under = inGame && eyeInWater();
  if (under) { scene.background.set(0x1f4fa8); scene.fog.color.set(0x1f4fa8); scene.fog.near = 0.5; scene.fog.far = 22; }
  dome.visible = !under; dome.position.copy(cp);
  if (!under) {
    zen.copy(ZEN_NIGHT).lerp(ZEN_DAY, t); hor.copy(scene.background);
    const pos = dome.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { const f = Math.pow(Math.max(0, pos.getY(i) / 450), 0.55); domeCol[i * 3] = hor.r + (zen.r - hor.r) * f; domeCol[i * 3 + 1] = hor.g + (zen.g - hor.g) * f; domeCol[i * 3 + 2] = hor.b + (zen.b - hor.b) * f; }
    dome.geometry.attributes.color.needsUpdate = true;
  }
}

/* ---------- other players, creatures, drops, arrows ---------- */
function labelSprite(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d'); x.font = 'bold 30px sans-serif'; x.textAlign = 'center';
  x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 10, 256, 44); x.fillStyle = '#fff'; x.fillText(text, 128, 44, 240);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: false }));
  s.scale.set(2, 0.5, 1); s.position.y = 2.2; return s;
}
function addOther(p) {
  removeOther(p.id);
  const model = makePlayer(p.color); model.g.add(labelSprite(p.name)); setEquipment(model, p.held || 0, p.arm || [0, 0, 0, 0], p.off || 0);
  model.g.position.set(p.x, p.y, p.z); scene.add(model.g);
  others.set(p.id, { id: p.id, name: p.name, model, x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0, tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw || 0, flash: 0, speed: 0, po: p.po || 0, tilt: 0 });
  renderPlayers();
}
function removeOther(id) {
  const o = others.get(id); if (!o) return;
  disposeModel(o.model.g); others.delete(id); renderPlayers();
}
function renderPlayers() {
  const names = [session ? session.name : 'You', ...[...others.values()].map((o) => o.name)];
  $('plist').textContent = `Players (${names.length})\n` + names.join('\n');
}
function syncEnts(m) {
  const seen = new Set();
  for (const [id, type, x, y, z, yaw, hp, fl, sz, aux, fuse] of m.m) {
    seen.add(id);
    let o = mobs.get(id);
    if (!o) { const model = makeMob(type, aux); model.g.position.set(x, y, z); scene.add(model.g); o = { id, type, model, x, y, z, yaw, speed: 0, vy: 0, flags: 0, size: 1 }; mobs.set(id, o); }
    Object.assign(o, { tx: x, ty: y, tz: z, tyaw: yaw, flags: fl, size: sz, fuse, hp, aux });
  }
  for (const [id, o] of mobs) if (!seen.has(id)) { disposeModel(o.model.g); mobs.delete(id); }
  const seenI = new Set();
  for (const [id, item, n, x, y, z] of m.i) {
    seenI.add(id);
    let o = drops.get(id);
    if (!o) { const mesh = itemMesh(item, itemInfo(item) && itemInfo(item).block ? 0.3 : 0.3); mesh.position.set(x, y, z); scene.add(mesh); o = { mesh, x, y, z, n, phase: id * 1.7 }; drops.set(id, o); }
    o.tx = x; o.ty = y; o.tz = z;
  }
  for (const [id, o] of drops) if (!seenI.has(id)) { scene.remove(o.mesh); drops.delete(id); }
  const seenA = new Set();
  for (const [id, x, y, z, vx, vy, vz] of m.a) {
    seenA.add(id);
    let o = arrows.get(id);
    if (!o) { const mesh = arrowMesh(); mesh.rotation.order = 'YXZ'; mesh.position.set(x, y, z); scene.add(mesh); o = { mesh, x, y, z }; arrows.set(id, o); }
    Object.assign(o, { tx: x, ty: y, tz: z, vx, vy, vz });
  }
  for (const [id, o] of arrows) if (!seenA.has(id)) { disposeModel(o.mesh); arrows.delete(id); }
}
function updateEnts(dt, now) {
  const k = Math.min(1, dt * 12), t = now / 1000;
  for (const o of mobs.values()) {
    const px = o.x, pz = o.z, py = o.y;
    o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; o.z += (o.tz - o.z) * k;
    o.yaw += Math.atan2(Math.sin(o.tyaw - o.yaw), Math.cos(o.tyaw - o.yaw)) * Math.min(1, dt * 10);
    const sp = Math.hypot(o.x - px, o.z - pz) / Math.max(dt, 1e-3);
    o.speed += (sp - o.speed) * Math.min(1, dt * 8); o.vy = (o.y - py) / Math.max(dt, 1e-3);
    o.model.g.position.set(o.x, o.y, o.z); o.model.g.rotation.y = o.yaw + Math.PI;
    o.model.setFlash(!!(o.flags & 1));
    o.model.update({ speed: o.speed, flags: o.flags, size: o.size, fuse: o.fuse, t, dt, vy: o.vy, aux: o.aux });
  }
  for (const o of drops.values()) {
    o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; o.z += (o.tz - o.z) * k;
    o.mesh.position.set(o.x, o.y + 0.28 + Math.sin(t * 2.4 + o.phase) * 0.05, o.z); o.mesh.rotation.y = t * 1.4 + o.phase;
  }
  for (const o of arrows.values()) {
    o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt; // fly on between server updates
    o.x += (o.tx - o.x) * Math.min(1, dt * 6); o.y += (o.ty - o.y) * Math.min(1, dt * 6); o.z += (o.tz - o.z) * Math.min(1, dt * 6);
    o.mesh.position.set(o.x, o.y, o.z); o.mesh.rotation.y = Math.atan2(o.vx, o.vz); o.mesh.rotation.x = -Math.atan2(o.vy, Math.hypot(o.vx, o.vz));
  }
  for (const o of others.values()) {
    const px = o.x, pz = o.z;
    o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; o.z += (o.tz - o.z) * k;
    const dy = o.tyaw - o.yaw; o.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * k;
    o.speed += (Math.hypot(o.x - px, o.z - pz) / Math.max(dt, 1e-3) - o.speed) * Math.min(1, dt * 8);
    o.tilt += ((o.po === 3 ? -1.45 : o.po === 2 ? 1.45 : o.po === 1 ? 0.32 : 0) - o.tilt) * Math.min(1, dt * 10); // sneaking leans forward, crawling lies face down, sleeping lies on the back
    const lie = o.tilt / 1.45, gm = o.model.g, ry = o.yaw + Math.PI;
    gm.rotation.order = 'YXZ'; gm.rotation.y = ry; gm.rotation.x = o.tilt;
    gm.position.set(o.x - Math.sin(ry) * 0.9 * lie, o.y + 0.25 * Math.abs(lie), o.z - Math.cos(ry) * 0.9 * lie);
    o.flash = Math.max(0, o.flash - dt); o.model.setFlash(o.flash > 0);
    o.model.update({ speed: o.speed, swing: 0, pitch: 0, dt, t });
  }
  for (let i = ghosts.length - 1; i >= 0; i--) { // death animation: tip over, shrink away
    const o = ghosts[i]; o.t += dt;
    o.model.g.rotation.z = Math.min(1.5, o.t * 5); o.model.g.position.y = o.y; o.model.g.scale.setScalar(Math.max(0.01, 1 - Math.max(0, o.t - 0.45) * 2.2));
    if (o.t > 0.9) { disposeModel(o.model.g); ghosts.splice(i, 1); }
  }
}

/* ---------- networking ---------- */
function setConn(t, ok) { const e = $('conn'); e.textContent = t; e.className = ok ? '' : 'bad'; }
function openSocket() {
  const sock = new WebSocket(net.ws + '/ws'); ws = sock; setConn('Connecting…', false);
  sock.onopen = () => send({ t: 'join', name: session.name, room: session.room, create: session.create, roomName: session.roomName, seed: session.seed, mode: session.mode, pvp: session.pvp, cheats: session.cheats, token: store.get('token', null) });
  sock.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null; joined = false;
    if (leaving) return;
    if (++retry > 14) return leaveToMenu('Lost the connection to the game server.');
    setConn('Reconnecting…', false);
    setTimeout(() => { if (!leaving && !ws) openSocket(); }, Math.min(8000, 400 * 2 ** retry));
  };
}
function onMsg(m) {
  switch (m.t) {
    case 'welcome': {
      resetWorld(m.room.seed); store.set('token', m.token); retry = 0; myId = m.pid; dead = false; ui.hideDead();
      roomInfo = m.room; session.room = m.room.id; session.create = false; mode = m.room.mode; ui.setMode(mode);
      tOff = m.now - Date.now(); epoch = m.epoch; dayMs = m.dayMs;
      for (let i = 0; i + 3 < m.edits.length; i += 4) setBlock(m.edits[i], m.edits[i + 1], m.edits[i + 2], m.edits[i + 3]);
      Object.assign(P, { x: m.me.x, y: m.me.y, z: m.me.z, yaw: m.me.yaw || 0, pitch: m.me.pitch || 0, vx: 0, vy: 0, vz: 0, fly: false });
      for (const p of m.players) addOther(p);
      joined = true; setConn('Online', true); $('save').textContent = ''; renderPlayers(); enterGame();
      break;
    }
    case 'inv': ui.setInv(m); break;
    case 'st': Object.assign(stats, { hp: m.hp, food: m.food, air: m.air, def: m.def }); ui.setStats(m); break;
    case 'open': if (!dead) { if (document.pointerLockElement) document.exitPointerLock(); ui.open(m.kind); } break;
    case 'wclose': ui.close(false); if (state === 'play' && !locked && !dead) { $('pause').hidden = false; $('resume').textContent = 'Resume'; } break;
    case 'wp': ui.setProgress(m.pr); break;
    case 'pj': addOther(m.p); break;
    case 'pl': removeOther(m.id); break;
    case 'eq': { const o = others.get(m.id); if (o) setEquipment(o.model, m.held, m.arm, m.off || 0); break; }
    case 'ps': for (const [id, x, y, z, yaw, , po] of m.s) { const o = others.get(id); if (o) { o.tx = x; o.ty = y; o.tz = z; o.tyaw = yaw; o.po = po | 0; } } break;
    case 'ents': syncEnts(m); break;
    case 'blk': {
      const old = getBlock(m.x, m.y, m.z);
      setBlock(m.x, m.y, m.z, m.id);
      if (m.id === 0 && old > 0 && !isWater(old) && old !== B.BEDROCK) fx.blockBreak(old, m.x, m.y, m.z, 14); // someone else's mining
      break;
    }
    case 'blks': for (let i = 0; i + 3 < m.b.length; i += 4) setBlock(m.b[i], m.b[i + 1], m.b[i + 2], m.b[i + 3]); break;
    case 'fx': onFx(m); break;
    case 'kb': P.vx += m.x; P.vy = Math.max(P.vy, m.y); P.vz += m.z; P.ground = false; break;
    case 'sleep':
      if (m.on) { sleeping = { x: m.x, y: m.y, z: m.z, dir: m.dir }; const [dx, dz] = DIR4[m.dir]; P.x = m.x + 0.5; P.y = m.y + BED_H; P.z = m.z + 0.5; P.vx = P.vy = P.vz = 0; P.yaw = Math.atan2(dx, dz); P.pitch = 1.35; keys.clear(); stopMining(); rightUp(); }
      else { sleeping = null; P.x = m.x; P.y = m.y; P.z = m.z; P.vx = P.vy = P.vz = 0; P.pitch = 0; P.ground = false; }
      break;
    case 'time': epoch = m.epoch; break;
    case 'dead':
      sleeping = null; dead = true; stopMining(); rightUp(); keys.clear(); ui.close(false); ui.showDead(m.m);
      if (document.pointerLockElement) document.exitPointerLock();
      $('pause').hidden = true; break;
    case 'chat': addChat(m); break;
    case 'fix':
      P.x = m.x; P.y = m.y; P.z = m.z; P.vx = P.vy = P.vz = 0;
      if (dead) { dead = false; ui.hideDead(); if (state === 'play' && !locked) { $('pause').hidden = false; $('resume').textContent = 'Resume'; } }
      break;
    case 'save': $('save').textContent = m.ok ? 'World saved' : 'Could not save, retrying…'; $('save').className = m.ok ? '' : 'bad'; break;
    case 'err': if (m.fatal) leaveToMenu(m.m); else addChat({ sys: 1, m: m.m }); break;
  }
}
function onFx(m) {
  audio.fx(m);
  if (m.k === 'hurt') {
    if (m.id === myId) { ui.flash(); } else { const o = others.get(m.id); if (o) o.flash = 0.25; }
  } else if (m.k === 'die') {
    const model = makeMob(m.ty, m.aux); model.g.position.set(m.x, m.y, m.z); model.g.rotation.y = m.yaw + Math.PI;
    if (m.ty === 10) model.update({ speed: 0, flags: 32, size: m.sz, t: 0, dt: 0, vy: 0 });
    scene.add(model.g); model.setFlash(true); ghosts.push({ model, t: 0, y: m.y });
    fx.burst(m.x, m.y + 0.5, m.z, [0.92, 0.92, 0.92], 12, 2.2, 0.12, 0.8);
  } else if (m.k === 'boom') fx.explosion(m.x, m.y, m.z);
  else if (m.k === 'block') { const o = m.id === myId ? P : others.get(m.id); if (o) fx.burst(o.x, o.y + 1.2, o.z, [0.82, 0.82, 0.88], 8, 2.5, 0.08, 0.5); } // a shield took a hit
}
let lastSend = 0, lastKey = '';
function netSend(now) {
  if (!joined || dead || sleeping || now - lastSend < 50) return;
  const r = (v) => Math.round(v * 100) / 100, yaw = r(P.yaw % 6.2832), pitch = r(P.pitch), key = [r(P.x), r(P.y), r(P.z), yaw, pitch, P.sprint, pose].join();
  if (key === lastKey && now - lastSend < 1000) return;
  lastKey = key; lastSend = now; send({ t: 'pos', x: r(P.x), y: r(P.y), z: r(P.z), yaw, pitch, sp: P.sprint, po: pose });
}

/* ---------- menu, HUD, input ---------- */
const menuBtns = ['play', 'join', 'create'].map($);
const menuMsg = (t) => { $('menumsg').textContent = t; };
const busy = (b) => menuBtns.forEach((x) => { x.disabled = b || !serverReady; });
const lock = () => { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); };

function start(opts) {
  const name = $('name').value.trim().slice(0, 16) || 'Builder' + ((Math.random() * 900 + 100) | 0);
  store.set('name', name); session = { name, ...opts }; leaving = false; retry = 0; joined = false;
  busy(true); menuMsg('Joining…'); openSocket();
}
function enterGame() {
  busy(false);
  if (state === 'play') return;
  state = 'play'; $('menu').hidden = true; $('hud').hidden = false; $('pause').hidden = false;
  $('pTitle').textContent = roomInfo.name; $('pCode').textContent = roomInfo.id;
  const tail = `${mode === 'creative' ? 'Creative' : 'Survival'}${roomInfo.pvp && mode !== 'creative' ? ', PvP on' : ''}. `;
  $('pSub').textContent = tail + (roomInfo.owner ? 'You own this world. Type /help in chat.' : 'Press Play, then click the screen to look around.');
  $('resume').textContent = 'Play';
}
function leaveToMenu(msg) {
  leaving = true; joined = false; state = 'menu'; dead = false; audio.stop();
  if (ws) { const s = ws; ws = null; s.close(); }
  if (document.pointerLockElement) document.exitPointerLock();
  ui.close(false); ui.hideDead(); stopMining(); eating = charging = null; sleeping = null;
  $('hud').hidden = true; $('pause').hidden = true; $('menu').hidden = false; keys.clear();
  resetWorld(MENU_SEED); busy(false); menuMsg(msg || '');
}
function addChat(m) {
  const d = document.createElement('div');
  if (m.sys) d.className = 'sys';
  d.textContent = m.sys ? m.m : `${m.from}: ${m.m}`; // textContent only: chat is never parsed as HTML
  const log = $('log'); log.append(d);
  while (log.children.length > 30) log.firstChild.remove();
  setTimeout(() => d.remove(), 25000);
}
function selectSlot(i) { i = ((i % 9) + 9) % 9; if (i === ui.sel) return; ui.selectSlot(i); send({ t: 'hot', i }); stopMining(); rightUp(); }
function openChat() { chatOpen = true; document.exitPointerLock(); const i = $('chatIn'); i.hidden = false; i.value = ''; i.focus(); }
function closeChat(sendIt) {
  const i = $('chatIn'), v = i.value.trim();
  if (sendIt && v) send({ t: 'chat', m: v });
  i.value = ''; i.hidden = true; i.blur(); chatOpen = false; lock();
}
function toggleInventory() {
  if (ui.isOpen) { ui.close(true); lock(); return; }
  if (document.pointerLockElement) document.exitPointerLock();
  keys.clear(); mouseL = mouseR = false; stopMining(); rightUp(); ui.open('inv');
}

$('play').onclick = () => start({ room: 'PUBLIC' });
$('join').onclick = () => {
  const code = $('code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(code)) return menuMsg('Enter the world code: letters and numbers only.');
  start({ room: code });
};
$('create').onclick = () => start({ create: true, roomName: $('wname').value.trim(), seed: $('seed').value.trim(), mode: $('mode').value, pvp: $('pvp').checked, cheats: $('cheats').checked });
$('resume').onclick = lock;
$('leave').onclick = () => leaveToMenu('');
$('copy').onclick = () => { try { navigator.clipboard.writeText(roomInfo.id); $('copy').textContent = 'Copied'; setTimeout(() => ($('copy').textContent = 'Copy'), 1500); } catch { /* clipboard blocked */ } };
for (const [id, key] of [['sDist', 'dist'], ['sFov', 'fov'], ['sSens', 'sens']]) {
  $(id).value = cfg[key];
  $(id).oninput = () => { cfg[key] = +$(id).value; store.set('cfg', cfg); if (key === 'fov') { camera.fov = cfg.fov; camera.updateProjectionMatrix(); } };
}
canvas.addEventListener('click', () => { if (state === 'play' && !locked && !chatOpen && !ui.isOpen && !dead) lock(); });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) { keys.clear(); mouseL = mouseR = false; stopMining(); rightUp(); }
  if (state === 'play') { $('pause').hidden = locked || chatOpen || ui.isOpen || dead; if (!locked && !chatOpen && !ui.isOpen && !dead) $('resume').textContent = 'Resume'; }
});
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) {
    if (e.target.id === 'chatIn') { if (e.key === 'Enter') closeChat(true); else if (e.key === 'Escape') closeChat(false); }
    return;
  }
  if (state !== 'play' || dead) return;
  if (ui.isOpen) { if (e.code === 'KeyE' || e.code === 'Escape') { e.preventDefault(); ui.close(true); lock(); } return; }
  if (!locked) return;
  if (sleeping) { if (WAKE_KEYS.includes(e.code)) send({ t: 'wake' }); return; }
  if (e.code === 'Space') e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyW') { const t = performance.now(); if (t - lastTapW < 300 && !e.shiftKey) sprintOn = true; lastTapW = t; } // double-tap W to sprint
  if (e.code === 'Enter') { e.preventDefault(); openChat(); }
  else if (e.code === 'KeyE') toggleInventory();
  else if (e.code === 'KeyQ') send({ t: 'drop', all: e.ctrlKey ? 1 : 0 });
  else if (e.code === 'KeyF' && mode === 'creative') { P.fly = !P.fly; P.vy = 0; }
  else if (e.code === 'KeyR') send({ t: 'respawn' });
  else if (/^Digit[1-9]$/.test(e.code)) selectSlot(+e.code.slice(5) - 1);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('mousemove', (e) => {
  if (!locked || sleeping) return;
  P.yaw -= e.movementX * 0.0022 * cfg.sens;
  P.pitch = Math.max(-1.55, Math.min(1.55, P.pitch - e.movementY * 0.0022 * cfg.sens));
});
canvas.addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) mouseL = true;
  if (e.button === 2) { mouseR = true; rightDown(performance.now()); }
});
addEventListener('mouseup', (e) => { if (e.button === 0) { mouseL = false; stopMining(); } if (e.button === 2) { mouseR = false; rightUp(); } });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (locked) selectSlot(ui.sel + (e.deltaY > 0 ? 1 : -1)); }, { passive: true });

/* ---------- server discovery: Netlify function, ?server=, or same origin ---------- */
async function resolveServer() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) store.set('server', q);
  let s = q || '';
  if (!s) { try { const r = await fetch('/api/config', { cache: 'no-store' }); if (r.ok) s = (await r.json()).server || ''; } catch { /* no config function here */ } }
  if (!s) s = store.get('server', '') || location.origin;
  s = s.trim().replace(/\/+$/, '');
  if (!/^(https?|wss?):\/\//.test(s)) s = 'https://' + s; // address pasted without https://? assume it
  return { http: s.replace(/^ws/, 'http'), ws: s.replace(/^http/, 'ws') };
}
async function pollHealth() {
  for (let i = 0; i < 70; i++) {
    try {
      const r = await fetch(net.http + '/health', { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j.game === 'voxel-realms') { serverReady = true; busy(false); return menuMsg(''); } }
      else if (r.status === 404) break;
    } catch { /* server asleep or unreachable: keep trying */ }
    menuMsg(i < 2 ? 'Contacting the game server…' : 'Waking the game server (free hosts can take about a minute)…');
    await new Promise((res) => setTimeout(res, 2500));
  }
  menuMsg('No game server found. On Netlify, set GAME_SERVER_URL (see the README), or open this page with ?server=https://your-server');
}

/* ---------- main loop ---------- */
let last = performance.now(), infoAt = 0, bobT = 0;
function play(dt, now) {
  const ready = chunksReady(), busyUI = ui.isOpen || dead;
  streamChunks(P.x, P.z, ready ? 6 : 40);
  if (ready && joined && !dead && !sleeping) physics(dt);
  eyeY += ((sleeping ? 0.25 : POSE_EYE[pose]) - eyeY) * Math.min(1, dt * 14);
  sleepT = sleeping ? sleepT + dt : 0; // the screen fades to black while you sleep
  $('sleepfade').style.opacity = sleeping ? Math.min(0.92, sleepT / 2.2) : 0; $('sleephint').style.opacity = sleeping ? Math.max(0, Math.min(1, sleepT - 1.2)) : 0;
  camera.position.set(P.x, P.y + eyeY, P.z); camera.rotation.set(P.pitch, P.yaw, 0);
  const hh0 = ui.held(), hi0 = hh0 && itemInfo(hh0.id);
  $('smother').classList.toggle('on', ready && isSolid(getBlock(Math.floor(P.x), Math.floor(P.y + eyeY), Math.floor(P.z)))); // head inside a block: the view goes dark
  const d = lookDir(), o = [P.x, P.y + eyeY, P.z], bh = raycast(o[0], o[1], o[2], d[0], d[1], d[2], mode === 'creative' ? 7 : 5, !!(hi0 && hi0.bucket === 'empty')), eh = busyUI ? null : entityRay(o, d, 4.5);
  target = eh && (!bh || eh.t < bh.t) ? eh : bh;
  const blockT = target && target.k === undefined ? target : null;
  if (blockT && !busyUI) { hl.visible = true; hl.position.set(blockT.x + 0.5, blockT.y + 0.5, blockT.z + 0.5); } else hl.visible = false;
  mineDelay = Math.max(0, mineDelay - dt);
  if (locked && !busyUI && mouseL) {
    if (target && target.k !== undefined) { stopMining(); if (now - lastAtk > 540) { lastAtk = now; attack(target); } }
    else if (blockT && mineDelay <= 0) mine(blockT, dt);
    else if (!blockT) stopMining();
  }
  if (locked && !busyUI && mouseR && blockT && !eating && !charging && now - lastPlace > 250) { const hs = ui.held(), it = hs && itemInfo(hs.id); if (it && it.block) useBlock(blockT, now); }
  if (eating) { eating.t += dt; if (eating.t >= 1.6) { send({ t: 'eat' }); eating = null; send({ t: 'hold', on: false }); } }
  if (charging) charging.t = Math.min(1.2, charging.t + dt);
  if (swing > 0) { swing += dt * (mining ? 3.2 : 4.5); if (swing >= 1) swing = mining ? 0.001 : 0; }
  const hs = ui.held(); held.set(hs ? hs.id : 0);
  const off = ui.offhand(), hit = hs && itemInfo(hs.id), usable = hit && (hit.block || hit.food || hit.bow || hit.bucket || hit.bed);
  const guarding = !!(locked && !busyUI && !sleeping && mouseR && off && itemInfo(off.id).shield && !usable && !eating && !charging); // hold right click with a shield and nothing else to use
  if (guarding !== guardSent) { guardSent = guarding; send({ t: 'guard', on: guarding }); }
  bobT += dt; held.g.visible = !dead && !ui.isOpen;
  held.update(dt, { swing, eating: !!eating, charge: charging ? Math.min(1, charging.t) : 0, drawing: !!charging, chargeT: charging ? charging.t : 0, guard: guarding, off: off ? off.id : 0, moving: !!(keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyA') || keys.has('KeyD')) && P.ground });
  updateEnts(dt, now); fx.update(dt);
  sky(true); netSend(now);
  audio.update(dt, { on: !dead, ang: skyAng, look: d, x: P.x, y: P.y + eyeY, z: P.z, yaw: P.yaw, mobs, under: eyeInWater(), sunHidden: (sx, sy, sz) => !!raycast(P.x, P.y + eyeY, P.z, sx, sy, sz, cfg.dist * CS, false) });
  if (now - infoAt > 250) { infoAt = now; $('pos').textContent = `${P.x.toFixed(1)}, ${P.y.toFixed(1)}, ${P.z.toFixed(1)}${P.fly ? ' (flying)' : ''}`; }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (state === 'play') play(dt, now);
  else {
    const a = still ? 0.8 : now / 22000; // title screen: slow flyover of a generated world
    camera.position.set(Math.cos(a) * 44, 38, Math.sin(a) * 44); camera.lookAt(0, 22, 0);
    streamChunks(camera.position.x, camera.position.z, 10); sky(false); hl.visible = false; held.g.visible = false; fx.update(dt);
  }
  waterTex.offset.y = 1 - ((Math.floor(now / 90) % WATER_FRAMES) + 1) / WATER_FRAMES;
  flowTex.offset.y = 1 - ((Math.floor(now / 70) % FLOW_FRAMES) + 1) / FLOW_FRAMES;
  renderer.render(scene, camera);
}

$('name').value = store.get('name', '');
resetWorld(MENU_SEED);
menuMsg('Finding the game server…');
resolveServer().then((n) => { net = n; return pollHealth(); });
requestAnimationFrame(frame);
