'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const express = require('express');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const h = require('./helpers/route-harness.cjs');
const context = new AsyncLocalStorage();
const checked = [];
let auditEvent;
let auditDone;
let attemptedAudit;
let failAttemptAudit = false;
let accessAsWrites = [];
let adminCanCreate = true;
const { stub: db, calls: dbCalls } = h.installDbStub(({ text, inputs }) => {
  const database = context.getStore()?.database;
  if (/INSERT INTO wf\.AccessAsAudit/.test(text)) {
    accessAsWrites.push({ database, ...inputs });
    return { recordset:[], rowsAffected:[1] };
  }
  if (/SELECT Id, Username, DisplayName, Role, RoleCode, AuthVersion/.test(text) && /FROM wf\.AppUser\s+WHERE Id = @id/.test(text)) {
    const id=Number(inputs.id),role=id===17?'ADMIN':id===22?'ACCOUNTING':'SALES';
    checked.push({database,id,kind:'user'});
    return [{ Id:id, Username:`test-${id}`, DisplayName:'Fixture', Role:role, IsActive:1, AuthVersion:0 }];
  }
  if (/SELECT OBJECT_ID\('wf\.ApiAuditLog'/.test(text)) return [{ ObjectId: 1, IdentityColumn: 256, BusinessColumn: 256, BusinessActorColumn: 1, BusinessEffectiveColumn: 1, IdentityServerColumn: 1, BusinessServerColumn: 1 }];
  if (/INSERT INTO wf\.ApiAuditLog/.test(text)) {
    if (/102, 0, SYSUTCDATETIME/.test(text)) {
      attemptedAudit = { database, inputs };
      if (failAttemptAudit) throw new Error('simulated audit failure');
    } else { auditEvent = { database, inputs }; auditDone?.(); }
    return [];
  }
  if (/SELECT IsActive FROM wf\.AppUser/.test(text)) {
    checked.push({ database, id: inputs.id, kind: 'status' });
    return [{ IsActive: database === 'primary' ? 1 : 0 }];
  }
  if (/AS PolicySchemaMissing/.test(text)) {
    checked.push({ database, id: inputs.id, kind: 'profile' });
    const role = inputs.id === 17 ? 'ADMIN' : inputs.id === 22 ? 'ACCOUNTING' : 'SALES';
    return [{ Role: role, RoleCode: role, IsActive: 1, AuthVersion: 0 }];
  }
  if (/FROM wf\.vUserRole u/.test(text)) {
    const role = inputs.id === 17 ? 'ADMIN' : inputs.id === 22 ? 'ACCOUNTING' : 'SALES';
    const permissions=role==='ADMIN'?['access-as','database.switch','trip.view',...(adminCanCreate?['so.create']:[])]:role==='ACCOUNTING'?['invoice.post-native','database.switch']:['so.create','trip.view'];
    return permissions.map(PermissionCode=>({ Code:role, BaseRole:role, PermissionCode }));
  }
  return [];
});
db.getTarget = () => context.getStore()?.target || 'onprem';
db.getDbName = () => context.getStore()?.database || null;
db.runWithTarget = (target, fn, database) => context.run({ target, database }, fn);
db.runWithDb = (database, fn) => context.run({ target: 'onprem', database }, fn);
const activePath = require.resolve('../services/active-database');
let restrictedActor = false;
require.cache[activePath] = { id: activePath, filename: activePath, loaded: true, exports: {
  primaryDatabase: () => 'primary', onpremEnabled: () => true,
  systemActiveDatabase: async () => 'secondary', getDatabaseThemes: async () => ({}),
  canAccessDatabase: (_db, user) => !(restrictedActor && user.role === 'ADMIN'), DEFAULT_DATABASE_THEMES: {},
} };
const resolverPath = require.resolve('../services/database-identity-resolver');
let mappingCalls = [], rejectBinding = false;
require.cache[resolverPath] = { id: resolverPath, filename: resolverPath, loaded: true, exports: {
  sqlRepository: () => ({}),
  resolveReviewedActorAndEffective: async args => {
    mappingCalls.push(args);
    if (rejectBinding) throw Object.assign(new Error('invalid'), { code: 'IDENTITY_BINDING_INVALID' });
    return { primaryActorUserId: args.actorUserId, primaryEffectiveUserId: args.effectiveUserId,
      businessActorUserId: 47, businessEffectiveUserId: args.actorUserId === args.effectiveUserId ? 47 : 34, actorRevision: 1, effectiveRevision: 1,
      identityServer: 'A', businessServer: 'B' };
  },
} };
const { requireAuth, requireCapability, SECRET, clearAccountStatusCache } = require('../middleware/auth');
const { currentActorId } = require('../services/request-context');
const apiAudit = require('../middleware/apiAudit');

test('Access As authenticates on primary, audits and refuses an unmapped business database', async t => {
  const app = express();
  app.use((req, res, next) => db.runWithTarget('onprem', next, 'secondary'));
  app.use(apiAudit());
  app.post('/api/check', requireAuth, (req, res) => res.json({ database: db.getDbName(), effective: req.user.sub, actor: currentActorId(), actorRoles: req.user.actorRoles, roles: req.user.roles }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  clearAccountStatusCache();
  const token = jwt.sign({ sub: 8, id: 8, role: 'SALES', actorSub: 17, actorRole: 'ADMIN', impersonating: true }, SECRET);
  const audited = new Promise(resolve => { auditDone = resolve; });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/check`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'IDENTITY_MAPPING_REQUIRED');
  assert.deepEqual(checked.map(x => [x.kind, x.database, x.id]).sort(), [
    ['profile', 'primary', 17], ['profile', 'primary', 8], ['status', 'primary', 17], ['status', 'primary', 8],
  ].sort());
  await Promise.race([audited, new Promise((_, reject) => setTimeout(() => reject(new Error('audit timeout')), 2000))]);
  assert.equal(auditEvent.database, 'primary');
  assert.equal(auditEvent.inputs.actorUserId, 17);
  assert.equal(auditEvent.inputs.effectiveUserId, 8);
  assert.equal(auditEvent.inputs.identityDatabase, 'primary');
  assert.equal(auditEvent.inputs.businessDatabase, 'secondary');
  assert.equal(auditEvent.inputs.businessActorUserId, null);
  assert.equal(auditEvent.inputs.businessEffectiveUserId, null);
});

test('ordinary sessions also refuse an unmapped secondary identity before touching business data', async t => {
  const app = express();
  app.use((req, res, next) => db.runWithTarget('onprem', next, 'secondary'));
  app.use(apiAudit());
  let reachedBusinessHandler = false;
  app.post('/api/check', requireAuth, (req, res) => { reachedBusinessHandler = true; res.json({ ok: true }); });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  clearAccountStatusCache();
  const token = jwt.sign({ sub: 8, id: 8, role: 'SALES' }, SECRET);
  const audited = new Promise(resolve => { auditDone = resolve; });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/check`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'IDENTITY_MAPPING_REQUIRED');
  assert.equal(reachedBusinessHandler, false);
  await Promise.race([audited, new Promise((_, reject) => setTimeout(() => reject(new Error('audit timeout')), 2000))]);
  assert.equal(auditEvent.database, 'primary');
  assert.equal(auditEvent.inputs.actorUserId, 8);
  assert.equal(auditEvent.inputs.effectiveUserId, 8);
  assert.equal(auditEvent.inputs.businessDatabase, 'secondary');
});

test('approved ADMIN Access As ACCOUNTING keeps invoice permission and audits both identities', async t => {
  const app = express();
  app.use((req, res, next) => db.runWithTarget('onprem', next, 'primary'));
  app.use(apiAudit());
  app.post('/api/invoice', requireAuth, requireCapability('invoice.post-native'), (req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  clearAccountStatusCache();
  const token = jwt.sign({ sub: 22, id: 22, role: 'ACCOUNTING', actorSub: 17, actorRole: 'ADMIN', impersonating: true }, SECRET);
  const audited = new Promise(resolve => { auditDone = resolve; });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/invoice`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  await Promise.race([audited, new Promise((_, reject) => setTimeout(() => reject(new Error('audit timeout')), 2000))]);
  assert.equal(auditEvent.database, 'primary');
  assert.equal(auditEvent.inputs.actorUserId, 17);
  assert.equal(auditEvent.inputs.effectiveUserId, 22);
});

test('audit keeps primary actor and effective IDs distinct from server-side mapped business IDs', async t => {
  const app = express();
  app.use((req, res, next) => db.runWithTarget('onprem', next, 'secondary'));
  app.use(apiAudit());
  app.post('/api/check', (req, res) => {
    req.user = { sub: 8, actorSub: 17 };
    req.auditBusinessDatabase = 'secondary';
    req.identityMappingAudit = { businessActorUserId: 47, businessEffectiveUserId: 34, identityServer: 'A', businessServer: 'B' };
    res.json({ ok: true });
  });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const audited = new Promise(resolve => { auditDone = resolve; });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/check`, { method: 'POST' });
  assert.equal(response.status, 200);
  await Promise.race([audited, new Promise((_, reject) => setTimeout(() => reject(new Error('audit timeout')), 2000))]);
  assert.equal(auditEvent.database, 'primary');
  assert.equal(auditEvent.inputs.actorUserId, 17);
  assert.equal(auditEvent.inputs.effectiveUserId, 8);
  assert.equal(auditEvent.inputs.businessActorUserId, 47);
  assert.equal(auditEvent.inputs.businessEffectiveUserId, 34);
  assert.equal(auditEvent.inputs.identityServer, 'A');
  assert.equal(auditEvent.inputs.businessServer, 'B');
});

test('a signed token cannot supply its own business identity mapping', async t => {
  const app = express();
  app.use((req, res, next) => db.runWithTarget('onprem', next, 'primary'));
  app.get('/api/check', requireAuth, (req, res) => res.json({ mapped: Boolean(req.user.identityMapping), id: req.user.sub }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  clearAccountStatusCache();
  const token = jwt.sign({ sub: 8, role: 'SALES', identityMapping: { primaryEffectiveUserId: 8, primaryActorUserId: 8, businessEffectiveUserId: 1, businessActorUserId: 1 } }, SECRET);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/check`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { mapped: false, id: 8 });
});

test('reviewed secondary stats route resolves both parties; unreviewed routes and invalid bindings stay closed', async t => {
  const app = express();
  app.use((req, res, next) => db.runWithTarget('onprem', next, 'secondary'));
  app.use(apiAudit());
  const router = express.Router();
  router.get('/stats', requireAuth, (req, res) => {
    const { businessIds } = require('../services/business-identity');
    if (req.query.fail) return res.status(400).json({ simulated: true });
    res.json({ identity: { actor: req.user.actorSub, effective: req.user.sub }, business: businessIds(req.user) });
  });
  router.get('/other', requireAuth, (_req, res) => res.json({ ok: true }));
  app.use('/api/so', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  clearAccountStatusCache(); mappingCalls = []; rejectBinding = false;
  const token = jwt.sign({ sub: 22, id: 22, role: 'ACCOUNTING', actorSub: 17, actorRole: 'ADMIN', impersonating: true }, SECRET);
  const headers = { authorization: `Bearer ${token}` };
  const successfulAudit = new Promise(resolve => { auditDone = resolve; });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/so/stats?search=private`, { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { identity: { actor: 17, effective: 22 }, business: { actor: 47, effective: 34 } });
  assert.deepEqual(mappingCalls[0], { actorUserId: 17, effectiveUserId: 22, primaryDatabase: 'primary', targetDatabase: 'secondary' });
  assert.equal(attemptedAudit.database, 'primary');
  assert.equal(attemptedAudit.inputs.actor, 17); assert.equal(attemptedAudit.inputs.effective, 22);
  assert.equal(attemptedAudit.inputs.businessActor, 47); assert.equal(attemptedAudit.inputs.businessEffective, 34);
  assert.equal(attemptedAudit.inputs.path, '/api/so/stats');
  await Promise.race([successfulAudit, new Promise((_, reject) => setTimeout(() => reject(new Error('audit timeout')), 2000))]);
  assert.equal(auditEvent.inputs.path, '/api/so/stats');
  assert.equal(auditEvent.inputs.actorUserId, 17); assert.equal(auditEvent.inputs.effectiveUserId, 22);
  assert.equal(auditEvent.inputs.businessActorUserId, 47); assert.equal(auditEvent.inputs.businessEffectiveUserId, 34);
  const audited = new Promise(resolve => { auditDone = resolve; });
  const failure = await fetch(`http://127.0.0.1:${server.address().port}/api/so/stats?fail=1`, { headers });
  assert.equal(failure.status, 400);
  await Promise.race([audited, new Promise((_, reject) => setTimeout(() => reject(new Error('audit timeout')), 2000))]);
  assert.equal(auditEvent.database, 'primary');
  assert.equal(auditEvent.inputs.actorUserId, 17); assert.equal(auditEvent.inputs.effectiveUserId, 22);
  assert.equal(auditEvent.inputs.businessActorUserId, 47); assert.equal(auditEvent.inputs.businessEffectiveUserId, 34);
  restrictedActor = true;
  const actorDenied = await fetch(`http://127.0.0.1:${server.address().port}/api/so/stats`, { headers });
  assert.equal(actorDenied.status, 403);
  restrictedActor = false;
  const blocked = await fetch(`http://127.0.0.1:${server.address().port}/api/so/other`, { headers });
  assert.equal(blocked.status, 409);
  rejectBinding = true;
  const invalid = await fetch(`http://127.0.0.1:${server.address().port}/api/so/stats`, { headers });
  assert.equal(invalid.status, 409);
  rejectBinding = false;
});

test('reviewed secondary read is denied if its primary audit cannot be written', async t => {
  const app = express();
  app.use((req, res, next) => db.runWithTarget('onprem', next, 'secondary'));
  let reached = false;
  const router = express.Router();
  router.get('/stats', requireAuth, (_req, res) => { reached = true; res.json({ ok:true }); });
  app.use('/api/so', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  clearAccountStatusCache();
  const token = jwt.sign({ sub:22, role:'ACCOUNTING', actorSub:17, actorRole:'ADMIN', impersonating:true }, SECRET);
  failAttemptAudit = true;
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/so/stats`, { headers:{ authorization:`Bearer ${token}` } });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'AUDIT_UNAVAILABLE');
    assert.equal(reached, false);
  } finally { failAttemptAudit = false; }
});

test('secondary customer master read requires reviewed identities, audit, and no untranslated user filter', async t => {
  const app=express();app.use((req,res,next)=>db.runWithTarget('onprem',next,'secondary'));
  let reached=0;const router=express.Router();
  router.get('/customers',requireAuth,(req,res)=>{reached++;res.json({identity:req.user.identityMapping});});
  router.get('/aging',requireAuth,(req,res)=>{reached++;res.json({identity:req.user.identityMapping});});
  router.post('/customers',requireAuth,(_req,res)=>{reached++;res.json({ok:true});});app.use('/api/master',router);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  clearAccountStatusCache();mappingCalls=[];rejectBinding=false;
  const token=jwt.sign({sub:22,id:22,role:'ACCOUNTING',actorSub:17,actorRole:'ADMIN',impersonating:true},SECRET);
  const headers={authorization:`Bearer ${token}`};
  const allowed=await fetch(`http://127.0.0.1:${server.address().port}/api/master/customers`,{headers});
  assert.equal(allowed.status,200);assert.equal(reached,1);assert.equal((await allowed.json()).identity.businessEffectiveUserId,34);
  assert.equal(attemptedAudit.inputs.path,'/api/master/customers');
  const aging=await fetch(`http://127.0.0.1:${server.address().port}/api/master/aging`,{headers});
  assert.equal(aging.status,200);assert.equal(reached,2);assert.equal((await aging.json()).identity.businessEffectiveUserId,34);
  for(const filter of ['salesperson=22','employee=22']){
    const denied=await fetch(`http://127.0.0.1:${server.address().port}/api/master/customers?${filter}`,{headers});
    assert.equal(denied.status,409);
  }
  const write=await fetch(`http://127.0.0.1:${server.address().port}/api/master/customers`,{method:'POST',headers});
  assert.equal(write.status,409);assert.equal(reached,2);
  rejectBinding=true;
  try {const denied=await fetch(`http://127.0.0.1:${server.address().port}/api/master/customers`,{headers});assert.equal(denied.status,409);}
  finally {rejectBinding=false;}
  failAttemptAudit=true;
  try {const denied=await fetch(`http://127.0.0.1:${server.address().port}/api/master/customers`,{headers});assert.equal(denied.status,503);}
  finally {failAttemptAudit=false;}
  assert.equal(reached,2);
});

test('secondary trip board requires both mapped identities and a durable pre-read audit', async t => {
  const app = express();
  app.use((req, res, next) => db.runWithTarget('onprem', next, 'secondary'));
  let reached = 0;
  const router = express.Router();
  router.get('/', requireAuth, (req, res) => { reached++; res.json({identity: req.user.identityMapping}); });
  router.get('/board', requireAuth, (req, res) => { reached++; res.json({identity: req.user.identityMapping}); });
  router.get('/other', requireAuth, (_req, res) => { reached++; res.json({ok: true}); });
  router.post('/board', requireAuth, (_req, res) => { reached++; res.json({ok: true}); });
  app.use('/api/trips', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  clearAccountStatusCache(); mappingCalls = []; rejectBinding = false;
  const token = jwt.sign({sub: 22, id: 22, role: 'ACCOUNTING', actorSub: 17, actorRole: 'ADMIN', impersonating: true}, SECRET);
  const headers = {authorization: `Bearer ${token}`};
  const allowed = await fetch(`http://127.0.0.1:${server.address().port}/api/trips/board`, {headers});
  assert.equal(allowed.status, 200);
  const mapped = (await allowed.json()).identity;
  assert.equal(mapped.businessActorUserId, 47); assert.equal(mapped.businessEffectiveUserId, 34);
  assert.equal(attemptedAudit.inputs.path, '/api/trips/board');
  assert.equal(attemptedAudit.inputs.actor, 17); assert.equal(attemptedAudit.inputs.effective, 22);
  const list = await fetch(`http://127.0.0.1:${server.address().port}/api/trips/`, {headers});
  assert.equal(list.status, 200);
  assert.equal((await list.json()).identity.businessEffectiveUserId, 34);
  assert.equal(attemptedAudit.inputs.path, '/api/trips/');
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/trips/other`, {headers})).status, 409);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/trips/board`, {method: 'POST', headers})).status, 409);
  rejectBinding = true;
  try { assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/trips/board`, {headers})).status, 409); }
  finally { rejectBinding = false; }
  failAttemptAudit = true;
  try { assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/trips/board`, {headers})).status, 503); }
  finally { failAttemptAudit = false; }
  assert.equal(reached, 2);
});

test('secondary sales can only read scoped trip list and board with mapping and audit', async t => {
  const app=express(); app.use((req,res,next)=>db.runWithTarget('onprem',next,'secondary'));
  const router=express.Router(); let reached=0;
  for (const path of ['/', '/board', '/other']) router.get(path,requireAuth,requireCapability('trip.view'),(req,res)=>{reached++;res.json({mapped:req.user.identityMapping.businessEffectiveUserId});});
  router.post('/board',requireAuth,(_req,res)=>res.json({ok:true})); app.use('/api/trips',router);
  const server=http.createServer(app); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>server.close());
  clearAccountStatusCache(); rejectBinding=false; failAttemptAudit=false;
  const token=jwt.sign({sub:8,role:'SALES',actorSub:17,actorRole:'ADMIN',impersonating:true},SECRET);
  const headers={authorization:`Bearer ${token}`}, url=`http://127.0.0.1:${server.address().port}/api/trips`;
  for(const path of ['/', '/board']) { const response=await fetch(url+path,{headers}); assert.equal(response.status,200); assert.equal((await response.json()).mapped,34); assert.equal(attemptedAudit.inputs.path,'/api/trips'+path); }
  assert.equal((await fetch(url+'/other',{headers})).status,409);
  assert.equal((await fetch(url+'/board',{method:'POST',headers})).status,409);
  rejectBinding=true; try { assert.equal((await fetch(url+'/board',{headers})).status,409); } finally { rejectBinding=false; }
  failAttemptAudit=true; try { assert.equal((await fetch(url+'/board',{headers})).status,503); } finally { failAttemptAudit=false; }
  assert.equal(reached,2);
});

