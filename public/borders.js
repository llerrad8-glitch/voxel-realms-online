// Visible borders for protected chunks: four see-through walls with a block grid, corner posts and a bright outline,
// green for your own chunks and red for other players'. Only chunks near you are drawn.
import * as THREE from 'three';
import { CS, CH } from './shared/world.js';

function gridTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,.22)'; // faint line every block would be too busy: one every four blocks
  for (let i = 16; i < 64; i += 16) { g.fillRect(i, 0, 1, 64); g.fillRect(0, i, 64, 1); }
  g.fillStyle = 'rgba(255,255,255,.95)'; g.fillRect(0, 0, 64, 2); g.fillRect(0, 62, 64, 2); g.fillRect(0, 0, 2, 64); g.fillRect(62, 0, 2, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Borders {
  constructor(scene) {
    this.scene = scene; this.items = new Map(); this.tex = gridTexture();
    this.mats = {};
    for (const [k, col] of [['mine', 0x4cff7a], ['other', 0xff5a4a]]) {
      this.mats[k] = {
        wall: new THREE.MeshBasicMaterial({ map: this.tex, color: col, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
        line: new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.95 }),
      };
    }
  }
  set(list) {
    for (const it of this.items.values()) { this.scene.remove(it.g); it.g.traverse((n) => { if (n.geometry) n.geometry.dispose(); }); }
    this.items.clear();
    for (const c of list || []) {
      const g = new THREE.Group(), m = this.mats[c.mine ? 'mine' : 'other'], x0 = c.cx * CS, z0 = c.cz * CS, h = CH;
      const wall = (w, rotY, px, pz) => {
        const geo = new THREE.PlaneGeometry(w, h); geo.attributes.uv.array.forEach((v, i, a) => { a[i] = i % 2 ? v * (h / 16) : v * (w / 16); });
        const mesh = new THREE.Mesh(geo, m.wall); mesh.rotation.y = rotY; mesh.position.set(px, h / 2, pz); mesh.renderOrder = 3; g.add(mesh);
      };
      wall(CS, 0, x0 + CS / 2, z0); wall(CS, 0, x0 + CS / 2, z0 + CS); wall(CS, Math.PI / 2, x0, z0 + CS / 2); wall(CS, Math.PI / 2, x0 + CS, z0 + CS / 2);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(CS, h, CS)), m.line);
      edges.position.set(x0 + CS / 2, h / 2, z0 + CS / 2); edges.renderOrder = 4; g.add(edges);
      g.visible = false; this.scene.add(g); this.items.set(`${c.cx},${c.cz}`, { g, x0, z0 });
    }
  }
  // Show a chunk's borders while you are within 28 blocks of it (or standing in it).
  update(px, pz, t) {
    const pulse = 0.17 + 0.05 * Math.sin(t * 2);
    for (const it of this.items.values()) {
      const dx = Math.max(it.x0 - px, 0, px - (it.x0 + CS)), dz = Math.max(it.z0 - pz, 0, pz - (it.z0 + CS));
      it.g.visible = Math.hypot(dx, dz) < 28;
    }
    this.mats.mine.wall.opacity = this.mats.other.wall.opacity = pulse;
  }
}
