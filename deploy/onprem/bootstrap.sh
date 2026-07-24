#!/usr/bin/env bash
# =============================================================
# bootstrap.sh — ตั้งค่าฐานข้อมูลครั้งแรก (on-prem)
# =============================================================
# รันหลัง `docker compose up -d --build`
# ทำงานซ้ำได้ปลอดภัย (idempotent) — ข้ามขั้นที่ทำไปแล้ว
#
#   bash bootstrap.sh              ทำครบทุกขั้น
#   bash bootstrap.sh --restore    บังคับ restore ทับ แม้ DB มีอยู่แล้ว
#   bash bootstrap.sh --no-restore ข้าม restore (แค่ migrate + seed)
#
# วางไฟล์ backup ที่ ./backup/ ก่อน:
#   *.bak  -> SQL Server (WINSpeed)
#   *.sql  -> MySQL (TruckScale)
# =============================================================
set -uo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "ERROR: ไม่พบ .env — คัดลอกจาก .env.example ก่อน"; exit 2; }
set -a; . ./.env; set +a

MSSQL_C=wf-mssql
MYSQL_C=wf-mysql
BACKEND_C=wf-backend
DB="${DB_NAME:-dbwins_worldfert9}"
MYDB="${MYSQL_DATABASE:-db_truckscale}"

FORCE_RESTORE=0; SKIP_RESTORE=0
for a in "$@"; do
  case "$a" in
    --restore)    FORCE_RESTORE=1 ;;
    --no-restore) SKIP_RESTORE=1 ;;
    -h|--help)    sed -n '2,20p' "$0"; exit 0 ;;
  esac
done

log(){ echo -e "\n\033[36m[$(date '+%H:%M:%S')] $*\033[0m"; }
ok(){  echo -e "   \033[32m✓\033[0m $*"; }
bad(){ echo -e "   \033[31m✗\033[0m $*"; }
sq(){  docker exec "$MSSQL_C" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b "$@"; }

# ── 0) รอ container พร้อม ────────────────────────────────────
log "0/6 รอฐานข้อมูลพร้อม (SQL Server ใช้เวลา boot ~90 วินาที)"
for c in "$MSSQL_C" "$MYSQL_C"; do
  for i in $(seq 1 60); do
    st=$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null || echo none)
    [ "$st" = "healthy" ] && { ok "$c พร้อม"; break; }
    [ "$st" = "none" ] && { bad "ไม่พบ container $c — รัน docker compose up -d ก่อน"; exit 1; }
    sleep 5
    [ "$i" = "60" ] && { bad "$c ไม่พร้อมภายใน 5 นาที"; exit 1; }
  done
done

# ── 1) login + user ─────────────────────────────────────────
log "1/6 สร้าง login / user (wf_reader, wf_owner)"
sq -Q "
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name='wf_reader')
  CREATE LOGIN wf_reader WITH PASSWORD='${WF_READER_PASSWORD}', CHECK_POLICY=OFF;
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name='wf_owner')
  CREATE LOGIN wf_owner  WITH PASSWORD='${WF_OWNER_PASSWORD}',  CHECK_POLICY=OFF;" >/dev/null 2>&1 \
  && ok "login ระดับ server พร้อม" || bad "สร้าง login ไม่สำเร็จ"

