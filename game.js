import * as THREE from 'three';
import { CS, CH, B, BLOCKS, HOTBAR, isSolid, idx, genChunk } from './shared/world.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('vr.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('vr.' + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const cfg = { dist: 5, fov: 75, sens: 1, ...store.get('cfg', {}) };
const MENU_SEED = 7, W = 0.3, H = 1.8, EYE = 1.62;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const keys = new Set(), others = new Map();
let state = 'menu', locked = false, chatOpen = false, leaving = false, joined = false, serverReady = false;
let mouseL = false, mouseR = false, lastAct = 0, sel = 0;
let net = null, ws = null, session = null, roomInfo = null, retry = 0;
let tOff = 0, epoch = 0, dayMs = 720000;
const P = { x: 0, y: 40, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, ground: false, fly: false };

/* ---------- renderer ---------- */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(cfg.fov, 1, 0.1, 500);
camera.rotation.order = 'YXZ';
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 30, 90);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

/* ---------- procedural texture atlas (no image files needed) ---------- */
const TILE = 16, COLS = 8, ROWS = 4, AW = TILE * COLS, AH = TILE * ROWS;
const atlas = document.createElement('canvas'); atlas.width = AW; atlas.height = AH;
(() => {
  const g = atlas.getContext('2d'); let s = 1337;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const px = (t, x, y, r, gr, b, a = 1) => { g.fillStyle = `rgba(${r | 0},${gr | 0},${b | 0},${a})`; g.fillRect((t % COLS) * TILE + x, ((t / COLS) | 0) * TILE + y, 1, 1); };
  const fill = (t, c, j) => { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) { const n = (rnd() - 0.5) * j; px(t, x, y, c[0] + n, c[1] + n, c[2] + n); } };
  const stone = [125, 125, 128], dirt = [121, 85, 58];
  fill(0, [88, 160, 62], 22);
  fill(1, dirt, 20); for (let x = 0; x < TILE; x++) for (let y = 0, h = 4 + ((rnd() * 2) | 0); y < h; y++) px(1, x, y, 88 + rnd() * 14, 160 + rnd() * 14, 62);
  fill(2, dirt, 20); fill(3, stone, 22); fill(4, [219, 207, 142], 14); fill(5, [48, 96, 205], 10);
  fill(6, [104, 82, 50], 14); for (let x = 0; x < TILE; x += 4) for (let y = 0; y < TILE; y++) px(6, x, y, 80, 62, 36);
  fill(7, [162, 132, 84], 12);
  for (const r of [3, 6]) for (let t = r; t < TILE - r; t++) { px(7, t, r, 120, 92, 56); px(7, t, TILE - 1 - r, 120, 92, 56); px(7, r, t, 120, 92, 56); px(7, TILE - 1 - r, t, 120, 92, 56); }
  fill(8, [50, 118, 38], 40); fill(9, [244, 248, 250], 8);
  fill(10, [168, 132, 82], 12); for (let y = 3; y < TILE; y += 4) for (let x = 0; x < TILE; x++) px(10, x, y, 120, 90, 52);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(11, x, y, 210, 235, 255, x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1 ? 0.9 : 0.18);
  fill(12, [150, 72, 60], 14);
  for (let y = 0; y < TILE; y += 4) {
    for (let x = 0; x < TILE; x++) px(12, x, y, 200, 190, 180);
    for (let x = ((y / 4) % 2) * 4 + 2; x < TILE; x += 8) for (let k = 1; k < 4; k++) px(12, x, y + k, 200, 190, 180);
  }
  fill(13, [52, 52, 56], 50);
  const ore = (t, c) => { fill(t, stone, 22); for (let n = 0; n < 14; n++) { const x = (rnd() * 14) | 0, y = (rnd() * 14) | 0; for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) px(t, x + dx, y + dy, c[0], c[1], c[2]); } };
  ore(14, [30, 30, 32]); ore(15, [214, 168, 130]); ore(16, [250, 214, 60]);
})();
const tex = new THREE.CanvasTexture(atlas);
tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
const matO = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });
const matT = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false });
const UV = [];
for (let t = 0; t < COLS * ROWS; t++) {
  const c = t % COLS, r = (t / COLS) | 0, e = 0.05;
  UV.push([(c * TILE + e) / AW, 1 - ((r + 1) * TILE - e) / AH, ((c + 1) * TILE - e) / AW, 1 - (r * TILE + e) / AH]);
}

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
function resetWorld(seed) {
  for (const k of [...meshes.keys()]) dropMesh(k);
  chunks.clear(); editsByChunk.clear(); dirty.clear(); wantKey = ''; worldSeed = seed;
  for (const id of [...others.keys()]) removeOther(id);
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
function buildMesh(cx, cz) {
  const k = ck(cx, cz), d = chunks.get(k), ox = cx * CS, oz = cz * CS;
  const nb = [chunks.get(ck(cx + 1, cz)), chunks.get(ck(cx - 1, cz)), chunks.get(ck(cx, cz + 1)), chunks.get(ck(cx, cz - 1))];
  const O = { p: [], u: [], c: [], i: [] }, T = { p: [], u: [], c: [], i: [] };
  for (let y = 0; y < CH; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const id = d[x + CS * (z + CS * y)];
    if (!id) continue;
    const def = BLOCKS[id], out = def.tr ? T : O;
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
      const uv = UV[def.t[F.k]], base = out.p.length / 3;
      for (const q of F.v) { out.p.push(ox + x + q[0], y + q[1], oz + z + q[2]); out.c.push(F.s, F.s, F.s); }
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
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  let wx = -sy * fwd + cy * side, wz = -cy * fwd - sy * side;
  const len = Math.hypot(wx, wz); if (len > 1) { wx /= len; wz /= len; }
  const swim = getBlock(Math.floor(P.x), Math.floor(P.y + 0.2), Math.floor(P.z)) === B.WATER;
  const speed = P.fly ? 11 : swim ? 3 : shift ? 7 : 4.6;
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
    if (id && id !== B.WATER) return { x, y, z, id, n };
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; n = [-sx, 0, 0]; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; n = [0, -sy, 0]; }
    else { z += sz; t = tmz; tmz += tdz; n = [0, 0, -sz]; }
  }
  return null;
}
const overlapsPlayer = (x, y, z) => P.x - W < x + 1 && P.x + W > x && P.z - W < z + 1 && P.z + W > z && P.y < y + 1 && P.y + H > y;
function act(place) {
  if (!joined) return;
  const d = lookDir(), hit = raycast(P.x, P.y + EYE, P.z, d[0], d[1], d[2], 6);
  if (!hit) return;
  if (!place) {
    if (hit.id === B.BEDROCK) return;
    setBlock(hit.x, hit.y, hit.z, 0); send({ t: 'blk', x: hit.x, y: hit.y, z: hit.z, id: 0 });
  } else {
    const x = hit.x + hit.n[0], y = hit.y + hit.n[1], z = hit.z + hit.n[2], cur = getBlock(x, y, z), id = HOTBAR[sel];
    if (y < 0 || y >= CH || (cur && cur !== B.WATER) || overlapsPlayer(x, y, z)) return;
    setBlock(x, y, z, id); send({ t: 'blk', x, y, z, id }); // predicted locally; the server may revert it
  }
}
const hl = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x000000 }));
hl.visible = false; scene.add(hl);

