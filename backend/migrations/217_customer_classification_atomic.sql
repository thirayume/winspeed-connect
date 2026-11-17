-- SQL Server 2008 R2. Called only inside the application's business transaction.
-- Ownership chaining permits the least-privilege wf principal to update native
-- classifications without granting direct UPDATE on dbo.EMCust.
IF OBJECT_ID('wf.sp_MasterCustomerClassification', 'P') IS NULL
  EXEC('CREATE PROCEDURE wf.sp_MasterCustomerClassification AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_MasterCustomerClassification
 @CustID VARCHAR(20), @HasArea BIT, @AreaId INT, @HasGroup BIT, @GroupId INT,
 @HasBillEmp BIT, @BillEmp INT, @HasInactive BIT, @Inactive BIT, @Affected INT OUTPUT
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 BEGIN RAISERROR('Transaction required',16,1); RETURN; END;
 SELECT @Affected=COUNT(*) FROM dbo.EMCust WITH (UPDLOCK,HOLDLOCK) WHERE CustID=@CustID;
 IF @Affected<>1 RETURN;
 -- Do not mention unchanged columns in UPDATE: WinSpeed's UPDATE(column)
 -- triggers treat an unchanged column in SET as an intentional change.
 IF @HasArea=1 UPDATE dbo.EMCust SET SaleAreaID=@AreaId WHERE CustID=@CustID;
 IF @HasGroup=1 UPDATE dbo.EMCust SET CustGroupID=@GroupId WHERE CustID=@CustID;
 IF @HasBillEmp=1 UPDATE dbo.EMCust SET BillEmp=@BillEmp WHERE CustID=@CustID;
 IF @HasInactive=1 UPDATE dbo.EMCust SET Inactive=CASE WHEN @Inactive=1 THEN 'I' ELSE 'A' END,
   InactiveDate=CASE WHEN @Inactive=1 THEN GETDATE() ELSE NULL END WHERE CustID=@CustID;
END
GO
