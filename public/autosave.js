// Autosave. While you are in a world the game saves itself every 10 seconds, with no pop-ups.
//  - A copy of the newest save is always kept inside this browser (IndexedDB). Two older copies are kept too: the one before it, and the
//    "peak" (the fullest game this browser has ever saved), so one bad save can never be the only copy.
//  - On desktop Chrome/Edge you can also pick a .vrworld file once (press U). From then on every autosave overwrites that same file.
//    Other browsers cannot overwrite files, so there U / SAVE downloads one.
// Two rules protect your game from the way a save is usually lost (a server that restarted empty and then "saved" an empty game over the real one):
//  1. Nothing is saved until the game says it is safe (savegate.js: your game file has been loaded, or this is a brand-new game).
//  2. A save that holds clearly LESS than the last one (fewer worlds, or far fewer changed blocks), or less than the file you picked, is never written.
//     Autosave pauses instead, and the game asks what to do. Your good copy stays untouched.
const FILE_NAME = 'voxel-craft-autosave.vrworld';
const FS = typeof window.showSaveFilePicker === 'function';
const EVERY = 10000;
const MAGIC = 'VRWORLD\0';

const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open('vr-autosave', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function kv(mode, fn) {
  const db = await idb();
  try { return await new Promise((res, rej) => { const tx = db.transaction('kv', mode), out = fn(tx.objectStore('kv')); tx.oncomplete = () => res(out && 'result' in out ? out.result : undefined); tx.onerror = tx.onabort = () => rej(tx.error); }); } finally { db.close(); }
}
const getKey = (k) => kv('readonly', (s) => s.get(k)).catch(() => undefined);
const setKey = (k, v) => kv('readwrite', (s) => { s.put(v, k); }).then(() => true).catch(() => false);
const delKey = (k) => kv('readwrite', (s) => { s.delete(k); }).catch(() => {});

// What a .vrworld file holds, read from its header (the same numbers the server wrote when it built the file).
export function countsOf(buf) {
  try {
    const u = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
    if (u.length < 20 || String.fromCharCode(...u.subarray(0, 8)) !== MAGIC) return null;
    const hlen = new DataView(u.buffer, u.byteOffset, u.byteLength).getUint32(10);
    if (hlen > 4e6 || 14 + hlen > u.length) return null;
    const c = JSON.parse(new TextDecoder().decode(u.subarray(14, 14 + hlen))).counts || {};
    return { worlds: c.worlds | 0, blocks: c.changedBlocks | 0, containers: c.containers | 0, chunks: c.savedChunks | 0, records: c.otherWorldRecords | 0 };
  } catch { return null; }
}
// True when `now` holds clearly less than `had`: a world gone, all shared-world progress gone, or far fewer changed blocks.
export function shrunk(now, had) {
  if (!now || !had) return false;
  if (now.worlds < had.worlds) return true;
  if (had.records > 0 && now.records === 0) return true;
  if (had.blocks >= 200 && now.blocks < had.blocks * 0.6) return true;
  return false;
}
const score = (c) => (c ? c.worlds * 1e9 + c.blocks * 100 + c.records * 10 + c.chunks : -1);

export function createAutosave({ snapshot, ready, onChange, gate }) {
  const S = { last: 0, fails: 0, handle: null, fileName: '', busy: false, again: false, timer: 0, held: null, paused: '', fileOk: false };
  const emit = () => { if (onChange) onChange(); };
  const canWrite = async (ask) => {
    if (!S.handle) return false;
    try {
      const o = { mode: 'readwrite' };
      if ((await S.handle.queryPermission(o)) === 'granted') return true;
      return ask && (await S.handle.requestPermission(o)) === 'granted';
    } catch { return false; }
  };
  async function init() {
    if (!FS) return;
    const h = await getKey('handle');
    if (h && h.kind === 'file') { S.handle = h; S.fileName = h.name; emit(); }
  }
  const ini = init();

  function download(buf, name = FILE_NAME) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' })); a.download = name;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  // What the file you picked holds right now (null if it is empty, new or unreadable).
  async function fileCounts() {
    try { const f = await S.handle.getFile(); if (!f.size) return null; return countsOf(await f.slice(0, 200000).arrayBuffer()); } catch { return null; }
  }

  async function run(manual) {
    if (S.busy) { if (manual) S.again = true; return null; }
    if (!ready()) return false;
    const g = gate ? gate() : { open: true };
    if (!g.open) { S.paused = g.why || 'waiting'; emit(); return 'gated'; }
    S.paused = '';
    S.busy = true; let ok = false, result = false; const accepted = !!S.accept;
    try {
      const buf = await snapshot(), now = countsOf(buf);
      const [cur, peak] = [await getKey('file'), await getKey('peak')];
      const had = S.accept ? null : (cur && cur.counts) || (cur && cur.buf ? countsOf(cur.buf) : null);
      let hold = null;
      if (shrunk(now, had)) hold = { why: 'server', now, had, time: cur && cur.time };
      let toFile = false;
      if (!hold && (await canWrite(false))) {
        if (!S.fileOk && !S.accept) { // first write to this file in this visit: make sure it does not hold more than the game does
          const fc = await fileCounts();
          if (shrunk(now, fc)) hold = { why: 'file', now, had: fc, file: S.fileName };
          else S.fileOk = true;
        }
        if (!hold) {
          try { const w = await S.handle.createWritable(); await w.write(buf); await w.close(); toFile = true; } // the old file is replaced when the write closes
          catch { S.handle = null; S.fileName = ''; S.fileOk = false; delKey('handle'); } // moved or deleted: press U to pick it again
        }
      }
      if (hold) {
        S.held = hold; result = 'held'; // nothing was written anywhere: your last good copy is untouched
      } else {
        S.held = null; S.accept = false;
        if (cur && cur.buf) await setKey('prev', cur); // keep the one before, in case this save turns out to be the bad one
        const wrote = await setKey('file', { buf, time: Date.now(), counts: now });
        if (!wrote) throw new Error('browser storage refused the save');
        if (accepted || score(now) >= score(peak && peak.counts)) await setKey('peak', { buf, time: Date.now(), counts: now }); // the fullest game seen so far
        if (manual && !toFile && !FS) download(buf);
        S.last = Date.now(); S.fails = 0; ok = true; result = true;
      }
    } catch { S.fails++; }
    S.busy = false; emit();
    if (S.again) { S.again = false; run(true); }
    return ok ? true : result;
  }

  return {
    get supportsFile() { return FS; },
    get last() { return S.last; },
    get fails() { return S.fails; },
    get fileName() { return S.fileName; },
    get needsPick() { return FS && !S.handle; },
    get held() { return S.held; },
    get paused() { return S.paused; },
    // "My game really is smaller" (a world was deleted on purpose, say): the next save is allowed to replace the bigger one.
    acceptSmaller() { S.accept = true; S.held = null; S.fileOk = true; emit(); },
    start() { if (!S.timer) S.timer = setInterval(() => { if (!document.hidden) run(false); }, EVERY); },
    stop() { clearInterval(S.timer); S.timer = 0; },
    later(ms) { setTimeout(() => run(false), ms); }, // one last save just after you leave a world
    // U / the SAVE button: do the next save right now (the same quiet save, just early)
    async now() {
      await ini;
      if (FS && !S.handle) { // the picker needs this very key press or tap, so it comes before anything is awaited
        try {
          S.handle = await window.showSaveFilePicker({ suggestedName: FILE_NAME, types: [{ description: 'Voxel Craft game save', accept: { 'application/octet-stream': ['.vrworld'] } }] });
          S.fileName = S.handle.name; S.fileOk = false; await setKey('handle', S.handle);
        } catch { /* cancelled: the browser copy still works */ }
      }
      return run(true);
    },
    // call from a click: lets the game write to the file you picked last time (browsers ask again after a restart)
    async arm() { await ini; if (S.handle) { if (await canWrite(true)) emit(); } },
    // The best copy this browser holds ({ buf, time, counts }): the newest one, unless the peak holds clearly more.
    async loadSaved() {
      const [cur, peak] = [await getKey('file'), await getKey('peak')];
      const c = cur && cur.buf ? { ...cur, counts: cur.counts || countsOf(cur.buf) } : null, p = peak && peak.buf ? { ...peak, counts: peak.counts || countsOf(peak.buf) } : null;
      if (c && p) return shrunk(c.counts, p.counts) ? p : c;
      return c || p || null;
    },
    // Hand the browser's copy to you as a file (the way out when nothing else works).
    async downloadBackup() { const b = await this.loadSaved(); if (!b) return false; download(b.buf, `voxel-craft-browser-backup-${new Date(b.time || Date.now()).toISOString().slice(0, 10)}.vrworld`); return true; },
  };
}
