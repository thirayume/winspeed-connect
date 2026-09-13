SET NOCOUNT ON;
IF DB_NAME() NOT IN (N'dbwins_worldfert9',N'dbwins_worldfert9_test_v2')
BEGIN RAISERROR('Unexpected active restore target',16,1); RETURN; END;
SELECT DB_NAME() DatabaseName,
 (SELECT COUNT(*) FROM wf.SchemaMigration) AppliedMigrations,
 (SELECT COUNT(*) FROM dbo.SOHD) SOHD,
 (SELECT COUNT(*) FROM dbo.WGHD) WGHD,
 (SELECT COUNT(*) FROM dbo.WGDT) WGDT,
 (SELECT COUNT(*) FROM dbo.WGDTReport) WGDTReport,
 (SELECT COUNT(*) FROM wf.AppUser WHERE Username='admin' AND Role='ADMIN' AND IsActive=1) ActiveAdmin;