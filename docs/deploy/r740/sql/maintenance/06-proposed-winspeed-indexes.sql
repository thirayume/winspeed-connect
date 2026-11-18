-- PROPOSAL — DO NOT RUN until the owner approves indexes on WinSpeed (dbo) tables (step 3 of the 18 Nov 2026 plan).
--
-- These add non-clustered indexes only: no column, key, trigger or procedure of WinSpeed changes, WinSpeed screens
-- keep working, and 07-drop-proposed-winspeed-indexes.sql removes them. Every name starts with IX_wf_ so they are
-- recognisable. They cover lookups Sale-App makes on every list and dashboard that today scan whole tables:
--   SOHD by document type and date      (lists, dashboard, aging; 133,723 rows)
--   SOHD by reference number            (booking → sales order link)
--   WFCoupon by sales order (DocuID)    (tickets of an order; no index at all today)
--   WFRedemtionDT by ticket (CouponID)  (ticket cuts; no index at all today)
-- Build time on this server: seconds each. Run in SSMS as a SQL Server administrator, at a quiet time.
USE [dbwins_worldfert9];   -- repeat for dbwins_worldfert2 if it is used the same way
SET NOCOUNT ON;
IF IS_SRVROLEMEMBER(N'sysadmin') <> 1 BEGIN RAISERROR(N'STOP: run as a SQL Server administrator.', 16, 1); RETURN; END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.SOHD') AND name = N'IX_wf_SOHD_DocuType_DocuDate')
    CREATE NONCLUSTERED INDEX IX_wf_SOHD_DocuType_DocuDate ON dbo.SOHD (DocuType, DocuDate)
        INCLUDE (SOID, DocuNo, DocuStatus, CustID, EmpID, BrchID, RefNo, AppvDocuNo, AppvFlag, clearflag, PkgStatus, TransRegistration);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.SOHD') AND name = N'IX_wf_SOHD_RefNo')
    CREATE NONCLUSTERED INDEX IX_wf_SOHD_RefNo ON dbo.SOHD (RefNo, DocuType) INCLUDE (SOID, CustID, BrchID, DocuStatus, DocuDate, DocuNo);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.WFCoupon') AND name = N'IX_wf_WFCoupon_DocuID')
    CREATE NONCLUSTERED INDEX IX_wf_WFCoupon_DocuID ON dbo.WFCoupon (DocuID, Docutype) INCLUDE (CouponID, GoodID, GoodQty, RemaQty);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.WFRedemtionDT') AND name = N'IX_wf_WFRedemtionDT_CouponID')
    CREATE NONCLUSTERED INDEX IX_wf_WFRedemtionDT_CouponID ON dbo.WFRedemtionDT (CouponID) INCLUDE (RedemtionID, GoodQty, PostInv, SOInvID, SOListNo);

SELECT OBJECT_NAME(object_id) AS T, name FROM sys.indexes WHERE name LIKE N'IX[_]wf[_]%' ORDER BY 1, 2;
