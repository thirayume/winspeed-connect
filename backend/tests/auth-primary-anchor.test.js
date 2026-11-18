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
const { stub: db, calls: dbCalls } = h.installDbStub(({ text, inputs }) => {
  const database = context.getStore()?.database;
  if (/SELECT OBJECT_ID\('wf\.ApiAuditLog'/.test(text)) return [{ ObjectId: 1, IdentityColumn: 256, BusinessColumn: 256, BusinessActorColumn: 1, BusinessEffectiveColumn: 1, IdentityServerColumn: 1, BusinessServerColumn: 1 }];
  if (/INSERT INTO wf\.ApiAuditLog/.test(text)) { auditEvent = { database, inputs }; auditDone?.(); return []; }
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
    return [{ Code: role, BaseRole: role, PermissionCode: role === 'ADMIN' ? 'access-as' : role === 'ACCOUNTING' ? 'invoice.post-native' : 'so.create' }];
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
      businessActorUserId: 47, businessEffectiveUserId: 34, actorRevision: 1, effectiveRevision: 1,
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
