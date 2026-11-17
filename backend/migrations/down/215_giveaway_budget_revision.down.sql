-- MANUAL ONLY: stop all application instances and writers, verify backup and
-- provenance of the existing trigger and column, and roll application code
-- back first. Dropping EditVersion invalidates every outstanding edit token.
-- Set this flag to 1 only after review; the normal runner does not run this.
DECLARE @ConfirmedProvenance bit = 0;
IF @ConfirmedProvenance <> 1 BEGIN RAISERROR('Verify backup, stopped writers, app version and object provenance first.',16,1); RETURN; END;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID('wf.tr_GiveawayWithdrawal_BudgetVersion','TR') IS NOT NULL DROP TRIGGER wf.tr_GiveawayWithdrawal_BudgetVersion;
  IF COL_LENGTH('wf.GiveawayBudget','EditVersion') IS NOT NULL EXEC(N'ALTER TABLE wf.GiveawayBudget DROP COLUMN EditVersion');
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  DECLARE @error nvarchar(2048)=ERROR_MESSAGE(); RAISERROR('%s',16,1,@error);
END CATCH;
