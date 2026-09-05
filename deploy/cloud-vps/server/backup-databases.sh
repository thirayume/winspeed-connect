#!/usr/bin/env bash
# Verified weekly backup for MSSQL + MySQL. Output is downloadable through SFTP.
set -euo pipefail

APP_DIR="${1:-/opt/worldfert/app}"
shift || true
ENV_FILE="$APP_DIR/deploy/cloud-vps/.env"
[ -f "$ENV_FILE" ] || { echo "ERROR: missing $ENV_FILE" >&2; exit 2; }
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

DRY_RUN=0
TAG="weekly"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --tag) shift; TAG="${1:-manual}" ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

TRANSFER_ROOT="${TRANSFER_ROOT:-/srv/wf-transfer}"
OUT="$TRANSFER_ROOT/outgoing"
WORK="$TRANSFER_ROOT/work"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-70}"
MIN_FREE_GB="${BACKUP_MIN_FREE_GB:-12}"
MSSQL_DB="${DB_NAME:-dbwins_worldfert9}"
MYSQL_DB="${MYSQL_DATABASE:-db_truckscale}"
STAMP="$(date '+%Y%m%d_%H%M%S')"
LOCK=/run/lock/worldfert-db-backup.lock

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

exec 9>"$LOCK"
flock -n 9 || fail "another backup is already running"
install -d -m 755 "$OUT/mssql" "$OUT/mysql" "$TRANSFER_ROOT/manifests" "$WORK/mssql"

FREE_GB=$(df -Pm "$TRANSFER_ROOT" | awk 'NR==2{printf "%d",$4/1024}')
log "disk free ${FREE_GB} GB; required minimum ${MIN_FREE_GB} GB"
[ "$FREE_GB" -ge "$MIN_FREE_GB" ] || fail "insufficient free disk"

# MySQL was removed on 2026-09-04. This script runs from the weekly cron,
# so leaving wf-mysql here would fail the backup every Sunday.
for container in wf-mssql; do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || true)
  [ "$status" = healthy ] || fail "$container is not healthy"
done

if [ "$DRY_RUN" -eq 1 ]; then
  log "DRY RUN OK: containers, paths and disk space are ready"
  exit 0
fi

SQLCMD=$(docker exec wf-mssql bash -lc 'command -v /opt/mssql-tools18/bin/sqlcmd || command -v /opt/mssql-tools/bin/sqlcmd' | tr -d '\r')
[ -n "$SQLCMD" ] || fail "sqlcmd not found"

MSSQL_BASE="${MSSQL_DB}_${TAG}_${STAMP}.bak"
MSSQL_HOST_RAW="$WORK/mssql/$MSSQL_BASE"
MSSQL_CONTAINER_RAW="/var/opt/mssql/backup/work/$MSSQL_BASE"
rm -f "$MSSQL_HOST_RAW" "$MSSQL_HOST_RAW.gz"
log "MSSQL backup -> $MSSQL_BASE.gz"
if ! docker exec wf-mssql "$SQLCMD" -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b -Q \
  "BACKUP DATABASE [$MSSQL_DB] TO DISK='$MSSQL_CONTAINER_RAW' WITH INIT, COMPRESSION, CHECKSUM, STATS=10"; then
  log "MSSQL native compression unavailable; retry without COMPRESSION"
  docker exec wf-mssql "$SQLCMD" -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b -Q \
    "BACKUP DATABASE [$MSSQL_DB] TO DISK='$MSSQL_CONTAINER_RAW' WITH INIT, CHECKSUM, STATS=10"
fi
docker exec wf-mssql "$SQLCMD" -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b -Q \
  "RESTORE VERIFYONLY FROM DISK='$MSSQL_CONTAINER_RAW'"
gzip -1 -c "$MSSQL_HOST_RAW" > "$OUT/mssql/$MSSQL_BASE.gz.part"
gzip -t "$OUT/mssql/$MSSQL_BASE.gz.part"
mv -f "$OUT/mssql/$MSSQL_BASE.gz.part" "$OUT/mssql/$MSSQL_BASE.gz"
rm -f "$MSSQL_HOST_RAW"
(cd "$OUT/mssql" && sha256sum "$MSSQL_BASE.gz" > "$MSSQL_BASE.gz.sha256")
chmod 644 "$OUT/mssql/$MSSQL_BASE.gz" "$OUT/mssql/$MSSQL_BASE.gz.sha256"

# MySQL backup block removed 2026-09-04 with the MySQL integration.

find "$OUT/mssql" "$OUT/mysql" -type f -mtime +"$RETAIN_DAYS" -delete

cat > "$TRANSFER_ROOT/manifests/last-backup-status.txt" <<EOF
status=OK
completed_at=$(date --iso-8601=seconds)
mssql=/outgoing/mssql/$MSSQL_BASE.gz
mysql=/outgoing/mysql/$MYSQL_BASE
retention_days=$RETAIN_DAYS
EOF
chmod 644 "$TRANSFER_ROOT/manifests/last-backup-status.txt"
log "BACKUP OK"

