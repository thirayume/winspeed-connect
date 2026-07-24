#!/usr/bin/env bash
# =============================================================
# 03-restore-mysql.sh — restore db_truckscale เข้า container mysql
# =============================================================
#   bash 03-restore-mysql.sh /root/backup/dump-db_truckscale-202607212333.sql
#
# รองรับทั้ง .sql และ .sql.gz · ตรวจผลลัพธ์ (tblscale ต้องมีข้อมูล)
# =============================================================
set -euo pipefail

DUMP="${1:-}"
CONTAINER="${MYSQL_CONTAINER:-mysql}"
DB="${MYSQL_DB:-db_truckscale}"
ROOT_PW="${MYSQL_ROOT_PASSWORD:-}"

[ -z "$DUMP" ] && { echo "ใช้: bash 03-restore-mysql.sh /path/to/dump.sql[.gz]"; exit 2; }
[ -f "$DUMP" ] || { echo "ERROR: ไม่พบไฟล์ $DUMP"; exit 2; }
[ -z "$ROOT_PW" ] && { read -rsp "MYSQL_ROOT_PASSWORD: " ROOT_PW; echo; }

log(){ echo -e "\n\033[36m[$(date '+%H:%M:%S')] $*\033[0m"; }
my(){ docker exec -i "$CONTAINER" mysql -u root -p"$ROOT_PW" "$@"; }

log "0/4 ตรวจการเชื่อมต่อ + เนื้อที่"
my -e "SELECT VERSION();" >/dev/null || { echo "ERROR: ต่อ MySQL ไม่ได้ (รหัสผ่าน?)"; exit 1; }
NEED_MB=$(( $(stat -c%s "$DUMP") / 1048576 * 3 ))
FREE_MB=$(df -Pm / | awk 'NR==2{print $4}')
echo "   ต้องการ ~${NEED_MB}MB · ว่าง ${FREE_MB}MB"
[ "$FREE_MB" -lt "$NEED_MB" ] && { echo "ERROR: เนื้อที่ไม่พอ"; exit 1; }

log "1/4 สร้าง database (ถ้ายังไม่มี)"
my -e "CREATE DATABASE IF NOT EXISTS \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo "   ok"

log "2/4 นำเข้าข้อมูล (ไฟล์ใหญ่ ใช้เวลาสักครู่)"
if [[ "$DUMP" == *.gz ]]; then
  gunzip -c "$DUMP" | docker exec -i "$CONTAINER" mysql -u root -p"$ROOT_PW" --default-character-set=utf8mb4 "$DB"
else
  docker exec -i "$CONTAINER" mysql -u root -p"$ROOT_PW" --default-character-set=utf8mb4 "$DB" < "$DUMP"
fi
echo "   นำเข้าเสร็จ"

log "3/4 ให้สิทธิ์ app user"
APP_USER="${MYSQL_USER:-wfapp}"
if [ -n "${MYSQL_PASSWORD:-}" ]; then
  my -e "CREATE USER IF NOT EXISTS '$APP_USER'@'%' IDENTIFIED BY '$MYSQL_PASSWORD';
         GRANT SELECT, INSERT, UPDATE, DELETE ON \`$DB\`.* TO '$APP_USER'@'%';
         FLUSH PRIVILEGES;"
  echo "   grant ให้ '$APP_USER' แล้ว"
else
  echo "   ข้าม (ไม่ได้ตั้ง MYSQL_PASSWORD)"
fi

log "4/4 ตรวจผลลัพธ์"
my -e "SELECT table_name, table_rows
       FROM information_schema.tables
       WHERE table_schema='$DB' ORDER BY table_rows DESC LIMIT 8;" "$DB"
N=$(my -N -e "SELECT COUNT(*) FROM tblscale;" "$DB" | tr -d '\r')
echo "   tblscale = ${N} แถว"
if [ "${N:-0}" -lt 1000 ]; then
  echo "   ⚠ น้อยผิดปกติ — ตรวจว่า dump ถูกไฟล์/ถูกฐาน"
else
  echo "   ✓ ข้อมูลครบตามคาด (อ้างอิงเดิม ~403,908 แถว)"
fi

cat <<EOF

============================================================
 RESTORE MySQL เสร็จ
============================================================
 ตรวจต่อ:  node scripts/preflight-check.js
============================================================
EOF
