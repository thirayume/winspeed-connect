#!/usr/bin/env bash
# Prepare a fresh Ubuntu 22.04/24.04 VPS for WorldFert Docker Compose + public SFTP.
set -euo pipefail

CONFIG_FILE="${1:-}"
DEPLOY_PUBLIC_KEY_FILE="${2:-}"
SFTP_PUBLIC_KEY_FILE="${3:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run with sudo/root" >&2
  exit 1
fi
if [ -z "$CONFIG_FILE" ] || [ ! -f "$CONFIG_FILE" ]; then
  echo "Usage: sudo bash prepare-server.sh /path/server-config.env /path/deploy.pub /path/sftp.pub" >&2
  exit 2
fi
if [ ! -f "$DEPLOY_PUBLIC_KEY_FILE" ] || [ ! -f "$SFTP_PUBLIC_KEY_FILE" ]; then
  echo "ERROR: deploy/SFTP public key file is missing" >&2
  exit 2
fi

CONFIG_CLEAN=$(mktemp)
trap 'rm -f "$CONFIG_CLEAN"' EXIT
tr -d '\r' < "$CONFIG_FILE" > "$CONFIG_CLEAN"
set -a
# shellcheck disable=SC1090
. "$CONFIG_CLEAN"
set +a

: "${DEPLOY_USER:=wfdeploy}"
: "${SFTP_USER:=wfbackup}"
: "${SSH_PORT:=22}"
: "${APP_ROOT:=/opt/worldfert}"
: "${TRANSFER_ROOT:=/srv/wf-transfer}"
: "${SERVER_TIMEZONE:=Asia/Bangkok}"
: "${ADMIN_ALLOWED_CIDRS:?Set ADMIN_ALLOWED_CIDRS}"
: "${SFTP_ALLOWED_CIDRS:?Set SFTP_ALLOWED_CIDRS}"
: "${DB_ALLOWED_CIDRS:?Set DB_ALLOWED_CIDRS}"
: "${ALLOW_DATABASES_FROM_ANYWHERE:=false}"

log() { printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"; }

if [[ ",$DB_ALLOWED_CIDRS," == *",0.0.0.0/0,"* ]] && [ "$ALLOW_DATABASES_FROM_ANYWHERE" != "true" ]; then
  echo "ERROR: DB_ALLOWED_CIDRS includes 0.0.0.0/0 but ALLOW_DATABASES_FROM_ANYWHERE is not true" >&2
  exit 3
fi

log "Install OpenSSH, certificate and backup tools"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y openssh-server ufw openssl gzip cron curl ca-certificates

# Hostinger's Ubuntu image may already use Docker's official repository
# (docker-ce + containerd.io). Do not install Ubuntu's docker.io package over it,
# because docker.io depends on containerd and conflicts with containerd.io.
if ! command -v docker >/dev/null 2>&1; then
  log "Docker is not installed; install Ubuntu Docker packages"
  apt-get install -y docker.io docker-compose-v2
fi
if ! docker compose version >/dev/null 2>&1; then
  log "Docker Compose plugin is missing; install the compatible package"
  if apt-cache show docker-compose-plugin >/dev/null 2>&1; then
    apt-get install -y docker-compose-plugin
  else
    apt-get install -y docker-compose-v2
  fi
fi
systemctl enable --now docker ssh cron
timedatectl set-timezone "$SERVER_TIMEZONE"

if ! swapon --show=NAME --noheadings | grep -q .; then
  log "Create a 2 GB emergency swap file"
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi

log "Configure the existing root account for key-based deployment"
if [ "$DEPLOY_USER" != "root" ]; then
  echo "ERROR: this hardened profile requires DEPLOY_USER=root; no extra privileged account is created" >&2
  exit 4
fi
install -d -m 700 -o root -g root /root/.ssh
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
DEPLOY_KEY_LINE=$(tr -d '\r\n' < "$DEPLOY_PUBLIC_KEY_FILE")
grep -qxF "$DEPLOY_KEY_LINE" /root/.ssh/authorized_keys || printf '%s\n' "$DEPLOY_KEY_LINE" >> /root/.ssh/authorized_keys

if ! id "$SFTP_USER" >/dev/null 2>&1; then
  useradd --no-create-home --home-dir /incoming --shell /usr/sbin/nologin "$SFTP_USER"
fi
passwd -l "$SFTP_USER" >/dev/null 2>&1 || true
install -d -m 755 /etc/ssh/authorized_keys
install -m 640 -o root -g "$SFTP_USER" "$SFTP_PUBLIC_KEY_FILE" "/etc/ssh/authorized_keys/$SFTP_USER"
sed -i 's/\r$//' "/etc/ssh/authorized_keys/$SFTP_USER"

log "Create SFTP transfer directories"
install -d -m 755 -o root -g root "$TRANSFER_ROOT"
for path in \
  incoming/mssql incoming/mysql \
  outgoing/mssql outgoing/mysql \
  manifests manifests/certs rejected; do
  install -d -m 755 -o "$SFTP_USER" -g "$SFTP_USER" "$TRANSFER_ROOT/$path"
done
install -d -m 770 -o 10001 -g root "$TRANSFER_ROOT/work/mssql"
install -d -m 770 -o root -g root "$TRANSFER_ROOT/work/mysql"

log "Configure a chrooted, SFTP-only account"
SSHD_SNIPPET="/etc/ssh/sshd_config.d/60-worldfert-sftp.conf"
SSHD_BACKUP="${SSHD_SNIPPET}.previous"
[ -f "$SSHD_SNIPPET" ] && cp -f "$SSHD_SNIPPET" "$SSHD_BACKUP"
cat > "$SSHD_SNIPPET" <<EOF
Match User $SFTP_USER
    ChrootDirectory $TRANSFER_ROOT
    ForceCommand internal-sftp -u 0022
    AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    PasswordAuthentication no
    PubkeyAuthentication yes
    AllowTcpForwarding no
    X11Forwarding no
    PermitTunnel no
EOF
if ! sshd -t; then
  echo "ERROR: sshd configuration test failed; reverting" >&2
  if [ -f "$SSHD_BACKUP" ]; then mv -f "$SSHD_BACKUP" "$SSHD_SNIPPET"; else rm -f "$SSHD_SNIPPET"; fi
  exit 1
fi
rm -f "$SSHD_BACKUP"
systemctl reload ssh

log "Generate a private database CA and TLS server certificates"
CA_DIR="$APP_ROOT/secrets/db-ca"
MSSQL_DIR="$APP_ROOT/secrets/mssql"
MYSQL_DIR="$APP_ROOT/secrets/mysql"
install -d -m 700 "$CA_DIR" "$MSSQL_DIR" "$MYSQL_DIR"

if [ ! -f "$CA_DIR/ca.key" ] || [ ! -f "$CA_DIR/ca.crt" ]; then
  openssl req -x509 -newkey rsa:4096 -sha256 -nodes -days 3650 \
    -subj "/CN=WorldFert Private Database CA" \
    -keyout "$CA_DIR/ca.key" -out "$CA_DIR/ca.crt"
fi

make_server_cert() {
  local cert_dir="$1" common_name="$2" internal_name="${3:-}"
  local san="DNS:$common_name"
  [ -n "$internal_name" ] && san="$san,DNS:$internal_name"
  [ -n "${SERVER_PUBLIC_IP:-}" ] && san="$san,IP:$SERVER_PUBLIC_IP"
  openssl req -new -newkey rsa:3072 -sha256 -nodes \
    -subj "/CN=$common_name" -addext "subjectAltName=$san" \
    -keyout "$cert_dir/server.key" -out "$cert_dir/server.csr"
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$san" > "$cert_dir/server.ext"
  openssl x509 -req -sha256 -days 825 \
    -in "$cert_dir/server.csr" -CA "$CA_DIR/ca.crt" -CAkey "$CA_DIR/ca.key" -CAcreateserial \
    -extfile "$cert_dir/server.ext" -out "$cert_dir/server.crt"
  cp -f "$CA_DIR/ca.crt" "$cert_dir/ca.crt"
  rm -f "$cert_dir/server.csr" "$cert_dir/server.ext"
}

make_server_cert "$MSSQL_DIR" "${MSSQL_DOMAIN:-mssql.local}" "mssql"
make_server_cert "$MYSQL_DIR" "${MYSQL_DOMAIN:-mysql.local}" "mysql"

cat > "$MSSQL_DIR/mssql.conf" <<EOF
[network]
forceencryption = 1
tlscert = /var/opt/mssql/secrets/server.crt
tlskey = /var/opt/mssql/secrets/server.key
tlsprotocols = 1.2
EOF
chown -R 10001:root "$MSSQL_DIR"
chmod 600 "$MSSQL_DIR/server.key"
chmod 644 "$MSSQL_DIR/server.crt" "$MSSQL_DIR/ca.crt" "$MSSQL_DIR/mssql.conf"
chown -R 999:999 "$MYSQL_DIR"
chmod 600 "$MYSQL_DIR/server.key"
chmod 644 "$MYSQL_DIR/server.crt" "$MYSQL_DIR/ca.crt"
install -m 644 -o "$SFTP_USER" -g "$SFTP_USER" "$CA_DIR/ca.crt" "$TRANSFER_ROOT/manifests/certs/worldfert-db-ca.crt"

log "Leave UFW unchanged; Hostinger Firewall is managed separately before containers start"
ufw status || true

install -d -m 755 -o root -g root "$APP_ROOT/app"

log "Preparation complete"
echo "Deploy user : root (existing Hostinger account, SSH key only for automation)"
echo "SFTP user  : $SFTP_USER (chroot $TRANSFER_ROOT)"
echo "Firewall   : Hostinger Firewall must allow 80/443 publicly and 22/1433/3306 from approved CIDRs"
echo "Next       : copy deploy/cloud-vps/.env, then run 03-remote-deploy.bat"
