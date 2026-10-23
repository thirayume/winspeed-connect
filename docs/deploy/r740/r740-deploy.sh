#!/usr/bin/env bash
# Guarded Sale-App deploy on R740-SRV, run as root in WSL Ubuntu by bootstrap.sh after
# it checked out the exact commit. Usage:
#   r740-deploy.sh <uat|prod> plan  <commit> <operator>
#   r740-deploy.sh <uat|prod> apply <commit> <operator> <approved-plan-id>
# plan : validate target and settings, build images, read-only migration plan.
# apply: same checks, refuse if the plan changed since approval, apply pending
#        migrations, verify the ledger, start backend -> healthy -> frontend + Caddy.
# Every run writes a receipt to D:\SaleApp\<env>\deploy-logs. Secrets are never printed.
set -Eeuo pipefail
exec </dev/null

fail() { printf 'ERROR: %s\n' "$1" >&2; RESULT="FAILED: $1"; exit 1; }

ENV_NAME="${1:-}"; PHASE="${2:-}"; COMMIT="${3:-}"; OPERATOR="${4:-}"; APPROVED_PLAN="${5:-}"
[[ "$ENV_NAME" == uat || "$ENV_NAME" == prod ]] || fail "environment must be uat or prod."
[[ "$PHASE" == plan || "$PHASE" == apply ]] || fail "phase must be plan or apply."

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
APP="$(cd -- "$SCRIPT_DIR/../../.." && pwd -P)"
readonly SCRIPT_DIR APP
readonly TARGET_FILE="$SCRIPT_DIR/targets/$ENV_NAME.env"
readonly ROOT="/mnt/d/SaleApp/$ENV_NAME"
readonly CONFIG="$ROOT/config"
readonly STARTED="$(date '+%Y-%m-%d %H:%M:%S %z')"
readonly RECEIPT="$ROOT/deploy-logs/$(date '+%Y%m%d-%H%M%S')-$ENV_NAME-$PHASE-${COMMIT:0:7}.txt"
RESULT='FAILED: stopped before completion'
PLAN_SUMMARY='(not reached)'; PLAN_LINES=''; APPLY_SUMMARY='(not run)'; VERIFY_SUMMARY='(not run)'; PS_TABLE=''

write_receipt() {
  {
    echo "Sale-App deploy receipt"
    echo "environment : $ENV_NAME"
    echo "phase       : $PHASE"
    echo "commit      : $COMMIT"
    echo "operator    : $OPERATOR"
    echo "started     : $STARTED"
    echo "finished    : $(date '+%Y-%m-%d %H:%M:%S %z')"
    echo "result      : $RESULT"
    echo "plan        : $PLAN_SUMMARY"
    [[ -n "$PLAN_LINES" ]] && printf '%s\n' "$PLAN_LINES" | sed 's/^/              /'
    echo "apply       : $APPLY_SUMMARY"
    echo "verify      : $VERIFY_SUMMARY"
    [[ -n "$PS_TABLE" ]] && { echo "containers  :"; printf '%s\n' "$PS_TABLE" | sed 's/^/              /'; }
  } > "$RECEIPT" 2>/dev/null || true
  echo "Receipt: D:\\SaleApp\\$ENV_NAME\\deploy-logs\\$(basename "$RECEIPT")"
}
trap write_receipt EXIT

[[ "$(git -c safe.directory="$APP" -C "$APP" rev-parse HEAD)" == "$COMMIT" ]] || fail "working tree is not at the requested commit."
[[ -f "$TARGET_FILE" ]] || fail "target file docs/deploy/r740/targets/$ENV_NAME.env is missing."
[[ -f "$CONFIG/.env" ]] || fail "D:\\SaleApp\\$ENV_NAME\\config\\.env is missing (copy docs/deploy/r740/$ENV_NAME.env.example)."
[[ -f "$CONFIG/.env.migrator.local" ]] || fail "D:\\SaleApp\\$ENV_NAME\\config\\.env.migrator.local is missing."
command -v docker >/dev/null 2>&1 || fail "Docker is not installed in this WSL distribution."
command -v python3 >/dev/null 2>&1 || fail "python3 is required for the Compose check."

