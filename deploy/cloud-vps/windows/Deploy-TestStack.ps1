[CmdletBinding()]
param(
    [ValidateSet('App','Full','Plan')][string]$Mode = 'Plan',
    [ValidateSet('dbwins_worldfert9_test_v2')][string]$MssqlTestDb = 'dbwins_worldfert9_test_v2'
)
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$config = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $scriptDir 'remote-config.bat')) {
    if ($line -match '^@?set\s+"([^=]+)=(.*)"\s*$') { $config[$matches[1]] = $matches[2] }
}
foreach ($required in 'SERVER_HOST','SSH_PORT','DEPLOY_USER','DEPLOY_KEY') {
    if (-not $config[$required]) { throw "Missing $required in remote-config.bat" }
}
if ($config.SERVER_HOST -notmatch '^[A-Za-z0-9.-]+$' -or $config.SSH_PORT -notmatch '^\d{1,5}$' -or $config.DEPLOY_USER -notmatch '^[A-Za-z_][A-Za-z0-9_-]*$') { throw 'Invalid SSH configuration' }
$key = [IO.Path]::GetFullPath($config.DEPLOY_KEY.Replace('%~dp0', ($scriptDir + '\')))
$destination = $config.DEPLOY_USER + '@' + $config.SERVER_HOST
$sshBase = @('-o','BatchMode=yes','-p',$config.SSH_PORT,'-i',$key,$destination)
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed: $LASTEXITCODE" }
}
$helper = '/opt/worldfert/v2-test/deploy/cloud-vps/server/deploy-v2-test.sh'
if ($Mode -eq 'Plan') { Invoke-Checked 'ssh.exe' ($sshBase + @("bash $helper plan")); return }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $scriptDir '..\..\..'))
$archive = Join-Path ([IO.Path]::GetTempPath()) ("worldfert-v2-{0}.tgz" -f [guid]::NewGuid().ToString('N'))
$remoteArchive = '/tmp/' + [IO.Path]::GetFileName($archive)
try {
    Invoke-Checked 'tar.exe' @('-czf',$archive,'--exclude=node_modules','--exclude=.git','--exclude=dist','--exclude=*.log','--exclude=.env','--exclude=.env.*','--exclude=.local-secrets','--exclude=remote-config.bat','--exclude=server-config.env','--exclude=backup','--exclude=deliverables','-C',$repoRoot,'backend','WSSale-App','deploy','db-init')
    Invoke-Checked 'scp.exe' @('-P',$config.SSH_PORT,'-i',$key,$archive,($destination + ':' + $remoteArchive))
    Invoke-Checked 'ssh.exe' ($sshBase + @("set -e; mkdir -p /opt/worldfert/v2-test; tar -xzf $remoteArchive -C /opt/worldfert/v2-test; rm -f $remoteArchive; bash $helper build"))
    if ($Mode -eq 'Full') {
        # Supplied backup must already be restored. Never clone production or reset fixtures implicitly.
        Invoke-Checked 'ssh.exe' ($sshBase + @("set -e; bash $helper principals --confirm-v2-test; bash $helper weighing-schema --confirm-v2-test; bash $helper plan; bash $helper migrate"))
    }
    Invoke-Checked 'ssh.exe' ($sshBase + @("set -e; bash $helper plan; bash $helper deploy"))
} finally {
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}