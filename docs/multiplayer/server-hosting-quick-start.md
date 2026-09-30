# Multiplayer server: quick start

Run the VibePilot multiplayer server on any port, for yourself, your home network or the internet.
One process serves **both the game and the multiplayer connection**, so players only need one address.

More detail:
- [Test 1: two tabs](test-1-two-tabs.md)
- [Raspberry Pi 5 setup](server-setup-raspberry-pi.md)
- [Multiplayer plan](../../MULTIPLAYER.md)

## 1. Start in 3 steps

**Needs:** Node.js 18 or newer and a copy of the `multiplayer` branch.

```sh
git switch multiplayer      # 1. the multiplayer code
npm ci                      # 2. dependencies (once, and after pulling updates)
npm run mp-server           # 3. start on the default port 8787
```

Open `http://localhost:8787/?mp&room=test&name=Alpha`. Stop the server with **Ctrl+C**.

## 2. Choose the port

Add options after `--`. They work the same in PowerShell, cmd and bash:

```sh
npm run mp-server -- --port 9000
npm run mp-server -- --port 9000 --host 0.0.0.0
npm run mp-server -- --help
```

| Option | Default | Meaning |
|---|---|---|
| `--port <n>` (`-p`) | `8787` | Port for the game page **and** the multiplayer connection (1–65535) |
| `--host <addr>` | `127.0.0.1` | `127.0.0.1`: only this computer. `0.0.0.0`: every device on your network. |
| `--origins <list>` | any | Extra websites allowed to connect, comma-separated (only needed if the game is served from somewhere else) |
| `--help` (`-h`) | – | Show the options |

**Environment variables** do the same (for services and scripts); command-line options win:

| Shell | Example |
|---|---|
| PowerShell | `$env:PORT=9000; $env:HOST='0.0.0.0'; npm run mp-server` |
| bash | `PORT=9000 HOST=0.0.0.0 npm run mp-server` |
| systemd | `Environment=PORT=9000` in the unit file |

**Players use the same port in the address:** `http://<server>:9000/?mp&room=test&name=Anna`. Nothing else needs configuring. The game connects back to the port it was loaded from.

On start the server prints the addresses to use:

```text
VibePilot multiplayer server — port 9000, reachable from your network
  game:    http://localhost:9000/?mp&room=test&name=Alpha
  network: http://192.168.0.16:9000/?mp&room=test&name=Bravo
  health:  http://localhost:9000/health
  origins: any (use --origins to restrict)
Stop with Ctrl+C.
```

## 3. Hosting scenarios

### A. Just this computer (testing)

```sh
npm run mp-server -- --port 8787
```

Open two windows with `http://localhost:8787/?mp&room=test&name=Alpha` and `…name=Bravo`.

### B. Your home network (PC, laptop, phone on the same Wi-Fi)

```sh
npm run mp-server -- --port 8787 --host 0.0.0.0
```

1. Other devices open the **`network:`** address the server prints, e.g. `http://192.168.0.16:8787/?mp&room=home&name=Laptop`.
2. **Windows firewall:** allow the port once. Either accept the prompt the first time the server starts (choose *Private networks*), or run in an **administrator** PowerShell:

   ```powershell
   New-NetFirewallRule -DisplayName "VibePilot MP 8787" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private
   ```

   Linux: `sudo ufw allow 8787/tcp`.

### C. The internet: quick temporary address (no account, no router changes)

Keep the server on `127.0.0.1` and put a tunnel in front of it, pointing at **the same port**:

```sh
npm run mp-server -- --port 8787
cloudflared tunnel --url http://localhost:8787      # second terminal
```

`cloudflared` prints `https://<random>.trycloudflare.com`. Friends open `https://<random>.trycloudflare.com/?mp&room=friday&name=Anna`. The address changes on every start, so it suits a one-evening session. Install `cloudflared` with `winget install Cloudflare.cloudflared` on Windows, or see the Pi guide.

### D. The internet: permanent (Raspberry Pi or another always-on machine)

Run it as a service behind a Cloudflare Tunnel or Tailscale Funnel. The full walkthrough is in [server-setup-raspberry-pi.md](server-setup-raspberry-pi.md). To use a port other than 8787 there, change it in **both** places:

| Where | Setting |
|---|---|
| `/etc/systemd/system/vibepilot-mp.service` | `Environment=PORT=9000` |
| `/etc/cloudflared/config.yml` | `service: http://localhost:9000`, or `tailscale funnel --bg 9000` |

Then run `sudo systemctl daemon-reload && sudo systemctl restart vibepilot-mp cloudflared`.

> Don't expose the port directly with router port forwarding. Browsers on the `https` internet need `wss://`, which the tunnel provides.

## 4. Check that it runs

| Check | Expected |
|---|---|
| `http://localhost:<port>/health` | `{"uptimeS":…,"rooms":[…],"players":N}` |
| Server terminal | `+ Name#id → skies:room slot n (count)` for each player that joins |
| In the game | The roster panel under Targets says `● SHARED SKIES · ROOM … · N MS` |

## 5. Common problems

| Message / symptom | Fix |
|---|---|
| `Port 8787 is already in use` | Another server is running: close it, or use the suggested `--port`. |
| `No permission to use port 80` | Ports below 1024 need admin rights. Use 8787 (or similar), plus a tunnel for a clean address. |
| `Invalid port "…"` | Use a whole number from 1 to 65535. |
| Other devices can't open the page | Use `--host 0.0.0.0`, the `network:` address (not `localhost`), and the firewall rule from B. |
| Roster says `✕ MULTIPLAYER: protocol …` | The browser has old files cached: hard refresh (Ctrl+F5). |
| Roster stuck on `connecting…` | The server stopped, or you opened the game from another port or server (e.g. GitHub Pages or `npm run serve`). Open it from the multiplayer server's own address. |
