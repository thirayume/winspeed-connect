-- Only the app's scoped approval service calls this procedure. The existing
-- application database principal has EXECUTE on wf. Native code consumes
-- the approved rows without granting anyone direct DML on the intent table.
CREATE PROCEDURE wf.sp_ApproveCouponNativeEditLine
    @EditId UNIQUEIDENTIFIER, @CouponId INT, @AuthorizationLineId BIGINT,
    @SettlementId BIGINT, @RedemptionId INT, @QtyBefore DECIMAL(12,4),
    @QtyAfter DECIMAL(12,4), @NativeBefore DECIMAL(18,4), @Operation CHAR(1),
    @DocuNo VARCHAR(50), @DocuDate DATE, @EffectiveUserId INT, @ActorUserId INT
AS
BEGIN
    SET NOCOUNT ON;
    IF @@TRANCOUNT<1 OR XACT_STATE()<>1
    BEGIN RAISERROR('COUPON_EDIT_APPROVAL_TRANSACTION_REQUIRED',16,1);RETURN;END;

    IF @EditId IS NULL OR @CouponId IS NULL OR @AuthorizationLineId IS NULL
       OR @SettlementId IS NULL OR @RedemptionId IS NULL OR @QtyBefore IS NULL OR @QtyBefore<=0
       OR @QtyAfter IS NULL OR @QtyAfter<0 OR @QtyAfter>@QtyBefore OR @NativeBefore IS NULL OR @NativeBefore<0
       OR @Operation IS NULL OR @Operation NOT IN ('E','C') OR (@Operation='C' AND @QtyAfter<>0)
       OR @DocuDate IS NULL OR NULLIF(RTRIM(@DocuNo),'') IS NULL OR @DocuNo IS NULL
       OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH (HOLDLOCK) WHERE Id=@EffectiveUserId AND IsActive=1)
       OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH (HOLDLOCK) WHERE Id=@ActorUserId AND IsActive=1)
    BEGIN RAISERROR('COUPON_EDIT_APPROVAL_INVALID',16,1);RETURN;END;

    IF EXISTS(SELECT 1 FROM wf.CouponNativeEditIntent WITH (UPDLOCK,HOLDLOCK) WHERE CouponId=@CouponId)
       OR EXISTS(SELECT 1 FROM wf.CouponNativeEditHold WITH (HOLDLOCK) WHERE CouponId=@CouponId)
       OR EXISTS(SELECT 1 FROM wf.CouponNativeRecovery WITH (HOLDLOCK)
                 WHERE SettlementId=@SettlementId OR AuthorizationLineId=@AuthorizationLineId)
    BEGIN RAISERROR('COUPON_EDIT_APPROVAL_ALREADY_EXISTS',16,1);RETURN;END;

    INSERT wf.CouponNativeEditIntent(
        EditId,CouponId,AuthorizationLineId,SettlementId,NativeRedemptionId,
        QtyBefore,QtyAfter,NativeBefore,Operation,DocuNo,DocuDate,EffectiveUserId,ActorUserId,ExpiresAt
    )
    SELECT @EditId,l.CouponId,l.Id,s.Id,s.NativeRedemptionId,@QtyBefore,@QtyAfter,@NativeBefore,
           @Operation,@DocuNo,@DocuDate,@EffectiveUserId,@ActorUserId,DATEADD(minute,15,GETUTCDATE())
    FROM wf.CouponNativeCutAuthorizationLine l WITH (HOLDLOCK)
    JOIN wf.CouponNativeCutEvidence e WITH (HOLDLOCK) ON e.AuthorizationLineId=l.Id
    JOIN wf.CouponReservationSettlement s WITH (HOLDLOCK)
      ON s.CouponId=l.CouponId AND s.ReservationId=l.ReservationId AND s.NativeRedemptionId=e.NativeRedemptionId
    JOIN dbo.WFCoupon c WITH (HOLDLOCK) ON c.CouponID=l.CouponId
    JOIN dbo.WFRedemtionHD h WITH (HOLDLOCK) ON h.RedemtionID=s.NativeRedemptionId
    WHERE l.Id=@AuthorizationLineId AND s.Id=@SettlementId AND l.CouponId=@CouponId AND s.NativeRedemptionId=@RedemptionId
      AND e.EvidenceState='APPLIED' AND e.BalanceBefore-e.BalanceAfter=@QtyBefore
      AND l.AuthorizedQty=@QtyBefore AND s.SettledQty=@QtyBefore AND c.RemaQty=@NativeBefore
      AND h.DocuType=116 AND h.DocuDate IS NOT NULL AND CONVERT(date,h.DocuDate)=@DocuDate
      AND RTRIM(h.DocuNo)=@DocuNo AND RTRIM(s.NativeDocuNo)=@DocuNo
      AND LTRIM(RTRIM(h.DocuStatus)) IN ('N','Y')
      AND (SELECT COUNT(*) FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
           WHERE d.RedemtionID=@RedemptionId AND d.CouponID=@CouponId)=1
      AND EXISTS(SELECT 1 FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
                 WHERE d.RedemtionID=@RedemptionId AND d.CouponID=@CouponId AND d.GoodQty=@QtyBefore);
    IF @@ROWCOUNT<>1
    BEGIN RAISERROR('COUPON_EDIT_APPROVAL_SOURCE_CHANGED',16,1);RETURN;END;
END;
GO
