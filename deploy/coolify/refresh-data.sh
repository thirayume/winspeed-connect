#!/usr/bin/env bash
# =============================================================
# refresh-data.sh — เปลี่ยนข้อมูลตั้งต้นใหม่ (restore ทับของเดิม)
# =============================================================
# ทำไมต้องมีสคริปต์นี้ ไม่ restore เฉยๆ:
#   ไฟล์ .bak ของ WINSpeed **ไม่มี schema wf** (เราสร้างจาก migrations)
#   RESTORE ... REPLACE จึงลบ schema wf + database user ทิ้งทั้งหมด
#   -> ต้องสร้าง user ใหม่ + รัน migrations + seed ผู้ใช้ ทุกครั้งหลัง restore
#   ถ้าลืม = login ไม่ได้ทั้งระบบ และ backend พัง
#
# ใช้งาน (รันบน VM):
#   bash refresh-data.sh --dry-run
#   bash refresh-data.sh --mssql dbwins_worldfert9_db.bak
#   bash refresh-data.sh --mysql dump-db_truckscale.sql
#   bash refresh-data.sh --mssql a.bak --mysql b.sql
#
# ไฟล์ต้องวางไว้ที่ (อัปโหลดด้วย WinSCP ได้เลย):
#   MSSQL : /var/lib/docker/volumes/<stack>_mssql-backup/_data/
#           = /var/opt/mssql/backup/ ในมุมมองของ container
#   MySQL : /root/backup/  (หรือระบุ path เต็ม)
#
# อ่านค่าจาก /root/.wf-secrets (chmod 600)
# =============================================================
set -uo pipefail

ENV_FILE="${WF_SECRETS:-/root/.wf-secrets}"
[ -f "$ENV_FILE" ] || { echo "ERROR: ไม่พบ $ENV_FILE"; exit 2; }
set -a; . "$ENV_FILE"; set +a

MSSQL_FILE=""; MYSQL_FILE=""; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --mssql)   MSSQL_FILE="$2"; shift 2 ;;
    --mysql)   MYSQL_FILE="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "ไม่รู้จัก: $1"; exit 2 ;;
  esac
done
[ -z "$MSSQL_FILE" ] && [ -z "$MYSQL_FILE" ] && [ "$DRY" = "0" ] && { echo "ต้องระบุ --mssql และ/หรือ --mysql (ดู --help)"; exit 2; }

log(){ echo -e "\n\033[36m[$(date '+%H:%M:%S')] $*\033[0m"; }
ok(){  echo -e "   \033[32m✓\033[0m $*"; }
bad(){ echo -e "   \033[31m✗\033[0m $*"; }

MSSQL_C="${MSSQL_CONTAINER:-mssql}"
MYSQL_C="${MYSQL_CONTAINER:-mysql}"
DB="${MSSQL_DB:-dbwins_worldfert9}"
MYDB="${MYSQL_DB:-db_truckscale}"

sq(){ docker exec "$MSSQL_C" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b "$@"; }

# ── ตรวจความพร้อม ────────────────────────────────────────────
log "0/6 ตรวจความพร้อม"
for c in "$MSSQL_C" "$MYSQL_C"; do
  docker ps --format '{{.Names}}' | grep -qx "$c" && ok "container $c รันอยู่" || { bad "ไม่พบ container $c"; exit 1; }
done

# หา backend จาก "มีไฟล์ run_migrations.js อยู่จริง" — เชื่อถือได้กว่าเดาจากชื่อ
# (ชื่อ container ของ Coolify เป็น uuid ทั้ง frontend และ backend แยกด้วยชื่อไม่ได้)
BACKEND_C=""
for c in $(docker ps --format '{{.Names}}'); do
  case "$c" in mssql-*|mysql-*|coolify*) continue ;; esac
  if docker exec "$c" test -f /app/run_migrations.js 2>/dev/null; then BACKEND_C="$c"; break; fi
done
[ -n "$BACKEND_C" ] && ok "backend = $BACKEND_C" || bad "ไม่พบ backend container (migrations/seed จะทำไม่ได้)"

if [ -n "$MSSQL_FILE" ]; then
  IN_C="/var/opt/mssql/backup/$(basename "$MSSQL_FILE")"
  if docker exec "$MSSQL_C" test -r "$IN_C"; then ok "container อ่าน $IN_C ได้"
  else bad "container อ่าน $IN_C ไม่ได้ — อัปโหลดไฟล์ไปที่ volume mssql-backup ก่อน"; exit 1; fi
