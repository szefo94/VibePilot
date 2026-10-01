# VibePilot Multiplayer

Multiplayer development happens on the **`multiplayer`** branch. This file is the plan and reference. The step-by-step guides are:

- [Game modes](docs/multiplayer/game-modes.md): what each mode does and the address that opens it
- [Server hosting quick start](docs/multiplayer/server-hosting-quick-start.md): run the server on any port, locally, on your LAN or on the internet
- [Test 1: two tabs on one computer](docs/multiplayer/test-1-two-tabs.md)
- [Server setup on a Raspberry Pi 5](docs/multiplayer/server-setup-raspberry-pi.md)

## Contents

1. [Goals](#1-goals)
2. [Branches](#2-branches)
3. [Architecture](#3-architecture)
4. [Where the state lives](#4-where-the-state-lives)
5. [Development plan](#5-development-plan)
6. [Test stages](#6-test-stages)
7. [Reference: protocol, files, commands](#7-reference)
8. [Log](#8-log)

## 1. Goals

| Mode | What players share | Status |
|---|---|---|
| **Team deathmatch** | Red against Blue, five a side; the host's bots fill the empty places. No friendly fire; a server-kept score and kills/deaths. A flag in the middle where the bots gather. (`?mp=tdm`) | **Default: working** |
| **PvP** | Shared enemy bases and mission, **and** every weapon hits every other player; 0 HP → respawn nearby. Ace Hunt aces hunt everyone. (`?mp=pvp`) | Working |
| **Co-op** | The same shared war and aces, no damage between players (`?mp=coop`) | Working |
| **Shared skies** | One map; everyone sees everyone's plane. No enemies. (`?mp=skies`) | Done |

Principles:

- **Single-player stays static on GitHub Pages** (`master`). Multiplayer never ships there.
- **Multiplayer reuses the whole game** (flight, weapons, map, HUD) and only swaps the rules.
- **The server owns the session state.** Clients only fly their own plane and report it.

## 2. Branches

```text
master        single-player: GitHub Pages serves it
  │  merge master → multiplayer (one direction only)
  ▼
multiplayer   master + src/mp/, src/net/, server/, docs/multiplayer/
```

**Rules**

1. Game features and fixes that both versions need go to **`master`** first, then get merged into `multiplayer`.
2. **Never merge `multiplayer` into `master`.**
3. Keep multiplayer code in its own folders. It changes shared files as little as possible:

   | Shared file | Change on `multiplayer` |
   |---|---|
   | `src/main.js` | One line: `import './mp/index.js'` |
   | `package.json` / lock | Adds the `ws` dependency and the multiplayer scripts |
   | `eslint.config.js` | Lints `server/` |

4. If multiplayer needs a new hook point in the game, add it to `master` as a neutral seam (see §3), then merge.

**Day to day**

```sh
git switch master          # single-player work, as before
git switch multiplayer     # multiplayer work
git merge master           # bring single-player changes in (conflicts: only the lines above)
```

**Seams on `master`.** These are neutral hook points; single-player behaves exactly as before.

| Seam | File | Used by multiplayer for |
|---|---|---|
| `RULES` + `setRules()` | `src/game/rules.js` | Turning interceptors and roaming fighters off, Ace Hunt on the host only, respawn on |
| `onHook()` / `runHooks()` | `src/game/hooks.js` | `frame`, `playerDown`, `radarBlips`, `notification`, `worldReady`, `unitHit` (with the shooter), `playerFired`, `rivalDown`, `aceLevelUp`, `aceDropped`, `aceImpact` |
| `playerDown()` / `respawnPlayer()` | `src/game/respawn.js` | Showing a wreck instead of game over; respawning where the server says |
| Proxy air units (`au.proxy`: `damage`, `ram`) | `src/combat/hits.js`, `combat/collision.js` | Other players and the host's bots as targets: hits and rams are handed to their owner |
| `beginHits(weapon, { remote, shooter })` | `src/combat/hits.js` | Applying synced damage quietly; damage by a bot (the bot is paid, not the player) |
| `setRivalTargets(targets, onRemoteHit, traffic)`, `spawnAce({ … })`, `rewardAce()`, `rivalList()` | `src/entities/rival.js` | Bots that hunt other players and bots, team colours, allies, rally point, patrol area, farming |
| `notifications.quietly()`, `showNotification(…, { local })` | `src/ui/notifications.js` | Sharing gameplay notifications; keeping device messages local |

## 3. Architecture

```text
 Browser (game + src/mp/)                    Server (server/server.mjs, Node + ws)
 ─────────────────────────                   ──────────────────────────────────────
 flies own plane locally ──STATE 20 Hz──────▶ validates each report (speed, bounds)
                                              keeps: room, seed, roster, slots, alive,
                                                     accepted pose of every plane
 draws other planes     ◀──SNAP 20 Hz─────── one snapshot of the whole room per tick
   (100 ms behind, interpolated)
 crash → wreck ──────────DOWN──────────────▶ marks dead, after 3 s:
 respawn at slot ◀───────SPAWN────────────── puts you back at your slot
 teleported back ◀───────CORRECT─────────── after 3 impossible reports in a row
```

**The server decides:**
- The room and its map seed. The first player's seed becomes the room's; anyone joining with a different map reloads onto it.
- The roster, and a spawn slot for each player (a line abreast over the single-player start).
- Who is alive, and when they respawn.
- The clock: snapshots carry server time.
- The accepted position of every plane.

**The client decides:**
- Its own flight, for zero control lag.
- The server checks every report. A physically impossible report (a teleport, or leaving the map) is dropped, and after three in a row the server sends the client back to its last accepted position (`CORRECT`).

**One server does everything.** The multiplayer server serves the game files and handles WebSocket on **one port**. Players open `https://your-server/?mp`, so there are no cross-origin problems and nothing to configure in the client. It serves only public files (`index.html`, `style.css`, `three.min.js`, `src/**`), never `.git`, `server/` or `node_modules`.

**Multiplayer rules:**

| Setting | Value |
|---|---|
| `enemies`, `mission` | On in tdm, pvp and coop (shared, see `src/mp/coop.js`); off in shared skies |
| `ace` | Ace Hunt on the host only, in pvp and coop; tdm has team bots instead |
| `interceptors`, `roamingFighters` | Off (they spawn at random, so they can't be shared yet) |
| `respawn` | On: a crash leaves a wreck with an orbit camera, and you respawn 3 s later near your start with full HP and spawn protection |
| Collisions between players | Ramming counts as a crash for both |

**Remote planes** (`src/mp/remotePlanes.js`):
- Each other player is drawn as the player airframe in their slot colour, with a name tag that stays the same size on screen.
- They also appear on the minimap with their name, and in the roster panel under Targets.
- Planes are drawn 100 ms behind server time, blending between two snapshots (position lerp, rotation slerp).
- If snapshots are late, a plane keeps moving along its last velocity for up to 250 ms, then holds. It is hidden after 3 s without data.

## 4. Where the state lives

**The server keeps everything in memory.** There is no database and nothing is written to disk while it runs. A restart (or a crash) starts every room from scratch: players reconnect by themselves and get a new room, and the score, kills/deaths and destroyed enemy units are reset.

| What | Where | Lost on a server restart? |
|---|---|---|
| Rooms: mode, name, map seed, host, players | `rooms` map in `server/server.mjs` | Yes; a room is also deleted when its last player leaves |
| Each player: name, slot, team, alive, accepted position, HP | The player's entry in its room (`room.players`) | Yes |
| Damage done to the shared enemy units (for late joiners) | `room.units` | Yes |
| Team score and kills/deaths of every player and bot | `room.score`, `room.stats` | Yes |
| The bots themselves (position, HP, level, XP) | The **host's browser**, not the server (`src/mp/bots.js`, `src/entities/rival.js`) | Yes, and also when the host leaves |
| Location lookups for the log | A cache in `server/geo.mjs` | Yes (looked up again) |
| TLS certificate (self-signed, `--tls`) | `~/.vibepilot/certs/` on the server computer (on Windows `C:\Users\<you>\.vibepilot\certs`) | **No**, it is reused |
| Server log (joins and leaves with IP and location) | Only the server's terminal window; redirect it to keep it, e.g. `npm run mp-server -- … > mp.log` | Yes, unless redirected |

**Each player's browser** keeps its own things in `localStorage` for the address it opened: the callsign (`vibepilot_mp_name`), settings such as difficulty and touch wheels (`vibepilot_settings`) and the best score (`vibepilot_hs`). Their level, XP and HP in a multiplayer session live only in that open page: reloading starts a new pilot.

## 5. Development plan

**Phase 0: foundation ✅**
- [x] Protocol shared by browser and Node; server with rooms, heartbeat, flood/size/room limits and `/health`.
- [x] `ws` dependency and the `npm run mp-server` / `npm run test:mp` scripts.
- [x] Seams on `master`; the `multiplayer` branch.

**Phase 1: shared skies ✅**
- [x] The server owns the state: snapshots, spawn slots, validation with `CORRECT`, down/respawn, and serving the game.
- [x] Client: joins onto the room's map, remote planes with interpolation, roster panel, minimap blips, respawn instead of game over.
- [x] Configurable port and host; HTTPS (`--tls`, `--public`, own certificates); callsigns; the bare address opens multiplayer (`?sp` = single-player).
- [x] Tested over the internet (router port 443 → 8443, phone and PC).
- [ ] Room choice in the lobby (currently `?room=`; default `lobby`).
- [ ] Tuning from real play: interpolation delay, report rate, spawn layout (a spawn can face an obstacle on some maps).

**Phase 2: PvP ✅**
- [x] Remote planes are proxy air units: every weapon, the lock-on and missile homing target them; the shooter reports hits (`HIT`, capped by the server); the victim applies them, and reports `DOWN { by }` at 0 HP.
- [x] Respawn near the start, name tags with HP bars, other players' shots drawn (`src/mp/remoteFx.js`), shared notifications (`EVENT`), aiming laser, ramming.
- [ ] Respawn points that avoid obstacles (the server doesn't know the map yet).
- [ ] Trust model: the shooter decides hits (fine among friends). The server already clamps damage and rate-limits messages.

**Phase 3: Co-op and bots ✅ (first version)**
- [x] Shared enemies (`src/mp/coop.js`): net ids in the seeded creation order, hits synced as `UNIT_HIT`, damage totals kept for late joiners, the host sends moving air units (`WORLD`).
- [x] Ace Hunt in pvp and coop: the host's aces hunt every player; the others see them as bots (`BOT`, `BOT_HIT`, `BOT_FIRE`, `BOT_DOWN`).
- [x] **Team deathmatch** (default): two teams of five, bots fill them (`src/mp/bots.js`), no friendly fire, server-kept team score and kills/deaths (`SCORE`), team spawns north and south, the flag in the middle (`src/mp/flag.js`).
- [x] Bots: must see a target before attacking, rally at the flag after every spawn, keep clear of other aircraft, farm the enemy bases with guns, bombs and napalm for XP, level up, heal on pickups, die in mid-air collisions.
- [ ] Share the remaining random spawners (interceptor waves, roaming fighters).
- [ ] Authority for enemies: today every player's copy of the bases runs its own AI (only damage and aircraft positions are synced), and a base only shoots at the local player.
- [ ] Later option: the server runs the simulation itself. That needs the game logic separated from THREE and the page (a headless core), a large refactor. A Pi 5 has the CPU for it.

**Phones and tablets** (on master, so single-player too)
- [x] Touch overlay with two wheels (any axis on any direction, Settings → Touch wheels), weapons, pause, tilt steering, LEVEL, fullscreen; compact objective; motion indicator.
- [ ] Check tilt steering on a real phone (untested on hardware).

**Next**
- [ ] Team deathmatch score limit and end of match (unlimited for now).
- [ ] Full-screen scoreboard on Tab (the roster already shows score and K/D).

**Later**
- Binary encoding.
- A room list from `/health`.
- Reconnecting to the same slot.
- Spectator mode.

## 6. Test stages

Each stage must pass before moving to the next.

| # | Stage | Setup | Pass when |
|---|---|---|---|
| 1 | **Two tabs, one computer** | `npm run mp-server`, then two tabs on `localhost:8787` | Both tabs are on the same map with no enemies; each sees the other's plane move smoothly; a crash respawns you; the roster and minimap show both players |
| 2 | **Two devices on your home network** | Server with `HOST=0.0.0.0`; the second device opens `http://<pc-ip>:8787/?mp` | As stage 1, with real Wi-Fi jitter; ping under 20 ms |
| 3 | **Through the Raspberry Pi** | The Pi runs the server behind a tunnel; everyone opens `https://<your-address>/?mp` | Works over `https`/`wss`; the server restarts by itself after a reboot; `/health` responds |
| 4 | **Friends over the internet** | 3–8 players on different networks | Smooth at 50–150 ms ping; reconnects after a network drop; 8 players stay stable for 15 minutes |

**Automated checks** (run before each push to `multiplayer`):

```sh
npm run check           # every module parses, every import resolves
npm run lint
npm run test:mp         # 49 server checks: rooms, seeds, slots, snapshots, validation, respawn, limits, static files, PvP, co-op, bots, teams, score
npm run test:mp-browser # two headless players: team deathmatch (teams, bots, flag, kills/deaths, score, ramming) and shared aces
npm run test:browser    # 27 single-player browser tests
```

The browser tests need a Chromium-based browser (`BROWSER_PATH`) and a Node version the installed `playwright-core` supports.

## 7. Reference

**URL parameters** (multiplayer branch; [game-modes.md](docs/multiplayer/game-modes.md) has every address):

| Parameter | Meaning | Default |
|---|---|---|
| `?mp=tdm` | Enable multiplayer in that mode (`tdm`, `pvp`, `coop`, `skies`) on the server that served the page. The multiplayer server sends its bare address to `?mp=tdm`. | Off (on when served by the multiplayer server) |
| `?sp` | Force single-player on the multiplayer server | – |
| `?mp=wss://host/` | Connect to a different server | – |
| `room=` | Room name, `[a-z0-9_-]`, up to 24 characters | `lobby` |
| `name=` | Your callsign, up to 16 characters | Remembered, or a random one; change it with **Callsign** in the menus |
| `mode=` | Same as the `?mp=` value, when `?mp=` holds a server address | `tdm` |

**Messages** (`src/net/protocol.js`, version 8): `HELLO` · `WELCOME` · `REJECT` · `JOIN` · `LEAVE` · `HOST` · `STATE` · `SNAP` · `CORRECT` · `DOWN` · `SPAWN` · `FIRE` · `HIT` · `UNIT_HIT` · `WORLD` · `BOT` · `BOT_HIT` · `BOT_FIRE` · `BOT_DOWN` · `SCORE` · `EVENT` · `ACTION` · `PING` · `PONG`. Each is documented where it is defined.

**Limits:**
- 10 players per room (two teams of five in tdm), 32 rooms per server.
- Reports and snapshots at 20 Hz; the host shares its bots at 10 Hz.
- 60 messages per second per client.
- 8 KB per message.

**Server options:** `--port`, `--host`, `--tls`, `--public`, `--tls-cert` / `--tls-key`, `--origins`, `--no-geo` (log IPs without the location lookup), `--trust-proxy` (behind a tunnel or reverse proxy). `npm run mp-server -- --help` lists them.

**Files:**

| Path | What it is |
|---|---|
| `server/server.mjs` | The server: game files, rooms, state, validation, team score. Run it with `npm run mp-server -- --port <n> --host <addr>` |
| `server/cert.mjs` | Self-signed certificate for `--tls` |
| `server/geo.mjs` | Player IP and location for the log |
| `server/deploy/` | systemd unit and `update.sh` for the Pi |
| `src/net/protocol.js` | Protocol shared by browser and server: modes, limits, teams, spawns, messages |
| `src/net/net.js` | Connection, peers, clock, score |
| `src/mp/index.js` | Entry point: rules, hooks, PvP, kill feed, roster |
| `src/mp/remotePlanes.js` | Other players' planes |
| `src/mp/remoteFx.js` | Other players' (and bots') shots |
| `src/mp/coop.js` | Shared enemy bases |
| `src/mp/bots.js` | Bots: Ace Hunt aces and team bots, on the host and as seen by everyone else |
| `src/mp/flag.js` | Team deathmatch flag |
| `src/mp/lobby.js`, `src/mp/callsigns.js` | Callsign prompt and random callsigns |
| `src/mp/mp.css` | Multiplayer HUD styles |
| `tests/mp-server.mjs`, `tests/mp-browser.mjs` | Server tests; two-player browser tests |

**Capacity** (measured on the relay, estimated for a Pi 5): an 8-player room uses about 1–2 Mbit/s of upload and a few percent of one Pi 5 core. Your home upload speed limits the number of rooms long before the Pi does.

## 8. Log

- **Bots and team deathmatch (protocol v7–v8):** Ace Hunt shared as bots; team deathmatch as the default with team bots, the flag, team score and kills/deaths; bots see before they attack, rally, farm with guns, bombs and napalm, level up, collide; IP and location in the server log.
- **Phase 3, co-op:** shared enemy bases (`UNIT_HIT`, `WORLD`), late-joiner damage log.
- **Phase 2, PvP:** proxy targets, `HIT`/`DOWN`, remote shots, notifications, laser, callsigns, HTTPS, phone controls.
- **Phase 1, shared skies:**
  - The server owns the state: 20 Hz snapshots, spawn slots, speed and bounds validation with `CORRECT`, down/respawn.
  - The server serves the game itself.
  - Client: remote planes, roster, minimap blips, respawn.
  - Protocol v2.
- **Seams on master:** `RULES`, hooks, `respawn.js`; no single-player behaviour change.
- **Phase 0:** protocol v1, relay server, `?mp` client, 16 relay tests.
