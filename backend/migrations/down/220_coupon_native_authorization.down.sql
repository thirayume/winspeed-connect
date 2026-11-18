-- Preserve authorization evidence; an explicit archival procedure is required first.
-- Refuse out-of-order rollback before dropping any authorization table.
IF OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NOT NULL
BEGIN RAISERROR('COUPON_NATIVE_CUT_EVIDENCE_SCHEMA_EXISTS',16,1);RETURN;END;
IF OBJECT_ID('wf.WF_CouponAuthorizationReservationFence','TR') IS NOT NULL
BEGIN RAISERROR('COUPON_NATIVE_AUTH_FENCE_SCHEMA_EXISTS',16,1);RETURN;END;
DECLARE @hasEvidence BIT; SET @hasEvidence=0;
-- Resolve each table only if it exists: SQL Server 2008 can compile an
-- EXISTS against a missing table even when an OBJECT_ID predicate is false.
IF OBJECT_ID('wf.CouponNativeCutAuthorization','U') IS NOT NULL
 EXEC sp_executesql N'IF EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorization) SET @found=1',N'@found BIT OUTPUT',@found=@hasEvidence OUTPUT;
IF OBJECT_ID('wf.CouponNativeCutAuthorizationLine','U') IS NOT NULL
 EXEC sp_executesql N'IF EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorizationLine) SET @found=1',N'@found BIT OUTPUT',@found=@hasEvidence OUTPUT;
IF OBJECT_ID('wf.CouponNativeActiveDocument','U') IS NOT NULL
 EXEC sp_executesql N'IF EXISTS(SELECT 1 FROM wf.CouponNativeActiveDocument) SET @found=1',N'@found BIT OUTPUT',@found=@hasEvidence OUTPUT;
IF @hasEvidence=1 BEGIN RAISERROR('COUPON_NATIVE_AUTH_EVIDENCE_EXISTS',16,1);RETURN;END;
IF OBJECT_ID('wf.CouponNativeCutAuthorizationLine','U') IS NOT NULL DROP TABLE wf.CouponNativeCutAuthorizationLine;
IF OBJECT_ID('wf.CouponNativeActiveDocument','U') IS NOT NULL DROP TABLE wf.CouponNativeActiveDocument;
IF OBJECT_ID('wf.CouponNativeCutAuthorization','U') IS NOT NULL DROP TABLE wf.CouponNativeCutAuthorization;
GO
