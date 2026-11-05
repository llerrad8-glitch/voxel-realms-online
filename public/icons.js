// Artwork: if a Minecraft-layout texture folder is present (public/textures, see README) the real textures are used; anything missing
// falls back to art drawn in code, so the game always works. Covers block textures, item icons, mining cracks, sun, moon and water.
import { BLOCKS } from './shared/world.js';
import { GRASS, FOLIAGE, WATER_TINT, BLOCK_TILES, BLOCK_FILES, ITEM_FILE, ENV_FILES } from './shared/texture-files.js';
import { ITEMS, MATS, ARMOR_MATS, TOOL_KINDS, ARMOR_TYPES, I } from './shared/items.js';

export const TILE = 16, COLS = 8, ROWS = 4, AW = TILE * COLS, AH = TILE * ROWS;
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

/* ---------- optional real textures: public/textures/{block,item,environment}/*.png (run `npm run textures`) ---------- */
export const PACK = { on: false, block: {}, item: {}, env: {} };
const loadImg = (url) => new Promise((res) => {
  const i = new Image(), t = setTimeout(() => res(null), 6000);
  i.onload = () => { clearTimeout(t); res(i.width ? i : null); }; i.onerror = () => { clearTimeout(t); res(null); }; i.src = url;
});
await (async () => {
  const stone = await loadImg('textures/block/stone.png'); // one probe: no texture folder means no further requests
  if (!stone) return;
  PACK.on = true; PACK.block.stone = stone;
  const jobs = [];
  for (const n of BLOCK_FILES) if (n !== 'stone') jobs.push(loadImg(`textures/block/${n}.png`).then((i) => { if (i) PACK.block[n] = i; }));
  for (const [id, n] of Object.entries(ITEM_FILE)) jobs.push(loadImg(`textures/item/${n}.png`).then((i) => { if (i) PACK.item[id] = i; }));
  for (const [key, paths] of ENV_FILES) jobs.push((async () => { for (const p of paths) { const i = await loadImg(`textures/${p}.png`); if (i) { PACK.env[key] = i; return; } } })());
  await Promise.all(jobs);
})();

