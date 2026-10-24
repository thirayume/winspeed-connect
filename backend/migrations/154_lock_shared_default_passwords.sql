-- @transaction
-- 154_lock_shared_default_passwords.sql
-- Owner 2026-10-24 (option A): migration 049 gave every employee account one shared
-- default password, public as a hash in this repository, and 071 added
-- MustChangePassword = 0 for them. Anyone who knew that password could sign in as any
-- employee. Accounts still on it are locked: inactive, must change password, and the
-- hash replaced by the bcrypt of a random secret that was discarded when it was made.
-- An administrator re-enables a person by activating the account and setting a temporary
-- password (the app then forces that person to choose their own).
-- Only wf.AppUser rows still holding the shared hash change; no dbo data is touched.
UPDATE wf.AppUser
SET PasswordHash = N'$2b$12$CJrnGJGIjBJMgUlNsecxA.9tcP3A549PJK2O76Zd3bSKwkBW0D2cm',
    IsActive = 0,
    MustChangePassword = 1,
    UpdatedAt = GETUTCDATE()
WHERE PasswordHash = N'$2b$12$wT2FxAZ34cfPdRyErRtshea0Nw48VEOyIlF8DHeFeYoQsj4IxtkVu';

PRINT 'Locked ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' account(s) that still used the shared default password';
GO
