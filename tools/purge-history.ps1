<#
.SYNOPSIS
  ล้างข้อมูลอ่อนไหว (ชื่อพนักงาน · ชื่อลูกค้า · รหัสผ่านตั้งต้น · ไฟล์ mock)
  ออกจาก git history ทั้งหมดของ winspeed-connect แล้ว force-push

.DESCRIPTION
  ทำงานในสำเนาใหม่ที่ clone มาต่างหาก ไม่แตะโฟลเดอร์ที่ใช้ทำงานอยู่
  ตรวจทุกขั้น ถ้าขั้นไหนไม่ผ่านจะหยุดทันทีก่อนถึงขั้น push

  ค่าเริ่มต้นคือ **ซ้อมอย่างเดียว** (ไม่ push) — ต้องใส่ -Execute จึงจะ push จริง

.EXAMPLE
  # 1) ซ้อมก่อน — ทำทุกอย่างยกเว้น push แล้วบอกผลตรวจ
  .\tools\purge-history.ps1

  # 2) ทำจริง — ถามยืนยันหนึ่งครั้งก่อน force-push
  .\tools\purge-history.ps1 -Execute
#>
[CmdletBinding()]
param(
    # ไม่ใส่ = ซ้อมอย่างเดียว ไม่ push · ใส่ = push จริงหลังยืนยัน
    [switch]$Execute,

    [string]$RepoUrl   = 'https://github.com/thirayume/winspeed-connect.git',
    [string]$WorkDir   = 'C:\MyWork\_purge-work',
    [string]$BackupDir = 'C:\MyWork\_backup\winspeed-connect-purge-20260807'
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 ใช้ code page เดิมของ Windows ในการพิมพ์ออกหน้าจอ
# ทำให้ข้อความไทยขึ้นเป็น ? — บังคับเป็น UTF-8 ก่อน (PowerShell 7 เป็น UTF-8 อยู่แล้ว)
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$step = 0
function Say-Step($t) { $script:step++; Write-Host "`n[$script:step] $t" -ForegroundColor Cyan }
function Say-Ok($t)   { Write-Host "    ok   $t" -ForegroundColor Green }
function Die($t)      { Write-Host "`n  หยุด: $t" -ForegroundColor Red; exit 1 }

Write-Host "`n=== ล้าง git history ของ winspeed-connect ===" -ForegroundColor White
Write-Host ("โหมด: " + $(if ($Execute) { "ทำจริง (จะ force-push)" } else { "ซ้อม (ไม่ push)" })) `
    -ForegroundColor $(if ($Execute) { 'Yellow' } else { 'Gray' })

# ── 1. ตรวจเครื่องมือ ────────────────────────────────────────────────────
Say-Step 'ตรวจเครื่องมือที่ต้องใช้'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die 'ไม่พบ git' }
try { git filter-repo --version *> $null } catch { Die 'ไม่พบ git filter-repo — ติดตั้งด้วย: pip install git-filter-repo' }
Say-Ok 'git และ git filter-repo พร้อม'

# ── 2. ตรวจไฟล์สำรอง ─────────────────────────────────────────────────────
# ต้องมีก่อนเสมอ — การเขียนประวัติใหม่ย้อนกลับไม่ได้ถ้าไม่มีสำเนา
Say-Step 'ตรวจไฟล์สำรอง'
$bundle  = Join-Path $BackupDir 'winspeed-connect-before-purge.bundle'
$replTxt = Join-Path $BackupDir 'replacements.txt'
if (-not (Test-Path $bundle))  { Die "ไม่พบไฟล์สำรอง $bundle" }
if (-not (Test-Path $replTxt)) { Die "ไม่พบรายการแทนที่ $replTxt" }
$mb = [math]::Round((Get-Item $bundle).Length / 1MB, 1)
Say-Ok "bundle $mb MB · รายการแทนที่ $((Get-Content $replTxt).Count) บรรทัด"

# ── 3. clone สำเนาทำงานใหม่ ───────────────────────────────────────────────
# ทำในสำเนาแยกเพราะ filter-repo ถอด remote ออกเอง และถ้าพลาดก็แค่ลบโฟลเดอร์ทิ้ง
Say-Step 'clone สำเนาทำงานใหม่'
if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir }
git clone --quiet $RepoUrl $WorkDir
if ($LASTEXITCODE -ne 0) { Die 'clone ไม่สำเร็จ' }
Push-Location $WorkDir
$before = (git rev-parse --short HEAD)
Say-Ok "clone แล้ว · commit ล่าสุดก่อนล้าง $before"

# ── 4. ลบไฟล์ mock ออกจากทุก commit ──────────────────────────────────────
# ลบทั้งไฟล์ ไม่ใช่แค่แทนคำ เพราะทุก revision ของไฟล์นี้เป็นข้อมูลลูกค้าจริง
Say-Step 'ลบไฟล์ที่มีข้อมูลจริงออกจากทุก commit'
# sample-data.json — ทุก revision เป็นข้อมูลลูกค้าจริง
# refs/ — เอกสารอ้างอิง (SRS/Presentation/Diagrams/xlsx) ไม่ได้อยู่ใน HEAD แล้ว
#         และ giveaway_budget.xlsx มีชื่อพนักงาน 7 คน · SRS มีอีก 2 คน
#         ต้องลบทั้งไฟล์ ไม่ใช่แทนคำ เพราะ .xlsx/.docx เป็น ZIP ที่บีบอัดไว้
#         การแทนข้อความระดับไบต์จึงมองไม่เห็นข้อความข้างใน
git filter-repo --force --invert-paths `
    --path WSSale-App/src/mock/sample-data.json `
    --path refs/
if ($LASTEXITCODE -ne 0) { Pop-Location; Die 'filter-repo (ลบไฟล์) ไม่สำเร็จ' }
Say-Ok 'เสร็จ'

# ── 5. แทนชื่อและรหัสผ่านในทุก commit ────────────────────────────────────
Say-Step 'แทนชื่อพนักงาน ชื่อลูกค้า และรหัสผ่านในทุก commit'
git filter-repo --force --replace-text $replTxt
if ($LASTEXITCODE -ne 0) { Pop-Location; Die 'filter-repo (แทนข้อความ) ไม่สำเร็จ' }
Say-Ok 'เสร็จ'

# ── 6. ตรวจว่าสะอาดจริง ──────────────────────────────────────────────────
# ตรวจก่อน push เสมอ — push แล้วแก้ยากกว่ามาก
Say-Step 'ตรวจว่าไม่เหลืออะไรในประวัติ'
$needles = @{
    'รหัสผ่านตั้งต้น' = ('W0rld' + 'F3rt')
    'ชื่อพนักงาน (1)'  = 'EMP-00036'
    'ชื่อพนักงาน (2)'  = 'EMP-00027'
    'ชื่อลูกค้า'       = 'CUST-23037'
}
$dirty = $false
foreach ($k in $needles.Keys) {
    # --no-textconv สำคัญ: ถ้าไม่ใส่ git จะเรียก astextplain แปลง .docx เป็นข้อความก่อนค้น
    # ซึ่งบนเครื่องนี้ไม่มี docx2txt.exe จึงคืนค่าว่าง แล้วรายงานว่า "0 commit" ทั้งที่ยังไม่ได้ค้นจริง
    $hits = @(git --no-pager log --all --oneline --no-textconv -S $needles[$k] --).Count
    if ($hits -eq 0) { Say-Ok "$k = 0 commit" }
    else { Write-Host "    เหลือ $k = $hits commit" -ForegroundColor Red; $dirty = $true }
}
foreach ($path in @('WSSale-App/src/mock/sample-data.json', 'refs/')) {
    $h = @(git --no-pager log --all --oneline -- $path).Count
    if ($h -eq 0) { Say-Ok "$path = 0 commit" }
    else { Write-Host "    เหลือ $path = $h commit" -ForegroundColor Red; $dirty = $true }
}

# ค้นซ้ำในไฟล์ที่บีบอัด (.docx/.xlsx/.pptx) — การค้นแบบไบต์มองไม่เห็นข้อความข้างใน
# ถ้าไม่เหลือไฟล์แบบนี้ในประวัติแล้วก็ไม่ต้องกังวล จึงตรวจแค่ว่าเหลือหรือไม่
$binLeft = @(git --no-pager log --all --pretty=format: --name-only |
             Sort-Object -Unique |
             Where-Object { $_ -match '\.(docx|xlsx|pptx|doc|xls|ppt)$' })
if ($binLeft.Count -eq 0) { Say-Ok 'ไม่มีไฟล์เอกสารบีบอัดเหลือในประวัติ' }
else {
    Write-Host "    เหลือไฟล์บีบอัดที่ค้นข้างในไม่ได้ $($binLeft.Count) ไฟล์:" -ForegroundColor Red
    $binLeft | ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
    $dirty = $true
}

if ($dirty) { Pop-Location; Die 'ยังไม่สะอาด — ไม่ push · ตรวจรายการแทนที่แล้วรันใหม่' }

# ── 7. push ─────────────────────────────────────────────────────────────
if (-not $Execute) {
    Pop-Location
    Write-Host "`n  ซ้อมผ่านทุกขั้น — ยังไม่ได้ push" -ForegroundColor Green
    Write-Host "  สำเนาที่ล้างแล้วอยู่ที่ $WorkDir (ตรวจดูได้)" -ForegroundColor Gray
    Write-Host "  พร้อมแล้วสั่ง:  .\tools\purge-history.ps1 -Execute`n" -ForegroundColor Yellow
    exit 0
}

