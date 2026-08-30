#!/usr/bin/env bash
# Build and operate the isolated WorldFert test frontend/backend. Production
# application containers and production database names are never restarted or
# changed by this helper.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/worldfert/app}"
DEPLOY_DIR="$APP_DIR/deploy/cloud-vps"
ENV_FILE="$DEPLOY_DIR/.env"
TEST_COMPOSE="$DEPLOY_DIR/docker-compose.test.yml"
TEST_SECRET_DIR="${TEST_SECRET_DIR:-/opt/worldfert/secrets/test-stack}"
TEST_ENV_FILE="$TEST_SECRET_DIR/test-stack.env"
ACTION="${1:-deploy}"
MSSQL_TARGET_ARG="${2:-}"
MYSQL_TARGET_ARG="${3:-}"
OPTION="${4:-}"

[ "$(id -u)" -eq 0 ] || { echo "ERROR: run with sudo/root" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "ERROR: missing $ENV_FILE" >&2; exit 2; }
[ -f "$TEST_COMPOSE" ] || { echo "ERROR: missing $TEST_COMPOSE" >&2; exit 2; }

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

ROOT_DOMAIN="${ROOT_DOMAIN:-}"
MSSQL_SOURCE="${DB_NAME:-dbwins_worldfert9}"
MYSQL_SOURCE="${MYSQL_DATABASE:-db_truckscale}"
MSSQL_TARGET="${MSSQL_TARGET_ARG:-${MSSQL_TEST_DATABASE:-${MSSQL_SOURCE}_test}}"
MYSQL_TARGET="${MYSQL_TARGET_ARG:-${MYSQL_TEST_DATABASE:-${MYSQL_SOURCE}_test}}"
TEST_APP_DOMAIN="test.$ROOT_DOMAIN"
TEST_API_DOMAIN="api-test.$ROOT_DOMAIN"
PRODUCTION_NETWORK_NAME="${PRODUCTION_NETWORK_NAME:-worldfert_wf-net}"
DRY_RUN=0
[ "$OPTION" = "--dry-run" ] && DRY_RUN=1

log() { printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

valid_db_name() { [[ "${1:-}" =~ ^[A-Za-z][A-Za-z0-9_]{0,127}$ ]]; }
is_test_name() {
  local lower="${1,,}"
  [[ "$lower" =~ (^test_|_(test|qa|uat|sandbox)(_|$)) ]]
}

validate_test_target() {
  local engine="$1" source="$2" target="$3"
  valid_db_name "$target" || fail "$engine test database name must use letters, digits and underscore only"
  [ "${source,,}" != "${target,,}" ] || fail "$engine test database must not equal production"
  is_test_name "$target" || fail "$engine target must contain test, qa, uat or sandbox"
}

test_env_value() {
  [ -f "$TEST_ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$TEST_ENV_FILE" | tail -1
}

new_secret() {
  openssl rand -hex 48
}

render_test_env() {
  local jwt migrate ingest temp
  jwt="$(test_env_value TEST_JWT_SECRET)"
  migrate="$(test_env_value TEST_MIGRATE_SECRET)"
  ingest="$(test_env_value TEST_TS_INGEST_SECRET)"
  jwt="${jwt:-$(new_secret)}"
  migrate="${migrate:-$(new_secret)}"
  ingest="${ingest:-$(new_secret)}"

  install -d -m 700 "$TEST_SECRET_DIR"
  temp="$(mktemp)"
  {
    printf 'TEST_APP_DOMAIN=%s\n' "$TEST_APP_DOMAIN"
    printf 'TEST_API_DOMAIN=%s\n' "$TEST_API_DOMAIN"
    printf 'TEST_VITE_API_BASE_URL=https://%s/api\n' "$TEST_API_DOMAIN"
    printf 'TEST_CORS_ORIGIN=https://%s\n' "$TEST_APP_DOMAIN"
    printf 'MSSQL_TEST_DATABASE=%s\n' "$MSSQL_TARGET"
    printf 'MYSQL_TEST_DATABASE=%s\n' "$MYSQL_TARGET"
    printf 'TEST_JWT_SECRET=%s\n' "$jwt"
    printf 'TEST_MIGRATE_SECRET=%s\n' "$migrate"
    printf 'TEST_TS_INGEST_SECRET=%s\n' "$ingest"
    printf 'PRODUCTION_NETWORK_NAME=%s\n' "$PRODUCTION_NETWORK_NAME"
    printf 'TEST_BACKEND_MEM_LIMIT=%s\n' "${TEST_BACKEND_MEM_LIMIT:-1G}"
    printf 'TEST_FRONTEND_MEM_LIMIT=%s\n' "${TEST_FRONTEND_MEM_LIMIT:-256M}"
  } > "$temp"
  install -m 600 "$temp" "$TEST_ENV_FILE"
  rm -f "$temp"

  # Shell variables have higher Compose precedence than --env-file values.
  # Export the selected targets explicitly so custom bug-specific names cannot
  # be shadowed by default MSSQL_TEST_DATABASE/MYSQL_TEST_DATABASE entries in
  # the production .env.
  export TEST_APP_DOMAIN TEST_API_DOMAIN PRODUCTION_NETWORK_NAME
  export TEST_VITE_API_BASE_URL="https://$TEST_API_DOMAIN/api"
  export TEST_CORS_ORIGIN="https://$TEST_APP_DOMAIN"
  export MSSQL_TEST_DATABASE="$MSSQL_TARGET"
  export MYSQL_TEST_DATABASE="$MYSQL_TARGET"
  export TEST_JWT_SECRET="$jwt"
  export TEST_MIGRATE_SECRET="$migrate"
  export TEST_TS_INGEST_SECRET="$ingest"
}

prepare_dry_run_env() {
  export TEST_APP_DOMAIN TEST_API_DOMAIN MSSQL_TARGET MYSQL_TARGET PRODUCTION_NETWORK_NAME
  export TEST_VITE_API_BASE_URL="https://$TEST_API_DOMAIN/api"
  export TEST_CORS_ORIGIN="https://$TEST_APP_DOMAIN"
  export MSSQL_TEST_DATABASE="$MSSQL_TARGET"
  export MYSQL_TEST_DATABASE="$MYSQL_TARGET"
  export TEST_JWT_SECRET="DRY_RUN_TEST_JWT_SECRET_000000000000000000000000"
  export TEST_MIGRATE_SECRET="DRY_RUN_TEST_MIGRATE_SECRET_0000000000000000000"
  export TEST_TS_INGEST_SECRET="DRY_RUN_TEST_INGEST_SECRET_00000000000000000000"
}

compose_test() {
  local args=(docker compose --env-file "$ENV_FILE")
  if [ -f "$TEST_ENV_FILE" ]; then args+=(--env-file "$TEST_ENV_FILE"); fi
  args+=(-f "$TEST_COMPOSE")
  "${args[@]}" "$@"
}

mssql_scalar() {
  local sqlcmd
  sqlcmd="$(docker exec wf-mssql bash -lc 'command -v /opt/mssql-tools18/bin/sqlcmd || command -v /opt/mssql-tools/bin/sqlcmd' | tr -d '\r')"
  [ -n "$sqlcmd" ] || fail "sqlcmd not found in wf-mssql"
  docker exec wf-mssql "$sqlcmd" -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b -h -1 -W \
    -Q "SET NOCOUNT ON; $1" | tr -d '\r' | sed '/^[[:space:]]*$/d' | tail -1
}

mysql_scalar() {
  docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" wf-mysql mysql -u root --ssl-mode=REQUIRED -N \
    -e "$1" | tr -d '\r' | sed '/^[[:space:]]*$/d' | tail -1
}

config_check() {
  validate_test_target MSSQL "$MSSQL_SOURCE" "$MSSQL_TARGET"
  validate_test_target MySQL "$MYSQL_SOURCE" "$MYSQL_TARGET"
  [ -n "$ROOT_DOMAIN" ] || fail "ROOT_DOMAIN is missing"
  docker network inspect "$PRODUCTION_NETWORK_NAME" >/dev/null 2>&1 || \
    fail "Docker network not found: $PRODUCTION_NETWORK_NAME; deploy production infrastructure first"
  available_mb="$(awk '/MemAvailable:/ {printf "%d", $2/1024}' /proc/meminfo)"
  [ "${available_mb:-0}" -ge 1024 ] || \
    fail "available RAM is below 1 GB; stop and review VPS capacity before starting the test app"
  echo "Available RAM before test deploy: ${available_mb} MB"
  if [ "$DRY_RUN" -eq 1 ]; then prepare_dry_run_env; else render_test_env; fi
  compose_test config --quiet
}

preflight() {
  config_check
  [ "$(docker inspect -f '{{.State.Health.Status}}' wf-mssql 2>/dev/null || true)" = healthy ] || \
    fail "wf-mssql is not healthy"
  [ "$(docker inspect -f '{{.State.Health.Status}}' wf-mysql 2>/dev/null || true)" = healthy ] || \
    fail "wf-mysql is not healthy"
  [ "$(mssql_scalar "SELECT COUNT(*) FROM sys.databases WHERE name=N'$MSSQL_TARGET';")" = 1 ] || \
    fail "MSSQL test database does not exist: $MSSQL_TARGET; run the full test-stack script first"
  [ "$(mysql_scalar "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$MYSQL_TARGET';")" = 1 ] || \
    fail "MySQL test database does not exist: $MYSQL_TARGET; run the full test-stack script first"

  echo "TEST APP PREFLIGHT OK"
  echo "  Frontend: https://$TEST_APP_DOMAIN"
  echo "  API:      https://$TEST_API_DOMAIN/api"
  echo "  MSSQL:    $MSSQL_TARGET"
  echo "  MySQL:    $MYSQL_TARGET"
}

show_status() {
  docker ps -a --filter name=wf-backend-test --filter name=wf-frontend-test \
    --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
  if docker ps --format '{{.Names}}' | grep -qx wf-backend-test; then
    docker exec wf-backend-test node -e \
      'fetch("http://127.0.0.1:3000/api/health").then(r=>r.json()).then(j=>console.log(JSON.stringify(j))).catch(e=>{console.error(e.message);process.exit(1)})'
  fi
}

case "$ACTION" in
  deploy)
    preflight
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "TEST APP DRY RUN OK; no container was built, restarted or removed."
      exit 0
    fi
    log "Build and start isolated test backend/frontend"
    compose_test up -d --build

    log "Wait for test containers and both test database connections"
    for container in wf-backend-test wf-frontend-test; do
      ready=0
      for _ in $(seq 1 72); do
        status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
        if [ "$status" = healthy ] || { [ "$container" = wf-frontend-test ] && [ "$status" = running ]; }; then
          ready=1
          break
        fi
        sleep 5
      done
      if [ "$ready" -ne 1 ]; then
        docker logs --tail 100 "$container" || true
        fail "$container is not healthy"
      fi
      echo "  ok: $container"
    done

    log "Validate and reload Caddy test routes without restarting production apps"
    docker exec wf-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    docker exec wf-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
    show_status
    cat <<EOF

TEST APPLICATION DEPLOY OK
Frontend=https://$TEST_APP_DOMAIN
API=https://$TEST_API_DOMAIN/api
MSSQL_DATABASE=$MSSQL_TARGET
MYSQL_DATABASE=$MYSQL_TARGET
External integrations and background workers are disabled.
Production frontend/backend and production databases were not restarted or changed.

    Required DNS A records (one-time):
  test     -> VPS public IPv4
  api-test -> VPS public IPv4
EOF
    ;;
  config-check)
    config_check
    echo "TEST COMPOSE CONFIG OK; no database or container was changed."
    ;;
  status)
    show_status
    ;;
  logs)
    service="${2:-backend-test}"
    lines="${3:-150}"
    case "$service" in backend-test|frontend-test) ;; *) fail "service must be backend-test or frontend-test" ;; esac
    [[ "$lines" =~ ^[0-9]+$ ]] || fail "lines must be numeric"
    if [ -f "$TEST_ENV_FILE" ]; then compose_test logs --tail "$lines" "$service"; else docker logs --tail "$lines" "wf-${service}"; fi
    ;;
  stop)
    if [ -f "$TEST_ENV_FILE" ]; then
      compose_test down
    else
      docker stop wf-frontend-test wf-backend-test >/dev/null 2>&1 || true
      docker rm wf-frontend-test wf-backend-test >/dev/null 2>&1 || true
    fi
    echo "TEST APPLICATION STOPPED; test database contents and test volumes were kept."
    ;;
  *)
    echo "Usage: deploy-test-app.sh deploy|config-check [MSSQL_TEST_DB] [MYSQL_TEST_DB] [--dry-run]" >&2
    echo "       deploy-test-app.sh status | logs [backend-test|frontend-test] [LINES] | stop" >&2
    exit 2
    ;;
esac
