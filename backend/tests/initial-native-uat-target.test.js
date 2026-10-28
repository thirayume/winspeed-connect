'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
require('./helpers/route-harness.cjs').installDbStub(() => []);
const { isInitialNativeUatTarget } = require('../services/initial-native-uat-target');
const { splitBatches } = require('../run_migrations');
const { assertNoCrossDbWrite } = require('../safety-validator');
const { initialBookingAi } = require('../services/initial-booking-ai');
const { initialDelivery } = require('../services/initial-delivery');
const { initialManualRedemption } = require('../services/initial-manual-redemption');
const { initialInvoice } = require('../services/initial-invoice');

const local = { ServerName: 'AMYOU-YOGA7\\V2008R2', DbName: 'dbwins_worldfert9_uat2', DbId: 10 };
const r740 = { ServerName: 'R740-SRV\\SQL2008', DbName: 'dbwins_worldfert9-uat', DbId: 8 };
const denied = [undefined, {}, { ...r740, DbName: 'dbwins_worldfert9' },
  { ...r740, DbName: 'dbwins_worldfert2' }, { ...r740, DbId: 10 },
  { ...r740, ServerName: local.ServerName }, { ...local, DbId: 8 },
  { ...local, DbName: r740.DbName }, { ...r740, DbName: 'dbwins_worldfert9-uat-other' }];

test('only the two exact verified UAT tuples are accepted, including switched databases', () => {
  assert.equal(isInitialNativeUatTarget(local), true);
  assert.equal(isInitialNativeUatTarget(r740), true);
  for (const record of denied) assert.equal(isInitialNativeUatTarget(record), false);
});

function transactionFor(target, calls) {
  return async fn => fn({ request: () => ({ input() { return this; }, async query(text) {
    calls.push(text);
    if (/SERVERPROPERTY/.test(text)) return { recordset: target ? [target] : [] };
    if (/SELECT Id,Role,IsActive/.test(text)) return { recordset: [] };
    throw Error('Unexpected query after empty actor result');
  } }) });
}

for (const [prefix, service, extra] of [
  ['AI', initialBookingAi, { preview: true }], ['DO', initialDelivery, {}],
  ['MR', initialManualRedemption, {}], ['IP', initialInvoice, {}],
]) {
  test(prefix + ' accepts R740 UAT at the target gate and still enforces active actors', async () => {
    const calls = [];
    await assert.rejects(service({ soid: 501, user: { sub: 1, role: 'ACCOUNTING' }, ...extra },
      { enabled: true, transaction: transactionFor(r740, calls) }), { code: prefix + '_ACTOR_UNAVAILABLE' });
    assert.equal(calls.length, 2);
    assert.match(calls[1], /SELECT Id,Role,IsActive/);
  });
  test(prefix + ' rejects Production and every changed target before actor lookup or write', async () => {
    for (const target of denied) {
      const calls = [];
      await assert.rejects(service({ soid: 501, user: { sub: 1, role: 'ACCOUNTING' }, ...extra },
        { enabled: true, transaction: transactionFor(target, calls) }), { code: prefix + '_TARGET_NOT_SUPPORTED' });
      assert.equal(calls.length, 1);
      assert.match(calls[0], /SERVERPROPERTY/);
    }
  });
}

const sources = {
  '152_initial_booking_ai.sql': ['f56885d99e26aa8d5e1f279ee984c9390ce439e8fd9078a411df65c05326d209', ['usp_ApproveInitialBooking']],
  '153_initial_delivery_104.sql': ['e0e325d42b5c4652183a636e42f51483183d55ecd13480b01a370ebffd34046a', ['usp_AllocateInitialDeliveryEventId']],
  '155_complete_initial_delivery_104.sql': ['588f70d13daff4065372386275af78c43297df7d5a13d3a37de83e72ee3363ee',
    ['usp_AllocateInitialVATId', 'usp_AllocateInitialSAT', 'usp_CreateCompleteInitialDelivery']],
  '156_initial_manual_redemption_116.sql': ['e55ba03f9d4968beccd3161f542a7cb27a237eec51e0ce93296303d363e6a743',
    ['usp_AllocateInitialRedemptionId', 'usp_CreateInitialManualRedemption']],
  '157_initial_coupon_invoice_107.sql': ['33f5a5ce31ccd8b3b7915c1d823a945bc1e1189a6d58f4b5154a62798787eb4e',
    ['usp_AllocateInitialInvoiceSAT', 'usp_PostInitialCouponInvoice']],
};
const directory = path.join(__dirname, '../migrations');
const migration = fs.readFileSync(path.join(directory, '158_r740_native_uat_target.sql'), 'utf8');
const batches = splitBatches(migration);
const oldGuard = /CONVERT\(nvarchar\(128\),SERVERPROPERTY\('ServerName'\)\)<>N'AMYOU-YOGA7\\V2008R2'\s+OR DB_NAME\(\)<>N'dbwins_worldfert9_uat2' OR DB_ID\(\)<>10/ig;

