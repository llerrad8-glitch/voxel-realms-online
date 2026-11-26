// The Achievements screen (press L, or use the pause menu) and the pop-up that appears when you make one.
// The server decides what has been earned; this only shows what it sends: { t: 'achall', d, s } on joining and { t: 'ach', id } for each new one.
import { ACH, CATS } from './shared/achievements.js';
import { iconURL } from './icons.js';

const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.append(e); if (text !== undefined) e.textContent = text; return e; };
const CSS = `
#ach{position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(8,14,20,.55);overflow:hidden}
#ach .ap{width:min(980px,100%);height:min(640px,calc(100vh - 24px));min-height:0;display:flex;flex-direction:column;background:linear-gradient(rgba(12,20,28,.93),rgba(12,20,28,.93)),var(--dirt,none),#101a24;border:3px solid #04080c;box-shadow:inset 0 0 0 2px rgba(255,255,255,.07),0 10px 0 rgba(0,0,0,.3);padding:14px 16px;image-rendering:pixelated}
#ach .ah{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
#ach .at{font:900 26px/1 "Trebuchet MS",sans-serif;color:var(--chalk);text-shadow:2px 2px 0 #1b2a1a}
#ach .ac{font-weight:800;color:var(--sun)}
#ach .abar{flex:1;min-width:120px;height:14px;background:#0a121a;border:2px solid #04080c}#ach .abar i{display:block;height:100%;width:0;background:linear-gradient(#8bdc5a,#4e9a30)}
#ach .ax{margin-left:auto;padding:6px 14px}
#ach .atabs{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 8px}
#ach .atab{padding:5px 10px;font-size:13px;background:#243646;border-color:#0b141c}#ach .atab.on{background:#3f7a2a}
#ach .atab small{opacity:.75;font-weight:600;margin-left:4px}
#ach .af{display:flex;gap:6px;align-items:center;margin-bottom:8px;font-size:13px;color:#b9c4ce}
#ach .af button{padding:3px 9px;font-size:12px;background:#243646}#ach .af button.on{background:#3f7a2a}
#ach .al{flex:1;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:6px;align-content:start;padding-right:4px}
#ach .ai{display:flex;gap:10px;align-items:center;padding:8px 10px;background:#16222d;border:2px solid #0b141c;min-height:64px}
#ach .ai.done{background:#1b3322;border-color:#2f6a3a}
#ach .ai .ic{flex:none;width:40px;height:40px;background:#0a121a;border:2px solid #04080c;background-size:75%;background-repeat:no-repeat;background-position:center;image-rendering:pixelated;filter:grayscale(1) brightness(.55)}
#ach .ai.done .ic{filter:none;border-color:#d8b640}
#ach .ai b{display:block;font-size:14px;color:#aebccb}#ach .ai.done b{color:#ffe27a}
#ach .ai span{display:block;font-size:12px;color:#8fa3b5;line-height:1.25}#ach .ai.done span{color:#c9d8c2}
#ach .ap2{margin-top:4px;height:6px;background:#0a121a;border:1px solid #04080c}#ach .ap2 i{display:block;height:100%;background:#4e9a30}
#ach .an{font-size:11px;color:#8fa3b5;margin-top:2px}
#achT{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:40;display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none}
#achT .tt{display:flex;gap:10px;align-items:center;min-width:270px;max-width:92vw;padding:8px 14px 8px 10px;background:rgba(18,28,38,.96);border:3px solid #d8b640;box-shadow:0 6px 0 rgba(0,0,0,.35);animation:achin .35s ease-out,achout .5s ease-in 3.6s forwards}
#achT .tt .ic{width:38px;height:38px;background-size:80%;background-repeat:no-repeat;background-position:center;background-color:#0a121a;border:2px solid #04080c;image-rendering:pixelated}
#achT .tt small{display:block;color:#ffd45c;font-weight:800;font-size:11px;letter-spacing:.5px;text-transform:uppercase}#achT .tt b{display:block;color:#fff;font-size:15px}
@keyframes achin{from{transform:translateY(-70px);opacity:0}to{transform:none;opacity:1}}@keyframes achout{to{opacity:0;transform:translateY(-20px)}}
@media (max-width:560px){#ach .al{grid-template-columns:1fr}#ach .at{font-size:20px}}
`;

