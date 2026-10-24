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
BACKUP_SUMMARY='(not required)'; CA_SUMMARY='(own root)'

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
    echo "backup      : $BACKUP_SUMMARY"
    echo "apply       : $APPLY_SUMMARY"
    echo "verify      : $VERIFY_SUMMARY"
    echo "caddy root  : $CA_SUMMARY"
    [[ -n "$PS_TABLE" ]] && { echo "containers  :"; printf '%s\n' "$PS_TABLE" | sed 's/^/              /'; }
  } > "$RECEIPT" 2>/dev/null || true
  echo "Receipt: D:\\SaleApp\\$ENV_NAME\\deploy-logs\\$(basename "$RECEIPT")"
}
trap write_receipt EXIT
# set -e stops on any unhandled failure; say where instead of exiting silently.
trap 'RESULT="FAILED: unexpected error at r740-deploy.sh line $LINENO"; printf "ERROR: unexpected error at r740-deploy.sh line %s\n" "$LINENO" >&2' ERR

[[ "$(git -c safe.directory="$APP" -C "$APP" rev-parse HEAD)" == "$COMMIT" ]] || fail "working tree is not at the requested commit."
[[ -f "$TARGET_FILE" ]] || fail "target file docs/deploy/r740/targets/$ENV_NAME.env is missing."
[[ -f "$CONFIG/.env" ]] || fail "D:\\SaleApp\\$ENV_NAME\\config\\.env is missing (copy docs/deploy/r740/$ENV_NAME.env.example)."
[[ -f "$CONFIG/.env.migrator.local" ]] || fail "D:\\SaleApp\\$ENV_NAME\\config\\.env.migrator.local is missing."
command -v docker >/dev/null 2>&1 || fail "Docker is not installed in this WSL distribution."
command -v python3 >/dev/null 2>&1 || fail "python3 is required for the Compose check."

# Pins come only from the reviewed target file: KEY=literal lines, a fixed key set.
unset COMPOSE_FILE COMPOSE_PATH_SEPARATOR COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES DOCKER_HOST DOCKER_CONTEXT
readonly PIN_KEYS=' SALEAPP_DEPLOY_ENABLED SALEAPP_STACK SALEAPP_COMPOSE_PROJECT SALEAPP_MIGRATOR_LOGIN SALEAPP_BACKUP_DIR SALEAPP_BACKUP_MAX_AGE_MINUTES SALEAPP_SHARE_CA_FROM ONPREM_TARGET_KIND ONPREM_DB_SERVER ONPREM_DB_PORT ONPREM_DB_INSTANCE ONPREM_DB_NAME ONPREM_EXPECTED_SERVERNAME ONPREM_PRODUCT_VERSION_PREFIX ONPREM_DB_USER ONPREM_DB_ENCRYPT ONPREM_DB_LEGACY_TLS APP_DOMAIN HTTP_PORT HTTPS_PORT CORS_ORIGIN VITE_API_BASE_URL TZ NATIVE_BOOKING_AI_ENABLED NATIVE_DELIVERY_104_ENABLED '
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

require_fresh_backup() {
  # Migrations on a target with a backup folder need a pre-deploy backup that is fresh
  # and finished (not modified in the last minute); see sql/r740-prod-backup.sql.
  local dir="${SALEAPP_BACKUP_DIR:-}" max="${SALEAPP_BACKUP_MAX_AGE_MINUTES:-120}" newest age size
  [[ -n "$dir" ]] || return 0
  [[ "$max" =~ ^[0-9]+$ ]] || fail "SALEAPP_BACKUP_MAX_AGE_MINUTES is not a number."
  newest="$(find "$dir" -maxdepth 1 -type f -name "${ONPREM_DB_NAME}_predeploy_*.bak" -printf '%T@ %s %f\n' 2>/dev/null | sort -n | tail -1)"
  [[ -n "$newest" ]] || fail "no ${ONPREM_DB_NAME}_predeploy_*.bak in $dir; run sql/r740-prod-backup.sql first. Nothing was applied."
  read -r age size BACKUP_FILE <<<"$newest"
  age=$(( $(date +%s) - ${age%.*} ))
  (( age <= max * 60 )) || fail "the newest pre-deploy backup $BACKUP_FILE is $(( age / 60 )) minutes old (limit $max); take a new one. Nothing was applied."
  (( age >= 60 )) || fail "the pre-deploy backup $BACKUP_FILE changed in the last minute; wait until SSMS reports it verified, then retry."
  (( size > 0 )) || fail "the pre-deploy backup $BACKUP_FILE is empty. Nothing was applied."
  BACKUP_SUMMARY="$BACKUP_FILE ($(( size / 1048576 )) MB, $(( age / 60 )) min old)"
  echo "Pre-deploy backup found: $BACKUP_SUMMARY"
}

