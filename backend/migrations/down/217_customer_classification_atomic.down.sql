-- MANUAL ONLY: stop writers, back up, roll back dependent application code,
-- and verify object provenance before explicitly setting this flag.
DECLARE @ConfirmedProvenance bit = 0;
IF @ConfirmedProvenance <> 1 BEGIN RAISERROR('Verify backup, stopped writers, app version and object provenance first.',16,1); RETURN; END;
IF OBJECT_ID('wf.sp_MasterCustomerClassification','P') IS NOT NULL DROP PROCEDURE wf.sp_MasterCustomerClassification;
