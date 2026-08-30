#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/worldfert/app}"
SCRIPT="$APP_DIR/deploy/cloud-vps/server/backup-databases.sh"
[ "$(id -u)" -eq 0 ] || { echo "ERROR: run with sudo/root" >&2; exit 1; }
[ -x "$SCRIPT" ] || chmod +x "$SCRIPT"

cat > /etc/cron.d/worldfert-db-backup <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CRON_TZ=Asia/Bangkok
0 2 * * 0 root $SCRIPT $APP_DIR >> /var/log/worldfert-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/worldfert-db-backup

cat > /etc/logrotate.d/worldfert-backup <<'EOF'
/var/log/worldfert-backup.log {
  weekly
  rotate 12
  compress
  missingok
  notifempty
  create 0640 root adm
}
EOF

systemctl reload cron 2>/dev/null || systemctl restart cron
echo "Installed: Sunday 02:00 Asia/Bangkok"

