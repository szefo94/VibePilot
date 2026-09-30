# Server setup: Raspberry Pi 5

This guide turns a Raspberry Pi 5 into the VibePilot multiplayer server, reachable from anywhere at an `https://` address. That is test stages 3–4 in the [multiplayer plan](../../MULTIPLAYER.md). Do [test 1](test-1-two-tabs.md) first.

**Result:** friends open `https://<your-address>/?mp&room=friday&name=Anna` and fly together. The Pi serves both the game and the multiplayer connection. GitHub Pages stays single-player.

**Time:** about 1 hour. **Your hardware:** a Pi 5 with 16 GB, far more than needed.

## What you need

| Item | Notes |
|---|---|
| Raspberry Pi 5 (16 GB) | 2 GB would be enough; the rest leaves room for a future server-side co-op simulation |
| Official 27 W USB-C power supply | Under-powered Pi 5s throttle and reboot |
| Active Cooler (or a case with a fan) | The Pi 5 runs hot under load |
| microSD card (32 GB+, A2) or NVMe SSD on an M.2 HAT | An SSD is more robust for a 24/7 server |
| **Ethernet cable** to the router | Wi-Fi works but adds lag spikes |
| A PC with Raspberry Pi Imager | To flash the system |
| For a permanent address: **a domain** (~€10/year) on a free Cloudflare account | Not needed with option B in step 8 |

**How the Pi is reached:**

```text
 Player's browser ──https / wss──▶ Cloudflare (TLS) ──tunnel (outbound from the Pi)──▶ Pi :8787
```

No router ports are opened, and it works even if your ISP shares IP addresses between customers (CGNAT).

## Step 1: Flash the system

1. Install **Raspberry Pi Imager** on your PC and insert the card (or the SSD in a USB adapter).
2. Choose Device **Raspberry Pi 5**, OS **Raspberry Pi OS Lite (64-bit)** (under *Raspberry Pi OS (other)*), and your card.
3. **Edit settings**, then fill in:
   - **General:** hostname `vibepilot`; a username and password (this guide uses `marcin`); your timezone and keyboard layout.
   - **Services:** enable SSH and choose **Allow public-key authentication only**, then paste your public key. On Windows it is `C:\Users\Marcin\.ssh\id_ed25519.pub`; create one with `ssh-keygen -t ed25519` if you don't have it.
4. Write the card. Put it in the Pi, connect Ethernet and power it on. The first boot takes about 2 minutes.

## Step 2: First login and updates

From your PC:

```sh
ssh marcin@vibepilot.local
```

If `vibepilot.local` isn't found, look up the Pi's IP in your router's device list and use `ssh marcin@192.168.x.x`.

On the Pi:

```sh
sudo apt update && sudo apt full-upgrade -y
sudo reboot
```

In your router's admin page, give the Pi a **fixed address** (the setting is usually called DHCP reservation or static lease).

## Step 3: Basic security

```sh
# SSH: keys only, no passwords
echo "PasswordAuthentication no" | sudo tee /etc/ssh/sshd_config.d/10-hardening.conf
sudo systemctl restart ssh

# Firewall: only SSH comes in (the tunnel is outbound, the game port stays local)
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw enable

# Automatic security updates
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # answer Yes
```

Log in from a second terminal before closing the first one, to make sure SSH still works.

## Step 4: Node.js and git

```sh
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs git
node -v        # v22 or newer
```

## Step 5: Install the game server

A dedicated `vibepilot` user runs the server with no login and no sudo rights:

```sh
sudo useradd --system --create-home --home-dir /opt/vibepilot --shell /usr/sbin/nologin vibepilot
sudo -u vibepilot git clone -b multiplayer https://github.com/szefo94/VibePilot.git /opt/vibepilot/app
sudo -u vibepilot npm ci --omit=dev --prefix /opt/vibepilot/app
```

Try it once by hand:

```sh
cd /opt/vibepilot/app && sudo -u vibepilot HOST=0.0.0.0 node server/server.mjs
```

On your PC, open `http://vibepilot.local:8787/?mp&room=test&name=Alpha`. **That is test stage 2**: add a second device such as a laptop or phone on the same Wi-Fi. Stop the server with **Ctrl+C** when done.

> The `multiplayer` branch must be pushed to GitHub for the clone to work. Until then, copy the project over with `scp -r` or a USB stick.

## Step 6: Run it as a service

The service starts at boot and restarts itself after a crash:

```sh
sudo cp /opt/vibepilot/app/server/deploy/vibepilot-mp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vibepilot-mp
systemctl status vibepilot-mp            # should say "active (running)"
curl http://127.0.0.1:8787/health        # {"uptimeS":…,"rooms":[],"players":0}
journalctl -u vibepilot-mp -f            # live log (Ctrl+C to leave)
```

