#!/usr/bin/env bash
# ติดตั้ง cron ให้สำรอง transaction log ทุก 30 นาที
# คู่กับ install-weekly-backup.sh ที่ทำ full backup รายสัปดาห์
set -euo pipefail

APP_DIR="${1:-/opt/worldfert/app}"
SCRIPT="$APP_DIR/deploy/cloud-vps/server/backup-log.sh"
[ "$(id -u)" -eq 0 ] || { echo "ERROR: run with sudo/root" >&2; exit 1; }
[ -f "$SCRIPT" ] || { echo "ERROR: ไม่พบ $SCRIPT" >&2; exit 1; }
[ -x "$SCRIPT" ] || chmod +x "$SCRIPT"

cat > /etc/cron.d/worldfert-db-logbackup <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CRON_TZ=Asia/Bangkok
*/30 * * * * root $SCRIPT $APP_DIR >> /var/log/worldfert-logbackup.log 2>&1
EOF
chmod 644 /etc/cron.d/worldfert-db-logbackup

cat > /etc/logrotate.d/worldfert-logbackup <<'EOF'
/var/log/worldfert-logbackup.log {
  daily
  rotate 14
  compress
  missingok
  notifempty
  create 0640 root adm
}
EOF

systemctl reload cron 2>/dev/null || systemctl restart cron
echo "ติดตั้งแล้ว: สำรอง transaction log ทุก 30 นาที (Asia/Bangkok)"
echo
echo "ตรวจการทำงาน:"
echo "  sudo $SCRIPT $APP_DIR --dry-run     # ทดสอบโดยไม่เขียนไฟล์จริง"
echo "  sudo $SCRIPT $APP_DIR               # รันจริงหนึ่งรอบ"
echo "  tail -f /var/log/worldfert-logbackup.log"
echo
echo "หลังรันสำเร็จรอบแรก log จะตัดตัวเองได้แล้ว แต่ไฟล์ยังใหญ่เท่าเดิม"
echo "ให้ย่อครั้งเดียวด้วย (ดูชื่อไฟล์ log จริงก่อนด้วย sys.database_files):"
echo "  DBCC SHRINKFILE (<ชื่อไฟล์ log>, 1024)"
