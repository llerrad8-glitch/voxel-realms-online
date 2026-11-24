# Voxel Craft

A multiplayer survival sandbox for the browser. Everyone in a world sees the same terrain, the same blocks, the same creatures and each other, live.

## How it fits together

| Part | Where it runs | What it does |
| --- | --- | --- |
| `public/` | **Netlify** (static) | The game: Three.js client, menus, shared terrain generator |
| `netlify/functions/config.mjs` | **Netlify Function** | Tells the page which game server to use (`GAME_SERVER_URL`) |
| `server/index.js` | **Any always-on Node.js host** | The live worlds: WebSocket rooms, rules, saving |

Netlify Functions are short-lived and cannot hold a WebSocket open, so the live world cannot run on Netlify itself. The page loads from Netlify and the browser then connects straight to the Node server over `wss://`. The server is plain Node.js (one dependency, `ws`).

Terrain is never sent over the network. The browser and the server both generate it from the world seed (`public/shared/world.js`); only player edits travel and get saved.

## Run it on your computer

```bash
npm install
npm start
```

Open http://localhost:3000 in two browser tabs (use different names), pick **Play public world**, and you will see each other. The Node server also serves the site locally, so no Netlify is needed for this step.

## Put it online

### 1. The game server (example: Render)

Any host that runs a long-lived Node process works (Render, Railway, Fly.io, a VPS...). With Render:

1. Push this folder to a GitHub repository.
2. In Render choose **New > Web Service**, pick the repository, runtime **Node**.
3. Build command `npm install`, start command `npm start`, health check path `/health`.
4. Add the environment variable `ALLOWED_ORIGINS` set to your Netlify address, for example `https://your-site.netlify.app` (comma-separate extra addresses such as a custom domain).
5. Deploy and copy the service URL, for example `https://voxel-realms.onrender.com`.

Render's free instance type sleeps after 15 minutes without traffic and takes about a minute to wake, may restart at any time, and has a disk that is wiped on every restart or deploy. The game handles the sleeping (the title screen says it is waking the server, and the game reconnects by itself), but for worlds that survive restarts see **Saving worlds** below.

### 2. The website (Netlify)

1. In Netlify choose **Add new site > Import an existing project** and pick the same repository. `netlify.toml` already sets publish folder `public` and the functions folder; leave the build command empty.
2. Under **Site configuration > Environment variables** add `GAME_SERVER_URL` with the game server address you copied in the previous section.
3. Trigger a new deploy (environment changes apply to new deploys). Open your Netlify address and press **Play public world**.

No environment variable yet? Open the site once with `?server=https://your-game-server` on the end and the browser remembers it.

### 3. Updating later without changing the URL

Keep using the same Netlify site. With Git, push to the connected branch and Netlify redeploys to the same address. With the Netlify CLI, run `netlify link` once in this folder and then `netlify deploy --prod`. Never create a new site for an update, because a new site gets a new address. The game server updates the same way on its own host; players reconnect on their own.

## Phones and tablets

Voxel Craft works on touch screens. The game notices a touch screen by itself and shows touch controls instead of the keyboard help (`public/touch.js`): **drag on the left half** for a floating joystick (push it to the edge to sprint); **drag on the right half** to look; **tap** to place or use; **press and hold** without moving to mine or attack (you can keep turning while you hold); **JUMP**, **USE** (hold it to eat, draw a bow or block), **SNEAK** and, in creative, **FLY** buttons; tap a hotbar slot to hold it; **BAG**, **CHAT**, **SAVE** and **☰** (pause menu) along the top. With the bag open, **SPLIT** turns your next tap into a right click (take half a stack, drop one) and **CLOSE** closes it. The first Play goes fullscreen in landscape where the browser allows it. Landscape is the best way to play.

## Sound

