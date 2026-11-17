-- Migration 212 cannot be automatically reversed safely. Its conditional
-- inserts did not record whether the permissions already existed or were
-- subsequently changed. A backup and a reviewed pre-migration snapshot are
-- required to identify any grants that can be removed without revoking an
-- administrator's independent changes. Never delete grants from this script.
IF EXISTS (SELECT 1 FROM wf.RolePermission WHERE
  (RoleCode='SALES' AND PermissionCode='rebate.conversion.request') OR
  (RoleCode IN ('MANAGER','C_LEVEL') AND PermissionCode='rebate.conversion.approve'))
BEGIN
  RAISERROR('Migration 212 permission provenance is unknown; review before any manual reversal.',16,1);
  RETURN;
END;
PRINT 'No migration 212 grants remain; no permissions changed.';
