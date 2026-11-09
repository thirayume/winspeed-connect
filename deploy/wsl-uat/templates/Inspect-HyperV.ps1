param([switch]$ProbeNetwork, [string]$SqlHost, [ValidateRange(1,65535)][int]$SqlPort = 1433)
# Read-only inventory. Run on the prepared Windows host. No credentials or config mutation.
$ErrorActionPreference = 'Stop'
$inventory = [ordered]@{ CollectedAt = (Get-Date).ToString('o'); Scope = 'Read-only inventory' }
$os = Get-CimInstance Win32_OperatingSystem
$inventory.OS = $os | Select-Object Caption,Version,BuildNumber,OSArchitecture,TotalVisibleMemorySize,FreePhysicalMemory
$inventory.CPU = @(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,VirtualizationFirmwareEnabled)
$inventory.Disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace)
$inventory.IPv4 = @(Get-NetIPAddress -AddressFamily IPv4 | Select-Object InterfaceAlias,IPAddress,PrefixLength,PrefixOrigin)
$inventory.Routes = @(Get-NetRoute -AddressFamily IPv4 | Select-Object DestinationPrefix,NextHop,InterfaceAlias,RouteMetric)
$inventory.DNS = @(Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object InterfaceAlias,ServerAddresses)
$inventory.LicenseStatus = @(Get-CimInstance SoftwareLicensingProduct -Filter "PartialProductKey IS NOT NULL AND ApplicationID='55c92734-d682-4d71-983e-d6ec3f16059f'" | Select-Object Name,LicenseStatus)
if (Get-Command Get-VM -ErrorAction SilentlyContinue) {
  $inventory.VMs = @(Get-VM | Select-Object Name,State,Generation,ProcessorCount,MemoryAssigned,MemoryStartup)
  $inventory.Switches = @(Get-VMSwitch | Select-Object Name,SwitchType,NetAdapterInterfaceDescription)
} else { $inventory.HyperV = 'Module unavailable; not installed/enabled by this script' }
if ($ProbeNetwork) {
  if ([string]::IsNullOrWhiteSpace($SqlHost)) { throw 'Supply an owner-approved SqlHost for network probe' }
  $inventory.NetworkProbe = Test-NetConnection -ComputerName $SqlHost -Port $SqlPort -InformationLevel Detailed |
    Select-Object ComputerName,RemotePort,TcpTestSucceeded,InterfaceAlias,SourceAddress
} else { $inventory.NetworkProbe = 'NOT RUN' }
$inventory | ConvertTo-Json -Depth 6
