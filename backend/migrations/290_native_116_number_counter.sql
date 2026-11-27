-- @transaction
-- Keep the reviewed native redemption sequence ahead of retained documents.
-- Change only its counter; never renumber a document or lower a counter.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('wf.sp_Native116AdvanceNumberCounter','P') IS NULL
 EXEC('CREATE PROCEDURE wf.sp_Native116AdvanceNumberCounter AS RETURN');
GO
ALTER PROCEDURE wf.sp_Native116AdvanceNumberCounter
 @year char(2),@maintenance bit=0,@expectedLast varchar(50)=NULL
AS
BEGIN
 SET NOCOUNT ON;SET ANSI_WARNINGS ON;SET ANSI_PADDING ON;SET ARITHABORT ON;
 SET CONCAT_NULL_YIELDS_NULL ON;SET NUMERIC_ROUNDABORT OFF;
 IF @@TRANCOUNT<1 OR XACT_STATE()<>1
  OR wf.fn_IsNativeDocumentTarget()<>1
  OR @year IS NULL OR @year NOT LIKE '[0-9][0-9]'
 BEGIN RAISERROR('NATIVE_116_COUNTER_TARGET_OR_TRANSACTION_REQUIRED',16,1);RETURN;END;
 IF @maintenance=1
 BEGIN
  IF ISNULL(HAS_PERMS_BY_NAME('wf','SCHEMA','ALTER'),0)<>1 OR @expectedLast IS NULL
  BEGIN RAISERROR('NATIVE_116_COUNTER_MAINTENANCE_AUTHORITY_REQUIRED',16,1);RETURN;END;
 END
 ELSE IF ISNULL(TRIGGER_NESTLEVEL(OBJECT_ID('wf.Native116CounterOnComplete'),'AFTER','DML'),0)=0
  AND ISNULL(TRIGGER_NESTLEVEL(OBJECT_ID('wf.Native116CounterOnReceipt'),'AFTER','DML'),0)=0
 BEGIN RAISERROR('NATIVE_116_COUNTER_COMPLETED_SAVE_REQUIRED',16,1);RETURN;END;
 DECLARE @lock int,@last varchar(50),@format varchar(50),@max varchar(50),@count int;
 EXEC @lock=sp_getapplock @Resource='WF_NATIVE_DOCUMENTS_V3',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
 IF @lock<0 BEGIN RAISERROR('NATIVE_116_BUSY',16,1);RETURN;END;
 SELECT @count=COUNT(*),@last=MAX(RTRIM(LastNo)),@format=MAX(RTRIM(RunFormat))
  FROM dbo.EMRunBrch WITH(UPDLOCK,HOLDLOCK) WHERE RunCode='redemption';
 IF @count<>1 OR NOT EXISTS(SELECT 1 FROM dbo.EMRunBrch WHERE RunCode='redemption' AND BrchID=1)
  OR @format<>'yy010000' OR @last IS NULL OR LEN(@last)<>8 OR @last LIKE '%[^0-9]%'
  OR NOT EXISTS(SELECT 1 FROM dbo.EMRun WITH(HOLDLOCK) WHERE RunCode='redemption' AND SystemFlag=116 AND RunColumn='docuno' AND HaveBrch='Y')
  OR EXISTS(SELECT 1 FROM dbo.EMRunChar WITH(UPDLOCK,HOLDLOCK) WHERE RunCode='redemption')
 BEGIN RAISERROR('NATIVE_116_COUNTER_FORMAT_REVIEW_REQUIRED',16,1);RETURN;END;
 IF @maintenance=1 AND @last<>@expectedLast
 BEGIN RAISERROR('NATIVE_116_COUNTER_CHANGED_REFRESH_PLAN',16,1);RETURN;END;
 -- Backdated documents and synthetic/non-native number series cannot rewind
 -- or change the year of the vendor's active sequence.
 IF LEFT(@last,2)<>@year RETURN;
 SELECT @max=MAX(DocuNo) FROM(
  SELECT RTRIM(DocuNo) DocuNo FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE DocuType=116
  UNION ALL SELECT RTRIM(DocuNo) FROM wf.CouponBridgeDocument WITH(UPDLOCK,HOLDLOCK)
  UNION ALL SELECT RTRIM(NativeNo) FROM wf.NativeDocumentReceipt WITH(UPDLOCK,HOLDLOCK) WHERE DocuType=116
  UNION ALL SELECT RTRIM(audit_docuno) FROM dbo.SMAudit WITH(UPDLOCK,HOLDLOCK)
   WHERE audit_screen=2098003052 AND brchid=1 AND RTRIM(audit_action) IN('I','U','D','INSERT','UPDATE','DELETE')
 ) history WHERE LEN(DocuNo)=8 AND DocuNo LIKE @year+'[0-9][0-9][0-9][0-9][0-9][0-9]';
 IF RIGHT(@last,6)='999999' OR RIGHT(@max,6)='999999'
 BEGIN RAISERROR('NATIVE_116_NUMBER_SEQUENCE_EXHAUSTED',16,1);RETURN;END;
 IF @max IS NULL OR @max<=@last RETURN;
 UPDATE dbo.EMRunBrch SET LastNo=@max
  WHERE RunCode='redemption' AND BrchID=1 AND RTRIM(LastNo)=@last AND RTRIM(RunFormat)=@format;
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('NATIVE_116_COUNTER_CHANGED_REFRESH_PLAN',16,1);RETURN;END;
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId,BeforeJson,AfterJson)
 VALUES('NATIVE_116_NUMBER_COUNTER','redemption:1','ADVANCE','RETAINED_DOCUMENT_NUMBERS',
  N'Advance reviewed native redemption counter to retained same-year document maximum; no document renumbered',
  LEFT(N'SQL:'+ORIGINAL_LOGIN(),50),LEFT(N'SQL:'+ORIGINAL_LOGIN(),50),
  N'{"lastNo":"'+@last+N'","format":"'+@format+N'"}',N'{"lastNo":"'+@max+N'","format":"'+@format+N'"}');
