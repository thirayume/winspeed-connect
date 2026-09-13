#!/usr/bin/env bash
set -euo pipefail
# Fixed isolated target. Refuses overwrite; source snapshot checksum is immutable.
DB=dbwins_worldfert9_test_v2
BACKUP=/srv/wf-transfer/incoming/mssql/dbwins_worldfert9_20260905.bak
EXPECTED=854D0462BA5C3428379B10E451055C99E128694EA5A9A5AB497B2FA5ACC51645
[ "${1:-}" = --restore-new-v2-test ] || { echo 'Use --restore-new-v2-test'; exit 2; }
[ -f "$BACKUP" ] || { echo 'Backup missing'; exit 2; }
ACTUAL=$(sha256sum "$BACKUP" | cut -d' ' -f1)
[ "${ACTUAL^^}" = "$EXPECTED" ] || { echo 'Backup checksum mismatch'; exit 3; }
set -a
. /opt/worldfert/app/deploy/cloud-vps/.env
set +a
SQLCMD=$(docker exec wf-mssql sh -c 'command -v /opt/mssql-tools18/bin/sqlcmd || command -v /opt/mssql-tools/bin/sqlcmd' | tr -d '\r')
q(){ docker exec -e SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" wf-mssql "$SQLCMD" -S localhost -U sa -C -b "$@"; }
EXISTS=$(q -h -1 -W -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.databases WHERE name='$DB'" | tr -d '\r[:space:]')
[ "$EXISTS" = 0 ] || { echo 'V2 database already exists; no overwrite performed'; exit 4; }
FILE=/var/opt/mssql/backup/incoming/dbwins_worldfert9_20260905.bak
chown 10001:root "$BACKUP"
chmod 640 "$BACKUP"
q -Q "RESTORE VERIFYONLY FROM DISK='$FILE';"
FL=$(q -h -1 -W -s'|' -Q "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK='$FILE';" | tr -d '\r')
MOVES=''
COUNT=0
while IFS='|' read -r LOGICAL PHYSICAL TYPE GROUP SIZE MAXSIZE ID REST; do
  [[ "$TYPE" = D || "$TYPE" = L ]] || continue
  [[ "$LOGICAL" =~ ^[A-Za-z0-9_.-]+$ && "$ID" =~ ^[0-9]+$ ]] || { echo 'Unexpected logical file name/id'; exit 5; }
  EXT=ndf; [ "$TYPE" = L ] && EXT=ldf
  [ -z "$MOVES" ] || MOVES+=', '
  MOVES+="MOVE '$LOGICAL' TO '/var/opt/mssql/data/${DB}_${ID}.$EXT'"
  COUNT=$((COUNT+1))
done <<< "$FL"
[ "$COUNT" -ge 2 ] || { echo 'Incomplete backup file list'; exit 6; }
q -Q "RESTORE DATABASE [$DB] FROM DISK='$FILE' WITH $MOVES, RECOVERY, STATS=10;"
q -d "$DB" -Q "DBCC CHECKDB WITH NO_INFOMSGS; SELECT DB_NAME() DatabaseName,compatibility_level FROM sys.databases WHERE name=DB_NAME();"
echo 'RESTORE_V2_TEST_COMPLETE'
