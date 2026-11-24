// Everything the player sees for saved chunks, world settings and Active Worlds. It only asks the server for things and draws
// what the server says; the server decides every outcome.
import { CS } from './shared/world.js';

const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.append(e); if (text !== undefined) e.textContent = text; return e; };
const button = (parent, text, fn, cls) => { const b = el('button', cls || '', parent, text); b.type = 'button'; b.onclick = fn; return b; };
const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 20);

export function createSaves({ send, store, say, lock, onClaims, join, api }) {
  const S = { room: null, vault: { on: true, linked: false, slots: [null, null, null] }, claims: new Map(), placing: null, typed: '' };
  const stack = []; // open overlays, topmost last
  let relock = false, jx = 0, jz = 0;

  /* ---------- overlay plumbing ---------- */
  function overlay(title, wide) {
    const ov = el('div', 'overlay modal', document.body), panel = el('div', wide ? 'panel wide' : 'panel', ov);
    ov.hidden = true;
    if (title) { const h = el('h1', '', panel, title); h.style.fontSize = '28px'; }
    const body = el('div', 'mbody', panel);
    return { ov, panel, body, onClose: null };
  }
  function show(o) {
    if (!stack.length) { relock = !!document.pointerLockElement; }
    if (!stack.includes(o)) stack.push(o);
    o.ov.hidden = false; syncPlace();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function hide(o, again) {
    const i = stack.indexOf(o); if (i >= 0) stack.splice(i, 1);
    o.ov.hidden = true; syncPlace();
    if (o.onClose) o.onClose();
    if (!stack.length && relock && again !== false) { relock = false; lock(); }
  }
  const closeAll = () => { for (const o of [...stack]) hide(o, false); relock = false; };

  /* ---------- small dialogs ---------- */
  const askBox = overlay('', false); let askQueue = [], askCur = null;
  const askTitle = el('h1', '', askBox.body); askTitle.style.fontSize = '24px';
  const askText = el('p', 'sub', askBox.body), askRow = el('div', 'row', askBox.body);
  const askYes = button(askRow, 'Yes', () => done(true), 'go'), askNo = button(askRow, 'No', () => done(false));
  function done(yes) { const a = askCur; askCur = null; hide(askBox, !askQueue.length); if (a) (yes === true ? a.onYes : yes === false ? a.onNo : a.onCancel)?.(); next(); }
  function next() { if (askCur || !askQueue.length) return; askCur = askQueue.shift(); askTitle.textContent = askCur.title; askText.textContent = askCur.text; askYes.textContent = askCur.yes || 'Yes'; askNo.textContent = askCur.no || 'No'; askNo.hidden = askCur.no === null; show(askBox); }
  function ask(o) { askQueue.push(o); next(); }

  const nameBox = overlay('Name your saved chunk', false); let nameTarget = null;
  el('p', 'sub', nameBox.body, 'Everything in this chunk (blocks, chests, furnaces) is protected and saved under this name. You can have three.');
  const nameIn = el('input', '', nameBox.body); nameIn.type = 'text'; nameIn.maxLength = 20; nameIn.placeholder = 'My base'; nameIn.autocomplete = 'off';
  const nameMsg = el('div', 'msg', nameBox.body), nameRow = el('div', 'row', nameBox.body); nameRow.style.marginTop = '10px';
  const saveName = () => {
    const n = cleanName(nameIn.value);
    if (!n) { nameMsg.textContent = 'Type a name first.'; return; }
    if (S.vault.slots.some((s) => s && s.name.toLowerCase() === n.toLowerCase())) { nameMsg.textContent = 'You already have a saved chunk with that name.'; return; }
    const t = nameTarget; nameTarget = null; hide(nameBox);
    send({ t: 'cs', x: t.x, y: t.y, z: t.z, nx: t.n[0], ny: t.n[1], nz: t.n[2], name: n });
  };
  button(nameRow, 'Place and save', saveName, 'go'); button(nameRow, 'Cancel', () => { nameTarget = null; hide(nameBox); });
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveName(); });
  function askName(t) {
    if (!S.vault.on) { say('Chunk Savers only work in survival worlds with no creative mode or cheats.'); return; }
    if (S.vault.slots.filter(Boolean).length >= 3) { say('You already have three saved chunks. Release one first (pause menu, Saved chunks).'); return; }
    nameTarget = t; nameIn.value = ''; nameMsg.textContent = ''; show(nameBox); setTimeout(() => nameIn.focus(), 30);
  }

  function copy(text, btn) { try { navigator.clipboard.writeText(text); const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = o; }, 1500); } catch { /* clipboard blocked */ } }

  /* ---------- saved chunks panel ---------- */
  const panel = overlay('Saved chunks', true);
  function openPanel() { send({ t: 'vinfo' }); renderPanel(); show(panel); }
  function renderPanel() {
    const b = panel.body, v = S.vault; b.textContent = '';
    if (!v.on) { el('p', 'sub', b, 'Chunk Savers are switched off in this world, because creative mode or cheats have been used here. They work in survival worlds with no cheats, such as the public world.'); }
    else {
      el('p', 'sub', b, 'Craft a Chunk Saver (one diamond in the middle, eight stone around it) and place it to protect and save the chunk it stands in. You can keep three saved chunks and move them between worlds.');
      const sv = el('p', 'sub', b, 'Saved chunks, like everything else, are kept for good by exporting your game: use Save Game in the menu.'); sv.style.color = 'var(--sun)';
      el('label', '', b, 'Saved chunks (' + v.slots.filter(Boolean).length + ' of 3)').style.marginTop = '10px';
      v.slots.forEach((s, i) => {
        const r = el('div', 'slotrow', b);
        if (!s) { el('b', '', r, `${i + 1}. Empty slot`); return; }
        const info = el('div', 'si', r); el('b', '', info, `${i + 1}. ${s.name}`);
        const where = s.st === 'here' ? `Placed in this world, chunk ${s.cx}, ${s.cz}` : `Saved from "${s.wname || 'another world'}", chunk ${s.cx}, ${s.cz}`;
        const state = s.st === 'ready' ? ' · its original spot is free here' : s.st === 'blocked' ? ' · its original spot is taken here' : '';
        el('div', 'sub', info, where + state).style.margin = '2px 0 0';
        const btns = el('div', 'row', r);
        if (s.st !== 'here') button(btns, 'Restore here', () => ask({ title: `Restore "${s.name}" here?`, text: `This moves the chunk into this world${s.wname && s.wname !== S.room.name ? ` and takes it out of "${s.wname}"` : ''}, so nothing is duplicated.`, yes: 'Restore', no: 'Cancel', onYes: () => send({ t: 'crest', slot: i, at: 'orig' }) }), 'go');
        button(btns, s.st === 'here' ? 'Move elsewhere' : 'Choose a spot', () => { startPlacing(i, s.name); hide(panel, false); closeAll(); });
        button(btns, 'Release', () => ask({ title: `Release "${s.name}"?`, text: 'The chunk stops being protected and its slot is free again. Its blocks stay where they are as ordinary blocks.', yes: 'Release', no: 'Cancel', onYes: () => send({ t: 'crel', slot: i }) }));
      });
    }
    const x = el('div', 'row', b); x.style.marginTop = '14px'; button(x, 'Close', () => hide(panel));
  }

  /* ---------- placing a saved chunk somewhere else ---------- */
  const placeBtn = el('div', 'placeside', document.body); placeBtn.hidden = true;
  const placeMain = button(placeBtn, '', () => pressPlace(), 'go'), placeX = button(placeBtn, 'Cancel', () => { S.placing = null; placeBtn.hidden = true; });
  const syncPlace = () => { placeBtn.hidden = !S.placing || stack.length > 0; };
  function startPlacing(i, name) { S.placing = { slot: i, name }; syncPlace(); say(`Walk to a free spot and press the "Place" button on the right (or press P) to put "${name}" there.`); updatePlace(); }
  function pressPlace() { if (S.placing) send({ t: 'crest', slot: S.placing.slot, at: 'here' }); }
  function updatePlace() {
    if (!S.placing) return;
    const cx = Math.floor(jx / CS), cz = Math.floor(jz / CS), c = S.claims.get(`${cx},${cz}`);
    placeMain.textContent = c ? `Chunk ${cx}, ${cz} is claimed: move on` : `Place "${S.placing.name}" here (P)\nchunk ${cx}, ${cz}`;
    placeMain.style.whiteSpace = 'pre-line'; placeMain.style.opacity = c ? 0.6 : 1;
  }

  /* ---------- host settings ---------- */
  const host = overlay('World settings', true);
  function openHost() { renderHost(); show(host); }
  function renderHost() {
    const b = host.body, r = S.room; b.textContent = '';
    if (!r || !r.owner || r.locked) { el('p', 'sub', b, 'Only the host of a private world can change its settings.'); button(b, 'Close', () => hide(host)); return; }
    el('p', 'sub', b, 'You are the host. These controls are yours alone, and you keep them when you leave and come back.');
    el('label', '', b, 'World name'); const name = el('input', '', b); name.type = 'text'; name.maxLength = 24; name.value = r.name;
    el('label', '', b, 'Game mode');
    const mode = el('select', '', b); for (const [v, t] of [['survival', 'Survival'], ['creative', 'Creative']]) { const o = el('option', '', mode, t); o.value = v; } mode.value = r.mode;
    const chk = (text, val) => { const l = el('label', 'chk', b); l.style.marginTop = '10px'; const c = el('input', '', l); c.type = 'checkbox'; c.checked = !!val; l.append(text); return c; };
    const pvp = chk(' PvP', r.pvp), cheats = chk(' Cheats (/give, /spawn)', r.cheats), build = chk(' Visitors can build and break blocks', r.perm.build), chests = chk(' Visitors can open chests and furnaces', r.perm.containers), live = chk(' Make this world live (show it in Active Worlds)', r.live);
    const warn = el('p', 'sub', b); warn.style.color = 'var(--sun)';
    warn.textContent = r.cheated ? 'Creative mode or cheats have been used in this world, so Chunk Savers stay off here.' : r.claims ? `This world has ${r.claims} protected chunk(s). Release or move them before using creative mode or cheats.` : 'Creative mode and cheats turn Chunk Savers off in this world for good.';
    const msg = el('div', 'msg', b), row = el('div', 'row', b); row.style.marginTop = '10px';
    button(row, 'Apply', () => {
      const s = { t: 'wset', name: name.value, mode: mode.value, pvp: pvp.checked, cheats: cheats.checked, build: build.checked, containers: chests.checked, live: live.checked };
      const taint = !r.cheated && ((s.mode === 'creative' && r.mode !== 'creative') || (s.cheats && !r.cheats));
      const go = () => { send(s); msg.textContent = 'Sent.'; };
      if (taint) ask({ title: 'Turn on creative or cheats?', text: 'Chunk Savers will be switched off in this world for good.', yes: 'Do it', no: 'Cancel', onYes: go }); else go();
    }, 'go');
    button(row, 'Close', () => hide(host));
  }

  /* ---------- Active Worlds ---------- */
  const worlds = overlay('Active Worlds', true);
  el('p', 'sub', worlds.body, 'Worlds whose hosts have made them live. Pick one to join.');
  const wlist = el('div', 'wlist', worlds.body), wmsg = el('div', 'msg', worlds.body), wrow = el('div', 'row', worlds.body);
  button(wrow, 'Refresh', () => loadWorlds()); button(wrow, 'Back', () => hide(worlds, false));
  async function loadWorlds() {
    wlist.textContent = ''; wmsg.textContent = 'Loading…';
    try {
      const j = await api('/api/worlds');
      wmsg.textContent = j.worlds.length ? '' : 'No live worlds right now. A host can make a world live in its World settings.';
      for (const w of j.worlds) {
        const r = el('div', 'slotrow', wlist), info = el('div', 'si', r);
        el('b', '', info, w.name); el('div', 'sub', info, `Host ${w.host}${w.hostOnline ? ' (online)' : ''} · ${w.mode === 'creative' ? 'Creative' : 'Survival'}${w.pvp && w.mode !== 'creative' ? ', PvP' : ''} · ${w.players}/${w.max} players`).style.margin = '2px 0 0';
        const jb = button(r, w.players >= w.max ? 'Full' : 'Join', () => { closeAll(); join(w.id); }, 'go'); jb.disabled = w.players >= w.max; jb.style.flex = '0 0 auto';
      }
    } catch { wmsg.textContent = 'Could not reach the game server.'; }
  }
  function openWorlds() { show(worlds); loadWorlds(); }

  /* ---------- HUD: which chunk am I in ---------- */
  const claimInfo = el('div', 'claiminfo', document.body); claimInfo.hidden = true;
  function update(px, pz) {
    jx = px; jz = pz;
    const c = S.claims.get(`${Math.floor(px / CS)},${Math.floor(pz / CS)}`);
    if (c) { claimInfo.hidden = false; claimInfo.textContent = c.mine ? `Your protected chunk: ${c.name}` : `Protected chunk "${c.name}", owned by ${c.owner}`; claimInfo.className = 'claiminfo' + (c.mine ? ' mine' : ''); } else claimInfo.hidden = true;
    updatePlace();
  }
  const foreign = (x, z) => { const c = S.claims.get(`${Math.floor(x / CS)},${Math.floor(z / CS)}`); return c && !c.mine ? c : null; };

  /* ---------- messages from the server ---------- */
  function setClaims(list) { S.claims = new Map((list || []).map((c) => [`${c.cx},${c.cz}`, c])); onClaims(list || []); updatePlace(); }
  function joinPrompts(v) {
    if (!v || !v.linked) return;
    const blocked = v.slots.map((s, i) => s && s.st === 'blocked' ? [s, i] : null).filter(Boolean), ready = v.slots.filter((s) => s && s.st === 'ready');
    for (const [s, i] of blocked) askSpot(i, s.name, s.cx, s.cz, s.why, s.by);
    if (ready.length) say(`${ready.length} of your saved chunks can be placed in this world. Open the pause menu, Saved chunks, to restore ${ready.length === 1 ? 'it' : 'them'}.`);
  }
  function askSpot(slot, name, cx, cz, why, by) {
    const reason = why === 'claimed' ? `already claimed by ${by || 'another player'}` : why === 'spawn' ? 'in the area around the world spawn, which cannot be claimed' : 'already built on by other players';
    ask({ title: 'Place it somewhere else?', text: `Your saved chunk "${name}" belongs at chunk ${cx}, ${cz}, but that spot is ${reason}. Do you want to place it somewhere else?`, yes: 'Yes', no: 'No', onYes: () => startPlacing(slot, name) });
  }
  return {
    get isOpen() { return stack.length > 0; },
    get vault() { return S.vault; },
    onWelcome(m) {
      S.room = m.room; S.vault = m.vault || S.vault; setClaims(m.claims); S.placing = null; syncPlace();
      if (m.note) say(m.note);
      joinPrompts(m.vault);
    },
    onRoom(room) { S.room = room; if (!host.ov.hidden) renderHost(); },
    onMsg(m) {
      switch (m.t) {
        case 'vault': S.vault = m; if (!panel.ov.hidden) renderPanel(); return true;
        case 'claims': setClaims(m.list); return true;
        case 'cprompt': askSpot(m.slot, m.name, m.cx, m.cz, m.why, m.by); return true;
        case 'cres': say(m.msg); if (m.ok) { S.placing = null; syncPlace(); } return true;
      }
      return false;
    },
    openPanel, openHost, openWorlds, askName, pressPlace, update, foreign, closeAll, ask,
    reset() { closeAll(); S.vault = { on: true, linked: false, slots: [null, null, null] }; S.claims = new Map(); S.placing = null; S.room = null; syncPlace(); claimInfo.hidden = true; onClaims([]); },
    key(e) { if (e.code === 'Escape' || e.key === 'Escape') { const top = stack[stack.length - 1]; if (top === askBox) done(askCur && askCur.esc ? null : false); else if (top === nameBox) { nameTarget = null; hide(nameBox); } else if (top) hide(top); } },
    get placing() { return S.placing; },
  };
}