Say-Step 'force-push ขึ้น GitHub'
Write-Host "    จะเขียนประวัติของ $RepoUrl ทับทั้งหมด" -ForegroundColor Yellow
Write-Host "    ทุกคนที่ clone ไปแล้วต้อง clone ใหม่" -ForegroundColor Yellow
$ans = Read-Host "    พิมพ์ PUSH เพื่อยืนยัน (อย่างอื่น = ยกเลิก)"
if ($ans -ne 'PUSH') { Pop-Location; Write-Host "`n  ยกเลิกแล้ว ไม่มีอะไรถูกเปลี่ยนบน GitHub`n" -ForegroundColor Gray; exit 0 }

git remote add origin $RepoUrl
git push --force --all origin
if ($LASTEXITCODE -ne 0) { Pop-Location; Die 'push ไม่สำเร็จ — ประวัติบน GitHub ยังเป็นของเดิม' }
git push --force --tags origin
Say-Ok 'push เรียบร้อย'

# ── 8. ยืนยันจากของจริงบน GitHub ─────────────────────────────────────────
# clone ใหม่มาตรวจ เพราะสำเนาในเครื่องอาจดูสะอาดทั้งที่ push ไม่ครบ
Say-Step 'clone ใหม่จาก GitHub มาตรวจซ้ำ'
Pop-Location
$verify = "$WorkDir-verify"
if (Test-Path $verify) { Remove-Item -Recurse -Force $verify }
git clone --quiet $RepoUrl $verify
Push-Location $verify
$left = @(git --no-pager log --all --oneline --no-textconv -S ('W0rld' + 'F3rt') --).Count
$mockLeft = @(git --no-pager log --all --oneline -- WSSale-App/src/mock/sample-data.json).Count
$refsLeft = @(git --no-pager log --all --oneline -- refs/).Count
Pop-Location
if ($left -eq 0 -and $mockLeft -eq 0 -and $refsLeft -eq 0) { Say-Ok 'ของจริงบน GitHub สะอาดแล้ว' }
else { Die "บน GitHub ยังเหลือ: รหัสผ่าน $left · mock $mockLeft · refs/ $refsLeft commit" }

