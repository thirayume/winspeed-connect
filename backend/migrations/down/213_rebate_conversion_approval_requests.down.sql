-- MANUAL ONLY, stop all writers and restore/test a backup first. This script
-- is not run by run_migrations.js. Verify that 213 created the objects: it
-- could have encountered pre-existing tables/columns. Only after verification
-- change the following flag to 1. Do not run on populated business journals.
DECLARE @ConfirmedProvenance bit = 0;
IF @ConfirmedProvenance <> 1 BEGIN RAISERROR('Verify backup, stopped writers and object provenance first.',16,1); RETURN; END;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @n bigint = 0;
  IF OBJECT_ID('wf.RebateConversionApprovalRequest','U') IS NOT NULL
    EXEC sp_executesql N'SELECT @n=COUNT_BIG(*) FROM wf.RebateConversionApprovalRequest WITH (TABLOCKX,HOLDLOCK)',N'@n bigint OUTPUT',@n OUTPUT;
  IF @n > 0 RAISERROR('Conversion approval journal is not empty.',16,1);
  SET @n=0;
  IF COL_LENGTH('wf.RebateResetAttemptTarget','BusinessActorId') IS NOT NULL
    EXEC sp_executesql N'SELECT @n=COUNT_BIG(*) FROM wf.RebateResetAttemptTarget WITH (TABLOCKX,HOLDLOCK) WHERE BusinessActorId IS NOT NULL',N'@n bigint OUTPUT',@n OUTPUT;
  IF @n > 0 RAISERROR('Reset actor evidence exists.',16,1);
  SET @n=0;
  IF COL_LENGTH('wf.RebateResetAttemptTarget','BusinessEffectiveId') IS NOT NULL
    EXEC sp_executesql N'SELECT @n=COUNT_BIG(*) FROM wf.RebateResetAttemptTarget WITH (TABLOCKX,HOLDLOCK) WHERE BusinessEffectiveId IS NOT NULL',N'@n bigint OUTPUT',@n OUTPUT;
  IF @n > 0 RAISERROR('Reset effective identity evidence exists.',16,1);
  IF OBJECT_ID('wf.RebateConversionApprovalRequest','U') IS NOT NULL DROP TABLE wf.RebateConversionApprovalRequest;
  IF COL_LENGTH('wf.RebateResetAttemptTarget','BusinessActorId') IS NOT NULL EXEC(N'ALTER TABLE wf.RebateResetAttemptTarget DROP COLUMN BusinessActorId');
  IF COL_LENGTH('wf.RebateResetAttemptTarget','BusinessEffectiveId') IS NOT NULL EXEC(N'ALTER TABLE wf.RebateResetAttemptTarget DROP COLUMN BusinessEffectiveId');
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  DECLARE @error nvarchar(2048)=ERROR_MESSAGE(); RAISERROR('%s',16,1,@error);
END CATCH;
