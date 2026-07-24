#!/usr/bin/env bash
# =============================================================
# 02-restore-mssql.sh — restore dbwins_worldfert9 เข้า container mssql
# =============================================================
# ใช้หลังอัปโหลดไฟล์ .bak ขึ้น VM แล้ว (เช่นด้วย WinSCP → /root/backup/)
#
#   bash 02-restore-mssql.sh /root/backup/dbwins_worldfert9_db_202607021642.bak
#
# ตรวจ/ทำให้อัตโนมัติ: เนื้อที่ว่าง · logical names · Express 10GB · verify ผลลัพธ์
# =============================================================
set -euo pipefail

BAK_HOST="${1:-}"
CONTAINER="${MSSQL_CONTAINER:-mssql}"
DB="${MSSQL_DB:-dbwins_worldfert9}"
SA_PW="${MSSQL_SA_PASSWORD:-}"

[ -z "$BAK_HOST" ] && { echo "ใช้: bash 02-restore-mssql.sh /path/to/file.bak"; exit 2; }
[ -f "$BAK_HOST" ] || { echo "ERROR: ไม่พบไฟล์ $BAK_HOST"; exit 2; }
[ -z "$SA_PW" ] && { read -rsp "MSSQL_SA_PASSWORD: " SA_PW; echo; }

BAK_NAME="$(basename "$BAK_HOST")"
log(){ echo -e "\n\033[36m[$(date '+%H:%M:%S')] $*\033[0m"; }

log "0/6 ตรวจเนื้อที่ว่าง"
NEED_MB=$(( $(stat -c%s "$BAK_HOST") / 1048576 * 3 ))   # .bak + data + log ≈ 3x
FREE_MB=$(df -Pm / | awk 'NR==2{print $4}')
echo "   ต้องการ ~${NEED_MB}MB · ว่าง ${FREE_MB}MB"
[ "$FREE_MB" -lt "$NEED_MB" ] && { echo "ERROR: เนื้อที่ไม่พอ"; exit 1; }

log "1/6 หา sqlcmd ใน container"
SQLCMD=$(docker exec "$CONTAINER" bash -lc \
  'ls /opt/mssql-tools18/bin/sqlcmd 2>/dev/null || ls /opt/mssql-tools/bin/sqlcmd 2>/dev/null' | tr -d '\r')
[ -z "$SQLCMD" ] && { echo "ERROR: ไม่พบ sqlcmd"; exit 1; }
q(){ docker exec "$CONTAINER" "$SQLCMD" -S localhost -U sa -P "$SA_PW" -C -b "$@"; }
q -Q "SELECT @@VERSION" >/dev/null || { echo "ERROR: ต่อ SQL Server ไม่ได้ (รหัสผ่าน?)"; exit 1; }
echo "   ok"

log "2/6 คัดลอก .bak เข้า container"
docker exec "$CONTAINER" mkdir -p /var/opt/mssql/backup
docker cp "$BAK_HOST" "$CONTAINER:/var/opt/mssql/backup/$BAK_NAME"
docker exec "$CONTAINER" chown mssql:root "/var/opt/mssql/backup/$BAK_NAME" 2>/dev/null || true
echo "   ok"

log "3/6 อ่าน logical names + ขนาดจากไฟล์ backup"
FL=$(q -h -1 -W -s"|" -Q \
  "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK='/var/opt/mssql/backup/$BAK_NAME'" | tr -d '\r')
echo "$FL" | awk -F'|' 'NF>3 {printf "   %-24s %-6s %10.1f MB\n",$1,$3,$4/1048576}'
DATA_LOGICAL=$(echo "$FL" | awk -F'|' '$3=="D"{print $1; exit}')
LOG_LOGICAL=$( echo "$FL" | awk -F'|' '$3=="L"{print $1; exit}')
TOTAL_MB=$(echo "$FL" | awk -F'|' 'NF>3 && $3=="D"{s+=$4} END{printf "%.0f", s/1048576}')
[ -z "$DATA_LOGICAL" ] && { echo "ERROR: อ่าน logical name ไม่ได้"; exit 1; }
echo "   DATA='$DATA_LOGICAL'  LOG='$LOG_LOGICAL'  data≈${TOTAL_MB}MB"

EDITION=$(q -h -1 -W -Q "SET NOCOUNT ON; SELECT CAST(SERVERPROPERTY('Edition') AS VARCHAR(60))" | head -1 | tr -d '\r')
if echo "$EDITION" | grep -qi Express && [ "$TOTAL_MB" -ge 10240 ]; then
  echo "ERROR: Express จำกัด 10GB แต่ data ${TOTAL_MB}MB → เปลี่ยน MSSQL_PID"; exit 1
fi
echo "   edition: $EDITION"

log "4/6 RESTORE (ใช้เวลาสักครู่ — แสดงความคืบหน้าทุก 5%)"
q -Q "RESTORE DATABASE [$DB]
      FROM DISK='/var/opt/mssql/backup/$BAK_NAME'
      WITH MOVE '$DATA_LOGICAL' TO '/var/opt/mssql/data/${DB}.mdf',
           MOVE '$LOG_LOGICAL'  TO '/var/opt/mssql/data/${DB}_log.ldf',
           REPLACE, STATS=5"

log "5/6 ตรวจผลลัพธ์"
q -Q "SELECT name, state_desc, recovery_model_desc,
             CAST(DATABASEPROPERTYEX(name,'Collation') AS VARCHAR(50)) AS Collation
      FROM sys.databases WHERE name='$DB'"
q -d "$DB" -Q "SELECT COUNT(*) AS dbo_tables FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='dbo';
               SELECT COUNT(*) AS wf_tables  FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='wf';
               SELECT TOP 1 'SOHD rows' AS chk, COUNT(*) AS n FROM dbo.SOHD"

log "6/6 ลบ .bak ออกจาก container (คืนเนื้อที่)"
docker exec "$CONTAINER" rm -f "/var/opt/mssql/backup/$BAK_NAME"
echo "   ไฟล์บน host ยังอยู่ที่ $BAK_HOST (ลบเองเมื่อมั่นใจ)"

cat <<EOF

============================================================
 RESTORE เสร็จ
============================================================
 ขั้นต่อไป:
   1) รัน migrations ให้ schema wf ครบ:   npm run migrate
   2) ตรวจความพร้อม:                      node scripts/preflight-check.js
   3) ถ้า wf_tables = 0 ด้านบน แปลว่ายังไม่ได้รัน migrations
============================================================
EOF
