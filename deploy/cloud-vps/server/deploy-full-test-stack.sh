#!/usr/bin/env bash
# One-shot production snapshot -> test databases -> isolated test application.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/worldfert/app}"
DEPLOY_DIR="$APP_DIR/deploy/cloud-vps"
MSSQL_TARGET="${1:-dbwins_worldfert9_test}"
MYSQL_TARGET="${2:-db_truckscale_test}"
CONFIRM="${3:-}"

[ "$(id -u)" -eq 0 ] || { echo "ERROR: run with sudo/root" >&2; exit 1; }
[ -x "$DEPLOY_DIR/server/clone-databases-to-test.sh" ] || { echo "ERROR: clone helper is missing" >&2; exit 2; }
[ -x "$DEPLOY_DIR/server/deploy-test-app.sh" ] || { echo "ERROR: test app helper is missing" >&2; exit 2; }

case "$CONFIRM" in
  --dry-run)
    APP_DIR="$APP_DIR" "$DEPLOY_DIR/server/clone-databases-to-test.sh" \
      all "$MSSQL_TARGET" "$MYSQL_TARGET" --dry-run

    # Validate the application definition without requiring test targets to
    # exist yet. The confirmed flow performs the full DB-aware app preflight
    # immediately after the clone.
    APP_DIR="$APP_DIR" "$DEPLOY_DIR/server/deploy-test-app.sh" \
      config-check "$MSSQL_TARGET" "$MYSQL_TARGET" --dry-run
    echo "FULL TEST STACK DRY RUN OK; no database or container was changed."
    ;;
  --confirm-rebuild-test)
    # Stop only test application containers so they cannot write while their
    # databases are replaced. Production containers continue running.
    docker stop wf-frontend-test wf-backend-test >/dev/null 2>&1 || true
    APP_DIR="$APP_DIR" "$DEPLOY_DIR/server/clone-databases-to-test.sh" \
      all "$MSSQL_TARGET" "$MYSQL_TARGET" --confirm-replace-test
    APP_DIR="$APP_DIR" "$DEPLOY_DIR/server/deploy-test-app.sh" \
      deploy "$MSSQL_TARGET" "$MYSQL_TARGET"
    echo "FULL TEST STACK READY"
    ;;
  *)
    echo "ERROR: add --dry-run or --confirm-rebuild-test" >&2
    exit 3
    ;;
esac