share_caddy_root() {
  # Start this stack's Caddy with another stack's local CA root, so client devices trust one
  # certificate. Only root.crt and root.key move, volume to volume on this server; the key is
  # never printed or written elsewhere. A stack that already has a root keeps it.
  local from="${SALEAPP_SHARE_CA_FROM:-}" out
  [[ -n "$from" ]] || return 0
  docker --context default volume inspect "${from}_caddy-data" >/dev/null 2>&1 \
    || fail "${from}_caddy-data is missing; deploy $from first so its Caddy root exists."
  compose up --no-start --no-deps caddy >/dev/null 2>&1 || fail "could not create the Caddy container and volumes."
  out="$(docker --context default run --rm --entrypoint sh \
    -v "${from}_caddy-data:/src:ro" -v "${SALEAPP_COMPOSE_PROJECT}_caddy-data:/dst" \
    "worldfert-saleapp-${SALEAPP_STACK}-caddy:local" -c '
      set -e; pki=caddy/pki/authorities/local
      if [ -f "/dst/$pki/root.crt" ]; then echo kept; exit 0; fi
      [ -f "/src/$pki/root.crt" ] && [ -f "/src/$pki/root.key" ] || { echo missing; exit 3; }
      mkdir -p "/dst/$pki"; cp -p "/src/$pki/root.crt" "/src/$pki/root.key" "/dst/$pki/"; echo copied' 2>&1)" \
    || fail "could not reuse the $from Caddy root ($out)."
  CA_SUMMARY="root of $from ($out)"
  echo "Caddy root: $CA_SUMMARY"
}

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
  [[ "$counts" =~ ^unchanged:\ ([0-9]+)\;\ pending:\ ([0-9]+)\;\ drift:\ ([0-9]+)$ ]] \
    || fail "could not read the migration plan summary."
  PLAN_UNCHANGED="${BASH_REMATCH[1]}"; PLAN_PENDING="${BASH_REMATCH[2]}"; PLAN_DRIFT="${BASH_REMATCH[3]}"
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
  require_fresh_backup
  echo "Applying $PLAN_PENDING approved migration(s) to $ONPREM_DB_NAME ..."
  APPLY_OUT="$(compose --profile migrate run --rm -T --no-deps migrate --profile=onprem 2>&1)" \
    || { APPLY_SUMMARY='FAILED'; diagnose "$APPLY_OUT"; unset APPLY_OUT; fail "migration apply failed; services were not restarted. Inspect the database before retrying."; }
  APPLY_SUMMARY="$(printf '%s\n' "$APPLY_OUT" | grep -Eo 'Migration complete: [^.]*' | tail -1)"
  unset APPLY_OUT
  echo "${APPLY_SUMMARY:-Migration apply finished.}"
  echo "Verifying the migration ledger with a second read-only plan ..."
  APPROVED_SUMMARY="$PLAN_SUMMARY"; APPROVED_LINES="$PLAN_LINES"
  run_plan
  VERIFY_SUMMARY="$PLAN_SUMMARY"
  # The receipt and result keep the approved plan; the verify line shows the ledger after apply.
  PLAN_SUMMARY="$APPROVED_SUMMARY"; PLAN_LINES="$APPROVED_LINES"
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

share_caddy_root
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
if [[ -n "${SALEAPP_SHARE_CA_FROM:-}" && -f "/mnt/d/SaleApp/${SALEAPP_SHARE_CA_FROM#saleapp-}/caddy-root.crt" ]]; then
  if cmp -s "$ROOT/caddy-root.crt" "/mnt/d/SaleApp/${SALEAPP_SHARE_CA_FROM#saleapp-}/caddy-root.crt"; then
    CA_SUMMARY="$CA_SUMMARY, same certificate as ${SALEAPP_SHARE_CA_FROM#saleapp-}"
  else
    CA_SUMMARY="$CA_SUMMARY, WARNING: differs from ${SALEAPP_SHARE_CA_FROM#saleapp-}"
    echo "WARNING: this stack's Caddy root differs from ${SALEAPP_SHARE_CA_FROM#saleapp-}; clients would need another certificate." >&2
  fi
fi
PS_TABLE="$(compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true)"
printf '%s\n' "$PS_TABLE"
RESULT="DEPLOYED (approved $PLAN_SUMMARY; after: $VERIFY_SUMMARY)"
echo "SALEAPP_DEPLOYED https://$APP_DOMAIN$([[ "$HTTPS_PORT" == 443 ]] || echo ":$HTTPS_PORT")/"
