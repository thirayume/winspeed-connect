$scriptDir = 'c:\MyWork\WorldFert\winspeed-frontend\deploy\cloud-vps\windows'
$config = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $scriptDir 'remote-config.bat')) {
    if ($line -match '^@?set\s+"([^=]+)=(.*)"\s*$') { $config[$matches[1]] = $matches[2] }
}
$key = [IO.Path]::GetFullPath($config['DEPLOY_KEY'].Replace('%~dp0', ($scriptDir + '\')))
$destination = $config['DEPLOY_USER'] + '@' + $config['SERVER_HOST']
$sshBase = @('-o','BatchMode=yes','-p',$config['SSH_PORT'],'-i',$key,$destination)
& 'ssh.exe' ($sshBase + @('docker restart wf-frontend-test wf-backend-test'))
