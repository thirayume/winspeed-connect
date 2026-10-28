-- @transaction
-- Owner correction, 28 October 2026: R740 UAT is the underscore-named clone,
-- restored from dbwins_worldfert9_20261027_210002.BAK and verified as DB ID 10.
-- Preserve migration 158 and every procedure business body. Retire the former
-- R740 hyphenated target; neither live company database is allowed here.
IF OBJECT_ID('wf.fn_IsInitialNativeUatTarget','FN') IS NULL
 RAISERROR('NATIVE_UAT_TARGET_PREREQUISITE_REQUIRED',16,1);
GO
ALTER FUNCTION wf.fn_IsInitialNativeUatTarget() RETURNS BIT
AS
BEGIN
 RETURN CASE
  WHEN CONVERT(NVARCHAR(128),SERVERPROPERTY('ServerName'))=N'AMYOU-YOGA7\V2008R2'
   AND DB_NAME()=N'dbwins_worldfert9_uat2' AND DB_ID()=10 THEN 1
  WHEN CONVERT(NVARCHAR(128),SERVERPROPERTY('ServerName'))=N'R740-SRV\SQL2008'
   AND DB_NAME()=N'dbwins_worldfert9_uat' AND DB_ID()=10 THEN 1
  ELSE 0 END;
END;
GO
