#!/usr/bin/env bash
printf 'WSL_STAGE=DEPLOY_SCRIPT_STARTED\n'
set -Eeuo pipefail

readonly TARGET_DATABASE='dbwins_worldfert9_uat2'
readonly TARGET_SERVER='AMYOU-YOGA7\V2008R2'
readonly TARGET_PRODUCT_PREFIX='10.50.'
readonly TARGET_TCP_PORT='51433'
readonly APP_LOGIN='wf_local_uat_app'
readonly MIGRATOR_LOGIN='wf_local_uat_migrator'

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd -P)"
cd "$REPO_ROOT"

[[ -f docker-compose.yml ]] || fail "root docker-compose.yml is missing."
[[ -f docker.env.example ]] || fail "docker.env.example is missing."
[[ -f .env ]] || fail "local .env is missing. Copy docker.env.example and fill the approved UAT values."
[[ -f .env.migrator.local ]] || fail "local .env.migrator.local is missing. Copy docker.migrator.env.example and set the dedicated migrator password."
[[ -f "$SCRIPT_DIR/migration-failure-summary.py" ]] || fail "migration-failure-summary.py is missing next to this deploy script."
command -v docker >/dev/null 2>&1 || fail "Docker is unavailable in this WSL distribution."
command -v python3 >/dev/null 2>&1 || fail "python3 is required for the local Compose safety check."

# Pin the Compose file/project directory and use the local default context. Ignore
# inherited overrides so this click cannot redirect to another Compose file/daemon.
unset COMPOSE_FILE COMPOSE_PATH_SEPARATOR COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES DOCKER_HOST DOCKER_CONTEXT
unset HTTP_PORT HTTPS_PORT APP_DOMAIN TZ VITE_API_BASE_URL CORS_ORIGIN
unset ONPREM_DB_SERVER ONPREM_DB_PORT ONPREM_DB_INSTANCE ONPREM_DB_NAME ONPREM_EXPECTED_SERVERNAME
unset ONPREM_PRODUCT_VERSION_PREFIX ONPREM_DB_USER ONPREM_DB_PASSWORD ONPREM_DB_ENCRYPT ONPREM_DB_LEGACY_TLS ONPREM_DB_TDS_VERSION
unset ONPREM_MIGRATOR_USER ONPREM_MIGRATOR_PASSWORD JWT_SECRET JWT_EXPIRES_IN

DOCKER_ENDPOINT="$(docker --context default context inspect default --format '{{ .Endpoints.docker.Host }}' 2>/dev/null)" \
  || fail "Could not inspect the default Docker context."
