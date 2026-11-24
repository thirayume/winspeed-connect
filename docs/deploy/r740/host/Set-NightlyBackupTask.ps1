<# Install only after the exact runner passed BackupOnly under the S4U task identity.
   Plan by default. Preserve the existing trigger and a restricted rollback copy.
   No task, backup or legacy SQL password is ever printed. #>
[CmdletBinding()]
param([switch]$Apply,[Parameter(Mandatory=$true)][string]$RehearsalManifest)
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot 'Invoke-NightlyBackup.ps1'
$target='D:\SaleApp\tools\Invoke-NightlyBackup.ps1'
$task=Get-ScheduledTask -TaskName 'AUTO Backup SQL2008' -TaskPath '\'
if($task.State-eq'Running'){throw 'NIGHTLY_TASK_IS_RUNNING'}
$proof=Get-Content -LiteralPath $RehearsalManifest -Raw|ConvertFrom-Json
$hash=(Get-FileHash -LiteralPath $source).Hash
if(-not$proof.success-or-not$proof.backupOnly-or$proof.runnerSha256-cne$hash){throw 'EXACT_RUNNER_REHEARSAL_REQUIRED'}
if(@($proof.backups|Where-Object{$_.database-in@('dbwins_worldfert9','dbwins_worldfert2')-and$_.checksumVerified}).Count-ne2){throw 'BOTH_VERIFIED_BACKUPS_REQUIRED'}
$account=New-Object Security.Principal.NTAccount($task.Principal.UserId)
$tested=New-Object Security.Principal.NTAccount($proof.identity)
if($account.Translate([Security.Principal.SecurityIdentifier]).Value-cne$tested.Translate([Security.Principal.SecurityIdentifier]).Value){throw 'TESTED_TASK_IDENTITY_MISMATCH'}
if(-not$Apply){Write-Output 'PLAN: preserve existing trigger; replace credential-bearing legacy actions with one reviewed runner; tested S4U identity, highest privileges; no off-host copy configured.';exit 0}
$dir=Join-Path 'D:\SaleApp\tools' ('backup-task-recovery-'+(Get-Date -Format yyyyMMdd-HHmmss))
New-Item -ItemType Directory -Path $dir|Out-Null
# Recovery material may contain the retired SQL credential. Keep it on-server,
# accessible only to local administrators and SYSTEM, never in a Git checkout.
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
foreach($sid in @('S-1-5-18','S-1-5-32-544')) {
  $rule=New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)),'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $dir -AclObject $acl
Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath|Set-Content -LiteralPath (Join-Path $dir 'task.xml')
$legacy='D:\MSSQL\MSSQL10_50.SQL2008\Backup\run_backup.bat'
if(Test-Path -LiteralPath $legacy){Copy-Item -LiteralPath $legacy -Destination (Join-Path $dir 'run_backup.bat')}
if(Test-Path -LiteralPath $target){Copy-Item -LiteralPath $target -Destination (Join-Path $dir 'Invoke-NightlyBackup.ps1')}
Copy-Item -LiteralPath $source -Destination $target -Force
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$target+'" -Apply')
$principal=New-ScheduledTaskPrincipal -UserId $task.Principal.UserId -LogonType S4U -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew -StartWhenAvailable
try {
  Register-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Action $action -Principal $principal -Trigger $task.Triggers -Settings $settings -Force|Out-Null
  # Replace the inactive legacy entrypoint too: no plaintext SQL password remains
  # at its original path. The old SQL file stays as history, no longer invoked.
  if(Test-Path -LiteralPath $legacy){[IO.File]::WriteAllText($legacy,"@echo off`r`npowershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$target`" -Apply`r`nexit /b %ERRORLEVEL%`r`n",[Text.Encoding]::ASCII)}
  $actual=Get-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath
  if($actual.Actions.Count-ne1-or$actual.Principal.LogonType-ne'S4U'-or$actual.Principal.RunLevel-ne'Highest'){throw 'TASK_POSTCHECK_FAILED'}
  Write-Output ('NIGHTLY_BACKUP_TASK_INSTALLED runnerSha256='+$hash+' rollback='+$dir)
} catch {
  Register-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Xml ([IO.File]::ReadAllText((Join-Path $dir 'task.xml'))) -Force|Out-Null
  if(Test-Path -LiteralPath (Join-Path $dir 'run_backup.bat')){Copy-Item -LiteralPath (Join-Path $dir 'run_backup.bat') -Destination $legacy -Force}
  if(Test-Path -LiteralPath (Join-Path $dir 'Invoke-NightlyBackup.ps1')){Copy-Item -LiteralPath (Join-Path $dir 'Invoke-NightlyBackup.ps1') -Destination $target -Force}
  throw
}
