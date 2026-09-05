#!/usr/bin/env bash
# ติดตั้ง GitHub Actions self-hosted runner บน VPS นี้
#
# ทำไมต้องมี
#   ไฟร์วอลล์ hPanel เปิด 22/1433 ให้เฉพาะ IP ที่ allowlist ไว้
#   แต่ ISP ของผู้พัฒนาเปลี่ยน IP บ่อย (4 ครั้งใน 2 วัน · 4–5 ก.ย. 2569)
#   ทุกครั้งที่เปลี่ยนต้องไปแก้ไฟร์วอลล์ก่อนถึงจะ deploy ได้
#
#   runner ตัวนี้รันอยู่บน VPS และต่อ *ออก* ไปหา GitHub
#   จึงไม่ต้องเปิดพอร์ตขาเข้าเลย และเลิกผูกกับ IP ของใครทั้งสิ้น
#
# ⚠ repo นี้เป็นสาธารณะ
#   self-hosted runner บน repo สาธารณะเสี่ยงถ้าเปิดให้ pull_request ทริกเกอร์ได้
#   คนนอกจะ fork แล้วส่ง PR ที่รันโค้ดอะไรก็ได้บนเครื่อง production
#   .github/workflows/deploy-prod-b.yml จึงจำกัดไว้แค่ push main และกดมือ
#   **ห้ามเพิ่ม pull_request เข้าไปใน workflow นั้นเด็ดขาด**
#
#   แนะนำเพิ่มเติม: ตั้งค่า repo ให้ Actions ของ fork ต้องอนุมัติก่อนรัน
#   Settings > Actions > General > "Require approval for all outside collaborators"
#
# ใช้:
#   sudo bash install-github-runner.sh <GITHUB_RUNNER_TOKEN>
#
#   เอา token จาก GitHub:
#     Settings > Actions > Runners > New self-hosted runner > Linux
#     คัดลอกค่าที่อยู่หลัง --token (มีอายุ 1 ชั่วโมง)
set -euo pipefail

REPO_URL="https://github.com/thirayume/winspeed-connect"
RUNNER_USER="ghrunner"
RUNNER_DIR="/opt/github-runner"
# ⚠ runner ที่เก่าเกินไปจะถูก GitHub ปฏิเสธไม่ให้เชื่อมต่อ
#   ตรวจรุ่นล่าสุดก่อนติดตั้งเสมอ:
#     curl -s https://api.github.com/repos/actions/runner/releases/latest | grep tag_name
#   แล้วอัปเดตทั้ง RUNNER_VERSION และ RUNNER_SHA256 ให้ตรงกัน (SHA256 อยู่ในหน้า release)
RUNNER_VERSION="2.337.0"
RUNNER_SHA256="70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613"
LABELS="self-hosted,linux,prod-b"

TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then
  echo "ต้องใส่ runner token: sudo bash $0 <TOKEN>" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "ต้องรันด้วย sudo" >&2
  exit 1
fi

echo "== 1/5 สร้างผู้ใช้เฉพาะสำหรับ runner =="
# ไม่รัน runner ด้วย root — ถ้าโค้ดใน workflow มีปัญหาจะได้ไม่ได้สิทธิ์เต็มเครื่อง
if ! id -u "$RUNNER_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$RUNNER_USER"
fi
# ต้องใช้ docker และ sudo เฉพาะคำสั่ง deploy เท่านั้น
usermod -aG docker "$RUNNER_USER" || true

cat > /etc/sudoers.d/ghrunner <<SUDO
# runner ต้องใช้ sudo เฉพาะขั้นตอน deploy เท่านั้น ไม่ให้สิทธิ์ทั้งเครื่อง
$RUNNER_USER ALL=(root) NOPASSWD: /opt/worldfert/app/deploy/cloud-vps/server/deploy-release.sh
$RUNNER_USER ALL=(root) NOPASSWD: /bin/rm, /bin/mkdir, /bin/chmod, /usr/bin/rsync
SUDO
chmod 440 /etc/sudoers.d/ghrunner
visudo -c >/dev/null

echo "== 2/5 ติดตั้ง node กับ rsync ถ้ายังไม่มี =="
command -v rsync >/dev/null || (apt-get update -qq && apt-get install -y -qq rsync)
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

echo "== 3/5 ดาวน์โหลด runner =="
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"
if [ ! -f ./config.sh ]; then
  curl -fsSL -o runner.tar.gz \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  # ตรวจ checksum ก่อนแตกไฟล์ — สคริปต์นี้ดาวน์โหลดโค้ดมารันบนเครื่อง production
  # ถ้าไฟล์ถูกสับเปลี่ยนระหว่างทาง เราจะได้รู้ตรงนี้ ไม่ใช่ตอนมันรันไปแล้ว
  echo "${RUNNER_SHA256}  runner.tar.gz" | sha256sum -c - || {
    echo "ERROR: checksum ของไฟล์ที่โหลดมาไม่ตรง — หยุดทันที" >&2
    rm -f runner.tar.gz
    exit 1
  }
  tar xzf runner.tar.gz && rm -f runner.tar.gz
fi
chown -R "$RUNNER_USER":"$RUNNER_USER" "$RUNNER_DIR"

echo "== 4/5 ผูกกับ repo =="
sudo -u "$RUNNER_USER" ./config.sh \
  --url "$REPO_URL" \
  --token "$TOKEN" \
  --name "prod-b-hostinger" \
  --labels "$LABELS" \
  --work "_work" \
  --unattended \
  --replace

echo "== 5/5 ติดตั้งเป็น service ให้ขึ้นเองหลัง reboot =="
./svc.sh install "$RUNNER_USER"
./svc.sh start
sleep 3
./svc.sh status || true

cat <<DONE

เสร็จแล้ว

  runner  : prod-b-hostinger
  labels  : $LABELS
  service : ขึ้นเองหลัง reboot

ตรวจที่ GitHub: Settings > Actions > Runners ต้องเห็นสถานะ Idle สีเขียว

ทดสอบ: กด Run workflow ที่ Actions > Deploy PROD-B
ตั้งแต่นี้ไป push เข้า main จะ deploy PROD-B ให้เอง โดยไม่ต้องแก้ไฟร์วอลล์อีก

ถอนออก:
  cd $RUNNER_DIR && ./svc.sh stop && ./svc.sh uninstall
  sudo -u $RUNNER_USER ./config.sh remove --token <TOKEN ใหม่>
DONE
