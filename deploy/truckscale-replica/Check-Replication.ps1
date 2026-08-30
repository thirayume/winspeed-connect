<#
.SYNOPSIS
    ตรวจสถานะ replication และพิสูจน์ว่าข้อมูลไหลจริง

.DESCRIPTION
    ไม่ดูแค่ "Running = Yes" เพราะสายที่ค้างอยู่ก็ขึ้น Yes ได้
    เขียนแถวจริงที่ source แล้วรอให้โผล่ที่ replica — นั่นคือหลักฐาน

    ค่าที่ต้องเฝ้าเมื่อขึ้นของจริง:
      Replica_IO_Running / Replica_SQL_Running  ต้อง Yes ทั้งคู่
      Seconds_Behind_Source                     ตามหลังกี่วินาที
      Last_Error                                ต้องว่าง

.PARAMETER SkipWriteTest
    ตรวจสถานะอย่างเดียว ไม่เขียนข้อมูลทดสอบ
#>
[CmdletBinding()]
param([switch]$SkipWriteTest)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$SRC = 'ts-source'; $REP = 'ts-replica'; $ROOTPW = 'rootpw'

function My([string]$c, [string]$sql) {
    $out = & docker exec -i $c mysql -uroot "-p$ROOTPW" -N -B -e $sql 2>&1 |
        Where-Object { $_ -notmatch 'Using a password on the command line' }
    if ($LASTEXITCODE -ne 0) { throw "MySQL ($c): $out" }
    return ($out -join "`n")
}

Write-Host "`n=== สถานะ replication ===" -ForegroundColor Cyan
$fields = 'Source_Host', 'Replica_IO_Running', 'Replica_SQL_Running',
          'Seconds_Behind_Source', 'Last_IO_Error', 'Last_SQL_Error'
# ใช้ --vertical ไม่ใช่ \G — ไคลเอนต์ MySQL 9 ไม่รับ \G ผ่าน -e
$raw = & docker exec -i $REP mysql -uroot "-p$ROOTPW" --vertical -e "SHOW REPLICA STATUS" 2>&1 |
    Where-Object { $_ -notmatch 'Using a password on the command line' }

if (-not ($raw -join '')) { Write-Host "  ยังไม่ได้ตั้ง replication" -ForegroundColor Yellow; exit 1 }

$rows = @()
foreach ($f in $fields) {
    $line = $raw | Where-Object { $_ -match "^\s*$f\s*:" } | Select-Object -First 1
    $val = if ($line) { ($line -split ':', 2)[1].Trim() } else { '(ไม่พบ)' }
    if ($val -eq '') { $val = '-' }
    $rows += [pscustomobject]@{ Field = $f; Value = $val }
}
$rows | Format-Table -AutoSize

$io  = ($rows | Where-Object { $_.Field -eq 'Replica_IO_Running' }).Value
$sql = ($rows | Where-Object { $_.Field -eq 'Replica_SQL_Running' }).Value
if ($io -ne 'Yes' -or $sql -ne 'Yes') {
    Write-Host "  สายไม่ทำงาน — ดู Last_IO_Error / Last_SQL_Error ข้างบน" -ForegroundColor Red
    exit 1
}

Write-Host "=== จำนวนแถวสองฝั่ง ===" -ForegroundColor Cyan
foreach ($t in 'tbl_keyone', 'tblscale', 'tblproduct_detail') {
    $a = (My $SRC "SELECT COUNT(*) FROM db_truckscale.$t").Trim()
    $b = (My $REP "SELECT COUNT(*) FROM db_truckscale.$t").Trim()
    $mark = if ($a -eq $b) { 'ตรง' } else { 'ต่าง' }
    "{0,-20} source={1,-10} replica={2,-10} {3}" -f $t, $a, $b, $mark | Write-Host
}

if ($SkipWriteTest) { return }

Write-Host "`n=== ทดสอบเขียนจริง ===" -ForegroundColor Cyan
$tag = "REPL-CHK-" + (Get-Date -Format 'HHmmss')
try {
    My $SRC "INSERT INTO db_truckscale.tbl_keyone (one_cus_name, one_car_regis, one_des, one_w_type, one_datetime) VALUES ('$tag','$tag','ทดสอบการไหล','ชั่งจ่าย',DATE_FORMAT(NOW(),'%Y-%m-%d %H:%i:%s'));" | Out-Null
} catch {
    Write-Host "  เขียนไม่ได้ (คอลัมน์ไม่ตรง schema): $($_.Exception.Message)" -ForegroundColor Yellow
    return
}
Write-Host "  เขียนที่ source: $tag"

$found = $false
foreach ($i in 1..15) {
    Start-Sleep -Milliseconds 700
    $n = (My $REP "SELECT COUNT(*) FROM db_truckscale.tbl_keyone WHERE one_cus_name='$tag';").Trim()
    if ($n -eq '1') { $found = $true; Write-Host "  โผล่ที่ replica ใน ~$([math]::Round($i*0.7,1)) วินาที" -ForegroundColor Green; break }
}
if (-not $found) { Write-Host "  ไม่โผล่ที่ replica ภายใน 10 วินาที" -ForegroundColor Red; exit 1 }

Write-Host "`nสรุป: replication ทำงานถูกต้อง" -ForegroundColor Green
