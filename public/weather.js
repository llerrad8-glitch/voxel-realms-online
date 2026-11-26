// Weather you can see: rain streaks (or snow flakes in the cold biome) and blowing sand around the camera, plus little splashes where rain lands.
// Rain and sand are separate: both can show at once (rain in a sandstorm in the desert).
// precip: 0 none, 1 rain, 2 snow. pk: how strong it is right now (0 to 1, fades in and out). sk: how strong the sandstorm is (0 to 1).
// heightAt(x, z): the y of the top of the ground there (for splashes), or null.
import * as THREE from 'three';

const N = 1500, R = 15, HI = 13, S = 40, DPS = 3; // S splashes at a time, DPS droplets each
export class Weather {
  constructor(scene) {
    this.kind = 0; this.t = 0; this.sandOn = false; this.acc = 0; this.si = 0;
    this.px = new Float32Array(N); this.py = new Float32Array(N); this.pz = new Float32Array(N); this.sp = new Float32Array(N);
    this.qx = new Float32Array(N); this.qy = new Float32Array(N); this.qz = new Float32Array(N); this.qs = new Float32Array(N);
    this.rainPos = new Float32Array(N * 6); this.ptsPos = new Float32Array(N * 3); this.sandPos = new Float32Array(N * 3);
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaec6ff, transparent: true, opacity: 0.5, depthWrite: false }));
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(this.ptsPos, 3));
    this.snow = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false }));
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(this.sandPos, 3));
    this.sand = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdcb66f, size: 0.13, sizeAttenuation: true, transparent: true, opacity: 0.75, depthWrite: false }));
    // splashes: a few tiny droplets that pop up from the ground where a raindrop lands and fall back
    this.sPos = new Float32Array(S * DPS * 3).fill(-1e4);
    this.sx = new Float32Array(S); this.sy = new Float32Array(S); this.sz = new Float32Array(S); this.sa = new Float32Array(S).fill(9);
    this.dv = new Float32Array(S * DPS * 3);
    const spg = new THREE.BufferGeometry(); spg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    this.splash = new THREE.Points(spg, new THREE.PointsMaterial({ color: 0xdbe8ff, size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false }));
    for (const o of [this.rain, this.snow, this.sand, this.splash]) { o.frustumCulled = false; o.visible = false; o.renderOrder = 3; scene.add(o); }
    this.wind = [0.8, 0.6]; // sandstorms blow one way across the world
  }
  spawn(i, c, anywhere) {
    this.px[i] = c.x + (Math.random() * 2 - 1) * R; this.pz[i] = c.z + (Math.random() * 2 - 1) * R;
    this.py[i] = anywhere ? c.y - 4 + Math.random() * HI : c.y + HI * 0.6 + Math.random() * HI * 0.5;
    this.sp[i] = Math.random();
  }
  spawnSand(i, c, upwind) {
    this.qx[i] = c.x + (Math.random() * 2 - 1) * R; this.qz[i] = c.z + (Math.random() * 2 - 1) * R;
    this.qy[i] = c.y - 4 + Math.random() * HI; this.qs[i] = Math.random();
    if (upwind) { this.qx[i] = c.x - this.wind[0] * R * 0.95 + (Math.random() - 0.5) * 6; this.qz[i] = c.z - this.wind[1] * R * 0.95 + (Math.random() - 0.5) * 6; } // blown in from upwind
  }
  update(dt, kind, k, sk, cam, heightAt) {
    if (kind !== this.kind) { this.kind = kind; for (let i = 0; i < N; i++) this.spawn(i, cam, true); }
    const sandOn = sk > 0.02;
    if (sandOn && !this.sandOn) for (let i = 0; i < N; i++) this.spawnSand(i, cam, false);
    this.sandOn = sandOn;
    this.rain.visible = kind === 1 && k > 0.02; this.snow.visible = kind === 2 && k > 0.02; this.sand.visible = sandOn;
    this.splash.visible = this.rain.visible || this.hasSplash;
    this.t += dt;
    const px = this.px, py = this.py, pz = this.pz, sp = this.sp;
    if (kind && k > 0.02) {
      const n = Math.max(80, Math.floor(N * (0.25 + 0.75 * k)));
      if (kind === 1) {
        this.rain.material.opacity = 0.5 * k;
        for (let i = 0; i < n; i++) {
          const v = 22 + sp[i] * 8; py[i] -= v * dt; px[i] += 2.2 * dt;
          if (py[i] < cam.y - 5 || Math.abs(px[i] - cam.x) > R || Math.abs(pz[i] - cam.z) > R) this.spawn(i, cam, false);
          const j = i * 6; this.rainPos[j] = px[i]; this.rainPos[j + 1] = py[i]; this.rainPos[j + 2] = pz[i]; this.rainPos[j + 3] = px[i] - 0.1; this.rainPos[j + 4] = py[i] + 0.75; this.rainPos[j + 5] = pz[i];
        }
        for (let i = n * 6; i < N * 6; i++) this.rainPos[i] = 0;
        this.rain.geometry.attributes.position.needsUpdate = true;
        // new splashes where drops land
        if (heightAt) {
          this.acc += dt * 38 * k;
          while (this.acc >= 1) {
            this.acc -= 1;
            const a = Math.random() * 6.2832, d = 1.5 + Math.sqrt(Math.random()) * (R - 3), x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d, y = heightAt(Math.floor(x), Math.floor(z));
            if (y === null || y === undefined) continue;
            const s = this.si; this.si = (this.si + 1) % S;
            this.sx[s] = x; this.sy[s] = y + 0.03; this.sz[s] = z; this.sa[s] = 0;
            for (let q = 0; q < DPS; q++) { const aa = Math.random() * 6.2832, h = 0.35 + Math.random() * 0.5, o = (s * DPS + q) * 3; this.dv[o] = Math.cos(aa) * h; this.dv[o + 1] = 1.6 + Math.random() * 1.2; this.dv[o + 2] = Math.sin(aa) * h; }
          }
        }
      } else {
        const a = this.ptsPos;
        for (let i = 0; i < N; i++) {
          if (i >= n) { a[i * 3] = a[i * 3 + 1] = a[i * 3 + 2] = 0; continue; }
          py[i] -= (1.3 + sp[i] * 1.2) * dt; px[i] += Math.sin(this.t * 0.9 + i) * 0.6 * dt + 0.5 * dt; pz[i] += Math.cos(this.t * 0.7 + i * 1.7) * 0.5 * dt; // snow: slow, swaying flakes
          if (py[i] < cam.y - 5 || py[i] > cam.y + HI + 2 || Math.abs(px[i] - cam.x) > R || Math.abs(pz[i] - cam.z) > R) this.spawn(i, cam, true);
          a[i * 3] = px[i]; a[i * 3 + 1] = py[i]; a[i * 3 + 2] = pz[i];
        }
        this.snow.material.opacity = 0.9 * Math.min(1, k * 1.2);
        this.snow.geometry.attributes.position.needsUpdate = true;
      }
    }
    // droplets: up, then down under gravity, gone after a third of a second
    this.hasSplash = false;
    for (let s = 0; s < S; s++) {
      if (this.sa[s] > 0.34) { if (this.sa[s] < 9) { this.sa[s] = 9; for (let q = 0; q < DPS; q++) { const o = (s * DPS + q) * 3; this.sPos[o] = this.sPos[o + 1] = this.sPos[o + 2] = -1e4; } } continue; }
      this.sa[s] += dt; this.hasSplash = true; const t = this.sa[s];
      for (let q = 0; q < DPS; q++) { const o = (s * DPS + q) * 3; this.sPos[o] = this.sx[s] + this.dv[o] * t; this.sPos[o + 1] = this.sy[s] + this.dv[o + 1] * t - 7 * t * t; this.sPos[o + 2] = this.sz[s] + this.dv[o + 2] * t; }
    }
    this.splash.geometry.attributes.position.needsUpdate = true;
    this.splash.visible = this.hasSplash;
    if (sandOn) {
      const n = Math.max(80, Math.floor(N * (0.25 + 0.75 * sk))), qx = this.qx, qy = this.qy, qz = this.qz, qs = this.qs, a = this.sandPos;
      for (let i = 0; i < N; i++) {
        if (i >= n) { a[i * 3] = a[i * 3 + 1] = a[i * 3 + 2] = 0; continue; }
        const v = 9 + qs[i] * 6; qx[i] += this.wind[0] * v * dt; qz[i] += this.wind[1] * v * dt; qy[i] += Math.sin(this.t * 3 + i * 2.3) * 1.2 * dt - 0.4 * dt; // sand: fast, mostly sideways, with a bit of tumbling
        if (qy[i] < cam.y - 5 || qy[i] > cam.y + HI + 2 || Math.abs(qx[i] - cam.x) > R || Math.abs(qz[i] - cam.z) > R) this.spawnSand(i, cam, true);
        a[i * 3] = qx[i]; a[i * 3 + 1] = qy[i]; a[i * 3 + 2] = qz[i];
      }
      this.sand.material.opacity = 0.75 * Math.min(1, sk * 1.2);
      this.sand.geometry.attributes.position.needsUpdate = true;
    }
  }
}