/* ---------- block texture atlas ---------- */
export const atlas = mk(AW, AH);
(() => {
  const g = atlas.getContext('2d');
  let s = 1337;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const px = (t, x, y, r, gr, b, a = 1) => { g.fillStyle = `rgba(${r | 0},${gr | 0},${b | 0},${a})`; g.fillRect((t % COLS) * TILE + x, ((t / COLS) | 0) * TILE + y, 1, 1); };
  const fill = (t, c, j) => { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) { const n = (rnd() - 0.5) * j; px(t, x, y, c[0] + n, c[1] + n, c[2] + n); } };
  const rect = (t, x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(t, x, y, c[0], c[1], c[2]); };
  const stone = [125, 125, 128], dirt = [121, 85, 58], plank = [168, 132, 82];
  fill(0, [88, 160, 62], 22);
  fill(1, dirt, 20); for (let x = 0; x < TILE; x++) for (let y = 0, h = 4 + ((rnd() * 2) | 0); y < h; y++) px(1, x, y, 88 + rnd() * 14, 160 + rnd() * 14, 62);
  fill(2, dirt, 20); fill(3, stone, 22); fill(4, [219, 207, 142], 14); fill(5, [48, 96, 205], 10);
  fill(6, [104, 82, 50], 14); for (let x = 0; x < TILE; x += 4) for (let y = 0; y < TILE; y++) px(6, x, y, 80, 62, 36);
  fill(7, [162, 132, 84], 12);
  for (const r of [3, 6]) for (let t = r; t < TILE - r; t++) { px(7, t, r, 120, 92, 56); px(7, t, TILE - 1 - r, 120, 92, 56); px(7, r, t, 120, 92, 56); px(7, TILE - 1 - r, t, 120, 92, 56); }
  fill(8, [50, 118, 38], 40); fill(9, [244, 248, 250], 8);
  fill(10, plank, 12); for (let y = 3; y < TILE; y += 4) for (let x = 0; x < TILE; x++) px(10, x, y, 120, 90, 52);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(11, x, y, 210, 235, 255, x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1 ? 0.9 : 0.18);
  fill(12, [150, 72, 60], 14);
  for (let y = 0; y < TILE; y += 4) {
    for (let x = 0; x < TILE; x++) px(12, x, y, 200, 190, 180);
    for (let x = ((y / 4) % 2) * 4 + 2; x < TILE; x += 8) for (let k = 1; k < 4; k++) px(12, x, y + k, 200, 190, 180);
  }
  fill(13, [52, 52, 56], 50);
  const ore = (t, c, hi) => {
    fill(t, stone, 22);
    for (let n = 0; n < 12; n++) { const x = (rnd() * 14) | 0, y = (rnd() * 14) | 0; for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) px(t, x + dx, y + dy, c[0], c[1], c[2]); if (hi) px(t, x, y, hi[0], hi[1], hi[2]); }
  };
  ore(14, [30, 30, 32]); ore(15, [214, 168, 130]); ore(16, [250, 214, 60]);
  // cobblestone: staggered irregular stones with dark seams
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const row = y >> 2, col = (x + (row & 1) * 3) % 8, cell = ((x + (row & 1) * 3) >> 3) + row * 3, seam = y % 4 === 3 || col === 0;
    const v = seam ? 70 : 118 + ((Math.imul(cell + 7, 2654435761) >>> 24) % 28) + (rnd() - 0.5) * 14;
    px(17, x, y, v, v, v + 3);
  }
  fill(18, [132, 127, 122], 70); for (let n = 0; n < 26; n++) { const v = 70 + rnd() * 50; px(18, (rnd() * 16) | 0, (rnd() * 16) | 0, v, v - 4, v - 8); }
  ore(19, [92, 236, 226], [225, 255, 250]);
  fill(20, plank, 12); rect(20, 0, 0, 15, 0, [96, 66, 34]); rect(20, 0, 15, 15, 15, [96, 66, 34]); rect(20, 0, 0, 0, 15, [96, 66, 34]); rect(20, 15, 0, 15, 15, [96, 66, 34]);
  for (const k of [5, 10]) { rect(20, k, 1, k, 14, [110, 76, 40]); rect(20, 1, k, 14, k, [110, 76, 40]); }
  fill(21, plank, 12); rect(21, 0, 0, 15, 3, [112, 78, 42]); rect(21, 0, 4, 15, 4, [80, 54, 28]);
  rect(21, 2, 6, 5, 8, [150, 154, 160]); rect(21, 3, 9, 4, 13, [90, 62, 32]); rect(21, 8, 6, 13, 7, [205, 208, 212]); rect(21, 11, 8, 12, 13, [90, 62, 32]);
  fill(22, [112, 112, 116], 16); rect(22, 0, 0, 15, 0, [80, 80, 84]); rect(22, 0, 15, 15, 15, [80, 80, 84]); rect(22, 0, 0, 0, 15, [80, 80, 84]); rect(22, 15, 0, 15, 15, [80, 80, 84]); rect(22, 3, 3, 12, 12, [70, 70, 74]);
  fill(23, [122, 122, 126], 16); rect(23, 3, 4, 12, 12, [34, 34, 38]); rect(23, 3, 4, 12, 5, [150, 150, 156]);
  for (let x = 4; x < 12; x += 2) rect(23, x, 6, x, 8, [60, 60, 66]);
  px(23, 5, 11, 200, 90, 30); px(23, 9, 12, 220, 120, 30); px(23, 10, 11, 170, 60, 20);
  fill(24, [150, 100, 44], 14); rect(24, 0, 0, 15, 0, [96, 60, 24]); rect(24, 0, 15, 15, 15, [96, 60, 24]); rect(24, 0, 0, 0, 15, [96, 60, 24]); rect(24, 15, 0, 15, 15, [96, 60, 24]);
  fill(25, [150, 100, 44], 14); rect(25, 0, 0, 15, 0, [96, 60, 24]); rect(25, 0, 15, 15, 15, [96, 60, 24]); rect(25, 0, 5, 15, 5, [88, 54, 22]); rect(25, 6, 4, 9, 8, [196, 198, 204]); rect(25, 7, 6, 8, 8, [60, 60, 66]);
  fill(26, [236, 236, 236], 12); for (let y = 2; y < TILE; y += 4) for (let x = 0; x < TILE; x++) px(26, x, y, 214, 214, 216);
})();