The service listens on `127.0.0.1` only; the tunnel in step 7 is the way in. For LAN-only play without a tunnel, change `HOST=127.0.0.1` to `HOST=0.0.0.0` in `/etc/systemd/system/vibepilot-mp.service`, then run `sudo systemctl daemon-reload && sudo systemctl restart vibepilot-mp` and `sudo ufw allow 8787/tcp`.

## Step 7: A public HTTPS address

Choose **one** option.

### Option A: Cloudflare Tunnel with your own domain (recommended, permanent)

Preparation, in the browser:
1. Buy a domain from any registrar (or at Cloudflare).
2. Add it to a free Cloudflare account and switch the domain's nameservers to Cloudflare's. The switch can take up to a few hours.

On the Pi:

```sh
# Install cloudflared from Cloudflare's apt repository
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(. /etc/os-release && echo $VERSION_CODENAME) main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared

# Log in (prints a link: open it on your PC and choose the domain)
cloudflared tunnel login

# Create the tunnel and its DNS name
cloudflared tunnel create vibepilot            # note the tunnel ID it prints
cloudflared tunnel route dns vibepilot mp.yourdomain.com
```

Configure it as a system service:

```sh
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/<TUNNEL-ID>.json /etc/cloudflared/
sudo nano /etc/cloudflared/config.yml
```

```yaml
tunnel: <TUNNEL-ID>
credentials-file: /etc/cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: mp.yourdomain.com
    service: http://localhost:8787
  - service: http_status:404
```

```sh
sudo cloudflared service install
sudo systemctl status cloudflared      # active (running)
```

Test from any device: `https://mp.yourdomain.com/health` shows JSON, and `https://mp.yourdomain.com/?mp&room=test&name=Alpha` plays. WebSockets work through the tunnel with no extra settings.

### Option B: Tailscale Funnel (free, no domain)

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up                       # opens a login link
sudo tailscale funnel --bg 8787
tailscale funnel status                 # shows https://vibepilot.<your-tailnet>.ts.net
```

In the Tailscale admin console, enable **HTTPS certificates** and **Funnel** for the machine if prompted. Your address is `https://vibepilot.<tailnet>.ts.net/?mp`.

### Option C: quick temporary test (no account)

```sh
cloudflared tunnel --url http://localhost:8787
```

This prints a random `https://….trycloudflare.com` address that works until you press Ctrl+C. Good for a one-evening test.

## Step 8: Play

Share the address with friends:

```text
https://mp.yourdomain.com/?mp&room=friday&name=YourName
```

Everyone must use the **same room name**. **That is test stage 3** (you, through the Pi), then **stage 4** (friends).

## Maintenance

**Update to the latest `multiplayer` branch:**

```sh
sudo bash /opt/vibepilot/app/server/deploy/update.sh
```

This pulls, installs dependencies, restarts the server and prints `/health`. Players are disconnected for a few seconds and rejoin by themselves.

| Task | Command |
|---|---|
| Live log | `journalctl -u vibepilot-mp -f` |
| Who is playing | `curl -s localhost:8787/health` |
| Restart | `sudo systemctl restart vibepilot-mp` |
| Temperature | `vcgencmd measure_temp` (keep under ~70 °C) |
| System updates | Automatic (step 3); `sudo apt full-upgrade` occasionally, then reboot |

**Backups:** none needed. The server stores nothing; re-cloning restores it completely. Keep a copy of `/etc/cloudflared/` (the tunnel credentials) if you use option A.

## Troubleshooting

| Symptom | Check |
|---|---|
| `/health` works on the Pi but not from outside | `systemctl status cloudflared` (or `tailscale funnel status`). Wait a few minutes after creating the DNS name. |
| Page loads, but the roster says `connecting…` | Open the browser console (F12). A WebSocket error usually means an old `?mp=ws://…` in the address: use plain `?mp`. |
| `protocol X ≠ server Y` | The browser cached old files: hard refresh (Ctrl+F5). Or the Pi runs an older version: run `update.sh`. |
| Service keeps restarting | `journalctl -u vibepilot-mp -n 50`. Commonly `npm ci` wasn't run, or the path in the unit file is wrong. |
| Lag spikes for everyone | Use Ethernet instead of Wi-Fi; check your upload speed (about 1–2 Mbit/s per full room). |
| The Pi is slow or reboots | Use the official 27 W power supply; check `vcgencmd get_throttled` (it should print `0x0`). |

## Capacity of your Pi 5

- **CPU and RAM:** a relay room of 8 players uses a few percent of one core and about 60 MB of RAM. A Pi 5 handles dozens of rooms.
- **Bandwidth:** your home **upload** speed is the real limit, about 1–2 Mbit/s per full room. A 20 Mbit/s upload covers roughly 10 rooms.
- **Headroom:** 16 GB and 4 cores leave room for running the co-op enemy simulation on the Pi itself later (phase 3, optional).