END;
GO
IF OBJECT_ID('wf.Native116CounterOnComplete','TR') IS NULL
 EXEC('CREATE TRIGGER wf.Native116CounterOnComplete ON wf.Native116Stage AFTER UPDATE AS RETURN');
GO
ALTER TRIGGER wf.Native116CounterOnComplete ON wf.Native116Stage AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @year char(2);
 DECLARE years CURSOR LOCAL FAST_FORWARD FOR
  SELECT DISTINCT LEFT(i.DocuNo,2) FROM inserted i JOIN deleted d ON d.StageId=i.StageId
  WHERE i.State='COMPLETE' AND d.State='PENDING' AND i.NativeAuditId IS NOT NULL AND i.FinalAuditId IS NOT NULL
   AND LEN(RTRIM(i.DocuNo))=8 AND RTRIM(i.DocuNo) NOT LIKE '%[^0-9]%'
   AND LEFT(i.DocuNo,2)=RIGHT(CONVERT(varchar(4),YEAR(i.DocuDate)+543),2);
 OPEN years;FETCH NEXT FROM years INTO @year;
 WHILE @@FETCH_STATUS=0 BEGIN
  EXEC wf.sp_Native116AdvanceNumberCounter @year;
  FETCH NEXT FROM years INTO @year;
 END;CLOSE years;DEALLOCATE years;
END;
GO
IF OBJECT_ID('wf.Native116CounterOnReceipt','TR') IS NULL
 EXEC('CREATE TRIGGER wf.Native116CounterOnReceipt ON wf.NativeDocumentReceipt AFTER INSERT AS RETURN');
GO
ALTER TRIGGER wf.Native116CounterOnReceipt ON wf.NativeDocumentReceipt AFTER INSERT AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @year char(2);
 DECLARE years CURSOR LOCAL FAST_FORWARD FOR
  SELECT DISTINCT LEFT(i.NativeNo,2) FROM inserted i
   JOIN dbo.WFRedemtionHD h ON h.RedemtionID=i.NativeId AND h.DocuType=116 AND h.DocuNo=i.NativeNo
  WHERE i.DocuType=116 AND LEN(RTRIM(i.NativeNo))=8 AND RTRIM(i.NativeNo) NOT LIKE '%[^0-9]%'
   AND LEFT(i.NativeNo,2)=RIGHT(CONVERT(varchar(4),YEAR(h.DocuDate)+543),2);
 OPEN years;FETCH NEXT FROM years INTO @year;
 WHILE @@FETCH_STATUS=0 BEGIN
  EXEC wf.sp_Native116AdvanceNumberCounter @year;
  FETCH NEXT FROM years INTO @year;
 END;CLOSE years;DEALLOCATE years;
END;
GO
-- Reviewed repair on primary targets only. Company2 receives schema without a
-- counter write, and unsupported formats fail before changing any counter.
IF wf.fn_IsNativeDocumentTarget()=1
BEGIN
 DECLARE @year char(2),@last varchar(50);
 SELECT @last=RTRIM(LastNo) FROM dbo.EMRunBrch WITH(UPDLOCK,HOLDLOCK) WHERE RunCode='redemption' AND BrchID=1;
 SET @year=LEFT(@last,2);
 EXEC wf.sp_Native116AdvanceNumberCounter @year,1,@last;
END;
GO
