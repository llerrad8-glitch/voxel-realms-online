// Web worker: makes and meshes chunks off the main thread (see chunkjobs.js and chunkpool.js).
import { runJob, initMesher } from './chunkjobs.js';
onmessage = (e) => {
  const m = e.data;
  if (m.t === 'init') { initMesher(m.uv, m.flow); return; }
  const { msg, transfer } = runJob(m);
  postMessage(msg, transfer);
};
