/* Private UAT evidence backup only. Does not restore or modify a database.
   Run on R740-SRV\SQL2008 before the nightly refresh. */
SET NOCOUNT ON;
IF UPPER(CONVERT(varchar(128), @@SERVERNAME)) <> 'R740-SRV\SQL2008'
   OR DB_NAME() <> 'dbwins_worldfert9_uat'
   OR DB_ID('dbwins_worldfert9_uat') IS NULL
BEGIN RAISERROR('Unexpected UAT target; no backup attempted.',16,1); RETURN; END;
DECLARE @path nvarchar(4000);
SET @path=N'D:\MSSQL\MSSQL10_50.SQL2008\Backup\dbwins_worldfert9_uat_rebate_evidence_20261114.bak';
DECLARE @fileExists int;
EXEC master.dbo.xp_fileexist @path, @fileExists OUTPUT;
IF @fileExists IS NULL OR @fileExists <> 0
BEGIN RAISERROR('Evidence backup path already exists or cannot be checked; refuse overwrite.',16,1); RETURN; END;
IF EXISTS (SELECT 1 FROM msdb.dbo.backupmediafamily WHERE physical_device_name=@path)
BEGIN RAISERROR('Evidence backup path is already recorded; refuse overwrite.',16,1); RETURN; END;
BACKUP DATABASE [dbwins_worldfert9_uat] TO DISK=@path
  WITH COPY_ONLY, CHECKSUM, NAME=N'Private UAT rebate rehearsal evidence 20261114', STATS=10;
RESTORE VERIFYONLY FROM DISK=@path WITH CHECKSUM;
SELECT 'UAT_EVIDENCE_BACKUP_VERIFIED' AS result, @path AS backup_file,
       CONVERT(varchar(19),GETDATE(),120) AS verified_at;
