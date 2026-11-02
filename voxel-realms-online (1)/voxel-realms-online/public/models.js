// 3D models built from shaded boxes: eleven creatures, players with armor and held items, drops, arrows, the first-person hand.
import * as THREE from 'three';
import { BLOCKS } from './shared/world.js';
import { ITEMS, ARMOR_MATS } from './shared/items.js';
import { MOB_TYPES } from './shared/mobs.js';
import { atlas, UV, iconCanvas } from './icons.js';

export const atlasTex = new THREE.CanvasTexture(atlas);
atlasTex.magFilter = atlasTex.minFilter = THREE.NearestFilter; atlasTex.generateMipmaps = false; atlasTex.colorSpace = THREE.SRGBColorSpace;

const nearest = (t) => { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace; return t; };
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const noiseTex = (() => { // faint pixel noise so flat colours do not look plastic
  const c = cv(16, 16), g = c.getContext('2d'); let s = 7;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const v = 218 + ((s >>> 24) % 38); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 1, 1); }
  return nearest(new THREE.CanvasTexture(c));
})();
const SH = [0.8, 0.8, 1, 0.55, 0.72, 0.72]; // +x -x +y -y +z -z
const tint = (hex, f) => ((Math.min(255, ((hex >> 16) & 255) * f) | 0) << 16) | ((Math.min(255, ((hex >> 8) & 255) * f) | 0) << 8) | (Math.min(255, (hex & 255) * f) | 0);
const matCache = new Map();
function mats(color, front) {
  const key = front ? null : color;
  if (key !== null && matCache.has(key)) return matCache.get(key);
  const m = SH.map((s, i) => (i === 4 && front ? new THREE.MeshBasicMaterial({ color: tint(0xffffff, s), map: front }) : new THREE.MeshBasicMaterial({ color: tint(color, s), map: noiseTex })));
  if (key !== null) matCache.set(key, m);
  return m;
}
function faceTex(base, paint) { // a 16 x 16 face drawn in code
  const c = cv(16, 16), g = c.getContext('2d'); let s = 5;
  const css = `#${base.toString(16).padStart(6, '0')}`;
  g.fillStyle = css; g.fillRect(0, 0, 16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; g.fillStyle = `rgba(0,0,0,${((s >>> 24) % 24) / 255})`; g.fillRect(x, y, 1, 1); }
  const r = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  paint(r);
  return nearest(new THREE.CanvasTexture(c));
}
const redMats = (m) => m.map((x) => new THREE.MeshBasicMaterial({ color: tint(0xff6a5a, 0.9 * (x.color.r || 0.8) + 0.1), map: x.map }));

export class Model {
  constructor() { this.g = new THREE.Group(); this.parts = []; this.flash = false; this.phase = 0; }
  setFlash(on) { if (on === this.flash) return; this.flash = on; for (const p of this.parts) p.material = on ? (p.userData.red ||= redMats(p.userData.mats)) : p.userData.mats; }
}
function B(m, parent, w, h, d, pos, color, front) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats(color, front));
  mesh.userData.mats = mesh.material; mesh.position.set(pos[0], pos[1], pos[2]); parent.add(mesh); m.parts.push(mesh);
  return mesh;
}
function Limb(m, parent, joint, w, h, d, color, up) { // a box that swings around its top end (or bottom end when up)
  const piv = new THREE.Group(); piv.position.set(joint[0], joint[1], joint[2]); parent.add(piv);
  B(m, piv, w, h, d, [0, up ? h / 2 : -h / 2, 0], color);
  return piv;
}
const sway = (m, st, k = 1) => { m.phase += st.speed * 2.3 * st.dt; return Math.sin(m.phase) * Math.min(1, st.speed / 1.5) * k; };

