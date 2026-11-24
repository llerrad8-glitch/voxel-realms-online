// A pool of web workers that make and mesh chunks. Each worker takes a couple of jobs at a time; results come back through onResult.
// If workers cannot be started (an old browser, a blocked script) the same jobs run on the page, a few milliseconds at a time (pump).
import { runJob, initMesher } from './chunkjobs.js';

const PER_WORKER = 2;
export function createPool(onResult, onBroken) {
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const want = Math.max(2, Math.min(touch ? 3 : 6, (navigator.hardwareConcurrency || 4) - 1));
  let workers = [], local = [], ep = 0, uv = null, flow = 1;
  const spawn = () => {
    for (let i = 0; i < want; i++) {
      const w = new Worker(new URL('./chunk-worker.js', import.meta.url), { type: 'module' });
      w.busy = 0;
      w.onmessage = (e) => { w.busy--; if (e.data.ep === ep) onResult(e.data); };
      w.onerror = () => fail();
      workers.push(w);
    }
  };
  const fail = () => { // a worker that cannot run: all of them stop, jobs they held are forgotten (the page asks again) and the work runs on the page instead
    for (const x of workers) x.terminate();
    workers = []; ep++; local = []; if (onBroken) onBroken();
  };
  try { if (typeof Worker === 'function') spawn(); } catch { workers = []; }
  return {
    get threads() { return workers.length; },
    init(u, f) { uv = u; flow = f; initMesher(u, f); for (const w of workers) w.postMessage({ t: 'init', uv: u, flow: f }); },
    slots() { if (!workers.length) return Math.max(0, 2 - local.length); let n = 0; for (const w of workers) n += PER_WORKER - w.busy; return n; },
    submit(job, copyList) {
      job.ep = ep;
      if (!workers.length) { local.push(job); return; }
      let best = workers[0]; for (const w of workers) if (w.busy < best.busy) best = w;
      best.busy++; best.postMessage(job, copyList || []);
    },
    reset() { ep++; local = []; },
    pump(ms) { // fallback only: run queued jobs here
      const t0 = performance.now();
      while (local.length && performance.now() - t0 < ms) { const j = local.shift(); if (j.ep !== ep) continue; const { msg } = runJob(j); onResult(msg); }
    },
  };
}