test('secondary sales list and customer read require both capabilities and reject untranslated filters', async t => {
  const app=express(); app.use((req,res,next)=>db.runWithTarget('onprem',next,'secondary'));
  for (const mount of ['/api/so','/api/master']) {const r=express.Router();r.get(['/', '/stats','/customers'],requireAuth,(req,res)=>res.json({mapped:req.user.identityMapping.businessEffectiveUserId}));app.use(mount,r);}
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  clearAccountStatusCache();rejectBinding=false;failAttemptAudit=false;adminCanCreate=true;
  const token=jwt.sign({sub:8,role:'SALES',actorSub:17,actorRole:'ADMIN',impersonating:true},SECRET);
  const headers={authorization:`Bearer ${token}`},base=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['/api/so/','/api/so/stats','/api/master/customers']) {const r=await fetch(base+path,{headers});assert.equal(r.status,200,path);assert.equal((await r.json()).mapped,34);assert.equal(attemptedAudit.inputs.path,path);}
  for(const path of ['/api/master/customers?salesperson=8','/api/master/customers?employee=8','/api/master/stats'])assert.equal((await fetch(base+path,{headers})).status,409,path);
  adminCanCreate=false;clearAccountStatusCache();try{assert.equal((await fetch(base+'/api/master/customers',{headers})).status,409);}finally{adminCanCreate=true;clearAccountStatusCache();}
  rejectBinding=true;try{assert.equal((await fetch(base+'/api/so/',{headers})).status,409);}finally{rejectBinding=false;}
  failAttemptAudit=true;try{assert.equal((await fetch(base+'/api/master/customers',{headers})).status,503);}finally{failAttemptAudit=false;}
});

