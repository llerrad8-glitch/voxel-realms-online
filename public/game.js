import * as THREE from 'three';
import { CS, CH, B, BLOCKS, isSolid, isWater, isLava, lavaAmount, LAVA_FALL, isTorch, isBed, isDoor, doorUpper, doorOpen, doorDir, DOOR_OPEN_SIDE, DOOR_T, torchFor, DIR4, BED_H, blockHeight, waterAmount, WATER_FALL, flowDir, idx, genChunk, column, normGen, isLayer, layerKind, layerN, layerFull, isPlant, biomeAt, deepLine, bedDir, bedIsHead, biomeKind, BIOME_NAMES } from './shared/world.js';
import { itemInfo, breakTime, attackCooldown, I } from './shared/items.js';
const LEAF = (v) => v === B.LEAVES || v === B.SPRUCE_LEAVES || v === B.BIRCH_LEAVES; // leaves of either tree let light through
import { MOB_TYPES, mobDims } from './shared/mobs.js';
import { UV, PACK, atlas, waterStrip, WATER_FRAMES, flowStrip, FLOW_FRAMES, FLOW_DIR, lavaStrip, LAVA_FRAMES } from './icons.js';
import { createPool } from './chunkpool.js';
import { atlasTex, makeMob, makeBoat, makePlayer, setEquipment, itemMesh, arrowMesh, HeldView } from './models.js';
import { Particles, Cracks } from './fx.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';
import { Borders } from './borders.js';
import { Weather } from './weather.js';
import { createSaves } from './saves.js';
import { createGameSaves } from './gamesave.js';
import { createFishing } from './fishing.js';
import { createSaveGate } from './savegate.js';
import { createReminder } from './reminder.js';
import { createAutosave } from './autosave.js';
import { createTouch } from './touch.js';

const $ = (id) => document.getElementById(id);
const atkBar = $('atkbar'), atkFill = $('atkfill');
const store = {
  get(k, d) { try { const v = localStorage.getItem('vr.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('vr.' + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const cfg = { dist: 8, fov: 75, sens: 1, ...store.get('cfg', {}) };
const MENU_SEED = 7, W = 0.3, H = 1.8, EYE = 1.62;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const boats = new Map(); // boats in the world, and the one you are sitting in (riding), which your own game steers
let riding = null, BP = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, vy: 0 }, rideAt = 0;
const keys = new Set(), others = new Map(), mobs = new Map(), drops = new Map(), arrows = new Map(), fallers = new Map(), ghosts = [];
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
const camera = new THREE.PerspectiveCamera(cfg.fov, 1, 0.04, 600);
camera.rotation.order = 'YXZ';
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 30, 90);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
// World materials: vertex colours carry (sky light, torch light); the shader mixes them with the time of day, so nights and caves are properly dark
// while torches and lava keep glowing.
const LIGHT_U = { uSkyMul: { value: new THREE.Vector3(1, 1, 1) } };
function lightMat(m) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSkyMul = LIGHT_U.uSkyMul;
    sh.fragmentShader = 'uniform vec3 uSkyMul;\n' + sh.fragmentShader.replace('#include <color_fragment>',
      `#ifdef USE_COLOR
        vec3 skyC = vec3(vColor.r) * uSkyMul;
        vec3 blkC = vec3(vColor.g, vColor.g * 0.8, vColor.g * 0.5);
        diffuseColor.rgb *= clamp(skyC + blkC - skyC * blkC, 0.0, 1.0);
      #endif`);
  };
  m.customProgramCacheKey = () => 'vr-light';
  return m;
}
const matO = lightMat(new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true }));
const matP = lightMat(new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide })); // dead bushes: transparent pixels are cut out
const matT = lightMat(new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false }));
// Water scrolls through a strip of animation frames (the real water texture when a pack is installed).
const waterTex = new THREE.CanvasTexture(waterStrip);
waterTex.magFilter = waterTex.minFilter = THREE.NearestFilter; waterTex.generateMipmaps = false; waterTex.colorSpace = THREE.SRGBColorSpace; waterTex.repeat.set(1, 1 / WATER_FRAMES);
const matW = lightMat(new THREE.MeshBasicMaterial({ map: waterTex, vertexColors: true, transparent: true, opacity: 0.74, depthWrite: false, side: THREE.DoubleSide }));
// Flowing water (slopes and waterfalls) uses the separate, larger flowing-water animation; still water keeps the calm one.
const flowTex = new THREE.CanvasTexture(flowStrip);
flowTex.magFilter = flowTex.minFilter = THREE.NearestFilter; flowTex.generateMipmaps = false; flowTex.colorSpace = THREE.SRGBColorSpace; flowTex.repeat.set(1, 1 / FLOW_FRAMES);
const matF = lightMat(new THREE.MeshBasicMaterial({ map: flowTex, vertexColors: true, transparent: true, opacity: 0.74, depthWrite: false, side: THREE.DoubleSide }));
// Lava glows: an opaque animated strip that ignores the time of day (fog still hides it at a distance).
const lavaTex = new THREE.CanvasTexture(lavaStrip);
lavaTex.magFilter = lavaTex.minFilter = THREE.NearestFilter; lavaTex.generateMipmaps = false; lavaTex.colorSpace = THREE.SRGBColorSpace; lavaTex.repeat.set(1, 1 / LAVA_FRAMES);
const matL = new THREE.MeshBasicMaterial({ map: lavaTex, side: THREE.DoubleSide });
try { // menus get the dirt texture, like the real game
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(atlas, 32, 0, 16, 16, 0, 0, 64, 64);
  document.documentElement.style.setProperty('--dirt', `url(${c.toDataURL()})`);
} catch { /* canvas blocked: plain panels */ }
const fx = new Particles(scene), cracks = new Cracks(scene), held = new HeldView(camera, scene);
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const ui = createUI({ send });
const audio = createAudio(); // sunset music + creature sounds (audio.js)
const fishing = createFishing(scene); // fishing hooks and lines (fishing.js)
const borders = new Borders(scene); // outlines of protected chunks
const weather = new Weather(scene); // rain, snow and sand in the air
let hintAt = 0, outsideAt = 0, outside = true, underground = false;
let wxRain = false, wxSand = false, wxK = 0, sandK = 0, wxKind = 1, biomeNow = 0, biomeAt0 = 0, biomeName = ''; // weather: rain / sandstorm switched on by the server (separate), how strongly rain or snow shows here (wxK, 0 to 1) and which kind (1 rain, 2 snow), how strongly the sandstorm shows (sandK), and the biome under you
const saves = createSaves({
  send, store, lock: () => lock(), onClaims: (list) => borders.set(list), join: (room) => start({ room }),
  say: (m) => addChat({ sys: 1, m }), api: (path) => fetch(net.http + path, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
});
const hint = (m) => { const t = performance.now(); if (t - hintAt > 1500) { hintAt = t; addChat({ sys: 1, m }); } };
const protectedMsg = (c) => `This chunk is protected by ${c.owner}'s Chunk Saver: you cannot build, break or open things here.`;

/* ---------- world storage + chunk meshing ---------- */
let worldSeed = MENU_SEED, worldGen = 2, wantKey = '', want = []; // the title screen flies over the new terrain
const chunks = new Map(), meshes = new Map(), editsByChunk = new Map(), dirty = new Map(); // dirty: chunk key -> [cx, cz, hot] for chunks whose mesh has to be (re)built; hot = a block was just changed there
const ck = (cx, cz) => cx + ',' + cz;
const TR = BLOCKS.map((b) => !!(b && b.tr));
// Torch light. Each chunk that has a torch within reach gets a small light map: a flood fill from every torch (14 at the torch, one less per block,
// stopped by solid blocks), so a torch lights its room and not the room next door. Chunks with no torch nearby skip all of this.
const torchChunks = new Map(), LW = 44, LM = 14;
const isLightId = (v) => (v >= 31 && v <= 35) || (v >= 45 && v <= 49); // torches and lava
const countTorches = (d) => { let n = 0; for (let i = 0; i < d.length; i++) if (isLightId(d[i])) n++; return n; };
const torchNear = (cx, cz) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (torchChunks.get(ck(cx + a, cz + b))) return true; return false; };
let lcX = NaN, lcZ = NaN, lcC = null; // the chunk looked up last: most reads (physics, rays) stay in one chunk, so most skip the map
function getBlock(x, y, z) {
  if (y < 0) return B.BEDROCK;
  if (y >= CH) return 0;
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
  let c;
  if (cx === lcX && cz === lcZ) c = lcC; else { c = chunks.get(ck(cx, cz)); lcX = cx; lcZ = cz; lcC = c; }
  if (!c) return B.BEDROCK; // unloaded counts as solid, so nobody falls out of the world
  const v = c[idx(x - cx * CS, y, z - cz * CS)];
  return v === undefined ? 0 : v; // (chunks are kept only as tall as they need to be: above that it is air)
}
const markDirty = (cx, cz, hot) => { const k = ck(cx, cz), e = dirty.get(k); if (e) { if (hot) e[2] = 1; } else if (chunks.has(k)) dirty.set(k, [cx, cz, hot ? 1 : 0]); };
function growChunk(k, c, y) { const n = new Uint8Array(Math.min(CH, y + 9) * CS * CS); n.set(c); chunks.set(k, n); lcC = null; lcX = NaN; return n; }
function setBlock(x, y, z, id) {
  if (y < 0 || y >= CH) return;
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS), k = ck(cx, cz), lx = x - cx * CS, lz = z - cz * CS, i = idx(lx, y, lz);
  let e = editsByChunk.get(k); if (!e) editsByChunk.set(k, (e = new Map()));
  e.set(i, id); // remembered so the edit survives the chunk being unloaded and regenerated
  let c = chunks.get(k); if (!c) return;
  if (i >= c.length) { if (!id) return; c = growChunk(k, c, y); } // (air above the top of a trimmed chunk is already what it says)
  const old = c[i]; c[i] = id; markDirty(cx, cz, 1); topCache.delete(c);
  const t0 = isLightId(old), t1 = isLightId(id);
  if (t0 || t1) torchChunks.set(k, (torchChunks.get(k) || 0) + (t1 ? 1 : 0) - (t0 ? 1 : 0));
  if (t0 || t1 || torchNear(cx, cz)) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) markDirty(cx + a, cz + b, 1); // light reaches 14 blocks
  if ((old === 0 || TR[old] || LEAF(old)) !== (id === 0 || TR[id] || LEAF(id)) && !(t0 || t1 || torchNear(cx, cz))) { // opacity changed: sky light may spread differently, up to 14 blocks away
    let ty = CH - 1; for (; ty > y; ty--) { const v = c[idx(lx, ty, lz)]; if (v && !TR[v] && !LEAF(v)) break; }
    if (ty <= y) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) markDirty(cx + a, cz + b, 1); // it is (or was) the top of its column
  }
  if (lx === 0) markDirty(cx - 1, cz, 1); if (lx === CS - 1) markDirty(cx + 1, cz, 1);
  if (lz === 0) markDirty(cx, cz - 1, 1); if (lz === CS - 1) markDirty(cx, cz + 1, 1);
}
function dropMesh(k) {
  const m = meshes.get(k); if (!m) return;
  for (const o of [m.o, m.t, m.w, m.f, m.l, m.p]) if (o) { scene.remove(o); o.geometry.dispose(); }
  meshes.delete(k);
}
function disposeModel(g) {
  scene.remove(g); g.traverse((n) => { if (n.geometry) n.geometry.dispose(); });
  if (g.userData.shadow) { scene.remove(g.userData.shadow); g.userData.shadow.material.dispose(); }
  for (const m of g.userData.litMats || []) m.dispose();
}
// Creatures and other players are lit like the world around them: dimmer at night, in the shade of a roof and in caves, and brighter next to a torch or lava.
// Each model gets its own copies of its materials (the originals are shared), whose colour is scaled by the light at its feet. A soft blob shadow sits on the ground below.
const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(0,0,0,0.62)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.38)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shadowMat0 = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const SKY_COLS = [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]];
function lightModel(model, f) {
  const g = model.g, lit = (g.userData.litMats ||= []);
  if (!model.lit) {
    model.lit = true;
    for (const p of model.parts) {
      const src = p.userData.mats, arr = Array.isArray(src) ? src : [src], cl = arr.map((m) => { const c = m.clone(); c.userData.base = c.color.clone(); lit.push(c); return c; });
      p.userData.mats = Array.isArray(src) ? cl : cl[0]; p.material = model.flash && p.userData.red ? p.material : p.userData.mats;
    }
  }
  for (const p of model.parts) {
    const red = p.userData.red;
    if (red) for (const m of red) if (!m.userData.base) { m.userData.base = m.color.clone(); lit.push(m); model.lf = -1; }
  }
  if (Math.abs((model.lf === undefined ? -1 : model.lf) - f) < 0.012) return;
  model.lf = f;
  for (const p of model.parts) for (const m of [].concat(p.userData.mats, p.userData.red || [])) if (m.userData.base) m.color.copy(m.userData.base).multiplyScalar(f);
}
function entLit(o, dims, dt) {
  o.lt = (o.lt || 0) - dt;
  if (o.lt <= 0) { // look around a few times a second, not every frame
    o.lt = 0.25 + Math.random() * 0.15;
    const bx = Math.floor(o.x), by = Math.floor(o.y + 0.9), bz = Math.floor(o.z); let open = 0, bl = 0;
    for (const [a, b] of SKY_COLS) { let c = 1; for (let yy = by + 1; yy < Math.min(CH, by + 24); yy++) { const id = getBlock(bx + a, yy, bz + b); if (id && !TR[id]) { c = 0; break; } } open += c; }
    for (let dy = -3; dy <= 3; dy++) for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) { const id = getBlock(bx + dx, by + dy, bz + dz); if (isLightId(id)) bl = Math.max(bl, 14 - Math.abs(dx) - Math.abs(dy) - Math.abs(dz)); }
    o.ls = open / 5; o.lb = bl;
  }
  const lum = Math.max(skyFactor(o.ls >= 0.99 ? 15 : o.ls > 0.1 ? 8 + o.ls * 6 : 0) * LIGHT_U.uSkyMul.value.x, blockFactor(o.lb || 0)), f = 0.2 + 0.8 * Math.min(1, lum);
  o.lv = o.lv === undefined ? f : o.lv + (f - o.lv) * Math.min(1, dt * 6);
  lightModel(o.model, o.lv);
  // blob shadow on the ground below (fainter the higher the creature is)
  const g = o.model.g; let sh = g.userData.shadow;
  if (!sh) { sh = g.userData.shadow = new THREE.Mesh(shadowGeo, shadowMat0.clone()); sh.renderOrder = 2; scene.add(sh); }
  let gy = null; const cy = Math.floor(o.y + 0.3);
  for (let yy = cy; yy > cy - 6 && yy >= 0; yy--) { const id = getBlock(Math.floor(o.x), yy, Math.floor(o.z)); if (isWater(id) || isLava(id)) break; if (isSolid(id)) { gy = yy + blockHeight(id); break; } }
  const hgt = gy === null ? 9 : o.y - gy;
  if (hgt > 4.5 || hgt < -0.3) sh.visible = false;
  else { sh.visible = true; sh.position.set(o.x, gy + 0.02, o.z); const sc = (dims.w * 1.5 + 0.35) * (1 - hgt * 0.1); sh.scale.set(sc, 1, sc); sh.material.opacity = (1 - hgt / 4.5) * (0.35 + 0.65 * Math.min(1, lum + 0.1)); }
}
function clearEntities() {
  for (const o of mobs.values()) disposeModel(o.model.g);
  for (const o of drops.values()) scene.remove(o.mesh);
  for (const o of arrows.values()) disposeModel(o.mesh);
  for (const o of fallers.values()) scene.remove(o.mesh);
  for (const o of ghosts) disposeModel(o.model.g);
  for (const o of boats.values()) disposeModel(o.model.g);
  boats.clear(); riding = null;
  mobs.clear(); drops.clear(); arrows.clear(); fallers.clear(); ghosts.length = 0;
}
function resetWorld(seed, gen = 1) {
  for (const k of [...meshes.keys()]) dropMesh(k);
  chunks.clear(); editsByChunk.clear(); dirty.clear(); wantKey = ''; worldSeed = seed; worldGen = gen;
  req.clear(); meshBusy.clear(); inbox.length = 0; pool.reset(); lcC = null; lcX = NaN;
  for (const id of [...others.keys()]) removeOther(id);
  clearEntities(); cracks.hide(); fishing.clear();
}

