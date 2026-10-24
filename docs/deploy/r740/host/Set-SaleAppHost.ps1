<#
  Set-SaleAppHost.ps1 - one-time host setup on R740-SRV so the Sale-App containers in
  WSL Ubuntu keep running after every session closes and can be reached from the LAN.

  The default is a dry run that only prints the current state and the planned changes.
  Add -Apply to make them. Run in an elevated Windows PowerShell as R740-SRV\Administrator
  (the Windows user that owns WSL Ubuntu):

    powershell -NoProfile -ExecutionPolicy Bypass -File D:\SaleApp\tools\Set-SaleAppHost.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File D:\SaleApp\tools\Set-SaleAppHost.ps1 -Apply

  With -Apply it:
    1. creates %USERPROFILE%\.wslconfig with vmIdleTimeout=-1 and instanceIdleTimeout=-1
       (an existing file is left unchanged and reported);
    2. registers (or updates) the scheduled task \SaleApp\SaleApp-WSL-KeepAlive: one minute
       after startup, as this user without a stored password (S4U), it runs
       SaleApp-KeepAlive.ps1, which keeps WSL and Docker up (retrying if WSL is not ready)
       and rebinds portproxy if needed. When it creates .wslconfig it runs "wsl --shutdown"
       once so the timeouts apply; it then restarts the task (containers restart briefly);
    3. adds netsh portproxy rules <ListenAddress>:<port> -> 127.0.0.1:<port>; WSL relays
       127.0.0.1 into Ubuntu, so this needs no WSL IP address;
    4. adds inbound firewall rules for those ports, limited to -AllowFrom. The scope of an
       existing rule changes only when -AllowFrom is given.
  It does not touch IIS, SSRS, SQL Server, Docker Desktop, the Windows Docker engine,
  the databases or any password.
  Undo: Unregister-ScheduledTask -TaskPath \SaleApp\ -TaskName SaleApp-WSL-KeepAlive;
        netsh interface portproxy delete v4tov4 listenaddress=<ip> listenport=<port>;
        Remove-NetFirewallRule -Name SaleApp-In-TCP-<port>; delete .wslconfig.
#>
[CmdletBinding()]
param(
  [string]$ListenAddress = '172.16.30.169',
  [int[]]$Ports = @(443, 8090, 8444, 8091),
  [string[]]$AllowFrom = @('172.16.30.0/24', '192.168.2.0/24'),
  [string]$Distro = 'Ubuntu',
  [string]$KeepAliveScript,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell leaves $PSScriptRoot empty in parameter defaults.
if (-not $KeepAliveScript) { $KeepAliveScript = Join-Path $PSScriptRoot 'SaleApp-KeepAlive.ps1' }
$taskPath = '\SaleApp\'
$taskName = 'SaleApp-WSL-KeepAlive'
$wslExe = Join-Path $env:SystemRoot 'System32\wsl.exe'
$wslConfig = Join-Path $env:USERPROFILE '.wslconfig'
# The real account (e.g. R740-SRV\Administrator); USERDOMAIN can name the AD domain instead.
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$env:WSL_UTF8 = '1'
function Step([string]$text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Plan([string]$text) { Write-Host ("  " + $(if ($Apply) { 'DO   ' } else { 'PLAN ' }) + $text) }

Step 'Checks'
$distros = @(& $wslExe --list --quiet 2>$null | ForEach-Object { ($_ -replace "`0", '').Trim() } | Where-Object { $_ })
if ($distros -notcontains $Distro) { throw "WSL distribution '$Distro' is not registered for $account." }
if (-not (Get-NetIPAddress -IPAddress $ListenAddress -ErrorAction SilentlyContinue)) { throw "$ListenAddress is not an address of this server." }
$iphlp = Get-Service iphlpsvc
if ($iphlp.Status -ne 'Running') { throw 'The IP Helper service (iphlpsvc) must be running for portproxy.' }
foreach ($p in $Ports) {
  $owner = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -in @('0.0.0.0', '::', $ListenAddress) }
  if ($owner) {
    $names = ($owner | ForEach-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName } | Sort-Object -Unique) -join ','
    Write-Host "  port $p already listened on $ListenAddress/any by: $names (ok only if it is our earlier portproxy)"
  } else { Write-Host "  port $p is free on $ListenAddress" }
}