test('secondary sales credit, sale goods and current prices require mapping and audit', async t => {
  const app=express(); app.use((req,res,next)=>db.runWithTarget('onprem',next,'secondary'));
  for (const mount of ['/api/credit','/api/master']) {const r=express.Router();r.get(['/:id/status','/goods','/prices'],requireAuth,(req,res)=>res.json({mapped:req.user.identityMapping.businessEffectiveUserId}));app.use(mount,r);}
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  clearAccountStatusCache();rejectBinding=false;failAttemptAudit=false;adminCanCreate=true;
  const token=jwt.sign({sub:8,role:'SALES',actorSub:17,actorRole:'ADMIN',impersonating:true},SECRET);
  const headers={authorization:`Bearer ${token}`},base=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['/api/credit/123/status','/api/master/goods?forSale=true','/api/master/prices?custId=123']) {const r=await fetch(base+path,{headers});assert.equal(r.status,200,path);assert.equal((await r.json()).mapped,34);assert.equal(attemptedAudit.inputs.effective,8);}
  for(const path of ['/api/credit/foo/status','/api/master/goods','/api/master/goods?forSale=true&includeInactive=true','/api/master/prices?includeExpired=true'])assert.equal((await fetch(base+path,{headers})).status,409,path);
  adminCanCreate=false;clearAccountStatusCache();try{assert.equal((await fetch(base+'/api/credit/123/status',{headers})).status,409);}finally{adminCanCreate=true;clearAccountStatusCache();}
  rejectBinding=true;try{assert.equal((await fetch(base+'/api/master/goods?forSale=true',{headers})).status,409);}finally{rejectBinding=false;}
  failAttemptAudit=true;try{assert.equal((await fetch(base+'/api/master/prices',{headers})).status,503);}finally{failAttemptAudit=false;}
});

