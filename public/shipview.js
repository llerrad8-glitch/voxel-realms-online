// Draws a ship: its blocks are meshed by the same mesher as the world (the ship's grid is laid out as little chunks far from the origin), and every cannon gets a barrel.
import * as THREE from 'three';
import { CS, isCannon, cannonDir } from './shared/world.js';
import { unbk } from './shared/ships.js';
import { buildMeshData, padChunk } from './mesher.js';

const OFF = 32, OFFY = 16; // block (lx, ly, lz) sits at (lx + OFF, ly + OFFY, lz + OFF) in the little chunk grid
const EMPTY = new Uint8Array(CS * CS); // (an empty neighbour: one row of air)
const barrelMat = new THREE.MeshBasicMaterial({ color: 0x2c2e33 }), ringMat = new THREE.MeshBasicMaterial({ color: 0x55585f });
export function cannonBarrel(dx, dz) { // a barrel lying along (dx, dz), standing on the cannon block's top
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 1.15, 10), barrelMat); b.rotation.x = Math.PI / 2; b.position.set(0, 0, 0); g.add(b);
  const r = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.12, 10), ringMat); r.rotation.x = Math.PI / 2; r.position.set(0, 0, -0.5); g.add(r);
  g.rotation.y = Math.atan2(dx, dz); // the barrel lies along local z; point it along (dx, dz)
  return g;
}
// Build the meshes for a block map (key -> id). Returns a group in ship-local coordinates.
export function buildShipGroup(blocks, mats) {
  const root = new THREE.Group(), inner = new THREE.Group();
  inner.position.set(-(OFF + 0.5), -OFFY, -(OFF + 0.5)); root.add(inner);
  const chunks = new Map(); let maxY = 0;
  for (const [k, id] of blocks) { const [x, y, z] = unbk(k), py = y + OFFY; if (py > maxY) maxY = py; if (py < 0) continue; }
  const rows = Math.min(255, maxY + 2);
  for (const [k, id] of blocks) {
    const [x, y, z] = unbk(k), px = x + OFF, py = y + OFFY, pz = z + OFF;
    if (px < 0 || pz < 0 || px >= 4 * CS || pz >= 4 * CS || py < 0) continue;
    const key = (px >> 4) + ',' + (pz >> 4); let c = chunks.get(key);
    if (!c) chunks.set(key, (c = new Uint8Array(CS * CS * rows)));
    c[(px & 15) + CS * ((pz & 15) + CS * py)] = id;
    if (isCannon(id)) { const [dx, dz] = cannonDir(id), bar = cannonBarrel(dx, dz); bar.position.set(x + dx * 0.55, y + 0.75, z + dz * 0.55); root.add(bar); }
  }
  const geos = [];
  for (const key of chunks.keys()) {
    const [cx, cz] = key.split(',').map(Number), ch = [];
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const n = chunks.get(`${cx + a},${cz + b}`); ch.push(padChunk(n || EMPTY, (b + 1) * 3 + a + 1)); }
    const parts = buildMeshData(cx, cz, ch, false, 0);
    for (const [pk, mat] of [['o', mats.o], ['t', mats.t], ['p', mats.p]]) {
      const q = parts[pk]; if (!q) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(q.p, 3)); g.setAttribute('uv', new THREE.BufferAttribute(q.u, 2)); g.setAttribute('color', new THREE.BufferAttribute(q.c, 3)); g.setIndex(new THREE.BufferAttribute(q.i, 1));
      g.boundingBox = new THREE.Box3(new THREE.Vector3(...q.min), new THREE.Vector3(...q.max)); g.boundingSphere = new THREE.Sphere(); g.boundingBox.getBoundingSphere(g.boundingSphere);
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; inner.add(m); geos.push(g);
    }
  }
  root.userData.geos = geos;
  return root;
}
export function disposeShipGroup(g) { for (const geo of g.userData.geos || []) geo.dispose(); g.traverse((o) => { if (o.geometry && !(g.userData.geos || []).includes(o.geometry)) o.geometry.dispose(); }); }
