-- Synthetic read-integration fixtures on the restored v2 test DB only.
-- Uses existing booking/master references, never changes those bookings or coupon balances.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
IF DB_NAME() <> N'dbwins_worldfert9_test_v2'
BEGIN RAISERROR('V2 seed requires dbwins_worldfert9_test_v2',16,1); RETURN; END;
IF EXISTS(SELECT 1 FROM dbo.WGHD) OR EXISTS(SELECT 1 FROM dbo.WGDT) OR EXISTS(SELECT 1 FROM dbo.WGDTReport)
BEGIN RAISERROR('Run the explicit v2 weighing reset before seeding',16,1); RETURN; END;
DECLARE @Source TABLE(N int IDENTITY(1,1),SOID int,DocuNo varchar(50),CustID int,CustCode varchar(50),CustName nvarchar(200),ListNo int,GoodID int,GoodName nvarchar(200),UnitID int);
INSERT @Source(SOID,DocuNo,CustID,CustCode,CustName,ListNo,GoodID,GoodName,UnitID)
SELECT TOP 3 h.SOID,h.DocuNo,h.CustID,c.CustCode,c.CustName,d.ListNo,d.GoodID,d.GoodName,d.GoodUnitID2
FROM dbo.SOHD h JOIN dbo.SODT d ON d.SOID=h.SOID
JOIN dbo.EMCust c ON c.CustID=h.CustID JOIN dbo.EMGoodUnit u ON u.GoodUnitID=d.GoodUnitID2
WHERE h.DocuType=103 AND h.DocuStatus<>'C' AND d.GoodQty2>=10 AND RTRIM(u.GoodUnitName)=N'ตัน'
ORDER BY h.DocuDate DESC,h.SOID DESC,d.ListNo;
IF (SELECT COUNT(*) FROM @Source)<>3
BEGIN RAISERROR('Backup lacks three suitable native booking lines for fixtures',16,1); RETURN; END;
BEGIN TRANSACTION;
IF OBJECT_ID('wf.TestFixtureRun','U') IS NULL
CREATE TABLE wf.TestFixtureRun(RunId uniqueidentifier NOT NULL,Scenario varchar(50) NOT NULL,WGHDId int NOT NULL,SourceSOID int NOT NULL,SourceListNo int NOT NULL,CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
DECLARE @Run uniqueidentifier=NEWID(),@N int=1,@H int,@Base datetime=CONVERT(datetime,'20260907',112);
WHILE @N<=3
BEGIN
INSERT dbo.WGHD(DateReg,CarNo,TotalTon,TotalKasob,SPID,CVID,CVCode,CVName,DocuNo,WGType,isMulti,MoveBill,DateIn,WeightIn,DateOut,WeightOut,WeightNet,Status,QStatus,UpdateDate,UpdateBy,isNOQ)
SELECT @Base,'V2-TEST-0'+CONVERT(varchar(1),@N),10,200,SOID,CustID,CustCode,CustName,DocuNo,'SO',0,'V2-FIX-0'+CONVERT(varchar(1),@N),
CASE WHEN @N>=2 THEN DATEADD(hour,8,@Base) END,CASE WHEN @N>=2 THEN 12000 END,
CASE WHEN @N=3 THEN DATEADD(hour,10,@Base) END,CASE WHEN @N=3 THEN 22000 END,CASE WHEN @N=3 THEN 10000 END,@N,0,GETDATE(),'V2-SYNTHETIC',0
FROM @Source WHERE N=@N;
SET @H=CONVERT(int,SCOPE_IDENTITY());
INSERT dbo.WGDT(WGHDId,SPID,ListNo,GoodID,GoodName,GoodUnitID2,GoodUnitName,GoodQty2,Qty1,Qty2,GoodTon,GoodKasob,STOCode,STOCode2,CouponNo)
SELECT @H,SOID,ListNo,GoodID,GoodName,UnitID,N'ตัน',10,10,200,10,200,'','','' FROM @Source WHERE N=@N;
INSERT wf.TestFixtureRun(RunId,Scenario,WGHDId,SourceSOID,SourceListNo)
SELECT @Run,CASE @N WHEN 1 THEN 'WAITING' WHEN 2 THEN 'LOADING' ELSE 'WEIGHED_OUT' END,@H,SOID,ListNo FROM @Source WHERE N=@N;
SET @N=@N+1;
END;
COMMIT;
SELECT r.Scenario,h.DocuNo,h.Status,h.WeightIn,h.WeightOut,h.WeightNet FROM wf.TestFixtureRun r JOIN dbo.WGHD h ON h.Id=r.WGHDId WHERE r.RunId=@Run;
-- WGDTReport intentionally stays empty: derived report schema is not fabricated.
