#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/worldfert/app}"
LOCAL_ONLY="${2:-}"
ENV_FILE="$APP_DIR/deploy/cloud-vps/.env"
[ -f "$ENV_FILE" ] || { echo "ERROR: missing $ENV_FILE" >&2; exit 2; }
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

cd "$APP_DIR/deploy/cloud-vps"
docker compose ps

for c in wf-mssql wf-mysql wf-backend; do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null || true)
  [ "$status" = healthy ] || { echo "ERROR: $c health=$status" >&2; exit 1; }
done

for c in wf-caddy wf-frontend wf-portainer; do
  status=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || true)
  [ "$status" = running ] || { echo "ERROR: $c status=$status" >&2; exit 1; }
done

curl -fsS http://127.0.0.1/api/health >/dev/null || curl -fkSs "https://${API_DOMAIN}/api/health" >/dev/null

if [ "$LOCAL_ONLY" != "--local-only" ]; then
  curl -fsS "https://${API_DOMAIN}/api/health" >/dev/null
  curl -fsSI "https://${APP_DOMAIN}" >/dev/null
  curl -fsSI "https://${PORTAINER_DOMAIN}" >/dev/null
  curl -fsSI "https://${ROOT_DOMAIN}" >/dev/null
fi

STATUS_FILE="${TRANSFER_ROOT:-/srv/wf-transfer}/manifests/last-backup-status.txt"
if [ -f "$STATUS_FILE" ]; then
  age=$(( $(date +%s) - $(stat -c %Y "$STATUS_FILE") ))
  [ "$age" -le 691200 ] || echo "WARNING: latest successful backup status is older than 8 days"
else
  echo "WARNING: no successful backup status yet; run 06-run-backup-now.bat"
fi
echo "HEALTH CHECK OK"
