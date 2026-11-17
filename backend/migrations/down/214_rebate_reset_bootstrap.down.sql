-- MANUAL ONLY: stop writers, verify backup and pre-migration object provenance;
-- 214 conditionally created objects, so presence alone does not prove ownership.
-- Set this flag to 1 only after review. The normal migration runner never runs down scripts.
DECLARE @ConfirmedProvenance bit = 0;
IF @ConfirmedProvenance <> 1 BEGIN RAISERROR('Verify backup, stopped writers and object provenance first.',16,1); RETURN; END;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @n bigint = 0;
  IF OBJECT_ID('wf.RebateResetBootstrapTarget','U') IS NOT NULL
    EXEC sp_executesql N'SELECT @n=COUNT_BIG(*) FROM wf.RebateResetBootstrapTarget WITH (TABLOCKX,HOLDLOCK)',N'@n bigint OUTPUT',@n OUTPUT;
  IF @n > 0 RAISERROR('Reset bootstrap target journal is not empty.',16,1);
  SET @n=0;
  IF OBJECT_ID('wf.RebateResetBootstrap','U') IS NOT NULL
    EXEC sp_executesql N'SELECT @n=COUNT_BIG(*) FROM wf.RebateResetBootstrap WITH (TABLOCKX,HOLDLOCK)',N'@n bigint OUTPUT',@n OUTPUT;
  IF @n > 0 RAISERROR('Reset bootstrap journal is not empty.',16,1);
  SET @n=0;
  IF COL_LENGTH('wf.RebateResetParticipant','BootstrapId') IS NOT NULL
    EXEC sp_executesql N'SELECT @n=COUNT_BIG(*) FROM wf.RebateResetParticipant WITH (TABLOCKX,HOLDLOCK) WHERE BootstrapId IS NOT NULL',N'@n bigint OUTPUT',@n OUTPUT;
  IF @n > 0 RAISERROR('Reset participant bootstrap evidence exists.',16,1);
  IF OBJECT_ID('wf.RebateResetBootstrapTarget','U') IS NOT NULL DROP TABLE wf.RebateResetBootstrapTarget;
  IF OBJECT_ID('wf.RebateResetBootstrap','U') IS NOT NULL DROP TABLE wf.RebateResetBootstrap;
  IF COL_LENGTH('wf.RebateResetParticipant','BootstrapId') IS NOT NULL EXEC(N'ALTER TABLE wf.RebateResetParticipant DROP COLUMN BootstrapId');
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  DECLARE @error nvarchar(2048)=ERROR_MESSAGE(); RAISERROR('%s',16,1,@error);
END CATCH;