/* ---------- humanoids: player, zombie, skeleton ---------- */
function humanoid(m, o) {
  const g = m.g, t = o.thin || 1, lw = 0.24 * t, aw = 0.22 * t;
  const legL = Limb(m, g, [-0.13, 0.7, 0], lw, 0.7, lw, o.pants), legR = Limb(m, g, [0.13, 0.7, 0], lw, 0.7, lw, o.pants);
  B(m, g, 0.5, 0.65, 0.26 * (o.thin ? 0.7 : 1), [0, 1.025, 0], o.shirt);
  const armL = Limb(m, g, [-0.36, 1.33, 0], aw, 0.65, aw, o.shirt), armR = Limb(m, g, [0.36, 1.33, 0], aw, 0.65, aw, o.shirt);
  for (const a of [armL, armR]) B(m, a, aw, 0.14, aw, [0, -0.58, 0], o.skin);
  const head = Limb(m, g, [0, 1.35, 0], 0.45, 0.45, 0.45, o.skin, true);
  head.children[0].material = head.children[0].userData.mats = mats(o.skin, faceTex(o.skin, o.face));
  if (o.hair) { B(m, head, 0.47, 0.12, 0.47, [0, 0.4, 0], o.hair); B(m, head, 0.47, 0.3, 0.1, [0, 0.27, -0.19], o.hair); }
  m.rig = { legL, legR, armL, armR, head };
  return m.rig;
}
const ARM_COL = [0xa06a42, 0xd0d4d8, 0xf2c93c, 0x4fe0d6];
function addArmor(m) { // hidden armor shells that appear when pieces are worn
  const r = m.rig, a = (parent, w, h, d, pos) => { const x = B(m, parent, w, h, d, pos, 0xcccccc); x.visible = false; return x; };
  m.armor = [
    [a(r.head, 0.52, 0.52, 0.52, [0, 0.225, 0])],
    [a(m.g, 0.56, 0.69, 0.32, [0, 1.025, 0]), a(r.armL, 0.26, 0.4, 0.26, [0, -0.2, 0]), a(r.armR, 0.26, 0.4, 0.26, [0, -0.2, 0])],
    [a(r.legL, 0.29, 0.4, 0.29, [0, -0.2, 0]), a(r.legR, 0.29, 0.4, 0.29, [0, -0.2, 0]), a(m.g, 0.52, 0.18, 0.3, [0, 0.76, 0])],
    [a(r.legL, 0.3, 0.22, 0.3, [0, -0.59, 0]), a(r.legR, 0.3, 0.22, 0.3, [0, -0.59, 0])],
  ];
  m.hand = new THREE.Group(); m.hand.position.set(0, -0.62, 0.1); r.armR.add(m.hand);
}
export function setEquipment(m, held, arm) {
  if (m.armor) arm.forEach((id, i) => {
    for (const mesh of m.armor[i]) {
      mesh.visible = !!id;
      if (id) { mesh.userData.mats = mats(ARM_COL[(id - 310) % 4], null); if (!m.flash) mesh.material = mesh.userData.mats; delete mesh.userData.red; }
    }
  });
  if (m.hand && m.heldId !== held) {
    m.heldId = held;
    while (m.hand.children.length) m.hand.remove(m.hand.children[0]);
    if (held) { const it = itemMesh(held, 0.5); it.rotation.set(0, Math.PI / 2, 0); if (!ITEMS.get(held).block) it.rotation.z = -0.4; m.hand.add(it); }
  }
}
export function makePlayer(color) {
  const m = new Model();
  humanoid(m, {
    skin: 0xe5b98c, shirt: color, pants: 0x3a3f7a, hair: 0x4a3320,
    face: (r) => { r(3, 6, 3, 2, '#f4f4f4'); r(10, 6, 3, 2, '#f4f4f4'); r(4, 6, 2, 2, '#3b4d8c'); r(10, 6, 2, 2, '#3b4d8c'); r(6, 11, 4, 1, '#9a6252'); },
  });
  addArmor(m);
  m.update = (st) => {
    const s = sway(m, st), r = m.rig;
    r.legL.rotation.x = s * 0.9; r.legR.rotation.x = -s * 0.9; r.armL.rotation.x = -s * 0.7; r.armR.rotation.x = s * 0.7;
    if (st.swing > 0) r.armR.rotation.x = -1.7 * Math.sin(st.swing * Math.PI);
    r.head.rotation.x = -(st.pitch || 0) * 0.8;
  };
  return m;
}

