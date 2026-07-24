#!/usr/bin/env bash
# =============================================================
# up.sh — ติดตั้ง/สตาร์ท WS-Sale-App แบบ on-prem (Ubuntu/Linux)
# =============================================================
#   bash up.sh                  ติดตั้ง/สตาร์ททั้งหมด
#   bash up.sh --rebuild        build ใหม่ทั้งหมด (ไม่ใช้ cache)
#   bash up.sh --skip-bootstrap แค่สตาร์ท ไม่แตะฐานข้อมูล
#   bash up.sh --down           หยุดทุก container (ข้อมูลใน volume ไม่หาย)
# =============================================================
set -uo pipefail
cd "$(dirname "$0")"

REBUILD=0; SKIP_BOOT=0; DOWN=0
for a in "$@"; do
  case "$a" in
    --rebuild)        REBUILD=1 ;;
    --skip-bootstrap) SKIP_BOOT=1 ;;
    --down)           DOWN=1 ;;
    -h|--help)        sed -n '2,12p' "$0"; exit 0 ;;
  esac
done

head(){ echo; echo "============================================================"; echo "  $*"; echo "============================================================"; }
step(){ echo; echo -e "\033[36m>> $*\033[0m"; }
ok(){   echo -e "   \033[32m[OK]\033[0m $*"; }
warn(){ echo -e "   \033[33m[!]\033[0m $*"; }
die(){  echo -e "\n   \033[31m[X]\033[0m $1"; shift; for h in "$@"; do echo "       $h"; done; echo; exit 1; }

head "WS-Sale-App — On-Prem"

step "ตรวจ Docker"
command -v docker >/dev/null 2>&1 || die "ไม่พบคำสั่ง docker" "ติดตั้ง: curl -fsSL https://get.docker.com | sh"
docker info >/dev/null 2>&1 || die "Docker ไม่ได้รันอยู่หรือสิทธิ์ไม่พอ" \
  "sudo systemctl start docker" "หรือเพิ่มตัวเองเข้ากลุ่ม: sudo usermod -aG docker \$USER แล้ว logout/login"
docker compose version >/dev/null 2>&1 || die "ไม่พบ docker compose (v2)" "ติดตั้ง docker-compose-plugin"
ok "Docker พร้อม"

if [ "$DOWN" = "1" ]; then
  step "หยุดทุก container"
  docker compose down
  ok "หยุดแล้ว (ข้อมูลใน volume ยังอยู่ครบ)"
  exit 0
fi

step "ตรวจไฟล์ .env"
if [ ! -f .env ]; then
  cp .env.example .env
  die "สร้าง .env ให้แล้ว — ต้องแก้ค่าก่อนใช้งาน" \
      "nano .env  แล้วแก้ APP_DOMAIN / API_DOMAIN / VITE_API_BASE_URL / CORS_ORIGIN" \
      "และรหัสผ่านทุกตัวที่ขึ้นต้นด้วย CHANGE_ME" \
      "เสร็จแล้วรัน bash up.sh ใหม่"
fi
LEFT=$(grep -cE '^[A-Z_]+=CHANGE_ME' .env || true)
[ "${LEFT:-0}" -gt 0 ] && die "ยังมีค่า CHANGE_ME ใน .env ($LEFT ตัว)" "$(grep -E '^[A-Z_]+=CHANGE_ME' .env | cut -d= -f1 | tr '\n' ' ')"
ok ".env พร้อม"

mkdir -p ./backup
BAK=$(ls -1 ./backup/*.bak 2>/dev/null | head -1)
SQLD=$(ls -1 ./backup/*.sql 2>/dev/null | head -1)
[ -n "$BAK" ]  && ok "พบ .bak : $(basename "$BAK")"  || warn "ไม่มี .bak ใน ./backup/ — จะข้าม restore SQL Server"
[ -n "$SQLD" ] && ok "พบ .sql : $(basename "$SQLD")" || warn "ไม่มี .sql ใน ./backup/ — จะข้าม restore MySQL"

# SQL Server ใน container รันเป็น uid 10001 ต้องอ่าน/เขียนโฟลเดอร์ backup ได้
if [ "$(id -u)" = "0" ] || sudo -n true 2>/dev/null; then
  chown -R 10001:10001 ./backup 2>/dev/null || sudo chown -R 10001:10001 ./backup 2>/dev/null || true
fi
chmod 775 ./backup 2>/dev/null || true

step "build + start (ครั้งแรกใช้เวลานาน ~5-15 นาที)"
[ "$REBUILD" = "1" ] && { docker compose build --no-cache || die "build ล้มเหลว"; }
docker compose up -d --build || die "docker compose up ล้มเหลว" "ดู log: docker compose logs --tail 50"
ok "container สตาร์ทแล้ว"

if [ "$SKIP_BOOT" = "1" ]; then
  warn "ข้าม bootstrap (--skip-bootstrap)"
else
  step "ตั้งค่าฐานข้อมูล (restore + migrations + seed)"
  bash ./bootstrap.sh || die "bootstrap ล้มเหลว" "แก้แล้วรันซ้ำได้: bash bootstrap.sh"
fi

head "เสร็จสิ้น"
docker compose ps --format "table {{.Name}}\t{{.Status}}"
APP=$(grep -E '^APP_DOMAIN=' .env | cut -d= -f2-)
echo
echo "  หน้าเว็บ : https://${APP}"
echo "  login    : admin / W0rldF3rt   (W0rld ใช้เลขศูนย์)"
echo
echo "  ดู log   : docker compose logs -f backend"
echo "  หยุด     : bash up.sh --down"
echo
