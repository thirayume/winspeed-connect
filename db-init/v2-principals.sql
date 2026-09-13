SET NOCOUNT ON;
IF DB_NAME() <> N'dbwins_worldfert9_test_v2'
BEGIN RAISERROR('V2 principals require isolated test database',16,1); RETURN; END;
IF DATABASE_PRINCIPAL_ID('wf_reader') IS NULL
BEGIN
 IF SUSER_ID('wf_reader') IS NOT NULL CREATE USER wf_reader FOR LOGIN wf_reader;
 ELSE CREATE USER wf_reader WITHOUT LOGIN;
END;
IF DATABASE_PRINCIPAL_ID('wf_owner') IS NULL
BEGIN
 IF SUSER_ID('wf_owner') IS NOT NULL CREATE USER wf_owner FOR LOGIN wf_owner;
 ELSE CREATE USER wf_owner WITHOUT LOGIN;
END;