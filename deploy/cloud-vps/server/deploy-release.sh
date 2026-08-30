#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/worldfert/app}"
DEPLOY_DIR="$APP_DIR/deploy/cloud-vps"

[ "$(id -u)" -eq 0 ] || { echo "ERROR: run with sudo/root" >&2; exit 1; }
[ -f "$DEPLOY_DIR/.env" ] || { echo "ERROR: missing $DEPLOY_DIR/.env" >&2; exit 2; }

cd "$DEPLOY_DIR"
sed -i 's/\r$//' .env
chmod 600 .env
bash "$DEPLOY_DIR/server/prepare-portainer.sh" "$APP_DIR"

required=(ROOT_DOMAIN APP_DOMAIN API_DOMAIN PORTAINER_DOMAIN MSSQL_DOMAIN MYSQL_DOMAIN VITE_API_BASE_URL CORS_ORIGIN MSSQL_SA_PASSWORD MYSQL_ROOT_PASSWORD MYSQL_PASSWORD JWT_SECRET)
for key in "${required[@]}"; do
  value=$(sed -n "s/^${key}=//p" .env | tail -1)
  if [ -z "$value" ] || [[ "$value" == CHANGE_ME* ]]; then
    echo "ERROR: $key is missing or still CHANGE_ME in .env" >&2
    exit 3
  fi
done

secret_keys=(MSSQL_SA_PASSWORD MYSQL_ROOT_PASSWORD MYSQL_PASSWORD WF_READER_PASSWORD WF_OWNER_PASSWORD JWT_SECRET MIGRATE_SECRET TS_INGEST_SECRET)
for key in "${secret_keys[@]}"; do
  value=$(sed -n "s/^${key}=//p" .env | tail -1)
  if [[ ! "$value" =~ ^[A-Za-z0-9_.:@%+,=-]+$ ]]; then
    echo "ERROR: $key contains shell/SQL-sensitive characters; use A-Z a-z 0-9 _ . : @ % + , = -" >&2
    exit 4
  fi
done

echo "[1/4] Validate Compose configuration"
docker compose config --quiet

echo "[2/4] Build and start containers"
docker compose up -d --build --remove-orphans

echo "[3/4] Wait for database and API health"
containers=(wf-mssql wf-mysql wf-backend wf-portainer)
for container in "${containers[@]}"; do
  healthy=0
  for _ in $(seq 1 60); do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)
    if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then healthy=1; break; fi
    sleep 5
  done
  [ "$healthy" -eq 1 ] || { docker logs --tail 80 "$container"; echo "ERROR: $container is not healthy" >&2; exit 1; }
  echo "  ok: $container"
done

echo "[4/4] Install/update Sunday backup schedule"
bash "$DEPLOY_DIR/server/install-weekly-backup.sh" "$APP_DIR"
bash "$DEPLOY_DIR/server/health-check.sh" "$APP_DIR" --local-only

echo "DEPLOY OK"
