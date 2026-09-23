-- Persistent synthetic weighing samples, never production/hardware evidence.
-- See docs/v2/WEIGHING-SAMPLE-DATA-20260917.md. No reset, no SO status changes.
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'dbwins_worldfert9_test_v2' THROW 51000,'TEST database required',1;
BEGIN TRANSACTION;
DECLARE @Lock int;
EXEC @Lock=sys.sp_getapplock @Resource='WF_SAMPLE_WEIGHING_20260917_V1',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
IF @Lock<0 THROW 51001,'Sample seed lock unavailable',1;
IF OBJECT_ID('wf.WeighingSampleManifest','U') IS NULL
 CREATE TABLE wf.WeighingSampleManifest (
 BatchKey varchar(50) NOT NULL, Scenario varchar(30) NOT NULL, WGHDId int NOT NULL,
 WGDTId int NOT NULL, WGDTReportId int NULL, SourceSOID int NOT NULL, SourceListNo int NOT NULL,
 QtyTon decimal(8,2) NOT NULL, CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_WeighingSampleManifest PRIMARY KEY(BatchKey,WGDTId));
DECLARE @Batch varchar(50)='SAMPLE-WEIGH-20260917-V1';
IF NOT EXISTS(SELECT 1 FROM wf.WeighingSampleManifest WHERE BatchKey=@Batch)
BEGIN
 DECLARE @Source TABLE(N int,SOID int,DocuNo nvarchar(25),CustID int,CustCode nvarchar(50),CustName nvarchar(255),ListNo int,GoodID int,GoodName nvarchar(255),UnitID int);
 INSERT @Source
 SELECT CASE h.SOID WHEN 278059 THEN 1 WHEN 278057 THEN 2 ELSE 3 END,h.SOID,h.DocuNo,h.CustID,c.CustCode,c.CustName,d.ListNo,d.GoodID,d.GoodName,d.GoodUnitID2
 FROM dbo.SOHD h JOIN dbo.SODT d ON d.SOID=h.SOID JOIN dbo.EMCust c ON c.CustID=h.CustID
 JOIN dbo.EMGoodUnit u ON u.GoodUnitID=d.GoodUnitID2
 WHERE h.SOID IN(278059,278057,278028) AND d.ListNo=1 AND h.DocuType=103 AND h.DocuStatus<>'C' AND d.GoodQty2>=10 AND RTRIM(u.GoodUnitName)=N'ตัน';
 IF (SELECT COUNT(*) FROM @Source)<>3 THROW 51002,'Reviewed source bookings changed; inspect before seeding',1;
 DECLARE @Cases TABLE(N int,Scenario varchar(30),Status nvarchar(2),SourceN int,Multi bit);
 INSERT @Cases VALUES(1,'WAITING','1',1,0),(2,'WEIGHED_IN','2',2,0),(3,'WEIGHED_OUT','3',3,0),(4,'MULTI_BILL_WEIGHED_OUT','3',1,1);
 DECLARE @N int=1,@H int,@D int,@R int,@I int,@SN int,@Scenario varchar(30),@Status nvarchar(2),@Multi bit,@Qty decimal(8,2),@Date datetime=DATEADD(hour,7,GETUTCDATE()),@Move nvarchar(10);
 WHILE @N<=4
 BEGIN
  SELECT @Scenario=Scenario,@Status=Status,@SN=SourceN,@Multi=Multi FROM @Cases WHERE N=@N;
  SET @Move=N'S917V1-0'+CONVERT(nvarchar(1),@N);
  IF EXISTS(SELECT 1 FROM dbo.WGHD WHERE MoveBill=@Move) THROW 51003,'Sample marker exists without manifest; do not duplicate',1;
  INSERT dbo.WGHD(DateReg,CarNo,TotalTon,TotalKasob,SPID,CVID,CVCode,CVName,DocuNo,WGType,isMulti,MoveBill,DateIn,WeightIn,DateOut,WeightOut,WeightNet,TONNet,KGNet,KasobNet,Status,QStatus,LocationName,UpdateDate,UpdateBy,isNOQ)
  SELECT @Date,N'SAMPLE-0917-0'+CONVERT(nvarchar(1),@N),10,200,SOID,CustID,CustCode,CustName,DocuNo,N'SO',@Multi,@Move,
   CASE WHEN @Status IN('2','3') THEN @Date END,CASE WHEN @Status IN('2','3') THEN 14000 END,
   CASE WHEN @Status='3' THEN DATEADD(minute,30,@Date) END,CASE WHEN @Status='3' THEN 24000 END,
   CASE WHEN @Status='3' THEN 10000 END,CASE WHEN @Status='3' THEN 10 END,CASE WHEN @Status='3' THEN 10000 END,CASE WHEN @Status='3' THEN 200 END,
   @Status,'0',N'SYNTHETIC TEST - NOT REAL SCALE',@Date,'SAMPLE-20260917-V1',0 FROM @Source WHERE N=@SN;
  SET @H=CONVERT(int,SCOPE_IDENTITY());
  SET @I=1;
  WHILE @I<=CASE WHEN @Multi=1 THEN 2 ELSE 1 END
  BEGIN
   IF @Multi=1 SET @SN=CASE WHEN @I=1 THEN 1 ELSE 3 END;
   SET @Qty=CASE WHEN @Multi=1 THEN 5 ELSE 10 END;
   INSERT dbo.WGDT(WGHDId,SPID,ListNo,GoodID,GoodName,GoodUnitID2,GoodUnitName,GoodQty2,Qty1,Qty2,GoodWeight,GoodTon,GoodTon1,GoodTon2,GoodKasob,GoodKasob1,GoodKasob2,GoodKG,STOCode,STOCode2,RefNo,CouponNo)
   SELECT @H,SOID,ListNo,GoodID,GoodName,UnitID,N'ตัน',@Qty,@Qty,@Qty*20,50,@Qty,@Qty,0,@Qty*20,@Qty*20,0,@Qty*1000,'','',@Batch,'' FROM @Source WHERE N=@SN;
   SET @D=CONVERT(int,SCOPE_IDENTITY()); SET @R=NULL;
   -- Derived synthetic detail only for completed weighings; allocate net once per detail.
   IF @Status='3'
   BEGIN
    INSERT dbo.WGDTReport(WGDTId,WGHDId,DateReg,CarNo,MoveBill,CVCode,CVName,DocuNo,WGType,DateIn,DateOut,GoodID,GoodName,GoodWeight,GoodKasobNet,GoodTonNet,STOCode,STOName,CouponNo)
    SELECT @D,@H,h.DateReg,h.CarNo,h.MoveBill,s.CustCode,s.CustName,s.DocuNo,'SO',h.DateIn,h.DateOut,s.GoodID,s.GoodName,50,@Qty*20,@Qty,'',N'SYNTHETIC ALLOCATION',''
    FROM dbo.WGHD h CROSS JOIN @Source s WHERE h.Id=@H AND s.N=@SN;
    SET @R=CONVERT(int,SCOPE_IDENTITY());
   END;
   INSERT wf.WeighingSampleManifest(BatchKey,Scenario,WGHDId,WGDTId,WGDTReportId,SourceSOID,SourceListNo,QtyTon)
   SELECT @Batch,@Scenario,@H,@D,@R,SOID,ListNo,@Qty FROM @Source WHERE N=@SN;
   SET @I+=1;
  END;
  SET @N+=1;
 END;