# Pins come only from the reviewed target file: KEY=literal lines, a fixed key set.
unset COMPOSE_FILE COMPOSE_PATH_SEPARATOR COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES DOCKER_HOST DOCKER_CONTEXT
readonly PIN_KEYS=' SALEAPP_DEPLOY_ENABLED SALEAPP_STACK SALEAPP_COMPOSE_PROJECT SALEAPP_MIGRATOR_LOGIN ONPREM_DB_SERVER ONPREM_DB_PORT ONPREM_DB_INSTANCE ONPREM_DB_NAME ONPREM_EXPECTED_SERVERNAME ONPREM_PRODUCT_VERSION_PREFIX ONPREM_DB_USER ONPREM_DB_ENCRYPT ONPREM_DB_LEGACY_TLS APP_DOMAIN HTTP_PORT HTTPS_PORT CORS_ORIGIN VITE_API_BASE_URL TZ NATIVE_BOOKING_AI_ENABLED NATIVE_DELIVERY_104_ENABLED '
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || fail "invalid line in targets/$ENV_NAME.env."
  [[ "$PIN_KEYS" == *" ${BASH_REMATCH[1]} "* ]] || fail "unexpected key ${BASH_REMATCH[1]} in targets/$ENV_NAME.env."
  export "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"
done < "$TARGET_FILE"
[[ "${SALEAPP_DEPLOY_ENABLED:-}" == true ]] || fail "deploys to $ENV_NAME are not enabled (targets/$ENV_NAME.env)."
export SALEAPP_MIGRATOR_ENV_FILE="$CONFIG/.env.migrator.local"

