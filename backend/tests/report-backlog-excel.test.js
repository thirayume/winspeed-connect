'use strict';
// Exercises the HTTP report and the actual Excel serializer with synthetic
// rows. It is not a live SQL or browser performance test.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const XLSX = require('xlsx');
const h = require('./helpers/route-harness.cjs');
const fixture = [
  { DocuNo: 'I69-TEST', DocuDate: '2026-01-01', CustName: 'ทดสอบ', GoodName: 'สินค้า A', OrderedTon: 4, ShippedTon: 1, BacklogTon: 3 },
  { DocuNo: 'ยอดค้างส่งยกมา', DocuDate: null, CustName: 'ทดสอบ', GoodName: 'สินค้า A', OrderedTon: null, ShippedTon: null, BacklogTon: 2 },
  { DocuNo: 'ยอดค้างส่งไม่ทราบวันที่', DocuDate: null, CustName: 'ทดสอบ', GoodName: 'สินค้า A', OrderedTon: null, ShippedTon: null, BacklogTon: 1 },
];
const db = h.installDbStub(({ text }) => {
  if (/GROUP BY hd\.CustID, hd\.CustName, dt\.GoodID, dt\.GoodName/.test(text)) return fixture;
  if (/FROM wf\.ReportTemplateAssignment a/.test(text)) return [{ TemplateId: 1, TemplateCode: 'TEST', TemplateName: 'Test', TemplateVersion: 1, HeaderId: 1, CompanyNameTh: 'ทดสอบ' }];
  return [];
}, { activeUserIds: [1] });
const app = express();
app.use(express.json());
app.use('/api/reports', require('../routes/reports'));
let server, base;
test.before(async () => { server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

test('backlog JSON and Excel preserve opening rows and numeric total without old identifiers', async () => {
  const headers = { authorization: `Bearer ${h.token({ sub: 1, role: 'ADMIN' })}` };
  const response = await fetch(`${base}/api/reports/so-backlog`, { headers });
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.rows.length, 3);
  assert.equal(json.rows.reduce((sum, row) => sum + row.BacklogTon, 0), 6);
  const excel = await fetch(`${base}/api/reports/so-backlog/export`, { headers });
  assert.equal(excel.status, 200);
  assert.match(excel.headers.get('content-type'), /spreadsheetml/);
  const book = XLSX.read(Buffer.from(await excel.arrayBuffer()), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: null });
  const tableHeader = rows.find(row => row.includes('ค้างส่ง (ตัน)'));
  assert.ok(tableHeader);
  const col = tableHeader.indexOf('ค้างส่ง (ตัน)');
  const opening = rows.find(row => row.includes('ยอดค้างส่งยกมา'));
  const unknown = rows.find(row => row.includes('ยอดค้างส่งไม่ทราบวันที่'));
  const total = rows.find(row => row.some(cell => typeof cell === 'string' && cell.startsWith('รวมทั้งสิ้น')));
  assert.equal(opening[col], 2);
  assert.equal(unknown[col], 1);
  assert.equal(total[col], 6);
  assert.ok(db.calls.filter(call => /GROUP BY hd\.CustID, hd\.CustName/.test(call.text)).length >= 2);
  assert.ok(!JSON.stringify(rows).includes('OLD-DOC-SECRET'));
});

test('Excel export contains all 1,856 synthetic rows and the full numeric total', async t => {
  const baseLength = fixture.length;
  for (let i = 0; i < 1853; i++) fixture.push({ DocuNo: `TEST-${i}`, DocuDate: '2026-01-01', CustName: 'ทดสอบ', GoodName: 'สินค้า A', OrderedTon: 1, ShippedTon: 0, BacklogTon: 1 });
  try {
    const headers = { authorization: `Bearer ${h.token({ sub: 1, role: 'ADMIN' })}` };
    const started = performance.now();
    const response = await fetch(`${base}/api/reports/so-backlog/export`, { headers });
    assert.equal(response.status, 200);
    const buffer = Buffer.from(await response.arrayBuffer());
    const generatedMs = Math.round(performance.now() - started);
    const book = XLSX.read(buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: null });
    const column = rows.find(row => row.includes('ค้างส่ง (ตัน)')).indexOf('ค้างส่ง (ตัน)');
    const detailCount = rows.filter(row => typeof row[0] === 'string' && row[0].startsWith('TEST-')).length;
    const total = rows.find(row => row.some(cell => typeof cell === 'string' && cell.startsWith('รวมทั้งสิ้น')));
    assert.equal(detailCount, 1853);
    assert.equal(total[column], 1859);
    t.diagnostic(`synthetic rows=1856, generation_ms=${generatedMs}, xlsx_bytes=${buffer.length}; local process, mocked DB`);
  } finally { fixture.splice(baseLength); }
});
