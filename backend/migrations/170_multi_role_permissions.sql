-- @transaction
-- Explicit permission grants and union membership. Existing assignments/grants are preserved.
IF NOT EXISTS(SELECT 1 FROM wf.RoleProfile WHERE Code='SALES') INSERT wf.RoleProfile(Code,Name,BaseRole,DisabledActions,UpdatedBy) VALUES('SALES','SALES','SALES',N'[]',0);
IF NOT EXISTS(SELECT 1 FROM wf.RoleProfile WHERE Code='COUNTER_SALES') INSERT wf.RoleProfile(Code,Name,BaseRole,DisabledActions,UpdatedBy) VALUES('COUNTER_SALES','COUNTER_SALES','COUNTER_SALES',N'[]',0);
IF NOT EXISTS(SELECT 1 FROM wf.RoleProfile WHERE Code='APPROVER') INSERT wf.RoleProfile(Code,Name,BaseRole,DisabledActions,UpdatedBy) VALUES('APPROVER','APPROVER','APPROVER',N'[]',0);
IF NOT EXISTS(SELECT 1 FROM wf.RoleProfile WHERE Code='WAREHOUSE') INSERT wf.RoleProfile(Code,Name,BaseRole,DisabledActions,UpdatedBy) VALUES('WAREHOUSE','WAREHOUSE','WAREHOUSE',N'[]',0);
IF NOT EXISTS(SELECT 1 FROM wf.RoleProfile WHERE Code='WEIGHBRIDGE') INSERT wf.RoleProfile(Code,Name,BaseRole,DisabledActions,UpdatedBy) VALUES('WEIGHBRIDGE','WEIGHBRIDGE','WEIGHBRIDGE',N'[]',0);
IF NOT EXISTS(SELECT 1 FROM wf.RoleProfile WHERE Code='ACCOUNTING') INSERT wf.RoleProfile(Code,Name,BaseRole,DisabledActions,UpdatedBy) VALUES('ACCOUNTING','ACCOUNTING','ACCOUNTING',N'[]',0);
IF NOT EXISTS(SELECT 1 FROM wf.RoleProfile WHERE Code='MANAGER') INSERT wf.RoleProfile(Code,Name,BaseRole,DisabledActions,UpdatedBy) VALUES('MANAGER','MANAGER','MANAGER',N'[]',0);
IF NOT EXISTS(SELECT 1 FROM wf.RoleProfile WHERE Code='C_LEVEL') INSERT wf.RoleProfile(Code,Name,BaseRole,DisabledActions,UpdatedBy) VALUES('C_LEVEL','C_LEVEL','C_LEVEL',N'[]',0);
IF NOT EXISTS(SELECT 1 FROM wf.RoleProfile WHERE Code='ADMIN') INSERT wf.RoleProfile(Code,Name,BaseRole,DisabledActions,UpdatedBy) VALUES('ADMIN','ADMIN','ADMIN',N'[]',0);
CREATE TABLE wf.RolePermission(RoleCode varchar(30) NOT NULL,PermissionCode varchar(80) NOT NULL,
 CONSTRAINT PK_RolePermission PRIMARY KEY(RoleCode,PermissionCode),
 CONSTRAINT FK_RolePermission_Profile FOREIGN KEY(RoleCode) REFERENCES wf.RoleProfile(Code) ON DELETE CASCADE);
CREATE TABLE wf.UserRole(UserId int NOT NULL,RoleCode varchar(30) NOT NULL,
 CONSTRAINT PK_UserRole PRIMARY KEY(UserId,RoleCode),
 CONSTRAINT FK_UserRole_User FOREIGN KEY(UserId) REFERENCES wf.AppUser(Id) ON DELETE CASCADE,
 CONSTRAINT FK_UserRole_Profile FOREIGN KEY(RoleCode) REFERENCES wf.RoleProfile(Code));
