// Touch controls for phones and tablets: a floating joystick on the left, drag the right side to look, tap to place or use, hold to mine.
// It only turns touches into the same actions the keyboard and mouse perform (see touchApi in game.js).
const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.append(e); if (text !== undefined) e.textContent = text; return e; };

export function createTouch(api) {
  const root = el('div', 'tc', document.body); root.hidden = true;
  const R = () => Math.max(46, Math.min(70, Math.min(innerWidth, innerHeight) * 0.13)); // stick radius in px
  const LOOK = 0.0048; // radians per pixel
  let st = 'hidden';

  /* ---- movement and look areas (multi-touch: each finger is tracked by its pointer id) ---- */
  const zoneL = el('div', 'tz tzl', root), zoneR = el('div', 'tz tzr', root);
  const base = el('div', 'stick', root), knob = el('div', 'knob', base); base.hidden = true;
  let sp = null; // the joystick finger
  const setKeys = (fwd, side) => { for (const [k, on] of [['KeyW', fwd > 0.28], ['KeyS', fwd < -0.28], ['KeyD', side > 0.28], ['KeyA', side < -0.28]]) on ? api.keys.add(k) : api.keys.delete(k); };
  const stickEnd = () => { sp = null; base.hidden = true; setKeys(0, 0); };
  zoneL.addEventListener('pointerdown', (e) => {
    if (api.sleeping()) { api.wake(); return; }
    if (sp) return; try { zoneL.setPointerCapture(e.pointerId); } catch { /* fine without */ }
    const r = R(), x = Math.max(r + 8, Math.min(innerWidth * 0.5, e.clientX)), y = Math.max(r + 8, Math.min(innerHeight - r - 8, e.clientY));
    sp = { id: e.pointerId, x, y }; base.hidden = false; base.style.cssText = `left:${x - r}px;top:${y - r}px;width:${2 * r}px;height:${2 * r}px`; knob.style.transform = 'translate(0,0)';
  });
  zoneL.addEventListener('pointermove', (e) => {
    if (!sp || e.pointerId !== sp.id) return;
    const r = R(); let dx = e.clientX - sp.x, dy = e.clientY - sp.y; const len = Math.hypot(dx, dy);
    if (len > r) { dx = dx / len * r; dy = dy / len * r; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    setKeys(-dy / r, dx / r);
    if (len > r * 1.05 && dy < 0) api.sprint(true); // pushed right to the edge: sprint
  });
  for (const t of ['pointerup', 'pointercancel']) zoneL.addEventListener(t, (e) => { if (sp && e.pointerId === sp.id) stickEnd(); });

  let lp = null; // the look finger
  zoneR.addEventListener('pointerdown', (e) => {
    if (api.sleeping()) { api.wake(); return; }
    if (lp) return; try { zoneR.setPointerCapture(e.pointerId); } catch { /* fine without */ }
    lp = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, mining: false };
    lp.timer = setTimeout(() => { if (lp && !lp.moved) { lp.mining = true; api.mine(true); if (navigator.vibrate) navigator.vibrate(12); } }, 260); // hold still: mine / attack
  });
  zoneR.addEventListener('pointermove', (e) => {
    if (!lp || e.pointerId !== lp.id) return;
    const dx = e.clientX - lp.x, dy = e.clientY - lp.y; lp.x = e.clientX; lp.y = e.clientY;
    if (!lp.moved && Math.hypot(e.clientX - lp.sx, e.clientY - lp.sy) > 14) { lp.moved = true; clearTimeout(lp.timer); }
    if (lp.moved || lp.mining) api.look(dx * LOOK, dy * LOOK); // you can keep turning while mining
  });
  const lookEnd = (e, cancel) => {
    if (!lp || e.pointerId !== lp.id) return;
    clearTimeout(lp.timer);
    if (lp.mining) api.mine(false);
    else if (!cancel && performance.now() - lp.t < 260 && Math.hypot(lp.x - lp.sx, lp.y - lp.sy) <= 26 && api.aimsAtFoe()) api.hit(); // a quick tap on a mob or player hits it: no holding, so PvP stays fluent
    else if (!lp.moved && !cancel && performance.now() - lp.t < 260) { api.use(true); setTimeout(() => api.use(false), 70); } // a quick tap places or uses
    lp = null;
  };
  zoneR.addEventListener('pointerup', (e) => lookEnd(e, false)); zoneR.addEventListener('pointercancel', (e) => lookEnd(e, true));

  /* ---- buttons ---- */
  const btn = (cls, text, parent = root) => { const b = el('button', 'tb ' + cls, parent, text); b.type = 'button'; return b; };
  const hold = (b, down, up) => { // a button that acts while a finger is on it
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* fine without */ } b.classList.add('on'); down(); });
    for (const t of ['pointerup', 'pointercancel']) b.addEventListener(t, () => { b.classList.remove('on'); up(); });
  };
  const tap = (b, fn) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
  const jump = btn('tjump', 'JUMP'); hold(jump, () => api.keys.add('Space'), () => api.keys.delete('Space'));
  const use = btn('tuse', 'USE'); hold(use, () => api.use(true), () => api.use(false));
  const sneak = btn('tsneak', 'SNEAK'); let sneaking = false; tap(sneak, () => { sneaking = !sneaking; sneak.classList.toggle('on', sneaking); sneaking ? api.keys.add('ShiftLeft') : api.keys.delete('ShiftLeft'); });
  const fly = btn('tfly', 'FLY'); tap(fly, () => api.fly());
  const top = el('div', 'ttop', root);
  const bMenu = btn('tsmall', '☰', top), bInv = btn('tsmall', 'BAG', top), bChat = btn('tsmall', 'CHAT', top), bSave = btn('tsmall tsave', 'SAVE', top);
  tap(bMenu, () => api.menu()); tap(bInv, () => api.inventory()); tap(bChat, () => api.chat()); tap(bSave, () => api.save());
  const close = btn('tclose', 'CLOSE'); tap(close, () => api.inventory());
  const split = btn('tsplit', 'SPLIT: OFF'); let right = false;
  tap(split, () => { right = !right; split.textContent = right ? 'SPLIT: ON' : 'SPLIT: OFF'; split.classList.toggle('on', right); });
  // With SPLIT on, the next tap in the inventory counts as a right click (take half, drop one), like holding the right mouse button.
  document.addEventListener('mousedown', (e) => {
    if (!right || e.button !== 0 || !e.isTrusted || !e.target.closest || !e.target.closest('.win')) return;
    e.stopImmediatePropagation(); e.preventDefault();
    e.target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey }));
  }, true);

  // the hotbar (#bar) sits under the touch areas, so taps inside it are picked out before they count as a joystick or a look
  const hotbarHit = (e) => {
    const hb = document.getElementById('bar'); if (!hb) return false;
    const r = hb.getBoundingClientRect();
    if (e.clientX < r.left - 4 || e.clientX > r.right + 4 || e.clientY < r.top - 10 || e.clientY > r.bottom + 10) return false;
    api.slot(Math.max(0, Math.min(8, Math.floor((e.clientX - r.left) / r.width * 9)))); return true;
  };
  for (const z of [zoneL, zoneR]) z.addEventListener('pointerdown', (e) => { if (hotbarHit(e)) e.stopImmediatePropagation(); }, true);

  const apply = () => {
    root.hidden = st === 'hidden';
    const play = st === 'play', ui = st === 'ui';
    for (const e of [zoneL, zoneR, jump, use, sneak, top]) e.hidden = !play;
    fly.hidden = !play || api.mode() !== 'creative';
    close.hidden = split.hidden = !ui;
    if (!play) { stickEnd(); if (lp) { clearTimeout(lp.timer); if (lp.mining) api.mine(false); lp = null; } api.use(false); api.keys.delete('Space'); }
  };
  return { setState(s) { if (s !== st) { st = s; apply(); } else if (s === 'play') fly.hidden = api.mode() !== 'creative'; } };
}
