-- The reserved ADMIN role gets the new permission; all other roles require an
-- explicit assignment in Role Management. No balance or evidence is changed.
IF NOT EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code='ADMIN')
  RAISERROR('Reserved ADMIN role is required before adding evidence permission',16,1);
ELSE IF NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode='ADMIN' AND PermissionCode='rebate.evidence.verify')
  INSERT INTO wf.RolePermission(RoleCode,PermissionCode) VALUES('ADMIN','rebate.evidence.verify');
GO
