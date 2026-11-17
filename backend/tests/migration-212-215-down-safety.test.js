'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../migrations/down');
const down = (number) => {
  const file = fs.readdirSync(root).find(name => name.startsWith(`${number}_`) && name.endsWith('.down.sql'));
  assert.ok(file, `missing ${number} down script`);
  return fs.readFileSync(path.join(root, file), 'utf8');
};
test('212 never guesses which permission grants to revoke', () => {
  const sql=down(212);
  assert.match(sql, /provenance is unknown/i);
  assert.doesNotMatch(sql, /\bDELETE\s+(?:FROM\s+)?wf\.RolePermission/i);
});
test('213-215 require explicit provenance review and wrap DDL in a rollback-capable transaction', () => {
  for (const n of [213,214,215]) {
    const sql=down(n);
    assert.match(sql, /@ConfirmedProvenance\s+bit\s*=\s*0/i);
    assert.match(sql, /IF\s+@ConfirmedProvenance\s*<>\s*1[\s\S]*?RETURN/i);
    assert.match(sql, /BEGIN TRANSACTION/i); assert.match(sql, /ROLLBACK TRANSACTION/i);
    assert.doesNotMatch(sql, /\b(?:DELETE|TRUNCATE)\s+(?:FROM\s+)?wf\./i);
  }
});
test('213 and 214 refuse to discard populated journals or identity evidence', () => {
  const a=down(213), b=down(214);
  for (const name of ['RebateConversionApprovalRequest','BusinessActorId','BusinessEffectiveId']) assert.ok(a.includes(name));
  for (const name of ['RebateResetBootstrapTarget','RebateResetBootstrap','BootstrapId']) assert.ok(b.includes(name));
  assert.ok((a.match(/IF @n > 0 RAISERROR/g)||[]).length >= 3);
  assert.ok((b.match(/IF @n > 0 RAISERROR/g)||[]).length >= 3);
});
