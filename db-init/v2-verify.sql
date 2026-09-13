SET NOCOUNT ON;
SELECT DB_NAME() AS DatabaseName, compatibility_level FROM sys.databases WHERE name=DB_NAME();
IF DB_NAME() <> N'dbwins_worldfert9_test_v2' BEGIN RAISERROR('Wrong v2 test database',16,1); RETURN; END;
SELECT (SELECT COUNT(*) FROM dbo.WGHD) WGHD,(SELECT COUNT(*) FROM dbo.WGDT) WGDT,(SELECT COUNT(*) FROM dbo.WGDTReport) WGDTReport;
SELECT COUNT(*) AppliedMigrations FROM wf.SchemaMigration;
SELECT RunId,Scenario,WGHDId,SourceSOID,SourceListNo FROM wf.TestFixtureRun ORDER BY WGHDId;