test('secondary price indicator POST is audited and other writes stay closed', async t => {
  const app=express(); app.use(express.json()); app.use((req,res,next)=>db.runWithTarget('onprem',next,'secondary'));
  const router=express.Router();router.post('/price-indicator',requireAuth,requireCapability('so.create'),(req,res)=>res.json({mapped:req.user.identityMapping.businessEffectiveUserId}));
  router.post('/',requireAuth,(_req,res)=>res.json({ok:true}));app.use('/api/so',router);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  clearAccountStatusCache();rejectBinding=false;failAttemptAudit=false;adminCanCreate=true;
  const token=jwt.sign({sub:8,role:'SALES',actorSub:17,actorRole:'ADMIN',impersonating:true},SECRET),headers={authorization:`Bearer ${token}`,'content-type':'application/json'},base=`http://127.0.0.1:${server.address().port}/api/so`;
  const request=path=>fetch(base+path,{method:'POST',headers,body:'{}'});
  const ok=await request('/price-indicator');assert.equal(ok.status,200);assert.equal((await ok.json()).mapped,34);assert.equal(attemptedAudit.inputs.path,'/api/so/price-indicator');
  assert.equal((await request('/')).status,409);
  rejectBinding=true;try{assert.equal((await request('/price-indicator')).status,409);}finally{rejectBinding=false;}
  failAttemptAudit=true;try{assert.equal((await request('/price-indicator')).status,503);}finally{failAttemptAudit=false;}
});

