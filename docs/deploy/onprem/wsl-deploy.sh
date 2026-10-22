#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd -P)"
cd "$REPO_ROOT"

[[ -f docker-compose.yml ]] || fail "root docker-compose.yml is missing."
[[ -f docker.env.example ]] || fail "docker.env.example is missing."
[[ -f docs/deploy/onprem/Caddyfile.uat ]] || fail "UAT Caddyfile is missing."
[[ -f .env ]] || fail "local .env is missing. Copy docker.env.example to .env and fill approved UAT clone values."
command -v docker >/dev/null 2>&1 || fail "Docker is unavailable in this WSL distribution."
command -v python3 >/dev/null 2>&1 || fail "python3 is required for the local Compose safety check."

# Pin the Compose file/project directory and use the local default context. Ignore
# inherited overrides so they cannot redirect this click to another Compose file
# or daemon; the .env file at the repository root supplies deployment settings.
unset COMPOSE_FILE COMPOSE_PATH_SEPARATOR COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES DOCKER_HOST DOCKER_CONTEXT
DOCKER_ENDPOINT="$(docker --context default context inspect default --format '{{ .Endpoints.docker.Host }}' 2>/dev/null)" || fail "Could not inspect the default Docker context."
[[ "$DOCKER_ENDPOINT" == unix://* ]] || fail "Default Docker context is not a local Unix socket. Select the Ubuntu WSL Docker Engine."
unset DOCKER_ENDPOINT

DOCKER_OS="$(docker --context default info --format '{{.OSType}}' 2>/dev/null)" || fail "Could not query the Docker daemon type."
[[ "$DOCKER_OS" == "linux" ]] || fail "Docker daemon is not Linux. Start/use the Ubuntu WSL Docker Engine, then retry."
unset DOCKER_OS

compose() {
  docker --context default compose --project-directory "$REPO_ROOT" -f "$REPO_ROOT/docker-compose.yml" \
    --env-file "$REPO_ROOT/.env" "$@"
}

# Do not let the interactive shell override values in the ignored local .env.
unset HTTP_PORT HTTPS_PORT APP_DOMAIN TZ VITE_API_BASE_URL CORS_ORIGIN ONPREM_DB_SERVER ONPREM_DB_PORT \
  ONPREM_DB_INSTANCE ONPREM_DB_NAME ONPREM_EXPECTED_SERVERNAME \
  ONPREM_PRODUCT_VERSION_PREFIX ONPREM_DB_USER ONPREM_DB_PASSWORD \
  ONPREM_DB_ENCRYPT ONPREM_DB_LEGACY_TLS JWT_SECRET JWT_EXPIRES_IN

compose config --quiet >/dev/null 2>&1 || fail "Compose configuration is invalid or required local settings are missing. Values were not displayed."

# Render into memory only. Never print the rendered config because it contains credentials.
CONFIG_JSON="$(compose config --format json 2>/dev/null)" || fail "Could not validate the resolved Compose configuration. Values were not displayed."
if ! printf '%s' "$CONFIG_JSON" | python3 -c '
import json
import sys

try:
    config = json.load(sys.stdin)
    services = config.get("services", {})
    expected_services = {"backend", "frontend", "caddy"}
    if set(services) != expected_services:
        print("ERROR: Compose must contain only backend, frontend, and Caddy; migration or extra services are blocked.")
        raise SystemExit(1)

    env = services["backend"].get("environment", {})
    if not isinstance(env, dict):
        print("ERROR: Backend environment is not in the expected Compose format.")
        raise SystemExit(1)

    required = ("ONPREM_DB_SERVER", "ONPREM_EXPECTED_SERVERNAME", "ONPREM_DB_USER",
                "ONPREM_DB_PASSWORD", "JWT_SECRET", "CORS_ORIGIN")
    missing = [key for key in required if not isinstance(env.get(key), str) or not env[key].strip()]
    if missing:
        print("ERROR: Required local settings are blank: " + ", ".join(missing))
        raise SystemExit(1)

    if env.get("DB_MODE") != "onprem":
        print("ERROR: DB_MODE must be onprem.")
        raise SystemExit(1)
    if env.get("ONPREM_DB_NAME") != "dbwins_worldfert9_local_uat":
        print("ERROR: Target must be the approved dbwins_worldfert9_local_uat clone.")
        raise SystemExit(1)
    if env["ONPREM_DB_USER"].strip().lower() == "sa":
        print("ERROR: The UAT application must use its dedicated non-sa login.")
        raise SystemExit(1)
    app_domain = services["caddy"].get("environment", {}).get("APP_DOMAIN")
    if not isinstance(app_domain, str) or not app_domain.strip():
        print("ERROR: APP_DOMAIN must be configured for HTTPS.")
        raise SystemExit(1)
    if env.get("CORS_ORIGIN") != "https://" + app_domain:
        print("ERROR: CORS_ORIGIN must match the HTTPS APP_DOMAIN.")
        raise SystemExit(1)
    vite_api = services["frontend"].get("build", {}).get("args", {}).get("VITE_API_BASE_URL")
    if vite_api != "/api":
        print("ERROR: VITE_API_BASE_URL must be same-origin /api behind Caddy.")
        raise SystemExit(1)
    if services["frontend"].get("ports") or services["backend"].get("ports"):
        print("ERROR: Only Caddy may publish host ports.")
        raise SystemExit(1)
    caddy_ports = services["caddy"].get("ports", [])
    published_ports = {(str(port.get("published")), str(port.get("target"))) for port in caddy_ports}
    if not {("80", "80"), ("443", "443")}.issubset(published_ports):
        print("ERROR: Caddy must publish host ports 80 and 443 to container ports 80 and 443.")
        raise SystemExit(1)
    required_controls = {
        "COUPON_NATIVE_POSTING_ENABLED": "false",
        "DISABLE_BACKGROUND_WORKERS": "true",
        "ENFORCE_PASSWORD_CHANGE": "true",
    }
    for key, expected in required_controls.items():
        if str(env.get(key, "")).lower() != expected:
            print("ERROR: Required UAT safety setting is not enforced: " + key)
            raise SystemExit(1)
except (json.JSONDecodeError, AttributeError, TypeError):
    print("ERROR: Could not parse resolved Compose configuration.")
    raise SystemExit(1)
'; then
  unset CONFIG_JSON
  exit 1
fi
unset CONFIG_JSON

echo "Compose checks passed: local Linux daemon, UAT clone target, Caddy on ports 80/443, and required safety settings."
echo "Building and starting the UAT clone stack. No migrations are run by this script."
compose up -d --build || fail "Compose build/start failed."
compose ps
printf '\nUAT stack deployment command completed. Open the HTTPS host configured as APP_DOMAIN.\n'
