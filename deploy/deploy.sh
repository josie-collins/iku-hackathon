#!/usr/bin/env bash
# Build and (re)start Wise Piggy on the server. Run it for the first deploy and
# after every update:
#
#   sudo bash /opt/wise-piggy/deploy/deploy.sh          # use the code already there
#   sudo bash /opt/wise-piggy/deploy/deploy.sh --pull   # git pull first
set -euo pipefail

APP_USER=wisepiggy
APP_DIR=/opt/wise-piggy
as_app() { sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && $1"; }

if [[ "${1:-}" == "--pull" ]]; then
  echo "▸ git pull"
  as_app "git pull --ff-only"
fi

if [[ ! -f "$APP_DIR/code/backend/.env" ]]; then
  echo "✖ $APP_DIR/code/backend/.env is missing. Copy it from your laptop first (see deploy/README.md)." >&2
  exit 1
fi

echo "▸ Backend packages"
as_app "cd code/backend && npm ci --omit=dev --no-audit --no-fund"
echo "▸ Frontend packages and build"
as_app "cd code/frontend && npm ci --no-audit --no-fund && npm run build"

echo "▸ Restart"
systemctl restart wise-piggy
sleep 2
if curl -fsS http://localhost:8080/api/health >/dev/null; then
  echo "✔ Wise Piggy is running. Logs: journalctl -u wise-piggy -f"
else
  echo "✖ The app didn't answer on port 8080. Check: journalctl -u wise-piggy -n 50" >&2
  exit 1
fi
