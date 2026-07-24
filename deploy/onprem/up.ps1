<#
  up.ps1 — ติดตั้ง/สตาร์ท WS-Sale-App แบบ on-prem ด้วยคำสั่งเดียว
  ---------------------------------------------------------------
  วิธีใช้ที่ง่ายที่สุด: ดับเบิลคลิก up.bat

  ทำอะไรบ้าง:
    1. ตรวจ Docker
    2. ตรวจ .env (ถ้ายังไม่มี สร้างจาก .env.example ให้แล้วหยุดรอคุณแก้)
    3. docker compose up -d --build
    4. รอ container พร้อม
    5. bootstrap.sh — restore + migrations + seed ผู้ใช้

  พารามิเตอร์:
    -Rebuild      บังคับ build ใหม่ทั้งหมด (ไม่ใช้ cache)
    -SkipBootstrap  แค่สตาร์ท ไม่แตะฐานข้อมูล
    -Down         หยุดทุก container (ข้อมูลใน volume ไม่หาย)

  หมายเหตุสำหรับผู้แก้ไฟล์นี้:
    - บันทึกเป็น UTF-8 with BOM เสมอ ไม่งั้น powershell.exe 5.1 อ่านภาษาไทยเพี้ยน
#>
param(
  [switch] $Rebuild,
  [switch] $SkipBootstrap,
  [switch] $Down
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Head($t) { Write-Host ""; Write-Host ("=" * 60) -ForegroundColor Cyan; Write-Host "  $t" -ForegroundColor Cyan; Write-Host ("=" * 60) -ForegroundColor Cyan }
function Step($t) { Write-Host ""; Write-Host ">> $t" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "   [OK] $t" -ForegroundColor Green }
function Warn($t) { Write-Host "   [!]  $t" -ForegroundColor Yellow }
function Die($t, $hint) {
  Write-Host ""; Write-Host "   [X] $t" -ForegroundColor Red
  foreach ($h in $hint) { Write-Host "       $h" -ForegroundColor Yellow }
  Write-Host ""; Read-Host "กด Enter เพื่อปิด"; exit 1
}

Head "WS-Sale-App — On-Prem"

# --- 1) Docker ---
Step "ตรวจ Docker"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Die "ไม่พบคำสั่ง docker" @("ติดตั้ง Docker Desktop: https://www.docker.com/products/docker-desktop/")
}
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Die "Docker ไม่ได้รันอยู่" @("เปิด Docker Desktop แล้วรอจนขึ้น Running แล้วลองใหม่") }
Ok "Docker พร้อม"

# --- หยุดระบบ ---
if ($Down) {
  Step "หยุดทุก container"
  docker compose down
  Ok "หยุดแล้ว (ข้อมูลใน volume ยังอยู่ครบ)"
  Write-Host ""; Read-Host "กด Enter เพื่อปิด"; exit 0
}

# --- 2) .env ---
Step "ตรวจไฟล์ .env"
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Die "สร้าง .env ให้แล้ว — ต้องแก้ค่าก่อนใช้งาน" @(
    "เปิดไฟล์ .env แล้วแก้:",
    "  - APP_DOMAIN / API_DOMAIN / VITE_API_BASE_URL / CORS_ORIGIN",
    "  - รหัสผ่านทุกตัวที่ขึ้นต้นด้วย CHANGE_ME",
    "แก้เสร็จแล้วรัน up.bat ใหม่"
  )
}
$envText = Get-Content .env -Raw
$left = ([regex]::Matches($envText, '(?m)^\s*([A-Z_]+)\s*=\s*CHANGE_ME')) | ForEach-Object { $_.Groups[1].Value }
if ($left.Count -gt 0) {
  Die "ยังมีค่า CHANGE_ME ใน .env ($($left.Count) ตัว)" @(($left -join ', '), "แก้ให้ครบก่อนแล้วรันใหม่")
}
Ok ".env พร้อม"

# --- โฟลเดอร์ backup ---
if (-not (Test-Path .\backup)) { New-Item -ItemType Directory -Path .\backup | Out-Null }
$baks = @(Get-ChildItem .\backup -Filter *.bak -ErrorAction SilentlyContinue)
$sqls = @(Get-ChildItem .\backup -Filter *.sql -ErrorAction SilentlyContinue)
if ($baks.Count -eq 0) { Warn "ไม่มีไฟล์ .bak ใน .\backup\ — จะข้ามการ restore SQL Server" }
else { Ok "พบ .bak : $($baks[0].Name)" }
if ($sqls.Count -eq 0) { Warn "ไม่มีไฟล์ .sql ใน .\backup\ — จะข้ามการ restore MySQL" }
else { Ok "พบ .sql : $($sqls[0].Name)" }

# --- 3) build + up ---
Step "build + start (ครั้งแรกใช้เวลานาน ~5-15 นาที)"
if ($Rebuild) { docker compose build --no-cache; if ($LASTEXITCODE -ne 0) { Die "build ล้มเหลว" @() } }
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Die "docker compose up ล้มเหลว" @("ดู log: docker compose logs --tail 50") }
Ok "container สตาร์ทแล้ว"

# --- 4) bootstrap ---
if ($SkipBootstrap) {
  Warn "ข้าม bootstrap (-SkipBootstrap)"
} else {
  Step "ตั้งค่าฐานข้อมูล (restore + migrations + seed)"
  $bash = $null
  foreach ($p in @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe", "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe")) {
    if (Test-Path $p) { $bash = $p; break }
  }
  if (-not $bash) { $bash = (Get-Command bash -ErrorAction SilentlyContinue).Source }
  if (-not $bash) {
    Warn "ไม่พบ bash (Git for Windows) — ข้ามขั้นนี้"
    Write-Host "       ติดตั้ง Git for Windows แล้วรัน:  bash bootstrap.sh" -ForegroundColor Yellow
  } else {
    & $bash ./bootstrap.sh
    if ($LASTEXITCODE -ne 0) { Die "bootstrap ล้มเหลว" @("แก้แล้วรันซ้ำได้: bash bootstrap.sh") }
  }
}

# --- สรุป ---
Head "เสร็จสิ้น"
docker compose ps --format "table {{.Name}}\t{{.Status}}"
$appDomain = ([regex]::Match($envText, '(?m)^\s*APP_DOMAIN\s*=\s*(.+)$')).Groups[1].Value.Trim()
Write-Host ""
Write-Host "  หน้าเว็บ : https://$appDomain" -ForegroundColor Green
Write-Host "  login    : admin / W0rldF3rt   (W0rld ใช้เลขศูนย์)" -ForegroundColor Green
Write-Host ""
Write-Host "  ดู log   : docker compose logs -f backend" -ForegroundColor DarkGray
Write-Host "  หยุด     : up.bat -Down" -ForegroundColor DarkGray
Write-Host ""
Read-Host "กด Enter เพื่อปิด"
