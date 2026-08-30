#!/usr/bin/env bash
# Resume-safe post-restore setup: application principals, migrations, seed and DB check.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/worldfert/app}"
ENV_FILE="$APP_DIR/deploy/cloud-vps/.env"
[ -f "$ENV_FILE" ] || { echo "ERROR: missing $ENV_FILE" >&2; exit 2; }

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

DB="${DB_NAME:-dbwins_worldfert9}"
SQLCMD=$(docker exec wf-mssql bash -lc 'command -v /opt/mssql-tools18/bin/sqlcmd || command -v /opt/mssql-tools/bin/sqlcmd' | tr -d '\r')
[ -n "$SQLCMD" ] || { echo "ERROR: sqlcmd not found" >&2; exit 1; }
q() { docker exec wf-mssql "$SQLCMD" -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b "$@"; }

echo "[1/4] Ensure application logins and users"
q -Q "IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name='wf_reader') CREATE LOGIN wf_reader WITH PASSWORD='${WF_READER_PASSWORD}', CHECK_POLICY=OFF;
      IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name='wf_owner') CREATE LOGIN wf_owner WITH PASSWORD='${WF_OWNER_PASSWORD}', CHECK_POLICY=OFF;"
q -d "$DB" -Q "IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name='wf_reader') CREATE USER wf_reader FOR LOGIN wf_reader;
      IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name='wf_owner') CREATE USER wf_owner FOR LOGIN wf_owner;
      IF IS_ROLEMEMBER('db_datareader','wf_reader') <> 1 ALTER ROLE db_datareader ADD MEMBER wf_reader;
      IF IS_ROLEMEMBER('db_datareader','wf_owner') <> 1 ALTER ROLE db_datareader ADD MEMBER wf_owner;"

echo "[2/4] Run pending migrations"
docker exec wf-backend node run_migrations.js

echo "[3/4] Apply least-privilege grants and seed admin"
q -d "$DB" -Q "GRANT CONTROL ON SCHEMA::wf TO wf_owner; GRANT SELECT ON SCHEMA::wf TO wf_reader;"
docker exec wf-backend node seed_admin.js

echo "[4/4] Verify restored database"
q -d "$DB" -Q "SELECT DB_NAME() AS database_name, COUNT(*) AS table_count FROM sys.tables;
                 DBCC UPDATEUSAGE ('$DB') WITH NO_INFOMSGS;
                 DBCC CHECKDB ('$DB') WITH PHYSICAL_ONLY, NO_INFOMSGS;"
echo "MSSQL FINALIZE OK"
