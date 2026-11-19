// Particles (one instanced mesh, so hundreds cost one draw call) and the cracks drawn on a block while it is mined.
import * as THREE from 'three';
import { BLOCKS } from './shared/world.js';
import { tileColor, crackCanvas } from './icons.js';

export class Particles {
  constructor(scene, max = 400) {
    this.max = max; this.n = 0; this.cursor = 0;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), max);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.p = Array.from({ length: max }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, size: 0, gravity: 1 }));
    this.dummy = new THREE.Object3D(); this.col = new THREE.Color();
    scene.add(this.mesh);
  }
  add(x, y, z, vx, vy, vz, rgb, size, life, gravity = 1) {
    const i = this.cursor++ % this.max, q = this.p[i];
    Object.assign(q, { x, y, z, vx, vy, vz, life, size, gravity, max: life });
    this.col.setRGB(rgb[0], rgb[1], rgb[2]); this.mesh.setColorAt(i, this.col);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.n = Math.min(this.max, this.n + 1);
  }
  burst(x, y, z, rgb, count, speed = 2.5, size = 0.1, life = 0.7) {
    for (let i = 0; i < count; i++) {
      const j = 0.75 + Math.random() * 0.5;
      this.add(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * speed, Math.random() * speed * 0.9, (Math.random() - 0.5) * speed, [rgb[0] * j, rgb[1] * j, rgb[2] * j], size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6));
    }
  }
  blockBreak(id, x, y, z, count = 24) { // chips of the block's own colour
    const def = BLOCKS[id]; if (!def) return;
    this.burst(x + 0.5, y + 0.5, z + 0.5, tileColor(def.t[2]), count, 3.2, 0.11, 0.8);
  }
  blockChip(id, x, y, z, face) { // a couple of crumbs flying off the face being mined
    const def = BLOCKS[id]; if (!def) return;
    const c = tileColor(def.t[2]), px = x + 0.5 + face[0] * 0.5, py = y + 0.5 + face[1] * 0.5, pz = z + 0.5 + face[2] * 0.5;
    for (let i = 0; i < 2; i++) this.add(px + (Math.random() - 0.5) * 0.7, py + (Math.random() - 0.5) * 0.7, pz + (Math.random() - 0.5) * 0.7, face[0] * 1.4 + (Math.random() - 0.5), 1 + Math.random(), face[2] * 1.4 + (Math.random() - 0.5), c, 0.07, 0.5);
  }
  explosion(x, y, z) {
    this.burst(x, y, z, [0.35, 0.35, 0.35], 40, 8, 0.28, 1.1); this.burst(x, y, z, [1, 0.62, 0.15], 28, 7, 0.2, 0.6); this.burst(x, y, z, [0.95, 0.95, 0.95], 16, 5, 0.18, 0.9);
  }
  update(dt) {
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      const q = this.p[i];
      if (q.life > 0) {
        q.life -= dt; q.vy -= 14 * q.gravity * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.vx *= 0.985; q.vz *= 0.985;
        const k = q.life > 0 ? Math.min(1, q.life / (q.max * 0.5)) : 0;
        this.dummy.position.set(q.x, q.y, q.z); this.dummy.scale.setScalar(q.size * k); this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix); live = i + 1;
      } else { this.dummy.scale.setScalar(0); this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix); }
    }
    this.mesh.count = Math.max(live, Math.min(this.n, this.max));
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Cracks {
  constructor(scene) {
    this.tex = new THREE.CanvasTexture(crackCanvas);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter; this.tex.generateMipmaps = false;
    this.tex.repeat.set(0.1, 1);
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.mesh.visible = false; this.mesh.renderOrder = 2; scene.add(this.mesh);
  }
  show(x, y, z, stage) { this.tex.offset.x = Math.max(0, Math.min(9, stage)) * 0.1; this.mesh.position.set(x + 0.5, y + 0.5, z + 0.5); this.mesh.visible = true; }
  hide() { this.mesh.visible = false; }
}
