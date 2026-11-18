-- Candidate source fences only. Installed DISABLED and not a 116 consumption
-- bridge: enabling either before testing the full native workflow can block
-- legitimate WinSpeed edits or posting. Evidence is held for human review.
IF OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NULL OR
 OBJECT_ID('dbo.WFRedemtionHD','U') IS NULL OR OBJECT_ID('dbo.WFRedemtionDT','U') IS NULL
BEGIN RAISERROR('COUPON_EVIDENCE_SOURCE_DEPENDENCIES_MISSING',16,1);RETURN;END;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.CouponNativeCutEvidence')
 AND name='IX_CouponNativeEvidence_Redemption_223' AND is_disabled=0)
BEGIN RAISERROR('COUPON_EVIDENCE_SOURCE_INDEX_MISSING',16,1);RETURN;END;
-- EXCEPT compares the complete before/after row with NULL-safe set semantics.
-- Unknown non-comparable column types cannot be safely ignored.
IF EXISTS(SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id
 WHERE c.object_id IN (OBJECT_ID('dbo.WFRedemtionHD'),OBJECT_ID('dbo.WFRedemtionDT'))
 AND (t.system_type_id IN (34,35,99,240,241) OR t.is_assembly_type=1))
BEGIN RAISERROR('COUPON_EVIDENCE_SOURCE_COMPARISON_UNSUPPORTED',16,1);RETURN;END;
-- SQL string equality may ignore case or trailing spaces. All string columns
-- must be known so the trigger also compares their exact stored bytes.
IF (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID('dbo.WFRedemtionHD'))<>13 OR
 (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID('dbo.WFRedemtionDT'))<>15 OR
 EXISTS(SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id
  WHERE t.system_type_id IN (167,175,231,239) AND
   ((c.object_id=OBJECT_ID('dbo.WFRedemtionHD') AND c.name NOT IN ('DocuNo','CardNo','IssueName','CarLicense','DocuStatus','IsCheckAll')) OR
    (c.object_id=OBJECT_ID('dbo.WFRedemtionDT') AND c.name NOT IN ('CouponNo','PostInv','IsCheck')))) OR
 COL_LENGTH('dbo.WFRedemtionHD','DocuNo') IS NULL OR COL_LENGTH('dbo.WFRedemtionHD','CardNo') IS NULL OR
 COL_LENGTH('dbo.WFRedemtionHD','IssueName') IS NULL OR COL_LENGTH('dbo.WFRedemtionHD','CarLicense') IS NULL OR
 COL_LENGTH('dbo.WFRedemtionHD','DocuStatus') IS NULL OR COL_LENGTH('dbo.WFRedemtionHD','IsCheckAll') IS NULL OR
 COL_LENGTH('dbo.WFRedemtionDT','CouponNo') IS NULL OR COL_LENGTH('dbo.WFRedemtionDT','PostInv') IS NULL OR
 COL_LENGTH('dbo.WFRedemtionDT','IsCheck') IS NULL
BEGIN RAISERROR('COUPON_EVIDENCE_SOURCE_SCHEMA_UNREVIEWED',16,1);RETURN;END;
IF OBJECT_ID('dbo.WF_CouponEvidenceHeaderFence','TR') IS NOT NULL AND
 (NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('dbo.WF_CouponEvidenceHeaderFence')
   AND parent_id=OBJECT_ID('dbo.WFRedemtionHD') AND is_disabled=1) OR
  ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.WF_CouponEvidenceHeaderFence')),'') NOT LIKE '%WF_EVIDENCE_HEADER_226_V4%')
BEGIN RAISERROR('COUPON_EVIDENCE_HEADER_EXISTING_REVIEW_REQUIRED',16,1);RETURN;END;
IF OBJECT_ID('dbo.WF_CouponEvidenceDetailFence','TR') IS NOT NULL AND
 (NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('dbo.WF_CouponEvidenceDetailFence')
   AND parent_id=OBJECT_ID('dbo.WFRedemtionDT') AND is_disabled=1) OR
  ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.WF_CouponEvidenceDetailFence')),'') NOT LIKE '%WF_EVIDENCE_DETAIL_226_V4%')
BEGIN RAISERROR('COUPON_EVIDENCE_DETAIL_EXISTING_REVIEW_REQUIRED',16,1);RETURN;END;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID('dbo.WF_CouponEvidenceHeaderFence','TR') IS NULL
 BEGIN
  EXEC(N'CREATE TRIGGER dbo.WF_CouponEvidenceHeaderFence ON dbo.WFRedemtionHD
   AFTER UPDATE,DELETE AS -- WF_EVIDENCE_HEADER_226_V4
   BEGIN SET NOCOUNT ON;
    IF EXISTS(SELECT d.* FROM deleted d WHERE EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK)
      WHERE e.NativeRedemptionId=d.RedemtionID) EXCEPT SELECT i.* FROM inserted i)
    OR EXISTS(SELECT d.RedemtionID,CONVERT(varbinary(max),d.DocuNo),CONVERT(varbinary(max),d.CardNo),
      CONVERT(varbinary(max),d.IssueName),CONVERT(varbinary(max),d.CarLicense),CONVERT(varbinary(max),d.DocuStatus),CONVERT(varbinary(max),d.IsCheckAll)
      FROM deleted d WHERE EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK) WHERE e.NativeRedemptionId=d.RedemtionID)
      EXCEPT SELECT i.RedemtionID,CONVERT(varbinary(max),i.DocuNo),CONVERT(varbinary(max),i.CardNo),
      CONVERT(varbinary(max),i.IssueName),CONVERT(varbinary(max),i.CarLicense),CONVERT(varbinary(max),i.DocuStatus),CONVERT(varbinary(max),i.IsCheckAll) FROM inserted i)
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_EVIDENCE_SOURCE_HELD'',16,1);RETURN;END;
   END');
  DISABLE TRIGGER dbo.WF_CouponEvidenceHeaderFence ON dbo.WFRedemtionHD;
 END;
 IF OBJECT_ID('dbo.WF_CouponEvidenceDetailFence','TR') IS NULL
 BEGIN
  EXEC(N'CREATE TRIGGER dbo.WF_CouponEvidenceDetailFence ON dbo.WFRedemtionDT
   AFTER UPDATE,DELETE AS -- WF_EVIDENCE_DETAIL_226_V4
   BEGIN SET NOCOUNT ON;
    IF EXISTS(SELECT d.* FROM deleted d WHERE EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK)
      WHERE e.NativeRedemptionId=d.RedemtionID) EXCEPT SELECT i.* FROM inserted i)
    OR EXISTS(SELECT d.RedemtionID,d.Listno,CONVERT(varbinary(max),d.CouponNo),CONVERT(varbinary(max),d.PostInv),CONVERT(varbinary(max),d.IsCheck)
      FROM deleted d WHERE EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK) WHERE e.NativeRedemptionId=d.RedemtionID)
      EXCEPT SELECT i.RedemtionID,i.Listno,CONVERT(varbinary(max),i.CouponNo),CONVERT(varbinary(max),i.PostInv),CONVERT(varbinary(max),i.IsCheck) FROM inserted i)
    BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_EVIDENCE_SOURCE_HELD'',16,1);RETURN;END;
   END');
  DISABLE TRIGGER dbo.WF_CouponEvidenceDetailFence ON dbo.WFRedemtionDT;
 END;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 DECLARE @fenceError NVARCHAR(2048);SET @fenceError=ERROR_MESSAGE();RAISERROR(@fenceError,16,1);RETURN;
END CATCH;
GO
