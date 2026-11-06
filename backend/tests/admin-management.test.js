'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  bcrypt = require('bcrypt');
const h = require('./helpers/route-harness.cjs');
let stored = [],
  sessions = null,
  session = { PolicySchemaMissing: 1 },
  people = [
    { Id: 1, Username: 'admin-fixture', Role: 'ADMIN', IsActive: 1 },
    { Id: 2, Username: 'user-fixture', Role: 'SALES', IsActive: 1 },
    { Id: 3, Username: 'second-fixture', Role: 'WAREHOUSE', IsActive: 1 },
  ];
const db = h.installDbStub(
  ({ text, inputs }) => {
    if (text.includes('AS PolicySchemaMissing')) {
      const row = sessions ? sessions[inputs.id] : session;
      return { recordset: row ? [row] : [] };
    }
    if (text.includes('SELECT Code, Name')) return stored;
    if (text.includes('SELECT BaseRole,Revision')) return stored.filter((p) => p.Code === inputs.code);
    if (text.includes('SELECT Id,Username,Role,IsActive')) return people;
    if (text.includes('UPDATE wf.AppUser')) return { recordset: [], rowsAffected: [1] };
    return [];
  },
  { activeUserIds: h.TEST_USERS },
);
const { parseProfile, sessionProfile, filteredCapabilities } = require('../services/role-profiles');
let app;
test.before(async () => {
  app = await h.startApp([
    ['/api/admin-management', '../../routes/admin-management'],
    ['/api/auth', '../../routes/auth'],
    ['/api/quotation', '../../routes/quotation'],
    ['/api/so', '../../routes/so'],
    ['/api/trips', '../../routes/trips'],
  ]);
});
test.after(() => app.close());
test.beforeEach(() => {
  stored = [];
  sessions = null;
  session = { PolicySchemaMissing: 1 };
  db.calls.length = 0;
});
const admin = { sub: 1, role: 'ADMIN' };
test('custom role accepts bounded permissions, rejects unknown action, admin clone and wrong base', () => {
  const p = {
    code: 'SALES_RESTRICTED',
    name: 'Restricted',
    baseRole: 'SALES',
    disabledActions: ['quotation.create'],
    expectedRevision: 0,
  };
  assert.ok(parseProfile(p));
  assert.equal(parseProfile({ ...p, disabledActions: ['users.manage'] }), null);
  assert.equal(parseProfile({ ...p, baseRole: 'ADMIN' }), null);
  assert.equal(parseProfile({ ...p, code: 'SALES', baseRole: 'MANAGER' }), null);
});
test('role management rejects non-admin and Access As', async () => {
  for (const user of [
    { sub: 2, role: 'SALES' },
    { sub: 2, role: 'ADMIN', actorSub: 1 },
  ])
    assert.equal((await app.call('GET', '/api/admin-management/roles', { user })).status, 403);
});
test('role save writes audit and rejects stale revision / changed base', async () => {
  const body = {
    name: 'Restricted',
    baseRole: 'SALES',
    disabledActions: ['quotation.create'],
    expectedRevision: 0,
  };
  assert.equal(
    (await app.call('PUT', '/api/admin-management/roles/SALES_RESTRICTED', { user: admin, body })).status,
    200,
  );
  assert.ok(db.calls.some((c) => c.text.includes('INSERT INTO wf.AdminChangeAudit')));
  stored = [{ Code: 'SALES_RESTRICTED', BaseRole: 'SALES', Revision: 1, DisabledActions: '[]' }];
  assert.equal(
    (await app.call('PUT', '/api/admin-management/roles/SALES_RESTRICTED', { user: admin, body })).status,
    409,
  );
  assert.equal(
    (
      await app.call('PUT', '/api/admin-management/roles/SALES_RESTRICTED', {
        user: admin,
        body: { ...body, expectedRevision: 1, baseRole: 'MANAGER' },
      })
    ).status,
    409,
  );
});
test('batch rejects self, duplicates, bad ids and unknown users before mutation', async () => {
  for (const ids of [[1], [2, 2], ['2'], [], [2147483648], [999]]) {
    const out = await app.call('POST', '/api/admin-management/users/batch', {
      user: admin,
      body: { ids, action: 'clear-line' },
    });
    assert.ok([400, 409].includes(out.status));
  }
  assert.equal(db.calls.filter((c) => c.text.includes('UPDATE wf.AppUser')).length, 0);
});
test('clear LINE removes all link metadata and invalidates sessions with audit', async () => {
  const out = await app.call('POST', '/api/admin-management/users/batch', {
    user: admin,
    body: { ids: [2, 3], action: 'clear-line' },
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.count, 2);
  const writes = db.calls.filter((c) => c.text.includes('UPDATE wf.AppUser'));
  assert.equal(writes.length, 2);
  for (const w of writes)
    assert.match(
      w.text,
      /LineUserId=NULL,LineDisplayName=NULL,LineLinkedAt=NULL.*AuthVersion=AuthVersion\+1/,
    );
  assert.equal(db.calls.filter((c) => c.text.includes('INSERT INTO wf.AdminChangeAudit')).length, 2);
});
test('password batch uses unique random secrets, bcrypt and must-change, no secrets in audit', async () => {
  const out = await app.call('POST', '/api/admin-management/users/batch', {
    user: admin,
    body: { ids: [2, 3], action: 'reset-password' },
  });
  assert.equal(out.status, 200);
  const cs = out.body.credentials;
  assert.notEqual(cs[0].password, cs[1].password);
  for (const c of cs) {
    const w = db.calls.find((x) => x.text.includes('UPDATE wf.AppUser') && x.inputs.id === c.id);
    assert.equal(await bcrypt.compare(c.password, w.inputs.hash), true);
    assert.match(w.text, /MustChangePassword=1/);
    assert.ok(
      !JSON.stringify(db.calls.filter((x) => x.text.includes('AdminChangeAudit'))).includes(c.password),
    );
  }
});
test('custom role assignment keeps base role and stores RoleCode', async () => {
  stored = [
    {
      Code: 'SALES_RESTRICTED',
      Name: 'Restricted',
      BaseRole: 'SALES',
      Revision: 1,
      DisabledActions: '["quotation.create"]',
    },
  ];
  const out = await app.call('POST', '/api/admin-management/users/batch', {
    user: admin,
    body: { ids: [2], action: 'role', roleCode: 'SALES_RESTRICTED' },
  });
  assert.equal(out.status, 200);
  const w = db.calls.find((c) => c.text.includes('UPDATE wf.AppUser'));
  assert.equal(w.inputs.role, 'SALES');
  assert.equal(w.inputs.code, 'SALES_RESTRICTED');
});
test('fresh server profile denies action despite a previously valid token', async () => {
  stored = [
    {
      Code: 'SALES_RESTRICTED',
      Name: 'Restricted',
      BaseRole: 'SALES',
      Revision: 1,
      DisabledActions: '["quotation.create"]',
    },
  ];
  session = { Role: 'SALES', RoleCode: 'SALES_RESTRICTED', AuthVersion: 0, IsActive: 1 };
  const out = await app.call('POST', '/api/quotation', { user: { sub: 2, role: 'SALES' }, body: {} });
  assert.equal(out.status, 403);
  const u = await sessionProfile({ id: 2, role: 'SALES' }, { authVersion: 0 });
  assert.ok(!filteredCapabilities(u).actions.includes('quotation.create'));
});
test('version mismatch, deleted account and inactive account fail closed', async () => {
  for (const s of [
    null,
    { Role: 'SALES', AuthVersion: 2, IsActive: 1 },
    { Role: 'SALES', AuthVersion: 0, IsActive: 0 },
  ]) {
    session = s;
    await assert.rejects(sessionProfile({ id: 2 }, {}), (e) => e.status === 401);
  }
});

test('disabled capabilities block alternative cancel, confirm and trip detail routes', async () => {
  const actions = ['so.cancel', 'so.confirm', 'trip.view'];
  stored = [
    {
      Code: 'SALES_LIMITED',
      Name: 'Limited',
      BaseRole: 'SALES',
      Revision: 1,
      DisabledActions: JSON.stringify(actions),
    },
  ];
  session = { Role: 'SALES', RoleCode: 'SALES_LIMITED', AuthVersion: 0, IsActive: 1 };
  for (const [method, path] of [
    ['POST', '/api/so/bulk-cancel-delete'],
    ['DELETE', '/api/so/12'],
    ['POST', '/api/trips/12/confirm'],
    ['GET', '/api/trips/12'],
    ['GET', '/api/trips/12/loading-plan'],
  ]) {
    assert.equal(
      (
        await app.call(method, path, {
          user: { sub: 2, role: 'SALES' },
          body: method === 'GET' ? undefined : {},
        })
      ).status,
      403,
      path,
    );
  }
});

test('status batch requires a boolean and role batch refuses unknown profiles', async () => {
  for (const body of [
    { ids: [2], action: 'status', isActive: 'false' },
    { ids: [2], action: 'role', roleCode: 'UNKNOWN_ROLE' },
  ]) {
    assert.equal(
      (await app.call('POST', '/api/admin-management/users/batch', { user: admin, body })).status,
      400,
    );
  }
  assert.equal(db.calls.filter((c) => c.text.includes('UPDATE wf.AppUser')).length, 0);
  const out = await app.call('POST', '/api/admin-management/users/batch', {
    user: admin,
    body: { ids: [2, 3], action: 'status', isActive: false },
  });
  assert.equal(out.status, 200);
  const writes = db.calls.filter((c) => c.text.includes('UPDATE wf.AppUser'));
  assert.equal(writes.length, 2);
  assert.ok(writes.every((c) => c.inputs.active === false && c.text.includes('AuthVersion=AuthVersion+1')));
});

test('a revoked administrator cannot write a role, and malformed stored policy fails closed', async () => {
  people[0].IsActive = 0;
  try {
    const out = await app.call('PUT', '/api/admin-management/roles/SALES_LIMITED', {
      user: admin,
      body: { name: 'Limited', baseRole: 'SALES', disabledActions: [], expectedRevision: 0 },
    });
    assert.equal(out.status, 403);
    assert.equal(db.calls.filter((c) => c.text.includes('INSERT INTO wf.RoleProfile')).length, 0);
  } finally {
    people[0].IsActive = 1;
  }
  stored = [{ Code: 'SALES', BaseRole: 'SALES', DisabledActions: 'invalid-json' }];
  session = { Role: 'SALES', AuthVersion: 0, IsActive: 1 };
  assert.equal(
    (await app.call('POST', '/api/quotation', { user: { sub: 2, role: 'SALES' }, body: {} })).status,
    503,
  );
});

test('Access As cannot escape the real actor restrictions or revoked session', async () => {
  stored=[{Code:'MANAGER_LIMITED',BaseRole:'MANAGER',DisabledActions:'["quotation.create"]'}];
  sessions={1:{Role:'MANAGER',RoleCode:'MANAGER_LIMITED',AuthVersion:0,IsActive:1},2:{Role:'SALES',AuthVersion:0,IsActive:1}};
  const user={sub:2,role:'SALES',actorSub:1,actorRole:'MANAGER'};
  assert.equal((await app.call('POST','/api/quotation',{user,body:{}})).status,403);
  sessions[1].AuthVersion=1;
  assert.equal((await app.call('POST','/api/quotation',{user,body:{}})).status,401);
});
