<#
  SaleApp-KeepAlive.ps1 - started at boot by the scheduled task \SaleApp\SaleApp-WSL-KeepAlive
  (registered by Set-SaleAppHost.ps1). Keeps WSL Ubuntu, the Docker engine of the Sale-App
  stacks and Portainer, running, and makes sure the portproxy listeners on the LAN address
  are bound. Logs to D:\SaleApp\tools\out\keepalive.log. It changes nothing else.

  Why: at boot the task can run before WSL is ready (wsl.exe then fails once and nothing
  retries), and IP Helper binds portproxy only to addresses present when it starts.
#>
[CmdletBinding()]
param(
  [string]$Distro = 'Ubuntu',
  [string]$ListenAddress = '172.16.30.169',
  [int[]]$Ports = @(443, 8090, 8444, 8091),
  [string]$LogFile = 'D:\SaleApp\tools\out\keepalive.log'
)
$ErrorActionPreference = 'Continue'
$wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'

function Write-Log([string]$message) {
  try { Add-Content -Path $LogFile -Value ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $message) } catch { }
}

function Get-BoundCount {
  @(Get-NetTCPConnection -State Listen -LocalAddress $ListenAddress -ErrorAction SilentlyContinue |
    Where-Object { $Ports -contains $_.LocalPort }).Count
}

function Confirm-PortProxy {
  for ($i = 0; $i -lt 60 -and -not (Get-NetIPAddress -IPAddress $ListenAddress -ErrorAction SilentlyContinue); $i++) {
    Start-Sleep -Seconds 5
  }
  if ((Get-BoundCount) -lt $Ports.Count) {
    Restart-Service -Name iphlpsvc -Force
    Start-Sleep -Seconds 3
    Write-Log ("portproxy was not bound; restarted IP Helper, now {0} of {1} ports listen on {2}" -f (Get-BoundCount), $Ports.Count, $ListenAddress)
  }
}

Write-Log 'keep-alive started'
Confirm-PortProxy
while ($true) {
  Write-Log "starting WSL $Distro"
  & $wsl --distribution $Distro --user root --exec /bin/sleep infinity
  Write-Log "WSL exited with code $LASTEXITCODE; retrying in 30 seconds"
  Start-Sleep -Seconds 30
  Confirm-PortProxy
}