// Paint the real textures over the code-drawn ones. Only the first square frame is used (water and other strips are animated in the real game).
function frameOf(img, tint, size = TILE) {
  const c = mk(size, size), g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, img.width, img.width, 0, 0, size, size);
  if (tint) { const d = g.getImageData(0, 0, size, size), a = d.data; for (let i = 0; i < a.length; i += 4) { a[i] = (a[i] * tint[0]) / 255; a[i + 1] = (a[i + 1] * tint[1]) / 255; a[i + 2] = (a[i + 2] * tint[2]) / 255; } g.putImageData(d, 0, 0); }
  return c;
}
if (PACK.on) {
  const g = atlas.getContext('2d'); g.imageSmoothingEnabled = false;
  const put = (t, c) => { const x = (t % COLS) * TILE, y = ((t / COLS) | 0) * TILE; g.clearRect(x, y, TILE, TILE); g.drawImage(c, 0, 0, TILE, TILE, x, y, TILE, TILE); };
  for (const [t, [name, tint]] of Object.entries(BLOCK_TILES)) if (PACK.block[name]) put(+t, frameOf(PACK.block[name], tint));
  if (PACK.block.grass_block_side) { // dirt with the green fringe: the real side texture plus its grey overlay, tinted like the top
    const c = frameOf(PACK.block.grass_block_side), cg = c.getContext('2d');
    if (PACK.block.grass_block_side_overlay) cg.drawImage(frameOf(PACK.block.grass_block_side_overlay, GRASS), 0, 0);
    put(1, c);
  }
  if (PACK.block.oak_leaves) { // keep leaves solid (no see-through holes): tinted leaf over a dark green backing
    const c = mk(TILE, TILE), cg = c.getContext('2d'); cg.fillStyle = 'rgb(36,66,20)'; cg.fillRect(0, 0, TILE, TILE);
    cg.drawImage(frameOf(PACK.block.oak_leaves, FOLIAGE), 0, 0); put(8, c);
  }
}
// Water is drawn from a strip of frames that the game scrolls through, so it shimmers like the real thing.
export const WATER_FRAMES = PACK.block.water_still ? Math.max(1, Math.min(32, Math.floor(PACK.block.water_still.height / PACK.block.water_still.width))) : 8;
export const waterStrip = (() => {
  const c = mk(TILE, TILE * WATER_FRAMES), g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  const w = PACK.block.water_still;
  if (w) {
    for (let f = 0; f < WATER_FRAMES; f++) g.drawImage(w, 0, f * w.width, w.width, w.width, 0, f * TILE, TILE, TILE);
    const d = g.getImageData(0, 0, TILE, TILE * WATER_FRAMES), a = d.data;
    for (let i = 0; i < a.length; i += 4) { a[i] = (a[i] * WATER_TINT[0]) / 255; a[i + 1] = (a[i + 1] * WATER_TINT[1]) / 255; a[i + 2] = (a[i + 2] * WATER_TINT[2]) / 255; a[i + 3] = 255; }
    g.putImageData(d, 0, 0);
  } else {
    const sx = (5 % COLS) * TILE, sy = ((5 / COLS) | 0) * TILE;
    for (let f = 0; f < WATER_FRAMES; f++) { const s = (f * 2) % TILE; g.drawImage(atlas, sx, sy + s, TILE, TILE - s, 0, f * TILE, TILE, TILE - s); if (s) g.drawImage(atlas, sx, sy, TILE, s, 0, f * TILE + TILE - s, TILE, s); }
  }
  return c;
})();
export const UV = [];
for (let t = 0; t < COLS * ROWS; t++) {
  const c = t % COLS, r = (t / COLS) | 0, e = 0.05;
  UV.push([(c * TILE + e) / AW, 1 - ((r + 1) * TILE - e) / AH, ((c + 1) * TILE - e) / AW, 1 - (r * TILE + e) / AH]);
}
const colorCache = [];
export function tileColor(t) { // average colour of a tile, used for break particles
  if (colorCache[t]) return colorCache[t];
  const d = atlas.getContext('2d').getImageData((t % COLS) * TILE, ((t / COLS) | 0) * TILE, TILE, TILE).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  return (colorCache[t] = n ? [r / n / 255, g / n / 255, b / n / 255] : [0.8, 0.9, 1]);
}

