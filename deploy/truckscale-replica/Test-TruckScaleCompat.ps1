<#
.SYNOPSIS
    ตรวจว่าฐานข้อมูลปลายทางรองรับ TruckScale ได้จริง โดยไม่ต้องรันตัวโปรแกรม

.DESCRIPTION
    ปัญหา: จะพิสูจน์ว่าย้ายฐานแล้วโปรแกรมยังทำงาน ต้องรัน WorldFerth.exe
    ซึ่งต้องมี .NET 3.5 + Crystal Reports runtime และต้องมีคนกดใช้งานจริงทุกหน้าจอ
    เครื่องพัฒนาไม่มีทั้งสองอย่าง และการกดเองก็ทดสอบได้ไม่ครบอยู่ดี

    วิธีนี้แทนได้ดีกว่า: **ดึงคำสั่ง SQL ทุกคำสั่งที่ฝังอยู่ในไบนารีออกมา
    แล้วให้ MySQL ปลายทางตรวจทีละคำสั่งด้วย EXPLAIN**

    EXPLAIN ทำให้ MySQL แจงไวยากรณ์ ตรวจว่าตารางมีจริง คอลัมน์มีจริง ชนิดเข้ากันได้
    **โดยไม่รันคำสั่งนั้นจริง** — ปลอดภัยพอที่จะยิงใส่ฐานที่มีข้อมูลจริงได้
    ครอบคลุมกว่าการกดหน้าจอ เพราะได้ทุกคำสั่ง รวมหน้าจอที่นาน ๆ ใช้ที

    สิ่งที่วิธีนี้ **ไม่** ครอบคลุม: การจัดหน้า Crystal Reports · ปุ่มที่เรียกฮาร์ดล็อก ·
    พฤติกรรมตอนเน็ตหลุดกลางคัน — สามอย่างนี้ยังต้องทดสอบกับเครื่องจริงหนึ่งเครื่อง

.PARAMETER Dsn
    ชื่อ ODBC DSN ที่จะทดสอบ (ค่าปริยาย TruckScales)

.PARAMETER ExePath
    ที่อยู่ WorldFerth.exe ใช้ดึงทั้ง SQL และบัญชีที่โปรแกรมฝังไว้

.PARAMETER ConnectionString
    ต่อฐานด้วยสตริงนี้แทนการใช้ DSN + บัญชีที่ฝังในโปรแกรม
    มีไว้ตรวจฐานคลาวด์ **ก่อน** สร้างบัญชีที่โปรแกรมต้องใช้
    (การตรวจว่า schema รองรับ กับการตรวจว่าต่อผ่าน DSN ได้ เป็นคนละเรื่องกัน แยกทดสอบได้)
    ตัวอย่าง: -ConnectionString "Driver={MySQL ODBC 8.0 Unicode Driver};SERVER=h;PORT=3306;DATABASE=db;UID=u;PWD=p"

.PARAMETER ShowSql
    แสดงคำสั่งเต็มของทุกข้อ ไม่ใช่เฉพาะข้อที่ไม่ผ่าน

.EXAMPLE
    .\Test-TruckScaleCompat.ps1 -ExePath 'C:\WorldFerth\WorldFerth.exe'

.NOTES
    ต้องมี MySQL Connector/ODBC 32 บิต และตั้ง DSN ไว้แล้ว (ดู Set-TruckScaleDSN.ps1)
#>
[CmdletBinding()]
param(
    [string] $Dsn = 'TruckScales',
    [string] $ExePath,
    [string] $ConnectionString,
    [switch] $ShowSql
)

$ErrorActionPreference = 'Stop'

# ── หา exe ────────────────────────────────────────────────────────────
$candidates = @()
if ($ExePath) { $candidates += $ExePath }
$candidates += @(
    (Join-Path $PSScriptRoot 'WorldFerth.exe'),
    'C:\WorldFerth\WorldFerth.exe',
    'C:\Program Files (x86)\WorldFerth\WorldFerth.exe',
    'C:\TruckScale\WorldFerth.exe'
)
$exe = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $exe) { throw "หา WorldFerth.exe ไม่เจอ — ระบุด้วย -ExePath" }
Write-Host "อ่านคำสั่งจาก $exe" -ForegroundColor Cyan

