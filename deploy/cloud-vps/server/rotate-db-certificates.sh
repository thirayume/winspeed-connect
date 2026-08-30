#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/worldfert/app}"
DEPLOY_DIR="$APP_DIR/deploy/cloud-vps"
ENV_FILE="$DEPLOY_DIR/.env"
SECRETS_ROOT="${SECRETS_ROOT:-$(dirname "$APP_DIR")/secrets}"
CA_DIR="$SECRETS_ROOT/db-ca"
MSSQL_DIR="$SECRETS_ROOT/mssql"
MYSQL_DIR="$SECRETS_ROOT/mysql"
TRANSFER_ROOT="${TRANSFER_ROOT:-/srv/wf-transfer}"

[ "$(id -u)" -eq 0 ] || { echo "ERROR: run with sudo/root" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "ERROR: missing $ENV_FILE" >&2; exit 2; }
[ -f "$CA_DIR/ca.key" ] && [ -f "$CA_DIR/ca.crt" ] || {
  echo "ERROR: database CA is missing under $CA_DIR" >&2
  exit 3
}

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${MSSQL_DOMAIN:?MSSQL_DOMAIN is required in .env}"
: "${MYSQL_DOMAIN:?MYSQL_DOMAIN is required in .env}"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$SECRETS_ROOT/db-cert-backups/$STAMP"
install -d -m 700 "$BACKUP_DIR/mssql" "$BACKUP_DIR/mysql"
cp -a "$MSSQL_DIR/server.crt" "$MSSQL_DIR/server.key" "$MSSQL_DIR/ca.crt" "$BACKUP_DIR/mssql/"
cp -a "$MYSQL_DIR/server.crt" "$MYSQL_DIR/server.key" "$MYSQL_DIR/ca.crt" "$BACKUP_DIR/mysql/"

existing_dns_names() {
  local cert="$1"
  openssl x509 -in "$cert" -noout -ext subjectAltName 2>/dev/null \
    | tr ',' '\n' \
    | sed -n 's/^[[:space:]]*DNS://p' \
    | sed 's/[[:space:]]//g' || true
}

existing_ip_names() {
  local cert="$1"
  openssl x509 -in "$cert" -noout -ext subjectAltName 2>/dev/null \
    | tr ',' '\n' \
    | sed -n 's/^[[:space:]]*IP Address://p' \
    | sed 's/[[:space:]]//g' || true
}

make_server_cert() {
  local cert_dir="$1" common_name="$2" internal_name="$3" extra_names="${4:-}"
  local cert="$cert_dir/server.crt" san="" name
  local -a names=("$common_name" "$internal_name")
  local -a ip_names=()
  local -A seen=()
  local -A seen_ip=()

  while IFS= read -r name; do
    [ -n "$name" ] && names+=("$name")
  done < <(existing_dns_names "$cert")

  IFS=',' read -r -a extra_array <<< "$extra_names"
  for name in "${extra_array[@]}"; do
    name="${name//[[:space:]]/}"
    [ -n "$name" ] && names+=("$name")
  done
  while IFS= read -r name; do
    [ -n "$name" ] && ip_names+=("$name")
  done < <(existing_ip_names "$cert")
  [ -n "${SERVER_PUBLIC_IP:-}" ] && ip_names+=("$SERVER_PUBLIC_IP")

  for name in "${names[@]}"; do
    [ -n "$name" ] || continue
    if [ -z "${seen[$name]+x}" ]; then
      seen[$name]=1
      san="${san:+$san,}DNS:$name"
    fi
  done
  for name in "${ip_names[@]}"; do
    [ -n "$name" ] || continue
    if [ -z "${seen_ip[$name]+x}" ]; then
      seen_ip[$name]=1
      san="${san:+$san,}IP:$name"
    fi
  done

  openssl req -new -newkey rsa:3072 -sha256 -nodes \
    -subj "/CN=$common_name" -addext "subjectAltName=$san" \
    -keyout "$cert_dir/server.key.new" -out "$cert_dir/server.csr"
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$san" > "$cert_dir/server.ext"
  openssl x509 -req -sha256 -days 825 \
    -in "$cert_dir/server.csr" -CA "$CA_DIR/ca.crt" -CAkey "$CA_DIR/ca.key" -CAcreateserial \
    -extfile "$cert_dir/server.ext" -out "$cert_dir/server.crt.new"
  mv -f "$cert_dir/server.key.new" "$cert_dir/server.key"
  mv -f "$cert_dir/server.crt.new" "$cert_dir/server.crt"
  cp -f "$CA_DIR/ca.crt" "$cert_dir/ca.crt"
  rm -f "$cert_dir/server.csr" "$cert_dir/server.ext"
}

rollback() {
  echo "ERROR: certificate rollout failed; restoring $BACKUP_DIR" >&2
  cp -a "$BACKUP_DIR/mssql/." "$MSSQL_DIR/"
  cp -a "$BACKUP_DIR/mysql/." "$MYSQL_DIR/"
  chown -R 10001:root "$MSSQL_DIR"
  chown -R 999:999 "$MYSQL_DIR"
  docker restart wf-mssql wf-mysql wf-backend >/dev/null 2>&1 || true
}
trap rollback ERR

make_server_cert "$MSSQL_DIR" "$MSSQL_DOMAIN" "mssql" "${MSSQL_ALT_DOMAINS:-}"
make_server_cert "$MYSQL_DIR" "$MYSQL_DOMAIN" "mysql" "${MYSQL_ALT_DOMAINS:-}"

chown -R 10001:root "$MSSQL_DIR"
chmod 600 "$MSSQL_DIR/server.key"
chmod 644 "$MSSQL_DIR/server.crt" "$MSSQL_DIR/ca.crt" "$MSSQL_DIR/mssql.conf"
chown -R 999:999 "$MYSQL_DIR"
chmod 600 "$MYSQL_DIR/server.key"
chmod 644 "$MYSQL_DIR/server.crt" "$MYSQL_DIR/ca.crt"
install -d -m 755 "$TRANSFER_ROOT/manifests/certs"
install -m 644 "$CA_DIR/ca.crt" "$TRANSFER_ROOT/manifests/certs/worldfert-db-ca.crt"

cd "$DEPLOY_DIR"
docker compose restart mssql mysql
for container in wf-mssql wf-mysql; do
  healthy=0
  for _ in $(seq 1 60); do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || true)
    if [ "$status" = healthy ]; then healthy=1; break; fi
    sleep 5
  done
  [ "$healthy" -eq 1 ] || { echo "ERROR: $container did not become healthy" >&2; false; }
done
docker compose restart backend
for _ in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' wf-backend 2>/dev/null || true)
  [ "$status" = healthy ] && break
  sleep 5
done
[ "${status:-}" = healthy ] || { echo "ERROR: wf-backend did not become healthy" >&2; false; }

trap - ERR
find "$SECRETS_ROOT/db-cert-backups" -mindepth 1 -maxdepth 1 -type d -mtime +90 -exec rm -rf -- {} +
echo "DB CERTIFICATES UPDATED"
echo "MSSQL SAN:"
openssl x509 -in "$MSSQL_DIR/server.crt" -noout -ext subjectAltName
echo "MYSQL SAN:"
openssl x509 -in "$MYSQL_DIR/server.crt" -noout -ext subjectAltName
echo "Rollback copy: $BACKUP_DIR"