const waterTop = (id) => (id === WATER_FALL ? 1 : waterAmount(id) / 9); // height of a water block's surface: a source is 8/9, thin flow 1/9
const skyFactor = (s) => (s >= 15 ? 1 : 0.004 + 0.996 * Math.pow(0.72, 15 - s)); // brightness for a sky light level: the dark end is nearly black (the same curve the mesher bakes into vertex colours)
const blockFactor = (l) => (l <= 0 ? 0 : Math.min(1, Math.pow(l / 14, 1.8) * 1.12)); // brightness for a torch/lava light level
const topCache = new WeakMap(); // chunk data -> the highest light-blocking block of each column (cleared when the chunk is edited)

// Chunks are made and meshed by a pool of web workers (chunkpool.js); this side only decides what is wanted, nearest first, and builds the finished geometry.
// A chunk is meshed once it and its four neighbours exist. Far chunks get a simpler mesh (no grass, flat lighting) that is swapped for the full one as you come close.
let genCur = 0, jobId = 0, camFar = 0;
const req = new Set(), meshBusy = new Set(), inbox = [];
const pool = createPool((m) => inbox.push(m), () => { req.clear(); meshBusy.clear(); inbox.length = 0; wantKey = ''; });
pool.init(UV, FLOW_DIR);
const lodWant = (d2, cur) => (d2 > 64 ? 1 : d2 <= 49 ? 0 : cur); // (more than 8 chunks away: simple; closer than 7: full; in between keeps what it has)
const chunkReady = (cx, cz) => chunks.has(ck(cx, cz)) && chunks.has(ck(cx + 1, cz)) && chunks.has(ck(cx - 1, cz)) && chunks.has(ck(cx, cz + 1)) && chunks.has(ck(cx, cz - 1));
function makeMeshes(parts) {
  const out = { lod: parts.lod };
  for (const [key, mat, order] of [['o', matO, 0], ['t', matT, 1], ['w', matW, 2], ['f', matF, 2], ['l', matL, 0], ['p', matP, 0]]) {
    const q = parts[key]; if (!q) continue;
    const g = new THREE.BufferGeometry(), at = [new THREE.BufferAttribute(q.p, 3), new THREE.BufferAttribute(q.u, 2), new THREE.BufferAttribute(q.c, 3), new THREE.BufferAttribute(q.i, 1)];
    for (const a of at) a.onUploadCallback = () => { a.array = null; }; // the copy in memory is not needed once the graphics card has it
    g.setAttribute('position', at[0]); g.setAttribute('uv', at[1]); g.setAttribute('color', at[2]); g.setIndex(at[3]);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(...q.min), new THREE.Vector3(...q.max)); g.boundingSphere = new THREE.Sphere(); g.boundingBox.getBoundingSphere(g.boundingSphere);
    const m = new THREE.Mesh(g, mat); m.renderOrder = order; m.matrixAutoUpdate = false; scene.add(m); out[key] = m;
  }
  return out;
}
function takeResult(m, pcx, pcz, R) {
  const k = ck(m.cx, m.cz), d2 = (m.cx - pcx) ** 2 + (m.cz - pcz) ** 2;
  if (m.t === 'gen') {
    if (d2 > (R + 3) ** 2) { req.delete(k); return; } // the player moved on while it was being made
    const d = m.d, e = editsByChunk.get(k);
    let c = d;
    if (e) for (const [i, id] of e) { if (i >= c.length) { if (!id) continue; const n = new Uint8Array(Math.min(CH, Math.floor(i / (CS * CS)) + 9) * CS * CS); n.set(c); c = n; } c[i] = id; }
    chunks.set(k, c); lcC = null; lcX = NaN;
    const nt = countTorches(c);
    if (nt) { torchChunks.set(k, nt); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (a || b) markDirty(m.cx + a, m.cz + b, 0); }
    for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { // this chunk may have been the last one a neighbour (or itself) was waiting for
      const nx = m.cx + a, nz = m.cz + b, q = (nx - pcx) ** 2 + (nz - pcz) ** 2;
      if (q <= R * R && !meshes.has(ck(nx, nz)) && chunkReady(nx, nz)) markDirty(nx, nz, 0);
    }
    return;
  }
  meshBusy.delete(k);
  if (!chunks.has(k)) return;
  dropMesh(k); meshes.set(k, makeMeshes(m.parts));
}
function streamChunks(px, pz, budget) {
  const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS), R = cfg.dist, key = pcx + ',' + pcz + ',' + R;
  if (key !== wantKey) {
    wantKey = key; want = []; genCur = 0;
    for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 <= (R + 1) * (R + 1)) want.push([pcx + dx, pcz + dz, d2]);
    }
    want.sort((a, b) => a[2] - b[2]);
    for (const k of [...chunks.keys()]) {
      const [x, z] = k.split(',').map(Number);
      if ((x - pcx) ** 2 + (z - pcz) ** 2 > (R + 3) ** 2) { chunks.delete(k); torchChunks.delete(k); dropMesh(k); dirty.delete(k); req.delete(k); }
    }
    lcC = null; lcX = NaN;
    for (const [cx, cz, d2] of want) { // chunks that came into range, or into the near (full detail) or far (simple) zone, need a mesh
      if (d2 > R * R) break;
      const m = meshes.get(ck(cx, cz));
      if ((!m || lodWant(d2, m.lod) !== m.lod) && chunkReady(cx, cz)) markDirty(cx, cz, 0);
    }
    const far = Math.max(600, R * CS * 1.6); if (far !== camFar) { camFar = far; camera.far = far; camera.updateProjectionMatrix(); }
  }
  const t0 = performance.now();
  if (!pool.threads) pool.pump(Math.max(4, budget * 0.5));
  while (inbox.length && (performance.now() - t0 < budget || inbox.length > 400)) takeResult(inbox.shift(), pcx, pcz, R);
  for (let free = pool.slots(); free > 0; free--) {
    let bk = null, be = null, bp = 1e9; // the nearest chunk that needs a mesh (one just edited comes first)
    for (const [k, e] of dirty) {
      if (meshBusy.has(k)) continue;
      const d2 = (e[0] - pcx) ** 2 + (e[1] - pcz) ** 2;
      if (d2 > R * R) { dirty.delete(k); continue; }
      const pr = e[2] ? -1 : d2;
      if (pr < bp && chunkReady(e[0], e[1])) { bp = pr; bk = k; be = e; } // (one whose neighbours are not all there yet waits in the list)
    }
    while (genCur < want.length && (chunks.has(ck(want[genCur][0], want[genCur][1])) || req.has(ck(want[genCur][0], want[genCur][1])))) genCur++;
    const g = genCur < want.length ? want[genCur] : null;
    if (be && (bp <= 0 || !g || bp <= g[2] + 4)) {
      const [cx, cz] = be, d2 = (cx - pcx) ** 2 + (cz - pcz) ** 2, m = meshes.get(bk), ch = [], tr = [];
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const c = chunks.get(ck(cx + a, cz + b)); if (c) { const cp = c.slice(); ch.push(cp); tr.push(cp.buffer); } else ch.push(null); }
      dirty.delete(bk); meshBusy.add(bk);
      pool.submit({ t: 'mesh', id: ++jobId, cx, cz, ch, tn: torchNear(cx, cz), lod: lodWant(d2, m ? m.lod : 0) }, tr);
    } else if (g) {
      req.add(ck(g[0], g[1])); genCur++;
      pool.submit({ t: 'gen', id: ++jobId, cx: g[0], cz: g[1], seed: worldSeed, gen: worldGen });
    } else break;
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
  for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) { const id = getBlock(bx, by, bz); if (isSolid(id) && (blockHeight(id) >= 1 || y < by + blockHeight(id) - 1e-4) && !(ign && ign.has(bx + ',' + by + ',' + bz))) return true; }
  return false;
}
function landY(x, y, z) { // where you come to rest: on top of the block, or 9/16 up for a bed
  const by = Math.floor(y + 1e-4); let top = by;
  for (let bz = Math.floor(z - W + 1e-4); bz <= Math.floor(z + W - 1e-4); bz++) for (let bx = Math.floor(x - W + 1e-4); bx <= Math.floor(x + W - 1e-4); bx++) { const id = getBlock(bx, by, bz); if (isSolid(id)) top = Math.max(top, by + blockHeight(id)); }
  return top === by ? by + 1 : top;
}
function buriedIn(x, y, z, h) {
  const s = new Set();
  for (let by = Math.floor(y + 1e-4); by <= Math.floor(y + h - 1e-4); by++) for (let bz = Math.floor(z - W + 1e-4); bz <= Math.floor(z + W - 1e-4); bz++) for (let bx = Math.floor(x - W + 1e-4); bx <= Math.floor(x + W - 1e-4); bx++) { const id = getBlock(bx, by, bz); if (isSolid(id) && (blockHeight(id) >= 1 || y < by + blockHeight(id) - 1e-4)) s.add(bx + ',' + by + ',' + bz); }
  return s;
}
function eyeInWater() { // the eye is under the actual water surface, which is lower than the top of the block for sources and flows
  const ex = Math.floor(P.x), ey = Math.floor(P.y + eyeY), ez = Math.floor(P.z), id = getBlock(ex, ey, ez);
  if (!isWater(id)) return false;
  return isWater(getBlock(ex, ey + 1, ez)) || P.y + eyeY - ey < waterTop(id);
}
// Low things (a bed, a snow or sand layer: up to 0.6 of a block) are walked up without jumping; anything taller needs a jump.
function stepUp(nx, nz, h0, ign, swim) {
  if (!P.ground || P.fly || swim) return false;
  for (let dy = 0.125; dy <= 0.6; dy += 0.125) if (!collides(nx, P.y + dy, nz, h0, ign)) { P.y += dy; return true; }
  return false;
}
// If a layer has formed around your feet, you are lifted onto it instead of being stuck in it.
function layerLift(h0) {
  if (P.fly || !collides(P.x, P.y, P.z, h0)) return;
  for (const k of buriedIn(P.x, P.y, P.z, h0)) { const [a, b, c] = k.split(',').map(Number); if (!isLayer(getBlock(a, b, c))) return; }
  for (let dy = 0.125; dy <= 0.8; dy += 0.125) if (!collides(P.x, P.y + dy, P.z, h0)) { P.y += dy; P.vy = Math.max(P.vy, 0); P.ground = true; return; }
}
function boxHit(x, y, z, hw, h) { // a box (half-width hw) against solid blocks, for the boat
  for (let by = Math.floor(y + 1e-4); by <= Math.floor(y + h - 1e-4); by++) for (let bz = Math.floor(z - hw + 1e-4); bz <= Math.floor(z + hw - 1e-4); bz++) for (let bx = Math.floor(x - hw + 1e-4); bx <= Math.floor(x + hw - 1e-4); bx++) { const id = getBlock(bx, by, bz); if (isSolid(id) && (blockHeight(id) >= 1 || y < by + blockHeight(id) - 1e-4)) return true; }
  return false;
}
function surfaceY(x, y, z) { // the top of the water that holds this spot, or null where there is none
  const bx = Math.floor(x), bz = Math.floor(z); let cy = Math.floor(y);
  if (!isWater(getBlock(bx, cy, bz))) return null;
  for (let i = 0; i < 8 && isWater(getBlock(bx, cy + 1, bz)); i++) cy++;
  return cy + waterTop(getBlock(bx, cy, bz));
}
function leaveBoat() { if (!riding) return; send({ t: 'boat', op: 'leave' }); riding = null; P.vx = P.vy = P.vz = 0; P.y += 0.15; P.ground = false; }
// Driving a boat: W and S go forward and back, A and D steer, Shift gets out. It floats on water and stops at the shore.
function boatPhysics(dt, now) {
  const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), steer = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
  if ((keys.has('ShiftLeft') || keys.has('ShiftRight')) && now - rideAt > 500) { leaveBoat(); return; }
  pose = 0; sprintOn = false; P.sprint = false;
  BP.speed += ((fwd > 0 ? 8 : fwd < 0 ? -2.6 : 0) - BP.speed) * Math.min(1, (fwd ? 1.4 : 0.9) * dt);
  BP.yaw += steer * (1.8 + Math.min(1, Math.abs(BP.speed) / 4) * 0.5) * dt * (BP.speed < -0.3 ? -1 : 1);
  if (surfaceY(BP.x, BP.y + 0.3, BP.z) === null) BP.speed *= Math.max(0, 1 - 3 * dt); // out of the water it slows right down
  const nx = BP.x - Math.sin(BP.yaw) * BP.speed * dt, nz = BP.z - Math.cos(BP.yaw) * BP.speed * dt;
  if (!boxHit(nx, BP.y + 0.12, BP.z, 0.6, 0.35)) BP.x = nx; else BP.speed *= 0.4;
  if (!boxHit(BP.x, BP.y + 0.12, nz, 0.6, 0.35)) BP.z = nz; else BP.speed *= 0.4;
  const sy = surfaceY(BP.x, BP.y + 0.3, BP.z);
  if (sy !== null) { BP.y += (sy - 0.2 - BP.y) * Math.min(1, 8 * dt); BP.vy = 0; }
  else { BP.vy = Math.max(-30, BP.vy - 25 * dt); const ny = BP.y + BP.vy * dt; if (boxHit(BP.x, ny, BP.z, 0.6, 0.1)) BP.vy = 0; else BP.y = ny; }
  P.x = BP.x; P.z = BP.z; P.y = BP.y + 0.35; P.vx = P.vy = P.vz = 0; P.ground = false;
}
function physics(dt) {
  if (riding) { boatPhysics(dt, performance.now()); return; }
  const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const shift = keys.has('ShiftLeft') || keys.has('ShiftRight'), jump = keys.has('Space');
  if (mode !== 'creative') P.fly = false;
  const bx = Math.floor(P.x), bz = Math.floor(P.z);
  const inLavaF = isLava(getBlock(bx, Math.floor(P.y + 0.2), bz)), inLavaW = isLava(getBlock(bx, Math.floor(P.y + 0.9), bz)); // lava can be swum in, like water but slower (it still burns)
  const swim = isWater(getBlock(bx, Math.floor(P.y + 0.2), bz)) || inLavaF, waist = isWater(getBlock(bx, Math.floor(P.y + 0.9), bz)) || inLavaW;
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
  layerLift(POSE_H[pose]);
  const h0 = POSE_H[pose], ign = collides(P.x, P.y, P.z, h0) ? buriedIn(P.x, P.y, P.z, h0) : null; // inside blocks: no pushing out, just move on
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw), [cfx, cfz] = swim && !inLavaF ? flowDir(getBlock, bx, Math.floor(P.y + 0.2), bz) : [0, 0]; // flowing water carries you along
  let wx = -sy * fwd + cy * side, wz = -cy * fwd - sy * side;
  const len = Math.hypot(wx, wz); if (len > 1) { wx /= len; wz /= len; }
  const speed = P.fly ? 11 : swimCrawl ? (inLavaF ? 3.4 : 5.6) : swim ? (inLavaF ? 2 : 3) : pose === 2 ? 1.8 : pose === 1 ? 1.5 : P.sprint ? 7 : mouseR && eating ? 2 : 4.6;
  const a = Math.min(1, (P.ground || P.fly || swim ? 16 : 5) * dt);
  P.vx += (wx * speed + cfx * 1.6 - P.vx) * a; P.vz += (wz * speed + cfz * 1.6 - P.vz) * a;
  if (P.fly) P.vy = (jump ? 8 : 0) - (shift ? 8 : 0);
  else if (swimCrawl && fwd > 0) { const ld = lookDir(); P.vy += (ld[1] * speed + (jump ? 2 : 0) - P.vy) * a; } // crawl-swimming goes where you look
  else if (swim) P.vy = Math.max(inLavaF ? -1.6 : -3, Math.min(inLavaF ? 2.4 : 3.2, P.vy + (jump ? 14 : -10) * dt));
  else { P.vy = Math.max(-50, P.vy - 28 * dt); if (jump && P.ground && pose !== 2) { P.vy = 9; P.ground = false; } }
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(P.vx), Math.abs(P.vy), Math.abs(P.vz)) * dt / 0.4)), h = dt / steps;
  const edge = pose === 1 && P.ground && !P.fly; // sneaking: stay on the block you are standing on
  let bumped = false;
  for (let s = 0; s < steps; s++) {
    const nx = P.x + P.vx * h; if (collides(nx, P.y, P.z, h0, ign) || (edge && !collides(nx, P.y - 0.6, P.z, 0.6))) { if (!edge && stepUp(nx, P.z, h0, ign, swim)) P.x = nx; else { P.vx = 0; bumped = true; } } else P.x = nx;
    const nz = P.z + P.vz * h; if (collides(P.x, P.y, nz, h0, ign) || (edge && !collides(P.x, P.y - 0.6, nz, 0.6))) { if (!edge && stepUp(P.x, nz, h0, ign, swim)) P.z = nz; else { P.vz = 0; bumped = true; } } else P.z = nz;
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
    if (id && ((!isWater(id) && !isLava(id)) || (srcWater && id === B.WATER) || id === B.SEAWEED)) return { x, y, z, id, n, t };
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
  for (const m of mobs.values()) { const s = mobDims(MOB_TYPES[m.type], m.size), t = hitBox(o, d, m.x, m.y + s.h / 2 - 0.04, m.z, s.w / 2 + 0.12, s.h / 2 + 0.1); if (t < max && (!best || t < best.t)) best = { k: 'm', id: m.id, t, x: m.x, y: m.y + s.h / 2, z: m.z }; }
  for (const bt of boats.values()) { if (riding && riding.id === bt.id) continue; const t = hitBox(o, d, bt.x, bt.y + 0.3, bt.z, 0.75, 0.35); if (t < max && (!best || t < best.t)) best = { k: 'b', id: bt.id, t, x: bt.x, y: bt.y + 0.3, z: bt.z }; }
  if (pvpOn()) for (const p of others.values()) { const t = hitBox(o, d, p.x, p.y + 0.86, p.z, 0.42, 1.0); if (t < max && (!best || t < best.t)) best = { k: 'p', id: p.id, t, x: p.x, y: p.y + 0.9, z: p.z }; }
  return best;
}
const pvpOn = () => !!(roomInfo && roomInfo.pvp && mode !== 'creative');
const overlapsPlayer = (x, y, z) => P.x - W < x + 1 && P.x + W > x && P.z - W < z + 1 && P.z + W > z && P.y < y + 1 && P.y + POSE_H[pose] > y;
const hl = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x000000 }));
hl.visible = false; scene.add(hl);

