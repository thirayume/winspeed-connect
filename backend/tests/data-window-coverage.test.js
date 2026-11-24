'use strict';
// Guard for the data start date (วันเริ่มข้อมูล), added after the UAT acceptance test of 18 Nov 2026.
// Every GET route that reads dated WinSpeed documents must apply the start date, or be listed below with the
// reason it reads across it. A new route that does neither fails this test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '..', 'routes');
const DATED_DOCUMENTS = /dbo\.(SOHD|SOInvHD|SOInvDT|SODT|WFCoupon|WFRedemtion\w*|WGHD|ICStockHD)\b/i;
// Direct use of the window, or a helper of the same route file that applies it.
const APPLIES_WINDOW = /globalStart|readGlobalDataWindow|dataWindow|businessDate|legacyCutoff|visibleTicketTrace|tripScopeSql|\brun\(req\b/;

const READS_ACROSS_THE_START_DATE = {
  'ops.js GET /status': 'health check; the table name appears only in a comment',
  'rebate.js GET /doc-codes': 'document number series must see every number ever issued',
  'rebate.js GET /next-rb-no': 'next document number must see every number ever issued',
  'rebate.js GET /voucher-summary': 'open tickets (RemaQty > 0) are a carried-forward balance and stay usable',
  'rebate.js GET /coupons': 'open tickets (RemaQty > 0) are a carried-forward balance and stay usable',
  'recon.js GET /active-books': 'live WinSpeed number series and the cuts still waiting for an invoice',
};

function getHandlers() {
  const out = [];
  for (const file of fs.readdirSync(ROUTES).filter(f => f.endsWith('.js')).sort()) {
    const src = fs.readFileSync(path.join(ROUTES, file), 'utf8');
    const marks = [];
    const re = /router\.get\(\s*['"`]([^'"`]+)['"`]/g;
    let m;
    while ((m = re.exec(src))) marks.push({ at: m.index, route: m[1] });
    marks.forEach((mark, i) => {
      const body = src.slice(mark.at, i + 1 < marks.length ? marks[i + 1].at : src.length);
      out.push({ key: `${file} GET ${mark.route}`, body });
    });
  }
  return out;
}

test('every GET route that reads dated WinSpeed documents applies the data start date', () => {
  const missing = getHandlers()
    .filter(h => DATED_DOCUMENTS.test(h.body) && !APPLIES_WINDOW.test(h.body) && !READS_ACROSS_THE_START_DATE[h.key])
    .map(h => h.key);
  assert.deepEqual(missing, [], `routes without the data start date: ${missing.join(', ')}`);
});

test('the exception list names only routes that still exist and still need it', () => {
  const byKey = new Map(getHandlers().map(h => [h.key, h]));
  for (const key of Object.keys(READS_ACROSS_THE_START_DATE)) {
    const handler = byKey.get(key);
    assert.ok(handler, `${key} no longer exists: remove it from the list`);
    assert.ok(DATED_DOCUMENTS.test(handler.body) && !APPLIES_WINDOW.test(handler.body),
      `${key} no longer needs an exception: remove it from the list`);
  }
});

test('CN, Rebate trail and lost-copy routes found in the UAT test now apply the start date', () => {
  const byKey = new Map(getHandlers().map(h => [h.key, h.body]));
  for (const key of ['rebate.js GET /cn-summary', 'rebate.js GET /cn-list', 'rebate.js GET /cn-detail/:soInvId']) {
    assert.match(byKey.get(key), /cn\.DocuDate >= @globalStartDate/, key);
  }
  for (const key of ['rebate.js GET /wf-trail-summary', 'rebate.js GET /wf-trail-list']) {
    assert.match(byKey.get(key), /hd\.DocuDate >= @globalStartDate/, key);
  }
  assert.match(byKey.get('rebate.js GET /wf-trail-detail/:soId'), /h\.DocuDate >= @globalStartDate/);
  const lost = byKey.get('papertrail.js GET /lost');
  assert.match(lost, /INTO #lostCand/);
  assert.match(lost, /wf\.v_AllSalesOrders so WHERE so\.Id IN \(SELECT SoKey FROM #lostCand\)/);
  assert.doesNotMatch(lost, /FROM wf\.v_AllSalesOrders sourceCheck/, 'the view must not be read once per paper copy');
});
