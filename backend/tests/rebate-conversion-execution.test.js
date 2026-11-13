'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { executeReviewedConversion, readTicketValidityDays } = require('../services/rebate-conversion-execution');

const actor = { id: 7, sub: 7, role: 'ACCOUNTING', permissions: ['rebate.convert'] };
const base = { requestId: 'e15f7d22-3a47-4fcb-a954-0112b1a3ed07', custId: 123, goodId: 3,
  standingYear: 2025, requestedAmountBaht: 500, note: 'UAT', maturedOnly: false };

function fixture() {
  const state = { receipts: {}, conversions: {}, tickets: {}, balance: 1000, runs: 0 };
  let queue = Promise.resolve();
  const deps = {
    runFence: fn => fn({ environment: 'uat', generation: 0, resetId: null, lastResetAtUtc: null, manifestDigest: 'a'.repeat(64) }),
    participantFence: async () => {},
    clock: () => '2026-06-01',
    readCycle: async () => 12,
    readValidity: async () => 90,
    getScope: async () => ({ all: true, userIds: [], empIds: [] }),
    assertAging: async (_query, custId, options) => {
      assert.equal(custId, 123); assert.deepEqual(options, { asOfDate: '2026-06-01', lock: true });
    },
    convert: async (_query, input) => {
      state.runs++;
      state.balance -= input.requestedAmountBaht;
      const row = { Id: state.runs, CustId: input.custId, GoodId: input.goodId, StandingYear: input.standingYear,
        ConvertedValueBaht: input.requestedAmountBaht, ConvertedByUserId: input.actorUser.id };
      state.conversions[row.Id] = row;
      return { conversion: { id: row.Id, custId: row.CustId, convertedValueBaht: row.ConvertedValueBaht } };
    },
    issue: async (_query, input) => {
      const row = { Id: input.conversionId + 100, ConversionId: input.conversionId, CustId: input.custId,
        IssuedDate: input.issuedDate, ExpiryDate: input.expiryDate || '2026-08-30' };
      state.tickets[input.conversionId] = row;
      return { id: row.Id, conversionId: row.ConversionId, expiryDate: row.ExpiryDate };
    },
    runTx: fn => {
      const run = async () => {
        const before = structuredClone(state);
        const query = async (text, p) => {
          if (/sp_getapplock/.test(text)) return { recordset: [] };
          if (/SELECT TOP 1 1 AS ok FROM wf.v_RebateAccrualRemaining/.test(text)) return { recordset: /1=0/.test(text) ? [] : [{ ok: 1 }] };
          if (/SELECT a.Id AS AccrualId/.test(text)) {
            assert.doesNotMatch(text,/v_RebateAccrualLot|RebatePlan/);
            return { recordset: /1=0/.test(text) ? [] : [{ AccrualId: 1 }] };
          }
          if (/SELECT \* FROM wf.RebateConversionRequest/.test(text)) return { recordset: state.receipts[p.requestId] ? [state.receipts[p.requestId]] : [] };
          if (/INSERT INTO wf.RebateConversionRequest/.test(text)) {
            state.receipts[p.requestId] = { Fingerprint: p.fingerprint, IdentityActorId: p.actor,
              IdentityEffectiveId: p.effective, BusinessActorId: p.businessActor, BusinessEffectiveId: p.businessEffective,
              CustId: p.custId, ConversionId: null };
            return { rowsAffected: [1] };
          }
          if (/UPDATE wf.RebateConversionRequest/.test(text)) { state.receipts[p.requestId].ConversionId = p.id; return { rowsAffected: [1] }; }
          if (/SELECT \* FROM wf.FertilizerTicketConversion/.test(text)) return { recordset: [state.conversions[p.id]] };
          if (/SELECT \* FROM wf.FertilizerTicket WHERE ConversionId/.test(text)) return { recordset: state.tickets[p.id] ? [state.tickets[p.id]] : [] };
          throw Error('Unexpected SQL in fixture');
        };
        try { return await fn(query); } catch (e) { Object.assign(state, before); throw e; }
      };
      const next = queue.then(run, run); queue = next.catch(() => {}); return next;
    },
  };
  return { state, deps };
}

