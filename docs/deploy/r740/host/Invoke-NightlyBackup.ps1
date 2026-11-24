<#
  R740 local full backups and guarded UAT refresh. Plan-only unless -Apply.
  Windows integrated SQL authentication only. No retention deletion or PROD restore.
  -BackupOnly rehearses backups under the scheduled identity without stopping apps.
  -CopyOnly preserves the regular full-backup base during a manual rehearsal.
  An optional approved UNC receives verified copies; failure is recorded and fails
  the task even when local backups/refresh succeeded. No credentials are accepted.
#>
[CmdletBinding()]
param([switch]$Apply,[switch]$BackupOnly,[switch]$CopyOnly,[string]$OffHostDirectory)
$ErrorActionPreference='Stop'

function Invoke-BackupSql([string]$Text,[hashtable]$Parameters=@{},[switch]$Scalar,[int]$Timeout=600) {
  $c=New-Object Data.SqlClient.SqlConnection 'Server=lpc:R740-SRV\SQL2008;Database=master;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;Pooling=False;Application Name=SaleApp verified nightly backup'
  try {
    $c.Open();$q=$c.CreateCommand();$q.CommandTimeout=$Timeout;$q.CommandText=$Text
    foreach($key in $Parameters.Keys){[void]$q.Parameters.AddWithValue('@'+$key,$Parameters[$key])}
    if($Scalar){return $q.ExecuteScalar()}else{[void]$q.ExecuteNonQuery()}
  } finally {$c.Dispose()}
}
function Save-BackupManifest {
  $script:manifest.updatedAt=(Get-Date).ToString('o')
  $body=$script:manifest|ConvertTo-Json -Depth 8
  $temp=$script:manifestFile+'.tmp'
  [IO.File]::WriteAllText($temp,$body,(New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temp -Destination $script:manifestFile -Force
}
function Write-BackupLog([string]$Text) {
  $line=(Get-Date -Format s)+' '+$Text
  Write-Host $line
  Add-Content -LiteralPath $script:logFile -Value $line
}
function Get-BackupRevisions {
  $result=@{}
  foreach($kind in @('uat','prod')) {
    $out=$null|& wsl.exe -d Ubuntu -u root -- git -c safe.directory=/mnt/d/SaleApp/$kind/app -C /mnt/d/SaleApp/$kind/app rev-parse HEAD
    if($LASTEXITCODE-ne0){throw ('CHECKOUT_UNAVAILABLE_'+$kind)}
    $sha=($out|Out-String).Trim()
    if($sha-notmatch'^[0-9a-f]{40}$'){throw 'INVALID_CHECKOUT_REVISION'}
    $result[$kind]=$sha
  }
  if($result.uat-cne$result.prod){throw 'UAT_PROD_SOURCE_MISMATCH_REFRESH_REFUSED'}
  return $result
}
function New-VerifiedBackup([string]$Database,[string]$Suffix='full') {
  if($Database-notin@('dbwins_worldfert9','dbwins_worldfert2','dbwins_worldfert9_uat')){throw 'BACKUP_TARGET_REJECTED'}
  $file=Join-Path $script:backupDir ($Database+'_'+$script:run+'_'+$Suffix+'.bak')
  if(Test-Path -LiteralPath $file){throw 'BACKUP_FILE_ALREADY_EXISTS'}
  $option=if($CopyOnly-or$Suffix-eq'recovery'){'COPY_ONLY,'}else{''}
  Invoke-BackupSql ("BACKUP DATABASE ["+$Database+"] TO DISK=@file WITH "+$option+"CHECKSUM,INIT,NAME='SaleApp verified nightly backup'; RESTORE VERIFYONLY FROM DISK=@file WITH CHECKSUM;") @{file=$file}
  $hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  $row=[ordered]@{database=$Database;file=$file;bytes=(Get-Item -LiteralPath $file).Length;sha256=$hash;checksumVerified=$true;copyOnly=[bool]($CopyOnly-or$Suffix-eq'recovery');offHostVerified=$false}
  $script:manifest.backups+=,$row;Save-BackupManifest
  Write-BackupLog ('BACKUP_CHECKSUM_VERIFIED '+$Database)
  return $row
}
function Copy-VerifiedBackup($Backup) {
  if(-not$OffHostDirectory){return}
  if(-not(Test-Path -LiteralPath $OffHostDirectory -PathType Container)){throw 'OFFHOST_DIRECTORY_UNAVAILABLE'}
  $target=Join-Path $OffHostDirectory (Split-Path -Leaf $Backup.file)
  if(Test-Path -LiteralPath $target){throw 'OFFHOST_FILE_ALREADY_EXISTS'}
  Copy-Item -LiteralPath $Backup.file -Destination $target
  if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()-cne$Backup.sha256){throw 'OFFHOST_HASH_MISMATCH'}
  $Backup.offHostVerified=$true;$Backup.offHostFile=$target;Save-BackupManifest
  Write-BackupLog ('OFFHOST_HASH_VERIFIED '+$Backup.database)
}
function Restore-BackupToUat([string]$File) {
  if(-not(Test-Path -LiteralPath $File -PathType Leaf)){throw 'RESTORE_SOURCE_MISSING'}
  Invoke-BackupSql "IF @@SERVERNAME<>N'R740-SRV\SQL2008' OR DB_ID(N'dbwins_worldfert9_uat')<>10 OR DB_ID(N'dbwins_worldfert9')<>7 RAISERROR('RESTORE_TARGET_REJECTED',16,1);"
  $sessions=Invoke-BackupSql "SELECT COUNT(*) FROM sys.sysprocesses WHERE dbid=10 AND spid<>@@SPID AND spid>50" @{} -Scalar
  if($sessions-ne0){throw 'UAT_EXTERNAL_SESSIONS_PRESENT'}
  # No KILL or ROLLBACK IMMEDIATE: never evict a WinSpeed user.
  Invoke-BackupSql "SET LOCK_TIMEOUT 10000; ALTER DATABASE [dbwins_worldfert9_uat] SET SINGLE_USER;" -Timeout 20
  try {
    Invoke-BackupSql "RESTORE DATABASE [dbwins_worldfert9_uat] FROM DISK=@file WITH REPLACE,CHECKSUM,RECOVERY,MOVE N'dbERP_New_Data' TO N'D:\MSSQL\MSSQL10_50.SQL2008\Data\dbwins_worldfert9_uat.mdf',MOVE N'dbERP_New_Log' TO N'D:\MSSQL\MSSQL10_50.SQL2008\Data\dbwins_worldfert9_uat.ldf';" @{file=$File}
  } finally {Invoke-BackupSql "ALTER DATABASE [dbwins_worldfert9_uat] SET MULTI_USER;" -Timeout 30}
}
function Invoke-BackupChild([string]$File,[string[]]$Arguments=@()) {
  $previous=$ErrorActionPreference
  try {
    $ErrorActionPreference='Continue'
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $File @Arguments *>&1 | ForEach-Object {Write-BackupLog ([string]$_)}
    $code=$LASTEXITCODE
  } finally {$ErrorActionPreference=$previous}
  if($code-ne0){throw ('CHILD_PROCESS_FAILED_'+$code)}
}
function Invoke-VerifiedUatRefresh($Source) {
  $stopped=$false;$restoreStarted=$false;$recovery=$null
  $config='D:\SaleApp\uat\config\.env'
  $savedConfig=$config+'.'+$script:run+'-recovery'
  $revisions=Get-BackupRevisions;$script:manifest.revisions=$revisions;Save-BackupManifest
  try {
    $writes=Invoke-BackupSql "SELECT COUNT(*) FROM sys.dm_tran_database_transactions WHERE database_id=10 AND database_transaction_log_bytes_used>0" @{} -Scalar
    if($writes-ne0){throw 'UAT_ACTIVE_WRITES'}
    $null|& wsl.exe -d Ubuntu -u root -- docker stop saleapp-uat-backend-1
    if($LASTEXITCODE-ne0){throw 'UAT_BACKEND_STOP_FAILED'};$stopped=$true
    $sessions=Invoke-BackupSql "SELECT COUNT(*) FROM sys.sysprocesses WHERE dbid=10 AND spid<>@@SPID AND spid>50" @{} -Scalar
    if($sessions-ne0){throw 'UAT_EXTERNAL_SESSIONS_PRESENT'}
    $recovery=New-VerifiedBackup 'dbwins_worldfert9_uat' 'recovery'
    Copy-Item -LiteralPath $config -Destination $savedConfig
    # The config directory's restricted ACL must be retained; never export it.
    $current=Get-BackupRevisions
    if($current.uat-cne$revisions.uat){throw 'CHECKOUT_CHANGED_DURING_BACKUP'}
    $restoreStarted=$true;Restore-BackupToUat $Source.file
    Invoke-BackupChild 'D:\SaleApp\uat\app\docs\deploy\r740\host\Refresh-UAT.ps1'
    $health=Invoke-RestMethod 'https://wfuat.duckdns.org/api/health' -TimeoutSec 30
    if($health.db.sqlserver-ne'up'){throw 'UAT_HEALTH_FAILED'}
    $ready=Invoke-BackupSql "USE [dbwins_worldfert9_uat];SELECT CASE WHEN wf.fn_IsNativeDocumentTarget()=1 AND EXISTS(SELECT 1 FROM wf.RebateResetParticipant WHERE EnvironmentKind='uat' AND Phase='READY') AND NOT EXISTS(SELECT 1 FROM wf.RebateResetParticipant WHERE EnvironmentKind='production') THEN 1 ELSE 0 END" @{} -Scalar
    if($ready-ne1){throw 'UAT_REFRESH_STATE_FAILED'}
    $script:manifest.refresh='passed';Write-BackupLog 'UAT_REFRESH_VERIFIED'
  } catch {
    $failure=$_.Exception.Message;$script:manifest.refresh='failed'
    if($restoreStarted-and$recovery) {
      try {
        $null|& wsl.exe -d Ubuntu -u root -- docker stop saleapp-uat-backend-1
        if($LASTEXITCODE-ne0){throw 'RECOVERY_BACKEND_STOP_FAILED'}
        Restore-BackupToUat $recovery.file
        Copy-Item -LiteralPath $savedConfig -Destination $config -Force
        Invoke-BackupChild 'D:\SaleApp\uat\app\docs\deploy\r740\deploy-r740.ps1' @('-Environment','uat','-OnServer','-Auto')
        $script:manifest.recovery='passed';Write-BackupLog 'UAT_PRE_REFRESH_RECOVERY_RESTORED'
      } catch {$script:manifest.recovery='needs-review';Write-BackupLog ('RECOVERY_NEEDS_REVIEW '+$_.Exception.Message)}
    }
    throw $failure
  } finally {
    if($stopped) {
      $null|& wsl.exe -d Ubuntu -u root -- docker start saleapp-uat-backend-1
      if($LASTEXITCODE-ne0){$script:manifest.failures+=,'UAT_BACKEND_START_FAILED'}
    }
    Save-BackupManifest
  }
}
function Invoke-BackupCycle {
  $source=$null;$backupFailed=$false
  # Attempt both companies even if one backup fails. Never refresh from an
  # incomplete set or a stale file discovered by filename/date guessing.
  foreach($db in @('dbwins_worldfert9','dbwins_worldfert2')) {
    try {$backup=New-VerifiedBackup $db;if($db-eq'dbwins_worldfert9'){$source=$backup}}
    catch {$backupFailed=$true;$script:manifest.failures+=,('BACKUP_FAILED '+$db+': '+$_.Exception.Message);Save-BackupManifest}
  }
  if(-not$backupFailed-and-not$BackupOnly) {
    try {Invoke-VerifiedUatRefresh $source}
    catch {$script:manifest.failures+=,('REFRESH_FAILED: '+$_.Exception.Message);Save-BackupManifest}
  }
  foreach($backup in $script:manifest.backups) {
    try {Copy-VerifiedBackup $backup}
    catch {$script:manifest.failures+=,('OFFHOST_FAILED '+$backup.database+': '+$_.Exception.Message);Save-BackupManifest}
  }
  if($script:manifest.failures.Count){throw 'BACKUP_CYCLE_FAILED_SEE_MANIFEST'}
}
function Start-NightlyBackup {
  if($OffHostDirectory-and$OffHostDirectory-notmatch'^\\\\[^\\]+\\[^\\]+'){throw 'OFFHOST_MUST_BE_APPROVED_UNC'}
  if(-not$Apply){Write-Output 'PLAN: checksum/verify both PROD companies; guarded UAT-only refresh unless BackupOnly; no deletion, Reset or secondary business writes.';return}
  $guard=Invoke-BackupSql "SELECT CASE WHEN @@SERVERNAME=N'R740-SRV\SQL2008' AND DB_ID(N'dbwins_worldfert9')=7 AND DB_ID(N'dbwins_worldfert9_uat')=10 AND DB_ID(N'dbwins_worldfert2') IS NOT NULL AND IS_SRVROLEMEMBER('sysadmin')=1 THEN 1 ELSE 0 END" @{} -Scalar
  if($guard-ne1){throw 'SERVER_OR_IDENTITY_GUARD_FAILED'}
  $script:backupDir='D:\MSSQL\MSSQL10_50.SQL2008\Backup'
  $script:run='verified-'+(Get-Date -Format yyyyMMdd-HHmmss)+'-'+([guid]::NewGuid().ToString('N').Substring(0,8))
  $logDir='D:\SaleApp\backup-logs';New-Item -ItemType Directory -Path $logDir -Force|Out-Null
  $script:manifestFile=Join-Path $logDir ($script:run+'.json');$script:logFile=Join-Path $logDir ($script:run+'.log')
  $script:manifest=[ordered]@{run=$script:run;identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name;runnerSha256=(Get-FileHash -LiteralPath $PSCommandPath).Hash;startedAt=(Get-Date).ToString('o');backupOnly=[bool]$BackupOnly;offHostConfigured=[bool]$OffHostDirectory;backups=@();refresh='not-run';recovery='not-needed';failures=@();success=$false}
  $mutex=New-Object Threading.Mutex($false,'Global\SaleAppVerifiedNightlyBackup');$acquired=$false
  try {
    $acquired=$mutex.WaitOne(0);if(-not$acquired){throw 'ANOTHER_BACKUP_CYCLE_RUNNING'}
    Save-BackupManifest
    # Keep existing backups: fail before consuming the disk, never auto-delete.
    if((Get-PSDrive D).Free-lt15GB){throw 'BACKUP_DISK_BELOW_15_GIB'}
    Invoke-BackupCycle
    $script:manifest.success=$true;Write-BackupLog 'BACKUP_CYCLE_PASSED'
  } catch {
    $script:manifest.failures+=,$_.Exception.Message
    Write-BackupLog ('BACKUP_CYCLE_FAILED '+$_.Exception.Message);throw
  } finally {Save-BackupManifest;if($acquired){$mutex.ReleaseMutex()};$mutex.Dispose()}
}
if($MyInvocation.InvocationName-ne'.'){Start-NightlyBackup}
