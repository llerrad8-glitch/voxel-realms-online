// Storage for worlds, save codes and the Active Worlds list: local disk by default, Upstash Redis (REST) when configured.
// World files and their keys are unchanged from earlier versions, so existing worlds load exactly as before.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
export const DATA_DIR = env.DATA_DIR || path.join(ROOT, 'data');
const UP_URL = env.UPSTASH_REDIS_REST_URL, UP_TOKEN = env.UPSTASH_REDIS_REST_TOKEN;

async function upstash(cmd) {
  const r = await fetch(UP_URL, { method: 'POST', headers: { Authorization: `Bearer ${UP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `Upstash HTTP ${r.status}`);
  return j.result;
}
const fileFor = (id) => path.join(DATA_DIR, `${id.replace(/[^A-Z0-9]/g, '')}.json`);
// Save codes, player vaults and the live list live in their own folder, so they can never collide with a world file.
const metaFile = (key) => path.join(DATA_DIR, 'meta', `${String(key).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
async function writeAtomic(f, d) {
  await fs.promises.mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(d));
  await fs.promises.rename(tmp, f); // atomic: a crash never leaves a half-written file
}
const readJSON = async (f) => { try { return JSON.parse(await fs.promises.readFile(f, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

export const store = UP_URL && UP_TOKEN
  ? {
    kind: 'upstash-redis',
    load: async (id) => { const v = await upstash(['GET', `vr:world:${id}`]); return v ? JSON.parse(v) : null; },
    save: (id, d) => upstash(['SET', `vr:world:${id}`, JSON.stringify(d)]),
    getJSON: async (k) => { const v = await upstash(['GET', `vr:${k}`]); return v ? JSON.parse(v) : null; },
    setJSON: (k, d) => upstash(['SET', `vr:${k}`, JSON.stringify(d)]),
    delJSON: (k) => upstash(['DEL', `vr:${k}`]),
    deleteWorld: (id) => upstash(['DEL', `vr:world:${id}`]),
    listWorldIds: async () => { // every stored world id (Upstash SCAN)
      const ids = []; let cur = '0';
      do { const [next, keys] = await upstash(['SCAN', cur, 'MATCH', 'vr:world:*', 'COUNT', 500]); cur = String(next); for (const k of keys) ids.push(k.slice('vr:world:'.length)); } while (cur !== '0');
      return ids;
    },
  }
  : {
    kind: 'disk',
    load: (id) => readJSON(fileFor(id)),
    save: (id, d) => writeAtomic(fileFor(id), d),
    getJSON: (k) => readJSON(metaFile(k)),
    setJSON: (k, d) => writeAtomic(metaFile(k), d),
    delJSON: async (k) => { try { await fs.promises.unlink(metaFile(k)); } catch (e) { if (e.code !== 'ENOENT') throw e; } },
    deleteWorld: async (id) => { try { await fs.promises.unlink(fileFor(id)); } catch (e) { if (e.code !== 'ENOENT') throw e; } },
    listWorldIds: async () => { // every stored world id (the JSON files in the data folder itself)
      try { return (await fs.promises.readdir(DATA_DIR)).filter((f) => /^[A-Z0-9]{1,10}\.json$/.test(f)).map((f) => f.slice(0, -5)); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    },
  };
