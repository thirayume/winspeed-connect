-- @transaction
IF OBJECT_ID('wf.GiveawayQuotaLoan','U') IS NOT NULL
BEGIN
 IF EXISTS(SELECT 1 FROM wf.GiveawayQuotaLoan)
  RAISERROR('ROLLBACK_261_BLOCKED: quota loan history exists',16,1);
 ELSE
 BEGIN
  IF OBJECT_ID('wf.GiveawayQuotaRepayment','U') IS NOT NULL DROP TABLE wf.GiveawayQuotaRepayment;
  DROP TABLE wf.GiveawayQuotaLoan;
 END
END
ELSE IF OBJECT_ID('wf.GiveawayQuotaRepayment','U') IS NOT NULL
 RAISERROR('ROLLBACK_261_BLOCKED: orphan repayment table requires review',16,1);
GO
