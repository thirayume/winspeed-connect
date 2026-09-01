#!/usr/bin/env bash
# Clone the live MSSQL/MySQL databases to isolated test database names on the
# same Docker host. Production database names are never dropped or replaced.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/worldfert/app}"
ENV_FILE="$APP_DIR/deploy/cloud-vps/.env"
MODE="${1:-all}"
MSSQL_TARGET_ARG="${2:-}"
MYSQL_TARGET_ARG="${3:-}"
CONFIRM="${4:-}"

[ "$(id -u)" -eq 0 ] || { echo "ERROR: run with sudo/root" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "ERROR: missing $ENV_FILE" >&2; exit 2; }

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

case "$MODE" in
  all|mssql|mysql) ;;
  *) echo "ERROR: mode must be all, mssql or mysql" >&2; exit 2 ;;
esac

MSSQL_SOURCE="${DB_NAME:-dbwins_worldfert9}"
MYSQL_SOURCE="${MYSQL_DATABASE:-db_truckscale}"
MSSQL_TARGET="${MSSQL_TARGET_ARG:-${MSSQL_TEST_DATABASE:-${MSSQL_SOURCE}_test}}"
MYSQL_TARGET="${MYSQL_TARGET_ARG:-${MYSQL_TEST_DATABASE:-${MYSQL_SOURCE}_test}}"
TRANSFER_ROOT="${TRANSFER_ROOT:-/srv/wf-transfer}"
WORK="$TRANSFER_ROOT/work"
OUT="$TRANSFER_ROOT/outgoing"
STATUS_FILE="$TRANSFER_ROOT/manifests/last-test-clone-status.txt"
STAMP="$(date '+%Y%m%d_%H%M%S')"
DRY_RUN=0

[ "$CONFIRM" = "--dry-run" ] && DRY_RUN=1
if [ "$DRY_RUN" -eq 0 ] && [ "$CONFIRM" != "--confirm-replace-test" ]; then
  echo "ERROR: test databases may be replaced; add --confirm-replace-test" >&2
  exit 3
fi

log() { printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

valid_db_name() {
  [[ "${1:-}" =~ ^[A-Za-z][A-Za-z0-9_]{0,127}$ ]]
}

is_test_name() {
  local lower="${1,,}"
  [[ "$lower" =~ (^test_|_(test|qa|uat|sandbox)(_|$)) ]]
}

validate_target() {
  local engine="$1" source="$2" target="$3"
  valid_db_name "$source" || fail "$engine source database name is unsupported: $source"
  valid_db_name "$target" || fail "$engine test database name must use letters, digits and underscore only"
  [ "${source,,}" != "${target,,}" ] || fail "$engine target must not equal the production database"
  is_test_name "$target" || fail "$engine target must contain a test marker: test, qa, uat or sandbox"
}

validate_target MSSQL "$MSSQL_SOURCE" "$MSSQL_TARGET"
validate_target MySQL "$MYSQL_SOURCE" "$MYSQL_TARGET"

install -d -m 755 "$WORK/mssql" "$WORK/mysql" "$OUT/mssql" "$OUT/mysql" "$TRANSFER_ROOT/manifests"

# Share the production backup lock so a weekly backup and a test clone cannot
# compete for disk and database I/O at the same time.
exec 9>/run/lock/worldfert-db-backup.lock
flock -n 9 || fail "another backup or clone operation is already running"

for container in wf-mssql wf-mysql; do
  case "$MODE:$container" in
    mssql:wf-mysql|mysql:wf-mssql) continue ;;
  esac
  health="$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || true)"
  [ "$health" = healthy ] || fail "$container is not healthy"
done

SQLCMD=""
MSSQL_SOURCE_HOST=""
MYSQL_SOURCE_DUMP=""
clone_status="FAILED"

write_status() {
  cat > "$STATUS_FILE" <<EOF
status=$clone_status
completed_at=$(date --iso-8601=seconds)
mode=$MODE
mssql_source=$MSSQL_SOURCE
mssql_target=$MSSQL_TARGET
mysql_source=$MYSQL_SOURCE
mysql_target=$MYSQL_TARGET
EOF
  chmod 644 "$STATUS_FILE"
}

