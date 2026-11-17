-- SQL Server 2008 R2. Procedures enable the runtime wf principal to mutate
-- customer groups through ownership chaining, without granting dbo write access.
-- The application wraps each call and its ChangeEvent audit in one transaction.
IF OBJECT_ID('wf.sp_CustomerGroupCreate', 'P') IS NULL
  EXEC('CREATE PROCEDURE wf.sp_CustomerGroupCreate AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_CustomerGroupCreate
 @Code VARCHAR(20), @Name VARCHAR(100), @NameEng VARCHAR(100), @Remark VARCHAR(255),
 @NewId INT OUTPUT, @NewCode VARCHAR(20) OUTPUT
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 BEGIN RAISERROR('Transaction required',16,1); RETURN; END;
 IF @Name IS NULL OR LEN(LTRIM(RTRIM(@Name)))=0 BEGIN RAISERROR('Name required',16,1); RETURN; END;
 SELECT @NewId=ISNULL(MAX(CustGroupID),2000)+1 FROM dbo.EMCustGroup WITH (UPDLOCK,HOLDLOCK);
 SET @NewCode=CASE WHEN NULLIF(LTRIM(RTRIM(@Code)),'') IS NOT NULL THEN LTRIM(RTRIM(@Code))
   ELSE RIGHT('000'+CONVERT(VARCHAR(10),@NewId % 1000),3) END;
 INSERT dbo.EMCustGroup (CustGroupID,CustGroupCode,CustGroupName,CustGroupNameEng,Remark)
 VALUES (@NewId,@NewCode,@Name,ISNULL(@NameEng,''),@Remark);
END
GO
IF OBJECT_ID('wf.sp_CustomerGroupUpdate', 'P') IS NULL
  EXEC('CREATE PROCEDURE wf.sp_CustomerGroupUpdate AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_CustomerGroupUpdate
 @Id INT, @Name VARCHAR(100), @NameEng VARCHAR(100), @Remark VARCHAR(255), @Affected INT OUTPUT
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 BEGIN RAISERROR('Transaction required',16,1); RETURN; END;
 IF @Name IS NULL OR LEN(LTRIM(RTRIM(@Name)))=0 BEGIN RAISERROR('Name required',16,1); RETURN; END;
 UPDATE dbo.EMCustGroup SET CustGroupName=@Name, CustGroupNameEng=COALESCE(@NameEng,CustGroupNameEng),
   Remark=@Remark WHERE CustGroupID=@Id;
 SET @Affected=@@ROWCOUNT;
END
GO
IF OBJECT_ID('wf.sp_CustomerGroupDelete', 'P') IS NULL
  EXEC('CREATE PROCEDURE wf.sp_CustomerGroupDelete AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_CustomerGroupDelete @Id INT, @Affected INT OUTPUT, @Blocked INT OUTPUT
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 BEGIN RAISERROR('Transaction required',16,1); RETURN; END;
 SET @Affected=0;
 -- Match WinSpeed's delete trigger, including inactive customers and native references.
 SELECT @Blocked=(SELECT COUNT(*) FROM dbo.EMCust WITH (UPDLOCK,HOLDLOCK) WHERE CustGroupID=@Id)
   +(SELECT COUNT(*) FROM dbo.EMSetPriceHD WITH (UPDLOCK,HOLDLOCK) WHERE CustGroupID=@Id)
   +(SELECT COUNT(*) FROM dbo.EMEmpApprovCreditCustGroup WITH (UPDLOCK,HOLDLOCK) WHERE CustGroupID=@Id);
 IF @Blocked>0 RETURN;
 DELETE dbo.EMCustGroup WHERE CustGroupID=@Id;
 SET @Affected=@@ROWCOUNT;
END
GO
