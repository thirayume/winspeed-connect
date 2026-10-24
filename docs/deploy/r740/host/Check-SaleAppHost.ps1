<#
  Check-SaleAppHost.ps1 - read-only host check for Sale-App on R740-SRV.

  Run in an elevated Windows PowerShell, signed in as the Windows user that
  installed WSL Ubuntu (WSL distributions are per user):

    powershell -NoProfile -ExecutionPolicy Bypass -File D:\SaleApp\tools\Check-SaleAppHost.ps1

  It writes D:\SaleApp\tools\out\host-check-<timestamp>.txt.
  It does not install, start, stop or configure anything, does not connect to
  SQL Server, and does not read .env, password or credential files.
  The WSL section runs tools\wsl-check.sh inside each registered distribution;
  that starts a stopped distribution (and Docker, if systemd enables it).
  Use -SkipWsl to leave WSL untouched.
#>
[CmdletBinding()]
param(
  [string]$OutDir = 'D:\SaleApp\tools\out',
  [switch]$SkipWsl
)

$ErrorActionPreference = 'Continue'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$outFile = Join-Path $OutDir "host-check-$stamp.txt"
$report = New-Object System.Collections.Generic.List[string]

function Section([string]$title) { $report.Add(''); $report.Add("===== $title =====") }
function Add-Lines($value) {
  if ($null -eq $value) { return }
  foreach ($line in (($value | Out-String -Width 220).TrimEnd() -split "`r?`n")) { $report.Add($line) }
}
function Run([string]$label, [scriptblock]$block) {
  $report.Add("--- $label")
  try { Add-Lines (& $block 2>&1) } catch { $report.Add("ERROR: $($_.Exception.Message)") }
}

$watchPorts = @(22, 80, 443, 1433, 1434, 2375, 2376, 3000, 5985, 5986, 8080, 8081, 8443, 8444, 9000, 9443)

Section 'Host'
Run 'computer and user' {
  $os = Get-CimInstance Win32_OperatingSystem
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $admin = (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  [pscustomobject]@{
    Computer = $env:COMPUTERNAME; OS = $os.Caption; Build = $os.BuildNumber
    LastBoot = $os.LastBootUpTime; User = $id.Name; Elevated = $admin
    PowerShell = $PSVersionTable.PSVersion.ToString(); Report = $outFile
  } | Format-List
}

Section 'Windows features'
Run 'server features' {
  Get-WindowsFeature -Name Hyper-V, Containers, Microsoft-Windows-Subsystem-Linux -ErrorAction SilentlyContinue |
    Select-Object Name, InstallState | Format-Table -AutoSize
}
Run 'optional features' {
  foreach ($f in 'VirtualMachinePlatform', 'Microsoft-Windows-Subsystem-Linux') {
    Get-WindowsOptionalFeature -Online -FeatureName $f -ErrorAction SilentlyContinue | Select-Object FeatureName, State
  }
}

Section 'Services'
Run 'services' {
  $names = 'docker', 'com.docker.service', 'WSLService', 'LxssManager', 'vmms', 'MSSQL$SQL2008', 'SQLAgent$SQL2008',
           'SQLBrowser', 'ReportServer$SQL2008', 'W3SVC', 'sshd', 'ssh-agent', 'WinRM'
  $installed = @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue)
  foreach ($n in $names) {
    $s = $installed | Where-Object Name -eq $n | Select-Object -First 1
    if ($s) { [pscustomobject]@{ Name = $s.Name; State = $s.State; StartMode = $s.StartMode; Account = $s.StartName } }
    else { [pscustomobject]@{ Name = $n; State = 'NOT INSTALLED'; StartMode = ''; Account = '' } }
  }
}

Section 'Processes'
Run 'docker/wsl/vm processes' {
  Get-Process -Name dockerd, docker, 'Docker Desktop', com.docker.backend, com.docker.build, wslservice, wslhost, wslrelay, vmmem, vmmemWSL, vmwp -ErrorAction SilentlyContinue |
    Select-Object Name, Id, StartTime, @{ n = 'WorkingSetMB'; e = { [math]::Round($_.WorkingSet64 / 1MB) } } | Format-Table -AutoSize
}