/* ---------- mining, attacking, placing, eating, bow ---------- */
let clickAtk = false, mining = null, mineDelay = 0, swing = 0, chipT = 0, lastAtk = 0, lastPlace = 0, eating = null, charging = null, target = null;
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
  setBlock(t.x, t.y, t.z, t.id === B.SEAWEED ? B.WATER : 0);
  stopMining(); mineDelay = mode === 'creative' ? 0.2 : 0.18;
}
function attack(t) {
  if (t.k === 'b') { send({ t: 'boat', op: 'break', id: t.id }); startSwing(); return; } // breaking a boat gives it back
  send({ t: 'atk', k: t.k, id: t.id }); startSwing();
  fx.burst(t.x, t.y, t.z, [0.85, 0.15, 0.15], 6, 2.5, 0.09, 0.45);
}
function useBlock(t, now) {
  const hs = ui.held(), it = hs && itemInfo(hs.id);
  if (t.id === B.CHEST || t.id === B.FURNACE || isBed(t.id) || isDoor(t.id)) { const c = saves.foreign(t.x, t.z); if (c) { hint(protectedMsg(c)); return true; } } // the server refuses too; this just explains it
  if (it && it.block === B.CHUNK_SAVER) { // a Chunk Saver asks for a name first, then the server places it and claims the chunk
    const cur = getBlock(t.x + t.n[0], t.y + t.n[1], t.z + t.n[2]);
    if (cur && !isWater(cur)) return true;
    const c = saves.foreign(t.x + t.n[0], t.z + t.n[2]); if (c) { hint(protectedMsg(c)); return true; }
    saves.askName({ x: t.x, y: t.y, z: t.z, n: t.n }); return true;
  }
  if ([B.TABLE, B.CHEST, B.FURNACE].includes(t.id) || isBed(t.id) || (isDoor(t.id) && pose !== 1)) { send({ t: 'use', x: t.x, y: t.y, z: t.z, nx: t.n[0], ny: t.n[1], nz: t.n[2] }); return true; }
  if (it && (it.bucket || it.bed || it.door)) { const empty = it.bucket === 'empty', c = saves.foreign(empty ? t.x : t.x + t.n[0], empty ? t.z : t.z + t.n[2]); if (c) { hint(protectedMsg(c)); return true; } }
  if (it && it.bucket) { // empty bucket scoops the water source it aims at, a full one pours next to the block it aims at; the server decides
    if (it.bucket === 'empty' ? t.id === B.WATER : !isWater(t.id)) { send({ t: 'use', x: t.x, y: t.y, z: t.z, nx: t.n[0], ny: t.n[1], nz: t.n[2] }); startSwing(); }
    return true;
  }
  if (it && it.door) { send({ t: 'use', x: t.x, y: t.y, z: t.z, nx: t.n[0], ny: t.n[1], nz: t.n[2] }); startSwing(); lastPlace = now; return true; } // the server places both halves
  if (it && it.bed) { send({ t: 'use', x: t.x, y: t.y, z: t.z, nx: t.n[0], ny: t.n[1], nz: t.n[2] }); startSwing(); lastPlace = now; return true; } // the server lays out both halves
  if (it && it.boat !== undefined) { if (t.id === B.WATER) { send({ t: 'boat', op: 'place', x: t.x, y: t.y, z: t.z }); startSwing(); lastPlace = now; } return true; } // a boat goes on the water you aim at
  if (it && it.seaweed) { send({ t: 'use', x: t.x, y: t.y, z: t.z, nx: t.n[0], ny: t.n[1], nz: t.n[2] }); startSwing(); lastPlace = now; return true; }
  if (it && (it.hoe || it.seeds)) { const c = saves.foreign(t.x, t.z); if (c) { hint(protectedMsg(c)); return true; } send({ t: 'use', x: t.x, y: t.y, z: t.z, nx: t.n[0], ny: t.n[1], nz: t.n[2] }); startSwing(); lastPlace = now; return true; } // the server decides: a hoe tills grass or dirt, seeds go on farmland
  if (!(it && it.block)) return false;
  const repl = isPlant(t.id) && it.block !== B.TORCH, x = repl ? t.x : t.x + t.n[0], y = repl ? t.y : t.y + t.n[1], z = repl ? t.z : t.z + t.n[2], cur = getBlock(x, y, z); // grass and flowers are replaced by what you place
  let place = it.block;
  if (place === B.TORCH) { place = torchFor(t.n[0], t.n[1], t.n[2]); if (!place || !isSolid(t.id) || isBed(t.id) || isLayer(t.id)) return true; } // top or side of a solid block
  if (y < 0 || y >= CH || (cur && !isWater(cur) && !isLayer(cur) && !isPlant(cur)) || (!isTorch(place) && overlapsPlayer(x, y, z))) return true;
  { const c = saves.foreign(x, z); if (c) { hint(protectedMsg(c)); return true; } }
  setBlock(x, y, z, place); startSwing(); lastPlace = now;
  send({ t: 'use', x: t.x, y: t.y, z: t.z, nx: t.n[0], ny: t.n[1], nz: t.n[2] }); // predicted here; the server confirms or undoes it
  return true;
}
function rightDown(now) {
  const hs = ui.held(), it = hs && itemInfo(hs.id);
  if (target && target.k === 'b') { send({ t: 'boat', op: 'ride', id: target.id }); startSwing(); return; } // climb into a boat
  if (target && target.k === 'm') { // a wolf: a bone tames a wild one; a tame one of yours sits or stands, eats meat, or takes a dye for its collar
    const mo = mobs.get(target.id);
    if (mo && MOB_TYPES[mo.type] === 'wolf' && ((mo.flags & 256) || (hs && hs.id === I.BONE))) { send({ t: 'mobuse', id: target.id }); startSwing(); return; }
  }
  if (it && it.rod) { if (fishing.has(myId)) send({ t: 'rod', op: 'reel' }); else send({ t: 'rod', op: 'cast', d: lookDir() }); startSwing(); return; } // cast, then reel in when the float plunges
  if (target && target.k === undefined && target.id !== undefined && useBlock(target, now)) return;
  if (it && it.food && (mode !== 'creative') && (stats.food < 20 || it.always)) { eating = { t: 0 }; send({ t: 'hold', on: true }); }
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
const RAIN_TINT = new THREE.Color(0x66707e), SNOW_TINT = new THREE.Color(0xcdd6e0), SAND_TINT = new THREE.Color(0xc29850), tintC = new THREE.Color();
const SUNSET = new THREE.Color(0xff9a5a), ZEN_DAY = new THREE.Color(0x3f82d8), ZEN_NIGHT = new THREE.Color(0x02050e), zen = new THREE.Color(), hor = new THREE.Color();
const dome = new THREE.Mesh(new THREE.SphereGeometry(450, 20, 10), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
dome.renderOrder = -2; dome.frustumCulled = false; scene.add(dome);
const domeCol = new Float32Array(dome.geometry.attributes.position.count * 3); dome.geometry.setAttribute('color', new THREE.BufferAttribute(domeCol, 3));
let skyAng = 1.2, darkF = 0;
// The y of the top of the ground at a column near you (for rain splashes), or null where there is nothing to splash on.
function rainHeight(x, z) {
  const top = Math.min(CH - 1, Math.floor(camera.position.y + 8)), bot = Math.max(1, Math.floor(camera.position.y - 10));
  for (let y = top; y >= bot; y--) {
    const id = getBlock(x, y, z);
    if (id === 0 || id === undefined || id === -1 || isPlant(id) || isTorch(id)) continue;
    if (isLava(id)) return null;
    return isWater(id) ? y + 0.85 : y + blockHeight(id);
  }
  return null;
}
function updateWeather(dt, now) {
  if (now - biomeAt0 > 500) { biomeAt0 = now; biomeNow = worldGen >= 4 ? biomeAt(P.x, P.z, worldSeed, worldGen) : 0; biomeName = worldGen >= 4 ? BIOME_NAMES[biomeKind(P.x, P.z, worldSeed, worldGen)] : ''; }
  const kind = biomeNow === 2 ? 2 : 1; // rain, or snow in the cold biome (rain falls in deserts too)
  const open = outside && !underground && !eyeInWater() && !dead;
  wxK += ((wxRain && open ? 1 : 0) - wxK) * Math.min(1, dt * 0.55);
  sandK += ((wxSand && open && biomeNow === 1 ? 1 : 0) - sandK) * Math.min(1, dt * 0.55); // a sandstorm is only felt in the desert
  if (wxK > 0.02) wxKind = kind;
  weather.update(dt, wxK > 0.02 ? wxKind : 0, wxK, sandK, camera.position, rainHeight);
}
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
  { // the sky term of the world light: bluish dim moonlight at night, white by day, warm at sunrise and sunset
    const warm = inGame ? Math.max(0, 1 - Math.abs(Math.sin(ang)) / 0.22) * 0.5 : 0, u = LIGHT_U.uSkyMul.value;
    u.set(0.04 + 0.96 * t, 0.055 + 0.945 * t, 0.12 + 0.88 * t); u.y *= 1 - 0.18 * warm; u.z *= 1 - 0.38 * warm;
    if (inGame && (wxK > 0.01 || sandK > 0.01)) u.multiplyScalar((1 - 0.22 * wxK) * (1 - 0.3 * sandK)); // storms dim the daylight
  }
  scene.fog.near = Math.max(8, cfg.dist * CS * 0.5); scene.fog.far = cfg.dist * CS * 0.95;
  if (inGame && wxK > 0.01) { // an overcast sky and a shorter view in rain and snow
    tintC.copy(wxKind === 2 ? SNOW_TINT : RAIN_TINT).multiplyScalar(0.3 + 0.7 * t);
    scene.background.lerp(tintC, (wxKind === 2 ? 0.62 : 0.55) * wxK); scene.fog.color.copy(scene.background);
    const f0 = scene.fog.far, n0 = scene.fog.near, fT = f0 * (wxKind === 2 ? 0.5 : 0.72), nT = n0 * 0.4;
    scene.fog.far = f0 + (fT - f0) * wxK; scene.fog.near = n0 + (nT - n0) * wxK;
  }
  if (inGame && sandK > 0.01) { // a sandstorm turns the air orange and the view to a few blocks (it can be on top of rain)
    tintC.copy(SAND_TINT).multiplyScalar(0.3 + 0.7 * t);
    scene.background.lerp(tintC, 0.88 * sandK); scene.fog.color.copy(scene.background);
    const f0 = scene.fog.far, n0 = scene.fog.near;
    scene.fog.far = f0 + (24 - f0) * sandK; scene.fog.near = n0 + (2 - n0) * sandK;
  }
  darkF += ((inGame ? (underground ? 1 : outside ? 0 : 0.45) : 0) - darkF) * 0.04; // smoothly: under rock the haze turns black and short
  if (darkF > 0.01) { scene.background.multiplyScalar(1 - 0.94 * darkF); scene.fog.color.copy(scene.background); scene.fog.near = scene.fog.near * (1 - darkF) + 4 * darkF; scene.fog.far = scene.fog.far * (1 - darkF) + 34 * darkF; }
  const cp = camera.position, dx = Math.cos(ang), dy = Math.sin(ang);
  sun.position.set(cp.x + dx * 300, cp.y + dy * 300, cp.z + 90); sun.lookAt(cp);
  moon.position.set(cp.x - dx * 300, cp.y - dy * 300, cp.z - 90); moon.lookAt(cp);
  stars.position.set(cp.x, cp.y, cp.z); stars.material.opacity = Math.max(0, 0.9 - t * 1.6) * (1 - Math.max(wxK, sandK));
  const under = inGame && eyeInWater();
  if (under) { scene.background.set(0x1f4fa8); scene.fog.color.set(0x1f4fa8); scene.fog.near = 0.5; scene.fog.far = 22; }
  const eyeLava = inGame && isLava(getBlock(Math.floor(cp.x), Math.floor(cp.y), Math.floor(cp.z)));
  if (eyeLava) { scene.background.set(0xcf4a0a); scene.fog.color.set(0xcf4a0a); scene.fog.near = 0.1; scene.fog.far = 3.5; }
  dome.visible = !under && !eyeLava; dome.position.copy(cp);
  if (!under && !eyeLava) {
    hor.copy(scene.background); zen.copy(ZEN_NIGHT).lerp(ZEN_DAY, t); if (inGame && (wxK > 0.01 || sandK > 0.01)) zen.lerp(hor, 0.78 * Math.max(wxK, sandK));
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
  fishing.set({ id, on: 0 });
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
    if (!o) { const model = makeMob(type, aux, sz); model.g.position.set(x, y, z); scene.add(model.g); o = { id, type, model, x, y, z, yaw, speed: 0, vy: 0, flags: 0, size: 1 }; mobs.set(id, o); }
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
  const seenF = new Set(); // falling sand and gravel
  for (const [id, b, x, y, z, vy] of m.f || []) {
    seenF.add(id);
    let o = fallers.get(id);
    if (!o) { const mesh = itemMesh(isLayer(b) ? layerFull(layerKind(b)) : b, 1), hy = blockHeight(b); if (isLayer(b)) mesh.scale.y *= hy; mesh.position.set(x, y + hy / 2, z); scene.add(mesh); o = { mesh, x, y, z, ty: y, vy, hy: hy / 2 }; fallers.set(id, o); }
    o.x = x; o.z = z; o.ty = y; o.vy = vy;
  }
  for (const [id, o] of fallers) if (!seenF.has(id)) { scene.remove(o.mesh); fallers.delete(id); }
  const seenB = new Set(); // boats
  for (const [id, kind, x, y, z, yaw, rider] of m.b || []) {
    seenB.add(id);
    let o = boats.get(id);
    if (!o) { const model = makeBoat(kind); model.g.position.set(x, y, z); scene.add(model.g); o = { id, kind, model, x, y, z, yaw, tx: x, ty: y, tz: z, tyaw: yaw, rider }; boats.set(id, o); }
    o.rider = rider;
    if (riding && riding.id === id) continue; // your own boat is steered by your game, not by what the server last said
    Object.assign(o, { tx: x, ty: y, tz: z, tyaw: yaw });
  }
  for (const [id, o] of boats) if (!seenB.has(id)) { disposeModel(o.model.g); boats.delete(id); if (riding && riding.id === id) riding = null; }
}
function updateEnts(dt, now) {
  const k = Math.min(1, dt * 12), t = now / 1000;
  for (const o of fallers.values()) { // between server updates the block keeps falling at the speed the server last reported
    o.ty += o.vy * dt; o.y += (o.ty - o.y) * Math.min(1, dt * 14);
    o.mesh.position.set(o.x, o.y + o.hy, o.z);
  }
  for (const o of mobs.values()) {
    const px = o.x, pz = o.z, py = o.y;
    o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; o.z += (o.tz - o.z) * k;
    o.yaw += Math.atan2(Math.sin(o.tyaw - o.yaw), Math.cos(o.tyaw - o.yaw)) * Math.min(1, dt * 10);
    const sp = Math.hypot(o.x - px, o.z - pz) / Math.max(dt, 1e-3);
    o.speed += (sp - o.speed) * Math.min(1, dt * 8); o.vy = (o.y - py) / Math.max(dt, 1e-3);
    o.model.g.position.set(o.x, o.y, o.z); o.model.g.rotation.y = o.yaw + Math.PI;
    o.model.setFlash(!!(o.flags & 1));
    o.model.update({ speed: o.speed, flags: o.flags, size: o.size, fuse: o.fuse, t, dt, vy: o.vy, aux: o.aux });
    entLit(o, mobDims(MOB_TYPES[o.type], o.size), dt);
  }
  for (const o of boats.values()) {
    if (riding && riding.id === o.id) { o.x = BP.x; o.y = BP.y; o.z = BP.z; o.yaw = BP.yaw; }
    else { o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; o.z += (o.tz - o.z) * k; o.yaw += Math.atan2(Math.sin(o.tyaw - o.yaw), Math.cos(o.tyaw - o.yaw)) * Math.min(1, dt * 10); }
    o.model.g.position.set(o.x, o.y + Math.sin(t * 1.7 + o.id) * 0.015, o.z); o.model.g.rotation.y = o.yaw + Math.PI;
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
    entLit(o, { w: 0.6, h: 1.8 }, dt);
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
      resetWorld(m.room.seed, normGen(m.room.gen)); store.set('token', m.token); retry = 0; myId = m.pid; dead = false; ui.hideDead();
      roomInfo = m.room; session.room = m.room.id; session.create = false; mode = m.room.mode; ui.setMode(mode);
      tOff = m.now - Date.now(); epoch = m.epoch; dayMs = m.dayMs; wxRain = !!(m.wx && m.wx.rain); wxSand = !!(m.wx && m.wx.sand); wxK = 0; sandK = 0;
      for (let i = 0; i + 3 < m.edits.length; i += 4) setBlock(m.edits[i], m.edits[i + 1], m.edits[i + 2], m.edits[i + 3]);
      Object.assign(P, { x: m.me.x, y: m.me.y, z: m.me.z, yaw: m.me.yaw || 0, pitch: m.me.pitch || 0, vx: 0, vy: 0, vz: 0, fly: false });
      for (const p of m.players) addOther(p);
      joined = true; setConn('Online', true); $('save').textContent = ''; renderPlayers(); saves.onWelcome(m); enterGame();
      break;
    }
    case 'inv': ui.setInv(m); break;
    case 'st': Object.assign(stats, { hp: m.hp, food: m.food, air: m.air, def: m.def }); ui.setStats(m); break;
    case 'open': if (!dead) { unlock(); ui.open(m.kind); } break;
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
    case 'wx': wxRain = !!m.rain; wxSand = !!m.sand; break; // rain or a sandstorm switched on or off
    case 'blks': for (let i = 0; i + 3 < m.b.length; i += 4) setBlock(m.b[i], m.b[i + 1], m.b[i + 2], m.b[i + 3]); break;
    case 'hook': { // a fishing hook (yours or another player's)
      const prev = fishing.state(m.id) ? { s: fishing.state(m.id).s, b: fishing.state(m.id).b } : null;
      fishing.set(m);
      if (m.id === myId) {
        if (m.on && m.s === 1 && (!prev || prev.s === 0)) audio.fishing('splash');
        if (m.on && m.b === 2 && (!prev || prev.b !== 2)) { audio.fishing('bite'); reminder.notify('Bite! Right click now to reel in!', 'ok', 1100); }
        if (!m.on && prev && prev.b === 2) audio.fishing('catch');
      }
      break;
    }
    case 'fx': onFx(m); break;
    case 'ride': riding = { id: m.id, kind: m.kind }; BP = { x: m.x, y: m.y, z: m.z, yaw: m.yaw, speed: 0, vy: 0 }; rideAt = performance.now(); P.x = m.x; P.y = m.y + 0.35; P.z = m.z; P.vx = P.vy = P.vz = 0; addChat({ sys: 1, m: 'In the boat: W and S drive, A and D steer, Shift gets you out.' }); break;
    case 'unride': riding = null; break;
    case 'kb': if (riding) break; P.vx += m.x; P.vy = Math.max(P.vy, m.y); P.vz += m.z; P.ground = false; break;
    case 'sleep':
      if (m.on) { sleeping = { x: m.x, y: m.y, z: m.z, dir: m.dir }; const [dx, dz] = DIR4[m.dir]; P.x = m.x + 0.5; P.y = m.y + BED_H; P.z = m.z + 0.5; P.vx = P.vy = P.vz = 0; P.yaw = Math.atan2(dx, dz); P.pitch = 1.35; keys.clear(); stopMining(); rightUp(); }
      else { sleeping = null; P.x = m.x; P.y = m.y; P.z = m.z; P.vx = P.vy = P.vz = 0; P.pitch = 0; P.ground = false; }
      break;
    case 'time': epoch = m.epoch; break;
    case 'dead':
      sleeping = null; riding = null; dead = true; stopMining(); rightUp(); keys.clear(); ui.close(false); ui.showDead(m.m);
      unlock();
      $('pause').hidden = true; break;
    case 'chat': addChat(m); break;
    case 'fix':
      P.x = m.x; P.y = m.y; P.z = m.z; P.vx = P.vy = P.vz = 0; if (riding) { BP.x = m.x; BP.z = m.z; BP.y = m.y - 0.35; BP.speed = 0; }
      if (dead) { dead = false; ui.hideDead(); if (state === 'play' && !locked) { $('pause').hidden = false; $('resume').textContent = 'Resume'; } }
      break;
    case 'save': $('save').textContent = m.ok ? 'World saved' : 'Could not save, retrying…'; $('save').className = m.ok ? '' : 'bad'; break;
    case 'err': if (m.fatal) leaveToMenu(m.m); else addChat({ sys: 1, m: m.m }); break;
    case 'rset': { // the host changed the world's settings
      roomInfo = m.room; mode = m.room.mode; ui.setMode(mode); saves.onRoom(m.room); $('hostBtn').hidden = !(roomInfo.owner && !roomInfo.locked);
      $('pSub').textContent = subText(); break;
    }
    default: saves.onMsg(m);
  }
}
function onFx(m) {
  audio.fx(m);
  if (m.k === 'hurt') {
    if (m.id === myId) { ui.flash(); } else { const o = others.get(m.id); if (o) o.flash = 0.25; }
  } else if (m.k === 'die') {
    const model = makeMob(m.ty, m.aux, m.sz); model.g.position.set(m.x, m.y, m.z); model.g.rotation.y = m.yaw + Math.PI;
    if (m.ty === 10) model.update({ speed: 0, flags: 32, size: m.sz, t: 0, dt: 0, vy: 0 });
    scene.add(model.g); model.setFlash(true); ghosts.push({ model, t: 0, y: m.y });
    fx.burst(m.x, m.y + 0.5, m.z, [0.92, 0.92, 0.92], 12, 2.2, 0.12, 0.8);
  } else if (m.k === 'crit') { fx.burst(m.x, m.y, m.z, [1, 0.92, 0.4], 16, 3.4, 0.09, 0.55); fx.burst(m.x, m.y, m.z, [1, 1, 1], 8, 2.2, 0.07, 0.4); }
  else if (m.k === 'boom') fx.explosion(m.x, m.y, m.z);
  else if (m.k === 'tame') { if (m.ok) { fx.burst(m.x, m.y, m.z, [1, 0.3, 0.45], 10, 1.6, 0.11, 0.9); fx.burst(m.x, m.y, m.z, [1, 0.6, 0.7], 5, 1.2, 0.09, 0.8); } else fx.burst(m.x, m.y, m.z, [0.6, 0.6, 0.62], 10, 1.4, 0.1, 0.8); } // hearts for a wolf that is tamed or fed, grey puffs for a bone that did not work
  else if (m.k === 'block') { const o = m.id === myId ? P : others.get(m.id); if (o) fx.burst(o.x, o.y + 1.2, o.z, [0.82, 0.82, 0.88], 8, 2.5, 0.08, 0.5); } // a shield took a hit
}
let lastSend = 0, lastKey = '';
function netSend(now) {
  if (!joined || dead || sleeping || now - lastSend < 50) return;
  const r = (v) => Math.round(v * 100) / 100, yaw = r(P.yaw % 6.2832), pitch = r(P.pitch), key = [r(P.x), r(P.y), r(P.z), yaw, pitch, P.sprint, pose, riding ? r(BP.yaw) : 0].join();
  if (key === lastKey && now - lastSend < 1000) return;
  lastKey = key; lastSend = now; send({ t: 'pos', x: r(P.x), y: r(P.y), z: r(P.z), yaw, pitch, sp: P.sprint, po: pose, ...(riding ? { bw: r(BP.yaw) } : {}) });
}

/* ---------- menu, HUD, input ---------- */
const menuBtns = ['join', 'create', 'worldsBtn', 'gsExport', 'gsImport'].map($);
const menuMsg = (t) => { $('menumsg').textContent = t; };
const busy = (b) => menuBtns.forEach((x) => { x.disabled = b || !serverReady; });
// On a phone or tablet there is no pointer lock: "locked" simply means the touch controls are active (and no menu is open).
const isTouch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 1 && !matchMedia('(pointer: fine)').matches);
if (isTouch) document.body.classList.add('touch');
const lock = () => {
  if (isTouch) { // first Play: go fullscreen and landscape if the browser allows it
    try { const d = document.documentElement; if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {}); } catch { /* optional */ }
    return applyLock(true);
  }
  const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {});
};
const unlock = () => { if (isTouch) { if (locked) setTimeout(() => { if (locked) applyLock(false); }, 0); } else if (document.pointerLockElement) document.exitPointerLock(); }; // like the real pointer-lock event, it lands after whatever opened the menu has finished

