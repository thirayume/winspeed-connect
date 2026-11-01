'use strict';
/**
 * Native-chain Full Loop on a restored UAT clone, through the real API: quotation -> booking 103 ->
 * AI -> 104 + coupon -> 116 -> 107 -> audit, for both book lines (I->C->J and K->D->N), with the role
 * denials, replays, slip rules, contact copy, WinSpeed-form prints and audit reports.
 *
 * Runs inside the UAT backend container, one phase at a time, stopping at the first failed check:
 *
 *   docker exec -e UAT_LOOP_PHASE=prepare -e UAT_LOOP_RUN=R740UAT-YYYYMMDD-NN \
 *     -e UAT_LOOP_DB=<UAT database> -e UAT_LOOP_CUST_ID=<id> -e UAT_LOOP_GOOD_ID=<id> \
 *     -e UAT_LOOP_NET_PRICE=<per ton> -e UAT_LOOP_EMP_ID=<id> saleapp-uat-backend-1 node scripts/uat-full-loop.cjs
 *
 * Phases, in order: prepare, I-booking, K-booking, I-104, K-104, I-116, K-116, I-107, K-107, audit, close.
 * Before I-116, IT inserts the labelled scale record with docs/deploy/r740/sql/uat-simulated-scale-record.sql.
 * Run close only after everything passed: it disables the five test accounts and removes their passwords.
 *
 * Fixtures come from the environment: an existing customer with a default contact, a product packed in
 * 50 kg sacks with that net price on the delivery date (UAT_LOOP_DELIVERY_DATE, default 30 days ahead;
 * prepare stops if the price does not match that date), and a type-G employee. Test accounts, requests and
 * passwords stay in a private state folder inside the container. Output holds check names, test labels and
 * new document numbers; keep those numbers out of the repository.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PHASES = ['prepare', 'I-booking', 'K-booking', 'I-104', 'K-104', 'I-116', 'K-116', 'I-107', 'K-107', 'audit', 'close'];
const phase = process.env.UAT_LOOP_PHASE;
const RUN = process.env.UAT_LOOP_RUN || '';
const EXPECT_DB = process.env.UAT_LOOP_DB || '';
const CUST_ID = Number(process.env.UAT_LOOP_CUST_ID);
const GOOD_ID = Number(process.env.UAT_LOOP_GOOD_ID);
const NET_PRICE = Number(process.env.UAT_LOOP_NET_PRICE);
const EMP_ID = Number(process.env.UAT_LOOP_EMP_ID);

function config() {
  if (!PHASES.includes(phase)) throw Error('UAT_LOOP_PHASE_INVALID');
  if (!/^[A-Za-z0-9-]{8,30}$/.test(RUN)) throw Error('UAT_LOOP_RUN_INVALID');
  if (!/_uat$/.test(EXPECT_DB)) throw Error('UAT_LOOP_DB_NOT_UAT');
  if (![CUST_ID, GOOD_ID, NET_PRICE, EMP_ID].every(n => Number.isInteger(n) && n > 0)) throw Error('UAT_LOOP_FIXTURES_REQUIRED');
}

// The runner stops here on a bad configuration, before db.js can open a pool.
try {
  config();
} catch (e) {
  console.log('LOOP_PHASE=' + phase + ' FAILED ' + e.message);
  process.exit(2);
}

const db = require('../db');
const bcrypt = require('bcrypt');

const PREFIX = 'uat-loop-' + RUN.toLowerCase() + '-';
const DIR = '/tmp/saleapp-uat-loop-' + RUN.toLowerCase();
const API = 'http://127.0.0.1:' + (process.env.PORT || 3000) + '/api';
const NET_KG = 1004; // weight on the simulated scale record, inside the 2% tolerance of a 1-ton coupon
const PRICE_TEXT = NET_PRICE.toFixed(4);
const deliveryDate = process.env.UAT_LOOP_DELIVERY_DATE || new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
// The 116 number is the transport slip: I takes it from the scale record, K types it as an exception.
const slipFor = c => '99' + String(Number(c.soid) % 100000).padStart(5, '0');

fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
const statePath = path.join(DIR, 'state.json');
const fixturePath = path.join(DIR, 'fixtures.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { run: RUN, cases: {}, checks: [] };
let fixtures = fs.existsSync(fixturePath) ? JSON.parse(fs.readFileSync(fixturePath, 'utf8')) : null;

function save() {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function check(ok, code) {
  state.checks.push({ phase, code, ok: !!ok });
  save();
  console.log('LOOP_CHECK=' + code + ' ' + (ok ? 'PASS' : 'FAIL'));
  if (!ok) throw Error(code);
}

const param = (type, value) => ({ type, value });
const query = (text, inputs = {}) => db.wfQuery(text, inputs);

async function target() {
  const t = (await query('SELECT DB_NAME() AS DbName')).recordset[0];
  if (t.DbName !== EXPECT_DB) throw Error('TARGET_INVALID');
  if (String(process.env.ONPREM_TARGET_KIND || 'uat').toLowerCase() !== 'uat') throw Error('TARGET_KIND_NOT_UAT');
  const response = await fetch(API + '/dbinfo', { signal: AbortSignal.timeout(8000) });
  const info = await response.json();
  if (response.status !== 200 || info.database !== EXPECT_DB) throw Error('API_TARGET_INVALID');
  if (state.run !== RUN) throw Error('RUN_INVALID');
  if (phase === 'close') return;
  for (const key of ['NATIVE_BOOKING_AI_ENABLED', 'NATIVE_DELIVERY_104_ENABLED', 'NATIVE_MANUAL_116_ENABLED', 'NATIVE_INVOICE_107_ENABLED']) {
    if (process.env[key] !== 'true') throw Error('NATIVE_FLAGS_NOT_READY');
  }
  const allowed = (await query('SELECT wf.fn_IsInitialNativeUatTarget() AS Allowed')).recordset[0].Allowed;
  if (Number(allowed) !== 1) throw Error('SQL_TARGET_NOT_READY');
}

const tokens = {};

async function call(method, route, body, key) {
  const headers = { 'Content-Type': 'application/json' };
  const token = tokens[key] || key;
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(API + route, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const data = await response.json().catch(() => ({}));
  const code = typeof data.code === 'string' && /^[A-Z_0-9]+$/.test(data.code) ? data.code : null;
  if (response.status >= 400) console.log('LOOP_HTTP=' + method + ' ' + route + ' ' + response.status + (code ? ' ' + code : ''));
  return { status: response.status, data };
}

async function loginAll() {
  if (!fixtures || fixtures.run !== RUN) throw Error('FIXTURES_MISSING');
  for (const [key, u] of Object.entries(fixtures.users)) {
    if (u.username !== PREFIX + key) throw Error('FIXTURE_NAMESPACE_INVALID');
    const r = await call('POST', '/auth/login', { username: u.username, password: u.password });
    check(r.status === 200 && r.data.user?.role === u.role && !!r.data.accessToken, 'LOGIN_' + key.toUpperCase());
    tokens[key] = r.data.accessToken;
  }
}

async function prepare() {
  const roles = { sales: 'SALES', account: 'ACCOUNTING', warehouse: 'WAREHOUSE', warehouse2: 'WAREHOUSE', manager: 'MANAGER' };
  if (!fixtures) {
    fixtures = { run: RUN, users: {} };
    for (const [key, role] of Object.entries(roles)) {
      fixtures.users[key] = { username: PREFIX + key, role, password: crypto.randomBytes(24).toString('base64url') };
    }
    fs.writeFileSync(fixturePath, JSON.stringify(fixtures), { flag: 'wx', mode: 0o600 });
  }
  const existing = (await query('SELECT Id,Username,Role FROM wf.AppUser WHERE Username LIKE @prefix', {
    prefix: param(db.sql.NVarChar(60), PREFIX + '%'),
  })).recordset;
  if (existing.length) {
    check(existing.length === 5 && Object.entries(fixtures.users).every(([key, u]) =>
      existing.some(r => r.Username === u.username && r.Role === roles[key] && Number(r.Id) === Number(u.id))), 'EXISTING_FIXTURES_MATCH_OWN_RUN');
  } else {
    const emp = await query("SELECT COUNT(*) AS N FROM dbo.EMEmp WHERE EmpID=@emp AND EmpType='G' AND EmpStatus='1'", { emp: param(db.sql.Int, EMP_ID) });
    check(Number(emp.recordset[0].N) === 1, 'EXISTING_NATIVE_EMPLOYEE');
    const hashes = {};
    for (const [key, u] of Object.entries(fixtures.users)) hashes[key] = await bcrypt.hash(u.password, 12);
    await db.wfTransaction(async tx => {
      const guard = await tx.request().input('prefix', db.sql.NVarChar(60), PREFIX + '%')
        .query('SELECT COUNT(*) AS N FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE Username LIKE @prefix');
      if (Number(guard.recordset[0].N) !== 0) throw Error('FIXTURE_NAMESPACE_POPULATED');
      for (const [key, u] of Object.entries(fixtures.users)) {
        const r = await tx.request()
          .input('u', db.sql.NVarChar(50), u.username)
          .input('h', db.sql.NVarChar(255), hashes[key])
          .input('d', db.sql.NVarChar(100), 'UAT loop ' + key)
          .input('r', db.sql.NVarChar(30), u.role)
          .input('e', db.sql.NVarChar(20), String(EMP_ID))
          .query('INSERT INTO wf.AppUser(Username,PasswordHash,DisplayName,Role,EmpId,IsActive,MustChangePassword) OUTPUT inserted.Id VALUES(@u,@h,@d,@r,@e,1,0)');
        u.id = Number(r.recordset[0].Id);
      }
    });
    fs.writeFileSync(fixturePath, JSON.stringify(fixtures), { mode: 0o600 });
    check(true, 'FIVE_ISOLATED_UAT_USERS_CREATED');
  }
  await loginAll();
  const c = await call('GET', '/master/customers?q=' + CUST_ID + '&limit=50', undefined, 'sales');
  const g = await call('GET', '/master/goods?limit=2000', undefined, 'sales');
  const p = await call('GET', '/master/prices?custId=' + CUST_ID + '&goodId=' + GOOD_ID + '&asOf=' + deliveryDate, undefined, 'sales');
  check(c.status === 200 && c.data.some(r => Number(r.CustID) === CUST_ID), 'EXISTING_CUSTOMER_FIXTURE');
  check(g.status === 200 && g.data.some(r => Number(r.GoodID) === GOOD_ID), 'EXISTING_PRODUCT_FIXTURE');
  check(p.status === 200 && p.data.some(r => Number(r.GoodID) === GOOD_ID && Number(r.GoodPriceNet) === NET_PRICE && !r.IsExpired), 'EXISTING_PRICE_FIXTURE');
  const contact = await query("SELECT COUNT(*) AS N FROM dbo.EMCustContact WHERE CustID=@c AND IsDefault='Y' AND LTRIM(RTRIM(ISNULL(ContactName,'')))<>''", { c: param(db.sql.Int, CUST_ID) });
  check(Number(contact.recordset[0].N) >= 1, 'CUSTOMER_HAS_DEFAULT_CONTACT');
  check(Object.values(state.cases).length === 0, 'NO_BUSINESS_DOCUMENTS_PREPARED_YET');
}

async function booking(book, c) {
  const customers = await call('GET', '/master/customers?q=' + CUST_ID + '&limit=50', undefined, 'sales');
  const customer = customers.data.find(r => Number(r.CustID) === CUST_ID);
  const goods = await call('GET', '/master/goods?limit=2000', undefined, 'sales');
  const good = goods.data.find(r => Number(r.GoodID) === GOOD_ID);
  if (!customer || !good) throw Error('MASTER_FIXTURE_MISSING');
  const line = {
    goodId: String(GOOD_ID), goodCode: good.GoodCode, goodName: good.GoodName, qtyTon: 1,
    pricePerTon: NET_PRICE, netPricePerTon: NET_PRICE, masterQty: 1, childQty: 0, isGiveaway: false,
  };
  const mark = RUN + '-' + book;
  if (!c.quoteId) {
    const r = await call('POST', '/quotation', { custId: String(CUST_ID), custName: customer.CustName, validUntil: deliveryDate, remark: mark, lines: [line] }, 'sales');
    if (r.status === 200 && r.data.id) {
      c.quoteId = r.data.id;
      c.quoteNo = r.data.quoteNo;
      c.nativeQuoteSoid = r.data.winspeedQuoteSoid;
      save();
    }
    check(r.status === 200 && !!c.quoteId && !!c.nativeQuoteSoid, book + '_QUOTATION_CREATED');
  }
  const quote = await call('GET', '/quotation/' + c.quoteId, undefined, 'sales');
  check(quote.status === 200 && Number(quote.data.TotalTon) === 1 && Number(quote.data.TotalAmount) === NET_PRICE, book + '_QUOTATION_READBACK');
  if (!['ACCEPTED', 'CONVERTED'].includes(quote.data.Status)) {
    check((await call('PATCH', '/quotation/' + c.quoteId + '/status', { status: 'SENT' }, 'sales')).status === 200, book + '_QUOTATION_SENT');
    check((await call('PATCH', '/quotation/' + c.quoteId + '/status', { status: 'ACCEPTED' }, 'sales')).status === 200, book + '_QUOTATION_ACCEPTED');
  }
  const plate = 'UAT2-R740-' + book;
  const order = {
    soPrefix: book, custId: String(CUST_ID), custName: customer.CustName, deliveryDate, truckPlate: plate, remark: mark,
    truckRemark: mark + '-TRIP', billRemark: mark + '-BILL', creditDays: Number(customer.CreditDays || 0), isOwnTruck: false,
    noTruckRequired: false, pSling: false, convertFromQuoteId: c.quoteId, lines: [line],
  };
  if (!c.draftId) {
    const r = await call('POST', '/so', order, 'sales');
    if (r.status === 200) {
      c.draftId = (r.data.ids || r.data.createdIds || [r.data.id])[0];
      save();
    }
    check(r.status === 200 && !!c.draftId, book + '_BOOKING_DRAFT_CREATED');
  }
  check((await call('POST', '/so', order, 'sales')).status === 409, book + '_DUPLICATE_QUOTE_CONVERSION_DENIED');
  if (!c.verified) {
    check((await call('PATCH', '/so/' + c.draftId + '/verify', {}, 'manager')).status === 200, book + '_DRAFT_VERIFIED');
    c.verified = true;
    save();
  }
  if (!c.tripId) {
    const r = await call('POST', '/trips', {
      tripCode: mark, transRegistration: plate, driverName: 'UAT LOOP TEST', truckCapacityTon: 10,
      orderIds: [c.draftId], scheduledDate: deliveryDate, remark: mark,
    }, 'sales');
    if (r.status === 200) {
      c.tripId = r.data.tripId;
      save();
    }
    check(r.status === 200 && !!c.tripId, book + '_TRIP_CREATED');
  }
  if (!c.tripCommand) {
    const r = await call('GET', '/trips/' + c.tripId, undefined, 'sales');
    const t = r.data.trip || r.data;
    check(r.status === 200 && (t.TripCode || t.tripCode) === mark, book + '_OWNED_TRIP');
    c.tripCommand = {
      confirmedOrderIds: ['DRAFT:' + c.draftId], transRegistration: plate, driverName: 'UAT LOOP TEST', pickupDueDate: deliveryDate,
      expectedRevision: t.DocumentRevision ?? t.documentRevision, idempotencyKey: mark + '-CONFIRM',
    };
    save();
  }
  for (let i = 0; i < 2; i++) {
    check((await call('POST', '/trips/' + c.tripId + '/confirm', c.tripCommand, 'sales')).status === 200, book + '_TRIP_CONFIRM_' + (i ? 'REPLAY' : 'APPLY'));
  }
  const rows = (await query('SELECT o.SOID,h.DocuNo FROM wf.NativeBookingOrigin o JOIN dbo.SOHD h ON h.SOID=o.SOID AND h.DocuType=103 WHERE o.SourceDraftId=@id', {
    id: param(db.sql.Int, Number(c.draftId)),
  })).recordset;
  check(rows.length === 1 && rows[0].DocuNo.startsWith(book), book + '_ONE_NATIVE_BOOKING_WITH_ORIGIN');
  c.soid = Number(rows[0].SOID);
  c.bookingNo = rows[0].DocuNo;
  save();
  const route = '/so/' + c.soid + '/native-ai';
  if (!c.ai) {
    const p = await call('GET', route + '/preview', undefined, 'sales');
    check(p.status === 200, book + '_AI_PREVIEW');
    c.aiCommand ||= { requestId: crypto.randomUUID(), fingerprint: p.data.fingerprint };
    save();
    const r = await call('POST', route, c.aiCommand, 'sales');
    if (r.status === 200) {
      c.ai = r.data;
      save();
    }
    check(r.status === 200 && !!r.data.approvalNo, book + '_AI_APPLIED');
  }
  const replay = await call('POST', route, c.aiCommand, 'sales');
  check(replay.status === 200 && replay.data.replayed === true, book + '_AI_STABLE_REPLAY');
}

function requestFrom(c, key, preview) {
  if (!c[key]) {
    c[key] = { requestId: crypto.randomUUID(), fingerprint: preview.fingerprint };
    save();
  }
  return c[key];
}

// Two identical requests at once must create one document and replay it for the other.
async function concurrency(route, payload, key, label, c, field, idField) {
  if (c[field]) {
    const r = await call('POST', route, payload, key);
    check(r.status === 200 && r.data.replayed === true, label + '_REPLAY');
    return;
  }
  const replies = await Promise.all([call('POST', route, payload, key), call('POST', route, payload, key)]);
  const created = replies.find(r => r.status === 200 && r.data.replayed === false);
  if (created) {
    c[field] = created.data;
    save();
  }
  check(replies.every(r => r.status === 200), label + '_CONCURRENT_HTTP');
  check(replies.map(r => r.data.replayed).sort().join(',') === 'false,true' && new Set(replies.map(r => r.data[idField])).size === 1, label + '_ONE_CREATE_ONE_REPLAY');
}

async function delivery(book, c) {
  if (!c.soid) throw Error('BOOKING_REQUIRED');
  const route = '/so/' + c.soid + '/native-delivery';
  let requester = 'sales';
  if (book === 'K') {
    const r = await call('POST', '/auth/access-as', { userId: fixtures.users.sales.id }, 'account');
    check(r.status === 200 && r.data.user?.isImpersonating === true, 'K_ACCOUNT_REQUESTER_ACCESS_AS_SALES');
    requester = r.data.accessToken;
  }
  try {
    const p = await call('GET', route + '/preview', undefined, requester);
    check(p.status === 200, book + '_104_PREVIEW');
    if (!c.delivery) {
      check(p.data.book === book && p.data.couponSeries === (book === 'I' ? 'C' : 'D') && p.data.packKg === '50.0000' && p.data.sackQty === '20.0000', book + '_104_PACKAGING_ACCOUNT');
      const payload = requestFrom(c, 'deliveryCommand', p.data);
      check((await call('POST', route + '/requests', payload, requester)).status === 200, book + '_104_REQUEST');
      const held = await call('POST', route, payload, requester);
      check(held.status === 409 && held.data.code === 'DO_CREDIT_APPROVAL_REQUIRED', book + '_104_HELD_FOR_CREDIT');
      const approve = route + '/requests/' + payload.requestId + '/approve';
      for (const role of ['sales', 'manager', 'warehouse', 'warehouse2']) {
        check((await call('POST', approve, { ...payload, reason: RUN + ' credit test' }, role)).status === 403, book + '_CREDIT_DENY_' + role.toUpperCase());
      }
      const r = await call('POST', approve, { ...payload, reason: RUN + ' controlled UAT credit test' }, 'account');
      check(r.status === 200 && r.data.selfApproval === (book === 'K'), book + '_ACCOUNT_CREDIT_ACTUAL_SELF_RULE');
    }
    await concurrency(route, c.deliveryCommand, requester, book + '_104', c, 'delivery', 'deliverySoid');
    check(c.delivery.deliveryNo.startsWith(book) && c.delivery.couponNo.startsWith(book === 'I' ? 'C' : 'D') && c.delivery.shipmentReady === false, book + '_104_CHAIN');
  } finally {
    if (book === 'K') check((await call('POST', '/auth/access-as/stop', {}, requester)).status === 200, 'K_ACCESS_AS_STOP');
  }
}

async function redemption(book, c) {
  if (!c.delivery) throw Error('DELIVERY_REQUIRED');
  const route = '/so/' + c.soid + '/native-redemption';
  const creator = book === 'I' ? 'account' : 'warehouse2';
  const approver = book === 'I' ? creator : 'manager';
  const p = await call('GET', route + '/preview', undefined, creator);
  check(p.status === 200, book + '_116_PREVIEW');
  if (!c.manual) {
    const s = p.data.slip || {};
    check(book === 'I'
      ? s.source === 'SCALE' && s.exception === false && s.slipNo === slipFor(c) && s.plate === 'UAT2-R740-I' && Number(s.netKg) === NET_KG
      : s.source === 'MANUAL' && s.exception === true && s.slipNo === null,
    book + '_116_SLIP_MODE_' + (book === 'I' ? 'SCALE_IN_TOLERANCE' : 'MANUAL_EXCEPTION'));
    const payload = requestFrom(c, 'manualCommand', p.data);
    Object.assign(payload, {
      reason: RUN + ' ' + book + ' UAT simulation; transport slip from ' + (book === 'I' ? 'simulated scale record' : 'typed slip, no scale record'),
      receiver: 'UAT2 LOOP TEST ' + book, plate: 'UAT2-R740-' + book, slipNo: slipFor(c),
    });
    save();
    check((await call('POST', route + '/requests', payload, creator)).status === 200, book + '_116_REQUEST');
    const held = await call('POST', route, payload, creator);
    check(held.status === 409 && held.data.code === 'MR_APPROVAL_REQUIRED', book + '_116_HELD_FOR_APPROVAL');
    const approve = route + '/requests/' + payload.requestId + '/approve';
    for (const key of ['sales', 'warehouse', ...(book === 'K' ? ['account'] : [])]) {
      check((await call('POST', approve, payload, key)).status === 403, book + '_116_CROSS_APPROVAL_DENY_' + key.toUpperCase());
    }
    if (book === 'K') {
      const s2 = await call('POST', approve, payload, creator);
      check(s2.status === 403 && s2.data.code === 'MR_EXCEPTION_APPROVER_REQUIRED', book + '_116_EXCEPTION_SELF_APPROVAL_DENIED');
    }
    const r = await call('POST', approve, payload, approver);
    check(r.status === 200 && r.data.selfApproval === (book === 'I'), book + '_116_' + (book === 'I' ? 'ACCOUNTING_SELF_APPROVAL' : 'MANAGER_APPROVAL'));
    c.manualApproval = r.data;
    save();
  }
  await concurrency(route, c.manualCommand, creator, book + '_116', c, 'manual', 'redemptionId');
  check(c.manual.evidenceMode === 'UAT_SIMULATION' && c.manual.physicalShipmentVerified === false, book + '_116_SIMULATION_ONLY');
  if (creator === 'account') check((await call('PATCH', '/so/' + c.soid + '/ship', {}, creator)).status === 403, book + '_ACCOUNTING_CANNOT_PHYSICALLY_SHIP');
  const held = await call('PATCH', '/so/' + c.soid + '/ship', {}, 'warehouse2');
  check(held.status === 409 && held.data.code === 'AI_DOWNSTREAM_NOT_READY', book + '_PHYSICAL_SHIPMENT_STAYS_HELD');
}

async function invoice(book, c) {
  if (!c.manual) throw Error('MANUAL_REQUIRED');
  const route = '/so/' + c.soid + '/native-invoice';
  for (const role of ['sales', 'warehouse', 'warehouse2', 'manager']) {
    check((await call('GET', route + '/preview', undefined, role)).status === 403, book + '_107_DENY_' + role.toUpperCase());
  }
  const p = await call('GET', route + '/preview', undefined, 'account');
  check(p.status === 200, book + '_107_PREVIEW');
  if (!c.invoice) {
    check(p.data.series === (book === 'I' ? 'J' : 'N') && p.data.amount === PRICE_TEXT && p.data.qty === '1.0000' && p.data.couponNo === c.delivery.couponNo && p.data.redemptionNo === c.manual.redemptionNo, book + '_107_EXACT_CHAIN');
    const payload = requestFrom(c, 'invoiceCommand', p.data);
    payload.invoiceDate = p.data.invoiceDate;
    save();
    const nextDate = new Date(p.data.invoiceDate + 'T00:00:00Z');
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const held = await call('POST', route, { ...payload, invoiceDate: nextDate.toISOString().slice(0, 10) }, 'account');
    check(held.status === 409 && held.data.code === 'IP_DATE_OVERRIDE_UNVERIFIED', book + '_107_DATE_OVERRIDE_DENIED');
  }
  await concurrency(route, c.invoiceCommand, 'account', book + '_107', c, 'invoice', 'invoiceId');
  check(c.invoice.invoiceNo.startsWith(book === 'I' ? 'J' : 'N') && c.invoice.evidenceMode === 'UAT_SIMULATION' && c.invoice.physicalShipmentVerified === false, book + '_107_ACCOUNT_AND_SIMULATION');
  for (const [suffix, key] of [['native-invoice', 'account'], ['native-delivery', 'account'], ['native-redemption', book === 'I' ? 'account' : 'warehouse2']]) {
    const r = await call('GET', '/so/' + c.soid + '/' + suffix + '/preview', undefined, key);
    check(r.status === 200 && r.data.completed === true, book + '_AFTER107_' + suffix.toUpperCase());
  }
}

async function close() {
  if (!fixtures || fixtures.run !== RUN) throw Error('FIXTURE_SCOPE_REQUIRED');
  const ids = Object.values(fixtures.users).map(u => Number(u.id));
  if (ids.length !== 5 || ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw Error('FIXTURE_IDS_INVALID');
  const r = await query('UPDATE wf.AppUser SET IsActive=0 WHERE Username LIKE @prefix AND Id IN(' + ids.join(',') + '); SELECT @@ROWCOUNT AS N', {
    prefix: param(db.sql.NVarChar(60), PREFIX + '%'),
  });
  check(Number(r.recordset[0].N) === 5, 'FIVE_OWNED_TEST_USERS_DISABLED');
  for (const [key, u] of Object.entries(fixtures.users)) {
    const denied = await call('POST', '/auth/login', { username: u.username, password: u.password });
    check([401, 403].includes(denied.status) && !denied.data.accessToken, 'DISABLED_LOGIN_' + key.toUpperCase());
    delete u.password;
  }
  fs.writeFileSync(fixturePath, JSON.stringify(fixtures), { mode: 0o600 });
  state.closed = true;
  save();
}

async function auditChain(book, c) {
  const rows = (await query(`SELECT
    (SELECT COUNT(*) FROM wf.NativeBookingOrigin WHERE SOID=@s) AS Origins,
    (SELECT COUNT(*) FROM wf.NativeDeliveryReceipt WHERE SourceSOID=@s) AS Deliveries,
    (SELECT COUNT(*) FROM wf.NativeManualRedemptionReceipt WHERE SourceSOID=@s) AS Redemptions,
    (SELECT COUNT(*) FROM wf.NativeInitialInvoiceReceipt WHERE SourceSOID=@s) AS Invoices,
    h.DocuType AS BookingType,h.DocuNo AS BookingNo,d.DocuType AS DeliveryType,d.DocuNo AS DeliveryNo,
    sd.RefSOID,sd.RemaQty AS DeliveryRemaining,cp.CouponID,cp.CouponNo,cp.ContainQty,cp.SackQty,cp.RemaQty AS CouponRemaining,
    cut.DocuType AS RedemptionType,cut.DocuStatus AS RedemptionStatus,cut.SumGoodQty,
    cd.PostInv,cd.RemaQty AS RedemptionRemaining,
    f.DocuType AS FinanceType,f.NetAmnt AS FinanceAmount,f.CouponFlag AS FinanceCoupon,f.StockEffc AS FinanceStock,
    i.DocuType AS InvoiceType,i.NetAmnt AS InvoiceAmount,i.CouponFlag AS InvoiceCoupon,i.StockEffc AS InvoiceStock,
    id.RefID AS InvoiceDelivery,id.GoodQty2 AS InvoiceQty,
    h.ContactName AS BookingContact,d.ContactName AS DeliveryContact,f.ContactName AS FinanceContact,i.ContactName AS InvoiceContact,
    (SELECT TOP 1 ContactName FROM dbo.EMCustContact WHERE CustID=h.CustID AND IsDefault='Y' ORDER BY ListNo,ContactID) AS DefaultContact,
    mr.SelfApproval,mr.RequesterActorId,mr.ApproverActorId,cut.SaveEmpID,cut.AppvEmpID,cut.DocuNo AS CutNo,cut.CarLicense AS CutPlate,
    mr.SlipNo,mr.SlipSource,mr.ExceptionRequired,
    (SELECT COUNT(*) FROM wf.NativeDocumentApproval na
      WHERE na.DocuType=116 AND na.NativeDocID=cut.RedemtionID AND na.NativeDocNo=cut.DocuNo AND na.RequestId=m.RequestId
        AND na.RecorderUserId=mr.RequestedById AND na.RecorderActorId=mr.RequesterActorId
        AND na.ApproverUserId=mr.ApprovedById AND na.ApproverActorId=mr.ApproverActorId
        AND na.RecorderEmpID=@emp AND na.ApproverEmpID=@emp AND na.SelfApproval=mr.SelfApproval) AS WfApprovals,
    (SELECT COUNT(*) FROM dbo.ICStockDetail WHERE DocuID=i.SOInvID AND DocuType=107 AND StockFlag=-1 AND GoodQty2=1) AS StockRows,
    (SELECT COUNT(*) FROM dbo.SMAudit WHERE audit_id IN(dr.NativeAuditId,m.NativeAuditId)) AS NativeAudits,
    (SELECT COUNT(*) FROM wf.SalesOrderAudit WHERE SoId=CONVERT(varchar(50),@s) AND Action IN('NATIVE_104_CREATED','NATIVE_116_CREATED','NATIVE_107_POSTED')) AS AppAudits
   FROM dbo.SOHD h
   JOIN wf.NativeDeliveryReceipt dr ON dr.SourceSOID=h.SOID
   JOIN dbo.SOHD d ON d.SOID=dr.DeliverySOID
   JOIN dbo.SODT sd ON sd.SOID=d.SOID AND sd.ListNo=1
   JOIN dbo.WFCoupon cp ON cp.CouponID=dr.CouponID
   JOIN wf.NativeManualRedemptionReceipt m ON m.SourceSOID=h.SOID
   JOIN wf.NativeManualRedemptionRequest mr ON mr.RequestId=m.RequestId
   JOIN dbo.WFRedemtionHD cut ON cut.RedemtionID=m.RedemptionID
   JOIN dbo.WFRedemtionDT cd ON cd.RedemtionID=cut.RedemtionID AND cd.ListNo=1
   JOIN wf.NativeInitialInvoiceReceipt ir ON ir.SourceSOID=h.SOID
   JOIN dbo.SOInvHD f ON f.SOInvID=dr.FinanceSOInvID
   JOIN dbo.SOInvHD i ON i.SOInvID=ir.InvoiceID
   JOIN dbo.SOInvDT id ON id.SOInvID=i.SOInvID AND id.ListNo=1
   WHERE h.SOID=@s`, { s: param(db.sql.Int, c.soid), emp: param(db.sql.Int, EMP_ID) })).recordset;
  check(rows.length === 1, book + '_SQL_ONE_TYPED_CHAIN');
  const a = rows[0];
  check(['Origins', 'Deliveries', 'Redemptions', 'Invoices'].every(k => Number(a[k]) === 1), book + '_SQL_NO_DUPLICATE_RECEIPTS');
  check(Number(a.BookingType) === 103 && Number(a.DeliveryType) === 104 && Number(a.RedemptionType) === 116 && Number(a.InvoiceType) === 107 && Number(a.FinanceType) === 202, book + '_SQL_TYPED_DOCUMENTS');
  check(a.BookingNo === c.bookingNo && a.DeliveryNo === c.delivery.deliveryNo && a.CouponNo === c.delivery.couponNo && Number(a.RefSOID) === c.soid && Number(a.InvoiceDelivery) === c.delivery.deliverySoid, book + '_SQL_REFERENCE_CHAIN');
  check(Number(a.ContainQty) === 50 && Number(a.SackQty) === 20 && Number(a.SumGoodQty) === 1 && Number(a.InvoiceQty) === 1, book + '_SQL_QUANTITY_PACKAGING');
  check(Number(a.CouponRemaining) === 0 && Number(a.DeliveryRemaining) === 0 && Number(a.RedemptionRemaining) === 0 && a.RedemptionStatus === 'Y' && a.PostInv === 'Y', book + '_SQL_CONSUMPTION_COMPLETE');
  check(Number(a.FinanceAmount) === NET_PRICE && Number(a.InvoiceAmount) === NET_PRICE && a.FinanceCoupon === 'Y' && a.InvoiceCoupon === 'Y' && a.FinanceStock === 'N' && a.InvoiceStock === 'Y', book + '_SQL_202_107_CONTRACT_AR_REPORT_UNVERIFIED');
  check(Number(a.StockRows) === 1 && Number(a.NativeAudits) === 2 && Number(a.AppAudits) === 3, book + '_SQL_STOCK_AND_AUDIT_CARDINALITY');
  check(Boolean(a.SelfApproval) === (book === 'I') && (Number(a.RequesterActorId) === Number(a.ApproverActorId)) === (book === 'I'), book + '_SQL_116_ACTUAL_ACTOR_APPROVAL');
  check(Number(a.SaveEmpID) === EMP_ID && a.AppvEmpID == null && Number(a.WfApprovals) === 1, book + '_SQL_116_RECORDER_SAVEEMP_AND_WF_APPROVER');
  check(a.CutNo === slipFor(c) && a.SlipNo === a.CutNo && c.manual.redemptionNo === a.CutNo && a.CutPlate === 'UAT2-R740-' + book
    && a.SlipSource === (book === 'I' ? 'SCALE' : 'MANUAL') && Boolean(a.ExceptionRequired) === (book === 'K'), book + '_SQL_116_NUMBER_IS_TRANSPORT_SLIP');
  check(!!a.DefaultContact && [a.BookingContact, a.DeliveryContact, a.FinanceContact, a.InvoiceContact].every(v => v === a.DefaultContact), book + '_SQL_CONTACT_NAME_103_104_202_107');

  for (const [type, no] of [[104, c.delivery.deliveryNo], [116, c.manual.redemptionNo], [107, c.invoice.invoiceNo]]) {
    const route = '/native-print/' + type + '/' + encodeURIComponent(no);
    check((await call('GET', route, undefined, 'sales')).status === 403, book + '_PRINT_' + type + '_DENY_SALES');
    const before = await call('GET', route, undefined, 'account');
    check(before.status === 200 && before.data.DocuNo === no && !!before.data.printLog, book + '_PRINT_' + type + '_LOADS');
    if (type === 107) check(before.data.ContactName === String(a.DefaultContact).trim(), book + '_PRINT_107_SHOWS_CONTACT');
    const pressed = await call('POST', route + '/printed', {}, 'account');
    check(pressed.status === 200 && pressed.data.printLog?.count === before.data.printLog.count + 1, book + '_PRINT_' + type + '_LOGGED');
  }

  const t = await call('GET', '/master/control-tickets/' + c.delivery.couponNo + '/trace?entityType=COUPON&exactId=' + a.CouponID, undefined, 'account');
  check(t.status === 200 && t.data.isAmbiguous === false && t.data.truncated === false, book + '_TRACE_API_RESOLVED_WITH_EXACT_ID');
  const chain = t.data.chain;
  check(chain.bookings.some(x => Number(x.soId) === c.soid && x.docuNo === c.bookingNo)
    && chain.deliveries.some(x => Number(x.soId) === Number(c.delivery.deliverySoid) && x.docuNo === c.delivery.deliveryNo), book + '_TRACE_TYPED_BOOKING_DELIVERY');
  check(chain.coupons.some(x => Number(x.couponId) === Number(a.CouponID) && x.couponNo === c.delivery.couponNo)
    && chain.redemptions.some(x => Number(x.redemptionId) === Number(c.manual.redemptionId) && x.invoiceDocuNo === c.invoice.invoiceNo)
    && chain.invoices.some(x => Number(x.soInvId) === Number(c.invoice.invoiceId) && x.docuNo === c.invoice.invoiceNo), book + '_TRACE_COUPON_116_107');
  const links = t.data.edges;
  check(links.some(e => e.source === 'BOOKING:' + c.soid && e.target === 'DELIVERY:' + c.delivery.deliverySoid)
    && links.some(e => e.source === 'DELIVERY:' + c.delivery.deliverySoid && e.target === 'COUPON:' + a.CouponID)
    && links.some(e => e.source === 'REDEMPTION:' + c.manual.redemptionId && e.target === 'INVOICE:' + c.invoice.invoiceId), book + '_TRACE_EXACT_TYPED_EDGES');
}

const caseLine = c => ({
  book: c.book, booking: c.bookingNo, ai: c.ai?.approvalNo, delivery: c.delivery?.deliveryNo,
  coupon: c.delivery?.couponNo, redemption: c.manual?.redemptionNo, invoice: c.invoice?.invoiceNo,
});

async function audit() {
  for (const book of ['I', 'K']) {
    const c = state.cases[book];
    if (!c?.invoice) throw Error('INVOICE_REQUIRED');
    await auditChain(book, c);
    console.log('LOOP_CHAIN=' + JSON.stringify(caseLine(c)));
  }
  const docs = await call('GET', '/reports/native-documents?limit=200', undefined, 'account');
  check(docs.status === 200 && ['I', 'K'].every(b => (docs.data.rows || []).some(r => r.BookingNo === state.cases[b].bookingNo)), 'REPORT_NATIVE_DOCUMENTS_LISTS_BOTH_CHAINS');
  const logs = await call('GET', '/reports/native-print-log', undefined, 'account');
  check(logs.status === 200 && (logs.data.rows || []).length >= 6, 'REPORT_PRINT_LOG_LISTS_THE_PRESSES');
  check((await call('GET', '/reports/native-print-log', undefined, 'sales')).status === 403, 'REPORT_PRINT_LOG_DENY_SALES');
}

async function main() {
  await target();
  if (phase === 'prepare') return prepare();
  if (phase === 'close') return close();
  await loginAll();
  if (phase === 'audit') return audit();
  const [book, step] = phase.split('-');
  const c = state.cases[book] || (state.cases[book] = { book });
  save();
  await ({ booking, 104: delivery, 116: redemption, 107: invoice })[step](book, c);
  console.log('LOOP_CASE=' + JSON.stringify({ step, ...caseLine(c) }));
}

main()
  .then(() => console.log('LOOP_PHASE=' + phase + ' PASS'))
  .catch(e => {
    console.log('LOOP_PHASE=' + phase + ' FAILED ' + (/^[A-Z_0-9]+$/.test(e.message) ? e.message : 'INTERNAL_FAILURE'));
    process.exitCode = 1;
  })
  .finally(() => db.closeAll());
