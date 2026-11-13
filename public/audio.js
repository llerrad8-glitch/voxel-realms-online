// Sound for Voxel Realms: the music (sunset song and random songs), creature sounds, and the two toggle buttons in the pause menu.
// Creature sounds use real recordings when there are any in public/sounds (see README, "Real animal sounds"):
// files named like cow_idle.mp3, cow_hurt_2.ogg, wolf_attack.wav. Anything without a recording falls back to a
// sound synthesised with the Web Audio API, so the game is never silent and works with no sound files at all.
import { MOB_TYPES } from './shared/mobs.js';

const KEY = 'vr.audio', MUSIC_VOL = 0.6, SFX_VOL = 1;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const loadCfg = () => { try { return { music: true, creatures: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { music: true, creatures: true }; } };

// Flag bits the server sends for every creature (see server/ents.js).
const F_HURT = 1, F_BURN = 2, F_FUSE = 4, F_SHOOT = 8, F_SWING = 16, F_GROUND = 32, F_DRY = 128;
// Seconds between idle sounds [min, max]; salmon use their own rule (flopping on land).
const IDLE = { pig: [6, 16], cow: [8, 20], sheep: [8, 20], chicken: [5, 14], rabbit: [10, 24], wolf: [8, 20], zombie: [4, 10], skeleton: [4, 10], spider: [5, 12], salmon: [8, 16] };

export function createAudio() {
  const cfg = loadCfg();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* storage blocked */ } };
  const L = { x: 0, y: 0, z: 0, yaw: 0 }; // the listener: where the player is and which way they face
  let ctx = null, master = null, noiseBuf = null;

  /* ---------- Web Audio setup (browsers only allow it after a click or key press) ---------- */
  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      try { ctx = new AC(); } catch { return false; }
      master = ctx.createGain(); master.gain.value = 1.5;
      const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.6), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (!realStarted) loadReal();
    return true;
  }
  /* ---------- real recordings (public/sounds) ---------- */
  // sounds/manifest.json is written by `npm run sounds` and lists every file: { "cow_idle": ["cow_idle.mp3", "cow_idle_2.mp3"], ... }.
  // Files are decoded once, levelled to the same loudness, and picked at random so repeats do not sound the same.
  const real = {}; let realStarted = false;
  async function loadReal() {
    realStarted = true;
    try {
      const r = await fetch(new URL('./sounds/manifest.json', import.meta.url), { cache: 'no-cache' }); if (!r.ok) return;
      const man = await r.json();
      for (const [key, files] of Object.entries(man)) for (const f of Array.isArray(files) ? files : []) {
        fetch(new URL('./sounds/' + f, import.meta.url)).then((x) => (x.ok ? x.arrayBuffer() : Promise.reject())).then((ab) => ctx.decodeAudioData(ab)).then((buf) => {
          let peak = 0; const ch = buf.getChannelData(0); for (let i = 0; i < ch.length; i += 4) peak = Math.max(peak, Math.abs(ch[i]));
          (real[key] ||= []).push({ buf, norm: peak > 0.001 ? Math.min(4, 0.8 / peak) : 1 });
        }).catch(() => { /* a missing or broken file just means the built-in sound is used */ });
      }
    } catch { /* no recordings installed */ }
  }
  // Plays one recording through d (the distance/pan bus). Returns false if there is none ready yet.
  function clip(key, d, t, rate = 1, maxLen = 4) {
    const list = real[key]; if (!list || !list.length) return false;
    const c = list[(Math.random() * list.length) | 0], len = Math.min(maxLen, c.buf.duration / rate);
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = c.buf; src.playbackRate.value = rate;
    g.gain.setValueAtTime(c.norm * 0.9, t); if (len < c.buf.duration / rate) { g.gain.setValueAtTime(c.norm * 0.9, t + len - 0.2); g.gain.linearRampToValueAtTime(0.0001, t + len); } // long recordings are faded out
    src.connect(g); g.connect(d); src.start(t); src.stop(t + len + 0.05);
    return true;
  }
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, ensureCtx, { passive: true });

  /* ---------- building blocks ---------- */
  // A sound that comes from a place: quieter with distance, panned left or right by where it is.
  function bus(x, y, z, maxD, gain = 1) {
    if (!ensureCtx() || ctx.state !== 'running') return null;
    const dx = x - L.x, dy = y - L.y, dz = z - L.z, d = Math.hypot(dx, dy, dz);
    if (d > maxD) return null;
    const g = ctx.createGain(); g.gain.value = Math.pow(1 - d / maxD, 1.6) * gain * SFX_VOL;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(), pan = d > 0.5 ? (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d : 0;
      p.pan.value = clamp(pan * 0.85, -1, 1); g.connect(p); p.connect(master);
    } else g.connect(master);
    return g;
  }
  // o: type, f0, f1 (pitch glide), dur, a (attack), gain, bp [from, to] formant sweep, lp, q, vib [Hz, depth], trem [Hz, depth 0..1]
  function tone(dest, t, o) {
    const dur = o.dur, osc = ctx.createOscillator(); osc.type = o.type || 'sawtooth';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 && o.f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    if (o.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = o.vib[0]; lg.gain.value = o.vib[1]; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + dur + 0.05); }
    let node = osc;
    if (o.bp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = o.q || 2; f.frequency.setValueAtTime(o.bp[0], t); f.frequency.linearRampToValueAtTime(o.bp[1], t + dur); node.connect(f); node = f; }
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node.connect(f); node = f; }
    const g = ctx.createGain(), pk = o.gain ?? 0.3;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk, t + (o.a ?? 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g);
    if (o.trem) {
      const am = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain();
      am.gain.value = 1 - o.trem[1] / 2; l.frequency.value = o.trem[0]; lg.gain.value = o.trem[1] / 2;
      l.connect(lg); lg.connect(am.gain); l.start(t); l.stop(t + dur + 0.05); g.connect(am); am.connect(dest);
    } else g.connect(dest);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  // o: type (filter), f0, f1, q, dur, a, gain, hold (keep the level steady until the end, for hissing)
  function noise(dest, t, o) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q || 1; f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const g = ctx.createGain(), pk = o.gain ?? 0.2, a = o.a ?? 0.005;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk, t + a);
    if (o.hold) g.gain.setValueAtTime(pk, t + o.dur - 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(dest); src.start(t, Math.random() * 0.6); src.stop(t + o.dur + 0.05);
    return { src, g };
  }
  const clicks = (d, t, n, gap, f, gain, decay = 1) => { for (let i = 0; i < n; i++) { const at = t + i * gap * rnd(0.7, 1.3), k = Math.pow(decay, i); noise(d, at, { f0: f * rnd(0.9, 1.15), q: 6, dur: 0.035, gain: gain * k }); tone(d, at, { type: 'square', f0: 950 * rnd(0.9, 1.1), f1: 450, dur: 0.025, gain: gain * 0.5 * k }); } };

  /* ---------- the voices ---------- */
  // Each takes (d = where to send it, t = start time, p = random pitch factor, size = slime size).
  const V = {
    pig: {
      idle: (d, t, p) => { const oink = (at, k) => { tone(d, at, { f0: 230 * p * k, f1: 150 * p * k, dur: 0.15, gain: 0.55, bp: [750, 520], q: 2 }); noise(d, at, { f0: 900, f1: 600, dur: 0.12, gain: 0.1 }); }; oink(t, 1); if (Math.random() < 0.6) oink(t + 0.22, 0.9); },
      hurt: (d, t, p) => { tone(d, t, { f0: 750 * p, f1: 460 * p, dur: 0.4, gain: 0.5, bp: [1500, 1000], q: 2, vib: [26, 25] }); },
      death: (d, t, p) => { tone(d, t, { f0: 680 * p, f1: 170 * p, dur: 0.8, gain: 0.55, bp: [1500, 600], q: 2, vib: [22, 22] }); },
    },
    cow: {
      idle: (d, t, p) => { tone(d, t, { f0: 125 * p, f1: 98 * p, dur: 1.05, a: 0.15, gain: 0.8, bp: [450, 850], q: 3, vib: [5, 3] }); },
      hurt: (d, t, p) => { tone(d, t, { f0: 175 * p, f1: 120 * p, dur: 0.45, a: 0.04, gain: 0.8, bp: [750, 500], q: 3 }); },
      death: (d, t, p) => { tone(d, t, { f0: 135 * p, f1: 60 * p, dur: 1.15, a: 0.06, gain: 0.8, bp: [650, 320], q: 3 }); },
    },
    sheep: {
      idle: (d, t, p) => { tone(d, t, { f0: 310 * p, f1: 265 * p, dur: 0.75, a: 0.04, gain: 0.75, bp: [1100, 1500], q: 4, trem: [32, 0.6], vib: [6, 6] }); },
      hurt: (d, t, p) => { tone(d, t, { f0: 400 * p, f1: 300 * p, dur: 0.35, a: 0.02, gain: 0.75, bp: [1300, 1700], q: 4, trem: [34, 0.6] }); },
      death: (d, t, p) => { tone(d, t, { f0: 330 * p, f1: 150 * p, dur: 0.65, a: 0.03, gain: 0.75, bp: [1200, 700], q: 4, trem: [30, 0.6] }); },
    },
    chicken: {
      idle: (d, t, p) => { for (let i = 0; i < 3; i++) { const at = t + i * 0.1 * rnd(0.9, 1.15); tone(d, at, { type: 'square', f0: 820 * p * rnd(0.9, 1.1), f1: 520 * p, dur: 0.07, gain: 0.35, bp: [1600, 1100], q: 3 }); noise(d, at, { f0: 2200, q: 2, dur: 0.04, gain: 0.08 }); } },
      hurt: (d, t, p) => { tone(d, t, { f0: 1100 * p, f1: 650 * p, dur: 0.3, gain: 0.5, bp: [2000, 1400], q: 2, vib: [36, 60] }); },
      death: (d, t, p) => { tone(d, t, { f0: 950 * p, f1: 380 * p, dur: 0.5, gain: 0.5, bp: [2000, 900], q: 2, vib: [30, 50] }); },
    },
    rabbit: {
      idle: (d, t, p) => { noise(d, t, { f0: 3500, f1: 2400, q: 2, dur: 0.09, gain: 0.07 }); tone(d, t + 0.05, { type: 'sine', f0: 2200 * p, f1: 1700 * p, dur: 0.08, gain: 0.1 }); },
      hurt: (d, t, p) => { for (let i = 0; i < 2; i++) tone(d, t + i * 0.16, { type: 'sine', f0: 2500 * p, f1: 1400 * p, dur: 0.15, gain: 0.3, vib: [30, 80] }); },
      death: (d, t, p) => { tone(d, t, { type: 'sine', f0: 2100 * p, f1: 650 * p, dur: 0.4, gain: 0.3, vib: [24, 90] }); },
    },
    wolf: {
      idle: (d, t, p) => {
        noise(d, t, { f0: 1300, f1: 800, q: 1.5, dur: 0.16, gain: 0.14 }); noise(d, t + 0.3, { f0: 1300, f1: 800, q: 1.5, dur: 0.16, gain: 0.14 });
        if (Math.random() < 0.35) tone(d, t + 0.6, { type: 'sine', f0: 520 * p, f1: 820 * p, dur: 0.55, a: 0.15, gain: 0.22, vib: [6, 10] });
      },
      hurt: (d, t, p) => { tone(d, t, { f0: 1050 * p, f1: 560 * p, dur: 0.24, gain: 0.5, bp: [1900, 1200], q: 2, vib: [14, 30] }); },
      death: (d, t, p) => { tone(d, t, { type: 'sine', f0: 720 * p, f1: 240 * p, dur: 0.8, a: 0.05, gain: 0.35, vib: [8, 22] }); },
      attack: (d, t, p) => { tone(d, t, { f0: 98 * p, f1: 78 * p, dur: 0.5, a: 0.04, gain: 0.8, bp: [420, 300], q: 2, trem: [38, 0.8] }); noise(d, t, { f0: 900, f1: 500, dur: 0.3, gain: 0.12 }); },
    },
    zombie: {
      idle: (d, t, p) => { tone(d, t, { f0: 98 * p, f1: 74 * p, dur: 0.95, a: 0.12, gain: 0.8, bp: [520, 340], q: 3, trem: [7, 0.3], vib: [4, 3] }); noise(d, t, { type: 'lowpass', f0: 500, dur: 0.9, a: 0.2, gain: 0.08 }); },
      hurt: (d, t, p) => { tone(d, t, { f0: 135 * p, f1: 90 * p, dur: 0.28, a: 0.02, gain: 0.85, bp: [850, 500], q: 3 }); },
      death: (d, t, p) => { tone(d, t, { f0: 112 * p, f1: 44 * p, dur: 1.15, a: 0.05, gain: 0.85, bp: [600, 260], q: 3, trem: [6, 0.25] }); },
      attack: (d, t, p) => { tone(d, t, { f0: 120 * p, f1: 85 * p, dur: 0.3, a: 0.03, gain: 0.8, bp: [700, 450], q: 3 }); },
      burn: (d) => { noise(d, ctx.currentTime, { type: 'highpass', f0: 3000, dur: 0.6, gain: 0.12 }); },
    },
    skeleton: {
      idle: (d, t) => { clicks(d, t, 4 + ((Math.random() * 3) | 0), 0.07, 2800, 0.5); },
      hurt: (d, t) => { clicks(d, t, 3, 0.04, 2200, 0.65); },
      death: (d, t) => { clicks(d, t, 11, 0.06, 2600, 0.6, 0.9); noise(d, t + 0.1, { type: 'lowpass', f0: 900, dur: 0.5, gain: 0.1 }); },
      shoot: (d, t, p) => { tone(d, t, { type: 'triangle', f0: 230 * p, f1: 105 * p, dur: 0.28, gain: 0.7, vib: [40, 12] }); noise(d, t, { f0: 1600, f1: 600, q: 1, dur: 0.13, gain: 0.14 }); },
    },
    spider: {
      idle: (d, t) => { noise(d, t, { type: 'highpass', f0: 4200, dur: 0.38, a: 0.06, gain: 0.16 }); for (let i = 0; i < 3; i++) tone(d, t + 0.4 + i * 0.05, { type: 'square', f0: 1800, f1: 1200, dur: 0.018, gain: 0.12 }); },
      hurt: (d, t, p) => { noise(d, t, { f0: 4500, f1: 2500, q: 1.2, dur: 0.26, gain: 0.3 }); tone(d, t, { f0: 1800 * p, f1: 900 * p, dur: 0.18, gain: 0.14, bp: [2400, 1500], q: 2 }); },
      death: (d, t, p) => { noise(d, t, { f0: 4000, f1: 1500, q: 1.2, dur: 0.75, gain: 0.28 }); tone(d, t, { f0: 1500 * p, f1: 500 * p, dur: 0.6, gain: 0.12, bp: [2000, 900], q: 2 }); },
      attack: (d, t) => { noise(d, t, { type: 'highpass', f0: 3800, dur: 0.32, a: 0.02, gain: 0.3 }); },
    },
    boomer: {
      hurt: (d, t, p) => { tone(d, t, { f0: 150 * p, f1: 100 * p, dur: 0.22, gain: 0.7, bp: [600, 400], q: 2 }); },
      death: (d, t) => { tone(d, t, { type: 'sine', f0: 190, f1: 60, dur: 0.22, gain: 0.5 }); noise(d, t, { type: 'lowpass', f0: 1200, f1: 300, dur: 0.16, gain: 0.25 }); },
    },
    slime: {
      hop: (d, t, p, size) => { const k = 1.5 / size; tone(d, t, { type: 'sine', f0: 170 * k * p, f1: 340 * k * p, dur: 0.14, gain: 0.5, vib: [30, 20] }); noise(d, t, { f0: 700 * k, f1: 1500 * k, q: 3, dur: 0.1, gain: 0.1 }); },
      hurt: (d, t, p, size) => { const k = 1.5 / size; noise(d, t, { type: 'lowpass', f0: 900 * k, f1: 300, dur: 0.25, gain: 0.3 }); tone(d, t, { type: 'sine', f0: 320 * k * p, f1: 140 * k, dur: 0.22, gain: 0.35, vib: [26, 30] }); },
      death: (d, t, p, size) => { const k = 1.5 / size; noise(d, t, { f0: 1300 * k, f1: 280, q: 1.5, dur: 0.35, gain: 0.32 }); tone(d, t, { type: 'sine', f0: 300 * k * p, f1: 70, dur: 0.3, gain: 0.45, vib: [20, 25] }); },
    },
    salmon: {
      idle: (d, t, p) => { for (let i = 0; i < 2; i++) tone(d, t + i * 0.09, { type: 'sine', f0: 520 * p, f1: 950 * p, dur: 0.06, gain: 0.12 }); },
      flop: (d, t) => { for (let i = 0; i < 2; i++) { const at = t + i * 0.16; noise(d, at, { type: 'lowpass', f0: 500, dur: 0.09, gain: 0.35 }); tone(d, at, { type: 'sine', f0: 130, f1: 70, dur: 0.1, gain: 0.3 }); } },
      hurt: (d, t) => { noise(d, t, { f0: 1500, f1: 600, q: 0.9, dur: 0.28, gain: 0.3 }); },
      death: (d, t) => { noise(d, t, { f0: 1800, f1: 400, q: 0.8, dur: 0.45, gain: 0.34 }); tone(d, t + 0.05, { type: 'sine', f0: 400, f1: 150, dur: 0.2, gain: 0.15 }); },
    },
  };
  const BOOM = (d, t) => {
    tone(d, t, { type: 'sine', f0: 95, f1: 28, dur: 1.1, a: 0.01, gain: 1 });
    noise(d, t, { type: 'lowpass', f0: 1400, f1: 110, q: 0.7, dur: 1.3, a: 0.005, gain: 1 });
    noise(d, t + 0.05, { type: 'highpass', f0: 2500, dur: 0.3, gain: 0.25 });
  };

  // At most a handful of new sounds per moment, so a crowd of creatures never turns into noise.
  const budget = { t: 0, n: 0 };
  function allowed() { const now = performance.now(); if (now - budget.t > 300) { budget.t = now; budget.n = 0; } return ++budget.n <= 6; }
  function play(type, what, x, y, z, size = 1, maxD = 26, gain = 1) {
    // A recording of this creature doing this; a death with no recording of its own uses the hurt recording, lower and slower.
    let key = `${type}_${what}`, rate = rnd(0.94, 1.06);
    if (!real[key] && what === 'death' && real[`${type}_hurt`]) { key = `${type}_hurt`; rate *= 0.8; }
    const hasReal = !!(real[key] && real[key].length), v = V[type] && V[type][what];
    if ((!hasReal && !v) || !cfg.creatures || !allowed()) return;
    const d = bus(x, y, z, maxD, gain); if (!d) return;
    if (hasReal && clip(key, d, ctx.currentTime + 0.01, type === 'slime' ? rate * Math.min(2, 1.5 / size) : rate)) return;
    if (v) v(d, ctx.currentTime + 0.01, rnd(0.92, 1.08), size);
  }

  /* ---------- creatures near the player ---------- */
  const seen = new Map();
  function stopHiss(st) { if (!st.hiss) return; const now = ctx.currentTime; st.hiss.g.gain.cancelScheduledValues(now); st.hiss.g.gain.setTargetAtTime(0.0001, now, 0.03); try { st.hiss.src.stop(now + 0.2); } catch { /* already stopped */ } st.hiss = null; }
  function mobs(map, dt) {
    for (const [id, st] of seen) if (!map.has(id)) { stopHiss(st); seen.delete(id); }
    for (const m of map.values()) {
      const type = MOB_TYPES[m.type], f = m.flags | 0;
      let st = seen.get(m.id);
      if (!st) { const r = IDLE[type]; st = { fl: f, t: r ? rnd(1, r[1] * 0.6) : Infinity, hiss: null }; seen.set(m.id, st); } // first sight: no sound for what already happened
      const rise = (bit) => (f & bit) && !(st.fl & bit);
      const d = Math.hypot(m.x - L.x, m.y - L.y, m.z - L.z);
      if (d < 34 && cfg.creatures) {
        if (rise(F_HURT)) play(type, 'hurt', m.x, m.y + 0.5, m.z, m.size, 34);
        if (rise(F_SWING)) play(type, 'attack', m.x, m.y + 0.5, m.z, m.size, 30);
        if (rise(F_SHOOT)) play(type, 'shoot', m.x, m.y + 1.2, m.z, m.size, 34);
        if (rise(F_BURN)) play(type, 'burn', m.x, m.y + 1, m.z, m.size, 24);
        if (type === 'slime' && rise(F_GROUND) && d < 22) play(type, 'hop', m.x, m.y, m.z, m.size, 22);
        if (type === 'boomer' && rise(F_FUSE) && ensureCtx() && ctx.state === 'running') { // the lit fuse hisses until it goes off or is put out
          const out = bus(m.x, m.y + 1, m.z, 30, 1);
          if (out) st.hiss = noise(out, ctx.currentTime + 0.01, { type: 'highpass', f0: 2400, f1: 5200, q: 0.8, dur: 1.7, a: 0.05, gain: 0.4, hold: true });
        }
      }
      if (type === 'boomer' && !(f & F_FUSE) && st.hiss) stopHiss(st);
      if (st.t !== Infinity) {
        const r = IDLE[type], dry = type === 'salmon' && (f & F_DRY);
        st.t -= dt;
        if (st.t <= 0) {
          if (d < 24) play(type, dry ? 'flop' : 'idle', m.x, m.y + 0.5, m.z, m.size, 24, type === 'salmon' ? 0.9 : 1);
          st.t = dry ? rnd(0.8, 1.5) : rnd(r[0], r[1]);
        }
      }
      st.fl = f;
    }
  }

  /* ---------- music ---------- */
  // Two kinds. The sunset song plays during each sunset (a 75% chance per sunset) whenever you are outside, wherever you look.
  // The other songs play now and then at random times, one at a time: Floating Trees only on the surface, Deep Underground only
  // underground (and the most likely song there), Safe and Minecart Memories anywhere. Everything fades in and out.
  const SUNSET_CHANCE = 0.75;
  const TRACKS = [
    { id: 'deep', file: 'deep-underground.mp3', where: 'underground', weight: 5 },
    { id: 'trees', file: 'floating-trees.mp3', where: 'surface', weight: 2 },
    { id: 'safe', file: 'safe.mp3', where: 'any', weight: 2 },
    { id: 'cart', file: 'minecart-memories.mp3', where: 'any', weight: 2 },
  ];
  const music = { el: null, v: 0, on: false, was: false }; // the sunset song
  const rand = { el: null, v: 0, track: null, last: null, wait: rnd(20, 70), bad: 0, done: false }; // whichever random song is current
  const songs = new Map();
  function musicEl() {
    if (!music.el) { const a = new Audio(new URL('./sunset.mp3', import.meta.url)); a.loop = true; a.preload = 'auto'; a.volume = 0; music.el = a; }
    return music.el;
  }
  function songEl(t) {
    let a = songs.get(t.id);
    if (!a) { a = new Audio(new URL('./music/' + t.file, import.meta.url)); a.preload = 'auto'; a.volume = 0; a.onended = () => { if (rand.el === a) rand.done = true; }; songs.set(t.id, a); }
    return a;
  }
  function fade(m, want, dt, up, down) { // move one song's volume toward on or off, starting and stopping playback at the ends
    m.v = clamp(m.v + (want ? dt / up : -dt / down), 0, 1);
    const el = m.el; if (!el) return;
    el.volume = clamp(m.v * m.v * (3 - 2 * m.v) * MUSIC_VOL, 0, 1);
    if (m.v > 0 && el.paused) { const p = el.play(); if (p && p.catch) p.catch(() => {}); }
    else if (m.v <= 0 && !el.paused) el.pause();
  }
  const fits = (t, s) => !s.under && (t.where === 'any' || (t.where === 'surface' ? s.outside : s.underground));
  function pickSong(s) {
    let pool = TRACKS.filter((t) => fits(t, s));
    if (pool.length > 1) pool = pool.filter((t) => t !== rand.last);
    let r = Math.random() * pool.reduce((n, t) => n + t.weight, 0);
    for (const t of pool) { r -= t.weight; if (r <= 0) return t; }
    return pool[0] || null;
  }
  function updateMusic(dt, s) {
    // ---- sunset: one 75% roll at the start of every sunset ----
    const elev = Math.sin(s.ang), window_ = Math.cos(s.ang) < 0 && elev > -0.1 && elev < 0.3;
    if (window_ && !music.was) music.on = Math.random() < SUNSET_CHANCE;
    if (!window_) music.on = false;
    music.was = window_;
    if (music.on && cfg.music) musicEl(); // start fetching the song as the sunset begins, so it is ready when you step outside
    const wantSunset = !!(cfg.music && music.on && s.on && !s.under && s.outside);
    fade(music, wantSunset, dt, 3, cfg.music ? 1.6 : 0.3);
    // ---- random songs: never over the sunset song ----
    const busy = wantSunset || music.v > 0;
    if (rand.done) { rand.done = false; rand.track = null; rand.v = 0; rand.wait = rnd(90, 240); }
    if (rand.track) {
      rand.bad = !cfg.music || !s.on || busy || !fits(rand.track, s) ? rand.bad + dt : 0; // e.g. walking down into a cave ends Floating Trees
      fade(rand, rand.bad <= 2, dt, 3, cfg.music ? 1.6 : 0.3);
      if (rand.bad > 2 && rand.v <= 0) { rand.track = null; rand.wait = rnd(40, 120); }
    } else if (cfg.music && s.on && !busy && !s.under) {
      rand.wait -= dt;
      if (rand.wait <= 0) {
        const t = pickSong(s);
        if (!t) rand.wait = 10;
        else { rand.track = t; rand.last = t; rand.el = songEl(t); rand.el.currentTime = 0; rand.v = 0; rand.bad = 0; }
      }
    }
  }

  /* ---------- toggle buttons in the pause menu ---------- */
  function buildSettings() {
    const row = document.getElementById('resume') && document.getElementById('resume').parentElement; if (!row || !row.parentElement) return;
    const make = (label, key, id) => {
      const wrap = document.createElement('div'); wrap.className = 'sl';
      const span = document.createElement('span'); span.textContent = label;
      const b = document.createElement('button'); b.id = id; b.type = 'button';
      const paint = () => { b.textContent = cfg[key] ? 'On' : 'Off'; b.setAttribute('aria-pressed', String(!!cfg[key])); b.style.background = cfg[key] ? 'var(--moss)' : 'var(--stone)'; };
      b.onclick = () => { cfg[key] = !cfg[key]; save(); paint(); b.blur(); if (cfg[key]) ensureCtx(); };
      paint(); wrap.append(span, b); row.parentElement.insertBefore(wrap, row);
    };
    make('Music', 'music', 'sMusic');
    make('Creature sounds', 'creatures', 'sCreatures');
  }
  buildSettings();

  return {
    // Called every frame while playing. s: { on, ang, look, x, y, z, yaw, mobs, under, outside }
    update(dt, s) {
      L.x = s.x; L.y = s.y; L.z = s.z; L.yaw = s.yaw;
      updateMusic(dt, s);
      if (cfg.creatures && ctx && ctx.state === 'running') mobs(s.mobs, dt);
      else if (!cfg.creatures) for (const st of seen.values()) if (st.hiss) stopHiss(st);
    },
    // Server events: creature deaths and explosions.
    fx(m) {
      if (!ctx || ctx.state !== 'running') return;
      if (m.k === 'die') play(MOB_TYPES[m.ty], 'death', m.x, m.y + 0.5, m.z, m.sz || 1, 34);
      else if (m.k === 'boom' && cfg.creatures) { const d = bus(m.x, m.y, m.z, 70, 1); if (d && !clip('boomer_boom', d, ctx.currentTime + 0.01, 1, 5)) BOOM(d, ctx.currentTime + 0.01); }
    },
    // Leaving the world: stop everything and forget the creatures.
    stop() {
      music.v = 0; music.on = false; music.was = false; if (music.el && !music.el.paused) music.el.pause();
      rand.v = 0; rand.track = null; rand.done = false; rand.wait = rnd(20, 70); if (rand.el && !rand.el.paused) rand.el.pause();
      for (const st of seen.values()) if (ctx) stopHiss(st);
      seen.clear();
    },
  };
}
