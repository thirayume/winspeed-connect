-- Candidate schema only; no trigger, authorization API or native writer is
-- enabled by this migration. A PREPARED row must survive an incomplete native
-- commit so the reservation remains held and the item can be reviewed.
IF OBJECT_ID('wf.CouponNativeCutAuthorizationLine','U') IS NULL
BEGIN RAISERROR('COUPON_NATIVE_EVIDENCE_DEPENDENCIES_MISSING',16,1);RETURN;END;
IF OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NOT NULL AND
 (COL_LENGTH('wf.CouponNativeCutEvidence','AuthorizationLineId') IS NULL OR
  COL_LENGTH('wf.CouponNativeCutEvidence','NativeRedemptionId') IS NULL OR
  COL_LENGTH('wf.CouponNativeCutEvidence','MarkerResource') IS NULL OR
  COL_LENGTH('wf.CouponNativeCutEvidence','OriginTransactionId') IS NULL OR
  COL_LENGTH('wf.CouponNativeCutEvidence','OriginTransactionStartedAt') IS NULL OR
  COL_LENGTH('wf.CouponNativeCutEvidence','EvidenceState') IS NULL OR
  COL_LENGTH('wf.CouponNativeCutEvidence','PreparedAt') IS NULL OR
  COL_LENGTH('wf.CouponNativeCutEvidence','AppliedAt') IS NULL OR
  COL_LENGTH('wf.CouponNativeCutEvidence','BalanceBefore') IS NULL OR
  COL_LENGTH('wf.CouponNativeCutEvidence','BalanceAfter') IS NULL)
BEGIN RAISERROR('COUPON_NATIVE_EVIDENCE_EXISTING_REVIEW_REQUIRED',16,1);RETURN;END;
IF OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NOT NULL AND
 (NOT EXISTS(SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID('wf.CouponNativeCutEvidence') AND type='PK') OR
  NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID('wf.CouponNativeCutEvidence') AND name='FK_CouponNativeEvidence_Line_223' AND is_disabled=0 AND is_not_trusted=0) OR
  NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('wf.CouponNativeCutEvidence') AND name='CK_CouponNativeEvidence_State_223' AND is_disabled=0 AND is_not_trusted=0) OR
  NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('wf.CouponNativeCutEvidence') AND name='CK_CouponNativeEvidence_Redemption_223' AND is_disabled=0 AND is_not_trusted=0) OR
  NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('wf.CouponNativeCutEvidence') AND name='CK_CouponNativeEvidence_Marker_223' AND is_disabled=0 AND is_not_trusted=0) OR
  NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('wf.CouponNativeCutEvidence') AND name='CK_CouponNativeEvidence_Origin_223' AND is_disabled=0 AND is_not_trusted=0))
BEGIN RAISERROR('COUPON_NATIVE_EVIDENCE_EXISTING_REVIEW_REQUIRED',16,1);RETURN;END;
IF OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NULL
BEGIN
 CREATE TABLE wf.CouponNativeCutEvidence (
  AuthorizationLineId BIGINT NOT NULL PRIMARY KEY,
  NativeRedemptionId INT NOT NULL,
  MarkerResource NVARCHAR(255) NOT NULL,
  OriginTransactionId BIGINT NULL,
  OriginTransactionStartedAt DATETIME NULL,
  EvidenceState VARCHAR(16) NOT NULL,
  PreparedAt DATETIME2 NOT NULL CONSTRAINT DF_CouponNativeEvidence_Prepared_223 DEFAULT GETUTCDATE(),
  AppliedAt DATETIME2 NULL,
  BalanceBefore DECIMAL(18,4) NULL,
  BalanceAfter DECIMAL(18,4) NULL,
  CONSTRAINT FK_CouponNativeEvidence_Line_223 FOREIGN KEY(AuthorizationLineId)
    REFERENCES wf.CouponNativeCutAuthorizationLine(Id),
  CONSTRAINT CK_CouponNativeEvidence_Redemption_223 CHECK(NativeRedemptionId>0),
  CONSTRAINT CK_CouponNativeEvidence_Marker_223 CHECK(LEN(MarkerResource)>0),
  CONSTRAINT CK_CouponNativeEvidence_Origin_223 CHECK(
   (OriginTransactionId IS NULL AND OriginTransactionStartedAt IS NULL) OR
   (OriginTransactionId IS NOT NULL AND OriginTransactionId>0 AND OriginTransactionStartedAt IS NOT NULL)),
  CONSTRAINT CK_CouponNativeEvidence_State_223 CHECK(
   (EvidenceState='PREPARED' AND AppliedAt IS NULL AND BalanceBefore IS NULL AND BalanceAfter IS NULL) OR
   (EvidenceState='APPLIED' AND AppliedAt IS NOT NULL AND BalanceBefore IS NOT NULL AND BalanceAfter IS NOT NULL AND
    BalanceBefore>=0 AND BalanceAfter>=0 AND BalanceAfter<BalanceBefore))
 );
END;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.CouponNativeCutEvidence') AND name='IX_CouponNativeEvidence_Redemption_223')
 CREATE INDEX IX_CouponNativeEvidence_Redemption_223 ON wf.CouponNativeCutEvidence(NativeRedemptionId,AuthorizationLineId);
IF NOT EXISTS(SELECT 1 FROM sys.indexes i
 JOIN sys.index_columns c1 ON c1.object_id=i.object_id AND c1.index_id=i.index_id AND c1.key_ordinal=1
 JOIN sys.columns n1 ON n1.object_id=c1.object_id AND n1.column_id=c1.column_id
 JOIN sys.index_columns c2 ON c2.object_id=i.object_id AND c2.index_id=i.index_id AND c2.key_ordinal=2
 JOIN sys.columns n2 ON n2.object_id=c2.object_id AND n2.column_id=c2.column_id
 WHERE i.object_id=OBJECT_ID('wf.CouponNativeCutEvidence') AND i.name='IX_CouponNativeEvidence_Redemption_223'
  AND i.is_disabled=0 AND n1.name='NativeRedemptionId' AND n2.name='AuthorizationLineId')
BEGIN RAISERROR('COUPON_EVIDENCE_SOURCE_INDEX_INVALID',16,1);RETURN;END;
GO
