-- @transaction
-- Operational allocators preserve the reviewed native ID block algorithms.
-- Old UAT-only procedures and guards are unchanged.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('wf.usp_AllocateNativeDocumentNo','P') IS NULL EXEC('CREATE PROCEDURE wf.usp_AllocateNativeDocumentNo AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_AllocateNativeDocumentNo
 @RunCode varchar(30),@Series varchar(2),@DocuDate datetime,@NewNo varchar(30) OUTPUT
AS
BEGIN
 SET NOCOUNT ON;SET @NewNo=NULL;
 IF @@TRANCOUNT=0 OR wf.fn_IsNativeDocumentTarget()<>1
 BEGIN RAISERROR('ND_TARGET_NOT_READY',16,1);RETURN;END;
 IF @DocuDate IS NULL OR NOT((@RunCode='119' AND @Series='AI') OR(@RunCode='104' AND @Series IN('I','K'))
  OR(@RunCode='creditsale_docuno' AND @Series IN('J','N')))
 BEGIN RAISERROR('ND_NUMBER_INPUT_INVALID',16,1);RETURN;END;
 DECLARE @Last varchar(50),@Fmt varchar(50),@BranchFmt varchar(50),@BranchLast varchar(50),@CharFmt varchar(50),@CharLast varchar(50),
  @CharCount int,@CharList int,@InBranch bit,@Start int,@Prefix varchar(5),@Max int,@Next int;
 SET @Start=LEN(@Series)+4;SET @Prefix=@Series+RIGHT(CONVERT(varchar(4),YEAR(@DocuDate)+543),2)+'-';
 SELECT @BranchFmt=RTRIM(RunFormat),@BranchLast=RTRIM(LastNo) FROM dbo.EMRunBrch WITH(UPDLOCK,HOLDLOCK) WHERE RunCode=@RunCode AND BrchID=1;
 IF @RunCode='119'
 BEGIN SET @InBranch=1;SET @Fmt=@BranchFmt;SET @Last=@BranchLast;END;
 ELSE
 BEGIN
  SELECT @CharCount=COUNT(*),@CharFmt=MAX(RTRIM(Prefix)),@CharLast=MAX(RTRIM(Lastno)),@CharList=MAX(ListNo)
   FROM dbo.EMRunChar WITH(UPDLOCK,HOLDLOCK) WHERE RunCode=@RunCode AND BrchID=1 AND LEFT(Prefix,1)=@Series;
  IF @CharCount<>1 OR @CharFmt<>@Series+'yy-00000' OR @CharList<>CASE WHEN @Series IN('I','J') THEN 1 ELSE 2 END
  BEGIN RAISERROR('ND_COUNTER_UNSUPPORTED',16,1);RETURN;END;
  SET @InBranch=CASE WHEN LEFT(@BranchFmt,1)=@Series THEN 1 ELSE 0 END;
  SET @Fmt=CASE WHEN @InBranch=1 THEN @BranchFmt ELSE @CharFmt END;
  SET @Last=CASE WHEN @InBranch=1 THEN @BranchLast ELSE @CharLast END;
 END;
 IF @BranchFmt IS NULL OR @Fmt<>@Series+'yy-00000' OR @Last IS NULL OR LEN(@Last)<>LEN(@Series)+8
  OR LEFT(@Last,LEN(@Series))<>@Series OR SUBSTRING(@Last,LEN(@Series)+1,2) NOT LIKE '[0-9][0-9]'
  OR SUBSTRING(@Last,@Start,5) NOT LIKE '[0-9][0-9][0-9][0-9][0-9]'
  OR SUBSTRING(@Last,LEN(@Series)+1,2)>RIGHT(CONVERT(varchar(4),YEAR(@DocuDate)+543),2)
 BEGIN RAISERROR('ND_COUNTER_UNSUPPORTED',16,1);RETURN;END;
 SET @Max=0;
 IF @RunCode='119'
  SELECT @Max=ISNULL(MAX(CONVERT(int,SUBSTRING(AppvDocuNo,@Start,5))),0) FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK)
   WHERE LEN(AppvDocuNo)=LEN(@Series)+8 AND AppvDocuNo LIKE @Prefix+'[0-9][0-9][0-9][0-9][0-9]';
 ELSE IF @RunCode='104'
  SELECT @Max=ISNULL(MAX(CONVERT(int,SUBSTRING(DocuNo,@Start,5))),0) FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK)
   WHERE BrchID=1 AND DocuType=104 AND LEN(DocuNo)=LEN(@Series)+8 AND DocuNo LIKE @Prefix+'[0-9][0-9][0-9][0-9][0-9]';
 ELSE
  SELECT @Max=ISNULL(MAX(CONVERT(int,SUBSTRING(DocuNo,@Start,5))),0) FROM dbo.SOInvHD WITH(UPDLOCK,HOLDLOCK)
   WHERE BrchID=1 AND DocuType=107 AND LEN(DocuNo)=LEN(@Series)+8 AND DocuNo LIKE @Prefix+'[0-9][0-9][0-9][0-9][0-9]';
 SET @Next=CASE WHEN LEFT(@Last,LEN(@Prefix))=@Prefix THEN CONVERT(int,SUBSTRING(@Last,@Start,5)) ELSE 0 END;
 IF @Max>@Next SET @Next=@Max;SET @Next=@Next+1;
 IF @Next>99999 BEGIN RAISERROR('ND_NUMBER_EXHAUSTED',16,1);RETURN;END;
 SET @NewNo=@Prefix+RIGHT('00000'+CONVERT(varchar(5),@Next),5);
 IF @InBranch=1 UPDATE dbo.EMRunBrch SET LastNo=@NewNo WHERE RunCode=@RunCode AND BrchID=1 AND LastNo=@Last AND RunFormat=@Fmt;
 ELSE UPDATE dbo.EMRunChar SET Lastno=@NewNo WHERE RunCode=@RunCode AND BrchID=1 AND ListNo=@CharList AND Lastno=@Last AND Prefix=@Fmt;
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('ND_COUNTER_CHANGED',16,1);RETURN;END;
END;
GO
IF OBJECT_ID('wf.usp_AllocateNativeDocumentEventId','P') IS NULL
 EXEC('CREATE PROCEDURE wf.usp_AllocateNativeDocumentEventId AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_AllocateNativeDocumentEventId @NewId INT OUTPUT
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 OR wf.fn_IsNativeDocumentTarget()<>1 BEGIN RAISERROR('ND_TARGET_NOT_READY',16,1); RETURN; END;
 DECLARE @Prefix INT,@MaxData INT,@MaxBook INT,@Next INT,@Guard INT;
 SET @Guard=0;
 SELECT @Prefix=MAX(Prefix) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK)
 WHERE Name='wssale-app/backend/smevent' AND Type=1;
 WHILE @Guard<20
 BEGIN
  SET @Guard=@Guard+1;
  IF @Prefix IS NULL
  BEGIN
   SELECT @MaxBook=ISNULL(MAX(Prefix),0) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK)
    WHERE Type=1 AND CHARINDEX('smevent',LOWER(Name))>0;
   SELECT @MaxData=ISNULL(MAX(eventid),0) FROM dbo.SMEvent WITH(UPDLOCK,HOLDLOCK);
   IF @MaxData/1000*1000>@MaxBook SET @MaxBook=@MaxData/1000*1000;
   IF @MaxBook>2147481000 BEGIN RAISERROR('DO_ID_EXHAUSTED',16,1); RETURN; END;
   SET @Prefix=@MaxBook+1000;
   INSERT INTO dbo.SMID(Name,Prefix,Type) VALUES('wssale-app/backend/smevent',@Prefix,1);
  END;
  IF @Prefix%1000<>0 OR @Prefix>2147482000 OR EXISTS(
   SELECT 1 FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=1
    AND CHARINDEX('smevent',LOWER(Name))>0 AND Prefix=@Prefix AND Name<>'wssale-app/backend/smevent')
  BEGIN RAISERROR('DO_ID_CONFLICT',16,1); RETURN; END;
  SELECT @Next=ISNULL(MAX(eventid)+1,@Prefix) FROM dbo.SMEvent WITH(UPDLOCK,HOLDLOCK)
   WHERE eventid>=@Prefix AND eventid<@Prefix+1000;
  IF @Next<@Prefix+1000 BEGIN SET @NewId=@Next; RETURN; END;
  SET @Prefix=NULL;
 END;
 RAISERROR('DO_ID_EXHAUSTED',16,1);