cleanup() {
  [ -z "$MSSQL_SOURCE_HOST" ] || rm -f -- "$MSSQL_SOURCE_HOST"
  [ -z "$MYSQL_SOURCE_DUMP" ] || rm -f -- "$MYSQL_SOURCE_DUMP" "$MYSQL_SOURCE_DUMP.part"
  if [ "$DRY_RUN" -eq 0 ] && [ "$clone_status" != "OK" ]; then
    write_status || true
  fi
}
trap cleanup EXIT

mssql_init() {
  SQLCMD="$(docker exec wf-mssql bash -lc 'command -v /opt/mssql-tools18/bin/sqlcmd || command -v /opt/mssql-tools/bin/sqlcmd' | tr -d '\r')"
  [ -n "$SQLCMD" ] || fail "sqlcmd not found"
}

mssql_q() {
  docker exec wf-mssql "$SQLCMD" -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b "$@"
}

mssql_scalar() {
  mssql_q -h -1 -W -Q "SET NOCOUNT ON; $1" | tr -d '\r' | sed '/^[[:space:]]*$/d' | tail -1
}

mssql_backup_raw() {
  local database="$1" container_file="$2"
  if ! mssql_q -Q "BACKUP DATABASE [$database] TO DISK=N'$container_file' WITH INIT, COMPRESSION, CHECKSUM, STATS=10;"; then
    log "MSSQL native compression unavailable; retry without COMPRESSION"
    mssql_q -Q "BACKUP DATABASE [$database] TO DISK=N'$container_file' WITH INIT, CHECKSUM, STATS=10;"
  fi
  mssql_q -Q "RESTORE VERIFYONLY FROM DISK=N'$container_file';"
}

