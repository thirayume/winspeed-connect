'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const { stub: db } = h.installDbStub(() => []);
let state;
let scenario;

db.wfTransaction = async fn => {
  const snapshot = structuredClone(state);
  const tx = { request() {
    const params = {};
    return {
      input(name, _type, value) { params[name] = value; return this; },
      output(name, _type, value) { params[name] = value; return this; },
      async query(text) {
        if (/COL_LENGTH\('wf.PriceBook'/.test(text)) return { recordset: [{ HasPb: 1, HasLine: 1, HasSpProc: 1 }] };
        if (/FROM wf.PriceBook WHERE Id = @id/.test(text)) return { recordset: [{ Id: 3, Name: 'test', Status: 'ACTIVE', EffectiveMonth: '2026-11', EffectiveFrom: '2026-11-01', EffectiveTo: '2026-11-30', SourceSetPriceIds: scenario.ambiguous ? '123,124' : '123' }] };
        if (/FROM wf.PriceBookLine\s+WHERE PriceBookId/.test(text)) return { recordset: [
          { Id: 1, GoodId: 101, Price: 100, LineStatus: 'ACTIVE', WinSpeedSetPriceId: scenario.wrongSet ? 999 : null, WinSpeedListNo: scenario.staleLine ? 1 : null },
          { Id: 2, GoodId: 102, Price: 200, LineStatus: 'ACTIVE' },
        ] };
        if (/FROM wf.PriceBookSpecialPrice\s+WHERE PriceBookId/.test(text)) return { recordset: scenario.special ? [{ Id: 7 }] : [] };
        if (/FROM wf.PriceBookSpecialPrice sp/.test(text)) return { recordset: [{ Id: 7, PriceBookId: 3, CustId: 10, GoodId: 101, ApprovedPrice: 90, BookStatus: 'ACTIVE', EffectiveMonth: '2026-11', EffectiveFrom: '2026-11-01', EffectiveTo: '2026-11-30' }] };
        if (/FROM dbo.EMCust/.test(text)) return { recordset: [{ CustID: 10 }] };
        if (/FROM dbo.EMGood/.test(text)) return { recordset: [] };
        if (/FROM dbo.EMSetPriceDT/.test(text)) return { recordset: [] };
        if (/UPDATE wf.PriceBookLine/.test(text)) { state.appLines.push(params.lid); return { recordset: [] }; }
        if (/UPDATE wf.PriceBookSpecialPrice/.test(text)) { state.special = true; return { recordset: [] }; }
        if (/UPDATE wf.PriceBook\s+SET WinSpeedSyncAt/.test(text)) { state.stamped = true; return { recordset: [] }; }
        if (/INSERT INTO wf.PriceBookAudit/.test(text)) { state.audit++; return { recordset: [] }; }
        throw new Error('Unexpected query: ' + text.slice(0, 80));
      },
      async execute(proc) {
        if (/SyncHeaderDates/.test(proc)) return { output: {} };
        if (/UpsertWinSpeedLine/.test(proc)) {
          if (scenario.failLine && params.GoodID === 102) throw new Error('line failed');
          state.nativeLines.push(params.GoodID); return { output: { ListNo: params.GoodID - 100 } };
        }
        if (/UpsertSpecialWinSpeedPrice/.test(proc)) {
          if (scenario.failSpecial) throw new Error('special failed');
          return { output: { SetPriceID: 555 } };
        }
        throw new Error('Unexpected proc ' + proc);
      },
    };
  } };
  try { return await fn(tx); } catch (error) { Object.assign(state, snapshot); throw error; }
};

const { syncBookToWinSpeed } = require('../services/pricebook-winspeed-sync');
test.beforeEach(() => { state = { nativeLines: [], appLines: [], audit: 0, stamped: false, special: false }; scenario = {}; });

test('successful price sync writes both native lines and audit in the same transaction', async () => {
  const result = await syncBookToWinSpeed(3, 9);
  assert.equal(result.synced, true); assert.equal(result.upserted, 2);
  assert.deepEqual(state.nativeLines, [101, 102]); assert.deepEqual(state.appLines, [1, 2]);
  assert.equal(state.audit, 1); assert.equal(state.stamped, true);
});

test('line failure rolls back all previous app, native and audit changes', async () => {
  scenario.failLine = true;
  await assert.rejects(syncBookToWinSpeed(3, 9), /line failed/);
  assert.deepEqual(state.nativeLines, []); assert.deepEqual(state.appLines, []);
  assert.equal(state.audit, 0); assert.equal(state.stamped, false);
});

test('special price failure rolls back the complete sync', async () => {
  scenario.special = true; scenario.failSpecial = true;
  await assert.rejects(syncBookToWinSpeed(3, 9), /special failed/);
  assert.deepEqual(state.nativeLines, []); assert.deepEqual(state.appLines, []);
  assert.equal(state.audit, 0); assert.equal(state.stamped, false);
});

test('an ambiguous split set cannot silently select a different WinSpeed price book', async () => {
  scenario.ambiguous = true;
  await assert.rejects(syncBookToWinSpeed(3, 9), { code: 'PRICE_TARGET_AMBIGUOUS' });
  assert.deepEqual(state.nativeLines, []); assert.equal(state.audit, 0);
});

test('a line linked to an unrelated set is rejected without updating WinSpeed', async () => {
  scenario.wrongSet = true;
  await assert.rejects(syncBookToWinSpeed(3, 9), { code: 'PRICE_TARGET_MISMATCH' });
  assert.deepEqual(state.nativeLines, []); assert.equal(state.audit, 0);
});

test('stale WinSpeed list number cannot update or delete an unrelated product', async () => {
  scenario.staleLine = true;
  await assert.rejects(syncBookToWinSpeed(3, 9), { code: 'PRICE_LINE_STALE' });
  assert.deepEqual(state.nativeLines, []); assert.equal(state.audit, 0);
});
