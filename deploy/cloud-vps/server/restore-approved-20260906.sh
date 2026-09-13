#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" = --approved-production-and-test ] || exit 2
BASE=/opt/worldfert/app/deploy/cloud-vps/.env
ROOT=/opt/worldfert/v2-test
set -a; . "$BASE"; set +a
export MSSQL_TEST_DATABASE=dbwins_worldfert9_test_v2
export TEST_CORS_ORIGIN=https://test.thirayu.online
export TEST_VITE_API_BASE_URL=https://api-test.thirayu.online/api
B=/srv/wf-transfer/incoming/mssql/dbwins_worldfert9_20260906.bak
[ "$(sha256sum "$B" | cut -d' ' -f1)" = 41c36ea663a172c0c98060032fbd29f3c62621dc39b4c9dfd1165289a812cd0f ] || { echo HASH_MISMATCH; exit 3; }
chown 10001:root "$B"; chmod 640 "$B"
q(){ docker exec -e SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" wf-mssql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -W "$@"; }
SRC=/var/opt/mssql/backup/incoming/dbwins_worldfert9_20260906.bak
q -Q "RESTORE VERIFYONLY FROM DISK=N'$SRC';"
RUN=$(date -u +%Y%m%dT%H%M%SZ)
echo "RESTORE_RUN=$RUN"
q -Q "IF OBJECT_ID('tempdb.dbo.WSRestoreAdmin20260906') IS NULL BEGIN SELECT CAST('dbwins_worldfert9' AS varchar(128)) TargetDb, Username,PasswordHash,DisplayName,Role,IsActive,MustChangePassword INTO tempdb.dbo.WSRestoreAdmin20260906 FROM dbwins_worldfert9.wf.AppUser WHERE Username='admin'; INSERT tempdb.dbo.WSRestoreAdmin20260906 SELECT 'dbwins_worldfert9_test_v2',Username,PasswordHash,DisplayName,Role,IsActive,MustChangePassword FROM dbwins_worldfert9_test_v2.wf.AppUser WHERE Username='admin'; END;"
docker stop wf-backend wf-backend-test
for DB in dbwins_worldfert9 dbwins_worldfert9_test_v2; do
 SAFE="/var/opt/mssql/backup/work/pre_restore_${DB}_${RUN}.bak"
 echo "SAFETY_BACKUP=$SAFE"
 q -Q "BACKUP DATABASE [$DB] TO DISK=N'$SAFE' WITH COPY_ONLY, CHECKSUM; RESTORE VERIFYONLY FROM DISK=N'$SAFE' WITH CHECKSUM;"
done
COMPOSE=(docker compose --project-name worldfert-test --env-file "$BASE" --env-file /opt/worldfert/secrets/test-stack/test-stack.env -f "$ROOT/deploy/cloud-vps/docker-compose.test.yml")
for DB in dbwins_worldfert9 dbwins_worldfert9_test_v2; do
 echo "RESTORING=$DB"
 q -Q "ALTER DATABASE [$DB] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; RESTORE DATABASE [$DB] FROM DISK=N'$SRC' WITH REPLACE, MOVE N'dbERP_New_Data' TO N'/var/opt/mssql/data/${DB}_20260906.mdf', MOVE N'dbERP_New_Log' TO N'/var/opt/mssql/data/${DB}_20260906.ldf', RECOVERY; ALTER DATABASE [$DB] SET MULTI_USER;"
 q -d "$DB" -Q "DBCC UPDATEUSAGE(0) WITH NO_INFOMSGS; DBCC CHECKDB WITH NO_INFOMSGS; IF DATABASE_PRINCIPAL_ID('wf_reader') IS NULL BEGIN IF SUSER_ID('wf_reader') IS NOT NULL CREATE USER wf_reader FOR LOGIN wf_reader; ELSE CREATE USER wf_reader WITHOUT LOGIN; END; IF DATABASE_PRINCIPAL_ID('wf_owner') IS NULL BEGIN IF SUSER_ID('wf_owner') IS NOT NULL CREATE USER wf_owner FOR LOGIN wf_owner; ELSE CREATE USER wf_owner WITHOUT LOGIN; END;"
 "${COMPOSE[@]}" run --rm --no-deps -e DB_NAME="$DB" backend-test node run_migrations.js
 "${COMPOSE[@]}" run --rm --no-deps -e DB_NAME="$DB" backend-test node run_migrations.js --plan
 q -d "$DB" -Q "SET QUOTED_IDENTIFIER ON; SET XACT_ABORT ON; BEGIN TRAN; INSERT wf.AppUser (Username,PasswordHash,DisplayName,Role,IsActive,MustChangePassword) SELECT a.Username,a.PasswordHash,a.DisplayName,a.Role,a.IsActive,a.MustChangePassword FROM tempdb.dbo.WSRestoreAdmin20260906 a WHERE a.TargetDb=DB_NAME() AND NOT EXISTS(SELECT 1 FROM wf.AppUser u WHERE u.Username=a.Username); UPDATE u SET PasswordHash=a.PasswordHash,Role=a.Role,IsActive=a.IsActive,MustChangePassword=a.MustChangePassword FROM wf.AppUser u JOIN tempdb.dbo.WSRestoreAdmin20260906 a ON a.Username=u.Username AND a.TargetDb=DB_NAME(); COMMIT; SELECT DB_NAME() DatabaseName,(SELECT COUNT(*) FROM wf.SchemaMigration) AppliedMigrations,(SELECT COUNT(*) FROM dbo.SOHD) SOHD,(SELECT COUNT(*) FROM dbo.WGHD) WGHD,(SELECT COUNT(*) FROM dbo.WGDT) WGDT,(SELECT COUNT(*) FROM dbo.WGDTReport) WGDTReport;"
done
docker start wf-backend wf-backend-test
q -Q "DROP TABLE tempdb.dbo.WSRestoreAdmin20260906;"
echo RESTORE_AND_MIGRATE_COMPLETE