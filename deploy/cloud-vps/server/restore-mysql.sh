#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/worldfert/app}"
ENV_FILE="$APP_DIR/deploy/cloud-vps/.env"
DUMP_FILE="${1:-}"
CONFIRM="${2:-}"
[ -f "$ENV_FILE" ] || { echo "ERROR: missing $ENV_FILE" >&2; exit 2; }
[ -n "$DUMP_FILE" ] && [ -f "$DUMP_FILE" ] || { echo "Usage: restore-mysql.sh /path/file.sql[.gz] --confirm-replace" >&2; exit 2; }
[ "$CONFIRM" = "--confirm-replace" ] || { echo "ERROR: destructive restore requires --confirm-replace" >&2; exit 3; }

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

DB="${MYSQL_DATABASE:-db_truckscale}"
APP_USER="${MYSQL_USER:-wfapp}"
OUT="${TRANSFER_ROOT:-/srv/wf-transfer}/outgoing/mysql"
STAMP="$(date '+%Y%m%d_%H%M%S')"
log() { printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"; }
my() { docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" -i wf-mysql mysql -u root --ssl-mode=REQUIRED "$@"; }

log "Verify SHA-256 manifest"
bash "$APP_DIR/deploy/cloud-vps/server/verify-upload.sh" "$DUMP_FILE"
[[ "$DUMP_FILE" == *.sql || "$DUMP_FILE" == *.sql.gz ]] || { echo "ERROR: expected .sql or .sql.gz" >&2; exit 2; }
my -e "SELECT VERSION();" >/dev/null

TABLES=$(my -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB';" | tr -d '\r')
if [ "${TABLES:-0}" -gt 0 ]; then
  log "Create pre-restore MySQL safety dump"
  mkdir -p "$OUT"
  SAFE="${DB}_pre-restore_${STAMP}.sql.gz"
  docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" wf-mysql mysqldump \
    -u root --single-transaction --quick --routines --triggers --events "$DB" | gzip -1 > "$OUT/$SAFE"
  gzip -t "$OUT/$SAFE"
  (cd "$OUT" && sha256sum "$SAFE" > "$SAFE.sha256")
  chmod 644 "$OUT/$SAFE" "$OUT/$SAFE.sha256"
fi

log "Drop and recreate $DB"
my -e "DROP DATABASE IF EXISTS \`$DB\`; CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

log "Import dump"
if [[ "$DUMP_FILE" == *.gz ]]; then
  gunzip -c "$DUMP_FILE" | my --default-character-set=utf8mb4 "$DB"
else
  my --default-character-set=utf8mb4 "$DB" < "$DUMP_FILE"
fi

log "Restore application grant and verify"
my -e "CREATE USER IF NOT EXISTS '$APP_USER'@'%' IDENTIFIED BY '$MYSQL_PASSWORD';
       ALTER USER '$APP_USER'@'%' IDENTIFIED BY '$MYSQL_PASSWORD';
       GRANT SELECT,INSERT,UPDATE,DELETE ON \`$DB\`.* TO '$APP_USER'@'%'; FLUSH PRIVILEGES;"
my -e "SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema='$DB';"
if my "$DB" -e "SELECT COUNT(*) AS tblscale_rows FROM tblscale;"; then :; else echo "WARNING: tblscale not found; verify the selected dump"; fi
echo "MYSQL RESTORE OK"

