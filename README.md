# Voxel Realms Online

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

## Saving worlds

Worlds are saved shortly after every change, on shutdown, and the HUD shows **World saved** or **Could not save, retrying**; it never claims a save that failed.

- **Free hosts with a wiped disk:** create a free Redis database at Upstash, then set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` on the game server. Worlds are then stored there (the server uses Upstash's REST API). Each world is one stored value, so a very large world can hit your plan's size limit; the HUD will show the failed save.
- **Host with a persistent disk or volume:** set `DATA_DIR` to its mount path, for example `/var/data`.
- **Neither:** worlds are written to `./data` and last only as long as that disk does.

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
| Right click | Place a block, open a crafting table, furnace or chest, eat (hold), draw a bow (hold, release to shoot), scoop up or pour out water with a bucket |
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
- **Twelve creatures:** pig, cow, sheep, chicken, rabbit, wolf (fights back if hit), zombie (burns in daylight), skeleton (shoots arrows), spider (leaps), boomer (swells and explodes, breaking blocks), slime (big ones split), and **salmon**, which live in natural water (the sea and lakes deep enough to swim in). They swim in small schools, never leave the water by themselves, speed off when hurt, and flop around and suffocate on land. They drop raw salmon (restores 2 hunger), which you can cook in a furnace into cooked salmon (6 hunger), and now and then a bone. All are original voxel designs. Animals spawn on grass in the day; monsters spawn at night and in the dark underground.
- **PvP** with knockback, armor, arrows and critical hits when falling. Dying scatters your items; respawn from the death screen.
- Day and night with a sun, a moon and stars, shared by everyone in the world.

## Water, buckets, swimming and suffocation

- **Water behaves like the real game.** A source block feeds the four blocks around it, each one a little thinner, up to 7 blocks away. Water over air falls as a full-height column, spreads where it lands, and heads for the nearest drop. Two source blocks next to a gap with a solid or water floor make a new source (infinite water). Take the source away and the flow drains block by block. Steps run four times a second on the server, so everyone sees the same flood, and every step has a budget so a big flood never slows the world. Water surfaces slope smoothly between levels. **Still water** (calm pools, lakes, the sea) uses the calm water picture; only **slanted water and the sides of water** use the flowing picture, and it is turned so the pattern runs the way the water is flowing (downhill, toward a drop, straight down for waterfalls). Flowing water also carries you and dropped items along with it, and **dropped items float**: they rise to the surface and bob there instead of sinking.
- **Buckets.** Craft one from three iron ingots in a V (`I I` over ` I `). Right click a water source with an empty bucket to scoop it up (flowing water cannot be picked up, same as the real game); right click a block with a full bucket to pour a new source against it. Creative worlds do not use up or fill buckets.
- **Sprinting in water switches to crawl-swimming**: your body lies flat (0.6 blocks tall), you swim faster, and you move the way you look. If a one block gap is too low to stand in, you stay crawling for as long as you are inside it, even after you stop sprinting or leave the water.
- **Suffocation.** Nothing pushes you out of blocks any more. If any part of your body is inside a block (sand landing on you, a block placed on you) you take half a heart every half second, armor does not help, and the screen goes dark while your head is inside one. Mine or walk your way out.

## What the server checks

Everything that matters is decided on the server: mining time (you must dig long enough), reach, what you hold, placing rules, every inventory click, crafting results, damage, hunger, fall and drowning damage, arrows, creature behavior, item pick-up, container contents. It also checks movement speed (a budget that refills at roughly top speed), message sizes (4 KB), message rates, connections per address, and chat length. Chat is shown as plain text only, never as HTML.

Limits worth knowing: players are guests identified by a token kept in the browser, so a ban can be dodged by clearing site data; there are no accounts yet. The server checks movement speed but not collisions, so a hacked client could walk through walls or fly in survival. Every player in a world receives every block update (fine for 16 players). Run the server behind HTTPS (hosts like Render provide it) so the browser uses `wss://`.

**Updating an existing world:** terrain is regenerated from the seed, so old worlds gain caves and ores; blocks you built or removed are kept. Worlds saved by the earlier version become survival worlds.

## Not built yet

The Nether, the End, portals and the boss; villages and structures; farming; experience and enchanting; sound; torches and real lighting (caves are dim, not dark); touch controls; accounts. The block, item and creature tables (`public/shared/`) and the server modules (`server/`) were built so these can be added one system at a time.
