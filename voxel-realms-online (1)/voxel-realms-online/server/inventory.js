// Authoritative inventory logic. The client only ever sends clicks; the server decides what moves.
import { maxStack, itemInfo, matchRecipe, SMELT, FUEL, SMELT_TIME } from '../public/shared/items.js';

export const mk = (id, n = 1, d = 0) => ({ id, n, d });
export const clone = (s) => (s ? { id: s.id, n: s.n, d: s.d } : null);
export const pack = (s) => (s ? [s.id, s.n, s.d] : 0);
export const unpack = (a) => (a && itemInfo(a[0]) ? mk(a[0], Math.max(1, Math.min(maxStack(a[0]), a[1] | 0)), a[2] | 0) : null);
const stackable = (a, b) => a && b && a.id === b.id && a.d === b.d && maxStack(a.id) > 1;

// Pick-ups fill existing stacks first, then empty slots, hotbar before backpack. Returns the count that did not fit.
export function addToInv(inv, st) {
  let left = st.n;
  const max = maxStack(st.id);
  if (max > 1) for (let i = 0; i < 36 && left; i++) { const s = inv[i]; if (s && s.id === st.id && s.d === st.d && s.n < max) { const t = Math.min(max - s.n, left); s.n += t; left -= t; } }
  for (let i = 0; i < 36 && left; i++) if (!inv[i]) { const t = Math.min(max, left); inv[i] = mk(st.id, t, st.d); left -= t; }
  return left;
}
export function roomFor(inv, st) {
  const max = maxStack(st.id);
  let room = 0;
  for (let i = 0; i < 36; i++) { const s = inv[i]; if (!s) room += max; else if (stackable(s, st)) room += max - s.n; }
  return room >= st.n;
}
function mergeRange(arr, from, to, s) { // move as much of s as fits into arr[from..to)
  const max = maxStack(s.id);
  if (max > 1) for (let i = from; i < to && s.n; i++) { const t = arr[i]; if (t && t.id === s.id && t.d === s.d && t.n < max) { const m = Math.min(max - t.n, s.n); t.n += m; s.n -= m; } }
  for (let i = from; i < to && s.n; i++) if (!arr[i]) { const m = Math.min(max, s.n); arr[i] = mk(s.id, m, s.d); s.n -= m; }
}

/* ---------- windows ---------- */
export function newWin(kind, cont, key) {
  if (kind === 'inv') return { kind, ext: Array(5).fill(null), w: 2 };
  if (kind === 'table') return { kind, ext: Array(10).fill(null), w: 3 };
  return { kind, cont, key, ext: cont.s };
}
const outIndex = (w) => (w.kind === 'inv' ? 4 : w.kind === 'table' ? 9 : w.kind === 'furnace' ? 2 : -1);
export function recompute(w) {
  if (w.kind !== 'inv' && w.kind !== 'table') return;
  const n = w.w, r = matchRecipe(w.ext.slice(0, n * n).map((s) => (s ? s.id : 0)), n, n);
  w.ext[n * n] = r ? mk(r.out, r.n, 0) : null;
}
function consumeGrid(w) {
  for (let i = 0; i < w.w * w.w; i++) { const s = w.ext[i]; if (s && --s.n <= 0) w.ext[i] = null; }
  recompute(w);
}

function slotRef(p, g, i) {
  if (!Number.isInteger(i) || i < 0) return null;
  if (g === 'inv' && i < 36) return { get: () => p.inv[i], set: (v) => { p.inv[i] = v; }, ok: () => true };
  if (g === 'arm' && i < 4) return { get: () => p.armor[i], set: (v) => { p.armor[i] = v; }, ok: (s) => { const it = itemInfo(s.id); return !!it && it.armor === i; } };
  if (g === 'ext' && i < p.win.ext.length) {
    const w = p.win, out = i === outIndex(w);
    return {
      get: () => w.ext[i], set: (v) => { w.ext[i] = v; }, out,
      ok: (s) => !out && !(w.kind === 'furnace' && i === 1 && !FUEL.has(s.id)),
    };
  }
  return null;
}

function takeOutput(p, shift) {
  const w = p.win, oi = outIndex(w), out = w.ext[oi];
  if (!out) return false;
  if (w.kind === 'furnace') {
    if (shift) { const left = addToInv(p.inv, out); if (left) out.n = left; else w.ext[oi] = null; return true; }
    if (!p.cursor) { p.cursor = out; w.ext[oi] = null; return true; }
    if (stackable(p.cursor, out)) { const t = Math.min(maxStack(out.id) - p.cursor.n, out.n); p.cursor.n += t; out.n -= t; if (!out.n) w.ext[oi] = null; return t > 0; }
    return false;
  }
  if (shift) {
    for (let guard = 0; guard < 64 && w.ext[oi]; guard++) {
      if (!roomFor(p.inv, w.ext[oi])) break;
      addToInv(p.inv, clone(w.ext[oi])); consumeGrid(w);
    }
    return true;
  }
  if (!p.cursor) p.cursor = clone(out);
  else if (stackable(p.cursor, out) && p.cursor.n + out.n <= maxStack(out.id)) p.cursor.n += out.n;
  else return false;
  consumeGrid(w);
  return true;
}

