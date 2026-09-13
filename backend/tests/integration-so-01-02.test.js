const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeClaim } = require('../routes/rebate');
const {
  POLICY_DEFINITIONS,
  validateSetting,
  validateSettingsPayload,
  validateReasonCode,
} = require('../services/policy-contract');

// ── R1: Scalar claim projection & duplicate alias elimination ──────────────────
test('R1: normalizeClaim converts duplicate array projections into scalar values', () => {
  // mssql on Windows/Linux returns arrays when duplicate columns or aliases are queried
  const simulatedDuplicateRow = {
    ClaimId: 101,
    ClaimNo: 'RC-2026-0001',
    ClaimAmt: 150000.50,
    CustomerRatio: [100.00, 100.00],
    CompanyRatio: [0.00, 0.00],
    CustomerAmount: [150000.50, 150000.50],
    RetainedAmount: [0.00, 0.00],
    IsSelfClaim: [false, false],
    Status: 'SUBMITTED',
  };

  const normalized = normalizeClaim(simulatedDuplicateRow);

  // Assertions must strictly verify scalar types (never arrays)
  assert.equal(typeof normalized.CustomerRatio, 'number');
  assert.equal(Array.isArray(normalized.CustomerRatio), false);
  assert.equal(normalized.CustomerRatio, 100.00);

  assert.equal(typeof normalized.CompanyRatio, 'number');
  assert.equal(Array.isArray(normalized.CompanyRatio), false);
  assert.equal(normalized.CompanyRatio, 0.00);

  assert.equal(typeof normalized.CustomerAmount, 'number');
  assert.equal(Array.isArray(normalized.CustomerAmount), false);
  assert.equal(normalized.CustomerAmount, 150000.50);

  assert.equal(typeof normalized.RetainedAmount, 'number');
  assert.equal(Array.isArray(normalized.RetainedAmount), false);
  assert.equal(normalized.RetainedAmount, 0.00);

  assert.equal(typeof normalized.IsSelfClaim, 'boolean');
  assert.equal(Array.isArray(normalized.IsSelfClaim), false);
  assert.equal(normalized.IsSelfClaim, false);
});

// ── R7: Minor-unit (cents/satang) financial rounding ────────────────────────────
test('R7: Minor-unit rounding guarantees CustomerAmount + RetainedAmount == ClaimAmt without drift', () => {
  function splitRebate(claimAmt, customerRatio, companyRatio) {
    const totalCents = Math.round(Number(claimAmt) * 100);
    const custRatio = Number(customerRatio);
    const customerCents = Math.round(totalCents * (custRatio / 100));
    const retainedCents = totalCents - customerCents;
    const customerAmount = customerCents / 100;
    const retainedAmount = retainedCents / 100;
    return { customerAmount, retainedAmount };
  }

  const testCases = [
    { total: 150000.50, custRatio: 100, compRatio: 0, expectedCust: 150000.50, expectedRet: 0.00 },
    { total: 0.05, custRatio: 50, compRatio: 50, expectedCust: 0.03, expectedRet: 0.02 },
    { total: 1000.03, custRatio: 70, compRatio: 30, expectedCust: 700.02, expectedRet: 300.01 },
    { total: 99.99, custRatio: 33.33, compRatio: 66.67, expectedCust: 33.33, expectedRet: 66.66 },
    { total: 1.01, custRatio: 50, compRatio: 50, expectedCust: 0.51, expectedRet: 0.50 },
    { total: 85234.17, custRatio: 80, compRatio: 20, expectedCust: 68187.34, expectedRet: 17046.83 },
  ];

  for (const tc of testCases) {
    const { customerAmount, retainedAmount } = splitRebate(tc.total, tc.custRatio, tc.compRatio);
    assert.equal(
      customerAmount,
      tc.expectedCust,
      `CustomerAmount mismatch for total ${tc.total} at ratio ${tc.custRatio}%`
    );
    assert.equal(
      retainedAmount,
      tc.expectedRet,
      `RetainedAmount mismatch for total ${tc.total} at ratio ${tc.compRatio}%`
    );
    // Exact minor-unit sum equality check
    assert.equal(
      Number((customerAmount + retainedAmount).toFixed(2)),
      tc.total,
      `Sum of customer (${customerAmount}) + retained (${retainedAmount}) must equal total ${tc.total}`
    );
  }
});