/* ---------- creatures ---------- */
const eyes = (r, y = 5, col = '#1b1414') => { r(3, y, 2, 2, col); r(11, y, 2, 2, col); };
function quad(m, c) { // four-legged body plan shared by pig, cow, sheep, wolf
  const legs = c.legs.map(([x, z]) => Limb(m, m.g, [x, c.legH, z], c.legW, c.legH, c.legW, c.legCol));
  B(m, m.g, c.body[0], c.body[1], c.body[2], [0, c.legH + c.body[1] / 2, 0], c.bodyCol);
  const head = Limb(m, m.g, [0, c.headY, c.headZ], c.head[0], c.head[1], c.head[2], c.headCol, true);
  head.children[0].material = head.children[0].userData.mats = mats(c.headCol, faceTex(c.headCol, c.face));
  m.rig = { legs, head };
  return m.rig;
}
function quadAnim(m, st) {
  const s = sway(m, st, 0.8), { legs, head } = m.rig;
  legs.forEach((l, i) => { l.rotation.x = (i === 0 || i === 3 ? s : -s); });
  head.rotation.x = st.flags & 64 ? -0.4 : Math.sin(m.phase * 0.3) * 0.04;
}
const BUILD = {
  pig(m) {
    quad(m, { legH: 0.3, legW: 0.2, legs: [[-0.18, 0.28], [0.18, 0.28], [-0.18, -0.28], [0.18, -0.28]], legCol: 0xe08a95, body: [0.62, 0.55, 0.92], bodyCol: 0xf0a3ac, headY: 0.62, headZ: 0.5, head: [0.46, 0.42, 0.42], headCol: 0xf2a8b1, face: (r) => eyes(r, 5) });
    B(m, m.rig.head, 0.26, 0.18, 0.1, [0, 0.14, 0.26], 0xf8bcc4); B(m, m.rig.head, 0.05, 0.07, 0.03, [-0.05, 0.14, 0.32], 0xa85a66); B(m, m.rig.head, 0.05, 0.07, 0.03, [0.05, 0.14, 0.32], 0xa85a66);
    B(m, m.g, 0.07, 0.07, 0.1, [0, 0.62, -0.5], 0xe08a95);
    m.update = (st) => quadAnim(m, st);
  },
  cow(m) {
    quad(m, { legH: 0.5, legW: 0.2, legs: [[-0.22, 0.4], [0.22, 0.4], [-0.22, -0.4], [0.22, -0.4]], legCol: 0xcfcfcf, body: [0.72, 0.7, 1.1], bodyCol: 0xeeeeee, headY: 1.1, headZ: 0.62, head: [0.5, 0.5, 0.44], headCol: 0xdcdcdc, face: (r) => { eyes(r, 5); r(4, 0, 8, 3, '#2d2d2d'); } });
    B(m, m.g, 0.74, 0.28, 0.36, [0, 0.95, 0.2], 0x2d2d2d); B(m, m.g, 0.74, 0.3, 0.34, [0, 0.8, -0.25], 0x2d2d2d); B(m, m.g, 0.5, 0.06, 0.4, [0, 1.06, -0.1], 0x2d2d2d);
    B(m, m.rig.head, 0.34, 0.2, 0.1, [0, 0.1, 0.25], 0xe8b7b0); B(m, m.rig.head, 0.08, 0.2, 0.08, [-0.28, 0.5, 0], 0xd9d2b4); B(m, m.rig.head, 0.08, 0.2, 0.08, [0.28, 0.5, 0], 0xd9d2b4);
    B(m, m.g, 0.22, 0.1, 0.24, [0, 0.52, -0.2], 0xe8b7b0);
    m.update = (st) => quadAnim(m, st);
  },
  sheep(m, aux) {
    const wool = [0xf1f1f1, 0x9a9a9a, 0x7a5a3a, 0x2f2f2f][aux] ?? 0xf1f1f1;
    quad(m, { legH: 0.5, legW: 0.17, legs: [[-0.2, 0.3], [0.2, 0.3], [-0.2, -0.3], [0.2, -0.3]], legCol: 0xa89378, body: [0.5, 0.45, 0.8], bodyCol: 0xa89378, headY: 1.0, headZ: 0.46, head: [0.36, 0.4, 0.4], headCol: 0xbda58b, face: (r) => eyes(r, 6) });
    B(m, m.g, 0.84, 0.74, 1.1, [0, 0.88, -0.02], wool); B(m, m.rig.head, 0.44, 0.16, 0.44, [0, 0.42, -0.02], wool);
    for (const [x, z] of [[-0.2, 0.3], [0.2, 0.3], [-0.2, -0.3], [0.2, -0.3]]) B(m, m.g, 0.26, 0.2, 0.26, [x, 0.58, z], wool);
    m.update = (st) => quadAnim(m, st);
  },
  wolf(m) {
    quad(m, { legH: 0.4, legW: 0.13, legs: [[-0.12, 0.28], [0.12, 0.28], [-0.12, -0.28], [0.12, -0.28]], legCol: 0xa8a8a8, body: [0.36, 0.36, 0.7], bodyCol: 0xb9b9b9, headY: 0.7, headZ: 0.42, head: [0.34, 0.32, 0.3], headCol: 0xc2c2c2, face: (r) => { eyes(r, 5, '#2a2a2a'); r(5, 12, 6, 2, '#3a3a3a'); } });
    B(m, m.rig.head, 0.2, 0.16, 0.2, [0, 0.1, 0.24], 0xdadada); B(m, m.rig.head, 0.07, 0.07, 0.04, [0, 0.16, 0.35], 0x222222);
    B(m, m.rig.head, 0.1, 0.12, 0.05, [-0.12, 0.38, -0.04], 0xa0a0a0); B(m, m.rig.head, 0.1, 0.12, 0.05, [0.12, 0.38, -0.04], 0xa0a0a0);
    const tail = new THREE.Group(); tail.position.set(0, 0.7, -0.38); m.g.add(tail); B(m, tail, 0.1, 0.1, 0.38, [0, 0.12, -0.16], 0xb0b0b0); tail.rotation.x = 0.7;
    m.update = (st) => { quadAnim(m, st); tail.rotation.z = Math.sin(m.phase * 0.7) * 0.25; };
  },
  chicken(m) {
    const legs = [-0.07, 0.07].map((x) => Limb(m, m.g, [x, 0.25, 0], 0.05, 0.25, 0.05, 0xf2a63a));
    for (const l of legs) B(m, l, 0.1, 0.03, 0.14, [0, -0.25, 0.04], 0xf2a63a);
    B(m, m.g, 0.34, 0.34, 0.5, [0, 0.42, 0], 0xf6f6f6); B(m, m.g, 0.18, 0.2, 0.12, [0, 0.5, -0.3], 0xe2e2e2);
    const head = Limb(m, m.g, [0, 0.5, 0.2], 0.2, 0.26, 0.2, 0xf8f8f8, true);
    B(m, head, 0.12, 0.06, 0.1, [0, 0.14, 0.14], 0xf2a63a); B(m, head, 0.06, 0.1, 0.04, [0, 0.04, 0.12], 0xd03030); B(m, head, 0.06, 0.08, 0.12, [0, 0.3, 0], 0xd03030);
    B(m, head, 0.03, 0.04, 0.03, [-0.1, 0.18, 0.06], 0x111111); B(m, head, 0.03, 0.04, 0.03, [0.1, 0.18, 0.06], 0x111111);
    const wl = Limb(m, m.g, [-0.19, 0.55, 0], 0.04, 0.2, 0.3, 0xe6e6e6, false), wr = Limb(m, m.g, [0.19, 0.55, 0], 0.04, 0.2, 0.3, 0xe6e6e6, false);
    m.update = (st) => { const s = sway(m, st, 1); legs[0].rotation.x = s; legs[1].rotation.x = -s; head.rotation.x = Math.abs(Math.sin(m.phase * 0.5)) * 0.2; const fl = st.flags & 32 ? 0 : 0.9 + Math.sin(st.t * 30) * 0.4; wl.rotation.z = fl; wr.rotation.z = -fl; };
  },
  rabbit(m) {
    const fr = [-0.07, 0.07].map((x) => Limb(m, m.g, [x, 0.1, 0.12], 0.07, 0.1, 0.07, 0x9a7a58)), hr = [-0.1, 0.1].map((x) => Limb(m, m.g, [x, 0.14, -0.12], 0.09, 0.14, 0.2, 0x8f6f4e));
    const body = new THREE.Group(); body.position.y = 0.12; m.g.add(body);
    B(m, body, 0.28, 0.26, 0.42, [0, 0.14, 0], 0xa3825f); B(m, body, 0.12, 0.12, 0.1, [0, 0.16, -0.26], 0xf2f2f2);
    const head = Limb(m, body, [0, 0.2, 0.2], 0.22, 0.2, 0.22, 0xa88866, true);
    head.children[0].material = head.children[0].userData.mats = mats(0xa88866, faceTex(0xa88866, (r) => { r(3, 6, 2, 2, '#1a1010'); r(11, 6, 2, 2, '#1a1010'); r(7, 10, 2, 1, '#e8a0a0'); }));
    B(m, head, 0.06, 0.28, 0.05, [-0.06, 0.34, -0.02], 0x9a7a58); B(m, head, 0.06, 0.28, 0.05, [0.06, 0.34, -0.02], 0x9a7a58);
    m.update = (st) => { const air = !(st.flags & 32); body.rotation.x = air ? -0.4 : 0; hr.forEach((l) => { l.rotation.x = air ? 0.7 : 0; }); fr.forEach((l) => { l.rotation.x = air ? -0.5 : 0; }); };
  },
  zombie(m) {
    humanoid(m, { skin: 0x5c9b4a, shirt: 0x2e8aa6, pants: 0x33408a, face: (r) => { r(3, 6, 3, 2, '#1b2a18'); r(10, 6, 3, 2, '#1b2a18'); r(7, 8, 2, 2, '#4a8a3a'); r(5, 11, 6, 2, '#243019'); r(6, 12, 1, 1, '#8aa57a'); } });
    m.g.scale.setScalar(1.08);
    m.update = (st) => { const s = sway(m, st), r = m.rig; r.legL.rotation.x = s; r.legR.rotation.x = -s; const up = st.flags & 16 ? -1.9 : -1.45; r.armL.rotation.x = up + s * 0.15; r.armR.rotation.x = up - s * 0.15; r.armL.rotation.z = 0.08; r.armR.rotation.z = -0.08; };
  },
  skeleton(m) {
    humanoid(m, { skin: 0xdcdccf, shirt: 0xd2d2c4, pants: 0xc4c4b6, thin: 0.62, face: (r) => { r(3, 6, 3, 3, '#2a2a28'); r(10, 6, 3, 3, '#2a2a28'); r(7, 9, 2, 2, '#9a9a90'); r(4, 12, 8, 1, '#4a4a46'); for (let x = 5; x < 12; x += 2) r(x, 12, 1, 2, '#e8e8dc'); } });
    for (const y of [0.9, 1.05, 1.2]) B(m, m.g, 0.4, 0.05, 0.02, [0, y, 0.14], 0x55554f);
    m.g.scale.setScalar(1.08);
    m.hand = new THREE.Group(); m.hand.position.set(0, -0.6, 0.1); m.rig.armR.add(m.hand);
    const bow = itemMesh(281, 0.7); bow.rotation.set(0, Math.PI / 2, 0.2); m.hand.add(bow);
    m.update = (st) => { const s = sway(m, st), r = m.rig; r.legL.rotation.x = s; r.legR.rotation.x = -s; r.armL.rotation.x = -s * 0.5; r.armR.rotation.x = st.flags & 8 ? -1.5 : -0.5 + s * 0.4; r.armL.rotation.x = st.flags & 8 ? -1.4 : r.armL.rotation.x; };
  },
  spider(m) {
    const legs = [];
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1, k = i % 4, piv = new THREE.Group(); piv.position.set(side * 0.2, 0.45, 0.2 - k * 0.14); m.g.add(piv);
      const up = new THREE.Group(); piv.add(up); B(m, up, 0.9, 0.06, 0.06, [side * 0.42, 0, 0], 0x241d19); B(m, up, 0.06, 0.4, 0.06, [side * 0.86, -0.2, 0], 0x241d19);
      piv.rotation.y = side * (0.5 - k * 0.3); legs.push({ piv, side, k });
    }
    B(m, m.g, 0.5, 0.4, 0.5, [0, 0.45, 0.1], 0x2f2722); B(m, m.g, 0.72, 0.52, 0.78, [0, 0.5, -0.5], 0x3a302a);
    const head = Limb(m, m.g, [0, 0.45, 0.35], 0.38, 0.34, 0.38, 0x2b231f, true);
    head.children[0].material = head.children[0].userData.mats = mats(0x2b231f, faceTex(0x2b231f, (r) => { r(2, 5, 3, 3, '#d62a2a'); r(11, 5, 3, 3, '#d62a2a'); r(6, 3, 2, 2, '#b01818'); r(8, 3, 2, 2, '#b01818'); r(5, 11, 6, 2, '#120d0b'); }));
    m.update = (st) => { const s = Math.sin((m.phase += st.speed * 3 * st.dt)); for (const { piv, side, k } of legs) { piv.rotation.z = Math.sin(m.phase + k * 1.3 + (side > 0 ? 1.5 : 0)) * 0.22 * Math.min(1, st.speed / 1.5) + side * -0.15; } void s; };
  },
  boomer(m) {
    const col = 0x5cb04c;
    const legs = [[-0.14, 0.2], [0.14, 0.2], [-0.14, -0.2], [0.14, -0.2]].map(([x, z]) => Limb(m, m.g, [x, 0.4, z], 0.22, 0.4, 0.22, 0x4a9a3c));
    B(m, m.g, 0.5, 0.8, 0.3, [0, 0.8, 0], col);
    const head = Limb(m, m.g, [0, 1.2, 0], 0.5, 0.5, 0.5, 0x64bd54, true);
    head.children[0].material = head.children[0].userData.mats = mats(0x64bd54, faceTex(0x64bd54, (r) => { r(3, 5, 3, 3, '#111'); r(10, 5, 3, 3, '#111'); r(4, 4, 3, 1, '#143010'); r(9, 4, 3, 1, '#143010'); r(4, 11, 8, 1, '#111'); r(5, 12, 2, 1, '#111'); r(9, 12, 2, 1, '#111'); r(6, 10, 1, 1, '#111'); r(9, 10, 1, 1, '#111'); r(3, 5, 1, 1, '#fff'); r(10, 5, 1, 1, '#fff'); }));
    m.g.scale.setScalar(1.0);
    m.update = (st) => { const s = sway(m, st); legs.forEach((l, i) => { l.rotation.x = i === 0 || i === 3 ? s : -s; }); const f = st.fuse || 0; m.g.scale.setScalar(1 + f * 0.18 + (f > 0 ? Math.sin(st.t * 40) * 0.03 : 0)); m.setFlash(f > 0 && Math.sin(st.t * 22) > 0); };
  },
  slime(m) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x70d44a, transparent: true, opacity: 0.72, depthWrite: false, map: noiseTex });
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.56, 0.56), new THREE.MeshBasicMaterial({ color: 0x3d8f2b, map: noiseTex }));
    inner.position.y = 0.5; m.g.add(inner);
    const eyeM = new THREE.MeshBasicMaterial({ color: 0x14250f });
    for (const x of [-0.17, 0.17]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.04), eyeM); e.position.set(x, 0.58, 0.29); m.g.add(e); }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.04), eyeM); mouth.position.set(0, 0.4, 0.29); m.g.add(mouth);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat); shell.position.y = 0.5; m.g.add(shell);
    m.update = (st) => { const s = st.size || 1, sq = st.flags & 32 ? 1 : 1 + Math.min(0.35, Math.abs(st.vy || 0) * 0.04); m.g.scale.set(0.55 * s / Math.sqrt(sq), 0.55 * s * sq * (st.flags & 32 ? 0.88 : 1), 0.55 * s / Math.sqrt(sq)); };
  },
};
export function makeMob(typeIdx, aux = 0) {
  const m = new Model(), name = MOB_TYPES[typeIdx];
  BUILD[name](m, aux);
  return m;
}

