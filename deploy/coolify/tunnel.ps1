<#
  tunnel.ps1 - เปิด SSH tunnel จาก PC (Windows) ไปยัง DB บน VM (Coolify/Hetzner)
  ---------------------------------------------------------------------------
  DB ไม่ได้เปิดสู่อินเทอร์เน็ต (ผูกกับ 127.0.0.1 ของ VM เท่านั้น)
  สคริปต์นี้ forward พอร์ตมาที่เครื่องคุณ เพื่อให้ SSMS / DBeaver ต่อได้

  วิธีใช้ที่ง่ายที่สุด: ดับเบิลคลิก tunnel.bat

  หรือสั่งเองจาก PowerShell:
    .\tunnel.ps1
    .\tunnel.ps1 -ServerIp 1.2.3.4 -KeyFile C:\path\to\key

  *** ห้ามเปิดหน้าต่างแบบ "Run as administrator" ***
  ssh บน Windows จะ bind พอร์ต loopback ไม่ได้เมื่อยกสิทธิ์
  จะขึ้น: bind [127.0.0.1]:14330: Permission denied
  (port forwarding ที่พอร์ตมากกว่า 1024 ไม่ต้องใช้สิทธิ์ admin อยู่แล้ว)

  ปิด tunnel: Ctrl+C หรือปิดหน้าต่าง

  หมายเหตุสำหรับผู้แก้ไฟล์นี้:
    - บันทึกเป็น UTF-8 with BOM เสมอ ไม่งั้น powershell.exe 5.1 อ่านภาษาไทยเพี้ยน
    - ถ้าใช้ here-string ตัวปิด "@ ต้องอยู่คอลัมน์ 0
#>
param(
  [string] $ServerIp       = "178.104.120.21",
  [string] $User           = "root",
  [string] $KeyFile        = "$env:USERPROFILE\.ssh\wf-key",
  [int]    $LocalMssqlPort = 14330,
  [int]    $LocalMysqlPort = 33060
)

$ErrorActionPreference = "Stop"

# บังคับ console เป็น UTF-8 ไม่งั้นภาษาไทยกลายเป็น ??? บน powershell.exe 5.1
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Write-Fail {
  param([string] $Message, [string[]] $Hints)
  Write-Host ""
  Write-Host "  [X] $Message" -ForegroundColor Red
  foreach ($h in $Hints) { Write-Host "      $h" -ForegroundColor Yellow }
  Write-Host ""
  Read-Host "กด Enter เพื่อปิด"
  exit 1
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  WF SSH Tunnel  ->  $ServerIp" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# --- 1) ห้ามยกสิทธิ์ (สาเหตุอันดับ 1 ของ Permission denied) ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
  Write-Fail "หน้าต่างนี้เปิดแบบ Administrator อยู่" @(
    "ssh บน Windows จะ bind พอร์ต loopback ไม่ได้เมื่อยกสิทธิ์",
    "จะขึ้น: bind [127.0.0.1]:$LocalMssqlPort : Permission denied",
    "",
    "วิธีแก้: ปิดหน้าต่างนี้ แล้วเปิดใหม่แบบธรรมดา (ไม่ Run as administrator)",
    "         หรือดับเบิลคลิก tunnel.bat จาก File Explorer"
  )
}

# --- 2) ตรวจ ssh ---
$sshCmd = Get-Command ssh -ErrorAction SilentlyContinue
if (-not $sshCmd) {
  Write-Fail "ไม่พบคำสั่ง ssh" @(
    "ติดตั้ง OpenSSH Client ที่:",
    "Settings - System - Optional features - Add a feature - OpenSSH Client"
  )
}
$ssh = $sshCmd.Source

# --- 3) ตรวจ key + ล็อกสิทธิ์ไฟล์ ---
if (-not (Test-Path $KeyFile)) {
  Write-Fail "ไม่พบไฟล์ key: $KeyFile" @(
    "ระบุเองด้วย:  .\tunnel.ps1 -KeyFile C:\path\to\key"
  )
}
# ssh ปฏิเสธ key ที่สิทธิ์เปิดกว้างเกินไป จึงล็อกให้เฉพาะเจ้าของ
try { icacls $KeyFile /inheritance:r /grant:r "$($env:USERNAME):R" | Out-Null } catch { }

