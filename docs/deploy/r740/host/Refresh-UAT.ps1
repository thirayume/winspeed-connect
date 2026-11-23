<#
  Refresh-UAT.ps1 - make the nightly restore self-healing on R740-SRV.

  The 21:00 job restores dbwins_worldfert9_uat from a fresh production backup, which drops the
  UAT-only users, schema changes and app accounts with the Production snapshot. Run this script
  as the LAST step of that job (Task Scheduler, as an account that is sysadmin on SQL2008). It:
    1. re-maps the wf_r740_uat_* users and grants in the restored database (sql/r740-uat-principals.sql);
    2. re-applies pending migrations and restarts the UAT stack, unattended (deploy-r740.ps1 -Auto);
    3. relabels the copied PROD Rebate state as UAT's own (sql/r740-uat-rebate-adopt.sql), so Rebate and
       every other function stay on in UAT (owner, 21 Nov 2026); if that fails, Rebate is switched off.
  It never touches production. All output is appended to D:\SaleApp\uat\deploy-logs\refresh-*.log.

  Once production (dbwins_worldfert9) itself carries the wf schema and migrations, the nightly copy
  arrives already migrated, so step 2 simply verifies and restarts. Step 1 also rebinds the fixed
  invoice metadata reader from the copied Production execution identity to the isolated UAT
  migrator; the Production users retain their UAT-only CONNECT denials.

  Example Task Scheduler action (after the restore step), run as R740-SRV\Administrator, highest privileges:
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\SaleApp\tools\Refresh-UAT.ps1
#>
[CmdletBinding()]
param(
  [string]$SqlServer = 'R740-SRV\SQL2008',
  [string]$Database = 'dbwins_worldfert9_uat',
  # Trusted (Windows) auth by default; pass -SqlUser/-SqlPassword only if the job account is not a SQL sysadmin.
  [string]$SqlUser,
  [string]$SqlPassword,
  [string]$AppDir = 'D:\SaleApp\uat\app',
  [string]$Distro = 'Ubuntu'
)
$ErrorActionPreference = 'Stop'
$logDir = 'D:\SaleApp\uat\deploy-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("refresh-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".log")
function Log([string]$m) { $line = "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $m; Write-Host $line; Add-Content -Path $log -Value $line }

try {
  if ($SqlServer -cne 'R740-SRV\SQL2008' -or $Database -cne 'dbwins_worldfert9_uat') {
    throw 'Refresh target must be R740-SRV\SQL2008 / dbwins_worldfert9_uat.'
  }
  Log "UAT refresh started ($SqlServer / $Database)"

  # 0. Owner, 21 Nov 2026: Rebate and every other function stay on in UAT. The UAT Rebate switches
  #    are set on here before every deploy (only REBATE_* keys are touched or logged; the other lines
  #    hold secrets). The restored copy carries PROD's Rebate state; step 3 relabels it as UAT's own.
  #    If that fails, step 3 turns the Rebate switches off again so bills and the rest keep working.
  $cfg = 'D:\SaleApp\uat\config\.env'
  function Set-UatRebateSwitches([bool]$On) {
    if (-not (Test-Path -LiteralPath $cfg)) { Log "UAT config not found: $cfg"; return $false }
    $raw = [IO.File]::ReadAllText($cfg)
    $eol = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
    $lines = @($raw -split "`r?`n")
    $want = [ordered]@{
      REBATE_POOL_103_ENABLED = $On; REBATE_CONVERSION_APPROVAL_ENABLED = $On; REBATE_CONVERSION_ENABLED = $On
      REBATE_TICKET_PREVIEW_ENABLED = $On; REBATE_RESET_ADMIN_ENABLED = $On; REBATE_RESET_FENCE_AUDIT_COMPLETE = $On
      REBATE_EVIDENCE_DISCOVERY_ENABLED = $On
    }
    $treatment = if ($On) { 'dbwins_worldfert9_uat:DISCOUNT' } else { '' }
    $changed = @(); $seen = @{}
    $new = foreach ($line in $lines) {
      if ($line -match '^(REBATE_[A-Z0-9_]+)=(.*)$' -and $want.Contains($Matches[1])) {
        $k = $Matches[1]; $seen[$k] = $true; $v = ([string]$want[$k]).ToLower()
        if ($Matches[2].Trim() -ne $v) { $changed += $k }
        "$k=$v"
      } elseif ($line -match '^REBATE_TICKET_REDEMPTION_TREATMENT=(.*)$') {
        $seen['REBATE_TICKET_REDEMPTION_TREATMENT'] = $true
        if ($Matches[1].Trim() -ne $treatment) { $changed += 'REBATE_TICKET_REDEMPTION_TREATMENT' }
        "REBATE_TICKET_REDEMPTION_TREATMENT=$treatment"
      } else { $line }
    }
    $add = @()
    foreach ($k in $want.Keys) { if (-not $seen[$k]) { $add += "$k=$(([string]$want[$k]).ToLower())"; $changed += $k } }
    if (-not $seen['REBATE_TICKET_REDEMPTION_TREATMENT']) { $add += "REBATE_TICKET_REDEMPTION_TREATMENT=$treatment"; $changed += 'REBATE_TICKET_REDEMPTION_TREATMENT' }
    if ($changed.Count -eq 0) { Log ("Rebate switches already " + $(if ($On) { 'on' } else { 'off' }) + "."); return $true }
    Copy-Item -LiteralPath $cfg -Destination ($cfg + '.bak-refresh-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $body = @($new)
    while ($body.Count -gt 0 -and $body[-1] -eq '') { $body = @($body[0..($body.Count - 2)]) }
    $text = (($body + $add) -join $eol) + $eol
    [IO.File]::WriteAllText($cfg, $text, (New-Object System.Text.UTF8Encoding($false)))
    Log ("Rebate switches set " + $(if ($On) { 'on' } else { 'off' }) + ": " + ($changed -join ', '))
    return $true
  }
  try { [void](Set-UatRebateSwitches $true) } catch { Log ("Rebate switch step failed: " + $_.Exception.Message) }

  # 1. Re-map the Sale-App principals in the freshly restored copy (needs SQL sysadmin).
  $sqlFile = Join-Path $AppDir 'docs\deploy\r740\sql\r740-uat-principals.sql'
  if (-not (Test-Path $sqlFile)) { $sqlFile = 'D:\SaleApp\tools\r740-uat-principals.sql' }
  if (-not (Test-Path $sqlFile)) { throw "principals SQL not found: $sqlFile" }
  $sqlcmd = (Get-Command sqlcmd.exe -ErrorAction SilentlyContinue).Source
  if (-not $sqlcmd) {
    $sqlcmd = Get-ChildItem 'C:\Program Files\Microsoft SQL Server\*\Tools\Binn\SQLCMD.EXE' -ErrorAction SilentlyContinue |
      Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $sqlcmd) { throw 'sqlcmd.exe not found on this server.' }
  $sqlArgs = @('-S', $SqlServer)
  if ($SqlUser) { $sqlArgs += @('-U', $SqlUser, '-P', $SqlPassword) } else { $sqlArgs += '-E' }
  $sqlArgs += @('-b', '-i', $sqlFile)
  Log "Re-mapping principals with $(Split-Path $sqlcmd -Leaf) ..."
  $out = & $sqlcmd @sqlArgs 2>&1
  $out | ForEach-Object { Add-Content -Path $log -Value "  sql: $_" }
  if ($LASTEXITCODE -ne 0) { throw "principals SQL failed (exit $LASTEXITCODE); see $log" }
  Log "Principals re-mapped."

  # 2. Re-apply migrations and restart the stack, unattended (uat only).
  Log "Running the unattended UAT deploy ..."
  $driver = Join-Path $AppDir 'docs\deploy\r740\deploy-r740.ps1'
  if (-not (Test-Path $driver)) { throw "deploy driver not found: $driver (deploy UAT once from the dev PC first)" }
  # The deploy builds images; buildx progress goes to stderr, so do not let a stderr line
  # become a terminating error. Check the exit code instead.
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $driver -Environment uat -OnServer -Auto -Distro $Distro *>&1 |
    ForEach-Object { Add-Content -Path $log -Value ("  deploy: " + $_); Write-Host $_ }
  $deployExit = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($deployExit -ne 0) { throw "unattended deploy failed (exit $deployExit); see $log" }

  # Rebind only an already approved, copied Production v3 release. The helper
  # verifies exact current modules/roles/holds; it never opens Production or
  # invents a new approval. Any mismatch keeps the native target fenced.
  $targetFile=Join-Path $AppDir 'docs\deploy\r740\targets\uat.env'
  if([IO.File]::ReadAllText($targetFile) -match '(?m)^NATIVE_DOCUMENT_WRITER_VERSION=v3\r?$') {
    Log 'Revalidating copied native writer approval for UAT ...'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $driver -Environment uat -OnServer -Auto -NativeWriterRefresh -Distro $Distro *>&1 |
      ForEach-Object { Add-Content -Path $log -Value ("  native: " + $_); Write-Host $_ }
    if($LASTEXITCODE -ne 0){throw 'Native UAT refresh proof failed; native writers remain fenced pending review.'}
  }

  # 3. Relabel the copied PROD Rebate state as UAT's own (sql/r740-uat-rebate-adopt.sql). The digest of
  #    UAT's reset manifest comes from the running UAT backend (names only, no secret).
  $adopted = $false
  try {
    $adoptSql = Join-Path $AppDir 'docs\deploy\r740\sql\r740-uat-rebate-adopt.sql'
    if (-not (Test-Path $adoptSql)) { throw "adopt SQL not found: $adoptSql" }
    $digest = ($null | & wsl.exe -d $Distro -u root -- docker exec saleapp-uat-backend-1 node scripts/rebate-manifest-digest.js 2>&1 |
      Select-Object -Last 1)
    $digest = [string]$digest
    if ($digest -notmatch '^[0-9a-f]{64}$') { throw "UAT manifest digest unavailable: $digest" }
    $adoptArgs = @('-S', $SqlServer)
    if ($SqlUser) { $adoptArgs += @('-U', $SqlUser, '-P', $SqlPassword) } else { $adoptArgs += '-E' }
    $adoptArgs += @('-b', '-I', '-d', $Database, '-W', '-v', "UatDigest=$digest", '-i', $adoptSql)
    Log "Relabelling the copied Rebate state for UAT ..."
    $out = & $sqlcmd @adoptArgs 2>&1
    $out | ForEach-Object { Add-Content -Path $log -Value "  adopt: $_" }
    if ($LASTEXITCODE -ne 0) { throw "adopt SQL failed (exit $LASTEXITCODE)" }
    $adopted = $true
    Log "Rebate state relabelled for UAT; Rebate stays on."
  } catch {
    Log ("Rebate relabel FAILED: " + $_.Exception.Message + " - turning the UAT Rebate switches off and restarting")
    if (Set-UatRebateSwitches $false) {
      $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $driver -Environment uat -OnServer -Auto -Distro $Distro *>&1 |
        ForEach-Object { Add-Content -Path $log -Value ("  deploy: " + $_); Write-Host $_ }
      $restartExit = $LASTEXITCODE
      $ErrorActionPreference = $prev
      if ($restartExit -ne 0) { throw "restart without Rebate failed (exit $restartExit); see $log" }
    }
    throw "UAT runs without Rebate tonight; see $log"
  }

  Log "UAT refresh complete."
  exit 0
} catch {
  Log ("UAT refresh FAILED: " + $_.Exception.Message)
  exit 1
}
