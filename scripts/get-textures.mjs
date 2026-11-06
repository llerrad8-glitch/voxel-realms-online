// Fetches the real Minecraft textures and unpacks the ones this game uses into public/textures.
//
//   npm run textures                  downloads Minecraft 1.13.2 from Mojang's servers (the same free download the official launcher uses).
//                                     1.13.2 is the last version with the classic, pre-1.14 textures, which is what this game is drawn with.
//   npm run textures -- 1.12.2        another version (anything from 1.13 on has the same file layout; use 'latest' for the newest release)
//   npm run textures -- my-pack.zip   any resource pack or client .jar you already have (the standard assets/minecraft/textures layout)
//
// Run it once on your own computer (it needs internet access), then deploy as usual. Textures that are missing from the source are skipped
// and the game keeps its built-in art for them. The textures belong to Mojang / the pack's author: check the licence before publishing a site that serves them.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { BLOCK_FILES, ITEM_FILE, ENV_FILES, GUI_FILES, ENTITY_FILES, TEXTURE_VERSION } from '../public/shared/texture-files.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'textures');
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

async function get(url, buffer) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} answered HTTP ${r.status}`);
  return buffer ? Buffer.from(await r.arrayBuffer()) : r.json();
}

function readZip(buf) { // minimal zip reader (central directory + raw deflate), so no dependencies are needed
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('That file is not a zip or jar archive.');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Damaged zip directory.');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    files.set(buf.toString('utf8', p + 46, p + 46 + nl), { method, size, off });
    p += 46 + nl + xl + cl;
  }
  return files;
}
function extract(buf, f) {
  const nl = buf.readUInt16LE(f.off + 26), xl = buf.readUInt16LE(f.off + 28), start = f.off + 30 + nl + xl, data = buf.subarray(start, start + f.size);
  return f.method === 0 ? data : zlib.inflateRawSync(data);
}

const arg = process.argv[2];
let jar, label;
if (arg && /\.(zip|jar)$/i.test(arg) && fs.existsSync(arg)) { jar = fs.readFileSync(arg); label = arg; }
else {
  const manifest = await get(MANIFEST), id = !arg ? TEXTURE_VERSION : arg === 'latest' ? manifest.latest.release : arg, v = manifest.versions.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown Minecraft version "${id}". Try one like 1.13.2.`);
  const meta = await get(v.url);
  console.log(`Downloading Minecraft ${id} from Mojang (about 25 MB)...`);
  jar = await get(meta.downloads.client.url, true); label = `Minecraft ${id}`;
}
const zip = readZip(jar);
let saved = 0; const missing = [];
const save = (paths, dest) => {
  for (const p of paths) {
    const f = zip.get(`assets/minecraft/textures/${p}.png`);
    if (f) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, extract(jar, f)); saved++; return; }
  }
  missing.push(path.basename(dest));
};
for (const n of BLOCK_FILES) save([`block/${n}`], path.join(OUT, 'block', `${n}.png`));
for (const n of new Set(Object.values(ITEM_FILE))) save([`item/${n}`], path.join(OUT, 'item', `${n}.png`));
for (const p of GUI_FILES) save([p], path.join(OUT, `${p}.png`));
for (const [, p] of ENTITY_FILES) save([p], path.join(OUT, `${p}.png`));
for (const [key, paths] of ENV_FILES) save(paths, path.join(OUT, 'environment', `${key === 'moon' ? 'moon_phases' : key}.png`));
console.log(`Saved ${saved} textures from ${label} into public/textures.`);
if (missing.length) console.log(`Not found (the game keeps its built-in art for these): ${missing.join(', ')}`);
