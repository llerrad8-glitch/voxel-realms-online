// Save reminders. In Voxel Craft the game is saved by exporting it, so this keeps asking, loudly, until you do:
// a pill on screen that turns amber then red, a big banner, a pop-up every few minutes, a button in the pause menu and on the home screen,
// a warning when you leave the world or close the tab, and a flashing tab title. Time only counts while you are actually playing.
const $ = (id) => document.getElementById(id);
const ago = (ms) => { const m = Math.round(ms / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const mins = (s) => Math.max(1, Math.round(s / 60));

export function createReminder({ store, save, ask, hasGame }) {
  const S = { unsaved: +store.get('unsaved', 0) || 0, last: +store.get('lastSave', 0) || 0, next: 0, playing: false, saveAt: 0, title: document.title, modal: false };
  const hud = $('saveHud'), banner = $('saveBanner'), strip = $('saveMenu'), pauseInfo = $('saveGameInfo'), pauseBtn = $('saveGameBtn');
  const never = () => !S.last;
  const first = () => (never() ? 180 : 600); // seconds of unsaved play before the first pop-up
  S.next = S.unsaved >= first() ? S.unsaved + 300 : first();

  function level() { // 0 fine, 1 save soon, 2 save now
    const m = S.unsaved / 60;
    if (never()) return m < 1.5 ? 0 : m < 4 ? 1 : 2;
    return m < 3 ? 0 : m < 8 ? 1 : 2;
  }
  function status() {
    if (never()) return S.unsaved < 20 ? 'This game has never been saved' : `NOT SAVED: ${mins(S.unsaved)} min of progress, never backed up`;
    if (S.unsaved < 20) return `Saved ${ago(Date.now() - S.last)}`;
    return `Unsaved progress: ${mins(S.unsaved)} min (last saved ${ago(Date.now() - S.last)})`;
  }
  function render() {
    const lv = level(), cls = lv === 2 ? 'bad' : lv === 1 ? 'warn' : 'ok', text = status();
    // in-game pill and banner
    hud.hidden = !S.playing; hud.className = cls; hud.textContent = (lv === 2 ? '⚠ ' : lv === 0 && S.unsaved < 20 && !never() ? '✓ ' : '') + text + (lv ? ' · press U to save' : ' · U saves');
    banner.hidden = !(S.playing && lv === 2);
    banner.textContent = never() ? '⚠ THIS GAME IS NOT SAVED. Press U (or Esc, then Save Game) to download your game file.' : '⚠ YOUR PROGRESS IS NOT SAVED. Press U (or Esc, then Save Game) to download your game file.';
    // pause menu
    pauseInfo.textContent = text + '. Saving downloads one file with everything in it.'; pauseBtn.className = 'big'; pauseBtn.style.background = lv === 2 ? 'linear-gradient(#e0392c,#a8140d)' : lv === 1 ? 'linear-gradient(#ffb23f,#e0781c)' : 'linear-gradient(#7fd24a,#58a62f)';
    pauseBtn.textContent = lv ? 'Save Game now (U)' : 'Save Game (U)';
    // home screen strip: shown to anyone who has played here before
    const has = hasGame();
    strip.hidden = !has;
    if (has) {
      const none = never();
      strip.className = 'savestrip ' + (none ? 'bad' : lv ? (lv === 2 ? 'bad' : 'warn') : 'ok');
      strip.textContent = '';
      const t = document.createElement('span'); t.textContent = none ? '⚠ Your game has never been saved. If the server resets or you clear your browser, everything is gone.' : S.unsaved >= 20 ? `⚠ ${mins(S.unsaved)} min of progress since your last save (${ago(Date.now() - S.last)}). Save it now.` : `✓ Game saved ${ago(Date.now() - S.last)}. Save again after every play session.`;
      strip.append(t);
      const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Save Game now'; b.onclick = () => save(); strip.append(b);
    }
    document.title = S.playing && lv === 2 && Math.floor(Date.now() / 1000) % 2 ? '⚠ UNSAVED - Voxel Craft' : 'Voxel Craft';
  }
  function popup() {
    if (S.modal) return; S.modal = true;
    const long = mins(S.unsaved);
    ask({
      title: 'Save your game!',
      text: `${never() ? 'You have never saved this game.' : `You have played ${long} minute${long === 1 ? '' : 's'} since your last save.`} If the server restarts or you clear your browser, your worlds, items and chunks can be lost for good. Saving takes a few seconds and gives you one file.`,
      yes: 'Save Game Now', no: 'Remind me in 5 minutes', esc: true,
      onYes: () => { S.modal = false; save(); }, onNo: () => { S.modal = false; S.next = S.unsaved + 300; }, onCancel: () => { S.modal = false; S.next = S.unsaved + 300; },
    });
  }
  let sec = 0, persistAt = 0;
  return {
    setPlaying(on) { S.playing = on; render(); },
    tick(dt) { // called every frame while you are in a world
      if (!S.playing) return;
      S.unsaved += dt; sec += dt;
      if (sec >= 1) { sec = 0; render(); if (S.unsaved - persistAt >= 5) { persistAt = S.unsaved; store.set('unsaved', Math.round(S.unsaved)); } }
      if (S.unsaved >= S.next && !S.modal) popup();
    },
    saved() { S.last = Date.now(); S.unsaved = 0; persistAt = 0; S.next = 600; S.modal = false; store.set('lastSave', S.last); store.set('unsaved', 0); render(); },
    restoreLast(t) { if (t && t > S.last) { S.last = t; store.set('lastSave', t); render(); } },
    save,
    get unsaved() { return S.unsaved; },
    render,
    // leaving the world with unsaved progress: offer to save first
    confirmLeave(proceed) {
      if (S.unsaved < 20) return proceed();
      ask({ title: 'Save before you leave?', text: `You have ${mins(S.unsaved)} minute${mins(S.unsaved) === 1 ? '' : 's'} of progress that is not saved. Leave now and it is only kept on this server and in this browser.`, yes: 'Save Game Now', no: 'Leave without saving', esc: true, onYes: () => save(), onNo: proceed, onCancel: () => {} });
    },
    guardUnload() { addEventListener('beforeunload', (e) => { if (S.unsaved > 30) { e.preventDefault(); e.returnValue = ''; } }); },
  };
}