INSERT wf.RolePermission(RoleCode,PermissionCode)
SELECT p.Code,g.PermissionCode FROM wf.RoleProfile p JOIN (
SELECT 'SALES' AS BaseRole,'so.create' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'so.create' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'so.create' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'so.create' AS PermissionCode
UNION ALL
SELECT 'SALES' AS BaseRole,'so.edit' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'so.edit' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'so.edit' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'so.edit' AS PermissionCode
UNION ALL
SELECT 'SALES' AS BaseRole,'so.cancel' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'so.cancel' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'so.cancel' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'so.verify' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'so.verify' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'so.verify' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'so.verify' AS PermissionCode
UNION ALL
SELECT 'SALES' AS BaseRole,'so.confirm' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'so.confirm' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'so.confirm' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'so.confirm' AS PermissionCode
UNION ALL
SELECT 'SALES' AS BaseRole,'so.approve-native' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'so.approve-native' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'so.approve-native' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'so.approve-native' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'so.approve-native' AS PermissionCode
UNION ALL
SELECT 'SALES' AS BaseRole,'so.create-native-delivery' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'so.create-native-delivery' AS PermissionCode
UNION ALL
SELECT 'ACCOUNTING' AS BaseRole,'so.create-native-delivery' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'so.create-native-delivery' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'so.create-native-delivery' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'so.create-native-delivery' AS PermissionCode
UNION ALL
SELECT 'ACCOUNTING' AS BaseRole,'credit.approve-native' AS PermissionCode
UNION ALL
SELECT 'WAREHOUSE' AS BaseRole,'coupon.manual116' AS PermissionCode
UNION ALL
SELECT 'ACCOUNTING' AS BaseRole,'coupon.manual116' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'coupon.manual116' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'coupon.manual116' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'coupon.manual116' AS PermissionCode
UNION ALL
SELECT 'ACCOUNTING' AS BaseRole,'invoice.post-native' AS PermissionCode
UNION ALL
SELECT 'WAREHOUSE' AS BaseRole,'native.print-104' AS PermissionCode
UNION ALL
SELECT 'WEIGHBRIDGE' AS BaseRole,'native.print-104' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'native.print-104' AS PermissionCode
UNION ALL
SELECT 'ACCOUNTING' AS BaseRole,'native.print-104' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'native.print-104' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'native.print-104' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'native.print-104' AS PermissionCode
UNION ALL
SELECT 'WAREHOUSE' AS BaseRole,'native.print-116' AS PermissionCode
UNION ALL
SELECT 'WEIGHBRIDGE' AS BaseRole,'native.print-116' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'native.print-116' AS PermissionCode
UNION ALL
SELECT 'ACCOUNTING' AS BaseRole,'native.print-116' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'native.print-116' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'native.print-116' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'native.print-116' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'native.print-107' AS PermissionCode
UNION ALL
SELECT 'ACCOUNTING' AS BaseRole,'native.print-107' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'native.print-107' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'native.print-107' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'native.print-107' AS PermissionCode
UNION ALL
SELECT 'SALES' AS BaseRole,'trip.view' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'trip.view' AS PermissionCode
UNION ALL
SELECT 'WAREHOUSE' AS BaseRole,'trip.view' AS PermissionCode
UNION ALL
SELECT 'ACCOUNTING' AS BaseRole,'trip.view' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'trip.view' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'trip.view' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'trip.view' AS PermissionCode
UNION ALL
SELECT 'SALES' AS BaseRole,'quotation.create' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'quotation.create' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'quotation.create' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'quotation.create' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'quotation.create' AS PermissionCode
UNION ALL
SELECT 'SALES' AS BaseRole,'quotation.manage' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'quotation.manage' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'quotation.manage' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'quotation.manage' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'quotation.manage' AS PermissionCode
UNION ALL
SELECT 'SALES' AS BaseRole,'edit-request.create' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'edit-request.create' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'edit-request.create' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'edit-request.create' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'edit-request.create' AS PermissionCode
UNION ALL
SELECT 'ACCOUNTING' AS BaseRole,'coupon.settle' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'coupon.settle' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'coupon.settle' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'coupon.settle' AS PermissionCode
UNION ALL
SELECT 'SALES' AS BaseRole,'giveaway.borrow' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'giveaway.borrow' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'giveaway.borrow' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'giveaway.borrow' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'giveaway.borrow' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'giveaway.budget' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'giveaway.budget' AS PermissionCode
UNION ALL
SELECT 'ACCOUNTING' AS BaseRole,'users.manage' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'users.manage' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'users.manage' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'roles.manage' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'settings.manage' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'access-as' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'access-as' AS PermissionCode
UNION ALL
SELECT 'MANAGER' AS BaseRole,'access-as' AS PermissionCode
UNION ALL
SELECT 'ACCOUNTING' AS BaseRole,'access-as' AS PermissionCode
UNION ALL
SELECT 'APPROVER' AS BaseRole,'access-as' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'access-as' AS PermissionCode
UNION ALL
SELECT 'ACCOUNTING' AS BaseRole,'database.switch' AS PermissionCode
UNION ALL
SELECT 'COUNTER_SALES' AS BaseRole,'database.switch' AS PermissionCode
UNION ALL
SELECT 'C_LEVEL' AS BaseRole,'database.switch' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'database.switch' AS PermissionCode
UNION ALL
SELECT 'ADMIN' AS BaseRole,'database.set-system' AS PermissionCode
) g ON g.BaseRole=p.BaseRole
WHERE CHARINDEX('"'+g.PermissionCode+'"',p.DisabledActions)=0;
INSERT wf.UserRole(UserId,RoleCode) SELECT Id,COALESCE(RoleCode,Role) FROM wf.AppUser;
-- Fallback covers legacy import tools creating users; management materializes their assignments.
EXEC(N'CREATE VIEW wf.vUserRole AS
 SELECT UserId,RoleCode FROM wf.UserRole
 UNION ALL SELECT u.Id,COALESCE(u.RoleCode,u.Role) FROM wf.AppUser u WHERE NOT EXISTS(SELECT 1 FROM wf.UserRole r WHERE r.UserId=u.Id)');
EXEC(N'CREATE FUNCTION wf.fn_UserHasPermission(@UserId int,@Permission varchar(80)) RETURNS bit AS
 BEGIN DECLARE @ok bit; SET @ok=0;
 IF EXISTS(SELECT 1 FROM wf.vUserRole r JOIN wf.RolePermission p ON p.RoleCode=r.RoleCode
 JOIN wf.AppUser u ON u.Id=r.UserId WHERE r.UserId=@UserId AND u.IsActive=1 AND p.PermissionCode=@Permission) SET @ok=1;
 RETURN @ok; END');
EXEC(N'CREATE FUNCTION wf.fn_UserHasRole(@UserId int,@Role varchar(30)) RETURNS bit AS
 BEGIN DECLARE @ok bit; SET @ok=0;
 IF EXISTS(SELECT 1 FROM wf.vUserRole r JOIN wf.RoleProfile p ON p.Code=r.RoleCode WHERE r.UserId=@UserId AND p.BaseRole=@Role) SET @ok=1;
 RETURN @ok; END');
