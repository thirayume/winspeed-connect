<#
  provision-customer.ps1 - Wizard ติดตั้งระบบให้ลูกค้าใหม่ (WS-Sale-App)
  =====================================================================
  รันจากเครื่องผู้ติดตั้ง (Windows) -> ทำงานกับ VPS ของลูกค้าผ่าน SSH

  วิธีใช้ที่ง่ายที่สุด: ดับเบิลคลิก provision-customer.bat

  *** ห้ามเปิดหน้าต่างแบบ Run as administrator ***
  ssh บน Windows จะ bind พอร์ต loopback ไม่ได้เมื่อยกสิทธิ์

  แนวคิด:
    - เก็บข้อมูลลูกค้า + ความลับไว้ใน "profile" นอก repo
      %USERPROFILE%\Documents\wf-customers\<ชื่อลูกค้า>.json
    - ทำงานเป็น "ขั้น" (stage) ทำซ้ำได้ ขั้นไหนเสร็จแล้วจะข้าม
    - ขั้นที่เป็น UI ของ Coolify สคริปต์จะพิมพ์ค่าที่ต้องวางให้ครบ แล้วรอยืนยัน

  ขั้นทั้งหมด:
    1 init      เก็บข้อมูล + สุ่มความลับ + สร้างไฟล์ env ให้วางใน Coolify
    2 bootstrap เตรียม VPS (swap/TZ/firewall/fail2ban) ผ่าน SSH
    3 coolify   [ทำมือ] เพิ่ม server + สร้าง 3 resource ใน Coolify
    4 data      อัปโหลด backup + restore SQL Server และ MySQL
    5 schema    000_logins + migrations + seed_admin
    6 verify    preflight + ทดสอบ URL จริง
    7 handover  ออกเอกสารส่งมอบให้ลูกค้า

  หมายเหตุสำหรับผู้แก้ไฟล์นี้:
    - บันทึกเป็น UTF-8 with BOM เสมอ ไม่งั้น powershell.exe 5.1 อ่านภาษาไทยเพี้ยน
