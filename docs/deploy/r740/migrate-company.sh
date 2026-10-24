#!/usr/bin/env bash
# Migrate one live company database (dbwins_worldfert9 or dbwins_worldfert2) on R740-SRV.
# Run inside WSL Ubuntu by Migrate-Company.bat:  migrate-company.sh <db> <plan|apply>
#
# plan : read-only migration plan (no writes).
# apply: refuse without a fresh pre-deploy backup, then apply the 152 migrations and verify.
# It uses the prod migrator (wf_r740_prod_migrator) from D:\SaleApp\prod\config\.env.migrator.local
# and the built backend image. It never changes dbo data (the migrations add only the wf schema).
set -Eeuo pipefail
exec </dev/null

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

DB="${1:-}"; PHASE="${2:-}"
case "$DB" in
  dbwins_worldfert9|dbwins_worldfert2) ;;
  *) fail "database must be dbwins_worldfert9 or dbwins_worldfert2 (got '$DB')." ;;
esac
[[ "$PHASE" == plan || "$PHASE" == apply ]] || fail "phase must be plan or apply."

readonly CONFIG='/mnt/d/SaleApp/prod/config'
readonly MIG_ENV="$CONFIG/.env.migrator.local"
readonly IMAGE='worldfert-saleapp-uat-backend:local'
readonly BACKUP_DIR='/mnt/d/MSSQL/MSSQL10_50.SQL2008/Backup'
readonly BACKUP_MAX_MIN=120
readonly LOGDIR='/mnt/d/SaleApp/prod/deploy-logs'
mkdir -p "$LOGDIR" 2>/dev/null || true

command -v docker >/dev/null 2>&1 || fail "Docker is not available in this WSL distribution."
[[ "$(docker --context default info --format '{{.OSType}}' 2>/dev/null)" == linux ]] || fail "the Docker engine is not Linux."
docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "$IMAGE is not built; deploy UAT once first."
[[ -f "$MIG_ENV" ]] || fail "$MIG_ENV is missing (fill D:\\SaleApp\\prod\\config from prod.migrator.env.example)."

# Migrator credentials come only from the prod migrator env file.
MIG_USER="$(sed -n 's/^ONPREM_MIGRATOR_USER=//p' "$MIG_ENV" | tr -d '\r' | head -1)"
[[ "$MIG_USER" == 'wf_r740_prod_migrator' ]] || fail "ONPREM_MIGRATOR_USER must be wf_r740_prod_migrator in $MIG_ENV."

if [[ "$PHASE" == apply ]]; then
  newest="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB}_predeploy_*.bak" -printf '%T@ %s %f\n' 2>/dev/null | sort -n | tail -1)"
  [[ -n "$newest" ]] || fail "no ${DB}_predeploy_*.bak in $BACKUP_DIR; take a backup first (sql/r740-company-backup-${DB}.sql)."
  read -r age size file <<<"$newest"
  age=$(( $(date +%s) - ${age%.*} ))
  (( age <= BACKUP_MAX_MIN * 60 )) || fail "the newest backup $file is $(( age/60 )) minutes old (limit $BACKUP_MAX_MIN); take a fresh one."
  (( age >= 60 )) || fail "the backup $file changed in the last minute; wait until SSMS reports it verified."
  (( size > 0 )) || fail "the backup $file is empty."
  echo "Pre-migrate backup: $file ($(( size/1048576 )) MB, $(( age/60 )) min old)"
fi

# The migration runner targets this company database as the migrator; TARGET_KIND=uat carries no
# single-database pin, so the guard checks only that it connects to exactly $DB over TCP, as the
# migrator login, with no elevated roles.
run_migrate() {  # args passed to run_migrations.js
  docker --context default run --rm --network bridge \
    --env-file "$MIG_ENV" \
    -e NODE_ENV=production -e TZ=Asia/Bangkok -e DB_MODE=onprem -e DB_OPERATION=migration -e MIGRATION_PROFILE=onprem \
    -e ONPREM_DB_SERVER=172.16.30.169 -e ONPREM_DB_PORT=1433 -e ONPREM_DB_INSTANCE= \
    -e "ONPREM_DB_NAME=$DB" -e 'ONPREM_EXPECTED_SERVERNAME=R740-SRV\SQL2008' -e ONPREM_PRODUCT_VERSION_PREFIX=10.50. \
    -e ONPREM_DB_ENCRYPT=true -e ONPREM_DB_LEGACY_TLS=true -e ONPREM_DB_TDS_VERSION=7_3_B \
    -e ONPREM_TARGET_KIND=uat -e COUPON_NATIVE_POSTING_ENABLED=false \
    --entrypoint node "$IMAGE" run_migrations.js "$@" --profile=onprem
}

# Count plan entries directly (robust across runner output formats): the runner lists one
# "  PENDING <file>" per pending migration and "  <KIND>_DRIFT <file>" per drift.
count_pending() { printf '%s\n' "$1" | grep -cE '^[[:space:]]+PENDING[[:space:]]'; }
count_drift()   { printf '%s\n' "$1" | grep -cE '^[[:space:]]+[A-Z_]+_DRIFT[[:space:]]'; }
plan_ok() { printf '%s\n' "$1" | grep -qiE 'migration (read-only plan|complete)|unchanged:'; }

echo "Read-only migration plan for $DB ..."
PLAN_OUT="$(run_migrate --plan 2>&1)" || { printf '%s\n' "$PLAN_OUT" | tail -25; fail "plan failed."; }
plan_ok "$PLAN_OUT" || { printf '%s\n' "$PLAN_OUT" | tail -25; fail "could not read a migration plan from $DB (see output above)."; }
printf '%s\n' "$PLAN_OUT" | grep -E '^[[:space:]]+(PENDING|[A-Z_]+_DRIFT)[[:space:]]' || true
PENDING="$(count_pending "$PLAN_OUT")"; DRIFT="$(count_drift "$PLAN_OUT")"
echo "plan: pending=$PENDING drift=$DRIFT"
[[ "$DRIFT" == 0 ]] || fail "migration drift on $DB; nothing applied."

if [[ "$PHASE" == plan ]]; then echo "Plan only ($DB); no database writes."; exit 0; fi
(( PENDING > 0 )) || { echo "No pending migrations on $DB; nothing to apply."; exit 0; }

echo "Applying $PENDING migration(s) to $DB ..."
APPLY_OUT="$(run_migrate 2>&1)" || { printf '%s\n' "$APPLY_OUT" | tail -25; fail "apply failed on $DB; inspect the database (restore the backup if damaged)."; }
printf '%s\n' "$APPLY_OUT" | grep -E 'Migration complete' || true

echo "Verifying $DB with a second read-only plan ..."
VERIFY_OUT="$(run_migrate --plan 2>&1)" || fail "post-apply verify failed on $DB."
plan_ok "$VERIFY_OUT" || fail "post-apply verify produced no plan on $DB."
VPEND="$(count_pending "$VERIFY_OUT")"; VDRIFT="$(count_drift "$VERIFY_OUT")"
[[ "$VPEND" == 0 && "$VDRIFT" == 0 ]] || fail "pending or drift remain on $DB after apply (pending=$VPEND drift=$VDRIFT)."
echo "SALEAPP_COMPANY_MIGRATED $DB pending=0 drift=0"
