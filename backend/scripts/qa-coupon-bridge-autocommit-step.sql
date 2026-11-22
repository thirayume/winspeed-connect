-- Temporary, private QA driver adapter. Each call deliberately has NO outer
-- user transaction, matching WinSpeed's independently committed save steps.
-- Caller installs on the isolated QA database and drops it after the test.
CREATE PROCEDURE wf.usp_QaCouponBridgeAutocommitStep @permit varchar(36),@step varchar(12) AS
BEGIN
 SET NOCOUNT ON;
 IF DB_NAME()<>'dbwins_worldfert9_uat_v3' OR IS_SRVROLEMEMBER('sysadmin')<>1 OR @@TRANCOUNT<>0
  BEGIN RAISERROR('QA_AUTOCOMMIT_TARGET_OR_DRIVER_INVALID',16,1);RETURN;END;
 DECLARE @id int,@op char(1),@no varchar(25),@date date,@receiver nvarchar(100),@plate nvarchar(25),@emp int;
 SELECT @id=p.NativeId,@op=p.Operation,@no=p.DocuNo,@date=p.DocuDate,@receiver=p.Receiver,@plate=p.Plate,@emp=p.RecorderEmpId
 FROM wf.CouponBridgePermit p JOIN wf.AppUser u ON u.Id=p.UserId
 WHERE p.PermitId=@permit AND p.Reason LIKE 'QA reviewed native WinSpeed %' AND u.Username LIKE 'uat-loop-%';
 IF @id IS NULL BEGIN RAISERROR('QA_AUTOCOMMIT_OWN_FIXTURE_REQUIRED',16,1);RETURN;END;
 IF @step='delete-head' DELETE dbo.WFRedemtionHD WHERE RedemtionID=@id;
 ELSE IF @step='delete-lines' DELETE dbo.WFRedemtionDT WHERE RedemtionID=@id;
 ELSE IF @step='insert-head'
  INSERT dbo.WFRedemtionHD(RedemtionID,DocuNo,DocuDate,DocuType,IssueName,CarLicense,SaveEmpID,SumGoodQty,DocuStatus,IsCheckAll)
   SELECT @id,@no,@date,116,@receiver,@plate,@emp,SUM(AfterQty),'N','Y' FROM wf.CouponBridgeLine WHERE PermitId=@permit;
 ELSE IF @step='insert-lines'
  INSERT dbo.WFRedemtionDT(RedemtionID,Listno,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,CouponID,CouponNo,PostInv,GoodQty,RemaQty,IsCheck)
   SELECT @id,b.[LineNo],c.GoodID,c.InveID,c.LocaID,c.GoodUnitID,c.GoodPrice,c.CouponID,c.CouponNo,'N',b.AfterQty,b.AfterQty,'Y'
   FROM wf.CouponBridgeLine b JOIN dbo.WFCoupon c ON c.CouponID=b.CouponId WHERE b.PermitId=@permit AND b.AfterQty>0;
 ELSE IF @step='net-balance'
  UPDATE c SET RemaQty=b.NativeBefore+b.BeforeQty-b.AfterQty FROM dbo.WFCoupon c JOIN wf.CouponBridgeLine b ON b.CouponId=c.CouponID
   WHERE b.PermitId=@permit AND c.RemaQty<>b.NativeBefore+b.BeforeQty-b.AfterQty;
 ELSE BEGIN RAISERROR('QA_AUTOCOMMIT_STEP_INVALID',16,1);RETURN;END;
END;
