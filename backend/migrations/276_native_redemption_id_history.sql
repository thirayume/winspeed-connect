-- @transaction
-- Native 116 IDs remain owned after cancellation. Do not rewrite any receipt.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
ALTER PROCEDURE wf.usp_AllocateNativeRedemptionId @NewId int OUTPUT
AS
BEGIN
 SET NOCOUNT ON; SET @NewId=NULL;
 IF @@TRANCOUNT=0 OR wf.fn_IsNativeDocumentTarget()<>1 BEGIN RAISERROR('ND_TARGET_NOT_READY',16,1); RETURN; END;
 DECLARE @P int,@M int,@D int,@N int,@G int; SET @G=0;
 SELECT @P=MAX(Prefix) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=1 AND Name='wssale-app/backend/wfredemtionhd';
 WHILE @G<20 BEGIN
  SET @G=@G+1;
  IF @P IS NULL BEGIN
   SELECT @M=ISNULL(MAX(Prefix),0) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=1 AND CHARINDEX('wfredemtionhd',LOWER(Name))>0;
   SELECT @D=ISNULL(MAX(RedemtionID),0) FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK);
   IF @D/1000*1000>@M SET @M=@D/1000*1000;
   IF @M>2147481000 BEGIN RAISERROR('MR_ID_EXHAUSTED',16,1); RETURN; END;
   SET @P=@M+1000; INSERT INTO dbo.SMID(Name,Prefix,Type) VALUES('wssale-app/backend/wfredemtionhd',@P,1);
  END;
  IF @P%1000<>0 OR @P>2147482000 OR EXISTS(SELECT 1 FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK)
   WHERE Type=1 AND Prefix=@P AND CHARINDEX('wfredemtionhd',LOWER(Name))>0 AND Name<>'wssale-app/backend/wfredemtionhd')
  BEGIN RAISERROR('MR_ID_CONFLICT',16,1); RETURN; END;
  -- A cancelled native header can disappear while its immutable receipt,
  -- reservation history or orphan details still own the ID. Never reuse it.
  SELECT @N=ISNULL(MAX(Id)+1,@P) FROM(
   SELECT RedemtionID AS Id FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID>=@P AND RedemtionID<@P+1000
   UNION ALL SELECT RedemtionID FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID>=@P AND RedemtionID<@P+1000
   UNION ALL SELECT NativeId FROM wf.NativeDocumentReceipt WITH(UPDLOCK,HOLDLOCK) WHERE DocuType=116 AND NativeId>=@P AND NativeId<@P+1000
   UNION ALL SELECT RedemptionID FROM wf.NativeManualRedemptionReceipt WITH(UPDLOCK,HOLDLOCK) WHERE RedemptionID>=@P AND RedemptionID<@P+1000
   UNION ALL SELECT NativeId FROM wf.CouponBridgeDocument WITH(UPDLOCK,HOLDLOCK) WHERE NativeId>=@P AND NativeId<@P+1000
   UNION ALL SELECT NativeId FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK) WHERE NativeId>=@P AND NativeId<@P+1000
   UNION ALL SELECT NativeRedemptionId FROM wf.CouponReservationSettlement WITH(UPDLOCK,HOLDLOCK) WHERE NativeRedemptionId>=@P AND NativeRedemptionId<@P+1000
  ) owned;

  IF @N<@P+1000 BEGIN SET @NewId=@N; RETURN; END; SET @P=NULL;
 END;
 RAISERROR('MR_ID_EXHAUSTED',16,1);
END
GO