test('secondary giveaway self reads require mapped identity and audit, other ID filters stay closed', async t => {
  const app=express();app.use((req,res,next)=>db.runWithTarget('onprem',next,'secondary'));
  for(const [mount,path] of [['/api/master','/giveaway-goods'],['/api/giveaway','/my-quota']]) {const r=express.Router();r.get(path,requireAuth,(req,res)=>res.json({mapped:req.user.identityMapping.businessEffectiveUserId}));app.use(mount,r);}
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  clearAccountStatusCache();rejectBinding=false;failAttemptAudit=false;adminCanCreate=true;
  const token=jwt.sign({sub:8,role:'SALES',actorSub:17,actorRole:'ADMIN',impersonating:true},SECRET),headers={authorization:`Bearer ${token}`},base=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['/api/master/giveaway-goods?salesUserId=8','/api/giveaway/my-quota?year=2026&salesUserId=8']) {const r=await fetch(base+path,{headers});assert.equal(r.status,200);assert.equal((await r.json()).mapped,34);assert.equal(attemptedAudit.inputs.effective,8);}
  for(const path of ['/api/master/giveaway-goods?salesUserId=9','/api/master/giveaway-goods?excludeSoId=3','/api/giveaway/my-quota?salesUserId=9'])assert.equal((await fetch(base+path,{headers})).status,409);
  rejectBinding=true;try{assert.equal((await fetch(base+'/api/giveaway/my-quota',{headers})).status,409);}finally{rejectBinding=false;}
  failAttemptAudit=true;try{assert.equal((await fetch(base+'/api/master/giveaway-goods',{headers})).status,503);}finally{failAttemptAudit=false;}
});

test('secondary sales transport, customer top goods and truck plates require mapping and audit', async t => {
  const app=express();app.use((req,res,next)=>db.runWithTarget('onprem',next,'secondary'));const r=express.Router();
  r.get(['/transports','/customers/:id/top-goods','/truck-plates'],requireAuth,(req,res)=>res.json({mapped:req.user.identityMapping.businessEffectiveUserId}));app.use('/api/master',r);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  clearAccountStatusCache();rejectBinding=false;failAttemptAudit=false;adminCanCreate=true;
  const token=jwt.sign({sub:8,role:'SALES',actorSub:17,actorRole:'ADMIN',impersonating:true},SECRET),headers={authorization:`Bearer ${token}`},base=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['/api/master/transports','/api/master/customers/123/top-goods','/api/master/truck-plates']) {const response=await fetch(base+path,{headers});assert.equal(response.status,200);assert.equal((await response.json()).mapped,34);assert.equal(attemptedAudit.inputs.path,path);}
  assert.equal((await fetch(base+'/api/master/customers/nope/top-goods',{headers})).status,409);
  rejectBinding=true;try{assert.equal((await fetch(base+'/api/master/transports',{headers})).status,409);}finally{rejectBinding=false;}
});

