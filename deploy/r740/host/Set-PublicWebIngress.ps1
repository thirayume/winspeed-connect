# Owner-authorized public web ingress only. No SQL, RDP or Docker port is opened.
# Default is inspection; -Apply creates/updates one named, reversible firewall rule.
[CmdletBinding()]
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$address = '172.16.30.169'
$name = 'SaleApp-R740-Public-Web-TCP'
if ($env:COMPUTERNAME -ne 'R740-SRV' -or
    -not (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $address -ErrorAction SilentlyContinue)) {
    throw 'This script is pinned to R740-SRV / 172.16.30.169.'
}
Write-Host 'Public TCP 80/443 -> R740 Caddy; UAT 8091/8444 retain their existing scope.'
if ($Apply) {
    $rule = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
    if ($rule) {
        if ($rule.DisplayGroup -ne 'SaleApp R740 public ingress') {
            throw 'Existing rule with this name is not managed by this script.'
        }
        $rule | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Any
        $rule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort 80,443 -RemotePort Any
        $rule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -LocalAddress $address -RemoteAddress Any
    } else {
        New-NetFirewallRule -Name $name -DisplayName 'SaleApp R740 public HTTP and HTTPS' `
            -Group 'SaleApp R740 public ingress' -Enabled True -Direction Inbound -Action Allow `
            -Profile Any -Protocol TCP -LocalAddress $address -LocalPort 80,443 -RemoteAddress Any | Out-Null
    }
    Write-Host 'APPLIED: only public TCP 80/443 on 172.16.30.169.'
}
Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
    $rule = $_; $port = $rule | Get-NetFirewallPortFilter; $scope = $rule | Get-NetFirewallAddressFilter
    [pscustomobject]@{Name=$rule.Name;Enabled=$rule.Enabled;Action=$rule.Action;
        LocalAddress=($scope.LocalAddress -join ',');LocalPort=($port.LocalPort -join ',');
        RemoteAddress=($scope.RemoteAddress -join ',')}
}
Write-Host "Rollback of this rule only: Remove-NetFirewallRule -Name '$name'"
