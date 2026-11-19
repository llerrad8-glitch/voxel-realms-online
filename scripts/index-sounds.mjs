// Sets up real animal sounds for the creatures.
//
//   npm run sounds                      lists the recordings in public/sounds and rewrites public/sounds/manifest.json
//   npm run sounds -- ~/Downloads/sfx   first copies matching recordings out of that folder (renaming them), then does the above
//
// A recording is a file in public/sounds named  <creature>_<event>[_number].<mp3|ogg|wav|m4a>,  for example
//   cow_idle.mp3   cow_hurt.mp3   cow_hurt_2.mp3   wolf_attack.wav   boomer_boom.ogg
// Creatures: pig cow sheep chicken rabbit wolf zombie skeleton spider boomer slime salmon.
// Events: idle (now and then), hurt (when hit), death, attack, shoot (skeleton), burn, hop (slime), flop (salmon on land), boom (boomer explosion).
// Several files with the same creature and event are picked at random. Anything without a recording keeps its built-in synthesised sound,
// and a death without its own recording reuses the hurt recording (lower and slower).
//
// The importer knows the exact titles of a few free Mixkit sounds (https://mixkit.co/free-sound-effects/animals/) and renames them for you;
// it needs no internet access. Check the Mixkit licence (https://mixkit.co/license/) before you publish a site that serves the files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOB_TYPES } from '../public/shared/mobs.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sounds');
const EXT = new Set(['.mp3', '.ogg', '.wav', '.m4a']);
const EVENTS = ['idle', 'hurt', 'death', 'attack', 'shoot', 'burn', 'hop', 'flop', 'boom'];
const NAME = /^([a-z]+)_([a-z]+?)(?:_?(\d+))?$/;
// Mixkit sound title (as a slug) -> the file name this game wants. Add your own lines for other sounds you download.
const MIXKIT = {
  'cow-moo-in-the-barn': 'cow_idle', 'cow-moo': 'cow_idle_2', 'cow-single-moo': 'cow_hurt', 'cow-dry-moo': 'cow_hurt_2', 'cow-sick-moo': 'cow_death',
  'sheep-sounds': 'sheep_idle', 'farm-goat-baa': 'sheep_hurt', 'goat-single-baa': 'sheep_hurt_2', 'goat-baa-stutter': 'sheep_death',
  'chickens-clucking-short': 'chicken_idle', 'chickens-crying': 'chicken_hurt',
  'wolf-howling': 'wolf_idle', 'wolf-attack': 'wolf_attack',
};
const slug = (f) => path.basename(f, path.extname(f)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^mixkit-/, '').replace(/-\d+$/, '');

fs.mkdirSync(OUT, { recursive: true });
const src = process.argv[2];
if (src) {
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) { console.error(`"${src}" is not a folder.`); process.exit(1); }
  const walk = (d, depth = 0) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (depth < 2 ? walk(path.join(d, e.name), depth + 1) : []) : [path.join(d, e.name)]));
  let copied = 0; const skipped = [];
  for (const f of walk(src)) {
    const ext = path.extname(f).toLowerCase(); if (!EXT.has(ext)) continue;
    const base = path.basename(f, ext).toLowerCase(), target = MIXKIT[slug(f)] || (NAME.test(base) ? base : null);
    if (!target) { skipped.push(path.basename(f)); continue; }
    fs.copyFileSync(f, path.join(OUT, target + ext)); copied++; console.log(`  ${path.basename(f)}  ->  ${target}${ext}`);
  }
  console.log(`Copied ${copied} recording${copied === 1 ? '' : 's'}.`);
  if (skipped.length) console.log(`Not recognised (rename them to <creature>_<event>.<ext> to use them):\n  ${skipped.join('\n  ')}`);
}

const manifest = {}, bad = [];
for (const f of fs.readdirSync(OUT).sort()) {
  const ext = path.extname(f).toLowerCase(); if (!EXT.has(ext)) continue;
  const m = NAME.exec(path.basename(f, ext).toLowerCase());
  if (!m || !MOB_TYPES.includes(m[1]) || !EVENTS.includes(m[2])) { bad.push(f); continue; }
  (manifest[`${m[1]}_${m[2]}`] ||= []).push(f);
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const total = Object.values(manifest).reduce((n, l) => n + l.length, 0);
console.log(`\npublic/sounds/manifest.json lists ${total} recording${total === 1 ? '' : 's'}:`);
for (const t of MOB_TYPES) {
  const have = EVENTS.filter((e) => manifest[`${t}_${e}`]).map((e) => `${e}${manifest[`${t}_${e}`].length > 1 ? ` x${manifest[`${t}_${e}`].length}` : ''}`);
  console.log(`  ${t.padEnd(9)} ${have.length ? have.join(', ') : '(built-in sounds)'}`);
}
if (bad.length) console.log(`\nIgnored (name is not <creature>_<event>[_number].<ext>):\n  ${bad.join('\n  ')}`);
console.log('\nDeploy as usual (netlify deploy --prod) so the files go online with the site.');
