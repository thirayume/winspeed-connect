'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const express = require('express');
const cors = require('cors');

// Exercise the server's actual CORS configuration without starting its DB pools
// or background workers. This covers the cross-origin development topology.
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const begin = source.indexOf('const rawOrigins =');
const end = source.indexOf('app.use(cors(corsOptions));', begin);
assert.ok(begin >= 0 && end > begin);
const options = vm.runInNewContext(source.slice(begin, end) + '\ncorsOptions;', {
  process: { env: { CORS_ORIGIN: 'http://localhost:5173,http://127.0.0.1:5173' } },
});

let server;
let base;
test.before(async () => {
  const app = express();
  app.use(cors(options));
  app.get('/api/so', (req, res) => res.json({ branch: req.get('X-Org-Branch') }));
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); });

test('selected organization branch passes the browser preflight from localhost', async () => {
  const response = await fetch(base + '/api/so', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,x-db-target,x-org-branch',
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  const allowed = response.headers.get('access-control-allow-headers').toLowerCase().split(/,\s*/);
  for (const header of ['authorization', 'x-db-target', 'x-org-branch']) assert.ok(allowed.includes(header), header);
});

test('organization branch header reaches the requested endpoint', async () => {
  const response = await fetch(base + '/api/so', {
    headers: { Origin: 'http://localhost:5173', 'X-Org-Branch': 'SALE-TEST' },
  });
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.deepEqual(await response.json(), { branch: 'SALE-TEST' });
});

test('allowing the branch header does not widen the configured origins', async () => {
  const response = await fetch(base + '/api/so', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://unlisted.example',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'x-org-branch',
    },
  });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});
