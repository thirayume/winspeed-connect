'use strict';

/**
 * UAT dry run 2026-11-03: screens send ids as numbers and the Linux driver refuses a number in a text parameter.
 * The fix sits where every request binds its parameters, so no route can repeat it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { sql } = require('../db');

const bound = (type, value) => new sql.Request().input('p', type, value).parameters.p.value;

test('a number bound to a text parameter arrives as text', () => {
  assert.strictEqual(bound(sql.NVarChar(20), 1114), '1114');
  assert.strictEqual(bound(sql.VarChar(50), 289026), '289026');
  assert.strictEqual(bound(sql.NVarChar, 7), '7');
});

test('everything else is bound as before', () => {
  assert.strictEqual(bound(sql.Int, 1114), 1114);
  assert.strictEqual(bound(sql.NVarChar(20), 'abc'), 'abc');
  assert.strictEqual(bound(sql.NVarChar(20), null), null);
  assert.strictEqual(bound(sql.NVarChar(20), undefined), null);
});
