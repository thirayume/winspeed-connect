'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTarget, requestTarget } = require('../db-target-policy');
test('Hostinger never silently falls back to local', () => {
  assert.equal(validateTarget('remote_b'), 'remote_b');
  assert.equal(requestTarget('remote_b', 'local', false), 'remote_b');
  assert.throws(() => validateTarget('typo'), /Unsupported/);
});
test('production stays on its configured database', () => {
  for (const target of ['local','remote','remote_b']) {
    assert.equal(requestTarget(undefined, target, true), target);
    assert.equal(requestTarget(target, target, true), target);
  }
  assert.throws(() => requestTarget('local','remote_b',true), /disabled/);
  assert.throws(() => requestTarget('remote','remote_b',true), /disabled/);
  assert.throws(() => requestTarget('unknown','remote_b',true), /Unsupported/);
});
