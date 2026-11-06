// Survival HUD and the inventory screens. The screens only draw what the server says and send clicks back.
import { iconURL, hudIcons } from './icons.js';
import { itemInfo, CREATIVE_ITEMS } from './shared/items.js';

const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.append(e); return e; };
const $ = (id) => document.getElementById(id);

export function createUI({ send }) {
  const S = { inv: Array(36).fill(0), arm: [0, 0, 0, 0], cur: 0, sel: 0, wk: 'inv', ext: [], pr: 0, hp: 20, food: 20, air: 15, def: 0, mode: 'survival', open: false };
  const hud = $('hud');
  const stats = el('div', 'stats', hud), armorRow = el('div', 'srow', stats), hpRow = el('div', 'srow', stats), foodRow = el('div', 'srow right', stats), airRow = el('div', 'srow right', stats);
  const icons = (row) => Array.from({ length: 10 }, () => el('i', 'ic', row));
  const armorIc = icons(armorRow), hpIc = icons(hpRow), foodIc = icons(foodRow), airIc = icons(airRow);
  const bar = $('bar'), tip = el('div', 'tip', document.body), curEl = el('div', 'curitem', document.body);
  const selName = el('div', 'selname', hud), flashEl = el('div', 'flash', hud);
  const winEl = el('div', 'overlay win', document.body), panel = el('div', 'winpanel', winEl);
  const deadEl = el('div', 'overlay dead', document.body), deadBox = el('div', 'panel', deadEl);
  tip.hidden = curEl.hidden = winEl.hidden = deadEl.hidden = true;
  const dh = el('h1', '', deadBox); dh.textContent = 'You died'; dh.style.fontSize = '34px';
  const deadMsg = el('p', 'sub', deadBox), respawnBtn = el('button', 'go', deadBox); respawnBtn.textContent = 'Respawn';
  respawnBtn.onclick = () => send({ t: 'respawn' });

  let refs = {}, nameTimer = 0;
  const setIcon = (e, kind, state) => { e.style.backgroundImage = `url(${hudIcons[`${kind}-${state}`]})`; };
  function paintStats() {
    const row = (list, kind, value) => list.forEach((e, i) => { const v = value - i * 2; setIcon(e, kind, v >= 2 ? 'full' : v >= 1 ? 'half' : 'empty'); });
    const creative = S.mode === 'creative';
    hpRow.hidden = foodRow.hidden = creative; armorRow.hidden = creative || S.def <= 0; airRow.hidden = creative || S.air >= 15;
    row(armorIc, 'armor', S.def); row(hpIc, 'heart', Math.ceil(S.hp)); row(foodIc, 'food', S.food);
    const bubbles = Math.ceil(S.air / 1.5); airIc.forEach((e, i) => { setIcon(e, 'bubble', i < bubbles ? 'full' : 'empty'); });
  }
  function paintSlot(e, st) {
    const ic = e.children[0], cnt = e.children[1], du = e.children[2];
    e._st = st || 0;
    if (!st) { ic.style.backgroundImage = ''; cnt.textContent = ''; du.hidden = true; return; }
    ic.style.backgroundImage = `url(${iconURL(st[0])})`; cnt.textContent = st[1] > 1 ? String(st[1]) : '';
    const it = itemInfo(st[0]);
    if (it && it.dur && st[2] > 0) { const f = 1 - st[2] / it.dur; du.hidden = false; du.children[0].style.width = `${Math.max(4, f * 100)}%`; du.children[0].style.background = `hsl(${f * 120},85%,48%)`; }
    else du.hidden = true;
  }
  function makeSlot(parent, g, i) {
    const e = el('div', 's', parent); el('div', 'ic', e); el('div', 'cnt', e); const d = el('div', 'du', e); el('i', '', d); d.hidden = true;
    e.dataset.g = g; e.dataset.i = String(i);
    return e;
  }
  const hb = [];
  for (let i = 0; i < 9; i++) { const e = makeSlot(bar, 'hb', i); hb.push(e); const n = el('b', 'key', e); n.textContent = String(i + 1); }
  function paintHotbar() { hb.forEach((e, i) => { paintSlot(e, S.inv[i]); e.className = `s${i === S.sel ? ' on' : ''}`; }); }

  /* ----- inventory windows ----- */
  function build() {
    panel.textContent = ''; refs = {};
    const slot = (parent, g, i) => { const e = makeSlot(parent, g, i); refs[`${g}:${i}`] = e; return e; };
    const label = (t) => { const d = el('div', 'wl', panel); d.textContent = t; return d; };
    const grid = (parent, cols, g, from, n) => { const gr = el('div', 'grid', parent); gr.style.gridTemplateColumns = `repeat(${cols}, 44px)`; for (let i = 0; i < n; i++) slot(gr, g, from + i); return gr; };
    const out = (parent, g, i) => { const w = el('div', 'outwrap', parent); slot(w, g, i); };
    const arrow = (parent) => { const a = el('div', 'arrow', parent); el('i', '', a); return a; };
    if (S.wk === 'chest') { label('Chest'); grid(panel, 9, 'ext', 0, 27); }
    else if (S.wk === 'furnace') {
      label('Furnace');
      const row = el('div', 'frow', panel), col = el('div', 'fcol', row);
      slot(col, 'ext', 0); const flame = el('div', 'flame', col); el('i', '', flame); slot(col, 'ext', 1);
      const ar = arrow(row); refs.arrow = ar; refs.flame = flame; out(row, 'ext', 2);
    } else if (S.wk === 'table') {
      label('Crafting'); const row = el('div', 'crow', panel); grid(row, 3, 'ext', 0, 9); arrow(row).classList.add('full'); out(row, 'ext', 9);
    } else {
      const top = el('div', 'crow', panel), armor = el('div', 'grid', top); armor.style.gridTemplateColumns = '44px';
      for (let i = 0; i < 4; i++) slot(armor, 'arm', i);
      if (S.mode === 'creative') {
        const pal = el('div', 'palette', top);
        for (const id of CREATIVE_ITEMS) { const e = el('div', 's pal', pal); const ic = el('div', 'ic', e); ic.style.backgroundImage = `url(${iconURL(id)})`; e.dataset.pal = String(id); e._st = [id, 1, 0]; }
      } else { const c = el('div', 'cwrap', top); label2(c, 'Crafting'); const row = el('div', 'crow', c); grid(row, 2, 'ext', 0, 4); arrow(row).classList.add('full'); out(row, 'ext', 4); }
    }
    label('Inventory'); grid(panel, 9, 'inv', 9, 27);
    const gap = el('div', 'gap', panel); void gap; grid(panel, 9, 'inv', 0, 9);
    refresh();
  }
  function label2(parent, t) { const d = el('div', 'wl', parent); d.textContent = t; }
  function refresh() {
    paintStats(); paintHotbar();
    for (const [k, e] of Object.entries(refs)) {
      if (k === 'arrow' || k === 'flame') continue;
      const [g, i] = k.split(':'), st = g === 'inv' ? S.inv[+i] : g === 'arm' ? S.arm[+i] : S.ext[+i];
      paintSlot(e, st);
    }
    if (refs.arrow) { const pr = S.pr || [0, 1, 0]; refs.arrow.children[0].style.width = `${Math.min(100, (pr[2] / 10) * 100)}%`; refs.flame.children[0].style.height = `${pr[1] ? Math.min(100, (pr[0] / pr[1]) * 100) : 0}%`; }
    curEl.hidden = !(S.cur && S.open);
    if (S.cur) { curEl.style.backgroundImage = `url(${iconURL(S.cur[0])})`; curEl.textContent = S.cur[1] > 1 ? String(S.cur[1]) : ''; }
  }

  let rightDragLast = '';
  winEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const s = e.target.closest ? e.target.closest('.s') : null;
    if (s && s.dataset.pal) { send({ t: 'cre', id: +s.dataset.pal }); return; }
    if (s && s.dataset.g) {
      const key = `${s.dataset.g}:${s.dataset.i}`;
      rightDragLast = e.button === 2 ? key : '';
      send({ t: 'click', g: s.dataset.g, i: +s.dataset.i, b: e.button === 2 ? 1 : 0, s: e.shiftKey ? 1 : 0 });
      return;
    }
    if (e.target === winEl) send({ t: 'dropc', all: e.button !== 2 });
  });
  winEl.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mouseup', () => { rightDragLast = ''; });
  const names = (st) => { const it = itemInfo(st[0]); if (!it) return ''; return it.dur ? `${it.n}\nDurability ${it.dur - st[2]} / ${it.dur}` : it.n; };
  document.addEventListener('mousemove', (e) => {
    curEl.style.left = `${e.clientX - 18}px`; curEl.style.top = `${e.clientY - 18}px`;
    const s = e.target.closest ? e.target.closest('.s') : null;
    if (S.open && (e.buttons & 2) && s && s.dataset.g) {
      const key = `${s.dataset.g}:${s.dataset.i}`;
      if (key !== rightDragLast) {
        rightDragLast = key;
        send({ t: 'click', g: s.dataset.g, i: +s.dataset.i, b: 1, s: 0 });
      }
    }
    if (S.open && s && s._st) { tip.hidden = false; tip.textContent = names(s._st); tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY - 10}px`; } else tip.hidden = true;
  });

  const api = {
    setInv(m) {
      S.inv = m.inv; S.arm = m.arm; S.cur = m.cur; S.sel = m.sel; S.ext = m.ext; S.pr = m.pr;
      if (m.wk !== S.wk) { S.wk = m.wk; if (S.open) build(); }
      refresh();
    },
    setProgress(pr) { S.pr = pr; refresh(); },
    setStats(m) { S.hp = m.hp; S.food = m.food; S.air = m.air; S.def = m.def; paintStats(); },
    setMode(mode) { S.mode = mode; paintStats(); },
    selectSlot(i) { S.sel = i; paintHotbar(); const st = S.inv[i], it = st && itemInfo(st[0]); selName.textContent = it ? it.n : ''; selName.style.opacity = '1'; clearTimeout(nameTimer); nameTimer = setTimeout(() => { selName.style.opacity = '0'; }, 1800); },
    get sel() { return S.sel; },
    get isOpen() { return S.open; },
    open(kind) { S.wk = kind || S.wk; S.open = true; winEl.hidden = false; build(); },
    close(notify) { if (!S.open) return; S.open = false; winEl.hidden = true; tip.hidden = true; curEl.hidden = true; if (notify) send({ t: 'close' }); },
    held() { const st = S.inv[S.sel]; return st ? { id: st[0], n: st[1], d: st[2] } : null; },
    count(id) { return S.inv.reduce((n, s) => n + (s && s[0] === id ? s[1] : 0), 0); },
    flash() { flashEl.className = 'flash'; void flashEl.offsetWidth; flashEl.className = 'flash on'; },
    showDead(msg) { deadMsg.textContent = `You ${msg}.`; deadEl.hidden = false; },
    hideDead() { deadEl.hidden = true; },
    get stats() { return S; },
  };
  paintStats(); paintHotbar();
  return api;
}
