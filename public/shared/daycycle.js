// The day/night clock, shared by the browser and the server. The world has a 24,000-tick day like Minecraft, but the phases run at their own
// real-time lengths, so the cycle is exactly what the schedule below says:
//   ticks     0-12,000  daytime         10 minutes
//   ticks 12,000-13,000 sunset / dusk    1.5 minutes
//   ticks 13,000-23,000 nighttime         7 minutes
//   ticks 23,000-24,000 sunrise / dawn    1.5 minutes (not in the schedule: it mirrors the dusk so the morning comes up slowly too)
// The sun is at the horizon at tick 0 and 12,000, at its highest at 6,000 and the moon at its highest at 18,000.
export const DAY_TICKS = 24000;
const MIN = 60000;
export const PHASES = [
  { name: 'day', from: 0, to: 12000, ms: 10 * MIN },
  { name: 'dusk', from: 12000, to: 13000, ms: 1.5 * MIN },
  { name: 'night', from: 13000, to: 23000, ms: 7 * MIN },
  { name: 'dawn', from: 23000, to: 24000, ms: 1.5 * MIN },
];
export const CYCLE_MS = PHASES.reduce((n, p) => n + p.ms, 0);
const mod = (a, n) => ((a % n) + n) % n;

// Real milliseconds into the cycle -> tick of the day (0..24000).
export function msToTick(ms) {
  let t = mod(ms, CYCLE_MS);
  for (const p of PHASES) { if (t < p.ms) return p.from + (t / p.ms) * (p.to - p.from); t -= p.ms; }
  return 0;
}
// Tick of the day -> real milliseconds into the cycle (the inverse of msToTick).
export function tickToMs(tick) {
  const k = mod(tick, DAY_TICKS); let ms = 0;
  for (const p of PHASES) { if (k < p.to) return ms + ((k - p.from) / (p.to - p.from)) * p.ms; ms += p.ms; }
  return 0;
}
export const tickAngle = (tick) => (tick / DAY_TICKS) * 6.2832; // the sun's angle: sin > 0 is above the horizon
export const isNightTick = (tick) => tick >= 13000 && tick < 23000;
export const angleTick = (ang) => mod(ang / 6.2832, 1) * DAY_TICKS;
// The clock a room runs on: `elapsed` is Date.now() - the moment the cycle was at tick 0.
export const tickAt = (elapsed) => msToTick(elapsed);