#>
param(
  [string] $Customer,
  [ValidateSet('all','init','bootstrap','coolify','data','schema','verify','handover','status')]
  [string] $Stage = 'all',
  [switch] $Force
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$SCRIPT_DIR   = Split-Path -Parent $MyInvocation.MyCommand.Path
$REPO_ROOT    = Resolve-Path (Join-Path $SCRIPT_DIR '..\..')
$PROFILE_DIR  = Join-Path $env:USERPROFILE 'Documents\wf-customers'

# ---------- UI helpers ----------
function Head($t) { Write-Host ""; Write-Host ("=" * 62) -ForegroundColor Cyan; Write-Host "  $t" -ForegroundColor Cyan; Write-Host ("=" * 62) -ForegroundColor Cyan }
function Step($t) { Write-Host ""; Write-Host ">> $t" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "   [OK] $t" -ForegroundColor Green }
function Warn($t) { Write-Host "   [!]  $t" -ForegroundColor Yellow }
function Info($t) { Write-Host "        $t" -ForegroundColor DarkGray }
function Die($t)  { Write-Host ""; Write-Host "   [X] $t" -ForegroundColor Red; Write-Host ""; Read-Host "กด Enter เพื่อปิด"; exit 1 }

function Ask($label, $default) {
  if ($default) { $v = Read-Host "$label [$default]"; if ([string]::IsNullOrWhiteSpace($v)) { return $default } ; return $v.Trim() }
  do { $v = Read-Host $label } while ([string]::IsNullOrWhiteSpace($v))
  return $v.Trim()
}
function Confirm($label) { $a = Read-Host "$label (y/N)"; return ($a -match '^[Yy]') }

function New-Secret([int]$len = 24) {
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $s = [Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', ''
  return $s.Substring(0, [Math]::Min($len, $s.Length))
}

# ---------- profile ----------
function Get-ProfilePath($name) { Join-Path $PROFILE_DIR "$name.json" }

function Load-Profile($name) {
  $p = Get-ProfilePath $name
  if (Test-Path $p) { return (Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json) }
  return $null
}
function Save-Profile($cfg) {
  if (-not (Test-Path $PROFILE_DIR)) { New-Item -ItemType Directory -Path $PROFILE_DIR -Force | Out-Null }
  $p = Get-ProfilePath $cfg.customer
  $cfg | ConvertTo-Json -Depth 6 | Set-Content -Path $p -Encoding UTF8
  # ล็อกสิทธิ์ - ไฟล์นี้มีรหัสผ่านทั้งหมด
  try { icacls $p /inheritance:r /grant:r "$($env:USERNAME):F" | Out-Null } catch { }
}
function Mark-Done($cfg, $stage) {
  if (-not $cfg.done) { $cfg | Add-Member -NotePropertyName done -NotePropertyValue @() -Force }
  if ($cfg.done -notcontains $stage) { $cfg.done = @($cfg.done) + $stage }
  Save-Profile $cfg
}
function Is-Done($cfg, $stage) { return ($cfg.done -and ($cfg.done -contains $stage)) }

# ---------- ssh ----------
function Remote($cfg, $cmd) {
  $args = @('-o','StrictHostKeyChecking=no','-o','ConnectTimeout=15','-i',$cfg.sshKey,"$($cfg.sshUser)@$($cfg.serverIp)",$cmd)
  & ssh @args
  return $LASTEXITCODE
}
function RemoteScript($cfg, $scriptText) {
  $tmp = [System.IO.Path]::GetTempFileName()
  Set-Content -Path $tmp -Value $scriptText -Encoding UTF8 -NoNewline
  $args = @('-o','StrictHostKeyChecking=no','-i',$cfg.sshKey,"$($cfg.sshUser)@$($cfg.serverIp)",'bash -s')
  Get-Content $tmp -Raw | & ssh @args
  $code = $LASTEXITCODE
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  return $code
}
function Upload($cfg, $local, $remote) {
  & scp -o StrictHostKeyChecking=no -i $cfg.sshKey $local "$($cfg.sshUser)@$($cfg.serverIp):$remote"
  return $LASTEXITCODE
}

# =====================================================================
# STAGE 1 - init
# =====================================================================
function Stage-Init($cfg) {
  Head "ขั้น 1/7 - ข้อมูลลูกค้า + สร้างความลับ"

  if ($cfg -and -not $Force) {
    Warn "มี profile ของ '$($cfg.customer)' อยู่แล้ว - ใช้ค่าเดิม (ใส่ -Force เพื่อกรอกใหม่)"
    return $cfg
  }

  Write-Host ""
  Info "ทุกค่าจะถูกเก็บที่ $PROFILE_DIR (นอก repo)"
  Write-Host ""

  $name     = if ($cfg) { $cfg.customer } else { Ask "ชื่อลูกค้า (a-z0-9- เช่น acme)" $Customer }
  $serverIp = Ask "IP ของ VPS ลูกค้า" $(if ($cfg) { $cfg.serverIp })
  $sshUser  = Ask "SSH user" $(if ($cfg) { $cfg.sshUser } else { 'root' })
  $sshKey   = Ask "ไฟล์ SSH private key" $(if ($cfg) { $cfg.sshKey } else { "$env:USERPROFILE\.ssh\$name-key" })
  if (-not (Test-Path $sshKey)) { Die "ไม่พบไฟล์ key: $sshKey" }

  Write-Host ""
  Info "โดเมน - ถ้ายังไม่มีของจริง ใช้ sslip.io ไปก่อนได้ (IP ต้องอยู่ในชื่อ)"
  $dash     = $serverIp.Replace('.', '-')
  $appDomain = Ask "โดเมน frontend" $(if ($cfg) { $cfg.appDomain } else { "app.$dash.sslip.io" })
  $apiDomain = Ask "โดเมน backend"  $(if ($cfg) { $cfg.apiDomain } else { "api.$dash.sslip.io" })

  Write-Host ""
  $repo     = Ask "GitHub repo ของลูกค้า (fork)" $(if ($cfg) { $cfg.repo } else { 'https://github.com/<customer>/winspeed-connect' })
  $branch   = Ask "branch" $(if ($cfg) { $cfg.branch } else { 'main' })
  $isPrivate = Confirm "repo เป็น Private ใช่ไหม"

  Write-Host ""
  $bak      = Ask "ไฟล์ .bak ของ SQL Server" $(if ($cfg) { $cfg.bakFile } else { "$REPO_ROOT\..\dbwins_worldfert9_db_202607021642.bak" })
  $sqlDump  = Ask "ไฟล์ .sql ของ MySQL"      $(if ($cfg) { $cfg.sqlFile } else { "$REPO_ROOT\..\dump-db_truckscale-202607212333.sql" })
  foreach ($f in @($bak, $sqlDump)) { if (-not (Test-Path $f)) { Die "ไม่พบไฟล์: $f" } }

  Step "สุ่มความลับทั้งชุด (ไม่ซ้ำกับลูกค้ารายอื่น)"
  $new = [ordered]@{
    customer   = $name
    serverIp   = $serverIp
    sshUser    = $sshUser
    sshKey     = $sshKey
    appDomain  = $appDomain
    apiDomain  = $apiDomain
    repo       = $repo
    branch     = $branch
    isPrivate  = [bool]$isPrivate
    bakFile    = $bak
    sqlFile    = $sqlDump
    dbName     = 'dbwins_worldfert9'
    mysqlDb    = 'db_truckscale'
    mysqlUser  = 'wfapp'
    saPassword       = ("Wf" + (New-Secret 22) + "9x")
    mysqlRootPassword= (New-Secret 24)
    mysqlPassword    = (New-Secret 24)
    wfReaderPassword = ("Rd" + (New-Secret 22) + "7k")
    wfOwnerPassword  = ("Ow" + (New-Secret 22) + "4m")
    jwtSecret        = (New-Secret 64)
    tsIngestSecret   = (New-Secret 48)
    migrateSecret    = (New-Secret 48)
    adminPassword    = 'W0rldF3rt'
    tunnelPort       = 14330
    createdAt        = (Get-Date -Format 'yyyy-MM-dd HH:mm')
    done             = @()
  }
  if ($cfg) { foreach ($k in 'saPassword','mysqlRootPassword','mysqlPassword','wfReaderPassword','wfOwnerPassword','jwtSecret','tsIngestSecret','migrateSecret') { if ($cfg.$k) { $new[$k] = $cfg.$k } } }

  $obj = [PSCustomObject]$new
  Save-Profile $obj
  Ok "บันทึก profile: $(Get-ProfilePath $name)"

  # ไฟล์ env สำหรับวางใน Coolify
  $outDir = Join-Path $PROFILE_DIR $name
  if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

  $dbEnv = @(
    "MSSQL_SA_PASSWORD=$($obj.saPassword)",
    "MYSQL_ROOT_PASSWORD=$($obj.mysqlRootPassword)",
    "MYSQL_USER=$($obj.mysqlUser)",
    "MYSQL_PASSWORD=$($obj.mysqlPassword)"
  )
  $beEnv = @(
    "DB_MODE=remote",
    "REMOTE_DB_SERVER=__MSSQL_CONTAINER__",
    "REMOTE_DB_PORT=1433",
    "REMOTE_DB_USER=sa",
    "REMOTE_DB_PASSWORD=$($obj.saPassword)",
    "DB_NAME=$($obj.dbName)",
    "DB_USER=wf_reader",
    "DB_PASSWORD=$($obj.wfReaderPassword)",
    "DB_OWNER_USER=wf_owner",
    "DB_OWNER_PASSWORD=$($obj.wfOwnerPassword)",
    "MYSQL_HOST=__MYSQL_CONTAINER__",
    "MYSQL_PORT=3306",
    "MYSQL_DATABASE=$($obj.mysqlDb)",
    "MYSQL_USER=$($obj.mysqlUser)",
    "MYSQL_PASSWORD=$($obj.mysqlPassword)",
    "TS_SYNC_INTERVAL_MS=60000",
    "TS_INGEST_SECRET=$($obj.tsIngestSecret)",
    "JWT_SECRET=$($obj.jwtSecret)",
    "JWT_EXPIRES_IN=8h",
    "PORT=3000",
    "NODE_ENV=production",
    "TZ=Asia/Bangkok",
    "CORS_ORIGIN=https://$($obj.appDomain)",
    "EXPORT_OUTPUT_PATH=/app/exports",
    "MIGRATE_SECRET=$($obj.migrateSecret)",
    "APP_VERSION=1.0.0"
  )
  $feEnv = @(
    "VITE_API_BASE_URL=https://$($obj.apiDomain)/api",
    "VITE_USE_MOCKUP_DATA=false"
  )
  ($dbEnv -join "`r`n") | Set-Content (Join-Path $outDir '1-env-databases.txt') -Encoding UTF8
  ($beEnv -join "`r`n") | Set-Content (Join-Path $outDir '2-env-backend.txt')   -Encoding UTF8
  ($feEnv -join "`r`n") | Set-Content (Join-Path $outDir '3-env-frontend.txt')  -Encoding UTF8
  Copy-Item (Join-Path $SCRIPT_DIR 'docker-compose.yml') (Join-Path $outDir '0-docker-compose.yml') -Force

  Ok "สร้างไฟล์สำหรับวางใน Coolify ที่ $outDir"
  Info "0-docker-compose.yml / 1-env-databases.txt / 2-env-backend.txt / 3-env-frontend.txt"
  Warn "2-env-backend.txt ยังมี __MSSQL_CONTAINER__ - ขั้น 4 จะเติมชื่อจริงให้อัตโนมัติ"
  return $obj
}

# =====================================================================
# STAGE 2 - bootstrap
# =====================================================================
function Stage-Bootstrap($cfg) {
  Head "ขั้น 2/7 - เตรียม VPS"
  Step "ทดสอบ SSH"
  if ((Remote $cfg "echo ok") -ne 0) { Die "SSH เข้าไม่ได้ - ตรวจ IP / key / ลูกค้าใส่ public key แล้วหรือยัง" }
  Ok "SSH ได้"

  Step "อัปโหลดสคริปต์"
  foreach ($f in @('01-server-bootstrap.sh','02-restore-mssql.sh','03-restore-mysql.sh','backup-databases.sh')) {
    if ((Upload $cfg (Join-Path $SCRIPT_DIR $f) '/root/') -ne 0) { Die "อัปโหลด $f ไม่สำเร็จ" }
  }
  Ok "อัปโหลดครบ"

  Step "รัน bootstrap (อัปเดตระบบ + swap + TZ + firewall + fail2ban) - ใช้เวลาสักครู่"
  $code = Remote $cfg "NEEDRESTART_MODE=a DEBIAN_FRONTEND=noninteractive bash /root/01-server-bootstrap.sh --mode cloud"
  if ($code -ne 0) { Die "bootstrap ล้มเหลว" }
  Ok "VPS พร้อมให้ Coolify เชื่อมต่อ"
  Mark-Done $cfg 'bootstrap'
}

# =====================================================================
# STAGE 3 - Coolify (ทำมือ)
# =====================================================================
function Stage-Coolify($cfg) {
  Head "ขั้น 3/7 - ตั้งค่าใน Coolify (ทำผ่านหน้าเว็บ)"
  $outDir = Join-Path $PROFILE_DIR $cfg.customer

  Write-Host ""
  Write-Host "  A) Servers -> + Add" -ForegroundColor White
  Info "Name       : $($cfg.customer)-prod"
  Info "IP / Port  : $($cfg.serverIp) / 22"
  Info "User       : $($cfg.sshUser)"
  Info "Private Key: เพิ่ม key ของลูกค้าใน Keys & Tokens ก่อน แล้วเลือกที่นี่"
  Info "-> กด Validate Server & Install Docker"

  Write-Host ""
  Write-Host "  B) Project -> + Add Resource -> Docker Compose Empty" -ForegroundColor White
  Info "วางไฟล์ : $outDir\0-docker-compose.yml"
  Info "ตั้งชื่อ : wf-databases   แล้ว Save"
  Info "Environment Variables -> Developer view -> วาง 1-env-databases.txt"
  Info "General -> ติ๊ก Connect To Predefined Network -> Save -> Restart"
  Info "แล้วกด Deploy"

  Write-Host ""
  Write-Host "  C) + Add Resource -> Application (backend)" -ForegroundColor White
  if ($cfg.isPrivate) {
    Warn "repo เป็น Private -> ต้องใช้ 'Private Repository (with Deploy Key)'"
    Info "Coolify จะสร้าง Deploy Key ให้ -> คัดลอกไปใส่ที่"
    Info "GitHub repo -> Settings -> Deploy keys -> Add deploy key (Read-only พอ)"
  } else {
    Info "ใช้ 'Public Repository'"
  }
  Info "Repository : $($cfg.repo)   branch $($cfg.branch)"
  Info "Build Pack : Dockerfile     Base Directory: /backend"
  Info "Name       : wf-backend"
  Info "Domains    : https://$($cfg.apiDomain)"
  Info "Env        : วาง 2-env-backend.txt (หลังขั้น 4 เติมชื่อ container แล้ว)"

  Write-Host ""
  Write-Host "  D) + Add Resource -> Application (frontend)" -ForegroundColor White
  Info "Base Directory : /WSSale-App    Ports Exposes: 80"
  Info "Name           : wf-frontend"
  Info "Domains        : https://$($cfg.appDomain)"
  Info "Env            : วาง 3-env-frontend.txt"

  Write-Host ""
  Warn "ยังไม่ต้อง Deploy backend/frontend - ทำขั้น 4-5 (ข้อมูล+schema) ให้เสร็จก่อน"
  Write-Host ""
  if (Confirm "ทำขั้น A และ B เสร็จแล้ว (wf-databases รันอยู่)") { Mark-Done $cfg 'coolify' }
  else { Warn "ยังไม่ยืนยัน - รันสคริปต์ใหม่แล้วเลือก stage coolify ได้ภายหลัง" }
}

# =====================================================================
# STAGE 4 - data
# =====================================================================
function Stage-Data($cfg) {
  Head "ขั้น 4/7 - อัปโหลด + restore ฐานข้อมูล"

  Step "หาชื่อ container ที่ Coolify สร้าง"
  $names = & ssh -o StrictHostKeyChecking=no -i $cfg.sshKey "$($cfg.sshUser)@$($cfg.serverIp)" "docker ps --format '{{.Names}}'"
  $mssql = ($names | Where-Object { $_ -like 'mssql-*' } | Select-Object -First 1)
  $mysql = ($names | Where-Object { $_ -like 'mysql-*' } | Select-Object -First 1)
  if (-not $mssql -or -not $mysql) { Die "ไม่พบ container mssql/mysql - ทำขั้น 3B (Deploy wf-databases) ให้เสร็จก่อน" }
  Ok "mssql = $mssql"
  Ok "mysql = $mysql"

  $cfg | Add-Member -NotePropertyName mssqlContainer -NotePropertyValue $mssql -Force
  $cfg | Add-Member -NotePropertyName mysqlContainer -NotePropertyValue $mysql -Force
  Save-Profile $cfg

  # เติมชื่อ container ลงไฟล์ env backend
  $beFile = Join-Path (Join-Path $PROFILE_DIR $cfg.customer) '2-env-backend.txt'
  (Get-Content $beFile -Raw -Encoding UTF8).Replace('__MSSQL_CONTAINER__', $mssql).Replace('__MYSQL_CONTAINER__', $mysql) |
    Set-Content $beFile -Encoding UTF8
  Ok "เติมชื่อ container ใน 2-env-backend.txt แล้ว (พร้อมวางใน Coolify)"

  Step "เขียนไฟล์ความลับบน server (/root/.wf-secrets)"
  $secrets = @(
    "MSSQL_SA_PASSWORD=$($cfg.saPassword)",
    "MYSQL_ROOT_PASSWORD=$($cfg.mysqlRootPassword)",
    "MYSQL_USER=$($cfg.mysqlUser)",
    "MYSQL_PASSWORD=$($cfg.mysqlPassword)",
    "WF_READER_PASSWORD=$($cfg.wfReaderPassword)",
    "WF_OWNER_PASSWORD=$($cfg.wfOwnerPassword)",
    "MSSQL_CONTAINER=$mssql",
    "MYSQL_CONTAINER=$mysql",
    "MSSQL_DB=$($cfg.dbName)",
    "MYSQL_DB=$($cfg.mysqlDb)"
  ) -join "`n"
  $tmp = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($tmp, $secrets + "`n")
  Get-Content $tmp -Raw | & ssh -o StrictHostKeyChecking=no -i $cfg.sshKey "$($cfg.sshUser)@$($cfg.serverIp)" "cat > /root/.wf-secrets && chmod 600 /root/.wf-secrets"
  Remove-Item $tmp -Force
  Ok "เขียนแล้ว (สิทธิ์ 600)"

  Step "อัปโหลด backup (ไฟล์ใหญ่ ใช้เวลานาน)"
  Remote $cfg "mkdir -p /root/backup" | Out-Null
  & scp -C -o StrictHostKeyChecking=no -i $cfg.sshKey $cfg.bakFile $cfg.sqlFile "$($cfg.sshUser)@$($cfg.serverIp):/root/backup/"
  if ($LASTEXITCODE -ne 0) { Die "อัปโหลด backup ไม่สำเร็จ" }
  Ok "อัปโหลดครบ"

  Step "restore SQL Server"
  $bakName = Split-Path $cfg.bakFile -Leaf
  $sqlName = Split-Path $cfg.sqlFile -Leaf
  # ไม่ใช้ exit code ของสคริปต์ตรงๆ เพราะขั้นลบไฟล์ท้ายสุดอาจ Permission denied
  RemoteScript $cfg "set -a; . /root/.wf-secrets; set +a`nbash /root/02-restore-mssql.sh /root/backup/$bakName || true`ndocker exec -u root `"`$MSSQL_CONTAINER`" rm -f /var/opt/mssql/backup/$bakName 2>/dev/null || true" | Out-Null

  Step "ตรวจผล + ปรับ recovery model เป็น SIMPLE (กัน log บวมบนดิสก์เล็ก)"
  $chk = @"
set -a; . /root/.wf-secrets; set +a
q(){ docker exec "`$MSSQL_CONTAINER" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "`$MSSQL_SA_PASSWORD" -C -h -1 -W -Q "SET NOCOUNT ON; `$1"; }
q "ALTER DATABASE [`$MSSQL_DB] SET RECOVERY SIMPLE" >/dev/null 2>&1
docker exec "`$MSSQL_CONTAINER" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "`$MSSQL_SA_PASSWORD" -C -d "`$MSSQL_DB" -Q "DBCC SHRINKFILE (dbERP_New_Log, 512)" >/dev/null 2>&1
echo "dbo tables: `$(q "SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='dbo'" | tr -d ' \r')"
echo "collation : `$(q "SELECT CAST(DATABASEPROPERTYEX('`$MSSQL_DB','Collation') AS VARCHAR(40))" | tr -d ' \r')"
"@
  RemoteScript $cfg $chk | Out-Null

  Step "restore MySQL"
  RemoteScript $cfg "set -a; . /root/.wf-secrets; set +a`nbash /root/03-restore-mysql.sh /root/backup/$sqlName" | Out-Null

  Ok "restore เสร็จทั้งสองฐาน"
  Mark-Done $cfg 'data'
}

# =====================================================================
# STAGE 5 - schema
# =====================================================================
function Stage-Schema($cfg) {
  Head "ขั้น 5/7 - logins + migrations + seed ผู้ใช้"

  Step "สร้าง login/user (wf_reader, wf_owner)"
  $loginSql = @"
set -a; . /root/.wf-secrets; set +a
cat > /tmp/000_logins.sql <<'SQLEOF'
USE master;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'wf_reader')
  CREATE LOGIN wf_reader WITH PASSWORD = '__RPW__', CHECK_POLICY = OFF;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'wf_owner')
  CREATE LOGIN wf_owner WITH PASSWORD = '__OPW__', CHECK_POLICY = OFF;
GO
USE __DB__;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'wf_reader') CREATE USER wf_reader FOR LOGIN wf_reader;
GO
ALTER ROLE db_datareader ADD MEMBER wf_reader;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'wf_owner') CREATE USER wf_owner FOR LOGIN wf_owner;
GO
ALTER ROLE db_datareader ADD MEMBER wf_owner;
GO
SQLEOF
sed -i "s|__RPW__|`$WF_READER_PASSWORD|; s|__OPW__|`$WF_OWNER_PASSWORD|; s|__DB__|`$MSSQL_DB|g" /tmp/000_logins.sql
docker cp /tmp/000_logins.sql "`$MSSQL_CONTAINER":/tmp/000_logins.sql >/dev/null
docker exec "`$MSSQL_CONTAINER" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "`$MSSQL_SA_PASSWORD" -C -b -i /tmp/000_logins.sql
docker exec -u root "`$MSSQL_CONTAINER" rm -f /tmp/000_logins.sql
rm -f /tmp/000_logins.sql
"@
  if ((RemoteScript $cfg $loginSql) -ne 0) { Die "สร้าง login ไม่สำเร็จ" }
  Ok "wf_reader / wf_owner พร้อม"

  Step "Deploy backend ใน Coolify (ต้องมีก่อนจึงจะรัน migrations ในเครื่องได้)"
  Info "ไปที่ Coolify -> wf-backend -> วาง env จาก 2-env-backend.txt -> Deploy"
  if (-not (Confirm "Deploy wf-backend เสร็จแล้ว (container ขึ้นแล้ว)")) { Warn "ข้ามขั้น schema - กลับมารันใหม่ทีหลัง"; return }

  Step "หา container ของ backend"
  $beName = & ssh -o StrictHostKeyChecking=no -i $cfg.sshKey "$($cfg.sshUser)@$($cfg.serverIp)" "docker ps --format '{{.Names}}\t{{.Image}}' | grep -v -E 'mssql|mysql|coolify' | head -1 | cut -f1"
  if (-not $beName) { Die "ไม่พบ container ของ backend" }
  Ok "backend = $beName"

  Step "รัน migrations"
  if ((Remote $cfg "docker exec $beName node run_migrations.js") -ne 0) { Die "migrations ล้มเหลว" }

  Step "เติมสิทธิ์ schema wf (กัน GRANT ถูกข้ามถ้า login สร้างทีหลัง)"
  RemoteScript $cfg "set -a; . /root/.wf-secrets; set +a`ndocker exec `"`$MSSQL_CONTAINER`" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P `"`$MSSQL_SA_PASSWORD`" -C -d `"`$MSSQL_DB`" -Q `"GRANT CONTROL ON SCHEMA::wf TO wf_owner; GRANT SELECT ON SCHEMA::wf TO wf_reader;`"" | Out-Null
  Ok "สิทธิ์ครบ"

  Step "seed ผู้ใช้ (admin + พนักงานจาก dbo.EMEmp)"
  if ((Remote $cfg "docker exec $beName node seed_admin.js") -ne 0) { Die "seed_admin ล้มเหลว" }
  Ok "สร้างผู้ใช้แล้ว - admin / $($cfg.adminPassword)"

  $cfg | Add-Member -NotePropertyName backendContainer -NotePropertyValue $beName -Force
  Save-Profile $cfg
  Mark-Done $cfg 'schema'
}

# =====================================================================
# STAGE 6 - verify
# =====================================================================
function Stage-Verify($cfg) {
  Head "ขั้น 6/7 - ตรวจความพร้อม"

  if ($cfg.backendContainer) {
    Step "preflight บน backend"
    Remote $cfg "docker exec $($cfg.backendContainer) node scripts/preflight-check.js" | Out-Null
  }

  Step "ทดสอบ URL จริง"
  $results = @()
  foreach ($u in @("https://$($cfg.apiDomain)/api/health", "https://$($cfg.appDomain)/")) {
    try { $code = (Invoke-WebRequest -Uri $u -TimeoutSec 25 -UseBasicParsing -ErrorAction Stop).StatusCode }
    catch { $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 } }
    $mark = if ($code -eq 200) { '[OK]' } else { '[X] ' }
    $col  = if ($code -eq 200) { 'Green' } else { 'Red' }
    Write-Host ("   {0} {1} -> HTTP {2}" -f $mark, $u, $code) -ForegroundColor $col
    $results += ($code -eq 200)
  }

  Step "ทดสอบ login"
  try {
    $body = @{ username = 'admin'; password = $cfg.adminPassword } | ConvertTo-Json
    $r = Invoke-WebRequest -Uri "https://$($cfg.apiDomain)/api/auth/login" -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 25 -UseBasicParsing
    if ($r.StatusCode -eq 200) { Ok "login admin สำเร็จ" } else { Warn "login ตอบ HTTP $($r.StatusCode)" }
  } catch { Warn "login ไม่ผ่าน: $($_.Exception.Message)" }

  if ($results -notcontains $false) { Ok "ระบบพร้อมใช้งาน"; Mark-Done $cfg 'verify' }
  else { Warn "ยังมีบางอย่างไม่ผ่าน - ตรวจ Coolify logs" }
}

# =====================================================================
# STAGE 7 - handover
# =====================================================================
function Stage-Handover($cfg) {
  Head "ขั้น 7/7 - เอกสารส่งมอบ"
  $outDir = Join-Path $PROFILE_DIR $cfg.customer
  $file = Join-Path $outDir "HANDOVER-$($cfg.customer).md"

  $md = @(
    "# ส่งมอบระบบ WS-Sale-App - $($cfg.customer)",
    "",
    "ติดตั้งเมื่อ: $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
    "",
    "## เข้าใช้งาน",
    "",
    "| รายการ | ค่า |",
    "|---|---|",
    "| หน้าเว็บ | https://$($cfg.appDomain) |",
    "| API | https://$($cfg.apiDomain) |",
    "| ผู้ดูแลระบบ | ``admin`` / ``$($cfg.adminPassword)`` |",
    "",
    "> **W0rld ใช้เลขศูนย์** ไม่ใช่ตัวอักษร O",
    "> พนักงานทุกคน (``emp-XXXXX``) ใช้รหัสเริ่มต้นเดียวกัน",
    "",
    "## สิ่งที่ต้องทำทันทีหลังรับมอบ",
    "",
    "- [ ] เปลี่ยนรหัส ``admin``",
    "- [ ] บังคับพนักงานเปลี่ยนรหัสครั้งแรกที่เข้าใช้",
    "- [ ] ตั้ง backup อัตโนมัติ (``/root/backup-databases.sh`` + cron)",
    "- [ ] ตั้ง LINE Login ถ้าต้องใช้ (``LINE_LOGIN_*`` ใน env ของ backend)",
    "- [ ] repoint ซอฟต์แวร์ตาชั่งหน้างานมาที่ MySQL ตัวใหม่ (ทำท้ายสุด วางแผน cutover)",
    "",
    "## โครงสร้างระบบ",
    "",
    '```',
    "Coolify Cloud  ->  VPS $($cfg.serverIp)",
    "                    |- wf-frontend  (nginx, /WSSale-App)",
    "                    |- wf-backend   (Node 22, /backend)",
    "                    '- wf-databases (SQL Server 2022 Express + MySQL 8)",
    '```',
    "",
    "| ส่วน | ค่า |",
    "|---|---|",
    "| Repository | $($cfg.repo) (branch ``$($cfg.branch)``) |",
    "| SQL Server DB | ``$($cfg.dbName)`` |",
    "| MySQL DB | ``$($cfg.mysqlDb)`` |",
    "| container mssql | ``$($cfg.mssqlContainer)`` |",
    "| container mysql | ``$($cfg.mysqlContainer)`` |",
    "",
    "## เข้าถึงฐานข้อมูล (SSMS / DBeaver)",
    "",
    "DB ไม่ได้เปิดสู่อินเทอร์เน็ต ต้องผ่าน SSH tunnel:",
    '```powershell',
    "ssh -N -L 14330:127.0.0.1:1433 -L 33060:127.0.0.1:3306 -i <key> $($cfg.sshUser)@$($cfg.serverIp)",
    '```',
    "",
    "| เครื่องมือ | ค่าเชื่อมต่อ |",
    "|---|---|",
    "| SSMS | ``127.0.0.1,14330`` (คอมมา ไม่ใช่ colon) - **ห้ามใช้ localhost** |",
    "| DBeaver (MySQL) | ``127.0.0.1:33060`` db ``$($cfg.mysqlDb)`` user ``$($cfg.mysqlUser)`` |",
    "",
    "> ``localhost`` บน Windows แปลงเป็น IPv6 ``::1`` แต่ tunnel ผูก IPv4 -> จะ timeout (Error 258)",
    "> และห้ามเปิดหน้าต่าง SSH แบบ Run as administrator (bind loopback ไม่ได้)",
    "",
    "## การอัปเดตระบบ",
    "",
    "push ขึ้น branch ``$($cfg.branch)`` -> Coolify ดึงไป build อัตโนมัติ (ถ้าตั้ง webhook แล้ว)",
    "ถ้ามี migration ใหม่:",
    '```bash',
    "docker exec -it <backend-container> node run_migrations.js",
    '```',
    "",
    "## รหัสผ่านทั้งหมด",
    "",
    "อยู่ในไฟล์ ``$($cfg.customer).json`` ที่ผู้ติดตั้งเก็บไว้ - ส่งมอบแยกช่องทางที่ปลอดภัย",
    "**ห้ามใส่ไฟล์นี้ลง git**"
  )
  ($md -join "`r`n") | Set-Content $file -Encoding UTF8
  Ok "สร้างเอกสารส่งมอบ: $file"
  Mark-Done $cfg 'handover'
}