/* ---------- sky and day/night (shared clock from the server) ---------- */
const NIGHT = new THREE.Color(0x0a1030), DAY = new THREE.Color(0x87ceeb);
function sky(inGame) {
  let t = 1;
  if (inGame) {
    const ph = ((((Date.now() + tOff - epoch) % dayMs) + dayMs) % dayMs) / dayMs;
    t = Math.min(1, Math.max(0, (Math.sin(ph * 6.2832) + 0.25) / 0.9));
  }
  scene.background.copy(NIGHT).lerp(DAY, t); scene.fog.color.copy(scene.background);
  const b = 0.3 + 0.7 * t; matO.color.setScalar(b); matT.color.setScalar(b);
  scene.fog.near = Math.max(8, cfg.dist * CS * 0.5); scene.fog.far = cfg.dist * CS * 0.95;
  if (inGame && getBlock(Math.floor(P.x), Math.floor(P.y + EYE), Math.floor(P.z)) === B.WATER) {
    scene.background.set(0x1f4fa8); scene.fog.color.set(0x1f4fa8); scene.fog.near = 0.5; scene.fog.far = 22;
  }
}

/* ---------- other players ---------- */
function addOther(p) {
  removeOther(p.id);
  const g = new THREE.Group();
  const part = (w, h, d, y, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c })); m.position.y = y; g.add(m); };
  part(0.5, 0.7, 0.3, 0.35, 0x2f3b52); part(0.5, 0.7, 0.3, 1.05, p.color); part(0.45, 0.45, 0.45, 1.625, 0xe8c39e);
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d'); x.font = 'bold 30px sans-serif'; x.textAlign = 'center';
  x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 10, 256, 44); x.fillStyle = '#fff'; x.fillText(p.name, 128, 44, 240);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: false }));
  label.scale.set(2, 0.5, 1); label.position.y = 2.25; g.add(label);
  g.position.set(p.x, p.y, p.z); scene.add(g);
  others.set(p.id, { id: p.id, name: p.name, g, x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0, tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw || 0 });
  renderPlayers();
}
function removeOther(id) {
  const o = others.get(id); if (!o) return;
  scene.remove(o.g);
  o.g.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.material) { if (n.material.map) n.material.map.dispose(); n.material.dispose(); } });
  others.delete(id); renderPlayers();
}
function renderPlayers() {
  const names = [session ? session.name : 'You', ...[...others.values()].map((o) => o.name)];
  $('plist').textContent = `Players (${names.length})\n` + names.join('\n');
}

