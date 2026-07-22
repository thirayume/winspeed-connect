-- E2E Test Data Seed
-- Creates test users for all roles with password W0rldF3rt

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
SET NOCOUNT ON;

-- Confirmed SO rows require an EmpId that exists in native WINSpeed EMEmp.
DECLARE @E2EEmpId NVARCHAR(20);
SELECT TOP (1) @E2EEmpId = CONVERT(NVARCHAR(20), EmpID)
FROM dbo.EMEmp WITH (NOLOCK)
WHERE EmpID IS NOT NULL
ORDER BY EmpID;
IF @E2EEmpId IS NULL
BEGIN
  RAISERROR('E2E seed requires at least one dbo.EMEmp row', 16, 1);
  RETURN;
END;

-- Upsert stable fixtures; deleting users would break audit/FK references from prior evidence runs.
MERGE wf.AppUser AS target
USING (VALUES
  ('e2e_admin',    'E2E Admin',     'ADMIN'),
  ('e2e_sales',    'E2E Sales',     'SALES'),
  ('e2e_counter',  'E2E Counter',   'COUNTER_SALES'),
  ('e2e_warehouse','E2E Warehouse', 'WAREHOUSE'),
  ('e2e_manager',  'E2E Manager',   'MANAGER'),
  ('e2e_approver', 'E2E Approver',  'APPROVER')
) AS source (Username, DisplayName, Role)
ON target.Username = source.Username
WHEN MATCHED THEN UPDATE SET
  PasswordHash = '$2b$10$Vx2BFiZ9eALMWjJfAM.cb.dza0KWsB3D9JLRYyhw9Cu6fZfbThFwm',
  DisplayName = source.DisplayName,
  Role = source.Role,
  EmpId = @E2EEmpId
WHEN NOT MATCHED THEN INSERT (Username, PasswordHash, DisplayName, Role, EmpId)
VALUES (source.Username, '$2b$10$Vx2BFiZ9eALMWjJfAM.cb.dza0KWsB3D9JLRYyhw9Cu6fZfbThFwm', source.DisplayName, source.Role, @E2EEmpId);
