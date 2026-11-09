<#
  deploy-r740.ps1 - deploy Sale-App on R740-SRV (172.16.30.169). Called by deploy.bat on the
  dev PC and by Deploy-UAT/PROD/HOTFIX.bat on the server; see docs/deploy/r740/README.md.

    uat     UAT  = origin/uat  -> D:\SaleApp\uat  -> https://172.16.30.169:8444
    prod    PROD = origin/main -> D:\SaleApp\prod -> https://172.16.30.169 (needs go-live)
    hotfix  uat, then prod; prod is skipped if uat fails or is stopped

  For each environment:
    1. fetch origin/<branch> and ask you to confirm that exact commit;
    2. plan: that commit's bootstrap.sh syncs the server clone, checks target and settings,
       builds images and runs a read-only migration plan;
    3. ask before applying the pending migrations shown (PROD: type the database name);
    4. apply: re-check, refuse if the plan changed, apply, verify, start the stack.
  From the dev PC it works over SSH (dedicated key, no password). On R740-SRV itself
  (-OnServer, chosen automatically there) git and bash run in the local WSL Ubuntu.
  -PlanOnly stops after step 2. Nothing secret is read or printed.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('uat', 'prod', 'hotfix')][string]$Environment,
  [switch]$PlanOnly,
  [switch]$OnServer,
  [switch]$Auto,  # unattended (uat only): no prompts, apply the plan just computed; for the nightly refresh
  [string]$ServerHost = '172.16.30.169',
  [string]$SshUser = 'Administrator',
  [string]$KeyFile = (Join-Path $env:USERPROFILE '.ssh\wf-onprem-claude'),
  [string]$Distro = 'Ubuntu'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
# Windows PowerShell (.NET Framework) writes the console input encoding's BOM first into a
# child's redirected stdin; bash would then read the BOM as part of the first line.
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
if (-not $PSBoundParameters.ContainsKey('OnServer')) { $OnServer = $env:COMPUTERNAME -ieq 'R740-SRV' }

$repoUrl = 'https://github.com/thirayume/winspeed-connect.git'
$wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
$operator = ("$env:USERNAME@$env:COMPUTERNAME" -replace '[^A-Za-z0-9._@-]', '_')

if ($Auto -and $Environment -ne 'uat') { Write-Host 'ERROR: -Auto is allowed for uat only.' -ForegroundColor Red; exit 2 }
function Fail([string]$message) { throw "ERROR: $message" }
function Confirm-Word([string]$prompt, [string]$word) {
  if ($Auto) { Write-Host "$prompt [auto $word]"; return }
  $answer = Read-Host "$prompt Type $word to continue"
  if ($answer -cne $word) { throw 'STOPPED' }
}