function quickMove(p, g, i, ref) {
  const s = ref.get(); if (!s) return false;
  const w = p.win;
  if (g === 'arm' || g === 'ext') {
    const left = addToInv(p.inv, clone(s)); // note: addToInv on a copy, then reconcile
    // addToInv already placed (s.n - left) items; shrink the source accordingly
    const moved = s.n - left; s.n -= moved; if (s.n <= 0) ref.set(null);
    return moved > 0;
  }
  const info = itemInfo(s.id);
  if (info && info.armor !== undefined && !p.armor[info.armor]) { p.armor[info.armor] = s; ref.set(null); return true; }
  const before = s.n;
  if (w.kind === 'chest') mergeRange(w.ext, 0, w.ext.length, s);
  else if (w.kind === 'furnace') { if (SMELT.has(s.id)) mergeRange(w.ext, 0, 1, s); else if (FUEL.has(s.id)) mergeRange(w.ext, 1, 2, s); else if (i < 9) mergeRange(p.inv, 9, 36, s); else mergeRange(p.inv, 0, 9, s); }
  else if (i < 9) mergeRange(p.inv, 9, 36, s);
  else mergeRange(p.inv, 0, 9, s);
  if (s.n <= 0) ref.set(null);
  return s.n !== before;
}

// One mouse click on one slot, with Minecraft's rules for left, right and shift clicks.
export function click(p, g, i, btn, shift) {
  const ref = slotRef(p, g, i); if (!ref) return false;
  let changed;
  if (ref.out) changed = takeOutput(p, shift);
  else if (shift) changed = quickMove(p, g, i, ref);
  else {
    const cur = p.cursor, s = ref.get();
    changed = true;
    if (btn === 0) {
      if (!cur) { if (s) { p.cursor = s; ref.set(null); } else changed = false; }
      else if (!s) { if (ref.ok(cur)) { ref.set(cur); p.cursor = null; } else changed = false; }
      else if (stackable(cur, s)) { const t = Math.min(maxStack(s.id) - s.n, cur.n); s.n += t; cur.n -= t; if (!cur.n) p.cursor = null; changed = t > 0; }
      else if (ref.ok(cur)) { ref.set(cur); p.cursor = s; } else changed = false;
    } else if (!cur) {
      if (s) { const t = Math.ceil(s.n / 2); p.cursor = mk(s.id, t, s.d); s.n -= t; if (!s.n) ref.set(null); } else changed = false;
    } else if (!s) { if (ref.ok(cur)) { ref.set(mk(cur.id, 1, cur.d)); if (--cur.n <= 0) p.cursor = null; } else changed = false; }
    else if (stackable(cur, s)) { if (s.n < maxStack(s.id)) { s.n++; if (--cur.n <= 0) p.cursor = null; } else changed = false; }
    else if (ref.ok(cur)) { ref.set(cur); p.cursor = s; } else changed = false;
  }
  if (changed && g === 'ext') recompute(p.win);
  return changed;
}

// Closing a window hands crafting-grid items and the held stack back (anything that does not fit is returned for dropping).
export function closeWin(p) {
  const overflow = [], w = p.win;
  const back = (s) => { if (s) { const left = addToInv(p.inv, s); if (left) overflow.push(mk(s.id, left, s.d)); } };
  if (w.kind === 'inv' || w.kind === 'table') { for (let i = 0; i < w.w * w.w; i++) { back(w.ext[i]); w.ext[i] = null; } w.ext[w.w * w.w] = null; }
  back(p.cursor); p.cursor = null;
  if (w.kind !== 'inv') p.win = newWin('inv');
  return overflow;
}

/* ---------- furnace ---------- */
export function newContainer(type) {
  return type === 'chest' ? { t: 'chest', s: Array(27).fill(null) } : { t: 'furnace', s: Array(3).fill(null), burn: 0, burnMax: 0, cook: 0 };
}
export function tickFurnace(c, dt) {
  const s = c.s, inp = s[0], fuel = s[1], out = s[2], res = inp && SMELT.get(inp.id);
  let changed = false;
  const can = res && (!out || (out.id === res && out.n < maxStack(res)));
  if (c.burn > 0) { c.burn -= dt; if (c.burn <= 0) { c.burn = 0; changed = true; } }
  if (can && c.burn <= 0 && fuel && FUEL.has(fuel.id)) { c.burn = c.burnMax = FUEL.get(fuel.id); if (--fuel.n <= 0) s[1] = null; changed = true; }
  if (can && c.burn > 0) {
    c.cook += dt;
    if (c.cook >= SMELT_TIME) { c.cook = 0; if (--inp.n <= 0) s[0] = null; if (out) out.n++; else s[2] = mk(res, 1, 0); changed = true; }
  } else if (c.cook > 0) c.cook = Math.max(0, c.cook - 2 * dt);
  return changed;
}
export const packCont = (c) => ({ t: c.t, s: c.s.map(pack), burn: c.burn || 0, burnMax: c.burnMax || 0, cook: c.cook || 0 });
export function loadCont(o) {
  const c = newContainer(o.t === 'chest' ? 'chest' : 'furnace');
  c.s = c.s.map((_, i) => unpack(o.s && o.s[i]));
  c.burn = +o.burn || 0; c.burnMax = +o.burnMax || 0; c.cook = +o.cook || 0;
  return c;
}
