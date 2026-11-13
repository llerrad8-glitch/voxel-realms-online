// Game Saves on the home screen: Export Game Save / Import Game Save. One .vrworld file holds a whole game (see server/vrworld.js).
// The server builds and checks the file; this page shows progress, re-checks the download, and asks before anything is replaced.
const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.append(e); if (text !== undefined) e.textContent = text; return e; };
const mb = (n) => (n / 1048576 >= 0.1 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const MAGIC = 'VRWORLD\0';

export function createGameSaves({ store, url, getCode, apply, onClose }) {
  const ov = el('div', 'overlay modal', document.body), panel = el('div', 'panel wide', ov); ov.hidden = true;
  const title = el('h1', '', panel); title.style.fontSize = '26px';
  const body = el('div', 'mbody', panel);
  let busy = false;
  const open = (t) => { title.textContent = t; body.textContent = ''; ov.hidden = false; };
  const close = () => { if (busy) return; ov.hidden = true; if (onClose) onClose(); };
  const text = (t, cls) => el('p', cls || 'sub', body, t);
  const row = () => { const r = el('div', 'row', body); r.style.marginTop = '12px'; return r; };
  const btn = (parent, t, fn, cls) => { const b = el('button', cls || '', parent, t); b.type = 'button'; b.onclick = fn; return b; };
  function progress(label) {
    body.textContent = '';
    const l = el('p', 'sub', body, label), bar = el('div', '', body), fill = el('div', '', bar);
    bar.style.cssText = 'height:16px;background:#0b1620;border:2px solid #1f2d3a;overflow:hidden;margin:10px 0';
    fill.style.cssText = 'height:100%;width:0;background:#4caf50;transition:width .15s';
    return { set(pct, t) { if (t) l.textContent = t; if (pct === null) { fill.style.width = '35%'; fill.style.animation = 'gsPulse 1.2s ease-in-out infinite alternate'; } else { fill.style.animation = ''; fill.style.width = Math.max(2, Math.min(100, pct)) + '%'; } } };
  }
  const style = el('style', '', document.head, '@keyframes gsPulse{from{margin-left:0}to{margin-left:65%}}');
  void style;
  function fail(t, msg) { busy = false; open(t); text(msg, 'sub').style.color = '#ff9b8e'; btn(row(), 'Close', close); }
  const xhr = (method, path, { headers = {}, body: data, type = 'json', up, down } = {}) => new Promise((resolve, reject) => {
    const x = new XMLHttpRequest(); x.open(method, url(path)); x.responseType = type === 'json' ? 'text' : 'arraybuffer';
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    if (up) x.upload.onprogress = (e) => e.lengthComputable && up(e.loaded / e.total);
    if (down) x.onprogress = (e) => down(e.lengthComputable ? e.loaded / e.total : null, e.loaded);
    x.onerror = () => reject(new Error('Could not reach the game server. Check your connection and that the server is running.'));
    x.ontimeout = () => reject(new Error('The server took too long to answer.'));
    x.onload = () => {
      if (type === 'json') { let j; try { j = JSON.parse(x.responseText); } catch { return reject(new Error(`The server sent an unexpected reply (HTTP ${x.status}).`)); } return x.status === 200 ? resolve(j) : reject(new Error(j.error || `The server refused the request (HTTP ${x.status}).`)); }
      if (x.status === 200) return resolve({ buf: x.response, notes: x.getResponseHeader('x-vr-notes') });
      try { reject(new Error(JSON.parse(new TextDecoder().decode(x.response)).error || `HTTP ${x.status}`)); } catch { reject(new Error(`The server refused the request (HTTP ${x.status}).`)); }
    };
    x.send(data);
  });
  const save = (buf, name) => { const a = el('a', '', document.body); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' })); a.download = name; a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); };

  // Re-reads a finished file the way the server will: structure, header, and the SHA-256 at its end.
  async function verify(buf) {
    const u = new Uint8Array(buf), dv = new DataView(buf);
    if (u.length < 60 || String.fromCharCode(...u.subarray(0, 8)) !== MAGIC) throw new Error('The downloaded file does not look like a game save.');
    const hlen = dv.getUint32(10), header = JSON.parse(new TextDecoder().decode(u.subarray(14, 14 + hlen))), tail = header.signed ? 64 : 32;
    if (14 + hlen + tail >= u.length) throw new Error('The downloaded file is incomplete.');
    if (!crypto.subtle) return { header, checked: false };
    const sum = new Uint8Array(await crypto.subtle.digest('SHA-256', u.subarray(0, u.length - tail))), want = u.subarray(u.length - tail, u.length - tail + 32);
    if (sum.some((v, i) => v !== want[i])) throw new Error('The downloaded file failed its integrity check, so it was not saved. Please try again.');
    return { header, checked: true };
  }

  /* ---------- export ---------- */
  async function exportGame() {
    if (busy) return;
    const token = store.get('token', null);
    if (!token) { open('Export Game Save'); text('Nothing to export yet: this browser has not played on this server. Join a world first, then come back.'); btn(row(), 'Close', close); return; }
    busy = true; open('Export Game Save');
    const pr = progress('Collecting and checking your whole game on the server…'); pr.set(null);
    try {
      const code = getCode(), client = { name: store.get('name', ''), cfg: store.get('cfg', {}), code: store.get('code', '') || code };
      const r = await xhr('POST', '/api/export', { type: 'bin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, code, client }), down: (f, n) => pr.set(f === null ? null : f * 100, f === null ? `Downloading… ${mb(n)}` : `Downloading… ${Math.round(f * 100)}%`) });
      pr.set(100, 'Checking the file you received…');
      const v = await verify(r.buf), h = v.header, c = h.counts || {};
      const name = `voxel-realms-${new Date().toISOString().slice(0, 10)}.vrworld`;
      save(r.buf, name); busy = false;
      open('Game save created');
      text(`${name} (${mb(r.buf.byteLength)}) was created${v.checked ? ', checked on the server and again here,' : ' and checked on the server,'} and your browser is saving it now.`);
      const ul = el('ul', '', body); ul.style.cssText = 'margin:6px 0 6px 18px;color:#c9d6e2;font-size:14px;line-height:1.5';
      el('li', '', ul, `${c.worlds || 0} world(s) you own, ${(c.changedBlocks || 0).toLocaleString()} changed blocks, ${c.containers || 0} chests and furnaces`);
      el('li', '', ul, c.saveCode ? `Your save code: inventory, equipment and ${c.savedChunks || 0} saved chunk(s)` : 'No save code was included');
      el('li', '', ul, `Your progress in ${c.otherWorldRecords || 0} shared world(s)`);
      for (const n of h.notes || []) text(n, 'hint');
      text('Keep this file somewhere safe and private: anyone who has it can restore your game. Export again whenever you want a fresh backup.', 'hint');
      btn(row(), 'Close', close, 'go');
    } catch (e) { fail('Export failed', `${e.message} Nothing on the server was changed.`); }
  }

  /* ---------- import ---------- */
  const fileIn = el('input', '', document.body); fileIn.type = 'file'; fileIn.accept = '.vrworld'; fileIn.hidden = true;
  fileIn.onchange = () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) importFile(f); };
  const pick = () => { if (!busy) fileIn.click(); };
  async function importFile(file) {
    busy = true; open('Import Game Save');
    try {
      const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      if (String.fromCharCode(...head) !== MAGIC) throw new Error(`"${file.name}" is not a Voxel Realms game save (.vrworld). Nothing was changed.`);
      const pr = progress(`Uploading ${file.name} (${mb(file.size)})…`);
      const token = store.get('token', null) || '';
      const pv = await xhr('POST', '/api/import/preview', { headers: { 'x-vr-token': token, 'content-type': 'application/octet-stream' }, body: file, up: (f) => pr.set(f * 100, f >= 1 ? 'Checking the whole file on the server: integrity, version and contents…' : `Uploading… ${Math.round(f * 100)}%`) });
      if (pv.token) store.set('token', pv.token);
      busy = false; review(pv, file.name);
    } catch (e) { fail('Import stopped', `${e.message} Nothing was changed.`); }
  }
  function review(pv, fname) {
    open('Import Game Save');
    text(`${fname}: made ${new Date(pv.created).toLocaleString()}, save format ${pv.format}${pv.gameVersion ? `, game ${pv.gameVersion}` : ''}. The file is complete and passed every check. Nothing has been changed yet.`);
    if (pv.signature === 'valid') text('Signature verified: this file was made by a server with your signing key.', 'hint');
    for (const w of pv.warnings || []) text(w, 'hint').style.color = 'var(--sun, #ffd34d)';
    const checks = [];
    for (const it of pv.items) {
      const r = el('div', 'slotrow', body), info = el('div', 'si', r);
      el('b', '', info, `${it.name}${it.blocks !== undefined ? ` · ${it.blocks.toLocaleString()} changed blocks` : ''}${it.chunks !== undefined ? ` · ${it.chunks} saved chunk(s)` : ''}${it.id && it.kind === 'world' ? ` · code ${it.id}` : ''}`);
      const d = el('div', 'sub', info, it.detail); d.style.margin = '2px 0 0'; if (it.status === 'blocked') d.style.color = '#ff9b8e';
      if (it.status === 'conflict') {
        const l = el('label', 'chk', r); l.style.cssText = 'margin-top:6px;color:#ffb199'; const c = el('input', '', l); c.type = 'checkbox'; l.append(' Replace what is on this server with the file’s version'); checks.push([it.key, c]);
      }
    }
    if (!pv.items.length) text('This file contains no worlds or progress to restore.');
    for (const n of pv.notes || []) text(n, 'hint');
    for (const n of pv.issues || []) text('Fixed while reading: ' + n, 'hint');
    let cb = null;
    if (pv.client && (pv.client.name || pv.client.cfg || pv.client.code)) {
      const have = store.get('name', '') || store.get('code', '');
      const l = el('label', 'chk', body); l.style.marginTop = '10px'; cb = el('input', '', l); cb.type = 'checkbox'; cb.checked = !have; l.append(' Also restore my name, settings and save code in this browser' + (have ? ' (replaces the ones saved here)' : ''));
    }
    text('A backup of anything that gets replaced is made first, and you can download it afterwards. Anything you leave unchecked keeps its current version.', 'hint');
    const r = row();
    const go = btn(r, 'Import', () => doCommit(pv, checks.filter(([, c]) => c.checked).map(([k]) => k), cb && cb.checked), 'go');
    const upd = () => { const n = checks.filter(([, c]) => c.checked).length; go.textContent = n ? `Import and replace ${n} item(s)` : 'Import'; }; for (const [, c] of checks) c.onchange = upd;
    btn(r, 'Cancel', close);
  }
  async function doCommit(pv, replace, withClient) {
    busy = true; open('Importing'); const pr = progress('Making a backup, writing your game, then reading it back to check it…'); pr.set(null);
    try {
      const token = store.get('token', null);
      const res = await xhr('POST', '/api/import/commit', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, importId: pv.importId, replace }) });
      if (withClient && res.client) apply(res.client);
      busy = false; open('Import finished');
      text(res.restored.length ? `Restored ${res.restored.length} item(s), each one read back from storage and checked:` : 'Nothing needed to be restored.');
      const ul = el('ul', '', body); ul.style.cssText = 'margin:6px 0 6px 18px;color:#c9d6e2;font-size:14px;line-height:1.5'; for (const t of res.restored) el('li', '', ul, t);
      if (res.skipped.length) { text('Not imported:'); const u2 = el('ul', '', body); u2.style.cssText = ul.style.cssText; for (const s of res.skipped) el('li', '', u2, `${s.name}: ${s.reason}`); }
      if (res.restored.some((t) => t.startsWith('World '))) text('Your worlds are back. Join them with “Join with a world code” on the home screen, using the world codes above.', 'hint');
      for (const n of res.notes || []) text(n, 'hint');
      for (const n of res.issues || []) text('Fixed while reading: ' + n, 'hint');
      const r = row();
      if (res.backup) {
        text(`A backup of what was replaced was made${res.backup.savedOnServer ? ` and is also in the server’s data folder (backups/${res.backup.file})` : '; it could NOT be saved on the server, so download it now'}.`, 'hint');
        btn(r, 'Download backup', async () => { try { const b = await xhr('POST', '/api/backup', { type: 'bin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: store.get('token', null), id: res.backup.id }) }); save(b.buf, res.backup.file); } catch (e) { text(e.message, 'sub').style.color = '#ff9b8e'; } });
      }
      btn(r, 'Done', close, 'go');
    } catch (e) { fail('Import failed', e.message); }
  }
  return { exportGame, pick, close, get isOpen() { return !ov.hidden; } };
}
