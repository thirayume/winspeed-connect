'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  bcrypt = require('bcrypt');
const h = require('./helpers/route-harness.cjs');
let assigned = null, remainingAdmin=true, roleMembers=[], stored = [],
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
    if(text.includes("@Resource='WF_ROLE_POLICY'"))return [{LockResult:0}];
    if(text.includes('AS Allowed'))return [{Allowed:people[0].IsActive}];
    if(text.includes('SELECT TOP(1) Id'))return remainingAdmin?people.filter(u=>u.Role==='ADMIN'&&u.IsActive):[];
    if(text.includes('SELECT Code,BaseRole'))return [...ROLES.map(Code=>({Code,BaseRole:Code})),...stored];
    if(text.includes('SELECT RoleCode FROM wf.vUserRole'))return [{RoleCode:people.find(p=>p.Id===inputs.id)?.Role||'SALES'}];
    if(text.includes('SELECT Revision FROM wf.RoleProfile'))return stored.filter(p=>p.Code===inputs.code);
    if(text.includes('SELECT UserId FROM wf.vUserRole WHERE RoleCode'))return roleMembers;
    if(text.includes('SELECT p.Code,p.BaseRole,g.PermissionCode')){
      if(assigned)return assigned[inputs.id]||[];
      const row=sessions?sessions[inputs.id]:session;
      const code=row.RoleCode||row.Role;
      const p=stored.find(p=>p.Code===code)||{Code:code,BaseRole:row.Role,DisabledActions:'[]'};
      const disabled=JSON.parse(p.DisabledActions||'[]');
      const actions=Object.keys(ACTIONS).filter(k=>ACTIONS[k].includes(p.BaseRole)&&!disabled.includes(k));
      return (actions.length?actions:[null]).map(PermissionCode=>({Code:code,BaseRole:p.BaseRole,PermissionCode}));
    }
    if (text.includes('SELECT Code, Name')) return stored;
    if (text.includes('SELECT BaseRole,Revision')) return stored.filter((p) => p.Code === inputs.code);
    if (text.includes('SELECT Id,Username,Role,IsActive')) return people;
    if (text.includes('UPDATE wf.AppUser')) return { recordset: [], rowsAffected: [1] };
    return [];
  },
  { activeUserIds: h.TEST_USERS },
);
const {ACTIONS,ROLES}=require('../services/role-capabilities');
const { parseProfile, sessionProfile, filteredCapabilities } = require('../services/role-profiles');

test('rebate shipment evidence verification requires explicit configurable permission', () => {
  const { capabilitiesFor, hasPermission } = require('../services/role-capabilities');
  assert.ok(capabilitiesFor('ADMIN').actions.includes('rebate.evidence.verify'));
  assert.ok(!capabilitiesFor('ACCOUNTING').actions.includes('rebate.evidence.verify'));
  assert.equal(hasPermission({ role: 'ACCOUNTING', permissions: ['rebate.evidence.verify'] }, 'rebate.evidence.verify'), true);
  assert.equal(hasPermission({ role: 'ACCOUNTING', permissions: [] }, 'rebate.evidence.verify'), false);
  assert.ok(parseProfile({ code: 'REBATE_REVIEW', name: 'Reviewer', baseRole: 'ACCOUNTING', permissions: ['rebate.evidence.verify'], expectedRevision: 0 }));
});
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
  stored = []; assigned=null; remainingAdmin=true; roleMembers=[];
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
  assert.ok(parseProfile({ ...p, baseRole: 'ADMIN' }));
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