fi
if [ -n "$MYSQL_FILE" ]; then
  [ -f "$MYSQL_FILE" ] || MYSQL_FILE="/root/backup/$(basename "$MYSQL_FILE")"
  [ -f "$MYSQL_FILE" ] && ok "พบไฟล์ $MYSQL_FILE" || { bad "ไม่พบไฟล์ MySQL"; exit 1; }
fi

FREE=$(df -Pm / | awk 'NR==2{print $4}')
ok "เนื้อที่ว่าง ${FREE}MB"

if [ "$DRY" = "1" ]; then
  log "DRY RUN — ตรวจอย่างเดียว ไม่เปลี่ยนข้อมูล"
  echo ""
  if [ -z "$MSSQL_FILE" ] && [ -z "$MYSQL_FILE" ]; then
    echo "  (ไม่ได้ระบุไฟล์ — ตรวจความพร้อมอย่างเดียว)"
    echo "  ใส่ไฟล์เพื่อดูแผนเต็ม เช่น:"
    echo "    bash refresh-data.sh --dry-run --mssql dbwins_worldfert9_db.bak"
    echo ""
    echo "  ไฟล์ .bak ที่วางไว้แล้วใน volume:"
    docker exec "$MSSQL_C" ls -1 /var/opt/mssql/backup/ 2>/dev/null | sed 's/^/    /' || echo "    (ว่าง)"
    echo "  ไฟล์ใน /root/backup/:"
    ls -1 /root/backup/ 2>/dev/null | sed 's/^/    /' || echo "    (ว่าง)"
    exit 0
  fi
  echo "  ถ้ารันจริงจะทำ:"
  [ -n "$MSSQL_FILE" ] && echo "    1) RESTORE $DB ทับของเดิม (schema wf จะหาย)"
  [ -n "$MSSQL_FILE" ] && echo "    2) สร้าง user wf_reader/wf_owner ใหม่ + recovery SIMPLE"
  [ -n "$MSSQL_FILE" ] && echo "    3) รัน migrations (สร้าง schema wf กลับมา)"
  [ -n "$MSSQL_FILE" ] && echo "    4) GRANT สิทธิ์ schema wf"
  [ -n "$MSSQL_FILE" ] && echo "    5) seed_admin.js (สร้าง admin + พนักงาน)"
  [ -n "$MYSQL_FILE" ] && echo "    6) นำเข้า MySQL ทับ $MYDB"
  echo ""
  exit 0
fi

# ── 1) RESTORE SQL Server ────────────────────────────────────
if [ -n "$MSSQL_FILE" ]; then
  BN=$(basename "$MSSQL_FILE")
  log "1/6 RESTORE $DB จาก $BN"
  echo "   ⚠ ข้อมูลเดิมทั้งหมดใน $DB จะถูกแทนที่"

  FL=$(sq -h -1 -W -s"|" -Q "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK='/var/opt/mssql/backup/$BN'" | tr -d '\r')
  DATA_L=$(echo "$FL" | awk -F'|' '$3=="D"{print $1; exit}')
  LOG_L=$( echo "$FL" | awk -F'|' '$3=="L"{print $1; exit}')
  [ -z "$DATA_L" ] && { bad "อ่าน logical name ไม่ได้"; exit 1; }
  ok "logical names: $DATA_L / $LOG_L"

  sq -Q "ALTER DATABASE [$DB] SET SINGLE_USER WITH ROLLBACK IMMEDIATE" >/dev/null 2>&1
  sq -Q "RESTORE DATABASE [$DB] FROM DISK='/var/opt/mssql/backup/$BN'
         WITH MOVE '$DATA_L' TO '/var/opt/mssql/data/${DB}.mdf',
              MOVE '$LOG_L'  TO '/var/opt/mssql/data/${DB}_log.ldf',
              REPLACE, RECOVERY, STATS=10" || { bad "RESTORE ล้มเหลว"; sq -Q "ALTER DATABASE [$DB] SET MULTI_USER" >/dev/null 2>&1; exit 1; }
  sq -Q "ALTER DATABASE [$DB] SET MULTI_USER" >/dev/null 2>&1
  ok "restore เสร็จ"

  # ── 2) user + recovery model ──
  log "2/6 สร้าง database user ใหม่ (ของเดิมหายไปกับ restore) + recovery SIMPLE"
  sq -d "$DB" -Q "
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name='wf_reader') CREATE USER wf_reader FOR LOGIN wf_reader;
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name='wf_owner')  CREATE USER wf_owner  FOR LOGIN wf_owner;
    ALTER ROLE db_datareader ADD MEMBER wf_reader;
    ALTER ROLE db_datareader ADD MEMBER wf_owner;" >/dev/null 2>&1 && ok "wf_reader / wf_owner พร้อม" || bad "สร้าง user ไม่สำเร็จ (login มีอยู่ที่ระดับ server หรือยัง?)"
  sq -Q "ALTER DATABASE [$DB] SET RECOVERY SIMPLE" >/dev/null 2>&1
  sq -d "$DB" -Q "DBCC SHRINKFILE ('$LOG_L', 512)" >/dev/null 2>&1
  ok "recovery = SIMPLE, log ย่อแล้ว"

  # ── 3) migrations ──
  if [ -n "$BACKEND_C" ]; then
    log "3/6 รัน migrations (สร้าง schema wf กลับมา)"
    docker exec "$BACKEND_C" node run_migrations.js || { bad "migrations ล้มเหลว"; exit 1; }
    ok "migrations เสร็จ"

    log "4/6 GRANT สิทธิ์ schema wf"
    sq -d "$DB" -Q "GRANT CONTROL ON SCHEMA::wf TO wf_owner; GRANT SELECT ON SCHEMA::wf TO wf_reader;" >/dev/null 2>&1
    ok "สิทธิ์ครบ"

    log "5/6 seed ผู้ใช้ (admin + พนักงานจาก dbo.EMEmp)"
    docker exec "$BACKEND_C" node seed_admin.js || { bad "seed_admin ล้มเหลว"; exit 1; }
    ok "ผู้ใช้พร้อม — admin / W0rldF3rt"
  else
    bad "ข้ามขั้น migrations/seed — ไม่พบ backend container"
    echo "   ทำเองด้วย: docker exec -it <backend> node run_migrations.js && docker exec -it <backend> node seed_admin.js"
  fi
