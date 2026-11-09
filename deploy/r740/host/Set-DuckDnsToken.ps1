# Run interactively on R740 as Administrator. Never pass the token as a command argument.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ne 'R740-SRV') { throw 'Run only on R740-SRV.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal $identity
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open an elevated PowerShell window on R740 first.'
}
$directory = 'D:\SaleApp\prod\config'
$destination = Join-Path $directory 'duckdns-token'
if (-not (Test-Path -LiteralPath $directory -PathType Container)) { throw 'Production config directory is missing.' }
if (Test-Path -LiteralPath $destination) { throw 'A token file already exists; nothing was overwritten.' }
$secure = Read-Host 'DuckDNS API token (hidden; not the website admin password)' -AsSecureString
$pointer = [IntPtr]::Zero
$temporary = Join-Path $directory ('duckdns-' + [guid]::NewGuid().ToString('N') + '.tmp')
try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim()
    if ($value -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
        throw 'Token format is invalid; no value was saved or displayed.'
    }
    # Protect the empty file before writing its value; inherited permissions are removed.
    [IO.File]::WriteAllText($temporary, '', (New-Object Text.UTF8Encoding $false))
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544', $identity.User.Value) | Select-Object -Unique) {
        $account = New-Object Security.Principal.SecurityIdentifier $sid
        $rule = New-Object Security.AccessControl.FileSystemAccessRule $account, 'FullControl', 'Allow'
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $temporary -AclObject $acl
    [IO.File]::WriteAllText($temporary, $value, (New-Object Text.UTF8Encoding $false))
    [IO.File]::Move($temporary, $destination)
    Write-Host 'TOKEN_SAVED: protected file for Caddy only. No token value was displayed.'
    Write-Host 'Reply ready to continue the DNS-01 deployment. Do not send the token.'
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($secure) { $secure.Dispose() }
    Remove-Variable value -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
}