Step '1. WSL idle timeouts'
$createdConfig = $false
if (Test-Path $wslConfig) {
  Write-Host "  $wslConfig exists; left unchanged. Current content:"
  Get-Content $wslConfig | ForEach-Object { Write-Host "    $_" }
} else {
  Plan "create $wslConfig with [wsl2] vmIdleTimeout=-1 and [general] instanceIdleTimeout=-1"
  if ($Apply) {
    $ini = "[wsl2]`r`nvmIdleTimeout=-1`r`n`r`n[general]`r`ninstanceIdleTimeout=-1`r`n"
    [System.IO.File]::WriteAllText($wslConfig, $ini, (New-Object System.Text.UTF8Encoding $false))
    $createdConfig = $true
  }
}

Step '2. Keep-alive scheduled task'
if (-not (Test-Path $KeepAliveScript)) { throw "keep-alive script not found: $KeepAliveScript" }
$existing = Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue
Write-Host ("  current: " + $(if ($existing) { "registered, state $($existing.State)" } else { 'not registered' }))
Plan "register $taskPath$taskName (1 minute after startup, S4U as $account): $KeepAliveScript"
if (-not (Test-Path $wslConfig) -or $createdConfig) { Plan 'run wsl --shutdown once so the new timeouts apply' }
Plan 'start the task again (WSL containers may restart briefly)'
if ($Apply) {
  $action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Distro {1} -ListenAddress {2}' -f $KeepAliveScript, $Distro, $ListenAddress)
  $trigger = New-ScheduledTaskTrigger -AtStartup
  # At boot WSL may not be ready yet; the script also retries.
  $trigger.Delay = 'PT1M'
  $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType S4U -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Description 'Keeps WSL Ubuntu (Docker for Sale-App) running.' -Force | Out-Null
  if ($existing -and $existing.State -eq 'Running') {
    Stop-ScheduledTask -TaskPath $taskPath -TaskName $taskName
    Start-Sleep -Seconds 3
  }
  if ($createdConfig) {
    & $wslExe --shutdown
    Start-Sleep -Seconds 3
  }
  Start-ScheduledTask -TaskPath $taskPath -TaskName $taskName
  Start-Sleep -Seconds 20
  $t = Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName
  $i = Get-ScheduledTaskInfo -TaskPath $taskPath -TaskName $taskName
  Write-Host "  task state: $($t.State), last result: 0x$('{0:X}' -f $i.LastTaskResult) (0x41301 = running)"
  & $wslExe --list --verbose
}

Step '3. Port forwarding (portproxy)'
$proxies = (netsh interface portproxy show v4tov4) -join "`n"
foreach ($p in $Ports) {
  $has = $proxies -match ("(?m)^\s*" + [regex]::Escape($ListenAddress) + "\s+$p\s+127\.0\.0\.1\s+$p\s*$")
  if ($has) { Write-Host "  $ListenAddress`:$p -> 127.0.0.1:$p already present" }
  else {
    Plan "portproxy $ListenAddress`:$p -> 127.0.0.1:$p"
    if ($Apply) {
      netsh interface portproxy add v4tov4 listenaddress=$ListenAddress listenport=$p connectaddress=127.0.0.1 connectport=$p | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "netsh portproxy add failed for port $p" }
    }
  }
}

Step '4. Firewall'
$scopeGiven = $PSBoundParameters.ContainsKey('AllowFrom')
foreach ($p in $Ports) {
  $name = "SaleApp-In-TCP-$p"
  $rule = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
  if ($rule -and -not $scopeGiven) {
    $current = (($rule | Get-NetFirewallAddressFilter).RemoteAddress) -join ', '
    Write-Host "  rule $name exists (from $current); scope unchanged, pass -AllowFrom to change it"
    continue
  }
  Plan ("{0} rule {1}: inbound TCP {2} from {3}" -f $(if ($rule) { 'update' } else { 'add' }), $name, $p, ($AllowFrom -join ', '))
  if ($Apply) {
    if ($rule) { Set-NetFirewallRule -Name $name -RemoteAddress $AllowFrom -Enabled True }
    else {
      New-NetFirewallRule -Name $name -DisplayName "Sale-App inbound TCP $p" -Direction Inbound -Protocol TCP `
        -LocalPort $p -RemoteAddress $AllowFrom -Action Allow -Profile Any | Out-Null
    }
  }
}

Write-Host ''
if ($Apply) { Write-Host 'Applied.' -ForegroundColor Green }
else { Write-Host 'Dry run only. Re-run with -Apply to make these changes.' -ForegroundColor Yellow }
