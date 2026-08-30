#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/worldfert/app}"
ENV_FILE="$APP_DIR/deploy/cloud-vps/.env"
[ "$(id -u)" -eq 0 ] || { echo "ERROR: run with sudo/root" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "ERROR: missing $ENV_FILE" >&2; exit 2; }

password_file=$(sed -n 's/^PORTAINER_ADMIN_PASSWORD_FILE=//p' "$ENV_FILE" | tail -1)
password_file="${password_file:-/opt/worldfert/secrets/portainer/admin-password}"
case "$password_file" in
  /opt/worldfert/secrets/portainer/*) ;;
  *) echo "ERROR: PORTAINER_ADMIN_PASSWORD_FILE must stay under /opt/worldfert/secrets/portainer" >&2; exit 3 ;;
esac

install -d -m 700 "$(dirname "$password_file")"
if [ ! -s "$password_file" ]; then
  umask 077
  openssl rand -hex 24 > "$password_file"
fi
chown root:root "$password_file"
chmod 600 "$password_file"
echo "Portainer credential file ready: $password_file"
