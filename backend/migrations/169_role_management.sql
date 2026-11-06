-- @transaction
-- SQL Server 2008 R2 compatible. Additive; existing roles keep their permissions.
IF OBJECT_ID('wf.RoleProfile','U') IS NULL
CREATE TABLE wf.RoleProfile (
 Code varchar(30) NOT NULL PRIMARY KEY, Name nvarchar(100) NOT NULL,
 BaseRole varchar(30) NOT NULL, DisabledActions nvarchar(max) NOT NULL,
 Revision int NOT NULL DEFAULT 1, UpdatedBy int NOT NULL, UpdatedAt datetime NOT NULL DEFAULT GETUTCDATE()
);
IF COL_LENGTH('wf.AppUser','RoleCode') IS NULL ALTER TABLE wf.AppUser ADD RoleCode varchar(30) NULL;
IF COL_LENGTH('wf.AppUser','AuthVersion') IS NULL ALTER TABLE wf.AppUser ADD AuthVersion int NOT NULL CONSTRAINT DF_AppUser_AuthVersion DEFAULT 0;
IF OBJECT_ID('wf.AdminChangeAudit','U') IS NULL
CREATE TABLE wf.AdminChangeAudit (
 Id bigint IDENTITY PRIMARY KEY, ActorId int NOT NULL, Action varchar(40) NOT NULL,
 Target nvarchar(100) NOT NULL, Detail nvarchar(max) NOT NULL, CreatedAt datetime NOT NULL DEFAULT GETUTCDATE()
);
