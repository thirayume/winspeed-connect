-- @transaction
-- Compatibility rollback only with the bridge disabled; history is retained.
IF EXISTS(SELECT 1 FROM wf.CouponBridgeContract WHERE Enabled=1)
 OR EXISTS(SELECT 1 FROM wf.CouponBridgePermit WHERE State='STARTED' AND ReleasedAtUtc IS NULL)
 RAISERROR('BRIDGE_DISABLE_BEFORE_ALLOCATOR_DOWN',16,1);
GO
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
  SELECT @N=ISNULL(MAX(RedemtionID)+1,@P) FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID>=@P AND RedemtionID<@P+1000;
  IF @N<@P+1000 BEGIN SET @NewId=@N; RETURN; END; SET @P=NULL;
 END;
 RAISERROR('MR_ID_EXHAUSTED',16,1);
END
GO
