# Voxel Realms Online

A multiplayer voxel sandbox for the browser. Everyone in a world sees the same terrain, the same blocks and each other, live.

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

## Playing

| Key | Action |
| --- | --- |
| W A S D, Space | Move, jump (Space also swims up) |
| Shift | Sprint (descend while flying) |
| Left / right click | Break / place the selected block |
| 1-9 or wheel | Pick a block |
| F | Toggle flying |
| R | Respawn at the world spawn (also fixes being stuck) |
| Enter | Chat (`/help`, `/who`; owners also get `/kick name` and `/ban name`) |

**Public world** is always available. **Create a private world** makes a six-character code to share; the creator is its owner. Walking the sea floor, swimming, fog and a shared day-night clock are all in.

## What the server checks

Movement speed (a budget that refills at roughly the game's top speed), reach distance, block ids, bedrock and water rules, not placing a block inside a player, message sizes (4 KB), message rates, connections per address, chat length and control characters, world full or banned. Chat is shown as plain text only, never as HTML.

Limits worth knowing: players are guests identified by a token kept in the browser, so a ban can be dodged by clearing site data; there are no accounts yet. The server checks movement speed but not collisions. Every player in a world receives every update (fine for 16 players; it is not area-filtered). Run the server behind HTTPS (hosts like Render provide it) so the browser uses `wss://`.

## Not built yet

This is a working multiplayer core, not the whole sandbox. Missing: survival (health, hunger, inventory, crafting, smelting), mobs and the boss, the Nether and the End and portals, structures and loot, farming, accounts and per-world settings, sound, touch controls, area-based network filtering. The block table, shared terrain module, authoritative server and save format were built so these can be added one system at a time.
