#!/usr/bin/env bash
set -euo pipefail
ROOT=/opt/worldfert/v2-test
BASE_ENV=/opt/worldfert/app/deploy/cloud-vps/.env
TEST_ENV=/opt/worldfert/secrets/test-stack/test-stack.env
[ -f "$BASE_ENV" ] && [ -f "$TEST_ENV" ] || { echo 'Existing Hostinger test configuration required'; exit 2; }
export MSSQL_TEST_DATABASE=dbwins_worldfert9_test_v2
export TEST_APP_DOMAIN=test.thirayu.online
export TEST_API_DOMAIN=api-test.thirayu.online
export TEST_CORS_ORIGIN=https://test.thirayu.online
export TEST_VITE_API_BASE_URL=https://api-test.thirayu.online/api
COMPOSE=(docker compose --project-name worldfert-test --env-file "$BASE_ENV" --env-file "$TEST_ENV" -f "$ROOT/deploy/cloud-vps/docker-compose.test.yml")
case "${1:-}" in
 build)
  rm -f "$ROOT/backend/scripts/seed-wgxx-testdata.js" "$ROOT/backend/scripts/seed-trip-testdata.js" "$ROOT/backend/scripts/e2e-sale-trip-flow.js"
  "${COMPOSE[@]}" build backend-test frontend-test ;;
 plan) "${COMPOSE[@]}" run --rm --no-deps backend-test node run_migrations.js --plan ;;
 migrate) "${COMPOSE[@]}" run --rm --no-deps backend-test node run_migrations.js ;;
 principals|weighing-schema|reset-weighing|seed-weighing)
  [ "${2:-}" = --confirm-v2-test ] || { echo 'Explicit --confirm-v2-test required'; exit 3; }
  set -a; . "$BASE_ENV"; set +a
  case "$1" in principals) FILE=v2-principals.sql ;; weighing-schema) FILE=v2-weighing-schema.sql ;; reset-weighing) FILE=v2-reset-weighing.sql ;; seed-weighing) FILE=v2-seed-weighing.sql ;; esac
  docker exec -i -e SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" wf-mssql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -d dbwins_worldfert9_test_v2 < "$ROOT/db-init/$FILE"
  ;;
 deploy) "${COMPOSE[@]}" up -d --no-deps backend-test frontend-test ;;
 *) echo 'Usage: deploy-v2-test.sh build|plan|migrate|principals|weighing-schema|reset-weighing|seed-weighing|deploy'; exit 2 ;;
esac
