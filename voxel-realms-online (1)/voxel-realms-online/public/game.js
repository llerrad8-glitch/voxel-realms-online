import * as THREE from 'three';
import { CS, CH, B, BLOCKS, isSolid, idx, genChunk } from './shared/world.js';
import { itemInfo, breakTime, I } from './shared/items.js';
import { MOB_TYPES, mobDims } from './shared/mobs.js';
import { UV } from './icons.js';
import { atlasTex, makeMob, makePlayer, setEquipment, itemMesh, arrowMesh, HeldView } from './models.js';
import { Particles, Cracks } from './fx.js';
import { createUI } from './ui.js';

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
const P = { x: 0, y: 40, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, ground: false, fly: false, sprint: false };
const stats = { hp: 20, food: 20, air: 15, def: 0 };

/* ---------- renderer ---------- */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
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
const fx = new Particles(scene), cracks = new Cracks(scene), held = new HeldView(camera, scene);
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const ui = createUI({ send });

/* ---------- world storage + chunk meshing ---------- */
let worldSeed = MENU_SEED, wantKey = '', want = [];
const chunks = new Map(), meshes = new Map(), editsByChunk = new Map(), dirty = new Set();
const ck = (cx, cz) => cx + ',' + cz;
const TR = BLOCKS.map((b) => !!(b && b.tr));

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
  c[i] = id; dirty.add(k);
  if (lx === 0) dirty.add(ck(cx - 1, cz)); if (lx === CS - 1) dirty.add(ck(cx + 1, cz));
  if (lz === 0) dirty.add(ck(cx, cz - 1)); if (lz === CS - 1) dirty.add(ck(cx, cz + 1));
}
function dropMesh(k) {
  const m = meshes.get(k); if (!m) return;
  for (const o of [m.o, m.t]) if (o) { scene.remove(o); o.geometry.dispose(); }
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

// Only exposed faces become geometry: two meshes per chunk (solid, and see-through for water and glass).
// Faces deep under the surface get darker, so caves are properly dim without a lighting engine.
function buildMesh(cx, cz) {
  const k = ck(cx, cz), d = chunks.get(k), ox = cx * CS, oz = cz * CS;
  const nb = [chunks.get(ck(cx + 1, cz)), chunks.get(ck(cx - 1, cz)), chunks.get(ck(cx, cz + 1)), chunks.get(ck(cx, cz - 1))];
  const top = new Int16Array(CS * CS); // highest block that shades the column (leaves, glass and water let light through)
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    let y = CH - 1;
    for (; y >= 0; y--) { const id = d[x + CS * (z + CS * y)]; if (id && id !== B.WATER && id !== B.LEAVES && !TR[id]) break; }
    top[x + CS * z] = y;
  }
  const O = { p: [], u: [], c: [], i: [] }, T = { p: [], u: [], c: [], i: [] };
  for (let y = 0; y < CH; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const id = d[x + CS * (z + CS * y)];
    if (!id) continue;
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
      const uv = UV[def.t[F.k]], base = out.p.length / 3;
      for (const q of F.v) { out.p.push(ox + x + q[0], y + q[1], oz + z + q[2]); out.c.push(lit, lit, lit); }
      out.u.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
      out.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
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
  meshes.set(k, { o: mk(O, matO, 0), t: mk(T, matT, 1) });
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
      if ((x - pcx) ** 2 + (z - pcz) ** 2 > (R + 3) ** 2) { chunks.delete(k); dropMesh(k); dirty.delete(k); }
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
function collides(x, y, z) {
  const x0 = Math.floor(x - W + 1e-4), x1 = Math.floor(x + W - 1e-4), y0 = Math.floor(y + 1e-4), y1 = Math.floor(y + H - 1e-4), z0 = Math.floor(z - W + 1e-4), z1 = Math.floor(z + W - 1e-4);
  for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) if (isSolid(getBlock(bx, by, bz))) return true;
  return false;
}
function physics(dt) {
  if (collides(P.x, P.y, P.z)) { P.y += 0.25; P.vy = 0; return; } // built over or stuck: climb out gently
  const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const shift = keys.has('ShiftLeft') || keys.has('ShiftRight'), jump = keys.has('Space');
  if (mode !== 'creative') P.fly = false;
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  let wx = -sy * fwd + cy * side, wz = -cy * fwd - sy * side;
  const len = Math.hypot(wx, wz); if (len > 1) { wx /= len; wz /= len; }
  const swim = getBlock(Math.floor(P.x), Math.floor(P.y + 0.2), Math.floor(P.z)) === B.WATER;
  P.sprint = shift && fwd > 0 && !P.fly && !swim && (mode === 'creative' || stats.food > 6);
  const speed = P.fly ? 11 : swim ? 3 : P.sprint ? 7 : mouseR && eating ? 2 : 4.6;
  const a = Math.min(1, (P.ground || P.fly || swim ? 16 : 5) * dt);
  P.vx += (wx * speed - P.vx) * a; P.vz += (wz * speed - P.vz) * a;
  if (P.fly) P.vy = (jump ? 8 : 0) - (shift ? 8 : 0);
  else if (swim) P.vy = Math.max(-3, Math.min(3.2, P.vy + (jump ? 14 : -10) * dt));
  else { P.vy = Math.max(-50, P.vy - 28 * dt); if (jump && P.ground) { P.vy = 9; P.ground = false; } }
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(P.vx), Math.abs(P.vy), Math.abs(P.vz)) * dt / 0.4)), h = dt / steps;
  let bumped = false;
  for (let s = 0; s < steps; s++) {
    const nx = P.x + P.vx * h; if (collides(nx, P.y, P.z)) { P.vx = 0; bumped = true; } else P.x = nx;
    const nz = P.z + P.vz * h; if (collides(P.x, P.y, nz)) { P.vz = 0; bumped = true; } else P.z = nz;
    const ny = P.y + P.vy * h;
    if (collides(P.x, ny, P.z)) { if (P.vy < 0) { P.ground = true; P.y = Math.floor(ny + 1e-4) + 1; } P.vy = 0; }
    else { P.y = ny; if (P.vy !== 0) P.ground = false; }
  }
  if (swim && jump && bumped) P.vy = 8.5; // heave out of the water onto a ledge
  if (P.y < -10) send({ t: 'respawn' });
}
const lookDir = () => [-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch)];
function raycast(ox, oy, oz, dx, dy, dz, max) { // voxel walk (Amanatides & Woo)
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
  let tmx = dx > 0 ? (x + 1 - ox) * tdx : dx < 0 ? (ox - x) * tdx : Infinity;
  let tmy = dy > 0 ? (y + 1 - oy) * tdy : dy < 0 ? (oy - y) * tdy : Infinity;
  let tmz = dz > 0 ? (z + 1 - oz) * tdz : dz < 0 ? (oz - z) * tdz : Infinity;
  let t = 0, n = [0, 0, 0];
  while (t <= max) {
    const id = getBlock(x, y, z);
    if (id && id !== B.WATER) return { x, y, z, id, n, t };
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
const overlapsPlayer = (x, y, z) => P.x - W < x + 1 && P.x + W > x && P.z - W < z + 1 && P.z + W > z && P.y < y + 1 && P.y + H > y;
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
  if ([B.TABLE, B.CHEST, B.FURNACE].includes(t.id)) { send({ t: 'use', x: t.x, y: t.y, z: t.z, nx: t.n[0], ny: t.n[1], nz: t.n[2] }); return true; }
  if (!(it && it.block)) return false;
  const x = t.x + t.n[0], y = t.y + t.n[1], z = t.z + t.n[2], cur = getBlock(x, y, z);
  if (y < 0 || y >= CH || (cur && cur !== B.WATER) || overlapsPlayer(x, y, z)) return true;
  setBlock(x, y, z, it.block); startSwing(); lastPlace = now;
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
const sun = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ map: discTex((g) => { g.fillStyle = '#fff3a0'; g.fillRect(4, 4, 24, 24); g.fillStyle = '#ffd84a'; g.fillRect(8, 8, 16, 16); g.fillStyle = '#ffffff'; g.fillRect(12, 12, 8, 8); }), transparent: true, depthWrite: false, fog: false }));
const moon = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), new THREE.MeshBasicMaterial({ map: discTex((g) => { g.fillStyle = '#d9dde6'; g.fillRect(6, 6, 20, 20); g.fillStyle = '#b4bac6'; g.fillRect(10, 9, 5, 5); g.fillRect(17, 16, 6, 6); g.fillRect(9, 19, 4, 4); }), transparent: true, depthWrite: false, fog: false }));
sun.renderOrder = moon.renderOrder = -1; scene.add(sun, moon);
const starPos = new Float32Array(240 * 3);
for (let i = 0; i < 240; i++) { const a = Math.random() * 6.283, e = Math.random() * 1.4 - 0.2, r = 420; starPos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3); }
const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })); stars.frustumCulled = false; scene.add(stars);
function sky(inGame) {
  let t = 1, ang = 1.2;
  if (inGame) {
    const ph = ((((Date.now() + tOff - epoch) % dayMs) + dayMs) % dayMs) / dayMs; ang = ph * 6.2832;
    t = Math.min(1, Math.max(0, (Math.sin(ang) + 0.25) / 0.9));
  }
  scene.background.copy(NIGHT).lerp(DAY, t); scene.fog.color.copy(scene.background);
  const b = 0.3 + 0.7 * t; matO.color.setScalar(b); matT.color.setScalar(b);
  scene.fog.near = Math.max(8, cfg.dist * CS * 0.5); scene.fog.far = cfg.dist * CS * 0.95;
  const cp = camera.position, dx = Math.cos(ang), dy = Math.sin(ang);
  sun.position.set(cp.x + dx * 300, cp.y + dy * 300, cp.z + 90); sun.lookAt(cp);
  moon.position.set(cp.x - dx * 300, cp.y - dy * 300, cp.z - 90); moon.lookAt(cp);
  stars.position.set(cp.x, cp.y, cp.z); stars.material.opacity = Math.max(0, 0.9 - t * 1.6);
  if (inGame && getBlock(Math.floor(P.x), Math.floor(P.y + EYE), Math.floor(P.z)) === B.WATER) {
    scene.background.set(0x1f4fa8); scene.fog.color.set(0x1f4fa8); scene.fog.near = 0.5; scene.fog.far = 22;
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
  const model = makePlayer(p.color); model.g.add(labelSprite(p.name)); setEquipment(model, p.held || 0, p.arm || [0, 0, 0, 0]);
  model.g.position.set(p.x, p.y, p.z); scene.add(model.g);
  others.set(p.id, { id: p.id, name: p.name, model, x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0, tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw || 0, flash: 0, speed: 0 });
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
    Object.assign(o, { tx: x, ty: y, tz: z, tyaw: yaw, flags: fl, size: sz, fuse, hp });
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
    o.model.update({ speed: o.speed, flags: o.flags, size: o.size, fuse: o.fuse, t, dt, vy: o.vy });
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
    o.model.g.position.set(o.x, o.y, o.z); o.model.g.rotation.y = o.yaw + Math.PI;
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
    case 'eq': { const o = others.get(m.id); if (o) setEquipment(o.model, m.held, m.arm); break; }
    case 'ps': for (const [id, x, y, z, yaw] of m.s) { const o = others.get(id); if (o) { o.tx = x; o.ty = y; o.tz = z; o.tyaw = yaw; } } break;
    case 'ents': syncEnts(m); break;
    case 'blk': {
      const old = getBlock(m.x, m.y, m.z);
      setBlock(m.x, m.y, m.z, m.id);
      if (m.id === 0 && old > 0 && old !== B.WATER && old !== B.BEDROCK) fx.blockBreak(old, m.x, m.y, m.z, 14); // someone else's mining
      break;
    }
    case 'blks': for (let i = 0; i + 3 < m.b.length; i += 4) setBlock(m.b[i], m.b[i + 1], m.b[i + 2], m.b[i + 3]); break;
    case 'fx': onFx(m); break;
    case 'kb': P.vx += m.x; P.vy = Math.max(P.vy, m.y); P.vz += m.z; P.ground = false; break;
    case 'dead':
      dead = true; stopMining(); rightUp(); keys.clear(); ui.close(false); ui.showDead(m.m);
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
  if (m.k === 'hurt') {
    if (m.id === myId) { ui.flash(); } else { const o = others.get(m.id); if (o) o.flash = 0.25; }
  } else if (m.k === 'die') {
    const model = makeMob(m.ty, m.aux); model.g.position.set(m.x, m.y, m.z); model.g.rotation.y = m.yaw + Math.PI;
    if (m.ty === 10) model.update({ speed: 0, flags: 32, size: m.sz, t: 0, dt: 0, vy: 0 });
    scene.add(model.g); model.setFlash(true); ghosts.push({ model, t: 0, y: m.y });
    fx.burst(m.x, m.y + 0.5, m.z, [0.92, 0.92, 0.92], 12, 2.2, 0.12, 0.8);
  } else if (m.k === 'boom') fx.explosion(m.x, m.y, m.z);
}
let lastSend = 0, lastKey = '';
function netSend(now) {
  if (!joined || dead || now - lastSend < 50) return;
  const r = (v) => Math.round(v * 100) / 100, yaw = r(P.yaw % 6.2832), pitch = r(P.pitch), key = [r(P.x), r(P.y), r(P.z), yaw, pitch, P.sprint].join();
  if (key === lastKey && now - lastSend < 1000) return;
  lastKey = key; lastSend = now; send({ t: 'pos', x: r(P.x), y: r(P.y), z: r(P.z), yaw, pitch, sp: P.sprint });
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
  leaving = true; joined = false; state = 'menu'; dead = false;
  if (ws) { const s = ws; ws = null; s.close(); }
  if (document.pointerLockElement) document.exitPointerLock();
  ui.close(false); ui.hideDead(); stopMining(); eating = charging = null;
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
  if (e.code === 'Space') e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
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
  if (!locked) return;
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
  if (ready && joined && !dead) physics(dt);
  camera.position.set(P.x, P.y + EYE, P.z); camera.rotation.set(P.pitch, P.yaw, 0);
  const d = lookDir(), o = [P.x, P.y + EYE, P.z], bh = raycast(o[0], o[1], o[2], d[0], d[1], d[2], mode === 'creative' ? 7 : 5), eh = busyUI ? null : entityRay(o, d, 4.5);
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
  bobT += dt; held.g.visible = !dead && !ui.isOpen;
  held.update(dt, { swing, eating: !!eating, charge: charging ? Math.min(1, charging.t) : 0, moving: !!(keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyA') || keys.has('KeyD')) && P.ground });
  updateEnts(dt, now); fx.update(dt);
  sky(true); netSend(now);
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
  renderer.render(scene, camera);
}

$('name').value = store.get('name', '');
resetWorld(MENU_SEED);
menuMsg('Finding the game server…');
resolveServer().then((n) => { net = n; return pollHealth(); });
requestAnimationFrame(frame);
