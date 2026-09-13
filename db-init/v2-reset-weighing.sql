-- Explicit owner-authorized reset of restored test weighing only; never production.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
IF DB_NAME() <> N'dbwins_worldfert9_test_v2'
BEGIN RAISERROR('V2 reset requires dbwins_worldfert9_test_v2',16,1); RETURN; END;
BEGIN TRANSACTION;
DELETE FROM dbo.WGDTReport;
DELETE FROM dbo.WGDT;
DELETE FROM dbo.WGHD;
COMMIT;
SELECT (SELECT COUNT_BIG(*) FROM dbo.WGHD) WGHD,
       (SELECT COUNT_BIG(*) FROM dbo.WGDT) WGDT,
       (SELECT COUNT_BIG(*) FROM dbo.WGDTReport) WGDTReport;
