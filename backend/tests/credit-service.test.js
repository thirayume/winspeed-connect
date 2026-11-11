const test = require('node:test');
const assert = require('node:assert/strict');
const { checkCustomerCreditAndAging, fmt, parseNullableAgingInput } = require('../services/credit-service');

test('fmt: formats currency numbers accurately in Thai locale', () => {
  assert.equal(fmt(1000), '1,000.00');
  assert.equal(fmt(1234567.89), '1,234,567.89');
  assert.equal(fmt(0), '0.00');
});

test('parseNullableAgingInput: preserves 0 and null while parsing integers', () => {
  assert.equal(parseNullableAgingInput(0), 0);
  assert.equal(parseNullableAgingInput('0'), 0);
  assert.equal(parseNullableAgingInput(null), null);
  assert.equal(parseNullableAgingInput(undefined), null);
  assert.equal(parseNullableAgingInput(''), null);
  assert.equal(parseNullableAgingInput('90'), 90);
});

test('checkCustomerCreditAndAging: returns clean empty structure on blank custId', async () => {
  const res = await checkCustomerCreditAndAging('');
  assert.equal(res.ok, true);
  assert.equal(res.blocked, false);
  assert.equal(res.warnings.length, 0);
  assert.equal(res.anomalies.length, 0);
});

function makeSettingsReader(overrides = {}) {
  const map = {
    CREDIT_LIMIT_STRICT_MODE: false,
    CREDIT_AGING_STRICT_MODE: false,
    CREDIT_AGING_DEFAULT_DAYS: 60,
    CREDIT_AGING_MAX_DAYS: 90,
    CREDIT_AGING_ALERT_POPUP: true,
    ...overrides,
  };
  return async key => map[key];
}

test('checkCustomerCreditAndAging: 0 AgingDays means cash-only and must not coerce to 60', async () => {
  const mockQuery = async sqlText => {
    if (sqlText.includes('FROM dbo.EMCust')) {
      return { recordset: [{ CustID: 'C000', CustName: 'Cash Buyer', CustLimit: 0, GroupLimit: 0, AgingDaysLimit: 0, CreditHold: 0 }] };
    }
    return { recordset: [{ DocuNo: 'I69-0001', DocuDate: '2026-11-11', UnpaidAmnt: 5000, AgeDays: 0 }] };
  };
  const res = await checkCustomerCreditAndAging('C000', 10000, {
    wfQuery: mockQuery,
    getSettingValue: makeSettingsReader(),
  });
  assert.equal(res.rawAgingDays, 0);
  assert.equal(res.agingLimitDays, 0);
  assert.equal(res.isCashOnly, true);
  assert.equal(res.isUsingDefaultAging, false);
  assert.equal(res.isAgingExceeded, true);
  assert.equal(res.isOverAging, true);
  assert.match(res.warnings[0], /ขายเงินสด \(0 วัน\)/);
});

test('checkCustomerCreditAndAging: null AgingDays inherits CREDIT_AGING_DEFAULT_DAYS dynamically', async () => {
  const mockQuery = async sqlText => {
    if (sqlText.includes('FROM dbo.EMCust')) {
      return { recordset: [{ CustID: 'C001', CustName: 'Default Aging Cust', CustLimit: 0, GroupLimit: 0, AgingDaysLimit: null, CreditHold: 0 }] };
    }
    return { recordset: [{ DocuNo: 'I69-0002', DocuDate: '2026-09-01', UnpaidAmnt: 2000, AgeDays: 70 }] };
  };
  const res = await checkCustomerCreditAndAging('C001', 0, {
    wfQuery: mockQuery,
    getSettingValue: makeSettingsReader({ CREDIT_AGING_DEFAULT_DAYS: 75, CREDIT_AGING_MAX_DAYS: 90 }),
  });
  assert.equal(res.rawAgingDays, null);
  assert.equal(res.isUsingDefaultAging, true);
  assert.equal(res.agingLimitDays, 75);
  assert.equal(res.isCashOnly, false);
  assert.equal(res.isAgingExceeded, false);
  assert.equal(res.isOverPolicyMaxAging, false);
});

test('checkCustomerCreditAndAging: flags critical policy max exceedance and misconfigured customer Aging > max', async () => {
  const mockQuery = async sqlText => {
    if (sqlText.includes('FROM dbo.EMCust')) {
      return { recordset: [{ CustID: 'C002', CustName: 'Typo 100 Cust', CustLimit: 0, GroupLimit: 0, AgingDaysLimit: 100, CreditHold: 0 }] };
    }
    return { recordset: [{ DocuNo: 'I68-0100', DocuDate: '2026-08-01', UnpaidAmnt: 15000, AgeDays: 95 }] };
  };
  const res = await checkCustomerCreditAndAging('C002', 0, {
    wfQuery: mockQuery,
    getSettingValue: makeSettingsReader({ CREDIT_AGING_MAX_DAYS: 90 }),
  });
  assert.equal(res.isAgingExceeded, false); // 95 <= 100
  assert.equal(res.isOverPolicyMaxAging, true); // 95 > 90 policy max!
  assert.equal(res.isConfiguredAgingOverPolicyMax, true); // 100 > 90 policy max!
  assert.equal(res.warnings.length, 2);
  assert.match(res.warnings[0], /เกินเพดานสูงสุดตามนโยบาย \(90 วัน\)/);
  assert.match(res.warnings[1], /กำหนด Aging ของลูกค้า \(100 วัน\) สูงกว่าเกณฑ์สูงสุดตามนโยบาย \(90 วัน\)/);
});

