'use strict';
// Gate tests for the reviewed secondary-database reads of the sale form and control
// tickets: price lists, stock availability, policy settings and control tickets.
// Everything else on those routers, and every write, must stay closed (409).
const test = require('node:test');
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const express = require('express');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const h = require('./helpers/route-harness.cjs');

const context = new AsyncLocalStorage();
let attemptedAudit = null;
let failAttemptAudit = false;
let actorCanCreate = true;
let rejectBinding = false;
const roleOf = id => (id === 17 ? 'ADMIN' : id === 22 ? 'ACCOUNTING' : id === 30 ? 'WAREHOUSE' : 'SALES');
const permissionsOf = role => (role === 'ADMIN' ? ['access-as', 'database.switch', 'trip.view', ...(actorCanCreate ? ['so.create'] : [])]
  : role === 'ACCOUNTING' ? ['database.switch'] : role === 'WAREHOUSE' ? ['database.switch', 'trip.view'] : ['so.create', 'trip.view']);

const { stub: db } = h.installDbStub(({ text, inputs }) => {
  if (/SELECT Id, Username, DisplayName, Role, RoleCode, AuthVersion/.test(text) && /FROM wf\.AppUser\s+WHERE Id = @id/.test(text)) {
    const id = Number(inputs.id);
    return [{ Id: id, Username: `test-${id}`, DisplayName: 'Fixture', Role: roleOf(id), IsActive: 1, AuthVersion: 0 }];
  }
  if (/SELECT OBJECT_ID\('wf\.ApiAuditLog'/.test(text)) return [{ ObjectId: 1, IdentityColumn: 256, BusinessColumn: 256, BusinessActorColumn: 1, BusinessEffectiveColumn: 1, IdentityServerColumn: 1, BusinessServerColumn: 1 }];
  if (/INSERT INTO wf\.ApiAuditLog/.test(text)) {
    if (/102, 0, SYSUTCDATETIME/.test(text)) {
      attemptedAudit = { database: context.getStore()?.database, inputs };
      if (failAttemptAudit) throw new Error('simulated audit failure');
    }
    return [];
  }
  if (/SELECT IsActive FROM wf\.AppUser/.test(text)) return [{ IsActive: 1 }];
  if (/AS PolicySchemaMissing/.test(text)) { const role = roleOf(Number(inputs.id)); return [{ Role: role, RoleCode: role, IsActive: 1, AuthVersion: 0 }]; }
  if (/FROM wf\.vUserRole u/.test(text)) { const role = roleOf(Number(inputs.id)); return permissionsOf(role).map(PermissionCode => ({ Code: role, BaseRole: role, PermissionCode })); }
  return [];
});
db.getTarget = () => context.getStore()?.target || 'onprem';
db.getDbName = () => context.getStore()?.database || null;
db.runWithTarget = (target, fn, database) => context.run({ target, database }, fn);
db.runWithDb = (database, fn) => context.run({ target: 'onprem', database }, fn);

const activePath = require.resolve('../services/active-database');
require.cache[activePath] = { id: activePath, filename: activePath, loaded: true, exports: {
  primaryDatabase: () => 'primary', onpremEnabled: () => true,
  systemActiveDatabase: async () => 'secondary', getDatabaseThemes: async () => ({}),
  canAccessDatabase: () => true, DEFAULT_DATABASE_THEMES: {},
} };
const resolverPath = require.resolve('../services/database-identity-resolver');
require.cache[resolverPath] = { id: resolverPath, filename: resolverPath, loaded: true, exports: {
  sqlRepository: () => ({}),
  resolveReviewedActorAndEffective: async args => {
    if (rejectBinding) throw Object.assign(new Error('invalid'), { code: 'IDENTITY_BINDING_INVALID' });
    return { primaryActorUserId: args.actorUserId, primaryEffectiveUserId: args.effectiveUserId,
      businessActorUserId: 47, businessEffectiveUserId: args.actorUserId === args.effectiveUserId ? 47 : 34,
      actorRevision: 1, effectiveRevision: 1, identityServer: 'A', businessServer: 'B' };
  },
} };
const { requireAuth, SECRET, clearAccountStatusCache } = require('../middleware/auth');

async function start(t) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => db.runWithTarget('onprem', next, 'secondary'));
  for (const mount of ['/api/stock', '/api/pricebook', '/api/master']) {
    const r = express.Router();
    r.use(requireAuth);
    r.use((req, res) => res.json({ mapped: req.user.identityMapping?.businessEffectiveUserId ?? null }));
    app.use(mount, r);
  }
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  return (path, token, method = 'GET') => fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : '{}' });
}
function reset() { clearAccountStatusCache(); attemptedAudit = null; failAttemptAudit = false; actorCanCreate = true; rejectBinding = false; }

