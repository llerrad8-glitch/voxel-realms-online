// The save gate. Autosave stays OFF until the game is sure it cannot overwrite your real save with an empty or smaller one.
//  - Brand-new browser: nothing to lose, autosave starts at once.
//  - You have played here before: the game checks the server against the copy this browser keeps. If the server has lost worlds (a host that
//    restarted, an update unzipped into a new folder...), it first tries to put them back from the browser copy; if that is not enough it asks you
//    to upload your .vrworld file. Autosave is paused until then, so nothing can overwrite your file or the browser's backup.
//  - If autosave ever finds the server holding clearly LESS than your last save, it pauses and asks the same question.
const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.append(e); if (text !== undefined) e.textContent = text; return e; };

export function createSaveGate({ store, url, autosave, gameSaves, onChange }) {
  const G = { state: 'checking', why: '', dismissed: false, shownHeld: false };
  const ov = el('div', 'overlay modal', document.body), panel = el('div', 'panel wide', ov); ov.hidden = true; ov.style.zIndex = 60;
  const title = el('h1', '', panel); title.style.fontSize = '26px';
  const body = el('div', 'mbody', panel);
  const emit = () => { if (onChange) onChange(); };
  const text = (t, cls) => el('p', cls || 'sub', body, t);
  const btn = (parent, t, fn, cls) => { const b = el('button', cls || '', parent, t); b.type = 'button'; b.onclick = fn; return b; };
  const when = (t) => (t ? new Date(t).toLocaleString() : 'earlier');
  const describe = (c) => (c ? `${c.worlds} world(s), ${c.blocks.toLocaleString()} changed blocks` : 'nothing');

  const myWorlds = async () => {
    const r = await fetch(url('/api/myworlds'), { method: 'POST', body: JSON.stringify({ token: store.get('token', null) }), cache: 'no-store' });
    if (!r.ok) throw new Error('myworlds ' + r.status);
    return (await r.json()).worlds || [];
  };
  function setOpen() { G.state = 'open'; G.why = ''; ov.hidden = true; emit(); }
  function needs(why) { G.state = 'needs'; G.why = why; emit(); }

  // Check the server against what this browser knows. Safe to call as often as you like.
  async function evaluate() {
    const token = store.get('token', null), lastSave = +store.get('lastSave', 0) || 0;
    let copy = null; try { copy = await autosave.loadSaved(); } catch { /* no browser copy */ }
    if (!token && !lastSave && !copy) return setOpen(); // a brand-new game: there is nothing to overwrite
    let n; try { n = (await myWorlds()).length; } catch { G.state = 'checking'; emit(); return; } // server not answering: stay off, try again later
    const had = copy ? copy.counts : null;
    if (had && had.worlds > n) { // the server is missing worlds this browser still has: put them back first
      try { await gameSaves.autoRestore(copy.buf); n = (await myWorlds()).length; } catch { /* the file can still be imported by hand */ }
      if (n >= had.worlds) return setOpen();
      needs('server');
      return;
    }
    if (!copy && lastSave > 0 && n === 0) { needs('nocopy'); return; } // you saved before, but neither the server nor this browser has anything now
    setOpen();
  }

  async function show(kind) { // kind: 'server' | 'nocopy' | 'held' | 'file'
    let copy = null; try { copy = await autosave.loadSaved(); } catch { /* none */ }
    title.textContent = kind === 'held' || kind === 'file' ? 'Autosave paused to protect your game' : 'Upload your game file first';
    body.textContent = '';
    ov.hidden = false;
    const big = text(kind === 'held' || kind === 'file' ? 'Your last save was bigger than what the game would save now.' : 'The server does not have your game right now.', 'sub');
    big.style.cssText = 'color:var(--sun,#ffd34d);font-weight:800;font-size:18px';
    if (kind === 'held' || kind === 'file') {
      const h = autosave.held;
      text(kind === 'file'
        ? `The save file you picked (“${(h && h.file) || 'your file'}”) holds ${describe(h && h.had)}, but the game right now only has ${describe(h && h.now)}. Saving would overwrite it with less.`
        : `Your last save (${when(h && h.time)}) held ${describe(h && h.had)}. The server now has ${describe(h && h.now)}. Saving would replace your real game with less.`);
    } else if (kind === 'server') {
      text(`This browser remembers ${describe(copy && copy.counts)} from ${when(copy && copy.time)}, but the server has fewer worlds and the automatic restore could not bring them all back.`);
    } else {
      text('You have saved a game from this browser before, but the server has none of your worlds and this browser has no backup copy any more.');
    }
    text('Autosave is OFF so nothing can overwrite your file. Upload your .vrworld game file (the newest one you have) and the game will carry on saving by itself.', 'sub');
    const hint = text('If you updated the server by unzipping a new folder, your worlds are still in the OLD folder’s data/ directory. Copy it across, or set DATA_DIR to a folder outside the project so updates never touch it.', 'hint');
    hint.style.opacity = 0.85;
    const r = el('div', 'row', body); r.style.cssText = 'margin-top:12px;flex-wrap:wrap;gap:8px';
    btn(r, 'Choose my game file (.vrworld)', () => { ov.hidden = true; gameSaves.pick(); }, 'go');
    if (copy && kind !== 'file') btn(r, `Restore from this browser’s backup (${when(copy.time)})`, async (e) => {
      const b = e.target; b.disabled = true; b.textContent = 'Restoring…';
      try { await gameSaves.autoRestore(copy.buf); await evaluate(); b.textContent = G.state === 'open' ? 'Restored' : 'Restored what was missing'; if (G.state === 'open') setTimeout(() => { ov.hidden = true; }, 900); } catch { b.textContent = 'Could not restore, use your file'; }
      b.disabled = false;
    });
    if (copy) btn(r, 'Download the browser’s backup file', async () => { await autosave.downloadBackup(); });
    const r2 = el('div', 'row', body); r2.style.cssText = 'margin-top:10px;flex-wrap:wrap;gap:8px';
    btn(r2, 'Keep autosave off for now', () => { G.dismissed = true; ov.hidden = true; emit(); });
    btn(r2, kind === 'nocopy' || kind === 'server' ? 'Start a new game (turn autosave on)' : 'My game really is smaller, save anyway', () => {
      if (!confirm('Only do this if you are SURE you do not need the bigger save any more. Autosave will start and can replace it.')) return;
      autosave.acceptSmaller(); setOpen();
    }, 'danger');
  }

  return {
    evaluate,
    show,
    get state() { return G.state; },
    get open() { return G.state === 'open'; },
    get why() { return G.why; },
    get dismissed() { return G.dismissed; },
    // Called when autosave reports it is holding back a smaller save: ask once per visit.
    noticeHeld() { const h = autosave.held; if (h && !G.shownHeld) { G.shownHeld = true; show(h.why === 'file' ? 'file' : 'held'); } },
    // Called when Play is pressed: if your game file is still missing, ask first instead of letting you play unsaved.
    guardPlay() { if (G.state === 'needs' && !G.dismissed) { show(G.why); return false; } return true; },
    reset() { G.shownHeld = false; },
  };
}
