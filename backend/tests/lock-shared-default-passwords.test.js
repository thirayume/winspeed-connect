'use strict';

/**
 * Owner 2026-10-24 (option A): migration 049 seeded every employee account with one shared default
 * password and 071 left them MustChangePassword = 0. Migration 154 locks the accounts still on it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'migrations');
const read = file => fs.readFileSync(path.join(dir, file), 'utf8');
const BCRYPT = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g;
const seeded = [...new Set(read('049_giveaway_item_mapping_seed.sql').match(BCRYPT))];
const lock = read('154_lock_shared_default_passwords.sql');

test('049 seeds exactly one shared hash, and 154 matches that hash', () => {
  assert.equal(seeded.length, 1);
  const where = /WHERE\s+PasswordHash\s*=\s*N'([^']+)'/i.exec(lock);
  assert.ok(where, '154 selects accounts by their password hash');
  assert.equal(where[1], seeded[0]);
});

test('154 locks the account and replaces the hash with an unknown bcrypt', () => {
  const set = /SET\s+PasswordHash\s*=\s*N'([^']+)'/i.exec(lock);
  assert.ok(set);
  assert.match(set[1], /^\$2b\$12\$[./A-Za-z0-9]{53}$/);
  assert.notEqual(set[1], seeded[0]);
  assert.match(lock, /IsActive\s*=\s*0/);
  assert.match(lock, /MustChangePassword\s*=\s*1/);
  assert.match(lock, /^--\s*@transaction\b/m, 'one transaction');
});

test('154 changes only wf.AppUser, never dbo', () => {
  const code = lock.replace(/--[^\n]*/g, '');
  assert.deepEqual(code.match(/\bUPDATE\s+\S+/gi), ['UPDATE wf.AppUser']);
  assert.doesNotMatch(code, /\b(INSERT|DELETE|MERGE|ALTER|DROP|CREATE)\b/i);
  assert.doesNotMatch(code, /\bdbo\./i);
});

test('no migration after 049 brings the shared hash back', () => {
  const later = fs.readdirSync(dir).filter(f => /^\d{3}_.*\.sql$/.test(f) && f > '049_giveaway_item_mapping_seed.sql' && f !== '154_lock_shared_default_passwords.sql');
  assert.ok(later.length > 100, 'scans the later migrations');
  for (const file of later) assert.ok(!read(file).includes(seeded[0]), file);
});
