-- Down migration 244: Restore REBATE_CONVERTER role profile
IF OBJECT_ID('wf.RoleProfile', 'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'REBATE_CONVERTER')
  BEGIN
    INSERT INTO wf.RoleProfile (Code, Name, BaseRole, DisabledActions, UpdatedBy)
    VALUES ('REBATE_CONVERTER', N'ผู้มีสิทธิ์แปลงตั๋วปุ๋ย Rebate Pool (1 พ.ย.)', 'ACCOUNTING', N'[]', 0);
  END;
END;
GO

IF OBJECT_ID('wf.RolePermission', 'U') IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'REBATE_CONVERTER')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'REBATE_CONVERTER' AND PermissionCode = 'rebate.convert')
  BEGIN
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('REBATE_CONVERTER', 'rebate.convert');
  END;
END;
GO
