<#
.SYNOPSIS
    สร้างฐาน WINSpeed ในเครื่อง (SQLEXPRESS) ใหม่จาก .bak ต้นฉบับ แล้วแก้ trigger / form / log

.DESCRIPTION
    ทำอย่างเดียวกับ deploy/cloud-vps/server/rebuild-mssql.sh แต่ฝั่ง Windows
    ใช้ Trusted Connection (ไม่ต้องมีรหัส sa) และเรียกไฟล์ .sql จาก L: ได้ตรง ๆ

    หลังสคริปต์นี้ ต้องรันต่อจาก backend/ :
        node run_migrations.js      สร้าง schema wf ทั้ง 100 migration
        node seed_admin.js          ไม่ทำ = ไม่มีใครล็อกอินได้
    เพราะ .bak ไม่มี schema wf และไม่มี database user อยู่ในตัว

.PARAMETER Database
    ชื่อฐานปลายทาง (ค่าปริยาย dbwins_worldfert9)

.PARAMETER BackupFile
    ไฟล์ .bak — ต้องอยู่ในที่ที่ **service ของ SQL Server** อ่านได้
    ไดรฟ์ที่ map ไว้อย่าง L: ใช้ไม่ได้ เพราะ service มองไม่เห็น

.PARAMETER SqlDir
    โฟลเดอร์ที่เก็บ fix_triggers_raiserror.sql / fix_trigger2_iffailed.sql / update_form.sql
#>
[CmdletBinding()]
param(
    [string] $Instance   = '.\SQLEXPRESS',
    [string] $Database   = 'dbwins_worldfert9',
    [string] $BackupFile = 'C:\Program Files\Microsoft SQL Server\MSSQL16.SQLEXPRESS\MSSQL\Backup\dbwins_worldfert9_db_202607021642.bak',
    [string] $SqlDir     = 'L:\My Drive\World Fert\RemoteDB'
)

$ErrorActionPreference = 'Stop'
function Step($n) { Write-Host "`n──────── $n" -ForegroundColor Cyan }

# -b = หยุดทันทีเมื่อ error · ไม่งั้นขั้นถัดไปทำงานต่อบนฐานที่พังครึ่งทาง
function Sql([string] $Query, [string] $Db = 'master') {
    $out = & sqlcmd -S $Instance -E -d $Db -b -Q $Query 2>&1
    if ($LASTEXITCODE -ne 0) { $out | Write-Host; throw "sqlcmd ล้มเหลว" }
    return $out
}
function SqlFile([string] $Path, [string] $Db) {
    if (-not (Test-Path $Path)) { throw "ไม่พบไฟล์ $Path" }
    $out = & sqlcmd -S $Instance -E -d $Db -b -i $Path 2>&1
    if ($LASTEXITCODE -ne 0) { $out | Write-Host; throw "sqlcmd ล้มเหลวกับ $Path" }
    return $out
}

if (-not (Test-Path $BackupFile)) { throw "ไม่พบไฟล์สำรอง $BackupFile" }

Step "1/6 RESTORE $Database"
# ไฟล์ปลายทางตั้งชื่อตามฐาน เพื่อให้ restore ฐานทดสอบคู่กันได้โดยไม่ทับไฟล์กัน
$data = Split-Path $BackupFile -Parent | Split-Path -Parent | Join-Path -ChildPath 'DATA'
Sql @"
IF DB_ID('$Database') IS NOT NULL ALTER DATABASE [$Database] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
RESTORE DATABASE [$Database] FROM DISK=N'$BackupFile'
  WITH MOVE 'dbERP_New_Data' TO N'$data\$Database.mdf',
       MOVE 'dbERP_New_Log'  TO N'$data\${Database}_log.ldf',
       REPLACE, RECOVERY, STATS=25;
ALTER DATABASE [$Database] SET MULTI_USER;
"@ | Select-String -Pattern 'RESTORE DATABASE successfully|Processed' | Select-Object -Last 3

Step "2/6 recovery SIMPLE + ย่อ log + autogrowth คงที่ 64MB"
# คง SIMPLE ไว้: เครื่องนี้ไม่มี BACKUP LOG ตามกำหนดเวลา ถ้าเป็น FULL log จะโตไม่หยุด
# ตั้งเฉพาะ FILEGROWTH — MODIFY FILE ตั้ง SIZE เล็กกว่าปัจจุบันไม่ได้ และ SHRINKFILE ย่อให้แล้ว
Sql @"
ALTER DATABASE [$Database] SET RECOVERY SIMPLE;
USE [$Database];
CHECKPOINT;
DBCC SHRINKFILE (N'dbERP_New_Log', 64);
ALTER DATABASE [$Database] MODIFY FILE (NAME=N'dbERP_New_Log', FILEGROWTH=64MB);
"@ | Select-String -Pattern 'DBCC|rows affected' | Select-Object -First 2

Step "3/6 fix_triggers_raiserror"
SqlFile (Join-Path $SqlDir 'fix_triggers_raiserror.sql') $Database | Select-Object -Last 6

Step "4/6 fix_trigger2_iffailed"
# สคริปต์ต้นฉบับ hard-code USE dbwins_worldfert9 — เปลี่ยนให้ตรงฐานที่กำลังทำ
$t2 = Join-Path $env:TEMP "_t2_$Database.sql"
(Get-Content (Join-Path $SqlDir 'fix_trigger2_iffailed.sql') -Raw) `
    -replace '(?m)^USE dbwins_worldfert9;', "USE [$Database];" | Set-Content $t2 -Encoding UTF8
SqlFile $t2 $Database | Select-Object -Last 8
Remove-Item $t2 -ErrorAction SilentlyContinue

Step "5/6 update_form"
SqlFile (Join-Path $SqlDir 'update_form.sql') $Database | Select-Object -Last 3

Step "6/6 QA"
Sql @"
SET NOCOUNT ON;
SELECT 'check_triggers_raiserror = ' + CAST((SELECT COUNT(*) FROM sys.sql_modules
       WHERE definition LIKE '%raiserror @errno @errmsg%') AS varchar(10)) + '   (ต้องเป็น 0)';
SELECT 'recovery model           = ' + recovery_model_desc FROM sys.databases WHERE name='$Database';
SELECT 'ไฟล์ ' + name + ' = ' + CAST(size*8/1024 AS varchar(10)) + ' MB · growth ' +
       CASE WHEN is_percent_growth=1 THEN CAST(growth AS varchar(10))+' %'
            ELSE CAST(growth*8/1024 AS varchar(10))+' MB' END FROM sys.database_files;
SELECT 'ตาราง dbo                = ' + CAST(COUNT(*) AS varchar(10)) FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo');
SELECT 'SOHD                     = ' + CAST(COUNT(*) AS varchar(20)) FROM dbo.SOHD;
SELECT 'SMForm path ถูกต้อง       = ' + CAST(COUNT(*) AS varchar(20)) FROM dbo.SMForm
 WHERE Formpath LIKE 'C:\Program Files\Prosoft\WINSpeed\Forms\%';
"@ $Database

Write-Host "`nREBUILD $Database เสร็จแล้ว — ต่อด้วย run_migrations.js และ seed_admin.js" -ForegroundColor Green