`public/audio.js` handles all sound. **Music:** `public/sunset.mp3` plays during sunsets: each sunset has a 75% chance of having the song, and when it does it fades in whenever you are outside (open sky above you, not underwater), wherever you look, and once it starts it plays to the end (going indoors or underground does not cut it off). The sunset song also plays on the home screen and fades out when you join a world. Every song, once started, finishes; only the Music switch stops it early. The songs in `public/music/` play at random times, one at a time and never over the sunset song, with a quiet gap of one to four minutes between songs: *Floating Trees* only on the surface, *Deep Underground* only underground (caves and tunnels well below the natural ground) where it is the most likely song, and *Safe* and *Minecart Memories* anywhere. To add a song, drop the mp3 into `public/music/` and add a line to `TRACKS` in `public/audio.js` (`where` is `surface`, `underground` or `any`; `weight` is how likely it is). One **Music** switch in the pause menu turns all of it off. Creature sounds (idle, hurt, death, plus special ones such as the boomer's explosion, skeleton bow, slime hops) come from **real recordings when you install them** (next section) and from sounds generated in the browser for anything that has no recording, so the game is never silent. Both kinds can be switched on or off with the **Sunset music** and **Creature sounds** buttons in the pause menu; the choice is remembered.

### Real animal sounds

Recordings live in `public/sounds/` and are named `<creature>_<event>[_number].<mp3|ogg|wav|m4a>`, for example `cow_idle.mp3`, `cow_hurt_2.ogg`, `wolf_attack.wav`.

- Creatures: pig, cow, sheep, chicken, rabbit, wolf, zombie, skeleton, spider, boomer, slime, salmon.
- Events: `idle` (every so often), `hurt`, `death`, `attack`, `shoot` (skeleton), `burn`, `hop` (slime), `flop` (salmon on land), `boom` (boomer explosion).
- Several files with the same creature and event are picked at random. A death with no recording of its own reuses the hurt recording, lower and slower. Long recordings are faded out after 4 seconds. Loudness is levelled automatically. Distance and left/right panning still apply.

**To install:** download free game-ready sounds, for example from Mixkit's animal sounds (https://mixkit.co/free-sound-effects/animals/, free for games under the Mixkit License, check https://mixkit.co/license/), put them in one folder and run

```bash
npm run sounds -- ~/Downloads/animal-sounds
```

The script copies what it recognises into `public/sounds/` (renaming it) and rewrites `public/sounds/manifest.json`. It recognises these Mixkit titles by name: *Cow moo in the barn*, *Cow moo*, *Cow single moo*, *Cow dry moo*, *Cow sick moo* (cow), *Sheep sounds*, *Farm goat baa*, *Goat single baa*, *Goat baa stutter* (sheep), *Chickens clucking short*, *Chickens crying* (chicken), *Wolf howling*, *Wolf attack* (wolf). For anything else, rename the file yourself to the pattern above (a pig, for instance: browse https://mixkit.co/free-sound-effects/pig/ and save a good grunt as `pig_idle.wav`, a squeal as `pig_hurt.wav`), put it in `public/sounds/` and run `npm run sounds` with no folder. It prints which creatures have recordings and which still use the built-in sounds. Then deploy as usual so the files go online with the site. Without any files the game keeps working with the built-in sounds.

## Saving worlds

Worlds are saved shortly after every change, on shutdown, and the HUD shows **World saved** or **Could not save, retrying**; it never claims a save that failed.

- **Free hosts with a wiped disk:** create a free Redis database at Upstash, then set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` on the game server. Worlds are then stored there (the server uses Upstash's REST API). Each world is one stored value, so a very large world can hit your plan's size limit; the HUD will show the failed save.
- **Host with a persistent disk or volume:** set `DATA_DIR` to its mount path, for example `/var/data`.
- **Neither:** worlds are written to `./data` and last only as long as that disk does.

## Saving your game: export it

Voxel Craft has no accounts and no save codes. **Your game is saved by exporting it**: the **Save Game** button on the home screen and in the pause menu (or the **U** key in a world) downloads one `.vrworld` file with everything in it. The server can lose its data (free hosts wipe their disks); that file cannot. Importing it on any server, even a brand-new one, puts everything back.

**The game nags you to save, on purpose.** While you play, a pill at the top of the screen shows when you last saved and turns amber, then red and pulsing as unsaved play adds up; a big red banner appears; a pop-up asks you to save every few minutes (sooner if you have never saved); the browser tab title flashes; the home screen shows a red or green save strip; Leave world offers to save first; and closing the tab with unsaved progress asks you to confirm. Time only counts while you are in a world, and the count survives closing the page. The timings are in `public/reminder.js`.

**Your worlds.** The home screen lists the worlds you created as cards with the world's name and a picture of what you were looking at when you last left (a small image the game captures from your screen and sends to the server; only the world's host can set it). Click a card to play it. The list is looked up by your browser's secret identity, so each browser only sees its own worlds; importing a game file brings them back.

**Chunk Saver.** Craft it with one diamond in the middle of the 3 x 3 grid and eight stone (smelted cobblestone, not cobblestone itself) around it. Placing it asks for a name, claims the whole 16 x 16 chunk (all heights) and saves every block and every chest, furnace and their contents. You can keep three saved chunks; the limit is enforced by the server. The chunk shows a see-through border (green for yours, red for others'). Other players cannot place, break, open chests or furnaces, sleep in beds or pour water there, and explosions and flowing water from outside leave it alone. The server enforces this on every action, including inventory clicks in a chest opened before the claim. To pick up your Chunk Saver, hold Shift while mining it: that releases the chunk and frees the slot. **Release** in **Saved chunks** does the same without mining. A host of a private world can free a claim that is in the way with `/unclaim` while standing in it. The chunks around the world spawn (the 3 x 3 chunks centred on it; `SPAWN_CLAIM_RADIUS` changes it, 0 for the spawn chunk only) can never be claimed.

**Chunk Savers need survival worlds.** They work only where creative mode and cheats have never been used (`cheated` is remembered with the world), so nothing can be made from nothing and carried into another world. A host cannot switch a world with protected chunks to creative or cheats.

**Using a saved chunk in another world.** Your saved chunks belong to your browser's identity and travel in your game file. In **Saved chunks** press **Restore here**: the chunk goes to its original coordinates if nothing is built or claimed there. If that spot is claimed or built on you are asked whether to place it somewhere else; **Yes** puts a **Place** button (key P) on the side of the screen, walk to a free chunk and press it. A chunk is only ever placed on untouched ground, so it never overwrites anyone's builds. Restoring *moves* the chunk: it leaves the world it was in, taking its chests with it, so nothing is duplicated.

**Hosting.** Whoever creates a private world is its host (kept when they leave and rejoin). **World settings** in the pause menu (or chat commands `/mode`, `/pvp`, `/cheats`, `/live`, `/build`, `/chests`, `/rename`) change game mode, PvP, cheats, whether visitors can build or open chests, the world name and whether it is live. Regular players do not see these controls. The public world is always survival and nobody can change it, with commands or otherwise.

**Active Worlds.** The home screen button lists worlds whose hosts switched **Make this world live** on. They are listed even when empty and disappear the moment the host switches it off. The list is served by the game server at `/api/worlds`.

## The .vrworld file

**Save Game (export)** downloads one `.vrworld` file. It contains: every world you own (seed, name, settings, permissions, every changed block, chests, furnaces, banned list, the progress of every player in it, chunk claims, the picture, the live flag), your three saved chunks with every block and chest inside, your progress (items, position, bed) in worlds you only visit, such as the public one, and your name and options from this browser. The export is one consistent snapshot, built, read back and checked on the server, then checked again in your browser before it is saved.

**Import Game Save** restores it, on this server or on a brand-new one. The whole file is checked first and nothing changes until you press Import. You see exactly what will be added, what already exists (you tick the ones you want to replace; unticked ones are kept), and anything that cannot be imported and why. Anything replaced is backed up first (a `.vrworld` you can download, also saved in `DATA_DIR/backups`), everything is read back from storage to verify, and if any step fails the whole import is undone.

**Needs no outside storage.** The file carries everything. A fresh server with no Upstash, Redis or disk history restores it, Ownership moves to the browser doing the import, so you own your worlds again even from a new browser. A world code that another player owns on the target server is never overwritten: yours is added as a separate copy with a new code.

**What is not in the file, on purpose:** the blocks of worlds owned by other people (including the public world) are theirs, so only *your* progress in them is saved; other players' saved-chunk slots (they export their own game); display names of other players (the game stores only anonymous ids).

**Safety.** The file is only ever parsed as data, never run. Every value is checked and copied into a clean object (block ids, heights, items, stack sizes, coordinates, ids, sizes), a compressed file may not expand past `4 x SAVE_MAX_MB`, and anything dropped or reduced is listed rather than ignored. A SHA-256 over the whole file detects corruption, truncation and edits. **A checksum cannot stop someone who rebuilds a file by hand**, so set `SAVE_SIGNING_KEY` (any long secret) on your server: files are then signed with it, and a file that was edited, or made by a server with a different key, is refused. Keep that key somewhere safe; a new server needs the same key to read signed files. Without a key, any valid-looking file is accepted, so only import files you made yourself.

**Format.** `VRWORLD\0`, format version (uint16), header length, a readable JSON header (counts, world list, notes, SHA-256 of the data), gzip-compressed JSON data, a SHA-256 of everything before it, and an HMAC if signed. Unknown or newer versions are refused with a clear message; older versions are converted by the `MIGRATE` table in `server/vrworld.js` (format 2 is current; format 1 files, made when save codes existed, keep their saved chunks and claims, but not the inventory a save code held). Worlds written by earlier game versions load as before.

**Limits.** `SAVE_MAX_MB` (default 100) is the largest compressed file; the data may expand to `4 x` that. At most 60 worlds and 1,000,000 changed blocks per world. A 372,000-block world exports in about a second to roughly 1 MB; the game keeps running while it does. Export and import are rate-limited per address (`SAVE_RATE_PER_MIN`, default 6).

## Environment variables

| Variable | Where | Default | Meaning |
| --- | --- | --- | --- |
| `GAME_SERVER_URL` | Netlify | none | Public address of the game server |
| `PORT` | game server | `3000` | Port (most hosts set this for you) |
| `ALLOWED_ORIGINS` | game server | any | Websites allowed to connect, comma-separated |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | game server | none | Store worlds in Upstash Redis |
| `DATA_DIR` | game server | `./data` | Folder for saved worlds on disk |
| `MAX_PLAYERS` | game server | `16` | Players per world |
| `MAX_EDITS` | game server | `200000` | Most changed blocks per world |
| `DAY_MINUTES` | game server | `12` | Length of a day-night cycle in real minutes |
| `SAVE_SIGNING_KEY` | game server | none | Secret that signs `.vrworld` files and refuses edited or foreign ones (keep it safe) |
| `SAVE_MAX_MB` | game server | `100` | Largest compressed `.vrworld` file |
| `SAVE_RATE_PER_MIN` | game server | `6` | Game Save exports/imports allowed per minute per address |
| `SPAWN_CLAIM_RADIUS` | game server | `1` | Chunks around spawn that cannot be claimed (0 = spawn chunk only) |

Nothing secret goes into the browser or into Netlify: the only value the page learns is the public server address. Copy `.env.example` for a checklist; never commit a real `.env`.

## Real Minecraft textures (the classic, pre-1.14 look)

The game draws its own blocks and items in code, so it works with no image files. To use the real classic textures instead, run this once on your own computer (it needs internet access; the game's folder is the working directory):

```bash
npm run textures
```

That downloads **Minecraft 1.13.2** from Mojang's own servers (about 25 MB, the same free download the official launcher makes). 1.13.2 is the last version before the 1.14 texture overhaul, so it has the old textures. The script pulls out only the textures this game uses into `public/textures/` and throws the rest away. Use another version with `npm run textures -- 1.12.2`, or a client `.jar` or resource pack you already downloaded with `npm run textures -- my-pack.zip` (any pack in the standard `assets/minecraft/textures` layout works; 16x16 looks best). Deploy afterwards as usual. Anything missing from the source keeps the built-in art, and without `public/textures/block/stone.png` the game does not look for textures at all.

What the real textures cover: every block face (grass and leaves are tinted green the way the plains are in the real game), every item, tool, armor and food icon (salmon too), the buckets, still and flowing water, the mining crack frames, the chest, the health, hunger, armor and air icons, and the sun and moon. Creature and player models are still the game's own blocky designs, because the real ones need the real models, not just their skins.

The textures belong to Mojang or to the pack's author. Check the licence before you publish a site that serves them to other people.

## Playing

| Key | Action |
| --- | --- |
| W A S D, Space | Move, jump (Space also swims up) |
| Double-tap W | Sprint: keep W held (needs food above 3 hearts of hunger); letting go of W, sneaking or stopping ends it |
| Shift (hold) | Sneak: slower, lower view, and you cannot walk off the edge of a block; descend while flying in creative |
| C (hold) | Crawl: 0.6 blocks tall, fits through a one block gap |
| Hold left click | Mine the block under the crosshair (cracks appear, chips fly) or hit a creature or player |
| Right click | Place a block or torch, open a crafting table, furnace or chest, use a bed, eat (hold), draw a bow (hold, release to shoot), scoop up or pour out water with a bucket, raise a shield from the off-hand slot (hold) |
| 1-9 or wheel | Pick a hotbar slot |
| E | Inventory (Esc or E closes it) |
| Q, Ctrl+Q | Drop one item, drop the whole stack |
| F | Fly on or off (creative worlds only) |
| R | Respawn at the world spawn (also fixes being stuck; limited to once every 8 seconds) |
| Enter | Chat (`/help`, `/who`; owners also get `/kick name` and `/ban name`) |

**Public world** is always available (survival, PvP on). **Create a private world** makes a six-character code to share; the creator is its owner and chooses survival or creative, PvP on or off, and whether cheats are allowed. With cheats on, the owner can type `/give diamond_pickaxe 1`, `/spawn zombie`, `/heal`.

## Survival

- **Health and hunger** like the real game: 10 hearts, 10 drumsticks, regeneration when well fed, starvation, fall damage, drowning, suffocation, armor that cuts damage and wears out.
- **Mining** uses real hardness and tool rules. Stone needs a pickaxe to drop anything, iron ore needs a stone pickaxe, gold and diamond need an iron pickaxe, axes are fast on wood, shovels on dirt. Wooden, stone, iron, golden and diamond tools, swords and armor, plus a bow and arrows.
- **Inventory** with 27 backpack slots, a 9-slot hotbar, 4 armor slots, a 2x2 crafting grid, left click to pick up and drop, right click to split or place one, shift-click to move stacks fast. Crafting table (3x3), furnace (fuel, smelting progress), and chests all work. The server runs every click, so items cannot be duplicated.
- **Caves** wind through the ground and open onto hillsides and into the grass, with ore veins (coal, iron, gold, diamond) and gravel pockets. Deep faces get darker, so caves feel like caves.
- **Twelve creatures:** pig, cow, sheep, chicken, rabbit, wolf (fights back if hit), zombie (burns in daylight), skeleton (shoots arrows), spider (leaps), boomer (swells and explodes, breaking blocks), slime (big ones split), and **salmon**, which live in natural water (the sea and lakes deep enough to swim in). They swim in small schools, never leave the water by themselves, speed off when hurt, and flop around and suffocate on land. They drop raw salmon (restores 2 hunger), which you can cook in a furnace into cooked salmon (6 hunger), and now and then a bone. All are original voxel designs, each with painted skins (cow spots, fluffy wool, mottled boomer hide, ripped zombie clothes) and little animations such as ear twitches and tail swishes. Animals spawn on grass in the day; monsters spawn at night and in the dark underground.
- **PvP** with knockback, armor, arrows and critical hits when falling. Dying scatters your items; respawn from the death screen.
- Day and night with a sun, a moon and stars, shared by everyone in the world.

## Terrain, lava, lighting and combat (update 13)

- **Terrain generation 2.** New worlds get mountain ranges with snow caps and bare rock, winding rivers, deeper seas, and caves that cut through sea floors, river beds and beaches (water pours into them as waterfalls or floods their mouths). Every world remembers which generation made it (`gen` in the save), so older worlds keep exactly the terrain they had; create a new world to see the new terrain.
- **Lava.** Pockets of lava deep in the rock, lava lakes in the big caves, and occasional pools on flat ground. In **new worlds (terrain generation 3)** surface pools are about five times rarer and sit one block below the ground with a stone rim, cave lava lakes stand at different heights so lava steps down between them, and lava springs sit in cave walls and run down into the caves as lavafalls. Worlds made earlier keep their old lava. Lava takes a step every half second, reaches 3 blocks, heads for a drop if there is one, falls as a column, drains when its source goes, turns to obsidian where it meets still water and to cobblestone where it meets flowing water, and its surface now slopes smoothly instead of stepping.
- **Natural water and lava flow by themselves.** The server looks at the land around every player and sets any generated water or lava that has open air beside or under it running straight away (waterfalls from rivers into caves, lavafalls, lake edges), so nothing has to be touched first. It happens in every world, old or new, as areas come near a player.
- **Falling sand and gravel** are now falling blocks with gravity and an animation instead of teleporting down.
- **Lighting.** Sky light is a real flood fill from the open sky: cave mouths glow, deep caves are nearly black, nights are dark and blue, and light fades smoothly across faces. Torches and lava give warm light that does not fade at night. Underground the fog turns dark and short.
- **Combat like Java.** Swinging recharges over the weapon's cooldown (shown as a small bar under the crosshair); a half-charged hit does far less damage. Critical hits (falling, fully charged, not sprinting, not in water) do 1.5x. Sword 4 to 7 damage, axe 7 to 9 but a slower recharge. Holding the button repeats at full charge; clicking always swings.
- **Fall damage** starts at a 4 block fall. **Hostile creatures** do not spawn by day except in dark, deep parts of caves, and never near torches or lava; boomers (creepers) are much rarer by day (about a tenth as many on open ground). A boomer lights its fuse when you come within **2 blocks** and keeps counting down until you are **more than 6 blocks** away.
- **Crafting.** Click a recipe in the recipe book again and again to lay out more sets (up to a full stack of the result), then take the result from the output slot repeatedly.

## Water, buckets, swimming and suffocation

- **Water behaves like the real game.** A source block feeds the four blocks around it, each one a little thinner, up to 7 blocks away. Water over air falls as a full-height column, spreads where it lands, and heads for the nearest drop. Two source blocks next to a gap with a solid or water floor make a new source (infinite water). Take the source away and the flow drains block by block. Steps run four times a second on the server, so everyone sees the same flood, and every step has a budget so a big flood never slows the world. Water surfaces slope smoothly between levels. **Still water** (calm pools, source blocks, lakes, the sea, and the sides of all of those) uses the calm water picture; only **slanted flowing water and waterfalls** use the flowing picture, and it is turned so the pattern runs the way the water is flowing (downhill, toward a drop, straight down for waterfalls). Flowing water also carries you and dropped items along with it, and **dropped items float**: they rise to the surface and bob there instead of sinking.
- **Buckets.** Craft one from three iron ingots in a V (`I I` over ` I `). Right click a water source with an empty bucket to scoop it up (flowing water cannot be picked up, same as the real game); right click a block with a full bucket to pour a new source against it. Creative worlds do not use up or fill buckets.
- **Sprinting in water switches to crawl-swimming**: your body lies flat (0.6 blocks tall), you swim faster, and you move the way you look. If a one block gap is too low to stand in, you stay crawling for as long as you are inside it, even after you stop sprinting or leave the water.
- **Suffocation.** Nothing pushes you out of blocks any more. If any part of your body is inside a block (sand landing on you, a block placed on you) you take half a heart every half second, armor does not help, and the screen goes dark while your head is inside one. Mine or walk your way out.

## Torches, beds, shields and the recipe book

- **Torches** (1 coal over 1 stick makes 4): put one on top of a block or on the side of one (never a ceiling). They give real light: it spreads 14 blocks, fades with distance, and is stopped by solid blocks, so a torch lights its own tunnel and not the rock around it. The glow is warm and is still bright at night. A torch breaks and drops itself when the block it hangs on is removed, and mining one is instant.
- **Beds** (3 wool over 3 planks): a bed is two blocks long and points the way you were facing when you placed it; it needs air and solid floor under both halves. Right click it to set your respawn point (works any time of day); right click at night, with no monsters within 8 blocks, to go to bed. The screen fades, other players see you lying down, and when everyone in the world is asleep the night is skipped and everyone wakes up. Press W, A, S, D, Space or Shift to get up early; taking damage also wakes you. If your bed is gone when you die, you come back at the world spawn. A bed is 9/16 of a block tall, so you can stand on it and it does not block a full block of space. Breaking either half gives back one bed.
- **Shields** (6 planks and 1 iron ingot): put one in the new **off-hand slot** (under the armor slots in the inventory screen, or shift-click it). Hold **right click** to raise it, as long as the item in your hand is not something right click already does (a block, food, a bow, a bucket, a bed or a torch), so a sword or an empty hand works. While it is up it stops melee hits, arrows and other players' hits that come from the front (not explosions, and not hits from behind), and it wears down with the damage it takes (336 durability) until it breaks. Other players see your shield on your left arm.
- **Recipe book.** Open your inventory (E) or a crafting table: a Recipes panel sits beside it. It lists what you can make right now with a green frame, first; hover any recipe to see its ingredients and which ones you are missing, and press **Show all** to see every recipe. Click a green recipe and the ingredients are laid out in the crafting grid for you (and whatever was in the grid goes back to your inventory); then take the result. Recipes that need a crafting table are dimmed in the small inventory grid.
- **The bow** has a proper animation now: the limbs flex as you draw, the string runs from the tips to your hand and slides back smoothly while the arrow slides along it, it holds with a tiny tremble at full draw (about a second), and on release the string snaps home and hums for a moment.

## What the server checks

Everything that matters is decided on the server: mining time (you must dig long enough), reach, what you hold, placing rules, every inventory click, crafting results, damage, hunger, fall and drowning damage, arrows, creature behavior, item pick-up, container contents. It also checks movement speed (a budget that refills at roughly top speed), message sizes (4 KB), message rates, connections per address, and chat length. Chat is shown as plain text only, never as HTML.

Limits worth knowing: players are guests identified by a token kept in the browser, so a ban can be dodged by clearing site data; there are no accounts yet. The server checks movement speed but not collisions, so a hacked client could walk through walls or fly in survival. Every player in a world receives every block update (fine for 16 players). Run the server behind HTTPS (hosts like Render provide it) so the browser uses `wss://`.

**Updating an existing world:** terrain is regenerated from the seed, so old worlds gain caves and ores; blocks you built or removed are kept. Worlds saved by the earlier version become survival worlds.

## Not built yet

The Nether, the End, portals and the boss; villages and structures; farming; experience and enchanting; sound; torches and real lighting (caves are dim, not dark); touch controls; accounts (save codes are a first step: they carry items and chunks, not identity). The block, item and creature tables (`public/shared/`) and the server modules (`server/`) were built so these can be added one system at a time.

## Update 17: autosave

- The game saves itself every 10 seconds while you are in a world (and once more just after you leave). No warnings, banners or pop-ups.
- Each save replaces the previous one. A copy is kept inside the browser; on the next visit, anything the server has lost is put back automatically (it never overwrites what is still there).
- Desktop Chrome/Edge: press U once and pick a file; every autosave then overwrites that same file. Other browsers cannot overwrite files, so U / SAVE downloads one.
- Creepers are much rarer by day. On touch, a quick tap on a mob or player hits it (no holding).
- `SAVE_RATE_PER_MIN` now defaults to 20 so autosaves never hit the limit.

## Update 18: biomes, weather, layers, music

- **New worlds (generation 4)** get a vast desert (dunes, cactus, dead bushes, stone outcrops) and a cold biome (snow-covered grass, spruce trees). Worlds made before this update keep their old terrain exactly (changing it would break builds), so create a new world to see the biomes.
- **Weather** (all worlds): rain in the temperate land, a snowstorm in the cold biome, a sandstorm in the desert. Owner with cheats on: `/weather storm` or `/weather clear`.
- **Layers** (generation 4 worlds): sand layers, loose snow layers (both fall like sand and add up when they land on their own kind) and packed snow layers (they stay put; loose snow settles into packed snow after a storm). Snowstorms build snow up to 6/8 of a block; sandstorms build sand only against higher ground (dunes, stones, walls, other sand), never on flat ground and never around a cactus.
- **Trees**: six oak shapes in sizes that vary, groves and clearings, and four spruce shapes in the cold biome.
- **Creepers** need a clear line of sight, and explosions neither hurt nor break anything behind a wall.
- **Combat**: a click before the swing is about 60% recharged does nothing; hits between then and full are weaker. Each item has its own recharge (hand 0.25 s, sword 0.63 s, axe 1 to 1.25 s).
- **Music**: ten songs, one at a time. Goldenhour Overworld only in the desert, Snowy Feathers only in the cold biome, Deepslate Emberforge only underground; the others play anywhere (some favour underground or the surface).
- Textures: `npm run textures` also fetches cactus, dead bush and spruce textures; without them the game draws its own.

## Public world terrain upgrade (Update 22)
- When the server loads the shared `PUBLIC` world, it upgrades that world's terrain generation to the current `NEW_GEN` (generation 7 as of update 23; it was 6 in update 22).
- Existing player edits, containers, player records, claims and world seed are retained. Unedited terrain is regenerated from the same seed, so the surrounding natural landscape can change; builds may look different relative to the new ground.
- Private worlds keep the generation they were created with.

## Terrain generation 6 (new worlds only)
Worlds made after this update use generation 6; older worlds keep the terrain they were made with (the world is now 128 blocks tall, but old worlds only use the lower half).
- **Three times deeper:** sea level is at height 70 instead of 20, so there is about 75 blocks of rock under the ground. The lower half is **deepslate**, blending into stone over a long ragged band (about heights 10 to 52). Lava lakes stay at the very bottom.
- **Ores have levels:** coal is commonest high up (around 84), iron in the middle (around 52), gold low (around 22) and diamond deepest (around 9); each thins out toward the ends of its range.
- **Desert:** no stone outcrops; long curving dunes with a gentle windward slope and a steep far side; the sand sits on a thick bed of **sandstone** (craft it from 4 sand). Rain, sandstorms and music follow the biome as before.
- **Oceans:** about twice the area, and each ocean is far wider. River and sea floors are lumpy (deepest down the middle of a river) with patches of sand, gravel and dirt, and **seaweed** grows in clumps on them (it behaves like still water; it breaks off if its floor is removed).
- **Shadows:** blocks and trees cast soft sun shadows (baked into the chunk lighting, always from the same side), and every creature and player has a blob shadow on the ground below.
- **Entity lighting:** creatures and other players are dimmer at night, under a roof and in caves, and brighter near torches and lava.
- **Snow under trees:** snowstorms now whiten the ground beneath tree canopies as well.
- **Hits:** you can hit a creature's feet. The client aims at a slightly generous box that includes the feet, and the server accepts a hit if any part of the body is in reach and visible.
- **Music:** Deepslate Emberforge plays only at deepslate level (deep underground in a generation 6 world).

## Update 23: terrain generation 7, wood sets, flowers, dyes, boats, tropical fish, taming wolves
The shared `PUBLIC` world upgrades to generation 7 on its next load (see above); new private worlds use it too. Older private worlds keep their terrain.

**Terrain (generation 7)**
- **Much bigger mountains:** ranges are more than twice as wide and there are more of them (about 20% of the land is now high ground, against about 6% before), and peaks reach height 118 instead of 106, with the snow line moved up to match. The F3 line also shows the biome you are in.
- **Cold land is now really snowy, with spruce trees.** (In generation 6 all cold land was counted as mountain peak, so no tree could ever grow there: that is fixed.) There are two cold biomes: **Snowy Taiga** (dense spruce forest, wolves and rabbits) and **Snowy Tundra** (open snow, no trees, rabbits and the odd wolf).
- **Forest** (the green biome) has birch trees as well as oak, grass in patches, and flowers here and there. **Plains** is a new biome of open grass, thick with **grass, tall grass and flowers** (about 80% of the ground is covered, with clumps of one flower colour) and only a rare lone tree; cows, sheep, pigs and chickens gather there.
- Grass and flowers have no collision, break at once, and are replaced by whatever block, bed or door you place on them. A flower breaks off (and drops itself) if the ground under it is removed.

**Wood**
- Three tree types, each with its own set: **oak, spruce and birch** each give their own **log, planks, leaves and boat**. Tables, chests, sticks, doors, shields and wooden tools accept planks of any wood (even mixed). Logs of all three burn as fuel. Leaves give sticks sometimes.
- **Desert shrubs (dead bushes) always drop 1 to 3 sticks.**

**Flowers, dyes and the rainbow**
- Seven flowers: Poppy (red), Orange Tulip, Dandelion (yellow), Green Clover, Cornflower (blue), Indigo Bellflower and Violet Allium. One flower crafts into **2 dyes** of its colour.
- A dye plus white wool gives that colour of wool; plus a bed gives that colour of bed; plus leather gives dyed leather; plus leather armor dyes it. Any colour of wool, bed or armor can be re-dyed (the recipe book lists the white-wool, red-bed and plain-leather versions; the rest work in the crafting grid all the same). Armor can also be crafted from dyed leather, and then comes out in that colour.
- **Beds** now come in seven colours: three wool of one colour plus three planks make a bed of that colour (plain white wool still makes the red bed).

**Boats**
- Craft one from 5 planks in a U shape (one boat per wood). Right-click water with it to launch it; right-click the boat to get in. **W/S** drive, **A/D** steer, **Shift** gets you out (on touch: the SNEAK button). It floats on the water, stops at the shore, and is picked up again by hitting it. Boats left on the water stay there, even after a restart.

**Water life**
- **Tropical fish** swim in schools in the open sea, in twelve colour patterns; they drop a **Tropical Fish** (edible, small). **Seaweed** can now be mined (you get Seaweed, and plain water is left behind) and replanted on a sea floor.

**Wolves**
- Wolves live in the forest, plains edges, taiga and tundra, in small packs. **Hit a wolf and every wild wolf nearby attacks you.**
- **Taming:** hold a bone and right-click a wild wolf (one bone in three works; hearts mean success). A tamed wolf has a collar, 20 health and follows you, attacks monsters near you and whatever you hit, and jumps to you if it falls behind. Right-click it with an empty hand (or a block) to make it sit or stand, feed it meat to heal it, or give it a dye to colour its collar. You cannot hurt your own wolf. Up to 6 per player; they are saved with the world and come back when you do.

Notes: tame wolves and boats are kept in the world's own save, but are not part of the exported `.vrworld` file. The atlas grew from 64 to 128 tiles.

## Update 24: farming, fishing, golden apples, safer saving

- **Seeds and farming.** Grass gives wheat seeds sometimes (15%, tall grass 25%). Craft a **hoe** (two of a material over two sticks, like an axe without the corner), right click grass or dirt to make farmland, plant seeds on it, and wheat grows through eight stages (about 5 to 10 minutes; twice as fast with water within four blocks, which also darkens the farmland). Ripe wheat gives wheat and seeds, young wheat gives its seed back. **Bread** is three wheat in a row.
- **Golden apple:** an apple surrounded by eight gold ingots. It can be eaten when you are not hungry and heals four hearts.
- **Fishing rod:** two string and three sticks (one stick diagonal, string down the other side). Right click to cast at water, fish nearby swim to the float, it twitches (nibble), then plunges (bite): right click inside about one second to reel the fish in. Too early or too late and it gets away. Water with no fish gets one swimming in after a few seconds.
- **Snow** no longer covers the sea or river floor.
- **Saving:**
  - Autosave stays OFF until the game is sure it cannot overwrite your real save: either this is a brand-new game, or your game file has been loaded (or the browser's copy restored). Until then the home screen and pause menu say so in red.
  - A save that holds clearly less than the last one (fewer worlds, no shared-world progress, far fewer changed blocks), or less than the file you picked, is never written. Autosave pauses and asks what to do.
  - The browser keeps three copies (newest, the one before, and the fullest ever) instead of one, and you can download the browser's copy from the prompt.
  - **Most likely cause of "my server lost my worlds":** unzipping an update into a NEW folder gives a new, empty `data/` folder. Set `DATA_DIR` to a folder outside the project (for example `/home/ubuntu/voxel-data`) so updates never touch your worlds. The server now logs a warning at start and the home screen mentions it when the data is inside the project folder.

## Update 25: no public world, worlds live only while the host is in them

- The public world is gone (the Play button is removed and the server refuses `PUBLIC`).
- A world can only be joined while its host is in it. When the host leaves, everyone else is kicked ("The host left, so this world was closed") and their progress is saved first. Active Worlds only lists worlds whose host is online right now.

## Speed, view distance, caves under water and sand (update 27)

- **Chunks are made and meshed in web workers** (`public/chunkpool.js`, `chunk-worker.js`, `chunkjobs.js`, `mesher.js`), so the game no longer stalls while terrain loads and the view distance slider now goes up to 32 chunks (default 8). Far chunks use a simpler mesh (no grass or flowers, flat lighting) that is swapped for the full one as you come close; finished meshes free their copy in memory once uploaded, and chunks are kept only as tall as they need to be. If a browser cannot start module workers the same work runs on the page a few milliseconds at a time.
- **Terrain generation is about twice as fast** with the same numbers: generations 1 to 8 produce exactly the same blocks as before (checked chunk by chunk).
- **Generation 9** (all new worlds, and the public world): every cave under the sea level that lies under a sea or river bed, or that joins one (or open sea water beside it), is full of water, for several chunks along a tunnel. Lava lakes that the water reaches turn to obsidian. Older worlds keep the caves they had.
- **Sand and water:** water and lava (and weather and crops) never make sand, gravel or snow fall. Breaking or placing any block now checks every sand, gravel and snow block on all six faces of it; one with nothing under it falls, and each block that falls does the same to its neighbours on the next ticks, so a hanging sheet of sand collapses as a chain reaction (400 checks per tick, at most 500 blocks falling at once).
