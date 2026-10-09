'use strict';

/**
 * UAT full loop 2026-10-09 (claim #4): returning a claim gave the pool its amount back but not the ledger rows the
 * claim had cut, so the pool read "available ฿0" and the salesperson could not file again.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const claim = { Id: 4, Status: 'TIER2_PENDING', CurrentTier: 2, PoolId: 1, ClaimAmt: 1000, SalesUserId: 43, RegionCode: '03' };
const ledger = [
  { Id: 2, RebateAmount: 600, RemainingAmt: 600 },  // not cut by any claim: not selected (RemainingAmt < RebateAmount)
  { Id: 1, RebateAmount: 1000, RemainingAmt: 0 },
];
const db = h.installDbStub(({ text }) => {
  if (/FROM wf\.RebateClaim WITH \(UPDLOCK, ROWLOCK\) WHERE Id = @id/.test(text)) return [{ ...claim }];
  if (/FROM wf\.UserSaleArea WHERE UserId = @uid AND RegionCode = @rcode/.test(text)) return [{ x: 1 }];
  if (/UPDATE wf\.RebateClaim\s+SET Status = 'REJECTED'/.test(text)) return { recordset: [], rowsAffected: [1] };
  if (/FROM wf\.RebateLedger WITH \(UPDLOCK\)\s+WHERE PoolId = @pid AND ReversedFlag = 0 AND RemainingAmt < RebateAmount/.test(text)) {
    return ledger.filter(r => r.RemainingAmt < r.RebateAmount);
  }
  return [];
});

let app;
test.before(async () => { app = await h.startApp([['/api/rebate', '../../routes/rebate']]); });
test.after(async () => { await app.close(); });

test('returning a claim gives its amount back to the pool and to the ledger rows it cut', async () => {
  const before = db.calls.length;
  const r = await app.call('POST', '/api/rebate/claims/4/reject', { body: { reason: 'UAT ตีกลับ ขอแนบเลขใบกำกับ' }, user: { sub: 25, role: 'MANAGER' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const calls = db.calls.slice(before);
  assert.ok(calls.some(c => /UPDATE wf\.RebatePool\s+SET ClaimedAmt = CASE/.test(c.text)), 'pool claimed amount reversed');
  const back = calls.filter(c => /UPDATE wf\.RebateLedger\s+SET RemainingAmt = RemainingAmt \+ @put/.test(c.text));
  assert.equal(back.length, 1);
  assert.equal(back[0].inputs.id, 1);
  assert.equal(Number(back[0].inputs.put), 1000);
  assert.match(back[0].text, /WHEN Status = 'CLAIMED' THEN 'PENDING'/);
});