if ($OnServer) {
  if (-not (Test-Path $wsl)) { Fail 'wsl.exe is not available on this server.' }
} else {
  $git = (Get-Command git -ErrorAction SilentlyContinue).Source
  if (-not $git) { Fail 'git is not installed on this PC.' }
  $ssh = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
  if (-not (Test-Path $ssh)) { $ssh = (Get-Command ssh -ErrorAction SilentlyContinue).Source }
  if (-not $ssh) { Fail 'OpenSSH client (ssh.exe) is not installed on this PC.' }
  if (-not (Test-Path $KeyFile)) { Fail "deploy key not found: $KeyFile" }
  $repo = (& $git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
}

# git in this PC's checkout, or (on the server) in WSL inside D:\SaleApp\<env>\app.
function Invoke-Git([string]$envName, [string[]]$GitArgs) {
  if ($OnServer) {
    $app = "/mnt/d/SaleApp/$envName/app"
    # Empty input: wsl.exe relays console input to Linux and would swallow the YES typed next.
    $out = $null | & $wsl --distribution $Distro --user root --exec git -c "safe.directory=$app" -C $app @GitArgs
  } else {
    $out = & $git -C $repo @GitArgs
  }
  [pscustomobject]@{ Code = $LASTEXITCODE; Out = @($out | ForEach-Object { $_ -replace "`0", '' }) }
}

# On the server the clone is made here first (as bootstrap.sh would), so its files can be read.
function Initialize-ServerClone([string]$envName, [string]$branch) {
  $winRoot = "D:\SaleApp\$envName"
  if (-not (Test-Path "$winRoot\config") -or -not (Test-Path "$winRoot\deploy-logs")) {
    Fail "$winRoot\config and deploy-logs must exist (see docs/deploy/r740/README.md)."
  }
  if (Test-Path "$winRoot\app\.git") { return }
  if ((Test-Path "$winRoot\app") -and (Get-ChildItem -Force "$winRoot\app" | Select-Object -First 1)) {
    Fail "$winRoot\app exists but is not a Git clone; move it away first."
  }
  Write-Host "First deploy of ${envName}: cloning $branch into $winRoot\app ..."
  $null | & $wsl --distribution $Distro --user root --exec git -c core.autocrlf=false clone --quiet --filter=blob:none `
    --no-checkout --branch $branch $repoUrl "/mnt/d/SaleApp/$envName/app"
  if ($LASTEXITCODE -ne 0) { Fail 'git clone failed.' }
  foreach ($setting in @(@('core.autocrlf', 'false'), @('core.filemode', 'false'))) {
    [void](Invoke-Git $envName (@('config') + $setting))
  }
}

function Invoke-Bootstrap([string]$envName, [string]$phase, [string]$commit, [string]$bootstrap, [string]$planId) {
  $command = "--distribution $Distro --user root --exec bash -s -- $envName $phase $commit $operator $planId".Trim()
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  if ($OnServer) {
    $psi.FileName = $wsl
    $psi.Arguments = $command
  } else {
    $psi.FileName = $ssh
    $psi.Arguments = ('-i "{0}" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o LogLevel=ERROR ' +
      '-o ServerAliveInterval=30 {1}@{2} "wsl.exe {3}"') -f $KeyFile, $SshUser, $ServerHost, $command
  }
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
  $process = [System.Diagnostics.Process]::Start($psi)
  $bytes = [Text.Encoding]::ASCII.GetBytes($bootstrap)
  $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
  $process.StandardInput.Close()
  $lines = New-Object System.Collections.Generic.List[string]
  while ($null -ne ($line = $process.StandardOutput.ReadLine())) {
    $line = $line -replace "`0", ''
    Write-Host $line
    $lines.Add($line)
  }
  $process.WaitForExit()
  [pscustomobject]@{ ExitCode = $process.ExitCode; Lines = $lines }
}

