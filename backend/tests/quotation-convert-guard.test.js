'use strict';

/**
 * UAT 2026-10-09 (QT-04/QT-05): a bill made from a quotation marked it CONVERTED whatever its state, and the raw
 * convert route made a draft that skipped the price check. The quotation must be accepted, not converted yet, for the
 * same customer and visible to the person saving; the raw route is retired.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

h.installDbStub(() => []);
const so = require('../routes/so');

const fakeTx = row => ({ request() { const r = { input() { return r; }, async query() { return { recordset: row ? [row] : [] }; } }; return r; } });
const admin = { user: { sub: 63, role: 'ADMIN' } };
const check = (row, quoteId = 3, custId = '1078', req = admin) => so.assertQuoteConvertibleForTest(fakeTx(row), req, quoteId, custId);

test('an accepted quotation of the same customer converts', async () => {
  await check({ Id: 3, QuoteNo: 'QU6910-00003', Status: 'ACCEPTED', CustId: '1078', SalesUserId: 43 });
});

test('a converted quotation cannot convert again', async () => {
  await assert.rejects(check({ Id: 3, QuoteNo: 'QU6910-00003', Status: 'CONVERTED', CustId: '1078', SalesUserId: 43 }),
    e => e.status === 409 && /แปลงเป็น SO แล้ว/.test(e.message));
});

test('a quotation not accepted yet cannot convert', async () => {
  await assert.rejects(check({ Id: 3, QuoteNo: 'QU6910-00003', Status: 'SENT', CustId: '1078', SalesUserId: 43 }),
    e => e.status === 409 && /ต้องยืนยันก่อน/.test(e.message));
});

test('another customer on the bill is refused', async () => {
  await assert.rejects(check({ Id: 3, QuoteNo: 'QU6910-00003', Status: 'ACCEPTED', CustId: '1078', SalesUserId: 43 }, 3, '1079'),
    e => e.status === 400);
});

test('a missing quotation answers 404', async () => {
  await assert.rejects(check(null), e => e.status === 404);
});

test('a WinSpeed quotation needs its QC and a single conversion', async () => {
  await assert.rejects(check({ DocuNo: 'QU6909-00001', CustId: '1078', HasQc: null, AppStatus: null }, -279001),
    e => e.status === 409 && /QC/.test(e.message));
  await assert.rejects(check({ DocuNo: 'QU6909-00001', CustId: '1078', HasQc: 1, AppStatus: 'CONVERTED' }, -279001),
    e => e.status === 409 && /แปลงเป็น SO แล้ว/.test(e.message));
  await check({ DocuNo: 'QU6909-00001', CustId: '1078', HasQc: 1, AppStatus: null }, -279001);
});

test('the bill route runs the check and converts only an accepted quotation', () => {
  const src = require('fs').readFileSync(require.resolve('../routes/so'), 'utf8');
  assert.match(src, /if \(convertFromQuoteId\) await assertQuoteConvertible\(tx, req, convertFromQuoteId, custId\);/);
  assert.match(src, /UPDATE wf\.Quotation SET Status='CONVERTED', ConvertedSoId=@soId, UpdatedAt=GETUTCDATE\(\) WHERE Id=@quoteId AND Status='ACCEPTED'/);
});

test('the raw convert route is retired', async () => {
  const app = await h.startApp([['/api/quotation', '../../routes/quotation']]);
  try {
    const r = await app.call('POST', '/api/quotation/3/convert', { body: { soPrefix: 'I' }, user: { sub: 43, role: 'SALES' } });
    assert.equal(r.status, 410);
  } finally { await app.close(); }
});

test('a converted bill can be confirmed: the quotation no longer holds a key on the draft row', () => {
  const sqlText = require('fs').readFileSync(require.resolve('../migrations/150_quotation_converted_link.sql'), 'utf8');
  assert.match(sqlText, /referenced_object_id = OBJECT_ID\('wf\.SalesOrder'\)/);
  assert.match(sqlText, /ALTER TABLE wf\.Quotation DROP CONSTRAINT/);
  const src = require('fs').readFileSync(require.resolve('../routes/quotation'), 'utf8');
  assert.match(src, /x\.SourceDraftId = q\.ConvertedSoId\)\) AS ConvertedWfRef/, 'the list follows the confirmed booking');
});
