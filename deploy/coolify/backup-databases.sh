#!/usr/bin/env bash
# =============================================================
# backup-databases.sh — สำรอง SQL Server + MySQL (รันบน host ของ Coolify)
# =============================================================
# ทำไมต้องใช้ cron บน host:
#   SQL Server "Express Edition ไม่มี SQL Agent" → ตั้ง job ในตัว DB ไม่ได้
#
# ติดตั้ง:
#   mkdir -p /opt/wf && cp backup-databases.sh /opt/wf/ && chmod +x /opt/wf/backup-databases.sh
#   cp backup.env.example /opt/wf/backup.env && chmod 600 /opt/wf/backup.env   # ใส่รหัสผ่าน
#   crontab -e   →   15 2 * * *  /opt/wf/backup-databases.sh >> /var/log/wf-backup.log 2>&1
#
# ทดสอบ:  /opt/wf/backup-databases.sh --dry-run
# =============================================================
set -euo pipefail

ENV_FILE="${WF_BACKUP_ENV:-/opt/wf/backup.env}"
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

MSSQL_CONTAINER="${MSSQL_CONTAINER:-mssql}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-mysql}"
MSSQL_DB="${MSSQL_DB:-dbwins_worldfert9}"
MYSQL_DB="${MYSQL_DB:-db_truckscale}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/wf}"
# ⚠ CX23 disk แค่ 40GB · แต่ละรอบได้ .bak.gz ~1GB → เก็บสั้น แล้วพึ่ง OFFSITE เป็นหลัก
RETAIN_DAYS="${RETAIN_DAYS:-3}"
WEEKLY_RETAIN_DAYS="${WEEKLY_RETAIN_DAYS:-21}"
MIN_FREE_GB="${MIN_FREE_GB:-8}"
DRY_RUN=0; [ "${1:-}" = "--dry-run" ] && DRY_RUN=1

STAMP="$(date +%Y%m%d_%H%M%S)"
DAY="$(date +%u)"                     # 7 = อาทิตย์ → เก็บเป็น weekly
log(){ echo "[$(date '+%F %T')] $*"; }
fail(){ log "ERROR: $*"; NOTIFY_MSG="${NOTIFY_MSG:-}$*"$'\n'; ERR=1; }
ERR=0

log "=== WF backup start (dry-run=$DRY_RUN) ==="
mkdir -p "$BACKUP_DIR/mssql" "$BACKUP_DIR/mysql"

# ── กันดิสก์เต็ม (สำคัญมากบนเครื่อง 40GB) ────────────────────
# ระหว่าง backup ต้องมีที่ว่างพอสำหรับ .bak ดิบในคอนเทนเนอร์ + สำเนาบน host (~3.3GB × 2)
FREE_GB=$(df -Pm "$BACKUP_DIR" | awk 'NR==2{printf "%d", $4/1024}')
log "disk free: ${FREE_GB}GB (ต้องการอย่างน้อย ${MIN_FREE_GB}GB)"
if [ "$FREE_GB" -lt "$MIN_FREE_GB" ]; then
  log "ที่ว่างไม่พอ — ลบ backup เก่ากว่า 1 วันก่อน"
  find "$BACKUP_DIR/mssql" "$BACKUP_DIR/mysql" -type f -mtime +1 -delete 2>/dev/null || true
  FREE_GB=$(df -Pm "$BACKUP_DIR" | awk 'NR==2{printf "%d", $4/1024}')
  if [ "$FREE_GB" -lt "$MIN_FREE_GB" ]; then
    log "ERROR: ที่ว่างยังไม่พอ (${FREE_GB}GB) — ยกเลิกก่อนทำดิสก์เต็มจน DB ล่ม"
    exit 1
  fi
fi