function start(opts) {
  if (saveGate && !saveGate.guardPlay()) return; // your game file is missing: ask for it before you play
  autosave.arm(); // lets the game keep writing to the save file you picked before (the browser may ask once after a restart)
  const name = $('name').value.trim().slice(0, 16) || 'Builder' + ((Math.random() * 900 + 100) | 0);
  store.set('name', name); session = { name, ...opts }; leaving = false; retry = 0; joined = false;
  busy(true); menuMsg('Joining…'); openSocket();
}
function enterGame() {
  busy(false);
  if (state === 'play') return;
  state = 'play'; $('menu').hidden = true; $('hud').hidden = false; $('pause').hidden = false; reminder.setPlaying(true); autosave.start();
  $('pTitle').textContent = roomInfo.name; $('pCode').textContent = roomInfo.id;
  $('pSub').textContent = subText(); $('hostBtn').hidden = !(roomInfo.owner && !roomInfo.locked);
  $('resume').textContent = 'Play';
}
function subText() {
  const tail = `${mode === 'creative' ? 'Creative' : 'Survival'}${roomInfo.pvp && mode !== 'creative' ? ', PvP on' : ''}${roomInfo.live ? ', live' : ''}. `;
  return tail + (roomInfo.owner && !roomInfo.locked ? 'You are the host of this world. Type /help in chat.' : (isTouch ? 'Tap Play. Left thumb moves, drag the right side to look, tap to place or hit, hold to mine.' : 'Press Play, then click the screen to look around.'));
}
function leaveToMenu(msg) {
  if (state === 'play' && roomInfo && roomInfo.owner && !roomInfo.locked) { try { renderer.render(scene, camera); takeShot(); } catch { /* the picture is a nicety */ } } // the picture for "Your worlds"
  reminder.setPlaying(false); autosave.stop(); autosave.later(1500); setTimeout(refreshWorlds, 1200); // one more quiet save once the server has stored where you left off
  leaving = true; joined = false; state = 'menu'; dead = false; audio.stop();
  if (ws) { const s = ws; ws = null; s.close(); }
  unlock();
  ui.close(false); ui.hideDead(); stopMining(); eating = charging = null; sleeping = null; saves.reset();
  $('hud').hidden = true; $('pause').hidden = true; $('menu').hidden = false; keys.clear();
  resetWorld(MENU_SEED, 2); busy(false); menuMsg(msg || '');
}
function addChat(m) {
  const d = document.createElement('div');
  if (m.sys) d.className = 'sys';
  d.textContent = m.sys ? m.m : `${m.from}: ${m.m}`; // textContent only: chat is never parsed as HTML
  const log = $('log'); log.append(d);
  while (log.children.length > 30) log.firstChild.remove();
  setTimeout(() => d.remove(), 25000);
}
function selectSlot(i) { i = ((i % 9) + 9) % 9; if (i === ui.sel) return; lastAtk = performance.now(); ui.selectSlot(i); send({ t: 'hot', i }); stopMining(); rightUp(); }
function openChat() { chatOpen = true; unlock(); const i = $('chatIn'); i.hidden = false; i.value = ''; i.focus(); }
function closeChat(sendIt) {
  const i = $('chatIn'), v = i.value.trim();
  if (sendIt && v) send({ t: 'chat', m: v });
  i.value = ''; i.hidden = true; i.blur(); chatOpen = false; lock();
}
function toggleInventory() {
  if (ui.isOpen) { ui.close(true); lock(); return; }
  unlock();
  keys.clear(); mouseL = mouseR = false; stopMining(); rightUp(); ui.open('inv');
}