$bytes = [System.IO.File]::ReadAllBytes($exe)
$text  = [System.Text.Encoding]::Unicode.GetString($bytes)   # สตริง .NET เป็น UTF-16LE

# บัญชีที่โปรแกรมฝังไว้ — ไม่เขียนค่าไว้ในสคริปต์เพราะที่เก็บโค้ดเป็นสาธารณะ
# ช่วงอักขระต้องแคบ ไม่งั้นกินเลยขอบสตริงเข้าไปในสตริงถัดไป (ดู Set-TruckScaleDSN.ps1)
$asciiClass = '[\x20-\x3A\x3C-\x7E]'
$uid = ''; $pwd = ''
if (-not $ConnectionString) {
    $cred = [regex]::Match($text, "DSN=[A-Za-z0-9_]+;UID=($asciiClass{1,64});PWD=($asciiClass{1,64})")
    if (-not $cred.Success) { throw "ดึงบัญชีจากไบนารีไม่ได้ — หรือใช้ -ConnectionString แทน" }
    $uid = $cred.Groups[1].Value
    $pwd = $cred.Groups[2].Value
}

# ── ดึงคำสั่ง SQL ─────────────────────────────────────────────────────
# คำสั่งที่ Crystal สร้างใช้ ODBC escape `{ oj ... }` และยาวเกิน 500 ตัว จึงต้องเผื่อไว้มาก
$sqlPattern = '(?i)\b(?:select|insert\s+into|update|delete\s+from)\b[\x20-\x7e]{5,2000}'
$raw = [regex]::Matches($text, $sqlPattern) |
       ForEach-Object { $_.Value.Trim() } |
       Where-Object {
           # ต้องอ้างถึงตารางจริง ไม่งั้นเป็นข้อความอื่นที่บังเอิญขึ้นต้นด้วยคำเหล่านี้
           # เช่น "update : 21-05-15" ซึ่งเป็นบันทึกรุ่น ไม่ใช่ SQL
           $_ -match '(?i)\b(?:from|into|update)\s+[`\[]?(?:tbl|db_|sequence_)'
       } |
       Sort-Object -Unique

Write-Host "พบคำสั่ง SQL $($raw.Count) คำสั่ง`n" -ForegroundColor Cyan

<#
  คำสั่งในไบนารีส่วนใหญ่ถูกตัดกลางคัน เพราะโปรแกรมต่อค่าเข้าไปตอนรัน
  เช่น  "... WHERE one_num = '"   แล้วค่อยต่อเลขกับ  "'"  ทีหลัง
  ทำให้เอาไป EXPLAIN ตรง ๆ ไม่ได้ ต้องเติมให้เป็นคำสั่งที่สมบูรณ์ก่อน