test('secondary native approver reads are mapped and audited; writes remain closed', async t => {
  const app = express(); app.use((req, res, next) => db.runWithTarget('onprem', next, 'secondary'));
  let reached = 0; const router = express.Router();
  router.get('/', requireAuth, (_req, res) => { reached++; res.json({ok:true}); });
  router.get('/history', requireAuth, (_req, res) => { reached++; res.json({ok:true}); });
  router.put('/:empId', requireAuth, (_req, res) => { reached++; res.json({ok:true}); });
  app.use('/api/master/native-approvers', router);
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close()); clearAccountStatusCache(); rejectBinding = false;
  const admin = jwt.sign({sub:17, role:'ADMIN'}, SECRET);
  const headers = {authorization:`Bearer ${admin}`};
  for (const path of ['/', '/history']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/master/native-approvers${path}`, {headers});
    assert.equal(response.status, 200);
    assert.equal(attemptedAudit.inputs.actor, 17); assert.equal(attemptedAudit.inputs.effective, 17);
    assert.equal(attemptedAudit.inputs.businessActor, 47); assert.equal(attemptedAudit.inputs.businessEffective, 47);
  }
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/master/native-approvers/3`, {method:'PUT', headers})).status,409);
  const accounting = jwt.sign({sub:22, role:'ACCOUNTING', actorSub:17, actorRole:'ADMIN', impersonating:true}, SECRET);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/master/native-approvers/`, {headers:{authorization:`Bearer ${accounting}`}})).status,409);
  rejectBinding = true;
  try { assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/master/native-approvers/`, {headers})).status,409); }
  finally { rejectBinding = false; }
  failAttemptAudit = true;
  try { assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/master/native-approvers/history`, {headers})).status,503); }
  finally { failAttemptAudit = false; }
  assert.equal(reached,2);
});

test('secondary credit status requires mapping and pre-read audit and cannot open other credit routes', async t => {
  const app=express();app.use((req,res,next)=>db.runWithTarget('onprem',next,'secondary'));
  let reached=0;const router=express.Router();
  router.get('/:id/status',requireAuth,(req,res)=>{reached++;res.json({mapped:req.user.identityMapping.businessEffectiveUserId});});
  router.get('/:id/history',requireAuth,(_req,res)=>{reached++;res.json({ok:true});});
  router.put('/:id',requireAuth,(_req,res)=>{reached++;res.json({ok:true});});app.use('/api/credit',router);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  clearAccountStatusCache();rejectBinding=false;failAttemptAudit=false;
  const token=jwt.sign({sub:22,role:'ACCOUNTING',actorSub:17,actorRole:'ADMIN',impersonating:true},SECRET);
  const headers={authorization:`Bearer ${token}`};
  const result=await fetch(`http://127.0.0.1:${server.address().port}/api/credit/123/status?amount=100`,{headers});
  assert.equal(result.status,200);assert.equal((await result.json()).mapped,34);assert.equal(attemptedAudit.inputs.path,'/api/credit/123/status');
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/credit/abc/status`,{headers})).status,409);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/credit/123/history`,{headers})).status,409);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/credit/123`,{method:'PUT',headers})).status,409);
  rejectBinding=true;
  try {assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/credit/123/status`,{headers})).status,409);} finally {rejectBinding=false;}
  failAttemptAudit=true;
  try {assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/credit/123/status`,{headers})).status,503);} finally {failAttemptAudit=false;}
  assert.equal(reached,1);
});

test('secondary shipment rebate reads require feature, mapping and durable pre-read audit', async t => {
  const previous=process.env.REBATE_POOL_103_ENABLED;
  t.after(()=>{ if(previous===undefined) delete process.env.REBATE_POOL_103_ENABLED; else process.env.REBATE_POOL_103_ENABLED=previous; });
  const app=express();app.use((req,res,next)=>db.runWithTarget('onprem',next,'secondary'));
  let reached=0;const router=express.Router();
  router.get('/customers',requireAuth,(req,res)=>{reached++;res.json({mapped:req.user.identityMapping.businessEffectiveUserId});});
  router.get('/queue/:id',requireAuth,(req,res)=>{reached++;res.json({mapped:req.user.identityMapping.businessEffectiveUserId});});
  router.get('/ledger',requireAuth,(_req,res)=>{reached++;res.json({ok:true});});
  router.post('/customers',requireAuth,(_req,res)=>{reached++;res.json({ok:true});});
  app.use('/api/rebate-pool',router);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  clearAccountStatusCache();rejectBinding=false;failAttemptAudit=false;
  const token=jwt.sign({sub:22,role:'ACCOUNTING',actorSub:17,actorRole:'ADMIN',impersonating:true},SECRET);
  const headers={authorization:`Bearer ${token}`}, url=`http://127.0.0.1:${server.address().port}/api/rebate-pool`;
  process.env.REBATE_POOL_103_ENABLED='false';
  assert.equal((await fetch(`${url}/customers`,{headers})).status,409);
  assert.equal((await fetch(`${url}/queue/123`,{headers})).status,409);
  process.env.REBATE_POOL_103_ENABLED='true';
  for(const path of ['/customers','/queue/123']) {
    const result=await fetch(`${url}${path}`,{headers});assert.equal(result.status,200);
    assert.equal((await result.json()).mapped,34);assert.equal(attemptedAudit.inputs.path,`/api/rebate-pool${path}`);
    assert.equal(attemptedAudit.inputs.actor,17);assert.equal(attemptedAudit.inputs.effective,22);
    assert.equal(attemptedAudit.inputs.businessActor,47);assert.equal(attemptedAudit.inputs.businessEffective,34);
  }
  for(const path of ['/queue/abc','/ledger']) assert.equal((await fetch(`${url}${path}`,{headers})).status,409);
  assert.equal((await fetch(`${url}/customers`,{method:'POST',headers})).status,409);
  const sales=jwt.sign({sub:8,role:'SALES',actorSub:17,actorRole:'ADMIN',impersonating:true},SECRET);
  assert.equal((await fetch(`${url}/customers`,{headers:{authorization:`Bearer ${sales}`}})).status,409);
  rejectBinding=true;
  try {assert.equal((await fetch(`${url}/customers`,{headers})).status,409);} finally {rejectBinding=false;}
  failAttemptAudit=true;
  try {assert.equal((await fetch(`${url}/queue/123`,{headers})).status,503);} finally {failAttemptAudit=false;}
  assert.equal(reached,2);
});

