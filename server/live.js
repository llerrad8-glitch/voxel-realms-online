// The Active Worlds list: worlds whose hosts switched "live" on. Kept as one small stored record so it survives restarts,
// including worlds that nobody is in right now.
import { store } from './store.js';

const live = new Map();
let timer = null;
export async function loadLive() {
  try { const j = await store.getJSON('live'); for (const [id, e] of Object.entries(j || {})) if (e && typeof e.name === 'string') live.set(id, e); }
  catch (e) { console.log('could not load the Active Worlds list', e.message); }
}
function persist() {
  if (timer) return;
  timer = setTimeout(async () => { timer = null; try { await store.setJSON('live', Object.fromEntries(live)); } catch (e) { console.log('could not save the Active Worlds list', e.message); persist(); } }, 1000);
}
export function setLive(room, on) {
  if (on) live.set(room.id, { name: room.name, host: room.hostName || 'Host', mode: room.mode, pvp: room.pvp, created: room.created, t: Date.now() });
  else live.delete(room.id);
  persist();
}
export function touchLive(room) { if (live.has(room.id)) setLive(room, true); }
export const isLive = (id) => live.has(id);
export function listLive(rooms, max, isHost) {
  const out = [];
  for (const [id, e] of live) {
    const r = rooms.get(id);
    out.push({ id, name: r ? r.name : e.name, host: r ? r.hostName || e.host : e.host, mode: r ? r.mode : e.mode, pvp: r ? r.pvp : e.pvp, players: r ? r.players.size : 0, max, hostOnline: !!(r && [...r.players.values()].some((p) => isHost(r, p))), t: e.t });
  }
  out.sort((a, b) => b.players - a.players || b.t - a.t);
  return out.slice(0, 60);
}
