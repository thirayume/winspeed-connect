'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const h = require('./helpers/route-harness.cjs');
h.installDbStub(() => []);

let user;
let actorRestricted = false;
let effectiveRestricted = false;
const middlewarePath = require.resolve('../middleware/auth');
require.cache[middlewarePath] = { id: middlewarePath, filename: middlewarePath, loaded: true, exports: {
  requireAuth: (req, _res, next) => { req.user = user; req.tokenPayload = { sub: user.sub }; next(); },
  requireRole: () => (_req, _res, next) => next(),
  requireCapability: () => (_req, _res, next) => next(),
  passwordChangeEnforced: (_req, _res, next) => next(), SECRET: 'test-secret', clearAccountStatusCache: () => {},
} };
const activePath = require.resolve('../services/active-database');
require.cache[activePath] = { id: activePath, filename: activePath, loaded: true, exports: {
  systemActiveDatabase: async () => 'primary', primaryDatabase: () => 'primary',
  listSwitchableDatabases: async () => ['primary', 'secondary'], getDatabaseThemes: async () => ({}),
  resolveTheme: name => ({ label: name, restrictedRoles: [] }),
  canAccessDatabase: (name, who) => !(name === 'secondary' && ((actorRestricted && who.role === 'ADMIN') || (effectiveRestricted && who.role === 'SALES'))),
} };

let server, base;
test.before(async () => {
  const app = express(); app.use(express.json()); app.use('/api/auth', require('../routes/auth'));
  server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/auth`;
});
test.after(() => new Promise(resolve => server.close(resolve)));
async function call(path, body) {
  const response = await fetch(base + path, body === undefined ? {} : { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
  return { status:response.status, body:await response.json() };
}
function impersonated(actorPermissions = ['database.switch']) {
  return { sub:2, role:'SALES', permissions:['database.switch'], isImpersonating:true,
    actorRole:'ADMIN', actorRoles:['ADMIN'], actorPermissions };
}
test('Access As requires actor and effective database scope in picker and switch', async () => {
  user = impersonated(); actorRestricted = true;
  const picker = await call('/databases');
  assert.equal(picker.status, 200); assert.deepEqual(picker.body.list, ['primary']);
  assert.equal(picker.body.metaList.find(x => x.name === 'secondary').isAllowed, false);
  const switched = await call('/switch-database', { database:'secondary' });
  assert.equal(switched.status, 403); assert.equal(switched.body.code, 'DB_RESTRICTED');
});
test('Access As needs database.switch permission for both identities', async () => {
  user = impersonated([]); actorRestricted = false;
  const picker = await call('/databases'); assert.equal(picker.body.canSwitch, false); assert.deepEqual(picker.body.list, []);
  const switched = await call('/switch-database', { database:'secondary' });
  assert.equal(switched.status, 403); assert.equal(switched.body.code, 'FORBIDDEN');
});
test('Access As can switch when both identities have permission and database scope', async () => {
  user = impersonated(); actorRestricted = false;
  const picker = await call('/databases'); assert.deepEqual(picker.body.list, ['primary', 'secondary']);
  const switched = await call('/switch-database', { database:'secondary' });
  assert.equal(switched.status, 200); assert.equal(switched.body.database, 'secondary');
});
test('Access As is denied when the effective user lacks database scope', async () => {
  user = impersonated(); actorRestricted = false; effectiveRestricted = true;
  const picker = await call('/databases'); assert.deepEqual(picker.body.list, ['primary']);
  const switched = await call('/switch-database', { database:'secondary' });
  assert.equal(switched.status, 403); assert.equal(switched.body.code, 'DB_RESTRICTED');
  effectiveRestricted = false;
});
test('ordinary users can still switch when their own permission and scope allow it', async () => {
  user = { sub:2, role:'SALES', permissions:['database.switch'], isImpersonating:false }; actorRestricted = false; effectiveRestricted = false;
  const picker = await call('/databases'); assert.deepEqual(picker.body.list, ['primary', 'secondary']);
  const switched = await call('/switch-database', { database:'secondary' });
  assert.equal(switched.status, 200); assert.equal(switched.body.database, 'secondary');
});
