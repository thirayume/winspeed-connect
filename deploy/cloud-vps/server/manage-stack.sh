#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/worldfert/app}"
shift || true
ACTION="${1:-status}"
shift || true
DEPLOY_DIR="$APP_DIR/deploy/cloud-vps"
ENV_FILE="$DEPLOY_DIR/.env"
BACKUP_DIR="$DEPLOY_DIR/.env.backups"

[ "$(id -u)" -eq 0 ] || { echo "ERROR: run with sudo/root" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "ERROR: missing $ENV_FILE" >&2; exit 2; }
cd "$DEPLOY_DIR"

valid_service() {
  case "${1:-}" in
    caddy|frontend|backend|mssql|mysql|portainer|all) return 0 ;;
    *) echo "ERROR: service must be caddy, frontend, backend, mssql, mysql, portainer or all" >&2; return 1 ;;
  esac
}

backup_env() {
  install -d -m 700 "$BACKUP_DIR"
  local copy="$BACKUP_DIR/.env.$(date +%Y%m%d-%H%M%S)"
  cp -p "$ENV_FILE" "$copy"
  find "$BACKUP_DIR" -maxdepth 1 -type f -name '.env.*' -mtime +90 -delete
  printf '%s\n' "$copy"
}

env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -1
}

set_env_value() {
  local key="$1" value="$2" temp
  temp="$(mktemp)"
  awk -v key="$key" -v value="$value" 'BEGIN{done=0} $0 ~ "^" key "=" {print key "=" value; done=1; next} {print} END{if(!done) print key "=" value}' "$ENV_FILE" > "$temp"
  install -m 600 "$temp" "$ENV_FILE"
  rm -f "$temp"
}

show_env_redacted() {
  awk -F= '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ {print; next}
    {
      key=$1
      if (key ~ /(PASSWORD|SECRET|TOKEN|PRIVATE_KEY)/) print key "=********"
      else print
    }
  ' "$ENV_FILE"
}

validate_config() {
  chmod 600 "$ENV_FILE"
  sed -i 's/\r$//' "$ENV_FILE"
  docker compose config --quiet
}

case "$ACTION" in
  status)
    docker compose ps
    ;;
  health)
    "$DEPLOY_DIR/server/health-check.sh" "$APP_DIR"
    ;;
  connections)
    cat <<EOF
