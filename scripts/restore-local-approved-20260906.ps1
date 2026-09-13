$ErrorActionPreference='Stop'
$cn=[System.Data.SqlClient.SqlConnection]::new('Server=.\SQLEXPRESS;Database=master;Integrated Security=True;TrustServerCertificate=True')
$cn.Open()
function Run-Sql([string]$q){$cmd=$cn.CreateCommand();$cmd.CommandTimeout=1200;$cmd.CommandText=$q;[void]$cmd.ExecuteNonQuery()}
Run-Sql "IF DB_ID('dbwins_worldfert9_restorecheck_20260906') IS NULL THROW 50000,'Verified staging database missing; refuse cutover',1; IF (SELECT COUNT(*) FROM dbwins_worldfert9_restorecheck_20260906.wf.SchemaMigration) <> 109 THROW 50001,'Unexpected staging ledger',1;"
$stamp=Get-Date -Format yyyyMMddTHHmmss
$backup="C:\Program Files\Microsoft SQL Server\MSSQL16.SQLEXPRESS\MSSQL\Backup\pre_restore_dbwins_worldfert9_$stamp.bak"
Run-Sql "BACKUP DATABASE [dbwins_worldfert9] TO DISK=N'$backup' WITH COPY_ONLY,CHECKSUM; RESTORE VERIFYONLY FROM DISK=N'$backup' WITH CHECKSUM;"
Write-Output "LOCAL_SAFETY_BACKUP=$backup"
$archive="dbwins_worldfert9_before_20260906_$stamp"
Run-Sql "ALTER DATABASE [dbwins_worldfert9] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; ALTER DATABASE [dbwins_worldfert9] MODIFY NAME=[$archive]; ALTER DATABASE [$archive] SET MULTI_USER; ALTER DATABASE [dbwins_worldfert9_restorecheck_20260906] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; ALTER DATABASE [dbwins_worldfert9_restorecheck_20260906] MODIFY NAME=[dbwins_worldfert9]; ALTER DATABASE [dbwins_worldfert9] SET MULTI_USER;"
$cn.Close()
Write-Output "LOCAL_PREVIOUS_DATABASE=$archive"
Write-Output 'LOCAL_CUTOVER_COMPLETE'