// Fishing hooks you can see: a red and white float on the water with a line back to the rod. The server decides everything (server/fishing.js);
// this only draws what it reports: s = 0 flying, 1 floating; b = 0 calm, 1 a fish is nibbling (small twitches), 2 a fish has bitten (the float plunges).
import * as THREE from 'three';

export function createFishing(scene) {
  const hooks = new Map();
  const red = new THREE.MeshBasicMaterial({ color: 0xd8262c }), white = new THREE.MeshBasicMaterial({ color: 0xf4f4f4 });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xe8e8e8 });
  const geoTop = new THREE.BoxGeometry(0.14, 0.1, 0.14), geoBot = new THREE.BoxGeometry(0.14, 0.1, 0.14);
  const SEG = 10;
  function make() {
    const g = new THREE.Group(), top = new THREE.Mesh(geoTop, red), bot = new THREE.Mesh(geoBot, white);
    top.position.y = 0.05; bot.position.y = -0.05; g.add(top, bot);
    const pos = new Float32Array((SEG + 1) * 3), geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const line = new THREE.Line(geo, lineMat); line.frustumCulled = false;
    scene.add(g, line);
    return { g, line, pos, geo };
  }
  function drop(h) { scene.remove(h.g); scene.remove(h.line); h.geo.dispose(); }
  return {
    set(m) { // a 'hook' message
      if (!m.on) { const h = hooks.get(m.id); if (h) { drop(h); hooks.delete(m.id); } return; }
      let h = hooks.get(m.id);
      if (!h) { h = { ...make(), x: m.x, y: m.y, z: m.z, t: 0, b: 0, s: 0 }; hooks.set(m.id, h); }
      const prevB = h.b;
      h.tx = m.x; h.ty = m.y; h.tz = m.z; h.s = m.s; h.b = m.b; h.bitNow = m.b === 2 && prevB !== 2; h.landed = m.s === 1;
    },
    has: (id) => hooks.has(id),
    bite: (id) => { const h = hooks.get(id); return !!(h && h.b === 2); },
    state: (id) => hooks.get(id) || null,
    clear() { for (const h of hooks.values()) drop(h); hooks.clear(); },
    // tipOf(id) -> [x, y, z]: where the line leaves the rod
    update(dt, tipOf) {
      for (const [id, h] of hooks) {
        h.t += dt;
        const k = Math.min(1, dt * (h.s === 0 ? 30 : 12));
        h.x += (h.tx - h.x) * k; h.y += (h.ty - h.y) * k; h.z += (h.tz - h.z) * k;
        let dip = 0;
        if (h.s === 1) dip = h.b === 2 ? -0.3 + Math.sin(h.t * 26) * 0.03 : h.b === 1 ? -0.04 + Math.sin(h.t * 24) * 0.05 : Math.sin(h.t * 2.2) * 0.02;
        h.g.position.set(h.x, h.y + dip + 0.04, h.z);
        const tip = tipOf(id);
        if (!tip) continue;
        const sag = h.s === 1 ? 0.25 : 0.1, dx = h.x - tip[0], dy = h.y + dip - tip[1], dz = h.z - tip[2], len = Math.hypot(dx, dy, dz);
        for (let i = 0; i <= SEG; i++) {
          const f = i / SEG, hang = Math.sin(f * Math.PI) * sag * Math.min(1, len / 4);
          h.pos[i * 3] = tip[0] + dx * f; h.pos[i * 3 + 1] = tip[1] + dy * f - hang; h.pos[i * 3 + 2] = tip[2] + dz * f;
        }
        h.geo.attributes.position.needsUpdate = true;
      }
    },
  };
}