Frontend=https://$(env_value APP_DOMAIN)
API=https://$(env_value API_DOMAIN)/api
Portainer=https://$(env_value PORTAINER_DOMAIN)  USERNAME=admin  PASSWORD_COMMAND=11-manage-stack.bat portainer-credentials
MSSQL_HOST=$(env_value MSSQL_DOMAIN)  PORT=$(env_value MSSQL_PUBLIC_PORT)  DATABASE=$(env_value DB_NAME)
MSSQL_USERS=wf_reader[WF_READER_PASSWORD],wf_owner[WF_OWNER_PASSWORD],sa[MSSQL_SA_PASSWORD]
MYSQL_HOST=$(env_value MYSQL_DOMAIN)  PORT=$(env_value MYSQL_PUBLIC_PORT)  DATABASE=$(env_value MYSQL_DATABASE)
MYSQL_USERS=$(env_value MYSQL_USER)[MYSQL_PASSWORD],root[MYSQL_ROOT_PASSWORD]
SFTP_HOST=76.13.190.104  PORT=22  USERNAME=wfbackup  AUTH=Ed25519_key
PASSWORD_SOURCE=protected .local-secrets/CREDENTIALS.txt; secret values are not printed by this command
EOF
    ;;
  env-show)
    show_env_redacted
    ;;
  env-get)
    key="${1:-}"
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "ERROR: invalid key" >&2; exit 3; }
    if [[ "$key" =~ (PASSWORD|SECRET|TOKEN|PRIVATE_KEY) ]]; then
      echo "$key=********"
    else
      grep -E "^${key}=" "$ENV_FILE" || true
    fi
    ;;
  env-set)
    key="${1:-}"
    value="${2:-}"
    case "$key" in
      ROOT_DOMAIN|APP_DOMAIN|API_DOMAIN|PORTAINER_DOMAIN|MSSQL_DOMAIN|MYSQL_DOMAIN|MSSQL_ALT_DOMAINS|MYSQL_ALT_DOMAINS|ACME_EMAIL|VITE_API_BASE_URL|CORS_ORIGIN|DB_NAME|MYSQL_DATABASE|MYSQL_USER|MSSQL_PID|JWT_EXPIRES_IN|TS_SYNC_INTERVAL_MS|APP_VERSION|TZ|MSSQL_MEMORY_LIMIT_MB|MSSQL_MEM_LIMIT|MYSQL_BUFFER_POOL|MYSQL_MEM_LIMIT|DB_BIND_IP|MSSQL_PUBLIC_PORT|MYSQL_PUBLIC_PORT|HTTP_PORT|HTTPS_PORT|TRANSFER_ROOT|BACKUP_RETAIN_DAYS|BACKUP_MIN_FREE_GB|LINE_LOGIN_CALLBACK_URL|LINE_LOGIN_SUCCESS_REDIRECT) ;;
      *) echo "ERROR: $key is not in the non-secret allowlist; use env-edit for secrets" >&2; exit 3 ;;
    esac
    [ -n "$value" ] || { echo "ERROR: value is required" >&2; exit 3; }
    copy="$(backup_env)"
    set_env_value "$key" "$value"
    if ! validate_config; then cp -p "$copy" "$ENV_FILE"; exit 4; fi
    echo "UPDATED $key (not deployed yet)"
    ;;
  env-edit)
    copy="$(backup_env)"
    if command -v nano >/dev/null 2>&1; then nano "$ENV_FILE"; else vi "$ENV_FILE"; fi
    if ! validate_config; then
      cp -p "$copy" "$ENV_FILE"
      echo "ERROR: invalid Compose configuration; previous .env restored" >&2
      exit 4
    fi
    echo "ENV UPDATED (not deployed yet); backup=$copy"
    ;;
  env-backups)
    find "$BACKUP_DIR" -maxdepth 1 -type f -name '.env.*' -printf '%TY-%Tm-%Td %TH:%TM  %p\n' 2>/dev/null | sort -r || true
    ;;
  env-rollback)
    requested="${1:-latest}"
    confirm="${2:-}"
    [ "$confirm" = "--confirm" ] || { echo "ERROR: add --confirm" >&2; exit 3; }
    if [ "$requested" = latest ]; then
      requested="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '.env.*' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
    fi
    [ -f "$requested" ] || { echo "ERROR: backup not found" >&2; exit 3; }
    backup_env >/dev/null
    cp -p "$requested" "$ENV_FILE"
    validate_config
    echo "ENV ROLLED BACK (not deployed yet): $requested"
    ;;
  domain-set)
    base="${1:-}"
    [[ "$base" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]] || {
      echo "ERROR: invalid base domain" >&2
      exit 3
    }
    copy="$(backup_env)"
    set_env_value ROOT_DOMAIN "$base"
    set_env_value APP_DOMAIN "app.$base"
    set_env_value API_DOMAIN "api.$base"
    set_env_value PORTAINER_DOMAIN "portainer.$base"
    set_env_value MSSQL_DOMAIN "mssql.$base"
    set_env_value MYSQL_DOMAIN "mysql.$base"
    set_env_value VITE_API_BASE_URL "https://api.$base/api"
    set_env_value CORS_ORIGIN "https://app.$base"
    if ! validate_config; then cp -p "$copy" "$ENV_FILE"; exit 4; fi
    "$DEPLOY_DIR/server/deploy-release.sh" "$APP_DIR"
    "$DEPLOY_DIR/server/rotate-db-certificates.sh" "$APP_DIR"
    "$DEPLOY_DIR/server/health-check.sh" "$APP_DIR"
    echo "DOMAIN ROLLOUT OK: $base"
    ;;
  deploy)
    "$DEPLOY_DIR/server/deploy-release.sh" "$APP_DIR"
    ;;
  rebuild)
    service="${1:-all}"
    valid_service "$service"
    if [ "$service" = all ]; then docker compose up -d --build --remove-orphans; else docker compose up -d --build "$service"; fi
    "$DEPLOY_DIR/server/health-check.sh" "$APP_DIR" --local-only
    ;;
  restart)
    service="${1:-all}"
    valid_service "$service"
    if [ "$service" = all ]; then docker compose restart; else docker compose restart "$service"; fi
    ;;
  logs)
    service="${1:-backend}"
    lines="${2:-100}"
    valid_service "$service"
    [[ "$lines" =~ ^[0-9]+$ ]] || { echo "ERROR: lines must be numeric" >&2; exit 3; }
    if [ "$service" = all ]; then docker compose logs --tail "$lines"; else docker compose logs --tail "$lines" "$service"; fi
    ;;
  rotate-db-certs)
    "$DEPLOY_DIR/server/rotate-db-certificates.sh" "$APP_DIR"
    ;;
  portainer-restart)
    docker compose restart portainer
    echo "Portainer restarted: https://$(env_value PORTAINER_DOMAIN)"
    ;;
  portainer-credentials)
    password_file="$(env_value PORTAINER_ADMIN_PASSWORD_FILE)"
    password_file="${password_file:-/opt/worldfert/secrets/portainer/admin-password}"
    [ -s "$password_file" ] || { echo "ERROR: Portainer credential file not found" >&2; exit 3; }
    echo "URL=https://$(env_value PORTAINER_DOMAIN)"
    echo "USERNAME=admin"
    echo "PASSWORD=$(cat "$password_file")"
    ;;
  backup-now)
    "$DEPLOY_DIR/server/backup-databases.sh" "$APP_DIR"
    ;;
  *)
    cat <<'EOF'
Usage: manage-stack.sh APP_DIR ACTION [ARGUMENTS]
  status | health | connections | env-show | env-get KEY
  env-set KEY VALUE | env-edit | env-backups | env-rollback latest --confirm
  domain-set BASE_DOMAIN | deploy | rebuild SERVICE | restart SERVICE
  logs SERVICE [LINES] | rotate-db-certs | portainer-restart
  portainer-credentials | backup-now
EOF
    exit 2
    ;;
esac
