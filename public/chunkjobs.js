// The two jobs the chunk workers do, written as plain functions so the page can run them itself when workers are not available:
//   gen:  make a chunk from the world seed (trimmed to the height it needs, since most of a chunk's 256 rows are air)
//   mesh: turn a chunk and its eight neighbours into vertex data
import { genChunk, CS, CH } from './shared/world.js';
import { initMesher, buildMeshData, padChunk } from './mesher.js';

export { initMesher };
export function runJob(m) {
  if (m.t === 'gen') {
    const d = genChunk(m.cx, m.cz, m.seed, m.gen);
    let hi = d.length - 1; while (hi > 0 && !d[hi]) hi--;
    const t = d.slice(0, Math.min(CH, Math.floor(hi / (CS * CS)) + 1) * CS * CS);
    return { msg: { t: 'gen', id: m.id, ep: m.ep, cx: m.cx, cz: m.cz, d: t }, transfer: [t.buffer] };
  }
  const chunks = m.ch.map((a, i) => (a ? padChunk(a, i) : null));
  const parts = buildMeshData(m.cx, m.cz, chunks, m.tn, m.lod), transfer = [];
  for (const k of 'otwflp') { const q = parts[k]; if (q) transfer.push(q.p.buffer, q.u.buffer, q.c.buffer, q.i.buffer); }
  return { msg: { t: 'mesh', id: m.id, ep: m.ep, cx: m.cx, cz: m.cz, parts }, transfer };
}
