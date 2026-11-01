'use strict';

/**
 * scripts/uat-full-loop.cjs is the operator's Full Loop on a restored UAT clone. It needs a live database, so
 * CI checks only what must hold before it reaches one: it refuses a bad configuration without loading db.js,
 * refuses anything but a UAT database name, and the public repository holds no fixture or document number.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'scripts', 'uat-full-loop.cjs');
const good = {
  UAT_LOOP_PHASE: 'prepare', UAT_LOOP_RUN: 'CI-CONFIG-CHECK', UAT_LOOP_DB: 'some_db_uat',
  UAT_LOOP_CUST_ID: '1', UAT_LOOP_GOOD_ID: '2', UAT_LOOP_NET_PRICE: '3', UAT_LOOP_EMP_ID: '4',
};

function run(overrides) {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...good, ...overrides };
  return spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 20000 });
}

test('refuses a bad configuration before it can reach a database', () => {
  const cases = [
    [{ UAT_LOOP_PHASE: 'nope' }, 'UAT_LOOP_PHASE_INVALID'],
    [{ UAT_LOOP_RUN: '' }, 'UAT_LOOP_RUN_INVALID'],
    [{ UAT_LOOP_DB: 'dbwins_worldfert9' }, 'UAT_LOOP_DB_NOT_UAT'],
    [{ UAT_LOOP_DB: 'dbwins_worldfert2' }, 'UAT_LOOP_DB_NOT_UAT'],
    [{ UAT_LOOP_CUST_ID: '' }, 'UAT_LOOP_FIXTURES_REQUIRED'],
    [{ UAT_LOOP_EMP_ID: 'abc' }, 'UAT_LOOP_FIXTURES_REQUIRED'],
  ];
  for (const [overrides, code] of cases) {
    const r = run(overrides);
    assert.equal(r.status, 2, code);
    assert.match(r.stdout, new RegExp('FAILED ' + code));
  }
});

test('the script and its scale-record SQL hold no fixture ids or document numbers', () => {
  const sqlFile = path.join(__dirname, '..', '..', 'docs', 'deploy', 'r740', 'sql', 'uat-simulated-scale-record.sql');
  for (const file of [script, sqlFile]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\b[ACDIJKN]{1,2}\d{2}-?\d{4,5}\b/, file + ': document number');
    assert.doesNotMatch(text, /\b99\d{5}\b/, file + ': test slip number');
  }
  const source = fs.readFileSync(script, 'utf8');
  assert.doesNotMatch(source, /require\('\/app\//, 'must not depend on a private copy path');
  assert.doesNotMatch(source, /PasswordHash[^\n]*'\$2[aby]\$/, 'no stored hash');
});