clone_mssql() {
  log "MSSQL preflight: $MSSQL_SOURCE -> $MSSQL_TARGET"
  mssql_init

  source_exists="$(mssql_scalar "SELECT COUNT(*) FROM sys.databases WHERE name=N'$MSSQL_SOURCE';")"
  [ "$source_exists" = "1" ] || fail "MSSQL production database not found: $MSSQL_SOURCE"
  target_exists="$(mssql_scalar "SELECT COUNT(*) FROM sys.databases WHERE name=N'$MSSQL_TARGET';")"
  source_mb="$(mssql_scalar "SELECT COALESCE(SUM(CAST(size AS bigint))*8/1024,0) FROM sys.master_files WHERE database_id=DB_ID(N'$MSSQL_SOURCE');")"
  target_mb=0
  if [ "$target_exists" = "1" ]; then
    target_mb="$(mssql_scalar "SELECT COALESCE(SUM(CAST(size AS bigint))*8/1024,0) FROM sys.master_files WHERE database_id=DB_ID(N'$MSSQL_TARGET');")"
  fi
  free_mb="$(df -Pm "$TRANSFER_ROOT" | awk 'NR==2{print $4}')"
  required_mb=$((source_mb * 2 + target_mb + 4096))
  printf 'MSSQL source size: %s MB; existing test size: %s MB; free: %s MB; required: %s MB\n' \
    "$source_mb" "$target_mb" "$free_mb" "$required_mb"
  [ "$free_mb" -ge "$required_mb" ] || fail "insufficient disk for a safe MSSQL clone"

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "MSSQL DRY RUN OK; target_exists=$target_exists"
    return
  fi

  if [ "$target_exists" = "1" ]; then
    log "Create safety backup of existing MSSQL test database"
    safe_base="${MSSQL_TARGET}_pre-clone_${STAMP}.bak"
    safe_host="$WORK/mssql/$safe_base"
    safe_container="/var/opt/mssql/backup/work/$safe_base"
    rm -f -- "$safe_host" "$OUT/mssql/$safe_base.gz.part"
    mssql_backup_raw "$MSSQL_TARGET" "$safe_container"
    gzip -1 -c "$safe_host" > "$OUT/mssql/$safe_base.gz.part"
    gzip -t "$OUT/mssql/$safe_base.gz.part"
    mv -f "$OUT/mssql/$safe_base.gz.part" "$OUT/mssql/$safe_base.gz"
    rm -f -- "$safe_host"
    (cd "$OUT/mssql" && sha256sum "$safe_base.gz" > "$safe_base.gz.sha256")
    chmod 644 "$OUT/mssql/$safe_base.gz" "$OUT/mssql/$safe_base.gz.sha256"
  fi

  log "Create verified online snapshot of MSSQL production"
  source_base="${MSSQL_SOURCE}_clone-source_${STAMP}.bak"
  MSSQL_SOURCE_HOST="$WORK/mssql/$source_base"
  source_container="/var/opt/mssql/backup/work/$source_base"
  rm -f -- "$MSSQL_SOURCE_HOST"
  mssql_backup_raw "$MSSQL_SOURCE" "$source_container"

  log "Read all MSSQL logical files and build isolated test file paths"
  file_list="$(mssql_q -h -1 -W -s'|' -Q "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK=N'$source_container';" | tr -d '\r')"
  move_clauses=""
  data_index=0
  log_index=0
  while IFS='|' read -r logical_name _physical_name file_type _rest; do
    [ -n "$logical_name" ] || continue
    logical_sql="${logical_name//\'/\'\'}"
    case "$file_type" in
      D)
        data_index=$((data_index + 1))
        if [ "$data_index" -eq 1 ]; then
          target_file="/var/opt/mssql/data/${MSSQL_TARGET}.mdf"
        else
          target_file="/var/opt/mssql/data/${MSSQL_TARGET}_${data_index}.ndf"
        fi
        ;;
      L)
        log_index=$((log_index + 1))
        if [ "$log_index" -eq 1 ]; then
          target_file="/var/opt/mssql/data/${MSSQL_TARGET}_log.ldf"
        else
          target_file="/var/opt/mssql/data/${MSSQL_TARGET}_log${log_index}.ldf"
        fi
        ;;
      *) fail "unsupported MSSQL backup file type '$file_type' for logical file '$logical_name'" ;;
    esac
    clause="MOVE N'$logical_sql' TO N'$target_file'"
    if [ -z "$move_clauses" ]; then move_clauses="$clause"; else move_clauses="$move_clauses, $clause"; fi
  done <<< "$file_list"
  [ "$data_index" -ge 1 ] && [ "$log_index" -ge 1 ] || fail "cannot identify MSSQL data/log files"

  log "Restore MSSQL snapshot as test database only"
  if ! mssql_q -Q "IF DB_ID(N'$MSSQL_TARGET') IS NOT NULL ALTER DATABASE [$MSSQL_TARGET] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    RESTORE DATABASE [$MSSQL_TARGET] FROM DISK=N'$source_container'
    WITH $move_clauses, REPLACE, RECOVERY, STATS=5;
    ALTER DATABASE [$MSSQL_TARGET] SET RECOVERY SIMPLE;
    ALTER DATABASE [$MSSQL_TARGET] SET TRUSTWORTHY OFF;
    ALTER DATABASE [$MSSQL_TARGET] SET MULTI_USER;"; then
    mssql_q -Q "IF DB_ID(N'$MSSQL_TARGET') IS NOT NULL ALTER DATABASE [$MSSQL_TARGET] SET MULTI_USER;" || true
    fail "MSSQL test restore failed; production was not replaced"
  fi

  log "Map existing least-privilege logins to the MSSQL test database"
  mssql_q -d "$MSSQL_TARGET" -Q "
    IF SUSER_ID(N'wf_reader') IS NOT NULL BEGIN
      IF USER_ID(N'wf_reader') IS NULL CREATE USER [wf_reader] FOR LOGIN [wf_reader]; ELSE ALTER USER [wf_reader] WITH LOGIN=[wf_reader];
      IF NOT EXISTS (SELECT 1 FROM sys.database_role_members m JOIN sys.database_principals r ON r.principal_id=m.role_principal_id JOIN sys.database_principals u ON u.principal_id=m.member_principal_id WHERE r.name=N'db_datareader' AND u.name=N'wf_reader') ALTER ROLE [db_datareader] ADD MEMBER [wf_reader];
    END;
    IF SUSER_ID(N'wf_owner') IS NOT NULL BEGIN
      IF USER_ID(N'wf_owner') IS NULL CREATE USER [wf_owner] FOR LOGIN [wf_owner]; ELSE ALTER USER [wf_owner] WITH LOGIN=[wf_owner];
      IF NOT EXISTS (SELECT 1 FROM sys.database_role_members m JOIN sys.database_principals r ON r.principal_id=m.role_principal_id JOIN sys.database_principals u ON u.principal_id=m.member_principal_id WHERE r.name=N'db_datareader' AND u.name=N'wf_owner') ALTER ROLE [db_datareader] ADD MEMBER [wf_owner];
      IF NOT EXISTS (SELECT 1 FROM sys.database_role_members m JOIN sys.database_principals r ON r.principal_id=m.role_principal_id JOIN sys.database_principals u ON u.principal_id=m.member_principal_id WHERE r.name=N'db_datawriter' AND u.name=N'wf_owner') ALTER ROLE [db_datawriter] ADD MEMBER [wf_owner];
    END;"

  log "Validate MSSQL test clone"
  mssql_q -Q "DBCC CHECKDB([$MSSQL_TARGET]) WITH PHYSICAL_ONLY, NO_INFOMSGS;"
  source_tables="$(mssql_scalar "SELECT COUNT(*) FROM [$MSSQL_SOURCE].sys.tables WHERE is_ms_shipped=0;")"
  target_tables="$(mssql_scalar "SELECT COUNT(*) FROM [$MSSQL_TARGET].sys.tables WHERE is_ms_shipped=0;")"
  [ "$target_tables" = "$source_tables" ] || fail "MSSQL table-count validation failed: source=$source_tables target=$target_tables"
  rm -f -- "$MSSQL_SOURCE_HOST"
  MSSQL_SOURCE_HOST=""
  echo "MSSQL CLONE OK: $MSSQL_TARGET ($target_tables user tables)"
}

