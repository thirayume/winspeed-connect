const test = require('node:test');
const assert = require('node:assert/strict');
const {
  POLICY_DEFINITIONS,
  validateSetting,
  validateReasonCode,
  validateSettingsPayload,
} = require('../services/policy-contract');

test('policy-contract: rejects unknown setting keys', () => {
  const res = validateSetting('UNKNOWN_KEY', '123');
  assert.equal(res.valid, false);
  assert.match(res.error, /ไม่อนุญาต/);

  const payloadRes = validateSettingsPayload({ UNKNOWN_KEY: '123' });
  assert.equal(payloadRes.valid, false);
  assert.ok(payloadRes.errors.length > 0);
});

test('policy-contract: R5 fail-closed against prototype pollution keys', () => {
  const protoKeys = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf'];
  for (const key of protoKeys) {
    const res = validateSetting(key, '100');
    assert.equal(res.valid, false, `Expected prototype key "${key}" to be rejected`);
    assert.match(res.error, /ไม่อนุญาต/);
  }
});

test('policy-contract: R5 rejects trailing junk and non-finite numbers', () => {
  const trailingJunkCases = [
    { key: 'CUSTOMER_RATIO', val: '80junk' },
    { key: 'COMPANY_RATIO', val: '20%' },
    { key: 'PICKUP_LEAD_TIME_DAYS', val: '1day' },
    { key: 'CONTROL_TICKET_ALERT_DAYS', val: '7days' },
    { key: 'TRIP_CAPACITY_TON', val: '50ton' },
    { key: 'TRIP_OVERLOAD_TOLERANCE_PCT', val: '5.0abc' },
  ];

  for (const { key, val } of trailingJunkCases) {
    const res = validateSetting(key, val);
    assert.equal(res.valid, false, `Expected "${val}" for ${key} to be rejected due to trailing characters`);
    assert.match(res.error, /ต้องเป็นตัวเลข|ต้องเป็นจำนวนเต็ม/);
  }
});

test('policy-contract: R5 enforces maximum 2 decimal places precision', () => {
  const overPrecise = validateSetting('CUSTOMER_RATIO', '99.999');
  assert.equal(overPrecise.valid, false);
  assert.match(overPrecise.error, /ทศนิยมสูงสุดไม่เกิน 2 ตำแหน่ง/);

  const preciseValid = validateSetting('CUSTOMER_RATIO', '99.95');
  assert.equal(preciseValid.valid, true);
});

test('policy-contract: validates integer settings and bounds (preserves 0 when allowed)', () => {
  // PICKUP_DUE_DEFAULT_DAYS: min 1, max 365
  const valid = validateSetting('PICKUP_DUE_DEFAULT_DAYS', 7);
  assert.equal(valid.valid, true);
  assert.equal(valid.formattedValue, '7');

  const belowMin = validateSetting('PICKUP_DUE_DEFAULT_DAYS', 0);
  assert.equal(belowMin.valid, false);

  const aboveMax = validateSetting('PICKUP_DUE_DEFAULT_DAYS', 400);
  assert.equal(aboveMax.valid, false);

  const nonInt = validateSetting('PICKUP_DUE_DEFAULT_DAYS', '7.5');
  assert.equal(nonInt.valid, false);

  // PICKUP_LEAD_TIME_DAYS: min 0, max 60 (0 must be allowed)
  const zeroLeadTime = validateSetting('PICKUP_LEAD_TIME_DAYS', 0);
  assert.equal(zeroLeadTime.valid, true);
  assert.equal(zeroLeadTime.formattedValue, '0');

  const zeroStr = validateSetting('PICKUP_LEAD_TIME_DAYS', '0');
  assert.equal(zeroStr.valid, true);
  assert.equal(zeroStr.formattedValue, '0');
});

test('policy-contract: validates boolean settings', () => {
  const trueVal = validateSetting('PICKUP_STRICT_MODE', 'true');
  assert.equal(trueVal.valid, true);
  assert.equal(trueVal.formattedValue, 'true');

  const falseVal = validateSetting('PICKUP_STRICT_MODE', false);
  assert.equal(falseVal.valid, true);
  assert.equal(falseVal.formattedValue, 'false');

  const invalid = validateSetting('PICKUP_STRICT_MODE', 'maybe');
  assert.equal(invalid.valid, false);
});

test('policy-contract: validates CSV_INT settings and bounds (1 to 365)', () => {
  const valid = validateSetting('PICKUP_DUE_OPTIONS', '7, 15, 30, 45');
  assert.equal(valid.valid, true);
  assert.equal(valid.formattedValue, '7,15,30,45');

  const invalid = validateSetting('PICKUP_DUE_OPTIONS', '7,abc,30');
  assert.equal(invalid.valid, false);

  const outOfRange = validateSetting('PICKUP_DUE_OPTIONS', '7,15,400');
  assert.equal(outOfRange.valid, false);
  assert.match(outOfRange.error, /ระหว่าง 1 ถึง 365 วัน/);
});

test('policy-contract: enforces rebate ratio sum equals 100%', () => {
  const valid = validateSettingsPayload({
    CUSTOMER_RATIO: 80,
    COMPANY_RATIO: 20,
  });
  assert.equal(valid.valid, true);

  const invalid = validateSettingsPayload({
    CUSTOMER_RATIO: 80,
    COMPANY_RATIO: 30,
  });
  assert.equal(invalid.valid, false);
  assert.ok(payloadHasError(invalid.errors, /สัดส่วนเงินรีเบท/));
});

test('policy-contract: enforces weight tolerance min <= max', () => {
  const valid = validateSettingsPayload({
    WEIGHT_TOLERANCE_MIN_PCT: 2.0,
    WEIGHT_TOLERANCE_MAX_PCT: 5.0,
  });
  assert.equal(valid.valid, true);

  const invalid = validateSettingsPayload({
    WEIGHT_TOLERANCE_MIN_PCT: 6.0,
    WEIGHT_TOLERANCE_MAX_PCT: 4.0,
  });
  assert.equal(invalid.valid, false);
  assert.ok(payloadHasError(invalid.errors, /เกณฑ์ความต่างน้ำหนักต่ำสุด/));
});

function payloadHasError(errors, pattern) {
  return errors.some(e => pattern.test(e));
}
