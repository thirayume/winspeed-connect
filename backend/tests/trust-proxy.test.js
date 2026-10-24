'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { trustProxyHops } = require('../services/trust-proxy');

test('TRUST_PROXY counts the proxies in front of the API', () => {
  assert.equal(trustProxyHops(undefined), false);
  assert.equal(trustProxyHops(''), false);
  assert.equal(trustProxyHops('0'), false);
  assert.equal(trustProxyHops('1'), 1);
  assert.equal(trustProxyHops(' 2 '), 2);
});

test('trusting every hop or a free-form value is refused', () => {
  const warnings = [];
  for (const v of ['true', 'TRUE', 'loopback', '10.0.0.0/8', '-1', '1,2', '999']) {
    assert.equal(trustProxyHops(v, m => warnings.push(m)), false, v);
  }
  assert.equal(warnings.length, 7);
});

test('the Compose stacks trust exactly their one Caddy hop', () => {
  const compose = fs.readFileSync(path.join(__dirname, '..', '..', 'docker-compose.yml'), 'utf8');
  assert.match(compose, /^\s+TRUST_PROXY: "1"$/m);
});