test('every catalog permission is editable, including grants outside ADMIN defaults',()=>{
  const permissions=Object.keys(ACTIONS);
  assert.deepEqual(parseProfile({code:'ADMIN_COPY',name:'Copy',baseRole:'ADMIN',permissions,expectedRevision:0}).permissions,permissions);
  assert.deepEqual(parseProfile({code:'ADMIN',name:'Admin',baseRole:'ADMIN',permissions:[],expectedRevision:1}).permissions,[]);
  assert.equal(parseProfile({code:'CUSTOM',name:'Custom',baseRole:'SALES',permissions:['unknown.permission'],expectedRevision:0}),null);
});
test('C_LEVEL plus SALES combines grants; one omission does not override another grant',async()=>{
  session={Role:'C_LEVEL',AuthVersion:0,IsActive:1};
  assigned={2:[{Code:'EXECUTIVE',BaseRole:'C_LEVEL',PermissionCode:'so.verify'},{Code:'SALES_CUSTOM',BaseRole:'SALES',PermissionCode:'so.create'}]};
  let user=await sessionProfile({id:2},{});
  assert.deepEqual(new Set(user.roles),new Set(['C_LEVEL','SALES']));
  assert.equal(filteredCapabilities(user).actions.includes('so.create'),true);
  assigned[2]=[{Code:'EXECUTIVE',BaseRole:'C_LEVEL',PermissionCode:'so.verify'}];
  user=await sessionProfile({id:2},{});
  assert.equal(filteredCapabilities(user).actions.includes('so.create'),false);
  const {requireCapability}=require('../middleware/auth');let next=false,status;
  requireCapability('so.create')({user},{status(s){status=s;return this;},json(){}},()=>{next=true;});
  assert.equal(next,false);assert.equal(status,403);
});
test('membership add/remove/replace preserves grants and rejects removing the last role',()=>{
  const {changeMembership}=require('../services/role-policy-write');
  assert.deepEqual(changeMembership(['C_LEVEL'],['SALES'],'add'),['C_LEVEL','SALES']);
  assert.deepEqual(changeMembership(['C_LEVEL','SALES'],['C_LEVEL'],'remove'),['SALES']);
  assert.deepEqual(changeMembership(['C_LEVEL','SALES'],['ACCOUNTING'],'replace'),['ACCOUNTING']);
  assert.throws(()=>changeMembership(['SALES'],['SALES'],'remove'),e=>e.status===409);
  assert.throws(()=>changeMembership(['SALES'],['ADMIN'],'invalid'),e=>e.status===400);
});
test('delete assigned Role rejects even an inactive member; empty Role can be deleted',async()=>{
  const delAdmin = await app.call('DELETE','/api/admin-management/roles/ADMIN',{user:admin,body:{expectedRevision:0}});
  assert.equal(delAdmin.status, 400);
  stored=[{Code:'UNUSED',BaseRole:'SALES',Revision:2}];roleMembers=[{UserId:3,IsActive:0}];
  let out=await app.call('DELETE','/api/admin-management/roles/UNUSED',{user:admin,body:{expectedRevision:2}});
  assert.equal(out.status,409);assert.equal(db.calls.some(c=>c.text.startsWith('DELETE FROM wf.RoleProfile')),false);
  roleMembers=[];
  out=await app.call('DELETE','/api/admin-management/roles/UNUSED',{user:admin,body:{expectedRevision:2}});
  assert.equal(out.status,200);
  out=await app.call('DELETE','/api/admin-management/roles/UNUSED',{user:admin,body:{expectedRevision:1}});
  assert.equal(out.status,409);
});
test('role ADMIN cannot be updated or deleted via direct API', async () => {
  let out = await app.call('PUT', '/api/admin-management/roles/ADMIN', { user: admin, body: { name: 'Admin', baseRole: 'ADMIN', permissions: [], expectedRevision: 0 } });
  assert.equal(out.status, 400);
  assert.match(out.body.message, /ADMIN/);
  out = await app.call('DELETE', '/api/admin-management/roles/ADMIN', { user: admin, body: { expectedRevision: 0 } });
  assert.equal(out.status, 400);
  assert.match(out.body.message, /ADMIN/);
});
test('removing final administrator permissions fails the transaction',async()=>{
  remainingAdmin=false;
  stored=[{Code:'CUSTOM_ADMIN',BaseRole:'ADMIN',Revision:0}];
  const out=await app.call('PUT','/api/admin-management/roles/CUSTOM_ADMIN',{user:admin,body:{name:'Custom Admin',baseRole:'ADMIN',permissions:[],expectedRevision:0}});
  assert.equal(out.status,409);assert.match(out.body.message,/1/);
  assert.equal(db.calls.some(c=>c.text.includes('INSERT INTO wf.AdminChangeAudit')),false);
});
test('multiple roles retain 116 creator rights and manager review rules',()=>{
  const {mayCreate,decision}=require('../services/manual-redemption-policy');
  assert.equal(mayCreate(['C_LEVEL','WAREHOUSE']),true);
  assert.equal(decision({role:['C_LEVEL','SALES'],actorId:1,requesterActorId:2}).allowed,true);
  assert.equal(decision({role:['SALES'],actorId:1,requesterActorId:2}).allowed,false);
});
test('users and roles capability gating reflects across filteredCapabilities and route isolation', () => {
  const customUser = { id: 2, role: 'SALES', roleCode: 'PILOT_CUSTOM', permissions: ['users.manage'] };
  const caps = filteredCapabilities(customUser);
  assert.ok(caps.menus.includes('admin'), 'Should grant admin menu to users.manage');
  assert.ok(!caps.menus.includes('roles'), 'Should NOT grant roles menu without roles.manage');

  const roleOnlyUser = { id: 3, role: 'SALES', roleCode: 'ROLE_MGR', permissions: ['roles.manage'] };
  const roleCaps = filteredCapabilities(roleOnlyUser);
  assert.ok(!roleCaps.menus.includes('admin'), 'Should NOT grant admin menu without users.manage');
  assert.ok(roleCaps.menus.includes('roles'), 'Should grant roles menu with roles.manage');
});

