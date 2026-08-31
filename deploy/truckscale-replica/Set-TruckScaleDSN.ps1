<#
.SYNOPSIS
    ย้าย TruckScale ไปใช้ MySQL เครื่องอื่น โดยแก้เฉพาะ ODBC DSN ไม่แตะตัวโปรแกรม

.DESCRIPTION
    WorldFerth.exe ต่อฐานข้อมูลด้วยสตริงที่ฝังไว้ในไบนารีสองเส้น รูปแบบ

        DSN=TruckScales;UID=<ผู้ใช้>;PWD=<รหัส>
        DSN=TruckScaleV5_Backup;UID=<ผู้ใช้>;PWD=<รหัส>

    สคริปต์อ่านค่า UID/PWD จริงออกจากไบนารีตอนรัน ไม่เขียนไว้ในไฟล์นี้
    เพราะที่เก็บโค้ดเป็นสาธารณะ (ดู -ExePath)

    ตรวจไบนารีแล้วยืนยันว่า **ไม่มี IP หรือชื่อโฮสต์อยู่ในโปรแกรมเลย** และโปรแกรม
    เรียกใช้ System.Data.Odbc อย่างเดียว ไม่มี MySQL connector ตัวอื่น
    แปลว่าปลายทางฐานข้อมูลถูกกำหนดโดย DSN ของ Windows ล้วน ๆ
    เปลี่ยน DSN = ย้ายฐานข้อมูล โดยไม่ต้องแก้ source หรือ config ของ TruckScale

    สคริปต์นี้สำรองค่าเดิมไว้ก่อนเสมอ และมี -Restore ให้ถอยกลับได้

.PARAMETER Server
    โฮสต์ MySQL ปลายทาง เช่น db.example.com หรือ 203.0.113.10

.PARAMETER Port
    พอร์ต MySQL ปลายทาง (ค่าปริยาย 3306)

.PARAMETER Database
    ชื่อฐานข้อมูล (ค่าปริยาย db_truckscale)

.PARAMETER DsnName
    ชื่อ DSN ที่จะแก้ ค่าปริยายคือทั้งสองเส้นที่โปรแกรมใช้

.PARAMETER Scope
    User = เขียนที่ HKCU (ไม่ต้องสิทธิ์ผู้ดูแล มีผลเฉพาะผู้ใช้ที่ล็อกอินอยู่)
    Machine = เขียนที่ HKLM\SOFTWARE\WOW6432Node (ต้องรันแบบผู้ดูแล มีผลทุกผู้ใช้)

.PARAMETER ExePath
    ที่อยู่ของ WorldFerth.exe ใช้อ่าน UID/PWD ที่โปรแกรมฝังไว้
    ไม่ระบุก็ได้ สคริปต์จะหาจากที่ที่มักติดตั้งไว้ให้เอง
    หาไม่เจอจริง ๆ ให้ตั้ง $env:TRUCKSCALE_UID และ $env:TRUCKSCALE_PWD ก่อนรันแทน

.PARAMETER Charset
    ชุดอักขระของการเชื่อมต่อ
    ค่าปริยาย auto = ถ้าเครื่องนี้มี DSN เดิมอยู่แล้วให้ใช้ค่าเดิม ไม่มีค่าเดิมจึงใช้ utf8
    (ตาราง TruckScale เป็น utf8mb3_bin ตรวจแล้วจากฐานจริง ไม่ใช่ tis620)
    ตั้งผิดแล้วภาษาไทยจะเพี้ยนทั้งระบบ จึงยึดค่าเดิมของเครื่องเป็นหลัก

.PARAMETER NoSsl
    ไม่บังคับ SSL ใช้เฉพาะตอนต่อฐานในวงแลนเท่านั้น
    ถ้าปลายทางอยู่บนอินเทอร์เน็ต **ห้ามใช้** เพราะรหัสผ่านที่โปรแกรมฝังไว้อ่อนมาก