mysql_admin() {
  docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" -i wf-mysql mysql -u root --ssl-mode=REQUIRED "$@"
}

mysql_scalar() {
  mysql_admin -N -e "$1" | tr -d '\r' | sed '/^[[:space:]]*$/d' | tail -1
}

mysql_dump_gzip() {
  local database="$1" output="$2"
  docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" wf-mysql mysqldump \
    -u root --single-transaction --quick --routines --triggers --events \
    --no-tablespaces --set-gtid-purged=OFF --default-character-set=utf8mb4 "$database" \
    | gzip -1 > "$output"
  gzip -t "$output"
  [ "$(stat -c%s "$output")" -ge 1024 ] || fail "MySQL dump is unexpectedly small"
}

restore_mysql_safety_or_remove() {
  local safety_file="$1"
  log "Rollback incomplete MySQL test clone"
  mysql_admin -e "DROP DATABASE IF EXISTS \`$MYSQL_TARGET\`;"
  if [ -n "$safety_file" ] && [ -f "$safety_file" ]; then
    mysql_admin -e "CREATE DATABASE \`$MYSQL_TARGET\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    gunzip -c "$safety_file" | mysql_admin --default-character-set=utf8mb4 "$MYSQL_TARGET"
    echo "Previous MySQL test database restored from safety backup."
  fi
}