# =====================================================================
# MAIN
# =====================================================================
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) { Die "อย่าเปิดแบบ Run as administrator - ssh จะ bind พอร์ต loopback ไม่ได้" }
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { Die "ไม่พบคำสั่ง ssh" }

Head "WS-Sale-App - Wizard ติดตั้งให้ลูกค้าใหม่"

if (-not $Customer) {
  if (Test-Path $PROFILE_DIR) {
    $existing = Get-ChildItem $PROFILE_DIR -Filter *.json -ErrorAction SilentlyContinue
    if ($existing) { Write-Host ""; Info "ลูกค้าที่มีอยู่: $(($existing.BaseName) -join ', ')" }
  }
  $Customer = Ask "ชื่อลูกค้า (a-z0-9-)" $null
}
$cfg = Load-Profile $Customer

if ($Stage -eq 'status') {
  if (-not $cfg) { Die "ไม่พบ profile ของ '$Customer'" }
  Head "สถานะ: $($cfg.customer)"
  foreach ($s in 'bootstrap','coolify','data','schema','verify','handover') {
    $m = if (Is-Done $cfg $s) { '[เสร็จ] ' } else { '[รอ]   ' }
    Write-Host "  $m $s"
  }
  Write-Host ""; Read-Host "กด Enter เพื่อปิด"; exit 0
}

if ($Stage -eq 'all' -or $Stage -eq 'init') { $cfg = Stage-Init $cfg }
if (-not $cfg) { Die "ยังไม่มี profile - รันขั้น init ก่อน" }

function Run-Stage($name, $fn) {
  if ($Stage -ne 'all' -and $Stage -ne $name) { return }
  if ((Is-Done $cfg $name) -and -not $Force -and $Stage -eq 'all') { Warn "ข้าม $name (ทำไปแล้ว)"; return }
  & $fn $cfg
}

Run-Stage 'bootstrap' ${function:Stage-Bootstrap}
Run-Stage 'coolify'   ${function:Stage-Coolify}
Run-Stage 'data'      ${function:Stage-Data}
Run-Stage 'schema'    ${function:Stage-Schema}
Run-Stage 'verify'    ${function:Stage-Verify}
Run-Stage 'handover'  ${function:Stage-Handover}

Head "จบการทำงาน"
Info "profile : $(Get-ProfilePath $cfg.customer)"
Info "ไฟล์    : $(Join-Path $PROFILE_DIR $cfg.customer)"
Write-Host ""
Read-Host "กด Enter เพื่อปิด"
