#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu server (e.g. a Vultr VPS) for Wise Piggy.
# First clone the repo to /opt/wise-piggy, then run this as root with your domain:
#
#   sudo git clone https://github.com/josie-collins/iku-hackathon.git /opt/wise-piggy
#   sudo bash /opt/wise-piggy/deploy/setup-server.sh yourdomain.com
#
# Installs Node 22, Caddy (automatic HTTPS) and a firewall, adds swap on small
# servers, creates a `wisepiggy` user to run the app, and installs the systemd
# service and the Caddyfile for your domain. Safe to run again.
set -euo pipefail

DOMAIN="${1:-}"
APP_USER=wisepiggy
APP_DIR=/opt/wise-piggy

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo bash $APP_DIR/deploy/setup-server.sh yourdomain.com" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo." >&2
  exit 1
fi
if [[ ! -f "$APP_DIR/code/backend/index.js" ]]; then
  echo "Clone the repo to $APP_DIR first:  sudo git clone <repo url> $APP_DIR" >&2
  exit 1
fi

echo "▸ Packages"
apt-get update -y
apt-get install -y git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw

echo "▸ Node 22"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "▸ Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# Building the React app needs more memory than a 1 GB server has.
if [[ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 1900000 ]] && ! swapon --show | grep -q .; then
  echo "▸ Adding 2 GB of swap (small server)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "▸ App user ($APP_USER) owns $APP_DIR"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR/code/backend/keys"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "▸ systemd service"
install -m 644 "$APP_DIR/deploy/wise-piggy.service" /etc/systemd/system/wise-piggy.service
systemctl daemon-reload
systemctl enable wise-piggy

echo "▸ Caddy for $DOMAIN"
sed "s/yourdomain\.com/$DOMAIN/g" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "▸ Firewall: SSH, HTTP and HTTPS only (the app's port 8080 stays private)"
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

cat <<EOF

✔ Server ready. Next:
  1. Copy your secrets from your laptop (never through git):
       scp code/backend/.env              root@SERVER_IP:$APP_DIR/code/backend/.env
       scp code/backend/keys/snowflake.p8 root@SERVER_IP:$APP_DIR/code/backend/keys/snowflake.p8
     then on the server:
       sudo chown -R $APP_USER:$APP_USER $APP_DIR/code/backend
       sudo chmod 600 $APP_DIR/code/backend/.env $APP_DIR/code/backend/keys/*
     In the server's .env, set a NEW JWT_SECRET (openssl rand -hex 32).
  2. Build and start:   sudo bash $APP_DIR/deploy/deploy.sh
  3. DNS for $DOMAIN: A record @ -> this server's IP, CNAME www -> $DOMAIN
     Caddy gets the HTTPS certificate as soon as DNS works: https://$DOMAIN
EOF