# ── 1) SQL Server ────────────────────────────────────────────
MSSQL_FILE="${MSSQL_DB}_${STAMP}.bak"
log "SQL Server: $MSSQL_DB -> $MSSQL_FILE"
if [ "$DRY_RUN" = "0" ]; then
  # หา sqlcmd (path ต่างกันตาม image version)
  SQLCMD=$(docker exec "$MSSQL_CONTAINER" bash -lc \
    'ls /opt/mssql-tools18/bin/sqlcmd 2>/dev/null || ls /opt/mssql-tools/bin/sqlcmd 2>/dev/null' | tr -d '\r') \
    || { fail "หา sqlcmd ใน container ไม่เจอ"; SQLCMD=""; }

  if [ -n "$SQLCMD" ]; then
    # COMPRESSION ไม่รองรับบน Express → ลองก่อน ถ้าไม่ได้ค่อย fallback
    if ! docker exec "$MSSQL_CONTAINER" "$SQLCMD" -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b -Q \
        "BACKUP DATABASE [$MSSQL_DB] TO DISK='/var/opt/mssql/backup/$MSSQL_FILE' WITH INIT, COMPRESSION, CHECKSUM, STATS=10" 2>/dev/null; then
      log "  (COMPRESSION ไม่รองรับ — ใช้แบบไม่บีบอัด)"
      docker exec "$MSSQL_CONTAINER" "$SQLCMD" -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b -Q \
        "BACKUP DATABASE [$MSSQL_DB] TO DISK='/var/opt/mssql/backup/$MSSQL_FILE' WITH INIT, CHECKSUM, STATS=10" \
        || fail "BACKUP DATABASE ล้มเหลว"
    fi

    # ตรวจความสมบูรณ์ของไฟล์ backup ก่อนเชื่อว่าใช้ได้
    docker exec "$MSSQL_CONTAINER" "$SQLCMD" -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b -Q \
      "RESTORE VERIFYONLY FROM DISK='/var/opt/mssql/backup/$MSSQL_FILE'" \
      || fail "RESTORE VERIFYONLY ไม่ผ่าน — ไฟล์ backup อาจเสีย"

    docker cp "$MSSQL_CONTAINER:/var/opt/mssql/backup/$MSSQL_FILE" "$BACKUP_DIR/mssql/$MSSQL_FILE" \
      || fail "docker cp .bak ออกมาไม่สำเร็จ"
    docker exec "$MSSQL_CONTAINER" rm -f "/var/opt/mssql/backup/$MSSQL_FILE" || true
    gzip -f "$BACKUP_DIR/mssql/$MSSQL_FILE" || fail "gzip ล้มเหลว"
    log "  ok: $(du -h "$BACKUP_DIR/mssql/$MSSQL_FILE.gz" 2>/dev/null | cut -f1)"
  fi
fi

# ── 2) MySQL (TruckScale) ────────────────────────────────────
MYSQL_FILE="${MYSQL_DB}_${STAMP}.sql.gz"
log "MySQL: $MYSQL_DB -> $MYSQL_FILE"
if [ "$DRY_RUN" = "0" ]; then
  docker exec "$MYSQL_CONTAINER" mysqldump \
      -u root -p"$MYSQL_ROOT_PASSWORD" \
      --single-transaction --quick --routines --triggers --events \
      --default-character-set=utf8mb4 "$MYSQL_DB" 2>/dev/null \
    | gzip > "$BACKUP_DIR/mysql/$MYSQL_FILE" || fail "mysqldump ล้มเหลว"

  # dump ที่ว่าง/เล็กผิดปกติ = ถือว่าพัง
  SZ=$(stat -c%s "$BACKUP_DIR/mysql/$MYSQL_FILE" 2>/dev/null || echo 0)
  [ "$SZ" -lt 10240 ] && fail "mysqldump เล็กผิดปกติ ($SZ bytes)"
  gzip -t "$BACKUP_DIR/mysql/$MYSQL_FILE" || fail "ไฟล์ gz เสีย"
  log "  ok: $(du -h "$BACKUP_DIR/mysql/$MYSQL_FILE" | cut -f1)"
fi

# ── 3) เก็บสำเนารายสัปดาห์ (วันอาทิตย์) ───────────────────────
if [ "$DAY" = "7" ] && [ "$DRY_RUN" = "0" ]; then
  mkdir -p "$BACKUP_DIR/weekly"
  cp -f "$BACKUP_DIR/mssql/$MSSQL_FILE.gz" "$BACKUP_DIR/weekly/" 2>/dev/null || true
  cp -f "$BACKUP_DIR/mysql/$MYSQL_FILE"    "$BACKUP_DIR/weekly/" 2>/dev/null || true
  log "weekly copy saved"
  find "$BACKUP_DIR/weekly" -type f -mtime +"$WEEKLY_RETAIN_DAYS" -delete 2>/dev/null || true
fi

# ── 4) หมุนเวียนไฟล์เก่า ─────────────────────────────────────
if [ "$DRY_RUN" = "0" ]; then
  find "$BACKUP_DIR/mssql" "$BACKUP_DIR/mysql" -type f -mtime +"$RETAIN_DAYS" -delete 2>/dev/null || true
  log "rotated (>${RETAIN_DAYS}d)"
fi

# ── 5) ส่งออกนอกเครื่อง (แนะนำอย่างยิ่ง) ─────────────────────
# backup ที่อยู่บนเครื่องเดียวกับ DB ไม่ช่วยตอนดิสก์/เครื่องพัง
if [ -n "${OFFSITE_RSYNC_TARGET:-}" ] && [ "$DRY_RUN" = "0" ]; then
  log "offsite -> $OFFSITE_RSYNC_TARGET"
  rsync -az --delete-after "$BACKUP_DIR/" "$OFFSITE_RSYNC_TARGET" || fail "rsync offsite ล้มเหลว"
fi

# ── 6) สรุป + แจ้งเตือนเมื่อพัง ──────────────────────────────
log "disk: $(df -h "$BACKUP_DIR" | awk 'NR==2{print $4" free ("$5" used)"}')"
if [ "$ERR" != "0" ]; then
  log "=== BACKUP FAILED ==="
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -X POST -H 'Content-Type: application/json' \
      -d "{\"text\":\"WF backup FAILED on $(hostname):\n${NOTIFY_MSG:-unknown}\"}" \
      "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
  exit 1
fi
log "=== BACKUP OK ==="