Section 'Docker CLI on Windows'
Run 'docker.exe on PATH' { Get-Command docker -All -ErrorAction SilentlyContinue | Select-Object Source, Version | Format-Table -AutoSize }
Run 'DOCKER_HOST / DOCKER_CONTEXT' { "DOCKER_HOST=$env:DOCKER_HOST"; "DOCKER_CONTEXT=$env:DOCKER_CONTEXT" }
Run 'docker named pipes' { [System.IO.Directory]::GetFiles('\\.\pipe\') | Where-Object { $_ -match 'docker' } }
if (Get-Command docker -ErrorAction SilentlyContinue) {
  Run 'docker context ls' { docker context ls }
  Run 'docker version' { docker version --format 'client {{.Client.Version}} / server {{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}' }
  Run 'docker info' { docker info --format 'OSType={{.OSType}} Server={{.ServerVersion}} OS={{.OperatingSystem}} Root={{.DockerRootDir}}' }
  Run 'docker compose version' { docker compose version }
  Run 'containers' { docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' }
}

Section 'WSL'
$env:WSL_UTF8 = '1'
Run 'wsl --version' { wsl.exe --version }
Run 'wsl --status' { wsl.exe --status }
Run 'wsl -l -v' { wsl.exe --list --verbose }
Run '.wslconfig' {
  $cfg = Join-Path $env:USERPROFILE '.wslconfig'
  if (Test-Path $cfg) { Get-Content $cfg } else { "(no $cfg)" }
}
if (-not $SkipWsl) {
  $wslScript = Join-Path $PSScriptRoot 'wsl-check.sh'
  $distros = @(wsl.exe --list --quiet 2>$null | ForEach-Object { ($_ -replace "`0", '').Trim() } |
    Where-Object { $_ -and $_ -notmatch '^docker-desktop' })
  if (-not (Test-Path $wslScript)) { $report.Add("wsl-check.sh not found next to this script; WSL detail skipped.") }
  elseif ($distros.Count -eq 0) { $report.Add('No user WSL distribution is registered for this Windows user.') }
  else {
    $drive = $wslScript.Substring(0, 1).ToLower()
    $linuxPath = '/mnt/' + $drive + ($wslScript.Substring(2) -replace '\\', '/')
    foreach ($d in $distros) {
      Run "distro $d (read-only check as root)" { wsl.exe --distribution $d --user root --exec /bin/sh $linuxPath }
    }
  }
}

Section 'Hyper-V'
Run 'VMs' {
  Get-VM -ErrorAction Stop | Select-Object Name, State, Uptime, @{ n = 'MemoryMB'; e = { [math]::Round($_.MemoryAssigned / 1MB) } }, Path |
    Format-Table -AutoSize
}
Run 'VM network adapters' { Get-VMNetworkAdapter -VMName * -ErrorAction Stop | Select-Object VMName, SwitchName, IPAddresses | Format-Table -AutoSize }
Run 'virtual switches' { Get-VMSwitch -ErrorAction Stop | Select-Object Name, SwitchType, NetAdapterInterfaceDescription | Format-Table -AutoSize }

Section 'Network'
Run 'IPv4 addresses' {
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object IPAddress -ne '127.0.0.1' |
    Select-Object InterfaceAlias, IPAddress, PrefixLength | Format-Table -AutoSize
}
Run 'TCP listeners on watched ports (and every SQL Server listener)' {
  $sqlPids = @(Get-Process -Name sqlservr -ErrorAction SilentlyContinue | ForEach-Object Id)
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $watchPorts -contains $_.LocalPort -or $sqlPids -contains $_.OwningProcess } |
    Sort-Object LocalPort |
    Select-Object LocalAddress, LocalPort, OwningProcess, @{ n = 'Process'; e = { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName } } |
    Format-Table -AutoSize
}
Run 'HTTP.SYS listen list' { netsh http show iplisten }
Run 'HTTP.SYS URL reservations on :80 / :443' {
  netsh http show urlacl | Select-String -Pattern 'Reserved URL' | Where-Object { $_.Line -match ':80/|:443/|\+:80|\+:443' } | ForEach-Object { $_.Line.Trim() }
}
Run 'HTTP.SYS active registrations on :80 / :443' {
  netsh http show servicestate view=requestq | Select-String -Pattern ':80/|:443/' | ForEach-Object { $_.Line.Trim() } | Sort-Object -Unique
}
Run 'portproxy rules' { netsh interface portproxy show all }

Section 'SQL Server instance network settings (registry, read-only)'
Run 'instances' { Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL' -ErrorAction Stop |
  Select-Object * -ExcludeProperty PS* | Format-List }
Run 'SQL2008 TCP' {
  $base = 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQL10_50.SQL2008\MSSQLServer'
  $tcp = Get-ItemProperty "$base\SuperSocketNetLib\Tcp" -ErrorAction Stop
  $all = Get-ItemProperty "$base\SuperSocketNetLib\Tcp\IPAll" -ErrorAction Stop
  $lib = Get-ItemProperty "$base\SuperSocketNetLib" -ErrorAction SilentlyContinue
  $ver = Get-ItemProperty "$base\CurrentVersion" -ErrorAction SilentlyContinue
  [pscustomobject]@{
    TcpEnabled = $tcp.Enabled; ListenOnAllIPs = $tcp.ListenOnAllIPs
    IPAll_TcpPort = $all.TcpPort; IPAll_TcpDynamicPorts = $all.TcpDynamicPorts
    ForceEncryption = $lib.ForceEncryption; CertificateConfigured = [bool]$lib.Certificate
    Version = $ver.CurrentVersion
  } | Format-List
}

Section 'Firewall (enabled inbound rules on watched ports)'
Run 'rules' {
  Get-NetFirewallPortFilter -ErrorAction SilentlyContinue |
    Where-Object { $p = $_.LocalPort; @($p) | Where-Object { $watchPorts -contains ($_ -as [int]) } } |
    Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' } |
    Select-Object DisplayName, Profile, Action | Sort-Object DisplayName -Unique | Format-Table -AutoSize
}

Section 'Disks'
Run 'volumes' {
  Get-Volume -ErrorAction SilentlyContinue | Where-Object DriveLetter |
    Select-Object DriveLetter, FileSystemLabel, @{ n = 'SizeGB'; e = { [math]::Round($_.Size / 1GB) } }, @{ n = 'FreeGB'; e = { [math]::Round($_.SizeRemaining / 1GB) } } |
    Format-Table -AutoSize
}

Section 'Git and folders'
Run 'git' { Get-Command git -ErrorAction SilentlyContinue | Select-Object Source, Version | Format-Table -AutoSize }
Run 'D:\SaleApp tree (folders only)' {
  if (Test-Path 'D:\SaleApp') { Get-ChildItem 'D:\SaleApp' -Directory -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object FullName }
}
Run 'D:\Web-SaleApp git' {
  if ((Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path 'D:\Web-SaleApp\.git')) {
    git -c safe.directory=* -C 'D:\Web-SaleApp' log -1 --format='%h %ad %s' --date=iso
    git -c safe.directory=* -C 'D:\Web-SaleApp' status -sb
  }
}

$report.Add('')
$report.Add("===== end $(Get-Date -Format s) =====")
[System.IO.File]::WriteAllLines($outFile, $report, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Report written: $outFile"