/* ---------- pixel-art item icons ---------- */
const grid = () => Array.from({ length: 16 }, () => Array(16).fill(null));
function fromRows(rows, pal) { const g = grid(); rows.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) g[y][x] = pal[ch]; })); return g; }
function outline(g, c = '#17110d') {
  const o = grid();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) o[y][x] = g[y][x];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (!g[y][x] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy] && g[y + dy][x + dx])) o[y][x] = c;
  return o;
}
const T = {
  pick: ['................', '....LLLLLL......', '..LLMMMMMMLL....', '.LMMDD..DDMML...', 'LMD........DML..', 'MD..........DM..', 'D.....st....D...', '.....st.........', '....st..........', '...st...........', '..st............', '.st.............', 'st..............', '................'],
  axe: ['................', '.....LLL........', '....LMMML.......', '...LMMMMMD......', '...LMMMMD.......', '....LMMD.st.....', '.....DD.st......', '.......st.......', '......st........', '.....st.........', '....st..........', '...st...........', '..st............', '.st.............'],
  shovel: ['................', '..........LLL...', '.........LMMML..', '.........LMMMD..', '.........LMMMD..', '..........DDD...', '.........st.....', '........st......', '.......st.......', '......st........', '.....st.........', '....st..........', '...st...........', '..st............', '.st.............'],
  sword: ['..............LL', '.............LML', '............LMMD', '...........LMMD.', '..........LMMD..', '.........LMMD...', '........LMMD....', '.......LMMD.....', '..D...LMMD......', '...D.LMMD.......', '....DMMD........', '.....DDD........', '....sD.D........', '...st...........', '..st............', '.st.............'],
  helmet: ['................', '....DDDDDDDD....', '...DMMMMMMMMD...', '..DMLLLLLLLLMD..', '..DMLMMMMMMLMD..', '..DML......LMD..', '..DML......LMD..', '..DMD......DMD..'],
  chest: ['................', '..DDD......DDD..', '.DMMMD....DMMMD.', '.DMLMMDDDDMMLMD.', '.DMLMMMMMMMMLMD.', '.DMLMMMMMMMMLMD.', '..DMMMMMMMMMMD..', '..DMLMMMMMMLMD..', '..DMLMMMMMMLMD..', '..DMMMMMMMMMMD..', '...DDDDDDDDDD...'],
  legs: ['................', '...DDDDDDDDDD...', '..DMMMMMMMMMMD..', '..DMLMMMMMMLMD..', '..DMLMMDDMMLMD..', '..DMLMD..DMLMD..', '..DMLMD..DMLMD..', '..DMMMD..DMMMD..', '..DDDDD..DDDDD..'],
  bucket: ['................', '................', '................', '....DDDDDDDD....', '...DLLLLLLLLD...', '...DKKKKKKKKD...', '...DMMMMMMMMD...', '...DMLMMMMMMD...', '....DMLMMMMD....', '....DMLMMMMD....', '....DMMMMMMD....', '.....DMMMMD.....', '.....DDDDDD.....'],
  boots: ['................', '................', '..DDDD....DDDD..', '..DMMD....DMMD..', '..DMLD....DMLD..', '.DDMMD....DMMDD.', '.DMMMD....DMMMD.', '.DDDDD....DDDDD.'],
  bow: ['................', '.......ss.......', '......s..w......', '.....s....w.....', '....s.....w.....', '....s.....w.....', '...s......w.....', '...s......w.....', '...s......w.....', '....s.....w.....', '....s.....w.....', '.....s....w.....', '......s..w......', '.......ss.......'],
  arrow: ['................', '............GGG.', '...........GGGG.', '..........sGGG..', '.........ss.G...', '........ss......', '.......ss.......', '......ss........', '.....ss.........', '....ss..........', '...ss.f.........', '..ssf.f.........', '.ff.ff..........', '.ff.............'],
  stick: ['................', '..............ss', '.............st.', '............st..', '...........st...', '..........st....', '.........st.....', '........st......', '.......st.......', '......st........', '.....st.........', '....st..........', '...st...........', '..st............'],
  coal: ['................', '................', '....MMMM........', '...MKKKKM.......', '..MKKLKKKM......', '..MKKKKKKM......', '..MKKKLKKM......', '...MKKKKM.......', '....MMMM........'],
  ingot: ['................', '................', '.....LLLLLLL....', '....LMMMMMMMD...', '...LMMMMMMMMMD..', '..LLLLLLLLLLMD..', '..MMMMMMMMMMMD..', '..MMMMMMMMMMDD..', '...DDDDDDDDD....'],
  gem: ['................', '................', '.....LLLLL......', '....LWWLLLL.....', '...LLMMMMMLL....', '..LMMMMMMMMML...', '..DMMMMMMMMMD...', '...DMMMMMMMD....', '....DMMMMMD.....', '.....DMMMD......', '......DMD.......', '.......D........'],
  flint: ['................', '................', '.......KK.......', '......KLKK......', '.....KLKKKK.....', '....KKLKKKK.....', '....KKKKKK......', '.....KKKK.......'],
  steak: ['................', '................', '....DDDDDD......', '...DMMMMMMD.....', '..DMLLMMMMMD....', '..DMLMMMMMMMD...', '..DMMMMMMMMMD...', '...DMMMMMMMD....', '....DDDDDD......'],
  leg: ['................', '......MMMM......', '.....MLLMMM.....', '....MLLMMMMD....', '....MMMMMMMD....', '.....MMMMMD.....', '......MMMD......', '.......Dbb......', '........bbb.....', '.........bb.....'],
  apple: ['................', '.......gg.......', '......g.s.......', '....RRRsRR......', '...RLLRRRRR.....', '..RLRRRRRRRD....', '..RRRRRRRRRD....', '..RRRRRRRRRD....', '...RRRRRRRD.....', '....RRRRRD......', '.....DDDD.......'],
  rotten: ['................', '................', '....MMMM........', '...MGMMGM.......', '..MMMKMMMM......', '..MGMMMMKM......', '..MMMKMGMM......', '...MMMMMM.......', '....MMMM........'],
  bone: ['................', '.............bb.', '............bbbb', '...........bbb..', '..........bbb...', '.........bbb....', '........bbb.....', '.......bbb......', '......bbb.......', '.....bbb........', '..bb.bb.........', '.bbbb...........', '.bb.............'],
  string: ['................', '................', '.........ww.....', '........w..w....', '.......w.....w..', '......w......w..', '.....w......w...', '....w......w....', '...w......w.....', '..w......w......', '.w......w.......', '.ww....w........'],
  feather: ['................', '..............FF', '.............FFL', '............FFL.', '...........FFL..', '..........FFL...', '.........FFL....', '........FFL.....', '.......FFL......', '......FFL.......', '.....sL.........', '....s...........', '...s............'],
  leather: ['................', '................', '...DDDDDDDDD....', '..DMMMMMMMMMD...', '..DMLMMMMMMMD...', '..DMMMMMMMLMD...', '..DMMMMLMMMMD...', '..DMMMMMMMMMD...', '...DDDDDDDDD....'],
  powder: ['................', '................', '................', '.....MM.........', '....MLMM..M.....', '...MMMMMMMLM....', '..MLMMMMMMMMM...', '.MMMMLMMMMMLMM..', '.MMMMMMMMMMMMM..'],
  slime: ['................', '................', '.....MMMM.......', '....MLLMMM......', '...MLMMMMMM.....', '...MMMMMMMM.....', '...MMMMMMMM.....', '....MMMMMM......', '.....MMMM.......'],
};
const wood = { M: '#b8945f', L: '#d8bb86', D: '#7a5a30' }, stoneP = { M: '#8c8c90', L: '#b6b6ba', D: '#58585c' }, ironP = { M: '#cfd3d6', L: '#f6f8f9', D: '#8d9296' };
const goldP = { M: '#f2c93c', L: '#fff08a', D: '#b8891a' }, diaP = { M: '#4fe0d6', L: '#aefff7', D: '#1f9c94' }, leatherP = { M: '#a06a42', L: '#c48a5a', D: '#6b4527' };
const MATP = [wood, stoneP, ironP, goldP, diaP], ARMP = [leatherP, ironP, goldP, diaP];
const STICK = { s: '#8a6a3a', t: '#5a4020' };
const meat = (L, M, D) => ({ tpl: 'steak', pal: { L, M, D } });
const SPEC = {
  [I.STICK]: { tpl: 'stick', pal: STICK }, [I.COAL]: { tpl: 'coal', pal: { K: '#25252a', L: '#5a5a62', M: '#3a3a40' } },
  [I.IRON_INGOT]: { tpl: 'ingot', pal: ironP }, [I.GOLD_INGOT]: { tpl: 'ingot', pal: goldP }, [I.DIAMOND]: { tpl: 'gem', pal: { ...diaP, W: '#ffffff' } },
  [I.FLINT]: { tpl: 'flint', pal: { K: '#4a4a50', L: '#8a8a92' } }, [I.APPLE]: { tpl: 'apple', pal: { R: '#d8262c', L: '#ff8a8a', D: '#8e1218', g: '#4cb43a', s: '#6b4a24' } },
  [I.ROTTEN]: { tpl: 'rotten', pal: { M: '#8a7a3a', G: '#5f8a3a', K: '#4a3c20' } }, [I.BONE]: { tpl: 'bone', pal: { b: '#ece8dc' } },
  [I.STRING]: { tpl: 'string', pal: { w: '#eeeeee' } }, [I.ARROW]: { tpl: 'arrow', pal: { G: '#9a9ea4', s: '#8a6a3a', f: '#f4f4f4' } },
  [I.FEATHER]: { tpl: 'feather', pal: { F: '#f2f2f2', L: '#cfd2d6', s: '#b8b8b8' } }, [I.LEATHER]: { tpl: 'leather', pal: leatherP },
  [I.GUNPOWDER]: { tpl: 'powder', pal: { M: '#6f6f74', L: '#a2a2a8' } }, [I.SLIME]: { tpl: 'slime', pal: { M: '#6fd24a', L: '#d4ffbc' } },
  [I.RAW_PORK]: meat('#f6b9bd', '#e58e98', '#a9525d'), [I.COOKED_PORK]: meat('#c98a52', '#9b5a2e', '#5e3318'),
  [I.RAW_BEEF]: meat('#e06b6b', '#b83a3a', '#7a2020'), [I.STEAK]: meat('#a8683c', '#7a4021', '#47230f'),
  [I.RAW_MUTTON]: meat('#e8868c', '#c8545e', '#8a2c36'), [I.COOKED_MUTTON]: meat('#b87a4a', '#8a4b26', '#552b14'),
  [I.RAW_RABBIT]: meat('#f0a898', '#d9806c', '#a2503e'), [I.COOKED_RABBIT]: meat('#c8905c', '#995f31', '#5c3519'),
  [I.RAW_CHICKEN]: { tpl: 'leg', pal: { L: '#fbd2c2', M: '#eaa890', D: '#b86f58', b: '#ece8dc' } }, [I.COOKED_CHICKEN]: { tpl: 'leg', pal: { L: '#e0a458', M: '#b8742a', D: '#74441a', b: '#ece8dc' } },
  [I.BOW]: { tpl: 'bow', pal: { s: '#8a6a3a', w: '#eeeeee' } },
  [I.BUCKET]: { tpl: 'bucket', pal: { ...ironP, K: '#2c2c32' } }, [I.WATER_BUCKET]: { tpl: 'bucket', pal: { ...ironP, K: '#3f76e4' } },
};
TOOL_KINDS.forEach((k, ki) => MATS.forEach((m, mi) => { SPEC[290 + ki * 5 + mi] = { tpl: k === 'pickaxe' ? 'pick' : k, pal: { ...MATP[mi], ...STICK } }; }));
ARMOR_TYPES.forEach((_, ti) => ARMOR_MATS.forEach((m, mi) => { SPEC[310 + ti * 4 + mi] = { tpl: ['helmet', 'chest', 'legs', 'boots'][ti], pal: ARMP[mi] }; }));
export const itemGrid = (id) => { const s = SPEC[id]; return s ? outline(fromRows(T[s.tpl], s.pal)) : null; };

