// 3D models built from shaded boxes: eleven creatures, players with armor and held items, drops, arrows, the first-person hand.
import * as THREE from 'three';
import { BLOCKS } from './shared/world.js';
import { ITEMS, ARMOR_MATS, I } from './shared/items.js';
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
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), front && front.skin ? skinMats(color, front) : mats(color, front));
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
export function setEquipment(m, held, arm, off) {
  if (m.rig && m.rig.armL && off !== undefined && m.offId !== off) { // a shield on the left forearm
    m.offId = off;
    if (!m.offHolder) { m.offHolder = new THREE.Group(); m.offHolder.position.set(-0.1, -0.42, 0.02); m.rig.armL.add(m.offHolder); }
    while (m.offHolder.children.length) m.offHolder.remove(m.offHolder.children[0]);
    if (off) { const s = itemMesh(off, 0.62); s.rotation.y = -Math.PI / 2; m.offHolder.add(s); }
  }
  if (m.armor) arm.forEach((id, i) => {
    for (const mesh of m.armor[i]) {
      mesh.visible = !!id;
      if (id) { mesh.userData.mats = mats(ARM_COL[(id - 310) % 4], null); if (!m.flash) mesh.material = mesh.userData.mats; delete mesh.userData.red; }
    }
  });
  if (m.hand && m.heldId !== held) {
    m.heldId = held;
    while (m.hand.children.length) m.hand.remove(m.hand.children[0]);
    if (held) { const it = itemMesh(held, 0.5); it.rotation.set(0, Math.PI / 2, 0); if (!ITEMS.get(held).block || ITEMS.get(held).block === 31) it.rotation.z = -0.4; m.hand.add(it); }
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
const eyes = (r, y = 5, col = '#1b1414') => { r(2, y, 3, 2, '#f2f2f2'); r(3, y, 2, 2, col); r(11, y, 3, 2, '#f2f2f2'); r(11, y, 2, 2, col); }; // eyes with a white and a dark part
const rnd = (seed) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) >>> 8) / 16777216; };
const blobs = (seed, col, n, lo, hi) => (r) => { const q = rnd(seed); for (let i = 0; i < n; i++) { const w = lo + ((q() * (hi - lo + 1)) | 0), h = lo + ((q() * (hi - lo + 1)) | 0); r((q() * (16 - w)) | 0, (q() * (16 - h)) | 0, w, h, col); } };
const clumps = (seed) => (r) => { const q = rnd(seed); for (let i = 0; i < 26; i++) r((q() * 14) | 0, (q() * 14) | 0, 2, 2, q() < 0.5 ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.13)'); };
const mottle = (seed, cols) => (r) => { const q = rnd(seed); for (let y = 0; y < 16; y += 2) for (let x = 0; x < 16; x += 2) r(x, y, 2, 2, cols[(q() * cols.length) | 0]); };
// A skin gives each side of a box its own painted picture: { front, back, top, bottom, side } painters (each draws on a 16 x 16 face).
const skinCache = new Map(); // painted skins are shared between all creatures of a kind (a key names them)
function skin(base, o, key) { if (key && skinCache.has(key)) return skinCache.get(key); const k = { skin: true }; for (const f of ['front', 'back', 'top', 'bottom', 'side']) if (o[f]) k[f] = faceTex(base, o[f]); if (key) skinCache.set(key, k); return k; }
function skinMats(color, k) { const pick = [k.side, k.side, k.top, k.bottom, k.front, k.back]; return SH.map((sh, i) => new THREE.MeshBasicMaterial({ color: tint(pick[i] ? 0xffffff : color, sh), map: pick[i] || noiseTex })); }
function quad(m, c) { // four-legged body plan shared by pig, cow, sheep, wolf
  const legs = c.legs.map(([x, z]) => Limb(m, m.g, [x, c.legH, z], c.legW, c.legH, c.legW, c.legCol));
  if (c.hoof) for (const l of legs) B(m, l, c.legW + 0.012, 0.07, c.legW + 0.012, [0, -c.legH + 0.035, 0], c.hoof);
  B(m, m.g, c.body[0], c.body[1], c.body[2], [0, c.legH + c.body[1] / 2, 0], c.bodyCol, c.bodySkin && skin(c.bodyCol, c.bodySkin, c.skinKey));
  const head = Limb(m, m.g, [0, c.headY, c.headZ], c.head[0], c.head[1], c.head[2], c.headCol, true);
  head.children[0].material = head.children[0].userData.mats = mats(c.headCol, faceTex(c.headCol, c.face));
  m.rig = { legs, head };
  return m.rig;
}
function quadAnim(m, st) {
  const s = sway(m, st, 0.8), { legs, head } = m.rig;
  legs.forEach((l, i) => { l.rotation.x = (i === 0 || i === 3 ? s : -s); });
  head.rotation.x = st.flags & 64 ? -0.4 : Math.sin(m.phase * 0.3) * 0.04 + Math.sin(st.t * 1.3 + m.g.id * 0.7) * 0.015;
  if (m.tail) m.tail.rotation.z = Math.sin(m.phase * 1.1 + st.t * 0.5) * 0.35 * Math.min(1, 0.3 + st.speed) + Math.sin(st.t * 2.4) * 0.08;
  if (m.ears) { const tw = Math.max(0, Math.sin(st.t * 0.9 + m.g.id)) ** 8; m.ears[0].rotation.z = -0.5 - tw * 0.5; m.ears[1].rotation.z = 0.5 + tw * 0.5; }
}
const BUILD = {
  pig(m) {
    quad(m, { legH: 0.3, legW: 0.2, legs: [[-0.18, 0.28], [0.18, 0.28], [-0.18, -0.28], [0.18, -0.28]], skinKey: 'pig', legCol: 0xe08a95, hoof: 0xb4636f, body: [0.62, 0.55, 0.92], bodyCol: 0xf0a3ac,
      bodySkin: { side: clumps(3), top: clumps(4), front: clumps(5), back: clumps(6), bottom: (r) => r(0, 0, 16, 16, 'rgba(255,255,255,0.2)') }, headY: 0.62, headZ: 0.5, head: [0.46, 0.42, 0.42], headCol: 0xf2a8b1, face: (r) => { eyes(r, 5); r(0, 0, 16, 2, 'rgba(255,255,255,0.12)'); } });
    const h = m.rig.head;
    B(m, h, 0.26, 0.18, 0.1, [0, 0.14, 0.26], 0xf8bcc4); B(m, h, 0.28, 0.04, 0.1, [0, 0.07, 0.26], 0xe8a3ab); // snout and its darker lower lip
    B(m, h, 0.05, 0.07, 0.03, [-0.05, 0.14, 0.32], 0xa85a66); B(m, h, 0.05, 0.07, 0.03, [0.05, 0.14, 0.32], 0xa85a66);
    m.ears = [B(m, h, 0.14, 0.14, 0.04, [-0.17, 0.4, -0.02], 0xe8909b), B(m, h, 0.14, 0.14, 0.04, [0.17, 0.4, -0.02], 0xe8909b)]; m.ears[0].rotation.z = -0.5; m.ears[1].rotation.z = 0.5;
    m.tail = new THREE.Group(); m.tail.position.set(0, 0.62, -0.46); m.g.add(m.tail); // a little curl
    B(m, m.tail, 0.05, 0.05, 0.07, [0, 0, -0.035], 0xe08a95); B(m, m.tail, 0.05, 0.05, 0.05, [0, 0.05, -0.07], 0xe08a95); B(m, m.tail, 0.05, 0.05, 0.05, [0.04, 0.09, -0.05], 0xe08a95);
    m.update = (st) => quadAnim(m, st);
  },
  cow(m) {
    const spots = (n) => blobs(n, '#2b2b2b', 4, 3, 7);
    quad(m, { legH: 0.5, legW: 0.2, legs: [[-0.22, 0.4], [0.22, 0.4], [-0.22, -0.4], [0.22, -0.4]], skinKey: 'cow', legCol: 0xe4e4e4, hoof: 0x3d342c, body: [0.72, 0.7, 1.1], bodyCol: 0xf2f2f2,
      bodySkin: { side: spots(11), top: spots(23), front: spots(5), back: spots(8), bottom: (r) => r(0, 0, 16, 16, 'rgba(0,0,0,0.08)') }, headY: 1.1, headZ: 0.62, head: [0.5, 0.5, 0.44], headCol: 0xe6e6e6,
      face: (r) => { r(0, 0, 16, 4, '#2b2b2b'); r(0, 4, 3, 3, '#2b2b2b'); r(13, 4, 3, 3, '#2b2b2b'); eyes(r, 6); r(5, 9, 6, 7, '#eadad2'); r(6, 12, 1, 2, '#6a4a48'); r(9, 12, 1, 2, '#6a4a48'); } });
    const h = m.rig.head;
    B(m, h, 0.34, 0.2, 0.1, [0, 0.1, 0.25], 0xe8b7b0);
    for (const x of [-0.29, 0.29]) { B(m, h, 0.08, 0.14, 0.08, [x, 0.48, 0], 0xe3dcc0); B(m, h, 0.07, 0.1, 0.07, [x * 1.1, 0.6, 0], 0xb9b295); } // horns with darker tips
    B(m, m.g, 0.24, 0.1, 0.26, [0, 0.52, -0.22], 0xe8b7b0);
    for (const [x, z] of [[-0.07, -0.14], [0.07, -0.14], [-0.07, -0.3], [0.07, -0.3]]) B(m, m.g, 0.04, 0.07, 0.04, [x, 0.46, z], 0xd79a94); // udder
    m.tail = new THREE.Group(); m.tail.position.set(0, 1.0, -0.56); m.g.add(m.tail); B(m, m.tail, 0.05, 0.5, 0.05, [0, -0.25, -0.02], 0xdedede); B(m, m.tail, 0.09, 0.12, 0.09, [0, -0.52, -0.02], 0x2b2b2b);
    m.update = (st) => quadAnim(m, st);
  },
  sheep(m, aux) {
    const wool = [0xf1f1f1, 0x9a9a9a, 0x7a5a3a, 0x2f2f2f][aux] ?? 0xf1f1f1, wk = (n) => skin(wool, { side: clumps(n), top: clumps(n + 1), front: clumps(n + 2), back: clumps(n + 3), bottom: clumps(n + 4) }, `wool${wool}-${n}`);
    quad(m, { legH: 0.5, legW: 0.17, legs: [[-0.2, 0.3], [0.2, 0.3], [-0.2, -0.3], [0.2, -0.3]], legCol: 0xa89378, hoof: 0x5a4c3c, body: [0.5, 0.45, 0.8], bodyCol: 0xa89378, headY: 1.0, headZ: 0.46, head: [0.36, 0.4, 0.4], headCol: 0xbda58b, face: (r) => { eyes(r, 6); r(5, 11, 6, 2, '#8a7560'); } });
    B(m, m.g, 0.84, 0.74, 1.1, [0, 0.88, -0.02], wool, wk(30)); B(m, m.rig.head, 0.44, 0.16, 0.44, [0, 0.42, -0.02], wool, wk(40)); B(m, m.rig.head, 0.4, 0.14, 0.12, [0, 0.0, -0.1], wool, wk(50)); // fluffy cap and a ruff
    for (const [x, z] of [[-0.2, 0.3], [0.2, 0.3], [-0.2, -0.3], [0.2, -0.3]]) B(m, m.g, 0.26, 0.2, 0.26, [x, 0.58, z], wool, wk(60));
    m.ears = [B(m, m.rig.head, 0.16, 0.08, 0.06, [-0.26, 0.2, -0.02], 0xbda58b), B(m, m.rig.head, 0.16, 0.08, 0.06, [0.26, 0.2, -0.02], 0xbda58b)]; m.ears[0].rotation.z = -0.3; m.ears[1].rotation.z = 0.3;
    m.update = (st) => quadAnim(m, st);
  },
  wolf(m) {
    quad(m, { legH: 0.4, legW: 0.13, legs: [[-0.12, 0.28], [0.12, 0.28], [-0.12, -0.28], [0.12, -0.28]], skinKey: 'wolf', legCol: 0xa8a8a8, hoof: 0x7a7a7a, body: [0.36, 0.36, 0.7], bodyCol: 0xb9b9b9,
      bodySkin: { side: (r) => { r(0, 0, 16, 5, '#a2a2a2'); r(0, 11, 16, 5, '#d4d4d4'); }, top: (r) => r(5, 0, 6, 16, '#9a9a9a'), bottom: (r) => r(0, 0, 16, 16, '#dedede') }, headY: 0.7, headZ: 0.42, head: [0.34, 0.32, 0.3], headCol: 0xc2c2c2, face: (r) => { eyes(r, 5, '#2a2a2a'); r(0, 0, 16, 3, '#a6a6a6'); r(5, 12, 6, 2, '#3a3a3a'); } });
    const h = m.rig.head;
    B(m, h, 0.2, 0.16, 0.2, [0, 0.1, 0.24], 0xdadada); B(m, h, 0.07, 0.07, 0.04, [0, 0.16, 0.35], 0x222222); B(m, h, 0.16, 0.03, 0.16, [0, 0.03, 0.24], 0x555555); // muzzle, nose, mouth
    m.ears = [B(m, h, 0.1, 0.14, 0.05, [-0.12, 0.39, -0.04], 0xa0a0a0), B(m, h, 0.1, 0.14, 0.05, [0.12, 0.39, -0.04], 0xa0a0a0)]; B(m, h, 0.05, 0.08, 0.02, [-0.12, 0.38, -0.01], 0x6a5a5a); B(m, h, 0.05, 0.08, 0.02, [0.12, 0.38, -0.01], 0x6a5a5a);
    B(m, m.g, 0.4, 0.4, 0.2, [0, 0.62, 0.28], 0xcfcfcf); // thick fur on the chest and shoulders
    const tail = new THREE.Group(); tail.position.set(0, 0.7, -0.38); m.g.add(tail); B(m, tail, 0.1, 0.1, 0.34, [0, 0.12, -0.14], 0xb0b0b0); B(m, tail, 0.11, 0.11, 0.1, [0, 0.16, -0.34], 0x6e6e6e); tail.rotation.x = 0.7; m.tail = null;
    m.update = (st) => { quadAnim(m, st); tail.rotation.z = Math.sin(m.phase * 0.7 + st.t) * 0.25; tail.rotation.x = 0.7 - Math.min(0.5, st.speed * 0.1); };
  },
  chicken(m) {
    const legs = [-0.07, 0.07].map((x) => Limb(m, m.g, [x, 0.25, 0], 0.05, 0.25, 0.05, 0xf2a63a));
    for (const l of legs) { B(m, l, 0.1, 0.03, 0.14, [0, -0.25, 0.04], 0xf2a63a); B(m, l, 0.025, 0.025, 0.06, [-0.03, -0.25, 0.14], 0xf2a63a); B(m, l, 0.025, 0.025, 0.06, [0.03, -0.25, 0.14], 0xf2a63a); }
    B(m, m.g, 0.34, 0.34, 0.5, [0, 0.42, 0], 0xf6f6f6, skin(0xf6f6f6, { top: clumps(70), side: clumps(71), front: (r) => r(3, 8, 10, 8, 'rgba(255,230,190,0.35)'), back: clumps(73) }, 'chicken-body'));
    for (const [y, z, c] of [[0.5, -0.3, 0xe2e2e2], [0.6, -0.33, 0xececec], [0.45, -0.32, 0xdadada]]) { const f = B(m, m.g, 0.07, 0.2, 0.1, [(y - 0.5) * 0.4, y, z], c); f.rotation.x = -0.5; } // tail feathers
    const head = Limb(m, m.g, [0, 0.5, 0.2], 0.2, 0.26, 0.2, 0xf8f8f8, true);
    head.children[0].material = head.children[0].userData.mats = mats(0xf8f8f8, faceTex(0xf8f8f8, (r) => { r(3, 5, 2, 3, '#111'); r(11, 5, 2, 3, '#111'); r(3, 5, 1, 1, '#fff'); r(12, 5, 1, 1, '#fff'); }));
    B(m, head, 0.12, 0.06, 0.1, [0, 0.14, 0.14], 0xf2a63a); B(m, head, 0.1, 0.03, 0.08, [0, 0.1, 0.13], 0xe39426); B(m, head, 0.06, 0.1, 0.04, [0, 0.04, 0.12], 0xd03030); B(m, head, 0.06, 0.08, 0.12, [0, 0.3, 0], 0xd03030); B(m, head, 0.05, 0.05, 0.08, [0, 0.27, 0.08], 0xd03030);
    const wl = Limb(m, m.g, [-0.19, 0.55, 0], 0.04, 0.2, 0.3, 0xe6e6e6, false), wr = Limb(m, m.g, [0.19, 0.55, 0], 0.04, 0.2, 0.3, 0xe6e6e6, false);
    m.update = (st) => { const s = sway(m, st, 1); legs[0].rotation.x = s; legs[1].rotation.x = -s; head.rotation.x = Math.abs(Math.sin(m.phase * 0.5)) * 0.2 + Math.sin(st.t * 1.7) * 0.04; const fl = st.flags & 32 ? 0 : 0.9 + Math.sin(st.t * 30) * 0.4; wl.rotation.z = fl; wr.rotation.z = -fl; };
  },
  rabbit(m) {
    const fr = [-0.07, 0.07].map((x) => Limb(m, m.g, [x, 0.1, 0.12], 0.07, 0.1, 0.07, 0x9a7a58)), hr = [-0.1, 0.1].map((x) => Limb(m, m.g, [x, 0.14, -0.12], 0.09, 0.14, 0.2, 0x8f6f4e));
    const body = new THREE.Group(); body.position.y = 0.12; m.g.add(body);
    B(m, body, 0.28, 0.26, 0.42, [0, 0.14, 0], 0xa3825f, skin(0xa3825f, { side: clumps(80), top: clumps(81), bottom: (r) => r(0, 0, 16, 16, 'rgba(255,255,255,0.25)') }, 'rabbit-body')); B(m, body, 0.12, 0.12, 0.1, [0, 0.16, -0.26], 0xf2f2f2);
    const head = Limb(m, body, [0, 0.2, 0.2], 0.22, 0.2, 0.22, 0xa88866, true);
    head.children[0].material = head.children[0].userData.mats = mats(0xa88866, faceTex(0xa88866, (r) => { r(3, 6, 2, 3, '#1a1010'); r(11, 6, 2, 3, '#1a1010'); r(3, 6, 1, 1, '#fff'); r(12, 6, 1, 1, '#fff'); r(6, 10, 4, 3, '#d9c3a8'); r(7, 10, 2, 1, '#e8a0a0'); }));
    for (const x of [-0.06, 0.06]) { B(m, head, 0.06, 0.28, 0.05, [x, 0.34, -0.02], 0x9a7a58); B(m, head, 0.03, 0.22, 0.02, [x, 0.34, 0.01], 0xe3b0a8); } // ears with a pink inside
    m.update = (st) => { const air = !(st.flags & 32); body.rotation.x = air ? -0.4 : 0; hr.forEach((l) => { l.rotation.x = air ? 0.7 : 0; }); fr.forEach((l) => { l.rotation.x = air ? -0.5 : 0; }); head.rotation.x = air ? 0 : Math.sin(st.t * 3) * 0.05; };
  },
  zombie(m) {
    humanoid(m, { skin: 0x5c9b4a, shirt: 0x2e8aa6, pants: 0x33408a, face: (r) => { r(0, 0, 16, 3, '#47803a'); r(2, 6, 4, 3, '#1b2a18'); r(10, 6, 4, 3, '#1b2a18'); r(3, 7, 2, 1, '#9fe08a'); r(11, 7, 2, 1, '#9fe08a'); r(7, 8, 2, 3, '#4a8a3a'); r(4, 11, 8, 3, '#243019'); r(5, 11, 1, 2, '#c8d8b8'); r(7, 11, 1, 2, '#c8d8b8'); r(9, 11, 1, 2, '#c8d8b8'); r(11, 5, 4, 1, '#3d7030'); } });
    const r0 = m.rig;
    for (const a of [r0.armL, r0.armR]) B(m, a, 0.236, 0.34, 0.236, [0, -0.47, 0], 0x5c9b4a); // bare forearms under torn sleeves
    B(m, m.g, 0.52, 0.12, 0.285, [0, 0.76, 0], 0x1f6a82); B(m, m.g, 0.18, 0.14, 0.02, [0.1, 0.92, 0.14], 0x5c9b4a); B(m, m.g, 0.14, 0.1, 0.02, [-0.12, 1.1, -0.14], 0x23778f); // ragged hem, a rip showing skin, a patch
    B(m, r0.legL, 0.25, 0.16, 0.25, [0, -0.55, 0], 0x2a357a); B(m, r0.legR, 0.12, 0.12, 0.02, [0.03, -0.3, 0.125], 0x5c9b4a);
    m.g.scale.setScalar(1.08);
    m.update = (st) => { const s = sway(m, st), r = m.rig; r.legL.rotation.x = s; r.legR.rotation.x = -s; const up = st.flags & 16 ? -1.9 : -1.45; r.armL.rotation.x = up + s * 0.15 + Math.sin(st.t * 1.5) * 0.04; r.armR.rotation.x = up - s * 0.15 - Math.sin(st.t * 1.5) * 0.04; r.armL.rotation.z = 0.08; r.armR.rotation.z = -0.08; };
  },
  skeleton(m) {
    humanoid(m, { skin: 0xdcdccf, shirt: 0xd2d2c4, pants: 0xc4c4b6, thin: 0.62, face: (r) => { r(2, 5, 4, 4, '#2a2a28'); r(10, 5, 4, 4, '#2a2a28'); r(7, 9, 2, 2, '#8a8a80'); r(3, 12, 10, 4, '#4a4a46'); for (let x = 4; x < 12; x += 2) r(x, 12, 1, 4, '#ecece0'); } });
    for (const y of [0.88, 1.03, 1.18]) B(m, m.g, 0.42, 0.06, 0.02, [0, y, 0.14], 0x4f4f49); // ribs
    B(m, m.g, 0.06, 0.6, 0.02, [0, 1.02, 0.142], 0x8a8a80); B(m, m.g, 0.34, 0.1, 0.17, [0, 0.76, 0], 0xb9b9ab); // breastbone and pelvis
    m.g.scale.setScalar(1.08);
    m.hand = new THREE.Group(); m.hand.position.set(0, -0.6, 0.1); m.rig.armR.add(m.hand);
    const bow = itemMesh(281, 0.7); bow.rotation.set(0, Math.PI / 2, 0.2); m.hand.add(bow);
    m.update = (st) => { const s = sway(m, st), r = m.rig; r.legL.rotation.x = s; r.legR.rotation.x = -s; r.armL.rotation.x = -s * 0.5; r.armR.rotation.x = st.flags & 8 ? -1.5 : -0.5 + s * 0.4; r.armL.rotation.x = st.flags & 8 ? -1.4 : r.armL.rotation.x; r.head.rotation.z = Math.sin(st.t * 0.8) * 0.03; };
  },
  spider(m) {
    const legs = [];
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1, k = i % 4, piv = new THREE.Group(); piv.position.set(side * 0.2, 0.45, 0.2 - k * 0.14); m.g.add(piv);
      const up = new THREE.Group(); piv.add(up); B(m, up, 0.9, 0.07, 0.07, [side * 0.42, 0, 0], 0x241d19); B(m, up, 0.07, 0.42, 0.07, [side * 0.86, -0.2, 0], 0x241d19); B(m, up, 0.09, 0.09, 0.09, [side * 0.86, 0.02, 0], 0x3a2f29); // a knobbly joint
      piv.rotation.y = side * (0.5 - k * 0.3); legs.push({ piv, side, k });
    }
    B(m, m.g, 0.5, 0.4, 0.5, [0, 0.45, 0.1], 0x2f2722, skin(0x2f2722, { top: (r) => { r(5, 4, 6, 8, '#4a3a33'); }, side: blobs(90, '#3a2e28', 5, 2, 4) }, 'spider-a'));
    B(m, m.g, 0.72, 0.52, 0.78, [0, 0.5, -0.5], 0x3a302a, skin(0x3a302a, { top: (r) => { r(6, 1, 4, 14, '#5a2f2a'); r(5, 6, 6, 3, '#6a3a34'); }, side: blobs(91, '#2a211d', 6, 2, 5), back: (r) => { r(5, 5, 6, 6, '#2a211d'); } }, 'spider-b'));
    const head = Limb(m, m.g, [0, 0.45, 0.35], 0.38, 0.34, 0.38, 0x2b231f, true);
    head.children[0].material = head.children[0].userData.mats = mats(0x2b231f, faceTex(0x2b231f, (r) => { r(2, 5, 3, 3, '#d62a2a'); r(11, 5, 3, 3, '#d62a2a'); r(6, 3, 2, 2, '#b01818'); r(8, 3, 2, 2, '#b01818'); r(6, 7, 1, 1, '#c82020'); r(9, 7, 1, 1, '#c82020'); r(5, 11, 6, 3, '#120d0b'); r(5, 13, 1, 2, '#d8d0c0'); r(10, 13, 1, 2, '#d8d0c0'); }));
    B(m, head, 0.05, 0.12, 0.05, [-0.08, 0.04, 0.2], 0x120d0b); B(m, head, 0.05, 0.12, 0.05, [0.08, 0.04, 0.2], 0x120d0b);
    m.update = (st) => { m.phase += st.speed * 3 * st.dt; for (const { piv, side, k } of legs) { piv.rotation.z = Math.sin(m.phase + k * 1.3 + (side > 0 ? 1.5 : 0)) * 0.22 * Math.min(1, st.speed / 1.5) + side * -0.15 + Math.sin(st.t * 2 + k) * 0.02; } head.rotation.x = Math.sin(st.t * 1.4) * 0.05; };
  },
  boomer(m) {
    const greens = ['#4f9e41', '#5cb04c', '#6ec45d', '#3f8a35', '#7bd16a'], col = 0x5cb04c;
    const legs = [[-0.14, 0.2], [0.14, 0.2], [-0.14, -0.2], [0.14, -0.2]].map(([x, z], li) => { const l = Limb(m, m.g, [x, 0.4, z], 0.22, 0.4, 0.22, 0x4a9a3c); B(m, l, 0.226, 0.4, 0.226, [0, -0.2, 0], 0x4a9a3c, skin(0x4a9a3c, { side: mottle(x * 100 + z * 10 + 1, greens), front: mottle(7, greens), back: mottle(8, greens), top: mottle(9, greens), bottom: mottle(10, greens) }, `boomer-leg${li}`)); return l; });
    B(m, m.g, 0.5, 0.8, 0.3, [0, 0.8, 0], col, skin(col, { side: mottle(21, greens), front: mottle(22, greens), back: mottle(23, greens), top: mottle(24, greens), bottom: mottle(25, greens) }, 'boomer-body'));
    const head = Limb(m, m.g, [0, 1.2, 0], 0.5, 0.5, 0.5, 0x64bd54, true);
    head.children[0].material = head.children[0].userData.mats = skinMats(0x64bd54, skin(0x64bd54, { front: (r) => { mottle(31, greens)(r); r(3, 5, 4, 4, '#0d0d0d'); r(9, 5, 4, 4, '#0d0d0d'); r(7, 8, 2, 3, '#0d0d0d'); r(5, 10, 6, 5, '#0d0d0d'); r(5, 12, 2, 3, '#64bd54'); r(9, 12, 2, 3, '#64bd54'); }, back: mottle(32, greens), top: mottle(33, greens), bottom: mottle(34, greens), side: mottle(35, greens) }, 'boomer-head'));
    m.update = (st) => { const s = sway(m, st); legs.forEach((l, i) => { l.rotation.x = i === 0 || i === 3 ? s : -s; }); const f = st.fuse || 0; m.g.scale.setScalar(1 + f * 0.18 + (f > 0 ? Math.sin(st.t * 40) * 0.03 : 0)); m.setFlash(f > 0 && Math.sin(st.t * 22) > 0); };
  },
  salmon(m) { // silvery green back, pink belly; swims nose-first, tail wagging, and lies on its side out of water
    const back = 0x6f7d6a, belly = 0xdc8a76, fin = 0x56635a;
    const body = new THREE.Group(); body.position.y = 0.2; m.g.add(body);
    B(m, body, 0.15, 0.1, 0.46, [0, 0.05, 0], back); B(m, body, 0.15, 0.1, 0.46, [0, -0.05, 0], belly);
    const head = new THREE.Group(); head.position.set(0, 0, 0.23); body.add(head);
    B(m, head, 0.13, 0.15, 0.14, [0, 0, 0.07], 0x778570); B(m, head, 0.09, 0.05, 0.05, [0, -0.04, 0.15], belly);
    for (const x of [-0.068, 0.068]) B(m, head, 0.02, 0.03, 0.03, [x, 0.03, 0.1], 0x111111);
    const tail = new THREE.Group(); tail.position.set(0, 0, -0.23); body.add(tail);
    B(m, tail, 0.04, 0.18, 0.2, [0, 0, -0.1], fin); B(m, tail, 0.12, 0.08, 0.1, [0, 0, -0.02], back);
    B(m, body, 0.03, 0.08, 0.16, [0, 0.12, -0.05], fin);
    for (const x of [-0.1, 0.1]) { const f = B(m, body, 0.1, 0.02, 0.1, [x, -0.07, 0.1], fin); f.rotation.z = x > 0 ? -0.5 : 0.5; }
    m.update = (st) => {
      m.phase += (0.8 + st.speed * 3) * st.dt * 4;
      m.g.rotation.order = 'YXZ'; m.g.rotation.x = -(st.aux || 0) * 0.01745; // nose up or down as it swims
      if (st.flags & 128) { m.g.rotation.z = Math.PI / 2; body.position.y = 0.1; tail.rotation.y = Math.sin(st.t * 25) * 0.7; }
      else { m.g.rotation.z = 0; body.position.y = 0.2; tail.rotation.y = Math.sin(m.phase) * 0.5; body.rotation.y = Math.sin(m.phase - 0.8) * 0.08; }
    };
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
    if (it && it.block && it.block !== 31) {
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
// The bow is built from boxes that are re-aimed every frame: each limb is five short segments along a curve that flexes as you draw, and the
// string runs from the two tips to the nock, which slides back with the hand. Everything is driven by one smoothed "draw" number from 0 to 1.
function makeBowRig() {
  const wood = new THREE.MeshBasicMaterial({ color: 0x7b5a2e }), wood2 = new THREE.MeshBasicMaterial({ color: 0x96743d }), cord = new THREE.MeshBasicMaterial({ color: 0xeeeeee }), grip = new THREE.MeshBasicMaterial({ color: 0x4a3322 });
  const box = new THREE.BoxGeometry(1, 1, 1), g = new THREE.Group();
  const mesh = (mat, sx, sy, sz, parent = g) => { const m = new THREE.Mesh(box, mat); m.scale.set(sx, sy, sz); parent.add(m); return m; };
  mesh(grip, 0.06, 0.17, 0.075);
  const N = 5, limbs = [[], []];
  for (let k = 0; k < 2; k++) for (let i = 0; i < N; i++) limbs[k].push(mesh(i % 2 ? wood2 : wood, 0.05 - i * 0.005, 1, 0.055 - i * 0.005));
  const s1 = mesh(cord, 0.012, 1, 0.012), s2 = mesh(cord, 0.012, 1, 0.012);
  const arrow = new THREE.Group();
  mesh(new THREE.MeshBasicMaterial({ color: 0x8a6a3a }), 0.016, 0.016, 0.62, arrow);
  const head = mesh(new THREE.MeshBasicMaterial({ color: 0x9a9ea4 }), 0.045, 0.045, 0.075, arrow); head.position.z = -0.335;
  const f1 = mesh(new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }), 0.07, 0.012, 0.09, arrow), f2 = mesh(new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }), 0.012, 0.07, 0.09, arrow); f1.position.z = f2.position.z = 0.26;
  g.add(arrow);
  const hand = mesh(new THREE.MeshBasicMaterial({ color: 0xe5b98c }), 0.1, 0.1, 0.12);
  const seg = (m, y1, z1, y2, z2) => { const dy = y2 - y1, dz = z2 - z1; m.position.set(0, (y1 + y2) / 2, (z1 + z2) / 2); m.rotation.x = Math.atan2(dz, dy); m.scale.y = Math.hypot(dy, dz) + 0.006; };
  return {
    g,
    update(draw, vib) {
      const L = 0.5, zt = 0.1 + 0.14 * draw, yt = 0.08 + (L - 0.08) * (1 - 0.05 * draw);
      for (let k = 0; k < 2; k++) { // upper and lower limb: a curve that sweeps back toward the archer, more so when drawn
        const dir = k ? -1 : 1;
        for (let i = 0; i < N; i++) { const s0 = i / N, s1_ = (i + 1) / N; seg(limbs[k][i], dir * (0.08 + s0 * (yt - 0.08)), zt * s0 * s0, dir * (0.08 + s1_ * (yt - 0.08)), zt * s1_ * s1_); }
      }
      const zn = zt + 0.36 * draw + vib;
      seg(s1, yt, zt, 0, zn); seg(s2, 0, zn, -yt, zt);
      arrow.visible = hand.visible = draw > 0.02;
      arrow.position.set(0, 0, zn - 0.29); hand.position.set(0, -0.015, zn + 0.06);
    },
  };
}
export class HeldView {
  constructor(camera, scene) {
    this.g = new THREE.Group(); this.holder = new THREE.Group(); this.id = -1; this.t = 0;
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.62), mats(0xe5b98c, null)); this.arm.position.set(0, 0, 0.1);
    this.bow = makeBowRig(); this.bow.g.position.set(0.02, 0.1, -0.2); this.bow.g.rotation.set(0, 0.25, -0.12); this.bow.g.scale.setScalar(0.75); this.bow.g.visible = false;
    this.g.add(this.arm, this.holder, this.bow.g); scene.add(camera); camera.add(this.g); this.camera = camera;
    this.g.position.set(0.42, -0.42, -0.62);
    this.isBow = false; this.draw = 0; this.wasDrawing = false; this.relT = 9; this.relAmp = 0; this.guardT = 0; this.sh = null;
  }
  set(id) {
    if (id === this.id) return; this.id = id;
    while (this.holder.children.length) this.holder.remove(this.holder.children[0]);
    const it = id ? ITEMS.get(id) : null;
    this.isBow = !!(it && it.bow); this.bow.g.visible = this.isBow; this.draw = 0; this.relT = 9;
    this.arm.visible = !id || this.isBow;
    if (id && !this.isBow) { const cube = it.block && it.block !== 31, m = itemMesh(id, cube ? 0.3 : 0.5); m.position.set(0, cube ? -0.02 : 0.08, 0); m.rotation.set(0, cube ? 0.5 : 0.6, cube ? 0 : -0.3); this.holder.add(m); }
  }
  buildShield() { // a flat shield seen from the side of the screen, with a darker back so it has some thickness
    const tex = nearest(new THREE.CanvasTexture(iconCanvas(I.SHIELD))), geo = new THREE.PlaneGeometry(0.5, 0.5);
    const front = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
    const back = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: 0x6a5a48, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide })); back.position.z = -0.03;
    this.sh = new THREE.Group(); this.sh.add(back, front); this.camera.add(this.sh);
  }
  update(dt, st) { // st: swing 0..1, eating, charging 0..1, bob, drawing, chargeT, guard, off (shield id or 0)
    this.t += dt;
    if (st.off && !this.sh) this.buildShield();
    if (this.sh) { // raised in front of you while blocking, otherwise tucked at the left
      this.sh.visible = !!st.off; this.guardT += ((st.guard ? 1 : 0) - this.guardT) * (1 - Math.exp(-dt * 14));
      const k = this.guardT, b = st.moving ? Math.sin(this.t * 9) * 0.01 : 0;
      this.sh.position.set(-0.44 + 0.34 * k, -0.4 + 0.22 * k + b, -0.66 - 0.04 * k);
      this.sh.rotation.set(0.12 * k, 0.6 * (1 - k), 0.12 * (1 - k));
    }
    const bob = st.moving ? Math.sin(this.t * 9) * 0.015 : Math.sin(this.t * 1.6) * 0.004;
    if (this.isBow) {
      const p = Math.min(1, (st.chargeT || 0) / 1.0), target = st.drawing ? p * p * (3 - 2 * p) : 0; // ease in and out over the draw time
      if (this.wasDrawing && !st.drawing) { this.relAmp = this.draw; this.relT = 0; } // let go: the string snaps home and hums for a moment
      this.wasDrawing = !!st.drawing;
      this.draw += (target - this.draw) * (1 - Math.exp(-dt * (st.drawing ? 16 : 45)));
      this.relT += dt;
      const vib = !st.drawing && this.relT < 0.4 ? this.relAmp * Math.exp(-this.relT * 12) * Math.sin(this.relT * 70) * 0.06 : 0, held = this.draw > 0.98 ? Math.sin(this.t * 38) * 0.003 : 0;
      this.bow.update(this.draw, vib + held);
      const d = this.draw;
      this.g.position.set(0.42 - 0.24 * d, -0.42 + bob + 0.08 * d, -0.62);
      this.g.rotation.set(0, 0.3 * d, 0);
      return;
    }
    const sw = st.swing > 0 ? Math.sin(st.swing * Math.PI) : 0;
    this.g.position.set(0.42 - sw * 0.1, -0.42 + bob - sw * 0.1 + (st.eating ? Math.sin(this.t * 22) * 0.02 : 0), -0.62 - sw * 0.15);
    this.g.rotation.set(-sw * 1.0 + (st.eating ? -0.5 : 0), -sw * 0.4, sw * 0.2);
  }
}
