# VibePilot Multiplayer

Multiplayer development happens on the **`multiplayer`** branch. This file is the plan and reference. The step-by-step guides are:

- [Server hosting quick start](docs/multiplayer/server-hosting-quick-start.md): run the server on any port, locally, on your LAN or on the internet
- [Test 1: two tabs on one computer](docs/multiplayer/test-1-two-tabs.md)
- [Server setup on a Raspberry Pi 5](docs/multiplayer/server-setup-raspberry-pi.md)

## Contents

1. [Goals](#1-goals)
2. [Branches](#2-branches)
3. [Architecture](#3-architecture)
4. [Development plan](#4-development-plan)
5. [Test stages](#5-test-stages)
6. [Reference: protocol, files, commands](#6-reference)
7. [Log](#7-log)

## 1. Goals

| Mode | What players share | Status |
|---|---|---|
| **1. Shared skies** | One map; everyone sees everyone's plane. No enemies. (`?mp=skies`) | Done |
| **2. PvP + co-op** | Shared enemy bases and mission, **and** every weapon hits other players; 0 HP → respawn nearby (`?mp=pvp`) | **Default: working** |
| **3. Co-op** | The same shared war, no damage between players (`?mp=coop`) | Working |

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
| `RULES` + `setRules()` | `src/game/rules.js` | Turning off enemies, ace, interceptors and mission; turning on respawn |
| `onHook()` / `runHooks()`: `frame`, `playerDown`, `radarBlips` | `src/game/hooks.js` | Per-frame network work, reporting a crash, minimap blips |
| `playerDown()` / `respawnPlayer()` | `src/game/respawn.js` | Showing a wreck instead of game over; respawning where the server says |

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

**Multiplayer rules** (shared skies):

| Setting | Value |
|---|---|
| `enemies`, `ace`, `interceptors`, `mission` | Off |
| `respawn` | On: a crash leaves a wreck with an orbit camera, and you respawn at your slot 3 s later with full HP and spawn protection |
| Collisions between players | Off; planes pass through each other until PvP |

**Remote planes** (`src/mp/remotePlanes.js`):
- Each other player is drawn as the player airframe in their slot colour, with a name tag that stays the same size on screen.
- They also appear on the minimap with their name, and in the roster panel under Targets.
- Planes are drawn 100 ms behind server time, blending between two snapshots (position lerp, rotation slerp).
- If snapshots are late, a plane keeps moving along its last velocity for up to 250 ms, then holds. It is hidden after 3 s without data.

## 4. Development plan

**Phase 0: foundation ✅**
- [x] Protocol shared by browser and Node; server with rooms, heartbeat, flood/size/room limits and `/health`.
- [x] `ws` dependency and the `npm run mp-server` / `npm run test:mp` scripts.
- [x] Seams on `master`; the `multiplayer` branch.

**Phase 1: shared skies (in progress)**
- [x] The server owns the state: snapshots, spawn slots, validation with `CORRECT`, down/respawn, and serving the game.
- [x] Client: joins onto the room's map, remote planes with interpolation, roster panel, minimap blips, respawn instead of game over.
- [x] Automated tests: 25 server checks; a two-tab browser run; the 27 single-player tests still pass.
- [x] **Test stage 1 by hand** ([guide](docs/multiplayer/test-1-two-tabs.md)): two tabs work.
- [x] Configurable port and host (`--port`, `--host`, `--origins`; [quick start](docs/multiplayer/server-hosting-quick-start.md)).
- [x] Callsign prompt on entry (remembered); the bare server address opens multiplayer (`?sp` = single-player).
- [ ] Room choice in the lobby (currently `?room=`; default `lobby`).
- [ ] Stages 2–4: LAN, Raspberry Pi, internet.
- [ ] Tuning from real play: interpolation delay, report rate, spawn layout (the spawn line can face an obstacle on some maps).

**Phase 2: PvP**
- [x] Remote planes are **proxy air units** (`au.proxy`, a seam on master): bullets, missiles, bombs and napalm, the lock-on reticle and missile homing all target them. `hits.js` hands each hit to the proxy, which sends `HIT` with the weapon's `PVP_DAMAGE` (gun 4 · missile 45 · bomb 60 · napalm 10); the server caps it.
- [x] The victim applies it with `damagePlayer()` (flares stop gun and missile hits, spawn protection applies) and at 0 HP reports `DOWN { by }`. The server broadcasts it: kill feed, +150 score for the shooter, kills in the roster.
- [x] Respawn at a random point 80–350 units from the player's start slot, 35–90 above the ground, random heading.
- [x] Name tags carry an HP bar; the roster shows everyone's HP.
- [x] Other players' shots are drawn on your screen (`src/mp/remoteFx.js`): gun tracers (a firing flag in `STATE`), missile pairs that home on their target, flares, bombs and napalm (`FIRE` messages, checked by the server). They are visuals only; hits stay shooter-decided.
- [ ] Scoreboard (Tab). Respawn points that avoid obstacles (the server doesn't know the map yet).
- [x] Collisions between players: ramming counts as a crash for both.
- [ ] Trust model: the shooter decides hits (fine among friends). The server already clamps damage and rate-limits messages.

**Phones and tablets** (on master, so single-player too)
- [x] Touch overlay: joystick (pitch/roll), throttle, GUN (hold), MSL/FLR/BOMB/NAP, pause, fullscreen. TILT steers with the motion sensor (needs `https://`, e.g. `--tls`).
- [ ] Check the tilt directions on a real phone (they are untested on hardware).

**Also done in phase 2**
- [x] Every gameplay notification is shared with the player's name (`EVENT`): "Bravo: ★ Orion Constellation — COMPLETE", level-ups, bases. Device-only messages (mute, tilt) stay local.
- [x] The aiming laser is visible to others (`STATE.f` bit 2).
- [x] Join straight away: the bare address opens `?mp=pvp` in room `lobby` with a remembered or random callsign ("Ghost Hornet"); **Callsign** in the start and pause menus changes it.
- [x] Name tags are sized in the world and fade out beyond ~320 units, so they don't cover planes.

**Phase 3: Co-op**
- [x] Shared enemies in `pvp` and `coop` rooms (`src/mp/coop.js`): units get net ids `g<i>`/`a<i>` in the seeded creation order; hits are synced as `UNIT_HIT` and applied quietly by the others (no double rewards or notifications); the server keeps damage totals for late joiners; the host sends moving air units twice a second (`WORLD`). Each player's copy of an enemy shoots at that player.
- [ ] Share the random spawners too (interceptor waves, the ace, roaming fighters). They're off in multiplayer for now.
- [x] Stable unit ids in the order the map generates them (`netId`).
- [ ] Authority for enemies. Start with the host's browser: the server already tracks the host and hands it over. The host runs the AI and sends `WORLD` deltas at 10 Hz. Guests turn their AI off and interpolate, and send their damage as `ACTION` for the host to apply.
- [ ] Later option: the server runs the simulation itself. That needs the game logic separated from THREE and the page (a headless core), a large refactor. A Pi 5 has the CPU for it.

**Later**
- Binary encoding.
- A room list from `/health`.
- Reconnecting to the same slot.
- Spectator mode.

## 5. Test stages

Each stage must pass before moving to the next.

| # | Stage | Setup | Pass when |
|---|---|---|---|
| 1 | **Two tabs, one computer** | `npm run mp-server`, then two tabs on `localhost:8787` | Both tabs are on the same map with no enemies; each sees the other's plane move smoothly; a crash respawns you; the roster and minimap show both players |
| 2 | **Two devices on your home network** | Server with `HOST=0.0.0.0`; the second device opens `http://<pc-ip>:8787/?mp` | As stage 1, with real Wi-Fi jitter; ping under 20 ms |
| 3 | **Through the Raspberry Pi** | The Pi runs the server behind a tunnel; everyone opens `https://<your-address>/?mp` | Works over `https`/`wss`; the server restarts by itself after a reboot; `/health` responds |
| 4 | **Friends over the internet** | 3–8 players on different networks | Smooth at 50–150 ms ping; reconnects after a network drop; 8 players stay stable for 15 minutes |

**Automated checks** (run before each push to `multiplayer`):

```sh
npm run check        # every module parses, every import resolves
npm run lint
npm run test:mp      # 25 server checks: rooms, seeds, slots, snapshots, validation, respawn, limits, static files
npm run test:browser # 27 single-player browser tests (needs Node 20+ for Playwright)
```

## 6. Reference

**URL parameters** (multiplayer branch):

| Parameter | Meaning | Default |
|---|---|---|
| `?mp=pvp` | Enable multiplayer in that mode (`pvp`, `coop`, `skies`) on the server that served the page. The multiplayer server sends its bare address to `?mp=pvp`. | Off (on when served by the multiplayer server) |
| `?sp` | Force single-player on the multiplayer server | – |
| `?mp=wss://host/` | Connect to a different server | – |
| `room=` | Room name, `[a-z0-9_-]`, up to 24 characters | `lobby` |
| `name=` | Your callsign, up to 16 characters | Remembered, or a random one; change it with **Callsign** in the menus |
| `mode=` | Same as the `?mp=` value, when `?mp=` holds a server address | `pvp` |

**Messages** (`src/net/protocol.js`, version 2): `HELLO` · `WELCOME` · `REJECT` · `JOIN` · `LEAVE` · `STATE` · `SNAP` · `CORRECT` · `DOWN` · `SPAWN` · `PING` · `PONG`, plus `FIRE` · `HIT` · `HOST` · `WORLD` · `ACTION`, reserved for phases 2–3.

**Limits:**
- 8 players per room, 32 rooms per server.
- Reports and snapshots at 20 Hz.
- 60 messages per second per client.
- 8 KB per message.

**Files:**

| Path | What it is |
|---|---|
| `server/server.mjs` | The server: game files, rooms, state, validation. Run it with `npm run mp-server -- --port <n> --host <addr>` |
| `server/deploy/` | systemd unit and `update.sh` for the Pi |
| `src/net/protocol.js` | Protocol shared by browser and server |
| `src/net/net.js` | Connection, peers, clock |
| `src/mp/index.js` | Entry point: rules, hooks, roster |
| `src/mp/remotePlanes.js` | Other players' planes |
| `src/mp/mp.css` | Multiplayer HUD styles |
| `tests/mp-server.mjs` | Server tests |

**Capacity** (measured on the relay, estimated for a Pi 5): an 8-player room uses about 1–2 Mbit/s of upload and a few percent of one Pi 5 core. Your home upload speed limits the number of rooms long before the Pi does.

## 7. Log

- **Phase 1, shared skies:**
  - The server owns the state: 20 Hz snapshots, spawn slots, speed and bounds validation with `CORRECT`, down/respawn.
  - The server serves the game itself.
  - Client: remote planes, roster, minimap blips, respawn.
  - Protocol v2.
- **Seams on master:** `RULES`, hooks, `respawn.js`; no single-player behaviour change.
- **Phase 0:** protocol v1, relay server, `?mp` client, 16 relay tests.