function blockIcon(id) { // little isometric cube made from the block's own textures
  const c = mk(32, 32), g = c.getContext('2d'), def = BLOCKS[id];
  g.imageSmoothingEnabled = false;
  const tile = (t, m, shade) => {
    g.save(); g.setTransform(...m);
    g.drawImage(atlas, (t % COLS) * TILE, ((t / COLS) | 0) * TILE, TILE, TILE, 0, 0, TILE, TILE);
    if (shade) { g.fillStyle = `rgba(0,0,0,${shade})`; g.fillRect(0, 0, TILE, TILE); }
    g.restore();
  };
  tile(def.t[2], [1, 0.5, 0, 1, 0, 8], 0.22); // left face
  tile(def.t[2], [1, -0.5, 0, 1, 16, 16], 0.42); // right face
  tile(def.t[0], [1, 0.5, -1, 0.5, 16, 0], 0); // top face
  return c;
}
const iconCache = new Map(), urlCache = new Map();
export function iconCanvas(id) { // 32 x 32
  if (iconCache.has(id)) return iconCache.get(id);
  const it = ITEMS.get(id), c = mk(32, 32), g = c.getContext('2d');
  if (it && it.block) g.drawImage(blockIcon(it.block), 0, 0);
  else if (PACK.item[id]) { g.imageSmoothingEnabled = false; g.drawImage(PACK.item[id], 0, 0, PACK.item[id].width, PACK.item[id].width, 0, 0, 32, 32); }
  else {
    const gr = itemGrid(id);
    if (gr) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (gr[y][x]) { g.fillStyle = gr[y][x]; g.fillRect(x * 2, y * 2, 2, 2); }
  }
  iconCache.set(id, c);
  return c;
}
export const iconURL = (id) => { if (!urlCache.has(id)) urlCache.set(id, iconCanvas(id).toDataURL()); return urlCache.get(id); };

