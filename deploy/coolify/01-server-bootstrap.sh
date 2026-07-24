#!/usr/bin/env bash
# =============================================================
# 01-server-bootstrap.sh — เตรียม Ubuntu 24.04 ใหม่ให้พร้อมรัน Coolify
# =============================================================
# รันบน VM ในฐานะ root:
#   ssh root@YOUR_IP
#
#   # ใช้ Coolify Cloud (app.coolify.io) — ค่าเริ่มต้น
#   bash 01-server-bootstrap.sh --mode cloud
#
#   # ติดตั้ง Coolify บน VPS เอง (ฟรี แต่กิน RAM ~1GB)
#   bash 01-server-bootstrap.sh --mode self --admin-ip 1.2.3.4
#
# --mode cloud : ไม่ติดตั้ง Coolify · เปิด SSH(22) ให้เข้าได้จากภายนอก
#                เพราะ Coolify Cloud ต้อง SSH เข้ามาจากเซิร์ฟเวอร์ของเขา
#                (ถ้าล็อก 22 ไว้เฉพาะ IP คุณ → Coolify เชื่อม server ไม่ได้)
# --mode self  : ติดตั้ง Coolify + จำกัด 22/8000 เฉพาะ --admin-ip
# =============================================================
set -euo pipefail

ADMIN_IP=""
MODE="cloud"
while [ $# -gt 0 ]; do
  case "$1" in
    --admin-ip) ADMIN_IP="$2"; shift 2 ;;
    --mode)     MODE="$2";     shift 2 ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
done
case "$MODE" in
  cloud) : ;;
  self)  [ -z "$ADMIN_IP" ] && { echo "ERROR: โหมด self ต้องระบุ --admin-ip <IP|any>"; exit 2; } ;;
  *) echo "ERROR: --mode ต้องเป็น cloud หรือ self"; exit 2 ;;
esac

log(){ echo -e "\n\033[36m[$(date '+%H:%M:%S')] $*\033[0m"; }

log "1/7 อัปเดตระบบ"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

log "2/7 ติดตั้งเครื่องมือพื้นฐาน"
apt-get install -y -qq curl wget ufw fail2ban unattended-upgrades \
  ca-certificates gnupg rsync gzip jq >/dev/null

log "3/7 สร้าง swap 4GB (กัน OOM ตอน SQL Server + restore)"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
  echo "   swap พร้อม"
else
  echo "   มี swap อยู่แล้ว — ข้าม"
fi

log "4/7 ตั้ง timezone = Asia/Bangkok"
timedatectl set-timezone Asia/Bangkok
date

log "5/7 Firewall (ufw) — mode=$MODE"
ufw --force reset >/dev/null
ufw default deny incoming  >/dev/null
ufw default allow outgoing >/dev/null
if [ "$MODE" = "cloud" ]; then
  # Coolify Cloud ต้อง SSH เข้ามาจากเซิร์ฟเวอร์ของเขา → ล็อกเฉพาะ IP เราไม่ได้
  ufw allow 22/tcp >/dev/null
  echo "   SSH(22) เปิดจากภายนอก — จำเป็นสำหรับ Coolify Cloud"
  echo "   ป้องกันด้วย: key-only auth + fail2ban (ตั้งให้แล้ว)"
  echo "   ไม่เปิด 8000 (ไม่ได้ติดตั้ง Coolify บนเครื่องนี้)"
else
  if [ "$ADMIN_IP" = "any" ]; then
    echo "   ⚠ เปิด SSH/Coolify ให้ทุก IP (ควรจำกัดภายหลัง)"
    ufw allow 22/tcp   >/dev/null
    ufw allow 8000/tcp >/dev/null
  else
    ufw allow from "$ADMIN_IP" to any port 22   proto tcp >/dev/null
    ufw allow from "$ADMIN_IP" to any port 8000 proto tcp >/dev/null
    echo "   SSH + Coolify UI จำกัดเฉพาะ $ADMIN_IP"
  fi
fi
ufw allow 80/tcp  >/dev/null       # Traefik / Let's Encrypt
ufw allow 443/tcp >/dev/null
# ⚠ ไม่เปิด 1433 / 3306 — เข้าถึง DB ผ่าน SSH tunnel เท่านั้น
ufw --force enable >/dev/null
ufw status numbered

log "5b/7 บังคับ key-only SSH (ปิด password login)"
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
echo "   password login ปิดแล้ว (เข้าได้ด้วย key เท่านั้น)"

log "6/7 fail2ban + unattended-upgrades"
systemctl enable --now fail2ban >/dev/null 2>&1 || true
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

IP=$(curl -fsS4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

if [ "$MODE" = "self" ]; then
  log "7/7 ติดตั้ง Coolify (self-hosted)"
  if [ -d /data/coolify ]; then
    echo "   Coolify ติดตั้งแล้ว — ข้าม"
  else
    curl -fsSL https://coolify.io/install.sh | bash
  fi
  cat <<EOF

============================================================
 เสร็จแล้ว (self-hosted)
============================================================
 Coolify UI : http://$IP:8000
 ⚠ เปิดทันทีเพื่อสร้าง admin account (ระหว่างนี้ยังไม่มีรหัสป้องกัน)
============================================================
EOF
else
  log "7/7 โหมด Coolify Cloud — ไม่ติดตั้ง Coolify บนเครื่องนี้"
  echo "   Coolify Cloud จะติดตั้ง Docker ให้เองตอนคุณ Add Server"
  cat <<EOF

============================================================
 เสร็จแล้ว (พร้อมให้ Coolify Cloud เชื่อมต่อ)
============================================================
 IP ของเครื่องนี้ : $IP

 ขั้นต่อไปใน app.coolify.io:
   Servers → + Add
     Name        : worldfert-prod
     IP Address  : $IP
     Port        : 22
     User        : root
     Private Key : worldfert-hetzner
   → Validate Server & Install Docker
============================================================
EOF
fi

cat <<EOF
 ตรวจสอบเครื่อง:
   ufw status          # 22 · 80/443 · ไม่มี 1433/3306
   free -h             # เห็น swap 4GB
   df -h /             # ต้องเหลือ > 15GB สำหรับ restore
   timedatectl         # Asia/Bangkok

 จากนั้น: อัปโหลด backup แล้วรัน 02-restore-mssql.sh / 03-restore-mysql.sh
============================================================
EOF
