'use strict';
// Owner, 21 Nov 2026: giveaway and Rebate counts in Sale-App must agree with WinSpeed on every company database.
// The check only reads, names the WinSpeed document behind each mismatch, and covers every company database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkWinspeedSync, GIVEAWAY_SQL, REBATE_SQL, GIVEAWAY_ISSUES, REBATE_ISSUES } = require('../services/winspeed-sync-check');

const ENV = { DB_MODE: 'onprem', ONPREM_DB_NAME: 'dbwins_worldfert9' };
const resolveTargets = () => [
  { name: 'dbwins_worldfert9', database: 'dbwins_worldfert9', expectedServerName: 'S' },
  { name: 'dbwins_worldfert2', database: 'dbwins_worldfert2', expectedServerName: 'S' },
];

function fakeDb(rowsByDb) {
  let current = null; const calls = [];
  return {
    calls,
    sql: { Date: 'date' },
    runWithTarget: async (_k, fn, name) => { const prev = current; current = name; try { return await fn(); } finally { current = prev; } },
    wfQuery: async (text, inputs) => {
      calls.push({ db: current, text, inputs });
      const d = rowsByDb[current] || {};
      if (/DB_NAME\(\) AS Db/.test(text)) return { recordset: [{ Db: current }] };
      if (text === GIVEAWAY_SQL) return { recordset: d.giveaway || [] };
      if (text === REBATE_SQL) return { recordset: d.rebate || [] };
      if (/AS UsageRows/.test(text)) return { recordset: [{ UsageRows: 2, UsageQty: 30, CountedQty: 30, ZeroAt: '2026-11-20T12:44:47Z' }] };
      if (/AS LotTon/.test(text)) return { recordset: [{ Generation: 1, Lots: 0, LotTon: 0, LotBaht: 0, TicketUses: 0, Plans: 0 }] };
      throw new Error('unexpected ' + text.slice(0, 40));
    },
  };
}
const readWindow = async () => ({ businessDate: '2026-01-01' });

test('the checks only read', () => {
  for (const s of [GIVEAWAY_SQL, REBATE_SQL]) {
    assert.doesNotMatch(s, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC|ALTER|DROP|CREATE)\b/i);
    assert.match(s, /WITH \(NOLOCK\)/);
  }
  for (const k of GIVEAWAY_ISSUES) assert.match(GIVEAWAY_SQL, new RegExp(`'${k}'`));
  for (const k of REBATE_ISSUES) assert.match(REBATE_SQL, new RegExp(`'${k}'`));
  // giveaway usage counts from the latest Set Zero; Rebate from the database's current reset generation
  assert.match(GIVEAWAY_SQL, /MAX\(ZeroAt\) FROM wf\.GiveawayZeroLog/);
  assert.match(REBATE_SQL, /FROM wf\.RebateResetParticipant/);
  assert.match(REBATE_SQL, /a\.ResetId = @reset AND a\.Generation = @gen/);
});

test('every company database is checked and a clean one reads as matching', async () => {
  const db = fakeDb({});
  const r = await checkWinspeedSync({ env: ENV, db, resolveTargets, readWindow });
  assert.equal(r.matches, true);
  assert.deepEqual(r.databases.map(d => d.database), ['dbwins_worldfert9', 'dbwins_worldfert2']);
  assert.equal(r.windowStart, '2026-01-01');
  for (const d of r.databases) {
    assert.deepEqual(Object.keys(d.giveaway.issues), GIVEAWAY_ISSUES);
    assert.deepEqual(Object.keys(d.rebate.issues), REBATE_ISSUES);
  }
  assert.ok(db.calls.filter(c => c.text === GIVEAWAY_SQL).every(c => c.inputs.windowStart.value === '2026-01-01'));
});

test('mismatches are counted per kind with the WinSpeed document to open', async () => {
  const rows = Array.from({ length: 55 }, (_, i) => ({ Issue: 'usageOnCancelledBill', Ref: String(1000 + i), DocuNo: `I69-0${1000 + i}`, AppQty: 5, WinspeedQty: null, Detail: 'x' }));
  const db = fakeDb({ dbwins_worldfert2: { giveaway: rows, rebate: [{ Issue: 'lotSourceChanged', Ref: '7', DocuNo: '6904375', AppQty: 11, WinspeedQty: 10.5, Detail: 'y' }] } });
  const r = await checkWinspeedSync({ env: ENV, db, resolveTargets, readWindow });
  assert.equal(r.matches, false);
  const two = r.databases[1];
  assert.equal(two.matches, false);
  assert.equal(two.issueCount, 56);
  assert.equal(two.giveaway.issues.usageOnCancelledBill.count, 55);
  assert.equal(two.giveaway.issues.usageOnCancelledBill.sample.length, 50, 'at most 50 shown');
  assert.deepEqual(two.rebate.issues.lotSourceChanged.sample[0], { ref: '7', docuNo: '6904375', appQty: 11, winspeedQty: 10.5, detail: 'y' });
  assert.equal(r.databases[0].matches, true);
});

test('without a readable data-start date nothing is checked', async () => {
  const db = fakeDb({});
  await assert.rejects(checkWinspeedSync({ env: ENV, db, resolveTargets, readWindow: async () => ({ businessDate: null }) }), e => e.code === 'SYNC_WINDOW_UNAVAILABLE');
  assert.equal(db.calls.length, 0);
});