/* ---------- HUD icons (hearts, hunger, armor, air) ---------- */
const HUDT = {
  heart: ['.XX...XX.', 'XHXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'],
  food: ['......XXX', '.....XHXX', '....XXXXX', '...XXXXX.', '..XXXXX..', '.bXXXX...', 'bbbXX....', '.bb......'],
  armor: ['.XX...XX.', 'XHXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '.XXXXXXX.', '.XXXXXXX.', '..XXXXX..', '...XXX...'],
  bubble: ['..XXXXX..', '.XHHXXXX.', 'XHXXXXXXX', 'XHXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..'],
};
const HUDP = {
  heart: { X: '#e3222c', H: '#ff9a9f', e: '#3a2326' }, food: { X: '#b8742a', H: '#e8a85c', b: '#efe9d8', e: '#3a3226' },
  armor: { X: '#cfd3d7', H: '#ffffff', e: '#3a3a42' }, bubble: { X: '#43a8ff', H: '#d6f0ff', e: '#233a52' },
};
export const hudIcons = {};
(() => {
  for (const k of Object.keys(HUDT)) for (const state of ['full', 'half', 'empty']) {
    const rows = HUDT[k], c = mk(11, 11), g = c.getContext('2d'), pal = HUDP[k];
    const cells = rows.map((r) => [...r].map((ch, x) => {
      if (ch === '.') return null;
      if (state === 'full') return pal[ch] || pal.X;
      if (state === 'half') return x < 5 ? pal[ch] || pal.X : pal.e;
      return ch === 'b' ? pal.b : pal.e;
    }));
    const at = (x, y) => (cells[y] ? cells[y][x] : null);
    for (let y = -1; y <= rows.length; y++) for (let x = -1; x <= 9; x++) {
      const col = at(x, y);
      if (col) { g.fillStyle = col; g.fillRect(x + 1, y + 1, 1, 1); }
      else if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy))) { g.fillStyle = '#120d0a'; g.fillRect(x + 1, y + 1, 1, 1); }
    }
    hudIcons[`${k}-${state}`] = c.toDataURL();
  }
})();

