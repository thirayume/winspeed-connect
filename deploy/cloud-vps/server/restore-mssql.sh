#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/worldfert/app}"
ENV_FILE="$APP_DIR/deploy/cloud-vps/.env"
BACKUP_FILE="${1:-}"
CONFIRM="${2:-}"
[ -f "$ENV_FILE" ] || { echo "ERROR: missing $ENV_FILE" >&2; exit 2; }
[ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ] || { echo "Usage: restore-mssql.sh /path/file.bak[.gz] --confirm-replace" >&2; exit 2; }
[ "$CONFIRM" = "--confirm-replace" ] || { echo "ERROR: destructive restore requires --confirm-replace" >&2; exit 3; }

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

TRANSFER_ROOT="${TRANSFER_ROOT:-/srv/wf-transfer}"
WORK="$TRANSFER_ROOT/work/mssql"
DB="${DB_NAME:-dbwins_worldfert9}"
mkdir -p "$WORK"

log() { printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"; }
cleanup() { rm -f "${WORK_FILE:-}"; }
trap cleanup EXIT

log "Verify SHA-256 manifest"
bash "$APP_DIR/deploy/cloud-vps/server/verify-upload.sh" "$BACKUP_FILE"

FREE_MB=$(df -Pm "$TRANSFER_ROOT" | awk 'NR==2{print $4}')
[ "$FREE_MB" -ge 12288 ] || { echo "ERROR: require at least 12 GB free before MSSQL restore" >&2; exit 1; }

BASE=$(basename "$BACKUP_FILE")
RAW_BASE="${BASE%.gz}"
[[ "$RAW_BASE" == *.bak ]] || { echo "ERROR: expected .bak or .bak.gz" >&2; exit 2; }
WORK_FILE="$WORK/restore_${RAW_BASE}"
log "Stage backup in protected work directory"
if [[ "$BACKUP_FILE" == *.gz ]]; then gunzip -c "$BACKUP_FILE" > "$WORK_FILE"; else cp -f "$BACKUP_FILE" "$WORK_FILE"; fi
chown 10001:root "$WORK_FILE"
chmod 640 "$WORK_FILE"
CONTAINER_FILE="/var/opt/mssql/backup/work/$(basename "$WORK_FILE")"

SQLCMD=$(docker exec wf-mssql bash -lc 'command -v /opt/mssql-tools18/bin/sqlcmd || command -v /opt/mssql-tools/bin/sqlcmd' | tr -d '\r')
[ -n "$SQLCMD" ] || { echo "ERROR: sqlcmd not found" >&2; exit 1; }
q() { docker exec wf-mssql "$SQLCMD" -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b "$@"; }

log "Read logical file names and check SQL Server Express limit"
FL=$(q -h -1 -W -s'|' -Q "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK='$CONTAINER_FILE'" | tr -d '\r')
DATA_LOGICAL=$(printf '%s\n' "$FL" | awk -F'|' '$3=="D"{print $1;exit}')
LOG_LOGICAL=$(printf '%s\n' "$FL" | awk -F'|' '$3=="L"{print $1;exit}')
DATA_MB=$(printf '%s\n' "$FL" | awk -F'|' '$3=="D"{s+=$5}END{printf "%.0f",s/1048576}')
[ -n "$DATA_LOGICAL" ] && [ -n "$LOG_LOGICAL" ] || { echo "ERROR: cannot read logical names" >&2; exit 1; }
EDITION=$(q -h -1 -W -Q "SET NOCOUNT ON; SELECT CAST(SERVERPROPERTY('Edition') AS VARCHAR(80))" | head -1 | tr -d '\r')
echo "Edition=$EDITION; data=${DATA_MB} MB"
if echo "$EDITION" | grep -qi Express && [ "$DATA_MB" -ge 10240 ]; then
  echo "ERROR: backup exceeds SQL Server Express 10 GB per-database limit" >&2
  exit 1
fi

log "Verify SQL Server backup structure"
# The upload already has an independently verified SHA-256 manifest. Do not
# request WITH CHECKSUM here because legacy backups may not contain SQL Server
# backup checksums; RESTORE VERIFYONLY still validates that the backup is readable.
q -Q "RESTORE VERIFYONLY FROM DISK='$CONTAINER_FILE';"

if q -h -1 -W -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.databases WHERE name='$DB'" | grep -q 1; then
  log "Create verified pre-restore safety backup"
  bash "$APP_DIR/deploy/cloud-vps/server/backup-databases.sh" "$APP_DIR" --tag pre-restore
fi

log "Restore $DB (existing data will be replaced)"
q -Q "IF DB_ID('$DB') IS NOT NULL ALTER DATABASE [$DB] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      RESTORE DATABASE [$DB] FROM DISK='$CONTAINER_FILE'
      WITH MOVE '$DATA_LOGICAL' TO '/var/opt/mssql/data/${DB}.mdf',
           MOVE '$LOG_LOGICAL' TO '/var/opt/mssql/data/${DB}_log.ldf',
           REPLACE, RECOVERY, STATS=5;
      ALTER DATABASE [$DB] SET MULTI_USER;
      ALTER DATABASE [$DB] SET RECOVERY SIMPLE;"

log "Finalize application principals, migrations, seed and database checks"
APP_DIR="$APP_DIR" bash "$APP_DIR/deploy/cloud-vps/server/finalize-mssql.sh"
echo "MSSQL RESTORE OK"
