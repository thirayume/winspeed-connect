#!/usr/bin/env bash
# สำรอง transaction log ของฐาน production ตามรอบสั้น
#
# ทำไมต้องมี — ฐานตั้ง FULL recovery ไว้ แต่มีแต่ full backup รายสัปดาห์
# log จึงตัดไม่ได้เลยและโตไม่หยุด (test_v2 เคยบวมถึง 10 GB ทั้งที่ใช้จริง 1.1 GB)
#
# ห้ามแก้ production เป็น SIMPLE เพื่อแก้อาการนี้ เพราะจะเสียการกู้คืนย้อนเวลา
# วิธีที่ถูกคือ backup log เป็นรอบ ซึ่งทำให้ log ตัดตัวเองได้
#
# Express Edition ไม่มี SQL Server Agent จึงต้องพึ่ง cron ของเครื่องแทน
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
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

TRANSFER_ROOT="${TRANSFER_ROOT:-/srv/wf-transfer}"
OUT="$TRANSFER_ROOT/outgoing/mssql-log"
RETAIN_DAYS="${LOG_BACKUP_RETAIN_DAYS:-8}"
MIN_FREE_GB="${BACKUP_MIN_FREE_GB:-12}"
MSSQL_DB="${DB_NAME:-dbwins_worldfert9}"
STAMP="$(date '+%Y%m%d_%H%M%S')"
LOCK=/run/lock/worldfert-db-logbackup.lock

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

# ล็อกแยกจาก full backup โดยตั้งใจ — full backup ที่กินเวลานาน
# ไม่ควรบล็อก log backup เพราะ SQL Server รันสองอย่างนี้พร้อมกันได้
exec 9>"$LOCK"
flock -n 9 || { log "log backup ก่อนหน้ายังทำงานอยู่ ข้ามรอบนี้"; exit 0; }
install -d -m 755 "$OUT"

FREE_GB=$(df -Pm "$TRANSFER_ROOT" | awk 'NR==2{printf "%d",$4/1024}')
[ "$FREE_GB" -ge "$MIN_FREE_GB" ] || fail "พื้นที่เหลือ ${FREE_GB} GB ต่ำกว่าขั้นต่ำ ${MIN_FREE_GB} GB"

status=$(docker inspect -f '{{.State.Health.Status}}' wf-mssql 2>/dev/null || true)
[ "$status" = healthy ] || fail "wf-mssql ไม่อยู่ในสถานะ healthy"

SQLCMD=$(docker exec wf-mssql bash -lc 'command -v /opt/mssql-tools18/bin/sqlcmd || command -v /opt/mssql-tools/bin/sqlcmd' | tr -d '\r')
[ -n "$SQLCMD" ] || fail "ไม่พบ sqlcmd"

run_sql() {
  docker exec wf-mssql "$SQLCMD" -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b -h -1 -W -Q "$1"
}

# ตรวจก่อนว่าฐานยังเป็น FULL จริง — ถ้าถูกเปลี่ยนเป็น SIMPLE ไปแล้ว
# การสั่ง BACKUP LOG จะ error และ cron จะส่งเมลรัวทุกครึ่งชั่วโมง
MODEL=$(run_sql "SET NOCOUNT ON; SELECT recovery_model_desc FROM sys.databases WHERE name='$MSSQL_DB'" | tr -d '\r' | head -1 | xargs)
if [ "$MODEL" != "FULL" ] && [ "$MODEL" != "BULK_LOGGED" ]; then
  log "ฐาน $MSSQL_DB เป็น $MODEL ไม่ต้อง backup log — จบการทำงาน"
  exit 0
fi

# ต้องเขียนลง .../backup/work เท่านั้น — โฟลเดอร์ backup ชั้นนอกสิทธิ์ไม่พอ
# (ยืนยันแล้วเมื่อ 24/09/2569: เขียนชั้นนอกได้ OS error 5 Access is denied)
RAW="/var/opt/mssql/backup/work/${MSSQL_DB}_log_${STAMP}.trn"
HOSTFILE="$OUT/${MSSQL_DB}_log_${STAMP}.trn"

if [ "$DRY_RUN" -eq 1 ]; then
  log "DRY RUN — จะสำรอง log ของ $MSSQL_DB ไปที่ $HOSTFILE"
  exit 0
fi

log "เริ่มสำรอง log ของ $MSSQL_DB"
# Express ไม่รองรับ backup compression จึงลองแบบมี COMPRESSION ก่อนแล้วถอยเป็นไม่บีบอัด
# (รูปแบบเดียวกับ backup-databases.sh)
if ! run_sql "BACKUP LOG [$MSSQL_DB] TO DISK='$RAW' WITH COMPRESSION, CHECKSUM" >/dev/null 2>&1; then
  run_sql "BACKUP LOG [$MSSQL_DB] TO DISK='$RAW' WITH CHECKSUM"
fi

docker cp "wf-mssql:$RAW" "$HOSTFILE"
docker exec wf-mssql rm -f "$RAW"
chmod 640 "$HOSTFILE"

SIZE_MB=$(du -m "$HOSTFILE" | cut -f1)
log "สำรองสำเร็จ: $(basename "$HOSTFILE") (${SIZE_MB} MB)"

# ลบไฟล์เก่าตามอายุที่กำหนด
DELETED=$(find "$OUT" -name "${MSSQL_DB}_log_*.trn" -mtime "+${RETAIN_DAYS}" -print -delete | wc -l)
[ "$DELETED" -gt 0 ] && log "ลบ log backup เก่ากว่า ${RETAIN_DAYS} วัน จำนวน ${DELETED} ไฟล์"

log "LOG BACKUP OK"
