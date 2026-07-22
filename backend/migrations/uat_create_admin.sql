-- Create UAT test admin user (temporary)
IF NOT EXISTS (SELECT 1 FROM wf.AppUser WHERE Username = 'uat_admin')
BEGIN
  INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, IsActive)
  VALUES ('admin', '$2b$12$wT2FxAZ34cfPdRyErRtshea0Nw48VEOyIlF8DHeFeYoQsj4IxtkVu', 'Admin', 'ADMIN', 1);
  PRINT 'Created admin user';
END
ELSE
  PRINT 'admin already exists';
GO
