#!/usr/bin/env bash
# Pull the latest multiplayer branch on the Pi and restart the server.
#   sudo /opt/vibepilot/app/server/deploy/update.sh
set -euo pipefail
APP=/opt/vibepilot/app
sudo -u vibepilot git -C "$APP" pull --ff-only
sudo -u vibepilot npm ci --omit=dev --prefix "$APP"
systemctl restart vibepilot-mp
sleep 1
curl -fsS http://127.0.0.1:8787/health && echo