function Wait-RemoteWsl {
  # Starting a cold WSL VM can briefly reset the server's network connections, so start it
  # with a short call (retried) before the long-running plan.
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    # Windows PowerShell turns redirected native stderr into errors; do not let that stop the retry.
    $ErrorActionPreference = 'Continue'
    # -n: ssh must not read this console's input (it would swallow the YES typed next).
    & $ssh -n -i $KeyFile -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o LogLevel=ERROR `
      -o ConnectTimeout=15 "$SshUser@$ServerHost" "wsl.exe --distribution $Distro --exec true" 2>$null | Out-Null
    $warmExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($warmExit -eq 0) { return }
    if ($attempt -eq 3) { Fail "cannot reach WSL $Distro on $ServerHost over SSH." }
    Start-Sleep -Seconds 5
  }
}

function Invoke-Deploy([string]$envName) {
  $branch = if ($envName -eq 'uat') { 'uat' } else { 'main' }
  if ($OnServer) { Initialize-ServerClone $envName $branch } else { Wait-RemoteWsl }
  $fetch = Invoke-Git $envName @('fetch', '--quiet', 'origin', "+refs/heads/${branch}:refs/remotes/origin/${branch}")
  if ($fetch.Code -ne 0) { Fail "git fetch of origin/$branch failed." }
  $commit = (Invoke-Git $envName @('rev-parse', "refs/remotes/origin/$branch")).Out[0].Trim()
  $subject = (Invoke-Git $envName @('log', '-1', '--format=%h  %ad  %s', '--date=format:%Y-%m-%d %H:%M', $commit)).Out[0]

  # Read the target and bootstrap from that commit itself (Git blobs keep their LF endings).
  $targetRead = Invoke-Git $envName @('show', "${commit}:docs/deploy/r740/targets/$envName.env")
  if ($targetRead.Code -ne 0) { Fail "origin/$branch has no docs/deploy/r740/targets/$envName.env." }
  $target = $targetRead.Out -join "`n"
  if ($target -notmatch '(?m)^SALEAPP_DEPLOY_ENABLED=true$') {
    Fail "deploys to $envName are disabled in targets/$envName.env at origin/$branch."
  }
  $database = [regex]::Match($target, '(?m)^ONPREM_DB_NAME=(.+)$').Groups[1].Value
  $httpsPort = [regex]::Match($target, '(?m)^HTTPS_PORT=(\d+)$').Groups[1].Value
  $bootRead = Invoke-Git $envName @('show', "${commit}:docs/deploy/r740/bootstrap.sh")
  if ($bootRead.Code -ne 0) { Fail "origin/$branch has no docs/deploy/r740/bootstrap.sh." }
  $bootstrap = ($bootRead.Out -join "`n") + "`n"

  Write-Host ''
  Write-Host ("Sale-App deploy on R740-SRV ($ServerHost) - $envName" + $(if ($OnServer) { ' (on the server)' } else { '' })) -ForegroundColor Cyan
  Write-Host "  branch   : origin/$branch"
  Write-Host "  commit   : $subject"
  Write-Host "  database : $database"
  Write-Host "  operator : $operator"
  Confirm-Word "Deploy this commit to $envName?" 'YES'

  Write-Host ''
  Write-Host '== Plan (code sync, checks, image build, read-only migration plan)' -ForegroundColor Cyan
  $plan = Invoke-Bootstrap $envName 'plan' $commit $bootstrap ''
  if ($plan.ExitCode -ne 0) { Fail "$envName plan phase failed (exit $($plan.ExitCode)); nothing was applied." }
  $summary = $plan.Lines | Where-Object { $_ -match '^SALEAPP_PLAN ' } | Select-Object -Last 1
  $m = [regex]::Match([string]$summary, 'pending=(\d+) drift=(\d+) id=([0-9a-f]{64})')
  if (-not $m.Success) { Fail 'could not read the plan summary.' }
  $pending = [int]$m.Groups[1].Value
  $planId = $m.Groups[3].Value
  if ($PlanOnly) { Write-Host "Plan only: $envName stopped before any database write." -ForegroundColor Yellow; return }

  Write-Host ''
  if ($pending -gt 0) {
    # Production asks for the database name itself, and the server checks the backup again.
    $applyWord = if ($envName -eq 'prod') { $database } else { 'APPLY' }
    if ($envName -eq 'prod') {
      Write-Host "PRODUCTION: a verified pre-deploy backup (sql/r740-prod-backup.sql) younger than 120 minutes is required." -ForegroundColor Yellow
    }
    Confirm-Word "Apply the $pending pending migration(s) listed above to $database and start the stack?" $applyWord
  } else {
    Confirm-Word "No pending migrations. Restart the $envName stack on this commit?" 'YES'
  }

  Write-Host ''
  Write-Host '== Apply (re-check, migrations, verify, start)' -ForegroundColor Cyan
  $apply = Invoke-Bootstrap $envName 'apply' $commit $bootstrap $planId
  if ($apply.ExitCode -ne 0) { Fail "$envName apply phase failed (exit $($apply.ExitCode)); read the receipt above." }

  $url = "https://${ServerHost}" + $(if ($httpsPort -eq '443') { '' } else { ":$httpsPort" })
  $code = & curl.exe -k -s -o NUL -w '%{http_code}' --max-time 15 "$url/api/health"
  Write-Host ''
  Write-Host "Deployed $envName at $url  (api/health: HTTP $code)" -ForegroundColor Green
}

$environments = if ($Environment -eq 'hotfix') { @('uat', 'prod') } else { @($Environment) }
try {
  foreach ($envName in $environments) { Invoke-Deploy $envName }
  exit 0
} catch {
  $message = $_.Exception.Message
  if ($message -eq 'STOPPED') { Write-Host 'Stopped; nothing more was done.' -ForegroundColor Yellow; $code = 3 }
  else { Write-Host $message -ForegroundColor Red; $code = 1 }
  if ($environments.Count -gt 1) { Write-Host 'Hotfix stopped: the remaining environment was not deployed.' -ForegroundColor Yellow }
  exit $code
}