.PARAMETER Restore
    คืนค่า DSN จากไฟล์สำรองล่าสุด

.PARAMETER TestOnly
    ทดสอบ DSN ที่มีอยู่ ไม่แก้อะไร

.EXAMPLE
    .\Set-TruckScaleDSN.ps1 -Server ts.worldfert.example -Port 3306 -Scope Machine

.EXAMPLE
    .\Set-TruckScaleDSN.ps1 -TestOnly

.EXAMPLE
    .\Set-TruckScaleDSN.ps1 -Restore

.NOTES
    ต้องติดตั้ง MySQL Connector/ODBC **แบบ 32 บิต** ก่อน เพราะ WorldFerth.exe เป็น x86
    ตัว 64 บิตใช้ไม่ได้ แม้ Windows จะเป็น 64 บิตก็ตาม
    ดาวน์โหลด: https://dev.mysql.com/downloads/connector/odbc/  (เลือก Windows x86 32-bit)
#>
[CmdletBinding(DefaultParameterSetName = 'Set')]
param(
    [Parameter(ParameterSetName = 'Set', Mandatory = $true)]
    [string] $Server,

    [Parameter(ParameterSetName = 'Set')]
    [int] $Port = 3306,

    [Parameter(ParameterSetName = 'Set')]
    [string] $Database = 'db_truckscale',

    [string[]] $DsnName = @('TruckScales', 'TruckScaleV5_Backup'),

    [ValidateSet('User', 'Machine')]
    [string] $Scope = 'User',

    [string] $ExePath,

    [Parameter(ParameterSetName = 'Set')]
    [string] $Charset = 'auto',

    [Parameter(ParameterSetName = 'Set')]
    [switch] $NoSsl,

    [Parameter(ParameterSetName = 'Restore')]
    [switch] $Restore,

    [Parameter(ParameterSetName = 'Test')]
    [switch] $TestOnly
)

$ErrorActionPreference = 'Stop'

function Get-EmbeddedCredential {
    <#
      อ่าน UID/PWD ที่ฝังอยู่ในไบนารีของ TruckScale ออกมาตอนรัน
      ไม่เขียนค่าจริงไว้ในสคริปต์ เพราะ repo นี้เป็นสาธารณะ

      สตริงใน .NET เก็บเป็น UTF-16LE จึงแปลงทั้งไฟล์เป็น Unicode แล้วค่อยค้น
      รูปแบบที่มองหา:  DSN=<ชื่อ>;UID=<ผู้ใช้>;PWD=<รหัส>

      ช่วงอักขระต้องคุมให้แคบ: สตริงใน #US heap ของ .NET ไม่ได้ปิดท้ายด้วย NUL
      แต่ต่อด้วยตัวนับความยาวของสตริงถัดไป ซึ่งอ่านเป็น UTF-16 แล้วได้อักขระนอกช่วง ASCII
      ถ้าใช้ [^;\x00] จะกินเลยขอบเข้าไปในสตริงถัดไป (เคยได้รหัสยาว 64 ตัวแทนที่จะเป็น 6)
      จึงจำกัดไว้ที่ ASCII ที่พิมพ์ได้และไม่ใช่ ';' — ตัวนับความยาวจะหยุดการจับให้เอง
    #>
    param([string] $ExePath)

    if (-not (Test-Path $ExePath)) { return $null }
    $bytes = [System.IO.File]::ReadAllBytes($ExePath)
    $text  = [System.Text.Encoding]::Unicode.GetString($bytes)
    $ascii = '[\x20-\x3A\x3C-\x7E]'   # ' '..'~' ยกเว้น ';'
    $m = [regex]::Match($text, "DSN=[A-Za-z0-9_]+;UID=($ascii{1,64});PWD=($ascii{1,64})")
    if (-not $m.Success) { return $null }
    [pscustomobject]@{ Uid = $m.Groups[1].Value; Pwd = $m.Groups[2].Value; Source = $ExePath }
}