# --- 4) เช็คว่า tunnel เปิดอยู่แล้วหรือยัง ---
$busy = @()
foreach ($p in @($LocalMssqlPort, $LocalMysqlPort)) {
  if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) { $busy += $p }
}
if ($busy.Count -eq 2) {
  Write-Host ""
  Write-Host "  [i] tunnel เปิดอยู่แล้ว (พอร์ต $($busy -join ', ')) - ต่อ SSMS/DBeaver ได้เลย" -ForegroundColor Green
  Write-Host ""
  Read-Host "กด Enter เพื่อปิดหน้าต่างนี้ (tunnel เดิมยังทำงานต่อ)"
  exit 0
}
if ($busy.Count -eq 1) {
  Write-Fail "พอร์ต $($busy[0]) ถูกใช้อยู่" @(
    "อาจมี tunnel เก่าค้าง - ปิดด้วย:",
    "  Get-Process ssh | Stop-Process -Force",
    "หรือเปลี่ยนพอร์ต:",
    "  .\tunnel.ps1 -LocalMssqlPort 15433 -LocalMysqlPort 13306"
  )
}

# --- 5) เปิด tunnel ---
$sshArgs = @(
  "-N",
  "-o", "StrictHostKeyChecking=no",
  "-o", "ServerAliveInterval=30",
  "-o", "ExitOnForwardFailure=yes",
  "-i", $KeyFile,
  # ระบุ 127.0.0.1 ฝั่งซ้ายให้ชัด = bind IPv4 อย่างเดียว แน่นอน
  # (ถ้าปล่อยว่าง ssh อาจ bind แค่ IPv4 แต่ Windows แปลง localhost เป็น ::1 ก่อน
  #  ทำให้ SSMS/ODBC ยิงไป IPv6 แล้วโดนปฏิเสธจนขึ้น error 258 timeout)
  "-L", "127.0.0.1:${LocalMssqlPort}:127.0.0.1:1433",
  "-L", "127.0.0.1:${LocalMysqlPort}:127.0.0.1:3306",
  "$User@$ServerIp"
)

Write-Host ""
Write-Host "  SQL Server (SSMS)" -ForegroundColor Green
Write-Host "    Server name    : 127.0.0.1,$LocalMssqlPort" -ForegroundColor White
Write-Host "                     *** ห้ามใช้ localhost ***" -ForegroundColor Yellow
Write-Host "                     Windows แปลง localhost เป็น IPv6 (::1) ก่อน" -ForegroundColor DarkGray
Write-Host "                     tunnel ผูกเฉพาะ IPv4 -> จะขึ้น timeout error 258" -ForegroundColor DarkGray
Write-Host "                     และใช้ 'คอมมา' ไม่ใช่ colon" -ForegroundColor DarkGray
Write-Host "    Authentication : SQL Server Authentication   (Login: sa)" -ForegroundColor DarkGray
Write-Host "    Encryption     : ติ๊ก Trust server certificate" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  MySQL (DBeaver)" -ForegroundColor Green
Write-Host "    Host / Port    : 127.0.0.1 / $LocalMysqlPort" -ForegroundColor White
Write-Host "    Database       : db_truckscale   (User: wfapp)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  รหัสผ่านดูที่ Documents\wf-deploy-secrets.txt" -ForegroundColor DarkGray
Write-Host "  ----------------------------------------------" -ForegroundColor DarkGray
Write-Host "  เปิดหน้าต่างนี้ค้างไว้ - กด Ctrl+C เพื่อปิด tunnel" -ForegroundColor Yellow
Write-Host ""

& $ssh @sshArgs
$code = $LASTEXITCODE

if ($code -ne 0) {
  Write-Host ""
  Write-Host "  [X] tunnel ปิดลง (exit $code)" -ForegroundColor Red
  Write-Host "      Permission denied ตอน bind    -> หน้าต่างถูกยกสิทธิ์ ให้เปิดแบบธรรมดา" -ForegroundColor Yellow
  Write-Host "      Address already in use        -> Get-Process ssh | Stop-Process -Force" -ForegroundColor Yellow
  Write-Host "      Permission denied (publickey) -> key ผิดไฟล์ หรือไฟล์เป็น CRLF" -ForegroundColor Yellow
  Write-Host ""
  Read-Host "กด Enter เพื่อปิด"
}