END;
IF (SELECT COUNT(*) FROM wf.WeighingSampleManifest WHERE BatchKey=@Batch)<>5 THROW 51004,'Incomplete sample manifest',1;
IF EXISTS(SELECT 1 FROM wf.WeighingSampleManifest m LEFT JOIN dbo.WGHD h ON h.Id=m.WGHDId LEFT JOIN dbo.WGDT d ON d.Id=m.WGDTId LEFT JOIN dbo.WGDTReport r ON r.Id=m.WGDTReportId
 WHERE m.BatchKey=@Batch AND (h.Id IS NULL OR d.Id IS NULL OR d.WGHDId<>h.Id OR d.SPID<>m.SourceSOID OR d.GoodTon<>m.QtyTon OR h.UpdateBy<>'SAMPLE-20260917-V1' OR (m.WGDTReportId IS NOT NULL AND (r.Id IS NULL OR r.WGDTId<>d.Id OR r.WGHDId<>h.Id OR r.GoodTonNet<>m.QtyTon)))) THROW 51005,'Sample drift detected; inspect rather than overwrite',1;
IF EXISTS(SELECT h.Id FROM dbo.WGHD h JOIN dbo.WGDT d ON d.WGHDId=h.Id WHERE h.Id IN(SELECT WGHDId FROM wf.WeighingSampleManifest WHERE BatchKey=@Batch) GROUP BY h.Id,h.TotalTon HAVING SUM(d.GoodTon)<>h.TotalTon) THROW 51006,'Header/detail quantity mismatch',1;
IF EXISTS(SELECT h.Id FROM dbo.WGHD h JOIN dbo.WGDTReport r ON r.WGHDId=h.Id WHERE h.Id IN(SELECT WGHDId FROM wf.WeighingSampleManifest WHERE BatchKey=@Batch) GROUP BY h.Id,h.WeightIn,h.WeightOut,h.WeightNet HAVING SUM(r.GoodTonNet)*1000<>h.WeightNet OR h.WeightOut-h.WeightIn<>h.WeightNet) THROW 51007,'Net weight allocation mismatch',1;
COMMIT;
SELECT m.*,h.DocuNo HeaderDocuNo,s.DocuNo SourceDocuNo,h.CarNo,h.MoveBill,h.Status,h.WeightIn,h.WeightOut,h.WeightNet FROM wf.WeighingSampleManifest m JOIN dbo.WGHD h ON h.Id=m.WGHDId JOIN dbo.SOHD s ON s.SOID=m.SourceSOID WHERE m.BatchKey=@Batch ORDER BY m.WGHDId,m.WGDTId;