[[ "$DOCKER_ENDPOINT" == unix://* ]] || fail "Default Docker context is not a local Unix socket. Select the Ubuntu WSL Docker Engine."
unset DOCKER_ENDPOINT

DOCKER_OS="$(docker --context default info --format '{{.OSType}}' 2>/dev/null)" \
  || fail "Could not query the Docker daemon type."
[[ "$DOCKER_OS" == 'linux' ]] || fail "Docker daemon is not Linux. Start/use the Ubuntu WSL Docker Engine."
unset DOCKER_OS

compose() {
  docker --context default compose --project-directory "$REPO_ROOT" \
    -f "$REPO_ROOT/docker-compose.yml" --env-file "$REPO_ROOT/.env" "$@"
}

compose --profile migrate config --quiet >/dev/null 2>&1 \
  || fail "Compose config is invalid or a required local setting/file is missing. Values were not displayed."

# Compose normally resolves env_file into environment and drops its declaration.
# Keep both views in memory: declarations prove the source; resolved values prove
# what the container receives. Neither model is printed or written to disk.
ENV_SOURCE_JSON="$(compose --profile migrate config --no-env-resolution --format json 2>/dev/null)" \
  || fail "Could not validate service env files. Docker Compose must support config --no-env-resolution. Values were not displayed."
CONFIG_JSON="$(compose --profile migrate config --format json 2>/dev/null)" \
  || fail "Could not validate resolved Compose configuration. Values were not displayed."
if ! printf "{\"resolved\":%s,\"env_sources\":%s}" "$CONFIG_JSON" "$ENV_SOURCE_JSON" | python3 -c '
import ipaddress
import json
import sys

def stop(message):
    print("ERROR: " + message)
    raise SystemExit(1)

try:
    models = json.load(sys.stdin)
    cfg = models["resolved"]
    env_sources = models["env_sources"].get("services", {})
    services = cfg.get("services", {})
    expected = {"backend", "frontend", "caddy", "migrate"}
    if set(services) != expected or set(env_sources) != expected:
        stop("Compose must contain only backend, frontend, Caddy, and the one-off migrate service.")

    backend = services["backend"]
    frontend = services["frontend"]
    caddy = services["caddy"]
    migrate = services["migrate"]
    app = backend.get("environment", {})
    migration = migrate.get("environment", {})
    if not isinstance(app, dict) or not isinstance(migration, dict):
        stop("Service environment is not in the expected Compose format.")

    required_app = ("ONPREM_DB_SERVER", "ONPREM_DB_PORT", "ONPREM_DB_NAME", "ONPREM_EXPECTED_SERVERNAME",
                    "ONPREM_PRODUCT_VERSION_PREFIX", "ONPREM_DB_USER", "ONPREM_DB_PASSWORD", "JWT_SECRET", "CORS_ORIGIN")
    missing = [k for k in required_app if not isinstance(app.get(k), str) or not app[k].strip()]
    if missing:
        stop("Required local settings are blank: " + ", ".join(missing))
    placeholders = {"CHANGE_ME", "CHANGEME", "TODO"}
    if app["ONPREM_DB_PASSWORD"].strip().upper() in placeholders or app["JWT_SECRET"].strip().upper() in placeholders:
        stop("Replace placeholder values in the local app environment file before deploying.")

    server_host = app["ONPREM_DB_SERVER"].strip().lower()
    if server_host != "host.docker.internal":
        try:
            server_ip = ipaddress.ip_address(server_host)
        except ValueError:
            stop("ONPREM_DB_SERVER must be host.docker.internal for Docker Desktop or a verified private IPv4 address.")
        if server_ip.version != 4 or not server_ip.is_private or server_ip.is_loopback or server_ip.is_unspecified:
            stop("ONPREM_DB_SERVER must be host.docker.internal or a reachable private IPv4 address outside the container.")
    if app.get("ONPREM_DB_PORT") != "51433" or str(app.get("ONPREM_DB_INSTANCE", "")).strip():
        stop("This UAT target requires fixed TCP port 51433 and a blank instance name.")
    if app.get("ONPREM_DB_NAME") != "dbwins_worldfert9_uat2":
        stop("Target is pinned to dbwins_worldfert9_uat2.")
    if app.get("ONPREM_EXPECTED_SERVERNAME", "").lower() != "amyou-yoga7\\v2008r2":
        stop("Expected SQL Server identity must be AMYOU-YOGA7\\V2008R2.")
    if app.get("ONPREM_PRODUCT_VERSION_PREFIX") != "10.50.":
        stop("This local UAT target requires SQL Server 2008 R2 product prefix 10.50.")
    if app.get("ONPREM_DB_USER", "").strip().lower() != "wf_local_uat_app":
        stop("The API must use its dedicated wf_local_uat_app login.")
    if app.get("DB_MODE") != "onprem":
        stop("DB_MODE must be onprem.")
    if str(app.get("ONPREM_DB_ENCRYPT", "")).lower() != "true":
        stop("ONPREM_DB_ENCRYPT must remain true.")

    if migration.get("DB_MODE") != "onprem" or migration.get("DB_OPERATION") != "migration" or migration.get("MIGRATION_PROFILE") != "onprem":
        stop("The migration service must use the guarded onprem migration profile.")
    for key in ("ONPREM_DB_SERVER", "ONPREM_DB_PORT", "ONPREM_DB_INSTANCE", "ONPREM_DB_NAME",
                "ONPREM_EXPECTED_SERVERNAME", "ONPREM_PRODUCT_VERSION_PREFIX", "ONPREM_DB_ENCRYPT", "ONPREM_DB_LEGACY_TLS"):
        if migration.get(key) != app.get(key):
            stop("Migration and API target settings must match exactly.")
    forbidden = {"ONPREM_DB_USER", "ONPREM_DB_PASSWORD", "JWT_SECRET", "MIGRATE_SECRET"}
    if forbidden.intersection(migration):
        stop("The migration container must not receive application credentials or application secrets.")
    profile = migrate.get("profiles", [])
    if profile != ["migrate"]:
        stop("The migration runner must remain opt-in behind the migrate profile.")
    source_migrate = env_sources["migrate"]
    raw_env_file = source_migrate.get("env_file", [])
    if isinstance(raw_env_file, (str, dict)):
        raw_env_file = [raw_env_file]
    def env_file_basename(item):
        raw_path = item if isinstance(item, str) else item.get("path", "") if isinstance(item, dict) else ""
        if not isinstance(raw_path, str):
            return ""
        # Compose JSON can expose normalized POSIX paths or Windows-style paths
        # depending on the Docker CLI/WSL integration version.
        return raw_path.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]

    paths = [env_file_basename(item) for item in raw_env_file]
    if paths != [".env.migrator.local"]:
        detected = ", ".join(repr(path or "<invalid>") for path in paths) or "<none>"
        stop("The migration service must receive only .env.migrator.local as a secret file. "
             "Detected env_file basenames: " + detected + ".")

    # Use Compose dotenv parsing rather than parsing passwords a second time.
    # Only these two additional keys may come from the dedicated env file.
    credential_keys = {"ONPREM_MIGRATOR_USER", "ONPREM_MIGRATOR_PASSWORD"}
    declared_environment = source_migrate.get("environment", {})
    if not isinstance(declared_environment, dict):
        stop("Migration service environment declarations are invalid.")
    if credential_keys.intersection(declared_environment):
        stop("Migrator credentials must come only from .env.migrator.local.")
    if set(migration) - set(declared_environment) != credential_keys:
        stop("The migrator env file must supply only ONPREM_MIGRATOR_USER and ONPREM_MIGRATOR_PASSWORD.")
    if migration.get("ONPREM_MIGRATOR_USER", "").lower() != "wf_local_uat_migrator":
        stop("The migration service must use the dedicated wf_local_uat_migrator login.")
    migrator_password = migration.get("ONPREM_MIGRATOR_PASSWORD", "").strip()
    if not migrator_password or migrator_password.upper() in placeholders:
        stop("Set a non-placeholder ONPREM_MIGRATOR_PASSWORD in .env.migrator.local.")
    if migration["ONPREM_MIGRATOR_PASSWORD"] == app["ONPREM_DB_PASSWORD"]:
        stop("Application and migrator passwords must be different.")
    if migration["ONPREM_MIGRATOR_USER"].lower() == app["ONPREM_DB_USER"].strip().lower():
        stop("Application and migration logins must be different principals.")

    caddy_env = caddy.get("environment", {})
    if not isinstance(caddy_env, dict):
        stop("Caddy environment is not in the expected Compose format.")
    app_domain = str(caddy_env.get("APP_DOMAIN", "")).strip()
    try:
        http_port = int(str(caddy_env.get("HTTP_PORT", "")))
        https_port = int(str(caddy_env.get("HTTPS_PORT", "")))
    except (TypeError, ValueError):
        stop("HTTP_PORT and HTTPS_PORT must be valid integers.")
    if not (1 <= http_port <= 65535 and 1 <= https_port <= 65535) or http_port == https_port:
        stop("HTTP_PORT and HTTPS_PORT must be distinct valid TCP ports.")
    expected_origin = "https://" + app_domain + ("" if https_port == 443 else ":" + str(https_port))
    if app.get("CORS_ORIGIN") != expected_origin:
        stop("CORS_ORIGIN must match APP_DOMAIN and the HTTPS port.")
    vite_api = frontend.get("build", {}).get("args", {}).get("VITE_API_BASE_URL")
    if vite_api != "/api":
        stop("VITE_API_BASE_URL must be same-origin /api behind Caddy.")
    if frontend.get("ports") or backend.get("ports") or migrate.get("ports"):
        stop("Only Caddy may publish host ports.")
    published = {(str(p.get("published")), str(p.get("target"))) for p in caddy.get("ports", [])}
    expected_ports = {(str(http_port), str(http_port)), (str(https_port), str(https_port))}
    if not expected_ports.issubset(published):
        stop("Caddy host/container ports must match the validated HTTP_PORT and HTTPS_PORT.")
    for key, expected_value in {"COUPON_NATIVE_POSTING_ENABLED": "false", "DISABLE_BACKGROUND_WORKERS": "true",
                                "ENFORCE_PASSWORD_CHANGE": "true"}.items():
        if str(app.get(key, "")).lower() != expected_value:
            stop("Required UAT safety setting is not enforced: " + key)
except (json.JSONDecodeError, KeyError, AttributeError, TypeError, ValueError):
    print("ERROR: Could not validate the local deploy configuration.")
    raise SystemExit(1)
'; then
  unset CONFIG_JSON ENV_SOURCE_JSON
  exit 1
fi
unset CONFIG_JSON ENV_SOURCE_JSON

report_migration_failure() {
  printf '%s' "$1" | python3 "$SCRIPT_DIR/migration-failure-summary.py" \
    || printf 'MIGRATION_DIAGNOSTIC=SUMMARY_UNAVAILABLE\n'
}

echo "UAT target and credential separation checks passed; resolved settings were not displayed."
echo "Caddy HTTP/HTTPS port and CORS checks passed."
echo "Building backend/frontend images only; no containers or database writes yet..."
compose build backend frontend || fail "Image build failed; migration and service startup were not attempted."

echo "Running read-only migration plan for $TARGET_DATABASE..."
if ! PLAN_OUTPUT="$(compose --profile migrate run --rm --no-deps migrate --plan --profile=onprem 2>&1)"; then
  report_migration_failure "$PLAN_OUTPUT"
  unset PLAN_OUTPUT
  fail "Read-only migration plan failed. No migration apply or application startup was attempted."
fi
printf '%s\n' "$PLAN_OUTPUT"
PLAN_COUNTS="$(printf '%s\n' "$PLAN_OUTPUT" | python3 -c '
import re, sys
text = sys.stdin.read()
matches = re.findall(r"unchanged:\s*(\d+);\s*pending:\s*(\d+);\s*drift:\s*(\d+)", text, re.I)
if len(matches) != 1:
    raise SystemExit(1)
print(" ".join(matches[0]))
' 2>/dev/null)" || fail "Could not parse the migration plan summary; no migration apply was attempted."
read -r UNCHANGED_COUNT PENDING_COUNT DRIFT_COUNT <<<"$PLAN_COUNTS"
unset PLAN_COUNTS PLAN_OUTPUT
[[ "$DRIFT_COUNT" == '0' ]] || fail "Migration drift was reported; no migration apply or application startup was attempted."

if (( PENDING_COUNT > 0 )); then
  printf '\nThe plan lists %s pending migration(s). Applying them to the pinned UAT target...\n' "$PENDING_COUNT"
  if ! APPLY_OUTPUT="$(compose --profile migrate run --rm --no-deps migrate --profile=onprem 2>&1)"; then
    report_migration_failure "$APPLY_OUTPUT"
    unset APPLY_OUTPUT
    fail "Migration apply failed. Application services were not started; inspect the database state before running deploy again."
  fi
  printf '%s\n' "$APPLY_OUTPUT"
  unset APPLY_OUTPUT

  echo "Verifying migration ledger with a second read-only plan..."
  if ! VERIFY_OUTPUT="$(compose --profile migrate run --rm --no-deps migrate --plan --profile=onprem 2>&1)"; then
    report_migration_failure "$VERIFY_OUTPUT"
    unset VERIFY_OUTPUT
    fail "Post-apply migration verification failed. Application services were not started."
  fi
  printf '%s\n' "$VERIFY_OUTPUT"
  VERIFY_COUNTS="$(printf '%s\n' "$VERIFY_OUTPUT" | python3 -c '
import re, sys
matches = re.findall(r"unchanged:\s*(\d+);\s*pending:\s*(\d+);\s*drift:\s*(\d+)", sys.stdin.read(), re.I)
if len(matches) != 1:
    raise SystemExit(1)
print(" ".join(matches[0]))
' 2>/dev/null)" || fail "Could not parse the post-apply migration summary. Application services were not started."
  read -r _ VERIFY_PENDING VERIFY_DRIFT <<<"$VERIFY_COUNTS"
  unset VERIFY_COUNTS VERIFY_OUTPUT
  [[ "$VERIFY_PENDING" == '0' && "$VERIFY_DRIFT" == '0' ]] \
    || fail "Pending migrations or drift remain. Application services were not started."
else
  echo "No pending migrations; skipping apply."
fi

echo "Starting backend only and waiting for an HTTP+SQL-ready health result..."
compose up -d --no-build --no-deps backend || fail "Backend could not be started."
BACKEND_ID="$(compose ps -q backend)"
[[ -n "$BACKEND_ID" ]] || fail "Backend container ID could not be resolved."
BACKEND_HEALTH='starting'
for _ in $(seq 1 36); do
  BACKEND_HEALTH="$(docker --context default inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$BACKEND_ID" 2>/dev/null || true)"
  [[ "$BACKEND_HEALTH" == 'healthy' ]] && break
  [[ "$BACKEND_HEALTH" == 'unhealthy' || "$BACKEND_HEALTH" == 'none' ]] \
    && fail "Backend is not SQL-ready (health=$BACKEND_HEALTH); frontend and Caddy were not started."
  sleep 5
done
unset BACKEND_ID
[[ "$BACKEND_HEALTH" == 'healthy' ]] || fail "Backend did not become SQL-ready within 180 seconds; frontend and Caddy were not started."

echo "Starting frontend and Caddy..."
compose up -d --no-build || fail "Frontend/Caddy startup failed."
compose ps
printf '\nUAT deploy completed for %s. Keep the narrow SQL firewall rule while this stack is in use.\n' "$TARGET_DATABASE"