[[ "$(docker --context default context inspect default --format '{{ .Endpoints.docker.Host }}' 2>/dev/null)" == unix://* ]] \
  || fail "the default Docker context is not the local Linux engine."
[[ "$(docker --context default info --format '{{.OSType}}' 2>/dev/null)" == linux ]] || fail "the Docker engine is not Linux."

compose() {
  docker --context default compose -p "$SALEAPP_COMPOSE_PROJECT" --project-directory "$APP" \
    -f "$APP/docker-compose.yml" --env-file "$CONFIG/.env" "$@"
}

compose --profile migrate config --quiet >/dev/null 2>&1 \
  || fail "Compose configuration is invalid or a setting is missing; values were not displayed."
MODELS="$(printf '{"resolved":%s,"env_sources":%s}' \
  "$(compose --profile migrate config --format json 2>/dev/null)" \
  "$(compose --profile migrate config --no-env-resolution --format json 2>/dev/null)")" \
  || fail "could not render the Compose model."
printf '%s' "$MODELS" | python3 "$SCRIPT_DIR/validate-compose.py" "$TARGET_FILE" "$SALEAPP_MIGRATOR_ENV_FILE" \
  || { unset MODELS; fail "Compose model does not match targets/$ENV_NAME.env."; }
unset MODELS

diagnose() {
  # Fixed labels only, plus the guard's own sentence (names and versions, never secrets).
  printf '%s' "$1" | python3 "$APP/docs/deploy/onprem/migration-failure-summary.py" || echo 'MIGRATION_DIAGNOSTIC=SUMMARY_UNAVAILABLE'
  printf '%s\n' "$1" | grep -Eo '(ONPREM SAFETY VIOLATION|SECURITY_ERROR): .*' | head -1 | cut -c1-220 || true
}

run_plan() {
  local out counts
  out="$(compose --profile migrate run --rm -T --no-deps migrate --plan --profile=onprem 2>&1)" \
    || { diagnose "$out"; fail "read-only migration plan failed."; }
  counts="$(printf '%s\n' "$out" | grep -Eo 'unchanged: [0-9]+; pending: [0-9]+; drift: [0-9]+')" \
    && [[ "$(printf '%s\n' "$counts" | wc -l)" == 1 ]] || fail "could not read the migration plan summary."
  read -r PLAN_UNCHANGED PLAN_PENDING PLAN_DRIFT < <(printf '%s\n' "$counts" | grep -Eo '[0-9]+' | tr '\n' ' ')
  PLAN_LINES="$(printf '%s\n' "$out" | grep -E '^  (PENDING|[A-Z_]+_DRIFT|EXCLUDED_APPLIED|LEDGER_ONLY) ' | sed 's/^  //' || true)"
  PLAN_ID="$(printf '%s\n%s\n' "$counts" "$PLAN_LINES" | sha256sum | cut -c1-64)"
  PLAN_SUMMARY="unchanged=$PLAN_UNCHANGED pending=$PLAN_PENDING drift=$PLAN_DRIFT id=$PLAN_ID"
}

echo "Target and settings match targets/$ENV_NAME.env ($ONPREM_DB_NAME on $ONPREM_EXPECTED_SERVERNAME)."
echo "Building images (no containers started, no database writes) ..."
compose build backend frontend caddy || fail "image build failed."

echo "Read-only migration plan for $ONPREM_DB_NAME ..."
run_plan
[[ -n "$PLAN_LINES" ]] && printf '%s\n' "$PLAN_LINES" | sed 's/^/  /'
echo "SALEAPP_PLAN $PLAN_SUMMARY"
[[ "$PLAN_DRIFT" == 0 ]] || fail "migration drift reported; nothing was applied."

if [[ "$PHASE" == plan ]]; then
  RESULT='PLAN_OK (no database writes, no containers changed)'
  exit 0
fi

[[ "$APPROVED_PLAN" == "$PLAN_ID" ]] || fail "the migration plan changed since it was approved; run the deploy again."

if (( PLAN_PENDING > 0 )); then
  echo "Applying $PLAN_PENDING approved migration(s) to $ONPREM_DB_NAME ..."
  APPLY_OUT="$(compose --profile migrate run --rm -T --no-deps migrate --profile=onprem 2>&1)" \
    || { APPLY_SUMMARY='FAILED'; diagnose "$APPLY_OUT"; unset APPLY_OUT; fail "migration apply failed; services were not restarted. Inspect the database before retrying."; }
  APPLY_SUMMARY="$(printf '%s\n' "$APPLY_OUT" | grep -Eo 'Migration complete: [^.]*' | tail -1)"
  unset APPLY_OUT
  echo "${APPLY_SUMMARY:-Migration apply finished.}"
  echo "Verifying the migration ledger with a second read-only plan ..."
  run_plan
  VERIFY_SUMMARY="$PLAN_SUMMARY"
  [[ "$PLAN_PENDING" == 0 && "$PLAN_DRIFT" == 0 ]] || fail "pending migrations or drift remain; services were not restarted."
else
  APPLY_SUMMARY='nothing pending'
  VERIFY_SUMMARY="$PLAN_SUMMARY"
fi

echo "Starting backend and waiting for an HTTP+SQL-ready health result ..."
compose up -d --no-build --no-deps backend || fail "backend could not be started."
BACKEND_ID="$(compose ps -q backend)"
[[ -n "$BACKEND_ID" ]] || fail "backend container was not found."
HEALTH='starting'
for _ in $(seq 1 36); do
  HEALTH="$(docker --context default inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$BACKEND_ID" 2>/dev/null || true)"
  [[ "$HEALTH" == healthy ]] && break
  [[ "$HEALTH" == unhealthy || "$HEALTH" == none ]] && fail "backend is not SQL-ready (health=$HEALTH); frontend and Caddy were not started."
  sleep 5
done
[[ "$HEALTH" == healthy ]] || fail "backend did not become SQL-ready within 180 seconds; frontend and Caddy were not started."

echo "Starting frontend and Caddy ..."
compose up -d --no-build || fail "frontend/Caddy start failed."
# Public root certificate of this stack's internal CA, to install on client devices.
for _ in $(seq 1 10); do
  if compose cp caddy:/data/caddy/pki/authorities/local/root.crt "$ROOT/caddy-root.crt" >/dev/null 2>&1; then
    echo "Caddy root certificate: D:\\SaleApp\\$ENV_NAME\\caddy-root.crt"
    break
  fi
  sleep 2
done
PS_TABLE="$(compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true)"
printf '%s\n' "$PS_TABLE"
RESULT="DEPLOYED ($PLAN_SUMMARY)"
echo "SALEAPP_DEPLOYED https://$APP_DOMAIN$([[ "$HTTPS_PORT" == 443 ]] || echo ":$HTTPS_PORT")/"