test('reset or participant failure prevents any conversion and debit', async () => {
  for (const failure of ['coordinator', 'participant']) {
    const { state, deps } = fixture();
    if (failure === 'coordinator') deps.runFence = async () => { throw Object.assign(Error('reset'), { code: 'REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED' }); };
    if (failure === 'participant') deps.participantFence = async () => { throw Object.assign(Error('stale participant'), { code: 'REBATE_RESET_PARTICIPANT_MISMATCH' }); };
    const code = failure === 'coordinator' ? 'REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED'
      : 'REBATE_RESET_PARTICIPANT_MISMATCH';
    await assert.rejects(executeReviewedConversion(actor, base, deps), { code });
    assert.equal(state.balance, 1000); assert.equal(state.runs, 0); assert.deepEqual(state.receipts, {});
  }
});
test('after reset conversion takes the shipment path, never the legacy 104 lots', async () => {
  const { state, deps }=fixture();
  deps.runFence=fn=>fn({environment:'uat',generation:1,resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',lastResetAtUtc:new Date('2026-01-01T00:00:00Z'),manifestDigest:'a'.repeat(64)});
  deps.convertShipment=deps.convert;deps.convert=async()=>{throw Error('legacy path must not run');};
  const result=await executeReviewedConversion(actor,base,deps);
  assert.equal(result.replayed,false);assert.equal(state.runs,1);assert.equal(state.balance,500);
});

test('HTTP shipment requirement rejects generation zero before reading or deducting the old balance',async()=>{
  const {state,deps}=fixture();deps.requireShipmentEpoch=true;
  await assert.rejects(executeReviewedConversion(actor,base,deps),{code:'REBATE_RESET_NOT_COMPLETED'});
  assert.equal(state.balance,1000);assert.equal(state.runs,0);assert.deepEqual(state.receipts,{});
});

test('concurrent retry converts once and returns the same receipt', async () => {
  const { state, deps } = fixture();
  const [first, second] = await Promise.all([executeReviewedConversion(actor, base, deps), executeReviewedConversion(actor, base, deps)]);
  assert.equal(state.runs, 1); assert.equal(state.balance, 500);
  assert.equal(first.conversion.id, second.conversion.id); assert.equal(second.replayed, true);
  assert.equal(first.ticket.id, second.ticket.id);
  assert.equal(Object.keys(state.tickets).length, 1);
});

test('changed payload or identity cannot reuse a conversion receipt', async () => {
  const { state, deps } = fixture();
  await executeReviewedConversion(actor, base, deps);
  await assert.rejects(executeReviewedConversion(actor, { ...base, requestedAmountBaht: 600 }, deps), { code: 'CONVERSION_REQUEST_CONFLICT' });
  await assert.rejects(executeReviewedConversion(actor, { ...base, expiryDate: '2026-12-31' }, deps), { code: 'CONVERSION_REQUEST_CONFLICT' });
  await assert.rejects(executeReviewedConversion({ ...actor, id: 8, sub: 8 }, base, deps), { code: 'CONVERSION_REQUEST_CONFLICT' });
  assert.equal(state.balance, 500);
});

test('chosen ticket expiry is honoured and invalid expiry does not reserve any balance', async () => {
  const { state, deps } = fixture();
  const result = await executeReviewedConversion(actor, { ...base, expiryDate: '2026-12-31' }, deps);
  assert.equal(result.ticket.expiryDate, '2026-12-31');
  const other = { ...base, requestId: '1a5f7d22-3a47-4fcb-a954-0112b1a3ed07', expiryDate: '2026-05-31' };
  await assert.rejects(executeReviewedConversion(actor, other, deps), { code: 'INVALID_TICKET_EXPIRY' });
  assert.equal(state.runs, 1); assert.equal(state.balance, 500);
});

test('default validity is 90 days, configured value is honoured, invalid settings fail closed', async () => {
  assert.equal(await readTicketValidityDays(async () => ({ recordset: [] })), 90);
  assert.equal(await readTicketValidityDays(async () => ({ recordset: [{ SettingValue: '120' }] })), 120);
  for (const value of ['0', 'bad', '2.5']) {
    await assert.rejects(readTicketValidityDays(async () => ({ recordset: [{ SettingValue: value }] })), { code: 'INVALID_TICKET_VALIDITY' });
  }
});

test('ticket issuance failure rolls back conversion, receipt and allocation', async () => {
  const { state, deps } = fixture();
  deps.issue = async () => { throw Error('simulated ticket failure'); };
  await assert.rejects(executeReviewedConversion(actor, base, deps), /simulated ticket failure/);
  assert.deepEqual(state.receipts, {}); assert.deepEqual(state.conversions, {}); assert.equal(state.balance, 1000);
});

test('aging rejection rolls back the receipt and never deducts', async () => {
  const { state, deps } = fixture();
  deps.assertAging = async () => { throw Object.assign(Error('old AR'), { code: 'AGING_BLOCKED' }); };
  await assert.rejects(executeReviewedConversion(actor, base, deps), { code: 'AGING_BLOCKED' });
  assert.deepEqual(state.receipts, {}); assert.equal(state.balance, 1000); assert.equal(state.runs, 0);
});

test('both Access As identities need permission and date/override inputs are rejected', async () => {
  const { deps } = fixture();
  await assert.rejects(executeReviewedConversion({ ...actor, isImpersonating: true, actorSub: 9, actorRole: 'SALES', actorRoles: ['SALES'], actorPermissions: [] }, base, deps), { code: 'FORBIDDEN_CONVERTER_ROLE' });
  await assert.rejects(executeReviewedConversion(actor, { ...base, asOfDate: '1900-01-01' }, deps), { code: 'UNTRUSTED_CONVERSION_INPUT' });
  await assert.rejects(executeReviewedConversion(actor, { ...base, agingOverrideGranted: true }, deps), { code: 'UNTRUSTED_CONVERSION_INPUT' });
});

test('receipt records primary and mapped business identities separately', async () => {
  const { state, deps } = fixture();
  const delegated = { ...actor, isImpersonating: true, actorSub: 8, actorRole: 'ADMIN', actorRoles: ['ADMIN'],
    actorPermissions: ['rebate.convert'], identityMapping: { primaryActorUserId: 8, primaryEffectiveUserId: 7,
      businessActorUserId: 38, businessEffectiveUserId: 37 } };
  await executeReviewedConversion(delegated, base, deps);
  const receipt = state.receipts[base.requestId];
  assert.deepEqual([receipt.IdentityActorId, receipt.IdentityEffectiveId, receipt.BusinessActorId, receipt.BusinessEffectiveId], [8, 7, 38, 37]);
  assert.equal(state.conversions[1].ConvertedByUserId, 37);
});

test('conversion failure rolls back both the financial deduction and receipt', async () => {
  const { state, deps } = fixture();
  deps.convert = async () => { state.balance -= 500; throw Error('simulated failure after debit'); };
  await assert.rejects(executeReviewedConversion(actor, base, deps), /simulated failure/);
  assert.equal(state.balance, 1000); assert.deepEqual(state.receipts, {});
});

test('Access As actor and effective user must both have customer scope', async () => {
  const { state, deps } = fixture();
  deps.getScope = async user => Number(user.sub) === 8 ? { all: false, userIds: [], empIds: [] } : { all: true, userIds: [], empIds: [] };
  const delegated = { ...actor, isImpersonating: true, actorSub: 8, actorRole: 'ADMIN', actorRoles: ['ADMIN'], actorPermissions: ['rebate.convert'] };
  await assert.rejects(executeReviewedConversion(delegated, base, deps), { code: 'REBATE_CUSTOMER_OUT_OF_SCOPE' });
  assert.equal(state.balance, 1000); assert.deepEqual(state.receipts, {});
});

test('a replay does not reveal a receipt after customer scope is revoked', async () => {
  const { state, deps } = fixture();
  await executeReviewedConversion(actor, base, deps);
  deps.getScope = async () => ({ all: false, userIds: [], empIds: [] });
  await assert.rejects(executeReviewedConversion(actor, base, deps), { code: 'REBATE_CUSTOMER_OUT_OF_SCOPE' });
  assert.equal(state.runs, 1); assert.equal(state.balance, 500);
});
