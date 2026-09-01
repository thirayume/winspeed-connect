#!/usr/bin/env bash
#
# สร้างฐาน WINSpeed ใหม่จาก .bak ต้นฉบับ แล้วแก้ trigger / form / log ให้ครบในครั้งเดียว
#
# ใช้:  rebuild-mssql.sh <ชื่อฐาน> <ไฟล์ .bak ที่คอนเทนเนอร์มองเห็น>
# เช่น: rebuild-mssql.sh dbwins_worldfert9_test /var/opt/mssql/backup/incoming/dbwins_worldfert9_db_202607021642.bak
#
# หลังรันสคริปต์นี้ ยังต้องทำต่อจากเครื่องผู้ดูแล:
#   1) node run_migrations.js   (สร้าง schema wf ทั้ง 100 migration)
#   2) node seed_admin.js       (ไม่ทำ = ไม่มีใครล็อกอินได้)
# เพราะ .bak ไม่มี schema wf และไม่มี database user อยู่ในตัว
#
set -euo pipefail

DB="${1:?ระบุชื่อฐาน}"
BAK="${2:?ระบุไฟล์ .bak}"
# mount คือ /srv/wf-transfer/work/mssql -> /var/opt/mssql/backup/work (ไม่มี /mssql ซ้อนอีกชั้น)
SQLDIR=/var/opt/mssql/backup/work                # ที่คอนเทนเนอร์เห็นสคริปต์ SQL
HOSTSQL=/srv/wf-transfer/work/mssql              # ที่โฮสต์เห็นไฟล์เดียวกัน
ENVF=/opt/worldfert/app/deploy/cloud-vps/.env

[ "$(id -u)" -eq 0 ] || { echo "ต้องรันด้วย root" >&2; exit 1; }
SA="$(sed -n 's/^MSSQL_SA_PASSWORD=//p' "$ENVF" | tail -1)"
[ -n "$SA" ] || { echo "อ่าน MSSQL_SA_PASSWORD จาก $ENVF ไม่ได้" >&2; exit 2; }

