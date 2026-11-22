-- @transaction
-- Versioned operational writer metadata. No native rows or dbo schema change.
-- Contract remains disabled until its exact native metadata has been reviewed.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ARITHABORT ON;
SET ANSI_WARNINGS ON;
SET ANSI_PADDING ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO
IF OBJECT_ID('wf.NativeWriterContract','U') IS NULL
CREATE TABLE wf.NativeWriterContract(
 ServerName nvarchar(128) NOT NULL,DatabaseName nvarchar(128) NOT NULL,
 PolicyVersion varchar(40) NOT NULL,MetadataHash varchar(64) NOT NULL,
 IsEnabled bit NOT NULL CONSTRAINT DF_NativeWriterContract_Enabled DEFAULT(0),
 ApprovedById int NULL,ApprovedActorId int NULL,ApprovedAtUtc datetime NULL,Evidence nvarchar(1000) NULL,
 CONSTRAINT PK_NativeWriterContract PRIMARY KEY(ServerName,DatabaseName,PolicyVersion),
 CONSTRAINT CK_NativeWriterContract_Approval CHECK(IsEnabled=0 OR
  (ApprovedById IS NOT NULL AND ApprovedActorId IS NOT NULL AND ApprovedAtUtc IS NOT NULL AND LEN(MetadataHash)=64 AND Evidence IS NOT NULL AND LEN(Evidence)>=20))
);
GO
IF OBJECT_ID('wf.NativeDocumentRequest','U') IS NULL
CREATE TABLE wf.NativeDocumentRequest(
 RequestId varchar(36) NOT NULL CONSTRAINT PK_NativeDocumentRequest PRIMARY KEY,
 PolicyVersion varchar(40) NOT NULL,DocuType int NOT NULL,OperationKey varchar(128) NOT NULL,
 SourceId int NOT NULL,SourceKind varchar(20) NOT NULL,SourceHash varchar(64) NOT NULL,InputHash varchar(64) NOT NULL,
 PlanXml xml NOT NULL,InputJson nvarchar(max) NOT NULL,
 UserId int NOT NULL,ActorUserId int NOT NULL,PrimaryUserId int NOT NULL,PrimaryActorId int NOT NULL,
 Status varchar(12) NOT NULL,Revision int NOT NULL CONSTRAINT DF_NativeDocumentRequest_Revision DEFAULT(1),
 Reason nvarchar(500) NOT NULL,CreatedAtUtc datetime NOT NULL CONSTRAINT DF_NativeDocumentRequest_Created DEFAULT(GETUTCDATE()),
 ExpiresAtUtc datetime NOT NULL,ApprovedById int NULL,ApproverActorId int NULL,ApprovedAtUtc datetime NULL,
 ApproverPrimaryId int NULL,ApproverActorPrimaryId int NULL,
 CONSTRAINT CK_NativeDocumentRequest_Type CHECK(DocuType IN(119,104,116,107)),
 CONSTRAINT CK_NativeDocumentRequest_Status CHECK(Status IN('PENDING','APPROVED','CONSUMED','CANCELLED','REJECTED')),
 CONSTRAINT CK_NativeDocumentRequest_Revision CHECK(Revision>0)
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.NativeDocumentRequest') AND name='IX_NativeDocumentRequest_Source')
 CREATE INDEX IX_NativeDocumentRequest_Source ON wf.NativeDocumentRequest(DocuType,SourceId,CreatedAtUtc);
GO
IF OBJECT_ID('wf.NativeDocumentReceipt','U') IS NULL
CREATE TABLE wf.NativeDocumentReceipt(
 RequestId varchar(36) NOT NULL CONSTRAINT PK_NativeDocumentReceipt PRIMARY KEY
  CONSTRAINT FK_NativeDocumentReceipt_Request REFERENCES wf.NativeDocumentRequest(RequestId),
 PolicyVersion varchar(40) NOT NULL,DocuType int NOT NULL,OperationKey varchar(128) NOT NULL,
 SourceId int NOT NULL,SourceKind varchar(20) NOT NULL,NativeId int NOT NULL,NativeNo varchar(30) NOT NULL,FinanceId int NULL,
 UserId int NOT NULL,ActorUserId int NOT NULL,PrimaryUserId int NOT NULL,PrimaryActorId int NOT NULL,
 SourceBeforeHash varchar(64) NOT NULL,NativeAfterHash varchar(64) NULL,
 CreatedAtUtc datetime NOT NULL CONSTRAINT DF_NativeDocumentReceipt_Created DEFAULT(GETUTCDATE()),
 CONSTRAINT UQ_NativeDocumentReceipt_Operation UNIQUE(DocuType,OperationKey),
 CONSTRAINT UQ_NativeDocumentReceipt_Document UNIQUE(DocuType,NativeId)
);
GO
IF OBJECT_ID('wf.NativeDocumentReceiptLine','U') IS NULL
CREATE TABLE wf.NativeDocumentReceiptLine(
 RequestId varchar(36) NOT NULL CONSTRAINT FK_NativeDocumentReceiptLine_Receipt REFERENCES wf.NativeDocumentReceipt(RequestId),
 NativeLineNo int NOT NULL,DocuType int NOT NULL,SourceId int NOT NULL,SourceLineNo int NOT NULL,
 CouponId int NULL,CouponNo varchar(25) NULL,Quantity decimal(18,4) NOT NULL,
 GrossAmount decimal(18,4) NOT NULL,DiscountAmount decimal(18,4) NOT NULL,TaxBase decimal(18,4) NOT NULL,
 CONSTRAINT PK_NativeDocumentReceiptLine PRIMARY KEY(RequestId,NativeLineNo),
 CONSTRAINT CK_NativeDocumentReceiptLine_Amount CHECK(Quantity>0 AND GrossAmount>=0 AND DiscountAmount>=0 AND DiscountAmount<=GrossAmount AND TaxBase=GrossAmount-DiscountAmount)
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.NativeDocumentReceiptLine') AND name='UQ_NativeDocumentReceiptLine_Booking')
 CREATE UNIQUE INDEX UQ_NativeDocumentReceiptLine_Booking ON wf.NativeDocumentReceiptLine(SourceId,SourceLineNo) WHERE DocuType=104;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.NativeDocumentReceiptLine') AND name='UQ_NativeDocumentReceiptLine_Cut')
 CREATE UNIQUE INDEX UQ_NativeDocumentReceiptLine_Cut ON wf.NativeDocumentReceiptLine(SourceId,SourceLineNo) WHERE DocuType=107;
GO
IF OBJECT_ID('wf.fn_IsNativeDocumentTarget','FN') IS NULL
 EXEC('CREATE FUNCTION wf.fn_IsNativeDocumentTarget() RETURNS bit AS BEGIN RETURN 0; END');
GO
ALTER FUNCTION wf.fn_IsNativeDocumentTarget() RETURNS bit AS
BEGIN
 DECLARE @ok bit;SET @ok=0;
 IF CONVERT(nvarchar(128),SERVERPROPERTY('ServerName'))<>N'R740-SRV\SQL2008' RETURN 0;
 IF DB_NAME() NOT IN(N'dbwins_worldfert9',N'dbwins_worldfert9_uat',N'dbwins_worldfert9_uat_v3') RETURN 0;
 IF EXISTS(SELECT 1 FROM wf.NativeWriterContract WHERE ServerName=CONVERT(nvarchar(128),SERVERPROPERTY('ServerName'))
  AND DatabaseName=DB_NAME() AND PolicyVersion='NATIVE-DOCUMENTS-v3' AND IsEnabled=1
  AND MetadataHash='1bdd47a6ee4e84662ed0b1979d32a628ac720fd6745e5839a0afb4b1987f6c8a') SET @ok=1;
 RETURN @ok;
END;
GO
