'use strict';

/**
 * route-harness.cjs — drive real Express routers over HTTP with a stubbed DB.
 *
 * Usage (install the stub BEFORE requiring any route or service module, because
 * they destructure db functions at load time):
 *
 *   const h = require('./helpers/route-harness.cjs');
 *   const db = h.installDbStub((call) => { ... return rows or { recordset, rowsAffected } ... });
 *   const app = await h.startApp([['/api/so', '../../routes/so']]);
 *   const r = await app.call('POST', '/api/so', { body, user: { sub: 7, role: 'SALES' } });
 *   await app.close();
 *
 * The handler receives { kind, text, inputs, proc } for every statement:
 *   kind = 'wfQuery' | 'query' | 'dboWrite' | 'tx' | 'proc'
 * and returns an array (recordset) or an object { recordset, rowsAffected, output }.
 * Every call is recorded in db.calls for assertions.
 */

const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

const dbPath = require.resolve('../../db');

function normalizeResult(r) {
  if (r && !Array.isArray(r) && typeof r === 'object' && ('recordset' in r || 'rowsAffected' in r || 'output' in r)) {
    const recordset = r.recordset || [];
    return { recordset, recordsets: [recordset], rowsAffected: r.rowsAffected || [recordset.length], output: r.output || {} };
  }
  const recordset = Array.isArray(r) ? r : [];
  return { recordset, recordsets: [recordset], rowsAffected: [recordset.length], output: {} };
}

function installDbStub(handler) {
  const realDb = require('../../db');
  const calls = [];
  const run = async (kind, text, inputs = {}, proc = null) => {
    const call = { kind, text: String(text || ''), inputs: { ...inputs }, proc };
    calls.push(call);
    const out = await handler(call);
    return normalizeResult(out);
  };
  const plainInputs = (inputs = {}) => Object.fromEntries(
    Object.entries(inputs).map(([k, v]) => [k, v && typeof v === 'object' && 'value' in v ? v.value : v])
  );

  function makeRequest() {
    const inputs = {};
    return {
      input(name, typeOrValue, value) { inputs[name] = arguments.length >= 3 ? value : typeOrValue; return this; },
      output(name) { inputs[name] = inputs[name] ?? null; return this; },
      query(text) { return run('tx', text, inputs); },
      execute(proc) { return run('proc', `EXEC ${proc}`, inputs, proc); },
    };
  }
  const tx = { request: makeRequest };

  // Copy plain exports only: spreading db.js would call its pool getters (readerPool …)
  // and open real connections that keep the test process alive.
  const plainExports = {};
  for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(realDb))) {
    if ('value' in d) plainExports[k] = d.value;
  }
  const stub = {
    ...plainExports,
    pools: () => { throw new Error('route-harness: real DB pools are not available in tests'); },
    wfQuery: (text, inputs) => run('wfQuery', text, plainInputs(inputs)),
    query: async (text, inputs) => (await run('query', text, plainInputs(inputs))).recordset,
    dboWrite: (text, inputs) => run('dboWrite', text, plainInputs(inputs)),
    wfTransaction: async (fn) => fn(tx),
    runWithTarget: (_t, fn) => fn(),
    getTarget: () => 'LOCAL',
  };
  // sql.Request(tx) is used by some services: route it to the stub request
  stub.sql = new Proxy(realDb.sql, {
    get(target, key) {
      if (key === 'Request') return function Request() { return makeRequest(); };
      return target[key];
    },
  });
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: stub };
  return { calls, stub, tx };
}

function token(user) {
  const { SECRET } = require('../../middleware/auth');
  const sub = user.sub ?? user.id ?? 1;
  return jwt.sign({
    sub, id: sub, role: user.role, username: user.username || `u${sub}`,
    displayName: user.displayName || `User ${sub}`,
    actorSub: user.actorSub ?? sub, actorRole: user.actorRole || user.role,
  }, SECRET, { expiresIn: '10m' });
}

async function startApp(mounts) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  for (const [mount, modPath] of mounts) {
    app.use(mount, require(path.resolve(__dirname, modPath)));
  }
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    async call(method, url, { body, user } = {}) {
      const headers = { 'content-type': 'application/json' };
      if (user) headers.authorization = `Bearer ${token(user)}`;
      const res = await fetch(`http://127.0.0.1:${port}${url}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      return { status: res.status, body: json };
    },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

module.exports = { installDbStub, startApp, token };