const OPEN = ['/api/stock/atp', '/api/stock/atp?excludeSoId=5', '/api/pricebook/', '/api/pricebook/12', '/api/pricebook/12/effective?custId=77',
  '/api/master/system-settings', '/api/master/control-tickets', '/api/master/control-tickets?custId=77', '/api/master/control-tickets/alerts',
  '/api/master/control-tickets/IV6911-001', '/api/master/control-tickets/IV6911-001/draws', '/api/master/control-tickets/IV6911-001/trace',
  '/api/master/control-tickets/typed/SO/15'];
const CLOSED_GET = ['/api/stock/', '/api/pricebook/12/special', '/api/pricebook/winspeed-sets', '/api/pricebook/winspeed-sets/3/lines',
  '/api/pricebook/abc', '/api/pricebook/12/effective/extra', '/api/master/control-tickets/a/b/c', '/api/master/control-tickets/IV6911-001/expiry',
  '/api/master/control-tickets/typed/SO/abc', '/api/master/data-window', '/api/master/stats'];
const CLOSED_WRITE = [['PUT', '/api/stock/'], ['POST', '/api/stock/sync-winspeed'], ['POST', '/api/stock/atp'], ['POST', '/api/pricebook/'],
  ['PUT', '/api/pricebook/12'], ['POST', '/api/pricebook/12/special'], ['POST', '/api/pricebook/12/effective'], ['PATCH', '/api/master/system-settings'],
  ['PATCH', '/api/master/control-tickets/IV6911-001/expiry'], ['POST', '/api/master/control-tickets']];

test('sales under Access As read the sale form and control tickets on a secondary database with mapping and a pre-read audit', async t => {
  const call = await start(t); reset();
  const token = jwt.sign({ sub: 8, role: 'SALES', actorSub: 17, actorRole: 'ADMIN', impersonating: true }, SECRET);
  for (const path of OPEN) {
    attemptedAudit = null;
    const r = await call(path, token);
    assert.equal(r.status, 200, path);
    assert.equal((await r.json()).mapped, 34, path);
    assert.equal(attemptedAudit.inputs.path, path.split('?')[0], path);
    assert.equal(attemptedAudit.database, 'primary', 'the attempt is recorded on the primary database');
    assert.equal(attemptedAudit.inputs.actor, 17); assert.equal(attemptedAudit.inputs.effective, 8);
    assert.equal(attemptedAudit.inputs.businessActor, 47); assert.equal(attemptedAudit.inputs.businessEffective, 34);
  }
});

test('other routes of the same routers and every write stay closed on a secondary database', async t => {
  const call = await start(t); reset();
  const token = jwt.sign({ sub: 8, role: 'SALES', actorSub: 17, actorRole: 'ADMIN', impersonating: true }, SECRET);
  for (const path of CLOSED_GET) { attemptedAudit = null; assert.equal((await call(path, token)).status, 409, path); assert.equal(attemptedAudit, null, path); }
  for (const [method, path] of CLOSED_WRITE) { attemptedAudit = null; assert.equal((await call(path, token, method)).status, 409, `${method} ${path}`); assert.equal(attemptedAudit, null); }
});

test('both identities need the sale capability; an invalid binding or a failed audit closes the read', async t => {
  const call = await start(t); reset();
  const token = jwt.sign({ sub: 8, role: 'SALES', actorSub: 17, actorRole: 'ADMIN', impersonating: true }, SECRET);
  actorCanCreate = false; clearAccountStatusCache();
  for (const path of ['/api/stock/atp', '/api/pricebook/', '/api/master/system-settings', '/api/master/control-tickets'])
    assert.equal((await call(path, token)).status, 409, path);
  reset();
  rejectBinding = true;
  assert.equal((await call('/api/pricebook/12/effective', token)).status, 409);
  rejectBinding = false; failAttemptAudit = true;
  assert.equal((await call('/api/master/control-tickets', token)).status, 503);
  assert.equal((await call('/api/stock/atp', token)).status, 503);
});

test('accounting reads them as a privileged role; a role with neither rule stays closed', async t => {
  const call = await start(t); reset();
  const accounting = jwt.sign({ sub: 22, role: 'ACCOUNTING' }, SECRET);
  for (const path of ['/api/pricebook/', '/api/pricebook/12', '/api/master/system-settings', '/api/master/control-tickets', '/api/master/control-tickets/alerts']) {
    const r = await call(path, accounting); assert.equal(r.status, 200, path); assert.equal((await r.json()).mapped, 47);
  }
  assert.equal((await call('/api/pricebook/12/special', accounting)).status, 409);
  const warehouse = jwt.sign({ sub: 30, role: 'WAREHOUSE' }, SECRET);
  for (const path of ['/api/stock/atp', '/api/pricebook/', '/api/master/control-tickets']) assert.equal((await call(path, warehouse)).status, 409, path);
});
