-- Migration 244: Deprecate redundant non-standard Thai role REBATE_CONVERTER
-- Reassign any assigned users to ACCOUNTING (BaseRole) and remove REBATE_CONVERTER profile & permissions.
-- Accounting and Admin natively hold rebate.convert capability.

IF OBJECT_ID('wf.RolePermission', 'U') IS NOT NULL
BEGIN
  DELETE FROM wf.RolePermission WHERE RoleCode = 'REBATE_CONVERTER';
END;
GO

IF OBJECT_ID('wf.AppUserRole', 'U') IS NOT NULL
BEGIN
  -- Reassign any users who had REBATE_CONVERTER to ACCOUNTING if not already assigned
  INSERT INTO wf.AppUserRole (AppUserId, RoleCode)
  SELECT DISTINCT aur.AppUserId, 'ACCOUNTING'
  FROM wf.AppUserRole aur
  WHERE aur.RoleCode = 'REBATE_CONVERTER'
    AND NOT EXISTS (
      SELECT 1 FROM wf.AppUserRole aur2
      WHERE aur2.AppUserId = aur.AppUserId AND aur2.RoleCode = 'ACCOUNTING'
    );

  DELETE FROM wf.AppUserRole WHERE RoleCode = 'REBATE_CONVERTER';
END;
GO

IF OBJECT_ID('wf.AppUser', 'U') IS NOT NULL
BEGIN
  -- If any user had PrimaryRole = 'REBATE_CONVERTER', reassign to ACCOUNTING
  UPDATE wf.AppUser
  SET Role = 'ACCOUNTING'
  WHERE Role = 'REBATE_CONVERTER';
END;
GO

IF OBJECT_ID('wf.RoleProfile', 'U') IS NOT NULL
BEGIN
  DELETE FROM wf.RoleProfile WHERE Code = 'REBATE_CONVERTER';
END;
GO
