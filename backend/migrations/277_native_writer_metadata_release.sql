-- @transaction
-- Fixed SELECT-only native metadata reader; SELF binds the verified migrator.
-- Runtime receives no VIEW DEFINITION, impersonation or additional dbo permission.
-- UAT principal setup remaps only this exact body after a Production restore.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('wf.usp_ReadNativeDocumentMetadata','P') IS NULL
 EXEC('CREATE PROCEDURE wf.usp_ReadNativeDocumentMetadata AS SELECT 1;');
GO
ALTER PROCEDURE wf.usp_ReadNativeDocumentMetadata
WITH EXECUTE AS SELF
AS
BEGIN
 SET NOCOUNT ON;
 SELECT OBJECT_NAME(t.parent_id) AS TableName,t.name,t.is_disabled,m.definition
 FROM sys.triggers t LEFT JOIN sys.sql_modules m ON m.object_id=t.object_id
 WHERE t.parent_id IN(OBJECT_ID('dbo.SOHD'),OBJECT_ID('dbo.SODT'),OBJECT_ID('dbo.SOHDRemark'),OBJECT_ID('dbo.SODTRemark'),OBJECT_ID('dbo.SOInvHD'),OBJECT_ID('dbo.SOInvDT'),OBJECT_ID('dbo.SMSat'),OBJECT_ID('dbo.SMReserveSat'),OBJECT_ID('dbo.ICStockDetail'),OBJECT_ID('dbo.ICCostDetail'),OBJECT_ID('dbo.WFRedemtionHD'),OBJECT_ID('dbo.WFRedemtionDT'),OBJECT_ID('dbo.WFCoupon'),OBJECT_ID('dbo.VTVAT'),OBJECT_ID('dbo.SMAudit'),OBJECT_ID('dbo.SMEvent'),OBJECT_ID('dbo.SMID'),OBJECT_ID('dbo.EMRunBrch'),OBJECT_ID('dbo.EMRunChar'),OBJECT_ID('dbo.Define_104'));
END;
GO
IF OBJECT_ID('wf.NativeWriterRelease','U') IS NULL
CREATE TABLE wf.NativeWriterRelease(
 ReleaseId uniqueidentifier NOT NULL CONSTRAINT PK_NativeWriterRelease PRIMARY KEY,
 ParentReleaseId uniqueidentifier NULL,
 Action varchar(10) NOT NULL CONSTRAINT CK_NativeWriterRelease_Action CHECK(Action IN('ENABLE','DISABLE')),
 ServerName nvarchar(128) NOT NULL,DatabaseName nvarchar(128) NOT NULL,
 PlanHash char(64) NOT NULL,ModulesHash char(64) NOT NULL,BaselineHooksJson nvarchar(max) NOT NULL,
 ApprovedById int NOT NULL,ActorId int NOT NULL,Reason nvarchar(500) NOT NULL,
 SqlLogin nvarchar(128) NOT NULL,CreatedAtUtc datetime NOT NULL CONSTRAINT DF_NativeWriterRelease_Created DEFAULT(GETUTCDATE())
);
GO
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.NativeWriterRelease TO public;
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.NativeWriterContract TO public;
GO

