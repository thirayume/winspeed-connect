<#
  One-time setup, explicitly approved by the owner on 28 October 2026.
  Creates two NEW SQL logins for the corrected UAT clone and updates only UAT secrets.
  Existing logins, application accounts and Production permissions are untouched.
  Run locally on R740 as the approved Windows SQL administrator. Default is read-only.
#>
[CmdletBinding()]
param([switch]$Apply,
      [string]$PrincipalScript = (Join-Path (Split-Path $PSScriptRoot -Parent) 'sql\r740-uat-principals.sql'))
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$database='dbwins_worldfert9_uat'
$appLogin='wf_r740_uat_app_v2'
$migrationLogin='wf_r740_uat_migrator_v2'
$config='D:\SaleApp\uat\config'
$appFile=Join-Path $config '.env'
$migrationFile=Join-Path $config '.env.migrator.local'
$stage='PREFLIGHT';$tx=$null;$committed=$false
$c=New-Object System.Data.SqlClient.SqlConnection 'Server=lpc:R740-SRV\SQL2008;Database=master;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;Pooling=False;Connect Timeout=8;Application Name=SaleApp isolated UAT setup'
function Scalar([string]$text){
 $cmd=$c.CreateCommand();$cmd.CommandText=$text;$cmd.CommandTimeout=30
 if($tx){$cmd.Transaction=$tx}
 try{return $cmd.ExecuteScalar()}finally{$cmd.Dispose()}
}
function PrivateAcl([string]$path,[bool]$directory){
 if($directory){$acl=New-Object Security.AccessControl.DirectorySecurity;$inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}
 else{$acl=New-Object Security.AccessControl.FileSecurity;$inherit=[Security.AccessControl.InheritanceFlags]::None}
 $acl.SetAccessRuleProtection($true,$false)
 foreach($sid in @('S-1-5-18','S-1-5-32-544')){
  $who=New-Object Security.Principal.SecurityIdentifier $sid
  $rule=New-Object Security.AccessControl.FileSystemAccessRule($who,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
  [void]$acl.AddAccessRule($rule)
 }
 Set-Acl -LiteralPath $path -AclObject $acl
}
function RandomText([int]$count){
 $bytes=New-Object byte[] $count;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
 try{$rng.GetBytes($bytes);return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')}finally{$rng.Dispose()}
}
function SetEnvValue([string]$text,[string]$key,[string]$value){
 if($value -notmatch '^[A-Za-z0-9_!\-]+$'){throw 'Generated secret alphabet invalid.'}
 $pattern='(?m)^'+[regex]::Escape($key)+'=[^\r\n]*'
 $count=([regex]::Matches($text,$pattern)).Count
 if($count -gt 1){throw 'Duplicate secret setting; inspect privately.'}
 $line=$key+"='"+$value+"'"
 if($count -eq 1){return [regex]::Replace($text,$pattern,$line)}
 return $text.TrimEnd()+"`n"+$line+"`n"
}
try{
 $c.Open()
 if((Scalar "SELECT CONVERT(nvarchar(128),SERVERPROPERTY('ServerName'))") -cne 'R740-SRV\SQL2008' -or
    (Scalar "SELECT DB_ID(N'dbwins_worldfert9_uat')") -ne 10 -or
    (Scalar "SELECT IS_SRVROLEMEMBER('sysadmin')") -ne 1){throw 'SQL identity or administrator check failed.'}
 if((Scalar "SELECT COUNT(*) FROM sys.server_principals WHERE name IN(N'wf_r740_uat_app_v2',N'wf_r740_uat_migrator_v2')") -ne 0){throw 'New login namespace already exists; never reset existing credentials.'}
 foreach($p in @($PrincipalScript,$appFile,$migrationFile)){if(-not(Test-Path -LiteralPath $p)){throw 'Required local file missing.'}}
 $sql=[IO.File]::ReadAllText((Resolve-Path -LiteralPath $PrincipalScript),[Text.Encoding]::UTF8)
 if($sql -notmatch 'USE \[dbwins_worldfert9_uat\]' -or $sql -notmatch 'wf_r740_uat_app_v2' -or
    $sql -notmatch 'wf_r740_uat_migrator_v2' -or
    $sql -notmatch 'CASE WHEN can_open_production = 0 AND other_user_databases = 0 AND is_db_owner = 0'){
  throw 'Principal script must retain the original zero-Production-access proof for the new logins.'
 }
 Write-Output 'ISOLATED_UAT_PLAN=R740-SRV\SQL2008/dbwins_worldfert9_uat/10 NEW_LOGINS=2 EXISTING_LOGINS_CHANGED=0'
 Write-Output ('ISOLATED_UAT_PRINCIPALS_SHA256='+(Get-FileHash -LiteralPath $PrincipalScript).Hash)
 if(-not $Apply){Write-Output 'ISOLATED_UAT_SETUP=PLAN_ONLY';return}
 $stage='PRIVATE_STAGING'
 $backup=Join-Path $config ('before-isolated-'+(Get-Date -Format yyyyMMdd-HHmmss))
 [void](New-Item -ItemType Directory -Path $backup);PrivateAcl $backup $true
 $appHash=(Get-FileHash -LiteralPath $appFile).Hash;$migrationHash=(Get-FileHash -LiteralPath $migrationFile).Hash
 Copy-Item -LiteralPath $appFile -Destination (Join-Path $backup 'app-before.env')
 Copy-Item -LiteralPath $migrationFile -Destination (Join-Path $backup 'migrator-before.env')
 $appPassword='Uat2!'+(RandomText 32);$migrationPassword='Uat2!'+(RandomText 32)
 if($appPassword -ceq $migrationPassword){throw 'Generated passwords must differ.'}
 $appBody=[IO.File]::ReadAllText($appFile,[Text.Encoding]::UTF8)
 $appBody=SetEnvValue $appBody 'ONPREM_DB_PASSWORD' $appPassword
 # A changed database identity invalidates old UAT JWT sessions; web user passwords are unchanged.
 $appBody=SetEnvValue $appBody 'JWT_SECRET' (RandomText 48)
 $migrationBody="ONPREM_MIGRATOR_USER=$migrationLogin`nONPREM_MIGRATOR_PASSWORD='$migrationPassword'`n"
 $stagedApp=Join-Path $backup 'app-new.env';$stagedMigration=Join-Path $backup 'migrator-new.env'
 [IO.File]::WriteAllText($stagedApp,$appBody,[Text.UTF8Encoding]::new($false))
 [IO.File]::WriteAllText($stagedMigration,$migrationBody,[Text.UTF8Encoding]::new($false))
 PrivateAcl $stagedApp $false;PrivateAcl $stagedMigration $false
 $stage='CREATE_NEW_LOGINS'
 $tx=$c.BeginTransaction()
 foreach($item in @(@{Name=$appLogin;Password=$appPassword},@{Name=$migrationLogin;Password=$migrationPassword})){
  $cmd=$c.CreateCommand();$cmd.Transaction=$tx;$cmd.CommandTimeout=30
  [void]$cmd.Parameters.Add('@pwd',[Data.SqlDbType]::NVarChar,128);$cmd.Parameters['@pwd'].Value=$item.Password
  $cmd.CommandText="DECLARE @s nvarchar(max); SET @s=N'CREATE LOGIN ["+$item.Name+"] WITH PASSWORD=N'''+REPLACE(@pwd,N'''',N'''''')+N''',CHECK_POLICY=ON,CHECK_EXPIRATION=OFF,DEFAULT_DATABASE=[dbwins_worldfert9_uat];'; EXEC(@s);"
  try{[void]$cmd.ExecuteNonQuery()}finally{$cmd.Dispose()}
 }
 $stage='CLONE_PERMISSIONS'
 foreach($batch in [regex]::Split($sql,'(?im)^GO[ \t]*\r?$')){if(-not $batch.Trim()){continue};$cmd=$c.CreateCommand();$cmd.Transaction=$tx;$cmd.CommandTimeout=30;$cmd.CommandText=$batch;try{[void]$cmd.ExecuteNonQuery()}finally{$cmd.Dispose()}}
 $stage='ISOLATION_PROOF'
 foreach($login in @($appLogin,$migrationLogin)){
  $cmd=$c.CreateCommand();$cmd.Transaction=$tx;$cmd.CommandTimeout=30
  $cmd.CommandText="EXECUTE AS LOGIN=N'$login'; SELECT HAS_DBACCESS(N'dbwins_worldfert9'),(SELECT COUNT(*) FROM sys.databases WHERE database_id>4 AND name<>DB_NAME() AND HAS_DBACCESS(name)=1),IS_ROLEMEMBER(N'db_owner'),IS_SRVROLEMEMBER(N'sysadmin'); REVERT;"
  $r=$cmd.ExecuteReader()
  try{if(-not $r.Read()){throw 'Isolation proof missing.'};for($i=0;$i -lt 4;$i++){if($r.IsDBNull($i) -or [int]$r.GetValue($i) -ne 0){throw 'Isolated login can access another user database or has an elevated role.'}}}finally{$r.Close();$cmd.Dispose()}
 }
 if((Get-FileHash -LiteralPath $appFile).Hash -cne $appHash -or (Get-FileHash -LiteralPath $migrationFile).Hash -cne $migrationHash){throw 'UAT config changed during setup; stop before commit.'}
 $tx.Commit();$tx.Dispose();$tx=$null;$committed=$true
 $stage='INSTALL_PRIVATE_SETTINGS'
 Copy-Item -LiteralPath $stagedApp -Destination $appFile -Force
 Copy-Item -LiteralPath $stagedMigration -Destination $migrationFile -Force
 PrivateAcl $appFile $false;PrivateAcl $migrationFile $false
 if((Get-FileHash -LiteralPath $appFile).Hash -cne (Get-FileHash -LiteralPath $stagedApp).Hash -or
    (Get-FileHash -LiteralPath $migrationFile).Hash -cne (Get-FileHash -LiteralPath $stagedMigration).Hash){throw 'Private settings copy verification failed.'}
 Write-Output 'ISOLATED_UAT_SETUP=PASS NEW_LOGINS=2 PRODUCTION_ACCESS=0 OTHER_USER_DATABASE_ACCESS=0 ELEVATED_ROLES=0 EXISTING_LOGINS_CHANGED=0 WEB_PASSWORDS_CHANGED=0 UAT_SESSIONS_ROTATED=true'
 Write-Output ('ISOLATED_UAT_PRIVATE_RECOVERY='+$backup)
}catch{
 if($tx){try{$tx.Rollback()}catch{};try{$tx.Dispose()}catch{};$tx=$null}
 Write-Output ('ISOLATED_UAT_SETUP=FAILED STAGE='+$stage+' SQL_COMMITTED='+$committed.ToString().ToLowerInvariant())
 $ex=$_.Exception;while($ex){if($ex -is [Data.SqlClient.SqlException]){foreach($e in $ex.Errors){Write-Output ('SQL_NUMBER='+$e.Number+' LINE='+$e.LineNumber)}};$ex=$ex.InnerException}
 exit 1
}finally{$c.Dispose()}