/* ---------- mining cracks ---------- */
export const crackCanvas = mk(TILE * 10, TILE);
(() => {
  const g = crackCanvas.getContext('2d'); let s = 99;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const pts = [];
  for (let a = 0; a < 7; a++) {
    let x = 7.5 + (rnd() - 0.5) * 2, y = 7.5 + (rnd() - 0.5) * 2, ang = (a / 7) * 6.283 + rnd();
    for (let step = 0; step < 11; step++) { ang += (rnd() - 0.5) * 0.9; x += Math.cos(ang); y += Math.sin(ang); if (x < 0 || y < 0 || x >= 16 || y >= 16) break; pts.push([x | 0, y | 0, step + a * 0.15]); }
  }
  for (let st = 0; st < 10; st++) { g.fillStyle = 'rgba(10,8,6,0.78)'; for (const [x, y, b] of pts) if (b <= (st + 1) * 1.15) g.fillRect(st * TILE + x, y, 1, 1); }
  if (Array.from({ length: 10 }, (_, i) => PACK.block[`destroy_stage_${i}`]).every(Boolean)) { // the real crack frames
    g.clearRect(0, 0, TILE * 10, TILE); g.imageSmoothingEnabled = false;
    for (let st = 0; st < 10; st++) { const im = PACK.block[`destroy_stage_${st}`]; g.drawImage(im, 0, 0, im.width, im.width, st * TILE, 0, TILE, TILE); }
  }
})();
