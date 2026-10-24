<#
  Enable-SaleAppSsh.ps1 - lets the Sale-App dev PC run deploys on R740-SRV over SSH
  with a key, so nobody types a password into a script.

  THIS CHANGES THE SERVER. Read it first, then run it once in an elevated
  Windows PowerShell on R740-SRV:

    powershell -NoProfile -ExecutionPolicy Bypass -File D:\SaleApp\tools\Enable-SaleAppSsh.ps1 -AllowFrom 192.168.2.0/24

  It:
    1. installs the Windows OpenSSH Server capability (needs Windows Update or a
       Features-on-Demand source) and sets sshd to start automatically;
    2. adds one public key (the dev PC's dedicated deploy key) for administrator
       accounts in C:\ProgramData\ssh\administrators_authorized_keys and limits
       that file to Administrators and SYSTEM;
    3. limits the inbound SSH firewall rule to the -AllowFrom addresses (the VPN
       range the dev PC connects from).
  It does not change passwords, users, SQL Server, Docker or WSL.
  To undo: Stop-Service sshd; Set-Service sshd -StartupType Disabled, and remove
  the key line from administrators_authorized_keys.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string[]]$AllowFrom
)
$ErrorActionPreference = 'Stop'
$publicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGU6TVDOWIpGwpUUgA3owR4P2vtJsegVVPPGcd/fWvyc claude-wf-onprem-20261009'

$cap = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' | Select-Object -First 1
if (-not $cap) { throw 'OpenSSH.Server capability is not offered by this Windows image.' }
if ($cap.State -ne 'Installed') {
  Write-Host "Installing $($cap.Name) ..."
  Add-WindowsCapability -Online -Name $cap.Name | Out-Null
}
Set-Service -Name sshd -StartupType Automatic
Start-Service -Name sshd

$keyFile = Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
$present = (Test-Path $keyFile) -and (Select-String -Path $keyFile -SimpleMatch $publicKey -Quiet)
if (-not $present) { Add-Content -Path $keyFile -Value $publicKey -Encoding ascii }
icacls.exe $keyFile /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F' | Out-Null

$ruleName = 'OpenSSH-Server-In-TCP'
if (-not (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -Name $ruleName -DisplayName 'OpenSSH Server (sshd)' -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow | Out-Null
}
Set-NetFirewallRule -Name $ruleName -RemoteAddress $AllowFrom

Get-Service sshd | Select-Object Name, Status, StartType | Format-Table -AutoSize
Get-NetFirewallRule -Name $ruleName | Get-NetFirewallAddressFilter | Select-Object RemoteAddress | Format-Table -AutoSize
Write-Host "SSH is ready. Key comment: claude-wf-onprem-20261009"
