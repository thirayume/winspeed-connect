param([string]$RepositoryRoot,[string]$Case)
$ErrorActionPreference='Stop'
$file=Join-Path $RepositoryRoot 'docs/deploy/r740/host/Invoke-NightlyBackup.ps1'
$tokens=$null;$errors=$null
[void][Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
[void][Management.Automation.Language.Parser]::ParseFile((Join-Path $RepositoryRoot 'docs/deploy/r740/host/Set-NightlyBackupTask.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
. $file
$script:events=New-Object Collections.Generic.List[string]
$script:manifest=[ordered]@{backups=@();failures=@()}
function Save-BackupManifest {}
function New-VerifiedBackup([string]$Database) {
  $script:events.Add('backup:'+ $Database)
  if(($Case-eq'first-failed'-and$Database-eq'dbwins_worldfert9')-or($Case-eq'second-failed'-and$Database-eq'dbwins_worldfert2')){throw 'simulated verify failure'}
  $row=@{database=$Database};$script:manifest.backups+=,$row;return $row
}
function Invoke-VerifiedUatRefresh($Source) {
  $script:events.Add('refresh:'+ $Source.database)
  if($Case-eq'refresh-failed'){throw 'simulated refresh failure'}
}
function Copy-VerifiedBackup($Backup) {
  $script:events.Add('copy:'+ $Backup.database)
  if($Case-eq'copy-failed'){throw 'simulated offhost failure'}
}
$BackupOnly=$Case-eq'backup-only'
$success=$false
try {
  if($Case-in@('child-warning','child-nonzero')) {
    function Write-BackupLog([string]$Text){$script:events.Add($Text)}
    $child=Join-Path ([IO.Path]::GetTempPath()) ('wf-backup-child-'+[guid]::NewGuid().ToString('N')+'.ps1')
    $exitCode=if($Case-eq'child-nonzero'){4}else{0}
    Set-Content -LiteralPath $child -Value ("[Console]::Error.WriteLine('simulated child warning'); Write-Output 'CHILD_PROOF'; exit "+$exitCode)
    try {Invoke-BackupChild $child} finally {Remove-Item -LiteralPath $child}
  } elseif($Case-in@('plan','bad-unc')) {
    function Invoke-BackupSql {throw 'PLAN_MUST_NOT_OPEN_SQL'}
    if($Case-eq'bad-unc'){$OffHostDirectory='D:\unapproved-local-copy'}
    Start-NightlyBackup|Out-Null
  } else {Invoke-BackupCycle}
  $success=$true
}catch {}
[pscustomobject]@{success=$success;events=@($script:events);failures=$script:manifest.failures}|ConvertTo-Json -Compress
