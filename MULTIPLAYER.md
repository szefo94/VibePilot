# Multiplayer

The game stays static on GitHub Pages. A small WebSocket **relay** (`server/server.mjs`, Node + `ws`) connects the players. It runs no game simulation. It holds rooms, forwards messages, routes PvP hits and, in co-op, tracks which player is the host.

| Mode | `?mode=` | What is shared | Authority |
|---|---|---|---|
| 1. Shared skies | `skies` | Same map; everyone sees everyone's plane | Each client owns its own plane; enemies stay local |
| 2. PvP | `pvp` | Skies, plus players can shoot each other | The shooter decides the hit; the victim applies the damage (flares, grace) |
| 3. Co-op | `coop` | One war: the same enemies, bases and mission | The host's browser runs the AI and streams it to guests; the server hands over host when it leaves |

## What is in place (the environment)

| Piece | File | Status |
|---|---|---|
| Wire protocol: message types, modes, limits, validation (shared by browser and Node) | `src/net/protocol.js` | done |
| Relay server: rooms, room seed, relay, PvP hit routing, co-op host tracking and handover, flood/size/room caps, heartbeat, origin allowlist, `GET /health` | `server/server.mjs` | done |
| Browser client: `?mp` connect, seed sync (reloads onto the room's map), reconnect with backoff, peer table, `onNet()` / `netSend()` hooks, streams the local plane at 15 Hz, ping, status chip | `src/net/net.js` | done |
| Tests: 16 relay checks (`npm run test:mp`); verified in a browser with two tabs in one room | `tests/mp-server.mjs` | passing |
| Pi service unit | `server/deploy/vibepilot-mp.service` | ready |
| Remote planes, PvP damage, co-op sync (the gameplay) | — | **not started**, see the plan below |

### Try it locally

```sh
npm ci
npm run mp-server        # ws://localhost:8787
npm run serve            # http://localhost:8000
# open in two tabs:
http://localhost:8000/?mp&mode=skies&room=test&name=Alpha
http://localhost:8000/?mp&mode=skies&room=test&name=Bravo
```

URL parameters:

- `?mp=wss://host/`: the server. A bare `?mp` uses `MP_SERVER_URL` in `config.js`.
- `mode`: `skies`, `pvp` or `coop`.
- `room`: `[a-z0-9_-]`, up to 24 characters.
- `name`: the name other players see.

The status chip under the score shows the mode, room, number of pilots, ping and whether you are the host. Without `?mp` nothing connects.

## Raspberry Pi: can it host this?

**Yes, easily, for relay-based modes 1–3.**

**Measured load.** One room of 8 players at 15 updates/s relays about 705 messages/s, about 71 KB/s of payload. On a Ryzen 5 5600 that used 2.8 % of one core, counting the relay and the 8 simulated clients together. A Pi 4 core is roughly 5–8× slower, so that is at most about 15–20 % of one core. Four full rooms (32 players) measured 6.7 % on the Ryzen, which works out to under half of one Pi 4 core. Node plus `ws` idles at about 50 MB of RAM.

**Bandwidth.** Bandwidth, not CPU, is the real limit, and it is your home upload speed:

| Traffic | Upload |
|---|---|
| One 8-player room, plane state only | ≈ 1 Mbit/s including TCP/WebSocket overhead |
| Gunfire and missile events added | ≈ 2 Mbit/s |
| Co-op world snapshots (deltas, nearby units only, 10 Hz) | up to +3 Mbit/s |

A 10 Mbit/s upload therefore covers 2–4 active rooms.

| Model | Verdict |
|---|---|
| Pi 5 / Pi 4 (2 GB+) | Ideal. Wired Ethernet recommended. |
| Pi 3B+ / Zero 2 W | Fine for 1–2 rooms (Wi-Fi adds jitter). |
| Pi 1 / Zero (ARMv6) | No: current Node.js has no ARMv6 builds. |

**What would *not* fit well** is a server-authoritative co-op simulation: the full game AI running headless on the Pi. The CPU could manage one world, but the game logic is tied to THREE and the page (the DOM), so it would first have to be separated out. The plan below uses host authority instead, so the Pi stays a relay.

### The one real hurdle: HTTPS

GitHub Pages is HTTPS, so browsers will only connect to `wss://` with a valid certificate. A plain `ws://your-ip:8787` is blocked. Options:

1. **Cloudflare Tunnel (recommended).** Run `cloudflared` on the Pi. No port forwarding is needed, it works behind CGNAT, and TLS is free. It needs a domain on Cloudflare, e.g. `wss://mp.example.com`. For a quick test, `cloudflared tunnel --url http://localhost:8787` gives a temporary `*.trycloudflare.com` URL.
2. **Tailscale Funnel.** A free HTTPS URL with no domain needed.
3. **Port forward 443, then Caddy (automatic TLS) and DuckDNS.** This fails if your ISP uses CGNAT.

### Setup on the Pi (Raspberry Pi OS 64-bit)

```sh
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs git
git clone https://github.com/szefo94/VibePilot.git && cd VibePilot && npm ci --omit=dev
sudo cp server/deploy/vibepilot-mp.service /etc/systemd/system/ && sudo systemctl enable --now vibepilot-mp
curl localhost:8787/health
# then: cloudflared tunnel → http://localhost:8787, set MP_SERVER_URL = 'wss://mp.<your-domain>' in config.js
```

## Implementation plan

**Phase 1: Shared skies** (small; makes the whole pipeline visible)

- `src/net/remotePlanes.js`
  - One mesh per peer: the player airframe, tinted per player, with a name label.
  - Buffered interpolation: render about 100 ms behind, lerp the position and slerp the rotation.
  - Hide a plane after 3 s without updates; remove it on LEAVE.
- Remote planes on the minimap (cyan) and a player roster in the HUD.
- **Multiplayer** button on the start menu: server, mode, room and name, then reload with the `?mp` parameters.
- Deploy the relay on the Pi behind a tunnel, set `MP_SERVER_URL`, and test on GitHub Pages.

**Phase 2: PvP** (medium)

- Remote planes become targets: bullet, missile and splash collisions and the lock-on reticle, via a new `remote` kind in `entities/contract.js`, excluded from the AI loop.
- A hit on a remote plane sends `HIT` and changes nothing locally. The receiving side runs `damagePlayer()` (flares and grace still apply), and at 0 HP broadcasts `DOWN { by }`. That drives the kill feed and the shooter's score.
- `FIRE` events show other players' tracers, missiles and flares (cosmetic).
- Respawn after a few seconds instead of game over. Scoreboard on Tab. The ace and enemies stay local, as PvE noise.
- Trust model: the shooter is trusted (fine among friends). The server already clamps damage and rate-limits.

**Phase 3: Co-op** (large; do it after 1–2 feel good)

- **Stable unit ids:** the map is generated from the room seed, so number units in generation order (`netId`) instead of UUIDs.
- **Host** (the server's `hostId`):
  - Runs the AI and spawners as today.
  - Sends `WORLD` at 10 Hz: moving-unit poses, HP changes, deaths, spawns (interceptor waves, aces), mission progress.
  - Sends deltas, with a full snapshot when someone joins.
- **Guests:**
  - AI, spawners and mission logic are disabled (a "puppet" mode in `simulate()`), and units are interpolated from `WORLD`.
  - Their damage to units goes to the host as `ACTION { unit, dmg, weapon }`. The host applies it through `hits.js` and the result comes back in the next `WORLD`.
- **Enemy fire:** the host sends it as `FIRE`. Each client flies the bullets locally and decides hits on its own plane, as in PvP.
- **Host migration:** on `HOST`, the new host continues from its last applied snapshot.
- **Code to touch:**
  - `ai.js` and `simulation.js`: gate on host or guest.
  - `airUnits.js`, `rival.js` and the interceptor timer in `main.js`: spawns.
  - `hits.js`: route damage.
  - `mission.js`: progress from the host.

**Later**

- Binary encoding if bandwidth matters.
- Room list from `/health` in the lobby.
- Server-side sanity checks (speed limits).
- Headless authoritative co-op, if cheating or host latency becomes a problem.