END
GO
IF OBJECT_ID('wf.usp_AllocateNativeRedemptionId','P') IS NULL EXEC('CREATE PROCEDURE wf.usp_AllocateNativeRedemptionId AS RETURN 0');
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
IF OBJECT_ID('wf.usp_AllocateNativeDocumentSAT','P') IS NULL EXEC('CREATE PROCEDURE wf.usp_AllocateNativeDocumentSAT AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_AllocateNativeDocumentSAT @GlobalFlag INT,@Username NVARCHAR(100),@NewId INT OUTPUT
AS
BEGIN
 SET NOCOUNT ON; SET @NewId=NULL;
 IF @@TRANCOUNT=0 OR wf.fn_IsNativeDocumentTarget()<>1 BEGIN RAISERROR('ND_TARGET_NOT_READY',16,1); RETURN; END;
 IF @GlobalFlag IS NULL OR @GlobalFlag NOT IN(202,107) OR @Username IS NULL BEGIN RAISERROR('ND_SAT_INPUT_INVALID',16,1);RETURN;END;
 DECLARE @P INT,@M INT,@D INT,@N INT,@Other INT,@G INT; SET @G=0;
 SELECT @P=MAX(Prefix) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=2 AND Name='wssale-app/backend/SAT';
 WHILE @G<20 BEGIN
  SET @G=@G+1;
  IF @P IS NULL BEGIN
   SELECT @M=ISNULL(MAX(Prefix),0) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=2 AND CHARINDEX('sat',LOWER(Name))>0;
   SELECT @D=ISNULL(MAX(GlobalID),0) FROM dbo.SMReserveSat WITH(UPDLOCK,HOLDLOCK);
   SELECT @Other=ISNULL(MAX(GlobalID),0) FROM dbo.SMSat WITH(UPDLOCK,HOLDLOCK);
   IF @Other>@D SET @D=@Other; IF @D/100000*100000>@M SET @M=@D/100000*100000;
   IF @M>=2147300000 BEGIN RAISERROR('IP_ID_EXHAUSTED',16,1); RETURN; END;
   SET @P=@M+100000; INSERT INTO dbo.SMID(Name,Prefix,Type) VALUES('wssale-app/backend/SAT',@P,2);
  END;
  IF @P%100000<>0 OR @P>2147300000 OR EXISTS(SELECT 1 FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK)
   WHERE Type=2 AND Prefix=@P AND CHARINDEX('sat',LOWER(Name))>0 AND Name<>'wssale-app/backend/SAT')
  BEGIN RAISERROR('IP_ID_CONFLICT',16,1); RETURN; END;
  SELECT @N=ISNULL(MAX(GlobalID)+1,@P) FROM dbo.SMReserveSat WITH(UPDLOCK,HOLDLOCK) WHERE GlobalID>=@P AND GlobalID<@P+100000;
  IF @N<@P+100000 BEGIN
   IF EXISTS(SELECT 1 FROM dbo.SMSat WITH(UPDLOCK,HOLDLOCK) WHERE GlobalID=@N) BEGIN RAISERROR('IP_ID_CONFLICT',16,1); RETURN; END;
   INSERT INTO dbo.SMReserveSat(GlobalID,GlobalFlag,DocuDate,UserName) VALUES(@N,@GlobalFlag,GETDATE(),LEFT(N'wf:'+@Username,255));
   SET @NewId=@N; RETURN;
  END; SET @P=NULL;
 END;
 RAISERROR('IP_ID_EXHAUSTED',16,1);