test('secondary bill rebate balance allows only numeric shipment-backed reads with mapping and audit', async t => {
  const previous=process.env.REBATE_POOL_103_ENABLED;
  t.after(()=>{if(previous===undefined)delete process.env.REBATE_POOL_103_ENABLED;else process.env.REBATE_POOL_103_ENABLED=previous;});
  const app=express();app.use((req,res,next)=>db.runWithTarget('onprem',next,'secondary'));
  let reached=0;const router=express.Router();router.get('/rebate-balance/:id',requireAuth,(req,res)=>{reached++;res.json({mapped:req.user.identityMapping.businessEffectiveUserId});});
  app.use('/api/so',router);const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  clearAccountStatusCache();rejectBinding=false;failAttemptAudit=false;
  const token=jwt.sign({sub:22,role:'ACCOUNTING',actorSub:17,actorRole:'ADMIN',impersonating:true},SECRET);
  const headers={authorization:`Bearer ${token}`},url=`http://127.0.0.1:${server.address().port}/api/so/rebate-balance`;
  process.env.REBATE_POOL_103_ENABLED='false';assert.equal((await fetch(`${url}/123`,{headers})).status,409);
  process.env.REBATE_POOL_103_ENABLED='true';const response=await fetch(`${url}/123`,{headers});
  assert.equal(response.status,200);assert.equal((await response.json()).mapped,34);
  assert.equal(attemptedAudit.inputs.path,'/api/so/rebate-balance/123');
  assert.equal((await fetch(`${url}/abc`,{headers})).status,409);
  rejectBinding=true;try{assert.equal((await fetch(`${url}/123`,{headers})).status,409);}finally{rejectBinding=false;}
  failAttemptAudit=true;try{assert.equal((await fetch(`${url}/123`,{headers})).status,503);}finally{failAttemptAudit=false;}
  assert.equal(reached,1);
});

test('secondary sales rebate availability is boolean-only and requires a reviewed mapping', async t => {
  const previous=process.env.REBATE_POOL_103_ENABLED;
  t.after(()=>{if(previous===undefined)delete process.env.REBATE_POOL_103_ENABLED;else process.env.REBATE_POOL_103_ENABLED=previous;});
  const app=express();app.use((req,res,next)=>db.runWithTarget('onprem',next,'secondary'));
  let reached=0;const router=express.Router();
  router.get('/rebate-availability/:id',requireAuth,requireCapability('so.create'),(req,res)=>{reached++;res.json({hasAvailableRebate:true,mapped:req.user.identityMapping.businessEffectiveUserId});});
  router.get('/rebate-balance/:id',requireAuth,(_req,res)=>{reached++;res.json({amount:100});});app.use('/api/so',router);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  clearAccountStatusCache();rejectBinding=false;failAttemptAudit=false;
  const token=jwt.sign({sub:8,role:'SALES',actorSub:17,actorRole:'ADMIN',impersonating:true},SECRET);
  const headers={authorization:`Bearer ${token}`},url=`http://127.0.0.1:${server.address().port}/api/so`;
  process.env.REBATE_POOL_103_ENABLED='false';assert.equal((await fetch(`${url}/rebate-availability/123`,{headers})).status,409);
  process.env.REBATE_POOL_103_ENABLED='true';const response=await fetch(`${url}/rebate-availability/123`,{headers});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{hasAvailableRebate:true,mapped:34});
  assert.equal(attemptedAudit.inputs.path,'/api/so/rebate-availability/123');
  assert.equal((await fetch(`${url}/rebate-availability/abc`,{headers})).status,409);
  assert.equal((await fetch(`${url}/rebate-balance/123`,{headers})).status,409);
  adminCanCreate=false;clearAccountStatusCache();
  try{assert.equal((await fetch(`${url}/rebate-availability/123`,{headers})).status,409);}finally{adminCanCreate=true;clearAccountStatusCache();}
  rejectBinding=true;try{assert.equal((await fetch(`${url}/rebate-availability/123`,{headers})).status,409);}finally{rejectBinding=false;}
  failAttemptAudit=true;try{assert.equal((await fetch(`${url}/rebate-availability/123`,{headers})).status,503);}finally{failAttemptAudit=false;}
  assert.equal(reached,1);
});

