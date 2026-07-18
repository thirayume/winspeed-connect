-- =============================================================
-- 049_seed_all_employees.sql
-- Maps all remaining employees from dbo.EMEmp to wf.AppUser
-- Password for all is set to 'W0rldF3rt'
-- Username is derived from EmpCode (e.g. emp-00001)
-- =============================================================

INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId, IsActive)
SELECT 
    LOWER(e.EmpCode) AS Username,
    '$2b$12$wT2FxAZ34cfPdRyErRtshea0Nw48VEOyIlF8DHeFeYoQsj4IxtkVu' AS PasswordHash,
    e.EmpName AS DisplayName,
    'SALES' AS Role,
    e.EmpID,
    CASE WHEN e.EmpStatus = '1' THEN 1 ELSE 0 END AS IsActive
FROM dbo.EMEmp e
WHERE e.EmpID IS NOT NULL
  AND e.EmpCode IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM wf.AppUser a WHERE a.EmpId = e.EmpID
  )
  AND NOT EXISTS (
      SELECT 1 FROM wf.AppUser a WHERE a.Username = LOWER(e.EmpCode)
  );
GO