test('reserved ADMIN cannot be changed or deleted with alternate casing', async()=>{
  for(const code of ['ADMIN','admin','Admin']) {
    assert.equal((await app.call('DELETE',`/api/admin-management/roles/${code}`,{user:admin,body:{expectedRevision:0}})).status,400);
    assert.equal((await app.call('PUT',`/api/admin-management/roles/${code}`,{user:admin,body:{name:'test',baseRole:'ADMIN',permissions:[],expectedRevision:0}})).status,400);
  }
  assert.equal(db.calls.some(c=>/DELETE FROM wf.RoleProfile|UPDATE wf.RoleProfile/.test(c.text)),false);
});

test('custom role with roles.manage can read role history without ADMIN base', async()=>{
  sessions={1:{PolicySchemaMissing:1},2:{Id:2,Role:'SALES',RoleCode:'ROLE_AUDITOR',IsActive:1,AuthVersion:0}};
  assigned={2:[{Code:'ROLE_AUDITOR',BaseRole:'SALES',PermissionCode:'roles.manage'}]};
  assert.equal((await app.call('GET','/api/admin-management/history?domain=roles',{user:{sub:2,role:'SALES'}})).status,200);
  const auditQuery = db.calls.find(c=>/SELECT TOP \(100\).*FROM wf\.AdminChangeAudit/.test(c.text));
  assert.ok(auditQuery); assert.match(auditQuery.text,/CreatedAt >= @globalStartUtc/);
  assert.match(auditQuery.text,/Action IN \('ROLE_SAVE', 'ROLE_DELETE'\)/);
  assert.equal(auditQuery.inputs.globalStartUtc.toISOString(),'2025-12-31T17:00:00.000Z');
});
test('admin history fails closed when the data window is unavailable',async()=>{
  const settings=require('../services/global-data-window-store');const original=settings.readGlobalDataWindow;
  settings.readGlobalDataWindow=async()=>{throw new Error('unavailable');};
  const before=db.calls.length;
  try{
    const result=await app.call('GET','/api/admin-management/history?domain=roles',{user:admin});
    assert.equal(result.status,500);
    assert.ok(!db.calls.slice(before).some(c=>/SELECT TOP \(100\).*FROM wf\.AdminChangeAudit/.test(c.text)));
  }finally{settings.readGlobalDataWindow=original;}
});
test('org viewers receive only organization fields, not account contact or login secrets', async()=>{
  const out=await app.call('GET','/api/auth/org-users',{user:{sub:2,role:'MANAGER'}});
  assert.equal(out.status,200);
  const call=db.calls.find(c=>c.text.includes('u.PositionCode,e.EmpCode'));
  assert.ok(call);assert.doesNotMatch(call.text,/Password|Phone|Email|LineUser|IdCard|TaxId/);
  assert.equal((await app.call('GET','/api/auth/org-users',{user:{sub:2,role:'SALES'}})).status,403);
});
