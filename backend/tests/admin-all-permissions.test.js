'use strict';
// Owner, 21 Nov 2026: ADMIN is the highest role and may do every task, approving its own work included.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ACTIONS, hasPermission } = require('../services/role-capabilities');

test('ADMIN holds every permission, whatever its profile lists; SEPARATION still holds none', () => {
  for (const action of Object.keys(ACTIONS)) {
    assert.equal(hasPermission({ role: 'ADMIN' }, action), true, action);
    assert.equal(hasPermission({ roles: ['ADMIN'], permissions: [] }, action), true, action);
    assert.equal(hasPermission({ roles: ['ADMIN', 'SEPARATION'], permissions: [] }, action), false, action);
  }
  // the default lists name ADMIN too, so Role Management shows it
  for (const [action, roles] of Object.entries(ACTIONS)) assert.ok(roles.includes('ADMIN'), action);
  // other roles keep their own lists
  assert.equal(hasPermission({ role: 'MANAGER' }, 'credit.approve-native'), false);
  assert.equal(hasPermission({ roles: ['ACCOUNTING'], permissions: [] }, 'credit.approve-native'), false);
});

test('a route that names roles admits ADMIN; under Access As the person shown is checked with their own roles', () => {
  const { requireRole } = require('../middleware/auth');
  const run = user => { let status = 200; let passed = false;
    requireRole('ACCOUNTING')({ user }, { status(v) { status = v; return this; }, json() { return this; } }, () => { passed = true; });
    return passed ? 200 : status; };
  assert.equal(run({ role: 'ADMIN', roles: ['ADMIN'] }), 200);
  assert.equal(run({ role: 'MANAGER', roles: ['MANAGER'] }), 403);
  assert.equal(run({ role: 'SALES', roles: ['SALES'], isImpersonating: true, actorRole: 'ADMIN', actorRoles: ['ADMIN'] }), 403);
  assert.equal(run({ role: 'ACCOUNTING', roles: ['ACCOUNTING'], isImpersonating: true, actorRole: 'ADMIN', actorRoles: ['ADMIN'] }), 200);
});

test('migration 256 gives ADMIN every database permission and lets ADMIN approve its own 116 exception; the rollback restores 252', () => {
  const dir = path.join(__dirname, '..', 'migrations');
  const up = fs.readFileSync(path.join(dir, '256_admin_all_permissions.sql'), 'utf8').replace(/\r\n/g, '\n');
  const down = fs.readFileSync(path.join(dir, 'down', '256_admin_all_permissions.down.sql'), 'utf8').replace(/\r\n/g, '\n');
  const m252 = fs.readFileSync(path.join(dir, '252_native_116_shipdate_policy.sql'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(up, /^-- @transaction/);
  assert.match(up, /ALTER FUNCTION wf\.fn_UserHasPermission/);
  assert.match(up, /p\.BaseRole='ADMIN'/);
  assert.match(up, /RoleCode='SEPARATION'/);
  assert.match(up, /wf\.fn_UserHasRole\(Id,'ADMIN'\)=1\) AND wf\.fn_UserHasPermission\(Id,'coupon\.manual116'\)=1/);
  assert.match(up, /IF @Exception=1 AND\(\(@Self<>0 AND wf\.fn_UserHasRole\(@ApproverId,'ADMIN'\)<>1\) OR/);
  assert.match(up, /fn_IsInitialNativeUatTarget\(\)<>1/);
  // no data rows change and no dbo object changes
  assert.doesNotMatch(up, /\b(INSERT|UPDATE|DELETE)\s+(INTO\s+)?wf\.(RolePermission|UserRole|AppUser)\b/i);
  assert.doesNotMatch(up, /ALTER\s+(TABLE|PROCEDURE|FUNCTION)\s+dbo\./i);
  // the rollback is the 170 function and the 252 procedure exactly
  const proc = s => s.slice(s.indexOf('ALTER PROCEDURE wf.usp_CreateInitialManualRedemption'), s.indexOf('\nGO', s.indexOf('ALTER PROCEDURE wf.usp_CreateInitialManualRedemption')));
  assert.equal(proc(down), proc(m252));
  assert.doesNotMatch(down, /BaseRole='ADMIN'/);
  // apart from the two marked changes, the procedure is the 252 body
  const changed = proc(up)
    .replace(" OR wf.fn_UserHasRole(Id,'ADMIN')=1)", ')')
    .replace("IF @Exception=1 AND((@Self<>0 AND wf.fn_UserHasRole(@ApproverId,'ADMIN')<>1) OR", 'IF @Exception=1 AND(@Self<>0 OR');
  assert.equal(changed, proc(m252));
});

test('migration 257 lets an ADMIN approver of a 116 have no employee; the rollback restores 256 and refuses while such a row exists', () => {
  const dir = path.join(__dirname, '..', 'migrations');
  const read = f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
  const up = read('257_admin_116_approver_without_employee.sql');
  const down = read('down/257_admin_116_approver_without_employee.down.sql');
  const m256 = read('256_admin_all_permissions.sql');
  const proc = s => { const i = s.indexOf('ALTER PROCEDURE wf.usp_CreateInitialManualRedemption'); return s.slice(i, s.indexOf('\nGO', i)); };
  assert.match(up, /^-- @transaction/);
  assert.match(up, /ALTER TABLE wf\.NativeDocumentApproval ALTER COLUMN ApproverEmpID int NULL/);
  assert.doesNotMatch(up, /ALTER\s+(TABLE|PROCEDURE|FUNCTION)\s+dbo\./i);
  // no existing approval row is changed
  assert.doesNotMatch(up, /\b(UPDATE|DELETE\s+FROM)\s+wf\.NativeDocumentApproval\b/);
  // WinSpeed's 116 still gets the recorder only; the approver stays in wf
  assert.match(proc(up), /INSERT INTO dbo\.WFRedemtionHD\(RedemtionID,DocuNo,DocuDate,DocuType,IssueName,CarLicense,SaveEmpID,/);
  assert.doesNotMatch(proc(up), /AppvEmpID/);
  const changed = proc(up)
    .replace(' LEFT JOIN dbo.EMEmp emp WITH(UPDLOCK,HOLDLOCK) ON CONVERT(varchar(30),emp.EmpID)=u.EmpId', ' JOIN dbo.EMEmp emp WITH(UPDLOCK,HOLDLOCK) ON CONVERT(varchar(30),emp.EmpID)=u.EmpId')
    .replace("  AND(emp.EmpID IS NOT NULL OR(u.EmpId IS NULL AND wf.fn_UserHasRole(u.Id,'ADMIN')=1))\n", '')
    .replace("OR(@AppvEmp IS NULL AND wf.fn_UserHasRole(@ApproverId,'ADMIN')<>1) OR", 'OR @AppvEmp IS NULL OR')
    .replace(" IF wf.fn_UserHasRole(@ApproverId,'ADMIN')<>1 AND NOT EXISTS(SELECT 1 FROM wf.NativeApproverEmployee", ' IF NOT EXISTS(SELECT 1 FROM wf.NativeApproverEmployee');
  assert.equal(changed, proc(m256));
  assert.equal(proc(down), proc(m256));
  assert.match(down, /ROLLBACK_257_BLOCKED/);
  assert.match(down, /ALTER COLUMN ApproverEmpID int NOT NULL/);
});
