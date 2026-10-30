'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./helpers/route-harness.cjs').installDbStub(() => []);
const { splitBatches } = require('../run_migrations');
const { assertNoCrossDbWrite } = require('../safety-validator');

const directory = path.join(__dirname, '../migrations');
const text = fs.readFileSync(path.join(directory, '162_native_107_scale_slip.sql'), 'utf8');
const batches = splitBatches(text);
const declaration = /^ALTER PROCEDURE wf\.usp_PostInitialCouponInvoice\b/i;

// Follow-up to migration 161: only the scale record the 116 was numbered from may exist.
const edits = [
  [',@DeliveryHash varchar(64),@CutHash varchar(64);',
   ',@DeliveryHash varchar(64),@CutHash varchar(64),@CutNo varchar(25),@SlipSource varchar(20);'],
  ['  @DeliveryHash=r.DeliveryAfterHash,@CutHash=m.RedemptionAfterHash\n',
   '  @DeliveryHash=r.DeliveryAfterHash,@CutHash=m.RedemptionAfterHash,@CutNo=ch.DocuNo,@SlipSource=mr.SlipSource\n'],
  ["  OR EXISTS(SELECT 1 FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID IN(@SOID,@Delivery))\n",
   "  OR EXISTS(SELECT 1 FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID IN(@SOID,@Delivery)\n" +
   "   AND NOT(@SlipSource='SCALE' AND SPID=@SOID AND RTRIM(MoveBill)=@CutNo))\n" +
   "  OR(@SlipSource='SCALE' AND(SELECT COUNT(*) FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID IN(@SOID,@Delivery))<>1)\n"],
];

test('migration 162 is transactional and portable', () => {
  assert.match(text, /^-- @transaction/m);
  assert.equal(batches.length, 2);
  assert.doesNotMatch(text, /\b(CREATE|ALTER|DROP)\s+(TABLE|VIEW|PROCEDURE|FUNCTION|TRIGGER|INDEX)\s+(\[?dbo\]?\.)/i);
  assert.doesNotMatch(text, /CREATE\s+OR\s+ALTER|\bTHROW\b|\bIIF\s*\(|TRY_CONVERT|\bCONCAT\s*\(|\bOFFSET\b/i);
  assert.doesNotMatch(text, /dbwins_worldfert/i);
  for (const batch of batches) assert.doesNotThrow(() => assertNoCrossDbWrite(batch));
});

test('the 107 writer equals migration 158 plus only the scale-slip edits', () => {
  const original = splitBatches(fs.readFileSync(path.join(directory, '158_r740_native_uat_target.sql'), 'utf8'))
    .filter(b => declaration.test(b.trim()));
  const replacement = batches.filter(b => declaration.test(b.trim()));
  assert.equal(original.length, 1); assert.equal(replacement.length, 1);
  let expected = original[0].trim() + '\n';
  for (const [from, to] of edits) {
    assert.equal(expected.split(from).length - 1, 1, 'anchor must occur once: ' + from.slice(0, 50));
    expected = expected.replace(from, () => to);
  }
  assert.equal(replacement[0].trim() + '\n', expected);
});

test('only the 116 source scale record is tolerated, and the guards stay', () => {
  const body = batches.find(b => declaration.test(b.trim()));
  assert.match(body, /NOT\(@SlipSource='SCALE' AND SPID=@SOID AND RTRIM\(MoveBill\)=@CutNo\)/);
  assert.equal((body.match(/wf\.fn_IsInitialNativeUatTarget\(\)<>1/g) || []).length, 1);
  assert.match(body, /m\.PolicyVersion='O25-116-MANUAL-UAT2-v1'/);
  assert.match(body, /IP_SOURCE_UNAVAILABLE/);
});
