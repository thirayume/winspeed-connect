[CmdletBinding()]
param(
    [ValidateSet('App','Full')]
    [string]$Mode = 'App',
    [string]$MssqlTestDb = 'dbwins_worldfert9_test',
    [string]$MysqlTestDb = 'db_truckscale_test'
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

function Test-TestDatabaseName([string]$Name) {
    if ($Name -notmatch '^[A-Za-z][A-Za-z0-9_]{0,127}$') { return $false }
    return $Name.ToLowerInvariant() -match '(^test_|_(test|qa|uat|sandbox)(_|$))'
}

if (-not (Test-TestDatabaseName $MssqlTestDb)) {
    throw 'MSSQL test database name must contain test, qa, uat or sandbox and use only letters, digits and underscore.'
}
if (-not (Test-TestDatabaseName $MysqlTestDb)) {
    throw 'MySQL test database name must contain test, qa, uat or sandbox and use only letters, digits and underscore.'
}
if ($config.SSH_PORT -notmatch '^\d{1,5}$' -or $config.DEPLOY_USER -notmatch '^[A-Za-z_][A-Za-z0-9_-]*$') {
    throw 'Unsafe SSH configuration in remote-config.bat.'
}
if ($config.APP_ROOT -notmatch '^/[A-Za-z0-9_./-]+$') {
    throw 'APP_ROOT must be a safe absolute Linux path.'
}

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE"
    }
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\..\..'))
$archive = Join-Path ([System.IO.Path]::GetTempPath()) ("worldfert-test-release-{0}.tgz" -f [guid]::NewGuid().ToString('N'))
$remoteArchive = '/tmp/worldfert-test-release.tgz'
$sshBase = @('-tt','-p',$config.SSH_PORT,'-i',$config.DEPLOY_KEY,($config.DEPLOY_USER + '@' + $config.SERVER_HOST))
$scpBase = @('-P',$config.SSH_PORT,'-i',$config.DEPLOY_KEY)
$appDir = $config.APP_ROOT + '/app'

try {
    Write-Host 'Packaging backend, frontend and deployment helpers...'
    $tarArgs = @(
        '-czf', $archive,
        '--exclude=node_modules', '--exclude=.git', '--exclude=deliverables', '--exclude=backup',
        '--exclude=backend/.env', '--exclude=backend/.env.*',
        '--exclude=WSSale-App/.env', '--exclude=WSSale-App/.env.*',
        '--exclude=deploy/cloud-vps/.env', '--exclude=deploy/cloud-vps/.local-secrets',
        '--exclude=remote-config.bat', '--exclude=server-config.env',
        '-C', $repoRoot, 'backend', 'WSSale-App', 'deploy'
    )
    Invoke-Checked 'tar.exe' $tarArgs

    Write-Host 'Uploading test release package...'
    Invoke-Checked 'scp.exe' ($scpBase + @($archive, ($config.DEPLOY_USER + '@' + $config.SERVER_HOST + ':' + $remoteArchive)))

    Write-Host 'Installing scripts/source on the VPS without rebuilding Production...'
    $installCommand = "set -e; sudo mkdir -p $appDir; sudo tar -xzf $remoteArchive -C $appDir; sudo chown -R $($config.DEPLOY_USER):$($config.DEPLOY_USER) $appDir; sudo chmod +x $appDir/deploy/cloud-vps/server/*.sh; rm -f $remoteArchive"
    Invoke-Checked 'ssh.exe' ($sshBase + @($installCommand))

    $helper = if ($Mode -eq 'Full') { 'deploy-full-test-stack.sh' } else { 'deploy-test-app.sh' }
    $preflightArgs = if ($Mode -eq 'Full') {
        "$MssqlTestDb $MysqlTestDb --dry-run"
    } else {
        "deploy $MssqlTestDb $MysqlTestDb --dry-run"
    }
    $remoteHelper = "$appDir/deploy/cloud-vps/server/$helper"

    Write-Host 'Running read-only VPS preflight...'
    Invoke-Checked 'ssh.exe' ($sshBase + @("sudo env APP_DIR=$appDir $remoteHelper $preflightArgs"))

    Write-Host ''
    if ($Mode -eq 'Full') {
        Write-Host 'WARNING: Existing TEST databases will be safety-backed up and replaced.' -ForegroundColor Yellow
        Write-Host 'Production databases and Production application containers will not be replaced or restarted.'
        $requiredText = 'REBUILD-FULL-TEST'
    } else {
        Write-Host 'Only TEST frontend/backend containers will be built or replaced.' -ForegroundColor Yellow
        Write-Host 'All databases and Production application containers will remain unchanged.'
        $requiredText = 'DEPLOY-TEST-APP'
    }

    $answer = Read-Host "Type $requiredText to continue"
    if ($answer -cne $requiredText) {
        Write-Host 'Cancelled. No database or application container was changed.'
        exit 2
    }

    $runArgs = if ($Mode -eq 'Full') {
        "$MssqlTestDb $MysqlTestDb --confirm-rebuild-test"
    } else {
        "deploy $MssqlTestDb $MysqlTestDb"
    }
    Invoke-Checked 'ssh.exe' ($sshBase + @("sudo env APP_DIR=$appDir $remoteHelper $runArgs"))
}
finally {
    if (Test-Path -LiteralPath $archive) {
        Remove-Item -LiteralPath $archive -Force
    }
}