Write-Host "`n=== เสร็จสิ้น ===" -ForegroundColor Green
Write-Host @"

ขั้นต่อไปที่ต้องทำเอง:

  1. ตั้งโฟลเดอร์ทำงานเดิมใหม่ (ประวัติเก่าใช้ต่อไม่ได้แล้ว)
       cd C:\MyWork\WorldFert
       Rename-Item winspeed-frontend winspeed-frontend-old
       git clone $RepoUrl winspeed-frontend
       Copy-Item winspeed-frontend-old\backend\.env winspeed-frontend\backend\.env
       Copy-Item -Recurse winspeed-frontend-old\docs winspeed-frontend\docs -ErrorAction SilentlyContinue
       cd winspeed-frontend\backend;   npm install
       cd ..\WSSale-App;               npm install; npm run build
     ใช้ได้แล้วค่อยลบ winspeed-frontend-old

  2. ส่งข้อความให้ทีม clone ใหม่ (ดูหัวข้อ "คำสั่งสำหรับทีม" ใน SECURITY-HISTORY-PURGE.md)

  3. เปลี่ยนรหัส admin บนระบบที่ deploy แล้วทุกตัว — รหัสเดิมเคยเผยแพร่สาธารณะ
     การล้างประวัติไม่ได้ทำให้สิ่งที่ถูกอ่านไปแล้วหายไป

  4. ลบโฟลเดอร์ชั่วคราวทิ้ง
       Remove-Item -Recurse -Force $WorkDir, $verify

"@ -ForegroundColor Gray
