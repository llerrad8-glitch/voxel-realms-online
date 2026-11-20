// Autosave. While you are in a world the game saves itself every 10 seconds, with no pop-ups.
//  - A copy of the newest save is always kept inside this browser (IndexedDB), and each save replaces the one before it.
//    On the next visit, if the server has lost something (free hosts reset), the game puts it back by itself (see gamesave.js, autoRestore).
//  - On desktop Chrome/Edge you can also pick a .vrworld file once (press U). From then on every autosave overwrites that same file,
//    so there is always exactly one up-to-date file on your computer. Other browsers cannot overwrite files, so there U / SAVE downloads one.
const FILE_NAME = 'voxel-craft-autosave.vrworld';
const FS = typeof window.showSaveFilePicker === 'function';
const EVERY = 10000;

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
const setKey = (k, v) => kv('readwrite', (s) => { s.put(v, k); }).catch(() => {});
const delKey = (k) => kv('readwrite', (s) => { s.delete(k); }).catch(() => {});

export function createAutosave({ snapshot, ready, onChange }) {
  const S = { last: 0, fails: 0, handle: null, fileName: '', busy: false, again: false, timer: 0 };
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

  function download(buf) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' })); a.download = FILE_NAME;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  async function run(manual) {
    if (S.busy) { if (manual) S.again = true; return null; }
    if (!ready()) return false;
    S.busy = true; let ok = false;
    try {
      const buf = await snapshot();
      await setKey('file', { buf, time: Date.now() }); // always: replaces the copy from 10 seconds ago
      let toFile = false;
      if (await canWrite(false)) {
        try { const w = await S.handle.createWritable(); await w.write(buf); await w.close(); toFile = true; } // the old file is replaced when the write closes
        catch { S.handle = null; S.fileName = ''; delKey('handle'); } // moved or deleted: press U to pick it again
      }
      if (manual && !toFile && !FS) download(buf);
      S.last = Date.now(); S.fails = 0; ok = true;
    } catch { S.fails++; }
    S.busy = false; emit();
    if (S.again) { S.again = false; run(true); }
    return ok;
  }

  return {
    get supportsFile() { return FS; },
    get last() { return S.last; },
    get fails() { return S.fails; },
    get fileName() { return S.fileName; },
    get needsPick() { return FS && !S.handle; },
    start() { if (!S.timer) S.timer = setInterval(() => { if (!document.hidden) run(false); }, EVERY); },
    stop() { clearInterval(S.timer); S.timer = 0; },
    later(ms) { setTimeout(() => run(false), ms); }, // one last save just after you leave a world
    // U / the SAVE button: do the next save right now (the same quiet save, just early)
    async now() {
      await ini;
      if (FS && !S.handle) { // the picker needs this very key press or tap, so it comes before anything is awaited
        try {
          S.handle = await window.showSaveFilePicker({ suggestedName: FILE_NAME, types: [{ description: 'Voxel Craft game save', accept: { 'application/octet-stream': ['.vrworld'] } }] });
          S.fileName = S.handle.name; await setKey('handle', S.handle);
        } catch { /* cancelled: the browser copy still works */ }
      }
      return run(true);
    },
    // call from a click: lets the game write to the file you picked last time (browsers ask again after a restart)
    async arm() { await ini; if (S.handle) { if (await canWrite(true)) emit(); } },
    async loadSaved() { const v = await getKey('file'); return v && v.buf ? v : null; },
  };
}
