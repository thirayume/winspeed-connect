-- ============================================================================
-- 144_audit_actor_user.sql
-- R12 item 4 (O-5): every write records both the actor and the effective user.
--
-- Under Access As the effective user (UserId) is the impersonated person; the
-- actor is the senior operator behind it. The app fills ActorUserId from the
-- request context (services/request-context.js) once this column exists, and
-- keeps writing the old column list until then.
--
-- SQL 2008 R2 safe: COL_LENGTH guards, nullable ADD only, wf schema only.
-- ============================================================================

IF COL_LENGTH('wf.SalesOrderAudit', 'ActorUserId') IS NULL
BEGIN
    ALTER TABLE wf.SalesOrderAudit ADD ActorUserId INT NULL;
END
GO

IF COL_LENGTH('wf.ChangeEvent', 'ActorUserId') IS NULL
BEGIN
    ALTER TABLE wf.ChangeEvent ADD ActorUserId VARCHAR(50) NULL;
END
GO