#>
function Complete-Sql {
    param([string] $Sql)

    $s = $Sql.TrimEnd()

<#
      สตริงสองอันที่วางติดกันในไบนารีถูกจับรวมมาเป็นก้อนเดียวได้ เช่น
        "Delete From "  +  "From tblscale inner join ... WHere ..."
      กลายเป็น "Delete From From tblscale inner join ..." ซึ่งไม่ใช่คำสั่งจริงสักอัน
      MySQL ไม่มีไวยากรณ์ DELETE FROM t1 INNER JOIN t2 อยู่แล้ว ถ้าเจอแบบนี้แปลว่าติดกันมา

      ตัดคำนำหน้าทิ้ง เก็บส่วนที่ยาวกว่าไว้ แล้วเติม SELECT * ให้เป็นคำสั่งที่ตรวจได้
      ถ้าไม่ทำ จะรายงานว่า "ฐานปลายทางรับไม่ได้" ทั้งที่ฐานไม่มีปัญหาเลย
#>
    if ($s -match '(?i)^\s*(?:delete\s+from|select(?:\s+\*)?|update|insert\s+into)\s+(from\s+\S.*)$') {
        $s = 'SELECT * ' + $matches[1]
    }
    $s = $s -replace '(?i)\b(into|where|select)\s+\1\b', '$1'

    # ตัดเศษที่ลงท้ายด้วยตัวดำเนินการค้าง
    $s = $s -replace '(?i)\s+(and|or|where|order\s+by|group\s+by|,|\+)$', ''

    # ปิดเครื่องหมายคำพูดที่ค้าง
    if ((([regex]::Matches($s, "'")).Count) % 2 -eq 1) { $s += "0'" }

    # ลงท้ายด้วยตัวเปรียบเทียบที่ยังไม่มีค่า
    if ($s -match "(=|<>|>=|<=|>|<|\bLIKE\b)\s*$") { $s += " '0'" }

    # INSERT ที่มีรายชื่อคอลัมน์แต่ VALUES ยังไม่ครบ — เติมให้พอดีจำนวนคอลัมน์
    if ($s -match "(?i)^insert\s+into\s+\S+?\s*\(([^)]*)\)") {
        $n = ($matches[1] -split ',').Count
        $s = $s -replace "(?i)\s*values\s*\(.*$", ''
        $s += ' VALUES (' + ((@("'0'") * $n) -join ',') + ')'
    }

    # วงเล็บที่ยังไม่ปิด (คำสั่งถูกตัดกลางคัน)
    $open = ([regex]::Matches($s, '\(')).Count - ([regex]::Matches($s, '\)')).Count
    if ($open -gt 0) { $s += (')' * $open) }
    # ODBC escape ของ Crystal — { oj ... } ต้องมีปีกกาปิด
    $ob = ([regex]::Matches($s, '\{')).Count - ([regex]::Matches($s, '\}')).Count
    if ($ob -gt 0) { $s += (' }' * $ob) }

    return $s
}

<#
  คำสั่งบางอันถูกตัดจนซ่อมไม่ได้ เช่น "insert into tblcustomer" ที่ไม่มีคอลัมน์เลย
  รายงานว่า "ไม่ผ่าน" จะทำให้เข้าใจผิดว่าฐานปลายทางมีปัญหา ทั้งที่เป็นข้อจำกัดของการแกะไบนารี
  จึงแยกออกมาเป็น "ข้ามไป" ต่างหาก
#>
function Test-Repairable {
    param([string] $Sql)
    if ($Sql -match "(?i)^insert\s+into\s+\S+\s*$") { return $false }   # ไม่มีคอลัมน์
    if ($Sql -match "(?i)^update\s+\S+\s*$")        { return $false }   # ไม่มี SET
    if ($Sql.Length -lt 15)                          { return $false }
    return $true
}

# ── ทดสอบด้วย PowerShell 32 บิต (ไดรเวอร์เป็น 32 บิต) ─────────────────
$prepared = $raw | ForEach-Object { Complete-Sql $_ }
$skipped  = @($prepared | Where-Object { -not (Test-Repairable $_) })
$testable = @($prepared | Where-Object { Test-Repairable $_ })
if ($skipped.Count) {
    Write-Host "ข้ามไป $($skipped.Count) คำสั่ง — ถูกตัดในไบนารีจนซ่อมไม่ได้ ไม่ใช่ปัญหาของฐาน" -ForegroundColor DarkGray
    foreach ($s in $skipped) { Write-Host "   $s" -ForegroundColor DarkGray }
    Write-Host ''
}

$cs = if ($ConnectionString) { $ConnectionString } else { "DSN=$Dsn;UID=$uid;PWD=$pwd" }
$payload = [ordered]@{ Cs = $cs; Sql = @($testable) }
$jsonIn  = Join-Path $env:TEMP ("tscompat-in-{0}.json" -f [guid]::NewGuid())
$jsonOut = Join-Path $env:TEMP ("tscompat-out-{0}.json" -f [guid]::NewGuid())
[System.IO.File]::WriteAllText($jsonIn, ($payload | ConvertTo-Json -Depth 4 -Compress), [System.Text.UTF8Encoding]::new($false))