function Resolve-EmbeddedCredential {
    param([string] $ExePath)

    # 1. ระบุไฟล์มาเอง หรือหาจากที่ที่มักติดตั้งไว้
    $candidates = @()
    if ($ExePath) { $candidates += $ExePath }
    $candidates += @(
        (Join-Path $PSScriptRoot 'WorldFerth.exe'),
        'C:\WorldFerth\WorldFerth.exe',
        'C:\Program Files (x86)\WorldFerth\WorldFerth.exe',
        'C:\TruckScale\WorldFerth.exe',
        'D:\WorldFerth\WorldFerth.exe'
    )
    foreach ($c in $candidates) {
        $cred = Get-EmbeddedCredential $c
        if ($cred) {
            Write-Host "อ่านบัญชีที่โปรแกรมใช้จาก $($cred.Source)" -ForegroundColor DarkGray
            return $cred
        }
    }

    # 2. ให้ตั้งผ่านตัวแปรสภาพแวดล้อมได้ เผื่อหาไฟล์ไม่เจอ
    if ($env:TRUCKSCALE_UID -and $env:TRUCKSCALE_PWD) {
        Write-Host "ใช้บัญชีจากตัวแปรสภาพแวดล้อม TRUCKSCALE_UID/TRUCKSCALE_PWD" -ForegroundColor DarkGray
        return [pscustomobject]@{ Uid = $env:TRUCKSCALE_UID; Pwd = $env:TRUCKSCALE_PWD; Source = 'environment' }
    }

    throw @"
หาบัญชีที่ TruckScale ใช้ไม่เจอ

สคริปต์นี้ต้องส่งสตริงเดียวกับที่ WorldFerth.exe ใช้ทุกตัวอักษร ไม่งั้นทดสอบไม่ตรงของจริง
ค่านั้นฝังอยู่ในไบนารี ไม่ได้เขียนไว้ในสคริปต์ เพราะที่เก็บโค้ดนี้เป็นสาธารณะ

เลือกทางใดทางหนึ่ง
  ก. ชี้ไฟล์ให้ถูก      .\Set-TruckScaleDSN.ps1 -ExePath 'D:\path\WorldFerth.exe' ...
  ข. ตั้งตัวแปรก่อนรัน   `$env:TRUCKSCALE_UID='...'; `$env:TRUCKSCALE_PWD='...'
"@
}

# สตริงในโปรแกรม **ทับ** ค่า UID/PWD ที่ตั้งไว้ใน DSN (ทดสอบยืนยันแล้ว)
# ฐานปลายทางจึงต้องมีบัญชีนี้จริง ดูวิธีลดความเสี่ยงใน Harden-CloudMySQL.sql
# หาเมื่อจำเป็นเท่านั้น — -Restore ไม่ต้องต่อฐาน จึงไม่ควรบังคับให้หาไฟล์ exe ให้เจอก่อน
$EmbeddedUid = $null
$EmbeddedPwd = $null
if (-not $Restore) {
    $cred = Resolve-EmbeddedCredential -ExePath $ExePath
    $EmbeddedUid = $cred.Uid
    $EmbeddedPwd = $cred.Pwd
}

# สำรองแบบประทับเวลา ไม่ทับของเดิม เพราะถ้ารันสคริปต์ซ้ำแล้วไฟล์เดียวถูกทับ
# จะถอยกลับไปสภาพ "ก่อนย้ายครั้งแรก" ไม่ได้อีกเลย ซึ่งเป็นสภาพที่คนถอยกลับต้องการจริง ๆ
$BackupDir = Join-Path $PSScriptRoot 'dsn-backup'

function Get-OdbcRoot {
    param([string] $Scope)
    if ($Scope -eq 'Machine') {
        # DSN 32 บิตบน Windows 64 บิตอยู่ใต้ WOW6432Node เสมอ
        'HKLM:\SOFTWARE\WOW6432Node\ODBC\ODBC.INI'
    } else {
        # HKCU\Software\ODBC ไม่ถูก redirect ตัวไดรเวอร์เป็นตัวกำหนดบิต
        'HKCU:\SOFTWARE\ODBC\ODBC.INI'
    }
}

