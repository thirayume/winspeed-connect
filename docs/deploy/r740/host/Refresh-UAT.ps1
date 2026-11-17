<#
  Refresh-UAT.ps1 - make the nightly restore self-healing on R740-SRV.

  The 21:00 job restores dbwins_worldfert9_uat from a fresh production backup, which drops the
  UAT-only users, schema changes and app accounts with the Production snapshot. Run this script
  as the LAST step of that job (Task Scheduler, as an account that is sysadmin on SQL2008). It:
    1. re-maps the wf_r740_uat_* users and grants in the restored database (sql/r740-uat-principals.sql);
    2. re-applies pending migrations and restarts the UAT stack, unattended (deploy-r740.ps1 -Auto).
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

  # 0. The restored copy carries Production's Rebate reset state (a 'production' coordinator and
  #    participant), never one for 'uat'. With the UAT Rebate switches on, every fenced Rebate route
  #    then answers 503 and a UAT bootstrap is refused (REBATE_BOOTSTRAP_PRIOR_HISTORY); bill
  #    confirmation is not fenced. Switch them off in the UAT config so the deploy below starts the
  #    backend without them (UAT run, 17 Nov 2026). Only REBATE_* keys are touched or logged; the
  #    other lines hold secrets. Turning Rebate on for UAT again is a deliberate step after a reset.
  try {
    $cfg = 'D:\SaleApp\uat\config\.env'
    if (Test-Path -LiteralPath $cfg) {
      $raw = [IO.File]::ReadAllText($cfg)
      $eol = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
      $lines = $raw -split "`r?`n"
      $switchKey = '^(REBATE_[A-Z0-9_]+_ENABLED|REBATE_RESET_FENCE_AUDIT_COMPLETE)=(.*)$'
      $on = @($lines | Where-Object { $_ -match $switchKey -and $Matches[2].Trim() -ne 'false' })
      if ($on.Count -gt 0) {
        Copy-Item -LiteralPath $cfg -Destination ($cfg + '.bak-refresh-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        $new = foreach ($line in $lines) {
          if ($line -match $switchKey) { $Matches[1] + '=false' }
          elseif ($line -match '^REBATE_TICKET_REDEMPTION_TREATMENT=') { 'REBATE_TICKET_REDEMPTION_TREATMENT=' }
          else { $line }
        }
        [IO.File]::WriteAllText($cfg, ($new -join $eol), (New-Object System.Text.UTF8Encoding($false)))
        Log ("Rebate switches turned off for the restored copy: " + (($on | ForEach-Object { ($_ -split '=')[0] }) -join ', '))
      } else { Log "Rebate switches already off." }
    }
  } catch { Log ("Rebate switch step skipped: " + $_.Exception.Message) }

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

  Log "UAT refresh complete."
  exit 0
} catch {
  Log ("UAT refresh FAILED: " + $_.Exception.Message)
  exit 1
}