test('Access As switching from a simulated secondary database reads and audits only the primary identity database', async t => {
  const app=express();app.use(express.json());
  app.use((req,res,next)=>db.runWithTarget('onprem',next,'secondary'));
  app.use('/api/auth',require('../routes/auth'));
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  clearAccountStatusCache();checked.length=0;accessAsWrites=[];
  const token=jwt.sign({sub:22,id:22,role:'ACCOUNTING',actorSub:17,actorRole:'ADMIN',impersonating:true},SECRET);
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/auth/access-as`,{
    method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({userId:8}),
  });
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  assert.ok((await response.json()).accessToken);
  assert.deepEqual(checked.filter(c=>c.kind==='user').map(c=>[c.database,c.id]).sort(),[['primary',17],['primary',8]].sort());
  assert.deepEqual(accessAsWrites.map(c=>[c.database,c.action,c.actorUserId,c.effectiveUserId]),[
    ['primary','STOP',17,22],['primary','START',17,8],
  ]);
});

test('Access As preserves the selected database and refuses silent fallback when the effective role cannot switch', async t => {
  const targetModule=require('../onprem-target');const prior=targetModule.isSwitchableDb;
  targetModule.isSwitchableDb=name=>name==='secondary';t.after(()=>{targetModule.isSwitchableDb=prior;});
  const app=express();app.use(express.json());app.use((req,res,next)=>db.runWithTarget('onprem',next,'primary'));
  app.use('/api/auth',require('../routes/auth'));
  const business=express.Router();let reached=false;
  business.get('/stats',requireAuth,(_req,res)=>{reached=true;res.json({ok:true});});app.use('/api/so',business);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  clearAccountStatusCache();
  const initial=jwt.sign({sub:22,id:22,role:'ACCOUNTING',actorSub:17,actorRole:'ADMIN',impersonating:true,db:'secondary'},SECRET);
  const start=await fetch(`http://127.0.0.1:${server.address().port}/api/auth/access-as`,{
    method:'POST',headers:{authorization:`Bearer ${initial}`,'content-type':'application/json'},body:JSON.stringify({userId:8}),
  });
  assert.equal(start.status,200);const token=(await start.json()).accessToken;assert.equal(jwt.verify(token,SECRET).db,'secondary');
  const denied=await fetch(`http://127.0.0.1:${server.address().port}/api/so/stats`,{headers:{authorization:`Bearer ${token}`}});
  assert.equal(denied.status,403);assert.equal((await denied.json()).code,'DB_RESTRICTED');assert.equal(reached,false);
  const picker=await fetch(`http://127.0.0.1:${server.address().port}/api/auth/databases`,{headers:{authorization:`Bearer ${token}`}});
  assert.equal(picker.status,200);
  const info=await picker.json();assert.equal(info.active,'secondary');assert.equal(info.selectionBlocked,true);assert.equal(info.canSwitch,false);
  const stop=await fetch(`http://127.0.0.1:${server.address().port}/api/auth/access-as/stop`,{method:'POST',headers:{authorization:`Bearer ${token}`}});
  assert.equal(stop.status,200);assert.equal(jwt.verify((await stop.json()).accessToken,SECRET).db,'secondary');
});

test('a no-longer-allowlisted selected database is rejected before reaching the default database', async t => {
  const targetModule=require('../onprem-target');const prior=targetModule.isSwitchableDb;
  targetModule.isSwitchableDb=()=>false;t.after(()=>{targetModule.isSwitchableDb=prior;});
  const app=express();app.use((req,res,next)=>db.runWithTarget('onprem',next,'primary'));
  const business=express.Router();let reached=false;
  business.get('/stats',requireAuth,(_req,res)=>{reached=true;res.json({ok:true});});app.use('/api/so',business);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  clearAccountStatusCache();
  const token=jwt.sign({sub:17,id:17,role:'ADMIN',db:'secondary'},SECRET);
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/so/stats`,{headers:{authorization:`Bearer ${token}`}});
  assert.equal(response.status,403);assert.equal((await response.json()).code,'DB_RESTRICTED');assert.equal(reached,false);
});

test('denied Access As on a secondary database audits the requested database, not the identity anchor', async t => {
  const app=express();app.use((req,res,next)=>db.runWithTarget('onprem',next,'primary'));app.use(apiAudit());
  const business=express.Router();business.get('/stats',requireAuth,(_req,res)=>res.json({ok:true}));app.use('/api/so',business);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  clearAccountStatusCache();
  const token=jwt.sign({sub:8,id:8,role:'SALES',actorSub:17,actorRole:'ADMIN',impersonating:true,db:'secondary'},SECRET);
  const audited=new Promise(resolve=>{auditDone=resolve;});
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/so/stats`,{headers:{authorization:`Bearer ${token}`}});
  assert.equal(response.status,403);assert.equal((await response.json()).code,'DB_RESTRICTED');
  await Promise.race([audited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('audit timeout')),2000))]);
  assert.equal(auditEvent.database,'primary');assert.equal(auditEvent.inputs.businessDatabase,'secondary');
  assert.equal(auditEvent.inputs.actorUserId,17);assert.equal(auditEvent.inputs.effectiveUserId,8);
  assert.equal(auditEvent.inputs.businessActorUserId,null);assert.equal(auditEvent.inputs.businessEffectiveUserId,null);
});

test('real SO list on a secondary database receives reviewed identities and the global date boundary', async t => {
  const app = express();
  app.use((req, res, next) => db.runWithTarget('onprem', next, 'secondary'));
  app.use('/api/so', require('../routes/so'));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  clearAccountStatusCache(); mappingCalls = []; rejectBinding = false;
  const before = dbCalls.length;
  const token = jwt.sign({ sub: 22, id: 22, role: 'ACCOUNTING', actorSub: 17, actorRole: 'ADMIN', impersonating: true }, SECRET);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/so`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(mappingCalls.length, 1);
  const query = dbCalls.slice(before).find(c => /WITH Orders AS/.test(c.text));
  assert.ok(query); assert.match(query.text, /hd\.DocuDate >= @globalStartDate/);
  assert.match(query.text, /so\.CreatedAt >= @globalStartUtc/);
});