END
GO

IF OBJECT_ID('wf.usp_AllocateNativeDocumentVAT','P') IS NULL EXEC('CREATE PROCEDURE wf.usp_AllocateNativeDocumentVAT AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_AllocateNativeDocumentVAT @NewId INT OUTPUT
AS
BEGIN
 SET NOCOUNT ON; SET @NewId=NULL;
 IF @@TRANCOUNT=0 OR wf.fn_IsNativeDocumentTarget()<>1 BEGIN RAISERROR('ND_TARGET_NOT_READY',16,1); RETURN; END;
 DECLARE @P INT,@M INT,@D INT,@N INT,@G INT; SET @G=0;
 SELECT @P=MAX(Prefix) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=1 AND Name='wssale-app/backend/vtvat';
 WHILE @G<20 BEGIN
  SET @G=@G+1;
  IF @P IS NULL BEGIN
   SELECT @M=ISNULL(MAX(Prefix),0) FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK) WHERE Type=1 AND CHARINDEX('vtvat',LOWER(Name))>0;
   SELECT @D=ISNULL(MAX(VATID),0) FROM dbo.VTVAT WITH(UPDLOCK,HOLDLOCK);
   IF @D/1000*1000>@M SET @M=@D/1000*1000;
   IF @M>2147481000 BEGIN RAISERROR('DO_ID_EXHAUSTED',16,1); RETURN; END;
   SET @P=@M+1000; INSERT INTO dbo.SMID(Name,Prefix,Type) VALUES('wssale-app/backend/vtvat',@P,1);
  END;
  IF @P%1000<>0 OR @P>2147482000 OR EXISTS(SELECT 1 FROM dbo.SMID WITH(UPDLOCK,HOLDLOCK)
   WHERE Type=1 AND Prefix=@P AND CHARINDEX('vtvat',LOWER(Name))>0 AND Name<>'wssale-app/backend/vtvat')
  BEGIN RAISERROR('DO_ID_CONFLICT',16,1); RETURN; END;
  SELECT @N=ISNULL(MAX(VATID)+1,@P) FROM dbo.VTVAT WITH(UPDLOCK,HOLDLOCK) WHERE VATID>=@P AND VATID<@P+1000;
  IF @N<@P+1000 BEGIN SET @NewId=@N; RETURN; END; SET @P=NULL;
 END;
 RAISERROR('DO_ID_EXHAUSTED',16,1);
END
GO
