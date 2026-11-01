-- UAT ONLY: one labelled simulated scale record for a Full Loop run, line I (backend/scripts/uat-full-loop.cjs).
-- Run after I-104, as a sysadmin on the UAT clone; the nightly restore removes the row:
--   sqlcmd -S R740-SRV\SQL2008 -E -b -d dbwins_worldfert9_uat -v BookingNo="<103 number>" RunLabel="<UAT_LOOP_RUN>" -i uat-simulated-scale-record.sql
-- The slip number is 99 + the last five digits of the booking's SOID, the test slip range, so it can never
-- look like a real MoveBill. The row is marked as not a real weighing.
SET NOCOUNT ON; SET XACT_ABORT ON;
IF @@SERVERNAME<>N'R740-SRV\SQL2008' OR DB_NAME()<>N'dbwins_worldfert9_uat'
BEGIN RAISERROR('NOT_UAT_TARGET',16,1); RETURN; END;
DECLARE @soid int,@mb nvarchar(20),@cust int;
BEGIN TRAN;
SELECT @soid=SOID,@cust=CustID FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK) WHERE DocuType=103 AND DocuNo=N'$(BookingNo)';
SET @mb=N'99'+RIGHT('00000'+CONVERT(varchar(5),@soid%100000),5);
IF @soid IS NULL
 OR EXISTS(SELECT 1 FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID=@soid)
 OR EXISTS(SELECT 1 FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE RTRIM(MoveBill)=@mb)
 OR EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE DocuNo=@mb)
BEGIN ROLLBACK; RAISERROR('SIMULATION_PRECONDITION_FAILED',16,1); RETURN; END;
INSERT INTO dbo.WGHD(DateReg,CarNo,TotalTon,TotalKasob,SPID,CVID,CVCode,CVName,DocuNo,WGType,isMulti,MoveBill,DateIn,WeightIn,DateOut,WeightOut,WeightNet,Status,UpdateDate,UpdateBy,isNOQ,Remark)
VALUES(DATEADD(minute,-40,GETDATE()),N'UAT2-R740-I',1.00,20.00,@soid,@cust,N'UAT2',N'UAT LOOP TEST',N'$(BookingNo)',N'SO',0,@mb,
 DATEADD(minute,-35,GETDATE()),10000,DATEADD(minute,-5,GETDATE()),11004,1004,N'3',GETDATE(),N'UAT LOOP TEST',0,N'UAT2 simulated scale record $(RunLabel) (not a real weighing)');
COMMIT;
SELECT Id, SPID, RTRIM(MoveBill) AS MoveBill, RTRIM(CarNo) AS CarNo, WeightNet, RTRIM(Status) AS Status FROM dbo.WGHD WHERE WGType='SO' AND SPID=@soid;