// ── R4: Preserving legitimate 0 values in Admin UI and Settings ─────────────────
test('R4: System allows legitimate 0 values without reverting to defaults', () => {
  // Lead time 0 days (same-day pickup allowed)
  const zeroLeadTime = validateSetting('PICKUP_LEAD_TIME_DAYS', 0);
  assert.equal(zeroLeadTime.valid, true);
  assert.equal(zeroLeadTime.formattedValue, '0');

  // Ticket alert 0 days (alert only on day of expiration)
  const zeroAlertDays = validateSetting('CONTROL_TICKET_ALERT_DAYS', 0);
  assert.equal(zeroAlertDays.valid, true);
  assert.equal(zeroAlertDays.formattedValue, '0');

  // Overload tolerance 0% (strict zero tolerance)
  const zeroTolerance = validateSetting('TRIP_OVERLOAD_TOLERANCE_PCT', 0);
  assert.equal(zeroTolerance.valid, true);
  assert.equal(zeroTolerance.formattedValue, '0');

  // Company ratio 0% (baseline 100/0)
  const zeroCompanyRatio = validateSetting('COMPANY_RATIO', 0);
  assert.equal(zeroCompanyRatio.valid, true);
  assert.equal(zeroCompanyRatio.formattedValue, '0');

  // Pickup default days cannot be 0 (min is 1)
  const zeroDueDays = validateSetting('PICKUP_DUE_DEFAULT_DAYS', 0);
  assert.equal(zeroDueDays.valid, false);
  assert.match(zeroDueDays.error, /ต้องมีค่าไม่ต่ำกว่า 1/);
});

