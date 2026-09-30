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

Open `http://localhost:8787/`. The bare address goes straight into multiplayer: team deathmatch (`?mp=tdm`, room `lobby`), Red against Blue with five pilots a side, where bots fill any place a player hasn't taken. Other modes are `?mp=pvp` (everyone for themselves), `?mp=coop` and `?mp=skies`. You play under a random callsign such as "Ghost Hornet" (remembered); change it with **Callsign** in the start or pause menu. Stop the server with **Ctrl+C**.

The server window logs every player who joins or leaves, with their IP address and rough location, for example `+ Ghost Hornet#3 → tdm:lobby slot 1 team Blue (2) from 88.1.2.3 (Wroclaw, Lower Silesia, Poland · Vectra S.A)`. The location comes from ip-api.com: each new public IP is sent there once. To log IPs only, start with `--no-geo`. Behind a tunnel or reverse proxy (Cloudflare, nginx), add `--trust-proxy` to log the players' IPs rather than the proxy's.

Address options:

| Address | Result |
|---|---|
| `http://<server>:<port>/` | PvP + co-op in room `lobby` |
| `…/?mp=coop` / `…/?mp=skies` | Co-op without damage between players / just flying together |
| `…/?room=friday` | Room `friday` (a separate world) |
| `…/?name=Anna` | Joins as Anna |
| `…/?sp` | The normal single-player game |

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
| `--tls` | off | Serve `https://` with a self-signed certificate (see [HTTPS](#https)) |
| `--public <hosts>` | – | Public IPs or names to include in that certificate, e.g. `88.156.90.62` |
| `--tls-cert <file>` + `--tls-key <file>` | – | Use your own certificate instead |
| `--origins <list>` | any | Extra websites allowed to connect, comma-separated (only needed if the game is served from somewhere else) |
| `--help` (`-h`) | – | Show the options |

**Environment variables** do the same (for services and scripts); command-line options win:

| Shell | Example |
|---|---|
| PowerShell | `$env:PORT=9000; $env:HOST='0.0.0.0'; npm run mp-server` |
| bash | `PORT=9000 HOST=0.0.0.0 npm run mp-server` |
| systemd | `Environment=PORT=9000` in the unit file |

**Players use the same port in the address:** `http://<server>:9000/`. Nothing else needs configuring. The game connects back to the port it was loaded from.

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

### HTTPS

Plain `http://` works on home networks and most phones. But **VPNs, company networks and security software often allow only encrypted traffic on port 443**, and some browsers insist on `https://`. Serve HTTPS instead:

```sh
npm run mp-server -- --port 8443 --host 0.0.0.0 --tls --public 88.156.90.62
```

- The certificate is generated **once** (including localhost, your LAN IPs and every `--public` address) and reused on later starts. It is stored in `~/.vibepilot/certs/`, outside the repo.
- It is self-signed, so **each browser shows a warning once**: *Advanced → Proceed to … (unsafe)*. After that, the game and its `wss://` connection work.
- For no warning at all, use a real certificate for a domain via `--tls-cert` / `--tls-key`, or a tunnel (setup D or E).

### C. The internet: port forwarding on your router (this PC)

Use this if your router forwards a public port to this PC (e.g. public `88.156.90.62:443` → `192.168.0.16`).

1. **Router:** forward TCP `443` to this PC's address (the `network:` line printed by the server), and give the PC a fixed address (DHCP reservation).
2. **Windows firewall** (once, in an **administrator** PowerShell). It must include the **Public** profile if your Wi-Fi is set to Public:

   ```powershell
   New-NetFirewallRule -DisplayName "VibePilot MP" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -Profile Public,Private -Program (Get-Command node).Source
   ```

   Turn it off and on with `Disable-NetFirewallRule -DisplayName "VibePilot MP"` and `Enable-NetFirewallRule -DisplayName "VibePilot MP"`.
3. **Start** on the **internal** port your router forwards to (check the router: public 443 is often forwarded to e.g. 8443), with HTTPS:

   ```sh
   npm run mp-server -- --port 8443 --host 0.0.0.0 --tls --public <public-ip>
   ```

   The firewall rule in step 2 must use that same internal port.
4. **Test from outside:** use a phone on **mobile data** (Wi-Fi off). Your public IP often doesn't work from inside your own network. Open `https://<public-ip>/health`, accept the warning once, then open `https://<public-ip>/`.
5. **Share** `https://<public-ip>/`. Without `--tls`, share `http://<public-ip>:443/` instead (with `http://` typed explicitly), but that version is blocked by some VPNs and browsers.

Notes:
- Anyone with the address can join. Stop the server and disable the rule when you're not playing.
- A changing public IP means new links. A dynamic DNS name (e.g. DuckDNS) avoids that.
- A connected VPN can break incoming connections; disconnect it while hosting.

### D. The internet: quick temporary address (no account, no router changes)

Keep the server on `127.0.0.1` and put a tunnel in front of it, pointing at **the same port**:

```sh
npm run mp-server -- --port 8787
cloudflared tunnel --url http://localhost:8787      # second terminal
```

`cloudflared` prints `https://<random>.trycloudflare.com`. Friends open that address. The address changes on every start, so it suits a one-evening session. Install `cloudflared` with `winget install Cloudflare.cloudflared` on Windows, or see the Pi guide.

### E. The internet: permanent (Raspberry Pi or another always-on machine)

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
| Works on the phone, not on a PC with a VPN | The VPN drops plain HTTP on port 443: start with `--tls` and use `https://`. |
| Other devices can't open the page | Use `--host 0.0.0.0`, the `network:` address (not `localhost`), and the firewall rule from B or C. On Windows, check that the rule exists: `Get-NetFirewallRule -DisplayName "VibePilot MP"`. |
| Roster says `✕ MULTIPLAYER: protocol …` | The browser has old files cached: hard refresh (Ctrl+F5). |
| Roster stuck on `connecting…` | The server stopped, or you opened the game from another port or server (e.g. GitHub Pages or `npm run serve`). Open it from the multiplayer server's own address. |
