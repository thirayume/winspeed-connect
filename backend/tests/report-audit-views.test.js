'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// W1-b / W1-c: audit views over wf tables that only services write — read-only, Thai time, readable labels
const { runPolicyHistoryReport, runSequenceCountersReport, runTruckHoldLogReport, runTicketAlertHistoryReport } =
  require('../routes/reports').__testing;

function stub(rows) {
  const calls = [];
  return { calls, queryFn: async (text, inputs) => { calls.push({ text, inputs }); return { recordset: rows }; } };
}
const readOnly = text => assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);

test('policy history lists every change, newest first, with the person who changed it', async () => {
  const s = stub([{ PolicyName: 'PICKUP_POLICY', ChangedBy: 'ระบบ (ค่าเริ่มต้น)' }]);
  const rows = await runPolicyHistoryReport({}, { queryFn: s.queryFn });
  assert.equal(rows.length, 1);
  const { text, inputs } = s.calls[0];
  readOnly(text);
  assert.match(text, /FROM wf\.PolicyVersion pv/);
  assert.match(text, /DATEADD\(hour,7,pv\.CreatedAt\)/);
  assert.match(text, /'SYSTEM_INIT'/);
  assert.match(text, /ORDER BY pv\.CreatedAt DESC/);
  assert.equal(inputs.limit.value, 1000);
});

test('sequence counters explain what each counter numbers', async () => {
  const s = stub([{ SequenceName: 'WfRefSeq', CurrentValue: 6592 }, { SequenceName: 'OtherSeq', CurrentValue: 1 }]);
  const rows = await runSequenceCountersReport({}, { queryFn: s.queryFn });
  readOnly(s.calls[0].text);
  assert.match(rows[0].Purpose, /WF Ref/);
  assert.equal(rows[1].Purpose, '');
});

test('truck hold log filters by Thai date and shows hold, result and booking number in words', async () => {
  const s = stub([{ Action: 'HOLD', PrevOnHold: 'N', NewOnHold: 'Y', Applied: false, DocuNo: 'B-T1' },
    { Action: 'RELEASE', PrevOnHold: 'Y', NewOnHold: 'N', Applied: true }]);
  const rows = await runTruckHoldLogReport({ from: '2026-10-01', to: '2026-10-31', limit: '99999' }, { queryFn: s.queryFn });
  const { text, inputs } = s.calls[0];
  readOnly(text);
  assert.match(text, /FROM wf\.TruckHoldLog l/);
  assert.match(text, /h\.DocuType = 103/);
  assert.match(text, /CAST\(DATEADD\(hour,7,l\.ActedAt\) AS date\) BETWEEN @from AND @to/);
  assert.deepEqual([inputs.from.value, inputs.to.value, inputs.limit.value], ['2026-10-01', '2026-10-31', 5000]);
  assert.deepEqual(rows.map(r => [r.Action, r.OnHold, r.Applied]), [['พักใบ', 'N → Y', 'ไม่ได้บันทึก'], ['ปลดพัก', 'Y → N', 'บันทึกแล้ว']]);
  assert.ok(!('PrevOnHold' in rows[0]));
});

test('control ticket alert history includes closed alerts and names type and status in Thai', async () => {
  const s = stub([{ AlertType: 'NEAR_EXPIRY', Status: 'ACTIVE' }, { AlertType: 'EXPIRED', Status: 'RESOLVED' }, { AlertType: 'X', Status: 'Y' }]);
  const rows = await runTicketAlertHistoryReport({}, { queryFn: s.queryFn });
  const { text } = s.calls[0];
  readOnly(text);
  assert.match(text, /FROM wf\.ControlTicketAlert a/);
  assert.doesNotMatch(text, /Status\s*=\s*'ACTIVE'/, 'history shows every status, not only open alerts');
  assert.deepEqual(rows.map(r => [r.AlertType, r.Status]), [['ใกล้หมดอายุ', 'ค้างอยู่'], ['หมดอายุ', 'ปิดแล้ว'], ['X', 'Y']]);
});