export function createAchievements({ onClose, request } = {}) {
  el('style', '', document.head, CSS);
  const toastBox = el('div', '', document.body); toastBox.id = 'achT';
  const root = el('div', '', document.body); root.id = 'ach'; root.hidden = true;
  const panel = el('div', 'ap', root), head = el('div', 'ah', panel);
  el('div', 'at', head, 'Achievements'); const count = el('div', 'ac', head), bar = el('div', 'abar', head), fill = el('i', '', bar);
  const closeBtn = el('button', 'ax', head, 'Close (L)');
  const tabs = el('div', 'atabs', panel), filt = el('div', 'af', panel), list = el('div', 'al', panel);
  el('span', '', filt, 'Show:');
  let done = {}, stats = {}, cat = 'All', show = 'all', open = false;
  const fbtn = {};
  for (const [k, nm] of [['all', 'All'], ['todo', 'Locked'], ['done', 'Unlocked']]) { const b = el('button', '', filt, nm); fbtn[k] = b; b.onclick = () => { show = k; render(); }; }
  const total = ACH.length, nDone = () => ACH.reduce((n, a) => n + (done[a.id] ? 1 : 0), 0);

  function render() {
    const n = nDone();
    count.textContent = `${n} / ${total}  (${Math.floor((n / total) * 100)}%)`; fill.style.width = `${(n / total) * 100}%`;
    tabs.textContent = '';
    for (const c of ['All', ...CATS]) {
      const items = c === 'All' ? ACH : ACH.filter((a) => a.cat === c), d = items.filter((a) => done[a.id]).length;
      const b = el('button', 'atab' + (c === cat ? ' on' : ''), tabs, c); el('small', '', b, `${d}/${items.length}`); b.onclick = () => { cat = c; render(); list.scrollTop = 0; };
    }
    for (const k in fbtn) fbtn[k].className = k === show ? 'on' : '';
    const keep = list.scrollTop; list.textContent = '';
    for (const a of ACH) {
      if (cat !== 'All' && a.cat !== cat) continue;
      const got = !!done[a.id];
      if ((show === 'done' && !got) || (show === 'todo' && got)) continue;
      const card = el('div', 'ai' + (got ? ' done' : ''), list), ic = el('div', 'ic', card); ic.style.backgroundImage = `url(${iconURL(a.ic)})`;
      const t = el('div', '', card); el('b', '', t, a.name); el('span', '', t, a.desc);
      if (a.stat && !got) { const v = Math.min(stats[a.stat[0]] || 0, a.stat[1]), pb = el('div', 'ap2', t); el('i', '', pb).style.width = `${(v / a.stat[1]) * 100}%`; el('div', 'an', t, `${Math.floor(v).toLocaleString('en-US')} / ${a.stat[1].toLocaleString('en-US')}`); }
      else if (got) el('div', 'an', t, `Earned ${new Date(done[a.id]).toLocaleDateString()}`);
    }
    list.scrollTop = keep;
  }

  const queue = []; let showing = false;
  function pump() {
    if (showing || !queue.length) return;
    showing = true;
    const a = queue.shift(), t = el('div', 'tt', toastBox), ic = el('div', 'ic', t); ic.style.backgroundImage = `url(${iconURL(a.ic)})`;
    const tx = el('div', '', t); el('small', '', tx, 'Achievement made!'); el('b', '', tx, a.name);
    setTimeout(() => { t.remove(); showing = false; pump(); }, 4000);
  }
  closeBtn.onclick = () => api.close();
  root.addEventListener('pointerdown', (e) => { if (e.target === root) api.close(); });

  const api = {
    get isOpen() { return open; },
    setAll(m) { done = m.d || {}; stats = m.s || {}; if (open) render(); },
    unlock(id) { const a = ACH.find((x) => x.id === id); if (!a) return; done[id] = Date.now(); queue.push(a); pump(); if (open) render(); },
    open() { open = true; root.hidden = false; render(); if (request) request(); },
    close() { if (!open) return; open = false; root.hidden = true; if (onClose) onClose(); },
    reset() { done = {}; stats = {}; if (open) render(); },
  };
  return api;
}
