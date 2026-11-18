-- Removes the indexes of 06-proposed-winspeed-indexes.sql (only those named IX_wf_...). WinSpeed objects stay.
USE [dbwins_worldfert9];
SET NOCOUNT ON;
IF IS_SRVROLEMEMBER(N'sysadmin') <> 1 BEGIN RAISERROR(N'STOP: run as a SQL Server administrator.', 16, 1); RETURN; END;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.SOHD') AND name = N'IX_wf_SOHD_DocuType_DocuDate') DROP INDEX IX_wf_SOHD_DocuType_DocuDate ON dbo.SOHD;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.SOHD') AND name = N'IX_wf_SOHD_RefNo') DROP INDEX IX_wf_SOHD_RefNo ON dbo.SOHD;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.WFCoupon') AND name = N'IX_wf_WFCoupon_DocuID') DROP INDEX IX_wf_WFCoupon_DocuID ON dbo.WFCoupon;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.WFRedemtionDT') AND name = N'IX_wf_WFRedemtionDT_CouponID') DROP INDEX IX_wf_WFRedemtionDT_CouponID ON dbo.WFRedemtionDT;