# สคริปต์ลูกต้องเป็น ASCII ล้วน — PowerShell 5.1 อ่านไฟล์ไม่มี BOM เป็น ANSI แล้วภาษาไทยพัง
$probe = @'
$ErrorActionPreference = "Stop"
$in  = Get-Content -Raw -Encoding UTF8 $args[0] | ConvertFrom-Json
$res = @()
$c = New-Object System.Data.Odbc.OdbcConnection($in.Cs)
$c.Open()
foreach ($s in $in.Sql) {
  $r = [ordered]@{ sql = $s; ok = $false; err = "" }
  try {
    $cmd = $c.CreateCommand()
    # EXPLAIN แจงและตรวจ schema โดยไม่รันคำสั่งจริง
    $cmd.CommandText = "EXPLAIN " + $s
    $cmd.CommandTimeout = 20
    [void]$cmd.ExecuteReader().Close()
    $r.ok = $true
  } catch {
    $r.err = ($_.Exception.Message -replace "`r?`n", " ")
  }
  $res += [pscustomobject]$r
}
$c.Close()
$res | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 $args[1]
'@
$probeFile = Join-Path $env:TEMP ("tscompat-{0}.ps1" -f [guid]::NewGuid())
[System.IO.File]::WriteAllText($probeFile, $probe, [System.Text.Encoding]::ASCII)

$ps32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path $ps32)) { $ps32 = (Get-Process -Id $PID).Path }

try {
    $err = & $ps32 -NoProfile -ExecutionPolicy Bypass -File $probeFile $jsonIn $jsonOut 2>&1 | Out-String
    if (-not (Test-Path $jsonOut)) { throw "ทดสอบไม่สำเร็จ: $($err.Trim())" }
    $results = Get-Content -Raw -Encoding UTF8 $jsonOut | ConvertFrom-Json
} finally {
    Remove-Item $probeFile, $jsonIn, $jsonOut -ErrorAction SilentlyContinue
}

# ── สรุปผล ────────────────────────────────────────────────────────────
$pass = @($results | Where-Object { $_.ok })
$fail = @($results | Where-Object { -not $_.ok })

if ($ShowSql) {
    foreach ($r in $results) {
        $mark = if ($r.ok) { '[ok] ' } else { '[x]  ' }
        $col  = if ($r.ok) { 'DarkGray' } else { 'Red' }
        Write-Host ($mark + $r.sql) -ForegroundColor $col
    }
    Write-Host ''
}

Write-Host ("ผ่าน {0} · ไม่ผ่าน {1} · รวม {2}" -f $pass.Count, $fail.Count, $results.Count) `
    -ForegroundColor $(if ($fail.Count) { 'Yellow' } else { 'Green' })

if ($fail.Count) {
    Write-Host "`nคำสั่งที่ฐานปลายทางรับไม่ได้" -ForegroundColor Red
    foreach ($r in $fail) {
        Write-Host "  $($r.sql)" -ForegroundColor Red
        Write-Host "     $($r.err)" -ForegroundColor DarkGray
    }
    Write-Host @"

อ่านผลอย่างไร
  ตาราง/คอลัมน์ไม่มี  = ฐานปลายทางยังไม่ครบ ย้ายข้อมูลไม่สมบูรณ์ **ต้องแก้ก่อนใช้งาน**
  ไวยากรณ์ผิด        = มักเป็นเพราะสคริปต์เติมคำสั่งที่ถูกตัดกลางคันได้ไม่ตรง
                       ดูคำสั่งที่พิมพ์ออกมา ถ้าดูแปลก ๆ ก็ข้ามไปได้
"@ -ForegroundColor Yellow
    exit 1
}

Write-Host "`nฐานปลายทางรองรับทุกคำสั่งที่โปรแกรมใช้" -ForegroundColor Green
Write-Host "ยังเหลือที่ต้องลองกับเครื่องจริง: การพิมพ์รายงาน Crystal · ฮาร์ดล็อก · พฤติกรรมตอนเน็ตหลุด" -ForegroundColor DarkGray