/* ---------- items in the world, in hand, and arrows ---------- */
const FACES = [
  { d: [1, 0, 0], s: 0.8, k: 2, v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] }, { d: [-1, 0, 0], s: 0.8, k: 2, v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { d: [0, 1, 0], s: 1, k: 0, v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] }, { d: [0, -1, 0], s: 0.5, k: 1, v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { d: [0, 0, 1], s: 0.7, k: 2, v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] }, { d: [0, 0, -1], s: 0.7, k: 2, v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
const itemCache = new Map();
const blockItemMat = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true });
export function itemMesh(id, size = 0.4) { // a little cube for blocks, a flat double-sided picture for everything else
  let c = itemCache.get(id);
  if (!c) {
    const it = ITEMS.get(id);
    if (it && it.block) {
      const p = [], u = [], col = [], ix = [], def = BLOCKS[it.block];
      for (const F of FACES) { const base = p.length / 3, uv = UV[def.t[F.k]]; for (const q of F.v) { p.push(q[0] - 0.5, q[1] - 0.5, q[2] - 0.5); col.push(F.s, F.s, F.s); } u.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]); ix.push(base, base + 1, base + 2, base, base + 2, base + 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(ix);
      c = { geo: g, mat: blockItemMat, flat: false };
    } else c = { geo: new THREE.PlaneGeometry(1, 1), mat: new THREE.MeshBasicMaterial({ map: nearest(new THREE.CanvasTexture(iconCanvas(id))), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }), flat: true };
    itemCache.set(id, c);
  }
  const m = new THREE.Mesh(c.geo, c.mat);
  m.scale.setScalar(c.flat ? size * 1.5 : size);
  return m;
}
export function arrowMesh() {
  const g = new THREE.Group(), shaft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.7), new THREE.MeshBasicMaterial({ color: 0x8a6a3a }));
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: 0x9a9ea4 })); head.position.z = 0.38;
  const fl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0xf0f0f0 })); fl.position.z = -0.32;
  g.add(shaft, head, fl);
  return g;
}

