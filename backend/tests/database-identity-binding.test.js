'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateReviewedBinding } = require('../services/database-identity-binding');

function sample() {
  return {
    primaryServer: 'SERVER-A', primaryDatabase: 'primary', targetServer: 'SERVER-B', targetDatabase: 'secondary',
    binding: { PrimaryUserId: 12, PrimaryServerName: 'SERVER-A', PrimaryDatabaseName: 'primary', PrimaryUsername: 'person-a', PrimaryEmployeeId: '100', TargetServerName: 'SERVER-B', TargetDatabaseName: 'secondary', TargetUserId: 33, TargetUsername: 'person-a', TargetEmployeeId: '200', IsActive: 1, ReviewedBy: 1, ReviewedAt: '2026-11-13T00:00:00Z', Revision: 1 },
    primary: { Id: 12, Username: 'person-a', EmpId: '100', IsActive: 1 },
    target: { Id: 33, Username: 'person-a', EmpId: '200', IsActive: 1 },
  };
}

test('reviewed cross-database binding returns separate IDs after checking both snapshots', () => {
  assert.deepEqual(validateReviewedBinding(sample()), { primaryUserId: 12, targetUserId: 33, revision: 1 });
});

test('mismatched location, stale snapshot, missing review, revocation and inactive accounts fail closed', () => {
  const mutations = [
    x => { x.primaryDatabase = 'uat'; }, x => { x.targetServer = 'SERVER-C'; },
    x => { x.targetDatabase = 'other'; }, x => { x.primary.Username = 'other'; },
    x => { x.target.Username = 'other'; }, x => { x.target.Id = 12; },
    x => { x.primary.EmpId = 'changed'; }, x => { x.target.EmpId = 'changed'; },
    x => { x.primary.IsActive = 0; }, x => { x.target.IsActive = 0; },
    x => { x.binding.IsActive = 0; }, x => { x.binding.ReviewedBy = 0; },
    x => { x.binding.ReviewedAt = null; }, x => { x.binding.Revision = 0; },
  ];
  for (const mutate of mutations) {
    const fixture = sample(); mutate(fixture);
    assert.throws(() => validateReviewedBinding(fixture), { code: 'IDENTITY_BINDING_INVALID' });
  }
});

test('no binding can be inferred merely from matching IDs or usernames', () => {
  const fixture = sample();
  fixture.target.Id = fixture.primary.Id;
  fixture.binding = null;
  assert.throws(() => validateReviewedBinding(fixture), { code: 'IDENTITY_BINDING_INVALID' });
});

test('migration creates unique source and target bindings plus audit without seeds', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/192_reviewed_database_identity.sql'), 'utf8');
  assert.match(migration, /CREATE UNIQUE INDEX UX_DatabaseIdentityBinding_Primary/);
  assert.match(migration, /CREATE UNIQUE INDEX UX_DatabaseIdentityBinding_Target/);
  assert.match(migration, /CREATE TABLE wf\.DatabaseIdentityBindingAudit/);
  assert.match(migration, /BusinessActorUserId INT NULL/);
  assert.match(migration, /BusinessEffectiveUserId INT NULL/);
  assert.match(migration, /IdentityServer NVARCHAR\(128\) NULL/);
  assert.match(migration, /BusinessServer NVARCHAR\(128\) NULL/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+wf\.DatabaseIdentityBinding/i);
});