clone_mysql() {
  log "MySQL preflight: $MYSQL_SOURCE -> $MYSQL_TARGET"
  source_exists="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$MYSQL_SOURCE';")"
  [ "$source_exists" = "1" ] || fail "MySQL production database not found: $MYSQL_SOURCE"
  target_exists="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$MYSQL_TARGET';")"
  source_tables="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$MYSQL_SOURCE';")"
  source_mb="$(mysql_scalar "SELECT COALESCE(CEIL(SUM(data_length+index_length)/1024/1024),0) FROM information_schema.tables WHERE table_schema='$MYSQL_SOURCE';")"
  target_mb=0
  if [ "$target_exists" = "1" ]; then
    target_mb="$(mysql_scalar "SELECT COALESCE(CEIL(SUM(data_length+index_length)/1024/1024),0) FROM information_schema.tables WHERE table_schema='$MYSQL_TARGET';")"
  fi
  free_mb="$(df -Pm "$TRANSFER_ROOT" | awk 'NR==2{print $4}')"
  required_mb=$((source_mb * 2 + target_mb + 2048))
  printf 'MySQL source size: %s MB; existing test size: %s MB; free: %s MB; required: %s MB\n' \
    "$source_mb" "$target_mb" "$free_mb" "$required_mb"
  [ "$free_mb" -ge "$required_mb" ] || fail "insufficient disk for a safe MySQL clone"

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "MySQL DRY RUN OK; target_exists=$target_exists"
    return
  fi

  safety_file=""
  if [ "$target_exists" = "1" ]; then
    existing_tables="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$MYSQL_TARGET';")"
    if [ "$existing_tables" -gt 0 ]; then
      log "Create safety backup of existing MySQL test database"
      safe_base="${MYSQL_TARGET}_pre-clone_${STAMP}.sql.gz"
      safety_file="$OUT/mysql/$safe_base"
      mysql_dump_gzip "$MYSQL_TARGET" "$safety_file.part"
      mv -f "$safety_file.part" "$safety_file"
      (cd "$OUT/mysql" && sha256sum "$safe_base" > "$safe_base.sha256")
      chmod 644 "$safety_file" "$safety_file.sha256"
    fi
  fi

  log "Create verified online snapshot of MySQL production"
  MYSQL_SOURCE_DUMP="$WORK/mysql/${MYSQL_SOURCE}_clone-source_${STAMP}.sql.gz"
  mysql_dump_gzip "$MYSQL_SOURCE" "$MYSQL_SOURCE_DUMP.part"
  mv -f "$MYSQL_SOURCE_DUMP.part" "$MYSQL_SOURCE_DUMP"

  log "Restore MySQL snapshot as test database only"
  mysql_admin -e "DROP DATABASE IF EXISTS \`$MYSQL_TARGET\`; CREATE DATABASE \`$MYSQL_TARGET\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  if ! gunzip -c "$MYSQL_SOURCE_DUMP" | mysql_admin --default-character-set=utf8mb4 "$MYSQL_TARGET"; then
    restore_mysql_safety_or_remove "$safety_file"
    fail "MySQL test import failed; production was not replaced"
  fi

  log "Disable copied MySQL scheduled events in the test database"
  event_count=0
  while IFS= read -r event_name; do
    [ -n "$event_name" ] || continue
    escaped_event="${event_name//\`/\`\`}"
    mysql_admin "$MYSQL_TARGET" -e "ALTER EVENT \`$escaped_event\` DISABLE;"
    event_count=$((event_count + 1))
  done < <(mysql_admin -N -e "SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA='$MYSQL_TARGET';" | tr -d '\r')

  log "Grant the existing application account access to the MySQL test database"
  app_user_sql="${MYSQL_USER//\'/\'\'}"
  app_password_sql="${MYSQL_PASSWORD//\'/\'\'}"
  mysql_admin -e "CREATE USER IF NOT EXISTS '$app_user_sql'@'%' IDENTIFIED BY '$app_password_sql';
    ALTER USER '$app_user_sql'@'%' IDENTIFIED BY '$app_password_sql';
    GRANT SELECT,INSERT,UPDATE,DELETE ON \`$MYSQL_TARGET\`.* TO '$app_user_sql'@'%'; FLUSH PRIVILEGES;"

  log "Validate MySQL test clone"
  target_tables="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$MYSQL_TARGET';")"
  if [ "$target_tables" != "$source_tables" ]; then
    restore_mysql_safety_or_remove "$safety_file"
    fail "MySQL table-count validation failed: source=$source_tables target=$target_tables"
  fi
  # ตรวจความสมบูรณ์ของทุกตาราง
  #
  # เดิมใช้ mysqlcheck แต่ **อิมเมจ mysql:8.0.46 ที่ใช้อยู่ไม่มีคำสั่งนี้แล้ว**
  # (มีแค่ mysql · mysqladmin · mysqldump · mysqlpump · mysqlsh)
  # ผลคือขั้นตรวจสอบล้มทุกครั้ง และล้มหลังจากโคลนฐานเสร็จแล้ว
  # ทำให้ deploy-full-test-stack.sh หยุดก่อนจะสร้าง container ทดสอบ — ฐานถูกสร้างแต่แอปไม่ขึ้น
  #
  # ยังเรียก mysqlcheck ก่อนถ้ามี เผื่อสภาพแวดล้อมอื่นที่ยังมีอยู่
  # ไม่มีก็ใช้ CHECK TABLE ผ่าน client mysql ซึ่งให้ผลอย่างเดียวกันและมีอยู่แน่นอน
  if docker exec wf-mysql sh -c 'command -v mysqlcheck >/dev/null 2>&1'; then
    docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" wf-mysql mysqlcheck \
      -u root --ssl-mode=REQUIRED --check --quick "$MYSQL_TARGET"
  else
    log "mysqlcheck ไม่มีในอิมเมจนี้ — ใช้ CHECK TABLE แทน"
    check_out="$(mysql_admin -N -B -e "
      SELECT CONCAT('CHECK TABLE \`$MYSQL_TARGET\`.\`', table_name, '\` QUICK;')
        FROM information_schema.tables
       WHERE table_schema='$MYSQL_TARGET' AND table_type='BASE TABLE';" \
      | mysql_admin -N -B | tr -d '\r')"
    # ผลของ CHECK TABLE คือ  ตาราง<TAB>check<TAB>status<TAB>ข้อความ
    # ทุกบรรทัดต้องลงท้ายด้วย OK ไม่งั้นถือว่าโคลนมาไม่สมบูรณ์
    if bad="$(printf '%s\n' "$check_out" | awk -F'\t' 'NF && $NF != "OK"')" && [ -n "$bad" ]; then
      restore_mysql_safety_or_remove "$safety_file"
      fail "MySQL CHECK TABLE พบตารางที่ไม่ผ่าน:\n$bad"
    fi
    echo "$check_out" | awk -F'\t' 'END { print "CHECK TABLE ผ่าน " NR " ตาราง" }'
  fi
  rm -f -- "$MYSQL_SOURCE_DUMP"
  MYSQL_SOURCE_DUMP=""
  echo "MYSQL CLONE OK: $MYSQL_TARGET ($target_tables tables/views; $event_count events disabled)"
}

if [ "$DRY_RUN" -eq 0 ]; then
  clone_status="RUNNING"
  write_status
fi

case "$MODE" in
  all) clone_mssql; clone_mysql ;;
  mssql) clone_mssql ;;
  mysql) clone_mysql ;;
esac

if [ "$DRY_RUN" -eq 1 ]; then
  echo "TEST CLONE DRY RUN OK; no database was changed."
  exit 0
fi

clone_status="OK"
write_status

cat <<EOF

TEST DATABASE CLONE OK
MSSQL: ${MSSQL_DOMAIN:-localhost}:${MSSQL_PUBLIC_PORT:-1433} / $MSSQL_TARGET
  users: wf_reader, wf_owner or sa (existing passwords)
MySQL: ${MYSQL_DOMAIN:-localhost}:${MYSQL_PUBLIC_PORT:-3306} / $MYSQL_TARGET
  users: ${MYSQL_USER:-wfapp} or root (existing passwords)
Production databases were backed up online and were not replaced.
EOF