$('join').onclick = () => {
  const code = $('code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(code)) return menuMsg('Enter the world code: letters and numbers only.');
  start({ room: code });
};
$('create').onclick = () => start({ create: true, roomName: $('wname').value.trim(), seed: $('seed').value.trim(), mode: $('mode').value, pvp: $('pvp').checked, cheats: $('cheats').checked });
$('resume').onclick = lock;
$('saveBtn').onclick = () => saves.openPanel();
$('hostBtn').onclick = () => saves.openHost();
$('worldsBtn').onclick = () => saves.openWorlds();
let saveGate = null; // see savegate.js: autosave stays off until your game file is loaded
const gameSaves = createGameSaves({
  store, url: (p) => net.http + p, onSaved: () => { reminder.saved(); setTimeout(refreshWorlds, 300); }, onImported: () => saveGate && saveGate.evaluate(),
  apply: (c) => { // settings from an imported file: name and options
    if (c.name) { store.set('name', c.name); $('name').value = c.name; }
    if (c.lastSave) reminder.restoreLast(c.lastSave);
    if (c.cfg) { Object.assign(cfg, c.cfg); store.set('cfg', cfg); for (const [id, key] of [['sDist', 'dist'], ['sFov', 'fov'], ['sSens', 'sens']]) $(id).value = cfg[key]; camera.fov = cfg.fov; camera.updateProjectionMatrix(); }
  },
  onClose: () => refreshWorlds(),
});
// The game saves itself every 10 seconds, quietly (see autosave.js); U just does the next save early.
const autosave = createAutosave({
  snapshot: () => gameSaves.snapshot(),
  ready: () => serverReady && !gameSaves.busy && !!store.get('token', null),
  gate: () => ({ open: !!saveGate && saveGate.open, why: saveGate ? saveGate.state : 'checking' }),
  onChange: () => { reminder.render(); if (saveGate) saveGate.noticeHeld(); },
});
const reminder = createReminder({
  store, autosave, hasGame: () => !!store.get('token', null),
  gate: () => (saveGate ? saveGate.state : 'checking'), gateClick: () => saveGate && saveGate.show(saveGate.why || 'server'),
  save: async () => {
    if (saveGate && saveGate.state === 'needs') { unlock(); saveGate.show(saveGate.why); reminder.notify('Autosave is off: load your game file first', 'bad', 3500); return; } // never save before the game file is loaded
    if (autosave.needsPick) unlock(); // the first time, a small window asks where to keep the save file
    const r = await autosave.now();
    if (r === true) reminder.notify('Game saved');
    else if (r === 'held') { unlock(); saveGate.noticeHeld(); reminder.notify('Not saved: it would replace a bigger save', 'bad', 4000); }
    else if (r === 'gated') reminder.notify('Autosave is waiting for the server to answer', 'warn', 3500);
    else if (r === false) reminder.notify('Could not save right now', 'warn', 3500);
  },
});
saveGate = createSaveGate({ store, url: (p) => net.http + p, autosave, gameSaves, onChange: () => reminder.render() });
reminder.guardUnload(); reminder.render();
$('gsExport').onclick = () => gameSaves.exportGame();
$('gsImport').onclick = () => gameSaves.pick();
$('saveGameBtn').onclick = () => reminder.save();
$('leave').onclick = () => reminder.confirmLeave(() => leaveToMenu(''));
$('copy').onclick = () => { try { navigator.clipboard.writeText(roomInfo.id); $('copy').textContent = 'Copied'; setTimeout(() => ($('copy').textContent = 'Copy'), 1500); } catch { /* clipboard blocked */ } };
for (const [id, key] of [['sDist', 'dist'], ['sFov', 'fov'], ['sSens', 'sens']]) {
  $(id).value = cfg[key];
  $(id).oninput = () => { cfg[key] = +$(id).value; store.set('cfg', cfg); if (key === 'fov') { camera.fov = cfg.fov; camera.updateProjectionMatrix(); } };
}
canvas.addEventListener('click', () => { if (state === 'play' && !locked && !chatOpen && !ui.isOpen && !dead && !saves.isOpen) lock(); });
function applyLock(v) {
  locked = v;
  if (!locked) { keys.clear(); mouseL = mouseR = false; stopMining(); rightUp(); if (state === 'play') shotWant = true; }
  if (state === 'play') { const other = ui.isOpen || dead || saves.isOpen; $('pause').hidden = locked || chatOpen || other; if (!locked && !chatOpen && !other) $('resume').textContent = 'Resume'; }
}
document.addEventListener('pointerlockchange', () => applyLock(document.pointerLockElement === canvas));
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) {
    if (e.target.id === 'chatIn') { if (e.key === 'Enter') closeChat(true); else if (e.key === 'Escape') closeChat(false); }
    else if (e.key === 'Escape' && saves.isOpen) { e.preventDefault(); saves.key(e); }
    return;
  }
  if (saves.isOpen) { if (e.code === 'Escape') { e.preventDefault(); saves.key(e); } return; }
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
  else if (e.code === 'KeyP' && saves.placing) saves.pressPlace();
  else if (e.code === 'KeyU') { e.preventDefault(); reminder.save(); }
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
  if (e.button === 0) { mouseL = true; clickAtk = true; }
  if (e.button === 2) { mouseR = true; rightDown(performance.now()); }
});
addEventListener('mouseup', (e) => { if (e.button === 0) { mouseL = false; clickAtk = false; stopMining(); } if (e.button === 2) { mouseR = false; rightUp(); } });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (locked) selectSlot(ui.sel + (e.deltaY > 0 ? 1 : -1)); }, { passive: true });
// Phone and tablet controls (touch.js) press the same things the keyboard and mouse do.
const touch = isTouch ? createTouch({
  keys, mode: () => mode, sleeping: () => !!sleeping, wake: () => send({ t: 'wake' }),
  sprint: (on) => { if (on && locked) sprintOn = true; },
  look: (dx, dy) => { if (!locked || sleeping) return; P.yaw -= dx * cfg.sens; P.pitch = Math.max(-1.55, Math.min(1.55, P.pitch - dy * cfg.sens)); },
  mine: (on) => { if (!locked) return; if (on) { mouseL = true; clickAtk = true; } else { mouseL = false; clickAtk = false; stopMining(); } },
  aimsAtFoe: () => { if (!locked || !target || target.k === undefined) return false; const hs = ui.held(), it = hs && itemInfo(hs.id); return !(it && (it.bow || it.food)); }, // a mob or player is under the crosshair (and the hand is not holding a bow or food)
  hit: () => { if (!locked || !target || target.k === undefined) return; stopMining(); const nw = performance.now(); if (nw - lastAtk < Math.max(120, attackCooldown(ui.held()) * 1000) * 0.62) return; lastAtk = nw; attack(target); }, // one tap = one hit, no holding
  use: (on) => { if (on) { if (!locked) return; mouseR = true; rightDown(performance.now()); } else if (mouseR) { mouseR = false; rightUp(); } },
  slot: (i) => selectSlot(i), inventory: () => { if (state === 'play' && !dead) toggleInventory(); }, chat: () => { if (state === 'play' && locked) openChat(); },
  menu: () => unlock(), save: () => reminder.save(), fly: () => { if (mode === 'creative') { P.fly = !P.fly; P.vy = 0; } },
}) : null;

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
// If the server has lost something that the last autosave still has (free hosts reset), put it back. Nothing that is still on the server is touched.
async function autoRestoreOnLoad() {
  try {
    await saveGate.evaluate(); // checks the server against this browser's copy, puts back what the server lost, and only then lets autosave start
    if (saveGate.state === 'needs') { saveGate.show(saveGate.why); return; }
    refreshWorlds();
  } catch { /* the server is busy: Import Game Save still works by hand */ }
}
async function pollHealth() {
  for (let i = 0; i < 70; i++) {
    try {
      const r = await fetch(net.http + '/health', { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j.game === 'voxel-realms') { serverReady = true; window.__vrStorageWarn = j.persistent === false ? 'This server keeps worlds inside its project folder, so an update unzipped into a new folder starts empty. Set DATA_DIR to a permanent folder.' : ''; busy(false); refreshWorlds(); autoRestoreOnLoad(); return menuMsg(''); } }
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
  eyeY += ((sleeping ? 0.25 : riding ? 1.15 : POSE_EYE[pose]) - eyeY) * Math.min(1, dt * 14);
  sleepT = sleeping ? sleepT + dt : 0; // the screen fades to black while you sleep
  $('sleepfade').style.opacity = sleeping ? Math.min(0.92, sleepT / 2.2) : 0; $('sleephint').style.opacity = sleeping ? Math.max(0, Math.min(1, sleepT - 1.2)) : 0;
  camera.position.set(P.x, P.y + eyeY, P.z); camera.rotation.set(P.pitch, P.yaw, 0);
  const hh0 = ui.held(), hi0 = hh0 && itemInfo(hh0.id);
  $('smother').classList.toggle('on', ready && isSolid(getBlock(Math.floor(P.x), Math.floor(P.y + eyeY), Math.floor(P.z)))); // head inside a block: the view goes dark
  const d = lookDir(), o = [P.x, P.y + eyeY, P.z], bh = raycast(o[0], o[1], o[2], d[0], d[1], d[2], mode === 'creative' ? 7 : 5, !!(hi0 && (hi0.bucket === 'empty' || hi0.boat !== undefined))), eh = busyUI ? null : entityRay(o, d, 4.5);
  target = eh && (!bh || eh.t < bh.t) ? eh : bh;
  const blockT = target && target.k === undefined ? target : null;
  if (blockT && !busyUI) { hl.visible = true; hl.position.set(blockT.x + 0.5, blockT.y + 0.5, blockT.z + 0.5); } else hl.visible = false;
  mineDelay = Math.max(0, mineDelay - dt);
  if (locked && !busyUI && mouseL) {
    if (target && target.k !== undefined) {
      stopMining(); const cdm = Math.max(120, attackCooldown(ui.held()) * 1000);
      if (clickAtk) { clickAtk = false; if (now - lastAtk >= cdm * 0.62) { lastAtk = now; attack(target); } } // too early: nothing happens, so spamming gains nothing
      else if (now - lastAtk > cdm) { lastAtk = now; attack(target); } // holding the button swings again as soon as the swing is fully recharged
    }
    else if (blockT && mineDelay <= 0) { const fc = saves.foreign(blockT.x, blockT.z); if (fc) { hint(protectedMsg(fc)); stopMining(); } else mine(blockT, dt); }
    else if (!blockT) stopMining();
  }
  if (locked && !busyUI && mouseR && blockT && !eating && !charging && now - lastPlace > 250) { const hs = ui.held(), it = hs && itemInfo(hs.id); if (it && (it.block || it.seeds)) useBlock(blockT, now); }
  if (eating) { eating.t += dt; if (eating.t >= 1.6) { send({ t: 'eat' }); eating = null; send({ t: 'hold', on: false }); } }
  if (charging) charging.t = Math.min(1.2, charging.t + dt);
  if (swing > 0) { swing += dt * (mining ? 3.2 : 4.5); if (swing >= 1) swing = mining ? 0.001 : 0; }
  { // the attack charge bar under the crosshair fills while the swing recharges
    const hsA = ui.held(), cd = attackCooldown(hsA) * 1000, fr = Math.min(1, (now - lastAtk) / cd);
    atkBar.classList.toggle('on', fr < 1 && locked && !busyUI); atkFill.style.width = `${Math.round(fr * 100)}%`;
  }
  const hs = ui.held(); held.set(hs ? hs.id : 0);
  const off = ui.offhand(), hit = hs && itemInfo(hs.id), usable = hit && (hit.block || hit.food || hit.bow || hit.bucket || hit.bed || hit.door || hit.boat !== undefined || hit.seaweed || hit.hoe || hit.seeds || hit.rod);
  const guarding = !!(locked && !busyUI && !sleeping && mouseR && off && itemInfo(off.id).shield && !usable && !eating && !charging); // hold right click with a shield and nothing else to use
  if (guarding !== guardSent) { guardSent = guarding; send({ t: 'guard', on: guarding }); }
  bobT += dt; held.g.visible = !dead && !ui.isOpen;
  held.update(dt, { swing, eating: !!eating, charge: charging ? Math.min(1, charging.t) : 0, drawing: !!charging, chargeT: charging ? charging.t : 0, guard: guarding, off: off ? off.id : 0, moving: !!(keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyA') || keys.has('KeyD')) && P.ground });
  fishing.update(dt, (id) => { // where the line leaves the rod
    if (id === myId) { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), r = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion); return [camera.position.x + f.x * 0.6 + r.x * 0.32, camera.position.y + f.y * 0.6 - 0.22, camera.position.z + f.z * 0.6 + r.z * 0.32]; }
    const o = others.get(id); return o ? [o.x - Math.sin(o.yaw) * 0.6, o.y + 1.3, o.z - Math.cos(o.yaw) * 0.6] : null;
  });
  updateEnts(dt, now); fx.update(dt);
  borders.update(P.x, P.z, now / 1000); saves.update(P.x, P.z); reminder.tick(dt);
  if (touch) touch.setState(dead || saves.isOpen || chatOpen ? 'hidden' : ui.isOpen ? 'ui' : locked ? 'play' : 'hidden');
  updateWeather(dt, now); sky(true); netSend(now);
  if (now - outsideAt > 300) { // "outside" = open sky overhead: most of five upward rays (centre and four sides) reach the sky, so a few leaves or an eave do not count as a roof
    outsideAt = now; let clear = 0;
    for (const [ox, oz] of [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) if (!raycast(P.x + ox, P.y + eyeY, P.z + oz, 0, 1, 0, CH, false)) clear++;
    outside = clear >= 3;
    underground = !outside && P.y + eyeY < column(Math.floor(P.x), Math.floor(P.z), worldSeed, worldGen).h - 5; // roofed over and well below the natural ground: caves and tunnels, not a house
  }
  audio.update(dt, { on: !dead, ang: skyAng, look: d, x: P.x, y: P.y + eyeY, z: P.z, yaw: P.yaw, mobs, under: eyeInWater(), outside, underground, deep: underground && P.y + eyeY < deepLine(worldGen), biome: biomeNow, wxKind: wxK > 0.02 ? wxKind : 0, wxK, sandK });
  if (now - infoAt > 250) { infoAt = now; $('pos').textContent = `${P.x.toFixed(1)}, ${P.y.toFixed(1)}, ${P.z.toFixed(1)}${P.fly ? ' (flying)' : ''}${riding ? ' (in a boat)' : ''}${biomeName ? ' · ' + biomeName : ''}`; }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  audio.menu(dt, state === 'menu'); // sunset song on the home screen
  if (state === 'play') play(dt, now);
  else {
    const a = still ? 0.8 : now / 22000; // title screen: slow flyover of a generated world
    camera.position.set(Math.cos(a) * 44, 38, Math.sin(a) * 44); camera.lookAt(0, 22, 0);
    wxK = 0; sandK = 0; weather.update(dt, 0, 0, 0, camera.position); streamChunks(camera.position.x, camera.position.z, 10); sky(false); hl.visible = false; held.g.visible = false; fx.update(dt);
  }
  waterTex.offset.y = 1 - ((Math.floor(now / 90) % WATER_FRAMES) + 1) / WATER_FRAMES;
  lavaTex.offset.y = 1 - ((Math.floor(now / 130) % LAVA_FRAMES) + 1) / LAVA_FRAMES;
  flowTex.offset.y = 1 - ((Math.floor(now / 70) % FLOW_FRAMES) + 1) / FLOW_FRAMES;
  renderer.render(scene, camera);
  if (shotWant) { shotWant = false; takeShot(); }
}


/* ---------- "Your worlds": the home screen list, with a picture of where you last looked ---------- */
let shotWant = false, shotAt = 0;
function takeShot() { // a small JPEG of the current view, sent to the server for the world's host only (the server ignores everyone else)
  if (!roomInfo || !roomInfo.owner || roomInfo.locked || !ws || ws.readyState !== 1) return;
  try { // a picture is a nicety: if anything about it fails, the game carries on
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const src = renderer.domElement, sw = src.width, sh = src.height; let cw = sw, ch = sw * 9 / 16; if (ch > sh) { ch = sh; cw = sh * 16 / 9; }
    c.getContext('2d').drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, 320, 180);
    const img = c.toDataURL('image/jpeg', 0.6);
    if (img.length < 65000) send({ t: 'thumb', img });
  } catch { /* ignore */ }
}
setInterval(() => { if (state === 'play' && locked && document.visibilityState === 'visible') shotWant = true; }, 45000);
const ago = (t) => { if (!t) return 'never played'; const m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
async function refreshWorlds() {
  const box = $('myWorlds'), token = store.get('token', null);
  if (!token) { box.innerHTML = ''; const d = document.createElement('div'); d.className = 'wempty'; d.textContent = 'No worlds yet. Create a private world and it will show up here, with a picture of where you left off.'; box.append(d); return; }
  try {
    const r = await fetch(net.http + '/api/myworlds', { method: 'POST', body: JSON.stringify({ token }), cache: 'no-store' });
    const j = await r.json(); box.textContent = '';
    if (!j.worlds || !j.worlds.length) { const d = document.createElement('div'); d.className = 'wempty'; d.textContent = 'No worlds yet. Create a private world and it will show up here, with a picture of where you left off.'; box.append(d); return; }
    const grid = document.createElement('div'); grid.className = 'wgrid';
    for (const w of j.worlds) {
      const card = document.createElement('div'); card.className = 'wcard'; card.tabIndex = 0; card.setAttribute('role', 'button');
      if (w.thumb) { const im = document.createElement('img'); im.className = 'pic'; im.alt = ''; im.src = w.thumb; card.append(im); } else { const n = document.createElement('div'); n.className = 'noimg'; n.textContent = 'NO PICTURE YET'; card.append(n); }
      if (w.live) { const l = document.createElement('span'); l.className = 'live'; l.textContent = 'LIVE'; card.append(l); }
      const inf = document.createElement('div'); inf.className = 'inf'; const b = document.createElement('b'); b.textContent = w.name; const sm = document.createElement('small'); sm.textContent = `${w.mode === 'creative' ? 'Creative' : 'Survival'} · ${w.players ? `${w.players} online` : ago(w.seen)} · code ${w.id}`;
      inf.append(b, sm); card.append(inf);
      const play = document.createElement('button'); play.type = 'button'; play.className = 'go pl'; play.textContent = 'Play'; card.append(play);
      const go = () => { if (serverReady && !$('join').disabled) start({ room: w.id }); };
      card.onclick = go; card.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      grid.append(card);
    }
    box.append(grid);
  } catch { box.textContent = ''; const d = document.createElement('div'); d.className = 'wempty'; d.textContent = 'Could not load your worlds. Is the server running?'; box.append(d); }
}

$('name').value = store.get('name', '');
resetWorld(MENU_SEED, 2);
menuMsg('Finding the game server…');
resolveServer().then((n) => { net = n; return pollHealth(); });
requestAnimationFrame(frame);