function Find-MySqlOdbcDriver32 {
    # หาไดรเวอร์ 32 บิตที่ลงไว้จริง และตรวจว่าไฟล์ dll มีอยู่
    $key = 'HKLM:\SOFTWARE\WOW6432Node\ODBC\ODBCINST.INI'
    if (-not (Test-Path $key)) { return $null }
    $names = (Get-ItemProperty (Join-Path $key 'ODBC Drivers') -ErrorAction SilentlyContinue).PSObject.Properties |
             Where-Object { $_.Name -like 'MySQL*' -and $_.Value -eq 'Installed' } |
             Select-Object -ExpandProperty Name
    foreach ($n in @($names | Sort-Object -Descending)) {
        $dll = (Get-ItemProperty (Join-Path $key $n) -ErrorAction SilentlyContinue).Driver
        if ($dll -and (Test-Path $dll)) {
            return [pscustomobject]@{ Name = $n; Dll = $dll }
        }
    }
    return $null
}

function Test-Dsn {
    <# ทดสอบด้วย PowerShell 32 บิต เพราะไดรเวอร์เป็น 32 บิต
       และใช้สตริงเดียวกับที่ WorldFerth.exe ใช้ทุกตัวอักษร #>
    param([string] $Dsn)

    $probe = @"
`$cs = "DSN=$Dsn;UID=$EmbeddedUid;PWD=$EmbeddedPwd"
try {
  `$c = New-Object System.Data.Odbc.OdbcConnection(`$cs)
  `$c.ConnectionTimeout = 15
  `$c.Open()
  `$cmd = `$c.CreateCommand()
  `$cmd.CommandText = "SELECT CONCAT(VERSION(),'|',DATABASE(),'|',CURRENT_USER(),'|',IFNULL((SELECT VARIABLE_VALUE FROM performance_schema.session_status WHERE VARIABLE_NAME='Ssl_cipher'),''))"
  "OK`t" + `$cmd.ExecuteScalar()
  `$c.Close()
} catch { "ERR`t" + (`$_.Exception.Message -replace "``r?``n"," ") }
"@
    $tmp = Join-Path $env:TEMP ("dsnprobe-{0}.ps1" -f [guid]::NewGuid())
    # ASCII เท่านั้น: PowerShell 5.1 อ่านไฟล์ไม่มี BOM เป็น ANSI ทำให้ตัวอักษรไทยพัง
    [System.IO.File]::WriteAllText($tmp, $probe, [System.Text.Encoding]::ASCII)
    try {
        $ps32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
        if (-not (Test-Path $ps32)) { $ps32 = (Get-Process -Id $PID).Path }  # Windows 32 บิต
        $out = & $ps32 -NoProfile -ExecutionPolicy Bypass -File $tmp 2>&1 | Out-String
    } finally {
        Remove-Item $tmp -ErrorAction SilentlyContinue
    }

    $line = ($out -split "`r?`n" | Where-Object { $_ -match '^(OK|ERR)\t' } | Select-Object -First 1)
    if (-not $line) { return [pscustomobject]@{ Ok = $false; Detail = $out.Trim() } }
    $parts = $line -split "`t", 2
    if ($parts[0] -eq 'OK') {
        $f = $parts[1] -split '\|'
        return [pscustomobject]@{
            Ok = $true; Version = $f[0]; Database = $f[1]; User = $f[2]
            Ssl = if ($f[3]) { $f[3] } else { '(ไม่เข้ารหัส)' }
        }
    }
    return [pscustomobject]@{ Ok = $false; Detail = $parts[1] }
}

function Show-TestResult {
    param([string] $Dsn, $Result)
    if ($Result.Ok) {
        Write-Host ("  [ok] {0} -> MySQL {1} · db={2} · user={3} · ssl={4}" -f `
            $Dsn, $Result.Version, $Result.Database, $Result.User, $Result.Ssl) -ForegroundColor Green
    } else {
        Write-Host ("  [x]  {0} -> {1}" -f $Dsn, $Result.Detail) -ForegroundColor Red
    }
    return $Result.Ok
}

# ---------------------------------------------------------------- ทดสอบอย่างเดียว
if ($TestOnly) {
    Write-Host "`nทดสอบ DSN ที่ตั้งไว้ (ใช้สตริงเดียวกับ WorldFerth.exe)" -ForegroundColor Cyan
    $root = Get-OdbcRoot $Scope
    $any = $false
    foreach ($d in $DsnName) {
        if (-not (Test-Path (Join-Path $root $d))) {
            Write-Host ("  [-]  {0} -> ยังไม่มี DSN นี้ใน {1}" -f $d, $Scope) -ForegroundColor DarkGray
            continue
        }
        $any = $true
        $p = Get-ItemProperty (Join-Path $root $d)
        Write-Host ("  ชี้ไปที่ {0}:{1}/{2}" -f $p.SERVER, $p.PORT, $p.DATABASE) -ForegroundColor DarkGray
        [void](Show-TestResult $d (Test-Dsn $d))
    }
    if (-not $any) { Write-Host "  ไม่พบ DSN เลย ใช้ -Server เพื่อสร้าง" -ForegroundColor Yellow }
    return
}

# ---------------------------------------------------------------------- ถอยกลับ
if ($Restore) {
    $files = @(Get-ChildItem (Join-Path $BackupDir '*.json') -ErrorAction SilentlyContinue | Sort-Object Name)
    if ($files.Count -eq 0) { throw "ไม่พบไฟล์สำรองใน $BackupDir" }
    # ใช้ไฟล์ **เก่าที่สุด** = สภาพก่อนสคริปต์นี้แตะเครื่องเป็นครั้งแรก
    # คนที่สั่งถอยกลับต้องการสภาพเดิมของเครื่อง ไม่ใช่ผลของการรันรอบก่อนหน้า
    $file = $files[0]
    $backup = Get-Content $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Host "`nคืนค่า DSN จากไฟล์สำรองแรกสุด เมื่อ $($backup.SavedAt)" -ForegroundColor Cyan
    Write-Host "  $($file.Name)" -ForegroundColor DarkGray
    if ($files.Count -gt 1) {
        Write-Host "  (มีไฟล์สำรองทั้งหมด $($files.Count) ไฟล์ใน $BackupDir)" -ForegroundColor DarkGray
    }
    foreach ($entry in $backup.Entries) {
        $key = Join-Path $entry.Root $entry.Dsn
        if ($null -eq $entry.Values) {
            # เดิมไม่มี DSN นี้ ลบทิ้งให้เหมือนเดิม
            Remove-Item $key -Recurse -Force -ErrorAction SilentlyContinue
            Remove-ItemProperty (Join-Path $entry.Root 'ODBC Data Sources') -Name $entry.Dsn -ErrorAction SilentlyContinue
            Write-Host "  ลบ $($entry.Dsn) (เดิมไม่มี)" -ForegroundColor Yellow
            continue
        }
        Remove-Item $key -Recurse -Force -ErrorAction SilentlyContinue
        New-Item $key -Force | Out-Null
        foreach ($p in $entry.Values.PSObject.Properties) {
            New-ItemProperty $key -Name $p.Name -Value $p.Value -PropertyType String -Force | Out-Null
        }
        Set-ItemProperty (Join-Path $entry.Root 'ODBC Data Sources') -Name $entry.Dsn -Value $entry.DriverName
        Write-Host "  คืนค่า $($entry.Dsn) -> $($entry.Values.SERVER):$($entry.Values.PORT)" -ForegroundColor Green
    }
    Write-Host "`nเสร็จแล้ว ลองรัน -TestOnly เพื่อตรวจ" -ForegroundColor Cyan
    return
}

# ------------------------------------------------------------------------- ตั้งค่า
function Get-ExistingDriver32 {
    <# ถ้าเครื่องนี้ตั้ง DSN ไว้อยู่แล้ว ให้ใช้ไดรเวอร์ตัวเดิมต่อ
       การย้ายฐานไม่ควรสลับ ANSI/Unicode ไปด้วย เพราะกระทบการแปลงอักขระ #>
    param([string] $Root, [string[]] $Names)
    $sources = Join-Path $Root 'ODBC Data Sources'
    foreach ($n in $Names) {
        $key = Join-Path $Root $n
        if (-not (Test-Path $key)) { continue }
        $dll  = (Get-ItemProperty $key -ErrorAction SilentlyContinue).Driver
        $name = (Get-ItemProperty $sources -ErrorAction SilentlyContinue).$n
        if ($dll -and $name -and (Test-Path $dll)) {
            return [pscustomobject]@{ Name = $name; Dll = $dll }
        }
    }
    return $null
}

$driver = Get-ExistingDriver32 -Root (Get-OdbcRoot $Scope) -Names $DsnName
if ($driver) {
    Write-Host "`nคงไดรเวอร์เดิมของเครื่องนี้ไว้" -ForegroundColor DarkGray
} else {
    $driver = Find-MySqlOdbcDriver32
}
if (-not $driver) {
    throw @"
ไม่พบ MySQL Connector/ODBC แบบ 32 บิตบนเครื่องนี้
WorldFerth.exe เป็นโปรแกรม 32 บิต จึงใช้ไดรเวอร์ 64 บิตไม่ได้
ติดตั้งจาก https://dev.mysql.com/downloads/connector/odbc/ (เลือก Windows x86 32-bit) แล้วรันใหม่
"@
}
Write-Host "`nไดรเวอร์ 32 บิตที่จะใช้: $($driver.Name)" -ForegroundColor Cyan
Write-Host "  $($driver.Dll)" -ForegroundColor DarkGray

if ($Scope -eq 'Machine') {
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
               ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) { throw "-Scope Machine ต้องเปิด PowerShell แบบ Run as administrator" }
}

$root = Get-OdbcRoot $Scope
$sourcesKey = Join-Path $root 'ODBC Data Sources'
if (-not (Test-Path $sourcesKey)) { New-Item $sourcesKey -Force | Out-Null }

# สำรองก่อนเสมอ — รวมกรณีที่ยังไม่มี DSN (บันทึกเป็น null เพื่อให้ -Restore ลบทิ้งได้ถูก)
$entries = @()
foreach ($d in $DsnName) {
    $key = Join-Path $root $d
    if (Test-Path $key) {
        $vals = Get-ItemProperty $key | Select-Object * -ExcludeProperty PS*
        $drv  = (Get-ItemProperty $sourcesKey -ErrorAction SilentlyContinue).$d
        $entries += [pscustomobject]@{ Root = $root; Dsn = $d; Values = $vals; DriverName = $drv }
    } else {
        $entries += [pscustomobject]@{ Root = $root; Dsn = $d; Values = $null; DriverName = $null }
    }
}
if (-not (Test-Path $BackupDir)) { New-Item $BackupDir -ItemType Directory -Force | Out-Null }
$backupFile = Join-Path $BackupDir ("{0}-{1}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $Scope.ToLower())
@{ SavedAt = (Get-Date).ToString('s'); Scope = $Scope; Entries = $entries } |
    ConvertTo-Json -Depth 6 | Set-Content $backupFile -Encoding UTF8
Write-Host "สำรองค่าเดิมไว้ที่ $backupFile" -ForegroundColor DarkGray

# ชุดอักขระ: ยึดค่าที่เครื่องนี้ใช้อยู่เดิมเป็นหลัก การย้ายฐานไม่ควรเปลี่ยนการตีความอักขระไปด้วย
# ไม่มีค่าเดิมจึงใช้ utf8 ให้ตรงกับ collation จริงของตาราง (utf8mb3_bin)
$effectiveCharset = $Charset
if ($Charset -eq 'auto') {
    $prior = $entries | Where-Object { $_.Values -and $_.Values.CHARSET } | Select-Object -First 1
    if ($prior) {
        $effectiveCharset = $prior.Values.CHARSET
        Write-Host "ใช้ CHARSET เดิมของเครื่องนี้: $effectiveCharset" -ForegroundColor DarkGray
    } else {
        $effectiveCharset = 'utf8'
        Write-Host "ไม่มี DSN เดิม ใช้ CHARSET=utf8 (ตรงกับ collation ของตาราง)" -ForegroundColor DarkGray
    }
}

$settings = [ordered]@{
    Driver                = $driver.Dll
    SERVER                = $Server
    PORT                  = [string] $Port
    DATABASE              = $Database
    UID                   = $EmbeddedUid
    # ไม่เขียน PWD ลง DSN โดยตั้งใจ — สตริงในโปรแกรมทับอยู่แล้ว
    # เขียนไปก็ไม่มีผล แถมเป็นการทิ้งรหัสผ่านไว้ในรีจิสทรีเปล่า ๆ
    CHARSET               = $effectiveCharset
    GET_SERVER_PUBLIC_KEY = '1'
    SSLMODE               = $(if ($NoSsl) { 'DISABLED' } else { 'REQUIRED' })
    DESCRIPTION           = "TruckScale -> $Server`:$Port ตั้งโดย Set-TruckScaleDSN.ps1"
}

Write-Host "`nตั้งค่า DSN ($Scope)" -ForegroundColor Cyan
foreach ($d in $DsnName) {
    $key = Join-Path $root $d
    if (-not (Test-Path $key)) { New-Item $key -Force | Out-Null }
    foreach ($k in $settings.Keys) {
        New-ItemProperty $key -Name $k -Value $settings[$k] -PropertyType String -Force | Out-Null
    }
    Set-ItemProperty $sourcesKey -Name $d -Value $driver.Name
    Write-Host ("  {0} -> {1}:{2}/{3}  ssl={4}  charset={5}" -f `
        $d, $Server, $Port, $Database, $settings.SSLMODE, $settings.CHARSET)
}

if ($NoSsl) {
    Write-Host "`nคำเตือน: ปิด SSL อยู่ ใช้ได้เฉพาะฐานในวงแลน" -ForegroundColor Yellow
    Write-Host "รหัสผ่านที่โปรแกรมฝังไว้อ่อนมาก ห้ามส่งข้ามอินเทอร์เน็ตแบบไม่เข้ารหัส" -ForegroundColor Yellow
}

Write-Host "`nทดสอบการเชื่อมต่อ" -ForegroundColor Cyan
$allOk = $true
foreach ($d in $DsnName) { if (-not (Show-TestResult $d (Test-Dsn $d))) { $allOk = $false } }

if ($allOk) {
    Write-Host "`nพร้อมใช้งาน เปิด WorldFerth.exe ได้เลย" -ForegroundColor Green
} else {
    Write-Host "`nยังต่อไม่ได้ ตรวจตามลำดับนี้" -ForegroundColor Yellow
    Write-Host "  1. ฐานปลายทางเปิดพอร์ต $Port ให้ IP ของโรงงานแล้วหรือยัง"
    Write-Host "  2. มีบัญชี '$EmbeddedUid' (รหัสตามที่โปรแกรมฝังไว้) ที่ฐานปลายทางหรือยัง — ดู Harden-CloudMySQL.sql"
    Write-Host "  3. ถ้าบัญชีตั้ง REQUIRE SSL ไว้ ต้องไม่ใช้ -NoSsl"
    Write-Host "  ถอยกลับค่าเดิมได้ด้วย  .\Set-TruckScaleDSN.ps1 -Restore" -ForegroundColor DarkGray
}
