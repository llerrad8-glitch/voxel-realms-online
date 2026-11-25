// Quiet save status. The game saves itself every 10 seconds (see autosave.js), so there are no warnings, banners, pop-ups or
// "are you sure you want to leave" questions any more. This only draws a small note in the pause menu and on the home screen, and
// flashes a short "Saved" in the corner when you press U or tap SAVE.
const $ = (id) => document.getElementById(id);
const ago = (ms) => { const s = Math.round(ms / 1000), m = Math.round(ms / 60000); return s < 15 ? 'just now' : s < 60 ? `${s} s ago` : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

export function createReminder({ store, save, hasGame, autosave, gate, gateClick }) {
  const S = { last: +store.get('lastSave', 0) || 0, playing: false, note: null };
  const hud = $('saveHud'), banner = $('saveBanner'), strip = $('saveMenu'), pauseInfo = $('saveGameInfo'), pauseBtn = $('saveGameBtn');
  banner.hidden = true;
  let noteTimer = 0;
  function render() {
    const last = Math.max(S.last, autosave ? autosave.last : 0), age = last ? ago(Date.now() - last) : '';
    // the corner pill: only a short note after U / SAVE, or (quietly) if saving has failed several times in a row
    const failing = autosave && autosave.fails >= 3, gs = gate ? gate() : 'open', held = autosave && autosave.held, off = gs === 'needs' || gs === 'checking' || !!held;
    hud.hidden = !(S.playing && (S.note || failing || off));
    if (!hud.hidden) { hud.className = S.note ? S.note.cls : off ? 'bad' : 'warn'; hud.style.animation = 'none'; hud.textContent = S.note ? S.note.text : off ? (gs === 'checking' ? 'Autosave is waiting for the server to answer…' : 'Autosave is OFF: your game file is not loaded yet. Open the pause menu (Esc).') : 'Autosave is not working right now. Trying again…'; }
    // pause menu
    let info = gs === 'needs' || held ? 'AUTOSAVE IS OFF until your game file is loaded (Home screen, Import Game Save).' : 'Saves itself every 10 seconds' + (last ? ` · last saved ${age}` : '') + '.';
    if (autosave) info += autosave.supportsFile ? (autosave.fileName ? ` Keeping “${autosave.fileName}” up to date.` : ' Press U once to choose a file to keep up to date.') : ' U or SAVE also downloads a save file.';
    pauseInfo.textContent = info;
    pauseBtn.className = 'big'; pauseBtn.style.background = 'linear-gradient(#7fd24a,#58a62f)'; pauseBtn.textContent = 'Save Game (U)';
    // home screen: a calm one-liner for anyone who has played here before
    const has = hasGame();
    strip.hidden = !has;
    strip.onclick = null; strip.style.cursor = '';
    if (gs === 'needs' || held) { strip.hidden = false; strip.className = 'savestrip bad'; strip.textContent = '⚠ Autosave is OFF so it cannot overwrite your save. Tap here to load your game file.'; strip.style.cursor = 'pointer'; strip.onclick = () => gateClick && gateClick(); }
    else if (has) { strip.className = 'savestrip ok'; strip.style.animation = 'none'; strip.textContent = gs === 'checking' ? 'Checking your save with the server…' : `✓ Autosave is on${last ? ` · last saved ${age}` : ''}. If the server ever loses your game, it is put back automatically.`; }
    const warn = window.__vrStorageWarn; if (warn && !strip.hidden && gs === 'open') strip.textContent += ' ⚠ ' + warn;
    document.title = 'Voxel Craft';
  }
  return {
    setPlaying(on) { S.playing = on; if (!on) S.note = null; render(); },
    tick() { /* nothing to count any more */ },
    notify(text, cls = 'ok', ms = 2200) { S.note = { text, cls }; render(); clearTimeout(noteTimer); noteTimer = setTimeout(() => { S.note = null; render(); }, ms); },
    saved() { S.last = Date.now(); store.set('lastSave', S.last); render(); },
    restoreLast(t) { if (t && t > S.last) { S.last = t; store.set('lastSave', t); render(); } },
    save,
    render,
    confirmLeave(proceed) { proceed(); }, // leaving never asks about saving
    guardUnload() { /* closing the tab never asks either */ },
  };
}
