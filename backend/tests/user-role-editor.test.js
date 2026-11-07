'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
let current=['SALES','C_LEVEL'];
const profiles=['ADMIN','SALES','C_LEVEL'].map(Code=>({Code,BaseRole:Code})).concat({Code:'SALES_CUSTOM',BaseRole:'SALES'});
const db=h.installDbStub(({text,inputs})=>{
  if(text.includes('AS PolicySchemaMissing'))return [{PolicySchemaMissing:1}];
  if(text.includes("@Resource='WF_ROLE_POLICY'"))return [{LockResult:0}];
  if(text.includes('AS Allowed'))return [{Allowed:1}];
  if(text.includes('SELECT TOP(1) Id'))return [{Id:1}];
  if(text.includes('SELECT Code,BaseRole'))return profiles;
  if(text.includes('SELECT RoleCode FROM wf.vUserRole'))return current.map(RoleCode=>({RoleCode}));
  if(text.includes('FROM wf.AppUser')&&text.includes('WHERE Id = @id'))return [{Id:inputs.id,Role:inputs.id===1?'ADMIN':'C_LEVEL',IsActive:true}];
  if(text.includes('INSERT INTO wf.AppUser'))return [{Id:99,Role:inputs.r}];
  if(text.startsWith('UPDATE wf.AppUser'))return {recordset:[],rowsAffected:[1]};
  return [];
},{activeUserIds:[1,2]});
let app;
test.before(async()=>{app=await h.startApp([['/api/auth','../../routes/auth']]);});
test.after(async()=>{await app.close();});
test.beforeEach(()=>{db.calls.length=0;current=['SALES','C_LEVEL'];});
const admin={sub:1,role:'ADMIN'};
test('create user with custom and C_LEVEL roles in one transaction, preserving initial password change',async()=>{
  const r=await app.call('POST','/api/auth/users',{user:admin,body:{username:'fixture-new',password:require('node:crypto').randomBytes(24).toString('base64url'),displayName:'Fixture',roleCodes:['SALES_CUSTOM','C_LEVEL'],isActive:false,email:'fixture@example.invalid'}});
  assert.equal(r.status,200);
  const insert=db.calls.find(c=>c.text.includes('INSERT INTO wf.AppUser'));
  assert.equal(insert.inputs.r,'C_LEVEL');assert.match(insert.text,/MustChangePassword/);
  assert.deepEqual(db.calls.filter(c=>c.text.startsWith('INSERT wf.UserRole')).map(c=>c.inputs.code).sort(),['C_LEVEL','SALES_CUSTOM']);
  assert.ok(db.calls.some(c=>c.kind==='tx'&&c.text.includes('Email=@email')&&c.inputs.isActive===false));
});
test('edit profile and the full membership atomically with audit and session revocation',async()=>{
  const r=await app.call('PATCH','/api/auth/users/2',{user:admin,body:{displayName:'Edited',roleCodes:['C_LEVEL','SALES_CUSTOM'],expectedRoleCodes:['SALES','C_LEVEL']}});
  assert.equal(r.status,200);
  assert.ok(db.calls.some(c=>c.kind==='tx'&&c.text.includes('AuthVersion = AuthVersion + 1')));
  assert.deepEqual(db.calls.filter(c=>c.text.startsWith('INSERT wf.UserRole')).map(c=>c.inputs.code).sort(),['C_LEVEL','SALES_CUSTOM']);
  assert.ok(db.calls.some(c=>c.text.includes("'USER_ROLES'")&&JSON.parse(c.inputs.detail).before.includes('SALES')));
});
test('stale membership rejects before any profile or membership mutation',async()=>{
  const r=await app.call('PATCH','/api/auth/users/2',{user:admin,body:{displayName:'Must not save',roleCodes:['SALES'],expectedRoleCodes:['SALES']}});
  assert.equal(r.status,409);
  assert.ok(!db.calls.some(c=>/^(UPDATE|INSERT|DELETE)/.test(c.text)));
});
test('profile-only editing preserves all assigned roles and does not revoke session',async()=>{
  const r=await app.call('PATCH','/api/auth/users/2',{user:admin,body:{displayName:'Edited only'}});
  assert.equal(r.status,200);
  assert.ok(!db.calls.some(c=>c.text.startsWith('DELETE FROM wf.UserRole')||c.text.includes('AuthVersion = AuthVersion + 1')));
});
test('empty, duplicate, unknown, missing snapshot and self membership edits fail closed',async()=>{
  for(const body of [{roleCodes:[],expectedRoleCodes:current},{roleCodes:['SALES','SALES'],expectedRoleCodes:current},{roleCodes:['UNKNOWN'],expectedRoleCodes:current},{roleCodes:['SALES']},{roleCodes:['SALES'],expectedRoleCodes:current,role:'SALES'}]){
    db.calls.length=0;const r=await app.call('PATCH','/api/auth/users/2',{user:admin,body});assert.equal(r.status,400);assert.ok(!db.calls.some(c=>/^(UPDATE|INSERT|DELETE)/.test(c.text)));
  }
  const self=await app.call('PATCH','/api/auth/users/1',{user:admin,body:{roleCodes:['ADMIN'],expectedRoleCodes:['ADMIN']}});assert.equal(self.status,403);
});
