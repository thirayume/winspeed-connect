-- QA-only extension of the existing rollback fixture, never shipped as a migration.
-- The caller must own an outer transaction; source booking is synthetic.
CREATE PROCEDURE wf.usp_QaNativeTicketTreatment @Treatment varchar(8),@SalesUserId int WITH EXECUTE AS OWNER AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF DB_NAME()<>'dbwins_worldfert9_uat_v3' OR @@TRANCOUNT=0 OR @Treatment NOT IN('ZERO','DISCOUNT')
  OR NOT EXISTS(SELECT 1 FROM wf.AppUser WHERE Id=@SalesUserId AND IsActive=1 AND Role='SALES')
 BEGIN RAISERROR('QA_TREATMENT_FIXTURE_ONLY',16,1);RETURN;END;
 DECLARE @rows TABLE(SOID int,DraftId int,UserId int,CustId int,SlipBase int,Today varchar(10));
 INSERT @rows EXEC wf.usp_QaNativeV3Fixture @FullDiscount=1;
 DECLARE @s int,@u int,@price decimal(18,4),@gross decimal(18,4),@discount decimal(18,4),@no varchar(30),@n int,@year char(2);
 SELECT @s=SOID,@u=UserId FROM @rows;
 SET @price=CASE WHEN @Treatment='ZERO' THEN 0 ELSE 10000 END;SET @gross=@price*0.05;SET @discount=@gross;
 SET @year=RIGHT(CONVERT(varchar(4),YEAR(DATEADD(hour,7,GETUTCDATE()))+543),2);
 SET @no='K'+@year+'-';
 SELECT @n=ISNULL(MAX(CONVERT(int,RIGHT(DocuNo,5))),0)+1 FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK)
 WHERE DocuType=103 AND LEN(DocuNo)=9 AND DocuNo LIKE @no+'[0-9][0-9][0-9][0-9][0-9]';
 IF @n>=100000 BEGIN RAISERROR('QA_BOOK_RANGE_EXHAUSTED',16,1);RETURN;END;
 SET @no=@no+RIGHT('00000'+CONVERT(varchar(5),@n),5);
 DELETE dbo.SODT WHERE SOID=@s AND ListNo=2;
 UPDATE dbo.SODT SET GoodQty2=0.05,RemaQty=0.05,GoodStockQty=0.05,GoodPrice2=@price,GoodAmnt=@gross,SumExcludeAmnt=@gross WHERE SOID=@s AND ListNo=1;
 UPDATE dbo.SOHD SET DocuNo=@no,SumGoodAmnt=@gross,SumExcludeAmnt=@gross,SumIncludeAmnt=0,
  BillDiscAmnt=@discount,BillDiscFormula=CONVERT(varchar(40),@discount),BillAftrDiscAmnt=0,NetAmnt=0,VatAmnt=0,VatRate=0,VatType='3',TotaBaseAmnt=0 WHERE SOID=@s;
 UPDATE wf.SalesOrderExt SET SalesUserId=@SalesUserId,SoPrefix='K',WfRef=@no WHERE SOID=CONVERT(varchar(50),@s);
 UPDATE wf.AppUser SET IsActive=0 WHERE Id=@u AND PasswordHash='!NO_LOGIN_ROLLBACK_FIXTURE!';
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('QA_ACCOUNT_RETIRE_FAILED',16,1);RETURN;END;
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId)
 VALUES('NATIVE_TREATMENT_QA_FIXTURE',CONVERT(varchar(20),@s),'CREATE','ISOLATED_QA',
  'Synthetic WinSpeed-shaped booking; original native triggers remain enabled',CONVERT(varchar(20),@SalesUserId),CONVERT(varchar(20),@SalesUserId));
 SELECT r.*,d.GoodID,h.DocuNo FROM @rows r JOIN dbo.SODT d ON d.SOID=r.SOID AND d.ListNo=1 JOIN dbo.SOHD h ON h.SOID=r.SOID;
END;
