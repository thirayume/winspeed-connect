<#
.SYNOPSIS
    ยกชุดทดสอบ replication ของ TruckScale บน localhost แล้วต่อสายให้เรียบร้อย

.DESCRIPTION
    ทำตามลำดับเดียวกับที่จะใช้กับของจริง ไม่ใช่ทางลัดเฉพาะการทดสอบ:

      1. ยก MySQL สองตัวด้วย docker compose (source = เครื่องชั่ง, replica = คลาวด์)
      2. รอให้ทั้งคู่พร้อมจริง (ใช้ healthcheck ไม่ใช่ sleep เดา)
      3. ใส่ข้อมูลตัวอย่างที่ source
      4. ดัมป์แบบ consistent พร้อมตำแหน่ง GTID แล้วโหลดลง replica
         — ขั้นนี้คือ "ฐานตั้งต้น" ถ้าข้ามไป replica จะไม่มีตารางแล้ว replication ล้มทันที
      5. ชี้ replica มาที่ source ด้วย SOURCE_AUTO_POSITION=1 แล้วเริ่มทำงาน
      6. ตรวจว่าไหลจริง

    เหตุที่ใช้ GTID: เครื่องชั่งเน็ตหลุดบ่อย พอกลับมา replica ต่อจากจุดเดิมได้เอง
    โดยไม่ต้องจำชื่อไฟล์ binlog กับ offset ซึ่งเป็นจุดที่พังบ่อยที่สุดของวิธีเดิม

.PARAMETER Fresh
    ลบ volume เดิมแล้วเริ่มใหม่ทั้งหมด

.EXAMPLE
    .\Setup-Replication.ps1
    .\Setup-Replication.ps1 -Fresh
#>
[CmdletBinding()]
param([switch]$Fresh)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$SRC = 'ts-source'
$REP = 'ts-replica'
$ROOTPW = 'rootpw'

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }

function Invoke-My {
    param([string]$Container, [string]$Sql, [switch]$Raw)
    $cmd = @('exec', '-i', $Container, 'mysql', "-uroot", "-p$ROOTPW", '-N', '-B', '-e', $Sql)
    if ($Raw) { $cmd = @('exec', '-i', $Container, 'mysql', "-uroot", "-p$ROOTPW", '-e', $Sql) }
    $out = & docker @cmd 2>&1 | Where-Object { $_ -notmatch 'Using a password on the command line' }
    if ($LASTEXITCODE -ne 0) { throw "MySQL ($Container) ล้มเหลว: $out" }
    return $out
}

function Wait-Healthy([string]$Container, [int]$TimeoutSec = 180) {
    Say "   รอ $Container ..."
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $st = (& docker inspect --format '{{.State.Health.Status}}' $Container 2>$null)
        if ($st -eq 'healthy') { Say "   $Container พร้อม" Green; return }
        if ($st -eq 'unhealthy') { throw "$Container สถานะ unhealthy — ดู: docker logs $Container" }
        Start-Sleep -Seconds 3
    }
    throw "$Container ไม่พร้อมภายใน $TimeoutSec วินาที"
}

# ── 1. ยกคอนเทนเนอร์ ──────────────────────────────────────────
Say "`n[1/6] ยก MySQL สองตัว" Cyan
if ($Fresh) { Say "   -Fresh: ลบของเดิมทิ้งก่อน"; & docker compose down -v 2>&1 | Out-Null }
& docker compose up -d 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "docker compose up ล้มเหลว" }

Say "`n[2/6] รอให้ทั้งคู่พร้อม" Cyan
Wait-Healthy $SRC
Wait-Healthy $REP

# ── 3. ข้อมูลตัวอย่างที่ source ───────────────────────────────
# ใส่ก่อนดัมป์ เพื่อพิสูจน์ว่าฐานตั้งต้นถูกยกไปด้วย ไม่ใช่แค่ของใหม่หลังต่อสาย
Say "`n[3/6] ใส่ข้อมูลตัวอย่างที่ source" Cyan
$seed = @'
USE db_truckscale;
INSERT INTO tbl_keyone (one_cus_name, one_car_regis, one_des, one_w_type, one_datetime)
VALUES ('ทดสอบ REPL', 'REPL-001', 'ฐานตั้งต้นก่อนต่อสาย', 'ชั่งจ่าย',
        DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s'));
'@
try { Invoke-My -Container $SRC -Sql $seed -Raw | Out-Null; Say "   ใส่แล้ว 1 แถว" Green }
catch { Say "   ข้ามการ seed (คอลัมน์ไม่ตรง schema จริง): $($_.Exception.Message)" Yellow }

$srcBefore = (Invoke-My -Container $SRC -Sql "SELECT COUNT(*) FROM db_truckscale.tbl_keyone").Trim()
Say "   source มี tbl_keyone = $srcBefore แถว"

# ── 4. ฐานตั้งต้น: ดัมป์พร้อม GTID แล้วโหลดลง replica ─────────
Say "`n[4/6] ยกฐานตั้งต้นไป replica (dump + restore พร้อมตำแหน่ง GTID)" Cyan
$dumpPath = Join-Path $PSScriptRoot 'baseline.sql'
& docker exec $SRC mysqldump -uroot "-p$ROOTPW" `
    --single-transaction --set-gtid-purged=ON --routines --events --triggers `
    --databases db_truckscale 2>$null | Set-Content -Path $dumpPath -Encoding UTF8
if (-not (Test-Path $dumpPath) -or (Get-Item $dumpPath).Length -lt 100) { throw "ดัมป์ไม่สำเร็จ" }
Say ("   ดัมป์ได้ {0:N0} ไบต์" -f (Get-Item $dumpPath).Length)

Invoke-My -Container $REP -Sql "RESET BINARY LOGS AND GTIDS;" | Out-Null
Get-Content $dumpPath -Raw | & docker exec -i $REP mysql -uroot "-p$ROOTPW" 2>&1 |
    Where-Object { $_ -notmatch 'Using a password on the command line' } | Out-Null
Say "   โหลดฐานตั้งต้นแล้ว" Green

# ── 5. ต่อสาย ────────────────────────────────────────────────
Say "`n[5/6] ชี้ replica มาที่ source แล้วเริ่ม" Cyan
$change = @"
STOP REPLICA;
CHANGE REPLICATION SOURCE TO
  SOURCE_HOST='ts-source',
  SOURCE_PORT=3306,
  SOURCE_USER='repl',
  SOURCE_PASSWORD='replpw',
  SOURCE_AUTO_POSITION=1,
  SOURCE_CONNECT_RETRY=10,
  SOURCE_RETRY_COUNT=0;
START REPLICA;
"@
Invoke-My -Container $REP -Sql $change -Raw | Out-Null
Start-Sleep -Seconds 4

# ปิดการเขียนที่ปลายทางหลังต่อสายแล้ว — ข้อมูลต้องไหลทางเดียว
# ตั้งตอนนี้ไม่ใช่ตอนบูต เพราะ entrypoint ของ MySQL ต้องเขียนตอน init
# และ CHANGE REPLICATION SOURCE ก็เขียน metadata เหมือนกัน
# (เธรด replication ไม่ติด read_only จึงยังทำงานได้ปกติ)
Invoke-My -Container $REP -Sql "SET GLOBAL read_only=ON; SET GLOBAL super_read_only=ON;" | Out-Null
Say "   เริ่มแล้ว · ปลายทางตั้งเป็น read-only" Green

# ── 6. ตรวจ ──────────────────────────────────────────────────
Say "`n[6/6] ตรวจว่าไหลจริง" Cyan
& (Join-Path $PSScriptRoot 'Check-Replication.ps1')
