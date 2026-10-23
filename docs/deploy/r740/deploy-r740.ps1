<#
  deploy-r740.ps1 - deploy Sale-App to R740-SRV (172.16.30.169) from this PC.
  Called by deploy.bat; see docs/deploy/r740/README.md.

    deploy.bat uat        UAT  = origin/uat  -> D:\SaleApp\uat  -> https://172.16.30.169:8444
    deploy.bat prod       PROD = origin/main -> D:\SaleApp\prod (disabled until go-live)

  Steps:
    1. fetch origin/<branch> and ask you to confirm that exact commit;
    2. plan  (over SSH, dedicated key, no password): that commit's bootstrap.sh syncs the
       server clone, checks target and settings, builds images and runs a read-only
       migration plan;
    3. ask before applying the pending migrations shown;
    4. apply: re-check, refuse if the plan changed, apply, verify, start the stack.
  -PlanOnly stops after step 2. Nothing secret is read or printed on this PC.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('uat', 'prod')][string]$Environment,
  [switch]$PlanOnly,
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

function Fail([string]$message) { Write-Host "ERROR: $message" -ForegroundColor Red; exit 1 }
function Confirm-Word([string]$prompt, [string]$word) {
  $answer = Read-Host "$prompt Type $word to continue"
  if ($answer -cne $word) { Write-Host 'Stopped; nothing more was done.' -ForegroundColor Yellow; exit 3 }
}

$branch = if ($Environment -eq 'uat') { 'uat' } else { 'main' }
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git) { Fail 'git is not installed on this PC.' }
$ssh = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
if (-not (Test-Path $ssh)) { $ssh = (Get-Command ssh -ErrorAction SilentlyContinue).Source }
if (-not $ssh) { Fail 'OpenSSH client (ssh.exe) is not installed on this PC.' }
if (-not (Test-Path $KeyFile)) { Fail "deploy key not found: $KeyFile" }

$repo = (& $git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
& $git -C $repo fetch --quiet origin "+refs/heads/${branch}:refs/remotes/origin/${branch}"
if ($LASTEXITCODE -ne 0) { Fail "git fetch of origin/$branch failed." }
$commit = (& $git -C $repo rev-parse "refs/remotes/origin/$branch").Trim()
$subject = (& $git -C $repo log -1 --format='%h  %ad  %s' --date=format:'%Y-%m-%d %H:%M' $commit)

# Read the target and bootstrap from that commit itself (Git blobs keep their LF endings).
$target = (& $git -C $repo show "${commit}:docs/deploy/r740/targets/$Environment.env") -join "`n"
if ($LASTEXITCODE -ne 0) { Fail "origin/$branch has no docs/deploy/r740/targets/$Environment.env." }
if ($target -notmatch '(?m)^SALEAPP_DEPLOY_ENABLED=true$') {
  Fail "deploys to $Environment are disabled in targets/$Environment.env at origin/$branch."
}
$database = [regex]::Match($target, '(?m)^ONPREM_DB_NAME=(.+)$').Groups[1].Value
$httpsPort = [regex]::Match($target, '(?m)^HTTPS_PORT=(\d+)$').Groups[1].Value
$bootstrap = ((& $git -C $repo show "${commit}:docs/deploy/r740/bootstrap.sh") -join "`n") + "`n"
if ($LASTEXITCODE -ne 0) { Fail "origin/$branch has no docs/deploy/r740/bootstrap.sh." }
$operator = ("$env:USERNAME@$env:COMPUTERNAME" -replace '[^A-Za-z0-9._@-]', '_')

Write-Host ''
Write-Host "Sale-App deploy to R740-SRV ($ServerHost) - $Environment" -ForegroundColor Cyan
Write-Host "  branch   : origin/$branch"
Write-Host "  commit   : $subject"
Write-Host "  database : $database"
Write-Host "  operator : $operator"
Confirm-Word "Deploy this commit to $Environment?" 'YES'

function Invoke-Bootstrap([string]$phase, [string]$planId) {
  $remote = "wsl.exe --distribution $Distro --user root --exec bash -s -- $Environment $phase $commit $operator $planId".Trim()
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $ssh
  $psi.Arguments = ('-i "{0}" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o LogLevel=ERROR ' +
    '-o ServerAliveInterval=30 {1}@{2} "{3}"') -f $KeyFile, $SshUser, $ServerHost, $remote
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

# Starting a cold WSL VM can briefly reset the server's network connections, so start it
# with a short call (retried) before the long-running plan.
for ($attempt = 1; $attempt -le 3; $attempt++) {
  # Windows PowerShell turns redirected native stderr into errors; do not let that stop the retry.
  $ErrorActionPreference = 'Continue'
  & $ssh -i $KeyFile -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o LogLevel=ERROR `
    -o ConnectTimeout=15 "$SshUser@$ServerHost" "wsl.exe --distribution $Distro --exec true" 2>$null | Out-Null
  $warmExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($warmExit -eq 0) { break }
  if ($attempt -eq 3) { Fail "cannot reach WSL $Distro on $ServerHost over SSH." }
  Start-Sleep -Seconds 5
}

Write-Host ''
Write-Host '== Plan (code sync, checks, image build, read-only migration plan)' -ForegroundColor Cyan
$plan = Invoke-Bootstrap 'plan' ''
if ($plan.ExitCode -ne 0) { Fail "plan phase failed (exit $($plan.ExitCode)); nothing was applied." }
$summary = $plan.Lines | Where-Object { $_ -match '^SALEAPP_PLAN ' } | Select-Object -Last 1
$m = [regex]::Match([string]$summary, 'pending=(\d+) drift=(\d+) id=([0-9a-f]{64})')
if (-not $m.Success) { Fail 'could not read the plan summary.' }
$pending = [int]$m.Groups[1].Value
$planId = $m.Groups[3].Value
if ($PlanOnly) { Write-Host 'Plan only: stopped before any database write.' -ForegroundColor Yellow; exit 0 }

Write-Host ''
if ($pending -gt 0) {
  Confirm-Word "Apply the $pending pending migration(s) listed above to $database and start the stack?" 'APPLY'
} else {
  Confirm-Word "No pending migrations. Restart the $Environment stack on this commit?" 'YES'
}

Write-Host ''
Write-Host '== Apply (re-check, migrations, verify, start)' -ForegroundColor Cyan
$apply = Invoke-Bootstrap 'apply' $planId
if ($apply.ExitCode -ne 0) { Fail "apply phase failed (exit $($apply.ExitCode)); read the receipt above." }

$url = "https://${ServerHost}" + $(if ($httpsPort -eq '443') { '' } else { ":$httpsPort" })
$code = & curl.exe -k -s -o NUL -w '%{http_code}' --max-time 15 "$url/api/health"
Write-Host ''
Write-Host "Deployed $Environment at $url  (api/health from this PC: HTTP $code)" -ForegroundColor Green
