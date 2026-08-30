[CmdletBinding()]
param(
    [ValidateSet('status','health','connections','env-show','env-get','env-set','env-edit','env-backups','env-rollback','domain-set','deploy','rebuild','restart','logs','rotate-db-certs','portainer-restart','portainer-credentials','backup-now')]
    [string]$Action = 'status',
    [string]$Target = '',
    [string]$Value = '',
    [ValidateRange(1, 5000)]
    [int]$Lines = 100
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir 'remote-config.bat'
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Missing $configPath"
}

$config = @{}
foreach ($line in Get-Content -LiteralPath $configPath) {
    if ($line -match '^@?set\s+"([^=]+)=(.*)"\s*$') {
        $config[$matches[1]] = $matches[2]
    }
}
foreach ($required in 'SERVER_HOST','SSH_PORT','DEPLOY_USER','DEPLOY_KEY','APP_ROOT') {
    if (-not $config[$required]) { throw "Missing $required in remote-config.bat" }
}

if ($Action -in 'rebuild','restart','logs') {
    if (-not $Target) { $Target = if ($Action -eq 'logs') { 'backend' } else { 'all' } }
    if ($Target -notin 'caddy','frontend','backend','mssql','mysql','portainer','all') {
        throw 'Target must be caddy, frontend, backend, mssql, mysql, portainer or all.'
    }
}
if ($Action -eq 'domain-set' -and $Target -notmatch '^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$') {
    throw 'Target must be a valid base domain, for example thirayu.online.'
}
if ($Action -in 'env-get','env-set' -and $Target -notmatch '^[A-Z][A-Z0-9_]*$') {
    throw 'Target must be an uppercase environment key.'
}
if ($Action -eq 'env-set') {
    if (-not $Value) { throw 'Value is required for env-set.' }
    if ($Value -notmatch '^[A-Za-z0-9_./:@%+,=\-]+$') { throw 'Value contains unsafe command-line characters; use env-edit instead.' }
}

$remoteArgs = @($config.APP_ROOT + '/app', $Action)
switch ($Action) {
    'domain-set' { $remoteArgs += $Target }
    'env-get' { $remoteArgs += $Target }
    'env-set' { $remoteArgs += @($Target, $Value) }
    'env-rollback' { $remoteArgs += @($(if ($Target) { $Target } else { 'latest' }), '--confirm') }
    'rebuild' { $remoteArgs += $Target }
    'restart' { $remoteArgs += $Target }
    'logs' { $remoteArgs += @($Target, [string]$Lines) }
}

$sshArgs = @(
    '-tt', '-p', $config.SSH_PORT,
    '-i', $config.DEPLOY_KEY,
    ($config.DEPLOY_USER + '@' + $config.SERVER_HOST),
    'sudo', ($config.APP_ROOT + '/app/deploy/cloud-vps/server/manage-stack.sh')
) + $remoteArgs

& ssh @sshArgs
exit $LASTEXITCODE