# ── 2) restore SQL Server ───────────────────────────────────
DB_EXISTS=$(sq -h -1 -W -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.databases WHERE name='$DB'" 2>/dev/null | tr -d ' \r' | head -1)
BAK=$(ls -1 ./backup/*.bak 2>/dev/null | head -1)

if [ "$SKIP_RESTORE" = "1" ]; then
  log "2/6 ข้าม restore (--no-restore)"
elif [ -z "$BAK" ]; then
  log "2/6 ไม่พบไฟล์ .bak ใน ./backup/ — ข้าม restore"
  [ "${DB_EXISTS:-0}" = "0" ] && { bad "และยังไม่มีฐาน $DB — วางไฟล์ .bak แล้วรันใหม่"; exit 1; }
elif [ "${DB_EXISTS:-0}" != "0" ] && [ "$FORCE_RESTORE" = "0" ]; then
  log "2/6 มีฐาน $DB อยู่แล้ว — ข้าม restore (ใช้ --restore เพื่อบังคับทับ)"
else
  BN=$(basename "$BAK")
  log "2/6 RESTORE $DB จาก $BN"
  echo "   ⚠ ข้อมูลเดิมใน $DB จะถูกแทนที่ทั้งหมด"
  FL=$(sq -h -1 -W -s"|" -Q "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK='/var/opt/mssql/backup/$BN'" | tr -d '\r')
  DATA_L=$(echo "$FL" | awk -F'|' '$3=="D"{print $1; exit}')
  LOG_L=$( echo "$FL" | awk -F'|' '$3=="L"{print $1; exit}')
  [ -z "$DATA_L" ] && { bad "อ่าน logical name ไม่ได้ — ไฟล์ .bak เสียหรือ container อ่านไม่ได้?"; exit 1; }
  ok "logical: $DATA_L / $LOG_L"
  sq -Q "IF DB_ID('$DB') IS NOT NULL ALTER DATABASE [$DB] SET SINGLE_USER WITH ROLLBACK IMMEDIATE" >/dev/null 2>&1
  sq -Q "RESTORE DATABASE [$DB] FROM DISK='/var/opt/mssql/backup/$BN'
         WITH MOVE '$DATA_L' TO '/var/opt/mssql/data/${DB}.mdf',
              MOVE '$LOG_L'  TO '/var/opt/mssql/data/${DB}_log.ldf',
              REPLACE, RECOVERY, STATS=10" || { bad "RESTORE ล้มเหลว"; exit 1; }
  sq -Q "ALTER DATABASE [$DB] SET MULTI_USER" >/dev/null 2>&1
  sq -Q "ALTER DATABASE [$DB] SET RECOVERY SIMPLE" >/dev/null 2>&1
  sq -d "$DB" -Q "DBCC SHRINKFILE ('$LOG_L', 512)" >/dev/null 2>&1
  ok "restore เสร็จ + recovery SIMPLE (กัน log บวม)"
fi

# database user (restore ลบทิ้งทุกครั้ง จึงต้องสร้างใหม่เสมอ)
sq -d "$DB" -Q "
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name='wf_reader') CREATE USER wf_reader FOR LOGIN wf_reader;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name='wf_owner')  CREATE USER wf_owner  FOR LOGIN wf_owner;
ALTER ROLE db_datareader ADD MEMBER wf_reader;
ALTER ROLE db_datareader ADD MEMBER wf_owner;" >/dev/null 2>&1 \
  && ok "database user พร้อม" || bad "สร้าง database user ไม่สำเร็จ"

# ── 3) restore MySQL ────────────────────────────────────────
SQLDUMP=$(ls -1 ./backup/*.sql 2>/dev/null | head -1)
MY_ROWS=$(docker exec "$MYSQL_C" mysql -u root -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT COUNT(*) FROM tblscale;" "$MYDB" 2>/dev/null | tr -d '\r')
if [ -z "$SQLDUMP" ]; then
  log "3/6 ไม่พบไฟล์ .sql ใน ./backup/ — ข้าม MySQL"
elif [ -n "${MY_ROWS:-}" ] && [ "${MY_ROWS:-0}" -gt 0 ] && [ "$FORCE_RESTORE" = "0" ]; then
  log "3/6 $MYDB มีข้อมูลแล้ว (${MY_ROWS} แถว) — ข้าม (ใช้ --restore เพื่อทับ)"
else
  log "3/6 นำเข้า MySQL จาก $(basename "$SQLDUMP")"
  docker exec "$MYSQL_C" mysql -u root -p"$MYSQL_ROOT_PASSWORD" -e \
    "CREATE DATABASE IF NOT EXISTS \`$MYDB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null
  docker exec -i "$MYSQL_C" mysql -u root -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 "$MYDB" < "$SQLDUMP" 2>/dev/null
  N=$(docker exec "$MYSQL_C" mysql -u root -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT COUNT(*) FROM tblscale;" "$MYDB" 2>/dev/null | tr -d '\r')
  ok "นำเข้าเสร็จ — tblscale = ${N:-?} แถว"
  docker exec "$MYSQL_C" mysql -u root -p"$MYSQL_ROOT_PASSWORD" -e \
    "CREATE USER IF NOT EXISTS '${MYSQL_USER:-wfapp}'@'%' IDENTIFIED BY '$MYSQL_PASSWORD';
     GRANT SELECT,INSERT,UPDATE,DELETE ON \`$MYDB\`.* TO '${MYSQL_USER:-wfapp}'@'%'; FLUSH PRIVILEGES;" 2>/dev/null
  ok "คืนสิทธิ์ให้ ${MYSQL_USER:-wfapp}"
fi

# ── 4) migrations ───────────────────────────────────────────
log "4/6 รัน migrations (สร้าง schema wf)"
docker exec "$BACKEND_C" node run_migrations.js || { bad "migrations ล้มเหลว"; exit 1; }

# ── 5) GRANT ────────────────────────────────────────────────
log "5/6 GRANT สิทธิ์ schema wf"
# ต้องทำหลัง migrations เสมอ — GRANT ใน 001 ถูกข้ามถ้า login ยังไม่มีตอนนั้น
sq -d "$DB" -Q "GRANT CONTROL ON SCHEMA::wf TO wf_owner; GRANT SELECT ON SCHEMA::wf TO wf_reader;" >/dev/null 2>&1
sq -h -1 -W -d "$DB" -Q "SET NOCOUNT ON; SELECT dp.name + ' -> ' + p.permission_name FROM sys.database_permissions p JOIN sys.database_principals dp ON dp.principal_id=p.grantee_principal_id WHERE p.major_id=SCHEMA_ID('wf') AND dp.name IN ('wf_owner','wf_reader')" 2>/dev/null | grep -v '^$' | sed 's/^/   /'

# ── 6) seed ผู้ใช้ ──────────────────────────────────────────
log "6/6 seed ผู้ใช้ (admin + พนักงานจาก dbo.EMEmp)"
docker exec "$BACKEND_C" node seed_admin.js || { bad "seed_admin ล้มเหลว"; exit 1; }

# ── สรุป ────────────────────────────────────────────────────
log "ตรวจผลลัพธ์"
sq -h -1 -W -d "$DB" -Q "SET NOCOUNT ON;
  SELECT 'dbo tables = ' + CAST((SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='dbo') AS VARCHAR(10));
  SELECT 'wf tables  = ' + CAST((SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='wf') AS VARCHAR(10));
  SELECT 'AppUser    = ' + CAST((SELECT COUNT(*) FROM wf.AppUser) AS VARCHAR(10));" 2>/dev/null | grep -v '^$' | sed 's/^/   /'

cat <<EOF

============================================================
 เสร็จสิ้น
============================================================
 หน้าเว็บ : ${VITE_API_BASE_URL%/api} -> ดู APP_DOMAIN ใน .env
 login    : admin / W0rldF3rt      (W0rld ใช้เลขศูนย์)

 ⚠ พนักงานทุกคนได้รหัสเริ่มต้นเดียวกัน — บังคับเปลี่ยนก่อนใช้จริง
============================================================
EOF