/* ---------- first-person hand ---------- */
export class HeldView {
  constructor(camera, scene) {
    this.g = new THREE.Group(); this.holder = new THREE.Group(); this.id = -1; this.t = 0;
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.62), mats(0xe5b98c, null)); this.arm.position.set(0, 0, 0.1);
    this.g.add(this.arm, this.holder); scene.add(camera); camera.add(this.g);
    this.g.position.set(0.42, -0.42, -0.62);
  }
  set(id) {
    if (id === this.id) return; this.id = id;
    while (this.holder.children.length) this.holder.remove(this.holder.children[0]);
    this.arm.visible = !id;
    if (id) { const it = ITEMS.get(id), m = itemMesh(id, it.block ? 0.3 : 0.5); m.position.set(0, it.block ? -0.02 : 0.08, 0); m.rotation.set(0, it.block ? 0.5 : 0.6, it.block ? 0 : -0.3); this.holder.add(m); }
  }
  update(dt, st) { // st: swing 0..1, eating, charging 0..1, bob
    this.t += dt;
    const sw = st.swing > 0 ? Math.sin(st.swing * Math.PI) : 0, bob = st.moving ? Math.sin(this.t * 9) * 0.015 : Math.sin(this.t * 1.6) * 0.004;
    this.g.position.set(0.42 - sw * 0.1 - st.charge * 0.18, -0.42 + bob - sw * 0.1 + (st.eating ? Math.sin(this.t * 22) * 0.02 : 0), -0.62 - sw * 0.15);
    this.g.rotation.set(-sw * 1.0 + (st.eating ? -0.5 : 0), -sw * 0.4 + st.charge * 0.3, sw * 0.2);
  }
}