test('migration 158 preserves all nine business bodies and the immutable source bytes', () => {
  let checked = 0;
  assert.match(migration, /^-- @transaction/m);
  assert.equal(batches.length, 12);
  for (const [filename, [expectedHash, names]] of Object.entries(sources)) {
    const bytes = fs.readFileSync(path.join(directory, filename));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash);
    const originalBatches = splitBatches(bytes.toString('utf8'));
    for (const name of names) {
      const declaration = new RegExp('^ALTER PROCEDURE wf\\.' + name + '\\b', 'i');
      const original = originalBatches.filter(b => declaration.test(b.trim()));
      const replacement = batches.filter(b => declaration.test(b.trim()));
      assert.equal(original.length, 1); assert.equal(replacement.length, 1);
      assert.equal(replacement[0].trim(), original[0].trim().replace(oldGuard, 'wf.fn_IsInitialNativeUatTarget()<>1'));
      assert.equal((replacement[0].match(/wf\.fn_IsInitialNativeUatTarget\(\)<>1/g) || []).length, 1);
      checked++;
    }
  }
  assert.equal(checked, 9);
});

test('SQL target predicate includes exact UAT identities and defaults to deny', () => {
  const fn = batches.find(b => /^ALTER FUNCTION /i.test(b.trim()));
  assert.match(fn, /ServerName'\)\)=N'AMYOU-YOGA7\\V2008R2'[\s\S]*?DB_NAME\(\)=N'dbwins_worldfert9_uat2' AND DB_ID\(\)=10/);
  assert.match(fn, /ServerName'\)\)=N'R740-SRV\\SQL2008'[\s\S]*?DB_NAME\(\)=N'dbwins_worldfert9-uat' AND DB_ID\(\)=8/);
  assert.equal((fn.match(/THEN 1/g) || []).length, 2);
  assert.match(fn, /ELSE 0 END/);
  assert.doesNotMatch(fn, /N'dbwins_worldfert9'|N'dbwins_worldfert2'/);
  for (const batch of batches.slice(3)) assert.match(batch.trim(), /^ALTER PROCEDURE wf\./);
});

test('the migration runner accepts every R740 UAT batch without confusing the hyphenated clone with Production', () => {
  for (const batch of batches) assert.doesNotThrow(() => assertNoCrossDbWrite(batch));
  assert.doesNotThrow(() => assertNoCrossDbWrite('UPDATE [dbwins_worldfert9-uat].dbo.SOHD SET Remark=N\'test\';'));
});

test('exact live database writes remain blocked in quoted, unquoted and dynamic SQL', () => {
  for (const sql of [
    'UPDATE dbwins_worldfert9.dbo.SOHD SET Remark=N\'test\';',
    'INSERT INTO [dbwins_worldfert9].[dbo].[SOHD] (SOID) VALUES(1);',
    'DELETE FROM "dbwins_worldfert9".dbo.SOHD;',
    "EXEC(N'UPDATE [DBWINS_WORLDFERT9]..SOHD SET Remark=N''test''');",
    'ALTER TABLE [dbwins_worldfert9]/*comment*/.dbo.SOHD ADD Forbidden int;',
    "IF DB_NAME()=N'dbwins_worldfert9' UPDATE dbo.SOHD SET Remark=N'test';",
  ]) assert.throws(() => assertNoCrossDbWrite(sql), /Cross-database write targeting production/);
});
