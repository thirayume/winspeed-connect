#!/usr/bin/env bash
#
# จัดการ allowlist ของ ufw สำหรับพอร์ตที่ไม่เปิดสาธารณะ (SSH · MSSQL · MySQL)
#
# ที่มา: VPS ตั้ง ufw ให้พอร์ต 22/1433/3306 เปิดเฉพาะ IP ที่อนุญาตไว้
# ซึ่งถูกต้องแล้ว แต่ IP ของผู้ดูแลเป็น IP ไม่คงที่ พอ ISP เปลี่ยนให้เมื่อไร
# ก็เข้าเซิร์ฟเวอร์ไม่ได้ทันที และแก้ไม่ได้ด้วยเพราะ SSH ก็โดนกั้นไปด้วย
# (เกิดขึ้นจริง 31/08/2569 — allowlist ค้างที่ IP เก่า เข้าเซิร์ฟเวอร์ไม่ได้ทั้งทีม
#  ค่า allowlist ปัจจุบันดูได้ที่ deploy/cloud-vps/.local-secrets/CREDENTIALS.txt [NETWORK] ซึ่งไม่อยู่ใน repo)
#
# ใช้งาน (รันบนเซิร์ฟเวอร์ด้วย root)
#   ./allowlist.sh add 1.2.3.4          เพิ่ม IP เดียว
#   ./allowlist.sh add-ddns host.ddns.net   เพิ่มตามชื่อโดเมน แล้วตามให้เองภายหลัง
#   ./allowlist.sh sync                 อ่านชื่อโดเมนที่ลงทะเบียนไว้ แล้วปรับกฎให้ตรง
#   ./allowlist.sh list                 ดูกฎปัจจุบัน
#   ./allowlist.sh remove 1.2.3.4       เอาออก
#   ./allowlist.sh install-timer        ตั้งให้ sync อัตโนมัติทุก 5 นาที
#
set -euo pipefail

PORTS=(22 1433 3306)
DDNS_FILE=/etc/wf-allowlist-ddns          # หนึ่งบรรทัดหนึ่งโดเมน
STATE_FILE=/var/lib/wf-allowlist-state    # โดเมน<TAB>ไอพีที่เปิดไว้ล่าสุด

need_root() { [ "$(id -u)" -eq 0 ] || { echo "ต้องรันด้วย root" >&2; exit 1; }; }

valid_ip() { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; }

allow_ip() {
  local ip="$1"
  valid_ip "$ip" || { echo "รูปแบบ IP ไม่ถูก: $ip" >&2; return 1; }
  for p in "${PORTS[@]}"; do
    ufw allow from "$ip" to any port "$p" proto tcp comment "wf-allowlist" >/dev/null
  done
  echo "เปิดให้ $ip แล้ว (พอร์ต ${PORTS[*]})"
}

deny_ip() {
  local ip="$1"
  for p in "${PORTS[@]}"; do
    ufw delete allow from "$ip" to any port "$p" proto tcp >/dev/null 2>&1 || true
  done
  echo "เอา $ip ออกแล้ว"
}

cmd="${1:-list}"
case "$cmd" in
  add)
    need_root; allow_ip "${2:?ระบุ IP ด้วย}"
    ;;

  add-ddns)
    need_root
    host="${2:?ระบุชื่อโดเมนด้วย}"
    touch "$DDNS_FILE"
    grep -qxF "$host" "$DDNS_FILE" || echo "$host" >> "$DDNS_FILE"
    echo "ลงทะเบียน $host แล้ว — รัน sync เพื่อเปิดกฎทันที"
    ;;

  sync)
    need_root
    [ -f "$DDNS_FILE" ] || { echo "ยังไม่มีโดเมนที่ลงทะเบียน ($DDNS_FILE)"; exit 0; }
    touch "$STATE_FILE"
    changed=0
    while read -r host; do
      [ -n "$host" ] || continue
      # getent ใช้ resolver ของระบบ ไม่ต้องพึ่ง dig ที่อาจไม่ได้ติดตั้ง
      new=$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1; exit}' || true)
      if [ -z "$new" ]; then
        echo "แปลงชื่อ $host ไม่ได้ — ข้ามไป ไม่แตะกฎเดิม" >&2
        continue                       # DNS ล่มต้องไม่ทำให้คนที่เข้าได้อยู่หลุด
      fi
      old=$(awk -v h="$host" '$1==h {print $2}' "$STATE_FILE" | tail -1)
      if [ "$new" != "$old" ]; then
        allow_ip "$new"
        [ -n "$old" ] && deny_ip "$old"
        # เขียนสถานะแบบ tmp+rename กัน state พังถ้าไฟดับกลางคัน
        grep -v -P "^\Q$host\E\t" "$STATE_FILE" > "$STATE_FILE.tmp" 2>/dev/null || true
        printf '%s\t%s\n' "$host" "$new" >> "$STATE_FILE.tmp"
        mv "$STATE_FILE.tmp" "$STATE_FILE"
        echo "$host: $old -> $new"
        changed=1
      fi
    done < "$DDNS_FILE"
    [ "$changed" -eq 0 ] && echo "ไม่มีอะไรเปลี่ยน"
    ;;

  list)
    ufw status numbered | grep -E "22|1433|3306" || echo "ไม่มีกฎสำหรับพอร์ตเหล่านี้"
    ;;

  remove)
    need_root; deny_ip "${2:?ระบุ IP ด้วย}"
    ;;

  install-timer)
    need_root
    install -m 755 "$(readlink -f "$0")" /usr/local/sbin/wf-allowlist
    cat > /etc/systemd/system/wf-allowlist.service <<'EOF'
[Unit]
Description=ปรับ ufw allowlist ตาม DDNS ของ WorldFert
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/wf-allowlist sync
EOF
    cat > /etc/systemd/system/wf-allowlist.timer <<'EOF'
[Unit]
Description=ตรวจ DDNS ของ WorldFert ทุก 5 นาที

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now wf-allowlist.timer
    echo "ตั้ง timer แล้ว — ตรวจด้วย: systemctl list-timers wf-allowlist.timer"
    ;;

  *)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