fi

# ── 6) MySQL ─────────────────────────────────────────────────
if [ -n "$MYSQL_FILE" ]; then
  log "6/6 นำเข้า MySQL จาก $(basename "$MYSQL_FILE")"
  docker exec -i "$MYSQL_C" mysql -u root -p"$MYSQL_ROOT_PASSWORD" -e \
    "DROP DATABASE IF EXISTS \`$MYDB\`; CREATE DATABASE \`$MYDB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null
  if [[ "$MYSQL_FILE" == *.gz ]]; then
    gunzip -c "$MYSQL_FILE" | docker exec -i "$MYSQL_C" mysql -u root -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 "$MYDB" 2>/dev/null
  else
    docker exec -i "$MYSQL_C" mysql -u root -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 "$MYDB" < "$MYSQL_FILE" 2>/dev/null
  fi
  N=$(docker exec "$MYSQL_C" mysql -u root -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT COUNT(*) FROM tblscale;" "$MYDB" 2>/dev/null | tr -d '\r')
  ok "นำเข้าเสร็จ — tblscale = ${N:-?} แถว"
  # ให้สิทธิ์ app user อีกครั้ง (DROP DATABASE ลบ grant ที่ผูกกับ db ไปด้วย)
  if [ -n "${MYSQL_PASSWORD:-}" ]; then
    docker exec "$MYSQL_C" mysql -u root -p"$MYSQL_ROOT_PASSWORD" -e \
      "CREATE USER IF NOT EXISTS '${MYSQL_USER:-wfapp}'@'%' IDENTIFIED BY '$MYSQL_PASSWORD';
       GRANT SELECT, INSERT, UPDATE, DELETE ON \`$MYDB\`.* TO '${MYSQL_USER:-wfapp}'@'%'; FLUSH PRIVILEGES;" 2>/dev/null
    ok "คืนสิทธิ์ให้ ${MYSQL_USER:-wfapp}"
  fi
fi

# ── สรุป ─────────────────────────────────────────────────────
log "ตรวจผลลัพธ์"
if [ -n "$MSSQL_FILE" ]; then
  sq -h -1 -W -d "$DB" -Q "SET NOCOUNT ON;
    SELECT 'dbo tables = ' + CAST((SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='dbo') AS VARCHAR(10));
    SELECT 'wf tables  = ' + CAST((SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='wf') AS VARCHAR(10));
    SELECT 'AppUser    = ' + CAST((SELECT COUNT(*) FROM wf.AppUser) AS VARCHAR(10));" 2>/dev/null | grep -v '^$'
fi
echo ""
echo "============================================================"
echo " เสร็จสิ้น — ทดสอบ login ที่หน้าเว็บด้วย admin / W0rldF3rt"
echo " (พนักงานทุกคนได้รหัสเริ่มต้นเดียวกัน ต้องบังคับเปลี่ยนก่อนใช้จริง)"
echo "============================================================"