/* ---------- networking ---------- */
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
function setConn(t, ok) { const e = $('conn'); e.textContent = t; e.className = ok ? '' : 'bad'; }
function openSocket() {
  const sock = new WebSocket(net.ws + '/ws'); ws = sock; setConn('Connecting…', false);
  sock.onopen = () => send({ t: 'join', name: session.name, room: session.room, create: session.create, roomName: session.roomName, seed: session.seed, token: store.get('token', null) });
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
      resetWorld(m.room.seed); store.set('token', m.token); retry = 0;
      roomInfo = m.room; session.room = m.room.id; session.create = false;
      tOff = m.now - Date.now(); epoch = m.epoch; dayMs = m.dayMs;
      for (let i = 0; i + 3 < m.edits.length; i += 4) setBlock(m.edits[i], m.edits[i + 1], m.edits[i + 2], m.edits[i + 3]);
      Object.assign(P, { x: m.me.x, y: m.me.y, z: m.me.z, yaw: m.me.yaw || 0, pitch: m.me.pitch || 0, vx: 0, vy: 0, vz: 0 });
      for (const p of m.players) addOther(p);
      joined = true; setConn('Online', true); $('save').textContent = ''; renderPlayers(); enterGame();
      break;
    }
    case 'pj': addOther(m.p); break;
    case 'pl': removeOther(m.id); break;
    case 'ps': for (const [id, x, y, z, yaw] of m.s) { const o = others.get(id); if (o) { o.tx = x; o.ty = y; o.tz = z; o.tyaw = yaw; } } break;
    case 'blk': setBlock(m.x, m.y, m.z, m.id); break;
    case 'chat': addChat(m); break;
    case 'fix': P.x = m.x; P.y = m.y; P.z = m.z; P.vx = P.vy = P.vz = 0; break;
    case 'save': $('save').textContent = m.ok ? 'World saved' : 'Could not save, retrying…'; $('save').className = m.ok ? '' : 'bad'; break;
    case 'err': if (m.fatal) leaveToMenu(m.m); else addChat({ sys: 1, m: m.m }); break;
  }
}
let lastSend = 0, lastKey = '';
function netSend(now) {
  if (!joined || now - lastSend < 50) return;
  const r = (v) => Math.round(v * 100) / 100, yaw = r(P.yaw % 6.2832), pitch = r(P.pitch), key = [r(P.x), r(P.y), r(P.z), yaw, pitch].join();
  if (key === lastKey && now - lastSend < 1000) return;
  lastKey = key; lastSend = now; send({ t: 'pos', x: r(P.x), y: r(P.y), z: r(P.z), yaw, pitch });
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
  $('pSub').textContent = roomInfo.owner ? 'You own this world. Type /help in chat for moderation commands.' : 'Press Play, then click the screen to look around.';
  $('resume').textContent = 'Play';
}
function leaveToMenu(msg) {
  leaving = true; joined = false; state = 'menu';
  if (ws) { const s = ws; ws = null; s.close(); }
  if (document.pointerLockElement) document.exitPointerLock();
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
function buildHotbar() {
  const bar = $('bar'); bar.textContent = '';
  HOTBAR.forEach((id, i) => {
    const s = document.createElement('div'); s.className = 'slot'; s.title = BLOCKS[id].n;
    const c = document.createElement('canvas'); c.width = c.height = TILE;
    const t = BLOCKS[id].t[2]; c.getContext('2d').drawImage(atlas, (t % COLS) * TILE, ((t / COLS) | 0) * TILE, TILE, TILE, 0, 0, TILE, TILE);
    const n = document.createElement('i'); n.textContent = i + 1;
    s.append(c, n); bar.append(s);
  });
}
function selectSlot(i) {
  sel = ((i % 9) + 9) % 9;
  [...$('bar').children].forEach((el, j) => el.classList.toggle('on', j === sel));
  $('selname').textContent = BLOCKS[HOTBAR[sel]].n;
}
function openChat() { chatOpen = true; document.exitPointerLock(); const i = $('chatIn'); i.hidden = false; i.value = ''; i.focus(); }
function closeChat(sendIt) {
  const i = $('chatIn'), v = i.value.trim();
  if (sendIt && v) send({ t: 'chat', m: v });
  i.value = ''; i.hidden = true; i.blur(); chatOpen = false; lock();
}

$('play').onclick = () => start({ room: 'PUBLIC' });
$('join').onclick = () => {
  const code = $('code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(code)) return menuMsg('Enter the world code: letters and numbers only.');
  start({ room: code });
};
$('create').onclick = () => start({ create: true, roomName: $('wname').value.trim(), seed: $('seed').value.trim() });
$('resume').onclick = lock;
$('leave').onclick = () => leaveToMenu('');
$('copy').onclick = () => { try { navigator.clipboard.writeText(roomInfo.id); $('copy').textContent = 'Copied'; setTimeout(() => ($('copy').textContent = 'Copy'), 1500); } catch { /* clipboard blocked */ } };
for (const [id, key] of [['sDist', 'dist'], ['sFov', 'fov'], ['sSens', 'sens']]) {
  $(id).value = cfg[key];
  $(id).oninput = () => { cfg[key] = +$(id).value; store.set('cfg', cfg); if (key === 'fov') { camera.fov = cfg.fov; camera.updateProjectionMatrix(); } };
}
canvas.addEventListener('click', () => { if (state === 'play' && !locked && !chatOpen) lock(); });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) { keys.clear(); mouseL = mouseR = false; }
  if (state === 'play') { $('pause').hidden = locked || chatOpen; if (!locked && !chatOpen) $('resume').textContent = 'Resume'; }
});
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) {
    if (e.target.id === 'chatIn') { if (e.key === 'Enter') closeChat(true); else if (e.key === 'Escape') closeChat(false); }
    return;
  }
  if (state !== 'play' || !locked) return;
  if (e.code === 'Space') e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'Enter') { e.preventDefault(); openChat(); }
  else if (e.code === 'KeyF') { P.fly = !P.fly; P.vy = 0; }
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
  if (e.button === 0) { mouseL = true; act(false); lastAct = performance.now(); }
  if (e.button === 2) { mouseR = true; act(true); lastAct = performance.now(); }
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (locked) selectSlot(sel + (e.deltaY > 0 ? 1 : -1)); }, { passive: true });

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
let last = performance.now(), infoAt = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (state === 'play') {
    const ready = chunksReady();
    streamChunks(P.x, P.z, ready ? 6 : 40);
    if (ready && joined) physics(dt);
    camera.position.set(P.x, P.y + EYE, P.z); camera.rotation.set(P.pitch, P.yaw, 0);
    const d = lookDir(), hit = raycast(P.x, P.y + EYE, P.z, d[0], d[1], d[2], 6);
    if (hit) { hl.visible = true; hl.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5); } else hl.visible = false;
    if (locked && (mouseL || mouseR) && now - lastAct > 220) { act(mouseR); lastAct = now; }
    const k = Math.min(1, dt * 14);
    for (const o of others.values()) {
      o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; o.z += (o.tz - o.z) * k;
      const dy = o.tyaw - o.yaw; o.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * k;
      o.g.position.set(o.x, o.y, o.z); o.g.rotation.y = o.yaw;
    }
    sky(true); netSend(now);
    if (now - infoAt > 250) { infoAt = now; $('pos').textContent = `${P.x.toFixed(1)}, ${P.y.toFixed(1)}, ${P.z.toFixed(1)}${P.fly ? ' (flying)' : ''}`; }
  } else {
    const a = still ? 0.8 : now / 22000; // title screen: slow flyover of a generated world
    camera.position.set(Math.cos(a) * 44, 38, Math.sin(a) * 44); camera.lookAt(0, 22, 0);
    streamChunks(camera.position.x, camera.position.z, 10); sky(false); hl.visible = false;
  }
  renderer.render(scene, camera);
}

$('name').value = store.get('name', '');
buildHotbar(); selectSlot(0); resetWorld(MENU_SEED);
menuMsg('Finding the game server…');
resolveServer().then((n) => { net = n; return pollHealth(); });
requestAnimationFrame(frame);
