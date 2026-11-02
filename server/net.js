// Tiny messaging helpers shared by the server modules.
export const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
export function broadcast(room, o, except) {
  const s = JSON.stringify(o);
  for (const p of room.players.values()) if (p.ws !== except && p.ws.readyState === 1 && p.ws.bufferedAmount < 1e6) p.ws.send(s);
}
export const sys = (room, m) => broadcast(room, { t: 'chat', m, sys: 1 });