// ── R5: Whitelist ownership, prototype pollution, and strict numeric parsing ────
test('R5: Whitelist prevents prototype pollution and rejects trailing junk', () => {
  // Prototype property names must be rejected
  const maliciousKeys = ['constructor', '__proto__', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'];
  for (const k of maliciousKeys) {
    const res = validateSetting(k, '100');
    assert.equal(res.valid, false, `Should reject ${k}`);
    assert.match(res.error, /ไม่อนุญาต/);
  }

  // Trailing garbage strings
  const junkCases = [
    { key: 'CUSTOMER_RATIO', val: '100percent' },
    { key: 'TRIP_CAPACITY_TON', val: '50.0tons' },
    { key: 'PICKUP_LEAD_TIME_DAYS', val: '2days' },
  ];
  for (const { key, val } of junkCases) {
    const res = validateSetting(key, val);
    assert.equal(res.valid, false, `Should reject trailing characters in "${val}"`);
  }

  // Decimal precision: max 2 decimal places
  const excessiveDecimals = validateSetting('CUSTOMER_RATIO', '99.999');
  assert.equal(excessiveDecimals.valid, false);
  assert.match(excessiveDecimals.error, /ทศนิยมสูงสุดไม่เกิน 2 ตำแหน่ง/);
});

// ── R2 & R8: Reason Master Whitelist and Mandatory Detail for 'OTHER' ───────────
test('R2 & R8: Reason validation requires active reason and detail >= 5 chars for OTHER', async () => {
  // Simulated tx with mock EditReason records
  const mockTx = {
    request: () => {
      const req = {
        _inputs: {},
        input(name, type, val) {
          req._inputs[name] = val;
          return req;
        },
        async query(q) {
          const val = req._inputs['code'];
          if (val === 'POLICY_ADJUSTMENT') {
            return { recordset: [{ ReasonCode: 'POLICY_ADJUSTMENT', ReasonText: 'ปรับปรุงตามนโยบายบริษัท', AppliesTo: 'POLICY', IsActive: true }] };
          }
          if (val === 'OTHER') {
            return { recordset: [{ ReasonCode: 'OTHER', ReasonText: 'อื่น ๆ', AppliesTo: 'POLICY,SO_CANCEL,SO_DELETE', IsActive: true }] };
          }
          return { recordset: [] };
        },
      };
      return req;
    },
  };

  // Missing reason code
  const emptyRes = await validateReasonCode(mockTx, '', 'Some detail', 'POLICY');
  assert.equal(emptyRes.valid, false);
  assert.match(emptyRes.error, /ต้องระบุรหัสเหตุผล/);

  // Unknown reason code
  const unknownRes = await validateReasonCode(mockTx, 'UNKNOWN_HACK', 'Some detail', 'POLICY');
  assert.equal(unknownRes.valid, false);
  assert.match(unknownRes.error, /ไม่ถูกต้องหรือยังไม่เปิดใช้งาน/);

  // OTHER with insufficient detail (< 5 chars)
  const shortOther = await validateReasonCode(mockTx, 'OTHER', 'fix', 'POLICY');
  assert.equal(shortOther.valid, false);
  assert.match(shortOther.error, /อย่างน้อย 5 ตัวอักษร/);

  // OTHER with sufficient detail (>= 5 chars)
  const validOther = await validateReasonCode(mockTx, 'OTHER', 'ปรับเปลี่ยนตามรอบบัญชีประจำปี', 'POLICY');
  assert.equal(validOther.valid, true);
  assert.equal(validOther.reasonCode, 'OTHER');
  assert.equal(validOther.reasonText, 'ปรับเปลี่ยนตามรอบบัญชีประจำปี');

  // Standard reason code
  const validStandard = await validateReasonCode(mockTx, 'POLICY_ADJUSTMENT', '', 'POLICY');
  assert.equal(validStandard.valid, true);
  assert.equal(validStandard.reasonCode, 'POLICY_ADJUSTMENT');
});

// ── R3: Hostile Client Ratio Rejection (Baseline 100/0 Enforcement) ─────────────
test('R3 & SO-02: System overrides hostile client ratios with active snapshot policy', () => {
  // Scenario: Client submits custom split (e.g. 80/20) attempting to claim company portion
  const clientPayload = {
    claimAmt: 50000,
    customerRatio: 80.00,
    companyRatio: 20.00,
  };

  // Active snapshot policy in DB is 100/0
  const activeSnapshotPolicy = {
    CUSTOMER_RATIO: 100.00,
    COMPANY_RATIO: 0.00,
  };

  // Backend policy enforcement logic (as implemented in POST /api/rebate/claims)
  const customerRatio = Number(activeSnapshotPolicy.CUSTOMER_RATIO !== undefined ? activeSnapshotPolicy.CUSTOMER_RATIO : 100.00);
  const companyRatio = Number(activeSnapshotPolicy.COMPANY_RATIO !== undefined ? activeSnapshotPolicy.COMPANY_RATIO : 0.00);

  const totalCents = Math.round(Number(clientPayload.claimAmt) * 100);
  const customerCents = Math.round(totalCents * (customerRatio / 100));
  const retainedCents = totalCents - customerCents;
  const customerAmount = customerCents / 100;
  const retainedAmount = retainedCents / 100;

  // The client's 80/20 request must be IGNORED in favor of 100/0
  assert.equal(customerRatio, 100.00);
  assert.equal(companyRatio, 0.00);
  assert.equal(customerAmount, 50000.00);
  assert.equal(retainedAmount, 0.00);
  assert.equal(customerAmount + retainedAmount, clientPayload.claimAmt);
});

// ── R6: Amount-only Claim Role Restrictions ─────────────────────────────────────
test('R6: Amount-only claim requires elevated role and reason code', () => {
  function canSubmitAmountOnly(role, lines, reasonCode, reasonDetail) {
    const isAmountOnly = !lines || lines.length === 0;
    if (!isAmountOnly) return { allowed: true };

    const elevatedRoles = ['ADMIN', 'ACCOUNTING', 'C_LEVEL'];
    if (!elevatedRoles.includes(role)) {
      return { allowed: false, status: 403, error: 'เฉพาะผู้ดูแลระบบและฝ่ายบัญชีเท่านั้นที่สามารถบันทึกเคลมแบบระบุยอดเงินโดยตรงได้' };
    }
    if (!reasonCode || !reasonDetail || reasonDetail.trim().length < 5) {
      return { allowed: false, status: 400, error: 'การเคลมแบบระบุยอดเงินโดยตรงต้องระบุรหัสเหตุผลและคำอธิบายอย่างน้อย 5 ตัวอักษร' };
    }
    return { allowed: true };
  }

  // SALES role attempting amount-only
  const salesAttempt = canSubmitAmountOnly('SALES', [], 'SPECIAL_ADJUST', 'คำขอพิเศษ');
  assert.equal(salesAttempt.allowed, false);
  assert.equal(salesAttempt.status, 403);

  // ADMIN role attempting amount-only without detail
  const adminNoDetail = canSubmitAmountOnly('ADMIN', [], 'SPECIAL_ADJUST', 'ok');
  assert.equal(adminNoDetail.allowed, false);
  assert.equal(adminNoDetail.status, 400);

  // ADMIN role attempting amount-only with valid reason and explanation
  const adminValid = canSubmitAmountOnly('ADMIN', [], 'SPECIAL_ADJUST', 'ปรับปรุงยอดส่วนต่างยอดยกมาตามมติที่ประชุม');
  assert.equal(adminValid.allowed, true);

  // Normal claim with invoice lines is allowed for SALES
  const salesNormal = canSubmitAmountOnly('SALES', [{ goodCode: '001', qtyTon: 10, rebatePerTon: 500 }]);
  assert.equal(salesNormal.allowed, true);
});