Q() { docker exec -i wf-mssql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SA" -C -b "$@"; }
step() { printf '\n──────── %s\n' "$*"; }

step "1/6 RESTORE $DB"
Q -Q "
IF DB_ID('$DB') IS NOT NULL ALTER DATABASE [$DB] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
RESTORE DATABASE [$DB] FROM DISK='$BAK'
  WITH MOVE 'dbERP_New_Data' TO '/var/opt/mssql/data/${DB}.mdf',
       MOVE 'dbERP_New_Log'  TO '/var/opt/mssql/data/${DB}_log.ldf',
       REPLACE, RECOVERY, STATS=25;
ALTER DATABASE [$DB] SET MULTI_USER;"

step "2/6 recovery SIMPLE + ย่อ log เหลือ 64MB + autogrowth คงที่"
# คง SIMPLE ไว้ตามที่ Fix_DBLogSize.sql เองอธิบาย: ระบบนี้ไม่มี BACKUP LOG ตามกำหนดเวลา
# ถ้ากลับไป FULL log จะโตไม่หยุดเหมือนเดิม (เคยขึ้นไป 11 GB)
# ตั้งเฉพาะ FILEGROWTH ไม่ตั้ง SIZE — DBCC SHRINKFILE ย่อให้เหลือ ~64MB ไปแล้ว
# และ MODIFY FILE ตั้ง SIZE เล็กกว่าขนาดปัจจุบันไม่ได้ ("Specified size is less than or equal to current size")
# ซึ่งทำให้สคริปต์หยุดกลางคันทั้งที่ shrink สำเร็จแล้ว
Q -Q "
ALTER DATABASE [$DB] SET RECOVERY SIMPLE;
USE [$DB];
CHECKPOINT;
DBCC SHRINKFILE (N'dbERP_New_Log', 64);
ALTER DATABASE [$DB] MODIFY FILE (NAME=N'dbERP_New_Log', FILEGROWTH=64MB);"

step "3/6 fix_triggers_raiserror — trigger ERwin ที่ใช้ syntax SQL 2000"
Q -d "$DB" -i "$SQLDIR/fix_triggers_raiserror.sql"

step "4/6 fix_trigger2_iffailed — 5 ตัวที่ตัวแรกข้าม (มี comment คั่นหน้า create trigger)"
# สคริปต์ต้นฉบับ hard-code USE dbwins_worldfert9 จึงต้องเปลี่ยนให้ตรงฐานที่กำลังทำ
sed "s/^USE dbwins_worldfert9;/USE [$DB];/" "$HOSTSQL/fix_trigger2_iffailed.sql" > "$HOSTSQL/_t2_$DB.sql"
Q -d "$DB" -i "$SQLDIR/_t2_$DB.sql"
rm -f "$HOSTSQL/_t2_$DB.sql"

step "5/6 update_form — ชี้ Formpath ไปโฟลเดอร์ Forms มาตรฐาน"
Q -d "$DB" -i "$SQLDIR/update_form.sql" | tail -4

step "6/7 ปรับแต่งประสิทธิภาพ"
# 1) autogrowth ของไฟล์ data มาจาก .bak เป็น 10% — บนไฟล์ 3.3 GB คือโตทีละ ~334 MB
#    ทุกครั้งที่โตจะหยุดรอจนจองพื้นที่เสร็จ ตั้งเป็นก้อนคงที่ 512 MB คาดเดาได้กว่ามาก
# 2) ฐานนี้ restore มาจาก SQL 2008 (version 655) สถิติที่ติดมาเป็นของ optimizer รุ่นเก่า
#    ต้องสร้างใหม่ ไม่งั้น query plan จะเพี้ยนจนช้าโดยไม่มีสาเหตุที่มองเห็น
# 3) เปิด auto statistics ไว้ ให้ SQL Server ดูแลต่อเอง
Q -Q "
ALTER DATABASE [$DB] MODIFY FILE (NAME=N'dbERP_New_Data', FILEGROWTH=512MB);
ALTER DATABASE [$DB] SET AUTO_CREATE_STATISTICS ON;
ALTER DATABASE [$DB] SET AUTO_UPDATE_STATISTICS ON;"
echo "  สร้างสถิติใหม่ทั้งฐาน (sp_updatestats) — ใช้เวลาสักครู่"
Q -d "$DB" -Q "EXEC sp_updatestats;" | tail -3

step "7/7 QA"
Q -d "$DB" -h -1 -W -Q "SET NOCOUNT ON;
SELECT 'check_triggers_raiserror = ' + CAST((SELECT COUNT(*) FROM sys.sql_modules
       WHERE definition LIKE '%raiserror @errno @errmsg%') AS varchar(10)) + '   (ต้องเป็น 0)';
SELECT 'recovery model           = ' + recovery_model_desc FROM sys.databases WHERE name='$DB';
SELECT 'ไฟล์ ' + name + ' = ' + CAST(size*8/1024 AS varchar(10)) + ' MB · growth ' +
       CASE WHEN is_percent_growth=1 THEN CAST(growth AS varchar(10))+' %'
            ELSE CAST(growth*8/1024 AS varchar(10))+' MB' END
  FROM sys.database_files;
SELECT 'compatibility level      = ' + CAST(compatibility_level AS varchar(10)) FROM sys.databases WHERE name='$DB';
SELECT 'ตาราง dbo                = ' + CAST(COUNT(*) AS varchar(10)) FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo');
SELECT 'SOHD                     = ' + CAST(COUNT(*) AS varchar(20)) FROM dbo.SOHD;
SELECT 'SMForm ที่ path ถูกต้อง    = ' + CAST(COUNT(*) AS varchar(20))
  FROM dbo.SMForm WHERE Formpath LIKE 'C:\Program Files\Prosoft\WINSpeed\Forms\%';"

echo
echo "REBUILD $DB เสร็จแล้ว — ขั้นต่อไปคือ run_migrations.js และ seed_admin.js จากเครื่องผู้ดูแล"
